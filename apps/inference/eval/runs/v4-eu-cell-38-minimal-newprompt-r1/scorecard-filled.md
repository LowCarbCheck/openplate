# Plate-identification scoring worksheet

- results: `runs/v4-eu-cell-38-minimal-newprompt-r1/results.json`
- config: `eu-cell-38-minimal-newprompt` (started 2026-10-06T13:06:46.877694+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
- prefill: 100 Y, 10 n, 0 conflicts, 125 need judgment, from 13 earlier sheets

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 210 |
| items named (mean/plate) | 4.2 |
| distinct item names | 194 |
| latency mean (s) | 15.89 |
| latency median (s) | 9.49 |
| latency max (s) | 131.32 |
| cost / plate (USD) | 0.009421 |
| cost total (USD) | 0.471066 |

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

- **production**: Rye or whole grain bread, Baked beans in tomato sauce, Scrambled eggs, Cooked ham, Cocktail sausages, Cucumber slices, Margarine portion

| gold core item | production | notes |
|---|---|---|
| scrambled eggs | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Scrambled eggs" |
| bacon/ham slices | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "cooked ham" |
| frankfurter sausages | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Cocktail sausages" (A name) |
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Baked beans in tomato sauce" |
| brown bread slice | Y | "Rye or whole grain bread" (as mistral "wholemeal bread", 25-lite "Whole grain bread slice") |
| cucumber slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Cucumber slices" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter/margarine packets

### 02, Roast (Sunday) dinner

- **production**: Yorkshire pudding, roast beef with gravy, roast potatoes, steamed broccoli and cabbage

| gold core item | production | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y | "roast beef with gravy" (C3 name, word for word); the gravy is optional, so one core row |
| Yorkshire pudding | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Yorkshire pudding" |
| roast potatoes | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Roast potatoes" |
| broccoli | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "steamed broccoli and cabbage" names the broccoli (as r1 "mixed broccoli and cabbage") |
| cabbage/greens | Y merged | "steamed broccoli and cabbage" names the cabbage (C3 name, word for word; L3 same item) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **production**: pan-seared salmon fillets, Greek salad with avocado and feta

| gold core item | production | notes |
|---|---|---|
| grilled salmon fillets | Y | "pan-seared salmon fillets": pan-seared for grilled is prep (rule 2; C3 "pan-seared salmon fillet") |
| feta cheese | Y merged | "Greek salad with avocado and feta" names the feta |
| kalamata olives | Y merged | "Greek salad with avocado and feta": determinate dish "Greek salad" (rule 1; C3 "Greek salad with avocado", L1, L2) |
| avocado | Y merged | same item names the avocado |
| cherry tomatoes | Y merged | same item, determinate dish "Greek salad" (C3, L1, L2) |
| cucumber | Y merged | same item, determinate dish "Greek salad" (C3, L1, L2) |
| lettuce/romaine | Y merged | same item, determinate dish "Greek salad" (C3, L1, L2) |
| red onion | Y merged | same item, determinate dish "Greek salad" (C3, L1, L2) |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04, Cheeseburger with fries

- **production**: cheeseburger, french fries, ketchup, pickled cucumber

| gold core item | production | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Cheeseburger" |
| thick-cut fries/steak fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "french fries" |
| ketchup | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Ketchup" |
| pickles/gherkins | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "pickled cucumber" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **production**: cooked white rice, chicken and spinach stew

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "Chicken and spinach stew" (C3 name) |
| white rice | Y | "cooked white rice" (C3 name, word for word) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: salmon avocado roll, tuna nigiri, white fish nigiri, soy sauce, white wine

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | "salmon avocado roll" (C3 name, word for word) |
| tuna nigiri | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Tuna nigiri" |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "White fish nigiri" |
| pickled ginger | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt and 6 more: no reported item covered it |
| wasabi | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt and 6 more: no reported item covered it |
| soy sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Soy sauce" |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | "white wine" is the optional wine glass |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: spaghetti bolognese with vegetables

| gold core item | production | notes |
|---|---|---|
| spaghetti | Y merged | prefill Y from eu-cell-38-newprompt: "spaghetti bolognese with vegetables" |
| ground beef/meat tomato sauce | Y merged | prefill Y from eu-cell-38-newprompt: "spaghetti bolognese with vegetables" |
| corn kernels | n | prefill n from eu-cell-38-newprompt, v3-eu-cell-38-minimal-newprompt: no reported item covered it |
| green beans | n | prefill n from eu-cell-38-newprompt, v3-eu-cell-38-minimal-newprompt: no reported item covered it |
| carrot pieces | n | prefill n from eu-cell-38-newprompt, v3-eu-cell-38-minimal-newprompt: no reported item covered it |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **production**: granola with nuts, plain yogurt, apple slices

| gold core item | production | notes |
|---|---|---|
| yogurt | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Plain yogurt" |
| granola (oats/puffed grains, nuts) | Y | "granola with nuts" (C3 name, word for word) |
| apple slices | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Apple slices" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **production**: Chicken and cheese pizza, Cola soft drink

| gold core item | production | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Chicken and Cheese Pizza" (C3 name) |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **production**: chicken sandwich, side salad, Pepsi Max

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Chicken sandwich" (cloud name) |
| green side salad (rocket/mixed leaves) | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "side salad" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: breaded schnitzel, steak cut fries, side salad with dressing, ketchup

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "breaded schnitzel" (C3 name) |
| thick-cut fries/potato wedges | Y | "steak cut fries" (as C3 "steakhouse french fries", L3 "thick-cut french fries") |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | "side salad with dressing": the gold row is itself the consolidated salad (L1, L2, L3 precedent; C3 "side mixed salad with dressing") |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: Grilled Bratwurst with Mustard, Mashed Potatoes, Sauerkraut, Mixed Side Salad

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y | "Grilled Bratwurst with Mustard" |
| sauerkraut | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Sauerkraut" |
| mashed potatoes | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Mashed potatoes" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Mixed Side Salad" is the salad on the background plate (gold trap): a trap leak, not a hallucination |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: Käsespätzle with fried onions, Side salad with creamy dressing

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Käsespätzle with fried onions" (C3, A name) |
| fried/caramelised onions | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Käsespätzle with fried onions" names the onions |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "Side salad with creamy dressing" is the optional background salad plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: beef stew with gravy and mushrooms, boiled potatoes, green side salad with dressing

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y | "beef stew with gravy and mushrooms" (C3 name, word for word) |
| boiled potatoes | Y | "boiled potatoes" (C3 name, word for word) |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "green side salad with dressing" (C3 name, word for word; as 25-flash "Green salad") |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: Weißwurst, Bavarian pretzel, Sweet mustard, Wheat beer

| gold core item | production | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y | "Weißwurst" |
| pretzel (Brezel) | Y | "Bavarian pretzel" |
| sweet mustard | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Sweet Mustard" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16, Döner/gyros plate with fries and salad

- **production**: Doner kebab meat with tomato sauce, French fries, Side salad with dressing and pepperoncini, Beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "doner kebab meat with tomato sauce" (C3 name) |
| tomato sauce over the meat | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "doner kebab meat with tomato sauce" names the sauce (r1) |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | "Side salad with dressing and pepperoncini": the gold row is itself the consolidated salad (L1, L2, L3, 25-flash precedent) |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: currywurst with sauce, french fries

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Currywurst with sauce" (C3, A, 25-lite name) |
| curry ketchup sauce | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "currywurst with sauce": sauce entailed by the named dish (C3 precedent) |
| curry powder | n | prefill n from eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt, eu-cell-38-newprompt and 7 more: no reported item covered it |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: Maultaschen, Swabian potato salad

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "Maultaschen" (C3 name, word for word) |
| potato salad | Y | "Swabian potato salad" (C3 name, word for word) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: French fries with mayonnaise, Gyros with tzatziki, Currywurst

| gold core item | production | notes |
|---|---|---|
| French fries | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "french fries with mayonnaise" |
| gyros/döner sliced meat | Y merged | "Gyros with tzatziki" (C3 name, word for word) |
| sliced sausage in curry/shashlik sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Currywurst" (cloud name) |
| tzatziki/garlic yogurt sauce | Y merged | same item names the tzatziki (C3) |
| mayonnaise | Y merged | "French fries with mayonnaise" names the mayonnaise (C3 name, L3 same item) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 20, Bowl of shio ramen

- **production**: Ramen noodles in broth, Pork chashu, Mizuna greens

| gold core item | production | notes |
|---|---|---|
| ramen noodles | Y merged | prefill Y from v3-eu-cell-mistral-medium-newprompt: "ramen noodles in broth" |
| clear (shio) broth | Y merged | "Ramen noodles in broth" names the broth (mistral name) |
| sliced chashu pork | Y | "Pork chashu", its own item |
| leafy green herb topping (mizuna/mitsuba) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Mizuna greens" names the mizuna, so not the generic "greens" that the strict reading rejects |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **production**: Beef pho, Pho vegetable garnish with bean sprouts and Thai basil, Side of rice noodles, Iced tea

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Beef Pho" |
| sliced beef and beef meatballs | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "beef pho" names the beef (r1 "beef pho noodle soup") |
| bean sprouts | Y merged | "Pho vegetable garnish with bean sprouts and Thai basil" names the sprouts (as C3 "raw bean sprouts and thai basil plate") |
| Thai basil | Y merged | same item names the Thai basil |
| sliced green chilli/jalapeño | n | not named |
| spring onion | n | not named |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: ground beef tacos, grilled corn on the cob, cola beverage

| gold core item | production | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "ground beef tacos" |
| grated cheese | n | "ground beef tacos" names no cheese (L1 same item n) |
| red salsa | n | not named (L1 same item n) |
| green salsa/tomatillo | n | not named |
| coriander/cilantro | n | not named |
| grilled corn on the cob | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "grilled corn on the cob" |
| **core recall (/6)** | 2/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **production**: Smothered burrito

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | Y merged | prefill Y from v3-eu-cell-25-flash-newprompt: "Smothered burrito" (25-lite, D2 name) |
| green chile sauce | Y merged | prefill Y from v3-eu-cell-25-flash-newprompt: "Smothered burrito", "smothered" entails the sauce (precedent) |
| shredded cheddar/jack cheese | n | prefill n from v3-eu-cell-25-flash-newprompt, v3-eu-cell-25-lite-newprompt: no reported item covered it |
| shredded lettuce | n | prefill n from v3-eu-cell-25-flash-newprompt: no reported item covered it |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **production**: Battered fish fillet, French fries, Green peas, Tartar sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish fillet | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Battered Fish Fillet" |
| chips/thick-cut fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French Fries" |
| green peas | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Green Peas" |
| tartar sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Tartar Sauce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge

### 25, American breakfast platter

- **production**: pancakes with powdered sugar, fried egg, back bacon, breakfast sausages, hash browns, toasted white bread, pancake syrup, butter portion

| gold core item | production | notes |
|---|---|---|
| pancakes with icing sugar | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Pancakes with powdered sugar" |
| back bacon rashers | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "back bacon" |
| fried egg (sunny side up) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Fried egg" |
| breakfast sausages | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Breakfast sausages" |
| hash brown/potato croquettes | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Hash browns" |
| toast slices | Y | "toasted white bread" (C3 name, word for word) |
| maple syrup in a shot glass | Y | "pancake syrup" for the syrup shot glass (C3 name, word for word) |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **production**: vegetable fried rice, papadum, chapati flatbread, plain yogurt (curd), cabbage and tomato salad, clear vegetable soup, kofta curry, dal (lentil curry), paneer curry, mixed vegetable curry

| gold core item | production | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Vegetable Fried Rice" |
| chapati/roti | Y | "chapati flatbread" |
| papad (papadum) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Papadum" |
| curd/raita | Y | "plain yogurt (curd)" |
| dal (lentil curry) | Y | "dal (lentil curry)" |
| kofta/dumpling curry in orange gravy | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "kofta curry" |
| paneer or fish curry in pale gravy | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: D "paneer curry" |
| brinjal/eggplant curry | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Mixed Vegetable Curry" for the eggplant curry (D, C2, B2 precedent) |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **production**: stir-fried chicken with cashew nuts and vegetables, cooked jasmine rice

| gold core item | production | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y | "stir-fried chicken with cashew nuts and vegetables" (C3 name, word for word); "vegetables" names no vegetable, so not merged |
| red bell pepper strips | n | "vegetables" names nothing (strict rule 1; C3 same item n) |
| onion | n | rule 1, as above (C3 n) |
| spring onion/green onion | n | not named |
| steamed white rice | Y | "cooked jasmine rice" (as L2, L3 "steamed jasmine rice") |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): dried chilli bits

