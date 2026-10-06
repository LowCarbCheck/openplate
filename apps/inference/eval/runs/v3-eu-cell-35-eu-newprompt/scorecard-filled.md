# Plate-identification scoring worksheet

- results: `runs/v3-eu-cell-35-eu-newprompt/results.json`
- config: `eu-cell-35-eu-newprompt` (started 2026-10-06T10:13:59.952999+00:00)
- approaches: production
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
> Filled 2026-10-06 under the four adjudication rules of `runs/2026-08-12-50img-SCORING.md`. The two v3 cells (D3, C3) were judged side by side with the v2 answers for the same plates (`feat/eu-prompt-v2`, `runs/v2-eu-cell-*/scorecard-filled.md`), and a name that also appears in the earlier five EU cells or the three v2 cells got the same verdict here. Choices that were not obvious: `runs/EU-PLATE-SCORING-V3-2026-10-06.md`.

## Mechanical metrics (auto-computed)

| metric | production |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 175 |
| items named (mean/plate) | 3.5 |
| distinct item names | 153 |
| latency mean (s) | 4.46 |
| latency median (s) | 3.98 |
| latency max (s) | 8.94 |
| cost / plate (USD) | 0.004714 |
| cost total (USD) | 0.235707 |

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

- **production**: brown bread, ham, baked beans, mini sausages, scrambled eggs, cucumber slices

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

- **production**: roast beef, Yorkshire pudding, roasted potatoes, steamed broccoli and cabbage, gravy

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

- **production**: pan-seared salmon, greek salad with feta avocado and olives

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

- **production**: cheeseburger, french fries, ketchup, pickle, beer

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

- **production**: white rice, chicken stew with greens

| gold core item | production | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y |  |
| white rice | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red bell pepper bits in rice

### 06, Sushi platter (restaurant table)

- **production**: salmon avocado maki roll, assorted nigiri sushi, soy sauce, white wine

| gold core item | production | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y |  |
| tuna nigiri | Y merged | D3 "assorted nigiri sushi" covers both nigiri rows (A, B, C name); C3 names tuna and white fish nigiri separately |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | Y merged |  |
| pickled ginger | n |  |
| wasabi | n |  |
| soy sauce | Y |  |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none | C3 "sparkling wine" for the wine glass: a misnamed visible object, optional, not a hallucination (rule 3) |
| **over-decomposed** | 0 |  |

Optional (no recall credit): white wine / water glasses in background

### 07, Spaghetti with meat-vegetable sauce

- **production**: spaghetti with meat and vegetable sauce

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

- **production**: yogurt with granola and apple

| gold core item | production | notes |
|---|---|---|
| yogurt | Y merged |  |
| granola (oats/puffed grains, nuts) | Y merged |  |
| apple slices | Y merged |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09, Whole chicken pizza in delivery box

- **production**: chicken pizza

| gold core item | production | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y |  |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cola drink at table edge

### 10, Club sandwich with side salad (cafe table)

- **production**: chicken sandwich with salad, Pepsi Max

| gold core item | production | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y merged | D3 "chicken sandwich with salad" = D, E name |
| green side salad (rocket/mixed leaves) | Y merged |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11, Wiener Schnitzel with fries and side salad

- **production**: breaded fish fillet, french fries, mixed salad with dressing

| gold core item | production | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | n | D3 "breaded fish fillet" for a pork/veal schnitzel: species miss (rule 2), same as D, E, D2 |
| thick-cut fries/potato wedges | Y |  |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y |  |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12, Bratwurst plate with sauerkraut and mashed potatoes

- **production**: pork sausage, mashed potatoes, braised sauerkraut, mixed salad

| gold core item | production | notes |
|---|---|---|
| bratwurst sausages | Y |  |
| sauerkraut | Y |  |
| mashed potatoes | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | D3 "mixed salad" from the background plate: trap leak, not a hallucination (rule 3), as D2 |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13, Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **production**: käsespätzle, mixed salad with dressing

| gold core item | production | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y |  |
| fried/caramelised onions | n | D3 "käsespätzle" names no onions (D2 named them) |
| **core recall (/2)** | 1/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14, Beef gulasch with boiled potatoes and a side bowl of lettuce

- **production**: beef stew with potatoes and mushrooms, green salad

| gold core item | production | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y merged |  |
| boiled potatoes | Y merged |  |
| green leaf lettuce (butterhead) in a separate glass bowl | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15, Bavarian Weisswurst breakfast

