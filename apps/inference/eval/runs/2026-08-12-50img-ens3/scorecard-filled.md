# Plate-identification scoring worksheet — FILLED

- results: `runs/2026-08-12-50img-ens3/results.json`
- config: `local-cpu` (started 2026-08-12T12:36:45.775808+00:00)
- approaches: ensemble_lfm
- images: 50
- host: bluefin, AMD Ryzen 9 7940HS w/ Radeon 780M Graphics, 16 threads, 62053 MB RAM
- fan-out override: 3
- scored: 2026-08-12, by direct image inspection of all 50 photos (downscaled copies of `images/NN.jpg`)

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

## Scoring conventions used

- `Y` = gold item covered (synonym or reasonable consolidation counts; granularity loss noted).
- `n` = missed. `Y?` / `n?` = judgment call for the architect to adjudicate.
- **Hallucination** = reported food not visible in the photo at all. Optional-list items and
  visible-but-not-gold items are ignored (neither hit nor hallucination).
- **Trap leak** = an item the gold `trap` field explicitly forbids (background plate, menu poster,
  unserved staple) that was nonetheless reported.
- **Dedup fail** = the same real food appearing twice in the merged ensemble list under
  trivially-equivalent names.

### 01 — Continental/English-style breakfast plate

- **ensemble_lfm**: sliced bread, ham, beef stew, scrambled eggs, cucumber slices, Baked beans

| gold core item | ensemble_lfm | notes |
|---|---|---|
| scrambled eggs | Y |  |
| bacon/ham slices | Y | "ham" |
| frankfurter sausages | n | the two red frankfurters were not named |
| baked beans in tomato sauce | Y |  |
| brown bread slice | Y | "sliced bread" — granularity loss (bread is dark rye) |
| cucumber slices | Y |  |
| **core recall (/6)** | 5 |  |
| **hallucinations** | beef stew |  |

Recall: 5/6
Hallucinations: beef stew
Trap leaks: none
Dedup fails: none

Optional (no recall credit): butter/margarine packets

### 02 — Roast (Sunday) dinner

- **ensemble_lfm**: Roast chicken, Roast pork belly, Roast potatoes, Broccoli, Beef, Potatoes

| gold core item | ensemble_lfm | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y | "Beef" |
| Yorkshire pudding | n | the crisp cup at the top was called "Roast pork belly" |
| roast potatoes | Y |  |
| broccoli | Y |  |
| cabbage/greens | n | savoy cabbage under the meat not named |
| **core recall (/5)** | 3 |  |
| **hallucinations** | Roast chicken, Roast pork belly |  |

Recall: 3/5
Hallucinations: Roast chicken, Roast pork belly
Trap leaks: none
Dedup fails: Roast potatoes / Potatoes

Optional (no recall credit): gravy as separate item

### 03 — Greek-style salad with grilled salmon

- **ensemble_lfm**: Grilled Salmon, Lemon Wedge, Olives, Cucumbers, Avocado, Red Onion

| gold core item | ensemble_lfm | notes |
|---|---|---|
| grilled salmon fillets | Y |  |
| feta cheese | n | abundant feta cubes, not named |
| kalamata olives | Y | "Olives" |
| avocado | Y |  |
| cherry tomatoes | n |  |
| cucumber | Y |  |
| lettuce/romaine | n |  |
| red onion | Y |  |
| **core recall (/8)** | 5 |  |
| **hallucinations** | none |  |

Recall: 5/8
Hallucinations: none
Trap leaks: none
Dedup fails: none

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04 — Cheeseburger with fries

- **ensemble_lfm**: cheeseburger, french fries, pickle, mustard, Grilled chicken breast, Ketchup

| gold core item | ensemble_lfm | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y |  |
| thick-cut fries/steak fries | Y |  |
| ketchup | Y |  |
| pickles/gherkins | Y | "pickle" |
| **core recall (/4)** | 4 |  |
| **hallucinations** | Grilled chicken breast |  |

Recall: 4/4
Hallucinations: Grilled chicken breast
Trap leaks: none
Dedup fails: none
Note: "mustard" — a pale yellow sauce is visible on the bun; visible-but-not-gold, ignored.

Optional (no recall credit): lettuce in burger, beer in background

### 05 — Chicken in creamy leafy-green sauce with white rice

- **ensemble_lfm**: Rice, Chicken, Green Sauce, Spinach, Mushrooms, Chicken

| gold core item | ensemble_lfm | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | covered across Chicken + Green Sauce + Spinach |
| white rice | Y |  |
| **core recall (/2)** | 2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none
Trap leaks: none
Dedup fails: Chicken / Chicken (literal duplicate in the merged list)
Note: "Mushrooms" — pale chunks in the sauce read as mushroom; visible-but-not-gold, ignored.

Optional (no recall credit): red bell pepper bits in rice

### 06 — Sushi platter (restaurant table)

- **ensemble_lfm**: Sushi roll, Raw fish

| gold core item | ensemble_lfm | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | "Sushi roll" |
| tuna nigiri | Y | consolidated into "Raw fish" — species and the rice base both lost |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | Y | same single "Raw fish" token covers both nigiri rows |
| pickled ginger | n |  |
| wasabi | n |  |
| soy sauce | n |  |
| **core recall (/6)** | 3 |  |
| **hallucinations** | none |  |

Recall: 3/6
Hallucinations: none
Trap leaks: none
Dedup fails: none

Optional (no recall credit): white wine / water glasses in background

### 07 — Spaghetti with meat-vegetable sauce

- **ensemble_lfm**: spaghetti, ground beef, corn kernels, green beans, carrots

| gold core item | ensemble_lfm | notes |
|---|---|---|
| spaghetti | Y |  |
| ground beef/meat tomato sauce | Y |  |
| corn kernels | Y |  |
| green beans | Y |  |
| carrot pieces | Y |  |
| **core recall (/5)** | 5 |  |
| **hallucinations** | none |  |

