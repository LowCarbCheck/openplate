"""Turn a results.json into a human scoring worksheet.

    python3 -m harness.scorecard runs/<dir>/results.json [--gold gold/gold_labels.json]
                                 [--out runs/<dir>/scorecard.md] [--stdout]
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
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from pathlib import Path

from . import approaches as approach_lib
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
            f"portion/macro: **unscorable** — gold has no gram ranges "
            f"({with_grams}/{total} covered) and no kcal ranges ({with_kcal}/{total} covered).",
            "",
            "Weighed-gram ground truth is the missing input, not the metric: add `gram_ranges`",
            "(per gold item, `[min, max]` grams) and `kcal_range` (`[min, max]` per plate) to",
            "`gold/gold_labels.json` and both families populate automatically here. Grams must",
            "come from a scale — a gram range guessed off a photo would make portion error",
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
# Worksheet
# ---------------------------------------------------------------------------


def render_worksheet(results: dict, gold: dict, keys: list[str], results_path: Path) -> str:
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
        lines.append(f"- **failures: {len(failures)}** — {json.dumps(failures)}")

    lines += [
        "",
        "## Mechanical metrics (auto-computed)",
        "",
        *render_metrics_table(metrics, keys),
        "",
        *render_portion_macro(portion_macro_metrics(results, gold, keys), keys),
        "## Scoring instructions (human / reviewing agent)",
        "",
        "Semantic matching is NOT automated — fuzzy matching lies exactly where it matters",
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
        "   counts too. It is a named error class, not a recall bonus — mark the gold rows `Y`",
        "   if the parts do cover them, and record the split here so it is counted.",
        "",
        f"`python3 -m harness.scorecard --score <this file>` reads the filled rows back and",
        "prints bootstrap 95% CIs; `--compare A B` reports WINNER or UNDECIDED.",
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

        lines += [f"### {image_id} — {meal}", ""]

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
            lines += ["_No gold entry for this image — add one to `gold/gold_labels.json`._", ""]
            continue

        lines += ["| gold core item | " + " | ".join(keys) + " | notes |",
                  "|---|" + "---|" * len(keys) + "---|"]
        for item in core:
            lines.append(f"| {item} | " + " | ".join([" "] * len(keys)) + " |  |")
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
            f"[{stats_lib.fmt_pct(ci['lo'])} – {stats_lib.fmt_pct(ci['hi'])}] | "
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
    worksheet = stats_lib.parse_filled_worksheet(path)
    if not worksheet["images"]:
        print(f"ERROR: no filled per-image recall rows found in {path}", file=sys.stderr)
        return 1
    print("\n".join(render_filled_report(worksheet, resamples)))
    return 0


def compare_filled(path_a: Path, path_b: Path, resamples: int) -> int:
    """Compare two filled worksheets; overlapping CIs report UNDECIDED."""
    results: list[tuple[str, list[tuple[int, int]], dict]] = []
    for path in (path_a, path_b):
        worksheet = stats_lib.parse_filled_worksheet(path)
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

    print(f"A: {name_a} — {stats_lib.fmt_ci(ci_a)} over {ci_a['images']} plates / {ci_a['items']} items")
    print(f"B: {name_b} — {stats_lib.fmt_ci(ci_b)} over {ci_b['images']} plates / {ci_b['items']} items")
    print()
    print(f"VERDICT: {verdict} — {why}")

    diff = stats_lib.bootstrap_diff_ci(pairs_a, pairs_b, resamples=resamples)
    if diff is None:
        print(
            "paired test: skipped — the two worksheets do not cover the same number of plates."
        )
        return 0
    excludes_zero = diff["lo"] > 0 or diff["hi"] < 0
    print(
        f"paired difference (A − B): {stats_lib.fmt_pct(diff['point'])} "
        f"[{stats_lib.fmt_pct(diff['lo'])} – {stats_lib.fmt_pct(diff['hi'])}] — "
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
    parser.add_argument("--stdout", action="store_true", help="Also print the worksheet.")
    parser.add_argument("--json", action="store_true", help="Print the mechanical metrics as JSON and exit.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.compare:
        return compare_filled(args.compare[0], args.compare[1], args.resamples)
    if args.score:
        return score_filled(args.score, args.resamples)
    if args.results is None:
        build_parser().error("a results.json path is required (or use --score / --compare)")

    results = load_json(args.results)
    keys = approach_keys(results)

    if args.json:
        json.dump(compute_metrics(results, keys), sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    gold_path = args.gold or (infer_eval_root(args.results) / "gold" / "gold_labels.json")
    gold = load_json(gold_path)

    worksheet = render_worksheet(results, gold, keys, args.results)
    out_path = args.out or args.results.parent / "scorecard.md"
    out_path.write_text(worksheet, encoding="utf-8")
    print(f"Wrote {out_path}")
    print(f"gold labels: {gold_path}")
    print(f"approaches: {keys}; images: {len(image_ids(results))}")

    # If this run has already been scored by hand, the statistics are available now --
    # print them rather than making the reader remember a second command.
    filled = stats_lib.find_filled_worksheet(args.results)
    if filled is not None and filled.resolve() != out_path.resolve():
        print()
        print("\n".join(render_filled_report(stats_lib.parse_filled_worksheet(filled), args.resamples)))

    if args.stdout:
        print()
        print(worksheet)
    return 0


if __name__ == "__main__":
    sys.exit(main())
