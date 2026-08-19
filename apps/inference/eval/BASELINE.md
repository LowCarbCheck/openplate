# BASELINE — the reference rows every later change is measured against

This is the durable row. Specs 02–05 compare against **this file**, not against a per-run
worksheet, and not against prose in a chat log. Every number below cites the committed file it
comes from; nothing here is estimated, projected or remembered. Where a figure is a *raw*
worksheet total versus an *adjudicated* one, both are shown — they differ by 1–3 points and the
difference is smaller than the confidence interval.

- Corpus: the 50 gold-labeled plate photos in [`images/`](images/) + [`gold/gold_labels.json`](gold/gold_labels.json)
  — **235 core items**, one item ≈ 0.43 recall points.
- Scoring rules: [`runs/2026-08-12-50img-SCORING.md`](runs/2026-08-12-50img-SCORING.md) §"Adjudication
  rules" — four rules (generic labels earn no credit; species errors are misses but prep/form errors
  are hits; a misnamed visible object is never a hallucination; sashimi-for-nigiri is a miss),
  applied identically to every approach. **Any new row must be scored under those four rules or it
  is not comparable to this table.**
- Latency: recomputed from the per-request `latency_ms` arrays in each run's `results.json`, and
  **always labelled with the hardware it was measured on** — a latency number without its machine
  is not a measurement. Full latency/throughput analysis lives in [PERFORMANCE.md](PERFORMANCE.md).

---

## 1. The control row

> **Single-shot Qwen3-VL-8B-Instruct (Q4_K_M + F16 mmproj) with pipeline v3 at 896 px is the
> control row for the service.** Every spec-02 service change, spec-03 pipeline change and spec-04
> retrieval change is measured against it. It is a *single-shot* row on purpose: the ensemble's
> kill criterion tripped on 2026-08-13 (see §4).

Its two measured faces, same model, same 50 images, same prompts — differing only in hardware:

| | recall | halluc. | latency (p50 / p95) | hardware | source |
|---|---|---|---|---|---|
| **service control (GPU)** | **72.8 %** (171/235) | **0** | **0.94 s / 1.47 s** | RTX 4090, rented pod, llama.cpp b10380 | [`runs/runpod-gpu-v3/`](runs/runpod-gpu-v3/) (`22d3c63`, scored `7bf5517`) |
| same row on a cheaper card | (same responses not re-scored) | — | **1.72 s / 2.33 s** | RTX 3090, rented pod, llama.cpp b10380 | [`runs/runpod-a5000-v3/results.json`](runs/runpod-a5000-v3/results.json) (`bab2bd0`) |

Both GPU wall-clock figures **include ~0.35–0.6 s of network + Runpod-proxy round trip** (`bab2bd0`
separated it with a text-only `max_tokens=1` control probe), so on-box serving is faster than these
rows, not slower. Server-side throughput from `llama-server /metrics`: 4090 **3356 tok/s prefill /
153.6 tok/s decode**; 3090 **1749 / 122.9** (`22d3c63`, `bab2bd0`).

**v3 + 896 px is a free win, not a trade.** Scored under the four adjudication rules from the start,
v3 reached 171/235 versus ≈159/235 for the same model's v2 full-resolution responses re-scored the
same way — about **+12 items** — with zero hallucinations and the same single trap leak
([`runs/runpod-gpu-v3/scorecard-filled.md`](runs/runpod-gpu-v3/scorecard-filled.md), findings 1–3).
The resolution variable is isolated by the full-resolution control run: p50 **1.50 s** / p95 2.17 s
at 1610 mean prompt tokens versus 0.94 s / 1.47 s at 874
([`runs/runpod-gpu-v3-fullres/results.json`](runs/runpod-gpu-v3-fullres/results.json)).

---

## 2. The adjudicated 50-image matrix (2026-08-12, pipeline v2, full resolution)

Source: [`runs/2026-08-12-50img-SCORING.md`](runs/2026-08-12-50img-SCORING.md); per-approach filled
worksheets in each run directory; mechanical columns recomputed with
`python3 -m harness.scorecard runs/<dir>/results.json --json`.

