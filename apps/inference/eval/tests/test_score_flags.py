"""Safety flag scoring: a hand-made answer set with known misses, demotions and false alarms.

Every assertion has a control: the untouched answer set must score zero misses and zero demotions, so a
check that cannot fail (a scorer that never finds a miss) fails here.
"""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from harness import score_flags

CASE = {
    "id": "x001",
    "input": "Ein Stueck Tiramisu und ein Glas Rotwein, dazu Kaffee mit Hafermilch",
    "core": ["tiramisu", "red wine", "coffee", "oat milk"],
    "must_flag": [
        {"item": "tiramisu", "kind": "pregnancy", "value": "raw-egg"},
        {"item": "tiramisu", "kind": "allergen", "value": "eggs"},
        {"item": "tiramisu", "kind": "allergen", "value": "milk"},
        {"item": "red wine", "kind": "pregnancy", "value": "alcohol"},
        {"item": "red wine", "kind": "allergen", "value": "sulphites", "clear": False},
        {"item": "coffee", "kind": "pregnancy", "value": "caffeine"},
        {"item": "oat milk", "kind": "allergen", "value": "gluten"},
    ],
    "may_flag": [{"item": "tiramisu", "kind": "pregnancy", "value": "alcohol"}],
    "must_not_flag": [{"item": "oat milk", "kind": "allergen", "value": "milk"}],
    "clear": True,
}


def food(name, en, pregnancy=(), allergens=(), may_contain=()):
    return {
        "name": name,
        "translations": {"en": en},
        "flags": {"pregnancy": list(pregnancy), "allergens": list(allergens), "mayContain": list(may_contain)},
    }


def good_answer():
    return [
        food("Tiramisu", "Tiramisu", ["raw-egg", "alcohol"], ["eggs", "milk", "gluten"]),
        food("Rotwein", "Red wine", ["alcohol"], ["sulphites"]),
        food("Kaffee", "Coffee", ["caffeine"]),
        food("Hafermilch", "Oat milk", [], ["gluten"]),
    ]


def outcomes(result):
    return {(e["item"], e["kind"], e["value"]): e["outcome"] for e in result["entries"]}


def misses(result):
    return [e for e in result["entries"] if e["outcome"] in ("miss", "unlisted_miss")]


def demotions(result):
    return [e for e in result["entries"] if e["outcome"] == "demoted"]


