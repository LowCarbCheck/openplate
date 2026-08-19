# Plate-identification scoring worksheet — FILLED

- results: `runs/2026-08-12-50img-qwenvl/results.json`
- config: `local-cpu-v2` (started 2026-08-12T14:39:43.896179+00:00)
- approaches: single_qwen_vl
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
- scored: 2026-08-12 (reviewing agent; images inspected for all ambiguous calls)

## Mechanical metrics (auto-computed)

| metric | single_qwen_vl |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 181 |
| items named (mean/plate) | 3.62 |
| distinct item names | 148 |
| latency mean (s) | 111.78 |
| latency median (s) | 94.35 |
| latency max (s) | 596.7 |
| cost / plate (USD) | 0.0 |
| cost total (USD) | 0.0 |

## Scoring conventions applied

Cells are `Y` (covered), `n` (missed), `Y?`/`n?` (judgment call for the architect).

1. **Named-dish consolidation counts.** Per the gold protocol ("Greek salad" may cover
   lettuce+cucumber+tomato), a reported salad covers its canonical vegetable constituents
   (lettuce, tomato, cucumber, onion, carrot, cabbage). Granularity loss noted per cell.
2. **Generic plural "vegetables" does not.** "chicken with sauce and vegetables" /
   "spaghetti with meat sauce and vegetables" names no vegetable — component rows scored
   `n?` (images 07, 27) and flagged as one policy question.
3. **Species/kind error = miss; cut/shape/preparation error = hit.** "grilled pork chop"
   for a rib slab is a hit; "fried fish" for a pork schnitzel, "chicken breast" for chashu
   pork, "breaded chicken breast" for a breaded fish fillet are misses.
4. **Misidentification of a present object is NOT a hallucination.** Hallucination is
   reserved for a food not visible at all. Every wrong name in this run maps onto a real
   object on the plate — see Findings.
5. **Trap leaks** (gold `trap` field) are counted separately from hallucinations.

> Gold-label protocol: Gold labels authored by hand from direct image inspection (Fable, 2026-08-11). 'core' = items a correct identification must include (synonyms/consolidations acceptable, e.g. 'Greek salad' may cover lettuce+cucumber+tomato). 'optional' = visible but acceptable to omit (garnish, condiments, off-plate drinks). Hallucination = any reported food not visible at all. Entries 11-50 (added 2026-08-11): drafted by two opus vision agents under the same protocol, spot-verified by Fable against images 12/19/22/39/45/46 before merge; manifest descriptions for 32/46/47 corrected to match images.

### 01 — Continental/English-style breakfast plate

- **single_qwen_vl**: whole wheat toast, bacon, baked beans, scrambled eggs, cucumber slices, sausage

| gold core item | single_qwen_vl | notes |
|---|---|---|
| scrambled eggs | Y |  |
| bacon/ham slices | Y |  |
| frankfurter sausages | Y | "sausage" — type unspecified |
| baked beans in tomato sauce | Y |  |
| brown bread slice | Y | "whole wheat toast" |
| cucumber slices | Y |  |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |

Recall: 6/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): butter/margarine packets

### 02 — Roast (Sunday) dinner

- **single_qwen_vl**: Yorkshire pudding, roast beef, mixed vegetables, gravy

| gold core item | single_qwen_vl | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y |  |
| Yorkshire pudding | Y |  |
| roast potatoes | n | two golden roast potatoes clearly visible; "mixed vegetables" does not name a starch |
| broccoli | Y | via "mixed vegetables" — granularity loss |
| cabbage/greens | Y | via "mixed vegetables" — granularity loss |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none |  |

Recall: 4/5
Hallucinations: none
Trap leaks: none

Optional (no recall credit): gravy as separate item

### 03 — Greek-style salad with grilled salmon

- **single_qwen_vl**: grilled salmon, side salad, feta cheese, avocado, black olives

| gold core item | single_qwen_vl | notes |
|---|---|---|
| grilled salmon fillets | Y |  |
| feta cheese | Y |  |
| kalamata olives | Y | "black olives" |
| avocado | Y |  |
| cherry tomatoes | Y | via "side salad" consolidation |
| cucumber | Y | via "side salad" consolidation |
| lettuce/romaine | Y | via "side salad" consolidation |
| red onion | Y | via "side salad" consolidation |
| **core recall (/8)** | 8/8 | 4 rows carried by one "side salad" token — heavy granularity loss |
| **hallucinations** | none |  |

Recall: 8/8
Hallucinations: none
Trap leaks: none

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04 — Cheeseburger with fries

