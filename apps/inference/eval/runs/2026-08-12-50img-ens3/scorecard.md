# Plate-identification scoring worksheet

- results: `runs/2026-08-12-50img-ens3/results.json`
- config: `local-cpu` (started 2026-08-12T12:36:45.775808+00:00)
- approaches: ensemble_lfm
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
- fan-out override: 3

## Mechanical metrics (auto-computed)

| metric | ensemble_lfm |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 248 |
| items named (mean/plate) | 4.96 |
| distinct item names | 166 |
| latency mean (s) | 145.13 |
| latency median (s) | 143.23 |
| latency max (s) | 391.91 |
| cost / plate (USD) | 0.0 |
| cost total (USD) | 0.0 |

## Scoring instructions (human / reviewing agent)

Semantic matching is NOT automated — fuzzy matching lies exactly where it matters
("Greek salad" legitimately covering three gold rows; "sashimi" for nigiri hiding a
rice miss). For each image below:

1. Read the reported food list for each approach against the gold core items.
2. Put `Y` in the cell when the approach covered that gold item (a consolidation counts,
   but note the granularity loss in Notes), `n` when it missed it.
3. Fill the recall row with the resulting `hits/total`.
4. List anything reported that is **not visible in the photo** under Hallucinations.
5. Optional items earn no recall credit; reporting them is not an error either.

> Gold-label protocol: Gold labels authored by hand from direct image inspection (Fable, 2026-08-11). 'core' = items a correct identification must include (synonyms/consolidations acceptable, e.g. 'Greek salad' may cover lettuce+cucumber+tomato). 'optional' = visible but acceptable to omit (garnish, condiments, off-plate drinks). Hallucination = any reported food not visible at all. Entries 11-50 (added 2026-08-11): drafted by two opus vision agents under the same protocol, spot-verified by Fable against images 12/19/22/39/45/46 before merge; manifest descriptions for 32/46/47 corrected to match images.

### 01 — Continental/English-style breakfast plate

- **ensemble_lfm**: sliced bread, ham, beef stew, scrambled eggs, cucumber slices, Baked beans

| gold core item | ensemble_lfm | notes |
|---|---|---|
| scrambled eggs |   |  |
| bacon/ham slices |   |  |
| frankfurter sausages |   |  |
| baked beans in tomato sauce |   |  |
| brown bread slice |   |  |
| cucumber slices |   |  |
| **core recall (/6)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): butter/margarine packets

### 02 — Roast (Sunday) dinner

- **ensemble_lfm**: Roast chicken, Roast pork belly, Roast potatoes, Broccoli, Beef, Potatoes

| gold core item | ensemble_lfm | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy |   |  |
| Yorkshire pudding |   |  |
| roast potatoes |   |  |
| broccoli |   |  |
| cabbage/greens |   |  |
| **core recall (/5)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): gravy as separate item

### 03 — Greek-style salad with grilled salmon

- **ensemble_lfm**: Grilled Salmon, Lemon Wedge, Olives, Cucumbers, Avocado, Red Onion

| gold core item | ensemble_lfm | notes |
|---|---|---|
| grilled salmon fillets |   |  |
| feta cheese |   |  |
| kalamata olives |   |  |
| avocado |   |  |
| cherry tomatoes |   |  |
| cucumber |   |  |
| lettuce/romaine |   |  |
| red onion |   |  |
| **core recall (/8)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04 — Cheeseburger with fries

- **ensemble_lfm**: cheeseburger, french fries, pickle, mustard, Grilled chicken breast, Ketchup

| gold core item | ensemble_lfm | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) |   |  |
| thick-cut fries/steak fries |   |  |
| ketchup |   |  |
| pickles/gherkins |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05 — Chicken in creamy leafy-green sauce with white rice

- **ensemble_lfm**: Rice, Chicken, Green Sauce, Spinach, Mushrooms, Chicken

| gold core item | ensemble_lfm | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) |   |  |
| white rice |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): red bell pepper bits in rice

### 06 — Sushi platter (restaurant table)

- **ensemble_lfm**: Sushi roll, Raw fish

| gold core item | ensemble_lfm | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) |   |  |
| tuna nigiri |   |  |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) |   |  |
| pickled ginger |   |  |
| wasabi |   |  |
| soy sauce |   |  |
| **core recall (/6)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): white wine / water glasses in background

### 07 — Spaghetti with meat-vegetable sauce

- **ensemble_lfm**: spaghetti, ground beef, corn kernels, green beans, carrots

