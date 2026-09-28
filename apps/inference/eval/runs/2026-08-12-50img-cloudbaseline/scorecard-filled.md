# Plate-identification scoring worksheet — FILLED

- results: `runs/2026-08-12-50img-cloudbaseline/results.json`
- config: `openrouter-pilot` (started 2026-08-12T07:45:57.163628+00:00)
- approaches: baseline
- images: 50
- scored: 2026-08-12 (reviewing agent; images read for 06, 07, 27, 32, 42, 43, 46, 47)

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

## Scoring conventions applied

Two classes of multi-item label were treated differently, consistently across all 50 plates:

- **Named-dish consolidation** (`Greek salad`, `mixed vegetables`, `currywurst`, `shio ramen`,
  `wet burrito`, `beef goulash soup`) — the name has a determinate composition, so it earns
  credit for the components it entails, with the granularity loss noted.
- **Generic bag label** (`side salad`, `vegetables`, `various Indian curries`, `mezze platter`,
  `mixed banchan`) — names a category but identifies nothing, so no credit for the specific
  gold rows underneath it. These cells are marked `n?` and flagged for adjudication.

`Y?` / `n?` = judgment call flagged for the architect. In the tally, `Y?` counts as a hit and
`n?` as a miss.

### 01 — Continental/English-style breakfast plate

- **baseline**: whole grain bread, mini sausages, scrambled eggs, baked beans, back bacon, cucumber slices

| gold core item | baseline | notes |
|---|---|---|
| scrambled eggs | Y |  |
| bacon/ham slices | Y | "back bacon" |
| frankfurter sausages | Y | "mini sausages" |
| baked beans in tomato sauce | Y |  |
| brown bread slice | Y | "whole grain bread" |
| cucumber slices | Y |  |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |

Recall: 6/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): butter/margarine packets

### 02 — Roast (Sunday) dinner

- **baseline**: roast beef with gravy, roasted potatoes, yorkshire pudding, steamed broccoli and cabbage

| gold core item | baseline | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y |  |
| Yorkshire pudding | Y |  |
| roast potatoes | Y |  |
| broccoli | Y | "steamed broccoli and cabbage" |
| cabbage/greens | Y | same item covers both rows |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |

Recall: 5/5
Hallucinations: none
Trap leaks: none

Optional (no recall credit): gravy as separate item

### 03 — Greek-style salad with grilled salmon

- **baseline**: grilled salmon, Greek salad with avocado and feta, Kalamata olives

| gold core item | baseline | notes |
|---|---|---|
| grilled salmon fillets | Y |  |
| feta cheese | Y | named explicitly |
| kalamata olives | Y | named explicitly |
| avocado | Y | named explicitly |
| cherry tomatoes | Y | "Greek salad" consolidation — protocol-sanctioned; granularity loss |
| cucumber | Y | via "Greek salad" |
| lettuce/romaine | Y | via "Greek salad" |
| red onion | Y | via "Greek salad" (canonical component of the named dish) |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |

Recall: 8/8
Hallucinations: none
Trap leaks: none

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04 — Cheeseburger with fries

- **baseline**: cheeseburger, french fries, ketchup, pickles

| gold core item | baseline | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y |  |
| thick-cut fries/steak fries | Y | cut style not distinguished |
| ketchup | Y |  |
| pickles/gherkins | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): lettuce in burger, beer in background

### 05 — Chicken in creamy leafy-green sauce with white rice

- **baseline**: chicken and greens curry, steamed white rice

| gold core item | baseline | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | "chicken and greens curry" |
| white rice | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none
Trap leaks: none

Optional (no recall credit): red bell pepper bits in rice

### 06 — Sushi platter (restaurant table)

- **baseline**: sushi platter

| gold core item | baseline | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | single whole-plate label; rolls entailed, all detail lost (no salmon, avocado or sesame named) |
| tuna nigiri | n? | image confirms 1 tuna nigiri; "sushi platter" arguably subsumes nigiri but identifies nothing |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | n? | image confirms 2 white-fish nigiri; same reasoning |
| pickled ginger | n | visible on the plate, not reported |
| wasabi | n | visible, not reported |
| soy sauce | n | visible in dish, not reported |
| **core recall (/6)** | 1/6 |  |
| **hallucinations** | none |  |

