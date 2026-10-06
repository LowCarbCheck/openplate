# EU switch: candidate cells against 3.8 (fixed scorers) (2026-10-06)

Written by `python3 -m harness.score_flags --config configs/score-flags-candidates-MM.json`. No model call. The gold is
`gold/gold_text.jsonl` and `gold/gold_plate_flags.json`, read as `gold/GOLD-NOTES.md` section 2 says. The
machine readable twin of this file holds every entry, every holder and every flag.

Candidates L25 and MM, v3 prompt, EU host. References B and C3. Runs named worktree:directory live in a sibling worktree.

Legend for a model item: `P[...]` pregnancy, `A[...]` allergens, `M[...]` mayContain.

## Runs

| cell | label | typed repeats scored | plate run |
|---|---|---|---|
| B | 3.8, default reasoning, production prompt | eval-harness:text-eu-cell-38-newprompt-r1, eval-harness:text-eu-cell-38-newprompt-r2, eval-harness:text-eu-cell-38-newprompt-r3 | eval-harness:eu-cell-38-newprompt |
| C3 | 3.8, reasoning minimal, v3 prompt | prompt-v3:v3-text-eu-cell-38-minimal-newprompt-r1, prompt-v3:v3-text-eu-cell-38-minimal-newprompt-r2, prompt-v3:v3-text-eu-cell-38-minimal-newprompt-r3 | prompt-v3:v3-eu-cell-38-minimal-newprompt, prompt-v3:v3-eu-cell-38-minimal-newprompt-r2 |
| D3 | 3.5 flash lite EU, minimal, v3 prompt | prompt-v3:v3-text-eu-cell-35-eu-newprompt-r1, prompt-v3:v3-text-eu-cell-35-eu-newprompt-r2, prompt-v3:v3-text-eu-cell-35-eu-newprompt-r3 | prompt-v3:v3-eu-cell-35-eu-newprompt, prompt-v3:v3-eu-cell-35-eu-newprompt-r2, prompt-v3:v3-eu-cell-35-eu-newprompt-r3 |
| L25 | 2.5 flash lite, google-vertex/eu, minimal, v3 prompt | prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1, prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2, prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | prompt-v3:v3-eu-cell-25-lite-newprompt |
| MM | mistral medium 3.1, mistral/eu, no reasoning, v3 prompt | prompt-v3:v3-text-eu-cell-mistral-medium-newprompt-r1, prompt-v3:v3-text-eu-cell-mistral-medium-newprompt-r2, prompt-v3:v3-text-eu-cell-mistral-medium-newprompt-r3 | prompt-v3:v3-eu-cell-mistral-medium-newprompt |

## Reading (written by hand, kept when the file is written again)

(not written yet)


## Decision rules

Rule 2 needs the expected number of typed repeats (fewer is INCOMPLETE) and zero clear misses in each. Rules
3 and 4 PASS only when BOTH the clear-only totals and the all-entries totals (clear plus `clear: false`) of
the test cell are no higher than the ref's; both are printed. Typed misses are summed over the repeats
(scaled to 3 when a cell has fewer). A failed call is not a flag miss, but its must_flag entries are
counted as misses in a second line per rule; when that line gives another verdict, the rule is
INCONCLUSIVE. Beside the verdict, for a reader to judge: each distinct entry counted once; the misses on
listed items only; the plates read with the recall worksheet's listing; and the strict merge view (one flag
value on an item that holds several gold foods credits one entry). None of these four decides a rule.

| rule | test | verdict | clear entries | all entries | failed calls counted as misses | distinct entries | listed items only | worksheet listing | strict merge view |
|---|---|---|---|---|---|---|---|---|---|
| 2 | MM: zero misses on the clear pregnancy must-flag typed cases, in every repeat | **PASS** | misses per repeat [0, 0, 0]; distinct entries missed 0 | | failed calls left out (rule 1); their clear pregnancy entries per repeat [0, 0, 0]; counted as misses: PASS | | | | misses per repeat [0, 0, 0] (PASS) |
| 3 | MM total pregnancy misses (typed plus plates) no higher than B, clear entries AND all entries | **FAIL** | clear only: MM 3 vs B 0 (FAIL) | all entries: MM 4 vs B 0 (FAIL) | failed calls counted as misses: clear MM 3 vs B 1 (FAIL); all MM 4 vs B 3 (FAIL); verdict FAIL | MM 3 vs B 0 (FAIL) | MM 0 vs B 0 (PASS) | n/a: no filled worksheet for every plate run of MM | clear MM 5 vs B 2 (FAIL); all MM 6 vs B 2 (FAIL) |
| 3 | MM total pregnancy misses (typed plus plates) no higher than C3, clear entries AND all entries | **FAIL** | clear only: MM 3 vs C3 0 (FAIL) (plates: mean per plate run, MM 1 run(s) [3], C3 2 run(s) [0, 0]) | all entries: MM 4 vs C3 0 (FAIL) | failed calls counted as misses: clear MM 3 vs C3 0 (FAIL); all MM 4 vs C3 0 (FAIL); verdict FAIL | MM 3 vs C3 0 (FAIL) | MM 0 vs C3 0 (PASS) | n/a: no filled worksheet for every plate run of MM, C3 | clear MM 5 vs C3 1.5 (FAIL); all MM 6 vs C3 1.5 (FAIL) |
| 4 | MM total allergen misses (typed plus plates) no higher than B, clear entries AND all entries | **FAIL** | clear only: MM 29 vs B 2 (FAIL) | all entries: MM 32 vs B 2 (FAIL) | failed calls counted as misses: clear MM 29 vs B 6 (FAIL); all MM 32 vs B 6 (FAIL); verdict FAIL | MM 24 vs B 2 (FAIL) | MM 11 vs B 1 (FAIL) | n/a: no filled worksheet for every plate run of MM | clear MM 33 vs B 6 (FAIL); all MM 36 vs B 6 (FAIL) |
| 4 | MM total allergen misses (typed plus plates) no higher than C3, clear entries AND all entries | **FAIL** | clear only: MM 29 vs C3 1 (FAIL) (plates: mean per plate run, MM 1 run(s) [20], C3 2 run(s) [2, 0]) | all entries: MM 32 vs C3 1.5 (FAIL) | failed calls counted as misses: clear MM 29 vs C3 1 (FAIL); all MM 32 vs C3 1.5 (FAIL); verdict FAIL | MM 24 vs C3 2 (FAIL) | MM 11 vs C3 0.5 (FAIL) | n/a: no filled worksheet for every plate run of MM, C3 | clear MM 33 vs C3 4.5 (FAIL); all MM 36 vs C3 5 (FAIL) |

## Miss counts per cell

Typed counts are summed over the scored repeats. `per 3` scales a cell with fewer repeats to three.
`distinct` counts an entry once however many repeats missed it. `unlisted` = the item was not in the
answer at all (a clear must_flag only); `elsewhere` = of those, the same flag sat on another item.

