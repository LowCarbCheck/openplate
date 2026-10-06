# EU switch: kcal and carbs per 100 g on the kcal gold set (2026-10-06)

Scored by `python3 -m harness.score_misc --kcal-run ...` from finished run files. No model was called. Each of the 34 rows of `gold/gold_kcal_text.jsonl` was sent as its own typed case through the app's real text request, so this replaces the nine-food proxy of `EU-MISC-SCORING-2026-10-06.md` section 8. The reference is USDA SR Legacy per 100 g (see `gold/GOLD-NOTES.md` section 5). Tolerance is plus or minus 15 percent; for carbs a value within 1 g also passes. USDA carbs include fibre, and the app asks for total carbs on an estimate, so they compare directly. Two rows are drinks typed in ml (k033 cola, k034 beer) and compare per 100 ml against per 100 g; k030 mozzarella has a low-confidence reference (US low-moisture mozzarella).

Runs (`worktree:directory` is a run in that sibling worktree): B 3.8 default, prod prompt: var:kcal-eu-cell-38-newprompt; C 3.8 minimal, prod prompt: var:kcal-eu-cell-38-minimal-newprompt; D 3.5 lite, prod prompt: var:kcal-eu-cell-35-eu-newprompt; L25 2.5 lite v3: var:v3-kcal-eu-cell-25-lite-newprompt; MM mistral medium v3: var:v3-kcal-eu-cell-mistral-medium-newprompt. 

## kcal per 100 g

`split` counts the rows where the model gave the food as two or more items. Their per 100 g numbers are combined, weighted by `estimatedGrams` (the plain mean when an item has no grams), so a split food is scored whole.

| cell | scope | n | split | within tolerance | median signed error | null value |
|---|---|---|---|---|---|---|
| B 3.8 default, prod prompt | all 34 | 34 | 0 | 33/34 (97%) | 0.0% | 0 |
| B 3.8 default, prod prompt | reference high only | 28 | 0 | 28/28 (100%) | 0.0% | 0 |
| B 3.8 default, prod prompt | without the low reference | 33 | 0 | 33/33 (100%) | 0.0% | 0 |
| C 3.8 minimal, prod prompt | all 34 | 34 | 0 | 32/34 (94%) | 0.0% | 0 |
| C 3.8 minimal, prod prompt | reference high only | 28 | 0 | 27/28 (96%) | 0.0% | 0 |
| C 3.8 minimal, prod prompt | without the low reference | 33 | 0 | 32/33 (97%) | 0.0% | 0 |
| D 3.5 lite, prod prompt | all 34 | 34 | 0 | 33/34 (97%) | 0.0% | 0 |
| D 3.5 lite, prod prompt | reference high only | 28 | 0 | 27/28 (96%) | 0.0% | 0 |
| D 3.5 lite, prod prompt | without the low reference | 33 | 0 | 32/33 (97%) | 0.0% | 0 |
| L25 2.5 lite v3 | all 34 | 34 | 0 | 29/34 (85%) | 0.0% | 0 |
| L25 2.5 lite v3 | reference high only | 28 | 0 | 24/28 (86%) | 0.0% | 0 |
| L25 2.5 lite v3 | without the low reference | 33 | 0 | 29/33 (88%) | 0.0% | 0 |
| MM mistral medium v3 | all 34 | 34 | 0 | 33/34 (97%) | 0.0% | 0 |
| MM mistral medium v3 | reference high only | 28 | 0 | 27/28 (96%) | 0.0% | 0 |
| MM mistral medium v3 | without the low reference | 33 | 0 | 32/33 (97%) | 0.0% | 0 |

## carbs per 100 g (total, fibre included)

`split` counts the rows where the model gave the food as two or more items. Their per 100 g numbers are combined, weighted by `estimatedGrams` (the plain mean when an item has no grams), so a split food is scored whole.

