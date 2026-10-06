"""The held-out typed set and the partial runs of the flag scorer.

Every check has a control: the same files with the new key removed, or the same run finished, must give the
answer the behaviour is not supposed to change. A check that cannot fail would pass both.
"""

from __future__ import annotations

import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path

from harness import score_flags
from tests.test_score_flags import CASE, PLATE, food, good_answer, plate_results

HCASE = {
    "id": "h001",
    "input": "Bresaola mit Rucola und Parmesan, dazu ein Radler",
    "lang": "de",
    "core": ["bresaola with rocket and parmesan", "shandy (Radler)"],
    "must_flag": [
        {"item": "bresaola with rocket and parmesan", "kind": "pregnancy", "value": "raw-meat"},
        {"item": "bresaola with rocket and parmesan", "kind": "allergen", "value": "milk"},
        {"item": "shandy (Radler)", "kind": "pregnancy", "value": "alcohol"},
        {"item": "shandy (Radler)", "kind": "allergen", "value": "gluten", "clear": False},
    ],
    "may_flag": [],
    "must_not_flag": [{"item": "shandy (Radler)", "kind": "allergen", "value": "fish"}],
    "clear": True,
}
HGOLD = {"h001": HCASE}


def h_good():
    return [
        food("Bresaola mit Rucola und Parmesan", "bresaola with arugula and parmesan", ["raw-meat"], ["milk"]),
        food("Radler", "shandy", ["alcohol"], ["gluten"]),
    ]


def h_no_raw_meat():
    foods = h_good()
    foods[0]["flags"]["pregnancy"] = []
    return foods


def answer(foods):
    return {"plate_text": {"foods": foods, "schema_valid": True}}


def write(path: Path, results: dict, **marks) -> str:
    path.mkdir(parents=True, exist_ok=True)
    (path / "results.json").write_text(json.dumps({**results, "_summary": {}, **marks}), encoding="utf-8")
    return path.name


class HoldoutBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.runs = Path(self.tmp.name)

    def holdout_runs(self, prefix, answers, **marks):
        return [write(self.runs / f"{prefix}-r{i}", {"h001": a}, **marks) for i, a in enumerate(answers, start=1)]

    def typed_runs(self, prefix, answers, **marks):
        return [write(self.runs / f"{prefix}-r{i}", {"x001": a}, **marks) for i, a in enumerate(answers, start=1)]

    def score(self, cells, *, test="T", refs=("R",), plate_gold=None, **cfg_extra):
        cfg = {"test": test, "refs": list(refs), "cells": cells, "skipped_cells": {}, **cfg_extra}
        return score_flags.run_scoring(
            cfg, self.runs, None, text_gold={"x001": CASE}, plate_gold={} if plate_gold is None else plate_gold, holdout_gold_override=HGOLD
        )


