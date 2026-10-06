"""`--prefill`: the verdict memory, the row decisions, and the `--score` guards.

Every positive case has a control that makes the same assertion fail: a
different name, an unremembered item, swapped mtimes, a sheet without markers.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import re
import tempfile
import unittest
from pathlib import Path

from harness import scorecard

GOLD = {
    "_note": "test gold",
    "01": {"meal": "breakfast", "core": ["scrambled eggs", "bacon/ham slices"], "optional": []},
    "02": {"meal": "rice plate", "core": ["rice"], "optional": []},
}


def sheet(run_items: dict[str, list[str]], rows: dict[str, list[tuple[str, str, str]]], column: str = "production") -> str:
    """A filled sheet: run_items plate -> reported names, rows plate -> (gold, cell, notes)."""
    lines = ["# worksheet", ""]
    for plate, items in run_items.items():
        lines += [f"### {plate}, meal", "", f"- **{column}**: " + (", ".join(items) or "(none)"), ""]
        lines += [f"| gold core item | {column} | notes |", "|---|---|---|"]
        for gold, cell, notes in rows[plate]:
            lines.append(f"| {gold} | {cell} | {notes} |")
        hits = sum(1 for _g, c, _n in rows[plate] if c.startswith("Y"))
        lines += [
            f"| **core recall (/{len(rows[plate])})** | {hits}/{len(rows[plate])} |  |",
            "| **hallucinations** | none |  |",
            "| **over-decomposed** | 0 |  |",
            "",
        ]
    return "\n".join(lines)


def results_for(items_by_plate: dict[str, list[str]], key: str = "production") -> dict:
    return {
        plate: {key: {"foods": [{"name": n} for n in names]}} for plate, names in items_by_plate.items()
    } | {"_summary": {"approaches": [key]}}


class Workspace:
    def __init__(self, testcase: unittest.TestCase) -> None:
        self.root = Path(tempfile.mkdtemp())
        testcase.addCleanup(lambda: __import__("shutil").rmtree(self.root, ignore_errors=True))

    def write_sheet(self, run: str, text: str, mtime: float | None = None, base: str = "runs") -> Path:
        path = self.root / base / run / "scorecard-filled.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        if mtime is not None:
            os.utime(path, (mtime, mtime))
        return path

    def write_run(self, run: str, items_by_plate: dict[str, list[str]]) -> Path:
        path = self.root / "newruns" / run / "results.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(results_for(items_by_plate)), encoding="utf-8")
        gold = self.root / "gold.json"
        gold.write_text(json.dumps(GOLD), encoding="utf-8")
        return path

    @property
    def gold(self) -> Path:
        return self.root / "gold.json"


def run_main(argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = scorecard.main(argv)
    return code, out.getvalue(), err.getvalue()


def memory_from(ws: Workspace, own_run: str | None = None) -> scorecard.VerdictMemory:
    sheets, excluded = scorecard.discover_sheets([str(ws.root / "runs")], own_run=own_run)
    return scorecard.load_memory(sheets, excluded)


class NormalisationTest(unittest.TestCase):
    def test_lower_trim_collapse(self) -> None:
        self.assertEqual(scorecard.normalize_item_name("  Ham   SLICES\t"), "ham slices")

    def test_no_fuzzy_matching(self) -> None:
        # control: the assertion above is not "everything normalises equal"
        self.assertNotEqual(scorecard.normalize_item_name("ham"), scorecard.normalize_item_name("ham slices"))
        self.assertNotEqual(scorecard.normalize_item_name("fried egg"), scorecard.normalize_item_name("fried eggs"))
        self.assertNotEqual(scorecard.normalize_item_name("Greek salad"), scorecard.normalize_item_name("greek-salad"))

    def test_gold_key_reads_dashes_as_a_comma(self) -> None:
        key = scorecard.normalize_gold_name
        expected = "battered fried fish (cod), partly eaten"
        for spelling in (
            "battered fried fish (cod) \u2014 partly eaten",
            "Battered fried fish (cod) \u2013 partly  eaten",
            "battered fried fish (cod) - partly eaten",
            "battered fried fish (cod), partly eaten",
        ):
            self.assertEqual(key(spelling), expected, spelling)
        # control: a hyphen inside a word and a different row stay different
        self.assertNotEqual(key("stir-fried rice"), key("stir, fried rice"))
        self.assertNotEqual(key("fried fish, partly eaten"), key("fried fish, fully eaten"))

    def test_dashed_gold_row_is_matched_from_a_comma_sheet(self) -> None:
        ws = Workspace(self)
        dashed = "battered fried fish (cod) \u2014 partly eaten"
        ws.write_sheet(
            "src",
            sheet(
                {"41": ["Fried fish"]},
                {"41": [("battered fried fish (cod), partly eaten", "Y", '"Fried fish" is the cod')]},
            ),
        )
        memory = memory_from(ws)
        hit = scorecard.decide_row(memory, "41", dashed, ["Fried fish"])
        self.assertEqual((hit.kind, hit.cell), ("Y", "Y"))
        self.assertIn("src", hit.notes)
        # control: a different gold row on the same plate is still not matched
        other = scorecard.decide_row(memory, "41", "chips", ["Fried fish"])
        self.assertEqual(other.kind, "needs")

    def test_check_against_pairs_a_dashed_gold_row_with_its_comma_row(self) -> None:
        ws = Workspace(self)
        dashed = "slice of cake \u2013 partly eaten"
        ws.write_sheet("src", sheet({"48": ["Cake"]}, {"48": [("slice of cake, partly eaten", "Y", '"Cake"')]}))
        memory = memory_from(ws)
        plan = {("48", "production"): [scorecard.decide_row(memory, "48", dashed, ["Cake"])]}
        filled = sheet({"48": ["Cake"]}, {"48": [("slice of cake, partly eaten", "Y", '"Cake"')]})
        result = scorecard.compare_plan_with_filled(plan, filled)
        self.assertEqual((result["decided"], result["right"], result["unscorable"]), (1, 1, 0))

    def test_verdict_parsing(self) -> None:
        self.assertEqual(scorecard.parse_verdict(" Y "), "Y")
        self.assertEqual(scorecard.parse_verdict("y  merged"), "Y merged")
        self.assertEqual(scorecard.parse_verdict("N"), "n")
        for uncertain in ("Y?", "n?", "", " ", "0", "6/6"):
            self.assertIsNone(scorecard.parse_verdict(uncertain), uncertain)


class MatchedItemTest(unittest.TestCase):
    ITEMS = ["Ham slices", "Small sausages", "Scrambled eggs"]

    def test_first_quote_outside_parentheses(self) -> None:
        notes = '"Ham slices" (C3 "cooked ham or bacon slices", D3 "ham")'
        self.assertEqual(scorecard.matched_item(notes, self.ITEMS), "Ham slices")

    def test_quote_inside_parentheses_is_another_sheets_item(self) -> None:
        # control: the only reported-item quote sits inside parentheses, so it is not taken
        notes = 'cooked ham (as "Ham slices" in D3)'
        self.assertIsNone(scorecard.matched_item(notes, self.ITEMS))

    def test_quote_compared_after_normalising(self) -> None:
        self.assertEqual(scorecard.matched_item('"small  SAUSAGES"', self.ITEMS), "Small sausages")

    def test_quote_that_is_not_a_reported_item_is_skipped(self) -> None:
        self.assertEqual(scorecard.matched_item('"mini sausages", then "Small sausages"', self.ITEMS), "Small sausages")

    def test_single_item_plate_names_it_without_a_quote(self) -> None:
        self.assertEqual(scorecard.matched_item("", ["Scrambled eggs"]), "Scrambled eggs")

    def test_several_items_and_no_quote_names_nothing(self) -> None:
        self.assertIsNone(scorecard.matched_item("covered", self.ITEMS))


class DecideRowTest(unittest.TestCase):
    def setUp(self) -> None:
        self.ws = Workspace(self)

    def two_sheets(self, newer_cell: str = "Y", older_cell: str = "Y") -> scorecard.VerdictMemory:
        items = {"01": ["Ham slices", "Small sausages"]}
        rows = lambda cell: {"01": [("bacon/ham slices", cell, '"Ham slices" is ham')]}  # noqa: E731
        self.ws.write_sheet("old-run", sheet(items, rows(older_cell)), mtime=1_000_000)
        self.ws.write_sheet("new-run", sheet(items, rows(newer_cell)), mtime=2_000_000)
        return memory_from(self.ws)

    def test_remembered_y_is_prefilled_with_reason_and_source(self) -> None:
        self.ws.write_sheet(
            "src", sheet({"01": ["Ham slices", "Beans"]}, {"01": [("bacon/ham slices", "Y", '"Ham slices" is cooked ham')]})
        )
        decision = scorecard.decide_row(memory_from(self.ws), "01", "bacon/ham slices", ["ham  SLICES", "Toast"])
        self.assertEqual((decision.kind, decision.cell), ("Y", "Y"))
        self.assertIn("src", decision.notes)
        self.assertIn("is cooked ham", decision.notes)

    def test_control_unknown_name_needs_judgment_and_is_listed(self) -> None:
        self.ws.write_sheet(
            "src", sheet({"01": ["Ham slices", "Beans"]}, {"01": [("bacon/ham slices", "Y", '"Ham slices"')]})
        )
        decision = scorecard.decide_row(memory_from(self.ws), "01", "bacon/ham slices", ["Cooked ham", "Toast"])
        self.assertEqual(decision.kind, "needs")
        self.assertEqual(decision.cell.strip(), "")
        self.assertIn(scorecard.NEEDS_MARKER, decision.notes)
        self.assertIn('"Cooked ham"', decision.notes)
        self.assertIn('"Toast"', decision.notes)

    def test_memory_is_scoped_to_the_plate_and_the_gold_item(self) -> None:
        self.ws.write_sheet(
            "src", sheet({"01": ["Ham slices"]}, {"01": [("bacon/ham slices", "Y", '"Ham slices"')]})
        )
        memory = memory_from(self.ws)
        self.assertEqual(scorecard.decide_row(memory, "01", "bacon/ham slices", ["Ham slices"]).kind, "Y")
        self.assertEqual(scorecard.decide_row(memory, "02", "bacon/ham slices", ["Ham slices"]).kind, "needs")
        self.assertEqual(scorecard.decide_row(memory, "01", "scrambled eggs", ["Ham slices"]).kind, "needs")

    def test_n_needs_every_item_remembered(self) -> None:
        self.ws.write_sheet(
            "src", sheet({"01": ["Toast", "Beans"]}, {"01": [("bacon/ham slices", "n", "no ham")]})
        )
        memory = memory_from(self.ws)
        all_known = scorecard.decide_row(memory, "01", "bacon/ham slices", ["Beans", "toast"])
        self.assertEqual((all_known.kind, all_known.cell), ("n", "n"))
        # control: one name the memory never saw turns the same row into a judgment
        one_new = scorecard.decide_row(memory, "01", "bacon/ham slices", ["Beans", "Toast", "Sausage"])
        self.assertEqual(one_new.kind, "needs")
        self.assertIn('"Sausage"', one_new.notes)
        self.assertNotIn('"Beans"', one_new.notes)

    def test_a_remembered_y_beats_remembered_n_items(self) -> None:
        self.ws.write_sheet("a", sheet({"01": ["Toast"]}, {"01": [("bacon/ham slices", "n", "")]}))
        self.ws.write_sheet("b", sheet({"01": ["Ham"]}, {"01": [("bacon/ham slices", "Y", '"Ham"')]}))
        self.assertEqual(scorecard.decide_row(memory_from(self.ws), "01", "bacon/ham slices", ["Toast", "Ham"]).kind, "Y")

    def test_plate_with_no_items_is_n(self) -> None:
        decision = scorecard.decide_row(scorecard.VerdictMemory(), "01", "scrambled eggs", [])
        self.assertEqual((decision.kind, decision.cell), ("n", "n"))
        # control: the same empty memory with an item is a judgment
        self.assertEqual(scorecard.decide_row(scorecard.VerdictMemory(), "01", "scrambled eggs", ["Eggs"]).kind, "needs")

    def test_uncertain_cells_are_not_remembered(self) -> None:
        self.ws.write_sheet("src", sheet({"01": ["Ham slices"]}, {"01": [("bacon/ham slices", "Y?", '"Ham slices"')]}))
        memory = memory_from(self.ws)
        self.assertEqual(memory.uncertain, 1)
        self.assertEqual(scorecard.decide_row(memory, "01", "bacon/ham slices", ["Ham slices"]).kind, "needs")

    def test_y_without_a_nameable_item_is_counted_not_guessed(self) -> None:
        self.ws.write_sheet("src", sheet({"01": ["Ham slices", "Beans"]}, {"01": [("bacon/ham slices", "Y", "")]}))
        memory = memory_from(self.ws)
        self.assertEqual(memory.hits_unattributed, 1)
        self.assertEqual(scorecard.decide_row(memory, "01", "bacon/ham slices", ["Ham slices"]).kind, "needs")

    def test_conflict_shows_newest_verdict_and_both_sources(self) -> None:
        memory = self.two_sheets(newer_cell="n", older_cell="Y")
        decision = scorecard.decide_row(memory, "01", "bacon/ham slices", ["Ham slices"])
        self.assertEqual(decision.kind, "conflict")
        self.assertEqual(decision.cell, "n")
        self.assertIn(scorecard.CONFLICT_MARKER, decision.notes)
        self.assertIn("old-run", decision.notes)
        self.assertIn("new-run", decision.notes)

    def test_control_swapped_mtimes_flip_the_conflict_cell(self) -> None:
        memory = self.two_sheets(newer_cell="Y", older_cell="n")
        decision = scorecard.decide_row(memory, "01", "bacon/ham slices", ["Ham slices"])
        self.assertEqual((decision.kind, decision.cell), ("conflict", "Y"))

    def test_control_agreeing_sheets_do_not_conflict(self) -> None:
        memory = self.two_sheets(newer_cell="Y", older_cell="Y")
        decision = scorecard.decide_row(memory, "01", "bacon/ham slices", ["Ham slices"])
        self.assertEqual(decision.kind, "Y")
        self.assertNotIn(scorecard.CONFLICT_MARKER, decision.notes)

    def test_y_versus_y_merged_is_a_disagreement(self) -> None:
        memory = self.two_sheets(newer_cell="Y merged", older_cell="Y")
        decision = scorecard.decide_row(memory, "01", "bacon/ham slices", ["Ham slices"])
        self.assertEqual((decision.kind, decision.cell), ("conflict", "Y merged"))

    def test_conflict_on_one_item_does_not_hide_a_clean_y_on_another(self) -> None:
        items = {"01": ["Ham slices", "Cooked ham"]}
        self.ws.write_sheet("a", sheet(items, {"01": [("bacon/ham slices", "n", "")]}), mtime=2_000_000)
        self.ws.write_sheet("b", sheet({"01": ["Ham slices"]}, {"01": [("bacon/ham slices", "Y", '"Ham slices"')]}), mtime=1_000_000)
        self.ws.write_sheet("c", sheet({"01": ["Cooked ham"]}, {"01": [("bacon/ham slices", "Y", '"Cooked ham"')]}), mtime=1_500_000)
        decision = scorecard.decide_row(memory_from(self.ws), "01", "bacon/ham slices", ["Ham slices"])
        self.assertEqual(decision.kind, "conflict")
        decision = scorecard.decide_row(memory_from(self.ws), "01", "bacon/ham slices", ["Ham slices", "Cooked ham"])
        # "Cooked ham" has n (a, newest) and Y (c): also disputed, so still a conflict, never a quiet Y
        self.assertEqual(decision.kind, "conflict")


class DiscoveryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.ws = Workspace(self)
        self.text = sheet({"01": ["Ham slices"]}, {"01": [("bacon/ham slices", "Y", '"Ham slices"')]})

    def test_own_run_and_copies_of_it_are_skipped(self) -> None:
        self.ws.write_sheet("this-run", self.text)
        self.ws.write_sheet("this-run", self.text, base="other-worktree/runs")
        self.ws.write_sheet("other-run", self.text.replace("Ham slices", "Ham"))
        sheets, excluded = scorecard.discover_sheets(
            [str(self.ws.root / "runs"), str(self.ws.root / "other-worktree")], own_run="this-run"
        )
        self.assertEqual([p.parent.name for p in sheets], ["other-run"])
        self.assertEqual(excluded, 2)
        # control: with no own run, nothing is skipped
        sheets, excluded = scorecard.discover_sheets([str(self.ws.root / "runs")], own_run=None)
        self.assertEqual((len(sheets), excluded), (2, 0))

    def test_identical_copies_are_one_source_and_do_not_conflict(self) -> None:
        self.ws.write_sheet("run-a", self.text, mtime=1_000_000)
        self.ws.write_sheet("run-a", self.text, mtime=2_000_000, base="wt/runs")
        sheets, _ = scorecard.discover_sheets([str(self.ws.root / "runs"), str(self.ws.root / "wt" / "runs")])
        memory = scorecard.load_memory(sheets)
        self.assertEqual(len(memory.sheets), 1)
        self.assertEqual(scorecard.decide_row(memory, "01", "bacon/ham slices", ["Ham slices"]).kind, "Y")

    def test_glob_directory_and_file_specs(self) -> None:
        one = self.ws.write_sheet("run-a", self.text)
        self.ws.write_sheet("run-b", self.text)
        by_glob, _ = scorecard.discover_sheets([str(self.ws.root / "runs" / "*" / "scorecard-filled.md")])
        by_dir, _ = scorecard.discover_sheets([str(self.ws.root)])
        by_file, _ = scorecard.discover_sheets([str(one)])
        self.assertEqual((len(by_glob), len(by_dir), len(by_file)), (2, 2, 1))

    def test_a_spec_that_matches_nothing_is_an_error(self) -> None:
        with self.assertRaises(SystemExit):
            scorecard.discover_sheets([str(self.ws.root / "nothing-here" / "*.md")])

    def test_names_with_commas_come_from_the_results_json_beside_the_sheet(self) -> None:
        path = self.ws.write_sheet(
            "comma-run", sheet({"01": ["Rice, white", "Ham"]}, {"01": [("bacon/ham slices", "n", "")]})
        )
        (path.parent / "results.json").write_text(json.dumps(results_for({"01": ["Rice, white", "Ham"]})), encoding="utf-8")
        memory = memory_from(self.ws)
        self.assertEqual(scorecard.decide_row(memory, "01", "bacon/ham slices", ["Rice, white", "Ham"]).kind, "n")
        # control: without the results.json the line splits on the comma and the name is lost
        (path.parent / "results.json").unlink()
        memory = memory_from(self.ws)
        self.assertEqual(scorecard.decide_row(memory, "01", "bacon/ham slices", ["Rice, white", "Ham"]).kind, "needs")


class WorksheetAndScoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.ws = Workspace(self)
        self.ws.write_sheet(
            "earlier",
            sheet(
                {"01": ["Ham slices", "Toast"], "02": ["Plain rice"]},
                {
                    "01": [("scrambled eggs", "n", ""), ("bacon/ham slices", "Y", '"Ham slices" is ham')],
                    "02": [("rice", "Y", '"Plain rice"')],
                },
            ),
        )

    def prefill(self, items: dict[str, list[str]], *extra: str) -> tuple[int, str, str, Path]:
        results = self.ws.write_run("new", items)
        out = self.ws.root / "sheet.md"
        code, stdout, stderr = run_main(
            [str(results), "--gold", str(self.ws.gold), "--out", str(out), "--prefill",
             "--from", str(self.ws.root / "runs"), *extra]
        )
        return code, stdout, stderr, out

    def test_summary_counts_and_cells(self) -> None:
        code, stdout, _err, out = self.prefill({"01": ["Ham slices", "Toast"], "02": ["Plain rice"]})
        self.assertEqual(code, 0)
        self.assertIn("prefilled Y: 2", stdout)
        self.assertIn("prefilled n: 1", stdout)
        self.assertIn("conflicts: 0", stdout)
        self.assertIn("needs judgment: 0", stdout)
        text = out.read_text(encoding="utf-8")
        self.assertIn("| scrambled eggs | n |", text)
        self.assertIn("| bacon/ham slices | Y |", text)
        self.assertIn(f"{scorecard.PREFILL_HEADER_PREFIX} 2 Y, 1 n", text)

    def test_control_new_names_are_left_blank_and_marked(self) -> None:
        code, stdout, _err, out = self.prefill({"01": ["Cooked ham", "Toast"], "02": ["Plain rice"]})
        self.assertEqual(code, 0)
        # "Cooked ham" was never judged, so both plate 01 rows need a person; the rice row is remembered
        self.assertIn("needs judgment: 2", stdout)
        self.assertIn("prefilled Y: 1", stdout)
        text = out.read_text(encoding="utf-8")
        self.assertRegex(text, r"\| bacon/ham slices \|\s+\| NEEDS JUDGMENT: unremembered items \"Cooked ham\"")

    def test_refuses_to_overwrite_without_force(self) -> None:
        items = {"01": ["Ham slices", "Toast"], "02": ["Plain rice"]}
        self.assertEqual(self.prefill(items)[0], 0)
        code, _out, err, _path = self.prefill(items)
        self.assertEqual(code, 1)
        self.assertIn("--force", err)
        self.assertEqual(self.prefill(items, "--force")[0], 0)

    def test_run_never_learns_from_its_own_sheet(self) -> None:
        results = self.ws.write_run("earlier", {"01": ["Ham slices", "Toast"], "02": ["Plain rice"]})
        out = self.ws.root / "own.md"
        code, stdout, _err = run_main(
            [str(results), "--gold", str(self.ws.gold), "--out", str(out), "--prefill", "--from", str(self.ws.root / "runs")]
        )
        # the only sheet is a run of the same name: nothing to learn from
        self.assertEqual(code, 1)
        self.assertEqual(stdout, "")

    def test_results_json_after_from_is_still_the_results_json(self) -> None:
        results = self.ws.write_run("new", {"01": ["Ham slices", "Toast"], "02": ["Plain rice"]})
        out = self.ws.root / "tail.md"
        code, stdout, _err = run_main(
            ["--gold", str(self.ws.gold), "--out", str(out), "--prefill", "--from", str(self.ws.root / "runs"), str(results)]
        )
        self.assertEqual(code, 0)
        self.assertIn("prefilled Y: 2", stdout)

    def test_prefill_without_from_is_a_usage_error(self) -> None:
        results = self.ws.write_run("new", {"01": ["Ham slices"]})
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            scorecard.main([str(results), "--gold", str(self.ws.gold), "--prefill"])

    def test_score_refuses_markers_and_names_the_rows(self) -> None:
        _c, _o, _e, out = self.prefill({"01": ["Cooked ham", "Toast"], "02": ["Plain rice"]})
        code, stdout, err = run_main(["--score", str(out), "--resamples", "50"])
        self.assertEqual(code, 1)
        self.assertEqual(stdout, "")
        self.assertIn("NEEDS JUDGMENT", err)
        self.assertIn("bacon/ham slices", err)

    def test_score_refuses_a_conflict_row(self) -> None:
        self.ws.write_sheet(
            "later",
            sheet({"01": ["Ham slices", "Toast"]}, {"01": [("scrambled eggs", "n", ""), ("bacon/ham slices", "n", "no ham")]}),
            mtime=4_000_000_000,
        )
        _c, stdout, _e, out = self.prefill({"01": ["Ham slices", "Toast"], "02": ["Plain rice"]})
        self.assertIn("conflicts: 1", stdout)
        code, _o, err = run_main(["--score", str(out), "--resamples", "50"])
        self.assertEqual(code, 1)
        self.assertIn("CONFLICT", err)

    def test_score_works_after_a_human_resolves_the_rest(self) -> None:
        _c, _o, _e, out = self.prefill({"01": ["Cooked ham", "Toast"], "02": ["Plain rice"]})
        text = out.read_text(encoding="utf-8")
        resolved = re.sub(r"^\| scrambled eggs \|.*$", "| scrambled eggs | n | not on the plate |", text, flags=re.M)
        resolved = re.sub(r"^\| bacon/ham slices \|.*$", '| bacon/ham slices | Y | "Cooked ham" is ham |', resolved, flags=re.M)
        self.assertNotIn(scorecard.NEEDS_MARKER + ":", resolved)
        out.write_text(resolved, encoding="utf-8")
        code, stdout, err = run_main(["--score", str(out), "--resamples", "50"])
        self.assertEqual((code, err), (0, ""), stdout)
        # eggs n and ham Y by hand, rice Y by prefill; every recall row was empty and is counted from the cells
        self.assertRegex(stdout, r"\| production \| 2 \| 3 \| 66\.7% \(2/3\)")

    def test_blank_recall_is_derived_but_a_written_one_stands(self) -> None:
        _c, _o, _e, out = self.prefill({"01": ["Ham slices", "Toast"], "02": ["Plain rice"]})
        code, stdout, _err = run_main(["--score", str(out), "--resamples", "50"])
        self.assertEqual(code, 0)
        self.assertRegex(stdout, r"66\.7% \(2/3\)")
        # control: a person's own recall cell is not overwritten, and a stale one is called out
        text = out.read_text(encoding="utf-8")
        stale = text.replace("| **core recall (/2)** |", "| **core recall (/2)** | 2/2", 1)
        self.assertNotEqual(stale, text)
        out.write_text(stale, encoding="utf-8")
        _code, stdout, _err = run_main(["--score", str(out), "--resamples", "50"])
        self.assertIn("recall row says 2/2, its cells say 1/2", stdout)

    def test_a_blank_gold_cell_in_a_prefilled_sheet_is_refused(self) -> None:
        _c, _o, _e, out = self.prefill({"01": ["Ham slices", "Toast"], "02": ["Plain rice"]})
        out.write_text(out.read_text(encoding="utf-8").replace("| scrambled eggs | n |", "| scrambled eggs |   |", 1), encoding="utf-8")
        code, _o, err = run_main(["--score", str(out), "--resamples", "50"])
        self.assertEqual(code, 1)
        self.assertIn("empty cell", err)

    def test_control_legacy_sheet_without_markers_scores_as_before(self) -> None:
        legacy = self.ws.write_sheet(
            "legacy",
            sheet({"01": ["Ham"]}, {"01": [("scrambled eggs", "n", ""), ("bacon/ham slices", "Y", "")]}),
        )
        code, stdout, err = run_main(["--score", str(legacy), "--resamples", "50"])
        self.assertEqual((code, err), (0, ""))
        self.assertIn("50.0% (1/2)", stdout)

    def test_compare_also_refuses_a_marked_sheet(self) -> None:
        _c, _o, _e, out = self.prefill({"01": ["Cooked ham", "Toast"], "02": ["Plain rice"]})
        good = self.ws.write_sheet("good", sheet({"01": ["Ham"]}, {"01": [("scrambled eggs", "n", ""), ("bacon/ham slices", "Y", "")]}))
        code, _o, err = run_main(["--compare", str(out), str(good), "--resamples", "50"])
        self.assertEqual(code, 1)
        self.assertIn("NEEDS JUDGMENT", err)

    def test_notes_round_trip_into_the_next_memory(self) -> None:
        _c, _o, _e, out = self.prefill({"01": ["Ham slices", "Toast"], "02": ["Plain rice"]})
        later = self.ws.root / "runs" / "later" / "scorecard-filled.md"
        later.parent.mkdir(parents=True)
        later.write_text(out.read_text(encoding="utf-8"), encoding="utf-8")
        memory = memory_from(self.ws)
        decision = scorecard.decide_row(memory, "01", "bacon/ham slices", ["Ham slices"])
        self.assertEqual(decision.kind, "Y")
        # the tag a prefill wrote is not stacked inside the next reason
        self.assertEqual(decision.notes.count("prefill"), 1)


class CheckAgainstTest(unittest.TestCase):
    def setUp(self) -> None:
        self.ws = Workspace(self)
        self.ws.write_sheet(
            "earlier",
            sheet({"01": ["Ham slices", "Toast"]}, {"01": [("scrambled eggs", "n", ""), ("bacon/ham slices", "Y", '"Ham slices"')]}),
        )
        self.memory = memory_from(self.ws)
        self.results = results_for({"01": ["Ham slices", "Toast"], "02": ["Plain rice"]})
        self.plan = scorecard.build_prefill_plan(self.memory, self.results, GOLD, ["production"])

    def filled(self, eggs: str, ham: str) -> str:
        return sheet(
            {"01": ["Ham slices", "Toast"], "02": ["Plain rice"]},
            {"01": [("scrambled eggs", eggs, ""), ("bacon/ham slices", ham, "")], "02": [("rice", "Y", "")]},
        )

    def test_agreeing_filled_sheet_has_no_wrong_rows(self) -> None:
        result = scorecard.compare_plan_with_filled(self.plan, self.filled("n", "Y"))
        self.assertEqual((result["decided"], result["right"], result["wrong"]), (2, 2, 0))
        self.assertEqual(result["needs"], 1)  # plate 02 rice: "Plain rice" was never judged

    def test_control_a_disagreeing_filled_sheet_counts_wrong(self) -> None:
        result = scorecard.compare_plan_with_filled(self.plan, self.filled("Y", "Y"))
        self.assertEqual((result["decided"], result["right"], result["wrong"]), (2, 1, 1))
        self.assertEqual(result["wrong_rows"][0][2], "scrambled eggs")

    def test_merged_marking_is_counted_apart_from_a_wrong_polarity(self) -> None:
        result = scorecard.compare_plan_with_filled(self.plan, self.filled("n", "Y merged"))
        self.assertEqual((result["wrong"], result["merged_differs"]), (0, 1))


if __name__ == "__main__":
    unittest.main()
