# Plate-identification scoring worksheet

- results: `runs/v3-eu-cell-38-minimal-newprompt/results.json`
- config: `eu-cell-38-minimal-newprompt` (started 2026-10-06T10:13:59.952820+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`. The two v3 cells (D3, C3) were judged side by side with the v2 answers for the same plates (`feat/eu-prompt-v2`, `runs/v2-eu-cell-*/scorecard-filled.md`), and a name that also appears in the earlier five EU cells or the three v2 cells got the same verdict here. Choices that were not obvious: `runs/EU-PLATE-SCORING-V3-2026-10-06.md`.

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 200 |
| items named (mean/plate) | 4 |
| distinct item names | 175 |
| latency mean (s) | 11.05 |
| latency median (s) | 9.64 |
| latency max (s) | 30.27 |
| cost / plate (USD) | 0.008969 |
| cost total (USD) | 0.448442 |

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

- **production**: dark whole grain bread, scrambled eggs, baked beans in tomato sauce, cooked breakfast sausages, cooked ham or bacon slices, cucumber slices, margarine portion

| gold core item | production | notes |
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

- **production**: Yorkshire pudding, roast beef with gravy, roast potatoes, steamed broccoli and cabbage

| gold core item | production | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y |  |
| Yorkshire pudding | Y |  |
| roast potatoes | Y |  |
| broccoli | Y merged |  |
| cabbage/greens | Y merged |  |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item

### 03, Greek-style salad with grilled salmon

- **production**: pan-seared salmon fillet, Greek salad with avocado

| gold core item | production | notes |
|---|---|---|
| grilled salmon fillets | Y |  |
| feta cheese | Y merged | C3 "Greek salad with avocado" names no feta; feta is part of the determinate dish "Greek salad" (rule 1), so it is covered |
| kalamata olives | Y merged | D3 "greek salad with feta avocado and olives", C3 "Greek salad": determinate dish, as A, B, C, C2, B2 |
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

- **production**: cheeseburger, french fries, ketchup, pickles, beer

| gold core item | production | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y |  |
| thick-cut fries/steak fries | Y |  |
| ketchup | Y |  |
| pickles/gherkins | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05, Chicken in creamy leafy-green sauce with white rice

- **production**: cooked white rice, chicken and spinach stew

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y |  |
| white rice | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: salmon avocado roll, tuna nigiri, white fish nigiri, sparkling wine

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y |  |
| tuna nigiri | Y | D3 "assorted nigiri sushi" covers both nigiri rows (A, B, C name); C3 names tuna and white fish nigiri separately |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | Y |  |
| pickled ginger | n |  |
| wasabi | n |  |
| soy sauce | n |  |
| **core recall (/6)** | 3/6 |  |
| **hallucinations** | none | C3 "sparkling wine" for the wine glass: a misnamed visible object, optional, not a hallucination (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: Spaghetti Bolognese with Vegetables

| gold core item | production | notes |
|---|---|---|
| spaghetti | Y merged |  |
| ground beef/meat tomato sauce | Y merged |  |
| corn kernels | n |  |
| green beans | n |  |
| carrot pieces | n |  |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 08, Yogurt granola bowl with apple

- **production**: plain yogurt, granola with nuts, apple slices

| gold core item | production | notes |
|---|---|---|
| yogurt | Y |  |
| granola (oats/puffed grains, nuts) | Y |  |
| apple slices | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **production**: Chicken and cheese pizza

| gold core item | production | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y |  |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **production**: chicken salad sandwich, side green salad, Pepsi Max

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | D3 "chicken sandwich with salad" = D, E name |
| green side salad (rocket/mixed leaves) | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: breaded schnitzel, steakhouse french fries, side mixed salad with dressing, ketchup

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | Y | D3 "breaded fish fillet" for a pork/veal schnitzel: species miss (rule 2), same as D, E, D2 |
| thick-cut fries/potato wedges | Y |  |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: German pork sausages with mustard, mashed potatoes, sauerkraut

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y |  |
| sauerkraut | Y |  |
| mashed potatoes | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: Käsespätzle with fried onions, side salad with creamy dressing

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y merged |  |
| fried/caramelised onions | Y merged | D3 "käsespätzle" names no onions (D2 named them) |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: beef stew with gravy and mushrooms, boiled potatoes, green side salad with dressing

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y |  |
| boiled potatoes | Y |  |
| green leaf lettuce (butterhead) in a separate glass bowl | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: bavarian weisswurst, soft pretzel, sweet bavarian mustard, wheat beer

| gold core item | production | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y |  |
| pretzel (Brezel) | Y |  |
| sweet mustard | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16, Döner/gyros plate with fries and salad

- **production**: doner kebab meat with tomato sauce, French fries, mixed side salad with dressing, beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | Y merged |  |
| tomato sauce over the meat | Y merged |  |
| French fries | Y |  |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: currywurst with sauce, french fries

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y merged |  |
| curry ketchup sauce | Y merged |  |
| curry powder | n |  |
| French fries | Y |  |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: Maultaschen, Swabian potato salad

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y |  |
| potato salad | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: french fries with mayonnaise, gyros with tzatziki, currywurst

| gold core item | production | notes |
|---|---|---|
| French fries | Y merged |  |
| gyros/döner sliced meat | Y merged |  |
| sliced sausage in curry/shashlik sauce | Y |  |
| tzatziki/garlic yogurt sauce | Y merged |  |
| mayonnaise | Y merged |  |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 20, Bowl of shio ramen

- **production**: ramen soup with chashu pork

| gold core item | production | notes |
|---|---|---|
| ramen noodles | Y merged |  |
| clear (shio) broth | Y merged |  |
| sliced chashu pork | Y merged |  |
| leafy green herb topping (mizuna/mitsuba) | n | D3 "ramen noodle soup with pork and greens": "greens" is the only leafy topping (like "fresh herbs" for Thai basil on 21); "pork" in ramen is the chashu |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **production**: beef pho noodle soup, extra rice noodles, raw bean sprouts and thai basil plate, iced tea

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y merged |  |
| sliced beef and beef meatballs | Y merged |  |
| bean sprouts | Y merged |  |
| Thai basil | Y merged | D3 "fresh basil and herbs", C3 "raw bean sprouts and thai basil plate" |
| sliced green chilli/jalapeño | n |  |
| spring onion | n |  |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: beef tacos, grilled corn on the cob, cola soft drink

| gold core item | production | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y |  |
| grated cheese | n |  |
| red salsa | n |  |
| green salsa/tomatillo | n |  |
| coriander/cilantro | n |  |
| grilled corn on the cob | Y |  |
| **core recall (/6)** | 2/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of cola

### 23, Smothered beef burrito

- **production**: smothered burrito with cheese and salad topping

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | Y merged |  |
| green chile sauce | Y merged |  |
| shredded cheddar/jack cheese | Y merged |  |
| shredded lettuce | Y merged | C3 "salad topping" is the shredded lettuce, as C |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **production**: battered fried fish, french fries, green peas, tartar sauce

| gold core item | production | notes |
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

- **production**: pancakes with powdered sugar, fried egg, back bacon, breakfast sausages, hash browns, toasted white bread, pancake syrup, butter portion

| gold core item | production | notes |
|---|---|---|
| pancakes with icing sugar | Y |  |
| back bacon rashers | Y |  |
| fried egg (sunny side up) | Y |  |
| breakfast sausages | Y |  |
| hash brown/potato croquettes | Y |  |
| toast slices | Y |  |
| maple syrup in a shot glass | Y |  |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): butter packet

### 26, Indian thali on a steel tray

- **production**: vegetable fried rice, roti flatbread, papadum, plain curd yogurt, clear vegetable soup, malai kofta curry, dal tadka, paneer curry, mixed vegetable curry, shredded cabbage salad

| gold core item | production | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y |  |
| chapati/roti | Y |  |
| papad (papadum) | Y |  |
| curd/raita | Y |  |
| dal (lentil curry) | Y |  |
| kofta/dumpling curry in orange gravy | Y |  |
| paneer or fish curry in pale gravy | Y |  |
| brinjal/eggplant curry | Y |  |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27, Stir-fried chicken with peppers and steamed rice

- **production**: stir-fried chicken with cashew nuts and vegetables, steamed jasmine rice

| gold core item | production | notes |
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

- **production**: falafel and mezze salad bowl, falafel and mezze salad bowl, falafel and mezze salad bowl, falafel and mezze salad bowl, falafel and mezze salad bowl, grilled flatbread, chili herb dipping oil

| gold core item | production | notes |
|---|---|---|
| falafel balls | Y | D3 "falafel bowl with bulgur, lentils, and hummus" names four rows (enumeration precedent); C3 lists "falafel and mezze salad bowl" five times, one per bowl (portion hints name five positions) |
| grilled flatbread | Y |  |
| hummus/creamy white dip | n |  |
| green herb-chilli sauce | Y | D3 "flatbread with spicy sauce", like D2 "spicy chili dipping sauce" (form, not kind); C3 "chili herb dipping oil" |
| yellow bulgur or couscous | n |  |
| black beluga lentils | n |  |
| pickled white cabbage slaw | n |  |
| green olives | n |  |
| **core recall (/8)** | 3/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: wheat beer, cubed semi-hard cheese, salami slices, green olives, pickled cucumbers with sauce

| gold core item | production | notes |
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

- **production**: grilled beef steak, pork ribs, meat and vegetable skewers, twice-baked potato with cheese, side salad

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | Y |  |
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

- **production**: beef goulash soup, bread with butter

| gold core item | production | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y merged |  |
| beef (oxtail) chunks | Y merged |  |
| buttered bread slices (dark/whole-grain) | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32, Charcuterie/snack board (compartmented bamboo tray, top-down)

- **production**: deviled eggs with paprika, salami slices, herb crackers, sliced semi-hard cheeses, hummus dip, mixed vegetable crudites, green olives

| gold core item | production | notes |
|---|---|---|
| green olives | Y |  |
| cucumber sticks | n | C3 "mixed vegetable crudites" names nothing (rule 1, as "vegetable sticks") |
| carrot sticks | n |  |
| bell pepper strips | n |  |
| pan-fried spiced hard-boiled egg halves | Y |  |
| hummus dip | Y |  |
| salami/cured meat slices | Y |  |
| cheese slices | Y |  |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **production**: oatmeal porridge, peanut butter, maple syrup, raisins, ground cinnamon

| gold core item | production | notes |
|---|---|---|
| oatmeal/oat porridge | Y |  |
| peanut butter | Y |  |
| raisins | Y |  |
| ground cinnamon | Y |  |
| milk | n | D3 "cooked oatmeal with milk, peanut butter, honey, raisins, and cinnamon" is ONE item and names the milk |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: Belgian waffle, strawberry topping, whipped cream

| gold core item | production | notes |
|---|---|---|
| waffles | Y |  |
| strawberries (sliced fresh) | Y |  |
| strawberry/berry syrup-compote | n | D3 one item names the syrup (E name); C3 "strawberry topping" credits one row only, the strawberries (as "waffle with strawberries") |
| whipped cream | Y |  |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **production**: doner kebab meat with garlic yogurt sauce, french fries, side salad with corn, tomato and cabbage

| gold core item | production | notes |
|---|---|---|
| gyros/döner sliced meat | Y merged |  |
| French fries | Y |  |
| white garlic-yogurt sauce (tzatziki) with oregano | Y merged |  |
| shredded white cabbage | Y merged | C3 "side salad with corn, tomato and cabbage" names three salad parts; D3 "mixed salad" names none (rule 1) |
| tomato slices | Y merged |  |
| sweetcorn | Y merged |  |
| cucumber slices | n |  |
| shredded carrot | n |  |
| **core recall (/8)** | 6/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: seafood and artichoke paella

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | Y merged |  |
| whole prawns (langostinos) | Y merged |  |
| mantis shrimp (galeras) | Y merged |  |
| artichoke pieces | Y merged | D3 "seafood paella" does not entail artichoke (C2 call) |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: dumplings with savory filling topped with fried onions, cabbage and carrot slaw

| gold core item | production | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y merged |  |
| fried caramelised onion topping | Y merged |  |
| grated carrot and cabbage salad | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38, Half-eaten beefburger with fries

- **production**: cheeseburger, french fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y |  |
| French fries | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: baked beans in tomato sauce, breakfast pork sausage pieces, cooked back bacon

| gold core item | production | notes |
|---|---|---|
| baked beans in tomato sauce | Y |  |
| sausage pieces | Y |  |
| bacon rasher | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40, Half-eaten liver-and-bacon fry-up with chips

- **production**: French fries, Steak and beef liver in gravy, Pork sausage, Gammon steak, Fried egg, Grilled tomato

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | Y | D3 "beef stew and liver", C3 "Steak and beef liver in gravy" name the liver |
| chips/French fries | Y |  |
| bacon/gammon slice | Y |  |
| fried egg (remnant, yolk visible) | Y |  |
| sausage | Y |  |
| grilled tomato half | Y |  |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: battered fried fish, roasted potato wedges, tartar sauce

| gold core item | production | notes |
|---|---|---|
| battered fried fish (cod), partly eaten | Y |  |
| potato wedges/skin-on roast potatoes | Y |  |
| tartar sauce / mayonnaise dollop | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42, Buffet lunch plate (many components)

- **production**: Breaded fish fillet with tartar sauce, Cooked white rice, Chickpea curry, Meatballs with gravy, Mixed side salad

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | Y merged |  |
| sour cream / remoulade dollop | Y merged |  |
| meatballs in brown gravy | Y |  |
| chickpea-and-cauliflower curry | Y | D3 "chickpea curry with rice" (D, C form) |
| white rice | Y |  |
| red cabbage and sweetcorn salad | n | D3 "with corn" names the salad (D2 call); C3 "Mixed side salad" names none (rule 1) |
| cucumber and lettuce salad | n |  |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set, main plate, soup bowl, bread plate

- **production**: bread roll with spread, creamy soup or dip with crispy bacon, breaded fish or chicken patties with mayonnaise, seasoned rice, green beans, crustless quiche or egg casserole, pasta or potato salad with bacon bits

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y |  |
| herbed green rice | Y |  |
| green beans | Y |  |
| cheese-topped quiche/gratin square | Y |  |
| creamy meat-and-vegetable stew | n | D3 "savory minced meat scramble": kind right (meat, photo shows minced meat in a creamy sauce), form wrong, hit (rule 2); C3 "pasta or potato salad with bacon bits" is the C2, B2 misread, miss |
| creamy soup (bowl, with bacon bits) | Y |  |
| bread roll with butter | Y |  |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: mixed salad with lettuce and carrot, cooked pinto beans, yellow rice, sauteed cabbage with tomatoes, mashed potatoes, braised pork with potato

| gold core item | production | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y |  |
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

- **production**: Bulgogi (Korean marinated beef), Spicy grilled deodeok or pork (gui), Grilled mackerel (Godeungeo gui), Gyeran-jjim (Korean steamed egg), Dubu kimchi (tofu with stir-fried kimchi), Japchae (stir-fried glass noodles), Jeon (Korean assorted pancakes), Korean sashimi (Hoe), Baechu kimchi (Napa cabbage kimchi), Korean soup or stew (Jjigae), Mul-kimchi (Water kimchi), Assorted namul (seasoned vegetables)

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | Y |  |
| steamed egg (gyeranjjim) in stone pot | Y |  |
| grilled mackerel/fish | Y |  |
| stir-fried beef in a hot stone pot | Y |  |
| glazed spicy braised ribs/pork | Y | D3 "seasoned grilled fish" cannot take the glazed pork (D2 call, one token one row, mackerel named separately); C3 "Spicy grilled deodeok or pork" goes to the pork row (hedge precedent) |
| sliced raw fish (hoe/sashimi) on shredded radish | Y |  |
| vegetable fritters/jeon platter | Y |  |
| kimchi | Y |  |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: Steamed bean curd skin rolls, Steamed beef honeycomb tripe in sauce, Steamed beef omasum tripe with ginger and scallion

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y |  |
| white boiled tripe/omasum slices in broth | Y | D3 one tripe token cannot cover two tripe dishes (precedent) |
| fried beancurd-skin rolls (tofu skin rolls) | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: Avocado and poached egg toast with cherry tomatoes, Eggs Benedict with avocado and cherry tomatoes, Acai smoothie bowl with kiwi and granola, Seeded bagel sandwich, Iced latte, Beetroot latte, Passion fruit iced tea or mocktail, White wine

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y merged |  |
| eggs benedict with hollandaise on avocado toast | Y merged |  |
| yogurt bowl with granola, kiwi slices and berry compote | Y | D3 "acai bowl with fruit" names neither granola nor kiwi (D call); C3 "Acai smoothie bowl with kiwi and granola" names both |
| cherry tomato salad with balsamic drizzle | Y merged | C3 "with cherry tomatoes" on the toast and the benedict covers the tomato salad (A, C, E consolidation) |
| seeded bagel (dark, sesame-topped) | Y |  |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: triangle sandwich, white sheet cake with frosting, potato chips, cocktail samosas

| gold core item | production | notes |
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

- **production**: grilled pork chop with black pepper sauce, pork sausage, spaghetti pasta, soft dinner roll, borscht soup

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y |  |
| spaghetti (plain, buttered) | Y |  |
| sausage/frankfurter | Y |  |
| cherry tomatoes | n |  |
| red cabbage soup (borscht-style, bowl) | Y | D3 "minestrone soup" for the borscht bowl (C precedent); D3 steak, spaghetti, sausage are ONE item |
| bread bun | Y |  |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: doner kebab meat with tomato sauce, french fries, side salad with cucumber and onion, lager beer

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y merged |  |
| tomato/chili sauce over the meat | Y merged |  |
| French fries | Y |  |
| iceberg lettuce salad | n |  |
| sliced red onion | Y merged | C3 "side salad with cucumber and onion" names the cucumber and the red onion |
| cucumber slices | Y merged |  |
| pickled gherkin and pepperoncini | n |  |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 199/235 = 84.7% |
| hallucinations | 0 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 175 |
| cost / plate (auto) | $0.00897 |
| latency median s (auto) | 9.64 |

## Findings

1. 
