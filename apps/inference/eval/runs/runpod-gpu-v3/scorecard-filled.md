# Plate-identification scoring worksheet — FILLED

- results: `runs/runpod-gpu-v3/results.json`
- config: `runpod-gpu-v3` (started 2026-08-12T22:33:42.175301+00:00)
- approach: `single_qwen_vl_v3` — Qwen3-VL-8B, **pipeline v3** (terse JSON), **896 px** downscale, Runpod GPU
- images: 50 (gold: 235 core items)
- scored: 2026-08-12 (reviewing agent; images 03, 23, 26, 28, 37, 42, 45, 46, 47, 48 opened and inspected directly)
- comparison target: `runs/2026-08-12-50img-qwenvl` — same model, pipeline v2, full-res, CPU

## Mechanical metrics (auto-computed)

| metric | single_qwen_vl_v3 | single_qwen_vl (v2) |
|---|---|---|
| plates | 50 | 50 |
| schema-valid responses | 50/50 | 50/50 |
| items named (total) | 192 | 181 |
| items named (mean/plate) | **3.84** | 3.62 |
| distinct item names | 137 | 148 |
| latency median (s) | **0.94** | 94.35 |
| latency max (s) | 1.59 | 596.7 |
| cost / plate (USD) | 0.0 | 0.0 |
| `bg`-flagged items dropped | 0 (across all 50 plates) | n/a (no flag in v2) |

## Scoring conventions applied

The four adjudication rules from `runs/2026-08-12-50img-SCORING.md` were applied **from the
start** of this pass, not as post-hoc flips:

1. **Generic labels earn no credit.** "vegetables", "side salad", "legumes", "toppings",
   "sushi platter" name nothing — itemized gold rows behind them stay misses (images 02, 28,
   35). A generic token DOES match a gold row that is itself generic ("mixed side salad
   (lettuce, cherry tomato, red onion)" in 11/16, "mixed leaf salad" in 30, "green salad
   (...)" in 44). **Named dishes with determinate composition consolidate**: "greek salad" →
   feta/olives/tomato/cucumber/lettuce/onion (03), "pho" → beef (21), "paella" → prawns (36),
   "ramen" → broth (20), "fish and chips" → both halves (24).
2. **Species/kind errors are misses; prep/cut/form errors are hits.** Misses: fish-for-pork
   (11), chicken-for-chashu (20), chicken-for-steak (30), chicken-for-fish (42), stew-for-liver
   (40 — organ identity counts as kind). Hits: sauerkraut-for-cabbage-salad (37),
   donut-for-bagel (47), sausage-for-meatball (42), tofu-for-tofu-skin (46).
3. **A misnamed visible object is never a hallucination.** 46's three phantom organ names and
   45's four surplus "kimchi" tokens all have referents in the photo — they are kind errors and
   dedup failures, counted as such, not as inventions. Menu/poster items score per the gold
   `trap` field.
4. **Sashimi for nigiri is a miss** (image 06, ×2).

Cells: `Y` covered, `n` missed, `Y?`/`n?` genuine 50/50 flagged for the architect.

> Gold-label protocol: Gold labels authored by hand from direct image inspection (Fable, 2026-08-11). 'core' = items a correct identification must include (synonyms/consolidations acceptable, e.g. 'Greek salad' may cover lettuce+cucumber+tomato). 'optional' = visible but acceptable to omit (garnish, condiments, off-plate drinks). Hallucination = any reported food not visible at all. Entries 11-50 (added 2026-08-11): drafted by two opus vision agents under the same protocol, spot-verified by Fable against images 12/19/22/39/45/46 before merge; manifest descriptions for 32/46/47 corrected to match images.

### 01 — Continental/English-style breakfast plate

- **single_qwen_vl_v3**: scrambled eggs, baked beans, ham, sausage, cucumber, whole wheat bread

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| scrambled eggs | Y |  |
| bacon/ham slices | Y | "ham" |
| frankfurter sausages | Y | "sausage" — type unspecified |
| baked beans in tomato sauce | Y |  |
| brown bread slice | Y | "whole wheat bread" |
| cucumber slices | Y | "cucumber" |
| **core recall (/6)** | 6/6 |  |
| **hallucinations** | none |  |

Recall: 6/6
Hallucinations: none
Trap leaks: –

Optional (no recall credit): butter/margarine packets

### 02 — Roast (Sunday) dinner

- **single_qwen_vl_v3**: Yorkshire pudding, roast beef, potatoes, vegetables

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| roast meat (lamb/beef) in gravy | Y | "roast beef" |
| Yorkshire pudding | Y |  |
| roast potatoes | Y | "potatoes" — roasting not stated |
| broccoli | n | only generic "vegetables" — rule 1, no credit |
| cabbage/greens | n | ditto |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none |  |

Recall: 3/5
Hallucinations: none
Trap leaks: –

Optional (no recall credit): gravy as separate item

### 03 — Greek-style salad with grilled salmon

- **single_qwen_vl_v3**: grilled salmon, greek salad

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| grilled salmon fillets | Y | "grilled salmon" |
| feta cheese | Y | via "greek salad" |
| kalamata olives | Y | via "greek salad" |
| avocado | n | avocado is abundant and is NOT part of a Greek salad — no referent in the 2 reported tokens |
| cherry tomatoes | Y | via "greek salad" |
| cucumber | Y | via "greek salad" |
| lettuce/romaine | Y | via "greek salad" (protocol names lettuce explicitly) |
| red onion | Y | via "greek salad" |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none |  |

Recall: 7/8
Hallucinations: none
Trap leaks: –

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04 — Cheeseburger with fries

- **single_qwen_vl_v3**: hamburger, fries, pickles, ketchup

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) | Y | "hamburger" — cheese not stated |
| thick-cut fries/steak fries | Y | "fries" |
| ketchup | Y |  |
| pickles/gherkins | Y | "pickles" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: –

