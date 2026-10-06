# EU switch: kcal and carbs per 100 g on the kcal gold set (2026-10-06)

Scored by `python3 -m harness.score_misc --kcal-run ...` from finished run files. No model was called. Each of the 34 rows of `gold/gold_kcal_text.jsonl` was sent as its own typed case through the app's real text request, so this replaces the nine-food proxy of `EU-MISC-SCORING-2026-10-06.md` section 8. The reference is USDA SR Legacy per 100 g (see `gold/GOLD-NOTES.md` section 5). Tolerance is plus or minus 15 percent; for carbs a value within 1 g also passes. USDA carbs include fibre, and the app asks for total carbs on an estimate, so they compare directly. Two rows are drinks typed in ml (k033 cola, k034 beer) and compare per 100 ml against per 100 g; k030 mozzarella has a low-confidence reference (US low-moisture mozzarella).

Runs (`worktree:directory` is a run in that sibling worktree): F25 2.5 flash v3: var:v3-kcal-eu-cell-25-flash-newprompt. 

## kcal per 100 g

`split` counts the rows where the model gave the food as two or more items. Their per 100 g numbers are combined, weighted by `estimatedGrams` (the plain mean when an item has no grams), so a split food is scored whole.

| cell | scope | n | split | within tolerance | median signed error | null value |
|---|---|---|---|---|---|---|
| F25 2.5 flash v3 | all 34 | 34 | 0 | 34/34 (100%) | 0.0% | 0 |
| F25 2.5 flash v3 | reference high only | 28 | 0 | 28/28 (100%) | 0.0% | 0 |
| F25 2.5 flash v3 | without the low reference | 33 | 0 | 33/33 (100%) | 0.0% | 0 |

## carbs per 100 g (total, fibre included)

`split` counts the rows where the model gave the food as two or more items. Their per 100 g numbers are combined, weighted by `estimatedGrams` (the plain mean when an item has no grams), so a split food is scored whole.

| cell | scope | n | split | within tolerance | median signed error | null value |
|---|---|---|---|---|---|---|
| F25 2.5 flash v3 | all 34 | 34 | 0 | 31/34 (91%) | 0.0% | 0 |
| F25 2.5 flash v3 | reference high only | 28 | 0 | 25/28 (89%) | -0.0% | 0 |
| F25 2.5 flash v3 | without the low reference | 33 | 0 | 30/33 (91%) | 0.0% | 0 |

## Five worst per cell, kcal

Ranked by percent error. For carbs a row within 1 g still passes (`within` yes), so a near-zero reference such as butter can top the list and pass.

| cell | row | typed input | model | USDA | error | within | model confidence | reference confidence |
|---|---|---|---|---|---|---|---|---|
| F25 2.5 flash v3 | k012 | 300 g Salzkartoffeln | 77 | 86.0 | -10% | yes | high | high |
| F25 2.5 flash v3 | k030 | 125 g di mozzarella | 280 | 299.0 | -6% | yes | high | low |
| F25 2.5 flash v3 | k008 | 250 g Vollmilch 3,5 % | 64 | 61.0 | +5% | yes | high | medium |
| F25 2.5 flash v3 | k007 | 2 slices of whole-wheat bread, 64 g | 240 | 252.0 | -5% | yes | high | high |
| F25 2.5 flash v3 | k028 | 1 baked sweet potato, 150 g | 86 | 90.0 | -4% | yes | high | high |

## Five worst per cell, carbs

Ranked by percent error. For carbs a row within 1 g still passes (`within` yes), so a near-zero reference such as butter can top the list and pass.

| cell | row | typed input | model | USDA | error | within | model confidence | reference confidence |
|---|---|---|---|---|---|---|---|---|
| F25 2.5 flash v3 | k017 | 170 g nonfat Greek yogurt | 7 | 3.6 | +94% | no | high | high |
| F25 2.5 flash v3 | k023 | 10 g Butter | 0.1 | 0.06 | +67% | yes | high | high |
| F25 2.5 flash v3 | k016 | 30 g cheddar | 1.3 | 3.37 | -61% | no | high | high |
| F25 2.5 flash v3 | k030 | 125 g di mozzarella | 2 | 2.4 | -17% | yes | high | low |
| F25 2.5 flash v3 | k012 | 300 g Salzkartoffeln | 17.0 | 20.01 | -15% | no | high | high |

## Confidence calibration on the kcal rows

Items whose kcal per 100 g is more than 25 percent off USDA, and how many of them the model rated `high`. These are plain foods with stated grams, so `high` is the expected rating for most of them.

