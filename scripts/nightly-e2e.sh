#!/usr/bin/env bash
# The nightly run of the FULL browser tier, on origin/main.
#
#   scripts/nightly-e2e.sh        what systemd runs (systemd/openplate-nightly-e2e.timer)
#   make nightly                  installs the timer; make nightly-now runs it once
#
# WHY. The push gate runs a browser tier SCOPED to the push, so a spec that the
# selection missed would stay unrun until the next release tag. This runs every
# spec once a night against origin/main, so such a miss shows up within a day
# and the pre-push hook prints the result at the start of every gate.
#
# WHERE. A worktree of its own (op-nightly, next to the repository), so it never
# touches a checkout somebody is working in. It is created on the first run,
# then each run fetches and detaches onto origin/main. It runs on the HOST with
# node from nvm and pnpm from ~/.local/share/pnpm (or node and pnpm from nix
# develop, see NIX), because Chromium cannot start
# in the ts-dev toolbox.
#
# AND THE PHOTO PATH GUARD. After the browser tier it runs one more stage, in
# apps/core: `pnpm test:guard`, the end-to-end test that sends a photograph
# through the real core and searches every log, response and table for it
# (apps/core/tests/integration/photo-path-guard.test.ts). It is here because the
# push gate and the release gate can both be bypassed with SKIP_TESTS=1, and a
# claim about what the server keeps should be checked on a night nobody pushed.
# It needs Postgres, and uses its OWN database, openplate_nightly_guard on the
# shared server (NIGHTLY_GUARD_DATABASE_URL names another), so it never deadlocks
# a gate that holds openplate_sync_test. The two stages are independent: a red
# browser tier does not skip the guard, and a red guard turns the night red with
# "photo guard FAILED" at the end of the summary.
#
# WHAT IT WRITES, under ${XDG_STATE_HOME:-~/.local/state}/openplate/nightly-e2e/:
#   <YYYY-MM-DD>.log   the whole run; the newest 14 are kept
#   latest.txt         one line: green|red <ISO datetime> <sha> <summary>
# The exit code is non-zero on red. A red night blocks nothing by itself.
#
# Test seams: NIGHTLY_WORKTREE names another worktree path and NIGHTLY_SKIP_RUN=1
# skips the install, build and tier (the caller then supplies NIGHTLY_FAKE_LOG, a
# file used instead of the tier's output, and NIGHTLY_FAKE_RC its exit code), so
# the summary parsing can be tried without a browser. With NIGHTLY_SKIP_RUN=1 the
# guard stage is skipped too, unless NIGHTLY_FAKE_GUARD_RC names its exit code.
#
# NIX. On a NixOS host there is no nvm and no host node. When the script runs
# outside a nix shell, with `nix` on PATH and a flake.nix in the repository, it
# re-executes itself once under `nix develop <repo> -c`, which gives it node 24
# and pnpm. OPENPLATE_NIGHTLY_IN_NIX=1 marks the second pass, so it cannot loop.
# Seam: NIGHTLY_DECIDE_ONLY=1 prints the decision (reexec, nix or host) and exits.
set -euo pipefail

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
repo=$(git -C "$script_dir" rev-parse --show-toplevel)

# toolchain <in nix marker> <IN_NIX_SHELL> <nix on PATH: 1|0> <flake.nix present: 1|0>
# prints "reexec" (restart under nix develop), "nix" (already in a nix toolchain)
# or "host" (nvm and the host pnpm, the Fedora case).
toolchain() {
  if [ -n "$1" ] || [ -n "$2" ]; then echo nix; return; fi
  if [ "$3" = "1" ] && [ "$4" = "1" ]; then echo reexec; return; fi
  echo host
}
have_nix=0
command -v nix >/dev/null 2>&1 && have_nix=1
have_flake=0
[ -f "$repo/flake.nix" ] && have_flake=1
mode=$(toolchain "${OPENPLATE_NIGHTLY_IN_NIX:-}" "${IN_NIX_SHELL:-}" "$have_nix" "$have_flake")
if [ "${NIGHTLY_DECIDE_ONLY:-0}" = "1" ]; then
  echo "$mode"
  exit 0
