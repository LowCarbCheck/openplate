# EU switch: three more candidate cells against the decision rule (2026-10-06)

No model was called to write this file. It restates numbers from finished runs and their scorers. Every number has a source in the list at the end.

## Purpose

The EU host of OpenRouter does not serve Gemini 3.7 Flash or Gemini 3.8 Flash. The first EU candidate was D3, Gemini 3.5 Flash Lite on the EU host. D3 missed the rules (see `EU-FLAG-SCORING-V3-2026-10-06.md` and `EU-PLATE-SCORING-V3-2026-10-06.md`). So three more models in the same price range were measured with the v3 prompt:

| cell | model | provider pin | price per M tokens (input / output, USD) |
|---|---|---|---|
| L25 | `google/gemini-2.5-flash-lite` | `google-vertex/eu` | 0.10 / 0.40 (EU price) |
| F25 | `google/gemini-2.5-flash` | `google-vertex/eu` | 0.30 / 2.50 |
| MM | `mistralai/mistral-medium-3.1` | `mistral/eu` | 0.44 / 2.20 |

Each cell ran the 50 food plates once and the typed gold cases three times, plus the 34 kcal rows. The references are:

| cell | what it is |
|---|---|
| B | Gemini 3.8 Flash, default reasoning, production prompt. This is what production runs today. |
| C3 | Gemini 3.8 Flash, reasoning minimal, v3 prompt. It shows what the v3 prompt does on 3.8. |
| D3 | Gemini 3.5 Flash Lite on the EU host, minimal, v3 prompt. It is kept for comparison. |

## The six decision rules

The rules come from `.tracker/worklog/eu-switch-decision-rule.md` in the umbrella workspace. They were written before the first measurement. Any one failure of rules 1 to 6 means no switch.

| rule | text, short |
|---|---|
| 1 | Schema validity. Zero schema-invalid answers across all calls. Zero false "unreadable" on the 50 plates. |
| 2 | Pregnancy misses on clear cases. Zero misses on the clear must-flag typed cases, in every repeat. |
| 3 | Pregnancy misses overall (typed and plates) no higher than 3.8. A miss means the category is absent. |
| 4 | Allergen misses overall no higher than 3.8. An allergen counts as missed only when it is in neither `allergens` nor `mayContain`. |
| 5 | Recall. The upper bound of the paired 95 percent bootstrap interval of (3.8 recall minus candidate recall) is at most 8 points. UNDECIDED is not a pass. |
| 6 | Hallucinations. At most the 3.8 count plus 1 over all plates and repeats. |

Two notes on how the rules were applied here.

- Rule 1 was judged on the typed calls and the plate calls only. Pantry and recipe calls were not run for these three cells. A pass on rule 1 therefore covers less than the rule asks for.
- Rule 5 uses the paired difference against C3, the 3.8 cell on the same 50 plates with the same prompt. Rules 3 and 4 use B as the main reference and show C3 beside it. A failed call is not a flag miss. It is scored by rule 1. The scorer also prints a second count where the entries of failed calls count as misses.

## Verdicts per cell

| rule | L25 | F25 | MM | D3 (reference) |
|---|---|---|---|---|
| 1 schema validity, failed calls | FAIL (7 typed calls and 11 plates failed) | FAIL (1 typed call and 1 plate failed) | PASS (0 failed, 0 schema invalid, 0 retries) | FAIL (1 typed call failed) |
| 2 clear pregnancy typed | FAIL, misses per repeat [5, 2, 4] | PASS, [0, 0, 0] | PASS, [0, 0, 0] | PASS |
| 3 pregnancy misses overall | FAIL, clear 16 vs 0 | INCONCLUSIVE against B, FAIL against C3 | FAIL, clear 3 vs 0 | FAIL |
| 4 allergen misses overall | FAIL, clear 27 vs 2 (B) and vs 1 (C3) | FAIL, clear 19 vs 2 (B) and vs 1 (C3) | FAIL, clear 29 vs 2 (B) and vs 1 (C3) | FAIL |
| 5 recall, upper bound at most 8 | FAIL, +32.5 | FAIL, +10.9 | FAIL, +11.8 | FAIL, +8.7 (by 0.7) |
| 6 hallucinations at most B plus 1 | PASS, 0 | PASS, 0 | FAIL, 2 against a limit of 1 (see the note below) | PASS, 0 |
| Outcome | fails 1, 2, 3, 4, 5 | fails 1, 4, 5. Rule 3 is inconclusive. | passes 1, 2. Fails 3, 4, 5, 6. | fails 1, 3, 4, 5 |