class ConfigKeys(unittest.TestCase):
    def config(self, **extra):
        cfg = {"test": "X", "refs": [], "cells": {"X": {"label": "x", "text": ["a"]}}, **extra}
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "cells.json"
        path.write_text(json.dumps(cfg), encoding="utf-8")
        return path

    def test_a_file_without_the_new_keys_loads_as_before(self):
        cfg = score_flags.load_config(self.config())
        for key in ("typed_gold", "typed_gold_holdout", "expected_text_repeats"):
            self.assertNotIn(key, cfg)
        self.assertEqual(cfg["expected_repeats"], 3)
        self.assertEqual(score_flags.DEFAULT_TYPED_GOLD, "gold/gold_text.jsonl")
        self.assertEqual(score_flags.DEFAULT_TYPED_GOLD_HOLDOUT, "gold/gold_text_holdout.jsonl")

    def test_a_cell_may_list_only_holdout_runs_but_not_nothing(self):
        cfg = {"test": "X", "refs": [], "cells": {"X": {"label": "x", "holdout": ["a-r1"]}}}
        path = self.config()
        path.write_text(json.dumps(cfg), encoding="utf-8")
        self.assertEqual(score_flags.load_config(path)["cells"]["X"]["holdout"], ["a-r1"])
        cfg["cells"]["X"] = {"label": "x"}
        path.write_text(json.dumps(cfg), encoding="utf-8")
        with self.assertRaises(ValueError):
            score_flags.load_config(path)

    def test_bad_new_keys_are_refused_and_good_ones_pass(self):
        self.assertEqual(score_flags.load_config(self.config(expected_text_repeats=1))["expected_text_repeats"], 1)
        for bad in (0, -1, "1", 1.5, True):
            with self.assertRaises(ValueError, msg=repr(bad)):
                score_flags.load_config(self.config(expected_text_repeats=bad))
        for key in ("typed_gold", "typed_gold_holdout"):
            with self.assertRaises(ValueError, msg=key):
                score_flags.load_config(self.config(**{key: ""}))
            self.assertEqual(score_flags.load_config(self.config(**{key: "gold/x.jsonl"}))[key], "gold/x.jsonl")
        path = self.config()
        cfg = json.loads(path.read_text(encoding="utf-8"))
        cfg["cells"]["X"]["holdout"] = "a-r1"  # a string is not a list of run directories
        path.write_text(json.dumps(cfg), encoding="utf-8")
        with self.assertRaises(ValueError):
            score_flags.load_config(path)

    def test_the_committed_v4_config(self):
        cfg = score_flags.load_config(score_flags.EVAL_ROOT / "configs" / "score-flags-v4.json")
        self.assertEqual((cfg["test"], cfg["refs"]), ("F25v4", ["C3v4", "B"]))
        self.assertEqual((cfg["expected_repeats"], cfg["expected_text_repeats"]), (3, 1))
        self.assertEqual(sorted(cfg["cells"]), ["B", "C3", "C3v4", "F25v4", "G31", "O6"])
        for cell in ("C3v4", "F25v4", "G31", "O6"):
            self.assertEqual(len(cfg["cells"][cell]["holdout"]), 3, cell)
            self.assertTrue(all(h.startswith("v4-holdout-") for h in cfg["cells"][cell]["holdout"]), cell)
        self.assertEqual(len(cfg["cells"]["F25v4"]["plates"]), 3)
        self.assertNotIn("text", {k for k, v in cfg["cells"]["F25v4"].items() if v})
        self.assertEqual(cfg["cells"]["G31"]["text"], ["v4-text-eu-cell-31-lite-newprompt-r1"])
        self.assertNotIn("holdout", cfg["cells"]["B"])
        self.assertNotIn(chr(0x2014), json.dumps(cfg, ensure_ascii=False))
        self.assertNotIn(chr(0x2013), json.dumps(cfg, ensure_ascii=False))


