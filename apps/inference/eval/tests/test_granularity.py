"""Granularity: items per plate and strict split recall, on a merged and a split sample."""

from __future__ import annotations

import contextlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from harness import granularity, scorecard

GOLD = {
    "01": {"meal": "pasta plate", "core": ["pasta", "tomato sauce", "parmesan", "basil"], "optional": []},
    "02": {"meal": "breakfast", "core": ["egg", "toast", "butter", "coffee"], "optional": []},
}

# `split` lists every food on its own, `merged` folds three foods into one item per plate.
RESULTS = {
    "01": {
        "split": {"foods": [{"name": "pasta"}, {"name": "tomato sauce"}, {"name": "parmesan"}, {"name": "basil"}]},
        "merged": {"foods": [{"name": "pasta with tomato sauce, parmesan and basil"}]},
    },
    "02": {
        "split": {"foods": [{"name": "fried egg"}, {"name": "toast"}, {"name": "butter"}, {"name": "coffee"}]},
        "merged": {"foods": [{"name": "egg on buttered toast"}, {"name": "coffee"}]},
    },
}

FILLED = """# worksheet

### 01, pasta plate

- **split**: pasta, tomato sauce, parmesan, basil
- **merged**: pasta with tomato sauce, parmesan and basil

| gold core item | split | merged | notes |
|---|---|---|---|
| pasta | Y | Y merged |  |
| tomato sauce | Y | Y merged |  |
| parmesan | Y | Y merged |  |
| basil | Y | Y merged |  |
| **core recall (/4)** | 4/4 | 4/4 |  |
| **hallucinations** |  |  |  |
| **over-decomposed** |  |  |  |

### 02, breakfast

| gold core item | split | merged | notes |
|---|---|---|---|
| egg | Y | Y merged |  |
| toast | Y | Y merged |  |
| butter | Y | Y merged |  |
| coffee | Y | Y |  |
| **core recall (/4)** | 4/4 | 4/4 |  |
| **hallucinations** |  |  |  |
| **over-decomposed** |  |  |  |

## Totals (fill after scoring)

| metric | split | merged |
|---|---|---|
| core-item recall (/8) | 8/8 | 8/8 |
"""


class Fixture(unittest.TestCase):
    def worksheet(self, text: str = FILLED) -> Path:
        directory = Path(tempfile.mkdtemp(prefix="gran-"))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        path = directory / "scorecard-filled.md"
        path.write_text(text, encoding="utf-8")
        return path


class ItemsPerPlate(unittest.TestCase):
    def test_split_reports_more_items_than_merged(self):
        split = granularity.items_per_plate(RESULTS, GOLD, "split")
        merged = granularity.items_per_plate(RESULTS, GOLD, "merged")
        self.assertEqual(split["items_mean"], 4)
        self.assertEqual(merged["items_mean"], 1.5)
        self.assertEqual(split["dense_items_per_core"], 1.0)
        self.assertEqual(merged["dense_items_per_core"], 0.375)
        self.assertGreater(split["items_mean"], merged["items_mean"])

    def test_a_plate_below_the_dense_threshold_is_left_out_of_the_dense_figure(self):
        gold = {"01": {"core": ["a", "b"]}}
        results = {"01": {"x": {"foods": [{"name": "a"}]}}}
        summary = granularity.items_per_plate(results, gold, "x")
        self.assertEqual(summary["dense_plates"], 0)
        self.assertIsNone(summary["dense_items_per_core"])
        self.assertEqual(summary["items_mean"], 1)

    def test_a_failed_call_is_not_counted_as_zero_items(self):
        results = {"01": {"x": {"error": "boom"}}, "02": {"x": {"foods": [{"name": "a"}, {"name": "b"}]}}}
        summary = granularity.items_per_plate(results, GOLD, "x")
        self.assertEqual(summary["plates"], 1)
        self.assertEqual(summary["items_mean"], 2)

    def test_an_ensemble_result_counts_the_final_answer(self):
        results = {"01": {"x": {"final": {"foods": [{"name": "a"}, {"name": "b"}, {"name": "c"}]}}}}
        self.assertEqual(granularity.items_per_plate(results, GOLD, "x")["items_mean"], 3)


