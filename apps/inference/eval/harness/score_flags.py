"""Score the SAFETY FLAGS (pregnancy and allergens) of finished eval runs against the gold flag labels.

Stdlib only. No model call, no key: every answer is read from a run's `results.json`.

    python3 -m harness.score_flags                       # the EU cells, writes runs/EU-FLAG-SCORING-*.{json,md}
    python3 -m harness.score_flags --map-dump            # print the item mapping for review, score nothing
    python3 -m harness.score_flags --config configs/score-flags-v3.json   # cells, runs and rules from a file

A config file names the cells, their run directories, the rule test and `expected_repeats`, the typed repeats rule 2
needs (default 3; see `load_config`). A cell may also list `holdout` runs: typed runs of a second gold file
(`typed_gold_holdout`, default `gold/gold_text_holdout.jsonl`), scored in their own "Holdout" block with rule 2
evaluated on them for the test cell. A run that is missing, unreadable or still being written (`_partial` in its
`results.json`, or fewer answers than the gold) is never scored: the report names it as INCOMPLETE. A run name is a
directory under `--runs-dir` (default `runs/`); a relative path with `..` reaches another worktree, an absolute
path works too. A cell may list several plate runs (repeats); a plate run is used only when it holds every plate.
Without `--config` the scorer runs the fixed EU cells B, C and D, as before.

How a label is read (gold/GOLD-NOTES.md, section 2):

- `must_flag`: the value must be on the model item that holds the food. Absent is a MISS. For a pregnancy
  category, absent means not in `pregnancy`. For an allergen, absent means in NEITHER `allergens` NOR
  `mayContain`, because the app shows a chip for both (`app/lib/food-cautions.ts`).
- An allergen that is in `mayContain` but not in `allergens` where gold says must_flag is a DEMOTION. It is
  reported, never a miss.
- `must_not_flag`: present is a FALSE ALARM. Reported, never blocking.
- `may_flag`: an acceptable extra. Anything else on a matched item is an EXTRA flag, counted per case.
- `if_listed` (plates): required only when the model lists that optional item. Scored like `must_flag` with
  its own `clear`, and kept in its own column.
- Clear: `entry.clear` if present, else `case.clear` (typed); every plate entry carries its own.

Item mapping. The model names items in the case language (typed) or in English (plates); every typed answer
also carries `translations.en`. A model item HOLDS a gold item when their normalised names share enough
words (a specific word counts 1, a generic word such as "sauce" or "grilled" counts 0.3, the bar is 1),
after an explicit synonym table, plus `OVERRIDES` for the names the words cannot decide. When one model item
holds several gold items (a merge), the flags of that item count for each of them. When several model items
hold one gold item (a split, say pad thai plus a bowl of sprouts), a flag counts when it is on any of them.

A gold item that no model item holds was NOT LISTED. It cannot carry a flag. That is a miss only for an
effective-clear must_flag (the task's rule), and the report says whether the same flag sits on another item
of the answer, so a person can judge it.

A call that failed (no parseable answer, or an `{"error": ...}` record from a call that raised) shows the person
an error, not an unflagged food. It is scored by decision rule 1, not as a flag miss: its entries are counted
apart as `failed_call`, with what the truncated text held. They still reach the verdicts: every rule prints a
second line that counts a failed call's must_flag entries as misses, and a rule whose verdict changes between the
two lines is INCONCLUSIVE.

Verdicts of rules 2 to 4 (`evaluate_rules`):

- Rule 2 needs `expected_repeats` typed repeats (config key, default 3). Fewer is INCOMPLETE unless a miss already
  decides it (FAIL). No miss and a failed call that holds a clear entry is INCONCLUSIVE.
- Rules 3 and 4 PASS only when the clear-only comparison AND the all-entries comparison both pass. Both numbers
  are printed.
- Merge leniency: an item that holds more than one gold food carries its flags for each of them. The report counts
  the hits credited that way per cell. The strict view lets one flag value on one such item credit one gold entry
  only; it is printed beside the verdict and does not decide.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import importlib.util
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

EVAL_ROOT = Path(__file__).resolve().parent.parent
GOLD_DIR = EVAL_ROOT / "gold"
RUNS_DIR = EVAL_ROOT / "runs"


def _load_vocab():
    """The two enums, from the gold checker, so the scorer and the checker can never drift apart."""
    spec = importlib.util.spec_from_file_location("check_new_gold", GOLD_DIR / "check_new_gold.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return list(mod.PREGNANCY_CATEGORIES), list(mod.ALLERGENS), mod.norm_item


PREGNANCY_CATEGORIES, ALLERGENS, norm_item = _load_vocab()

# The cells of the EU switch. A text cell lists its repeats; a repeat is used only when it holds every case.
CELLS = {
    "B": {
        "label": "3.8, default reasoning, new prompt",
        "text": ["text-eu-cell-38-newprompt-r1", "text-eu-cell-38-newprompt-r2", "text-eu-cell-38-newprompt-r3"],
        "plates": "eu-cell-38-newprompt",
    },
    "C": {
        "label": "3.8, reasoning minimal, new prompt",
        "text": [
            "text-eu-cell-38-minimal-newprompt-r1",
            "text-eu-cell-38-minimal-newprompt-r2",
            "text-eu-cell-38-minimal-newprompt-r3",
        ],
        "plates": "eu-cell-38-minimal-newprompt",
    },
    "D": {
        "label": "3.5 flash lite EU, minimal, new prompt",
        "text": [
            "text-eu-cell-35-eu-newprompt-r1",
            "text-eu-cell-35-eu-newprompt-r2",
            "text-eu-cell-35-eu-newprompt-r3",
        ],
        "plates": "eu-cell-35-eu-newprompt",
    },
}
SKIPPED_CELLS = {
    "A": ("eu-cell-38-prod-oldprompt", "OLD small schema without flags"),
    "E": ("eu-cell-35-eu-oldprompt", "OLD small schema without flags"),
}
DEFAULT_TEST = "D"
DEFAULT_REFS = ("B", "C")
#: Typed repeats the decision rule asks for. Rule 2 is INCOMPLETE with fewer.
DEFAULT_EXPECTED_REPEATS = 3
#: The typed gold of the main set and of the held-out set, relative to the eval root (a config may name others).
DEFAULT_TYPED_GOLD = "gold/gold_text.jsonl"
DEFAULT_TYPED_GOLD_HOLDOUT = "gold/gold_text_holdout.jsonl"


def plate_names(spec: dict) -> list[str]:
    """The plate runs of a cell: one name (the fixed cells) or a list of repeats (a config file)."""
    plates = spec.get("plates")
    if not plates:
        return []
    return [plates] if isinstance(plates, str) else list(plates)


def gold_path(name: str) -> Path:
    """A gold file named in a config: relative to the eval root, or absolute."""
    return EVAL_ROOT / Path(name).expanduser()


def run_path(runs_dir: Path, name: str) -> Path:
    """A run name is a directory under `runs_dir`, a relative path from it, or an absolute path."""
    return runs_dir / Path(name).expanduser()


def run_display(name: str) -> str:
    """A short run name for the report: `worktree:directory` for a run in another worktree."""
    parts = [p for p in Path(name).parts if p not in ("..", ".", "/")]
    if len(parts) <= 1:
        return name
    return f"{parts[0]}:{parts[-1]}" if "op-worktrees" not in parts else f"{parts[parts.index('op-worktrees') + 1]}:{parts[-1]}"


def load_config(path: Path) -> dict:
    """Read a cell config. Shape (every key but `cells` and `test` optional):

        {"title": "...", "intro": ["line", ...], "out": "runs/EU-FLAG-SCORING-V3-2026-10-06",
         "test": "D3", "refs": ["B", "C3"], "expected_repeats": 3,
         "cells": {"D3": {"label": "...", "text": ["run-r1", "run-r2"], "plates": ["run", "run-r2"]}, ...},
         "skipped": {"run name": "why"},
         "sanity_cells": ["B", "C3", "D3"], "category_cells": [...], "compare": [["D", "D3"], ["C", "C3"]]}

    A cell needs at least one of `text`, `plates` and `holdout`. The test cell and every ref must be cells.
    `expected_repeats` (default 3) is how many typed repeats the test cell must hold for rule 2 to be decided;
    a cell with fewer gives INCOMPLETE. It must be a whole number of at least 1.

    Held-out typed set (all optional; with none of these keys the report is the one it always was):
    `typed_gold` (default `gold/gold_text.jsonl`) is the gold of every cell's `text` runs; `typed_gold_holdout`
    (default `gold/gold_text_holdout.jsonl`) is the gold of every cell's `holdout` runs, a list of run
    directories. Holdout runs are reported apart, in the "Holdout" block, and rule 2 is evaluated there for the
    test cell with `expected_repeats` repeats. When a cell lists `holdout`, `expected_repeats` counts the holdout
    repeats only; the `text` runs of the test cell then need `expected_text_repeats` (default: the value of
    `expected_repeats`, so a file without the new keys reads as before). When the test cell has `holdout` and no
    `text`, rule 2 is evaluated on the holdout only.
    """
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    cells = cfg.get("cells")
    if not isinstance(cells, dict) or not cells:
        raise ValueError(f"{path}: `cells` must name at least one cell")
    for name, spec in cells.items():
        if not spec.get("text") and not plate_names(spec) and not spec.get("holdout"):
            raise ValueError(f"{path}: cell {name} lists no text, plate or holdout runs")
        holdout = spec.get("holdout")
        if holdout is not None and (not isinstance(holdout, list) or not all(isinstance(h, str) for h in holdout)):
            raise ValueError(f"{path}: cell {name}: `holdout` must be a list of run directories")
        spec.setdefault("label", name)
        spec.setdefault("text", [])
    test = cfg.get("test")
    refs = list(cfg.get("refs") or [])
    for name in [test, *refs, *(cfg.get("sanity_cells") or []), *(cfg.get("category_cells") or []),
                 *(c for pair in cfg.get("compare") or [] for c in pair)]:
        if name not in cells:
            raise ValueError(f"{path}: {name!r} is used but is not a cell")
    cfg["refs"] = refs
    expected = cfg.setdefault("expected_repeats", DEFAULT_EXPECTED_REPEATS)
    if isinstance(expected, bool) or not isinstance(expected, int) or expected < 1:
        raise ValueError(f"{path}: `expected_repeats` must be a whole number of at least 1, got {expected!r}")
    if "expected_text_repeats" in cfg:
        text_expected = cfg["expected_text_repeats"]
        if isinstance(text_expected, bool) or not isinstance(text_expected, int) or text_expected < 1:
            raise ValueError(f"{path}: `expected_text_repeats` must be a whole number of at least 1, got {text_expected!r}")
    for key in ("typed_gold", "typed_gold_holdout"):
        if key in cfg and (not isinstance(cfg[key], str) or not cfg[key]):
            raise ValueError(f"{path}: `{key}` must name a gold file")
    return cfg

# ---------------------------------------------------------------------------
# Names
# ---------------------------------------------------------------------------

STOPWORDS = {
    # function words in the six languages
    "a", "an", "the", "and", "with", "of", "on", "in", "or", "e", "g", "eg",
    "mit", "und", "auf", "im", "vom", "aus", "dem", "der", "die", "das", "ein", "eine",
    "au", "aux", "de", "du", "des", "d", "la", "le", "les", "sur", "avec", "et", "un", "une",
    "al", "alla", "alle", "con", "di", "il", "y", "el", "en",
    # amounts and containers
    "piece", "pieces", "pcs", "slice", "slices", "portion", "serving", "glass", "cup", "bowl", "plate",
    "medium", "large", "small", "half", "pc", "1", "2",
    # states that name no food
    "raw", "cooked", "fresh", "plain", "dry", "dried", "whole", "partly", "eaten", "remnant", "visible",
    "type", "style", "separate", "item", "background", "bitten",
}

# Words that do name a food, but too broadly to decide alone which gold item a model item holds.
GENERIC = {
    "white", "green", "red", "black", "yellow", "brown", "dark", "golden", "orange", "pale", "clear",
    "sauce", "salad", "sliced", "grilled", "fried", "roasted", "roast", "baked", "boiled", "steamed",
    "mixed", "side", "creamy", "cream", "hot", "mini", "thick", "cut", "spiced", "seasoned", "topping",
    "topped", "stewed", "braised", "glazed", "breaded", "battered", "pan", "chopped", "shredded", "grated",
    "dip", "dressing", "stew", "soup", "broth", "gravy", "leaf", "leafy", "mash", "mashed", "stir",
    "drizzle", "herb", "vegetable", "meat", "filling", "filled", "skin", "on", "well", "done", "spicy",
    "sweet", "seasoning", "bread", "roll", "bun", "dish", "curry",
}

# Spelling and language variants mapped onto one word. Applied before and after the plural is cut.
SYNONYMS = {
    # German
    "lachs": "salmon", "graved": "gravlax", "gravad": "gravlax", "thunfisch": "tuna",
    "zwiebel": "onion", "zwiebeln": "onion", "senf": "mustard", "kase": "cheese", "ei": "egg", "eier": "egg",
    "brotchen": "bread", "brot": "bread", "semmel": "bread", "gurke": "cucumber", "hafermilch": "oat",
    "kaffee": "coffee", "reis": "rice", "lupinen": "lupin", "leberkassemmel": "leberkase", "mettbrotchen": "mett",
    "leberkasesemmel": "leberkase", "leberkaese": "leberkase",
    # French, Italian, Spanish, Turkish
    "frites": "fry", "vin": "wine", "blanc": "white", "vino": "wine", "tinto": "red", "cerveza": "beer",
    "altramuces": "lupin", "lupini": "lupin", "lupine": "lupin", "jamon": "ham", "queso": "cheese",
    "gambas": "prawn", "ristretto": "espresso", "caffe": "espresso", "cornetto": "croissant",
    "cay": "tea", "peynir": "cheese", "kahvesi": "coffee", "kahve": "coffee", "midye": "mussel",
    "vongole": "clam", "oeuf": "egg",
    # English variants
    "shrimp": "prawn", "prawns": "prawn", "langostino": "prawn", "langostinos": "prawn",
    "chip": "fry", "chips": "fry", "fries": "fry", "frie": "fry",
    "frankfurter": "sausage", "frankfurters": "sausage", "wurst": "sausage", "bratwurst": "sausage",
    "weisswurst": "sausage", "sausages": "sausage",
    "liverwurst": "liver", "leberwurst": "liver", "pate": "pate", "pâte": "pate",
    "yoghurt": "yogurt", "joghurt": "yogurt", "raita": "yogurt", "curd": "yogurt",
    "gherkin": "pickle", "gherkins": "pickle", "pickles": "pickle", "pickled": "pickle",
    "mayo": "mayonnaise", "aioli": "mayonnaise",
    "greens": "cabbage", "kale": "cabbage", "spaetzle": "spatzle", "spatzle": "spatzle",
    "kasespatzle": "spatzle", "kasespaetzle": "spatzle",
    "doner": "gyros", "kebab": "gyros", "gyro": "gyros", "shawarma": "gyros",
    "papadum": "papad", "poppadom": "papad", "poppadum": "papad", "pappadam": "papad",
    "chapati": "roti", "chapatti": "roti", "naan": "roti", "flatbread": "roti",
    "tortilla": "tortilla", "taco": "taco", "tacos": "taco",
    "omasum": "tripe", "beancurd": "tofu", "yuba": "tofu",
    "rasher": "bacon", "rashers": "bacon", "gammon": "bacon",
    "porridge": "oatmeal", "oats": "oatmeal", "oat": "oatmeal",
    "brezel": "pretzel", "pretzels": "pretzel",
    "hollandaise": "benedict",
    "salmon": "salmon",
}


def _fold(text: str) -> str:
    text = text.lower().replace("œ", "oe").replace("æ", "ae").replace("ß", "ss").replace("ı", "i")
    text = unicodedata.normalize("NFKD", text)
    return "".join(c for c in text if not unicodedata.combining(c))


def _singular(word: str) -> str:
    if len(word) <= 3:
        return word
    if word.endswith("ies"):
        return word[:-3] + "y"
    if word.endswith(("oes", "ches", "shes", "xes", "sses")):
        return word[:-2]
    if word.endswith("s") and not word.endswith(("ss", "us")):
        return word[:-1]
    return word


def name_tokens(*names: str | None) -> set[str]:
    out: set[str] = set()
    for name in names:
        if not name:
            continue
        for word in re.findall(r"[a-z0-9]+", _fold(name)):
            if word in STOPWORDS:
                continue
            word = SYNONYMS.get(word, word)
            word = _singular(word)
            word = SYNONYMS.get(word, word)
            if word in STOPWORDS:
                continue
            out.add(word)
    return out


def gold_name_tokens(gold: str) -> tuple[set[str], set[str]]:
    """All words of a gold name, and the weak ones: words that only appear inside its brackets."""
    head = name_tokens(re.sub(r"\([^)]*\)", " ", gold))
    every = name_tokens(gold)
    return every, every - head


def overlap_score(model_tokens: set[str], gold_tokens: set[str], weak: set[str] = frozenset()) -> float:
    return sum(0.3 if (t in GENERIC or t in weak) else 1.0 for t in model_tokens & gold_tokens)


def holds(model_tokens: set[str], gold: tuple[set[str], set[str]]) -> bool:
    """One specific shared word, or several weak ones, or every head word of a gold name made of generic words."""
    every, weak = gold
    score = overlap_score(model_tokens, every, weak)
    return score >= 1.0 or (score > 0 and (every - weak) <= model_tokens)


def model_name_key(name: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", _fold(name or "")))


# Names the word overlap cannot decide, checked by hand against the answer and (plates) the adjudicated
# worksheet. Key: (case id, model_name_key(name)); value: the gold items that model item holds ([] = none).
# The typed cases use the original name; the English translation is matched by the words.
OVERRIDES: dict[tuple[str, str], list[str]] = {
    # typed
    ("t028", "nuss nugat creme"): ["Nutella"],
    ("t028", "nuss nougat creme"): ["Nutella"],
    ("t052", "raw bean sprouts"): ["shrimp pad Thai"],
    ("t052", "bean sprouts"): ["shrimp pad Thai"],
    ("t052", "crushed peanuts"): ["shrimp pad Thai"],
    ("t052", "peanuts"): ["shrimp pad Thai"],
    ("t079", "jaune d oeuf cru"): ["steak tartare"],
    ("t004", "zwiebeln"): [],
}

# Plates. The rule, applied by hand from the answers and the photos: a model item holds a gold item when that
# food is physically part of what the item names (the cheese inside "beef tacos", the milk in the porridge, the
# prawns in a "seafood paella"), or when the item is a plate label ("full breakfast", "sushi platter", "... and
# sides") that covers the foods no other item of the answer holds. A misread item still holds the food it
# misreads (plate 11 "breaded fish fillet" is the schnitzel). A separate dish on the table is never held by
# another dish (plate 47: "avocado toast with poached egg" does not hold the eggs Benedict).
_P = {
    "01": {"whole grain bread": ["brown bread slice"], "whole wheat bread": ["brown bread slice"]},
    "02": {
        "roast beef with gravy": ["roast meat (lamb/beef) in gravy"],
        "roast beef dinner": ["roast meat (lamb/beef) in gravy", "Yorkshire pudding", "roast potatoes", "broccoli", "cabbage/greens"],
    },
    "03": {
        "greek salad with avocado and feta": ["feta cheese", "kalamata olives", "avocado", "cherry tomatoes", "cucumber", "lettuce/romaine", "red onion"],
        "salmon salad with feta and avocado": ["grilled salmon fillets", "feta cheese", "kalamata olives", "avocado", "cherry tomatoes", "cucumber", "lettuce/romaine", "red onion"],
    },
    "06": {
        "salmon avocado roll": ["sushi rolls (salmon+avocado uramaki, sesame)"],
        "salmon avocado sushi roll": ["sushi rolls (salmon+avocado uramaki, sesame)"],
        "assorted nigiri sushi": ["tuna nigiri", "white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream)"],
        "sushi platter": ["sushi rolls (salmon+avocado uramaki, sesame)", "tuna nigiri", "white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream)", "pickled ginger", "wasabi", "soy sauce"],
    },
    "07": {
        "spaghetti bolognese with vegetables": ["spaghetti", "ground beef/meat tomato sauce", "corn kernels", "green beans", "carrot pieces"],
        "spaghetti bolognese with mixed vegetables": ["spaghetti", "ground beef/meat tomato sauce", "corn kernels", "green beans", "carrot pieces"],
        "spaghetti with meat sauce and vegetables": ["spaghetti", "ground beef/meat tomato sauce", "corn kernels", "green beans", "carrot pieces"],
    },
    "08": {
        "granola with nuts": ["granola (oats/puffed grains, nuts)"],
        "granola": ["granola (oats/puffed grains, nuts)"],
        "yogurt with granola and apple": ["yogurt", "granola (oats/puffed grains, nuts)", "apple slices"],
    },
    "10": {
        "toasted chicken sandwich with side salad": ["club/toasted sandwich (multi-layer, creamy chicken/seafood filling)", "green side salad (rocket/mixed leaves)"],
        "side salad": ["green side salad (rocket/mixed leaves)"],
        "chicken sandwich with salad": ["club/toasted sandwich (multi-layer, creamy chicken/seafood filling)", "green side salad (rocket/mixed leaves)"],
    },
    "11": {
        "side salad with dressing": ["mixed side salad (lettuce, cherry tomato, red onion, dressing)"],
        "side salad with vinaigrette": ["mixed side salad (lettuce, cherry tomato, red onion, dressing)"],
        "breaded fish fillet with chips and salad": ["breaded fried schnitzel (pork/veal cutlet)", "thick-cut fries/potato wedges", "mixed side salad (lettuce, cherry tomato, red onion, dressing)"],
    },
    "12": {"bratwurst sausages": ["bratwurst sausages"]},
    "13": {
        "cheese spaetzle with fried onions": ["Käsespätzle (spätzle noodles in melted cheese)", "fried/caramelised onions"],
        "kasespatzle with fried onions": ["Käsespätzle (spätzle noodles in melted cheese)", "fried/caramelised onions"],
    },
    "17": {
        "currywurst with sauce": ["currywurst (sausage)", "curry ketchup sauce", "curry powder"],
        "currywurst with french fries": ["currywurst (sausage)", "curry ketchup sauce", "curry powder", "French fries"],
    },
    "18": {"meat filled pasta parcels with potato salad": ["Maultaschen (filled pasta pockets with meat filling)", "potato salad"]},
    "19": {
        "currywurst with curry sauce": ["sliced sausage in curry/shashlik sauce"],
        "currywurst": ["sliced sausage in curry/shashlik sauce"],
        "currywurst with sauce": ["sliced sausage in curry/shashlik sauce"],
    },
    "20": {
        "ramen noodle soup with chashu pork": ["ramen noodles", "clear (shio) broth", "sliced chashu pork"],
        "shio ramen with pork chashu": ["ramen noodles", "clear (shio) broth", "sliced chashu pork"],
    },
    "22": {
        "beef tacos": ["soft corn tortilla tacos with seasoned ground beef", "grated cheese", "red salsa", "green salsa/tomatillo", "coriander/cilantro"],
        "grilled corn on the cob": ["grilled corn on the cob"],
        "corn on the cob": ["grilled corn on the cob"],
        "cola soft drink": ["glass of cola"],
    },
    "23": {
        "smothered wet burrito": ["burrito (flour tortilla)", "green chile sauce", "shredded cheddar/jack cheese", "shredded lettuce"],
        "smothered wet burrito with cheese and salad topping": ["burrito (flour tortilla)", "green chile sauce", "shredded cheddar/jack cheese", "shredded lettuce"],
        "wet burrito": ["burrito (flour tortilla)", "green chile sauce", "shredded cheddar/jack cheese", "shredded lettuce"],
    },
    "25": {
        "full breakfast": ["pancakes with icing sugar", "back bacon rashers", "fried egg (sunny side up)", "breakfast sausages", "hash brown/potato croquettes", "toast slices", "maple syrup in a shot glass"],
    },
    "26": {
        "vegetable pulao": ["rice pilaf/vegetable fried rice"],
        "vegetable biryani": ["rice pilaf/vegetable fried rice"],
        "paratha and papadum": ["chapati/roti", "papad (papadum)"],
        "assorted curries and dal": ["dal (lentil curry)", "kofta/dumpling curry in orange gravy", "paneer or fish curry in pale gravy", "brinjal/eggplant curry"],
        "vegetable curry": ["brinjal/eggplant curry"],
    },
    "28": {
        "falafel mezze bowl": ["falafel balls", "hummus/creamy white dip", "yellow bulgur or couscous", "black beluga lentils", "pickled white cabbage slaw", "green olives"],
        "falafel and mezze salad bowl": ["falafel balls", "hummus/creamy white dip", "yellow bulgur or couscous", "black beluga lentils", "pickled white cabbage slaw", "green olives"],
        "chili herb dipping oil": ["green herb-chilli sauce"],
        "mezze platter with falafel grains salads and flatbread": ["falafel balls", "grilled flatbread", "hummus/creamy white dip", "green herb-chilli sauce", "yellow bulgur or couscous", "black beluga lentils", "pickled white cabbage slaw", "green olives"],
    },
    "29": {
        "wheat beer": ["glass of Weissbier"],
        "cubed semi hard cheese": ["cheese cubes"],
        "semi hard cheese cubes": ["cheese cubes"],
        "cubed cheese": ["cheese cubes"],
        "pickled cucumbers": ["pickled gherkin slices"],
        "pickled gherkins and cream cheese spread": ["pickled gherkin slices", "creamy dip/cream cheese with the pickles"],
        "pickles and condiments": ["pickled gherkin slices"],
    },
    "30": {"side salad": ["mixed leaf salad"], "mixed side salad": ["mixed leaf salad"]},
    "31": {
        "beef goulash": ["thick brown meat soup/stew broth", "beef (oxtail) chunks"],
        "beef goulash soup": ["thick brown meat soup/stew broth", "beef (oxtail) chunks"],
        "goulash soup with beef": ["thick brown meat soup/stew broth", "beef (oxtail) chunks"],
        "bread with butter": ["buttered bread slices (dark/whole-grain)"],
        "rye bread with butter": ["buttered bread slices (dark/whole-grain)"],
    },
    "32": {"sliced semi hard cheese assortment": ["cheese slices"]},
    "33": {
        "cooked oatmeal": ["oatmeal/oat porridge", "milk"],
        "oatmeal with toppings": ["oatmeal/oat porridge", "peanut butter", "raisins", "ground cinnamon", "milk"],
        "oatmeal with peanut butter honey raisins and cinnamon": ["oatmeal/oat porridge", "peanut butter", "raisins", "ground cinnamon", "milk", "honey/syrup drizzle"],
    },
    "35": {
        "doner kebab meat with tzatziki sauce": ["gyros/döner sliced meat", "white garlic-yogurt sauce (tzatziki) with oregano"],
        "doner kebab plate with fries and salad": ["gyros/döner sliced meat", "French fries", "white garlic-yogurt sauce (tzatziki) with oregano", "shredded white cabbage", "tomato slices", "sweetcorn", "cucumber slices", "shredded carrot"],
    },
    "36": {
        "seafood and artichoke paella": ["saffron/paella rice", "whole prawns (langostinos)", "mantis shrimp (galeras)", "artichoke pieces"],
        "seafood paella with artichokes": ["saffron/paella rice", "whole prawns (langostinos)", "mantis shrimp (galeras)", "artichoke pieces"],
    },
    "37": {
        "dumplings with meat filling": ["pierogi/boiled dumplings (potato-cheese filling)"],
        "coleslaw side salad": ["grated carrot and cabbage salad"],
    },
    "38": {
        "beef burger": ["beefburger in sesame bun (bitten; lettuce, tomato, onion visible)"],
        "hamburger": ["beefburger in sesame bun (bitten; lettuce, tomato, onion visible)"],
    },
    "40": {
        "mixed grill meats with gravy": ["liver pieces in gravy", "sausage"],
        "mixed grill meats in gravy": ["liver pieces in gravy", "sausage"],
        "mixed meat and gravy dish with fries": ["liver pieces in gravy", "chips/French fries", "sausage"],
        "cooked breakfast plate with ham and egg": ["fried egg (remnant, yolk visible)", "bacon/gammon slice", "grilled tomato half"],
    },
    "41": {"fish and chips": ["battered fried fish (cod), partly eaten", "potato wedges/skin-on roast potatoes"]},
    "42": {
        "breaded fish fillet with tartar sauce": ["breaded fried fish fillet", "sour cream / remoulade dollop"],
        "fried fish fillet with tartar sauce": ["breaded fried fish fillet", "sour cream / remoulade dollop"],
    },
    "43": {
        "breaded cutlets with creamy sauce": ["breaded croquettes/fish cakes topped with mayonnaise-aioli"],
        "savory bake and creamy side salad": ["cheese-topped quiche/gratin square"],
        "cream soup with bacon bits": ["creamy soup (bowl, with bacon bits)"],
        "vegetable and egg casserole sides": ["cheese-topped quiche/gratin square"],
        "fried cutlets with mayonnaise and sides": ["breaded croquettes/fish cakes topped with mayonnaise-aioli", "herbed green rice", "green beans", "cheese-topped quiche/gratin square", "creamy meat-and-vegetable stew"],
    },
    "44": {
        "braised beef stew": ["stewed meat in onion gravy"],
        "garden salad": ["green salad (lettuce, grated carrot, coriander)"],
        "braised meat stew with potato": ["stewed meat in onion gravy", "mashed cassava/potato purée"],
        "stewed meat with potatoes": ["stewed meat in onion gravy", "mashed cassava/potato purée"],
        "side salad": ["green salad (lettuce, grated carrot, coriander)"],
    },
    "45": {
        "assorted korean side dishes banchan": ["japchae (glass noodles with vegetables)", "sliced raw fish (hoe/sashimi) on shredded radish", "vegetable fritters/jeon platter"],
        "assorted korean banchan side dishes": ["sliced raw fish (hoe/sashimi) on shredded radish", "vegetable fritters/jeon platter"],
        "spicy glazed grilled meat": ["glazed spicy braised ribs/pork"],
        "spicy glazed fish or pork": ["glazed spicy braised ribs/pork"],
        "spicy grilled fish or meat": ["glazed spicy braised ribs/pork"],
        "raw fish sashimi platter": ["sliced raw fish (hoe/sashimi) on shredded radish"],
        "bulgogi": ["stir-fried beef in a hot stone pot"],
        "various banchan side dishes": [],
        "steamed rice cakes with accompaniments": [],
    },
    "46": {
        "steamed bean curd skin rolls": ["fried beancurd-skin rolls (tofu skin rolls)"],
        "bean curd skin rolls dim sum": ["fried beancurd-skin rolls (tofu skin rolls)"],
        "steamed honeycomb beef tripe": ["honeycomb beef tripe in curry sauce"],
        "steamed beef omasum tripe with ginger": ["white boiled tripe/omasum slices in broth"],
        "steamed white beef tripe": ["white boiled tripe/omasum slices in broth"],
        "braised beef tripe": ["honeycomb beef tripe in curry sauce", "white boiled tripe/omasum slices in broth"],
    },
    "47": {
        "avocado toast with poached eggs": ["avocado toast/bagel halves with poached eggs"],
        "avocado toast with poached egg": ["avocado toast/bagel halves with poached eggs"],
        "avocado toast with poached eggs and cherry tomatoes": ["avocado toast/bagel halves with poached eggs", "cherry tomato salad with balsamic drizzle"],
        "eggs benedict": ["eggs benedict with hollandaise on avocado toast"],
        "eggs benedict with hollandaise and tomatoes": ["eggs benedict with hollandaise on avocado toast", "cherry tomato salad with balsamic drizzle"],
        "seeded bagel": ["seeded bagel (dark, sesame-topped)"],
        "bagel sandwich with side salad": ["seeded bagel (dark, sesame-topped)"],
        "bagel": ["seeded bagel (dark, sesame-topped)"],
        "iced latte": ["iced coffee"],
        "passion fruit iced drink": ["orange/passionfruit drink"],
        "passion fruit iced beverage": ["orange/passionfruit drink"],
        "acai bowl with fruit": ["yogurt bowl with granola, kiwi slices and berry compote"],
    },
    "49": {
        "dinner roll": ["bread bun"],
        "soft dinner roll": ["bread bun"],
        "hong kong style borscht soup": ["red cabbage soup (borscht-style, bowl)"],
        "minestrone vegetable tomato soup": ["red cabbage soup (borscht-style, bowl)"],
        "tomato soup": ["red cabbage soup (borscht-style, bowl)"],
        "sizzling steak with pasta and sausage": ["grilled steak/pork chop in brown sauce", "spaghetti (plain, buttered)", "sausage/frankfurter"],
    },
    "16": {"side salad": ["side salad (lettuce, tomato, cucumber, red onion) with dressing"]},
    "50": {
        "side salad with peppers": ["iceberg lettuce salad", "pickled gherkin and pepperoncini"],
        "doner kebab with fries and salad": ["döner kebab sliced meat", "tomato/chili sauce over the meat", "French fries", "iceberg lettuce salad", "sliced red onion", "cucumber slices", "pickled gherkin and pepperoncini"],
    },
}
for _pid, _names in _P.items():
    for _name, _items in _names.items():
        OVERRIDES[(_pid, model_name_key(_name))] = _items

# Plates, the names of the v2 and v3 photo prompt answers (one item per separate food), by the same rule. Checked
# by hand against every answer of the cells B2, C2, D2, C3 and D3 that the word overlap scored as a miss or left
# unmatched, and against photos 40 and 45. Photo 45 holds one grilled mackerel, one glazed red-brown meat and one
# sashimi plate, so a second "fish" item beside a listed mackerel ("spicy braised fish") is the glazed ribs or pork,
# and only a raw or sashimi item holds the hoe. Four of these names also occur in answers of the cells B, C and D
# (plates 14, 26, 47). There they move a few flags from "items outside the gold" to "extra flags" and change no
# miss, demotion or false alarm of `EU-FLAG-SCORING-2026-10-06.md` (written again with them).
_P_V2V3 = {
    "01": {"dark whole grain bread": ["brown bread slice"], "rye bread": ["brown bread slice"]},
    "02": {
        "roast beef": ["roast meat (lamb/beef) in gravy"],
        "sliced roasted meat with gravy": ["roast meat (lamb/beef) in gravy"],
        "gravy": ["gravy as separate item"],
    },
    "03": {
        "greek salad with avocado": ["feta cheese", "kalamata olives", "avocado", "cherry tomatoes", "cucumber", "lettuce/romaine", "red onion"],
    },
    "06": {
        "salmon avocado maki roll": ["sushi rolls (salmon+avocado uramaki, sesame)"],
        "salmon and avocado maki": ["sushi rolls (salmon+avocado uramaki, sesame)"],
        "nigiri sushi": ["tuna nigiri", "white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream)"],
        "nigiri sushi assortment": ["tuna nigiri", "white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream)"],
        "tuna nigiri": ["tuna nigiri"],
        "tuna nigiri sushi": ["tuna nigiri"],
        "white fish nigiri": ["white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream)"],
        "white fish nigiri sushi": ["white-fish nigiri (1-2 pcs, e.g. yellowtail/sea bream)"],
    },
    "10": {
        "chicken and avocado sandwich with side salad": ["club/toasted sandwich (multi-layer, creamy chicken/seafood filling)", "green side salad (rocket/mixed leaves)"],
        "mixed salad": ["green side salad (rocket/mixed leaves)"],
        "diet cola": ["Pepsi Max bottle"],
        "sugar free cola": ["Pepsi Max bottle"],
    },
    "11": {
        "breaded fish fillet": ["breaded fried schnitzel (pork/veal cutlet)"],
        "mixed salad with dressing": ["mixed side salad (lettuce, cherry tomato, red onion, dressing)"],
        "mixed salad with vinaigrette": ["mixed side salad (lettuce, cherry tomato, red onion, dressing)"],
    },
    "13": {
        "mixed salad with dressing": ["side plate of iceberg lettuce salad with tomato and onion (separate plate behind)"],
        "side salad with creamy dressing": ["side plate of iceberg lettuce salad with tomato and onion (separate plate behind)"],
        "mixed side salad with creamy dressing": ["side plate of iceberg lettuce salad with tomato and onion (separate plate behind)"],
        "green salad with pasta and dressing": ["side plate of iceberg lettuce salad with tomato and onion (separate plate behind)"],
        "kasespatzle with caramelized onions": ["Käsespätzle (spätzle noodles in melted cheese)", "fried/caramelised onions"],
    },
    "14": {
        "green salad": ["green leaf lettuce (butterhead) in a separate glass bowl"],
        "green salad with dressing": ["green leaf lettuce (butterhead) in a separate glass bowl"],
        "green side salad with dressing": ["green leaf lettuce (butterhead) in a separate glass bowl"],
        "green side salad with light dressing": ["green leaf lettuce (butterhead) in a separate glass bowl"],
        "side green salad": ["green leaf lettuce (butterhead) in a separate glass bowl"],
    },
    "16": {"mixed salad with dressing": ["side salad (lettuce, tomato, cucumber, red onion) with dressing"]},
    "17": {"curry sausage with curry sauce": ["currywurst (sausage)", "curry ketchup sauce", "curry powder"]},
    "18": {
        "meat filled pasta rolls with potato salad": ["Maultaschen (filled pasta pockets with meat filling)", "potato salad", "bacon/speck bits in the potato salad"],
        "meat filled dumplings with potato salad": ["Maultaschen (filled pasta pockets with meat filling)", "potato salad", "bacon/speck bits in the potato salad"],
        "meat filled pasta": ["Maultaschen (filled pasta pockets with meat filling)"],
    },
    "20": {
        "ramen noodle soup": ["ramen noodles", "clear (shio) broth", "sliced chashu pork", "leafy green herb topping (mizuna/mitsuba)"],
        "ramen in broth": ["ramen noodles", "clear (shio) broth"],
        "mizuna greens": ["leafy green herb topping (mizuna/mitsuba)"],
    },
    "22": {
        "beef taco": ["soft corn tortilla tacos with seasoned ground beef", "grated cheese", "red salsa", "green salsa/tomatillo", "coriander/cilantro"],
        "ground beef taco": ["soft corn tortilla tacos with seasoned ground beef", "grated cheese", "red salsa", "green salsa/tomatillo", "coriander/cilantro"],
        "ground beef tacos": ["soft corn tortilla tacos with seasoned ground beef", "grated cheese", "red salsa", "green salsa/tomatillo", "coriander/cilantro"],
    },
    "23": {"smothered burrito": ["burrito (flour tortilla)", "green chile sauce", "shredded cheddar/jack cheese", "shredded lettuce"]},
    "24": {"tartare sauce": ["tartar sauce"]},
    "25": {"toasted white bread": ["toast slices"]},
    "26": {
        "clear vegetable soup": ["clear vegetable stew/soup bowl"],
        "mixed vegetable soup": ["clear vegetable stew/soup bowl"],
        "vegetable soup": ["clear vegetable stew/soup bowl"],
        "sweet corn vegetable soup": ["clear vegetable stew/soup bowl"],
        "kofte curry": ["kofta/dumpling curry in orange gravy"],
        "mixed vegetable curry": ["brinjal/eggplant curry"],
    },
    "28": {
        "pita bread": ["grilled flatbread"],
        "falafel bowl with grains and vegetables": ["falafel balls", "hummus/creamy white dip", "yellow bulgur or couscous", "black beluga lentils", "pickled white cabbage slaw", "green olives"],
        "mezze salad bowl with falafel grains and dips": ["falafel balls", "hummus/creamy white dip", "yellow bulgur or couscous", "black beluga lentils", "pickled white cabbage slaw", "green olives"],
        "spicy chili dip": ["green herb-chilli sauce"],
        "spicy chili dipping sauce": ["green herb-chilli sauce"],
        "chili herb oil": ["green herb-chilli sauce"],
    },
    "30": {"mixed salad": ["mixed leaf salad"], "mixed green salad": ["mixed leaf salad"]},
    "31": {"goulash soup": ["thick brown meat soup/stew broth", "beef (oxtail) chunks"]},
    "33": {
        "oatmeal porridge": ["oatmeal/oat porridge", "milk"],
        "oatmeal": ["oatmeal/oat porridge", "milk"],
        "porridge with peanut butter honey raisins and cinnamon": ["oatmeal/oat porridge", "peanut butter", "raisins", "ground cinnamon", "milk", "honey/syrup drizzle"],
    },
    "35": {
        "doner kebab with tzatziki sauce": ["gyros/döner sliced meat", "white garlic-yogurt sauce (tzatziki) with oregano"],
        "doner kebab with tzatziki": ["gyros/döner sliced meat", "white garlic-yogurt sauce (tzatziki) with oregano"],
        "doner kebab meat with white sauce": ["gyros/döner sliced meat", "white garlic-yogurt sauce (tzatziki) with oregano"],
        "doner kebab with fries and salad": ["gyros/döner sliced meat", "French fries", "white garlic-yogurt sauce (tzatziki) with oregano", "shredded white cabbage", "tomato slices", "sweetcorn", "cucumber slices", "shredded carrot"],
    },
    "36": {"seafood paella": ["saffron/paella rice", "whole prawns (langostinos)", "mantis shrimp (galeras)", "artichoke pieces"]},
    "37": {"coleslaw": ["grated carrot and cabbage salad"], "coleslaw salad": ["grated carrot and cabbage salad"]},
    "42": {
        "breaded fried fish with mayonnaise": ["breaded fried fish fillet", "sour cream / remoulade dollop"],
        "mixed vegetable salad": ["red cabbage and sweetcorn salad"],
        "mixed vegetable salad with corn": ["red cabbage and sweetcorn salad"],
        "mixed vegetable and corn salad": ["red cabbage and sweetcorn salad"],
        "mixed salad with corn and red cabbage": ["red cabbage and sweetcorn salad"],
    },
    "43": {
        "bread roll with spread": ["bread roll with butter"],
        "savory pie slice": ["cheese-topped quiche/gratin square"],
        "cream soup with crispy bacon": ["creamy soup (bowl, with bacon bits)"],
        "minced meat dish with mushrooms": ["creamy meat-and-vegetable stew"],
        "savory minced meat scramble": ["creamy meat-and-vegetable stew"],
        "savory egg and meat casserole": ["creamy meat-and-vegetable stew"],
        "breaded patties with creamy sauce": ["breaded croquettes/fish cakes topped with mayonnaise-aioli"],
        "baked potato casserole slice": ["cheese-topped quiche/gratin square"],
    },
    "44": {
        "braised pork with potato": ["stewed meat in onion gravy"],
        "stewed pork and potatoes": ["stewed meat in onion gravy"],
        "beef stew with potatoes": ["stewed meat in onion gravy"],
        "braised pork dish": ["stewed meat in onion gravy"],
        "stewed meat with gravy": ["stewed meat in onion gravy"],
        "stewed chicken with potato": ["stewed meat in onion gravy"],
        "stewed meat and potatoes": ["stewed meat in onion gravy"],
        "braised meat in gravy": ["stewed meat in onion gravy"],
        "mixed salad": ["green salad (lettuce, grated carrot, coriander)"],
        "mixed salad with lettuce and carrot": ["green salad (lettuce, grated carrot, coriander)"],
        "mixed salad with carrot": ["green salad (lettuce, grated carrot, coriander)"],
        "garden salad with shredded carrot": ["green salad (lettuce, grated carrot, coriander)"],
    },
    "45": {
        "sashimi platter": ["sliced raw fish (hoe/sashimi) on shredded radish"],
        "raw fish sashimi": ["sliced raw fish (hoe/sashimi) on shredded radish"],
        "raw fish platter": ["sliced raw fish (hoe/sashimi) on shredded radish"],
        "korean sashimi hoe": ["sliced raw fish (hoe/sashimi) on shredded radish"],
        "sashimi raw fish slices": ["sliced raw fish (hoe/sashimi) on shredded radish"],
        "seasoned grilled fish": ["glazed spicy braised ribs/pork"],
        "spicy braised fish": ["glazed spicy braised ribs/pork"],
        "spicy grilled fish": ["glazed spicy braised ribs/pork"],
        "korean pancake assortment": ["vegetable fritters/jeon platter"],
        "glass noodle stir fry": ["japchae (glass noodles with vegetables)"],
        "korean vegetable pancakes": ["vegetable fritters/jeon platter"],
        "korean namul side dishes": ["seasoned greens (namul)"],
    },
    "47": {
        "avocado and poached egg toast with cherry tomatoes": ["avocado toast/bagel halves with poached eggs", "cherry tomato salad with balsamic drizzle"],
        "eggs benedict with avocado and cherry tomatoes": ["eggs benedict with hollandaise on avocado toast", "cherry tomato salad with balsamic drizzle"],
        "avocado toast with poached egg and side tomatoes": ["avocado toast/bagel halves with poached eggs", "cherry tomato salad with balsamic drizzle"],
        "eggs benedict with hollandaise and side tomatoes": ["eggs benedict with hollandaise on avocado toast", "cherry tomato salad with balsamic drizzle"],
        "eggs benedict on english muffin": ["eggs benedict with hollandaise on avocado toast"],
        "eggs benedict with avocado on english muffin": ["eggs benedict with hollandaise on avocado toast"],
        "bagel with avocado and poached egg": ["avocado toast/bagel halves with poached eggs", "seeded bagel (dark, sesame-topped)"],
        "seeded bagel sandwich": ["seeded bagel (dark, sesame-topped)"],
        "sesame bagel with tomato salad": ["seeded bagel (dark, sesame-topped)", "cherry tomato salad with balsamic drizzle"],
        "seeded bagel with side tomatoes": ["seeded bagel (dark, sesame-topped)", "cherry tomato salad with balsamic drizzle"],
        "acai smoothie bowl with kiwi and granola": ["yogurt bowl with granola, kiwi slices and berry compote"],
        "smoothie bowl with kiwi and granola": ["yogurt bowl with granola, kiwi slices and berry compote"],
        "smoothie bowl with fruit and granola": ["yogurt bowl with granola, kiwi slices and berry compote"],
        "passion fruit juice": ["orange/passionfruit drink"],
        "fruit juice mocktail with passion fruit": ["orange/passionfruit drink"],
        "passion fruit cocktail or mocktail": ["orange/passionfruit drink"],
        "passion fruit iced tea or mocktail": ["orange/passionfruit drink"],
    },
    "49": {
        "bread roll": ["bread bun"],
        "steak with pasta and sausage": ["grilled steak/pork chop in brown sauce", "spaghetti (plain, buttered)", "sausage/frankfurter"],
        "steak with spaghetti sausage and sauce": ["grilled steak/pork chop in brown sauce", "spaghetti (plain, buttered)", "sausage/frankfurter"],
        "steak with spaghetti sausage and black pepper sauce": ["grilled steak/pork chop in brown sauce", "spaghetti (plain, buttered)", "sausage/frankfurter"],
        "sizzling steak with spaghetti sausage and pepper sauce": ["grilled steak/pork chop in brown sauce", "spaghetti (plain, buttered)", "sausage/frankfurter"],
        "minestrone soup": ["red cabbage soup (borscht-style, bowl)"],
        "vegetable soup": ["red cabbage soup (borscht-style, bowl)"],
        "borscht soup": ["red cabbage soup (borscht-style, bowl)"],
        "pork sausage": ["sausage/frankfurter"],
    },
    "50": {"cola": ["Pepsi cup"]},
    # the second plate repeat of C3: a cheeseburger is the bitten burger (the cheese is optional gold)
    "38": {"cheeseburger with bun": ["beefburger in sesame bun (bitten; lettuce, tomato, onion visible)", "cheese slice in burger"]},
}
for _pid, _names in _P_V2V3.items():
    for _name, _items in _names.items():
        _key = (_pid, model_name_key(_name))
        if _key in OVERRIDES and OVERRIDES[_key] != _items:
            raise ValueError(f"plate override {_key} is set twice with different items")
        OVERRIDES[_key] = _items

# ---------------------------------------------------------------------------
# Gold
# ---------------------------------------------------------------------------


def load_text_gold(path: Path = GOLD_DIR / "gold_text.jsonl") -> dict[str, dict]:
    rows = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            rows[row["id"]] = row
    return rows


def load_plate_gold(
    flags_path: Path = GOLD_DIR / "gold_plate_flags.json", labels_path: Path = GOLD_DIR / "gold_labels.json"
) -> dict[str, dict]:
    flags = json.loads(flags_path.read_text(encoding="utf-8"))
    labels = json.loads(labels_path.read_text(encoding="utf-8"))
    out = {}
    for pid, entry in flags.items():
        if pid.startswith("_"):
            continue
        lab = labels[pid]
        out[pid] = {
            "id": pid,
            "input": no_long_dash(lab.get("meal", "")),
            "core": [norm_item(c) for c in lab.get("core", [])],
            "optional": [norm_item(c) for c in lab.get("optional", [])],
            "must_flag": entry.get("must_flag", []),
            "may_flag": entry.get("may_flag", []),
            "must_not_flag": entry.get("must_not_flag", []),
            "if_listed": entry.get("if_listed", []),
            "clear": False,
        }
    return out


def no_long_dash(text: str) -> str:
    """The outputs carry no long dash: gold_labels.json writes ' <long dash> ', the new files write ', '."""
    text = norm_item(text or "").replace(" " + chr(0x2013) + " ", ", ")
    return text.replace(chr(0x2014), ",").replace(chr(0x2013), ",")


def entry_values(entry: dict) -> list[str]:
    value = entry["value"]
    return list(value) if isinstance(value, list) else [value]


def entry_label(entry: dict) -> str:
    return "|".join(entry_values(entry))


# ---------------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------------


def food_names(food: dict) -> list[str]:
    names = [food.get("name") or ""]
    en = (food.get("translations") or {}).get("en")
    if en:
        names.append(en)
    return names


def _alias_tokens(name: str) -> tuple[str, ...]:
    """The words of a name in order, folded, with the same synonym and plural cuts as `name_tokens` but no word
    dropped, so an alias can be found as a run of words inside a longer model name."""
    out = []
    for word in re.findall(r"[a-z0-9]+", _fold(name or "")):
        word = SYNONYMS.get(word, word)
        word = _singular(word)
        out.append(SYNONYMS.get(word, word))
    return tuple(out)


def _contains_run(words: tuple[str, ...], run: tuple[str, ...]) -> bool:
    n = len(run)
    return n > 0 and any(words[i : i + n] == run for i in range(len(words) - n + 1))


def parse_aliases(raw: dict | None, gold_items: list[str]) -> dict[str, dict[str, list]]:
    """The `aliases` field of a gold case, ready to match: per gold item, `same` (a run of words that names the
    same food) and `component` (the full name of a part of a combination, as a set of words).

    A list entry is a string (same food) or `{"name": ..., "component": true}` (a part of the combined item).
    A key that is not a gold item of the case is ignored here; `gold/check_new_gold.py` refuses it."""
    out: dict[str, dict[str, list]] = {}
    for item, entries in (raw or {}).items():
        if item not in gold_items:
            continue
        same, component = [], []
        for entry in entries:
            if isinstance(entry, dict):
                if entry.get("component"):
                    tokens = name_tokens(entry["name"])
                    if tokens:
                        component.append(tokens)
                    continue
                entry = entry["name"]
            run = _alias_tokens(entry)
            if run:
                same.append(run)
        out[item] = {"same": same, "component": component}
    return out


def map_items_ex(case_id: str, gold_items: list[str], foods: list[dict], aliases: dict | None = None) -> dict:
    """Gold item -> the model items that hold it, in the order: override, alias, word overlap.

    An override decides alone. Otherwise a model item holds a gold item when its name (or its English
    translation) carries one of the gold item's aliases as a run of whole words, or when the word overlap says so;
    the two add up, so an alias never removes a holder. A model item that is the full name of a component alias
    (a part of a combined gold item, for example the bread of "cheese on bread") is a component holder of that
    item, unless it already holds the item.

    Returns `holders` (gold item -> indices), `via_alias` (gold item -> the indices that hold it only through an
    alias), `components` (gold item -> component indices) and `unmatched` (held by no gold item, as holder or
    component)."""
    gold_tokens = {g: gold_name_tokens(g) for g in gold_items}
    parsed = parse_aliases(aliases, gold_items)
    holders: dict[str, list[int]] = {g: [] for g in gold_items}
    via_alias: dict[str, list[int]] = {g: [] for g in gold_items}
    components: dict[str, list[int]] = {g: [] for g in gold_items}
    unmatched: list[int] = []
    for idx, food in enumerate(foods):
        names = food_names(food)
        forced = None
        for name in names:
            key = (case_id, model_name_key(name))
            if key in OVERRIDES:
                forced = OVERRIDES[key]
                break
        comp_held: list[str] = []
        if forced is not None:
            held = [g for g in forced if g in holders]
        else:
            mt = name_tokens(*names)
            by_overlap = {g for g in gold_items if holds(mt, gold_tokens[g])}
            runs = [_alias_tokens(n) for n in names]
            by_alias = {g for g, a in parsed.items() if any(_contains_run(r, run) for run in a["same"] for r in runs)}
            held = [g for g in gold_items if g in by_overlap or g in by_alias]
            for g in held:
                if g not in by_overlap:
                    via_alias[g].append(idx)
            name_sets = [name_tokens(n) for n in names]
            comp_held = [g for g, a in parsed.items() if g not in held and any(ns in a["component"] for ns in name_sets)]
        for g in held:
            holders[g].append(idx)
        for g in comp_held:
            components[g].append(idx)
        if not held and not comp_held:
            unmatched.append(idx)
    return {"holders": holders, "via_alias": via_alias, "components": components, "unmatched": unmatched}


def map_items(case_id: str, gold_items: list[str], foods: list[dict], aliases: dict | None = None) -> tuple[dict[str, list[int]], list[int]]:
    """Gold item -> indices of the model items that hold it; plus the indices that hold no gold item."""
    m = map_items_ex(case_id, gold_items, foods, aliases)
    return m["holders"], m["unmatched"]


# ---------------------------------------------------------------------------
# Answers
# ---------------------------------------------------------------------------


def answer_of(case_result: dict) -> dict:
    """The single approach answer stored for a case (`plate_text`, `production` or `baseline`)."""
    if len(case_result) != 1:
        raise ValueError(f"expected one approach per case, got {sorted(case_result)}")
    only = next(iter(case_result.values()))
    # A bare `{"error": "..."}` has no approach level: its one value is the message, and the record is the dict.
    return only if isinstance(only, dict) else case_result


def food_flags(food: dict) -> dict[str, set[str]]:
    flags = food.get("flags") or {}
    return {
        "pregnancy": set(flags.get("pregnancy") or []),
        "allergens": set(flags.get("allergens") or []),
        "mayContain": set(flags.get("mayContain") or []),
    }


def call_failed(answer: dict) -> bool:
    """No answer to score: no `foods`, an invalid answer with none, or a recorded `error` with none.

    A schema-valid answer whose `foods` is an empty list is an answer (the model listed nothing), not a failure.
    It is scored, and every clear entry of it is an unlisted miss."""
    if answer.get("foods") is None:
        return True
    if answer.get("foods"):
        return False
    return answer.get("schema_valid") is False or bool(answer.get("error"))


def truncated_flags(raw: str | None) -> list[str]:
    """The `flags` blocks a truncated answer had already written, as text, so a person can read them."""
    if not raw:
        return []
    return [re.sub(r"\s+", " ", m) for m in re.findall(r'"flags"\s*:\s*\{[^}]*\}?', raw)]


# ---------------------------------------------------------------------------
# Scoring one case
# ---------------------------------------------------------------------------


def _present(kind: str, value: str, fl: dict[str, set[str]]) -> str | None:
    """Where the value sits on one model item: 'pregnancy', 'allergens', 'mayContain' or None."""
    if kind == "pregnancy":
        return "pregnancy" if value in fl["pregnancy"] else None
    if value in fl["allergens"]:
        return "allergens"
    if value in fl["mayContain"]:
        return "mayContain"
    return None


def _outcome(kind: str, values: list[str], foods: list[dict], idxs: list[int]) -> str:
    """'hit', 'demoted' (an allergen only in mayContain) or 'miss' for one entry, read on the given model items."""
    places = set()
    for i in idxs:
        fl = food_flags(foods[i])
        for v in values:
            where = _present(kind, v, fl)
            if where:
                places.add(where)
    if kind == "pregnancy":
        return "hit" if places else "miss"
    if "allergens" in places:
        return "hit"
    if "mayContain" in places:
        return "demoted"
    return "miss"


def _describe(food: dict) -> dict:
    fl = food_flags(food)
    return {
        "name": food.get("name"),
        "en": (food.get("translations") or {}).get("en"),
        "pregnancy": sorted(fl["pregnancy"]),
        "allergens": sorted(fl["allergens"]),
        "mayContain": sorted(fl["mayContain"]),
    }


def _credit_merge(rec: dict, entry: dict, idxs: list[int], foods: list[dict], held_count: Counter, claimed: set) -> None:
    """Mark a hit that only merged items carry, and apply the strict rule: one flag value on one item credits once.

    A hit is `merged_credit` when every model item that carries the flag holds more than one gold food. In the
    strict view the first gold entry such an item credits for that flag value keeps the hit; any further entry
    credited by the same item and value is a `strict_miss` (the model wrote the flag once, for a food it did not
    name on its own). A hit that some single-food item carries is never touched."""
    kind = entry["kind"]
    list_name = "pregnancy" if kind == "pregnancy" else "allergens"
    carrying = [i for i in idxs if any(v in food_flags(foods[i])[list_name] for v in entry_values(entry))]
    if not carrying or not all(held_count[i] > 1 for i in carrying):
        return
    rec["merged_credit"] = True
    claims = {(i, kind, v) for i in carrying for v in entry_values(entry) if v in food_flags(foods[i])[list_name]}
    if claims & claimed:
        rec["strict_miss"] = True
    claimed.update(claims)


def score_case(case: dict, foods: list[dict], *, plate: bool, listed: dict[str, bool] | None = None) -> dict:
    """Every judged entry of one answer, with its outcome, plus extras and unmatched-item flags.

    `listed` (plates, sensitivity view only): the recall worksheet's verdict per core item. A core item the
    worksheet marks `n` is treated as not listed, whatever item would hold it.
    """
    cid = case["id"]
    core = list(case["core"])
    optional = list(case.get("optional", []))
    gold_items = core + optional
    mapped = map_items_ex(cid, gold_items, foods, case.get("aliases"))
    holders, unmatched = mapped["holders"], mapped["unmatched"]
    via_alias, components = mapped["via_alias"], mapped["components"]
    if listed is not None:
        for g in core:
            if listed.get(g) is False:
                holders[g] = []
                via_alias[g] = []
                components[g] = []
        held_any = {i for ix in holders.values() for i in ix} | {i for ix in components.values() for i in ix}
        unmatched = [i for i in range(len(foods)) if i not in held_any]
    # Every model item that stands for a gold item: its holders, then the parts of a combination. Without
    # `aliases` the two are the same lists.
    everyone = {g: holders[g] + [i for i in components[g] if i not in holders[g]] for g in gold_items}
    case_clear = case.get("clear", False)

    def eff_clear(entry):
        return entry.get("clear", case_clear)

    # what the gold allows on each gold item (must, may, must_not, if_listed), per kind
    allowed: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for lst in ("must_flag", "may_flag", "if_listed"):
        for e in case.get(lst, []):
            for v in entry_values(e):
                allowed[e["item"]].add((e["kind"], v))
    judged: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for lst in ("must_flag", "may_flag", "must_not_flag", "if_listed"):
        for e in case.get(lst, []):
            for v in entry_values(e):
                judged[e["item"]].add((e["kind"], v))

    def all_flags_in_answer(kind, values):
        hits = []
        for idx, food in enumerate(foods):
            fl = food_flags(food)
            for v in values:
                where = _present(kind, v, fl)
                if where:
                    hits.append(f"{food.get('name')} ({where}: {v})")
        return hits

    # How many gold foods each model item holds. An item that holds more than one is a merge, and its flags are
    # credited to each of them (the lenient reading the report keeps visible).
    held_count = Counter(i for ix in holders.values() for i in ix)
    claimed: set[tuple[int, str, str]] = set()  # (model item, kind, value) already credited through a merge

    entries = []
    for lst in ("must_flag", "if_listed"):
        for e in case.get(lst, []):
            item = e["item"]
            idxs = holders.get(item, [])
            seen = everyone.get(item, [])
            if lst == "if_listed" and not seen:
                continue  # required only when the model lists that optional item
            values = entry_values(e)
            rec = {
                "list": lst,
                "item": item,
                "kind": e["kind"],
                "value": entry_label(e),
                "clear": bool(eff_clear(e)),
                "holders": [_describe(foods[i]) for i in seen],
                "merged_credit": False,
                "strict_miss": False,
            }
            if not seen:
                rec["outcome"] = "unlisted_miss" if rec["clear"] else "unlisted_unscored"
                rec["elsewhere"] = all_flags_in_answer(e["kind"], values)
            else:
                rec["outcome"] = _outcome(e["kind"], values, foods, seen)
                if rec["outcome"] == "hit":
                    _credit_merge(rec, e, idxs, foods, held_count, claimed)
                    # A hit the plain word overlap would not have made: say which rule made it.
                    plain = [i for i in idxs if i not in via_alias[item]]
                    if _outcome(e["kind"], values, foods, plain) != "hit":
                        rec["credit"] = "alias" if _outcome(e["kind"], values, foods, idxs) == "hit" else "component"
            rec["strict_outcome"] = "miss" if rec.get("strict_miss") else rec["outcome"]
            entries.append(rec)

    false_alarms = []
    for e in case.get("must_not_flag", []):
        item = e["item"]
        for i in everyone.get(item, []):
            others = [g for g, ix in everyone.items() if i in ix and g != item]
            fl = food_flags(foods[i])
            for v in entry_values(e):
                where = _present(e["kind"], v, fl)
                if not where:
                    continue
                if any((e["kind"], v) in allowed[g] for g in others):
                    continue  # the same model item also holds a food that may carry it (a merge)
                false_alarms.append(
                    {
                        "item": item,
                        "kind": e["kind"],
                        "value": v,
                        "where": where,
                        "clear": bool(eff_clear(e)),
                        "holder": _describe(foods[i]),
                    }
                )

    extras = []
    for i, food in enumerate(foods):
        held = [g for g, ix in everyone.items() if i in ix]
        if not held:
            continue
        fl = food_flags(food)
        ok = set().union(*(judged[g] for g in held))
        for kind, lists in (("pregnancy", ("pregnancy",)), ("allergen", ("allergens", "mayContain"))):
            for lst_name in lists:
                for v in sorted(fl[lst_name]):
                    if (kind, v) not in ok:
                        extras.append({"food": food.get("name"), "held": held, "kind": kind, "value": v, "where": lst_name})

    outside = []
    for i in unmatched:
        fl = food_flags(foods[i])
        n = len(fl["pregnancy"]) + len(fl["allergens"]) + len(fl["mayContain"])
        outside.append({**_describe(foods[i]), "n_flags": n})

    return {
        "case": cid,
        "plate": plate,
        "input": case.get("input", ""),
        "mapping": {g: [foods[i].get("name") for i in ix] for g, ix in everyone.items()},
        "entries": entries,
        "false_alarms": false_alarms,
        "extras": extras,
        "outside_gold": outside,
    }


def failed_case(case: dict, answer: dict, *, plate: bool) -> dict:
    case_clear = case.get("clear", False)
    clear_entries = [
        {"item": e["item"], "kind": e["kind"], "value": entry_label(e), "clear": bool(e.get("clear", case_clear))}
        for e in case.get("must_flag", [])
    ]
    return {
        "case": case["id"],
        "plate": plate,
        "input": case.get("input", ""),
        "finish_reason": answer.get("finish_reason"),
        "error": answer.get("error"),
        "schema_errors": answer.get("schema_errors"),
        "must_flag": clear_entries,
        "truncated_flags": truncated_flags(answer.get("raw_content")),
    }


# ---------------------------------------------------------------------------
# Runs and cells
# ---------------------------------------------------------------------------


def load_results(run_dir: Path) -> dict | None:
    path = run_dir / "results.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def load_worksheet_listing(path: Path) -> dict[str, dict[str, bool]]:
    """Per plate, per gold core item: True when the filled recall worksheet marks it `Y` (merged or not)."""
    out: dict[str, dict[str, bool]] = {}
    current = None
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^### (\d\d),", line)
        if m:
            current = m.group(1)
            out[current] = {}
            continue
        if current is None or not line.startswith("| ") or line.startswith(("| gold", "|---", "| **")):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 2:
            out[current][norm_item(cells[0])] = cells[1].startswith("Y")
    return out


def score_run(results: dict, gold: dict[str, dict], *, plate: bool, listing: dict | None = None) -> dict:
    cases, failed = [], []
    for cid in sorted(gold):
        case = gold[cid]
        if case.get("expect_empty"):
            continue
        answer = answer_of(results[cid])
        if call_failed(answer):
            failed.append(failed_case(case, answer, plate=plate))
            continue
        cases.append(
            score_case(case, answer.get("foods") or [], plate=plate, listed=None if listing is None else listing.get(cid, {}))
        )
    return {"cases": cases, "failed": failed}


def run_is_complete(results: dict | None, gold: dict) -> bool:
    """Every gold case has a record and the runner is done: its `_partial` marker is gone (the runner writes the
    marker while it works and drops it in the final write, so a run that still carries it can grow)."""
    if not results:
        return False
    if results.get("_partial"):
        return False
    return all(cid in results for cid in gold)


def incomplete_reason(results: dict | None, gold: dict, unit: str = "answers") -> str:
    """Why a run is not scored, for the report. A partial run is named as such, even when it holds every case."""
    have = 0 if not results else sum(1 for cid in gold if cid in results)
    if results is not None and results.get("_partial"):
        return f"partial, the runner has not finished (`_partial` is set): {have} of {len(gold)} {unit}"
    return f"incomplete: {have} of {len(gold)} {unit}"


def tally(scored_runs: list[dict]) -> dict:
    """Counts over the given scored runs (repeats summed), plus distinct-entry counts."""
    t = Counter()
    per_value = defaultdict(Counter)  # (kind, value) -> counts
    distinct = defaultdict(set)  # bucket -> {(case, item, kind, value)}
    misses, demotions, false_alarms, unlisted = [], [], [], []
    n_cases = 0
    for run in scored_runs:
        for c in run["cases"]:
            n_cases += 1
            for e in c["entries"]:
                k = "preg" if e["kind"] == "pregnancy" else "alg"
                cl = "clear" if e["clear"] else "nonclear"
                src = "plate" if c["plate"] else "typed"
                key = (c["case"], e["item"], e["kind"], e["value"])
                if e["outcome"] in ("unlisted_unscored", "unlisted_miss"):
                    t[f"unlisted_entries_{src}"] += 1  # the gold item had no model item that held it
                if e["outcome"] == "unlisted_unscored":
                    t[f"{k}_{cl}_unlisted_unscored"] += 1
                    continue
                t[f"{k}_{cl}_tested"] += 1
                per_value[(e["kind"], e["value"])][f"{cl}_tested"] += 1
                if e["outcome"] in ("miss", "unlisted_miss"):
                    t[f"{k}_{cl}_miss"] += 1
                    t[f"{k}_{cl}_miss_{src}"] += 1
                    if e["list"] == "if_listed":
                        t[f"{k}_{cl}_miss_iflisted"] += 1
                    if e["outcome"] == "unlisted_miss":
                        t[f"{k}_{cl}_miss_unlisted"] += 1
                        if e.get("elsewhere"):
                            t[f"{k}_{cl}_miss_unlisted_elsewhere"] += 1
                    per_value[(e["kind"], e["value"])][f"{cl}_miss"] += 1
                    distinct[f"{k}_{cl}_miss"].add(key)
                    misses.append({**e, "case": c["case"], "input": c["input"], "plate": c["plate"]})
                elif e["outcome"] == "hit":
                    if e.get("credit"):
                        t[f"credit_{e['credit']}"] += 1
                        t[f"{k}_{cl}_credit_{e['credit']}"] += 1
                    if e.get("merged_credit"):
                        t[f"{k}_{cl}_hit_merged"] += 1
                        t[f"{k}_{cl}_hit_merged_{src}"] += 1
                        if e.get("strict_miss"):
                            t[f"{k}_{cl}_strict_extra_miss"] += 1
                            t[f"{k}_{cl}_strict_extra_miss_{src}"] += 1
                            distinct[f"{k}_{cl}_strict_extra_miss"].add(key)
                elif e["outcome"] == "demoted":
                    t[f"alg_{cl}_demoted"] += 1
                    per_value[(e["kind"], e["value"])][f"{cl}_demoted"] += 1
                    distinct[f"alg_{cl}_demoted"].add(key)
                    demotions.append({**e, "case": c["case"], "input": c["input"], "plate": c["plate"]})
            for fa in c["false_alarms"]:
                k = "preg" if fa["kind"] == "pregnancy" else "alg"
                t[f"{k}_false_alarm"] += 1
                distinct[f"{k}_false_alarm"].add((c["case"], fa["item"], fa["kind"], fa["value"]))
                false_alarms.append({**fa, "case": c["case"], "input": c["input"], "plate": c["plate"]})
            for ex in c["extras"]:
                t[f"extra_{'preg' if ex['kind'] == 'pregnancy' else 'alg'}"] += 1
            for o in c["outside_gold"]:
                t["outside_items"] += 1
                t["outside_flags"] += o["n_flags"]
                if o["n_flags"]:
                    t["outside_items_flagged"] += 1
        for f in run["failed"]:
            t["failed_calls"] += 1
            for e in f["must_flag"]:
                k = "preg" if e["kind"] == "pregnancy" else "alg"
                t[f"{k}_{'clear' if e['clear'] else 'nonclear'}_failed_call"] += 1
    return {
        "counts": dict(t),
        "cases": n_cases,
        "per_value": {f"{k}:{v}": dict(c) for (k, v), c in sorted(per_value.items())},
        "distinct": {k: len(v) for k, v in distinct.items()},
        "misses": misses,
        "demotions": demotions,
        "false_alarms": false_alarms,
    }


def _n_answers(res: dict | None) -> int:
    return 0 if not res else len([k for k in res if not k.startswith("_")])


def score_all(
    cells: dict = CELLS,
    runs_dir: Path = RUNS_DIR,
    plate_listing: str = "holder",
    *,
    skipped_cells: dict | None = None,
    text_gold: dict | None = None,
    plate_gold: dict | None = None,
    holdout_gold: dict | None = None,
) -> dict:
    """`plate_listing`: "holder" (the main view) or "worksheet" (a plate core item the recall worksheet marks
    `n` counts as not listed; a sensitivity check, since the worksheet judges names, not what a dish holds).
    A plate run with no filled worksheet is scored with the holder view and named in `worksheet_missing`.

    `skipped_cells` defaults to the fixed A and E cells; a config passes its own (or none).

    A cell that lists `holdout` runs gets a `holdout` entry: the runs scored against `holdout_gold` (default
    `gold/gold_text_holdout.jsonl`) and the runs left out with the reason. Those runs never enter `repeats`, so
    every number built from the typed repeats and the plates is the same with or without them."""
    text_gold = load_text_gold() if text_gold is None else text_gold
    plate_gold = load_plate_gold() if plate_gold is None else plate_gold
    if holdout_gold is None and any(spec.get("holdout") for spec in cells.values()):
        holdout_gold = load_text_gold(gold_path(DEFAULT_TYPED_GOLD_HOLDOUT))
    out = {"cells": {}, "skipped": {}, "worksheet_missing": []}
    for cell, spec in cells.items():
        repeats = []
        for name in spec.get("text") or []:
            res = load_results(run_path(runs_dir, name))
            if not run_is_complete(res, text_gold):
                out["skipped"][run_display(name)] = incomplete_reason(res, text_gold)
                continue
            repeats.append({"run": run_display(name), **score_run(res, text_gold, plate=False)})
        plate_runs = []
        for name in plate_names(spec):
            res = load_results(run_path(runs_dir, name))
            if not run_is_complete(res, plate_gold):
                reason = f"incomplete or missing: {_n_answers(res)} of {len(plate_gold)} plates"
                if res is not None and res.get("_partial"):
                    reason = incomplete_reason(res, plate_gold, "plates")
                out["skipped"][run_display(name)] = reason
                continue
            listing = None
            if plate_listing == "worksheet":
                sheet = run_path(runs_dir, name) / "scorecard-filled.md"
                if sheet.is_file():
                    listing = load_worksheet_listing(sheet)
                else:
                    out["worksheet_missing"].append(run_display(name))
            plate_runs.append({"run": run_display(name), **score_run(res, plate_gold, plate=True, listing=listing)})
        out["cells"][cell] = {"label": spec["label"], "repeats": repeats, "plate_runs": plate_runs}
        if spec.get("holdout"):
            out["cells"][cell]["holdout"] = score_holdout_runs(spec["holdout"], holdout_gold, runs_dir)
    for cell, (name, why) in (SKIPPED_CELLS if skipped_cells is None else skipped_cells).items():
        out["skipped"][name] = f"cell {cell}: {why}, no flags to score"
    return out


def score_holdout_runs(names: list[str], holdout_gold: dict, runs_dir: Path) -> dict:
    """Score the finished holdout runs of one cell. A run that is missing, unreadable, partial or short, or whose
    records cannot be read as answers, is left out and named with the reason; it never stops the others."""
    scored, left_out = [], []
    for name in names:
        res = load_results(run_path(runs_dir, name))
        if res is None:
            left_out.append({"run": run_display(name), "reason": "missing: no readable results.json"})
            continue
        if not run_is_complete(res, holdout_gold):
            left_out.append({"run": run_display(name), "reason": incomplete_reason(res, holdout_gold)})
            continue
        try:
            scored.append({"run": run_display(name), **score_run(res, holdout_gold, plate=False)})
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            left_out.append({"run": run_display(name), "reason": f"unreadable records: {type(exc).__name__}: {exc}"})
    out = {"listed": len(names), "runs": scored, "left_out": left_out, "cases": len(holdout_gold)}
    if any(case.get("aliases") for case in holdout_gold.values()):
        out["aliases"] = True
    return out


def cell_runs(data: dict) -> list[dict]:
    """Every scored run of a cell: the typed repeats, then the plate runs."""
    return list(data["repeats"]) + list(data["plate_runs"])


# ---------------------------------------------------------------------------
# Summaries, rules, sanity list
# ---------------------------------------------------------------------------


def summarise(scored: dict) -> dict:
    summary = {}
    for cell, data in scored["cells"].items():
        reps = data["repeats"]
        typed = tally(reps)
        per_rep = [{"run": r["run"], **tally([r])["counts"]} for r in reps]
        prs = data["plate_runs"]
        plates = tally(prs) if prs else None
        summary[cell] = {
            "label": data["label"],
            "n_repeats": len(reps),
            "typed": typed,
            "typed_per_repeat": per_rep,
            "n_plate_runs": len(prs),
            "plates": plates,
            "plates_per_run": [{"run": r["run"], **tally([r])["counts"]} for r in prs],
        }
    return summary


def _c(t: dict | None, key: str) -> int:
    return 0 if not t else t["counts"].get(key, 0)


def rule_numbers(summary: dict) -> dict:
    """Totals for rules 2 to 4. Typed totals are summed over repeats and also scaled to 3 repeats.

    `*_listed` leaves out the misses on items the answer did not list at all (the not-listed rule), so a
    reader can see how much of a total rests on that rule.

    Plates: a cell with several complete plate runs counts the mean per plate run, so a cell with three plate
    repeats weighs the same as a cell with one (`*_plates` is the sum, `*_plates_per_run` the mean). With one
    plate run per cell this is the plain count.
    """
    nums = {}
    for cell, s in summary.items():
        n = s["n_repeats"] or 1
        npr = s.get("n_plate_runs", 1 if s["plates"] else 0) or 1
        row = {"repeats": s["n_repeats"], "plate_runs": s.get("n_plate_runs", 1 if s["plates"] else 0)}
        for kind in ("preg", "alg"):
            for cl in ("clear", "nonclear"):
                typed = _c(s["typed"], f"{kind}_{cl}_miss")
                plates = _c(s["plates"], f"{kind}_{cl}_miss")
                typed_ul = _c(s["typed"], f"{kind}_{cl}_miss_unlisted")
                plates_ul = _c(s["plates"], f"{kind}_{cl}_miss_unlisted")
                row[f"{kind}_{cl}_typed"] = typed
                row[f"{kind}_{cl}_typed_per3"] = round(typed * 3 / n, 2)
                row[f"{kind}_{cl}_plates"] = plates
                row[f"{kind}_{cl}_plates_per_run"] = round(plates / npr, 2)
                row[f"{kind}_{cl}_total"] = typed + plates
                row[f"{kind}_{cl}_total_per3"] = round(typed * 3 / n + plates / npr, 2)
                row[f"{kind}_{cl}_total_listed_per3"] = round((typed - typed_ul) * 3 / n + (plates - plates_ul) / npr, 2)
                row[f"{kind}_{cl}_typed_distinct"] = s["typed"]["distinct"].get(f"{kind}_{cl}_miss", 0)
                row[f"{kind}_{cl}_plates_distinct"] = 0 if not s["plates"] else s["plates"]["distinct"].get(f"{kind}_{cl}_miss", 0)
                # Failed calls, scaled like the misses. Their must_flag entries are not misses (rule 1 owns the
                # call), but the verdict lines that count them as misses need the same scaling.
                f_typed = _c(s["typed"], f"{kind}_{cl}_failed_call")
                f_plates = _c(s["plates"], f"{kind}_{cl}_failed_call")
                row[f"{kind}_{cl}_failed_typed"] = f_typed
                row[f"{kind}_{cl}_failed_plates"] = f_plates
                row[f"{kind}_{cl}_failed_total_per3"] = round(f_typed * 3 / n + f_plates / npr, 2)
                # Merge leniency: hits only merged items carry, and the extra misses the strict view adds.
                m_typed = _c(s["typed"], f"{kind}_{cl}_hit_merged")
                m_plates = _c(s["plates"], f"{kind}_{cl}_hit_merged")
                x_typed = _c(s["typed"], f"{kind}_{cl}_strict_extra_miss")
                x_plates = _c(s["plates"], f"{kind}_{cl}_strict_extra_miss")
                row[f"{kind}_{cl}_hit_merged_typed"] = m_typed
                row[f"{kind}_{cl}_hit_merged_plates"] = m_plates
                row[f"{kind}_{cl}_strict_extra_typed"] = x_typed
                row[f"{kind}_{cl}_strict_extra_plates"] = x_plates
                row[f"{kind}_{cl}_total_strict_per3"] = round((typed + x_typed) * 3 / n + (plates + x_plates) / npr, 2)
            row[f"{kind}_clear_failed_call"] = _c(s["typed"], f"{kind}_clear_failed_call") + _c(s["plates"], f"{kind}_clear_failed_call")
        row["outside_items_typed"] = _c(s["typed"], "outside_items")
        row["outside_items_plates"] = _c(s["plates"], "outside_items")
        row["outside_items_flagged_typed"] = _c(s["typed"], "outside_items_flagged")
        row["outside_items_flagged_plates"] = _c(s["plates"], "outside_items_flagged")
        row["unlisted_entries_typed"] = _c(s["typed"], "unlisted_entries_typed")
        row["unlisted_entries_plates"] = _c(s["plates"], "unlisted_entries_plate")
        row["typed_answers"] = s["typed"]["cases"]
        row["plate_answers"] = s["plates"]["cases"] if s["plates"] else 0
        row["preg_clear_typed_strict_extra_per_repeat"] = [r.get("preg_clear_strict_extra_miss", 0) for r in s["typed_per_repeat"]]
        row["preg_clear_typed_per_repeat"] = [r.get("preg_clear_miss", 0) for r in s["typed_per_repeat"]]
        row["preg_clear_typed_failed_per_repeat"] = [r.get("preg_clear_failed_call", 0) for r in s["typed_per_repeat"]]
        for kind in ("preg", "alg"):
            row[f"{kind}_clear_plates_each_run"] = [r.get(f"{kind}_clear_miss", 0) for r in s.get("plates_per_run", [])]
        nums[cell] = row
    return nums


def _pf(ok: bool) -> str:
    return "PASS" if ok else "FAIL"


def _fmt(x) -> str:
    return f"{x:g}"


def rule_2_row(
    test: str,
    what: str,
    per_rep: list[int],
    failed_rep: list[int],
    strict_extra: list[int] | None,
    distinct: int,
    repeats: int,
    expected_repeats: int,
    unit: str = "typed",
) -> dict:
    """The rule 2 row, for the typed set (`evaluate_rules`) and for the holdout (`evaluate_holdout_rule_2`).

    FAIL on any miss. Otherwise INCOMPLETE until `expected_repeats` repeats are scored, then INCONCLUSIVE when a
    failed call holds a clear entry, else PASS."""
    strict_extra = strict_extra or [0] * len(per_rep)
    no_miss = all(x == 0 for x in per_rep)
    no_failed = all(x == 0 for x in failed_rep)
    complete = repeats == expected_repeats
    if not no_miss:
        verdict = "FAIL"
    elif not complete:
        verdict = "INCOMPLETE"
    elif not no_failed:
        verdict = "INCONCLUSIVE"
    else:
        verdict = "PASS"
    notes = []
    if not complete:
        notes.append(f"{test} holds {repeats} {unit} repeat(s), the rule needs {expected_repeats}")
    return {
        "rule": 2,
        "what": what,
        "verdict": verdict,
        "numbers": f"misses per repeat {per_rep}; distinct entries missed {distinct}"
        + (f"; {'; '.join(notes)}" if notes else ""),
        "repeats": repeats,
        "expected_repeats": expected_repeats,
        "strict_with_failed_calls": _pf(no_miss and no_failed),
        "failed_call_entries_per_repeat": failed_rep,
        "strict_merge_view": f"misses per repeat {[a + b for a, b in zip(per_rep, strict_extra)]} ({_pf(all(a + b == 0 for a, b in zip(per_rep, strict_extra)))})",
    }


def evaluate_rules(
    nums: dict,
    test: str = "D",
    refs: tuple[str, ...] = ("B", "C"),
    nums_ws: dict | None = None,
    expected_repeats: int = DEFAULT_EXPECTED_REPEATS,
    rule2: bool = True,
) -> list[dict]:
    """Rules 2 to 4. Repeats are scaled to 3 when a cell has fewer.

    Rule 2: zero clear misses in every repeat. A miss is FAIL whatever else is true. With no miss, the test cell
    must hold `expected_repeats` typed repeats, else INCOMPLETE; and a failed call that holds a clear entry makes it
    INCONCLUSIVE, because zero misses was not shown for that case.

    Rules 3 and 4: PASS only when the clear-only totals AND the all-entries totals (clear plus not clear) of the
    test cell are no higher than the ref's. Both comparisons are printed. A second pair of lines counts the clear
    must_flag entries of failed calls as misses on both sides. When that second reading gives a different verdict,
    the rule is INCONCLUSIVE: the answer depends on how failed calls count.

    `rule2=False` leaves the typed rule 2 out (a test cell judged on the holdout only; see `load_config`).

    Keys a hand-built `nums` row lacks (failed calls, strict view) read as zero."""
    rules = []
    d = nums[test]
    if rule2:
        rules.append(
            rule_2_row(
                test,
                f"{test}: zero misses on the clear pregnancy must-flag typed cases, in every repeat",
                d["preg_clear_typed_per_repeat"],
                d["preg_clear_typed_failed_per_repeat"],
                d.get("preg_clear_typed_strict_extra_per_repeat"),
                d["preg_clear_typed_distinct"],
                d["repeats"],
                expected_repeats,
            )
        )
    for rule, kind, word in ((3, "preg", "pregnancy"), (4, "alg", "allergen")):
        for ref in refs:
            r = nums[ref]
            g = lambda row, key: row.get(f"{kind}_{key}", 0)  # noqa: E731 - a hand-built row may lack the new keys
            dv, rv = d[f"{kind}_clear_total_per3"], r[f"{kind}_clear_total_per3"]
            dl, rl = d[f"{kind}_clear_total_listed_per3"], r[f"{kind}_clear_total_listed_per3"]
            dall = round(dv + d[f"{kind}_nonclear_total_per3"], 2)
            rall = round(rv + r[f"{kind}_nonclear_total_per3"], 2)
            clear_ok, all_ok = dv <= rv, dall <= rall
            base = "PASS" if clear_ok and all_ok else "FAIL"
            # failed calls counted as misses, on both sides
            dfc, rfc = g(d, "clear_failed_total_per3"), g(r, "clear_failed_total_per3")
            dfa = round(dfc + g(d, "nonclear_failed_total_per3"), 2)
            rfa = round(rfc + g(r, "nonclear_failed_total_per3"), 2)
            dvf, rvf = round(dv + dfc, 2), round(rv + rfc, 2)
            dallf, rallf = round(dall + dfa, 2), round(rall + rfa, 2)
            clear_ok_f, all_ok_f = dvf <= rvf, dallf <= rallf
            combined = "PASS" if clear_ok_f and all_ok_f else "FAIL"
            ddist = d[f"{kind}_clear_typed_distinct"] + d[f"{kind}_clear_plates_distinct"]
            rdist = r[f"{kind}_clear_typed_distinct"] + r[f"{kind}_clear_plates_distinct"]
            scaled = "" if r["repeats"] == d["repeats"] == 3 else f" (typed scaled to 3 repeats: {test} {d['repeats']}, {ref} {r['repeats']})"
            dp, rp = d.get("plate_runs", 1), r.get("plate_runs", 1)
            if not dp == rp == 1:
                scaled += f" (plates: mean per plate run, {test} {dp} run(s) {d.get(f'{kind}_clear_plates_each_run', [])}, {ref} {rp} run(s) {r.get(f'{kind}_clear_plates_each_run', [])})"
            ds_c, rs_c = g(d, "clear_total_strict_per3") or dv, g(r, "clear_total_strict_per3") or rv
            ds_a = round(ds_c + (g(d, "nonclear_total_strict_per3") or d[f"{kind}_nonclear_total_per3"]), 2)
            rs_a = round(rs_c + (g(r, "nonclear_total_strict_per3") or r[f"{kind}_nonclear_total_per3"]), 2)
            row = {
                "rule": rule,
                "ref": ref,
                "what": f"{test} total {word} misses (typed plus plates) no higher than {ref}, clear entries AND all entries",
                "verdict": base if base == combined else "INCONCLUSIVE",
                "verdict_without_failed_calls": base,
                "verdict_with_failed_calls": combined,
                "clear_verdict": _pf(clear_ok),
                "all_verdict": _pf(all_ok),
                "numbers": f"clear only: {test} {_fmt(dv)} vs {ref} {_fmt(rv)} ({_pf(clear_ok)}){scaled}",
                "with_nonclear": f"all entries: {test} {_fmt(dall)} vs {ref} {_fmt(rall)} ({_pf(all_ok)})",
                "with_failed_calls": (
                    f"failed calls counted as misses: clear {test} {_fmt(dvf)} vs {ref} {_fmt(rvf)} ({_pf(clear_ok_f)}); "
                    f"all {test} {_fmt(dallf)} vs {ref} {_fmt(rallf)} ({_pf(all_ok_f)}); verdict {combined}"
                ),
                "distinct": f"{test} {ddist} vs {ref} {rdist} ({_pf(ddist <= rdist)})",
                "listed_only": f"{test} {_fmt(dl)} vs {ref} {_fmt(rl)} ({_pf(dl <= rl)})",
                "strict_merge_view": (
                    f"clear {test} {_fmt(ds_c)} vs {ref} {_fmt(rs_c)} ({_pf(ds_c <= rs_c)}); "
                    f"all {test} {_fmt(ds_a)} vs {ref} {_fmt(rs_a)} ({_pf(ds_a <= rs_a)})"
                ),
            }
            if nums_ws:
                wd, wr = nums_ws[test][f"{kind}_clear_total_per3"], nums_ws[ref][f"{kind}_clear_total_per3"]
                missing = [c for c in (test, ref) if nums_ws[c].get("worksheet_missing")]
                if missing:
                    row["worksheet_listing"] = f"n/a: no filled worksheet for every plate run of {', '.join(missing)}"
                else:
                    row["worksheet_listing"] = f"{test} {wd} vs {ref} {wr} ({_pf(wd <= wr)})"
            rules.append(row)
    return rules


# ---------------------------------------------------------------------------
# The held-out typed set
# ---------------------------------------------------------------------------


def unscored_runs(cell_spec: dict, data: dict) -> list[str]:
    """What a cell lists but did not score: the counts of typed and plate runs that are missing or unfinished."""
    out = []
    typed = len(cell_spec.get("text") or []) - len(data["repeats"])
    plates = len(plate_names(cell_spec)) - len(data["plate_runs"])
    if typed:
        out.append(f"{typed} typed run(s)")
    if plates:
        out.append(f"{plates} plate run(s)")
    return out


def mark_incomplete_comparisons(rules: list[dict], cells: dict, scored: dict, test: str, refs: list[str]) -> None:
    """Rules 3 and 4 compare totals, and a total over missing runs is smaller, not better. When the test cell or a
    ref lists runs that were not scored (missing, unreadable or still being written), a PASS becomes INCOMPLETE and
    the numbers line names them. A FAIL stays a FAIL (a miss counted is a miss), INCONCLUSIVE stays as it is.

    Used only by a config that lists holdout runs, so the reports of the older configs read as before."""
    for rule in rules:
        if rule["rule"] not in (3, 4):
            continue
        gaps = []
        for name in (test, rule["ref"]):
            missing = unscored_runs(cells[name], scored["cells"][name])
            if missing:
                gaps.append(f"{name}: {', '.join(missing)} not scored")
        if not gaps:
            continue
        rule["incomplete_runs"] = gaps
        rule["numbers"] += f"; {'; '.join(gaps)}"
        if rule["verdict"] == "PASS":
            rule["verdict"] = "INCOMPLETE"


def holdout_configured(scored: dict) -> bool:
    return any("holdout" in data for data in scored["cells"].values())


def summarise_holdout(scored: dict, expected_repeats: int) -> dict:
    """Per cell that lists `holdout` runs: the numbers of the scored repeats, the runs left out with the reason,
    and the mapping gaps (model items outside the gold, gold items no model item held).

    Only complete runs are here; a run that is still being written never shows up as zero misses. A cell whose
    scored repeats are fewer than `expected_repeats` is `complete: False` (INCOMPLETE in the report)."""
    cells = {}
    for cell, data in scored["cells"].items():
        h = data.get("holdout")
        if h is None:
            continue
        runs = h["runs"]
        t = tally(runs)
        per = [{"run": r["run"], **tally([r])["counts"]} for r in runs]
        per_distinct = [tally([r])["distinct"] for r in runs]
        outside: dict[tuple, dict] = {}
        unheld: dict[tuple, dict] = {}
        for r in runs:
            for c in r["cases"]:
                for o in c["outside_gold"]:
                    row = outside.setdefault(
                        (c["case"], o["name"], o["en"]),
                        {"case": c["case"], "input": c["input"], "name": o["name"], "en": o["en"], "n_flags": 0, "runs": []},
                    )
                    row["n_flags"] = max(row["n_flags"], o["n_flags"])
                    row["runs"].append(r["run"])
                for gold_item, holders in c["mapping"].items():
                    if not holders:
                        row = unheld.setdefault((c["case"], gold_item), {"case": c["case"], "input": c["input"], "gold_item": gold_item, "runs": []})
                        row["runs"].append(r["run"])
        cells[cell] = {
            "label": data["label"],
            "listed": h["listed"],
            "cases": h["cases"],
            "scored": len(runs),
            "expected": expected_repeats,
            "complete": len(runs) == expected_repeats,
            "runs": [r["run"] for r in runs],
            "left_out": h["left_out"],
            "preg_clear_miss_per_repeat": [r.get("preg_clear_miss", 0) for r in per],
            "preg_clear_failed_per_repeat": [r.get("preg_clear_failed_call", 0) for r in per],
            "preg_clear_strict_extra_per_repeat": [r.get("preg_clear_strict_extra_miss", 0) for r in per],
            "alg_clear_miss_per_repeat": [r.get("alg_clear_miss", 0) for r in per],
            "alg_nonclear_miss_per_repeat": [r.get("alg_nonclear_miss", 0) for r in per],
            "alg_clear_demoted_per_repeat": [r.get("alg_clear_demoted", 0) for r in per],
            "preg_false_alarm_per_repeat": [r.get("preg_false_alarm", 0) for r in per],
            "alg_false_alarm_per_repeat": [r.get("alg_false_alarm", 0) for r in per],
            "failed_calls_per_repeat": [r.get("failed_calls", 0) for r in per],
            "outside_items_per_repeat": [r.get("outside_items", 0) for r in per],
            "outside_items_flagged_per_repeat": [r.get("outside_items_flagged", 0) for r in per],
            "unlisted_entries_per_repeat": [r.get("unlisted_entries_typed", 0) for r in per],
            "preg_clear_distinct": t["distinct"].get("preg_clear_miss", 0),
            "alg_clear_distinct": t["distinct"].get("alg_clear_miss", 0),
            "preg_false_alarm_distinct": t["distinct"].get("preg_false_alarm", 0),
            "alg_false_alarm_distinct": t["distinct"].get("alg_false_alarm", 0),
            "outside_items": sorted(outside.values(), key=lambda x: (x["case"], x["name"] or "")),
            "unheld_gold": sorted(unheld.values(), key=lambda x: (x["case"], x["gold_item"])),
            "false_alarms": t["false_alarms"],
            "per_repeat_distinct": per_distinct,
        }
        if h.get("aliases"):
            cells[cell]["alias_credits_per_repeat"] = [r.get("credit_alias", 0) for r in per]
            cells[cell]["component_credits_per_repeat"] = [r.get("credit_component", 0) for r in per]
            credited: dict[tuple, dict] = {}
            for r in runs:
                for c in r["cases"]:
                    for e in c["entries"]:
                        if e.get("credit"):
                            row = credited.setdefault(
                                (c["case"], e["item"], e["kind"], e["value"], e["credit"]),
                                {"case": c["case"], "item": e["item"], "kind": e["kind"], "value": e["value"], "via": e["credit"], "clear": e["clear"], "holders": [], "runs": []},
                            )
                            row["runs"].append(r["run"])
                            row["holders"] = sorted({*row["holders"], *(x["name"] for x in e["holders"])})
            cells[cell]["credited"] = sorted(credited.values(), key=lambda x: (x["case"], x["item"], x["kind"], x["value"]))
    return cells


def evaluate_holdout_rule_2(holdout: dict, test: str, expected_repeats: int) -> dict | None:
    """Rule 2 on the holdout for the test cell, or None when the test cell lists no holdout runs."""
    d = holdout.get(test)
    if d is None:
        return None
    return rule_2_row(
        test,
        f"{test} holdout: zero misses on the clear pregnancy must-flag holdout cases, in every repeat",
        d["preg_clear_miss_per_repeat"],
        d["preg_clear_failed_per_repeat"],
        d["preg_clear_strict_extra_per_repeat"],
        d["preg_clear_distinct"],
        d["scored"],
        expected_repeats,
        unit="holdout",
    )


def sanity_list(scored: dict, cells: tuple[str, ...] = ("B", "C", "D"), limit: int = 10, gold: dict | None = None) -> list[dict]:
    """Gold labels the cells contradict the same way: all three first, then two of three to fill the list.

    A must_flag entry is contradicted when it is missed (or demoted to mayContain); a must_not_flag entry when it
    is flagged. The rate is per cell over the answers that judged the entry. Only entries that every cell
    contradicts at least once are kept; the list is sorted by the lowest of the three rates.
    """
    agg = defaultdict(lambda: defaultdict(Counter))
    meta = {}
    judged = defaultdict(Counter)  # key -> cell -> answers that judged it

    def _gold_case(c):
        return gold.get(c["case"]) if gold is not None else _gold_case_default(c)

    for cell in cells:
        data = scored["cells"][cell]
        for run in cell_runs(data):
            for c in run["cases"]:
                for e in c["entries"]:
                    if e["outcome"] == "unlisted_unscored":
                        continue
                    key = ("must_flag", c["case"], e["item"], e["kind"], e["value"])
                    meta[key] = {"input": c["input"], "clear": e["clear"]}
                    judged[key][cell] += 1
                    out = "missed" if e["outcome"] in ("miss", "unlisted_miss") else e["outcome"]
                    agg[key][cell][out] += 1
                case = None
                flagged = {(fa["item"], fa["kind"], fa["value"]) for fa in c["false_alarms"]}
                for item, ix in c["mapping"].items():
                    if not ix:
                        continue
                    for e in _gold_case(c)["must_not_flag"] if _gold_case(c) else []:
                        if e["item"] != item:
                            continue
                        for v in entry_values(e):
                            key = ("must_not_flag", c["case"], item, e["kind"], v)
                            meta[key] = {"input": c["input"], "clear": e.get("clear", _gold_case(c).get("clear", False))}
                            judged[key][cell] += 1
                            if (item, e["kind"], v) in flagged:
                                agg[key][cell]["flagged"] += 1
    rows = []
    for key, by_cell in agg.items():
        if any(judged[key][cell] == 0 for cell in cells):
            continue
        ways = ("missed", "demoted") if key[0] == "must_flag" else ("flagged",)
        for way in ways:
            rates = {cell: by_cell[cell][way] / judged[key][cell] for cell in cells}
            n_cells = sum(1 for v in rates.values() if v > 0)
            if n_cells < len(cells) - 1:
                continue
            rows.append(
                {
                    "list": key[0],
                    "case": key[1],
                    "item": key[2],
                    "kind": key[3],
                    "value": key[4],
                    "way": {"missed": "missed", "demoted": "demoted to mayContain", "flagged": "flagged although must_not_flag"}[way],
                    "clear": meta[key]["clear"],
                    "input": meta[key]["input"],
                    "rates": {cell: f"{by_cell[cell][way]}/{judged[key][cell]}" for cell in cells},
                    "cells_contradicting": n_cells,
                    "min_rate": min(v for v in rates.values() if v > 0),
                    "view": SANITY_VIEWS.get((key[1], key[2], key[3], key[4])),
                }
            )
    rows.sort(key=lambda r: (-r["cells_contradicting"], -r["min_rate"], r["case"], r["item"], r["value"]))
    return rows[:limit]


_GOLD_CACHE: dict[str, dict] = {}


def _gold_case_default(c: dict) -> dict | None:
    if not _GOLD_CACHE:
        _GOLD_CACHE.update(load_text_gold())
        _GOLD_CACHE.update(load_plate_gold())
    return _GOLD_CACHE.get(c["case"])


# The scorer's view on each sanity row, written after reading the answers. A proposed correction is a
# proposal only: the gold files are not changed by this script.
SANITY_VIEWS: dict[tuple[str, str, str, str], str] = {
    ("32", "herb crackers", "allergen", "sesame"): (
        "Gold arguable, already clear:false. Herb crackers do not plainly hold sesame. Proposal: move to may_flag; "
        "mayContain is the honest list."
    ),
    ("47", "yogurt bowl with granola, kiwi slices and berry compote", "allergen", "milk"): (
        "All cells read the bowl as a smoothie or acai bowl, so they hedge milk. The photo cannot prove a yogurt "
        "base. Proposal: set clear:false. The chip still shows."
    ),
    ("t068", "coconut yogurt", "allergen", "nuts"): (
        "Coconut is not an EU Annex II nut, so nuts in `allergens` is wrong. In mayContain it is a cross-contact "
        "hedge. Proposal: keep must_not for `allergens`, accept nuts in mayContain."
    ),
    ("t071", "curry", "allergen", "nuts"): (
        "Unknown curry: mayContain is the honest list, and it shows a chip. Proposal: accept mayContain as the "
        "expected list (no demotion)."
    ),
    ("05", "chicken pieces in creamy sauce with leafy greens (spinach-type)", "allergen", "milk"): (
        "The cream may be coconut milk. clear:false is right; mayContain is a fair answer. No change."
    ),
    ("32", "pan-fried spiced hard-boiled egg halves", "pregnancy", "raw-egg"): (
        "Gold right for the photo: hard-boiled egg halves. The cells read deviled eggs, whose filling can hold raw "
        "yolk mayonnaise. A false alarm, not a gold error. No change."
    ),
    ("37", "pierogi/boiled dumplings (potato-cheese filling)", "allergen", "milk"): (
        "Gold right: pierogi ruskie hold quark. The cells hedge. No change."
    ),
    ("42", "sour cream / remoulade dollop", "allergen", "milk"): (
        "Remoulade is egg and oil, not milk. clear:false is right. Proposal: move to may_flag."
    ),
    ("45", "sliced raw fish (hoe/sashimi) on shredded radish", "allergen", "fish"): (
        "A scorer artefact, not a gold error: B and C name the hoe only inside a banchan plate label, which hedges "
        "fish for many dishes. No change."
    ),
    ("t089", "white cheese", "pregnancy", "soft-cheese"): (
        "Gold right: beyaz peynir is brined, not mould-ripened or blue. A false alarm. No change."
    ),
    ("t063", "miso soup", "allergen", "fish"): (
        "Dashi holds fish in the plain recipe, but instant miso often has none. clear:false is right. No change."
    ),
    ("t050", "chicken liver pate on toast", "pregnancy", "raw-meat"): (
        "The app's raw-meat definition names pate, so the gold is right by the app's own words, even if a cooked "
        "pate is safe. No change; a prompt question, not a gold question."
    ),
}


# ---------------------------------------------------------------------------
# Markdown
# ---------------------------------------------------------------------------


def _flags_text(h: dict) -> str:
    return f"P{h['pregnancy']} A{h['allergens']} M{h['mayContain']}"


def _md_escape(text: str) -> str:
    return no_long_dash(text or "").replace("|", "/").replace("\n", " ")


def render_holdout(scored: dict, holdout: dict, rule2: dict | None, gold_name: str, test: str | None) -> list[str]:
    """The "Holdout" block: the same per-cell numbers as the typed set, on the held-out cases, plus the mapping gaps."""
    L = []
    n_cases = next(iter(holdout.values()))["cases"] if holdout else 0
    expected = next(iter(holdout.values()))["expected"] if holdout else 0
    L.append("## Holdout")
    L.append("")
    L.append(f"Typed runs of `{gold_name}` ({n_cases} cases), scored with the same rules as the typed set and kept apart from")
    L.append("it: nothing here enters the typed numbers, the plates or rules 3 and 4. Gold items are matched by word")
    L.append("overlap with the `core` names of the holdout file; no override is written for the holdout, so a model name")
    L.append("the words cannot place shows up as an item outside the gold and the gold item it should have held as one")
    L.append("no model item held. A run is scored only when it is finished; a missing or partial run is INCOMPLETE. Each cell needs")
    L.append(f"{expected} finished repeat(s).")
    has_aliases = any("alias_credits_per_repeat" in h for h in holdout.values())
    if has_aliases:
        L.append("")
        L.append("The gold file also carries `aliases` (`gold/GOLD-NOTES.md`, the alias rule): other names, spellings and")
        L.append("translations of the same food, which hold a gold item beside the word overlap. A part of a combined item (the")
        L.append("bread of \"cheese on bread\") is a component alias: a flag on that part counts for the combined gold item. The")
        L.append("table below the numbers counts the hits that only an alias or a component made, so the effect stays visible.")
    L.append("")
    L.append("| cell | label | runs listed | scored | status | runs left out |")
    L.append("|---|---|---|---|---|---|")
    for cell, h in holdout.items():
        status = "complete" if h["complete"] else f"**INCOMPLETE** ({h['scored']} of {h['expected']})"
        left = "; ".join(f"`{x['run']}`: {_md_escape(x['reason'])}" for x in h["left_out"]) or "none"
        L.append(f"| {cell} | {h['label']} | {h['listed']} | {', '.join(h['runs']) or 'none'} | {status} | {left} |")
    L.append("")
    L.append("### Rule 2 on the holdout")
    L.append("")
    if rule2 is None:
        L.append(f"The test cell {test} lists no holdout runs, so rule 2 is not evaluated on the holdout.")
    else:
        L.append(f"{rule2['what']}: **{rule2['verdict']}**. {rule2['numbers']}. Failed calls that hold a clear pregnancy entry,")
        L.append(f"per repeat {rule2['failed_call_entries_per_repeat']}; counted as misses: {rule2['strict_with_failed_calls']}. Strict merge view:")
        L.append(f"{rule2['strict_merge_view']}.")
    L.append("")
    L.append("### Numbers per cell (one entry per scored repeat)")
    L.append("")
    L.append("| cell | repeats | preg clear misses | distinct | allergen clear misses | distinct | allergen not clear misses | preg false alarms | allergen false alarms | failed calls | items outside the gold (with flags) | gold entries with no holder |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for cell, h in holdout.items():
        outside = "[" + ", ".join(f"{a} ({b})" for a, b in zip(h["outside_items_per_repeat"], h["outside_items_flagged_per_repeat"])) + "]"
        L.append(
            f"| {cell} | {h['scored']} | {h['preg_clear_miss_per_repeat']} | {h['preg_clear_distinct']} | "
            f"{h['alg_clear_miss_per_repeat']} | {h['alg_clear_distinct']} | {h['alg_nonclear_miss_per_repeat']} | "
            f"{h['preg_false_alarm_per_repeat']} | {h['alg_false_alarm_per_repeat']} | {h['failed_calls_per_repeat']} | "
            f"{outside} | {h['unlisted_entries_per_repeat']} |"
        )
    L.append("")
    if has_aliases:
        L.append("### Hits credited through aliases and components")
        L.append("")
        L.append("A hit counts here when the same answer scored without aliases would not have it: an `alias` hit sits on a")
        L.append("model item that holds the gold item only through an alias, a `component` hit sits on a part of a combined item.")
        L.append("One entry per scored repeat.")
        L.append("")
        L.append("| cell | repeats | hits through an alias | hits through a component |")
        L.append("|---|---|---|---|")
        for cell, h in holdout.items():
            L.append(f"| {cell} | {h['scored']} | {h['alias_credits_per_repeat']} | {h['component_credits_per_repeat']} |")
        L.append("")
        for cell, h in holdout.items():
            if not h["credited"]:
                continue
            L.append(f"#### Cell {cell}: credited entries")
            L.append("")
            L.append("| case | gold item | flag | clear | via | model item(s) | repeats |")
            L.append("|---|---|---|---|---|---|---|")
            for c in h["credited"]:
                L.append(
                    f"| {c['case']} | {_md_escape(c['item'])} | {c['kind']} {c['value']} | {'yes' if c['clear'] else 'no'} | {c['via']} | "
                    f"{_md_escape(', '.join(c['holders']))} | {len(c['runs'])} |"
                )
            L.append("")
    L.append("### Items outside the gold, per holdout cell (mapping gaps)")
    L.append("")
    L.append("A model item that shares too few words with any gold food of its case. Its flags are not judged. Read the")
    L.append("list before you read a miss as a safety result: the gold item it should have held is `unlisted`.")
    L.append("")
    for cell, h in holdout.items():
        L.append(f"#### Cell {cell} ({len(h['outside_items'])} item(s), {len(h['unheld_gold'])} gold item(s) no model item held)")
        L.append("")
        if not h["outside_items"] and not h["unheld_gold"]:
            L.append("None.")
            L.append("")
            continue
        if h["outside_items"]:
            L.append("| case | text | model item | english | flags on it | repeats |")
            L.append("|---|---|---|---|---|---|")
            for o in h["outside_items"]:
                L.append(f"| {o['case']} | {_md_escape(o['input'])} | {_md_escape(o['name'] or '')} | {_md_escape(o['en'] or '')} | {o['n_flags']} | {len(o['runs'])} |")
            L.append("")
        if h["unheld_gold"]:
            L.append("| case | text | gold item no model item held | repeats |")
            L.append("|---|---|---|---|")
            for u in h["unheld_gold"]:
                L.append(f"| {u['case']} | {_md_escape(u['input'])} | {_md_escape(u['gold_item'])} | {len(u['runs'])} |")
            L.append("")
    L.append("### Misses, false alarms and failed calls on the holdout")
    L.append("")
    for cell in holdout:
        runs = scored["cells"][cell]["holdout"]["runs"]
        rows = []
        for run in runs:
            for c in run["cases"]:
                for e in c["entries"]:
                    if e["outcome"] in ("miss", "unlisted_miss"):
                        rows.append((run["run"], c, e))
        L.append(f"#### Cell {cell}: misses ({len(rows)})")
        L.append("")
        if rows:
            L.append("| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |")
            L.append("|---|---|---|---|---|---|---|---|")
            for run, c, m in rows:
                held = "; ".join(f"{_md_escape(h['name'])} {_flags_text(h)}" for h in m["holders"]) or "not listed"
                L.append(
                    f"| {run} | {c['case']} | {_md_escape(c['input'])} | {_md_escape(m['item'])} | {m['kind']} {m['value']} | "
                    f"{'yes' if m['clear'] else 'no'} | {m['outcome']} | {held} |"
                )
        else:
            L.append("None.")
        L.append("")
        fa = Counter((r["case"], r["item"], r["kind"], r["value"], r["where"]) for r in holdout[cell]["false_alarms"])
        L.append(f"#### Cell {cell}: false alarms on must_not_flag ({sum(fa.values())})")
        L.append("")
        for (cid, item, kind, value, where), k in sorted(fa.items()):
            L.append(f"- {cid} {item}: {kind} {value} (in {where}), {k} answer(s)")
        if not fa:
            L.append("None.")
        L.append("")
        failed = [(run["run"], f) for run in runs for f in run["failed"]]
        L.append(f"#### Cell {cell}: failed calls ({len(failed)})")
        L.append("")
        for run, f in failed:
            ents = ", ".join(f"{e['kind']} {e['value']}" for e in f["must_flag"] if e["clear"])
            L.append(f"- {run} {f['case']}: {_md_escape(str(f['finish_reason'] or f.get('error') or 'none')[:120])}; clear must_flag entries: {ents or 'none'}")
        if not failed:
            L.append("None.")
        L.append("")
    return L


def render_markdown(
    scored: dict,
    summary: dict,
    nums: dict,
    rules: list[dict],
    sanity: list[dict],
    cfg: dict | None = None,
    holdout: dict | None = None,
    holdout_rule: dict | None = None,
) -> str:
    cfg = cfg or {}
    sanity_cells = tuple(cfg.get("sanity_cells") or ("B", "C", "D"))
    L = []
    title = cfg.get("title") or "EU switch: safety flags of the typed and plate cells"
    L.append(f"# {title} ({_dt.date.today().isoformat()})")
    L.append("")
    if cfg.get("config_path"):
        L.append(f"Written by `python3 -m harness.score_flags --config {cfg['config_path']}`. No model call. The gold is")
    else:
        L.append("Written by `python3 -m harness.score_flags`. No model call. The gold is `gold/gold_text.jsonl` and")
    if cfg.get("config_path"):
        L.append("`gold/gold_text.jsonl` and `gold/gold_plate_flags.json`, read as `gold/GOLD-NOTES.md` section 2 says. The")
        L.append("machine readable twin of this file holds every entry, every holder and every flag.")
    else:
        L.append("`gold/gold_plate_flags.json`, read as `gold/GOLD-NOTES.md` section 2 says. The machine readable")
        L.append("twin of this file holds every entry, every holder and every flag.")
    L.append("")
    for line in cfg.get("intro") or []:
        L.append(line)
    if cfg.get("intro"):
        L.append("")
    L.append("Legend for a model item: `P[...]` pregnancy, `A[...]` allergens, `M[...]` mayContain.")
    L.append("")
    L.append("## Runs")
    L.append("")
    L.append("| cell | label | typed repeats scored | plate run |")
    L.append("|---|---|---|---|")
    for cell, data in scored["cells"].items():
        reps = ", ".join(r["run"] for r in data["repeats"]) or "none"
        prs = ", ".join(r["run"] for r in data["plate_runs"]) or "none"
        L.append(f"| {cell} | {data['label']} | {reps} | {prs} |")
    for name, why in scored["skipped"].items():
        L.append(f"| skipped | `{name}` | {why} | |")
    L.append("")
    if cfg.get("config_path"):
        L.append(READING_PLACE)
        L.append("")
    L.append("## Decision rules")
    L.append("")
    L.append("Rule 2 needs the expected number of typed repeats (fewer is INCOMPLETE) and zero clear misses in each. Rules")
    L.append("3 and 4 PASS only when BOTH the clear-only totals and the all-entries totals (clear plus `clear: false`) of")
    L.append("the test cell are no higher than the ref's; both are printed. Typed misses are summed over the repeats")
    L.append("(scaled to 3 when a cell has fewer). A failed call is not a flag miss, but its must_flag entries are")
    L.append("counted as misses in a second line per rule; when that line gives another verdict, the rule is")
    L.append("INCONCLUSIVE. Beside the verdict, for a reader to judge: each distinct entry counted once; the misses on")
    L.append("listed items only; the plates read with the recall worksheet's listing; and the strict merge view (one flag")
    L.append("value on an item that holds several gold foods credits one entry). None of these four decides a rule.")
    L.append("")
    L.append("| rule | test | verdict | clear entries | all entries | failed calls counted as misses | distinct entries | listed items only | worksheet listing | strict merge view |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for r in rules:
        if r["rule"] == 2:
            L.append(
                f"| 2 | {r['what']} | **{r['verdict']}** | {r['numbers']} | | failed calls left out (rule 1); "
                f"their clear pregnancy entries per repeat {r['failed_call_entries_per_repeat']}; counted as misses: {r['strict_with_failed_calls']} | | | | "
                f"{r['strict_merge_view']} |"
            )
        else:
            L.append(
                f"| {r['rule']} | {r['what']} | **{r['verdict']}** | {r['numbers']} | {r['with_nonclear']} | {r['with_failed_calls']} | "
                f"{r['distinct']} | {r['listed_only']} | {r.get('worksheet_listing', '')} | {r['strict_merge_view']} |"
            )
    L.append("")
    if holdout:
        L.extend(render_holdout(scored, holdout, holdout_rule, cfg.get("typed_gold_holdout", DEFAULT_TYPED_GOLD_HOLDOUT), cfg.get("test")))
    L.append("## Miss counts per cell")
    L.append("")
    L.append("Typed counts are summed over the scored repeats. `per 3` scales a cell with fewer repeats to three.")
    L.append("`distinct` counts an entry once however many repeats missed it. `unlisted` = the item was not in the")
    L.append("answer at all (a clear must_flag only); `elsewhere` = of those, the same flag sat on another item.")
    L.append("")
    L.append("| cell | reps | preg clear typed | per 3 | distinct | preg clear plates | preg nonclear typed / plates | alg clear typed | per 3 | distinct | alg clear plates | alg nonclear typed / plates |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for cell, n in nums.items():
        L.append(
            f"| {cell} | {n['repeats']} | {n['preg_clear_typed']} | {n['preg_clear_typed_per3']} | {n['preg_clear_typed_distinct']} | "
            f"{n['preg_clear_plates']} | {n['preg_nonclear_typed']} / {n['preg_nonclear_plates']} | "
            f"{n['alg_clear_typed']} | {n['alg_clear_typed_per3']} | {n['alg_clear_typed_distinct']} | "
            f"{n['alg_clear_plates']} | {n['alg_nonclear_typed']} / {n['alg_nonclear_plates']} |"
        )
    L.append("")
    L.append("| cell | source | clear preg tested | clear preg miss (unlisted, elsewhere) | clear alg tested | clear alg miss (unlisted, elsewhere) | if_listed misses | failed calls |")
    L.append("|---|---|---|---|---|---|---|---|")
    for cell, s in summary.items():
        for src, t in (("typed", s["typed"]), ("plates", s["plates"])):
            if not t or not t["cases"] and not t["counts"]:
                continue
            c = t["counts"]
            L.append(
                f"| {cell} | {src} | {c.get('preg_clear_tested', 0)} | {c.get('preg_clear_miss', 0)} "
                f"({c.get('preg_clear_miss_unlisted', 0)}, {c.get('preg_clear_miss_unlisted_elsewhere', 0)}) | "
                f"{c.get('alg_clear_tested', 0)} | {c.get('alg_clear_miss', 0)} "
                f"({c.get('alg_clear_miss_unlisted', 0)}, {c.get('alg_clear_miss_unlisted_elsewhere', 0)}) | "
                f"{c.get('preg_clear_miss_iflisted', 0) + c.get('alg_clear_miss_iflisted', 0) + c.get('preg_nonclear_miss_iflisted', 0) + c.get('alg_nonclear_miss_iflisted', 0)} | "
                f"{c.get('failed_calls', 0)} |"
            )
    L.append("")

    L.append("## Name matching and merge leniency per cell")
    L.append("")
    L.append("A model item that shares too few words with any gold food is `outside the gold`: its flags are never")
    L.append("judged, and the gold food it should have held shows up as `unlisted` (a clear entry of it is an")
    L.append("`unlisted_miss`). A new model that names foods in its own way can turn real matches into those, so the")
    L.append("counts are printed here. Check the names before reading a rise in misses as a safety result (`--map-dump`")
    L.append("prints the mapping).")
    L.append("")
    L.append("An item that holds more than one gold food carries its flags for each of them. `hits via a merged item`")
    L.append("counts the hits credited only that way. In the strict view one flag value on one such item credits one")
    L.append("gold entry; `extra misses (strict)` are the further entries that lose their hit.")
    L.append("")
    L.append("| cell | source | answers | items outside the gold (with flags) | gold entries with no holder | hits via a merged item, clear / not clear | extra misses (strict), clear preg / clear alg |")
    L.append("|---|---|---|---|---|---|---|")
    for cell, s_ in summary.items():
        for src, t in (("typed", s_["typed"]), ("plates", s_["plates"])):
            if not t or not t["cases"] and not t["counts"]:
                continue
            c = t["counts"]
            unl = c.get("unlisted_entries_typed" if src == "typed" else "unlisted_entries_plate", 0)
            merged = {cl: c.get(f"preg_{cl}_hit_merged", 0) + c.get(f"alg_{cl}_hit_merged", 0) for cl in ("clear", "nonclear")}
            L.append(
                f"| {cell} | {src} | {t['cases']} | {c.get('outside_items', 0)} ({c.get('outside_items_flagged', 0)}) | {unl} | "
                f"{merged['clear']} / {merged['nonclear']} | "
                f"{c.get('preg_clear_strict_extra_miss', 0)} / {c.get('alg_clear_strict_extra_miss', 0)} |"
            )
    L.append("")

    def miss_table(cell, title, rows):
        L.append(f"### {title}")
        L.append("")
        if not rows:
            L.append("None.")
            L.append("")
            return
        L.append("| run | case | text | gold item | flag | clear | outcome | model item(s) and flags |")
        L.append("|---|---|---|---|---|---|---|---|")
        for run, m in rows:
            if m["holders"]:
                held = "; ".join(f"{_md_escape(h['name'])} {_flags_text(h)}" for h in m["holders"])
            else:
                held = "not listed" + (f"; same flag on: {_md_escape(', '.join(m.get('elsewhere') or []))}" if m.get("elsewhere") else "")
            L.append(
                f"| {run} | {m['case']} | {_md_escape(m['input'])} | {_md_escape(m['item'])} | {m['kind']} {m['value']} | "
                f"{'yes' if m['clear'] else 'no'} | {m['outcome']} | {held} |"
            )
        L.append("")

    L.append("## Every miss")
    L.append("")
    for cell, data in scored["cells"].items():
        rows = []
        runs = cell_runs(data)
        for run in runs:
            for c in run["cases"]:
                for e in c["entries"]:
                    if e["outcome"] in ("miss", "unlisted_miss"):
                        rows.append((run["run"], {**e, "case": c["case"], "input": c["input"]}))
        preg = [r for r in rows if r[1]["kind"] == "pregnancy"]
        alg = [r for r in rows if r[1]["kind"] == "allergen"]
        miss_table(cell, f"Cell {cell}: pregnancy misses ({len(preg)})", preg)
        miss_table(cell, f"Cell {cell}: allergen misses ({len(alg)})", alg)

    L.append("## Failed calls (scored by rule 1, not as flag misses)")
    L.append("")
    L.append("| cell | run | case | text | finish or error | clear must_flag entries | flags the truncated text had written |")
    L.append("|---|---|---|---|---|---|---|")
    for cell, data in scored["cells"].items():
        runs = cell_runs(data)
        for run in runs:
            for f in run["failed"]:
                ents = ", ".join(f"{e['kind']} {e['value']}" for e in f["must_flag"] if e["clear"])
                L.append(
                    f"| {cell} | {run['run']} | {f['case']} | {_md_escape(f['input'])} | {_md_escape(str(f['finish_reason'] or f.get('error') or 'none')[:120])} | {ents} | "
                    f"{_md_escape(' ; '.join(f['truncated_flags'])) or 'none'} |"
                )
    L.append("")

    L.append("## Not blocking: demotions, false alarms, extra flags")
    L.append("")
    L.append("| cell | source | cases | demotions clear (distinct) | demotions not clear | preg false alarms (distinct) | allergen false alarms (distinct) | extra preg flags per case | extra allergen flags per case | items outside the gold, their flags |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for cell, s in summary.items():
        for src, t in (("typed", s["typed"]), ("plates", s["plates"])):
            if not t or not t["cases"] and not t["counts"]:
                continue
            c, d = t["counts"], t["distinct"]
            n = t["cases"] or 1
            L.append(
                f"| {cell} | {src} | {t['cases']} | {c.get('alg_clear_demoted', 0)} ({d.get('alg_clear_demoted', 0)}) | "
                f"{c.get('alg_nonclear_demoted', 0)} | {c.get('preg_false_alarm', 0)} ({d.get('preg_false_alarm', 0)}) | "
                f"{c.get('alg_false_alarm', 0)} ({d.get('alg_false_alarm', 0)}) | "
                f"{c.get('extra_preg', 0) / n:.2f} | {c.get('extra_alg', 0) / n:.2f} | "
                f"{c.get('outside_items', 0)}, {c.get('outside_flags', 0)} |"
            )
    L.append("")
    for cell, s in summary.items():
        rows = (s["typed"]["demotions"] if s["typed"] else []) + (s["plates"]["demotions"] if s["plates"] else [])
        L.append(f"### Cell {cell}: demotions ({len(rows)})")
        L.append("")
        grouped = Counter((r["case"], r["item"], r["value"], r["clear"]) for r in rows)
        for (cid, item, value, clear), k in sorted(grouped.items()):
            L.append(f"- {cid} {item}: {value} in mayContain, {k} answer(s){'' if clear else ', clear:false'}")
        L.append("")
    for cell, s in summary.items():
        rows = (s["typed"]["false_alarms"] if s["typed"] else []) + (s["plates"]["false_alarms"] if s["plates"] else [])
        L.append(f"### Cell {cell}: false alarms on must_not_flag ({len(rows)})")
        L.append("")
        grouped = Counter((r["case"], r["item"], r["kind"], r["value"], r["where"]) for r in rows)
        for (cid, item, kind, value, where), k in sorted(grouped.items()):
            L.append(f"- {cid} {item}: {kind} {value} (in {where}), {k} answer(s)")
        L.append("")

    L.append("## Per category and per allergen")
    L.append("")
    L.append("Misses / tested entries, typed repeats and plates together. Demotions in brackets.")
    L.append("")
    cells = list(cfg.get("category_cells") or summary)
    L.append("| kind | value | " + " | ".join(f"{c} clear" for c in cells) + " | " + " | ".join(f"{c} not clear" for c in cells) + " |")
    L.append("|---|---|" + "---|" * (2 * len(cells)))
    for kind, vocab in (("pregnancy", PREGNANCY_CATEGORIES), ("allergen", ALLERGENS)):
        for v in vocab:
            cl, nc = [], []
            for cell in cells:
                agg = Counter()
                for t in (summary[cell]["typed"], summary[cell]["plates"]):
                    if t:
                        for key, cnt in t["per_value"].items():
                            k, val = key.split(":", 1)
                            if k == kind and v in val.split("|"):
                                agg.update(cnt)
                dem_c = f" ({agg['clear_demoted']})" if agg["clear_demoted"] else ""
                dem_n = f" ({agg['nonclear_demoted']})" if agg["nonclear_demoted"] else ""
                cl.append(f"{agg['clear_miss']}/{agg['clear_tested']}{dem_c}")
                nc.append(f"{agg['nonclear_miss']}/{agg['nonclear_tested']}{dem_n}")
            L.append(f"| {kind} | {v} | " + " | ".join(cl) + " | " + " | ".join(nc) + " |")
    L.append("")

    if cfg.get("compare"):
        L.extend(render_comparisons(scored, summary, cfg["compare"]))

    credited_cells = {c: s["typed"]["counts"] for c, s in summary.items() if s["typed"]["counts"].get("credit_alias") or s["typed"]["counts"].get("credit_component")}
    if credited_cells:
        L.append("## Hits credited through aliases and components (typed set)")
        L.append("")
        L.append("Hits of the typed repeats that only an alias or a component of the gold case made (see `gold/GOLD-NOTES.md`).")
        L.append("")
        L.append("| cell | hits through an alias | hits through a component |")
        L.append("|---|---|---|")
        for cell, cnt in credited_cells.items():
            L.append(f"| {cell} | {cnt.get('credit_alias', 0)} | {cnt.get('credit_component', 0)} |")
        L.append("")

    k = len(sanity_cells)
    names = ", ".join(sanity_cells[:-1]) + " and " + sanity_cells[-1] if k > 1 else sanity_cells[0]
    L.append("## Sanity: gold labels every cell contradicts the same way")
    L.append("")
    L.append(f"Entries that {names} all contradict come first, then entries {_NUMBER_WORDS.get(k - 1, k - 1)} of the {_NUMBER_WORDS.get(k, k)} contradict (to fill")
    L.append("ten rows), each group ranked by the lowest rate among the contradicting cells (contradicting answers")
    L.append("over answers that judged the entry). The gold files are not changed here; a view is a proposal.")
    L.append("")
    L.append("| cells | list | case | text | item | flag | clear | way | " + " | ".join(sanity_cells) + " | view |")
    L.append("|---|---|---|---|---|---|---|---|" + "---|" * k + "---|")
    for r in sanity:
        L.append(
            f"| {r['cells_contradicting']} of {k} | {r['list']} | {r['case']} | {_md_escape(r['input'])} | {_md_escape(r['item'])} | {r['kind']} {r['value']} | "
            f"{'yes' if r['clear'] else 'no'} | {r['way']} | "
            + " | ".join(r["rates"].get(c, "") for c in sanity_cells)
            + f" | {_md_escape(r['view'] or '')} |"
        )
    L.append("")
    return "\n".join(L)


_NUMBER_WORDS = {2: "two", 3: "three", 4: "four", 5: "five"}


def entry_outcomes(data: dict) -> dict:
    """Per source and case: the answers scored, and per judged entry the outcome counts over every run of a cell.

    Keys of `entries`: (source, case, list, item, kind, value). Outcomes: missed, demoted, flagged (a must_not_flag
    entry present). `failed` counts the failed calls per (source, case)."""
    answers, failed = Counter(), Counter()
    entries = defaultdict(Counter)
    inputs = {}
    for run in cell_runs(data):
        for c in run["cases"]:
            src = "plates" if c["plate"] else "typed"
            answers[(src, c["case"])] += 1
            inputs[c["case"]] = c["input"]
            for e in c["entries"]:
                key = (src, c["case"], e["list"], e["item"], e["kind"], e["value"], e["clear"])
                if e["outcome"] in ("miss", "unlisted_miss"):
                    entries[key]["missed"] += 1
                elif e["outcome"] == "demoted":
                    entries[key]["demoted"] += 1
                else:
                    entries[key]["seen"] += 1
            for fa in c["false_alarms"]:
                key = (src, c["case"], "must_not_flag", fa["item"], fa["kind"], fa["value"], fa["clear"])
                entries[key]["flagged"] += 1
        for f in run["failed"]:
            src = "plates" if f["plate"] else "typed"
            failed[(src, f["case"])] += 1
            inputs[f["case"]] = f["input"]
    return {"answers": answers, "failed": failed, "entries": entries, "inputs": inputs}


def extra_pregnancy_flags(data: dict) -> tuple[Counter, Counter]:
    """Pregnancy flags on a matched item that no gold list judges, grouped by (source, case, gold items held,
    value), counted over every run; plus the answers per (source, case)."""
    out, answers = Counter(), Counter()
    for run in cell_runs(data):
        for c in run["cases"]:
            src = "plates" if c["plate"] else "typed"
            answers[(src, c["case"])] += 1
            for x in c["extras"]:
                if x["kind"] == "pregnancy":
                    out[(src, c["case"], " + ".join(x["held"]), x["value"])] += 1
    return out, answers


def render_comparisons(scored: dict, summary: dict, pairs: list) -> list[str]:
    """For each (before, after) pair of cells: the not-blocking counts side by side, every judged entry whose
    outcome rate differs, and every pregnancy flag no gold list judges. Rates, not counts, because two cells
    can hold a different number of runs."""
    L = ["## Before and after: every difference", ""]
    L.append("Each pair compares two cells. A count is answers over the answers that judged the case, summed over")
    L.append("every run of the cell (typed repeats; plate runs). A row is listed when the two rates differ. A")
    L.append("source only one of the two cells holds is left out.")
    L.append("")
    for before, after in pairs:
        sb, sa = summary[before], summary[after]
        L.append(f"### {before} ({sb['label']}) against {after} ({sa['label']})")
        L.append("")
        L.append("| source | cell | answers | clear preg miss | not clear preg miss | clear alg miss | not clear alg miss | demotions clear / not | preg false alarms (distinct) | alg false alarms (distinct) | extra preg per answer | extra alg per answer | failed calls |")
        L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for src in ("typed", "plates"):
            if not all(x[src] and x[src]["cases"] for x in (sb, sa)):
                continue
            for cell, s in ((before, sb), (after, sa)):
                t = s[src]
                c, d, n = t["counts"], t["distinct"], t["cases"]
                L.append(
                    f"| {src} | {cell} | {n} | {c.get('preg_clear_miss', 0)} | {c.get('preg_nonclear_miss', 0)} | "
                    f"{c.get('alg_clear_miss', 0)} | {c.get('alg_nonclear_miss', 0)} | "
                    f"{c.get('alg_clear_demoted', 0)} / {c.get('alg_nonclear_demoted', 0)} | "
                    f"{c.get('preg_false_alarm', 0)} ({d.get('preg_false_alarm', 0)}) | {c.get('alg_false_alarm', 0)} ({d.get('alg_false_alarm', 0)}) | "
                    f"{c.get('extra_preg', 0) / n:.3f} | {c.get('extra_alg', 0) / n:.2f} | {c.get('failed_calls', 0)} |"
                )
        L.append("")
        ob, oa = entry_outcomes(scored["cells"][before]), entry_outcomes(scored["cells"][after])
        rows = []
        for key in sorted(set(ob["entries"]) | set(oa["entries"])):
            src, cid = key[0], key[1]
            nb, na = ob["answers"][(src, cid)], oa["answers"][(src, cid)]
            if not nb or not na:
                continue
            for way in ("missed", "demoted", "flagged"):
                kb, ka = ob["entries"][key][way], oa["entries"][key][way]
                if kb * na != ka * nb:
                    rows.append((key, way, f"{kb}/{nb}", f"{ka}/{na}"))
        for key in sorted(set(ob["failed"]) | set(oa["failed"])):
            nb = ob["answers"][key] + ob["failed"][key]
            na = oa["answers"][key] + oa["failed"][key]
            if not nb or not na:
                continue
            rows.append(((key[0], key[1], "call", "", "", "", True), "failed call", f"{ob['failed'][key]}/{nb}", f"{oa['failed'][key]}/{na}"))
        L.append(f"Entries whose rate differs ({len(rows)}):")
        L.append("")
        if rows:
            L.append(f"| source | case | text | list | gold item | flag | clear | way | {before} | {after} |")
            L.append("|---|---|---|---|---|---|---|---|---|---|")
            inputs = {**ob["inputs"], **oa["inputs"]}
            for (src, cid, lst, item, kind, value, clear), way, vb, va in rows:
                L.append(
                    f"| {src} | {cid} | {_md_escape(inputs.get(cid, ''))} | {lst} | {_md_escape(item)} | {kind} {value} | "
                    f"{'yes' if clear else 'no'} | {way} | {vb} | {va} |"
                )
        else:
            L.append("None.")
        L.append("")
        xb, ab = extra_pregnancy_flags(scored["cells"][before])
        xa, aa = extra_pregnancy_flags(scored["cells"][after])
        L.append(f"Pregnancy flags no gold list judges (extras), {before} against {after}. Neither credit nor error;")
        L.append("listed so a person can judge whether a new prompt adds false alarms.")
        L.append("")
        keys = sorted(k for k in set(xb) | set(xa) if ab[(k[0], k[1])] and aa[(k[0], k[1])])
        if keys:
            L.append(f"| source | case | gold item(s) the model item holds | flag | {before} | {after} |")
            L.append("|---|---|---|---|---|---|")
            for src, cid, held, value in keys:
                L.append(
                    f"| {src} | {cid} | {_md_escape(held)} | {value} | {xb[(src, cid, held, value)]}/{ab[(src, cid)]} | "
                    f"{xa[(src, cid, held, value)]}/{aa[(src, cid)]} |"
                )
        else:
            L.append("None.")
        L.append("")
    return L


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def map_dump(cells: dict = CELLS, runs_dir: Path = RUNS_DIR, cfg: dict | None = None) -> None:
    cfg = cfg or {}
    text_gold = load_text_gold(gold_path(cfg.get("typed_gold", DEFAULT_TYPED_GOLD)))
    plate_gold = load_plate_gold()
    holdout_gold = None
    if any(spec.get("holdout") for spec in cells.values()):
        holdout_gold = load_text_gold(gold_path(cfg.get("typed_gold_holdout", DEFAULT_TYPED_GOLD_HOLDOUT)))
    for cell, spec in cells.items():
        runs = [(n, text_gold, False) for n in spec.get("text") or []] + [(n, plate_gold, True) for n in plate_names(spec)]
        runs += [(n, holdout_gold, False) for n in spec.get("holdout") or []]
        for name, gold, plate in runs:
            res = load_results(run_path(runs_dir, name))
            if not run_is_complete(res, gold):
                continue
            for cid in sorted(gold):
                case = gold[cid]
                if case.get("expect_empty"):
                    continue
                ans = answer_of(res[cid])
                foods = ans.get("foods") or []
                mapped = map_items_ex(cid, case["core"] + case.get("optional", []), foods, case.get("aliases"))
                holders, unmatched = mapped["holders"], mapped["unmatched"]
                parts = []
                for g, ix in holders.items():
                    tag = "" if g in case["core"] else " (opt)"
                    comp = [foods[i].get("name") for i in mapped["components"][g]]
                    if ix or g in case["core"] or comp:
                        parts.append(f"{g}{tag} <- {[foods[i].get('name') for i in ix]}" + (f" + component {comp}" if comp else ""))
                um = [foods[i].get("name") for i in unmatched]
                print(f"{cell} {run_display(name)} {cid}: " + " | ".join(parts) + (f" || UNMATCHED {um}" if um else ""))


def compact_scored(scored: dict) -> dict:
    """Every judged answer, without the hits: the mapping, every entry that is not a hit, false alarms, extra
    flags, items outside the gold and failed calls. Hits are only counted (see `summary`)."""
    out = {"skipped": scored["skipped"], "cells": {}}
    for cell, data in scored["cells"].items():
        runs = []
        for run in cell_runs(data):
            cases = []
            for c in run["cases"]:
                cases.append(
                    {
                        "case": c["case"],
                        "mapping": c["mapping"],
                        "hits": sum(1 for e in c["entries"] if e["outcome"] == "hit"),
                        "merged_hits": sum(1 for e in c["entries"] if e.get("merged_credit")),
                        "not_hit": [e for e in c["entries"] if e["outcome"] != "hit"],
                        "false_alarms": c["false_alarms"],
                        "extras": [f"{x['food']}: {x['kind']} {x['value']} ({x['where']})" for x in c["extras"]],
                        "outside_gold": c["outside_gold"],
                    }
                )
                for via in ("alias", "component"):
                    n = sum(1 for e in c["entries"] if e.get("credit") == via)
                    if n:
                        cases[-1][f"{via}_hits"] = n
            runs.append({"run": run["run"], "cases": cases, "failed": run["failed"]})
        out["cells"][cell] = {"label": data["label"], "runs": runs}
    return out


READING_HEADING = "## Reading (written by hand, kept when the file is written again)"
READING_PLACE = "<!-- reading -->"


def keep_section(path: Path, heading: str) -> str | None:
    """A hand-written section already in the report survives a regeneration (up to the next `## ` heading)."""
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8")
    start = text.find(heading)
    if start < 0:
        return None
    end = text.find("\n## ", start + len(heading))
    return text[start:end if end > 0 else len(text)].rstrip() + "\n"


def run_scoring(
    cfg: dict,
    runs_dir: Path = RUNS_DIR,
    stem: Path | None = None,
    *,
    text_gold: dict | None = None,
    plate_gold: dict | None = None,
    holdout_gold_override: dict | None = None,
) -> dict:
    """Score the cells of `cfg` (the shape of `load_config`), evaluate rules 2 to 4 for `cfg["test"]` against
    `cfg["refs"]`, and write `<stem>.json` and `<stem>.md` when a stem is given. Returns the JSON document."""
    cells = cfg["cells"]
    skipped_cells = cfg.get("skipped_cells")
    if text_gold is None and cfg.get("typed_gold"):
        text_gold = load_text_gold(gold_path(cfg["typed_gold"]))
    has_holdout = any(spec.get("holdout") for spec in cells.values())
    holdout_gold = None
    if has_holdout:
        holdout_gold = load_text_gold(gold_path(cfg.get("typed_gold_holdout", DEFAULT_TYPED_GOLD_HOLDOUT))) if holdout_gold_override is None else holdout_gold_override
    gold_kw = {"text_gold": text_gold, "plate_gold": plate_gold, "holdout_gold": holdout_gold}
    scored = score_all(cells, runs_dir, skipped_cells=skipped_cells, **gold_kw)
    for name, why in (cfg.get("skipped") or {}).items():
        scored["skipped"][name] = why
    summary = summarise(scored)
    nums = rule_numbers(summary)
    scored_ws = score_all(cells, runs_dir, plate_listing="worksheet", skipped_cells=skipped_cells, **gold_kw)
    nums_ws = rule_numbers(summarise(scored_ws))
    missing = set(scored_ws["worksheet_missing"])
    for cell, data in scored_ws["cells"].items():
        nums_ws[cell]["worksheet_missing"] = sorted(r["run"] for r in data["plate_runs"] if r["run"] in missing)
    expected = cfg.get("expected_repeats", DEFAULT_EXPECTED_REPEATS)
    test_spec = cells[cfg["test"]]
    # A test cell with holdout runs and no typed runs is judged by rule 2 on the holdout alone.
    typed_rule_2 = not (test_spec.get("holdout") and not test_spec.get("text"))
    rules = evaluate_rules(
        nums,
        test=cfg["test"],
        refs=tuple(cfg["refs"]),
        nums_ws=nums_ws,
        expected_repeats=cfg.get("expected_text_repeats", expected),
        rule2=typed_rule_2,
    )
    holdout = holdout_rule = None
    if holdout_configured(scored):
        mark_incomplete_comparisons(rules, cells, scored, cfg["test"], cfg["refs"])
        holdout = summarise_holdout(scored, expected)
        holdout_rule = evaluate_holdout_rule_2(holdout, cfg["test"], expected)
    gold = None
    if text_gold is not None or plate_gold is not None:
        gold = {**(text_gold or {}), **(plate_gold or {})}
    sanity_cells = tuple(cfg.get("sanity_cells") or ("B", "C", "D"))
    sanity = sanity_list(scored, cells=sanity_cells, gold=gold) if all(c in scored["cells"] for c in sanity_cells) else []
    doc = {
        "generated": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "rules": rules,
        "numbers": nums,
        "numbers_worksheet_listing": nums_ws,
        "summary": {
            cell: {
                "label": s["label"],
                "n_repeats": s["n_repeats"],
                "n_plate_runs": s["n_plate_runs"],
                "typed_counts": s["typed"]["counts"],
                "typed_distinct": s["typed"]["distinct"],
                "typed_per_repeat": s["typed_per_repeat"],
                "typed_per_value": s["typed"]["per_value"],
                "plate_counts": s["plates"]["counts"] if s["plates"] else None,
                "plate_distinct": s["plates"]["distinct"] if s["plates"] else None,
                "plate_per_run": s["plates_per_run"],
                "plate_per_value": s["plates"]["per_value"] if s["plates"] else None,
            }
            for cell, s in summary.items()
        },
        "sanity": sanity,
        "scored": compact_scored(scored),
    }
    if holdout is not None:
        doc["holdout"] = {
            "gold": cfg.get("typed_gold_holdout", DEFAULT_TYPED_GOLD_HOLDOUT),
            "expected_repeats": expected,
            "rule_2": holdout_rule,
            "cells": {cell: {k: v for k, v in h.items() if k != "false_alarms"} for cell, h in holdout.items()},
            "scored": compact_scored(
                {
                    "skipped": {},
                    "cells": {
                        cell: {"label": data["label"], "repeats": data["holdout"]["runs"], "plate_runs": []}
                        for cell, data in scored["cells"].items()
                        if "holdout" in data
                    },
                }
            ),
        }
    if stem is not None:
        stem.parent.mkdir(parents=True, exist_ok=True)
        Path(f"{stem}.json").write_text(no_long_dash(json.dumps(doc, indent=1, ensure_ascii=False)) + "\n", encoding="utf-8")
        md = render_markdown(
            scored, summary, nums, rules, sanity, cfg if cfg.get("config_path") else None, holdout=holdout, holdout_rule=holdout_rule
        )
        if cfg.get("config_path"):
            kept = keep_section(Path(f"{stem}.md"), READING_HEADING)
            md = md.replace(f"\n{READING_PLACE}\n", "\n" + (kept or f"{READING_HEADING}\n\n(not written yet)\n") + "\n")
        Path(f"{stem}.md").write_text(no_long_dash(md) + "\n", encoding="utf-8")
    return doc


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Score the safety flags of the EU cells against the gold flag labels.")
    ap.add_argument("--map-dump", action="store_true", help="print the item mapping of every answer and stop")
    ap.add_argument("--out", default=None, help="output stem (default runs/EU-FLAG-SCORING-<date>, or the config's `out`)")
    ap.add_argument(
        "--config",
        default=None,
        help="a JSON file naming the cells, their runs, the rule test and `expected_repeats`, the typed repeats rule 2 "
        "needs (default 3; see load_config)",
    )
    ap.add_argument("--runs-dir", default=None, help="the directory run names are read from (default runs/)")
    args = ap.parse_args(argv)
    runs_dir = Path(args.runs_dir) if args.runs_dir else RUNS_DIR
    if args.config:
        cfg = load_config(Path(args.config))
        cfg["config_path"] = args.config
        cfg.setdefault("skipped_cells", {})
    else:
        cfg = {"cells": CELLS, "test": DEFAULT_TEST, "refs": list(DEFAULT_REFS), "expected_repeats": DEFAULT_EXPECTED_REPEATS}
    if args.map_dump:
        map_dump(cfg["cells"], runs_dir, cfg)
        return 0
    if args.out:
        stem = Path(args.out)
    elif cfg.get("out"):
        stem = EVAL_ROOT / cfg["out"]
    else:
        stem = RUNS_DIR / f"EU-FLAG-SCORING-{_dt.date.today().isoformat()}"
    doc = run_scoring(cfg, runs_dir, stem)
    for r in doc["rules"]:
        ref = f" vs {r['ref']}" if "ref" in r else ""
        print(f"rule {r['rule']}{ref}: {r['verdict']}  {r['numbers']}")
        if "with_nonclear" in r:
            print(f"    {r['with_nonclear']}")
            print(f"    {r['with_failed_calls']}")
    if "holdout" in doc:
        rule = doc["holdout"]["rule_2"]
        print(f"holdout rule 2: {rule['verdict']}  {rule['numbers']}" if rule else "holdout rule 2: the test cell lists no holdout runs")
        for cell, h in doc["holdout"]["cells"].items():
            state = "complete" if h["complete"] else f"INCOMPLETE ({h['scored']} of {h['expected']} repeats)"
            print(
                f"    holdout {cell}: {state}; preg clear misses {h['preg_clear_miss_per_repeat']}, "
                f"alg clear misses {h['alg_clear_miss_per_repeat']}, failed calls {h['failed_calls_per_repeat']}, "
                f"items outside the gold {h['outside_items_per_repeat']}"
            )
            for x in h["left_out"]:
                print(f"        left out {x['run']}: {x['reason']}")
    print(f"wrote {stem}.json and {stem}.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
