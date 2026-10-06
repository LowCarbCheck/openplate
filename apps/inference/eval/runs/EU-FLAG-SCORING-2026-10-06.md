# EU switch: safety flags of the typed and plate cells (2026-10-06)

Written by `python3 -m harness.score_flags`. No model call. The gold is `gold/gold_text.jsonl` and
`gold/gold_plate_flags.json`, read as `gold/GOLD-NOTES.md` section 2 says. The machine readable
twin of this file holds every entry, every holder and every flag.

Legend for a model item: `P[...]` pregnancy, `A[...]` allergens, `M[...]` mayContain.

## Runs

| cell | label | typed repeats scored | plate run |
|---|---|---|---|
| B | 3.8, default reasoning, new prompt | text-eu-cell-38-newprompt-r1, text-eu-cell-38-newprompt-r2, text-eu-cell-38-newprompt-r3 | eu-cell-38-newprompt |
| C | 3.8, reasoning minimal, new prompt | text-eu-cell-38-minimal-newprompt-r1, text-eu-cell-38-minimal-newprompt-r2, text-eu-cell-38-minimal-newprompt-r3 | eu-cell-38-minimal-newprompt |
| D | 3.5 flash lite EU, minimal, new prompt | text-eu-cell-35-eu-newprompt-r1, text-eu-cell-35-eu-newprompt-r2, text-eu-cell-35-eu-newprompt-r3 | eu-cell-35-eu-newprompt |
| skipped | `eu-cell-38-prod-oldprompt` | cell A: OLD small schema without flags, no flags to score | |
| skipped | `eu-cell-35-eu-oldprompt` | cell E: OLD small schema without flags, no flags to score | |

## Decision rules

Clear entries decide. Typed misses are summed over the repeats (scaled to 3 when a cell has fewer).
Beside the verdict, for a reader to judge: each distinct entry counted once; the misses on listed
items only (a food the answer did not list at all is left out); the plates read with the recall
worksheet's listing (a core item the worksheet marks `n` counts as not listed); and the totals with the
`clear: false` entries added. None of these four decides a rule.

| rule | test | verdict | clear misses | distinct entries | listed items only | worksheet listing | with clear:false |
|---|---|---|---|---|---|---|---|
| 2 | D: zero misses on the clear pregnancy must-flag typed cases, in every repeat | **FAIL** | misses per repeat [2, 3, 3]; distinct entries missed 4 | | | | failed calls left out (rule 1); their clear pregnancy entries per repeat [0, 0, 3]; counted as misses: FAIL |
| 3 | D total pregnancy misses (typed plus plates) no higher than B | **FAIL** | D 9.0 vs B 0.0 | D 5 vs B 0 (FAIL) | D 8.0 vs B 0.0 (FAIL) | D 15.0 vs B 2.0 (FAIL) | D 15.0 vs B 0.0 (FAIL) |
| 3 | D total pregnancy misses (typed plus plates) no higher than C | **FAIL** | D 9.0 vs C 2.0 | D 5 vs C 2 (FAIL) | D 8.0 vs C 2.0 (FAIL) | D 15.0 vs C 3.0 (FAIL) | D 15.0 vs C 2.0 (FAIL) |
| 4 | D total allergen misses (typed plus plates) no higher than B | **FAIL** | D 3.0 vs B 2.0 | D 3 vs B 2 (FAIL) | D 0.0 vs B 1.0 (PASS) | D 25.0 vs B 6.0 (FAIL) | D 6.0 vs B 2.0 (FAIL) |
| 4 | D total allergen misses (typed plus plates) no higher than C | **FAIL** | D 3.0 vs C 1.0 | D 3 vs C 1 (FAIL) | D 0.0 vs C 0.0 (PASS) | D 25.0 vs C 6.0 (FAIL) | D 6.0 vs C 3.0 (FAIL) |

## Miss counts per cell

Typed counts are summed over the scored repeats. `per 3` scales a cell with fewer repeats to three.
`distinct` counts an entry once however many repeats missed it. `unlisted` = the item was not in the
answer at all (a clear must_flag only); `elsewhere` = of those, the same flag sat on another item.

| cell | reps | preg clear typed | per 3 | distinct | preg clear plates | preg nonclear typed / plates | alg clear typed | per 3 | distinct | alg clear plates | alg nonclear typed / plates |
|---|---|---|---|---|---|---|---|---|---|---|---|
| B | 3 | 0 | 0.0 | 0 | 0 | 0 / 0 | 0 | 0.0 | 0 | 2 | 0 / 0 |
| C | 3 | 1 | 1.0 | 1 | 1 | 0 / 0 | 0 | 0.0 | 0 | 1 | 0 / 2 |
| D | 3 | 8 | 8.0 | 4 | 1 | 5 / 1 | 0 | 0.0 | 0 | 3 | 2 / 1 |