Rule 6 for MM. B has 0 hallucinations on its 50 plates. MM has 2 (plate 01 "grilled tomatoes" and plate 20 "nori seaweed"), or 3 when the plate 45 rice trap leak is counted. The rule allows B plus 1, which is 1. So MM fails rule 6 by this arithmetic. An earlier hand summary listed rule 6 as a pass for MM. The numbers do not support that.

No cell passes all six rules. No cell can replace 3.8 by the rule as written.

## Cell L25: Gemini 2.5 Flash Lite, `google-vertex/eu`

Plates. 157/235 core items = 66.8 percent, 95 percent interval [54.1, 78.7]. C3 minus L25 is +17.9 points, interval [+4.6, +32.5].

| plate quantity | L25 | C3 |
|---|---|---|
| recall, all 50 plates | 157/235 = 66.8 | 199/235 = 84.7 |
| plates with no answer | 11 of 50 (9 HTTP 429, 2 `finish_reason: error`) | 0 |
| recall on the 39 answered plates | 157/183 = 85.8, [77.3, 92.9] | 151/183 = 82.5 |
| C3 minus L25 on the 39 answered plates | -3.3, [-11.5, +5.1] | |
| false unreadable | 0 | 0 |
| hallucinations | 0 | 0 |

The 429 answers read "temporarily rate-limited upstream", `limit_source: upstream_provider_shared_pool`, with the provider pinned and no fallback. The whole recall gap comes from the 11 error plates. On the plates it answered, L25 is level with C3.

Flags (`CANDIDATES-FLAGS-L25.md`).

| check | L25 | B | C3 |
|---|---|---|---|
| failed typed calls (rule 1) | 7 | 3 | 0 |
| clear pregnancy misses, typed, per repeat (rule 2) | [5, 2, 4], 7 distinct entries | 0 | 0 |
| pregnancy misses overall, clear (rule 3) | 16 | 0 | 0 |
| pregnancy misses overall, all entries (rule 3) | 30 | 0 | 0 |
| allergen misses overall, clear (rule 4) | 27 | 2 | 1 |
| allergen misses overall, all entries (rule 4) | 29 | 2 | 1.5 |

Rule 3 and rule 4 also fail when the entries of failed calls count as misses (rule 3 clear 26 vs 1, rule 4 clear 59 vs 6 against B).

Not blocking.

| measure | L25 | B | C3 | D3 |
|---|---|---|---|---|
| cost per typed call, USD | 0.00067 | 0.00707 | 0.00437 | 0.00238 |
| cost per plate, USD | 0.00124 | 0.01194 | 0.00896 | 0.00454 |
| wait typed, p50 / p95, s | 4.1 / 5.2 | 9.1 / 36.9 | 4.5 / 8.8 | 1.8 / 2.8 |
| wait plates, p50 / p95, s | 6.6 / 10.9 | 18.0 / 29.6 | 9.4 / 21.4 | 3.9 / 7.5 |
| kcal per 100 g within tolerance | 29/34 | 33/34 | 32/34 (cell C, production prompt) | 33/34 (cell D, production prompt) |
| brand items rated high (15 items) | 14/15 | 2/15 | 3/15 | 15/15 |
| vague foods rated low (9 items) | 3/9 | 9/9 | 9/9 | 9/9 |

L25 ignores `reasoning: minimal` on the EU host. It spends 753 reasoning tokens per typed call.

Verdict: L25 fails rules 1, 2, 3, 4 and 5. Rule 6 passes.

## Cell F25: Gemini 2.5 Flash, `google-vertex/eu`

Plates. 194/235 core items = 82.6 percent, interval [75.1, 89.6]. C3 minus F25 is +2.1 points, interval [-6.6, +10.9]. On the 49 answered plates the difference is +0.9, [-7.4, +8.8].

| plate quantity | F25 |
|---|---|
| plates with no answer | 1 of 50 (plate 15, a 429 inside an HTTP 200 body, 137.9 s) |
| false unreadable | 0 |
| hallucinations | 0 (one trap leak, plate 12) |
| recall, stricter reading of four close calls | 190/235 = 80.9, C3 minus F25 +3.8 [-4.6, +12.3] |

Flags (`CANDIDATES-FLAGS-F25.md`).

| check | F25 | B | C3 |
|---|---|---|---|
| failed typed calls (rule 1) | 1 (r1 t035, `length`, 8176 tokens of repeated allergens) | 3 | 0 |
| clear pregnancy misses, typed, per repeat (rule 2) | [0, 0, 0] | 0 | 0 |
| pregnancy misses overall, clear (rule 3) | 0 | 0 | 0 |
| pregnancy misses overall, all entries (rule 3) | 1 | 0 | 0 |
| allergen misses overall, clear (rule 4) | 19 | 2 | 1 |
| allergen misses overall, all entries (rule 4) | 23 | 2 | 1.5 |

