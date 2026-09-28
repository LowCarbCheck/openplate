# Plate-identification scoring worksheet — FILLED

- results: `runs/2026-08-12-50img-lfmvl/results.json`
- config: `local-cpu` (started 2026-08-12T12:05:35.942189+00:00)
- approaches: single_lfm_vl
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
- scored: 2026-08-12 (reviewing agent; images inspected for 04, 05, 06, 10, 11, 13, 15, 19, 26, 27, 28, 29, 30, 32, 35, 41, 42, 43, 44, 45, 46, 47, 48)

## Mechanical metrics (auto-computed)

| metric | single_lfm_vl |
|---|---|
| plates | 50 |
| schema-valid responses | 50/50 |
| items named (total) | 242 |
| items named (mean/plate) | 4.84 |
| distinct item names | 155 |
| latency mean (s) | 31.3 |
| latency median (s) | 29.93 |
| latency max (s) | 122.3 |
| cost / plate (USD) | 0.0 |
| cost total (USD) | 0.0 |

## Scoring conventions applied

1. `Y` = gold item covered (synonym or coarser consolidation counts; granularity loss noted). `n` = missed.
2. **Same food class, different subtype with comparable nutrition** (mayo↔tartar sauce, pork chop↔spare ribs, croquette↔tater tot, scrambled↔fried egg, macaroni↔spätzle) → `Y` with note.
3. **Different species / different food class** (chicken↔fish, chicken↔pork sausage, burger↔grilled cheese, steak↔liver, egg↔eggplant) → `n` with note. These are *misidentifications of a visible object*, so they are **not** counted as hallucinations — only as misses. Notes flag them so the pattern is visible.
4. Hallucination = a named food with **no visible referent at all** on the table.
5. Trap leak = a gold `trap` item (visible only in poster/menu/screen/packaging) that was reported.
6. Optional items: no credit, no penalty. Visible-but-not-in-gold items: ignored.
7. `Y?` / `n?` = judgment call for architect adjudication (listed at the end of this file).

> Gold-label protocol: Gold labels authored by hand from direct image inspection (Fable, 2026-08-11). 'core' = items a correct identification must include (synonyms/consolidations acceptable, e.g. 'Greek salad' may cover lettuce+cucumber+tomato). 'optional' = visible but acceptable to omit (garnish, condiments, off-plate drinks). Hallucination = any reported food not visible at all. Entries 11-50 (added 2026-08-11): drafted by two opus vision agents under the same protocol, spot-verified by Fable against images 12/19/22/39/45/46 before merge; manifest descriptions for 32/46/47 corrected to match images.

### 01 — Continental/English-style breakfast plate

- **single_lfm_vl**: ham, cucumber, eggs, baked beans, ham, bread

| gold core item | single_lfm_vl | notes |
|---|---|---|
| scrambled eggs | Y | "eggs" — prep not specified |
| bacon/ham slices | Y | reported twice |
| frankfurter sausages | n |  |
| baked beans in tomato sauce | Y |  |
| brown bread slice | Y | "bread" — grain not specified |
| cucumber slices | Y |  |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |

Recall: 5/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): butter/margarine packets

### 02 — Roast (Sunday) dinner

- **single_lfm_vl**: Pork roast, Roast potatoes, Broccoli

| gold core item | single_lfm_vl | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y | "Pork roast" — wrong species, same food class (roast red meat); credited per convention 2 |
| Yorkshire pudding | n |  |
| roast potatoes | Y |  |
| broccoli | Y |  |
| cabbage/greens | n |  |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none |  |

Recall: 3/5
Hallucinations: none
Trap leaks: none

Optional (no recall credit): gravy as separate item

### 03 — Greek-style salad with grilled salmon

- **single_lfm_vl**: salmon, lettuce, cucumber, red onion, avocado, tomato, feta cheese, olives, lemon

| gold core item | single_lfm_vl | notes |
|---|---|---|
| grilled salmon fillets | Y |  |
| feta cheese | Y |  |
| kalamata olives | Y | "olives" — variety not specified |
| avocado | Y |  |
| cherry tomatoes | Y | "tomato" |
| cucumber | Y |  |
| lettuce/romaine | Y |  |
| red onion | Y |  |
| **core recall (/8)** | 8/8 |  |
| **hallucinations** | none |  |

Recall: 8/8
Hallucinations: none
Trap leaks: none

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04 — Cheeseburger with fries

- **single_lfm_vl**: grilled cheese sandwich, fries, pickles

| gold core item | single_lfm_vl | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | n? | image shows an unmistakable beef patty + cheese slice in a bun; "grilled cheese sandwich" drops the meat entirely — scored a miss (wrong food class), not a hallucination |
| thick-cut fries/steak fries | Y | "fries" |
| ketchup | n | ketchup ramekin visible, unreported |
| pickles/gherkins | Y |  |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none | "grilled cheese sandwich" = misnamed burger |

Recall: 2/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): lettuce in burger, beer in background

### 05 — Chicken in creamy leafy-green sauce with white rice

- **single_lfm_vl**: Rice, Mushrooms, Chicken, Soup

| gold core item | single_lfm_vl | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | "Chicken" + "Soup" (the sauce); the leafy greens are not named — granularity loss |
| white rice | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | pale chunks in the sauce are plausibly mushroom — not counted against |

Recall: 2/2
Hallucinations: none
Trap leaks: none

