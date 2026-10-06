# EU switch: safety flags of the v3 prompt cells against the production prompt (2026-10-06)

Written by `python3 -m harness.score_flags --config configs/score-flags-v3.json`. No model call. The gold is
`gold/gold_text.jsonl` and `gold/gold_plate_flags.json`, read as `gold/GOLD-NOTES.md` section 2 says. The
machine readable twin of this file holds every entry, every holder and every flag.

The candidate is D3: 3.5 flash lite on the EU host, reasoning minimal, with the v3 prompt (commit a5e7690f, the
prompts list the foods behind each pregnancy category; `prompt.ts` blob cc374d3e). Rules 2 to 4 judge D3 against
two 3.8 readings: B (3.8 default reasoning, production prompt, blob ab221491) and C3 (3.8 minimal, v3 prompt). D and
C (production prompt) are restated from `EU-FLAG-SCORING-2026-10-06.md`. The plate-only cells B2, C2 and D2 used
the v2 photo prompt (blob 56cf88f3: every separate food its own item, same flag words as production). The typed
prompt of v2 is the production one, so typed D against D3 isolates the v3 flag words, and plates D2 against D3 do
the same for photos. Runs named `worktree:directory` live in that sibling worktree.

Legend for a model item: `P[...]` pregnancy, `A[...]` allergens, `M[...]` mayContain.

## Runs

| cell | label | typed repeats scored | plate run |
|---|---|---|---|
| B | 3.8, default reasoning, production prompt | eval-harness:text-eu-cell-38-newprompt-r1, eval-harness:text-eu-cell-38-newprompt-r2, eval-harness:text-eu-cell-38-newprompt-r3 | eval-harness:eu-cell-38-newprompt |
| C | 3.8, reasoning minimal, production prompt | eval-harness:text-eu-cell-38-minimal-newprompt-r1, eval-harness:text-eu-cell-38-minimal-newprompt-r2, eval-harness:text-eu-cell-38-minimal-newprompt-r3 | eval-harness:eu-cell-38-minimal-newprompt |
| D | 3.5 flash lite EU, minimal, production prompt | eval-harness:text-eu-cell-35-eu-newprompt-r1, eval-harness:text-eu-cell-35-eu-newprompt-r2, eval-harness:text-eu-cell-35-eu-newprompt-r3 | eval-harness:eu-cell-35-eu-newprompt |
| C3 | 3.8, reasoning minimal, v3 prompt | v3-text-eu-cell-38-minimal-newprompt-r1, v3-text-eu-cell-38-minimal-newprompt-r2, v3-text-eu-cell-38-minimal-newprompt-r3 | v3-eu-cell-38-minimal-newprompt, v3-eu-cell-38-minimal-newprompt-r2 |
| D3 | 3.5 flash lite EU, minimal, v3 prompt | v3-text-eu-cell-35-eu-newprompt-r1, v3-text-eu-cell-35-eu-newprompt-r2, v3-text-eu-cell-35-eu-newprompt-r3 | v3-eu-cell-35-eu-newprompt, v3-eu-cell-35-eu-newprompt-r2, v3-eu-cell-35-eu-newprompt-r3 |
| B2 | 3.8, default reasoning, v2 photo prompt, plates only | none | prompt-v2:v2-eu-cell-38-newprompt |
| C2 | 3.8, reasoning minimal, v2 photo prompt, plates only | none | prompt-v2:v2-eu-cell-38-minimal-newprompt |
| D2 | 3.5 flash lite EU, minimal, v2 photo prompt, plates only | none | prompt-v2:v2-eu-cell-35-eu-newprompt |

## Reading (written by hand, kept when the file is written again)

- **In-sample caveat: rule 2 was taught to the test.** The v3 prompt (`prompt.ts` blob cc374d3e, commit a5e7690f)
  names, by word, a food of every clear pregnancy entry in the gold: all 42 typed cases with a clear pregnancy entry
  (49 entries) and all 8 plates with one (11 entries) name a food the v3 prompt names. Only t016, t035,
  t036, t046 and t055 are unnamed by v3, all `clear: false`, and t035 and t036 appear in the production text prompt
  as its own examples. So the typed fixes of D against D3 (t050, t080, t084, t045) and the zero misses below show
  that 3.5 matches words it was shown, not that it applies a category. Rule 2 therefore needs the held-out typed set
  (`gold/gold_text_holdout.jsonl`, 36 cases that neither the v3 nor the v4 prompt names, `gold/GOLD-NOTES.md`
  section 10) before it counts.
- **Rule 1 FAIL for D3.** Rule 1 asks for zero schema-invalid answers. D3's typed call r3 t039 "Käsespätzle mit
  Röstzwiebeln" is invalid (truncated JSON, `finish_reason` error), and plate run r2 plate 23 also ended with
  `finish_reason` error (both in "Failed calls" below).
- **Rule 2 PASS on the taught set only.** D3 has no clear typed pregnancy miss in any of the three repeats. The
  failed call t039 holds no clear pregnancy entry.
- **Rule 3 FAIL rests on one plate run.** Both D3 misses are in plate run r2 and both are items the answer did not
  list: plate 45 the hoe (raw fish; the answer lists a mackerel, a braised fish and kimchi, no raw fish) and plate 47
  the eggs Benedict (raw egg; it lists only the avocado toast with poached egg, which carries raw-egg). These are
  recall failures, not flags left off a listed food: with listed items only, rule 3 passes (0.0 against 0.0).
- **"Elsewhere" flags count as misses per item.** The scorer judges each gold item. When the answer did not list
  the item, the flag is a miss even when it sits on another item of the same plate. That is the case for 4 of D3's
  unlisted plate allergen misses and for 1 of its 2 pregnancy misses (plate 47: the avocado toast with poached egg
  carries raw-egg). The meal-level reading counts those as caught: allergens D3 2.33 against B 1.0, still FAIL
  through t085; pregnancy D3 0.33 against B 0.0, still FAIL through the hoe on plate 45.
- **Rule 4 FAIL holds on listed items too, and the typed part rests on one case.** Typed t085 "Una tapa de
  altramuces y una caña" lists the lupini beans without lupin in r1 and r2 (r3 had it). It is D3's only typed
  allergen miss, so rule 4 typed rests on t085 alone. Plate misses add 1, 4 and 0 per run. Listed only: D3 2.33
  against B 1.0 and against C3 0.5. The holdout set adds 14 cases with a non-obvious allergen (snails, squid,
  piccalilli, tahini, seitan, bulgur, teriyaki, natto, anchovies, shrimp paste and others).
- **Arguable label.** Plate 29 (r1): the creamy dip with the pickles is gold `milk` (if_listed, clear). Photo 29 shows
  a white dollop that may be mayonnaise; the answer gave eggs and mustard. Without it D3 plate run r1 has 0 clear
  allergen misses and rule 4 stays FAIL (typed lupin alone fails it).
- **False alarms: v3 adds them, clearly for 3.5, mildly for 3.8.** D to D3: typed pregnancy false alarms 4 (2
  distinct) to 6 (4 distinct, new: t022 mussels raw-fish, t030 cooked ham raw-meat, t056 mature cheddar soft-cheese);
  plate pregnancy false alarms 1 per run to 10 over 3 runs (plate 32 deviled eggs raw-egg in every run, the paella
  raw-fish in every run, counted on two gold items each); extra pregnancy flags per answer 0.019 to 0.079 typed and
  0.12 to 0.56 on plates (D2 0.12). Most extras follow the v3 wording: raw-sprouts on salads and bowls, raw-meat on
  cooked bacon, sausages and bratwurst, raw-egg on pancakes, batter and mayonnaise items, high-mercury on salmon.
  C to C3: extra pregnancy flags 0.015 to 0.019 typed and 0.02 to 0.12 on plates (C2 0.08); false alarms on
  must_not_flag stay flat (typed 4 to 3, plates 1 per run). Allergen extras fall for D3 (typed 0.80 to 0.55).
- **Mapping.** The v2 and v3 photo prompts split a plate into more items. Their names are mapped to gold by hand
  (`_P_V2V3` in `harness/score_flags.py`); without that, D3 showed about 30 plate allergen misses that were artefacts.


## Decision rules

Clear entries decide. Typed misses are summed over the repeats (scaled to 3 when a cell has fewer).
Beside the verdict, for a reader to judge: each distinct entry counted once; the misses on listed
items only (a food the answer did not list at all is left out); the plates read with the recall
worksheet's listing (a core item the worksheet marks `n` counts as not listed); and the totals with the
`clear: false` entries added. None of these four decides a rule.

| rule | test | verdict | clear misses | distinct entries | listed items only | worksheet listing | with clear:false |
|---|---|---|---|---|---|---|---|
| 2 | D3: zero misses on the clear pregnancy must-flag typed cases, in every repeat | **PASS** | misses per repeat [0, 0, 0]; distinct entries missed 0 | | | | failed calls left out (rule 1); their clear pregnancy entries per repeat [0, 0, 0]; counted as misses: PASS |
| 3 | D3 total pregnancy misses (typed plus plates) no higher than B | **FAIL** | D3 0.67 vs B 0.0 (plates: mean per plate run, D3 3 run(s) [0, 2, 0], B 1 run(s) [0]) | D3 2 vs B 0 (FAIL) | D3 0.0 vs B 0.0 (PASS) | n/a: no filled worksheet for every plate run of D3 | D3 6.67 vs B 0.0 (FAIL) |
| 3 | D3 total pregnancy misses (typed plus plates) no higher than C3 | **FAIL** | D3 0.67 vs C3 0.0 (plates: mean per plate run, D3 3 run(s) [0, 2, 0], C3 2 run(s) [0, 0]) | D3 2 vs C3 0 (FAIL) | D3 0.0 vs C3 0.0 (PASS) | n/a: no filled worksheet for every plate run of D3, C3 | D3 6.67 vs C3 0.0 (FAIL) |
| 4 | D3 total allergen misses (typed plus plates) no higher than B | **FAIL** | D3 3.67 vs B 2.0 (plates: mean per plate run, D3 3 run(s) [1, 4, 0], B 1 run(s) [2]) | D3 6 vs B 2 (FAIL) | D3 2.33 vs B 1.0 (FAIL) | n/a: no filled worksheet for every plate run of D3 | D3 5.34 vs B 2.0 (FAIL) |
| 4 | D3 total allergen misses (typed plus plates) no higher than C3 | **FAIL** | D3 3.67 vs C3 1.0 (plates: mean per plate run, D3 3 run(s) [1, 4, 0], C3 2 run(s) [2, 0]) | D3 6 vs C3 2 (FAIL) | D3 2.33 vs C3 0.5 (FAIL) | n/a: no filled worksheet for every plate run of D3, C3 | D3 5.34 vs C3 1.5 (FAIL) |

## Miss counts per cell

Typed counts are summed over the scored repeats. `per 3` scales a cell with fewer repeats to three.
`distinct` counts an entry once however many repeats missed it. `unlisted` = the item was not in the
answer at all (a clear must_flag only); `elsewhere` = of those, the same flag sat on another item.