class HoldoutScoring(HoldoutBase):
    def cells(self, holdout_answers, *, marks=None):
        t_text = self.typed_runs("t", [answer(good_answer())] * 3)
        r_text = self.typed_runs("r", [answer(good_answer())] * 3)
        return {
            "T": {"label": "test", "text": t_text, "holdout": self.holdout_runs("th", holdout_answers, **(marks or {}))},
            "R": {"label": "ref", "text": r_text},
        }

    def test_holdout_misses_are_counted_per_repeat_in_their_own_block(self):
        good, bad = answer(h_good()), answer(h_no_raw_meat())
        doc = self.score(self.cells([good, bad, good]))
        h = doc["holdout"]["cells"]["T"]
        self.assertEqual(h["preg_clear_miss_per_repeat"], [0, 1, 0])
        self.assertEqual((h["scored"], h["complete"]), (3, True))
        self.assertEqual(doc["holdout"]["rule_2"]["verdict"], "FAIL")
        # control: three good repeats count no miss anywhere
        h = self.score(self.cells([good, good, good]))["holdout"]["cells"]["T"]
        self.assertEqual((h["preg_clear_miss_per_repeat"], h["alg_clear_miss_per_repeat"]), ([0, 0, 0], [0, 0, 0]))

    def test_the_typed_numbers_and_rules_are_the_same_with_and_without_holdout_runs(self):
        bad = answer(h_no_raw_meat())
        with_holdout = self.score(self.cells([bad, bad, bad]))
        cells = self.cells([bad, bad, bad])
        del cells["T"]["holdout"]
        without = self.score(cells)
        self.assertEqual(with_holdout["numbers"], without["numbers"])
        self.assertEqual(with_holdout["rules"], without["rules"])
        self.assertEqual(with_holdout["summary"], without["summary"])
        self.assertNotIn("holdout", without)
        # control: the holdout runs did change something, in their own block
        self.assertEqual(with_holdout["holdout"]["cells"]["T"]["preg_clear_miss_per_repeat"], [1, 1, 1])

    def test_allergen_misses_false_alarms_failed_calls_and_outside_items_are_reported(self):
        foods = h_good()
        foods[0]["flags"]["allergens"] = []  # the clear milk entry is missed
        foods[1]["flags"]["allergens"] = ["gluten", "fish"]  # the must_not_flag fish is a false alarm
        foods.append(food("Zanderfilet", "pikeperch fillet", [], ["fish"]))  # matches no gold item
        raised = {"plate_text": {"error": "the call raised"}}
        doc = self.score(self.cells([answer(foods), raised, answer(h_good())]))
        h = doc["holdout"]["cells"]["T"]
        self.assertEqual(h["alg_clear_miss_per_repeat"], [1, 0, 0])
        self.assertEqual(h["alg_false_alarm_per_repeat"], [1, 0, 0])
        self.assertEqual(h["failed_calls_per_repeat"], [0, 1, 0])
        self.assertEqual(h["outside_items_per_repeat"], [1, 0, 0])
        self.assertEqual([o["name"] for o in h["outside_items"]], ["Zanderfilet"])
        # control: the good answer has none of these
        h = self.score(self.cells([answer(h_good())] * 3))["holdout"]["cells"]["T"]
        self.assertEqual((h["alg_clear_miss_per_repeat"], h["alg_false_alarm_per_repeat"], h["failed_calls_per_repeat"], h["outside_items"]), ([0, 0, 0], [0, 0, 0], [0, 0, 0], []))

    def test_rule_2_on_the_holdout_has_the_four_verdicts(self):
        good, bad = answer(h_good()), answer(h_no_raw_meat())
        raised = {"plate_text": {"error": "the call raised"}}
        verdict = lambda answers, **kw: self.score(self.cells(answers), **kw)["holdout"]["rule_2"]["verdict"]  # noqa: E731
        self.assertEqual(verdict([good, good, good]), "PASS")
        self.assertEqual(verdict([good, good, bad]), "FAIL")
        self.assertEqual(verdict([good, good]), "INCOMPLETE")
        self.assertEqual(verdict([good, raised, good]), "INCONCLUSIVE")
        # a miss in a short set is still a FAIL, and `expected_repeats` decides how many the rule needs
        self.assertEqual(verdict([good, bad]), "FAIL")
        self.assertEqual(verdict([good, good], expected_repeats=2), "PASS")
        self.assertEqual(verdict([good, good, good], expected_repeats=4), "INCOMPLETE")

    def test_the_holdout_runs_use_the_holdout_gold_not_the_typed_gold(self):
        # the typed gold names x001 only: a run that holds h001 is complete for the holdout gold alone
        doc = self.score(self.cells([answer(h_good())] * 3))
        self.assertEqual(doc["holdout"]["cells"]["T"]["scored"], 3)
        self.assertEqual(doc["summary"]["T"]["n_repeats"], 3)  # the typed runs still score against x001
        # control: a typed run listed as holdout is not complete (it has no h001) and is named, not scored
        cells = self.cells([answer(h_good())] * 3)
        cells["T"]["holdout"] = ["t-r1"]
        h = self.score(cells)["holdout"]["cells"]["T"]
        self.assertEqual((h["scored"], len(h["left_out"])), (0, 1))
        self.assertIn("incomplete: 0 of 1 answers", h["left_out"][0]["reason"])

    def test_a_cell_without_holdout_runs_has_no_entry_and_the_ref_is_not_in_the_block(self):
        doc = self.score(self.cells([answer(h_good())] * 3))
        self.assertEqual(list(doc["holdout"]["cells"]), ["T"])

    def test_typed_gold_names_another_gold_file_for_the_text_runs(self):
        other = dict(CASE, id="z009")
        gold_file = self.runs / "other-gold.jsonl"
        gold_file.write_text(json.dumps(other) + "\n", encoding="utf-8")
        names = [write(self.runs / "z-r1", {"z009": answer(good_answer())})]
        cells = {"T": {"label": "t", "text": names}, "R": {"label": "r", "text": names}}
        cfg = {"test": "T", "refs": ["R"], "cells": cells, "skipped_cells": {}, "typed_gold": str(gold_file), "expected_repeats": 1}
        doc = score_flags.run_scoring(cfg, self.runs, None, plate_gold={})
        self.assertEqual(doc["summary"]["T"]["n_repeats"], 1)
        self.assertEqual(doc["rules"][0]["verdict"], "PASS")
        # control: without `typed_gold` the same run is not complete for the default gold and is left out
        del cfg["typed_gold"]
        doc = score_flags.run_scoring(cfg, self.runs, None, text_gold={"x001": CASE}, plate_gold={})
        self.assertEqual(doc["summary"]["T"]["n_repeats"], 0)

    def test_typed_gold_holdout_names_the_holdout_file(self):
        gold_file = self.runs / "hold.jsonl"
        gold_file.write_text(json.dumps(HCASE) + "\n", encoding="utf-8")
        cells = self.cells([answer(h_good())] * 3)
        cfg = {"test": "T", "refs": ["R"], "cells": cells, "skipped_cells": {}, "typed_gold_holdout": str(gold_file)}
        doc = score_flags.run_scoring(cfg, self.runs, None, text_gold={"x001": CASE}, plate_gold={})
        self.assertEqual(doc["holdout"]["gold"], str(gold_file))
        self.assertEqual(doc["holdout"]["cells"]["T"]["scored"], 3)
        # control: the default file is the real holdout gold, which holds other cases, so these runs are left out
        del cfg["typed_gold_holdout"]
        doc = score_flags.run_scoring(cfg, self.runs, None, text_gold={"x001": CASE}, plate_gold={})
        self.assertEqual(doc["holdout"]["cells"]["T"]["scored"], 0)