Optional (no recall credit): red bell pepper bits in rice

### 06 — Sushi platter (restaurant table)

- **single_lfm_vl**: sushi, tuna, salmon, miso, wasabi

| gold core item | single_lfm_vl | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | "sushi" + "salmon" |
| tuna nigiri | Y | red nigiri correctly called tuna |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | n | two clearly white/pale nigiri unnamed; "salmon" accounted for the roll |
| pickled ginger | n | ginger mound visible, unreported |
| wasabi | Y |  |
| soy sauce | n | soy dish visible, unreported |
| **core recall (/6)** | 3/6 |  |
| **hallucinations** | miso | no miso soup anywhere in frame (only empty black bowls/glasses) |

Recall: 3/6
Hallucinations: miso
Trap leaks: none

Optional (no recall credit): white wine / water glasses in background

### 07 — Spaghetti with meat-vegetable sauce

- **single_lfm_vl**: spaghetti, ground beef, corn kernels, green beans, carrots

| gold core item | single_lfm_vl | notes |
|---|---|---|
| spaghetti | Y |  |
| ground beef/meat tomato sauce | Y | "ground beef"; sauce not separately named |
| corn kernels | Y |  |
| green beans | Y |  |
| carrot pieces | Y |  |
| **core recall (/5)** | 5/5 |  |
| **hallucinations** | none |  |

Recall: 5/5
Hallucinations: none
Trap leaks: none

### 08 — Yogurt granola bowl with apple

- **single_lfm_vl**: yogurt, granola, apples

| gold core item | single_lfm_vl | notes |
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

- **single_lfm_vl**: pizza

| gold core item | single_lfm_vl | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | consolidation; toppings not named |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none |  |

Recall: 1/1
Hallucinations: none
Trap leaks: none

Optional (no recall credit): cola drink at table edge

### 10 — Club sandwich with side salad (cafe table)

- **single_lfm_vl**: Pepsi, Pepperoni sandwich, Viva la Mexicana, Coffee, Beverage

| gold core item | single_lfm_vl | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y? | "Pepperoni sandwich" — correct food class (toasted layered sandwich) but invented filling; no pepperoni in the photo |
| green side salad (rocket/mixed leaves) | n | leaf salad clearly on the plate, unreported |
| **core recall (/2)** | 1/2 |  |
| **hallucinations** | none | (Pepsi + coffee cup are optional and real) |

Recall: 1/2
Hallucinations: none
Trap leaks: "Viva la Mexicana" — read off the Jamaica Blue "Viva la Mexican Fiesta" promo banner behind the table (poster shows burrito/quesadilla/fritter)

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11 — Wiener Schnitzel with fries and side salad

- **single_lfm_vl**: six slice grilled chicken breast, side salad, french fries, lemon, salt

| gold core item | single_lfm_vl | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | n? | image shows a heavily breaded, deep-fried cutlet; "grilled chicken breast" gets both the coating and the cooking method wrong — miss, not hallucination |
| thick-cut fries/potato wedges | Y |  |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | "side salad" consolidates the salad rows |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |

Recall: 2/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12 — Bratwurst plate with sauerkraut and mashed potatoes

- **single_lfm_vl**: sausage, mashed potatoes, sauerkraut

| gold core item | single_lfm_vl | notes |
|---|---|---|
| bratwurst sausages | Y | "sausage" |
| sauerkraut | Y |  |
| mashed potatoes | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none | background second plate correctly ignored |

Recall: 3/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13 — Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **single_lfm_vl**: Macaroni and cheese, Caramelized onions

| gold core item | single_lfm_vl | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y | "Macaroni and cheese" — same class (egg-noodle/pasta in melted cheese); regional name lost |
| fried/caramelised onions | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none | no invented meat/bacon — trap avoided |

Recall: 2/2
Hallucinations: none
Trap leaks: none

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14 — Beef gulasch with boiled potatoes and a side bowl of lettuce

- **single_lfm_vl**: Potatoes, Beef

| gold core item | single_lfm_vl | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y | "Beef"; stew/gravy not named |
| boiled potatoes | Y |  |
| green leaf lettuce (butterhead) in a separate glass bowl | n |  |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |

Recall: 2/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15 — Bavarian Weisswurst breakfast

- **single_lfm_vl**: grilled chicken breast, mixed salad, beer, pretzel

| gold core item | single_lfm_vl | notes |
|---|---|---|
| Weisswurst sausages in hot water | n | two white sausages poaching in water; called "grilled chicken breast" — wrong class and method |
| pretzel (Brezel) | Y |  |
| sweet mustard | n | mustard jar clearly in frame, unreported |
| **core recall (/3)** | 1/3 |  |
| **hallucinations** | mixed salad | no salad anywhere in the photo (only parsley in the pot) |

Recall: 1/3
Hallucinations: mixed salad
Trap leaks: none

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16 — Döner/gyros plate with fries and salad

- **single_lfm_vl**: French fries, Salad, Beef, Tomato, Lettuce

| gold core item | single_lfm_vl | notes |
|---|---|---|
| döner/gyros sliced meat | Y | "Beef" |
| tomato sauce over the meat | n | "Tomato" reads as the salad tomato (also reported alongside lettuce), not the sauce |
| French fries | Y |  |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | "Salad" + lettuce + tomato |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |

Recall: 3/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17 — Currywurst with French fries

