# Plate-identification scoring worksheet

- results: `runs/v4-eu-cell-25-flash-newprompt-r3/results.json`
- config: `eu-cell-25-flash-newprompt` (started 2026-10-06T13:44:40.018005+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
- prefill: 125 Y, 16 n, 0 conflicts, 94 need judgment, from 19 earlier sheets

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 49/50 |
| items named (total) | 210 |
| items named (mean/plate) | 4.2 |
| distinct item names | 191 |
| latency mean (s) | 12.4 |
| latency median (s) | 11.16 |
| latency max (s) | 37.46 |
| cost / plate (USD) | 0.005756 |
| cost total (USD) | 0.287798 |

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

- **production**: Dark bread slice, Small sausages, Scrambled eggs, Baked beans in tomato sauce, Cucumber slices, Ham slices, Margarine (Dorina)

| gold core item | production | notes |
|---|---|---|
| scrambled eggs | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Scrambled eggs" |
| bacon/ham slices | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Ham slices" (C3 "cooked ham or bacon slices", D3 "ham") |
| frankfurter sausages | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Small sausages" (as "mini sausages", cloud and D) |
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Baked beans in tomato sauce" |
| brown bread slice | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Dark bread slice" (as "brown bread", D3) |
| cucumber slices | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Cucumber slices" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Margarine (Dorina)" is the optional margarine tub |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter/margarine packets

### 02, Roast (Sunday) dinner

- **production**: Roasted beef, Yorkshire pudding, Roasted potatoes, Mixed steamed vegetables, Gravy

| gold core item | production | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y | "Roasted beef": beef is one of the two kinds the gold row allows; gravy optional (r1 "Roast meat" Y) |
| Yorkshire pudding | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Yorkshire pudding" |
| roast potatoes | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Roasted potatoes" |
| broccoli | n | "Mixed steamed vegetables" names no broccoli (strict rule 1, "mixed vegetables" is the rule example) |
| cabbage/greens | n | "Mixed steamed vegetables" is a generic label (strict rule 1; r1 "Mixed cooked greens" n) |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none | "Gravy" optional; "Mixed steamed vegetables" has the greens and broccoli as referent |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **production**: Grilled salmon fillet, Mixed green salad with feta and avocado

| gold core item | production | notes |
|---|---|---|
| grilled salmon fillets | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Grilled salmon fillet" |
| feta cheese | Y merged | "Mixed green salad with feta and avocado" names the feta (r1 same wording, Y merged) |
| kalamata olives | n | "Mixed green salad" is not the determinate dish "Greek salad" and names no olives (strict rule 1, r1 call) |
| avocado | Y merged | same item names the avocado (r1) |
| cherry tomatoes | n | rule 1, bare mixed salad names no tomato (r1, 25-flash v3 call) |
| cucumber | n | rule 1, as above |
| lettuce/romaine | Y merged | same item, "green salad" names the leaves (r2 call on "Mixed green salad with cucumber, tomato, and red onion"; a bare "mixed salad" stays n, r1 and gpt6 r1) |
| red onion | n | rule 1, as above |
| **core recall (/8)** | 4/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04, Cheeseburger with fries

- **production**: Cheeseburger, French fries, Ketchup, Pickled cucumbers, Dark beer

| gold core item | production | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Cheeseburger" |
| thick-cut fries/steak fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "french fries" |
| ketchup | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Ketchup" |
| pickles/gherkins | Y | "Pickled cucumbers" (as C3 v3 "pickled cucumbers with sauce" on 29) |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Dark beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **production**: White rice, Chicken with green sauce and mushrooms

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | "Chicken with green sauce and mushrooms" (r1 "Chicken in creamy green sauce"); the pale chunks in the sauce are the mushroom referent (photo) |
| white rice | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "white rice" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "with mushrooms": pale chunks in the sauce are the referent (photo), a part inside a present item either way (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: Salmon and avocado sushi rolls, Tuna nigiri, White fish nigiri, Soy sauce, Wasabi paste, Pickled ginger, White wine, Miso soup

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Salmon and Avocado Sushi Rolls" |
| tuna nigiri | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Tuna nigiri" |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "White fish nigiri" |
| pickled ginger | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "pickled ginger" |
| wasabi | Y | "Wasabi paste" |
| soy sauce | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Soy sauce" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "White wine" optional; "Miso soup" is the black lacquer bowl with dark liquid at top left (25-flash v3 photo check), rule 3 |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: Spaghetti Bolognese with Mixed Vegetables

| gold core item | production | notes |
|---|---|---|
| spaghetti | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "spaghetti bolognese with mixed vegetables" |
| ground beef/meat tomato sauce | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "spaghetti bolognese with mixed vegetables" |
| corn kernels | n | prefill n from eu-cell-38-minimal-newprompt, v4-eu-cell-31-lite-newprompt-r1: no reported item covered it |
| green beans | n | prefill n from eu-cell-38-minimal-newprompt, v4-eu-cell-31-lite-newprompt-r1: no reported item covered it |
| carrot pieces | n | prefill n from eu-cell-38-minimal-newprompt, v4-eu-cell-31-lite-newprompt-r1: no reported item covered it |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **production**: Plain yogurt, Granola, Apple slices, Honey drizzle

| gold core item | production | notes |
|---|---|---|
| yogurt | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Plain yogurt" |
| granola (oats/puffed grains, nuts) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "granola" |
| apple slices | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Apple slices" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Honey drizzle" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **production**: Chicken and Cheese Pizza, Soft Drink

| gold core item | production | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Chicken and Cheese Pizza" (C3 name) |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none | "Soft Drink" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **production**: Chicken sandwich, Side salad, Pepsi Max

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Chicken sandwich" (cloud name) |
| green side salad (rocket/mixed leaves) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "side salad" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "Pepsi Max" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: Breaded pork schnitzel, French fries, Mixed side salad with vinaigrette, Ketchup

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | Y | "Breaded pork schnitzel" (r1 "Pork Schnitzel") |
| thick-cut fries/potato wedges | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "French fries" |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | "Mixed side salad with vinaigrette": the gold row is itself the consolidated salad (r1 "Mixed side salad with dressing") |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Ketchup" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: Sausages with mustard sauce, Mashed potatoes, Sauerkraut, Mixed salad

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y | "Sausages with mustard sauce", kind right (r1 "Sausages with gravy") |
| sauerkraut | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Sauerkraut" |
| mashed potatoes | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Mashed potatoes" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Mixed salad" is the salad on the background plate (gold trap): a trap leak, not a hallucination (r1 call) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: Cheesy noodles with caramelized onions, Mixed salad with creamy dressing

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y merged | prefill Y from v3-eu-cell-25-lite-newprompt: "Cheesy noodles with caramelized onions": noodles in melted cheese, regional name lost (as "macaroni and cheese") |
| fried/caramelised onions | Y merged | "Cheesy noodles with caramelized onions" names the onions (r1 Käsespätzle item, same split) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "Mixed salad with creamy dressing" is the optional side salad plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: Beef stew with potatoes and mushrooms, Green leaf lettuce salad

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y merged | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "beef stew with potatoes and mushrooms" (D3 name, word for word) |
| boiled potatoes | Y merged | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "beef stew with potatoes and mushrooms", same item names the potatoes (r1) |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "green leaf lettuce salad" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: Weisswurst, Pretzel, Sweet Mustard, Beer

| gold core item | production | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Weisswurst" |
| pretzel (Brezel) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "pretzel" |
| sweet mustard | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Sweet Mustard" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16, Döner/gyros plate with fries and salad

- **production**: Döner Kebab meat with tomato sauce, French fries, Mixed salad with dressing and pickled pepper, Beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "döner kebab meat with tomato sauce" |
| tomato sauce over the meat | Y merged | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "döner kebab meat with tomato sauce" names the sauce |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "French fries" |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "mixed salad with dressing and pickled pepper": gold row is itself the consolidated salad (precedent) |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Beer" optional; "pickled pepper" in the salad item is the optional pepperoncini |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: French fries, Currywurst sausage, Curry ketchup

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y | "Currywurst sausage", its own item |
| curry ketchup sauce | Y | "Curry ketchup", its own item |
| curry powder | n | not named; "Curry ketchup" is the sauce row (prefill n on every earlier sheet) |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "French fries" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: Maultaschen (meat-filled pasta pockets), Creamy potato salad with bacon

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "Maultaschen (meat-filled pasta pockets)" |
| potato salad | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Creamy potato salad with bacon" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: French fries, Mayonnaise, Kebab meat, Garlic sauce, Currywurst with sauce

| gold core item | production | notes |
|---|---|---|
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "French fries" |
| gyros/döner sliced meat | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Kebab meat" (as cloud "kebab meat" on 50) |
| sliced sausage in curry/shashlik sauce | Y | "Currywurst with sauce" (r1 "Currywurst" Y) |
| tzatziki/garlic yogurt sauce | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Garlic sauce": the gold row reads "garlic yogurt sauce" (C "garlic sauce" precedent on 35) |
| mayonnaise | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Mayonnaise", its own item (D3, A) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 20, Bowl of shio ramen

- **production**: Ramen noodles, Ramen broth, Chashu (sliced pork), Mizuna greens

| gold core item | production | notes |
|---|---|---|
| ramen noodles | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Ramen noodles", its own item |
| clear (shio) broth | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Ramen broth", its own item |
| sliced chashu pork | Y | "Chashu (sliced pork)", its own item |
| leafy green herb topping (mizuna/mitsuba) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Mizuna greens" names the mizuna, so not the generic "greens" that the strict reading rejects |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **production**: Beef Pho with Meatballs and Tripe, Fresh Bean Sprouts, Fresh Basil Leaves, Extra Rice Noodles, Hot Tea

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y merged | "Beef Pho with Meatballs and Tripe" (r1 "Beef Pho Soup") |
| sliced beef and beef meatballs | Y merged | same item names the beef and the meatballs |
| bean sprouts | Y | "Fresh Bean Sprouts", its own item |
| Thai basil | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Fresh basil leaves" |
| sliced green chilli/jalapeño | n | not named |
| spring onion | n | not named |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | "Tripe" inside the pho has the white strips in the bowl as referent (photo); "Extra Rice Noodles", "Hot Tea" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: Tacos with beef, cheese, and salsa, Grilled corn on the cob, Dark carbonated drink

| gold core item | production | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y merged | "Tacos with beef, cheese, and salsa" (r1 "Tacos with beef and cheese") |
| grated cheese | Y merged | same item names the cheese |
| red salsa | Y merged | one "salsa" token credited to the red salsa (31 lite r2, gpt6 r1 and r2, mistral precedent) |
| green salsa/tomatillo | n | one salsa token cannot cover two salsas (precedent) |
| coriander/cilantro | n | not named |
| grilled corn on the cob | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "grilled corn on the cob" |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | "Dark carbonated drink" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **production**: Wet Burrito with Cheese, Lettuce, and Tomato

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | Y merged | "Wet Burrito with Cheese, Lettuce, and Tomato" (r1 "Wet burrito") |
| green chile sauce | Y merged | same item, "wet" entails the sauce (r1, 31 lite r3 precedent) |
| shredded cheddar/jack cheese | Y merged | same item names the cheese |
| shredded lettuce | Y merged | same item names the lettuce |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **production**: Battered white fish, French fries, Green peas, Tartar sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish fillet | Y | "Battered white fish" |
| chips/thick-cut fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "French Fries" |
| green peas | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Green Peas" |
| tartar sauce | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Tartar Sauce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge

### 25, American breakfast platter

- **production**: Bacon slices, Pancakes with powdered sugar, Fried egg, Breakfast sausages, Hash browns, Toasted white bread, Maple syrup, Butter

| gold core item | production | notes |
|---|---|---|
| pancakes with icing sugar | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Pancakes with powdered sugar" |
| back bacon rashers | Y | "Bacon slices" (r1 "Bacon") |
| fried egg (sunny side up) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Fried egg" |
| breakfast sausages | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Breakfast sausages" |
| hash brown/potato croquettes | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Hash browns" |
| toast slices | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "toasted white bread" (C3 name, word for word) |
| maple syrup in a shot glass | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Maple syrup" |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none | "Butter" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **production**: Vegetable Pulao, Indian Flatbread (Roti/Paratha), Papadum, Plain Yogurt, Vegetable Soup, Curry with Paneer, Dal (Lentil Stew), Mixed Vegetable Curry, Green Bean and Potato Curry, Cabbage Salad

| gold core item | production | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "vegetable pulao" (r1 "vegetable pulao rice") |
| chapati/roti | Y | "Indian Flatbread (Roti/Paratha)" names the roti |
| papad (papadum) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Papadum" |
| curd/raita | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Plain Yogurt" |
| dal (lentil curry) | Y | "Dal (Lentil Stew)" (r1 same name) |
| kofta/dumpling curry in orange gravy | n | no item names the kofta; "Mixed Vegetable Curry" takes the eggplant row, "Green Bean and Potato Curry" names no dumpling (strict rule 1, as gpt6 r2 "potato curry" n; r1 kofta n) |
| paneer or fish curry in pale gravy | Y | "Curry with Paneer" (r1 "Paneer curry") |
| brinjal/eggplant curry | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Mixed Vegetable Curry" for the eggplant curry (D, C2, B2 precedent) |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none | "Vegetable Soup", "Cabbage Salad" optional; every curry name has a bowl (four curry names, four bowls, photo) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **production**: Stir-fried chicken with cashews and vegetables, Steamed white rice

| gold core item | production | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Stir-fried chicken with cashews and vegetables"; "vegetables" names no vegetable, so not merged (C3 v4 call) |
| red bell pepper strips | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-38-newprompt, v3-eu-cell-25-flash-newprompt and 1 more: no reported item covered it |
| onion | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-38-newprompt, v3-eu-cell-25-flash-newprompt and 1 more: no reported item covered it |
| spring onion/green onion | n | prefill n from eu-cell-35-eu-newprompt, eu-cell-38-newprompt, v3-eu-cell-25-flash-newprompt and 2 more: no reported item covered it |
| steamed white rice | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Steamed White Rice" |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): dried chilli bits

### 28, Middle-Eastern mezze spread — four composed plates plus flatbread

- **production**: Falafel bowl with bulgur, lentils, and salad, Pita bread, Spicy dipping sauce

| gold core item | production | notes |
|---|---|---|
| falafel balls | Y merged | "Falafel bowl with bulgur, lentils, and salad" names the falafel |
| grilled flatbread | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Pita bread" (cloud, 25-lite name) |
| hummus/creamy white dip | n | not named |
| green herb-chilli sauce | n | "Spicy dipping sauce" is a generic "spicy sauce" (strict rule 1 example); r1 "Chili Herb Sauce" named the herb |
| yellow bulgur or couscous | Y merged | same item names the bulgur |
| black beluga lentils | Y merged | same item names the lentils (r1 "Cooked Lentils" Y) |
| pickled white cabbage slaw | n | "salad" inside the bowl names no cabbage (strict rule 1, r1 call on "Mixed Vegetable Salad") |
| green olives | n | not named |
| **core recall (/8)** | 4/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: Wheat beer, Pickled gherkins, Honey, Cured salami slices, Cheese cubes, Green olives

| gold core item | production | notes |
|---|---|---|
| pickled gherkin slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "pickled gherkins" |
| salami slices | Y | "Cured salami slices" |
| cheese cubes | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "cheese cubes" |
| green olives | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Green olives" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Wheat beer" optional; "Honey" is the golden liquid in the pickle bowl (photo), rule 3 |
| **over-decomposed** | 0 |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30, Mixed grill board (plancha de grillades)

- **production**: Grilled steak, Roasted pork ribs, Grilled sausage, Grilled bacon strips, Chicken and vegetable skewers, Baked potato with cheese topping, Mixed leaf salad

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "roasted pork ribs" |
| grilled beef steak | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Grilled steak" |
| grilled sausage | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Grilled sausage" |
| grilled meat skewer with green pepper and tomato | Y | "Chicken and vegetable skewers": the skewer is named; the gold row names no animal (r1 "Grilled meat skewers") |
| baked/roasted potato with browned cheese topping | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Baked potato with cheese topping" |
| mixed leaf salad | Y | "Mixed leaf salad", the gold row word for word |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Grilled bacon strips" is the pork belly slices (r1 call), rule 3 |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cherry tomato, steak knife

### 31, Bowl of beef/oxtail soup with buttered bread

- **production**: Beef Goulash, Rye bread with butter

| gold core item | production | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "beef goulash" |
| beef (oxtail) chunks | Y merged | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Beef Goulash", same item as the broth (precedent) |
| buttered bread slices (dark/whole-grain) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Rye bread with butter" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **production**: Green olives, Cucumber sticks, Carrot sticks, Yellow bell pepper strips, Red bell pepper strips, Deviled eggs, Hummus, Herbed hard cheese slices, Cheddar cheese slices, Salami slices, Savory crackers

| gold core item | production | notes |
|---|---|---|
| green olives | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Green olives" |
| cucumber sticks | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Cucumber sticks" |
| carrot sticks | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Carrot sticks" |
| bell pepper strips | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Yellow bell pepper strips", "Red bell pepper strips" |
| pan-fried spiced hard-boiled egg halves | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Deviled eggs" (deviled for spiced egg is prep, rule 2) |
| hummus dip | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Hummus" |
| salami/cured meat slices | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Salami slices" |
| cheese slices | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "cheddar cheese slices" |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **production**: Oatmeal, Peanut butter, Raisins, Cinnamon powder

| gold core item | production | notes |
|---|---|---|
| oatmeal/oat porridge | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "oatmeal" |
| peanut butter | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Peanut butter" |
| raisins | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Raisins" |
| ground cinnamon | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Cinnamon powder" |
| milk | n | prefill n from eu-cell-38-newprompt, eu-cell-38-prod-oldprompt, v3-eu-cell-25-flash-newprompt and 5 more: no reported item covered it |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: Waffles, Strawberry topping, Whipped cream

| gold core item | production | notes |
|---|---|---|
| waffles | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Waffles", its own item |
| strawberries (sliced fresh) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Strawberry topping" credits one row, the strawberries (C3 name, identical) |
| strawberry/berry syrup-compote | n | prefill n from v3-eu-cell-25-flash-newprompt, v3-eu-cell-38-minimal-newprompt, v4-eu-cell-25-flash-newprompt-r1 and 2 more: no reported item covered it |
| whipped cream | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Whipped cream" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **production**: Doner meat with sauce, French fries, Mixed salad, Pita bread

| gold core item | production | notes |
|---|---|---|
| gyros/döner sliced meat | Y | "Doner meat with sauce"; the sauce is not credited, so not merged (r1 "Doner meat") |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "French Fries" |
| white garlic-yogurt sauce (tzatziki) with oregano | n | "with sauce" names no sauce kind (strict rule 1, r1 call on 16 and 50) |
| shredded white cabbage | n | bare "Mixed salad" names no part (strict rule 1, r1 call) |
| tomato slices | n | rule 1, as above |
| sweetcorn | n | rule 1, as above |
| cucumber slices | n | rule 1, as above |
| shredded carrot | n | rule 1, as above |
| **core recall (/8)** | 2/8 |  |
| **hallucinations** | none | "Pita bread" is the optional flatbread basket |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: Paella with mantis shrimp, shrimp, and artichoke

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | Y merged | "Paella with mantis shrimp, shrimp, and artichoke": the named dish carries the rice |
| whole prawns (langostinos) | Y merged | same item names the shrimp |
| mantis shrimp (galeras) | Y merged | same item names the mantis shrimp |
| artichoke pieces | Y merged | same item names the artichoke |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: Pierogi Ruskie with fried onions, Coleslaw salad

| gold core item | production | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y merged | "Pierogi Ruskie with fried onions" (ruskie names the potato-cheese filling) |
| fried caramelised onion topping | Y merged | same item names the onions |
| grated carrot and cabbage salad | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Coleslaw salad" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **production**: Beef burger with bun and vegetables, French fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | "Beef burger with bun and vegetables" |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "French fries" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: Baked beans, Pork sausages, Bacon

| gold core item | production | notes |
|---|---|---|
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Baked beans" (D3 name) |
| sausage pieces | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Pork sausages" (D3 name) |
| bacon rasher | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "bacon" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **production**: French fries, Stewed meat with gravy, Liver pieces, Sausage, Cooked bacon, Fried egg, Grilled tomato

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | Y | "Liver pieces" names the organ |
| chips/French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "French fries" |
| bacon/gammon slice | Y | "Cooked bacon" |
| fried egg (remnant, yolk visible) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "fried egg" |
| sausage | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Sausage" |
| grilled tomato half | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Grilled tomato" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Stewed meat with gravy" is the flat meat slices in the gravy (r1 photo check) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: Fried fish fillet, Seasoned potato wedges, Mayonnaise

| gold core item | production | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten | Y | "Fried fish fillet"; batter not named, form (rule 2, r1 "Fried white fish") |
| potato wedges/skin-on roast potatoes | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Seasoned potato wedges" |
| tartar sauce / mayonnaise dollop | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Mayonnaise" (D3, cloud name) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **production**: Fried fish fillet with creamy sauce, White rice, Chickpea curry, Meatballs in gravy, Mashed potatoes with tomato sauce, Mixed salad with corn and red onion

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | Y merged | prefill Y from v3-eu-cell-25-flash-newprompt: "Fried fish fillet with creamy sauce" |
| sour cream / remoulade dollop | Y merged | "creamy sauce" in the fish item names the dairy dollop (25-flash v3 same name, gpt6 r1 "creamy sauce") |
| meatballs in brown gravy | Y | "Meatballs in gravy" |
| chickpea-and-cauliflower curry | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Chickpea curry" |
| white rice | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "White rice" |
| red cabbage and sweetcorn salad | Y | "Mixed salad with corn and red onion": "with corn" names this salad (38 minimal v4 and 31 lite r1 "mixed salad with corn") |
| cucumber and lettuce salad | n | not named; the corn salad item cannot cover two salads |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none | "Mashed potatoes with tomato sauce" is the optional tomato-sauced bake (r1, 25-flash v3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set — main plate, soup bowl, bread plate

- **production**: Bread with butter, Creamy potato puree with bacon bits, Fish cakes with mayonnaise, Green beans, Herbed rice, Creamy pasta salad with ham and olives, Quiche slice

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Fish cakes with mayonnaise" |
| herbed green rice | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "herbed rice" |
| green beans | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Green beans" |
| cheese-topped quiche/gratin square | Y | "Quiche slice" |
| creamy meat-and-vegetable stew | n | "Creamy pasta salad with ham and olives" is the stew misread (r1 "Creamy pasta salad", 25-flash v3 "Pasta salad with ham"), kind miss; misnamed, not a hallucination |
| creamy soup (bowl, with bacon bits) | Y | "Creamy potato puree with bacon bits" is the soup bowl, purée for soup is form (rule 2, r1 "Mashed potato puree with bacon bits" Y) |
| bread roll with butter | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Bread with butter" |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none | "Creamy pasta salad with ham and olives" is the stew misnamed, "Creamy potato puree with bacon bits" the soup bowl (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: Mixed green salad, Stewed beans, Yellow rice, Stewed cabbage, Stewed pork, Mashed potato

| gold core item | production | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Mixed green salad" (D3 name) |
| brown beans (feijão) in broth | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "stewed beans" |
| yellow seasoned rice | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "Yellow rice" |
| braised cabbage with tomato | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Stewed cabbage" (tomato not named, as 25-flash v3 "Cooked cabbage") |
| stewed meat in onion gravy | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Stewed pork": gold names no kind (as 25-flash v3 "Braised pork") |
| mashed cassava/potato purée | Y | "Mashed potato" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45, Korean hanjeongsik table spread (dozens of banchan, top-down)

- **production**: (none)  _[schema-invalid]_

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | n | prefill n: the run reported no items on this plate |
| steamed egg (gyeranjjim) in stone pot | n | prefill n: the run reported no items on this plate |
| grilled mackerel/fish | n | prefill n: the run reported no items on this plate |
| stir-fried beef in a hot stone pot | n | prefill n: the run reported no items on this plate |
| glazed spicy braised ribs/pork | n | prefill n: the run reported no items on this plate |
| sliced raw fish (hoe/sashimi) on shredded radish | n | prefill n: the run reported no items on this plate |
| vegetable fritters/jeon platter | n | prefill n: the run reported no items on this plate |
| kimchi | n | prefill n: the run reported no items on this plate |
| **core recall (/8)** | 0/8 | error record, 0 hits |
| **hallucinations** | n/a | schema-invalid record: finish_reason length, the output ran past the 8192 token cap (8153 completion tokens, JSON cut off after 25 items); scored as an error with 0 hits |
| **over-decomposed** | n/a |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: Steamed Tofu Skin Rolls, Seasoned Honeycomb Tripe, Marinated Tripe with Vegetables

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | "Seasoned Honeycomb Tripe" names the honeycomb cups |
| white boiled tripe/omasum slices in broth | Y | "Marinated Tripe with Vegetables" is the white cups with carrot pieces (photo), tripe for omasum, organ right; a second tripe token for the second row |
| fried beancurd-skin rolls (tofu skin rolls) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Steamed Tofu Skin Rolls" (frying lost, form) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | no dumplings or buns named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: Fruit and granola smoothie bowl, White wine, Red latte, Iced coffee, Eggs Benedict with salmon and side salad, Avocado and poached egg bagel, Side of cherry tomatoes with balsamic glaze, Chocolate donut with sesame seeds, Passionfruit orange drink

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | "Avocado and poached egg bagel" |
| eggs benedict with hollandaise on avocado toast | Y | "Eggs Benedict with salmon and side salad"; "salmon" is a wrong part inside a present item (rule 3, r1 "with ham") |
| yogurt bowl with granola, kiwi slices and berry compote | Y | "Fruit and granola smoothie bowl" names the granola (r1 "Berry and granola smoothie bowl" Y) |
| cherry tomato salad with balsamic drizzle | Y | "Side of cherry tomatoes with balsamic glaze" |
| seeded bagel (dark, sesame-topped) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Chocolate donut with sesame seeds" for the dark sesame bagel: ring-shaped baked good, form error (rule 2), as runpod "chocolate donut" Y and qwenvl "chocolate sesame donut" Y? |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none | "White wine", "Red latte", "Iced coffee", "Passionfruit orange drink" optional; "Chocolate donut with sesame seeds" is the bagel misnamed, "salmon" a part inside the benedict (rule 3); no menu card item named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: Plain potato chips, White cake with frosting, White bread sandwich, Vegetable samosas

| gold core item | production | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "White bread sandwich" |
| potato chips/crisps | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "plain potato chips" |
| samosas (small fried triangles) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "vegetable samosas" |
| slice of white/vanilla cake with icing — partly eaten | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "White cake with frosting" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49, Cafe sizzling-plate dinner set

- **production**: Grilled steak with gravy, Cooked sausage, Spaghetti, Cherry tomatoes, Hearty soup, Soft bread roll

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y | "Grilled steak with gravy": the gold row accepts steak (r1) |
| spaghetti (plain, buttered) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Spaghetti" |
| sausage/frankfurter | Y | "Cooked sausage" |
| cherry tomatoes | Y | "Cherry tomatoes", its own item |
| red cabbage soup (borscht-style, bowl) | Y | "Hearty soup" for the borscht bowl (r1 "Savory soup", 25-flash v3 bare "Soup" Y) |
| bread bun | Y | "Soft bread roll" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: French fries, Doner kebab meat with red sauce, Mixed side salad, Pepsi, Lager beer

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y merged | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Doner kebab meat with red sauce" |
| tomato/chili sauce over the meat | Y merged | "Doner kebab meat with red sauce": "red sauce" names the tomato or chili kind by colour (gpt6 r1 call; bare "with sauce" stays n) |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r3: "French fries" |
| iceberg lettuce salad | n | bare "Mixed side salad" names no part (strict rule 1, r1 call) |
| sliced red onion | n | rule 1, as above |
| cucumber slices | n | rule 1, as above |
| pickled gherkin and pepperoncini | n | not named |
| **core recall (/7)** | 3/7 |  |
| **hallucinations** | none | "Pepsi", "Lager beer" optional; nothing from the background plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 191/235 = 81.3% |
| hallucinations | 0 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 191 |
| cost / plate (auto) | $0.00576 |
| latency median s (auto) | 11.16 |

## Recall and bootstrap confidence interval

> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`, STRICT reading of rule 1 (a generic label such as "greens", "spicy sauce", "mixed vegetables", "vegetables", a bare "with sauce", a bare "mixed salad" where gold lists the parts, "nigiri sushi" with no fish, "grilled meat" with no animal named, earns no credit for a specific gold item). Cell: google/gemini-2.5-flash on the EU host (`eu.openrouter.ai`, Google provider, zdr), reasoning `minimal`, v4 prompt, plates repeat 3. Prefill: `--prefill` from `runs/eu-*/`, `runs/v3-eu-*/`, `runs/v4-eu-cell-*/` and the `v3-eu-cell-*` and `eu-cell-*` sheets of `op-worktrees/prompt-v3` (19 sheets read, identical copies counted once; no 2026-08 sheet). Prefill result: 125 Y (11 of them Y merged), 16 n (8 of them plate 45), 0 conflicts, 94 need judgment. Every prefilled row was kept. The 94 open rows were judged by hand in this order of precedent: this cell's r1 sheet (194/235) and r2 sheet (filled while this sheet was judged; its verdicts were compared row by row at the end and one call was aligned, 03 lettuce), `v4-eu-cell-38-minimal-newprompt-r1`, the v4 3.1 lite sheets, then the prompt-v3 `v3-eu-cell-*` sheets. Photos opened: 05, 21, 26, 29, 46. No model was called for this scoring.

- **Hits: 191/235. Recall: 81.3 %.**
- **95 % CI: [71.9, 89.8] %.**
- Method: a percentile bootstrap over plates (a cluster bootstrap). Each of 2000 resamples draws 50 plates with replacement with Python's stdlib `random.Random(7)`. The CI is the 2.5th and 97.5th percentile, with linear interpolation. The computation is `harness/stats.py` `bootstrap_recall_ci(pairs, resamples=2000, seed=7)` on the pairs that `harness.scorecard.load_filled` reads from this sheet.
- The harness default (`--score`: 10 000 resamples, seed 20260813) gives [71.9, 89.9] %.
- Side number, the 49 answered plates (plate 45 left out): 191/227 = 84.1 %, 95 % CI [76.5, 91.2] (same method, 49 plates).

Per plate hits: 01 6/6, 02 3/5, 03 4/8, 04 4/4, 05 2/2, 06 6/6, 07 2/5, 08 3/3, 09 1/1, 10 2/2, 11 3/3, 12 3/3, 13 2/2, 14 3/3, 15 3/3, 16 4/4, 17 3/4, 18 2/2, 19 5/5, 20 4/4, 21 4/6, 22 4/6, 23 4/4, 24 4/4, 25 7/7, 26 7/8, 27 2/5, 28 4/8, 29 4/4, 30 6/6, 31 3/3, 32 8/8, 33 4/5, 34 3/4, 35 2/8, 36 4/4, 37 3/3, 38 2/2, 39 3/3, 40 6/6, 41 3/3, 42 6/7, 43 6/7, 44 6/6, 45 0/8, 46 3/3, 47 5/5, 48 4/4, 49 6/6, 50 3/7.

## Hallucinations by plate

None. **0 hallucinations** on 49 answered plates. A hallucination is a food with no referent in the photo (rule 3). Plate 45 has no parsed items, so it has nothing to count.

- Trap leaks, not counted as hallucinations: 12 "Mixed salad" is the salad on the background plate (gold trap). Plate 50 names nothing from the background plate, plate 47 names no menu card item, plate 46 names no dumpling or bun.
- Referents checked on the photo: 05 "with mushrooms" (pale chunks in the sauce), 21 "Tripe" in the pho (white strips in the bowl), 26 four curry names for four curry bowls, 29 "Honey" (the golden liquid in the pickle bowl), 46 "Marinated Tripe with Vegetables" (the white omasum cups with carrot). 06 "Miso soup" follows the 25-flash v3 photo check (the black lacquer bowl with dark liquid).
- Misnamed visible objects, not counted (rule 3): 30 "Grilled bacon strips" (pork belly slices), 40 "Stewed meat with gravy" (the flat meat slices), 43 "Creamy pasta salad with ham and olives" (the stew) and "Creamy potato puree with bacon bits" (the soup), 47 "Chocolate donut with sesame seeds" (the bagel) and "salmon" inside the benedict.
- Optional items reported, no error: 01 margarine, 04 beer, 06 white wine, 08 honey drizzle, 09 soft drink, 10 Pepsi Max, 11 ketchup, 13 the side salad plate, 15 beer, 16 beer and pickled pepper, 21 extra noodles and tea, 22 cola, 25 butter, 26 soup and cabbage salad, 29 wheat beer, 35 pita bread, 42 the tomato-sauced bake, 47 four drinks, 50 Pepsi and beer.

## Errors, schema-invalid records, false unreadable

- Error records: **0** (`_summary.failures` is empty; every record is HTTP 200, `error` null, provider Google, 1 attempt each).
- Schema-invalid records: **1**, plate **45**. Cause: `finish_reason` `length`. The output ran past the `max_tokens` 8192 cap (8153 completion tokens, 719 of them reasoning), so the JSON was cut off inside the 25th item ("Seasoned radish strips") and does not parse (`parse` failed, "content is not JSON"). The cut list had named the japchae, steamed egg, mackerel, jeon, galbi-jjim and kimchi, but no item reached the app. Scored as an error record: 0/8 hits, counted in the 235.
- False unreadable: **0** (`unreadable` is false on the 49 parsed plates; plate 45 has no answer).

## Paired difference against C3 v3

C3 v3 is `op-worktrees/prompt-v3/apps/inference/eval/runs/v3-eu-cell-38-minimal-newprompt/scorecard-filled.md` (3.8 flash, minimal reasoning, v3 prompt), the same 50 plates and the same 235 gold items.

- C3 v3: 199/235 = 84.7 %, 95 % CI [78.2, 90.8] (same method, seed 7, 2000 resamples).
- This cell: 191/235 = 81.3 %, 95 % CI [71.9, 89.8].
- **C3 v3 minus this cell: +3.4 points, paired 95 % CI [-5.4, +13.8].** The interval contains 0.
- Plates where the two cells differ (C3 v3 minus this cell, in hits): 02 +2, 03 +4, 06 -3, 20 -1, 22 -2, 26 +1, 28 -1, 30 -1, 32 -3, 35 +4, 42 -1, 45 +8, 49 -1, 50 +2.
- On the 49 answered plates the difference is 0.0 points [-6.8, +7.3].

## Paired difference against C3 v4

C3 v4 is `runs/v4-eu-cell-38-minimal-newprompt-r1/scorecard-filled.md` (3.8 flash, minimal reasoning, v4 prompt, 208/235).

- C3 v4: 208/235 = 88.5 %, 95 % CI [82.9, 93.4].
- **C3 v4 minus this cell: +7.2 points, paired 95 % CI [-1.7, +17.4].** The interval contains 0.
- Plates where the two cells differ (C3 v4 minus this cell, in hits): 02 +2, 03 +4, 06 -2, 22 -2, 23 -2, 26 +1, 28 +3, 30 -1, 34 +1, 35 +5, 42 -1, 45 +8, 49 -1, 50 +2. Plate 45 alone is 8 of the 17 net hits.
- On the 49 answered plates the difference is +4.0 points [-2.9, +11.1].
- Method for both: `harness/stats.py` `bootstrap_diff_ci(other, this_cell, resamples=2000, seed=7)`, one set of 50 plate indices per resample applied to both cells.

Sensitivity to the closest calls (same method):

| variant | hits, recall | 95 % CI | C3 v3 minus this cell | C3 v4 minus this cell |
|---|---|---|---|---|
| as filled | 191/235 = 81.3 % | [71.9, 89.8] | +3.4 [-5.4, +13.8] | +7.2 [-1.7, +17.4] |
| stricter: 03 lettuce, 42 sour cream, 46 omasum, 50 sauce to n | 187/235 = 79.6 % | [69.7, 88.5] | +5.1 [-4.0, +15.9] | +8.9 [-0.4, +19.1] |
| more lenient: 26 kofta, 28 herb-chilli sauce to Y | 193/235 = 82.1 % | [72.6, 90.7] | +2.6 [-6.3, +13.1] | +6.4 [-2.4, +16.6] |

## Judgment calls that were not obvious

| plate | call | verdict | why unsure |
|---|---|---|---|
| 03 | "Mixed green salad with feta and avocado" for lettuce/romaine | Y merged | "green salad" read as naming the leaves, as the r2 sheet of this cell did; r1 and gpt6 r1 scored a bare "mixed salad" n |
| 28 | "Spicy dipping sauce" for the green herb-chilli sauce | n | strict rule 1 names "spicy sauce" as generic; r2 credited "Chili oil dipping sauce", which names the chilli |
| 42 | "Fried fish fillet with creamy sauce" for the sour cream dollop | Y merged | "creamy" names the dairy kind loosely (25-flash v3 same name Y, gpt6 r1 Y); r2 and C3 v4 scored a bare "with sauce" n |
| 50 | "Doner kebab meat with red sauce" for the tomato/chili sauce | Y merged | colour stands for the kind (gpt6 r1 call); a bare "with sauce" stays n |
| 46 | "Marinated Tripe with Vegetables" for the white omasum slices | Y | tripe for omasum, organ right (photo shows the white cups with carrot); r1 and r2 had a plant name there and scored n |

## Findings

1. Gemini 2.5 Flash on the EU host at minimal reasoning with the v4 prompt, repeat 3, reaches 191/235 = 81.3 % [71.9, 89.8] with 0 hallucinations, 0 error records and 1 schema-invalid record (plate 45, output cut at the 8192 token cap). On the 49 answered plates it reaches 84.1 %.
2. C3 v3 minus this cell is +3.4 points [-5.4, +13.8]; C3 v4 minus this cell is +7.2 points [-1.7, +17.4]. Neither interval excludes 0. Plate 45 carries 8 hits of each gap; without it the gaps are 0.0 and +4.0 points.
3. Repeat 1 scored 194/235 and this repeat 191/235. The swing sits on plate 45 (8/8 in r1, 0/8 here) and on salads and sauces named or not named per repeat (28, 35, 46, 50).
