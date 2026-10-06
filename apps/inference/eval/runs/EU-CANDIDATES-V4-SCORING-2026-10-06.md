# EU switch: second round on the v4 prompt, four cells against the decision rule (2026-10-06)

No model was called to write this file. It restates numbers from finished runs and their scorers. Every number has a source in the list at the end.

## Purpose

The first round (`EU-CANDIDATES-SCORING-2026-10-06.md`) used the v3 prompt, one plate run per cell and one to three typed runs. No cell passed. The owner asked for a bigger run. This round uses the v4 prompt, three plate runs and three holdout runs for the candidates, and a held-out typed set that the prompts do not name.

| cell | model | provider pin | plate runs | main typed runs | holdout runs |
|---|---|---|---|---|---|
| C3v4 | Gemini 3.8 Flash, reasoning minimal, v4 prompt. This is the reference. | Google | 1 | 1 | 3 |
| F25v4 | `google/gemini-2.5-flash`, minimal asked | `google-vertex/eu` | 3 | 0 | 3 |
| G31 | `google/gemini-3.1-flash-lite`, minimal asked | `google-vertex/eu` | 3 | 1 | 3 |
| O6 | `openai/gpt-6-luna`, no reasoning asked | `azure/eu` | 3 | 1 | 3 |

The holdout set is `gold/gold_text_holdout.jsonl`. It holds 36 typed cases. It names no food that the v3 or the v4 prompt names, so a pass shows that a model applies a category to a food it was not shown. The main typed set is `gold/gold_text.jsonl`. The 50 plates have 235 gold items.

The other references stay the same as in the first round. B is 3.8 with default reasoning and the production prompt. C3 is 3.8 minimal with the v3 prompt (199/235 on the plates).

## The six decision rules

The rules come from `.tracker/worklog/eu-switch-decision-rule.md` in the umbrella workspace. They were written before the first measurement. Any one failure means no switch.

| rule | text, short |
|---|---|
| 1 | Schema validity. Zero schema-invalid answers across all calls. Zero false "unreadable" on the 50 plates. |
| 2 | Pregnancy misses on clear cases. Zero misses on the clear must-flag typed cases, in every repeat. |
| 3 | Pregnancy misses overall (typed and plates) no higher than the reference. A miss means the category is absent. |
| 4 | Allergen misses overall no higher than the reference. An allergen counts as missed only when it is in neither `allergens` nor `mayContain`. |
| 5 | Recall. The upper bound of the paired 95 percent bootstrap interval of (reference recall minus candidate recall) is at most 8 points. |
| 6 | Hallucinations. At most the reference count plus 1 over all plates and repeats. |

How the rules were applied here.

- The reference for rules 3 to 6 is C3v4, the same model with the same prompt. B and C3 are shown in the flag files. B gives the same verdicts as C3v4 on rules 3 and 4.
- Rule 5 is also judged against C3 v3 (199/235), because the v4 prompt lifts 3.8 itself (see below).
- Rule 1 was judged on the plate, main typed and holdout calls. Pantry and recipe calls were not run. A pass covers less than the rule asks for.
- Rule 2 is judged on the main typed set (one repeat per cell, F25v4 has none) and on the holdout (three repeats). The holdout is the stronger test, so it decides.
- A failed call is not a flag miss. It is scored by rule 1. The scorer prints a second count where the clear entries of failed calls count as misses.
- All ten plate sheets were filled under the strict reading of rule 1 (a generic label earns no credit for a specific gold item).

## Verdicts per cell