| cell | reps | preg clear typed | per 3 | distinct | preg clear plates | preg nonclear typed / plates | alg clear typed | per 3 | distinct | alg clear plates | alg nonclear typed / plates |
|---|---|---|---|---|---|---|---|---|---|---|---|
| B | 3 | 0 | 0.0 | 0 | 0 | 0 / 0 | 0 | 0.0 | 0 | 2 | 0 / 0 |
| C3 | 3 | 0 | 0.0 | 0 | 0 | 0 / 0 | 0 | 0.0 | 0 | 2 | 0 / 1 |
| D3 | 3 | 0 | 0.0 | 0 | 2 | 5 / 3 | 2 | 2.0 | 1 | 5 | 0 / 5 |
| L25 | 3 | 11 | 11.0 | 7 | 5 | 13 / 1 | 21 | 21.0 | 14 | 6 | 0 / 2 |
| MM | 3 | 0 | 0.0 | 0 | 3 | 0 / 1 | 9 | 9.0 | 4 | 20 | 0 / 3 |

| cell | source | clear preg tested | clear preg miss (unlisted, elsewhere) | clear alg tested | clear alg miss (unlisted, elsewhere) | if_listed misses | failed calls |
|---|---|---|---|---|---|---|---|
| B | typed | 146 | 0 (0, 0) | 347 | 0 (0, 0) | 0 | 3 |
| B | plates | 18 | 0 (0, 0) | 105 | 2 (1, 1) | 0 | 0 |
| C3 | typed | 147 | 0 (0, 0) | 351 | 0 (0, 0) | 0 | 0 |
| C3 | plates | 37 | 0 (0, 0) | 212 | 2 (1, 1) | 0 | 0 |
| D3 | typed | 147 | 0 (0, 0) | 348 | 2 (0, 0) | 0 | 1 |
| D3 | plates | 55 | 2 (2, 1) | 317 | 5 (4, 4) | 4 | 1 |
| L25 | typed | 141 | 11 (0, 0) | 343 | 21 (2, 2) | 0 | 7 |
| L25 | plates | 12 | 5 (0, 0) | 78 | 6 (6, 6) | 3 | 11 |
| MM | typed | 147 | 0 (0, 0) | 351 | 9 (0, 0) | 0 | 0 |
| MM | plates | 18 | 3 (3, 2) | 105 | 20 (18, 16) | 3 | 0 |

## Name matching and merge leniency per cell

A model item that shares too few words with any gold food is `outside the gold`: its flags are never
judged, and the gold food it should have held shows up as `unlisted` (a clear entry of it is an
`unlisted_miss`). A new model that names foods in its own way can turn real matches into those, so the
counts are printed here. Check the names before reading a rise in misses as a safety result (`--map-dump`
prints the mapping).

An item that holds more than one gold food carries its flags for each of them. `hits via a merged item`
counts the hits credited only that way. In the strict view one flag value on one such item credits one
gold entry; `extra misses (strict)` are the further entries that lose their hit.

| cell | source | answers | items outside the gold (with flags) | gold entries with no holder | hits via a merged item, clear / not clear | extra misses (strict), clear preg / clear alg |
|---|---|---|---|---|---|---|
| B | typed | 264 | 3 (0) | 0 | 2 / 0 | 0 / 0 |
| B | plates | 50 | 5 (5) | 3 | 42 / 6 | 2 / 4 |
| C3 | typed | 267 | 3 (0) | 0 | 15 / 6 | 0 / 0 |
| C3 | plates | 100 | 7 (6) | 3 | 67 / 13 | 3 / 7 |
| D3 | typed | 266 | 3 (0) | 0 | 0 / 0 | 0 / 0 |
| D3 | plates | 149 | 12 (6) | 8 | 109 / 8 | 6 / 14 |
| L25 | typed | 260 | 17 (11) | 2 | 0 / 0 | 0 / 0 |
| L25 | plates | 39 | 14 (9) | 7 | 15 / 1 | 1 / 2 |
| MM | typed | 267 | 26 (19) | 0 | 0 / 0 | 0 / 0 |
| MM | plates | 50 | 36 (31) | 27 | 18 / 3 | 2 / 4 |

## Every miss

### Cell B: pregnancy misses (0)

None.

### Cell B: allergen misses (2)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| eval-harness:eu-cell-38-newprompt | 06 | Sushi platter (restaurant table) | soy sauce | allergen soybeans | yes | unlisted_miss | not listed; same flag on: salmon avocado roll (mayContain: soybeans), assorted nigiri sushi (mayContain: soybeans) |
| eval-harness:eu-cell-38-newprompt | 33 | Bowl of oatmeal porridge with toppings | milk | allergen milk | yes | miss | cooked oatmeal P[] A[] M['gluten'] |

### Cell C3: pregnancy misses (0)

None.

### Cell C3: allergen misses (3)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| prompt-v3:v3-eu-cell-38-minimal-newprompt | 06 | Sushi platter (restaurant table) | soy sauce | allergen soybeans | yes | unlisted_miss | not listed; same flag on: salmon avocado roll (mayContain: soybeans), tuna nigiri (mayContain: soybeans), white fish nigiri (mayContain: soybeans) |
| prompt-v3:v3-eu-cell-38-minimal-newprompt | 33 | Bowl of oatmeal porridge with toppings | milk | allergen milk | yes | miss | oatmeal porridge P[] A['gluten'] M[] |
| prompt-v3:v3-eu-cell-38-minimal-newprompt | 47 | Café brunch table spread (top-down) | cherry tomato salad with balsamic drizzle | allergen sulphites | no | miss | Avocado and poached egg toast with cherry tomatoes P['raw-egg', 'raw-sprouts'] A['eggs', 'gluten'] M['milk', 'sesame', 'soybeans']; Eggs Benedict with avocado and cherry tomatoes P['raw-egg', 'raw-sprouts'] A['eggs', 'gluten', 'milk'] M['mustard', 'sesame'] |

### Cell D3: pregnancy misses (10)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| prompt-v3:v3-text-eu-cell-35-eu-newprompt-r1 | t055 | 40 g of Comté | Comté cheese | pregnancy raw-dairy | no | miss | Comté P[] A['milk'] M[] |
| prompt-v3:v3-text-eu-cell-35-eu-newprompt-r1 | t078 | Un verre de vin blanc et un morceau de Roquefort | Roquefort | pregnancy raw-dairy | no | miss | Roquefort P['soft-cheese'] A['milk'] M[] |
| prompt-v3:v3-text-eu-cell-35-eu-newprompt-r2 | t055 | 40 g of Comté | Comté cheese | pregnancy raw-dairy | no | miss | Comté P[] A['milk'] M[] |
| prompt-v3:v3-text-eu-cell-35-eu-newprompt-r2 | t078 | Un verre de vin blanc et un morceau de Roquefort | Roquefort | pregnancy raw-dairy | no | miss | Roquefort P['soft-cheese'] A['milk'] M[] |
| prompt-v3:v3-text-eu-cell-35-eu-newprompt-r3 | t055 | 40 g of Comté | Comté cheese | pregnancy raw-dairy | no | miss | Comté P[] A['milk'] M[] |
| prompt-v3:v3-eu-cell-35-eu-newprompt | 22 | Three soft tacos with a corn cob | glass of cola | pregnancy caffeine | no | miss | cola P[] A[] M[] |
| prompt-v3:v3-eu-cell-35-eu-newprompt-r2 | 40 | Half-eaten liver-and-bacon fry-up with chips | fried egg (remnant, yolk visible) | pregnancy raw-egg | no | miss | fried gammon and egg P['raw-meat'] A['eggs'] M[] |
| prompt-v3:v3-eu-cell-35-eu-newprompt-r2 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | pregnancy raw-fish | yes | unlisted_miss | not listed |
| prompt-v3:v3-eu-cell-35-eu-newprompt-r2 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | pregnancy raw-egg | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (pregnancy: raw-egg) |
| prompt-v3:v3-eu-cell-35-eu-newprompt-r3 | 22 | Three soft tacos with a corn cob | glass of cola | pregnancy caffeine | no | miss | cola P[] A[] M[] |

