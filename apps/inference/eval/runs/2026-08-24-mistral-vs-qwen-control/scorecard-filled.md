# Plate-identification scoring worksheet — FILLED

- results: `runs/2026-08-24-mistral-vs-qwen-control/results.json`
- config: `mistral-vs-qwen-control` (started 2026-08-24T10:07:27Z)
- approaches: `single_mistral_medium_v3` (mistral-medium-latest), `single_qwen3_vl_8b_v3` (qwen/qwen3-vl-8b-instruct via OpenRouter, harness-drift control)
- images: 50 (gold: 235 core items)
- scored: 2026-08-24 (reviewing agent; per-image food-name matching against gold_labels.json under the four 2026-08-12 adjudication rules; images 36, 46, 47 opened and inspected directly to adjudicate hallucination calls)

## Adjudication rules (from `runs/2026-08-12-50img-SCORING.md`, applied identically to both approaches)

1. Generic labels earn no credit (itemised gold rows behind a generic term stay misses); named dishes with determinate composition DO consolidate (e.g. 'Greek salad' covers its usual components).
2. Species/kind errors are misses; prep/cut/form errors are hits (e.g. fish-for-pork = miss, ribs-for-chops = hit; organ identity counts as kind).
3. A misnamed visible object is never a hallucination -- hallucination requires a food with no referent in the photo at all.
4. Sashimi reported for nigiri is a miss (rice + form lost).

## Mechanical metrics (auto-computed, `harness.scorecard --json`)

| metric | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 |
|---|---|---|
| plates | 50 | 50 |
| schema-valid responses | 50/50 | 50/50 |
| items named (mean/plate) | 3.64 | 4.26 |
| latency median (s) | 1.61 | 1.54 |
| cost / plate (USD) | 0.002246 | 0.000137 |
| cost total (USD) | 0.112284 | 0.006861 |

### 01 — Continental/English-style breakfast plate

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/6)** | 6/6 | 6/6 |  |
| **hallucinations** | none | none |  |

### 02 — Roast (Sunday) dinner

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/5)** | 1/5 | 5/5 | mistral: 'beef and ale pie' misnames roast meat (kind/prep mismatch, not halluc); 'mixed vegetables' generic, no credit for broccoli/cabbage |
| **hallucinations** | none | none |  |

### 03 — Greek-style salad with grilled salmon

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/8)** | 7/8 | 8/8 | mistral 'greek salad' consolidates feta/olives/tomato/cucumber/lettuce/onion; avocado not covered |
| **hallucinations** | none | none |  |

### 04 — Cheeseburger with fries

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/4)** | 4/4 | 4/4 |  |
| **hallucinations** | none | none |  |

### 05 — Chicken in creamy leafy-green sauce with white rice

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/2)** | 2/2 | 1/2 | qwen 'chicken curry' drops the leafy-greens component of the one gold row |
| **hallucinations** | none | none |  |

### 06 — Sushi platter (restaurant table)

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/6)** | 5/6 | 4/6 | mistral misses wasabi; qwen reports sashimi for both nigiri rows (rule 4 miss x2) |
| **hallucinations** | none | none |  |

### 07 — Spaghetti with meat-vegetable sauce

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/5)** | 2/5 | 2/5 | both: 'mixed vegetables'/nothing generic, no credit for corn/beans/carrot |
| **hallucinations** | none | none |  |

### 08 — Yogurt granola bowl with apple

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/3)** | 3/3 | 3/3 |  |
| **hallucinations** | none | none |  |

### 09 — Whole chicken pizza in delivery box

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/1)** | 0/1 | 0/1 | neither names the chicken component of the one gold row |
| **hallucinations** | none | none |  |

### 10 — Club sandwich with side salad (cafe table)

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/2)** | 2/2 | 2/2 |  |
| **hallucinations** | none | none |  |

### 11 — Wiener Schnitzel with fries and side salad

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/3)** | 2/3 | 2/3 | both report 'fish' for the pork/veal schnitzel -- kind miss (rule 2 explicit precedent) |
| **hallucinations** | none | none |  |

### 12 — Bratwurst plate with sauerkraut and mashed potatoes

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/3)** | 3/3 | 3/3 |  |
| **hallucinations** | none | none |  |

### 13 — Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/2)** | 2/2 | 2/2 |  |
| **hallucinations** | none | none |  |