- **single_lfm_vl**: French fries, Sausage

| gold core item | single_lfm_vl | notes |
|---|---|---|
| currywurst (sausage) | Y | "Sausage" |
| curry ketchup sauce | n |  |
| curry powder | n |  |
| French fries | Y |  |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |

Recall: 2/4
Hallucinations: none
Trap leaks: none

### 18 — Swabian Maultaschen with potato salad

- **single_lfm_vl**: stuffed dumplings, pasta

| gold core item | single_lfm_vl | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "stuffed dumplings" (+ "pasta" restates the same item) |
| potato salad | n |  |
| **core recall (/2)** | 1/2 |  |
| **hallucinations** | none | "pasta" is the Maultaschen restated, not a separate invention |

Recall: 1/2
Hallucinations: none
Trap leaks: none

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19 — German fast-food mixed plate (Taxiteller)

- **single_lfm_vl**: French fries, Ribs, Sausages, Tzatziki

| gold core item | single_lfm_vl | notes |
|---|---|---|
| French fries | Y |  |
| gyros/döner sliced meat | n | thin dark shaved gyros meat called "Ribs" — wrong cut/class |
| sliced sausage in curry/shashlik sauce | Y | "Sausages"; sauce not named |
| tzatziki/garlic yogurt sauce | Y |  |
| mayonnaise | n | the large separate white mayo dollop is unaccounted (tzatziki credited to the other white sauce) |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none | "Ribs" = misnamed gyros meat |

Recall: 3/5
Hallucinations: none
Trap leaks: none

### 20 — Bowl of shio ramen

- **single_lfm_vl**: Noodles, Leafy greens, Sliced pork

| gold core item | single_lfm_vl | notes |
|---|---|---|
| ramen noodles | Y |  |
| clear (shio) broth | n | broth never named |
| sliced chashu pork | Y |  |
| leafy green herb topping (mizuna/mitsuba) | Y |  |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |

Recall: 3/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21 — Vietnamese pho with a side plate of herb garnishes

- **single_lfm_vl**: Beef, Noodles, Basil

| gold core item | single_lfm_vl | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y | "Noodles" + "Beef"; broth/dish name lost |
| sliced beef and beef meatballs | Y | meatballs not distinguished |
| bean sprouts | n |  |
| Thai basil | Y |  |
| sliced green chilli/jalapeño | n |  |
| spring onion | n |  |
| **core recall (/6)** | 3/6 |  |
| **hallucinations** | none |  |

Recall: 3/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22 — Three soft tacos with a corn cob

- **single_lfm_vl**: corn on the cob, taco shells, ground beef, cilantro, chili sauce, shredded cheese

| gold core item | single_lfm_vl | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y | "taco shells" + "ground beef" |
| grated cheese | Y |  |
| red salsa | Y | "chili sauce" |
| green salsa/tomatillo | n | only one salsa named |
| coriander/cilantro | Y |  |
| grilled corn on the cob | Y |  |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |

Recall: 5/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): glass of cola

### 23 — Smothered beef burrito

- **single_lfm_vl**: burrito, lettuce, tomato

| gold core item | single_lfm_vl | notes |
|---|---|---|
| burrito (flour tortilla) | Y |  |
| green chile sauce | n | the defining smothering sauce is unreported |
| shredded cheddar/jack cheese | n |  |
| shredded lettuce | Y |  |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none | "tomato" is a gold optional (visible) |

Recall: 2/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): diced tomato

### 24 — Fish and chips with peas

- **single_lfm_vl**: fried fish fillet, french fries, green peas, lemon slice, mayonnaise

| gold core item | single_lfm_vl | notes |
|---|---|---|
| battered fried fish fillet | Y |  |
| chips/thick-cut fries | Y |  |
| green peas | Y |  |
| tartar sauce | Y | "mayonnaise" — same class, near-identical nutrition (convention 2) |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): lemon wedge

### 25 — American breakfast platter

- **single_lfm_vl**: Sausages, Pancakes, Sausage Links, Scrambled Eggs, Hash Browns, Toast

| gold core item | single_lfm_vl | notes |
|---|---|---|
| pancakes with icing sugar | Y |  |
| back bacon rashers | n | bacon never named (both sausage entries are the same links) |
| fried egg (sunny side up) | Y | "Scrambled Eggs" — wrong prep, same food; credited per convention 2 |
| breakfast sausages | Y | reported twice ("Sausages", "Sausage Links") |
| hash brown/potato croquettes | Y |  |
| toast slices | Y |  |
| maple syrup in a shot glass | n |  |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none |  |

Recall: 5/7
Hallucinations: none
Trap leaks: none (nothing from the second plate at the top of frame was reported)

Optional (no recall credit): butter packet

### 26 — Indian thali on a steel tray

- **single_lfm_vl**: Rice, Rice, Cucumber, Carrot, Cauliflower, Beans, Noodles, Vegetables, Soup, Rice

| gold core item | single_lfm_vl | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | reported three times |
| chapati/roti | n | two flatbreads plainly visible, unreported |
| papad (papadum) | n |  |
| curd/raita | n | white curd bowl unreported |
| dal (lentil curry) | Y? | "Beans" / "Soup" plausibly the lentil bowl, but neither is anchored — could equally be the clear vegetable stew (a gold optional) |
| kofta/dumpling curry in orange gravy | n |  |
| paneer or fish curry in pale gravy | n |  |
| brinjal/eggplant curry | n | "Vegetables" is too generic to anchor to the aubergine bowl |
| **core recall (/8)** | 2/8 |  |
| **hallucinations** | noodles | no noodles on the tray (cucumber/carrot/cauliflower are all defensible reads of the slaw and the clear stew) |