Recall: 1/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): white wine / water glasses in background

### 07 — Spaghetti with meat-vegetable sauce

- **baseline**: spaghetti with meat sauce and mixed vegetables

| gold core item | baseline | notes |
|---|---|---|
| spaghetti | Y |  |
| ground beef/meat tomato sauce | Y |  |
| corn kernels | Y | image confirms the canonical corn/green-bean/carrot mix; "mixed vegetables" is a determinate named mix — granularity loss |
| green beans | Y | via "mixed vegetables" |
| carrot pieces | Y | via "mixed vegetables" |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |

Recall: 5/5
Hallucinations: none
Trap leaks: none

### 08 — Yogurt granola bowl with apple

- **baseline**: greek yogurt, granola, sliced apple

| gold core item | baseline | notes |
|---|---|---|
| yogurt | Y |  |
| granola (oats/puffed grains, nuts) | Y |  |
| apple slices | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09 — Whole chicken pizza in delivery box

- **baseline**: chicken pizza

| gold core item | baseline | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y |  |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none |  |

Recall: 1/1
Hallucinations: none
Trap leaks: none

Optional (no recall credit): cola drink at table edge

### 10 — Club sandwich with side salad (cafe table)

- **baseline**: chicken sandwich, side salad, Pepsi Max

| gold core item | baseline | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | "chicken sandwich" — filling type right, layering/toasting not noted |
| green side salad (rocket/mixed leaves) | Y | gold is a single generic salad row, so "side salad" matches it directly |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none
Trap leaks: none — nothing from the background menu poster (burrito/quesadilla/fritter) reported

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11 — Wiener Schnitzel with fries and side salad

- **baseline**: breaded schnitzel with capers, thick-cut chips, side salad with dressing, ketchup

| gold core item | baseline | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | Y |  |
| thick-cut fries/potato wedges | Y |  |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | gold row is itself the consolidation; dressing named |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none (capers and ketchup are gold optionals — visible)
Trap leaks: none

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12 — Bratwurst plate with sauerkraut and mashed potatoes

- **baseline**: bratwurst sausages, mashed potatoes, sauerkraut

| gold core item | baseline | notes |
|---|---|---|
| bratwurst sausages | Y |  |
| sauerkraut | Y |  |
| mashed potatoes | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none — nothing from the second background plate (carrot/cabbage salad, cucumber, filled roll) reported

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13 — Käsespätzle in a cast-iron pan with a side salad

- **baseline**: käsespätzle with caramelized onions, side salad with creamy dressing

| gold core item | baseline | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y |  |
| fried/caramelised onions | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none — the reported side salad is the gold optional background plate; no invented meat/bacon in the spätzle
Trap leaks: none

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion, parsley garnish

### 14 — Beef gulasch with boiled potatoes and a side bowl of lettuce

- **baseline**: beef stew with potatoes and mushrooms, lettuce side salad

| gold core item | baseline | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y |  |
| boiled potatoes | Y |  |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "lettuce side salad"; variety and separate-bowl framing lost |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none (mushrooms are a gold optional — visible in the stew)
Trap leaks: none

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15 — Bavarian Weisswurst breakfast

- **baseline**: Weisswurst, Soft pretzel, Sweet mustard, Beer

| gold core item | baseline | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y | water/pot not mentioned |
| pretzel (Brezel) | Y |  |
| sweet mustard | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none (beer is a gold optional)
Trap leaks: none

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16 — Döner/gyros plate with fries and salad

- **baseline**: doner kebab meat with tomato sauce, french fries, side salad with dressing, beer

| gold core item | baseline | notes |
|---|---|---|
| döner/gyros sliced meat | Y |  |
| tomato sauce over the meat | Y |  |
| French fries | Y |  |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | gold row is itself the consolidation |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none (beer is a gold optional)
Trap leaks: none

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17 — Currywurst with French fries

- **baseline**: currywurst, french fries