Recall: 5/5
Hallucinations: none
Trap leaks: none
Dedup fails: none

### 08 — Yogurt granola bowl with apple

- **ensemble_lfm**: yogurt, granola, apple slices

| gold core item | ensemble_lfm | notes |
|---|---|---|
| yogurt | Y |  |
| granola (oats/puffed grains, nuts) | Y |  |
| apple slices | Y |  |
| **core recall (/3)** | 3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none
Dedup fails: none

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09 — Whole chicken pizza in delivery box

- **ensemble_lfm**: Pizza, Coke

| gold core item | ensemble_lfm | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | toppings not broken out |
| **core recall (/1)** | 1 |  |
| **hallucinations** | none |  |

Recall: 1/1
Hallucinations: none
Trap leaks: none
Dedup fails: none
Note: a dark cola cup is visible at the right edge — optional, no credit, not a hallucination.

Optional (no recall credit): cola drink at table edge

### 10 — Club sandwich with side salad (cafe table)

- **ensemble_lfm**: grilled chicken breast, side salad, Pepsi Max, Sandwich, Salad, Coke

| gold core item | ensemble_lfm | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | "Sandwich" |
| green side salad (rocket/mixed leaves) | Y | "side salad"/"Salad" |
| **core recall (/2)** | 2 |  |
| **hallucinations** | grilled chicken breast, Coke |  |

Recall: 2/2
Hallucinations: grilled chicken breast, Coke
Trap leaks: none (menu poster dishes — burrito/quesadilla/fritter — were not reported)
Dedup fails: side salad / Salad
Note: the only bottle on the table is Pepsi Max; "Coke" names a drink that isn't there (and double-counts the same bottle).

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11 — Wiener Schnitzel with fries and side salad

- **ensemble_lfm**: Breaded chicken cutlet, French fries, Salad, grilled chicken breast, Crispy breaded fish fillet, Lemon wedge

| gold core item | ensemble_lfm | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | Y | "Breaded chicken cutlet" — meat species wrong, dish class right |
| thick-cut fries/potato wedges | Y |  |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | "Salad" |
| **core recall (/3)** | 3 |  |
| **hallucinations** | grilled chicken breast, Crispy breaded fish fillet |  |

Recall: 3/3
Hallucinations: grilled chicken breast, Crispy breaded fish fillet
Trap leaks: none
Dedup fails: none counted — but note the one schnitzel got three mutually inconsistent names (breaded chicken cutlet / grilled chicken breast / breaded fish fillet); scored as 2 hallucinations rather than dedup because the names are not equivalent.

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass

### 12 — Bratwurst plate with sauerkraut and mashed potatoes

- **ensemble_lfm**: Sausages, Potatoes, Cabbage, Kraut, Yellow mashed potatoes, Side salad

| gold core item | ensemble_lfm | notes |
|---|---|---|
| bratwurst sausages | Y |  |
| sauerkraut | Y | "Kraut"/"Cabbage" |
| mashed potatoes | Y |  |
| **core recall (/3)** | 3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: Side salad (the carrot-cabbage salad + cucumber on the SECOND plate top-left, per gold trap)
Dedup fails: Potatoes / Yellow mashed potatoes; Cabbage / Kraut

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13 — Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **ensemble_lfm**: Fettuccine Alfredo, Grilled Onions, Caramelized Onions, Salad

| gold core item | ensemble_lfm | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y? | "Fettuccine Alfredo" — wrong dish name/cuisine, but does capture noodles in a melted-cheese/cream sauce |
| fried/caramelised onions | Y |  |
| **core recall (/2)** | 2 (1 flagged) |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none (no meat/bacon invented — the classic trap for this plate was avoided)
Trap leaks: none (the background lettuce plate is explicitly acceptable-but-optional)
Dedup fails: Grilled Onions / Caramelized Onions

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion, parsley garnish

### 14 — Beef gulasch with boiled potatoes and a side bowl of lettuce

- **ensemble_lfm**: Potatoes, Chicken, Lettuce, Sauce

| gold core item | ensemble_lfm | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | n | meat called "Chicken"; only the gravy ("Sauce") is right — dark beef chunks are unmistakable |
| boiled potatoes | Y |  |
| green leaf lettuce (butterhead) in a separate glass bowl | Y |  |
| **core recall (/3)** | 2 |  |
| **hallucinations** | Chicken |  |

Recall: 2/3
Hallucinations: Chicken
Trap leaks: none
Dedup fails: none

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15 — Bavarian Weisswurst breakfast

- **ensemble_lfm**: Gerbüste, Mustard, Pretzel, Sausages in soup, Bread

| gold core item | ensemble_lfm | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y | "Sausages in soup" |
| pretzel (Brezel) | Y |  |
| sweet mustard | Y |  |
| **core recall (/3)** | 3 |  |
| **hallucinations** | Gerbüste (?), Bread (?) |  |

Recall: 3/3
Hallucinations: Gerbüste (?) — garbled non-word, no such food on the tray; Bread (?) — no bread other than the already-named pretzel
Trap leaks: none
Dedup fails: none counted (Bread scored as a hallucination rather than a pretzel duplicate — flagged for adjudication)

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16 — Döner/gyros plate with fries and salad

- **ensemble_lfm**: French fries, Döner meat, Salad, Red sauce, Bread, Beverage

| gold core item | ensemble_lfm | notes |
|---|---|---|
| döner/gyros sliced meat | Y |  |
| tomato sauce over the meat | Y | "Red sauce" |
| French fries | Y |  |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | "Salad" — components not broken out |
| **core recall (/4)** | 4 |  |
| **hallucinations** | Bread |  |

