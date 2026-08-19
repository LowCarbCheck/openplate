#!/bin/sh
# Behavioural smoke test for the entrypoint's mode handling (MODEL_PROFILE=external).
#
# WHY A SHELL SMOKE TEST. The mode switch lives in scripts/docker-entrypoint.sh
# and nowhere else: MODEL_PROFILE never reaches src/config.ts, so vitest cannot
# see any of this. The repo has no shell test harness, so this script is it.
#
# HOW IT AVOIDS DOCKER. The entrypoint calls `node /app/dist/server.js` and
# `llama-server`, both resolved through PATH. Point PATH at a stub directory and
# the whole thing runs on the host in under a second — and, critically, the stub
# llama-server records the fact that it was called, which is the one assertion
# that cannot be made by reading the script.
#
# Run: sh scripts/smoke-external.sh   (exit 0 = all cases pass)
set -eu

cd "$(dirname "$0")/.."
ENTRYPOINT="$(pwd)/scripts/docker-entrypoint.sh"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

BIN="$WORK/bin"
mkdir -p "$BIN"

# Stub llama-server: records that it ran, then idles so supervision sees it live.
cat > "$BIN/llama-server" <<STUB
#!/bin/sh
echo "\$@" > "$WORK/llama-server.called"
sleep 30
STUB

# Stub node: records the MODEL_RUNTIME_URL it was handed — the value the real
# service would read — then idles.
cat > "$BIN/node" <<STUB
#!/bin/sh
printf '%s' "\${MODEL_RUNTIME_URL:-<unset>}" > "$WORK/service.runtime-url"
sleep 30
STUB

chmod +x "$BIN/llama-server" "$BIN/node"

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1" >&2; }

# Runs the entrypoint to completion, capturing status and stderr. Used for the
# cases that are expected to exit during stage 0.
run_expecting_exit() {
  set +e
  env -i PATH="$BIN:/usr/bin:/bin" HOME="$WORK" "$@" sh "$ENTRYPOINT" \
    >"$WORK/out" 2>"$WORK/err"
  STATUS=$?
  set -e
}

echo "smoke-external: entrypoint mode handling"

# ---------------------------------------------------------------------------
# Case 1 — external mode with no MODEL_RUNTIME_URL must fail fast.
# ---------------------------------------------------------------------------
echo "case 1: MODEL_PROFILE=external without MODEL_RUNTIME_URL"
run_expecting_exit MODEL_PROFILE=external
if [ "$STATUS" -ne 0 ]; then
  pass "exits non-zero (status $STATUS)"
else
  fail "expected a non-zero exit, got 0"
fi
if grep -q "MODEL_RUNTIME_URL" "$WORK/err" && grep -q "MODEL_PROFILE=external" "$WORK/err"; then
  pass "error names both variables"
else
  fail "error must name MODEL_RUNTIME_URL and MODEL_PROFILE=external"
fi
if [ ! -f "$WORK/llama-server.called" ]; then
  pass "no llama-server started"
else
  fail "llama-server was started"
fi

# ---------------------------------------------------------------------------
# Case 2 — a bundled profile plus a foreign MODEL_RUNTIME_URL is a conflict.
# Without this the address is silently discarded and the container downloads
# several GB of weights the operator never asked for.
# ---------------------------------------------------------------------------
echo "case 2: bundled profile + foreign MODEL_RUNTIME_URL"
run_expecting_exit MODEL_PROFILE=lite MODEL_RUNTIME_URL=http://elsewhere.example:9999
if [ "$STATUS" -ne 0 ]; then
  pass "exits non-zero (status $STATUS)"
else
  fail "expected a non-zero exit, got 0"
fi
if grep -q "MODEL_PROFILE=external" "$WORK/err" && grep -q "unset MODEL_RUNTIME_URL" "$WORK/err"; then
  pass "error names both remedies"
else
  fail "error must offer both remedies (set external / unset the URL)"
fi
# Case 3 below asserts the ABSENCE of this string. Proving it exists here is
# what stops that negative assertion from silently going vacuous if the error
# is ever reworded.
if grep -q "Conflicting configuration" "$WORK/err"; then
  pass "conflict is reported with the string case 3 checks for"
else
  fail "expected the literal 'Conflicting configuration' (case 3 depends on it)"
fi
if [ ! -f "$WORK/llama-server.called" ]; then
  pass "no weights fetched, no llama-server started"
else
  fail "llama-server was started"
fi

