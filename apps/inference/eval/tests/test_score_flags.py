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


if __name__ == "__main__":
    unittest.main()