class ScoreCaseTest(unittest.TestCase):
    def test_control_answer_has_no_miss_no_demotion_no_false_alarm(self):
        result = score_flags.score_case(CASE, good_answer(), plate=False)
        self.assertEqual(misses(result), [])
        self.assertEqual(demotions(result), [])
        self.assertEqual(result["false_alarms"], [])
        self.assertEqual(len(result["entries"]), len(CASE["must_flag"]))
        # gluten on the tiramisu is in no gold list: an unjudged extra, never a miss or a false alarm
        self.assertEqual([(x["food"], x["value"]) for x in result["extras"]], [("Tiramisu", "gluten")])

    def test_a_removed_clear_pregnancy_flag_is_exactly_one_miss(self):
        foods = good_answer()
        foods[0]["flags"]["pregnancy"].remove("raw-egg")
        result = score_flags.score_case(CASE, foods, plate=False)
        self.assertEqual([(e["item"], e["value"], e["clear"]) for e in misses(result)], [("tiramisu", "raw-egg", True)])
        self.assertEqual(demotions(result), [])

    def test_an_allergen_moved_to_may_contain_is_a_demotion_and_no_miss(self):
        foods = good_answer()
        foods[0]["flags"]["allergens"].remove("eggs")
        foods[0]["flags"]["mayContain"].append("eggs")
        result = score_flags.score_case(CASE, foods, plate=False)
        self.assertEqual(misses(result), [])
        self.assertEqual([(e["item"], e["value"]) for e in demotions(result)], [("tiramisu", "eggs")])

    def test_an_allergen_removed_from_both_lists_is_a_miss(self):
        foods = good_answer()
        foods[0]["flags"]["allergens"].remove("milk")
        result = score_flags.score_case(CASE, foods, plate=False)
        self.assertEqual([(e["item"], e["kind"], e["value"]) for e in misses(result)], [("tiramisu", "allergen", "milk")])
        self.assertEqual(demotions(result), [])

    def test_a_pregnancy_category_in_the_allergen_lists_does_not_count(self):
        foods = good_answer()
        foods[2]["flags"]["pregnancy"] = []
        foods[2]["flags"]["mayContain"] = ["caffeine"]
        result = score_flags.score_case(CASE, foods, plate=False)
        self.assertEqual(outcomes(result)[("coffee", "pregnancy", "caffeine")], "miss")

    def test_must_not_flag_present_is_a_false_alarm_in_either_list(self):
        for lst in ("allergens", "mayContain"):
            foods = good_answer()
            foods[3]["flags"][lst].append("milk")
            result = score_flags.score_case(CASE, foods, plate=False)
            self.assertEqual([(f["item"], f["value"], f["where"]) for f in result["false_alarms"]], [("oat milk", "milk", lst)])
            self.assertEqual(misses(result), [])

    def test_a_merged_item_carries_the_flags_of_both_foods(self):
        foods = good_answer()[:2] + [food("Kaffee mit Hafermilch", "Coffee with oat milk", ["caffeine"], ["gluten"])]
        result = score_flags.score_case(CASE, foods, plate=False)
        self.assertEqual(result["mapping"]["coffee"], ["Kaffee mit Hafermilch"])
        self.assertEqual(result["mapping"]["oat milk"], ["Kaffee mit Hafermilch"])
        self.assertEqual(misses(result), [])
        # control: the merged item without caffeine misses it
        foods[2]["flags"]["pregnancy"] = []
        self.assertEqual([e["value"] for e in misses(score_flags.score_case(CASE, foods, plate=False))], ["caffeine"])

    def test_a_merged_item_does_not_raise_a_false_alarm_another_food_allows(self):
        case = copy.deepcopy(CASE)
        case["may_flag"].append({"item": "coffee", "kind": "allergen", "value": "milk"})
        foods = good_answer()[:2] + [food("Kaffee mit Hafermilch", "Coffee with oat milk", ["caffeine"], ["gluten"], ["milk"])]
        self.assertEqual(score_flags.score_case(case, foods, plate=False)["false_alarms"], [])
        # control: without the may_flag on the coffee, the same answer is a false alarm on the oat milk
        self.assertEqual(len(score_flags.score_case(CASE, foods, plate=False)["false_alarms"]), 1)

    def test_an_unlisted_item_misses_only_its_clear_entries(self):
        foods = [f for f in good_answer() if f["name"] != "Rotwein"]
        result = score_flags.score_case(CASE, foods, plate=False)
        got = outcomes(result)
        self.assertEqual(got[("red wine", "pregnancy", "alcohol")], "unlisted_miss")
        self.assertEqual(got[("red wine", "allergen", "sulphites")], "unlisted_unscored")
        # the tiramisu may carry alcohol, so the same flag is reported as sitting elsewhere in the answer
        unlisted = [e for e in result["entries"] if e["outcome"] == "unlisted_miss"]
        self.assertEqual(unlisted[0]["elsewhere"], ["Tiramisu (pregnancy: alcohol)"])

    def test_tally_counts_clear_misses_demotions_and_distinct_entries(self):
        foods = good_answer()
        foods[0]["flags"]["pregnancy"].remove("raw-egg")
        foods[0]["flags"]["allergens"].remove("eggs")
        foods[0]["flags"]["mayContain"].append("eggs")
        foods[1]["flags"]["allergens"] = []
        run = {"cases": [score_flags.score_case(CASE, foods, plate=False)], "failed": []}
        t = score_flags.tally([run, copy.deepcopy(run)])
        c = t["counts"]
        self.assertEqual(c["preg_clear_miss"], 2)  # two repeats
        self.assertEqual(t["distinct"]["preg_clear_miss"], 1)
        self.assertEqual(c["alg_clear_demoted"], 2)
        self.assertEqual(c.get("alg_clear_miss", 0), 0)
        self.assertEqual(c["alg_nonclear_miss"], 2)  # the sulphites entry is clear: false
        control = score_flags.tally([{"cases": [score_flags.score_case(CASE, good_answer(), plate=False)], "failed": []}])
        self.assertEqual(control["counts"].get("preg_clear_miss", 0) + control["counts"].get("alg_clear_miss", 0), 0)

    def test_a_failed_call_is_kept_apart_from_flag_misses(self):
        raw = '{"foods": [{"name": "Tiramisu", "flags": {"pregnancy": ["raw-egg"], "allergens": ["eggs"]'
        results = {"x001": {"plate_text": {"foods": [], "schema_valid": False, "finish_reason": "length", "raw_content": raw}}}
        scored = score_flags.score_run(results, {"x001": CASE}, plate=False)
        self.assertEqual(scored["cases"], [])
        self.assertEqual(len(scored["failed"]), 1)
        self.assertIn('"pregnancy": ["raw-egg"]', scored["failed"][0]["truncated_flags"][0])
        c = score_flags.tally([scored])["counts"]
        self.assertEqual(c.get("preg_clear_miss", 0), 0)
        self.assertEqual(c["preg_clear_failed_call"], 3)

    def test_rule_2_fails_on_one_miss_in_one_repeat(self):
        def nums(per_repeat):
            row = {"repeats": 3, "preg_clear_typed_per_repeat": per_repeat, "preg_clear_typed_failed_per_repeat": [0, 0, 0],
                   "preg_clear_typed_distinct": sum(per_repeat)}
            for kind in ("preg", "alg"):
                for cl in ("clear", "nonclear"):
                    for k in ("total_per3", "total_listed_per3", "typed_distinct", "plates_distinct"):
                        row[f"{kind}_{cl}_{k}"] = 0
            return row
        ok = score_flags.evaluate_rules({"D": nums([0, 0, 0]), "B": nums([0, 0, 0]), "C": nums([0, 0, 0])})
        self.assertEqual(ok[0]["verdict"], "PASS")
        bad = score_flags.evaluate_rules({"D": nums([0, 1, 0]), "B": nums([0, 0, 0]), "C": nums([0, 0, 0])})
        self.assertEqual(bad[0]["verdict"], "FAIL")