Recall: 4/4
Hallucinations: Bread (nothing bread-like on the steel tray)
Trap leaks: none
Dedup fails: none
Note: "Beverage" — beer glass/bottle visible; ignored.

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17 — Currywurst with French fries

- **ensemble_lfm**: French fries, Sausage, Ketchup

| gold core item | ensemble_lfm | notes |
|---|---|---|
| currywurst (sausage) | Y |  |
| curry ketchup sauce | Y | "Ketchup" |
| curry powder | n | the visible curry dusting was not named |
| French fries | Y |  |
| **core recall (/4)** | 3 |  |
| **hallucinations** | none |  |

Recall: 3/4
Hallucinations: none
Trap leaks: none
Dedup fails: none

### 18 — Swabian Maultaschen with potato salad

- **ensemble_lfm**: Pasta, Pork dumplings, Green herbs (chives, parsley)

| gold core item | ensemble_lfm | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "Pork dumplings" (+ probably "Pasta") |
| potato salad | n | the bacon-flecked potato salad bed was not named |
| **core recall (/2)** | 1 |  |
| **hallucinations** | none |  |

Recall: 1/2
Hallucinations: none
Dedup fails: Pasta / Pork dumplings (?) — both most plausibly name the same Maultaschen; flagged because "Pasta" could conceivably have been aimed at the side
Trap leaks: none

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19 — German fast-food mixed plate (Taxiteller)

- **ensemble_lfm**: French fries, Mayo, German sausages, Pork Chops, Sausage, Yogurt sauce

| gold core item | ensemble_lfm | notes |
|---|---|---|
| French fries | Y |  |
| gyros/döner sliced meat | Y? | only "Pork Chops" maps to the dark sliced meat — wrong cut name for shaved gyros |
| sliced sausage in curry/shashlik sauce | Y | "German sausages"/"Sausage" + the sauce implied |
| tzatziki/garlic yogurt sauce | Y | "Yogurt sauce" |
| mayonnaise | Y | "Mayo" |
| **core recall (/5)** | 5 (1 flagged) |  |
| **hallucinations** | none |  |

Recall: 5/5
Hallucinations: none (Pork Chops credited as the gyros meat rather than counted as invented — flagged)
Trap leaks: none
Dedup fails: German sausages / Sausage

### 20 — Bowl of shio ramen

- **ensemble_lfm**: Ramen noodles, Tofu slices, Thinly sliced pork, Chopped arugula, Greens, Meat

| gold core item | ensemble_lfm | notes |
|---|---|---|
| ramen noodles | Y |  |
| clear (shio) broth | n | the broth itself was never named |
| sliced chashu pork | Y | "Thinly sliced pork" |
| leafy green herb topping (mizuna/mitsuba) | Y | "Chopped arugula"/"Greens" — species wrong, class right |
| **core recall (/4)** | 3 |  |
| **hallucinations** | Tofu slices |  |

Recall: 3/4
Hallucinations: Tofu slices (the white slices are the chashu pork — no tofu in the bowl)
Trap leaks: none
Dedup fails: Thinly sliced pork / Meat; Chopped arugula / Greens

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21 — Vietnamese pho with a side plate of herb garnishes

- **ensemble_lfm**: Pho, meat, vegetables

| gold core item | ensemble_lfm | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y | "Pho" |
| sliced beef and beef meatballs | Y | "meat" — cut/meatball distinction lost |
| bean sprouts | n | a bare "vegetables" token cannot stand in for four distinct garnish rows |
| Thai basil | n | as above |
| sliced green chilli/jalapeño | n | as above |
| spring onion | n | as above |
| **core recall (/6)** | 2 |  |
| **hallucinations** | none |  |

Recall: 2/6
Hallucinations: none
Trap leaks: none
Dedup fails: none

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22 — Three soft tacos with a corn cob

- **ensemble_lfm**: corn on the cob, tacos, beans, sauce, tortilla shells

| gold core item | ensemble_lfm | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y | "tacos" |
| grated cheese | n | visible grated cheese not named |
| red salsa | Y | "sauce" |
| green salsa/tomatillo | n | the single generic "sauce" cannot cover both salsas |
| coriander/cilantro | n |  |
| grilled corn on the cob | Y |  |
| **core recall (/6)** | 3 |  |
| **hallucinations** | beans |  |

Recall: 3/6
Hallucinations: beans (the filling is seasoned ground beef; no beans on the plate)
Trap leaks: none
Dedup fails: tacos / tortilla shells

Optional (no recall credit): glass of cola

### 23 — Smothered beef burrito

- **ensemble_lfm**: burrito, Shredded Cheese, Tomato, Lettuce

| gold core item | ensemble_lfm | notes |
|---|---|---|
| burrito (flour tortilla) | Y |  |
| green chile sauce | n | the whole plate is flooded with it |
| shredded cheddar/jack cheese | Y |  |
| shredded lettuce | Y |  |
| **core recall (/4)** | 3 |  |
| **hallucinations** | none |  |

Recall: 3/4
Hallucinations: none
Trap leaks: none
Dedup fails: none

Optional (no recall credit): diced tomato

### 24 — Fish and chips with peas

- **ensemble_lfm**: grilled chicken breast, side salad, lemon wedge, french fries, peas, potatoes

| gold core item | ensemble_lfm | notes |
|---|---|---|
| battered fried fish fillet | n | the plate's dominant item, called "grilled chicken breast" |
| chips/thick-cut fries | Y |  |
| green peas | Y |  |
| tartar sauce | n | the ramekin of tartare was not named |
| **core recall (/4)** | 2 |  |
| **hallucinations** | grilled chicken breast, side salad |  |

Recall: 2/4
Hallucinations: grilled chicken breast, side salad (no leaves anywhere on the plate)
Trap leaks: none
Dedup fails: french fries / potatoes