| approach | recall (raw → adjudicated) | halluc. | trap leaks | dedup fails | items/plate | latency p50 | cost/plate | hardware |
|---|---|---|---|---|---|---|---|---|
| cloud baseline — **`google/gemini-3.1-flash-lite`** single-shot | 76.2 % → **75.3 %** (177/235) | **0** | 0 | n/a | 3.16 | **2.9 s** | **$0.00108** | OpenRouter API (no local hardware) |
| **single-shot Qwen3-VL-8B Q4** (local) | 77.4 % → **74.5 %** (175/235) | **0** | 1 | n/a | 3.62 | **94 s** | $0 | CPU: AMD Ryzen 9 7940HS, 14 threads, `-ngl 0` |
| LFM ensemble n=3 + judge (local) | 68.1 % → **66.0 %** (155/235) | 38 | 2 | 18 | 4.96 | **143 s** | $0 | same CPU |
| single-shot LFM2.5-VL-1.6B (local) | 63.0 % → **62.1 %** (146/235) | 13 | 1 | n/a | 4.84 | **30 s** | $0 | same CPU |

Run directories: [`2026-08-12-50img-cloudbaseline`](runs/2026-08-12-50img-cloudbaseline/),
[`-qwenvl`](runs/2026-08-12-50img-qwenvl/), [`-ens3`](runs/2026-08-12-50img-ens3/),
[`-lfmvl`](runs/2026-08-12-50img-lfmvl/) — 200/200 records, 0 errors, 50/50 schema-valid on every
row (commit `0c2c82b`).

**The frontier-baseline row is `google/gemini-3.1-flash-lite`** at $0.25/$1.50 per M tokens
(`_summary.models` in the cloud run) — the current openplate default, and the frontier proxy the
milestone's kill criteria compare against. Its measured cost per plate is **$0.00108**.

**Headline that survives everything else in this file:** local single-shot Qwen3-VL-8B **ties the
cloud frontier baseline** (74.5 % vs 75.3 %, both with **zero hallucinations** across 50 plates).
The quality case for self-hosting is closed; the only gap was latency, and §1 closes that on a GPU.

---

## 3. Confidence intervals — what this instrument can and cannot resolve

Percentile bootstrap over plates (10 000 resamples, seed fixed, `harness/stats.py`), computed from
the committed filled worksheets. **These are the raw worksheet vectors**, i.e. the "raw" column of
§2; adjudication moves each point estimate 1–3 points down, well inside the intervals.

```bash
python3 -m harness.scorecard --score runs/2026-08-12-50img-qwenvl/scorecard-filled.md
python3 -m harness.scorecard --compare runs/A/scorecard-filled.md runs/B/scorecard-filled.md
```

| row | recall | 95 % CI | halluc. |
|---|---|---|---|
| single-shot Qwen3-VL-8B Q4 (v2, CPU) | 77.4 % | **[70.8 % – 84.0 %]** | 0 |
| cloud `gemini-3.1-flash-lite` | 76.2 % | **[67.5 % – 84.8 %]** | 0 |
| single-shot Qwen3-VL-8B (v3, 896 px, GPU) | 72.8 % | **[65.4 % – 80.3 %]** | 0 |
| LFM ensemble n=3 + judge | 68.1 % | **[61.4 % – 75.0 %]** | 38 |
| single-shot LFM2.5-VL-1.6B | 63.0 % | **[55.6 % – 70.4 %]** | 13 |

Verdicts, mechanically (overlapping intervals are reported **UNDECIDED**, never as a winner):

| comparison | verdict | paired difference (95 % CI) |
|---|---|---|
| local qwen vs cloud baseline | **UNDECIDED** | +1.3 pts [−7.7 – +10.5] |
| local qwen vs single LFM 1.6B | **WINNER** (qwen) | +14.5 pts [+5.6 – +23.5] |
| LFM ensemble n=3 vs single LFM | **UNDECIDED** | +5.1 pts [−1.5 – +12.1] |
| qwen v3 @896 px (GPU) vs qwen v2 fullres (CPU) | **UNDECIDED** | −4.7 pts [−11.2 – +0.9] |

