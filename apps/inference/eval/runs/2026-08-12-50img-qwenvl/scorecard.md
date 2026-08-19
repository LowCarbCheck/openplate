# Plate-identification scoring worksheet

- results: `runs/2026-08-12-50img-qwenvl/results.json`
- config: `local-cpu-v2` (started 2026-08-12T14:39:43.896179+00:00)
- approaches: single_qwen_vl
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM

## Mechanical metrics (auto-computed)

| metric | single_qwen_vl |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 181 |
| items named (mean/plate) | 3.62 |
| distinct item names | 148 |
| latency mean (s) | 111.78 |
| latency median (s) | 94.35 |
| latency max (s) | 596.7 |
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

- **single_qwen_vl**: whole wheat toast, bacon, baked beans, scrambled eggs, cucumber slices, sausage

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: Yorkshire pudding, roast beef, mixed vegetables, gravy

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: grilled salmon, side salad, feta cheese, avocado, black olives

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: cheeseburger, french fries, pickles

| gold core item | single_qwen_vl | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) |   |  |
| thick-cut fries/steak fries |   |  |
| ketchup |   |  |
| pickles/gherkins |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05 — Chicken in creamy leafy-green sauce with white rice

- **single_qwen_vl**: white rice, chicken curry with greens

| gold core item | single_qwen_vl | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) |   |  |
| white rice |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): red bell pepper bits in rice

### 06 — Sushi platter (restaurant table)

- **single_qwen_vl**: sushi roll, sashimi, wasabi, pickled ginger

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: spaghetti with meat sauce and vegetables

| gold core item | single_qwen_vl | notes |
|---|---|---|
| spaghetti |   |  |
| ground beef/meat tomato sauce |   |  |
| corn kernels |   |  |
| green beans |   |  |
| carrot pieces |   |  |
| **core recall (/5)** |   |  |
| **hallucinations** |   |  |

### 08 — Yogurt granola bowl with apple

- **single_qwen_vl**: yogurt, granola, apple slices

| gold core item | single_qwen_vl | notes |
|---|---|---|
| yogurt |   |  |
| granola (oats/puffed grains, nuts) |   |  |
| apple slices |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09 — Whole chicken pizza in delivery box

- **single_qwen_vl**: pizza, cola

| gold core item | single_qwen_vl | notes |
|---|---|---|
| pizza with chicken pieces and cheese |   |  |
| **core recall (/1)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): cola drink at table edge

### 10 — Club sandwich with side salad (cafe table)

- **single_qwen_vl**: club sandwich, side salad, pepsi max

| gold core item | single_qwen_vl | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) |   |  |
| green side salad (rocket/mixed leaves) |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11 — Wiener Schnitzel with fries and side salad

- **single_qwen_vl**: fried fish, french fries, side salad, tartar sauce

| gold core item | single_qwen_vl | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) |   |  |
| thick-cut fries/potato wedges |   |  |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12 — Bratwurst plate with sauerkraut and mashed potatoes

- **single_qwen_vl**: grilled sausages, mashed potatoes, sauerkraut

| gold core item | single_qwen_vl | notes |
|---|---|---|
| bratwurst sausages |   |  |
| sauerkraut |   |  |
| mashed potatoes |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13 — Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **single_qwen_vl**: macaroni and cheese, caramelized onions, side salad

| gold core item | single_qwen_vl | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) |   |  |
| fried/caramelised onions |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14 — Beef gulasch with boiled potatoes and a side bowl of lettuce

- **single_qwen_vl**: beef stew with potatoes, side salad

| gold core item | single_qwen_vl | notes |
|---|---|---|
| beef gulasch/stew in dark gravy |   |  |
| boiled potatoes |   |  |
| green leaf lettuce (butterhead) in a separate glass bowl |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 18 — Swabian Maultaschen with potato salad

- **single_qwen_vl**: potato salad, dumplings