### Cell D3: allergen misses (12)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| prompt-v3:v3-text-eu-cell-35-eu-newprompt-r1 | t085 | Una tapa de altramuces y una caña | lupini beans | allergen lupin | yes | miss | altramuces P[] A[] M['gluten'] |
| prompt-v3:v3-text-eu-cell-35-eu-newprompt-r2 | t085 | Una tapa de altramuces y una caña | lupini beans | allergen lupin | yes | miss | altramuces P[] A[] M[] |
| prompt-v3:v3-eu-cell-35-eu-newprompt | 29 | Tapas/snack flight with a wheat beer | creamy dip/cream cheese with the pickles | allergen milk | yes | miss | pickles and dip P['raw-egg'] A['eggs', 'mustard'] M[] |
| prompt-v3:v3-eu-cell-35-eu-newprompt-r2 | 42 | Buffet lunch plate (many components) | sour cream / remoulade dollop | allergen milk | no | miss | breaded fried fish with mayonnaise P['raw-egg'] A['eggs', 'fish', 'gluten'] M[] |
| prompt-v3:v3-eu-cell-35-eu-newprompt-r2 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | allergen fish | yes | unlisted_miss | not listed; same flag on: grilled mackerel (allergens: fish), tofu and kimchi (allergens: fish), spicy braised fish (allergens: fish), kimchi (allergens: fish) |
| prompt-v3:v3-eu-cell-35-eu-newprompt-r2 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen eggs | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (allergens: eggs), bagel (mayContain: eggs) |
| prompt-v3:v3-eu-cell-35-eu-newprompt-r2 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen gluten | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (allergens: gluten), smoothie bowl with fruit and granola (allergens: gluten), bagel (allergens: gluten) |
| prompt-v3:v3-eu-cell-35-eu-newprompt-r2 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen milk | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (mayContain: milk), smoothie bowl with fruit and granola (allergens: milk), bagel (mayContain: milk), iced latte (allergens: milk), matcha latte (allergens: milk) |
| prompt-v3:v3-eu-cell-35-eu-newprompt-r3 | 05 | Chicken in creamy leafy-green sauce with white rice | chicken pieces in creamy sauce with leafy greens (spinach-type) | allergen milk | no | miss | chicken and spinach stew P[] A[] M[] |
| prompt-v3:v3-eu-cell-35-eu-newprompt-r3 | 08 | Yogurt granola bowl with apple | raisins/dried fruit in granola | allergen sulphites | no | miss | yogurt with granola and apple slices P[] A['gluten', 'milk', 'nuts'] M['sesame', 'soybeans'] |
| prompt-v3:v3-eu-cell-35-eu-newprompt-r3 | 42 | Buffet lunch plate (many components) | sour cream / remoulade dollop | allergen milk | no | miss | breaded fried fish fillet with remoulade P['raw-egg'] A['eggs', 'fish', 'gluten', 'mustard'] M[] |
| prompt-v3:v3-eu-cell-35-eu-newprompt-r3 | 47 | Café brunch table spread (top-down) | cherry tomato salad with balsamic drizzle | allergen sulphites | no | miss | sesame bagel with tomato salad P['raw-sprouts'] A['gluten', 'sesame'] M['milk', 'nuts', 'soybeans'] |

### Cell L25: pregnancy misses (30)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t002 | 8 Stück Lachs-Maki und 2 Thunfisch-Nigiri | tuna nigiri | pregnancy high-mercury-fish | yes | miss | Thunfisch-Nigiri P['raw-fish'] A['fish', 'soybeans'] M['celery', 'crustaceans', 'eggs', 'gluten', 'lupin', 'milk', 'molluscs', 'mustard', 'nuts', 'sesame', 'sulphites'] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t035 | Etwas Käse | cheese | pregnancy raw-dairy | no | miss | Käse P[] A['milk'] M['celery', 'crustaceans', 'eggs', 'fish', 'gluten', 'lupin', 'molluscs', 'mustard', 'nuts', 'peanuts', 'sesame', 'soybeans', 'sulphites'] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t036 | Ein Steak | steak | pregnancy raw-meat | no | miss | Steak P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t046 | Chicken Caesar salad | chicken Caesar salad | pregnancy raw-egg | no | miss | Chicken Caesar salad P[] A['eggs', 'fish', 'gluten', 'milk'] M['celery', 'mustard', 'soybeans'] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t050 | Chicken liver pate on toast | chicken liver pate on toast | pregnancy raw-meat | yes | miss | Chicken liver pate P['liver-retinol'] A['gluten', 'milk'] M['soybeans']; Toast P[] A['gluten'] M['milk', 'sesame', 'soybeans'] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t076 | Starbucks grande caramel macchiato | caramel macchiato | pregnancy caffeine | yes | miss | Caramel Macchiato P[] A['milk'] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t078 | Un verre de vin blanc et un morceau de Roquefort | Roquefort | pregnancy raw-dairy | no | miss | Roquefort P['soft-cheese'] A['milk'] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t080 | Foie gras mi-cuit sur pain d'épices | foie gras mi-cuit | pregnancy raw-meat | no | miss | Foie gras mi-cuit P['liver-retinol'] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t084 | Vitello tonnato, una porzione | vitello tonnato | pregnancy high-mercury-fish | yes | miss | Vitello tonnato P[] A['eggs', 'fish'] M['milk', 'sulphites'] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t088 | Bir simit ve bir bardak çay | black tea | pregnancy caffeine | no | miss | çay P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t091 | Bir fincan Türk kahvesi | Turkish coffee | pregnancy caffeine | yes | miss | Türk kahvesi P[] A[] M['celery'] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t017 | Snickers und eine Cola | cola | pregnancy caffeine | no | miss | Cola P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t020 | Kaffee mit Hafermilch | coffee | pregnancy caffeine | yes | miss | Kaffee P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t046 | Chicken Caesar salad | chicken Caesar salad | pregnancy raw-egg | no | miss | Chicken Caesar salad P[] A['eggs', 'fish', 'gluten', 'milk'] M['celery', 'mustard', 'nuts', 'soybeans'] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t050 | Chicken liver pate on toast | chicken liver pate on toast | pregnancy raw-meat | yes | miss | Chicken liver pate P['liver-retinol'] A[] M['gluten', 'milk']; Toast P[] A['gluten'] M['milk', 'sesame', 'soybeans'] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t080 | Foie gras mi-cuit sur pain d'épices | foie gras mi-cuit | pregnancy raw-meat | no | miss | Foie gras mi-cuit P['liver-retinol'] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t088 | Bir simit ve bir bardak çay | black tea | pregnancy caffeine | no | miss | çay P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t002 | 8 Stück Lachs-Maki und 2 Thunfisch-Nigiri | salmon maki | pregnancy raw-fish | yes | miss | Lachs-Maki P[] A['fish', 'gluten', 'sesame', 'soybeans'] M['milk', 'nuts'] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t002 | 8 Stück Lachs-Maki und 2 Thunfisch-Nigiri | tuna nigiri | pregnancy high-mercury-fish | yes | miss | Thunfisch-Nigiri P['raw-fish'] A['fish', 'gluten', 'sesame', 'soybeans'] M['milk', 'nuts'] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t016 | Ein Teller Spaghetti Carbonara | spaghetti carbonara | pregnancy raw-egg | no | miss | Spaghetti Carbonara P[] A['eggs', 'gluten', 'milk'] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t017 | Snickers und eine Cola | cola | pregnancy caffeine | no | miss | Cola P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t050 | Chicken liver pate on toast | chicken liver pate on toast | pregnancy raw-meat | yes | miss | Chicken liver pate P['liver-retinol'] A['milk'] M['eggs', 'gluten', 'nuts', 'soybeans']; Toast P[] A['gluten', 'soybeans'] M['eggs', 'milk', 'sesame'] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t076 | Starbucks grande caramel macchiato | caramel macchiato | pregnancy caffeine | yes | miss | Caramel Macchiato P[] A['milk'] M['gluten', 'nuts', 'soybeans'] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t078 | Un verre de vin blanc et un morceau de Roquefort | Roquefort | pregnancy raw-dairy | no | miss | Roquefort P['soft-cheese'] A['milk'] M[] |
| prompt-v3:v3-eu-cell-25-lite-newprompt | 06 | Sushi platter (restaurant table) | sushi rolls (salmon+avocado uramaki, sesame) | pregnancy raw-fish | yes | miss | Salmon and Avocado Sushi Rolls P[] A['fish', 'gluten', 'soybeans'] M['milk', 'nuts', 'sesame'] |
| prompt-v3:v3-eu-cell-25-lite-newprompt | 06 | Sushi platter (restaurant table) | tuna nigiri | pregnancy raw-fish | yes | miss | Tuna Nigiri P[] A['fish', 'gluten', 'soybeans'] M['milk', 'nuts', 'sesame'] |
| prompt-v3:v3-eu-cell-25-lite-newprompt | 06 | Sushi platter (restaurant table) | tuna nigiri | pregnancy high-mercury-fish | yes | miss | Tuna Nigiri P[] A['fish', 'gluten', 'soybeans'] M['milk', 'nuts', 'sesame'] |
| prompt-v3:v3-eu-cell-25-lite-newprompt | 06 | Sushi platter (restaurant table) | white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | pregnancy raw-fish | yes | miss | White Fish Nigiri P[] A['fish', 'gluten', 'soybeans'] M['milk', 'nuts', 'sesame'] |
| prompt-v3:v3-eu-cell-25-lite-newprompt | 15 | Bavarian Weisswurst breakfast | wheat beer (Weissbier) glass | pregnancy alcohol | yes | miss | Beer P[] A[] M['gluten'] |
| prompt-v3:v3-eu-cell-25-lite-newprompt | 50 | Late-night döner kebab plate with fries and salad | Pepsi cup | pregnancy caffeine | no | miss | Pepsi P[] A[] M[] |