Read those two UNDECIDED rows carefully, because they are the whole reason the CIs exist:

- **"Local ties cloud" is a statement about indistinguishability**, and it is now stated
  mechanically rather than by eyeballing 74.5 vs 75.3.
- **The ensemble's +3.9-to-+5.1 point gain is not separable from zero at n=50.** It fails its
  ≥ +5 pt bar *and* fails to be distinguishable at all — a stronger version of the same verdict
  (§4), reached without appealing to a point estimate.
- **±7 points is this instrument's resolution at n=50.** No change smaller than ~8 recall points is
  a result here, no matter how confidently it is quoted. Prompt-level A/B work needs paired
  scoring on the same plates (the `--compare` paired column) or a bigger corpus.

---

## 4. What is closed, and must not be re-litigated

| decision | verdict | evidence |
|---|---|---|
| Ensemble-of-small as the product architecture | **DEAD** — kill criterion tripped 2026-08-13 | +3.9 pts item-F1 (62.1 → 66.0) against a ≥ +5 pt bar, 38 hallucinations vs 0, 4.8× wall time (`runs/2026-08-12-50img-SCORING.md` finding 2; owner ruling in the M138 README) |
| CPU for the **hosted** tier | **DEAD** — p95 ≤ 10 s unreachable | best CPU single-shot p50 30 s, qwen 94 s ([PERFORMANCE.md](PERFORMANCE.md) §1, §5) |
| GPU for the hosted tier | **PASS, measured** | 0.94 s / 1.47 s (4090), 1.72 s / 2.33 s (3090) — 4–10× inside the SLO (§1) |
| Qwen3-VL-8B at Q8 to buy accuracy | **DEAD** — no gain, 2.2× slower | [PERFORMANCE.md](PERFORMANCE.md) §6 |
| Moondream 3 as a local model | **NOT SERVABLE** | [SERVING.md](SERVING.md), [PERFORMANCE.md](PERFORMANCE.md) §6 |
| Concurrency as a throughput lever on CPU | **DEAD** — 1.20–1.33× on a 2× fan-out | [PERFORMANCE.md](PERFORMANCE.md) §7 (measured 2026-08-13, `runs/2026-08-13-concurrency-probe/`) |

**The self-host floor profile is single-shot LFM2.5-VL-1.6B**: 62.1 % recall at 30 s p50 on CPU,
$0, 1.5 GB RSS. Documented as the constrained-self-hoster floor, not as the flagship path.

---

## 5. What this baseline still does NOT measure

- **Portion error and macro error.** Both metric families are implemented
  (`harness/scorecard.py`) and both report themselves *unscorable* — gold carries gram ranges on
  **0/50** images. Weighed ground truth is the missing input, and it needs a scale, not a
  labeller's guess off a photo. `python3 -m harness.runner check-labels` prints the coverage.
