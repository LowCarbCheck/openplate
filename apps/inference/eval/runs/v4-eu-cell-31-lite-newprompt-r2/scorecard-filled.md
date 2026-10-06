# Plate-identification scoring worksheet

- results: `runs/v4-eu-cell-31-lite-newprompt-r2/results.json`
- config: `eu-cell-31-lite-newprompt` (started 2026-10-06T12:59:12.759224+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
- prefill: 119 Y, 18 n, 1 conflicts, 97 need judgment, from 14 earlier sheets

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 187 |
| items named (mean/plate) | 3.74 |
| distinct item names | 166 |
| latency mean (s) | 4.05 |
| latency median (s) | 3.83 |
| latency max (s) | 7.27 |
| cost / plate (USD) | 0.003321 |
| cost total (USD) | 0.166048 |

## Portion + macro error (auto-computed)

portion/macro: **unscorable**: gold has no gram ranges (0/50 covered) and no kcal ranges (0/50 covered).

Weighed-gram ground truth is the missing input, not the metric: add `gram_ranges`
(per gold item, `[min, max]` grams) and `kcal_range` (`[min, max]` per plate) to
`gold/gold_labels.json` and both families populate automatically here. Grams must
come from a scale: a gram range guessed off a photo would make portion error
measure the labeller, not the model.

## Scoring instructions (human / reviewing agent)

Semantic matching is NOT automated: fuzzy matching lies exactly where it matters
("Greek salad" legitimately covering three gold rows; "sashimi" for nigiri hiding a
rice miss). For each image below:

1. Read the reported food list for each approach against the gold core items.
2. Put `Y` in the cell when the approach covered that gold item (a consolidation counts,
   but note the granularity loss in Notes), `n` when it missed it.
3. Fill the recall row with the resulting `hits/total`.
4. List anything reported that is **not visible in the photo** under Hallucinations.
5. Optional items earn no recall credit; reporting them is not an error either.
6. Count **over-decomposed** answers in the dedicated row: one per
   composite dish the approach split into its parts (a stew reported as five
   ingredients). Writing `over-decomposed` inside a gold-item cell
   counts too. It is a named error class, not a recall bonus. Mark the gold rows `Y`
   if the parts do cover them, and record the split here so it is counted.
7. When a gold item is covered only by a reported item that ALSO covers another gold core
   item (a merge, the opposite of a split), write `Y merged` in its cell.
   It still counts as `Y` for recall. `--granularity` reads it for the strict split recall,
   which gives credit only to items the approach reported on their own.

`python3 -m harness.scorecard --score <this file>` reads the filled rows back and
prints bootstrap 95% CIs; `--compare A B` reports WINNER or UNDECIDED.
8. This sheet is prefilled from earlier verdicts (exact item name, same plate, same gold
   item). A prefilled `Y` or `n` names its source sheet in Notes. Change it when you
   disagree. A row marked `NEEDS JUDGMENT` has an empty cell and lists the item names no
   earlier sheet judged: judge it, then delete the `NEEDS JUDGMENT` text. A row marked
   `CONFLICT` shows the newest sheet's verdict while earlier sheets disagree: decide,
   then delete the `CONFLICT` text. `--score` refuses a sheet with either marker.
   Hallucinations and over-decomposed rows are not prefilled. The recall row may stay
   empty: `--score` counts it from the cells.

> Gold-label protocol: Gold labels authored by hand from direct image inspection (Fable, 2026-08-11). 'core' = items a correct identification must include (synonyms/consolidations acceptable, e.g. 'Greek salad' may cover lettuce+cucumber+tomato). 'optional' = visible but acceptable to omit (garnish, condiments, off-plate drinks). Hallucination = any reported food not visible at all. Entries 11-50 (added 2026-08-11): drafted by two opus vision agents under the same protocol, spot-verified by Fable against images 12/19/22/39/45/46 before merge; manifest descriptions for 32/46/47 corrected to match images.

### 01, Continental/English-style breakfast plate

- **production**: scrambled eggs, baked beans in tomato sauce, back bacon, cocktail sausages, wholemeal bread, cucumber, margarine

| gold core item | production | notes |
|---|---|---|
| scrambled eggs | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Scrambled eggs" |
| bacon/ham slices | Y | "back bacon" |
| frankfurter sausages | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Cocktail sausages" (A name) |
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Baked beans in tomato sauce" |
| brown bread slice | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "wholemeal bread" |
| cucumber slices | Y | "cucumber" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter/margarine packets

### 02, Roast (Sunday) dinner

- **production**: roast beef, Yorkshire pudding, roasted potatoes, steamed mixed vegetables, gravy

| gold core item | production | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "roast beef" |
| Yorkshire pudding | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Yorkshire pudding" |
| roast potatoes | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Roasted potatoes" |
| broccoli | n | "steamed mixed vegetables" names no vegetable (strict rule 1, the "mixed vegetables" example) |
| cabbage/greens | n | "steamed mixed vegetables", strict rule 1 |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **production**: grilled salmon, greek salad

| gold core item | production | notes |
|---|---|---|
| grilled salmon fillets | Y | "grilled salmon" |
| feta cheese | Y merged | prefill Y from v3-eu-cell-mistral-medium-newprompt: "Greek salad": feta is part of the determinate dish (rule 1) |
| kalamata olives | Y merged | prefill Y from v3-eu-cell-mistral-medium-newprompt: "Greek salad" (determinate dish, as A, B, C, C3) |
| avocado | n | "greek salad" does not entail avocado; no item names it (the model notes do, but notes are not items) |
| cherry tomatoes | Y merged | prefill Y from v3-eu-cell-mistral-medium-newprompt: "Greek salad" |
| cucumber | Y merged | prefill Y from v3-eu-cell-mistral-medium-newprompt: "Greek salad" |
| lettuce/romaine | Y merged | prefill Y from v3-eu-cell-mistral-medium-newprompt: "Greek salad" |
| red onion | Y merged | prefill Y from v3-eu-cell-mistral-medium-newprompt: "Greek salad" |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04, Cheeseburger with fries

- **production**: cheeseburger with vegetables and mustard sauce, french fries, ketchup, pickled cucumber

| gold core item | production | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y | "cheeseburger with vegetables and mustard sauce" (as r1 "cheeseburger with vegetables") |
| thick-cut fries/steak fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "french fries" |
| ketchup | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Ketchup" |
| pickles/gherkins | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "pickled cucumber" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **production**: white rice with carrots, chicken and spinach stew

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Chicken and spinach stew" (C3 name) |
| white rice | Y | "white rice with carrots"; the carrots are the optional pepper bits misnamed (rule 3, r1 call) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "with carrots" is the pepper bits misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: salmon and avocado sushi roll, nigiri sushi, soy sauce, wasabi, pickled ginger

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Salmon and avocado sushi roll" (25-lite name) |
| tuna nigiri | n | "nigiri sushi" names no fish: strict rule 1 (the explicit "nigiri sushi" example of this run). r1 gave Y merged; changed here |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | n | "nigiri sushi" names no fish, strict rule 1 |
| pickled ginger | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "pickled ginger" |
| wasabi | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "wasabi" |
| soy sauce | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "soy sauce" |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: spaghetti with meat and vegetable sauce

| gold core item | production | notes |
|---|---|---|
| spaghetti | Y merged | prefill Y from v3-eu-cell-25-flash-newprompt: "Spaghetti with meat and vegetable sauce" (D3 and A name) |
| ground beef/meat tomato sauce | Y merged | prefill Y from v3-eu-cell-25-flash-newprompt: "spaghetti with meat and vegetable sauce", same item |
| corn kernels | n | prefill n from eu-cell-38-prod-oldprompt, v3-eu-cell-25-flash-newprompt, v3-eu-cell-35-eu-newprompt: no reported item covered it |
| green beans | n | prefill n from eu-cell-38-prod-oldprompt, v3-eu-cell-25-flash-newprompt, v3-eu-cell-35-eu-newprompt: no reported item covered it |
| carrot pieces | n | prefill n from eu-cell-38-prod-oldprompt, v3-eu-cell-25-flash-newprompt, v3-eu-cell-35-eu-newprompt: no reported item covered it |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **production**: yoghurt, granola, apple

| gold core item | production | notes |
|---|---|---|
| yogurt | Y | "yoghurt" |
| granola (oats/puffed grains, nuts) | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "granola" |
| apple slices | Y | "apple" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **production**: chicken pizza

| gold core item | production | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "chicken pizza" |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **production**: chicken sandwich, mixed salad garnish, Pepsi Max

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Chicken sandwich" (cloud name) |
| green side salad (rocket/mixed leaves) | Y | "mixed salad garnish": the gold row is itself one generic side salad (r1 "mixed salad" precedent) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: breaded veal schnitzel, fries, mixed salad with dressing, ketchup

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | Y | "breaded veal schnitzel" |
| thick-cut fries/potato wedges | Y | "fries" |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | "mixed salad with dressing": the gold row is itself the consolidated salad (r1, 25-flash precedent) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: grilled pork sausages, mashed potatoes, sauerkraut with mustard

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y | "grilled pork sausages" (r1 "grilled pork sausages with mustard") |
| sauerkraut | Y | "sauerkraut with mustard" |
| mashed potatoes | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Mashed potatoes" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: Käsespätzle with fried onions, Mixed green salad with dressing

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Käsespätzle with fried onions" (C3, A name) |
| fried/caramelised onions | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Käsespätzle with fried onions" names the onions |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: beef stew with potatoes and mushrooms, green leaf lettuce salad

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "beef stew with potatoes and mushrooms" (D3 name, word for word) |
| boiled potatoes | Y merged | "beef stew with potatoes and mushrooms", same item names the potatoes (r1) |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "green leaf lettuce salad" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: Weisswurst in broth, Sweet mustard, Beer, Pretzel

| gold core item | production | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Weisswurst in broth" |
| pretzel (Brezel) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "pretzel" |
| sweet mustard | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Sweet Mustard" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16, Döner/gyros plate with fries and salad

- **production**: doner kebab meat with tomato sauce, french fries, side salad with dressing, beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "doner kebab meat with tomato sauce" (C3 name) |
| tomato sauce over the meat | Y merged | "doner kebab meat with tomato sauce" names the sauce (r1) |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | "side salad with dressing": the gold row is itself the consolidated salad (r1 precedent) |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: Currywurst with fries

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y merged | "Currywurst with fries" |
| curry ketchup sauce | Y merged | "Currywurst with fries": sauce entailed by the named dish (precedent, every EU sheet) |
| curry powder | n | curry dusting not named (every EU sheet) |
| French fries | Y merged | "Currywurst with fries", same item names the fries |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: meat-filled pasta rolls, potato salad with bacon

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "meat-filled pasta rolls" (D3 name, word for word) |
| potato salad | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "potato salad with bacon" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: gyros meat, french fries, currywurst, tzatziki, mayonnaise

| gold core item | production | notes |
|---|---|---|
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| gyros/döner sliced meat | Y | "gyros meat" |
| sliced sausage in curry/shashlik sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Currywurst" (cloud name) |
| tzatziki/garlic yogurt sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "tzatziki" |
| mayonnaise | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Mayonnaise", its own item (D3, A) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 20, Bowl of shio ramen

- **production**: ramen

| gold core item | production | notes |
|---|---|---|
| ramen noodles | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "ramen" |
| clear (shio) broth | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "ramen" is noodles in broth (runpod, 25-flash call) |
| sliced chashu pork | n | prefill n from v4-eu-cell-31-lite-newprompt-r1: no reported item covered it |
| leafy green herb topping (mizuna/mitsuba) | n | prefill n from v4-eu-cell-31-lite-newprompt-r1: no reported item covered it |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **production**: beef noodle soup, fresh bean sprouts and thai basil

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y merged | "beef noodle soup" (D3 and eu-cell-35-eu-newprompt name) |
| sliced beef and beef meatballs | Y merged | prefill Y from eu-cell-35-eu-newprompt: pho names the beef (rule 1 example); D "beef noodle soup" kept the dish and the beef |
| bean sprouts | Y merged | "fresh bean sprouts and thai basil" |
| Thai basil | Y merged | "fresh bean sprouts and thai basil", same item |
| sliced green chilli/jalapeño | n | not named |
| spring onion | n | not named |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: beef tacos with salsa and cheese, grilled corn on the cob, cola

| gold core item | production | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y merged | "beef tacos with salsa and cheese" |
| grated cheese | Y merged | same item names the cheese (25-flash, mistral precedent) |
| red salsa | Y merged | one "salsa" credited to the red salsa (precedent) |
| green salsa/tomatillo | n | one salsa token cannot cover two salsas (mistral precedent) |
| coriander/cilantro | n | not named |
| grilled corn on the cob | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "grilled corn on the cob" |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **production**: wet burrito

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | Y merged | prefill Y from v3-eu-cell-35-eu-newprompt: "wet burrito" |
| green chile sauce | Y merged | prefill Y from v3-eu-cell-35-eu-newprompt: "wet burrito" |
| shredded cheddar/jack cheese | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, v3-eu-cell-35-eu-newprompt: no reported item covered it |
| shredded lettuce | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, v3-eu-cell-35-eu-newprompt: no reported item covered it |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **production**: battered fish, french fries, green peas, tartar sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish fillet | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "battered fish" |
| chips/thick-cut fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French Fries" |
| green peas | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Green Peas" |
| tartar sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Tartar Sauce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge

### 25, American breakfast platter

- **production**: bacon, pancakes, fried egg, pork sausages, hash browns, toast, maple syrup, butter

| gold core item | production | notes |
|---|---|---|
| pancakes with icing sugar | Y | "pancakes"; icing sugar is topping prep |
| back bacon rashers | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Bacon" |
| fried egg (sunny side up) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Fried egg" |
| breakfast sausages | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Pork sausages" |
| hash brown/potato croquettes | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Hash browns" |
| toast slices | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "toast" |
| maple syrup in a shot glass | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Maple syrup" |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **production**: vegetable fried rice, roti, papadum, plain yogurt, vegetable soup, mixed vegetable curry, dal, paneer curry, kofta curry, side salad

| gold core item | production | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Vegetable Fried Rice" |
| chapati/roti | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Roti" |
| papad (papadum) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Papadum" |
| curd/raita | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Plain Yogurt" |
| dal (lentil curry) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "dal" |
| kofta/dumpling curry in orange gravy | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "kofta curry" |
| paneer or fish curry in pale gravy | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: D "paneer curry" |
| brinjal/eggplant curry | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Mixed Vegetable Curry" for the eggplant curry (D, C2, B2 precedent) |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **production**: chicken cashew stir-fry, steamed jasmine rice

| gold core item | production | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "chicken cashew stir-fry" |
| red bell pepper strips | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-38-minimal-newprompt, eu-cell-38-prod-oldprompt and 2 more: no reported item covered it |
| onion | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-38-minimal-newprompt, eu-cell-38-prod-oldprompt and 2 more: no reported item covered it |
| spring onion/green onion | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-38-minimal-newprompt, eu-cell-38-prod-oldprompt and 2 more: no reported item covered it |
| steamed white rice | Y | "steamed jasmine rice" |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): dried chilli bits

