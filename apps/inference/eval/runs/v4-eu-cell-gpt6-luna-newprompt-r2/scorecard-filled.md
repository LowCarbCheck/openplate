# Plate-identification scoring worksheet

- results: `runs/v4-eu-cell-gpt6-luna-newprompt-r2/results.json`
- config: `eu-cell-gpt6-luna-newprompt` (started 2026-10-06T13:18:15.514802+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
- prefill: 78 Y, 3 n, 0 conflicts, 154 need judgment, from 16 earlier sheets

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 204 |
| items named (mean/plate) | 4.08 |
| distinct item names | 182 |
| latency mean (s) | 14.37 |
| latency median (s) | 13.33 |
| latency max (s) | 30.18 |
| cost / plate (USD) | 0.000895 |
| cost total (USD) | 0.044735 |

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

- **production**: Rye bread, Cooked ham, Sausages, Baked beans in tomato sauce, Scrambled eggs, Cucumber, Margarine

| gold core item | production | notes |
|---|---|---|
| scrambled eggs | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Scrambled eggs" |
| bacon/ham slices | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "cooked ham" |
| frankfurter sausages | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "sausages", kind right |
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Baked beans in tomato sauce" |
| brown bread slice | Y | "Rye bread": dark bread, kind right (r1 "dark wholegrain bread") |
| cucumber slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "cucumber" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Margarine" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter/margarine packets

### 02, Roast (Sunday) dinner

- **production**: Braised chicken with gravy, Roasted potatoes, Mixed vegetables with sauce

| gold core item | production | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | n | "Braised chicken with gravy": chicken for lamb/beef, species miss (rule 2, as r1) |
| Yorkshire pudding | n | not named |
| roast potatoes | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Roasted potatoes" |
| broccoli | n | "Mixed vegetables with sauce" names no vegetable (strict rule 1, as r1) |
| cabbage/greens | n | "Mixed vegetables with sauce", strict rule 1 |
| **core recall (/5)** | 1/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **production**: grilled salmon, mixed salad with cucumber, tomato, lettuce and red onion, feta cheese, Kalamata olives

| gold core item | production | notes |
|---|---|---|
| grilled salmon fillets | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "grilled salmon" |
| feta cheese | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Feta cheese", named on its own |
| kalamata olives | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Kalamata olives", named on its own |
| avocado | n | not named; the salad item names cucumber, tomato, lettuce and red onion only |
| cherry tomatoes | Y merged | "mixed salad with cucumber, tomato, lettuce and red onion" names the tomato (r1 call) |
| cucumber | Y merged | same item names the cucumber |
| lettuce/romaine | Y merged | same item names the lettuce (r1 scored n only because its salad named no leaf) |
| red onion | Y merged | same item names the red onion |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04, Cheeseburger with fries

- **production**: Cheeseburger, French fries, Ketchup, Pickles, Beer

| gold core item | production | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Cheeseburger" |
| thick-cut fries/steak fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "french fries" |
| ketchup | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Ketchup" |
| pickles/gherkins | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Pickles" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **production**: cooked white rice, beef and mushroom stew

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | n | "beef and mushroom stew": beef for chicken, species miss (rule 2, as r1) |
| white rice | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "cooked white rice" |
| **core recall (/2)** | 1/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: assorted sushi rolls, salmon sashimi, tuna sashimi, white fish sashimi, soy sauce

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Assorted sushi rolls": the roll is named, filling not |
| tuna nigiri | n | "tuna sashimi" for tuna nigiri: rule 4, sashimi for nigiri is a miss (r1, photo: fish on rice) |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | n | "white fish sashimi" for the white-fish nigiri: rule 4 |
| pickled ginger | n | not named |
| wasabi | n | not named |
| soy sauce | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Soy sauce" |
| **core recall (/6)** | 2/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: Stir-fried wheat noodles with sauce, Minced meat, Mixed vegetables

| gold core item | production | notes |
|---|---|---|
| spaghetti | Y | "Stir-fried wheat noodles with sauce": wheat noodles for spaghetti, form (rule 2, as r1 "Stir-fried noodles") |
| ground beef/meat tomato sauce | Y | "Minced meat": the gold row accepts meat with no animal ("beef/meat"); r1 "Cooked ground beef" |
| corn kernels | n | "Mixed vegetables" names no vegetable (strict rule 1); the corn in the model notes is not an item (r1 call on 02) |
| green beans | n | "Mixed vegetables", strict rule 1 |
| carrot pieces | n | "Mixed vegetables", strict rule 1 |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **production**: granola with nuts, apple slices

| gold core item | production | notes |
|---|---|---|
| yogurt | n | prefill n from v4-eu-cell-gpt6-luna-newprompt-r1: no reported item covered it |
| granola (oats/puffed grains, nuts) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "granola with nuts" |
| apple slices | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Apple slices" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **production**: chicken and cheese pizza

| gold core item | production | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Chicken and Cheese Pizza" (C3 name) |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **production**: Chicken salad sandwiches, Cola, Coffee

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | "Chicken salad sandwiches": creamy chicken filling, sandwich named (r1 "Chicken sandwich") |
| green side salad (rocket/mixed leaves) | n | not named; the model notes say the lettuce garnish is not listed |
| **core recall (/2)** | 1/2 |  |
| **hallucinations** | none | "Cola", "Coffee" optional drinks |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: breaded fried fish with lemon and capers, French fries, mixed salad, ketchup

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | n | "breaded fried fish with lemon and capers": fish for pork/veal, species miss (rule 2, as r1) |
| thick-cut fries/potato wedges | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "French fries" |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | "mixed salad": the gold row is itself the consolidated salad (r1, 31-lite precedent; "mixed salad" Y on 44) |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | "ketchup" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: cooked sausages, creamy pasta, mashed potatoes, mixed salad, fries

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y | "cooked sausages" (r1 "Sausages with brown gravy") |
| sauerkraut | n | "creamy pasta" is the sauerkraut misread (r1, photo), kind miss; misnamed, not a hallucination |
| mashed potatoes | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Mashed potatoes" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | trap leak, not counted: "mixed salad" and "fries" are from the background plate (the model notes say so); "creamy pasta" is the sauerkraut misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: creamy pasta, glazed grilled meat strips, mixed green salad

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Creamy pasta": noodles in a cheese sauce, regional name lost (as 25-lite "Cheesy noodles") |
| fried/caramelised onions | n | "glazed grilled meat strips" is the onion heap ("a small pile on top"), kind miss (r1) |
| **core recall (/2)** | 1/2 |  |
| **hallucinations** | none | "glazed grilled meat strips" is the onion heap misnamed (rule 3); "mixed green salad" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: Beef and potato stew with gravy, Leaf lettuce

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y merged | "Beef and potato stew with gravy" |
| boiled potatoes | Y merged | same item names the potatoes |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "Leaf lettuce" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: Bavarian white sausages, Sweet Bavarian mustard, Large salted pretzel, Amber beer

| gold core item | production | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y | "Bavarian white sausages" |
| pretzel (Brezel) | Y | "Large salted pretzel" |
| sweet mustard | Y | "Sweet Bavarian mustard" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Amber beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16, Döner/gyros plate with fries and salad

- **production**: French fries, Beef in tomato sauce, Mixed salad with dressing, Beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | Y merged | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Beef in tomato sauce": the sliced meat, beef kind, form lost (rule 2) |
| tomato sauce over the meat | Y merged | "Beef in tomato sauce": same item names the tomato sauce (r1) |
| French fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "French fries" |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "mixed salad with dressing": the gold row is itself the consolidated salad (precedent) |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: French fries, Currywurst with curry ketchup

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y merged | "Currywurst with curry ketchup" |
| curry ketchup sauce | Y merged | same item names the curry ketchup |
| curry powder | n | curry dusting not named |
| French fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "French fries" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: meat-filled pasta dumplings, seasoned potato cubes

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "meat-filled pasta dumplings" (r1 "meat-filled pasta with creamy sauce", D3 "meat-filled pasta rolls") |
| potato salad | Y | "seasoned potato cubes": the potato chunks in dressing (photo), potato kind right, dressing lost is prep (rule 2) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: French fries, Mayonnaise, Currywurst with curry sauce, Grilled kebab meat

| gold core item | production | notes |
|---|---|---|
| French fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "French fries" |
| gyros/döner sliced meat | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Grilled kebab meat" |
| sliced sausage in curry/shashlik sauce | Y | "Currywurst with curry sauce": sausage in curry sauce named |
| tzatziki/garlic yogurt sauce | n | "Mayonnaise" takes the mayonnaise row; no garlic or yogurt sauce named |
| mayonnaise | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Mayonnaise", its own item (D3, A) |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 20, Bowl of shio ramen

- **production**: Wheat noodle soup with clear broth, Leafy greens and bean sprouts, Poached egg

| gold core item | production | notes |
|---|---|---|
| ramen noodles | Y merged | "Wheat noodle soup with clear broth": noodle soup, ramen form (r1) |
| clear (shio) broth | Y merged | same item names the clear broth |
| sliced chashu pork | n | "Poached egg" is the pale chashu misread (r1, photo), kind miss; misnamed, not a hallucination |
| leafy green herb topping (mizuna/mitsuba) | n | "Leafy greens and bean sprouts": "greens" is generic (strict rule 1, r1) |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none | "Poached egg" is the chashu misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **production**: Beef and vegetable stir-fry, Cooked noodles, Shredded cabbage, Banana

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | n | "Beef and vegetable stir-fry" names no soup or broth; "Cooked noodles" is a side plateful (r1) |
| sliced beef and beef meatballs | Y | "Beef and vegetable stir-fry" names the beef (r1) |
| bean sprouts | n | not named; "Shredded cabbage" is the pale shredded bowl misread (r1) |
| Thai basil | n | not named in this repeat (r1 had "Fresh basil leaves") |
| sliced green chilli/jalapeño | n | not named |
| spring onion | n | not named |
| **core recall (/6)** | 1/6 |  |
| **hallucinations** | 1 | "Banana" ("one medium banana"): no banana in the photo (r1 call, the only yellow object is a shoe) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: Beef tacos with cheese and salsa, Corn on the cob, Cola

| gold core item | production | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y merged | "Beef tacos with cheese and salsa" |
| grated cheese | Y merged | same item names the cheese |
| red salsa | Y merged | one "salsa" credited to the red salsa (r1 precedent) |
| green salsa/tomatillo | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, eu-cell-38-newprompt and 8 more: no reported item covered it |
| coriander/cilantro | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-35-eu-oldprompt, eu-cell-38-newprompt and 7 more: no reported item covered it |
| grilled corn on the cob | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "corn on the cob" |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | "Cola" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **production**: Mixed salad with shredded cheese and dressing

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | n | "Mixed salad with shredded cheese and dressing" reads the smothered burrito as a salad; no tortilla, burrito or enchilada named |
| green chile sauce | n | "dressing" names no chile sauce (strict rule 1) |
| shredded cheddar/jack cheese | Y | "shredded cheese" in the only item |
| shredded lettuce | n | "Mixed salad" names no lettuce (strict rule 1, as r1 "vegetables") |
| **core recall (/4)** | 1/4 |  |
| **hallucinations** | none | the salad item is the burrito misread (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **production**: Battered fried fish, French fries, Green peas, Tartar sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish fillet | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "battered fried fish" |
| chips/thick-cut fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "French Fries" |
| green peas | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Green Peas" |
| tartar sauce | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Tartar Sauce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge

### 25, American breakfast platter

- **production**: Pancakes with powdered sugar, Bacon, Fried egg, Breakfast sausage links, Hash brown patties, Toast, Maple syrup, Butter portions

| gold core item | production | notes |
|---|---|---|
| pancakes with icing sugar | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Pancakes with powdered sugar" |
| back bacon rashers | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Bacon" |
| fried egg (sunny side up) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Fried egg" |
| breakfast sausages | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Breakfast sausage links" |
| hash brown/potato croquettes | Y | "Hash brown patties" |
| toast slices | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "toast" |
| maple syrup in a shot glass | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Maple syrup" |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **production**: vegetable pulao, plain yogurt, mixed salad, vegetable curry, potato curry, lentil curry, vegetable curry, green vegetable curry, papadum

| gold core item | production | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | "vegetable pulao" (r1 "vegetable pulao rice") |
| chapati/roti | n | not named (photo shows the roti; "papadum" takes the papad row) |
| papad (papadum) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Papadum" |
| curd/raita | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Plain Yogurt" |
| dal (lentil curry) | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "lentil curry" |
| kofta/dumpling curry in orange gravy | n | "potato curry" and "green vegetable curry" name no kofta or dumpling (strict rule 1, as r1); one "vegetable curry" goes to the brinjal row |
| paneer or fish curry in pale gravy | n | no paneer or fish token, as above |
| brinjal/eggplant curry | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: D "vegetable curry" for the eggplant curry, same call as "vegetable soup" for borscht (precedent) |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none | "mixed salad" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **production**: Chicken and bell pepper stir-fry

| gold core item | production | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y merged | "Chicken and bell pepper stir-fry" |
| red bell pepper strips | Y merged | same item names the bell pepper (colour not named) |
| onion | n | not named |
| spring onion/green onion | n | not named |
| steamed white rice | n | not named |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): dried chilli bits

### 28, Middle-Eastern mezze spread — four composed plates plus flatbread

- **production**: Pita bread, Falafel, Cooked lentils, Couscous, Mixed salad vegetables and leafy greens, Shredded cabbage salad, Grilled meat pieces, Chunky dipping sauce

| gold core item | production | notes |
|---|---|---|
| falafel balls | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Falafel" |
| grilled flatbread | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Pita bread" (cloud, 25-lite name) |
| hummus/creamy white dip | n | not named; "Chunky dipping sauce" names no kind |
| green herb-chilli sauce | n | "Chunky dipping sauce" names no kind (strict rule 1, as r1 "Spicy dipping sauce") |
| yellow bulgur or couscous | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Couscous" |
| black beluga lentils | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Cooked lentils" (B2 name) |
| pickled white cabbage slaw | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Shredded cabbage salad" (25-lite name; pickling is prep, rule 2) |
| green olives | n | not named |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none | "Grilled meat pieces" and "Mixed salad vegetables and leafy greens" point at visible plate parts (rule 3, optional salads) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: Wheat beer, Sliced salami, Cheese cubes, Black olives, Pickled vegetables

| gold core item | production | notes |
|---|---|---|
| pickled gherkin slices | n | "Pickled vegetables" names a class, not the gherkin (strict rule 1, r1) |
| salami slices | Y | "Sliced salami" |
| cheese cubes | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "cheese cubes" |
| green olives | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Black olives" for the dark green olives (photo): same fruit, ripeness colour is form, not kind |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none | "Wheat beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30, Mixed grill board (plancha de grillades)

- **production**: Mixed leafy salad with tomato, Roasted potatoes, Grilled chicken breast, Grilled steak

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | n | not named; "Grilled steak" takes the steak row |
| grilled beef steak | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Grilled steak" |
| grilled sausage | n | not named |
| grilled meat skewer with green pepper and tomato | n | not named |
| baked/roasted potato with browned cheese topping | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Roasted potatoes" (as mistral "roasted potato") |
| mixed leaf salad | Y | "Mixed leafy salad with tomato" (r1 "Mixed salad leaves with tomato") |
| **core recall (/6)** | 3/6 |  |
| **hallucinations** | none | "Grilled chicken breast" points at visible grilled meat (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cherry tomato, steak knife

### 31, Bowl of beef/oxtail soup with buttered bread

- **production**: Beef stew in gravy, Buttered bread

| gold core item | production | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged | "Beef stew in gravy" (r1 "Beef stew with gravy") |
| beef (oxtail) chunks | Y merged | same item names the beef |
| buttered bread slices (dark/whole-grain) | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "buttered bread" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **production**: green olives, celery sticks, carrot sticks, sweet pepper strips, cucumber sticks, creamy vegetable dip, roasted potato rounds, blue cheese, cheddar cheese, sliced salami, breadsticks

| gold core item | production | notes |
|---|---|---|
| green olives | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Green olives" |
| cucumber sticks | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Cucumber sticks" |
| carrot sticks | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Carrot sticks" |
| bell pepper strips | Y | "sweet pepper strips" |
| pan-fried spiced hard-boiled egg halves | n | "roasted potato rounds" is the spiced egg compartment misread (photo, r1), kind miss |
| hummus dip | n | "creamy vegetable dip" names no kind (strict rule 1, r1 "Creamy dip") |
| salami/cured meat slices | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Sliced salami" |
| cheese slices | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Cheddar cheese", "Blue cheese with herbs" (25-lite name) |
| **core recall (/8)** | 6/8 |  |
| **hallucinations** | none | "breadsticks" are the herb crackers (optional), "celery sticks" the second cucumber compartment, "roasted potato rounds" the eggs (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **production**: Rice pudding, Raisins, Cinnamon, Butter

| gold core item | production | notes |
|---|---|---|
| oatmeal/oat porridge | n | "Rice pudding": rice for oats, grain kind miss (rule 2) |
| peanut butter | n | "Butter" (the orange topping, model notes): dairy butter for peanut butter, kind miss (rule 2, dairy for legume) |
| raisins | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Raisins" |
| ground cinnamon | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "cinnamon" |
| milk | n | not named; "Rice pudding" is the porridge misread |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none | "Rice pudding" and "Butter" are the porridge and peanut butter misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: Waffle with chocolate sauce, Strawberries, Whipped cream

| gold core item | production | notes |
|---|---|---|
| waffles | Y | "Waffle with chocolate sauce" |
| strawberries (sliced fresh) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "strawberries" |
| strawberry/berry syrup-compote | n | "chocolate sauce" in the same item is the red syrup misread, kind miss (r1) |
| whipped cream | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Whipped cream" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none | "chocolate sauce" is the syrup misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **production**: French fries, Grilled beef strips with creamy sauce, Mixed salad

| gold core item | production | notes |
|---|---|---|
| gyros/döner sliced meat | Y | "Grilled beef strips with creamy sauce": the sliced meat, beef kind, form (as r1 16 "Beef in tomato sauce") |
| French fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "French Fries" |
| white garlic-yogurt sauce (tzatziki) with oregano | n | "creamy sauce" in the same item names no kind (strict rule 1, r1) |
| shredded white cabbage | n | "Mixed salad" names no part (strict rule 1, r1) |
| tomato slices | n | rule 1, as above |
| sweetcorn | n | rule 1, as above |
| cucumber slices | n | rule 1, as above |
| shredded carrot | n | rule 1, as above |
| **core recall (/8)** | 2/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: Saffron rice, Cooked shrimp, Cooked squid

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | Y | "Saffron rice" |
| whole prawns (langostinos) | Y | "Cooked shrimp" ("several whole shrimp") |
| mantis shrimp (galeras) | n | "Cooked shrimp" takes the prawn row; no mantis shrimp named; "Cooked squid" is a misread (photo shows no squid), squid is another kind |
| artichoke pieces | n | not named; the "Cooked squid" strips may be the artichoke misread, kind miss |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none | "Cooked squid" points at visible pale strips (artichoke or mantis shrimp) misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: steamed dumplings with sauce, shredded cabbage and carrot salad

| gold core item | production | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y | "steamed dumplings with sauce": dumplings named, steamed for boiled is prep (r1) |
| fried caramelised onion topping | n | "sauce" in the same item is the onion topping misread, kind miss (r1) |
| grated carrot and cabbage salad | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "shredded cabbage and carrot salad" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | "sauce" is the onion topping misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **production**: Sesame-seed beef cheeseburger with lettuce, French fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | "Sesame-seed beef cheeseburger with lettuce" |
| French fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "French fries" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: baked beans in tomato sauce, cooked bacon

| gold core item | production | notes |
|---|---|---|
| baked beans in tomato sauce | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "baked beans in tomato sauce" |
| sausage pieces | n | not named |
| bacon rasher | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Cooked bacon" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **production**: Beef stew with gravy, French fries, Roast pork slices

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | n | "Beef stew with gravy" for liver: organ identity is kind (rule 2, r1) |
| chips/French fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "French fries" |
| bacon/gammon slice | Y | "Roast pork slices": gammon is pork, cut and prep (rule 2; r1 "Grilled pork steak") |
| fried egg (remnant, yolk visible) | n | not named in this repeat |
| sausage | n | not named |
| grilled tomato half | n | not named |
| **core recall (/6)** | 2/6 |  |
| **hallucinations** | none | "Beef stew with gravy" is the liver misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: Breaded fried fish, Roasted sweet potato wedges, Creamy dipping sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten | Y | "Breaded fried fish": breaded for battered is prep (rule 2) |
| potato wedges/skin-on roast potatoes | n | "Roasted sweet potato wedges": sweet potato is another species (rule 2, r1; photo shows white-fleshed potato) |
| tartar sauce / mayonnaise dollop | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "creamy dipping sauce": the gold row leaves the creamy sauce open (as 25-flash "creamy sauce" for the 42 dollop) |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | no misnamed item |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **production**: Breaded chicken cutlet with white sauce, White rice, Curry sauce with chunks, Shredded cabbage and corn salad

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | n | "Breaded chicken cutlet with white sauce": chicken for fish, species miss (rule 2, r1) |
| sour cream / remoulade dollop | Y | "white sauce" in the same item names the dollop; the gold row leaves the kind open (r1 "creamy sauce" call) |
| meatballs in brown gravy | n | not named |
| chickpea-and-cauliflower curry | n | "Curry sauce with chunks" names no chickpea or cauliflower (strict rule 1, r1) |
| white rice | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "White rice" |
| red cabbage and sweetcorn salad | Y | "Shredded cabbage and corn salad": cabbage and corn named, colour lost (r1 "Pickled red cabbage" plus "Corn kernels") |
| cucumber and lettuce salad | n | not named |
| **core recall (/7)** | 3/7 |  |
| **hallucinations** | none | "Curry sauce with chunks" points at the curry |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set — main plate, soup bowl, bread plate

- **production**: Breaded chicken cutlets with creamy sauce, Cooked rice, Green beans, Baked polenta square, Bread with creamy spread, Creamy sauce

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | "Breaded chicken cutlets with creamy sauce": breaded cakes under a white topping (photo); the gold row accepts croquettes of any filling, cutlet for croquette is form (as "breaded cutlets" Y on this row, r1 "Breaded fish fillets") |
| herbed green rice | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Cooked rice" (as mistral "rice") |
| green beans | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Green beans" |
| cheese-topped quiche/gratin square | n | "Baked polenta square": cornmeal is another base than an egg quiche or a potato gratin, kind miss (strict) |
| creamy meat-and-vegetable stew | n | not named |
| creamy soup (bowl, with bacon bits) | Y | "Creamy sauce" ("a small bowlful") is the soup bowl: thick white cream in a bowl, gold names no base, sauce for soup is form (as "Mashed potato puree with bacon bits" Y on this row) |
| bread roll with butter | Y | "Bread with creamy spread" |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none | "Baked polenta square" is the quiche square misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: Mixed salad, Chickpeas, Yellow rice, Cooked cabbage and potato stew

| gold core item | production | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "mixed salad": the gold row is the one salad on the plate (as 25-flash "Mixed green salad") |
| brown beans (feijão) in broth | n | "Chickpeas": chickpea for bean is another legume species (rule 2); photo shows brown beans |
| yellow seasoned rice | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Yellow rice" |
| braised cabbage with tomato | Y merged | "Cooked cabbage and potato stew" names the cabbage (r1 "Potato and cabbage stew") |
| stewed meat in onion gravy | n | not named |
| mashed cassava/potato purée | Y merged | same item names the potato |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | "Chickpeas" are the brown beans misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45, Korean hanjeongsik table spread (dozens of banchan, top-down)

- **production**: Stir-fried rice with vegetables, Creamy vegetable soup, Stir-fried meat and vegetables, Grilled fish fillet, Mixed vegetable curry, Cooked beans, Tomato relish, Green beans in tomato sauce, Stuffed green pepper, Braised meat with sauce, Mixed salad with dressing, Noodles with vegetables

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | Y | "Noodles with vegetables": japchae is glass noodles with vegetables, the only noodle item; the r1 call went to the soup bowl because that name said "mushrooms" (photo) |
| steamed egg (gyeranjjim) in stone pot | n | no egg dish named |
| grilled mackerel/fish | Y | "Grilled fish fillet" |
| stir-fried beef in a hot stone pot | n | "Stir-fried meat and vegetables" names no animal (strict rule 1, r1) |
| glazed spicy braised ribs/pork | n | "Braised meat with sauce" names no animal (strict rule 1, r1) |
| sliced raw fish (hoe/sashimi) on shredded radish | n | not named |
| vegetable fritters/jeon platter | n | no fritter or pancake named |
| kimchi | n | not named; "Tomato relish" names another food |
| **core recall (/8)** | 2/8 |  |
| **hallucinations** | none | every item points at a visible dish ("Stir-fried rice with vegetables" reads as the yellow egg pot with spring onion, not an empty bowl); no empty tableware named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: steamed rice noodle sheets, honeycomb tripe in sauce, steamed bean curd

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | "honeycomb tripe in sauce" |
| white boiled tripe/omasum slices in broth | n | "steamed rice noodle sheets" is the white omasum bowls misread (photo), kind miss; not a dumpling, so no trap |
| fried beancurd-skin rolls (tofu skin rolls) | Y | "steamed bean curd": the large pale rolls on the left plates (photo, "several large pieces"), soy kind right, skin and frying lost is form (r1 "Steamed tofu skin") |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | "steamed rice noodle sheets" is the omasum misnamed; no dumpling or bun named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: Kiwi, granola and berry yogurt bowl, Berry compote dessert, Iced coffee drink, Savory canapés, Cherry tomato skewers with balsamic glaze, Avocado toast bites with egg, Purple cabbage slaw, Chocolate-glazed seeded doughnut

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | "Avocado toast bites with egg" |
| eggs benedict with hollandaise on avocado toast | n | "Savory canapés" names nothing (strict rule 1, r1) |
| yogurt bowl with granola, kiwi slices and berry compote | Y | "Kiwi, granola and berry yogurt bowl" |
| cherry tomato salad with balsamic drizzle | Y | "Cherry tomato skewers with balsamic glaze": skewer for salad is form (r1) |
| seeded bagel (dark, sesame-topped) | Y | "Chocolate-glazed seeded doughnut": ring-shaped seeded baked good, form (r1, 25-flash) |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none | "Berry compote dessert" is the beetroot latte, "Purple cabbage slaw" the purple microgreens, "Iced coffee drink" optional (rule 3); no menu card item |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: boiled potato slices, cooked white fish, white bread

| gold core item | production | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "white bread": the sandwich bread, filling lost |
| potato chips/crisps | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "boiled potato slices": potato slices, frying lost is prep (rule 2) |
| samosas (small fried triangles) | n | not named |
| slice of white/vanilla cake with icing — partly eaten | n | "cooked white fish" is the white cake misread, kind miss |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none | "cooked white fish" is the cake misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49, Cafe sizzling-plate dinner set

- **production**: Spaghetti noodles, Beef steak with brown sauce, Tomato slices, Carrot, Thick vegetable soup, Cheese sandwich

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y | "Beef steak with brown sauce" |
| spaghetti (plain, buttered) | Y | "Spaghetti noodles" |
| sausage/frankfurter | n | not named |
| cherry tomatoes | Y | "Tomato slices": tomato kind, cut is form |
| red cabbage soup (borscht-style, bowl) | Y | "Thick vegetable soup" for the soup bowl (as "vegetable soup" for borscht, r1 precedent) |
| bread bun | Y | "Cheese sandwich" is the bread bun (photo): bread kind right, form; no cheese visible |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none | "Carrot" (one small piece) may be a soup or garnish fragment, not counted |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: French fries, Doner meat with tomato sauce, Flatbread, Shredded salad with cucumber, Lager beer

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y merged | "Doner meat with tomato sauce" |
| tomato/chili sauce over the meat | Y merged | same item names the tomato sauce |
| French fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "French fries" |
| iceberg lettuce salad | n | "Shredded salad with cucumber" names no lettuce (strict rule 1, r1) |
| sliced red onion | n | not named |
| cucumber slices | Y | "Shredded salad with cucumber" names the cucumber |
| pickled gherkin and pepperoncini | n | not named |
| **core recall (/7)** | 4/7 |  |
| **hallucinations** | 1 | "Flatbread" ("a small piece beneath the meat"): no bread is visible on the plate or the background plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 147/235 = 62.6 % |
| hallucinations | 2 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 182 |
| cost / plate (auto) | $0.00089 |
| latency median s (auto) | 13.33 |

## Recall and bootstrap confidence interval

> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`, STRICT reading of rule 1 (a generic label such as "greens", "spicy sauce", "cured meat assortment", "mixed vegetables", a bare "mixed salad" where gold lists the parts, "nigiri sushi" with no fish named, "braised meat" or "grilled meat" with no animal named, earns no credit for a specific gold item). Cell: openai/gpt-6-luna on the EU OpenRouter host (`only: azure/eu`, zero retention), no reasoning parameter, v4 prompt, plates repeat 2. Prefill: `--prefill` from `runs/eu-*/`, `runs/v3-eu-*/` and `runs/v4-eu-cell-*/` sheets here (r1 of this cell included), plus the `v3-eu-cell-*` and `eu-cell-*` sheets in `op-worktrees/prompt-v3` (no 2026-08 sheet; 16 distinct sheets, 4273 remembered verdicts). Prefill result: 78 Y (1 of them Y merged), 3 n, 0 conflicts, 154 need judgment. Every prefilled row was kept. The 154 open rows were judged by hand in this order of precedent: this cell's r1 sheet, `v4-eu-cell-38-minimal-newprompt-r1`, the v4 3.1 lite sheets, then the prompt-v3 `v3-eu-cell-*` sheets. Photos opened: 18, 26, 28, 32, 36, 43, 44, 45, 46, 47, 49, 50 (r1 photo calls kept for 06, 12, 13, 20, 21, 41, 48). No model was called for this scoring.

- **Hits: 147/235. Recall: 62.6 %.**
- **95 % CI: [54.7, 69.8] %.**
- Method: a percentile bootstrap over plates (a cluster bootstrap, because a plate's items succeed or fail together). Each of 2000 resamples draws 50 plates with replacement with Python's stdlib `random.Random(7)`. Recall of a resample is the sum of its hits over the sum of its gold items. The CI is the 2.5th and 97.5th percentile of the 2000 values, with linear interpolation. The computation is `harness/stats.py` `bootstrap_recall_ci(pairs, resamples=2000, seed=7)`.
- The harness default (`--score`: 10 000 resamples, seed 20260813) gives [55.0, 70.0] %.
- Answered plates only: every plate has an answer (0 error records), so recall on the answered plates is the same, 147/235 = 62.6 % on 50 plates.

Per plate hits: 01 6/6, 02 1/5, 03 7/8, 04 4/4, 05 1/2, 06 2/6, 07 2/5, 08 2/3, 09 1/1, 10 1/2, 11 2/3, 12 2/3, 13 1/2, 14 3/3, 15 3/3, 16 4/4, 17 3/4, 18 2/2, 19 4/5, 20 2/4, 21 1/6, 22 4/6, 23 1/4, 24 4/4, 25 7/7, 26 5/8, 27 2/5, 28 5/8, 29 3/4, 30 3/6, 31 3/3, 32 6/8, 33 2/5, 34 3/4, 35 2/8, 36 2/4, 37 2/3, 38 2/2, 39 2/3, 40 2/6, 41 2/3, 42 3/7, 43 5/7, 44 4/6, 45 2/8, 46 2/3, 47 4/5, 48 2/4, 49 5/6, 50 4/7.

Repeat 1 of this cell scored 157/235 = 66.8 %. r1 minus r2: +4.3 points, paired 95 % CI [-0.4, +10.0] (same method). The difference comes from item names, not from verdicts: r1 named the pickled ginger and wasabi (06), the three vegetables (07), the basil (21), the cilantro (22), the enchilada (23), the oatmeal, milk and peanut butter (33) and a "seafood paella" that merges the mantis shrimp (36); r2 named the steak (30), the bell pepper (27), the fish (41) and the currywurst (19).

## Hallucinations by plate

- **21: 1.** "Banana" ("one medium banana"). No banana is in the photo (the same item and the same call as r1; the only yellow object is a shoe).
- **50: 1.** "Flatbread" ("a small piece beneath the meat"). No bread is visible on the plate, and the background plate holds none.
- Total: **2 hallucinations** on 50 plates. A hallucination is a food with no referent in the photo (rule 3).
- Trap leaks, not counted: 1 plate. Plate 12 "mixed salad" and "fries" come from the background plate (the model notes say so). Plate 25 names no background burger in this repeat, plate 50 names nothing from the background plate, plate 47 names no menu card item, plate 46 names no dumpling or bun, plate 45 names no empty bowl.
- Misnamed visible objects, not counted (rule 3): 12 "creamy pasta" (sauerkraut), 13 "glazed grilled meat strips" (the onion heap), 20 "Poached egg" (chashu), 23 the salad item (the burrito), 32 "celery sticks" (cucumber), "roasted potato rounds" (eggs), "breadsticks" (the herb crackers), 33 "Rice pudding" and "Butter" (porridge, peanut butter), 34 "chocolate sauce" (syrup), 36 "Cooked squid" (artichoke or mantis shrimp strips), 37 "sauce" (onions), 43 "Baked polenta square" (the quiche square), 44 "Chickpeas" (brown beans), 45 "Stir-fried rice with vegetables" (the yellow egg pot), 46 "steamed rice noodle sheets" (omasum), 47 "Berry compote dessert" (beetroot latte) and "Purple cabbage slaw" (purple microgreens), 48 "cooked white fish" (the cake).

## Errors, schema-invalid records, false unreadable

- Error records: **0**. `_summary.failures` is empty. Every record is HTTP 200, 1 attempt, `finish_reason` stop. No Azure content filter refusal (no `content_filter` finish) in this run.
- Schema-invalid records: **0** (`schema_valid` true on 50/50). Error and invalid ids: none.
- False unreadable: **0** (`unreadable` is false on all 50 answers).

## Paired differences against C3

Same 50 plates, same 235 gold items, `harness/stats.py` `bootstrap_diff_ci(c3, this_cell, resamples=2000, seed=7)`. Each resample draws one set of 50 plate indices with `random.Random(7)` and applies it to both cells, so plate difficulty cancels. The CI is the 2.5th and 97.5th percentile of the 2000 differences, with linear interpolation.

| comparison | C3 | this cell | C3 minus this cell | paired 95 % CI |
|---|---|---|---|---|
| C3 v3 (`op-worktrees/prompt-v3/.../runs/v3-eu-cell-38-minimal-newprompt`) | 199/235 = 84.7 % [78.2, 90.8] | 147/235 = 62.6 % [54.7, 69.8] | **+22.1 points** | **[+13.7, +30.6]** |
| C3 v4 (`runs/v4-eu-cell-38-minimal-newprompt-r1`) | 208/235 = 88.5 % [82.9, 93.4] | 147/235 = 62.6 % [54.7, 69.8] | **+26.0 points** | **[+18.2, +33.7]** |

Both intervals exclude 0 by a wide margin.

- Plates where C3 v3 differs (C3 minus this cell, in hits): 02 +4, 03 +1, 05 +1, 06 +1, 08 +1, 10 +1, 11 +1, 12 +1, 13 +1, 19 +1, 20 +1, 21 +3, 22 -2, 23 +3, 26 +3, 28 -2, 29 +1, 30 +2, 32 -1, 33 +2, 35 +4, 36 +2, 37 +1, 39 +1, 40 +4, 41 +1, 42 +2, 43 +1, 44 +2, 45 +6, 46 +1, 47 +1, 48 +2, 50 +1.
- Plates where C3 v4 differs: 02 +4, 03 +1, 05 +1, 06 +2, 08 +1, 10 +1, 11 +1, 12 +1, 13 +1, 19 +1, 20 +2, 21 +3, 22 -2, 23 +1, 26 +3, 28 +2, 29 +1, 30 +2, 32 +2, 33 +2, 34 +1, 35 +5, 36 +2, 37 +1, 39 +1, 40 +4, 41 +1, 42 +2, 43 +1, 44 +2, 45 +6, 46 +1, 47 +1, 48 +2, 50 +1.

## Judgment calls that were not obvious

| plate | call | verdict | why unsure |
|---|---|---|---|
| 50 | "Flatbread" ("a small piece beneath the meat") | hallucination | nothing is visible, but a döner plate can hide bread under the meat; a lenient reader would not count it |
| 45 | "Noodles with vegetables" for the japchae | Y | the name fits japchae word for word, but the model says "a small bowlful" and the optional mushroom noodle soup is in a bowl; r1 gave its noodle item to the soup |
| 43 | "Creamy sauce" ("a small bowlful") for the creamy soup with bacon; "Breaded chicken cutlets" for the croquettes; "Baked polenta square" for the quiche | Y, Y, n | sauce for soup read as form because gold names no base; the croquette row accepts any filling; polenta read as another base, though earlier sheets credited "savory bake" |
| 36 | "Cooked shrimp" for the prawns, nothing for the mantis shrimp | Y, n | one shrimp token cannot cover two gold rows; mantis shrimp are often called shrimp, so a lenient reader would credit both |
| 18 | "seasoned potato cubes" for the potato salad | Y | potato kind right and the photo shows potato chunks in dressing, but earlier sheets refused "creamy potato and herb sauce" for this row |