### 28, Middle-Eastern mezze spread — four composed plates plus flatbread

- **production**: falafel, grilled flatbread, hummus, cooked brown lentils, seasoned bulgur, pickled vegetables, beetroot salad, herb chili oil dipping sauce, green olives

| gold core item | production | notes |
|---|---|---|
| falafel balls | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Falafel" |
| grilled flatbread | Y | "grilled flatbread" (C3 name, word for word) |
| hummus/creamy white dip | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Hummus" |
| green herb-chilli sauce | Y | "herb chili oil dipping sauce" names the herb and chilli oil (as C3 "chili herb dipping oil", L2 "chili dipping oil"; photo: the two oil bowls) |
| yellow bulgur or couscous | Y | "seasoned bulgur" (as 25-flash "Bulgur salad") |
| black beluga lentils | Y | "cooked brown lentils": lentil kind right, the colour is a variety slip (as 25-flash "Lentil salad", B2 "Cooked lentils"; photo: dark lentils) |
| pickled white cabbage slaw | n | "pickled vegetables" names a class, not the cabbage (strict rule 1, as mistral "pickled vegetables" on 50 and B2 on 28); the pink pickled turnip is optional |
| green olives | Y | "green olives" |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none | "beetroot salad" is the optional diced beetroot; "pickled vegetables" the optional pickled turnip |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: Weissbier (wheat beer), Salami slices, Cheese cubes, Green olives, Pickled gherkins and dip

