# EU switch, plate photos: the v3 photo prompt, adjudicated scoring (2026-10-06)

Scope: the 50 plate photos (235 gold core items), answered by two new cells that use the v3 photo prompt
(commit `a5e7690f`, "the prompts name the foods behind each pregnancy flag"). v3 differs from v2 only in the
`pregnancy` flag line: each category now lists its common foods, and one sentence says that a sauce, a spread
or a filling flags the whole dish. Item rules, the confidence rubric, the allergen rules and the schema are
unchanged. The method is the same as in `EU-PLATE-SCORING-2026-10-06.md` and `EU-PLATE-SCORING-V2-2026-10-06.md`:
the four adjudication rules of [`2026-08-12-50img-SCORING.md`](2026-08-12-50img-SCORING.md), the worksheet
protocol with `Y merged`, and `harness.scorecard` (`--score`, `--compare`, `--granularity`). No model was
called for this scoring. Every number comes from the committed `scorecard-filled.md` and `granularity.json`
of each cell, and from its `results.json` (not committed).

| cell | directory | model, host | reasoning | prompt |
|---|---|---|---|---|
| D3 | `v3-eu-cell-35-eu-newprompt` | 3.5 flash lite, EU host, `only: google-vertex/eu` | `minimal` | v3 |
| C3 | `v3-eu-cell-38-minimal-newprompt` | 3.8 flash, global, `only: google-vertex` | `minimal` | v3 |
| D2, C2, B2 | `v2-eu-cell-*` | as D3, C3; B2 is 3.8 at default reasoning | as D3, C3 | v2 |
| A | `eu-cell-38-prod-oldprompt` | 3.8 flash, global | default | OLD August prompt (production today) |

**Where the v2 worksheets live.** The v2 scoring (commit `d20be7d6`) is on `feat/eu-prompt-v2` only, not on
this branch. The comparisons below read the v2 filled worksheets in place, from
`op-worktrees/prompt-v2/apps/inference/eval/runs/v2-eu-cell-*/scorecard-filled.md`. They were not copied
here. The five earlier cells (A to E) are in this worktree, byte-identical to the eval-harness worktree.

## How the two cells were judged