| cell | reps | preg clear typed | per 3 | distinct | preg clear plates | preg nonclear typed / plates | alg clear typed | per 3 | distinct | alg clear plates | alg nonclear typed / plates |
|---|---|---|---|---|---|---|---|---|---|---|---|
| B | 3 | 0 | 0.0 | 0 | 0 | 0 / 0 | 0 | 0.0 | 0 | 2 | 0 / 0 |
| C | 3 | 1 | 1.0 | 1 | 1 | 0 / 0 | 0 | 0.0 | 0 | 1 | 0 / 2 |
| D | 3 | 8 | 8.0 | 4 | 1 | 5 / 1 | 0 | 0.0 | 0 | 3 | 2 / 1 |
| C3 | 3 | 0 | 0.0 | 0 | 0 | 0 / 0 | 0 | 0.0 | 0 | 2 | 0 / 1 |
| D3 | 3 | 0 | 0.0 | 0 | 2 | 5 / 3 | 2 | 2.0 | 1 | 5 | 0 / 5 |
| B2 | 0 | 0 | 0.0 | 0 | 0 | 0 / 0 | 0 | 0.0 | 0 | 1 | 0 / 0 |
| C2 | 0 | 0 | 0.0 | 0 | 0 | 0 / 0 | 0 | 0.0 | 0 | 0 | 0 / 1 |
| D2 | 0 | 0 | 0.0 | 0 | 2 | 0 / 3 | 0 | 0.0 | 0 | 1 | 0 / 0 |

| cell | source | clear preg tested | clear preg miss (unlisted, elsewhere) | clear alg tested | clear alg miss (unlisted, elsewhere) | if_listed misses | failed calls |
|---|---|---|---|---|---|---|---|
| B | typed | 146 | 0 (0, 0) | 347 | 0 (0, 0) | 0 | 3 |
| B | plates | 18 | 0 (0, 0) | 105 | 2 (1, 1) | 0 | 0 |
| C | typed | 147 | 1 (0, 0) | 351 | 0 (0, 0) | 0 | 0 |
| C | plates | 17 | 1 (0, 0) | 104 | 1 (1, 1) | 0 | 0 |
| D | typed | 144 | 8 (0, 0) | 350 | 0 (0, 0) | 0 | 2 |
| D | plates | 18 | 1 (1, 1) | 103 | 3 (3, 3) | 1 | 0 |
| C3 | typed | 147 | 0 (0, 0) | 351 | 0 (0, 0) | 0 | 0 |
| C3 | plates | 37 | 0 (0, 0) | 212 | 2 (1, 1) | 0 | 0 |
| D3 | typed | 147 | 0 (0, 0) | 348 | 2 (0, 0) | 0 | 1 |
| D3 | plates | 55 | 2 (2, 1) | 317 | 5 (4, 4) | 4 | 1 |
| B2 | plates | 19 | 0 (0, 0) | 106 | 1 (1, 1) | 0 | 0 |
| C2 | plates | 18 | 0 (0, 0) | 105 | 0 (0, 0) | 0 | 0 |
| D2 | plates | 18 | 2 (1, 0) | 106 | 1 (1, 1) | 1 | 0 |

## Every miss

### Cell B: pregnancy misses (0)

None.

### Cell B: allergen misses (2)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| eval-harness:eu-cell-38-newprompt | 06 | Sushi platter (restaurant table) | soy sauce | allergen soybeans | yes | unlisted_miss | not listed; same flag on: salmon avocado roll (mayContain: soybeans), assorted nigiri sushi (mayContain: soybeans) |
| eval-harness:eu-cell-38-newprompt | 33 | Bowl of oatmeal porridge with toppings | milk | allergen milk | yes | miss | cooked oatmeal P[] A[] M['gluten'] |

### Cell C: pregnancy misses (2)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| eval-harness:text-eu-cell-38-minimal-newprompt-r2 | t050 | Chicken liver pate on toast | chicken liver pate on toast | pregnancy raw-meat | yes | miss | Chicken liver pate P['liver-retinol'] A['milk'] M['eggs', 'gluten', 'sulphites']; Toast P[] A['gluten'] M['milk', 'sesame', 'soybeans'] |
| eval-harness:eu-cell-38-minimal-newprompt | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | pregnancy raw-fish | yes | miss | Assorted Korean banchan side dishes P[] A['sesame', 'soybeans'] M['crustaceans', 'fish', 'gluten'] |

### Cell C: allergen misses (3)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| eval-harness:eu-cell-38-minimal-newprompt | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | grilled mackerel/fish | allergen fish | yes | unlisted_miss | not listed; same flag on: Spicy glazed fish or pork (mayContain: fish), Tofu with stir-fried kimchi (mayContain: fish), Korean steamed egg custard (mayContain: fish), Assorted Korean banchan side dishes (mayContain: fish) |
| eval-harness:eu-cell-38-minimal-newprompt | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | vegetable fritters/jeon platter | allergen eggs | no | miss | Assorted Korean banchan side dishes P[] A['sesame', 'soybeans'] M['crustaceans', 'fish', 'gluten'] |
| eval-harness:eu-cell-38-minimal-newprompt | 47 | Café brunch table spread (top-down) | cherry tomato salad with balsamic drizzle | allergen sulphites | no | miss | avocado toast with poached eggs and cherry tomatoes P['raw-egg'] A['eggs', 'gluten'] M['milk', 'sesame']; eggs benedict with hollandaise and tomatoes P['raw-egg'] A['eggs', 'gluten', 'milk'] M['mustard', 'sesame'] |

### Cell D: pregnancy misses (15)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| eval-harness:text-eu-cell-35-eu-newprompt-r1 | t050 | Chicken liver pate on toast | chicken liver pate on toast | pregnancy raw-meat | yes | miss | chicken liver pate P['liver-retinol'] A['milk'] M['eggs', 'gluten', 'mustard']; toast P[] A['gluten'] M['milk', 'sesame', 'soybeans'] |
| eval-harness:text-eu-cell-35-eu-newprompt-r1 | t055 | 40 g of Comté | Comté cheese | pregnancy raw-dairy | no | miss | Comté cheese P[] A['milk'] M[] |
| eval-harness:text-eu-cell-35-eu-newprompt-r1 | t080 | Foie gras mi-cuit sur pain d'épices | foie gras mi-cuit | pregnancy raw-meat | no | miss | foie gras mi-cuit P['liver-retinol'] A[] M[] |
| eval-harness:text-eu-cell-35-eu-newprompt-r1 | t084 | Vitello tonnato, una porzione | vitello tonnato | pregnancy high-mercury-fish | yes | miss | vitello tonnato P['raw-egg'] A['eggs', 'fish'] M['mustard'] |
| eval-harness:text-eu-cell-35-eu-newprompt-r2 | t050 | Chicken liver pate on toast | chicken liver pate on toast | pregnancy raw-meat | yes | miss | chicken liver pate P['liver-retinol'] A['milk'] M['eggs', 'gluten', 'sulphites']; toast P[] A['gluten', 'soybeans'] M['milk', 'sesame'] |
| eval-harness:text-eu-cell-35-eu-newprompt-r2 | t055 | 40 g of Comté | Comté cheese | pregnancy raw-dairy | no | miss | Comté cheese P[] A['milk'] M[] |
| eval-harness:text-eu-cell-35-eu-newprompt-r2 | t080 | Foie gras mi-cuit sur pain d'épices | foie gras mi-cuit | pregnancy liver-retinol | yes | miss | foie gras mi-cuit P[] A[] M[] |
| eval-harness:text-eu-cell-35-eu-newprompt-r2 | t080 | Foie gras mi-cuit sur pain d'épices | foie gras mi-cuit | pregnancy raw-meat | no | miss | foie gras mi-cuit P[] A[] M[] |
| eval-harness:text-eu-cell-35-eu-newprompt-r2 | t084 | Vitello tonnato, una porzione | vitello tonnato | pregnancy high-mercury-fish | yes | miss | vitello tonnato P['raw-egg'] A['eggs', 'fish'] M['mustard'] |
| eval-harness:text-eu-cell-35-eu-newprompt-r3 | t045 | Brie and grape sandwich on sourdough | brie and grape sandwich | pregnancy soft-cheese | yes | miss | Brie and grape sandwich on sourdough P[] A['gluten', 'milk'] M['nuts', 'sesame'] |
| eval-harness:text-eu-cell-35-eu-newprompt-r3 | t050 | Chicken liver pate on toast | chicken liver pate on toast | pregnancy raw-meat | yes | miss | chicken liver pate P['liver-retinol'] A['milk'] M['eggs', 'gluten', 'mustard']; toast P[] A['gluten'] M['milk', 'sesame', 'soybeans'] |
| eval-harness:text-eu-cell-35-eu-newprompt-r3 | t080 | Foie gras mi-cuit sur pain d'épices | foie gras mi-cuit | pregnancy raw-meat | no | miss | foie gras mi-cuit P['liver-retinol'] A[] M[] |
| eval-harness:text-eu-cell-35-eu-newprompt-r3 | t084 | Vitello tonnato, una porzione | vitello tonnato | pregnancy high-mercury-fish | yes | miss | vitello tonnato P['raw-egg'] A['eggs', 'fish'] M['mustard', 'sulphites'] |
| eval-harness:eu-cell-35-eu-newprompt | 22 | Three soft tacos with a corn cob | glass of cola | pregnancy caffeine | no | miss | cola P[] A[] M[] |
| eval-harness:eu-cell-35-eu-newprompt | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | pregnancy raw-egg | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (pregnancy: raw-egg) |

### Cell D: allergen misses (6)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| eval-harness:text-eu-cell-35-eu-newprompt-r1 | t061 | A Big Mac and medium fries | Big Mac | allergen mustard | no | miss | Big Mac P[] A['eggs', 'gluten', 'milk', 'sesame'] M['soybeans'] |
| eval-harness:text-eu-cell-35-eu-newprompt-r3 | t061 | A Big Mac and medium fries | Big Mac | allergen mustard | no | miss | Big Mac P[] A['eggs', 'gluten', 'milk', 'sesame'] M['soybeans'] |
| eval-harness:eu-cell-35-eu-newprompt | 05 | Chicken in creamy leafy-green sauce with white rice | chicken pieces in creamy sauce with leafy greens (spinach-type) | allergen milk | no | miss | chicken and greens stew P[] A[] M['celery'] |
| eval-harness:eu-cell-35-eu-newprompt | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen eggs | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (allergens: eggs), bagel (mayContain: eggs) |
| eval-harness:eu-cell-35-eu-newprompt | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen gluten | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (allergens: gluten), acai bowl with fruit (allergens: gluten), bagel (allergens: gluten) |
| eval-harness:eu-cell-35-eu-newprompt | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen milk | yes | unlisted_miss | not listed; same flag on: acai bowl with fruit (mayContain: milk), bagel (mayContain: milk), iced coffee (allergens: milk) |

### Cell C3: pregnancy misses (0)

None.

