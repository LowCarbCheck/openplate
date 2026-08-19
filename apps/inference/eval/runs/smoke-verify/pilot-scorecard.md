# Plate-identification scoring worksheet

- results: `runs/2026-08-11-openrouter-pilot/results.json`
- config: `unknown`
- approaches: baseline, single_qwen8b, ensemble_judge
- images: 10

## Mechanical metrics (auto-computed)

| metric | baseline | single_qwen8b | ensemble_judge |
|---|---|---|---|
| plates | 10 | 10 | 10 |
| schema-valid responses | 10/10 | 10/10 | 10/10 |
| items named (total) | 29 | 30 | 36 |
| items named (mean/plate) | 2.9 | 3 | 3.6 |
| distinct item names | 29 | 30 | 35 |
| latency mean (s) | 3.27 | 9.59 | 42.48 |
| latency median (s) | 2.79 | 4.03 | 40.36 |
| latency max (s) | 5.54 | 32.76 | 69.62 |
| cost / plate (USD) | 0.001015 | 0.00041 | 0.001816 |
| cost total (USD) | 0.010154 | 0.0041 | 0.018162 |

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

> Gold-label protocol: Gold labels authored by hand from direct image inspection (Fable, 2026-08-11). 'core' = items a correct identification must include (synonyms/consolidations acceptable, e.g. 'Greek salad' may cover lettuce+cucumber+tomato). 'optional' = visible but acceptable to omit (garnish, condiments, off-plate drinks). Hallucination = any reported food not visible at all.

### 01 — Continental/English-style breakfast plate

- **baseline**: scrambled eggs, baked beans in tomato sauce, back bacon, mini sausages, rye bread, sliced cucumber
- **single_qwen8b**: whole wheat bread, bacon, sausage, baked beans, scrambled eggs, cucumber slices
- **ensemble_judge**: whole grain toast, bacon, sausages, scrambled eggs, baked beans, cucumber slices

| gold core item | baseline | single_qwen8b | ensemble_judge | notes |
|---|---|---|---|---|
| scrambled eggs |   |   |   |  |
| bacon/ham slices |   |   |   |  |
| frankfurter sausages |   |   |   |  |
| baked beans in tomato sauce |   |   |   |  |
| brown bread slice |   |   |   |  |
| cucumber slices |   |   |   |  |
| **core recall (/6)** |   |   |   |  |
| **hallucinations** |   |   |   |  |

Optional (no recall credit): butter/margarine packets

### 02 — Roast (Sunday) dinner

- **baseline**: roast beef with gravy, roast potatoes, yorkshire pudding, steamed broccoli and cabbage
- **single_qwen8b**: roast beef with Yorkshire pudding, side salad with broccoli and cabbage, roasted potatoes
- **ensemble_judge**: pot roast with gravy, roasted potatoes, mixed vegetables

| gold core item | baseline | single_qwen8b | ensemble_judge | notes |
|---|---|---|---|---|
| roast meat (lamb/beef) in gravy |   |   |   |  |
| Yorkshire pudding |   |   |   |  |
| roast potatoes |   |   |   |  |
| broccoli |   |   |   |  |
| cabbage/greens |   |   |   |  |
| **core recall (/5)** |   |   |   |  |
| **hallucinations** |   |   |   |  |

Optional (no recall credit): gravy as separate item

### 03 — Greek-style salad with grilled salmon

- **baseline**: pan-seared salmon, mediterranean salad
- **single_qwen8b**: grilled salmon, side salad with avocado, cucumber, tomato, red onion, feta cheese, and olives
- **ensemble_judge**: grilled salmon, greek salad, feta cheese, avocado, kalamata olives, cherry tomatoes

| gold core item | baseline | single_qwen8b | ensemble_judge | notes |
|---|---|---|---|---|
| grilled salmon fillets |   |   |   |  |
| feta cheese |   |   |   |  |
| kalamata olives |   |   |   |  |
| avocado |   |   |   |  |
| cherry tomatoes |   |   |   |  |
| cucumber |   |   |   |  |
| lettuce/romaine |   |   |   |  |
| red onion |   |   |   |  |
| **core recall (/8)** |   |   |   |  |
| **hallucinations** |   |   |   |  |

Optional (no recall credit): lemon wedge, side bowl of olives, dressing

### 04 — Cheeseburger with fries

- **baseline**: cheeseburger, french fries, ketchup, pickles
- **single_qwen8b**: burger with cheese, tomato, onion, and sauce, french fries, pickles
- **ensemble_judge**: cheeseburger, french fries, ketchup, pickles