### 14 — Beef gulasch with boiled potatoes and a side bowl of lettuce

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/3)** | 3/3 | 3/3 |  |
| **hallucinations** | none | none |  |

### 15 — Bavarian Weisswurst breakfast

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/3)** | 2/3 | 3/3 | mistral omits mustard |
| **hallucinations** | none | none |  |

### 16 — Döner/gyros plate with fries and salad

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/4)** | 4/4 | 4/4 |  |
| **hallucinations** | none | none |  |

### 17 — Currywurst with French fries

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/4)** | 2/4 | 2/4 | both call the curry-ketchup 'ketchup'/'sauce' without the curry descriptor, and neither names curry powder |
| **hallucinations** | none | none |  |

### 18 — Swabian Maultaschen with potato salad

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/2)** | 1/2 | 2/2 | mistral 'creamy potato stew' vs gold potato salad -- prep/form miss |
| **hallucinations** | none | none |  |

### 19 — German fast-food mixed plate (Taxiteller)

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/5)** | 3/5 | 3/5 | neither distinctly names the sliced sausage in curry sauce or mayo |
| **hallucinations** | none | none |  |

### 20 — Bowl of shio ramen

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/4)** | 4/4 | 3/4 | qwen: chicken-for-chashu kind miss (rule 2 explicit precedent) |
| **hallucinations** | none | none |  |

### 21 — Vietnamese pho with a side plate of herb garnishes

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/6)** | 3/6 | 3/6 | both use a generic 'herbs' term, no credit for Thai basil; neither names chilli or spring onion |
| **hallucinations** | none | none |  |

### 22 — Three soft tacos with a corn cob

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/6)** | 2/6 | 2/6 | neither names cheese, red salsa, green salsa or cilantro |
| **hallucinations** | none | none |  |

### 23 — Smothered beef burrito

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/4)** | 4/4 | 3/4 | 'enchilada' for burrito treated as a misnamed-but-present object (rule 3), not a miss; qwen omits green chile sauce |
| **hallucinations** | none | none |  |

### 24 — Fish and chips with peas

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/4)** | 4/4 | 4/4 |  |
| **hallucinations** | none | none |  |

### 25 — American breakfast platter

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/7)** | 6/7 | 6/7 | both omit the maple-syrup shot glass; mistral's 'grilled cheese sandwich' credited as a misnamed toast (rule 3) |
| **hallucinations** | none | none |  |

### 26 — Indian thali on a steel tray

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/8)** | 4/8 | 2/8 | generic 'mixed curry'/'curry' rows earn no credit against the three itemised curries (kofta, paneer/fish, brinjal) or papad |
| **hallucinations** | none | none |  |

### 27 — Stir-fried chicken with peppers and steamed rice

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/5)** | 2/5 | 2/5 | neither itemises pepper/onion/spring-onion beyond a generic 'vegetables'/'sauce' |
| **hallucinations** | none | none |  |

### 28 — Middle-Eastern mezze spread — four composed plates plus flatbread

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/8)** | 0/8 | 4/8 | mistral returned zero items for this image (raw_ok true, empty list) -- a real non-answer on a dense mezze spread, not a parse failure |
| **hallucinations** | none | none |  |

### 29 — Tapas/snack flight with a wheat beer

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/4)** | 4/4 | 4/4 |  |
| **hallucinations** | none | none |  |

### 30 — Mixed grill board (plancha de grillades)

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/6)** | 5/6 | 6/6 | mistral omits the ribs slab |
| **hallucinations** | none | none |  |

### 31 — Bowl of beef/oxtail soup with buttered bread

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/3)** | 3/3 | 3/3 |  |
| **hallucinations** | none | none |  |

### 32 — Charcuterie/snack board (compartmented bamboo tray, top-down)

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/8)** | 6/8 | 7/8 | mistral's 'stuffed bell peppers' is an odd read of the pepper strips but not counted separately; qwen's 'baked eggplant slices' credited leniently against the spiced egg-half row |
| **hallucinations** | none | none |  |

### 33 — Bowl of oatmeal porridge with toppings

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/5)** | 3/5 | 4/5 | mistral 'brown sugar' does not cover peanut butter; both omit milk |
| **hallucinations** | none | none |  |

### 34 — Waffles with strawberries and whipped cream

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/4)** | 4/4 | 3/4 | qwen does not separately name sliced strawberries, only the syrup |
| **hallucinations** | none | none |  |

