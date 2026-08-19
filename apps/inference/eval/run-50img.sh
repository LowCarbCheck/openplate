#!/usr/bin/env bash
# 50-image local benchmark, in phases, with a memory/load gate in front of every phase.
#
# Why the gate: the 2026-08-11 attempt was launched onto a workstation that was already busy.
# The model weights got evicted from page cache mid-run and generation collapsed to 0.36 tok/s
# (expected 7.5) while llama-server re-read 1.7 GB/s off the SSD. A run that thrashes does not
# produce a slow measurement -- it produces a meaningless one. So each phase WAITS for the box
# to be free rather than starting and thrashing.
#
# Every phase is resumable: the runner checkpoints results.json after each image x approach and
# skips what it already has, so re-running this script after a kill continues where it stopped.
#
# The cloud baseline phase is NOT here -- it ran standalone on 2026-08-12
# (configs/openrouter-pilot.json --approach baseline -> runs/2026-08-12-50img-cloudbaseline)
# and needs neither local RAM nor the memory gate.
#
# Usage:  ./run-50img.sh            (log with timestamps to stdout; safe to detach)
#         nohup ./run-50img.sh > runs/50img.log 2>&1 &
set -euo pipefail

EVAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$EVAL_DIR"

# Memory headroom required before a phase may start, in MB. Measured RSS is 6.31 GB for qwen-vl
# and 4.4 GB for the co-resident lfm-vl + lfm-judge pair (PERFORMANCE.md §4); these thresholds
# add the headroom that keeps the weights in page cache instead of being re-read per token.
QWEN_MIN_AVAIL_MB=9216   # ~9 GB
LFM_MIN_AVAIL_MB=6144    # ~6 GB
MAX_LOAD1=10             # 1-minute load average ceiling
WAIT_INTERVAL=300        # re-check every 5 min
# Two-level scheme. The values above are the *phase-start* gate: nothing is loaded yet, so the
# whole model must still fit. RUNNER_MIN_AVAIL_MB is the *mid-run* tripwire passed to the runner
# (--min-avail-mb) and checked before every image: by then the weights are already resident, so
# 2 GB of remaining headroom is what "something else started eating the box" looks like. The
# start gate alone missed exactly that on 2026-08-12, when an unrelated benchmark landed mid-run
# and the OOM killer wedged the whole workstation.
RUNNER_MIN_AVAIL_MB=2048 # ~2 GB -- passed as --min-avail-mb to every phase's runner

log() { printf '%s | %s\n' "$(date -Is)" "$*"; }

mem_available_mb() {
  awk '/^MemAvailable:/ {print int($2/1024); exit}' /proc/meminfo
}

load1() {
  awk '{print $1; exit}' /proc/loadavg
}

# Block until the box has both the RAM headroom and the idle CPU this phase needs.
wait_for_resources() {
  local phase="$1" min_mb="$2"
  while :; do
    local avail load reason=""
    avail="$(mem_available_mb)"
    load="$(load1)"
    if (( avail < min_mb )); then
      reason="MemAvailable ${avail}MB < required ${min_mb}MB"
    elif awk -v l="$load" -v m="$MAX_LOAD1" 'BEGIN {exit !(l > m)}'; then
      reason="load1 ${load} > ceiling ${MAX_LOAD1}"
    fi
    if [[ -z "$reason" ]]; then
      log "[$phase] gate PASS: MemAvailable ${avail}MB (need ${min_mb}MB), load1 ${load}"
      return 0
    fi
    log "[$phase] gate WAIT: $reason -- not starting servers; re-checking in ${WAIT_INTERVAL}s"
    sleep "$WAIT_INTERVAL"
  done
}

run_phase() {
  # run_phase <phase-name> <min-avail-mb> <serve-key>... -- <runner-arg>...
  local phase="$1" min_mb="$2"; shift 2
  local keys=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do keys+=("$1"); shift; done
  shift  # drop the --

  log "[$phase] starting phase"
  wait_for_resources "$phase" "$min_mb"

  local key
  for key in "${keys[@]}"; do
    log "[$phase] starting server: $key"
    ./serve/serve.sh "$key"
  done

  log "[$phase] runner: $*"
  local rc=0
  python3 -m harness.runner "$@" || rc=$?
  log "[$phase] runner exited rc=$rc"

  log "[$phase] stopping servers"
  ./serve/serve.sh stop all || true
  log "[$phase] MemAvailable after stop: $(mem_available_mb)MB"
  return "$rc"
}

log "run-50img starting; MemAvailable $(mem_available_mb)MB, load1 $(load1)"
./serve/serve.sh stop all || true

# Phase 1 -- qwen-vl alone (6.31 GB RSS; cannot co-reside with a judge).
run_phase qwenvl "$QWEN_MIN_AVAIL_MB" qwen-vl -- \
  --config configs/local-cpu-v2.json --approach single_qwen_vl \
  --out runs/2026-08-12-50img-qwenvl --min-avail-mb "$RUNNER_MIN_AVAIL_MB" \
  || log "[qwenvl] phase FAILED -- continuing to next phase"

# Phase 2 -- lfm-vl single.
run_phase lfmvl "$LFM_MIN_AVAIL_MB" lfm-vl -- \
  --config configs/local-cpu.json --approach single_lfm_vl \
  --out runs/2026-08-12-50img-lfmvl --min-avail-mb "$RUNNER_MIN_AVAIL_MB" \
  || log "[lfmvl] phase FAILED -- continuing to next phase"

# Phase 3 -- lfm-vl + lfm-judge co-resident, n=3 ensemble (4.4 GB pair).
run_phase ens3 "$LFM_MIN_AVAIL_MB" lfm-vl lfm-judge -- \
  --config configs/local-cpu.json --approach ensemble_lfm --fan-out 3 \
  --out runs/2026-08-12-50img-ens3 --min-avail-mb "$RUNNER_MIN_AVAIL_MB" \
  || log "[ens3] phase FAILED"

log "RUN_50_DONE"
