# EU switch: kcal and carbs per 100 g on the kcal gold set (2026-10-06)

Scored by `python3 -m harness.score_misc --kcal-run ...` from finished run files. No model was called. Each of the 34 rows of `gold/gold_kcal_text.jsonl` was sent as its own typed case through the app's real text request, so this replaces the nine-food proxy of `EU-MISC-SCORING-2026-10-06.md` section 8. The reference is USDA SR Legacy per 100 g (see `gold/GOLD-NOTES.md` section 5). Tolerance is plus or minus 15 percent; for carbs a value within 1 g also passes. USDA carbs include fibre, and the app asks for total carbs on an estimate, so they compare directly. Two rows are drinks typed in ml (k033 cola, k034 beer) and compare per 100 ml against per 100 g; k030 mozzarella has a low-confidence reference (US low-moisture mozzarella).

Runs (`worktree:directory` is a run in that sibling worktree): B 3.8 default reasoning, production prompt: eval-harness:kcal-eu-cell-38-newprompt; C 3.8 minimal, production prompt: eval-harness:kcal-eu-cell-38-minimal-newprompt; D 3.5 lite EU minimal, production prompt: eval-harness:kcal-eu-cell-35-eu-newprompt. 

## kcal per 100 g

| cell | scope | rows | within tolerance | median signed error | null value |
|---|---|---|---|---|---|
| B 3.8 default reasoning, production prompt | all 34 | 34 | 33/34 (97%) | 0.0% | 0 |
| B 3.8 default reasoning, production prompt | reference high only | 28 | 28/28 (100%) | 0.0% | 0 |
| B 3.8 default reasoning, production prompt | without the low reference | 33 | 33/33 (100%) | 0.0% | 0 |
| C 3.8 minimal, production prompt | all 34 | 34 | 32/34 (94%) | 0.0% | 0 |
| C 3.8 minimal, production prompt | reference high only | 28 | 27/28 (96%) | 0.0% | 0 |
| C 3.8 minimal, production prompt | without the low reference | 33 | 32/33 (97%) | 0.0% | 0 |
| D 3.5 lite EU minimal, production prompt | all 34 | 34 | 33/34 (97%) | 0.0% | 0 |
| D 3.5 lite EU minimal, production prompt | reference high only | 28 | 27/28 (96%) | 0.0% | 0 |
| D 3.5 lite EU minimal, production prompt | without the low reference | 33 | 32/33 (97%) | 0.0% | 0 |

## carbs per 100 g (total, fibre included)

| cell | scope | rows | within tolerance | median signed error | null value |
|---|---|---|---|---|---|
| B 3.8 default reasoning, production prompt | all 34 | 34 | 31/34 (91%) | -0.0% | 0 |
| B 3.8 default reasoning, production prompt | reference high only | 28 | 26/28 (93%) | -0.1% | 0 |
| B 3.8 default reasoning, production prompt | without the low reference | 33 | 31/33 (94%) | -0.0% | 0 |
| C 3.8 minimal, production prompt | all 34 | 34 | 27/34 (79%) | -0.1% | 0 |
| C 3.8 minimal, production prompt | reference high only | 28 | 22/28 (79%) | -0.1% | 0 |
| C 3.8 minimal, production prompt | without the low reference | 33 | 27/33 (82%) | -0.1% | 0 |
| D 3.5 lite EU minimal, production prompt | all 34 | 34 | 30/34 (88%) | -0.1% | 0 |
| D 3.5 lite EU minimal, production prompt | reference high only | 28 | 24/28 (86%) | -0.1% | 0 |
| D 3.5 lite EU minimal, production prompt | without the low reference | 33 | 29/33 (88%) | -0.1% | 0 |

## Five worst per cell, kcal

Ranked by percent error. For carbs a row within 1 g still passes (`within` yes), so a near-zero reference such as butter can top the list and pass.

