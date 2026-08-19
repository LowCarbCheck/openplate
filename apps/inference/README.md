# openplate-inference

**A plate-photo scanner you run yourself.** Point your phone at dinner, get back
a list of foods with portion estimates in grams — computed on your hardware, from
open-weight models, with no account, no API key from anybody, and no photo
leaving your network.

It speaks the OpenAI chat-completions protocol, so [openplate](https://github.com/LowCarbCheck/openplate)
connects to it as a normal "OpenAI-compatible" provider. One container, one port.

```
   phone/browser ──photo──▶ openplate-inference ──▶ llama.cpp + open-weight VLM
                  ◀─JSON──                     ──▶ food database (macros)
```

---

## What it is, and what it is not

**It is:**

- **Food identification and portion estimation from your own photos.** The model
  names what is on the plate and estimates how many grams of each thing there is.
- **A single self-contained container.** The model runtime (llama.cpp) and the
  HTTP service ship together. Weights download on first boot into a volume.
- **A harness for a runtime you already have.** If you run llama.cpp, Ollama, or
  vLLM-on-GPU today, set `MODEL_PROFILE=external` and this downloads nothing and
  starts no second model. Check the support matrix first — vLLM's **CPU** build
  cannot run this. See [Bring your own runtime](#bring-your-own-runtime).
- **CPU-viable.** A machine with no GPU runs the `lite` profile. Slowly, and that
  is a real product, not a degraded one — see [Hardware & measured latency](#hardware--measured-latency).
- **OpenAI-protocol compatible**, so anything that can talk to an
  OpenAI-compatible endpoint can talk to this, not just openplate.

**It is not:**

- **Not a macro guesser.** The model identifies foods and estimates grams. The
  carbs/protein/fat/kcal numbers come from a **food database**, resolved by name —
  they are looked up, never invented by the language model. See
  [Food data](#food-data-foodsource). This is the whole reason the numbers are
  worth anything.
- **Not an account system.** There are no users, no sessions, no cookies. Auth is
  one bearer key. State is nothing: restart it and you have lost nothing.
- **Not a cloud service.** Nothing here calls out to anyone's API. The only
  outbound network request the container ever makes is downloading model weights,
  once.
- **Not a medical device, and not dietary advice.** It is a camera-assisted
  estimate of what is in front of you. Portion estimation from a single 2D photo
  is genuinely hard; treat the grams as a starting point you correct, which is
  exactly how openplate's UI presents them.
- **Not a general vision model.** It accepts one image and answers one question.
  Your prompt is read for the image and otherwise discarded.

---

## Quickstart

### 1. Run it

```bash
docker run -d --name openplate-inference \
  -p 8300:8300 \
  -v openplate-models:/models \
  -e MODEL_PROFILE=lite \
  ghcr.io/lowcarbcheck/openplate-inference:latest
```

That is the whole CPU install. On a machine with an NVIDIA GPU, add `--gpus all`
and use the CUDA image — the container detects the GPU and offloads every layer
by itself, there is no flag to set:

```bash
docker run -d --name openplate-inference \
  --gpus all \
  -p 8300:8300 \
  -v openplate-models:/models \
  -e MODEL_PROFILE=quality \
  ghcr.io/lowcarbcheck/openplate-inference:cuda
```

Building from source — **use this until the published image lands**, and any time
you want to see exactly what you are running:

```bash
git clone https://github.com/LowCarbCheck/openplate-inference && cd openplate-inference
docker build -t openplate-inference .                                                     # CPU
docker build -t openplate-inference --build-arg BASE_IMAGE=ghcr.io/ggml-org/llama.cpp:server-cuda .   # GPU
```

The build is a couple of minutes and about 1 GB of image — the heavy half
(llama.cpp and its BLAS/CUDA stack) is the official upstream `llama.cpp:server`
image, not something we compile. Then substitute `openplate-inference` for
`ghcr.io/lowcarbcheck/openplate-inference:latest` in the commands above.

**First boot downloads the weights** — about **2.0 GiB** for `lite`, **5.8 GiB**
for `quality` — into the `/models` volume, checksum-verified. It is resumable: if
it dies at 80 %, restarting the container continues from 80 %. It only ever
happens once per volume.

### 2. Get the key

The container prints one on first boot:

```bash
docker logs openplate-inference | grep -A4 'generated a temporary key'
```

```
========================================================================
  No API_KEYS configured — generated a temporary key for this process:

    opk_7Qb3xR2mKpLv9dTfWs4nYhAe1cJgZuMo

  This key lives in memory only. Restarting this container generates a
  new one. Set API_KEYS=<key>[,<key>] in the environment for a stable key.
========================================================================
```

Convenient for a first run, useless long-term: it is in memory only, so a restart
invalidates it. For anything you keep, set your own:

```bash
-e API_KEYS="$(openssl rand -base64 24)"
```

### 3. Prove it works

```bash
curl -s http://localhost:8300/readyz            # 200 once the model is loaded
curl -s http://localhost:8300/v1/models -H "Authorization: Bearer $KEY"
```

`/readyz` returning 200 means the weights are downloaded, the model is loaded,
and a scan will actually run. `/healthz` only means the process is alive.

### 4. Point openplate at it

Two paths. Pick whichever matches who is using the instance.

#### Path A — the instance preset (recommended: everyone gets one tap)

Set three environment variables on **openplate**, and every browser using that
instance gets a *"This openplate provides its own AI"* card on the AI settings
screen and on the scan screen. Nobody has to obtain a key.

```bash
DEFAULT_INFERENCE_BASE_URL=http://openplate.example.lan:8300/v1
DEFAULT_INFERENCE_API_KEY=opk_your_stable_key
DEFAULT_INFERENCE_MODEL=openplate-plate-1
```

> **The base URL must be reachable from the browser, not from the openplate
> container.** The photo goes from the device straight to this endpoint —
> openplate's server is never in the middle, which is what keeps the scan
> private. So `http://inference:8300/v1` does not work even though the two
> containers can reach each other that way. Use this host's LAN address, or a
> hostname on your reverse proxy or tailnet.
>
> **`DEFAULT_INFERENCE_API_KEY` is public.** It is embedded in the HTML every
> browser loads; anyone who can open your openplate can read it with view-source.
> That is fine for a household, a LAN, or a tailnet. It is *not* fine on an
> instance exposed to the open internet with no VPN or auth proxy in front of it
> — there, leave it unset and use Path B.

A ready-to-edit two-service compose file is in
[`docker-compose.example.yml`](docker-compose.example.yml).

#### Path B — bring your own key (per person, nothing on the server)

In openplate: **Settings → AI → OpenAI-compatible**, then fill in

| field | value |
|---|---|
| Base URL | `http://openplate.example.lan:8300/v1` |
| API key | your `opk_…` key |
| Model | `openplate-plate-1` |

The key is stored on that device and never sent to openplate's server.

### 5. Scan something

Take a photo in openplate. You are done. If it fails, the next section is the
one you want.

---

## Bring your own runtime

**If you already run llama.cpp, Ollama, or anything else that speaks the OpenAI
protocol, point this at it.** Nothing here needs to download a model or start a
second copy of one on your hardware.

Check [the support matrix](#what-we-actually-measured) before you commit to a
runtime: this pipeline needs grammar-constrained decoding, and not everything
that advertises OpenAI compatibility delivers it. llama.cpp, Ollama and
**vLLM on a GPU** are all measured working. **vLLM's CPU build crashes on the
first scan** — same version, no accelerator, dead worker.

```bash
docker run -d --name openplate-inference \
  -p 8300:8300 \
  -e MODEL_PROFILE=external \
  -e MODEL_RUNTIME_URL=http://your-runtime.lan:8000 \
  -e MODEL_ID=your-served-model-name \
  -e API_KEYS=opk_your_key \
  ghcr.io/lowcarbcheck/openplate-inference:latest
```

`MODEL_PROFILE=external` is the whole switch. It skips the weight download and
starts no `llama-server`, so there is no `/models` volume and the image is doing
one job: turning your runtime into a plate scanner.

- **`MODEL_RUNTIME_URL`** — no trailing `/v1`, the service appends the OpenAI
  paths itself. It must resolve from **inside the container**, so `localhost`
  means the container, not your host. Setting it to a *different* address without
  `MODEL_PROFILE=external` is a boot error rather than a silent override — a
  bundled container always serves from its own loopback, and quietly ignoring the
  address you set is how you end up debugging a 6 GB download you never wanted.
  (Setting it to exactly the bundled loopback address is allowed and changes
  nothing — older `.env.example` copies shipped that line uncommented.)
- **`MODEL_ID`** — sent to your runtime. llama.cpp ignores it, but **vLLM and
  Ollama both need the exact served model name** — vLLM rejects a mismatch, and
  Ollama uses it to select and load the model. The id *clients* use is always
  `openplate-plate-1` regardless.
- **`MODEL_RUNTIME_API_KEY`** — optional, sent as `Authorization: Bearer …` to
  your runtime. Set it for `vllm serve --api-key …` or an auth proxy. This is
  separate from `API_KEYS`, which is what *callers* present to **this** service.
- **`RUNTIME_COMPLETION_TIMEOUT_MS`** — total bound on one completion call, in
  milliseconds. **Default `600000` (10 minutes); `0` disables it.** It applies in
  **bundled mode too** — a wedged `llama-server` is just as mute as a misrouted
  proxy. If your hardware legitimately needs longer than ten minutes per plate,
  raise it or set it to `0`; the failure message says so by name.

  **This is not `LATENCY_CEILING_MS`.** That one is *admission policy*: refuse
  work you cannot finish in time, before starting it. This one is *liveness*:
  release a worker slot an upstream is never going to return. At 600 s it is
  ~60× the hosted latency policy — a backstop, never a target.

  It exists because the bound was already there and nobody had chosen it: Node's
  `fetch` defaults `headersTimeout` to 300 s, and because a non-streaming
  completion writes its headers only when generation finishes, that is a **300 s
  total cap in disguise** — reachable on hardware this project advertises as
  supported. Setting this explicitly *loosens* what you are running today.

  And it is not "wait forever" because with `CONCURRENCY=2`, two wedged in-flight
  scans hold both worker slots permanently while `/readyz` stays green — the
  readiness probes hit a different endpoint and structurally cannot see it.

### Your runtime must enforce grammar-constrained decoding

This is the one hard requirement, and it is not negotiable. The pipeline makes a
single vision call with `response_format: {"type": "json_schema", "json_schema":
{"name": …, "strict": true, "schema": …}}` and trusts the shape that comes back.
It has no parse-and-retry loop, because a
retry loop is a second, weaker correctness mechanism papering over a first one
that stopped working.

**The dangerous failure is not rejection, it is acceptance-and-ignore** — a
runtime that takes the `response_format` field, discards it, and returns
plausible JSON that misses the contract. That does not look like an error. It
looks like slightly wrong gram estimates.

**Check yours in one command** before trusting it. Ask for prose while demanding
a schema; if the answer is still schema-shaped, the grammar is real:

```bash
curl -s http://your-runtime.lan:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"your-model","messages":[{"role":"user","content":"Write a haiku about rain."}],
       "response_format":{"type":"json_schema","json_schema":
         {"name":"t","strict":true,"schema":{"type":"object","properties":{"x":{"type":"string"}},
          "required":["x"],"additionalProperties":false}}}}'
```

A JSON object with an `x` key means enforcement works. A haiku means it does not,
and this service will 502 on every scan with a message saying exactly that.

### What we actually measured

Measured first-hand on 2026-08-15, not inferred from anyone's compatibility
claims. Rows we have not run ourselves say so.

| Runtime | Version | Grammar | Image input | Verdict |
|---|---|---|---|---|
| **llama.cpp** (`llama-server`) | b10330 | enforced (GBNF) | base64 data URL | ✅ **works** — this is what the bundled image runs |
| **Ollama** | 0.32.13 | enforced | base64 data URL | ✅ **works** — see the readiness note below |
| **vLLM** (CPU build) | 0.27.1 | — | — | ❌ **broken** — a `json_schema` request **kills the server** (`pin_memory=True requires a CUDA or other accelerator backend`). Plain completions work, so it looks healthy until the first real scan takes the process down |
| **vLLM** (GPU build) | 0.27.1 | enforced (xgrammar) | base64 data URL | ✅ **works** — measured on an RTX 3090 with `Qwen3-VL-2B-Instruct` |
| anything else | — | — | — | ⚠️ **untested** — run the curl above |

**Same version, opposite outcomes — it is the CPU build specifically.** The GPU test ran
the *identical* vLLM image that dies on CPU (`vllm/vllm-openai:latest` and `v0.27.1` share
a digest), with the same schema and the same base64 image this service sends. On the GPU it
returned schema-valid JSON in 1.8 s and stayed up. So do not read the ❌ row as "vLLM is
unsupported" — read it as "do not run vLLM without a GPU."

**Why the CPU build dies.** Grammar-constrained decoding builds a token bitmask and
allocates it in *pinned* memory — a page-locked buffer whose only purpose is fast copying
to a GPU. Ask for that with no accelerator present and PyTorch raises rather than ignoring
it, and because this happens while serving rather than while validating, it takes the
worker down instead of returning an error. That is an upstream bug, not a limitation of
this service: we send the same payload llama.cpp and Ollama both handle correctly.

**One vLLM quirk worth knowing.** With a prompt the model cannot answer in the required
shape, we saw it emit `{` followed by whitespace until it hit the token cap — the grammar
holds (it never produced prose, even when explicitly asked for a haiku), but the model
fills the unconstrained whitespace instead of the content. That surfaces here as the
`finish_reason: length` error, which names the token cap. A real plate photo did not
trigger it; an off-task prompt did.

If you run a row we have not, please open an issue with the result. We would rather ship a
table that is short and true.

### Three things that will bite you

**1. Context window — the symptom is garbled output, not a startup error.** Too
small a window does not fail loudly. It silently drops the front of your prompt
and you get confident nonsense.

**Prompt size depends on your model, not on us**, and the spread is wide. Two
first-hand measurements of the *same* 896 px downscaled plates:

| Model | Prompt tokens (896 px plate) |
|---|---|
| Qwen3-VL-8B on llama.cpp | **1,287 – 3,507** across the 10-plate corpus |
| moondream on Ollama | **746** |

So do not size from our numbers — **read your own**. Run one scan against your
runtime and look at what it reports:

```bash
curl -s .../v1/chat/completions -d '…' | jq .usage.prompt_tokens
```

Size the window above your own worst case, with headroom. On vLLM that is
`--max-model-len`. On Ollama it is `num_ctx` — set it in a Modelfile, because we
measured `OLLAMA_CONTEXT_LENGTH=8192` failing to raise a model's reported context
above 2048 (Ollama appears to clamp to the model's own trained context, so a
model with a small trained window cannot be talked into a bigger one).

**2. `CONCURRENCY` must match your runtime's real slot count.** More in-flight
requests than the runtime has slots does not add throughput — it moves the queue
somewhere this service cannot see or measure, and the admission controller then
makes decisions on a fiction.

| Runtime | The flag that sets slots |
|---|---|
| llama.cpp | `--parallel N` |
| vLLM | `--max-num-seqs N` |
| Ollama | `OLLAMA_NUM_PARALLEL=N` |

**3. The container's `HEALTHCHECK` allows 60 minutes to start.** That is sized
for a first-boot weight download on a home connection. In external mode there is
no download, so a wrong `MODEL_RUNTIME_URL` stays hidden for an hour instead of
failing in seconds. `start_period` is baked in at build time, so **override it**
— see the commented block in [`docker-compose.example.yml`](docker-compose.example.yml).

### Readiness, and what it does not tell you

`/readyz` asks your runtime `GET /health`, and falls back to `GET /v1/models` for
runtimes that have no `/health` (Ollama does not). Two honest limits:

- **Against Ollama, `/v1/models` is liveness, not readiness.** It answers `200`
  with zero models resident — Ollama loads lazily on first request — so a ready
  reading means "reachable", not "warm". Your first scan absorbs the load time.
- **`/readyz` cannot validate `MODEL_RUNTIME_API_KEY` when `/health` is open.**
  On vLLM, `/health` is unauthenticated while `/v1/chat/completions` is not. A
  wrong key therefore reports **ready** and fails every scan with a 502. If scans
  502 against a ready service, check the key first.

A `503` from llama.cpp's `/health` means *loading* and is reported as not-ready —
it is deliberately never treated as "this runtime has no `/health`".

`/readyz` also reports the **optional** embeddings runtime, as a three-state
field that never affects the status code — lexical-only retrieval is the default,
not an outage:

| `embeddingReady` | Meaning |
|---|---|
| `null` | `EMBEDDING_RUNTIME_URL` is unset. Retrieval is lexical-only by configuration. Normal. |
| `true` | Configured and answering. Retrieval is hybrid. |
| `false` | Configured and **failing** — `embeddingReason` says why (e.g. `http 401`). Ranking is quietly worse until fixed. |

`embeddingReason` is `null` whenever nothing is wrong, so alerting on
`embeddingReason !== null` is safe. A wrong `EMBEDDING_RUNTIME_API_KEY` shows up
here and nowhere else: it degrades ranking rather than failing scans, which
before this field made it invisible.

### Does your runtime give good answers?

Compatibility is not accuracy. A runtime can enforce the schema perfectly and
still be paired with a model that reads plates badly. `eval/run-50img.sh` scores
any endpoint against the same 50-image gold set every number in this README came
from — point it at yours before trusting the output.

---

## Is it working, or is it stuck?

`docker logs -f openplate-inference` walks through three stages in order. Here is
what each one looks like, so you can tell "busy" from "broken".

**Stage 1 — downloading weights** (first boot only; minutes to an hour on a home
connection). Sizes are printed up front so you can compare against your link
speed:

```
═══════════════════════════════════════════════════════════════════════
  openplate-inference — weights for MODEL_PROFILE=lite
  destination: /models   total: 2.05 GiB
═══════════════════════════════════════════════════════════════════════
▶ [model] downloading LFM2.5-VL-1.6B-Q8_0.gguf (1.16 GiB) from https://huggingface.co/...
   This is a one-time download into /models. It is resumable —
   restarting the container continues where it stopped.
######################################                            54.2%
```

*Stuck?* If the percentage has not moved in five minutes the download stalled.
Restart the container — it resumes, it does not start over. On later boots this
stage is a few seconds of hashing instead:

```
▶ [model] LFM2.5-VL-1.6B-Q8_0.gguf — already present, verifying sha256 (1.16 GiB)...
✅ [model] LFM2.5-VL-1.6B-Q8_0.gguf verified, skipping download.
✅ All weights for profile 'lite' are present and verified.
```

If a checksum ever fails, the log prints the exact command to delete the bad file
and retry. Follow it. If it fails twice on the same file, something between you
and Hugging Face is altering the download (a captive portal or filtering proxy
will do this) — try another network, or pre-seed the volume by hand (below).

**Stage 2 — loading the model** (5–60 s, every boot):

```
═══════════════════════════════════════════════════════════════════════
  Starting llama-server (this loads the model — expect 5–60 s)
    profile:  lite
    model:    /models/LFM2.5-VL-1.6B-Q8_0.gguf
    mmproj:   /models/mmproj-LFM2.5-VL-1.6b-F16.gguf
    GPU:      none detected — CPU only (-ngl 0, -t 8)
    context:  8192   slots: 2
═══════════════════════════════════════════════════════════════════════
...
main: server is listening on http://127.0.0.1:8080 - starting the main loop
```

*Check the `GPU:` line.* This is where "I passed `--gpus all` and it's still
slow" gets diagnosed — if it says `none detected`, the GPU is not reaching the
container, and no amount of tuning elsewhere will help.

**Stage 3 — ready:**

```
{"level":"info","msg":"openplate-inference listening","port":8300,
 "model":"openplate-plate-1","profile":"lite","concurrency":2,"keyIds":"a1b2c3d4"}
```

`/readyz` returns 200 from here on. Note the service starts listening *before*
the model finishes loading, deliberately — a boot that blocked on a multi-GB load
is indistinguishable from a hung container. Until the runtime is up, `/readyz`
tells you so.

**Common failures, in the order they happen:**

| symptom | cause |
|---|---|
| Container exits immediately, one line of stderr | Bad configuration. The message names the variable. Config is validated at boot on purpose — a service that starts without a model runtime answers every scan with a 502, and that reads as "the product is broken". |
| Download stalls, no progress | Restart; it resumes. |
| `CHECKSUM MISMATCH` | Follow the printed recovery command. |
| `/readyz` never reaches 200, logs stop after stage 2 | Out of memory during model load. Check `docker stats` and the [memory floors](#hardware--measured-latency). |
| Scans return 401 | Wrong or stale key. A restart regenerates the boot key — set `API_KEYS`. |
| Scans return 429 with `Retry-After` | Working as intended: the queue is full or you exceeded `RATE_LIMIT_RPM`. |
| Scans return 502 | The service is up and the model runtime is not. Look at stage 2. |
| Scans succeed but every `macrosPer100g` is null | Macro resolution is off. Either `FOOD_SOURCE=none`, or the food database could not be read — the boot log says which, loudly. See [Food data](#food-data-foodsource). Identification still works; this is degraded, not broken. |
| openplate shows no "this instance provides its own AI" card | `DEFAULT_INFERENCE_BASE_URL` is unset or unreachable *from the browser*. See the warning in Path A. |

**Offline / pre-seeded install.** Copy the GGUFs into the volume yourself and the
download stage becomes a verification stage. Filenames must match exactly; the
manifest with every filename and sha256 is at the top of
[`scripts/fetch-weights.sh`](scripts/fetch-weights.sh).

```bash
docker run --rm -v openplate-models:/models -v "$PWD:/src" alpine \
  cp /src/LFM2.5-VL-1.6B-Q8_0.gguf /src/mmproj-LFM2.5-VL-1.6b-F16.gguf /models/
```

If you mirror the weights on your own storage, set `WEIGHTS_MIRROR_BASE` to a
base URL holding those filenames; Hugging Face stays the fallback and checksums
are enforced either way, so a mirror cannot hand you different weights.

---

## Hardware & measured latency

Two rules for this section:

1. **Every number is labelled with the hardware it was measured on.** A latency
   figure without its machine is not a measurement.
2. **Projections are labelled as projections.** Nothing below is a guess dressed
   as data.

All measurements are over the same 50-photo gold set with the same prompts.
Full methodology, confidence intervals and the runs themselves are in
[`eval/BASELINE.md`](eval/BASELINE.md) and [`eval/PERFORMANCE.md`](eval/PERFORMANCE.md).

### The profiles

| `MODEL_PROFILE` | model | download | license |
|---|---|---|---|
| `quality` | Qwen3-VL-8B-Instruct, Q4_K_M + F16 mmproj | 5.8 GiB | Apache-2.0 |
| `lite` | LFM2.5-VL-1.6B, Q8_0 + F16 mmproj | 2.0 GiB | LFM Open License v1.0 — **revenue-capped**, [see below](#licensing) |
| `lite-apache` | Qwen3-VL-2B-Instruct, Q4_K_M + F16 mmproj | 1.8 GiB | Apache-2.0 |

Both `lite` variants run on CPU. `quality` runs on CPU too — very slowly — and is
really a GPU profile.

### `quality` on a GPU — measured

| card | p50 per scan | p95 per scan | notes |
|---|---|---|---|
| **RTX 4090** (24 GB) | **0.94 s** | **1.47 s** | 3356 tok/s prefill, 153.6 tok/s decode, server-side |
| **RTX 3090** (24 GB) | **1.72 s** | **2.33 s** | 1749 tok/s prefill, 122.9 tok/s decode |

Both rows: Qwen3-VL-8B-Instruct Q4_K_M + F16 mmproj, 8192 context, images
downscaled to 896 px, llama.cpp `llama-server` b10380, rented pods, 50 photos.
Both **include roughly 0.35–0.6 s of network and proxy round trip** that a
container on your own box does not pay — so on-box serving is *faster* than these
numbers, not slower. Accuracy on the same run: 72.8 % core-item recall with
**zero hallucinations** across the 50 plates, which is statistically
indistinguishable from the cloud frontier model openplate uses by default.

**Any ~24 GB card in that class is fine.** That is what we measured; we did not
measure a smaller one.

**VRAM floor — honestly.** The weights are 4.68 GiB (Q4_K_M) + 1.08 GiB (F16
vision tower) = **5.8 GiB**, and the measured total working set at 8192 context
with 2 slots was **6.3 GB**. So a **12 GB-class card should be comfortable** and
an 8 GB card is plausible-but-tight (you would likely drop context or offload
part of the model). We are telling you the arithmetic rather than a number we
tested, because **24 GB is the only size we actually measured.** If you try 12 GB
and it works, that is useful information.

### The real variable is memory bandwidth, not VRAM

Generation speed on a single request is bandwidth-bound: every token walks the
whole active weight set. The two measured cards are both roughly the **~1,000
GB/s class** (RTX 4090 ≈ 1008 GB/s, RTX 3090 ≈ 936 GB/s), and their measured p50s
track that — 0.94 s vs 1.72 s.

**Projection, not a measurement:** a **~300 GB/s class** card (L4, and the
inference-capable side of most workstation cards) is roughly 3× less bandwidth
than the 3090, which puts it at a **projected 4–6 s per scan**. That is scaled
from the 3090 row, not measured, and real numbers usually come in worse than a
linear scaling. If you have such a card, run it — it is still a perfectly good
self-host experience.

### CPU — measured

Host for every row below: **AMD Ryzen 9 7940HS, 14 threads, no GPU (`-ngl 0`)**,
llama.cpp `llama-server`, 8192 context, the same 50 photos.

**`lite` — the row to plan against.** Measured 2026-08-13 through the *shipped*
service: this exact code, its 896 px downscale, its grammar, its output mapping,
50/50 images, 0 errors, sequential requests over loopback.

| | per plate |
|---|---|
| p50 | **5.5 seconds per plate** |
| p95 | **6.8 s / plate** |
| worst plate observed | 7.2 s |

Source: [`eval/runs/2026-08-13-lite-cpu-v3/results.json`](eval/runs/2026-08-13-lite-cpu-v3/results.json).
**That run measured latency only** — it was not accuracy-scored. `lite`'s recall
figure comes from a *different* run (the 2026-08-12 worksheet: **62.1 %**
core-item recall, and the reason `lite` is documented as the constrained
self-hoster's floor rather than the flagship). Two runs, two numbers, cited
separately on purpose.

**`quality` on the same CPU: ≈94 s / plate** (p50, 2026-08-12) — measured under
the *earlier* verbose pipeline at full image resolution, and **not re-measured
under the shipped pipeline**, so it is an upper bound. The `lite` result above
suggests a similar speedup would apply to the 8B, but that is an inference from
one model to another, not a measurement, and we are not going to publish it as
one. `quality` is a GPU profile.

**RAM (measured RSS):** `lite` 1.55 GB, `quality` 6.31 GB.

**CPU throughput does not improve with concurrency.** Measured head-on: two
simultaneous requests cost 0.75–0.83× of the same two run back to back — a
1.2–1.3× throughput recovery on a 2× fan-out, paid for entirely in per-request
latency (one request alone 2.5 s; two in flight, 3.7 s each). Plan capacity as if
the box were serial.

**Minimum CPU box for `lite`:** 8+ modern cores with AVX2, **4 GB free RAM**
(1.55 GB for the model, headroom for everything else), ~2.5 GB disk. 8 threads
instead of 14 roughly doubles per-plate latency. No GPU, no CUDA, no external
call — verified by [`scripts/smoke-lite.sh`](scripts/smoke-lite.sh), which builds
the CPU image, boots it with no GPU, and puts a real photo through it.

### Self-host has no latency ceiling, and that is deliberate

**A few seconds of local compute per scan is the product, not a bug** — and on
`quality`-on-CPU, a minute and a half is still a real product. A household does
2–5 scans a day; even at the slow end that is a couple of minutes of compute per
day, entirely private, at zero marginal cost. The UX that fits is asynchronous —
snap it, pocket the phone, the plate is analysed when you look again. What does
*not* fit on CPU is a live preview that redraws as you frame the shot.

Concretely: `LATENCY_CEILING_MS` defaults to **0, meaning disabled**, on
self-host. A box that shed load at some threshold would refuse requests it is
perfectly capable of serving.

You may see a **p95 ≤ 10 s per scan** figure quoted in this project's design
notes. **That is a ceiling for a possible future hosted tier, and it does not
apply to self-hosting at all.** Do not read it as a hardware requirement, and do
not expect 10 s from a laptop CPU — the measured CPU rows above are the honest
expectation. If you want a 10 s bound on your own box, set
`LATENCY_CEILING_MS=10000` and it will start rejecting slow work; most
self-hosters should not.

---

## Food data (`FoodSource`)

The model identifies foods and estimates grams. **Macros are resolved from a food
database, by name — never generated by the model.** This is where those numbers
come from and it is worth choosing deliberately.

| `FOOD_SOURCE` | what it does | network | notes |
|---|---|---|---|
| **`fdc`** *(default)* | Looks names up in a bundled extract of **USDA FoodData Central** — **8,041 generic foods**, shipped inside the image at `data/fdc-foods.json`. | **none** | Offline, no key, no account, no outbound request to anyone. Public domain. This is the default because it is the only option that needs nothing from anybody. |
| `off` | Queries **Open Food Facts** live at your runtime. | outbound, per scan | Strong on branded and packaged products, weaker on generic cooked food. **Read the licence note below before enabling.** Nothing OFF-derived ships in this image. |
| `lcc` | Queries the public **lowcarbcheck** API. | outbound, per scan | The best data of the three (curated + BLS + USDA) — and remote-only permanently, because BLS 4.0 forbids redistribution, so it cannot be bundled. Attribution is passed through to the response so it reaches the UI. |
| `none` | No resolution. Every item comes back with null macros. | none | For clients that do their own nutrition lookup. |

```bash
-e FOOD_SOURCE=fdc                         # default
-e FDC_DATASET_PATH=./data/fdc-foods.json  # relative to the working directory
-e LCC_API_URL=https://lowcarbcheck.org    # only read when FOOD_SOURCE=lcc
-e EMBEDDING_RUNTIME_URL=http://…          # optional; enables hybrid re-ranking
```

**Resolved macros are labelled.** Every food in the response carries a
`provenance` of `"corpus"` (looked up in the food database) or `"model"`, plus an
`attribution` string where the source requires one. openplate surfaces that, so
a user can tell a looked-up number from an estimated one — which is the whole
point of not letting the model invent macros.

**A missing food database does not stop scans.** If `FDC_DATASET_PATH` points at
nothing, the service logs a loud warning, disables resolution, and keeps
identifying plates. You get names and grams with null macros — degraded, not
broken. Regenerate the extract with `pnpm food-data:fdc` (needs network).

`EMBEDDING_RUNTIME_URL` is optional. Point it at a second OpenAI-compatible
runtime serving `/v1/embeddings` (e.g. `llama-server --embedding`) and retrieval
becomes **hybrid**: the lexical scorer finds candidates and the embedding model
re-ranks them, so "grilled chicken thigh" lands on the right row even when the
database words it differently. Leave it unset — the default — and retrieval is
lexical-only, which is a slightly worse ranking and never an error. An
unreachable embedding runtime degrades to lexical-only with one warning; it never
fails a scan.

> ### ⚠ `FOOD_SOURCE=off` and ODbL share-alike — read this before enabling
>
> Open Food Facts data is licensed under the **Open Database Licence (ODbL)**,
> which is **share-alike**. If you enable this connector and then publish or
> redistribute a database that incorporates OFF data — not just the individual
> lookups you display, but a *derived database* — the ODbL obliges you to make
> that derived database available under the ODbL as well, and to attribute Open
> Food Facts.
>
> For a household instance that displays a lookup and stores it in your own diary,
> this is a non-issue. **If you are building a product on top of this, it is not
> a non-issue**, and it is the reason `off` is not the default. `fdc` carries no
> share-alike obligation. Choose knowingly.

---

## Configuration

Everything is environment variables, validated at boot; a bad value stops the
process rather than degrading. The annotated master list is
[`.env.example`](.env.example). The ones that matter most:

| variable | default | |
|---|---|---|
| `MODEL_PROFILE` | `lite` | `lite` \| `lite-apache` \| `quality` |
| `API_KEYS` | *(generated)* | Comma-separated bearer keys. Set this. |
| `PORT` | `8300` | The only published port. |
| `CONCURRENCY` | `2` | In-flight scans; also sets llama.cpp's KV slots. |
| `MAX_QUEUE_DEPTH` | `8` | Past this, callers get 429 + `Retry-After`. |
| `RATE_LIMIT_RPM` | `60` | Per key. |
| `LATENCY_CEILING_MS` | `0` | 0 = disabled. See above. Admission policy: refuse work you cannot finish in time. |
| `RUNTIME_COMPLETION_TIMEOUT_MS` | `600000` | Total bound on one completion call; `0` = disabled. Liveness, not latency policy — it releases a worker slot a wedged runtime will never return. See [Bring your own runtime](#bring-your-own-runtime); it applies in bundled mode too. |
| `IMAGE_MAX_LONG_EDGE` | `896` | Downscale target. Latency rises with the square. |
| `FOOD_SOURCE` | `fdc` | See [Food data](#food-data-foodsource). |
| `CONTEXT_SIZE` | `8192` | Context **per in-flight scan**. The container multiplies it by `CONCURRENCY` before handing it to llama.cpp, because llama.cpp's `-c` is the *total* it splits across slots — a trap worth knowing if you ever tune this by hand. |
| `LLAMA_THREADS` | `nproc - 2` | Two cores are left for the service, image decode, and the OS. Giving llama.cpp every core makes the box contended, not faster. |
| `MODELS_DIR` | `/models` | The weights volume. |
| `WEIGHTS_MIRROR_BASE` | *(empty)* | Optional mirror; Hugging Face is the fallback. |
| `GPU_LAYERS` | *(auto)* | Override the GPU auto-detect. `0` forces CPU. |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

`llama-server` runs inside the container bound to **127.0.0.1 only** and is not
reachable from outside it. That is not configurable: it is an unauthenticated raw
vision endpoint, and the point is that you cannot publish it by accident.

---

## API

One endpoint that matters, and it is the OpenAI shape:

```
POST /v1/chat/completions      Authorization: Bearer <key>
GET  /v1/models                Authorization: Bearer <key>
GET  /readyz                   no auth — can it serve a scan right now?
GET  /healthz                  no auth — is the process alive?
```

Send one text part and one `image_url` data URI, exactly as you would to OpenAI.
The model id is `openplate-plate-1`. `choices[0].message.content` is clean,
unfenced JSON:

```json
{
  "foods": [
    { "name": "scrambled eggs", "estimatedGrams": 80, "confidence": "high",
      "portionHint": "a small scoop",
      "macrosPer100g": { "carbs": 1.2, "protein": 10, "fat": 10, "kcal": 140 } }
  ],
  "notes": "…"
}
```

CORS is wide open (`*`) by design — the browser calls this endpoint directly, so
an origin allowlist would mean every self-hoster editing server config. What
makes that safe is the absence of ambient credentials: this service issues no
cookies and reads none, so a hostile page can make a cross-origin request and get
a `401`, because the browser has nothing to attach automatically.

---

## Licensing

**The code in this repository is MIT** ([LICENSE](LICENSE)). Do what you like.

**The model weights are not.** They are third-party works, downloaded at runtime
rather than shipped inside the image, and each carries its own licence. This
matters to you, the operator, not to us.

### Qwen3-VL-8B-Instruct — `quality` profile

**Apache-2.0.** No revenue cap, no field-of-use restriction, commercial use
fine. Source: [`Qwen/Qwen3-VL-8B-Instruct-GGUF`](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF).
This is also why the `quality` profile is the recommended path for anyone doing
anything commercial.

### Qwen3-VL-2B-Instruct — `lite-apache` profile

**Apache-2.0.** Source: [`Qwen/Qwen3-VL-2B-Instruct-GGUF`](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF).

### LFM2.5-VL-1.6B — `lite` profile — ⚠ revenue-capped

`lite` uses **LiquidAI LFM2.5-VL-1.6B** under the **LFM Open License v1.0**
([the licence text, in the model repo](https://huggingface.co/LiquidAI/LFM2.5-VL-1.6B-GGUF/blob/main/LICENSE)).
It is Apache-2.0-shaped with one added condition, and here it is verbatim:

> **5. Commercial Use Limitation.**
>
> (a) The rights granted under this License for Commercial Use are conditioned
> upon You or Your Legal Entity not exceeding the Threshold.
>
> (b) Any Commercial Use of the Work or a Derivative Work by a Legal Entity that
> exceeds the Threshold is not licensed under this Agreement.
>
> (c) The Threshold shall not apply to a Qualified Non-Profit Organization's use
> of the Work or a Derivative Work for Non-Commercial or Research Purposes.

and the definition it turns on:

> **"Threshold"** shall mean annual revenue of 10 million United States dollars
> ($10,000,000) or more.

with "Commercial Use" defined as *"any use of the Work for direct or indirect
commercial advantage or monetary compensation"*, and "Legal Entity" including
parents, subsidiaries and anything under common control.

**Plainly: the $10M revenue cap binds YOU, the operator — not this project.**

- Running `lite` at home, or for a household, or for research: **no cap issue at
  all** — that is not Commercial Use.
- A company under **$10M annual revenue** using it commercially: permitted.
- A company at or over **$10M annual revenue**: **`lite` is not licensed to you.**
  Nothing about this repository changes that, because we are not the licensor and
  the condition attaches to your use of the weights.
- A 501(c)(3) (or foreign equivalent) using it non-commercially: exempt from the
  Threshold by clause 5(c).

This is a licence summary, not legal advice. If the cap might bind you, read the
licence and ask your own lawyer.

### The Apache-2.0 swap-in — one env var, no code change

**Every model slot has an Apache-2.0 alternative**, which is precisely why the
revenue cap is a documentation problem rather than a product problem:

| slot | revenue-capped default | Apache-2.0 alternative |
|---|---|---|
| `quality` (GPU flagship) | — | **already Apache-2.0** (Qwen3-VL-8B-Instruct) |
| `lite` (small/CPU) | LFM2.5-VL-1.6B | **Qwen3-VL-2B-Instruct** → `MODEL_PROFILE=lite-apache` |

```bash
-e MODEL_PROFILE=lite-apache     # that is the entire migration
```

Full disclosure on that swap: **we measured LFM2.5-VL-1.6B and we did not measure
Qwen3-VL-2B.** It is the official Apache-2.0 Qwen3-VL sibling in the same size
class, from the same family as the `quality` model, with first-class llama.cpp
support and an official GGUF release. We expect it to be at least comparable and
we have not proven it. If accuracy matters more to you than the small-model
convenience, `quality` is the measured Apache-2.0 answer.

### Other components

llama.cpp (MIT) — used as the official upstream container image, not vendored.
Food data licences are in [Food data](#food-data-foodsource): USDA FoodData
Central is public domain; Open Food Facts is ODbL and share-alike.

---

## Privacy

Two different trust boundaries, so two separate statements. Read the one that
applies to you.

### Privacy — self-hosted (this is what this repository is)

**Your photos are processed in memory and never persisted.** Concretely:

- **Never written to disk.** There is no upload directory, no temp file, no
  cache. The image is decoded, downscaled in memory, sent to the model runtime on
  the container's loopback interface, and dropped when the request ends.
- **Never logged.** Not the image, not the base64, not a hash of it. The logs
  carry request metadata — status, timing, a key *fingerprint*, never a key —
  and the log formatter scrubs values that could carry payload or credentials.
  **This includes the error paths**, which is where this kind of guarantee
  usually leaks: a stack trace or a validation error that quotes the offending
  input is the classic way a photo ends up in a log file. Error responses and
  error logs are scrubbed, and that behaviour is covered by the unit test suite
  rather than asserted here in prose.
- **Never sent anywhere.** The service makes exactly two kinds of outbound
  request: one-time weight downloads at first boot, and — only if you enable a
  networked `FOOD_SOURCE` — a *text* food-name lookup. **No image ever leaves
  the container**, under any configuration.
- **No accounts, no cookies, no history.** The service stores nothing between
  requests. There is nothing to export, breach, or subpoena.
- **In openplate's flow, the photo goes device → your endpoint directly.** It
  does not pass through openplate's server. You control every hop.

You do not have to take our word for any of that: the code is here, it is small,
and the network surface is one port.

### Privacy — the hosted tier

**There is no hosted tier. It is not launched, and nothing in this document
describes a service you can sign up for.** If one ever exists, it will run this
same open stack on GPU hardware we control in the EU, and it will ship its own
explicit privacy statement — a self-host guarantee cannot be extended to cover a
service where somebody else operates the box. Until that statement exists, the
only privacy claims that apply to you are the self-host ones above.

---

## Development

Requires Node 22 and pnpm.

```bash
pnpm install
pnpm lint                  # oxlint, zero warnings
pnpm typecheck
pnpm test --run            # unit
pnpm test:integration      # against a fake runtime, or set RUNTIME_URL for a real one
pnpm build                 # bundles dist/server.js
```

Run against a local llama.cpp without Docker:

```bash
llama-server -m LFM2.5-VL-1.6B-Q8_0.gguf --mmproj mmproj-LFM2.5-VL-1.6b-F16.gguf \
  -c 8192 --jinja --port 8080
MODEL_RUNTIME_URL=http://127.0.0.1:8080 pnpm dev
```

The full CPU integration check — builds the image, boots it with no GPU, scans a
real photo, asserts the response shape:

```bash
./scripts/smoke-lite.sh          # first run downloads ~2.0 GiB
```

Benchmark harness, gold set, and every number quoted above: [`eval/`](eval/).

A `pre-push` gate (lint → typecheck → unit → build) is committed in `.githooks/`.
Enable it once per clone:

```bash
git config core.hooksPath .githooks
```
