# EU switch: the v4 prompt cells, typed holdout and plates (2026-10-06)

Written by `python3 -m harness.score_flags --config /tmp/sf-v4-F25v4.json`. No model call. The gold is
`gold/gold_text.jsonl` and `gold/gold_plate_flags.json`, read as `gold/GOLD-NOTES.md` section 2 says. The
machine readable twin of this file holds every entry, every holder and every flag.

Candidate F25v4 (2.5 flash, v4 prompt) against C3v4 (3.8 minimal, v4 prompt) and B (3.8 default reasoning,
production prompt). G31 and O6 are further v4 cells, listed without a verdict. C3 (3.8 minimal, v3 prompt) is a
reference for the main typed set. The Holdout block scores the held-out typed set (`gold/gold_text_holdout.jsonl`,
36 cases) with three repeats per cell, and rule 2 is evaluated there for F25v4. The main typed set has one run per
v4 cell, so `expected_text_repeats` is 1. F25v4 has no main typed run. A run that is missing or still being written
is named INCOMPLETE and is not scored. Runs named `worktree:directory` live in a sibling worktree.

Legend for a model item: `P[...]` pregnancy, `A[...]` allergens, `M[...]` mayContain.

## Runs

| cell | label | typed repeats scored | plate run |
|---|---|---|---|
| C3v4 | 3.8, reasoning minimal, v4 prompt | v4-text-eu-cell-38-minimal-newprompt-r1 | v4-eu-cell-38-minimal-newprompt-r1 |
| F25v4 | 2.5 flash, google-vertex/eu, minimal, v4 prompt | none | v4-eu-cell-25-flash-newprompt-r1, v4-eu-cell-25-flash-newprompt-r2, v4-eu-cell-25-flash-newprompt-r3 |
| G31 | 3.1 flash lite, minimal, v4 prompt | v4-text-eu-cell-31-lite-newprompt-r1 | v4-eu-cell-31-lite-newprompt-r1, v4-eu-cell-31-lite-newprompt-r2, v4-eu-cell-31-lite-newprompt-r3 |
| O6 | gpt 6 luna, v4 prompt | v4-text-eu-cell-gpt6-luna-newprompt-r1 | v4-eu-cell-gpt6-luna-newprompt-r1, v4-eu-cell-gpt6-luna-newprompt-r2, v4-eu-cell-gpt6-luna-newprompt-r3 |
| B | 3.8, default reasoning, production prompt | eval-harness:text-eu-cell-38-newprompt-r1, eval-harness:text-eu-cell-38-newprompt-r2, eval-harness:text-eu-cell-38-newprompt-r3 | eval-harness:eu-cell-38-newprompt |
| C3 | 3.8, reasoning minimal, v3 prompt | prompt-v3:v3-text-eu-cell-38-minimal-newprompt-r1, prompt-v3:v3-text-eu-cell-38-minimal-newprompt-r2, prompt-v3:v3-text-eu-cell-38-minimal-newprompt-r3 | prompt-v3:v3-eu-cell-38-minimal-newprompt, prompt-v3:v3-eu-cell-38-minimal-newprompt-r2 |

## Reading (written by hand, kept when the file is written again)

(not written yet)


## Decision rules

Rule 2 needs the expected number of typed repeats (fewer is INCOMPLETE) and zero clear misses in each. Rules
3 and 4 PASS only when BOTH the clear-only totals and the all-entries totals (clear plus `clear: false`) of
the test cell are no higher than the ref's; both are printed. Typed misses are summed over the repeats
(scaled to 3 when a cell has fewer). A failed call is not a flag miss, but its must_flag entries are
counted as misses in a second line per rule; when that line gives another verdict, the rule is
INCONCLUSIVE. Beside the verdict, for a reader to judge: each distinct entry counted once; the misses on
listed items only; the plates read with the recall worksheet's listing; and the strict merge view (one flag
value on an item that holds several gold foods credits one entry). None of these four decides a rule.

| rule | test | verdict | clear entries | all entries | failed calls counted as misses | distinct entries | listed items only | worksheet listing | strict merge view |
|---|---|---|---|---|---|---|---|---|---|
| 3 | F25v4 total pregnancy misses (typed plus plates) no higher than C3v4, clear entries AND all entries | **INCONCLUSIVE** | clear only: F25v4 0.67 vs C3v4 1 (PASS) (typed scaled to 3 repeats: F25v4 0, C3v4 1) (plates: mean per plate run, F25v4 3 run(s) [1, 1, 0], C3v4 1 run(s) [1]) | all entries: F25v4 1 vs C3v4 1 (PASS) | failed calls counted as misses: clear F25v4 1 vs C3v4 1 (PASS); all F25v4 1.33 vs C3v4 1 (FAIL); verdict FAIL | F25v4 2 vs C3v4 1 (FAIL) | F25v4 0.67 vs C3v4 0 (FAIL) | F25v4 0.67 vs C3v4 1.0 (PASS) | clear F25v4 2.33 vs C3v4 3 (PASS); all F25v4 2.66 vs C3v4 3 (PASS) |
| 3 | F25v4 total pregnancy misses (typed plus plates) no higher than B, clear entries AND all entries | **INCONCLUSIVE** | clear only: F25v4 0.67 vs B 0 (FAIL) (typed scaled to 3 repeats: F25v4 0, B 3) (plates: mean per plate run, F25v4 3 run(s) [1, 1, 0], B 1 run(s) [0]) | all entries: F25v4 1 vs B 0 (FAIL) | failed calls counted as misses: clear F25v4 1 vs B 1 (PASS); all F25v4 1.33 vs B 3 (PASS); verdict PASS | F25v4 2 vs B 0 (FAIL) | F25v4 0.67 vs B 0 (FAIL) | F25v4 0.67 vs B 2.0 (PASS) | clear F25v4 2.33 vs B 2 (FAIL); all F25v4 2.66 vs B 2 (FAIL) |
| 4 | F25v4 total allergen misses (typed plus plates) no higher than C3v4, clear entries AND all entries | **FAIL** | clear only: F25v4 9.33 vs C3v4 4 (FAIL) (typed scaled to 3 repeats: F25v4 0, C3v4 1) (plates: mean per plate run, F25v4 3 run(s) [9, 11, 8], C3v4 1 run(s) [4]) | all entries: F25v4 9.66 vs C3v4 5 (FAIL) | failed calls counted as misses: clear F25v4 10.33 vs C3v4 4 (FAIL); all F25v4 11.99 vs C3v4 5 (FAIL); verdict FAIL | F25v4 19 vs C3v4 4 (FAIL) | F25v4 1.33 vs C3v4 1 (FAIL) | F25v4 9.67 vs C3v4 6.0 (FAIL) | clear F25v4 14 vs C3v4 9 (FAIL); all F25v4 14.33 vs C3v4 10 (FAIL) |
| 4 | F25v4 total allergen misses (typed plus plates) no higher than B, clear entries AND all entries | **FAIL** | clear only: F25v4 9.33 vs B 2 (FAIL) (typed scaled to 3 repeats: F25v4 0, B 3) (plates: mean per plate run, F25v4 3 run(s) [9, 11, 8], B 1 run(s) [2]) | all entries: F25v4 9.66 vs B 2 (FAIL) | failed calls counted as misses: clear F25v4 10.33 vs B 6 (FAIL); all F25v4 11.99 vs B 6 (FAIL); verdict FAIL | F25v4 19 vs B 2 (FAIL) | F25v4 1.33 vs B 1 (FAIL) | F25v4 9.67 vs B 6.0 (FAIL) | clear F25v4 14 vs B 6 (FAIL); all F25v4 14.33 vs B 6 (FAIL) |

## Holdout

Typed runs of `gold/gold_text_holdout.jsonl` (36 cases), scored with the same rules as the typed set and kept apart from
it: nothing here enters the typed numbers, the plates or rules 3 and 4. Gold items are matched by word
overlap with the `core` names of the holdout file; no override is written for the holdout, so a model name
the words cannot place shows up as an item outside the gold and the gold item it should have held as one
no model item held. A run is scored only when it is finished; a missing or partial run is INCOMPLETE. Each cell needs
3 finished repeat(s).

The gold file also carries `aliases` (`gold/GOLD-NOTES.md`, the alias rule): other names, spellings and
translations of the same food, which hold a gold item beside the word overlap. A part of a combined item (the
bread of "cheese on bread") is a component alias: a flag on that part counts for the combined gold item. The
table below the numbers counts the hits that only an alias or a component made, so the effect stays visible.

| cell | label | runs listed | scored | status | runs left out |
|---|---|---|---|---|---|
| C3v4 | 3.8, reasoning minimal, v4 prompt | 3 | v4-holdout-eu-cell-38-minimal-newprompt-r1, v4-holdout-eu-cell-38-minimal-newprompt-r2, v4-holdout-eu-cell-38-minimal-newprompt-r3 | complete | none |
| F25v4 | 2.5 flash, google-vertex/eu, minimal, v4 prompt | 3 | v4-holdout-eu-cell-25-flash-newprompt-r1, v4-holdout-eu-cell-25-flash-newprompt-r2, v4-holdout-eu-cell-25-flash-newprompt-r3 | complete | none |
| G31 | 3.1 flash lite, minimal, v4 prompt | 3 | v4-holdout-eu-cell-31-lite-newprompt-r1, v4-holdout-eu-cell-31-lite-newprompt-r2, v4-holdout-eu-cell-31-lite-newprompt-r3 | complete | none |
| O6 | gpt 6 luna, v4 prompt | 3 | v4-holdout-eu-cell-gpt6-luna-newprompt-r1, v4-holdout-eu-cell-gpt6-luna-newprompt-r2, v4-holdout-eu-cell-gpt6-luna-newprompt-r3 | complete | none |

### Rule 2 on the holdout

F25v4 holdout: zero misses on the clear pregnancy must-flag holdout cases, in every repeat: **FAIL**. misses per repeat [5, 5, 5]; distinct entries missed 6. Failed calls that hold a clear pregnancy entry,
per repeat [0, 0, 0]; counted as misses: FAIL. Strict merge view:
misses per repeat [5, 5, 5] (FAIL).

### Numbers per cell (one entry per scored repeat)

| cell | repeats | preg clear misses | distinct | allergen clear misses | distinct | allergen not clear misses | preg false alarms | allergen false alarms | failed calls | items outside the gold (with flags) | gold entries with no holder |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C3v4 | 3 | [1, 1, 2] | 2 | [0, 0, 0] | 0 | [0, 0, 0] | [0, 0, 0] | [0, 0, 0] | [0, 0, 0] | [0 (0), 0 (0), 0 (0)] | [0, 0, 0] |
| F25v4 | 3 | [5, 5, 5] | 6 | [0, 1, 2] | 3 | [2, 1, 3] | [2, 5, 3] | [1, 1, 1] | [0, 0, 0] | [0 (0), 0 (0), 2 (1)] | [0, 0, 1] |
| G31 | 3 | [5, 4, 6] | 6 | [0, 0, 1] | 1 | [2, 1, 2] | [3, 4, 3] | [1, 1, 1] | [0, 0, 0] | [1 (0), 2 (0), 2 (1)] | [0, 0, 1] |
| O6 | 3 | [4, 3, 2] | 4 | [0, 0, 0] | 0 | [1, 2, 2] | [3, 2, 3] | [0, 0, 0] | [1, 1, 1] | [0 (0), 0 (0), 0 (0)] | [0, 0, 0] |

### Hits credited through aliases and components

A hit counts here when the same answer scored without aliases would not have it: an `alias` hit sits on a
model item that holds the gold item only through an alias, a `component` hit sits on a part of a combined item.
One entry per scored repeat.

| cell | repeats | hits through an alias | hits through a component |
|---|---|---|---|
| C3v4 | 3 | [3, 3, 5] | [1, 1, 2] |
| F25v4 | 3 | [5, 5, 4] | [2, 1, 2] |
| G31 | 3 | [2, 1, 3] | [2, 2, 2] |
| O6 | 3 | [3, 1, 0] | [2, 1, 1] |

#### Cell C3v4: credited entries

| case | gold item | flag | clear | via | model item(s) | repeats |
|---|---|---|---|---|---|---|
| h011 | smoked saithe slices (Seelachsschnitzel) | allergen fish | yes | alias | Seelachsschnitzel | 1 |
| h011 | smoked saithe slices (Seelachsschnitzel) | pregnancy smoked-fish | yes | alias | Seelachsschnitzel | 1 |
| h014 | rice with raw egg (tamago kake gohan) | allergen eggs | yes | alias | Tamago kake gohan with natto | 3 |
| h014 | rice with raw egg (tamago kake gohan) | allergen soybeans | no | alias | Tamago kake gohan with natto | 3 |
| h014 | rice with raw egg (tamago kake gohan) | pregnancy raw-egg | yes | alias | Tamago kake gohan with natto | 3 |
| h018 | wholegrain bread with cream cheese and sunflower sprouts | allergen gluten | yes | component | Frischkäse, Sonnenblumenkeimlinge, Vollkornbrot | 1 |
| h033 | Leerdammer cheese on bread | allergen gluten | yes | component | Brot, Leerdammer Käse, Schnittkäse (Leerdammer) | 3 |

#### Cell F25v4: credited entries

| case | gold item | flag | clear | via | model item(s) | repeats |
|---|---|---|---|---|---|---|
| h011 | smoked saithe slices (Seelachsschnitzel) | allergen fish | yes | alias | Seelachsschnitzel | 3 |
| h014 | rice with raw egg (tamago kake gohan) | allergen eggs | yes | alias | Tamago Kake Gohan, Tamago kake gohan | 3 |
| h014 | rice with raw egg (tamago kake gohan) | allergen soybeans | no | alias | Tamago Kake Gohan, Tamago kake gohan | 3 |
| h014 | rice with raw egg (tamago kake gohan) | pregnancy raw-egg | yes | alias | Tamago Kake Gohan, Tamago kake gohan | 3 |
| h018 | wholegrain bread with cream cheese and sunflower sprouts | allergen gluten | yes | component | Frischkäse, Sonnenblumenkeimlinge, Vollkornbrot | 3 |
| h021 | tabbouleh with lentil sprouts and feta | allergen gluten | yes | alias | Feta, Linsensprossen, Tabouleh, Taboulé | 2 |
| h033 | Leerdammer cheese on bread | allergen gluten | yes | component | Brot, Leerdammer, Leerdammer Käse | 2 |

#### Cell G31: credited entries

| case | gold item | flag | clear | via | model item(s) | repeats |
|---|---|---|---|---|---|---|
| h011 | smoked saithe slices (Seelachsschnitzel) | allergen fish | yes | alias | Seelachsschnitzel | 3 |
| h014 | natto | allergen soybeans | yes | alias | fermented soybeans | 1 |
| h018 | wholegrain bread with cream cheese and sunflower sprouts | allergen gluten | yes | component | Frischkäse, Sonnenblumenkeimlinge, Vollkornbrot | 3 |
| h021 | tabbouleh with lentil sprouts and feta | allergen gluten | yes | alias | Feta, Linsensprossen, Tabouleh | 2 |
| h033 | Leerdammer cheese on bread | allergen gluten | yes | component | Brot, Leerdammer Käse, Schnittkäse | 3 |

