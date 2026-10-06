#!/usr/bin/env python3
"""Self-check for the flag, kcal, pantry and recipe gold sets (stdlib only).

Run from anywhere:

    python3 apps/inference/eval/gold/check_new_gold.py            # checks this folder
    python3 check_new_gold.py --dir /some/copy/of/gold            # checks a copy
    python3 check_new_gold.py --prompt <path to another prompt.ts> # adds a prompt to the leakage check

Exits 1 when any check fails, 0 otherwise. It prints the coverage table that
proves the minimums in GOLD-NOTES.md.

What it checks:
  - the shape of gold_text.jsonl, gold_text_holdout.jsonl, gold_plate_flags.json,
    gold_kcal_text.jsonl, gold_pantry.jsonl and gold_recipes.jsonl;
  - the held-out typed set (--holdout, default gold_text_holdout.jsonl): ids
    h001 and up, 30 to 36 cases, at least 3 clear must_flag cases for each
    pregnancy category, at least 6 must_not_flag cases, and NO LEAKAGE: no word
    of an input may appear in the prompt texts (the v3 prompt.ts and
    translations.ts of this tree, plus every --prompt), and no word of the
    prompts' flag lines may hide inside an input word, except the adjudicated
    false matches in COMPOUND_FALSE_MATCHES;
  - every flag value is inside the app's vocabulary (constants below);
  - every flag names an item of its case (core, or optional for if_listed);
  - no entry is both required and forbidden, or both acceptable and forbidden;
  - no duplicate id, inside a file or across files;
  - the coverage minimums: at least 3 clear must_flag cases for each of the
    11 pregnancy categories, at least 2 for each of the 14 allergens, and at
    least 12 cases with a must_not_flag control;
  - no long dash (U+2013 or U+2014) in any of the new files, this one included.
"""
import argparse
import json
import os
import re
import sys

# Copied from apps/app/app/services/vision/schema.ts (PREGNANCY_CATEGORIES and
# ALLERGENS), the enums that prompt.ts spells out word for word in its "flags"
# block (buildPlateIdentificationSystemPrompt and buildTextIntakeSystemPrompt).
PREGNANCY_CATEGORIES = [
    "raw-dairy", "soft-cheese", "raw-meat", "raw-egg", "raw-fish", "smoked-fish",
    "high-mercury-fish", "liver-retinol", "alcohol", "caffeine", "raw-sprouts",
]
ALLERGENS = [
    "gluten", "crustaceans", "eggs", "fish", "peanuts", "soybeans", "milk",
    "nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs",
]
# apps/app/app/i18n/language-prefs.ts SUPPORTED_LANGUAGES.
LANGUAGES = ["en", "de", "fr", "it", "es", "tr"]
# apps/app/app/services/vision/pantry-schema.ts PANTRY_UNITS.
PANTRY_UNITS = ["g", "ml", "piece", "pack"]
# apps/app/app/services/vision/recipe-schema.ts RECIPE_UNITS.
RECIPE_UNITS = ["g", "ml", "piece", "tbsp", "tsp"]
# apps/app/app/lib/remaining-day.ts Emphasis and EatingStyleLens; types/enums.ts MealType.
EMPHASIS = ["protein", "fiber", "lowCarb", "light", "balanced"]
LENSES = ["carb", "kcal", "protein", "none"]
SLOTS = ["breakfast", "lunch", "dinner", "snack"]
CONFIDENCE = ["high", "medium", "low"]

MIN_PER_PREGNANCY = 3
MIN_PER_ALLERGEN = 2
MIN_MUST_NOT_CASES = 12

LONG_DASHES = (chr(0x2013), chr(0x2014))
HOLDOUT_FILE = "gold_text_holdout.jsonl"
NEW_FILES = [
    "gold_text.jsonl", HOLDOUT_FILE, "gold_plate_flags.json", "gold_kcal_text.jsonl",
    "gold_pantry.jsonl", "gold_recipes.jsonl", "GOLD-NOTES.md", "check_new_gold.py",
]

