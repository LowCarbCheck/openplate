#!/usr/bin/env bash
# The browser smoke tier, run as N Playwright processes at once.
#
#   scripts/e2e-sharded.sh [playwright arguments or spec files...]
#   pnpm test:e2e:sharded [playwright arguments or spec files...]
#
# WHY. The tier is 141 spec files and 527 tests behind `workers: 1`, 22 minutes
# on a loaded 16-core host, and every one of those minutes is spent in ONE
# browser. `workers: 1` is not a tuning knob: every spec drives one origin's
# IndexedDB and localStorage, and the fixture account on the fake core server is
# one shared row. So the config stays serial, and this script parallelises
# whole PROCESSES instead: N copies of `playwright test`, each with
# `--shard=i/N`, each a complete tier with nothing shared with its siblings.
#
# WHAT EACH SHARD OWNS (read from the code, not assumed; ADR-0017 has the
# reasoning and `scripts/repro-e2e-shard-isolation.sh` proves it):
#   * three ports: `OPENPLATE_E2E_PORT_BASE` is the derived base plus 3 * (i - 1)
#     (`tests/e2e/env.ts`, `shardPortBase`), so the triples of one run are
#     disjoint by construction. Every port of every shard is checked free
#     BEFORE anything starts, and a taken one stops the run with the variable's
#     name.
#   * the fake core server and the fixture account: started by that process's
#     own `globalSetup`, held in that process's memory.
#   * the fontconfig cache: `globalSetup` wipes it, so a shard reads a copy of
#     `fonts.conf` that names a directory of its own (`tests/e2e/font-cache.ts`).
#   * Playwright's output folder: it empties it at the start of a run, so a
#     shard writes to `test-results/shard-<i>` (`playwright.config.ts`). The two
#     reports two specs write into `test-results/` itself are cleared once here.
# `OPENPLATE_E2E_SHARD=<i>` is what tells those three places which shard they
# are. A spec's own free-port picks (`managed-app-server.ts`) come from the
# kernel and so differ per process; no spec or helper names a file or a port.
#
# HOW MANY. `OPENPLATE_E2E_SHARDS` if it is set, else min(4, nproc / 4), and at
# least 1. A browser, a server and a fake service per shard is real memory and
# CPU, and a gate run is already one of several things on a busy host, so the
# default stays modest. With ONE shard this script runs `playwright test`
# directly and sets nothing, which is the run this tier always was. When the
# arguments name spec files (the scoped tier, `tests/e2e/scope.ts`) there are
# never more shards than files.
#
# WHAT IT DOES NOT HIDE.
#   * Each shard's output streams live with a `[shard i/N]` prefix, and goes to
#     a log file as well. After the last shard exits, every FAILED shard's
#     failure report is printed again, in shard order, without the prefix.
#   * A shard's exit code is written to a file by the shard itself, because the
#     pipe that prefixes its output would otherwise be the only status left.
#     `wait` is called on every pipeline and the files are what is read.
#   * The exit code is 1 when ANY shard did not exit 0, including one that
#     was killed before it could say so. A summary prints each shard's exit
#     code and how long it took, and the wall time of the whole run.
#   * A shard is never retried and never skipped because a sibling failed:
#     every shard runs to its own end, so one run reports every failure.
#
# SIGNALS. Job control is on, so every shard is the leader of a process group of
# its own. On INT, TERM or HUP this script sends each group SIGINT first, which
# is what Ctrl-C does to a plain Playwright run and is the path that stops its
# web server and browser; then SIGTERM, then SIGKILL, with a grace period
# before each. It never kills by name (`pkill -f playwright` would reach other
# people's runs on this host, the thing the derived ports exist to allow).
# A SIGKILL of this script itself cannot be handled and leaves the shards to
# finish alone.
#
# It runs on the HOST, like the browser stage of `.githooks/pre-push`: the
# ts-dev toolbox has no Chromium. `scripts/test-e2e-sharded.sh` proves this
# file's control flow (shard count, per-shard environment, exit codes, signals)
# against a stub `pnpm`, without a browser.
set -u

# ── Settings ────────────────────────────────────────────────────────────────

# The most shards chosen without being asked, and how many CPUs each is given.
readonly MAX_DEFAULT_SHARDS=4
readonly CPUS_PER_SHARD=4

# How long a shard gets to stop after each signal before the next, harder one.
# The first is a variable only so that scripts/test-e2e-sharded.sh need not wait
# twenty seconds to watch the escalation.
readonly INT_GRACE_SECONDS=${OPENPLATE_E2E_INT_GRACE_SECONDS:-20}
readonly TERM_GRACE_SECONDS=5

# What the failure report falls back to when a log has no numbered failure.
readonly FALLBACK_TAIL_LINES=60

APP_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P) || exit 1
readonly APP_DIR
cd "$APP_DIR" || exit 1

