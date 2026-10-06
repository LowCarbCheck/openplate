"""Turn a results.json into a human scoring worksheet.

    python3 -m harness.scorecard runs/<dir>/results.json [--gold gold/gold_labels.json]
                                 [--out runs/<dir>/scorecard.md] [--stdout]
    python3 -m harness.scorecard runs/<dir>/results.json --prefill \
                                 --from runs/*/scorecard-filled.md [more globs or dirs]
    python3 -m harness.scorecard --score runs/<dir>/scorecard-filled.md
    python3 -m harness.scorecard --compare runs/<a>/scorecard-filled.md \
                                           runs/<b>/scorecard-filled.md

What is automatic: the mechanical numbers (item counts, latency stats, cost
totals and cost-per-plate, JSON-validity rate), the portion/macro error
families where the gold labels carry gram ranges, and -- once a worksheet has
been filled -- bootstrap confidence intervals on recall (`harness/stats.py`).

What is deliberately NOT automatic: whether a reported food matches a gold
item. Fuzzy string matching lies about exactly the cases that matter -- "Greek
salad" covering three gold rows, "sashimi" vs "nigiri" (a rice miss),
"mediterranean salad" swallowing feta and olives. So the worksheet lays the
gold core items out as rows with an empty cell per approach, and a human (or a
reviewing agent looking at the photo) fills them in.

`--prefill` removes the repeat work, never the judgment. It reads every earlier
filled worksheet named by `--from` into a verdict memory keyed on (plate, gold
item, model item name) and answers only the rows whose model item names it has
judged before, by exact match on the lower-cased, space-collapsed name. A row it
cannot answer is left blank and marked `NEEDS JUDGMENT`; a row on which two
earlier sheets disagree is marked `CONFLICT` and shows the newest verdict. A
`--score` run refuses a sheet that still carries either marker.
"""

from __future__ import annotations

import argparse
import dataclasses
import glob
import hashlib
import json
import os
import re
import statistics
import sys
import tempfile
from pathlib import Path

from . import approaches as approach_lib
from . import granularity as granularity_lib
from . import stats as stats_lib


def load_json(path: Path) -> dict:
    if not path.is_file():
        raise SystemExit(f"ERROR: file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def infer_eval_root(results_path: Path) -> Path:
    """runs/<dir>/results.json -> the eval root two levels up."""
    resolved = results_path.resolve()
    candidate = resolved.parent.parent.parent
    if (candidate / "gold").is_dir():
        return candidate
    return Path.cwd()


def image_ids(results: dict) -> list[str]:
    return [k for k in results if not k.startswith("_")]


def approach_keys(results: dict) -> list[str]:
    summary = results.get("_summary") or {}
    declared = summary.get("approaches")
    if declared:
        return list(declared)
    keys: list[str] = []
    for image_id in image_ids(results):
        for key in results[image_id]:
            if key not in keys:
                keys.append(key)
    return keys


def food_name_list(result: dict) -> list[str]:
    return [
        str(f["name"])
        for f in approach_lib.approach_foods(result)
        if isinstance(f, dict) and "name" in f
    ]


# ---------------------------------------------------------------------------
# Automatic (mechanical) metrics
# ---------------------------------------------------------------------------


def compute_metrics(results: dict, keys: list[str]) -> dict:
    metrics: dict = {}
    for key in keys:
        latencies: list[float] = []
        costs: list[float] = []
        json_ok = 0
        json_seen = 0
        item_counts: list[int] = []
        distinct: set[str] = set()
        errored: list[str] = []

        for image_id in image_ids(results):
            result = results[image_id].get(key)
            if result is None:
                continue
            if "error" in result and "foods" not in result and "final" not in result:
                # the approach blew up entirely for this image -- don't let it
                # count as a scored plate and dilute the per-plate figures
                errored.append(image_id)
                continue
            latency = approach_lib.approach_latency_ms(result)
            if latency is not None:
                latencies.append(latency)
            cost = approach_lib.approach_cost_usd(result)
            if cost is not None:
                costs.append(cost)
            ok = approach_lib.approach_json_ok(result)
            if ok is not None:
                json_seen += 1
                json_ok += 1 if ok else 0
            names = food_name_list(result)
            item_counts.append(len(names))
            distinct.update(n.strip().lower() for n in names)

        plates = len(item_counts)
        metrics[key] = {
            "plates": plates,
            "json_valid": f"{json_ok}/{json_seen}" if json_seen else "n/a",
            "json_valid_rate": (json_ok / json_seen) if json_seen else None,
            "items_total": sum(item_counts),
            "items_mean": round(statistics.mean(item_counts), 2) if item_counts else None,
            "distinct_items": len(distinct),
            "latency_mean_s": round(statistics.mean(latencies) / 1000, 2) if latencies else None,
            "latency_median_s": round(statistics.median(latencies) / 1000, 2) if latencies else None,
            "latency_max_s": round(max(latencies) / 1000, 2) if latencies else None,
            "cost_total_usd": round(sum(costs), 6) if costs else 0.0,
            "cost_per_plate_usd": round(sum(costs) / plates, 6) if costs and plates else 0.0,
            "errors": errored,
        }
    return metrics


def render_metrics_table(metrics: dict, keys: list[str]) -> list[str]:
    rows = [
        ("plates", "plates"),
        ("json_valid", "schema-valid responses"),
        ("items_total", "items named (total)"),
        ("items_mean", "items named (mean/plate)"),
        ("distinct_items", "distinct item names"),
        ("latency_mean_s", "latency mean (s)"),
        ("latency_median_s", "latency median (s)"),
        ("latency_max_s", "latency max (s)"),
        ("cost_per_plate_usd", "cost / plate (USD)"),
        ("cost_total_usd", "cost total (USD)"),
    ]
    lines = ["| metric | " + " | ".join(keys) + " |", "|---|" + "---|" * len(keys)]
    for field, label in rows:
        cells = []
        for key in keys:
            value = metrics[key].get(field)
            cells.append("-" if value is None else str(value))
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    return lines


# ---------------------------------------------------------------------------
# Portion + macro error (only scorable where gold carries weighed grams)
# ---------------------------------------------------------------------------
#
# Gold entries may carry two optional fields, both hand-authored from *weighed*
# food, never inferred from a photo:
#
#   "gram_ranges": {"scrambled eggs": [80, 140], "bacon/ham slices": [40, 70]}
#   "kcal_range":  [450, 700]
#
# Neither exists in gold/gold_labels.json today, so both metric families report
# themselves as unscorable rather than quietly disappearing from the worksheet:
# an omitted metric reads as "fine", an explicit `unscorable (0/50 covered)`
# reads as the open task it is (M138 spec 01).
#
# Name matching here is exact-after-normalisation, deliberately: the same
# argument that keeps semantic item matching human applies to grams. A reported
# name that does not match a gold key is counted as `unmatched` and surfaced, so
# the fix is a gold alias rather than a fuzzy guess at which row a number belongs
# to -- attributing 250 g to the wrong row is worse than not scoring it.


def normalize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(name).lower()).strip()


