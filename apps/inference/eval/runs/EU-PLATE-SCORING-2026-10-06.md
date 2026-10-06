# EU switch, plate photos: adjudicated scoring of the five cells (2026-10-06)

Scope: the 50 plate photos (235 gold core items) of five model-eval cells. The scoring method is the existing
one: the four adjudication rules of [`2026-08-12-50img-SCORING.md`](2026-08-12-50img-SCORING.md), the
worksheet protocol of the README (with `Y merged` for strict split recall), and `harness.scorecard`
(`--score`, `--compare`, `--granularity`). No model was called. Every number comes from the committed
`scorecard-filled.md` and `granularity.json` in each cell directory, and from that cell's `results.json`.

| cell | directory | model, host | reasoning | prompt |
|---|---|---|---|---|
| A | `eu-cell-38-prod-oldprompt` | 3.8 flash, global, `only: google-vertex` | default (no field) | OLD August prompt (`baseline`) |
| B | `eu-cell-38-newprompt` | 3.8 flash, global, `only: google-vertex` | default (no field) | production contract |
| C | `eu-cell-38-minimal-newprompt` | 3.8 flash, global, `only: google-vertex` | `minimal` | production contract |
| D | `eu-cell-35-eu-newprompt` | 3.5 flash lite, EU host, `only: google-vertex/eu` | `minimal` | production contract |
| E | `eu-cell-35-eu-oldprompt` | 3.5 flash lite, EU host, `only: google-vertex/eu` | `minimal` | OLD August prompt (`baseline`) |

## How the five cells were judged

All five answers for a plate were judged together, from one judgment table, so one name got one verdict in
every cell. Photos were opened where a name was ambiguous (plates 11, 12, 26, 28, 43, 45, 47, 50). Earlier
filled worksheets (`2026-08-12-50img-cloudbaseline`, `runpod-gpu-v3`) were used as precedent where the four
rules leave room. Where the precedent and the literal rule text disagree, the rule text won; those cases are
listed below with their effect.

## 1. Per cell

| | A 3.8 old | B 3.8 new | C 3.8 min new | D 3.5 EU new | E 3.5 EU old |
|---|---|---|---|---|---|
| adjudicated recall | **79.1 %** (186/235) | **77.4 %** (182/235) | **79.1 %** (186/235) | **67.2 %** (158/235) | **76.2 %** (179/235) |
| 95 % CI (plates, 10 000 resamples) | [72.2, 86.2] | [70.6, 84.8] | [71.8, 86.7] | [57.4, 77.2] | [69.6, 83.2] |
| hallucinations | 0 | 0 | 0 | 0 | 0 |
| trap leaks (not hallucinations) | 0 | 1 (12) | 0 | 1 (12) | 0 |
| over-decomposed | 0 | 0 | 0 | 0 | 0 |
| items per plate, all plates | 3.42 | 3.46 | 3.32 | 2.68 | 3.10 |
| items per plate, 34 plates with 4+ core | 3.794 | 3.853 | 3.647 | 2.971 | 3.471 |
| items per core item, those plates | 0.665 | 0.675 | 0.639 | 0.521 | 0.608 |
| strict split recall | 55.3 % [45.5, 65.8] | 53.2 % [43.6, 63.4] | 51.9 % [42.6, 61.7] | 37.9 % [26.6, 49.8] | 45.5 % [35.4, 56.3] |
| merged share of hits | 30.1 % | 31.3 % | 34.4 % | 43.7 % | 40.2 % |
| schema-valid | 50/50 (old schema, see note) | 50/50 strict | 50/50 strict | 50/50 strict | 50/50 (old schema, see note) |
| `unreadable` false alarms | n/a (old schema has no field) | 0 | 0 | 0 | n/a (old schema has no field) |
| total cost, 50 plates | $0.326 (price table) | $0.597 | $0.358 | $0.186 | $0.097 (price table) |
| cost per plate | $0.0065 | $0.0119 | $0.0072 | $0.0037 | $0.0019 |
| latency median | 12.18 s | 18.04 s | 8.97 s | 3.64 s | 3.11 s |
| latency p95 | 24.81 s | 29.64 s | 34.18 s | 6.60 s | 4.59 s |
| latency max | 56.06 s | 80.42 s | 192.28 s | 9.02 s | 6.31 s |
| reasoning tokens, mean | not recorded | 1083.1 | 0 | 0 | not recorded |
| completion tokens, mean | 1305.7 | 2156.6 | 881.3 | 816.9 | 446.8 |

