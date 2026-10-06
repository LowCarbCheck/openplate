# Plate-identification scoring worksheet

- results: `runs/v4-eu-cell-31-lite-newprompt-r3/results.json`
- config: `eu-cell-31-lite-newprompt` (started 2026-10-06T13:02:37.650947+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
- prefill: 101 Y, 23 n, 0 conflicts, 111 need judgment, from 11 earlier sheets

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 187 |
| items named (mean/plate) | 3.74 |
| distinct item names | 164 |
| latency mean (s) | 4.04 |
| latency median (s) | 3.79 |
| latency max (s) | 8.12 |
| cost / plate (USD) | 0.00331 |
| cost total (USD) | 0.165485 |

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

- **production**: brown bread, back bacon, cocktail sausages, scrambled eggs, baked beans in tomato sauce, cucumber slices, margarine

| gold core item | production | notes |
|---|---|---|
| scrambled eggs | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Scrambled eggs" |
| bacon/ham slices | Y | "back bacon" |
| frankfurter sausages | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Cocktail sausages" (A name) |
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Baked beans in tomato sauce" |
| brown bread slice | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "brown bread" |
| cucumber slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Cucumber slices" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter/margarine packets

### 02, Roast (Sunday) dinner

- **production**: roast beef, Yorkshire pudding, roast potatoes, steamed broccoli and cabbage, gravy

| gold core item | production | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "roast beef" |
| Yorkshire pudding | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Yorkshire pudding" |
| roast potatoes | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Roast potatoes" |
| broccoli | Y merged | "steamed broccoli and cabbage" names the broccoli (as r1 "mixed broccoli and cabbage") |
| cabbage/greens | Y merged | same item names the cabbage |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **production**: grilled salmon, mediterranean salad

| gold core item | production | notes |
|---|---|---|
| grilled salmon fillets | Y | "grilled salmon" |
| feta cheese | n | "mediterranean salad" is not the determinate dish "Greek salad" and names no part (strict rule 1; as E "mediterranean salad", cited in the 25-flash sheet) |
| kalamata olives | n | "mediterranean salad" is not the determinate dish "Greek salad" and names no part (strict rule 1; as E "mediterranean salad", cited in the 25-flash sheet) |
| avocado | n | "mediterranean salad" is not the determinate dish "Greek salad" and names no part (strict rule 1; as E "mediterranean salad", cited in the 25-flash sheet) |
| cherry tomatoes | n | "mediterranean salad" is not the determinate dish "Greek salad" and names no part (strict rule 1; as E "mediterranean salad", cited in the 25-flash sheet) |
| cucumber | n | "mediterranean salad" is not the determinate dish "Greek salad" and names no part (strict rule 1; as E "mediterranean salad", cited in the 25-flash sheet) |
| lettuce/romaine | n | "mediterranean salad" is not the determinate dish "Greek salad" and names no part (strict rule 1; as E "mediterranean salad", cited in the 25-flash sheet) |
| red onion | n | "mediterranean salad" is not the determinate dish "Greek salad" and names no part (strict rule 1; as E "mediterranean salad", cited in the 25-flash sheet) |
| **core recall (/8)** | 1/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04, Cheeseburger with fries

- **production**: cheeseburger with sauce, french fries, ketchup, pickles

| gold core item | production | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y | "cheeseburger with sauce" |
| thick-cut fries/steak fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "french fries" |
| ketchup | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Ketchup" |
| pickles/gherkins | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Pickles" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **production**: cooked white rice with carrots, chicken and spinach curry

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | "chicken and spinach curry" |
| white rice | Y | "cooked white rice with carrots"; the carrots are the optional pepper bits misnamed (r1 call, rule 3) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: Salmon avocado maki roll, Nigiri sushi, Soy sauce, White wine

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | "Salmon avocado maki roll" |
| tuna nigiri | n | "Nigiri sushi" names no fish (strict rule 1, operator reading for this sheet); r1 gave Y merged on the D3 precedent |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | n | "Nigiri sushi" names no fish (strict rule 1) |
| pickled ginger | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt and 3 more: no reported item covered it |
| wasabi | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt and 3 more: no reported item covered it |
| soy sauce | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Soy sauce" |
| **core recall (/6)** | 2/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: spaghetti with meat and vegetable bolognese

| gold core item | production | notes |
|---|---|---|
| spaghetti | Y merged | "spaghetti with meat and vegetable bolognese" |
| ground beef/meat tomato sauce | Y merged | same item names the meat sauce |
| corn kernels | n | "vegetable" names no part (rule 1, as r1 "mixed vegetables") |
| green beans | n | "vegetable" names no part (rule 1, as r1 "mixed vegetables") |
| carrot pieces | n | "vegetable" names no part (rule 1, as r1 "mixed vegetables") |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **production**: yogurt with sliced apples and granola

| gold core item | production | notes |
|---|---|---|
| yogurt | Y merged | "yogurt with sliced apples and granola" |
| granola (oats/puffed grains, nuts) | Y merged | same item |
| apple slices | Y merged | same item |
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

- **production**: chicken sandwich, mixed salad, Pepsi Max

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Chicken sandwich" (cloud name) |
| green side salad (rocket/mixed leaves) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "mixed salad": the gold row is one generic salad (precedent) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: breaded veal schnitzel with capers and lemon, thick-cut french fries, mixed salad with vinaigrette, ketchup

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | Y | "breaded veal schnitzel with capers and lemon" |
| thick-cut fries/potato wedges | Y | "thick-cut french fries" |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Mixed salad with vinaigrette": gold row is itself the consolidated salad |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: grilled sausages, mashed potatoes, sauerkraut

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y | "grilled sausages", kind right (as 25-flash "Sausages with gravy", 25-lite "Sausages with sauce") |
| sauerkraut | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Sauerkraut" |
| mashed potatoes | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Mashed potatoes" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: käsespätzle, green salad

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y | "käsespätzle" |
| fried/caramelised onions | n | not named (r1 had "with fried onions", this run does not) |
| **core recall (/2)** | 1/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: beef stew with potatoes, lettuce salad

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y merged | prefill Y from v3-eu-cell-25-flash-newprompt: "Beef stew with potatoes" (qwenvl, 25-lite name) |
| boiled potatoes | Y merged | "beef stew with potatoes" names the potatoes (25-flash, 25-lite same name) |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "lettuce salad" (as 25-lite "Mixed lettuce salad") |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: Weisswurst in broth, sweet mustard, wheat beer, pretzel

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

- **production**: döner kebab meat with tomato sauce, french fries, mixed salad with pickled pepper, beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | Y merged | prefill Y from v3-eu-cell-mistral-medium-newprompt: "döner kebab meat with tomato sauce" |
| tomato sauce over the meat | Y merged | "döner kebab meat with tomato sauce" names the sauce |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | "mixed salad with pickled pepper": the gold row is itself the consolidated salad (r1 "mixed salad with dressing") |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: currywurst, french fries

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y merged | "currywurst" |
| curry ketchup sauce | Y merged | "currywurst": sauce entailed by the named dish (25-lite precedent); portion hint "one large sausage with curry sauce" |
| curry powder | n | not named |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: meat-filled dumplings, potato salad

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "meat-filled dumplings": filled pasta pockets, form (as D3 "meat-filled pasta rolls") |
| potato salad | Y | "potato salad" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: gyros, french fries with mayonnaise, currywurst, tzatziki

| gold core item | production | notes |
|---|---|---|
| French fries | Y merged | "french fries with mayonnaise" |
| gyros/döner sliced meat | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "gyros" |
| sliced sausage in curry/shashlik sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Currywurst" (cloud name) |
| tzatziki/garlic yogurt sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "tzatziki" |
| mayonnaise | Y merged | same item names the mayonnaise |
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

- **production**: beef pho, bean sprouts and fresh herbs, rice noodles

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y merged | prefill Y from v3-eu-cell-25-flash-newprompt: "Beef Pho" |
| sliced beef and beef meatballs | Y merged | "beef pho" names the beef (r1 "beef pho noodle soup") |
| bean sprouts | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "bean sprouts and fresh herbs" |
| Thai basil | Y merged | "bean sprouts and fresh herbs", the only herb on the plate (r1 call) |
| sliced green chilli/jalapeño | n | prefill n from eu-cell-35-eu-oldprompt, eu-cell-38-newprompt, eu-cell-38-prod-oldprompt and 3 more: no reported item covered it |
| spring onion | n | prefill n from eu-cell-35-eu-oldprompt, eu-cell-38-newprompt, eu-cell-38-prod-oldprompt and 3 more: no reported item covered it |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: beef tacos with toppings, corn on the cob, cola

| gold core item | production | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y | "beef tacos with toppings" |
| grated cheese | n | "toppings" names nothing (rule 1 example) |
| red salsa | n | "toppings" names nothing (rule 1 example) |
| green salsa/tomatillo | n | "toppings" names nothing (rule 1 example) |
| coriander/cilantro | n | "toppings" names nothing (rule 1 example) |
| grilled corn on the cob | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "corn on the cob" |
| **core recall (/6)** | 2/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **production**: wet burrito

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | Y merged | prefill Y from eu-cell-35-eu-oldprompt: "wet burrito" |
| green chile sauce | Y merged | prefill Y from eu-cell-35-eu-oldprompt: "wet burrito", "smothered/wet" entails the sauce (precedent) |
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

- **production**: bacon, pancakes, fried egg, maple syrup, sausages, hash browns, toast, butter

| gold core item | production | notes |
|---|---|---|
| pancakes with icing sugar | Y | "pancakes"; icing sugar is prep |
| back bacon rashers | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Bacon" |
| fried egg (sunny side up) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Fried egg" |
| breakfast sausages | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "sausages" |
| hash brown/potato croquettes | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Hash browns" |
| toast slices | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "toast" |
| maple syrup in a shot glass | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Maple syrup" |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **production**: vegetable fried rice, roti flatbread with papadum, yogurt, vegetable soup, mixed vegetable curry, lentil dal, creamy chicken curry, kofta curry

| gold core item | production | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Vegetable Fried Rice" |
| chapati/roti | Y merged | "roti flatbread with papadum" |
| papad (papadum) | Y merged | same item names the papadum |
| curd/raita | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "yogurt" |
| dal (lentil curry) | Y | "lentil dal" |
| kofta/dumpling curry in orange gravy | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "kofta curry" |
| paneer or fish curry in pale gravy | n | "creamy chicken curry": chicken is the wrong kind (rule 2, as 25-lite "Chicken Curry") |
| brinjal/eggplant curry | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Mixed Vegetable Curry" for the eggplant curry (D, C2, B2 precedent) |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **production**: chicken stir-fry with cashews, steamed jasmine rice

| gold core item | production | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y | "chicken stir-fry with cashews" |
| red bell pepper strips | n | not named |
| onion | n | not named |
| spring onion/green onion | n | not named |
| steamed white rice | Y | "steamed jasmine rice" |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): dried chilli bits

