# Plate-identification scoring worksheet

- results: `runs/v3-eu-cell-25-flash-newprompt/results.json`
- config: `eu-cell-25-flash-newprompt` (started 2026-10-06T11:29:56.290483+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`, STRICT reading of rule 1 (a generic label such as "greens", "spicy sauce", "vegetables", "meat", "cured meat assortment", "with sauce" earns no credit for a specific gold item). Cell: google/gemini-2.5-flash on the EU OpenRouter host, `only: google-vertex/eu`, reasoning `minimal`, v3 prompt. A model item name that an earlier filled scorecard judged for the same gold item got the same verdict, in this order: C3 (`v3-eu-cell-38-minimal-newprompt`), D3 (`v3-eu-cell-35-eu-newprompt`), `v3-eu-cell-25-lite-newprompt`, `v3-eu-cell-mistral-medium-newprompt`, then the other `runs/*/scorecard-filled.md` and the v2 sheets in `op-worktrees/prompt-v2`; where sheets disagree the EU line and the 2026-08-12 flips win. New names were judged fresh. Each note names the matched model item. Photos opened: 06, 26, 45. No model was called for this scoring. Error and schema-invalid records score n on every gold row of their plate: the app would have shown nothing.

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 49/50 |
| items named (total) | 227 |
| items named (mean/plate) | 4.54 |
| distinct item names | 208 |
| latency mean (s) | 15.32 |
| latency median (s) | 12.22 |
| latency max (s) | 137.89 |
| cost / plate (USD) | 0.005762 |
| cost total (USD) | 0.288125 |

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

- **production**: Dark bread slice, Ham slices, Small sausages, Scrambled eggs, Baked beans in tomato sauce, Cucumber slices, Dorina Margarine

| gold core item | production | notes |
|---|---|---|
| scrambled eggs | Y | "Scrambled eggs" |
| bacon/ham slices | Y | "Ham slices" (C3 "cooked ham or bacon slices", D3 "ham") |
| frankfurter sausages | Y | "Small sausages" (as "mini sausages", cloud and D) |
| baked beans in tomato sauce | Y | "Baked beans in tomato sauce" |
| brown bread slice | Y | "Dark bread slice" (as "brown bread", D3) |
| cucumber slices | Y | "Cucumber slices" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Dorina Margarine" is the optional margarine tub |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter/margarine packets

### 02, Roast (Sunday) dinner

- **production**: Roast meat with gravy, Yorkshire pudding, Roast potatoes, Mixed greens and broccoli

| gold core item | production | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y | "Roast meat with gravy" (A name) |
| Yorkshire pudding | Y | "Yorkshire pudding" |
| roast potatoes | Y | "Roast potatoes" |
| broccoli | Y | "Mixed greens and broccoli" names the broccoli |
| cabbage/greens | n | "Mixed greens" is a generic label (strict rule 1, "greens" named in the rule); E "mixed green vegetables" got n here as a bag label. The photo shows savoy cabbage |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **production**: Grilled salmon fillet, Mixed salad with avocado and olives, Feta cheese, Kalamata olives

| gold core item | production | notes |
|---|---|---|
| grilled salmon fillets | Y | "Grilled salmon fillet" |
| feta cheese | Y | "Feta cheese", named on its own |
| kalamata olives | Y | "Kalamata olives", named on its own |
| avocado | Y merged | "Mixed salad with avocado and olives" names the avocado |
| cherry tomatoes | n | "Mixed salad" is not the determinate dish "Greek salad" (rule 1; as D "salmon salad", E "mediterranean salad", D3 "mixed salad" on 35) |
| cucumber | n | rule 1, as above |
| lettuce/romaine | n | rule 1, as above |
| red onion | n | rule 1, as above |
| **core recall (/8)** | 4/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04, Cheeseburger with fries

- **production**: Cheeseburger, Potato wedges, Ketchup, Pickled gherkins, Beer

| gold core item | production | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y | "Cheeseburger" |
| thick-cut fries/steak fries | Y | "Potato wedges" for steak fries: cut, not kind (rule 2; gold 11 lists wedges with thick-cut fries) |
| ketchup | Y | "Ketchup" |
| pickles/gherkins | Y | "Pickled gherkins" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **production**: White rice with vegetables, Chicken and spinach stew

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | "Chicken and spinach stew" (C3 name) |
| white rice | Y | "White rice with vegetables": the vegetables are the optional pepper bits |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: Salmon and avocado sushi roll, White fish nigiri, Tuna nigiri, Pickled ginger (Gari), Wasabi, Soy sauce, White wine, Miso soup

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | "Salmon and avocado sushi roll" (25-lite name) |
| tuna nigiri | Y | "Tuna nigiri" |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | Y | "White fish nigiri" |
| pickled ginger | Y | "Pickled ginger (Gari)" |
| wasabi | Y | "Wasabi" |
| soy sauce | Y | "Soy sauce" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Miso soup": the black lacquer bowl at top left holds a dark liquid (photo opened), a soup referent, so not counted (rule 3); lfmvl counted a bare "miso" here as a hallucination in August. "White wine" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: Spaghetti with meat and vegetable sauce

| gold core item | production | notes |
|---|---|---|
| spaghetti | Y merged | "Spaghetti with meat and vegetable sauce" (D3 and A name) |
| ground beef/meat tomato sauce | Y merged | same item |
| corn kernels | n | "vegetable" names nothing (rule 1, as D3, A) |
| green beans | n | rule 1 |
| carrot pieces | n | rule 1 |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **production**: Plain yogurt, Granola, Apple slices

| gold core item | production | notes |
|---|---|---|
| yogurt | Y | "Plain yogurt" |
| granola (oats/puffed grains, nuts) | Y | "Granola" |
| apple slices | Y | "Apple slices" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **production**: Chicken and Cheese Pizza, Cola

| gold core item | production | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | "Chicken and Cheese Pizza" (C3 name) |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none | "Cola" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **production**: Chicken sandwich, Side salad with greens, Pepsi Max

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | "Chicken sandwich" (cloud name) |
| green side salad (rocket/mixed leaves) | Y | "Side salad with greens": the gold row is one generic salad, so the salad matches it (cloud precedent) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "Pepsi Max" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: Breaded cutlet, Potato wedges, Mixed salad with vinaigrette, Ketchup

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | Y | "Breaded cutlet": a meat cutlet, the gold kind (not the D, E "fish" miss) |
| thick-cut fries/potato wedges | Y | "Potato wedges" |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | "Mixed salad with vinaigrette": gold row is itself the consolidated salad |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Ketchup" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: Sausages with gravy, Mashed potatoes, Sauerkraut, Mixed side salad

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y | "Sausages with gravy" (as 25-lite "Sausages with sauce", kind right) |
| sauerkraut | Y | "Sauerkraut" |
| mashed potatoes | Y | "Mashed potatoes" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Mixed side salad" is the background plate: trap leak, not a hallucination (rule 3), as D3, D2, 25-lite. Trap leaks: 1 |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: Käsespätzle with fried onions, Mixed green salad with dressing

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y merged | "Käsespätzle with fried onions" (C3, A name) |
| fried/caramelised onions | Y merged | same item names the onions |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | the salad is the optional side plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: Beef stew with potatoes, Green salad

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y merged | "Beef stew with potatoes" (qwenvl, 25-lite name) |
| boiled potatoes | Y merged | same item |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "Green salad" (D3 name) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: (none)  _[schema-invalid; error: API error in a 200 body: {"message": "Provider returned error", "code": 429, "metadata": {"error_type": "rate_limit_exceeded", "provider_code": "429"}}]_

| gold core item | production | notes |
|---|---|---|
| Weisswurst sausages in hot water | n | no answer: HTTP 200 with a 429 rate-limit error in the body after 2 attempts (schema-invalid) |
| pretzel (Brezel) | n | no answer |
| sweet mustard | n | no answer |
| **core recall (/3)** | 0/3 |  |
| **hallucinations** | n/a | error record, no answer |
| **over-decomposed** | 0 |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16, Döner/gyros plate with fries and salad

- **production**: Döner Kebab with tomato sauce, French fries, Mixed side salad with dressing and pickled pepper, Beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | Y merged | "Döner Kebab with tomato sauce" |
| tomato sauce over the meat | Y merged | same item names the tomato sauce |
| French fries | Y | "French fries" |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | "Mixed side salad with dressing and pickled pepper": gold row is itself the consolidated salad (25-lite name, near word for word) |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: French fries, Currywurst with sauce

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y merged | "Currywurst with sauce" (C3, A, 25-lite name) |
| curry ketchup sauce | Y merged | sauce entailed by the named dish (precedent) |
| curry powder | n | curry dusting not named |
| French fries | Y | "French fries" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: Maultaschen (Swabian dumplings), Creamy Potato Salad

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "Maultaschen (Swabian dumplings)" |
| potato salad | Y | "Creamy Potato Salad" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: French fries, Mayonnaise, Kebab meat, Yogurt sauce, Currywurst

| gold core item | production | notes |
|---|---|---|
| French fries | Y | "French fries" |
| gyros/döner sliced meat | Y | "Kebab meat" (as cloud "kebab meat" on 50) |
| sliced sausage in curry/shashlik sauce | Y | "Currywurst" (cloud name) |
| tzatziki/garlic yogurt sauce | Y | "Yogurt sauce" (qwenvl name) |
| mayonnaise | Y | "Mayonnaise", its own item (D3, A) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 20, Bowl of shio ramen

- **production**: Ramen with Chashu Pork, Mizuna greens

| gold core item | production | notes |
|---|---|---|
| ramen noodles | Y merged | "Ramen with Chashu Pork" |
| clear (shio) broth | Y merged | the named dish ramen is noodles in broth (runpod "ramen", C3 "ramen soup") |
| sliced chashu pork | Y merged | same item names the chashu |
| leafy green herb topping (mizuna/mitsuba) | Y | "Mizuna greens" names the mizuna, so not the generic "greens" that the strict reading rejects |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **production**: Beef Pho, Pho garnishes (bean sprouts and herbs), Rice vermicelli, Tea

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y merged | "Beef Pho" |
| sliced beef and beef meatballs | Y merged | pho names the beef (rule 1 example) |
| bean sprouts | Y merged | "Pho garnishes (bean sprouts and herbs)" |
| Thai basil | Y merged | same item, "herbs" for the Thai basil, the only herb on the plate (precedent "fresh herbs": A, E, qwenvl, runpod, mistral) |
| sliced green chilli/jalapeño | n | not named |
| spring onion | n | not named |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | "Rice vermicelli" is the optional extra noodle bowl, "Tea" the optional drink |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: Tacos with beef and cheese, Grilled corn on the cob, Cola drink

| gold core item | production | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y merged | "Tacos with beef and cheese" |
| grated cheese | Y merged | same item names the cheese |
| red salsa | n | no salsa named |
| green salsa/tomatillo | n | not named |
| coriander/cilantro | n | not named |
| grilled corn on the cob | Y | "Grilled corn on the cob" |
| **core recall (/6)** | 3/6 |  |
| **hallucinations** | none | "Cola drink" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **production**: Smothered burrito

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | Y merged | "Smothered burrito" (25-lite, D2 name) |
| green chile sauce | Y merged | "smothered" entails the sauce (precedent) |
| shredded cheddar/jack cheese | n | cheese not named |
| shredded lettuce | n | lettuce not named |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **production**: Battered Fish Fillet, French Fries, Green Peas, Tartar Sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish fillet | Y | "Battered Fish Fillet" |
| chips/thick-cut fries | Y | "French Fries" |
| green peas | Y | "Green Peas" |
| tartar sauce | Y | "Tartar Sauce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge

### 25, American breakfast platter

- **production**: Pancakes with powdered sugar, Fried egg, Bacon strips, Breakfast sausages, Hash browns, White toast, Maple syrup, Butter or margarine packet

| gold core item | production | notes |
|---|---|---|
| pancakes with icing sugar | Y | "Pancakes with powdered sugar" |
| back bacon rashers | Y | "Bacon strips" (as "bacon", 25-lite, runpod) |
| fried egg (sunny side up) | Y | "Fried egg" |
| breakfast sausages | Y | "Breakfast sausages" |
| hash brown/potato croquettes | Y | "Hash browns" |
| toast slices | Y | "White toast" |
| maple syrup in a shot glass | Y | "Maple syrup" |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none | "Butter or margarine packet" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **production**: Seasoned rice, Flatbread, Plain yogurt, Mixed vegetable soup, Vegetable curry (orange), Dal (lentil stew), Vegetable curry (brown), Mixed vegetable salad, Papadum

| gold core item | production | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | "Seasoned rice" |
| chapati/roti | Y | "Flatbread" (cloud name) |
| papad (papadum) | Y | "Papadum" |
| curd/raita | Y | "Plain yogurt" |
| dal (lentil curry) | Y | "Dal (lentil stew)" |
| kofta/dumpling curry in orange gravy | n | "Vegetable curry (orange)" for the kofta or the paneer bowl (both orange, photo): names neither the dumplings nor the paneer, strict rule 1; no precedent for this name on this row |
| paneer or fish curry in pale gravy | n | no paneer or fish token; the one orange vegetable curry cannot cover two bowls |
| brinjal/eggplant curry | Y | "Vegetable curry (brown)" is the dark eggplant bowl (photo); "vegetable curry" for the eggplant curry is the D, C2, B2, 25-lite precedent |
| **core recall (/8)** | 6/8 |  |
| **hallucinations** | none | "Mixed vegetable soup", "Mixed vegetable salad" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **production**: Chicken and Cashew Stir-fry, Steamed White Rice

| gold core item | production | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y | "Chicken and Cashew Stir-fry" (as "chicken cashew stir-fry") |
| red bell pepper strips | n | no vegetable named |
| onion | n | not named |
| spring onion/green onion | n | not named |
| steamed white rice | Y | "Steamed White Rice" |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): dried chilli bits

### 28, Middle-Eastern mezze spread, four composed plates plus flatbread

- **production**: Falafel, Bulgur salad, Lentil salad, Hummus, Beetroot salad, Shredded cabbage salad, Carrot salad, Mixed olives, Pickled turnips, Pita bread, Chili dipping sauce

| gold core item | production | notes |
|---|---|---|
| falafel balls | Y | "Falafel" |
| grilled flatbread | Y | "Pita bread" (cloud, 25-lite name) |
| hummus/creamy white dip | Y | "Hummus" |
| green herb-chilli sauce | Y | "Chili dipping sauce" names the chilli, as D2 "spicy chili dipping sauce" and E "chili oil" (Y); the strict reversal hit D3 "spicy sauce" and 25-lite "Spicy Dipping Sauce", which name no kind |
| yellow bulgur or couscous | Y | "Bulgur salad" |
| black beluga lentils | Y | "Lentil salad" (as B2 "Cooked lentils", D3 "lentils") |
| pickled white cabbage slaw | Y | "Shredded cabbage salad" (25-lite name; pickling is prep, rule 2) |
| green olives | Y | "Mixed olives" (as "Olives", 25-lite, runpod) |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none | "Beetroot salad", "Carrot salad", "Pickled turnips" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: Wheat Beer, Pickles with mustard sauce, Salami slices, Cheese cubes, Green olives

| gold core item | production | notes |
|---|---|---|
| pickled gherkin slices | Y | "Pickles with mustard sauce" (as D3 "pickles and dip") |
| salami slices | Y | "Salami slices" |
| cheese cubes | Y | "Cheese cubes" |
| green olives | Y | "Green olives" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Wheat Beer" optional; "mustard sauce" is the creamy dip misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30, Mixed grill board (plancha de grillades)

- **production**: Mixed green salad, Stuffed baked potato, Grilled steak, Grilled seasoned pork ribs, Grilled sausage, Grilled meat skewer with vegetables, Grilled bacon strips

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | Y | "Grilled seasoned pork ribs" |
| grilled beef steak | Y | "Grilled steak" |
| grilled sausage | Y | "Grilled sausage" |
| grilled meat skewer with green pepper and tomato | Y | "Grilled meat skewer with vegetables" (skewer named, as cloud "skewers") |
| baked/roasted potato with browned cheese topping | Y | "Stuffed baked potato" (cloud name) |
| mixed leaf salad | Y | "Mixed green salad" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Grilled bacon strips": the pork belly slices on the board (25-lite photo check), rule 3 |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cherry tomato, steak knife

### 31, Bowl of beef/oxtail soup with buttered bread

- **production**: Beef stew, Whole grain bread with butter

| gold core item | production | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged | "Beef stew" (25-lite, runpod, qwenvl name) |
| beef (oxtail) chunks | Y merged | same item |
| buttered bread slices (dark/whole-grain) | Y | "Whole grain bread with butter" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **production**: Green olives, Cucumber sticks, Carrot sticks, Yellow bell pepper strips, Red bell pepper strips, Deviled eggs, Hummus, Blue cheese with herbs, Cheddar cheese, Salami slices, Savory crackers

| gold core item | production | notes |
|---|---|---|
| green olives | Y | "Green olives" |
| cucumber sticks | Y | "Cucumber sticks" |
| carrot sticks | Y | "Carrot sticks" |
| bell pepper strips | Y | "Yellow bell pepper strips", "Red bell pepper strips" |
| pan-fried spiced hard-boiled egg halves | Y | "Deviled eggs" (deviled for spiced egg is prep, rule 2) |
| hummus dip | Y | "Hummus" |
| salami/cured meat slices | Y | "Salami slices" |
| cheese slices | Y | "Cheddar cheese", "Blue cheese with herbs" (25-lite name) |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none | "Savory crackers" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **production**: Cooked oatmeal, Peanut butter, Raisins, Cinnamon powder

| gold core item | production | notes |
|---|---|---|
| oatmeal/oat porridge | Y | "Cooked oatmeal" |
| peanut butter | Y | "Peanut butter" |
| raisins | Y | "Raisins" |
| ground cinnamon | Y | "Cinnamon powder" |
| milk | n | not named |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: Waffle, Strawberry topping, Whipped cream

| gold core item | production | notes |
|---|---|---|
| waffles | Y | "Waffle" |
| strawberries (sliced fresh) | Y | "Strawberry topping" credits one row, the strawberries (C3 name, identical) |
| strawberry/berry syrup-compote | n | one token, one row (C3 call) |
| whipped cream | Y | "Whipped cream" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **production**: Doner Kebab Meat with Yogurt Sauce, French Fries, Mixed Salad

| gold core item | production | notes |
|---|---|---|
| gyros/döner sliced meat | Y merged | "Doner Kebab Meat with Yogurt Sauce" |
| French fries | Y | "French Fries" |
| white garlic-yogurt sauce (tzatziki) with oregano | Y merged | same item, "Yogurt Sauce" (qwenvl, 25-lite name) |
| shredded white cabbage | n | "Mixed Salad" names no part (rule 1, as D3 "mixed salad") |
| tomato slices | n | rule 1 |
| sweetcorn | n | rule 1 |
| cucumber slices | n | rule 1 |
| shredded carrot | n | rule 1 |
| **core recall (/8)** | 3/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: Seafood paella with artichoke

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | Y merged | "Seafood paella with artichoke" |
| whole prawns (langostinos) | Y merged | paella names the prawns (rule 1 example) |
| mantis shrimp (galeras) | Y merged | "seafood paella" covers the mantis shrimp (cloud, D3 precedent; C3 "seafood and artichoke paella" Y) |
| artichoke pieces | Y merged | same item names the artichoke |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: Pierogi with potato and cheese filling and fried onions, Cabbage and carrot slaw

| gold core item | production | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y merged | "Pierogi with potato and cheese filling and fried onions" |
| fried caramelised onion topping | Y merged | same item names the onions |
| grated carrot and cabbage salad | Y | "Cabbage and carrot slaw" (C3, A name) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **production**: Beef burger, French fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | "Beef burger" (A, C name) |
| French fries | Y | "French fries" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: Baked beans, Pork sausages, Fried bacon

| gold core item | production | notes |
|---|---|---|
| baked beans in tomato sauce | Y | "Baked beans" (D3 name) |
| sausage pieces | Y | "Pork sausages" (D3 name) |
| bacon rasher | Y | "Fried bacon" (25-lite name) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **production**: Beef and liver stew, Cooked sausage, French fries, Fried egg with runny yolk, Cooked bacon slices, Grilled tomato

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | Y | "Beef and liver stew" names the organ (as D3 "beef stew and liver") |
| chips/French fries | Y | "French fries" |
| bacon/gammon slice | Y | "Cooked bacon slices" |
| fried egg (remnant, yolk visible) | Y | "Fried egg with runny yolk" |
| sausage | Y | "Cooked sausage" |
| grilled tomato half | Y | "Grilled tomato" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: Battered fried fish, Potato wedges, Mayonnaise

| gold core item | production | notes |
|---|---|---|
| battered fried fish (cod), partly eaten | Y | "Battered fried fish" (C3 name) |
| potato wedges/skin-on roast potatoes | Y | "Potato wedges" |
| tartar sauce / mayonnaise dollop | Y | "Mayonnaise" (D3, cloud name) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **production**: Fried fish fillet with creamy sauce, White rice, Chickpea curry, Meatballs with gravy, Mashed potatoes with tomato sauce, Corn kernels, Red cabbage salad, Cucumber and lettuce salad with pickled pepper

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | Y merged | "Fried fish fillet with creamy sauce" |
| sour cream / remoulade dollop | Y merged | "creamy sauce" names the dairy dollop on the fish (25-lite "cream sauce") |
| meatballs in brown gravy | Y | "Meatballs with gravy" |
| chickpea-and-cauliflower curry | Y | "Chickpea curry" |
| white rice | Y | "White rice" |
| red cabbage and sweetcorn salad | Y | "Red cabbage salad" plus "Corn kernels" (as 25-lite "Mixed salad with red cabbage and onion" plus "Sweetcorn") |
| cucumber and lettuce salad | Y | "Cucumber and lettuce salad with pickled pepper", its own item |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none | "Mashed potatoes with tomato sauce" is the optional tomato-sauced bake |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set, main plate, soup bowl, bread plate

- **production**: Creamy soup with bacon bits, Bread with butter, Fish cakes with mayonnaise, Green beans, Green rice, Pasta salad with ham, Potato gratin, Coleslaw

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | "Fish cakes with mayonnaise" |
| herbed green rice | Y | "Green rice" |
| green beans | Y | "Green beans" |
| cheese-topped quiche/gratin square | Y | "Potato gratin": gold row accepts a gratin square |
| creamy meat-and-vegetable stew | n | "Pasta salad with ham" is the C2, B2 misread of the stew, miss |
| creamy soup (bowl, with bacon bits) | Y | "Creamy soup with bacon bits" |
| bread roll with butter | Y | "Bread with butter" |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none | "Coleslaw" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: Mixed green salad, Cooked beans, Yellow rice, Cooked cabbage, Braised pork

| gold core item | production | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | "Mixed green salad" (D3 name) |
| brown beans (feijão) in broth | Y | "Cooked beans" (D name) |
| yellow seasoned rice | Y | "Yellow rice" |
| braised cabbage with tomato | Y | "Cooked cabbage" (cloud name; tomato not named) |
| stewed meat in onion gravy | Y | "Braised pork" (as D3 "braised pork dish") |
| mashed cassava/potato purée | n | no purée named |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45, Korean hanjeongsik table spread (dozens of banchan, top-down)

- **production**: Green chili peppers, Dried seaweed sheets, Rice paper or thin pancake, Seasoned spinach (Sigeumchi-namul), Soy-glazed peanuts or beans, Lotus root (Yeongeun-jorim), Japchae (Glass noodle stir-fry), Braised beef short ribs (Galbi-jjim), Steamed egg (Gyeran-jjim), Kimchi (fermented cabbage), Grilled mackerel (Godeungeo-gui), Tofu with spicy sauce, Korean pancakes (Jeon), Spicy radish kimchi (Kkakdugi), Fermented soybean paste (Doenjang), Gochujang (Korean chili paste), Soy sauce with chili flakes, White rice soup, Raw fish sashimi (Hwe), Pickled cucumber or radish (Oi-muchim), Mushroom and vegetable banchan

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | Y | "Japchae (Glass noodle stir-fry)" |
| steamed egg (gyeranjjim) in stone pot | Y | "Steamed egg (Gyeran-jjim)" |
| grilled mackerel/fish | Y | "Grilled mackerel (Godeungeo-gui)" |
| stir-fried beef in a hot stone pot | Y | "Braised beef short ribs (Galbi-jjim)", portion "small hot pot": the beef in the stone pot (photo); beef kind right, braised for stir-fried is prep (rule 2) |
| glazed spicy braised ribs/pork | n | no item for the glazed pork plate; the one beef token goes to the stone pot (one token, one row) |
| sliced raw fish (hoe/sashimi) on shredded radish | Y | "Raw fish sashimi (Hwe)" |
| vegetable fritters/jeon platter | Y | "Korean pancakes (Jeon)" |
| kimchi | Y | "Kimchi (fermented cabbage)" |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none | photo opened: chili peppers, the white triangle and dark leaves in the basket, spinach namul, peanuts, lotus root, tofu, radish kimchi, dip bowls, the white porridge pot, pickles and the mushroom bowl all have referents (optional dishes); no empty bowl named as rice |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: Steamed Tofu Skin Rolls, Braised Beef Tripe, Pickled Bamboo Shoots with Carrots

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | "Braised Beef Tripe": one tripe token goes to the honeycomb cups (precedent) |
| white boiled tripe/omasum slices in broth | n | "Pickled Bamboo Shoots with Carrots" is the omasum cups misnamed (as 25-lite "Braised Bamboo Shoots with Vegetables"), plant for organ, kind miss |
| fried beancurd-skin rolls (tofu skin rolls) | Y | "Steamed Tofu Skin Rolls" (frying lost, form) |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | "Pickled Bamboo Shoots with Carrots" is the misnamed omasum cups (rule 3); no dumplings or buns named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: Smoothie bowl with fruit and granola, Beetroot latte, Iced latte, Eggs Benedict with cherry tomatoes, Avocado toast with poached egg and cherry tomatoes, Chocolate donut with sesame seeds, Passion fruit juice, White wine

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y merged | "Avocado toast with poached egg and cherry tomatoes" |
| eggs benedict with hollandaise on avocado toast | Y merged | "Eggs Benedict with cherry tomatoes" |
| yogurt bowl with granola, kiwi slices and berry compote | Y | "Smoothie bowl with fruit and granola": names the granola (D3 "acai bowl with fruit" was a miss for naming neither granola nor kiwi; C3 and A "smoothie bowl with kiwi and granola" Y) |
| cherry tomato salad with balsamic drizzle | Y merged | "with cherry tomatoes" on the toast and the benedict covers the tomato salad (C3, A, C, E consolidation) |
| seeded bagel (dark, sesame-topped) | Y | "Chocolate donut with sesame seeds" for the dark sesame bagel: ring-shaped baked good, form error (rule 2), as runpod "chocolate donut" Y and qwenvl "chocolate sesame donut" Y? |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none | four drinks optional; "Chocolate donut" is the bagel misnamed (rule 3); no menu-card item named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: Potato chips, White cake with frosting, White bread sandwich, Samosas

| gold core item | production | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | "White bread sandwich" |
| potato chips/crisps | Y | "Potato chips" |
| samosas (small fried triangles) | Y | "Samosas" |
| slice of white/vanilla cake with icing, partly eaten | Y | "White cake with frosting" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49, Cafe sizzling-plate dinner set

- **production**: Grilled Steak with Sauce, Hot Dog Sausage, Spaghetti, Bread Roll, Soup

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y | "Grilled Steak with Sauce" (as "Steak with sauce", 25-lite, qwenvl, runpod) |
| spaghetti (plain, buttered) | Y | "Spaghetti" |
| sausage/frankfurter | Y | "Hot Dog Sausage" |
| cherry tomatoes | n | not named |
| red cabbage soup (borscht-style, bowl) | Y | "Soup": same bare name credited for the borscht bowl in 25-lite, qwenvl, runpod (consistency) |
| bread bun | Y | "Bread Roll" |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: Doner kebab with sauce, French fries, Side salad with dressing, Beer, Pepsi

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y | "Doner kebab with sauce" |
| tomato/chili sauce over the meat | n | "with sauce" names no sauce kind (strict rule 1, as 25-lite "Döner meat with sauce") |
| French fries | Y | "French fries" |
| iceberg lettuce salad | n | "Side salad with dressing" names no part (rule 1) |
| sliced red onion | n | rule 1 |
| cucumber slices | n | rule 1 |
| pickled gherkin and pepperoncini | n | not named |
| **core recall (/7)** | 2/7 |  |
| **hallucinations** | none | "Beer", "Pepsi" optional; nothing from the background plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 194/235 = 82.6% |
| hallucinations | 0 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 208 |
| cost / plate (auto) | $0.00576 |
| latency median s (auto) | 12.22 |

## Recall arithmetic

Per plate hits, all 50 plates (the error plate in brackets):

01 6/6, 02 4/5, 03 4/8, 04 4/4, 05 2/2, 06 6/6, 07 2/5, 08 3/3, 09 1/1, 10 2/2, 11 3/3, 12 3/3, 13 2/2,
14 3/3, [15 0/3], 16 4/4, 17 3/4, 18 2/2, 19 5/5, 20 4/4, 21 4/6, 22 3/6, 23 2/4, 24 4/4, 25 7/7, 26 6/8,
27 2/5, 28 8/8, 29 4/4, 30 6/6, 31 3/3, 32 8/8, 33 4/5, 34 3/4, 35 3/8, 36 4/4, 37 3/3, 38 2/2, 39 3/3,
40 6/6, 41 3/3, 42 7/7, 43 6/7, 44 5/6, 45 7/8, 46 2/3, 47 5/5, 48 4/4, 49 5/6, 50 2/7.

- **All 50 plates: 194/235 = 82.6 %**, 95 % CI [75.1, 89.6].
- The error plate holds 3 gold items, so the ceiling for this run was 232/235 (98.7 %).
- On the 49 answered plates only: 194/232 = 83.6 %, 95 % CI [76.1, 90.5]. This is a side number, not the cell's score.

## Hallucinations by plate

None. **0 hallucinations** on the 49 answered plates (rule 6 input: 0).

Not hallucinations, recorded for completeness:

- 12: "Mixed side salad" is the background plate, a trap leak (rule 3), as D3, D2 and 25-lite. **Trap leaks: 1.**
- 06: "Miso soup". The black lacquer bowl at the top left holds a dark liquid (photo opened), so the soup has a referent off the plate (rule 3). The August lfmvl sheet counted a bare "miso" on this plate as a hallucination. Under that reading the count is 1.
- Misnamed visible objects (rule 3): 29 "mustard sauce" (the creamy dip), 30 "Grilled bacon strips" (the pork belly slices on the skewer), 46 "Pickled Bamboo Shoots with Carrots" (the omasum cups), 47 "Chocolate donut with sesame seeds" (the bagel).
- 45: photo opened. Every one of the 21 names has a referent, and no empty bowl is named as rice.

## Error and schema-invalid records

1 of 50 records carries no usable answer (schema-valid 49/50):

| id | count | what happened |
|---|---|---|
| 15 | 1 | HTTP 200 with an error in the body after 2 attempts: `"Provider returned error", "code": 429, "error_type": "rate_limit_exceeded"` (provider pin `google-vertex/eu`, no fallbacks), 137.9 s wall time |

Plates 07, 16, 24 and 40 needed 2 attempts and then returned valid answers (`finish_reason: stop`).
`_summary.failures` is empty, so the runner did not flag plate 15 as a failure; only `schema_valid` and `error` show it.

**False unreadable: 0.** Every one of the 49 valid answers has `unreadable: false`, and every plate is readable.

## Bootstrap CI and paired difference against C3

Method: cluster percentile bootstrap over plates, the same estimator as `harness/stats.py`
(`bootstrap_recall_ci`, `bootstrap_diff_ci`), python stdlib `random.Random(7)`, 2000 resamples. Each resample
draws 50 plate indices with replacement; recall is the sum of hits over the sum of gold items of the drawn
plates; the CI is the 2.5th and 97.5th percentile with linear interpolation. The paired difference uses the same
drawn indices for both cells. C3 per plate hits come from the `core recall` rows of
`runs/v3-eu-cell-38-minimal-newprompt/scorecard-filled.md` (same 50 plates, same gold totals per plate). A
separate stdlib reimplementation and the harness functions gave the same bounds.

| quantity | point | 95 % CI |
|---|---|---|
| this cell, 50 plates | 82.6 % (194/235) | [75.1, 89.6] |
| C3, 50 plates (same seed) | 84.7 % (199/235) | [78.2, 90.8] |
| **C3 minus this cell, paired, 50 plates** | **+2.1 points** | **[-6.6, +10.9]** |
| this cell, 49 answered plates | 83.6 % (194/232) | [76.1, 90.5] |
| C3, the same 49 plates | 84.5 % (196/232) | [77.5, 90.7] |
| C3 minus this cell, paired, 49 answered plates | +0.9 points | [-7.4, +8.8] |

The interval includes 0 in both rows. Plates where the two cells differ (C3 minus this cell, in hits):
02 +1, 03 +4, 06 -3, 15 +3, 20 -1, 22 -1, 23 +2, 26 +2, 28 -5, 30 -1, 32 -3, 35 +3, 42 -2, 44 +1, 45 +1,
46 +1, 50 +3.

Sensitivity to the closest calls (same method):

| variant | hits, recall | 95 % CI | C3 minus this cell [95 % CI] |
|---|---|---|---|
| as filled | 194/235 = 82.6 % | [75.1, 89.6] | +2.1 [-6.6, +10.9] |
| stricter: 21 basil, 28 sauce, 47 bowl, 47 bagel to n | 190/235 = 80.9 % | [73.4, 88.0] | +3.8 [-4.6, +12.3] |
| more lenient: 02 greens, 26 kofta to Y | 196/235 = 83.4 % | [75.8, 90.3] | +1.3 [-7.1, +9.8] |

## Judgment calls that were not obvious

| plate | call | verdict | why unsure |
|---|---|---|---|
| 02 | "Mixed greens and broccoli" for cabbage/greens | n | the gold row itself says "greens", but strict rule 1 names "greens" as generic, and E "mixed green vegetables" got n here |
| 28 | "Chili dipping sauce" for the green herb-chilli sauce | Y | names the chilli, as D2 "spicy chili dipping sauce" and E "chili oil" (Y); 25-lite "Spicy Dipping Sauce" (no kind) got n |
| 47 | "Smoothie bowl with fruit and granola" for the yogurt bowl | Y | names the granola, not the kiwi; D3 "acai bowl with fruit" was a miss for naming neither |
| 26 | "Vegetable curry (orange)" for the kofta curry | n | the orange bowl is the kofta or the paneer bowl; "vegetable curry" names neither, but vegetable kofta exists |
| 06 | "Miso soup" not counted as a hallucination | 0 | a lacquer soup bowl with dark liquid sits off the plate; lfmvl counted bare "miso" here as a hallucination |
| 47 | "Chocolate donut with sesame seeds" for the seeded bagel | Y | form error by runpod and qwenvl precedent; a fresh strict reading could call chocolate donut another food |
| 21 | "herbs" for the Thai basil | Y | kept for consistency with "fresh herbs" (A, E, mistral); strict rule 1 alone would say n |
| 45 | "Braised beef short ribs (Galbi-jjim)" to the beef stone pot, not the glazed pork ribs | Y on one row | the portion hint "small hot pot" decides; either row gives 7/8 |

## Findings

1. Recall 194/235 = 82.6 % [75.1, 89.6], 0 hallucinations, 1 trap leak (12), 0 false unreadable, 1 of 50 records with no answer (15, upstream 429).
2. C3 minus this cell is +2.1 points [-6.6, +10.9], paired; the interval includes 0. On the 49 answered plates the difference is +0.9 [-7.4, +8.8].
3. The main losses against C3 are generic salad labels (03 "Mixed salad", 35 "Mixed Salad", 50 "Side salad with dressing"), the error plate 15 and the unnamed paneer and kofta curries on 26. The main gains are the itemised mezze on 28 (8/8) and the crudites on 32 (8/8).
