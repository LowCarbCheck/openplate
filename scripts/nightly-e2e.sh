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
# node from nvm and pnpm from ~/.local/share/pnpm, because Chromium cannot start
# in the ts-dev toolbox.
#
# WHAT IT WRITES, under ${XDG_STATE_HOME:-~/.local/state}/openplate/nightly-e2e/:
#   <YYYY-MM-DD>.log   the whole run; the newest 14 are kept
#   latest.txt         one line: green|red <ISO datetime> <sha> <summary>
# The exit code is non-zero on red. A red night blocks nothing by itself.
#
# Test seams: NIGHTLY_WORKTREE names another worktree path and NIGHTLY_SKIP_RUN=1
# skips the install, build and tier (the caller then supplies NIGHTLY_FAKE_LOG, a
# file used instead of the tier's output, and NIGHTLY_FAKE_RC its exit code), so
# the summary parsing can be tried without a browser.
set -euo pipefail

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
repo=$(git -C "$script_dir" rev-parse --show-toplevel)
worktree=${NIGHTLY_WORKTREE:-$(dirname -- "$repo")/op-nightly}
state_dir=${XDG_STATE_HOME:-$HOME/.local/state}/openplate/nightly-e2e
mkdir -p "$state_dir"
log=$state_dir/$(date +%F).log
latest=$state_dir/latest.txt

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
  local file=$1 code=$2 shards passed failed_specs failed_count
  shards=$(sed -nE 's/.*e2e-sharded: ([0-9]+) shards.*/\1/p' "$file" | tail -n 1)
  passed=$(grep -oE '[0-9]+ passed' "$file" | grep -oE '[0-9]+' | awk '{ sum += $1 } END { print sum + 0 }' || true)
  failed_specs=$(grep -E '^\[shard [0-9]+/[0-9]+\] +[0-9]+\) ' "$file" | grep -oE '[A-Za-z0-9_./-]+\.spec\.ts' | sort -u | paste -sd, - | sed 's/,/, /g' || true)
  failed_count=$(grep -E '^\[shard [0-9]+/[0-9]+\] +[0-9]+\) ' "$file" | sort -u | wc -l | tr -d ' ')
  if [ "$code" = "0" ]; then
    echo "${shards:-?} shards, ${passed:-0} passed"
  elif [ "${failed_count:-0}" != "0" ]; then
    echo "$failed_count failed: ${failed_specs:-see the log}"
  else
    echo "the run stopped with exit $code before it reported a failure, see the log"
  fi
}

sha=unknown
finish() {
  local code=$1 summary verdict=green
  summary=$(summarize "$tier_log" "$code")
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
    export NVM_DIR=$HOME/.config/nvm
    # nvm.sh reads variables it never sets, which `set -u` would reject.
    set +u
    . "$NVM_DIR/nvm.sh"
    nvm use 24.8.0
    set -u
    export PATH=$HOME/.local/share/pnpm:$PATH
    cd "$worktree/apps/app"
    CI=true pnpm install --frozen-lockfile
    CI=true pnpm build
    # Only the tier's own output is parsed, so it goes to the tier log too.
    CI=true pnpm test:e2e:sharded 2>&1 | tee "$tier_log"
  ) >>"$log" 2>&1 || code=$?
fi
# The pipeline above ends in tee, but `set -o pipefail` is on in the subshell,
# so a failing tier still gives a non-zero code here.
finish "$code"