### 28, Middle-Eastern mezze spread, four composed plates plus flatbread

- **production**: falafel mezze bowl, pita bread, chili dipping oil

| gold core item | production | notes |
|---|---|---|
| falafel balls | Y | "falafel mezze bowl" names the falafel (eu-cell-38-newprompt "Falafel mezze bowl" Y) |
| grilled flatbread | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Pita bread" (cloud, 25-lite name) |
| hummus/creamy white dip | n | not named; "mezze bowl" names nothing else (rule 1) |
| green herb-chilli sauce | Y | "chili dipping oil": photo, the green herb and chilli oil bowls; as C3 "chili herb dipping oil" and E "chili oil" (Y). r1 "spicy dipping sauce" scored n because it named no kind |
| yellow bulgur or couscous | n | not named |
| black beluga lentils | n | not named |
| pickled white cabbage slaw | n | not named |
| green olives | n | not named |
| **core recall (/8)** | 3/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: wheat beer, pickled gherkin, salami, cheese cubes, green olives

| gold core item | production | notes |
|---|---|---|
| pickled gherkin slices | Y | "pickled gherkin" |
| salami slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "salami" |
| cheese cubes | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "cheese cubes" |
| green olives | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Green olives" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30, Mixed grill board (plancha de grillades)

- **production**: grilled beef steak, barbecued pork ribs, mixed meat skewer, baked potato, mixed salad

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | Y | "barbecued pork ribs" |
| grilled beef steak | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "grilled beef steak" |
| grilled sausage | n | not named |
| grilled meat skewer with green pepper and tomato | Y | "mixed meat skewer" (r1 "meat skewer") |
| baked/roasted potato with browned cheese topping | Y | prefill Y from 2026-08-12-50img-ens3: "baked potato" |
| mixed leaf salad | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "mixed salad": the gold row is itself a salad (precedent "side salad") |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cherry tomato, steak knife

