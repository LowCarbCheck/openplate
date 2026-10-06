# EU switch, non-recall metrics: cost, validity, kcal, pantry and recipes (2026-10-06)

Scored from the finished run files by `harness/score_misc.py`. No model was called. Cells: A and E are the OLD-schema plate runs (cost and latency only), B is 3.8 with default reasoning, C is 3.8 minimal, D is 3.5 flash lite on the EU host, minimal. Typed text pools the repeats listed below. Cost for A and E is the harness price-table estimate, for B, C and D it is `usage.cost` from OpenRouter.

Typed repeats included: B 3.8 default reasoning: r1, r2, r3 (273 calls); C 3.8 minimal: r1, r2, r3 (273 calls); D 3.5 lite EU minimal: r1, r2, r3 (273 calls). 

## 1. HTTP status

| family | cell | calls | HTTP status counts | retried calls | finish_reason not stop |
|---|---|---|---|---|---|
| plates (50) | A 3.8 old prompt | 50 | n/a (old approach) | 0 | 0 |
| plates (50) | B 3.8 default reasoning | 50 | 200: 50 | 0 | 0 |
| plates (50) | C 3.8 minimal | 50 | 200: 50 | 0 | 0 |
| plates (50) | D 3.5 lite EU minimal | 50 | 200: 50 | 0 | 0 |
| plates (50) | E 3.5 lite EU old prompt | 50 | n/a (old approach) | 0 | 0 |
| typed text | B 3.8 default reasoning | 273 | 200: 273 | 0 | length: 3 (r1:t040, r2:t040, r3:t044) |
| typed text | C 3.8 minimal | 273 | 200: 273 | 0 | 0 |
| typed text | D 3.5 lite EU minimal | 273 | 200: 273 | 0 | error: 2 (r3:t072, r3:t079) |
| pantry (10) | B 3.8 default reasoning | 10 | 200: 10 | 0 | length: 1 (p010) |
| pantry (10) | C 3.8 minimal | 10 | 200: 10 | 0 | 0 |
| pantry (10) | D 3.5 lite EU minimal | 10 | 200: 10 | 0 | 0 |
| recipes (10) | B 3.8 default reasoning | 10 | 200: 10 | 0 | 0 |
| recipes (10) | C 3.8 minimal | 10 | 200: 10 | 0 | 0 |
| recipes (10) | D 3.5 lite EU minimal | 10 | 200: 10 | 0 | 0 |

## 2. Schema validity

`stored` is the `schema_valid` the run wrote. The disagreement column counts calls where a fresh strict parse of `raw_content` against `generated/vision-contract.json` (`harness.schema_validate`) gives a different answer. A and E hold no `schema_valid` (old schema), their count is `raw_ok`.

| family | cell | calls | stored valid | re-validation disagreements | invalid ids |
|---|---|---|---|---|---|
| plates (50) | A 3.8 old prompt | 50 | 50/50 raw_ok | n/a | none |
| plates (50) | B 3.8 default reasoning | 50 | 50/50 | 0 | none |
| plates (50) | C 3.8 minimal | 50 | 50/50 | 0 | none |
| plates (50) | D 3.5 lite EU minimal | 50 | 50/50 | 0 | none |
| plates (50) | E 3.5 lite EU old prompt | 50 | 50/50 raw_ok | n/a | none |
| typed text | B 3.8 default reasoning | 273 | 270/273 | 0 | r1:t040, r2:t040, r3:t044 |
| typed text | C 3.8 minimal | 273 | 273/273 | 0 | none |
| typed text | D 3.5 lite EU minimal | 273 | 271/273 | 0 | r3:t072, r3:t079 |
| pantry (10) | B 3.8 default reasoning | 10 | 9/10 | 0 | p010 |
| pantry (10) | C 3.8 minimal | 10 | 10/10 | 0 | none |
| pantry (10) | D 3.5 lite EU minimal | 10 | 10/10 | 0 | none |
| recipes (10) | B 3.8 default reasoning | 10 | 10/10 | 0 | none |
| recipes (10) | C 3.8 minimal | 10 | 10/10 | 0 | none |
| recipes (10) | D 3.5 lite EU minimal | 10 | 9/10 | 0 | r007 |