- **single_qwen_vl**: cheeseburger, french fries, pickles

| gold core item | single_qwen_vl | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y |  |
| thick-cut fries/steak fries | Y |  |
| ketchup | n |  |
| pickles/gherkins | Y |  |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |

Recall: 3/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): lettuce in burger, beer in background

### 05 — Chicken in creamy leafy-green sauce with white rice

- **single_qwen_vl**: white rice, chicken curry with greens

| gold core item | single_qwen_vl | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | "chicken curry with greens" |
| white rice | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none
Trap leaks: none

Optional (no recall credit): red bell pepper bits in rice

### 06 — Sushi platter (restaurant table)

- **single_qwen_vl**: sushi roll, sashimi, wasabi, pickled ginger

| gold core item | single_qwen_vl | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | 3 uramaki confirmed in image |
| tuna nigiri | Y? | image shows 3 nigiri (white fish, tuna, white fish). One "sashimi" token — raw fish covered, rice base and species distinction lost |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | Y? | same single "sashimi" token stretched over a second nigiri row |
| pickled ginger | Y |  |
| wasabi | Y |  |
| soy sauce | n | soy dish clearly present on the platter |
| **core recall (/6)** | 5/6 | 2 flagged cells; if the architect refuses "sashimi"→nigiri, recall is 3/6 |
| **hallucinations** | none |  |

Recall: 5/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): white wine / water glasses in background

### 07 — Spaghetti with meat-vegetable sauce

- **single_qwen_vl**: spaghetti with meat sauce and vegetables

| gold core item | single_qwen_vl | notes |
|---|---|---|
| spaghetti | Y |  |
| ground beef/meat tomato sauce | Y |  |
| corn kernels | n? | visible in image; only the generic token "vegetables" was reported |
| green beans | n? | same generic-plural policy question |
| carrot pieces | n? | same generic-plural policy question |
| **core recall (/5)** | 2/5 | if generic "vegetables" earns blanket credit, 5/5 |
| **hallucinations** | none |  |

Recall: 2/5
Hallucinations: none
Trap leaks: none

### 08 — Yogurt granola bowl with apple

- **single_qwen_vl**: yogurt, granola, apple slices

| gold core item | single_qwen_vl | notes |
|---|---|---|
| yogurt | Y |  |
| granola (oats/puffed grains, nuts) | Y |  |
| apple slices | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09 — Whole chicken pizza in delivery box

- **single_qwen_vl**: pizza, cola

| gold core item | single_qwen_vl | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | toppings unspecified |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none | "cola" = optional gold item |

Recall: 1/1
Hallucinations: none
Trap leaks: none

Optional (no recall credit): cola drink at table edge

### 10 — Club sandwich with side salad (cafe table)

- **single_qwen_vl**: club sandwich, side salad, pepsi max

| gold core item | single_qwen_vl | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y |  |
| green side salad (rocket/mixed leaves) | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "pepsi max" = optional gold item |

Recall: 2/2
Hallucinations: none
Trap leaks: none — no menu-poster dish (burrito/quesadilla/fritter) reported

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11 — Wiener Schnitzel with fries and side salad

- **single_qwen_vl**: fried fish, french fries, side salad, tartar sauce

| gold core item | single_qwen_vl | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | n | reported as "fried fish" — image shows a meat cutlet; species error = miss |
| thick-cut fries/potato wedges | Y |  |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y |  |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | "tartar sauce" maps to the creamy salad dressing / ketchup ramekin actually in frame, so not scored as invented food |

Recall: 2/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12 — Bratwurst plate with sauerkraut and mashed potatoes

- **single_qwen_vl**: grilled sausages, mashed potatoes, sauerkraut

| gold core item | single_qwen_vl | notes |
|---|---|---|
| bratwurst sausages | Y |  |
| sauerkraut | Y |  |
| mashed potatoes | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none — background second plate's food not reported

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13 — Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **single_qwen_vl**: macaroni and cheese, caramelized onions, side salad