### 31, Bowl of beef/oxtail soup with buttered bread

- **production**: beef stew, buttered bread

| gold core item | production | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged | "beef stew"; Y merged as r1 and the v3 sheets (it also covers the beef chunks); the ens3 and lfmvl Y did not mark merges |
| beef (oxtail) chunks | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "beef stew", same item as the broth (precedent) |
| buttered bread slices (dark/whole-grain) | Y | "buttered bread" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **production**: stuffed green olives, sliced fresh vegetables, deviled eggs, hummus, hard cheese slices, salami, crackers

| gold core item | production | notes |
|---|---|---|
| green olives | Y | "stuffed green olives" |
| cucumber sticks | n | "sliced fresh vegetables" names nothing (strict rule 1, r1 "raw sliced vegetables") |
| carrot sticks | n | rule 1, as above |
| bell pepper strips | n | rule 1, as above |
| pan-fried spiced hard-boiled egg halves | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Deviled eggs" (deviled for spiced egg is prep, rule 2) |
| hummus dip | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Hummus" |
| salami/cured meat slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "salami" |
| cheese slices | Y | "hard cheese slices" |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **production**: oatmeal with milk, peanut butter, honey, raisins, cinnamon

| gold core item | production | notes |
|---|---|---|
| oatmeal/oat porridge | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "oatmeal with milk" |
| peanut butter | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Peanut butter" |
| raisins | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Raisins" |
| ground cinnamon | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "cinnamon" |
| milk | Y merged | "oatmeal with milk", same item names the milk (r1) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: waffles with strawberries and whipped cream