| gold core item | production | notes |
|---|---|---|
| pickled gherkin slices | Y | "Pickled gherkins and dip" |
| salami slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Salami slices" |
| cheese cubes | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "cheese cubes" |
| green olives | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Green olives" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30, Mixed grill board (plancha de grillades)

- **production**: grilled beef steak, roasted pork ribs, meat and vegetable skewers, twice-baked stuffed potato with cheese, mixed leaf side salad

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "roasted pork ribs" |
| grilled beef steak | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "grilled beef steak" |
| grilled sausage | n | not named (C3, L1, L2, L3 n) |
| grilled meat skewer with green pepper and tomato | Y | "meat and vegetable skewers" (C3 name, word for word) |
| baked/roasted potato with browned cheese topping | Y | "twice-baked stuffed potato with cheese" (as C3 "twice-baked potato with cheese") |
| mixed leaf salad | Y | "mixed leaf side salad": the gold row is itself a salad (L1, L2, L3 precedent) |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cherry tomato, steak knife

### 31, Bowl of beef/oxtail soup with buttered bread

- **production**: beef goulash soup, buttered bread

| gold core item | production | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged | "beef goulash soup" (C3 name, word for word; as mistral "beef goulash") |
| beef (oxtail) chunks | Y merged | same item as the broth (precedent) |
| buttered bread slices (dark/whole-grain) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "buttered bread" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **production**: Deviled eggs, Hummus dip, Herb-speckled semi-hard cheese slices, Cheddar cheese slices, Salami slices, Herb crackers, Green olives, Mixed bell pepper strips, Carrot sticks, Cucumber sticks