Optional (no recall credit): lettuce in burger, beer in background

### 05 — Chicken in creamy leafy-green sauce with white rice

- **single_qwen_vl_v3**: chicken curry, rice

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) | Y | "chicken curry" — kind right, greens dropped |
| white rice | Y | "rice" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none
Trap leaks: –

Optional (no recall credit): red bell pepper bits in rice

### 06 — Sushi platter (restaurant table)

- **single_qwen_vl_v3**: sushi rolls, sashimi, wasabi, pickled ginger, soy sauce

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) | Y | "sushi rolls" |
| tuna nigiri | n | "sashimi" — rice + form lost (rule 4) |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | n | "sashimi" — rule 4 |
| pickled ginger | Y |  |
| wasabi | Y |  |
| soy sauce | Y |  |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |

Recall: 4/6
Hallucinations: none
Trap leaks: –

Optional (no recall credit): white wine / water glasses in background

### 07 — Spaghetti with meat-vegetable sauce

- **single_qwen_vl_v3**: spaghetti with meat sauce

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| spaghetti | Y | via "spaghetti with meat sauce" |
| ground beef/meat tomato sauce | Y | via same token |
| corn kernels | n | no vegetable named at all this time (v2 at least said "vegetables") |
| green beans | n |  |
| carrot pieces | n |  |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |

Recall: 2/5
Hallucinations: none
Trap leaks: –

### 08 — Yogurt granola bowl with apple

- **single_qwen_vl_v3**: yogurt, granola, apple slices

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| yogurt | Y |  |
| granola (oats/puffed grains, nuts) | Y |  |
| apple slices | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: –

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09 — Whole chicken pizza in delivery box

- **single_qwen_vl_v3**: pizza

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| pizza with chicken pieces and cheese | Y | "pizza" — chicken topping not stated |
| **core recall (/1)** | 1/1 |  |
| **hallucinations** | none |  |

Recall: 1/1
Hallucinations: none
Trap leaks: –

Optional (no recall credit): cola drink at table edge

### 10 — Club sandwich with side salad (cafe table)

- **single_qwen_vl_v3**: sandwich, lettuce

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) | Y | "sandwich" — layering/filling lost |
| green side salad (rocket/mixed leaves) | Y | "lettuce" — names the actual leaf |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none
Trap leaks: none

Optional (no recall credit): Pepsi Max bottle, hot drink cup

### 11 — Wiener Schnitzel with fries and side salad

- **single_qwen_vl_v3**: fried fish, fries, side salad

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| breaded fried schnitzel (pork/veal cutlet) | n | "fried fish" for a breaded pork/veal cutlet — species miss (rule 2) |
| thick-cut fries/potato wedges | Y | "fries" |
| mixed side salad (lettuce, cherry tomato, red onion, dressing) | Y | gold row is itself "mixed side salad (...)" so the token matches the row |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |

Recall: 2/3
Hallucinations: none
Trap leaks: –

Optional (no recall credit): capers, lemon wedge, ketchup in ramekin, parsley garnish, water glass in background

### 12 — Bratwurst plate with sauerkraut and mashed potatoes

- **single_qwen_vl_v3**: grilled sausages, mashed potatoes, sauerkraut

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| bratwurst sausages | Y | "grilled sausages" |
| sauerkraut | Y |  |
| mashed potatoes | Y | "mashed potatoes" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none — no background-plate items reported

Optional (no recall credit): mustard/onion-gravy drizzle on the sausages, drink glass in background

### 13 — Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

- **single_qwen_vl_v3**: macaroni and cheese, caramelized onions

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| Käsespätzle (spätzle noodles in melted cheese) | Y | "macaroni and cheese" — pasta-in-melted-cheese kind preserved |
| fried/caramelised onions | Y | "caramelized onions" |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none
Trap leaks: none — no meat invented in the spätzle

Optional (no recall credit): side plate of iceberg lettuce salad with tomato and onion (separate plate behind), parsley garnish

### 14 — Beef gulasch with boiled potatoes and a side bowl of lettuce

- **single_qwen_vl_v3**: beef stew, potatoes, lettuce

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| beef gulasch/stew in dark gravy | Y | "beef stew" |
| boiled potatoes | Y | "potatoes" |
| green leaf lettuce (butterhead) in a separate glass bowl | Y | "lettuce" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: –

Optional (no recall credit): mushrooms in the stew, gravy as separate item

### 15 — Bavarian Weisswurst breakfast

- **single_qwen_vl_v3**: boiled sausages, pretzel, mustard

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| Weisswurst sausages in hot water | Y | "boiled sausages" — Weisswurst prep actually captured |
| pretzel (Brezel) | Y |  |
| sweet mustard | Y | "mustard" — sweetness not stated |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: –

Optional (no recall credit): wheat beer (Weissbier) glass, parsley in the pot

### 16 — Döner/gyros plate with fries and salad

- **single_qwen_vl_v3**: shredded meat, fries, side salad

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| döner/gyros sliced meat | Y | "shredded meat" — species unstated but not wrong |
| tomato sauce over the meat | n | no sauce token at all — v2's "grilled meat with sauce" carried it |
| French fries | Y | "fries" |
| side salad (lettuce, tomato, cucumber, red onion) with dressing | Y | gold row is a single "side salad (...)" row |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |

Recall: 3/4
Hallucinations: none
Trap leaks: –

Optional (no recall credit): pepperoncini/green pickled pepper, glass of beer, beer bottle