#### Cell O6: credited entries

| case | gold item | flag | clear | via | model item(s) | repeats |
|---|---|---|---|---|---|---|
| h011 | smoked saithe slices (Seelachsschnitzel) | allergen fish | yes | alias | Seelachsschnitzel | 2 |
| h014 | rice with raw egg (tamago kake gohan) | allergen eggs | yes | alias | Tamago kake gohan | 1 |
| h014 | rice with raw egg (tamago kake gohan) | pregnancy raw-egg | yes | alias | Tamago kake gohan | 1 |
| h018 | wholegrain bread with cream cheese and sunflower sprouts | allergen gluten | yes | component | Frischkäse, Sonnenblumenkeimlinge, Vollkornbrot | 1 |
| h033 | Leerdammer cheese on bread | allergen gluten | yes | component | Brot, Schnittkäse | 3 |

### Items outside the gold, per holdout cell (mapping gaps)

A model item that shares too few words with any gold food of its case. Its flags are not judged. Read the
list before you read a miss as a safety result: the gold item it should have held is `unlisted`.

#### Cell C3v4 (0 item(s), 0 gold item(s) no model item held)

None.

#### Cell F25v4 (2 item(s), 1 gold item(s) no model item held)

| case | text | model item | english | flags on it | repeats |
|---|---|---|---|---|---|
| h001 | Bresaola mit Rucola und Parmesan, dazu ein Radler | Rucola | Arugula | 0 | 1 |
| h002 | Zwei Landjäger und ein Spezi | Spezi | Spezi | 1 | 1 |

| case | text | gold item no model item held | repeats |
|---|---|---|---|
| h002 | Zwei Landjäger und ein Spezi | cola and orange soda mix (Spezi) | 1 |

#### Cell G31 (4 item(s), 2 gold item(s) no model item held)

| case | text | model item | english | flags on it | repeats |
|---|---|---|---|---|---|
| h001 | Bresaola mit Rucola und Parmesan, dazu ein Radler | Rucola | arugula | 0 | 2 |
| h001 | Bresaola mit Rucola und Parmesan, dazu ein Radler | Rucola | Arugula | 0 | 1 |
| h004 | haggis, neeps and tatties, then sherry trifle | turnips | turnips | 0 | 1 |
| h035 | a decaf latte | cappuccino | cappuccino | 1 | 1 |

| case | text | gold item no model item held | repeats |
|---|---|---|---|
| h004 | haggis, neeps and tatties, then sherry trifle | mashed swede (neeps) | 1 |
| h035 | a decaf latte | decaf latte | 1 |

#### Cell O6 (0 item(s), 0 gold item(s) no model item held)

None.

### Misses, false alarms and failed calls on the holdout

#### Cell C3v4: misses (5)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v4-holdout-eu-cell-38-minimal-newprompt-r1 | h007 | Hechtklößchen in Krebssoße | pike quenelles in crayfish sauce | pregnancy high-mercury-fish | yes | miss | Hechtklößchen in Krebssoße P['alcohol'] A['crustaceans', 'eggs', 'fish', 'gluten', 'milk'] M['celery', 'molluscs', 'sulphites'] |
| v4-holdout-eu-cell-38-minimal-newprompt-r2 | h007 | Hechtklößchen in Krebssoße | pike quenelles in crayfish sauce | pregnancy high-mercury-fish | yes | miss | Hechtklößchen in Krebssauce P['alcohol'] A['crustaceans', 'eggs', 'fish', 'gluten', 'milk'] M['celery', 'molluscs', 'sulphites'] |
| v4-holdout-eu-cell-38-minimal-newprompt-r3 | h006 | Antipasti: Crostini toscani und Wolfsbarsch-Crudo | Tuscan chicken liver crostini | pregnancy raw-meat | no | miss | Crostini toscani P['alcohol', 'liver-retinol'] A['celery', 'gluten', 'sulphites'] M['eggs', 'milk'] |
| v4-holdout-eu-cell-38-minimal-newprompt-r3 | h007 | Hechtklößchen in Krebssoße | pike quenelles in crayfish sauce | pregnancy high-mercury-fish | yes | miss | Hechtklößchen in Krebssoße P['alcohol'] A['crustaceans', 'eggs', 'fish', 'gluten', 'milk'] M['celery', 'molluscs', 'sulphites'] |
| v4-holdout-eu-cell-38-minimal-newprompt-r3 | h008 | Granatbarschfilet, 180 g, mit Salzkartoffeln | orange roughy fillet | pregnancy high-mercury-fish | yes | miss | Granatbarschfilet P[] A['fish'] M[] |

#### Cell C3v4: false alarms on must_not_flag (0)

None.

#### Cell C3v4: failed calls (0)

None.

#### Cell F25v4: misses (24)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v4-holdout-eu-cell-25-flash-newprompt-r1 | h007 | Hechtklößchen in Krebssoße | pike quenelles in crayfish sauce | pregnancy high-mercury-fish | yes | miss | Hechtklößchen P[] A['fish'] M['eggs', 'gluten', 'milk']; Krebssoße P[] A['crustaceans'] M['gluten', 'milk'] |
| v4-holdout-eu-cell-25-flash-newprompt-r1 | h008 | Granatbarschfilet, 180 g, mit Salzkartoffeln | orange roughy fillet | pregnancy high-mercury-fish | yes | miss | Granatbarschfilet P[] A['fish'] M[] |
| v4-holdout-eu-cell-25-flash-newprompt-r1 | h009 | seared ahi, 120 g, with wasabi mayo | seared ahi tuna | pregnancy raw-fish | yes | miss | Seared ahi tuna P['high-mercury-fish'] A['fish'] M[] |
| v4-holdout-eu-cell-25-flash-newprompt-r1 | h010 | Matjes Hausfrauenart mit Pellkartoffeln, dazu zwei Lachsröllchen | matjes herring in sour cream sauce | pregnancy raw-fish | yes | miss | Matjes Hausfrauenart mit Pellkartoffeln P['smoked-fish'] A['fish', 'milk'] M[] |
| v4-holdout-eu-cell-25-flash-newprompt-r1 | h011 | Katerfrühstück: Rollmops und Seelachsschnitzel auf Schwarzbrot | smoked saithe slices (Seelachsschnitzel) | pregnancy smoked-fish | yes | miss | Seelachsschnitzel P['high-mercury-fish'] A['eggs', 'fish', 'gluten'] M['milk', 'soybeans'] |
| v4-holdout-eu-cell-25-flash-newprompt-r1 | h027 | pork pie with piccalilli and a Bloody Mary | Bloody Mary | allergen fish | no | miss | Bloody Mary P['alcohol'] A[] M['celery', 'mustard'] |
| v4-holdout-eu-cell-25-flash-newprompt-r1 | h031 | Brathering mit Bratkartoffeln | fried pickled herring (Brathering) | allergen gluten | no | miss | Brathering P[] A['fish'] M[] |
| v4-holdout-eu-cell-25-flash-newprompt-r2 | h007 | Hechtklößchen in Krebssoße | pike quenelles in crayfish sauce | pregnancy high-mercury-fish | yes | miss | Hechtklößchen in Krebssoße P[] A['crustaceans', 'eggs', 'fish', 'gluten', 'milk'] M[] |
| v4-holdout-eu-cell-25-flash-newprompt-r2 | h008 | Granatbarschfilet, 180 g, mit Salzkartoffeln | orange roughy fillet | pregnancy high-mercury-fish | yes | miss | Granatbarschfilet P[] A['fish'] M[] |
| v4-holdout-eu-cell-25-flash-newprompt-r2 | h009 | seared ahi, 120 g, with wasabi mayo | seared ahi tuna | pregnancy raw-fish | yes | miss | Seared Ahi P['high-mercury-fish'] A['fish'] M[] |
| v4-holdout-eu-cell-25-flash-newprompt-r2 | h010 | Matjes Hausfrauenart mit Pellkartoffeln, dazu zwei Lachsröllchen | matjes herring in sour cream sauce | pregnancy raw-fish | yes | miss | Matjes Hausfrauenart P['smoked-fish'] A['fish', 'milk'] M['gluten', 'mustard'] |
| v4-holdout-eu-cell-25-flash-newprompt-r2 | h011 | Katerfrühstück: Rollmops und Seelachsschnitzel auf Schwarzbrot | smoked saithe slices (Seelachsschnitzel) | pregnancy smoked-fish | yes | miss | Seelachsschnitzel P[] A['eggs', 'fish', 'gluten'] M['milk'] |
| v4-holdout-eu-cell-25-flash-newprompt-r2 | h031 | Brathering mit Bratkartoffeln | fried pickled herring (Brathering) | allergen gluten | no | miss | Brathering P[] A['fish'] M[] |
| v4-holdout-eu-cell-25-flash-newprompt-r2 | h033 | Zwei Scheiben Leerdammer aufs Brot und ein Glas H-Milch | Leerdammer cheese on bread | allergen gluten | yes | miss | Leerdammer Käse P[] A['milk'] M[] |
| v4-holdout-eu-cell-25-flash-newprompt-r3 | h002 | Zwei Landjäger und ein Spezi | cola and orange soda mix (Spezi) | pregnancy caffeine | yes | unlisted_miss | not listed |
| v4-holdout-eu-cell-25-flash-newprompt-r3 | h004 | haggis, neeps and tatties, then sherry trifle | haggis | allergen gluten | yes | miss | Haggis, Neeps and Tatties P['liver-retinol'] A[] M[] |
| v4-holdout-eu-cell-25-flash-newprompt-r3 | h007 | Hechtklößchen in Krebssoße | pike quenelles in crayfish sauce | pregnancy high-mercury-fish | yes | miss | Hechtklößchen in Krebssoße P['raw-egg'] A['crustaceans', 'eggs', 'fish', 'gluten', 'milk'] M[] |
| v4-holdout-eu-cell-25-flash-newprompt-r3 | h008 | Granatbarschfilet, 180 g, mit Salzkartoffeln | orange roughy fillet | pregnancy high-mercury-fish | yes | miss | Granatbarschfilet P[] A['fish'] M[] |
| v4-holdout-eu-cell-25-flash-newprompt-r3 | h010 | Matjes Hausfrauenart mit Pellkartoffeln, dazu zwei Lachsröllchen | matjes herring in sour cream sauce | pregnancy raw-fish | yes | miss | Matjes Hausfrauenart P['smoked-fish'] A['fish', 'milk'] M['gluten', 'mustard'] |
| v4-holdout-eu-cell-25-flash-newprompt-r3 | h011 | Katerfrühstück: Rollmops und Seelachsschnitzel auf Schwarzbrot | smoked saithe slices (Seelachsschnitzel) | pregnancy smoked-fish | yes | miss | Seelachsschnitzel P[] A['fish'] M[] |
| v4-holdout-eu-cell-25-flash-newprompt-r3 | h023 | Waldorfsalat, eine kleine Schale | Waldorf salad | allergen celery | yes | miss | Waldorfsalat P['raw-egg'] A['eggs', 'nuts'] M['milk'] |
| v4-holdout-eu-cell-25-flash-newprompt-r3 | h027 | pork pie with piccalilli and a Bloody Mary | Bloody Mary | allergen fish | no | miss | Bloody Mary P['alcohol'] A[] M['celery', 'sulphites'] |
| v4-holdout-eu-cell-25-flash-newprompt-r3 | h029 | Panang-Hähnchen mit Jasminreis | panang chicken | allergen peanuts | no | miss | Panang-Hähnchen P[] A['milk'] M['crustaceans', 'fish', 'gluten', 'nuts', 'soybeans'] |
| v4-holdout-eu-cell-25-flash-newprompt-r3 | h031 | Brathering mit Bratkartoffeln | fried pickled herring (Brathering) | allergen gluten | no | miss | Brathering P[] A['fish'] M[] |

#### Cell F25v4: false alarms on must_not_flag (13)

- h004 sherry trifle: pregnancy raw-egg (in pregnancy), 1 answer(s)
- h012 bagel with Nova smoked salmon and cream cheese: pregnancy soft-cheese (in pregnancy), 2 answer(s)
- h018 wholegrain bread with cream cheese and sunflower sprouts: pregnancy soft-cheese (in pregnancy), 1 answer(s)
- h021 tabbouleh with lentil sprouts and feta: pregnancy soft-cheese (in pregnancy), 3 answer(s)
- h029 panang chicken: allergen milk (in allergens), 2 answer(s)
- h029 panang chicken: allergen milk (in mayContain), 1 answer(s)
- h034 Kassler (cured, smoked and cooked pork): pregnancy raw-meat (in pregnancy), 1 answer(s)
- h035 decaf latte: pregnancy caffeine (in pregnancy), 2 answer(s)

#### Cell F25v4: failed calls (0)

None.