## 3. Empty or `unreadable` answers on food inputs

Typed cases t033 and t070 name no food, so an empty list is right there; the last column scores them. Labels are repeat:case. 'No parsed answer' lists calls with no valid JSON (nothing to judge).

| family | cell | empty `foods` | `unreadable` true | no parsed answer | no-food cases |
|---|---|---|---|---|---|
| plates (50) | A 3.8 old prompt | none | none | none | n/a |
| plates (50) | B 3.8 default reasoning | none | none | none | n/a |
| plates (50) | C 3.8 minimal | none | none | none | n/a |
| plates (50) | D 3.5 lite EU minimal | none | none | none | n/a |
| plates (50) | E 3.5 lite EU old prompt | none | none | none | n/a |
| typed text | B 3.8 default reasoning | none | none | r1:t040, r2:t040, r3:t044 | 6/6 kept empty |
| typed text | C 3.8 minimal | none | none | none | 6/6 kept empty |
| typed text | D 3.5 lite EU minimal | none | none | r3:t072, r3:t079 | 6/6 kept empty |

## 4. Cost

| family | cell | calls | total cost | mean per call |
|---|---|---|---|---|
| plates (50) | A 3.8 old prompt | 50 | $0.3261 | $0.00652 |
| plates (50) | B 3.8 default reasoning | 50 | $0.5968 | $0.01194 |
| plates (50) | C 3.8 minimal | 50 | $0.3577 | $0.00715 |
| plates (50) | D 3.5 lite EU minimal | 50 | $0.1864 | $0.00373 |
| plates (50) | E 3.5 lite EU old prompt | 50 | $0.0973 | $0.00195 |
| typed text | B 3.8 default reasoning | 273 | $1.9309 | $0.00707 |
| typed text | C 3.8 minimal | 273 | $1.1193 | $0.00410 |
| typed text | D 3.5 lite EU minimal | 273 | $0.6097 | $0.00223 |
| pantry (10) | B 3.8 default reasoning | 10 | $0.0642 | $0.00642 |
| pantry (10) | C 3.8 minimal | 10 | $0.0170 | $0.00170 |
| pantry (10) | D 3.5 lite EU minimal | 10 | $0.0135 | $0.00135 |
| recipes (10) | B 3.8 default reasoning | 10 | $0.1440 | $0.01440 |
| recipes (10) | C 3.8 minimal | 10 | $0.0545 | $0.00545 |
| recipes (10) | D 3.5 lite EU minimal | 10 | $0.0334 | $0.00334 |

## 5. Latency (seconds, wall clock from bluefin)

| family | cell | median | p95 | max | calls above 60 s |
|---|---|---|---|---|---|
| plates (50) | A 3.8 old prompt | 12.2 | 24.8 | 56.1 | none |
| plates (50) | B 3.8 default reasoning | 18.0 | 29.6 | 80.4 | plate 23 (80.4 s) |
| plates (50) | C 3.8 minimal | 9.0 | 34.2 | 192.3 | plate 07 (141.3 s), plate 34 (192.3 s) |
| plates (50) | D 3.5 lite EU minimal | 3.6 | 6.6 | 9.0 | none |
| plates (50) | E 3.5 lite EU old prompt | 3.1 | 4.6 | 6.3 | none |
| typed text | B 3.8 default reasoning | 9.1 | 36.9 | 306.2 | r1:t038 (178.5 s), r1:t040 (61.1 s), r1:t048 (81.4 s), r1:t082 (80.5 s), r2:t085 (306.2 s), r3:t018 (77.2 s), r3:t073 (179.4 s) |
| typed text | C 3.8 minimal | 4.5 | 24.3 | 117.6 | r1:t007 (106.4 s), r1:t034 (81.5 s), r1:t065 (69.3 s), r2:t007 (65.0 s), r2:t070 (89.3 s), r3:t033 (117.6 s), r3:t074 (93.2 s) |
| typed text | D 3.5 lite EU minimal | 2.0 | 3.0 | 7.1 | none |
| pantry (10) | B 3.8 default reasoning | 6.5 | 37.9 | 54.3 | none |
| pantry (10) | C 3.8 minimal | 3.6 | 4.5 | 4.8 | none |
| pantry (10) | D 3.5 lite EU minimal | 1.8 | 2.3 | 2.5 | none |
| recipes (10) | B 3.8 default reasoning | 30.0 | 90.6 | 138.9 | r009 (138.9 s) |
| recipes (10) | C 3.8 minimal | 8.2 | 27.1 | 41.7 | none |
| recipes (10) | D 3.5 lite EU minimal | 3.4 | 3.7 | 3.8 | none |