### Cell C3: allergen misses (3)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v3-eu-cell-38-minimal-newprompt | 06 | Sushi platter (restaurant table) | soy sauce | allergen soybeans | yes | unlisted_miss | not listed; same flag on: salmon avocado roll (mayContain: soybeans), tuna nigiri (mayContain: soybeans), white fish nigiri (mayContain: soybeans) |
| v3-eu-cell-38-minimal-newprompt | 33 | Bowl of oatmeal porridge with toppings | milk | allergen milk | yes | miss | oatmeal porridge P[] A['gluten'] M[] |
| v3-eu-cell-38-minimal-newprompt | 47 | Café brunch table spread (top-down) | cherry tomato salad with balsamic drizzle | allergen sulphites | no | miss | Avocado and poached egg toast with cherry tomatoes P['raw-egg', 'raw-sprouts'] A['eggs', 'gluten'] M['milk', 'sesame', 'soybeans']; Eggs Benedict with avocado and cherry tomatoes P['raw-egg', 'raw-sprouts'] A['eggs', 'gluten', 'milk'] M['mustard', 'sesame'] |

### Cell D3: pregnancy misses (10)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v3-text-eu-cell-35-eu-newprompt-r1 | t055 | 40 g of Comté | Comté cheese | pregnancy raw-dairy | no | miss | Comté P[] A['milk'] M[] |
| v3-text-eu-cell-35-eu-newprompt-r1 | t078 | Un verre de vin blanc et un morceau de Roquefort | Roquefort | pregnancy raw-dairy | no | miss | Roquefort P['soft-cheese'] A['milk'] M[] |
| v3-text-eu-cell-35-eu-newprompt-r2 | t055 | 40 g of Comté | Comté cheese | pregnancy raw-dairy | no | miss | Comté P[] A['milk'] M[] |
| v3-text-eu-cell-35-eu-newprompt-r2 | t078 | Un verre de vin blanc et un morceau de Roquefort | Roquefort | pregnancy raw-dairy | no | miss | Roquefort P['soft-cheese'] A['milk'] M[] |
| v3-text-eu-cell-35-eu-newprompt-r3 | t055 | 40 g of Comté | Comté cheese | pregnancy raw-dairy | no | miss | Comté P[] A['milk'] M[] |
| v3-eu-cell-35-eu-newprompt | 22 | Three soft tacos with a corn cob | glass of cola | pregnancy caffeine | no | miss | cola P[] A[] M[] |
| v3-eu-cell-35-eu-newprompt-r2 | 40 | Half-eaten liver-and-bacon fry-up with chips | fried egg (remnant, yolk visible) | pregnancy raw-egg | no | miss | fried gammon and egg P['raw-meat'] A['eggs'] M[] |
| v3-eu-cell-35-eu-newprompt-r2 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | pregnancy raw-fish | yes | unlisted_miss | not listed |
| v3-eu-cell-35-eu-newprompt-r2 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | pregnancy raw-egg | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (pregnancy: raw-egg) |
| v3-eu-cell-35-eu-newprompt-r3 | 22 | Three soft tacos with a corn cob | glass of cola | pregnancy caffeine | no | miss | cola P[] A[] M[] |

### Cell D3: allergen misses (12)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v3-text-eu-cell-35-eu-newprompt-r1 | t085 | Una tapa de altramuces y una caña | lupini beans | allergen lupin | yes | miss | altramuces P[] A[] M['gluten'] |
| v3-text-eu-cell-35-eu-newprompt-r2 | t085 | Una tapa de altramuces y una caña | lupini beans | allergen lupin | yes | miss | altramuces P[] A[] M[] |
| v3-eu-cell-35-eu-newprompt | 29 | Tapas/snack flight with a wheat beer | creamy dip/cream cheese with the pickles | allergen milk | yes | miss | pickles and dip P['raw-egg'] A['eggs', 'mustard'] M[] |
| v3-eu-cell-35-eu-newprompt-r2 | 42 | Buffet lunch plate (many components) | sour cream / remoulade dollop | allergen milk | no | miss | breaded fried fish with mayonnaise P['raw-egg'] A['eggs', 'fish', 'gluten'] M[] |
| v3-eu-cell-35-eu-newprompt-r2 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | allergen fish | yes | unlisted_miss | not listed; same flag on: grilled mackerel (allergens: fish), tofu and kimchi (allergens: fish), spicy braised fish (allergens: fish), kimchi (allergens: fish) |
| v3-eu-cell-35-eu-newprompt-r2 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen eggs | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (allergens: eggs), bagel (mayContain: eggs) |
| v3-eu-cell-35-eu-newprompt-r2 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen gluten | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (allergens: gluten), smoothie bowl with fruit and granola (allergens: gluten), bagel (allergens: gluten) |
| v3-eu-cell-35-eu-newprompt-r2 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen milk | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (mayContain: milk), smoothie bowl with fruit and granola (allergens: milk), bagel (mayContain: milk), iced latte (allergens: milk), matcha latte (allergens: milk) |
| v3-eu-cell-35-eu-newprompt-r3 | 05 | Chicken in creamy leafy-green sauce with white rice | chicken pieces in creamy sauce with leafy greens (spinach-type) | allergen milk | no | miss | chicken and spinach stew P[] A[] M[] |
| v3-eu-cell-35-eu-newprompt-r3 | 08 | Yogurt granola bowl with apple | raisins/dried fruit in granola | allergen sulphites | no | miss | yogurt with granola and apple slices P[] A['gluten', 'milk', 'nuts'] M['sesame', 'soybeans'] |
| v3-eu-cell-35-eu-newprompt-r3 | 42 | Buffet lunch plate (many components) | sour cream / remoulade dollop | allergen milk | no | miss | breaded fried fish fillet with remoulade P['raw-egg'] A['eggs', 'fish', 'gluten', 'mustard'] M[] |
| v3-eu-cell-35-eu-newprompt-r3 | 47 | Café brunch table spread (top-down) | cherry tomato salad with balsamic drizzle | allergen sulphites | no | miss | sesame bagel with tomato salad P['raw-sprouts'] A['gluten', 'sesame'] M['milk', 'nuts', 'soybeans'] |

### Cell B2: pregnancy misses (0)

None.

### Cell B2: allergen misses (1)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| prompt-v2:v2-eu-cell-38-newprompt | 06 | Sushi platter (restaurant table) | soy sauce | allergen soybeans | yes | unlisted_miss | not listed; same flag on: salmon avocado roll (mayContain: soybeans), tuna nigiri (mayContain: soybeans), white fish nigiri (mayContain: soybeans) |

### Cell C2: pregnancy misses (0)

None.

### Cell C2: allergen misses (1)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| prompt-v2:v2-eu-cell-38-minimal-newprompt | 47 | Café brunch table spread (top-down) | cherry tomato salad with balsamic drizzle | allergen sulphites | no | miss | avocado toast with poached egg and side tomatoes P['raw-egg', 'raw-sprouts'] A['eggs', 'gluten'] M['milk', 'sesame']; eggs benedict with hollandaise and side tomatoes P['raw-egg', 'raw-sprouts'] A['eggs', 'gluten', 'milk'] M['mustard', 'sesame']; seeded bagel with side tomatoes P['raw-sprouts'] A['gluten', 'sesame'] M['eggs', 'milk'] |

### Cell D2: pregnancy misses (5)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| prompt-v2:v2-eu-cell-35-eu-newprompt | 22 | Three soft tacos with a corn cob | glass of cola | pregnancy caffeine | no | miss | cola P[] A[] M[] |
| prompt-v2:v2-eu-cell-35-eu-newprompt | 25 | American breakfast platter | fried egg (sunny side up) | pregnancy raw-egg | yes | miss | fried egg P[] A['eggs'] M[] |
| prompt-v2:v2-eu-cell-35-eu-newprompt | 40 | Half-eaten liver-and-bacon fry-up with chips | liver pieces in gravy | pregnancy liver-retinol | yes | unlisted_miss | not listed |
| prompt-v2:v2-eu-cell-35-eu-newprompt | 40 | Half-eaten liver-and-bacon fry-up with chips | fried egg (remnant, yolk visible) | pregnancy raw-egg | no | miss | cooked bacon and fried egg P[] A['eggs'] M[] |
| prompt-v2:v2-eu-cell-35-eu-newprompt | 47 | Café brunch table spread (top-down) | avocado toast/bagel halves with poached eggs | pregnancy raw-egg | no | miss | avocado toast with poached egg P[] A['eggs', 'gluten'] M['sesame']; bagel with avocado and poached egg P[] A['eggs', 'gluten', 'sesame'] M[] |

### Cell D2: allergen misses (1)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| prompt-v2:v2-eu-cell-35-eu-newprompt | 43 | Buffet lunch set, main plate, soup bowl, bread plate | cheese-topped quiche/gratin square | allergen milk | yes | unlisted_miss | not listed; same flag on: bread with butter (allergens: milk), cream soup with bacon bits (allergens: milk), breaded cutlet with mayonnaise and green beans (allergens: milk) |

## Failed calls (scored by rule 1, not as flag misses)