Optional (no recall credit): lemon wedge

### 25 — American breakfast platter

- **ensemble_lfm**: pancakes, scrambled eggs, bacon, sausage, fried egg, toast

| gold core item | ensemble_lfm | notes |
|---|---|---|
| pancakes with icing sugar | Y |  |
| back bacon rashers | Y |  |
| fried egg (sunny side up) | Y |  |
| breakfast sausages | Y |  |
| hash brown/potato croquettes | n | two croquettes clearly visible |
| toast slices | Y |  |
| maple syrup in a shot glass | n |  |
| **core recall (/7)** | 5 |  |
| **hallucinations** | scrambled eggs |  |

Recall: 5/7
Hallucinations: scrambled eggs (the only egg is the fried one, also reported)
Trap leaks: none (the background plate's sandwich + salad were not claimed)
Dedup fails: none counted — "scrambled eggs" and "fried egg" describe the same egg, but the names are not equivalent, so it is scored as a hallucination

Optional (no recall credit): butter packet

### 26 — Indian thali on a steel tray

- **ensemble_lfm**: Rice, Lentils, Paneer, Tortilla, Couscous, Vegetable Curry

| gold core item | ensemble_lfm | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | "Rice" |
| chapati/roti | Y | "Tortilla" |
| papad (papadum) | n | the crisp triangles beside the roti were not distinguished |
| curd/raita | n | the white bowl top-left |
| dal (lentil curry) | Y | "Lentils" |
| kofta/dumpling curry in orange gravy | n |  |
| paneer or fish curry in pale gravy | Y | "Paneer" |
| brinjal/eggplant curry | Y? | credited to "Vegetable Curry" — the dark right-hand bowl is the only vegetable curry left unclaimed |
| **core recall (/8)** | 5 (1 flagged) |  |
| **hallucinations** | Couscous |  |

Recall: 5/8
Hallucinations: Couscous (no couscous on the tray)
Trap leaks: none
Dedup fails: none

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27 — Stir-fried chicken with peppers and steamed rice

- **ensemble_lfm**: grilled chicken breast, onions, red bell peppers, rice, chicken, bell pepper

| gold core item | ensemble_lfm | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y | "chicken" |
| red bell pepper strips | Y |  |
| onion | Y |  |
| spring onion/green onion | n | green stalks throughout the stir-fry, not named |
| steamed white rice | Y |  |
| **core recall (/5)** | 4 |  |
| **hallucinations** | none |  |

Recall: 4/5
Hallucinations: none ("grilled chicken breast" is a mislabel of the stir-fried chicken that is present, not an invented food)
Trap leaks: none
Dedup fails: grilled chicken breast / chicken; red bell peppers / bell pepper

Optional (no recall credit): dried chilli bits

### 28 — Middle-Eastern mezze spread — four composed plates plus flatbread

- **ensemble_lfm**: Grilled chicken breast, Side salad, Pita bread, Crackers, Olives, Yogurt

| gold core item | ensemble_lfm | notes |
|---|---|---|
| falafel balls | n | a falafel ball sits on every plate |
| grilled flatbread | Y | "Pita bread" |
| hummus/creamy white dip | Y? | credited to "Yogurt" — right object (the white creamy dip), wrong dairy/legume call |
| green herb-chilli sauce | n | two ramekins of it |
| yellow bulgur or couscous | n |  |
| black beluga lentils | n |  |
| pickled white cabbage slaw | n |  |
| green olives | Y | "Olives" |
| **core recall (/8)** | 3 (1 flagged) |  |
| **hallucinations** | Grilled chicken breast |  |

Recall: 3/8
Hallucinations: Grilled chicken breast (no meat anywhere on the tray)
Trap leaks: none
Dedup fails: none
Note: "Crackers" and "Side salad" are both visible (herb crackers, salsa/carrot salads) — ignored.

Optional (no recall credit): pickled turnip, diced beetroot, tomato/pepper salsa, grated carrot salad, pomegranate, parsley, sesame, water glass

### 29 — Tapas/snack flight with a wheat beer

- **ensemble_lfm**: Pickles, Sliced Salami, Cheese Cubes, Olives

| gold core item | ensemble_lfm | notes |
|---|---|---|
| pickled gherkin slices | Y |  |
| salami slices | Y |  |
| cheese cubes | Y |  |
| green olives | Y |  |
| **core recall (/4)** | 4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: none
Dedup fails: none

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30 — Mixed grill board (plancha de grillades)

- **ensemble_lfm**: baked potato, grilled chicken breast, grilled pork chop, steak, salad

| gold core item | ensemble_lfm | notes |
|---|---|---|
| pork spare ribs slab | Y? | credited to "grilled pork chop" — right object (the herbed pork slab), wrong cut |
| grilled beef steak | Y | "steak" |
| grilled sausage | n | the pink sausage was not named |
| grilled meat skewer with green pepper and tomato | n | skewer not identified as such |
| baked/roasted potato with browned cheese topping | Y | "baked potato" |
| mixed leaf salad | Y | "salad" |
| **core recall (/6)** | 4 (1 flagged) |  |
| **hallucinations** | none |  |

Recall: 4/6
Hallucinations: none — "grilled chicken breast" is not counted: the pale skewered/adjacent meat cubes are plausibly poultry (flagged)
Trap leaks: none
Dedup fails: none

Optional (no recall credit): cherry tomato, steak knife

### 31 — Bowl of beef/oxtail soup with buttered bread

- **ensemble_lfm**: Beef stew, grilled beef stew, white bread toast, Butter, Toast, Parsley

| gold core item | ensemble_lfm | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y | "Beef stew" |
| beef (oxtail) chunks | Y |  |
| buttered bread slices (dark/whole-grain) | Y | "white bread toast"/"Toast" + "Butter" — bread colour wrong |
| **core recall (/3)** | 3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none
Dedup fails: Beef stew / grilled beef stew; white bread toast / Toast

Optional (no recall credit): parsley garnish, butter as separate item

### 32 — Charcuterie/snack board (compartmented bamboo tray, top-down)

- **ensemble_lfm**: grilled chicken breast, side salad, carrot sticks, yellow bell pepper strips, red bell pepper strips, cucumber slices

| gold core item | ensemble_lfm | notes |
|---|---|---|
| green olives | n | olives line the whole top row |
| cucumber sticks | Y | "cucumber slices" |
| carrot sticks | Y |  |
| bell pepper strips | Y | yellow + red both named |
| pan-fried spiced hard-boiled egg halves | n | the whole bottom-left compartment |
| hummus dip | n | the heart-shaped bowl in the middle |
| salami/cured meat slices | n |  |
| cheese slices | n |  |
| **core recall (/8)** | 3 |  |
| **hallucinations** | grilled chicken breast, side salad |  |

Recall: 3/8
Hallucinations: grilled chicken breast, side salad (no meat and no leaves on the board)
Trap leaks: none
Dedup fails: none (yellow and red pepper strips are genuinely two separate items on the tray)

Optional (no recall credit): herb crackers, paper liner (non-food)

### 33 — Bowl of oatmeal porridge with toppings

- **ensemble_lfm**: oatmeal, milk, cinnamon, raisins

| gold core item | ensemble_lfm | notes |
|---|---|---|
| oatmeal/oat porridge | Y |  |
| peanut butter | n | the large peanut-butter scoop in the middle |
| raisins | Y |  |
| ground cinnamon | Y |  |
| milk | Y |  |
| **core recall (/5)** | 4 |  |
| **hallucinations** | none |  |

Recall: 4/5
Hallucinations: none
Trap leaks: none
Dedup fails: none

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34 — Waffles with strawberries and whipped cream

- **ensemble_lfm**: waffles, strawberries, whipped cream

| gold core item | ensemble_lfm | notes |
|---|---|---|
| waffles | Y |  |
| strawberries (sliced fresh) | Y |  |
| strawberry/berry syrup-compote | n | heavy red compote over everything, not distinguished from the fresh fruit |
| whipped cream | Y |  |
| **core recall (/4)** | 3 |  |
| **hallucinations** | none |  |

Recall: 3/4
Hallucinations: none
Trap leaks: none
Dedup fails: none

Optional (no recall credit): orange juice glass at top edge

### 35 — Gyros/döner plate with fries and salad

- **ensemble_lfm**: Grilled Chicken Breast, Side Salad, Fries, Tomato, Lettuce, Corn

| gold core item | ensemble_lfm | notes |
|---|---|---|
| gyros/döner sliced meat | n | the dark shaved meat mound was called "Grilled Chicken Breast" |
| French fries | Y |  |
| white garlic-yogurt sauce (tzatziki) with oregano | n | the oregano-dusted white sauce on the meat |
| shredded white cabbage | n? | "Lettuce" more plausibly names the green leaves (gold-optional) than the white cabbage bed |
| tomato slices | Y |  |
| sweetcorn | Y | "Corn" |
| cucumber slices | n |  |
| shredded carrot | n |  |
| **core recall (/8)** | 3 (1 flagged) |  |
| **hallucinations** | Grilled Chicken Breast |  |

Recall: 3/8
Hallucinations: Grilled Chicken Breast
Trap leaks: none (the off-plate flatbread basket was not claimed)
Dedup fails: none

Optional (no recall credit): pickled green chili, black olive, lettuce leaves, flatbread basket at right edge

### 36 — Seafood paella in the pan

- **ensemble_lfm**: grilled chicken breast, rice, shrimp, artichoke, lemon wedge, dusting of herbs

| gold core item | ensemble_lfm | notes |
|---|---|---|
| saffron/paella rice | Y | "rice" — saffron/paella framing lost |
| whole prawns (langostinos) | Y | "shrimp" |
| mantis shrimp (galeras) | n | the elongated galeras are a distinct item; one "shrimp" token cannot cover both |
| artichoke pieces | Y |  |
| **core recall (/4)** | 3 |  |
| **hallucinations** | grilled chicken breast, lemon wedge |  |

Recall: 3/4
Hallucinations: grilled chicken breast, lemon wedge (no chicken and no lemon in the pan)
Trap leaks: none
Dedup fails: none

Optional (no recall credit): red pepper/tomato bits in the rice

### 37 — Pierogi ruskie with carrot-cabbage salad

- **ensemble_lfm**: dumplings, grilled chicken breast, side salad, purple sprouts

| gold core item | ensemble_lfm | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y | "dumplings" |
| fried caramelised onion topping | n | the golden onion topping on every pierogi |
| grated carrot and cabbage salad | Y | "side salad" |
| **core recall (/3)** | 2 |  |
| **hallucinations** | grilled chicken breast |  |

Recall: 2/3
Hallucinations: grilled chicken breast
Trap leaks: none
Dedup fails: none

Optional (no recall credit): radish/beet sprouts garnish

### 38 — Half-eaten beefburger with fries

- **ensemble_lfm**: burger, fries

| gold core item | ensemble_lfm | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y |  |
| French fries | Y |  |
| **core recall (/2)** | 2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none
Trap leaks: none
Dedup fails: none

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39 — Remains of a fried breakfast (mostly eaten)

- **ensemble_lfm**: baked beans, bacon, ham

| gold core item | ensemble_lfm | notes |
|---|---|---|
| baked beans in tomato sauce | Y |  |
| sausage pieces | n | two browned sausage stubs remain, unnamed |
| bacon rasher | Y |  |
| **core recall (/3)** | 2 |  |
| **hallucinations** | none |  |

Recall: 2/3
Hallucinations: none — importantly it did NOT invent eggs/toast/tomato/mushrooms on the smeared plate (the gold trap)
Trap leaks: none
Dedup fails: bacon / ham (one rasher, two near-synonymous names)

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40 — Half-eaten liver-and-bacon fry-up with chips

- **ensemble_lfm**: beef stew, grilled ham, fried potatoes, egg

| gold core item | ensemble_lfm | notes |
|---|---|---|
| liver pieces in gravy | Y? | "beef stew" — right object (dark meat in gravy), wrong organ/animal |
| chips/French fries | Y | "fried potatoes" |
| bacon/gammon slice | Y | "grilled ham" |
| fried egg (remnant, yolk visible) | Y | "egg" |
| sausage | n | the sausage at the left edge was not named |
| grilled tomato half | n | the charred tomato half top-right |
| **core recall (/6)** | 4 (1 flagged) |  |
| **hallucinations** | none |  |

Recall: 4/6
Hallucinations: none
Trap leaks: none
Dedup fails: none

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41 — Leftovers of battered fish and potato wedges

- **ensemble_lfm**: Grilled chicken breast, Roasted potatoes, Ham hock, Black pepper, Mayonnaise, Fried fish

| gold core item | ensemble_lfm | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten | Y | "Fried fish" |
| potato wedges/skin-on roast potatoes | Y | "Roasted potatoes" |
| tartar sauce / mayonnaise dollop | Y | "Mayonnaise" |
| **core recall (/3)** | 3 |  |
| **hallucinations** | Grilled chicken breast, Ham hock |  |

Recall: 3/3
Hallucinations: Grilled chicken breast, Ham hock (only fish and potato on the plate)
Trap leaks: none — "Black pepper" refers to pepper actually visible on the food (and in sachets), so it is not a napkin/sachet-text leak
Dedup fails: none

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42 — Buffet lunch plate (many components)

- **ensemble_lfm**: baked fish, rice, cabbage slaw, corn, chicken curry, potatoes

| gold core item | ensemble_lfm | notes |
|---|---|---|
| breaded fried fish fillet | Y | "baked fish" — cooking method wrong |
| sour cream / remoulade dollop | n | the large white dollop on the fish |
| meatballs in brown gravy | n | the meatballs at the top of the plate |
| chickpea-and-cauliflower curry | Y? | credited to "chicken curry" — right dish region and colour, but there is no chicken in it |
| white rice | Y |  |
| red cabbage and sweetcorn salad | Y | "cabbage slaw" + "corn" |
| cucumber and lettuce salad | n |  |
| **core recall (/7)** | 4 (1 flagged) |  |
| **hallucinations** | potatoes |  |

Recall: 4/7
Hallucinations: potatoes (nothing potato on the plate)
Trap leaks: none
Dedup fails: none

Optional (no recall credit): tomato-sauced bake at the back, water glass, pickled red onion, green chili

### 43 — Buffet lunch set — main plate, soup bowl, bread plate

- **ensemble_lfm**: Crispy fried chicken, Creamy grits, Bacon bits, Pork Chops, Sausage, Buttermilk Biscuit

| gold core item | ensemble_lfm | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y? | credited to "Crispy fried chicken" — right object (two breaded patties), wrong protein |
| herbed green rice | n |  |
| green beans | n | a clear pile of green beans at the top of the plate |
| cheese-topped quiche/gratin square | n |  |
| creamy meat-and-vegetable stew | n | the creamy stew on the right of the plate |
| creamy soup (bowl, with bacon bits) | Y | "Creamy grits" + "Bacon bits" — the bacon-flecked soup bowl |
| bread roll with butter | Y | "Buttermilk Biscuit" — buttered roll, US naming |
| **core recall (/7)** | 3 (1 flagged) |  |
| **hallucinations** | Pork Chops, Sausage |  |

Recall: 3/7
Hallucinations: Pork Chops, Sausage (neither is on the table)
Trap leaks: none
Dedup fails: none

Optional (no recall credit): coleslaw, lemon wedge, green olives, water glass

### 44 — Brazilian buffet lunch plate (top-down)

- **ensemble_lfm**: grilled chicken breast, mixed leaves, tomato, cucumber, rice, bean salad, sauce or dressing

| gold core item | ensemble_lfm | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | "mixed leaves" |
| brown beans (feijão) in broth | Y | "bean salad" — dish type wrong (stewed, not salad) |
| yellow seasoned rice | Y | "rice" |
| braised cabbage with tomato | n | the large braised-cabbage area was not named |
| stewed meat in onion gravy | Y? | credited to "grilled chicken breast" — the browned meat piece in gravy at the left; cooking method wrong |
| mashed cassava/potato purée | n |  |
| **core recall (/6)** | 4 (1 flagged) |  |
| **hallucinations** | cucumber (?) |  |

Recall: 4/6
Hallucinations: cucumber (?) — the salad reads as lettuce/carrot/coriander; no cucumber found at this resolution (flagged)
Trap leaks: none
Dedup fails: none

Optional (no recall credit): cutlery and placemat (non-food)

### 45 — Korean hanjeongsik table spread (dozens of banchan, top-down)

- **ensemble_lfm**: grilled chicken breast, tofu, beef, eggplant, cucumber, rice

| gold core item | ensemble_lfm | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | n |  |
| steamed egg (gyeranjjim) in stone pot | n |  |
| grilled mackerel/fish | n |  |
| stir-fried beef in a hot stone pot | Y | "beef" |
| glazed spicy braised ribs/pork | n |  |
| sliced raw fish (hoe/sashimi) on shredded radish | n |  |
| vegetable fritters/jeon platter | Y? | credited to "eggplant" — the top-right pot of battered courgette/aubergine jeon |
| kimchi | n | at least two kimchi dishes visible |
| **core recall (/8)** | 2 (1 flagged) |  |
| **hallucinations** | grilled chicken breast |  |

Recall: 2/8
Hallucinations: grilled chicken breast (no chicken dish on the table)
Trap leaks: rice — the gold trap explicitly calls out naming rice that isn't served; the rice bowls in frame are empty tableware
Dedup fails: none
Note: "tofu" and "cucumber" both correspond to real gold-optional dishes (tofu slabs, pickled cucumber/chilli) — ignored.

Optional (no recall credit): tofu slices, creamy soup/porridge pot, perilla-wrapped pickles, namul, lotus root, pickled cucumber/radish, chilli peppers with paste, spring onion salad, seasoned beans, mushroom-noodle soup, dipping bowls, empty tableware

### 46 — Hong Kong steamer basket of small offal dishes (dai pai dong)

- **ensemble_lfm**: grilled chicken breast, fried tofu, pork belly, beef, chicken

| gold core item | ensemble_lfm | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y? | credited to "beef" — the yellow honeycomb tripe is beef offal, but the tripe/offal nature is lost |
| white boiled tripe/omasum slices in broth | n? | "pork belly" is the nearest token and it names the wrong animal and wrong cut for the pale ruffled omasum |
| fried beancurd-skin rolls (tofu skin rolls) | Y | "fried tofu" |
| **core recall (/3)** | 2 (2 flagged) |  |
| **hallucinations** | grilled chicken breast, chicken |  |

Recall: 2/3
Hallucinations: grilled chicken breast, chicken (no poultry in the steamer)
Trap leaks: none — it did NOT report siu mai / har gow / dumplings / buns (the gold trap)
Dedup fails: none counted (both chicken tokens are hallucinations, not duplicate namings of a real food — though they are the same phantom item twice)

Optional (no recall credit): carrot/vegetable pieces in the broth cups, steamer basket, tongs, cloth (non-food)

### 47 — Café brunch table spread (top-down)

- **ensemble_lfm**: Avocado toast, Bagel with cream cheese, Eggs Benedict, Grilled chicken breast, Fruit salad, Smoothie

| gold core item | ensemble_lfm | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | "Avocado toast" |
| eggs benedict with hollandaise on avocado toast | Y | "Eggs Benedict" |
| yogurt bowl with granola, kiwi slices and berry compote | Y? | credited to "Fruit salad" — right bowl, but yogurt/granola/compote structure lost |
| cherry tomato salad with balsamic drizzle | n | the tomato rows on two plates |
| seeded bagel (dark, sesame-topped) | Y | "Bagel with cream cheese" — the bagel is real; cream cheese is not visible |
| **core recall (/5)** | 4 (1 flagged) |  |
| **hallucinations** | Grilled chicken breast |  |

Recall: 4/5
Hallucinations: Grilled chicken breast
Trap leaks: none — the reported bagel is physically on the table, not merely on the printed menu cards; croissant/goulash/macarons from the menu were not reported
Dedup fails: none
Note: "Smoothie" plausibly names the orange drink in frame — visible, ignored.

Optional (no recall credit): beetroot latte, iced coffee, orange drink, wine glass, microgreens

### 48 — Disposable plate of party snacks (partly eaten)

- **ensemble_lfm**: Crispy potato chips, Sandwich (white bread), Steamed egg, Steamed shrimp

| gold core item | ensemble_lfm | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | filling not identified |
| potato chips/crisps | Y |  |
| samosas (small fried triangles) | n | three fried triangles at the bottom |
| slice of white/vanilla cake with icing — partly eaten | n | the cake square top-centre |
| **core recall (/4)** | 2 |  |
| **hallucinations** | Steamed egg, Steamed shrimp |  |

Recall: 2/4
Hallucinations: Steamed egg, Steamed shrimp (neither is on the plate — likely mis-reads of the cake slice and sandwich)
Trap leaks: none
Dedup fails: none

Optional (no recall credit): plastic fork and foil (non-food)

### 49 — Cafe sizzling-plate dinner set

- **ensemble_lfm**: spaghetti, steak, pork sausage, tomato, bread, soup

| gold core item | ensemble_lfm | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y | "steak" |
| spaghetti (plain, buttered) | Y |  |
| sausage/frankfurter | Y | "pork sausage" |
| cherry tomatoes | Y | "tomato" |
| red cabbage soup (borscht-style, bowl) | Y | "soup" — contents not identified |
| bread bun | Y | "bread" |
| **core recall (/6)** | 6 |  |
| **hallucinations** | none |  |

Recall: 6/6
Hallucinations: none
Trap leaks: none
Dedup fails: none

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50 — Late-night döner kebab plate with fries and salad

- **ensemble_lfm**: grilled chicken breast, French fries, grilled beef, cucumber, onion, Grilled lamb or beef

| gold core item | ensemble_lfm | notes |
|---|---|---|
| döner kebab sliced meat | Y | "grilled beef"/"Grilled lamb or beef" |
| tomato/chili sauce over the meat | n | the thick red sauce over the meat |
| French fries | Y |  |
| iceberg lettuce salad | n | the shredded iceberg bed |
| sliced red onion | Y | "onion" |
| cucumber slices | Y |  |
| pickled gherkin and pepperoncini | n |  |
| **core recall (/7)** | 4 |  |
| **hallucinations** | grilled chicken breast |  |

Recall: 4/7
Hallucinations: grilled chicken breast
Trap leaks: none — the reported fries/cucumber are on the foreground plate, so the background plate was not claimed
Dedup fails: grilled beef / Grilled lamb or beef

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals

| metric | ensemble_lfm |
|---|---|
| total gold core items | 235 |
| total hits | 160 |
| core-item recall | 68.1% (160/235) |
| hallucinations | 38 |
| trap leaks | 2 |
| dedup fails | 18 |
| distinct items named (auto) | 166 |
| items named (auto) | 248 |
| cost / plate (auto) | $0.00000 |
| latency median s (auto) | 143.23 |

### Per-image tally

| image | hits/total | halluc | trap | dedup |
|---|---|---|---|---|
| 01 | 5/6 | 1 | 0 | 0 |
| 02 | 3/5 | 2 | 0 | 1 |
| 03 | 5/8 | 0 | 0 | 0 |
| 04 | 4/4 | 1 | 0 | 0 |
| 05 | 2/2 | 0 | 0 | 1 |
| 06 | 3/6 | 0 | 0 | 0 |
| 07 | 5/5 | 0 | 0 | 0 |
| 08 | 3/3 | 0 | 0 | 0 |
| 09 | 1/1 | 0 | 0 | 0 |
| 10 | 2/2 | 2 | 0 | 1 |
| 11 | 3/3 | 2 | 0 | 0 |
| 12 | 3/3 | 0 | 1 | 2 |
| 13 | 2/2 | 0 | 0 | 1 |
| 14 | 2/3 | 1 | 0 | 0 |
| 15 | 3/3 | 2 | 0 | 0 |
| 16 | 4/4 | 1 | 0 | 0 |
| 17 | 3/4 | 0 | 0 | 0 |
| 18 | 1/2 | 0 | 0 | 1 |
| 19 | 5/5 | 0 | 0 | 1 |
| 20 | 3/4 | 1 | 0 | 2 |
| 21 | 2/6 | 0 | 0 | 0 |
| 22 | 3/6 | 1 | 0 | 1 |
| 23 | 3/4 | 0 | 0 | 0 |
| 24 | 2/4 | 2 | 0 | 1 |
| 25 | 5/7 | 1 | 0 | 0 |
| 26 | 5/8 | 1 | 0 | 0 |
| 27 | 4/5 | 0 | 0 | 2 |
| 28 | 3/8 | 1 | 0 | 0 |
| 29 | 4/4 | 0 | 0 | 0 |
| 30 | 4/6 | 0 | 0 | 0 |
| 31 | 3/3 | 0 | 0 | 2 |
| 32 | 3/8 | 2 | 0 | 0 |
| 33 | 4/5 | 0 | 0 | 0 |
| 34 | 3/4 | 0 | 0 | 0 |
| 35 | 3/8 | 1 | 0 | 0 |
| 36 | 3/4 | 2 | 0 | 0 |
| 37 | 2/3 | 1 | 0 | 0 |
| 38 | 2/2 | 0 | 0 | 0 |
| 39 | 2/3 | 0 | 0 | 1 |
| 40 | 4/6 | 0 | 0 | 0 |
| 41 | 3/3 | 2 | 0 | 0 |
| 42 | 4/7 | 1 | 0 | 0 |
| 43 | 3/7 | 2 | 0 | 0 |
| 44 | 4/6 | 1 | 0 | 0 |
| 45 | 2/8 | 1 | 1 | 0 |
| 46 | 2/3 | 2 | 0 | 0 |
| 47 | 4/5 | 1 | 0 | 0 |
| 48 | 2/4 | 2 | 0 | 0 |
| 49 | 6/6 | 0 | 0 | 0 |
| 50 | 4/7 | 1 | 0 | 1 |
| **total** | **160/235** | **38** | **2** | **18** |

## Findings

1. **"Grilled chicken breast" is a systemic filler token, not an observation.** It appears in 17 of
   50 final lists (04, 10, 11, 24, 27, 28, 30, 32, 35, 36, 37, 41, 44, 45, 46, 47, 50) and is a
   hallucination in 13 of them. It is the single largest contributor to the 38-hallucination count
   and it also displaces the correct answer on the plate's dominant item twice (24 fish and chips,
   35 gyros). Same shape for "side salad", which shows up on plates with no leaves at all (24, 32).