| gold core item | production | notes |
|---|---|---|
| waffles | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "waffles with strawberries and whipped cream" |
| strawberries (sliced fresh) | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "waffles with strawberries and whipped cream", same item |
| strawberry/berry syrup-compote | n | prefill n from v4-eu-cell-31-lite-newprompt-r1: no reported item covered it |
| whipped cream | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "waffles with strawberries and whipped cream", same item |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **production**: doner kebab meat, french fries, tzatziki sauce, mixed salad, pita bread

| gold core item | production | notes |
|---|---|---|
| gyros/döner sliced meat | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Doner Kebab Meat" |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French Fries" |
| white garlic-yogurt sauce (tzatziki) with oregano | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "tzatziki sauce" |
| shredded white cabbage | n | prefill n from eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt, eu-cell-38-newprompt and 4 more: no reported item covered it |
| tomato slices | n | prefill n from 2026-08-12-50img-lfmvl, eu-cell-38-minimal-newprompt, eu-cell-38-newprompt and 4 more: no reported item covered it |
| sweetcorn | n | prefill n from 2026-08-12-50img-lfmvl, eu-cell-38-newprompt, eu-cell-38-prod-oldprompt and 3 more: no reported item covered it |
| cucumber slices | n | prefill n from 2026-08-12-50img-lfmvl, eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt and 6 more: no reported item covered it |
| shredded carrot | n | prefill n from 2026-08-12-50img-lfmvl, eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt and 6 more: no reported item covered it |
| **core recall (/8)** | 3/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: seafood paella

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | Y merged | prefill Y from v3-eu-cell-35-eu-newprompt: "seafood paella" |
| whole prawns (langostinos) | Y merged | prefill Y from v3-eu-cell-35-eu-newprompt: "seafood paella" |
| mantis shrimp (galeras) | Y merged | prefill Y from v3-eu-cell-35-eu-newprompt: "seafood paella" |
| artichoke pieces | n | prefill n from v3-eu-cell-35-eu-newprompt: no reported item covered it |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: pierogi with cabbage and mushroom filling, caramelized onion topping, coleslaw salad

