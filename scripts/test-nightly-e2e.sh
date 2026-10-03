#!/usr/bin/env bash
# Proves the summary line scripts/nightly-e2e.sh writes, from fake tier logs
# (its NIGHTLY_SKIP_RUN seam): no browser, no worktree, no network.
# Cases: green; green with flaky tests (verdict stays green, names listed);
# red with failures; red with failures and flaky. Then it runs itself against
# broken copies and requires every one to FAIL.
#
#   scripts/test-nightly-e2e.sh                 the suite, then the self-test
#   scripts/test-nightly-e2e.sh --no-self-test  the suite only
set -u
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
self=$here/$(basename -- "$0")
SCRIPT=${SCRIPT:-$here/nightly-e2e.sh}
self_test=1
[ "${1:-}" = "--no-self-test" ] && self_test=0
scratch=$(mktemp -d "${TMPDIR:-/tmp}/test-nightly.XXXXXX") || exit 1
trap 'rm -rf "$scratch"' EXIT
failures=0
ok() { echo "ok - $1"; }
not_ok() { echo "not ok - $1"; failures=$((failures + 1)); }

green='── e2e-sharded: 2 shards, 300s wall ──
[shard 1/2] 100 passed (2m)
[shard 2/2] 90 passed (2m)'
flaky='[shard 1/2]   1 flaky
[shard 1/2]     [chromium] › tests/e2e/layout-a.spec.ts:10:5 › holds still
[shard 2/2]   2 flaky
[shard 2/2]     [chromium] › tests/e2e/layout-b.spec.ts:3:1 › other
[shard 2/2]     [chromium] › tests/e2e/layout-a.spec.ts:10:5 › holds still'
failed='[shard 2/2]   1) [chromium] › tests/e2e/bar.spec.ts:3:1 › broken'

# run_case <log text> <exit code>: sets $rc and $line (latest.txt).
run_case() {
  printf '%s\n' "$1" >"$scratch/fake.txt"
  rc=0
  NIGHTLY_SKIP_RUN=1 NIGHTLY_WORKTREE="$here" NIGHTLY_FAKE_LOG="$scratch/fake.txt" NIGHTLY_FAKE_RC=$2 \
    XDG_STATE_HOME="$scratch/state" "$SCRIPT" >/dev/null 2>&1 || rc=$?
  line=$(cat "$scratch/state/openplate/nightly-e2e/latest.txt")
}
expect() {
  local name=$1 want_rc=$2 pattern=$3
  if [ "$rc" = "$want_rc" ] && grep -qE -- "$pattern" <<<"$line"; then ok "$name"; else not_ok "$name: rc $rc, line '$line'"; fi
}

run_case "$green" 0
expect "green: counts passed, no flaky note" 0 '^green .* 2 shards, 190 passed$'
run_case "$green"$'\n'"$flaky" 0
expect "flaky: still green, with the count and each spec once" 0 '^green .* 2 shards, 190 passed, 3 flaky: tests/e2e/layout-a.spec.ts, tests/e2e/layout-b.spec.ts$'
run_case "$green"$'\n'"$failed" 1
expect "failed: red, names the spec, no flaky note" 1 '^red .* 1 failed: tests/e2e/bar.spec.ts$'
run_case "$green"$'\n'"$failed"$'\n'"$flaky" 1
expect "failed and flaky: red, both listed" 1 '^red .* 1 failed: tests/e2e/bar.spec.ts, 3 flaky: tests/e2e/layout-a.spec.ts'

# The nix re-exec decision, with a fake `nix` on PATH and a fake repo, through
# the NIGHTLY_DECIDE_ONLY seam.
fakebin=$scratch/fakebin
mkdir -p "$fakebin"
printf '#!/bin/sh\nexit 0\n' >"$fakebin/nix"
chmod +x "$fakebin/nix"
# decide <nix on PATH: 1|0> <flake.nix: 1|0> [VAR=value...]: prints the decision.
decide() {
  local with_nix=$1 flake=$2 fake=$scratch/repo-$RANDOM
  shift 2
  mkdir -p "$fake/scripts"
  cp "$SCRIPT" "$fake/scripts/nightly-e2e.sh"
  git -C "$fake" init -q 2>/dev/null
  [ "$flake" = 1 ] && : >"$fake/flake.nix"
  local p=$PATH
  [ "$with_nix" = 1 ] && p=$fakebin:$p
  env -u IN_NIX_SHELL -u OPENPLATE_NIGHTLY_IN_NIX PATH="$p" NIGHTLY_DECIDE_ONLY=1 "$@" "$BASH" "$fake/scripts/nightly-e2e.sh" 2>&1
}
expect_decision() {
  if [ "$3" = "$2" ]; then ok "$1"; else not_ok "$1: want '$2', got '$3'"; fi
}
expect_decision "nix: outside a shell with nix and a flake re-executes" reexec "$(decide 1 1)"
expect_decision "nix: no flake.nix stays on the host toolchain" host "$(decide 1 0)"
expect_decision "nix: the loop guard variable stops a second re-exec" nix "$(decide 1 1 OPENPLATE_NIGHTLY_IN_NIX=1)"
expect_decision "nix: already inside nix develop does not re-exec" nix "$(decide 1 1 IN_NIX_SHELL=impure)"
if command -v nix >/dev/null 2>&1; then
  echo "skip - no-nix case: this host has a real nix on PATH"
else
  expect_decision "nix: no nix on PATH stays on the host toolchain" host "$(decide 0 1)"
fi

if [ "$failures" != 0 ]; then echo "FAIL: $failures check(s) failed"; exit 1; fi
echo "PASS: every check passed"
[ "$self_test" = 1 ] || exit 0

mutate() {
  local name=$1 expr=$2 broken=$scratch/broken-$1
  mkdir -p "$broken"
  cp "$here/nightly-e2e.sh" "$broken/nightly-e2e.sh"
  sed -i "$expr" "$broken/nightly-e2e.sh"
  if cmp -s "$broken/nightly-e2e.sh" "$here/nightly-e2e.sh"; then echo "not ok - self-test $name: changed nothing"; exit 1; fi
  local result=0
  SCRIPT=$broken/nightly-e2e.sh "$self" --no-self-test >"$broken/log" 2>&1 || result=$?
  if [ "$result" = 0 ]; then echo "not ok - self-test $name: the suite PASSED a broken script"; exit 1; fi
  echo "ok - self-test $name: the suite fails, as it must"
}
mutate flaky-note-dropped 's#^  \[ "$flaky_count" = "0" \] || flaky_note=.*#  :#'
mutate flaky-makes-red 's#^  \[ "$code" = "0" \] || verdict=red#  [ "$code" = "0" ] \&\& [ "$flaky_note" = "" ] || verdict=red#'
mutate nix-loop-guard-dropped 's#if \[ -n "\$1" \] || \[ -n "\$2" \]; then echo nix; return; fi#:#'
mutate nix-never-reexecs 's#echo reexec; return#echo host; return#'
mutate flaky-block-never-ends 's#inblock = 0#inblock = 1#'
echo "PASS: the self-test caught every broken copy"
