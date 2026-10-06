# EU switch: candidate cell F25 against 3.8 (fixed scorers) (2026-10-06)

Written by `python3 -m harness.score_flags --config configs/score-flags-candidates-F25.json`. No model call. The gold is
`gold/gold_text.jsonl` and `gold/gold_plate_flags.json`, read as `gold/GOLD-NOTES.md` section 2 says. The
machine readable twin of this file holds every entry, every holder and every flag.

Candidate F25, v3 prompt, EU host. References B and C3. Runs named worktree:directory live in a sibling worktree.

Legend for a model item: `P[...]` pregnancy, `A[...]` allergens, `M[...]` mayContain.

## Runs

| cell | label | typed repeats scored | plate run |
|---|---|---|---|
| B | 3.8, default reasoning, production prompt | eval-harness:text-eu-cell-38-newprompt-r1, eval-harness:text-eu-cell-38-newprompt-r2, eval-harness:text-eu-cell-38-newprompt-r3 | eval-harness:eu-cell-38-newprompt |
| C3 | 3.8, reasoning minimal, v3 prompt | prompt-v3:v3-text-eu-cell-38-minimal-newprompt-r1, prompt-v3:v3-text-eu-cell-38-minimal-newprompt-r2, prompt-v3:v3-text-eu-cell-38-minimal-newprompt-r3 | prompt-v3:v3-eu-cell-38-minimal-newprompt, prompt-v3:v3-eu-cell-38-minimal-newprompt-r2 |
| F25 | 2.5 flash, google-vertex/eu, minimal, v3 prompt | prompt-v3:v3-text-eu-cell-25-flash-newprompt-r1, prompt-v3:v3-text-eu-cell-25-flash-newprompt-r2, prompt-v3:v3-text-eu-cell-25-flash-newprompt-r3 | prompt-v3:v3-eu-cell-25-flash-newprompt |

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
| 2 | F25: zero misses on the clear pregnancy must-flag typed cases, in every repeat | **PASS** | misses per repeat [0, 0, 0]; distinct entries missed 0 | | failed calls left out (rule 1); their clear pregnancy entries per repeat [0, 0, 0]; counted as misses: PASS | | | | misses per repeat [0, 0, 0] (PASS) |
| 3 | F25 total pregnancy misses (typed plus plates) no higher than B, clear entries AND all entries | **INCONCLUSIVE** | clear only: F25 0 vs B 0 (PASS) | all entries: F25 1 vs B 0 (FAIL) | failed calls counted as misses: clear F25 0 vs B 1 (PASS); all F25 2 vs B 3 (PASS); verdict PASS | F25 0 vs B 0 (PASS) | F25 0 vs B 0 (PASS) | F25 0.0 vs B 2.0 (PASS) | clear F25 2 vs B 2 (PASS); all F25 3 vs B 2 (FAIL) |
| 3 | F25 total pregnancy misses (typed plus plates) no higher than C3, clear entries AND all entries | **FAIL** | clear only: F25 0 vs C3 0 (PASS) (plates: mean per plate run, F25 1 run(s) [0], C3 2 run(s) [0, 0]) | all entries: F25 1 vs C3 0 (FAIL) | failed calls counted as misses: clear F25 0 vs C3 0 (PASS); all F25 2 vs C3 0 (FAIL); verdict FAIL | F25 0 vs C3 0 (PASS) | F25 0 vs C3 0 (PASS) | n/a: no filled worksheet for every plate run of C3 | clear F25 2 vs C3 1.5 (FAIL); all F25 3 vs C3 1.5 (FAIL) |
| 4 | F25 total allergen misses (typed plus plates) no higher than B, clear entries AND all entries | **FAIL** | clear only: F25 19 vs B 2 (FAIL) | all entries: F25 23 vs B 2 (FAIL) | failed calls counted as misses: clear F25 22 vs B 6 (FAIL); all F25 26 vs B 6 (FAIL); verdict FAIL | F25 16 vs B 2 (FAIL) | F25 11 vs B 1 (FAIL) | F25 21.0 vs B 6.0 (FAIL) | clear F25 23 vs B 6 (FAIL); all F25 27 vs B 6 (FAIL) |
| 4 | F25 total allergen misses (typed plus plates) no higher than C3, clear entries AND all entries | **FAIL** | clear only: F25 19 vs C3 1 (FAIL) (plates: mean per plate run, F25 1 run(s) [9], C3 2 run(s) [2, 0]) | all entries: F25 23 vs C3 1.5 (FAIL) | failed calls counted as misses: clear F25 22 vs C3 1 (FAIL); all F25 26 vs C3 1.5 (FAIL); verdict FAIL | F25 16 vs C3 2 (FAIL) | F25 11 vs C3 0.5 (FAIL) | n/a: no filled worksheet for every plate run of C3 | clear F25 23 vs C3 4.5 (FAIL); all F25 27 vs C3 5 (FAIL) |

