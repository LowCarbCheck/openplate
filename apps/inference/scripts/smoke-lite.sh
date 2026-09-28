#!/usr/bin/env bash
# CPU-only end-to-end smoke test of the `lite` profile.
#
# This is the check behind the README's central claim — "it runs on a machine
# with no GPU, no CUDA, and no call to anybody's API". It is an integration test,
# not a unit test, so it does the real thing:
#
#   1. builds the image from this repo (CPU base, no CUDA)
#   2. runs it with a named volume and a published port, no --gpus
#   3. scrapes the first-boot API key out of the container's own log
#   4. waits for /readyz 200 — through the weight download AND the model load
#   5. POSTs eval/images/01.jpg to /v1/chat/completions
#   6. asserts the response is a schema-shaped PlateIdentification
#   7. asserts at least one item resolved macros from the bundled food corpus
#      (provenance "corpus"), which is what proves the FDC dataset actually
#      shipped in the image and is readable from the service's working
#      directory. A container that boots fine and silently returns every plate
#      with null macros is the failure this assertion exists to catch.
#
# FIRST RUN DOWNLOADS ~2.0 GiB of weights and can take a long time on CPU. The
# volume is reused, so the second run is minutes. Nothing is left running.
#
# Environment:
#   ENGINE          docker | podman            (default: whichever is on PATH)
#   IMAGE           image tag to build/use     (default: openplate-inference:smoke)
#   VOLUME          weights volume name        (default: openplate-inference-smoke-models)
#   HOST_PORT       published port             (default: 18300)
#   READY_TIMEOUT   seconds to wait for /readyz (default: 3600)
#   SCAN_TIMEOUT    seconds to wait for one scan (default: 600)
#   KEEP=1          leave the container running for inspection
#   SKIP_BUILD=1    reuse an existing $IMAGE
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$PWD"

ENGINE="${ENGINE:-}"
if [ -z "$ENGINE" ]; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    ENGINE=docker
  elif command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
    ENGINE=podman
  else
    echo "✖ smoke: no reachable docker or podman daemon." >&2
    echo "  Start one, or set ENGINE=<docker|podman> if it lives somewhere unusual." >&2
    exit 1
  fi
fi

IMAGE="${IMAGE:-openplate-inference:smoke}"
VOLUME="${VOLUME:-openplate-inference-smoke-models}"
HOST_PORT="${HOST_PORT:-18300}"
READY_TIMEOUT="${READY_TIMEOUT:-3600}"
SCAN_TIMEOUT="${SCAN_TIMEOUT:-600}"
CONTAINER="openplate-inference-smoke-$$"
IMAGE_FILE="$REPO_ROOT/eval/images/01.jpg"
BASE="http://127.0.0.1:$HOST_PORT"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
pass() { printf '\033[32m✅ %s\033[0m\n' "$*"; }

[ -f "$IMAGE_FILE" ] || fail "test image missing: $IMAGE_FILE"
command -v python3 >/dev/null 2>&1 || fail "python3 is required (base64 + JSON assertions)"

LOG_FILE="$(mktemp)"
cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then
    echo "▶ KEEP=1 — leaving $CONTAINER running on $BASE"
    return
  fi
  "$ENGINE" rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

step "engine: $ENGINE  image: $IMAGE  volume: $VOLUME  port: $HOST_PORT"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  step "building the CPU image (no CUDA base, no weights in any layer)"
  "$ENGINE" build -t "$IMAGE" "$REPO_ROOT" || fail "image build failed"
  pass "image built"
fi

step "starting the container — CPU ONLY (no --gpus, no device passthrough)"
"$ENGINE" run -d \
  --name "$CONTAINER" \
  -p "127.0.0.1:$HOST_PORT:8300" \
  -v "$VOLUME:/models" \
  -e MODEL_PROFILE=lite \
  "$IMAGE" >/dev/null || fail "container failed to start"

# ---------------------------------------------------------------------------
# The boot-generated key. src/main.ts prints it once, to stdout, when API_KEYS
# is unset — which is exactly the path a first-time self-hoster takes, so the
# smoke test uses it rather than pinning a key of its own.
# ---------------------------------------------------------------------------
step "waiting for the first-boot API key banner"
API_KEY=""
for _ in $(seq 1 "$READY_TIMEOUT"); do
  "$ENGINE" logs "$CONTAINER" >"$LOG_FILE" 2>&1 || true
  API_KEY="$(grep -oE 'opk_[A-Za-z0-9_-]{20,}' "$LOG_FILE" | head -n1 || true)"
  [ -n "$API_KEY" ] && break
  if ! "$ENGINE" inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
    tail -40 "$LOG_FILE" >&2
    fail "container exited before printing a key (log tail above)"
  fi
  sleep 1
done
[ -n "$API_KEY" ] || fail "no opk_ key found in the container log after ${READY_TIMEOUT}s"
pass "captured boot key ${API_KEY:0:8}… (${#API_KEY} chars)"

# ---------------------------------------------------------------------------
# /readyz. Generous, because the first run is downloading ~2.0 GiB and then
# loading a 1.6B model on CPU.
# ---------------------------------------------------------------------------
step "waiting for /readyz 200 (weights download + model load; up to ${READY_TIMEOUT}s)"
deadline=$(( $(date +%s) + READY_TIMEOUT ))
ready=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/readyz" || echo 000)"
  if [ "$code" = "200" ]; then
    ready=1
    break
  fi
  if ! "$ENGINE" inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
    "$ENGINE" logs --tail 60 "$CONTAINER" >&2 2>&1 || true
    fail "container exited while waiting for readiness (log tail above)"
  fi
  printf '   /readyz -> %s  (%ss remaining)\r' "$code" "$(( deadline - $(date +%s) ))"
  sleep 5