class StrictSplitRecall(Fixture):
    def test_merged_credit_does_not_count_for_strict_recall(self):
        marks = granularity.parse_item_marks(self.worksheet())
        split = granularity.strict_split_recall(marks, "split")
        merged = granularity.strict_split_recall(marks, "merged")
        self.assertEqual((split["recall"], split["strict_recall"]), (1.0, 1.0))
        self.assertEqual(merged["recall"], 1.0)
        self.assertEqual(merged["strict_recall"], 1 / 8)
        self.assertEqual(merged["merged_hits"], 7)
        self.assertEqual(merged["merged_share_of_hits"], 7 / 8)

    def test_strict_recall_is_never_above_plain_recall(self):
        marks = granularity.parse_item_marks(self.worksheet())
        for approach in ("split", "merged"):
            result = granularity.strict_split_recall(marks, approach)
            self.assertLessEqual(result["strict_recall"], result["recall"])

    def test_a_miss_is_not_a_merge(self):
        text = FILLED.replace("| pasta | Y | Y merged |", "| pasta | Y | n |")
        marks = granularity.parse_item_marks(self.worksheet(text))
        merged = granularity.strict_split_recall(marks, "merged")
        self.assertEqual(merged["hits"], 7)
        self.assertEqual(merged["merged_hits"], 6)
        self.assertEqual(merged["strict_hits"], 1)

    def test_a_plate_with_a_blank_cell_is_skipped_and_named(self):
        text = FILLED.replace("| coffee | Y | Y |", "| coffee | Y |   |")
        marks = granularity.parse_item_marks(self.worksheet(text))
        merged = granularity.strict_split_recall(marks, "merged")
        self.assertEqual(merged["skipped_plates"], ["02"])
        self.assertEqual(merged["plates"], 1)
        self.assertEqual(merged["core_items"], 4)

    def test_yes_and_question_marks_are_read(self):
        self.assertEqual(granularity.classify_cell("Y"), ("hit", False))
        self.assertEqual(granularity.classify_cell("**Y merged**"), ("hit", True))
        self.assertEqual(granularity.classify_cell("y? merged"), ("hit", True))
        self.assertEqual(granularity.classify_cell("n"), ("miss", False))
        self.assertEqual(granularity.classify_cell("no"), ("miss", False))
        self.assertEqual(granularity.classify_cell(" "), ("blank", False))
        self.assertEqual(granularity.classify_cell("over-decomposed"), ("blank", False))

    def test_the_recall_and_hallucination_rows_are_not_items(self):
        marks = granularity.parse_item_marks(self.worksheet())
        self.assertEqual([m.item for m in marks["01"]["split"]], ["pasta", "tomato sauce", "parmesan", "basil"])

    def test_an_unknown_approach_is_unscored_not_zero(self):
        marks = granularity.parse_item_marks(self.worksheet())
        self.assertEqual(granularity.strict_split_recall(marks, "absent")["scored"], False)

    def test_the_old_parser_still_reads_a_worksheet_with_merged_marks(self):
        from harness import stats

        parsed = stats.parse_filled_worksheet(self.worksheet())
        self.assertEqual(parsed["images"]["01"]["merged"], (4, 4))
        self.assertEqual(parsed["warnings"], [])


class TheReport(Fixture):
    def test_the_report_puts_split_and_merged_side_by_side(self):
        report = granularity.granularity_report(RESULTS, GOLD, ["split", "merged"], self.worksheet(), Path("results.json"))
        split, merged = report["approaches"]["split"], report["approaches"]["merged"]
        self.assertGreater(split["items_per_plate"]["items_mean"], merged["items_per_plate"]["items_mean"])
        self.assertGreater(split["strict_split"]["strict_recall"], merged["strict_split"]["strict_recall"])
        table = "\n".join(granularity.render_report(report))
        self.assertIn("| split |", table)
        self.assertIn("12.5%", table)

    def test_without_a_worksheet_only_the_mechanical_numbers_appear(self):
        report = granularity.granularity_report(RESULTS, GOLD, ["split"], None, Path("results.json"))
        self.assertFalse(report["approaches"]["split"]["strict_split"]["scored"])
        self.assertEqual(report["approaches"]["split"]["items_per_plate"]["items_mean"], 4)

    def test_the_scorecard_option_writes_granularity_json_and_keeps_the_worksheet(self):
        directory = Path(tempfile.mkdtemp(prefix="gran-run-"))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        results = {"_summary": {"config_name": "t"}, **RESULTS}
        (directory / "results.json").write_text(json.dumps(results), encoding="utf-8")
        gold = directory / "gold.json"
        gold.write_text(json.dumps(GOLD), encoding="utf-8")
        (directory / "scorecard-filled.md").write_text(FILLED, encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            code = scorecard.main([str(directory / "results.json"), "--gold", str(gold), "--granularity"])
        self.assertEqual(code, 0)
        report = json.loads((directory / "granularity.json").read_text(encoding="utf-8"))
        self.assertEqual(report["approaches"]["merged"]["strict_split"]["strict_hits"], 1)
        worksheet = (directory / "scorecard.md").read_text(encoding="utf-8")
        self.assertIn("| gold core item | split | merged | notes |", worksheet)
        self.assertIn("Y merged", worksheet)

    def test_control_without_the_option_no_granularity_file_is_written(self):
        directory = Path(tempfile.mkdtemp(prefix="gran-run-"))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        (directory / "results.json").write_text(json.dumps({"_summary": {}, **RESULTS}), encoding="utf-8")
        gold = directory / "gold.json"
        gold.write_text(json.dumps(GOLD), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            scorecard.main([str(directory / "results.json"), "--gold", str(gold)])
        self.assertFalse((directory / "granularity.json").exists())


if __name__ == "__main__":
    unittest.main()