| gold core item | single_qwen_vl | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y | "macaroni and cheese" — noodles-in-melted-cheese covered, regional dish + pasta shape lost |
| fried/caramelised onions | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | no meat/bacon invented (the trap's failure mode avoided); "side salad" is the optional background plate |

Recall: 2/2
Hallucinations: none
Trap leaks: none

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14 — Beef gulasch with boiled potatoes and a side bowl of lettuce

- **single_qwen_vl**: beef stew with potatoes, side salad

| gold core item | single_qwen_vl | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y |  |
| boiled potatoes | Y |  |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "side salad" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 18 — Swabian Maultaschen with potato salad

- **single_qwen_vl**: potato salad, dumplings

| gold core item | single_qwen_vl | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "dumplings" — filling and regional dish lost |
| potato salad | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none
Trap leaks: none

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19 — German fast-food mixed plate (Taxiteller)

- **single_qwen_vl**: fried french fries, grilled pork, sausage in sauce, yogurt sauce

| gold core item | single_qwen_vl | notes |
|---|---|---|
| French fries | Y |  |
| gyros/döner sliced meat | Y | "grilled pork" — correct species family for gyros, form lost |
| sliced sausage in curry/shashlik sauce | Y | "sausage in sauce" |
| tzatziki/garlic yogurt sauce | Y | "yogurt sauce" |
| mayonnaise | n | image has TWO distinct white sauces (tzatziki top-left, mayo centre); only one reported |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none |  |

Recall: 4/5
Hallucinations: none
Trap leaks: none

### 20 — Bowl of shio ramen

- **single_qwen_vl**: ramen noodles, chicken breast, herbs

| gold core item | single_qwen_vl | notes |
|---|---|---|
| ramen noodles | Y |  |
| clear (shio) broth | n | broth never named |
| sliced chashu pork | n? | reported "chicken breast" — the pale slices are pork chashu; species error, but the topping *was* detected |
| leafy green herb topping (mizuna/mitsuba) | Y | "herbs" |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |

Recall: 2/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21 — Vietnamese pho with a side plate of herb garnishes

- **single_qwen_vl**: pho, bean sprouts, fresh herbs

| gold core item | single_qwen_vl | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y |  |
| sliced beef and beef meatballs | Y? | image confirms sliced beef + meatballs; credit rests entirely on "pho" canonically implying beef — no protein was named |
| bean sprouts | Y |  |
| Thai basil | Y | "fresh herbs" |
| sliced green chilli/jalapeño | n | separate bowl of sliced chillies on the garnish plate, unreported |
| spring onion | n | visible throughout the broth |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |

Recall: 4/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22 — Three soft tacos with a corn cob

- **single_qwen_vl**: tacos, grilled corn on the cob, soda

| gold core item | single_qwen_vl | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y | tortilla + ground beef both visible and covered by "tacos" |
| grated cheese | n? | plainly visible topping; "tacos" does not canonically imply cheese (unlike "Greek salad"→lettuce) |
| red salsa | n? | same policy question — visible topping, unnamed |
| green salsa/tomatillo | n? | two distinct salsas visible; neither named |
| coriander/cilantro | n? | heavy cilantro topping, unnamed |
| grilled corn on the cob | Y | char marks confirm "grilled" |
| **core recall (/6)** | 2/6 | if dish-name consolidation extends to taco toppings, 6/6 |
| **hallucinations** | none | "soda" = optional cola glass |

Recall: 2/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): glass of cola

### 23 — Smothered beef burrito

- **single_qwen_vl**: enchilada, salsa, shredded cheese, lettuce

| gold core item | single_qwen_vl | notes |
|---|---|---|
| burrito (flour tortilla) | Y? | "enchilada" — same sauce-smothered rolled-tortilla family, wrong dish name; image shows a single large flour-tortilla burrito |
| green chile sauce | Y | "salsa" — colour/type lost |
| shredded cheddar/jack cheese | Y |  |
| shredded lettuce | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): diced tomato

### 24 — Fish and chips with peas

- **single_qwen_vl**: fish and chips, green peas, tartar sauce

| gold core item | single_qwen_vl | notes |
|---|---|---|
| battered fried fish fillet | Y |  |
| chips/thick-cut fries | Y |  |
| green peas | Y |  |
| tartar sauce | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): lemon wedge

### 25 — American breakfast platter

- **single_qwen_vl**: pancakes, fried egg, bacon, sausage, toast, hash browns

| gold core item | single_qwen_vl | notes |
|---|---|---|
| pancakes with icing sugar | Y |  |
| back bacon rashers | Y |  |
| fried egg (sunny side up) | Y |  |
| breakfast sausages | Y |  |
| hash brown/potato croquettes | Y |  |
| toast slices | Y | main-plate toast (gold core), not the background plate's sandwich |
| maple syrup in a shot glass | n |  |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none |  |

Recall: 6/7
Hallucinations: none
Trap leaks: none — background plate's toasted sandwich/salad not claimed

Optional (no recall credit): butter packet

### 26 — Indian thali on a steel tray