| gold core item | ensemble_lfm | notes |
|---|---|---|
| spaghetti |   |  |
| ground beef/meat tomato sauce |   |  |
| corn kernels |   |  |
| green beans |   |  |
| carrot pieces |   |  |
| **core recall (/5)** |   |  |
| **hallucinations** |   |  |

### 08 — Yogurt granola bowl with apple

- **ensemble_lfm**: yogurt, granola, apple slices

| gold core item | ensemble_lfm | notes |
|---|---|---|
| yogurt |   |  |
| granola (oats/puffed grains, nuts) |   |  |
| apple slices |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09 — Whole chicken pizza in delivery box

- **ensemble_lfm**: Pizza, Coke

| gold core item | ensemble_lfm | notes |
|---|---|---|
| pizza with chicken pieces and cheese |   |  |
| **core recall (/1)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): cola drink at table edge

### 10 — Club sandwich with side salad (cafe table)

- **ensemble_lfm**: grilled chicken breast, side salad, Pepsi Max, Sandwich, Salad, Coke

| gold core item | ensemble_lfm | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) |   |  |
| green side salad (rocket/mixed leaves) |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11 — Wiener Schnitzel with fries and side salad

- **ensemble_lfm**: Breaded chicken cutlet, French fries, Salad, grilled chicken breast, Crispy breaded fish fillet, Lemon wedge

| gold core item | ensemble_lfm | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) |   |  |
| thick-cut fries/potato wedges |   |  |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12 — Bratwurst plate with sauerkraut and mashed potatoes

- **ensemble_lfm**: Sausages, Potatoes, Cabbage, Kraut, Yellow mashed potatoes, Side salad

| gold core item | ensemble_lfm | notes |
|---|---|---|
| bratwurst sausages |   |  |
| sauerkraut |   |  |
| mashed potatoes |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13 — Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **ensemble_lfm**: Fettuccine Alfredo, Grilled Onions, Caramelized Onions, Salad

| gold core item | ensemble_lfm | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) |   |  |
| fried/caramelised onions |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14 — Beef gulasch with boiled potatoes and a side bowl of lettuce

- **ensemble_lfm**: Potatoes, Chicken, Lettuce, Sauce

| gold core item | ensemble_lfm | notes |
|---|---|---|
| beef gulasch/stew in dark gravy |   |  |
| boiled potatoes |   |  |
| green leaf lettuce (butterhead) in a separate glass bowl |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15 — Bavarian Weisswurst breakfast

- **ensemble_lfm**: Gerbüste, Mustard, Pretzel, Sausages in soup, Bread

| gold core item | ensemble_lfm | notes |
|---|---|---|
| Weisswurst sausages in hot water |   |  |
| pretzel (Brezel) |   |  |
| sweet mustard |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16 — Döner/gyros plate with fries and salad

- **ensemble_lfm**: French fries, Döner meat, Salad, Red sauce, Bread, Beverage

| gold core item | ensemble_lfm | notes |
|---|---|---|
| döner/gyros sliced meat |   |  |
| tomato sauce over the meat |   |  |
| French fries |   |  |
| side salad (lettuce, tomato, cucumber, red onion) with dressing |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17 — Currywurst with French fries

- **ensemble_lfm**: French fries, Sausage, Ketchup

| gold core item | ensemble_lfm | notes |
|---|---|---|
| currywurst (sausage) |   |  |
| curry ketchup sauce |   |  |
| curry powder |   |  |
| French fries |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

### 18 — Swabian Maultaschen with potato salad

- **ensemble_lfm**: Pasta, Pork dumplings, Green herbs (chives, parsley)

| gold core item | ensemble_lfm | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) |   |  |
| potato salad |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19 — German fast-food mixed plate (Taxiteller)

- **ensemble_lfm**: French fries, Mayo, German sausages, Pork Chops, Sausage, Yogurt sauce

| gold core item | ensemble_lfm | notes |
|---|---|---|
| French fries |   |  |
| gyros/döner sliced meat |   |  |
| sliced sausage in curry/shashlik sauce |   |  |
| tzatziki/garlic yogurt sauce |   |  |
| mayonnaise |   |  |
| **core recall (/5)** |   |  |
| **hallucinations** |   |  |

### 20 — Bowl of shio ramen

- **ensemble_lfm**: Ramen noodles, Tofu slices, Thinly sliced pork, Chopped arugula, Greens, Meat

| gold core item | ensemble_lfm | notes |
|---|---|---|
| ramen noodles |   |  |
| clear (shio) broth |   |  |
| sliced chashu pork |   |  |
| leafy green herb topping (mizuna/mitsuba) |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21 — Vietnamese pho with a side plate of herb garnishes