| cell | row | typed input | model | USDA | error | within | model confidence | reference confidence |
|---|---|---|---|---|---|---|---|---|
| B 3.8 default reasoning, production prompt | k030 | 125 g di mozzarella | 250.0 | 299.0 | -16% | no | high | low |
| B 3.8 default reasoning, production prompt | k008 | 250 g Vollmilch 3,5 % | 64 | 61.0 | +5% | yes | high | medium |
| B 3.8 default reasoning, production prompt | k007 | 2 slices of whole-wheat bread, 64 g | 247 | 252.0 | -2% | yes | high | high |
| B 3.8 default reasoning, production prompt | k015 | 2 tbsp peanut butter, 32 g | 588.0 | 598.0 | -2% | yes | high | high |
| B 3.8 default reasoning, production prompt | k006 | 2 Scheiben Toastbrot, 50 g | 265.0 | 266.0 | -0% | yes | high | medium |
| C 3.8 minimal, production prompt | k012 | 300 g Salzkartoffeln | 72 | 86.0 | -16% | no | high | high |
| C 3.8 minimal, production prompt | k030 | 125 g di mozzarella | 253 | 299.0 | -15% | no | high | low |
| C 3.8 minimal, production prompt | k008 | 250 g Vollmilch 3,5 % | 64 | 61.0 | +5% | yes | high | medium |
| C 3.8 minimal, production prompt | k010 | 125 g Lachsfilet, Zuchtlachs, roh gewogen | 200 | 208.0 | -4% | yes | high | medium |
| C 3.8 minimal, production prompt | k014 | 30 g Mandeln | 590 | 579.0 | +2% | yes | high | high |
| D 3.5 lite EU minimal, production prompt | k005 | 180 g di pasta cotta | 131 | 158.0 | -17% | no | high | high |
| D 3.5 lite EU minimal, production prompt | k030 | 125 g di mozzarella | 280 | 299.0 | -6% | yes | high | low |
| D 3.5 lite EU minimal, production prompt | k008 | 250 g Vollmilch 3,5 % | 64 | 61.0 | +5% | yes | high | medium |
| D 3.5 lite EU minimal, production prompt | k012 | 300 g Salzkartoffeln | 82 | 86.0 | -5% | yes | high | high |
| D 3.5 lite EU minimal, production prompt | k010 | 125 g Lachsfilet, Zuchtlachs, roh gewogen | 200 | 208.0 | -4% | yes | high | medium |

## Five worst per cell, carbs

Ranked by percent error. For carbs a row within 1 g still passes (`within` yes), so a near-zero reference such as butter can top the list and pass.

| cell | row | typed input | model | USDA | error | within | model confidence | reference confidence |
|---|---|---|---|---|---|---|---|---|
| B 3.8 default reasoning, production prompt | k023 | 10 g Butter | 0.7 | 0.06 | +1067% | yes | high | high |
| B 3.8 default reasoning, production prompt | k016 | 30 g cheddar | 1.3 | 3.37 | -61% | no | high | high |
| B 3.8 default reasoning, production prompt | k030 | 125 g di mozzarella | 1.0 | 2.4 | -58% | no | high | low |
| B 3.8 default reasoning, production prompt | k029 | 25 g Walnusskerne | 7 | 13.71 | -49% | no | high | high |
| B 3.8 default reasoning, production prompt | k012 | 300 g Salzkartoffeln | 17.5 | 20.01 | -13% | yes | high | high |
| C 3.8 minimal, production prompt | k023 | 10 g Butter | 0.7 | 0.06 | +1067% | yes | high | high |
| C 3.8 minimal, production prompt | k014 | 30 g Mandeln | 5.4 | 21.55 | -75% | no | high | high |
| C 3.8 minimal, production prompt | k016 | 30 g cheddar | 1.3 | 3.37 | -61% | no | high | high |
| C 3.8 minimal, production prompt | k019 | 200 g Brokkoli, roh | 2.7 | 6.64 | -59% | no | high | high |
| C 3.8 minimal, production prompt | k030 | 125 g di mozzarella | 1.0 | 2.4 | -58% | no | high | low |
| D 3.5 lite EU minimal, production prompt | k023 | 10 g Butter | 0.1 | 0.06 | +67% | yes | high | high |
| D 3.5 lite EU minimal, production prompt | k016 | 30 g cheddar | 1.3 | 3.37 | -61% | no | high | high |
| D 3.5 lite EU minimal, production prompt | k019 | 200 g Brokkoli, roh | 2.7 | 6.64 | -59% | no | high | high |
| D 3.5 lite EU minimal, production prompt | k029 | 25 g Walnusskerne | 7.0 | 13.71 | -49% | no | high | high |
| D 3.5 lite EU minimal, production prompt | k005 | 180 g di pasta cotta | 25 | 30.86 | -19% | no | high | high |

## Confidence calibration on the kcal rows

Items whose kcal per 100 g is more than 25 percent off USDA, and how many of them the model rated `high`. These are plain foods with stated grams, so `high` is the expected rating for most of them.