| gold core item | baseline | notes |
|---|---|---|
| currywurst (sausage) | Y |  |
| curry ketchup sauce | Y | entailed by the named dish "currywurst"; granularity loss |
| curry powder | n | the dusted powder is a separate visible topping, not reported |
| French fries | Y |  |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |

Recall: 3/4
Hallucinations: none
Trap leaks: none

### 18 — Swabian Maultaschen with potato salad

- **baseline**: meat-filled dumplings, potato salad with bacon

| gold core item | baseline | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "meat-filled dumplings" — correct description, dish name lost |
| potato salad | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none (bacon in the potato salad is a gold optional)
Trap leaks: none

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19 — German fast-food mixed plate (Taxiteller)

- **baseline**: gyros meat, currywurst, french fries with mayonnaise, tzatziki

| gold core item | baseline | notes |
|---|---|---|
| French fries | Y |  |
| gyros/döner sliced meat | Y |  |
| sliced sausage in curry/shashlik sauce | Y | "currywurst" |
| tzatziki/garlic yogurt sauce | Y |  |
| mayonnaise | Y |  |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |

Recall: 5/5
Hallucinations: none
Trap leaks: none

### 20 — Bowl of shio ramen

- **baseline**: shio ramen

| gold core item | baseline | notes |
|---|---|---|
| ramen noodles | Y | entailed by the named dish |
| clear (shio) broth | Y | "shio" names the broth style |
| sliced chashu pork | n | prominent topping, not reported |
| leafy green herb topping (mizuna/mitsuba) | n | not reported |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |

Recall: 2/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21 — Vietnamese pho with a side plate of herb garnishes

- **baseline**: beef pho, fresh bean sprouts and thai basil, extra rice noodles

| gold core item | baseline | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y |  |
| sliced beef and beef meatballs | Y? | "beef pho" entails the sliced beef; the meatballs (half of this compound row) are never identified |
| bean sprouts | Y |  |
| Thai basil | Y |  |
| sliced green chilli/jalapeño | n | on the garnish plate, not reported |
| spring onion | n | not reported |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |

Recall: 4/6
Hallucinations: none (the extra noodle bowl is a gold optional)
Trap leaks: none

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22 — Three soft tacos with a corn cob

- **baseline**: ground beef tacos with cheese and salsa, corn on the cob, soda

| gold core item | baseline | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y |  |
| grated cheese | Y |  |
| red salsa | Y | one singular "salsa" mention — credited to the red one |
| green salsa/tomatillo | n | a single "salsa" cannot cover two distinct gold salsa rows |
| coriander/cilantro | n | not reported |
| grilled corn on the cob | Y | grilling not noted |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |

Recall: 4/6
Hallucinations: none (the cola is a gold optional)
Trap leaks: none

Optional (no recall credit): glass of cola

### 23 — Smothered beef burrito

- **baseline**: wet burrito

| gold core item | baseline | notes |
|---|---|---|
| burrito (flour tortilla) | Y |  |
| green chile sauce | Y? | "wet" entails a smothering sauce but never identifies it as green chile |
| shredded cheddar/jack cheese | n | melted on top, not reported |
| shredded lettuce | n | not reported |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |

Recall: 2/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): diced tomato

### 24 — Fish and chips with peas

- **baseline**: battered fish, french fries, green peas, tartar sauce

| gold core item | baseline | notes |
|---|---|---|
| battered fried fish fillet | Y |  |
| chips/thick-cut fries | Y |  |
| green peas | Y |  |
| tartar sauce | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): lemon wedge

### 25 — American breakfast platter

- **baseline**: pancakes with powdered sugar, bacon rashers, fried egg, pork sausages, hash browns, toast with butter

| gold core item | baseline | notes |
|---|---|---|
| pancakes with icing sugar | Y |  |
| back bacon rashers | Y |  |
| fried egg (sunny side up) | Y |  |
| breakfast sausages | Y | "pork sausages" |
| hash brown/potato croquettes | Y |  |
| toast slices | Y |  |
| maple syrup in a shot glass | n | not reported |
| **core recall (/7)** | 6/7 |  |
| **hallucinations** | none |  |

