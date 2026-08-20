# Bring your own runtime

If you already run llama.cpp, Ollama, or anything else that speaks the OpenAI
protocol, point this service at it. In that mode it downloads no model and starts
no second copy of one on your hardware.

Check [the support matrix](#support-matrix) before you commit to a runtime: this
pipeline needs grammar-constrained decoding, and not everything that advertises
OpenAI compatibility delivers it. llama.cpp, Ollama and **vLLM on a GPU** are all
measured working. **vLLM's CPU build crashes on the first scan** — same version,
no accelerator, dead worker.

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
starts no `llama-server`, so there is no `/models` volume.

## External-mode variables

- **`MODEL_RUNTIME_URL`** — no trailing `/v1`, the service appends the OpenAI
  paths itself. It must resolve from **inside the container**, so `localhost`
  means the container, not your host. Setting it to a *different* address without
  `MODEL_PROFILE=external` is a boot error rather than a silent override: a
  bundled container always serves from its own loopback. (Setting it to exactly
  the bundled loopback address is allowed and changes nothing — older
  `.env.example` copies shipped that line uncommented.)
- **`MODEL_ID`** — sent to your runtime. llama.cpp ignores it, but **vLLM and
  Ollama both need the exact served model name** — vLLM rejects a mismatch, and
  Ollama uses it to select and load the model. The id *clients* use is always
  `openplate-plate-1` regardless.
- **`MODEL_RUNTIME_API_KEY`** — optional, sent as `Authorization: Bearer …` to
  your runtime. Set it for `vllm serve --api-key …` or an auth proxy. This is
  separate from `API_KEYS`, which is what *callers* present to **this** service.
- **`RUNTIME_COMPLETION_TIMEOUT_MS`** — total bound on one completion call, in
  milliseconds. **Default `600000` (10 minutes); `0` disables it.** It applies in
  **bundled mode too** — a wedged `llama-server` is as mute as a misrouted proxy.
  If your hardware legitimately needs longer than ten minutes per plate, raise it
  or set it to `0`; the failure message names the variable.

  This is not `LATENCY_CEILING_MS`. That one is *admission policy*: refuse work
  you cannot finish in time, before starting it. This one is *liveness*: release
  a worker slot an upstream is never going to return.

  A bound was already in effect before this variable existed: Node's `fetch`
  defaults `headersTimeout` to 300 s, and because a non-streaming completion
  writes its headers only when generation finishes, that acts as a 300 s total
  cap — reachable on hardware this project supports. Setting
  `RUNTIME_COMPLETION_TIMEOUT_MS` explicitly *loosens* that default.

  It is not "wait forever" because with `CONCURRENCY=2`, two wedged in-flight
  scans hold both worker slots permanently while `/readyz` stays green — the
  readiness probes hit a different endpoint and cannot see it.

## Your runtime must enforce grammar-constrained decoding

This is a hard requirement. The pipeline makes a single vision call with
`response_format: {"type": "json_schema", "json_schema": {"name": …, "strict":
true, "schema": …}}` and trusts the shape that comes back. There is no
parse-and-retry loop.

The dangerous failure is not rejection, it is acceptance-and-ignore — a runtime
that takes the `response_format` field, discards it, and returns plausible JSON
that misses the contract. That does not surface as an error. It surfaces as
slightly wrong gram estimates.

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
and this service will return 502 on every scan with a message saying so.

## Support matrix

Measured first-hand on 2026-08-15. Rows we have not run ourselves say so.

| Runtime | Version | Grammar | Image input | Verdict |
|---|---|---|---|---|
| **llama.cpp** (`llama-server`) | b10330 | enforced (GBNF) | base64 data URL | ✅ **works** — this is what the bundled image runs |
| **Ollama** | 0.32.13 | enforced | base64 data URL | ✅ **works** — see the readiness note below |
| **vLLM** (CPU build) | 0.27.1 | — | — | ❌ **broken** — a `json_schema` request **kills the server** (`pin_memory=True requires a CUDA or other accelerator backend`). Plain completions work, so it looks healthy until the first real scan takes the process down |
| **vLLM** (GPU build) | 0.27.1 | enforced (xgrammar) | base64 data URL | ✅ **works** — measured on an RTX 3090 with `Qwen3-VL-2B-Instruct` |
| anything else | — | — | — | ⚠️ **untested** — run the curl above |

**Same version, opposite outcomes — it is the CPU build specifically.** The GPU
test ran the *identical* vLLM image that dies on CPU (`vllm/vllm-openai:latest`
and `v0.27.1` share a digest), with the same schema and the same base64 image
this service sends. On the GPU it returned schema-valid JSON in 1.8 s and stayed
up. Read the ❌ row as "do not run vLLM without a GPU", not as "vLLM is
unsupported".

**Why the CPU build dies.** Grammar-constrained decoding builds a token bitmask
and allocates it in *pinned* memory — a page-locked buffer whose purpose is fast
copying to a GPU. Ask for that with no accelerator present and PyTorch raises
rather than ignoring it, and because this happens while serving rather than while
validating, it takes the worker down instead of returning an error. This is an
upstream bug: the same payload llama.cpp and Ollama both handle correctly.

**One vLLM quirk worth knowing.** With a prompt the model cannot answer in the
required shape, we saw it emit `{` followed by whitespace until it hit the token
cap — the grammar holds (it never produced prose, even when explicitly asked for
a haiku), but the model fills the unconstrained whitespace instead of the
content. That surfaces here as the `finish_reason: length` error, which names the
token cap. A real plate photo did not trigger it; an off-task prompt did.

If you run a row we have not, please open an issue with the result.

## Three configuration traps

**1. Context window — the symptom is garbled output, not a startup error.** Too
small a window does not fail loudly. It drops the front of your prompt and you
get confident nonsense.

Prompt size depends on your model. Two first-hand measurements of the *same*
896 px downscaled plates:

| Model | Prompt tokens (896 px plate) |
|---|---|
| Qwen3-VL-8B on llama.cpp | **1,287 – 3,507** across the 10-plate corpus |
| moondream on Ollama | **746** |

Do not size from these numbers — read your own. Run one scan against your runtime
and look at what it reports:

```bash
curl -s .../v1/chat/completions -d '…' | jq .usage.prompt_tokens
```

Size the window above your own worst case, with headroom. On vLLM that is
`--max-model-len`. On Ollama it is `num_ctx` — set it in a Modelfile, because we
measured `OLLAMA_CONTEXT_LENGTH=8192` failing to raise a model's reported context
above 2048 (Ollama appears to clamp to the model's own trained context, so a
model with a small trained window cannot be given a bigger one).

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
failing in seconds. `start_period` is baked in at build time, so **override it** —
see the commented block in
[`docker/compose.yml`](../docker/compose.yml).

## Readiness, and what it does not tell you

`/readyz` asks your runtime `GET /health`, and falls back to `GET /v1/models` for
runtimes that have no `/health` (Ollama does not). Two limits:

- **Against Ollama, `/v1/models` is liveness, not readiness.** It answers `200`
  with zero models resident — Ollama loads lazily on first request — so a ready
  reading means "reachable", not "warm". Your first scan absorbs the load time.
- **`/readyz` cannot validate `MODEL_RUNTIME_API_KEY` when `/health` is open.**
  On vLLM, `/health` is unauthenticated while `/v1/chat/completions` is not. A
  wrong key therefore reports **ready** and fails every scan with a 502. If scans
  return 502 against a ready service, check the key first.

A `503` from llama.cpp's `/health` means *loading* and is reported as not-ready —
it is never treated as "this runtime has no `/health`".

`/readyz` also reports the **optional** embeddings runtime, as a three-state
field that never affects the status code — lexical-only retrieval is the default,
not an outage:

| `embeddingReady` | Meaning |
|---|---|
| `null` | `EMBEDDING_RUNTIME_URL` is unset. Retrieval is lexical-only by configuration. Normal. |
| `true` | Configured and answering. Retrieval is hybrid. |
| `false` | Configured and **failing** — `embeddingReason` says why (e.g. `http 401`). Ranking is worse until fixed. |

`embeddingReason` is `null` whenever nothing is wrong, so alerting on
`embeddingReason !== null` is safe. A wrong `EMBEDDING_RUNTIME_API_KEY` shows up
here and nowhere else: it degrades ranking rather than failing scans.

## Does your runtime give good answers?

Compatibility is not accuracy. A runtime can enforce the schema perfectly and
still be paired with a model that reads plates badly. `eval/run-50img.sh` scores
any endpoint against the same 50-image gold set every number in these docs came
from — point it at yours before trusting the output.

For per-model serving notes (flags, quirks, and measured behaviour for the models
we ran), see [`eval/SERVING.md`](../eval/SERVING.md).