Notes on the mechanical rows:

- **Schema-valid.** B, C and D are checked by the strict validator against the production contract
  (`schema_valid`). A and E use the old August approach, which records only `raw_ok` (parsed and valid
  against the OLD small schema). The two counts are not the same instrument.
- **`unreadable`.** Every one of the 50 corpus plates is a food plate. `gold/gold_labels.json` and the
  manifest name no non-food plate, so a non-food check (a true `unreadable`) cannot be measured on this
  corpus. On the 50 food plates, B, C and D set `unreadable: true` zero times.
- **Cost.** B, C and D are `usage.cost` from OpenRouter. A and E are the harness estimate from the price table
  in the config times the token counts (the old approach does not read `usage.cost`).
- **Latency.** Wall clock per request from bluefin (AMD Ryzen 9 7940HS) to OpenRouter, so it includes the
  network. p95 is linear interpolation over the 50 values. C has one 192 s outlier.
- **Reasoning tokens.** The old approach does not record them, so A and E show "not recorded". A sends no
  reasoning field, like B, so A thinks at the Gemini default too; its completion tokens include that thinking.

## 2. Paired comparisons (`--compare`, same 50 plates on both sides)

The marginal verdict is UNDECIDED for every pair, because all 95 % intervals overlap. The paired difference is
the more powerful test. Difference is first minus second, in recall points.

| pair | what it isolates | recall | paired difference [95 % CI] | marginal verdict | paired |
|---|---|---|---|---|---|
| B vs A | the prompt on 3.8 | 77.4 vs 79.1 | -1.7 [-3.8, 0.0] | UNDECIDED | includes 0 |
| D vs B | model and host, production prompt, 3.8 at default reasoning | 67.2 vs 77.4 | -10.2 [-19.6, -1.6] | UNDECIDED | excludes 0 |
| D vs C | model and host, production prompt, both minimal | 67.2 vs 79.1 | -11.9 [-22.3, -2.1] | UNDECIDED | excludes 0 |
| C vs B | reasoning effort on 3.8 | 79.1 vs 77.4 | +1.7 [-1.6, +5.1] | UNDECIDED | includes 0 |
| D vs E | the prompt on 3.5 | 67.2 vs 76.2 | -8.9 [-18.0, -0.8] | UNDECIDED | excludes 0 |
| **C vs D (planned decision pair)** | 3.8 reference minus 3.5 | 79.1 vs 67.2 | **+11.9 [+2.1, +22.3]** | UNDECIDED | excludes 0 |
| B vs D | 3.8 default reasoning minus 3.5 | 77.4 vs 67.2 | **+10.2 [+1.6, +19.6]** | UNDECIDED | excludes 0 |
| A vs D | production 3.8 today (old prompt) minus 3.5 | 79.1 vs 67.2 | **+11.9 [+3.6, +21.0]** | UNDECIDED | excludes 0 |

Three pairs are "undecided on marginal CIs, separable when paired" in the harness's words: 3.5 with the
production prompt (D) is below every 3.8 cell, and below 3.5 with the old prompt (E). The prompt change
and the reasoning change on 3.8 (B vs A, C vs B) are not separable from zero.

## 3. The decision rule (`.tracker/worklog/eu-switch-decision-rule.md`)

**Rule 5, recall: FAIL on every 3.8 reference.** The rule needs the upper bound of the paired 95 % CI of
(3.8 recall minus 3.5 recall) to be at most 8 points.

