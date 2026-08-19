"""Bootstrap confidence intervals over a *filled* scoring worksheet.

The scorecard emits a worksheet; a human (or reviewing agent) fills the `Y`/`n`
cells and the per-image `core recall (/N)` rows. This module reads that filled
worksheet back and turns it into statistics:

  * a per-image recall vector per approach,
  * a percentile bootstrap 95 % CI on core-item recall,
  * a verdict for a two-approach comparison that says **UNDECIDED** when the
    intervals overlap rather than naming a winner.

Why the bootstrap resamples *images*, not items: the 235 gold core items are
nested inside 50 plates, and a plate's items succeed or fail together (a model
that reads the wrong dish misses all of it). Resampling items independently
would pretend they are independent trials and produce intervals that are far
too narrow. This is a cluster bootstrap over plates -- the unit that was
actually sampled when the corpus was built.

Determinism is a hard requirement of this harness (same responses in -> same
scores out), so the resampler is seeded from a constant, never from the clock.
No model is called from here.
"""

from __future__ import annotations

import random
import re
from pathlib import Path

DEFAULT_RESAMPLES = 10000
DEFAULT_SEED = 20260813
DEFAULT_ALPHA = 0.05

#: Marker a reviewer writes in an approach's cell (or in a dedicated worksheet
#: row) when the approach split one composite dish into its parts -- "a stew is
#: not five foods". Counted as its own error class, never as a recall bonus.
OVER_DECOMPOSED_MARKER = "over-decomposed"

_IMAGE_HEADING_RE = re.compile(r"^###\s+([0-9A-Za-z_-]+)\b")
_RECALL_ROW_RE = re.compile(r"core recall\s*\(/(\d+)\)")
_COUNT_RE = re.compile(r"(\d+)\s*/\s*(\d+)|(\d+)")


# ---------------------------------------------------------------------------
# Worksheet parsing
# ---------------------------------------------------------------------------


def _split_row(line: str) -> list[str]:
    stripped = line.strip()
    if not stripped.startswith("|"):
        return []
    cells = stripped.strip("|").split("|")
    return [c.strip() for c in cells]


def _clean(cell: str) -> str:
    return cell.replace("*", "").replace("`", "").strip()


def _parse_hits(cell: str, total: int | None) -> tuple[int, int] | None:
    """`6/6` -> (6, 6); a bare `5` -> (5, total from the row label)."""
    text = _clean(cell)
    if not text or text in {"-", "--", "n/a", "–"}:
        return None
    match = _COUNT_RE.search(text)
    if match is None:
        return None
    if match.group(1) is not None:
        return int(match.group(1)), int(match.group(2))
    if total is None:
        return None
    return int(match.group(3)), total


def _parse_count(cell: str) -> int:
    """Count an error-class cell.

    Reviewers write these two ways and both are in the committed worksheets: a
    bare count (`2`, `none`) or the offending items themselves (`grilled chicken
    breast, Coke`). A list counts as its comma/semicolon-separated entries.
    """
    text = _clean(cell)
    if not text or text.lower() in {"none", "-", "--", "–", "n/a", "0"}:
        return 0
    if re.fullmatch(r"\d+", text):
        return int(text)
    return len([part for part in re.split(r"[,;]", text) if part.strip()])


def parse_filled_worksheet(path: Path) -> dict:
    """Read a filled worksheet into per-image recall + counted error classes.

    Tolerant by design: reviewers annotate cells (`6/6`, a bare `6`, `Y?`,
    trailing prose) and the four 2026-08-12 worksheets already disagree on the
    recall-cell format. Anything unparseable is reported in `warnings` rather
    than silently dropped -- a worksheet that half-parsed would produce a
    confident CI over a fifth of the corpus.
    """
    if not path.is_file():
        raise SystemExit(f"ERROR: filled worksheet not found: {path}")

    approaches: list[str] = []
    images: dict[str, dict[str, tuple[int, int]]] = {}
    over_decomposed: dict[str, int] = {}
    hallucinations: dict[str, int] = {}
    warnings: list[str] = []

    current_image: str | None = None
    current_cols: list[str] = []

    for line in path.read_text(encoding="utf-8").splitlines():
        heading = _IMAGE_HEADING_RE.match(line)
        if heading:
            current_image = heading.group(1)
            current_cols = []
            continue

        cells = _split_row(line)
        if not cells:
            continue

        first = _clean(cells[0]).lower()
        if first in {"metric", "gold item", "image", "img"}:
            # a non-scoring table (mechanical metrics, per-image summary, Totals).
            # Dropping the column binding here is what keeps the Totals table's own
            # `hallucinations` / over-decomposed rows from being counted twice.
            current_cols = []
            current_image = None
            continue

        if first == "gold core item":
            # header of an image's scoring table: `| gold core item | <a> [| <b>...] | notes |`
            cols = [_clean(c) for c in cells[1:]]
            if cols and cols[-1].lower() in {"notes", "note"}:
                cols = cols[:-1]
            current_cols = cols
            for col in cols:
                if col and col not in approaches:
                    approaches.append(col)
            continue

        if not current_cols:
            continue

        label = _clean(cells[0]).lower()
        values = cells[1 : 1 + len(current_cols)]

        recall_match = _RECALL_ROW_RE.search(label)
        if recall_match and current_image:
            total = int(recall_match.group(1))
            for col, cell in zip(current_cols, values):
                parsed = _parse_hits(cell, total)
                if parsed is None:
                    warnings.append(f"{current_image}/{col}: unparseable recall cell {cell!r}")
                    continue
                hits, denom = parsed
                images.setdefault(current_image, {})[col] = (hits, denom)
            continue

        if label.startswith("hallucination"):
            for col, cell in zip(current_cols, values):
                hallucinations[col] = hallucinations.get(col, 0) + _parse_count(cell)
            continue

        if OVER_DECOMPOSED_MARKER in label:
            # explicit per-approach row wins over inline cell markers
            for col, cell in zip(current_cols, values):
                over_decomposed[col] = over_decomposed.get(col, 0) + _parse_count(cell)
            continue

        # an ordinary gold-item row: a reviewer may mark the error class inline
        for col, cell in zip(current_cols, values):
            if OVER_DECOMPOSED_MARKER in cell.lower():
                over_decomposed[col] = over_decomposed.get(col, 0) + 1

    return {
        "path": str(path),
        "approaches": approaches,
        "images": images,
        "over_decomposed": over_decomposed,
        "hallucinations": hallucinations,
        "warnings": warnings,
    }