#### Cell G31: misses (21)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v4-holdout-eu-cell-31-lite-newprompt-r1 | h004 | haggis, neeps and tatties, then sherry trifle | haggis | pregnancy liver-retinol | yes | miss | haggis P['raw-meat'] A['gluten'] M['celery'] |
| v4-holdout-eu-cell-31-lite-newprompt-r1 | h007 | Hechtklößchen in Krebssoße | pike quenelles in crayfish sauce | pregnancy high-mercury-fish | yes | miss | Hechtklößchen in Krebssoße P['raw-egg'] A['crustaceans', 'fish', 'gluten', 'milk'] M['celery', 'eggs', 'mustard'] |
| v4-holdout-eu-cell-31-lite-newprompt-r1 | h008 | Granatbarschfilet, 180 g, mit Salzkartoffeln | orange roughy fillet | pregnancy high-mercury-fish | yes | miss | Granatbarschfilet P[] A['fish'] M[] |
| v4-holdout-eu-cell-31-lite-newprompt-r1 | h009 | seared ahi, 120 g, with wasabi mayo | seared ahi tuna | pregnancy raw-fish | yes | miss | seared tuna P['high-mercury-fish'] A['fish'] M[] |
| v4-holdout-eu-cell-31-lite-newprompt-r1 | h011 | Katerfrühstück: Rollmops und Seelachsschnitzel auf Schwarzbrot | smoked saithe slices (Seelachsschnitzel) | pregnancy smoked-fish | yes | miss | Seelachsschnitzel P[] A['eggs', 'fish', 'gluten'] M['milk', 'soybeans'] |
| v4-holdout-eu-cell-31-lite-newprompt-r1 | h014 | tamago kake gohan with natto | rice with raw egg (tamago kake gohan) | allergen soybeans | no | miss | rice with raw egg P['raw-egg'] A['eggs'] M[] |
| v4-holdout-eu-cell-31-lite-newprompt-r1 | h027 | pork pie with piccalilli and a Bloody Mary | Bloody Mary | allergen celery | no | miss | Bloody Mary P['alcohol'] A['fish'] M[] |
| v4-holdout-eu-cell-31-lite-newprompt-r2 | h004 | haggis, neeps and tatties, then sherry trifle | haggis | pregnancy liver-retinol | yes | miss | haggis P['raw-meat'] A['gluten'] M['celery'] |
| v4-holdout-eu-cell-31-lite-newprompt-r2 | h007 | Hechtklößchen in Krebssoße | pike quenelles in crayfish sauce | pregnancy high-mercury-fish | yes | miss | Hechtklößchen in Krebssoße P['raw-egg', 'raw-fish'] A['crustaceans', 'eggs', 'fish', 'gluten', 'milk'] M['celery', 'mustard', 'soybeans'] |
| v4-holdout-eu-cell-31-lite-newprompt-r2 | h008 | Granatbarschfilet, 180 g, mit Salzkartoffeln | orange roughy fillet | pregnancy high-mercury-fish | yes | miss | Granatbarschfilet P[] A['fish'] M[] |
| v4-holdout-eu-cell-31-lite-newprompt-r2 | h011 | Katerfrühstück: Rollmops und Seelachsschnitzel auf Schwarzbrot | smoked saithe slices (Seelachsschnitzel) | pregnancy smoked-fish | yes | miss | Seelachsschnitzel P[] A['fish', 'gluten'] M['eggs', 'milk'] |
| v4-holdout-eu-cell-31-lite-newprompt-r2 | h014 | tamago kake gohan with natto | rice with raw egg (tamago kake gohan) | allergen soybeans | no | miss | rice with raw egg P['raw-egg'] A['eggs'] M[] |
| v4-holdout-eu-cell-31-lite-newprompt-r3 | h004 | haggis, neeps and tatties, then sherry trifle | haggis | pregnancy liver-retinol | yes | miss | haggis P[] A['gluten'] M[] |
| v4-holdout-eu-cell-31-lite-newprompt-r3 | h006 | Antipasti: Crostini toscani und Wolfsbarsch-Crudo | Tuscan chicken liver crostini | pregnancy liver-retinol | yes | miss | Crostini toscani P['raw-meat'] A['gluten'] M['eggs', 'milk'] |
| v4-holdout-eu-cell-31-lite-newprompt-r3 | h007 | Hechtklößchen in Krebssoße | pike quenelles in crayfish sauce | pregnancy high-mercury-fish | yes | miss | Hechtklößchen in Krebssoße P['raw-egg'] A['crustaceans', 'eggs', 'fish', 'gluten', 'milk'] M['celery', 'mustard'] |
| v4-holdout-eu-cell-31-lite-newprompt-r3 | h008 | Granatbarschfilet, 180 g, mit Salzkartoffeln | orange roughy fillet | pregnancy high-mercury-fish | yes | miss | Granatbarsch P[] A['fish'] M[] |
| v4-holdout-eu-cell-31-lite-newprompt-r3 | h009 | seared ahi, 120 g, with wasabi mayo | seared ahi tuna | pregnancy raw-fish | yes | miss | seared ahi tuna P['high-mercury-fish'] A['fish'] M[] |
| v4-holdout-eu-cell-31-lite-newprompt-r3 | h011 | Katerfrühstück: Rollmops und Seelachsschnitzel auf Schwarzbrot | smoked saithe slices (Seelachsschnitzel) | pregnancy smoked-fish | yes | miss | Seelachsschnitzel P['raw-fish'] A['fish', 'gluten'] M['eggs', 'milk'] |
| v4-holdout-eu-cell-31-lite-newprompt-r3 | h014 | tamago kake gohan with natto | rice with raw egg (tamago kake gohan) | allergen soybeans | no | miss | rice with raw egg P['raw-egg'] A['eggs'] M[] |
| v4-holdout-eu-cell-31-lite-newprompt-r3 | h029 | Panang-Hähnchen mit Jasminreis | panang chicken | allergen fish | no | miss | Panang-Hähnchen P[] A['crustaceans', 'milk'] M['nuts', 'peanuts', 'soybeans'] |
| v4-holdout-eu-cell-31-lite-newprompt-r3 | h035 | a decaf latte | decaf latte | allergen milk | yes | unlisted_miss | not listed |

#### Cell G31: false alarms on must_not_flag (13)

- h004 sherry trifle: pregnancy raw-egg (in pregnancy), 2 answer(s)
- h018 wholegrain bread with cream cheese and sunflower sprouts: pregnancy raw-dairy (in pregnancy), 1 answer(s)
- h029 panang chicken: allergen milk (in allergens), 1 answer(s)
- h029 panang chicken: allergen milk (in mayContain), 2 answer(s)
- h031 fried pickled herring (Brathering): pregnancy raw-fish (in pregnancy), 1 answer(s)
- h034 Kassler (cured, smoked and cooked pork): pregnancy raw-meat (in pregnancy), 3 answer(s)
- h036 quiche lorraine: pregnancy raw-egg (in pregnancy), 3 answer(s)

#### Cell G31: failed calls (0)

None.

#### Cell O6: misses (14)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v4-holdout-eu-cell-gpt6-luna-newprompt-r1 | h007 | Hechtklößchen in Krebssoße | pike quenelles in crayfish sauce | pregnancy high-mercury-fish | yes | miss | Hechtklößchen in Krebssoße P[] A['crustaceans', 'fish'] M['eggs', 'gluten', 'milk'] |
| v4-holdout-eu-cell-gpt6-luna-newprompt-r1 | h008 | Granatbarschfilet, 180 g, mit Salzkartoffeln | orange roughy fillet | pregnancy high-mercury-fish | yes | miss | Granatbarschfilet P[] A['fish'] M[] |
| v4-holdout-eu-cell-gpt6-luna-newprompt-r1 | h009 | seared ahi, 120 g, with wasabi mayo | seared ahi tuna | pregnancy raw-fish | yes | miss | Seared ahi tuna P['high-mercury-fish'] A['fish'] M[] |
| v4-holdout-eu-cell-gpt6-luna-newprompt-r1 | h011 | Katerfrühstück: Rollmops und Seelachsschnitzel auf Schwarzbrot | smoked saithe slices (Seelachsschnitzel) | pregnancy smoked-fish | yes | miss | Seelachsschnitzel P[] A['fish'] M['mustard', 'sulphites'] |
| v4-holdout-eu-cell-gpt6-luna-newprompt-r1 | h031 | Brathering mit Bratkartoffeln | fried pickled herring (Brathering) | allergen gluten | no | miss | Brathering P[] A['fish'] M['mustard', 'sulphites'] |
| v4-holdout-eu-cell-gpt6-luna-newprompt-r2 | h007 | Hechtklößchen in Krebssoße | pike quenelles in crayfish sauce | pregnancy high-mercury-fish | yes | miss | Hechtklößchen in Krebssoße P[] A['crustaceans', 'fish'] M['eggs', 'gluten', 'milk'] |
| v4-holdout-eu-cell-gpt6-luna-newprompt-r2 | h008 | Granatbarschfilet, 180 g, mit Salzkartoffeln | orange roughy fillet | pregnancy high-mercury-fish | yes | miss | Granatbarschfilet P[] A['fish'] M[] |
| v4-holdout-eu-cell-gpt6-luna-newprompt-r2 | h011 | Katerfrühstück: Rollmops und Seelachsschnitzel auf Schwarzbrot | smoked saithe slices (Seelachsschnitzel) | pregnancy smoked-fish | yes | miss | Seelachsschnitzel P[] A['fish'] M[] |
| v4-holdout-eu-cell-gpt6-luna-newprompt-r2 | h029 | Panang-Hähnchen mit Jasminreis | panang chicken | allergen crustaceans | no | miss | Panang-Hähnchen mit Jasminreis P[] A['fish', 'peanuts'] M['soybeans'] |
| v4-holdout-eu-cell-gpt6-luna-newprompt-r2 | h031 | Brathering mit Bratkartoffeln | fried pickled herring (Brathering) | allergen gluten | no | miss | Brathering P[] A['fish'] M['mustard'] |
| v4-holdout-eu-cell-gpt6-luna-newprompt-r3 | h007 | Hechtklößchen in Krebssoße | pike quenelles in crayfish sauce | pregnancy high-mercury-fish | yes | miss | Hechtklößchen in Krebssoße P[] A['crustaceans', 'fish'] M['celery', 'eggs', 'gluten', 'milk', 'sulphites'] |
| v4-holdout-eu-cell-gpt6-luna-newprompt-r3 | h008 | Granatbarschfilet, 180 g, mit Salzkartoffeln | orange roughy fillet | pregnancy high-mercury-fish | yes | miss | Granatbarschfilet P[] A['fish'] M[] |
| v4-holdout-eu-cell-gpt6-luna-newprompt-r3 | h014 | tamago kake gohan with natto | rice with raw egg (tamago kake gohan) | allergen soybeans | no | miss | Tamago kake gohan (raw egg over rice) P['raw-egg'] A['eggs'] M[] |
| v4-holdout-eu-cell-gpt6-luna-newprompt-r3 | h031 | Brathering mit Bratkartoffeln | fried pickled herring (Brathering) | allergen gluten | no | miss | Brathering P[] A['fish'] M[] |

#### Cell O6: false alarms on must_not_flag (8)

- h004 sherry trifle: pregnancy raw-egg (in pregnancy), 3 answer(s)
- h018 wholegrain bread with cream cheese and sunflower sprouts: pregnancy raw-dairy (in pregnancy), 2 answer(s)
- h035 decaf latte: pregnancy caffeine (in pregnancy), 3 answer(s)

#### Cell O6: failed calls (3)

- v4-holdout-eu-cell-gpt6-luna-newprompt-r1 h005: content_filter; clear must_flag entries: pregnancy liver-retinol, allergen gluten
- v4-holdout-eu-cell-gpt6-luna-newprompt-r2 h005: content_filter; clear must_flag entries: pregnancy liver-retinol, allergen gluten
- v4-holdout-eu-cell-gpt6-luna-newprompt-r3 h005: content_filter; clear must_flag entries: pregnancy liver-retinol, allergen gluten

## Miss counts per cell

Typed counts are summed over the scored repeats. `per 3` scales a cell with fewer repeats to three.
`distinct` counts an entry once however many repeats missed it. `unlisted` = the item was not in the
answer at all (a clear must_flag only); `elsewhere` = of those, the same flag sat on another item.

| cell | reps | preg clear typed | per 3 | distinct | preg clear plates | preg nonclear typed / plates | alg clear typed | per 3 | distinct | alg clear plates | alg nonclear typed / plates |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C3v4 | 1 | 0 | 0.0 | 0 | 1 | 0 / 0 | 0 | 0.0 | 0 | 4 | 0 / 1 |
| F25v4 | 0 | 0 | 0.0 | 0 | 2 | 0 / 1 | 0 | 0.0 | 0 | 28 | 0 / 1 |
| G31 | 1 | 0 | 0.0 | 0 | 4 | 2 / 0 | 7 | 21.0 | 7 | 42 | 0 / 4 |
| O6 | 1 | 0 | 0.0 | 0 | 14 | 0 / 5 | 0 | 0.0 | 0 | 101 | 0 / 9 |
| B | 3 | 0 | 0.0 | 0 | 0 | 0 / 0 | 0 | 0.0 | 0 | 2 | 0 / 0 |
| C3 | 3 | 0 | 0.0 | 0 | 0 | 0 / 0 | 0 | 0.0 | 0 | 2 | 0 / 1 |

| cell | source | clear preg tested | clear preg miss (unlisted, elsewhere) | clear alg tested | clear alg miss (unlisted, elsewhere) | if_listed misses | failed calls |
|---|---|---|---|---|---|---|---|
| C3v4 | typed | 49 | 0 (0, 0) | 117 | 0 (0, 0) | 0 | 0 |
| C3v4 | plates | 18 | 1 (1, 1) | 105 | 4 (3, 3) | 0 | 0 |
| F25v4 | plates | 55 | 2 (0, 0) | 314 | 28 (24, 23) | 1 | 1 |
| G31 | typed | 49 | 0 (0, 0) | 117 | 7 (5, 5) | 0 | 0 |
| G31 | plates | 54 | 4 (4, 4) | 315 | 42 (38, 37) | 3 | 0 |
| O6 | typed | 49 | 0 (0, 0) | 117 | 0 (0, 0) | 0 | 0 |
| O6 | plates | 49 | 14 (6, 1) | 305 | 101 (92, 72) | 4 | 1 |
| B | typed | 146 | 0 (0, 0) | 347 | 0 (0, 0) | 0 | 3 |
| B | plates | 18 | 0 (0, 0) | 105 | 2 (1, 1) | 0 | 0 |
| C3 | typed | 147 | 0 (0, 0) | 351 | 0 (0, 0) | 0 | 0 |
| C3 | plates | 37 | 0 (0, 0) | 212 | 2 (1, 1) | 0 | 0 |

## Name matching and merge leniency per cell

A model item that shares too few words with any gold food is `outside the gold`: its flags are never
judged, and the gold food it should have held shows up as `unlisted` (a clear entry of it is an
`unlisted_miss`). A new model that names foods in its own way can turn real matches into those, so the
counts are printed here. Check the names before reading a rise in misses as a safety result (`--map-dump`
prints the mapping).

An item that holds more than one gold food carries its flags for each of them. `hits via a merged item`
counts the hits credited only that way. In the strict view one flag value on one such item credits one
gold entry; `extra misses (strict)` are the further entries that lose their hit.

| cell | source | answers | items outside the gold (with flags) | gold entries with no holder | hits via a merged item, clear / not clear | extra misses (strict), clear preg / clear alg |
|---|---|---|---|---|---|---|
| C3v4 | typed | 89 | 1 (0) | 0 | 5 / 2 | 0 / 0 |
| C3v4 | plates | 50 | 10 (9) | 5 | 28 / 4 | 2 / 5 |
| F25v4 | plates | 149 | 78 (56) | 31 | 69 / 10 | 5 / 14 |
| G31 | typed | 89 | 8 (6) | 7 | 0 / 0 | 0 / 0 |
| G31 | plates | 150 | 63 (48) | 65 | 92 / 8 | 6 / 14 |
| O6 | typed | 89 | 1 (0) | 0 | 4 / 2 | 0 / 0 |
| O6 | plates | 149 | 170 (133) | 138 | 47 / 1 | 3 / 16 |
| B | typed | 264 | 3 (0) | 0 | 2 / 0 | 0 / 0 |
| B | plates | 50 | 5 (5) | 3 | 42 / 6 | 2 / 4 |
| C3 | typed | 267 | 3 (0) | 0 | 15 / 6 | 0 / 0 |
| C3 | plates | 100 | 7 (6) | 3 | 67 / 13 | 3 / 7 |

## Every miss

### Cell C3v4: pregnancy misses (1)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v4-eu-cell-38-minimal-newprompt-r1 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | pregnancy raw-fish | yes | unlisted_miss | not listed; same flag on: Assorted sashimi (Hoe) (pregnancy: raw-fish) |