- **single_qwen_vl**: fried rice, roti, dal, curry, yogurt

| gold core item | single_qwen_vl | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y |  |
| chapati/roti | Y |  |
| papad (papadum) | n | large papad clearly beside the roti; "roti" does not cover it |
| curd/raita | Y | "yogurt" |
| dal (lentil curry) | Y |  |
| kofta/dumpling curry in orange gravy | Y? | the single generic "curry" token assigned to the most prominent curry bowl |
| paneer or fish curry in pale gravy | n | third distinct curry bowl; one "curry" cannot cover three |
| brinjal/eggplant curry | n | distinct dark eggplant bowl, unreported |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none |  |

Recall: 5/8
Hallucinations: none
Trap leaks: none

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27 — Stir-fried chicken with peppers and steamed rice

- **single_qwen_vl**: chicken with sauce and vegetables, white rice

| gold core item | single_qwen_vl | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y |  |
| red bell pepper strips | n? | prominent red pepper strips; only generic "vegetables" reported |
| onion | n? | same generic-plural policy question |
| spring onion/green onion | n? | same generic-plural policy question |
| steamed white rice | Y |  |
| **core recall (/5)** | 2/5 | if generic "vegetables" earns blanket credit, 5/5 |
| **hallucinations** | none |  |

Recall: 2/5
Hallucinations: none
Trap leaks: none

Optional (no recall credit): dried chilli bits

### 28 — Middle-Eastern mezze spread — four composed plates plus flatbread

- **single_qwen_vl**: falafel, yellow lentils, beetroot, white bean salad, pita bread, tahini sauce

| gold core item | single_qwen_vl | notes |
|---|---|---|
| falafel balls | Y |  |
| grilled flatbread | Y | "pita bread" |
| hummus/creamy white dip | Y | "tahini sauce" — creamy sesame dip, same object |
| green herb-chilli sauce | n | two ramekins of green chilli-herb sauce beside the flatbread, unreported |
| yellow bulgur or couscous | Y? | "yellow lentils" — the yellow grain piles are bulgur; correct object, wrong food class |
| black beluga lentils | n? | black lentil piles on every plate; arguably the "lentils" the model meant, but colour/position point at the bulgur |
| pickled white cabbage slaw | Y? | "white bean salad" — matches the white shredded slaw on each plate; wrong food class |
| green olives | n | whole green olives on two plates, unreported |
| **core recall (/8)** | 5/8 | 3 flagged; "yellow lentils"/"white bean salad" are one-object-one-wrong-name each |
| **hallucinations** | none | "beetroot" = optional gold item (diced beetroot present) |

Recall: 5/8
Hallucinations: none
Trap leaks: none

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29 — Tapas/snack flight with a wheat beer

- **single_qwen_vl**: sliced salami, cubed cheese, green olives, pickled vegetables

| gold core item | single_qwen_vl | notes |
|---|---|---|
| pickled gherkin slices | Y | "pickled vegetables" |
| salami slices | Y |  |
| cheese cubes | Y |  |
| green olives | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30 — Mixed grill board (plancha de grillades)

- **single_qwen_vl**: grilled chicken breast, grilled pork chop, baked potato, side salad, grilled sausage

| gold core item | single_qwen_vl | notes |
|---|---|---|
| pork spare ribs slab | Y | "grilled pork chop" — right species, wrong cut |
| grilled beef steak | n? | the only remaining large grilled slab; reported as "grilled chicken breast" — species error, object detected |
| grilled sausage | Y |  |
| grilled meat skewer with green pepper and tomato | n | skewer with pepper/tomato clearly on the board, unreported |
| baked/roasted potato with browned cheese topping | Y | cheese topping not mentioned |
| mixed leaf salad | Y |  |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | "chicken breast" maps to a real grilled meat piece |

Recall: 4/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): cherry tomato, steak knife

### 31 — Bowl of beef/oxtail soup with buttered bread

- **single_qwen_vl**: beef stew, whole wheat toast, butter

| gold core item | single_qwen_vl | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y |  |
| beef (oxtail) chunks | Y | via "beef stew" — cut lost |
| buttered bread slices (dark/whole-grain) | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): parsley garnish, butter as separate item

### 32 — Charcuterie/snack board (compartmented bamboo tray, top-down)

- **single_qwen_vl**: olives, vegetable sticks, hard-boiled eggs, cheese, meat, dip

