# Mistral vision vs Qwen3-VL-8B control — 50-image gold set (2026-08-24)

M147/02: does Mistral's hosted vision model have a defensible quality story against the
service's control row? Answer below is a measurement, not a recommendation — the `## Verdict`
line stays unwritten in the spec until the operator reads this.

## What ran

- **Config**: [`configs/mistral-vs-qwen-control.json`](configs/mistral-vs-qwen-control.json)
- **Pipeline**: `single_v3` — the exact terse-candidate approach, prompt, JSON schema and 896 px
  client-side downscale that [`BASELINE.md`](BASELINE.md) §1's GPU control row uses. Nothing
  about the prompt or contract was changed for this run.
- **Corpus**: the same 50 gold-labeled images / 235 core items as every other row in
  `BASELINE.md`.
- **Run directory**: [`runs/2026-08-24-mistral-vs-qwen-control/`](runs/2026-08-24-mistral-vs-qwen-control/)
  (`results.json`, `results_summary.md`, `scorecard.md`, `scorecard-filled.md`)
- Scored by a reviewing agent, per-item semantic matching against
  `gold/gold_labels.json`; images 36, 46 and 47 were opened and inspected directly to adjudicate
  hallucination calls (the rest were scored from the gold text descriptions and the model's
  reported food names, per the same protocol `runs/2026-08-12-50img-SCORING.md` describes).

## Models

| | model id | provider | price (USD/Mtok in / out) |
|---|---|---|---|
| Mistral vision | **`mistral-medium-latest`** | Mistral direct API (`https://api.mistral.ai/v1`) | **$1.50 / $7.50** |
| Qwen control | `qwen/qwen3-vl-8b-instruct` | OpenRouter | $0.117 / $0.455 |

**Why `mistral-medium-latest`:** queried `GET /v1/models` directly against the Mistral API
(2026-08-24) and cross-checked against `docs.mistral.ai/getting-started/models/models_overview`.
Pixtral (both 12B and Large) is deprecated/retiring; its documented successor is Mistral Medium
3.5, which `mistral-medium-latest` currently resolves to. It is the current vision-capable model
in the "pixtral / mistral-medium family" the spec named — Mistral's only actively-recommended
vision line at this price point, not a cherry-picked flagship.

Pricing confirmed from two independent fetches of `mistral.ai/pricing/api` and
`docs.mistral.ai` (2026-08-24): Mistral Medium 3.5 = $1.5/Mtok in, $7.5/Mtok out. Not
"unconfirmed" — both sources agreed.

## The control caveat (read this before comparing numbers)

**The Qwen row in this file is an OpenRouter re-run, not the local GGUF serving run.** This
workstation has no GPU and no Runpod endpoint configured, so the control was re-run
same-session through OpenRouter (`qwen/qwen3-vl-8b-instruct`) rather than reproduced bit-for-bit
against the Q4_K_M GGUF on the rented RTX 4090 that `BASELINE.md` §1 cites (72.8%, 0
hallucinations). Its job is to catch **harness drift** (prompt/schema/scoring changes since
2026-08-12), not to reproduce GPU-serving numbers — and it does that job: 73.6% here lands
inside the ±7-point bootstrap CI width `BASELINE.md` documents around the 72.8% GPU figure, so
the harness is measuring the same thing it measured before. **Do not cite this file's Qwen
number as a replacement for the GPU control row in BASELINE.md — cite BASELINE.md for that.**

## Results

| approach | recall | 95% CI (bootstrap, plates) | hallucinations | items/plate | latency median | **cost per image** |
|---|---|---|---|---|---|---|
| **`mistral-medium-latest`** | **66.4%** (156/235) | 58.2% – 74.4% | **3** | 3.64 | 1.61 s | **$0.002246** |
| `qwen/qwen3-vl-8b-instruct` (OpenRouter control) | 73.6% (173/235) | 66.1% – 81.1% | 1 | 4.26 | 1.54 s | $0.000137 |