| cell | run | case | text | finish | clear must_flag entries | flags the truncated text had written |
|---|---|---|---|---|---|---|
| B | eval-harness:text-eu-cell-38-newprompt-r1 | t040 | Graved Lachs mit Senf-Dill-Sauce | length | allergen fish, allergen mustard | "flags": { "pregnancy": [ "raw-fish" ], "allergens": [ "fish" ], "mayContain": [] } |
| B | eval-harness:text-eu-cell-38-newprompt-r2 | t040 | Graved Lachs mit Senf-Dill-Sauce | length | allergen fish, allergen mustard | "flags": { "pregnancy": [ "raw-fish" ], "allergens": [ "fish", "mustard" ], "mayContain": [] } |
| B | eval-harness:text-eu-cell-38-newprompt-r3 | t044 | 4 slices of prosciutto with melon | length | pregnancy raw-meat | "flags": { "pregnancy": [ "raw-meat" ], "allergens": [], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": [], "mayContain": [] } |
| D | eval-harness:text-eu-cell-35-eu-newprompt-r3 | t072 | Rare ribeye steak, 250 g | error | pregnancy raw-meat | none |
| D | eval-harness:text-eu-cell-35-eu-newprompt-r3 | t079 | Un steak tartare avec un jaune d'oeuf cru, et des frites | error | pregnancy raw-meat, pregnancy raw-egg, allergen eggs | "flags": { "pregnancy": ["raw-meat", "raw-egg"], "allergens": ["eggs", "mustard"], "mayContain": ["gluten", "fish", "sulphites", "celery"] } |
| D3 | v3-text-eu-cell-35-eu-newprompt-r3 | t039 | Käsespätzle mit Röstzwiebeln | error | allergen gluten, allergen eggs, allergen milk | none |
| D3 | v3-eu-cell-35-eu-newprompt-r2 | 23 | Smothered beef burrito | error | allergen gluten, allergen milk | "flags": { "pregnancy": [], "allergens": ["gluten", "milk"], "mayContain": ["eggs", "soybeans"] } |

## Not blocking: demotions, false alarms, extra flags

| cell | source | cases | demotions clear (distinct) | demotions not clear | preg false alarms (distinct) | allergen false alarms (distinct) | extra preg flags per case | extra allergen flags per case | items outside the gold, their flags |
|---|---|---|---|---|---|---|---|---|---|
| B | typed | 264 | 0 (0) | 4 | 3 (1) | 3 (1) | 0.02 | 0.85 | 3, 0 |
| B | plates | 50 | 4 (4) | 4 | 1 (1) | 0 (0) | 0.08 | 2.94 | 5, 14 |
| C | typed | 267 | 0 (0) | 6 | 4 (2) | 3 (1) | 0.01 | 0.84 | 3, 0 |
| C | plates | 50 | 5 (5) | 4 | 1 (1) | 0 (0) | 0.02 | 3.02 | 3, 7 |
| D | typed | 265 | 3 (2) | 6 | 4 (2) | 3 (1) | 0.02 | 0.80 | 4, 0 |
| D | plates | 50 | 1 (1) | 2 | 1 (1) | 0 (0) | 0.12 | 1.58 | 4, 12 |
| C3 | typed | 267 | 0 (0) | 6 | 3 (1) | 3 (1) | 0.02 | 0.76 | 3, 0 |
| C3 | plates | 100 | 10 (6) | 7 | 2 (1) | 0 (0) | 0.12 | 3.07 | 7, 23 |
| D3 | typed | 266 | 1 (1) | 6 | 6 (4) | 1 (1) | 0.08 | 0.55 | 3, 0 |
| D3 | plates | 149 | 6 (5) | 8 | 10 (4) | 0 (0) | 0.56 | 1.98 | 12, 18 |
| B2 | plates | 50 | 3 (3) | 4 | 1 (1) | 0 (0) | 0.06 | 3.14 | 9, 21 |
| C2 | plates | 50 | 4 (4) | 3 | 1 (1) | 0 (0) | 0.08 | 2.86 | 4, 7 |
| D2 | plates | 50 | 2 (2) | 3 | 1 (1) | 0 (0) | 0.12 | 1.54 | 3, 8 |

### Cell B: demotions (12)

- 05 chicken pieces in creamy sauce with leafy greens (spinach-type): milk in mayContain, 1 answer(s), clear:false
- 32 herb crackers: sesame in mayContain, 1 answer(s), clear:false
- 33 oatmeal/oat porridge: gluten in mayContain, 1 answer(s)
- 37 pierogi/boiled dumplings (potato-cheese filling): milk in mayContain, 1 answer(s)
- 42 sour cream / remoulade dollop: milk in mayContain, 1 answer(s), clear:false
- 45 sliced raw fish (hoe/sashimi) on shredded radish: fish in mayContain, 1 answer(s)
- 45 vegetable fritters/jeon platter: eggs in mayContain, 1 answer(s), clear:false
- 47 yogurt bowl with granola, kiwi slices and berry compote: milk in mayContain, 1 answer(s)
- t063 miso soup: fish in mayContain, 1 answer(s), clear:false
- t071 curry: nuts in mayContain, 3 answer(s), clear:false

### Cell C: demotions (15)

- 05 chicken pieces in creamy sauce with leafy greens (spinach-type): milk in mayContain, 1 answer(s), clear:false
- 28 yellow bulgur or couscous: gluten in mayContain, 1 answer(s)
- 32 herb crackers: sesame in mayContain, 1 answer(s), clear:false
- 33 milk: milk in mayContain, 1 answer(s)
- 37 pierogi/boiled dumplings (potato-cheese filling): milk in mayContain, 1 answer(s)
- 42 sour cream / remoulade dollop: milk in mayContain, 1 answer(s), clear:false
- 45 sliced raw fish (hoe/sashimi) on shredded radish: fish in mayContain, 1 answer(s)
- 45 vegetable fritters/jeon platter: gluten in mayContain, 1 answer(s), clear:false
- 47 yogurt bowl with granola, kiwi slices and berry compote: milk in mayContain, 1 answer(s)
- t063 miso soup: fish in mayContain, 3 answer(s), clear:false
- t071 curry: nuts in mayContain, 3 answer(s), clear:false

### Cell D: demotions (12)

- 11 breaded fried schnitzel (pork/veal cutlet): eggs in mayContain, 1 answer(s), clear:false
- 32 herb crackers: sesame in mayContain, 1 answer(s), clear:false
- 47 yogurt bowl with granola, kiwi slices and berry compote: milk in mayContain, 1 answer(s)
- t052 shrimp pad Thai: fish in mayContain, 2 answer(s), clear:false
- t063 miso soup: fish in mayContain, 1 answer(s), clear:false
- t071 curry: nuts in mayContain, 3 answer(s), clear:false
- t085 lupini beans: lupin in mayContain, 1 answer(s)
- t087 red wine: sulphites in mayContain, 2 answer(s)

### Cell C3: demotions (23)

- 05 chicken pieces in creamy sauce with leafy greens (spinach-type): milk in mayContain, 2 answer(s), clear:false
- 28 yellow bulgur or couscous: gluten in mayContain, 2 answer(s)
- 29 creamy dip/cream cheese with the pickles: milk in mayContain, 2 answer(s)
- 32 herb crackers: sesame in mayContain, 2 answer(s), clear:false
- 33 milk: milk in mayContain, 1 answer(s)
- 35 pickled green chili pepper: sulphites in mayContain, 1 answer(s), clear:false
- 37 pierogi/boiled dumplings (potato-cheese filling): milk in mayContain, 2 answer(s)
- 38 cheese slice in burger: milk in mayContain, 1 answer(s)
- 42 sour cream / remoulade dollop: milk in mayContain, 2 answer(s), clear:false
- 47 yogurt bowl with granola, kiwi slices and berry compote: milk in mayContain, 2 answer(s)
- t023 Waldorf salad: eggs in mayContain, 3 answer(s), clear:false
- t071 curry: nuts in mayContain, 3 answer(s), clear:false

### Cell D3: demotions (21)

- 05 chicken pieces in creamy sauce with leafy greens (spinach-type): milk in mayContain, 2 answer(s), clear:false
- 12 mustard/onion-gravy drizzle on the sausages: mustard in mayContain, 2 answer(s), clear:false
- 32 herb crackers: sesame in mayContain, 3 answer(s), clear:false
- 33 milk: milk in mayContain, 1 answer(s)
- 33 oatmeal/oat porridge: gluten in mayContain, 1 answer(s)
- 37 pierogi/boiled dumplings (potato-cheese filling): milk in mayContain, 2 answer(s)
- 42 sour cream / remoulade dollop: milk in mayContain, 1 answer(s), clear:false
- 47 yogurt bowl with granola, kiwi slices and berry compote: gluten in mayContain, 1 answer(s)
- 47 yogurt bowl with granola, kiwi slices and berry compote: milk in mayContain, 1 answer(s)
- t052 shrimp pad Thai: fish in mayContain, 3 answer(s), clear:false
- t071 curry: nuts in mayContain, 3 answer(s), clear:false
- t075 granola bar: gluten in mayContain, 1 answer(s)

### Cell B2: demotions (7)

- 05 chicken pieces in creamy sauce with leafy greens (spinach-type): milk in mayContain, 1 answer(s), clear:false
- 20 sliced chashu pork: soybeans in mayContain, 1 answer(s), clear:false
- 29 creamy dip/cream cheese with the pickles: milk in mayContain, 1 answer(s)
- 32 herb crackers: sesame in mayContain, 1 answer(s), clear:false
- 33 milk: milk in mayContain, 1 answer(s)
- 42 sour cream / remoulade dollop: milk in mayContain, 1 answer(s), clear:false
- 47 yogurt bowl with granola, kiwi slices and berry compote: milk in mayContain, 1 answer(s)

### Cell C2: demotions (7)

- 05 chicken pieces in creamy sauce with leafy greens (spinach-type): milk in mayContain, 1 answer(s), clear:false
- 28 yellow bulgur or couscous: gluten in mayContain, 1 answer(s)
- 29 creamy dip/cream cheese with the pickles: milk in mayContain, 1 answer(s)
- 32 herb crackers: sesame in mayContain, 1 answer(s), clear:false
- 33 milk: milk in mayContain, 1 answer(s)
- 42 sour cream / remoulade dollop: milk in mayContain, 1 answer(s), clear:false
- 47 yogurt bowl with granola, kiwi slices and berry compote: milk in mayContain, 1 answer(s)

### Cell D2: demotions (5)

- 05 chicken pieces in creamy sauce with leafy greens (spinach-type): milk in mayContain, 1 answer(s), clear:false
- 12 mustard/onion-gravy drizzle on the sausages: mustard in mayContain, 1 answer(s), clear:false
- 32 herb crackers: sesame in mayContain, 1 answer(s), clear:false
- 33 milk: milk in mayContain, 1 answer(s)
- 37 pierogi/boiled dumplings (potato-cheese filling): milk in mayContain, 1 answer(s)

### Cell B: false alarms on must_not_flag (7)

- 03 feta cheese: pregnancy soft-cheese (in pregnancy), 1 answer(s)
- t068 coconut yogurt: allergen nuts (in mayContain), 3 answer(s)
- t089 white cheese: pregnancy soft-cheese (in pregnancy), 3 answer(s)

### Cell C: false alarms on must_not_flag (8)

- 32 pan-fried spiced hard-boiled egg halves: pregnancy raw-egg (in pregnancy), 1 answer(s)
- t031 mozzarella: pregnancy soft-cheese (in pregnancy), 1 answer(s)
- t068 coconut yogurt: allergen nuts (in mayContain), 3 answer(s)
- t089 white cheese: pregnancy soft-cheese (in pregnancy), 3 answer(s)

### Cell D: false alarms on must_not_flag (8)

- 32 pan-fried spiced hard-boiled egg halves: pregnancy raw-egg (in pregnancy), 1 answer(s)
- t068 coconut yogurt: allergen nuts (in mayContain), 3 answer(s)
- t083 spaghetti with clams: pregnancy raw-fish (in pregnancy), 1 answer(s)
- t090 stuffed mussels: pregnancy raw-fish (in pregnancy), 3 answer(s)

### Cell C3: false alarms on must_not_flag (8)

- 03 feta cheese: pregnancy soft-cheese (in pregnancy), 2 answer(s)
- t068 coconut yogurt: allergen nuts (in mayContain), 3 answer(s)
- t089 white cheese: pregnancy soft-cheese (in pregnancy), 3 answer(s)

### Cell D3: false alarms on must_not_flag (17)

- 32 pan-fried spiced hard-boiled egg halves: pregnancy raw-egg (in pregnancy), 3 answer(s)
- 36 mantis shrimp (galeras): pregnancy raw-fish (in pregnancy), 3 answer(s)
- 36 whole prawns (langostinos): pregnancy raw-fish (in pregnancy), 3 answer(s)
- 45 steamed egg (gyeranjjim) in stone pot: pregnancy raw-egg (in pregnancy), 1 answer(s)
- t022 mussels in white wine broth: pregnancy raw-fish (in pregnancy), 1 answer(s)
- t030 cooked ham: pregnancy raw-meat (in pregnancy), 1 answer(s)
- t056 mature cheddar: pregnancy soft-cheese (in pregnancy), 1 answer(s)
- t068 coconut yogurt: allergen nuts (in mayContain), 1 answer(s)
- t090 stuffed mussels: pregnancy raw-fish (in pregnancy), 3 answer(s)

### Cell B2: false alarms on must_not_flag (1)

- 03 feta cheese: pregnancy soft-cheese (in pregnancy), 1 answer(s)

### Cell C2: false alarms on must_not_flag (1)

- 03 feta cheese: pregnancy soft-cheese (in pregnancy), 1 answer(s)

### Cell D2: false alarms on must_not_flag (1)

- 03 feta cheese: pregnancy soft-cheese (in pregnancy), 1 answer(s)

## Per category and per allergen

Misses / tested entries, typed repeats and plates together. Demotions in brackets.

| kind | value | B clear | C clear | D clear | C3 clear | D3 clear | B not clear | C not clear | D not clear | C3 not clear | D3 not clear |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pregnancy | raw-dairy | 0/9 | 0/9 | 0/9 | 0/9 | 0/9 | 0/9 | 0/9 | 2/9 | 0/9 | 5/9 |
| pregnancy | soft-cheese | 0/12 | 0/12 | 1/12 | 0/12 | 0/12 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| pregnancy | raw-meat | 0/22 | 1/23 | 3/21 | 0/25 | 0/27 | 0/6 | 0/6 | 3/6 | 0/6 | 0/6 |
| pregnancy | raw-egg | 0/17 | 0/17 | 1/16 | 0/19 | 1/21 | 0/8 | 0/8 | 0/8 | 0/10 | 1/12 |
| pregnancy | raw-fish | 0/22 | 1/22 | 0/22 | 0/26 | 1/30 | 0/1 | 0/3 | 0/3 | 0/3 | 0/3 |
| pregnancy | smoked-fish | 0/9 | 0/9 | 0/9 | 0/9 | 0/9 | 0/1 | 0/3 | 0/3 | 0/3 | 0/3 |
| pregnancy | high-mercury-fish | 0/13 | 0/13 | 3/13 | 0/14 | 0/15 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| pregnancy | liver-retinol | 0/13 | 0/13 | 1/13 | 0/14 | 0/15 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| pregnancy | alcohol | 0/18 | 0/17 | 0/18 | 0/25 | 0/31 | 0/1 | 0/1 | 0/1 | 0/2 | 0/2 |
| pregnancy | caffeine | 0/16 | 0/16 | 0/16 | 0/17 | 0/18 | 0/9 | 0/8 | 1/8 | 0/12 | 2/13 |
| pregnancy | raw-sprouts | 0/13 | 0/13 | 0/13 | 0/14 | 0/15 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| allergen | gluten | 0/135 (1) | 0/133 (1) | 1/133 | 0/177 (2) | 1/221 (3) | 0/4 | 0/5 (1) | 0/5 | 0/6 | 0/9 |
| allergen | crustaceans | 0/11 | 0/11 | 0/11 | 0/13 | 0/15 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| allergen | eggs | 0/55 | 0/55 | 1/54 | 0/71 | 1/86 | 0/25 (1) | 1/25 | 0/25 (1) | 0/29 (3) | 0/33 |
| allergen | fish | 0/46 (1) | 1/48 (1) | 0/48 | 0/57 | 1/66 | 0/9 (1) | 0/9 (3) | 0/9 (3) | 0/9 | 0/9 (3) |
| allergen | peanuts | 0/10 | 0/10 | 0/10 | 0/11 | 0/12 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| allergen | soybeans | 1/12 | 0/12 | 0/12 | 1/15 | 0/18 | 0/3 | 0/3 | 0/3 | 0/6 | 0/9 |
| allergen | milk | 1/108 (2) | 0/109 (3) | 1/107 (1) | 1/135 (8) | 2/157 (4) | 0/13 (2) | 0/13 (2) | 1/13 | 0/22 (4) | 3/30 (3) |
| allergen | nuts | 0/10 | 0/10 | 0/10 | 0/11 | 0/12 | 0/3 (3) | 0/3 (3) | 0/3 (3) | 0/3 (3) | 0/3 (3) |
| allergen | celery | 0/9 | 0/9 | 0/9 | 0/9 | 0/9 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| allergen | mustard | 0/8 | 0/10 | 0/10 | 0/11 | 0/12 | 0/5 | 0/5 | 2/4 | 0/7 | 0/9 (2) |
| allergen | sesame | 0/15 | 0/15 | 0/15 | 0/18 | 0/21 | 0/4 (1) | 0/4 (1) | 0/4 (1) | 0/8 (2) | 0/12 (3) |
| allergen | sulphites | 0/9 | 0/9 | 0/10 (2) | 0/11 | 0/12 | 0/1 | 1/2 | 0/1 | 1/4 (1) | 2/4 |
| allergen | lupin | 0/12 | 0/12 | 0/12 (1) | 0/12 | 2/12 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| allergen | molluscs | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |

## Before and after: every difference

Each pair compares two cells. A count is answers over the answers that judged the case, summed over
every run of the cell (typed repeats; plate runs). A row is listed when the two rates differ. A
source only one of the two cells holds is left out.

### D (3.5 flash lite EU, minimal, production prompt) against D3 (3.5 flash lite EU, minimal, v3 prompt)

| source | cell | answers | clear preg miss | not clear preg miss | clear alg miss | not clear alg miss | demotions clear / not | preg false alarms (distinct) | alg false alarms (distinct) | extra preg per answer | extra alg per answer | failed calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| typed | D | 265 | 8 | 5 | 0 | 2 | 3 / 6 | 4 (2) | 3 (1) | 0.019 | 0.80 | 2 |
| typed | D3 | 266 | 0 | 5 | 2 | 0 | 1 / 6 | 6 (4) | 1 (1) | 0.079 | 0.55 | 1 |
| plates | D | 50 | 1 | 1 | 3 | 1 | 1 / 2 | 1 (1) | 0 (0) | 0.120 | 1.58 | 0 |
| plates | D3 | 149 | 2 | 3 | 5 | 5 | 6 / 8 | 10 (4) | 0 (0) | 0.557 | 1.98 | 1 |

Entries whose rate differs (48):

| source | case | text | list | gold item | flag | clear | way | D | D3 |
|---|---|---|---|---|---|---|---|---|---|
| plates | 05 | Chicken in creamy leafy-green sauce with white rice | must_flag | chicken pieces in creamy sauce with leafy greens (spinach-type) | allergen milk | no | missed | 1/1 | 1/3 |
| plates | 05 | Chicken in creamy leafy-green sauce with white rice | must_flag | chicken pieces in creamy sauce with leafy greens (spinach-type) | allergen milk | no | demoted | 0/1 | 2/3 |
| plates | 08 | Yogurt granola bowl with apple | if_listed | raisins/dried fruit in granola | allergen sulphites | no | missed | 0/1 | 1/3 |
| plates | 11 | Wiener Schnitzel with fries and side salad | must_flag | breaded fried schnitzel (pork/veal cutlet) | allergen eggs | no | demoted | 1/1 | 0/3 |
| plates | 12 | Bratwurst plate with sauerkraut and mashed potatoes | if_listed | mustard/onion-gravy drizzle on the sausages | allergen mustard | no | demoted | 0/1 | 2/3 |
| plates | 22 | Three soft tacos with a corn cob | if_listed | glass of cola | pregnancy caffeine | no | missed | 1/1 | 2/3 |
| plates | 29 | Tapas/snack flight with a wheat beer | if_listed | creamy dip/cream cheese with the pickles | allergen milk | yes | missed | 0/1 | 1/3 |
| plates | 33 | Bowl of oatmeal porridge with toppings | must_flag | milk | allergen milk | yes | demoted | 0/1 | 1/3 |
| plates | 33 | Bowl of oatmeal porridge with toppings | must_flag | oatmeal/oat porridge | allergen gluten | yes | demoted | 0/1 | 1/3 |
| plates | 36 | Seafood paella in the pan | must_not_flag | mantis shrimp (galeras) | pregnancy raw-fish | yes | flagged | 0/1 | 3/3 |
| plates | 36 | Seafood paella in the pan | must_not_flag | whole prawns (langostinos) | pregnancy raw-fish | yes | flagged | 0/1 | 3/3 |
| plates | 37 | Pierogi ruskie with carrot-cabbage salad | must_flag | pierogi/boiled dumplings (potato-cheese filling) | allergen milk | yes | demoted | 0/1 | 2/3 |
| plates | 40 | Half-eaten liver-and-bacon fry-up with chips | must_flag | fried egg (remnant, yolk visible) | pregnancy raw-egg | no | missed | 0/1 | 1/3 |
| plates | 42 | Buffet lunch plate (many components) | must_flag | sour cream / remoulade dollop | allergen milk | no | missed | 0/1 | 2/3 |
| plates | 42 | Buffet lunch plate (many components) | must_flag | sour cream / remoulade dollop | allergen milk | no | demoted | 0/1 | 1/3 |
| plates | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | must_flag | sliced raw fish (hoe/sashimi) on shredded radish | allergen fish | yes | missed | 0/1 | 1/3 |
| plates | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | must_flag | sliced raw fish (hoe/sashimi) on shredded radish | pregnancy raw-fish | yes | missed | 0/1 | 1/3 |
| plates | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | must_not_flag | steamed egg (gyeranjjim) in stone pot | pregnancy raw-egg | yes | flagged | 0/1 | 1/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | cherry tomato salad with balsamic drizzle | allergen sulphites | no | missed | 0/1 | 1/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | eggs benedict with hollandaise on avocado toast | allergen eggs | yes | missed | 1/1 | 1/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | eggs benedict with hollandaise on avocado toast | allergen gluten | yes | missed | 1/1 | 1/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | eggs benedict with hollandaise on avocado toast | allergen milk | yes | missed | 1/1 | 1/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | eggs benedict with hollandaise on avocado toast | pregnancy raw-egg | yes | missed | 1/1 | 1/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | yogurt bowl with granola, kiwi slices and berry compote | allergen gluten | yes | demoted | 0/1 | 1/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | yogurt bowl with granola, kiwi slices and berry compote | allergen milk | yes | demoted | 1/1 | 1/3 |
| typed | t022 | 500 g Miesmuscheln in Weißweinsud | must_not_flag | mussels in white wine broth | pregnancy raw-fish | yes | flagged | 0/3 | 1/3 |
| typed | t030 | 3 Scheiben Kochschinken | must_not_flag | cooked ham | pregnancy raw-meat | yes | flagged | 0/3 | 1/3 |
| typed | t045 | Brie and grape sandwich on sourdough | must_flag | brie and grape sandwich | pregnancy soft-cheese | yes | missed | 1/3 | 0/3 |
| typed | t050 | Chicken liver pate on toast | must_flag | chicken liver pate on toast | pregnancy raw-meat | yes | missed | 3/3 | 0/3 |
| typed | t052 | Pad Thai with shrimp, topped with raw bean sprouts and crushed peanuts | must_flag | shrimp pad Thai | allergen fish | no | demoted | 2/3 | 3/3 |
| typed | t055 | 40 g of Comté | must_flag | Comté cheese | pregnancy raw-dairy | no | missed | 2/3 | 3/3 |
| typed | t056 | 2 slices of mature cheddar | must_not_flag | mature cheddar | pregnancy soft-cheese | yes | flagged | 0/3 | 1/3 |
| typed | t061 | A Big Mac and medium fries | must_flag | Big Mac | allergen mustard | no | missed | 2/3 | 0/3 |
| typed | t063 | A bowl of miso soup | must_flag | miso soup | allergen fish | no | demoted | 1/3 | 0/3 |
| typed | t068 | 150 g plant-based coconut yogurt (dairy-free) | must_not_flag | coconut yogurt | allergen nuts | yes | flagged | 3/3 | 1/3 |
| typed | t075 | A granola bar, 1 bar (35 g), oats, hazelnuts and honey | must_flag | granola bar | allergen gluten | yes | demoted | 0/3 | 1/3 |
| typed | t078 | Un verre de vin blanc et un morceau de Roquefort | must_flag | Roquefort | pregnancy raw-dairy | no | missed | 0/3 | 2/3 |
| typed | t080 | Foie gras mi-cuit sur pain d'épices | must_flag | foie gras mi-cuit | pregnancy liver-retinol | yes | missed | 1/3 | 0/3 |
| typed | t080 | Foie gras mi-cuit sur pain d'épices | must_flag | foie gras mi-cuit | pregnancy raw-meat | no | missed | 3/3 | 0/3 |
| typed | t083 | Un piatto di spaghetti alle vongole | must_not_flag | spaghetti with clams | pregnancy raw-fish | yes | flagged | 1/3 | 0/3 |
| typed | t084 | Vitello tonnato, una porzione | must_flag | vitello tonnato | pregnancy high-mercury-fish | yes | missed | 3/3 | 0/3 |
| typed | t085 | Una tapa de altramuces y una caña | must_flag | lupini beans | allergen lupin | yes | missed | 0/3 | 2/3 |
| typed | t085 | Una tapa de altramuces y una caña | must_flag | lupini beans | allergen lupin | yes | demoted | 1/3 | 0/3 |
| typed | t087 | Gambas al ajillo y una copa de vino tinto | must_flag | red wine | allergen sulphites | yes | demoted | 2/3 | 0/3 |
| plates | 23 | Smothered beef burrito | call |  |   | yes | failed call | 0/1 | 1/3 |
| typed | t039 | Käsespätzle mit Röstzwiebeln | call |  |   | yes | failed call | 0/3 | 1/3 |
| typed | t072 | Rare ribeye steak, 250 g | call |  |   | yes | failed call | 1/3 | 0/3 |
| typed | t079 | Un steak tartare avec un jaune d'oeuf cru, et des frites | call |  |   | yes | failed call | 1/3 | 0/3 |

Pregnancy flags no gold list judges (extras), D against D3. Neither credit nor error;
listed so a person can judge whether a new prompt adds false alarms.

| source | case | gold item(s) the model item holds | flag | D | D3 |
|---|---|---|---|---|---|
| plates | 02 | Yorkshire pudding | raw-egg | 0/1 | 1/3 |
| plates | 06 | sushi rolls (salmon+avocado uramaki, sesame) | high-mercury-fish | 0/1 | 1/3 |
| plates | 10 | club/toasted sandwich (multi-layer, creamy chicken/seafood filling) + green side salad (rocket/mixed leaves) | raw-egg | 0/1 | 1/3 |
| plates | 11 | breaded fried schnitzel (pork/veal cutlet) | high-mercury-fish | 0/1 | 1/3 |
| plates | 13 | side plate of iceberg lettuce salad with tomato and onion (separate plate behind) | raw-egg | 0/1 | 2/3 |
| plates | 13 | side plate of iceberg lettuce salad with tomato and onion (separate plate behind) | raw-sprouts | 0/1 | 2/3 |
| plates | 15 | Weisswurst sausages in hot water | raw-meat | 0/1 | 3/3 |
| plates | 16 | side salad (lettuce, tomato, cucumber, red onion) with dressing | raw-sprouts | 0/1 | 2/3 |
| plates | 18 | Maultaschen (filled pasta pockets with meat filling) + potato salad + bacon/speck bits in the potato salad | raw-meat | 0/1 | 1/3 |
| plates | 19 | gyros/döner sliced meat | raw-meat | 1/1 | 1/3 |
| plates | 19 | sliced sausage in curry/shashlik sauce | raw-meat | 0/1 | 1/3 |
| plates | 19 | tzatziki/garlic yogurt sauce | raw-dairy | 1/1 | 3/3 |
| plates | 25 | back bacon rashers | raw-meat | 0/1 | 3/3 |
| plates | 25 | breakfast sausages | raw-meat | 0/1 | 2/3 |
| plates | 25 | butter packet | raw-dairy | 0/1 | 3/3 |
| plates | 25 | pancakes with icing sugar | raw-egg | 0/1 | 3/3 |
| plates | 28 | falafel balls + hummus/creamy white dip + yellow bulgur or couscous + black beluga lentils | raw-sprouts | 0/1 | 3/3 |
| plates | 29 | pickled gherkin slices + creamy dip/cream cheese with the pickles | raw-egg | 0/1 | 1/3 |
| plates | 31 | buttered bread slices (dark/whole-grain) | raw-dairy | 0/1 | 1/3 |
| plates | 32 | cheese slices | soft-cheese | 1/1 | 1/3 |
| plates | 37 | grated carrot and cabbage salad | raw-sprouts | 0/1 | 1/3 |
| plates | 37 | pierogi/boiled dumplings (potato-cheese filling) + fried caramelised onion topping | raw-sprouts | 0/1 | 2/3 |
| plates | 39 | bacon rasher | raw-meat | 0/1 | 3/3 |
| plates | 39 | sausage pieces | raw-meat | 0/1 | 3/3 |
| plates | 40 | bacon/gammon slice | raw-meat | 0/1 | 1/3 |
| plates | 40 | bacon/gammon slice + fried egg (remnant, yolk visible) | raw-meat | 0/1 | 1/3 |
| plates | 40 | sausage | raw-meat | 0/1 | 1/3 |
| plates | 41 | battered fried fish (cod), partly eaten | raw-egg | 0/1 | 1/3 |
| plates | 42 | breaded fried fish fillet + sour cream / remoulade dollop | raw-egg | 0/1 | 3/3 |
| plates | 42 | meatballs in brown gravy | raw-egg | 0/1 | 1/3 |
| plates | 42 | meatballs in brown gravy | raw-meat | 0/1 | 2/3 |
| plates | 43 | breaded croquettes/fish cakes topped with mayonnaise-aioli | raw-egg | 0/1 | 3/3 |
| plates | 43 | breaded croquettes/fish cakes topped with mayonnaise-aioli + herbed green rice + green beans + cheese-topped quiche/gratin square + creamy meat-and-vegetable stew | raw-egg | 1/1 | 0/3 |
| plates | 43 | cheese-topped quiche/gratin square | raw-meat | 0/1 | 1/3 |
| plates | 43 | creamy meat-and-vegetable stew | raw-meat | 0/1 | 2/3 |
| plates | 43 | creamy soup (bowl, with bacon bits) | raw-meat | 0/1 | 3/3 |
| plates | 44 | green salad (lettuce, grated carrot, coriander) | raw-sprouts | 1/1 | 0/3 |
| plates | 45 | stir-fried beef in a hot stone pot | raw-meat | 0/1 | 1/3 |
| plates | 47 | avocado toast/bagel halves with poached eggs | raw-sprouts | 0/1 | 3/3 |
| plates | 47 | beetroot latte | caffeine | 0/1 | 2/3 |
| plates | 47 | cherry tomato salad with balsamic drizzle + seeded bagel (dark, sesame-topped) | raw-sprouts | 0/1 | 1/3 |
| plates | 47 | eggs benedict with hollandaise on avocado toast | raw-sprouts | 0/1 | 2/3 |
| plates | 47 | seeded bagel (dark, sesame-topped) | raw-sprouts | 0/1 | 2/3 |
| plates | 47 | yogurt bowl with granola, kiwi slices and berry compote | raw-dairy | 0/1 | 1/3 |
| plates | 47 | yogurt bowl with granola, kiwi slices and berry compote | raw-sprouts | 0/1 | 1/3 |
| plates | 48 | cucumber sandwich (white bread triangle) | raw-dairy | 0/1 | 1/3 |
| plates | 48 | cucumber sandwich (white bread triangle) | raw-meat | 0/1 | 2/3 |
| plates | 48 | slice of white/vanilla cake with icing, partly eaten | raw-egg | 1/1 | 3/3 |
| typed | t007 | green salad | raw-sprouts | 0/3 | 1/3 |
| typed | t007 | tuna steak | raw-meat | 1/3 | 0/3 |
| typed | t018 | Leberkäse roll | raw-meat | 0/3 | 2/3 |
| typed | t024 | bratwurst | raw-meat | 0/3 | 3/3 |
| typed | t041 | salmon poke bowl | high-mercury-fish | 0/3 | 3/3 |
| typed | t043 | blinis | raw-egg | 1/3 | 3/3 |
| typed | t043 | crème fraîche | raw-dairy | 1/3 | 0/3 |
| typed | t046 | chicken Caesar salad | raw-meat | 0/3 | 1/3 |
| typed | t047 | eggs Benedict | raw-meat | 0/3 | 3/3 |
| typed | t073 | raw cookie dough | raw-meat | 0/3 | 2/3 |
| typed | t082 | custard croissant | raw-egg | 1/3 | 2/3 |
| typed | t090 | stuffed mussels | high-mercury-fish | 1/3 | 1/3 |

### C (3.8, reasoning minimal, production prompt) against C3 (3.8, reasoning minimal, v3 prompt)

| source | cell | answers | clear preg miss | not clear preg miss | clear alg miss | not clear alg miss | demotions clear / not | preg false alarms (distinct) | alg false alarms (distinct) | extra preg per answer | extra alg per answer | failed calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| typed | C | 267 | 1 | 0 | 0 | 0 | 0 / 6 | 4 (2) | 3 (1) | 0.015 | 0.84 | 0 |
| typed | C3 | 267 | 0 | 0 | 0 | 0 | 0 / 6 | 3 (1) | 3 (1) | 0.019 | 0.76 | 0 |
| plates | C | 50 | 1 | 0 | 1 | 2 | 5 / 4 | 1 (1) | 0 (0) | 0.020 | 3.02 | 0 |
| plates | C3 | 100 | 0 | 0 | 2 | 1 | 10 / 7 | 2 (1) | 0 (0) | 0.120 | 3.07 | 0 |

Entries whose rate differs (18):

| source | case | text | list | gold item | flag | clear | way | C | C3 |
|---|---|---|---|---|---|---|---|---|---|
| plates | 03 | Greek-style salad with grilled salmon | must_not_flag | feta cheese | pregnancy soft-cheese | yes | flagged | 0/1 | 2/2 |
| plates | 06 | Sushi platter (restaurant table) | must_flag | soy sauce | allergen soybeans | yes | missed | 0/1 | 1/2 |
| plates | 29 | Tapas/snack flight with a wheat beer | if_listed | creamy dip/cream cheese with the pickles | allergen milk | yes | demoted | 0/1 | 2/2 |
| plates | 32 | Charcuterie/snack board (compartmented bamboo tray, top-down) | must_not_flag | pan-fried spiced hard-boiled egg halves | pregnancy raw-egg | yes | flagged | 1/1 | 0/2 |
| plates | 33 | Bowl of oatmeal porridge with toppings | must_flag | milk | allergen milk | yes | missed | 0/1 | 1/2 |
| plates | 33 | Bowl of oatmeal porridge with toppings | must_flag | milk | allergen milk | yes | demoted | 1/1 | 1/2 |
| plates | 35 | Gyros/döner plate with fries and salad | if_listed | pickled green chili pepper | allergen sulphites | no | demoted | 0/1 | 1/2 |
| plates | 38 | Half-eaten beefburger with fries | if_listed | cheese slice in burger | allergen milk | yes | demoted | 0/1 | 1/2 |
| plates | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | must_flag | grilled mackerel/fish | allergen fish | yes | missed | 1/1 | 0/2 |
| plates | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | must_flag | sliced raw fish (hoe/sashimi) on shredded radish | allergen fish | yes | demoted | 1/1 | 0/2 |
| plates | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | must_flag | sliced raw fish (hoe/sashimi) on shredded radish | pregnancy raw-fish | yes | missed | 1/1 | 0/2 |
| plates | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | must_flag | vegetable fritters/jeon platter | allergen eggs | no | missed | 1/1 | 0/2 |
| plates | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | must_flag | vegetable fritters/jeon platter | allergen gluten | no | demoted | 1/1 | 0/2 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | cherry tomato salad with balsamic drizzle | allergen sulphites | no | missed | 1/1 | 1/2 |
| typed | t023 | Eine Portion Waldorfsalat | must_flag | Waldorf salad | allergen eggs | no | demoted | 0/3 | 3/3 |
| typed | t031 | 125 g Mozzarella, 2 Tomaten und etwas Basilikum | must_not_flag | mozzarella | pregnancy soft-cheese | yes | flagged | 1/3 | 0/3 |
| typed | t050 | Chicken liver pate on toast | must_flag | chicken liver pate on toast | pregnancy raw-meat | yes | missed | 1/3 | 0/3 |
| typed | t063 | A bowl of miso soup | must_flag | miso soup | allergen fish | no | demoted | 3/3 | 0/3 |

Pregnancy flags no gold list judges (extras), C against C3. Neither credit nor error;
listed so a person can judge whether a new prompt adds false alarms.

| source | case | gold item(s) the model item holds | flag | C | C3 |
|---|---|---|---|---|---|
| plates | 13 | side plate of iceberg lettuce salad with tomato and onion (separate plate behind) | raw-egg | 0/1 | 2/2 |
| plates | 29 | pickled gherkin slices + creamy dip/cream cheese with the pickles | raw-egg | 0/1 | 1/2 |
| plates | 37 | grated carrot and cabbage salad | raw-sprouts | 1/1 | 0/2 |
| plates | 43 | breaded croquettes/fish cakes topped with mayonnaise-aioli | raw-egg | 0/1 | 1/2 |
| plates | 47 | avocado toast/bagel halves with poached eggs + cherry tomato salad with balsamic drizzle | raw-sprouts | 0/1 | 1/2 |
| plates | 47 | avocado toast/bagel halves with poached eggs + eggs benedict with hollandaise on avocado toast | raw-sprouts | 0/1 | 2/2 |
| plates | 47 | avocado toast/bagel halves with poached eggs + seeded bagel (dark, sesame-topped) | raw-sprouts | 0/1 | 1/2 |
| plates | 47 | eggs benedict with hollandaise on avocado toast + cherry tomato salad with balsamic drizzle | raw-sprouts | 0/1 | 1/2 |
| plates | 47 | seeded bagel (dark, sesame-topped) | raw-sprouts | 0/1 | 1/2 |
| plates | 48 | cucumber sandwich (white bread triangle) | raw-egg | 0/1 | 2/2 |
| typed | t021 | prawn cocktail | alcohol | 3/3 | 3/3 |
| typed | t043 | crème fraîche | raw-dairy | 1/3 | 2/3 |

### D2 (3.5 flash lite EU, minimal, v2 photo prompt, plates only) against D3 (3.5 flash lite EU, minimal, v3 prompt)

| source | cell | answers | clear preg miss | not clear preg miss | clear alg miss | not clear alg miss | demotions clear / not | preg false alarms (distinct) | alg false alarms (distinct) | extra preg per answer | extra alg per answer | failed calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| plates | D2 | 50 | 2 | 3 | 1 | 0 | 2 / 3 | 1 (1) | 0 (0) | 0.120 | 1.54 | 0 |
| plates | D3 | 149 | 2 | 3 | 5 | 5 | 6 / 8 | 10 (4) | 0 (0) | 0.557 | 1.98 | 1 |

Entries whose rate differs (31):

| source | case | text | list | gold item | flag | clear | way | D2 | D3 |
|---|---|---|---|---|---|---|---|---|---|
| plates | 03 | Greek-style salad with grilled salmon | must_not_flag | feta cheese | pregnancy soft-cheese | yes | flagged | 1/1 | 0/3 |
| plates | 05 | Chicken in creamy leafy-green sauce with white rice | must_flag | chicken pieces in creamy sauce with leafy greens (spinach-type) | allergen milk | no | missed | 0/1 | 1/3 |
| plates | 05 | Chicken in creamy leafy-green sauce with white rice | must_flag | chicken pieces in creamy sauce with leafy greens (spinach-type) | allergen milk | no | demoted | 1/1 | 2/3 |
| plates | 08 | Yogurt granola bowl with apple | if_listed | raisins/dried fruit in granola | allergen sulphites | no | missed | 0/1 | 1/3 |
| plates | 12 | Bratwurst plate with sauerkraut and mashed potatoes | if_listed | mustard/onion-gravy drizzle on the sausages | allergen mustard | no | demoted | 1/1 | 2/3 |
| plates | 22 | Three soft tacos with a corn cob | if_listed | glass of cola | pregnancy caffeine | no | missed | 1/1 | 2/3 |
| plates | 25 | American breakfast platter | must_flag | fried egg (sunny side up) | pregnancy raw-egg | yes | missed | 1/1 | 0/3 |
| plates | 29 | Tapas/snack flight with a wheat beer | if_listed | creamy dip/cream cheese with the pickles | allergen milk | yes | missed | 0/1 | 1/3 |
| plates | 32 | Charcuterie/snack board (compartmented bamboo tray, top-down) | must_not_flag | pan-fried spiced hard-boiled egg halves | pregnancy raw-egg | yes | flagged | 0/1 | 3/3 |
| plates | 33 | Bowl of oatmeal porridge with toppings | must_flag | milk | allergen milk | yes | demoted | 1/1 | 1/3 |
| plates | 33 | Bowl of oatmeal porridge with toppings | must_flag | oatmeal/oat porridge | allergen gluten | yes | demoted | 0/1 | 1/3 |
| plates | 36 | Seafood paella in the pan | must_not_flag | mantis shrimp (galeras) | pregnancy raw-fish | yes | flagged | 0/1 | 3/3 |
| plates | 36 | Seafood paella in the pan | must_not_flag | whole prawns (langostinos) | pregnancy raw-fish | yes | flagged | 0/1 | 3/3 |
| plates | 37 | Pierogi ruskie with carrot-cabbage salad | must_flag | pierogi/boiled dumplings (potato-cheese filling) | allergen milk | yes | demoted | 1/1 | 2/3 |
| plates | 40 | Half-eaten liver-and-bacon fry-up with chips | must_flag | fried egg (remnant, yolk visible) | pregnancy raw-egg | no | missed | 1/1 | 1/3 |
| plates | 40 | Half-eaten liver-and-bacon fry-up with chips | must_flag | liver pieces in gravy | pregnancy liver-retinol | yes | missed | 1/1 | 0/3 |
| plates | 42 | Buffet lunch plate (many components) | must_flag | sour cream / remoulade dollop | allergen milk | no | missed | 0/1 | 2/3 |
| plates | 42 | Buffet lunch plate (many components) | must_flag | sour cream / remoulade dollop | allergen milk | no | demoted | 0/1 | 1/3 |
| plates | 43 | Buffet lunch set, main plate, soup bowl, bread plate | must_flag | cheese-topped quiche/gratin square | allergen milk | yes | missed | 1/1 | 0/3 |
| plates | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | must_flag | sliced raw fish (hoe/sashimi) on shredded radish | allergen fish | yes | missed | 0/1 | 1/3 |
| plates | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | must_flag | sliced raw fish (hoe/sashimi) on shredded radish | pregnancy raw-fish | yes | missed | 0/1 | 1/3 |
| plates | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | must_not_flag | steamed egg (gyeranjjim) in stone pot | pregnancy raw-egg | yes | flagged | 0/1 | 1/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | avocado toast/bagel halves with poached eggs | pregnancy raw-egg | no | missed | 1/1 | 0/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | cherry tomato salad with balsamic drizzle | allergen sulphites | no | missed | 0/1 | 1/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | eggs benedict with hollandaise on avocado toast | allergen eggs | yes | missed | 0/1 | 1/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | eggs benedict with hollandaise on avocado toast | allergen gluten | yes | missed | 0/1 | 1/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | eggs benedict with hollandaise on avocado toast | allergen milk | yes | missed | 0/1 | 1/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | eggs benedict with hollandaise on avocado toast | pregnancy raw-egg | yes | missed | 0/1 | 1/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | yogurt bowl with granola, kiwi slices and berry compote | allergen gluten | yes | demoted | 0/1 | 1/3 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | yogurt bowl with granola, kiwi slices and berry compote | allergen milk | yes | demoted | 0/1 | 1/3 |
| plates | 23 | Smothered beef burrito | call |  |   | yes | failed call | 0/1 | 1/3 |

Pregnancy flags no gold list judges (extras), D2 against D3. Neither credit nor error;
listed so a person can judge whether a new prompt adds false alarms.

| source | case | gold item(s) the model item holds | flag | D2 | D3 |
|---|---|---|---|---|---|
| plates | 02 | Yorkshire pudding | raw-egg | 0/1 | 1/3 |
| plates | 06 | sushi rolls (salmon+avocado uramaki, sesame) | high-mercury-fish | 0/1 | 1/3 |
| plates | 10 | club/toasted sandwich (multi-layer, creamy chicken/seafood filling) + green side salad (rocket/mixed leaves) | raw-egg | 0/1 | 1/3 |
| plates | 11 | breaded fried schnitzel (pork/veal cutlet) | high-mercury-fish | 0/1 | 1/3 |
| plates | 13 | side plate of iceberg lettuce salad with tomato and onion (separate plate behind) | raw-egg | 0/1 | 2/3 |
| plates | 13 | side plate of iceberg lettuce salad with tomato and onion (separate plate behind) | raw-sprouts | 0/1 | 2/3 |
| plates | 15 | Weisswurst sausages in hot water | raw-meat | 0/1 | 3/3 |
| plates | 16 | side salad (lettuce, tomato, cucumber, red onion) with dressing | raw-sprouts | 1/1 | 2/3 |
| plates | 18 | Maultaschen (filled pasta pockets with meat filling) + potato salad + bacon/speck bits in the potato salad | raw-meat | 0/1 | 1/3 |
| plates | 19 | gyros/döner sliced meat | raw-meat | 0/1 | 1/3 |
| plates | 19 | gyros/döner sliced meat + tzatziki/garlic yogurt sauce | raw-dairy | 1/1 | 0/3 |
| plates | 19 | sliced sausage in curry/shashlik sauce | raw-meat | 0/1 | 1/3 |
| plates | 19 | tzatziki/garlic yogurt sauce | raw-dairy | 0/1 | 3/3 |
| plates | 25 | back bacon rashers | raw-meat | 0/1 | 3/3 |
| plates | 25 | breakfast sausages | raw-meat | 0/1 | 2/3 |
| plates | 25 | butter packet | raw-dairy | 0/1 | 3/3 |
| plates | 25 | pancakes with icing sugar | raw-egg | 0/1 | 3/3 |
| plates | 28 | falafel balls + hummus/creamy white dip + yellow bulgur or couscous + black beluga lentils | raw-sprouts | 0/1 | 3/3 |
| plates | 29 | pickled gherkin slices + creamy dip/cream cheese with the pickles | raw-egg | 0/1 | 1/3 |
| plates | 31 | buttered bread slices (dark/whole-grain) | raw-dairy | 0/1 | 1/3 |
| plates | 32 | cheese slices | soft-cheese | 0/1 | 1/3 |
| plates | 37 | grated carrot and cabbage salad | raw-sprouts | 0/1 | 1/3 |
| plates | 37 | pierogi/boiled dumplings (potato-cheese filling) + fried caramelised onion topping | raw-sprouts | 0/1 | 2/3 |
| plates | 39 | bacon rasher | raw-meat | 1/1 | 3/3 |
| plates | 39 | sausage pieces | raw-meat | 1/1 | 3/3 |
| plates | 40 | bacon/gammon slice | raw-meat | 0/1 | 1/3 |
| plates | 40 | bacon/gammon slice + fried egg (remnant, yolk visible) | raw-meat | 0/1 | 1/3 |
| plates | 40 | sausage | raw-meat | 0/1 | 1/3 |
| plates | 41 | battered fried fish (cod), partly eaten | raw-egg | 0/1 | 1/3 |
| plates | 42 | breaded fried fish fillet + sour cream / remoulade dollop | raw-egg | 0/1 | 3/3 |
| plates | 42 | meatballs in brown gravy | raw-egg | 0/1 | 1/3 |
| plates | 42 | meatballs in brown gravy | raw-meat | 0/1 | 2/3 |
| plates | 43 | breaded croquettes/fish cakes topped with mayonnaise-aioli | raw-egg | 0/1 | 3/3 |
| plates | 43 | cheese-topped quiche/gratin square | raw-meat | 0/1 | 1/3 |
| plates | 43 | creamy meat-and-vegetable stew | raw-meat | 0/1 | 2/3 |
| plates | 43 | creamy soup (bowl, with bacon bits) | raw-meat | 0/1 | 3/3 |
| plates | 45 | stir-fried beef in a hot stone pot | raw-meat | 1/1 | 1/3 |
| plates | 47 | avocado toast/bagel halves with poached eggs | raw-sprouts | 0/1 | 3/3 |
| plates | 47 | beetroot latte | caffeine | 0/1 | 2/3 |
| plates | 47 | cherry tomato salad with balsamic drizzle + seeded bagel (dark, sesame-topped) | raw-sprouts | 0/1 | 1/3 |
| plates | 47 | eggs benedict with hollandaise on avocado toast | raw-sprouts | 0/1 | 2/3 |
| plates | 47 | seeded bagel (dark, sesame-topped) | raw-sprouts | 0/1 | 2/3 |
| plates | 47 | yogurt bowl with granola, kiwi slices and berry compote | raw-dairy | 0/1 | 1/3 |
| plates | 47 | yogurt bowl with granola, kiwi slices and berry compote | raw-sprouts | 0/1 | 1/3 |
| plates | 48 | cucumber sandwich (white bread triangle) | raw-dairy | 0/1 | 1/3 |
| plates | 48 | cucumber sandwich (white bread triangle) | raw-meat | 0/1 | 2/3 |
| plates | 48 | slice of white/vanilla cake with icing, partly eaten | raw-egg | 1/1 | 3/3 |

### C2 (3.8, reasoning minimal, v2 photo prompt, plates only) against C3 (3.8, reasoning minimal, v3 prompt)

| source | cell | answers | clear preg miss | not clear preg miss | clear alg miss | not clear alg miss | demotions clear / not | preg false alarms (distinct) | alg false alarms (distinct) | extra preg per answer | extra alg per answer | failed calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| plates | C2 | 50 | 0 | 0 | 0 | 1 | 4 / 3 | 1 (1) | 0 (0) | 0.080 | 2.86 | 0 |
| plates | C3 | 100 | 0 | 0 | 2 | 1 | 10 / 7 | 2 (1) | 0 (0) | 0.120 | 3.07 | 0 |

Entries whose rate differs (7):

| source | case | text | list | gold item | flag | clear | way | C2 | C3 |
|---|---|---|---|---|---|---|---|---|---|
| plates | 06 | Sushi platter (restaurant table) | must_flag | soy sauce | allergen soybeans | yes | missed | 0/1 | 1/2 |
| plates | 33 | Bowl of oatmeal porridge with toppings | must_flag | milk | allergen milk | yes | missed | 0/1 | 1/2 |
| plates | 33 | Bowl of oatmeal porridge with toppings | must_flag | milk | allergen milk | yes | demoted | 1/1 | 1/2 |
| plates | 35 | Gyros/döner plate with fries and salad | if_listed | pickled green chili pepper | allergen sulphites | no | demoted | 0/1 | 1/2 |
| plates | 37 | Pierogi ruskie with carrot-cabbage salad | must_flag | pierogi/boiled dumplings (potato-cheese filling) | allergen milk | yes | demoted | 0/1 | 2/2 |
| plates | 38 | Half-eaten beefburger with fries | if_listed | cheese slice in burger | allergen milk | yes | demoted | 0/1 | 1/2 |
| plates | 47 | Café brunch table spread (top-down) | must_flag | cherry tomato salad with balsamic drizzle | allergen sulphites | no | missed | 1/1 | 1/2 |

Pregnancy flags no gold list judges (extras), C2 against C3. Neither credit nor error;
listed so a person can judge whether a new prompt adds false alarms.

| source | case | gold item(s) the model item holds | flag | C2 | C3 |
|---|---|---|---|---|---|
| plates | 13 | side plate of iceberg lettuce salad with tomato and onion (separate plate behind) | raw-egg | 1/1 | 2/2 |
| plates | 29 | pickled gherkin slices + creamy dip/cream cheese with the pickles | raw-egg | 0/1 | 1/2 |
| plates | 43 | breaded croquettes/fish cakes topped with mayonnaise-aioli | raw-egg | 0/1 | 1/2 |
| plates | 47 | avocado toast/bagel halves with poached eggs + cherry tomato salad with balsamic drizzle | raw-sprouts | 1/1 | 1/2 |
| plates | 47 | avocado toast/bagel halves with poached eggs + eggs benedict with hollandaise on avocado toast | raw-sprouts | 0/1 | 2/2 |
| plates | 47 | avocado toast/bagel halves with poached eggs + seeded bagel (dark, sesame-topped) | raw-sprouts | 0/1 | 1/2 |
| plates | 47 | cherry tomato salad with balsamic drizzle + seeded bagel (dark, sesame-topped) | raw-sprouts | 1/1 | 0/2 |
| plates | 47 | eggs benedict with hollandaise on avocado toast + cherry tomato salad with balsamic drizzle | raw-sprouts | 1/1 | 1/2 |
| plates | 47 | seeded bagel (dark, sesame-topped) | raw-sprouts | 0/1 | 1/2 |
| plates | 48 | cucumber sandwich (white bread triangle) | raw-egg | 0/1 | 2/2 |

## Sanity: gold labels every cell contradicts the same way

Entries that B, C3 and D3 all contradict come first, then entries two of the three contradict (to fill
ten rows), each group ranked by the lowest rate among the contradicting cells (contradicting answers
over answers that judged the entry). The gold files are not changed here; a view is a proposal.

| cells | list | case | text | item | flag | clear | way | B | C3 | D3 | view |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 of 3 | must_flag | 32 | Charcuterie/snack board (compartmented bamboo tray, top-down) | herb crackers | allergen sesame | no | demoted to mayContain | 1/1 | 2/2 | 3/3 | Gold arguable, already clear:false. Herb crackers do not plainly hold sesame. Proposal: move to may_flag; mayContain is the honest list. |
| 3 of 3 | must_flag | t071 | some curry from the place downstairs | curry | allergen nuts | no | demoted to mayContain | 3/3 | 3/3 | 3/3 | Unknown curry: mayContain is the honest list, and it shows a chip. Proposal: accept mayContain as the expected list (no demotion). |
| 3 of 3 | must_flag | 05 | Chicken in creamy leafy-green sauce with white rice | chicken pieces in creamy sauce with leafy greens (spinach-type) | allergen milk | no | demoted to mayContain | 1/1 | 2/2 | 2/3 | The cream may be coconut milk. clear:false is right; mayContain is a fair answer. No change. |
| 3 of 3 | must_flag | 37 | Pierogi ruskie with carrot-cabbage salad | pierogi/boiled dumplings (potato-cheese filling) | allergen milk | yes | demoted to mayContain | 1/1 | 2/2 | 2/3 | Gold right: pierogi ruskie hold quark. The cells hedge. No change. |
| 3 of 3 | must_flag | 42 | Buffet lunch plate (many components) | sour cream / remoulade dollop | allergen milk | no | demoted to mayContain | 1/1 | 2/2 | 1/3 | Remoulade is egg and oil, not milk. clear:false is right. Proposal: move to may_flag. |
| 3 of 3 | must_flag | 47 | Café brunch table spread (top-down) | yogurt bowl with granola, kiwi slices and berry compote | allergen milk | yes | demoted to mayContain | 1/1 | 2/2 | 1/3 | All cells read the bowl as a smoothie or acai bowl, so they hedge milk. The photo cannot prove a yogurt base. Proposal: set clear:false. The chip still shows. |
| 3 of 3 | must_not_flag | t068 | 150 g plant-based coconut yogurt (dairy-free) | coconut yogurt | allergen nuts | yes | flagged although must_not_flag | 3/3 | 3/3 | 1/3 | Coconut is not an EU Annex II nut, so nuts in `allergens` is wrong. In mayContain it is a cross-contact hedge. Proposal: keep must_not for `allergens`, accept nuts in mayContain. |
| 2 of 3 | must_not_flag | 03 | Greek-style salad with grilled salmon | feta cheese | pregnancy soft-cheese | yes | flagged although must_not_flag | 1/1 | 2/2 | 0/3 |  |
| 2 of 3 | must_not_flag | t089 | Kahvaltıda iki yumurtalı menemen ve beyaz peynir | white cheese | pregnancy soft-cheese | yes | flagged although must_not_flag | 3/3 | 3/3 | 0/3 | Gold right: beyaz peynir is brined, not mould-ripened or blue. A false alarm. No change. |
| 2 of 3 | must_flag | 06 | Sushi platter (restaurant table) | soy sauce | allergen soybeans | yes | missed | 1/1 | 1/2 | 0/3 |  |