Recall: 2/8
Hallucinations: noodles
Trap leaks: none

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27 — Stir-fried chicken with peppers and steamed rice

- **single_lfm_vl**: chicken, sauce, red bell pepper, green bell pepper, onion

| gold core item | single_lfm_vl | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y | "chicken" + "sauce" |
| red bell pepper strips | Y |  |
| onion | Y |  |
| spring onion/green onion | n | the green pieces are spring-onion stalks; reported as "green bell pepper" |
| steamed white rice | n | large rice mound in frame, never reported |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none | "green bell pepper" = misnamed spring onion |

Recall: 3/5
Hallucinations: none
Trap leaks: none

Optional (no recall credit): dried chilli bits

### 28 — Middle-Eastern mezze spread — four composed plates plus flatbread

- **single_lfm_vl**: Grilled chicken breast, Side salad, Fresh vegetables, Olives, Legumes, Fresh herbs, Fresh vegetables

| gold core item | single_lfm_vl | notes |
|---|---|---|
| falafel balls | n | the browned balls were called "Grilled chicken breast" — wrong class (chickpea fritter vs poultry) |
| grilled flatbread | n | three large grilled flatbreads centre-frame, unreported |
| hummus/creamy white dip | n |  |
| green herb-chilli sauce | n | "Fresh herbs" reads as the parsley garnish (gold optional), not the two sauce ramekins |
| yellow bulgur or couscous | n |  |
| black beluga lentils | Y? | "Legumes" is the only plausible anchor for the black lentil piles; very generic |
| pickled white cabbage slaw | n | "Side salad" / "Fresh vegetables" too generic to anchor |
| green olives | Y |  |
| **core recall (/8)** | 2/8 |  |
| **hallucinations** | none | "Grilled chicken breast" = misnamed falafel |

Recall: 2/8
Hallucinations: none
Trap leaks: none

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29 — Tapas/snack flight with a wheat beer

- **single_lfm_vl**: grilled chicken breast, salami, cheese, pickles, olives

| gold core item | single_lfm_vl | notes |
|---|---|---|
| pickled gherkin slices | Y |  |
| salami slices | Y |  |
| cheese cubes | Y |  |
| green olives | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | grilled chicken breast | all four dishes are already accounted for by the other four names; no poultry in frame |

Recall: 4/4
Hallucinations: grilled chicken breast
Trap leaks: none

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30 — Mixed grill board (plancha de grillades)

- **single_lfm_vl**: Grilled chicken breast, Parsnip, Red cabbage, Grilled steak, Grilled pork chops, Grilled sausage, Grilled kebabs, Grilled mushrooms

| gold core item | single_lfm_vl | notes |
|---|---|---|
| pork spare ribs slab | Y | "Grilled pork chops" — same species/cooking, different cut (convention 2) |
| grilled beef steak | Y |  |
| grilled sausage | Y |  |
| grilled meat skewer with green pepper and tomato | Y | "Grilled kebabs" |
| baked/roasted potato with browned cheese topping | n | the cheese-topped potato was called "Parsnip" |
| mixed leaf salad | Y? | "Red cabbage" is most plausibly the purple/red lettuce leaves; no actual cabbage on the board |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | grilled mushrooms | no mushrooms on the board. ("Grilled chicken breast" may be the pale grilled chunk on the skewer — not counted; "Parsnip" = misnamed potato) |

Recall: 5/6
Hallucinations: grilled mushrooms
Trap leaks: none

Optional (no recall credit): cherry tomato, steak knife

### 31 — Bowl of beef/oxtail soup with buttered bread

- **single_lfm_vl**: beef stew, sourdough toast

| gold core item | single_lfm_vl | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y | "beef stew" |
| beef (oxtail) chunks | Y | same phrase; cut not distinguished |
| buttered bread slices (dark/whole-grain) | Y | "sourdough toast" — bread type/prep off, butter not named |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): parsley garnish, butter as separate item

### 32 — Charcuterie/snack board (compartmented bamboo tray, top-down)

- **single_lfm_vl**: eggplant, cucumber slices, carrot sticks, red bell peppers, green olives, celery sticks, yellow bell peppers, red bell peppers, green olives, carrot sticks, red bell peppers, carrot sticks, yellow bell peppers, red bell peppers, green olives, carrot sticks, red bell peppers, carrot sticks, yellow bell peppers, red bell peppers, carrot sticks, red bell peppers, green olives, carrot sticks, red bell peppers, carrot sticks, yellow bell peppers

| gold core item | single_lfm_vl | notes |
|---|---|---|
| green olives | Y |  |
| cucumber sticks | Y |  |
| carrot sticks | Y |  |
| bell pepper strips | Y | red/yellow/orange all named |
| pan-fried spiced hard-boiled egg halves | n | the turmeric-spiced egg halves were called "eggplant" — wrong food |
| hummus dip | n | large heart-shaped hummus bowl centre-frame, unreported |
| salami/cured meat slices | n | a whole fanned row of salami, unreported |
| cheese slices | n | two cheese piles, unreported |
| **core recall (/8)** | 4/8 |  |
| **hallucinations** | none | "eggplant" = misnamed eggs; "celery sticks" = misnamed cucumber. Output is a degenerate loop of the four veg it did see (27 items, 8 distinct) |