### 28, Middle-Eastern mezze spread — four composed plates plus flatbread

- **production**: falafel mezze bowl, pita bread, spicy dipping sauce

| gold core item | production | notes |
|---|---|---|
| falafel balls | Y | "falafel mezze bowl" names the falafel |
| grilled flatbread | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Pita bread" (cloud, 25-lite name) |
| hummus/creamy white dip | n | prefill n from eu-cell-38-newprompt, eu-cell-38-prod-oldprompt, v4-eu-cell-31-lite-newprompt-r1: no reported item covered it |
| green herb-chilli sauce | n | "spicy dipping sauce" names no kind (strict rule 1, r1 call) |
| yellow bulgur or couscous | n | prefill n from eu-cell-38-newprompt, eu-cell-38-prod-oldprompt, v3-eu-cell-mistral-medium-newprompt and 1 more: no reported item covered it |
| black beluga lentils | n | prefill n from eu-cell-38-newprompt, eu-cell-38-prod-oldprompt, v3-eu-cell-mistral-medium-newprompt and 1 more: no reported item covered it |
| pickled white cabbage slaw | n | prefill n from eu-cell-38-newprompt, eu-cell-38-prod-oldprompt, v4-eu-cell-31-lite-newprompt-r1: no reported item covered it |
| green olives | n | prefill n from eu-cell-38-newprompt, eu-cell-38-prod-oldprompt, v4-eu-cell-31-lite-newprompt-r1: no reported item covered it |
| **core recall (/8)** | 2/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: wheat beer, gherkin pickles, salami slices, cubed cheese, green olives