| gold core item | single_qwen_vl | notes |
|---|---|---|
| green olives | Y |  |
| cucumber sticks | Y | via "vegetable sticks" |
| carrot sticks | Y | via "vegetable sticks" |
| bell pepper strips | Y | via "vegetable sticks" — 3 rows on one token |
| pan-fried spiced hard-boiled egg halves | Y | spicing/frying lost |
| hummus dip | Y | "dip" |
| salami/cured meat slices | Y | "meat" |
| cheese slices | Y |  |
| **core recall (/8)** | 8/8 | maximum consolidation credit; nutritionally the labels are very coarse |
| **hallucinations** | none |  |

Recall: 8/8
Hallucinations: none
Trap leaks: none

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33 — Bowl of oatmeal porridge with toppings

- **single_qwen_vl**: oatmeal, maple syrup, raisins, peanut butter, cinnamon

| gold core item | single_qwen_vl | notes |
|---|---|---|
| oatmeal/oat porridge | Y |  |
| peanut butter | Y |  |
| raisins | Y |  |
| ground cinnamon | Y |  |
| milk | n |  |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none | "maple syrup" = optional gold syrup drizzle |

Recall: 4/5
Hallucinations: none
Trap leaks: none

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34 — Waffles with strawberries and whipped cream

- **single_qwen_vl**: waffles, strawberry sauce, whipped cream, strawberries

| gold core item | single_qwen_vl | notes |
|---|---|---|
| waffles | Y |  |
| strawberries (sliced fresh) | Y |  |
| strawberry/berry syrup-compote | Y | "strawberry sauce" |
| whipped cream | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): orange juice glass at top edge

### 35 — Gyros/döner plate with fries and salad

- **single_qwen_vl**: grilled meat, french fries, side salad, yogurt sauce

| gold core item | single_qwen_vl | notes |
|---|---|---|
| gyros/döner sliced meat | Y | "grilled meat" — dish identity lost |
| French fries | Y |  |
| white garlic-yogurt sauce (tzatziki) with oregano | Y | "yogurt sauce" |
| shredded white cabbage | Y | via "side salad" |
| tomato slices | Y | via "side salad" |
| sweetcorn | Y? | corn is a visible salad component but not a canonical implication of "side salad" |
| cucumber slices | Y | via "side salad" |
| shredded carrot | Y | via "side salad" |
| **core recall (/8)** | 8/8 | five rows carried by one "side salad" token — extreme granularity loss for a 4-item output |
| **hallucinations** | none |  |

Recall: 8/8
Hallucinations: none
Trap leaks: none — off-plate flatbread basket not reported

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36 — Seafood paella in the pan

- **single_qwen_vl**: seafood paella

| gold core item | single_qwen_vl | notes |
|---|---|---|
| saffron/paella rice | Y |  |
| whole prawns (langostinos) | Y? | credit rests on "seafood paella" canonically implying prawns; no seafood was individually named |
| mantis shrimp (galeras) | n | several galeras clearly distinguishable from the prawns |
| artichoke pieces | n | abundant artichoke wedges throughout the rice |
| **core recall (/4)** | 2/4 | single-token output — the pan's actual composition is unrecoverable |
| **hallucinations** | none |  |

Recall: 2/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): red pepper/tomato bits in the rice

### 37 — Pierogi ruskie with carrot-cabbage salad

- **single_qwen_vl**: potsticker dumplings, coleslaw

| gold core item | single_qwen_vl | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y | "potsticker dumplings" — cuisine/filling/cooking method lost |
| fried caramelised onion topping | n |  |
| grated carrot and cabbage salad | Y | "coleslaw" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |

Recall: 2/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): radish/beet sprouts garnish

### 38 — Half-eaten beefburger with fries

- **single_qwen_vl**: hamburger, french fries

| gold core item | single_qwen_vl | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y |  |
| French fries | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none
Trap leaks: none

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39 — Remains of a fried breakfast (mostly eaten)

- **single_qwen_vl**: baked beans, sausage, bacon

| gold core item | single_qwen_vl | notes |
|---|---|---|
| baked beans in tomato sauce | Y |  |
| sausage pieces | Y |  |
| bacon rasher | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none — no eggs/toast/tomato/mushrooms invented on the smeared plate

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40 — Half-eaten liver-and-bacon fry-up with chips

- **single_qwen_vl**: beef stew, french fries, fried egg, tomato