| gold core item | baseline | single_qwen8b | ensemble_judge | notes |
|---|---|---|---|---|
| cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun) |   |   |   |  |
| thick-cut fries/steak fries |   |   |   |  |
| ketchup |   |   |   |  |
| pickles/gherkins |   |   |   |  |
| **core recall (/4)** |   |   |   |  |
| **hallucinations** |   |   |   |  |

Optional (no recall credit): lettuce in burger, beer in background

### 05 — Chicken in creamy leafy-green sauce with white rice

- **baseline**: chicken and spinach stew, steamed white rice
- **single_qwen8b**: white rice, chicken in curry sauce
- **ensemble_judge**: white rice, chicken and spinach stew

| gold core item | baseline | single_qwen8b | ensemble_judge | notes |
|---|---|---|---|---|
| chicken pieces in creamy sauce with leafy greens (spinach-type) |   |   |   |  |
| white rice |   |   |   |  |
| **core recall (/2)** |   |   |   |  |
| **hallucinations** |   |   |   |  |

Optional (no recall credit): red bell pepper bits in rice

### 06 — Sushi platter (restaurant table)

- **baseline**: salmon and avocado sushi rolls, assorted nigiri sushi, soy sauce
- **single_qwen8b**: sushi rolls, sashimi, wasabi, pickled ginger, soy sauce
- **ensemble_judge**: sushi rolls, nigiri sushi, soy sauce, pickled ginger, wasabi

| gold core item | baseline | single_qwen8b | ensemble_judge | notes |
|---|---|---|---|---|
| sushi rolls (salmon+avocado uramaki, sesame) |   |   |   |  |
| tuna nigiri |   |   |   |  |
| white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) |   |   |   |  |
| pickled ginger |   |   |   |  |
| wasabi |   |   |   |  |
| soy sauce |   |   |   |  |
| **core recall (/6)** |   |   |   |  |
| **hallucinations** |   |   |   |  |

Optional (no recall credit): white wine / water glasses in background

### 07 — Spaghetti with meat-vegetable sauce

- **baseline**: spaghetti bolognese with mixed vegetables
- **single_qwen8b**: spaghetti, meat sauce, green beans, corn kernels
- **ensemble_judge**: spaghetti bolognese with mixed vegetables

| gold core item | baseline | single_qwen8b | ensemble_judge | notes |
|---|---|---|---|---|
| spaghetti |   |   |   |  |
| ground beef/meat tomato sauce |   |   |   |  |
| corn kernels |   |   |   |  |
| green beans |   |   |   |  |
| carrot pieces |   |   |   |  |
| **core recall (/5)** |   |   |   |  |
| **hallucinations** |   |   |   |  |

### 08 — Yogurt granola bowl with apple

- **baseline**: yogurt, granola, apple slices
- **single_qwen8b**: yogurt with granola and apple slices
- **ensemble_judge**: yogurt, granola, apple slices

| gold core item | baseline | single_qwen8b | ensemble_judge | notes |
|---|---|---|---|---|
| yogurt |   |   |   |  |
| granola (oats/puffed grains, nuts) |   |   |   |  |
| apple slices |   |   |   |  |
| **core recall (/3)** |   |   |   |  |
| **hallucinations** |   |   |   |  |

Optional (no recall credit): raisins/dried fruit in granola, honey

### 09 — Whole chicken pizza in delivery box

- **baseline**: chicken pizza
- **single_qwen8b**: pizza
- **ensemble_judge**: chicken pizza, cola

| gold core item | baseline | single_qwen8b | ensemble_judge | notes |
|---|---|---|---|---|
| pizza with chicken pieces and cheese |   |   |   |  |
| **core recall (/1)** |   |   |   |  |
| **hallucinations** |   |   |   |  |

Optional (no recall credit): cola drink at table edge

### 10 — Club sandwich with side salad (cafe table)

- **baseline**: chicken sandwich, side salad, Pepsi Max
- **single_qwen8b**: sandwich, side salad, pepsi max
- **ensemble_judge**: chicken sandwich, side salad, cola, coffee

| gold core item | baseline | single_qwen8b | ensemble_judge | notes |
|---|---|---|---|---|
| club/toasted sandwich (multi-layer, creamy chicken/seafood filling) |   |   |   |  |
| green side salad (rocket/mixed leaves) |   |   |   |  |
| **core recall (/2)** |   |   |   |  |
| **hallucinations** |   |   |   |  |

Optional (no recall credit): Pepsi Max bottle, hot drink cup

## Totals (fill after scoring)

| metric | baseline | single_qwen8b | ensemble_judge |
|---|---|---|---|
| core-item recall (/42) |   |   |   |
| hallucinations |   |   |   |
| distinct items named (auto) | 29 | 30 | 35 |
| cost / plate (auto) | $0.00102 | $0.00041 | $0.00182 |
| latency median s (auto) | 2.79 | 4.03 | 40.36 |

## Findings

1. 