| gold core item | production | notes |
|---|---|---|
| pickled gherkin slices | Y | "gherkin pickles" |
| salami slices | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Salami slices" |
| cheese cubes | Y | "cubed cheese" |
| green olives | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Green olives" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30, Mixed grill board (plancha de grillades)

- **production**: mixed salad, grilled pork ribs, grilled meat skewer, grilled steak, baked potato

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "grilled pork ribs" |
| grilled beef steak | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Grilled steak" |
| grilled sausage | n | not named |
| grilled meat skewer with green pepper and tomato | Y | "grilled meat skewer" |
| baked/roasted potato with browned cheese topping | Y | "baked potato"; cheese topping lost (as mistral "roasted potato") |
| mixed leaf salad | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "mixed salad": the gold row is itself a salad (precedent "side salad") |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cherry tomato, steak knife

### 31, Bowl of beef/oxtail soup with buttered bread

- **production**: beef stew, buttered bread

| gold core item | production | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Beef stew" (25-lite, runpod, qwenvl name) |
| beef (oxtail) chunks | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "beef stew", same item as the broth (precedent) |
| buttered bread slices (dark/whole-grain) | Y | "buttered bread" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **production**: green olives, cucumber sticks, carrot sticks, bell pepper strips, deviled eggs, hummus, herbed cheese slices, cheddar cheese slices, salami slices, seed crackers