| cell | confidence of the 34 items | more than 25% off | rated high | share | which |
|---|---|---|---|---|---|
| B 3.8 default reasoning, production prompt | high: 34, medium: 0, low: 0 | 0 | 0 | n/a | none |
| C 3.8 minimal, production prompt | high: 34, medium: 0, low: 0 | 0 | 0 | n/a | none |
| D 3.5 lite EU minimal, production prompt | high: 34, medium: 0, low: 0 | 0 | 0 | n/a | none |

## Every row, kcal per 100 g

`off` marks a value outside plus or minus 15 percent.

| row | typed input | USDA | B 3.8 default reasoning, production prompt | C 3.8 minimal, production prompt | D 3.5 lite EU minimal, production prompt |
|---|---|---|---|---|---|
| k001 | 150 g Banane | 89 | 89 (+0%) | 89 (+0%) | 89 (+0%) |
| k002 | 1 apple, 180 g | 52 | 52 (+0%) | 52 (+0%) | 52 (+0%) |
| k003 | 2 hart gekochte Eier, zusammen 110 g | 155 | 155 (+0%) | 155 (+0%) | 155 (+0%) |
| k004 | 200 g cooked white rice | 130 | 130 (+0%) | 130 (+0%) | 130 (+0%) |
| k005 | 180 g di pasta cotta | 158 | 158 (+0%) | 158 (+0%) | 131 (-17%, off) |
| k006 | 2 Scheiben Toastbrot, 50 g | 266 | 265 (-0%) | 265 (-0%) | 265 (-0%) |
| k007 | 2 slices of whole-wheat bread, 64 g | 252 | 247 (-2%) | 252 (+0%) | 247 (-2%) |
| k008 | 250 g Vollmilch 3,5 % | 61 | 64 (+5%) | 64 (+5%) | 64 (+5%) |
| k009 | 150 g roasted chicken breast, no skin | 165 | 165 (+0%) | 165 (+0%) | 165 (+0%) |
| k010 | 125 g Lachsfilet, Zuchtlachs, roh gewogen | 208 | 208 (+0%) | 200 (-4%) | 200 (-4%) |
| k011 | half an avocado, 100 g | 160 | 160 (+0%) | 160 (+0%) | 160 (+0%) |
| k012 | 300 g Salzkartoffeln | 86 | 86 (+0%) | 72 (-16%, off) | 82 (-5%) |
| k013 | 40 g rolled oats (dry) | 379 | 379 (+0%) | 379 (+0%) | 389 (+3%) |
| k014 | 30 g Mandeln | 579 | 579 (+0%) | 590 (+2%) | 579 (+0%) |
| k015 | 2 tbsp peanut butter, 32 g | 598 | 588 (-2%) | 597 (-0%) | 588 (-2%) |
| k016 | 30 g cheddar | 403 | 403 (+0%) | 403 (+0%) | 403 (+0%) |
| k017 | 170 g nonfat Greek yogurt | 59 | 59 (+0%) | 59 (+0%) | 59 (+0%) |
| k018 | Una naranja de 160 g | 47 | 47 (+0%) | 47 (+0%) | 47 (+0%) |
| k019 | 200 g Brokkoli, roh | 34 | 34 (+0%) | 34 (+0%) | 34 (+0%) |
| k020 | 100 g de carottes crues | 41 | 41 (+0%) | 41 (+0%) | 41 (+0%) |
| k021 | 200 g cooked lentils | 116 | 116 (+0%) | 116 (+0%) | 116 (+0%) |
| k022 | 150 g haşlanmış nohut | 164 | 164 (+0%) | 164 (+0%) | 164 (+0%) |
| k023 | 10 g Butter | 717 | 717 (+0%) | 717 (+0%) | 717 (+0%) |
| k024 | 15 g di olio d'oliva | 884 | 884 (+0%) | 884 (+0%) | 884 (+0%) |
| k025 | 20 g Honig | 304 | 304 (+0%) | 304 (+0%) | 304 (+0%) |
| k026 | 150 g strawberries | 32 | 32 (+0%) | 32 (+0%) | 32 (+0%) |
| k027 | 185 g cooked quinoa | 120 | 120 (+0%) | 120 (+0%) | 120 (+0%) |
| k028 | 1 baked sweet potato, 150 g | 90 | 90 (+0%) | 90 (+0%) | 90 (+0%) |
| k029 | 25 g Walnusskerne | 654 | 654 (+0%) | 654 (+0%) | 654 (+0%) |
| k030 | 125 g di mozzarella | 299 | 250 (-16%, off) | 253 (-15%, off) | 280 (-6%) |
| k031 | 20 g dark chocolate, 70 to 85 percent cocoa | 598 | 598 (+0%) | 598 (+0%) | 598 (+0%) |
| k032 | 2 Tomaten, 240 g | 18 | 18 (+0%) | 18 (+0%) | 18 (+0%) |
| k033 | a 330 ml can of cola | 42 | 42 (+0%) | 42 (+0%) | 42 (+0%) |
| k034 | 0,5 l Bier | 43 | 43 (+0%) | 43 (+0%) | 43 (+0%) |