class OutsideTheGold(HoldoutBase):
    def test_the_holdout_maps_by_word_overlap_with_the_core_names_and_no_override(self):
        # no override is written for a holdout id
        self.assertEqual([k for k in score_flags.OVERRIDES if k[0].startswith("h")], [])
        # a model item named in German with an English translation holds the gold item by shared words
        result = score_flags.score_case(HCASE, h_good(), plate=False)
        self.assertEqual(result["outside_gold"], [])
        self.assertEqual(result["mapping"]["shandy (Radler)"], ["Radler"])
        # control: a name that shares no word is outside the gold, and the gold item is not held
        stranger = [food("Gericht", "dish", ["raw-meat"], ["milk"]), food("Radler", "shandy", ["alcohol"], ["gluten"])]
        result = score_flags.score_case(HCASE, stranger, plate=False)
        self.assertEqual([o["name"] for o in result["outside_gold"]], ["Gericht"])
        self.assertEqual(result["mapping"]["bresaola with rocket and parmesan"], [])

    def test_the_report_lists_outside_items_and_unheld_gold_items_per_holdout_cell(self):
        stranger = [food("Gericht", "dish", ["raw-meat"], ["milk"]), food("Radler", "shandy", ["alcohol"], ["gluten"])]
        cells = {
            "T": {"label": "t", "text": self.typed_runs("t", [answer(good_answer())]), "holdout": self.holdout_runs("th", [answer(stranger)])},
            "R": {"label": "r", "text": self.typed_runs("r", [answer(good_answer())])},
        }
        stem = self.runs / "out" / "REPORT"
        cfg = {"test": "T", "refs": ["R"], "cells": cells, "skipped_cells": {}, "expected_repeats": 1, "config_path": "x.json"}
        score_flags.run_scoring(cfg, self.runs, stem, text_gold={"x001": CASE}, plate_gold={}, holdout_gold_override=HGOLD)
        md = Path(f"{stem}.md").read_text(encoding="utf-8")
        block = md[md.index("## Holdout"):]
        block = block[: block.index("## Miss counts per cell")]
        for needle in ("Items outside the gold, per holdout cell", "| h001 |", "Gericht", "gold item no model item held", "bresaola with rocket and parmesan"):
            self.assertIn(needle, block)
        self.assertNotIn(chr(0x2014), md)
        self.assertNotIn(chr(0x2013), md)
        doc = json.loads(Path(f"{stem}.json").read_text(encoding="utf-8"))
        self.assertEqual(doc["holdout"]["cells"]["T"]["outside_items"][0]["name"], "Gericht")
        self.assertEqual(doc["holdout"]["cells"]["T"]["unheld_gold"][0]["gold_item"], "bresaola with rocket and parmesan")
        # control: no holdout cell, no block
        del cells["T"]["holdout"]
        score_flags.run_scoring(cfg, self.runs, stem, text_gold={"x001": CASE}, plate_gold={})
        self.assertNotIn("## Holdout", Path(f"{stem}.md").read_text(encoding="utf-8"))