## Miss counts per cell

Typed counts are summed over the scored repeats. `per 3` scales a cell with fewer repeats to three.
`distinct` counts an entry once however many repeats missed it. `unlisted` = the item was not in the
answer at all (a clear must_flag only); `elsewhere` = of those, the same flag sat on another item.

| cell | reps | preg clear typed | per 3 | distinct | preg clear plates | preg nonclear typed / plates | alg clear typed | per 3 | distinct | alg clear plates | alg nonclear typed / plates |
|---|---|---|---|---|---|---|---|---|---|---|---|
| B | 3 | 0 | 0.0 | 0 | 0 | 0 / 0 | 0 | 0.0 | 0 | 2 | 0 / 0 |
| C3 | 3 | 0 | 0.0 | 0 | 0 | 0 / 0 | 0 | 0.0 | 0 | 2 | 0 / 1 |
| F25 | 3 | 0 | 0.0 | 0 | 0 | 1 / 0 | 10 | 10.0 | 7 | 9 | 2 / 2 |

| cell | source | clear preg tested | clear preg miss (unlisted, elsewhere) | clear alg tested | clear alg miss (unlisted, elsewhere) | if_listed misses | failed calls |
|---|---|---|---|---|---|---|---|
| B | typed | 146 | 0 (0, 0) | 347 | 0 (0, 0) | 0 | 3 |
| B | plates | 18 | 0 (0, 0) | 105 | 2 (1, 1) | 0 | 0 |
| C3 | typed | 147 | 0 (0, 0) | 351 | 0 (0, 0) | 0 | 0 |
| C3 | plates | 37 | 0 (0, 0) | 212 | 2 (1, 1) | 0 | 0 |
| F25 | typed | 147 | 0 (0, 0) | 350 | 10 (0, 0) | 0 | 1 |
| F25 | plates | 18 | 0 (0, 0) | 103 | 9 (8, 8) | 0 | 1 |

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
| F25 | typed | 266 | 18 (13) | 0 | 0 / 0 | 0 / 0 |
| F25 | plates | 49 | 24 (16) | 10 | 26 / 6 | 2 / 4 |

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

### Cell F25: pregnancy misses (1)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| prompt-v3:v3-text-eu-cell-25-flash-newprompt-r3 | t078 | Un verre de vin blanc et un morceau de Roquefort | Roquefort | pregnancy raw-dairy | no | miss | Roquefort P['soft-cheese'] A['milk'] M[] |

