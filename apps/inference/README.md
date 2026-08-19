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

## What it is, and what it is not

**It is:**

- **Food identification and portion estimation from your own photos.** The model
  names what is on the plate and estimates how many grams of each thing there is.
- **A single self-contained container.** The model runtime (llama.cpp) and the
  HTTP service ship together. Weights download on first boot into a volume.
- **A harness for a runtime you already have.** If you run llama.cpp, Ollama, or
  vLLM-on-GPU today, set `MODEL_PROFILE=external` and this downloads nothing and
  starts no second model. Check the [support matrix](docs/runtimes.md#support-matrix)
  first — vLLM's **CPU** build cannot run this.
- **CPU-viable.** A machine with no GPU runs the `lite` profile, slowly. See
  [Hardware & measured latency](docs/hardware.md).
- **OpenAI-protocol compatible**, so anything that can talk to an
  OpenAI-compatible endpoint can talk to this, not just openplate.

**It is not:**

- **Not a macro guesser.** The model identifies foods and estimates grams. The
  carbs/protein/fat/kcal numbers come from a **food database**, resolved by
  name — they are looked up, never invented by the language model. See
  [Food data](docs/configuration.md#food-data-foodsource).
- **Not an account system.** There are no users, no sessions, no cookies. Auth is
  one bearer key. Restart it and you have lost nothing.
- **Not a cloud service.** The only outbound network request the container ever
  makes is downloading model weights, once. See [Privacy](docs/privacy.md).
- **Not a medical device, and not dietary advice.** Portion estimation from a
  single 2D photo is hard; treat the grams as a starting point you correct, which
  is how openplate's UI presents them.
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

Take a photo in openplate. You are done.

---

## Something not working?

[`docs/troubleshooting.md`](docs/troubleshooting.md) walks the three boot stages
(download → model load → ready) with the log output each one prints, and has a
symptom table for the common failures: 401s, 502s, stalled downloads, checksum
mismatches, null macros, and the missing "this instance provides its own AI"
card.

## Documentation

| | |
|---|---|
| [Bring your own runtime](docs/runtimes.md) | Point this at an llama.cpp / Ollama / vLLM you already run. Support matrix, the grammar-enforcement requirement and how to test for it, per-runtime setup traps. |
| [Configuration](docs/configuration.md) | Every environment variable, and the food-database (`FOOD_SOURCE`) options. |
| [Hardware & measured latency](docs/hardware.md) | Profiles, measured GPU and CPU numbers, VRAM and RAM floors, minimum box. |
| [API](docs/api.md) | Endpoints, request and response shape, status codes, CORS. |
| [Troubleshooting](docs/troubleshooting.md) | Boot stages, symptom table, offline / pre-seeded install. |
| [Licensing](docs/licensing.md) | Model weight licences, the `lite` revenue cap, and the Apache-2.0 swap-in. |
| [Privacy](docs/privacy.md) | What happens to a photo, and what never leaves the container. |

Benchmark harness, gold set, and every number quoted in these docs:
[`eval/`](eval/).

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

A `pre-push` gate (lint → typecheck → unit → build) is committed in `.githooks/`.
Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

## Licence

Code: MIT ([LICENSE](LICENSE)). Model weights are third-party works with their
own terms — see [Licensing](docs/licensing.md).