| gold core item | production | notes |
|---|---|---|
| green olives | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Green olives" |
| cucumber sticks | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Cucumber sticks" |
| carrot sticks | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Carrot sticks" |
| bell pepper strips | Y | "bell pepper strips" |
| pan-fried spiced hard-boiled egg halves | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Deviled eggs" (deviled for spiced egg is prep, rule 2) |
| hummus dip | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Hummus" |
| salami/cured meat slices | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Salami slices" |
| cheese slices | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "cheddar cheese slices" |
| **core recall (/8)** | 8/8 |  |
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
| milk | Y merged | "oatmeal with milk" names the milk (r1 call) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: waffles with strawberry topping and whipped cream

| gold core item | production | notes |
|---|---|---|
| waffles | Y merged | "waffles with strawberry topping and whipped cream" |
| strawberries (sliced fresh) | Y merged | "strawberry topping" credits one row, the strawberries (C3, 25-flash "Strawberry topping") |
| strawberry/berry syrup-compote | n | one token, one row (C3 call) |
| whipped cream | Y merged | same item |
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
| tomato slices | n | prefill n from eu-cell-38-minimal-newprompt, eu-cell-38-newprompt, eu-cell-38-prod-oldprompt and 3 more: no reported item covered it |
| sweetcorn | n | prefill n from eu-cell-38-newprompt, eu-cell-38-prod-oldprompt, v3-eu-cell-25-flash-newprompt and 2 more: no reported item covered it |
| cucumber slices | n | prefill n from eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt, eu-cell-38-newprompt and 5 more: no reported item covered it |
| shredded carrot | n | prefill n from eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt, eu-cell-38-newprompt and 5 more: no reported item covered it |
| **core recall (/8)** | 3/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: seafood paella with artichokes

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "seafood paella with artichokes" |
| whole prawns (langostinos) | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "seafood paella with artichokes" |
| mantis shrimp (galeras) | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "seafood paella with artichokes", "seafood paella" covers the mantis shrimp (2026-08-12 cloud precedent) |
| artichoke pieces | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "seafood paella with artichokes" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: dumplings with meat and onion topping, shredded vegetable salad

