# Hardware & measured latency

Every number here is labelled with the hardware it was measured on, and
projections are labelled as projections.

All measurements are over the same 50-photo gold set with the same prompts. Full
methodology, confidence intervals and the runs themselves are in
[`eval/BASELINE.md`](../eval/BASELINE.md) and
[`eval/PERFORMANCE.md`](../eval/PERFORMANCE.md).

## The profiles

| `MODEL_PROFILE` | model | download | license |
|---|---|---|---|
| `quality` | Qwen3-VL-8B-Instruct, Q4_K_M + F16 mmproj | 5.8 GiB | Apache-2.0 |
| `lite` | LFM2.5-VL-1.6B, Q8_0 + F16 mmproj | 2.0 GiB | LFM Open License v1.0 — revenue-capped, see [Licensing](licensing.md) |
| `lite-apache` | Qwen3-VL-2B-Instruct, Q4_K_M + F16 mmproj | 1.8 GiB | Apache-2.0 |

Both `lite` variants run on CPU. `quality` runs on CPU too — very slowly — and is
really a GPU profile.

## `quality` on a GPU — measured

| card | p50 per scan | p95 per scan | notes |
|---|---|---|---|
| **RTX 4090** (24 GB) | **0.94 s** | **1.47 s** | 3356 tok/s prefill, 153.6 tok/s decode, server-side |
| **RTX 3090** (24 GB) | **1.72 s** | **2.33 s** | 1749 tok/s prefill, 122.9 tok/s decode |

Both rows: Qwen3-VL-8B-Instruct Q4_K_M + F16 mmproj, 8192 context, images
downscaled to 896 px, llama.cpp `llama-server` b10380, rented pods, 50 photos.
Both **include roughly 0.35–0.6 s of network and proxy round trip** that a
container on your own box does not pay, so on-box serving is faster than these
numbers, not slower. Accuracy on the same run: 72.8 % core-item recall with
**zero hallucinations** across the 50 plates, statistically indistinguishable
from the cloud frontier model openplate uses by default.

Any ~24 GB card in that class is fine. That is what we measured; we did not
measure a smaller one.

**VRAM floor.** The weights are 4.68 GiB (Q4_K_M) + 1.08 GiB (F16 vision tower) =
**5.8 GiB**, and the measured total working set at 8192 context with 2 slots was
**6.3 GB**. So a **12 GB-class card should be comfortable** and an 8 GB card is
plausible but tight (you would likely drop context or offload part of the model).
That is arithmetic, not a tested number — **24 GB is the only size we measured**.
If you try 12 GB and it works, that is useful information.

## The real variable is memory bandwidth, not VRAM

Generation speed on a single request is bandwidth-bound: every token walks the
whole active weight set. The two measured cards are both roughly the **~1,000
GB/s class** (RTX 4090 ≈ 1008 GB/s, RTX 3090 ≈ 936 GB/s), and their measured p50s
track that — 0.94 s vs 1.72 s.

**Projection, not a measurement:** a **~300 GB/s class** card (L4, and the
inference-capable side of most workstation cards) has roughly 3× less bandwidth
than the 3090, which puts it at a **projected 4–6 s per scan**. That is scaled
from the 3090 row, not measured, and real numbers usually come in worse than a
linear scaling.

## CPU — measured

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

Source:
[`eval/runs/2026-08-13-lite-cpu-v3/results.json`](../eval/runs/2026-08-13-lite-cpu-v3/results.json).
That run measured latency only — it was not accuracy-scored. `lite`'s recall
figure comes from a *different* run (2026-08-12: **62.1 %** core-item recall,
which is why `lite` is documented as the constrained self-hoster's floor rather
than the flagship). Two runs, two numbers, cited separately.

**`quality` on the same CPU: ≈94 s / plate** (p50, 2026-08-12) — measured under
an earlier, more verbose pipeline at full image resolution, and not re-measured
under the shipped pipeline, so treat it as an upper bound. `quality` is a GPU
profile.

**RAM (measured RSS):** `lite` 1.55 GB, `quality` 6.31 GB.

**CPU throughput does not improve with concurrency.** Measured: two simultaneous
requests cost 0.75–0.83× of the same two run back to back — a 1.2–1.3× throughput
recovery on a 2× fan-out, paid for entirely in per-request latency (one request
alone 2.5 s; two in flight, 3.7 s each). Plan capacity as if the box were serial.

**Minimum CPU box for `lite`:** 8+ modern cores with AVX2, **4 GB free RAM**
(1.55 GB for the model, headroom for everything else), ~2.5 GB disk. 8 threads
instead of 14 roughly doubles per-plate latency. No GPU, no CUDA, no external
call — verified by [`scripts/smoke-lite.sh`](../scripts/smoke-lite.sh), which
builds the CPU image, boots it with no GPU, and puts a real photo through it.

## No latency ceiling by default

`LATENCY_CEILING_MS` defaults to **0, meaning disabled**. A box that shed load at
some threshold would refuse requests it is perfectly capable of serving, and on
CPU a scan legitimately takes seconds to minutes. The UX that fits is
asynchronous: take the photo, put the phone away, the plate is analysed when you
look again. What does not fit on CPU is a live preview that redraws as you frame
the shot.

If you want a bound on your own box, set `LATENCY_CEILING_MS=10000` and the
service starts rejecting work it cannot finish in ten seconds. Most self-hosters
should leave it disabled.