# The held-out typed set (GOLD-NOTES.md section 10).
HOLDOUT_MIN_CASES, HOLDOUT_MAX_CASES = 30, 36
HOLDOUT_MIN_MUST_NOT_CASES = 6
HOLDOUT_FOCUS = ("pregnancy", "allergen", "control")
# The prompt texts a holdout input must not share a word with. prompt.ts holds
# both system prompts; translations.ts writes the NAMES paragraph into them.
VISION_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "app", "app", "services", "vision"))
DEFAULT_PROMPTS = [os.path.join(VISION_DIR, "prompt.ts"), os.path.join(VISION_DIR, "translations.ts")]
# Words of an input that name no food: articles, joins, numbers, units and
# portion words. Every one of them occurs in the prompts' own prose.
LEAK_STOP_WORDS = {
    "a", "an", "and", "of", "on", "in", "with", "then", "can", "g", "half", "large", "portion", "mit",
}
# An input word that holds a flag-line word without naming that food. Each was
# read by hand (input word, prompt word): the reason is the note.
COMPOUND_FALSE_MATCHES = {
    ("rucola", "cola"): "rucola is rocket, a leaf; no cola",
    ("rinderfilet", "rind"): "Rind is German for beef; the prompt's rind is a cheese rind",
    ("oatcakes", "cake"): "oatcakes are baked oat biscuits; the prompt's cake is raw cake dough",
    ("pissaladière", "salad"): "an onion tart; salad is not in it",
    ("tilefish", "fish"): "the allergen word fish, which a typed fish case names anyway; high-mercury-fish there is clear:false",
}


class Report:
    def __init__(self):
        self.errors = []

    def fail(self, where, msg):
        self.errors.append(f"{where}: {msg}")


def read_jsonl(path, rep):
    rows = []
    with open(path, encoding="utf-8") as fh:
        for n, line in enumerate(fh, 1):
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                rep.fail(f"{os.path.basename(path)}:{n}", f"invalid JSON ({exc})")
    return rows


def norm_item(name):
    """gold_labels.json writes two core items with ' <long dash> '; the new files write ', '."""
    return name.replace(" " + chr(0x2014) + " ", ", ")


def vocab_for(kind):
    return PREGNANCY_CATEGORIES if kind == "pregnancy" else ALLERGENS


def check_flag_list(where, entries, items, rep, case_clear, need_clear_field):
    keys = set()
    if not isinstance(entries, list):
        rep.fail(where, "flag list is not a list")
        return keys
    for e in entries:
        if not isinstance(e, dict):
            rep.fail(where, f"flag entry is not an object: {e!r}")
            continue
        for f in ("item", "kind", "value"):
            if f not in e:
                rep.fail(where, f"flag entry misses '{f}': {e!r}")
        kind = e.get("kind")
        if kind not in ("pregnancy", "allergen"):
            rep.fail(where, f"kind must be pregnancy or allergen: {e!r}")
            continue
        vals = e.get("value")
        vals = vals if isinstance(vals, list) else [vals]
        if not vals:
            rep.fail(where, f"empty value list: {e!r}")
        for v in vals:
            if v not in vocab_for(kind):
                rep.fail(where, f"value {v!r} is not in the {kind} vocabulary")
        if e.get("item") not in items:
            rep.fail(where, f"item {e.get('item')!r} is not an item of this case")
        if need_clear_field and not isinstance(e.get("clear"), bool):
            rep.fail(where, f"entry needs a boolean 'clear': {e!r}")
        if "clear" in e and not isinstance(e["clear"], bool):
            rep.fail(where, f"'clear' must be boolean: {e!r}")
        keys.add((e.get("item"), kind, json.dumps(e.get("value"))))
    return keys


def effective_clear(entry, case_clear):
    return entry.get("clear", case_clear)