### Cell C3v4: allergen misses (5)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v4-eu-cell-38-minimal-newprompt-r1 | 01 | Continental/English-style breakfast plate | brown bread slice | allergen gluten | yes | unlisted_miss | not listed; same flag on: Rye or whole grain bread (allergens: gluten), Baked beans in tomato sauce (mayContain: gluten), Cocktail sausages (mayContain: gluten) |
| v4-eu-cell-38-minimal-newprompt-r1 | 33 | Bowl of oatmeal porridge with toppings | milk | allergen milk | yes | miss | cooked oatmeal P[] A[] M['gluten'] |
| v4-eu-cell-38-minimal-newprompt-r1 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | allergen fish | yes | unlisted_miss | not listed; same flag on: Gyeran-jjim (Korean steamed eggs) (mayContain: fish), Dubu kimchi (tofu with sautéed kimchi) (mayContain: fish), Grilled mackerel (allergens: fish), Assorted Jeon (Korean savory pancakes) (mayContain: fish), Assorted sashimi (Hoe) (allergens: fish), Baechu kimchi (Napa cabbage kimchi) (mayContain: fish), Yeolmu mul-kimchi (Water kimchi) (mayContain: fish) |
| v4-eu-cell-38-minimal-newprompt-r1 | 47 | Café brunch table spread (top-down) | cherry tomato salad with balsamic drizzle | allergen sulphites | no | miss | eggs florentine with hollandaise and tomatoes P['raw-egg', 'raw-sprouts'] A['eggs', 'gluten', 'milk'] M['mustard', 'soybeans']; avocado toast with poached eggs and cherry tomatoes P['raw-egg', 'raw-sprouts'] A['eggs', 'gluten'] M['milk', 'sesame'] |
| v4-eu-cell-38-minimal-newprompt-r1 | 49 | Cafe sizzling-plate dinner set | bread bun | allergen gluten | yes | unlisted_miss | not listed; same flag on: grilled pork chop with black pepper sauce (allergens: gluten), frankfurter sausage (mayContain: gluten), spaghetti with black pepper sauce (allergens: gluten), dinner bread roll (allergens: gluten), Hong Kong style borscht / tomato vegetable soup (mayContain: gluten) |

### Cell F25v4: pregnancy misses (3)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v4-eu-cell-25-flash-newprompt-r1 | 25 | American breakfast platter | fried egg (sunny side up) | pregnancy raw-egg | yes | miss | Fried egg P[] A['eggs'] M[] |
| v4-eu-cell-25-flash-newprompt-r2 | 40 | Half-eaten liver-and-bacon fry-up with chips | fried egg (remnant, yolk visible) | pregnancy raw-egg | no | miss | fried egg P[] A['eggs'] M[] |
| v4-eu-cell-25-flash-newprompt-r2 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | pregnancy raw-fish | yes | miss | Spicy Pickled Radish (Kkakdugi) P[] A[] M['crustaceans', 'fish'] |

### Cell F25v4: allergen misses (29)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v4-eu-cell-25-flash-newprompt-r1 | 01 | Continental/English-style breakfast plate | brown bread slice | allergen gluten | yes | unlisted_miss | not listed; same flag on: Dark bread slice (allergens: gluten), Mini frankfurters (mayContain: gluten), Baked beans in tomato sauce (mayContain: gluten) |
| v4-eu-cell-25-flash-newprompt-r1 | 06 | Sushi platter (restaurant table) | sushi rolls (salmon+avocado uramaki, sesame) | allergen sesame | yes | miss | Salmon and avocado sushi roll P['raw-fish'] A['fish', 'soybeans'] M['gluten'] |
| v4-eu-cell-25-flash-newprompt-r1 | 33 | Bowl of oatmeal porridge with toppings | milk | allergen milk | yes | miss | Cooked oatmeal P[] A['gluten'] M[] |
| v4-eu-cell-25-flash-newprompt-r1 | 38 | Half-eaten beefburger with fries | beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Beef burger with bun, lettuce and tomato (allergens: gluten), French fries (mayContain: gluten) |
| v4-eu-cell-25-flash-newprompt-r1 | 38 | Half-eaten beefburger with fries | beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | allergen sesame | yes | unlisted_miss | not listed; same flag on: Beef burger with bun, lettuce and tomato (allergens: sesame) |
| v4-eu-cell-25-flash-newprompt-r1 | 46 | Hong Kong steamer basket of small offal dishes (dai pai dong) | fried beancurd-skin rolls (tofu skin rolls) | allergen soybeans | yes | unlisted_miss | not listed; same flag on: Fried bean curd rolls (allergens: soybeans) |
| v4-eu-cell-25-flash-newprompt-r1 | 47 | Café brunch table spread (top-down) | seeded bagel (dark, sesame-topped) | allergen sesame | yes | unlisted_miss | not listed; same flag on: Donut with sesame seeds (allergens: sesame) |
| v4-eu-cell-25-flash-newprompt-r1 | 47 | Café brunch table spread (top-down) | seeded bagel (dark, sesame-topped) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Berry and granola smoothie bowl (allergens: gluten), Eggs Benedict with ham (allergens: gluten), Avocado and poached egg on toast (allergens: gluten), Donut with sesame seeds (allergens: gluten) |
| v4-eu-cell-25-flash-newprompt-r1 | 49 | Cafe sizzling-plate dinner set | bread bun | allergen gluten | yes | unlisted_miss | not listed; same flag on: Grilled beef steak with gravy (mayContain: gluten), Sausage (frankfurter style) (mayContain: gluten), Spaghetti (allergens: gluten), Savory soup (mayContain: gluten), Plain white bread roll (allergens: gluten) |
| v4-eu-cell-25-flash-newprompt-r2 | 01 | Continental/English-style breakfast plate | brown bread slice | allergen gluten | yes | unlisted_miss | not listed; same flag on: Dark bread slice (allergens: gluten) |
| v4-eu-cell-25-flash-newprompt-r2 | 06 | Sushi platter (restaurant table) | sushi rolls (salmon+avocado uramaki, sesame) | allergen sesame | yes | miss | Salmon and avocado sushi roll P['raw-fish'] A['fish'] M['soybeans'] |
| v4-eu-cell-25-flash-newprompt-r2 | 22 | Three soft tacos with a corn cob | grated cheese | allergen milk | yes | unlisted_miss | not listed; same flag on: Tacos with ground meat and salsa (allergens: milk) |
| v4-eu-cell-25-flash-newprompt-r2 | 25 | American breakfast platter | toast slices | allergen gluten | yes | unlisted_miss | not listed; same flag on: Pancakes with powdered sugar (allergens: gluten), Breakfast sausages (mayContain: gluten), Hash browns (mayContain: gluten), Toasted bread (allergens: gluten) |
| v4-eu-cell-25-flash-newprompt-r2 | 28 | Middle-Eastern mezze spread, four composed plates plus flatbread | yellow bulgur or couscous | allergen gluten | yes | unlisted_miss | not listed; same flag on: Falafel bowl with mixed salads (allergens: gluten), Flatbread (allergens: gluten) |
| v4-eu-cell-25-flash-newprompt-r2 | 31 | Bowl of beef/oxtail soup with buttered bread | buttered bread slices (dark/whole-grain) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Beef Goulash (mayContain: gluten), Wholemeal bread with butter (allergens: gluten) |
| v4-eu-cell-25-flash-newprompt-r2 | 31 | Bowl of beef/oxtail soup with buttered bread | buttered bread slices (dark/whole-grain) | allergen milk | yes | unlisted_miss | not listed; same flag on: Beef Goulash (mayContain: milk), Wholemeal bread with butter (allergens: milk) |
| v4-eu-cell-25-flash-newprompt-r2 | 35 | Gyros/döner plate with fries and salad | pickled green chili pepper | allergen sulphites | no | miss | Mixed salad (lettuce, tomato, cucumber, corn, carrot, olive, pickled pepper) P[] A[] M[] |
| v4-eu-cell-25-flash-newprompt-r2 | 47 | Café brunch table spread (top-down) | yogurt bowl with granola, kiwi slices and berry compote | allergen milk | yes | miss | Fruit and granola smoothie bowl P[] A['gluten', 'nuts'] M[] |
| v4-eu-cell-25-flash-newprompt-r2 | 47 | Café brunch table spread (top-down) | seeded bagel (dark, sesame-topped) | allergen sesame | yes | unlisted_miss | not listed |
| v4-eu-cell-25-flash-newprompt-r2 | 47 | Café brunch table spread (top-down) | seeded bagel (dark, sesame-topped) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Fruit and granola smoothie bowl (allergens: gluten), Eggs Benedict (allergens: gluten), Avocado toast with poached egg (allergens: gluten), Chocolate donut with sprinkles (allergens: gluten) |
| v4-eu-cell-25-flash-newprompt-r2 | 49 | Cafe sizzling-plate dinner set | bread bun | allergen gluten | yes | unlisted_miss | not listed; same flag on: Steak with brown sauce (mayContain: gluten), Spaghetti (allergens: gluten), Cooked sausage (mayContain: gluten), Savory soup (mayContain: gluten), White bread roll (allergens: gluten) |
| v4-eu-cell-25-flash-newprompt-r3 | 01 | Continental/English-style breakfast plate | brown bread slice | allergen gluten | yes | unlisted_miss | not listed; same flag on: Dark bread slice (allergens: gluten), Small sausages (mayContain: gluten), Baked beans in tomato sauce (mayContain: gluten) |
| v4-eu-cell-25-flash-newprompt-r3 | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Cheesy noodles with caramelized onions (allergens: gluten) |
| v4-eu-cell-25-flash-newprompt-r3 | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen eggs | yes | unlisted_miss | not listed; same flag on: Mixed salad with creamy dressing (mayContain: eggs) |
| v4-eu-cell-25-flash-newprompt-r3 | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen milk | yes | unlisted_miss | not listed; same flag on: Cheesy noodles with caramelized onions (allergens: milk), Mixed salad with creamy dressing (allergens: milk) |
| v4-eu-cell-25-flash-newprompt-r3 | 35 | Gyros/döner plate with fries and salad | white garlic-yogurt sauce (tzatziki) with oregano | allergen milk | yes | unlisted_miss | not listed; same flag on: Doner meat with sauce (allergens: milk) |
| v4-eu-cell-25-flash-newprompt-r3 | 38 | Half-eaten beefburger with fries | beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Beef burger with bun and vegetables (allergens: gluten), French fries (mayContain: gluten) |
| v4-eu-cell-25-flash-newprompt-r3 | 38 | Half-eaten beefburger with fries | beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | allergen sesame | yes | unlisted_miss | not listed; same flag on: Beef burger with bun and vegetables (allergens: sesame) |
| v4-eu-cell-25-flash-newprompt-r3 | 49 | Cafe sizzling-plate dinner set | bread bun | allergen gluten | yes | unlisted_miss | not listed; same flag on: Grilled steak with gravy (mayContain: gluten), Cooked sausage (mayContain: gluten), Spaghetti (allergens: gluten), Hearty soup (mayContain: gluten), Soft bread roll (allergens: gluten) |

### Cell G31: pregnancy misses (6)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v4-text-eu-cell-31-lite-newprompt-r1 | t055 | 40 g of Comté | Comté cheese | pregnancy raw-dairy | no | miss | Comté cheese P[] A['milk'] M[] |
| v4-text-eu-cell-31-lite-newprompt-r1 | t078 | Un verre de vin blanc et un morceau de Roquefort | Roquefort | pregnancy raw-dairy | no | miss | roquefort P['soft-cheese'] A['milk'] M[] |
| v4-eu-cell-31-lite-newprompt-r1 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | pregnancy raw-egg | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (pregnancy: raw-egg) |
| v4-eu-cell-31-lite-newprompt-r2 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | pregnancy raw-fish | yes | unlisted_miss | not listed; same flag on: sashimi (pregnancy: raw-fish) |
| v4-eu-cell-31-lite-newprompt-r2 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | pregnancy raw-egg | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (pregnancy: raw-egg) |
| v4-eu-cell-31-lite-newprompt-r3 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | pregnancy raw-egg | yes | unlisted_miss | not listed; same flag on: Avocado toast with poached egg (pregnancy: raw-egg) |