| gold core item | production | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y merged | "dumplings with meat and onion topping" (as D3 "dumplings with meat filling", r1 "meat pierogi with fried onions") |
| fried caramelised onion topping | Y merged | same item names the onions |
| grated carrot and cabbage salad | Y | "shredded vegetable salad": the gold row is the one shredded salad on the plate (single salad row precedent, as "mixed salad" on 10, 30, 44) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **production**: hamburger, french fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Hamburger" |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: baked beans, sausages, bacon

| gold core item | production | notes |
|---|---|---|
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Baked beans" (D3 name) |
| sausage pieces | Y | "sausages" |
| bacon rasher | Y | "bacon" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **production**: liver and onions, pork sausage, french fries, grilled bacon, fried egg, grilled tomato

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | Y | "liver and onions" names the organ |
| chips/French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| bacon/gammon slice | Y | "grilled bacon" |
| fried egg (remnant, yolk visible) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "fried egg" |
| sausage | Y | "pork sausage" |
| grilled tomato half | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Grilled tomato" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: battered fish, roasted potato wedges, mayonnaise

| gold core item | production | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten | Y | "battered fish" |
| potato wedges/skin-on roast potatoes | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "roasted potato wedges" |
| tartar sauce / mayonnaise dollop | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Mayonnaise" (D3, cloud name) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **production**: breaded fried fish with mayonnaise, meatballs in brown sauce, steamed white rice, chickpea curry, mixed vegetable side salad

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | Y merged | "breaded fried fish with mayonnaise" |
| sour cream / remoulade dollop | Y merged | same item: mayonnaise for the remoulade dollop (as C3 "with tartar sauce") |
| meatballs in brown gravy | Y | "meatballs in brown sauce" |
| chickpea-and-cauliflower curry | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Chickpea curry" |
| white rice | Y | "steamed white rice" |
| red cabbage and sweetcorn salad | n | "mixed vegetable side salad" names no part (rule 1, as C3 "Mixed side salad") |
| cucumber and lettuce salad | n | rule 1, as above; one generic salad cannot cover two salads |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set — main plate, soup bowl, bread plate

- **production**: creamy grits with bacon, bread with butter, potato cake with sour cream, herb green beans, green herb rice, cheesy vegetable bake, scrambled eggs with ham

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | "potato cake with sour cream": the breaded round cakes (photo), croquette form, topping misread |
| herbed green rice | Y | "green herb rice" |
| green beans | Y | "herb green beans" |
| cheese-topped quiche/gratin square | Y | "cheesy vegetable bake": the cheese-topped square (photo) |
| creamy meat-and-vegetable stew | n | "scrambled eggs with ham" is the stew (photo): egg base, kind miss (2026-08-12 cloud "stew as scrambled egg" flip; C3 n); misnamed, not a hallucination |
| creamy soup (bowl, with bacon bits) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "creamy grits with bacon": photo, a thick white cream with bacon bits in a bowl; gold names no base, porridge for soup is form (rule 2) |
| bread roll with butter | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Bread with butter" |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: mixed salad, stewed brown beans, yellow seasoned rice, braised cabbage, potato mash, braised pork belly

| gold core item | production | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "mixed salad": the gold row is the one salad on the plate (as 25-flash "Mixed green salad") |
| brown beans (feijão) in broth | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "stewed brown beans" |
| yellow seasoned rice | Y | "yellow seasoned rice" |
| braised cabbage with tomato | Y | "braised cabbage" (as 25-flash "Cooked cabbage") |
| stewed meat in onion gravy | Y | "braised pork belly" (as 25-flash "Braised pork"); gold names no kind |
| mashed cassava/potato purée | Y | "potato mash" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45, Korean hanjeongsik table spread (dozens of banchan, top-down)