### Cell L25: allergen misses (29)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t026 | 1 Lupinen-Burger-Patty, 90 g | lupin burger patty | allergen lupin | yes | miss | Lupinen-Burger-Patty P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t029 | 150 g Lachs aus dem Ofen mit Brokkoli | baked salmon | allergen fish | yes | miss | Lachs P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t045 | Brie and grape sandwich on sourdough | brie and grape sandwich | allergen gluten | yes | miss | Brie P['soft-cheese'] A['milk'] M[]; Grape P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t051 | One teaspoon of cod liver oil | cod liver oil | allergen fish | yes | miss | cod liver oil P['liver-retinol'] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t078 | Un verre de vin blanc et un morceau de Roquefort | white wine | allergen sulphites | yes | miss | Vin blanc P['alcohol'] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t085 | Una tapa de altramuces y una caña | small beer | allergen gluten | yes | miss | caña P['alcohol'] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t025 | Ein Teller Selleriecremesuppe | cream of celery soup | allergen celery | yes | miss | Selleriecremesuppe P[] A['milk'] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t027 | Eine Tasse Lupinenkaffee | lupin coffee | allergen lupin | yes | miss | Lupinenkaffee P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t028 | Eine Scheibe Weißbrot mit 20 g Nutella | Nutella | allergen nuts | yes | unlisted_miss | not listed; same flag on: Weißbrot (mayContain: nuts), Schokoladen-Haselnusscreme (allergens: nuts) |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t028 | Eine Scheibe Weißbrot mit 20 g Nutella | Nutella | allergen milk | yes | unlisted_miss | not listed; same flag on: Weißbrot (mayContain: milk), Schokoladen-Haselnusscreme (allergens: milk) |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t029 | 150 g Lachs aus dem Ofen mit Brokkoli | baked salmon | allergen fish | yes | miss | Lachs P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t039 | Käsespätzle mit Röstzwiebeln | Käsespätzle | allergen eggs | yes | miss | Käsespätzle P[] A['gluten', 'milk'] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t045 | Brie and grape sandwich on sourdough | brie and grape sandwich | allergen gluten | yes | miss | Brie cheese P['soft-cheese'] A['milk'] M[]; Grapes P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t051 | One teaspoon of cod liver oil | cod liver oil | allergen fish | yes | miss | cod liver oil P['liver-retinol'] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t078 | Un verre de vin blanc et un morceau de Roquefort | white wine | allergen sulphites | yes | miss | vin blanc P['alcohol'] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t029 | 150 g Lachs aus dem Ofen mit Brokkoli | baked salmon | allergen fish | yes | miss | Lachs P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t045 | Brie and grape sandwich on sourdough | brie and grape sandwich | allergen gluten | yes | miss | Brie P['soft-cheese'] A['milk'] M[]; Grape P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t051 | One teaspoon of cod liver oil | cod liver oil | allergen fish | yes | miss | cod liver oil P['liver-retinol'] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t061 | A Big Mac and medium fries | Big Mac | allergen sesame | yes | miss | Big Mac P[] A['eggs', 'gluten', 'milk', 'soybeans'] M['mustard'] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t065 | Celery sticks with hummus | celery sticks | allergen celery | yes | miss | Celery sticks P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t088 | Bir simit ve bir bardak çay | simit | allergen sesame | yes | miss | Simit P[] A['gluten'] M[] |
| prompt-v3:v3-eu-cell-25-lite-newprompt | 01 | Continental/English-style breakfast plate | brown bread slice | allergen gluten | yes | unlisted_miss | not listed; same flag on: Whole grain bread slice (allergens: gluten), Cocktail sausages (mayContain: gluten), Scrambled eggs (mayContain: gluten), Baked beans (allergens: gluten) |
| prompt-v3:v3-eu-cell-25-lite-newprompt | 04 | Cheeseburger with fries | cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | allergen mustard | no | miss | Cheeseburger P[] A['gluten', 'milk'] M['eggs', 'soybeans'] |
| prompt-v3:v3-eu-cell-25-lite-newprompt | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Cheesy noodles with caramelized onions (allergens: gluten) |
| prompt-v3:v3-eu-cell-25-lite-newprompt | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen eggs | yes | unlisted_miss | not listed; same flag on: Mixed salad with dressing (mayContain: eggs) |
| prompt-v3:v3-eu-cell-25-lite-newprompt | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen milk | yes | unlisted_miss | not listed; same flag on: Cheesy noodles with caramelized onions (allergens: milk), Mixed salad with dressing (mayContain: milk) |
| prompt-v3:v3-eu-cell-25-lite-newprompt | 31 | Bowl of beef/oxtail soup with buttered bread | buttered bread slices (dark/whole-grain) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Butter on bread (allergens: gluten) |
| prompt-v3:v3-eu-cell-25-lite-newprompt | 31 | Bowl of beef/oxtail soup with buttered bread | buttered bread slices (dark/whole-grain) | allergen milk | yes | unlisted_miss | not listed; same flag on: Butter on bread (allergens: milk) |
| prompt-v3:v3-eu-cell-25-lite-newprompt | 35 | Gyros/döner plate with fries and salad | pickled green chili pepper | allergen sulphites | no | miss | Pickled Pepper P[] A[] M[] |