| rule | C3v4 (reference) | F25v4 | G31 | O6 |
|---|---|---|---|---|
| 1 schema validity | PASS, 0 failed of 249 calls | FAIL, 1 of 258 calls: plate 45 in repeat 3 stopped on `length` | PASS, 0 failed of 349 calls | FAIL, 4 of 349 calls: h005 `content_filter` in all three holdout repeats, and plate 06 Azure 502 in repeat 3 |
| 1 false unreadable on plates | 0 | 0 | 0 | 0 |
| 2 main typed set | PASS, [0] | not run, no main typed run | PASS, [0] | PASS, [0] |
| 2 holdout | FAIL, misses per repeat [1, 1, 2] | FAIL, [5, 5, 5] | FAIL, [5, 4, 6] | FAIL, [4, 3, 2] and h005 refused every time |
| 3 pregnancy misses overall | reference | INCONCLUSIVE. Clear 0.67 vs 1 and all entries 1 vs 1 pass. With failed calls as misses, 1.33 vs 1 fails. | FAIL, clear 1.33 vs 1, all entries 7.33 vs 1 | FAIL, clear 4.67 vs 1, all entries 6.34 vs 1 |
| 4 allergen misses overall | reference | FAIL, clear 9.33 vs 4, all entries 9.66 vs 5 | FAIL, clear 35 vs 4, all entries 36.33 vs 5 | FAIL, clear 33.67 vs 4, all entries 36.67 vs 5 |
| 5 recall, upper bound at most 8 | reference | FAIL, 10.5 against C3v4. PASS, 6.9 against C3 v3. | FAIL, 16.7 | FAIL, 32.9 |
| 6 hallucinations at most 1 | 0 | PASS, 0, 0, 0 | PASS, 0, 0, 0 | FAIL in repeats 2 and 3 (1, 2, 2) |
| Outcome | fails holdout rule 2 on h007 | fails 1, 2 (holdout), 4, 5. Rule 3 is inconclusive. | fails 2 (holdout), 3, 4, 5 | fails 1, 2 (holdout), 3, 4, 5, 6 |

Counts of rules 3 and 4 are per plate run for the plates, summed over repeats for typed calls and scaled to three repeats where a cell has fewer. The rule counts per item, so a flag that sits on another item still counts as a miss. Most of the allergen misses are items the model did not list under the gold name. The scorer calls these unlisted. For most of them the same flag sits on another item. The numbers are the clear plate allergen misses over all plate runs.

| cell | plate runs | clear allergen misses | unlisted items | of those, flag on another item |
|---|---|---|---|---|
| C3v4 | 1 | 4 | 3 | 3 |
| F25v4 | 3 | 28 | 24 | 23 |
| G31 | 3 | 42 | 38 | 37 |
| O6 | 3 | 101 | 92 | 72 |

No cell passes all six rules. The reference itself fails rule 2 on the holdout.

## Plates: pooled comparison

All ten sheets score the same 50 plates and 235 items. The cell value of a plate is the mean of its hits over the repeats. The paired bootstrap resamples plates (2000 resamples). Model noise averages out. Plate sampling noise stays.

| cell | hits per repeat | mean recall | C3v4 minus cell, 95% CI | rule 5 vs C3v4 | C3 v3 minus cell, 95% CI | rule 5 vs C3 v3 |
|---|---|---|---|---|---|---|
| C3v4 | 208 | 88.5 | reference | | | |
| F25v4 | 194, 206, 191 | 83.8 | +4.7 [-1.2, +10.5] | FAIL | +0.9 [-5.4, +6.9] | PASS |
| G31 | 186, 184, 179 | 77.9 | +10.6 [+4.6, +16.7] | FAIL | +6.8 [+2.0, +11.5] | FAIL |
| O6 | 157, 147, 145 | 63.7 | +24.8 [+16.7, +32.9] | FAIL | +21.0 [+12.4, +29.9] | FAIL |

Single repeats against C3v4: only F25v4 repeat 2 passes (upper bound 6.3). F25v4 repeats 1 and 3 give +6.0 [-0.4, +13.0] and +7.2 [-1.7, +17.4]. G31 and O6 fail in every repeat.

Two plate repeats contain an error record that scores 0. If each is replaced by the mean of the other two repeats, F25v4 reads 84.9 with +3.6 [-1.7, +8.9] against C3v4 (still FAIL) and -0.2 [-6.0, +5.7] against C3 v3 (PASS). O6 reads 64.1 and still fails by a wide margin. No rule 5 verdict changes.

### The prompt effect on 3.8 itself

| cell | hits | recall | difference |
|---|---|---|---|
| C3 v3 (production era prompt) | 199 | 84.7 | |
| C3v4 | 208 | 88.5 | +3.8 [0.0, +8.7] for C3v4 minus C3 v3 |

Both are single runs. The effect is positive and borderline. The reference moved up, so rule 5 is harder against C3v4 than it was against C3.

### Spread between repeats

