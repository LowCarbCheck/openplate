"""Granularity: how finely a model splits a plate, beside the adjudicated recall.

Recall gives full credit when one reported item covers several gold core items ("pasta with sauce and cheese"
covers pasta, sauce and cheese), so a model that merges everything can score as well as one that lists each
food. For logging that matters: a merged item gets one name, one macro line and one set of flags for what were
three foods. Two numbers make the difference visible.

ITEMS PER PLATE (mechanical, from `results.json` and the gold core counts)
    How many items the approach reported per plate, overall and on the plates with at least four gold core items,
    where merging is possible at all. On those plates the ratio of reported items to gold core items is the
    plain granularity figure: 1.0 is one item per core item, 0.5 is two core items per reported item.

STRICT SPLIT RECALL (from a filled worksheet)
    A gold core item counts only when it is its OWN item, not merged with another core item. Whether an item was
    merged is a judgement about meaning, the same kind of judgement as `Y`/`n`, so it is not automated: matching
    stays with the reviewer, as the README says. The reviewer writes the word `merged` in the gold-item cell,
    after the `Y` (`Y merged`), when the item was covered only by a reported item that also covers another core
    item. That is the same convention as `over-decomposed`, which is also written inside a cell. The worksheet
    layout does not change, the recall rows and `stats.parse_filled_worksheet` read the same file as before.

        strict recall = (core items marked Y without `merged`) / (core items)

Strict recall is never above plain recall. The gap between them is the share of credit that merging gave.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass
from pathlib import Path

from . import approaches as approach_lib
from . import stats as stats_lib

MERGED_MARKER = "merged"
DENSE_PLATE_MIN_CORE = 4

_IMAGE_HEADING_RE = re.compile(r"^###\s+([0-9A-Za-z_-]+)\b")
_RECALL_ROW_RE = re.compile(r"core recall\s*\(/(\d+)\)")


@dataclass(frozen=True)
class ItemMark:
    item: str
    state: str  # "hit", "miss" or "blank"
    merged: bool


def classify_cell(cell: str) -> tuple[str, bool]:
    """`Y` / `Y?` / `Y merged` -> ("hit", merged?); `n` / `n?` -> ("miss", False); anything else is blank."""
    text = cell.replace("*", "").replace("`", "").strip().lower()
    if not text:
        return "blank", False
    if re.match(r"^y(es)?\b|^y\?", text):
        return "hit", MERGED_MARKER in text
    if re.match(r"^no?\b|^n\?", text):
        return "miss", False
    return "blank", False


def _split_row(line: str) -> list[str]:
    stripped = line.strip()
    if not stripped.startswith("|"):
        return []
    return [c.strip() for c in stripped.strip("|").split("|")]


def parse_item_marks(path: Path) -> dict[str, dict[str, list[ItemMark]]]:
    """image id -> approach column -> the per gold core item marks of a filled worksheet."""
    if not path.is_file():
        raise SystemExit(f"ERROR: filled worksheet not found: {path}")
    marks: dict[str, dict[str, list[ItemMark]]] = {}
    image: str | None = None
    columns: list[str] = []
    in_items = False
    for line in path.read_text(encoding="utf-8").splitlines():
        heading = _IMAGE_HEADING_RE.match(line)
        if heading:
            image, columns, in_items = heading.group(1), [], False
            continue
        cells = _split_row(line)
        if not cells:
            continue
        label = cells[0].replace("*", "").replace("`", "").strip().lower()
        if label == "gold core item":
            columns = [c.replace("*", "").replace("`", "").strip() for c in cells[1:]]
            if columns and columns[-1].lower() in {"notes", "note"}:
                columns = columns[:-1]
            in_items = True
            continue
        if not in_items or image is None:
            continue
        if _RECALL_ROW_RE.search(label):
            in_items = False
            continue
        if set(label) <= {"-", ":", " "}:
            continue  # the markdown separator row
        for column, cell in zip(columns, cells[1 : 1 + len(columns)]):
            state, merged = classify_cell(cell)
            marks.setdefault(image, {}).setdefault(column, []).append(ItemMark(cells[0], state, merged))
    return marks


def strict_split_recall(marks: dict[str, dict[str, list[ItemMark]]], approach: str) -> dict:
    """Plain and strict recall for one approach over every scored plate of a filled worksheet.

    A plate counts as scored only when none of its item cells is blank: a half-filled plate would lower both
    numbers for a reason that has nothing to do with the model.
    """
    pairs: list[tuple[int, int]] = []
    plain_pairs: list[tuple[int, int]] = []
    skipped: list[str] = []
    hits = merged_hits = total = 0
    for image, per_approach in sorted(marks.items()):
        items = per_approach.get(approach)
        if not items:
            continue
        if any(item.state == "blank" for item in items):
            skipped.append(image)
            continue
        plate_hits = sum(1 for item in items if item.state == "hit")
        plate_merged = sum(1 for item in items if item.state == "hit" and item.merged)
        hits += plate_hits
        merged_hits += plate_merged
        total += len(items)
        pairs.append((plate_hits - plate_merged, len(items)))
        plain_pairs.append((plate_hits, len(items)))
    if not total:
        return {"scored": False, "plates": 0, "skipped_plates": skipped}
    return {
        "scored": True,
        "plates": len(pairs),
        "skipped_plates": skipped,
        "core_items": total,
        "hits": hits,
        "merged_hits": merged_hits,
        "strict_hits": hits - merged_hits,
        "recall": hits / total,
        "strict_recall": (hits - merged_hits) / total,
        "merged_share_of_hits": (merged_hits / hits) if hits else 0.0,
        "strict_recall_ci": stats_lib.bootstrap_recall_ci(pairs),
        "recall_ci": stats_lib.bootstrap_recall_ci(plain_pairs),
    }


def items_per_plate(results: dict, gold: dict, approach: str, min_core: int = DENSE_PLATE_MIN_CORE) -> dict:
    """Items reported per plate, and per gold core item on the plates dense enough to be merged."""
    counts: list[int] = []
    dense_items: list[int] = []
    dense_core: list[int] = []
    for image_id in [k for k in results if not k.startswith("_")]:
        result = results[image_id].get(approach)
        if not isinstance(result, dict) or ("error" in result and "foods" not in result and "final" not in result):
            continue
        reported = len(approach_lib.approach_foods(result))
        counts.append(reported)
        core = len((gold.get(image_id) or {}).get("core") or [])
        if core >= min_core:
            dense_items.append(reported)
            dense_core.append(core)
    summary: dict = {
        "plates": len(counts),
        "items_total": sum(counts),
        "items_mean": round(statistics.mean(counts), 3) if counts else None,
        "items_median": statistics.median(counts) if counts else None,
        "dense_min_core": min_core,
        "dense_plates": len(dense_items),
        "dense_items_mean": round(statistics.mean(dense_items), 3) if dense_items else None,
        "dense_core_mean": round(statistics.mean(dense_core), 3) if dense_core else None,
        "dense_items_per_core": round(sum(dense_items) / sum(dense_core), 3) if dense_core else None,
    }
    return summary


def granularity_report(
    results: dict, gold: dict, approaches: list[str], filled_worksheet: Path | None, results_path: Path
) -> dict:
    marks = parse_item_marks(filled_worksheet) if filled_worksheet is not None else None
    report: dict = {
        "results": str(results_path),
        "filled_worksheet": str(filled_worksheet) if filled_worksheet else None,
        "merged_marker": MERGED_MARKER,
        "dense_plate_min_core": DENSE_PLATE_MIN_CORE,
        "approaches": {},
        "warnings": [],
    }
    for approach in approaches:
        entry = {"items_per_plate": items_per_plate(results, gold, approach)}
        if marks is None:
            entry["strict_split"] = {"scored": False, "reason": "no filled worksheet"}
        else:
            entry["strict_split"] = strict_split_recall(marks, approach)
            skipped = entry["strict_split"].get("skipped_plates") or []
            if skipped:
                report["warnings"].append(f"{approach}: plates with a blank item cell were not scored: {skipped}")
            if not entry["strict_split"]["scored"] and marks:
                report["warnings"].append(
                    f"{approach}: no scored plates in the worksheet; its columns are {sorted({c for p in marks.values() for c in p})}"
                )
        report["approaches"][approach] = entry
    return report


def render_report(report: dict) -> list[str]:
    lines = [
        "## Granularity (auto-computed)",
        "",
        f"Items per plate come from results.json. Strict split recall reads `{MERGED_MARKER}` marks in a filled "
        "worksheet (`Y merged` = covered, but only by an item that also covers another core item).",
        "",
        "| approach | items/plate | items/plate (plates with >= "
        f"{report['dense_plate_min_core']} core) | items per core item (those plates) | recall | strict split recall | merged share of hits |",
        "|---|---|---|---|---|---|---|",
    ]
    for approach, entry in report["approaches"].items():
        ipp = entry["items_per_plate"]
        strict = entry["strict_split"]
        if strict.get("scored"):
            recall = f"{strict['recall']:.1%}"
            strict_recall = (
                f"{strict['strict_recall']:.1%} "
                f"[{strict['strict_recall_ci']['lo']:.1%} to {strict['strict_recall_ci']['hi']:.1%}]"
            )
            merged_share = f"{strict['merged_share_of_hits']:.1%}"
        else:
            recall = strict_recall = merged_share = "-"
        lines.append(
            f"| {approach} | {ipp['items_mean']} | {ipp['dense_items_mean']} ({ipp['dense_plates']} plates) | "
            f"{ipp['dense_items_per_core']} | {recall} | {strict_recall} | {merged_share} |"
        )
    lines.append("")
    lines += [f"- warning: {w}" for w in report["warnings"]] + ([""] if report["warnings"] else [])
    return lines