### Cell F25: allergen misses (23)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| prompt-v3:v3-text-eu-cell-25-flash-newprompt-r1 | t045 | Brie and grape sandwich on sourdough | brie and grape sandwich | allergen gluten | yes | miss | Brie cheese P['soft-cheese'] A['milk'] M[]; Grapes P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-flash-newprompt-r1 | t065 | Celery sticks with hummus | celery sticks | allergen celery | yes | miss | Celery sticks P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-flash-newprompt-r1 | t085 | Una tapa de altramuces y una caña | lupini beans | allergen lupin | yes | miss | Altramuces P[] A['peanuts'] M[] |
| prompt-v3:v3-text-eu-cell-25-flash-newprompt-r2 | t025 | Ein Teller Selleriecremesuppe | cream of celery soup | allergen celery | yes | miss | Selleriecremesuppe P[] A['milk'] M[] |
| prompt-v3:v3-text-eu-cell-25-flash-newprompt-r2 | t027 | Eine Tasse Lupinenkaffee | lupin coffee | allergen lupin | yes | miss | Lupinenkaffee P['caffeine'] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-flash-newprompt-r2 | t052 | Pad Thai with shrimp, topped with raw bean sprouts and crushed peanuts | shrimp pad Thai | allergen fish | no | miss | Pad Thai with shrimp P[] A['crustaceans', 'eggs', 'soybeans'] M['gluten', 'peanuts']; Raw bean sprouts P['raw-sprouts'] A[] M[]; Crushed peanuts P[] A['peanuts'] M[] |
| prompt-v3:v3-text-eu-cell-25-flash-newprompt-r2 | t061 | A Big Mac and medium fries | Big Mac | allergen mustard | no | miss | Big Mac P[] A['eggs', 'gluten', 'milk', 'sesame', 'soybeans'] M[] |
| prompt-v3:v3-text-eu-cell-25-flash-newprompt-r2 | t065 | Celery sticks with hummus | celery sticks | allergen celery | yes | miss | Celery sticks P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-flash-newprompt-r3 | t008 | Ein Leberwurstbrot | liver sausage sandwich | allergen gluten | yes | miss | Leberwurst P['liver-retinol'] A[] M['celery', 'milk', 'mustard', 'soybeans'] |
| prompt-v3:v3-text-eu-cell-25-flash-newprompt-r3 | t045 | Brie and grape sandwich on sourdough | brie and grape sandwich | allergen gluten | yes | miss | Brie cheese P['soft-cheese'] A['milk'] M['milk']; Grapes P[] A[] M[] |
| prompt-v3:v3-text-eu-cell-25-flash-newprompt-r3 | t052 | Pad Thai with shrimp, topped with raw bean sprouts and crushed peanuts | shrimp pad Thai | allergen crustaceans | yes | miss | Pad Thai with shrimp P[] A['eggs', 'fish', 'soybeans'] M['gluten', 'nuts', 'peanuts']; Raw bean sprouts P['raw-sprouts'] A[] M[]; Crushed peanuts P[] A['peanuts'] M['nuts'] |
| prompt-v3:v3-text-eu-cell-25-flash-newprompt-r3 | t065 | Celery sticks with hummus | celery sticks | allergen celery | yes | miss | Celery sticks P[] A[] M[] |
| prompt-v3:v3-eu-cell-25-flash-newprompt | 01 | Continental/English-style breakfast plate | brown bread slice | allergen gluten | yes | unlisted_miss | not listed; same flag on: Dark bread slice (allergens: gluten), Small sausages (mayContain: gluten), Baked beans in tomato sauce (mayContain: gluten) |
| prompt-v3:v3-eu-cell-25-flash-newprompt | 11 | Wiener Schnitzel with fries and side salad | breaded fried schnitzel (pork/veal cutlet) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Breaded cutlet (allergens: gluten) |
| prompt-v3:v3-eu-cell-25-flash-newprompt | 31 | Bowl of beef/oxtail soup with buttered bread | buttered bread slices (dark/whole-grain) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Beef stew (mayContain: gluten), Whole grain bread with butter (allergens: gluten) |
| prompt-v3:v3-eu-cell-25-flash-newprompt | 31 | Bowl of beef/oxtail soup with buttered bread | buttered bread slices (dark/whole-grain) | allergen milk | yes | unlisted_miss | not listed; same flag on: Whole grain bread with butter (allergens: milk) |
| prompt-v3:v3-eu-cell-25-flash-newprompt | 33 | Bowl of oatmeal porridge with toppings | oatmeal/oat porridge | allergen gluten | yes | miss | Cooked oatmeal P[] A['milk'] M[] |
| prompt-v3:v3-eu-cell-25-flash-newprompt | 36 | Seafood paella in the pan | whole prawns (langostinos) | allergen crustaceans | yes | unlisted_miss | not listed; same flag on: Seafood paella with artichoke (allergens: crustaceans) |
| prompt-v3:v3-eu-cell-25-flash-newprompt | 36 | Seafood paella in the pan | mantis shrimp (galeras) | allergen crustaceans | yes | unlisted_miss | not listed; same flag on: Seafood paella with artichoke (allergens: crustaceans) |
| prompt-v3:v3-eu-cell-25-flash-newprompt | 43 | Buffet lunch set, main plate, soup bowl, bread plate | cheese-topped quiche/gratin square | allergen eggs | no | miss | Potato gratin P[] A['milk'] M[] |
| prompt-v3:v3-eu-cell-25-flash-newprompt | 47 | Café brunch table spread (top-down) | seeded bagel (dark, sesame-topped) | allergen sesame | yes | unlisted_miss | not listed; same flag on: Chocolate donut with sesame seeds (allergens: sesame) |
| prompt-v3:v3-eu-cell-25-flash-newprompt | 47 | Café brunch table spread (top-down) | seeded bagel (dark, sesame-topped) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Smoothie bowl with fruit and granola (mayContain: gluten), Eggs Benedict with cherry tomatoes (allergens: gluten), Avocado toast with poached egg and cherry tomatoes (allergens: gluten), Chocolate donut with sesame seeds (allergens: gluten) |
| prompt-v3:v3-eu-cell-25-flash-newprompt | 47 | Café brunch table spread (top-down) | cherry tomato salad with balsamic drizzle | allergen sulphites | no | miss | Eggs Benedict with cherry tomatoes P['raw-egg'] A['eggs', 'gluten', 'milk'] M['mustard']; Avocado toast with poached egg and cherry tomatoes P['raw-egg'] A['eggs', 'gluten'] M[] |