| cell | min to max recall | spread | plates where repeats differ by 3 or more hits |
|---|---|---|---|
| F25v4 | 81.3 to 87.7 | 6.4 points (15 hits) | 03 (3, 8, 4), 28 (7, 3, 4), 35 (3, 8, 2), 45 (8, 7, 0, repeat 3 is an error record) |
| G31 | 76.2 to 79.1 | 3.0 points (7 hits) | 03 (8, 7, 1), 06 (1, 4, 2), 32 (5, 5, 8) |
| O6 | 61.7 to 66.8 | 5.1 points (12 hits) | 06 (4, 2, 0, repeat 3 is an error record), 07 (5, 2, 2), 33 (5, 2, 5) |

A single run of F25v4 can land anywhere from a pass to a clear fail against C3 v3. This is why the first round could not decide it.

### Hallucinations and error records

| cell | hallucinations, repeats 1 to 3 | error records | notes |
|---|---|---|---|
| C3v4 | 0 | 0 | |
| F25v4 | 0, 0, 0 | 0, 0, 1 | plate 45, repeat 3: output cut at the 8192 token cap (8153 completion tokens, 719 of them reasoning), schema invalid, scored 0 of 8 |
| G31 | 0, 0, 0 | 0, 0, 0 | |
| O6 | 1, 2, 2 | 0, 0, 1 | banana on plate 21 in all three repeats, flatbread on plate 50 in repeats 2 and 3. Plate 06 in repeat 3: Azure EU 502, scored 0 of 6. |

False unreadable is 0 in all ten sheets.

### Consistency across the ten sheets

The ten sheets were adjudicated by hand in sequence. A scan checks that the same model item on the same plate got the same verdict in every sheet.

- 2325 keys exist and 723 appear in more than one sheet. Result: 0 inconsistent verdicts.
- Control: flipping one hit to n in memory makes the same scan report 1 conflict, so the scan can fail.
- Three more passes also found 0: names reduced to letters and digits, a row level pass for equal reported lists with different verdicts, and a looser attribution of 149 hit rows whose notes name no item.
- Applying the stricter verdict everywhere changes 0 hits in every cell. No rule 5 verdict flips.

## Holdout: pregnancy misses

The holdout has 36 cases. Rule 2 asks for zero misses on the clear pregnancy entries in every repeat. A miss means the model listed the food and the category is absent.

| cell | misses per repeat | distinct entries missed | failed calls holding a clear entry |
|---|---|---|---|
| C3v4 | [1, 1, 2] | 2 (h007, h008) | 0 |
| F25v4 | [5, 5, 5] | 6 | 0 |
| G31 | [5, 4, 6] | 6 | 0 |
| O6 | [4, 3, 2] | 4 | [1, 1, 1] (h005) |

Per case. An x marks a miss in that repeat (r1, r2, r3).

| case | food and category | C3v4 | F25v4 | G31 | O6 |
|---|---|---|---|---|---|
| h002 | Landjaeger and Spezi, caffeine | | r3 (name gap, see below) | | |
| h004 | haggis, liver-retinol | | | r1 r2 r3 | |
| h005 | faggots, liver-retinol | | | | refused r1 r2 r3 (`content_filter`) |
| h006 | Tuscan chicken liver crostini, liver-retinol | | | r3 | |
| h007 | pike quenelles, high-mercury-fish | r1 r2 r3 | r1 r2 r3 | r1 r2 r3 | r1 r2 r3 |
| h008 | orange roughy, high-mercury-fish | r3 | r1 r2 r3 | r1 r2 r3 | r1 r2 r3 |
| h009 | seared ahi tuna, raw-fish | | r1 r2 | r1 r3 | r1 |
| h010 | matjes herring, raw-fish | | r1 r2 r3 | | |
| h011 | smoked saithe slices, smoked-fish | | r1 r2 r3 | r1 r2 r3 | r1 r2 |

Every cell misses h007 in every repeat, 12 of 12 including the reference. h008 is missed in all 9 candidate repeats and once by the reference. Fish with a known mercury or smoking status is where the models fail. The rest of the list is cell specific. G31 misses haggis in all repeats. F25v4 misses matjes in all repeats.

Without h007 the per repeat counts are C3v4 [0, 0, 1], F25v4 [4, 4, 4], G31 [4, 3, 5] and O6 [3, 2, 1]. This is arithmetic on the table above. The rule text is absolute, so the verdicts above stand.

### Real misses and alias or name gaps

The scorer matches model items to gold items by word overlap and by gold `aliases` (`gold/GOLD-NOTES.md`, section 2). An alias adds a holder and never removes one. Two kinds of entry need a note.