Recall: 6/7
Hallucinations: none
Trap leaks: none — nothing from the separate top-of-frame plate (toasted sandwich + salad) reported

Optional (no recall credit): butter packet

### 26 — Indian thali on a steel tray

- **baseline**: vegetable fried rice, flatbread and papadum, various Indian curries, plain yogurt (raita), vegetable soup

| gold core item | baseline | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y |  |
| chapati/roti | Y | "flatbread" |
| papad (papadum) | Y |  |
| curd/raita | Y |  |
| dal (lentil curry) | n | "various Indian curries" is a generic bag label — identifies none of the four distinct curries |
| kofta/dumpling curry in orange gravy | n | as above |
| paneer or fish curry in pale gravy | n | as above |
| brinjal/eggplant curry | n | as above |
| **core recall (/8)** | 4/8 |  |
| **hallucinations** | none |  |

Recall: 4/8
Hallucinations: none (the "vegetable soup" is the gold optional clear stew bowl)
Trap leaks: none

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27 — Stir-fried chicken with peppers and steamed rice

- **baseline**: chicken cashew stir-fry, steamed jasmine rice

| gold core item | baseline | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y |  |
| red bell pepper strips | n | prominent in the image, not reported |
| onion | n | large onion wedges visible, not reported |
| spring onion/green onion | n | visible, not reported |
| steamed white rice | Y |  |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |

Recall: 2/5
Hallucinations: none — cashews were checked against the image and are genuinely present (not in gold, so ignored)
Trap leaks: none

Optional (no recall credit): dried chilli bits

### 28 — Middle-Eastern mezze spread — four composed plates plus flatbread

- **baseline**: mezze platter bowl, pita bread

| gold core item | baseline | notes |
|---|---|---|
| falafel balls | n | "mezze platter" is a generic bag label — identifies nothing |
| grilled flatbread | Y | "pita bread"; grilling not noted |
| hummus/creamy white dip | n | not identified |
| green herb-chilli sauce | n | not identified |
| yellow bulgur or couscous | n | not identified |
| black beluga lentils | n | not identified |
| pickled white cabbage slaw | n | not identified |
| green olives | n | not identified |
| **core recall (/8)** | 1/8 |  |
| **hallucinations** | none |  |

Recall: 1/8
Hallucinations: none
Trap leaks: none

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29 — Tapas/snack flight with a wheat beer

- **baseline**: Weizenbier, Salami slices, Cubed cheese, Green olives, Pickled gherkins

| gold core item | baseline | notes |
|---|---|---|
| pickled gherkin slices | Y |  |
| salami slices | Y |  |
| cheese cubes | Y |  |
| green olives | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none (Weizenbier is a gold optional)
Trap leaks: none

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30 — Mixed grill board (plancha de grillades)

- **baseline**: mixed grill platter (ribs, steak, skewers, sausage), stuffed baked potato, side salad

| gold core item | baseline | notes |
|---|---|---|
| pork spare ribs slab | Y | enumerated inside the platter label |
| grilled beef steak | Y |  |
| grilled sausage | Y |  |
| grilled meat skewer with green pepper and tomato | Y | skewer named; pepper/tomato on it not itemised |
| baked/roasted potato with browned cheese topping | Y | "stuffed baked potato" — cheese topping read as stuffing |
| mixed leaf salad | Y |  |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |

Recall: 6/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): cherry tomato, steak knife

### 31 — Bowl of beef/oxtail soup with buttered bread

- **baseline**: beef goulash soup, bread with butter

| gold core item | baseline | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y |  |
| beef (oxtail) chunks | Y | entailed by "beef goulash soup"; oxtail cut not identified |
| buttered bread slices (dark/whole-grain) | Y | bread type not specified |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): parsley garnish, butter as separate item

### 32 — Charcuterie/snack board (compartmented bamboo tray, top-down)

- **baseline**: deviled eggs, hummus, assorted sliced cheese, salami slices, crackers, vegetables and olives