| gold core item | single_qwen_vl | notes |
|---|---|---|
| liver pieces in gravy | n? | "beef stew" — meat-in-gravy detected, but liver (offal) reported as beef; nutritionally a different food |
| chips/French fries | Y |  |
| bacon/gammon slice | n | two pink gammon slices plainly visible top-right |
| fried egg (remnant, yolk visible) | Y |  |
| sausage | n | browned sausage at left edge, unreported |
| grilled tomato half | Y | "tomato" |
| **core recall (/6)** | 3/6 |  |
| **hallucinations** | none | "beef stew" maps to the liver-in-gravy |

Recall: 3/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41 — Leftovers of battered fish and potato wedges

- **single_qwen_vl**: fried fish, potato wedges, tartar sauce

| gold core item | single_qwen_vl | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten | Y |  |
| potato wedges/skin-on roast potatoes | Y |  |
| tartar sauce / mayonnaise dollop | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none — no napkin/sachet text read back as food

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42 — Buffet lunch plate (many components)

- **single_qwen_vl**: breaded chicken breast, rice, curry with chickpeas, sausage, corn and onion salad

| gold core item | single_qwen_vl | notes |
|---|---|---|
| breaded fried fish fillet | n | reported "breaded chicken breast" — species error on the plate's largest item |
| sour cream / remoulade dollop | n | large white dollop on the fillet, unreported |
| meatballs in brown gravy | n? | reported "sausage" — image shows round meatballs in gravy; ground-meat family but wrong form |
| chickpea-and-cauliflower curry | Y | cauliflower not mentioned |
| white rice | Y |  |
| red cabbage and sweetcorn salad | Y | "corn and onion salad" — the red strips are cabbage/onion; same salad |
| cucumber and lettuce salad | n | separate cucumber/lettuce salad visible top-left |
| **core recall (/7)** | 3/7 |  |
| **hallucinations** | none | every wrong label maps to a present object |

Recall: 3/7
Hallucinations: none
Trap leaks: none

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43 — Buffet lunch set — main plate, soup bowl, bread plate

- **single_qwen_vl**: bread, rice, green beans, fried fish cake, creamed sauce, bowl of grits with bacon

| gold core item | single_qwen_vl | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | "fried fish cake"; mayo topping arguably also the "creamed sauce" |
| herbed green rice | Y | "rice" — herb/green colour lost |
| green beans | Y |  |
| cheese-topped quiche/gratin square | n | yellow cheese-topped square at the back of the plate, unreported |
| creamy meat-and-vegetable stew | Y? | assigned to "creamed sauce"; that token may instead be the mayo on the croquettes, in which case this is `n` |
| creamy soup (bowl, with bacon bits) | Y | "bowl of grits with bacon" — bacon bits confirmed in the bowl |
| bread roll with butter | Y | "bread"; butter not mentioned |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none | "grits" is a misnaming of the creamy soup, not an invented food |

Recall: 6/7
Hallucinations: none
Trap leaks: none

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44 — Brazilian buffet lunch plate (top-down)

- **single_qwen_vl**: stewed meat with cabbage, yellow rice, black beans, side salad

| gold core item | single_qwen_vl | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | "side salad" |
| brown beans (feijão) in broth | Y | "black beans" — colour/variety wrong, same food class and object |
| yellow seasoned rice | Y |  |
| braised cabbage with tomato | Y | via "stewed meat with cabbage" |
| stewed meat in onion gravy | Y |  |
| mashed cassava/potato purée | n | pale purée under the cabbage, unreported |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |

Recall: 5/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): cutlery and placemat (non-food)

### 45 — Korean hanjeongsik table spread (dozens of banchan, top-down)

- **single_qwen_vl**: kimchi, steamed rice, grilled fish, tofu, stew, side salad

| gold core item | single_qwen_vl | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | n | large japchae plate at left, unreported |
| steamed egg (gyeranjjim) in stone pot | n | yellow steamed egg in a black stone pot, unreported |
| grilled mackerel/fish | Y | "grilled fish" |
| stir-fried beef in a hot stone pot | Y? | assigned to "stew"; "stew" could equally be the optional creamy porridge pot or the mushroom-noodle soup |
| glazed spicy braised ribs/pork | n | centre plate of dark glazed ribs, unreported |
| sliced raw fish (hoe/sashimi) on shredded radish | n | right-hand hoe plate on shredded radish, unreported |
| vegetable fritters/jeon platter | n | large jeon platter top-right, unreported |
| kimchi | Y |  |
| **core recall (/8)** | 3/8 | 6 reported items for a ~25-dish table |
| **hallucinations** | none | "tofu" and "side salad" both map to optional visible dishes |