- **ensemble_lfm**: Pho, meat, vegetables

| gold core item | ensemble_lfm | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) |   |  |
| sliced beef and beef meatballs |   |  |
| bean sprouts |   |  |
| Thai basil |   |  |
| sliced green chilli/jalapeño |   |  |
| spring onion |   |  |
| **core recall (/6)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22 — Three soft tacos with a corn cob

- **ensemble_lfm**: corn on the cob, tacos, beans, sauce, tortilla shells

| gold core item | ensemble_lfm | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef |   |  |
| grated cheese |   |  |
| red salsa |   |  |
| green salsa/tomatillo |   |  |
| coriander/cilantro |   |  |
| grilled corn on the cob |   |  |
| **core recall (/6)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): glass of cola

### 23 — Smothered beef burrito

- **ensemble_lfm**: burrito, Shredded Cheese, Tomato, Lettuce

| gold core item | ensemble_lfm | notes |
|---|---|---|
| burrito (flour tortilla) |   |  |
| green chile sauce |   |  |
| shredded cheddar/jack cheese |   |  |
| shredded lettuce |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): diced tomato

### 24 — Fish and chips with peas

- **ensemble_lfm**: grilled chicken breast, side salad, lemon wedge, french fries, peas, potatoes

| gold core item | ensemble_lfm | notes |
|---|---|---|
| battered fried fish fillet |   |  |
| chips/thick-cut fries |   |  |
| green peas |   |  |
| tartar sauce |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): lemon wedge

### 25 — American breakfast platter

- **ensemble_lfm**: pancakes, scrambled eggs, bacon, sausage, fried egg, toast

| gold core item | ensemble_lfm | notes |
|---|---|---|
| pancakes with icing sugar |   |  |
| back bacon rashers |   |  |
| fried egg (sunny side up) |   |  |
| breakfast sausages |   |  |
| hash brown/potato croquettes |   |  |
| toast slices |   |  |
| maple syrup in a shot glass |   |  |
| **core recall (/7)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): butter packet

### 26 — Indian thali on a steel tray

- **ensemble_lfm**: Rice, Lentils, Paneer, Tortilla, Couscous, Vegetable Curry

| gold core item | ensemble_lfm | notes |
|---|---|---|
| rice pilaf/vegetable fried rice |   |  |
| chapati/roti |   |  |
| papad (papadum) |   |  |
| curd/raita |   |  |
| dal (lentil curry) |   |  |
| kofta/dumpling curry in orange gravy |   |  |
| paneer or fish curry in pale gravy |   |  |
| brinjal/eggplant curry |   |  |
| **core recall (/8)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27 — Stir-fried chicken with peppers and steamed rice

- **ensemble_lfm**: grilled chicken breast, onions, red bell peppers, rice, chicken, bell pepper

| gold core item | ensemble_lfm | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce |   |  |
| red bell pepper strips |   |  |
| onion |   |  |
| spring onion/green onion |   |  |
| steamed white rice |   |  |
| **core recall (/5)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): dried chilli bits

### 28 — Middle-Eastern mezze spread — four composed plates plus flatbread

- **ensemble_lfm**: Grilled chicken breast, Side salad, Pita bread, Crackers, Olives, Yogurt

| gold core item | ensemble_lfm | notes |
|---|---|---|
| falafel balls |   |  |
| grilled flatbread |   |  |
| hummus/creamy white dip |   |  |
| green herb-chilli sauce |   |  |
| yellow bulgur or couscous |   |  |
| black beluga lentils |   |  |
| pickled white cabbage slaw |   |  |
| green olives |   |  |
| **core recall (/8)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29 — Tapas/snack flight with a wheat beer

- **ensemble_lfm**: Pickles, Sliced Salami, Cheese Cubes, Olives

| gold core item | ensemble_lfm | notes |
|---|---|---|
| pickled gherkin slices |   |  |
| salami slices |   |  |
| cheese cubes |   |  |
| green olives |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30 — Mixed grill board (plancha de grillades)

- **ensemble_lfm**: baked potato, grilled chicken breast, grilled pork chop, steak, salad

| gold core item | ensemble_lfm | notes |
|---|---|---|
| pork spare ribs slab |   |  |
| grilled beef steak |   |  |
| grilled sausage |   |  |
| grilled meat skewer with green pepper and tomato |   |  |
| baked/roasted potato with browned cheese topping |   |  |
| mixed leaf salad |   |  |
| **core recall (/6)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): cherry tomato, steak knife

### 31 — Bowl of beef/oxtail soup with buttered bread

