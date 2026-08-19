# Performance — measured, not estimated

**Measured on: AMD Ryzen 9 7940HS (`bluefin`), 16 threads (`-t 14`), CPU-only (`-ngl 0`),
llama.cpp `llama-server` b10330 with Q4_K_M / Q8_0 GGUFs, 2026-08-11.** 62 GB RAM total,
~10 GB free at run start. Ctx 8192. No GPU anywhere in these numbers.

This is the canonical performance document for openplate-inference. Everything below is
recomputed from the per-request `latency_ms` arrays in `runs/*/results.json` — not from prose
in an earlier scoring file. Where an older doc quotes a different figure, this one wins, and
the divergence is explained inline.

Corpus: the same 10 gold-labeled plate photos for every row (`gold/gold_labels.json`).
**n=10 is the load-bearing caveat on every accuracy number** — see the accuracy section.

---

## 1. Per-request latency

Wall-clock per plate, end to end (image → validated JSON). Percentiles are linear-interpolated
over the 10 per-plate measurements; with n=10 the "p95" is essentially the second-worst plate,
so read it as *observed tail*, not as a statistical p95.

| Approach | run | p50 | mean | p95 | observed range |
|---|---|---|---|---|---|
| `lfm-vl` single-shot (LFM2.5-VL-1.6B Q8_0) | `2026-08-11-local-lfm` | **28.7 s** | 28.5 s | 39.6 s | 19.0 – 40.5 s |
| ensemble n=3 (lfm-vl ×3 + LFM2.5-2.6B judge) | `2026-08-11-local-lfm-n3` | **119.0 s** | 113.2 s | 154.9 s | 69.9 – 157.8 s |
| ensemble n=5 (lfm-vl ×5 + same judge) | `2026-08-11-local-lfm` | **183.6 s** | 183.9 s | 232.9 s | 126.1 – 235.2 s |
| `qwen-vl` single-shot (Qwen3-VL-8B Q4_K_M) | `2026-08-11-local-v2-qwenvl` | **105.0 s** | 107.7 s | 155.0 s | 70.8 – 155.9 s |

Cloud reference rows, same corpus, same prompt (`2026-08-11-openrouter-pilot`), for scale only:
Gemini 3.1 Flash Lite p50 **2.8 s** (mean 3.3, range 2.2–5.5); Qwen3-VL-8B via OpenRouter p50
**4.0 s** (mean 9.6 — two retry outliers to 32.8 s); Gemma-4-26B-A4B ensemble ×5 p50 **40.4 s**
(mean 42.5). OpenRouter wall time is not a self-hosting measurement.

### Where the ensemble time goes

The ensemble total is not mysterious: it is the fan-out serialized, plus one expensive judge call.

| Stage | n=3 run | n=5 run |
|---|---|---|
| vision candidate call (each) | p50 32.4 s, mean 30.8 s (n=30) | p50 39.7 s, mean 41.3 s (n=50) |
| judge merge call (one per plate) | p50 56.3 s, mean 58.2 s | p50 70.4 s, mean 75.0 s |
| total per plate | p50 119.0 s | p50 183.6 s |

`max_parallel: 2` in both configs, and the numbers show why that doesn't help much:
3 × 32.4 + 56.3 = 153 s of *work* lands as 119 s of wall clock, and 5 × 39.7 + 70.4 = 269 s of
work lands as 184 s. Two in flight against one llama.cpp instance recovers ~25–30 %, not 2×,
because both requests are contending for the same 14 threads. The judge is a single call and
cannot be parallelized at all — at n=3 it is **47 % of the plate's wall clock**.

### `qwen-vl` latency is prompt+completion-token-linear

`qwen-vl`'s spread is fully explained by token counts at its measured throughput
(prefill 32.5 tok/s, generation 7.5 tok/s):

```
predicted_seconds ≈ prompt_tokens / 32.5 + completion_tokens / 7.5
```

Across the 10 plates that predictor correlates with measured wall time at **r = 0.973**:

| img | prompt tok | completion tok | predicted | measured |
|---|---|---|---|---|
| 01 | 1827 | 726 | 153.0 s | 155.9 s |
| 03 | 1287 | 794 | 145.5 s | 124.9 s |
| 05 | 1827 | 243 | 88.6 s | 70.8 s |
| 07 | 2747 | 129 | 101.7 s | 92.4 s |
| 10 | 3507 | 342 | 153.5 s | 153.9 s |

Prompt tokens ranged **1287 – 3507** and completion tokens **129 – 794** over the corpus.

> **Two figure corrections, so nobody re-derives them.**
> 1. `SERVING.md` records `qwen-vl-q8` fresh-image latency as mean **65.9 s**, range 42.5–100.4 s,
>    with image prompt tokens 692–2152. Those are *smoke-test* numbers: a one-line free-text
>    prompt producing ~30 tokens of output. The harness sends openplate's production system
>    prompt and gets 129–794 completion tokens back, which at 7.5 tok/s adds 17–106 s. **The real
>    production-prompt cost of Qwen3-VL-8B on this CPU is ~105 s per plate, not ~65 s.**
> 2. `SERVING.md`'s `qwen-vl` "~37 s / image" headline is a 4-image smoke mean on the cheapest
>    plates in the corpus. Superseded by the p50 above.

---

## 2. Accuracy alongside the latency

Core-item recall over the 42 gold core items in the 10-image corpus. Sources:
`runs/2026-08-11-local-lfm/SCORING.md`, `runs/2026-08-11-local-v2-SCORING.md`,
`runs/2026-08-11-openrouter-pilot/SCORING.md`.

| Approach | recall | halluc. | trap leaks | p50 latency | cost/plate | RAM |
|---|---|---|---|---|---|---|
| `lfm-vl` single-shot (local) | 71.4 % | 1 | 0 | 28.7 s | $0 | 1.5 GB |
| ensemble n=3 (local) | **88.1 %** | 3 | 2 | 119.0 s | $0 | 4.4 GB |
| ensemble n=5 (local) | **90.5 %** | 4 | 1 | 183.6 s | $0 | 4.4 GB |
| `qwen-vl` Q4 single-shot (local) | 81.0 % | 0 | 0 | 105.0 s | $0 | 6.3 GB |
| *cloud ref* — Gemini 3.1 Flash Lite | 88.1 % | 0 | 0 | 2.8 s | $0.00102 | — |
| *cloud ref* — Qwen3-VL-8B (FP, OpenRouter) | 92.9 % | 0 | 0 | 4.0 s | $0.00041 | — |
| *cloud ref* — Gemma-4-26B-A4B ensemble ×5 | 97.6 % | 0 | 0 | 40.4 s | $0.00182 | — |

> ### ⚠ n=10: 42 core items, so **one item ≈ 2.4 recall points**
> Every gap in that table smaller than ~5 points is inside the instrument's noise. Concretely:
> the four judge variants measured in `2026-08-11-local-v2-SCORING.md` span 78.6 – 88.1 %, which
> is **four items** — the eval cannot rank them. Treat this table as an order-of-magnitude map
> (single-shot < ensemble; 1.6B ensemble ≈ cloud single-shot), never as a leaderboard. The
> 50-image harness exists to buy the discriminating power that judge-level decisions need.

Two facts that survive the noise band, because they are large or structural:

- **Ensemble+judge lifts a 1.6B model 71.4 % → 88.1/90.5 %** — a 17–19 point move, well outside
  noise, and the architecture's core bet validated on-device at $0 and full privacy.
- **Local Q4 Qwen3-VL-8B scores 81.0 % against 92.9 % for the same model served FP in the cloud.**
  The losses are enumeration depth, not gross errors.

---

## 3. Web-server throughput

### Concurrency buys almost nothing