done
echo
[ "$ready" = "1" ] || {
  "$ENGINE" logs --tail 60 "$CONTAINER" >&2 2>&1 || true
  fail "/readyz never returned 200 within ${READY_TIMEOUT}s (log tail above)"
}
pass "/readyz 200 — CPU-only container is serving"

# ---------------------------------------------------------------------------
# One real scan.
# ---------------------------------------------------------------------------
step "scanning eval/images/01.jpg through /v1/chat/completions"
REQUEST_FILE="$(mktemp)"
RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$REQUEST_FILE" "$RESPONSE_FILE"; cleanup' EXIT

python3 - "$IMAGE_FILE" "$REQUEST_FILE" <<'PY'
import base64, json, sys
img, out = sys.argv[1], sys.argv[2]
data = base64.b64encode(open(img, 'rb').read()).decode()
body = {
    "model": "openplate-plate-1",
    "messages": [{
        "role": "user",
        "content": [
            {"type": "text", "text": "Identify every food on this plate."},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{data}"}},
        ],
    }],
}
json.dump(body, open(out, 'w'))
PY

started=$(date +%s)
code="$(curl -s -o "$RESPONSE_FILE" -w '%{http_code}' \
  --max-time "$SCAN_TIMEOUT" \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary "@$REQUEST_FILE" \
  "$BASE/v1/chat/completions" || echo 000)"
elapsed=$(( $(date +%s) - started ))

[ "$code" = "200" ] || {
  head -c 2000 "$RESPONSE_FILE" >&2; echo >&2
  fail "scan returned HTTP $code after ${elapsed}s"
}
pass "scan returned 200 in ${elapsed}s"

# ---------------------------------------------------------------------------
# Schema shape. Not "is it correct" — that is what eval/ is for — but "is it the
# contract openplate consumes".
# ---------------------------------------------------------------------------
step "asserting the response is a schema-shaped PlateIdentification"
python3 - "$RESPONSE_FILE" <<'PY'
import json, sys

envelope = json.load(open(sys.argv[1]))
def bad(msg):
    print(f"✖ {msg}", file=sys.stderr)
    print(json.dumps(envelope)[:2000], file=sys.stderr)
    sys.exit(1)

if envelope.get("object") != "chat.completion":
    bad(f"object is {envelope.get('object')!r}, expected 'chat.completion'")
choices = envelope.get("choices")
if not isinstance(choices, list) or len(choices) != 1:
    bad("expected exactly one choice")
content = choices[0].get("message", {}).get("content")
if not isinstance(content, str):
    bad("choices[0].message.content is not a string")
if content.lstrip().startswith("```"):
    bad("content is fenced — the service must emit clean, unfenced JSON")

plate = json.loads(content)
foods = plate.get("foods")
if not isinstance(foods, list) or not foods:
    bad("plate.foods is missing or empty")
for i, food in enumerate(foods):
    for key, kind in (("name", str), ("estimatedGrams", (int, float))):
        if not isinstance(food.get(key), kind):
            bad(f"foods[{i}].{key} is {food.get(key)!r}")
    if not food["name"].strip():
        bad(f"foods[{i}].name is blank")
    if food["estimatedGrams"] <= 0:
        bad(f"foods[{i}].estimatedGrams is {food['estimatedGrams']}")

names = ", ".join(f["name"] for f in foods)
print(f"   {len(foods)} item(s): {names}")

# ── The bundled food corpus actually shipped and is readable ───────────────
# `01.jpg` is a full English breakfast: eggs, beans, bacon/ham and sausage all
# have FDC rows, so at least one item must come back resolved. Anything less
# means the dataset is missing from the image or the service cannot find it at
# its working directory — a silent failure at the API level, since the response
# stays schema-valid with macrosPer100g null.
MACRO_KEYS = ("carbs", "protein", "fat", "kcal")
resolved = [
    f for f in foods
    if f.get("provenance") == "corpus" and isinstance(f.get("macrosPer100g"), dict)
]
if not resolved:
    seen = [(f["name"], f.get("provenance"), f.get("macrosPer100g") is not None) for f in foods]
    bad(
        "no item resolved macros from the bundled corpus "
        "(expected >= 1 with provenance 'corpus' and non-null macrosPer100g).\n"
        "  Is data/ in the image, at the service's working directory?\n"
        f"  saw (name, provenance, has_macros): {seen}"
    )
for f in resolved:
    macros = f["macrosPer100g"]
    missing = [k for k in MACRO_KEYS if not isinstance(macros.get(k), (int, float))]
    if missing:
        bad(f"{f['name']!r} has provenance 'corpus' but missing/non-numeric macros: {missing}")

for f in resolved:
    m = f["macrosPer100g"]
    attribution = f.get("attribution") or "-"
    print(
        f"   ✓ corpus-resolved: {f['name']} -> "
        f"{m['kcal']} kcal, {m['carbs']}g carbs, {m['protein']}g protein, "
        f"{m['fat']}g fat  [{attribution}]"
    )
print(f"   {len(resolved)}/{len(foods)} item(s) resolved from the bundled corpus")
PY
pass "schema-shaped PlateIdentification with corpus-resolved macros"

printf '\n\033[32m✅ smoke-lite PASSED\033[0m — CPU-only, no GPU, no third-party inference call.\n'