### 17 — Currywurst with French fries

- **single_qwen_vl_v3**: sausage, french fries

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| currywurst (sausage) | Y | "sausage" |
| curry ketchup sauce | n | no sauce token (v2 said "tomato sauce") |
| curry powder | n |  |
| French fries | Y | "french fries" |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |

Recall: 2/4
Hallucinations: none
Trap leaks: –

### 18 — Swabian Maultaschen with potato salad

- **single_qwen_vl_v3**: filled dumplings, potato salad

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| Maultaschen (filled pasta pockets with meat filling) | Y | "filled dumplings" — better than v2's bare "dumplings" |
| potato salad | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none
Trap leaks: –

Optional (no recall credit): thyme sprig garnish, bacon/speck bits in the potato salad

### 19 — German fast-food mixed plate (Taxiteller)

- **single_qwen_vl_v3**: french fries, shredded meat, sauce, yogurt

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| French fries | Y |  |
| gyros/döner sliced meat | Y | "shredded meat" |
| sliced sausage in curry/shashlik sauce | n | only a generic "sauce" token; the sausage itself is never named |
| tzatziki/garlic yogurt sauce | Y | "yogurt" — the tzatziki dollop |
| mayonnaise | n |  |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none |  |

Recall: 3/5
Hallucinations: none
Trap leaks: –

### 20 — Bowl of shio ramen

- **single_qwen_vl_v3**: ramen, chicken, herbs

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| ramen noodles | Y | via "ramen" |
| clear (shio) broth | Y? | credited to the named dish "ramen" (determinately noodles IN broth); v2's narrower "ramen noodles" would not carry it |
| sliced chashu pork | n | "chicken" for chashu pork — species miss |
| leafy green herb topping (mizuna/mitsuba) | Y | "herbs" |
| **core recall (/4)** | 3/4 |  |
| **hallucinations** | none |  |

Recall: 3/4
Hallucinations: none
Trap leaks: –

Optional (no recall credit): minced fat/garlic granules in the broth, fried onion/garlic bits

### 21 — Vietnamese pho with a side plate of herb garnishes

- **single_qwen_vl_v3**: pho, rice noodles, bean sprouts, fresh herbs

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| pho noodle soup (rice noodles in beef broth) | Y | "pho" + "rice noodles" |
| sliced beef and beef meatballs | Y | via "pho" (protocol: pho → beef) |
| bean sprouts | Y |  |
| Thai basil | Y | "fresh herbs" — Thai basil is the only herb on the plate |
| sliced green chilli/jalapeño | n |  |
| spring onion | n |  |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |

Recall: 4/6
Hallucinations: none
Trap leaks: –

Optional (no recall credit): extra bowl of rice noodles, hoisin/chilli sauce dish, iced drink glass

### 22 — Three soft tacos with a corn cob

- **single_qwen_vl_v3**: tacos, grilled corn

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| soft corn tortilla tacos with seasoned ground beef | Y | "tacos" |
| grated cheese | n |  |
| red salsa | n |  |
| green salsa/tomatillo | n |  |
| coriander/cilantro | n |  |
| grilled corn on the cob | Y | "grilled corn" |
| **core recall (/6)** | 2/6 |  |
| **hallucinations** | none |  |

Recall: 2/6
Hallucinations: none
Trap leaks: –

Optional (no recall credit): glass of cola

### 23 — Smothered beef burrito

- **single_qwen_vl_v3**: enchilada, cheese, lettuce, tomato

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| burrito (flour tortilla) | Y | "enchilada" for a smothered burrito — filled-tortilla class kept |
| green chile sauce | Y? | no sauce token, but "enchilada" determinately means a sauce-smothered tortilla and the green chile pool is why the model chose that word |
| shredded cheddar/jack cheese | Y | "cheese" |
| shredded lettuce | Y | "lettuce" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: –

Optional (no recall credit): diced tomato

### 24 — Fish and chips with peas

- **single_qwen_vl_v3**: fish and chips, peas, lemon wedge, tartar sauce

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| battered fried fish fillet | Y | via "fish and chips" |
| chips/thick-cut fries | Y | via same token |
| green peas | Y | "peas" |
| tartar sauce | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: –

Optional (no recall credit): lemon wedge

### 25 — American breakfast platter

- **single_qwen_vl_v3**: pancakes, fried egg, bacon, sausage, toast, hash browns, maple syrup

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| pancakes with icing sugar | Y |  |
| back bacon rashers | Y | "bacon" |
| fried egg (sunny side up) | Y |  |
| breakfast sausages | Y | "sausage" |
| hash brown/potato croquettes | Y | "hash browns" |
| toast slices | Y | "toast" |
| maple syrup in a shot glass | Y | "maple syrup" — v2 missed this one |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none |  |

Recall: 7/7
Hallucinations: none
Trap leaks: none — nothing from the second plate reported

Optional (no recall credit): butter packet

### 26 — Indian thali on a steel tray

- **single_qwen_vl_v3**: rice, roti, dal, yogurt, curry, curry, curry, sauce

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| rice pilaf/vegetable fried rice | Y | "rice" |
| chapati/roti | Y | "roti" |
| papad (papadum) | n | papad unreported |
| curd/raita | Y | "yogurt" — the curd bowl |
| dal (lentil curry) | Y | "dal" |
| kofta/dumpling curry in orange gravy | n? | one of three bare "curry" tokens — see the policy note in Findings; kofta/meat identity absent |
| paneer or fish curry in pale gravy | n? | bare "curry"; paneer (dairy) identity absent |
| brinjal/eggplant curry | n? | bare "curry"; brinjal (vegetable) identity absent |
| **core recall (/8)** | 4/8 |  |
| **hallucinations** | none |  |

