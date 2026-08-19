# Plate-Identification Pilot Benchmark — Scoring (2026-08-11)

10 CC-licensed Wikimedia Commons meal photos, gold-labeled by hand (see `gold_labels.json`).
Approaches: **baseline** = Gemini 3.1 Flash Lite single-shot (production prompt);
**single_qwen8b** = Qwen3-VL-8B-Instruct single-shot (production prompt);
**ensemble_judge** = Gemma-4-26B-A4B ×5 diverse prompts + same-model judge merge
(proxy for the "lite" LFM-class ensemble — LFM2.5-VL not available on OpenRouter).

Scoring: recall over gold core items; generic consolidations accepted with a granularity note
(named salad covers base veg only; distinctive add-ons must be named). Hallucination = food not in image.

## Per-image core-item recall

| Img | Meal | baseline | qwen8b | ensemble | Notes |
|-----|------|----------|--------|----------|-------|
| 01 | Breakfast plate | 6/6 | 6/6 | 6/6 | three-way clean sweep |
| 02 | Roast dinner | 5/5 | 5/5 | 4/5 | ensemble judge merged Yorkshire pudding away into "pot roast"; qwen mislabeled veg as "side salad" (components correct) |
| 03 | Salmon Greek salad | 5/8 | 8/8 | 8/8 | baseline collapsed feta/olives/avocado into "mediterranean salad" |
| 04 | Cheeseburger + fries | 4/4 | 3/4 | 4/4 | qwen missed ketchup |
| 05 | Chicken-greens stew + rice | 2/2 | 2/2 | 2/2 | |
| 06 | Sushi platter | 4/6 | 5/6 | 6/6 | baseline missed ginger+wasabi; qwen called nigiri "sashimi" (rice miss — matters for carbs) |
| 07 | Spaghetti + veg bolognese | 5/5* | 4/5 | 5/5* | *generic "mixed vegetables" — corn/beans/carrot unnamed; qwen named 2 of 3, missed carrot |
| 08 | Yogurt granola bowl | 3/3 | 3/3 | 3/3 | qwen consolidated to a single item (coverage ok, granularity loss) |
| 09 | Chicken pizza | 1/1 | 1/1 | 1/1 | qwen said just "pizza" (topping unnamed); ensemble also spotted the cola (optional, correct) |
| 10 | Club sandwich + salad (menu-poster trap) | 2/2 | 2/2 | 2/2 | **nobody fell for the background menu poster**; ensemble also correctly reported cola + coffee (optional) |

## Totals

| Metric | baseline (Gemini 3.1 FL) | single Qwen3-VL-8B | ensemble+judge (Gemma-4-26B-A4B ×5) |
|---|---|---|---|
| Core-item recall | **37/42 = 88.1%** | **39/42 = 92.9%** | **41/42 = 97.6%** |
| Hallucinations | 0 | 0 | 0 |
| Trap items reported | 0 | 0 | 0 |
| Distinct items named (specificity) | 29 | 30 | 36 |
| Mean latency | 3.3 s | 9.6 s (2 retry outliers ~30 s; median ~3.5 s) | 42.5 s via OpenRouter (not representative of self-hosted batched decode) |
| Cost / plate | $0.00102 | $0.00041 | $0.00182 |
| Total cost (10 imgs) | $0.0102 | $0.0041 | $0.0182 |

## Findings

1. **Ensemble+judge wins coverage** (97.6%) and specificity (36 named items) — it was the only
   approach to fully resolve the sushi platter and it names distinctive salad components
   individually. Its per-item confidence comes from real inter-candidate agreement.
2. **Its single miss is a judge artifact, not a vision miss**: Yorkshire pudding appeared in
   candidates but the merge folded it into "pot roast". The judge consolidation rule needs a
   "preserve visually distinctive single-source items" clause. Cheap prompt fix, big deal —
   it's the only gap to a clean sweep.
3. **Qwen3-VL-8B single-shot is the value king**: 92.9% at $0.0004/plate, ~3.5s median. Its
   errors are naming-level (sashimi-vs-nigiri, generic "pizza"), which downstream
   retrieval-augmented resolution could partially absorb.
4. **Gemini 3.1 Flash Lite (the thing we'd be paying a third party for) came LAST on recall**
   (88.1%) — it over-consolidates ("mediterranean salad") and skipped condiments. Fastest and
   most consistent latency, but the open-weight approaches beat it on quality at 0.4–1.8× its cost.
5. **Zero hallucinations across 30 plate-identifications**, and the deliberately adversarial
   image 10 (menu poster showing other dishes) fooled no one.
6. Caveats: n=10; ensemble vision model is a *proxy* (Gemma-4-26B-A4B MoE) for the target
   lite-profile models; OpenRouter latency ≠ self-hosted latency; gram accuracy not scored
   (no weighed ground truth — needs the M138 spec-01 harness).