class PartialAndMissingRuns(HoldoutBase):
    def test_a_partial_run_is_incomplete_even_when_it_holds_every_case(self):
        good = answer(h_good())
        names = self.holdout_runs("th", [good, good, good])
        names[1] = write(self.runs / "th-r2", {"h001": good}, _partial=True)
        doc = self.score({"T": {"label": "t", "text": [], "holdout": names}, "R": {"label": "r", "text": self.typed_runs("r", [answer(good_answer())])}}, expected_repeats=3)
        h = doc["holdout"]["cells"]["T"]
        self.assertEqual((h["scored"], h["complete"]), (2, False))
        self.assertEqual([x["run"] for x in h["left_out"]], ["th-r2"])
        self.assertIn("_partial", h["left_out"][0]["reason"])
        self.assertEqual(doc["holdout"]["rule_2"]["verdict"], "INCOMPLETE")
        # control: the same run finished (no marker) is scored and the rule is decided
        write(self.runs / "th-r2", {"h001": good})
        doc = self.score({"T": {"label": "t", "text": [], "holdout": names}, "R": {"label": "r", "text": self.typed_runs("r", [answer(good_answer())])}}, expected_repeats=3)
        self.assertEqual((doc["holdout"]["cells"]["T"]["scored"], doc["holdout"]["rule_2"]["verdict"]), (3, "PASS"))

    def test_a_short_run_a_missing_directory_and_unreadable_files_are_named_and_never_crash(self):
        good = answer(h_good())
        short = write(self.runs / "short", {})  # no record at all
        (self.runs / "broken").mkdir()
        (self.runs / "broken" / "results.json").write_text('{"h001": {"plate_te', encoding="utf-8")  # cut off mid write
        (self.runs / "list").mkdir()
        (self.runs / "list" / "results.json").write_text("[1, 2]", encoding="utf-8")
        weird = write(self.runs / "weird", {"h001": {}})  # a record that is no answer
        ok = write(self.runs / "ok", {"h001": good})
        cells = {"T": {"label": "t", "text": [], "holdout": [short, "broken", "list", "nowhere", weird, ok]}, "R": {"label": "r", "text": self.typed_runs("r", [answer(good_answer())])}}
        doc = self.score(cells, expected_repeats=1)
        h = doc["holdout"]["cells"]["T"]
        self.assertEqual(h["runs"], ["ok"])
        self.assertEqual(sorted(x["run"] for x in h["left_out"]), ["broken", "list", "nowhere", "short", "weird"])
        reasons = {x["run"]: x["reason"] for x in h["left_out"]}
        self.assertTrue(reasons["nowhere"].startswith("missing"))
        self.assertTrue(reasons["short"].startswith("incomplete: 0 of 1"))
        self.assertTrue(reasons["weird"].startswith("unreadable records"))
        self.assertEqual(doc["holdout"]["rule_2"]["verdict"], "PASS")  # the one good run, expected_repeats 1

    def test_a_miss_in_the_finished_repeats_fails_rule_2_while_others_are_partial(self):
        good, bad = answer(h_good()), answer(h_no_raw_meat())
        names = [write(self.runs / "a-r1", {"h001": bad}), write(self.runs / "a-r2", {"h001": good}, _partial=True), "a-r3"]
        doc = self.score({"T": {"label": "t", "text": [], "holdout": names}, "R": {"label": "r", "text": self.typed_runs("r", [answer(good_answer())])}})
        self.assertEqual(doc["holdout"]["rule_2"]["verdict"], "FAIL")

    def test_a_partial_typed_run_and_a_partial_plate_run_are_left_out_of_the_main_numbers_too(self):
        good = answer(good_answer())
        done = write(self.runs / "x-r1", {"x001": good})
        partial = write(self.runs / "x-r2", {"x001": good}, _partial=True)
        egg_ok = [food("fried egg", "fried egg", ["raw-egg"], ["eggs"]), food("toast", "toast", [], ["gluten"])]
        plate_done = write(self.runs / "p-r1", {"p01": plate_results(egg_ok)["p01"]})
        plate_partial = write(self.runs / "p-r2", {"p01": plate_results(egg_ok)["p01"]}, _partial=True)
        cells = {"T": {"label": "t", "text": [done, partial], "plates": [plate_done, plate_partial]}, "R": {"label": "r", "text": [done]}}
        doc = self.score(cells, plate_gold={"p01": PLATE}, expected_repeats=1)
        self.assertEqual((doc["numbers"]["T"]["repeats"], doc["numbers"]["T"]["plate_runs"]), (1, 1))
        skipped = doc["scored"]["skipped"]
        self.assertIn("_partial", skipped["x-r2"])
        self.assertIn("_partial", skipped["p-r2"])
        self.assertNotIn("x-r1", skipped)
        # control: finished, both count
        write(self.runs / "x-r2", {"x001": good})
        write(self.runs / "p-r2", {"p01": plate_results(egg_ok)["p01"]})
        doc = self.score(cells, plate_gold={"p01": PLATE}, expected_repeats=2)
        self.assertEqual((doc["numbers"]["T"]["repeats"], doc["numbers"]["T"]["plate_runs"]), (2, 2))

    def test_run_is_complete_reads_the_marker(self):
        results = {"x001": answer(good_answer())}
        self.assertTrue(score_flags.run_is_complete(results, {"x001": CASE}))
        self.assertFalse(score_flags.run_is_complete({**results, "_partial": True}, {"x001": CASE}))
        self.assertTrue(score_flags.run_is_complete({**results, "_partial": False}, {"x001": CASE}))
        self.assertFalse(score_flags.run_is_complete(None, {"x001": CASE}))
        self.assertFalse(score_flags.run_is_complete({}, {"x001": CASE}))