Recall: 4/8
Hallucinations: none — the 4th token "sauce" maps to the optional clear vegetable stew
Trap leaks: –

Optional (no recall credit): shredded cabbage-and-tomato salad, clear vegetable stew/soup bowl

### 27 — Stir-fried chicken with peppers and steamed rice

- **single_qwen_vl_v3**: chicken with sauce, white rice

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| stir-fried chicken pieces in brown sauce | Y | "chicken with sauce" |
| red bell pepper strips | n | no vegetable token at all |
| onion | n |  |
| spring onion/green onion | n |  |
| steamed white rice | Y | "white rice" |
| **core recall (/5)** | 2/5 |  |
| **hallucinations** | none |  |

Recall: 2/5
Hallucinations: none
Trap leaks: –

Optional (no recall credit): dried chilli bits

### 28 — Middle-Eastern mezze spread — four composed plates plus flatbread

- **single_qwen_vl_v3**: falafel, pita bread, mixed salad, chickpeas, herbs, olives, pomegranate, tahini sauce

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| falafel balls | Y | "falafel" |
| grilled flatbread | Y | "pita bread" — flatbread |
| hummus/creamy white dip | Y | the creamy dip is named twice, as "chickpeas" and "tahini sauce"; chickpea/sesame paste identity is right |
| green herb-chilli sauce | n? | "herbs" most plausibly reads as the parsley garnish, not the green herb-chilli sauce bowls |
| yellow bulgur or couscous | n | bulgur unreported |
| black beluga lentils | n | beluga lentils unreported |
| pickled white cabbage slaw | n | "mixed salad" is generic — rule 1 |
| green olives | Y | "olives" |
| **core recall (/8)** | 4/8 |  |
| **hallucinations** | none |  |

Recall: 4/8
Hallucinations: none — no whole chickpeas on the plate, but the hummus is the referent for that token
Trap leaks: –

Optional (no recall credit): pickled pink turnip/watermelon radish, diced beetroot, tomato/pepper salsa salad, grated carrot salad, pomegranate seeds, parsley/herb garnish, sesame seeds, empty water glass

### 29 — Tapas/snack flight with a wheat beer

- **single_qwen_vl_v3**: pickles, salami, cheese, olives

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| pickled gherkin slices | Y | "pickles" |
| salami slices | Y |  |
| cheese cubes | Y | "cheese" |
| green olives | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: –

Optional (no recall credit): creamy dip/cream cheese with the pickles, glass of Weissbier

### 30 — Mixed grill board (plancha de grillades)

- **single_qwen_vl_v3**: grilled ribs, grilled chicken, grilled sausage, baked potato, side salad

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| pork spare ribs slab | Y | "grilled ribs" — v3 gets the ribs right |
| grilled beef steak | n | "grilled chicken" for a beef steak — species miss |
| grilled sausage | Y |  |
| grilled meat skewer with green pepper and tomato | n | the pepper/tomato skewer is unreported |
| baked/roasted potato with browned cheese topping | Y | "baked potato" — cheese topping lost |
| mixed leaf salad | Y | "side salad" matches the single "mixed leaf salad" row |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |

Recall: 4/6
Hallucinations: none
Trap leaks: –

Optional (no recall credit): cherry tomato, steak knife

### 31 — Bowl of beef/oxtail soup with buttered bread

- **single_qwen_vl_v3**: beef stew, buttered toast

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| thick brown meat soup/stew broth | Y | via "beef stew" |
| beef (oxtail) chunks | Y | via "beef stew" |
| buttered bread slices (dark/whole-grain) | Y | "buttered toast" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: –

Optional (no recall credit): parsley garnish, butter as separate item

### 32 — Charcuterie/snack board (compartmented bamboo tray, top-down)

- **single_qwen_vl_v3**: olives, cucumber, carrots, peppers, crackers, cheese, meat, dip

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| green olives | Y |  |
| cucumber sticks | Y | "cucumber" — v3 itemizes where v2 said "vegetable sticks" |
| carrot sticks | Y | "carrots" |
| bell pepper strips | Y | "peppers" |
| pan-fried spiced hard-boiled egg halves | n | the pan-fried spiced egg halves are unreported (v2 caught them) |
| hummus dip | Y | "dip" |
| salami/cured meat slices | Y | "meat" |
| cheese slices | Y | "cheese" |
| **core recall (/8)** | 7/8 |  |
| **hallucinations** | none |  |

Recall: 7/8
Hallucinations: none — "crackers" is a gold-optional item
Trap leaks: –

Optional (no recall credit): herb crackers, paper towel/liner (non-food)

### 33 — Bowl of oatmeal porridge with toppings

- **single_qwen_vl_v3**: oatmeal, peanut butter, raisins, cinnamon

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| oatmeal/oat porridge | Y |  |
| peanut butter | Y |  |
| raisins | Y |  |
| ground cinnamon | Y |  |
| milk | n | milk unreported |
| **core recall (/5)** | 4/5 |  |
| **hallucinations** | none |  |

Recall: 4/5
Hallucinations: none
Trap leaks: –

Optional (no recall credit): honey/syrup drizzle, spoon (non-food)

### 34 — Waffles with strawberries and whipped cream

- **single_qwen_vl_v3**: waffles, strawberries, whipped cream, strawberry sauce

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| waffles | Y |  |
| strawberries (sliced fresh) | Y |  |
| strawberry/berry syrup-compote | Y | "strawberry sauce" |
| whipped cream | Y |  |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: –

Optional (no recall credit): orange juice glass at top edge

### 35 — Gyros/döner plate with fries and salad

