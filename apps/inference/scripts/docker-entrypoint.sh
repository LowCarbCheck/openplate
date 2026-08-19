#!/bin/sh
# Container entrypoint. Runs two processes in one container, in this order:
#
#   1. scripts/fetch-weights.sh   — pull + verify the GGUFs for MODEL_PROFILE
#                                   into /models (a VOLUME, so this happens
#                                   once per volume, not once per start).
#   2. llama-server               — the model runtime, bound to LOOPBACK ONLY.
#   3. node dist/server.js        — the openplate-inference HTTP service, which
#                                   is the only thing that listens publicly.
#
# WHY ONE CONTAINER RATHER THAN TWO. The runtime port is an unauthenticated raw
# vision endpoint. Keeping it on 127.0.0.1 inside the container means a
# self-hoster cannot accidentally publish it, and `docker run -p 8300:8300` is
# the entire network surface. The cost is that the two processes share a
# lifecycle — which is what we want anyway: a service whose runtime has died
# can only answer 502s.
#
# The supervision below is deliberately dumb: if EITHER process exits, the
# container exits, and the restart policy handles it. A container that keeps
# running with half of itself dead is the failure mode that wastes an evening.
set -eu

MODELS_DIR="${MODELS_DIR:-/models}"
MODEL_PROFILE="${MODEL_PROFILE:-lite}"
RUNTIME_PORT="${RUNTIME_PORT:-8080}"
CONCURRENCY="${CONCURRENCY:-2}"
CONTEXT_SIZE="${CONTEXT_SIZE:-8192}"
LLAMA_EXTRA_ARGS="${LLAMA_EXTRA_ARGS:-}"

export MODELS_DIR MODEL_PROFILE

# The address the OPERATOR asked for, captured BEFORE stage 3 overwrites
# MODEL_RUNTIME_URL with the bundled loopback address. Reading it after that
# point would compare the bundled value against itself, and the conflict check
# below could never fire.
OPERATOR_RUNTIME_URL="${MODEL_RUNTIME_URL:-}"

# What stage 3 will point the service at in bundled mode.
BUNDLED_RUNTIME_URL="http://127.0.0.1:$RUNTIME_PORT"

# ---------------------------------------------------------------------------
# Stage 0 — mode
# ---------------------------------------------------------------------------
#
# MODEL_PROFILE selects the WEIGHTS in bundled mode; `external` instead means
# "there are no weights, bring your own runtime". It is deliberately the same
# knob rather than a second RUNTIME_MODE variable: the two settings are mutually
# exclusive by nature, and two booleans that must disagree is a state an
# operator can get wrong.
#
# MODEL_PROFILE never reaches src/config.ts, so this check has to live in the
# shell — the service cannot tell a bundled container from an external one.
if [ "$MODEL_PROFILE" = external ]; then
  if [ -z "$OPERATOR_RUNTIME_URL" ]; then
    echo "✖ MODEL_PROFILE=external needs MODEL_RUNTIME_URL, and it is unset." >&2
    echo "" >&2
    echo "  External mode ships no weights and starts no llama-server, so the" >&2
    echo "  address of YOUR runtime is the one thing it cannot infer." >&2
    echo "" >&2
    echo "  Either point it at your runtime:" >&2
    echo "      -e MODEL_PROFILE=external -e MODEL_RUNTIME_URL=http://host:8080" >&2
    echo "  or drop MODEL_PROFILE=external to run the bundled model instead." >&2
    echo "" >&2
    echo "  No trailing /v1 — the service appends the OpenAI paths itself, and" >&2
    echo "  the address must resolve from INSIDE this container." >&2
    exit 4
  fi
elif [ -n "$OPERATOR_RUNTIME_URL" ] && [ "$OPERATOR_RUNTIME_URL" != "$BUNDLED_RUNTIME_URL" ]; then
  # A bundled container ALWAYS serves from its own loopback llama-server, so an
  # operator-supplied address here would be silently discarded at stage 3 — the
  # container would download several GB of weights and quietly ignore the
  # runtime they meant to use. Refuse instead.
  #
  # A value equal to the bundled address is NOT a conflict: older .env.example
  # copies shipped exactly that line uncommented, and an operator using such a
  # file as an `env_file:` to set API_KEYS would otherwise be blocked for a
  # setting that changes nothing. So this catches HARMFUL overrides, not every
  # override.
  echo "✖ Conflicting configuration: MODEL_RUNTIME_URL is set, but MODEL_PROFILE" >&2
  echo "  is \"$MODEL_PROFILE\" (a bundled profile), which serves the model from" >&2
  echo "  this container's own loopback and would ignore your address." >&2
  echo "" >&2
  echo "      MODEL_PROFILE      $MODEL_PROFILE" >&2
  echo "      MODEL_RUNTIME_URL  $OPERATOR_RUNTIME_URL" >&2
  echo "" >&2
  echo "  Pick one:" >&2
  echo "    • To use YOUR runtime at that address, also set MODEL_PROFILE=external" >&2
  echo "      (no weights are downloaded and no llama-server is started)." >&2
  echo "    • To use the BUNDLED $MODEL_PROFILE model, unset MODEL_RUNTIME_URL." >&2
  echo "      Older .env.example copies shipped this line uncommented; if you" >&2
  echo "      passed such a file as env_file, comment the line out." >&2
  exit 4