## 6. Tokens per call (means)

Reasoning tokens are the mean over the calls that recorded the field (old-schema A and E record none).

| family | cell | prompt | completion | reasoning |
|---|---|---|---|---|
| plates (50) | A 3.8 old prompt | 2168 | 1306 | not recorded |
| plates (50) | B 3.8 default reasoning | 5132 | 2157 | 1083 |
| plates (50) | C 3.8 minimal | 5132 | 881 | 0 |
| plates (50) | D 3.5 lite EU minimal | 5132 | 817 | 0 |
| plates (50) | E 3.5 lite EU old prompt | 2172 | 447 | not recorded |
| typed text | B 3.8 default reasoning | 3341 | 1218 | 838 |
| typed text | C 3.8 minimal | 3341 | 425 | 5 |
| typed text | D 3.5 lite EU minimal | 3317 | 414 | 0 |
| pantry (10) | B 3.8 default reasoning | 1387 | 1434 | 1234 |
| pantry (10) | C 3.8 minimal | 1387 | 176 | 0 |
| pantry (10) | D 3.5 lite EU minimal | 1387 | 324 | 0 |
| recipes (10) | B 3.8 default reasoning | 2010 | 3438 | 1905 |
| recipes (10) | C 3.8 minimal | 2010 | 1052 | 0 |
| recipes (10) | D 3.5 lite EU minimal | 2010 | 974 | 0 |

## 7. Provider returned

| family | cell | provider (calls) | model returned (calls) |
|---|---|---|---|
| plates (50) | A 3.8 old prompt | not recorded | google/gemini-3.8-flash: 50 |
| plates (50) | B 3.8 default reasoning | Google: 50 | google/gemini-3.8-flash: 50 |
| plates (50) | C 3.8 minimal | Google: 50 | google/gemini-3.8-flash: 50 |
| plates (50) | D 3.5 lite EU minimal | Google: 50 | google/gemini-3.5-flash-lite: 50 |
| plates (50) | E 3.5 lite EU old prompt | not recorded | google/gemini-3.5-flash-lite: 50 |
| typed text | B 3.8 default reasoning | Google: 273 | google/gemini-3.8-flash: 273 |
| typed text | C 3.8 minimal | Google: 273 | google/gemini-3.8-flash: 273 |
| typed text | D 3.5 lite EU minimal | Google: 273 | google/gemini-3.5-flash-lite: 273 |
| pantry (10) | B 3.8 default reasoning | Google: 10 | google/gemini-3.8-flash: 10 |
| pantry (10) | C 3.8 minimal | Google: 10 | google/gemini-3.8-flash: 10 |
| pantry (10) | D 3.5 lite EU minimal | Google: 10 | google/gemini-3.5-flash-lite: 10 |
| recipes (10) | B 3.8 default reasoning | Google: 10 | google/gemini-3.8-flash: 10 |
| recipes (10) | C 3.8 minimal | Google: 10 | google/gemini-3.8-flash: 10 |
| recipes (10) | D 3.5 lite EU minimal | Google: 10 | google/gemini-3.5-flash-lite: 10 |

## 8. kcal and carbs per 100 g against USDA

**Superseded (2026-10-06):** the 34 kcal rows have since been sent once per cell (B, C, D, production prompt). The real numbers are in `EU-KCAL-SCORING-2026-10-06.md`: kcal within plus or minus 15 percent on 33, 32 and 33 of 34 rows, carbs on 31, 27 and 30. The proxy below is kept as it was.