| gold core item | baseline | notes |
|---|---|---|
| green olives | Y | named explicitly |
| cucumber sticks | n? | only covered by the generic "vegetables"; image shows three clearly distinct crudité rows |
| carrot sticks | n? | as above |
| bell pepper strips | n? | as above — yellow, orange and red pepper strips fill half the tray |
| pan-fried spiced hard-boiled egg halves | Y? | reported as "deviled eggs"; image shows turmeric/spice-crusted pan-fried halves — same item, wrong preparation |
| hummus dip | Y |  |
| salami/cured meat slices | Y |  |
| cheese slices | Y |  |
| **core recall (/8)** | 5/8 |  |
| **hallucinations** | none |  |

Recall: 5/8
Hallucinations: none (crackers are a gold optional and are visible)
Trap leaks: none

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33 — Bowl of oatmeal porridge with toppings

- **baseline**: oatmeal with toppings

| gold core item | baseline | notes |
|---|---|---|
| oatmeal/oat porridge | Y |  |
| peanut butter | n | "toppings" identifies nothing |
| raisins | n | as above |
| ground cinnamon | n | as above |
| milk | n | as above |
| **core recall (/5)** | 1/5 |  |
| **hallucinations** | none |  |

Recall: 1/5
Hallucinations: none
Trap leaks: none

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34 — Waffles with strawberries and whipped cream

- **baseline**: waffle with strawberry sauce and fresh strawberries, whipped cream

| gold core item | baseline | notes |
|---|---|---|
| waffles | Y |  |
| strawberries (sliced fresh) | Y |  |
| strawberry/berry syrup-compote | Y |  |
| whipped cream | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): orange juice glass at top edge

### 35 — Gyros/döner plate with fries and salad

- **baseline**: doner kebab meat, french fries, tzatziki sauce, side salad

| gold core item | baseline | notes |
|---|---|---|
| gyros/döner sliced meat | Y |  |
| French fries | Y |  |
| white garlic-yogurt sauce (tzatziki) with oregano | Y | oregano not noted |
| shredded white cabbage | n? | only covered by generic "side salad"; gold deliberately itemises five salad components |
| tomato slices | n? | as above |
| sweetcorn | n | not entailed by any generic salad label |
| cucumber slices | n? | as above |
| shredded carrot | n | not entailed by any generic salad label |
| **core recall (/8)** | 3/8 |  |
| **hallucinations** | none |  |

Recall: 3/8
Hallucinations: none
Trap leaks: none — the off-plate flatbread basket was not reported

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36 — Seafood paella in the pan

- **baseline**: seafood paella with artichokes

| gold core item | baseline | notes |
|---|---|---|
| saffron/paella rice | Y | entailed by the named dish |
| whole prawns (langostinos) | Y | entailed by "seafood paella" — the prawns are the defining visible seafood |
| mantis shrimp (galeras) | Y | via "seafood"; species distinction lost |
| artichoke pieces | Y | named explicitly |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): red pepper/tomato bits in the rice

### 37 — Pierogi ruskie with carrot-cabbage salad

- **baseline**: pierogi with sauteed onions, coleslaw

| gold core item | baseline | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y | filling not specified |
| fried caramelised onion topping | Y |  |
| grated carrot and cabbage salad | Y | "coleslaw" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): radish/beet sprouts garnish

### 38 — Half-eaten beefburger with fries

- **baseline**: cheeseburger, french fries

| gold core item | baseline | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | garnish and bun type not itemised |
| French fries | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none
Trap leaks: none

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39 — Remains of a fried breakfast (mostly eaten)

- **baseline**: baked beans, pork sausages, back bacon

| gold core item | baseline | notes |
|---|---|---|
| baked beans in tomato sauce | Y |  |
| sausage pieces | Y |  |
| bacon rasher | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none — no eggs/toast/tomato/mushrooms invented on the smeared plate

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40 — Half-eaten liver-and-bacon fry-up with chips

- **baseline**: Mixed meats in gravy, French fries, Grilled bacon and egg