- **production**: Bavarian white sausage, Soft pretzel, Sweet mustard, Beer

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

- **production**: doner kebab with tomato sauce and french fries, mixed salad with dressing, beer

| gold core item | production | notes |
|---|---|---|
| döner/gyros sliced meat | Y merged |  |
| tomato sauce over the meat | Y merged |  |
| French fries | Y merged |  |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17, Currywurst with French fries

- **production**: currywurst with french fries

| gold core item | production | notes |
|---|---|---|
| currywurst (sausage) | Y merged |  |
| curry ketchup sauce | Y merged |  |
| curry powder | n |  |
| French fries | Y merged |  |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

### 18, Swabian Maultaschen with potato salad

- **production**: meat-filled pasta rolls with potato salad

| gold core item | production | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y merged |  |
| potato salad | Y merged |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19, German fast-food mixed plate (Taxiteller)

- **production**: french fries, gyro meat, tzatziki, mayonnaise, currywurst with curry sauce

| gold core item | production | notes |
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

- **production**: ramen noodle soup with pork and greens

| gold core item | production | notes |
|---|---|---|
| ramen noodles | Y merged |  |
| clear (shio) broth | Y merged |  |
| sliced chashu pork | Y merged |  |
| leafy green herb topping (mizuna/mitsuba) | Y merged | D3 "ramen noodle soup with pork and greens": "greens" is the only leafy topping (like "fresh herbs" for Thai basil on 21); "pork" in ramen is the chashu |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21, Vietnamese pho with a side plate of herb garnishes

- **production**: beef noodle soup, bean sprouts, fresh basil and herbs

| gold core item | production | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y merged |  |
| sliced beef and beef meatballs | Y merged |  |
| bean sprouts | Y |  |
| Thai basil | Y | D3 "fresh basil and herbs", C3 "raw bean sprouts and thai basil plate" |
| sliced green chilli/jalapeño | n |  |
| spring onion | n |  |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22, Three soft tacos with a corn cob

- **production**: beef tacos, grilled corn on the cob, cola

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

- **production**: wet burrito

| gold core item | production | notes |
|---|---|---|
| burrito (flour tortilla) | Y merged |  |
| green chile sauce | Y merged |  |
| shredded cheddar/jack cheese | n |  |
| shredded lettuce | n | C3 "salad topping" is the shredded lettuce, as C |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): diced tomato

### 24, Fish and chips with peas

- **production**: battered fish, french fries, green peas, tartare sauce

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

- **production**: pancakes with icing sugar, back bacon, fried egg, pork sausages, hash browns, toast, butter, maple syrup

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

- **production**: rice pulao, roti flatbread, papadum, plain yogurt, mixed vegetable soup, dal curry, paneer curry, kofta curry, mixed vegetable curry

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

- **production**: chicken stir fry with cashews, cooked white rice

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

- **production**: falafel bowl with bulgur, lentils, and hummus, flatbread with spicy sauce

| gold core item | production | notes |
|---|---|---|
| falafel balls | Y merged | D3 "falafel bowl with bulgur, lentils, and hummus" names four rows (enumeration precedent); C3 lists "falafel and mezze salad bowl" five times, one per bowl (portion hints name five positions) |
| grilled flatbread | Y merged |  |
| hummus/creamy white dip | Y merged |  |
| green herb-chilli sauce | Y merged | D3 "flatbread with spicy sauce", like D2 "spicy chili dipping sauce" (form, not kind); C3 "chili herb dipping oil" |
| yellow bulgur or couscous | Y merged |  |
| black beluga lentils | Y merged |  |
| pickled white cabbage slaw | n |  |
| green olives | n |  |
| **core recall (/8)** | 6/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29, Tapas/snack flight with a wheat beer

- **production**: wheat beer, salami, cubed cheese, green olives, pickles and dip

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

- **production**: grilled steak, roasted ribs, meat and vegetable skewer, grilled sausage, twice baked potato with cheese, mixed salad

| gold core item | production | notes |
|---|---|---|
| pork spare ribs slab | Y |  |
| grilled beef steak | Y |  |
| grilled sausage | Y |  |
| grilled meat skewer with green pepper and tomato | Y |  |
| baked/roasted potato with browned cheese topping | Y |  |
| mixed leaf salad | Y |  |
| **core recall (/6)** | 6/6 |  |
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