| gold core item | production | notes |
|---|---|---|
| green olives | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Green olives" |
| cucumber sticks | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Cucumber sticks" |
| carrot sticks | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Carrot sticks" |
| bell pepper strips | Y | "Mixed bell pepper strips" (as L3 "bell pepper strips") |
| pan-fried spiced hard-boiled egg halves | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Deviled eggs" (deviled for spiced egg is prep, rule 2) |
| hummus dip | Y | "Hummus dip" |
| salami/cured meat slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Salami slices" |
| cheese slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "cheddar cheese slices" |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **production**: cooked oatmeal, peanut butter, maple syrup, raisins, ground cinnamon

| gold core item | production | notes |
|---|---|---|
| oatmeal/oat porridge | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Cooked oatmeal" |
| peanut butter | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Peanut butter" |
| raisins | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Raisins" |
| ground cinnamon | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Ground Cinnamon" |
| milk | n | prefill n from eu-cell-38-newprompt, eu-cell-38-prod-oldprompt, v3-eu-cell-25-flash-newprompt and 2 more: no reported item covered it |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none | "maple syrup" is the optional syrup drizzle |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: Belgian waffle, Whipped cream, Strawberries with strawberry sauce

| gold core item | production | notes |
|---|---|---|
| waffles | Y | "Belgian waffle" (C3 name, word for word) |
| strawberries (sliced fresh) | Y merged | "Strawberries with strawberry sauce" names the strawberries |
| strawberry/berry syrup-compote | Y merged | same item names the strawberry sauce on its own (as D3, where one item named the syrup; C3 "strawberry topping" named only one thing and got n) |
| whipped cream | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Whipped cream" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **production**: French fries, Doner kebab meat with garlic yogurt sauce, Side salad with shredded cabbage, tomato, cucumber, corn and olive

| gold core item | production | notes |
|---|---|---|
| gyros/döner sliced meat | Y merged | "Doner kebab meat with garlic yogurt sauce" (C3 name, word for word) |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French Fries" |
| white garlic-yogurt sauce (tzatziki) with oregano | Y merged | same item names the garlic yogurt sauce (C3) |
| shredded white cabbage | Y merged | "Side salad with shredded cabbage, tomato, cucumber, corn and olive" names the cabbage (as C3 "side salad with corn, tomato and cabbage") |
| tomato slices | Y merged | same item names the tomato |
| sweetcorn | Y merged | same item names the corn |
| cucumber slices | Y merged | same item names the cucumber |
| shredded carrot | n | not named |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: seafood paella with artichokes and mantis shrimp

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | Y merged | "seafood paella with artichokes and mantis shrimp" (as L1 "seafood paella with artichokes") |
| whole prawns (langostinos) | Y merged | same item, paella names the prawns (rule 1 example) |
| mantis shrimp (galeras) | Y merged | same item names the mantis shrimp |
| artichoke pieces | Y merged | same item names the artichokes |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: Dumplings with caramelized onions, Cabbage and carrot salad