def check_text(path, rep, ids):
    rows = read_jsonl(path, rep)
    must_cov = {("pregnancy", v): set() for v in PREGNANCY_CATEGORIES}
    must_cov.update({("allergen", v): set() for v in ALLERGENS})
    must_not_cases = set()
    langs = {}
    required = ["id", "lang", "input", "core", "grams", "must_flag", "may_flag", "must_not_flag", "clear", "note"]
    for row in rows:
        cid = row.get("id", "?")
        where = f"{os.path.basename(path)} {cid}"
        for f in required:
            if f not in row:
                rep.fail(where, f"missing field '{f}'")
        if cid in ids:
            rep.fail(where, "duplicate id")
        ids.add(cid)
        if row.get("lang") not in LANGUAGES:
            rep.fail(where, f"lang {row.get('lang')!r} not in {LANGUAGES}")
        langs[row.get("lang")] = langs.get(row.get("lang"), 0) + 1
        if not isinstance(row.get("input"), str) or not row.get("input").strip():
            rep.fail(where, "input must be a non-empty string")
        core = row.get("core")
        if not isinstance(core, list) or not all(isinstance(c, str) and c for c in core):
            rep.fail(where, "core must be a list of non-empty strings")
            core = []
        if len(set(core)) != len(core):
            rep.fail(where, "core holds a duplicate item")
        if not isinstance(row.get("clear"), bool):
            rep.fail(where, "clear must be boolean")
        if not isinstance(row.get("note"), str) or not row.get("note").strip():
            rep.fail(where, "note must be a non-empty string")
        grams = row.get("grams")
        if grams is not None:
            if not isinstance(grams, dict) or not grams:
                rep.fail(where, "grams must be null or a non-empty object")
            else:
                for k, v in grams.items():
                    if k not in core:
                        rep.fail(where, f"grams names {k!r}, which is not in core")
                    if not isinstance(v, (int, float)) or v <= 0:
                        rep.fail(where, f"grams for {k!r} must be a positive number")
        if row.get("expect_empty"):
            if core or row.get("must_flag"):
                rep.fail(where, "expect_empty case must have empty core and must_flag")
        elif not core:
            rep.fail(where, "core is empty but expect_empty is not set")
        for opt in ("expect_brand", "expect_confidence"):
            if opt in row:
                if not isinstance(row[opt], dict):
                    rep.fail(where, f"{opt} must be an object")
                    continue
                for k, v in row[opt].items():
                    if k not in core:
                        rep.fail(where, f"{opt} names {k!r}, which is not in core")
                    if opt == "expect_confidence" and v not in CONFIDENCE:
                        rep.fail(where, f"expect_confidence {v!r} not in {CONFIDENCE}")
        cclear = row.get("clear", False)
        must = check_flag_list(where + " must_flag", row.get("must_flag", []), core, rep, cclear, False)
        may = check_flag_list(where + " may_flag", row.get("may_flag", []), core, rep, cclear, False)
        mustnot = check_flag_list(where + " must_not_flag", row.get("must_not_flag", []), core, rep, cclear, False)
        for clash, a, b in (("must_flag and must_not_flag", must, mustnot), ("may_flag and must_not_flag", may, mustnot), ("must_flag and may_flag", must, may)):
            for key in a & b:
                rep.fail(where, f"same entry in {clash}: {key}")
        for e in row.get("must_flag", []):
            if isinstance(e, dict) and isinstance(e.get("value"), str) and effective_clear(e, cclear):
                k = (e.get("kind"), e.get("value"))
                if k in must_cov:
                    must_cov[k].add(cid)
        if row.get("must_not_flag"):
            must_not_cases.add(cid)
    return rows, must_cov, must_not_cases, langs


def words(text):
    """Lower-case letter runs, any script. A hyphen or an apostrophe splits a word."""
    return set(re.findall(r"[^\W\d_]+", text.lower()))


def prompt_words(paths, rep):
    """(every word of the prompt files, the words of 4+ letters on their flag lines)."""
    vocab, flag_words = set(), set()
    for path in paths:
        if not os.path.exists(path):
            rep.fail("leakage", f"cannot find the prompt file {path}")
            continue
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        vocab |= words(text)
        for line in text.splitlines():
            if '"pregnancy": every category' in line or '"allergens": every one' in line:
                flag_words |= {w for w in words(line) if len(w) >= 4}
    if not flag_words:
        rep.fail("leakage", "no prompt file holds a flag line; the check would prove nothing")
    return vocab, flag_words