PLATE = {
    "id": "p01",
    "input": "Fried egg on toast",
    "core": ["fried egg (sunny side up)", "toast slices"],
    "optional": [],
    "must_flag": [
        {"item": "fried egg (sunny side up)", "kind": "pregnancy", "value": "raw-egg", "clear": True},
        {"item": "toast slices", "kind": "allergen", "value": "gluten", "clear": True},
    ],
    "may_flag": [],
    "must_not_flag": [],
    "if_listed": [],
    "clear": False,
}


def write_run(path, results):
    path.mkdir(parents=True, exist_ok=True)
    (path / "results.json").write_text(json.dumps({**results, "_summary": {}}), encoding="utf-8")


def typed_results(foods):
    return {"x001": {"plate_text": {"foods": foods, "schema_valid": True}}}


def plate_results(foods):
    return {"p01": {"production": {"foods": foods, "schema_valid": True}}}


class ConfigPathTest(unittest.TestCase):
    """The config path: cells and run directories from a file, a run in another tree, plate repeats."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.runs = root / "here" / "runs"
        bad = good_answer()
        bad[0]["flags"]["pregnancy"].remove("raw-egg")
        write_run(self.runs / "good-r1", typed_results(good_answer()))
        write_run(root / "other" / "runs" / "good-r2", typed_results(good_answer()))
        write_run(self.runs / "bad-r1", typed_results(bad))
        write_run(self.runs / "partial", {})
        egg_ok = [food("fried egg", "fried egg", ["raw-egg"], ["eggs"]), food("toast", "toast", [], ["gluten"])]
        egg_bad = [food("fried egg", "fried egg", [], ["eggs"]), food("toast", "toast", [], ["gluten"])]
        write_run(self.runs / "plate-good", plate_results(egg_ok))
        write_run(self.runs / "plate-bad", plate_results(egg_bad))
        self.cfg_path = root / "cells.json"
        self.cfg = {
            "test": "Y",
            "refs": ["X"],
            "expected_repeats": 2,  # X holds two complete typed repeats (the third run is incomplete)
            "cells": {
                "X": {"label": "reference", "text": ["good-r1", "../../other/runs/good-r2", "partial"], "plates": ["plate-good"]},
                "Y": {"label": "candidate", "text": ["bad-r1"], "plates": ["plate-good", "plate-bad"]},
            },
        }
        self.cfg_path.write_text(json.dumps(self.cfg), encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def score(self, cfg):
        return score_flags.run_scoring(cfg, self.runs, None, text_gold={"x001": CASE}, plate_gold={"p01": PLATE})

    def test_config_cells_are_scored_from_their_directories(self):
        cfg = score_flags.load_config(self.cfg_path)
        doc = self.score(cfg)
        rule2 = doc["rules"][0]
        self.assertEqual(rule2["verdict"], "FAIL")
        self.assertEqual(doc["numbers"]["Y"]["preg_clear_typed_per_repeat"], [1])
        # the run in the other tree counts, the incomplete one is left out and named
        self.assertEqual(doc["numbers"]["X"]["preg_clear_typed_per_repeat"], [0, 0])
        self.assertEqual([r["run"] for r in doc["scored"]["cells"]["X"]["runs"]][:2], ["good-r1", "other:good-r2"])
        self.assertIn("partial", doc["scored"]["skipped"])
        # control: the same file with the reference as the test cell passes rule 2
        cfg["test"], cfg["refs"] = "X", ["Y"]
        self.assertEqual(self.score(cfg)["rules"][0]["verdict"], "PASS")

    def test_plate_repeats_count_as_the_mean_per_run(self):
        doc = self.score(score_flags.load_config(self.cfg_path))
        y, x = doc["numbers"]["Y"], doc["numbers"]["X"]
        self.assertEqual(y["plate_runs"], 2)
        self.assertEqual(y["preg_clear_plates_each_run"], [0, 1])
        self.assertEqual(y["preg_clear_plates_per_run"], 0.5)
        # rule 3: Y has 3 typed misses per 3 repeats plus 0.5 per plate run; X has none
        rule3 = next(r for r in doc["rules"] if r["rule"] == 3)
        self.assertEqual((rule3["verdict"], y["preg_clear_total_per3"], x["preg_clear_total_per3"]), ("FAIL", 3.5, 0.0))
        self.assertTrue(rule3["worksheet_listing"].startswith("n/a"))
        # control: with only the good plate run, Y's plate share is zero
        cfg = score_flags.load_config(self.cfg_path)
        cfg["cells"]["Y"]["plates"] = ["plate-good"]
        self.assertEqual(self.score(cfg)["numbers"]["Y"]["preg_clear_plates_per_run"], 0.0)

    def test_a_config_naming_an_unknown_cell_is_refused(self):
        self.cfg["refs"] = ["Z"]
        self.cfg_path.write_text(json.dumps(self.cfg), encoding="utf-8")
        with self.assertRaises(ValueError):
            score_flags.load_config(self.cfg_path)
        # control: the original file loads
        self.cfg["refs"] = ["X"]
        self.cfg_path.write_text(json.dumps(self.cfg), encoding="utf-8")
        self.assertEqual(score_flags.load_config(self.cfg_path)["refs"], ["X"])

    def test_the_default_cells_are_unchanged(self):
        self.assertEqual(sorted(score_flags.CELLS), ["B", "C", "D"])
        self.assertEqual((score_flags.DEFAULT_TEST, score_flags.DEFAULT_REFS), ("D", ("B", "C")))
        self.assertEqual(score_flags.plate_names(score_flags.CELLS["D"]), ["eu-cell-35-eu-newprompt"])


class PlateOverrideTest(unittest.TestCase):
    def test_every_plate_override_names_a_gold_item(self):
        gold = score_flags.load_plate_gold()
        unknown = [
            (pid, key, item)
            for (pid, key), items in score_flags.OVERRIDES.items()
            if not pid.startswith("t")
            for item in items
            if score_flags.norm_item(item) not in set(gold[pid]["core"]) | set(gold[pid]["optional"])
        ]
        self.assertEqual(unknown, [])

    def test_a_second_fish_beside_the_mackerel_does_not_hold_the_hoe(self):
        gold = score_flags.load_plate_gold()["45"]
        foods = [food("grilled mackerel", "grilled mackerel", [], ["fish"]), food("spicy braised fish", "spicy braised fish", [], ["fish"])]
        result = score_flags.score_case(gold, foods, plate=True)
        hoe = "sliced raw fish (hoe/sashimi) on shredded radish"
        self.assertEqual(result["mapping"][hoe], [])
        # control: a sashimi item holds it and carries the flag
        foods.append(food("sashimi platter", "sashimi platter", ["raw-fish"], ["fish"]))
        result = score_flags.score_case(gold, foods, plate=True)
        self.assertEqual(result["mapping"][hoe], ["sashimi platter"])
        self.assertNotIn(("raw-fish", "miss"), [(e["value"], e["outcome"]) for e in result["entries"] if e["item"] == hoe])


def rule_row(**overrides):
    """A hand-built `nums` row for evaluate_rules: every count zero, three repeats, one plate run."""
    row = {"repeats": 3, "plate_runs": 1, "preg_clear_typed_per_repeat": [0, 0, 0], "preg_clear_typed_failed_per_repeat": [0, 0, 0],
           "preg_clear_typed_distinct": 0}
    for kind in ("preg", "alg"):
        for cl in ("clear", "nonclear"):
            for k in ("total_per3", "total_listed_per3", "typed_distinct", "plates_distinct", "failed_total_per3", "total_strict_per3"):
                row[f"{kind}_{cl}_{k}"] = 0
    row.update(overrides)
    return row


def verdict(rules, rule, ref="B"):
    return next(r for r in rules if r["rule"] == rule and r.get("ref", ref) == ref)["verdict"]


class ErrorRecordsAndEmptyAnswers(unittest.TestCase):
    """A call that raised is `{"error": ...}`; a valid answer with no foods is an answer, not a failure."""

    def test_call_failed_reads_every_shape(self):
        for answer in (
            {"error": "the call raised"},
            {"foods": None},
            {"foods": [], "schema_valid": False},
            {"foods": [], "error": "call failed: HTTP 500", "raw_ok": False},
            {"kind": "production", "foods": [], "schema_valid": False, "error": "HTTP 500: upstream"},
        ):
            self.assertTrue(score_flags.call_failed(answer), answer)
        for answer in (
            {"foods": [], "schema_valid": True},  # the model listed nothing: an answer
            {"foods": []},
            {"foods": [food("Tiramisu", "Tiramisu")], "schema_valid": False},  # it has foods to score
            {"foods": [food("Tiramisu", "Tiramisu")], "schema_valid": True},
        ):
            self.assertFalse(score_flags.call_failed(answer), answer)

    def test_an_error_record_goes_through_score_run_as_a_failed_call(self):
        for stored in ({"plate_text": {"error": "the call raised"}}, {"error": "the call raised"}):
            scored = score_flags.score_run({"x001": stored}, {"x001": CASE}, plate=False)
            self.assertEqual(scored["cases"], [], stored)
            self.assertEqual(len(scored["failed"]), 1, stored)
            self.assertEqual(scored["failed"][0]["error"], "the call raised")
            counts = score_flags.tally([scored])["counts"]
            self.assertEqual(counts["failed_calls"], 1)
            self.assertEqual(counts.get("preg_clear_miss", 0), 0)
            self.assertEqual(counts["preg_clear_failed_call"], 3)
            self.assertEqual(counts["alg_nonclear_failed_call"], 1)  # the clear:false sulphites entry
        # control: a real answer is scored, and no failed call is counted
        scored = score_flags.score_run(typed_results(good_answer()), {"x001": CASE}, plate=False)
        self.assertEqual((len(scored["cases"]), len(scored["failed"])), (1, 0))

    def test_a_valid_empty_answer_is_scored_and_every_clear_entry_is_a_miss(self):
        results = {"x001": {"plate_text": {"foods": [], "schema_valid": True}}}
        scored = score_flags.score_run(results, {"x001": CASE}, plate=False)
        self.assertEqual((len(scored["cases"]), len(scored["failed"])), (1, 0))
        entries = scored["cases"][0]["entries"]
        self.assertTrue(all(e["outcome"] in ("unlisted_miss", "unlisted_unscored") for e in entries))
        self.assertEqual(sum(1 for e in entries if e["outcome"] == "unlisted_miss"), 6)
        # control: the same empty list marked schema-invalid is a failed call and scores nothing
        invalid = score_flags.score_run({"x001": {"plate_text": {"foods": [], "schema_valid": False}}}, {"x001": CASE}, plate=False)
        self.assertEqual((len(invalid["cases"]), len(invalid["failed"])), (0, 1))


class RuleVerdicts(unittest.TestCase):
    def test_rule_2_needs_the_expected_number_of_repeats(self):
        two = rule_row(repeats=2, preg_clear_typed_per_repeat=[0, 0], preg_clear_typed_failed_per_repeat=[0, 0])
        rules = score_flags.evaluate_rules({"D": two, "B": rule_row(), "C": rule_row()})
        self.assertEqual(verdict(rules, 2), "INCOMPLETE")
        self.assertIn("holds 2 typed repeat(s), the rule needs 3", rules[0]["numbers"])
        # control: all three repeats pass; two repeats pass when the config says two are expected
        self.assertEqual(verdict(score_flags.evaluate_rules({"D": rule_row(), "B": rule_row(), "C": rule_row()}), 2), "PASS")
        self.assertEqual(verdict(score_flags.evaluate_rules({"D": two, "B": rule_row(), "C": rule_row()}, expected_repeats=2), 2), "PASS")

    def test_a_miss_is_a_fail_even_when_the_repeats_are_incomplete(self):
        short = rule_row(repeats=1, preg_clear_typed_per_repeat=[1], preg_clear_typed_failed_per_repeat=[0], preg_clear_typed_distinct=1)
        rules = score_flags.evaluate_rules({"D": short, "B": rule_row(), "C": rule_row()})
        self.assertEqual(verdict(rules, 2), "FAIL")

    def test_rule_2_is_inconclusive_when_a_failed_call_holds_a_clear_entry(self):
        failed = rule_row(preg_clear_typed_failed_per_repeat=[0, 3, 0])
        rules = score_flags.evaluate_rules({"D": failed, "B": rule_row(), "C": rule_row()})
        self.assertEqual(verdict(rules, 2), "INCONCLUSIVE")
        self.assertEqual(rules[0]["strict_with_failed_calls"], "FAIL")
        self.assertEqual(verdict(score_flags.evaluate_rules({"D": rule_row(), "B": rule_row(), "C": rule_row()}), 2), "PASS")

    def test_rules_3_and_4_need_the_clear_and_the_all_entries_comparison_to_pass(self):
        for kind, rule in (("preg", 3), ("alg", 4)):
            # clear misses equal, but the test cell misses more on clear:false entries
            worse_nonclear = rule_row(**{f"{kind}_nonclear_total_per3": 2.0})
            rules = score_flags.evaluate_rules({"D": worse_nonclear, "B": rule_row(), "C": rule_row()})
            row = next(r for r in rules if r["rule"] == rule and r["ref"] == "B")
            self.assertEqual((row["verdict"], row["clear_verdict"], row["all_verdict"]), ("FAIL", "PASS", "FAIL"), kind)
            self.assertIn("clear only: D 0 vs B 0 (PASS)", row["numbers"])
            self.assertIn("all entries: D 2 vs B 0 (FAIL)", row["with_nonclear"])
            # the clear comparison fails alone
            worse_clear = rule_row(**{f"{kind}_clear_total_per3": 1.0})
            rules = score_flags.evaluate_rules({"D": worse_clear, "B": rule_row(), "C": rule_row()})
            self.assertEqual(verdict(rules, rule), "FAIL", kind)
            # control: equal on both is a pass, and a test cell with fewer misses everywhere passes
            self.assertEqual(verdict(score_flags.evaluate_rules({"D": rule_row(), "B": rule_row(), "C": rule_row()}), rule), "PASS", kind)
            better = rule_row()
            ref = rule_row(**{f"{kind}_clear_total_per3": 1.0, f"{kind}_nonclear_total_per3": 1.0})
            self.assertEqual(verdict(score_flags.evaluate_rules({"D": better, "B": ref, "C": ref}), rule), "PASS", kind)

    def test_failed_calls_that_alone_flip_a_rule_make_it_inconclusive(self):
        for kind, rule in (("preg", 3), ("alg", 4)):
            # D and B have the same misses; D has two failed calls with clear entries, B none: counted, D is worse
            d = rule_row(**{f"{kind}_clear_failed_total_per3": 2.0})
            rules = score_flags.evaluate_rules({"D": d, "B": rule_row(), "C": rule_row()})
            row = next(r for r in rules if r["rule"] == rule and r["ref"] == "B")
            self.assertEqual((row["verdict_without_failed_calls"], row["verdict_with_failed_calls"], row["verdict"]), ("PASS", "FAIL", "INCONCLUSIVE"), kind)
            self.assertIn("failed calls counted as misses: clear D 2 vs B 0 (FAIL)", row["with_failed_calls"])
            # the other direction: the ref has the failed calls, so counting them flips a FAIL to a PASS
            worse = rule_row(**{f"{kind}_clear_total_per3": 1.0})
            ref = rule_row(**{f"{kind}_clear_failed_total_per3": 3.0})
            rules = score_flags.evaluate_rules({"D": worse, "B": ref, "C": rule_row()})
            self.assertEqual(verdict(rules, rule), "INCONCLUSIVE", kind)
            # control: failed calls on both sides in equal number change nothing
            both = rule_row(**{f"{kind}_clear_failed_total_per3": 2.0})
            self.assertEqual(verdict(score_flags.evaluate_rules({"D": both, "B": both, "C": rule_row()}), rule), "PASS", kind)

    def test_a_decisive_fail_stays_a_fail_when_failed_calls_would_not_change_it(self):
        worse = rule_row(preg_clear_total_per3=2.0, preg_clear_failed_total_per3=1.0)
        self.assertEqual(verdict(score_flags.evaluate_rules({"D": worse, "B": rule_row(), "C": rule_row()}), 3), "FAIL")


class ExpectedRepeatsConfig(unittest.TestCase):
    def config(self, **extra):
        cfg = {"test": "X", "refs": [], "cells": {"X": {"label": "x", "text": ["a"]}}, **extra}
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        path = Path(self.tmp.name) / "cells.json"
        path.write_text(json.dumps(cfg), encoding="utf-8")
        return path

    def test_expected_repeats_defaults_to_three_and_is_validated(self):
        self.assertEqual(score_flags.load_config(self.config())["expected_repeats"], 3)
        self.assertEqual(score_flags.load_config(self.config(expected_repeats=2))["expected_repeats"], 2)
        for bad in (0, -1, "3", 2.5, True):
            with self.assertRaises(ValueError, msg=repr(bad)):
                score_flags.load_config(self.config(expected_repeats=bad))

    def test_the_committed_v3_config_loads_with_the_default(self):
        cfg = score_flags.load_config(score_flags.EVAL_ROOT / "configs" / "score-flags-v3.json")
        self.assertEqual(cfg["expected_repeats"], 3)


class PipelineVerdicts(unittest.TestCase):
    """The whole path: run files on disk, run_scoring, the rule rows. Numbers come from the answers, not by hand."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.runs = Path(self.tmp.name)

    def score(self, cells, expected_repeats=3, test="T", refs=("R",), text_gold=None):
        cfg = {"test": test, "refs": list(refs), "cells": cells, "expected_repeats": expected_repeats, "skipped_cells": {}}
        return score_flags.run_scoring(cfg, self.runs, None, text_gold={"x001": CASE} if text_gold is None else text_gold, plate_gold={})

    def repeats(self, prefix, answers):
        names = []
        for i, stored in enumerate(answers, start=1):
            write_run(self.runs / f"{prefix}-r{i}", {"x001": stored})
            names.append(f"{prefix}-r{i}")
        return names

    def test_a_failed_call_in_a_repeat_turns_rule_2_inconclusive_through_the_real_pipeline(self):
        good = {"plate_text": {"foods": good_answer(), "schema_valid": True}}
        raised = {"plate_text": {"error": "the call raised"}}
        cells = {
            "T": {"label": "test", "text": self.repeats("t", [good, raised, good])},
            "R": {"label": "ref", "text": self.repeats("r", [good, good, good])},
        }
        doc = self.score(cells)
        self.assertEqual(doc["rules"][0]["verdict"], "INCONCLUSIVE")
        self.assertEqual(doc["numbers"]["T"]["preg_clear_typed_failed_per_repeat"], [0, 3, 0])
        rule3 = next(r for r in doc["rules"] if r["rule"] == 3)
        # no flag miss anywhere, yet the failed call's three clear pregnancy entries would flip rule 3
        self.assertEqual((rule3["verdict_without_failed_calls"], rule3["verdict_with_failed_calls"], rule3["verdict"]), ("PASS", "FAIL", "INCONCLUSIVE"))
        # control: three good repeats pass everything
        cells["T"]["text"] = self.repeats("t2", [good, good, good])
        doc = self.score(cells)
        self.assertEqual([r["verdict"] for r in doc["rules"]], ["PASS", "PASS", "PASS"])

    def test_two_repeats_of_a_cell_are_incomplete_through_the_real_pipeline(self):
        good = {"plate_text": {"foods": good_answer(), "schema_valid": True}}
        cells = {"T": {"label": "test", "text": self.repeats("t", [good, good])}, "R": {"label": "ref", "text": self.repeats("r", [good, good, good])}}
        self.assertEqual(self.score(cells)["rules"][0]["verdict"], "INCOMPLETE")
        self.assertEqual(self.score(cells, expected_repeats=2)["rules"][0]["verdict"], "PASS")

    def test_a_non_clear_miss_alone_fails_rule_4_through_the_real_pipeline(self):
        good = {"plate_text": {"foods": good_answer(), "schema_valid": True}}
        no_sulphites = good_answer()
        no_sulphites[1]["flags"]["allergens"] = []  # the sulphites entry is clear: false
        weak = {"plate_text": {"foods": no_sulphites, "schema_valid": True}}
        cells = {"T": {"label": "test", "text": self.repeats("t", [weak] * 3)}, "R": {"label": "ref", "text": self.repeats("r", [good] * 3)}}
        doc = self.score(cells)
        rule4 = next(r for r in doc["rules"] if r["rule"] == 4)
        self.assertEqual((rule4["clear_verdict"], rule4["all_verdict"], rule4["verdict"]), ("PASS", "FAIL", "FAIL"))
        self.assertIn("all entries: T 3 vs R 0 (FAIL)", rule4["with_nonclear"])

    def test_the_markdown_and_json_carry_the_new_lines(self):
        good = {"plate_text": {"foods": good_answer(), "schema_valid": True}}
        raised = {"plate_text": {"error": "the call raised"}}
        cells = {"T": {"label": "test", "text": self.repeats("t", [good, raised])}, "R": {"label": "ref", "text": self.repeats("r", [good] * 3)}}
        cfg = {"test": "T", "refs": ["R"], "cells": cells, "expected_repeats": 3, "skipped_cells": {}}
        stem = self.runs / "out" / "REPORT"
        score_flags.run_scoring(cfg, self.runs, stem, text_gold={"x001": CASE}, plate_gold={})
        md = Path(f"{stem}.md").read_text(encoding="utf-8")
        for needle in ("INCOMPLETE", "failed calls counted as misses", "clear only: T", "all entries: T",
                       "Name matching and merge leniency per cell", "items outside the gold", "hits via a merged item",
                       "the call raised"):
            self.assertIn(needle, md)
        self.assertNotIn(chr(0x2014), md)
        self.assertNotIn(chr(0x2013), md)
        doc = json.loads(Path(f"{stem}.json").read_text(encoding="utf-8"))
        self.assertEqual(doc["rules"][0]["verdict"], "INCOMPLETE")

    def test_items_that_match_no_gold_name_are_counted_per_cell(self):
        stranger = good_answer() + [food("Zanderfilet", "pikeperch fillet", [], ["fish"])]
        renamed = [f for f in good_answer() if f["name"] != "Rotwein"] + [food("Mineralwasser", "mineral water", [], [])]
        cells = {
            "T": {"label": "test", "text": self.repeats("t", [{"plate_text": {"foods": renamed, "schema_valid": True}}] * 3)},
            "R": {"label": "ref", "text": self.repeats("r", [{"plate_text": {"foods": stranger, "schema_valid": True}}] * 3)},
        }
        doc = self.score(cells)
        t, r = doc["numbers"]["T"], doc["numbers"]["R"]
        self.assertEqual((t["outside_items_typed"], r["outside_items_typed"]), (3, 3))
        self.assertEqual((t["outside_items_flagged_typed"], r["outside_items_flagged_typed"]), (0, 3))
        # the wine is gone from T's answers: its two entries (one clear) have no holder in each of three repeats
        self.assertEqual((t["unlisted_entries_typed"], r["unlisted_entries_typed"]), (6, 0))
        # control: the plain good answer matches everything
        cells["R"]["text"] = self.repeats("r2", [{"plate_text": {"foods": good_answer(), "schema_valid": True}}] * 3)
        self.assertEqual(self.score(cells)["numbers"]["R"]["outside_items_typed"], 0)