| gold core item | baseline | notes |
|---|---|---|
| liver pieces in gravy | Y? | only "mixed meats in gravy" — the item is reported but liver is never identified |
| chips/French fries | Y |  |
| bacon/gammon slice | Y |  |
| fried egg (remnant, yolk visible) | Y |  |
| sausage | n? | arguably inside "mixed meats"; a single generic meat label cannot also carry this row once liver has claimed it |
| grilled tomato half | n | not reported |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |

Recall: 4/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41 — Leftovers of battered fish and potato wedges

- **baseline**: battered fish, potato wedges, mayonnaise

| gold core item | baseline | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten | Y |  |
| potato wedges/skin-on roast potatoes | Y |  |
| tartar sauce / mayonnaise dollop | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none — no napkin text or sachet contents reported as food

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42 — Buffet lunch plate (many components)

- **baseline**: breaded fish fillet with sauce, lentil dal with rice, meatballs in gravy, mixed vegetable salad

| gold core item | baseline | notes |
|---|---|---|
| breaded fried fish fillet | Y |  |
| sour cream / remoulade dollop | Y | "with sauce" — the white dollop sits on the fish in the image; sauce type not identified |
| meatballs in brown gravy | Y |  |
| chickpea-and-cauliflower curry | Y? | reported as "lentil dal"; image clearly shows chickpeas + cauliflower — right dish, wrong legume |
| white rice | Y |  |
| red cabbage and sweetcorn salad | n? | one generic "mixed vegetable salad" cannot identify either of the two distinct salads (image shows red cabbage + corn at left, cucumber + lettuce at top) |
| cucumber and lettuce salad | n? | as above |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none |  |

Recall: 5/7
Hallucinations: none — "lentil dal" is a misidentification of a visible dish, not an invented item
Trap leaks: none

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43 — Buffet lunch set — main plate, soup bowl, bread plate

- **baseline**: cheesy grits with bacon, bread with butter, fried crab cakes with sauce, green beans and rice, savory vegetable quiche slice, scrambled egg with ham

| gold core item | baseline | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | "fried crab cakes with sauce" — filling guessed, form and topping right |
| herbed green rice | Y | reported as plain "rice"; the herb/green colouring is lost |
| green beans | Y |  |
| cheese-topped quiche/gratin square | Y |  |
| creamy meat-and-vegetable stew | Y? | mapped to "scrambled egg with ham"; the image dish is a pale chunky creamy meat-and-veg mixture in that position — same item, badly misread. If rejected, this becomes a hallucination instead |
| creamy soup (bowl, with bacon bits) | Y | reported as "cheesy grits with bacon" — same bowl, texture misread |
| bread roll with butter | Y |  |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none |  |

Recall: 7/7
Hallucinations: none (conditional on the `Y?` above)
Trap leaks: none

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44 — Brazilian buffet lunch plate (top-down)

- **baseline**: mixed green salad with carrots, stewed brown beans, yellow rice, mashed potatoes with cooked cabbage, braised pork or beef stew

| gold core item | baseline | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | coriander not named |
| brown beans (feijão) in broth | Y |  |
| yellow seasoned rice | Y |  |
| braised cabbage with tomato | Y | "cooked cabbage"; tomato not named |
| stewed meat in onion gravy | Y |  |
| mashed cassava/potato purée | Y | cassava vs potato not distinguished |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |

Recall: 6/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): cutlery and placemat (non-food)

### 45 — Korean hanjeongsik table spread (dozens of banchan, top-down)

- **baseline**: bulgogi, grilled mackerel, tofu with kimchi, steamed egg, mixed banchan

| gold core item | baseline | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | n | "mixed banchan" is a generic bag label — identifies nothing |
| steamed egg (gyeranjjim) in stone pot | Y |  |
| grilled mackerel/fish | Y |  |
| stir-fried beef in a hot stone pot | Y | "bulgogi" |
| glazed spicy braised ribs/pork | n | not identified |
| sliced raw fish (hoe/sashimi) on shredded radish | n | not identified |
| vegetable fritters/jeon platter | n | not identified |
| kimchi | Y |  |
| **core recall (/8)** | 4/8 |  |
| **hallucinations** | none |  |