| cell | source | clear preg tested | clear preg miss (unlisted, elsewhere) | clear alg tested | clear alg miss (unlisted, elsewhere) | if_listed misses | failed calls |
|---|---|---|---|---|---|---|---|
| B | typed | 146 | 0 (0, 0) | 347 | 0 (0, 0) | 0 | 3 |
| B | plates | 18 | 0 (0, 0) | 105 | 2 (1, 1) | 0 | 0 |
| C | typed | 147 | 1 (0, 0) | 351 | 0 (0, 0) | 0 | 0 |
| C | plates | 17 | 1 (0, 0) | 104 | 1 (1, 1) | 0 | 0 |
| D | typed | 144 | 8 (0, 0) | 350 | 0 (0, 0) | 0 | 2 |
| D | plates | 18 | 1 (1, 1) | 103 | 3 (3, 3) | 1 | 0 |

## Every miss

### Cell B: pregnancy misses (0)

None.

### Cell B: allergen misses (2)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| eu-cell-38-newprompt | 06 | Sushi platter (restaurant table) | soy sauce | allergen soybeans | yes | unlisted_miss | not listed; same flag on: salmon avocado roll (mayContain: soybeans), assorted nigiri sushi (mayContain: soybeans) |
| eu-cell-38-newprompt | 33 | Bowl of oatmeal porridge with toppings | milk | allergen milk | yes | miss | cooked oatmeal P[] A[] M['gluten'] |

### Cell C: pregnancy misses (2)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| text-eu-cell-38-minimal-newprompt-r2 | t050 | Chicken liver pate on toast | chicken liver pate on toast | pregnancy raw-meat | yes | miss | Chicken liver pate P['liver-retinol'] A['milk'] M['eggs', 'gluten', 'sulphites']; Toast P[] A['gluten'] M['milk', 'sesame', 'soybeans'] |
| eu-cell-38-minimal-newprompt | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | pregnancy raw-fish | yes | miss | Assorted Korean banchan side dishes P[] A['sesame', 'soybeans'] M['crustaceans', 'fish', 'gluten'] |

### Cell C: allergen misses (3)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| eu-cell-38-minimal-newprompt | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | grilled mackerel/fish | allergen fish | yes | unlisted_miss | not listed; same flag on: Spicy glazed fish or pork (mayContain: fish), Tofu with stir-fried kimchi (mayContain: fish), Korean steamed egg custard (mayContain: fish), Assorted Korean banchan side dishes (mayContain: fish) |
| eu-cell-38-minimal-newprompt | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | vegetable fritters/jeon platter | allergen eggs | no | miss | Assorted Korean banchan side dishes P[] A['sesame', 'soybeans'] M['crustaceans', 'fish', 'gluten'] |
| eu-cell-38-minimal-newprompt | 47 | Café brunch table spread (top-down) | cherry tomato salad with balsamic drizzle | allergen sulphites | no | miss | avocado toast with poached eggs and cherry tomatoes P['raw-egg'] A['eggs', 'gluten'] M['milk', 'sesame']; eggs benedict with hollandaise and tomatoes P['raw-egg'] A['eggs', 'gluten', 'milk'] M['mustard', 'sesame'] |