# ---------------------------------------------------------------------------
# Case 3 — the SAME address bundled mode would use is not a conflict.
# .env.example ships `MODEL_RUNTIME_URL=http://127.0.0.1:8080` uncommented, so
# an operator passing that file as env_file to set API_KEYS must not be blocked
# for a value that changes nothing. (It still fails later on the absent /app —
# the assertion is only that it got PAST the conflict check.)
# ---------------------------------------------------------------------------
echo "case 3: bundled profile + the bundled address (harmless)"
run_expecting_exit MODEL_PROFILE=lite MODEL_RUNTIME_URL=http://127.0.0.1:8080
if grep -q "Conflicting configuration" "$WORK/err"; then
  fail "the bundled address was wrongly rejected as a conflict"
else
  pass "not treated as a conflict"
fi
# Belt and braces: 4 is the stage-0 config-error exit. Anything else means it
# got PAST the conflict check (here it then dies on the absent /app, exit 127),
# which is the actual claim. Without this, a crash before stage 0 would also
# produce empty stderr and pass the negative grep above.
if [ "$STATUS" -ne 4 ]; then
  pass "reached past the stage-0 config checks (exit $STATUS)"
else
  fail "exited 4 — it was rejected at stage 0 after all"
fi

# ---------------------------------------------------------------------------
# Case 4 — external mode starts the service ALONE, pointed at the operator's
# address. This is the case the whole spec exists for.
# ---------------------------------------------------------------------------
echo "case 4: MODEL_PROFILE=external with a runtime address"
rm -f "$WORK/llama-server.called" "$WORK/service.runtime-url"
env -i PATH="$BIN:/usr/bin:/bin" HOME="$WORK" \
  MODEL_PROFILE=external MODEL_RUNTIME_URL=http://runtime.example:8080 \
  sh "$ENTRYPOINT" >"$WORK/out" 2>"$WORK/err" &
ENTRY_PID=$!

# Poll rather than sleep-and-hope: the service stub writes its file immediately.
WAITED=0
while [ ! -f "$WORK/service.runtime-url" ] && [ "$WAITED" -lt 50 ]; do
  sleep 0.1
  WAITED=$((WAITED + 1))
done

if [ -f "$WORK/service.runtime-url" ]; then
  pass "service started"
else
  fail "service never started (see below)"
  cat "$WORK/err" >&2
fi

if [ ! -f "$WORK/llama-server.called" ]; then
  pass "no llama-server started — the operator's runtime is not ours to run"
else
  fail "llama-server was started in external mode"
fi

GOT=$(cat "$WORK/service.runtime-url" 2>/dev/null || echo "<none>")
if [ "$GOT" = "http://runtime.example:8080" ]; then
  pass "service points at the operator's address"
else
  fail "service points at '$GOT', expected http://runtime.example:8080"
fi

# The container must still die when the service does — supervision has to hold
# with only one supervised process.
kill -TERM "$ENTRY_PID" 2>/dev/null || true
set +e
wait "$ENTRY_PID" 2>/dev/null
TERM_STATUS=$?
set -e
if grep -q "signal received" "$WORK/out"; then
  pass "shuts down cleanly on TERM with no runtime child"
else
  fail "TERM did not reach the supervision trap"
fi
if [ "$TERM_STATUS" -eq 0 ]; then
  pass "a signalled shutdown exits 0"
else
  fail "signalled shutdown exited $TERM_STATUS, expected 0"
fi

# ---------------------------------------------------------------------------
# Case 5 — external mode: if the SERVICE dies the container must die too, and
# with a non-zero status. Supervision has one process to watch here instead of
# two, and "exits 0 when it should not" is the failure that would let an
# orchestrator think a dead container was a clean stop.
# ---------------------------------------------------------------------------
echo "case 5: external mode, service exits on its own"
DYING="$WORK/dying"
mkdir -p "$DYING"
cat > "$DYING/node" <<STUB
#!/bin/sh
sleep 0.2
exit 7
STUB
cp "$BIN/llama-server" "$DYING/llama-server"
chmod +x "$DYING/node" "$DYING/llama-server"
rm -f "$WORK/llama-server.called"

set +e
env -i PATH="$DYING:/usr/bin:/bin" HOME="$WORK" \
  MODEL_PROFILE=external MODEL_RUNTIME_URL=http://runtime.example:8080 \
  sh "$ENTRYPOINT" >"$WORK/out5" 2>"$WORK/err5"
DEATH_STATUS=$?
set -e

if [ "$DEATH_STATUS" -ne 0 ]; then
  pass "container exits non-zero when the service dies (status $DEATH_STATUS)"
else
  fail "container exited 0 after the service died"
fi
if grep -q "openplate-inference exited" "$WORK/out5" "$WORK/err5"; then
  pass "names the process that died"
else
  fail "shutdown did not say which process died"
fi

echo ""
echo "smoke-external: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