| cell | confidence of the 34 items | more than 25% off | rated high | share | which |
|---|---|---|---|---|---|
| F25 2.5 flash v3 | high: 34, medium: 0, low: 0 | 0 | 0 | n/a | none |

## Every row, kcal per 100 g

`off` marks a value outside plus or minus 15 percent. `split` marks a row the model gave as two or more items, combined as described above.

| row | typed input | USDA | F25 2.5 flash v3 |
|---|---|---|---|
| k001 | 150 g Banane | 89 | 89 (+0%) |
| k002 | 1 apple, 180 g | 52 | 52 (+0%) |
| k003 | 2 hart gekochte Eier, zusammen 110 g | 155 | 155 (+0%) |
| k004 | 200 g cooked white rice | 130 | 130 (+0%) |
| k005 | 180 g di pasta cotta | 158 | 160 (+1%) |
| k006 | 2 Scheiben Toastbrot, 50 g | 266 | 265 (-0%) |
| k007 | 2 slices of whole-wheat bread, 64 g | 252 | 240 (-5%) |
| k008 | 250 g Vollmilch 3,5 % | 61 | 64 (+5%) |
| k009 | 150 g roasted chicken breast, no skin | 165 | 165 (+0%) |
| k010 | 125 g Lachsfilet, Zuchtlachs, roh gewogen | 208 | 200 (-4%) |
| k011 | half an avocado, 100 g | 160 | 160 (+0%) |
| k012 | 300 g Salzkartoffeln | 86 | 77 (-10%) |
| k013 | 40 g rolled oats (dry) | 379 | 370 (-2%) |
| k014 | 30 g Mandeln | 579 | 579 (+0%) |
| k015 | 2 tbsp peanut butter, 32 g | 598 | 590 (-1%) |
| k016 | 30 g cheddar | 403 | 403 (+0%) |
| k017 | 170 g nonfat Greek yogurt | 59 | 60 (+2%) |
| k018 | Una naranja de 160 g | 47 | 47 (+0%) |
| k019 | 200 g Brokkoli, roh | 34 | 34 (+0%) |
| k020 | 100 g de carottes crues | 41 | 41 (+0%) |
| k021 | 200 g cooked lentils | 116 | 116 (+0%) |
| k022 | 150 g haşlanmış nohut | 164 | 164 (+0%) |
| k023 | 10 g Butter | 717 | 717 (+0%) |
| k024 | 15 g di olio d'oliva | 884 | 884 (+0%) |
| k025 | 20 g Honig | 304 | 304 (+0%) |
| k026 | 150 g strawberries | 32 | 32 (+0%) |
| k027 | 185 g cooked quinoa | 120 | 120 (+0%) |
| k028 | 1 baked sweet potato, 150 g | 90 | 86 (-4%) |
| k029 | 25 g Walnusskerne | 654 | 654 (+0%) |
| k030 | 125 g di mozzarella | 299 | 280 (-6%) |
| k031 | 20 g dark chocolate, 70 to 85 percent cocoa | 598 | 575 (-4%) |
| k032 | 2 Tomaten, 240 g | 18 | 18 (+0%) |
| k033 | a 330 ml can of cola | 42 | 42 (+0%) |
| k034 | 0,5 l Bier | 43 | 43 (+0%) |

## Brand and vague-food confidence on the typed runs

The kcal rows name no brand, so brand calibration comes from the typed gold runs: t017 Snickers, t028 Nutella, t057 Philadelphia, t061 Big Mac, t076 Starbucks, times the repeats. The prompt asks for LOW confidence on a named brand; gold expects `low` for t017, t061 and t076. Labels are repeat:case.

| cell | typed repeats | brand items | found | rated high (all) | rated high (the `expect low` ones) | brand field right | rated high, labels |
|---|---|---|---|---|---|---|---|
| F25 2.5 flash v3 | 3 | 15 | 15 | 15/15 | 9/9 | 15/15 | r1:t017, r1:t028, r1:t057, r1:t061, r1:t076, r2:t017, r2:t028, r2:t057, r2:t061, r2:t076, r3:t017, r3:t028, r3:t057, r3:t061, r3:t076 |

Vague foods (t034 'a bar', t035 'some cheese', t071 'some curry') should be `low`. The last three columns are the mix over every item of every typed answer.

| cell | vague foods rated low | not rated low | items | high | medium | low |
|---|---|---|---|---|---|---|
| F25 2.5 flash v3 | 4/9 | r1:t071 high, r2:t071 medium, r3:t035 medium, r3:t071 medium | 405 | 98% | 1% | 1% |

## What stands out

(not written yet)
