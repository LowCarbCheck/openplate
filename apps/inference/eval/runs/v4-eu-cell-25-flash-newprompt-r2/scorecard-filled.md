# Plate-identification scoring worksheet

- results: `runs/v4-eu-cell-25-flash-newprompt-r2/results.json`
- config: `eu-cell-25-flash-newprompt` (started 2026-10-06T13:23:14.766559+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
- prefill: 136 Y, 6 n, 0 conflicts, 93 need judgment, from 17 earlier sheets

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 236 |
| items named (mean/plate) | 4.72 |
| distinct item names | 216 |
| latency mean (s) | 12.36 |
| latency median (s) | 11.39 |
| latency max (s) | 32.04 |
| cost / plate (USD) | 0.005874 |
| cost total (USD) | 0.293723 |

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

- **production**: Dark bread slice, Sliced ham, Mini frankfurters, Baked beans in tomato sauce, Scrambled eggs, Cucumber slices, Dorina Margarine, Butter pat

| gold core item | production | notes |
|---|---|---|
| scrambled eggs | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Scrambled eggs" |
| bacon/ham slices | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "sliced ham" |
| frankfurter sausages | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Mini frankfurters" (as 25-flash v3 "Small sausages") |
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Baked beans in tomato sauce" |
| brown bread slice | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Dark bread slice" (as "brown bread", D3) |
| cucumber slices | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Cucumber slices" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Dorina Margarine", "Butter pat" are the optional butter/margarine packets |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter/margarine packets

### 02, Roast (Sunday) dinner

- **production**: Roast Beef, Yorkshire Pudding, Roast Potatoes, Mixed Cooked Greens and Broccoli, Gravy

| gold core item | production | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "roast beef" |
| Yorkshire pudding | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Yorkshire pudding" |
| roast potatoes | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Roast potatoes" |
| broccoli | Y | "Mixed Cooked Greens and Broccoli" names the broccoli (as 25-flash v3 "Mixed greens and broccoli" Y); not merged, the greens part earns no credit |
| cabbage/greens | n | "Mixed Cooked Greens" is a generic label (strict rule 1, "greens" named in the rule; r1 and 25-flash v3 "Mixed greens" n) |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **production**: Grilled salmon fillet, Mixed green salad with cucumber, tomato, and red onion, Avocado, Feta cheese, Kalamata olives, Olives in a small bowl

| gold core item | production | notes |
|---|---|---|
| grilled salmon fillets | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Grilled salmon fillet" |
| feta cheese | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Feta cheese", named on its own |
| kalamata olives | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Kalamata olives", named on its own |
| avocado | Y | "Avocado", its own item |
| cherry tomatoes | Y merged | "Mixed green salad with cucumber, tomato, and red onion" names the tomato (as L-luna r2 "mixed salad with cucumber, tomato, lettuce and red onion") |
| cucumber | Y merged | same item names the cucumber |
| lettuce/romaine | Y merged | same item, "green salad" for the leaves (as "mixed green salad" Y for the lettuce bowl on 14); bare "mixed salad" would be n (luna r1) |
| red onion | Y merged | same item names the red onion |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none | "Olives in a small bowl" is the optional side bowl of olives |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04, Cheeseburger with fries

- **production**: Cheeseburger, French fries, Ketchup, Pickled gherkins, Cola

| gold core item | production | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Cheeseburger" |
| thick-cut fries/steak fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "french fries" |
| ketchup | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Ketchup" |
| pickles/gherkins | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Pickled gherkins" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Cola" is the optional drink glass in the background misnamed (photo, rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **production**: White rice with carrots, Chicken and spinach curry

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "chicken and spinach curry" |
| white rice | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "white rice with carrots"; the carrots are the optional pepper bits misnamed (rule 3, r1 call) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "with carrots" in the rice is the optional pepper bits misnamed (rule 3, r1 call) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: Salmon and avocado sushi roll, Tuna nigiri, White fish nigiri, Soy sauce, Wasabi, Pickled ginger (Gari), White wine, Water, Miso soup

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Salmon and avocado sushi roll" (25-lite name) |
| tuna nigiri | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Tuna nigiri" |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "White fish nigiri" |
| pickled ginger | Y | "Pickled ginger (Gari)" (25-flash v3 name) |
| wasabi | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "wasabi" |
| soy sauce | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Soy sauce" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Miso soup": the black lacquer bowl at top left holds a dark liquid (25-flash v3 photo check), rule 3; "White wine", "Water" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: Spaghetti with meat and vegetable sauce

| gold core item | production | notes |
|---|---|---|
| spaghetti | Y merged | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Spaghetti with meat and vegetable sauce" (D3 and A name) |
| ground beef/meat tomato sauce | Y merged | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "spaghetti with meat and vegetable sauce", same item |
| corn kernels | n | prefill n from eu-cell-38-prod-oldprompt, v3-eu-cell-25-flash-newprompt, v3-eu-cell-35-eu-newprompt and 2 more: no reported item covered it |
| green beans | n | prefill n from eu-cell-38-prod-oldprompt, v3-eu-cell-25-flash-newprompt, v3-eu-cell-35-eu-newprompt and 2 more: no reported item covered it |
| carrot pieces | n | prefill n from eu-cell-38-prod-oldprompt, v3-eu-cell-25-flash-newprompt, v3-eu-cell-35-eu-newprompt and 2 more: no reported item covered it |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **production**: Plain yogurt, Granola, Apple slices

| gold core item | production | notes |
|---|---|---|
| yogurt | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Plain yogurt" |
| granola (oats/puffed grains, nuts) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "granola" |
| apple slices | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Apple slices" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **production**: Chicken and cheese pizza, Cola soft drink

| gold core item | production | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Chicken and Cheese Pizza" (C3 name) |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none | "Cola soft drink" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **production**: Chicken sandwich, Side salad, Pepsi Max

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Chicken sandwich" (cloud name) |
| green side salad (rocket/mixed leaves) | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "side salad" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | "Pepsi Max" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: Breaded Schnitzel, Potato wedges, Mixed green salad with vinaigrette, Ketchup

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "breaded schnitzel" (C3 name) |
| thick-cut fries/potato wedges | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Potato wedges" |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | "Mixed green salad with vinaigrette": the gold row is itself the consolidated salad (r1 "Mixed side salad with dressing", L1, L2, L3, C3 v4) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: Bratwurst sausages with mustard sauce, Mashed potatoes, Creamy sauerkraut, Mixed side salad

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y | "Bratwurst sausages with mustard sauce"; the mustard is optional |
| sauerkraut | Y | "Creamy sauerkraut" |
| mashed potatoes | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Mashed potatoes" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Mixed side salad" is the salad on the background plate (gold trap): a trap leak, not a hallucination (r1, C3 v4) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: Käsespätzle with caramelized onions, Mixed green salad with creamy dressing

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y merged | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Käsespätzle with caramelized onions" (as C3 v4 "Käsespätzle with fried onions") |
| fried/caramelised onions | Y merged | "Käsespätzle with caramelized onions" names the onions (r1, same name) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: Green leaf salad, Beef stew with potatoes and mushrooms

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y merged | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "beef stew with potatoes and mushrooms" (D3 name, word for word) |
| boiled potatoes | Y merged | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "beef stew with potatoes and mushrooms", same item names the potatoes (r1) |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "Green leaf salad" (as D3 "Green salad", r1 "Green lettuce salad") |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: Weisswurst, Sweet Mustard, Pretzel, Beer

| gold core item | production | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Weisswurst" |
| pretzel (Brezel) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "pretzel" |
| sweet mustard | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Sweet Mustard" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | "Beer" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16, Döner/gyros plate with fries and salad

- **production**: Döner meat with tomato sauce, French fries, Mixed salad with dressing and pickled pepper, Lager beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | Y merged | "Döner meat with tomato sauce" |
| tomato sauce over the meat | Y merged | same item names the tomato sauce (as L1, L2, L3, C3 v4 "with tomato sauce") |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "French fries" |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "mixed salad with dressing and pickled pepper": gold row is itself the consolidated salad (precedent) |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Lager beer" optional; the pickled pepper inside the salad item is optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: French fries, Currywurst (sausage with curry ketchup)

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y merged | "Currywurst (sausage with curry ketchup)" |
| curry ketchup sauce | Y merged | same item names the curry ketchup |
| curry powder | n | curry dusting not named (every EU sheet) |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "French fries" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: Maultaschen, Creamy potato salad with bacon

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Maultaschen" (C3 name, word for word) |
| potato salad | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Creamy potato salad with bacon" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: French fries, Mayonnaise, Yogurt sauce, Doner meat, Currywurst

| gold core item | production | notes |
|---|---|---|
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "French fries" |
| gyros/döner sliced meat | Y | "Doner meat" names the dish (r1 "Grilled meat" was n because it named neither dish nor animal) |
| sliced sausage in curry/shashlik sauce | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Currywurst" (cloud name) |
| tzatziki/garlic yogurt sauce | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Yogurt sauce" (qwenvl name) |
| mayonnaise | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Mayonnaise", its own item (D3, A) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 20, Bowl of shio ramen

- **production**: Ramen noodles, Ramen broth (clear), Chashu pork, Mizuna greens, Tempura flakes (tenkasu)

| gold core item | production | notes |
|---|---|---|
| ramen noodles | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Ramen noodles", its own item |
| clear (shio) broth | Y | "Ramen broth (clear)", its own item |
| sliced chashu pork | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "chashu pork" |
| leafy green herb topping (mizuna/mitsuba) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Mizuna greens" names the mizuna, so not the generic "greens" that the strict reading rejects |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Tempura flakes (tenkasu)" are the optional fried bits misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **production**: Beef Pho, Rice Vermicelli Noodles (side), Bean Sprouts and Herbs, Chili Sauce, Black Tea

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y merged | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Beef Pho" |
| sliced beef and beef meatballs | Y merged | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "beef pho" names the beef (r1 "beef pho noodle soup") |
| bean sprouts | Y merged | "Bean Sprouts and Herbs" names the sprouts |
| Thai basil | Y merged | same item, "Herbs" for the Thai basil, the only herb on the plate (25-flash v3 "bean sprouts and herbs", L1, L3 precedent) |
| sliced green chilli/jalapeño | n | not named; "Chili Sauce" is the optional sauce dish, not the fresh chilli |
| spring onion | n | not named |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | "Rice Vermicelli Noodles (side)", "Chili Sauce", "Black Tea" are the optional extra noodles, sauce dish and drink |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: Tacos with ground meat and salsa, Grilled corn on the cob, Dark soft drink

| gold core item | production | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y merged | "Tacos with ground meat and salsa" names the tacos and the ground meat |
| grated cheese | n | not named in this repeat (r1 "Tacos with beef and cheese" named it) |
| red salsa | Y merged | same item, one "salsa" credited to the red salsa (precedent: L2, luna r1, mistral) |
| green salsa/tomatillo | n | one salsa token cannot cover two salsas (precedent) |
| coriander/cilantro | n | not named |
| grilled corn on the cob | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "grilled corn on the cob" |
| **core recall (/6)** | 3/6 |  |
| **hallucinations** | none | "Dark soft drink" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **production**: Smothered Burrito, Green Chili Sauce, Shredded Cheese Blend, Shredded Iceberg Lettuce, Diced Tomatoes

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | Y | "Smothered Burrito"; the sauce now has its own item, so not merged |
| green chile sauce | Y | "Green Chili Sauce", its own item |
| shredded cheddar/jack cheese | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Shredded cheese blend", its own item |
| shredded lettuce | Y | "Shredded Iceberg Lettuce", its own item |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Diced Tomatoes" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **production**: Battered fish fillet, French fries, Peas, Tartar sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish fillet | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Battered Fish Fillet" |
| chips/thick-cut fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "French Fries" |
| green peas | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Peas" |
| tartar sauce | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Tartar Sauce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge

### 25, American breakfast platter

- **production**: Pancakes with powdered sugar, Fried egg, Bacon strips, Breakfast sausages, Hash browns, Toasted bread, Maple syrup, Buttery spread

| gold core item | production | notes |
|---|---|---|
| pancakes with icing sugar | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Pancakes with powdered sugar" |
| back bacon rashers | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Bacon strips" (as "bacon", 25-lite, runpod) |
| fried egg (sunny side up) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Fried egg" |
| breakfast sausages | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Breakfast sausages" |
| hash brown/potato croquettes | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Hash browns" |
| toast slices | Y | "Toasted bread" |
| maple syrup in a shot glass | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Maple syrup" |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none | "Buttery spread" is the optional butter packet |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **production**: Pulao rice, Roti, Papadum, Plain yogurt, Mixed vegetable soup, Kofta or paneer curry, Dal (lentil soup), Mixed vegetable curry, Paneer curry, Shredded vegetable salad

| gold core item | production | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | "Pulao rice" |
| chapati/roti | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "Roti" |
| papad (papadum) | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Papadum" |
| curd/raita | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Plain Yogurt" |
| dal (lentil curry) | Y | "Dal (lentil soup)" (r1 "Dal (lentil stew)") |
| kofta/dumpling curry in orange gravy | Y | "Kofta or paneer curry" names the kofta; "Paneer curry" takes the paneer row, "Mixed vegetable curry" the eggplant row (hedge precedent, r1 "Quiche or gratin" on 43) |
| paneer or fish curry in pale gravy | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: D "paneer curry" |
| brinjal/eggplant curry | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Mixed Vegetable Curry" for the eggplant curry (D, C2, B2 precedent) |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none | "Mixed vegetable soup", "Shredded vegetable salad" are the optional soup and salad |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **production**: Chicken and Cashew Stir-fry, Cooked White Rice

| gold core item | production | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Chicken and Cashew Stir-fry" (as "chicken cashew stir-fry") |
| red bell pepper strips | n | prefill n from v3-eu-cell-25-flash-newprompt, v3-eu-cell-35-eu-newprompt: no reported item covered it |
| onion | n | prefill n from v3-eu-cell-25-flash-newprompt, v3-eu-cell-35-eu-newprompt: no reported item covered it |
| spring onion/green onion | n | prefill n from v3-eu-cell-25-flash-newprompt, v3-eu-cell-35-eu-newprompt: no reported item covered it |
| steamed white rice | Y | "Cooked White Rice" |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): dried chilli bits

### 28, Middle-Eastern mezze spread — four composed plates plus flatbread

- **production**: Falafel bowl with mixed salads, Flatbread, Chili oil dipping sauce

| gold core item | production | notes |
|---|---|---|
| falafel balls | Y | "Falafel bowl with mixed salads" names the falafel (as L2, L3 "falafel mezze bowl") |
| grilled flatbread | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Flatbread" |
| hummus/creamy white dip | n | not named; "mixed salads" names nothing (rule 1) |
| green herb-chilli sauce | Y | "Chili oil dipping sauce" names the chilli oil (as L2 "chili dipping oil", E "chili oil", Y) |
| yellow bulgur or couscous | n | not named; "mixed salads" (rule 1) |
| black beluga lentils | n | not named; "mixed salads" (rule 1) |
| pickled white cabbage slaw | n | not named; "mixed salads" (rule 1) |
| green olives | n | not named |
| **core recall (/8)** | 3/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: Weissbier, Pickles, Honey, Salami slices, Cheese cubes, Green olives

| gold core item | production | notes |
|---|---|---|
| pickled gherkin slices | Y | "Pickles" (as r1 "Sliced pickles") |
| salami slices | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Salami slices" |
| cheese cubes | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "cheese cubes" |
| green olives | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Green olives" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none | "Honey" ("a small dollop") is the golden liquid in the pickle bowl beside the cream dip (photo), a visible referent (rule 3); "Weissbier" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30, Mixed grill board (plancha de grillades)

- **production**: Mixed green salad, Baked potato with cheese, Grilled beef steak, Grilled pork ribs, Grilled sausage, Grilled bacon, Meat skewer, Grilled bell pepper

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "grilled pork ribs" |
| grilled beef steak | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "grilled beef steak" |
| grilled sausage | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Grilled sausage" |
| grilled meat skewer with green pepper and tomato | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "meat skewer" |
| baked/roasted potato with browned cheese topping | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Baked potato with cheese" |
| mixed leaf salad | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Mixed green salad" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "Grilled bacon" is the pork belly slices (r1 photo check), "Grilled bell pepper" the skewer pepper, rule 3 |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cherry tomato, steak knife

### 31, Bowl of beef/oxtail soup with buttered bread

- **production**: Beef Goulash, Wholemeal bread with butter

| gold core item | production | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "beef goulash" |
| beef (oxtail) chunks | Y merged | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Beef Goulash", same item as the broth (precedent) |
| buttered bread slices (dark/whole-grain) | Y | "Wholemeal bread with butter" (r1 "Rye bread with butter") |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **production**: Green olives, Cucumber sticks, Carrot sticks, Yellow bell pepper strips, Red bell pepper strips, Deviled eggs, Hummus, Blue cheese with herbs, Cheddar cheese, Salami slices, Savory crackers

| gold core item | production | notes |
|---|---|---|
| green olives | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Green olives" |
| cucumber sticks | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Cucumber sticks" |
| carrot sticks | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Carrot sticks" |
| bell pepper strips | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Yellow bell pepper strips", "Red bell pepper strips" |
| pan-fried spiced hard-boiled egg halves | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Deviled eggs" (deviled for spiced egg is prep, rule 2) |
| hummus dip | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Hummus" |
| salami/cured meat slices | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "Salami slices" |
| cheese slices | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Cheddar cheese", "Blue cheese with herbs" (25-lite name) |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none | "Savory crackers" are the optional herb crackers |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **production**: Oatmeal, Peanut butter, Raisins, Cinnamon powder, Milk

| gold core item | production | notes |
|---|---|---|
| oatmeal/oat porridge | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "oatmeal" |
| peanut butter | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Peanut butter" |
| raisins | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Raisins" |
| ground cinnamon | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Cinnamon powder" |
| milk | Y | "Milk", its own item ("a splash mixed into the oats") |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: Waffles with strawberry topping, Whipped cream

| gold core item | production | notes |
|---|---|---|
| waffles | Y merged | "Waffles with strawberry topping" |
| strawberries (sliced fresh) | Y merged | same item, "strawberry topping" credits one row, the strawberries (r1, C3 v3, 25-flash v3) |
| strawberry/berry syrup-compote | n | one strawberry token, one row (r1 call) |
| whipped cream | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Whipped cream" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **production**: Doner Kebab meat with yogurt sauce, French fries, Shredded white cabbage, Mixed salad (lettuce, tomato, cucumber, corn, carrot, olive, pickled pepper)

| gold core item | production | notes |
|---|---|---|
| gyros/döner sliced meat | Y merged | prefill Y from v3-eu-cell-25-flash-newprompt: "Doner Kebab Meat with Yogurt Sauce" |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "French Fries" |
| white garlic-yogurt sauce (tzatziki) with oregano | Y merged | "Doner Kebab meat with yogurt sauce" names the yogurt sauce (as 25-flash v3 "Yogurt sauce" Y on 19) |
| shredded white cabbage | Y | "Shredded white cabbage", its own item |
| tomato slices | Y merged | "Mixed salad (lettuce, tomato, cucumber, corn, carrot, olive, pickled pepper)" names the tomato |
| sweetcorn | Y merged | same item names the corn |
| cucumber slices | Y merged | same item names the cucumber |
| shredded carrot | Y merged | same item names the carrot |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: Paella rice with artichoke, Shrimp, Mantis shrimp

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | Y merged | "Paella rice with artichoke" |
| whole prawns (langostinos) | Y | prefill Y from v3-eu-cell-25-lite-newprompt: "Shrimp" (as ens3, lfmvl) |
| mantis shrimp (galeras) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Mantis shrimp", its own item |
| artichoke pieces | Y merged | same item names the artichoke |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: Pierogi with potato and cheese filling, Coleslaw salad

| gold core item | production | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y | "Pierogi with potato and cheese filling" |
| fried caramelised onion topping | n | not named in this repeat (r1 named "fried onions") |
| grated carrot and cabbage salad | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r2: "Coleslaw salad" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **production**: Beef burger, French fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Beef burger" (A, C name) |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "French fries" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: Baked beans, Fried sausages, Fried bacon

| gold core item | production | notes |
|---|---|---|
| baked beans in tomato sauce | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Baked beans" (D3 name) |
| sausage pieces | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Fried sausages" |
| bacon rasher | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Fried bacon" (25-lite name) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **production**: french fries, grilled bacon, fried egg, grilled tomato, stewed beef and liver, sausage, stewed pork

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | Y merged | "stewed beef and liver" names the organ; the beef part points at the flat meat slices (r1) |
| chips/French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "French fries" |
| bacon/gammon slice | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r3: "grilled bacon" |
| fried egg (remnant, yolk visible) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "fried egg" |
| sausage | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Sausage" |
| grilled tomato half | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Grilled tomato" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none | "stewed pork" is the pale fatty pork at top left (r1 photo check) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: Battered fish, Roasted potato wedges, Mayonnaise

| gold core item | production | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "battered fish" |
| potato wedges/skin-on roast potatoes | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "roasted potato wedges" |
| tartar sauce / mayonnaise dollop | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Mayonnaise" (D3, cloud name) |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **production**: Fried fish fillet with sauce, White rice, Chickpea curry, Meatballs in gravy, Mashed potato with tomato sauce, Mixed salad with corn and red cabbage slaw

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | Y | "Fried fish fillet with sauce"; not merged, the sauce earns no credit |
| sour cream / remoulade dollop | n | bare "with sauce" names no sauce kind (strict rule 1, as C3 v4 "breaded fish fillet with sauce" n) |
| meatballs in brown gravy | Y | "Meatballs in gravy" |
| chickpea-and-cauliflower curry | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Chickpea curry" |
| white rice | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "White rice" |
| red cabbage and sweetcorn salad | Y | "Mixed salad with corn and red cabbage slaw" names the corn and the red cabbage |
| cucumber and lettuce salad | n | not named; the corn and red cabbage item cannot cover two salads (precedent) |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none | "Mashed potato with tomato sauce" is the optional tomato-sauced bake misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set — main plate, soup bowl, bread plate

- **production**: Fishcakes with mayonnaise, Green beans, Green herb rice, Pasta salad with ham and cheese, Baked egg and cheese slice, Coleslaw, Olives, Grits with bacon bits, Bread with butter

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | "Fishcakes with mayonnaise" (as 25-flash v3 "Fish cakes with mayonnaise") |
| herbed green rice | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "green herb rice" |
| green beans | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Green beans" |
| cheese-topped quiche/gratin square | Y | "Baked egg and cheese slice" for the quiche square, egg and cheese named |
| creamy meat-and-vegetable stew | n | "Pasta salad with ham and cheese" is the stew misread (as r1, C2, B2, 25-flash v3 "Pasta salad with ham"), kind miss; misnamed, not a hallucination |
| creamy soup (bowl, with bacon bits) | Y | "Grits with bacon bits" is the soup bowl: thick white cream with bacon bits; porridge for soup is form (rule 2, as L1 "creamy grits with bacon") |
| bread roll with butter | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "Bread with butter" |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none | "Pasta salad with ham and cheese" is the stew misnamed, "Grits with bacon bits" the soup bowl (rule 3); "Coleslaw", "Olives" optional |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: Mixed green salad, Cooked black beans, Yellow rice, Stewed cabbage, Mashed potatoes, Stewed pork

| gold core item | production | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "Mixed green salad" (D3 name) |
| brown beans (feijão) in broth | Y | "Cooked black beans": bean kind right, colour off (as 35-eu v3 "cooked black beans", C3 "pinto beans" Y) |
| yellow seasoned rice | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "Yellow rice" |
| braised cabbage with tomato | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Stewed cabbage" (tomato not named, as 25-flash v3 "Cooked cabbage") |
| stewed meat in onion gravy | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Stewed pork": gold names no kind (as 25-flash v3 "Braised pork") |
| mashed cassava/potato purée | Y | prefill Y from v4-eu-cell-38-minimal-newprompt-r1: "mashed potatoes" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45, Korean hanjeongsik table spread (dozens of banchan, top-down)

- **production**: Japchae (Glass Noodle Stir-fry), Steamed Egg (Gyeran Jjim), Braised Beef Short Ribs (Galbi Jjim), Grilled Mackerel (Godeungeo Gui), Tofu with Kimchi/Sauce, Korean Pancake (Jeon), Mixed Salad with Seafood (Hwe Muchim style), Kimchi, Soy Sauce-Glazed Lotus Root (Yeongeun-jorim), Spicy Pickled Radish (Kkakdugi), Braised Peanuts (Kongjaban), Soybean Paste Dipping Sauce (Ssamjang)

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | Y | "Japchae (Glass Noodle Stir-fry)" |
| steamed egg (gyeranjjim) in stone pot | Y | "Steamed Egg (Gyeran Jjim)" |
| grilled mackerel/fish | Y | "Grilled Mackerel (Godeungeo Gui)" |
| stir-fried beef in a hot stone pot | Y | "Braised Beef Short Ribs (Galbi Jjim)", portion "a small stone pot": the beef in the stone pot, braised for stir-fried is prep (rule 2; r1 and 25-flash v3 same call) |
| glazed spicy braised ribs/pork | n | no item for the glazed pork plate; the one beef token goes to the stone pot (one token, one row, 25-flash v3 call) |
| sliced raw fish (hoe/sashimi) on shredded radish | Y | "Mixed Salad with Seafood (Hwe Muchim style)": hoe muchim is raw fish dressed with vegetables, "a medium plate", the raw fish plate on shredded radish (photo) |
| vegetable fritters/jeon platter | Y | "Korean Pancake (Jeon)" |
| kimchi | Y | prefill Y from v3-eu-cell-mistral-medium-newprompt: "kimchi" |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none | "Tofu with Kimchi/Sauce", "Soy Sauce-Glazed Lotus Root", "Spicy Pickled Radish", "Braised Peanuts", "Soybean Paste Dipping Sauce" are optional dishes on the table (photo); no empty bowl named as rice or soup |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: Fried Tofu Skin Rolls, Marinated Honeycomb Tripe, Marinated Bamboo Shoots

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | "Marinated Honeycomb Tripe" names the honeycomb tripe |
| white boiled tripe/omasum slices in broth | n | "Marinated Bamboo Shoots" is the omasum cups misnamed (r1, 25-flash v3), plant for organ, kind miss; the one tripe token went to the honeycomb row |
| fried beancurd-skin rolls (tofu skin rolls) | Y | "Fried Tofu Skin Rolls" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | "Marinated Bamboo Shoots" is the omasum cups misnamed (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: White wine, Fruit and granola smoothie bowl, Beetroot latte, Iced coffee with milk, Eggs Benedict, Tomato salad with balsamic glaze, Avocado toast with poached egg, Chocolate donut with sprinkles, Passion fruit juice

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | prefill Y from v4-eu-cell-31-lite-newprompt-r1: "avocado toast with poached egg" (D3 name; the two-piece plate, photo) |
| eggs benedict with hollandaise on avocado toast | Y | "Eggs Benedict" |
| yogurt bowl with granola, kiwi slices and berry compote | Y | "Fruit and granola smoothie bowl" names the granola and fruit (25-flash v3 "Smoothie bowl with fruit and granola" Y, r1) |
| cherry tomato salad with balsamic drizzle | Y | "Tomato salad with balsamic glaze", its own item |
| seeded bagel (dark, sesame-topped) | Y | "Chocolate donut with sprinkles" for the dark sesame bagel: ring-shaped baked good, form (rule 2, r1 "Donut with sesame seeds" Y); the seeds read as sprinkles (photo) |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none | four drinks optional; "Chocolate donut with sprinkles" is the bagel misnamed (rule 3); nothing from the menu cards |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: Potato chips, White cake with frosting, White bread sandwich, Small fried samosas

| gold core item | production | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "White bread sandwich" |
| potato chips/crisps | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Potato chips" |
| samosas (small fried triangles) | Y | "Small fried samosas" |
| slice of white/vanilla cake with icing — partly eaten | Y | prefill Y from v3-eu-cell-25-flash-newprompt: "White cake with frosting" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49, Cafe sizzling-plate dinner set

- **production**: Steak with brown sauce, Spaghetti, Cooked sausage, Cherry tomatoes, Savory soup, White bread roll

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y | "Steak with brown sauce": the gold row accepts steak |
| spaghetti (plain, buttered) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Spaghetti" |
| sausage/frankfurter | Y | "Cooked sausage" |
| cherry tomatoes | Y | "Cherry tomatoes", its own item ("two halves") |
| red cabbage soup (borscht-style, bowl) | Y | prefill Y from v4-eu-cell-25-flash-newprompt-r1: "Savory soup" for the borscht bowl (as 25-flash v3 bare "Soup" Y, 25-lite, qwenvl, runpod) |
| bread bun | Y | "White bread roll" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: Doner kebab meat with red sauce, French fries, Mixed side salad, Pepsi Cola, Karjala Lager Beer

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y merged | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r1: "Doner kebab meat with red sauce" |
| tomato/chili sauce over the meat | Y merged | "Doner kebab meat with red sauce": "red sauce" names the tomato or chili kind by colour (luna r1 same name Y merged); bare "with sauce" scored n in r1 |
| French fries | Y | prefill Y from v4-eu-cell-gpt6-luna-newprompt-r2: "French fries" |
| iceberg lettuce salad | n | bare "Mixed side salad" names no part (strict rule 1, r1) |
| sliced red onion | n | rule 1, as above |
| cucumber slices | n | rule 1, as above |
| pickled gherkin and pepperoncini | n | not named |
| **core recall (/7)** | 3/7 |  |
| **hallucinations** | none | "Pepsi Cola", "Karjala Lager Beer" optional; nothing from the background plate |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 206/235 = 87.7 % |
| hallucinations | 0 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 216 |
| cost / plate (auto) | $0.00587 |
| latency median s (auto) | 11.39 |


## Scoring

Cell: `google/gemini-2.5-flash` on the EU host (`google-vertex/eu`, ZDR), reasoning minimal, v4 prompt, plates repeat 2. Rules: `runs/2026-08-12-50img-SCORING.md`, strict reading of rule 1. Verdicts follow, in this order, this cell's r1 sheet (`runs/v4-eu-cell-25-flash-newprompt-r1/scorecard-filled.md`, 194/235), `runs/v4-eu-cell-38-minimal-newprompt-r1`, the v4 3.1 lite sheets, then the prompt-v3 `v3-eu-cell-*` sheets. Photos opened for 04, 29, 45, 47.

Prefill: 17 earlier sheets read, 5022 remembered verdicts. 235 rows: 136 prefilled Y (13 of them Y merged), 6 prefilled n, 0 conflicts, 93 needs judgment. Sources: `runs/eu-*`, `runs/v3-eu-*`, `runs/v4-eu-cell-*` here, and the prompt-v3 worktree `runs/v3-eu-cell-*` and `runs/eu-cell-*` sheets; no 2026-08 sheet. Two prefilled rows changed: 23 burrito and green chile sauce from `Y merged` to `Y`, because this repeat names "Green Chili Sauce" as its own item (no recall change).

- Hits: **206/235 = 87.7 %**.
- 95 % CI, percentile bootstrap over plates, 2000 resamples, `random.Random(7)` (`harness/stats.py` `bootstrap_recall_ci(pairs, resamples=2000, seed=7)`): **[81.0, 93.5] %**.
- The harness default (`--score`: 10 000 resamples, seed 20260813) gives [80.9, 93.7] %.

Per plate hits: 01 6/6, 02 4/5, 03 8/8, 04 4/4, 05 2/2, 06 6/6, 07 2/5, 08 3/3, 09 1/1, 10 2/2, 11 3/3, 12 3/3, 13 2/2, 14 3/3, 15 3/3, 16 4/4, 17 3/4, 18 2/2, 19 5/5, 20 4/4, 21 4/6, 22 3/6, 23 4/4, 24 4/4, 25 7/7, 26 8/8, 27 2/5, 28 3/8, 29 4/4, 30 6/6, 31 3/3, 32 8/8, 33 5/5, 34 3/4, 35 8/8, 36 4/4, 37 2/3, 38 2/2, 39 3/3, 40 6/6, 41 3/3, 42 5/7, 43 6/7, 44 6/6, 45 7/8, 46 2/3, 47 5/5, 48 4/4, 49 6/6, 50 3/7.

Against r1 of this cell (194/235), repeat 2 minus repeat 1 is +12 hits: 03 +5 and 35 +5 (the salads now list their parts), 02, 16, 19, 26, 33, 44, 49, 50 +1 each, against 28 -4 (one "Falafel bowl with mixed salads" item in place of seven named parts), 37 -1 and 45 -1. The item names changed, the rules did not.

## Hallucinations by plate

None. **0 hallucinations** on 50 plates. A hallucination is a food with no referent in the photo (rule 3).

- Trap leaks, not counted: 12 "Mixed side salad" is the salad on the background plate (gold trap), as in r1. Plate 50 names nothing from the background plate, plate 47 names nothing from the menu cards, plate 45 names no empty bowl as rice or soup.
- Referents checked on the photo: 29 "Honey" is the golden liquid in the pickle bowl beside the cream dip; 04 "Cola" is the drink glass in the background; 45 "Mixed Salad with Seafood (Hwe Muchim style)" is the raw fish plate on shredded radish; 47 "Chocolate donut with sprinkles" is the dark sesame bagel.
- Misnamed visible objects, not counted (rule 3): 05 "with carrots" (pepper bits), 06 "Miso soup" (black lacquer bowl, 25-flash v3 photo check), 20 "Tempura flakes (tenkasu)" (fried bits), 30 "Grilled bacon" (pork belly), 40 "stewed pork" (fatty pork), 42 "Mashed potato with tomato sauce" (tomato-sauced bake), 43 "Pasta salad with ham and cheese" (the stew) and "Grits with bacon bits" (the soup), 46 "Marinated Bamboo Shoots" (omasum cups).
- Optional items reported, no error: drinks on 04, 06, 09, 10, 15, 16, 21, 22, 29, 47, 50; 01 margarine and butter; 03 side bowl of olives; 21 extra noodles and chili sauce; 23 diced tomatoes; 25 buttery spread; 26 soup and salad; 32 crackers; 43 coleslaw and olives; 45 tofu, lotus root, radish, peanuts, ssamjang.

## Errors, schema-invalid records, false unreadable

- Error records: **0** (`_summary.failures` is empty; every record is HTTP 200, `error` null, provider Google, `finish_reason` stop).
- Schema-invalid records: **0** (`schema_valid` true on 50/50, strict parse on all 50). Error and invalid ids: none.
- False unreadable: **0** (`unreadable` is false on every plate).
- Retried records, valid at the end, not errors: 46 (2 attempts, no schema errors).

## Paired difference against C3 v3

C3 v3 is `op-worktrees/prompt-v3/apps/inference/eval/runs/v3-eu-cell-38-minimal-newprompt/scorecard-filled.md` (3.8 flash, minimal reasoning, v3 prompt), the same 50 plates and the same 235 gold items.

- C3 v3: 199/235 = 84.7 %, 95 % CI [78.2, 90.8] (same method, seed 7, 2000 resamples).
- This cell: 206/235 = 87.7 %, 95 % CI [81.0, 93.5].
- **C3 v3 minus this cell: -3.0 points, paired 95 % CI [-7.9, +1.8].** The interval contains 0.
- Plates where the two differ (C3 v3 minus this cell, in hits): 02 +1, 06 -3, 20 -1, 22 -1, 30 -1, 32 -3, 33 -1, 35 -2, 37 +1, 45 +1, 46 +1, 49 -1, 50 +2.

## Paired difference against C3 v4

C3 v4 is `runs/v4-eu-cell-38-minimal-newprompt-r1/scorecard-filled.md` (3.8 flash, minimal reasoning, v4 prompt, 208/235).

- C3 v4: 208/235 = 88.5 %, 95 % CI [82.9, 93.4].
- **C3 v4 minus this cell: +0.9 points, paired 95 % CI [-4.3, +6.3].** The interval contains 0.
- Plates where the two differ (C3 v4 minus this cell, in hits): 02 +1, 06 -2, 22 -1, 23 -2, 28 +4, 30 -1, 33 -1, 34 +1, 35 -1, 37 +1, 45 +1, 46 +1, 49 -1, 50 +2.
- Method for both: `harness/stats.py` `bootstrap_diff_ci(other, this_cell, resamples=2000, seed=7)`, one set of 50 plate indices per resample applied to both cells.

Sensitivity to the five least sure calls (same method):

| variant | hits, recall | 95 % CI | C3 v3 minus this cell | C3 v4 minus this cell |
|---|---|---|---|---|
| as filled | 206/235 = 87.7 % | [81.0, 93.5] | -3.0 [-7.9, +1.8] | +0.9 [-4.3, +6.3] |
| stricter: 03 lettuce, 22 tacos, 26 kofta, 45 raw fish, 47 bagel to n | 201/235 = 85.5 % | [78.6, 91.7] | -0.9 [-6.3, +4.4] | +3.0 [-2.2, +8.3] |

## Judgment calls that were not obvious

| plate | call | verdict | why unsure |
|---|---|---|---|
| 45 | "Mixed Salad with Seafood (Hwe Muchim style)" for the sliced raw fish on shredded radish | Y | "mixed salad with seafood" alone would be generic; "Hwe Muchim" names a raw fish dish, and the portion and photo point at that plate |
| 47 | "Chocolate donut with sprinkles" for the dark sesame bagel | Y | follows r1 "Donut with sesame seeds" (ring-shaped baked good, form); this repeat names no sesame, the seeds read as sprinkles |
| 03 | "Mixed green salad with cucumber, tomato, and red onion" for lettuce/romaine | Y merged | "green salad" read as the leaves (as "mixed green salad" for the lettuce bowl on 14); luna r1 bare "mixed salad" scored n |
| 22 | "Tacos with ground meat and salsa" for tacos with seasoned ground beef | Y merged | the dish is named, the animal is not; gold names beef |
| 26 | "Kofta or paneer curry" for the kofta curry | Y | a hedge; "Paneer curry" is a separate item that takes the paneer row (hedge precedent "Quiche or gratin" on 43 in r1) |

## Findings

1. Gemini 2.5 Flash on the EU host at minimal reasoning with the v4 prompt, repeat 2, reaches 206/235 = 87.7 % [81.0, 93.5] with 0 hallucinations and 0 error records, at $0.0059 a plate and an 11.4 s median.
2. Repeat 1 scored 194/235. The 12 hit swing comes from item naming, not rules: the salads on 03 and 35 list their parts this time, while plate 28 collapses into one "Falafel bowl with mixed salads".
3. C3 v3 minus this cell is -3.0 points [-7.9, +1.8]; C3 v4 minus this cell is +0.9 points [-4.3, +6.3]. Neither interval excludes 0.