- Hits that only an alias or a component made. Per repeat: C3v4 aliases [3, 3, 5] and components [1, 1, 2]; F25v4 [5, 5, 4] and [2, 1, 2]; G31 [2, 1, 3] and [2, 2, 2]; O6 [3, 1, 0] and [2, 1, 1]. Of these, the pregnancy hits are C3v4 h011 smoked-fish once and h014 raw-egg three times, F25v4 h014 raw-egg three times, O6 h014 raw-egg once. Without aliases every cell would show more misses, not fewer.
- Misses where the model did name the food under a name the gold does not know. F25v4 repeat 3, h002: the model listed "Spezi" and put caffeine on it. No alias for Spezi exists in h002, so the scorer calls it an unlisted miss. It is a gold gap, and the real F25v4 misses are [5, 5, 4]. G31 repeat 3, h035: the model renamed a decaf latte "cappuccino" and put milk on it. The alias rule forbids a wrong dish as an alias (`GOLD-NOTES.md` says so for h035), so this counts as a miss. It is an allergen entry, not a pregnancy one.

All other holdout misses are listed misses: the model named the food and left the flag off. No verdict changes if the h002 gap is credited.

## Holdout: allergens and false alarms

| cell | allergen clear misses per repeat | allergen not clear misses per repeat | pregnancy false alarms per repeat | allergen false alarms per repeat | clear allergen demotions per repeat |
|---|---|---|---|---|---|
| C3v4 | [0, 0, 0] | [0, 0, 0] | [0, 0, 0] | [0, 0, 0] | [2, 1, 1] |
| F25v4 | [0, 1, 2] | [2, 1, 3] | [2, 5, 3] | [1, 1, 1] | [3, 1, 0] |
| G31 | [0, 0, 1] | [2, 1, 2] | [3, 4, 3] | [1, 1, 1] | [2, 1, 0] |
| O6 | [0, 0, 0] | [1, 2, 2] | [3, 2, 3] | [0, 0, 0] | [4, 3, 5] |

- F25v4 clear allergen misses: gluten in the bread of h033 (repeat 2), gluten in haggis (h004) and celery in Waldorf salad (h023) in repeat 3. All three are real.
- G31 clear allergen miss: h035 milk on a renamed item (see above).
- Not clear allergen misses repeat across repeats: Brathering gluten (h031) in F25v4 and O6 every repeat, tamago kake gohan with natto soy (h014) in G31 every repeat.
- False alarms are not blocking. They show that C3v4 raises none on the holdout, and the candidates raise 2 to 5 pregnancy alarms per repeat. The common ones are raw-egg on sherry trifle, raw-meat on cooked Kassler, soft-cheese on cream cheese and caffeine on decaf latte.
- Demotions of a clear allergen from "contains" to "may contain" are highest on O6 (4, 3, 5 per repeat, against 2, 1, 1 for C3v4). They are not blocking.

## Not blocking: cost, latency, reasoning, brands

Source: `V4-MISC.md`. Wait is total wait over all attempts.

| measure | C3v4 | F25v4 | G31 | O6 |
|---|---|---|---|---|
| cost per plate, USD | 0.00942 | 0.00587 | 0.00331 | 0.00094 |
| cost per holdout call, USD | 0.00527 | 0.00417 | 0.00219 | 0.00055 |
| cost per main typed call, USD | 0.00447 | not run | 0.00180 | 0.00039 |
| plate wait, p50 / p95, s | 9.5 / 39.4 | 11.2 / 21.3 | 3.9 / 6.7 | 13.1 / 22.1 |
| holdout wait, p50 / p95, s | 5.8 / 25.0 | 8.6 / 25.9 | 2.5 / 3.4 | 8.7 / 16.1 |
| reasoning tokens per call, plates | 98 | 742 | 0 | 753 |
| reasoning tokens per call, holdout | 0 | 748 | 0 | 539 |
| reasoning tokens per call, main typed | 7 | not run | 0 | 345 |
| retried calls, holdout / plates | 1 / 0 | 17 / 4 | 0 / 0 | 0 / 0 |
| brand items found, rated high | 5 of 5, 0 | not run | 4 of 5, 3 | 5 of 5, 0 |
| vague foods rated low (3 items) | 1 of 3 | not run | 0 of 3 | 0 of 3 |