Recall: 4/8
Hallucinations: none
Trap leaks: none

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33 — Bowl of oatmeal porridge with toppings

- **single_lfm_vl**: oatmeal, raisins, cinnamon

| gold core item | single_lfm_vl | notes |
|---|---|---|
| oatmeal/oat porridge | Y |  |
| peanut butter | n |  |
| raisins | Y |  |
| ground cinnamon | Y |  |
| milk | n |  |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none |  |

Recall: 3/5
Hallucinations: none
Trap leaks: none

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34 — Waffles with strawberries and whipped cream

- **single_lfm_vl**: waffles, strawberries, whipped cream

| gold core item | single_lfm_vl | notes |
|---|---|---|
| waffles | Y |  |
| strawberries (sliced fresh) | Y |  |
| strawberry/berry syrup-compote | n | sauce not distinguished from the fresh fruit |
| whipped cream | Y |  |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |

Recall: 3/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): orange juice glass at top edge

### 35 — Gyros/döner plate with fries and salad

- **single_lfm_vl**: grilled chicken breast, french fries, salad

| gold core item | single_lfm_vl | notes |
|---|---|---|
| gyros/döner sliced meat | n? | the meat is dark-brown shaved döner (lamb/beef-type), not poultry; "grilled chicken breast" misses both species and form |
| French fries | Y |  |
| white garlic-yogurt sauce (tzatziki) with oregano | n | large oregano-dusted white sauce pool on the meat, unreported |
| shredded white cabbage | Y? | credited as the base of the generic "salad" |
| tomato slices | n | generic "salad" does not deliver the discrete components (gold splits them deliberately) |
| sweetcorn | n |  |
| cucumber slices | n |  |
| shredded carrot | n |  |
| **core recall (/8)** | 2/8 |  |
| **hallucinations** | none | flatbread basket at the right edge correctly not claimed |

Recall: 2/8
Hallucinations: none
Trap leaks: none

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36 — Seafood paella in the pan

- **single_lfm_vl**: rice, shrimp, artichokes, other vegetables

| gold core item | single_lfm_vl | notes |
|---|---|---|
| saffron/paella rice | Y | "rice"; saffron/dish name lost |
| whole prawns (langostinos) | Y | "shrimp" |
| mantis shrimp (galeras) | Y? | credited as consolidated under the single "shrimp"; the two crustacean types are not distinguished |
| artichoke pieces | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: none

Optional (no recall credit): red pepper/tomato bits in the rice

### 37 — Pierogi ruskie with carrot-cabbage salad

- **single_lfm_vl**: Pork Belly Dumplings, Coleslaw, Microgreens

| gold core item | single_lfm_vl | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y | "Dumplings" correct; the "pork belly" filling is invented (ruskie = potato-cheese) |
| fried caramelised onion topping | n |  |
| grated carrot and cabbage salad | Y | "Coleslaw" |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | invented filling sits inside a correctly-identified item; "Microgreens" is the gold optional garnish |

Recall: 2/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): radish/beet sprouts garnish

### 38 — Half-eaten beefburger with fries

- **single_lfm_vl**: Burger, Fries

| gold core item | single_lfm_vl | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | consolidation; components not named |
| French fries | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none
Trap leaks: none

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39 — Remains of a fried breakfast (mostly eaten)

- **single_lfm_vl**: beans, bacon

| gold core item | single_lfm_vl | notes |
|---|---|---|
| baked beans in tomato sauce | Y |  |
| sausage pieces | n |  |
| bacon rasher | Y |  |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none | trap avoided — no invented eggs/toast/tomato/mushrooms |

Recall: 2/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40 — Half-eaten liver-and-bacon fry-up with chips

- **single_lfm_vl**: Steak, Fries, Eggs, Ham

| gold core item | single_lfm_vl | notes |
|---|---|---|
| liver pieces in gravy | n | "Steak" — organ meat vs muscle cut is a substantive nutrition error (convention 3) |
| chips/French fries | Y |  |
| bacon/gammon slice | Y | "Ham" |
| fried egg (remnant, yolk visible) | Y | "Eggs" |
| sausage | n |  |
| grilled tomato half | n |  |
| **core recall (/6)** | 3/6 |  |
| **hallucinations** | none | "Steak" = misnamed liver |

Recall: 3/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41 — Leftovers of battered fish and potato wedges

- **single_lfm_vl**: chicken, potatoes

| gold core item | single_lfm_vl | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten | n | the bite-open piece shows unmistakable white flaking fish; reported as "chicken" |
| potato wedges/skin-on roast potatoes | Y |  |
| tartar sauce / mayonnaise dollop | n | big white sauce smear on the plate, unreported |
| **core recall (/3)** | 1/3 |  |
| **hallucinations** | none | "chicken" = misnamed fish. Napkin text / pepper sachets correctly not reported (trap avoided) |

Recall: 1/3
Hallucinations: none
Trap leaks: none

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42 — Buffet lunch plate (many components)

- **single_lfm_vl**: fried chicken, mashed potatoes, curried chickpeas, corn kernels, mixed salad, lettuce and cucumber

