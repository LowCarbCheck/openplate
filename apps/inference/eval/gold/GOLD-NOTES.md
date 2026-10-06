# Gold sets for the managed model comparison

These files feed the B1 cells of the EU model switch (see the decision rule in
`.tracker/worklog/eu-switch-opus-review.md`, section 2). They guard the
pregnancy and allergen cautions of the app, so the labels are conservative.
Written 2026-10-06. No model call was made to build them.

| File | Rows | What it measures |
| --- | --- | --- |
| `gold_text.jsonl` | 91 typed meals | flags (rules 2, 3, 4), item split, stated grams, brand, refusal |
| `gold_text_holdout.jsonl` | 36 typed meals | the same flags on foods that neither the v3 nor the v4 prompt names (section 10) |
| `gold_plate_flags.json` | 50 plates | flags on the visible items of the existing photo corpus |
| `gold_kcal_text.jsonl` | 34 typed foods | kcal and carbs per 100 g against USDA (reported, not blocking) |
| `gold_pantry.jsonl` | 10 typed pantry lists | item names, amounts, units, nulls |
| `gold_recipes.jsonl` | 10 recipe requests | recipe count, serving weight band, pantry honesty, budget |
| `check_new_gold.py` | | the self-check (stdlib only) |

## 1. Where the labels come from

Every flag label follows the app's OWN definitions, not general medical advice.
The source is the `flags` block of both system prompts in
`apps/app/app/services/vision/prompt.ts`, with the comments on
`PREGNANCY_CATEGORIES` in `schema.ts` as a tiebreak. The checker copies the two
enums from `schema.ts`. Each non-obvious case quotes the definition it used in
its `note`.

Three rules from the app decide how a label is scored:

1. **An allergen is flagged when it is in `allergens` OR in `mayContain`.**
   `app/lib/food-cautions.ts` (`decideCautions`) shows a chip for both lists. So
   a must_flag allergen is a miss only when it is in neither list.