**The 34 rows of `gold_kcal_text.jsonl` were never sent to a model, so no run holds an answer for them.** `harness.production.load_cases` reads that file as a text case file, so scoring them takes 34 calls per cell. This section is a proxy: it uses the 10 places where a typed gold case names the same food as a kcal row (t013, t015, t017, t028, t031, t056, t058, t069, t085), once per repeat. It compares per 100 g, so stated grams cancel out. Tolerance is plus or minus 15 percent; for carbs a value within 1 g also passes, because a reference near zero has no useful percent. The USDA carbs figure includes fibre and the app asks for total carbs on estimates, so they compare directly. Looser mappings: pasteurised whole milk against 3.25 percent US milk (k008, medium); Weissbrot against US white sandwich bread (k006, medium); cola, per 100 ml against per 100 g (k033, medium); a small beer, per 100 ml against per 100 g (k034, medium); mozzarella reference is low-moisture US mozzarella (k030, low confidence).

### kcal per 100 g

| cell | scope | comparisons | item found | within tolerance | median signed error | null value |
|---|---|---|---|---|---|---|
| B 3.8 default reasoning | all references | 30 | 30 | 29/30 (97%) | 0.0% | 0 |
| B 3.8 default reasoning | reference confidence low | 3 | 3 | 2/3 (67%) | -6.4% | 0 |
| B 3.8 default reasoning | high and medium only | 27 | 27 | 27/27 (100%) | 0.0% | 0 |
| C 3.8 minimal | all references | 30 | 30 | 29/30 (97%) | 0.0% | 0 |
| C 3.8 minimal | reference confidence low | 3 | 3 | 2/3 (67%) | -13.0% | 0 |
| C 3.8 minimal | high and medium only | 27 | 27 | 27/27 (100%) | 0.0% | 0 |
| D 3.5 lite EU minimal | all references | 30 | 30 | 30/30 (100%) | 0.0% | 0 |
| D 3.5 lite EU minimal | reference confidence low | 3 | 3 | 3/3 (100%) | -6.4% | 0 |
| D 3.5 lite EU minimal | high and medium only | 27 | 27 | 27/27 (100%) | 0.0% | 0 |

### carbs per 100 g

| cell | scope | comparisons | item found | within tolerance | median signed error | null value |
|---|---|---|---|---|---|---|
| B 3.8 default reasoning | all references | 30 | 30 | 25/30 (83%) | 0.0% | 0 |
| B 3.8 default reasoning | reference confidence low | 3 | 3 | 3/3 (100%) | -37.5% | 0 |
| B 3.8 default reasoning | high and medium only | 27 | 27 | 22/27 (81%) | 0.0% | 0 |
| C 3.8 minimal | all references | 30 | 30 | 25/30 (83%) | -0.6% | 0 |
| C 3.8 minimal | reference confidence low | 3 | 3 | 3/3 (100%) | -37.5% | 0 |
| C 3.8 minimal | high and medium only | 27 | 27 | 22/27 (81%) | 0.0% | 0 |
| D 3.5 lite EU minimal | all references | 30 | 30 | 27/30 (90%) | -0.6% | 0 |
| D 3.5 lite EU minimal | reference confidence low | 3 | 3 | 3/3 (100%) | -8.3% | 0 |
| D 3.5 lite EU minimal | high and medium only | 27 | 27 | 24/27 (89%) | -0.6% | 0 |

### Five worst per cell, kcal