Rule 3 against B is INCONCLUSIVE. The clear count is 0 against 0, the all-entries count is 1 against 0, and the count with failed calls as misses is 2 against 3. Against C3 it fails, because the all-entries count is 1 against 0.

Allergen misses. There are 9 clear plate misses, and 8 of them have the flag on another item. The typed misses that are real are:

| case | allergen | count |
|---|---|---|
| t065 | celery | 3 |
| t085 | lupin | 1 |
| t025 | celery | 1 |
| t027 | lupin | 1 |
| t008 | gluten | 1 |
| t052 | crustaceans | 1 |
| t045 | gluten | 2 (a split artefact, see Reading) |

Not blocking.

| measure | F25 | B | C3 |
|---|---|---|---|
| cost per typed call, USD | 0.00338 | 0.00707 | 0.00437 |
| cost per plate, USD | 0.00588 | 0.01194 | 0.00896 |
| wait typed, p50 / p95, s | 6.6 / 10.9 | 9.1 / 36.9 | 4.5 / 8.8 |
| wait plates, p50 / p95, s | 12.2 / 21.0 (maximum 137.9) | 18.0 / 29.6 | 9.4 / 21.4 |
| kcal per 100 g within tolerance | 34/34 | 33/34 | 32/34 (C) |
| carbs per 100 g within tolerance | 31/34 | 31/34 | 27/34 (C) |
| brand items rated high (15 items) | 15/15 | 2/15 | 3/15 |
| vague foods rated low (9 items) | 4/9 | 9/9 | 9/9 |

F25 ignores `reasoning: minimal` on the EU host. It spends 643 reasoning tokens per typed call.

Verdict: F25 fails rules 1 (2 failed calls), 4 and 5 (upper bound 10.9 against a limit of 8). Rule 3 is inconclusive. Rules 2 and 6 pass.

## Cell MM: Mistral Medium 3.1, `mistral/eu`

Plates. 188/235 core items = 80.0 percent, interval [74.9, 85.3]. C3 minus MM is +4.7 points, interval [-2.5, +11.8].

| plate quantity | MM |
|---|---|
| plates with no answer | 0 of 50 |
| schema invalid | 0 |
| retries | 0 |
| false unreadable | 0 |
| hallucinations | 2 (plates 01 and 20), 3 with the plate 45 trap leak |
| items outside the gold, typed / plates | 26 / 36 (B has 3 and 5) |

Flags (`CANDIDATES-FLAGS-MM.md`).

| check | MM | B | C3 |
|---|---|---|---|
| failed typed calls (rule 1) | 0 | 3 | 0 |
| clear pregnancy misses, typed, per repeat (rule 2) | [0, 0, 0] | 0 | 0 |
| pregnancy misses overall, clear (rule 3) | 3 | 0 | 0 |
| pregnancy misses overall, all entries (rule 3) | 4 | 0 | 0 |
| allergen misses overall, clear (rule 4) | 29 | 2 | 1 |
| allergen misses overall, all entries (rule 4) | 32 | 2 | 1.5 |

The three clear pregnancy misses are on plate 29 (salami), plate 40 (liver) and plate 45 (raw fish). Two of them have the flag on another item. Of the 20 clear plate allergen misses, 18 are unlisted items and 16 of those carry the flag on another item. The typed misses that are real are tiramisu gluten (3), cheesecake gluten, and the t045 and t062 bread splits.

Not blocking.

| measure | MM | B | C3 |
|---|---|---|---|
| false pregnancy alarms on controls | 53 | 7 | 8 |
| demotions from "contains" to "may contain" | 40 | 12 | 23 |
| cost per typed call, USD | 0.00099 | 0.00707 | 0.00437 |
| cost per plate, USD | 0.00368 | 0.01194 | 0.00896 |
| wait typed, p50 / p95, s | 2.6 / 5.8 | 9.1 / 36.9 | 4.5 / 8.8 |
| wait plates, p50 / p95, s | 8.2 / 15.0 | 18.0 / 29.6 | 9.4 / 21.4 |
| kcal per 100 g within tolerance | 33/34 | 33/34 | 32/34 (C) |
| carbs per 100 g within tolerance | 32/34 | 31/34 | 27/34 (C) |
| brand items rated high (15 items) | 15/15 | 2/15 | 3/15 |
| vague foods rated low (9 items) | 1/9 | 9/9 | 9/9 |

Verdict: MM passes rules 1 and 2. It fails rules 3, 4, 5 and 6. The first hand summary counted rule 6 as a pass. Under the rule text it is a fail by one hallucination.