| pair | upper bound | rule 5 |
|---|---|---|
| C minus D (planned pair) | **+22.3 points** | fail |
| B minus D | **+19.6 points** | fail |
| A minus D (the rule's own "3.8": production 3.8, real reasoning, old prompt) | **+21.0 points** | fail |

This is not a borderline result. Even with the lenient calls of section 5 applied in D's favour only, the
upper bounds are +16.6 (C minus D), +13.6 (B minus D) and +15.1 (A minus D). The lower bound is above zero in
every strict pair, so the observed gap is a real loss, not noise.

**Rule 6, hallucinations: PASS for the plates.** D has 0, every 3.8 cell has 0. The rule counts plates and
repeats; this is one repeat of the plates only.

**Rule 1, plate part: PASS for the plates.** D is 50/50 schema-valid under the strict validator, with 0
`unreadable` false alarms on the 50 food plates. Texts, pantry and recipe calls are outside this scoring.

**Non-blocking flags.** Items per plate on plates with 4 or more core items: D is 2.971, which is 0.81 times
C (3.647), 0.78 times A (3.794) and 0.77 times B (3.853). The flag line is 0.8 times 3.8: D is under it
against A and B, and just over it against C. Strict split recall: D 37.9 % against 51.9 to 55.3 % for 3.8.

## 4. The 10 plates where D and C disagree most

Ranked by the number of gold items on which the two disagree. Plates 35 and 50 tie with 23 and 26 at 2 items.

| plate | C (3.8 minimal) said | D (3.5 EU) said | C | D | right |
|---|---|---|---|---|---|
| 25 breakfast platter | pancakes with powdered sugar and syrup, fried egg, bacon rashers, breakfast sausages, hash browns, toast | "full breakfast" | 7/7 | 0/7 | C |
| 03 salmon salad | grilled salmon fillets, Greek salad with avocado and feta | "salmon salad with feta and avocado" | 8/8 | 3/8 | C |
| 06 sushi | salmon avocado roll, assorted nigiri, soy sauce, white wine | "sushi platter", white wine | 4/6 | 0/6 | C |
| 02 roast dinner | roast beef with gravy, Yorkshire pudding, roast potatoes, cabbage and broccoli | "roast beef dinner" | 5/5 | 1/5 | C |
| 47 brunch table | avocado toast with eggs and cherry tomatoes, eggs benedict, smoothie bowl with kiwi and granola, bagel | avocado toast, "acai bowl with fruit", bagel, iced coffee, white wine | 5/5 | 2/5 | C |
| 45 Korean spread | bulgogi, glazed pork, tofu with kimchi, steamed egg, japchae, banchan | adds grilled mackerel, raw fish platter, jeon pancakes | 5/8 | 8/8 | D |
| 43 buffet set | fish cakes, rice with green beans, egg casserole, soup, baguette | bread, soup, "fried cutlets with mayonnaise and sides" | 6/7 | 3/7 | C |
| 33 porridge | "oatmeal with toppings" | oatmeal with peanut butter, honey, raisins and cinnamon | 1/5 | 4/5 | D |
| 23 wet burrito | smothered wet burrito with cheese and salad topping | "wet burrito" | 4/4 | 2/4 | C |
| 26 thali | biryani, roti and papadum, "assorted curries and dal", yogurt | adds paneer curry and vegetable curry | 5/8 | 7/8 | D |

The pattern: on the production prompt, 3.5 collapses a whole plate into one dish label far more often than
3.8. On 25, 02 and 06 that label names nothing a log can use; on 24, 35, 41 and 50 it merges the parts. Its 2.68 items per plate against 3.32 for C is the same
finding in mechanical form. With the old prompt (E), 3.5 lists more items (3.10) and scores 76.2 %.

## 5. Adjudication choices that were not obvious

Each choice was applied to all five cells. The effect column says which cells it moves.

| plate | choice | rule | effect |
|---|---|---|---|
| 06 | "sushi platter" earns nothing, not even the rolls | rule 1 names this exact label | D 0/6. The 2026-08-12 cloud sheet gave it 1/6 (rolls). |
| 06 | "assorted nigiri sushi" covers both nigiri rows (`Y merged`) | rule 4 is about sashimi; nigiri keeps rice and form | A, B, C, E +2 each |
| 07 | "vegetables" and "mixed vegetables" earn no credit for corn, beans, carrot | rule 1 lists "vegetables" | every cell 2/5. The cloud sheet credited "mixed vegetables"; following it would give C and E +3. |
| 25 | "full breakfast" earns nothing | rule 1, treated like "sushi platter" | D 0/7 |
| 02 | "roast beef dinner" credits only the beef; "mixed green vegetables" credits neither broccoli nor cabbage | rule 1 | D 1/5, E 3/5 |
| 03 | "Greek salad" covers olives, tomato, cucumber, lettuce, onion; "salmon salad" and "mediterranean salad" do not | rule 1, determinate named dish | A, B, C 8/8; D 3/8; E 3/8 |
| 11 | "breaded fish fillet" for the schnitzel is a miss (photo shows a pork or veal cutlet) | rule 2, species | D, E -1 |
| 12 | "side salad" from the background plate is a trap leak, not a hallucination | rule 3, the food is in the photo | B, D: 1 leak each |
| 21 | "beef noodle soup" counts as the pho and the beef; "fresh herbs" counts as the Thai basil | precedent (v3 sheet) | all cells 4/6 |
| 23 | "salad topping" on the burrito is the shredded lettuce | single-row salad, like plates 10, 14, 44 | C +1 |
| 26 | "vegetable curry" counts as the eggplant curry; "assorted curries" names no curry | same call as "vegetable soup" for borscht (precedent); rule 1 | D +1 |
| 28 | "chili oil" and "chili and herb dipping oil" are the green herb and chilli bowls (photo) | form, not kind | A, B, E +1 |
| 35, 50 | "mixed side salad" and "side salad" name no salad part; "with corn", "with tomatoes", "with peppers" do | rule 1 | C +1 on 35 and 50, E +2 on 35 |
| 37 | "dumplings with meat filling" for potato-cheese pierogi is a hit | form right, filling guessed (crab cake for fish cake, plate 43 precedent) | D +1 |
| 40 | "mixed grill meats" or "mixed meat" never identifies the liver | adjudicated 2026-08-12 | every cell misses it |
| 43 | "egg and bacon scramble" for the creamy stew is a miss | adjudicated 2026-08-12, same misread | E -1 |
| 45 | a hedged "fish or pork" or "spicy grilled fish" goes to the one row it can match; the mackerel is plain, the glazed dish is pork (photo) | one token, one row | C gets the pork row, E gets the fish row |
| 45 | dishes named inside "Assorted banchan (japchae, jeon, ...)" count | enumeration precedent, plate 30 | A +2 |
| 47 | "smoothie bowl with kiwi and granola" is the yogurt bowl; "acai bowl with fruit" names neither granola nor kiwi | form vs. bag label | D -1 |
| 47 | "with tomatoes" on the toast or benedict covers the cherry tomato salad, which sits on those plates (photo) | consolidation | A, C, E +1 |

**Sensitivity of rule 5 to these choices.** The strictest calls against D are 06, 25 and 02. If D gets the
rolls on 06 (+1), the canonical full-breakfast parts on 25 (+5) and the Yorkshire pudding and potatoes on
02 (+2), D rises to 166/235 (70.6 %). The upper bounds then are C minus D +16.6, B minus D +13.6, A minus D
+15.1. If C also gets "mixed vegetables" on 07, C minus D is +9.8 [+1.6, +18.1]. Rule 5 fails under every
variant.

## 6. What is UNDECIDED, and what this does not measure

- **UNDECIDED: the prompt on 3.8** (B vs A, -1.7 [-3.8, 0.0]). The production prompt does not change 3.8
  recall measurably on these plates.
- **UNDECIDED: reasoning effort on 3.8** (C vs B, +1.7 [-1.6, +5.1]). Minimal reasoning is not
  measurably worse, and it costs 40 % less with half the median latency, but its p95 is higher (one 192 s
  call).
- **Every pair is UNDECIDED on marginal intervals.** The 3.5 losses (D vs A, B, C, E) separate only on the
  paired test, as stated above.
- **Not decided here:** rules 2, 3 and 4 (pregnancy and allergen misses), the typed, pantry and recipe calls,
  and the repeats. A switch needs all six blocking rules; rule 5 already fails on the plates.
- **One repeat only.** Each cell answered each plate once. Run-to-run variance of a single model is not in
  these intervals.
- **No non-food plate** exists in the corpus, so a correct `unreadable` cannot be tested.
- Old-prompt cells (A, E) are scored on names only; their schema validity is against the old schema.

## Commands

```bash
python3 -m harness.scorecard runs/<cell>/results.json                 # worksheet
python3 -m harness.scorecard --score runs/<cell>/scorecard-filled.md  # recall, CI
python3 -m harness.scorecard --compare runs/<a>/scorecard-filled.md runs/<b>/scorecard-filled.md
python3 -m harness.scorecard runs/<cell>/results.json --granularity   # granularity.json
```