- **single_qwen_vl_v3**: grilled meat, french fries, side salad

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| gyros/döner sliced meat | Y | "grilled meat" |
| French fries | Y |  |
| white garlic-yogurt sauce (tzatziki) with oregano | n | no sauce token (v2 said "yogurt sauce") |
| shredded white cabbage | n | "side salad" is generic and gold itemizes — rule 1 |
| tomato slices | n | rule 1 |
| sweetcorn | n | rule 1 |
| cucumber slices | n | rule 1 |
| shredded carrot | n | rule 1 |
| **core recall (/8)** | 2/8 |  |
| **hallucinations** | none |  |

Recall: 2/8
Hallucinations: none
Trap leaks: none — the off-plate flatbread basket was not claimed

Optional (no recall credit): pickled green chili pepper, black olive, lettuce leaves, flatbread in basket at right edge

### 36 — Seafood paella in the pan

- **single_qwen_vl_v3**: paella

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| saffron/paella rice | Y | via "paella" |
| whole prawns (langostinos) | Y | via "paella" (protocol: paella → prawns) |
| mantis shrimp (galeras) | n | mantis shrimp is a distinct visible item, not implied by "paella" |
| artichoke pieces | n | artichoke unreported |
| **core recall (/4)** | 2/4 |  |
| **hallucinations** | none |  |

Recall: 2/4
Hallucinations: none
Trap leaks: –

Optional (no recall credit): red pepper/tomato bits in the rice

### 37 — Pierogi ruskie with carrot-cabbage salad

- **single_qwen_vl_v3**: dumplings, sauerkraut

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| pierogi/boiled dumplings (potato-cheese filling) | Y | "dumplings" |
| fried caramelised onion topping | n | the caramelised onion topping is unreported |
| grated carrot and cabbage salad | Y | "sauerkraut" for the raw carrot-and-cabbage salad — cabbage kind kept, fermentation is a prep error (rule 2) |
| **core recall (/3)** | 2/3 |  |
| **hallucinations** | none |  |

Recall: 2/3
Hallucinations: none — "sauerkraut" maps onto the shredded-cabbage salad
Trap leaks: –

Optional (no recall credit): radish/beet sprouts garnish

### 38 — Half-eaten beefburger with fries

- **single_qwen_vl_v3**: hamburger, french fries

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | Y | "hamburger" |
| French fries | Y |  |
| **core recall (/2)** | 2/2 |  |
| **hallucinations** | none |  |

Recall: 2/2
Hallucinations: none
Trap leaks: –

Optional (no recall credit): cheese slice in burger, sauce/ketchup smear on plate

### 39 — Remains of a fried breakfast (mostly eaten)

- **single_qwen_vl_v3**: baked beans, sausage, bacon

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| baked beans in tomato sauce | Y |  |
| sausage pieces | Y |  |
| bacon rasher | Y | "bacon" |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none — nothing invented on a near-empty plate

Optional (no recall credit): egg-yolk smears, cutlery (non-food)

### 40 — Half-eaten liver-and-bacon fry-up with chips

- **single_qwen_vl_v3**: beef stew, french fries, fried egg, ham

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| liver pieces in gravy | n | "beef stew" for liver — organ identity counts as kind (rule 2) |
| chips/French fries | Y | "french fries" |
| bacon/gammon slice | Y | "ham" |
| fried egg (remnant, yolk visible) | Y |  |
| sausage | n | sausage unreported |
| grilled tomato half | n | grilled tomato unreported (v2 caught it) |
| **core recall (/6)** | 3/6 |  |
| **hallucinations** | none |  |

Recall: 3/6
Hallucinations: none
Trap leaks: –

Optional (no recall credit): gravy as separate item, small blob of butter/mash

### 41 — Leftovers of battered fish and potato wedges

- **single_qwen_vl_v3**: fried fish, potato wedges, tartar sauce

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| battered fried fish (cod) — partly eaten | Y |  |
| potato wedges/skin-on roast potatoes | Y |  |
| tartar sauce / mayonnaise dollop | Y |  |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none
Trap leaks: none — no sachet/napkin text reported as food

Optional (no recall credit): cracked black pepper sachets, paper napkin (non-food)

### 42 — Buffet lunch plate (many components)

- **single_qwen_vl_v3**: fried chicken breast, white rice, curried chickpeas, sausage, corn salsa, onion

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| breaded fried fish fillet | n | "fried chicken breast" for a breaded fish fillet — species miss |
| sour cream / remoulade dollop | n | the sour-cream dollop sits on top of the fillet and is unreported |
| meatballs in brown gravy | Y? | "sausage" for gravy-coated meatballs — ground-meat form error, a hit under rule 2, but it is the weakest form call in the run |
| chickpea-and-cauliflower curry | Y | "curried chickpeas" |
| white rice | Y | "white rice" |
| red cabbage and sweetcorn salad | Y? | "corn salsa" names the sweetcorn of the red-cabbage-and-sweetcorn salad; "onion" separately covers the red shreds |
| cucumber and lettuce salad | n | the cucumber/lettuce salad at the back is unreported |
| **core recall (/7)** | 4/7 |  |
| **hallucinations** | none |  |

Recall: 4/7
Hallucinations: none
Trap leaks: –

Optional (no recall credit): tomato-sauced bake at the back of the plate, water glass, pickled red onion, green chili pepper

### 43 — Buffet lunch set — main plate, soup bowl, bread plate