| gold core item | single_qwen_vl | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) |   |  |
| potato salad |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19 — German fast-food mixed plate (Taxiteller)

- **single_qwen_vl**: fried french fries, grilled pork, sausage in sauce, yogurt sauce

| gold core item | single_qwen_vl | notes |
|---|---|---|
| French fries |   |  |
| gyros/döner sliced meat |   |  |
| sliced sausage in curry/shashlik sauce |   |  |
| tzatziki/garlic yogurt sauce |   |  |
| mayonnaise |   |  |
| **core recall (/5)** |   |  |
| **hallucinations** |   |  |

### 20 — Bowl of shio ramen

- **single_qwen_vl**: ramen noodles, chicken breast, herbs

| gold core item | single_qwen_vl | notes |
|---|---|---|
| ramen noodles |   |  |
| clear (shio) broth |   |  |
| sliced chashu pork |   |  |
| leafy green herb topping (mizuna/mitsuba) |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21 — Vietnamese pho with a side plate of herb garnishes

- **single_qwen_vl**: pho, bean sprouts, fresh herbs

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: tacos, grilled corn on the cob, soda

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: enchilada, salsa, shredded cheese, lettuce

| gold core item | single_qwen_vl | notes |
|---|---|---|
| burrito (flour tortilla) |   |  |
| green chile sauce |   |  |
| shredded cheddar/jack cheese |   |  |
| shredded lettuce |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): diced tomato

### 24 — Fish and chips with peas

- **single_qwen_vl**: fish and chips, green peas, tartar sauce

| gold core item | single_qwen_vl | notes |
|---|---|---|
| battered fried fish fillet |   |  |
| chips/thick-cut fries |   |  |
| green peas |   |  |
| tartar sauce |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): lemon wedge

### 25 — American breakfast platter

- **single_qwen_vl**: pancakes, fried egg, bacon, sausage, toast, hash browns

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: fried rice, roti, dal, curry, yogurt

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: chicken with sauce and vegetables, white rice

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: falafel, yellow lentils, beetroot, white bean salad, pita bread, tahini sauce

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: sliced salami, cubed cheese, green olives, pickled vegetables

| gold core item | single_qwen_vl | notes |
|---|---|---|
| pickled gherkin slices |   |  |
| salami slices |   |  |
| cheese cubes |   |  |
| green olives |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30 — Mixed grill board (plancha de grillades)

- **single_qwen_vl**: grilled chicken breast, grilled pork chop, baked potato, side salad, grilled sausage

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: beef stew, whole wheat toast, butter

| gold core item | single_qwen_vl | notes |
|---|---|---|
| thick brown meat soup/stew broth |   |  |
| beef (oxtail) chunks |   |  |
| buttered bread slices (dark/whole-grain) |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): parsley garnish, butter as separate item

### 32 — Charcuterie/snack board (compartmented bamboo tray, top-down)

- **single_qwen_vl**: olives, vegetable sticks, hard-boiled eggs, cheese, meat, dip

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: oatmeal, maple syrup, raisins, peanut butter, cinnamon

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: waffles, strawberry sauce, whipped cream, strawberries

| gold core item | single_qwen_vl | notes |
|---|---|---|
| waffles |   |  |
| strawberries (sliced fresh) |   |  |
| strawberry/berry syrup-compote |   |  |
| whipped cream |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): orange juice glass at top edge

### 35 — Gyros/döner plate with fries and salad

- **single_qwen_vl**: grilled meat, french fries, side salad, yogurt sauce

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: seafood paella

| gold core item | single_qwen_vl | notes |
|---|---|---|
| saffron/paella rice |   |  |
| whole prawns (langostinos) |   |  |
| mantis shrimp (galeras) |   |  |
| artichoke pieces |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): red pepper/tomato bits in the rice

### 37 — Pierogi ruskie with carrot-cabbage salad

- **single_qwen_vl**: potsticker dumplings, coleslaw

