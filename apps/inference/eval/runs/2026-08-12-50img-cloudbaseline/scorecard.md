# Plate-identification scoring worksheet

- results: `runs/2026-08-12-50img-cloudbaseline/results.json`
- config: `openrouter-pilot` (started 2026-08-12T07:45:57.163628+00:00)
- approaches: baseline
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM

## Mechanical metrics (auto-computed)

| metric | baseline |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 158 |
| items named (mean/plate) | 3.16 |
| distinct item names | 136 |
| latency mean (s) | 3.32 |
| latency median (s) | 2.88 |
| latency max (s) | 9.03 |
| cost / plate (USD) | 0.001078 |
| cost total (USD) | 0.053896 |

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

- **baseline**: whole grain bread, mini sausages, scrambled eggs, baked beans, back bacon, cucumber slices

| gold core item | baseline | notes |
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

- **baseline**: roast beef with gravy, roasted potatoes, yorkshire pudding, steamed broccoli and cabbage

| gold core item | baseline | notes |
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

- **baseline**: grilled salmon, Greek salad with avocado and feta, Kalamata olives

| gold core item | baseline | notes |
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

- **baseline**: cheeseburger, french fries, ketchup, pickles

| gold core item | baseline | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) |   |  |
| thick-cut fries/steak fries |   |  |
| ketchup |   |  |
| pickles/gherkins |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05 — Chicken in creamy leafy-green sauce with white rice

- **baseline**: chicken and greens curry, steamed white rice

| gold core item | baseline | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) |   |  |
| white rice |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): red bell pepper bits in rice

### 06 — Sushi platter (restaurant table)

- **baseline**: sushi platter

| gold core item | baseline | notes |
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

- **baseline**: spaghetti with meat sauce and mixed vegetables

| gold core item | baseline | notes |
|---|---|---|
| spaghetti |   |  |
| ground beef/meat tomato sauce |   |  |
| corn kernels |   |  |
| green beans |   |  |
| carrot pieces |   |  |
| **core recall (/5)** |   |  |
| **hallucinations** |   |  |

### 08 — Yogurt granola bowl with apple

- **baseline**: greek yogurt, granola, sliced apple

| gold core item | baseline | notes |
|---|---|---|
| yogurt |   |  |
| granola (oats/puffed grains, nuts) |   |  |
| apple slices |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09 — Whole chicken pizza in delivery box

- **baseline**: chicken pizza

| gold core item | baseline | notes |
|---|---|---|
| pizza with chicken pieces and cheese |   |  |
| **core recall (/1)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): cola drink at table edge

### 10 — Club sandwich with side salad (cafe table)

- **baseline**: chicken sandwich, side salad, Pepsi Max

| gold core item | baseline | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) |   |  |
| green side salad (rocket/mixed leaves) |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11 — Wiener Schnitzel with fries and side salad

- **baseline**: breaded schnitzel with capers, thick-cut chips, side salad with dressing, ketchup

| gold core item | baseline | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) |   |  |
| thick-cut fries/potato wedges |   |  |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12 — Bratwurst plate with sauerkraut and mashed potatoes

- **baseline**: bratwurst sausages, mashed potatoes, sauerkraut

| gold core item | baseline | notes |
|---|---|---|
| bratwurst sausages |   |  |
| sauerkraut |   |  |
| mashed potatoes |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13 — Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **baseline**: käsespätzle with caramelized onions, side salad with creamy dressing

| gold core item | baseline | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) |   |  |
| fried/caramelised onions |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14 — Beef gulasch with boiled potatoes and a side bowl of lettuce

- **baseline**: beef stew with potatoes and mushrooms, lettuce side salad

| gold core item | baseline | notes |
|---|---|---|
| beef gulasch/stew in dark gravy |   |  |
| boiled potatoes |   |  |
| green leaf lettuce (butterhead) in a separate glass bowl |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15 — Bavarian Weisswurst breakfast

- **baseline**: Weisswurst, Soft pretzel, Sweet mustard, Beer

