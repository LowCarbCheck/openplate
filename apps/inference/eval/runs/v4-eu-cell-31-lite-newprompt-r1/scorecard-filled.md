# Plate-identification scoring worksheet

- results: `runs/v4-eu-cell-31-lite-newprompt-r1/results.json`
- config: `eu-cell-31-lite-newprompt` (started 2026-10-06T12:55:30.143319+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
- prefill: 80 Y, 9 n, 0 conflicts, 146 need judgment, from 10 earlier sheets

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 186 |
| items named (mean/plate) | 3.72 |
| distinct item names | 161 |
| latency mean (s) | 4.39 |
| latency median (s) | 4.34 |
| latency max (s) | 7.44 |
| cost / plate (USD) | 0.003297 |
| cost total (USD) | 0.164842 |

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

- **production**: brown bread, sausages, scrambled eggs, baked beans in tomato sauce, sliced ham, cucumber slices, margarine

| gold core item | production | notes |
|---|---|---|
| scrambled eggs | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Scrambled eggs" |
| bacon/ham slices | Y | "sliced ham" |
| frankfurter sausages | Y | "sausages", kind right |
| baked beans in tomato sauce | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Baked beans in tomato sauce" |
| brown bread slice | Y | "brown bread" |
| cucumber slices | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Cucumber slices" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "margarine" is the optional packet |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter/margarine packets

### 02, Roast (Sunday) dinner

- **production**: roast beef, Yorkshire pudding, roasted potatoes, mixed broccoli and cabbage, gravy

| gold core item | production | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "roast beef" |
| Yorkshire pudding | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Yorkshire pudding" |
| roast potatoes | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Roasted potatoes" |
| broccoli | Y merged | "mixed broccoli and cabbage" names the broccoli |
| cabbage/greens | Y merged | "mixed broccoli and cabbage" names the cabbage |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none | "gravy" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **production**: grilled salmon fillets, greek salad with feta cheese, avocado, olives and vegetables

| gold core item | production | notes |
|---|---|---|
| grilled salmon fillets | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Grilled Salmon Fillets" |
| feta cheese | Y merged | "greek salad with feta cheese, avocado, olives and vegetables" names the feta |
| kalamata olives | Y merged | same item names the olives |
| avocado | Y merged | same item names the avocado |
| cherry tomatoes | Y merged | same item, determinate dish "Greek salad" (rule 1, C3 call) |
| cucumber | Y merged | same item, determinate dish "Greek salad" |
| lettuce/romaine | Y merged | same item, determinate dish "Greek salad" |
| red onion | Y merged | same item, determinate dish "Greek salad" |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04, Cheeseburger with fries

- **production**: cheeseburger with vegetables, french fries, ketchup, pickled cucumber

| gold core item | production | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y | "cheeseburger with vegetables" |
| thick-cut fries/steak fries | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "french fries" |
| ketchup | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Ketchup" |
| pickles/gherkins | Y | "pickled cucumber" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **production**: steamed white rice with carrots, chicken with greens in sauce

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | "chicken with greens in sauce" |
| white rice | Y | "steamed white rice with carrots"; the carrots are the optional pepper bits misnamed (rule 3) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "with carrots" is a wrong part inside a present item (the pepper bits), not counted (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: salmon and avocado sushi roll, nigiri sushi, white wine

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Salmon and avocado sushi roll" (25-lite name) |
| tuna nigiri | n | strict rule 1: nigiri sushi names no fish; aligned with r2 and r3 |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | n | strict rule 1: nigiri sushi names no fish; aligned with r2 and r3 |
| pickled ginger | n | not named |
| wasabi | n | not named |
| soy sauce | n | not named |
| **core recall (/6)** | 1/6 |  |
| **hallucinations** | none | "white wine" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: spaghetti bolognese with mixed vegetables

| gold core item | production | notes |
|---|---|---|
| spaghetti | Y merged | prefill Y from eu-cell-38-minimal-newprompt: "spaghetti bolognese with mixed vegetables" |
| ground beef/meat tomato sauce | Y merged | prefill Y from eu-cell-38-minimal-newprompt: "spaghetti bolognese with mixed vegetables" |
| corn kernels | n | prefill n from eu-cell-38-minimal-newprompt: no reported item covered it |
| green beans | n | prefill n from eu-cell-38-minimal-newprompt: no reported item covered it |
| carrot pieces | n | prefill n from eu-cell-38-minimal-newprompt: no reported item covered it |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **production**: yogurt with granola and apple

| gold core item | production | notes |
|---|---|---|
| yogurt | Y merged | prefill Y from eu-cell-35-eu-oldprompt: "yogurt with granola and apple" |
| granola (oats/puffed grains, nuts) | Y merged | prefill Y from eu-cell-35-eu-oldprompt: "yogurt with granola and apple" |
| apple slices | Y merged | prefill Y from eu-cell-35-eu-oldprompt: "yogurt with granola and apple" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **production**: chicken pizza

| gold core item | production | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | prefill Y from eu-cell-35-eu-oldprompt: "chicken pizza" |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **production**: chicken and salad sandwich, mixed salad, Pepsi Max

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | "chicken and salad sandwich" (as D3 "chicken sandwich with salad") |
| green side salad (rocket/mixed leaves) | Y | "mixed salad": the gold row is one generic salad (precedent) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "Pepsi Max" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: breaded schnitzel, potato wedges, mixed salad with vinaigrette, ketchup

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | Y | "breaded schnitzel" (C3 name) |
| thick-cut fries/potato wedges | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Potato wedges" |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Mixed salad with vinaigrette": gold row is itself the consolidated salad |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "ketchup" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: grilled pork sausages with mustard, mashed potatoes, sauerkraut

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y | "grilled pork sausages with mustard", kind right (as C3 "German pork sausages with mustard") |
| sauerkraut | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Sauerkraut" |
| mashed potatoes | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Mashed potatoes" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: Käsespätzle with fried onions, mixed green salad

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y merged | prefill Y from v3-eu-cell-25-flash-newprompt: "Käsespätzle with fried onions" (C3, A name) |
| fried/caramelised onions | Y merged | "Käsespätzle with fried onions" names the onions |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "mixed green salad" is the optional side plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: beef stew with potatoes and mushrooms, green leaf lettuce

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y merged | "beef stew with potatoes and mushrooms" (D3 name, word for word) |
| boiled potatoes | Y merged | same item names the potatoes |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "green leaf lettuce" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | mushrooms are optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: Weisswurst in broth, Sweet mustard, Beer, Pretzel

| gold core item | production | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y | "Weisswurst in broth" |
| pretzel (Brezel) | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "pretzel" |
| sweet mustard | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Sweet Mustard" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16, Döner/gyros plate with fries and salad

- **production**: doner kebab meat with tomato sauce, french fries, mixed salad with dressing, beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | Y merged | "doner kebab meat with tomato sauce" (C3 name) |
| tomato sauce over the meat | Y merged | same item names the tomato sauce |
| French fries | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "French fries" |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | "mixed salad with dressing": the gold row is itself the consolidated salad (precedent) |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: currywurst with sauce, french fries

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y merged | prefill Y from v3-eu-cell-25-flash-newprompt: "Currywurst with sauce" (C3, A, 25-lite name) |
| curry ketchup sauce | Y merged | "currywurst with sauce": sauce entailed by the named dish (C3 precedent) |
| curry powder | n | prefill n from eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt, eu-cell-38-newprompt and 5 more: no reported item covered it |
| French fries | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "French fries" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: meat-filled dumplings, potato salad with bacon

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "meat-filled dumplings": filled pasta pockets, form (as D3 "meat-filled pasta rolls") |
| potato salad | Y | "potato salad with bacon" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: gyros, tzatziki, currywurst, french fries, mayonnaise

| gold core item | production | notes |
|---|---|---|
| French fries | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "French fries" |
| gyros/döner sliced meat | Y | "gyros" |
| sliced sausage in curry/shashlik sauce | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Currywurst" (cloud name) |
| tzatziki/garlic yogurt sauce | Y | "tzatziki" |
| mayonnaise | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Mayonnaise", its own item (D3, A) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 20, Bowl of shio ramen

- **production**: ramen

| gold core item | production | notes |
|---|---|---|
| ramen noodles | Y merged | "ramen" |
| clear (shio) broth | Y merged | "ramen" is noodles in broth (runpod, 25-flash call) |
| sliced chashu pork | n | bare "ramen" names no pork (2026-08-12 cloud "shio ramen" got n) |
| leafy green herb topping (mizuna/mitsuba) | n | not named |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **production**: beef pho noodle soup, bean sprouts and fresh herbs, extra rice noodles

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y merged | "beef pho noodle soup" |
| sliced beef and beef meatballs | Y merged | same item names the beef |
| bean sprouts | Y merged | "bean sprouts and fresh herbs" |
| Thai basil | Y merged | same item, "fresh herbs" for the only herb on the plate (precedent) |
| sliced green chilli/jalapeño | n | prefill n from eu-cell-38-minimal-newprompt, eu-cell-38-prod-oldprompt, v3-eu-cell-38-minimal-newprompt: no reported item covered it |
| spring onion | n | prefill n from eu-cell-38-minimal-newprompt, eu-cell-38-prod-oldprompt, v3-eu-cell-38-minimal-newprompt: no reported item covered it |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | "extra rice noodles" is the optional extra bowl |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: ground beef tacos, corn on the cob, cola

| gold core item | production | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y | "ground beef tacos" |
| grated cheese | n | not named |
| red salsa | n | not named |
| green salsa/tomatillo | n | not named |
| coriander/cilantro | n | not named |
| grilled corn on the cob | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "corn on the cob" |
| **core recall (/6)** | 2/6 |  |
| **hallucinations** | none | "cola" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **production**: smothered burrito with toppings

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | Y merged | "smothered burrito with toppings" |
| green chile sauce | Y merged | "smothered" entails the sauce (precedent) |
| shredded cheddar/jack cheese | n | "toppings" names nothing (rule 1 example) |
| shredded lettuce | n | "toppings" names nothing (rule 1) |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **production**: battered fish, french fries, green peas, tartar sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish fillet | Y | "battered fish" |
| chips/thick-cut fries | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "French Fries" |
| green peas | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Green Peas" |
| tartar sauce | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Tartar Sauce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge

### 25, American breakfast platter

- **production**: back bacon, pancakes with icing sugar, fried egg, pork sausages, hash browns, maple syrup, white toast, butter

| gold core item | production | notes |
|---|---|---|
| pancakes with icing sugar | Y | "pancakes with icing sugar" |
| back bacon rashers | Y | "back bacon" |
| fried egg (sunny side up) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Fried egg" |
| breakfast sausages | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Pork sausages" |
| hash brown/potato croquettes | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Hash browns" |
| toast slices | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "White toast" |
| maple syrup in a shot glass | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Maple syrup" |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none | "butter" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **production**: vegetable fried rice, plain paratha, papadum, yogurt, vegetable soup, vegetable curry, dal, paneer curry, kofta curry

| gold core item | production | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Vegetable Fried Rice" |
| chapati/roti | Y | "plain paratha": wheat flatbread, layering is prep (rule 2) |
| papad (papadum) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Papadum" |
| curd/raita | Y | "yogurt" |
| dal (lentil curry) | Y | "dal" |
| kofta/dumpling curry in orange gravy | Y | "kofta curry" |
| paneer or fish curry in pale gravy | Y | prefill Y from eu-cell-35-eu-newprompt: D "paneer curry" |
| brinjal/eggplant curry | Y | prefill Y from eu-cell-35-eu-newprompt: D "vegetable curry" for the eggplant curry, same call as "vegetable soup" for borscht (precedent) |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none | "vegetable soup" optional; every curry name has a bowl |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **production**: chicken cashew stir-fry, white rice

| gold core item | production | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y | "chicken cashew stir-fry" |
| red bell pepper strips | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, eu-cell-38-prod-oldprompt and 1 more: no reported item covered it |
| onion | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, eu-cell-38-prod-oldprompt and 1 more: no reported item covered it |
| spring onion/green onion | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, eu-cell-38-prod-oldprompt and 1 more: no reported item covered it |
| steamed white rice | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "White rice" |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): dried chilli bits

### 28, Middle-Eastern mezze spread, four composed plates plus flatbread

- **production**: meze bowl, pita bread, spicy dipping sauce

| gold core item | production | notes |
|---|---|---|
| falafel balls | n | "meze bowl" names no part (rule 1, as "sushi platter") |
| grilled flatbread | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Pita bread" (cloud, 25-lite name) |
| hummus/creamy white dip | n | not named; "meze bowl" names nothing |
| green herb-chilli sauce | n | "spicy dipping sauce" names no kind (strict rule 1, 25-lite call) |
| yellow bulgur or couscous | n | not named |
| black beluga lentils | n | not named |
| pickled white cabbage slaw | n | not named |
| green olives | n | not named |
| **core recall (/8)** | 1/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: wheat beer, pickled gherkins, salami, cubed hard cheese, green olives

| gold core item | production | notes |
|---|---|---|
| pickled gherkin slices | Y | "pickled gherkins" |
| salami slices | Y | "salami" |
| cheese cubes | Y | "cubed hard cheese" |
| green olives | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Green olives" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "wheat beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30, Mixed grill board (plancha de grillades)

- **production**: grilled pork ribs, grilled beef steak, meat skewer, baked stuffed potato, mixed salad

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | Y | "grilled pork ribs" |
| grilled beef steak | Y | "grilled beef steak" |
| grilled sausage | n | not named |
| grilled meat skewer with green pepper and tomato | Y | "meat skewer" |
| baked/roasted potato with browned cheese topping | Y | "baked stuffed potato" (as "Stuffed baked potato") |
| mixed leaf salad | Y | "mixed salad": the gold row is itself a salad (precedent "side salad") |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cherry tomato, steak knife

### 31, Bowl of beef/oxtail soup with buttered bread

- **production**: beef stew, buttered brown bread

| gold core item | production | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged | prefill Y from v3-eu-cell-25-flash-newprompt: "Beef stew" (25-lite, runpod, qwenvl name) |
| beef (oxtail) chunks | Y merged | "beef stew", same item as the broth (precedent) |
| buttered bread slices (dark/whole-grain) | Y | "buttered brown bread" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **production**: green olives, raw sliced vegetables, deviled eggs, hummus, sliced cheese, salami, crackers

| gold core item | production | notes |
|---|---|---|
| green olives | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Green olives" |
| cucumber sticks | n | "raw sliced vegetables" names nothing (rule 1, as C3 "mixed vegetable crudites") |
| carrot sticks | n | rule 1, as above |
| bell pepper strips | n | rule 1, as above |
| pan-fried spiced hard-boiled egg halves | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Deviled eggs" (deviled for spiced egg is prep, rule 2) |
| hummus dip | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Hummus" |
| salami/cured meat slices | Y | "salami" |
| cheese slices | Y | "sliced cheese" |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none | "crackers" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **production**: oatmeal with milk, peanut butter, honey, raisins, cinnamon

| gold core item | production | notes |
|---|---|---|
| oatmeal/oat porridge | Y merged | "oatmeal with milk" |
| peanut butter | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Peanut butter" |
| raisins | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Raisins" |
| ground cinnamon | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "cinnamon" |
| milk | Y merged | same item names the milk (D3, 25-lite call) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none | "honey" is the optional drizzle |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: waffles with strawberries and whipped cream

| gold core item | production | notes |
|---|---|---|
| waffles | Y merged | "waffles with strawberries and whipped cream" |
| strawberries (sliced fresh) | Y merged | same item |
| strawberry/berry syrup-compote | n | "with strawberries" credits the strawberries only (one token, one row, C3 call) |
| whipped cream | Y merged | same item |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **production**: doner kebab meat, french fries, tzatziki sauce, mixed salad, pita bread

| gold core item | production | notes |
|---|---|---|
| gyros/döner sliced meat | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Doner Kebab Meat" |
| French fries | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "French Fries" |
| white garlic-yogurt sauce (tzatziki) with oregano | Y | "tzatziki sauce" |
| shredded white cabbage | n | "mixed salad" names no part (rule 1, as D3, 25-flash) |
| tomato slices | n | rule 1 |
| sweetcorn | n | rule 1 |
| cucumber slices | n | rule 1 |
| shredded carrot | n | rule 1 |
| **core recall (/8)** | 3/8 |  |
| **hallucinations** | none | "pita bread" is the optional flatbread in the basket |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: seafood paella with artichokes

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | Y merged | prefill Y from eu-cell-38-minimal-newprompt: "seafood paella with artichokes" |
| whole prawns (langostinos) | Y merged | prefill Y from eu-cell-38-minimal-newprompt: "seafood paella with artichokes" |
| mantis shrimp (galeras) | Y merged | prefill Y from eu-cell-38-minimal-newprompt: "seafood paella with artichokes", "seafood paella" covers the mantis shrimp (2026-08-12 cloud precedent) |
| artichoke pieces | Y merged | prefill Y from eu-cell-38-minimal-newprompt: "seafood paella with artichokes" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: meat pierogi with fried onions, coleslaw

| gold core item | production | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y merged | "meat pierogi with fried onions": the dish is named, the filling is not visible (as D3 "dumplings with meat filling") |
| fried caramelised onion topping | Y merged | same item names the onions |
| grated carrot and cabbage salad | Y | "coleslaw" (as 25-lite "Coleslaw salad") |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **production**: cheeseburger, french fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | "cheeseburger" (C3 name) |
| French fries | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "French fries" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: baked beans, pork sausages, back bacon

| gold core item | production | notes |
|---|---|---|
| baked beans in tomato sauce | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Baked beans" (D3 name) |
| sausage pieces | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Pork sausages" (D3 name) |
| bacon rasher | Y | "back bacon" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **production**: liver and onions in gravy, sausage, french fries, bacon rasher, fried egg, grilled tomato

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | Y | "liver and onions in gravy" names the organ |
| chips/French fries | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "French fries" |
| bacon/gammon slice | Y | "bacon rasher" |
| fried egg (remnant, yolk visible) | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "fried egg" |
| sausage | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Sausage" |
| grilled tomato half | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Grilled tomato" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "onions" in the liver item, a part inside a present item |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: battered fish, roasted potato wedges, mayonnaise

| gold core item | production | notes |
|---|---|---|
| battered fried fish (cod), partly eaten | Y | "battered fish" |
| potato wedges/skin-on roast potatoes | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "roasted potato wedges" |
| tartar sauce / mayonnaise dollop | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Mayonnaise" (D3, cloud name) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **production**: breaded fish fillet with sour cream, meatballs with gravy, chickpea curry, white rice, mixed salad with corn

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | Y merged | "breaded fish fillet with sour cream" |
| sour cream / remoulade dollop | Y merged | same item names the dollop |
| meatballs in brown gravy | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Meatballs with gravy" |
| chickpea-and-cauliflower curry | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Chickpea curry" |
| white rice | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "White rice" |
| red cabbage and sweetcorn salad | Y | "mixed salad with corn": "with corn" names this salad (D3 call on "mixed vegetable salad with corn") |
| cucumber and lettuce salad | n | no item names it; the corn salad item cannot cover two salads |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set, main plate, soup bowl, bread plate

- **production**: creamy grits with bacon, bread with butter, potato and egg frittata, breaded fish cakes with sour cream, green beans, herbed rice, creamy meat and vegetable side

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | "breaded fish cakes with sour cream": cakes named, topping misread |
| herbed green rice | Y | "herbed rice" |
| green beans | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Green beans" |
| cheese-topped quiche/gratin square | Y | "potato and egg frittata": egg square, form (rule 2) |
| creamy meat-and-vegetable stew | Y | "creamy meat and vegetable side" |
| creamy soup (bowl, with bacon bits) | Y | "creamy grits with bacon": photo, a thick white cream with bacon bits in a bowl; gold names no base, porridge for soup is form (rule 2) |
| bread roll with butter | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Bread with butter" |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none | photo opened: every item has a referent ("creamy grits" is the soup bowl) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: mixed salad, stewed brown beans, yellow rice, stewed meat with potato, mashed potatoes with cabbage

| gold core item | production | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | "mixed salad": the gold row is the one salad on the plate (as 25-flash "Mixed green salad") |
| brown beans (feijão) in broth | Y | "stewed brown beans" |
| yellow seasoned rice | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Yellow rice" |
| braised cabbage with tomato | Y merged | "mashed potatoes with cabbage": photo, the cabbage with tomato lies on the mash |
| stewed meat in onion gravy | Y | "stewed meat with potato" |
| mashed cassava/potato purée | Y merged | same mash item |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45, Korean hanjeongsik table spread (dozens of banchan, top-down)

- **production**: stir-fried glass noodles (japchae), steamed egg custard (gyeran-jjim), grilled mackerel, tofu with kimchi, beef bulgogi, spicy braised fish, assorted vegetable pancakes (jeon), raw fish sashimi, assorted fermented side dishes (banchan), soybean soup (kong-guksu broth)

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | Y | "stir-fried glass noodles (japchae)" |
| steamed egg (gyeranjjim) in stone pot | Y | "steamed egg custard (gyeran-jjim)" |
| grilled mackerel/fish | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "grilled mackerel" |
| stir-fried beef in a hot stone pot | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "beef bulgogi" |
| glazed spicy braised ribs/pork | n | "spicy braised fish" is the glazed pork plate (photo): fish for pork, kind miss (rule 2, as D3 "seasoned grilled fish") |
| sliced raw fish (hoe/sashimi) on shredded radish | Y | "raw fish sashimi" |
| vegetable fritters/jeon platter | Y | "assorted vegetable pancakes (jeon)" |
| kimchi | Y | "tofu with kimchi" names the kimchi on the tofu plate (D3 call) |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none | photo opened: "spicy braised fish" is the glazed pork plate, "soybean soup" the white porridge pot, "banchan" the side bowls (rule 3); no empty bowl named as rice |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: steamed bean curd rolls, steamed beef tripe

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | "steamed beef tripe": one tripe token goes to the honeycomb cups (precedent) |
| white boiled tripe/omasum slices in broth | n | one tripe token cannot cover two tripe dishes (precedent) |
| fried beancurd-skin rolls (tofu skin rolls) | Y | "steamed bean curd rolls" (frying lost, form) |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | both names have referents in the basket |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: avocado toast with poached egg, bagel, smoothie bowl, iced coffee, beetroot latte, passion fruit cocktail, white wine

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | "avocado toast with poached egg" (D3 name; the two-piece plate, photo) |
| eggs benedict with hollandaise on avocado toast | n | no item for the benedict plate (photo) |
| yogurt bowl with granola, kiwi slices and berry compote | n | "smoothie bowl" names neither granola nor kiwi (D3 call) |
| cherry tomato salad with balsamic drizzle | n | not named |
| seeded bagel (dark, sesame-topped) | Y | "bagel": the real bagel on the table, not a menu card item |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none | four drinks optional; "bagel" is the bagel on the table; no menu card item named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: potato chips, funfetti cake, vegetable samosas, cucumber sandwich

| gold core item | production | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | "cucumber sandwich" |
| potato chips/crisps | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Potato chips" |
| samosas (small fried triangles) | Y | "vegetable samosas" |
| slice of white/vanilla cake with icing, partly eaten | Y | "funfetti cake": vanilla cake with icing, sprinkles are prep |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49, Cafe sizzling-plate dinner set

- **production**: pork chop with spaghetti, sausage, tomato soup, bread roll

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y merged | "pork chop with spaghetti" |
| spaghetti (plain, buttered) | Y merged | same item names the spaghetti |
| sausage/frankfurter | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Sausage" |
| cherry tomatoes | n | not named |
| red cabbage soup (borscht-style, bowl) | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "tomato soup" for the borscht bowl (35-eu-np precedent) |
| bread bun | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Bread Roll" |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none | "tomato soup" is the borscht bowl misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: kebab meat with tomato sauce, french fries, mixed salad with pickled pepper, beer

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y merged | "kebab meat with tomato sauce" |
| tomato/chili sauce over the meat | Y merged | same item names the tomato sauce |
| French fries | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "French fries" |
| iceberg lettuce salad | n | "mixed salad" names no part (rule 1) |
| sliced red onion | n | rule 1 |
| cucumber slices | n | rule 1 |
| pickled gherkin and pepperoncini | Y | "mixed salad with pickled pepper" names the pepperoncini (photo), one of the two parts of this row |
| **core recall (/7)** | 4/7 |  |
| **hallucinations** | none | "beer" optional; nothing from the background plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 186/235 = 79.1% |
| hallucinations | 0 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 161 |
| cost / plate (auto) | $0.00330 |
| latency median s (auto) | 4.34 |

## Recall and bootstrap confidence interval

> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`, STRICT reading of rule 1 (a generic label such as "greens", "spicy sauce", "toppings", "mixed salad", "raw sliced vegetables", "meze bowl", "cured meat assortment" earns no credit for a specific gold item). Cell: google/gemini-3.1-flash-lite on the EU OpenRouter host (`only: google-vertex/eu`), reasoning `minimal`, v4 prompt, plates repeat 1. Prefill: `--prefill` from the EU sheets only (`runs/eu-*/`, `runs/v3-eu-*/` here and in `op-worktrees/prompt-v3`; 10 distinct sheets; the 2026-08-12, mistral-vs-qwen and runpod sheets left out because they used older rules). Prefill result: 80 Y (12 of them Y merged), 9 n, 0 conflicts, 146 need judgment. Every prefilled row was kept. The 146 open rows were judged by hand, consistent with the same model item name in this order: C3 (`v3-eu-cell-38-minimal-newprompt`), D3 (`v3-eu-cell-35-eu-newprompt`), `v3-eu-cell-25-flash-newprompt`, `v3-eu-cell-mistral-medium-newprompt`, `v3-eu-cell-25-lite-newprompt`. New names were judged fresh. Photos opened: 43, 44, 45, 47, 50. No model was called for this scoring.

- **Hits: 186/235. Recall: 79.1 %.**
- **95 % CI: [70.6, 87.8] %.**
- Method: a percentile bootstrap over plates (a cluster bootstrap, because a plate's items succeed or fail together). Each of 2000 resamples draws 50 plates with replacement with Python's stdlib `random.Random(7)`. Recall of a resample is the sum of its hits over the sum of its gold items. The CI is the 2.5th and 97.5th percentile of the 2000 values, with linear interpolation. The computation is `harness/stats.py` `bootstrap_recall_ci(pairs, resamples=2000, seed=7)`, and a separate stdlib reimplementation gave the same bounds.
- The harness default (`--score`: 10 000 resamples, seed 20260813) gives [70.3, 87.4] %.

Per plate hits: 01 6/6, 02 5/5, 03 8/8, 04 4/4, 05 2/2, 06 1/6, 07 2/5, 08 3/3, 09 1/1, 10 2/2, 11 3/3, 12 3/3, 13 2/2, 14 3/3, 15 3/3, 16 4/4, 17 3/4, 18 2/2, 19 5/5, 20 2/4, 21 4/6, 22 2/6, 23 2/4, 24 4/4, 25 7/7, 26 8/8, 27 2/5, 28 1/8, 29 4/4, 30 5/6, 31 3/3, 32 5/8, 33 5/5, 34 3/4, 35 3/8, 36 4/4, 37 3/3, 38 2/2, 39 3/3, 40 6/6, 41 3/3, 42 6/7, 43 7/7, 44 6/6, 45 7/8, 46 2/3, 47 2/5, 48 4/4, 49 5/6, 50 4/7.

## Hallucinations by plate

None. **0 hallucinations** on 50 plates. A hallucination is a food with no referent in the photo (rule 3).

- Trap leaks: 0. Plate 50 names nothing from the background plate, plate 47 names no menu card item ("bagel" is the bagel on the table), plate 45 names no empty bowl as rice.
- Misnamed visible objects, not counted (rule 3): 43 "creamy grits with bacon" (the soup bowl), 45 "spicy braised fish" (the glazed pork plate) and "soybean soup (kong-guksu broth)" (the white porridge pot), 49 "tomato soup" (the borscht bowl).
- Wrong parts inside a present item, not counted: 05 "carrots" in the rice (the pepper bits).

## Errors, schema-invalid records, false unreadable

- Error records: **0** (`_summary.failures` is empty; every record is HTTP 200, 1 attempt, `finish_reason` stop).
- Schema-invalid records: **0** (`schema_valid` true on 50/50). Error and invalid ids: none.
- False unreadable: **0** (no answer sets `unreadable`; every plate is readable).

## Paired difference against C3

C3 is `op-worktrees/prompt-v3/apps/inference/eval/runs/v3-eu-cell-38-minimal-newprompt/scorecard-filled.md` (3.8 flash, minimal reasoning, v3 prompt), the same 50 plates and the same 235 gold items.

- C3: 199/235 = 84.7 %, 95 % CI [78.2, 90.8] (same method, seed 7, 2000 resamples).
- This cell: 186/235 = 79.1 %, 95 % CI [70.6, 87.8].
- **C3 minus this cell: +5.5 points, paired 95 % CI [+0.8, +10.3].** The interval excludes 0 by a small margin.
- Method: `harness/stats.py` `bootstrap_diff_ci(c3, this_cell, resamples=2000, seed=7)`. Each resample draws one set of 50 plate indices with `random.Random(7)` and applies it to both cells, so plate difficulty cancels. The CI is the 2.5th and 97.5th percentile of the 2000 differences, with linear interpolation. A separate stdlib reimplementation gave the same bounds.
- Plates where the two cells differ (C3 minus this cell, in hits): 06 +2, 20 +1, 23 +2, 28 +2, 33 -1, 35 +3, 42 -1, 43 -1, 45 +1, 46 +1, 47 +3, 50 +1.

Sensitivity to the closest calls (same method):

| variant | hits, recall | 95 % CI | C3 minus this cell [95 % CI] |
|---|---|---|---|
| as filled | 186/235 = 79.1 % | [70.6, 87.8] | +5.5 [+0.8, +10.3] |
| stricter: 43, 44, 50 to n | 183/235 = 77.9 % | [69.4, 86.6] | +6.8 [+2.1, +11.7] |
| more lenient: 20 chashu, 28 herb-chilli sauce to Y | 188/235 = 80.0 % | [71.7, 88.1] | +4.7 [+0.4, +9.5] |

The sign of the difference holds in every variant. Plate 06 nigiri is scored n here, as in r2 and r3 of this cell. Whether the CI excludes 0 depends on two or three close calls, so read it as "C3 is likely ahead by a few points", not as a settled gap.

## Judgment calls that were not obvious

| plate | call | verdict | why unsure |
|---|---|---|---|
| 06 | "nigiri sushi" (three pieces) for tuna nigiri and white-fish nigiri | n, n | strict rule 1: the name gives no fish, as r2 and r3 decided; D3 "assorted nigiri sushi" got a Y merged under a looser reading, so a lenient reading would credit both rows |
| 43 | "creamy grits with bacon" for the creamy soup with bacon bits | Y | the photo shows a thick white cream that could pass for grits; gold names no base, so porridge for soup reads as form, but grits asserts corn |
| 50 | "mixed salad with pickled pepper" for "pickled gherkin and pepperoncini" | Y | the pepperoncini is visible and named; the gherkin is not; no earlier sheet judged this name on this row |
| 44 | "mixed salad" for the green salad (lettuce, grated carrot, coriander) | Y | the gold row is the one salad on the plate (as "Mixed green salad" in 25-flash); on 35 and 50 the same label scored n because gold lists the salad parts row by row |
| 42 | "mixed salad with corn" for the red cabbage and sweetcorn salad | Y | follows the D3 call on "mixed vegetable salad with corn"; C3's bare "mixed side salad" got n |

## Findings

1. Gemini 3.1 Flash Lite with the v4 prompt reaches 186/235 = 79.1 % [70.6, 87.8] with 0 hallucinations and 0 error records, at $0.0033 a plate and a 4.3 s median.
2. C3 v3 leads by +5.5 points, paired CI [+0.8, +10.3]. The losses sit on enumeration plates (35, 47, 28, 23), where this cell gave one generic or merged label ("mixed salad", "smoothie bowl", "meze bowl", "toppings").