def check_leakage(rows, prompt_paths, rep):
    """No input word in the prompt texts, and no flag-line word hidden in an input word."""
    vocab, flag_words = prompt_words(prompt_paths, rep)
    checked, adjudicated = 0, []
    for row in rows:
        cid = row.get("id", "?")
        tokens = words(row.get("input", "")) - LEAK_STOP_WORDS
        checked += len(tokens)
        for tok in sorted(tokens & vocab):
            rep.fail(f"{HOLDOUT_FILE} {cid}", f"input word {tok!r} appears in a prompt file (leakage)")
        for tok in sorted(tokens):
            for fw in sorted(flag_words):
                if fw != tok and fw in tok:
                    if (tok, fw) in COMPOUND_FALSE_MATCHES:
                        adjudicated.append((cid, tok, fw))
                    else:
                        rep.fail(f"{HOLDOUT_FILE} {cid}", f"input word {tok!r} holds the flag-line word {fw!r} (leakage, or add an adjudicated false match)")
    return checked, adjudicated


def check_holdout(path, prompt_paths, rep, ids):
    rows, cov, must_not_cases, langs = check_text(path, rep, ids)
    if not HOLDOUT_MIN_CASES <= len(rows) <= HOLDOUT_MAX_CASES:
        rep.fail(HOLDOUT_FILE, f"{len(rows)} cases, expected {HOLDOUT_MIN_CASES} to {HOLDOUT_MAX_CASES}")
    for n, row in enumerate(rows, 1):
        cid = row.get("id", "?")
        if cid != f"h{n:03d}":
            rep.fail(f"{HOLDOUT_FILE} {cid}", f"ids must run h001, h002, ... in order; expected h{n:03d}")
        focus = row.get("focus")
        if not isinstance(focus, list) or not focus or any(x not in HOLDOUT_FOCUS for x in focus):
            rep.fail(f"{HOLDOUT_FILE} {cid}", f"focus must be a non-empty list from {HOLDOUT_FOCUS}")
        elif "control" in focus and not row.get("must_not_flag"):
            rep.fail(f"{HOLDOUT_FILE} {cid}", "a control case needs a must_not_flag entry")
    checked, adjudicated = check_leakage(rows, prompt_paths, rep)
    return rows, cov, must_not_cases, langs, checked, adjudicated


def check_plates(path, labels_path, rep, ids):
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    labels = {}
    if os.path.exists(labels_path):
        with open(labels_path, encoding="utf-8") as fh:
            labels = {k: v for k, v in json.load(fh).items() if not k.startswith("_")}
    else:
        rep.fail("gold_plate_flags.json", f"cannot find {labels_path} to check items against")
    plates = {k: v for k, v in doc.items() if not k.startswith("_")}
    if labels and set(plates) != set(labels):
        rep.fail("gold_plate_flags.json", f"plate keys differ from gold_labels.json: missing {sorted(set(labels) - set(plates))}, extra {sorted(set(plates) - set(labels))}")
    with_clear = []
    pcov = {}
    for pid, p in sorted(plates.items()):
        where = f"gold_plate_flags.json {pid}"
        pkey = f"plate-{pid}"
        if pkey in ids:
            rep.fail(where, "duplicate id")
        ids.add(pkey)
        for f in ("must_flag", "may_flag", "must_not_flag", "if_listed", "note"):
            if f not in p:
                rep.fail(where, f"missing field '{f}'")
        lab = labels.get(pid, {})
        core = {norm_item(c) for c in lab.get("core", [])}
        opt = {norm_item(c) for c in lab.get("optional", [])}
        must = check_flag_list(where + " must_flag", p.get("must_flag", []), core, rep, False, True)
        may = check_flag_list(where + " may_flag", p.get("may_flag", []), core, rep, False, True)
        mustnot = check_flag_list(where + " must_not_flag", p.get("must_not_flag", []), core, rep, False, True)
        check_flag_list(where + " if_listed", p.get("if_listed", []), opt, rep, False, True)
        for clash, a, b in (("must_flag and must_not_flag", must, mustnot), ("may_flag and must_not_flag", may, mustnot), ("must_flag and may_flag", must, may)):
            for key in a & b:
                rep.fail(where, f"same entry in {clash}: {key}")
        if any(isinstance(e, dict) and e.get("clear") for e in p.get("must_flag", [])):
            with_clear.append(pid)
        for e in p.get("must_flag", []):
            if isinstance(e, dict) and e.get("clear") and isinstance(e.get("value"), str):
                pcov.setdefault((e.get("kind"), e.get("value")), set()).add(pid)
    summary = doc.get("_summary", {})
    if summary.get("plates_with_clear_must_flag") != len(with_clear):
        rep.fail("gold_plate_flags.json", f"_summary says {summary.get('plates_with_clear_must_flag')} plates with a clear must_flag, the data says {len(with_clear)}")
    return plates, with_clear, pcov