Recall: 4/8
Hallucinations: none (tofu is a gold optional)
Trap leaks: none — no rice or soup claimed, no empty tableware counted as a dish

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls/glasses/spoons (non-food)

### 46 — Hong Kong steamer basket of small offal dishes (dai pai dong)

- **baseline**: steamed bean curd skin rolls, steamed beef tripe

| gold core item | baseline | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | "steamed beef tripe" credited to the dominant yellow curry-sauced honeycomb cups; sauce not named |
| white boiled tripe/omasum slices in broth | n | a single "beef tripe" mention cannot also cover this visually distinct second tripe dish (pale slices in clear broth) |
| fried beancurd-skin rolls (tofu skin rolls) | Y | reported as "steamed" rather than fried |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |

Recall: 2/3
Hallucinations: none
Trap leaks: none — no siu mai, har gow, dumplings or buns reported

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket/tongs/cloth (non-food)

### 47 — Café brunch table spread (top-down)

- **baseline**: avocado toast with poached eggs and tomatoes, fruit yogurt bowl with kiwi and granola, sesame bagel with tomato salad, iced latte, beetroot latte, tropical passionfruit juice

| gold core item | baseline | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | matches the bottom-left plate exactly |
| eggs benedict with hollandaise on avocado toast | n | the second, distinct right-hand plate (visibly hollandaise-drenched) is never reported; one avocado-toast mention already claimed by the row above |
| yogurt bowl with granola, kiwi slices and berry compote | Y | compote not named |
| cherry tomato salad with balsamic drizzle | Y | balsamic not named |
| seeded bagel (dark, sesame-topped) | Y |  |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none |  |

Recall: 4/5
Hallucinations: none — the three drinks are all gold optionals visible in frame
Trap leaks: none — nothing pulled off the printed menu cards under the plates

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48 — Disposable plate of party snacks (partly eaten)

- **baseline**: potato chips, vanilla cake with frosting, triangle sandwich, samosas

| gold core item | baseline | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | filling not identified |
| potato chips/crisps | Y |  |
| samosas (small fried triangles) | Y |  |
| slice of white/vanilla cake with icing — partly eaten | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): plastic fork and foil (non-food)

### 49 — Cafe sizzling-plate dinner set

- **baseline**: pork chop with sauce and spaghetti, sausage, vegetable soup, dinner roll

| gold core item | baseline | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y |  |
| spaghetti (plain, buttered) | Y |  |
| sausage/frankfurter | Y |  |
| cherry tomatoes | n | not reported |
| red cabbage soup (borscht-style, bowl) | Y | "vegetable soup" — the soup bowl is identified, the borscht/red-cabbage character is lost |
| bread bun | Y | "dinner roll" |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |

Recall: 5/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50 — Late-night döner kebab plate with fries and salad

- **baseline**: kebab meat with tomato sauce, french fries, side salad

| gold core item | baseline | notes |
|---|---|---|
| döner kebab sliced meat | Y |  |
| tomato/chili sauce over the meat | Y |  |
| French fries | Y |  |
| iceberg lettuce salad | n? | only covered by generic "side salad"; gold itemises four salad components |
| sliced red onion | n? | as above |
| cucumber slices | n? | as above |
| pickled gherkin and pepperoncini | n | not entailed by any generic salad label |
| **core recall (/7)** | 3/7 |  |
| **hallucinations** | none |  |

Recall: 3/7
Hallucinations: none
Trap leaks: none — nothing from the second background plate reported

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals

| metric | baseline |
|---|---|
| total gold core items | 235 |
| total hits | 179 |
| core-item recall | 76.2% (179/235) |
| hallucinations | 0 |
| trap leaks | 0 |
| flagged judgment cells (`Y?`/`n?`) | 18 (7 `Y?` counted as hits, 11 `n?` counted as misses) |
| distinct items named (auto) | 136 |
| cost / plate (auto) | $0.00108 |
| latency median s (auto) | 2.88 |

### Per-image tally