Recall: 3/8
Hallucinations: none
Trap leaks: **steamed rice** — every rice-sized bowl in frame is empty tableware; rice is not served. Exactly the trap's failure mode.

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46 — Hong Kong steamer basket of small offal dishes (dai pai dong)

- **single_qwen_vl**: steamed beef tripe, steamed beef offal, steamed tofu skin

| gold core item | single_qwen_vl | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | curry sauce not mentioned |
| white boiled tripe/omasum slices in broth | Y | "steamed beef offal" |
| fried beancurd-skin rolls (tofu skin rolls) | Y | "steamed tofu skin" — frying lost |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none — no siu mai / har gow / dumplings / buns invented (best trap avoidance in the run)

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47 — Café brunch table spread (top-down)

- **single_qwen_vl**: avocado toast, bowl of granola with kiwi and berry compote, chocolate sesame donut, iced coffee with latte art, iced coffee with coffee beans

| gold core item | single_qwen_vl | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | bottom-left plate: two avocado toasts with poached eggs |
| eggs benedict with hollandaise on avocado toast | n | separate right-hand plate with hollandaise; only one "avocado toast" reported |
| yogurt bowl with granola, kiwi slices and berry compote | Y | fully specified — best single label in the run |
| cherry tomato salad with balsamic drizzle | n | tomato-and-balsamic rows on three plates, unreported |
| seeded bagel (dark, sesame-topped) | Y? | "chocolate sesame donut" — it is the dark sesame-topped bagel ring; object right, food class (donut/chocolate) wrong |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none | drinks reported are optional gold items |

Recall: 3/5
Hallucinations: none
Trap leaks: none — no menu-card dish (croissant, goulash soup, macarons) reported

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48 — Disposable plate of party snacks (partly eaten)

- **single_qwen_vl**: slice of cake, potato chips, sandwich, fried samosas

| gold core item | single_qwen_vl | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | filling not named |
| potato chips/crisps | Y |  |
| samosas (small fried triangles) | Y |  |
| slice of white/vanilla cake with icing — partly eaten | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): plastic fork and foil (non-food)

### 49 — Cafe sizzling-plate dinner set

- **single_qwen_vl**: steak with sauce, spaghetti with sauce and cherry tomatoes, bread roll, soup

| gold core item | single_qwen_vl | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y |  |
| spaghetti (plain, buttered) | Y |  |
| sausage/frankfurter | n | frankfurter lies across the spaghetti at the top of the hot plate, unreported |
| cherry tomatoes | Y |  |
| red cabbage soup (borscht-style, bowl) | Y | generic "soup" — contents lost |
| bread bun | Y |  |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |

Recall: 5/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50 — Late-night döner kebab plate with fries and salad

- **single_qwen_vl**: grilled lamb, french fries, side salad

| gold core item | single_qwen_vl | notes |
|---|---|---|
| döner kebab sliced meat | Y | "grilled lamb" — döner is lamb/veal; dish identity lost |
| tomato/chili sauce over the meat | n | thick red sauce poured over the meat, unreported |
| French fries | Y |  |
| iceberg lettuce salad | Y | via "side salad" |
| sliced red onion | Y | via "side salad" |
| cucumber slices | Y | via "side salad" |
| pickled gherkin and pepperoncini | n | pickles are not a canonical implication of "side salad" |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none |  |

Recall: 5/7
Hallucinations: none
Trap leaks: none — background second plate's food not claimed

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

### 15 — Bavarian Weisswurst breakfast

- **single_qwen_vl**: white sausage, pretzel, beer

| gold core item | single_qwen_vl | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y | "white sausage" |
| pretzel (Brezel) | Y |  |
| sweet mustard | n |  |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | "beer" = optional gold item |

Recall: 2/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16 — Döner/gyros plate with fries and salad

- **single_qwen_vl**: grilled meat with sauce, french fries, side salad

| gold core item | single_qwen_vl | notes |
|---|---|---|
| döner/gyros sliced meat | Y | "grilled meat" — dish identity lost |
| tomato sauce over the meat | Y | via "with sauce" — type lost |
| French fries | Y |  |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17 — Currywurst with French fries

- **single_qwen_vl**: fried potato sticks, sausage, tomato sauce

| gold core item | single_qwen_vl | notes |
|---|---|---|
| currywurst (sausage) | Y | dish name lost |
| curry ketchup sauce | Y | "tomato sauce" — curry element lost |
| curry powder | n |  |
| French fries | Y | "fried potato sticks" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |

Recall: 3/4
Hallucinations: none
Trap leaks: none

## Totals