| gold core item | production | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y merged | "Dumplings with caramelized onions" (as 25-lite "Pierogi with caramelized onions", C3 "dumplings with savory filling topped with fried onions") |
| fried caramelised onion topping | Y merged | same item names the onions |
| grated carrot and cabbage salad | Y | "Cabbage and carrot salad" (as C3 "cabbage and carrot slaw") |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **production**: hamburger, French fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Hamburger" |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: baked beans, pork breakfast sausage, fried back bacon

| gold core item | production | notes |
|---|---|---|
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Baked beans" (D3 name) |
| sausage pieces | Y | "pork breakfast sausage" (as C3 "breakfast pork sausage pieces") |
| bacon rasher | Y | "fried back bacon" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **production**: French fries, Beef steak with gravy, Pan-fried liver pieces, Pork sausage, Grilled gammon steak, Fried egg, Grilled tomato

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | Y | "Pan-fried liver pieces" names the organ |
| chips/French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| bacon/gammon slice | Y | "Grilled gammon steak" (C3 "Gammon steak") |
| fried egg (remnant, yolk visible) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "fried egg" |
| sausage | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "pork sausage" |
| grilled tomato half | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Grilled tomato" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Beef steak with gravy" has a referent: the flat meat slices in the gravy (photo) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: Battered fish fillet, Roasted potato wedges, Mayonnaise or tartar sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "battered fish fillet" |
| potato wedges/skin-on roast potatoes | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "roasted potato wedges" |
| tartar sauce / mayonnaise dollop | Y | "Mayonnaise or tartar sauce" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **production**: breaded fish fillet with sauce, meatballs with gravy, chickpea curry, white rice, mixed vegetable salad with corn

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | Y | "breaded fish fillet with sauce"; "sauce" names no kind, so not merged |
| sour cream / remoulade dollop | n | "with sauce" names no sauce kind (strict rule 1, as 25-flash and 25-lite "with sauce" on 50) |
| meatballs in brown gravy | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Meatballs with gravy" |
| chickpea-and-cauliflower curry | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Chickpea curry" |
| white rice | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "White rice" |
| red cabbage and sweetcorn salad | Y | "mixed vegetable salad with corn": "with corn" names this salad (D3 call on the same name, L1 "mixed salad with corn") |
| cucumber and lettuce salad | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, eu-cell-38-newprompt and 7 more: no reported item covered it |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set — main plate, soup bowl, bread plate

- **production**: bread roll slice with butter, creamy soup with bacon bits, breaded fish or chicken patties with creamy sauce, herbed green rice, steamed green beans, baked frittata or potato bake square, scrambled eggs or potato bacon salad

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | "breaded fish or chicken patties with creamy sauce": cakes named, as C3 "breaded fish or chicken patties with mayonnaise" |
| herbed green rice | Y | "herbed green rice" |
| green beans | Y | "steamed green beans" |
| cheese-topped quiche/gratin square | Y | "baked frittata or potato bake square": the egg or gratin square, form (as L1 "potato and egg frittata", 25-flash "Potato gratin") |
| creamy meat-and-vegetable stew | n | "scrambled eggs or potato bacon salad" is the stew misread: egg or potato salad for meat stew, kind miss (C3 "pasta or potato salad" n, L3 "scrambled eggs with ham" n); misnamed, not a hallucination |
| creamy soup (bowl, with bacon bits) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Creamy soup with bacon bits" |
| bread roll with butter | Y | "bread roll slice with butter" |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: green salad with shredded carrots, braised cabbage with tomato, cooked pinto beans, yellow seasoned rice, mashed potatoes, stewed chicken

| gold core item | production | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | "green salad with shredded carrots" names the carrot; the one salad on the plate |
| brown beans (feijão) in broth | Y | "cooked pinto beans" (C3 name, word for word; bean kind right) |
| yellow seasoned rice | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "yellow seasoned rice" |
| braised cabbage with tomato | Y | "braised cabbage with tomato" |
| stewed meat in onion gravy | Y | "stewed chicken": gold names no kind, stewed meat (as mistral "grilled meat", L1 "stewed meat with potato") |
| mashed cassava/potato purée | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "mashed potatoes" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45, Korean hanjeongsik table spread (dozens of banchan, top-down)