| gold core item | baseline | notes |
|---|---|---|
| Weisswurst sausages in hot water |   |  |
| pretzel (Brezel) |   |  |
| sweet mustard |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16 — Döner/gyros plate with fries and salad

- **baseline**: doner kebab meat with tomato sauce, french fries, side salad with dressing, beer

| gold core item | baseline | notes |
|---|---|---|
| döner/gyros sliced meat |   |  |
| tomato sauce over the meat |   |  |
| French fries |   |  |
| side salad (lettuce, tomato, cucumber, red onion) with dressing |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17 — Currywurst with French fries

- **baseline**: currywurst, french fries

| gold core item | baseline | notes |
|---|---|---|
| currywurst (sausage) |   |  |
| curry ketchup sauce |   |  |
| curry powder |   |  |
| French fries |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

### 18 — Swabian Maultaschen with potato salad

- **baseline**: meat-filled dumplings, potato salad with bacon

| gold core item | baseline | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) |   |  |
| potato salad |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19 — German fast-food mixed plate (Taxiteller)

- **baseline**: gyros meat, currywurst, french fries with mayonnaise, tzatziki

| gold core item | baseline | notes |
|---|---|---|
| French fries |   |  |
| gyros/döner sliced meat |   |  |
| sliced sausage in curry/shashlik sauce |   |  |
| tzatziki/garlic yogurt sauce |   |  |
| mayonnaise |   |  |
| **core recall (/5)** |   |  |
| **hallucinations** |   |  |

### 20 — Bowl of shio ramen

- **baseline**: shio ramen

| gold core item | baseline | notes |
|---|---|---|
| ramen noodles |   |  |
| clear (shio) broth |   |  |
| sliced chashu pork |   |  |
| leafy green herb topping (mizuna/mitsuba) |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21 — Vietnamese pho with a side plate of herb garnishes

- **baseline**: beef pho, fresh bean sprouts and thai basil, extra rice noodles

| gold core item | baseline | notes |
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

- **baseline**: ground beef tacos with cheese and salsa, corn on the cob, soda

| gold core item | baseline | notes |
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

- **baseline**: wet burrito

| gold core item | baseline | notes |
|---|---|---|
| burrito (flour tortilla) |   |  |
| green chile sauce |   |  |
| shredded cheddar/jack cheese |   |  |
| shredded lettuce |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): diced tomato

### 24 — Fish and chips with peas

- **baseline**: battered fish, french fries, green peas, tartar sauce

| gold core item | baseline | notes |
|---|---|---|
| battered fried fish fillet |   |  |
| chips/thick-cut fries |   |  |
| green peas |   |  |
| tartar sauce |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): lemon wedge

### 25 — American breakfast platter

- **baseline**: pancakes with powdered sugar, bacon rashers, fried egg, pork sausages, hash browns, toast with butter

| gold core item | baseline | notes |
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

- **baseline**: vegetable fried rice, flatbread and papadum, various Indian curries, plain yogurt (raita), vegetable soup

| gold core item | baseline | notes |
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

- **baseline**: chicken cashew stir-fry, steamed jasmine rice

| gold core item | baseline | notes |
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

- **baseline**: mezze platter bowl, pita bread

| gold core item | baseline | notes |
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

- **baseline**: Weizenbier, Salami slices, Cubed cheese, Green olives, Pickled gherkins

| gold core item | baseline | notes |
|---|---|---|
| pickled gherkin slices |   |  |
| salami slices |   |  |
| cheese cubes |   |  |
| green olives |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30 — Mixed grill board (plancha de grillades)

- **baseline**: mixed grill platter (ribs, steak, skewers, sausage), stuffed baked potato, side salad

| gold core item | baseline | notes |
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

- **baseline**: beef goulash soup, bread with butter

| gold core item | baseline | notes |
|---|---|---|
| thick brown meat soup/stew broth |   |  |
| beef (oxtail) chunks |   |  |
| buttered bread slices (dark/whole-grain) |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32 — Charcuterie/snack board (compartmented bamboo tray, top-down)

- **baseline**: deviled eggs, hummus, assorted sliced cheese, salami slices, crackers, vegetables and olives