## Failed calls (scored by rule 1, not as flag misses)

| cell | run | case | text | finish or error | clear must_flag entries | flags the truncated text had written |
|---|---|---|---|---|---|---|
| B | eval-harness:text-eu-cell-38-newprompt-r1 | t040 | Graved Lachs mit Senf-Dill-Sauce | length | allergen fish, allergen mustard | "flags": { "pregnancy": [ "raw-fish" ], "allergens": [ "fish" ], "mayContain": [] } |
| B | eval-harness:text-eu-cell-38-newprompt-r2 | t040 | Graved Lachs mit Senf-Dill-Sauce | length | allergen fish, allergen mustard | "flags": { "pregnancy": [ "raw-fish" ], "allergens": [ "fish", "mustard" ], "mayContain": [] } |
| B | eval-harness:text-eu-cell-38-newprompt-r3 | t044 | 4 slices of prosciutto with melon | length | pregnancy raw-meat | "flags": { "pregnancy": [ "raw-meat" ], "allergens": [], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": [], "mayContain": [] } |
| F25 | prompt-v3:v3-text-eu-cell-25-flash-newprompt-r1 | t035 | Etwas Käse | length | allergen milk | "flags": { "pregnancy": [], "allergens": ["milk"], "mayContain": ["lupin", "nuts", "peanuts", "soybeans", "celery", "crustaceans", "eggs", "fish", "gluten", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts", "peanuts", "soybeans", "gluten", "celery", "crustaceans", "lupin", "molluscs", "mustard", "sesame", "sulphites", "milk", "fish", "eggs", "nuts |
| F25 | prompt-v3:v3-eu-cell-25-flash-newprompt | 15 | Bavarian Weisswurst breakfast | API error in a 200 body: {"message": "Provider returned error", "code": 429, "metadata": {"error_type": "rate_limit_exce | allergen gluten, allergen mustard | none |

## Not blocking: demotions, false alarms, extra flags

| cell | source | cases | demotions clear (distinct) | demotions not clear | preg false alarms (distinct) | allergen false alarms (distinct) | extra preg flags per case | extra allergen flags per case | items outside the gold, their flags |
|---|---|---|---|---|---|---|---|---|---|
| B | typed | 264 | 0 (0) | 4 | 3 (1) | 3 (1) | 0.02 | 0.85 | 3, 0 |
| B | plates | 50 | 4 (4) | 4 | 1 (1) | 0 (0) | 0.08 | 2.94 | 5, 14 |
| C3 | typed | 267 | 0 (0) | 6 | 3 (1) | 3 (1) | 0.02 | 0.76 | 3, 0 |
| C3 | plates | 100 | 10 (6) | 7 | 2 (1) | 0 (0) | 0.12 | 3.07 | 7, 23 |
| F25 | typed | 266 | 4 (4) | 4 | 6 (3) | 3 (1) | 0.06 | 0.79 | 18, 27 |
| F25 | plates | 49 | 2 (2) | 2 | 3 (3) | 0 (0) | 0.04 | 2.51 | 24, 42 |

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

### Cell F25: demotions (12)

- 06 sushi rolls (salmon+avocado uramaki, sesame): sesame in mayContain, 1 answer(s)
- 12 mustard/onion-gravy drizzle on the sausages: mustard in mayContain, 1 answer(s), clear:false
- 32 herb crackers: sesame in mayContain, 1 answer(s), clear:false
- 47 yogurt bowl with granola, kiwi slices and berry compote: gluten in mayContain, 1 answer(s)
- t020 oat milk: gluten in mayContain, 1 answer(s)
- t023 Waldorf salad: celery in mayContain, 1 answer(s)
- t041 salmon poke bowl: sesame in mayContain, 1 answer(s)
- t045 brie and grape sandwich: gluten in mayContain, 1 answer(s)
- t061 Big Mac: mustard in mayContain, 1 answer(s), clear:false
- t071 curry: nuts in mayContain, 3 answer(s), clear:false

### Cell B: false alarms on must_not_flag (7)

- 03 feta cheese: pregnancy soft-cheese (in pregnancy), 1 answer(s)
- t068 coconut yogurt: allergen nuts (in mayContain), 3 answer(s)
- t089 white cheese: pregnancy soft-cheese (in pregnancy), 3 answer(s)

### Cell C3: false alarms on must_not_flag (8)

- 03 feta cheese: pregnancy soft-cheese (in pregnancy), 2 answer(s)
- t068 coconut yogurt: allergen nuts (in mayContain), 3 answer(s)
- t089 white cheese: pregnancy soft-cheese (in pregnancy), 3 answer(s)

### Cell F25: false alarms on must_not_flag (12)

- 03 feta cheese: pregnancy soft-cheese (in pregnancy), 1 answer(s)
- 03 grilled salmon fillets: pregnancy high-mercury-fish (in pregnancy), 1 answer(s)
- 29 cheese cubes: pregnancy soft-cheese (in pregnancy), 1 answer(s)
- t027 lupin coffee: pregnancy caffeine (in pregnancy), 1 answer(s)
- t031 mozzarella: pregnancy soft-cheese (in pregnancy), 2 answer(s)
- t068 coconut yogurt: allergen nuts (in allergens), 3 answer(s)
- t089 white cheese: pregnancy soft-cheese (in pregnancy), 3 answer(s)

## Per category and per allergen

Misses / tested entries, typed repeats and plates together. Demotions in brackets.

| kind | value | B clear | C3 clear | F25 clear | B not clear | C3 not clear | F25 not clear |
|---|---|---|---|---|---|---|---|
| pregnancy | raw-dairy | 0/9 | 0/9 | 0/9 | 0/9 | 0/9 | 1/8 |
| pregnancy | soft-cheese | 0/12 | 0/12 | 0/12 | 0/0 | 0/0 | 0/0 |
| pregnancy | raw-meat | 0/22 | 0/25 | 0/23 | 0/6 | 0/6 | 0/6 |
| pregnancy | raw-egg | 0/17 | 0/19 | 0/17 | 0/8 | 0/10 | 0/8 |
| pregnancy | raw-fish | 0/22 | 0/26 | 0/22 | 0/1 | 0/3 | 0/3 |
| pregnancy | smoked-fish | 0/9 | 0/9 | 0/9 | 0/1 | 0/3 | 0/3 |
| pregnancy | high-mercury-fish | 0/13 | 0/14 | 0/13 | 0/0 | 0/0 | 0/0 |
| pregnancy | liver-retinol | 0/13 | 0/14 | 0/13 | 0/0 | 0/0 | 0/0 |
| pregnancy | alcohol | 0/18 | 0/25 | 0/18 | 0/1 | 0/2 | 0/1 |
| pregnancy | caffeine | 0/16 | 0/17 | 0/16 | 0/9 | 0/12 | 0/10 |
| pregnancy | raw-sprouts | 0/13 | 0/14 | 0/13 | 0/0 | 0/0 | 0/0 |
| allergen | gluten | 0/135 (1) | 0/177 (2) | 8/132 (3) | 0/4 | 0/6 | 0/5 |
| allergen | crustaceans | 0/11 | 0/13 | 3/11 | 0/0 | 0/0 | 0/0 |
| allergen | eggs | 0/55 | 0/71 | 0/55 | 0/25 (1) | 0/29 (3) | 1/24 |
| allergen | fish | 0/46 (1) | 0/57 | 0/48 | 0/9 (1) | 0/9 | 1/9 |
| allergen | peanuts | 0/10 | 0/11 | 0/10 | 0/0 | 0/0 | 0/1 |
| allergen | soybeans | 1/12 | 1/15 | 0/12 | 0/3 | 0/6 | 0/4 |
| allergen | milk | 1/108 (2) | 1/135 (8) | 1/108 | 0/13 (2) | 0/22 (4) | 0/13 |
| allergen | nuts | 0/10 | 0/11 | 0/10 | 0/3 (3) | 0/3 (3) | 0/3 (3) |
| allergen | celery | 0/9 | 0/9 | 4/9 (1) | 0/0 | 0/0 | 0/0 |
| allergen | mustard | 0/8 | 0/11 | 0/9 | 0/5 | 0/7 | 1/5 (2) |
| allergen | sesame | 0/15 | 0/18 | 1/15 (2) | 0/4 (1) | 0/8 (2) | 0/4 (1) |
| allergen | sulphites | 0/9 | 0/11 | 0/10 | 0/1 | 1/4 (1) | 1/2 |
| allergen | lupin | 0/12 | 0/12 | 2/12 | 0/0 | 0/0 | 0/0 |
| allergen | molluscs | 0/12 | 0/12 | 0/12 | 0/0 | 0/0 | 0/0 |

## Sanity: gold labels every cell contradicts the same way

Entries that B, C3 and F25 all contradict come first, then entries two of the three contradict (to fill
ten rows), each group ranked by the lowest rate among the contradicting cells (contradicting answers
over answers that judged the entry). The gold files are not changed here; a view is a proposal.

| cells | list | case | text | item | flag | clear | way | B | C3 | F25 | view |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 of 3 | must_not_flag | 03 | Greek-style salad with grilled salmon | feta cheese | pregnancy soft-cheese | yes | flagged although must_not_flag | 1/1 | 2/2 | 1/1 |  |
| 3 of 3 | must_flag | 32 | Charcuterie/snack board (compartmented bamboo tray, top-down) | herb crackers | allergen sesame | no | demoted to mayContain | 1/1 | 2/2 | 1/1 | Gold arguable, already clear:false. Herb crackers do not plainly hold sesame. Proposal: move to may_flag; mayContain is the honest list. |
| 3 of 3 | must_not_flag | t068 | 150 g plant-based coconut yogurt (dairy-free) | coconut yogurt | allergen nuts | yes | flagged although must_not_flag | 3/3 | 3/3 | 3/3 | Coconut is not an EU Annex II nut, so nuts in `allergens` is wrong. In mayContain it is a cross-contact hedge. Proposal: keep must_not for `allergens`, accept nuts in mayContain. |
| 3 of 3 | must_flag | t071 | some curry from the place downstairs | curry | allergen nuts | no | demoted to mayContain | 3/3 | 3/3 | 3/3 | Unknown curry: mayContain is the honest list, and it shows a chip. Proposal: accept mayContain as the expected list (no demotion). |
| 3 of 3 | must_not_flag | t089 | Kahvaltıda iki yumurtalı menemen ve beyaz peynir | white cheese | pregnancy soft-cheese | yes | flagged although must_not_flag | 3/3 | 3/3 | 3/3 | Gold right: beyaz peynir is brined, not mould-ripened or blue. A false alarm. No change. |
| 2 of 3 | must_flag | 05 | Chicken in creamy leafy-green sauce with white rice | chicken pieces in creamy sauce with leafy greens (spinach-type) | allergen milk | no | demoted to mayContain | 1/1 | 2/2 | 0/1 | The cream may be coconut milk. clear:false is right; mayContain is a fair answer. No change. |
| 2 of 3 | must_flag | 37 | Pierogi ruskie with carrot-cabbage salad | pierogi/boiled dumplings (potato-cheese filling) | allergen milk | yes | demoted to mayContain | 1/1 | 2/2 | 0/1 | Gold right: pierogi ruskie hold quark. The cells hedge. No change. |
| 2 of 3 | must_flag | 47 | Café brunch table spread (top-down) | yogurt bowl with granola, kiwi slices and berry compote | allergen milk | yes | demoted to mayContain | 1/1 | 2/2 | 0/1 | All cells read the bowl as a smoothie or acai bowl, so they hedge milk. The photo cannot prove a yogurt base. Proposal: set clear:false. The chip still shows. |
| 2 of 3 | must_flag | 06 | Sushi platter (restaurant table) | soy sauce | allergen soybeans | yes | missed | 1/1 | 1/2 | 0/1 |  |
| 2 of 3 | must_flag | 33 | Bowl of oatmeal porridge with toppings | milk | allergen milk | yes | missed | 1/1 | 1/2 | 0/1 |  |