- **single_qwen_vl_v3**: fish cakes, rice, green beans, lemon wedge, buttered bread, soup

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| breaded croquettes/fish cakes topped with mayonnaise-aioli | Y | "fish cakes" — aioli topping lost |
| herbed green rice | Y | "rice" — herbed/green lost |
| green beans | Y |  |
| cheese-topped quiche/gratin square | n | the cheese-topped quiche square is unreported |
| creamy meat-and-vegetable stew | n | the creamy meat-and-vegetable stew is unreported ("soup" is assigned to the soup bowl) |
| creamy soup (bowl, with bacon bits) | Y | "soup" |
| bread roll with butter | Y | "buttered bread" |
| **core recall (/7)** | 5/7 |  |
| **hallucinations** | none |  |

Recall: 5/7
Hallucinations: none
Trap leaks: –

Optional (no recall credit): coleslaw/cabbage salad, lemon wedge, green olives, water glass

### 44 — Brazilian buffet lunch plate (top-down)

- **single_qwen_vl_v3**: rice, beans, salad, meat

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| green salad (lettuce, grated carrot, coriander) | Y | "salad" matches the single "green salad (...)" row |
| brown beans (feijão) in broth | Y | "beans" |
| yellow seasoned rice | Y | "rice" — yellow/seasoned lost (v2 said "yellow rice") |
| braised cabbage with tomato | n | braised cabbage unreported (v2 caught it via "stewed meat with cabbage") |
| stewed meat in onion gravy | Y | "meat" — species unstated |
| mashed cassava/potato purée | n | cassava purée unreported |
| **core recall (/6)** | 4/6 |  |
| **hallucinations** | none |  |

Recall: 4/6
Hallucinations: none
Trap leaks: –

Optional (no recall credit): cutlery and placemat (non-food)

### 45 — Korean hanjeongsik table spread (dozens of banchan, top-down)

- **single_qwen_vl_v3**: rice, grilled fish, kimchi, tofu, kimchi, kimchi, kimchi, kimchi

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| japchae (glass noodles with vegetables) | n | the japchae plate is unreported |
| steamed egg (gyeranjjim) in stone pot | n | the steamed-egg stone pot is unreported |
| grilled mackerel/fish | Y | "grilled fish" |
| stir-fried beef in a hot stone pot | n | the beef stone pot is unreported — v3 has no stew/beef token at all |
| glazed spicy braised ribs/pork | n | glazed ribs unreported |
| sliced raw fish (hoe/sashimi) on shredded radish | n | the hoe plate is unreported |
| vegetable fritters/jeon platter | n | the jeon platter is unreported |
| kimchi | Y | "kimchi" — reported FIVE times |
| **core recall (/8)** | 2/8 |  |
| **hallucinations** | none |  |

Recall: 2/8
Hallucinations: none — the 4 surplus "kimchi" tokens map onto other red banchan dishes, so they are dedup failures, not inventions
Trap leaks: **1 (rice)** — every rice-sized bowl in frame is empty tableware. Same leak as v2.

Optional (no recall credit): tofu slices, white creamy soup/porridge in stone pot, perilla-leaf wrapped pickles, seasoned greens (namul), lotus root, pickled cucumber/radish, green chili peppers with dipping paste, spring onion salad in chili sauce, seasoned peanuts/beans, mushroom-and-noodle soup, chili paste and soy dipping bowls, empty bowls, glasses, spoons (non-food)

### 46 — Hong Kong steamer basket of small offal dishes (dai pai dong)

- **single_qwen_vl_v3**: steamed tofu, boiled beef tripe, boiled beef tendon, boiled beef cheek, boiled beef tongue, boiled beef stomach

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| honeycomb beef tripe in curry sauce | Y | "boiled beef tripe" — curry sauce not stated |
| white boiled tripe/omasum slices in broth | Y | "boiled beef stomach" — omasum/tripe, same organ |
| fried beancurd-skin rolls (tofu skin rolls) | Y? | "steamed tofu" for fried beancurd-skin rolls — soy-curd kind kept, frying lost; v2's "steamed tofu skin" was more precise |
| **core recall (/3)** | 3/3 |  |
| **hallucinations** | none |  |

Recall: 3/3
Hallucinations: none — "beef tendon"/"beef cheek"/"beef tongue" are wrong names for the pale tripe cups, of which there are 6+ in the basket; rule 3 says a misnamed visible object is not a hallucination
Trap leaks: none — no siu mai / har gow / dumplings / buns invented

Optional (no recall credit): carrot and vegetable pieces in the broth cups, steamer basket, tongs, kitchen cloth (non-food)

### 47 — Café brunch table spread (top-down)

- **single_qwen_vl_v3**: kiwi fruit bowl, avocado toast, chocolate donut, tomato salad, iced coffee, smoothie

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| avocado toast/bagel halves with poached eggs | Y | "avocado toast" — the poached-egg toast plate |
| eggs benedict with hollandaise on avocado toast | n | the eggs-benedict-with-hollandaise plate gets no token of its own |
| yogurt bowl with granola, kiwi slices and berry compote | n? | "kiwi fruit bowl" names the right bowl but drops yogurt AND granola — the same call the 2026-08-12 adjudication made against the ensemble's "fruit salad" |
| cherry tomato salad with balsamic drizzle | Y | "tomato salad" |
| seeded bagel (dark, sesame-topped) | Y | "chocolate donut" for the dark sesame bagel — ring-shaped baked good, form error (rule 2) |
| **core recall (/5)** | 3/5 |  |
| **hallucinations** | none |  |

Recall: 3/5
Hallucinations: none — "iced coffee" and "smoothie" map to the optional drinks
Trap leaks: none — no bagel/croissant/goulash/macaron from the menu cards

Optional (no recall credit): beetroot latte, iced coffee, orange/passionfruit drink, white wine glass, microgreens/sprout garnish