2. **A missed flag is worse than an extra flag** (prompt.ts: "when you cannot
   tell, flag it"). So the sets keep false alarms apart from misses and never
   block on a false alarm.
3. **The text prompt asks for allergens "the name tells you or that the dish
   always has"**. A typed allergen is a must_flag only when the words name it or
   the dish has it by its plain recipe. A recipe-dependent allergen sits in
   `may_flag`.

## 2. The shape, and how a scorer reads it

### Flag entries

Each flag entry is `{"item", "kind", "value"}` and may carry `"clear"`.

- `kind` is `pregnancy` or `allergen`.
- `value` is one word from the vocabulary. In one case (t040, gravlax) it is a
  LIST: any one of the words satisfies the entry.
- `item` names one `core` item of the same case (for plates: a core item of
  `gold_labels.json`; for `if_listed`: an optional item).

### The lists

| List | Meaning for the scorer |
| --- | --- |
| `must_flag` | The value must appear on the matched item. Absent means a MISS. |
| `may_flag` | An acceptable extra. Never an error. |
| `must_not_flag` | A false alarm when present (for an allergen: in either list). Counted and reported, never blocking. |
| any other extra | Unjudged. Log it for review. It is neither credit nor error. |
| `if_listed` (plates only) | Required ONLY when the model lists that optional item (a beer in the background). No recall credit. |

### Clear and not clear

- `clear: true` means a competent person flags it without doubt, from the
  definition alone. Only effective-clear `must_flag` entries count for the
  absolute zero-miss rule (decision rule 2).
- Every case carries `clear`. An entry may override it with its own `clear`.
  The effective value is `entry.clear` if present, else `case.clear`.
- Every plate entry carries its own `clear`.
- `clear: false` entries still count for the relative rules 3 and 4 (3.5 must
  not miss more than 3.8).

### Item matching

The model names items in the app language, and the gold names them in English.
So a scorer must map model items to gold items, by alias, by translation, or by
hand, as the eval README already requires for recall. When the model folds two
gold items into one (the mustard into the bratwurst, the toppings into a pad
thai), score the flag at case level: the flag counts when it is on the item that
now holds that food. The notes name the cases where this is likely.

### Aliases (`aliases`, typed cases only)

A typed case may carry `aliases`: an object from a core item to a list of other
names that the scorer treats as the same item. The word overlap alone cannot
know that "Kasseler" and "Kassler" are one cured pork, or that a rutabaga is a
swede, so the gold says it.

**The rule.** An alias is a name for the SAME food in another spelling, another
language or another word for it (synonym, regional name). It is never a name for
a different food. It is never a name chosen because a model used it to dodge a
flag: a model's wrong dish (a cappuccino for a decaf latte), a model's wrong
reading, or a vaguer word that hides the food does not become an alias. Test
before you add one: would a person who knows both words say they mean one food?
If the answer needs "it was close enough", the answer is no. The scorer finds an
alias as a run of whole words inside the model's item name or its English
translation, so write the full word, not a stem.

Entry shapes in the list:

- a string: another name for the whole item ("Kasseler" for "Kassler (cured,
  smoked and cooked pork)");
- `{"name": "Brot", "component": true}`: the full name of one PART of a
  combination ("cheese on bread", "bread with cream cheese and sunflower
  sprouts"). When a model lists that part as an item of its own, a flag on it
  counts for the combined gold item, so gluten on "Brot" satisfies gluten on
  "Leerdammer cheese on bread". The part must be the whole name of the model
  item ("Brot", "Vollkornbrot", "bread"); "Brot mit Butter" is another item. A
  flag the gold forbids on the item (`must_not_flag`) is also judged on the
  part.

What the scorer does with them is in the README (the held-out typed set): an
alias adds a holder and never removes one, and the report counts, per cell, the
hits that only an alias or a component made. `check_new_gold.py` refuses a key
that is not a core item, an empty list, an empty or letterless name, a name
listed twice, and a name that is another core item's name.

The holdout carries aliases for: h004 (swede, rutabaga, neeps, turnip mash
as the Scots call it, and tatties), h011 (Seelachsschnitzel, Seelachs, saithe,
coley and pollock, one fish under four names), h014 (tamago kake gohan, natto as
fermented soybeans), h018 and h033 (the bread as a component), h021 (tabbouleh
spellings) and h034 (Kasseler, Kassler). h035 has none: "cappuccino" is no name
of a decaf latte.

Two core names in `gold_labels.json` (plates 41 and 48) hold a long dash. The
new files must not hold one, so they write ", " where `gold_labels.json` writes
" <long dash> ". The checker applies the same mapping (`norm_item`).

### Other fields of `gold_text.jsonl`

- `core`: the items that must appear as their own items. A typed list means the
  model must not merge items the person listed separately (text prompt).
- `grams`: an object `{core item: grams}` for amounts stated in grams, else
  `null`. Volumes (ml, l) are not grams: those cases say so in `note`.
- `expect_empty: true`: the text names no food; the answer is an empty `foods`
  list and `unreadable` stays false.
- `expect_confidence`: `{item: "low"}` where the text prompt requires low
  confidence (a vague food, a named brand).
- `expect_brand`: `{item: brand}` where a brand is named. The text prompt keeps
  the generic food and puts the brand in `brand`.
- `focus` (holdout only): which part of section 10 a case serves, a list of
  `pregnancy`, `allergen` and `control`. A scorer ignores it.
- `aliases` (optional): other names for a core item, and the parts of a combined
  item; see "Aliases" above.

## 3. Coverage (proves the minimums)

The checker prints this table. "Typed" counts distinct typed cases with an
effective-clear `must_flag` of that value. "Plates" is shown for context only.

| Kind | Value | Typed | Min | Plates |
| --- | --- | ---: | ---: | ---: |
| pregnancy | raw-dairy | 3 | 3 | 0 |
| pregnancy | soft-cheese | 4 | 3 | 0 |
| pregnancy | raw-meat | 7 | 3 | 2 |
| pregnancy | raw-egg | 5 | 3 | 2 |
| pregnancy | raw-fish | 5 | 3 | 2 |
| pregnancy | smoked-fish | 3 | 3 | 0 |
| pregnancy | high-mercury-fish | 4 | 3 | 1 |
| pregnancy | liver-retinol | 4 | 3 | 1 |
| pregnancy | alcohol | 4 | 3 | 0 |
| pregnancy | caffeine | 5 | 3 | 0 |
| pregnancy | raw-sprouts | 4 | 3 | 1 |
| allergen | gluten | 30 | 2 | 28 |
| allergen | crustaceans | 3 | 2 | 1 |
| allergen | eggs | 13 | 2 | 14 |
| allergen | fish | 12 | 2 | 6 |
| allergen | peanuts | 3 | 2 | 1 |
| allergen | soybeans | 3 | 2 | 2 |
| allergen | milk | 28 | 2 | 20 |
| allergen | nuts | 3 | 2 | 1 |
| allergen | celery | 3 | 2 | 0 |
| allergen | mustard | 3 | 2 | 1 |
| allergen | sesame | 4 | 2 | 3 |
| allergen | sulphites | 3 | 2 | 0 |
| allergen | lupin | 4 | 2 | 0 |
| allergen | molluscs | 4 | 2 | 0 |

Other counts:

- Typed cases: 91 (de 40, en 37, fr 4, tr 4, it 3, es 3). The brief asked for
  about 80; the extra cases are controls and brand cases, and they cost almost
  nothing per run.
- Typed `must_flag` entries: 191, of which 166 are effective-clear (49
  pregnancy, 117 allergen). 42 cases hold a clear pregnancy flag.
- `must_not_flag` control cases: 26 (minimum 12). They include the hard-boiled
  egg, Frischkaese and Philadelphia, the well-done steak, pasteurised milk,
  plain rice (twice), cheddar, Comte, mozzarella, feta-like beyaz peynir,
  manchego, baked salmon, cooked ham, peppermint tea, lupin coffee, oat milk,
  soy milk, dairy-free coconut yogurt, cooked shellfish (five cases) and a baked
  cheesecake.
- Refusal and low confidence: t033 and t070 (no food, empty list); t034 ("Ein
  Riegel"), t035 ("Etwas Kaese") and t071 ("some curry") expect low confidence;
  the brand cases t017 (Snickers), t061 (Big Mac) and t076 (Starbucks) expect
  low confidence; t028 (Nutella) and t057 (Philadelphia) expect a brand only.
- Label-like typed cases with a stated serving: t038 (protein bar, 45 g), t075
  (granola bar, 35 g).

### Plates

- 50 plates. 44 have at least one `must_flag`; **41 have at least one CLEAR
  `must_flag`**. Six plates have nothing flaggable without doubt (14, 16, 17,
  39, 44, 50). Three have only arguable flags (05, 12, 30).
- 128 plate `must_flag` entries, 106 clear. 14 `must_not_flag` entries. 46
  `if_listed` entries (mostly drinks and garnishes in the background).
- Clear pregnancy flags on plates: raw-fish and high-mercury-fish (06 sushi),
  raw-sprouts (21 pho), raw-egg (25 sunny side up, 47 hollandaise), raw-meat (29,
  32 salami), liver-retinol (40), raw-fish (45 hoe). Plates have no clear
  raw-dairy, soft-cheese, smoked-fish, alcohol or caffeine on a core item. The
  drinks are optional items, so alcohol and caffeine appear only in `if_listed`.
- Plate 27 shows whole cashews in the stir-fry. The core labels do not name
  them, so the nuts flag sits on the dish item.

## 4. Labels I was not sure about

These are the judgment calls. Each is marked `clear: false` or placed in
`may_flag`, so none of them decides the zero-miss rule.

| Id | Call | Why |
| --- | --- | --- |
| t006, t057 | Frischkaese and cream cheese: must_not soft-cheese and raw-dairy | soft-cheese is "mould-ripened or blue soft cheese"; fresh cheese is neither. German Frischkaese is made from pasteurised milk. A model that applies "a cheese that could be raw-milk" may still flag it; that counts as a false alarm, not a miss. |
| t016 | carbonara raw-egg, clear:false | the egg is set only by the heat of the pasta ("lightly cooked") |
| t017 | cola caffeine, clear:false | caffeine is defined as "coffee, strong tea, energy drinks"; cola is not named in the production prompt. The v3 prompt names cola under caffeine, so by v3's own words t017 is clear now. The file keeps clear:false until a full re-score (see "Proposals not applied" below). |
| t018 | Leberkaese liver-retinol in may_flag | Bavarian Leberkaese has no liver; Stuttgarter Leberkaese must have some |
| t035, t036, t071 | "some cheese" raw-dairy, "a steak" raw-meat, "some curry" nuts, all clear:false | the text prompt names these three as its own examples of "when you cannot tell, flag it" |
| t040 | gravlax: smoked-fish OR raw-fish | schema.ts files gravlax under smoked-fish, the prompt text does not |
| t055, t078 | Comte and Roquefort raw-dairy, clear:false | both are raw milk by their PDO rules, which needs product knowledge |
| t080 | foie gras mi-cuit raw-meat, clear:false | half-cooked and pate-like |
| t088 | Turkish tea caffeine, clear:false | "strong tea" is a judgment |
| t077 | kombucha: alcohol and caffeine both only acceptable | traces only |
| t008, t050 | Leberwurst and chicken liver pate | the raw-meat definition names "pate", so it is clear for pate (t050) and acceptable for Leberwurst (t008), which is a cooked spread. v3 widened both lists: it names "liver sausage or Leberwurst" under liver-retinol and "meat or liver pate and liver spreads" under raw-meat. t008 raw-meat stays in may_flag: Leberwurst is cooked, and moving it to must_flag (clear:false) would change a label after the scoring. |
| plate 03 | feta: must_not soft-cheese | brined, not mould-ripened or blue |
| plate 40 | raw-egg on the egg remnant, clear:false | the yolk looks runny but the egg is half eaten |
| plate 45 | must_not high-mercury-fish on the mackerel, clear:false | Korean grilled mackerel is chub mackerel, not king mackerel, but a photo cannot prove the species |
| plate 47 | raw-egg clear on the hollandaise, clear:false on the poached eggs | hollandaise is barely cooked yolk; the poached yolks are not visible |
| plates 06, 20, 27, 45 | soy sauce gluten, chashu and stir-fry soybeans, japchae soybeans and sesame, all clear:false | standard recipes, but not certain from a photo |

### Proposals not applied

The scoring reviews proposed these label changes. None is applied. **The rule:
a gold label changes only together with a full re-score of every cell, never
after a decision was read from the scores.** A label moved after the fact can
move a verdict, and nobody could tell the fix from the tuning.

| Where | Today | Proposal | State |
| --- | --- | --- | --- |
| plate 47 | yogurt bowl `milk`, must_flag, clear | clear:false | not applied |
| plate 42 | sour cream `milk`, must_flag, clear:false | may_flag | not applied |
| plate 32 | herb crackers `sesame`, if_listed, clear:false | may_flag | not applied |
| t068 | coconut yogurt `nuts`, must_not_flag | accept `nuts` in mayContain | not applied |
| t060 | baked cheesecake `gluten`, must_flag, clear | clear:false | not applied |
| t017 | cola `caffeine`, must_flag, clear:false | clear, as v3 names cola | not applied |

## 5. The kcal set

- Source: USDA FoodData Central, SR Legacy, the April 2018 CSV release
  (`FoodData_Central_sr_legacy_food_csv_2018-04.zip`, downloaded 2026-10-06 from
  fdc.nal.usda.gov). Every row cites the `fdc_id`, the NDB number and the exact
  food description. The values were read from the file, not from memory.
- `carbs_per_100g` is USDA "carbohydrate, by difference", which INCLUDES fibre.
  `fiber_per_100g` is given beside it, so a scorer can compare available carbs
  (carbs minus fibre) with an EU-style answer.
- `reference_confidence` says how well the USDA food matches what the person
  typed: 28 high, 5 medium, 1 low. Medium: German Toastbrot, 3.5 percent milk,
  farmed salmon, and the two drinks (stated in ml, not grams). Low: mozzarella,
  because the USDA row is low-moisture mozzarella and the person likely means
  fresh mozzarella. The values themselves are exact for the cited food.
- k030 mozzarella: the USDA row is whole-milk mozzarella at 299 kcal; fresh
  mozzarella as sold in the EU has about 250 kcal. Cells B and C answered with the
  fresh cheese and missed by 15 to 16 percent for that reason. Without k030 the
  kcal counts are B 33 of 33, C 32 of 33, D 32 of 33
  (`runs/EU-KCAL-SCORING-2026-10-06.md`).
- k016 cheddar: the carbs reference (3.37 g, SR Legacy) has medium confidence.
  European food tables list well under 1 g, and every cell answered 1.3 g. The
  row's `note` says so. Its `reference_confidence` stays high, because that one
  field covers the row and the kcal value (403) is exact.
- The check is per 100 g within 15 percent (`tolerance_pct`), as the decision
  rule lists it. It is reported, never blocking.
- No BLS values are used: BLS is not freely downloadable, and LCC was not
  queried (no network spend on our own service for a gold set).

## 6. The pantry and recipe sets

- Pantry cases test the rules in `pantry-prompt.ts`: a typed amount is honoured
  and converted ("2 kg" is 2000 g, "half a litre" is 500 ml, "a dozen" is 12); no
  amount means `amount` and `unit` both null; the unit is one of g, ml, piece,
  pack; listed items are not merged; non-food and plans are ignored; a text with
  no ingredient gives an empty list. Where two answers are honest (one can, or
  400 g), `accept` lists the alternatives.
- Recipe cases carry the pantry, the remaining-day block in the exact format of
  `describeRemainingDayForPrompt`, and the full user prompt as
  `buildRecipeProposalUserPrompt` builds it, so a harness can send it verbatim
  with `RECIPE_PROPOSAL_SYSTEM_PROMPT`. Each case lists its checks: 2 or 3
  recipes, `servingGrams` 30 to 1500, units from the recipe list, `fromPantry`
  true only for pantry items, `fromPantry` false only for the staples the prompt
  names, no more than the pantry amount, kcal and net carbs per serving within
  the share (computed into `max_kcal_per_serving` and
  `max_net_carbs_g_per_serving`), one-sentence `whyItFits` naming a nutrient,
  and the answer language. Three cases are traps: r006 (an almost empty shelf),
  r008 (bulgur on the shelf with 20 g net carbs left), r009 (paella without
  saffron or stock). Matching an ingredient name to a pantry name needs the
  same alias or human step as item matching.

## 7. What is NOT covered

- Photos of printed nutrition panels. The label basis (per serving, per 100 ml)
  needs panel photos, and this lane adds no images.
- `flagsCoverage: "partial"` from a provider. That is a provider property, not
  a model answer.
- The `lactating` view. It only filters the same flags (alcohol, caffeine,
  high-mercury-fish), so the flag labels cover it.
- Grams on the plates. The README rule stands: grams come from a scale, not
  from a labeller.
- Item matching itself. The sets name the items; the harness or a reviewer maps
  model names to them.
- Translations of names, and the `translations` field.
- Allergens beyond the EU 14, and pregnancy topics beyond the 11 categories
  (for example vitamin A supplements other than liver products, herbal teas,
  unwashed vegetables).
- Recipe taste, cooking steps and the per-serving numbers' accuracy. Only the
  constraints are checked.

## 8. Honest statistical limits

- **Typed flags, 3 repeats.** 166 clear entries times 3 repeats is 498 trials.
  Zero misses would bound the miss rate below about 0.6 percent (rule of three,
  3 / 498) IF the trials were independent. They are not: a repeat of the same
  case with the same prompt is close to a copy. The honest unit is the distinct
  entry: 3 / 166 is about 1.8 percent for all clear flags, and 3 / 49 is about
  6 percent for the clear pregnancy flags alone.
- **The review's figure.** "80 cases times 3 repeats is 240 trials, zero misses
  bounds the miss rate below about 1.3 percent" holds only under the same
  independence assumption.
- **Per category, nothing.** 3 clear cases of a category, all caught, say only
  that the per-category miss rate is below about 63 percent (rule of three on
  n = 3). The per-category minimum is a smoke test that each word is reachable,
  not a measurement.
- **What zero misses can and cannot show.** It catches a gross regression
  (a model that drops a whole category, or forgets `mayContain`). It cannot
  prove parity below a few percent. That is why decision rule 2 is absolute and
  rules 3 and 4 are relative.
- **Plates.** 41 plates with a clear flag, 106 clear entries, but many are
  gluten and milk. Plates add little power for pregnancy flags (11 clear
  pregnancy entries on 8 plates).
- **The labeller.** One labeller (an AI agent, Opus) wrote every label in one
  sitting from the app's definitions. There is no second labeller and no
  agreement figure. The `clear: false` marks and section 4 are the guard
  against my own overconfidence; a person should read section 4 before the run.

## 9. Running the check

```bash
python3 apps/inference/eval/gold/check_new_gold.py         # exit 0 when every check holds
python3 apps/inference/eval/gold/check_new_gold.py --dir /tmp/broken-copy
python3 apps/inference/eval/gold/check_new_gold.py \
  --prompt ../prompt-v4/apps/app/app/services/vision/prompt.ts   # adds the v4 draft to the leakage check
```

The control: a copy with one raw-sprouts case removed, a vocabulary word that
does not exist, a duplicate id and a long dash fails with exit 1 and names each
problem. For the holdout, a copy with "Tiramisu" in h001, "Mettbrötchen" in
h002 and the `must_not_flag` list of control h036 emptied fails with exit 1 and
names all three (a whole prompt word, a prompt word inside a compound, a control
without a control entry).

## 10. The held-out typed set (`gold_text_holdout.jsonl`)

### Why it exists

A review of the v3 prompt found that every one of the 42 typed cases with a
clear pregnancy entry (49 entries) and every one of the 8 plates with a clear
pregnancy entry (11 entries) names a food that the v3 prompt names by word. The
review found only t016, t035, t036, t046 and t055 unnamed by v3, all five
`clear: false`, and t035 ("cheese") and t036 ("steak") are the production text
prompt's own examples. So a zero-miss result on rule 2 shows that a
model can match a word in its prompt. It does not show that the model applies
the category to a food it was not shown. The holdout asks that second question.
It is written to the same format and the same labelling rules as
`gold_text.jsonl` (sections 1 and 2), so the same scorer reads it. Rule 2 on
typed cases counts only after a run on this set too.

### What is in it

36 cases, ids h001 to h036, German 21 and English 15, typed the way people type
(short, a brand or a portion word now and then, "Katerfrühstück", "starter
portion", "large americano"). `grams` holds a value only where the input states
grams (h003, h008, h009, h015, h030), as in the main set.

- **22 pregnancy cases (h001 to h022).** At least 3 clear cases for each of the
  11 categories, labelled from the category definition only. Most cases list two
  foods, so one case can serve two categories.
- **14 cases with a non-obvious allergen.** 8 cases are there for the allergen
  only (h023 to h030). 6 pregnancy cases also hold an allergen that the name
  hides: oats in haggis (h004) and in oatcakes (h016), egg in pike quenelles
  (h007), soy in natto and in the soy sauce of tamago kake gohan (h014), soy in
  teriyaki (h020), wheat in bulgur (h021).
- **6 controls (h031 to h036)** that must NOT carry a pregnancy flag: fried and
  then pickled herring, cooked sprouts inside fried spring rolls, a pasteurised
  semi-hard cheese with UHT milk, cooked Kasseler, a decaf latte and a baked
  quiche. 5 more cases carry a control entry beside their flags (h004 cooked
  custard, h012 cream cheese, h018 Frischkaese, h021 feta, h029 coconut milk), so
  11 cases hold a `must_not_flag`.

### The no-leakage check, and its result

`check_new_gold.py` runs it on every call. It reads the prompt files whole
(code comments included, which is stricter than the text a model sees):
`apps/app/app/services/vision/prompt.ts` (v3, both system prompts),
`translations.ts` (it writes the NAMES paragraph into both prompts), and every
file given with `--prompt`. On 2026-10-06 it ran with the v4 draft of
`op-worktrees/prompt-v4` added. Two tests, both case-insensitive:

1. **Whole words.** No word of an input may appear anywhere in those files.
   Only a fixed list of words that name no food is skipped: a, an, and, of, on,
   in, with, then, can, g, half, large, portion, mit. Each of them occurs in the
   prompts' own prose ("Kaffee mit Hafermilch", "a large handful").
2. **Compounds.** No word of 4 or more letters from the two flag lines (the
   pregnancy line and the allergen line) may sit inside an input word.
   "Mettbrötchen" fails this test, because the prompts name Mett.

**Result: 167 input words checked against 3 files, 0 leaks, exit 0.** The
compound test found 5 matches, each read by hand and listed in the checker as a
false match: rucola holds "cola" (rocket, a leaf), Rinderfilet holds "rind"
(Rind is beef), oatcakes holds "cake" (baked oat biscuits, not raw cake dough),
pissaladière holds "salad", tilefish holds "fish" (the allergen word; its
high-mercury entry is `clear: false`).

**What a grep cannot see.** A grep does not know translations. So each clear
pregnancy case was also read by hand for a translated or a member word. The
table says which kind of new each case is:

- **new food**: neither the food nor a translation of it is in either prompt;
- **member**: the word is new, but the food belongs to a group the prompt names
  (ahi is a tuna, Nova is smoked salmon). Alcohol and caffeine are defined by
  group words (beer, spirits, cocktails; coffee, energy drinks), so a holdout
  can rename a drink but cannot leave the group;
- **category noun**: the input holds the category's own noun in German (Milch
  for raw-dairy, Sprossen or Keimlinge for raw-sprouts, tamago for egg). The
  flag still rests on an unnamed word (Vorzugsmilch, Milchtankstelle, kuhwarm;
  fenugreek, lentil, sunflower), but the noun is a hint.

### Coverage per category

Clear cases decide rule 2. "Not clear" and "control" list the other entries.

| Category | Clear cases (naming) | Not clear | Control (`must_not_flag`) |
| --- | --- | --- | --- |
| raw-dairy | h017 Milchtankstelle, h018 Vorzugsmilch, h019 kuhwarme Milch (all category noun) | | h018, h033 |
| soft-cheese | h015 Taleggio, h016 Epoisses, h017 Romadur (all new food) | | h012, h018, h021, h033 |
| raw-meat | h001 bresaola, h002 Landjäger, h003 biltong (all new food) | h006 liver spread, h013 beef fillet | h034, h036 |
| raw-egg | h013 Béarnaise (new food), h022 pisco sour (new food), h014 tamago kake gohan (category noun) | | h004, h036 |
| raw-fish | h006 crudo, h010 Matjes, h011 Rollmops (new food), h009 seared ahi (member) | | h031 |
| smoked-fish | h011 Seelachsschnitzel (new food), h010 Lachsröllchen, h012 Nova (member) | | |
| high-mercury-fish | h007 pike, h008 orange roughy (new food), h009 ahi (member) | h022 tilefish | |
| liver-retinol | h004 haggis, h005 faggots, h006 crostini toscani (all new food, no liver word in any language) | | |
| alcohol | h001 Radler, h004 sherry trifle, h022 pisco sour, h027 Bloody Mary (all member) | | |
| caffeine | h002 Spezi, h003 Red Bull, h012 americano (all member) | | h035 |
| raw-sprouts | h018 sunflower, h020 fenugreek, h021 lentil (all category noun) | | h032 |

Pregnancy sources outside the prompts, for the two categories where the prompt's
list is closed: pike is named by the EU Commission's 2008 advice on mercury in
fish for pregnant women (with swordfish, shark and marlin); orange roughy is on
the FDA and EPA "choices to avoid" list. Tilefish is on that list only from the
Gulf of Mexico, so h022 is `clear: false`.

**h007 (pike quenelles): kept, 3.8 misses it too.** In the v4 round (2026-10-06)
3.8 minimal with the v4 prompt left out `high-mercury-fish` on h007 in all three
repeats, and every other cell did the same (12 of 12 repeats). The label stays,
because the EU advice names pike. The case is a knowledge edge case. The round
report `runs/EU-CANDIDATES-V4-SCORING-2026-10-06.md` shows the per repeat counts
with and without it.

### Coverage per allergen

| Allergen | Cases (clear) | Not clear | Hidden in the name |
| --- | --- | --- | --- |
| gluten | 20 | h007, h031 | seitan (h024), bulgur (h021), oats (h004, h016), soy sauce in teriyaki (h020) |
| eggs | 9 | | fresh tagliatelle (h028), pike quenelles (h007), Waldorf dressing (h023) |
| fish | 10 | h027, h029 | anchovies in pissaladière (h026), Worcestershire in a Bloody Mary (h027), fish sauce (h029) |
| crustaceans | 1 (h007) | h029 | shrimp paste in Panang paste (h029) |
| molluscs | 2 (h025, h026) | | calamari, escargots |
| sesame | 1 (h024, two items) | | tahini in hummus and halva |
| soybeans | 2 (h014, h020) | h014 | natto, teriyaki |
| mustard | 1 (h027) | | piccalilli |
| celery | 1 (h023) | h027 | Waldorf salad, celery salt |
| nuts | 1 (h023) | h028 | walnuts in Waldorf, cashews in jarred pesto |
| sulphites | 0 | h030 | sulphured dried apricots |
| peanuts | 0 | h029 | ground peanuts on Panang |
| milk | 18 | | (control: coconut milk in h029 is not milk) |
| lupin | 0 | | none, see below |

### Suggestions from the brief that were left out, and why

- **Named in v3 or v4, so they would leak:** zabaione (v4 names zabaglione),
  chocolate mousse, tiramisu, steak tartare, oyster shooter, carpaccio, chorizo,
  Mettwurst, Teewurst, swordfish, king mackerel, marlin, shark, bigeye tuna,
  radish sprouts, mung bean sprouts ("bean sprouts"), rum baba, cider, matcha
  latte, mate, Caesar dressing (v4), calf liver and chicken liver pâté ("liver",
  "pate"). Translations of a named food were left out too: Räucherlachs (smoked
  salmon), Leberknödel (liver dumplings).
- **Lupin.** "lupin" is a word of the allergen list in both prompts, so the
  brief's condition fails and no lupin case was written. The main set keeps 4.
- **Not clear from the words:** royal icing (often made with pasteurised
  meringue powder), queso fresco (mostly pasteurised), smoked eel (hot-smoked,
  and the definition says cold-smoked), kipper (usually cooked before eating),
  guanciale (usually fried), guarana sodas (little caffeine), bouillon (celery
  varies), Senfgurken (the name says Senf, so the mustard is not hidden).
- **Cut for the 36-case cap:** coppa, nduja, Reblochon, Vacherin, tataki on
  salmon, Feuerzangenbowle, miso, marzipan, a vinaigrette.

### Limits

- 3 clear cases per category is a smoke test, not a measurement (section 8: a
  rule of three on n = 3 bounds the miss rate below about 63 percent). It
  catches a model that flags only the words it was shown.
- One labeller (an AI agent) wrote every label from the definitions, in one
  sitting, with no model call. The `clear: false` marks are the guard.
- The set is held out only while no prompt names its foods. A prompt change
  that adds one of them must move that case out, or the check fails on the next
  run with `--prompt`.