- **production**: green olives, cucumber sticks, carrot sticks, bell pepper strips, spiced deviled eggs, hummus, herbed sliced cheese, cheddar cheese slices, salami slices, herb crackers

| gold core item | production | notes |
|---|---|---|
| green olives | Y |  |
| cucumber sticks | Y | C3 "mixed vegetable crudites" names nothing (rule 1, as "vegetable sticks") |
| carrot sticks | Y |  |
| bell pepper strips | Y |  |
| pan-fried spiced hard-boiled egg halves | Y |  |
| hummus dip | Y |  |
| salami/cured meat slices | Y |  |
| cheese slices | Y |  |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33, Bowl of oatmeal porridge with toppings

- **production**: cooked oatmeal with milk, peanut butter, honey, raisins, and cinnamon

| gold core item | production | notes |
|---|---|---|
| oatmeal/oat porridge | Y merged |  |
| peanut butter | Y merged |  |
| raisins | Y merged |  |
| ground cinnamon | Y merged |  |
| milk | Y merged | D3 "cooked oatmeal with milk, peanut butter, honey, raisins, and cinnamon" is ONE item and names the milk |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34, Waffles with strawberries and whipped cream

- **production**: waffle with strawberries, strawberry syrup, and whipped cream

| gold core item | production | notes |
|---|---|---|
| waffles | Y merged |  |
| strawberries (sliced fresh) | Y merged |  |
| strawberry/berry syrup-compote | Y merged | D3 one item names the syrup (E name); C3 "strawberry topping" credits one row only, the strawberries (as "waffle with strawberries") |
| whipped cream | Y merged |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): orange juice glass at top edge

### 35, Gyros/döner plate with fries and salad

- **production**: doner kebab with tzatziki sauce, french fries, mixed salad, flatbread

| gold core item | production | notes |
|---|---|---|
| gyros/döner sliced meat | Y merged |  |
| French fries | Y |  |
| white garlic-yogurt sauce (tzatziki) with oregano | Y merged |  |
| shredded white cabbage | n | C3 "side salad with corn, tomato and cabbage" names three salad parts; D3 "mixed salad" names none (rule 1) |
| tomato slices | n |  |
| sweetcorn | n |  |
| cucumber slices | n |  |
| shredded carrot | n |  |
| **core recall (/8)** | 3/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36, Seafood paella in the pan

- **production**: seafood paella

| gold core item | production | notes |
|---|---|---|
| saffron/paella rice | Y merged |  |
| whole prawns (langostinos) | Y merged |  |
| mantis shrimp (galeras) | Y merged |  |
| artichoke pieces | n | D3 "seafood paella" does not entail artichoke (C2 call) |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37, Pierogi ruskie with carrot-cabbage salad

- **production**: dumplings with meat filling and caramelized onions, coleslaw salad

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

- **production**: hamburger, french fries

| gold core item | production | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y |  |
| French fries | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39, Remains of a fried breakfast (mostly eaten)

- **production**: baked beans, pork sausages, back bacon

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

- **production**: beef stew and liver, french fries, grilled sausage, grilled bacon, fried egg

| gold core item | production | notes |
|---|---|---|
| liver pieces in gravy | Y | D3 "beef stew and liver", C3 "Steak and beef liver in gravy" name the liver |
| chips/French fries | Y |  |
| bacon/gammon slice | Y |  |
| fried egg (remnant, yolk visible) | Y |  |
| sausage | Y |  |
| grilled tomato half | n |  |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41, Leftovers of battered fish and potato wedges

- **production**: battered fish, potato wedges, mayonnaise

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

- **production**: breaded fish fillet with tartar sauce, meatballs with gravy, chickpea curry with rice, mixed vegetable salad with corn

| gold core item | production | notes |
|---|---|---|
| breaded fried fish fillet | Y merged |  |
| sour cream / remoulade dollop | Y merged |  |
| meatballs in brown gravy | Y |  |
| chickpea-and-cauliflower curry | Y merged | D3 "chickpea curry with rice" (D, C form) |
| white rice | Y merged |  |
| red cabbage and sweetcorn salad | Y | D3 "with corn" names the salad (D2 call); C3 "Mixed side salad" names none (rule 1) |
| cucumber and lettuce salad | n |  |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43, Buffet lunch set, main plate, soup bowl, bread plate