## D3 as reference

D3 is Gemini 3.5 Flash Lite, EU host, v3 prompt. It is the cell the three candidates were meant to beat.

| quantity | D3 |
|---|---|
| plates, strict reading | 193/235 = 82.1 |
| C3 minus D3 | +2.6, [-3.1, +8.7]. Rule 5 fails by 0.7. |
| rules 3 and 4 | FAIL |
| cost per typed call / per plate, USD | 0.00238 / 0.00454 |
| wait typed, p50 / p95, s | 1.8 / 2.8 |
| wait plates, p50 / p95, s | 3.9 / 7.5 |
| brand items rated high | 15/15 |

## Reading

Rule 5 at 50 plates cannot pass unless the candidate equals 3.8 almost exactly. The decision rule says the same: the gap must be about 3 points or less. At 50 plates the paired interval is wide, so a candidate that sits near 3.8 needs more plates to decide. Tripling the plates to about 150 cuts the interval by about 40 percent. F25 (+2.1, upper bound +10.9) and MM (+4.7, upper bound +11.8) are in this zone. D3 (+2.6, upper bound +8.7) is as well. For L25 the upper bound of +32.5 comes from error records, not from identification quality, so more plates would not help it. A rerun of its 11 failed plates would.

Many MM and F25 allergen misses are naming artefacts. The model puts the flag on another item, and the gold mapping does not hold that item. The scorer calls this "elsewhere": the item is not in the answer under the gold name, but the same flag sits on another item. For MM, 16 of the 20 clear plate allergen misses carry the flag on another item. For F25, 8 of the 9. At meal level the person sees the allergen warning anyway. At item level, the level the rule counts, the item is missed. The rule text counts per item, so the verdicts above are per item. The meal level reading is a second view for the owner to weigh. It does not change a verdict. It does mean the allergen failures of MM and F25 are less severe than the raw counts suggest, and the typed misses listed above (celery, lupin, gluten, crustaceans) are the ones that are real.

L25 and F25 ignore `reasoning: minimal` on the EU host. L25 spends 753 reasoning tokens per typed call and F25 spends 643. The cost and wait numbers of both cells include that thinking. They are the numbers the product would pay, but they are not the numbers of a model that follows the setting.

The holdout gold set `gold/gold_text_holdout.jsonl` was not run on any cell yet. Every number here comes from the main gold set. The holdout is the check that these results do not depend on the cases used so far. It should run before any cell is chosen.

## Architecture

- One `UPSTREAM_BASE_URL` moves all five managed calls together: plates, typed text, kcal, pantry and recipes. A switch of host changes all of them at once.
- Routes by schema name in `ai-tiers.json` allow a stronger model for recipes or pantry only. A cheap model on plates and typed text could sit beside a stronger one on the calls where quality matters more.
- Google models keep the sub-processor and the privacy text (Gemini family, Google Cloud Vertex AI). L25 and F25 need no legal change.
- Mistral or Azure OpenAI would need new sub-processor text in six languages. MM would need it.
- The EU host carries about a 10 percent price surcharge. The prices in the tables above are EU prices.
- EU candidates in range that were not tested:

| model | price per M tokens (input / output, USD) | provider |
|---|---|---|
| `openai/gpt-6-luna` | 0.11 / 0.55 | `azure/eu` |
| `mistralai/mistral-small-2603` | 0.165 / 0.66 | |
| `google/gemini-3.1-flash-lite` | 0.275 / 1.65 | |

## Sources

| file | what it holds |
|---|---|
| `runs/v3-eu-cell-25-lite-newprompt/scorecard-filled.md` | L25 plate numbers (in the `prompt-v3` worktree) |
| `runs/v3-eu-cell-25-flash-newprompt/scorecard-filled.md` | F25 plate numbers |
| `runs/v3-eu-cell-mistral-medium-newprompt/scorecard-filled.md` | MM plate numbers |
| `runs/CANDIDATES-FLAGS-L25.md`, `-MM.md`, `-F25.md` | flag numbers, rules 2, 3 and 4, failed calls, demotions, false alarms |
| `runs/CANDIDATES-MISC-KCAL.md` and `CANDIDATES-MISC-KCAL-F25.md` | kcal, carbs, brand and vague-food confidence |
| `configs/score-flags-candidates-L25.json`, `-MM.json`, `-F25.json` | the scorer configs that wrote the flag files |
| `runs/EU-PLATE-SCORING-V3-2026-10-06.md`, `runs/EU-FLAG-SCORING-V3-2026-10-06.md` | B, C3 and D3 numbers |