fi

if [ "$MODEL_PROFILE" = external ]; then
  echo "═══════════════════════════════════════════════════════════════════════"
  echo "  External runtime mode — no weights, no llama-server in this container"
  echo "    runtime:  $OPERATOR_RUNTIME_URL"
  echo ""
  echo "  That runtime MUST enforce grammar-constrained decoding"
  echo "  (response_format: json_schema). See README — 'Bring your own runtime'."
  echo "═══════════════════════════════════════════════════════════════════════"
fi

if [ "$MODEL_PROFILE" != external ]; then

# ---------------------------------------------------------------------------
# Stage 1 — weights
# ---------------------------------------------------------------------------
/app/scripts/fetch-weights.sh

MODEL_PATH=$(/app/scripts/fetch-weights.sh --print model)
MMPROJ_PATH=$(/app/scripts/fetch-weights.sh --print mmproj)

# ---------------------------------------------------------------------------
# Stage 2 — llama-server
# ---------------------------------------------------------------------------

# GPU offload. `-ngl 99` means "put every layer you can on the GPU"; `-ngl 0` is
# pure CPU. We detect rather than ask, because the commonest support question is
# "I passed --gpus all and it's still slow" — and the commonest cause of the
# reverse ("it won't start") is -ngl 99 on an image with no CUDA runtime.
detect_gpu_layers() {
  # An explicit setting always wins.
  if [ -n "${GPU_LAYERS:-}" ]; then
    echo "$GPU_LAYERS"
    return
  fi
  # `--gpus all` on the NVIDIA container runtime sets this; "void"/"none" mean
  # the operator deliberately turned it off.
  case "${NVIDIA_VISIBLE_DEVICES:-}" in
    ''|void|none) ;;
    *) echo 99; return ;;
  esac
  if [ -e /dev/nvidia0 ] || [ -e /dev/nvidiactl ] || [ -e /dev/dri/renderD128 ]; then
    echo 99
    return
  fi
  echo 0
}

NGL=$(detect_gpu_layers)

resolve_llama_server() {
  if command -v llama-server >/dev/null 2>&1; then
    command -v llama-server
  elif [ -x /app/llama-server ]; then
    echo /app/llama-server
  elif [ -x /llama-server ]; then
    echo /llama-server
  else
    echo "✖ llama-server not found in this image. Set BASE_IMAGE to an official" >&2
    echo "  llama.cpp server image (ghcr.io/ggml-org/llama.cpp:server[-cuda])." >&2
    exit 3
  fi
}

LLAMA_SERVER=$(resolve_llama_server)

# Leave two cores for the node service, sharp's image decode, and the OS.
# Handing llama.cpp every core measurably hurts: the box does not get faster, it
# gets contended, and the service's own downscale then competes with generation.
# Every measurement in eval/ used 14 threads on a 16-thread host — this is that.
default_threads() {
  cores=$(nproc 2>/dev/null || echo 4)
  if [ "$cores" -gt 3 ]; then
    echo $((cores - 2))
  else
    echo 1
  fi
}
THREADS="${LLAMA_THREADS:-$(default_threads)}"

# CONTEXT_SIZE is PER SLOT, which is not what llama-server's `-c` means: it
# divides `-c` across `--parallel` slots (the log line to check is
# `n_ctx_slot`). Passing `-c 8192 --parallel 2` silently gives each request a
# 4096-token window — enough for a downscaled plate, and NOT enough for a
# full-resolution one (measured prompts reach 3507 tokens). So multiply.
TOTAL_CONTEXT=$((CONTEXT_SIZE * CONCURRENCY))

echo "═══════════════════════════════════════════════════════════════════════"
echo "  Starting llama-server (this loads the model — expect 5–60 s)"
echo "    profile:  $MODEL_PROFILE"
echo "    model:    $MODEL_PATH"
echo "    mmproj:   $MMPROJ_PATH"
if [ "$NGL" = "0" ]; then
  echo "    GPU:      none detected — CPU only (-ngl 0, -t $THREADS)"