*(Measured head-on in [§7](#7-concurrency-probe--two-simultaneous-requests-measured-2026-08-13);
this subsection is the inference from the ensemble runs, and §7 confirms it.)*

Each request saturates the thread pool. `llama-server` with `-t 14` on 16 cores puts one
generation across all 14 threads; a second concurrent request does not find idle silicon, it
splits the same silicon. The measured evidence is in §1: `max_parallel: 2` turned 153 s of work
into 119 s (n=3) and 269 s into 184 s (n=5) — a **1.3–1.5× recovery on a 2× fan-out**, all of it
from overlapping one request's prefill with another's decode, not from parallelism.

**Plan capacity as if the box were serial.** Adding worker processes on one CPU box does not add
plates/hour; it adds queueing latency and RAM pressure. Concurrency limits should be set to
protect latency (reject or queue past 1–2 in flight), not to raise throughput.

### Serial throughput

Derived from the p50s above (`3600 / p50`):

| Approach | p50 | plates/hour (serial) | plates/24 h (theoretical ceiling) |
|---|---|---|---|
| `lfm-vl` single | 28.7 s | **125** | 3 010 |
| ensemble n=3 | 119.0 s | **30** | 726 |
| ensemble n=5 | 183.6 s | **20** | 470 |
| `qwen-vl` Q4 single | 105.0 s | **34** | 823 |

### The honest haircuts

The 24 h column is a ceiling nobody reaches. Three deductions, all real:

1. **Thermal throttling.** These are laptop-class numbers measured in bursts of ~10 plates
   (6–30 min). A 7940HS held at 14-thread AVX512 load for hours clocks down; sustained
   throughput is below burst throughput. Not yet measured — a sustained-load run is the obvious
   next measurement.
2. **The web server shares the box.** These runs had the app, DB, and OS competing for the
   remaining 2 cores. One measured plate (`qwen-vl-q8`, image 02: 85.1 s at 1312 prompt tokens vs
   48.8 s at 1232) came in ~1.7× slow purely because the host was at 0 GB free with swap
   consumed. Memory and core headroom are not free.
3. **Peaks cluster.** Scans arrive at meal times, not on a Poisson-flat 24 h curve. A serial box
   sized to the daily mean will have a visible queue at 19:00.

**Working rule: multiply the 24 h ceiling by ~0.6.** That is a planning haircut, not a
measurement — it is the number to replace first once sustained-load data exists.

| Approach | 24 h ceiling | × 0.6 effective | users @ 5 scans/user/day |
|---|---|---|---|
| `lfm-vl` single | 3 010 | ~1 800 | **~350** |
| ensemble n=3 | 726 | ~440 | **~85** |
| ensemble n=5 | 470 | ~280 | ~55 |
| `qwen-vl` Q4 single | 823 | ~490 | ~100 |

**Bottom line: one CPU box serves roughly 100 lite-ensemble (n=3) users, or roughly 300
single-shot users, at ~5 scans per user per day.** That is a real, useful number for a
self-hosted or small-tenant deployment, and a hopeless one for a consumer-scale hosted tier.

---

## 4. Self-hosting guidance

**These numbers are fine for household self-hosting, and that is not a consolation prize.** A
household does 2–5 scans/day, not 500. At n=3 the box is busy ~10 minutes a day. The UX that
fits is asynchronous — "snap it, pocket the phone, the plate is analyzed when you look again" —
and with streamed partials the wait is invisible. What does *not* fit is an interactive preview
that redraws as you frame the shot; do not build that on CPU.

### RAM footprint per model key

Measured RSS (`serve/models.json`, `ram_gb_observed`):

| key | model | RSS | disk (model + mmproj) | notes |
|---|---|---|---|---|
| `lfm-vl` | LFM2.5-VL-1.6B Q8_0 | **1.55 GB** | 1.16 + 0.79 GB | the vision workhorse |
| `lfm-judge` | LFM2.5-2.6B Q8_0, reasoning off | **3.03 GB** | 2.68 GB | the merge judge |
| `lfm-judge-think` | same GGUF, `--reasoning-budget 256` | **3.03 GB** | +0 GB | shares weights; don't run both |
| `qwen-judge` | Qwen3-4B-Instruct-2507 Q4_K_M | **3.68 GB** | 2.33 GB | alternate judge |
| `qwen-vl` | Qwen3-VL-8B-Instruct Q4_K_M | **6.31 GB** | 4.68 + 1.08 GB | cannot co-reside with a judge |
| `qwen-vl-q8` | Qwen3-VL-8B-Instruct Q8_0 | **9.69 GB** (11.36 GB peak) | 8.11 GB + shared mmproj | needs the box to itself; see §6 |

**`lfm-vl` + `lfm-judge` co-resident measured at 4.4 GB total** — that pair is the whole n=3
lite profile, and it fits comfortably. RSS for `qwen-vl-q8` *grows after load* (9.69 → 11.36 GB
over ~8 plates as llama-server fills 4 KV slots at `n_ctx_slot 8192`); budget on peaks.

### Minimum viable box

- **≥ 8 GB free RAM** (not total — free) for the n=3 lite profile with headroom for the app and
  DB. 6 GB will run it; 4 GB will swap and you will measure the swap, as we did.
- **8+ modern cores** with AVX2. The measurements above are 14 threads; 8 threads roughly
  doubles per-plate latency, which is still fine for a household but halves the capacity table.
- **No GPU required.** Every number in this document is CPU-only.
- ~21 GB disk if you pull every model key; ~5 GB for just the n=3 lite profile.

### Profile defaults

- **n=3 is the CPU default.** 88.1 % recall at 119 s. n=5 buys 2.4 points — *one item*, inside
  the noise band — for +65 s per plate (+54 %). That trade is not defensible on CPU.
- **n=5 is GPU-tier.** Re-evaluate it when the fan-out is cheap, not before.
- **Single-shot `lfm-vl` is the "fast/cheap" tier**, at a real 17-point recall cost. Image 08 is
  the cautionary example: single-shot called a yogurt bowl a "side salad" (0/3); the ensemble
  repaired it to 3/3.
- **Single-shot `qwen-vl` Q4 is dominated on CPU** — 81.0 % for 105 s, i.e. worse recall than
  n=3 (88.1 %) at nearly the same wall clock and 6.3 GB instead of 4.4 GB. It stays interesting
  as a *GPU* single-shot candidate, where its 92.9 % FP cloud score is the relevant number.

---

## 5. Product SLO — and the gap

> **PRODUCT REQUIREMENT (stated 2026-08-11): p95 ≤ 10 s per plate scan for the hosted tier.**

**CPU cannot meet this on any configuration measured here.** The best single-shot p50 is
**28.7 s** — already ~3× over budget at the *median*, before the tail. The observed tails are
39.6 s (single) and 154.9 s (n=3), 4–15× over. This is not a tuning gap that prompt work,
quantization, or thread counts will close: the floor is set by image prefill and token
generation rates on the CPU.

The only configurations that hit ≤10 s today are cloud APIs (2.8–4.0 s p50), which is precisely
the dependency the project exists to remove.

### The path is GPU serving

All figures in this subsection are **ESTIMATES pending measurement — none of it has been
measured on any GPU.** They are extrapolations from published GPU-vs-CPU llama.cpp throughput
ratios and the measured token counts above, recorded so the plan is falsifiable, not so it can
be quoted as fact.

- **Estimated 20–40× speedup** on both stages of the pipeline.
- **Vision encode ~1 s** per image (measured CPU prefill: 1287–3507 tokens at 25–33 tok/s
  ≈ 40–110 s).
- **Generation 100+ tok/s** (measured CPU: 7.5 tok/s for the 8B, 29.9 tok/s for the 1.6B).
- **n=5 ensemble ~5–10 s per plate**, batched — which would put the *high-accuracy* profile
  inside the SLO, not merely the single-shot one.

If those hold, the SLO is comfortably met by the ensemble profile and the quality/latency
trade-off inverts: n=5 becomes the default and the CPU-tier compromises in §4 stop applying.
**The next measurement this document needs is a single GPU run of `configs/local-cpu-v2.json`
against a CUDA `llama-server`.** Until that exists, treat "GPU fixes it" as a hypothesis with a
plausible mechanism and no data.

---

## 6. Dead ends — measured negatives

Each of these was investigated on 2026-08-11 and produced a definitive negative result. The
evidence trail is in `SERVING.md` and the `SCORING.md` files; this is the index.

| Dead end | Verdict | Evidence |
|---|---|---|
| **Moondream 3** as a local vision model | **Not servable** | Three independent checks: (a) no GGUF exists for v3 — `moondream3-preview` ships safetensors + custom Python, and a HF sweep returns GGUFs for moondream2 only; (b) llama.cpp does not implement the arch — no `moondream` entry in `llama-arch.cpp`/`clip.cpp`, no strings in the binary, and no converter path (moondream2 worked by mapping onto `phi2`; v3's MoE does not); (c) ollama has no v3 — `library/moondream3` 404s. Revisit only if a `moondream3` GGUF or an upstream arch lands. |
| **Qwen3-VL-8B at Q8_0** to recover the lost 12 points | **Zero accuracy gain, 2.2× slower** | Clean single-variable A/B: `qwen-vl` and `qwen-vl-q8` use the **byte-identical F16 mmproj**, so only LM quant differs. On the 4 overlapping plates: 2 identical, 1 identical modulo plural, and 1 where **Q8 returned one item fewer** (dropped a lemon wedge Q4 caught). Cost: 2.2× slower generation, ~1.3× slower prefill, +3.4 GB RAM, +8.11 GB disk. |
| **"Maybe the vision tower quant is hurting accuracy"** | **Impossible — it was never quantized** | The official repo publishes exactly two mmproj files, F16 (1159029824 B) and Q8_0 (752289728 B); there is no BF16. Both Qwen runs used the F16. **Combined with the row above, quantization is ruled out on both axes** (LM *and* vision tower) as the explanation for the Q4 accuracy ceiling. Look at prompt, image resolution/patching, or model scale. |
| **Judge prompt-hardening on the 2.6B LFM judge** | **Capability-bound, not prompt-bound** | Hardened prompt + `maxItems: 6` GBNF constraint scored **85.7 %, below the 88.1 % original**, with *more* case-dupes ("Salmon"/"salmon") and more hallucinated merges. Grammar can bound item *count* but not semantic discipline. Related: the poster-trap leak **cannot** be fixed in the judge at all — the judge is text-only and blind, so when 2 of 3 candidates report a wall-poster burrito it sees only agreement. That fix belongs in the vision variant prompts or a candidate-level `background: bool`. Judge hardening that raises agreement strictness can make it *worse*. |
| **Ranking judge variants on the n=10 eval** | **Instrument too coarse** | 42 core items ⇒ 1 item = 2.4 points. The entire measured judge spread (78.6 – 88.1 %) is four items. No judge-level decision can be made at n=10, regardless of how many variants get run. Scaling the gold set to ~50 images comes first; ~4× the discriminating power is the prerequisite, not an optimization. |
| Bounded-reasoning judge (256 tok) as the fix | Inside the noise band | 83.3 % — cleans up the judge's already-clean cases, does not fix the messy ones, +14 s/plate. Same n=10 verdict applies: not distinguishable. |

Non-obvious operational traps also worth not rediscovering (full detail in `SERVING.md`):
prompt-prefix caching makes a re-sent image ~10× faster and will silently flatter any timing
run; a stale `llama-server` can hold a port under `SO_REUSEPORT` and answer `/health` while
attributing its output to your new flags; and LFM2.5 hybrid-reasoning models return HTTP 200
with `content: ""` when the think block never closes.

---

## 7. Concurrency probe — two simultaneous requests (measured 2026-08-13)

§1 and §3 inferred llama.cpp's concurrency behaviour from ensemble wall clock. This section
**measures it directly**: wall clock for one request, two sequential, two *simultaneous*, and a
three-way fan-out.

**Instrument:** `eval/concurrency-probe.py` (stdlib). **Host:** `bluefin`, AMD Ryzen 9 7940HS,
16 threads, `-t 14`, `-ngl 0`, CPU only, 62 GB RAM with ~45 GB available at start, load average
2.2 before the run. **Model:** LFM2.5-VL-1.6B Q8_0 via `serve/serve.sh lfm-vl`
(llama.cpp `llama-server`, `-c 8192`). **Request:** one plate photo downscaled to 448 px long
edge, a one-line prompt, `max_tokens 64`, `temperature 0`. Raw results:
`runs/2026-08-13-concurrency-probe/*.json`.

**Every request in a scenario sends a *different* image.** Re-sending one image would hit the
prompt-prefix cache (§6) and manufacture fictional parallelism.

| slots (`--parallel`) | run | single | sequential-2 | **parallel-2** | **parallel-2 / sequential-2** | parallel-3 | parallel-3 / 3×single |
|---|---|---|---|---|---|---|---|
| 4 (serve.sh default) | `lfm-vl-4slots-rep1.json` | 2.50 s | 4.90 s | **3.68 s** | **0.75×** | 6.57 s | 0.88× |
| 4 (serve.sh default) | `lfm-vl-4slots-rep2.json` | 3.15 s | 4.68 s | **3.88 s** | **0.83×** | 7.67 s | 0.81× |
| 1 (`--parallel 1`) | `lfm-vl-1slot.json` | 2.62 s | 4.82 s | **5.48 s** | **1.14×** | 7.03 s | 0.90× |

`serve.sh` passes no `--parallel`, and the server log records what that means:
`n_slots = 4, n_ctx_slot = 8192, kv_unified = 'true'`. So the harness has been measuring a
4-slot server all along.

**What it says.**

1. **Two simultaneous requests cost 0.75–0.83× of the same two run back to back** on the default
   4-slot server — a **1.20–1.33× throughput recovery on a 2× fan-out**, which independently
   confirms the 1.3–1.5× figure §1 derived from the ensemble runs. Free concurrency would be
   0.5×. Nothing here approaches that.
2. **With one slot, concurrency is worse than useless: 1.14×.** The requests queue strictly FIFO
   and the queueing shows up as a staircase in per-request latency — the 1-slot fan-out-3 returned
   at 2.5 s / 5.0 s / 7.0 s, i.e. request three waited for the two ahead of it and paid 2.7× the
   solo latency for zero throughput gain.
3. **The cost of sharing is paid in per-request latency, exactly where the SLO lives.** One
   request alone: 2.5 s. Two in flight: 3.7 s each. Three in flight: 5.9–7.7 s each. The box does
   not get faster under load; it gets fairer.
4. **Fan-out 3 lands at 0.81–0.90× of 3× serial regardless of slot count** — a 10–19 % saving for
   a 3× latency hit on every request in the batch. This is the measurement behind "the ensemble's
   fan-out costs wall clock rather than hiding behind concurrency", and it is the same conclusion
   the 50-image matrix reached from the accuracy side.

**Operational rule (unchanged, now measured):** set the in-flight limit to protect latency, not to
raise throughput — plan capacity as if the box were serial (§3), and prefer queueing a second scan
over admitting it. Keep the 4 slots: they are worth ~25 % wall clock and cost only fairness under
load. One slot is the wrong setting even for a strictly serial capacity plan, because it converts
overlap into pure queueing delay.

**Caveats.** These are 448 px / 64-token requests, chosen to make the probe cheap; the absolute
seconds are far below the 30–94 s production-prompt plate latencies in §1. The transferable
quantity is the **ratio**, not the seconds. Not measured on GPU — the rented-pod runs used
`--parallel 2` and their per-request latencies (§ the GPU rows in `BASELINE.md`) are single-request
figures; a GPU concurrency probe is the obvious follow-up when a pod is next up:
`python3 concurrency-probe.py --base-url $RUNPOD_QWEN_URL --max-long-edge 896`.

---

## Reproducing these numbers

```bash
cd eval
eval/serve/serve.sh lfm-vl && eval/serve/serve.sh lfm-judge
python3 -m harness.runner --config configs/local-cpu.json    --out runs/<date>-local-cpu
python3 -m harness.runner --config configs/local-cpu-v2.json --out runs/<date>-local-v2

# §7, the concurrency scenario (minutes, not hours)
eval/serve/serve.sh lfm-vl
python3 concurrency-probe.py --base-url http://127.0.0.1:8081/v1 \
    --out runs/<date>-concurrency-probe/lfm-vl-4slots.json
eval/serve/serve.sh stop all
```

Latency percentiles come straight from `results.json` — per plate, per approach, `latency_ms`
for `single`, `total_latency_ms` plus per-candidate `latency_ms` and `judge_latency_ms` for
`ensemble_judge`. `_summary.host` records the CPU/RAM the numbers were produced on; **a latency
number without its machine is not a measurement.** See [README.md](README.md) for the harness and
[SERVING.md](SERVING.md) for serving each model key.