| gold core item | baseline | notes |
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

- **baseline**: oatmeal with toppings

| gold core item | baseline | notes |
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

- **baseline**: waffle with strawberry sauce and fresh strawberries, whipped cream

| gold core item | baseline | notes |
|---|---|---|
| waffles |   |  |
| strawberries (sliced fresh) |   |  |
| strawberry/berry syrup-compote |   |  |
| whipped cream |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): orange juice glass at top edge

### 35 — Gyros/döner plate with fries and salad

- **baseline**: doner kebab meat, french fries, tzatziki sauce, side salad

| gold core item | baseline | notes |
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

- **baseline**: seafood paella with artichokes

| gold core item | baseline | notes |
|---|---|---|
| saffron/paella rice |   |  |
| whole prawns (langostinos) |   |  |
| mantis shrimp (galeras) |   |  |
| artichoke pieces |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37 — Pierogi ruskie with carrot-cabbage salad

- **baseline**: pierogi with sauteed onions, coleslaw

| gold core item | baseline | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) |   |  |
| fried caramelised onion topping |   |  |
| grated carrot and cabbage salad |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38 — Half-eaten beefburger with fries

- **baseline**: cheeseburger, french fries

| gold core item | baseline | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) |   |  |
| French fries |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39 — Remains of a fried breakfast (mostly eaten)

- **baseline**: baked beans, pork sausages, back bacon

| gold core item | baseline | notes |
|---|---|---|
| baked beans in tomato sauce |   |  |
| sausage pieces |   |  |
| bacon rasher |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40 — Half-eaten liver-and-bacon fry-up with chips

- **baseline**: Mixed meats in gravy, French fries, Grilled bacon and egg

| gold core item | baseline | notes |
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

- **baseline**: battered fish, potato wedges, mayonnaise

| gold core item | baseline | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten |   |  |
| potato wedges/skin-on roast potatoes |   |  |
| tartar sauce / mayonnaise dollop |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42 — Buffet lunch plate (many components)

- **baseline**: breaded fish fillet with sauce, lentil dal with rice, meatballs in gravy, mixed vegetable salad

| gold core item | baseline | notes |
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

- **baseline**: cheesy grits with bacon, bread with butter, fried crab cakes with sauce, green beans and rice, savory vegetable quiche slice, scrambled egg with ham

| gold core item | baseline | notes |
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

- **baseline**: mixed green salad with carrots, stewed brown beans, yellow rice, mashed potatoes with cooked cabbage, braised pork or beef stew

| gold core item | baseline | notes |
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

- **baseline**: bulgogi, grilled mackerel, tofu with kimchi, steamed egg, mixed banchan

| gold core item | baseline | notes |
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

- **baseline**: steamed bean curd skin rolls, steamed beef tripe

| gold core item | baseline | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce |   |  |
| white boiled tripe/omasum slices in broth |   |  |
| fried beancurd-skin rolls (tofu skin rolls) |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47 — Café brunch table spread (top-down)

- **baseline**: avocado toast with poached eggs and tomatoes, fruit yogurt bowl with kiwi and granola, sesame bagel with tomato salad, iced latte, beetroot latte, tropical passionfruit juice

| gold core item | baseline | notes |
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

- **baseline**: potato chips, vanilla cake with frosting, triangle sandwich, samosas

| gold core item | baseline | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) |   |  |
| potato chips/crisps |   |  |
| samosas (small fried triangles) |   |  |
| slice of white/vanilla cake with icing — partly eaten |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49 — Cafe sizzling-plate dinner set

- **baseline**: pork chop with sauce and spaghetti, sausage, vegetable soup, dinner roll

| gold core item | baseline | notes |
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

- **baseline**: kebab meat with tomato sauce, french fries, side salad

| gold core item | baseline | notes |
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

| metric | baseline |
|---|---|
| core-item recall (/235) |   |
| hallucinations |   |
| distinct items named (auto) | 136 |
| cost / plate (auto) | $0.00108 |
| latency median s (auto) | 2.88 |

## Findings

1. 
