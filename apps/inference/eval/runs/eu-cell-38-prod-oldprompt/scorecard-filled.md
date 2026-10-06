# Plate-identification scoring worksheet

- results: `runs/eu-cell-38-prod-oldprompt/results.json`
- config: `eu-cell-38-prod-oldprompt` (started 2026-10-06T08:28:16.430986+00:00)
- approaches: baseline
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM


> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`. All five EU cells were judged side by side from one judgment table, so one name gets one verdict in every cell. Choices that were not obvious: `runs/EU-PLATE-SCORING-2026-10-06.md`.

## Mechanical metrics (auto-computed)

| metric | baseline |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 171 |
| items named (mean/plate) | 3.42 |
| distinct item names | 155 |
| latency mean (s) | 14.19 |
| latency median (s) | 12.18 |
| latency max (s) | 56.06 |
| cost / plate (USD) | 0.006522 |
| cost total (USD) | 0.326102 |

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

- **baseline**: brown bread, baked beans in tomato sauce, scrambled eggs, cocktail sausages, cured ham slices, cucumber slices

| gold core item | baseline | notes |
|---|---|---|
| scrambled eggs | Y |  |
| bacon/ham slices | Y |  |
| frankfurter sausages | Y |  |
| baked beans in tomato sauce | Y |  |
| brown bread slice | Y |  |
| cucumber slices | Y |  |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter/margarine packets

### 02, Roast (Sunday) dinner

- **baseline**: Yorkshire pudding, Roast meat with gravy, Roast potatoes, Steamed cabbage and broccoli

| gold core item | baseline | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y |  |
| Yorkshire pudding | Y | D "roast beef dinner" is a plate label; only the beef is named (rule 1) |
| roast potatoes | Y |  |
| broccoli | Y merged | E "mixed green vegetables" is a bag label (rule 1) |
| cabbage/greens | Y merged |  |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **baseline**: pan-seared salmon fillet, Greek salad with avocado and feta

| gold core item | baseline | notes |
|---|---|---|
| grilled salmon fillets | Y |  |
| feta cheese | Y merged |  |
| kalamata olives | Y merged | A-C via "Greek salad" (determinate dish); D "salmon salad", E "mediterranean salad" are not determinate (rule 1) |
| avocado | Y merged |  |
| cherry tomatoes | Y merged |  |
| cucumber | Y merged |  |
| lettuce/romaine | Y merged |  |
| red onion | Y merged |  |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04, Cheeseburger with fries

- **baseline**: cheeseburger, steak fries, ketchup

| gold core item | baseline | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y |  |
| thick-cut fries/steak fries | Y |  |
| ketchup | Y |  |
| pickles/gherkins | n |  |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **baseline**: cooked white rice, chicken and spinach stew

| gold core item | baseline | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y |  |
| white rice | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **baseline**: Salmon avocado roll, Assorted nigiri sushi

| gold core item | baseline | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | D "sushi platter" is named in rule 1 as a label that names nothing |
| tuna nigiri | Y merged | "assorted nigiri" keeps rice and form (rule 4 satisfied); one token covers both nigiri rows |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | Y merged |  |
| pickled ginger | n |  |
| wasabi | n |  |
| soy sauce | n |  |
| **core recall (/6)** | 3/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **baseline**: spaghetti with meat and vegetable sauce

| gold core item | baseline | notes |
|---|---|---|
| spaghetti | Y merged |  |
| ground beef/meat tomato sauce | Y merged |  |
| corn kernels | n | rule 1: "vegetables" and "mixed vegetables" name nothing (the 2026-08-12 cloud sheet credited "mixed vegetables"; see SCORING doc) |
| green beans | n |  |
| carrot pieces | n |  |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **baseline**: plain yogurt, granola with nuts, apple slices

| gold core item | baseline | notes |
|---|---|---|
| yogurt | Y |  |
| granola (oats/puffed grains, nuts) | Y |  |
| apple slices | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **baseline**: chicken and cheese pizza

| gold core item | baseline | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y |  |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **baseline**: toasted chicken sandwich, side salad, Pepsi Max

| gold core item | baseline | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y |  |
| green side salad (rocket/mixed leaves) | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **baseline**: breaded schnitzel, thick-cut french fries, side salad with dressing, ketchup

| gold core item | baseline | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | Y | D, E "breaded fish fillet" for a pork/veal schnitzel: species miss (rule 2), checked on the photo |
| thick-cut fries/potato wedges | Y |  |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **baseline**: grilled bratwurst sausages with mustard, mashed potatoes, cooked sauerkraut

| gold core item | baseline | notes |
|---|---|---|
| bratwurst sausages | Y |  |
| sauerkraut | Y |  |
| mashed potatoes | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **baseline**: Käsespätzle with fried onions, Side salad with creamy dressing

| gold core item | baseline | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y merged |  |
| fried/caramelised onions | Y merged |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **baseline**: Beef and mushroom stew, Boiled potatoes, Side green salad with light vinaigrette

| gold core item | baseline | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y |  |
| boiled potatoes | Y |  |
| green leaf lettuce (butterhead) in a separate glass bowl | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **baseline**: Weißwurst (Bavarian white sausage), Bavarian soft pretzel, Sweet Bavarian mustard, Wheat beer (Weissbier)

| gold core item | baseline | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y |  |
| pretzel (Brezel) | Y |  |
| sweet mustard | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16, Döner/gyros plate with fries and salad

- **baseline**: doner kebab meat with tomato sauce, french fries, side salad with dressing, beer

| gold core item | baseline | notes |
|---|---|---|
| döner/gyros sliced meat | Y merged |  |
| tomato sauce over the meat | Y merged |  |
| French fries | Y |  |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | gold row is itself a consolidated salad, so "side salad" matches it (2026-08-12 precedent) |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **baseline**: currywurst with sauce, french fries

| gold core item | baseline | notes |
|---|---|---|
| currywurst (sausage) | Y merged |  |
| curry ketchup sauce | Y merged | sauce entailed by the named dish "currywurst" (precedent) |
| curry powder | n |  |
| French fries | Y |  |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **baseline**: Meat-filled dumplings, German-style potato salad

| gold core item | baseline | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y |  |
| potato salad | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **baseline**: French fries, Mayonnaise, Pork gyros, Tzatziki, Currywurst with sauce

| gold core item | baseline | notes |
|---|---|---|
| French fries | Y |  |
| gyros/döner sliced meat | Y |  |
| sliced sausage in curry/shashlik sauce | Y |  |
| tzatziki/garlic yogurt sauce | Y |  |
| mayonnaise | Y |  |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 20, Bowl of shio ramen

- **baseline**: shio ramen with pork chashu

| gold core item | baseline | notes |
|---|---|---|
| ramen noodles | Y merged |  |
| clear (shio) broth | Y merged | "shio" or "noodle soup" names the broth |
| sliced chashu pork | Y merged |  |
| leafy green herb topping (mizuna/mitsuba) | n |  |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **baseline**: beef pho, extra rice noodles, bean sprouts and fresh herbs

| gold core item | baseline | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y merged |  |
| sliced beef and beef meatballs | Y merged | pho names the beef (rule 1 example); D "beef noodle soup" kept the dish and the beef |
| bean sprouts | Y merged |  |
| Thai basil | Y merged | "fresh herbs" for Thai basil, the only herb on the plate (precedent) |
| sliced green chilli/jalapeño | n |  |
| spring onion | n |  |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **baseline**: soft tacos with beef and salsa, grilled corn on the cob, cola

| gold core item | baseline | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y merged |  |
| grated cheese | n |  |
| red salsa | Y merged | one "salsa" credited to the red salsa (precedent) |
| green salsa/tomatillo | n |  |
| coriander/cilantro | n |  |
| grilled corn on the cob | Y |  |
| **core recall (/6)** | 3/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **baseline**: smothered wet burrito

| gold core item | baseline | notes |
|---|---|---|
| burrito (flour tortilla) | Y merged |  |
| green chile sauce | Y merged | "smothered/wet" entails the sauce (precedent) |
| shredded cheddar/jack cheese | n |  |
| shredded lettuce | n | C "salad topping" is the shredded lettuce (the only leafy topping) |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **baseline**: battered fried fish fillet, french fries, green peas, tartar sauce

| gold core item | baseline | notes |
|---|---|---|
| battered fried fish fillet | Y |  |
| chips/thick-cut fries | Y |  |
| green peas | Y |  |
| tartar sauce | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lemon wedge

### 25, American breakfast platter

- **baseline**: pancakes, pancake syrup, fried egg, bacon and breakfast sausages, hash brown patties, white toast

| gold core item | baseline | notes |
|---|---|---|
| pancakes with icing sugar | Y | D "full breakfast" names no component (rule 1, like "sushi platter") |
| back bacon rashers | Y merged |  |
| fried egg (sunny side up) | Y |  |
| breakfast sausages | Y merged |  |
| hash brown/potato croquettes | Y |  |
| toast slices | Y |  |
| maple syrup in a shot glass | Y |  |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **baseline**: vegetable pulao, paratha and papadum, assorted curries and dal, plain yogurt (dahi), clear vegetable soup

| gold core item | baseline | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y |  |
| chapati/roti | Y merged |  |
| papad (papadum) | Y merged |  |
| curd/raita | Y |  |
| dal (lentil curry) | Y | "assorted curries" names none of the other three curries (rule 1) |
| kofta/dumpling curry in orange gravy | n |  |
| paneer or fish curry in pale gravy | n | D "paneer curry" |
| brinjal/eggplant curry | n | D "vegetable curry" for the eggplant curry, same call as "vegetable soup" for borscht (precedent) |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **baseline**: steamed jasmine rice, chicken cashew stir-fry

| gold core item | baseline | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y |  |
| red bell pepper strips | n |  |
| onion | n |  |
| spring onion/green onion | n |  |
| steamed white rice | Y |  |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): dried chilli bits

### 28, Middle-Eastern mezze spread, four composed plates plus flatbread

- **baseline**: Falafel mezze bowl, Grilled pita flatbread, Chili & herb dipping oil

| gold core item | baseline | notes |
|---|---|---|
| falafel balls | Y |  |
| grilled flatbread | Y |  |
| hummus/creamy white dip | n |  |
| green herb-chilli sauce | Y | "chili herb dipping oil" / "chili oil" is the green herb and chilli oil bowl (photo) |
| yellow bulgur or couscous | n | D "grains" names nothing (rule 1) |
| black beluga lentils | n |  |
| pickled white cabbage slaw | n |  |
| green olives | n |  |
| **core recall (/8)** | 3/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **baseline**: wheat beer, cubed semi-hard cheese, cured salami slices, green olives, pickles and condiment

| gold core item | baseline | notes |
|---|---|---|
| pickled gherkin slices | Y |  |
| salami slices | Y |  |
| cheese cubes | Y |  |
| green olives | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30, Mixed grill board (plancha de grillades)

- **baseline**: grilled beef steak, grilled marinated pork cutlet, mixed meat and vegetable skewers, baked potato with cheese, mixed side salad

| gold core item | baseline | notes |
|---|---|---|
| pork spare ribs slab | Y | A "pork cutlet" for ribs: cut error, hit (rule 2) |
| grilled beef steak | Y |  |
| grilled sausage | n |  |
| grilled meat skewer with green pepper and tomato | Y |  |
| baked/roasted potato with browned cheese topping | Y |  |
| mixed leaf salad | Y |  |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cherry tomato, steak knife

### 31, Bowl of beef/oxtail soup with buttered bread

- **baseline**: beef goulash, buttered rye bread

| gold core item | baseline | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged |  |
| beef (oxtail) chunks | Y merged |  |
| buttered bread slices (dark/whole-grain) | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **baseline**: deviled eggs, sliced cheese assortment, salami slices, savory herb crackers, hummus, vegetable sticks and green olives

| gold core item | baseline | notes |
|---|---|---|
| green olives | Y |  |
| cucumber sticks | n | "vegetable sticks" names nothing (rule 1, as in the v3 sheet) |
| carrot sticks | n |  |
| bell pepper strips | n |  |
| pan-fried spiced hard-boiled egg halves | Y | deviled for spiced egg: prep, hit (rule 2) |
| hummus dip | Y |  |
| salami/cured meat slices | Y |  |
| cheese slices | Y |  |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **baseline**: cooked oatmeal, peanut butter, maple syrup, raisins

| gold core item | baseline | notes |
|---|---|---|
| oatmeal/oat porridge | Y |  |
| peanut butter | Y | C, E "oatmeal with toppings": "toppings" names nothing (rule 1) |
| raisins | Y |  |
| ground cinnamon | n |  |
| milk | n |  |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **baseline**: Belgian waffle with strawberries and whipped cream

| gold core item | baseline | notes |
|---|---|---|
| waffles | Y merged |  |
| strawberries (sliced fresh) | Y merged |  |
| strawberry/berry syrup-compote | n |  |
| whipped cream | Y merged |  |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **baseline**: French fries, Doner kebab meat with garlic yogurt sauce, Mixed side salad

| gold core item | baseline | notes |
|---|---|---|
| gyros/döner sliced meat | Y merged |  |
| French fries | Y |  |
| white garlic-yogurt sauce (tzatziki) with oregano | Y merged | C "garlic sauce" is the white garlic-yogurt sauce |
| shredded white cabbage | n | "mixed side salad" names no salad part (rule 1) |
| tomato slices | n |  |
| sweetcorn | n |  |
| cucumber slices | n |  |
| shredded carrot | n |  |
| **core recall (/8)** | 3/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **baseline**: seafood and artichoke paella

| gold core item | baseline | notes |
|---|---|---|
| saffron/paella rice | Y merged |  |
| whole prawns (langostinos) | Y merged |  |
| mantis shrimp (galeras) | Y merged | "seafood paella" covers the mantis shrimp (2026-08-12 cloud precedent) |
| artichoke pieces | Y merged |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **baseline**: savory pierogi with caramelized onions, cabbage and carrot slaw

| gold core item | baseline | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y merged | D "dumplings with meat filling": form right, filling guessed (same call as crab cake for fish cake in 43, precedent) |
| fried caramelised onion topping | Y merged |  |
| grated carrot and cabbage salad | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **baseline**: beef burger, french fries

| gold core item | baseline | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y |  |
| French fries | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **baseline**: baked beans, pork sausage, back bacon

| gold core item | baseline | notes |
|---|---|---|
| baked beans in tomato sauce | Y |  |
| sausage pieces | Y |  |
| bacon rasher | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **baseline**: mixed grill meats with gravy, french fries, grilled gammon, fried egg, grilled tomato

| gold core item | baseline | notes |
|---|---|---|
| liver pieces in gravy | n | "mixed grill meats" / "mixed meat" does not identify liver (adjudicated 2026-08-12) |
| chips/French fries | Y |  |
| bacon/gammon slice | Y |  |
| fried egg (remnant, yolk visible) | Y |  |
| sausage | n |  |
| grilled tomato half | Y |  |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **baseline**: battered fried fish, roasted potato wedges, tartar sauce

| gold core item | baseline | notes |
|---|---|---|
| battered fried fish (cod), partly eaten | Y |  |
| potato wedges/skin-on roast potatoes | Y |  |
| tartar sauce / mayonnaise dollop | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **baseline**: breaded fish fillet with sauce, meatballs with gravy, chickpea curry, white rice, mixed salad with corn and pickled cabbage, mashed potatoes with sauce

| gold core item | baseline | notes |
|---|---|---|
| breaded fried fish fillet | Y merged |  |
| sour cream / remoulade dollop | Y merged | "with sauce" / "tartar sauce" for the white dollop on the fish (precedent) |
| meatballs in brown gravy | Y |  |
| chickpea-and-cauliflower curry | Y |  |
| white rice | Y |  |
| red cabbage and sweetcorn salad | Y | C "mixed vegetable side salad" names no salad (rule 1) |
| cucumber and lettuce salad | n | one corn-and-cabbage salad item cannot also cover the second salad (precedent) |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set, main plate, soup bowl, bread plate

- **baseline**: breaded cutlets with white sauce, green beans, herbed rice, quiche and creamy salad, cream soup with bacon bits, crusty bread with butter

| gold core item | baseline | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | "breaded cutlets" for croquettes/fish cakes: form, hit |
| herbed green rice | Y |  |
| green beans | Y |  |
| cheese-topped quiche/gratin square | Y | A "quiche", B "savory bake", C "vegetable and egg casserole" |
| creamy meat-and-vegetable stew | n | E "egg and bacon scramble" is the stew misread, a miss (adjudicated 2026-08-12, same misread) |
| creamy soup (bowl, with bacon bits) | Y |  |
| bread roll with butter | Y |  |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **baseline**: Garden salad with carrots, Stewed brown beans, Yellow seasoned rice, Sautéed cabbage, Mashed potatoes, Stewed meat with onions

| gold core item | baseline | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | gold row is one salad, "side salad" matches it (precedent) |
| brown beans (feijão) in broth | Y |  |
| yellow seasoned rice | Y |  |
| braised cabbage with tomato | Y |  |
| stewed meat in onion gravy | Y |  |
| mashed cassava/potato purée | Y |  |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45, Korean hanjeongsik table spread (dozens of banchan, top-down)

- **baseline**: Bulgogi (marinated beef), Spicy pork bulgogi, Dubu kimchi (tofu with stir-fried kimchi), Gyeran-jjim (Korean steamed egg), Grilled mackerel, Assorted banchan (japchae, jeon, kimchi, and vegetable sides)

| gold core item | baseline | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | Y merged | A names japchae and jeon inside "Assorted banchan (...)" (enumeration precedent, plate 30) |
| steamed egg (gyeranjjim) in stone pot | Y |  |
| grilled mackerel/fish | Y | C "spicy glazed fish or pork" is the glazed pork (the mackerel is plain, photo); E "spicy grilled fish" credited to the fish |
| stir-fried beef in a hot stone pot | Y |  |
| glazed spicy braised ribs/pork | Y | D "spicy grilled fish or meat" is the glazed pork (D names the mackerel separately) |
| sliced raw fish (hoe/sashimi) on shredded radish | n |  |
| vegetable fritters/jeon platter | Y merged |  |
| kimchi | Y |  |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **baseline**: steamed bean curd skin rolls, curry honeycomb tripe, steamed ginger scallion beef omasum (white tripe)

| gold core item | baseline | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y |  |
| white boiled tripe/omasum slices in broth | Y | D, E name one tripe; one token cannot cover two distinct tripe dishes (precedent) |
| fried beancurd-skin rolls (tofu skin rolls) | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **baseline**: smoothie bowl with kiwi and granola, eggs benedict with hollandaise and tomatoes, avocado toast with poached egg and tomatoes, seeded bagel sandwich, iced latte, passionfruit drink

| gold core item | baseline | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y merged | tomato salad sits on the toast, benedict and bagel plates (photo) |
| eggs benedict with hollandaise on avocado toast | Y merged |  |
| yogurt bowl with granola, kiwi slices and berry compote | Y | "smoothie bowl with kiwi and granola" names the bowl; D "acai bowl with fruit" names neither granola nor kiwi |
| cherry tomato salad with balsamic drizzle | Y merged |  |
| seeded bagel (dark, sesame-topped) | Y |  |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **baseline**: triangle sandwich, frosted vanilla cake slice, potato chips, mini samosas

| gold core item | baseline | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y |  |
| potato chips/crisps | Y |  |
| samosas (small fried triangles) | Y |  |
| slice of white/vanilla cake with icing, partly eaten | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49, Cafe sizzling-plate dinner set

- **baseline**: pork chop with brown sauce, frankfurter sausage, spaghetti with sauce, Hong Kong-style borscht soup, soft dinner roll

| gold core item | baseline | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y |  |
| spaghetti (plain, buttered) | Y |  |
| sausage/frankfurter | Y |  |
| cherry tomatoes | n |  |
| red cabbage soup (borscht-style, bowl) | Y | "tomato soup" / "soup" for the borscht bowl (precedent: "soup" and "vegetable soup" credited) |
| bread bun | Y |  |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **baseline**: Doner kebab meat with tomato sauce, French fries, Side salad

| gold core item | baseline | notes |
|---|---|---|
| döner kebab sliced meat | Y merged |  |
| tomato/chili sauce over the meat | Y merged |  |
| French fries | Y |  |
| iceberg lettuce salad | n | "side salad" names no salad part (rule 1) |
| sliced red onion | n |  |
| cucumber slices | n |  |
| pickled gherkin and pepperoncini | n | C "side salad with peppers": the only peppers are the pepperoncini (photo) |
| **core recall (/7)** | 3/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | baseline |
|---|---|
| core-item recall (/235) | 186/235 = 79.1% |
| hallucinations | 0 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 155 |
| cost / plate (auto) | $0.00652 |
| latency median s (auto) | 12.18 |

## Findings

1. Scored side by side with the four other EU cells. The summary, the paired comparisons and the non-obvious calls are in `runs/EU-PLATE-SCORING-2026-10-06.md`.
2. Trap leaks: none. Hallucinations: none.