- **production**: Bulgogi, Spicy marinated grilled meat, Gyeran-jjim (Korean steamed eggs), Dubu kimchi (tofu with sautéed kimchi), Grilled mackerel, Japchae (stir-fried glass noodles), Assorted Jeon (Korean savory pancakes), Assorted sashimi (Hoe), Creamy soup or porridge, Baechu kimchi (Napa cabbage kimchi), Yeolmu mul-kimchi (Water kimchi), Assorted namul (Korean seasoned vegetables)

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | Y | "Japchae (stir-fried glass noodles)" |
| steamed egg (gyeranjjim) in stone pot | Y | "Gyeran-jjim (Korean steamed eggs)" |
| grilled mackerel/fish | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "grilled mackerel" |
| stir-fried beef in a hot stone pot | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "bulgogi" (as mistral "beef bulgogi") |
| glazed spicy braised ribs/pork | Y | "Spicy marinated grilled meat" is the glazed pork plate, kind right (as L3 "braised spicy meat"; the beef token went to the stone pot as "Bulgogi") |
| sliced raw fish (hoe/sashimi) on shredded radish | Y | "Assorted sashimi (Hoe)" |
| vegetable fritters/jeon platter | Y | "Assorted Jeon (Korean savory pancakes)" |
| kimchi | Y | "Baechu kimchi (Napa cabbage kimchi)" |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none | "Yeolmu mul-kimchi" is the red water kimchi bowl, "Creamy soup or porridge" the optional white pot, "Assorted namul" the optional greens (photo) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: dim sum steamed bean curd rolls, dim sum curried honeycomb beef tripe, dim sum steamed beef omasum tripe with ginger

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | "dim sum curried honeycomb beef tripe" |
| white boiled tripe/omasum slices in broth | Y | "dim sum steamed beef omasum tripe with ginger", its own item (as C3 "Steamed beef omasum tripe with ginger and scallion") |
| fried beancurd-skin rolls (tofu skin rolls) | Y | "dim sum steamed bean curd rolls" (frying lost, form; L1 same name minus "dim sum") |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: smoothie bowl with kiwi and granola, eggs florentine with hollandaise and tomatoes, avocado toast with poached eggs and cherry tomatoes, seeded bagel with side garnish, iced latte, beetroot latte, passion fruit drink, white wine

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y merged | "avocado toast with poached eggs and cherry tomatoes" (the same item also covers the tomato salad on that plate) |
| eggs benedict with hollandaise on avocado toast | Y merged | "eggs florentine with hollandaise and tomatoes": poached eggs with hollandaise on the benedict plate, florentine for benedict is prep (rule 2); the item also names the tomatoes |
| yogurt bowl with granola, kiwi slices and berry compote | Y | prefill Y from eu-cell-38-prod-oldprompt: "smoothie bowl with kiwi and granola" names the bowl; D "acai bowl with fruit" names neither granola nor kiwi |
| cherry tomato salad with balsamic drizzle | Y merged | "with cherry tomatoes" and "with ... tomatoes" on the toast and the benedict plates; photo: each plate carries its cherry tomato salad with balsamic lines (C3 consolidation call, same wording) |
| seeded bagel (dark, sesame-topped) | Y | "seeded bagel with side garnish": the real bagel on the table, not a menu card item |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none | no menu card item; "seeded bagel" is the real bagel |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: triangle sandwich, frosted vanilla cake slice, potato chips, mini vegetable samosas

| gold core item | production | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | "triangle sandwich" (C3 name, word for word; as 25-lite "Sandwich") |
| potato chips/crisps | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Potato chips" |
| samosas (small fried triangles) | Y | "mini vegetable samosas" |
| slice of white/vanilla cake with icing — partly eaten | Y | "frosted vanilla cake slice" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49, Cafe sizzling-plate dinner set

- **production**: grilled pork chop with black pepper sauce, frankfurter sausage, spaghetti with black pepper sauce, dinner bread roll, Hong Kong style borscht / tomato vegetable soup

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y | "grilled pork chop with black pepper sauce" (C3 name, word for word) |
| spaghetti (plain, buttered) | Y | "spaghetti with black pepper sauce", its own item |
| sausage/frankfurter | Y | "frankfurter sausage" |
| cherry tomatoes | n | not named |
| red cabbage soup (borscht-style, bowl) | Y | "Hong Kong style borscht / tomato vegetable soup" (as C3 "borscht soup") |
| bread bun | Y | "dinner bread roll" |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: Doner kebab meat with tomato sauce, French fries, Side salad with cucumber and pickled pepper, Lager beer

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "doner kebab meat with tomato sauce" |
| tomato/chili sauce over the meat | Y merged | "Doner kebab meat with tomato sauce" names the sauce (C3, L1, L2, L3 same item) |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| iceberg lettuce salad | n | "Side salad with cucumber and pickled pepper" names no lettuce (rule 1) |
| sliced red onion | n | not named |
| cucumber slices | Y merged | "Side salad with cucumber and pickled pepper" names the cucumber (as C3 "side salad with cucumber and onion") |
| pickled gherkin and pepperoncini | Y merged | same item names the pickled pepper (photo: pepperoncini), one of the two parts of this row (L1 "mixed salad with pickled pepper") |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 208/235 = 88.5% |
| hallucinations | 0 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 194 |
| cost / plate (auto) | $0.00942 |
| latency median s (auto) | 9.49 |

