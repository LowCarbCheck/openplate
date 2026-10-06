
# Plate-identification scoring worksheet

- results: `runs/v3-eu-cell-25-lite-newprompt/results.json`
- config: `eu-cell-25-lite-newprompt` (started 2026-10-06T11:29:56.312110+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`, STRICT reading of rule 1 (a generic label such as "greens", "spicy sauce", "vegetables", "with sauce" earns no credit for a specific gold item). A model item name that an earlier filled scorecard (`runs/*/scorecard-filled.md` here, and the v2 sheets in `op-worktrees/prompt-v2`) judged for the same gold item got the same verdict here; new names were judged fresh. Photos 25, 26, 30, 42 and 46 were opened. No model was called for this scoring. Error and schema-invalid records score n on every gold row of their plate: the app would have shown nothing.

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 39/50 |
| items named (total) | 179 |
| items named (mean/plate) | 3.58 |
| distinct item names | 159 |
| latency mean (s) | 6.19 |
| latency median (s) | 6.58 |
| latency max (s) | 12.24 |
| cost / plate (USD) | 0.001019 |
| cost total (USD) | 0.050955 |

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

- **production**: Whole grain bread slice, Cocktail sausages, Scrambled eggs, Baked beans, Cooked ham slices, Cucumber slices, Margarine

| gold core item | production | notes |
|---|---|---|
| scrambled eggs | Y | "Scrambled eggs" |
| bacon/ham slices | Y | "Cooked ham slices" |
| frankfurter sausages | Y | "Cocktail sausages" (A name) |
| baked beans in tomato sauce | Y | "Baked beans" (A, cloud name) |
| brown bread slice | Y | "Whole grain bread slice" |
| cucumber slices | Y | "Cucumber slices" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter/margarine packets

### 02, Roast (Sunday) dinner

- **production**: Roast beef, Yorkshire pudding, Roasted potatoes, Cooked broccoli, Cooked cabbage, Gravy

| gold core item | production | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y | "Roast beef" |
| Yorkshire pudding | Y | "Yorkshire pudding" |
| roast potatoes | Y | "Roasted potatoes" |
| broccoli | Y | "Cooked broccoli", named on its own |
| cabbage/greens | Y | "Cooked cabbage", named on its own |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **production**: Grilled Salmon Fillets, Greek Salad Mix, Feta Cheese Cubes, Avocado Slices, Kalamata Olives

| gold core item | production | notes |
|---|---|---|
| grilled salmon fillets | Y | "Grilled Salmon Fillets" |
| feta cheese | Y | "Feta Cheese Cubes", named |
| kalamata olives | Y | "Kalamata Olives", named |
| avocado | Y | "Avocado Slices", named |
| cherry tomatoes | Y merged | "Greek Salad Mix": determinate dish "Greek salad" (rule 1 consolidation, as A, B, C, runpod "greek salad") |
| cucumber | Y merged | "Greek Salad Mix", as above |
| lettuce/romaine | Y merged | "Greek Salad Mix", as above |
| red onion | Y merged | "Greek Salad Mix", as above |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04, Cheeseburger with fries

- **production**: Cheeseburger, French fries, Ketchup, Pickles, Beer

| gold core item | production | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y | "Cheeseburger" |
| thick-cut fries/steak fries | Y | "French fries" (cut not distinguished, cloud precedent) |
| ketchup | Y | "Ketchup" |
| pickles/gherkins | Y | "Pickles" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **production**: White rice, Chicken and vegetable stew

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | "Chicken and vegetable stew": chicken in sauce is the row; greens named only as "vegetable" (as runpod "chicken curry", greens dropped) |
| white rice | Y | "White rice" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: Salmon and Avocado Sushi Rolls, Tuna Nigiri, White Fish Nigiri, Pickled Ginger, Wasabi, Soy Sauce

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | "Salmon and Avocado Sushi Rolls" |
| tuna nigiri | Y | "Tuna Nigiri" |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | Y | "White Fish Nigiri" |
| pickled ginger | Y | "Pickled Ginger" |
| wasabi | Y | "Wasabi" |
| soy sauce | Y | "Soy Sauce" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: Spaghetti with meat sauce and vegetables

| gold core item | production | notes |
|---|---|---|
| spaghetti | Y merged | "Spaghetti with meat sauce and vegetables" (identical to the 3.5 EU cell name) |
| ground beef/meat tomato sauce | Y merged | same item |
| corn kernels | n | "vegetables" names nothing (rule 1) |
| green beans | n | rule 1 |
| carrot pieces | n | rule 1 |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **production**: Yogurt, Granola, Apple slices

| gold core item | production | notes |
|---|---|---|
| yogurt | Y | "Yogurt" |
| granola (oats/puffed grains, nuts) | Y | "Granola" |
| apple slices | Y | "Apple slices" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **production**: pizza

| gold core item | production | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | "pizza": same name credited in lfmvl and runpod (chicken topping not stated) |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **production**: (none)  _[schema-invalid; error: HTTP 429, upstream rate limit (google-vertex/eu shared pool), 2 attempts]_

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| green side salad (rocket/mixed leaves) | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| **core recall (/2)** | 0/2 |  |
| **hallucinations** | n/a | error record, no answer |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: (none)  _[schema-invalid; error: the answer has no message content]_

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | n | no answer: finish_reason error, empty content (schema-invalid) |
| thick-cut fries/potato wedges | n | no answer |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | n | no answer |
| **core recall (/3)** | 0/3 |  |
| **hallucinations** | n/a | error record, no answer |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: Sausages with sauce, Mashed potatoes, Sauerkraut, Mixed salad

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y | "Sausages with sauce": kind right, as lfmvl "sausage" |
| sauerkraut | Y | "Sauerkraut" |
| mashed potatoes | Y | "Mashed potatoes" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Mixed salad" is the background plate: trap leak, not a hallucination (rule 3), as D3 and D2 |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: Cheesy noodles with caramelized onions, Mixed salad with dressing

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y merged | "Cheesy noodles with caramelized onions": noodles in melted cheese, regional name lost (as "macaroni and cheese") |
| fried/caramelised onions | Y merged | same item names the onions |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: Mixed lettuce salad, Beef stew with potatoes

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y merged | "Beef stew with potatoes" (as qwenvl "beef stew with potatoes") |
| boiled potatoes | Y merged | same item |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "Mixed lettuce salad" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: Weisswurst, Pretzel, Beer, Sweet Mustard

| gold core item | production | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y | "Weisswurst" |
| pretzel (Brezel) | Y | "Pretzel" |
| sweet mustard | Y | "Sweet Mustard" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16, Döner/gyros plate with fries and salad

- **production**: döner kebab meat with sauce, french fries, mixed salad with dressing and pickled pepper, beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | Y | "döner kebab meat with sauce" |
| tomato sauce over the meat | n | "with sauce" names no sauce kind (strict rule 1; new name) |
| French fries | Y | "french fries" |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | "mixed salad with dressing and pickled pepper": gold row is itself the consolidated salad (precedent) |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: French fries, Currywurst with sauce

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y merged | "Currywurst with sauce" (identical name in A, B, C) |
| curry ketchup sauce | Y merged | sauce entailed by the named dish "currywurst" (precedent) |
| curry powder | n | curry dusting not named |
| French fries | Y | "French fries" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: (none)  _[schema-invalid; error: HTTP 429, upstream rate limit (google-vertex/eu shared pool), 2 attempts]_

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| potato salad | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| **core recall (/2)** | 0/2 |  |
| **hallucinations** | n/a | error record |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: (none)  _[schema-invalid; error: HTTP 429, upstream rate limit (google-vertex/eu shared pool), 2 attempts]_

| gold core item | production | notes |
|---|---|---|
| French fries | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| gyros/döner sliced meat | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| sliced sausage in curry/shashlik sauce | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| tzatziki/garlic yogurt sauce | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| mayonnaise | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| **core recall (/5)** | 0/5 |  |
| **hallucinations** | n/a | error record |
| **over-decomposed** | 0 |  |

### 20, Bowl of shio ramen

- **production**: (none)  _[schema-invalid; error: HTTP 429, upstream rate limit (google-vertex/eu shared pool), 2 attempts]_

| gold core item | production | notes |
|---|---|---|
| ramen noodles | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| clear (shio) broth | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| sliced chashu pork | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| leafy green herb topping (mizuna/mitsuba) | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| **core recall (/4)** | 0/4 |  |
| **hallucinations** | n/a | error record |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **production**: (none)  _[schema-invalid; error: HTTP 429, upstream rate limit (google-vertex/eu shared pool), 2 attempts]_

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| sliced beef and beef meatballs | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| bean sprouts | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| Thai basil | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| sliced green chilli/jalapeño | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| spring onion | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| **core recall (/6)** | 0/6 |  |
| **hallucinations** | n/a | error record |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: beef tacos, corn on the cob, dark soda

| gold core item | production | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y | "beef tacos" |
| grated cheese | n | not named |
| red salsa | n | not named |
| green salsa/tomatillo | n | not named |
| coriander/cilantro | n | not named |
| grilled corn on the cob | Y | "corn on the cob" |
| **core recall (/6)** | 2/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **production**: Smothered Burrito, Shredded Lettuce, Diced Tomatoes

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | Y merged | "Smothered Burrito" (identical to D2 "smothered burrito") |
| green chile sauce | Y merged | "smothered" entails the sauce (precedent) |
| shredded cheddar/jack cheese | n | cheese not named |
| shredded lettuce | Y | "Shredded Lettuce", named on its own |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **production**: Battered fish fillet, French fries, Peas, Tartar sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish fillet | Y | "Battered fish fillet" |
| chips/thick-cut fries | Y | "French fries" |
| green peas | Y | "Peas" |
| tartar sauce | Y | "Tartar sauce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge

### 25, American breakfast platter

- **production**: Bacon, Pancakes with powdered sugar, Fried egg, Pork sausages, Hash browns, Toast, Honey, Butter

| gold core item | production | notes |
|---|---|---|
| pancakes with icing sugar | Y | "Pancakes with powdered sugar" |
| back bacon rashers | Y | "Bacon" |
| fried egg (sunny side up) | Y | "Fried egg" |
| breakfast sausages | Y | "Pork sausages" |
| hash brown/potato croquettes | Y | "Hash browns" |
| toast slices | Y | "Toast" |
| maple syrup in a shot glass | n | "Honey" for the maple syrup shot glass: honey is another food (rule 2 kind miss, photo: amber syrup); misnamed visible object, not a hallucination |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none | "Honey" is the misnamed syrup glass (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **production**: Vegetable Fried Rice, Roti, Plain Yogurt, Vegetable Soup, Chicken Curry, Dal (Lentils), Mixed Vegetable Curry, Salad

| gold core item | production | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | "Vegetable Fried Rice" |
| chapati/roti | Y | "Roti" |
| papad (papadum) | n | papad not named (photo: large papad beside the roti) |
| curd/raita | Y | "Plain Yogurt" |
| dal (lentil curry) | Y | "Dal (Lentils)" |
| kofta/dumpling curry in orange gravy | n | "Chicken Curry" (medium) for a kofta or paneer bowl: chicken is the wrong kind for either (rule 2) |
| paneer or fish curry in pale gravy | n | see kofta row; one "Chicken Curry" token, wrong kind |
| brinjal/eggplant curry | Y | "Mixed Vegetable Curry" for the eggplant curry (D, C2, B2 precedent) |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none | "Chicken Curry" is a misnamed visible curry bowl (rule 3); "Vegetable Soup", "Salad" are optional items |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **production**: White rice, Chicken and vegetable stir-fry

| gold core item | production | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y | "Chicken and vegetable stir-fry" |
| red bell pepper strips | n | "vegetable" names nothing (rule 1, as qwenvl "chicken with sauce and vegetables") |
| onion | n | rule 1 |
| spring onion/green onion | n | rule 1 |
| steamed white rice | Y | "White rice" |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): dried chilli bits

### 28, Middle-Eastern mezze spread, four composed plates plus flatbread

- **production**: Falafel, Mixed Grains (Couscous/Bulgur and Lentils), Hummus, Shredded Cabbage Salad, Pickled Beetroot, Pickled Radish/Turnip, Olives, Mixed Herbs and Vegetables (e.g., Parsley, Carrots, Pomegranate), Pita Bread, Spicy Dipping Sauce

| gold core item | production | notes |
|---|---|---|
| falafel balls | Y | "Falafel" |
| grilled flatbread | Y | "Pita Bread" (as cloud, ens3, runpod) |
| hummus/creamy white dip | Y | "Hummus" |
| green herb-chilli sauce | n | "Spicy Dipping Sauce" names no herb or chilli oil kind; strict rule 1 (the review reversed D3 "spicy sauce" for this row) |
| yellow bulgur or couscous | Y merged | "Mixed Grains (Couscous/Bulgur and Lentils)" names bulgur or couscous |
| black beluga lentils | Y merged | same item names the lentils (as B2 "Cooked lentils", D3 "lentils") |
| pickled white cabbage slaw | Y | "Shredded Cabbage Salad": cabbage kind right, pickling is prep (rule 2) |
| green olives | Y | "Olives" (as runpod, ens3 "olives") |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none | "Pickled Beetroot", "Pickled Radish/Turnip", "Mixed Herbs and Vegetables" are optional items on the plates |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: (none)  _[schema-invalid; error: HTTP 429, upstream rate limit (google-vertex/eu shared pool), 2 attempts]_

| gold core item | production | notes |
|---|---|---|
| pickled gherkin slices | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| salami slices | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| cheese cubes | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| green olives | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| **core recall (/4)** | 0/4 |  |
| **hallucinations** | n/a | error record |
| **over-decomposed** | 0 |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30, Mixed grill board (plancha de grillades)

- **production**: Baked potato with cheese topping, Mixed green salad with tomato, Sausage, Grilled steak, Pork ribs, Grilled chicken wings/pieces, Small meat skewer, Grilled pork belly slices, Grilled green peppers, Grilled cherry tomatoes

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | Y | "Pork ribs" |
| grilled beef steak | Y | "Grilled steak" |
| grilled sausage | Y | "Sausage" |
| grilled meat skewer with green pepper and tomato | Y | "Small meat skewer" (plus "Grilled green peppers", "Grilled cherry tomatoes") |
| baked/roasted potato with browned cheese topping | Y | "Baked potato with cheese topping" |
| mixed leaf salad | Y | "Mixed green salad with tomato" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | photo checked: "Grilled chicken wings/pieces" (centre), "Grilled pork belly slices" (skewer), "Grilled green peppers", "Grilled cherry tomatoes" are all on the board |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cherry tomato, steak knife

### 31, Bowl of beef/oxtail soup with buttered bread

- **production**: Beef stew, Butter on bread

| gold core item | production | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged | "Beef stew" (same name credited in ens3, lfmvl, runpod) |
| beef (oxtail) chunks | Y merged | same item |
| buttered bread slices (dark/whole-grain) | Y | "Butter on bread" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **production**: Green olives, Cucumber sticks, Carrot sticks, Yellow bell pepper strips, Red bell pepper strips, Spiced stuffed eggs, Hummus, Blue cheese with herbs, Cheddar cheese slices, Salami slices, Herb crackers

| gold core item | production | notes |
|---|---|---|
| green olives | Y | "Green olives" |
| cucumber sticks | Y | "Cucumber sticks" |
| carrot sticks | Y | "Carrot sticks" |
| bell pepper strips | Y | "Yellow bell pepper strips", "Red bell pepper strips" |
| pan-fried spiced hard-boiled egg halves | Y | "Spiced stuffed eggs": stuffed for pan-fried is prep (rule 2, as deviled) |
| hummus dip | Y | "Hummus" |
| salami/cured meat slices | Y | "Salami slices" |
| cheese slices | Y | "Cheddar cheese slices", "Blue cheese with herbs" |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none | "Herb crackers" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **production**: Cooked Oatmeal with Milk, Peanut Butter, Raisins, Ground Cinnamon

| gold core item | production | notes |
|---|---|---|
| oatmeal/oat porridge | Y merged | "Cooked Oatmeal with Milk" |
| peanut butter | Y | "Peanut Butter" |
| raisins | Y | "Raisins" |
| ground cinnamon | Y | "Ground Cinnamon" |
| milk | Y merged | "Cooked Oatmeal with Milk" names the milk (D3 precedent) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: Waffle, Fresh strawberries, Strawberry sauce, Whipped cream

| gold core item | production | notes |
|---|---|---|
| waffles | Y | "Waffle" |
| strawberries (sliced fresh) | Y | "Fresh strawberries" |
| strawberry/berry syrup-compote | Y | "Strawberry sauce" (qwenvl, runpod name) |
| whipped cream | Y | "Whipped cream" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **production**: Doner Kebab Meat, French Fries, Yogurt Sauce, Shredded Cabbage Salad, Tomato Slices, Cucumber Slices, Corn Kernels, Pickled Pepper, Olive, Shredded Carrots

| gold core item | production | notes |
|---|---|---|
| gyros/döner sliced meat | Y | "Doner Kebab Meat" |
| French fries | Y | "French Fries" |
| white garlic-yogurt sauce (tzatziki) with oregano | Y | "Yogurt Sauce" (qwenvl name) |
| shredded white cabbage | Y | "Shredded Cabbage Salad" |
| tomato slices | Y | "Tomato Slices" |
| sweetcorn | Y | "Corn Kernels" |
| cucumber slices | Y | "Cucumber Slices" |
| shredded carrot | Y | "Shredded Carrots" |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none | "Pickled Pepper", "Olive" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: Paella rice, Shrimp, Artichoke pieces, Mantecado shrimp (mantis shrimp)

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | Y | "Paella rice" |
| whole prawns (langostinos) | Y | "Shrimp" (as ens3, lfmvl) |
| mantis shrimp (galeras) | Y | "Mantecado shrimp (mantis shrimp)": the parenthesis names the mantis shrimp; "mantecado" is a wrong word, not a wrong food |
| artichoke pieces | Y | "Artichoke pieces" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: Pierogi with caramelized onions, Coleslaw salad

| gold core item | production | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y merged | "Pierogi with caramelized onions" |
| fried caramelised onion topping | Y merged | same item |
| grated carrot and cabbage salad | Y | "Coleslaw salad" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **production**: Hamburger, French fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | "Hamburger" |
| French fries | Y | "French fries" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: baked beans in tomato sauce, pork sausage links, fried bacon

| gold core item | production | notes |
|---|---|---|
| baked beans in tomato sauce | Y | "baked beans in tomato sauce" |
| sausage pieces | Y | "pork sausage links" |
| bacon rasher | Y | "fried bacon" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **production**: Sausage, Cooked Beef, Cooked Liver, French Fries, Bacon, Fried Egg, Grilled Tomato

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | Y | "Cooked Liver" names the organ |
| chips/French fries | Y | "French Fries" |
| bacon/gammon slice | Y | "Bacon" |
| fried egg (remnant, yolk visible) | Y | "Fried Egg" |
| sausage | Y | "Sausage" |
| grilled tomato half | Y | "Grilled Tomato" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Cooked Beef" is the steak-like piece other cells named as beef steak (C2, B2) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: Battered fried fish, Potato wedges, Mayonnaise, Coronet Cracked Black Pepper

| gold core item | production | notes |
|---|---|---|
| battered fried fish (cod), partly eaten | Y | "Battered fried fish" |
| potato wedges/skin-on roast potatoes | Y | "Potato wedges" |
| tartar sauce / mayonnaise dollop | Y | "Mayonnaise" (cloud, A name) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Coronet Cracked Black Pepper": the pepper sachets, optional (non-food packet) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **production**: Fried fish fillet with cream sauce, White rice, Chickpea curry, Meatballs in sauce, Sweetcorn, Mixed salad with red cabbage and onion

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | Y merged | "Fried fish fillet with cream sauce" |
| sour cream / remoulade dollop | Y merged | "cream sauce" names the dairy dollop on the fish (photo) |
| meatballs in brown gravy | Y | "Meatballs in sauce" |
| chickpea-and-cauliflower curry | Y | "Chickpea curry" |
| white rice | Y | "White rice" |
| red cabbage and sweetcorn salad | Y | "Mixed salad with red cabbage and onion" plus "Sweetcorn": both describe this salad (photo) |
| cucumber and lettuce salad | n | no item names the cucumber and lettuce salad; the red cabbage item cannot cover it (precedent) |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set, main plate, soup bowl, bread plate

- **production**: (none)  _[schema-invalid; error: HTTP 429, upstream rate limit (google-vertex/eu shared pool), 2 attempts]_

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| herbed green rice | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| green beans | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| cheese-topped quiche/gratin square | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| creamy meat-and-vegetable stew | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| creamy soup (bowl, with bacon bits) | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| bread roll with butter | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| **core recall (/7)** | 0/7 |  |
| **hallucinations** | n/a | error record |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: (none)  _[schema-invalid; error: HTTP 429, upstream rate limit (google-vertex/eu shared pool), 2 attempts]_

| gold core item | production | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| brown beans (feijão) in broth | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| yellow seasoned rice | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| braised cabbage with tomato | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| stewed meat in onion gravy | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| mashed cassava/potato purée | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| **core recall (/6)** | 0/6 |  |
| **hallucinations** | n/a | error record |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45, Korean hanjeongsik table spread (dozens of banchan, top-down)

- **production**: (none)  _[schema-invalid; error: HTTP 429, upstream rate limit (google-vertex/eu shared pool), 2 attempts]_

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| steamed egg (gyeranjjim) in stone pot | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| grilled mackerel/fish | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| stir-fried beef in a hot stone pot | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| glazed spicy braised ribs/pork | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| sliced raw fish (hoe/sashimi) on shredded radish | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| vegetable fritters/jeon platter | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| kimchi | n | no answer: HTTP 429 upstream rate limit after 2 attempts |
| **core recall (/8)** | 0/8 |  |
| **hallucinations** | n/a | error record |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: Braised Beef Tripe, Fried Yuba Rolls, Braised Bamboo Shoots with Vegetables, Steamed Tofu Skin

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | "Braised Beef Tripe": one tripe token goes to the honeycomb cups (precedent) |
| white boiled tripe/omasum slices in broth | n | "Braised Bamboo Shoots with Vegetables" for the white omasum slices (photo: pale slices with carrot and scallion): plant for organ is a kind miss (rule 2); one tripe token cannot cover two dishes |
| fried beancurd-skin rolls (tofu skin rolls) | Y | "Fried Yuba Rolls" (also "Steamed Tofu Skin") |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | photo checked: "Braised Bamboo Shoots with Vegetables" is the misnamed omasum cups, "Steamed Tofu Skin" a second name for the rolls (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: (none)  _[schema-invalid]_

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | n | no usable answer: finish_reason error, JSON cut off after 3 items (schema-invalid) |
| eggs benedict with hollandaise on avocado toast | n | no usable answer: finish_reason error, JSON cut off after 3 items (schema-invalid) |
| yogurt bowl with granola, kiwi slices and berry compote | n | no usable answer: finish_reason error, JSON cut off after 3 items (schema-invalid) |
| cherry tomato salad with balsamic drizzle | n | no usable answer: finish_reason error, JSON cut off after 3 items (schema-invalid) |
| seeded bagel (dark, sesame-topped) | n | no usable answer: finish_reason error, JSON cut off after 3 items (schema-invalid) |
| **core recall (/5)** | 0/5 |  |
| **hallucinations** | n/a | schema-invalid record; the cut-off text named "Beetroot Latte", "Granola Bowl with Fruit", "Iced Coffee with Milk", not scored |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: Potato chips, Cake, Sandwich, Samosa

| gold core item | production | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | "Sandwich" (runpod name) |
| potato chips/crisps | Y | "Potato chips" |
| samosas (small fried triangles) | Y | "Samosa" |
| slice of white/vanilla cake with icing, partly eaten | Y | "Cake" (runpod name) |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49, Cafe sizzling-plate dinner set

- **production**: Steak with sauce, Spaghetti, Sausage, Soup, Bread roll

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y | "Steak with sauce" (qwenvl, runpod name) |
| spaghetti (plain, buttered) | Y | "Spaghetti" |
| sausage/frankfurter | Y | "Sausage" |
| cherry tomatoes | n | not named |
| red cabbage soup (borscht-style, bowl) | Y | "Soup": same name credited for the borscht bowl in qwenvl and runpod (consistency); bare "soup" would fail a fresh strict reading |
| bread bun | Y | "Bread roll" |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: Döner meat with sauce, French fries, Mixed salad, Beer, Pepsi

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y | "Döner meat with sauce" |
| tomato/chili sauce over the meat | n | "with sauce" names no sauce kind (strict rule 1; new name) |
| French fries | Y | "French fries" |
| iceberg lettuce salad | n | "Mixed salad" names nothing (rule 1) |
| sliced red onion | n | rule 1 |
| cucumber slices | n | rule 1 |
| pickled gherkin and pepperoncini | n | not named |
| **core recall (/7)** | 2/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 157/235 = 66.8% |
| hallucinations | 0 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 159 |
| cost / plate (auto) | $0.00102 |
| latency median s (auto) | 6.58 |

## Recall arithmetic

Per plate hits, all 50 plates (error plates in brackets):

01 6/6, 02 5/5, 03 8/8, 04 4/4, 05 2/2, 06 6/6, 07 2/5, 08 3/3, 09 1/1, [10 0/2], [11 0/3], 12 3/3, 13 2/2,
14 3/3, 15 3/3, 16 3/4, 17 3/4, [18 0/2], [19 0/5], [20 0/4], [21 0/6], 22 2/6, 23 3/4, 24 4/4, 25 6/7, 26 5/8,
27 2/5, 28 7/8, [29 0/4], 30 6/6, 31 3/3, 32 8/8, 33 5/5, 34 4/4, 35 8/8, 36 4/4, 37 3/3, 38 2/2, 39 3/3,
40 6/6, 41 3/3, 42 6/7, [43 0/7], [44 0/6], [45 0/8], 46 2/3, [47 0/5], 48 4/4, 49 5/6, 50 2/7.

- **All 50 plates: 157/235 = 66.8 %**, 95 % CI [54.1, 78.7].
- The 11 error plates hold 52 gold items, so the ceiling for this run was 183/235 (77.9 %).
- On the 39 answered plates only: 157/183 = 85.8 %, 95 % CI [77.3, 92.9]. This is a side number, not the cell's score.

## Hallucinations by plate

None. 0 hallucinations on the 39 answered plates (rule 6 input: 0).

Not hallucinations, recorded for completeness:

- 12: "Mixed salad" is the background plate, a trap leak (rule 3), as D3 and D2. Trap leaks: 1.
- 25 "Honey" (the syrup glass), 26 "Chicken Curry" (a curry bowl), 46 "Braised Bamboo Shoots with Vegetables" (the omasum cups) and "Steamed Tofu Skin" (the rolls): misnamed visible objects (rule 3).
- 30: photo checked, the chicken wing, pork belly slices, green peppers and cherry tomatoes are all on the board.

## Error and schema-invalid records

11 of 50 records carry no usable answer (schema-valid 39/50):

| ids | count | what happened |
|---|---|---|
| 10, 18, 19, 20, 21, 29, 43, 44, 45 | 9 | HTTP 429 from OpenRouter after 2 attempts: "google/gemini-2.5-flash-lite is temporarily rate-limited upstream", `limit_source: upstream_provider_shared_pool` (provider pin `google-vertex/eu`, no fallbacks) |
| 11 | 1 | HTTP 200, `finish_reason: error`, empty content, 0 completion tokens |
| 47 | 1 | HTTP 200, `finish_reason: error`, JSON cut off after about 2000 characters (3 items started), not parseable |

Plates 22 and 46 needed 2 attempts and then returned valid answers. `_summary.failures` is empty, so the
runner did not flag any of the 11 as a failure; only `schema_valid` and `error` show them.

**False unreadable: 0.** Every one of the 39 valid answers has `unreadable: false`, and every plate is readable.

## Bootstrap CI and paired difference against C3

Method: cluster percentile bootstrap over plates, the same estimator as `harness/stats.py`
(`bootstrap_recall_ci`, `bootstrap_diff_ci`), python stdlib `random.Random(7)`, 2000 resamples. Each resample
draws 50 plate indices with replacement; recall is the sum of hits over the sum of gold items of the drawn
plates; the CI is the 2.5th and 97.5th percentile with linear interpolation. The paired difference uses the same
drawn indices for both cells. C3 per plate hits come from the `core recall` rows of
`runs/v3-eu-cell-38-minimal-newprompt/scorecard-filled.md` (same 50 plates, same gold totals per plate).

| quantity | point | 95 % CI |
|---|---|---|
| this cell, 50 plates | 66.8 % (157/235) | [54.1, 78.7] |
| C3, 50 plates (same seed) | 84.7 % (199/235) | [78.2, 90.8] |
| **C3 minus this cell, paired, 50 plates** | **+17.9 points** | **[+4.6, +32.5]** |
| this cell, 39 answered plates | 85.8 % (157/183) | [77.3, 92.9] |
| C3, the same 39 plates | 82.5 % (151/183) | [74.3, 90.0] |
| C3 minus this cell, paired, 39 answered plates | -3.3 points | [-11.5, +5.1] |

On the 11 error plates C3 scored 48/52. The whole gap comes from the error records. On the plates this cell
answered, it is level with C3 (the interval includes 0).

## Judgment calls that were not obvious

| plate | call | effect if reversed |
|---|---|---|
| 16, 50 | "döner kebab meat with sauce", "Döner meat with sauce": a bare "with sauce" names no sauce kind, strict rule 1, n. Older sheets credited "grilled meat with sauce" (qwenvl 16, runpod 50) and "with sauce" for the dollop on 42 (A, E) | +2 |
| 28 | "Spicy Dipping Sauce" for the green herb chilli oil: n, the review reversed D3 "spicy sauce" for this row | +1 |
| 26 | "Chicken Curry" for the kofta or the paneer bowl: chicken is the wrong kind for either, n | +1 |
| 25 | "Honey" for the amber syrup shot glass: another food, n (rule 2) | +1 |
| 03 | "Greek Salad Mix" taken as the determinate dish Greek salad, so tomato, cucumber, lettuce and red onion are Y merged | -4 |
| 49 | "Soup" for the borscht bowl: Y only because qwenvl and runpod credited the same name; a fresh strict reading gives n | -1 |
| 42 | "cream sauce" names the dairy dollop, Y merged; "Sweetcorn" and the red cabbage item both go to one salad, the cucumber and lettuce salad stays n | -1 / +1 |

## Findings

1. Recall 157/235 = 66.8 % [54.1, 78.7], 0 hallucinations, 0 false unreadable, 11 of 50 records with no answer.
2. C3 minus this cell is +17.9 points [+4.6, +32.5], paired; the interval excludes 0. On the 39 answered plates
   the difference is -3.3 [-11.5, +5.1], so the identification quality is level with C3 and the loss is the
   upstream rate limit (9 records) and two `finish_reason: error` records.
3. A rerun of the 11 failed plates is the way to a fair score for this model. This file does not do that; it
   scores the run as recorded.
