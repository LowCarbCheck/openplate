# V4 plate cells, pooled comparison (2026-10-06)

Same 50 plates, 235 gold items, all ten sheets filled under the strict reading of rule 1. Scratch scripts: `/tmp/v4plates/`.

## Method

- Per-plate hits come from the `core recall` rows via `harness/stats.py` `parse_filled_worksheet`. Every sheet scores 50 plates and 235 items, and its cells agree with its recall rows.
- Pooled comparison: the cell value of a plate is the mean of its hits over the repeats. C3v4 has one run. The paired bootstrap resamples plates (2000 resamples, `random.Random(7)`, `bootstrap_diff_ci`), and the same plate indices apply to both sides. Model noise averages out. Plate sampling noise stays.
- Rule 5 passes when the upper bound of the 95 percent CI of (C3 minus cell) is at most 8 points. It is judged against C3v4 and against C3v3 (199/235, production prompt era).
- Cells that have no filled sheet (D3 r2 and r3, C3 v3 r2) are not used. The v3 cells are single runs.

## Pooled table (points of recall, C3 minus cell)

| cell | repeats (hits) | mean recall | C3v4 minus cell, 95% CI | rule 5 vs C3v4 | C3v3 minus cell, 95% CI | rule 5 vs C3v3 |
|---|---|---|---|---|---|---|
| C3v4 | 208 | 88.5 | reference | | +3.8 [0.0, +8.7] for C3v4 minus C3v3 | |
| F25v4 | 194, 206, 191 | 83.8 | +4.7 [-1.2, +10.5] | FAIL (10.5) | +0.9 [-5.4, +6.9] | PASS (6.9) |
| G31 | 186, 184, 179 | 77.9 | +10.6 [+4.6, +16.7] | FAIL | +6.8 [+2.0, +11.5] | FAIL (11.5) |
| O6 | 157, 147, 145 | 63.7 | +24.8 [+16.7, +32.9] | FAIL | +21.0 [+12.4, +29.9] | FAIL |

Per-repeat paired differences, C3v4 minus repeat (r1, r2, r3):

| cell | vs C3v4 | vs C3v3 |
|---|---|---|
| F25v4 | +6.0 [-0.4, 13.0], +0.9 [-4.3, 6.3], +7.2 [-1.7, 17.4] | +2.1 [-5.7, 10.3], -3.0 [-7.9, 1.8], +3.4 [-5.4, 13.8] |
| G31 | +9.4 [2.7, 16.5], +10.2 [4.1, 16.4], +12.3 [5.0, 20.2] | +5.5 [0.8, 10.3], +6.4 [1.3, 11.6], +8.5 [1.3, 16.3] |
| O6 | +21.7 [11.6, 31.3], +26.0 [18.2, 33.7], +26.8 [18.4, 35.3] | +17.9 [8.0, 28.0], +22.1 [13.7, 30.6], +23.0 [13.4, 32.5] |

Rule 5 on single repeats against C3v4: only F25 r2 passes (6.3). Against C3v3: F25 r2 (1.8) passes, F25 r1 (10.3) and r3 (13.8) fail, and G31 and O6 fail everywhere.

C3v4 is 3.8 points above C3v3 (paired CI [0.0, +8.7], one run each), so the prompt effect on C3 is positive and borderline. The reference moved up, which makes rule 5 harder against C3v4.

## Spread between repeats

| cell | min to max recall | spread | plates where the repeats differ by 3 or more hits |
|---|---|---|---|
| F25v4 | 81.3 to 87.7 | 6.4 points (15 hits) | 03 (3, 8, 4), 28 (7, 3, 4), 35 (3, 8, 2), 45 (8, 7, 0 and r3 is an error record) |
| G31 | 76.2 to 79.1 | 3.0 points (7 hits) | 03 (8, 7, 1), 06 (1, 4, 2), 32 (5, 5, 8) |
| O6 | 61.7 to 66.8 | 5.1 points (12 hits) | 06 (4, 2, 0 and r3 is an error record), 07 (5, 2, 2), 33 (5, 2, 5) |

Sensitivity: F25 r3 plate 45 and O6 r3 plate 06 score 0 as error records. If each is replaced by the mean of the other two repeats, F25 reads 84.9 with +3.6 [-1.7, +8.9] against C3v4 (still FAIL, 8.9) and -0.2 [-6.0, +5.7] against C3v3 (PASS). O6 reads 64.1 and still fails by a wide margin. No rule 5 verdict changes.

## Hallucinations and error records (rule 6: at most reference plus 1, so at most 1 here)

| cell | hallucinations r1, r2, r3 | error records r1, r2, r3 | rule 6 |
|---|---|---|---|
| C3v4 | 0 | 0 | reference |
| F25v4 | 0, 0, 0 | 0, 0, 1 (plate 45, `max_tokens` cut, schema-invalid, scored 0/8) | PASS |
| G31 | 0, 0, 0 | 0, 0, 0 | PASS |
| O6 | 1, 2, 2 (banana on 21 in all three, flatbread on 50 in r2 and r3) | 0, 0, 1 (plate 06, Azure EU 502, scored 0/6) | r1 PASS, r2 and r3 FAIL |

## Consistency across the ten sheets

- Method: `scorecard.load_memory` on the ten sheets. A hit is keyed on (plate, gold item, matched item name from the notes). A miss is keyed on every item the sheet reported on that plate. 2325 keys exist and 723 appear in more than one sheet.
- Result: **0 inconsistent verdicts.** No key carries Y or Y merged in one sheet and n in another.
- Control: flipping one hit to n in memory makes the same scan report 1 conflict, so the scan can fail.
- Other passes, also 0: names normalised to letters and digits only; a row-level pass for two sheets with the same reported list on a plate but different verdicts; a looser attribution of the 149 hit rows whose notes name no item (63 of them match a quoted name by substring, the rest by a gold word in the item name).
- Limit: the 149 unattributed hits cannot be keyed exactly. The looser pass found no clash there either.
- Correction effect: applying the stricter verdict everywhere changes 0 hits in every cell (C3v4, F25 r1 to r3, G31 r1 to r3, O6 r1 to r3). No rule 5 verdict flips, against C3v4 or C3v3.