| image | hits/total | halluc | trap |
|---|---|---|---|
| 01 | 6/6 | 0 | 0 |
| 02 | 5/5 | 0 | 0 |
| 03 | 8/8 | 0 | 0 |
| 04 | 4/4 | 0 | 0 |
| 05 | 2/2 | 0 | 0 |
| 06 | 1/6 | 0 | 0 |
| 07 | 5/5 | 0 | 0 |
| 08 | 3/3 | 0 | 0 |
| 09 | 1/1 | 0 | 0 |
| 10 | 2/2 | 0 | 0 |
| 11 | 3/3 | 0 | 0 |
| 12 | 3/3 | 0 | 0 |
| 13 | 2/2 | 0 | 0 |
| 14 | 3/3 | 0 | 0 |
| 15 | 3/3 | 0 | 0 |
| 16 | 4/4 | 0 | 0 |
| 17 | 3/4 | 0 | 0 |
| 18 | 2/2 | 0 | 0 |
| 19 | 5/5 | 0 | 0 |
| 20 | 2/4 | 0 | 0 |
| 21 | 4/6 | 0 | 0 |
| 22 | 4/6 | 0 | 0 |
| 23 | 2/4 | 0 | 0 |
| 24 | 4/4 | 0 | 0 |
| 25 | 6/7 | 0 | 0 |
| 26 | 4/8 | 0 | 0 |
| 27 | 2/5 | 0 | 0 |
| 28 | 1/8 | 0 | 0 |
| 29 | 4/4 | 0 | 0 |
| 30 | 6/6 | 0 | 0 |
| 31 | 3/3 | 0 | 0 |
| 32 | 5/8 | 0 | 0 |
| 33 | 1/5 | 0 | 0 |
| 34 | 4/4 | 0 | 0 |
| 35 | 3/8 | 0 | 0 |
| 36 | 4/4 | 0 | 0 |
| 37 | 3/3 | 0 | 0 |
| 38 | 2/2 | 0 | 0 |
| 39 | 3/3 | 0 | 0 |
| 40 | 4/6 | 0 | 0 |
| 41 | 3/3 | 0 | 0 |
| 42 | 5/7 | 0 | 0 |
| 43 | 7/7 | 0 | 0 |
| 44 | 6/6 | 0 | 0 |
| 45 | 4/8 | 0 | 0 |
| 46 | 2/3 | 0 | 0 |
| 47 | 4/5 | 0 | 0 |
| 48 | 4/4 | 0 | 0 |
| 49 | 5/6 | 0 | 0 |
| 50 | 3/7 | 0 | 0 |

## Findings

1. **Zero hallucinations, zero trap leaks.** The baseline never invented a food and never pulled
   an item off a menu poster, a background plate or a printed card — all 11 trap images stayed
   clean. Its errors are entirely errors of omission and abstraction.
2. **The failure mode is under-enumeration.** 3.16 items/plate against 4.7 gold core items/plate.
   Every plate reported as a single dish name (06 sushi platter, 20 shio ramen, 33 oatmeal with
   toppings, 28 mezze platter, 23 wet burrito) scores 1-2/N; every plate where the model
   enumerated (01, 25, 44, 43, 30) scores at or near full.
3. **Generic bag labels drive most of the loss.** `side salad`, `vegetables`, `various Indian
   curries`, `mixed banchan` and `toppings` account for ~24 missed core items on their own
   (26, 28, 32, 33, 35, 42, 45, 50). This is the single highest-leverage prompt fix: forbid
   category words, require component enumeration.
4. **Misidentification, not fabrication, on hard plates.** 42 called a chickpea-cauliflower curry
   "lentil dal"; 43 called a creamy soup "cheesy grits" and a creamy meat stew "scrambled egg with
   ham"; 32 called pan-fried spiced egg halves "deviled eggs"; 46 called fried beancurd rolls
   "steamed". Each points at the right object with the wrong name — a nutrition pipeline would
   silently mis-map these, so name accuracy needs its own metric alongside recall.
5. **Condiments and small toppings are systematically dropped**: wasabi/ginger/soy (06), maple
   syrup (25), curry powder (17), cherry tomatoes (49), coriander (22), spring onion (21, 27).
