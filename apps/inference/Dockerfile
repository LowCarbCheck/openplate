# openplate-inference — one image, two model profiles, no weights inside it.
#
# ── WHAT THIS IMAGE IS ─────────────────────────────────────────────────────
# The final stage is the OFFICIAL llama.cpp server image with a Node runtime and
# this service's bundle added on top. So the heavy, security-sensitive,
# hard-to-build half (llama.cpp + its BLAS/CUDA stack) is upstream's build, not
# ours, and `docker pull` gets you a runtime someone else maintains.
#
#   CPU (default):  docker build -t openplate-inference .
#   NVIDIA GPU:     docker build -t openplate-inference \
#                     --build-arg BASE_IMAGE=ghcr.io/ggml-org/llama.cpp:server-cuda .
#                   ...then run it with `--gpus all`. The entrypoint detects the
#                   GPU and switches from `-ngl 0` to `-ngl 99` by itself.
#
# ── NO WEIGHTS IN ANY LAYER ────────────────────────────────────────────────
# There is deliberately no COPY or ADD of a .gguf anywhere below. Weights are
# 2–6 GB and would (a) make the image unbuildable on a small build host, (b)
# bake a model licence into a redistributable artifact, and (c) force a full
# re-pull for a one-line code change. `scripts/fetch-weights.sh` pulls them into
# the /models VOLUME on first boot, checksum-verified and resumable.

ARG BASE_IMAGE=ghcr.io/ggml-org/llama.cpp:server
ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
# Stage 1 — build the service bundle
# ---------------------------------------------------------------------------
# `pnpm build` (esbuild) emits ONE file, dist/server.js, with `express`, `sharp`
# and `undici` left external — see scripts/build.ts for why those three cannot be
# bundled. They come from the prod-deps stage below.
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate

# Dependency manifests first so a source-only change reuses the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY scripts/build.ts ./scripts/
COPY src ./src
RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 2 — runtime dependencies only
# ---------------------------------------------------------------------------
# A second, production-only install with the HOISTED linker. pnpm's default
# symlinked store cannot be copied between stages (the links point outside
# node_modules); hoisted gives a plain, copyable tree. `--prod` drops
# typescript/vitest/esbuild, which is most of the weight.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --config.node-linker=hoisted

# ---------------------------------------------------------------------------
# Stage 3 — the shipped image
# ---------------------------------------------------------------------------
FROM ${BASE_IMAGE}

# curl fetches the weights; ca-certificates is what lets it speak TLS to
# Hugging Face. Both are small and neither is guaranteed present upstream.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# The Node runtime, taken from the official Node image rather than apt: one
# binary, the exact version we build against, no package tree to keep patched.
# `npm`/`corepack` are deliberately NOT copied — nothing installs at runtime.
COPY --from=build /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
COPY --from=build     /app/dist         /app/dist
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY package.json /app/package.json

# The bundled food corpus — the USDA-FDC-derived dataset (public domain) that
# FOOD_SOURCE=fdc resolves macros against, plus the German alias table. ~1.8 MB
# of JSON, so it belongs in the image; unlike the GGUFs there is nothing to
# gain by fetching it at boot, and shipping it is what makes the default
# offline and key-free.
#
# THE PATH IS LOAD-BEARING. `src/food-source/index.ts` calls `resolve()` on the
# configured path, i.e. it resolves relative to the process CWD — which is this
# WORKDIR. `./data/fdc-foods.json` therefore has to land at /app/data. Get this
# wrong and the container still boots, still serves scans, and silently returns
# every plate with no macros at all.
COPY data /app/data
COPY scripts/fetch-weights.sh scripts/docker-entrypoint.sh /app/scripts/
RUN chmod +x /app/scripts/fetch-weights.sh /app/scripts/docker-entrypoint.sh

# MODEL_PROFILE is the ONE knob that selects a model set:
#   lite         LFM2.5-VL-1.6B Q8_0 + F16 mmproj   (~2.0 GiB, CPU-viable,
#                LFM Open License — revenue-capped, see README "Licensing")
#   lite-apache  Qwen3-VL-2B-Instruct Q4_K_M + F16  (~1.8 GiB, Apache-2.0
#                drop-in for the lite slot)
#   quality      Qwen3-VL-8B-Instruct Q4_K_M + F16  (~5.8 GiB, Apache-2.0,
#                the GPU flagship path)
ENV MODEL_PROFILE=lite \
    MODELS_DIR=/models \
    PORT=8300 \
    RUNTIME_PORT=8080 \
    CONCURRENCY=2 \
    CONTEXT_SIZE=8192 \
    LOG_LEVEL=info \
    NODE_ENV=production

# Weights live here and must survive `docker rm`. Naming it makes an anonymous
# volume the accident-proof default even when an operator forgets `-v`.
VOLUME /models

# Only the service port. llama-server is bound to 127.0.0.1 inside the
# container and is not reachable from outside it — by design.
EXPOSE 8300

# `/readyz` asks "can it serve a scan right now", which includes the model
# runtime being loaded. The 60 min start period is the first-boot weight
# download: without it, the container is marked unhealthy while it is doing
# exactly what it is supposed to be doing.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60m --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/readyz" >/dev/null || exit 1

# Overrides the base image's llama-server entrypoint: the entrypoint script is
# what starts llama-server, after the weights exist.
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