| gold core item | single_lfm_vl | notes |
|---|---|---|
| breaded fried fish fillet | n? | "fried chicken" gets the breaded-fried class right but the species wrong; the fillet's species is genuinely hard to read from the photo, so flagged |
| sour cream / remoulade dollop | n | the white dollop on the fillet is unnamed (possibly what "mashed potatoes" refers to) |
| meatballs in brown gravy | n | three gravy meatballs clearly visible, unreported |
| chickpea-and-cauliflower curry | Y | "curried chickpeas"; cauliflower not named |
| white rice | n | rice bed visible under the fillet; only "mashed potatoes" reported |
| red cabbage and sweetcorn salad | Y | "corn kernels" + "mixed salad" |
| cucumber and lettuce salad | Y | "lettuce and cucumber" |
| **core recall (/7)** | 3/7 |  |
| **hallucinations** | none | "mashed potatoes" is best read as the misnamed rice/sour-cream dollop rather than an invention |

Recall: 3/7
Hallucinations: none
Trap leaks: none

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43 — Buffet lunch set — main plate, soup bowl, bread plate

- **single_lfm_vl**: grilled chicken breast, mixed greens, lemon wedge, potato hash, tater tots, fried egg, grilled chicken breast, rice

| gold core item | single_lfm_vl | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y? | "tater tots" / "potato hash" — breaded fried patty class right, but the filling is read as potato and the mayo topping is unnamed |
| herbed green rice | Y | "rice"; the herb/green colouring lost |
| green beans | n? | a clear pile of whole green beans; "mixed greens" more plausibly refers to the shredded leaf salad, so no credit — flagged |
| cheese-topped quiche/gratin square | Y? | "fried egg" is most plausibly this yellow egg-set square; a generous read |
| creamy meat-and-vegetable stew | n | large stew portion on the right of the plate, unreported |
| creamy soup (bowl, with bacon bits) | n | separate soup bowl entirely missed |
| bread roll with butter | n | buttered roll on its own side plate entirely missed |
| **core recall (/7)** | 3/7 |  |
| **hallucinations** | none | "grilled chicken breast" (×2) has no poultry referent but maps onto the croquettes/stew — recorded as misnaming, not invention |

Recall: 3/7
Hallucinations: none
Trap leaks: none

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44 — Brazilian buffet lunch plate (top-down)

- **single_lfm_vl**: grilled chicken breast, side salad, rice, beans, potatoes

| gold core item | single_lfm_vl | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | "side salad" |
| brown beans (feijão) in broth | Y | "beans" |
| yellow seasoned rice | Y | "rice"; seasoning lost |
| braised cabbage with tomato | n | the largest component on the plate, unreported |
| stewed meat in onion gravy | Y? | "grilled chicken breast" — the browned skin-on piece could plausibly be chicken, but it is stewed in gravy, not grilled |
| mashed cassava/potato purée | Y | "potatoes"; cassava vs potato not distinguished |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |

Recall: 5/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): cutlery and placemat (non-food)

### 45 — Korean hanjeongsik table spread (dozens of banchan, top-down)

- **single_lfm_vl**: grilled chicken breast, steamed tofu, kimchi, noodles, soup, fish cake

| gold core item | single_lfm_vl | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | Y | "noodles" |
| steamed egg (gyeranjjim) in stone pot | n | "steamed tofu" maps to the actual white tofu slices (a gold optional), not the egg pot |
| grilled mackerel/fish | Y? | "fish cake" — a fish item is named, but it equally fits the jeon platter; grilled whole fish reported as a processed cake |
| stir-fried beef in a hot stone pot | n |  |
| glazed spicy braised ribs/pork | n |  |
| sliced raw fish (hoe/sashimi) on shredded radish | n |  |
| vegetable fritters/jeon platter | n | credit for "fish cake" already assigned to the grilled fish |
| kimchi | Y |  |
| **core recall (/8)** | 3/8 |  |
| **hallucinations** | none | "soup" is real (two soup pots, gold optionals); "grilled chicken breast" has no poultry referent but maps to one of the browned meat dishes. Empty tableware correctly not claimed (trap avoided). 6 names for ~30 dishes |

Recall: 3/8
Hallucinations: none
Trap leaks: none

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46 — Hong Kong steamer basket of small offal dishes (dai pai dong)

- **single_lfm_vl**: fried dough balls, deep-fried tofu, stir-fried vegetables, pork belly, scallion pancakes, tofu skin, bamboo shoots, mung bean sprouts

| gold core item | single_lfm_vl | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | n | ~7 cups of yellow curried honeycomb tripe — the single largest group — entirely unidentified |
| white boiled tripe/omasum slices in broth | n | reported as "bamboo shoots" |
| fried beancurd-skin rolls (tofu skin rolls) | Y | "tofu skin" / "deep-fried tofu" |
| **core recall (/3)** | 1/3 |  |
| **hallucinations** | fried dough balls, scallion pancakes, pork belly, mung bean sprouts | none of these are present; the basket holds only tripe, beancurd rolls and a little veg |

Recall: 1/3
Hallucinations: fried dough balls, scallion pancakes, pork belly, mung bean sprouts (4)
Trap leaks: none (no siu mai / har gow / dumplings / buns named — the specific trap items were avoided, though the invented dough balls and pancakes are the same failure mode)

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47 — Café brunch table spread (top-down)