| cell | repeat:case | row and item | model | reference | error | model confidence | reference confidence |
|---|---|---|---|---|---|---|---|
| B 3.8 default reasoning | r2:t031 | k030 Mozzarella | 253 | 299.0 | -15% | high | low |
| B 3.8 default reasoning | r1:t031 | k030 Mozzarella | 280 | 299.0 | -6% | high | low |
| B 3.8 default reasoning | r3:t031 | k030 Mozzarella | 280 | 299.0 | -6% | high | low |
| B 3.8 default reasoning | r3:t028 | k006 Weißbrot | 250 | 266.0 | -6% | high | medium |
| B 3.8 default reasoning | r1:t058 | k008 Whole milk | 63 | 61.0 | +3% | high | medium |
| C 3.8 minimal | r2:t031 | k030 Mozzarella | 250 | 299.0 | -16% | high | low |
| C 3.8 minimal | r1:t031 | k030 Mozzarella | 260 | 299.0 | -13% | high | low |
| C 3.8 minimal | r3:t031 | k030 Mozzarella | 260 | 299.0 | -13% | high | low |
| C 3.8 minimal | r1:t058 | k008 whole milk | 65.0 | 61.0 | +7% | high | medium |
| C 3.8 minimal | r2:t028 | k006 Weißbrot | 250 | 266.0 | -6% | high | medium |
| D 3.5 lite EU minimal | r1:t031 | k030 Mozzarella | 280 | 299.0 | -6% | high | low |
| D 3.5 lite EU minimal | r2:t031 | k030 Mozzarella | 280 | 299.0 | -6% | high | low |
| D 3.5 lite EU minimal | r3:t031 | k030 Mozzarella | 280 | 299.0 | -6% | high | low |
| D 3.5 lite EU minimal | r1:t028 | k006 Weißbrot | 265.0 | 266.0 | -0% | high | medium |
| D 3.5 lite EU minimal | r2:t028 | k006 Weißbrot | 265.0 | 266.0 | -0% | high | medium |

### Five worst per cell, carbs

| cell | repeat:case | row and item | model | reference | error | model confidence | reference confidence |
|---|---|---|---|---|---|---|---|
| B 3.8 default reasoning | r1:t056 | k016 Mature cheddar cheese | 0.1 | 3.37 | -97% | high | high |
| B 3.8 default reasoning | r2:t056 | k016 Mature cheddar cheese | 0.1 | 3.37 | -97% | high | high |
| B 3.8 default reasoning | r3:t056 | k016 Mature cheddar cheese | 0.1 | 3.37 | -97% | high | high |
| B 3.8 default reasoning | r1:t031 | k030 Mozzarella | 1.5 | 2.4 | -38% | high | low |
| B 3.8 default reasoning | r2:t031 | k030 Mozzarella | 1.5 | 2.4 | -38% | high | low |
| C 3.8 minimal | r1:t056 | k016 Mature cheddar cheese | 0.1 | 3.37 | -97% | high | high |
| C 3.8 minimal | r2:t056 | k016 mature cheddar cheese | 0.1 | 3.37 | -97% | high | high |
| C 3.8 minimal | r3:t056 | k016 mature cheddar cheese | 0.1 | 3.37 | -97% | high | high |
| C 3.8 minimal | r3:t013 | k003 Hartgekochtes Ei | 0.6 | 1.12 | -46% | high | high |
| C 3.8 minimal | r1:t031 | k030 Mozzarella | 1.5 | 2.4 | -38% | high | low |
| D 3.5 lite EU minimal | r1:t056 | k016 mature cheddar cheese | 0.1 | 3.37 | -97% | high | high |
| D 3.5 lite EU minimal | r2:t056 | k016 mature cheddar cheese | 0.1 | 3.37 | -97% | high | high |
| D 3.5 lite EU minimal | r3:t056 | k016 mature cheddar | 0.1 | 3.37 | -97% | high | high |
| D 3.5 lite EU minimal | r2:t013 | k003 gekochtes Ei | 0.6 | 1.12 | -46% | high | high |
| D 3.5 lite EU minimal | r3:t013 | k003 gekochtes Ei | 0.6 | 1.12 | -46% | high | high |

## 9. Brand behaviour on the typed gold

Brand cases: t017 Snickers, t028 Nutella, t057 Philadelphia, t061 Big Mac, t076 Starbucks (the five with `expect_brand`), times the repeats. The prompt asks for LOW confidence on a named brand and gold expects `low` for t017, t061 and t076, so 'rated high' is the wrong direction. Nutella and Philadelphia expect a brand only.