class TextRepeatsAndTestCellShape(HoldoutBase):
    def cells(self, n_text):
        good = answer(good_answer())
        return {
            "T": {"label": "t", "text": self.typed_runs("t", [good] * n_text), "holdout": self.holdout_runs("th", [answer(h_good())] * 3)},
            "R": {"label": "r", "text": self.typed_runs("r", [good] * 3)},
        }

    def test_expected_text_repeats_decides_the_typed_rule_2_and_expected_repeats_the_holdout(self):
        doc = self.score(self.cells(1), expected_repeats=3, expected_text_repeats=1)
        self.assertEqual((doc["rules"][0]["rule"], doc["rules"][0]["verdict"]), (2, "PASS"))
        self.assertEqual(doc["rules"][0]["expected_repeats"], 1)
        self.assertEqual(doc["holdout"]["rule_2"]["verdict"], "PASS")
        self.assertEqual(doc["holdout"]["rule_2"]["expected_repeats"], 3)
        # control: without the key the typed rule falls back to expected_repeats, so one run is INCOMPLETE
        doc = self.score(self.cells(1), expected_repeats=3)
        self.assertEqual(doc["rules"][0]["verdict"], "INCOMPLETE")
        self.assertEqual(doc["rules"][0]["expected_repeats"], 3)

    def test_a_test_cell_with_holdout_and_no_text_is_judged_by_rule_2_on_the_holdout_only(self):
        cells = self.cells(3)
        cells["T"]["text"] = []
        cells["T"]["plates"] = [write(self.runs / "p-r1", {"p01": plate_results([food("fried egg", "fried egg", ["raw-egg"], ["eggs"]), food("toast", "toast", [], ["gluten"])])["p01"]})]
        doc = self.score(cells, plate_gold={"p01": PLATE})
        self.assertEqual([r["rule"] for r in doc["rules"]], [3, 4])
        self.assertEqual(doc["holdout"]["rule_2"]["verdict"], "PASS")
        # control: a test cell that has typed runs keeps the typed rule 2
        doc = self.score(self.cells(3))
        self.assertEqual([r["rule"] for r in doc["rules"]], [2, 3, 4])