fi
if [ "$mode" = "reexec" ]; then
  export OPENPLATE_NIGHTLY_IN_NIX=1
  exec nix develop "$repo" -c "$script_dir/$(basename -- "$0")" "$@"
fi
worktree=${NIGHTLY_WORKTREE:-$(dirname -- "$repo")/op-nightly}
state_dir=${XDG_STATE_HOME:-$HOME/.local/state}/openplate/nightly-e2e
mkdir -p "$state_dir"
log=$state_dir/$(date +%F).log
latest=$state_dir/latest.txt

# The node and pnpm of the Fedora host. Under nix develop both are already on PATH.
use_host_toolchain() {
  export NVM_DIR=$HOME/.config/nvm
  # nvm.sh reads variables it never sets, which `set -u` would reject.
  set +u
  . "$NVM_DIR/nvm.sh"
  nvm use 24.8.0
  set -u
  export PATH=$HOME/.local/share/pnpm:$PATH
}

# The guard's own database, on the shared Postgres. Not openplate_sync_test: a
# push gate that is running at 03:30 owns that one.
guard_database_url=${NIGHTLY_GUARD_DATABASE_URL:-postgres://postgres:postgres@localhost:5433/openplate_nightly_guard}
guard_ran=0
guard_code=0

keep_logs() {
  # Newest first, so everything past the 14th is old. Names sort by date.
  find "$state_dir" -maxdepth 1 -name '????-??-??.log' | sort -r | tail -n +15 | while IFS= read -r old; do
    rm -f -- "$old"
  done
}

# summarize <tier log> <exit code>: prints the one-line summary. Shard lines
# look like "[shard 2/4] 130 passed (2.1m)" and failures like
# "[shard 2/4]   1) [chromium] > tests/e2e/foo.spec.ts:12:5 > name"; the
# separator after the project is a unicode arrow, so only the spec path is read.
summarize() {
  local file=$1 code=$2 shards passed failed_specs failed_count flaky_count flaky_specs flaky_note
  shards=$(sed -nE 's/.*e2e-sharded: ([0-9]+) shards.*/\1/p' "$file" | tail -n 1)
  passed=$(grep -oE '[0-9]+ passed' "$file" | grep -oE '[0-9]+' | awk '{ sum += $1 } END { print sum + 0 }' || true)
  failed_specs=$(grep -E '^\[shard [0-9]+/[0-9]+\] +[0-9]+\) ' "$file" | grep -oE '[A-Za-z0-9_./-]+\.spec\.ts' | sort -u | paste -sd, - | sed 's/,/, /g' || true)
  failed_count=$(grep -E '^\[shard [0-9]+/[0-9]+\] +[0-9]+\) ' "$file" | sort -u | wc -l | tr -d ' ')
  # "[shard 1/4]   2 flaky" opens a block, one "[shard 1/4]     [project] > spec"
  # line per test follows, up to the next count line. Specs are read from those.
  flaky_count=$(sed -nE 's/^\[shard [0-9]+\/[0-9]+\] +([0-9]+) flaky.*/\1/p' "$file" | awk '{ sum += $1 } END { print sum + 0 }')
  flaky_specs=$(awk '
    /^\[shard [0-9]+\/[0-9]+\] +[0-9]+ flaky/ { inblock = 1; next }
    /^\[shard [0-9]+\/[0-9]+\] +[0-9]+ (passed|failed|skipped|did not run|interrupted)/ { inblock = 0 }
    inblock && match($0, /[A-Za-z0-9_.\/-]+\.spec\.ts/) { print substr($0, RSTART, RLENGTH) }
  ' "$file" | sort -u | paste -sd, - | sed 's/,/, /g')
  flaky_note=""
  [ "$flaky_count" = "0" ] || flaky_note=", $flaky_count flaky: ${flaky_specs:-see the log}"
  if [ "$code" = "0" ]; then
    echo "${shards:-?} shards, ${passed:-0} passed$flaky_note"
  elif [ "${failed_count:-0}" != "0" ]; then
    echo "$failed_count failed: ${failed_specs:-see the log}$flaky_note"
  else
    echo "the run stopped with exit $code before it reported a failure, see the log"
  fi
}

sha=unknown
finish() {
  local code=$1 summary verdict=green
  summary=$(summarize "$tier_log" "$code")
  # The guard stage, when it ran, decides the night as much as the tier does.
  if [ "$guard_ran" = "1" ]; then
    if [ "$guard_code" = "0" ]; then
      summary="$summary, photo guard passed"
    else
      summary="$summary, photo guard FAILED, see the log"
      [ "$code" != "0" ] || code=1
    fi
  fi
  [ "$code" = "0" ] || verdict=red
  printf '%s %s %s %s\n' "$verdict" "$(date +%Y-%m-%dT%H:%M:%S%z)" "$sha" "$summary" >"$latest"
  keep_logs
  echo "nightly-e2e: $verdict, $summary (log: $log)"
  exit "$code"
}

tier_log=$(mktemp "${TMPDIR:-/tmp}/nightly-e2e.XXXXXX")
trap 'rm -f "$tier_log"' EXIT

{
  echo "── nightly-e2e: $(date -Is) ──"
  if [ "${NIGHTLY_SKIP_RUN:-0}" != "1" ]; then
    if [ ! -d "$worktree" ]; then
      git -C "$repo" worktree add --detach "$worktree" origin/main
    fi
    git -C "$worktree" fetch origin
    git -C "$worktree" checkout --detach origin/main
    git -C "$worktree" log -1 --oneline
  fi
} >>"$log" 2>&1 || {
  echo "the worktree could not be put on origin/main, see the log" >"$tier_log"
  finish 1
}
sha=$(git -C "$worktree" rev-parse --short HEAD 2>/dev/null || echo unknown)

code=0
if [ "${NIGHTLY_SKIP_RUN:-0}" = "1" ]; then
  cat "${NIGHTLY_FAKE_LOG:?NIGHTLY_SKIP_RUN needs NIGHTLY_FAKE_LOG}" >"$tier_log"
  code=${NIGHTLY_FAKE_RC:-0}
  cat "$tier_log" >>"$log"
else
  (
    set -euo pipefail
    if [ "$mode" = "host" ]; then
      use_host_toolchain
    fi
    # One retry: a test that passes on it is reported as flaky, not failed.
    export OPENPLATE_E2E_RETRIES=${OPENPLATE_E2E_RETRIES:-1}
    cd "$worktree/apps/app"
    CI=true pnpm install --frozen-lockfile
    CI=true pnpm build
    # Only the tier's own output is parsed, so it goes to the tier log too.
    CI=true pnpm test:e2e:sharded 2>&1 | tee "$tier_log"
  ) >>"$log" 2>&1 || code=$?
fi
# The pipeline above ends in tee, but `set -o pipefail` is on in the subshell,
# so a failing tier still gives a non-zero code here.

# THE PHOTO PATH GUARD, after the tier and whatever the tier said.
if [ "${NIGHTLY_SKIP_RUN:-0}" = "1" ]; then
  if [ -n "${NIGHTLY_FAKE_GUARD_RC:-}" ]; then
    guard_ran=1
    guard_code=$NIGHTLY_FAKE_GUARD_RC
  fi
else
  guard_ran=1
  (
    set -euo pipefail
    if [ "$mode" = "host" ]; then
      use_host_toolchain
    fi
    cd "$worktree/apps/core"
    CI=true pnpm install --frozen-lockfile
    CI=true TEST_DATABASE_URL="$guard_database_url" pnpm test:guard
  ) >>"$log" 2>&1 || guard_code=$?
fi
finish "$code"