### 48 — Disposable plate of party snacks (partly eaten)

- **single_qwen_vl_v3**: chips, cake, sandwich, pastries

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| cucumber sandwich (white bread triangle) | Y | "sandwich" |
| potato chips/crisps | Y | "chips" |
| samosas (small fried triangles) | Y? | "pastries" for the three fried samosa triangles — fried-pastry class is right, 1:1 with the gold row, but the filling/identity is gone |
| slice of white/vanilla cake with icing — partly eaten | Y | "cake" |
| **core recall (/4)** | 4/4 |  |
| **hallucinations** | none |  |

Recall: 4/4
Hallucinations: none
Trap leaks: –

Optional (no recall credit): plastic fork and foil (non-food)

### 49 — Cafe sizzling-plate dinner set

- **single_qwen_vl_v3**: steak with sauce, spaghetti with cherry tomatoes, soup, bread

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| grilled steak/pork chop in brown sauce | Y | "steak with sauce" |
| spaghetti (plain, buttered) | Y | via "spaghetti with cherry tomatoes" |
| sausage/frankfurter | n | the frankfurter is unreported |
| cherry tomatoes | Y | via the same spaghetti token |
| red cabbage soup (borscht-style, bowl) | Y | "soup" — borscht colour/kind lost |
| bread bun | Y | "bread" |
| **core recall (/6)** | 5/6 |  |
| **hallucinations** | none |  |

Recall: 5/6
Hallucinations: none
Trap leaks: –

Optional (no recall credit): onion/cabbage under the meat, gravy as separate item

### 50 — Late-night döner kebab plate with fries and salad

- **single_qwen_vl_v3**: grilled meat with sauce, french fries, cucumber slice, onion slice, lettuce, pickles

| gold core item | single_qwen_vl_v3 | notes |
|---|---|---|
| döner kebab sliced meat | Y | "grilled meat with sauce" |
| tomato/chili sauce over the meat | Y | via the same token |
| French fries | Y |  |
| iceberg lettuce salad | Y | "lettuce" |
| sliced red onion | Y | "onion slice" |
| cucumber slices | Y | "cucumber slice" |
| pickled gherkin and pepperoncini | Y | "pickles" |
| **core recall (/7)** | 7/7 |  |
| **hallucinations** | none |  |

Recall: 7/7
Hallucinations: none
Trap leaks: none — nothing from the background plate claimed

Optional (no recall credit): glass of beer, Pepsi cup, napkins/cutlery (non-food)

## Totals

| metric | single_qwen_vl_v3 (v3, 896 px, GPU) | single_qwen_vl (v2, full-res, CPU) |
|---|---|---|
| core-item recall (/235) | **171/235 = 72.8%** | 175/235 = 74.5% (as published) |
| — same-rules re-score of v2 | — | ~159/235 ≈ 67.7% (see note) |
| hallucinations | **0** | 0 |
| trap leaks | **1** (45: rice) | 1 (45: steamed rice) |
| items reported / plate | 3.84 | 3.62 |
| distinct item names | 137 | 148 |
| median latency | 0.94 s | 94.35 s |
| cost / plate | $0 | $0 |

**Note on the v2 comparison.** v2's published 74.5% was scored before the four rules were
written down, and its scorer credited generic "side salad"/"vegetable sticks" tokens for
itemized gold rows (images 03, 32, 35, 50) — exactly what rule 1 now forbids. Re-scoring the
v2 response set under the identical literal rules used here gives ≈159/235 (67.7%). So the
honest single-variable read is **v3 +12 items over v2** (171 vs ~159), and v3 lands ~1.7 pts
*below* v2's looser published number. **The v3 terse format + 896 px downscale did not cost
identification accuracy.**

### Per-image tally

| image | hits/total | halluc | trap |
|---|---|---|---|
| 01 | 6/6 | 0 | – |
| 02 | 3/5 | 0 | – |
| 03 | 7/8 | 0 | – |
| 04 | 4/4 | 0 | – |
| 05 | 2/2 | 0 | – |
| 06 | 4/6 | 0 | – |
| 07 | 2/5 | 0 | – |
| 08 | 3/3 | 0 | – |
| 09 | 1/1 | 0 | – |
| 10 | 2/2 | 0 | none |
| 11 | 2/3 | 0 | – |
| 12 | 3/3 | 0 | none |
| 13 | 2/2 | 0 | none |
| 14 | 3/3 | 0 | – |
| 15 | 3/3 | 0 | – |
| 16 | 3/4 | 0 | – |
| 17 | 2/4 | 0 | – |
| 18 | 2/2 | 0 | – |
| 19 | 3/5 | 0 | – |
| 20 | 3/4 | 0 | – |
| 21 | 4/6 | 0 | – |
| 22 | 2/6 | 0 | – |
| 23 | 4/4 | 0 | – |
| 24 | 4/4 | 0 | – |
| 25 | 7/7 | 0 | none |
| 26 | 4/8 | 0 | – |
| 27 | 2/5 | 0 | – |
| 28 | 4/8 | 0 | – |
| 29 | 4/4 | 0 | – |
| 30 | 4/6 | 0 | – |
| 31 | 3/3 | 0 | – |
| 32 | 7/8 | 0 | – |
| 33 | 4/5 | 0 | – |
| 34 | 4/4 | 0 | – |
| 35 | 2/8 | 0 | none |
| 36 | 2/4 | 0 | – |
| 37 | 2/3 | 0 | – |
| 38 | 2/2 | 0 | – |
| 39 | 3/3 | 0 | none |
| 40 | 3/6 | 0 | – |
| 41 | 3/3 | 0 | none |
| 42 | 4/7 | 0 | – |
| 43 | 5/7 | 0 | – |
| 44 | 4/6 | 0 | – |
| 45 | 2/8 | 0 | **1** |
| 46 | 3/3 | 0 | none |
| 47 | 3/5 | 0 | none |
| 48 | 4/4 | 0 | – |
| 49 | 5/6 | 0 | – |
| 50 | 7/7 | 0 | none |
| **total** | **171/235 (72.8%)** | **0** | **1** |