- **ensemble_lfm**: Beef stew, grilled beef stew, white bread toast, Butter, Toast, Parsley

| gold core item | ensemble_lfm | notes |
|---|---|---|
| thick brown meat soup/stew broth |   |  |
| beef (oxtail) chunks |   |  |
| buttered bread slices (dark/whole-grain) |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32 — Charcuterie/snack board (compartmented bamboo tray, top-down)

- **ensemble_lfm**: grilled chicken breast, side salad, carrot sticks, yellow bell pepper strips, red bell pepper strips, cucumber slices

| gold core item | ensemble_lfm | notes |
|---|---|---|
| green olives |   |  |
| cucumber sticks |   |  |
| carrot sticks |   |  |
| bell pepper strips |   |  |
| pan-fried spiced hard-boiled egg halves |   |  |
| hummus dip |   |  |
| salami/cured meat slices |   |  |
| cheese slices |   |  |
| **core recall (/8)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33 — Bowl of oatmeal porridge with toppings

- **ensemble_lfm**: oatmeal, milk, cinnamon, raisins

| gold core item | ensemble_lfm | notes |
|---|---|---|
| oatmeal/oat porridge |   |  |
| peanut butter |   |  |
| raisins |   |  |
| ground cinnamon |   |  |
| milk |   |  |
| **core recall (/5)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34 — Waffles with strawberries and whipped cream

- **ensemble_lfm**: waffles, strawberries, whipped cream

| gold core item | ensemble_lfm | notes |
|---|---|---|
| waffles |   |  |
| strawberries (sliced fresh) |   |  |
| strawberry/berry syrup-compote |   |  |
| whipped cream |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): orange juice glass at top edge

### 35 — Gyros/döner plate with fries and salad

- **ensemble_lfm**: Grilled Chicken Breast, Side Salad, Fries, Tomato, Lettuce, Corn

| gold core item | ensemble_lfm | notes |
|---|---|---|
| gyros/döner sliced meat |   |  |
| French fries |   |  |
| white garlic-yogurt sauce (tzatziki) with oregano |   |  |
| shredded white cabbage |   |  |
| tomato slices |   |  |
| sweetcorn |   |  |
| cucumber slices |   |  |
| shredded carrot |   |  |
| **core recall (/8)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36 — Seafood paella in the pan

- **ensemble_lfm**: grilled chicken breast, rice, shrimp, artichoke, lemon wedge, dusting of herbs

| gold core item | ensemble_lfm | notes |
|---|---|---|
| saffron/paella rice |   |  |
| whole prawns (langostinos) |   |  |
| mantis shrimp (galeras) |   |  |
| artichoke pieces |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37 — Pierogi ruskie with carrot-cabbage salad

- **ensemble_lfm**: dumplings, grilled chicken breast, side salad, purple sprouts

| gold core item | ensemble_lfm | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) |   |  |
| fried caramelised onion topping |   |  |
| grated carrot and cabbage salad |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38 — Half-eaten beefburger with fries

- **ensemble_lfm**: burger, fries

| gold core item | ensemble_lfm | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) |   |  |
| French fries |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39 — Remains of a fried breakfast (mostly eaten)

- **ensemble_lfm**: baked beans, bacon, ham

| gold core item | ensemble_lfm | notes |
|---|---|---|
| baked beans in tomato sauce |   |  |
| sausage pieces |   |  |
| bacon rasher |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40 — Half-eaten liver-and-bacon fry-up with chips

- **ensemble_lfm**: beef stew, grilled ham, fried potatoes, egg

| gold core item | ensemble_lfm | notes |
|---|---|---|
| liver pieces in gravy |   |  |
| chips/French fries |   |  |
| bacon/gammon slice |   |  |
| fried egg (remnant, yolk visible) |   |  |
| sausage |   |  |
| grilled tomato half |   |  |
| **core recall (/6)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41 — Leftovers of battered fish and potato wedges

- **ensemble_lfm**: Grilled chicken breast, Roasted potatoes, Ham hock, Black pepper, Mayonnaise, Fried fish

| gold core item | ensemble_lfm | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten |   |  |
| potato wedges/skin-on roast potatoes |   |  |
| tartar sauce / mayonnaise dollop |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42 — Buffet lunch plate (many components)

- **ensemble_lfm**: baked fish, rice, cabbage slaw, corn, chicken curry, potatoes