| gold core item | production | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y | "pierogi with cabbage and mushroom filling": the dish is named, the filling is not visible (r1 precedent) |
| fried caramelised onion topping | Y | "caramelized onion topping" |
| grated carrot and cabbage salad | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Coleslaw salad" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | the wrong filling sits inside a present item |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **production**: cheeseburger, french fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "cheeseburger" (C3 name) |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: baked beans, pork sausages, back bacon

| gold core item | production | notes |
|---|---|---|
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Baked beans" (D3 name) |
| sausage pieces | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Pork sausages" (D3 name) |
| bacon rasher | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "back bacon" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **production**: liver and onions, sausage, french fries, grilled bacon, fried egg, grilled tomato

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | Y | "liver and onions" names the organ |
| chips/French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| bacon/gammon slice | Y | "grilled bacon" |
| fried egg (remnant, yolk visible) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "fried egg" |
| sausage | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Sausage" |
| grilled tomato half | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Grilled tomato" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: battered fish, roasted potato wedges, mayonnaise

| gold core item | production | notes |
|---|---|---|
| battered fried fish (cod), partly eaten | Y | "battered fish" (r1) |
| potato wedges/skin-on roast potatoes | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "roasted potato wedges" |
| tartar sauce / mayonnaise dollop | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Mayonnaise" (D3, cloud name) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **production**: breaded fried fish, meatballs with gravy, white rice, lentil curry, corn and vegetable salad

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | Y | "breaded fried fish" |
| sour cream / remoulade dollop | n | no item names the dollop (mistral precedent); the model notes do, notes are not items |
| meatballs in brown gravy | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Meatballs with gravy" |
| chickpea-and-cauliflower curry | n | "lentil curry": lentil for chickpea, kind miss (rule 2, mistral "curried lentils" call) |
| white rice | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "White rice" |
| red cabbage and sweetcorn salad | Y | "corn and vegetable salad": the corn names this salad (r1 and D3 call on "mixed salad with corn") |
| cucumber and lettuce salad | n | the corn salad item cannot cover two salads (r1) |
| **core recall (/7)** | 4/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set, main plate, soup bowl, bread plate