- F25v4 and O6 ignore the reasoning setting. F25v4 spends 740 to 750 reasoning tokens per call although minimal was asked. O6 spends 540 to 750 although none was asked. Their cost and wait include that thinking. They are the numbers the product would pay, not the numbers of a model that follows the setting.
- G31 rates 3 of 5 brand items high. C3v4 and O6 rate none high. This is the wrong direction for G31.
- Cost per call is lowest on O6 and G31. Neither is usable at its recall.

## Reading

- The reference itself fails holdout rule 2 on pike quenelles. C3v4 misses h007 in all three repeats and h008 once. So h007 is a knowledge edge case, not a defect of a candidate. It stays in the set, with a note in `gold/GOLD-NOTES.md` ("kept, 3.8 misses it too"). The gap between the reference and the candidates is still large: 1 to 2 misses per repeat against 4 to 6.
- Rule 5 at 50 plates is decided by the prompt uplift of 3.8. Against C3 v3, F25v4 passes (+0.9, upper bound 6.9). Against C3v4 it fails (+4.7, upper bound 10.5). The v4 prompt lifted the reference by 3.8 points, so the gap to every candidate grew against it.
- No candidate passes. G31 and O6 fail rule 5 by a wide margin. O6 also refuses faggots with an Azure content filter in every repeat and hallucinates above the limit.
- 2.5 Flash is the only cell within reach on plates. It fails on fish knowledge in the holdout (5 pregnancy misses per repeat against 1 to 2) and on allergens in the main set (9.33 clear plate misses per run against 4). It also has the widest spread between repeats (6.4 points), and one plate in repeat 3 ran into the token cap.
- The EU host cannot deliver 3.8 quality today. The best EU cell is a few points below the reference on plates and clearly below it on flags.
- More repeats do not shrink the plate interval, because plate sampling noise stays. More plates would shrink it. The decision rule says rule 5 passes only when the observed gap is about 3 points or less, and the F25v4 gap against C3v4 is 4.7. The flag results are the blocker in any case.

## Architecture

- One `UPSTREAM_BASE_URL` moves all five managed calls together: plates, typed text, kcal, pantry and recipes. A switch of host changes all of them at once.
- Routes by schema name in `ai-tiers.json` allow a stronger model for recipes or pantry only. A cheap model could sit on a call where quality matters less. No cell here earns that role on plates or typed text.
- Google models (F25v4, G31) keep the sub-processor and the privacy text (Gemini family, Google Cloud Vertex AI). They need no legal change.
- O6 runs on Azure OpenAI. It would need new sub-processor text in six languages. Mistral would need the same.
- The EU host carries about a 10 percent price surcharge. The prices below are EU prices.

| model | price per M tokens (input / output, USD) | provider | cell |
|---|---|---|---|
| `google/gemini-2.5-flash` | 0.30 / 2.50 | `google-vertex/eu` | F25v4 |
| `google/gemini-3.1-flash-lite` | 0.275 / 1.65 | `google-vertex/eu` | G31 |
| `openai/gpt-6-luna` | 0.11 / 0.55 | `azure/eu` | O6 |

## Cost of this round

About 4.7 USD. The OpenRouter key shows 2.87 USD remaining of its 20 USD limit on 2026-10-06. The limit must be raised before any further run.

## Sources

| file | what it holds |
|---|---|
| `runs/v4-eu-cell-*/scorecard-filled.md` (ten sheets) | plate verdicts, hits, hallucinations, errors, paired differences |
| `runs/V4-PLATES.md` | pooled plate comparison, spread, sensitivity, consistency check |
| `runs/V4-FLAGS-C3v4.md`, `-F25v4.md`, `-G31.md`, `-O6.md` and their `.json` | rules 2 to 4, holdout block, misses, false alarms, demotions, aliases |
| `runs/V4-MISC.md` and `.json` | rule 1 failures, cost, latency, reasoning tokens, brands, vague foods |
| `configs/score-flags-v4.json` | the scorer config |
| `gold/gold_text_holdout.jsonl`, `gold/GOLD-NOTES.md` | the holdout set and the alias rule |
| `.tracker/worklog/eu-switch-decision-rule.md` (umbrella) | the six rules |
| `runs/EU-CANDIDATES-SCORING-2026-10-06.md` | the first round, v3 prompt |