def check_kcal(path, rep, ids):
    rows = read_jsonl(path, rep)
    for row in rows:
        cid = row.get("id", "?")
        where = f"gold_kcal_text.jsonl {cid}"
        for f in ("id", "lang", "input", "item", "grams", "reference", "reference_confidence", "tolerance_pct", "note"):
            if f not in row:
                rep.fail(where, f"missing field '{f}'")
        if cid in ids:
            rep.fail(where, "duplicate id")
        ids.add(cid)
        if row.get("lang") not in LANGUAGES:
            rep.fail(where, "bad lang")
        g = row.get("grams")
        if g is None:
            if not isinstance(row.get("ml"), (int, float)) or row.get("ml") <= 0:
                rep.fail(where, "grams is null, so a positive ml is required")
        elif not isinstance(g, (int, float)) or g <= 0:
            rep.fail(where, "grams must be positive")
        ref = row.get("reference", {})
        for f in ("source", "fdc_id", "description", "kcal_per_100g", "carbs_per_100g"):
            if f not in ref:
                rep.fail(where, f"reference misses '{f}'")
        kc, cb = ref.get("kcal_per_100g"), ref.get("carbs_per_100g")
        if not isinstance(kc, (int, float)) or not 0 <= kc <= 900:
            rep.fail(where, "kcal_per_100g must be a number in 0..900")
        if not isinstance(cb, (int, float)) or not 0 <= cb <= 100:
            rep.fail(where, "carbs_per_100g must be a number in 0..100")
        if row.get("reference_confidence") not in CONFIDENCE:
            rep.fail(where, f"reference_confidence must be one of {CONFIDENCE}")
    return rows


def check_pantry(path, rep, ids):
    rows = read_jsonl(path, rep)
    for row in rows:
        cid = row.get("id", "?")
        where = f"gold_pantry.jsonl {cid}"
        for f in ("id", "lang", "input", "expect_items", "must_not_items", "expect_empty", "note"):
            if f not in row:
                rep.fail(where, f"missing field '{f}'")
        if cid in ids:
            rep.fail(where, "duplicate id")
        ids.add(cid)
        if row.get("lang") not in LANGUAGES:
            rep.fail(where, "bad lang")
        items = row.get("expect_items", [])
        if row.get("expect_empty") and items:
            rep.fail(where, "expect_empty with items")
        if not row.get("expect_empty") and not items:
            rep.fail(where, "no expect_items and not expect_empty")
        for it in items:
            pairs = [[it.get("amount"), it.get("unit")]] + list(it.get("accept", []))
            for amount, unit in pairs:
                if (amount is None) != (unit is None):
                    rep.fail(where, f"{it.get('name')}: amount and unit must be null together")
                if unit is not None and unit not in PANTRY_UNITS:
                    rep.fail(where, f"{it.get('name')}: unit {unit!r} not in {PANTRY_UNITS}")
                if amount is not None and (not isinstance(amount, (int, float)) or amount <= 0):
                    rep.fail(where, f"{it.get('name')}: amount must be positive")
    return rows