### Cell G31: allergen misses (53)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v4-text-eu-cell-31-lite-newprompt-r1 | t028 | Eine Scheibe Weißbrot mit 20 g Nutella | Nutella | allergen nuts | yes | unlisted_miss | not listed; same flag on: Haselnuss-Nugat-Creme (allergens: nuts) |
| v4-text-eu-cell-31-lite-newprompt-r1 | t028 | Eine Scheibe Weißbrot mit 20 g Nutella | Nutella | allergen milk | yes | unlisted_miss | not listed; same flag on: Weißbrot (mayContain: milk), Haselnuss-Nugat-Creme (allergens: milk) |
| v4-text-eu-cell-31-lite-newprompt-r1 | t045 | Brie and grape sandwich on sourdough | brie and grape sandwich | allergen gluten | yes | miss | brie P['soft-cheese'] A['milk'] M[]; grapes P[] A[] M[] |
| v4-text-eu-cell-31-lite-newprompt-r1 | t061 | A Big Mac and medium fries | Big Mac | allergen gluten | yes | unlisted_miss | not listed; same flag on: hamburger (allergens: gluten), french fries (mayContain: gluten) |
| v4-text-eu-cell-31-lite-newprompt-r1 | t061 | A Big Mac and medium fries | Big Mac | allergen sesame | yes | unlisted_miss | not listed; same flag on: hamburger (allergens: sesame) |
| v4-text-eu-cell-31-lite-newprompt-r1 | t061 | A Big Mac and medium fries | Big Mac | allergen milk | yes | unlisted_miss | not listed; same flag on: hamburger (allergens: milk), french fries (mayContain: milk) |
| v4-text-eu-cell-31-lite-newprompt-r1 | t065 | Celery sticks with hummus | celery sticks | allergen celery | yes | miss | celery P[] A[] M[] |
| v4-eu-cell-31-lite-newprompt-r1 | 06 | Sushi platter (restaurant table) | soy sauce | allergen soybeans | yes | unlisted_miss | not listed |
| v4-eu-cell-31-lite-newprompt-r1 | 18 | Swabian Maultaschen with potato salad | Maultaschen (filled pasta pockets with meat filling) | allergen gluten | yes | unlisted_miss | not listed; same flag on: meat-filled dumplings (allergens: gluten) |
| v4-eu-cell-31-lite-newprompt-r1 | 23 | Smothered beef burrito | shredded cheddar/jack cheese | allergen milk | yes | unlisted_miss | not listed; same flag on: smothered burrito with toppings (allergens: milk) |
| v4-eu-cell-31-lite-newprompt-r1 | 26 | Indian thali on a steel tray | chapati/roti | allergen gluten | yes | unlisted_miss | not listed; same flag on: vegetable fried rice (mayContain: gluten), plain paratha (allergens: gluten), kofta curry (mayContain: gluten) |
| v4-eu-cell-31-lite-newprompt-r1 | 28 | Middle-Eastern mezze spread, four composed plates plus flatbread | yellow bulgur or couscous | allergen gluten | yes | unlisted_miss | not listed; same flag on: meze bowl (allergens: gluten), pita bread (allergens: gluten) |
| v4-eu-cell-31-lite-newprompt-r1 | 35 | Gyros/döner plate with fries and salad | white garlic-yogurt sauce (tzatziki) with oregano | allergen milk | yes | unlisted_miss | not listed; same flag on: doner kebab meat (mayContain: milk), tzatziki sauce (allergens: milk) |
| v4-eu-cell-31-lite-newprompt-r1 | 38 | Half-eaten beefburger with fries | beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | allergen gluten | yes | unlisted_miss | not listed; same flag on: cheeseburger (allergens: gluten), french fries (mayContain: gluten) |
| v4-eu-cell-31-lite-newprompt-r1 | 38 | Half-eaten beefburger with fries | beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | allergen sesame | yes | unlisted_miss | not listed; same flag on: cheeseburger (allergens: sesame) |
| v4-eu-cell-31-lite-newprompt-r1 | 43 | Buffet lunch set, main plate, soup bowl, bread plate | cheese-topped quiche/gratin square | allergen milk | yes | unlisted_miss | not listed; same flag on: creamy grits with bacon (allergens: milk), bread with butter (allergens: milk), potato and egg frittata (allergens: milk), breaded fish cakes with sour cream (allergens: milk), creamy meat and vegetable side (allergens: milk) |
| v4-eu-cell-31-lite-newprompt-r1 | 46 | Hong Kong steamer basket of small offal dishes (dai pai dong) | fried beancurd-skin rolls (tofu skin rolls) | allergen soybeans | yes | unlisted_miss | not listed; same flag on: steamed bean curd rolls (allergens: soybeans), steamed beef tripe (mayContain: soybeans) |
| v4-eu-cell-31-lite-newprompt-r1 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen eggs | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (allergens: eggs), bagel (mayContain: eggs) |
| v4-eu-cell-31-lite-newprompt-r1 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen gluten | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (allergens: gluten), bagel (allergens: gluten) |
| v4-eu-cell-31-lite-newprompt-r1 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen milk | yes | unlisted_miss | not listed; same flag on: bagel (mayContain: milk), smoothie bowl (mayContain: milk), iced coffee (allergens: milk), beetroot latte (allergens: milk) |
| v4-eu-cell-31-lite-newprompt-r1 | 47 | Café brunch table spread (top-down) | yogurt bowl with granola, kiwi slices and berry compote | allergen milk | yes | unlisted_miss | not listed; same flag on: bagel (mayContain: milk), smoothie bowl (mayContain: milk), iced coffee (allergens: milk), beetroot latte (allergens: milk) |
| v4-eu-cell-31-lite-newprompt-r1 | 47 | Café brunch table spread (top-down) | yogurt bowl with granola, kiwi slices and berry compote | allergen gluten | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (allergens: gluten), bagel (allergens: gluten) |
| v4-eu-cell-31-lite-newprompt-r2 | 01 | Continental/English-style breakfast plate | brown bread slice | allergen gluten | yes | unlisted_miss | not listed; same flag on: cocktail sausages (mayContain: gluten), wholemeal bread (allergens: gluten) |
| v4-eu-cell-31-lite-newprompt-r2 | 03 | Greek-style salad with grilled salmon | feta cheese | allergen milk | yes | unlisted_miss | not listed; same flag on: greek salad (allergens: milk) |
| v4-eu-cell-31-lite-newprompt-r2 | 05 | Chicken in creamy leafy-green sauce with white rice | chicken pieces in creamy sauce with leafy greens (spinach-type) | allergen milk | no | miss | chicken and spinach stew P[] A[] M['celery'] |
| v4-eu-cell-31-lite-newprompt-r2 | 18 | Swabian Maultaschen with potato salad | Maultaschen (filled pasta pockets with meat filling) | allergen gluten | yes | unlisted_miss | not listed; same flag on: meat-filled pasta rolls (allergens: gluten) |
| v4-eu-cell-31-lite-newprompt-r2 | 32 | Charcuterie/snack board (compartmented bamboo tray, top-down) | herb crackers | allergen sesame | no | miss | crackers P[] A['gluten'] M['milk', 'nuts', 'soybeans'] |
| v4-eu-cell-31-lite-newprompt-r2 | 35 | Gyros/döner plate with fries and salad | white garlic-yogurt sauce (tzatziki) with oregano | allergen milk | yes | unlisted_miss | not listed; same flag on: doner kebab meat (mayContain: milk), tzatziki sauce (allergens: milk) |
| v4-eu-cell-31-lite-newprompt-r2 | 38 | Half-eaten beefburger with fries | beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | allergen gluten | yes | unlisted_miss | not listed; same flag on: cheeseburger (allergens: gluten), french fries (mayContain: gluten) |
| v4-eu-cell-31-lite-newprompt-r2 | 38 | Half-eaten beefburger with fries | beefburger in sesame bun (bitten; lettuce, tomato, onion visible) | allergen sesame | yes | unlisted_miss | not listed; same flag on: cheeseburger (allergens: sesame) |
| v4-eu-cell-31-lite-newprompt-r2 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | allergen fish | yes | unlisted_miss | not listed; same flag on: grilled mackerel (allergens: fish), sashimi (allergens: fish), tofu with kimchi (mayContain: fish), banchan side dishes (mayContain: fish) |
| v4-eu-cell-31-lite-newprompt-r2 | 46 | Hong Kong steamer basket of small offal dishes (dai pai dong) | fried beancurd-skin rolls (tofu skin rolls) | allergen soybeans | yes | unlisted_miss | not listed; same flag on: steamed bean curd rolls (allergens: soybeans) |
| v4-eu-cell-31-lite-newprompt-r2 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen eggs | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (allergens: eggs) |
| v4-eu-cell-31-lite-newprompt-r2 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen gluten | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (allergens: gluten), bagel (allergens: gluten) |
| v4-eu-cell-31-lite-newprompt-r2 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen milk | yes | unlisted_miss | not listed; same flag on: iced coffee (allergens: milk), beetroot latte (allergens: milk) |
| v4-eu-cell-31-lite-newprompt-r2 | 47 | Café brunch table spread (top-down) | yogurt bowl with granola, kiwi slices and berry compote | allergen milk | yes | unlisted_miss | not listed; same flag on: iced coffee (allergens: milk), beetroot latte (allergens: milk) |
| v4-eu-cell-31-lite-newprompt-r2 | 47 | Café brunch table spread (top-down) | yogurt bowl with granola, kiwi slices and berry compote | allergen gluten | yes | unlisted_miss | not listed; same flag on: avocado toast with poached egg (allergens: gluten), bagel (allergens: gluten) |
| v4-eu-cell-31-lite-newprompt-r2 | 49 | Cafe sizzling-plate dinner set | spaghetti (plain, buttered) | allergen gluten | yes | unlisted_miss | not listed; same flag on: grilled pork chop with pasta and sausage (allergens: gluten), bread roll (allergens: gluten) |
| v4-eu-cell-31-lite-newprompt-r3 | 03 | Greek-style salad with grilled salmon | feta cheese | allergen milk | yes | unlisted_miss | not listed; same flag on: mediterranean salad (allergens: milk) |
| v4-eu-cell-31-lite-newprompt-r3 | 08 | Yogurt granola bowl with apple | raisins/dried fruit in granola | allergen sulphites | no | miss | yogurt with sliced apples and granola P[] A['gluten', 'milk'] M['nuts', 'peanuts', 'soybeans'] |
| v4-eu-cell-31-lite-newprompt-r3 | 18 | Swabian Maultaschen with potato salad | Maultaschen (filled pasta pockets with meat filling) | allergen gluten | yes | unlisted_miss | not listed; same flag on: meat-filled dumplings (allergens: gluten) |
| v4-eu-cell-31-lite-newprompt-r3 | 22 | Three soft tacos with a corn cob | grated cheese | allergen milk | yes | unlisted_miss | not listed; same flag on: beef tacos with toppings (allergens: milk) |
| v4-eu-cell-31-lite-newprompt-r3 | 29 | Tapas/snack flight with a wheat beer | creamy dip/cream cheese with the pickles | allergen milk | yes | miss | gherkin pickles P[] A['mustard'] M[] |
| v4-eu-cell-31-lite-newprompt-r3 | 35 | Gyros/döner plate with fries and salad | white garlic-yogurt sauce (tzatziki) with oregano | allergen milk | yes | unlisted_miss | not listed; same flag on: doner kebab meat (mayContain: milk), tzatziki sauce (allergens: milk) |
| v4-eu-cell-31-lite-newprompt-r3 | 37 | Pierogi ruskie with carrot-cabbage salad | pierogi/boiled dumplings (potato-cheese filling) | allergen milk | yes | miss | dumplings with meat and onion topping P[] A['eggs', 'gluten'] M[] |
| v4-eu-cell-31-lite-newprompt-r3 | 42 | Buffet lunch plate (many components) | sour cream / remoulade dollop | allergen milk | no | miss | breaded fried fish with mayonnaise P['raw-egg'] A['eggs', 'fish', 'gluten'] M[] |
| v4-eu-cell-31-lite-newprompt-r3 | 43 | Buffet lunch set, main plate, soup bowl, bread plate | breaded croquettes/fish cakes topped with mayonnaise-aioli | allergen eggs | yes | miss | potato cake with sour cream P[] A['milk'] M['gluten'] |
| v4-eu-cell-31-lite-newprompt-r3 | 43 | Buffet lunch set, main plate, soup bowl, bread plate | cheese-topped quiche/gratin square | allergen milk | yes | unlisted_miss | not listed; same flag on: creamy grits with bacon (allergens: milk), bread with butter (allergens: milk), potato cake with sour cream (allergens: milk), cheesy vegetable bake (allergens: milk), scrambled eggs with ham (mayContain: milk) |
| v4-eu-cell-31-lite-newprompt-r3 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen eggs | yes | unlisted_miss | not listed; same flag on: Avocado toast with poached egg (allergens: eggs) |
| v4-eu-cell-31-lite-newprompt-r3 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen gluten | yes | unlisted_miss | not listed; same flag on: Acai bowl with fruit (mayContain: gluten), Avocado toast with poached egg (allergens: gluten), Sesame bagel (allergens: gluten) |
| v4-eu-cell-31-lite-newprompt-r3 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | allergen milk | yes | unlisted_miss | not listed; same flag on: Beetroot latte (allergens: milk), Iced coffee (allergens: milk), Sesame bagel (mayContain: milk) |
| v4-eu-cell-31-lite-newprompt-r3 | 47 | Café brunch table spread (top-down) | yogurt bowl with granola, kiwi slices and berry compote | allergen milk | yes | miss | Acai bowl with fruit P[] A[] M['gluten', 'nuts'] |
| v4-eu-cell-31-lite-newprompt-r3 | 49 | Cafe sizzling-plate dinner set | spaghetti (plain, buttered) | allergen gluten | yes | unlisted_miss | not listed; same flag on: grilled pork chop with pasta (allergens: gluten), sausage (mayContain: gluten), bread roll (allergens: gluten) |

### Cell O6: pregnancy misses (19)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v4-eu-cell-gpt6-luna-newprompt-r1 | 06 | Sushi platter (restaurant table) | white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | pregnancy raw-fish | yes | unlisted_miss | not listed; same flag on: Assorted sushi rolls (pregnancy: raw-fish), Salmon sashimi (pregnancy: raw-fish), Tuna sashimi (pregnancy: raw-fish) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 21 | Vietnamese pho with a side plate of herb garnishes | bean sprouts | pregnancy raw-sprouts | yes | miss | Beef and green bean stir-fry P[] A[] M['gluten', 'soybeans'] |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 40 | Half-eaten liver-and-bacon fry-up with chips | liver pieces in gravy | pregnancy liver-retinol | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 40 | Half-eaten liver-and-bacon fry-up with chips | fried egg (remnant, yolk visible) | pregnancy raw-egg | no | miss | Fried egg P[] A['eggs'] M[] |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | pregnancy raw-fish | yes | miss | Grilled fish P[] A['fish'] M[] |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 47 | Café brunch table spread (top-down) | avocado toast/bagel halves with poached eggs | pregnancy raw-egg | no | miss | Avocado toast with creamy topping P[] A['gluten'] M['eggs', 'milk'] |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | pregnancy raw-egg | yes | miss | Avocado toast with creamy topping P[] A['gluten'] M['eggs', 'milk'] |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 21 | Vietnamese pho with a side plate of herb garnishes | bean sprouts | pregnancy raw-sprouts | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 40 | Half-eaten liver-and-bacon fry-up with chips | liver pieces in gravy | pregnancy liver-retinol | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | pregnancy raw-fish | yes | miss | Grilled fish fillet P[] A['fish'] M[] |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 47 | Café brunch table spread (top-down) | avocado toast/bagel halves with poached eggs | pregnancy raw-egg | no | miss | Avocado toast bites with egg P[] A['eggs', 'gluten'] M['milk', 'sesame'] |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | pregnancy raw-egg | yes | miss | Avocado toast bites with egg P[] A['eggs', 'gluten'] M['milk', 'sesame'] |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 21 | Vietnamese pho with a side plate of herb garnishes | bean sprouts | pregnancy raw-sprouts | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 25 | American breakfast platter | fried egg (sunny side up) | pregnancy raw-egg | yes | miss | Fried egg P[] A['eggs'] M[] |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 40 | Half-eaten liver-and-bacon fry-up with chips | liver pieces in gravy | pregnancy liver-retinol | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 40 | Half-eaten liver-and-bacon fry-up with chips | fried egg (remnant, yolk visible) | pregnancy raw-egg | no | miss | fried egg P[] A['eggs'] M[] |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | sliced raw fish (hoe/sashimi) on shredded radish | pregnancy raw-fish | yes | miss | Grilled fish fillet P[] A['fish'] M[] |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 47 | Café brunch table spread (top-down) | avocado toast/bagel halves with poached eggs | pregnancy raw-egg | no | miss | Savory toast with creamy topping P[] A['gluten', 'milk'] M['eggs', 'soybeans']; Avocado toast with a creamy topping P[] A['gluten', 'milk'] M['eggs', 'sesame', 'soybeans']; Sesame bagel P[] A['gluten', 'sesame'] M['eggs', 'milk', 'soybeans'] |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 47 | Café brunch table spread (top-down) | eggs benedict with hollandaise on avocado toast | pregnancy raw-egg | yes | miss | Savory toast with creamy topping P[] A['gluten', 'milk'] M['eggs', 'soybeans']; Avocado toast with a creamy topping P[] A['gluten', 'milk'] M['eggs', 'sesame', 'soybeans'] |

