# Local v2 Matrix — Judge Levers + Qwen3-VL-8B — Scoring (2026-08-11)

Same 10 gold images and protocol as prior runs. Vision held constant across the three ensembles
(lfm-vl ×3, variants a/c/d, max_parallel 2); judge is the only variable. Comparison row
"ens n=3 (original judge)" is yesterday's `2026-08-11-local-lfm-n3` run.

## Totals

| Approach | Recall | Halluc. | Trap leaks | Dedup fails | Wall/plate | Notes |
|---|---|---|---|---|---|---|
| ens n=3, original judge (ref) | **88.1%** | 3 | 2 | 2 | 113 s | yesterday's baseline |
| ens n=3, hardened LFM judge | 85.7% | 6 | 3 | ~6 | 142 s | image 10 leaked burrito/margarita from poster |
| ens n=3, Qwen3-4B judge | 78.6% | 4 | 0 | ~2 | 134 s | cleanest dedup, but drops real items (sausages, salad, ginger/wasabi) |
| ens n=3, LFM judge + 256-token reasoning | 83.3% | ~5 | 0 | ~6 | 133 s | best images clean, worst images messy |
| single Qwen3-VL-8B Q4 (local) | 81.0% | 0 | 0 | n/a | 108 s | vs 92.9% for the same model FP via cloud |

## The three real findings

1. **None of the judge levers beat the original judge — and with 42 core items, one item ≈ 2.4
   points, so the entire 78.6–88.1% spread is inside the noise band of a 10-image eval.** The
   instrument is too coarse to rank judge variants. This is direct, quantified justification for
   M138 spec 01's 50-image harness: judge-level decisions need ~4× the discriminating power.
2. **The poster-trap leak cannot be fixed in the judge, because the judge is blind.** Rule 2
   ("exclude poster/menu items") is unenforceable by a text-only merge stage: when 2 of 3 vision
   candidates report "burrito" from the wall poster, the judge sees only agreeing candidates.
   The cloud Gemma ensemble never leaked NOT because its judge filtered — its *candidates* never
   reported poster items. Fix belongs in the vision variant prompts ("ignore food visible only in
   posters/menus/screens/packaging") and/or a candidate-level `background: bool` field. Judge
   hardening that *raises* trap pressure (strict agreement rules) can even make it worse.
3. **Local Q4 Qwen3-VL-8B lost ~12 points vs its own cloud FP run** (81.0% vs 92.9%): the losses
   are enumeration depth (07: sauce components unnamed; 06: condiments missed), not gross errors —
   and it was the ONLY local run to name the Yorkshire pudding. Before concluding "8B Q4 isn't
   worth it", test Q8 (fits: ~9GB) and check mmproj/image-resolution settings; quantization of the
   vision tower may be the culprit.

Secondary observations: the 2.6B LFM judge is capability-bound — harder prompts produced *more*
case-dupes ("Salmon"/"salmon" survived rule 1) and more hallucinated merges (cream/sauce on pizza);
grammar can bound item COUNT but not semantic discipline. Qwen3-4B judge is the most disciplined
merger but too aggressive at n=3 (single-candidate real items die). Bounded reasoning (256 tok)
helps the judge's clean cases but doesn't fix its messy ones.

## Recommended next moves (in order)

1. Scale the gold set to 50 images (M138 spec 01) — no more judge tuning on n=10.
2. Move background-food exclusion into the vision variant prompts; add a skeptic variant back at
   n=4 if budget allows (variant e caught misidentifications in the cloud run).
3. Retest qwen-vl at Q8; if it recovers ≥90%, "single Qwen3-VL-8B Q8" becomes the lite-profile
   quality ceiling and the ensemble may only be needed for the sub-2B tier.
4. Judge: keep the hardened prompt (rules 1/3/4/7 are sound) but accept the 2.6B ceiling; revisit
   judge model choice only after the 50-image harness exists.
