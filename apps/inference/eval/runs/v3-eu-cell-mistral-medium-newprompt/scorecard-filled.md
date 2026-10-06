# Plate-identification scoring worksheet

- results: `runs/v3-eu-cell-mistral-medium-newprompt/results.json`
- config: `eu-cell-mistral-medium-newprompt` (started 2026-10-06T11:29:56.312134+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`, rule 1 read strictly (a class name such as "vegetables", "greens", "legumes", "cured meat", "pickled vegetables" earns no credit for a specific gold item). A model item name that already has a verdict for the same gold item in an earlier filled scorecard (`runs/*/scorecard-filled.md`, the v2 sheets in `op-worktrees/prompt-v2`, and the August Mistral control) got the same verdict; where two earlier sheets disagree, the EU line (A to E, v2, v3) and the 2026-08-12 flips win over the August control. Each note names the matched model item. Photos opened: 01, 02, 11, 16, 18, 19, 20, 26, 28, 30, 32, 33, 40, 43, 45, 46.

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 222 |
| items named (mean/plate) | 4.44 |
| distinct item names | 194 |
| latency mean (s) | 9.06 |
| latency median (s) | 8.22 |
| latency max (s) | 23.6 |
| cost / plate (USD) | 0.003676 |
| cost total (USD) | 0.183803 |

## Portion + macro error (auto-computed)

portion/macro: **unscorable**, gold has no gram ranges (0/50 covered) and no kcal ranges (0/50 covered).

Weighed-gram ground truth is the missing input, not the metric: add `gram_ranges`
(per gold item, `[min, max]` grams) and `kcal_range` (`[min, max]` per plate) to
`gold/gold_labels.json` and both families populate automatically here. Grams must
come from a scale, a gram range guessed off a photo would make portion error
measure the labeller, not the model.

## Scoring instructions (human / reviewing agent)

Semantic matching is NOT automated, fuzzy matching lies exactly where it matters
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
   counts too. It is a named error class, not a recall bonus, mark the gold rows `Y`
   if the parts do cover them, and record the split here so it is counted.
7. When a gold item is covered only by a reported item that ALSO covers another gold core
   item (a merge, the opposite of a split), write `Y merged` in its cell.
   It still counts as `Y` for recall. `--granularity` reads it for the strict split recall,
   which gives credit only to items the approach reported on their own.

`python3 -m harness.scorecard --score <this file>` reads the filled rows back and
prints bootstrap 95% CIs; `--compare A B` reports WINNER or UNDECIDED.

> Gold-label protocol: Gold labels authored by hand from direct image inspection (Fable, 2026-08-11). 'core' = items a correct identification must include (synonyms/consolidations acceptable, e.g. 'Greek salad' may cover lettuce+cucumber+tomato). 'optional' = visible but acceptable to omit (garnish, condiments, off-plate drinks). Hallucination = any reported food not visible at all. Entries 11-50 (added 2026-08-11): drafted by two opus vision agents under the same protocol, spot-verified by Fable against images 12/19/22/39/45/46 before merge; manifest descriptions for 32/46/47 corrected to match images.

### 01, Continental/English-style breakfast plate

- **production**: wholemeal bread, cooked ham, baked beans in tomato sauce, scrambled eggs, cucumber slices, pork sausages, grilled tomatoes

| gold core item | production | notes |
|---|---|---|
| scrambled eggs | Y | "scrambled eggs" |
| bacon/ham slices | Y | "cooked ham" |
| frankfurter sausages | Y | "pork sausages", kind right |
| baked beans in tomato sauce | Y | "baked beans in tomato sauce" |
| brown bread slice | Y | "wholemeal bread" |
| cucumber slices | Y | "cucumber slices" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | grilled tomatoes | "grilled tomatoes" (two halves): no tomato on the plate (photo opened); the beans are named on their own, so the item has no referent |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter/margarine packets

### 02, Roast (Sunday) dinner

- **production**: roast beef, Yorkshire pudding, roast potato, mixed vegetables (broccoli, cabbage, carrots)

| gold core item | production | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y | "roast beef" |
| Yorkshire pudding | Y | "Yorkshire pudding" |
| roast potatoes | Y | "roast potato" |
| broccoli | Y merged | "mixed vegetables (broccoli, cabbage, carrots)" names the broccoli |
| cabbage/greens | Y merged | same item names the cabbage |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none | the "carrots" inside the vegetable item have no referent (photo), but the item has one; a wrong part inside a present item is not counted (rule 3, as "Pepperoni sandwich" on 10) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **production**: grilled salmon fillet, Greek salad

| gold core item | production | notes |
|---|---|---|
| grilled salmon fillets | Y | "grilled salmon fillet" |
| feta cheese | Y merged | "Greek salad": feta is part of the determinate dish (rule 1) |
| kalamata olives | Y merged | "Greek salad" (determinate dish, as A, B, C, C3) |
| avocado | n | "Greek salad" does not entail avocado (runpod-gpu-v3 "greek salad" and the August Mistral "greek salad" call) |
| cherry tomatoes | Y merged | "Greek salad" |
| cucumber | Y merged | "Greek salad" |
| lettuce/romaine | Y merged | "Greek salad" |
| red onion | Y merged | "Greek salad" |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04, Cheeseburger with fries

- **production**: cheeseburger with beef patty, cheddar cheese, tomato, red onion, and sauce, ketchup, french fries, pickled cucumber slices, beer

| gold core item | production | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y | "cheeseburger with beef patty, cheddar cheese, tomato, red onion, and sauce" |
| thick-cut fries/steak fries | Y | "french fries" |
| ketchup | Y | "ketchup" |
| pickles/gherkins | Y | "pickled cucumber slices" (v2 "pickled cucumber") |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "beer" is the optional glass |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **production**: white rice, chicken and vegetable curry

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | "chicken and vegetable curry": one dish row, chicken in sauce named, greens not named (as runpod-gpu-v3 "chicken curry") |
| white rice | Y | "white rice" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: California roll sushi, white fish nigiri sushi, tuna nigiri sushi, soy sauce, pickled ginger, wasabi

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | "California roll sushi": a roll, filling misread is form (August Mistral "California roll" Y) |
| tuna nigiri | Y | "tuna nigiri sushi" |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | Y | "white fish nigiri sushi" |
| pickled ginger | Y | "pickled ginger" |
| wasabi | Y | "wasabi" |
| soy sauce | Y | "soy sauce" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: spaghetti with beef and vegetable bolognese sauce

| gold core item | production | notes |
|---|---|---|
| spaghetti | Y merged | "spaghetti with beef and vegetable bolognese sauce" |
| ground beef/meat tomato sauce | Y merged | same item |
| corn kernels | n | "vegetable" names nothing (rule 1, as every earlier cell) |
| green beans | n | rule 1 |
| carrot pieces | n | rule 1 |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **production**: granola, yogurt, apple slices

| gold core item | production | notes |
|---|---|---|
| yogurt | Y | "yogurt" |
| granola (oats/puffed grains, nuts) | Y | "granola" |
| apple slices | Y | "apple slices" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **production**: cheese and chicken pizza

| gold core item | production | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | "cheese and chicken pizza" |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **production**: club sandwich, side salad, Pepsi

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | "club sandwich" (qwenvl name) |
| green side salad (rocket/mixed leaves) | Y | "side salad" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "Pepsi" is the optional bottle |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: breaded fish fillet, thick-cut chips, mixed salad with tomato, red onion and lettuce, tartar sauce, lemon wedge, capers

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | n | "breaded fish fillet" for a pork/veal schnitzel: species miss (rule 2), as D, E, D2, D3 |
| thick-cut fries/potato wedges | Y | "thick-cut chips" |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | "mixed salad with tomato, red onion and lettuce" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | "tartar sauce": the only sauces are the ketchup ramekin and the dressing (photo); a misnamed visible condiment, not counted (rule 3, as qwenvl "tartar sauce" here); capers and lemon are optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: grilled pork sausage, mashed potatoes, sauerkraut

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y | "grilled pork sausage" (D2 "pork sausages") |
| sauerkraut | Y | "sauerkraut" |
| mashed potatoes | Y | "mashed potatoes" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: spaetzle, caramelized onions, mixed green salad with dressing

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y | "spaetzle": the dish base named, cheese not named (kind kept, as "macaroni and cheese") |
| fried/caramelised onions | Y | "caramelized onions" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "mixed green salad with dressing" is the optional side plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: mixed green salad, beef goulash with potatoes

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y merged | "beef goulash with potatoes" |
| boiled potatoes | Y merged | same item names the potatoes |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "mixed green salad" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: white sausage, beer, pretzel, mustard

| gold core item | production | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y | "white sausage" (qwenvl name) |
| pretzel (Brezel) | Y | "pretzel" |
| sweet mustard | Y | "mustard" (runpod-gpu-v3 name) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "beer" is the optional glass |
| **over-decomposed** | 0 |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16, Döner/gyros plate with fries and salad

- **production**: french fries, döner kebab meat with tomato sauce, mixed salad with lettuce, tomato, cucumber, bell pepper, red onion, and egg, beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | Y merged | "döner kebab meat with tomato sauce" |
| tomato sauce over the meat | Y merged | same item |
| French fries | Y | "french fries" |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | "mixed salad with lettuce, tomato, cucumber, bell pepper, red onion, and egg" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | no egg in the salad (photo); a wrong part inside a present item, not counted (rule 3); "beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: grilled sausage, tomato ketchup, french fries

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y | "grilled sausage" (runpod-gpu-v3 "sausage") |
| curry ketchup sauce | Y | "tomato ketchup": ketchup kind right, curry spice is prep (rule 2, as qwenvl "tomato sauce") |
| curry powder | n | not named |
| French fries | Y | "french fries" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: stuffed pasta (e.g. cannelloni), creamy potato and herb sauce

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "stuffed pasta (e.g. cannelloni)": filled pasta, shape is form (August Mistral "stuffed pasta rolls" Y) |
| potato salad | n | "creamy potato and herb sauce": a sauce is not the potato salad (August Mistral "creamy potato stew" n; strict reading, as the 43 review) |
| **core recall (/2)** | 1/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: french fries, sour cream, grilled chicken breast, sausages in curry sauce

| gold core item | production | notes |
|---|---|---|
| French fries | Y | "french fries" |
| gyros/döner sliced meat | Y | "grilled chicken breast" (shredded portion) for the shaved meat: gold names no species and chicken gyros exists, cut error (rule 2) |
| sliced sausage in curry/shashlik sauce | Y | "sausages in curry sauce" |
| tzatziki/garlic yogurt sauce | Y | "sour cream": cultured dairy white sauce for the tzatziki (as runpod-gpu-v3 "yogurt"); one token, one row |
| mayonnaise | n | the second white sauce has no token of its own |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 20, Bowl of shio ramen

- **production**: ramen noodles in broth, chashu pork, green onions, nori seaweed

| gold core item | production | notes |
|---|---|---|
| ramen noodles | Y merged | "ramen noodles in broth" |
| clear (shio) broth | Y merged | same item names the broth |
| sliced chashu pork | Y | "chashu pork" |
| leafy green herb topping (mizuna/mitsuba) | n | "green onions" for the mizuna: an allium is not a leafy herb (kind miss); no spring onion in the photo, a misnamed topping (rule 3) |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | nori seaweed | "nori seaweed" (a small sheet): no nori in the bowl (photo opened) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **production**: beef pho soup, rice noodles, fresh herbs and bean sprouts

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y merged | "beef pho soup" |
| sliced beef and beef meatballs | Y merged | "beef pho soup" names the beef |
| bean sprouts | Y merged | "fresh herbs and bean sprouts" |
| Thai basil | Y merged | "fresh herbs" for Thai basil, the only herb on the plate (established precedent; 35-eu-op "fresh herbs and bean sprouts plate") |
| sliced green chilli/jalapeño | n | not named |
| spring onion | n | not named |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | "rice noodles" is the optional extra bowl |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: corn tortilla tacos with beef, lettuce, cheese and salsa, grilled corn on the cob, cola

| gold core item | production | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y merged | "corn tortilla tacos with beef, lettuce, cheese and salsa" |
| grated cheese | Y merged | same item names the cheese |
| red salsa | Y merged | one "salsa" credited to the red salsa (precedent) |
| green salsa/tomatillo | n | one salsa token cannot cover two salsas |
| coriander/cilantro | n | "lettuce" in the item is the coriander topping misread, kind miss |
| grilled corn on the cob | Y | "grilled corn on the cob" |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | "cola" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **production**: cheese enchilada with green sauce, shredded lettuce, diced tomatoes, shredded cheddar cheese

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | Y merged | "cheese enchilada with green sauce": enchilada for the burrito (qwenvl, runpod-gpu-v3, August Mistral) |
| green chile sauce | Y merged | same item names the green sauce |
| shredded cheddar/jack cheese | Y | "shredded cheddar cheese" |
| shredded lettuce | Y | "shredded lettuce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "diced tomatoes" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **production**: battered fish fillet, french fries, mushy peas, tartar sauce, lemon wedge

| gold core item | production | notes |
|---|---|---|
| battered fried fish fillet | Y | "battered fish fillet" |
| chips/thick-cut fries | Y | "french fries" |
| green peas | Y | "mushy peas": prep (rule 2) |
| tartar sauce | Y | "tartar sauce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | lemon wedge optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge

### 25, American breakfast platter

- **production**: grilled bacon, pancakes with powdered sugar, fried egg, sausages, breaded hash browns, toast, maple syrup

| gold core item | production | notes |
|---|---|---|
| pancakes with icing sugar | Y | "pancakes with powdered sugar" |
| back bacon rashers | Y | "grilled bacon" |
| fried egg (sunny side up) | Y | "fried egg" |
| breakfast sausages | Y | "sausages" |
| hash brown/potato croquettes | Y | "breaded hash browns" |
| toast slices | Y | "toast" |
| maple syrup in a shot glass | Y | "maple syrup" |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **production**: basmati rice with vegetables, roti (whole wheat flatbread), yogurt (plain), mixed vegetable soup, chickpea curry, lentil curry, mixed salad with cabbage and carrot, vegetable curry with coconut

| gold core item | production | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | "basmati rice with vegetables" |
| chapati/roti | Y | "roti (whole wheat flatbread)" |
| papad (papadum) | n | papad visible, not named |
| curd/raita | Y | "yogurt (plain)" |
| dal (lentil curry) | Y | "lentil curry" |
| kofta/dumpling curry in orange gravy | n | "chickpea curry" is a misnamed curry bowl (legume for kofta, kind miss); nothing names kofta |
| paneer or fish curry in pale gravy | n | no paneer or fish token |
| brinjal/eggplant curry | Y | "vegetable curry with coconut", as "vegetable curry" / "mixed vegetable curry" for the eggplant bowl (precedent) |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none | "chickpea curry" has a referent (a curry bowl), rule 3; soup and salad are optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **production**: stir-fried chicken with bell peppers and onions, steamed white rice

| gold core item | production | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y merged | "stir-fried chicken with bell peppers and onions" |
| red bell pepper strips | Y merged | same item names the peppers |
| onion | Y merged | same item names the onions |
| spring onion/green onion | n | not named |
| steamed white rice | Y | "steamed white rice" |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): dried chilli bits

### 28, Middle-Eastern mezze spread, four composed plates plus flatbread

- **production**: falafel, pita bread, mixed salad with cabbage, carrots, and greens, pickled vegetables, hummus, olives, beetroot

| gold core item | production | notes |
|---|---|---|
| falafel balls | Y | "falafel" |
| grilled flatbread | Y | "pita bread" |
| hummus/creamy white dip | Y | "hummus" |
| green herb-chilli sauce | n | no sauce item |
| yellow bulgur or couscous | n | not named |
| black beluga lentils | n | not named |
| pickled white cabbage slaw | Y | "mixed salad with cabbage, carrots, and greens" names the cabbage; pickling is prep (as C3 "cabbage" on 35) |
| green olives | Y | "olives" (ens3, runpod-gpu-v3 "olives") |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none | "pickled vegetables" and "beetroot" are optional items (pink turnip, beetroot) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: pickled cucumbers, cured meat assortment, cheese cubes, green olives, wheat beer

| gold core item | production | notes |
|---|---|---|
| pickled gherkin slices | Y | "pickled cucumbers" |
| salami slices | n | "cured meat assortment" names a class, not the salami (rule 1 strict, as "Legumes" for beluga lentils in 2026-08-12) |
| cheese cubes | Y | "cheese cubes" |
| green olives | Y | "green olives" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none | "wheat beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30, Mixed grill board (plancha de grillades)

- **production**: grilled chicken wing, grilled chicken leg, roasted pork ribs, grilled sausage, roasted potato, mixed green salad with lettuce and red leaf lettuce, grilled bell pepper

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | Y | "roasted pork ribs" |
| grilled beef steak | n | no beef named; "grilled chicken wing", "grilled chicken leg" are other pieces on the board |
| grilled sausage | Y | "grilled sausage" |
| grilled meat skewer with green pepper and tomato | n | "grilled bell pepper" names one part of the skewer only |
| baked/roasted potato with browned cheese topping | Y | "roasted potato" (as "baked potato") |
| mixed leaf salad | Y | "mixed green salad with lettuce and red leaf lettuce" |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | the chicken wing and the chicken leg have referents (a wing-shaped piece and the skewer meat, photo), rule 3 |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cherry tomato, steak knife

### 31, Bowl of beef/oxtail soup with buttered bread

- **production**: beef goulash, whole wheat bread with butter

| gold core item | production | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged | "beef goulash" |
| beef (oxtail) chunks | Y merged | same item |
| buttered bread slices (dark/whole-grain) | Y | "whole wheat bread with butter" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **production**: green olives, cucumber sticks, carrot sticks, yellow bell pepper strips, red bell pepper strips, spiced roasted potato wedges, hummus, cheddar cheese slices, salami slices, rice crackers, green rice crackers

| gold core item | production | notes |
|---|---|---|
| green olives | Y | "green olives" |
| cucumber sticks | Y | "cucumber sticks" |
| carrot sticks | Y | "carrot sticks" |
| bell pepper strips | Y | "yellow bell pepper strips", "red bell pepper strips" |
| pan-fried spiced hard-boiled egg halves | n | "spiced roasted potato wedges" is the spiced egg compartment misread (photo): egg for potato, kind miss |
| hummus dip | Y | "hummus" |
| salami/cured meat slices | Y | "salami slices" |
| cheese slices | Y | "cheddar cheese slices" |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none | the potato wedges and the two rice crackers have referents (eggs, herb crackers), rule 3 |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **production**: oatmeal, peanut butter, cinnamon, raisins, raw egg

| gold core item | production | notes |
|---|---|---|
| oatmeal/oat porridge | Y | "oatmeal" |
| peanut butter | Y | "peanut butter" |
| raisins | Y | "raisins" |
| ground cinnamon | Y | "cinnamon" |
| milk | n | not named; "raw egg" is not the milk |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none | "raw egg": the peanut butter scoop in the pool of milk looks like a yolk in egg white (photo), a misnamed visible object (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: waffle, strawberries, strawberry syrup, whipped cream

| gold core item | production | notes |
|---|---|---|
| waffles | Y | "waffle" |
| strawberries (sliced fresh) | Y | "strawberries" |
| strawberry/berry syrup-compote | Y | "strawberry syrup" |
| whipped cream | Y | "whipped cream" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **production**: grilled lamb meat, mixed salad with cabbage, tomato, carrot and sweetcorn, sliced cucumber, sliced green pepper, french fries, garlic sauce

| gold core item | production | notes |
|---|---|---|
| gyros/döner sliced meat | Y | "grilled lamb meat" (as qwenvl, runpod-gpu-v3 "grilled meat", species named) |
| French fries | Y | "french fries" |
| white garlic-yogurt sauce (tzatziki) with oregano | Y | "garlic sauce" (C precedent) |
| shredded white cabbage | Y merged | "mixed salad with cabbage, tomato, carrot and sweetcorn" |
| tomato slices | Y merged | same item |
| sweetcorn | Y merged | same item |
| cucumber slices | Y | "sliced cucumber" |
| shredded carrot | Y merged | same item names the carrot |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none | "sliced green pepper" is the optional pickled chili |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: paella

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | Y merged | "paella" |
| whole prawns (langostinos) | Y merged | "paella" names the prawns (rule 1 example) |
| mantis shrimp (galeras) | n | not implied by "paella" (runpod-gpu-v3 call) |
| artichoke pieces | n | not named |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: dumplings, shredded cabbage and carrot salad

| gold core item | production | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y | "dumplings" |
| fried caramelised onion topping | n | not named |
| grated carrot and cabbage salad | Y | "shredded cabbage and carrot salad" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **production**: beef burger in sesame bun with lettuce and tomato, french fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | "beef burger in sesame bun with lettuce and tomato" |
| French fries | Y | "french fries" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: baked beans in tomato sauce, grilled pork sausage, grilled bacon

| gold core item | production | notes |
|---|---|---|
| baked beans in tomato sauce | Y | "baked beans in tomato sauce" |
| sausage pieces | Y | "grilled pork sausage" |
| bacon rasher | Y | "grilled bacon" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **production**: grilled steak, roasted pork ribs, thick-cut fries, grilled ham, grilled tomato, fried egg, gravy

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | n | "grilled steak" is the steak pieces; liver never named (organ identity is kind, rule 2) |
| chips/French fries | Y | "thick-cut fries" |
| bacon/gammon slice | Y | "grilled ham" |
| fried egg (remnant, yolk visible) | Y | "fried egg" |
| sausage | n | not named; "roasted pork ribs" is the fatty pork at the top (photo) |
| grilled tomato half | Y | "grilled tomato" |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | steak and pork pieces are on the plate (photo); "gravy" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: battered fish fillet, roasted potato wedges, tartar sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish (cod), partly eaten | Y | "battered fish fillet" |
| potato wedges/skin-on roast potatoes | Y | "roasted potato wedges" |
| tartar sauce / mayonnaise dollop | Y | "tartar sauce" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **production**: breaded fried fish fillet, white rice, curried lentils, meatballs in tomato sauce, mixed salad with cucumber and red cabbage, corn kernels

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | Y | "breaded fried fish fillet" |
| sour cream / remoulade dollop | n | no sauce named |
| meatballs in brown gravy | Y | "meatballs in tomato sauce": sauce type is prep |
| chickpea-and-cauliflower curry | n | "curried lentils": lentil for chickpea, species miss (D2 call) |
| white rice | Y | "white rice" |
| red cabbage and sweetcorn salad | Y | "mixed salad with cucumber and red cabbage" plus "corn kernels" |
| cucumber and lettuce salad | Y merged | the same salad item names the cucumber (enumeration precedent) |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set, main plate, soup bowl, bread plate

- **production**: creamy soup with bacon bits, buttered bread roll, breaded fish fillet with tartar sauce, green beans, rice, potato salad, fried egg, olives, lemon wedge

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | "breaded fish fillet with tartar sauce": form, hit |
| herbed green rice | Y | "rice" |
| green beans | Y | "green beans" |
| cheese-topped quiche/gratin square | n | "fried egg" for the cheese-topped quiche square: a different dish (strict reading) |
| creamy meat-and-vegetable stew | n | "potato salad" is the C2, B2 misread of the stew, miss |
| creamy soup (bowl, with bacon bits) | Y | "creamy soup with bacon bits" |
| bread roll with butter | Y | "buttered bread roll" |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none | "fried egg" and "potato salad" have referents (quiche square, stew), rule 3; olives and lemon optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: mixed green salad with shredded carrot, brown beans in sauce, sauerkraut with diced tomato, yellow rice, grilled meat

| gold core item | production | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | "mixed green salad with shredded carrot" |
| brown beans (feijão) in broth | Y | "brown beans in sauce" |
| yellow seasoned rice | Y | "yellow rice" |
| braised cabbage with tomato | Y | "sauerkraut with diced tomato": fermented for braised is prep (rule 2, as runpod-gpu-v3 "sauerkraut" on 37), tomato named |
| stewed meat in onion gravy | Y | "grilled meat": the gold row names no kind, grilled for stewed is prep |
| mashed cassava/potato purée | n | not named |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45, Korean hanjeongsik table spread (dozens of banchan, top-down)

- **production**: steamed white rice, grilled mackerel, kimchi, tofu, beef bulgogi, seaweed salad, stir-fried glass noodles, mixed vegetable side dish, jeon (savory pancakes), soybean sprout soup, fermented soybean paste stew, green chili peppers

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | Y | "stir-fried glass noodles" |
| steamed egg (gyeranjjim) in stone pot | n | not named |
| grilled mackerel/fish | Y | "grilled mackerel" |
| stir-fried beef in a hot stone pot | Y | "beef bulgogi" |
| glazed spicy braised ribs/pork | n | no pork token |
| sliced raw fish (hoe/sashimi) on shredded radish | n | not named |
| vegetable fritters/jeon platter | Y | "jeon (savory pancakes)" |
| kimchi | Y | "kimchi" |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none | trap leak (not a hallucination, runpod-gpu-v3 precedent): "steamed white rice", the rice bowls are empty; the gold trap text calls this a hallucination. Seaweed salad, two soups, tofu, vegetable side and chili peppers all have referents (optional dishes) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: fried tofu puffs, honeycomb, stir-fried noodles with vegetables, steamed fish slices, braised tofu with vegetables

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | n | "honeycomb" names no organ or animal (strict; August Mistral "crispy honeycomb tofu" n) |
| white boiled tripe/omasum slices in broth | n | "steamed fish slices", "stir-fried noodles with vegetables", "braised tofu with vegetables" are the white tripe cups misnamed, kind miss |
| fried beancurd-skin rolls (tofu skin rolls) | Y | "fried tofu puffs": soy curd kind kept, form is roll (rule 2) |
| **core recall (/3)** | 1/3 |  |
| **hallucinations** | none | every name has a referent in the basket (photo opened), rule 3; no dumplings or buns named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: acai bowl with granola, kiwi and strawberries, poached eggs on avocado toast with microgreens, eggs Benedict with hollandaise sauce and microgreens, seeded bagel, beetroot latte, iced coffee with milk, orange juice or smoothie, white wine

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | "poached eggs on avocado toast with microgreens" |
| eggs benedict with hollandaise on avocado toast | Y | "eggs Benedict with hollandaise sauce and microgreens" |
| yogurt bowl with granola, kiwi slices and berry compote | Y | "acai bowl with granola, kiwi and strawberries" names granola and kiwi (C3 call) |
| cherry tomato salad with balsamic drizzle | n | no tomato named |
| seeded bagel (dark, sesame-topped) | Y | "seeded bagel" |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none | four drinks are optional; no menu-card item named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: plain potato chips, white bread sandwich with filling, cake with cream and fruit bits

| gold core item | production | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | "white bread sandwich with filling" |
| potato chips/crisps | Y | "plain potato chips" |
| samosas (small fried triangles) | n | not named |
| slice of white/vanilla cake with icing, partly eaten | Y | "cake with cream and fruit bits" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49, Cafe sizzling-plate dinner set

- **production**: grilled steak, spaghetti with tomato sauce, grilled sausage, tomato soup, bread roll

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y | "grilled steak" |
| spaghetti (plain, buttered) | Y | "spaghetti with tomato sauce": sauce is prep |
| sausage/frankfurter | Y | "grilled sausage" |
| cherry tomatoes | n | a tomato sauce is not the cherry tomatoes |
| red cabbage soup (borscht-style, bowl) | Y | "tomato soup" for the borscht bowl (35-eu-np precedent) |
| bread bun | Y | "bread roll" |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: french fries, grilled lamb shawarma, mixed salad with cucumber, cabbage, and pickled vegetables

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y | "grilled lamb shawarma" (qwenvl "grilled lamb") |
| tomato/chili sauce over the meat | n | no sauce named |
| French fries | Y | "french fries" |
| iceberg lettuce salad | n | "cabbage" for iceberg lettuce, kind miss |
| sliced red onion | n | not named |
| cucumber slices | Y | "mixed salad with cucumber, cabbage, and pickled vegetables" names the cucumber |
| pickled gherkin and pepperoncini | n | "pickled vegetables" names a class (rule 1 strict, as B2 on 28) |
| **core recall (/7)** | 3/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 188/235 = 80.0% |
| hallucinations | 2 (01, 20); 3 if the 45 rice trap leak is counted |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 194 |
| cost / plate (auto) | $0.00368 |
| latency median s (auto) | 8.22 |

## Recall and bootstrap confidence interval

- **Hits: 188/235. Recall: 80.0 %.**
- **95 % CI: [74.9, 85.3] %.**
- Method: a percentile bootstrap over plates (a cluster bootstrap, because a plate's items succeed or fail together). Each of 2000 resamples draws 50 plates with replacement with Python's stdlib `random.Random(7)`. Recall of a resample is the sum of its hits over the sum of its gold items. The CI is the 2.5th and 97.5th percentile of the 2000 values, with linear interpolation. The computation is `harness/stats.py` `bootstrap_recall_ci(pairs, resamples=2000, seed=7)`, and a separate stdlib reimplementation gave the same bounds.
- The harness default (10 000 resamples, seed 20260813, used in `EU-PLATE-SCORING-V3-2026-10-06.md`) gives slightly different bounds; these numbers use the seed and count that this adjudication was asked for.

## Hallucinations by plate

A hallucination is a food with no referent in the photo (rule 3). A wrong part inside an item that has a referent is not counted.

| plate | item | why |
|---|---|---|
| 01 | grilled tomatoes | no tomato on the plate; the beans are named separately |
| 20 | nori seaweed | no nori in the bowl |

- **Count: 2** (feeds rule 6 of the decision rule).
- **Trap leak, counted separately: 1**, plate 45 "steamed white rice" (the rice bowls are empty). The runpod-gpu-v3 sheet counted the same leak as a trap leak, not a hallucination, so this sheet does the same. The gold trap text for 45 calls it a hallucination; under that reading the count is **3**.
- Wrong parts inside a present item, not counted: 02 "carrots" in the vegetable item, 16 "egg" in the salad.
- Misnamed visible objects, not counted (rule 3): 11 tartar sauce (the ketchup), 26 chickpea curry (a curry bowl), 30 chicken wing and chicken leg, 32 spiced roasted potato wedges (the spiced eggs), 33 raw egg (peanut butter in the milk), 43 fried egg and potato salad (the quiche and the stew), 46 honeycomb, steamed fish slices, stir-fried noodles, braised tofu (the tripe cups).

## Errors, schema-invalid records, false unreadable

- Error records: **0** (`_summary.failures` is empty; every record is HTTP 200 after 1 attempt).
- Schema-invalid records: **0** (`schema_valid` true on 50/50). Error and invalid ids: none.
- False unreadable: **0** (`unreadable` is false on all 50 plates; every plate is readable).

## Paired difference against C3

C3 is `runs/v3-eu-cell-38-minimal-newprompt/scorecard-filled.md` (3.8 flash, minimal reasoning, v3 prompt), the same 50 plates and the same 235 gold items.

- C3: 199/235 = 84.7 %, 95 % CI [78.2, 90.8] (same method, seed 7, 2000 resamples).
- This cell: 188/235 = 80.0 %.
- **C3 minus this cell: +4.7 points, paired 95 % CI [-2.5, +11.8].** The interval includes 0.
- Method: `harness/stats.py` `bootstrap_diff_ci(c3, this_cell, resamples=2000, seed=7)`. Each resample draws one set of 50 plate indices with `random.Random(7)` and applies it to both cells, so plate difficulty cancels. The CI is the 2.5th and 97.5th percentile of the 2000 differences.
- Plates where the two cells differ (C3 minus this cell, in hits): 03 +1, 06 -3, 11 +1, 18 +1, 19 +1, 22 -2, 26 +3, 27 -2, 28 -2, 29 +1, 30 +1, 32 -2, 34 -1, 35 -2, 36 +2, 37 +1, 40 +2, 43 +1, 44 +1, 45 +3, 46 +2, 47 +1, 48 +1, 50 +2.

Sensitivity to the closest calls (same method):

| variant | hits, recall | 95 % CI | C3 minus this cell [95 % CI] |
|---|---|---|---|
| as filled | 188/235 = 80.0 % | [74.9, 85.3] | +4.7 [-2.5, +11.8] |
| stricter: 17, 19, 44 to n | 185/235 = 78.7 % | [73.3, 84.2] | +6.0 [-1.6, +13.2] |
| more lenient: 18, 29, 46 to Y | 191/235 = 81.3 % | [76.3, 86.6] | +3.4 [-3.5, +10.3] |

## Judgment calls that were not obvious

| plate | call | verdict | why unsure |
|---|---|---|---|
| 29 | "cured meat assortment" for salami slices | n | strict rule 1, as "Legumes" for beluga lentils (2026-08-12); the August Mistral sheet credited "cured meats", and gold 32 accepts "cured meat slices" |
| 19 | "grilled chicken breast" (shredded) for the gyros meat | Y | gold names no species and chicken gyros exists; the meat in the photo looks like pork |
| 46 | "honeycomb" for the honeycomb beef tripe | n | the word is the dim sum shorthand, but it names no organ or animal; organ identity is kind (rule 2) |
| 01 | "grilled tomatoes" counted as a hallucination | 1 | no tomato on the plate; the model may have read two of the four frankfurters as tomato halves, which would make it a misnamed object (rule 3) |
| 44 | "sauerkraut with diced tomato" for braised cabbage with tomato | Y | runpod-gpu-v3 treats sauerkraut for cabbage as prep (rule 2); the August Mistral sheet called bare "sauerkraut" here a miss |
| 20 | "nori seaweed" counted as a hallucination | 1 | no nori is visible; it could be read as the dark green leaves, which "green onions" already claims |
| 42 | one salad item naming cucumber and red cabbage covers both salads | Y, Y merged | enumeration precedent; the two salads sit apart on the plate |
| 17 | "tomato ketchup" for the curry ketchup | Y | qwenvl "tomato sauce" was credited; the August Mistral sheet gave bare "ketchup" no credit |
| 18 | "creamy potato and herb sauce" for the potato salad | n | potato kind right, but a sauce is not the salad; strict reading after the 43 review |
| 05 | "chicken and vegetable curry" for chicken in a creamy spinach sauce | Y | one dish row; runpod-gpu-v3 credited "chicken curry", the August control did not |