else
  echo "    GPU:      detected — offloading layers (-ngl $NGL)"
fi
echo "    context:  $CONTEXT_SIZE per slot × $CONCURRENCY slots (-c $TOTAL_CONTEXT)"
echo "═══════════════════════════════════════════════════════════════════════"

# --jinja: the chat template ships inside the GGUF and llama-server ignores it
#          without this flag, which turns every image request into nonsense.
# --metrics: exposes /metrics on the loopback runtime port for anyone debugging
#          prefill/decode throughput.
# --parallel: KV slots. Matches the service's worker pool (CONCURRENCY) — more
#          in-flight requests than slots just moves the queue somewhere we
#          cannot measure.
# --host 127.0.0.1: NOT configurable on purpose. See the header.
# shellcheck disable=SC2086
"$LLAMA_SERVER" \
  -m "$MODEL_PATH" \
  --mmproj "$MMPROJ_PATH" \
  -c "$TOTAL_CONTEXT" \
  --parallel "$CONCURRENCY" \
  -ngl "$NGL" \
  -t "$THREADS" \
  --jinja \
  --metrics \
  --host 127.0.0.1 \
  --port "$RUNTIME_PORT" \
  $LLAMA_EXTRA_ARGS &
RUNTIME_PID=$!

fi  # end bundled-only stages 1–2

# ---------------------------------------------------------------------------
# Stage 3 — the service
# ---------------------------------------------------------------------------

# The node service does NOT wait for the runtime to finish loading: /readyz is
# what reports that, and a boot blocked on a multi-GB model load looks exactly
# like a hung container. See src/main.ts. The same is true of an external
# runtime that is still warming up.
if [ "$MODEL_PROFILE" = external ]; then
  MODEL_RUNTIME_URL="$OPERATOR_RUNTIME_URL"
else
  MODEL_RUNTIME_URL="$BUNDLED_RUNTIME_URL"
fi
export MODEL_RUNTIME_URL
export CONCURRENCY

# MODEL_PROFILE is the WEIGHT selector; PROFILE is what the service logs and
# reports. Map one onto the other so an operator sets exactly one variable.
if [ -z "${PROFILE:-}" ]; then
  case "$MODEL_PROFILE" in
    lite|lite-apache) PROFILE=lite ;;
    quality) PROFILE=quality ;;
    # `external` reports as custom: the profile names OUR benchmarked weight +
    # serving-flag pairs, and we know nothing about the operator's runtime.
    external) PROFILE=custom ;;
    *) PROFILE=custom ;;
  esac
  export PROFILE
fi

node /app/dist/server.js &
SERVICE_PID=$!

# ---------------------------------------------------------------------------
# Supervision
# ---------------------------------------------------------------------------
#
# In external mode there is only ONE process to supervise: the runtime belongs
# to the operator and its lifecycle is theirs. RUNTIME_PID is unset there, and
# `set -u` is on, so every read of it is guarded.
term() {
  echo "▶ entrypoint: signal received, stopping"
  # Signal both FIRST, then wait on both, so shutdown stays parallel.
  # NOT `[ -n … ] && kill …`: a false test is a non-zero command, and `set -e`
  # would take that as a failure and exit 1 out of a clean shutdown.
  kill -TERM "$SERVICE_PID" 2>/dev/null || true
  if [ -n "${RUNTIME_PID:-}" ]; then
    kill -TERM "$RUNTIME_PID" 2>/dev/null || true
  fi
  wait "$SERVICE_PID" 2>/dev/null || true
  if [ -n "${RUNTIME_PID:-}" ]; then
    wait "$RUNTIME_PID" 2>/dev/null || true
  fi
  exit 0
}
trap term TERM INT

# POSIX sh has no `wait -n`, so poll. 1 s of latency on a crash is irrelevant
# next to the alternative of depending on bash in an image we do not control.
while true; do
  if [ -n "${RUNTIME_PID:-}" ] && ! kill -0 "$RUNTIME_PID" 2>/dev/null; then
    echo "✖ llama-server exited — stopping the service too." >&2
    kill -TERM "$SERVICE_PID" 2>/dev/null || true
    wait "$RUNTIME_PID" 2>/dev/null || true
    exit 1
  fi
  if ! kill -0 "$SERVICE_PID" 2>/dev/null; then
    if [ -n "${RUNTIME_PID:-}" ]; then
      echo "✖ openplate-inference exited — stopping llama-server too." >&2
      kill -TERM "$RUNTIME_PID" 2>/dev/null || true
    else
      echo "✖ openplate-inference exited." >&2
    fi
    wait "$SERVICE_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done