### Cell D: pregnancy misses (15)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| text-eu-cell-35-eu-newprompt-r1 | t050 | Chicken liver pate on toast | chicken liver pate on toast | pregnancy raw-meat | yes | miss | chicken liver pate P['liver-retinol'] A['milk'] M['eggs', 'gluten', 'mustard']; toast P[] A['gluten'] M['milk', 'sesame', 'soybeans'] |
| text-eu-cell-35-eu-newprompt-r1 | t055 | 40 g of Comté | Comté cheese | pregnancy raw-dairy | no | miss | Comté cheese P[] A['milk'] M[] |
| text-eu-cell-35-eu-newprompt-r1 | t080 | Foie gras mi-cuit sur pain d'épices | foie gras mi-cuit | pregnancy raw-meat | no | miss | foie gras mi-cuit P['liver-retinol'] A[] M[] |
| text-eu-cell-35-eu-newprompt-r1 | t084 | Vitello tonnato, una porzione | vitello tonnato | pregnancy high-mercury-fish | yes | miss | vitello tonnato P['raw-egg'] A['eggs', 'fish'] M['mustard'] |
| text-eu-cell-35-eu-newprompt-r2 | t050 | Chicken liver pate on toast | chicken liver pate on toast | pregnancy raw-meat | yes | miss | chicken liver pate P['liver-retinol'] A['milk'] M['eggs', 'gluten', 'sulphites']; toast P[] A['gluten', 'soybeans'] M['milk', 'sesame'] |
| text-eu-cell-35-eu-newprompt-r2 | t055 | 40 g of Comté | Comté cheese | pregnancy raw-dairy | no | miss | Comté cheese P[] A['milk'] M[] |
| text-eu-cell-35-eu-newprompt-r2 | t080 | Foie gras mi-cuit sur pain d'épices | foie gras mi-cuit | pregnancy liver-retinol | yes | miss | foie gras mi-cuit P[] A[] M[] |
| text-eu-cell-35-eu-newprompt-r2 | t080 | Foie gras mi-cuit sur pain d'épices | foie gras mi-cuit | pregnancy raw-meat | no | miss | foie gras mi-cuit P[] A[] M[] |
| text-eu-cell-35-eu-newprompt-r2 | t084 | Vitello tonnato, una porzione | vitello tonnato | pregnancy high-mercury-fish | yes | miss | vitello tonnato P['raw-egg'] A['eggs', 'fish'] M['mustard'] |
| text-eu-cell-35-eu-newprompt-r3 | t045 | Brie and grape sandwich on sourdough | brie and grape sandwich | pregnancy soft-cheese | yes | miss | Brie and grape sandwich on sourdough P[] A['gluten', 'milk'] M['nuts', 'sesame'] |
| text-eu-cell-35-eu-newprompt-r3 | t050 | Chicken liver pate on toast | chicken liver pate on toast | pregnancy raw-meat | yes | miss | chicken liver pate P['liver-retinol'] A['milk'] M['eggs', 'gluten', 'mustard']; toast P[] A['gluten'] M['milk', 'sesame', 'soybeans'] |
| text-eu-cell-35-eu-newprompt-r3 | t080 | Foie gras mi-cuit sur pain d'épices | foie gras mi-cuit | pregnancy raw-meat | no | miss | foie gras mi-cuit P['liver-retinol'] A[] M[] |
| text-eu-cell-35-eu-newprompt-r3 | t084 | Vitello tonnato, una porzione | vitello tonnato | pregnancy high-mercury-fish | yes | miss | vitello tonnato P['raw-egg'] A['eggs', 'fish'] M['mustard', 'sulphites'] |
| eu-cell-35-eu-newprompt | 22 | Three soft tacos with a corn cob | glass of cola | pregnancy caffeine | no | miss | cola P[] A[] M[] |
| eu-cell-35-eu-newprompt | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | pregnancy raw-egg | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (pregnancy: raw-egg) |

### Cell D: allergen misses (6)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| text-eu-cell-35-eu-newprompt-r1 | t061 | A Big Mac and medium fries | Big Mac | allergen mustard | no | miss | Big Mac P[] A['eggs', 'gluten', 'milk', 'sesame'] M['soybeans'] |
| text-eu-cell-35-eu-newprompt-r3 | t061 | A Big Mac and medium fries | Big Mac | allergen mustard | no | miss | Big Mac P[] A['eggs', 'gluten', 'milk', 'sesame'] M['soybeans'] |
| eu-cell-35-eu-newprompt | 05 | Chicken in creamy leafy-green sauce with white rice | chicken pieces in creamy sauce with leafy greens (spinach-type) | allergen milk | no | miss | chicken and greens stew P[] A[] M['celery'] |
| eu-cell-35-eu-newprompt | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen eggs | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (allergens: eggs), bagel (mayContain: eggs) |
| eu-cell-35-eu-newprompt | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen gluten | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (allergens: gluten), acai bowl with fruit (allergens: gluten), bagel (allergens: gluten) |
| eu-cell-35-eu-newprompt | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen milk | yes | unlisted_miss | not listed; same flag on: acai bowl with fruit (mayContain: milk), bagel (mayContain: milk), iced coffee (allergens: milk) |

## Failed calls (scored by rule 1, not as flag misses)

