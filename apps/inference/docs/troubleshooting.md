# Troubleshooting

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

If a checksum fails, the log prints the exact command to delete the bad file and
retry. Follow it. If it fails twice on the same file, something between you and
Hugging Face is altering the download (a captive portal or filtering proxy will
do this) — try another network, or pre-seed the volume by hand (below).

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

`/readyz` returns 200 from here on. The service starts listening *before* the
model finishes loading, deliberately — a boot that blocked on a multi-GB load is
indistinguishable from a hung container. Until the runtime is up, `/readyz` says
so.

## Common failures, in the order they happen

| symptom | cause |
|---|---|
| Container exits immediately, one line of stderr | Bad configuration. The message names the variable. Config is validated at boot: a service that starts without a model runtime answers every scan with a 502. |
| Download stalls, no progress | Restart; it resumes. |
| `CHECKSUM MISMATCH` | Follow the printed recovery command. |
| `/readyz` never reaches 200, logs stop after stage 2 | Out of memory during model load. Check `docker stats` and the [memory floors](hardware.md). |
| Scans return 401 | Wrong or stale key. A restart regenerates the boot key — set `API_KEYS`. |
| Scans return 429 with `Retry-After` | Working as intended: the queue is full or you exceeded `RATE_LIMIT_RPM`. |
| Scans return 502 | The service is up and the model runtime is not. Look at stage 2. In external mode, check `MODEL_RUNTIME_API_KEY` — see [Readiness](runtimes.md#readiness-and-what-it-does-not-tell-you). |
| Scans succeed but every `macrosPer100g` is null | Macro resolution is off. Either `FOOD_SOURCE=none`, or the food database could not be read — the boot log says which. See [Food data](configuration.md#food-data-foodsource). Identification still works. |
| openplate shows no "this instance provides its own AI" card | `DEFAULT_INFERENCE_BASE_URL` is unset or unreachable *from the browser*. See Path A in the [README quickstart](../README.md#4-point-openplate-at-it). |

## Offline / pre-seeded install

Copy the GGUFs into the volume yourself and the download stage becomes a
verification stage. Filenames must match exactly; the manifest with every
filename and sha256 is at the top of
[`scripts/fetch-weights.sh`](../scripts/fetch-weights.sh).

```bash
docker run --rm -v openplate-models:/models -v "$PWD:/src" alpine \
  cp /src/LFM2.5-VL-1.6B-Q8_0.gguf /src/mmproj-LFM2.5-VL-1.6b-F16.gguf /models/
```

If you mirror the weights on your own storage, set `WEIGHTS_MIRROR_BASE` to a
base URL holding those filenames; Hugging Face stays the fallback and checksums
are enforced either way, so a mirror cannot hand you different weights.

## Still stuck?

- Runtime compatibility problems (502 on every scan, garbled output, wrong
  concurrency): [Bring your own runtime](runtimes.md).
- Slow but working: [Hardware & measured latency](hardware.md).
- Anything else: open an issue with your runtime kind and version, the model in
  use, the request and response involved, and your `/readyz` output.
