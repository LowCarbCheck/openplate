# Plate-identification scoring worksheet

- results: `runs/v4-eu-cell-gpt6-luna-newprompt-r3/results.json`
- config: `eu-cell-gpt6-luna-newprompt` (started 2026-10-06T13:43:32.695483+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
- **failures: 1**: [{"image_id": "06", "approach": "production", "error": "API error in a 200 body: {\"message\": \"upstream connect error or disconnect/reset before headers. reset reason: connection termination\", \"code\": 502, \"metadata\": {\"error_type\": \"provider_unavailable\"}}"}]
- prefill: 83 Y, 9 n, 0 conflicts, 143 need judgment, from 18 earlier sheets

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 49/50 |
| items named (total) | 203 |
| items named (mean/plate) | 4.06 |
| distinct item names | 178 |
| latency mean (s) | 14.69 |
| latency median (s) | 14.23 |
| latency max (s) | 34.33 |
| cost / plate (USD) | 0.000871 |
| cost total (USD) | 0.043526 |

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

- **production**: Rye bread, Frankfurter sausages, Sliced cooked ham, Baked beans in tomato sauce, Scrambled eggs, Cucumber slices

| gold core item | production | notes |
|---|---|---|
| scrambled eggs | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Scrambled eggs" |
| bacon/ham slices | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "sliced cooked ham" |
| frankfurter sausages | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "frankfurter sausages" |
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Baked beans in tomato sauce" |
| brown bread slice | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Rye bread": dark bread, kind right (r1 "dark wholegrain bread") |
| cucumber slices | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Cucumber slices" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter/margarine packets

### 02, Roast (Sunday) dinner

- **production**: Roast chicken with gravy, Roasted potatoes, Mixed vegetables with mushrooms

| gold core item | production | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | n | "Roast chicken with gravy": chicken for lamb/beef, species miss (rule 2, as r1, r2) |
| Yorkshire pudding | n | not named (as r1, r2) |
| roast potatoes | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Roasted potatoes" |
| broccoli | n | "Mixed vegetables with mushrooms" names no broccoli (strict rule 1, as r1, r2 "Mixed vegetables") |
| cabbage/greens | n | same item names no cabbage (strict rule 1, as r1, r2) |
| **core recall (/5)** | 1/5 |  |
| **hallucinations** | none | "Mixed vegetables with mushrooms" is the visible vegetable heap |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **production**: Grilled salmon, Mixed salad with cucumber, tomato and red onion, Feta cheese, Olives

| gold core item | production | notes |
|---|---|---|
| grilled salmon fillets | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "grilled salmon" |
| feta cheese | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Feta cheese", named on its own |
| kalamata olives | Y | "Olives", named on its own: olive kind right, the variety is not a species (as r1, r2 "Kalamata olives"; 29 "Black olives" Y) |
| avocado | n | not named; the salad item names cucumber, tomato and red onion only (as r2) |
| cherry tomatoes | Y merged | "Mixed salad with cucumber, tomato and red onion" names the tomato (r1, r2 call) |
| cucumber | Y merged | same item names the cucumber |
| lettuce/romaine | n | "mixed salad" names no leaf (strict rule 1, as r1) |
| red onion | Y merged | same item names the red onion |
| **core recall (/8)** | 6/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04, Cheeseburger with fries

- **production**: Cheeseburger, French fries, Ketchup, Pickle, Beer

| gold core item | production | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Cheeseburger" |
| thick-cut fries/steak fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "french fries" |
| ketchup | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Ketchup" |
| pickles/gherkins | Y | "Pickle" (as r1, r2 "pickles") |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **production**: cooked white rice, beef and mushroom gravy

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | n | "beef and mushroom gravy": beef for chicken, species miss (rule 2, as r1, r2) |
| white rice | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "cooked white rice" |
| **core recall (/2)** | 1/2 |  |
| **hallucinations** | none | "beef and mushroom gravy" is the visible chicken dish misread |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: (none)  _[schema-invalid; error: API error in a 200 body: {"message": "upstream connect error or disconnect/reset before headers. reset reason: connection termination", "code": 502, "metadata": {"error_type": "provider_unavailable"}}]_

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | n | prefill n: the run reported no items on this plate |
| tuna nigiri | n | prefill n: the run reported no items on this plate |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | n | prefill n: the run reported no items on this plate |
| pickled ginger | n | prefill n: the run reported no items on this plate |
| wasabi | n | prefill n: the run reported no items on this plate |
| soy sauce | n | prefill n: the run reported no items on this plate |
| **core recall (/6)** | 0/6 | error record (Azure 502 provider_unavailable in a 200 body), scored 0 hits |
| **hallucinations** | none | error record, no answer |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: Stir-fried noodles, Ground beef, Mixed vegetables

| gold core item | production | notes |
|---|---|---|
| spaghetti | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Stir-fried noodles": wheat noodles for spaghetti, form (rule 2) |
| ground beef/meat tomato sauce | Y | "Ground beef" (as r1 "Cooked ground beef") |
| corn kernels | n | "Mixed vegetables" names no vegetable (strict rule 1, as r2); the corn in the model notes is not an item |
| green beans | n | "Mixed vegetables", strict rule 1 (as r2) |
| carrot pieces | n | "Mixed vegetables", strict rule 1 (as r2) |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **production**: granola with nuts, apple slices

| gold core item | production | notes |
|---|---|---|
| yogurt | n | prefill n from v4-eu-cell-gpt6-luna-newprompt-r1, v4-eu-cell-gpt6-luna-newprompt-r2: no reported item covered it |
| granola (oats/puffed grains, nuts) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "granola with nuts" |
| apple slices | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Apple slices" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **production**: cheese pizza

| gold core item | production | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | "cheese pizza": the pizza and its cheese named, chicken topping lost (as 25-lite "pizza" Y, chicken topping not stated) |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **production**: Chicken sandwich, Cola, Coffee with milk

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Chicken sandwich" (cloud name) |
| green side salad (rocket/mixed leaves) | n | not named (as r2) |
| **core recall (/2)** | 1/2 |  |
| **hallucinations** | none | "Cola", "Coffee with milk" optional; no menu poster dish named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: breaded fried fish fillet, French fries, mixed salad with dressing, ketchup

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | n | "breaded fried fish fillet": fish for pork/veal, species miss (rule 2, as r1, r2) |
| thick-cut fries/potato wedges | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "French fries" |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "mixed salad with dressing": the gold row is itself the consolidated salad (r1, 25-flash precedent) |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: Cooked sausages with brown gravy, Mashed potatoes, Creamy egg noodles, Mixed salad with vegetables

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y | "Cooked sausages with brown gravy" (as r1 "Sausages with brown gravy", r2 "cooked sausages") |
| sauerkraut | n | "Creamy egg noodles" is the sauerkraut misread (as r1, r2 "creamy pasta"), kind miss; misnamed, not a hallucination |
| mashed potatoes | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Mashed potatoes" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | trap leak, not counted: "Mixed salad with vegetables" is the background plate (model notes say so) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: Creamy pasta, Sauced grilled meat strips, Mixed salad

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Creamy pasta": noodles in a cheese sauce, regional name lost (as 25-lite "Cheesy noodles") |
| fried/caramelised onions | n | "Sauced grilled meat strips" ("a small handful") is the onion heap misread, kind miss (as r1, r2) |
| **core recall (/2)** | 1/2 |  |
| **hallucinations** | none | "Sauced grilled meat strips" points at the visible onion heap (r1, r2 call) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: Beef and potato stew, Lettuce leaves

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y merged | "Beef and potato stew" (as r2 "Beef and potato stew with gravy") |
| boiled potatoes | Y merged | same item names the potatoes (as r1, r2) |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "Lettuce leaves" (as r1 "Lettuce", r2 "Leaf lettuce") |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: cooked white asparagus, cooked spinach, mustard dipping sauce, dark beer, glazed ring doughnut

| gold core item | production | notes |
|---|---|---|
| Weisswurst sausages in hot water | n | "cooked white asparagus" is the white sausages misread (photo), vegetable for sausage, kind miss; misnamed, not a hallucination |
| pretzel (Brezel) | n | "glazed ring doughnut" is the pretzel misread (photo): sweet fried pastry for lye bread, kind miss (strict) |
| sweet mustard | Y | "mustard dipping sauce": mustard named, sweetness is prep (as r1, r2) |
| **core recall (/3)** | 1/3 |  |
| **hallucinations** | none | "cooked spinach" is the parsley (optional), "dark beer" the wheat beer (optional); misnamed, not counted |
| **over-decomposed** | 0 |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16, Döner/gyros plate with fries and salad

- **production**: French fries, Meat in tomato sauce, Mixed salad with dressing, Beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | n | "Meat in tomato sauce" names neither the dish nor an animal (strict rule 1, as 25-flash v4 r1 "Grilled meat" n on 19); r1, r2 named beef |
| tomato sauce over the meat | Y | "Meat in tomato sauce" names the tomato sauce; the meat is not credited, so not merged |
| French fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "French fries" |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "mixed salad with dressing": the gold row is itself the consolidated salad (precedent) |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none | "Beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: French fries, Currywurst with curry sauce

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y merged | "Currywurst with curry sauce" (as r1, r2) |
| curry ketchup sauce | Y merged | same item names the curry sauce (as r1, r2) |
| curry powder | n | curry dusting not named (as r1, r2) |
| French fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "French fries" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: meat-filled pasta parcels, buttered potatoes with herbs

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "meat-filled pasta parcels" (as r1, r2 "meat-filled pasta dumplings") |
| potato salad | Y | "buttered potatoes with herbs": the potato pieces (model notes "yellow pieces appear to be potatoes"), kind right, dressing lost is prep (as r2 "seasoned potato cubes") |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: French fries, Grilled meat with brown gravy, Mayonnaise

| gold core item | production | notes |
|---|---|---|
| French fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "French fries" |
| gyros/döner sliced meat | n | "Grilled meat with brown gravy" names neither the dish nor an animal (strict rule 1, as 25-flash v4 r1 "Grilled meat" n on this row) |
| sliced sausage in curry/shashlik sauce | n | no sausage named (as r1) |
| tzatziki/garlic yogurt sauce | n | no garlic or yogurt sauce named; "Mayonnaise" takes the mayonnaise row (as r2) |
| mayonnaise | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Mayonnaise", its own item (D3, A) |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 20, Bowl of shio ramen

- **production**: Noodle soup with broth, Cooked chicken breast, Leafy greens

| gold core item | production | notes |
|---|---|---|
| ramen noodles | Y merged | "Noodle soup with broth": noodle soup, ramen form (as r1, r2) |
| clear (shio) broth | Y merged | same item names the broth (as r1, r2) |
| sliced chashu pork | n | "Cooked chicken breast" is the pale chashu misread (model notes say the pale topping is hard to identify): chicken for pork, species miss |
| leafy green herb topping (mizuna/mitsuba) | n | "Leafy greens": "greens" is generic (strict rule 1, as r1, r2) |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **production**: beef and vegetable stir-fry, cooked rice noodles, fresh basil, banana

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | n | "beef and vegetable stir-fry" names no soup or broth; "cooked rice noodles" is a side plateful (as r1, r2) |
| sliced beef and beef meatballs | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Beef and vegetable stir-fry" names the beef (r1) |
| bean sprouts | n | not named (as r1, r2) |
| Thai basil | Y | "fresh basil" (as r1 "Fresh basil leaves") |
| sliced green chilli/jalapeño | n | not named |
| spring onion | n | not named |
| **core recall (/6)** | 2/6 |  |
| **hallucinations** | 1 | "banana" ("one medium banana"): no banana in the photo (as r1, r2) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: Three beef tacos with cheese and salsa, Grilled corn on the cob, Cola

| gold core item | production | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y merged | "Three beef tacos with cheese and salsa" (as r1, r2) |
| grated cheese | Y merged | same item names the cheese (as r1, r2) |
| red salsa | Y merged | one "salsa" credited to the red salsa (r1, r2 precedent) |
| green salsa/tomatillo | n | one salsa token cannot cover two salsas (precedent) |
| coriander/cilantro | n | not named (as r2) |
| grilled corn on the cob | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "grilled corn on the cob" |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | "Cola" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **production**: mixed salad with shredded cheese and creamy dressing

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | n | "mixed salad with shredded cheese and creamy dressing" reads the smothered burrito as a salad; no tortilla, burrito or enchilada named (as r2) |
| green chile sauce | n | "creamy dressing" names no chile sauce (strict rule 1, as r2) |
| shredded cheddar/jack cheese | Y | "shredded cheese" in the only item (as r2) |
| shredded lettuce | n | "mixed salad" names no lettuce (strict rule 1, as r1, r2) |
| **core recall (/4)** | 1/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **production**: battered fried fish, French fries, green peas, tartar sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish fillet | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "battered fried fish" |
| chips/thick-cut fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "French Fries" |
| green peas | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Green Peas" |
| tartar sauce | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Tartar Sauce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge

### 25, American breakfast platter

- **production**: Cooked bacon, Pancakes with powdered sugar, Fried egg, Pork sausages, Hash browns, Toast, Syrup, Butter portions, Sandwich on the background plate

| gold core item | production | notes |
|---|---|---|
| pancakes with icing sugar | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Pancakes with powdered sugar" |
| back bacon rashers | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Cooked bacon" |
| fried egg (sunny side up) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Fried egg" |
| breakfast sausages | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Pork sausages" |
| hash brown/potato croquettes | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Hash browns" |
| toast slices | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "toast" |
| maple syrup in a shot glass | Y | "Syrup" for the syrup shot glass (as r1, r2, C3 "pancake syrup") |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none | trap leak, not counted: "Sandwich on the background plate" (the model says so); "Butter portions" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **production**: vegetable rice pilaf, papadum, plain yogurt, mixed salad, mild lentil curry, orange curry with chunks, smooth orange lentil curry, orange curry with a chunk, green vegetable curry

| gold core item | production | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | "vegetable rice pilaf" |
| chapati/roti | n | not named (photo shows the roti under the papad; "papadum" takes the papad row, as r1, r2) |
| papad (papadum) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Papadum" |
| curd/raita | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Plain Yogurt" |
| dal (lentil curry) | Y | "smooth orange lentil curry" (and "mild lentil curry"), as r2 "lentil curry" |
| kofta/dumpling curry in orange gravy | n | "orange curry with chunks" names no kofta or dumpling (strict rule 1, as r1, r2) |
| paneer or fish curry in pale gravy | n | "orange curry with a chunk" names no paneer or fish (strict rule 1, as r1, r2) |
| brinjal/eggplant curry | Y | "green vegetable curry" for the dark green-brown eggplant curry at the right (photo): "vegetable curry" for the eggplant curry (D, r1, r2 precedent) |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none | "mixed salad" optional; "mild lentil curry" is a visible bowl |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **production**: Chicken with stir-fry sauce, Red bell pepper, Green bell pepper, Onion

| gold core item | production | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y | "Chicken with stir-fry sauce" |
| red bell pepper strips | Y | "Red bell pepper", named on its own |
| onion | Y | "Onion", named on its own |
| spring onion/green onion | n | not named |
| steamed white rice | n | not named (as r1, r2) |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none | "Green bell pepper" visible in the stir-fry |
| **over-decomposed** | 0 | the stir-fry named as chicken, peppers and onion matches the gold rows, which list those parts; no split beyond the gold |

Optional (no recall credit): dried chilli bits

### 28, Middle-Eastern mezze spread — four composed plates plus flatbread

- **production**: naan flatbread, grilled meat pieces, falafel, couscous, cooked lentils, mixed vegetable salad, shredded cabbage slaw, chutney or dipping sauce

| gold core item | production | notes |
|---|---|---|
| falafel balls | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Falafel" |
| grilled flatbread | Y | "naan flatbread": flatbread named, naan is form (as r2 "Pita bread") |
| hummus/creamy white dip | n | not named; "chutney or dipping sauce" names no hummus (as r1, r2) |
| green herb-chilli sauce | n | "chutney or dipping sauce" names no herb or chilli (strict rule 1, as r1 "Spicy dipping sauce", r2 "Chunky dipping sauce") |
| yellow bulgur or couscous | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Couscous" |
| black beluga lentils | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Cooked lentils" (B2 name) |
| pickled white cabbage slaw | Y | "shredded cabbage slaw": cabbage kind right, pickling is prep (as r1, r2 "Shredded cabbage salad") |
| green olives | n | not named |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none | "grilled meat pieces" points at a visible plate (r2 call) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: Weissbier, Pickled cucumber, Salami, Cheese cubes, Black olives

| gold core item | production | notes |
|---|---|---|
| pickled gherkin slices | Y | "Pickled cucumber": a gherkin is a pickled cucumber (C3 "Pickled gherkins" Y; r1, r2 "Pickled vegetables" named a class and got n) |
| salami slices | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "salami" |
| cheese cubes | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "cheese cubes" |
| green olives | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Black olives" for the dark green olives (photo): same fruit, ripeness colour is form, not kind |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Weissbier" visible drink |
| **over-decomposed** | 0 |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30, Mixed grill board (plancha de grillades)

- **production**: mixed leafy salad with tomato, roasted baby potatoes, grilled chicken skewers, grilled steak, sliced grilled chicken breast

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | n | not named; "grilled steak" takes the steak row (as r2) |
| grilled beef steak | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Grilled steak" |
| grilled sausage | n | not named |
| grilled meat skewer with green pepper and tomato | Y | "grilled chicken skewers": the skewer is named and the gold row names no animal (as 25-flash v4 r1 "Grilled meat skewers") |
| baked/roasted potato with browned cheese topping | Y | "roasted baby potatoes" (as r1, r2 "Roasted potatoes", mistral "roasted potato") |
| mixed leaf salad | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Mixed leafy salad with tomato" (r1 "Mixed salad leaves with tomato") |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | "sliced grilled chicken breast" is a visible grilled meat misread |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cherry tomato, steak knife

### 31, Bowl of beef/oxtail soup with buttered bread

- **production**: Beef stew with gravy, Buttered bread

| gold core item | production | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Beef stew with gravy" |
| beef (oxtail) chunks | Y merged | "Beef stew with gravy" names the beef (as r1, r2) |
| buttered bread slices (dark/whole-grain) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "buttered bread" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **production**: green olives, celery sticks, carrot sticks, bell pepper strips, hummus, mini savory tartlets, blue cheese, cheddar cheese, sliced salami, sliced pickles

| gold core item | production | notes |
|---|---|---|
| green olives | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Green olives" |
| cucumber sticks | Y | "sliced pickles" ("a small stack" of the green pieces): cucumber pickle, pickled is prep (as r1 "Pickled cucumber slices"); "celery sticks" is the second cucumber compartment misread (r1) |
| carrot sticks | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Carrot sticks" |
| bell pepper strips | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "bell pepper strips" |
| pan-fried spiced hard-boiled egg halves | n | "mini savory tartlets" (the "golden bites") is the spiced egg compartment misread, kind miss (as r1, r2 potato rounds) |
| hummus dip | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Hummus" |
| salami/cured meat slices | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Sliced salami" |
| cheese slices | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Cheddar cheese", "Blue cheese with herbs" (25-lite name) |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none | "celery sticks" (cucumber), "mini savory tartlets" (spiced eggs) misread |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **production**: Oatmeal porridge with milk and cinnamon, Raisins, Peanut butter

| gold core item | production | notes |
|---|---|---|
| oatmeal/oat porridge | Y merged | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "oatmeal porridge with milk and cinnamon" |
| peanut butter | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Peanut butter" |
| raisins | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Raisins" |
| ground cinnamon | Y merged | "Oatmeal porridge with milk and cinnamon" names the cinnamon (as r1) |
| milk | Y merged | same item names the milk (as r1) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: waffle, strawberries, whipped cream, chocolate sauce

| gold core item | production | notes |
|---|---|---|
| waffles | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Waffle" |
| strawberries (sliced fresh) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "strawberries" |
| strawberry/berry syrup-compote | n | "chocolate sauce" is the red syrup misread, kind miss (as r1, r2) |
| whipped cream | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Whipped cream" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none | "chocolate sauce" is the red syrup misread |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **production**: French fries, Beef strips with creamy sauce, Mixed salad

| gold core item | production | notes |
|---|---|---|
| gyros/döner sliced meat | Y | "Beef strips with creamy sauce": the sliced meat, beef kind, form (as r2 "Grilled beef strips with creamy sauce") |
| French fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "French Fries" |
| white garlic-yogurt sauce (tzatziki) with oregano | n | "creamy sauce" names no kind (strict rule 1, as r1, r2) |
| shredded white cabbage | n | "Mixed salad" names no part (strict rule 1, as r1, r2) |
| tomato slices | n | rule 1, as above |
| sweetcorn | n | rule 1, as above |
| cucumber slices | n | rule 1, as above |
| shredded carrot | n | rule 1, as above |
| **core recall (/8)** | 2/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: toasted short pasta, prawns, squid

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | n | "toasted short pasta" for the saffron rice (photo: plainly rice): pasta for rice, kind miss |
| whole prawns (langostinos) | Y | "prawns" ("several prawns") |
| mantis shrimp (galeras) | n | "prawns" takes the prawn row; no mantis shrimp named (as r2); "squid" is the artichoke or mantis strips misread, not a hallucination |
| artichoke pieces | n | not named (as r1, r2) |
| **core recall (/4)** | 1/4 |  |
| **hallucinations** | none | "squid" is the artichoke or mantis strips misread |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: steamed dumplings with sauce, shredded cabbage and carrot salad

| gold core item | production | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "steamed dumplings with sauce": dumplings named, steamed for boiled is prep (r1) |
| fried caramelised onion topping | n | prefill n from v3-eu-cell-mistral-medium-newprompt, v4-eu-cell-gpt6-luna-newprompt-r1, v4-eu-cell-gpt6-luna-newprompt-r2: no reported item covered it |
| grated carrot and cabbage salad | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "shredded cabbage and carrot salad" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **production**: Cheeseburger with lettuce and sesame bun, French fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | "Cheeseburger with lettuce and sesame bun" (as r2 "Sesame-seed beef cheeseburger with lettuce") |
| French fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "French fries" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: Baked beans in tomato sauce, Cooked bacon

| gold core item | production | notes |
|---|---|---|
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "baked beans in tomato sauce" |
| sausage pieces | n | prefill n from v4-eu-cell-gpt6-luna-newprompt-r1, v4-eu-cell-gpt6-luna-newprompt-r2: no reported item covered it |
| bacon rasher | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Cooked bacon" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **production**: beef stew with gravy, French fries, grilled pork loin slices, fried egg

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | n | "beef stew with gravy" for liver: organ identity is kind (rule 2, as r1, r2) |
| chips/French fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "French fries" |
| bacon/gammon slice | Y | "grilled pork loin slices": gammon is pork, cut (rule 2, as r1 "Grilled pork steak", r2 "Roast pork slices") |
| fried egg (remnant, yolk visible) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "fried egg" |
| sausage | n | not named |
| grilled tomato half | n | not named |
| **core recall (/6)** | 3/6 |  |
| **hallucinations** | none | "beef stew with gravy" is the liver misread |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: roasted sweet potato wedges, corn on the cob, garlic mayonnaise dip

| gold core item | production | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten | n | no fish named; "corn on the cob" is the battered fish misread (as r1, photo), kind miss, not a hallucination |
| potato wedges/skin-on roast potatoes | n | "roasted sweet potato wedges": sweet potato is another species (rule 2, as r1, r2) |
| tartar sauce / mayonnaise dollop | Y | "garlic mayonnaise dip": mayonnaise named (as r1, r2 "creamy dipping sauce") |
| **core recall (/3)** | 1/3 |  |
| **hallucinations** | none | "corn on the cob" is the battered fish misread |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **production**: Breaded fried cutlet with creamy sauce, White rice, Corn kernels, Grilled meat pieces, Red cabbage salad

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | n | "Breaded fried cutlet with creamy sauce" names no fish (strict rule 1; r1, r2 named chicken, species miss); photo shows the fish fillet |
| sour cream / remoulade dollop | Y | "creamy sauce" in the same item names the dollop (as r1); the cutlet is not credited, so not merged |
| meatballs in brown gravy | n | "Grilled meat pieces" names neither the dish nor an animal (strict rule 1, as 25-flash v4 r1 "Grilled meat" n on 19); photo shows the meatballs |
| chickpea-and-cauliflower curry | n | not named (as r1, r2) |
| white rice | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "White rice" |
| red cabbage and sweetcorn salad | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Red cabbage salad" plus "Corn kernels" (as 25-lite "Mixed salad with red cabbage and onion" plus "Sweetcorn") |
| cucumber and lettuce salad | n | not named |
| **core recall (/7)** | 3/7 |  |
| **hallucinations** | none | "Grilled meat pieces" is the meatballs |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set — main plate, soup bowl, bread plate

- **production**: Breaded fish with creamy tartar sauce, Seasoned rice, Green beans, Creamy pasta, Bread with butter, Creamy bacon sauce

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | "Breaded fish with creamy tartar sauce": breaded cakes with a white topping, form (as r1 "Breaded fish fillets with creamy sauce") |
| herbed green rice | Y | "Seasoned rice" (as r1, r2 "Cooked rice") |
| green beans | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Green beans" |
| cheese-topped quiche/gratin square | n | no square named; "Creamy pasta" (half a cup) is not a quiche or gratin, kind miss |
| creamy meat-and-vegetable stew | n | "Creamy pasta" is the stew misread, pasta for meat stew, kind miss (as C3 "pasta or potato salad" n); misnamed, not a hallucination |
| creamy soup (bowl, with bacon bits) | Y | "Creamy bacon sauce" ("a small bowl") is the soup bowl with bacon bits: sauce for soup is form (as r2 "Creamy sauce" a small bowlful) |
| bread roll with butter | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Bread with butter" |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none | "Creamy pasta" is the stew misread |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: mixed salad, cooked brown beans, yellow rice, potato and mixed vegetable stew

| gold core item | production | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "mixed salad": the gold row is the one salad on the plate (as 25-flash "Mixed green salad") |
| brown beans (feijão) in broth | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Cooked brown beans" |
| yellow seasoned rice | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Yellow rice" |
| braised cabbage with tomato | n | "potato and mixed vegetable stew" names no cabbage (strict rule 1; r1, r2 named the cabbage) |
| stewed meat in onion gravy | n | not named |
| mashed cassava/potato purée | Y | "potato and mixed vegetable stew" names the potato (as r1, r2 same call) |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45, Korean hanjeongsik table spread (dozens of banchan, top-down)

- **production**: Grilled fish fillet, Creamy vegetable soup, Mixed cooked vegetables, Cooked beans, Green beans in tomato sauce, Mixed salad with cucumber and tomato, Noodles with vegetables, Grilled meat, Cooked vegetable and meat dish, Tofu with tomato sauce, Grilled asparagus

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Noodles with vegetables": japchae is glass noodles with vegetables, the only noodle item; the r1 call went to the soup bowl because that name said "mushrooms" (photo) |
| steamed egg (gyeranjjim) in stone pot | n | no egg dish named (as r1, r2) |
| grilled mackerel/fish | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Grilled fish fillet" |
| stir-fried beef in a hot stone pot | n | "Cooked vegetable and meat dish" names no animal (strict rule 1, as r1, r2) |
| glazed spicy braised ribs/pork | n | "Grilled meat" names no animal (strict rule 1, as r1 same name) |
| sliced raw fish (hoe/sashimi) on shredded radish | n | not named |
| vegetable fritters/jeon platter | n | no fritter or pancake named |
| kimchi | n | not named; "Tofu with tomato sauce" reads the kimchi as tomato sauce, kind miss (as r1) |
| **core recall (/8)** | 2/8 |  |
| **hallucinations** | none | "Grilled asparagus" (green chillies) and other renamed dishes; no empty bowl, rice or unserved soup named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: Fried gluten puffs, Tofu skin, Spicy beef tripe

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | "Spicy beef tripe": the one tripe token goes to the curried honeycomb tripe |
| white boiled tripe/omasum slices in broth | n | one tripe token cannot cover two gold rows; "Fried gluten puffs" is the pale porous omasum misread (model notes), kind miss; not a dumpling, so no trap |
| fried beancurd-skin rolls (tofu skin rolls) | Y | "Tofu skin" (as r1 "Steamed tofu skin") |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | "Fried gluten puffs" is the omasum misread; no dumpling or bun named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: Kiwi and berry yogurt bowl with granola, Grain salad, Red berry sauce, Savory toast with creamy topping, Glazed cherry tomato skewers, Coleslaw, Avocado toast with a creamy topping, Sesame bagel, Coffee with milk, Chocolate dessert in a small cup

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | "Avocado toast with a creamy topping": the poached egg read as a topping (as r1, same name minus "a") |
| eggs benedict with hollandaise on avocado toast | n | "Savory toast with creamy topping" names no egg or hollandaise (strict rule 1, as r1 "Savory bites with creamy sauce", r2 "Savory canapés") |
| yogurt bowl with granola, kiwi slices and berry compote | Y | "Kiwi and berry yogurt bowl with granola" (as r2) |
| cherry tomato salad with balsamic drizzle | Y | "Glazed cherry tomato skewers": skewer for salad is form, glaze is the balsamic (as r1, r2) |
| seeded bagel (dark, sesame-topped) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "Sesame bagel": the real bagel on the table, not a menu card item |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none | "Red berry sauce" (beetroot latte), "Coleslaw" (purple microgreens), "Coffee with milk" (iced latte), "Grain salad" and "Chocolate dessert in a small cup" (low confidence, read as the sprout garnish and the passion fruit drink); no menu card item named |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: Potato chips, White bread with ketchup, Mashed potatoes, Roasted potato pieces

| gold core item | production | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | "White bread with ketchup": the sandwich bread, filling lost (as r1, r2 "white bread") |
| potato chips/crisps | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "Potato chips" |
| samosas (small fried triangles) | n | not named; "Roasted potato pieces" is the samosa triangles misread, kind miss |
| slice of white/vanilla cake with icing — partly eaten | n | "Mashed potatoes" (a large scoop) is the white cake misread, kind miss (as r1) |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none | "Roasted potato pieces" (samosas), "Mashed potatoes" (cake) misread; the ketchup is part of a visible item |
| **over-decomposed** | 0 |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49, Cafe sizzling-plate dinner set

- **production**: Noodles with tomato, Glazed beef, Brown soup or dipping sauce, Bread sandwich

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y | "Glazed beef" (as r1 "Glazed grilled beef") |
| spaghetti (plain, buttered) | Y merged | "Noodles with tomato" (as r1 "Cooked noodles with tomato") |
| sausage/frankfurter | n | not named |
| cherry tomatoes | Y merged | same item names the tomato (as r1) |
| red cabbage soup (borscht-style, bowl) | Y | "Brown soup or dipping sauce" for the soup bowl (as r1 "Brown soup or sauce") |
| bread bun | Y | "Bread sandwich" is the bread bun: bread kind right, form (as r2 "Cheese sandwich") |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none | "Bread sandwich" is the bun |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: French fries, Doner kebab meat with sauce, Mixed salad with cucumber and cabbage, Flatbread, Cola

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Doner kebab meat with sauce"; the sauce is not credited, so not merged |
| tomato/chili sauce over the meat | n | "Doner kebab meat with sauce": bare "with sauce" names no kind (strict rule 1, as 25-flash v4 r1; r1 "red sauce" Y) |
| French fries | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r2: "French fries" |
| iceberg lettuce salad | n | "Mixed salad with cucumber and cabbage": cabbage for iceberg lettuce, kind miss (as mistral "cabbage" n on this row) |
| sliced red onion | n | not named |
| cucumber slices | Y | "Mixed salad with cucumber and cabbage" names the cucumber (as r2 "Shredded salad with cucumber") |
| pickled gherkin and pepperoncini | n | not named |
| **core recall (/7)** | 3/7 |  |
| **hallucinations** | 1 | "Flatbread" ("a small piece", low): no bread on the plate or the background plate (as r2) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 145/235 = 61.7 % |
| hallucinations | 2 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 178 |
| cost / plate (auto) | $0.00087 |
| latency median s (auto) | 14.23 |

## Recall and bootstrap confidence interval

> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`, STRICT reading of rule 1 (a generic label such as "greens", "spicy sauce", "mixed vegetables", a bare "mixed salad" where gold lists the parts, "nigiri sushi" with no fish named, "meat", "grilled meat" or "cutlet" with no animal and no dish named, earns no credit for a specific gold item). Cell: openai/gpt-6-luna on the EU OpenRouter host (`only: azure/eu`, zero retention), no reasoning parameter, v4 prompt, plates repeat 3. Prefill: `--prefill` from `runs/eu-*/`, `runs/v3-eu-*/` and `runs/v4-eu-cell-*/` sheets here (r1 and r2 of this cell included), plus the `v3-eu-cell-*` and `eu-cell-*` sheets in `op-worktrees/prompt-v3` (no 2026-08 sheet; 18 distinct sheets, 5167 remembered verdicts). Prefill result: 83 Y (2 of them Y merged), 9 n (6 of them the empty plate 06), 0 conflicts, 143 need judgment. Every prefilled row was kept. The 143 open rows were judged by hand in this order of precedent: this cell's r1 and r2 sheets, `v4-eu-cell-38-minimal-newprompt-r1`, the v4 3.1 lite sheets, then the prompt-v3 `v3-eu-cell-*` sheets; the v4 25-flash r1 sheet was read for the "Grilled meat" call on 19. Photos opened: 15, 26, 30, 36, 42, 47, 50 (r1 and r2 photo calls kept for 12, 13, 20, 21, 32, 41, 43, 48). No model was called for this scoring.

- **Hits: 145/235. Recall: 61.7 %.**
- **95 % CI: [53.6, 69.7] %.**
- Method: a percentile bootstrap over plates (a cluster bootstrap, because a plate's items succeed or fail together). Each of 2000 resamples draws 50 plates with replacement with Python's stdlib `random.Random(7)`. Recall of a resample is the sum of its hits over the sum of its gold items. The CI is the 2.5th and 97.5th percentile of the 2000 values, with linear interpolation. The computation is `harness/stats.py` `bootstrap_recall_ci(pairs, resamples=2000, seed=7)`.
- The harness default (`--score`: 10 000 resamples, seed 20260813) gives [53.8, 69.4] %.
- Plate 06 is an error record and counts as 0/6. On the 49 answered plates recall is 145/229 = 63.3 %, 95 % CI [55.8, 70.8] (same method).

Per plate hits: 01 6/6, 02 1/5, 03 6/8, 04 4/4, 05 1/2, 06 0/6, 07 2/5, 08 2/3, 09 1/1, 10 1/2, 11 2/3, 12 2/3, 13 1/2, 14 3/3, 15 1/3, 16 3/4, 17 3/4, 18 2/2, 19 2/5, 20 2/4, 21 2/6, 22 4/6, 23 1/4, 24 4/4, 25 7/7, 26 5/8, 27 3/5, 28 5/8, 29 4/4, 30 4/6, 31 3/3, 32 7/8, 33 5/5, 34 3/4, 35 2/8, 36 1/4, 37 2/3, 38 2/2, 39 2/3, 40 3/6, 41 1/3, 42 3/7, 43 5/7, 44 4/6, 45 2/8, 46 2/3, 47 4/5, 48 2/4, 49 5/6, 50 3/7.

Repeats of this cell (same method): r1 157/235 = 66.8 %, r2 147/235 = 62.6 %, r3 145/235 = 61.7 %. r1 minus r3: +5.1 points, paired 95 % CI [-0.8, +11.8]. r2 minus r3: +0.9 points, paired 95 % CI [-4.2, +5.6]. Plate 06 alone costs r3 4 hits against r1 and 2 against r2.

## Hallucinations by plate

- **21: 1.** "banana" ("one medium banana"). No banana is in the photo (the same item and the same call as r1 and r2).
- **50: 1.** "Flatbread" ("a small piece", low confidence). No bread is visible on the plate, and the background plate holds none (photo; the same call as r2).
- Total: **2 hallucinations** on 49 answered plates. A hallucination is a food with no referent in the photo (rule 3).
- Trap leaks, not counted: 2. Plate 25 "Sandwich on the background plate" (the model names it so). Plate 12 "Mixed salad with vegetables" is the background plate (the model notes say so). Plate 50 names nothing from the background plate, plate 47 names no menu card item, plate 46 names no dumpling or bun, plate 39 names no egg or toast, plate 45 names no empty bowl, rice or unserved soup.
- Misnamed visible objects, not counted (rule 3): 05 "beef and mushroom gravy" (chicken dish), 12 "Creamy egg noodles" (sauerkraut), 13 "Sauced grilled meat strips" (the onion heap; the gold trap warns against invented meat, but the item points at the visible pile on top, as r1 and r2), 15 "cooked white asparagus" (Weisswurst), "glazed ring doughnut" (pretzel), "cooked spinach" (parsley), 20 "Cooked chicken breast" (chashu), 32 "celery sticks" (cucumber), "mini savory tartlets" (spiced eggs), 34 "chocolate sauce" (syrup), 36 "toasted short pasta" (rice), "squid" (artichoke or mantis strips), 41 "corn on the cob" (battered fish), 43 "Creamy pasta" (stew), 45 "Grilled asparagus" (green chillies) and other renamed dishes, 46 "Fried gluten puffs" (omasum), 47 "Red berry sauce" (beetroot latte), "Coleslaw" (purple microgreens), "Grain salad" and "Chocolate dessert in a small cup" (read as the sprout garnish and the passion fruit drink), 48 "Mashed potatoes" (cake), "Roasted potato pieces" (samosas).

## Errors, schema-invalid records, false unreadable

- Error records: **1, plate 06.** Cause: OpenRouter returned HTTP 200 with an error body, code 502, `error_type` `provider_unavailable`, "upstream connect error or disconnect/reset before headers. reset reason: connection termination". The record shows `raw_content` null, `parse` "empty", `finish_reason` null, no tokens and no cost. The record holds `attempts: 1`; the caller reports that the call failed twice, after a retry. The provider is Azure EU (`only: azure/eu`, `allow_fallbacks: false`), so no other provider could answer. It is a transport failure, not a content filter refusal.
- Plate 06 is scored as an error record: every gold row `n`, 0/6 hits, no hallucination. It stays in the denominator (235).
- Schema-invalid records: **1** (`schema_valid` false on 06 only, "empty content"; 49/50 valid). Error and invalid ids: 06.
- No Azure content filter refusal on the 49 answered plates (every one is HTTP 200, 1 attempt, valid JSON).
- False unreadable: **0** (`unreadable` is false on all 49 answers).

## Paired differences against C3

Same 50 plates, same 235 gold items, `harness/stats.py` `bootstrap_diff_ci(c3, this_cell, resamples=2000, seed=7)`. Each resample draws one set of 50 plate indices with `random.Random(7)` and applies it to both cells, so plate difficulty cancels. The CI is the 2.5th and 97.5th percentile of the 2000 differences, with linear interpolation.

| comparison | C3 | this cell | C3 minus this cell | paired 95 % CI |
|---|---|---|---|---|
| C3 v3 (`op-worktrees/prompt-v3/.../runs/v3-eu-cell-38-minimal-newprompt`) | 199/235 = 84.7 % [78.2, 90.8] | 145/235 = 61.7 % [53.6, 69.7] | **+23.0 points** | **[+13.4, +32.5]** |
| C3 v4 (`runs/v4-eu-cell-38-minimal-newprompt-r1`) | 208/235 = 88.5 % [82.9, 93.4] | 145/235 = 61.7 % [53.6, 69.7] | **+26.8 points** | **[+18.4, +35.3]** |

Both intervals exclude 0 by a wide margin. Without plate 06 (49 plates on both sides) the differences are +22.3 [+13.2, +31.4] and +25.8 [+17.6, +33.6].

- Plates where C3 v3 differs (C3 minus this cell, in hits): 02 +4, 03 +2, 05 +1, 06 +3, 08 +1, 10 +1, 11 +1, 12 +1, 13 +1, 15 +2, 16 +1, 19 +3, 20 +1, 21 +2, 22 -2, 23 +3, 26 +3, 27 -1, 28 -2, 30 +1, 32 -2, 33 -1, 35 +4, 36 +3, 37 +1, 39 +1, 40 +3, 41 +2, 42 +2, 43 +1, 44 +2, 45 +6, 46 +1, 47 +1, 48 +2, 50 +2.
- Plates where C3 v4 differs: 02 +4, 03 +2, 05 +1, 06 +4, 08 +1, 10 +1, 11 +1, 12 +1, 13 +1, 15 +2, 16 +1, 19 +3, 20 +2, 21 +2, 22 -2, 23 +1, 26 +3, 27 -1, 28 +2, 30 +1, 32 +1, 33 -1, 34 +1, 35 +5, 36 +3, 37 +1, 39 +1, 40 +3, 41 +2, 42 +2, 43 +1, 44 +2, 45 +6, 46 +1, 47 +1, 48 +2, 50 +2.

Sensitivity to the closest calls (same method):

| variant | hits, recall | 95 % CI | C3 v3 minus this cell | C3 v4 minus this cell |
|---|---|---|---|---|
| as filled | 145/235 = 61.7 % | [53.6, 69.7] | +23.0 [+13.4, +32.5] | +26.8 [+18.4, +35.3] |
| more lenient: 16 meat, 19 meat, 42 fish, 42 meatballs, 15 pretzel to Y | 150/235 = 63.8 % | [55.6, 71.8] | +20.9 [+11.6, +30.2] | +24.7 [+16.2, +33.5] |
| stricter: 09 pizza, 30 skewer, 18 potato salad, 43 soup, 32 cucumber to n | 140/235 = 59.6 % | [51.9, 67.3] | +25.1 [+15.7, +34.2] | +28.9 [+20.4, +37.2] |

The sign holds in every variant, and every CI excludes 0.

## Judgment calls that were not obvious

| plate | call | verdict | why unsure |
|---|---|---|---|
| 16, 19, 42 | "Meat in tomato sauce" for the döner meat, "Grilled meat with brown gravy" for the gyros, "Grilled meat pieces" for the meatballs | n, n, n | strict rule 1 as the v4 25-flash r1 sheet read "Grilled meat" on 19 (no dish, no animal); but 44 credits "grilled meat" where gold names no kind, and these gold rows name no animal either |
| 42 | "Breaded fried cutlet with creamy sauce" for the breaded fish fillet | n | "cutlet" names no animal, and the photo shows fish; r1 and r2 named chicken and got a species miss, here the model named nothing wrong, only nothing |
| 15 | "glazed ring doughnut" for the pretzel | n | read as a kind miss (sweet fried pastry for lye bread), but both are ring-shaped wheat doughs and rule 2 treats many form errors as hits |
| 09 | "cheese pizza" for the chicken and cheese pizza | Y | the chicken topping is lost; credited because 25-lite "pizza" got Y on this row, a strict reader could call the topping a kind loss |
| 30 | "grilled chicken skewers" for the meat skewer with pepper and tomato | Y | the gold row names no animal and the skewer is named (as 25-flash "Grilled meat skewers"); the photo does not show chicken for sure |

## Findings

1. GPT-6 Luna with the v4 prompt on the EU Azure route, repeat 3, reaches 145/235 = 61.7 % [53.6, 69.7], with 2 hallucinations (21 "banana", 50 "Flatbread"), 1 error record (06, Azure 502 `provider_unavailable` in a 200 body), 0 content filter refusals, at $0.00087 a plate and a 14.2 s median.
2. The three repeats read 66.8, 62.6 and 61.7 %. The r1 to r3 drop is +5.1 [-0.8, +11.8], inside the noise; plate 06 explains 4 of its 12 hits. The cell is unstable on the same plates: 15 went from Weisswurst, pretzel and mustard to asparagus and a doughnut, and 36 from paella to pasta.
3. C3 v3 leads by +23.0 points [+13.4, +32.5] and C3 v4 by +26.8 points [+18.4, +35.3]. The losses are the same kind errors as in r1 and r2 (02, 05, 11, 40, 42), new misreads (15, 36), generic labels on enumeration plates (35, 45, 26) and the failed plate 06.