class IncompleteComparisons(HoldoutBase):
    def cells(self, with_plate_run=True):
        egg_ok = [food("fried egg", "fried egg", ["raw-egg"], ["eggs"]), food("toast", "toast", [], ["gluten"])]
        egg_bad = [food("fried egg", "fried egg", [], ["eggs"]), food("toast", "toast", [], ["gluten"])]
        plate_ok = write(self.runs / "p-ok", {"p01": plate_results(egg_ok)["p01"]})
        plate_bad = write(self.runs / "p-bad", {"p01": plate_results(egg_bad)["p01"]})
        t_plates = [plate_ok] + (["p-unfinished"] if not with_plate_run else [])
        return {
            "T": {"label": "t", "text": [], "plates": t_plates, "holdout": self.holdout_runs("th", [answer(h_good())] * 3)},
            "R": {"label": "r", "text": [], "plates": [plate_bad]},
        }

    def test_rules_3_and_4_do_not_pass_over_runs_that_were_not_scored(self):
        doc = self.score(self.cells(with_plate_run=False), plate_gold={"p01": PLATE})
        rule3 = next(r for r in doc["rules"] if r["rule"] == 3)
        self.assertEqual(rule3["clear_verdict"], "PASS")  # the numbers alone would pass
        self.assertEqual(rule3["verdict"], "INCOMPLETE")
        self.assertIn("T: 1 plate run(s) not scored", rule3["numbers"])
        # control: every listed run scored, the same comparison passes
        doc = self.score(self.cells(with_plate_run=True), plate_gold={"p01": PLATE})
        self.assertEqual(next(r for r in doc["rules"] if r["rule"] == 3)["verdict"], "PASS")

    def test_a_fail_stays_a_fail_when_runs_are_missing(self):
        cells = self.cells(with_plate_run=False)
        egg_bad = [food("fried egg", "fried egg", [], ["eggs"]), food("toast", "toast", [], ["gluten"])]
        cells["T"]["plates"] = [write(self.runs / "p-bad2", {"p01": plate_results(egg_bad)["p01"]}), "p-unfinished"]
        cells["R"]["plates"] = [write(self.runs / "p-good2", {"p01": plate_results([food("fried egg", "fried egg", ["raw-egg"], ["eggs"]), food("toast", "toast", [], ["gluten"])])["p01"]})]
        doc = self.score(cells, plate_gold={"p01": PLATE})
        self.assertEqual(next(r for r in doc["rules"] if r["rule"] == 3)["verdict"], "FAIL")

    def test_a_config_without_holdout_keeps_the_old_verdicts(self):
        cells = self.cells(with_plate_run=False)
        for spec in cells.values():
            spec.pop("holdout", None)
        doc = self.score(cells, plate_gold={"p01": PLATE})
        rule3 = next(r for r in doc["rules"] if r["rule"] == 3)
        self.assertEqual(rule3["verdict"], "PASS")
        self.assertNotIn("incomplete_runs", rule3)


