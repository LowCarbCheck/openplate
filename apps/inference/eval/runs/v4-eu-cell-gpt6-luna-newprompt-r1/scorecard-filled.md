# Plate-identification scoring worksheet

- results: `runs/v4-eu-cell-gpt6-luna-newprompt-r1/results.json`
- config: `eu-cell-gpt6-luna-newprompt` (started 2026-10-06T13:07:36.536483+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
- prefill: 59 Y, 4 n, 0 conflicts, 172 need judgment, from 13 earlier sheets

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 198 |
| items named (mean/plate) | 3.96 |
| distinct item names | 166 |
| latency mean (s) | 12.72 |
| latency median (s) | 12.52 |
| latency max (s) | 21.98 |
| cost / plate (USD) | 0.001034 |
| cost total (USD) | 0.051723 |

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

- **production**: dark wholegrain bread, sliced cooked ham, frankfurter sausages, baked beans in tomato sauce, scrambled eggs, cucumber slices

| gold core item | production | notes |
|---|---|---|
| scrambled eggs | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Scrambled eggs" |
| bacon/ham slices | Y | "sliced cooked ham" |
| frankfurter sausages | Y | "frankfurter sausages" |
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Baked beans in tomato sauce" |
| brown bread slice | Y | "dark wholegrain bread" |
| cucumber slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Cucumber slices" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter/margarine packets

### 02, Roast (Sunday) dinner

- **production**: Roasted chicken with brown gravy, Roasted potatoes, Mixed cooked vegetables

| gold core item | production | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | n | "Roasted chicken with brown gravy": chicken for lamb/beef, species miss (rule 2) |
| Yorkshire pudding | n | not named |
| roast potatoes | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Roasted potatoes" |
| broccoli | n | "Mixed cooked vegetables" names no vegetable (strict rule 1, as L2 "steamed mixed vegetables"); the broccoli in the notes is not an item |
| cabbage/greens | n | "Mixed cooked vegetables", strict rule 1 |
| **core recall (/5)** | 1/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **production**: grilled salmon, mixed salad with avocado, cucumber, tomato and red onion, feta cheese, Kalamata olives

| gold core item | production | notes |
|---|---|---|
| grilled salmon fillets | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "grilled salmon" |
| feta cheese | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Feta cheese", named on its own |
| kalamata olives | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Kalamata olives", named on its own |
| avocado | Y merged | "mixed salad with avocado, cucumber, tomato and red onion" names the avocado |
| cherry tomatoes | Y merged | same item names the tomato |
| cucumber | Y merged | same item names the cucumber |
| lettuce/romaine | n | "mixed salad" names no leaf (strict rule 1; as 25-flash "Mixed salad with avocado and olives", n here) |
| red onion | Y merged | same item names the red onion |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04, Cheeseburger with fries

- **production**: cheeseburger with sauce, French fries, ketchup, pickles, beer

| gold core item | production | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "cheeseburger with sauce" |
| thick-cut fries/steak fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "french fries" |
| ketchup | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Ketchup" |
| pickles/gherkins | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Pickles" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **production**: cooked white rice, beef and mushroom stew with gravy

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | n | "beef and mushroom stew with gravy": beef for chicken, species miss (rule 2) |
| white rice | Y | "cooked white rice" |
| **core recall (/2)** | 1/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: Assorted sushi rolls, Salmon sashimi, Tuna sashimi, Pickled ginger, Wasabi, Soy sauce

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | "Assorted sushi rolls": the roll is named, filling not |
| tuna nigiri | n | "Tuna sashimi" for tuna nigiri: rule 4, sashimi for nigiri is a miss (photo: fish on rice) |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | n | "Salmon sashimi" for the white-fish nigiri: rule 4 and wrong fish |
| pickled ginger | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "pickled ginger" |
| wasabi | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "wasabi" |
| soy sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Soy sauce" |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: Stir-fried noodles, Cooked ground beef, Mixed vegetables (green beans, carrots and corn)

| gold core item | production | notes |
|---|---|---|
| spaghetti | Y | "Stir-fried noodles": wheat noodles for spaghetti, form (rule 2) |
| ground beef/meat tomato sauce | Y | "Cooked ground beef" |
| corn kernels | Y merged | "Mixed vegetables (green beans, carrots and corn)" names the corn (as mistral "mixed vegetables (broccoli, cabbage, carrots)" on 02) |
| green beans | Y merged | same item names the green beans |
| carrot pieces | Y merged | same item names the carrots |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **production**: granola with nuts, apple slices

| gold core item | production | notes |
|---|---|---|
| yogurt | n | not named |
| granola (oats/puffed grains, nuts) | Y | "granola with nuts" |
| apple slices | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Apple slices" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **production**: Chicken and cheese pizza

| gold core item | production | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Chicken and Cheese Pizza" (C3 name) |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **production**: Chicken sandwich, Leafy green salad, Cola, Black coffee

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Chicken sandwich" (cloud name) |
| green side salad (rocket/mixed leaves) | Y | "Leafy green salad": the gold row is one generic salad (precedent) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "Cola", "Black coffee" optional drinks |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: Breaded fried fish fillet with lemon and capers, French fries, Mixed salad with dressing, Ketchup

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | n | "Breaded fried fish fillet with lemon and capers": fish for pork/veal, species miss (rule 2, as D3, mistral) |
| thick-cut fries/potato wedges | Y | "French fries" |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "mixed salad with dressing": the gold row is itself the consolidated salad (r1, 25-flash precedent) |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | "Ketchup" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: Sausages with brown gravy, Mashed potatoes, Creamy pasta

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y | "Sausages with brown gravy" (as 25-flash "Sausages with gravy") |
| sauerkraut | n | "Creamy pasta" is the sauerkraut misread (photo), kind miss; misnamed, not a hallucination |
| mashed potatoes | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Mashed potatoes" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | "Creamy pasta" is the sauerkraut misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: Creamy pasta, Beef strips in sauce, Mixed salad

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y | "Creamy pasta": noodles in a cheese sauce, regional name lost (as 25-lite "Cheesy noodles") |
| fried/caramelised onions | n | "Beef strips in sauce" is the onion heap (portion hint "a small pile on top of the pasta"), kind miss |
| **core recall (/2)** | 1/2 |  |
| **hallucinations** | none | "Beef strips in sauce" is the caramelised onion heap misnamed (rule 3), not invented meat; "Mixed salad" is the optional side plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: Beef stew with potatoes and carrots, Lettuce

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y merged | "Beef stew with potatoes and carrots" |
| boiled potatoes | Y merged | same item names the potatoes |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "Lettuce" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: white sausages, pretzel, sweet mustard, beer

| gold core item | production | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y | "white sausages" (mistral "white sausage") |
| pretzel (Brezel) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "pretzel" |
| sweet mustard | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Sweet Mustard" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16, Döner/gyros plate with fries and salad

- **production**: French fries, Beef in tomato sauce, Mixed salad with dressing, Beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | Y merged | "Beef in tomato sauce": the sliced meat, beef kind, form lost (rule 2) |
| tomato sauce over the meat | Y merged | same item names the tomato sauce |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "mixed salad with dressing": the gold row is itself the consolidated salad (precedent) |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: French fries, Currywurst with tomato curry sauce

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y merged | "Currywurst with tomato curry sauce" |
| curry ketchup sauce | Y merged | same item names the sauce |
| curry powder | n | curry dusting not named |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: meat-filled pasta with creamy sauce

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "meat-filled pasta with creamy sauce" (as D3 "meat-filled pasta rolls"); the creamy sauce part is the potato salad misread, so no merge |
| potato salad | n | "creamy sauce" in the same item is the potato salad read as a sauce; a sauce is not the potato salad (mistral call) |
| **core recall (/2)** | 1/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: French fries, Grilled kebab meat, Creamy garlic sauce, Ketchup

| gold core item | production | notes |
|---|---|---|
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| gyros/döner sliced meat | Y | "Grilled kebab meat" |
| sliced sausage in curry/shashlik sauce | n | no sausage named; "Ketchup" is the curry sauce over it, the sausage is lost |
| tzatziki/garlic yogurt sauce | Y | "Creamy garlic sauce" (one token, given to the garlic sauce) |
| mayonnaise | n | the second white sauce has no token of its own (mistral call) |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none | "Ketchup" is the curry sauce misnamed (rule 3) |
| **over-decomposed** | 0 |  |

### 20, Bowl of shio ramen

- **production**: Clear noodle soup with leafy greens and bean sprouts, Poached egg

| gold core item | production | notes |
|---|---|---|
| ramen noodles | Y merged | "Clear noodle soup with leafy greens and bean sprouts": noodle soup, ramen form |
| clear (shio) broth | Y merged | same item, "clear" soup names the broth |
| sliced chashu pork | n | "Poached egg" is the pale chashu slices misread (photo), kind miss; misnamed, not a hallucination |
| leafy green herb topping (mizuna/mitsuba) | n | "leafy greens" inside the soup item is generic (strict rule 1, "greens"); D3 "greens" got Y under the looser reading |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none | "Poached egg" is the chashu misnamed, "bean sprouts" the mizuna stems (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **production**: Beef and green bean stir-fry, Cooked rice noodles, Fresh basil leaves, Shredded cabbage, Banana

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | n | "Beef and green bean stir-fry" is the pho bowl read as a dry stir-fry: no soup or broth named; "Cooked rice noodles" is a side portion (plateful) |
| sliced beef and beef meatballs | Y | "Beef and green bean stir-fry" names the beef |
| bean sprouts | n | not named; "Shredded cabbage" and "Cooked rice noodles" are the pale shredded foods misread (model notes say so) |
| Thai basil | Y | "Fresh basil leaves" |
| sliced green chilli/jalapeño | n | not named |
| spring onion | n | not named |
| **core recall (/6)** | 2/6 |  |
| **hallucinations** | 1 | "Banana" (one medium banana): no banana in the photo; the only yellow object is a shoe at the right edge, not food |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: beef tacos with cheese, salsa and cilantro, corn on the cob, cola

| gold core item | production | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y merged | "beef tacos with cheese, salsa and cilantro" |
| grated cheese | Y merged | same item names the cheese |
| red salsa | Y merged | one "salsa" credited to the red salsa (precedent) |
| green salsa/tomatillo | n | one salsa token cannot cover two salsas (precedent) |
| coriander/cilantro | Y merged | same item names the cilantro |
| grilled corn on the cob | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "corn on the cob" |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none | "cola" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **production**: Enchilada with sauce, cheese and vegetables

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | Y merged | "Enchilada with sauce, cheese and vegetables": enchilada for the burrito (mistral, qwenvl precedent) |
| green chile sauce | Y merged | the named dish enchilada entails its chile sauce, as "smothered" does (precedent); colour not named |
| shredded cheddar/jack cheese | Y merged | same item names the cheese |
| shredded lettuce | n | "vegetables" names no part (strict rule 1) |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **production**: battered fried fish, French fries, green peas, tartar sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish fillet | Y | "battered fried fish" |
| chips/thick-cut fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French Fries" |
| green peas | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Green Peas" |
| tartar sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Tartar Sauce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge

### 25, American breakfast platter

- **production**: Cooked bacon, Pancakes with powdered sugar, Fried egg, Breakfast sausage links, Hash brown potato patties, Toast, Maple-style syrup, Butter portions, Burger sandwich

| gold core item | production | notes |
|---|---|---|
| pancakes with icing sugar | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Pancakes with powdered sugar" |
| back bacon rashers | Y | "Cooked bacon" |
| fried egg (sunny side up) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Fried egg" |
| breakfast sausages | Y | "Breakfast sausage links" |
| hash brown/potato croquettes | Y | "Hash brown potato patties" |
| toast slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "toast" |
| maple syrup in a shot glass | Y | "Maple-style syrup" |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none | trap leak, not counted: "Burger sandwich" is the sandwich on the background plate (gold trap) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **production**: vegetable pulao rice, papad, mixed salad, raita, lentil dal, vegetable curry, vegetable curry, vegetable curry

| gold core item | production | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | "vegetable pulao rice" |
| chapati/roti | n | not named |
| papad (papadum) | Y | "papad" |
| curd/raita | Y | "raita" |
| dal (lentil curry) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "lentil dal" |
| kofta/dumpling curry in orange gravy | n | "vegetable curry" names neither kofta nor paneer (strict rule 1, as 25-flash "Vegetable curry (orange)"); one of the three goes to the brinjal row |
| paneer or fish curry in pale gravy | n | no paneer or fish token, as above |
| brinjal/eggplant curry | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: D "vegetable curry" for the eggplant curry, same call as "vegetable soup" for borscht (precedent) |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none | "mixed salad" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **production**: Chicken and vegetable stir-fry

| gold core item | production | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Chicken and vegetable stir-fry" |
| red bell pepper strips | n | prefill n from v3-eu-cell-25-lite-newprompt: no reported item covered it |
| onion | n | prefill n from v3-eu-cell-25-lite-newprompt: no reported item covered it |
| spring onion/green onion | n | prefill n from v3-eu-cell-25-lite-newprompt: no reported item covered it |
| steamed white rice | n | not named |
| **core recall (/5)** | 1/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): dried chilli bits

### 28, Middle-Eastern mezze spread — four composed plates plus flatbread

- **production**: Grilled flatbread, Falafel, Cooked lentils, Couscous, Shredded cabbage and carrot salad, Mixed vegetable salad, Pickled vegetables, Spicy dipping sauce, Beetroot

| gold core item | production | notes |
|---|---|---|
| falafel balls | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Falafel" |
| grilled flatbread | Y | "Grilled flatbread" |
| hummus/creamy white dip | n | not named |
| green herb-chilli sauce | n | "Spicy dipping sauce" names no kind (strict rule 1, as L1, L3, 25-lite on this row) |
| yellow bulgur or couscous | Y | "Couscous" |
| black beluga lentils | Y | "Cooked lentils" (B2 name) |
| pickled white cabbage slaw | Y | "Shredded cabbage and carrot salad": cabbage kind right, pickling is prep (as 25-lite, 25-flash) |
| green olives | n | not named |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none | "Pickled vegetables", "Beetroot", "Mixed vegetable salad" match optional items |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: Wheat beer, Salami, Semi-hard cheese cubes, Black olives, Pickled vegetables

| gold core item | production | notes |
|---|---|---|
| pickled gherkin slices | n | "Pickled vegetables" names a class, not the gherkin (strict rule 1, as mistral "pickled vegetables" on 50); the model notes say it could not tell |
| salami slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "salami" |
| cheese cubes | Y | "Semi-hard cheese cubes" |
| green olives | Y | "Black olives" for the dark green olives (photo): same fruit, ripeness colour is form, not kind |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none | "Wheat beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30, Mixed grill board (plancha de grillades)

- **production**: Grilled chicken breast, Roasted potatoes, Mixed salad leaves with tomato

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | n | not named |
| grilled beef steak | n | "Grilled chicken breast": chicken for beef, species miss (rule 2) |
| grilled sausage | n | not named |
| grilled meat skewer with green pepper and tomato | n | not named |
| baked/roasted potato with browned cheese topping | Y | "Roasted potatoes" (as mistral "roasted potato") |
| mixed leaf salad | Y | "Mixed salad leaves with tomato" |
| **core recall (/6)** | 2/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cherry tomato, steak knife

### 31, Bowl of beef/oxtail soup with buttered bread

- **production**: Beef stew with gravy, White bread, Butter

| gold core item | production | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged | "Beef stew with gravy" |
| beef (oxtail) chunks | Y merged | same item names the beef |
| buttered bread slices (dark/whole-grain) | Y | "White bread" plus "Butter": bread kind right, flour colour misread |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Butter" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **production**: Green olives, Carrot sticks, Celery sticks, Bell pepper strips, Pickled cucumber slices, Creamy dip, Baked potato rounds, Blue cheese, Cheddar cheese slices, Sliced salami

| gold core item | production | notes |
|---|---|---|
| green olives | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Green olives" |
| cucumber sticks | Y | "Pickled cucumber slices": cucumber kind right, pickled is prep (rule 2); "Celery sticks" is the second cucumber compartment misread |
| carrot sticks | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Carrot sticks" |
| bell pepper strips | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "bell pepper strips" |
| pan-fried spiced hard-boiled egg halves | n | "Baked potato rounds" is the spiced egg compartment misread, kind miss (as mistral "spiced roasted potato wedges") |
| hummus dip | n | "Creamy dip" names no kind (strict rule 1) |
| salami/cured meat slices | Y | "Sliced salami" |
| cheese slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "cheddar cheese slices" |
| **core recall (/8)** | 6/8 |  |
| **hallucinations** | none | "Celery sticks" and "Baked potato rounds" are visible compartments misnamed (rule 3); "Blue cheese" is the herbed cheese |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **production**: oatmeal porridge with milk and cinnamon, peanut butter, raisins

| gold core item | production | notes |
|---|---|---|
| oatmeal/oat porridge | Y merged | "oatmeal porridge with milk and cinnamon" |
| peanut butter | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Peanut butter" |
| raisins | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Raisins" |
| ground cinnamon | Y merged | same item names the cinnamon |
| milk | Y merged | same item names the milk (D3, 25-lite precedent) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: waffles with chocolate sauce, strawberries, whipped cream

| gold core item | production | notes |
|---|---|---|
| waffles | Y | "waffles with chocolate sauce" |
| strawberries (sliced fresh) | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "strawberries" |
| strawberry/berry syrup-compote | n | "chocolate sauce" in the same item is the red syrup misread, kind miss |
| whipped cream | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Whipped cream" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none | "chocolate sauce" is the strawberry syrup misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **production**: French fries, Kebab meat with creamy sauce, Mixed salad

| gold core item | production | notes |
|---|---|---|
| gyros/döner sliced meat | Y | "Kebab meat with creamy sauce" |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French Fries" |
| white garlic-yogurt sauce (tzatziki) with oregano | n | "creamy sauce" in the same item names no kind (strict rule 1, as "spicy sauce") |
| shredded white cabbage | n | "Mixed salad" names no part (strict rule 1) |
| tomato slices | n | rule 1, as above |
| sweetcorn | n | rule 1, as above |
| cucumber slices | n | rule 1, as above |
| shredded carrot | n | rule 1, as above |
| **core recall (/8)** | 2/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: Seafood paella

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "seafood paella" |
| whole prawns (langostinos) | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "seafood paella" |
| mantis shrimp (galeras) | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "seafood paella" |
| artichoke pieces | n | prefill n from v3-eu-cell-35-eu-newprompt, v4-eu-cell-31-lite-newprompt-r2: no reported item covered it |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: Steamed dumplings with brown sauce, Shredded cabbage and carrot salad

| gold core item | production | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y | "Steamed dumplings with brown sauce": dumplings named, steamed for boiled is prep |
| fried caramelised onion topping | n | "brown sauce" in the same item is the onion topping misread, kind miss |
| grated carrot and cabbage salad | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "shredded cabbage and carrot salad" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | "brown sauce" is the onion topping misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **production**: Hamburger with sesame bun, beef patty and lettuce, French fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | "Hamburger with sesame bun, beef patty and lettuce" |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: Baked beans, Cooked bacon

| gold core item | production | notes |
|---|---|---|
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Baked beans" (D3 name) |
| sausage pieces | n | not named |
| bacon rasher | Y | "Cooked bacon" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **production**: Beef stew with gravy, French fries, Grilled pork steak, Fried egg

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | n | "Beef stew with gravy" for liver: organ identity is kind (rule 2, the 2026-08-12 "beef stew" for liver flip) |
| chips/French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| bacon/gammon slice | Y | "Grilled pork steak": gammon steak is a pork steak, cut (rule 2) |
| fried egg (remnant, yolk visible) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "fried egg" |
| sausage | n | not named |
| grilled tomato half | n | not named |
| **core recall (/6)** | 3/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: roasted sweet potato wedges, cooked sausage, corn on the cob, creamy dipping sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten | n | no fish named; "corn on the cob" and "cooked sausage" are the battered fish and a dark wedge misread (photo), kind miss, not hallucinations |
| potato wedges/skin-on roast potatoes | n | "roasted sweet potato wedges": sweet potato for potato is another species (rule 2); photo shows white-fleshed potato |
| tartar sauce / mayonnaise dollop | Y | "creamy dipping sauce": the gold row leaves the creamy sauce open (as 25-flash "creamy sauce" for the 42 dollop) |
| **core recall (/3)** | 1/3 |  |
| **hallucinations** | none | "corn on the cob" and "cooked sausage" are the fish and a wedge misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **production**: Breaded chicken cutlet with creamy sauce, White rice with curry sauce, Corn kernels, Pickled red cabbage and onion

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | n | "Breaded chicken cutlet with creamy sauce": chicken for fish, species miss (rule 2) |
| sour cream / remoulade dollop | Y | "creamy sauce" in the same item names the dollop (as 25-flash "Fried fish fillet with creamy sauce") |
| meatballs in brown gravy | n | not named |
| chickpea-and-cauliflower curry | n | "White rice with curry sauce" names no chickpea or cauliflower (strict rule 1) |
| white rice | Y | "White rice with curry sauce" |
| red cabbage and sweetcorn salad | Y | "Pickled red cabbage and onion" plus "Corn kernels" (as 25-lite, 25-flash) |
| cucumber and lettuce salad | n | not named |
| **core recall (/7)** | 3/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set — main plate, soup bowl, bread plate

- **production**: Breaded fish fillets with creamy sauce, Cooked rice, Green beans, Potato gratin, Bread roll with butter

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | "Breaded fish fillets with creamy sauce": form (as mistral "breaded fish fillet with tartar sauce") |
| herbed green rice | Y | "Cooked rice" (as mistral "rice") |
| green beans | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Green beans" |
| cheese-topped quiche/gratin square | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Potato gratin": gold row accepts a gratin square |
| creamy meat-and-vegetable stew | n | not named |
| creamy soup (bowl, with bacon bits) | n | not named |
| bread roll with butter | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "bread roll with butter" |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: Mixed vegetable salad, Cooked brown beans, Yellow rice, Potato and cabbage stew

| gold core item | production | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | "Mixed vegetable salad": the gold row is the one salad on the plate (as L1 "mixed salad") |
| brown beans (feijão) in broth | Y | "Cooked brown beans" |
| yellow seasoned rice | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Yellow rice" |
| braised cabbage with tomato | Y merged | "Potato and cabbage stew" names the cabbage on the mash (as L1 "mashed potatoes with cabbage") |
| stewed meat in onion gravy | n | not named |
| mashed cassava/potato purée | Y merged | same item names the potato |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45, Korean hanjeongsik table spread (dozens of banchan, top-down)

- **production**: Asparagus, Braised meat and vegetables, Cooked leafy greens, Creamy vegetable soup, Grilled fish, Potato and vegetable curry, Black beans, Green beans in tomato sauce, Tofu with tomato sauce and greens, Grilled meat, Mixed salad with egg, Noodles with mushrooms

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | n | no glass noodle named; "Noodles with mushrooms" (a small bowl) is the noodle and mushroom soup bowl, an optional item (photo) |
| steamed egg (gyeranjjim) in stone pot | n | no egg dish named; the egg pot is "Creamy vegetable soup" or "Potato and vegetable curry", kind miss |
| grilled mackerel/fish | Y | "Grilled fish" |
| stir-fried beef in a hot stone pot | n | "Braised meat and vegetables" names no animal (strict rule 1, as "nigiri sushi" with no fish) |
| glazed spicy braised ribs/pork | n | "Grilled meat" names no animal (strict rule 1, as above) |
| sliced raw fish (hoe/sashimi) on shredded radish | n | not named; "Mixed salad with egg" is that plate misread |
| vegetable fritters/jeon platter | n | no fritter or pancake named |
| kimchi | n | not named; "Tofu with tomato sauce and greens" reads the kimchi as tomato sauce, kind miss |
| **core recall (/8)** | 1/8 |  |
| **hallucinations** | none | every item points at a visible dish (green chillies as "Asparagus", the beans bowl, the namul, the soup pots); no empty bowl named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: Beef honeycomb tripe in sauce, Steamed tofu skin, Steamed rice cakes

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | "Beef honeycomb tripe in sauce" |
| white boiled tripe/omasum slices in broth | n | "Steamed rice cakes" is the white omasum misread, kind miss; not a dumpling, so no trap |
| fried beancurd-skin rolls (tofu skin rolls) | Y | "Steamed tofu skin" (frying lost, form) |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | "Steamed rice cakes" is the omasum misnamed; no dumpling or bun named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: Kiwi, berry and granola bowl, Red dipping sauce, Iced coffee with milk, Savory bites with creamy sauce, Cherry tomato skewers with sauce, Avocado toast with creamy topping, Chocolate sesame ring pastry, Coffee

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | "Avocado toast with creamy topping": the poached egg read as a topping |
| eggs benedict with hollandaise on avocado toast | n | "Savory bites with creamy sauce" names nothing (strict rule 1) |
| yogurt bowl with granola, kiwi slices and berry compote | Y | "Kiwi, berry and granola bowl" names kiwi and granola (C3, mistral call) |
| cherry tomato salad with balsamic drizzle | Y | "Cherry tomato skewers with sauce": skewer for salad is form, drizzle named as sauce |
| seeded bagel (dark, sesame-topped) | Y | "Chocolate sesame ring pastry": ring-shaped baked good, form (as 25-flash "Chocolate donut with sesame seeds") |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none | "Red dipping sauce" is the beetroot latte, "Coffee" the passion fruit drink (rule 3); no menu card item |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: boiled potato slices, white bread, mashed potatoes

| gold core item | production | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | "white bread": the sandwich bread, filling lost |
| potato chips/crisps | Y | "boiled potato slices": potato slices, frying lost is prep (rule 2) |
| samosas (small fried triangles) | n | not named |
| slice of white/vanilla cake with icing — partly eaten | n | "mashed potatoes" (a large scoop) is the white cake misread, kind miss |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none | "mashed potatoes" is the cake misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49, Cafe sizzling-plate dinner set

- **production**: Cooked noodles with tomato, Glazed grilled beef, Brown soup or sauce, Sliced white bread

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y | "Glazed grilled beef" |
| spaghetti (plain, buttered) | Y merged | "Cooked noodles with tomato" |
| sausage/frankfurter | n | not named |
| cherry tomatoes | Y merged | same item names the tomato (photo: cherry tomatoes on the spaghetti) |
| red cabbage soup (borscht-style, bowl) | Y | "Brown soup or sauce" for the soup bowl (as bare "Soup" in 25-flash, 25-lite) |
| bread bun | Y | "Sliced white bread" (form) |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none | "Brown soup or sauce" is the soup bowl |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: French fries, Doner kebab meat with red sauce, Mixed salad with cucumber, Cola, Beer

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y merged | "Doner kebab meat with red sauce" |
| tomato/chili sauce over the meat | Y merged | same item, "red sauce" names the tomato or chili kind by colour (bare "with sauce" scored n) |
| French fries | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "French fries" |
| iceberg lettuce salad | n | "Mixed salad with cucumber" names no lettuce (strict rule 1) |
| sliced red onion | n | not named |
| cucumber slices | Y merged | "Mixed salad with cucumber" names the cucumber (as mistral on this row) |
| pickled gherkin and pepperoncini | n | not named |
| **core recall (/7)** | 4/7 |  |
| **hallucinations** | none | "Cola", "Beer" optional; nothing from the background plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 157/235 = 66.8 % |
| hallucinations | 1 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 166 |
| cost / plate (auto) | $0.00103 |
| latency median s (auto) | 12.52 |

## Recall and bootstrap confidence interval

> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`, STRICT reading of rule 1 (a generic label such as "greens", "spicy sauce", "cured meat assortment", "mixed vegetables", a bare "mixed salad" where gold lists the parts, "nigiri sushi" with no fish named, "mediterranean salad" with no part named, earns no credit for a specific gold item). Cell: openai/gpt-6-luna on the EU OpenRouter host (`only: azure/eu`, zero retention), no reasoning parameter, v4 prompt, plates repeat 1. Prefill: `--prefill` from `runs/eu-*/`, `runs/v3-eu-*/` and the three `runs/v4-eu-cell-31-lite-newprompt-r{1,2,3}/` sheets here, plus the `v3-eu-cell-*` and `eu-cell-*` sheets in `op-worktrees/prompt-v3` (no 2026-08 sheet; 13 distinct sheets, 3363 remembered verdicts). Prefill result: 59 Y (3 of them Y merged), 4 n, 0 conflicts, 172 need judgment. Every prefilled row was kept. The 172 open rows were judged by hand, consistent with the same model item name in this order: the three v4 3.1 lite sheets, then C3 (`v3-eu-cell-38-minimal-newprompt`), D3 (`v3-eu-cell-35-eu-newprompt`), `v3-eu-cell-25-flash-newprompt`, `v3-eu-cell-mistral-medium-newprompt`, `v3-eu-cell-25-lite-newprompt`. Most names were new and were judged fresh. Photos opened: 06, 12, 13, 19, 20, 21, 29, 32, 41, 43, 45, 47, 48, 49. No model was called for this scoring.

- **Hits: 157/235. Recall: 66.8 %.**
- **95 % CI: [58.6, 74.9] %.**
- Method: a percentile bootstrap over plates (a cluster bootstrap, because a plate's items succeed or fail together). Each of 2000 resamples draws 50 plates with replacement with Python's stdlib `random.Random(7)`. Recall of a resample is the sum of its hits over the sum of its gold items. The CI is the 2.5th and 97.5th percentile of the 2000 values, with linear interpolation. The computation is `harness/stats.py` `bootstrap_recall_ci(pairs, resamples=2000, seed=7)`.
- The harness default (`--score`: 10 000 resamples, seed 20260813) gives [58.7, 74.7] %.
- Answered plates only: every plate has an answer (0 error records), so recall on the answered plates is the same, 157/235 = 66.8 % on 50 plates.

Per plate hits: 01 6/6, 02 1/5, 03 7/8, 04 4/4, 05 1/2, 06 4/6, 07 5/5, 08 2/3, 09 1/1, 10 2/2, 11 2/3, 12 2/3, 13 1/2, 14 3/3, 15 3/3, 16 4/4, 17 3/4, 18 1/2, 19 3/5, 20 2/4, 21 2/6, 22 5/6, 23 3/4, 24 4/4, 25 7/7, 26 5/8, 27 1/5, 28 5/8, 29 3/4, 30 2/6, 31 3/3, 32 6/8, 33 5/5, 34 3/4, 35 2/8, 36 3/4, 37 2/3, 38 2/2, 39 2/3, 40 3/6, 41 1/3, 42 3/7, 43 5/7, 44 5/6, 45 1/8, 46 2/3, 47 4/5, 48 2/4, 49 5/6, 50 4/7.

## Hallucinations by plate

- **21: 1.** "Banana" ("one medium banana"). No banana is in the photo. The only yellow object is a shoe at the right edge, and a shoe is not food.
- Total: **1 hallucination** on 50 plates. A hallucination is a food with no referent in the photo (rule 3).
- Trap leaks, not counted: 1. Plate 25 "Burger sandwich" is the sandwich on the background plate (the model note says so). Plate 50 names nothing from the background plate, plate 47 names no menu card item, plate 46 names no dumpling or bun, plate 39 names no egg or toast, plate 45 names no empty bowl.
- Misnamed visible objects, not counted (rule 3): 12 "Creamy pasta" (sauerkraut), 13 "Beef strips in sauce" (the caramelised onion heap; the gold trap warns against invented meat, but this item points at a visible pile on top), 19 "Ketchup" (the curry sauce), 20 "Poached egg" (chashu) and "bean sprouts" (mizuna stems), 32 "Celery sticks" (cucumber) and "Baked potato rounds" (the spiced eggs), 34 "chocolate sauce" (strawberry syrup), 37 "brown sauce" (onions), 41 "corn on the cob" and "cooked sausage" (the battered fish and a wedge), 45 "Asparagus" (green chillies) and other renamed dishes, 46 "Steamed rice cakes" (omasum), 47 "Red dipping sauce" (beetroot latte) and "Coffee" (the passion fruit drink), 48 "mashed potatoes" (the cake).

## Errors, schema-invalid records, false unreadable

- Error records: **0**. `_summary.failures` is empty. Every record is HTTP 200, 1 attempt, `finish_reason` stop. No Azure content filter refusal (no `content_filter` finish, no "I'm sorry" content) in this run.
- Schema-invalid records: **0** (`schema_valid` true on 50/50). Error and invalid ids: none.
- False unreadable: **0** (`unreadable` is false on all 50 answers).

## Paired difference against C3

C3 is `op-worktrees/prompt-v3/apps/inference/eval/runs/v3-eu-cell-38-minimal-newprompt/scorecard-filled.md` (3.8 flash, minimal reasoning, v3 prompt), the same 50 plates and the same 235 gold items.

- C3: 199/235 = 84.7 %, 95 % CI [78.2, 90.8] (same method, seed 7, 2000 resamples).
- This cell: 157/235 = 66.8 %, 95 % CI [58.6, 74.9].
- **C3 minus this cell: +17.9 points, paired 95 % CI [+8.0, +28.0].** The interval excludes 0 by a wide margin.
- Method: `harness/stats.py` `bootstrap_diff_ci(c3, this_cell, resamples=2000, seed=7)`. Each resample draws one set of 50 plate indices with `random.Random(7)` and applies it to both cells, so plate difficulty cancels. The CI is the 2.5th and 97.5th percentile of the 2000 differences, with linear interpolation. A separate stdlib reimplementation gave the same bounds.
- Plates where the two cells differ (C3 minus this cell, in hits): 02 +4, 03 +1, 05 +1, 06 -1, 07 -3, 08 +1, 11 +1, 12 +1, 13 +1, 18 +1, 19 +2, 20 +1, 21 +2, 22 -3, 23 +1, 26 +3, 27 +1, 28 -2, 29 +1, 30 +3, 32 -1, 33 -1, 35 +4, 36 +1, 37 +1, 39 +1, 40 +3, 41 +2, 42 +2, 43 +1, 44 +1, 45 +7, 46 +1, 47 +1, 48 +2, 50 +1.

Sensitivity to the closest calls (same method):

| variant | hits, recall | 95 % CI | C3 minus this cell [95 % CI] |
|---|---|---|---|
| as filled | 157/235 = 66.8 % | [58.6, 74.9] | +17.9 [+8.0, +28.0] |
| more lenient: 45 beef, pork, japchae; 41 wedges; 21 pho; 29 gherkin; 35 tzatziki; 32 hummus to Y | 165/235 = 70.2 % | [63.4, 77.2] | +14.5 [+5.6, +23.0] |
| stricter: 29 olives, 41 mayonnaise, 50 red sauce, 49 soup, 48 chips, 31 bread, 13 spätzle to n | 150/235 = 63.8 % | [55.3, 72.0] | +20.9 [+10.7, +30.9] |

The sign holds in every variant, and the CI excludes 0 in every variant.

## Judgment calls that were not obvious

| plate | call | verdict | why unsure |
|---|---|---|---|
| 45 | "Braised meat and vegetables" for the stone-pot beef, "Grilled meat" for the glazed pork | n, n | strict rule 1 read by analogy with "nigiri sushi" with no fish: "meat" names no animal; mistral "grilled meat" scored Y on 44 only because that gold row names no kind |
| 41 | "roasted sweet potato wedges" for the potato wedges | n | sweet potato is another species (rule 2), but the wedges look golden and the form is right; a lenient reader would credit it |
| 21 | "Beef and green bean stir-fry" plus "Cooked rice noodles" for the pho noodle soup | n | the beef and the rice noodles are named, but no soup or broth; the noodle item is a side "plateful", so I did not read it as the noodles in the bowl |
| 29 | "Black olives" for green olives, "Pickled vegetables" for the gherkins | Y, n | olive colour read as ripeness (form); "pickled vegetables" follows the mistral strict call on 50, though "pickles" in other sheets scored Y |
| 41, 35 | "creamy dipping sauce" for "tartar sauce / mayonnaise dollop" (Y), "creamy sauce" for the tzatziki (n) | Y, n | split on whether the gold row itself leaves the sauce open (25-flash credited "creamy sauce" for the open 42 dollop); "creamy sauce" for a named tzatziki is like "spicy sauce" |

## Findings

1. GPT-6 Luna with the v4 prompt on the EU Azure route reaches 157/235 = 66.8 % [58.6, 74.9], with 1 hallucination (21 "Banana"), 0 error records and 0 content filter refusals, at $0.00103 a plate and a 12.5 s median.
2. C3 v3 leads by +17.9 points, paired CI [+8.0, +28.0]. The losses are kind errors on familiar plates (02 chicken for roast beef, 05 beef for chicken, 11 fish for schnitzel, 30 chicken for steak, 40 beef stew for liver, 42 chicken for fish) and generic or merged labels on enumeration plates (45, 35, 26).