### Cell MM: pregnancy misses (4)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 29 | Tapas/snack flight with a wheat beer | salami slices | pregnancy raw-meat | yes | unlisted_miss | not listed; same flag on: cured meat assortment (pregnancy: raw-meat) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 40 | Half-eaten liver-and-bacon fry-up with chips | liver pieces in gravy | pregnancy liver-retinol | yes | unlisted_miss | not listed |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | pregnancy raw-fish | yes | unlisted_miss | not listed; same flag on: kimchi (pregnancy: raw-fish), seaweed salad (pregnancy: raw-fish), jeon (savory pancakes) (pregnancy: raw-fish) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 47 | Café brunch table spread (top-down) | microgreens/sprout garnish | pregnancy raw-sprouts | no | miss | poached eggs on avocado toast with microgreens P['raw-egg'] A['eggs', 'gluten'] M['nuts', 'sesame']; eggs Benedict with hollandaise sauce and microgreens P['raw-egg'] A['eggs', 'gluten', 'milk'] M['celery', 'mustard'] |

### Cell MM: allergen misses (32)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| prompt-v3:v3-text-eu-cell-mistral-medium-newprompt-r1 | t001 | Ein Stück Tiramisu | tiramisu | allergen gluten | yes | miss | Tiramisu P['alcohol', 'caffeine', 'raw-egg'] A['eggs', 'milk'] M['nuts', 'soybeans'] |
| prompt-v3:v3-text-eu-cell-mistral-medium-newprompt-r1 | t045 | Brie and grape sandwich on sourdough | brie and grape sandwich | allergen gluten | yes | miss | Brie P['soft-cheese'] A['milk'] M[]; grape P[] A[] M['sulphites'] |
| prompt-v3:v3-text-eu-cell-mistral-medium-newprompt-r1 | t060 | A slice of baked New York cheesecake | baked cheesecake | allergen gluten | yes | miss | baked New York cheesecake P['raw-egg'] A['eggs', 'milk'] M[] |
| prompt-v3:v3-text-eu-cell-mistral-medium-newprompt-r1 | t062 | Peanut butter and jelly sandwich | peanut butter and jelly sandwich | allergen gluten | yes | miss | peanut butter P[] A['peanuts'] M['nuts', 'soybeans']; jelly P[] A[] M['sulphites'] |
| prompt-v3:v3-text-eu-cell-mistral-medium-newprompt-r2 | t001 | Ein Stück Tiramisu | tiramisu | allergen gluten | yes | miss | Tiramisu P['alcohol', 'caffeine', 'raw-egg'] A['eggs', 'milk'] M['nuts', 'soybeans'] |
| prompt-v3:v3-text-eu-cell-mistral-medium-newprompt-r2 | t045 | Brie and grape sandwich on sourdough | brie and grape sandwich | allergen gluten | yes | miss | Brie P['soft-cheese'] A['milk'] M[]; grapes P[] A[] M['sulphites'] |
| prompt-v3:v3-text-eu-cell-mistral-medium-newprompt-r3 | t001 | Ein Stück Tiramisu | tiramisu | allergen gluten | yes | miss | Tiramisu P['alcohol', 'caffeine', 'raw-egg'] A['eggs', 'milk'] M['nuts', 'soybeans'] |
| prompt-v3:v3-text-eu-cell-mistral-medium-newprompt-r3 | t045 | Brie and grape sandwich on sourdough | brie and grape sandwich | allergen gluten | yes | miss | Brie P['soft-cheese'] A['milk'] M[]; grapes P[] A[] M['sulphites'] |
| prompt-v3:v3-text-eu-cell-mistral-medium-newprompt-r3 | t062 | Peanut butter and jelly sandwich | peanut butter and jelly sandwich | allergen gluten | yes | miss | peanut butter P[] A['peanuts'] M['nuts', 'soybeans']; jelly P[] A[] M['sulphites'] |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 01 | Continental/English-style breakfast plate | brown bread slice | allergen gluten | yes | unlisted_miss | not listed; same flag on: wholemeal bread (allergens: gluten), baked beans in tomato sauce (mayContain: gluten), pork sausages (mayContain: gluten) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 03 | Greek-style salad with grilled salmon | feta cheese | allergen milk | yes | unlisted_miss | not listed; same flag on: Greek salad (allergens: milk) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 18 | Swabian Maultaschen with potato salad | Maultaschen (filled pasta pockets with meat filling) | allergen gluten | yes | unlisted_miss | not listed; same flag on: stuffed pasta (e.g. cannelloni) (allergens: gluten), creamy potato and herb sauce (mayContain: gluten) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 19 | German fast-food mixed plate (Taxiteller) | tzatziki/garlic yogurt sauce | allergen milk | yes | unlisted_miss | not listed; same flag on: sour cream (allergens: milk) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 19 | German fast-food mixed plate (Taxiteller) | mayonnaise | allergen eggs | yes | unlisted_miss | not listed |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 23 | Smothered beef burrito | burrito (flour tortilla) | allergen gluten | yes | unlisted_miss | not listed; same flag on: cheese enchilada with green sauce (allergens: gluten) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 28 | Middle-Eastern mezze spread, four composed plates plus flatbread | yellow bulgur or couscous | allergen gluten | yes | unlisted_miss | not listed; same flag on: falafel (mayContain: gluten), pita bread (allergens: gluten) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 30 | Mixed grill board (plancha de grillades) | baked/roasted potato with browned cheese topping | allergen milk | no | miss | roasted potato P[] A[] M[] |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 31 | Bowl of beef/oxtail soup with buttered bread | buttered bread slices (dark/whole-grain) | allergen gluten | yes | unlisted_miss | not listed; same flag on: beef goulash (mayContain: gluten), whole wheat bread with butter (allergens: gluten) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 31 | Bowl of beef/oxtail soup with buttered bread | buttered bread slices (dark/whole-grain) | allergen milk | yes | unlisted_miss | not listed; same flag on: whole wheat bread with butter (allergens: milk) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 32 | Charcuterie/snack board (compartmented bamboo tray, top-down) | pan-fried spiced hard-boiled egg halves | allergen eggs | yes | unlisted_miss | not listed |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 32 | Charcuterie/snack board (compartmented bamboo tray, top-down) | herb crackers | allergen sesame | no | miss | rice crackers P[] A[] M['gluten', 'soybeans']; green rice crackers P[] A[] M['gluten', 'soybeans'] |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 35 | Gyros/döner plate with fries and salad | pickled green chili pepper | allergen sulphites | no | miss | sliced green pepper P[] A[] M[] |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 36 | Seafood paella in the pan | whole prawns (langostinos) | allergen crustaceans | yes | unlisted_miss | not listed; same flag on: paella (allergens: crustaceans) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 36 | Seafood paella in the pan | mantis shrimp (galeras) | allergen crustaceans | yes | unlisted_miss | not listed; same flag on: paella (allergens: crustaceans) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 37 | Pierogi ruskie with carrot-cabbage salad | pierogi/boiled dumplings (potato-cheese filling) | allergen milk | yes | miss | dumplings P[] A['eggs', 'gluten'] M['celery', 'mustard', 'soybeans'] |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 43 | Buffet lunch set, main plate, soup bowl, bread plate | cheese-topped quiche/gratin square | allergen milk | yes | unlisted_miss | not listed; same flag on: creamy soup with bacon bits (allergens: milk), buttered bread roll (allergens: milk), breaded fish fillet with tartar sauce (mayContain: milk), potato salad (mayContain: milk) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 43 | Buffet lunch set, main plate, soup bowl, bread plate | bread roll with butter | allergen gluten | yes | unlisted_miss | not listed; same flag on: creamy soup with bacon bits (mayContain: gluten), buttered bread roll (allergens: gluten), breaded fish fillet with tartar sauce (mayContain: gluten) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 43 | Buffet lunch set, main plate, soup bowl, bread plate | bread roll with butter | allergen milk | yes | unlisted_miss | not listed; same flag on: creamy soup with bacon bits (allergens: milk), buttered bread roll (allergens: milk), breaded fish fillet with tartar sauce (mayContain: milk), potato salad (mayContain: milk) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | allergen fish | yes | unlisted_miss | not listed; same flag on: grilled mackerel (allergens: fish), kimchi (allergens: fish), seaweed salad (allergens: fish), jeon (savory pancakes) (allergens: fish), fermented soybean paste stew (mayContain: fish) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | steamed egg (gyeranjjim) in stone pot | allergen eggs | yes | unlisted_miss | not listed; same flag on: jeon (savory pancakes) (allergens: eggs) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 48 | Disposable plate of party snacks (partly eaten) | samosas (small fried triangles) | allergen gluten | yes | unlisted_miss | not listed; same flag on: white bread sandwich with filling (allergens: gluten) |
| prompt-v3:v3-eu-cell-mistral-medium-newprompt | 48 | Disposable plate of party snacks (partly eaten) | slice of white/vanilla cake with icing, partly eaten | allergen gluten | yes | miss | cake with cream and fruit bits P['raw-egg'] A['eggs', 'milk'] M['nuts', 'soybeans'] |