class CommandLine(HoldoutBase):
    def test_main_writes_the_report_and_prints_the_holdout_state(self):
        gold_file = self.runs / "hold.jsonl"
        gold_file.write_text(json.dumps(HCASE) + "\n", encoding="utf-8")
        typed_gold = self.runs / "typed.jsonl"
        typed_gold.write_text(json.dumps(CASE) + "\n", encoding="utf-8")
        good = answer(h_good())
        cells = {
            "T": {"label": "t", "text": self.typed_runs("t", [answer(good_answer())]), "holdout": [*self.holdout_runs("th", [good, good]), "th-r3"]},
            "R": {"label": "r", "text": self.typed_runs("r", [answer(good_answer())])},
        }
        cfg_path = self.runs / "cfg.json"
        cfg_path.write_text(
            json.dumps({"test": "T", "refs": ["R"], "cells": cells, "expected_repeats": 3, "expected_text_repeats": 1, "typed_gold": str(typed_gold), "typed_gold_holdout": str(gold_file)}),
            encoding="utf-8",
        )
        out = self.runs / "REPORT"
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = score_flags.main(["--config", str(cfg_path), "--runs-dir", str(self.runs), "--out", str(out)])
        self.assertEqual(code, 0)
        text = buf.getvalue()
        self.assertIn("holdout rule 2: INCOMPLETE", text)
        self.assertIn("holdout T: INCOMPLETE (2 of 3 repeats)", text)
        self.assertIn("left out th-r3: missing", text)
        self.assertTrue(Path(f"{out}.md").is_file() and Path(f"{out}.json").is_file())
        self.assertIn("**INCOMPLETE** (2 of 3)", Path(f"{out}.md").read_text(encoding="utf-8"))

    def test_map_dump_prints_the_holdout_runs_and_skips_the_unfinished_ones(self):
        gold_file = self.runs / "hold.jsonl"
        gold_file.write_text(json.dumps(HCASE) + "\n", encoding="utf-8")
        names = [write(self.runs / "m-r1", {"h001": answer(h_good())}), write(self.runs / "m-r2", {"h001": answer(h_good())}, _partial=True)]
        cells = {"T": {"label": "t", "holdout": names}}
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            score_flags.map_dump(cells, self.runs, {"typed_gold_holdout": str(gold_file)})
        lines = buf.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertIn("T m-r1 h001:", lines[0])
        self.assertIn("shandy (Radler) <- ['Radler']", lines[0])


class RealRunsState(unittest.TestCase):
    def test_the_committed_v4_config_scores_the_runs_as_they_are_now_without_crashing(self):
        cfg = score_flags.load_config(score_flags.EVAL_ROOT / "configs" / "score-flags-v4.json")
        cfg["skipped_cells"] = {}
        doc = score_flags.run_scoring(cfg, score_flags.RUNS_DIR, None)
        holdout = doc["holdout"]["cells"]
        self.assertEqual(sorted(holdout), ["C3v4", "F25v4", "G31", "O6"])
        for cell, h in holdout.items():
            # every listed run is either scored or named, whatever state the live runs are in
            self.assertEqual(h["scored"] + len(h["left_out"]), h["listed"], cell)
            self.assertEqual(h["complete"], h["scored"] == 3, cell)
        self.assertIn(doc["holdout"]["rule_2"]["verdict"], {"PASS", "FAIL", "INCOMPLETE", "INCONCLUSIVE"})
        if holdout["F25v4"]["scored"] < 3 and not any(x > 0 for x in holdout["F25v4"]["preg_clear_miss_per_repeat"]):
            self.assertEqual(doc["holdout"]["rule_2"]["verdict"], "INCOMPLETE")


if __name__ == "__main__":
    unittest.main()