| cell | scope | n | split | within tolerance | median signed error | null value |
|---|---|---|---|---|---|---|
| B 3.8 default, prod prompt | all 34 | 34 | 0 | 31/34 (91%) | -0.0% | 0 |
| B 3.8 default, prod prompt | reference high only | 28 | 0 | 26/28 (93%) | -0.1% | 0 |
| B 3.8 default, prod prompt | without the low reference | 33 | 0 | 31/33 (94%) | -0.0% | 0 |
| C 3.8 minimal, prod prompt | all 34 | 34 | 0 | 27/34 (79%) | -0.1% | 0 |
| C 3.8 minimal, prod prompt | reference high only | 28 | 0 | 22/28 (79%) | -0.1% | 0 |
| C 3.8 minimal, prod prompt | without the low reference | 33 | 0 | 27/33 (82%) | -0.1% | 0 |
| D 3.5 lite, prod prompt | all 34 | 34 | 0 | 30/34 (88%) | -0.1% | 0 |
| D 3.5 lite, prod prompt | reference high only | 28 | 0 | 24/28 (86%) | -0.1% | 0 |
| D 3.5 lite, prod prompt | without the low reference | 33 | 0 | 29/33 (88%) | -0.1% | 0 |
| L25 2.5 lite v3 | all 34 | 34 | 0 | 25/34 (74%) | -0.1% | 0 |
| L25 2.5 lite v3 | reference high only | 28 | 0 | 20/28 (71%) | -0.4% | 0 |
| L25 2.5 lite v3 | without the low reference | 33 | 0 | 25/33 (76%) | -0.1% | 0 |
| MM mistral medium v3 | all 34 | 34 | 0 | 32/34 (94%) | 0.0% | 0 |
| MM mistral medium v3 | reference high only | 28 | 0 | 26/28 (93%) | 0.0% | 0 |
| MM mistral medium v3 | without the low reference | 33 | 0 | 31/33 (94%) | 0.0% | 0 |

## Five worst per cell, kcal

Ranked by percent error. For carbs a row within 1 g still passes (`within` yes), so a near-zero reference such as butter can top the list and pass.