2. **Ensemble merging does not dedup.** 18 dedup fails across 14 plates, including a literal
   `Chicken / Chicken` (05) and near-identical pairs (`Roast potatoes / Potatoes`, `Cabbage / Kraut`,
   `Beef stew / grilled beef stew`, `grilled beef / Grilled lamb or beef`). The merge step is
   concatenating member outputs and only collapsing exact-string matches — at best. Every dedup fail
   also wastes one of the ~5 slots the model spends per plate, which directly costs recall.
3. **Recall collapses on high-cardinality plates.** Plates with ≤4 gold items average roughly 80%
   recall; the 8-item plates average about 40% (28: 3/8, 32: 3/8, 35: 3/8, 45: 2/8, 26: 5/8, 03: 5/8).
   With a hard ~5-6 item output budget, dense plates cannot be covered — the ceiling is structural,
   not perceptual.
4. **Condiments, sauces and starch beds are the consistent blind spot.** Missed: tartar sauce (24),
   tzatziki (35), curry powder (17), green chile sauce (23), caramelised onions (37), sour cream (42),
   berry compote (34), peanut butter (33), broth (20), the entire sushi condiment set (06). These are
   nutritionally significant for a plate-logging product and they are almost never named.
5. **Trap discipline is actually good.** Only 2 leaks in 11 trapped images: a background-plate salad
   (12) and unserved rice (45). No menu-poster or menu-card dishes were ever reported (10, 47), and
   the empty-plate trap (39) and the dumpling trap (46) both held.
6. **Latency is the disqualifier for this configuration.** 145 s mean / 392 s max per plate at
   fan-out 3 buys 68.1% recall with 38 hallucinations. The recall gain has to be weighed against
   single-model runs at a third of the wall time before this ensemble shape is worth keeping.