### 35 — Gyros/döner plate with fries and salad

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/8)** | 3/8 | 7/8 | mistral's generic 'side salad' earns no credit for the five itemised slaw/vegetable rows |
| **hallucinations** | none | none |  |

### 36 — Seafood paella in the pan

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/4)** | 2/4 | 2/4 | IMAGE VERIFIED: mistral 'chicken'+'mussels' and qwen 'mushrooms' have no referent in the photo (rice, prawns, artichoke only) -- genuine hallucinations |
| **hallucinations** | 2 | 1 |  |

### 37 — Pierogi ruskie with carrot-cabbage salad

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/3)** | 2/3 | 1/3 | qwen 'sauerkraut salad' is fermented cabbage only, no carrot -- form/composition miss vs the carrot-cabbage salad |
| **hallucinations** | none | none |  |

### 38 — Half-eaten beefburger with fries

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/2)** | 2/2 | 2/2 |  |
| **hallucinations** | none | none |  |

### 39 — Remains of a fried breakfast (mostly eaten)

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/3)** | 3/3 | 3/3 |  |
| **hallucinations** | none | none |  |

### 40 — Half-eaten liver-and-bacon fry-up with chips

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/6)** | 4/6 | 3/6 | both call the liver 'beef stew' -- organ-identity kind miss (rule 2 explicit precedent, image 40); qwen additionally omits sausage and tomato |
| **hallucinations** | none | none |  |

### 41 — Leftovers of battered fish and potato wedges

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/3)** | 3/3 | 3/3 |  |
| **hallucinations** | none | none |  |

### 42 — Buffet lunch plate (many components)

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/7)** | 5/7 | 4/7 | qwen 'breaded chicken' for the fish fillet is a kind miss (rule 2 explicit precedent, image 42) |
| **hallucinations** | none | none |  |

### 43 — Buffet lunch set — main plate, soup bowl, bread plate

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/7)** | 6/7 | 4/7 | qwen has no soup or quiche/gratin item |
| **hallucinations** | none | none |  |

### 44 — Brazilian buffet lunch plate (top-down)

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/6)** | 3/6 | 4/6 | mistral 'fried tofu'/'sauerkraut' are kind/form misses against stewed meat and braised cabbage |
| **hallucinations** | none | none |  |

### 45 — Korean hanjeongsik table spread (dozens of banchan, top-down)

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/8)** | 3/8 | 3/8 | mistral's 'noodle soup' is a form miss against japchae (stir-fried, not soup); IMAGE VERIFIED image 46 only, 45 scored from gold text + food-name matching |
| **hallucinations** | none | none |  |

### 46 — Hong Kong steamer basket of small offal dishes (dai pai dong)

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/3)** | 1/3 | 2/3 | IMAGE VERIFIED: mistral 'crispy honeycomb tofu' is a protein-kind miss vs beef tripe (not a hallucination -- referent present); mistral's 'pickled vegetables' has a referent in the visible carrot/scallion garnish inside the tripe bowls, not a hallucination; qwen's three extra organ names (tendon/cheek/heart) are dedup/over-decomposition of the two tripe dishes, not inventions -- same finding as the original 2026-08-12 scoring for this image |
| **hallucinations** | none | none |  |

### 47 — Café brunch table spread (top-down)

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/5)** | 2/5 | 4/5 | IMAGE VERIFIED: mistral's 'bacon' has no referent anywhere on the table -- hallucination; qwen's 'chocolate donut' for the bagel repeats the exact donut-for-bagel hit already established for this image in the 2026-08-12 scoring |
| **hallucinations** | 1 | none |  |

### 48 — Disposable plate of party snacks (partly eaten)

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/4)** | 3/4 | 4/4 | mistral omits samosas; qwen's 'pastries' credited leniently against samosas |
| **hallucinations** | none | none |  |

### 49 — Cafe sizzling-plate dinner set

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/6)** | 3/6 | 5/6 | mistral's 'spaghetti with tomato' is a form miss against plain buttered spaghetti; mistral's 'tomato soup' is a kind miss against the red-cabbage borscht |
| **hallucinations** | none | none |  |

### 50 — Late-night döner kebab plate with fries and salad

| gold core item | single_mistral_medium_v3 | single_qwen3_vl_8b_v3 | notes |
|---|---|---|---|
| **core recall (/7)** | 3/7 | 7/7 | mistral's generic 'side salad' earns no credit for the four itemised salad/pickle rows |
| **hallucinations** | none | none |  |