def check_recipes(path, rep, ids):
    rows = read_jsonl(path, rep)
    for row in rows:
        cid = row.get("id", "?")
        where = f"gold_recipes.jsonl {cid}"
        for f in ("id", "lang", "slot", "share_pct", "emphasis", "lens", "pantry", "remaining_day_block", "user_prompt", "checks", "note"):
            if f not in row:
                rep.fail(where, f"missing field '{f}'")
        if cid in ids:
            rep.fail(where, "duplicate id")
        ids.add(cid)
        if row.get("lang") not in LANGUAGES:
            rep.fail(where, "bad lang")
        if row.get("slot") not in SLOTS:
            rep.fail(where, "bad slot")
        if row.get("lens") not in LENSES:
            rep.fail(where, "bad lens")
        if not row.get("emphasis") or any(e not in EMPHASIS for e in row.get("emphasis", [])):
            rep.fail(where, f"emphasis must be a non-empty list from {EMPHASIS}")
        up = row.get("user_prompt", "")
        for p in row.get("pantry", []):
            if (p.get("amount") is None) != (p.get("unit") is None):
                rep.fail(where, f"pantry {p.get('name')}: amount and unit null together")
            if p.get("unit") is not None and p["unit"] not in PANTRY_UNITS:
                rep.fail(where, f"pantry {p.get('name')}: unit not in {PANTRY_UNITS}")
            line = f"- {p['name']}" if p.get("amount") is None else f"- {p['name']}, {p['amount']} {p['unit']}"
            if line not in up.split("\n"):
                rep.fail(where, f"user_prompt misses the pantry line {line!r}")
        if row.get("remaining_day_block", "\0") not in up:
            rep.fail(where, "user_prompt does not hold the remaining_day_block verbatim")
        ch = row.get("checks", {})
        if ch.get("recipes_min") != 2 or ch.get("recipes_max") != 3:
            rep.fail(where, "recipes_min/max must be 2 and 3 (recipe-prompt.ts)")
        if ch.get("serving_grams_min") != 30 or ch.get("serving_grams_max") != 1500:
            rep.fail(where, "serving grams band must be 30..1500 (recipe-prompt.ts)")
        if any(u is not None and u not in RECIPE_UNITS for u in ch.get("ingredient_units", [])):
            rep.fail(where, f"ingredient_units outside {RECIPE_UNITS}")
    return rows


