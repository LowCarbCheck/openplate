#!/usr/bin/env bash
# Proves the control flow of scripts/e2e-sharded.sh, with no browser.
#
# `pnpm` is a STUB on PATH that records the shard number, the port base, CI and
# the arguments it was called with, prints Playwright-looking lines, and can
# fail one shard, hold still for a signal, or answer `nproc`. Everything else is
# real: the script, `node --import tsx tests/e2e/print-shard-ports.ts` (so the
# port plan the shards get is the one the tier would use), the process groups,
# the pipes and the signals. It never runs a build, a browser or the real tier.
#
# Cases:
#   * N shards: each gets `--shard=i/N`, its own OPENPLATE_E2E_SHARD, and the
#     planned port base; every shard's output is prefixed; exit 0;
#   * one shard FAILS: the exit code is non-zero, the other shards still run to
#     their end, the summary names the failed shard with its exit code, and
#     that shard's failure report is printed again, the others' are not;
#   * ONE shard is today's run: no `--shard`, no shard variable, no port
#     override, and the stub's own exit code comes straight back;
#   * the default count follows nproc: min(4, nproc / 4), at least 1;
#   * spec file arguments cap the count, and reach every shard;
#   * a bad OPENPLATE_E2E_SHARDS is refused, a taken port stops the run before
#     any shard starts;
#   * SIGTERM to the script reaches every shard as SIGINT first (what Ctrl-C
#     does), every shard process is gone afterwards, and the exit code is 143.
# Then it runs itself again against broken copies of the script and requires
# every one to FAIL: same base for every shard, a failed shard that still exits
# 0, no signal forwarding, a port check that always says free, no cap by spec
# files. A suite that passes a broken runner proves nothing.
#
#   scripts/test-e2e-sharded.sh                 the suite, then the self-test
#   scripts/test-e2e-sharded.sh --no-self-test  the suite only
#
# SCRIPT names the file under test. It defaults to the one beside this script;
# the self-test sets it to the broken copies.
set -u

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P) || exit 1
app=$(dirname -- "$here")
self=$here/$(basename -- "$0")
SCRIPT=${SCRIPT:-$here/e2e-sharded.sh}
self_test=1
[ "${1:-}" = "--no-self-test" ] && self_test=0

# A shell that already names a shard count or a port base would steer every case.
unset OPENPLATE_E2E_SHARDS OPENPLATE_E2E_SHARD OPENPLATE_E2E_PORT_BASE OPENPLATE_E2E_INT_GRACE_SECONDS

command -v node >/dev/null 2>&1 || {
  echo "not ok - node is not on PATH, and this suite runs print-shard-ports.ts for real"
  exit 1
}