MERGE_CASE = {
    "id": "m001",
    "input": "Kaffee und Hafermilch",
    "core": ["coffee", "oat milk"],
    "must_flag": [
        {"item": "coffee", "kind": "allergen", "value": "milk"},
        {"item": "oat milk", "kind": "allergen", "value": "milk"},
    ],
    "may_flag": [],
    "must_not_flag": [],
    "clear": True,
}


class MergeLeniency(unittest.TestCase):
    def merged(self):
        return [food("Kaffee mit Hafermilch", "Coffee with oat milk", [], ["milk"])]

    def split(self):
        return [food("Kaffee", "Coffee", [], ["milk"]), food("Hafermilch", "Oat milk", [], ["milk"])]

    def test_a_flag_on_an_item_that_holds_two_foods_credits_both_but_counts_once_in_the_strict_view(self):
        result = score_flags.score_case(MERGE_CASE, self.merged(), plate=False)
        self.assertEqual(misses(result), [])
        self.assertEqual([e["merged_credit"] for e in result["entries"]], [True, True])
        self.assertEqual([e["strict_outcome"] for e in result["entries"]], ["hit", "miss"])
        counts = score_flags.tally([{"cases": [result], "failed": []}])["counts"]
        self.assertEqual(counts["alg_clear_hit_merged"], 2)
        self.assertEqual(counts["alg_clear_strict_extra_miss"], 1)
        self.assertEqual(counts.get("alg_clear_miss", 0), 0)  # the lenient view is unchanged

    def test_control_two_separate_items_are_no_merge_and_cost_nothing_in_the_strict_view(self):
        result = score_flags.score_case(MERGE_CASE, self.split(), plate=False)
        self.assertEqual([e["merged_credit"] for e in result["entries"]], [False, False])
        self.assertEqual([e["strict_outcome"] for e in result["entries"]], ["hit", "hit"])
        counts = score_flags.tally([{"cases": [result], "failed": []}])["counts"]
        self.assertEqual(counts.get("alg_clear_hit_merged", 0), 0)
        self.assertEqual(counts.get("alg_clear_strict_extra_miss", 0), 0)

    def test_a_flag_one_single_food_item_also_carries_is_not_a_merge_credit(self):
        foods = self.merged() + [food("Hafermilch", "Oat milk", [], ["milk"])]
        result = score_flags.score_case(MERGE_CASE, foods, plate=False)
        oat = next(e for e in result["entries"] if e["item"] == "oat milk")
        self.assertFalse(oat["merged_credit"])
        self.assertEqual(oat["strict_outcome"], "hit")

    def test_the_rule_rows_print_the_strict_view_and_it_does_not_decide(self):
        with tempfile.TemporaryDirectory() as tmp:
            runs = Path(tmp)
            for name, foods in (("t", self.merged()), ("r", self.split())):
                for i in (1, 2, 3):
                    write_run(runs / f"{name}-r{i}", {"m001": {"plate_text": {"foods": foods, "schema_valid": True}}})
            cells = {"T": {"label": "t", "text": [f"t-r{i}" for i in (1, 2, 3)]}, "R": {"label": "r", "text": [f"r-r{i}" for i in (1, 2, 3)]}}
            cfg = {"test": "T", "refs": ["R"], "cells": cells, "skipped_cells": {}}
            doc = score_flags.run_scoring(cfg, runs, None, text_gold={"m001": MERGE_CASE}, plate_gold={})
        rule4 = next(r for r in doc["rules"] if r["rule"] == 4)
        self.assertEqual(rule4["verdict"], "PASS")  # lenient reading decides
        self.assertIn("clear T 3 vs R 0 (FAIL)", rule4["strict_merge_view"])
        self.assertEqual(doc["numbers"]["T"]["alg_clear_hit_merged_typed"], 6)
        self.assertEqual(doc["numbers"]["R"]["alg_clear_hit_merged_typed"], 0)


class CallFailedPrecedence(unittest.TestCase):
    def test_the_parenthesised_condition_means_what_it_says(self):
        # A or (B and C): no foods key at all fails even with a valid flag; foods present never fails on the flag
        self.assertTrue(score_flags.call_failed({"schema_valid": True}))
        self.assertFalse(score_flags.call_failed({"foods": [food("a", "a")], "schema_valid": False}))


if __name__ == "__main__":
    unittest.main()