## Brand and vague-food confidence on the typed runs

The kcal rows name no brand, so brand calibration comes from the typed gold runs: t017 Snickers, t028 Nutella, t057 Philadelphia, t061 Big Mac, t076 Starbucks, times the repeats. The prompt asks for LOW confidence on a named brand; gold expects `low` for t017, t061 and t076. Labels are repeat:case.

| cell | typed repeats | brand items | found | rated high (all) | rated high (the `expect low` ones) | brand field right | rated high, labels |
|---|---|---|---|---|---|---|---|
| B 3.8 default reasoning, production prompt | 3 | 15 | 15 | 2/15 | 2/9 | 13/15 | r1:t061, r2:t061 |
| C 3.8 minimal, production prompt | 3 | 15 | 15 | 3/15 | 3/9 | 15/15 | r1:t061, r2:t061, r3:t061 |
| D 3.5 lite EU minimal, production prompt | 3 | 15 | 15 | 15/15 | 9/9 | 14/15 | r1:t017, r1:t028, r1:t057, r1:t061, r1:t076, r2:t017, r2:t028, r2:t057, r2:t061, r2:t076, r3:t017, r3:t028, r3:t057, r3:t061, r3:t076 |
| C3 3.8 minimal, v3 prompt | 3 | 15 | 15 | 3/15 | 3/9 | 15/15 | r1:t061, r2:t061, r3:t061 |
| D3 3.5 lite EU minimal, v3 prompt | 3 | 15 | 15 | 15/15 | 9/9 | 14/15 | r1:t017, r1:t028, r1:t057, r1:t061, r1:t076, r2:t017, r2:t028, r2:t057, r2:t061, r2:t076, r3:t017, r3:t028, r3:t057, r3:t061, r3:t076 |

Vague foods (t034 'a bar', t035 'some cheese', t071 'some curry') should be `low`. The last three columns are the mix over every item of every typed answer.

| cell | vague foods rated low | not rated low | items | high | medium | low |
|---|---|---|---|---|---|---|
| B 3.8 default reasoning, production prompt | 9/9 | none | 360 | 88% | 6% | 6% |
| C 3.8 minimal, production prompt | 9/9 | none | 362 | 91% | 3% | 6% |
| D 3.5 lite EU minimal, production prompt | 9/9 | none | 377 | 95% | 3% | 2% |
| C3 3.8 minimal, v3 prompt | 9/9 | none | 357 | 93% | 1% | 6% |
| D3 3.5 lite EU minimal, v3 prompt | 9/9 | none | 372 | 95% | 2% | 2% |

## What stands out

- **These kcal runs used the production prompt.** No kcal run exists for the v3 prompt (C3, D3), so this table says
  nothing about v3. Only the brand and vague-food table at the end holds v3 cells.
- **kcal is near exact for all three cells.** Within plus or minus 15 percent: B 33 of 34, C 32 of 34, D 33 of 34.
  The median signed error is 0.0 percent in every cell, because most answers repeat the USDA figure exactly (B 29,
  C 27, D 25 of 34). The misses are small: k030 mozzarella (B -16, C -15 percent, a low-confidence US reference),
  k012 boiled potatoes (C -16 percent), k005 cooked pasta (D -17 percent).
- **Carbs miss where the model gives net carbs.** Within tolerance: B 31, C 27, D 30 of 34. k029 walnuts at 7.0 g
  is USDA total 13.71 g minus 6.7 g fibre; k014 almonds (C 5.4 g) and k019 raw broccoli (C and D 2.7 g) are below
  even the net figure. k016 cheddar at 1.3 g misses in every cell against the SR Legacy 3.37 g. European food tables
  list well under 1 g for cheddar, so that row may be a reference problem, not a model error (not checked here).
- **Confidence calibration on kcal cannot fail here.** Every item of every cell is rated `high`, and no kcal value
  is more than 25 percent off, so there is no wrong `high` to count.
- **Brand confidence: 3.5 lite rates every brand `high`, the v3 prompt does not change that.** D and D3 rate all 15
  brand items `high` (9 of 9 where gold expects `low`). B, C and C3 rate only t061 Big Mac `high` (2 or 3 of 15).
  Every cell rates the three vague foods `low` in every repeat.