- **single_lfm_vl**: Avocado toast with poached egg, Eggs Benedict, Grilled salmon with quinoa, Fruit parfait with granola, Avocado toast with poached egg and red onion, Bagel with cream cheese and smoked salmon, Bagel with cream cheese and strawberry, Bagel with cream cheese and smoked salmon with arugula

| gold core item | single_lfm_vl | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | reported twice, accurately |
| eggs benedict with hollandaise on avocado toast | Y |  |
| yogurt bowl with granola, kiwi slices and berry compote | Y | "Fruit parfait with granola" |
| cherry tomato salad with balsamic drizzle | n | three plates carry tomato-and-balsamic rows; none reported |
| seeded bagel (dark, sesame-topped) | Y | the physical bagel is real; the "cream cheese / smoked salmon / strawberry" toppings are not |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | Grilled salmon with quinoa; Bagel with cream cheese and smoked salmon; Bagel with cream cheese and strawberry | no salmon, cream cheese, quinoa or strawberry anywhere on the table |

Recall: 4/5
Hallucinations: Grilled salmon with quinoa, Bagel with cream cheese and smoked salmon, Bagel with cream cheese and strawberry (3)
Trap leaks: none counted — but flagged: the printed menu cards under the plates are the likely source of these invented bagel/salmon combinations, so the architect may prefer to reclassify all three as trap leaks rather than free-floating hallucinations

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48 — Disposable plate of party snacks (partly eaten)

- **single_lfm_vl**: side salad, grilled chicken breast, crispy potato chips

| gold core item | single_lfm_vl | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | n | large white-bread triangle, unreported |
| potato chips/crisps | Y |  |
| samosas (small fried triangles) | n | possibly what "grilled chicken breast" refers to |
| slice of white/vanilla cake with icing — partly eaten | n |  |
| **core recall (/4)** | 1/4 |  |
| **hallucinations** | side salad | no salad or greenery on the plate at all |

Recall: 1/4
Hallucinations: side salad
Trap leaks: none

Optional (no recall credit): plastic fork and foil (non-food)

### 49 — Cafe sizzling-plate dinner set

- **single_lfm_vl**: Spaghetti, Meat, Soup, Bread

| gold core item | single_lfm_vl | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y | "Meat"; cut and sauce lost |
| spaghetti (plain, buttered) | Y |  |
| sausage/frankfurter | n |  |
| cherry tomatoes | n |  |
| red cabbage soup (borscht-style, bowl) | Y | "Soup"; type lost |
| bread bun | Y | "Bread" |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |

Recall: 4/6
Hallucinations: none
Trap leaks: none

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50 — Late-night döner kebab plate with fries and salad

- **single_lfm_vl**: grilled lamb, french fries, cucumber, red onion, lettuce

| gold core item | single_lfm_vl | notes |
|---|---|---|
| döner kebab sliced meat | Y | "grilled lamb" — correct species family for döner |
| tomato/chili sauce over the meat | n |  |
| French fries | Y |  |
| iceberg lettuce salad | Y |  |
| sliced red onion | Y |  |
| cucumber slices | Y |  |
| pickled gherkin and pepperoncini | n |  |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none | background second plate correctly not claimed (trap avoided) |

Recall: 5/7
Hallucinations: none
Trap leaks: none

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals

| metric | single_lfm_vl |
|---|---|
| total gold core items | 235 |
| total hits | 148 |
| core-item recall | 63.0% (148/235) |
| hallucinations | 13 |
| trap leaks | 1 |
| flagged judgment calls (`Y?` / `n?`) | 15 |
| distinct items named (auto) | 155 |
| cost / plate (auto) | $0.00000 |
| latency median s (auto) | 29.93 |

### Per-image tally

| image | hits/total | halluc | trap |
|---|---|---|---|
| 01 | 5/6 | 0 | 0 |
| 02 | 3/5 | 0 | 0 |
| 03 | 8/8 | 0 | 0 |
| 04 | 2/4 | 0 | 0 |
| 05 | 2/2 | 0 | 0 |
| 06 | 3/6 | 1 | 0 |
| 07 | 5/5 | 0 | 0 |
| 08 | 3/3 | 0 | 0 |
| 09 | 1/1 | 0 | 0 |
| 10 | 1/2 | 0 | 1 |
| 11 | 2/3 | 0 | 0 |
| 12 | 3/3 | 0 | 0 |
| 13 | 2/2 | 0 | 0 |
| 14 | 2/3 | 0 | 0 |
| 15 | 1/3 | 1 | 0 |
| 16 | 3/4 | 0 | 0 |
| 17 | 2/4 | 0 | 0 |
| 18 | 1/2 | 0 | 0 |
| 19 | 3/5 | 0 | 0 |
| 20 | 3/4 | 0 | 0 |
| 21 | 3/6 | 0 | 0 |
| 22 | 5/6 | 0 | 0 |
| 23 | 2/4 | 0 | 0 |
| 24 | 4/4 | 0 | 0 |
| 25 | 5/7 | 0 | 0 |
| 26 | 2/8 | 1 | 0 |
| 27 | 3/5 | 0 | 0 |
| 28 | 2/8 | 0 | 0 |
| 29 | 4/4 | 1 | 0 |
| 30 | 5/6 | 1 | 0 |
| 31 | 3/3 | 0 | 0 |
| 32 | 4/8 | 0 | 0 |
| 33 | 3/5 | 0 | 0 |
| 34 | 3/4 | 0 | 0 |
| 35 | 2/8 | 0 | 0 |
| 36 | 4/4 | 0 | 0 |
| 37 | 2/3 | 0 | 0 |
| 38 | 2/2 | 0 | 0 |
| 39 | 2/3 | 0 | 0 |
| 40 | 3/6 | 0 | 0 |
| 41 | 1/3 | 0 | 0 |
| 42 | 3/7 | 0 | 0 |
| 43 | 3/7 | 0 | 0 |
| 44 | 5/6 | 0 | 0 |
| 45 | 3/8 | 0 | 0 |
| 46 | 1/3 | 4 | 0 |
| 47 | 4/5 | 3 | 0 |
| 48 | 1/4 | 1 | 0 |
| 49 | 4/6 | 0 | 0 |
| 50 | 5/7 | 0 | 0 |
| **total** | **148/235** | **13** | **1** |