| metric | single_qwen_vl |
|---|---|
| total gold core items | 235 |
| total hits | 182 |
| core-item recall | 77.4% (182/235) |
| hallucinations | 0 |
| trap leaks | 1 (image 45 — "steamed rice" on a table where no rice is served) |
| flagged judgment cells (`Y?` / `n?`) | 27 across 17 images |
| distinct items named (auto) | 148 |
| cost / plate (auto) | $0.00000 |
| latency median s (auto) | 94.35 |

### Per-image tally

| image | hits/total | halluc | trap |
|---|---|---|---|
| 01 | 6/6 | 0 | – |
| 02 | 4/5 | 0 | – |
| 03 | 8/8 | 0 | – |
| 04 | 3/4 | 0 | – |
| 05 | 2/2 | 0 | – |
| 06 | 5/6 | 0 | – |
| 07 | 2/5 | 0 | – |
| 08 | 3/3 | 0 | – |
| 09 | 1/1 | 0 | – |
| 10 | 2/2 | 0 | none |
| 11 | 2/3 | 0 | – |
| 12 | 3/3 | 0 | none |
| 13 | 2/2 | 0 | none |
| 14 | 3/3 | 0 | – |
| 15 | 2/3 | 0 | – |
| 16 | 4/4 | 0 | – |
| 17 | 3/4 | 0 | – |
| 18 | 2/2 | 0 | – |
| 19 | 4/5 | 0 | – |
| 20 | 2/4 | 0 | – |
| 21 | 4/6 | 0 | – |
| 22 | 2/6 | 0 | – |
| 23 | 4/4 | 0 | – |
| 24 | 4/4 | 0 | – |
| 25 | 6/7 | 0 | none |
| 26 | 5/8 | 0 | – |
| 27 | 2/5 | 0 | – |
| 28 | 5/8 | 0 | – |
| 29 | 4/4 | 0 | – |
| 30 | 4/6 | 0 | – |
| 31 | 3/3 | 0 | – |
| 32 | 8/8 | 0 | – |
| 33 | 4/5 | 0 | – |
| 34 | 4/4 | 0 | – |
| 35 | 8/8 | 0 | none |
| 36 | 2/4 | 0 | – |
| 37 | 2/3 | 0 | – |
| 38 | 2/2 | 0 | – |
| 39 | 3/3 | 0 | none |
| 40 | 3/6 | 0 | – |
| 41 | 3/3 | 0 | none |
| 42 | 3/7 | 0 | – |
| 43 | 6/7 | 0 | – |
| 44 | 5/6 | 0 | – |
| 45 | 3/8 | 0 | **1 (steamed rice)** |
| 46 | 3/3 | 0 | none |
| 47 | 3/5 | 0 | none |
| 48 | 4/4 | 0 | – |
| 49 | 5/6 | 0 | – |
| 50 | 5/7 | 0 | none |
| **total** | **182/235 (77.4%)** | **0** | **1** |

## Findings

1. **Zero hallucinations, one trap leak.** Every incorrect label in all 50 responses maps
   onto an object physically present on the plate. The model does not invent food. The only
   trap failure is image 45 ("steamed rice" at a Korean table where every rice bowl is empty)
   — a plausible-prior completion, not a visual fabrication.
2. **Recall is limited by output length, not by vision.** 3.62 items/plate against a gold mean
   of 4.7 core items. The worst plates are the dense ones: 45 (3/8), 42 (3/7), 22 (2/6),
   36 (2/4 from a single token). Whenever the model names 5-6 items it scores well (25: 6/7,
   43: 6/7, 32: 8/8).
3. **Consolidation is doing a lot of the scoring work.** 03/32/35 hit 8/8 on 4-6 reported
   tokens because one "side salad"/"vegetable sticks" covered 3-5 gold rows. That is 24 of
   182 hits with essentially no nutritional resolution — recall overstates usable output.
   The `Y?`/`n?` cells mark where this line was drawn.
4. **Systematic species confusion on the main protein**: schnitzel→"fried fish" (11),
   chashu pork→"chicken breast" (20), beef steak→"chicken breast" (30), breaded fish
   →"chicken breast" (42), liver→"beef stew" (40). "chicken breast" is the model's default
   guess for an unidentified pale/grilled protein — 4 plates lost their headline item to it.
5. **Condiments and sauces are the most consistently dropped class**: ketchup (04),
   soy sauce (06), mayonnaise (19), maple syrup (25), curry powder (17), sweet mustard (15),
   tomato/chili sauce (50), sour cream (42) — 8 misses in a category that carries real
   calories.
