# Plate-identification scoring worksheet

- results: `runs/v4-eu-cell-25-flash-newprompt-r1/results.json`
- config: `eu-cell-25-flash-newprompt` (started 2026-10-06T13:30:58.063843+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
- prefill: 115 Y, 5 n, 0 conflicts, 115 need judgment, from 15 earlier sheets

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 231 |
| items named (mean/plate) | 4.62 |
| distinct item names | 210 |
| latency mean (s) | 13.47 |
| latency median (s) | 11.31 |
| latency max (s) | 38.73 |
| cost / plate (USD) | 0.005983 |
| cost total (USD) | 0.299157 |

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

### 02, Roast (Sunday) dinner

- **production**: Roast meat, Yorkshire pudding, Roasted potatoes, Mixed cooked greens with mushrooms, Gravy

| gold core item | production | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y | "Roast meat": the gold row itself reads "roast meat" with lamb or beef left open (25-flash v3 "Roast meat with gravy" Y); gravy optional |
| Yorkshire pudding | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Yorkshire pudding" |
| roast potatoes | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Roasted potatoes" |
| broccoli | n | "Mixed cooked greens with mushrooms" names no broccoli (25-flash v3 named it, this run does not) |
| cabbage/greens | n | "Mixed cooked greens" is a generic label (strict rule 1, "greens" named in the rule; 25-flash v3 "Mixed greens" n) |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none | "with mushrooms" inside the greens item has dark pieces among the cabbage as its referent (photo); a part inside a present item either way (rule 3); "Gravy" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **production**: Grilled Salmon Fillet, Mixed Salad with Feta and Avocado

| gold core item | production | notes |
|---|---|---|
| grilled salmon fillets | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Grilled salmon fillet" |
| feta cheese | Y merged | "Mixed Salad with Feta and Avocado" names the feta |
| kalamata olives | n | "Mixed Salad" is not the determinate dish "Greek salad" and names no olives (strict rule 1, as 25-flash v3 "Mixed salad", L3 "mediterranean salad") |
| avocado | Y merged | same item names the avocado |
| cherry tomatoes | n | rule 1, bare "Mixed Salad" (25-flash v3 call) |
| cucumber | n | rule 1, as above |
| lettuce/romaine | n | rule 1, as above |
| red onion | n | rule 1, as above |
| **core recall (/8)** | 3/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04, Cheeseburger with fries

- **production**: Cheeseburger, Potato wedges, Ketchup, Pickled gherkins, Beer

| gold core item | production | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Cheeseburger" |
| thick-cut fries/steak fries | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Potato wedges" for steak fries: cut, not kind (rule 2; gold 11 lists wedges with thick-cut fries) |
| ketchup | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Ketchup" |
| pickles/gherkins | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Pickled gherkins" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **production**: White rice with carrots, Chicken in creamy green sauce

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | "Chicken in creamy green sauce" (as L1 "chicken with greens in sauce") |
| white rice | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "white rice with carrots"; the carrots are the optional pepper bits misnamed (rule 3, r1 call) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "with carrots" is the optional pepper bits misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: Salmon and avocado sushi roll, Tuna nigiri, White fish nigiri, Pickled ginger, Wasabi, Soy sauce, White wine, Water

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Salmon and avocado sushi roll" (25-lite name) |
| tuna nigiri | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Tuna nigiri" |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "White fish nigiri" |
| pickled ginger | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "pickled ginger" |
| wasabi | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "wasabi" |
| soy sauce | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Soy sauce" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "White wine", "Water" are the optional glasses |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: Spaghetti with meat and vegetable sauce

| gold core item | production | notes |
|---|---|---|
| spaghetti | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "Spaghetti with meat and vegetable sauce" (D3 and A name) |
| ground beef/meat tomato sauce | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "spaghetti with meat and vegetable sauce", same item |
| corn kernels | n | prefill n from eu-cell-38-prod-oldprompt, v3-eu-cell-25-flash-newprompt, v3-eu-cell-35-eu-newprompt and 1 more: no reported item covered it |
| green beans | n | prefill n from eu-cell-38-prod-oldprompt, v3-eu-cell-25-flash-newprompt, v3-eu-cell-35-eu-newprompt and 1 more: no reported item covered it |
| carrot pieces | n | prefill n from eu-cell-38-prod-oldprompt, v3-eu-cell-25-flash-newprompt, v3-eu-cell-35-eu-newprompt and 1 more: no reported item covered it |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **production**: Greek yogurt, Granola, Apple slices

| gold core item | production | notes |
|---|---|---|
| yogurt | Y | "Greek yogurt" |
| granola (oats/puffed grains, nuts) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "granola" |
| apple slices | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Apple slices" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **production**: Chicken and Cheese Pizza, Cola

| gold core item | production | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Chicken and Cheese Pizza" (C3 name) |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none | "Cola" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **production**: Chicken sandwich, Mixed side salad, Pepsi Max, Sugar sachets

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Chicken sandwich" (cloud name) |
| green side salad (rocket/mixed leaves) | Y | "Mixed side salad": the gold row is one generic salad (L1, L3, 25-flash v3 precedent) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "Pepsi Max", "Sugar sachets": drink and table sachets, visible, no recall role |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: Pork Schnitzel, French fries, Mixed side salad with dressing, Ketchup

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | Y | "Pork Schnitzel" |
| thick-cut fries/potato wedges | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "French fries" |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | "Mixed side salad with dressing": the gold row is itself the consolidated salad (L1, L2, L3, C3 v4 precedent) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Ketchup" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: Sausages with gravy, Mashed potatoes, Sauerkraut, Mixed side salad

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Sausages with gravy" (as 25-lite "Sausages with sauce", kind right) |
| sauerkraut | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Sauerkraut" |
| mashed potatoes | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Mashed potatoes" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Mixed side salad" is the salad on the background plate (gold trap): a trap leak, not a hallucination (as 25-flash v3, C3 v4) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: Käsespätzle with caramelized onions, Mixed green salad with creamy dressing

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y merged | "Käsespätzle with caramelized onions" (as C3 v4 "Käsespätzle with fried onions") |
| fried/caramelised onions | Y merged | same item names the onions |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "Mixed green salad with creamy dressing" is the optional side salad plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: Beef stew with potatoes and mushrooms, Green lettuce salad

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "beef stew with potatoes and mushrooms" (D3 name, word for word) |
| boiled potatoes | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "beef stew with potatoes and mushrooms", same item names the potatoes (r1) |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "Green lettuce salad" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: Bavarian White Sausage, Sweet Mustard, Beer, Soft Pretzel

| gold core item | production | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y | "Bavarian White Sausage" (Weisswurst in English) |
| pretzel (Brezel) | Y | "Soft Pretzel" |
| sweet mustard | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Sweet Mustard" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16, Döner/gyros plate with fries and salad

- **production**: Döner Kebab with sauce, French fries, Mixed salad with dressing, Beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | Y | "Döner Kebab with sauce"; the sauce is not credited, so not merged |
| tomato sauce over the meat | n | "with sauce" names no sauce kind (strict rule 1, as 25-flash and 25-lite "with sauce" on 50, C3 v4 on 42) |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "French fries" |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "mixed salad with dressing": the gold row is itself the consolidated salad (precedent) |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none | "Beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: French fries, Currywurst

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "currywurst" |
| curry ketchup sauce | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "currywurst": sauce entailed by the named dish (25-lite precedent); portion hint "one large sausage with curry sauce" |
| curry powder | n | prefill n from eu-cell-35-eu-oldprompt, eu-cell-38-minimal-newprompt, eu-cell-38-newprompt and 9 more: no reported item covered it |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "French fries" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: Maultaschen (stuffed pasta rolls), Creamy potato salad with bacon

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "Maultaschen (stuffed pasta rolls)" |
| potato salad | Y | "Creamy potato salad with bacon" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: French fries, Mayonnaise, Grilled meat, Garlic sauce, Currywurst

| gold core item | production | notes |
|---|---|---|
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "French fries" |
| gyros/döner sliced meat | n | "Grilled meat" names neither the dish nor an animal (strict rule 1, as "Grilled meat" n for the glazed pork on 45 in the v4 sheets); 25-flash v3 "Kebab meat" named the dish |
| sliced sausage in curry/shashlik sauce | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Currywurst" (cloud name) |
| tzatziki/garlic yogurt sauce | Y | "Garlic sauce": the gold row reads "garlic yogurt sauce" (C "garlic sauce" precedent on 35) |
| mayonnaise | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Mayonnaise", its own item (D3, A) |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 20, Bowl of shio ramen

- **production**: Ramen noodles, Ramen broth, Chashu pork belly, Mizuna greens, Fried garlic bits

| gold core item | production | notes |
|---|---|---|
| ramen noodles | Y | "Ramen noodles", its own item |
| clear (shio) broth | Y | "Ramen broth", its own item |
| sliced chashu pork | Y | "Chashu pork belly", its own item |
| leafy green herb topping (mizuna/mitsuba) | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Mizuna greens" names the mizuna, so not the generic "greens" that the strict reading rejects |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Fried garlic bits" is the optional fried garlic in the broth (gold optional) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **production**: Beef Pho Soup, Pho Garnishes (Bean Sprouts, Basil, Lime), Extra Rice Noodles, Hot Tea

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y merged | prefill Y from v3-eu-cell-mistral-medium-newprompt: "beef pho soup" |
| sliced beef and beef meatballs | Y merged | prefill Y from v3-eu-cell-mistral-medium-newprompt: "beef pho soup" names the beef |
| bean sprouts | Y merged | "Pho Garnishes (Bean Sprouts, Basil, Lime)" names the sprouts |
| Thai basil | Y merged | same item names the basil |
| sliced green chilli/jalapeño | n | not named |
| spring onion | n | not named |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | "Extra Rice Noodles" the optional extra bowl, "Hot Tea" the optional drink, lime in the garnish item |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: Tacos with beef and cheese, Grilled corn on the cob, Dark beverage (cola)

| gold core item | production | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y merged | prefill Y from v3-eu-cell-25-flash-newprompt: "Tacos with beef and cheese" |
| grated cheese | Y merged | "Tacos with beef and cheese" names the cheese (25-flash v3, same name) |
| red salsa | n | not named |
| green salsa/tomatillo | n | not named |
| coriander/cilantro | n | not named |
| grilled corn on the cob | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "grilled corn on the cob" |
| **core recall (/6)** | 3/6 |  |
| **hallucinations** | none | "Dark beverage (cola)" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **production**: Wet burrito, Shredded cheese blend, Shredded lettuce, Diced tomato

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "wet burrito" |
| green chile sauce | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "wet burrito", "smothered/wet" entails the sauce (precedent) |
| shredded cheddar/jack cheese | Y | "Shredded cheese blend", its own item |
| shredded lettuce | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "shredded lettuce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **production**: Battered fish fillet, French fries, Green peas, Tartar sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish fillet | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Battered Fish Fillet" |
| chips/thick-cut fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "French Fries" |
| green peas | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Green Peas" |
| tartar sauce | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Tartar Sauce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge

### 25, American breakfast platter

- **production**: Bacon, Pancakes with powdered sugar, Fried egg, Breakfast sausages, Hash browns, White toast, Maple syrup, Butter

| gold core item | production | notes |
|---|---|---|
| pancakes with icing sugar | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Pancakes with powdered sugar" |
| back bacon rashers | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Bacon" |
| fried egg (sunny side up) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Fried egg" |
| breakfast sausages | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Breakfast sausages" |
| hash brown/potato croquettes | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Hash browns" |
| toast slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "White toast" |
| maple syrup in a shot glass | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Maple syrup" |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none | "Butter" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **production**: Vegetable pilaf rice, Roti flatbread, Papadum, Plain yogurt, Mixed vegetable soup, Dal (lentil stew), Paneer curry, Mixed vegetable curry, Side salad (cabbage, carrot)

| gold core item | production | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | "Vegetable pilaf rice" |
| chapati/roti | Y | "Roti flatbread" |
| papad (papadum) | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Papadum" |
| curd/raita | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "Plain Yogurt" |
| dal (lentil curry) | Y | "Dal (lentil stew)" (25-flash v3 name) |
| kofta/dumpling curry in orange gravy | n | no item names the kofta; "Paneer curry" takes the paneer row and "Mixed vegetable curry" the eggplant row (one token, one row) |
| paneer or fish curry in pale gravy | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: D "paneer curry" |
| brinjal/eggplant curry | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Mixed Vegetable Curry" for the eggplant curry (D, C2, B2 precedent) |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none | "Mixed vegetable soup", "Side salad (cabbage, carrot)" optional; every curry name has a bowl |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **production**: Stir-fried chicken with cashews and vegetables, Steamed white rice

| gold core item | production | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y | "Stir-fried chicken with cashews and vegetables"; "vegetables" names no vegetable, so not merged (C3 v4 call) |
| red bell pepper strips | n | "vegetables" names nothing (strict rule 1, C3 v4 call) |
| onion | n | rule 1, as above |
| spring onion/green onion | n | not named |
| steamed white rice | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Steamed White Rice" |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): dried chilli bits

### 28, Middle-Eastern mezze spread — four composed plates plus flatbread

- **production**: Falafel, Bulgur, Cooked Lentils, Hummus, Mixed Vegetable Salad, Roasted Eggplant, Flatbread, Chili Herb Sauce

| gold core item | production | notes |
|---|---|---|
| falafel balls | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Falafel" |
| grilled flatbread | Y | "Flatbread" |
| hummus/creamy white dip | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Hummus" |
| green herb-chilli sauce | Y | "Chili Herb Sauce" names the herb and the chilli (as C3 v3 "chili herb dipping oil", C3 v4 "herb chili oil dipping sauce") |
| yellow bulgur or couscous | Y | "Bulgur" |
| black beluga lentils | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Cooked lentils" (B2 name) |
| pickled white cabbage slaw | n | "Mixed Vegetable Salad" names no cabbage (strict rule 1, the "mixed vegetables" example; C3 v4 "pickled vegetables" n) |
| green olives | Y | "Green olives" |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none | "Roasted Eggplant": the dark glossy pieces on two bowls (photo) are its referent (rule 3); "Mixed Vegetable Salad" covers the visible slaw and salsa |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: Weissbier, Sliced pickles, Honey mustard sauce, Salami slices, Cheese cubes, Green olives

| gold core item | production | notes |
|---|---|---|
| pickled gherkin slices | Y | "Sliced pickles" (as 25-flash v3 "Pickles with mustard sauce") |
| salami slices | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Salami slices" |
| cheese cubes | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "cheese cubes" |
| green olives | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Green olives" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Weissbier" optional; "Honey mustard sauce" is the creamy dip misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30, Mixed grill board (plancha de grillades)

- **production**: Grilled beef steak, Roasted pork ribs, Grilled sausage, Crispy bacon strips, Grilled meat skewers, Baked potato with cheese, Mixed green salad

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "roasted pork ribs" |
| grilled beef steak | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "grilled beef steak" |
| grilled sausage | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Grilled sausage" |
| grilled meat skewer with green pepper and tomato | Y | "Grilled meat skewers": the skewer is named; the gold row names no animal |
| baked/roasted potato with browned cheese topping | Y | "Baked potato with cheese" |
| mixed leaf salad | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Mixed green salad" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Crispy bacon strips": the pork belly slices on the board (25-flash v3 photo check), rule 3 |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cherry tomato, steak knife

### 31, Bowl of beef/oxtail soup with buttered bread

- **production**: Beef Goulash, Rye bread with butter

| gold core item | production | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged | prefill Y from v3-eu-cell-mistral-medium-newprompt: "beef goulash" |
| beef (oxtail) chunks | Y merged | "Beef Goulash", same item as the broth (precedent) |
| buttered bread slices (dark/whole-grain) | Y | "Rye bread with butter" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **production**: Green olives, Cucumber sticks, Carrot sticks, Yellow bell pepper strips, Red bell pepper strips, Deviled eggs, Hummus, Blue cheese with herbs, Cheddar cheese, Sliced salami, Herb crackers

| gold core item | production | notes |
|---|---|---|
| green olives | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Green olives" |
| cucumber sticks | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Cucumber sticks" |
| carrot sticks | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Carrot sticks" |
| bell pepper strips | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Yellow bell pepper strips", "Red bell pepper strips" |
| pan-fried spiced hard-boiled egg halves | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Deviled eggs" (deviled for spiced egg is prep, rule 2) |
| hummus dip | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Hummus" |
| salami/cured meat slices | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Sliced salami" |
| cheese slices | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Cheddar cheese", "Blue cheese with herbs" (25-lite name) |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **production**: Cooked oatmeal, Peanut butter, Raisins, Ground cinnamon

| gold core item | production | notes |
|---|---|---|
| oatmeal/oat porridge | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Cooked oatmeal" |
| peanut butter | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Peanut butter" |
| raisins | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Raisins" |
| ground cinnamon | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Ground Cinnamon" |
| milk | n | prefill n from eu-cell-38-newprompt, eu-cell-38-prod-oldprompt, v3-eu-cell-25-flash-newprompt and 3 more: no reported item covered it |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: Waffles, Strawberry topping, Whipped cream

| gold core item | production | notes |
|---|---|---|
| waffles | Y | "Waffles", its own item |
| strawberries (sliced fresh) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Strawberry topping" credits one row, the strawberries (C3 name, identical) |
| strawberry/berry syrup-compote | n | "Strawberry topping" credits one row, the strawberries (one token, one row; C3 v3, 25-flash v3 call) |
| whipped cream | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Whipped cream" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **production**: Doner meat, French fries, Mixed salad, Garlic yogurt sauce

| gold core item | production | notes |
|---|---|---|
| gyros/döner sliced meat | Y | "Doner meat" |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "French Fries" |
| white garlic-yogurt sauce (tzatziki) with oregano | Y | "Garlic yogurt sauce" |
| shredded white cabbage | n | bare "Mixed salad" names no part (strict rule 1, as 25-flash v3 "Mixed Salad") |
| tomato slices | n | rule 1, as above |
| sweetcorn | n | rule 1, as above |
| cucumber slices | n | rule 1, as above |
| shredded carrot | n | rule 1, as above |
| **core recall (/8)** | 3/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: Paella rice, Cooked shrimp, Mantis shrimp, Artichoke hearts

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Paella rice" |
| whole prawns (langostinos) | Y | "Cooked shrimp", its own item |
| mantis shrimp (galeras) | Y | "Mantis shrimp", its own item |
| artichoke pieces | Y | "Artichoke hearts", its own item |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: Pierogi with filling and fried onions, Shredded cabbage and carrot salad

| gold core item | production | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y merged | "Pierogi with filling and fried onions" |
| fried caramelised onion topping | Y merged | same item names the onions |
| grated carrot and cabbage salad | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "shredded cabbage and carrot salad" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **production**: Beef burger with bun, lettuce and tomato, French fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | "Beef burger with bun, lettuce and tomato" |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "French fries" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: Baked beans, Fried sausages, Fried bacon

| gold core item | production | notes |
|---|---|---|
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Baked beans" (D3 name) |
| sausage pieces | Y | "Fried sausages" |
| bacon rasher | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Fried bacon" (25-lite name) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **production**: French fries, Stewed beef, Sausage, Fried liver pieces, Fried egg, Cooked ham, Grilled tomato, Cooked fatty pork pieces

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | Y | "Fried liver pieces" names the organ |
| chips/French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "French fries" |
| bacon/gammon slice | Y | "Cooked ham" for the gammon slice: gammon is cured ham, kind right |
| fried egg (remnant, yolk visible) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "fried egg" |
| sausage | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Sausage" |
| grilled tomato half | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Grilled tomato" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Stewed beef" is the flat meat slices in the gravy, "Cooked fatty pork pieces" the pale fatty pork at the top left (photo) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: Fried white fish, Seasoned potato wedges, Mayonnaise

| gold core item | production | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten | Y | "Fried white fish"; batter not named, form (rule 2) |
| potato wedges/skin-on roast potatoes | Y | "Seasoned potato wedges" |
| tartar sauce / mayonnaise dollop | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Mayonnaise" (D3, cloud name) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **production**: Fried fish fillet with sour cream, White rice, Chickpea curry, Meatballs in sauce, Mashed potatoes with sauce, Mixed vegetable salad

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | Y merged | "Fried fish fillet with sour cream" (as L1 "breaded fish fillet with sour cream") |
| sour cream / remoulade dollop | Y merged | same item names the sour cream (L1 same wording Y merged) |
| meatballs in brown gravy | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Meatballs in sauce" |
| chickpea-and-cauliflower curry | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Chickpea curry" |
| white rice | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "White rice" |
| red cabbage and sweetcorn salad | n | "Mixed vegetable salad" names no part (strict rule 1, as L3 "mixed vegetable side salad", C3 v3 "Mixed side salad") |
| cucumber and lettuce salad | n | not named; one generic salad cannot cover two salads |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none | "Mashed potatoes with sauce" is the optional tomato-sauced bake (as 25-flash v3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set — main plate, soup bowl, bread plate

- **production**: Mashed potato puree with bacon bits, Slice of white bread with butter, Fish cakes with mayonnaise, Green beans, Green herb rice, Creamy pasta salad, Quiche or gratin, Green olives

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Fish cakes with mayonnaise" |
| herbed green rice | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "green herb rice" |
| green beans | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Green beans" |
| cheese-topped quiche/gratin square | Y | "Quiche or gratin" |
| creamy meat-and-vegetable stew | n | "Creamy pasta salad" is the stew misread (as C2, B2 and 25-flash v3 "Pasta salad with ham"), kind miss; misnamed, not a hallucination |
| creamy soup (bowl, with bacon bits) | Y | "Mashed potato puree with bacon bits" is the soup bowl: a thick white cream with bacon bits; purée for soup is form (rule 2, as L1 "creamy grits with bacon") |
| bread roll with butter | Y | "Slice of white bread with butter" |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none | "Creamy pasta salad" is the stew misnamed, "Mashed potato puree with bacon bits" the soup bowl (rule 3); "Green olives" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: Mixed green salad with carrots, Cooked brown beans, Yellow rice, Stewed cabbage, Stewed pork

| gold core item | production | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | "Mixed green salad with carrots" names the carrot; the one salad on the plate |
| brown beans (feijão) in broth | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Cooked brown beans" |
| yellow seasoned rice | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Yellow rice" |
| braised cabbage with tomato | Y | "Stewed cabbage" (tomato not named, as 25-flash v3 "Cooked cabbage") |
| stewed meat in onion gravy | Y | "Stewed pork": gold names no kind (as 25-flash v3 "Braised pork") |
| mashed cassava/potato purée | n | no purée named (25-flash v3 n) |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45, Korean hanjeongsik table spread (dozens of banchan, top-down)

- **production**: Japchae, Steamed egg (Gyeran-jjim), Grilled mackerel (Godeungeo gui), Kimchi Jjigae, Tofu with seasoning, Assorted Jeon (pancakes), Braised short ribs (Galbi-jjim), Spicy marinated pork (Jeyuk-bokkeum), Sashimi / Korean raw fish (Hoe), Kimchi (fermented cabbage), Mixed Banchan (side dishes), Gochujang (chili paste)

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "japchae" |
| steamed egg (gyeranjjim) in stone pot | Y | "Steamed egg (Gyeran-jjim)" |
| grilled mackerel/fish | Y | "Grilled mackerel (Godeungeo gui)" |
| stir-fried beef in a hot stone pot | Y | "Braised short ribs (Galbi-jjim)" for the beef in the stone pot: beef kind right, braised for stir-fried is prep (rule 2; 25-flash v3 same name) |
| glazed spicy braised ribs/pork | Y | "Spicy marinated pork (Jeyuk-bokkeum)" names the pork, kind right |
| sliced raw fish (hoe/sashimi) on shredded radish | Y | "Sashimi / Korean raw fish (Hoe)" |
| vegetable fritters/jeon platter | Y | "Assorted Jeon (pancakes)" |
| kimchi | Y | "Kimchi (fermented cabbage)" |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none | "Kimchi Jjigae" is the white stone pot misnamed (rule 3, as L2 "soybean sprout soup"); "Tofu with seasoning", "Gochujang", "Mixed Banchan" are the optional tofu, chili paste bowl and side bowls; no empty bowl named as rice |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: Fried bean curd rolls, Braised beef tripe, Marinated bamboo shoots

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Braised Beef Tripe": one tripe token goes to the honeycomb cups (precedent) |
| white boiled tripe/omasum slices in broth | n | "Marinated bamboo shoots" is the omasum cups misnamed (as 25-flash v3 "Pickled Bamboo Shoots with Carrots"), plant for organ, kind miss; the one tripe token went to the honeycomb row |
| fried beancurd-skin rolls (tofu skin rolls) | Y | "Fried bean curd rolls" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | "Marinated bamboo shoots" is the omasum cups misnamed (rule 3); no dumplings or buns named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: Berry and granola smoothie bowl, White wine, Iced latte, Beetroot latte, Eggs Benedict with ham, Cherry tomato salad with balsamic glaze, Avocado and poached egg on toast, Donut with sesame seeds, Orange and passion fruit juice

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | "Avocado and poached egg on toast" |
| eggs benedict with hollandaise on avocado toast | Y | "Eggs Benedict with ham"; "with ham" is a wrong part inside a present item (rule 3) |
| yogurt bowl with granola, kiwi slices and berry compote | Y | "Berry and granola smoothie bowl" names the granola (25-flash v3 "Smoothie bowl with fruit and granola" Y) |
| cherry tomato salad with balsamic drizzle | Y | "Cherry tomato salad with balsamic glaze", its own item |
| seeded bagel (dark, sesame-topped) | Y | "Donut with sesame seeds" for the dark sesame bagel: ring-shaped baked good, form (rule 2; 25-flash v3 "Chocolate donut with sesame seeds" Y) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none | four drinks optional; "Donut with sesame seeds" is the bagel misnamed, "with ham" a part inside the benedict (rule 3); no menu card item named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: Potato chips, Vanilla cake with frosting, White bread sandwich, Samosas

| gold core item | production | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "White bread sandwich" |
| potato chips/crisps | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Potato chips" |
| samosas (small fried triangles) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Samosas" |
| slice of white/vanilla cake with icing — partly eaten | Y | "Vanilla cake with frosting" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49, Cafe sizzling-plate dinner set

- **production**: Grilled beef steak with gravy, Sausage (frankfurter style), Spaghetti, Savory soup, Plain white bread roll

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y | "Grilled beef steak with gravy": the gold row accepts steak |
| spaghetti (plain, buttered) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Spaghetti" |
| sausage/frankfurter | Y | "Sausage (frankfurter style)" |
| cherry tomatoes | n | not named |
| red cabbage soup (borscht-style, bowl) | Y | "Savory soup" for the borscht bowl (as 25-flash v3 bare "Soup" Y, 25-lite, qwenvl, runpod) |
| bread bun | Y | "Plain white bread roll" |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: Doner kebab meat with sauce, French fries, Mixed salad, Beer (Karjala), Pepsi

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y | "Doner kebab meat with sauce"; the sauce is not credited, so not merged |
| tomato/chili sauce over the meat | n | "with sauce" names no sauce kind (strict rule 1, 25-flash v3 call on "Doner kebab with sauce") |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "French fries" |
| iceberg lettuce salad | n | bare "Mixed salad" names no part (rule 1) |
| sliced red onion | n | rule 1, as above |
| cucumber slices | n | rule 1, as above |
| pickled gherkin and pepperoncini | n | not named |
| **core recall (/7)** | 2/7 |  |
| **hallucinations** | none | "Beer (Karjala)", "Pepsi" optional; nothing from the background plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

### 01, Continental/English-style breakfast plate

- **production**: Dark bread slice, Cooked ham slices, Mini frankfurters, Scrambled eggs, Baked beans in tomato sauce, Cucumber slices, Dorina Margarin

| gold core item | production | notes |
|---|---|---|
| scrambled eggs | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Scrambled eggs" |
| bacon/ham slices | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Cooked ham slices" |
| frankfurter sausages | Y | "Mini frankfurters" (as 25-flash v3 "Small sausages") |
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Baked beans in tomato sauce" |
| brown bread slice | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Dark bread slice" (as "brown bread", D3) |
| cucumber slices | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Cucumber slices" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Dorina Margarin" is the optional margarine tub |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter/margarine packets

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 194/235 = 82.6% |
| hallucinations | 0 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 210 |
| cost / plate (auto) | $0.00598 |
| latency median s (auto) | 11.31 |

## Recall and bootstrap confidence interval

> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`, STRICT reading of rule 1 (a generic label such as "greens", "spicy sauce", "cured meat assortment", "mixed vegetables", "vegetables", "with sauce", a bare "mixed salad" where gold lists the parts, "nigiri sushi" with no fish, "mediterranean salad" with no part named, "braised meat" or "grilled meat" with no animal named, earns no credit for a specific gold item). Cell: google/gemini-2.5-flash on the EU host (`eu.openrouter.ai`, Google provider, zdr), reasoning `minimal`, v4 prompt, plates repeat 1. Plate 01 was re-run after a 429 and is valid. Prefill: `--prefill` from `runs/eu-*/`, `runs/v3-eu-*/`, `runs/v4-eu-cell-*/` (31 lite r1 to r3, 38 minimal r1, gpt6 luna r1) and the `v3-eu-cell-*` and `eu-cell-*` sheets of `op-worktrees/prompt-v3` (15 sheets read, identical copies counted once; no 2026-08 sheet). Prefill result: 115 Y (12 of them Y merged), 5 n, 0 conflicts, 115 need judgment. Every prefilled row was kept. The 115 open rows were judged by hand, consistent with the same model item name in this order: `v4-eu-cell-38-minimal-newprompt-r1`, `v4-eu-cell-31-lite-newprompt-r1` to `r3`, `v3-eu-cell-25-flash-newprompt` (same model, v3 prompt), `v3-eu-cell-38-minimal-newprompt`, the other v3 EU sheets. Photos opened: 02, 28, 40. No model was called for this scoring.

- **Hits: 194/235. Recall: 82.6 %.**
- **95 % CI: [75.2, 89.4] %.**
- Method: a percentile bootstrap over plates (a cluster bootstrap). Each of 2000 resamples draws 50 plates with replacement with Python's stdlib `random.Random(7)`. The CI is the 2.5th and 97.5th percentile, with linear interpolation. The computation is `harness/stats.py` `bootstrap_recall_ci(pairs, resamples=2000, seed=7)` on the pairs that `harness.scorecard.load_filled` reads from this sheet.
- The harness default (`--score`: 10 000 resamples, seed 20260813) gives [75.2, 89.3] %.

Per plate hits: 01 6/6, 02 3/5, 03 3/8, 04 4/4, 05 2/2, 06 6/6, 07 2/5, 08 3/3, 09 1/1, 10 2/2, 11 3/3, 12 3/3, 13 2/2, 14 3/3, 15 3/3, 16 3/4, 17 3/4, 18 2/2, 19 4/5, 20 4/4, 21 4/6, 22 3/6, 23 4/4, 24 4/4, 25 7/7, 26 7/8, 27 2/5, 28 7/8, 29 4/4, 30 6/6, 31 3/3, 32 8/8, 33 4/5, 34 3/4, 35 3/8, 36 4/4, 37 3/3, 38 2/2, 39 3/3, 40 6/6, 41 3/3, 42 5/7, 43 6/7, 44 5/6, 45 8/8, 46 2/3, 47 5/5, 48 4/4, 49 5/6, 50 2/7.

## Hallucinations by plate

None. **0 hallucinations** on 50 plates. A hallucination is a food with no referent in the photo (rule 3).

- Trap leaks, not counted as hallucinations: 12 "Mixed side salad" is the salad on the background plate (gold trap). Plate 50 names nothing from the background plate, plate 47 names no menu card item, plate 46 names no dumpling or bun, plate 45 names no empty bowl as rice.
- Referents checked on the photo: 02 "with mushrooms" (dark pieces among the greens), 28 "Roasted Eggplant" (the dark glossy pieces on two bowls), 40 "Stewed beef" (the flat meat slices in the gravy) and "Cooked fatty pork pieces" (the pale fatty pork at the top left).
- Misnamed visible objects, not counted (rule 3): 29 "Honey mustard sauce" (the creamy dip), 30 "Crispy bacon strips" (pork belly slices), 43 "Creamy pasta salad" (the stew) and "Mashed potato puree with bacon bits" (the soup), 45 "Kimchi Jjigae" (the white stone pot), 46 "Marinated bamboo shoots" (the omasum cups), 47 "Donut with sesame seeds" (the bagel).
- Optional items reported, no error: 06 white wine and water, 13 the side salad plate, 20 fried garlic bits, 21 extra noodles and tea, 26 soup and side salad, 42 the tomato-sauced bake, 43 green olives, 47 four drinks, 50 beer and Pepsi.

## Errors, schema-invalid records, false unreadable

- Error records: **0** (`_summary.failures` is empty; every record is HTTP 200, `error` null, provider Google).
- Schema-invalid records: **0** (`schema_valid` true on 50/50). Error and invalid ids: none.
- False unreadable: **0** (`unreadable` is false on every plate).
- Retried records, valid at the end, not errors: 07, 08, 13 (2 attempts each). Plate 01 is the re-run after the 429 and holds 1 clean attempt.

## Paired difference against C3 v3

C3 v3 is `op-worktrees/prompt-v3/apps/inference/eval/runs/v3-eu-cell-38-minimal-newprompt/scorecard-filled.md` (3.8 flash, minimal reasoning, v3 prompt), the same 50 plates and the same 235 gold items.

- C3 v3: 199/235 = 84.7 %, 95 % CI [78.2, 90.8] (same method, seed 7, 2000 resamples).
- This cell: 194/235 = 82.6 %, 95 % CI [75.2, 89.4].
- **C3 v3 minus this cell: +2.1 points, paired 95 % CI [-5.7, +10.3].** The interval contains 0.
- Plates where the two cells differ (C3 v3 minus this cell, in hits): 02 +2, 03 +5, 06 -3, 16 +1, 19 +1, 20 -1, 22 -1, 26 +1, 28 -4, 30 -1, 32 -3, 35 +3, 44 +1, 46 +1, 50 +3.

## Paired difference against C3 v4

C3 v4 is `runs/v4-eu-cell-38-minimal-newprompt-r1/scorecard-filled.md` (3.8 flash, minimal reasoning, v4 prompt, 208/235).

- C3 v4: 208/235 = 88.5 %, 95 % CI [82.9, 93.4].
- **C3 v4 minus this cell: +6.0 points, paired 95 % CI [-0.4, +13.0].** The lower bound sits just below 0, so the interval does not exclude 0.
- Plates where the two cells differ (C3 v4 minus this cell, in hits): 02 +2, 03 +5, 06 -2, 16 +1, 19 +1, 22 -1, 23 -2, 26 +1, 30 -1, 34 +1, 35 +4, 44 +1, 46 +1, 50 +3. The losses of 2.5 flash sit on salads named as a bare "Mixed salad" (03, 35, 50) and on bare "with sauce" (16, 50).
- Method for both: `harness/stats.py` `bootstrap_diff_ci(other, this_cell, resamples=2000, seed=7)`, one set of 50 plate indices per resample applied to both cells.

Sensitivity to the closest calls (same method):

| variant | hits, recall | 95 % CI | C3 v3 minus this cell | C3 v4 minus this cell |
|---|---|---|---|---|
| as filled | 194/235 = 82.6 % | [75.2, 89.4] | +2.1 [-5.7, +10.3] | +6.0 [-0.4, +13.0] |
| stricter: 02 roast meat, 19 tzatziki, 43 soup, 47 bagel to n | 190/235 = 80.9 % | [73.3, 87.9] | +3.8 [-4.6, +12.1] | +7.7 [+0.9, +15.0] |
| more lenient: 19 gyros, 16 and 50 sauce to Y | 197/235 = 83.8 % | [76.5, 90.6] | +0.9 [-6.7, +8.9] | +4.7 [-1.6, +11.4] |

## Judgment calls that were not obvious

| plate | call | verdict | why unsure |
|---|---|---|---|
| 19 | "Grilled meat" for the gyros/döner sliced meat | n | names neither dish nor animal; follows the strict "Grilled meat" n on 45; 25-flash v3 "Kebab meat" named the dish |
| 02 | "Roast meat" for "roast meat (lamb/beef) in gravy" | Y | no animal named, but the gold row leaves the animal open and 25-flash v3 "Roast meat with gravy" got Y |
| 16, 50 | "Döner Kebab with sauce", "Doner kebab meat with sauce" for the tomato sauce | n, n | bare "with sauce" names no kind (25-flash v3 call on 50, C3 v4 note on 42); the sauce is visible |
| 19 | "Garlic sauce" for "tzatziki/garlic yogurt sauce" | Y | garlic named, yogurt not; follows the C "garlic sauce" precedent on 35 |
| 43 | "Mashed potato puree with bacon bits" for the creamy soup bowl | Y | purée for soup read as form (rule 2), as L1 "creamy grits with bacon"; no sheet judged this name |

## Findings

1. Gemini 2.5 Flash on the EU host at minimal reasoning with the v4 prompt reaches 194/235 = 82.6 % [75.2, 89.4] with 0 hallucinations and 0 error records, at $0.0060 a plate and an 11.3 s median.
2. C3 v3 minus this cell is +2.1 points [-5.7, +10.3]; C3 v4 minus this cell is +6.0 points [-0.4, +13.0]. Neither interval excludes 0, but the C3 v4 gap is close to it. The gap comes mostly from bare "Mixed salad" labels (03, 35, 50) and bare "with sauce" (16, 50).