## Flagged judgment calls (architect adjudicates)

| image | cell | flag | rationale |
|---|---|---|---|
| 04 | cheeseburger | n? | Beef patty + cheese in a bun is unambiguous in the photo; "grilled cheese sandwich" drops the meat — scored a miss, but it is the correct object misnamed |
| 10 | club sandwich | Y? | "Pepperoni sandwich" gets the food class right (toasted layered sandwich) with an invented filling |
| 11 | breaded schnitzel | n? | Clearly a breaded deep-fried cutlet; "grilled chicken breast" is wrong on coating, method and species |
| 26 | dal | Y? | "Beans"/"Soup" plausibly the lentil bowl but could equally be the clear vegetable stew (gold optional) |
| 28 | black beluga lentils | Y? | "Legumes" is the only anchor for the lentil piles — very generic, could also be aimed at falafel |
| 30 | mixed leaf salad | Y? | "Red cabbage" is most plausibly the purple lettuce leaves; no true cabbage on the board |
| 30 | (halluc) grilled chicken breast | ? | Not counted as a hallucination: there is a pale grilled chunk on the skewer that may be poultry |
| 35 | gyros/döner meat | n? | Dark shaved döner meat called "grilled chicken breast" — wrong species and form |
| 35 | shredded white cabbage | Y? | Credited as the base of the generic "salad"; the other four discrete salad rows were not credited |
| 36 | mantis shrimp | Y? | Credited as consolidated under one "shrimp"; prawns and galeras not distinguished |
| 42 | breaded fried fish fillet | n? | "fried chicken" has the breaded-fried class right, species wrong — and the fillet's species is genuinely hard to read in this photo |
| 43 | breaded croquettes with aioli | Y? | "tater tots"/"potato hash" — right class of fried breaded patty, wrong filling, mayo topping unnamed |
| 43 | green beans | n? | A distinct pile of whole green beans; "mixed greens" more plausibly the leaf salad, so no credit |
| 43 | quiche/gratin square | Y? | "fried egg" most plausibly refers to this egg-set cheese-topped square — a generous read |
| 44 | stewed meat in onion gravy | Y? | Browned skin-on piece could genuinely be chicken, but it is stewed in gravy, not grilled |
| 45 | grilled mackerel | Y? | "fish cake" names a fish item but fits the jeon platter equally; grilled whole fish reported as a processed cake |
| 47 | trap classification | ? | The three invented bagel/salmon items are most likely read off the printed menu cards under the plates — counted as hallucinations, but arguably trap leaks |

## Findings

1. **Recall 63.0% (148/235), 13 hallucinations, 1 trap leak.** Simple 2–5-item plates score near-perfectly (03: 8/8, 07: 5/5, 24: 4/4, 36: 4/4); dense multi-component plates collapse (26: 2/8, 28: 2/8, 35: 2/8, 45: 3/8, 43: 3/7). The model names ~4.8 items per plate regardless of how many are on the plate, so recall is essentially capped by output length on anything complex.
2. **"grilled chicken breast" is a default hallucination filler.** It appears on 9 plates (11, 15, 28, 29, 30, 35, 43×2, 44, 48) and is correct on none of them — standing in for schnitzel, Weisswurst, falafel, döner meat, croquettes, stewed meat, samosas, and once (29) for nothing at all. Any nutrition mapping downstream would systematically substitute lean poultry for breaded/fried/fatty items.
3. **Condiments, sauces and dips are almost never reported** — missed on 04 (ketchup), 06 (soy, ginger), 15 (mustard), 17 (curry ketchup + powder), 19 (mayo), 23 (green chile), 25 (syrup), 32 (hummus), 34 (compote), 35 (tzatziki), 41 (tartar), 42 (sour cream), 50 (chili sauce). This single class accounts for roughly a quarter of all misses.
4. **Two degenerate-output failures.** Image 32 emitted 27 items that are 8 distinct names looped, while missing the four richest compartments (eggs, hummus, salami, cheese); image 46 invented four dim-sum-adjacent foods and missed the entire curried-tripe majority of the basket. Both suggest the model latches onto the first few confidently-recognised textures and then repeats or confabulates.
5. **Traps were mostly survived**: background second plates (12, 25, 50), off-plate flatbread (35), empty Korean tableware (45), napkin text (41), and the eaten-breakfast plate (39) all produced no leaks. The two failures are text-driven — the Jamaica Blue promo banner ("Viva la Mexicana", 10) and, probably, the printed menu cards in 47.