scratch=$(mktemp -d "${TMPDIR:-/tmp}/test-e2e-sharded.XXXXXX") || exit 1
runner_pid=""
cleanup() {
  [ -z "$runner_pid" ] || kill "$runner_pid" 2>/dev/null
  local pidfile
  for pidfile in "$scratch"/pids/*; do
    [ -f "$pidfile" ] || continue
    case $pidfile in *.int) continue ;; esac
    kill "$(cat "$pidfile")" 2>/dev/null || true
  done
  rm -rf "$scratch"
}
trap cleanup EXIT

failures=0
ok() { echo "ok - $1"; }
not_ok() {
  echo "not ok - $1"
  failures=$((failures + 1))
}

# ── the script under test, where it finds the real tests/e2e and node_modules ──
# It cds to its own parent folder, so a copy lives in a folder of its own whose
# `tests`, `node_modules` and `package.json` are links to this checkout's.
tree=$scratch/tree
mkdir -p "$tree/scripts"
cp "$SCRIPT" "$tree/scripts/e2e-sharded.sh"
ln -s "$app/tests" "$tree/tests"
ln -s "$app/node_modules" "$tree/node_modules"
ln -s "$app/package.json" "$tree/package.json"
runner=$tree/scripts/e2e-sharded.sh

# ── the stubs ──
stub=$scratch/stub
mkdir -p "$stub" "$scratch/pids"
cat >"$stub/pnpm" <<'STUB'
#!/bin/sh
# Stub pnpm: records its call, prints what Playwright would, and can misbehave.
[ "$1 $2 $3" = "exec playwright test" ] || { echo "stub pnpm: unexpected call: $*" >&2; exit 99; }
shift 3
shard=${OPENPLATE_E2E_SHARD:-none}
printf 'shard=%s base=%s ci=%s args=%s\n' "$shard" "${OPENPLATE_E2E_PORT_BASE:-none}" "${CI:-unset}" "$*" >>"$STUB_LOG"
echo "Running tests in shard $shard"
echo "  ok 1 [phone] > example-$shard.spec.ts:1:1 > passes"
if [ -n "${STUB_HOLD:-}" ]; then
  echo "$$" >"$STUB_PIDS/$shard"
  trap 'echo int >"$STUB_PIDS/$shard.int"; exit 130' INT
  i=0
  while [ "$i" -lt 600 ]; do
    sleep 0.1
    i=$((i + 1))
  done
fi
if [ "${STUB_FAIL_SHARD:-}" = "$shard" ] || [ "${STUB_FAIL_ALL:-0}" = 1 ]; then
  echo "  1) [phone] > failing-$shard.spec.ts:3:1 > breaks"
  echo "     Error: boom in shard $shard"
  exit "${STUB_EXIT:-1}"
fi
echo "  1 passed (1s)"
exit 0
STUB
cat >"$stub/nproc" <<'STUB'
#!/bin/sh
echo "${STUB_NPROC:-16}"
STUB
chmod +x "$stub/pnpm" "$stub/nproc"
export STUB_PIDS=$scratch/pids

# run_runner [VAR=value ...] -- [arguments]: sets $out, $rc and $calls.
run_runner() {
  local vars=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    vars+=("$1")
    shift
  done
  shift
  export STUB_LOG=$scratch/calls
  : >"$STUB_LOG"
  rc=0
  out=$(cd "$tree" && env PATH="$stub:$PATH" "${vars[@]+"${vars[@]}"}" OPENPLATE_E2E_INT_GRACE_SECONDS=3 \
    bash "$runner" "$@" 2>&1) || rc=$?
  calls=$(sort "$STUB_LOG")
}

# How many shards have written their pid down: the files without an .int marker.
count_pid_files() {
  local count=0 file
  for file in "$scratch"/pids/*; do
    [ -f "$file" ] || continue
    case $file in *.int) continue ;; esac
    count=$((count + 1))
  done
  echo "$count"
}

said() { printf '%s\n' "$out" | grep -qF -- "$1"; }
call_count() { printf '%s\n' "$calls" | grep -c '^shard=' || true; }

# The ports the tier would plan for this checkout, read the way the runner reads them.
planned=()
while IFS= read -r base; do planned+=("$base"); done < <(cd "$app" && node --import tsx tests/e2e/print-shard-ports.ts 3)
if [ "${#planned[@]}" -ne 3 ]; then
  echo "not ok - print-shard-ports.ts gave ${#planned[@]} bases for 3 shards"
  exit 1
fi

# ── three shards, all pass ──
run_runner OPENPLATE_E2E_SHARDS=3 --
want_calls=$(printf '%s\n' \
  "shard=1 base=${planned[0]} ci=true args=--shard=1/3 --pass-with-no-tests" \
  "shard=2 base=${planned[1]} ci=true args=--shard=2/3 --pass-with-no-tests" \
  "shard=3 base=${planned[2]} ci=true args=--shard=3/3 --pass-with-no-tests")
if [ "$rc" = 0 ] && [ "$calls" = "$want_calls" ]; then
  ok "three shards: each gets --shard=i/3, its own shard number and its own port base, exit 0"
else
  not_ok "three shards: exit $rc, calls were: $(printf '%s' "$calls" | tr '\n' '|')"
fi
if said "[shard 2/3] Running tests in shard 2" && said "shard 3/3: exit 0 in" && said "every shard passed"; then
  ok "three shards: the output is prefixed per shard and the summary gives each exit code and duration"
else
  not_ok "three shards: prefix or summary missing: $(printf '%s' "$out" | tail -8 | tr '\n' '|')"
fi
ports=$(printf '%s\n' "${planned[@]}" | sort -u | wc -l | tr -d ' ')
if [ "$ports" = 3 ]; then
  ok "three shards: the planned port bases are three different numbers"
else
  not_ok "three shards: the planned port bases are not distinct: ${planned[*]}"
fi

# ── one shard fails ──
run_runner OPENPLATE_E2E_SHARDS=3 STUB_FAIL_SHARD=2 --
if [ "$rc" != 0 ] && [ "$(call_count)" = 3 ] && said "shard 2/3: exit 1 in" && said "(FAILED)" \
  && said "shard 1/3: exit 0 in" && said "shard 3/3: exit 0 in"; then
  ok "one failed shard: exit $rc, the siblings still ran to the end, the summary names shard 2"
else
  not_ok "one failed shard: exit $rc, calls $(call_count): $(printf '%s' "$out" | tail -9 | tr '\n' '|')"
fi
detail=$(printf '%s\n' "$out" | sed -n '/what it reported/,$p')
if printf '%s\n' "$detail" | grep -qF "boom in shard 2" && ! printf '%s\n' "$detail" | grep -qF "boom in shard 1" \
  && ! printf '%s\n' "$detail" | grep -qF "boom in shard 3"; then
  ok "one failed shard: its failure report is printed again, the passing shards' are not"
else
  not_ok "one failed shard: the repeated report is wrong: $(printf '%s' "$detail" | tr '\n' '|')"
fi

# ── the exit code is the shard's own, not the pipe's ──
run_runner OPENPLATE_E2E_SHARDS=2 STUB_FAIL_ALL=1 STUB_EXIT=7 --
if [ "$rc" = 1 ] && said "shard 1/2: exit 7 in" && said "shard 2/2: exit 7 in"; then
  ok "every shard fails: the script exits 1 and each shard's own exit code (7) is in the summary"
else
  not_ok "every shard fails: exit $rc: $(printf '%s' "$out" | tail -6 | tr '\n' '|')"
fi

# ── one shard is today's run ──
run_runner OPENPLATE_E2E_SHARDS=1 -- tests/e2e/a.spec.ts
if [ "$rc" = 0 ] && [ "$calls" = "shard=none base=none ci=true args=tests/e2e/a.spec.ts" ]; then
  ok "one shard: playwright runs directly with no --shard, no shard variable and no port override"
else
  not_ok "one shard: exit $rc, calls were: $(printf '%s' "$calls" | tr '\n' '|')"
fi
run_runner OPENPLATE_E2E_SHARDS=1 STUB_FAIL_ALL=1 STUB_EXIT=7 --
if [ "$rc" = 7 ]; then
  ok "one shard: the exit code of playwright comes back as it is (7)"
else
  not_ok "one shard: exit $rc, wanted playwright's own 7"
fi

# ── the default count follows nproc ──
for row in "16:4" "8:2" "4:1" "3:1" "1:1" "40:4"; do
  cpus=${row%%:*}
  want=${row##*:}
  run_runner STUB_NPROC="$cpus" --
  got=$(call_count)
  if [ "$rc" = 0 ] && [ "$got" = "$want" ]; then
    ok "nproc $cpus: $want shard(s)"
  else
    not_ok "nproc $cpus: wanted $want shard(s), got $got (exit $rc)"
  fi
done
run_runner STUB_NPROC=40 OPENPLATE_E2E_SHARDS=2 --
if [ "$(call_count)" = 2 ]; then
  ok "OPENPLATE_E2E_SHARDS wins over nproc"
else
  not_ok "OPENPLATE_E2E_SHARDS=2 gave $(call_count) shards"
fi

# ── spec files cap the count and reach every shard ──
run_runner OPENPLATE_E2E_SHARDS=4 -- tests/e2e/a.spec.ts tests/e2e/b.spec.ts
if [ "$rc" = 0 ] && [ "$(call_count)" = 2 ] \
  && ! printf '%s\n' "$calls" | grep -v 'args=--shard=[12]/2 --pass-with-no-tests tests/e2e/a.spec.ts tests/e2e/b.spec.ts$' | grep -q .; then
  ok "two spec files: two shards, each given both files"
else
  not_ok "two spec files: exit $rc, calls: $(printf '%s' "$calls" | tr '\n' '|')"
fi

# ── refusals ──
for bad in abc 0 -2 1.5 04; do
  run_runner OPENPLATE_E2E_SHARDS="$bad" --
  if [ "$rc" = 2 ] && said "OPENPLATE_E2E_SHARDS=$bad is not a shard count" && [ "$(call_count)" = 0 ]; then
    ok "OPENPLATE_E2E_SHARDS=$bad is refused before anything starts"
  else
    not_ok "OPENPLATE_E2E_SHARDS=$bad: exit $rc, calls $(call_count)"
  fi
done

node -e '
  const server = require("node:net").createServer((c) => c.end());
  server.listen(Number(process.argv[1]), "127.0.0.1", () => console.log("up"));
  setTimeout(() => process.exit(0), 60000);
' "$((planned[1] + 1))" >"$scratch/listener" &
listener_pid=$!
for _ in $(seq 1 50); do [ -s "$scratch/listener" ] && break; sleep 0.1; done
run_runner OPENPLATE_E2E_SHARDS=3 --
kill "$listener_pid" 2>/dev/null
if [ "$rc" = 1 ] && said "shard 2/3 needs port $((planned[1] + 1))" && said "OPENPLATE_E2E_PORT_BASE" \
  && [ "$(call_count)" = 0 ]; then
  ok "a taken port stops the run before any shard starts and names the variable"
else
  not_ok "taken port: exit $rc, calls $(call_count): $(printf '%s' "$out" | tail -4 | tr '\n' '|')"
fi
run_runner OPENPLATE_E2E_SHARDS=3 --
if [ "$rc" = 0 ] && [ "$(call_count)" = 3 ]; then
  ok "control: with the port free again the same run passes, so the refusal above was the port"
else
  not_ok "control: after the listener stopped the run gave exit $rc and $(call_count) calls"
fi

# ── a signal reaches every shard, INT first, and none is left behind ──
rm -f "$scratch"/pids/*
export STUB_LOG=$scratch/calls
: >"$STUB_LOG"
# Job control, so the background script keeps the default SIGINT: a shell without
# it starts an asynchronous command with SIGINT ignored, and an ignored signal
# cannot be trapped, which is not the situation a person at a terminal is in.
set -m
(cd "$tree" && exec env PATH="$stub:$PATH" STUB_HOLD=1 OPENPLATE_E2E_SHARDS=3 OPENPLATE_E2E_INT_GRACE_SECONDS=3 \
  bash "$runner" >"$scratch/signal.out" 2>&1) &
runner_pid=$!
set +m
for _ in $(seq 1 100); do
  [ "$(count_pid_files)" = 3 ] && break
  sleep 0.1
done
held=$(count_pid_files)
kill -TERM "$runner_pid"
rc=0
wait "$runner_pid" || rc=$?
runner_pid=""
sleep 0.3
alive=0
ints=0
for shard in 1 2 3; do
  [ -f "$scratch/pids/$shard" ] && kill -0 "$(cat "$scratch/pids/$shard")" 2>/dev/null && alive=$((alive + 1))
  [ -f "$scratch/pids/$shard.int" ] && ints=$((ints + 1))
done
if [ "$held" = 3 ] && [ "$rc" = 143 ] && [ "$alive" = 0 ] && [ "$ints" = 3 ]; then
  ok "SIGTERM to the script: every shard got SIGINT first, none is still running, exit 143"
else
  not_ok "signal: held $held, exit $rc, still alive $alive, got SIGINT $ints: $(tail -4 "$scratch/signal.out" | tr '\n' '|')"
fi

# ── result ──
if [ "$failures" != "0" ]; then
  echo "FAIL: $failures check(s) failed"
  exit 1
fi
echo "PASS: every check passed"

[ "$self_test" = "1" ] || exit 0

# ── self-test: a broken runner must fail this suite ──
mutate() {
  local name=$1 expr=$2
  local broken=$scratch/broken-$name.sh
  cp "$here/e2e-sharded.sh" "$broken"
  cp "$broken" "$broken.orig"
  sed -i "$expr" "$broken"
  if cmp -s "$broken" "$broken.orig"; then
    echo "not ok - self-test $name: the mutation changed nothing, fix the sed expression"
    exit 1
  fi
  local result=0
  SCRIPT=$broken "$self" --no-self-test >"$scratch/broken-$name.log" 2>&1 || result=$?
  if [ "$result" = "0" ]; then
    echo "not ok - self-test $name: the suite PASSED a broken runner, it proves nothing"
    exit 1
  fi
  echo "ok - self-test $name: the suite fails ($(grep -c '^not ok' "$scratch/broken-$name.log") check(s)), as it must"
}

mutate same-base 's#"${bases\[index - 1\]}" "\$@"#"${bases[0]}" "$@"#'
mutate hidden-failure 's#failed=1#failed=0#'
mutate no-signal-forwarding 's#^  signal_groups INT$#  :#'
mutate port-always-free 's#^  (exec 3<>"/dev/tcp/127.0.0.1/\$1") 2>/dev/null#  false#'
mutate no-spec-cap 's#shards=\$spec_files#:#'
mutate no-pass-with-no-tests 's# --pass-with-no-tests##'
echo "PASS: the self-test caught every broken copy"
