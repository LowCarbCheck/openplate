"""Score the non-recall metrics of the finished EU model-eval cells from their run files. Standard library only.

No model is called and no key is read: every answer is already in a `results.json`. The script computes, per cell
and family (plates, typed text, pantry, recipes):

  * call mechanics: HTTP status, schema validity (stored and re-validated), cost, latency, tokens, provider;
  * a kcal and carbs check against the USDA reference of `gold/gold_kcal_text.jsonl`;
  * brand behaviour and confidence calibration;
  * the pantry gold (names, units, amounts, categories);
  * the recipe gold constraints.

The kcal set (`k001` to `k034`) was never sent to a model, so no run holds an answer for those exact inputs. The
kcal check therefore runs on a hand-made overlap: typed cases of `gold_text.jsonl` that name the same food as a
kcal row (`KCAL_OVERLAP`). The report says so.

Usage, from `apps/inference/eval`:

    python3 -m harness.score_misc            # writes runs/EU-MISC-SCORING-2026-10-06.{md,json}

The exit code is 2 when a scored cell holds fewer than `EXPECTED_REPEATS` (3) typed repeats. The report is still
written, and says INCOMPLETE on its first lines.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import unicodedata
from collections import Counter
from pathlib import Path

from harness import schema_validate

EVAL_DIR = Path(__file__).resolve().parent.parent
RUNS = EVAL_DIR / "runs"
GOLD = EVAL_DIR / "gold"
CONTRACT = EVAL_DIR / "generated" / "vision-contract.json"
REPORT_NAME = "EU-MISC-SCORING-2026-10-06"

#: cell letter -> (label, suffix of the typed, pantry and recipe runs or None, plate directory)
CELLS = {
    "A": ("3.8 old prompt", None, "eu-cell-38-prod-oldprompt"),
    "B": ("3.8 default reasoning", "eu-cell-38-newprompt", "eu-cell-38-newprompt"),
    "C": ("3.8 minimal", "eu-cell-38-minimal-newprompt", "eu-cell-38-minimal-newprompt"),
    "D": ("3.5 lite EU minimal", "eu-cell-35-eu-newprompt", "eu-cell-35-eu-newprompt"),
    "E": ("3.5 lite EU old prompt", None, "eu-cell-35-eu-oldprompt"),
}
SCORED_CELLS = ("B", "C", "D")
SLOW_MS = 60_000
TYPED_CASES_PER_RUN = 91
#: The decision rule asks for three typed repeats per cell. Fewer is reported as INCOMPLETE, never as a pass.
EXPECTED_REPEATS = 3

# ---------------------------------------------------------------------------
# Small numeric helpers
# ---------------------------------------------------------------------------


def percentile(values: list[float], q: float) -> float | None:
    """Linear interpolation between closest ranks (q in 0..100), like numpy's default."""
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    position = (len(ordered) - 1) * q / 100
    low = math.floor(position)
    high = math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def is_error_record(record: dict) -> bool:
    """The runner's `{"error": ...}` for a call that raised: it has no `kind`, no answer and no HTTP status.

    It is a failed call. Every scorer counts it as one (an invalid answer, no parsed answer) instead of
    dropping it or reading it as an old-schema record."""
    return not record.get("kind") and bool(record.get("error"))


def record_of(entry) -> dict:
    """The call record inside one results.json entry (`{'production': rec}`, `{'baseline': rec}`, ...)."""
    if isinstance(entry, dict) and len(entry) == 1:
        inner = next(iter(entry.values()))
        if isinstance(inner, dict):
            return inner
    return entry if isinstance(entry, dict) else {}