| cell | row | typed input | model | USDA | error | within | model confidence | reference confidence |
|---|---|---|---|---|---|---|---|---|
| B 3.8 default, prod prompt | k030 | 125 g di mozzarella | 250.0 | 299.0 | -16% | no | high | low |
| B 3.8 default, prod prompt | k008 | 250 g Vollmilch 3,5 % | 64 | 61.0 | +5% | yes | high | medium |
| B 3.8 default, prod prompt | k007 | 2 slices of whole-wheat bread, 64 g | 247 | 252.0 | -2% | yes | high | high |
| B 3.8 default, prod prompt | k015 | 2 tbsp peanut butter, 32 g | 588.0 | 598.0 | -2% | yes | high | high |
| B 3.8 default, prod prompt | k006 | 2 Scheiben Toastbrot, 50 g | 265.0 | 266.0 | -0% | yes | high | medium |
| C 3.8 minimal, prod prompt | k012 | 300 g Salzkartoffeln | 72 | 86.0 | -16% | no | high | high |
| C 3.8 minimal, prod prompt | k030 | 125 g di mozzarella | 253 | 299.0 | -15% | no | high | low |
| C 3.8 minimal, prod prompt | k008 | 250 g Vollmilch 3,5 % | 64 | 61.0 | +5% | yes | high | medium |
| C 3.8 minimal, prod prompt | k010 | 125 g Lachsfilet, Zuchtlachs, roh gewogen | 200 | 208.0 | -4% | yes | high | medium |
| C 3.8 minimal, prod prompt | k014 | 30 g Mandeln | 590 | 579.0 | +2% | yes | high | high |
| D 3.5 lite, prod prompt | k005 | 180 g di pasta cotta | 131 | 158.0 | -17% | no | high | high |
| D 3.5 lite, prod prompt | k030 | 125 g di mozzarella | 280 | 299.0 | -6% | yes | high | low |
| D 3.5 lite, prod prompt | k008 | 250 g Vollmilch 3,5 % | 64 | 61.0 | +5% | yes | high | medium |
| D 3.5 lite, prod prompt | k012 | 300 g Salzkartoffeln | 82 | 86.0 | -5% | yes | high | high |
| D 3.5 lite, prod prompt | k010 | 125 g Lachsfilet, Zuchtlachs, roh gewogen | 200 | 208.0 | -4% | yes | high | medium |
| L25 2.5 lite v3 | k022 | 150 g haşlanmış nohut | 135 | 164.0 | -18% | no | high | high |
| L25 2.5 lite v3 | k016 | 30 g cheddar | 370 | 403.0 | -8% | yes | high | high |
| L25 2.5 lite v3 | k005 | 180 g di pasta cotta | 150 | 158.0 | -5% | yes | high | high |
| L25 2.5 lite v3 | k008 | 250 g Vollmilch 3,5 % | 64 | 61.0 | +5% | yes | high | medium |
| L25 2.5 lite v3 | k034 | 0,5 l Bier | 45 | 43.0 | +5% | yes | high | medium |
| MM mistral medium v3 | k005 | 180 g di pasta cotta | 131 | 158.0 | -17% | no | high | high |
| MM mistral medium v3 | k012 | 300 g Salzkartoffeln | 77 | 86.0 | -10% | yes | high | high |
| MM mistral medium v3 | k016 | 30 g cheddar | 366.0 | 403.0 | -9% | yes | high | high |
| MM mistral medium v3 | k006 | 2 Scheiben Toastbrot, 50 g | 247.0 | 266.0 | -7% | yes | high | medium |
| MM mistral medium v3 | k030 | 125 g di mozzarella | 280 | 299.0 | -6% | yes | high | low |

## Five worst per cell, carbs

Ranked by percent error. For carbs a row within 1 g still passes (`within` yes), so a near-zero reference such as butter can top the list and pass.

| cell | row | typed input | model | USDA | error | within | model confidence | reference confidence |
|---|---|---|---|---|---|---|---|---|
| B 3.8 default, prod prompt | k023 | 10 g Butter | 0.7 | 0.06 | +1067% | yes | high | high |
| B 3.8 default, prod prompt | k016 | 30 g cheddar | 1.3 | 3.37 | -61% | no | high | high |
| B 3.8 default, prod prompt | k030 | 125 g di mozzarella | 1.0 | 2.4 | -58% | no | high | low |
| B 3.8 default, prod prompt | k029 | 25 g Walnusskerne | 7 | 13.71 | -49% | no | high | high |
| B 3.8 default, prod prompt | k012 | 300 g Salzkartoffeln | 17.5 | 20.01 | -13% | yes | high | high |
| C 3.8 minimal, prod prompt | k023 | 10 g Butter | 0.7 | 0.06 | +1067% | yes | high | high |
| C 3.8 minimal, prod prompt | k014 | 30 g Mandeln | 5.4 | 21.55 | -75% | no | high | high |
| C 3.8 minimal, prod prompt | k016 | 30 g cheddar | 1.3 | 3.37 | -61% | no | high | high |
| C 3.8 minimal, prod prompt | k019 | 200 g Brokkoli, roh | 2.7 | 6.64 | -59% | no | high | high |
| C 3.8 minimal, prod prompt | k030 | 125 g di mozzarella | 1.0 | 2.4 | -58% | no | high | low |
| D 3.5 lite, prod prompt | k023 | 10 g Butter | 0.1 | 0.06 | +67% | yes | high | high |
| D 3.5 lite, prod prompt | k016 | 30 g cheddar | 1.3 | 3.37 | -61% | no | high | high |
| D 3.5 lite, prod prompt | k019 | 200 g Brokkoli, roh | 2.7 | 6.64 | -59% | no | high | high |
| D 3.5 lite, prod prompt | k029 | 25 g Walnusskerne | 7.0 | 13.71 | -49% | no | high | high |
| D 3.5 lite, prod prompt | k005 | 180 g di pasta cotta | 25 | 30.86 | -19% | no | high | high |
| L25 2.5 lite v3 | k016 | 30 g cheddar | 0.5 | 3.37 | -85% | no | high | high |
| L25 2.5 lite v3 | k023 | 10 g Butter | 0.1 | 0.06 | +67% | yes | high | high |
| L25 2.5 lite v3 | k003 | 2 hart gekochte Eier, zusammen 110 g | 0.7 | 1.12 | -38% | yes | high | high |
| L25 2.5 lite v3 | k022 | 150 g haşlanmış nohut | 20 | 27.42 | -27% | no | high | high |
| L25 2.5 lite v3 | k034 | 0,5 l Bier | 4.5 | 3.55 | +27% | yes | high | medium |
| MM mistral medium v3 | k016 | 30 g cheddar | 0.1 | 3.37 | -97% | no | high | high |
| MM mistral medium v3 | k023 | 10 g Butter | 0.1 | 0.06 | +67% | yes | high | high |
| MM mistral medium v3 | k005 | 180 g di pasta cotta | 25 | 30.86 | -19% | no | high | high |
| MM mistral medium v3 | k012 | 300 g Salzkartoffeln | 17.5 | 20.01 | -13% | yes | high | high |
| MM mistral medium v3 | k015 | 2 tbsp peanut butter, 32 g | 20 | 22.31 | -10% | yes | high | high |