Cost per image (Mistral run): **$0.002246** — `_summary.per_approach_cost_usd` /50, matches
`harness.scorecard --json`'s `cost_per_plate_usd` for `single_mistral_medium_v3`. Total spend
for the Mistral row: $0.112284 across 50 images.

Comparison run through `harness.scorecard --score`, same script and same percentile-bootstrap
method (10,000 resamples, plates resampled — not items — for the reason `README.md` §"Read a
filled worksheet back" documents) as every other row in `BASELINE.md`:

```
| single_mistral_medium_v3 vs single_qwen3_vl_8b_v3 | UNDECIDED | 95% CIs overlap
    (mistral 66.4% [58.2%-74.4%] vs qwen 73.6% [66.1%-81.1%]) |
```

**The 95% CIs overlap — the harness cannot call this a statistically significant loss at n=50.**
The point estimate is 7.2 points lower than the same-session Qwen control and 6.4 points lower
than `BASELINE.md`'s GPU control row (72.8%), and Mistral's hallucination count (3) is the only
non-zero hallucination count for any single-shot approach recorded anywhere in this eval so far
(both zero-hallucination rows in `BASELINE.md` are Qwen3-VL-8B). That is a real, if modest,
directional signal — not noise-proof, but not nothing either.

### Adjudication rules applied (identical to `runs/2026-08-12-50img-SCORING.md` and `BASELINE.md`)

1. Generic labels earn no credit; named dishes with determinate composition consolidate (e.g.
   "Greek salad" legitimately covers several gold rows).
2. Species/kind errors are misses; prep/cut/form errors are hits (organ identity counts as
   kind).
3. A misnamed visible object is never a hallucination — hallucination requires no referent in
   the photo at all.
4. Sashimi reported for nigiri is a miss.

### What drove the gap

- **Recall**: Mistral under-enumerates relative to Qwen on multi-component plates — 3.64
  items/plate vs 4.26 — and leans on generic consolidating labels ("mixed vegetables", "side
  salad", "mixed curry") more often, which the four rules give zero credit against itemised gold
  rows (images 26, 27, 35, 50). One image (28, a dense Middle-Eastern mezze spread with 8 gold
  core items) got a genuine empty response from Mistral — `raw_ok: true`, zero items, not a
  parse failure — its single worst miss.
- **Hallucinations (3, all on one image)**: image 36 (seafood paella), Mistral reported
  "chicken" and "mussels" with no referent anywhere in the photo (verified by opening the
  image — it shows rice, whole prawns and artichoke pieces only, matching gold exactly). Image
  47 (café brunch spread), Mistral reported "bacon" with no referent on any of the four visible
  plates (verified by opening the image). Qwen's one hallucination is on the same paella image
  ("mushrooms").
- Where Mistral got the dish right, it was usually accurate: on the 39 images with no
  hallucination and no generic-label miss it tracked Qwen closely (e.g. images 01, 04, 08, 12,
  16, 24, 29, 31, 38, 39, 41 — full or near-full recall for both).

## Findings that don't fit the table

- Mistral occasionally consolidates well past what the rules credit: image 03's "greek salad"
  correctly covers six gold rows (feta, olives, tomato, cucumber, lettuce, onion) in two words —
  the miss on that image is the separately-listed avocado, not the salad itself.
- The empty response on image 28 is worth a second look outside this eval: it is the densest
  image in the corpus (8 gold core items across four composed mezze plates), and an empty
  `{"f":[]}` from a `strict: true` JSON-schema call is a legitimate schema-valid answer, not a
  retry-triggering failure — the harness's nudge-retry only fires on parse failure, not on "zero
  items when there are clearly items." That is a harness/product gap worth a follow-up spec, not
  a fix here (out of scope per this spec's decisions).

## Not done here (per spec 02's explicit scope)

- No ensemble variant for Mistral, no repeat runs, no second Mistral model. One run over the 50
  images, one Qwen control, as scoped.
- `gold/gold_labels.json` was not touched, even though one gold row (image 36's "mantis shrimp
  (galeras)") is not clearly distinguishable from the whole prawns in the photo on direct
  inspection — flagged for the operator, not fixed here.