- **production**: bread slice with butter, creamy soup with bacon, breaded fish cutlet with mayonnaise, green beans and rice pilaf, savory minced meat scramble, baked quiche slice

| gold core item | production | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y |  |
| herbed green rice | Y merged |  |
| green beans | Y merged |  |
| cheese-topped quiche/gratin square | Y |  |
| creamy meat-and-vegetable stew | Y | D3 "savory minced meat scramble": kind right (meat, photo shows minced meat in a creamy sauce), form wrong, hit (rule 2); C3 "pasta or potato salad with bacon bits" is the C2, B2 misread, miss |
| creamy soup (bowl, with bacon bits) | Y |  |
| bread roll with butter | Y |  |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44, Brazilian buffet lunch plate (top-down)

- **production**: mixed green salad, cooked black beans, seasoned rice, mashed potato, braised cabbage with tomato, braised pork dish

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

- **production**: japchae, bulgogi, steamed egg, grilled mackerel, tofu with kimchi, seasoned grilled fish, sashimi platter, assorted jeon

| gold core item | production | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | Y |  |
| steamed egg (gyeranjjim) in stone pot | Y |  |
| grilled mackerel/fish | Y |  |
| stir-fried beef in a hot stone pot | Y |  |
| glazed spicy braised ribs/pork | n | D3 "seasoned grilled fish" cannot take the glazed pork (D2 call, one token one row, mackerel named separately); C3 "Spicy grilled deodeok or pork" goes to the pork row (hedge precedent) |
| sliced raw fish (hoe/sashimi) on shredded radish | Y |  |
| vegetable fritters/jeon platter | Y |  |
| kimchi | Y |  |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46, Hong Kong steamer basket of small offal dishes (dai pai dong)

- **production**: braised beef tripe, steamed bean curd skin rolls

| gold core item | production | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y |  |
| white boiled tripe/omasum slices in broth | n | D3 one tripe token cannot cover two tripe dishes (precedent) |
| fried beancurd-skin rolls (tofu skin rolls) | Y |  |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47, Café brunch table spread (top-down)

- **production**: avocado toast with poached egg, eggs Benedict on English muffin, acai bowl with fruit, bagel, iced latte, beetroot latte, white wine, passion fruit cocktail or mocktail

| gold core item | production | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y |  |
| eggs benedict with hollandaise on avocado toast | Y |  |
| yogurt bowl with granola, kiwi slices and berry compote | n | D3 "acai bowl with fruit" names neither granola nor kiwi (D call); C3 "Acai smoothie bowl with kiwi and granola" names both |
| cherry tomato salad with balsamic drizzle | n | C3 "with cherry tomatoes" on the toast and the benedict covers the tomato salad (A, C, E consolidation) |
| seeded bagel (dark, sesame-topped) | Y |  |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48, Disposable plate of party snacks (partly eaten)

- **production**: potato chips, slice of cake with frosting, triangle sandwich, mini vegetable samosas

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

- **production**: sizzling steak with spaghetti, sausage and pepper sauce, bread roll, minestrone soup

| gold core item | production | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y merged |  |
| spaghetti (plain, buttered) | Y merged |  |
| sausage/frankfurter | Y merged |  |
| cherry tomatoes | n |  |
| red cabbage soup (borscht-style, bowl) | Y | D3 "minestrone soup" for the borscht bowl (C precedent); D3 steak, spaghetti, sausage are ONE item |
| bread bun | Y |  |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50, Late-night döner kebab plate with fries and salad

- **production**: doner kebab with fries and salad, beer

| gold core item | production | notes |
|---|---|---|
| döner kebab sliced meat | Y merged |  |
| tomato/chili sauce over the meat | n |  |
| French fries | Y merged |  |
| iceberg lettuce salad | n |  |
| sliced red onion | n | C3 "side salad with cucumber and onion" names the cucumber and the red onion |
| cucumber slices | n |  |
| pickled gherkin and pepperoncini | n |  |
| **core recall (/7)** | 2/7 |  |
| **hallucinations** | none |  |
| **over-decomposed** | 0 |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | production |
|---|---|
| core-item recall (/235) | 196/235 = 83.4% |
| hallucinations | 0 |
| over-decomposed (composite split into parts) | 0 |
| distinct items named (auto) | 153 |
| cost / plate (auto) | $0.00471 |
| latency median s (auto) | 3.98 |

## Findings

1. 