| gold core item | ensemble_lfm | notes |
|---|---|---|
| breaded fried fish fillet |   |  |
| sour cream / remoulade dollop |   |  |
| meatballs in brown gravy |   |  |
| chickpea-and-cauliflower curry |   |  |
| white rice |   |  |
| red cabbage and sweetcorn salad |   |  |
| cucumber and lettuce salad |   |  |
| **core recall (/7)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43 — Buffet lunch set — main plate, soup bowl, bread plate

- **ensemble_lfm**: Crispy fried chicken, Creamy grits, Bacon bits, Pork Chops, Sausage, Buttermilk Biscuit

| gold core item | ensemble_lfm | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli |   |  |
| herbed green rice |   |  |
| green beans |   |  |
| cheese-topped quiche/gratin square |   |  |
| creamy meat-and-vegetable stew |   |  |
| creamy soup (bowl, with bacon bits) |   |  |
| bread roll with butter |   |  |
| **core recall (/7)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44 — Brazilian buffet lunch plate (top-down)

- **ensemble_lfm**: grilled chicken breast, mixed leaves, tomato, cucumber, rice, bean salad, sauce or dressing

| gold core item | ensemble_lfm | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) |   |  |
| brown beans (feijão) in broth |   |  |
| yellow seasoned rice |   |  |
| braised cabbage with tomato |   |  |
| stewed meat in onion gravy |   |  |
| mashed cassava/potato purée |   |  |
| **core recall (/6)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): cutlery and placemat (non-food)

### 45 — Korean hanjeongsik table spread (dozens of banchan, top-down)

- **ensemble_lfm**: grilled chicken breast, tofu, beef, eggplant, cucumber, rice

| gold core item | ensemble_lfm | notes |
|---|---|---|
| japchae (glass noodles with vegetables) |   |  |
| steamed egg (gyeranjjim) in stone pot |   |  |
| grilled mackerel/fish |   |  |
| stir-fried beef in a hot stone pot |   |  |
| glazed spicy braised ribs/pork |   |  |
| sliced raw fish (hoe/sashimi) on shredded radish |   |  |
| vegetable fritters/jeon platter |   |  |
| kimchi |   |  |
| **core recall (/8)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46 — Hong Kong steamer basket of small offal dishes (dai pai dong)

- **ensemble_lfm**: grilled chicken breast, fried tofu, pork belly, beef, chicken

| gold core item | ensemble_lfm | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce |   |  |
| white boiled tripe/omasum slices in broth |   |  |
| fried beancurd-skin rolls (tofu skin rolls) |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47 — Café brunch table spread (top-down)

- **ensemble_lfm**: Avocado toast, Bagel with cream cheese, Eggs Benedict, Grilled chicken breast, Fruit salad, Smoothie

| gold core item | ensemble_lfm | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs |   |  |
| eggs benedict with hollandaise on avocado toast |   |  |
| yogurt bowl with granola, kiwi slices and berry compote |   |  |
| cherry tomato salad with balsamic drizzle |   |  |
| seeded bagel (dark, sesame-topped) |   |  |
| **core recall (/5)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48 — Disposable plate of party snacks (partly eaten)

- **ensemble_lfm**: Crispy potato chips, Sandwich (white bread), Steamed egg, Steamed shrimp

| gold core item | ensemble_lfm | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) |   |  |
| potato chips/crisps |   |  |
| samosas (small fried triangles) |   |  |
| slice of white/vanilla cake with icing — partly eaten |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49 — Cafe sizzling-plate dinner set

- **ensemble_lfm**: spaghetti, steak, pork sausage, tomato, bread, soup

| gold core item | ensemble_lfm | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce |   |  |
| spaghetti (plain, buttered) |   |  |
| sausage/frankfurter |   |  |
| cherry tomatoes |   |  |
| red cabbage soup (borscht-style, bowl) |   |  |
| bread bun |   |  |
| **core recall (/6)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50 — Late-night döner kebab plate with fries and salad

- **ensemble_lfm**: grilled chicken breast, French fries, grilled beef, cucumber, onion, Grilled lamb or beef

| gold core item | ensemble_lfm | notes |
|---|---|---|
| döner kebab sliced meat |   |  |
| tomato/chili sauce over the meat |   |  |
| French fries |   |  |
| iceberg lettuce salad |   |  |
| sliced red onion |   |  |
| cucumber slices |   |  |
| pickled gherkin and pepperoncini |   |  |
| **core recall (/7)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals (fill after scoring)

| metric | ensemble_lfm |
|---|---|
| core-item recall (/235) |   |
| hallucinations |   |
| distinct items named (auto) | 166 |
| cost / plate (auto) | $0.00000 |
| latency median s (auto) | 143.23 |

## Findings

1. 