def recall_pairs(worksheet: dict, approach: str) -> list[tuple[int, int]]:
    """The per-image `(hits, gold_total)` vector for one approach, image order."""
    return [
        per_image[approach]
        for _, per_image in sorted(worksheet["images"].items())
        if approach in per_image
    ]


def find_filled_worksheet(results_path: Path) -> Path | None:
    """`runs/<dir>/results.json` -> `runs/<dir>/scorecard-filled.md`, if scored."""
    candidate = results_path.parent / "scorecard-filled.md"
    return candidate if candidate.is_file() else None


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------


def _percentile(sorted_values: list[float], q: float) -> float:
    if not sorted_values:
        return float("nan")
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = (len(sorted_values) - 1) * q
    low = int(position)
    high = min(low + 1, len(sorted_values) - 1)
    return sorted_values[low] + (sorted_values[high] - sorted_values[low]) * (position - low)


def _recall(pairs: list[tuple[int, int]]) -> float | None:
    total = sum(total for _, total in pairs)
    if not total:
        return None
    return sum(hits for hits, _ in pairs) / total


def bootstrap_recall_ci(
    pairs: list[tuple[int, int]],
    *,
    resamples: int = DEFAULT_RESAMPLES,
    alpha: float = DEFAULT_ALPHA,
    seed: int = DEFAULT_SEED,
) -> dict:
    """Percentile bootstrap CI on core-item recall, resampling plates."""
    point = _recall(pairs)
    if point is None:
        return {"point": None, "lo": None, "hi": None, "images": len(pairs), "items": 0,
                "resamples": resamples}
    rng = random.Random(seed)
    n = len(pairs)
    draws: list[float] = []
    for _ in range(resamples):
        sample = [pairs[rng.randrange(n)] for _ in range(n)]
        value = _recall(sample)
        if value is not None:
            draws.append(value)
    draws.sort()
    return {
        "point": point,
        "lo": _percentile(draws, alpha / 2),
        "hi": _percentile(draws, 1 - alpha / 2),
        "images": n,
        "items": sum(total for _, total in pairs),
        "resamples": resamples,
    }


def bootstrap_diff_ci(
    pairs_a: list[tuple[int, int]],
    pairs_b: list[tuple[int, int]],
    *,
    resamples: int = DEFAULT_RESAMPLES,
    alpha: float = DEFAULT_ALPHA,
    seed: int = DEFAULT_SEED,
) -> dict | None:
    """CI on (recall A - recall B), **paired** on the plate when both scored the
    same images: the same resampled plate indices are used for both approaches,
    which removes plate difficulty from the variance and is strictly more
    powerful than comparing two marginal intervals. Returns None when the two
    worksheets do not cover the same number of plates (nothing to pair on).
    """
    if len(pairs_a) != len(pairs_b) or not pairs_a:
        return None
    rng = random.Random(seed)
    n = len(pairs_a)
    draws: list[float] = []
    for _ in range(resamples):
        indices = [rng.randrange(n) for _ in range(n)]
        a = _recall([pairs_a[i] for i in indices])
        b = _recall([pairs_b[i] for i in indices])
        if a is not None and b is not None:
            draws.append(a - b)
    draws.sort()
    point_a, point_b = _recall(pairs_a), _recall(pairs_b)
    return {
        "point": (point_a - point_b) if (point_a is not None and point_b is not None) else None,
        "lo": _percentile(draws, alpha / 2),
        "hi": _percentile(draws, 1 - alpha / 2),
        "images": n,
        "resamples": resamples,
    }


def intervals_overlap(ci_a: dict, ci_b: dict) -> bool:
    return not (ci_a["hi"] < ci_b["lo"] or ci_b["hi"] < ci_a["lo"])


def compare_verdict(name_a: str, ci_a: dict, name_b: str, ci_b: dict) -> tuple[str, str]:
    """('UNDECIDED'|'WINNER', one-line rationale).

    Overlapping intervals are reported as UNDECIDED, never as a winner -- the
    rule this milestone's counsel put on the harness so that "the eval settled
    it" cannot be rationalisation with extra steps.
    """
    if ci_a["point"] is None or ci_b["point"] is None:
        return "UNDECIDED", "one side has no scored items"
    if intervals_overlap(ci_a, ci_b):
        return (
            "UNDECIDED",
            f"95% CIs overlap ({name_a} {fmt_ci(ci_a)} vs {name_b} {fmt_ci(ci_b)})",
        )
    leader, follower = (name_a, name_b) if ci_a["point"] > ci_b["point"] else (name_b, name_a)
    return "WINNER", f"{leader} > {follower}; 95% CIs are disjoint"


def fmt_pct(value: float | None) -> str:
    return "-" if value is None else f"{value * 100:.1f}%"


def fmt_ci(ci: dict) -> str:
    if ci.get("point") is None:
        return "n/a"
    return f"{fmt_pct(ci['point'])} [{fmt_pct(ci['lo'])} – {fmt_pct(ci['hi'])}]"