def scan_dashes(folder, rep):
    for name in NEW_FILES:
        path = os.path.join(folder, name)
        if not os.path.exists(path):
            rep.fail(name, "file is missing")
            continue
        with open(path, encoding="utf-8") as fh:
            for n, line in enumerate(fh, 1):
                for d in LONG_DASHES:
                    if d in line:
                        rep.fail(f"{name}:{n}", f"long dash U+{ord(d):04X}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dir", default=os.path.dirname(os.path.abspath(__file__)), help="the gold folder to check (default: this script's folder)")
    ap.add_argument("--labels", default=None, help="gold_labels.json (default: <dir>/gold_labels.json)")
    ap.add_argument("--holdout", default=None, help=f"the held-out typed set (default: <dir>/{HOLDOUT_FILE})")
    ap.add_argument("--prompt", action="append", default=[], help="one more prompt file for the leakage check, for example the v4 draft (repeatable)")
    args = ap.parse_args()
    folder = args.dir
    labels = args.labels or os.path.join(folder, "gold_labels.json")
    holdout = args.holdout or os.path.join(folder, HOLDOUT_FILE)
    prompts = DEFAULT_PROMPTS + args.prompt
    rep = Report()
    ids = set()

    scan_dashes(folder, rep)
    text, cov, must_not_cases, langs = check_text(os.path.join(folder, "gold_text.jsonl"), rep, ids)
    hrows, hcov, h_must_not, hlangs, hchecked, hadjudicated = check_holdout(holdout, prompts, rep, ids)
    plates, with_clear, pcov = check_plates(os.path.join(folder, "gold_plate_flags.json"), labels, rep, ids)
    kcal = check_kcal(os.path.join(folder, "gold_kcal_text.jsonl"), rep, ids)
    pantry = check_pantry(os.path.join(folder, "gold_pantry.jsonl"), rep, ids)
    recipes = check_recipes(os.path.join(folder, "gold_recipes.jsonl"), rep, ids)

    print("Coverage of clear must_flag cases (typed set; plates shown beside, not counted)")
    print(f"{'kind':<10} {'value':<18} {'typed':>5} {'min':>4}  {'plates':>6}  status")
    for kind, vocab, minimum in (("pregnancy", PREGNANCY_CATEGORIES, MIN_PER_PREGNANCY), ("allergen", ALLERGENS, MIN_PER_ALLERGEN)):
        for v in vocab:
            n = len(cov[(kind, v)])
            npl = len(pcov.get((kind, v), ()))
            status = "PASS" if n >= minimum else "FAIL"
            print(f"{kind:<10} {v:<18} {n:>5} {minimum:>4}  {npl:>6}  {status}")
            if n < minimum:
                rep.fail("coverage", f"{kind} {v}: {n} clear must_flag cases, minimum {minimum}")
    print(f"must_not_flag control cases: {len(must_not_cases)} (min {MIN_MUST_NOT_CASES})")
    if len(must_not_cases) < MIN_MUST_NOT_CASES:
        rep.fail("coverage", f"{len(must_not_cases)} must_not_flag control cases, minimum {MIN_MUST_NOT_CASES}")

    n_clear_entries = sum(1 for r in text for e in r.get("must_flag", []) if isinstance(e, dict) and effective_clear(e, r.get("clear", False)))
    n_entries = sum(len(r.get("must_flag", [])) for r in text)
    print(f"typed cases: {len(text)} by language {dict(sorted(langs.items()))}")
    print(f"typed must_flag entries: {n_entries}, of which clear: {n_clear_entries}")
    print(f"plates: {len(plates)}, with at least one clear must_flag: {len(with_clear)}")
    print(f"kcal cases: {len(kcal)}, pantry cases: {len(pantry)}, recipe cases: {len(recipes)}")

    print(f"\nHeld-out typed set ({os.path.basename(holdout)}): clear must_flag cases per value")
    print(f"{'kind':<10} {'value':<18} {'cases':>5} {'min':>4}  status")
    for kind, vocab in (("pregnancy", PREGNANCY_CATEGORIES), ("allergen", ALLERGENS)):
        for v in vocab:
            n = len(hcov[(kind, v)])
            minimum = MIN_PER_PREGNANCY if kind == "pregnancy" else 0
            status = "PASS" if n >= minimum else "FAIL"
            print(f"{kind:<10} {v:<18} {n:>5} {minimum:>4}  {status}")
            if n < minimum:
                rep.fail("holdout coverage", f"{kind} {v}: {n} clear must_flag cases, minimum {minimum}")
    print(f"must_not_flag cases: {len(h_must_not)} (min {HOLDOUT_MIN_MUST_NOT_CASES})")
    if len(h_must_not) < HOLDOUT_MIN_MUST_NOT_CASES:
        rep.fail("holdout coverage", f"{len(h_must_not)} must_not_flag cases, minimum {HOLDOUT_MIN_MUST_NOT_CASES}")
    focus_counts = {f: sum(1 for r in hrows if f in (r.get("focus") or [])) for f in HOLDOUT_FOCUS}
    print(f"cases: {len(hrows)} by language {dict(sorted(hlangs.items()))}, by focus {focus_counts}")
    print(f"leakage: {hchecked} input words checked against {len(prompts)} prompt file(s):")
    for p in prompts:
        print(f"  - {p}")
    for cid, tok, fw in hadjudicated:
        print(f"  adjudicated false match {cid}: {tok!r} holds {fw!r} ({COMPOUND_FALSE_MATCHES[(tok, fw)]})")

    if rep.errors:
        print(f"\nFAIL: {len(rep.errors)} problem(s)")
        for e in rep.errors:
            print("  - " + e)
        return 1
    print("\nOK: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