## Confidence calibration on the kcal rows

Items whose kcal per 100 g is more than 25 percent off USDA, and how many of them the model rated `high`. These are plain foods with stated grams, so `high` is the expected rating for most of them.

| cell | confidence of the 34 items | more than 25% off | rated high | share | which |
|---|---|---|---|---|---|
| B 3.8 default, prod prompt | high: 34, medium: 0, low: 0 | 0 | 0 | n/a | none |
| C 3.8 minimal, prod prompt | high: 34, medium: 0, low: 0 | 0 | 0 | n/a | none |
| D 3.5 lite, prod prompt | high: 34, medium: 0, low: 0 | 0 | 0 | n/a | none |
| L25 2.5 lite v3 | high: 30, medium: 0, low: 0 | 0 | 0 | n/a | none |
| MM mistral medium v3 | high: 34, medium: 0, low: 0 | 0 | 0 | n/a | none |

## Every row, kcal per 100 g

`off` marks a value outside plus or minus 15 percent. `split` marks a row the model gave as two or more items, combined as described above.

| row | typed input | USDA | B 3.8 default, prod prompt | C 3.8 minimal, prod prompt | D 3.5 lite, prod prompt | L25 2.5 lite v3 | MM mistral medium v3 |
|---|---|---|---|---|---|---|---|
| k001 | 150 g Banane | 89 | 89 (+0%) | 89 (+0%) | 89 (+0%) | 89 (+0%) | 89 (+0%) |
| k002 | 1 apple, 180 g | 52 | 52 (+0%) | 52 (+0%) | 52 (+0%) | 52 (+0%) | 52 (+0%) |
| k003 | 2 hart gekochte Eier, zusammen 110 g | 155 | 155 (+0%) | 155 (+0%) | 155 (+0%) | 155 (+0%) | 155 (+0%) |
| k004 | 200 g cooked white rice | 130 | 130 (+0%) | 130 (+0%) | 130 (+0%) | 130 (+0%) | 130 (+0%) |
| k005 | 180 g di pasta cotta | 158 | 158 (+0%) | 158 (+0%) | 131 (-17%, off) | 150 (-5%) | 131 (-17%, off) |
| k006 | 2 Scheiben Toastbrot, 50 g | 266 | 265 (-0%) | 265 (-0%) | 265 (-0%) | 270 (+2%) | 247 (-7%) |
| k007 | 2 slices of whole-wheat bread, 64 g | 252 | 247 (-2%) | 252 (+0%) | 247 (-2%) | 250 (-1%) | 247 (-2%) |
| k008 | 250 g Vollmilch 3,5 % | 61 | 64 (+5%) | 64 (+5%) | 64 (+5%) | 64 (+5%) | 64 (+5%) |
| k009 | 150 g roasted chicken breast, no skin | 165 | 165 (+0%) | 165 (+0%) | 165 (+0%) | 165 (+0%) | 165 (+0%) |
| k010 | 125 g Lachsfilet, Zuchtlachs, roh gewogen | 208 | 208 (+0%) | 200 (-4%) | 200 (-4%) | 208 (+0%) | 208 (+0%) |
| k011 | half an avocado, 100 g | 160 | 160 (+0%) | 160 (+0%) | 160 (+0%) | 160 (+0%) | 160 (+0%) |
| k012 | 300 g Salzkartoffeln | 86 | 86 (+0%) | 72 (-16%, off) | 82 (-5%) | 84 (-2%) | 77 (-10%) |
| k013 | 40 g rolled oats (dry) | 379 | 379 (+0%) | 379 (+0%) | 389 (+3%) | 372 (-2%) | 389 (+3%) |
| k014 | 30 g Mandeln | 579 | 579 (+0%) | 590 (+2%) | 579 (+0%) | n/a | 579 (+0%) |
| k015 | 2 tbsp peanut butter, 32 g | 598 | 588 (-2%) | 597 (-0%) | 588 (-2%) | 590 (-1%) | 588 (-2%) |
| k016 | 30 g cheddar | 403 | 403 (+0%) | 403 (+0%) | 403 (+0%) | 370 (-8%) | 366 (-9%) |
| k017 | 170 g nonfat Greek yogurt | 59 | 59 (+0%) | 59 (+0%) | 59 (+0%) | 59 (+0%) | 59 (+0%) |
| k018 | Una naranja de 160 g | 47 | 47 (+0%) | 47 (+0%) | 47 (+0%) | 47 (+0%) | 47 (+0%) |
| k019 | 200 g Brokkoli, roh | 34 | 34 (+0%) | 34 (+0%) | 34 (+0%) | 34 (+0%) | 34 (+0%) |
| k020 | 100 g de carottes crues | 41 | 41 (+0%) | 41 (+0%) | 41 (+0%) | 41 (+0%) | 41 (+0%) |
| k021 | 200 g cooked lentils | 116 | 116 (+0%) | 116 (+0%) | 116 (+0%) | 116 (+0%) | 116 (+0%) |
| k022 | 150 g haşlanmış nohut | 164 | 164 (+0%) | 164 (+0%) | 164 (+0%) | 135 (-18%, off) | 164 (+0%) |
| k023 | 10 g Butter | 717 | 717 (+0%) | 717 (+0%) | 717 (+0%) | 748 (+4%) | 717 (+0%) |
| k024 | 15 g di olio d'oliva | 884 | 884 (+0%) | 884 (+0%) | 884 (+0%) | 884 (+0%) | 884 (+0%) |
| k025 | 20 g Honig | 304 | 304 (+0%) | 304 (+0%) | 304 (+0%) | 304 (+0%) | 304 (+0%) |
| k026 | 150 g strawberries | 32 | 32 (+0%) | 32 (+0%) | 32 (+0%) | 32 (+0%) | 32 (+0%) |
| k027 | 185 g cooked quinoa | 120 | 120 (+0%) | 120 (+0%) | 120 (+0%) | 120 (+0%) | 120 (+0%) |
| k028 | 1 baked sweet potato, 150 g | 90 | 90 (+0%) | 90 (+0%) | 90 (+0%) | n/a | 86 (-4%) |
| k029 | 25 g Walnusskerne | 654 | 654 (+0%) | 654 (+0%) | 654 (+0%) | 654 (+0%) | 654 (+0%) |
| k030 | 125 g di mozzarella | 299 | 250 (-16%, off) | 253 (-15%, off) | 280 (-6%) | n/a | 280 (-6%) |
| k031 | 20 g dark chocolate, 70 to 85 percent cocoa | 598 | 598 (+0%) | 598 (+0%) | 598 (+0%) | n/a | 598 (+0%) |
| k032 | 2 Tomaten, 240 g | 18 | 18 (+0%) | 18 (+0%) | 18 (+0%) | 18 (+0%) | 18 (+0%) |
| k033 | a 330 ml can of cola | 42 | 42 (+0%) | 42 (+0%) | 42 (+0%) | 42 (+0%) | 42 (+0%) |
| k034 | 0,5 l Bier | 43 | 43 (+0%) | 43 (+0%) | 43 (+0%) | 45 (+5%) | 43 (+0%) |