## Recall and bootstrap confidence interval

> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`, STRICT reading of rule 1 (a generic label such as "greens", "spicy sauce", "toppings", "mixed vegetables", "vegetables", "pickled vegetables", "with sauce", a bare "mixed salad" where gold lists the parts, "nigiri sushi" with no fish, "mediterranean salad" with no part named, earns no credit for a specific gold item). Cell: google/gemini-3.8-flash on the global OpenRouter host (`only: google-vertex`, zdr), reasoning `minimal`, v4 prompt, plates repeat 1. This is the reference cell for the v4 comparison. Prefill: `--prefill` from `runs/eu-*/`, `runs/v3-eu-*/`, the three `v4-eu-cell-31-lite-newprompt-r{1,2,3}` sheets, and the `v3-eu-cell-*` and `eu-cell-*` sheets of `op-worktrees/prompt-v3` (13 distinct sheets; every 2026-08 sheet, runpod, ens3, lfmvl, qwenvl and mistral-vs-qwen left out). Prefill result: 100 Y (16 of them Y merged), 10 n, 0 conflicts, 125 need judgment. Every prefilled row was kept. The 125 open rows were judged by hand, consistent with the same model item name in this order: the three v4 3.1 lite sheets, C3 (`v3-eu-cell-38-minimal-newprompt`), D3 (`v3-eu-cell-35-eu-newprompt`), `v3-eu-cell-25-flash-newprompt`, `v3-eu-cell-mistral-medium-newprompt`, `v3-eu-cell-25-lite-newprompt`. Many open rows carry an item name word for word from C3, whose Y cells have empty notes and so cannot be remembered by the prefill. New names were judged fresh. Photos opened: 12, 28, 40, 45, 47. No model was called for this scoring.

- **Hits: 208/235. Recall: 88.5 %.**
- **95 % CI: [82.9, 93.4] %.**
- Method: a percentile bootstrap over plates (a cluster bootstrap, because a plate's items succeed or fail together). Each of 2000 resamples draws 50 plates with replacement with Python's stdlib `random.Random(7)`. Recall of a resample is the sum of its hits over the sum of its gold items. The CI is the 2.5th and 97.5th percentile of the 2000 values, with linear interpolation. The computation is `harness/stats.py` `bootstrap_recall_ci(pairs, resamples=2000, seed=7)` on the pairs that `harness.scorecard.load_filled` reads from this sheet.
- The harness default (`--score`: 10 000 resamples, seed 20260813) gives [82.8, 93.7] %.

Per plate hits: 01 6/6, 02 5/5, 03 8/8, 04 4/4, 05 2/2, 06 4/6, 07 2/5, 08 3/3, 09 1/1, 10 2/2, 11 3/3, 12 3/3, 13 2/2, 14 3/3, 15 3/3, 16 4/4, 17 3/4, 18 2/2, 19 5/5, 20 4/4, 21 4/6, 22 2/6, 23 2/4, 24 4/4, 25 7/7, 26 8/8, 27 2/5, 28 7/8, 29 4/4, 30 5/6, 31 3/3, 32 8/8, 33 4/5, 34 4/4, 35 7/8, 36 4/4, 37 3/3, 38 2/2, 39 3/3, 40 6/6, 41 3/3, 42 5/7, 43 6/7, 44 6/6, 45 8/8, 46 3/3, 47 5/5, 48 4/4, 49 5/6, 50 5/7.

## Hallucinations by plate

None. **0 hallucinations** on 50 plates. A hallucination is a food with no referent in the photo (rule 3).

- Trap leaks, not counted as hallucinations: 12 "Mixed Side Salad" is the salad on the background plate (gold trap; photo). Plate 50 names nothing from the background plate, plate 47 names no menu card item ("seeded bagel" is the bagel on the table), plate 45 names no empty bowl as rice.
- Referents checked on the photo: 40 "Beef steak with gravy" (the flat meat slices in the gravy), 45 "Yeolmu mul-kimchi" (the red water kimchi bowl), "Creamy soup or porridge" (the optional white pot) and "Assorted namul" (the optional greens).
- Misnamed visible objects, not counted (rule 3): 43 "scrambled eggs or potato bacon salad" (the creamy meat stew).
- Optional items reported, no error: 06 white wine, 13 the background salad plate, 26 cabbage and tomato salad and clear vegetable soup, 28 beetroot salad and pickled vegetables, 33 maple syrup, 35 olive.

## Errors, schema-invalid records, false unreadable

- Error records: **0** (`_summary.failures` is empty; every record is HTTP 200, 1 attempt, `finish_reason` stop).
- Schema-invalid records: **0** (`schema_valid` true on 50/50). Error and invalid ids: none.
- False unreadable: **0** (`unreadable` is false on every plate; every plate is readable).
- Slow records, not errors: 29 (131.3 s), 49 (78.7 s), 48 (49.5 s).

## Paired difference against C3 v3

C3 v3 is `op-worktrees/prompt-v3/apps/inference/eval/runs/v3-eu-cell-38-minimal-newprompt/scorecard-filled.md` (3.8 flash, minimal reasoning, v3 prompt), the same 50 plates and the same 235 gold items. This cell is the same model and reasoning with the v4 prompt, so the difference is the v3 to v4 prompt effect on 3.8.

- C3 v3: 199/235 = 84.7 %, 95 % CI [78.2, 90.8] (same method, seed 7, 2000 resamples).
- This cell: 208/235 = 88.5 %, 95 % CI [82.9, 93.4].
- **C3 v3 minus this cell: -3.8 points, paired 95 % CI [-8.7, 0.0].** The v4 prompt is ahead by 3.8 points; the upper bound touches 0, so the interval does not exclude 0.
- Method: `harness/stats.py` `bootstrap_diff_ci(c3, this_cell, resamples=2000, seed=7)`. Each resample draws one set of 50 plate indices with `random.Random(7)` and applies it to both cells, so plate difficulty cancels. The CI is the 2.5th and 97.5th percentile of the 2000 differences, with linear interpolation.
- Plates where the two cells differ (C3 v3 minus this cell, in hits): 06 -1, 20 -1, 23 +2, 28 -4, 32 -3, 34 -1, 35 -1. The gains sit on enumeration plates: 28 (the mezze bowl split into its parts), 32 (the vegetable sticks named one by one), 35 (the salad parts named).

Sensitivity to the closest calls (same method):

| variant | hits, recall | 95 % CI | C3 v3 minus this cell [95 % CI] |
|---|---|---|---|
| as filled | 208/235 = 88.5 % | [82.9, 93.4] | -3.8 [-8.7, 0.0] |
| stricter: 34, 42, 47, 50 to n | 204/235 = 86.8 % | [80.7, 92.2] | -2.1 [-7.2, +2.5] |
| strictest: also 28 lentils and 45 glazed pork to n | 202/235 = 86.0 % | [80.0, 91.4] | -1.3 [-5.9, +3.0] |
| more lenient: 28 pickled cabbage slaw to Y | 209/235 = 88.9 % | [83.4, 93.8] | -4.3 [-9.9, 0.0] |

The sign holds in every variant: v4 is ahead of v3 on 3.8. The gap is small and inside the noise of 50 plates. Read it as "v4 is likely not worse on 3.8 and may be a few points better", not as a settled gain.

## Judgment calls that were not obvious

| plate | call | verdict | why unsure |
|---|---|---|---|
| 47 | "avocado toast with poached eggs and cherry tomatoes" and "eggs florentine with hollandaise and tomatoes" for the cherry tomato salad with balsamic | Y merged | the photo shows a tomato salad with balsamic lines on each of those plates, and C3 got the same consolidation; the three v4 lite sheets never named tomatoes, so they give no precedent |
| 50 | "Side salad with cucumber and pickled pepper" for "pickled gherkin and pepperoncini" | Y merged | names the pepperoncini, not the gherkin; follows L1 "mixed salad with pickled pepper" |
| 42 | "mixed vegetable salad with corn" for the red cabbage and sweetcorn salad | Y | follows the D3 call on this name and L1 "mixed salad with corn"; L3 "mixed vegetable side salad" and C3 "Mixed side salad" got n |
| 34 | "Strawberries with strawberry sauce" for the strawberry syrup | Y merged | the item names the sauce as its own thing; C3 "strawberry topping" got n under "one token, one row" |
| 28 | "cooked brown lentils" for black beluga lentils; "pickled vegetables" for the pickled cabbage slaw | Y; n | the lentils are dark (colour slip, kind right); "pickled vegetables" follows the strict class reading of mistral and B2 |

## Findings

1. Gemini 3.8 Flash at minimal reasoning with the v4 prompt reaches 208/235 = 88.5 % [82.9, 93.4] with 0 hallucinations and 0 error records, at $0.0094 a plate and a 9.5 s median.
2. Against the same model on the v3 prompt (C3 v3, 84.7 %), C3 v3 minus this cell is -3.8 points, paired CI [-8.7, 0.0]. The v4 gain comes from enumeration plates (28, 32, 35), where v4 names the parts instead of one bowl or platter label.