## Flagged calls (`Y?` / `n?`)

| image | cell | call | rationale |
|---|---|---|---|
| 20 | shio broth | `Y?` | credited to the named dish "ramen", which determinately means noodles *in* broth; v2's narrower "ramen noodles" would not have carried it, so this flag is also a v2/v3 comparability seam. |
| 23 | green chile sauce | `Y?` | no sauce token, but "enchilada" (for a burrito) determinately implies a sauce-smothered tortilla, and the green chile pool is visibly why the model reached for that word. |
| 26 | kofta / paneer / brinjal curries | `n?` ×3 | three bare "curry" tokens map 1:1 onto three distinct curry bowls — real enumeration — but state no kind, and kofta (meat) vs paneer (dairy) vs brinjal (vegetable) is exactly the distinction rule 2 protects. Scored as misses; crediting them 1:1 would put the run at 174/235 (74.0%). **The single biggest policy question in this scorecard.** |
| 28 | green herb-chilli sauce | `n?` | the token is bare "herbs"; on the photo that reads as the parsley garnish far more naturally than the two chilli-oil dipping bowls. |
| 42 | meatballs in gravy | `Y?` | "sausage" for gravy-coated meatballs — same ground meat, different form, a hit under rule 2, but the weakest form call in the run. |
| 42 | red cabbage + sweetcorn salad | `Y?` | "corn salsa" names the sweetcorn correctly and a separate "onion" token covers the red shreds; "salsa" misdescribes the form. |
| 46 | fried beancurd-skin rolls | `Y?` | "steamed tofu" keeps the soy-curd kind but loses both the skin-roll form and the frying; v2's "steamed tofu skin" was strictly better. |
| 47 | yogurt bowl w/ granola | `n?` | "kiwi fruit bowl" identifies the right bowl and a real component but drops the yogurt and the granola — the same call the 2026-08-12 adjudication made against the ensemble's "fruit salad". |
| 48 | samosas | `Y?` | "pastries" is generic, but it is 1:1 with the gold row and fried pastry is the correct class, so rule 1's "names nothing" test does not bite. |

## Findings — what the v3 terse format changed

1. **No accuracy cost, and probably a gain.** 171/235 (72.8%) under rules applied from the
   start, versus ≈159/235 for the same model's v2 responses re-scored the same way. Zero
   hallucinations and the same single trap leak (45's phantom rice). 896 px downscaling
   destroyed nothing: v3 newly caught maple syrup (25), sweet mustard (15), ribs-as-ribs (30),
   and itemized 32's cucumber/carrot/pepper where v2 said "vegetable sticks". **The purpose of
   this run is satisfied: v3 + 896 px is safe to adopt, and it runs 100× faster (0.94 s median
   vs 94 s).**
2. **Names got shorter, and short names lose modifiers — usually sauces.** v3 emits bare nouns
   where v2 emitted phrases: `ham` vs `bacon`, `rice` vs `yellow rice`, `soup` vs `bowl of
   grits with bacon`, `meat` vs `stewed meat with cabbage`. Because v2 smuggled extra gold rows
   inside its long tokens ("grilled meat **with sauce**", "spaghetti with sauce and cherry
   tomatoes"), the terse format directly cost sauce rows in 16, 17, 35 and the cabbage row in
   44. Distinct item names fell 148 → 137 on 11 *more* items — vocabulary compressed.
3. **Enumeration went up on wide plates and collapsed on the widest.** 3.84 vs 3.62 items/plate,
   and the gain is concentrated where it pays: 50 went 5/7 → **7/7**, 25 6/7 → **7/7**, 32
   itemized its sticks, 26 emitted 8 tokens for a thali. But 03 collapsed to two tokens
   ("grilled salmon", "greek salad") and lost the avocado, and 07 dropped even the generic
   "vegetables" v2 offered. The format rewards list-shaped plates and punishes composed ones.
4. **A new failure mode: degenerate repetition instead of enumeration.** Image 45 returned
   `kimchi` five times out of eight tokens — it filled the item budget with one word rather
   than naming the japchae, steamed egg, ribs, hoe or jeon in front of it (2/8). v2 spent its
   six tokens on six *different* dishes. Terse schemas make repetition cheap; the v3 pipeline
   needs a dedup/uniqueness constraint before this format goes to production.
5. **The `bg` flag was inert.** All 192 items across all 50 plates carry `bg: 0`, and
   `background_items_dropped` is 0 everywhere — including 12, 25, 47 and 50, which have real
   second plates or menu cards in frame. Trap discipline is nonetheless perfect on those four
   (nothing off-plate was reported), so the flag is not *doing* the work — the model simply
   isn't reporting background food, and the flag is dead weight that currently proves nothing.
   Worth a targeted probe before anyone relies on `bg` for plate-boundary logic.
6. **The 75% ceiling is unmoved and still made of the same material.** v3's misses are
   enumeration depth (35: 2/8, 45: 2/8, 22: 2/6, 27: 2/5) and the same four species confusions
   on the headline protein (11, 20, 30, 42 — "chicken" remains the default guess for an
   unidentified pale protein). v3's per-component pressure did not attack finding 3 of the
   2026-08-12 scoring; it traded modifier detail for a little more breadth.