readonly PW=(pnpm exec playwright test)

# ── Helpers ─────────────────────────────────────────────────────────────────

cpu_count() {
  local count
  count=$(nproc 2>/dev/null) || count=$(getconf _NPROCESSORS_ONLN 2>/dev/null) \
    || count=$(sysctl -n hw.ncpu 2>/dev/null) || count=1
  case $count in '' | *[!0-9]*) count=1 ;; esac
  echo "$count"
}

# Whether something already answers on a loopback port. A bash redirection to
# /dev/tcp connects, and fails when nothing listens; a bash built without it
# fails the same way, which reads as "free", and Playwright's own check and the
# fake services' bind errors are still behind this one.
port_is_taken() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# The two helpers at the end of a shard's pipeline IGNORE the stop signals. The
# signals go to the shard's whole process group, and a `tee` that died of SIGINT
# first would leave Playwright writing its shutdown report into a closed pipe in
# the middle of tearing down its web server. They end on their own when the
# shard closes its output.
tee_log() {
  trap '' INT TERM HUP
  tee "$1"
}

prefix_lines() {
  trap '' INT TERM HUP
  awk -v prefix="$1" '{ print prefix $0; fflush() }'
}

format_duration() {
  local total=$1
  if [ "$total" -ge 60 ]; then
    printf '%dm%02ds' $((total / 60)) $((total % 60))
  else
    printf '%ds' "$total"
  fi
}

# ── How many shards ─────────────────────────────────────────────────────────

if [ -n "${OPENPLATE_E2E_SHARDS:-}" ]; then
  case $OPENPLATE_E2E_SHARDS in
    *[!0-9]* | 0 | 0[0-9]*)
      echo "✖ e2e-sharded: OPENPLATE_E2E_SHARDS=$OPENPLATE_E2E_SHARDS is not a shard count: use a whole number of 1 or more."
      exit 2
      ;;
  esac
  shards=$OPENPLATE_E2E_SHARDS
else
  shards=$(($(cpu_count) / CPUS_PER_SHARD))
  [ "$shards" -le "$MAX_DEFAULT_SHARDS" ] || shards=$MAX_DEFAULT_SHARDS
fi
[ "$shards" -ge 1 ] || shards=1

# The scoped tier passes spec files. Fewer files than shards would start shards
# with nothing to run, each paying a server boot to say so.
spec_files=0
for argument in "$@"; do
  case $argument in *.spec.ts) spec_files=$((spec_files + 1)) ;; esac
done
if [ "$spec_files" -gt 0 ] && [ "$shards" -gt "$spec_files" ]; then
  shards=$spec_files
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "✖ e2e-sharded: pnpm is not on PATH. Run this from the host shell, the ts-dev toolbox has no Chromium."
  exit 1
fi

# ONE SHARD IS TODAY'S RUN: no shard variable, no port override, no extra flag.
if [ "$shards" = 1 ]; then
  echo "▶ e2e-sharded: 1 shard, running the tier as one Playwright process"
  CI=true exec "${PW[@]}" "$@"
fi

# ── The plan: every shard's ports, checked before anything starts ───────────

bases=()
while IFS= read -r base; do
  bases+=("$base")
done < <(node --import tsx tests/e2e/print-shard-ports.ts "$shards")
if [ "${#bases[@]}" -ne "$shards" ]; then
  echo "✖ e2e-sharded: tests/e2e/print-shard-ports.ts gave ${#bases[@]} port bases for $shards shards."
  exit 1
fi

for ((index = 1; index <= shards; index++)); do
  base=${bases[index - 1]}
  for port in "$base" $((base + 1)) $((base + 2)); do
    if port_is_taken "$port"; then
      echo "✖ e2e-sharded: shard $index/$shards needs port $port and something on this host already listens on it."
      echo "  Look with 'ss -ltnp | grep :$port'. If another checkout's run holds it, set OPENPLATE_E2E_PORT_BASE"
      echo "  (a whole number from 1024 up) to move this run; shard 1 takes it as its base and the rest follow."
      exit 1
    fi
  done
  echo "▪ e2e-sharded: shard $index/$shards ports $base (food database), $((base + 1)) (sync), $((base + 2)) (app)"
done

# ── Start every shard ───────────────────────────────────────────────────────

work=$(mktemp -d "${TMPDIR:-/tmp}/openplate-e2e-shards-XXXXXX") || exit 1
pids=()
pgids=()
stopping=0

# The reports two specs write into test-results/ itself are not Playwright
# output, so the per-shard output folders do not clear them. A plain run does,
# because Playwright empties test-results/; this keeps that.
rm -rf test-results

group_is_alive() {
  kill -0 -- "-$1" 2>/dev/null
}