def gold_gram_ranges(entry: dict) -> dict[str, tuple[float, float]]:
    raw = entry.get("gram_ranges") or {}
    ranges: dict[str, tuple[float, float]] = {}
    if isinstance(raw, dict):
        for name, span in raw.items():
            if isinstance(span, (list, tuple)) and len(span) == 2:
                ranges[normalize_name(name)] = (float(span[0]), float(span[1]))
    return ranges


def gold_kcal_range(entry: dict) -> tuple[float, float] | None:
    span = entry.get("kcal_range")
    if isinstance(span, (list, tuple)) and len(span) == 2:
        return float(span[0]), float(span[1])
    return None


def predicted_plate_kcal(foods: list) -> float | None:
    """Sum of grams x kcal/100 g over the reported foods.

    Returns None if any reported food lacks either number -- a partial sum would
    understate the plate and read as a low-error result.
    """
    total = 0.0
    seen = 0
    for food in foods:
        if not isinstance(food, dict):
            return None
        grams = food.get("estimatedGrams")
        macros = food.get("macrosPer100g")
        kcal = macros.get("kcal") if isinstance(macros, dict) else None
        if not isinstance(grams, (int, float)) or not isinstance(kcal, (int, float)):
            return None
        total += float(grams) * float(kcal) / 100.0
        seen += 1
    return total if seen else None


def portion_macro_metrics(results: dict, gold: dict, keys: list[str]) -> dict:
    ids = image_ids(results)
    covered_grams = [i for i in ids if gold_gram_ranges(gold.get(i) or {})]
    covered_kcal = [i for i in ids if gold_kcal_range(gold.get(i) or {})]

    by_approach: dict = {}
    for key in keys:
        gram_errors: list[float] = []
        inside_range = 0
        matched = 0
        unmatched = 0
        kcal_errors: list[float] = []
        kcal_inside = 0
        kcal_plates = 0
        kcal_unscorable = 0

        for image_id in ids:
            result = results[image_id].get(key)
            if not isinstance(result, dict):
                continue
            foods = approach_lib.approach_foods(result)
            entry = gold.get(image_id) or {}

            ranges = gold_gram_ranges(entry)
            if ranges:
                for food in foods:
                    if not isinstance(food, dict):
                        continue
                    span = ranges.get(normalize_name(food.get("name", "")))
                    grams = food.get("estimatedGrams")
                    if span is None or not isinstance(grams, (int, float)):
                        unmatched += 1
                        continue
                    low, high = span
                    mid = (low + high) / 2.0
                    matched += 1
                    if mid:
                        gram_errors.append(abs(float(grams) - mid) / mid)
                    if low <= float(grams) <= high:
                        inside_range += 1

            kcal_span = gold_kcal_range(entry)
            if kcal_span:
                predicted = predicted_plate_kcal(foods)
                if predicted is None:
                    kcal_unscorable += 1
                    continue
                low, high = kcal_span
                mid = (low + high) / 2.0
                kcal_plates += 1
                if mid:
                    kcal_errors.append(abs(predicted - mid) / mid)
                if low <= predicted <= high:
                    kcal_inside += 1

        by_approach[key] = {
            "portion_error_mean": round(statistics.mean(gram_errors), 3) if gram_errors else None,
            "portion_error_median": (
                round(statistics.median(gram_errors), 3) if gram_errors else None
            ),
            "gram_inside_range_share": (round(inside_range / matched, 3) if matched else None),
            "gram_items_matched": matched,
            "gram_items_unmatched": unmatched,
            "macro_error_kcal_mean": round(statistics.mean(kcal_errors), 3) if kcal_errors else None,
            "kcal_error_median": round(statistics.median(kcal_errors), 3) if kcal_errors else None,
            "kcal_inside_range_share": (round(kcal_inside / kcal_plates, 3) if kcal_plates else None),
            "kcal_plates_scored": kcal_plates,
            "kcal_plates_unscorable": kcal_unscorable,
        }

    return {
        "images": len(ids),
        "images_with_gram_ranges": len(covered_grams),
        "images_with_kcal_range": len(covered_kcal),
        "by_approach": by_approach,
    }


def render_portion_macro(portion_macro: dict, keys: list[str]) -> list[str]:
    total = portion_macro["images"]
    with_grams = portion_macro["images_with_gram_ranges"]
    with_kcal = portion_macro["images_with_kcal_range"]

    lines = ["## Portion + macro error (auto-computed)", ""]
    if not with_grams and not with_kcal:
        lines += [
            f"portion/macro: **unscorable**: gold has no gram ranges "
            f"({with_grams}/{total} covered) and no kcal ranges ({with_kcal}/{total} covered).",
            "",
            "Weighed-gram ground truth is the missing input, not the metric: add `gram_ranges`",
            "(per gold item, `[min, max]` grams) and `kcal_range` (`[min, max]` per plate) to",
            "`gold/gold_labels.json` and both families populate automatically here. Grams must",
            "come from a scale: a gram range guessed off a photo would make portion error",
            "measure the labeller, not the model.",
            "",
        ]
        return lines

    rows = [
        ("portion_error_mean", "portion error abs(Δg)/mid (mean)"),
        ("portion_error_median", "portion error abs(Δg)/mid (median)"),
        ("gram_inside_range_share", "items inside gold gram range"),
        ("gram_items_matched", "items matched to a gold gram range"),
        ("gram_items_unmatched", "items with no gold gram range (unscored)"),
        ("macro_error_kcal_mean", "kcal error abs(Δ)/mid (mean)"),
        ("kcal_error_median", "kcal error abs(Δ)/mid (median)"),
        ("kcal_inside_range_share", "plates inside gold kcal range"),
        ("kcal_plates_scored", "plates with a scorable kcal total"),
        ("kcal_plates_unscorable", "plates missing grams/macros (unscored)"),
    ]
    lines += [
        f"Gold coverage: gram ranges on {with_grams}/{total} images, "
        f"kcal range on {with_kcal}/{total}.",
        "",
        "| metric | " + " | ".join(keys) + " |",
        "|---|" + "---|" * len(keys),
    ]
    for field, label in rows:
        cells = []
        for key in keys:
            value = portion_macro["by_approach"][key].get(field)
            cells.append("-" if value is None else str(value))
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    lines.append("")
    return lines