| gold core item | single_qwen_vl | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) |   |  |
| fried caramelised onion topping |   |  |
| grated carrot and cabbage salad |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): radish/beet sprouts garnish

### 38 — Half-eaten beefburger with fries

- **single_qwen_vl**: hamburger, french fries

| gold core item | single_qwen_vl | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) |   |  |
| French fries |   |  |
| **core recall (/2)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39 — Remains of a fried breakfast (mostly eaten)

- **single_qwen_vl**: baked beans, sausage, bacon

| gold core item | single_qwen_vl | notes |
|---|---|---|
| baked beans in tomato sauce |   |  |
| sausage pieces |   |  |
| bacon rasher |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40 — Half-eaten liver-and-bacon fry-up with chips

- **single_qwen_vl**: beef stew, french fries, fried egg, tomato

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: fried fish, potato wedges, tartar sauce

| gold core item | single_qwen_vl | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten |   |  |
| potato wedges/skin-on roast potatoes |   |  |
| tartar sauce / mayonnaise dollop |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42 — Buffet lunch plate (many components)

- **single_qwen_vl**: breaded chicken breast, rice, curry with chickpeas, sausage, corn and onion salad

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: bread, rice, green beans, fried fish cake, creamed sauce, bowl of grits with bacon

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: stewed meat with cabbage, yellow rice, black beans, side salad

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: kimchi, steamed rice, grilled fish, tofu, stew, side salad

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: steamed beef tripe, steamed beef offal, steamed tofu skin

| gold core item | single_qwen_vl | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce |   |  |
| white boiled tripe/omasum slices in broth |   |  |
| fried beancurd-skin rolls (tofu skin rolls) |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47 — Café brunch table spread (top-down)

- **single_qwen_vl**: avocado toast, bowl of granola with kiwi and berry compote, chocolate sesame donut, iced coffee with latte art, iced coffee with coffee beans

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: slice of cake, potato chips, sandwich, fried samosas

| gold core item | single_qwen_vl | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) |   |  |
| potato chips/crisps |   |  |
| samosas (small fried triangles) |   |  |
| slice of white/vanilla cake with icing — partly eaten |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): plastic fork and foil (non-food)

### 49 — Cafe sizzling-plate dinner set

- **single_qwen_vl**: steak with sauce, spaghetti with sauce and cherry tomatoes, bread roll, soup

| gold core item | single_qwen_vl | notes |
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

- **single_qwen_vl**: grilled lamb, french fries, side salad

| gold core item | single_qwen_vl | notes |
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

### 15 — Bavarian Weisswurst breakfast

- **single_qwen_vl**: white sausage, pretzel, beer

| gold core item | single_qwen_vl | notes |
|---|---|---|
| Weisswurst sausages in hot water |   |  |
| pretzel (Brezel) |   |  |
| sweet mustard |   |  |
| **core recall (/3)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16 — Döner/gyros plate with fries and salad

- **single_qwen_vl**: grilled meat with sauce, french fries, side salad

| gold core item | single_qwen_vl | notes |
|---|---|---|
| döner/gyros sliced meat |   |  |
| tomato sauce over the meat |   |  |
| French fries |   |  |
| side salad (lettuce, tomato, cucumber, red onion) with dressing |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17 — Currywurst with French fries

- **single_qwen_vl**: fried potato sticks, sausage, tomato sauce

| gold core item | single_qwen_vl | notes |
|---|---|---|
| currywurst (sausage) |   |  |
| curry ketchup sauce |   |  |
| curry powder |   |  |
| French fries |   |  |
| **core recall (/4)** |   |  |
| **hallucinations** |   |  |

## Totals (fill after scoring)

| metric | single_qwen_vl |
|---|---|
| core-item recall (/235) |   |
| hallucinations |   |
| distinct items named (auto) | 148 |
| cost / plate (auto) | $0.00000 |
| latency median s (auto) | 94.35 |

## Findings

1. 