| cell | brand items | found | rated high (all brand items) | rated high (the `expect low` ones) | brand field right | rated high, labels |
|---|---|---|---|---|---|---|
| B 3.8 default reasoning | 15 | 15 | 2/15 | 2/9 | 13/15 | r1:t061, r2:t061 |
| C 3.8 minimal | 15 | 15 | 3/15 | 3/9 | 15/15 | r1:t061, r2:t061, r3:t061 |
| D 3.5 lite EU minimal | 15 | 15 | 15/15 | 9/9 | 14/15 | r1:t017, r1:t028, r1:t057, r1:t061, r1:t076, r2:t017, r2:t028, r2:t057, r2:t061, r2:t076, r3:t017, r3:t028, r3:t057, r3:t061, r3:t076 |

### Vague foods and the overall confidence mix

Gold expects `low` on the vague typed foods t034 'a bar', t035 'some cheese' and t071 'some curry'. The last three columns are the mix over every item of every typed answer.

| cell | vague foods rated low | not rated low | items | high | medium | low |
|---|---|---|---|---|---|---|
| B 3.8 default reasoning | 9/9 | none | 360 | 88% | 6% | 6% |
| C 3.8 minimal | 9/9 | none | 362 | 91% | 3% | 6% |
| D 3.5 lite EU minimal | 9/9 | none | 377 | 95% | 3% | 2% |

## 10. Confidence calibration

Items whose kcal per 100 g is more than 25 percent off the USDA reference, on the same overlap as section 8, and the share of them rated `high`. The count is small, so read it as a direction.

| cell | items more than 25% off | rated high | share | which |
|---|---|---|---|---|
| B 3.8 default reasoning | 0 | 0 | n/a | none |
| C 3.8 minimal | 0 | 0 | n/a | none |
| D 3.5 lite EU minimal | 0 | 0 | n/a | none |

## 11. Pantry gold

A case passes when every expected item is present with its amount and unit (or an accepted alternative), amounts are null where the text gives none, `low` confidence is set where gold requires it, no forbidden item appears, and categories and units are in the enum. Items are matched by name against `translations.en` with a fuzzy token match. Extras (items beyond the gold) are counted, never failed. The kind columns count failures, so one case can add to several.

| cell | cases passed | failed cases | missing_item | wrong_amount_unit | amount_not_null | low_confidence_missing | forbidden_item | not_empty | bad_category | bad_unit | no_answer | extra items |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B 3.8 default reasoning | 9/10 | p010 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| C 3.8 minimal | 10/10 | none | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| D 3.5 lite EU minimal | 9/10 | p009 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Every pantry failure:

| cell | case | kind | detail |
|---|---|---|---|
| B 3.8 default reasoning | p010 | no_answer | no parsed answer |
| D 3.5 lite EU minimal | p009 | wrong_amount_unit | chickpeas: got (None, None), want [(2, 'pack'), (2, 'piece')] |

## 12. Recipe gold constraints

Per call: recipes returned and recipes shown (the app drops a recipe whose `servingGrams` is outside 30 to 1500). Violations are counted per recipe or ingredient. `fromPantry` honesty: true must match a shelf item by name (fuzzy token match); false must be a staple in the language of the case, and a false ingredient that matches the shelf is counted as `from_pantry_false_on_shelf`. `per_serving_inconsistent` is kcal more than 20 percent away from 4 x net carbs + 4 x protein + 9 x fat. Budgets use the model's own `perServing`. Not checked: answer language, one-sentence `whyItFits`, distinct ideas. A call with no parsed answer shows 0 recipes.

| cell | calls | recipes per call | shown per call | calls with no violation | violations | no_answer | recipe_count | serving_grams | amount_unit_not_null_together | from_pantry_true_not_on_shelf | from_pantry_false_on_shelf | from_pantry_false_not_staple | exceeds_pantry_amount | over_kcal_budget | over_carb_budget | per_serving_inconsistent |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B 3.8 default reasoning | 10 | 3.0 | 3.0 | 10/10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| C 3.8 minimal | 10 | 2.1 | 2.1 | 9/10 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| D 3.5 lite EU minimal | 10 | 1.8 | 1.8 | 8/10 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |

Every recipe violation:

| cell | case | kind | detail |
|---|---|---|---|
| C 3.8 minimal | r003 | over_carb_budget | Creamy Peanut Butter and Banana Oatmeal: 70 > 69 |
| D 3.5 lite EU minimal | r003 | over_carb_budget | Banana Peanut Butter Oatmeal: 70 > 69 |
| D 3.5 lite EU minimal | r003 | over_carb_budget | Berry Peanut Butter Smoothie: 75 > 69 |
| D 3.5 lite EU minimal | r007 | no_answer | no parsed answer |

## What stands out

Read these with the sample sizes in mind: 10 pantry cases, 10 recipe cases, and 9 distinct typed foods behind every kcal figure and 5 distinct brand cases (the three repeats re-ask the same cases, so they are not independent).

1. **D is not schema-clean, and rule 1 asks for zero.** D has 3 invalid calls of 343 (typed r3:t072 and r3:t079, recipe r007). The two typed calls ended with `finish_reason: error` after about 1.4 s with 0 completion tokens and cut-off JSON, so they look like a provider fault. The recipe call is a real model fault: it wrote the unit `pack` in an ingredient, and the recipe enum has no `pack`. C has 0 invalid calls of 343. B has 4 invalid calls of 343 (typed t040 twice and t044, pantry p010). All four of those hit the 8192 token ceiling while reasoning (p010 used 7861 reasoning tokens in 54 s), so B fails for a different cause than D.
2. **D rates named brands as `high`, B and C do not.** Gold expects `low` on Snickers, Big Mac and Starbucks. D rated all 9 of those `high` and all 15 brand items `high`. B rated 2 of 9 `high` and C 3 of 9, always the Big Mac. D does rate the three vague foods (a bar, some cheese, some curry) `low` 9 of 9 times, as B and C do, so D follows the vagueness rule and skips the brand rule. D also left `brand` empty once (Snickers, r1). Overall D rates 95 percent of typed items `high`, C 91, B 88.
3. **kcal and carbs per 100 g: no difference beyond noise.** Within 15 percent: D 30/30, B 29/30, C 29/30. The only misses are mozzarella, whose USDA row is low confidence. Carbs within tolerance: D 27/30, B and C 25/30. All three cells make the same error on cheddar carbs (0.1 g against 3.37 g), which points at the reference more than at the models. The calibration question (wrong items rated `high`) cannot be answered: no matched item is more than 25 percent off, in any cell.
4. **The 34-row kcal set was never run.** Sections 8 and 10 use 9 foods that also appear in the typed cases. Running the real set takes 34 calls per cell, about $0.5 for the three cells at the typed-call prices above.
5. **Pantry: one failure each for B and D, none for C, and nothing to conclude at n = 10.** B p010 is the truncated call from point 1. D p009 gave "2 tins of chickpeas" no amount (null), where gold wants 2 pack or 2 piece. D did not invent amounts anywhere (peanut butter null is accepted).
6. **Recipes: B shows 3 per call, C 2.1, D 1.8.** D's mean falls to 2.0 on its 9 valid calls, so the D against C gap is the invalid r007 call, not a habit of showing fewer. B's 3 against the others' 2 is a reasoning effect. Every parsed recipe passes the checks on serving weight, `fromPantry` honesty, pantry amounts and kcal against macros, in every cell. The only violations are carb budget overruns on r003 (limit 69 g): C once (70), D twice (70 and 75). The 70 g cases are rounding, the 75 g smoothie is a real overrun. The trap cases (r006 two eggs, r008 bulgur, r009 saffron and stock) passed in all cells.
7. **Cost and latency favour D clearly, and that is not noise.** Typed calls cost $0.0022 for D, $0.0041 for C and $0.0071 for B. Median typed latency is 2.0 s for D, 4.5 s for C, 9.1 s for B. D has no call above 60 s in any family. C has 2 plate and 7 typed calls above 60 s (max 192 s), and B has 1 plate, 7 typed and 1 recipe call above 60 s (max 306 s).
8. **Plates: no false `unreadable`, no empty answer in any cell.** The typed no-food cases (t033, t070) stayed empty in every call of every cell. Re-validation agrees with the stored `schema_valid` on every call (0 disagreements).