| cell | run | case | text | finish | clear must_flag entries | flags the truncated text had written |
|---|---|---|---|---|---|---|
| B | text-eu-cell-38-newprompt-r1 | t040 | Graved Lachs mit Senf-Dill-Sauce | length | allergen fish, allergen mustard | "flags": { "pregnancy": [ "raw-fish" ], "allergens": [ "fish" ], "mayContain": [] } |
| B | text-eu-cell-38-newprompt-r2 | t040 | Graved Lachs mit Senf-Dill-Sauce | length | allergen fish, allergen mustard | "flags": { "pregnancy": [ "raw-fish" ], "allergens": [ "fish", "mustard" ], "mayContain": [] } |
| B | text-eu-cell-38-newprompt-r3 | t044 | 4 slices of prosciutto with melon | length | pregnancy raw-meat | "flags": { "pregnancy": [ "raw-meat" ], "allergens": [], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": [], "mayContain": [] } |
| D | text-eu-cell-35-eu-newprompt-r3 | t072 | Rare ribeye steak, 250 g | error | pregnancy raw-meat | none |
| D | text-eu-cell-35-eu-newprompt-r3 | t079 | Un steak tartare avec un jaune d'oeuf cru, et des frites | error | pregnancy raw-meat, pregnancy raw-egg, allergen eggs | "flags": { "pregnancy": ["raw-meat", "raw-egg"], "allergens": ["eggs", "mustard"], "mayContain": ["gluten", "fish", "sulphites", "celery"] } |

## Not blocking: demotions, false alarms, extra flags

| cell | source | cases | demotions clear (distinct) | demotions not clear | preg false alarms (distinct) | allergen false alarms (distinct) | extra preg flags per case | extra allergen flags per case | items outside the gold, their flags |
|---|---|---|---|---|---|---|---|---|---|
| B | typed | 264 | 0 (0) | 4 | 3 (1) | 3 (1) | 0.02 | 0.85 | 3, 0 |
| B | plates | 50 | 4 (4) | 4 | 1 (1) | 0 (0) | 0.08 | 2.94 | 5, 14 |
| C | typed | 267 | 0 (0) | 6 | 4 (2) | 3 (1) | 0.01 | 0.84 | 3, 0 |
| C | plates | 50 | 5 (5) | 4 | 1 (1) | 0 (0) | 0.02 | 3.02 | 3, 7 |
| D | typed | 265 | 3 (2) | 6 | 4 (2) | 3 (1) | 0.02 | 0.80 | 4, 0 |
| D | plates | 50 | 1 (1) | 2 | 1 (1) | 0 (0) | 0.12 | 1.58 | 4, 12 |

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

## Per category and per allergen

Misses / tested entries, typed repeats and plates together. Demotions in brackets.

| kind | value | B clear | C clear | D clear | B not clear | C not clear | D not clear |
|---|---|---|---|---|---|---|---|
| pregnancy | raw-dairy | 0/9 | 0/9 | 0/9 | 0/9 | 0/9 | 2/9 |
| pregnancy | soft-cheese | 0/12 | 0/12 | 1/12 | 0/0 | 0/0 | 0/0 |
| pregnancy | raw-meat | 0/22 | 1/23 | 3/21 | 0/6 | 0/6 | 3/6 |
| pregnancy | raw-egg | 0/17 | 0/17 | 1/16 | 0/8 | 0/8 | 0/8 |
| pregnancy | raw-fish | 0/22 | 1/22 | 0/22 | 0/1 | 0/3 | 0/3 |
| pregnancy | smoked-fish | 0/9 | 0/9 | 0/9 | 0/1 | 0/3 | 0/3 |
| pregnancy | high-mercury-fish | 0/13 | 0/13 | 3/13 | 0/0 | 0/0 | 0/0 |
| pregnancy | liver-retinol | 0/13 | 0/13 | 1/13 | 0/0 | 0/0 | 0/0 |
| pregnancy | alcohol | 0/18 | 0/17 | 0/18 | 0/1 | 0/1 | 0/1 |
| pregnancy | caffeine | 0/16 | 0/16 | 0/16 | 0/9 | 0/8 | 1/8 |
| pregnancy | raw-sprouts | 0/13 | 0/13 | 0/13 | 0/0 | 0/0 | 0/0 |
| allergen | gluten | 0/135 (1) | 0/133 (1) | 1/133 | 0/4 | 0/5 (1) | 0/5 |
| allergen | crustaceans | 0/11 | 0/11 | 0/11 | 0/0 | 0/0 | 0/0 |
| allergen | eggs | 0/55 | 0/55 | 1/54 | 0/25 (1) | 1/25 | 0/25 (1) |
| allergen | fish | 0/46 (1) | 1/48 (1) | 0/48 | 0/9 (1) | 0/9 (3) | 0/9 (3) |
| allergen | peanuts | 0/10 | 0/10 | 0/10 | 0/0 | 0/0 | 0/0 |
| allergen | soybeans | 1/12 | 0/12 | 0/12 | 0/3 | 0/3 | 0/3 |
| allergen | milk | 1/108 (2) | 0/109 (3) | 1/107 (1) | 0/13 (2) | 0/13 (2) | 1/13 |
| allergen | nuts | 0/10 | 0/10 | 0/10 | 0/3 (3) | 0/3 (3) | 0/3 (3) |
| allergen | celery | 0/9 | 0/9 | 0/9 | 0/0 | 0/0 | 0/0 |
| allergen | mustard | 0/8 | 0/10 | 0/10 | 0/5 | 0/5 | 2/4 |
| allergen | sesame | 0/15 | 0/15 | 0/15 | 0/4 (1) | 0/4 (1) | 0/4 (1) |
| allergen | sulphites | 0/9 | 0/9 | 0/10 (2) | 0/1 | 1/2 | 0/1 |
| allergen | lupin | 0/12 | 0/12 | 0/12 (1) | 0/0 | 0/0 | 0/0 |
| allergen | molluscs | 0/12 | 0/12 | 0/12 | 0/0 | 0/0 | 0/0 |

## Sanity: gold labels every cell contradicts the same way

Entries that B, C and D all contradict come first, then entries two of the three contradict (to fill
ten rows), each group ranked by the lowest rate among the contradicting cells (contradicting answers
over answers that judged the entry). The gold files are not changed here; a view is a proposal.

| cells | list | case | text | item | flag | clear | way | B | C | D | view |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 of 3 | must_flag | 32 | Charcuterie/snack board (compartmented bamboo tray, top-down) | herb crackers | allergen sesame | no | demoted to mayContain | 1/1 | 1/1 | 1/1 | Gold arguable, already clear:false. Herb crackers do not plainly hold sesame. Proposal: move to may_flag; mayContain is the honest list. |
| 3 of 3 | must_flag | 47 | Café brunch table spread (top-down) | yogurt bowl with granola, kiwi slices and berry compote | allergen milk | yes | demoted to mayContain | 1/1 | 1/1 | 1/1 | All cells read the bowl as a smoothie or acai bowl, so they hedge milk. The photo cannot prove a yogurt base. Proposal: set clear:false. The chip still shows. |
| 3 of 3 | must_not_flag | t068 | 150 g plant-based coconut yogurt (dairy-free) | coconut yogurt | allergen nuts | yes | flagged although must_not_flag | 3/3 | 3/3 | 3/3 | Coconut is not an EU Annex II nut, so nuts in `allergens` is wrong. In mayContain it is a cross-contact hedge. Proposal: keep must_not for `allergens`, accept nuts in mayContain. |
| 3 of 3 | must_flag | t071 | some curry from the place downstairs | curry | allergen nuts | no | demoted to mayContain | 3/3 | 3/3 | 3/3 | Unknown curry: mayContain is the honest list, and it shows a chip. Proposal: accept mayContain as the expected list (no demotion). |
| 3 of 3 | must_flag | t063 | A bowl of miso soup | miso soup | allergen fish | no | demoted to mayContain | 1/3 | 3/3 | 1/3 | Dashi holds fish in the plain recipe, but instant miso often has none. clear:false is right. No change. |
| 2 of 3 | must_flag | 05 | Chicken in creamy leafy-green sauce with white rice | chicken pieces in creamy sauce with leafy greens (spinach-type) | allergen milk | no | demoted to mayContain | 1/1 | 1/1 | 0/1 | The cream may be coconut milk. clear:false is right; mayContain is a fair answer. No change. |
| 2 of 3 | must_not_flag | 32 | Charcuterie/snack board (compartmented bamboo tray, top-down) | pan-fried spiced hard-boiled egg halves | pregnancy raw-egg | yes | flagged although must_not_flag | 0/1 | 1/1 | 1/1 | Gold right for the photo: hard-boiled egg halves. The cells read deviled eggs, whose filling can hold raw yolk mayonnaise. A false alarm, not a gold error. No change. |
| 2 of 3 | must_flag | 37 | Pierogi ruskie with carrot-cabbage salad | pierogi/boiled dumplings (potato-cheese filling) | allergen milk | yes | demoted to mayContain | 1/1 | 1/1 | 0/1 | Gold right: pierogi ruskie hold quark. The cells hedge. No change. |
| 2 of 3 | must_flag | 42 | Buffet lunch plate (many components) | sour cream / remoulade dollop | allergen milk | no | demoted to mayContain | 1/1 | 1/1 | 0/1 | Remoulade is egg and oil, not milk. clear:false is right. Proposal: move to may_flag. |
| 2 of 3 | must_flag | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | allergen fish | yes | demoted to mayContain | 1/1 | 1/1 | 0/1 | A scorer artefact, not a gold error: B and C name the hoe only inside a banchan plate label, which hedges fish for many dishes. No change. |