def load_results(path: Path) -> dict[str, dict] | None:
    """case id -> record, or None when the file is missing."""
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return {key: record_of(value) for key, value in data.items() if not key.startswith("_")}


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def load_contract() -> dict:
    return json.loads(CONTRACT.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Call mechanics
# ---------------------------------------------------------------------------


def revalidate(record: dict, contract: dict) -> bool | None:
    """Strict re-validation of the raw content against the contract schema. None: the record has no task."""
    task = record.get("task")
    if task not in contract["tasks"]:
        return None
    content = record.get("raw_content")
    if not isinstance(content, str) or not content:
        return False
    try:
        answer = json.loads(content)
    except json.JSONDecodeError:
        return False
    return not schema_validate.validate(answer, contract["tasks"][task]["jsonSchema"])


def total_latency_ms(rec: dict) -> float | None:
    """What a person waited: every attempt and backoff. Older records hold only the last attempt."""
    for key in ("total_latency_ms", "latency_ms"):
        value = rec.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
    return None


def call_stats(labelled: list[tuple[str, dict]], contract: dict) -> dict:
    """Mechanics over labelled records ([(label, record)]), the label being 'r1:t001' or a plate id.

    A record with an `error` and no `kind` (a call that raised) counts as a production call that failed: it is in
    `schema_invalid_ids` and `error_ids`, never silently absent."""
    records = [rec for _, rec in labelled]
    production = [(label, rec) for label, rec in labelled if rec.get("kind") == "production"]
    errors = [(label, rec) for label, rec in labelled if is_error_record(rec)]
    called = production + errors
    statuses = Counter(rec.get("http_status") for _, rec in called)
    stored_valid = [label for label, rec in production if rec.get("schema_valid") is True]
    disagreements = []
    for label, rec in production:
        recomputed = revalidate(rec, contract)
        if recomputed is not None and recomputed != bool(rec.get("schema_valid")):
            disagreements.append(label)
    waits = [w / 1000 for w in (total_latency_ms(r) for r in records) if w is not None]
    last_attempts = [r["latency_ms"] / 1000 for r in records if isinstance(r.get("latency_ms"), (int, float))]
    costs = [r["cost_usd"] for r in records if isinstance(r.get("cost_usd"), (int, float))]
    return {
        "n": len(records),
        "production_records": len(production),
        "error_records": len(errors),
        "error_ids": [label for label, _ in errors],
        "http_status": {str(k): v for k, v in sorted(statuses.items(), key=lambda kv: str(kv[0]))},
        "schema_valid_stored": len(stored_valid),
        "schema_invalid_ids": [label for label, rec in production if rec.get("schema_valid") is not True]
        + [label for label, _ in errors],
        "old_schema_raw_ok": sum(1 for r in records if r.get("kind") != "production" and not is_error_record(r) and r.get("raw_ok")),
        "revalidation_disagreements": disagreements,
        "cost_total": sum(costs),
        "cost_calls": len(costs),
        "cost_mean": mean(costs),
        "cost_sources": dict(Counter(rec.get("cost_source") or "none" for _, rec in production if isinstance(rec.get("cost_usd"), (int, float)))),
        # A production call with no cost is not a free call. A failed call has none for a good reason; the ids
        # let a reader tell that apart from a successful answer that lost its usage block.
        "cost_null_ids": [label for label, rec in called if not isinstance(rec.get("cost_usd"), (int, float))],
        "latency_median": median(waits),
        "latency_p95": percentile(waits, 95),
        "latency_max": max(waits) if waits else None,
        "last_attempt_latency_median": median(last_attempts),
        "last_attempt_latency_p95": percentile(last_attempts, 95),
        "slow": [(label, round(w / 1000, 1)) for label, rec in labelled
                 if (w := total_latency_ms(rec)) is not None and w > SLOW_MS],
        "prompt_tokens_mean": mean([r["prompt_tokens"] for r in records if isinstance(r.get("prompt_tokens"), (int, float))]),
        "completion_tokens_mean": mean([r["completion_tokens"] for r in records if isinstance(r.get("completion_tokens"), (int, float))]),
        "reasoning_tokens_mean": mean([r["reasoning_tokens"] for r in records if isinstance(r.get("reasoning_tokens"), (int, float))]),
        "reasoning_tokens_recorded": sum(1 for r in records if isinstance(r.get("reasoning_tokens"), (int, float))),
        "providers": dict(Counter(rec.get("provider") for _, rec in called)),
        "models_returned": dict(Counter(r.get("model_returned") or r.get("model") for r in records)),
        "retried": [label for label, rec in labelled if (rec.get("attempts") or 1) > 1],
        "not_stop": {str(k): v for k, v in Counter(
            rec.get("finish_reason") for _, rec in called if rec.get("finish_reason") != "stop").items()},
        "not_stop_ids": [label for label, rec in called if rec.get("finish_reason") != "stop"],
    }


def food_answer_problems(labelled: list[tuple[str, dict]], expect_empty_ids: frozenset | set = frozenset()) -> dict:
    """Empty or `unreadable` answers on inputs that name food. A label is 'r1:t001' or 'plate 07'."""
    problems = {"empty": [], "unreadable": [], "no_answer": [], "empty_kept_empty": 0, "empty_expected_total": 0,
                "empty_expected_wrongly_filled": []}
    for label, rec in labelled:
        case_id = label.split(":")[-1]
        called = rec.get("kind") == "production" or is_error_record(rec)
        answer = rec.get("answer") if called else None
        foods = (answer or {}).get("foods") if called else rec.get("foods")
        if called and answer is None:
            problems["no_answer"].append(label)
            continue
        if case_id in expect_empty_ids:
            problems["empty_expected_total"] += 1
            if foods:
                problems["empty_expected_wrongly_filled"].append(label)
            else:
                problems["empty_kept_empty"] += 1
            continue
        if isinstance(answer, dict) and answer.get("unreadable") is True:
            problems["unreadable"].append(label)
        if not foods:
            problems["empty"].append(label)
    return problems


# ---------------------------------------------------------------------------
# Typed text: kcal and carbs against the USDA reference
# ---------------------------------------------------------------------------

#: typed gold case -> [(kcal row id, regex on the item's names)]. Hand-made: the kcal rows were never run.
#: A row maps only when the food and its preparation are the same. Cooked broccoli, baked salmon and the sandwiches
#: are left out on purpose. `KCAL_OVERLAP_NOTES` explains the looser ones. Word boundaries matter: "chocolate"
#: contains "cola".
KCAL_OVERLAP: dict[str, list[tuple[str, str]]] = {
    "t013": [("k003", r"\beggs?\b")],
    "t015": [("k004", r"\brice\b")],
    "t069": [("k004", r"\brice\b")],
    "t031": [("k030", r"\bmozzarella\b"), ("k032", r"\btomato")],
    "t056": [("k016", r"\bcheddar\b")],
    "t058": [("k008", r"\bmilk\b")],
    "t028": [("k006", r"\bbread\b")],
    "t017": [("k033", r"\b(cola|coke)\b")],
    "t085": [("k034", r"\bbeer\b")],
}
KCAL_OVERLAP_NOTES = {
    "t058": "pasteurised whole milk against 3.25 percent US milk (k008, medium)",
    "t028": "Weissbrot against US white sandwich bread (k006, medium)",
    "t017": "cola, per 100 ml against per 100 g (k033, medium)",
    "t085": "a small beer, per 100 ml against per 100 g (k034, medium)",
    "t031": "mozzarella reference is low-moisture US mozzarella (k030, low confidence)",
}

KCAL_TOLERANCE = 0.15
CARB_ABS_FLOOR_G = 1.0
CALIBRATION_THRESHOLD = 0.25


def item_label(item: dict) -> str:
    translations = item.get("translations") or {}
    return f"{item.get('name', '')} {translations.get('en', '')}".lower()


def signed_error_pct(model: float, reference: float) -> float | None:
    if reference == 0:
        return None
    return (model - reference) / reference * 100


def within_tolerance(model: float | None, reference: float, *, floor: float = 0.0, pct: float = KCAL_TOLERANCE) -> bool:
    """Within `pct` of the reference, or within `floor` absolute (a reference near zero has no meaningful percent)."""
    if model is None:
        return False
    return abs(model - reference) <= max(abs(reference) * pct, floor)


def _number_or_none(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def combine_items(items: list[dict]) -> dict:
    """One macros-per-100 g view of the model items that name the same food.

    A model that splits one food into two items (the white and the yolk of an egg, rice and its sauce) gives two
    per-100 g rows. Taking the first would score half the food. The items are combined into one row, weighted by
    `estimatedGrams`, which is the same as summing their kcal and grams and dividing again. When an item has no
    usable grams the plain mean stands in. When any item holds no number for a nutrient, that nutrient is None:
    a missing value never drops out of the sum.

    Returns {"name", "n_items", "split", "kcal", "carbs", "fiber", "confidence", "weighting"}. With one item the
    values are that item's own and nothing is averaged."""
    macros = [(f.get("macrosPer100g") or {}) for f in items]
    first = items[0] if items else {}
    out = {"name": " + ".join(str(f.get("name")) for f in items) if items else None, "n_items": len(items),
           "split": len(items) > 1, "confidence": first.get("confidence") if len(items) == 1 else _lowest_confidence(items),
           "weighting": "single"}
    if len(items) == 1:
        out.update(kcal=macros[0].get("kcal"), carbs=macros[0].get("carbs"), fiber=macros[0].get("fiber"))
        return out
    grams = [_number_or_none(f.get("estimatedGrams")) for f in items]
    weighted = all(g is not None and g > 0 for g in grams)
    weights = grams if weighted else [1.0] * len(items)
    out["weighting"] = "grams" if weighted else "mean"
    for key in ("kcal", "carbs", "fiber"):
        values = [_number_or_none(m.get(key)) for m in macros]
        if not items or any(v is None for v in values):
            out[key] = None
        else:
            out[key] = sum(v * w for v, w in zip(values, weights)) / sum(weights)
    return out


def _lowest_confidence(items: list[dict]) -> str | None:
    """The weakest rating among combined items: a split food is only as sure as its least sure part."""
    order = {"low": 0, "medium": 1, "high": 2}
    rated = [f.get("confidence") for f in items if f.get("confidence") in order]
    return min(rated, key=order.get) if rated else None


def kcal_comparisons(label: str, case_id: str, answer: dict | None, kcal_rows: dict[str, dict]) -> list[dict]:
    """One comparison per mapped kcal row of this typed case. `matched` is False when the model has no such item.

    Every item that matches the row's pattern is combined (`combine_items`), so a food split in two is scored whole."""
    out = []
    foods = (answer or {}).get("foods") or []
    for row_id, pattern in KCAL_OVERLAP.get(case_id, []):
        row = kcal_rows[row_id]
        items = [f for f in foods if re.search(pattern, item_label(f))]
        combined = combine_items(items)
        kcal, carbs = combined.get("kcal"), combined.get("carbs")
        ref_kcal, ref_carbs = row["reference"]["kcal_per_100g"], row["reference"]["carbs_per_100g"]
        out.append({
            "label": label, "case": case_id, "row": row_id, "item": combined["name"],
            "matched": bool(items), "split": combined["split"], "n_matched_items": combined["n_items"],
            "confidence": combined["confidence"],
            "ref_confidence": row["reference_confidence"],
            "ref_kcal": ref_kcal, "kcal": kcal,
            "kcal_err_pct": signed_error_pct(kcal, ref_kcal) if isinstance(kcal, (int, float)) else None,
            "kcal_ok": within_tolerance(kcal, ref_kcal),
            "ref_carbs": ref_carbs, "carbs": carbs,
            "carbs_err_pct": signed_error_pct(carbs, ref_carbs) if isinstance(carbs, (int, float)) else None,
            "carbs_ok": within_tolerance(carbs, ref_carbs, floor=CARB_ABS_FLOOR_G),
        })
    return out


def summarise_kcal(rows: list[dict], key: str) -> dict:
    """key is 'kcal' or 'carbs'. Unmatched items count as not within tolerance and are reported on their own.

    `n` is the sample size (the rows compared). `split` counts the rows where the model split the food into two
    or more items and the numbers are a combination of them."""
    matched = [r for r in rows if r["matched"]]
    with_value = [r for r in matched if isinstance(r[key], (int, float))]
    errors = [r[f"{key}_err_pct"] for r in with_value if r[f"{key}_err_pct"] is not None]
    return {
        "n": len(rows), "compared": len(rows), "matched": len(matched), "null_value": len(matched) - len(with_value),
        "split": sum(1 for r in matched if r.get("split")),
        "within": sum(1 for r in matched if r[f"{key}_ok"]),
        "median_signed_err_pct": median(errors),
        "worst": sorted(
            (r for r in with_value if r[f"{key}_err_pct"] is not None),
            key=lambda r: abs(r[f"{key}_err_pct"]), reverse=True)[:5],
    }


def kcal_gold_comparison(label: str, row: dict, answer: dict | None) -> dict:
    """One comparison for a kcal gold row (`k001`..`k034`) that was sent to a model as its own typed case.

    The row names one food. The answer's item is its only item; with several items, every item whose names
    share a word with the row's `item`, combined into one (`combine_items`, so a food split in two is scored
    whole and `split` is True); with none, `matched` is False and the row counts as outside tolerance."""
    foods = (answer or {}).get("foods") or []
    if len(foods) == 1:
        items = list(foods)
    else:
        words = set(tokens(row["item"]))
        items = [f for f in foods if words & set(tokens(item_label(f)))]
    combined = combine_items(items)
    kcal, carbs = combined.get("kcal"), combined.get("carbs")
    ref_kcal, ref_carbs = row["reference"]["kcal_per_100g"], row["reference"]["carbs_per_100g"]
    return {
        "label": label, "case": row["id"], "row": row["id"], "input": row["input"], "item": combined["name"],
        "n_items": len(foods), "matched": bool(items), "split": combined["split"], "n_matched_items": combined["n_items"],
        "combine_weighting": combined["weighting"] if combined["split"] else None,
        "confidence": combined["confidence"],
        "ref_confidence": row["reference_confidence"],
        "ref_kcal": ref_kcal, "kcal": kcal,
        "kcal_err_pct": signed_error_pct(kcal, ref_kcal) if isinstance(kcal, (int, float)) else None,
        "kcal_ok": within_tolerance(kcal, ref_kcal),
        "ref_carbs": ref_carbs, "carbs": carbs,
        "carbs_err_pct": signed_error_pct(carbs, ref_carbs) if isinstance(carbs, (int, float)) else None,
        "carbs_ok": within_tolerance(carbs, ref_carbs, floor=CARB_ABS_FLOOR_G),
        "fiber": combined.get("fiber"), "ref_fiber": row["reference"].get("fiber_per_100g"),
    }


def calibration(rows: list[dict]) -> dict:
    """Of the items whose kcal is more than 25 percent off, how many were rated high."""
    wrong = [r for r in rows if r["matched"] and r["kcal_err_pct"] is not None
             and abs(r["kcal_err_pct"]) > CALIBRATION_THRESHOLD * 100]
    return {"wrong": len(wrong), "wrong_rated_high": sum(1 for r in wrong if r["confidence"] == "high"),
            "ids": [f"{r['label']} {r['item']} ({r['kcal_err_pct']:+.0f}%, {r['confidence']})" for r in wrong]}


# ---------------------------------------------------------------------------
# Brand behaviour on the typed gold
# ---------------------------------------------------------------------------

BRAND_ITEM_PATTERNS = {"t017": r"snickers", "t028": r"nutella", "t057": r"cream cheese|philadelphia",
                       "t061": r"big mac", "t076": r"macchiato|starbucks"}


def brand_checks(label: str, case: dict, answer: dict | None) -> dict | None:
    """Confidence and brand field of the brand item of one typed case (cases with `expect_brand`)."""
    pattern = BRAND_ITEM_PATTERNS.get(case["id"])
    if not pattern or not case.get("expect_brand"):
        return None
    expected_brand = next(iter(case["expect_brand"].values()))
    expected_conf = next(iter((case.get("expect_confidence") or {}).values()), None)
    foods = (answer or {}).get("foods") or []
    item = next((f for f in foods if re.search(pattern, item_label(f) + " " + str(f.get("brand") or "").lower())), None)
    if item is None:
        return {"label": label, "case": case["id"], "found": False, "expected_conf": expected_conf}
    brand = item.get("brand") or ""
    return {"label": label, "case": case["id"], "found": True, "confidence": item.get("confidence"),
            "expected_conf": expected_conf, "brand": brand,
            "brand_ok": expected_brand.lower() in brand.lower(), "macro_source": item.get("macroSource")}


VAGUE_ITEM_PATTERNS = {"t034": r"\bbar\b|riegel", "t035": r"cheese|k[aä]se", "t071": r"curry"}


def vague_checks(label: str, case: dict, answer: dict | None) -> dict | None:
    """Confidence of the vague item in a typed case where gold expects `low` and names no brand (t034, t035, t071)."""
    pattern = VAGUE_ITEM_PATTERNS.get(case["id"])
    if not pattern or case.get("expect_brand"):
        return None
    foods = (answer or {}).get("foods") or []
    item = next((f for f in foods if re.search(pattern, item_label(f))), None)
    return {"label": label, "case": case["id"], "found": item is not None, "confidence": (item or {}).get("confidence")}


def confidence_mix(answers: list[dict | None]) -> dict:
    """Share of every food item in the answers by its confidence rating."""
    counts = Counter(f.get("confidence") for a in answers for f in ((a or {}).get("foods") or []))
    total = sum(counts.values())
    return {"items": total, **{k: counts.get(k, 0) for k in ("high", "medium", "low")}}


# ---------------------------------------------------------------------------
# Name matching shared by the pantry and recipe checks
# ---------------------------------------------------------------------------

STOPWORDS = frozenset({"of", "the", "a", "an", "and", "with", "in", "de", "del", "di", "la", "le", "les", "des",
                       "du", "und", "mit", "con", "en", "el", "al", "bir"})


def norm(text: str) -> str:
    text = (text or "").lower().replace("ß", "ss")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("ı", "i")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def tokens(text: str) -> list[str]:
    return [t for t in norm(text).split() if t not in STOPWORDS]


def token_match(a: str, b: str) -> bool:
    if a == b:
        return True
    short, long_ = sorted((a, b), key=len)
    if len(short) < 3:
        return False
    return long_.startswith(short) or (len(short) >= 4 and short in long_)


def name_match(a: str, b: str) -> bool:
    """Every token of the name with fewer tokens has a matching token in the other name."""
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return False
    small, large = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    return all(any(token_match(s, l) for l in large) for s in small)


# ---------------------------------------------------------------------------
# Pantry
# ---------------------------------------------------------------------------

PANTRY_CATEGORIES = frozenset({"produce", "dairy", "meat", "fish", "egg", "grain", "legume", "nut", "condiment",
                               "beverage", "other"})
PANTRY_UNITS = frozenset({"g", "ml", "piece", "pack"})


def amount_options(expected: dict) -> list[tuple]:
    options = [(expected.get("amount"), expected.get("unit"))]
    options += [tuple(pair) for pair in expected.get("accept", [])]
    return options


def same_amount(a, b) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(float(a) - float(b)) < 1e-6


def check_pantry_case(case: dict, answer: dict | None) -> dict:
    """Failures of one pantry answer against its gold row. An empty `failures` list is a pass.

    kinds: no_answer, missing_item, wrong_amount_unit, amount_not_null, low_confidence_missing, forbidden_item,
    not_empty, bad_category, bad_unit (the last two cannot happen in a schema-valid answer; checked anyway).
    """
    if answer is None:
        return {"failures": [("no_answer", "no parsed answer")], "extras": []}
    items = answer.get("items") or []
    failures: list[tuple[str, str]] = []
    used: set[int] = set()
    for item in items:
        if item.get("category") not in PANTRY_CATEGORIES:
            failures.append(("bad_category", f"{item.get('name')}: {item.get('category')!r}"))
        if item.get("unit") is not None and item.get("unit") not in PANTRY_UNITS:
            failures.append(("bad_unit", f"{item.get('name')}: {item.get('unit')!r}"))
    if case.get("expect_empty") and items:
        failures.append(("not_empty", ", ".join(i.get("name", "?") for i in items)))
    for expected in case.get("expect_items", []):
        match_index = None
        for index, item in enumerate(items):
            if index in used:
                continue
            translations = (item.get("translations") or {}).get("en", "")
            if name_match(expected["name"], translations) or name_match(expected["name"], item.get("name", "")):
                match_index = index
                break
        if match_index is None:
            failures.append(("missing_item", expected["name"]))
            continue
        used.add(match_index)
        item = items[match_index]
        got = (item.get("amount"), item.get("unit"))
        if not any(same_amount(got[0], amount) and got[1] == unit for amount, unit in amount_options(expected)):
            kind = "amount_not_null" if expected.get("amount") is None else "wrong_amount_unit"
            failures.append((kind, f"{expected['name']}: got {got}, want {amount_options(expected)}"))
        if expected.get("expect_confidence") and item.get("confidence") != expected["expect_confidence"]:
            failures.append(("low_confidence_missing", f"{expected['name']}: {item.get('confidence')}"))
    for forbidden in case.get("must_not_items", []):
        stripped = re.sub(r"\(.*?\)", "", forbidden).strip()
        for item in items:
            translations = (item.get("translations") or {}).get("en", "")
            exact = norm(translations) == norm(stripped) or norm(item.get("name", "")) == norm(stripped)
            fuzzy = stripped == forbidden and (name_match(forbidden, translations) or name_match(forbidden, item.get("name", "")))
            if exact or fuzzy:
                failures.append(("forbidden_item", forbidden))
    extras = [item.get("name") for index, item in enumerate(items) if index not in used]
    return {"failures": failures, "extras": extras}


# ---------------------------------------------------------------------------
# Recipes
# ---------------------------------------------------------------------------

#: Staples the prompt names, in the six app languages. Short words need an exact token; long ones match inside a word.
STAPLE_EXACT = frozenset({"ol", "sel", "sale", "sal", "pepe", "su", "eau", "tuz", "oel", "erbe", "thym"})
STAPLE_CONTAINS = (
    "oil", "huile", "olio", "aceite", "olivenol", "speiseol", "rapsol", "pflanzenol", "zeytinyag", "yag",
    "butter", "beurre", "burro", "mantequilla", "tereyag",
    "salt", "salz", "tuz", "pepper", "pfeffer", "poivre", "pimienta", "karabiber",
    "vinegar", "essig", "vinaigre", "aceto", "vinagre", "sirke",
    "water", "wasser", "acqua", "agua",
    "herb", "kraut", "krauter", "herbes", "hierbas", "spice", "gewurz", "epice", "spezie", "especia", "baharat",
    "cumin", "kreuzkummel", "kumin", "kimyon", "oregano", "thyme", "timo", "rosemary", "rosmarin", "romero",
    "paprikapulver", "paprika powder", "zimt", "cinnamon", "canela", "cannelle", "curry", "chili", "chilli",
    "kurkuma", "turmeric", "muskat", "nutmeg", "lorbeer", "bay leaf", "pimenton", "cumino", "origano", "kekik",
    "pul biber", "nane",
)


def is_staple(name: str) -> bool:
    text = norm(name)
    if any(token in STAPLE_EXACT for token in text.split()):
        return True
    return any(stem in text for stem in STAPLE_CONTAINS)


def pantry_match(name: str, pantry: list[dict]) -> dict | None:
    return next((p for p in pantry if name_match(name, p["name"])), None)


def check_recipe_answer(case: dict, answer: dict | None) -> dict:
    """Constraint violations of one recipe answer. Returns the recipes shown and the violations as (kind, detail).

    kinds: no_answer, recipe_count, serving_grams (the app drops such a recipe, so it is not 'shown'),
    amount_unit_not_null_together, from_pantry_true_not_on_shelf, from_pantry_false_on_shelf,
    from_pantry_false_not_staple, exceeds_pantry_amount, over_kcal_budget, over_carb_budget,
    per_serving_inconsistent.
    """
    if answer is None:
        return {"raw": 0, "shown": 0, "violations": [("no_answer", "no parsed answer")]}
    checks = case["checks"]
    pantry = case["pantry"]
    recipes = answer.get("recipes") or []
    violations: list[tuple[str, str]] = []
    if not checks["recipes_min"] <= len(recipes) <= checks["recipes_max"]:
        violations.append(("recipe_count", f"{len(recipes)} recipes"))
    shown = 0
    for recipe in recipes:
        title = recipe.get("title", "?")
        grams = recipe.get("servingGrams")
        if isinstance(grams, (int, float)) and checks["serving_grams_min"] <= grams <= checks["serving_grams_max"]:
            shown += 1
        else:
            violations.append(("serving_grams", f"{title}: {grams}"))
        for ing in recipe.get("ingredients") or []:
            name, amount, unit, from_pantry = ing.get("name", ""), ing.get("amount"), ing.get("unit"), ing.get("fromPantry")
            if (amount is None) != (unit is None):
                violations.append(("amount_unit_not_null_together", f"{title}: {name} {amount} {unit}"))
            on_shelf = pantry_match(name, pantry)
            if from_pantry is True:
                if on_shelf is None:
                    violations.append(("from_pantry_true_not_on_shelf", f"{title}: {name}"))
                elif (amount is not None and on_shelf.get("amount") is not None and unit == on_shelf.get("unit")
                      and amount > on_shelf["amount"] + 1e-9):
                    violations.append(("exceeds_pantry_amount",
                                       f"{title}: {name} {amount} {unit} > {on_shelf['amount']} {on_shelf['unit']}"))
            elif from_pantry is False:
                if is_staple(name):
                    continue
                if on_shelf is not None:
                    violations.append(("from_pantry_false_on_shelf", f"{title}: {name}"))
                else:
                    violations.append(("from_pantry_false_not_staple", f"{title}: {name}"))
        per = recipe.get("perServing") or {}
        kcal, carbs, protein, fat = (per.get(k) for k in ("kcal", "carbsG", "proteinG", "fatG"))
        if checks.get("max_kcal_per_serving") is not None and isinstance(kcal, (int, float)) \
                and kcal > checks["max_kcal_per_serving"]:
            violations.append(("over_kcal_budget", f"{title}: {kcal} > {checks['max_kcal_per_serving']}"))
        if checks.get("max_net_carbs_g_per_serving") is not None and isinstance(carbs, (int, float)) \
                and carbs > checks["max_net_carbs_g_per_serving"]:
            violations.append(("over_carb_budget", f"{title}: {carbs} > {checks['max_net_carbs_g_per_serving']}"))
        if all(isinstance(v, (int, float)) for v in (kcal, carbs, protein, fat)):
            computed = 4 * carbs + 4 * protein + 9 * fat
            if computed <= 0 or abs(kcal - computed) > 0.2 * computed:
                violations.append(("per_serving_inconsistent", f"{title}: kcal {kcal} vs {computed:.0f}"))
    return {"raw": len(recipes), "shown": shown, "violations": violations}


# ---------------------------------------------------------------------------
# Gathering the runs
# ---------------------------------------------------------------------------


def typed_runs(cell_suffix: str, expected_ids: set[str] | frozenset[str] | None = None,
               runs_dir: Path | None = None) -> tuple[dict[str, dict[str, dict]], list[str]]:
    """repeat label -> {case id -> record}, and notes on the repeats left out.

    A repeat is incomplete only when case ids are missing (`expected_ids`, or the count `TYPED_CASES_PER_RUN`
    when no ids are given). A record that is an `{"error": ...}` (a call that raised, with no `kind`) is an
    answer slot like any other: it stays in the repeat and the scorers count it as a failed call. Dropping the
    whole repeat for it would score a run with errors as a smaller, cleaner one."""
    runs, notes = {}, []
    for repeat in (1, 2, 3):
        path = (runs_dir or RUNS) / f"text-{cell_suffix}-r{repeat}" / "results.json"
        results = load_results(path)
        if results is None:
            notes.append(f"r{repeat}: no results.json, left out.")
            continue
        if expected_ids is not None:
            missing = sorted(set(expected_ids) - set(results))
            incomplete = bool(missing)
            detail = f"{len(missing)} case id(s) missing ({', '.join(missing[:5])}{', ...' if len(missing) > 5 else ''})"
        else:
            incomplete = len(results) != TYPED_CASES_PER_RUN
            detail = f"{len(results)} answers, not {TYPED_CASES_PER_RUN}"
        if incomplete:
            notes.append(f"r{repeat}: {detail}, left out (still running).")
            continue
        runs[f"r{repeat}"] = results
        failed = [cid for cid, rec in results.items() if is_error_record(rec)]
        if failed:
            notes.append(f"r{repeat}: {len(failed)} call(s) failed with an error and are counted as invalid ({', '.join(sorted(failed)[:5])}).")
    return runs, notes


def gather(contract: dict, runs_dir: Path | None = None) -> dict:
    text_gold = {c["id"]: c for c in load_jsonl(GOLD / "gold_text.jsonl")}
    kcal_rows = {c["id"]: c for c in load_jsonl(GOLD / "gold_kcal_text.jsonl")}
    pantry_gold = {c["id"]: c for c in load_jsonl(GOLD / "gold_pantry.jsonl")}
    recipe_gold = {c["id"]: c for c in load_jsonl(GOLD / "gold_recipes.jsonl")}
    expect_empty = {cid for cid, c in text_gold.items() if c.get("expect_empty")}
    runs_dir = runs_dir or RUNS
    out: dict = {"cells": {}, "notes": {}, "incomplete": [], "expected_repeats": EXPECTED_REPEATS}
    for letter, (label, suffix, plate_dir) in CELLS.items():
        cell: dict = {"label": label}
        plates = load_results(runs_dir / plate_dir / "results.json")
        plates_labelled = [(f"plate {k}", r) for k, r in sorted((plates or {}).items())]
        cell["plates"] = {**call_stats(plates_labelled, contract), "food": food_answer_problems(plates_labelled)}
        if suffix is not None:
            runs, notes = typed_runs(suffix, set(text_gold), runs_dir)
            out["notes"][letter] = notes
            if len(runs) < EXPECTED_REPEATS:
                out["incomplete"].append(f"cell {letter} ({label}) scored {len(runs)} of {EXPECTED_REPEATS} typed repeats")
            labelled = [(f"{rep}:{cid}", rec) for rep, res in runs.items() for cid, rec in sorted(res.items())]
            cell["typed"] = {**call_stats(labelled, contract), "repeats": list(runs),
                             "per_repeat_valid": {rep: sum(1 for r in res.values() if r.get("schema_valid") is True)
                                                  for rep, res in runs.items()},
                             "food": food_answer_problems(labelled, expect_empty)}
            kcal_rows_out, brands, vague = [], [], []
            for rep, res in runs.items():
                for cid, rec in sorted(res.items()):
                    answer = rec.get("answer")
                    kcal_rows_out += kcal_comparisons(f"{rep}:{cid}", cid, answer, kcal_rows)
                    brand = brand_checks(f"{rep}:{cid}", text_gold[cid], answer)
                    if brand:
                        brands.append(brand)
                    vague_item = vague_checks(f"{rep}:{cid}", text_gold[cid], answer)
                    if vague_item:
                        vague.append(vague_item)
            cell["kcal"] = {"rows": kcal_rows_out, "kcal": summarise_kcal(kcal_rows_out, "kcal"),
                            "carbs": summarise_kcal(kcal_rows_out, "carbs"), "calibration": calibration(kcal_rows_out)}
            cell["brands"] = brands
            cell["vague"] = vague
            cell["confidence_mix"] = confidence_mix([rec.get("answer") for res in runs.values() for rec in res.values()])
            pantry = load_results(runs_dir / f"pantry-{suffix}" / "results.json") or {}
            cell["pantry_stats"] = call_stats([(k, r) for k, r in sorted(pantry.items())], contract)
            cell["pantry"] = {cid: check_pantry_case(pantry_gold[cid], pantry[cid].get("answer"))
                              for cid in sorted(pantry)}
            recipes = load_results(runs_dir / f"recipe-{suffix}" / "results.json") or {}
            cell["recipe_stats"] = call_stats([(k, r) for k, r in sorted(recipes.items())], contract)
            cell["recipes"] = {cid: check_recipe_answer(recipe_gold[cid], recipes[cid].get("answer"))
                               for cid in sorted(recipes)}
        out["cells"][letter] = cell
    return out


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


def fmt(value, digits=2, unit=""):
    return "n/a" if value is None else f"{value:.{digits}f}{unit}"


def money(value, digits=4):
    return "n/a" if value is None else f"${value:.{digits}f}"


def table(header: list[str], rows: list[list]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    lines += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join(lines)


FAMILY_TITLE = {"plates": "plates (50)", "typed": "typed text", "pantry": "pantry (10)", "recipes": "recipes (10)"}
FAMILY_KEY = {"plates": "plates", "typed": "typed", "pantry": "pantry_stats", "recipes": "recipe_stats"}


def cell_name(letter: str) -> str:
    return f"{letter} {CELLS[letter][0]}"


def mechanics_rows(data: dict) -> list[tuple[str, str, dict]]:
    rows = []
    for family in FAMILY_TITLE:
        cells = tuple(CELLS) if family == "plates" else SCORED_CELLS
        rows += [(family, c, data["cells"][c][FAMILY_KEY[family]]) for c in cells]
    return rows


def cost_null_text(s: dict) -> str:
    ids = s["cost_null_ids"]
    return "0" if not ids else f"{len(ids)} ({', '.join(ids[:6])}{', ...' if len(ids) > 6 else ''})"


def not_stop_text(s: dict) -> str:
    if not s["not_stop_ids"]:
        return "0"
    counts = ", ".join(f"{k}: {v}" for k, v in s["not_stop"].items())
    return f"{counts} ({', '.join(s['not_stop_ids'][:6])})"


def completeness_line(data: dict) -> str:
    """One line that says whether every scored cell holds the expected typed repeats. A short cell is INCOMPLETE."""
    if data.get("incomplete"):
        return (f"**Verdict: INCOMPLETE.** The decision rule needs {data['expected_repeats']} typed repeats per cell. "
                + "; ".join(data["incomplete"]) + ". Read no number below as a result for those cells.")
    return f"Typed repeats: complete, {data['expected_repeats']} of {data['expected_repeats']} in every scored cell."


def render(data: dict) -> str:
    mech = mechanics_rows(data)
    out = ["# EU switch, non-recall metrics: cost, validity, kcal, pantry and recipes (2026-10-06)", ""]
    out.append("Scored from the finished run files by `harness/score_misc.py`. No model was called. Cells: A and E are the "
               "OLD-schema plate runs (cost and latency only), B is 3.8 with default reasoning, C is 3.8 minimal, D is 3.5 "
               "flash lite on the EU host, minimal. Typed text pools the repeats listed below. Cost for A and E is the "
               "harness price-table estimate, for B, C and D it is `usage.cost` from OpenRouter.")
    out.append("")
    out.append("Typed repeats included: " + "; ".join(
        f"{cell_name(c)}: {', '.join(data['cells'][c]['typed']['repeats']) or 'none'} ({data['cells'][c]['typed']['n']} calls)"
        for c in SCORED_CELLS) + ". " + " ".join(n for c in SCORED_CELLS for n in data["notes"].get(c, [])))
    out.append("")
    out.append(completeness_line(data))
    out.append("")

    out += ["## 1. HTTP status", "", table(
        ["family", "cell", "calls", "HTTP status counts", "retried calls", "finish_reason not stop"],
        [[FAMILY_TITLE[f], cell_name(c), s["n"],
          ", ".join(f"{k}: {v}" for k, v in s["http_status"].items()) or "n/a (old approach)",
          ", ".join(s["retried"]) or "0", not_stop_text(s)] for f, c, s in mech]), ""]

    out += ["## 2. Schema validity", "",
            "`stored` is the `schema_valid` the run wrote. The disagreement column counts calls where a fresh strict parse "
            "of `raw_content` against `generated/vision-contract.json` (`harness.schema_validate`) gives a different "
            "answer. A and E hold no `schema_valid` (old schema), their count is `raw_ok`.", "", table(
        ["family", "cell", "calls", "stored valid", "re-validation disagreements", "invalid ids"],
        [[FAMILY_TITLE[f], cell_name(c), s["n"],
          f"{s['schema_valid_stored']}/{s['production_records'] + s['error_records']}"
          + (f" ({s['error_records']} call(s) raised an error)" if s["error_records"] else "") if s["production_records"]
          else f"{s['old_schema_raw_ok']}/{s['n']} raw_ok",
          ", ".join(s["revalidation_disagreements"]) or ("0" if s["production_records"] else "n/a"),
          ", ".join(s["schema_invalid_ids"]) or "none"] for f, c, s in mech]), ""]

    rows = []
    for letter in CELLS:
        p = data["cells"][letter]["plates"]["food"]
        rows.append(["plates (50)", cell_name(letter), ", ".join(p["empty"]) or "none", ", ".join(p["unreadable"]) or "none",
                     ", ".join(p["no_answer"]) or "none", "n/a"])
    for letter in SCORED_CELLS:
        p = data["cells"][letter]["typed"]["food"]
        filled = f" (filled: {', '.join(p['empty_expected_wrongly_filled'])})" if p["empty_expected_wrongly_filled"] else ""
        rows.append(["typed text", cell_name(letter), ", ".join(p["empty"]) or "none", ", ".join(p["unreadable"]) or "none",
                     ", ".join(p["no_answer"]) or "none", f"{p['empty_kept_empty']}/{p['empty_expected_total']} kept empty{filled}"])
    out += ["## 3. Empty or `unreadable` answers on food inputs", "",
            "Typed cases t033 and t070 name no food, so an empty list is right there; the last column scores them. "
            "Labels are repeat:case. 'No parsed answer' lists calls with no valid JSON (nothing to judge).", "",
            table(["family", "cell", "empty `foods`", "`unreadable` true", "no parsed answer", "no-food cases"], rows), ""]

    out += ["## 4. Cost", "",
            "`calls with cost` is the number of calls that have a cost; the mean is over those calls only, so a call "
            "with no cost never lowers it. Source `usage` is the cost OpenRouter reported, `price_table` is tokens "
            "times the config price, used when the reply carried no `usage.cost`. A production call with no cost at "
            "all is listed under `no cost`; a failed call has none for a good reason, a call that answered does not.",
            "", table(
        ["family", "cell", "calls", "calls with cost", "total cost", "mean per costed call", "cost source", "no cost"],
        [[FAMILY_TITLE[f], cell_name(c), s["n"], s["cost_calls"], money(s["cost_total"]), money(s["cost_mean"], 5),
          ", ".join(f"{k}: {v}" for k, v in s["cost_sources"].items()) or "n/a",
          cost_null_text(s)] for f, c, s in mech]), ""]

    out += ["## 5. Latency (seconds, wall clock from bluefin)", "",
            "The first three columns are the wait a person has: every attempt and every backoff sleep of a call "
            "(`total_latency_ms`). The last attempt alone, the older number, is in the next two columns. A record "
            "written before `total_latency_ms` existed has only the last attempt, so its wait reads the same in both.",
            "", table(
        ["family", "cell", "wait median", "wait p95", "wait max", "last attempt median", "last attempt p95", "calls above 60 s"],
        [[FAMILY_TITLE[f], cell_name(c), fmt(s["latency_median"], 1), fmt(s["latency_p95"], 1), fmt(s["latency_max"], 1),
          fmt(s["last_attempt_latency_median"], 1), fmt(s["last_attempt_latency_p95"], 1),
          ", ".join(f"{l} ({v} s)" for l, v in s["slow"]) or "none"] for f, c, s in mech]), ""]

    out += ["## 6. Tokens per call (means)", "", "Reasoning tokens are the mean over the calls that recorded the field "
            "(old-schema A and E record none).", "", table(
        ["family", "cell", "prompt", "completion", "reasoning"],
        [[FAMILY_TITLE[f], cell_name(c), fmt(s["prompt_tokens_mean"], 0), fmt(s["completion_tokens_mean"], 0),
          fmt(s["reasoning_tokens_mean"], 0) if s["reasoning_tokens_recorded"] else "not recorded"] for f, c, s in mech]), ""]

    out += ["## 7. Provider returned", "", table(
        ["family", "cell", "provider (calls)", "model returned (calls)"],
        [[FAMILY_TITLE[f], cell_name(c),
          ", ".join(f"{k}: {v}" for k, v in s["providers"].items()) or "not recorded",
          ", ".join(f"{k}: {v}" for k, v in s["models_returned"].items())] for f, c, s in mech]), ""]

    out += render_kcal(data)
    out += render_brand(data)
    out += render_pantry(data)
    out += render_recipes(data)
    return "\n".join(out)


def render_kcal(data: dict) -> list[str]:
    n_places = sum(len(v) for v in KCAL_OVERLAP.values())
    out = ["## 8. kcal and carbs per 100 g against USDA", "",
           "**The 34 rows of `gold_kcal_text.jsonl` were never sent to a model, so no run holds an answer for them.** "
           "`harness.production.load_cases` reads that file as a text case file, so scoring them takes 34 calls per cell. "
           f"This section is a proxy: it uses the {n_places} places where a typed gold case names the same food as a kcal row "
           f"({', '.join(sorted(KCAL_OVERLAP))}), once per repeat. It compares per 100 g, so stated grams cancel out. "
           "Tolerance is plus or minus 15 percent; for carbs a value within 1 g also passes, because a reference near zero "
           "has no useful percent. The USDA carbs figure includes fibre and the app asks for total carbs on estimates, so they "
           "compare directly. Looser mappings: " + "; ".join(KCAL_OVERLAP_NOTES.values()) + ".", ""]
    for key, title in (("kcal", "kcal per 100 g"), ("carbs", "carbs per 100 g")):
        rows = []
        for letter in SCORED_CELLS:
            rr = data["cells"][letter]["kcal"]["rows"]
            scopes = (("all references", rr), ("reference confidence low", [r for r in rr if r["ref_confidence"] == "low"]),
                      ("high and medium only", [r for r in rr if r["ref_confidence"] != "low"]))
            for scope, subset in scopes:
                s = summarise_kcal(subset, key)
                share = f" ({100 * s['within'] / s['compared']:.0f}%)" if s["compared"] else ""
                rows.append([cell_name(letter), scope, s["n"], s["matched"], s["split"], f"{s['within']}/{s['compared']}{share}",
                             fmt(s["median_signed_err_pct"], 1, "%"), s["null_value"]])
        out += [f"### {title}", "", table(
            ["cell", "scope", "n", "item found", "split into 2+ items", "within tolerance", "median signed error", "null value"], rows), ""]
    for key in ("kcal", "carbs"):
        rows = []
        for letter in SCORED_CELLS:
            for r in data["cells"][letter]["kcal"][key]["worst"]:
                rows.append([cell_name(letter), r["label"], f"{r['row']} {r['item']}", r[key], r[f"ref_{key}"],
                             f"{r[f'{key}_err_pct']:+.0f}%", r["confidence"], r["ref_confidence"]])
        out += [f"### Five worst per cell, {key}", "", table(
            ["cell", "repeat:case", "row and item", "model", "reference", "error", "model confidence", "reference confidence"],
            rows), ""]
    return out


def render_brand(data: dict) -> list[str]:
    rows = []
    for letter in SCORED_CELLS:
        brands = data["cells"][letter]["brands"]
        low = [b for b in brands if b.get("expected_conf") == "low"]
        found = [b for b in brands if b["found"]]
        rows.append([cell_name(letter), len(brands), len(found),
                     f"{sum(1 for b in found if b['confidence'] == 'high')}/{len(found)}",
                     f"{sum(1 for b in low if b.get('found') and b['confidence'] == 'high')}/{len(low)}",
                     f"{sum(1 for b in found if b['brand_ok'])}/{len(found)}",
                     ", ".join(f"{b['label']}" for b in found if b["confidence"] == "high") or "none"])
    vague_rows = []
    for letter in SCORED_CELLS:
        cell = data["cells"][letter]
        found = [v for v in cell["vague"] if v["found"]]
        mix = cell["confidence_mix"]
        vague_rows.append([cell_name(letter), f"{sum(1 for v in found if v['confidence'] == 'low')}/{len(cell['vague'])}",
                           ", ".join(f"{v['label']} {v['confidence']}" for v in found if v["confidence"] != "low") or "none",
                           mix["items"], *(f"{100 * mix[k] / mix['items']:.0f}%" if mix["items"] else "n/a" for k in ("high", "medium", "low"))])
    cal = []
    for letter in SCORED_CELLS:
        c = data["cells"][letter]["kcal"]["calibration"]
        share = f"{100 * c['wrong_rated_high'] / c['wrong']:.0f}%" if c["wrong"] else "n/a"
        cal.append([cell_name(letter), c["wrong"], c["wrong_rated_high"], share, "; ".join(c["ids"]) or "none"])
    return ["## 9. Brand behaviour on the typed gold", "",
            "Brand cases: t017 Snickers, t028 Nutella, t057 Philadelphia, t061 Big Mac, t076 Starbucks (the five with "
            "`expect_brand`), times the repeats. The prompt asks for LOW confidence on a named brand and gold expects `low` for "
            "t017, t061 and t076, so 'rated high' is the wrong direction. Nutella and Philadelphia expect a brand only.", "",
            table(["cell", "brand items", "found", "rated high (all brand items)", "rated high (the `expect low` ones)",
                   "brand field right", "rated high, labels"], rows), "",
            "### Vague foods and the overall confidence mix", "",
            "Gold expects `low` on the vague typed foods t034 'a bar', t035 'some cheese' and t071 'some curry'. The last "
            "three columns are the mix over every item of every typed answer.", "",
            table(["cell", "vague foods rated low", "not rated low", "items", "high", "medium", "low"], vague_rows), "",
            "## 10. Confidence calibration", "",
            "Items whose kcal per 100 g is more than 25 percent off the USDA reference, on the same overlap as section 8, "
            "and the share of them rated `high`. The count is small, so read it as a direction.", "",
            table(["cell", "items more than 25% off", "rated high", "share", "which"], cal), ""]


def render_pantry(data: dict) -> list[str]:
    kinds = ("missing_item", "wrong_amount_unit", "amount_not_null", "low_confidence_missing", "forbidden_item",
             "not_empty", "bad_category", "bad_unit", "no_answer")
    rows, detail = [], []
    for letter in SCORED_CELLS:
        cases = data["cells"][letter]["pantry"]
        passed = [cid for cid, r in cases.items() if not r["failures"]]
        counts = Counter(kind for r in cases.values() for kind, _ in r["failures"])
        rows.append([cell_name(letter), f"{len(passed)}/{len(cases)}", ", ".join(c for c in cases if c not in passed) or "none"]
                    + [counts.get(k, 0) for k in kinds] + [sum(len(r["extras"]) for r in cases.values())])
        for cid, r in cases.items():
            detail += [[cell_name(letter), cid, kind, text] for kind, text in r["failures"]]
    return ["## 11. Pantry gold", "",
            "A case passes when every expected item is present with its amount and unit (or an accepted alternative), "
            "amounts are null where the text gives none, `low` confidence is set where gold requires it, no forbidden item "
            "appears, and categories and units are in the enum. Items are matched by name against `translations.en` "
            "with a fuzzy token match. Extras (items beyond the gold) are counted, never failed. The kind columns count "
            "failures, so one case can add to several.", "",
            table(["cell", "cases passed", "failed cases"] + list(kinds) + ["extra items"], rows), "",
            "Every pantry failure:", "", table(["cell", "case", "kind", "detail"], detail), ""]


def render_recipes(data: dict) -> list[str]:
    kinds = ("no_answer", "recipe_count", "serving_grams", "amount_unit_not_null_together", "from_pantry_true_not_on_shelf",
             "from_pantry_false_on_shelf", "from_pantry_false_not_staple", "exceeds_pantry_amount", "over_kcal_budget",
             "over_carb_budget", "per_serving_inconsistent")
    rows, detail = [], []
    for letter in SCORED_CELLS:
        cases = data["cells"][letter]["recipes"]
        counts = Counter(kind for r in cases.values() for kind, _ in r["violations"])
        clean = [cid for cid, r in cases.items() if not r["violations"]]
        rows.append([cell_name(letter), len(cases), fmt(mean([r["raw"] for r in cases.values()]), 1),
                     fmt(mean([r["shown"] for r in cases.values()]), 1), f"{len(clean)}/{len(cases)}",
                     sum(counts.values())] + [counts.get(k, 0) for k in kinds])
        for cid, r in cases.items():
            detail += [[cell_name(letter), cid, kind, text] for kind, text in r["violations"]]
    return ["## 12. Recipe gold constraints", "",
            "Per call: recipes returned and recipes shown (the app drops a recipe whose `servingGrams` is outside 30 to 1500). "
            "Violations are counted per recipe or ingredient. `fromPantry` honesty: true must match a shelf item by "
            "name (fuzzy token match); false must be a staple in the language of the case, and a false ingredient that "
            "matches the shelf is counted as `from_pantry_false_on_shelf`. `per_serving_inconsistent` is kcal more than "
            "20 percent away from 4 x net carbs + 4 x protein + 9 x fat. Budgets use the model's own `perServing`. Not "
            "checked: answer language, one-sentence `whyItFits`, distinct ideas. A call with no parsed answer shows 0 recipes.", "",
            table(["cell", "calls", "recipes per call", "shown per call", "calls with no violation", "violations"] + list(kinds), rows), "",
            "Every recipe violation:", "", table(["cell", "case", "kind", "detail"], detail), ""]


def keep_section(path: Path, heading: str) -> str | None:
    """A hand-written section already in the report survives a regeneration."""
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8")
    start = text.find(heading)
    if start < 0:
        return None
    end = text.find("\n## ", start + len(heading))
    return text[start:end if end > 0 else len(text)].rstrip() + "\n"


# ---------------------------------------------------------------------------
# The kcal gold runs: the 34 rows of gold_kcal_text.jsonl, each sent as its own typed case
# ---------------------------------------------------------------------------

KCAL_REPORT_HEADING = "## What stands out"


def parse_labelled(values: list[str] | None) -> dict[str, list[str]]:
    """`LABEL=dir[,dir...]` arguments -> {label: [dir, ...]}, in the order given."""
    out: dict[str, list[str]] = {}
    for value in values or []:
        label, sep, dirs = value.partition("=")
        if not sep or not label or not dirs:
            raise SystemExit(f"expected LABEL=DIR[,DIR...], got {value!r}")
        out[label] = [d for d in dirs.split(",") if d]
    return out


def gather_kcal_gold(kcal_runs: dict[str, list[str]], typed_runs_by_cell: dict[str, list[str]], runs_dir: Path,
                     labels: dict[str, str] | None = None) -> dict:
    """kcal and carbs per 100 g of the kcal gold runs, plus brand and vague-food confidence of the typed runs."""
    kcal_rows = {c["id"]: c for c in load_jsonl(GOLD / "gold_kcal_text.jsonl")}
    text_gold = {c["id"]: c for c in load_jsonl(GOLD / "gold_text.jsonl")}
    out: dict = {"kcal_rows": len(kcal_rows), "cells": {}, "typed": {}, "notes": [], "labels": labels or {}}
    for label, dirs in kcal_runs.items():
        rows, runs = [], []
        for d in dirs:
            results = load_results(runs_dir / d / "results.json")
            if results is None or any(rid not in results for rid in kcal_rows):
                out["notes"].append(f"{label}: {d} is missing or incomplete, left out.")
                continue
            runs.append(d)
            for rid in sorted(kcal_rows):
                rec = results[rid]
                rows.append({**kcal_gold_comparison(f"{Path(d).name}:{rid}", kcal_rows[rid], rec.get("answer")),
                             "schema_valid": rec.get("schema_valid"), "finish_reason": rec.get("finish_reason")})
        out["cells"][label] = {
            "runs": runs, "rows": rows, "kcal": summarise_kcal(rows, "kcal"), "carbs": summarise_kcal(rows, "carbs"),
            "calibration": calibration(rows), "confidence_mix": dict(Counter(r["confidence"] for r in rows)),
            "invalid": [r["label"] for r in rows if r["schema_valid"] is not True],
        }
    for label, dirs in typed_runs_by_cell.items():
        brands, vague, answers, used = [], [], [], []
        for d in dirs:
            results = load_results(runs_dir / d / "results.json")
            if results is None or len(results) != TYPED_CASES_PER_RUN:
                out["notes"].append(f"{label}: typed run {d} is missing or incomplete, left out.")
                continue
            used.append(d)
            for cid, rec in sorted(results.items()):
                answer = rec.get("answer")
                answers.append(answer)
                tag = f"{Path(d).name[-2:]}:{cid}"
                brand = brand_checks(tag, text_gold[cid], answer)
                if brand:
                    brands.append(brand)
                item = vague_checks(tag, text_gold[cid], answer)
                if item:
                    vague.append(item)
        out["typed"][label] = {"runs": used, "brands": brands, "vague": vague, "confidence_mix": confidence_mix(answers)}
    return out


def short_run(name: str) -> str:
    """`worktree:directory` for a run reached through `..`, else the name."""
    parts = [p for p in Path(name).parts if p not in ("..", ".", "/")]
    return name if len(parts) <= 1 else f"{parts[0]}:{parts[-1]}"


def render_kcal_gold(data: dict) -> str:
    cells = list(data["cells"])
    labels = data.get("labels") or {}

    def name(c):
        return f"{c} {labels[c]}" if c in labels else c

    out = ["# EU switch: kcal and carbs per 100 g on the kcal gold set (2026-10-06)", ""]
    out.append(
        "Scored by `python3 -m harness.score_misc --kcal-run ...` from finished run files. No model was called. Each of "
        f"the {data['kcal_rows']} rows of `gold/gold_kcal_text.jsonl` was sent as its own typed case through the app's real "
        "text request, so this replaces the nine-food proxy of `EU-MISC-SCORING-2026-10-06.md` section 8. The reference "
        "is USDA SR Legacy per 100 g (see `gold/GOLD-NOTES.md` section 5). Tolerance is plus or minus 15 percent; for carbs "
        "a value within 1 g also passes. USDA carbs include fibre, and the app asks for total carbs on an estimate, so they "
        "compare directly. Two rows are drinks typed in ml (k033 cola, k034 beer) and compare per 100 ml against per "
        "100 g; k030 mozzarella has a low-confidence reference (US low-moisture mozzarella).")
    out.append("")
    out.append("Runs (`worktree:directory` is a run in that sibling worktree): " + "; ".join(
        f"{name(c)}: {', '.join(short_run(r) for r in data['cells'][c]['runs']) or 'none'}" for c in cells) + ". "
        + " ".join(data["notes"]))
    out.append("")
    for key, title in (("kcal", "kcal per 100 g"), ("carbs", "carbs per 100 g (total, fibre included)")):
        rows = []
        for c in cells:
            rr = data["cells"][c]["rows"]
            for scope, subset in (("all 34", rr), ("reference high only", [r for r in rr if r["ref_confidence"] == "high"]),
                                  ("without the low reference", [r for r in rr if r["ref_confidence"] != "low"])):
                s = summarise_kcal(subset, key)
                share = f" ({100 * s['within'] / s['compared']:.0f}%)" if s["compared"] else ""
                rows.append([name(c), scope, s["n"], s["split"], f"{s['within']}/{s['compared']}{share}",
                             fmt(s["median_signed_err_pct"], 1, "%"), s["null_value"]])
        out += [f"## {title}", "",
                "`split` counts the rows where the model gave the food as two or more items. Their per 100 g numbers "
                "are combined, weighted by `estimatedGrams` (the plain mean when an item has no grams), so a split food "
                "is scored whole.", "",
                table(["cell", "scope", "n", "split", "within tolerance", "median signed error", "null value"], rows), ""]
    for key in ("kcal", "carbs"):
        rows = []
        for c in cells:
            for r in data["cells"][c][key]["worst"]:
                rows.append([name(c), r["row"], r["input"], r[key], r[f"ref_{key}"], f"{r[f'{key}_err_pct']:+.0f}%",
                             "yes" if r[f"{key}_ok"] else "no", r["confidence"], r["ref_confidence"]])
        out += [f"## Five worst per cell, {key}", "", "Ranked by percent error. For carbs a row within 1 g still passes "
                "(`within` yes), so a near-zero reference such as butter can top the list and pass.", "", table(
            ["cell", "row", "typed input", "model", "USDA", "error", "within", "model confidence", "reference confidence"], rows), ""]
    rows = []
    for c in cells:
        cal = data["cells"][c]["calibration"]
        mix = data["cells"][c]["confidence_mix"]
        share = f"{100 * cal['wrong_rated_high'] / cal['wrong']:.0f}%" if cal["wrong"] else "n/a"
        rows.append([name(c), ", ".join(f"{k}: {mix.get(k, 0)}" for k in ("high", "medium", "low")), cal["wrong"],
                     cal["wrong_rated_high"], share, "; ".join(cal["ids"]) or "none"])
    out += ["## Confidence calibration on the kcal rows", "",
            "Items whose kcal per 100 g is more than 25 percent off USDA, and how many of them the model rated `high`. "
            "These are plain foods with stated grams, so `high` is the expected rating for most of them.", "",
            table(["cell", "confidence of the 34 items", "more than 25% off", "rated high", "share", "which"], rows), ""]
    rows = []
    by_row = {c: {r["row"]: r for r in data["cells"][c]["rows"]} for c in cells}
    for rid in sorted(next(iter(by_row.values()), {})):
        first = by_row[cells[0]][rid]
        cols = []
        for c in cells:
            r = by_row[c].get(rid)
            cols.append("n/a" if not r or r["kcal"] is None else f"{r['kcal']:g} ({r['kcal_err_pct']:+.0f}%{'' if r['kcal_ok'] else ', off'}{', split' if r.get('split') else ''})")
        rows.append([rid, first["input"], f"{first['ref_kcal']:g}", *cols])
    out += ["## Every row, kcal per 100 g", "", "`off` marks a value outside plus or minus 15 percent. `split` marks a row the model gave as two or more items, "
            "combined as described above.", "",
            table(["row", "typed input", "USDA"] + [name(c) for c in cells], rows), ""]
    if data["typed"]:
        brow, vrow = [], []
        for c, t in data["typed"].items():
            found = [b for b in t["brands"] if b["found"]]
            low = [b for b in t["brands"] if b.get("expected_conf") == "low"]
            brow.append([name(c), len(t["runs"]), len(t["brands"]), len(found),
                         f"{sum(1 for b in found if b['confidence'] == 'high')}/{len(found)}",
                         f"{sum(1 for b in low if b.get('found') and b['confidence'] == 'high')}/{len(low)}",
                         f"{sum(1 for b in found if b['brand_ok'])}/{len(found)}",
                         ", ".join(b["label"] for b in found if b["confidence"] == "high") or "none"])
            vfound = [v for v in t["vague"] if v["found"]]
            mix = t["confidence_mix"]
            vrow.append([name(c), f"{sum(1 for v in vfound if v['confidence'] == 'low')}/{len(t['vague'])}",
                         ", ".join(f"{v['label']} {v['confidence']}" for v in vfound if v["confidence"] != "low") or "none",
                         mix["items"], *(f"{100 * mix[k] / mix['items']:.0f}%" if mix["items"] else "n/a" for k in ("high", "medium", "low"))])
        out += ["## Brand and vague-food confidence on the typed runs", "",
                "The kcal rows name no brand, so brand calibration comes from the typed gold runs: t017 Snickers, t028 "
                "Nutella, t057 Philadelphia, t061 Big Mac, t076 Starbucks, times the repeats. The prompt asks for LOW "
                "confidence on a named brand; gold expects `low` for t017, t061 and t076. Labels are repeat:case.", "",
                table(["cell", "typed repeats", "brand items", "found", "rated high (all)", "rated high (the `expect low` ones)",
                       "brand field right", "rated high, labels"], brow), "",
                "Vague foods (t034 'a bar', t035 'some cheese', t071 'some curry') should be `low`. The last three columns are "
                "the mix over every item of every typed answer.", "",
                table(["cell", "vague foods rated low", "not rated low", "items", "high", "medium", "low"], vrow), ""]
    return "\n".join(out)


def jsonable(value):
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out-dir", type=Path, default=RUNS)
    parser.add_argument("--kcal-run", action="append", metavar="LABEL=DIR[,DIR]",
                        help="score the kcal gold run(s) of a cell instead of the EU cells (repeatable)")
    parser.add_argument("--typed-run", action="append", metavar="LABEL=DIR[,DIR...]",
                        help="with --kcal-run: typed runs of a cell for the brand and vague-food confidence (repeatable)")
    parser.add_argument("--label", action="append", metavar="LABEL=TEXT", help="with --kcal-run: a cell's long name")
    parser.add_argument("--runs-dir", type=Path, default=RUNS, help="where run names are read from")
    parser.add_argument("--out", type=Path, default=None, help="with --kcal-run: output stem (writes .md and .json)")
    args = parser.parse_args(argv)
    if args.kcal_run:
        labels = {k: ",".join(v) for k, v in parse_labelled(args.label).items()}
        data = gather_kcal_gold(parse_labelled(args.kcal_run), parse_labelled(args.typed_run), args.runs_dir, labels)
        stem = args.out or (RUNS / "EU-KCAL-SCORING-2026-10-06")
        md_path = Path(f"{stem}.md")
        kept = keep_section(md_path, KCAL_REPORT_HEADING)
        text = render_kcal_gold(data) + "\n" + (kept if kept else f"{KCAL_REPORT_HEADING}\n\n(not written yet)\n")
        md_path.write_text(text, encoding="utf-8")
        Path(f"{stem}.json").write_text(json.dumps(jsonable(data), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {md_path}")
        return 0
    contract = load_contract()
    data = gather(contract, args.runs_dir)
    md_path = args.out_dir / f"{REPORT_NAME}.md"
    heading = "## What stands out"
    kept = keep_section(md_path, heading)
    text = render(data)
    text += "\n" + (kept if kept else f"{heading}\n\n(not written yet)\n")
    md_path.write_text(text, encoding="utf-8")
    (args.out_dir / f"{REPORT_NAME}.json").write_text(
        json.dumps(jsonable(data), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {md_path}")
    if data["incomplete"]:
        print("INCOMPLETE: " + "; ".join(data["incomplete"]) + f" (the rule needs {data['expected_repeats']})")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