- **Composite over-decomposition** is now a counted error class in the worksheet protocol
  ([README](README.md#gold-labeling-protocol)), but the four 2026-08-12 worksheets predate the row,
  so its committed count is 0 across every row above — absence of data, not absence of the failure.
- **Retrieval.** Nothing to ablate until spec 04 exists (`--no-retrieval` is unimplemented for that
  reason).
- **GPU concurrency.** §7 of PERFORMANCE.md measured CPU; the GPU rows are single-request.
- **Sustained load / thermals.** All CPU numbers are ~10-plate bursts
  ([PERFORMANCE.md](PERFORMANCE.md) §3, "honest haircuts").

---

## 6. Retrieval ablation (spec 04)

Spec 04 asks for a **macro-error ablation** — resolver on versus `--no-retrieval` — as the evidence
that corpus-backed resolution is earned. **That ablation is UNMEASURABLE today, and saying so is the
finding.**

**Why it cannot be run.** §5 above: gold carries gram ranges on **0/50** images, so macro error is
already reported as *unscorable* for every existing row. A macro-error delta between two arms whose
absolute macro error is unscorable is not a small number — it is not a number. Weighed ground truth
(a kitchen scale, not a labeller's guess off a photo) is the missing input, and it is spec 01's open
item. Nothing in spec 04 can manufacture it.

**Why the ablation is also no longer the decision it was written to be.** The spec's framing —
"a small delta is grounds to simplify or drop it" — assumed the vision model emitted its own macros
and retrieval merely improved on them. **Locked decision 13 removed that fallback**: the v3 grammar
cannot express a macro field, so the arms of the ablation are now *macros* versus *no macros at all*,
not *better macros* versus *worse macros*. Retrieval is the only path by which a macro reaches a
client. The question the ablation was meant to answer (is this machinery earned?) is settled by
construction; the question it can still answer once gold exists (how ACCURATE are the resolved
macros?) is a different and better question, and it stays open.

**Ship/simplify/drop call: SHIP, with the loop shape simplified.** The model-in-the-loop
`search_foods` tool and its two model refinement turns were dropped — there is no model turn left to
hand a tool to — and replaced by a deterministic server-side stage with a bounded query plan. That is
this spec's own sanctioned simplification path applied to the loop rather than to retrieval's
existence.

### What IS measured

Corpus: `data/fdc-foods.json` — 8 041 generic foods (USDA Foundation Foods 2025-04-24 + SR Legacy
2018-04, Branded excluded), 1.8 MB, public domain. Retrieval is lexical-only in these numbers
(`EMBEDDING_RUNTIME_URL` unset, which is the default).

| measurement | value | source |
|---|---|---|
| **Resolution latency, 8-item plate** | **81–87 ms** total, 8 corpus queries | `tests/unit/offline-resolution.test.ts` prints it each run |
| Resolution latency, 30-item plate (15 de + 15 en) | 257 ms | `tests/integration/multilingual-resolution.test.ts` |
| Per-query cost, full 8 041-row scan | ~8 ms (hit) / ~21 ms (miss — a miss spends all 3 rounds) | same |
| Accept rate, 25 common foods, English | 25/25 | `tests/integration/multilingual-resolution.test.ts` fixtures |
| Accept rate, same 25 foods, German | 25/25, **same corpus row in every pair** | same |
| Accept rate, the 221 raw gold-label item names | 151/221 (68.3 %) | scan over `gold/gold_labels.json` |
| Network calls on the default backend | 0 (asserted with `fetch` stubbed to throw) | `tests/unit/offline-resolution.test.ts` |

**Latency budget: holds with room to spare.** 81 ms against a 2 000 ms per-plate budget, and against
a vision call that takes 0.94 s on a 4090 and 30 s on CPU (§1). Resolution is 0.3–8 % of a hosted
scan and under 0.3 % of a self-hosted one. It runs OUTSIDE the admission pool — it is CPU/IO against
a local array, not model work, so holding a KV slot during it would shrink effective concurrency for
nothing.

**The 68.3 % figure is the honest one and it is a floor, not a ceiling.** Those 221 strings are
*labeller annotations*, not model output: "green leaf lettuce (butterhead) in a separate glass bowl",
"beefburger in sesame bun (bitten; lettuce, tomato, onion visible)". The v3 grammar emits short food
names, which is the 25/25 column. The residual misses cluster in three groups, all of them honest
`null`s rather than wrong numbers: composite national dishes USDA has no row for (Currywurst,
Maultaschen, döner, dal, chapati), sauces and condiments (tzatziki, raita, salsa), and descriptive
phrases with no head noun the corpus knows.

**Known ranking limitation, recorded rather than papered over.** A BARE, highly ambiguous noun can
land on a variant row: "rice" resolves to "Rice noodles, cooked" because USDA has no bare "Rice" row
and the canonical one ("Rice, white, long-grain, regular, enriched, cooked") is penalised by the
brevity component. Any qualifier fixes it — "white rice" and "steamed rice" both resolve to "Rice,
white, steamed". Four demotion rules already exist for this failure class (brand, processing form,
milling by-product, composite dish; see `src/food-source/lexical.ts`), each added against a measured
mis-ranking, and each is a demotion rather than an exclusion. When weighed gold lands, this is the
first thing to re-tune against it.