all_groups_gone() {
  local pgid
  for pgid in ${pgids[@]+"${pgids[@]}"}; do
    if group_is_alive "$pgid"; then return 1; fi
  done
  return 0
}

signal_groups() {
  local signal=$1 pgid
  for pgid in ${pgids[@]+"${pgids[@]}"}; do
    kill "-$signal" -- "-$pgid" 2>/dev/null || true
  done
}

wait_for_groups() {
  local limit=$1 waited=0
  while [ "$waited" -lt "$limit" ]; do
    if all_groups_gone; then return 0; fi
    sleep 1
    waited=$((waited + 1))
  done
  all_groups_gone
}

stop_shards() {
  local reason=$1
  [ "$stopping" = 0 ] || return 0
  stopping=1
  echo "▪ e2e-sharded: $reason, stopping every shard (SIGINT first, as Ctrl-C does)"
  signal_groups INT
  wait_for_groups "$INT_GRACE_SECONDS" && return 0
  echo "▪ e2e-sharded: a shard is still running, sending SIGTERM"
  signal_groups TERM
  wait_for_groups "$TERM_GRACE_SECONDS" && return 0
  echo "▪ e2e-sharded: a shard is still running, sending SIGKILL"
  signal_groups KILL
  return 0
}

cleanup() {
  rm -rf "$work"
}

on_signal() {
  local name=$1 code=$2
  stop_shards "$name received"
  cleanup
  trap - EXIT
  exit "$code"
}

trap 'on_signal INT 130' INT
trap 'on_signal TERM 143' TERM
trap 'on_signal HUP 129' HUP
trap cleanup EXIT

# Job control makes every background pipeline the leader of its own process
# group, which is what lets a signal reach a shard and its children and nothing
# else. It is also why a shard needs stdin from /dev/null: a background group
# that reads the terminal would be stopped.
set -m

launch_shard() {
  local index=$1 count=$2 base=$3
  shift 3
  local log=$work/shard-$index.log status=$work/shard-$index.status
  (
    started=$(date +%s)
    code=0
    CI=true OPENPLATE_E2E_SHARD=$index OPENPLATE_E2E_PORT_BASE=$base \
      "${PW[@]}" "--shard=$index/$count" --pass-with-no-tests "$@" </dev/null || code=$?
    echo "$code $(($(date +%s) - started))" >"$status"
  ) 2>&1 | tee_log "$log" | prefix_lines "[shard $index/$count] " &
  pids[index]=$!
  pgids[index]=$(ps -o pgid= -p "${pids[index]}" 2>/dev/null | tr -d ' ')
}

run_started=$(date +%s)
echo "▶ e2e-sharded: $shards shards of the browser tier, output prefixed per shard"
for ((index = 1; index <= shards; index++)); do
  launch_shard "$index" "$shards" "${bases[index - 1]}" "$@"
done

# ── Wait for every shard, then read what each one wrote down ────────────────

for ((index = 1; index <= shards; index++)); do
  wait "${pids[index]}" 2>/dev/null
done
run_seconds=$(($(date +%s) - run_started))

# From here on a signal has nothing left to stop.
set +m

failed=0
echo
echo "── e2e-sharded: $shards shards, ${run_seconds}s wall ──"
for ((index = 1; index <= shards; index++)); do
  status_file=$work/shard-$index.status
  code=""
  seconds=0
  if [ -s "$status_file" ]; then
    read -r code seconds <"$status_file"
  fi
  case $code in
    0)
      echo "  shard $index/$shards: exit 0 in $(format_duration "$seconds")"
      ;;
    '')
      echo "  shard $index/$shards: NO EXIT STATUS, it was stopped before it could report (counted as failed)"
      failed=1
      ;;
    *)
      echo "  shard $index/$shards: exit $code in $(format_duration "$seconds") (FAILED)"
      failed=1
      ;;
  esac
done

if [ "$failed" = 0 ]; then
  echo "✅ e2e-sharded: every shard passed"
  exit 0
fi

# The failure reports again, shard by shard, so nobody has to untangle four
# interleaved streams: Playwright numbers its failures from "  1) ", and that
# line to the end of the log is the report. A log with no numbered failure (a
# crash before the first test) falls back to its tail.
for ((index = 1; index <= shards; index++)); do
  status_file=$work/shard-$index.status
  code=""
  [ -s "$status_file" ] && read -r code _ <"$status_file"
  [ "$code" = 0 ] && continue
  log=$work/shard-$index.log
  echo
  echo "── e2e-sharded: shard $index/$shards, what it reported ──"
  if grep -q '^  1) ' "$log" 2>/dev/null; then
    sed -n '/^  1) /,$p' "$log"
  else
    tail -n "$FALLBACK_TAIL_LINES" "$log"
  fi
done
echo
echo "✖ e2e-sharded: at least one shard failed"
exit 1