## Brand and vague-food confidence on the typed runs

The kcal rows name no brand, so brand calibration comes from the typed gold runs: t017 Snickers, t028 Nutella, t057 Philadelphia, t061 Big Mac, t076 Starbucks, times the repeats. The prompt asks for LOW confidence on a named brand; gold expects `low` for t017, t061 and t076. Labels are repeat:case.

| cell | typed repeats | brand items | found | rated high (all) | rated high (the `expect low` ones) | brand field right | rated high, labels |
|---|---|---|---|---|---|---|---|
| B 3.8 default, prod prompt | 3 | 15 | 15 | 2/15 | 2/9 | 13/15 | r1:t061, r2:t061 |
| C3 | 3 | 15 | 15 | 3/15 | 3/9 | 15/15 | r1:t061, r2:t061, r3:t061 |
| D3 | 3 | 15 | 15 | 15/15 | 9/9 | 14/15 | r1:t017, r1:t028, r1:t057, r1:t061, r1:t076, r2:t017, r2:t028, r2:t057, r2:t061, r2:t076, r3:t017, r3:t028, r3:t057, r3:t061, r3:t076 |
| L25 2.5 lite v3 | 3 | 15 | 15 | 14/15 | 9/9 | 10/15 | r1:t017, r1:t028, r1:t057, r1:t061, r1:t076, r2:t017, r2:t057, r2:t061, r2:t076, r3:t017, r3:t028, r3:t057, r3:t061, r3:t076 |
| MM mistral medium v3 | 3 | 15 | 15 | 15/15 | 9/9 | 6/15 | r1:t017, r1:t028, r1:t057, r1:t061, r1:t076, r2:t017, r2:t028, r2:t057, r2:t061, r2:t076, r3:t017, r3:t028, r3:t057, r3:t061, r3:t076 |

Vague foods (t034 'a bar', t035 'some cheese', t071 'some curry') should be `low`. The last three columns are the mix over every item of every typed answer.

| cell | vague foods rated low | not rated low | items | high | medium | low |
|---|---|---|---|---|---|---|
| B 3.8 default, prod prompt | 9/9 | none | 360 | 88% | 6% | 6% |
| C3 | 9/9 | none | 357 | 93% | 1% | 6% |
| D3 | 9/9 | none | 372 | 95% | 2% | 2% |
| L25 2.5 lite v3 | 3/9 | r1:t035 medium, r1:t071 medium, r2:t035 high, r2:t071 high, r3:t071 medium | 393 | 95% | 3% | 1% |
| MM mistral medium v3 | 1/9 | r1:t034 medium, r1:t035 medium, r1:t071 medium, r2:t034 medium, r2:t035 medium, r2:t071 medium, r3:t034 medium, r3:t035 medium | 421 | 94% | 6% | 0% |

## What stands out

(not written yet)
