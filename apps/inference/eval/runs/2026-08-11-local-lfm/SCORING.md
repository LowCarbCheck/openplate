# Local CPU Benchmark — LFM Stack — Scoring (2026-08-11)

Host: AMD Ryzen 9 7940HS, 16 threads, CPU-only, llama.cpp (brew). Models co-resident at 4.4GB RSS
(budget ≤16GB). Same 10 gold-labeled images and scoring protocol as the OpenRouter pilot
(`../2026-08-11-openrouter-pilot/SCORING.md`): recall over gold core items, generic consolidations
accepted, hallucination = food not in image.

Approaches:
- **single_lfm_vl** — LFM2.5-VL-1.6B Q8, single-shot, production prompt
- **ensemble n=5** — LFM2.5-VL ×5 diverse prompts + LFM2.5-2.6B judge (reasoning off), max_parallel 2
- **ensemble n=3** — same, fan-out 3 (variants a/c/d), separate run (`../2026-08-11-local-lfm-n3/`)

## Per-image recall

| Img | single 1.6B | ens n=5 | ens n=3 | Notes |
|-----|------------|---------|---------|-------|
| 01 | 6/6 | 5/6 | 6/6 | n=5 judge dropped sausages (smoke run dropped bread instead — judge merge variance) |
| 02 | 3/5 | 4/5 | 4/5 | Yorkshire pudding missed by ALL (also by cloud ensemble); meat species wrong (chicken/pork/ribeye for lamb); n=5 and n=3 judges failed to dedupe (9–10 items) |
| 03 | 6/8 | **8/8** | 6/8 | n=5 clean sweep incl. red onion + feta |
| 04 | 3/4 | 4/4 | 4/4 | ensemble recovered ketchup; n=5 had case-dupes (Hamburger/French Fries repeated) |
| 05 | 2/2 | 2/2 | 2/2 | n=5 hallucinated carrots |
| 06 | 3/6 | 5/6 | 4/6 | single collapsed platter to "sushi(80g)"; n=5 got ginger+wasabi; n=5 hallucinated fish roe |
| 07 | 4/5 | 4/5 | **5/5** | n=3 the only run ever to name the carrots |
| 08 | **0/3** | 3/3 | 3/3 | single called a yogurt bowl "side salad" — total miss; ensemble fully repaired it |
| 09 | 1/1 | 1/1 | 1/1 | n=5: "Pizza" ×3 dupes + hallucinated Chips; n=3 hallucinated a NAPKIN (non-food) |
| 10 | 2/2 | 2/2 | 2/2 | **menu-poster trap finally fired**: n=5 leaked "lime wedges", n=3 leaked "lime wedge + guacamole" from the background poster; cloud runs never fell for it |

## Totals (vs cloud pilot)

| Metric | single LFM-VL 1.6B | ens n=5 (LFM) | ens n=3 (LFM) | — | Gemini 3.1 FL (cloud) | Qwen3-VL-8B (cloud) | ens Gemma (cloud) |
|---|---|---|---|---|---|---|---|
| Core-item recall | 71.4% | **90.5%** | 88.1% | | 88.1% | 92.9% | 97.6% |
| Hallucinations | 1 | 4 | 3 | | 0 | 0 | 0 |
| Trap leaks | 0 | 1 | 2 | | 0 | 0 | 0 |
| Judge dedup failures (images) | n/a | 4 | 2 | | n/a | n/a | 0 |
| Mean latency/plate | 28 s | 184 s | 113 s | | 3.3 s | ~3.5 s | 42 s* |
| Cost/plate | $0 | $0 | $0 | | $0.00102 | $0.00041 | $0.00182 |
| RAM | 1.5 GB | 4.4 GB | 4.4 GB | | — | — | — |

*cloud ensemble latency via OpenRouter free-tier routing, not comparable.

## Findings

1. **The architecture's core bet is validated on-device**: ensemble+judge lifts a 1.6B model from
   71.4% → 90.5%, i.e. a CPU-only, $0, fully-private pipeline matches/beats the commercial
   Gemini 3.1 Flash Lite single-shot baseline (88.1%) on recall. Image 08 is the poster child:
   single-shot total miss ("side salad" for a yogurt bowl), ensemble repaired to 3/3.
2. **The judge is now the bottleneck, three ways**: (a) dedup failures — duplicate/near-duplicate
   items survive in 2–4 of 10 images (cloud Gemma judge: 0); (b) hallucination leak-through —
   3–4 per run incl. a non-food "napkin" and the first-ever menu-poster trap leaks; (c) merge
   variance — drops a real item (sausages/bread) unpredictably. The 2.6B judge with reasoning
   disabled is too weak for the merge task as prompted. Levers, in order: enforce maxItems + dedup
   instructions harder in the judge grammar/prompt; re-enable bounded reasoning for the judge call
   only (~+60s, judge is 1 call); try Qwen3-4B as judge; only then a bigger judge.
3. **n=3 vs n=5 on CPU**: 88.1% vs 90.5% for 113s vs 184s. n=3 is the right lite-profile default;
   n=5 is GPU-tier. (Counsel's serialization warning confirmed: wall ≈ fan-out × vision-time / 2.)
4. **Grams remain unscored and look unreliable** (single-shot emitted 0g rows; judge medians are
   plausible-ish). Needs weighed ground truth — M138 spec 01.
5. **Latency reality check**: 28s single / ~2min ensemble per plate on a strong laptop CPU. Fine for
   an async "analyze while I pocket the phone" UX, not for interactive preview. The lite profile
   should default n=3 and stream partials; quality profile wants a GPU.
6. Moondream 3 could not be included: no GGUF, no llama.cpp arch, no ollama v3 (see ../../SERVING.md).
   Cloud-API-only as of 2026-08.