# ---------------------------------------------------------------------------
# Prefill: a verdict memory built from earlier filled worksheets
# ---------------------------------------------------------------------------
#
# The judgment stays human. What repeats between runs is the SAME model item name
# on the SAME plate being judged against the SAME gold item again. The memory
# answers only that, by exact match after lower-casing, trimming and collapsing
# spaces. No fuzzy matching: "ham" and "ham slices" are two names, and a new name
# is a new judgment.
#
# A filled sheet does not store the matched model item as a field. It is read from
# the Notes cell: the first quoted string outside parentheses that equals an item
# the sheet reported on that plate (`"Ham slices" (C3 "cooked ham")` names "Ham
# slices"; the parenthesis names another sheet's item). With no such quote, a plate
# with exactly one reported item names it. Otherwise the Y is real but its item is
# unknown, so it cannot be remembered and is counted as unattributed. A remembered
# `n` needs no name: the verdict says no reported item of that plate covered the
# gold item, so every reported item gets the `n`. `Y?` and `n?` are not remembered.

NEEDS_MARKER = "NEEDS JUDGMENT"
CONFLICT_MARKER = "CONFLICT"
PREFILL_HEADER_PREFIX = "- prefill:"
FILLED_SHEET_NAME = "scorecard-filled.md"
HIT_VERDICTS = ("Y", "Y merged")

_UNRESOLVED_RE = re.compile(r"\b(NEEDS JUDGMENT|CONFLICT)\b")
_PLATE_HEADING_RE = re.compile(r"^###\s+([0-9A-Za-z_-]+)\b[ ,]*(.*)$")
_REPORTED_LINE_RE = re.compile(r"^- \*\*(.+?)\*\*:\s*(.*)$")
_FLAGS_SUFFIX_RE = re.compile(r"\s+_\[[^\]]*\]_\s*$")
_QUOTED_RE = re.compile(r'"([^"\n]+)"|“([^”\n]+)”|`([^`\n]+)`')
_RECALL_LABEL_RE = re.compile(r"core recall\s*\(/(\d+)\)")
_HITS_RE = re.compile(r"(\d+)\s*/\s*(\d+)")
_SPECIAL_ROW_PREFIXES = ("core recall", "hallucination", "over-decomposed")


def normalize_item_name(name: object) -> str:
    """Lower case, trimmed, runs of whitespace collapsed to one space. Nothing else."""
    return " ".join(str(name).lower().split())


def parse_verdict(cell: str) -> str | None:
    """`Y`, `Y merged` or `n` (any case); everything else, `Y?` and blank included, is None."""
    text = " ".join(cell.replace("*", "").replace("`", "").split()).lower()
    return {"y": "Y", "y merged": "Y merged", "n": "n"}.get(text)


def _cells(line: str) -> list[str]:
    stripped = line.strip()
    if not stripped.startswith("|"):
        return []
    return [c.strip() for c in stripped.strip("|").split("|")]


def _table_safe(text: str) -> str:
    return " ".join(text.replace("|", "/").split())


@dataclasses.dataclass
class SheetRow:
    gold: str
    cells: list[str]
    notes: str
    line: int


@dataclasses.dataclass
class SheetPlate:
    plate: str
    reported: dict[str, str] = dataclasses.field(default_factory=dict)
    columns: list[str] = dataclasses.field(default_factory=list)
    rows: list[SheetRow] = dataclasses.field(default_factory=list)
    recall_line: int | None = None
    recall_total: int | None = None


def parse_sheet(text: str) -> list[SheetPlate]:
    """A worksheet's plates: reported-item lines, gold rows with their cells and notes."""
    plates: list[SheetPlate] = []
    current: SheetPlate | None = None
    for index, line in enumerate(text.splitlines()):
        heading = _PLATE_HEADING_RE.match(line)
        if heading:
            current = SheetPlate(plate=heading.group(1))
            plates.append(current)
            continue
        if current is None:
            continue
        reported = _REPORTED_LINE_RE.match(line)
        if reported:
            current.reported[reported.group(1).strip()] = reported.group(2).strip()
            continue
        cells = _cells(line)
        if not cells:
            continue
        label = cells[0].replace("*", "").replace("`", "").strip().lower()
        if label == "gold core item":
            columns = [c.replace("*", "").replace("`", "").strip() for c in cells[1:]]
            if columns and columns[-1].lower() in {"notes", "note"}:
                columns = columns[:-1]
            current.columns = columns
            continue
        if label in {"metric", "gold item", "image", "img"}:
            current = None
            continue
        if not current.columns or set(label) <= {"-", ":", ""}:
            continue
        width = len(current.columns)
        if label.startswith(_SPECIAL_ROW_PREFIXES):
            recall = _RECALL_LABEL_RE.search(label)
            if recall:
                current.recall_line = index
                current.recall_total = int(recall.group(1))
            continue
        values = (cells[1 : 1 + width] + [""] * width)[:width]
        notes = cells[1 + width] if len(cells) > 1 + width else ""
        current.rows.append(SheetRow(gold=cells[0], cells=values, notes=notes, line=index))
    return plates


def _strip_parentheses(text: str) -> str:
    previous = None
    while previous != text:
        previous = text
        text = re.sub(r"\([^()]*\)", " ", text)
    return text


def matched_item(notes: str, items: list[str]) -> str | None:
    """The reported item a `Y` row's notes name, or None when they name none.

    First quoted string outside parentheses that equals a reported item. With no
    such quote, a plate with exactly one reported item names it.
    """
    index = {normalize_item_name(i): i for i in items}
    for groups in _QUOTED_RE.findall(_strip_parentheses(notes)):
        quoted = next(g for g in groups if g)
        if normalize_item_name(quoted) in index:
            return index[normalize_item_name(quoted)]
    if len(index) == 1:
        return next(iter(index.values()))
    return None


def _clean_reason(notes: str) -> str:
    """Notes without the `prefill ...:` tag this module writes, so tags never nest."""
    return re.sub(r"^prefill (?:Y|n) from [^:]*:\s*", "", notes.strip())


@dataclasses.dataclass(frozen=True)
class Memory:
    verdict: str
    reason: str
    source: str
    mtime: float
    path: str


def _newest(entries: list[Memory]) -> Memory:
    return max(entries, key=lambda e: (e.mtime, e.path))


class VerdictMemory:
    """(plate, normalised gold item, normalised model item) -> every earlier verdict."""

    def __init__(self) -> None:
        self.entries: dict[tuple[str, str, str], list[Memory]] = {}
        self.sheets: list[tuple[str, str]] = []
        self.excluded = 0
        self.hits_named = 0
        self.hits_unattributed = 0
        self.misses = 0
        self.uncertain = 0

    def add(self, plate: str, gold: str, item: str, memory: Memory) -> None:
        key = (plate, normalize_item_name(gold), normalize_item_name(item))
        self.entries.setdefault(key, []).append(memory)

    def lookup(self, plate: str, gold: str, item: str) -> list[Memory]:
        return self.entries.get((plate, normalize_item_name(gold), normalize_item_name(item)), [])