### Cell O6: allergen misses (110)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| v4-eu-cell-gpt6-luna-newprompt-r1 | 01 | Continental/English-style breakfast plate | brown bread slice | allergen gluten | yes | unlisted_miss | not listed; same flag on: dark wholegrain bread (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 02 | Roast (Sunday) dinner | Yorkshire pudding | allergen gluten | yes | unlisted_miss | not listed; same flag on: Roasted chicken with brown gravy (mayContain: gluten), Mixed cooked vegetables (mayContain: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 02 | Roast (Sunday) dinner | Yorkshire pudding | allergen eggs | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 02 | Roast (Sunday) dinner | Yorkshire pudding | allergen milk | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 06 | Sushi platter (restaurant table) | white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream) | allergen fish | yes | unlisted_miss | not listed; same flag on: Assorted sushi rolls (allergens: fish), Salmon sashimi (allergens: fish), Tuna sashimi (allergens: fish) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 07 | Spaghetti with meat-vegetable sauce | spaghetti | allergen gluten | yes | unlisted_miss | not listed; same flag on: Stir-fried noodles (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 08 | Yogurt granola bowl with apple | yogurt | allergen milk | yes | unlisted_miss | not listed; same flag on: granola with nuts (mayContain: milk) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 11 | Wiener Schnitzel with fries and side salad | breaded fried schnitzel (pork/veal cutlet) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Breaded fried fish fillet with lemon and capers (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Creamy pasta (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen eggs | yes | unlisted_miss | not listed; same flag on: Creamy pasta (mayContain: eggs), Mixed salad (mayContain: eggs) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen milk | yes | unlisted_miss | not listed; same flag on: Creamy pasta (allergens: milk), Mixed salad (mayContain: milk) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 18 | Swabian Maultaschen with potato salad | Maultaschen (filled pasta pockets with meat filling) | allergen gluten | yes | unlisted_miss | not listed; same flag on: meat-filled pasta with creamy sauce (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 19 | German fast-food mixed plate (Taxiteller) | mayonnaise | allergen eggs | yes | unlisted_miss | not listed; same flag on: Creamy garlic sauce (allergens: eggs) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 23 | Smothered beef burrito | burrito (flour tortilla) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Enchilada with sauce, cheese and vegetables (mayContain: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 26 | Indian thali on a steel tray | chapati/roti | allergen gluten | yes | unlisted_miss | not listed; same flag on: papad (mayContain: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 27 | Stir-fried chicken with peppers and steamed rice | stir-fried chicken pieces in brown sauce | allergen nuts | yes | miss | Chicken and vegetable stir-fry P[] A[] M['gluten', 'soybeans'] |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 29 | Tapas/snack flight with a wheat beer | creamy dip/cream cheese with the pickles | allergen milk | yes | miss | Pickled vegetables P[] A[] M['sulphites'] |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 30 | Mixed grill board (plancha de grillades) | baked/roasted potato with browned cheese topping | allergen milk | no | miss | Roasted potatoes P[] A[] M[] |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 31 | Bowl of beef/oxtail soup with buttered bread | buttered bread slices (dark/whole-grain) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Beef stew with gravy (mayContain: gluten), White bread (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 31 | Bowl of beef/oxtail soup with buttered bread | buttered bread slices (dark/whole-grain) | allergen milk | yes | unlisted_miss | not listed; same flag on: White bread (mayContain: milk), Butter (allergens: milk) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 32 | Charcuterie/snack board (compartmented bamboo tray, top-down) | pan-fried spiced hard-boiled egg halves | allergen eggs | yes | unlisted_miss | not listed; same flag on: Creamy dip (mayContain: eggs) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 35 | Gyros/döner plate with fries and salad | white garlic-yogurt sauce (tzatziki) with oregano | allergen milk | yes | unlisted_miss | not listed; same flag on: Kebab meat with creamy sauce (allergens: milk) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 37 | Pierogi ruskie with carrot-cabbage salad | pierogi/boiled dumplings (potato-cheese filling) | allergen milk | yes | miss | Steamed dumplings with brown sauce P[] A['gluten', 'soybeans'] M['crustaceans', 'eggs', 'sesame'] |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 41 | Leftovers of battered fish and potato wedges | battered fried fish (cod), partly eaten | allergen fish | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 41 | Leftovers of battered fish and potato wedges | battered fried fish (cod), partly eaten | allergen gluten | yes | unlisted_miss | not listed; same flag on: cooked sausage (mayContain: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 41 | Leftovers of battered fish and potato wedges | tartar sauce / mayonnaise dollop | allergen eggs | yes | unlisted_miss | not listed; same flag on: creamy dipping sauce (allergens: eggs) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 42 | Buffet lunch plate (many components) | breaded fried fish fillet | allergen fish | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 42 | Buffet lunch plate (many components) | breaded fried fish fillet | allergen gluten | yes | unlisted_miss | not listed; same flag on: Breaded chicken cutlet with creamy sauce (allergens: gluten), White rice with curry sauce (mayContain: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | seasoned peanuts/beans | allergen peanuts | no | miss | Black beans P[] A[] M[]; Green beans in tomato sauce P[] A[] M['celery'] |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 47 | Café brunch table spread (top-down) | seeded bagel (dark, sesame-topped) | allergen sesame | yes | unlisted_miss | not listed; same flag on: Chocolate sesame ring pastry (allergens: sesame) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 47 | Café brunch table spread (top-down) | seeded bagel (dark, sesame-topped) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Kiwi, berry and granola bowl (mayContain: gluten), Savory bites with creamy sauce (mayContain: gluten), Avocado toast with creamy topping (allergens: gluten), Chocolate sesame ring pastry (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 47 | Café brunch table spread (top-down) | cherry tomato salad with balsamic drizzle | allergen sulphites | no | miss | Cherry tomato skewers with sauce P[] A[] M[] |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 48 | Disposable plate of party snacks (partly eaten) | cucumber sandwich (white bread triangle) | allergen gluten | yes | unlisted_miss | not listed; same flag on: white bread (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 48 | Disposable plate of party snacks (partly eaten) | samosas (small fried triangles) | allergen gluten | yes | unlisted_miss | not listed; same flag on: white bread (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 48 | Disposable plate of party snacks (partly eaten) | slice of white/vanilla cake with icing, partly eaten | allergen gluten | yes | unlisted_miss | not listed; same flag on: white bread (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 48 | Disposable plate of party snacks (partly eaten) | slice of white/vanilla cake with icing, partly eaten | allergen eggs | yes | unlisted_miss | not listed; same flag on: white bread (mayContain: eggs) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 49 | Cafe sizzling-plate dinner set | spaghetti (plain, buttered) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Cooked noodles with tomato (allergens: gluten), Glazed grilled beef (mayContain: gluten), Brown soup or sauce (mayContain: gluten), Sliced white bread (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r1 | 49 | Cafe sizzling-plate dinner set | bread bun | allergen gluten | yes | unlisted_miss | not listed; same flag on: Cooked noodles with tomato (allergens: gluten), Glazed grilled beef (mayContain: gluten), Brown soup or sauce (mayContain: gluten), Sliced white bread (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 02 | Roast (Sunday) dinner | Yorkshire pudding | allergen gluten | yes | unlisted_miss | not listed; same flag on: Braised chicken with gravy (mayContain: gluten), Mixed vegetables with sauce (mayContain: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 02 | Roast (Sunday) dinner | Yorkshire pudding | allergen eggs | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 02 | Roast (Sunday) dinner | Yorkshire pudding | allergen milk | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 07 | Spaghetti with meat-vegetable sauce | spaghetti | allergen gluten | yes | unlisted_miss | not listed; same flag on: Stir-fried wheat noodles with sauce (allergens: gluten), Minced meat (mayContain: gluten), Mixed vegetables (mayContain: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 08 | Yogurt granola bowl with apple | yogurt | allergen milk | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 11 | Wiener Schnitzel with fries and side salad | breaded fried schnitzel (pork/veal cutlet) | allergen gluten | yes | unlisted_miss | not listed; same flag on: breaded fried fish with lemon and capers (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen gluten | yes | unlisted_miss | not listed; same flag on: creamy pasta (allergens: gluten), glazed grilled meat strips (mayContain: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen eggs | yes | unlisted_miss | not listed; same flag on: creamy pasta (mayContain: eggs), mixed green salad (mayContain: eggs) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen milk | yes | unlisted_miss | not listed; same flag on: creamy pasta (allergens: milk), mixed green salad (mayContain: milk) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 18 | Swabian Maultaschen with potato salad | Maultaschen (filled pasta pockets with meat filling) | allergen gluten | yes | unlisted_miss | not listed; same flag on: meat-filled pasta dumplings (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 19 | German fast-food mixed plate (Taxiteller) | tzatziki/garlic yogurt sauce | allergen milk | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 23 | Smothered beef burrito | burrito (flour tortilla) | allergen gluten | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 26 | Indian thali on a steel tray | chapati/roti | allergen gluten | yes | unlisted_miss | not listed; same flag on: papadum (mayContain: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 27 | Stir-fried chicken with peppers and steamed rice | stir-fried chicken pieces in brown sauce | allergen nuts | yes | miss | Chicken and bell pepper stir-fry P[] A[] M['gluten', 'sesame', 'soybeans'] |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 30 | Mixed grill board (plancha de grillades) | baked/roasted potato with browned cheese topping | allergen milk | no | miss | Roasted potatoes P[] A[] M[] |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 32 | Charcuterie/snack board (compartmented bamboo tray, top-down) | pan-fried spiced hard-boiled egg halves | allergen eggs | yes | unlisted_miss | not listed; same flag on: creamy vegetable dip (mayContain: eggs), roasted potato rounds (mayContain: eggs) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 33 | Bowl of oatmeal porridge with toppings | oatmeal/oat porridge | allergen gluten | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 33 | Bowl of oatmeal porridge with toppings | peanut butter | allergen peanuts | yes | miss | Butter P[] A['milk'] M[] |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 33 | Bowl of oatmeal porridge with toppings | milk | allergen milk | yes | unlisted_miss | not listed; same flag on: Rice pudding (allergens: milk), Butter (allergens: milk) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 35 | Gyros/döner plate with fries and salad | white garlic-yogurt sauce (tzatziki) with oregano | allergen milk | yes | unlisted_miss | not listed; same flag on: Grilled beef strips with creamy sauce (mayContain: milk) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 37 | Pierogi ruskie with carrot-cabbage salad | pierogi/boiled dumplings (potato-cheese filling) | allergen milk | yes | miss | steamed dumplings with sauce P[] A['gluten', 'soybeans'] M['eggs', 'sesame'] |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 40 | Half-eaten liver-and-bacon fry-up with chips | fried egg (remnant, yolk visible) | allergen eggs | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 41 | Leftovers of battered fish and potato wedges | tartar sauce / mayonnaise dollop | allergen eggs | yes | unlisted_miss | not listed; same flag on: Breaded fried fish (mayContain: eggs), Creamy dipping sauce (allergens: eggs) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 42 | Buffet lunch plate (many components) | breaded fried fish fillet | allergen fish | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 42 | Buffet lunch plate (many components) | breaded fried fish fillet | allergen gluten | yes | unlisted_miss | not listed; same flag on: Breaded chicken cutlet with white sauce (allergens: gluten), Curry sauce with chunks (mayContain: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 43 | Buffet lunch set, main plate, soup bowl, bread plate | breaded croquettes/fish cakes topped with mayonnaise-aioli | allergen gluten | yes | unlisted_miss | not listed; same flag on: Breaded chicken cutlets with creamy sauce (allergens: gluten), Bread with creamy spread (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 43 | Buffet lunch set, main plate, soup bowl, bread plate | breaded croquettes/fish cakes topped with mayonnaise-aioli | allergen eggs | yes | unlisted_miss | not listed; same flag on: Breaded chicken cutlets with creamy sauce (allergens: eggs), Creamy sauce (allergens: eggs) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 43 | Buffet lunch set, main plate, soup bowl, bread plate | cheese-topped quiche/gratin square | allergen eggs | no | miss | Baked polenta square P[] A[] M['milk'] |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 43 | Buffet lunch set, main plate, soup bowl, bread plate | bread roll with butter | allergen gluten | yes | unlisted_miss | not listed; same flag on: Breaded chicken cutlets with creamy sauce (allergens: gluten), Bread with creamy spread (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 43 | Buffet lunch set, main plate, soup bowl, bread plate | bread roll with butter | allergen milk | yes | unlisted_miss | not listed; same flag on: Breaded chicken cutlets with creamy sauce (allergens: milk), Baked polenta square (mayContain: milk), Bread with creamy spread (allergens: milk), Creamy sauce (allergens: milk) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | steamed egg (gyeranjjim) in stone pot | allergen eggs | yes | unlisted_miss | not listed; same flag on: Mixed salad with dressing (mayContain: eggs), Noodles with vegetables (mayContain: eggs) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | seasoned peanuts/beans | allergen peanuts | no | miss | Cooked beans P[] A[] M[]; Green beans in tomato sauce P[] A[] M['celery'] |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 46 | Hong Kong steamer basket of small offal dishes (dai pai dong) | fried beancurd-skin rolls (tofu skin rolls) | allergen soybeans | yes | unlisted_miss | not listed; same flag on: steamed rice noodle sheets (mayContain: soybeans), honeycomb tripe in sauce (mayContain: soybeans), steamed bean curd (allergens: soybeans) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 47 | Café brunch table spread (top-down) | cherry tomato salad with balsamic drizzle | allergen sulphites | no | miss | Cherry tomato skewers with balsamic glaze P[] A[] M[] |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 48 | Disposable plate of party snacks (partly eaten) | cucumber sandwich (white bread triangle) | allergen gluten | yes | unlisted_miss | not listed; same flag on: white bread (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 48 | Disposable plate of party snacks (partly eaten) | samosas (small fried triangles) | allergen gluten | yes | unlisted_miss | not listed; same flag on: white bread (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 48 | Disposable plate of party snacks (partly eaten) | slice of white/vanilla cake with icing, partly eaten | allergen gluten | yes | unlisted_miss | not listed; same flag on: white bread (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 48 | Disposable plate of party snacks (partly eaten) | slice of white/vanilla cake with icing, partly eaten | allergen eggs | yes | unlisted_miss | not listed; same flag on: white bread (mayContain: eggs) |
| v4-eu-cell-gpt6-luna-newprompt-r2 | 49 | Cafe sizzling-plate dinner set | bread bun | allergen gluten | yes | unlisted_miss | not listed; same flag on: Spaghetti noodles (allergens: gluten), Beef steak with brown sauce (mayContain: gluten), Thick vegetable soup (mayContain: gluten), Cheese sandwich (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 02 | Roast (Sunday) dinner | Yorkshire pudding | allergen gluten | yes | unlisted_miss | not listed; same flag on: Roast chicken with gravy (mayContain: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 02 | Roast (Sunday) dinner | Yorkshire pudding | allergen eggs | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 02 | Roast (Sunday) dinner | Yorkshire pudding | allergen milk | yes | unlisted_miss | not listed; same flag on: Roast chicken with gravy (mayContain: milk), Mixed vegetables with mushrooms (mayContain: milk) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 07 | Spaghetti with meat-vegetable sauce | spaghetti | allergen gluten | yes | unlisted_miss | not listed; same flag on: Stir-fried noodles (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 08 | Yogurt granola bowl with apple | yogurt | allergen milk | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 11 | Wiener Schnitzel with fries and side salad | breaded fried schnitzel (pork/veal cutlet) | allergen gluten | yes | unlisted_miss | not listed; same flag on: breaded fried fish fillet (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Creamy pasta (allergens: gluten), Sauced grilled meat strips (mayContain: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen eggs | yes | unlisted_miss | not listed; same flag on: Creamy pasta (mayContain: eggs), Mixed salad (mayContain: eggs) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 13 | Käsespätzle (cheese spätzle) in a cast-iron pan with a side salad | Käsespätzle (spätzle noodles in melted cheese) | allergen milk | yes | unlisted_miss | not listed; same flag on: Creamy pasta (allergens: milk), Mixed salad (mayContain: milk) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 15 | Bavarian Weisswurst breakfast | pretzel (Brezel) | allergen gluten | yes | unlisted_miss | not listed; same flag on: dark beer (allergens: gluten), glazed ring doughnut (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 18 | Swabian Maultaschen with potato salad | Maultaschen (filled pasta pockets with meat filling) | allergen gluten | yes | unlisted_miss | not listed; same flag on: meat-filled pasta parcels (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 19 | German fast-food mixed plate (Taxiteller) | tzatziki/garlic yogurt sauce | allergen milk | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 23 | Smothered beef burrito | burrito (flour tortilla) | allergen gluten | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 26 | Indian thali on a steel tray | chapati/roti | allergen gluten | yes | unlisted_miss | not listed; same flag on: papadum (mayContain: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 27 | Stir-fried chicken with peppers and steamed rice | stir-fried chicken pieces in brown sauce | allergen nuts | yes | miss | Chicken with stir-fry sauce P[] A[] M['gluten', 'sesame', 'soybeans'] |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 30 | Mixed grill board (plancha de grillades) | baked/roasted potato with browned cheese topping | allergen milk | no | miss | roasted baby potatoes P[] A[] M[] |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 32 | Charcuterie/snack board (compartmented bamboo tray, top-down) | pan-fried spiced hard-boiled egg halves | allergen eggs | yes | unlisted_miss | not listed; same flag on: mini savory tartlets (mayContain: eggs) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 33 | Bowl of oatmeal porridge with toppings | oatmeal/oat porridge | allergen gluten | yes | miss | Oatmeal porridge with milk and cinnamon P[] A['milk'] M[] |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 35 | Gyros/döner plate with fries and salad | white garlic-yogurt sauce (tzatziki) with oregano | allergen milk | yes | unlisted_miss | not listed; same flag on: Beef strips with creamy sauce (mayContain: milk) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 37 | Pierogi ruskie with carrot-cabbage salad | pierogi/boiled dumplings (potato-cheese filling) | allergen milk | yes | miss | steamed dumplings with sauce P[] A['gluten', 'soybeans'] M['eggs', 'sesame'] |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 41 | Leftovers of battered fish and potato wedges | battered fried fish (cod), partly eaten | allergen fish | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 41 | Leftovers of battered fish and potato wedges | battered fried fish (cod), partly eaten | allergen gluten | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 42 | Buffet lunch plate (many components) | breaded fried fish fillet | allergen fish | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 42 | Buffet lunch plate (many components) | breaded fried fish fillet | allergen gluten | yes | unlisted_miss | not listed; same flag on: Breaded fried cutlet with creamy sauce (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 43 | Buffet lunch set, main plate, soup bowl, bread plate | cheese-topped quiche/gratin square | allergen milk | yes | unlisted_miss | not listed; same flag on: Breaded fish with creamy tartar sauce (mayContain: milk), Seasoned rice (mayContain: milk), Green beans (mayContain: milk), Creamy pasta (allergens: milk), Bread with butter (allergens: milk), Creamy bacon sauce (allergens: milk) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | steamed egg (gyeranjjim) in stone pot | allergen eggs | yes | unlisted_miss | not listed; same flag on: Noodles with vegetables (mayContain: eggs) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | seasoned peanuts/beans | allergen peanuts | no | miss | Cooked beans P[] A[] M[]; Green beans in tomato sauce P[] A[] M['celery'] |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 48 | Disposable plate of party snacks (partly eaten) | cucumber sandwich (white bread triangle) | allergen gluten | yes | unlisted_miss | not listed; same flag on: White bread with ketchup (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 48 | Disposable plate of party snacks (partly eaten) | samosas (small fried triangles) | allergen gluten | yes | unlisted_miss | not listed; same flag on: White bread with ketchup (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 48 | Disposable plate of party snacks (partly eaten) | slice of white/vanilla cake with icing, partly eaten | allergen gluten | yes | unlisted_miss | not listed; same flag on: White bread with ketchup (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 48 | Disposable plate of party snacks (partly eaten) | slice of white/vanilla cake with icing, partly eaten | allergen eggs | yes | unlisted_miss | not listed |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 49 | Cafe sizzling-plate dinner set | spaghetti (plain, buttered) | allergen gluten | yes | unlisted_miss | not listed; same flag on: Noodles with tomato (allergens: gluten), Glazed beef (mayContain: gluten), Brown soup or dipping sauce (mayContain: gluten), Bread sandwich (allergens: gluten) |
| v4-eu-cell-gpt6-luna-newprompt-r3 | 49 | Cafe sizzling-plate dinner set | bread bun | allergen gluten | yes | unlisted_miss | not listed; same flag on: Noodles with tomato (allergens: gluten), Glazed beef (mayContain: gluten), Brown soup or dipping sauce (mayContain: gluten), Bread sandwich (allergens: gluten) |

### Cell B: pregnancy misses (0)

None.

### Cell B: allergen misses (2)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| eval-harness:eu-cell-38-newprompt | 06 | Sushi platter (restaurant table) | soy sauce | allergen soybeans | yes | unlisted_miss | not listed; same flag on: salmon avocado roll (mayContain: soybeans), assorted nigiri sushi (mayContain: soybeans) |
| eval-harness:eu-cell-38-newprompt | 33 | Bowl of oatmeal porridge with toppings | milk | allergen milk | yes | miss | cooked oatmeal P[] A[] M['gluten'] |

### Cell C3: pregnancy misses (0)

None.

### Cell C3: allergen misses (3)

| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |
|---|---|---|---|---|---|---|---|
| prompt-v3:v3-eu-cell-38-minimal-newprompt | 06 | Sushi platter (restaurant table) | soy sauce | allergen soybeans | yes | unlisted_miss | not listed; same flag on: salmon avocado roll (mayContain: soybeans), tuna nigiri (mayContain: soybeans), white fish nigiri (mayContain: soybeans) |
| prompt-v3:v3-eu-cell-38-minimal-newprompt | 33 | Bowl of oatmeal porridge with toppings | milk | allergen milk | yes | miss | oatmeal porridge P[] A['gluten'] M[] |
| prompt-v3:v3-eu-cell-38-minimal-newprompt | 47 | Café brunch table spread (top-down) | cherry tomato salad with balsamic drizzle | allergen sulphites | no | miss | Avocado and poached egg toast with cherry tomatoes P['raw-egg', 'raw-sprouts'] A['eggs', 'gluten'] M['milk', 'sesame', 'soybeans']; Eggs Benedict with avocado and cherry tomatoes P['raw-egg', 'raw-sprouts'] A['eggs', 'gluten', 'milk'] M['mustard', 'sesame'] |

## Failed calls (scored by rule 1, not as flag misses)

| cell | run | case | text | finish or error | clear must_flag entries | flags the truncated text had written |
|---|---|---|---|---|---|---|
| F25v4 | v4-eu-cell-25-flash-newprompt-r3 | 45 | Korean hanjeongsik table spread (dozens of banchan, top-down) | length | pregnancy raw-fish, allergen fish, allergen eggs, allergen fish | "flags": { "pregnancy": [], "allergens": [], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": [], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": [], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": ["soybeans"], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": ["peanuts"], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": ["soybeans"], "mayContain": ["gluten", "sesame"] } ; "flags": { "pregnancy": [], "allergens": ["eggs"], "mayContain": [] } ; "flags": { "pregnancy": ["high-mercury-fish"], "allergens": ["fish"], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": ["gluten", "eggs", "soybeans"], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": ["soybeans"], "mayContain": ["sesame"] } ; "flags": { "pregnancy": [], "allergens": ["soybeans"], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": ["soybeans"], "mayContain": ["gluten", "sesame"] } ; "flags": { "pregnancy": [], "allergens": ["fish"], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": ["peanuts"], "mayContain": ["nuts"] } ; "flags": { "pregnancy": [], "allergens": ["soybeans", "fish"], "mayContain": ["gluten"] } ; "flags": { "pregnancy": [], "allergens": ["soybeans"], "mayContain": ["sesame"] } ; "flags": { "pregnancy": [], "allergens": ["soybeans", "gluten"], "mayContain": ["sesame"] } ; "flags": { "pregnancy": [], "allergens": ["soybeans", "gluten"], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": ["soybeans"], "mayContain": ["sesame"] } ; "flags": { "pregnancy": [], "allergens": ["soybeans"], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": ["soybeans"], "mayContain": ["sesame"] } ; "flags": { "pregnancy": [], "allergens": ["soybeans"], "mayContain": ["gluten", "sesame"] } ; "flags": { "pregnancy": [], "allergens": ["fish"], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": ["soybeans"], "mayContain": ["sesame"] } ; "flags": { "pregnancy": [], "allergens": ["soybeans"], "mayContain": ["fish", "gluten", "sesame"] } |
| O6 | v4-eu-cell-gpt6-luna-newprompt-r3 | 06 | Sushi platter (restaurant table) | API error in a 200 body: {"message": "upstream connect error or disconnect/reset before headers. reset reason: connectio | pregnancy raw-fish, allergen fish, allergen sesame, pregnancy raw-fish, pregnancy high-mercury-fish, allergen fish, pregnancy raw-fish, allergen fish, allergen soybeans | none |
| B | eval-harness:text-eu-cell-38-newprompt-r1 | t040 | Graved Lachs mit Senf-Dill-Sauce | length | allergen fish, allergen mustard | "flags": { "pregnancy": [ "raw-fish" ], "allergens": [ "fish" ], "mayContain": [] } |
| B | eval-harness:text-eu-cell-38-newprompt-r2 | t040 | Graved Lachs mit Senf-Dill-Sauce | length | allergen fish, allergen mustard | "flags": { "pregnancy": [ "raw-fish" ], "allergens": [ "fish", "mustard" ], "mayContain": [] } |
| B | eval-harness:text-eu-cell-38-newprompt-r3 | t044 | 4 slices of prosciutto with melon | length | pregnancy raw-meat | "flags": { "pregnancy": [ "raw-meat" ], "allergens": [], "mayContain": [] } ; "flags": { "pregnancy": [], "allergens": [], "mayContain": [] } |

## Not blocking: demotions, false alarms, extra flags

| cell | source | cases | demotions clear (distinct) | demotions not clear | preg false alarms (distinct) | allergen false alarms (distinct) | extra preg flags per case | extra allergen flags per case | items outside the gold, their flags |
|---|---|---|---|---|---|---|---|---|---|
| C3v4 | typed | 89 | 0 (0) | 2 | 1 (1) | 1 (1) | 0.02 | 0.88 | 1, 0 |
| C3v4 | plates | 50 | 2 (2) | 2 | 1 (1) | 0 (0) | 0.20 | 2.76 | 10, 29 |
| F25v4 | plates | 149 | 8 (8) | 14 | 9 (4) | 0 (0) | 0.07 | 1.89 | 78, 131 |
| G31 | typed | 89 | 0 (0) | 2 | 5 (5) | 0 (0) | 0.02 | 0.67 | 8, 13 |
| G31 | plates | 150 | 7 (5) | 4 | 16 (6) | 0 (0) | 0.37 | 1.42 | 63, 106 |
| O6 | typed | 89 | 5 (5) | 6 | 0 (0) | 0 (0) | 0.01 | 0.49 | 1, 0 |
| O6 | plates | 149 | 17 (11) | 13 | 2 (2) | 0 (0) | 0.07 | 1.69 | 170, 379 |
| B | typed | 264 | 0 (0) | 4 | 3 (1) | 3 (1) | 0.02 | 0.85 | 3, 0 |
| B | plates | 50 | 4 (4) | 4 | 1 (1) | 0 (0) | 0.08 | 2.94 | 5, 14 |
| C3 | typed | 267 | 0 (0) | 6 | 3 (1) | 3 (1) | 0.02 | 0.76 | 3, 0 |
| C3 | plates | 100 | 10 (6) | 7 | 2 (1) | 0 (0) | 0.12 | 3.07 | 7, 23 |

### Cell C3v4: demotions (6)

- 05 chicken pieces in creamy sauce with leafy greens (spinach-type): milk in mayContain, 1 answer(s), clear:false
- 32 herb crackers: sesame in mayContain, 1 answer(s), clear:false
- 33 oatmeal/oat porridge: gluten in mayContain, 1 answer(s)
- 37 pierogi/boiled dumplings (potato-cheese filling): milk in mayContain, 1 answer(s)
- t063 miso soup: fish in mayContain, 1 answer(s), clear:false
- t071 curry: nuts in mayContain, 1 answer(s), clear:false

### Cell F25v4: demotions (22)

- 04 cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun): mustard in mayContain, 2 answer(s), clear:false
- 05 chicken pieces in creamy sauce with leafy greens (spinach-type): milk in mayContain, 2 answer(s), clear:false
- 06 soy sauce: gluten in mayContain, 2 answer(s), clear:false
- 06 white wine / water glasses in background: sulphites in mayContain, 1 answer(s), clear:false
- 19 tzatziki/garlic yogurt sauce: milk in mayContain, 1 answer(s)
- 20 sliced chashu pork: soybeans in mayContain, 1 answer(s), clear:false
- 27 stir-fried chicken pieces in brown sauce: soybeans in mayContain, 2 answer(s), clear:false
- 32 herb crackers: sesame in mayContain, 3 answer(s), clear:false
- 33 milk: milk in mayContain, 1 answer(s)
- 33 oatmeal/oat porridge: gluten in mayContain, 1 answer(s)
- 38 cheese slice in burger: milk in mayContain, 1 answer(s)
- 43 breaded croquettes/fish cakes topped with mayonnaise-aioli: gluten in mayContain, 1 answer(s)
- 45 sliced raw fish (hoe/sashimi) on shredded radish: fish in mayContain, 1 answer(s)
- 47 cherry tomato salad with balsamic drizzle: sulphites in mayContain, 1 answer(s), clear:false
- 47 seeded bagel (dark, sesame-topped): sesame in mayContain, 1 answer(s)
- 47 yogurt bowl with granola, kiwi slices and berry compote: milk in mayContain, 1 answer(s)

### Cell G31: demotions (13)

- 05 chicken pieces in creamy sauce with leafy greens (spinach-type): milk in mayContain, 2 answer(s), clear:false
- 06 sushi rolls (salmon+avocado uramaki, sesame): sesame in mayContain, 2 answer(s)
- 12 mustard/onion-gravy drizzle on the sausages: mustard in mayContain, 1 answer(s), clear:false
- 28 yellow bulgur or couscous: gluten in mayContain, 1 answer(s)
- 32 herb crackers: sesame in mayContain, 1 answer(s), clear:false
- 37 pierogi/boiled dumplings (potato-cheese filling): milk in mayContain, 2 answer(s)
- 43 breaded croquettes/fish cakes topped with mayonnaise-aioli: gluten in mayContain, 1 answer(s)
- 47 yogurt bowl with granola, kiwi slices and berry compote: gluten in mayContain, 1 answer(s)
- t052 shrimp pad Thai: fish in mayContain, 1 answer(s), clear:false
- t071 curry: nuts in mayContain, 1 answer(s), clear:false

### Cell O6: demotions (41)

- 04 cheeseburger (beef patty, cheese, tomato, red onion, sauce, bun): mustard in mayContain, 3 answer(s), clear:false
- 06 sushi rolls (salmon+avocado uramaki, sesame): sesame in mayContain, 2 answer(s)
- 08 granola (oats/puffed grains, nuts): gluten in mayContain, 1 answer(s)
- 12 mashed potatoes: milk in mayContain, 2 answer(s), clear:false
- 12 mustard/onion-gravy drizzle on the sausages: mustard in mayContain, 3 answer(s), clear:false
- 19 tzatziki/garlic yogurt sauce: milk in mayContain, 1 answer(s)
- 20 ramen noodles: gluten in mayContain, 1 answer(s)
- 27 stir-fried chicken pieces in brown sauce: soybeans in mayContain, 3 answer(s), clear:false
- 33 oatmeal/oat porridge: gluten in mayContain, 1 answer(s)
- 43 cheese-topped quiche/gratin square: eggs in mayContain, 1 answer(s), clear:false
- 43 cheese-topped quiche/gratin square: milk in mayContain, 1 answer(s)
- 47 avocado toast/bagel halves with poached eggs: eggs in mayContain, 2 answer(s)
- 47 cherry tomato salad with balsamic drizzle: sulphites in mayContain, 1 answer(s), clear:false
- 47 eggs benedict with hollandaise on avocado toast: eggs in mayContain, 2 answer(s)
- 47 eggs benedict with hollandaise on avocado toast: milk in mayContain, 2 answer(s)
- 47 yogurt bowl with granola, kiwi slices and berry compote: gluten in mayContain, 3 answer(s)
- 47 yogurt bowl with granola, kiwi slices and berry compote: milk in mayContain, 1 answer(s)
- t009 red wine: sulphites in mayContain, 1 answer(s)
- t020 oat milk: gluten in mayContain, 1 answer(s)
- t021 prawn cocktail: eggs in mayContain, 1 answer(s), clear:false
- t046 chicken Caesar salad: fish in mayContain, 1 answer(s), clear:false
- t052 shrimp pad Thai: eggs in mayContain, 1 answer(s), clear:false
- t052 shrimp pad Thai: fish in mayContain, 1 answer(s), clear:false
- t063 miso soup: fish in mayContain, 1 answer(s), clear:false
- t065 hummus: sesame in mayContain, 1 answer(s)
- t071 curry: nuts in mayContain, 1 answer(s), clear:false
- t078 white wine: sulphites in mayContain, 1 answer(s)
- t087 red wine: sulphites in mayContain, 1 answer(s)

### Cell B: demotions (12)

- 05 chicken pieces in creamy sauce with leafy greens (spinach-type): milk in mayContain, 1 answer(s), clear:false
- 32 herb crackers: sesame in mayContain, 1 answer(s), clear:false
- 33 oatmeal/oat porridge: gluten in mayContain, 1 answer(s)
- 37 pierogi/boiled dumplings (potato-cheese filling): milk in mayContain, 1 answer(s)
- 42 sour cream / remoulade dollop: milk in mayContain, 1 answer(s), clear:false
- 45 sliced raw fish (hoe/sashimi) on shredded radish: fish in mayContain, 1 answer(s)
- 45 vegetable fritters/jeon platter: eggs in mayContain, 1 answer(s), clear:false
- 47 yogurt bowl with granola, kiwi slices and berry compote: milk in mayContain, 1 answer(s)
- t063 miso soup: fish in mayContain, 1 answer(s), clear:false
- t071 curry: nuts in mayContain, 3 answer(s), clear:false

### Cell C3: demotions (23)

- 05 chicken pieces in creamy sauce with leafy greens (spinach-type): milk in mayContain, 2 answer(s), clear:false
- 28 yellow bulgur or couscous: gluten in mayContain, 2 answer(s)
- 29 creamy dip/cream cheese with the pickles: milk in mayContain, 2 answer(s)
- 32 herb crackers: sesame in mayContain, 2 answer(s), clear:false
- 33 milk: milk in mayContain, 1 answer(s)
- 35 pickled green chili pepper: sulphites in mayContain, 1 answer(s), clear:false
- 37 pierogi/boiled dumplings (potato-cheese filling): milk in mayContain, 2 answer(s)
- 38 cheese slice in burger: milk in mayContain, 1 answer(s)
- 42 sour cream / remoulade dollop: milk in mayContain, 2 answer(s), clear:false
- 47 yogurt bowl with granola, kiwi slices and berry compote: milk in mayContain, 2 answer(s)
- t023 Waldorf salad: eggs in mayContain, 3 answer(s), clear:false
- t071 curry: nuts in mayContain, 3 answer(s), clear:false

### Cell C3v4: false alarms on must_not_flag (3)

- 32 pan-fried spiced hard-boiled egg halves: pregnancy raw-egg (in pregnancy), 1 answer(s)
- t068 coconut yogurt: allergen nuts (in mayContain), 1 answer(s)
- t089 white cheese: pregnancy soft-cheese (in pregnancy), 1 answer(s)

### Cell F25v4: false alarms on must_not_flag (9)

- 03 feta cheese: pregnancy soft-cheese (in pregnancy), 3 answer(s)
- 03 grilled salmon fillets: pregnancy smoked-fish (in pregnancy), 1 answer(s)
- 29 cheese cubes: pregnancy soft-cheese (in pregnancy), 3 answer(s)
- 45 grilled mackerel/fish: pregnancy high-mercury-fish (in pregnancy), 2 answer(s)

### Cell G31: false alarms on must_not_flag (21)

- 03 grilled salmon fillets: pregnancy high-mercury-fish (in pregnancy), 3 answer(s)
- 24 battered fried fish fillet: pregnancy raw-fish (in pregnancy), 1 answer(s)
- 32 pan-fried spiced hard-boiled egg halves: pregnancy raw-egg (in pregnancy), 3 answer(s)
- 36 mantis shrimp (galeras): pregnancy raw-fish (in pregnancy), 3 answer(s)
- 36 whole prawns (langostinos): pregnancy raw-fish (in pregnancy), 3 answer(s)
- 45 grilled mackerel/fish: pregnancy high-mercury-fish (in pregnancy), 3 answer(s)
- t006 cream cheese: pregnancy raw-dairy (in pregnancy), 1 answer(s)
- t030 cooked ham: pregnancy raw-meat (in pregnancy), 1 answer(s)
- t060 baked cheesecake: pregnancy raw-egg (in pregnancy), 1 answer(s)
- t083 spaghetti with clams: pregnancy raw-fish (in pregnancy), 1 answer(s)
- t090 stuffed mussels: pregnancy raw-fish (in pregnancy), 1 answer(s)

### Cell O6: false alarms on must_not_flag (2)

- 03 feta cheese: pregnancy soft-cheese (in pregnancy), 1 answer(s)
- 45 steamed egg (gyeranjjim) in stone pot: pregnancy raw-egg (in pregnancy), 1 answer(s)

### Cell B: false alarms on must_not_flag (7)

- 03 feta cheese: pregnancy soft-cheese (in pregnancy), 1 answer(s)
- t068 coconut yogurt: allergen nuts (in mayContain), 3 answer(s)
- t089 white cheese: pregnancy soft-cheese (in pregnancy), 3 answer(s)

### Cell C3: false alarms on must_not_flag (8)

- 03 feta cheese: pregnancy soft-cheese (in pregnancy), 2 answer(s)
- t068 coconut yogurt: allergen nuts (in mayContain), 3 answer(s)
- t089 white cheese: pregnancy soft-cheese (in pregnancy), 3 answer(s)

## Per category and per allergen

Misses / tested entries, typed repeats and plates together. Demotions in brackets.

| kind | value | B clear | C3 clear | C3v4 clear | F25v4 clear | G31 clear | O6 clear | B not clear | C3 not clear | C3v4 not clear | F25v4 not clear | G31 not clear | O6 not clear |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pregnancy | raw-dairy | 0/9 | 0/9 | 0/3 | 0/0 | 0/3 | 0/3 | 0/9 | 0/9 | 0/3 | 0/0 | 2/3 | 0/3 |
| pregnancy | soft-cheese | 0/12 | 0/12 | 0/4 | 0/0 | 0/4 | 0/4 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| pregnancy | raw-meat | 0/22 | 0/25 | 0/9 | 0/6 | 0/13 | 0/13 | 0/6 | 0/6 | 0/2 | 0/0 | 0/2 | 0/2 |
| pregnancy | raw-egg | 0/17 | 0/19 | 0/7 | 1/6 | 3/11 | 4/11 | 0/8 | 0/10 | 0/4 | 1/6 | 0/8 | 5/7 |
| pregnancy | raw-fish | 0/22 | 0/26 | 1/10 | 1/11 | 1/18 | 4/15 | 0/1 | 0/3 | 0/1 | 0/0 | 0/1 | 0/1 |
| pregnancy | smoked-fish | 0/9 | 0/9 | 0/3 | 0/0 | 0/3 | 0/3 | 0/1 | 0/3 | 0/1 | 0/0 | 0/1 | 0/1 |
| pregnancy | high-mercury-fish | 0/13 | 0/14 | 0/5 | 0/3 | 0/7 | 0/6 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| pregnancy | liver-retinol | 0/13 | 0/14 | 0/5 | 0/3 | 0/7 | 3/7 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| pregnancy | alcohol | 0/18 | 0/25 | 0/10 | 0/20 | 0/22 | 0/21 | 0/1 | 0/2 | 0/1 | 0/3 | 0/2 | 0/0 |
| pregnancy | caffeine | 0/16 | 0/17 | 0/6 | 0/3 | 0/8 | 0/8 | 0/9 | 0/12 | 0/6 | 0/10 | 0/8 | 0/7 |
| pregnancy | raw-sprouts | 0/13 | 0/14 | 0/5 | 0/3 | 0/7 | 3/7 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| allergen | gluten | 0/135 (1) | 0/177 (2) | 2/73 (1) | 14/131 (2) | 17/159 (3) | 48/158 (7) | 0/4 | 0/6 | 0/3 | 0/5 (2) | 0/4 | 0/3 |
| allergen | crustaceans | 0/11 | 0/13 | 0/5 | 0/6 | 0/9 | 0/9 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| allergen | eggs | 0/55 | 0/71 | 0/29 | 1/47 | 4/61 | 19/61 (4) | 0/25 (1) | 0/29 (3) | 0/11 | 0/11 | 0/11 | 1/9 (3) |
| allergen | fish | 0/46 (1) | 0/57 | 1/22 | 0/25 (1) | 1/40 | 6/37 | 0/9 (1) | 0/9 | 0/3 (1) | 0/0 | 0/3 (1) | 0/3 (3) |
| allergen | peanuts | 0/10 | 0/11 | 0/4 | 0/3 | 0/6 | 1/6 | 0/0 | 0/0 | 0/0 | 0/1 | 0/0 | 3/3 |
| allergen | soybeans | 1/12 | 1/15 | 0/6 | 1/8 | 3/12 | 1/10 | 0/3 | 0/6 | 0/3 | 0/10 (3) | 0/5 | 0/3 (3) |
| allergen | milk | 1/108 (2) | 1/135 (8) | 1/53 (1) | 6/76 (4) | 19/103 (2) | 22/103 (5) | 0/13 (2) | 0/22 (4) | 0/9 (1) | 0/19 (2) | 2/22 (2) | 3/11 (2) |
| allergen | nuts | 0/10 | 0/11 | 0/4 | 0/3 | 1/6 | 3/6 | 0/3 (3) | 0/3 (3) | 0/1 (1) | 0/0 | 0/1 (1) | 0/1 (1) |
| allergen | celery | 0/9 | 0/9 | 0/3 | 0/0 | 1/3 | 0/3 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| allergen | mustard | 0/8 | 0/11 | 0/4 | 0/3 | 0/6 | 0/6 | 0/5 | 0/7 | 0/3 | 0/6 (2) | 0/6 (1) | 0/7 (6) |
| allergen | sesame | 0/15 | 0/18 | 0/7 | 6/9 (1) | 3/13 (2) | 1/12 (3) | 0/4 (1) | 0/8 (2) | 0/4 (1) | 0/9 (3) | 1/10 (1) | 0/1 |
| allergen | sulphites | 0/9 | 0/11 | 0/4 | 0/3 | 0/6 | 0/3 (3) | 0/1 | 1/4 (1) | 1/2 | 1/7 (2) | 1/3 | 2/3 (1) |
| allergen | lupin | 0/12 | 0/12 | 0/4 | 0/0 | 0/4 | 0/4 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| allergen | molluscs | 0/12 | 0/12 | 0/4 | 0/0 | 0/4 | 0/4 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |

## Sanity: gold labels every cell contradicts the same way

Entries that B, C3 and C3v4 all contradict come first, then entries two of the three contradict (to fill
ten rows), each group ranked by the lowest rate among the contradicting cells (contradicting answers
over answers that judged the entry). The gold files are not changed here; a view is a proposal.

| cells | list | case | text | item | flag | clear | way | B | C3 | C3v4 | view |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 of 3 | must_flag | 05 | Chicken in creamy leafy-green sauce with white rice | chicken pieces in creamy sauce with leafy greens (spinach-type) | allergen milk | no | demoted to mayContain | 1/1 | 2/2 | 1/1 | The cream may be coconut milk. clear:false is right; mayContain is a fair answer. No change. |
| 3 of 3 | must_flag | 32 | Charcuterie/snack board (compartmented bamboo tray, top-down) | herb crackers | allergen sesame | no | demoted to mayContain | 1/1 | 2/2 | 1/1 | Gold arguable, already clear:false. Herb crackers do not plainly hold sesame. Proposal: move to may_flag; mayContain is the honest list. |
| 3 of 3 | must_flag | 37 | Pierogi ruskie with carrot-cabbage salad | pierogi/boiled dumplings (potato-cheese filling) | allergen milk | yes | demoted to mayContain | 1/1 | 2/2 | 1/1 | Gold right: pierogi ruskie hold quark. The cells hedge. No change. |
| 3 of 3 | must_not_flag | t068 | 150 g plant-based coconut yogurt (dairy-free) | coconut yogurt | allergen nuts | yes | flagged although must_not_flag | 3/3 | 3/3 | 1/1 | Coconut is not an EU Annex II nut, so nuts in `allergens` is wrong. In mayContain it is a cross-contact hedge. Proposal: keep must_not for `allergens`, accept nuts in mayContain. |
| 3 of 3 | must_flag | t071 | some curry from the place downstairs | curry | allergen nuts | no | demoted to mayContain | 3/3 | 3/3 | 1/1 | Unknown curry: mayContain is the honest list, and it shows a chip. Proposal: accept mayContain as the expected list (no demotion). |
| 3 of 3 | must_not_flag | t089 | Kahvaltıda iki yumurtalı menemen ve beyaz peynir | white cheese | pregnancy soft-cheese | yes | flagged although must_not_flag | 3/3 | 3/3 | 1/1 | Gold right: beyaz peynir is brined, not mould-ripened or blue. A false alarm. No change. |
| 3 of 3 | must_flag | 33 | Bowl of oatmeal porridge with toppings | milk | allergen milk | yes | missed | 1/1 | 1/2 | 1/1 |  |
| 2 of 3 | must_flag | 33 | Bowl of oatmeal porridge with toppings | oatmeal/oat porridge | allergen gluten | yes | demoted to mayContain | 1/1 | 0/2 | 1/1 |  |
| 2 of 3 | must_flag | 47 | Café brunch table spread (top-down) | yogurt bowl with granola, kiwi slices and berry compote | allergen milk | yes | demoted to mayContain | 1/1 | 2/2 | 0/1 | All cells read the bowl as a smoothie or acai bowl, so they hedge milk. The photo cannot prove a yogurt base. Proposal: set clear:false. The chip still shows. |
| 2 of 3 | must_flag | 06 | Sushi platter (restaurant table) | soy sauce | allergen soybeans | yes | missed | 1/1 | 1/2 | 0/1 |  |