- **production**: japchae, steamed egg, grilled mackerel, tofu with kimchi, bulgogi, braised spicy meat, sashimi platter, assorted Korean side dishes

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | Y | "japchae" |
| steamed egg (gyeranjjim) in stone pot | Y | "steamed egg" |
| grilled mackerel/fish | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "grilled mackerel" |
| stir-fried beef in a hot stone pot | Y | "bulgogi" (as mistral "beef bulgogi") |
| glazed spicy braised ribs/pork | Y | "braised spicy meat" is the glazed pork plate (photo), kind right |
| sliced raw fish (hoe/sashimi) on shredded radish | Y | "sashimi platter" |
| vegetable fritters/jeon platter | n | "assorted Korean side dishes" names nothing (rule 1) |
| kimchi | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "tofu with kimchi" names the kimchi on the tofu plate (D3 call) |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: steamed beef tripe, steamed bean curd skin rolls

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "steamed beef tripe": one tripe token goes to the honeycomb cups (precedent) |
| white boiled tripe/omasum slices in broth | n | prefill n from v3-eu-cell-35-eu-newprompt, v4-eu-cell-31-lite-newprompt-r1: no reported item covered it |
| fried beancurd-skin rolls (tofu skin rolls) | Y | "steamed bean curd skin rolls" (frying lost, form) |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: Acai bowl with fruit, Beetroot latte, Iced coffee, Avocado toast with poached egg, Sesame bagel, Passion fruit smoothie, White wine

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "avocado toast with poached egg" (D3 name; the two-piece plate, photo) |
| eggs benedict with hollandaise on avocado toast | n | no item for the benedict plate |
| yogurt bowl with granola, kiwi slices and berry compote | n | "Acai bowl with fruit" names neither granola nor kiwi (D3 "acai bowl with fruit" call) |
| cherry tomato salad with balsamic drizzle | n | not named |
| seeded bagel (dark, sesame-topped) | Y | "Sesame bagel": the real bagel on the table, not a menu card item |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: potato chips, confetti cake, samosa, cucumber sandwich

| gold core item | production | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "cucumber sandwich" |
| potato chips/crisps | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Potato chips" |
| samosas (small fried triangles) | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Samosa" |
| slice of white/vanilla cake with icing — partly eaten | Y | "confetti cake": vanilla cake with icing, sprinkles are prep (r1 "funfetti cake") |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49, Cafe sizzling-plate dinner set

- **production**: grilled pork chop with pasta, sausage, tomato soup, bread roll

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y merged | "grilled pork chop with pasta" |
| spaghetti (plain, buttered) | Y merged | same item: pasta for spaghetti is form |
| sausage/frankfurter | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Sausage" |
| cherry tomatoes | n | not named |
| red cabbage soup (borscht-style, bowl) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "tomato soup" for the borscht bowl (35-eu-np precedent) |
| bread bun | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Bread Roll" |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: doner kebab meat with tomato sauce, french fries, mixed salad, beer

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y merged | "doner kebab meat with tomato sauce" |
| tomato/chili sauce over the meat | Y merged | same item names the tomato sauce |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| iceberg lettuce salad | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt and 8 more: no reported item covered it |
| sliced red onion | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt and 7 more: no reported item covered it |
| cucumber slices | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt and 6 more: no reported item covered it |
| pickled gherkin and pepperoncini | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, eu-cell-38-newprompt and 6 more: no reported item covered it |
| **core recall (/7)** | 3/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 179/235 = 76.2% |
| hallucinations | 0 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 164 |
| cost / plate (auto) | $0.00331 |
| latency median s (auto) | 3.79 |

## Recall and bootstrap confidence interval

> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`, STRICT reading of rule 1 (a generic label such as "greens", "spicy sauce", "toppings", "cured meat assortment", "mixed vegetables", bare "mixed salad" where gold lists the parts, "nigiri sushi" with no fish named, earns no credit for a specific gold item). Cell: google/gemini-3.1-flash-lite on the EU OpenRouter host (`only: google-vertex/eu`), reasoning `minimal`, v4 prompt, plates repeat 3. Prefill: `--prefill` from 11 sheets: `runs/eu-*/`, `runs/v3-eu-*/` here and in `op-worktrees/prompt-v3`, plus `runs/v4-eu-cell-31-lite-newprompt-r1/` (this cell, plates repeat 1, filled today under the strict reading). The 2026-08-12 sheets (cloudbaseline, qwenvl, ens3, lfmvl), the mistral-vs-qwen control and runpod were left out because they used older rules. Prefill result: 101 Y (16 of them Y merged), 23 n, 0 conflicts, 111 need judgment. Every prefilled row was kept except one: 06 tuna nigiri, prefilled Y merged from r1, set to n under the strict reading ("nigiri sushi" names no fish). The 111 open rows were judged by hand, consistent with the same model item name in this order: r1 of this cell, C3 (`v3-eu-cell-38-minimal-newprompt`), D3 (`v3-eu-cell-35-eu-newprompt`), `v3-eu-cell-25-flash-newprompt`, `v3-eu-cell-mistral-medium-newprompt`, `v3-eu-cell-25-lite-newprompt`. Photos opened: 43, 45. No model was called for this scoring.

- **Hits: 179/235. Recall: 76.2 %.**
- **95 % CI: [67.3, 85.2] %.**
- Method: a percentile bootstrap over plates (a cluster bootstrap, because a plate's items succeed or fail together). Each of 2000 resamples draws 50 plates with replacement with Python's stdlib `random.Random(7)`. Recall of a resample is the sum of its hits over the sum of its gold items. The CI is the 2.5th and 97.5th percentile of the 2000 values, with linear interpolation. The computation is `harness/stats.py` `bootstrap_recall_ci(pairs, resamples=2000, seed=7)`, and a separate stdlib reimplementation gave the same bounds.
- The harness default (`--score`: 10 000 resamples, seed 20260813) gives [67.2, 85.0] %.

Per plate hits: 01 6/6, 02 5/5, 03 1/8, 04 4/4, 05 2/2, 06 2/6, 07 2/5, 08 3/3, 09 1/1, 10 2/2, 11 3/3, 12 3/3, 13 1/2, 14 3/3, 15 3/3, 16 4/4, 17 3/4, 18 2/2, 19 5/5, 20 2/4, 21 4/6, 22 2/6, 23 2/4, 24 4/4, 25 7/7, 26 7/8, 27 2/5, 28 2/8, 29 4/4, 30 5/6, 31 3/3, 32 8/8, 33 5/5, 34 3/4, 35 3/8, 36 4/4, 37 3/3, 38 2/2, 39 3/3, 40 6/6, 41 3/3, 42 5/7, 43 6/7, 44 6/6, 45 7/8, 46 2/3, 47 2/5, 48 4/4, 49 5/6, 50 3/7.

## Hallucinations by plate

None. **0 hallucinations** on 50 plates. A hallucination is a food with no referent in the photo (rule 3).

- Trap leaks: 0. Plate 50 names nothing from the background plate ("mixed salad" is this plate's lettuce salad), plate 47 names no menu card item ("Sesame bagel" is the bagel on the table), plate 45 names no empty bowl as rice or soup, plate 10 names nothing from the menu poster.
- Misnamed visible objects, not counted (rule 3): 43 "creamy grits with bacon" (the soup bowl) and "scrambled eggs with ham" (the creamy meat stew), 47 "Acai bowl with fruit" (the yogurt bowl), 49 "tomato soup" (the borscht bowl).
- Wrong parts inside a present item, not counted: 05 "carrots" in the rice (the pepper bits).
- Optional items, not counted: drinks on 06, 10, 15, 16, 22, 29, 47, 50; 01 "margarine"; 26 "vegetable soup"; 33 "honey".

## Errors, schema-invalid records, false unreadable

- Error records: **0** (`_summary.failures` is empty; every record is HTTP 200, 1 attempt, `finish_reason` stop).
- Schema-invalid records: **0** (`schema_valid` true on 50/50). Error and invalid ids: none.
- False unreadable: **0** (no answer sets `unreadable`; every plate is readable).

## Paired difference against C3

C3 is `op-worktrees/prompt-v3/apps/inference/eval/runs/v3-eu-cell-38-minimal-newprompt/scorecard-filled.md` (3.8 flash, minimal reasoning, v3 prompt), the same 50 plates and the same 235 gold items.

- C3: 199/235 = 84.7 %, 95 % CI [78.2, 90.8] (same method, seed 7, 2000 resamples).
- This cell: 179/235 = 76.2 %, 95 % CI [67.3, 85.2].
- **C3 minus this cell: +8.5 points, paired 95 % CI [+1.3, +16.3].** The interval excludes 0.
- Method: `harness/stats.py` `bootstrap_diff_ci(c3, this_cell, resamples=2000, seed=7)`. Each resample draws one set of 50 plate indices with `random.Random(7)` and applies it to both cells, so plate difficulty cancels. The CI is the 2.5th and 97.5th percentile of the 2000 differences, with linear interpolation. A separate stdlib reimplementation gave the same bounds.
- Plates where the two cells differ (C3 minus this cell, in hits): 03 +7, 06 +1, 13 +1, 20 +1, 23 +2, 26 +1, 28 +1, 32 -3, 33 -1, 35 +3, 45 +1, 46 +1, 47 +3, 50 +2.
- Against r1 of this cell (188/235): r1 minus r3 is +3.8 points, paired 95 % CI [-1.8, +10.9], same method. Plates that differ: 03 +7, 06 +1, 13 +1, 26 +1, 28 -1, 32 -3, 42 +1, 43 +1, 50 +1. Plate 03 alone ("mediterranean salad" in r3, "greek salad with feta cheese, avocado, olives and vegetables" in r1) carries most of it.

Sensitivity to the closest calls (same method):

| variant | hits, recall | 95 % CI | C3 minus this cell [95 % CI] |
|---|---|---|---|
| as filled | 179/235 = 76.2 % | [67.3, 85.2] | +8.5 [+1.3, +16.3] |
| 03 "mediterranean salad" read as Greek salad (+6, avocado stays n) | 185/235 = 78.7 % | [70.9, 86.5] | +6.0 [+0.4, +11.2] |
| 06 "Nigiri sushi" Y merged on both nigiri rows, as r1 (+2) | 181/235 = 77.0 % | [68.2, 85.6] | +7.7 [+0.0, +15.3] |
| both of the above (+8) | 187/235 = 79.6 % | [71.9, 86.9] | +5.1 [-0.4, +10.3] |
| stricter: 17 sauce, 21 Thai basil, 37 salad to n (-3) | 176/235 = 74.9 % | [66.0, 84.0] | +9.8 [+2.5, +17.4] |

The sign of the difference holds in every variant. Whether its CI excludes 0 depends on plates 03 and 06, so read it as "C3 is ahead", with the size uncertain between about 5 and 10 points.

## Judgment calls that were not obvious

| plate | call | verdict | why unsure |
|---|---|---|---|
| 03 | "mediterranean salad" for feta, olives, avocado, tomato, cucumber, lettuce, red onion | n x7 | not the determinate dish "Greek salad" and names no part (as E "mediterranean salad"); one label swings 6 to 7 hits |
| 06 | "Nigiri sushi" for tuna nigiri and white-fish nigiri | n, n | the strict reading names this label; r1 and D3 gave Y merged, so this sheet departs from r1 here |
| 37 | "shredded vegetable salad" for the grated carrot and cabbage salad | Y | the gold row is the one shredded salad on the plate (single salad row precedent, "mixed salad" on 10, 30, 44), but "vegetable" names no part |
| 43 | "scrambled eggs with ham" for the creamy meat-and-vegetable stew | n | the photo shows a creamy scramble with meat bits; egg base reads as a kind miss (August cloud flip, C3 n), but D3 "minced meat scramble" got Y |
| 21 | "bean sprouts and fresh herbs" for Thai basil | Y merged | follows r1 ("the only herb on the plate"); under a stricter reading "fresh herbs" is as generic as "greens" |

## Findings

1. Gemini 3.1 Flash Lite with the v4 prompt, plates repeat 3, reaches 179/235 = 76.2 % [67.3, 85.2] with 0 hallucinations and 0 error records, at $0.0033 a plate and a 3.8 s median.
2. C3 v3 leads by +8.5 points, paired CI [+1.3, +16.3]. Run to run variance inside this cell is large: r1 scored 188/235, and plate 03 alone moved 7 hits between the two runs on one changed salad label.