Each plate was judged with the D3 and C3 answers side by side with D2, C2, B2 and the five earlier cells, from
one table, so a name that appears in any earlier cell got the earlier verdict (for example D3 "breaded fish
fillet" on 11, "wet burrito" on 23 and "acai bowl with fruit" on 47 are D names; C3 "Käsespätzle with fried
onions, side salad with creamy dressing" on 13 is A's list). Only 9 of 50 D3 lists and 6 of 50 C3 lists are
word for word the v2 list of the same plate, so most plates needed a fresh call against the precedents. The
photo of plate 43 was opened.

## 1. Per cell

| | D3 3.5 EU v3 | C3 3.8 min v3 | D2 3.5 EU v2 | C2 3.8 min v2 | B2 3.8 v2 | A 3.8 old (prod) |
|---|---|---|---|---|---|---|
| adjudicated recall | **83.4 %** (196/235) | **84.7 %** (199/235) | 77.9 % (183) | 85.1 % (200) | 84.7 % (199) | 79.1 % (186) |
| 95 % CI (plates, 10 000 resamples) | [76.1, 90.2] | [78.1, 91.0] | [69.8, 85.7] | [78.0, 91.7] | [77.9, 91.2] | [72.2, 86.2] |
| hallucinations | 0 | 0 | 0 | 0 | 0 | 0 |
| trap leaks (not hallucinations) | 1 (12) | 0 | 1 (12) | 0 | 1 (12) | 0 |
| over-decomposed | 0 | 0 | 0 | 0 | 0 | 0 |
| items per plate, all plates | 3.50 | 4.00 | 3.46 | 4.02 | 4.12 | 3.42 |
| items per plate, 34 plates with 4+ core | 4.088 | 4.647 | 4.000 | 4.706 | 4.794 | 3.794 |
| items per core item, those plates | 0.716 | 0.814 | 0.701 | 0.825 | 0.840 | 0.665 |
| strict split recall | 53.2 % [41.3, 65.0] | 61.7 % [51.0, 72.9] | 52.8 % | 63.4 % | 65.1 % | 55.3 % |
| merged share of hits | 36.2 % | 27.1 % | 32.2 % | 25.5 % | 23.1 % | 30.1 % |
| schema-valid (strict validator) | 50/50 | 50/50 | 50/50 | 50/50 | 50/50 | old schema |
| `unreadable` false alarms | 0 | 0 | 0 | 0 | 0 | n/a |
| total cost, 50 plates | $0.236 | $0.448 | $0.228 | $0.428 | $0.675 | $0.326 (price table) |
| cost per plate | $0.0047 | $0.0090 | $0.0046 | $0.0086 | $0.0135 | $0.0065 |
| latency median | 3.98 s | 9.64 s | 4.07 s | 9.21 s | 18.57 s | 12.18 s |
| latency p95 | 7.60 s | 20.14 s | 8.12 s | 18.78 s | 40.21 s | 24.81 s |
| latency max | 8.94 s | 30.27 s | 8.55 s | 41.36 s | 62.96 s | 56.06 s |
| reasoning tokens, mean | 0 | 56.9 | 0 | 12.2 | 1303.1 | not recorded |
| completion tokens, mean | 1034.2 | 1229.5 | 1022.0 | 1201.7 | 2520.1 | 1305.7 |
| prompt tokens, mean | 5811 | 5811 | 5400 | 5400 | 5400 | n/a |

Notes on the mechanical rows:

- **Cost** is `usage.cost` from OpenRouter, summed over the 50 plates; it equals `_summary.total_cost_usd`.
  The v3 prompt adds 411 prompt tokens per call (+7.6 %), so cost rose by 3.2 % (D3 vs D2) and 4.8 % (C3 vs C2).
- **Latency** is wall clock per request from bluefin to OpenRouter, network included, p95 by linear
  interpolation. D3 and C3 ran at the same time (10:14 UTC), the v2 cells 28 minutes earlier.
- **Reasoning at `minimal` on 3.8** was not zero on 6 plates in C3 (06: 476, 07: 342, 16: 580, 20: 511,
  34: 306, 46: 628), against 3 plates in C2.
- **Retries.** D3 plate 30 needed 2 attempts and then returned 200. Every `finish_reason` is `stop`, and the
  summaries list no failures.
- **`unreadable`.** The corpus has no non-food plate, so only false alarms can be counted: 0 in both cells.

## 2. Paired comparisons (`--compare`, same 50 plates on both sides)

Difference is first minus second, in recall points. The marginal verdict is UNDECIDED for every pair.

| pair | what it isolates | recall | paired difference [95 % CI] | paired |
|---|---|---|---|---|
| **C3 vs D3 (decision pair)** | 3.8 minus 3.5, both minimal, v3 | 84.7 vs 83.4 | **+1.3 [-4.8, +7.8]** | includes 0 |
| D3 vs D2 | v3 against v2 on 3.5 | 83.4 vs 77.9 | **+5.5 [+0.5, +10.9]** | excludes 0 |
| C3 vs C2 | v3 against v2 on 3.8 minimal | 84.7 vs 85.1 | -0.4 [-4.8, +4.0] | includes 0 |
| **A vs D3** | production 3.8 today (old prompt) minus 3.5 v3 | 79.1 vs 83.4 | **-4.3 [-9.7, +1.3]** | includes 0 |
| B2 vs D3 | 3.8 default reasoning v2 minus 3.5 v3 | 84.7 vs 83.4 | +1.3 [-2.7, +5.4] | includes 0 |
| C2 vs D3 | 3.8 minimal v2 minus 3.5 v3 | 85.1 vs 83.4 | +1.7 [-2.7, +6.3] | includes 0 |
| C3 vs D2 | 3.8 minimal v3 minus 3.5 v2 | 84.7 vs 77.9 | +6.8 [+0.8, +13.3] | excludes 0 |

The v3 line was meant to leave item recall alone. On 3.8 it did (-0.4). On 3.5 it did not stay level: D3 is
5.5 points above D2, and the paired interval excludes 0. Section 4 asks whether the flag text caused that, or
whether it is run-to-run variance.

## 3. The decision rule, rule 5 (upper bound of the CI of 3.8 minus 3.5 at most 8 points)

| pair | difference [95 % CI] | upper bound | rule 5 |
|---|---|---|---|
| C3 minus D3 (planned pair, both on v3) | +1.3 [-4.8, +7.8] | +7.8 | **PASS**, by 0.2 points |
| A minus D3 (production reference against the candidate) | -4.3 [-9.7, +1.3] | +1.3 | **PASS** |

**The C3 minus D3 pass sits on the edge, and three calls decide it.** Three D3 hits are lenient readings of
the precedents (section 5): 20 "greens" for the mizuna topping, 28 "spicy sauce" for the herb chilli oil, and
43 "minced meat scramble" for the creamy meat stew. Reversing any one of them gives an upper bound of +7.9 to
+8.1. Reversing 20 or 43 alone turns rule 5 into FAIL. With all three reversed (D3 193/235, 82.1 %), C3 minus
D3 is +2.6 [-3.1, +8.7], FAIL. With C3's lenient feta call on 03 also reversed (C3 198/235), it is +2.1
[-3.6, +8.3], FAIL. A minus D3 passes under every variant (strict: -3.0 [-8.2, +2.2]).

**The repeat decides more than the prompt.** The pairs that mix the runs disagree: C2 minus D3 is +1.7
[-2.7, +6.3] (PASS), C3 minus D2 is +6.8 [+0.8, +13.3] (FAIL), and the v2 scoring had C2 minus D2 at +7.2
[+2.8, +12.1] (FAIL). The 3.8 cells barely moved between runs (85.1, 84.7), the 3.5 cells moved by 5.5 points.
So the v3 PASS is a property of this one 3.5 run as much as of the prompt.

**Rule 6 (hallucinations): PASS** for the plates, 0 in D3 and C3. **Rule 1 (plate part): PASS**, D3 is 50/50
schema-valid with 0 `unreadable` false alarms.

**Non-blocking flags.** Items per plate on the 34 dense plates: D3 4.088 is 0.88 times C3 (4.647) and 1.08
times A (3.794), above the 0.8 flag line. Strict split recall: D3 53.2 % against C3 61.7 %, and about level with
A (55.3 %). D3 merges more than D2 (36.2 % of hits merged, against 32.2 %).

## 4. Did the flag text change the item list?

No plate shows a recall change that the flag text clearly explains. Requests carry no `temperature`, so each
answer is one sample at the provider default, and a second sample of the same prompt also rewords plates.

**3.5, D3 against D2: +16 items on 8 plates, -3 on 3 plates, net +13.**

| plate | D3 minus D2 | what changed | flag food involved |
|---|---|---|---|
| 03 | +4 | "greek salad with feta avocado and olives" for D2 "mixed salad with ... vegetables" | no |
| 43 | +3 | rice, quiche and the creamy stew named | no |
| 28 | +3 | "falafel bowl with bulgur, lentils, and hummus", "spicy sauce" | no |
| 20 | +2 | "ramen noodle soup with pork and greens" for "ramen noodle soup" | no |
| 33 | +1 | one item, now "cooked oatmeal with milk, ..." | milk (named under raw-dairy) |
| 34 | +1 | strawberry syrup named | no |
| 35 | +1 | "with tzatziki sauce" | no |
| 42 | +1 | "chickpea curry" for D2's wrong "yellow lentil dahl" | no |
| 13, 36, 47 | -1 each | no onions, no artichoke, "acai bowl with fruit" (D's old name) | no |

**3.8, C3 against C2: +7 on 5 plates, -8 on 6 plates, net -1.** Largest moves: 35 +3 (the salad parts
named), 32 -3 ("mixed vegetable crudites" replaces cucumber, carrot and pepper sticks). None involves a flag food.

**Where a flag food did change the list,** recall did not move, or the item is optional:

- 04: both v3 cells now list the beer (C2 and D2 did not); 06: D3 adds the white wine. Optional, no credit.
- 19: D3 lists "mayonnaise" and "tzatziki" as their own items (D2 merged them); 21: D3 lists "bean sprouts"
  alone. Same recall (5/5, 4/6); strict split recall rises.
- 40: D3 names the liver ("beef stew and liver") for the first time in any 3.5 cell, and drops the grilled
  tomato. Net 0 (5/6 in both).
- 33: D3 names the milk, +1, inside one merged item.

These are the shifts that the new category lists (beer, wine, mayonnaise, bean sprouts, liver) could plausibly
cause. They are consistent with the flag text, they are not proof of it, and together they change recall by
+1 at most. The 3.5 gain of +5.5 comes mostly from plates 03, 28, 43 and 20, where no flag food is involved,
so it reads as run-to-run variance on the weak model. One repeat per cell cannot separate the two.

## 5. Adjudication choices that were not obvious

Earlier verdicts for identical names were kept. The effect column says which cell the choice moves.

| plate | choice | rule | effect |
|---|---|---|---|
| 03 | C3 "Greek salad with avocado" names no feta; feta is part of the determinate dish | rule 1 consolidation, as A, B, C, C2, B2 "Greek salad" | C3 +1 (lenient) |
| 13 | D3 "käsespätzle" names no onions | literal | D3 1/2 |
| 20 | D3 "ramen noodle soup with pork and greens": "greens" is the only leafy topping, "pork" in ramen is the chashu | like "fresh herbs" for Thai basil (21), "salad topping" for lettuce (23) | D3 +1 (lenient) |
| 28 | D3 "falafel bowl with bulgur, lentils, and hummus" names four rows | enumeration precedent (30, 45) | D3 +3 |
| 28 | D3 "flatbread with spicy sauce" for the green herb chilli oil | like D2 "spicy chili dipping sauce" (form, not kind) | D3 +1 (lenient) |
| 28 | C3 lists "falafel and mezze salad bowl" five times, one per bowl (the portion hints name five positions) | not an error class; one falafel row | C3 3/8 |
| 32 | C3 "mixed vegetable crudites" names nothing | rule 1, as "vegetable sticks" | C3 5/8 |
| 33 | D3 one item "cooked oatmeal with milk, peanut butter, honey, raisins, and cinnamon" covers all five rows | consolidation, `Y merged` | D3 5/5 |
| 34 | C3 "strawberry topping" credits one row, the strawberries, not the syrup | one token, one row, as "waffle with strawberries" | C3 3/4 (strict) |
| 40 | D3 "beef stew and liver", C3 "Steak and beef liver in gravy" name the liver | names the organ, rule 2 satisfied | both +1 |
| 43 | D3 "savory minced meat scramble" for the creamy meat stew: kind right (photo: minced meat in a creamy sauce), form wrong | rule 2, form error is a hit; the earlier misses ("egg and bacon scramble", "pasta salad with ham") were kind errors | D3 +1 (lenient) |
| 43 | C3 "pasta or potato salad with bacon bits" is the C2, B2 misread | as before | C3 miss |
| 45 | D3 "seasoned grilled fish" cannot take the glazed pork; C3 "Spicy grilled deodeok or pork" goes to the pork row | D2 call; hedge precedent (C) | D3 7/8, C3 8/8 |
| 47 | C3 "Acai smoothie bowl with kiwi and granola" is the yogurt bowl; D3 "acai bowl with fruit" is not | D's miss was for naming neither granola nor kiwi | C3 hit, D3 miss |
| 49 | D3 "minestrone soup" for the borscht bowl | C precedent | D3 hit |

## 6. What is UNDECIDED, and what this does not measure

- **UNDECIDED: 3.8 against 3.5 on v3** (C3 vs D3, +1.3 [-4.8, +7.8]). Rule 5 passes on this run by 0.2
  points and fails under the strict reading of three D3 calls.
- **UNDECIDED: the v3 line on 3.8** (C3 vs C2, -0.4 [-4.8, +4.0]). On 3.5 the paired interval excludes 0
  (+5.5 [+0.5, +10.9]), but the plates that moved involve no flag food (section 4).
- **One repeat only.** Each cell answered each plate once. The 3.5 cell moved 5.5 points between two runs
  whose prompts differ only in the flag text, which is about the size of the rule 5 margin. A rule 5 verdict
  on 3.5 needs repeats of D3 (and of C3) before it is trusted in either direction.
- **Not decided here:** rules 2, 3 and 4 (pregnancy and allergen misses under v3; the `v3-text-*` runs are
  outside this scoring), the typed, pantry and recipe calls, and confidence under v3.
- **No non-food plate** exists in the corpus, so a correct `unreadable` cannot be tested.

## Commands

```bash
python3 -m harness.scorecard runs/<cell>/results.json                 # worksheet
python3 -m harness.scorecard --score runs/<cell>/scorecard-filled.md  # recall, CI
python3 -m harness.scorecard --compare runs/<a>/scorecard-filled.md runs/<b>/scorecard-filled.md
python3 -m harness.scorecard runs/<cell>/results.json --granularity   # granularity.json
# v2 worksheets: ../../../../prompt-v2/apps/inference/eval/runs/v2-eu-cell-*/scorecard-filled.md
```