## Failed calls (scored by rule 1, not as flag misses)

| cell | run | case | text | finish or error | clear must_flag entries | flags the truncated text had written |
|---|---|---|---|---|---|---|
| B | eval-harness:text-eu-cell-38-newprompt-r1 | t040 | Graved Lachs mit Senf-Dill-Sauce | length | allergen fish, allergen mustard | "flags": { "pregnancy": [ "raw-fish" ], "allergens": [ "fish" ], "mayContain": [] } |
| B | eval-harness:text-eu-cell-38-newprompt-r2 | t040 | Graved Lachs mit Senf-Dill-Sauce | length | allergen fish, allergen mustard | "flags": { "pregnancy": [ "raw-fish" ], "allergens": [ "fish", "mustard" ], "mayContain": [] } |
| B | eval-harness:text-eu-cell-38-newprompt-r3 | t044 | 4 slices of prosciutto with melon | length | pregnancy raw-meat | "flags": { "pregnancy": [ "raw-meat" ], "allergens": [], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": [], "mayContain": [] } |
| D3 | prompt-v3:v3-text-eu-cell-35-eu-newprompt-r3 | t039 | Käsespätzle mit Röstzwiebeln | error | allergen gluten, allergen eggs, allergen milk | none |
| D3 | prompt-v3:v3-eu-cell-35-eu-newprompt-r2 | 23 | Smothered beef burrito | error | allergen gluten, allergen milk | "flags": { "pregnancy": [], "allergens": ["gluten", "milk"], "mayContain": ["eggs", "soybeans"] } |
| L25 | prompt-v3:v3-text-eu-cell-25-lite-newprompt-r1 | t079 | Un steak tartare avec un jaune d'oeuf cru, et des frites | error | pregnancy raw-meat, pregnancy raw-egg, allergen eggs | none |
| L25 | prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t006 | 100 g Räucherlachs, 1 Bagel, 30 g Frischkäse | error | pregnancy smoked-fish, allergen fish, allergen gluten, allergen milk | none |
| L25 | prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t034 | Ein Riegel | error |  | none |
| L25 | prompt-v3:v3-text-eu-cell-25-lite-newprompt-r2 | t054 | A glass of unpasteurised raw milk from the farm | error | pregnancy raw-dairy, allergen milk | none |
| L25 | prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t053 | Avocado toast with broccoli sprouts | error | pregnancy raw-sprouts, allergen gluten | none |
| L25 | prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t086 | 50 g de jamón serrano y unas lonchas de queso manchego | error | pregnancy raw-meat, allergen milk | none |
| L25 | prompt-v3:v3-text-eu-cell-25-lite-newprompt-r3 | t090 | Bir porsiyon midye dolma | error | allergen molluscs | none |
| L25 | prompt-v3:v3-eu-cell-25-lite-newprompt | 10 | Club sandwich with side salad (cafe table) | HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"google/gemini-2.5-flash-lite is te | allergen gluten | none |
| L25 | prompt-v3:v3-eu-cell-25-lite-newprompt | 11 | Wiener Schnitzel with fries and side salad | error | allergen gluten | none |
| L25 | prompt-v3:v3-eu-cell-25-lite-newprompt | 18 | Swabian Maultaschen with potato salad | HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"google/gemini-2.5-flash-lite is te | allergen gluten | none |
| L25 | prompt-v3:v3-eu-cell-25-lite-newprompt | 19 | German fast-food mixed plate (Taxiteller) | HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"google/gemini-2.5-flash-lite is te | allergen milk, allergen eggs | none |
| L25 | prompt-v3:v3-eu-cell-25-lite-newprompt | 20 | Bowl of shio ramen | HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"google/gemini-2.5-flash-lite is te | allergen gluten | none |
| L25 | prompt-v3:v3-eu-cell-25-lite-newprompt | 21 | Vietnamese pho with a side plate of herb garnishes | HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"google/gemini-2.5-flash-lite is te | pregnancy raw-sprouts | none |
| L25 | prompt-v3:v3-eu-cell-25-lite-newprompt | 29 | Tapas/snack flight with a wheat beer | HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"google/gemini-2.5-flash-lite is te | pregnancy raw-meat, allergen milk | none |
| L25 | prompt-v3:v3-eu-cell-25-lite-newprompt | 43 | Buffet lunch set, main plate, soup bowl, bread plate | HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"google/gemini-2.5-flash-lite is te | allergen gluten, allergen eggs, allergen milk, allergen gluten, allergen milk | none |
| L25 | prompt-v3:v3-eu-cell-25-lite-newprompt | 44 | Brazilian buffet lunch plate (top-down) | HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"google/gemini-2.5-flash-lite is te |  | none |
| L25 | prompt-v3:v3-eu-cell-25-lite-newprompt | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"google/gemini-2.5-flash-lite is te | pregnancy raw-fish, allergen fish, allergen eggs, allergen fish | none |
| L25 | prompt-v3:v3-eu-cell-25-lite-newprompt | 47 | Café brunch table spread (top-down) | error | allergen eggs, allergen gluten, allergen eggs, allergen gluten, allergen milk, pregnancy raw-egg, allergen milk, allergen gluten, allergen sesame, allergen gluten | "flags": { "pregnancy": [], "allergens": [ "milk" ], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": [ "gluten" ], "mayContain": [ "nuts", "milk" ] } |

## Not blocking: demotions, false alarms, extra flags

| cell | source | cases | demotions clear (distinct) | demotions not clear | preg false alarms (distinct) | allergen false alarms (distinct) | extra preg flags per case | extra allergen flags per case | items outside the gold, their flags |
|---|---|---|---|---|---|---|---|---|---|
| B | typed | 264 | 0 (0) | 4 | 3 (1) | 3 (1) | 0.02 | 0.85 | 3, 0 |
| B | plates | 50 | 4 (4) | 4 | 1 (1) | 0 (0) | 0.08 | 2.94 | 5, 14 |
| C3 | typed | 267 | 0 (0) | 6 | 3 (1) | 3 (1) | 0.02 | 0.76 | 3, 0 |
| C3 | plates | 100 | 10 (6) | 7 | 2 (1) | 0 (0) | 0.12 | 3.07 | 7, 23 |
| D3 | typed | 266 | 1 (1) | 6 | 6 (4) | 1 (1) | 0.08 | 0.55 | 3, 0 |
| D3 | plates | 149 | 6 (5) | 8 | 10 (4) | 0 (0) | 0.56 | 1.98 | 12, 18 |
| L25 | typed | 260 | 9 (6) | 3 | 1 (1) | 5 (3) | 0.01 | 1.29 | 17, 44 |
| L25 | plates | 39 | 3 (3) | 1 | 1 (1) | 0 (0) | 0.05 | 5.18 | 14, 35 |
| MM | typed | 267 | 12 (6) | 16 | 45 (18) | 4 (2) | 0.24 | 1.92 | 26, 37 |
| MM | plates | 50 | 7 (7) | 5 | 4 (4) | 0 (0) | 0.84 | 3.68 | 36, 101 |

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

### Cell L25: demotions (16)

- 06 sushi rolls (salmon+avocado uramaki, sesame): sesame in mayContain, 1 answer(s)
- 15 wheat beer (Weissbier) glass: gluten in mayContain, 1 answer(s)
- 27 stir-fried chicken pieces in brown sauce: nuts in mayContain, 1 answer(s)
- 32 herb crackers: sesame in mayContain, 1 answer(s), clear:false
- t017 Snickers bar: peanuts in mayContain, 2 answer(s)
- t020 oat milk: gluten in mayContain, 2 answer(s)
- t023 Waldorf salad: celery in mayContain, 1 answer(s)
- t025 cream of celery soup: celery in mayContain, 1 answer(s)
- t061 Big Mac: mustard in mayContain, 2 answer(s), clear:false
- t061 Big Mac: sesame in mayContain, 2 answer(s)
- t066 honey mustard chicken wrap: mustard in mayContain, 1 answer(s)
- t071 curry: nuts in mayContain, 1 answer(s), clear:false

### Cell MM: demotions (40)

- 06 soy sauce: gluten in mayContain, 1 answer(s), clear:false
- 12 mustard/onion-gravy drizzle on the sausages: mustard in mayContain, 1 answer(s), clear:false
- 13 Käsespätzle (spätzle noodles in melted cheese): milk in mayContain, 1 answer(s)
- 20 sliced chashu pork: soybeans in mayContain, 1 answer(s), clear:false
- 27 stir-fried chicken pieces in brown sauce: nuts in mayContain, 1 answer(s)
- 32 herb crackers: gluten in mayContain, 1 answer(s)
- 33 milk: milk in mayContain, 1 answer(s)
- 38 cheese slice in burger: milk in mayContain, 1 answer(s)
- 43 breaded croquettes/fish cakes topped with mayonnaise-aioli: gluten in mayContain, 1 answer(s)
- 45 vegetable fritters/jeon platter: gluten in mayContain, 1 answer(s), clear:false
- 47 beetroot latte: milk in mayContain, 1 answer(s), clear:false
- 47 yogurt bowl with granola, kiwi slices and berry compote: milk in mayContain, 1 answer(s)
- t016 spaghetti carbonara: gluten in mayContain, 3 answer(s)
- t023 Waldorf salad: celery in mayContain, 2 answer(s)
- t023 Waldorf salad: eggs in mayContain, 3 answer(s), clear:false
- t039 Käsespätzle: eggs in mayContain, 2 answer(s)
- t046 chicken Caesar salad: fish in mayContain, 3 answer(s), clear:false
- t046 chicken Caesar salad: gluten in mayContain, 3 answer(s), clear:false
- t047 eggs Benedict: gluten in mayContain, 2 answer(s)
- t060 baked cheesecake: gluten in mayContain, 2 answer(s)
- t061 Big Mac: eggs in mayContain, 1 answer(s), clear:false
- t062 peanut butter and jelly sandwich: gluten in mayContain, 1 answer(s)
- t063 miso soup: fish in mayContain, 3 answer(s), clear:false
- t071 curry: nuts in mayContain, 3 answer(s), clear:false

### Cell B: false alarms on must_not_flag (7)

- 03 feta cheese: pregnancy soft-cheese (in pregnancy), 1 answer(s)
- t068 coconut yogurt: allergen nuts (in mayContain), 3 answer(s)
- t089 white cheese: pregnancy soft-cheese (in pregnancy), 3 answer(s)

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

### Cell L25: false alarms on must_not_flag (7)

- 03 feta cheese: pregnancy soft-cheese (in pregnancy), 1 answer(s)
- t006 cream cheese: pregnancy raw-dairy (in pregnancy), 1 answer(s)
- t020 oat milk: allergen milk (in mayContain), 3 answer(s)
- t064 soy milk: allergen milk (in mayContain), 1 answer(s)
- t068 coconut yogurt: allergen milk (in mayContain), 1 answer(s)

### Cell MM: false alarms on must_not_flag (53)

- 03 grilled salmon fillets: pregnancy high-mercury-fish (in pregnancy), 1 answer(s)
- 29 cheese cubes: pregnancy soft-cheese (in pregnancy), 1 answer(s)
- 42 breaded fried fish fillet: pregnancy raw-fish (in pregnancy), 1 answer(s)
- 45 grilled mackerel/fish: pregnancy high-mercury-fish (in pregnancy), 1 answer(s)
- t006 cream cheese: pregnancy raw-dairy (in pregnancy), 1 answer(s)
- t006 cream cheese: pregnancy soft-cheese (in pregnancy), 3 answer(s)
- t014 beef steak (well done): pregnancy raw-meat (in pregnancy), 3 answer(s)
- t021 prawn cocktail: pregnancy raw-fish (in pregnancy), 3 answer(s)
- t022 mussels in white wine broth: pregnancy raw-fish (in pregnancy), 3 answer(s)
- t027 lupin coffee: pregnancy caffeine (in pregnancy), 1 answer(s)
- t029 baked salmon: pregnancy high-mercury-fish (in pregnancy), 3 answer(s)
- t029 baked salmon: pregnancy smoked-fish (in pregnancy), 1 answer(s)
- t030 cooked ham: pregnancy raw-meat (in pregnancy), 3 answer(s)
- t055 Comté cheese: pregnancy soft-cheese (in pregnancy), 1 answer(s)
- t056 mature cheddar: pregnancy soft-cheese (in pregnancy), 2 answer(s)
- t057 cream cheese: pregnancy raw-dairy (in pregnancy), 3 answer(s)
- t060 baked cheesecake: pregnancy raw-egg (in pregnancy), 3 answer(s)
- t068 coconut yogurt: allergen milk (in mayContain), 1 answer(s)
- t068 coconut yogurt: allergen nuts (in mayContain), 3 answer(s)
- t083 spaghetti with clams: pregnancy raw-fish (in pregnancy), 3 answer(s)
- t086 manchego cheese: pregnancy soft-cheese (in pregnancy), 3 answer(s)
- t087 garlic prawns: pregnancy raw-fish (in pregnancy), 3 answer(s)
- t089 white cheese: pregnancy soft-cheese (in pregnancy), 3 answer(s)
- t090 stuffed mussels: pregnancy raw-fish (in pregnancy), 3 answer(s)

## Per category and per allergen

Misses / tested entries, typed repeats and plates together. Demotions in brackets.

| kind | value | B clear | C3 clear | D3 clear | L25 clear | MM clear | B not clear | C3 not clear | D3 not clear | L25 not clear | MM not clear |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pregnancy | raw-dairy | 0/9 | 0/9 | 0/9 | 0/8 | 0/9 | 0/9 | 0/9 | 5/9 | 3/9 | 0/9 |
| pregnancy | soft-cheese | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| pregnancy | raw-meat | 0/22 | 0/25 | 0/27 | 3/20 | 1/23 | 0/6 | 0/6 | 0/6 | 3/6 | 0/6 |
| pregnancy | raw-egg | 0/17 | 0/19 | 1/21 | 0/15 | 0/17 | 0/8 | 0/10 | 1/12 | 3/7 | 0/8 |
| pregnancy | raw-fish | 0/22 | 0/26 | 1/30 | 4/21 | 1/22 | 0/1 | 0/3 | 0/3 | 0/3 | 0/3 |
| pregnancy | smoked-fish | 0/9 | 0/9 | 0/9 | 0/8 | 0/9 | 0/1 | 0/3 | 0/3 | 0/3 | 0/3 |
| pregnancy | high-mercury-fish | 0/13 | 0/14 | 0/15 | 4/13 | 0/13 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| pregnancy | liver-retinol | 0/13 | 0/14 | 0/15 | 0/13 | 1/13 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| pregnancy | alcohol | 0/18 | 0/25 | 0/31 | 1/17 | 0/18 | 0/1 | 0/2 | 0/2 | 0/0 | 0/0 |
| pregnancy | caffeine | 0/16 | 0/17 | 0/18 | 4/15 | 0/16 | 0/9 | 0/12 | 2/13 | 5/7 | 0/8 |
| pregnancy | raw-sprouts | 0/13 | 0/14 | 0/15 | 0/11 | 0/13 | 0/0 | 0/0 | 0/0 | 0/0 | 1/1 |
| allergen | gluten | 0/135 (1) | 0/177 (2) | 1/221 (3) | 7/121 (3) | 17/133 (10) | 0/4 | 0/6 | 0/9 | 0/4 | 0/5 (5) |
| allergen | crustaceans | 0/11 | 0/13 | 0/15 | 0/11 | 2/11 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| allergen | eggs | 0/55 | 0/71 | 1/86 | 2/49 | 3/55 (2) | 0/25 (1) | 0/29 (3) | 0/33 | 0/21 | 0/23 (4) |
| allergen | fish | 0/46 (1) | 0/57 | 1/66 | 6/45 | 1/48 | 0/9 (1) | 0/9 | 0/9 (3) | 0/9 | 0/9 (6) |
| allergen | peanuts | 0/10 | 0/11 | 0/12 | 0/10 (2) | 0/10 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| allergen | soybeans | 1/12 | 1/15 | 0/18 | 0/11 | 0/12 | 0/3 | 0/6 | 0/9 | 0/1 | 0/3 (1) |
| allergen | milk | 1/108 (2) | 1/135 (8) | 2/157 (4) | 3/99 | 6/109 (4) | 0/13 (2) | 0/22 (4) | 3/30 (3) | 0/10 | 1/13 (1) |
| allergen | nuts | 0/10 | 0/11 | 0/12 | 1/10 (1) | 0/10 (1) | 0/3 (3) | 0/3 (3) | 0/3 (3) | 0/3 (1) | 0/3 (3) |
| allergen | celery | 0/9 | 0/9 | 0/9 | 2/9 (2) | 0/9 (2) | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| allergen | mustard | 0/8 | 0/11 | 0/12 | 0/10 (1) | 0/10 | 0/5 | 0/7 | 0/9 (2) | 1/5 (2) | 0/5 (1) |
| allergen | sesame | 0/15 | 0/18 | 0/21 | 2/14 (3) | 0/15 | 0/4 (1) | 0/8 (2) | 0/12 (3) | 0/3 (1) | 1/3 |
| allergen | sulphites | 0/9 | 0/11 | 0/12 | 2/9 | 0/10 | 0/1 | 1/4 (1) | 2/4 | 1/1 | 1/1 |
| allergen | lupin | 0/12 | 0/12 | 2/12 | 2/12 | 0/12 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| allergen | molluscs | 0/12 | 0/12 | 0/12 | 0/11 | 0/12 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |

## Sanity: gold labels every cell contradicts the same way

Entries that B, C3, D3, L25 and MM all contradict come first, then entries four of the five contradict (to fill
ten rows), each group ranked by the lowest rate among the contradicting cells (contradicting answers
over answers that judged the entry). The gold files are not changed here; a view is a proposal.

| cells | list | case | text | item | flag | clear | way | B | C3 | D3 | L25 | MM | view |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 of 5 | must_flag | t071 | some curry from the place downstairs | curry | allergen nuts | no | demoted to mayContain | 3/3 | 3/3 | 3/3 | 1/3 | 3/3 | Unknown curry: mayContain is the honest list, and it shows a chip. Proposal: accept mayContain as the expected list (no demotion). |
| 4 of 5 | must_flag | 32 | Charcuterie/snack board (compartmented bamboo tray, top-down) | herb crackers | allergen sesame | no | demoted to mayContain | 1/1 | 2/2 | 3/3 | 1/1 | 0/1 | Gold arguable, already clear:false. Herb crackers do not plainly hold sesame. Proposal: move to may_flag; mayContain is the honest list. |
| 4 of 5 | must_not_flag | t068 | 150 g plant-based coconut yogurt (dairy-free) | coconut yogurt | allergen nuts | yes | flagged although must_not_flag | 3/3 | 3/3 | 1/3 | 0/3 | 3/3 | Coconut is not an EU Annex II nut, so nuts in `allergens` is wrong. In mayContain it is a cross-contact hedge. Proposal: keep must_not for `allergens`, accept nuts in mayContain. |