def discover_sheets(
    specs: list[str], own_run: str | None = None, own_paths: tuple[Path, ...] = ()
) -> tuple[list[Path], int]:
    """Filled sheets named by globs, directories (searched for scorecard-filled.md) or files.

    A run never learns from itself: its own sheet and any copy of a run with the
    same directory name (sibling worktrees carry copies) are skipped and counted.
    Returns the sheets and the number skipped.
    """
    found: list[Path] = []
    for spec in specs:
        matches = sorted(glob.glob(os.path.expanduser(spec), recursive=True))
        if not matches:
            raise SystemExit(f"ERROR: --from matched nothing: {spec}")
        for match in map(Path, matches):
            if match.is_dir():
                found.extend(sorted(match.rglob(FILLED_SHEET_NAME)))
            elif match.is_file():
                found.append(match)
    own = {p.resolve() for p in own_paths}
    kept: list[Path] = []
    seen: set[Path] = set()
    excluded = 0
    for path in found:
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if resolved in own or (own_run and resolved.parent.name == own_run):
            excluded += 1
            continue
        kept.append(path)
    return kept, excluded


def _sibling_results(sheet: Path) -> dict | None:
    candidate = sheet.parent / "results.json"
    if not candidate.is_file():
        return None
    try:
        data = json.loads(candidate.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def sheet_items(plate: SheetPlate, results: dict | None) -> dict[str, list[str]]:
    """Per column, the model items the sheet reported on this plate.

    Exact names come from the results.json beside the sheet when its names join to
    the sheet's own line; otherwise the line is split on commas (a name that holds
    a comma splits wrongly there, which can only lose a match, never invent one).
    """
    out: dict[str, list[str]] = {}
    for column in plate.columns:
        line = plate.reported.get(column)
        if line is None:
            continue
        text = _FLAGS_SUFFIX_RE.sub("", line).strip()
        names: list[str] | None = None
        record = ((results or {}).get(plate.plate) or {}).get(column)
        if isinstance(record, dict):
            candidate = food_name_list(record)
            if ", ".join(candidate) == text or (not candidate and text in {"", "(none)"}):
                names = candidate
        if names is None:
            names = [] if text in {"", "(none)"} else [p.strip() for p in text.split(", ") if p.strip()]
        out[column] = names
    return out


def load_memory(sheet_paths: list[Path], excluded: int = 0) -> VerdictMemory:
    """Read every sheet into the memory. Identical copies count once (newest copy)."""
    memory = VerdictMemory()
    memory.excluded = excluded

    by_content: dict[str, Path] = {}
    for path in sheet_paths:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        held = by_content.get(digest)
        rank = lambda q: ((q.parent / "results.json").is_file(), q.stat().st_mtime, str(q))  # noqa: E731
        if held is None or rank(path) > rank(held):
            by_content[digest] = path
    names: dict[str, int] = {}
    for path in by_content.values():
        names[path.parent.name] = names.get(path.parent.name, 0) + 1

    for digest, path in sorted(by_content.items(), key=lambda kv: str(kv[1])):
        run = path.parent.name if names[path.parent.name] == 1 else f"{path.parent.name}#{digest[:6]}"
        mtime = path.stat().st_mtime
        memory.sheets.append((run, str(path)))
        results = _sibling_results(path)
        for plate in parse_sheet(path.read_text(encoding="utf-8")):
            items = sheet_items(plate, results)
            for position, column in enumerate(plate.columns):
                source = run if len(plate.columns) == 1 else f"{run}:{column}"
                reported = items.get(column, [])
                for row in plate.rows:
                    verdict = parse_verdict(row.cells[position])
                    if verdict is None:
                        memory.uncertain += 1 if row.cells[position].strip() else 0
                        continue
                    reason = _clean_reason(row.notes)
                    entry = Memory(verdict, reason, source, mtime, str(path))
                    if verdict == "n":
                        memory.misses += 1
                        for item in reported:
                            memory.add(plate.plate, row.gold, item, entry)
                        continue
                    name = matched_item(row.notes, reported)
                    if name is None:
                        memory.hits_unattributed += 1
                        continue
                    memory.hits_named += 1
                    memory.add(plate.plate, row.gold, name, entry)
    return memory


@dataclasses.dataclass
class RowDecision:
    kind: str  # "Y", "n", "conflict" or "needs"
    cell: str
    notes: str
    verdict: str | None = None  # the verdict the cell carries, when it carries one
    gold: str = ""


def _source_list(entries: list[Memory], limit: int = 3) -> str:
    sources = sorted({e.source for e in entries})
    shown = ", ".join(sources[:limit])
    return shown + (f" and {len(sources) - limit} more" if len(sources) > limit else "")


def decide_row(memory: VerdictMemory, plate: str, gold: str, items: list[str]) -> RowDecision:
    return dataclasses.replace(_decide_row(memory, plate, gold, items), gold=gold)


def _decide_row(memory: VerdictMemory, plate: str, gold: str, items: list[str]) -> RowDecision:
    """One gold row of one approach: Y, n, CONFLICT or NEEDS JUDGMENT.

    Y: some model item has a remembered, undisputed Y or Y merged for this gold item.
    n: every model item has a remembered, undisputed n (a plate with no items too).
    CONFLICT: earlier sheets disagree about an item and no other item gives a clean Y.
    Otherwise NEEDS JUDGMENT, listing the names the memory has never judged.
    """
    unique: dict[str, str] = {}
    for item in items:
        if normalize_item_name(item):
            unique.setdefault(normalize_item_name(item), item)

    known: list[tuple[str, list[Memory], Memory, bool]] = []
    unknown: list[str] = []
    for display in unique.values():
        entries = memory.lookup(plate, gold, display)
        if not entries:
            unknown.append(display)
            continue
        newest = _newest(entries)
        known.append((display, entries, newest, any(e.verdict != newest.verdict for e in entries)))

    clean_hits = [k for k in known if not k[3] and k[2].verdict in HIT_VERDICTS]
    if clean_hits:
        display, _entries, newest, _flag = max(clean_hits, key=lambda k: (k[2].mtime, k[2].path))
        quoted = {
            normalize_item_name(next(g for g in groups if g)) for groups in _QUOTED_RE.findall(newest.reason)
        }
        reason = newest.reason if normalize_item_name(display) in quoted else (
            f'"{display}"' + (f", {newest.reason}" if newest.reason else "")
        )
        return RowDecision("Y", newest.verdict, _table_safe(f"prefill Y from {newest.source}: {reason}"), newest.verdict)

    disputed = [k for k in known if k[3]]
    if disputed:
        display, entries, newest, _flag = next(
            (k for k in disputed if k[2].verdict in HIT_VERDICTS), disputed[0]
        )
        by_verdict: dict[str, list[Memory]] = {}
        for entry in entries:
            by_verdict.setdefault(entry.verdict, []).append(entry)
        parts = "; ".join(f"{v} per {_source_list(es)}" for v, es in sorted(by_verdict.items()))
        text = (
            f'{CONFLICT_MARKER} "{display}": {parts}. The cell shows the newest sheet, '
            f"{newest.verdict} per {newest.source}. Decide, then delete this marker."
        )
        if unknown:
            text += " Also unremembered: " + ", ".join(f'"{u}"' for u in unknown) + "."
        return RowDecision("conflict", newest.verdict, _table_safe(text), newest.verdict)

    if unknown:
        text = f"{NEEDS_MARKER}: unremembered items " + ", ".join(f'"{u}"' for u in unknown)
        return RowDecision("needs", " ", _table_safe(text))

    if not known:
        return RowDecision("n", "n", "prefill n: the run reported no items on this plate", "n")
    every = [e for k in known for e in k[1]]
    return RowDecision("n", "n", _table_safe(f"prefill n from {_source_list(every)}: no reported item covered it"), "n")


PrefillPlan = dict  # (plate, approach key) -> list[RowDecision], one per gold core item


def build_prefill_plan(memory: VerdictMemory, results: dict, gold: dict, keys: list[str]) -> PrefillPlan:
    plan: PrefillPlan = {}
    for plate in image_ids(results):
        core = (gold.get(plate) or {}).get("core") or []
        for key in keys:
            result = results[plate].get(key)
            if result is None:
                continue
            items = food_name_list(result)
            plan[(plate, key)] = [decide_row(memory, plate, item, items) for item in core]
    return plan


def plan_counts(plan: PrefillPlan) -> dict[str, int]:
    counts = {"rows": 0, "Y": 0, "Y merged": 0, "n": 0, "conflict": 0, "needs": 0}
    for decisions in plan.values():
        for decision in decisions:
            counts["rows"] += 1
            if decision.kind == "Y":
                counts["Y"] += 1
                counts["Y merged"] += 1 if decision.verdict == "Y merged" else 0
            else:
                counts[decision.kind] += 1
    return counts


def render_prefill_summary(memory: VerdictMemory, plan: PrefillPlan) -> list[str]:
    counts = plan_counts(plan)
    remembered = sum(len(v) for v in memory.entries.values())
    lines = [
        f"prefill memory: {len(memory.sheets)} sheets read ({memory.excluded} skipped as the run's own), "
        f"{remembered} remembered verdicts; {memory.hits_unattributed} Y rows had no nameable item "
        f"and {memory.uncertain} cells were uncertain (Y? or n?), none of them remembered",
        f"prefill rows: {counts['rows']}",
        f"  prefilled Y: {counts['Y']} (of which Y merged: {counts['Y merged']})",
        f"  prefilled n: {counts['n']}",
        f"  conflicts: {counts['conflict']}",
        f"  needs judgment: {counts['needs']}",
    ]
    return lines


def compare_plan_with_filled(plan: PrefillPlan, filled_text: str) -> dict:
    """Score a prefill against the worksheet a person filled for the same run.

    `wrong` is a clean (unflagged) prefill whose Y/n disagrees with the person's.
    A conflict row is flagged, so its newest verdict being wrong is the design
    working, not a bug; it is counted apart.
    """
    filled: dict[tuple[str, str], dict[str, str]] = {}
    for plate in parse_sheet(filled_text):
        for position, column in enumerate(plate.columns):
            rows = filled.setdefault((plate.plate, column), {})
            for row in plate.rows:
                rows.setdefault(normalize_item_name(row.gold), row.cells[position])

    result: dict = {
        "rows": 0, "unscorable": 0, "decided": 0, "right": 0, "wrong": 0, "merged_differs": 0,
        "conflict": 0, "conflict_newest_right": 0, "needs": 0, "wrong_rows": [],
    }
    for (plate, key), decisions in plan.items():
        theirs_by_gold = filled.get((plate, key), {})
        for decision in decisions:
            result["rows"] += 1
            if decision.kind == "needs":
                result["needs"] += 1
                continue
            cell = theirs_by_gold.get(normalize_item_name(decision.gold))
            theirs = parse_verdict(cell) if cell is not None else None
            if theirs is None:
                result["unscorable"] += 1
                continue
            agrees = (decision.verdict in HIT_VERDICTS) == (theirs in HIT_VERDICTS)
            if decision.kind == "conflict":
                result["conflict"] += 1
                result["conflict_newest_right"] += 1 if agrees else 0
                continue
            result["decided"] += 1
            if agrees:
                result["right"] += 1
                result["merged_differs"] += 1 if decision.verdict != theirs else 0
            else:
                result["wrong"] += 1
                result["wrong_rows"].append((plate, key, decision.gold, decision.verdict, theirs, decision.notes))
    return result


def render_comparison(result: dict, source: Path) -> list[str]:
    lines = [
        f"prefill check against {source}:",
        f"  rows compared: {result['rows']} ({result['unscorable']} with no clean Y or n in the filled sheet)",
        f"  decided by the prefill (clean Y or n): {result['decided']}, right {result['right']}, WRONG {result['wrong']}",
        f"  right on Y or n but differing on `Y merged` marking: {result['merged_differs']}",
        f"  flagged CONFLICT: {result['conflict']}, whose newest verdict was right: {result['conflict_newest_right']}",
        f"  left NEEDS JUDGMENT: {result['needs']}",
    ]
    for plate, key, gold, ours, theirs, notes in result["wrong_rows"]:
        lines.append(f"  wrong: plate {plate} [{key}] {gold!r}: prefill {ours}, filled {theirs}; {notes}")
    return lines


# ---------------------------------------------------------------------------
# Reading a prefilled worksheet back: refuse unresolved rows, derive blank recall
# ---------------------------------------------------------------------------


class UnresolvedSheet(Exception):
    """A worksheet that cannot be scored yet."""


def sheet_problems(text: str) -> list[str]:
    """Rows that still carry a marker, and (prefilled sheets only) blank gold cells."""
    problems: list[str] = []
    prefilled = any(line.startswith(PREFILL_HEADER_PREFIX) for line in text.splitlines())
    for plate in parse_sheet(text):
        for row in plate.rows:
            marker = _UNRESOLVED_RE.search(row.notes) or next(
                (m for m in (_UNRESOLVED_RE.search(c) for c in row.cells) if m), None
            )
            if marker:
                problems.append(f"plate {plate.plate}, {row.gold!r}: {marker.group(1)}")
            elif prefilled and any(not c.strip() for c in row.cells):
                problems.append(f"plate {plate.plate}, {row.gold!r}: empty cell")
    return problems


def _with_recall(line: str, position: int, hits: int, total: int) -> str:
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    cells[1 + position] = f"{hits}/{total}"
    return "| " + " | ".join(cells) + " |"


def derive_recall(text: str) -> tuple[str, list[str]]:
    """Fill an empty `core recall` cell from the Y/n cells above it.

    Only when every gold cell of that column is a clean Y, Y merged or n. On a
    prefilled sheet, a recall cell that disagrees with its own clean cells is
    reported as a warning instead of replaced: the person's number stands.
    """
    lines = text.splitlines()
    prefilled = any(line.startswith(PREFILL_HEADER_PREFIX) for line in lines)
    warnings: list[str] = []
    for plate in parse_sheet(text):
        if plate.recall_line is None or not plate.rows:
            continue
        recall_cells = _cells(lines[plate.recall_line])
        for position, column in enumerate(plate.columns):
            verdicts = [parse_verdict(row.cells[position]) for row in plate.rows]
            if any(v is None for v in verdicts):
                continue
            hits = sum(1 for v in verdicts if v in HIT_VERDICTS)
            total = plate.recall_total or len(plate.rows)
            cell = recall_cells[1 + position] if len(recall_cells) > 1 + position else ""
            if not cell.replace("*", "").strip():
                lines[plate.recall_line] = _with_recall(lines[plate.recall_line], position, hits, total)
                recall_cells = _cells(lines[plate.recall_line])
                continue
            written = _HITS_RE.search(cell)
            if prefilled and written and (int(written.group(1)), int(written.group(2))) != (hits, total):
                warnings.append(
                    f"{plate.plate}/{column}: recall row says {written.group(1)}/{written.group(2)}, "
                    f"its cells say {hits}/{total}"
                )
    return "\n".join(lines) + "\n", warnings


def load_filled(path: Path) -> dict:
    """`stats.parse_filled_worksheet` behind the prefill guards."""
    if not path.is_file():
        raise SystemExit(f"ERROR: filled worksheet not found: {path}")
    text = path.read_text(encoding="utf-8")
    problems = sheet_problems(text)
    if problems:
        shown = "\n".join(f"  {p}" for p in problems[:15])
        more = f"\n  ... and {len(problems) - 15} more" if len(problems) > 15 else ""
        raise UnresolvedSheet(
            f"{path} still has {len(problems)} unresolved row(s); resolve each, then score again:\n{shown}{more}"
        )
    derived, warnings = derive_recall(text)
    with tempfile.TemporaryDirectory() as scratch:
        copy = Path(scratch) / FILLED_SHEET_NAME
        copy.write_text(derived, encoding="utf-8")
        worksheet = stats_lib.parse_filled_worksheet(copy)
    worksheet["path"] = str(path)
    worksheet["warnings"] = [*worksheet["warnings"], *warnings]
    return worksheet


# ---------------------------------------------------------------------------
# Worksheet
# ---------------------------------------------------------------------------


def render_worksheet(
    results: dict,
    gold: dict,
    keys: list[str],
    results_path: Path,
    prefill: tuple[VerdictMemory, PrefillPlan] | None = None,
) -> str:
    summary = results.get("_summary") or {}
    metrics = compute_metrics(results, keys)
    ids = image_ids(results)

    lines: list[str] = [
        "# Plate-identification scoring worksheet",
        "",
        f"- results: `{results_path}`",
        f"- config: `{summary.get('config_name', 'unknown')}`"
        + (f" (started {summary['started_at']})" if summary.get("started_at") else ""),
        f"- approaches: {', '.join(keys)}",
        f"- images: {len(ids)}",
    ]
    host = summary.get("host") or {}
    if host:
        lines.append(
            "- host: "
            + ", ".join(
                str(v)
                for v in [
                    host.get("hostname"),
                    host.get("cpu_model"),
                    f"{host.get('cpu_count')} threads" if host.get("cpu_count") else None,
                    f"{host.get('mem_total_mb')} MB RAM" if host.get("mem_total_mb") else None,
                ]
                if v
            )
        )
    if summary.get("fan_out_override") is not None:
        lines.append(f"- fan-out override: {summary['fan_out_override']}")
    failures = summary.get("failures") or []
    if failures:
        lines.append(f"- **failures: {len(failures)}**: {json.dumps(failures)}")
    if prefill is not None:
        memory, plan = prefill
        counts = plan_counts(plan)
        lines.append(
            f"{PREFILL_HEADER_PREFIX} {counts['Y']} Y, {counts['n']} n, {counts['conflict']} conflicts, "
            f"{counts['needs']} need judgment, from {len(memory.sheets)} earlier sheets"
        )

    lines += [
        "",
        "## Mechanical metrics (auto-computed)",
        "",
        *render_metrics_table(metrics, keys),
        "",
        *render_portion_macro(portion_macro_metrics(results, gold, keys), keys),
        "## Scoring instructions (human / reviewing agent)",
        "",
        "Semantic matching is NOT automated: fuzzy matching lies exactly where it matters",
        '("Greek salad" legitimately covering three gold rows; "sashimi" for nigiri hiding a',
        "rice miss). For each image below:",
        "",
        "1. Read the reported food list for each approach against the gold core items.",
        "2. Put `Y` in the cell when the approach covered that gold item (a consolidation counts,",
        "   but note the granularity loss in Notes), `n` when it missed it.",
        "3. Fill the recall row with the resulting `hits/total`.",
        "4. List anything reported that is **not visible in the photo** under Hallucinations.",
        "5. Optional items earn no recall credit; reporting them is not an error either.",
        f"6. Count **{stats_lib.OVER_DECOMPOSED_MARKER}** answers in the dedicated row: one per",
        "   composite dish the approach split into its parts (a stew reported as five",
        f"   ingredients). Writing `{stats_lib.OVER_DECOMPOSED_MARKER}` inside a gold-item cell",
        "   counts too. It is a named error class, not a recall bonus. Mark the gold rows `Y`",
        "   if the parts do cover them, and record the split here so it is counted.",
        "7. When a gold item is covered only by a reported item that ALSO covers another gold core",
        f"   item (a merge, the opposite of a split), write `Y {granularity_lib.MERGED_MARKER}` in its cell.",
        "   It still counts as `Y` for recall. `--granularity` reads it for the strict split recall,",
        "   which gives credit only to items the approach reported on their own.",
        "",
        f"`python3 -m harness.scorecard --score <this file>` reads the filled rows back and",
        "prints bootstrap 95% CIs; `--compare A B` reports WINNER or UNDECIDED.",
        "",
    ]
    if prefill is not None:
        lines[-1:] = [
            "8. This sheet is prefilled from earlier verdicts (exact item name, same plate, same gold",
            "   item). A prefilled `Y` or `n` names its source sheet in Notes. Change it when you",
            "   disagree. A row marked `NEEDS JUDGMENT` has an empty cell and lists the item names no",
            f"   earlier sheet judged: judge it, then delete the `{NEEDS_MARKER}` text. A row marked",
            f"   `{CONFLICT_MARKER}` shows the newest sheet's verdict while earlier sheets disagree: decide,",
            f"   then delete the `{CONFLICT_MARKER}` text. `--score` refuses a sheet with either marker.",
            "   Hallucinations and over-decomposed rows are not prefilled. The recall row may stay",
            "   empty: `--score` counts it from the cells.",
            "",
        ]

    gold_note = gold.get("_note")
    if gold_note:
        lines += ["> Gold-label protocol: " + str(gold_note), ""]

    total_core = 0
    for image_id in ids:
        entry = gold.get(image_id) or {}
        core = entry.get("core") or []
        optional = entry.get("optional") or []
        total_core += len(core)
        meal = entry.get("meal", "(no gold entry)")

        lines += [f"### {image_id}, {meal}", ""]

        for key in keys:
            result = results[image_id].get(key)
            if result is None:
                continue
            names = food_name_list(result)
            reported = ", ".join(names) if names else "(none)"
            flags = []
            if approach_lib.approach_json_ok(result) is False:
                flags.append("schema-invalid")
            if result.get("error"):
                flags.append(f"error: {result['error']}")
            suffix = f"  _[{'; '.join(flags)}]_" if flags else ""
            lines.append(f"- **{key}**: {reported}{suffix}")
        lines.append("")

        if not core:
            lines += ["_No gold entry for this image: add one to `gold/gold_labels.json`._", ""]
            continue

        lines += ["| gold core item | " + " | ".join(keys) + " | notes |",
                  "|---|" + "---|" * len(keys) + "---|"]
        for position, item in enumerate(core):
            cells = [" "] * len(keys)
            notes: list[str] = []
            if prefill is not None:
                for column, key in enumerate(keys):
                    decision = prefill[1].get((image_id, key), [None] * len(core))[position]
                    if decision is None:
                        continue
                    cells[column] = decision.cell
                    notes.append(decision.notes if len(keys) == 1 else f"{key}: {decision.notes}")
            lines.append(f"| {item} | " + " | ".join(cells) + f" | {' ; '.join(notes) or ' '} |")
        lines.append(
            f"| **core recall (/{len(core)})** | " + " | ".join([" "] * len(keys)) + " |  |"
        )
        lines.append("| **hallucinations** | " + " | ".join([" "] * len(keys)) + " |  |")
        lines.append(
            f"| **{stats_lib.OVER_DECOMPOSED_MARKER}** | "
            + " | ".join([" "] * len(keys))
            + " |  |"
        )
        lines.append("")
        if optional:
            lines += [f"Optional (no recall credit): {', '.join(optional)}", ""]

    lines += [
        "## Totals (fill after scoring)",
        "",
        "| metric | " + " | ".join(keys) + " |",
        "|---|" + "---|" * len(keys),
        f"| core-item recall (/{total_core}) | " + " | ".join([" "] * len(keys)) + " |",
        "| hallucinations | " + " | ".join([" "] * len(keys)) + " |",
        f"| {stats_lib.OVER_DECOMPOSED_MARKER} (composite split into parts) | "
        + " | ".join([" "] * len(keys))
        + " |",
        "| distinct items named (auto) | "
        + " | ".join(str(metrics[k]["distinct_items"]) for k in keys)
        + " |",
        "| cost / plate (auto) | "
        + " | ".join(f"${metrics[k]['cost_per_plate_usd']:.5f}" for k in keys)
        + " |",
        "| latency median s (auto) | "
        + " | ".join(str(metrics[k]["latency_median_s"]) for k in keys)
        + " |",
        "",
        "## Findings",
        "",
        "1. ",
        "",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Filled worksheets: bootstrap CIs, counted error classes, comparisons
# ---------------------------------------------------------------------------


def render_filled_report(worksheet: dict, resamples: int) -> list[str]:
    lines = [
        f"## Scored worksheet: {worksheet['path']}",
        "",
        f"Percentile bootstrap over plates, {resamples} resamples, seed "
        f"{stats_lib.DEFAULT_SEED} (deterministic).",
        "",
        "| approach | plates | gold items | core recall | 95% CI | halluc. | "
        f"{stats_lib.OVER_DECOMPOSED_MARKER} |",
        "|---|---|---|---|---|---|---|",
    ]
    cis: dict[str, dict] = {}
    for approach in worksheet["approaches"]:
        pairs = stats_lib.recall_pairs(worksheet, approach)
        ci = stats_lib.bootstrap_recall_ci(pairs, resamples=resamples)
        cis[approach] = ci
        hits = sum(h for h, _ in pairs)
        lines.append(
            f"| {approach} | {ci['images']} | {ci['items']} | "
            f"{stats_lib.fmt_pct(ci['point'])} ({hits}/{ci['items']}) | "
            f"[{stats_lib.fmt_pct(ci['lo'])} to {stats_lib.fmt_pct(ci['hi'])}] | "
            f"{worksheet['hallucinations'].get(approach, 0)} | "
            f"{worksheet['over_decomposed'].get(approach, 0)} |"
        )
    lines.append("")

    names = list(cis)
    if len(names) >= 2:
        lines += ["| comparison | verdict | rationale |", "|---|---|---|"]
        for i, a in enumerate(names):
            for b in names[i + 1 :]:
                verdict, why = stats_lib.compare_verdict(a, cis[a], b, cis[b])
                lines.append(f"| {a} vs {b} | **{verdict}** | {why} |")
        lines.append("")

    if worksheet["warnings"]:
        lines += [f"- ⚠ {w}" for w in worksheet["warnings"]] + [""]
    return lines


def score_filled(path: Path, resamples: int) -> int:
    try:
        worksheet = load_filled(path)
    except UnresolvedSheet as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    if not worksheet["images"]:
        print(f"ERROR: no filled per-image recall rows found in {path}", file=sys.stderr)
        return 1
    print("\n".join(render_filled_report(worksheet, resamples)))
    return 0


def compare_filled(path_a: Path, path_b: Path, resamples: int) -> int:
    """Compare two filled worksheets; overlapping CIs report UNDECIDED."""
    results: list[tuple[str, list[tuple[int, int]], dict]] = []
    for path in (path_a, path_b):
        try:
            worksheet = load_filled(path)
        except UnresolvedSheet as error:
            print(f"ERROR: {error}", file=sys.stderr)
            return 1
        if not worksheet["approaches"]:
            print(f"ERROR: no approach columns found in {path}", file=sys.stderr)
            return 1
        if len(worksheet["approaches"]) > 1:
            print(
                f"note: {path} scores {len(worksheet['approaches'])} approaches; "
                f"comparing its first, {worksheet['approaches'][0]!r}"
            )
        approach = worksheet["approaches"][0]
        pairs = stats_lib.recall_pairs(worksheet, approach)
        label = f"{approach} ({path.parent.name})"
        results.append((label, pairs, stats_lib.bootstrap_recall_ci(pairs, resamples=resamples)))

    (name_a, pairs_a, ci_a), (name_b, pairs_b, ci_b) = results
    verdict, why = stats_lib.compare_verdict(name_a, ci_a, name_b, ci_b)

    print(f"A: {name_a}, {stats_lib.fmt_ci(ci_a)} over {ci_a['images']} plates / {ci_a['items']} items")
    print(f"B: {name_b}, {stats_lib.fmt_ci(ci_b)} over {ci_b['images']} plates / {ci_b['items']} items")
    print()
    print(f"VERDICT: {verdict}, {why}")

    diff = stats_lib.bootstrap_diff_ci(pairs_a, pairs_b, resamples=resamples)
    if diff is None:
        print(
            "paired test: skipped: the two worksheets do not cover the same number of plates."
        )
        return 0
    excludes_zero = diff["lo"] > 0 or diff["hi"] < 0
    print(
        f"paired difference (A − B): {stats_lib.fmt_pct(diff['point'])} "
        f"[{stats_lib.fmt_pct(diff['lo'])} to {stats_lib.fmt_pct(diff['hi'])}], "
        + ("excludes 0" if excludes_zero else "includes 0")
    )
    if excludes_zero and verdict == "UNDECIDED":
        print(
            "  ^ the paired interval is the more powerful test (same plates on both sides), so "
            "this pair is 'undecided on marginal CIs, separable when paired'. Report both; do "
            "not quote the paired result alone as a clean win."
        )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python3 -m harness.scorecard",
        description="Emit a scoring worksheet from a run's results.json + the gold labels.",
    )
    parser.add_argument(
        "results", type=Path, nargs="?", help="Path to a run's results.json."
    )
    parser.add_argument(
        "--score",
        type=Path,
        default=None,
        metavar="FILLED_MD",
        help="Read a filled worksheet back: recall, bootstrap 95%% CI, counted error classes.",
    )
    parser.add_argument(
        "--compare",
        type=Path,
        nargs=2,
        default=None,
        metavar=("FILLED_A", "FILLED_B"),
        help="Compare two filled worksheets; overlapping CIs report UNDECIDED, not a winner.",
    )
    parser.add_argument(
        "--resamples",
        type=int,
        default=stats_lib.DEFAULT_RESAMPLES,
        help=f"Bootstrap resamples (default {stats_lib.DEFAULT_RESAMPLES}).",
    )
    parser.add_argument(
        "--gold", type=Path, default=None, help="Gold labels (default: <eval root>/gold/gold_labels.json)."
    )
    parser.add_argument(
        "--out", type=Path, default=None, help="Output markdown (default: scorecard.md next to results.json)."
    )
    parser.add_argument(
        "--granularity",
        action="store_true",
        help=(
            "Write granularity.json next to results.json and print its table: items per plate (from results.json) "
            "and, when a filled worksheet exists, strict split recall (gold items covered only by their own item). "
            "The worksheet is written as before."
        ),
    )
    parser.add_argument(
        "--filled",
        type=Path,
        default=None,
        metavar="FILLED_MD",
        help="The filled worksheet --granularity reads (default: scorecard-filled.md next to results.json).",
    )
    parser.add_argument(
        "--prefill",
        action="store_true",
        help=(
            "Prefill the worksheet from earlier filled sheets named by --from: exact model item name, "
            "same plate, same gold item. Unanswerable rows are marked NEEDS JUDGMENT, disputed rows CONFLICT."
        ),
    )
    parser.add_argument(
        "--from",
        dest="sources",
        nargs="+",
        default=None,
        metavar="GLOB_OR_DIR",
        help=(
            "Where --prefill reads earlier filled sheets: globs, files, or directories searched "
            f"recursively for {FILLED_SHEET_NAME}. Put it after the results.json path. The run's own "
            "sheet, and sheets of a run with the same directory name, are skipped."
        ),
    )
    parser.add_argument(
        "--check-against",
        type=Path,
        default=None,
        metavar="FILLED_MD",
        help="With --prefill: compare the prefill with the worksheet a person filled for this run, and report wrong rows.",
    )
    parser.add_argument(
        "--force", action="store_true", help="Let --prefill overwrite an existing output worksheet."
    )
    parser.add_argument("--stdout", action="store_true", help="Also print the worksheet.")
    parser.add_argument("--json", action="store_true", help="Print the mechanical metrics as JSON and exit.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.compare:
        return compare_filled(args.compare[0], args.compare[1], args.resamples)
    if args.score:
        return score_filled(args.score, args.resamples)
    if args.results is None and args.sources and Path(args.sources[-1]).name == "results.json":
        args.results = Path(args.sources.pop())
    if args.results is None:
        build_parser().error("a results.json path is required (or use --score / --compare)")
    if args.sources and not args.prefill:
        build_parser().error("--from only works with --prefill")
    if args.prefill and not args.sources:
        build_parser().error("--prefill needs --from <globs or dirs of filled sheets>")
    if args.check_against and not args.prefill:
        build_parser().error("--check-against only works with --prefill")

    results = load_json(args.results)
    keys = approach_keys(results)

    if args.json:
        json.dump(compute_metrics(results, keys), sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    gold_path = args.gold or (infer_eval_root(args.results) / "gold" / "gold_labels.json")
    gold = load_json(gold_path)

    out_path = args.out or args.results.parent / "scorecard.md"
    prefill = None
    if args.prefill:
        if out_path.exists() and not args.force:
            print(f"ERROR: {out_path} exists; a prefilled sheet may hold work. Use --out or --force.", file=sys.stderr)
            return 1
        sheets, excluded = discover_sheets(
            args.sources,
            own_run=args.results.resolve().parent.name,
            own_paths=(args.results.parent / FILLED_SHEET_NAME, out_path),
        )
        if not sheets:
            print("ERROR: --from found no filled worksheets", file=sys.stderr)
            return 1
        memory = load_memory(sheets, excluded)
        plan = build_prefill_plan(memory, results, {k: v for k, v in gold.items() if not k.startswith("_")}, keys)
        prefill = (memory, plan)

    worksheet = render_worksheet(results, gold, keys, args.results, prefill)
    out_path.write_text(worksheet, encoding="utf-8")
    print(f"Wrote {out_path}")
    if prefill is not None:
        print("\n".join(render_prefill_summary(*prefill)))
        if args.check_against:
            print("\n".join(render_comparison(
                compare_plan_with_filled(prefill[1], args.check_against.read_text(encoding="utf-8")),
                args.check_against,
            )))
    print(f"gold labels: {gold_path}")
    print(f"approaches: {keys}; images: {len(image_ids(results))}")

    # If this run has already been scored by hand, the statistics are available now --
    # print them rather than making the reader remember a second command.
    filled = stats_lib.find_filled_worksheet(args.results)
    if filled is not None and filled.resolve() != out_path.resolve():
        print()
        print("\n".join(render_filled_report(stats_lib.parse_filled_worksheet(filled), args.resamples)))

    if args.granularity:
        gold_entries = {k: v for k, v in gold.items() if not k.startswith("_")}
        filled_for_granularity = args.filled or filled
        report = granularity_lib.granularity_report(
            {k: v for k, v in results.items() if not k.startswith("_")},
            gold_entries,
            keys,
            filled_for_granularity,
            args.results,
        )
        granularity_path = args.results.parent / "granularity.json"
        granularity_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print()
        print("\n".join(granularity_lib.render_report(report)))
        print(f"Wrote {granularity_path}")

    if args.stdout:
        print()
        print(worksheet)
    return 0


if __name__ == "__main__":
    sys.exit(main())