- **production**: creamy grits with bacon, bread roll with butter, breaded crab cakes with creamy sauce, green beans and rice pilaf, savoury quiche square, scrambled eggs with vegetables

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | "breaded crab cakes with creamy sauce": croquettes named, crab for fish within seafood cakes |
| herbed green rice | Y merged | "green beans and rice pilaf" names the rice |
| green beans | Y merged | "green beans and rice pilaf", same item |
| cheese-topped quiche/gratin square | Y | "savoury quiche square" |
| creamy meat-and-vegetable stew | n | "scrambled eggs with vegetables": egg for meat stew, kind miss (cloud precedent, 2026-08-12 flip "43 stew as scrambled egg") |
| creamy soup (bowl, with bacon bits) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "creamy grits with bacon": photo, a thick white cream with bacon bits in a bowl; gold names no base, porridge for soup is form (rule 2) |
| bread roll with butter | Y | "bread roll with butter" |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none | "scrambled eggs with vegetables" is the stew misnamed, "creamy grits" the soup bowl (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: mixed salad, stewed beans, sautéed cabbage, yellow rice, braised pork, mashed potatoes

| gold core item | production | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "mixed salad": the gold row is the one salad on the plate (as 25-flash "Mixed green salad") |
| brown beans (feijão) in broth | Y | "stewed beans" |
| yellow seasoned rice | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Yellow rice" |
| braised cabbage with tomato | Y | "sautéed cabbage" |
| stewed meat in onion gravy | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Braised pork" (as D3 "braised pork dish") |
| mashed cassava/potato purée | Y | "mashed potatoes" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45, Korean hanjeongsik table spread (dozens of banchan, top-down)

- **production**: Bulgogi, grilled mackerel, sashimi, tofu with kimchi, mixed vegetable pancakes, steamed egg, banchan side dishes, soybean sprout soup

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | n | no noodle item |
| steamed egg (gyeranjjim) in stone pot | Y | "steamed egg" |
| grilled mackerel/fish | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "grilled mackerel" |
| stir-fried beef in a hot stone pot | Y | "Bulgogi" (r1 "beef bulgogi") |
| glazed spicy braised ribs/pork | n | no item for the glazed pork plate (photo) |
| sliced raw fish (hoe/sashimi) on shredded radish | Y | "sashimi" |
| vegetable fritters/jeon platter | Y | "mixed vegetable pancakes" |
| kimchi | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "tofu with kimchi" names the kimchi on the tofu plate (D3 call) |
| **core recall (/8)** | 6/8 |  |
| **hallucinations** | none | "soybean sprout soup" is the white soup pot misnamed (rule 3); no empty bowl named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: steamed bean curd rolls, steamed beef tripe

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "steamed beef tripe": one tripe token goes to the honeycomb cups (precedent) |
| white boiled tripe/omasum slices in broth | n | prefill n from v4-eu-cell-31-lite-newprompt-r1: no reported item covered it |
| fried beancurd-skin rolls (tofu skin rolls) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "steamed bean curd rolls" (frying lost, form) |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: avocado toast with poached egg, bagel, açai bowl, iced coffee, beetroot latte, passion fruit cocktail, white wine

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "avocado toast with poached egg" (D3 name; the two-piece plate, photo) |
| eggs benedict with hollandaise on avocado toast | n | no item for the benedict plate (r1) |
| yogurt bowl with granola, kiwi slices and berry compote | n | "açai bowl" names neither yogurt, granola nor kiwi (r1 "smoothie bowl" call) |
| cherry tomato salad with balsamic drizzle | n | not named |
| seeded bagel (dark, sesame-topped) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "bagel": the real bagel on the table, not a menu card item |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none | "açai bowl" is the yogurt bowl misnamed; drinks optional; no menu card item |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: potato chips, funfetti cake, vegetable samosa, white bread sandwich

| gold core item | production | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "White bread sandwich" |
| potato chips/crisps | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Potato chips" |
| samosas (small fried triangles) | Y | "vegetable samosa" |
| slice of white/vanilla cake with icing, partly eaten | Y | "funfetti cake" (r1) |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49, Cafe sizzling-plate dinner set

- **production**: grilled pork chop with pasta and sausage, minestrone soup, bread roll

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y merged | "grilled pork chop with pasta and sausage" |
| spaghetti (plain, buttered) | Y merged | same item, "pasta" for the spaghetti |
| sausage/frankfurter | Y merged | same item names the sausage |
| cherry tomatoes | n | not named |
| red cabbage soup (borscht-style, bowl) | Y | prefill Y from v3-eu-cell-35-eu-newprompt: D3 "minestrone soup" for the borscht bowl (C precedent); D3 steak, spaghetti, sausage are ONE item |
| bread bun | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Bread Roll" |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none | "minestrone soup" is the borscht bowl misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: doner kebab meat with tomato sauce, french fries, mixed vegetable salad, beer

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y merged | "doner kebab meat with tomato sauce" |
| tomato/chili sauce over the meat | Y merged | same item names the tomato sauce |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| iceberg lettuce salad | n | "mixed vegetable salad" names no part (strict rule 1; gold lists the parts row by row) |
| sliced red onion | n | rule 1, as above |
| cucumber slices | n | rule 1, as above |
| pickled gherkin and pepperoncini | n | no pickle named (r1 had "with pickled pepper", this run does not) |
| **core recall (/7)** | 3/7 |  |
| **hallucinations** | none | "beer" optional; nothing from the background plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 184/235 = 78.3% |
| hallucinations | 0 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 166 |
| cost / plate (auto) | $0.00332 |
| latency median s (auto) | 3.83 |

## Recall and bootstrap confidence interval

> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`, STRICT reading of rule 1 (a generic label such as "greens", "spicy sauce", "cured meat assortment", "mixed vegetables", a bare "mixed salad" where gold lists the salad parts row by row, or "nigiri sushi" with no fish named earns no credit). Cell: google/gemini-3.1-flash-lite on the EU OpenRouter host, reasoning `minimal`, v4 prompt, plates repeat 2. Prefill: `--prefill` from `runs/v4-eu-cell-31-lite-newprompt-r1/` (this cell, repeat 1, filled today under the strict reading), `runs/eu-*/` and `runs/v3-eu-*/` here, and from `op-worktrees/prompt-v3` the ens3, lfmvl and mistral-vs-qwen sheets (the other prompt-v3 EU sheets are byte-identical copies and count once); the 2026-08-12 cloudbaseline and qwenvl sheets and the runpod sheet were left out. 14 sheets read, 3633 remembered verdicts. Prefill result: 119 Y (26 of them Y merged), 18 n, 1 conflict, 97 need judgment. The conflict (31, "beef stew") was settled as Y merged, as r1 and the v3 sheets. The 97 open rows were judged by hand, consistent with the same model item name in this order: r1 of this cell, then C3 (`v3-eu-cell-38-minimal-newprompt`), D3 (`v3-eu-cell-35-eu-newprompt`), `v3-eu-cell-25-flash-newprompt`, `v3-eu-cell-mistral-medium-newprompt`, `v3-eu-cell-25-lite-newprompt`. One prefill was overturned: 06 "nigiri sushi" (Y merged in r1) is n for both nigiri rows under the explicit strict reading. Only reported item names count; the free-text `notes` field earns no credit (03 avocado, 20 chashu, 42 dollop). Photos opened: 28, 45. No model was called for this scoring.

- **Hits: 184/235. Recall: 78.3 %.**
- **95 % CI: [71.5, 85.3] %.**
- Method: a percentile bootstrap over plates (a cluster bootstrap, because a plate's items succeed or fail together). Each of 2000 resamples draws 50 plates with replacement with Python's stdlib `random.Random(7)`. Recall of a resample is the sum of its hits over the sum of its gold items. The CI is the 2.5th and 97.5th percentile of the 2000 values, with linear interpolation. The computation is `harness/stats.py` `bootstrap_recall_ci(pairs, resamples=2000, seed=7)`, and a separate stdlib reimplementation gave the same bounds.
- The harness default (`--score`: 10 000 resamples, seed 20260813) gives [71.3, 85.2] %.

Per plate hits: 01 6/6, 02 3/5, 03 7/8, 04 4/4, 05 2/2, 06 4/6, 07 2/5, 08 3/3, 09 1/1, 10 2/2, 11 3/3, 12 3/3, 13 2/2, 14 3/3, 15 3/3, 16 4/4, 17 3/4, 18 2/2, 19 5/5, 20 2/4, 21 4/6, 22 4/6, 23 2/4, 24 4/4, 25 7/7, 26 8/8, 27 2/5, 28 3/8, 29 4/4, 30 5/6, 31 3/3, 32 5/8, 33 5/5, 34 3/4, 35 3/8, 36 3/4, 37 3/3, 38 2/2, 39 3/3, 40 6/6, 41 3/3, 42 4/7, 43 6/7, 44 6/6, 45 6/8, 46 2/3, 47 2/5, 48 4/4, 49 5/6, 50 3/7.

## Hallucinations by plate

None. **0 hallucinations** on 50 plates. A hallucination is a food with no referent in the photo (rule 3).

- Trap leaks: 0. Plate 50 names nothing from the background plate, plate 47 names no menu card item, plate 45 names no empty bowl.
- Misnamed visible objects, not counted (rule 3): 43 "creamy grits with bacon" (the soup bowl) and "scrambled eggs with vegetables" (the stew), 45 "soybean sprout soup" (the white soup pot), 47 "açai bowl" (the yogurt bowl), 49 "minestrone soup" (the borscht bowl).
- Wrong parts inside a present item, not counted: 05 "carrots" in the rice (the pepper bits), 37 "cabbage and mushroom filling".

## Errors, schema-invalid records, false unreadable

- Error records: **0** (`_summary` lists no failure; every record is HTTP 200, 1 attempt).
- Schema-invalid records: **0** (`schema_valid` true on 50/50). Error and invalid ids: none.
- False unreadable: **0** (no answer is marked unreadable; every plate returned foods).

## Paired difference against C3

C3 is `op-worktrees/prompt-v3/apps/inference/eval/runs/v3-eu-cell-38-minimal-newprompt/scorecard-filled.md` (3.8 flash, minimal reasoning, v3 prompt), the same 50 plates and the same 235 gold items.

- C3: 199/235 = 84.7 %, 95 % CI [78.2, 90.8] (same method, seed 7, 2000 resamples).
- This cell: 184/235 = 78.3 %, 95 % CI [71.5, 85.3].
- **C3 minus this cell: +6.4 points, paired 95 % CI [+1.3, +11.6].** The interval excludes 0.
- Method: `harness/stats.py` `bootstrap_diff_ci(c3, this_cell, resamples=2000, seed=7)`. Each resample draws one set of 50 plate indices with `random.Random(7)` and applies it to both cells, so plate difficulty cancels. The CI is the 2.5th and 97.5th percentile of the 2000 differences, with linear interpolation. A separate stdlib reimplementation gave the same bounds.
- Plates where the two cells differ (C3 minus this cell, in hits): 02 +2, 03 +1, 06 -1, 20 +1, 22 -2, 23 +2, 33 -1, 35 +3, 36 +1, 42 +1, 45 +2, 46 +1, 47 +3, 50 +2.
- Against r1 of this cell (188/235, r1 minus r2 in hits): 02 +2, 03 +1, 06 -1, 22 -2, 28 -2, 36 +1, 42 +2, 43 +1, 45 +1, 50 +1. The r1 sheet credits 06 nigiri x2; with that call r2 would score 186/235.

Sensitivity to the closest calls (same method):

| variant | hits, recall | 95 % CI | C3 minus this cell [95 % CI] |
|---|---|---|---|
| as filled | 184/235 = 78.3 % | [71.5, 85.3] | +6.4 [+1.3, +11.6] |
| r1 call on 06 ("nigiri sushi" Y merged x2) | 186/235 = 79.1 % | [72.1, 86.1] | +5.5 [-0.4, +11.1] |
| stricter: 22 salsa, 28 chili oil, 43 grits, 44 mixed salad to n | 180/235 = 76.6 % | [69.7, 83.8] | +8.1 [+3.2, +12.8] |

The sign holds in every variant. Whether the CI excludes 0 turns on the 06 nigiri call alone.

## Judgment calls that were not obvious

| plate | call | verdict | why unsure |
|---|---|---|---|
| 06 | "nigiri sushi" for tuna nigiri and white-fish nigiri | n, n | the strict reading names this label as no credit, but r1 of this cell and the EU sheets credited "assorted nigiri" as Y merged; this one call moves the paired CI across 0 |
| 28 | "chili dipping oil" for the green herb-chilli sauce | Y | photo shows chilli oil bowls with green herbs; follows C3 "chili herb dipping oil"; but r1 "spicy dipping sauce" scored n and the name gives no herb |
| 42 | "lentil curry" for the chickpea-and-cauliflower curry | n | lentil for chickpea read as a kind miss (mistral "curried lentils"); both are legumes, a looser rule 2 would give Y |
| 22 | "beef tacos with salsa and cheese" for the red salsa | Y merged | one bare "salsa" credited to the red one by precedent; the plate has a red and a green salsa |
| 44 | "mixed salad" for the green salad (lettuce, grated carrot, coriander) | Y | the gold row is one salad (r1 precedent); the strict list bans a bare "mixed salad" where gold lists the parts, and here the parts sit in parentheses of one row |

## Findings

1. Gemini 3.1 Flash Lite with the v4 prompt, repeat 2, reaches 184/235 = 78.3 % [71.5, 85.3] with 0 hallucinations and 0 error records, at $0.0033 a plate and a 3.8 s median. Repeat 1 scored 188/235; the gap of 4 hits comes from answer variance (02 "steamed mixed vegetables", 42 "lentil curry") plus the stricter 06 call, and sits well inside both CIs.
2. C3 v3 leads by +6.4 points, paired CI [+1.3, +11.6]. The losses sit on enumeration plates (35, 47, 23, 02, 45, 50), where this cell gave one generic or merged label ("mixed salad", "steamed mixed vegetables", "açai bowl", "mixed vegetable salad").
