"""Gold aliases and component credit in the flag scorer.

Every check has a control: the same answer scored without the `aliases` field, or with a food the alias must
not reach, gives the other result. A check that cannot fail would pass both.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from harness import score_flags
from tests.test_score_flags import CASE, food, good_answer, misses, outcomes
from tests.test_score_flags_holdout import HoldoutBase, answer, write

BREAD = [{"name": "Brot", "component": True}, {"name": "bread", "component": True}]

ACASE = {
    "id": "h901",
    "input": "Kasseler, Leerdammer aufs Brot, Neeps",
    "lang": "de",
    "core": ["Kassler (cured pork)", "Leerdammer cheese on bread", "mashed swede (neeps)", "mashed potatoes (tatties)"],
    "aliases": {
        "Kassler (cured pork)": ["Kasseler"],
        "Leerdammer cheese on bread": BREAD,
        "mashed swede (neeps)": ["rutabaga", "neeps"],
    },
    "must_flag": [
        {"item": "Kassler (cured pork)", "kind": "allergen", "value": "mustard"},
        {"item": "Leerdammer cheese on bread", "kind": "allergen", "value": "milk"},
        {"item": "Leerdammer cheese on bread", "kind": "allergen", "value": "gluten"},
        {"item": "mashed swede (neeps)", "kind": "allergen", "value": "milk"},
    ],
    "may_flag": [],
    "must_not_flag": [{"item": "Leerdammer cheese on bread", "kind": "pregnancy", "value": "raw-dairy"}],
    "clear": True,
}


def without_aliases(case):
    case = copy.deepcopy(case)
    case.pop("aliases", None)
    return case


def a_answer():
    return [
        food("Kasseler", "Cured pork loin", [], ["mustard"]),
        food("Leerdammer Käse", "Leerdammer cheese", [], ["milk"]),
        food("Brot", "Bread", [], ["gluten"]),
        food("Mashed rutabaga", "Mashed rutabaga", [], ["milk"]),
        food("Kartoffelpüree", "Mashed potatoes", [], ["milk"]),
    ]


def credits(result):
    return {(e["item"], e["value"]): e["credit"] for e in result["entries"] if e.get("credit")}


class AliasMapping(unittest.TestCase):
    def test_an_alias_holds_the_gold_item_a_spelling_variant_names(self):
        result = score_flags.score_case(ACASE, a_answer(), plate=False)
        self.assertEqual(result["mapping"]["Kassler (cured pork)"], ["Kasseler"])
        self.assertEqual(result["mapping"]["mashed swede (neeps)"], ["Mashed rutabaga"])
        self.assertEqual(result["outside_gold"], [])
        self.assertEqual(misses(result), [])
        # control: the same answer against the gold without aliases leaves both items unheld and unscored
        plain = score_flags.score_case(without_aliases(ACASE), a_answer(), plate=False)
        self.assertEqual(plain["mapping"]["Kassler (cured pork)"], [])
        self.assertEqual(plain["mapping"]["mashed swede (neeps)"], [])
        self.assertEqual({o["name"] for o in plain["outside_gold"]}, {"Kasseler", "Brot", "Mashed rutabaga"})
        self.assertEqual(outcomes(plain)[("Kassler (cured pork)", "allergen", "mustard")], "unlisted_miss")

    def test_an_alias_is_found_inside_a_longer_name_and_in_the_english_translation(self):
        longer = food("Kasseler Nacken mit Senf", "Smoked pork neck", [], ["mustard"])
        result = score_flags.score_case(ACASE, [longer] + a_answer()[1:], plate=False)
        self.assertEqual(result["mapping"]["Kassler (cured pork)"], ["Kasseler Nacken mit Senf"])
        english = food("Steckrübenstampf", "Mashed Neeps", [], ["milk"])
        result = score_flags.score_case(ACASE, a_answer()[:3] + [english], plate=False)
        self.assertEqual(result["mapping"]["mashed swede (neeps)"], ["Steckrübenstampf"])

    def test_an_alias_never_reaches_a_different_food(self):
        # a carrot mash shares the word mash with the swede item and no alias word: it is outside the gold
        foods = a_answer()[:3] + [food("Karottenpüree", "Mashed carrots", [], ["milk"])]
        result = score_flags.score_case(ACASE, foods, plate=False)
        self.assertEqual(result["mapping"]["mashed swede (neeps)"], [])
        self.assertEqual([o["name"] for o in result["outside_gold"]], ["Karottenpüree"])
        self.assertEqual(outcomes(result)[("mashed swede (neeps)", "allergen", "milk")], "unlisted_miss")
        # the alias of one item does not hold another item of the case
        result = score_flags.score_case(ACASE, a_answer(), plate=False)
        self.assertEqual(result["mapping"]["mashed potatoes (tatties)"], ["Kartoffelpüree"])
        self.assertNotIn("Kasseler", result["mapping"]["mashed potatoes (tatties)"])
        # a word that is only part of an alias word is no match: rutabagas is the plural, rutabagaceous is not
        odd = food("Rutabagaceous", "Rutabagaceous", [], ["milk"])
        self.assertEqual(score_flags.score_case(ACASE, a_answer()[:3] + [odd], plate=False)["mapping"]["mashed swede (neeps)"], [])

    def test_an_alias_adds_holders_and_never_removes_one(self):
        # held by the word overlap already: the alias does not touch it, and no credit is claimed for the alias
        foods = [food("Kassler", "Kassler", [], ["mustard"])] + a_answer()[1:]
        result = score_flags.score_case(ACASE, foods, plate=False)
        self.assertEqual(result["mapping"]["Kassler (cured pork)"], ["Kassler"])
        self.assertNotIn(("Kassler (cured pork)", "mustard"), credits(result))

    def test_the_two_names_of_one_model_item_are_both_read(self):
        merged = food("Tamago kake gohan mit Natto", "Tamago kake gohan with natto", ["raw-egg"], ["eggs", "soybeans"])
        case = {
            "id": "h902",
            "input": "x",
            "core": ["rice with raw egg (tamago kake gohan)", "natto"],
            "aliases": {"rice with raw egg (tamago kake gohan)": ["tamago kake gohan"], "natto": ["fermented soybeans"]},
            "must_flag": [{"item": "rice with raw egg (tamago kake gohan)", "kind": "pregnancy", "value": "raw-egg"}],
            "may_flag": [],
            "must_not_flag": [],
            "clear": True,
        }
        with_alias = score_flags.score_case(case, [merged], plate=False)
        self.assertEqual(with_alias["mapping"]["rice with raw egg (tamago kake gohan)"], ["Tamago kake gohan mit Natto"])
        self.assertEqual(misses(with_alias), [])
        self.assertEqual(credits(with_alias), {("rice with raw egg (tamago kake gohan)", "raw-egg"): "alias"})
        plain = score_flags.score_case(without_aliases(case), [merged], plate=False)
        self.assertEqual(len(misses(plain)), 1)


class AliasCredit(unittest.TestCase):
    def test_a_hit_only_an_alias_made_is_marked_alias(self):
        result = score_flags.score_case(ACASE, a_answer(), plate=False)
        got = credits(result)
        self.assertEqual(got[("Kassler (cured pork)", "mustard")], "alias")
        self.assertEqual(got[("mashed swede (neeps)", "milk")], "alias")
        # control: no alias in the gold, no credit key anywhere
        plain = score_flags.score_case(without_aliases(ACASE), a_answer(), plate=False)
        self.assertEqual(credits(plain), {})
        self.assertTrue(all("credit" not in e for e in plain["entries"]))

    def test_a_flag_the_aliased_item_lacks_is_still_a_miss(self):
        foods = a_answer()
        foods[0]["flags"]["allergens"] = []
        result = score_flags.score_case(ACASE, foods, plate=False)
        self.assertEqual(outcomes(result)[("Kassler (cured pork)", "allergen", "mustard")], "miss")
        self.assertNotIn(("Kassler (cured pork)", "mustard"), credits(result))

    def test_the_tally_counts_the_credits_and_a_gold_without_aliases_has_no_such_key(self):
        scored = [{"run": "r", "cases": [score_flags.score_case(ACASE, a_answer(), plate=False)], "failed": []}]
        counts = score_flags.tally(scored)["counts"]
        self.assertEqual(counts["credit_alias"], 2)
        self.assertEqual(counts["credit_component"], 1)
        plain = [{"run": "r", "cases": [score_flags.score_case(without_aliases(ACASE), a_answer(), plate=False)], "failed": []}]
        self.assertFalse([k for k in score_flags.tally(plain)["counts"] if "credit" in k.replace("merged_credit", "")])


class ComponentCredit(unittest.TestCase):
    def test_gluten_on_the_bread_counts_for_the_cheese_on_bread(self):
        result = score_flags.score_case(ACASE, a_answer(), plate=False)
        self.assertEqual(outcomes(result)[("Leerdammer cheese on bread", "allergen", "gluten")], "hit")
        self.assertEqual(credits(result)[("Leerdammer cheese on bread", "gluten")], "component")
        self.assertEqual(result["mapping"]["Leerdammer cheese on bread"], ["Leerdammer Käse", "Brot"])
        # the milk sits on the cheese itself: a plain hit, no credit
        self.assertNotIn(("Leerdammer cheese on bread", "milk"), credits(result))
        self.assertEqual(result["outside_gold"], [])
        # control: without aliases the bread is outside the gold and the gluten is a miss
        plain = score_flags.score_case(without_aliases(ACASE), a_answer(), plate=False)
        self.assertEqual(outcomes(plain)[("Leerdammer cheese on bread", "allergen", "gluten")], "miss")
        self.assertIn("Brot", [o["name"] for o in plain["outside_gold"]])

    def test_no_credit_when_the_component_carries_no_flag(self):
        foods = a_answer()
        foods[2]["flags"]["allergens"] = []
        result = score_flags.score_case(ACASE, foods, plate=False)
        self.assertEqual(outcomes(result)[("Leerdammer cheese on bread", "allergen", "gluten")], "miss")
        self.assertNotIn(("Leerdammer cheese on bread", "gluten"), credits(result))
        # the bread is still mapped: it is no item outside the gold
        self.assertEqual(result["outside_gold"], [])

    def test_a_flag_on_another_food_is_no_component_credit(self):
        foods = a_answer()
        foods[2]["flags"]["allergens"] = []
        foods[4]["flags"]["allergens"] = ["milk", "gluten"]  # the mashed potatoes carry the gluten
        result = score_flags.score_case(ACASE, foods, plate=False)
        self.assertEqual(outcomes(result)[("Leerdammer cheese on bread", "allergen", "gluten")], "miss")

    def test_only_the_full_name_of_a_component_is_one(self):
        # "Brot mit Butter" is a different item from the bread: outside the gold, no credit
        foods = a_answer()
        foods[2] = food("Brot mit Butter", "Bread with butter", [], ["gluten", "milk"])
        result = score_flags.score_case(ACASE, foods, plate=False)
        self.assertEqual([o["name"] for o in result["outside_gold"]], ["Brot mit Butter"])
        self.assertEqual(outcomes(result)[("Leerdammer cheese on bread", "allergen", "gluten")], "miss")
        # a bread of another kind is not named by the component alias either
        foods[2] = food("Roggenbrot", "Rye bread", [], ["gluten"])
        result = score_flags.score_case(ACASE, foods, plate=False)
        self.assertEqual(outcomes(result)[("Leerdammer cheese on bread", "allergen", "gluten")], "miss")

    def test_a_component_never_becomes_one_when_the_gold_lists_no_component(self):
        case = copy.deepcopy(ACASE)
        case["aliases"] = {"Kassler (cured pork)": ["Kasseler"]}
        result = score_flags.score_case(case, a_answer(), plate=False)
        self.assertEqual(outcomes(result)[("Leerdammer cheese on bread", "allergen", "gluten")], "miss")
        self.assertIn("Brot", [o["name"] for o in result["outside_gold"]])

    def test_a_flag_the_gold_forbids_on_the_component_is_a_false_alarm(self):
        foods = a_answer()
        foods[2]["flags"]["pregnancy"] = ["raw-dairy"]
        result = score_flags.score_case(ACASE, foods, plate=False)
        self.assertEqual([(f["item"], f["value"]) for f in result["false_alarms"]], [("Leerdammer cheese on bread", "raw-dairy")])
        # control: a clean bread raises none
        self.assertEqual(score_flags.score_case(ACASE, a_answer(), plate=False)["false_alarms"], [])

    def test_the_component_alone_lists_the_item_and_a_miss_stays_a_miss(self):
        only_bread = [f for f in a_answer() if f["name"] != "Leerdammer Käse"]
        result = score_flags.score_case(ACASE, only_bread, plate=False)
        got = outcomes(result)
        self.assertEqual(got[("Leerdammer cheese on bread", "allergen", "gluten")], "hit")
        self.assertEqual(got[("Leerdammer cheese on bread", "allergen", "milk")], "miss")


class ReportsAndCommittedGold(HoldoutBase):
    def run_doc(self, gold):
        holdout = write(self.runs / "th-r1", {cid: {"plate_text": {"foods": a_answer(), "schema_valid": True}} for cid in gold})
        cells = {"T": {"label": "t", "text": self.typed_runs("t", [answer(good_answer())]), "holdout": [holdout]}}
        cfg = {"test": "T", "refs": [], "cells": cells, "skipped_cells": {}, "expected_repeats": 1, "config_path": "x.json"}
        stem = self.runs / "out" / "REPORT"
        doc = score_flags.run_scoring(cfg, self.runs, stem, text_gold={"x001": CASE}, plate_gold={}, holdout_gold_override=gold)
        return doc, Path(f"{stem}.md").read_text(encoding="utf-8")

    def test_the_report_counts_credits_per_cell_and_names_the_credited_entries(self):
        doc, md = self.run_doc({"h901": ACASE})
        cell = doc["holdout"]["cells"]["T"]
        self.assertEqual(cell["alias_credits_per_repeat"], [2])
        self.assertEqual(cell["component_credits_per_repeat"], [1])
        self.assertEqual({(c["item"], c["value"], c["via"]) for c in cell["credited"]}, {
            ("Kassler (cured pork)", "mustard", "alias"),
            ("mashed swede (neeps)", "milk", "alias"),
            ("Leerdammer cheese on bread", "gluten", "component"),
        })
        self.assertIn("### Hits credited through aliases and components", md)
        self.assertIn("| T | 1 | [2] | [1] |", md)
        self.assertIn("component", md[md.index("#### Cell T: credited entries"):])
        self.assertNotIn(chr(0x2014), md)
        self.assertNotIn(chr(0x2013), md)

    def test_a_gold_without_aliases_reports_exactly_as_before(self):
        doc, md = self.run_doc({"h901": without_aliases(ACASE)})
        cell = doc["holdout"]["cells"]["T"]
        self.assertNotIn("alias_credits_per_repeat", cell)
        self.assertNotIn("credited", cell)
        self.assertNotIn("Hits credited through aliases", md)
        self.assertNotIn("aliases", md.lower())
        run = doc["holdout"]["scored"]["cells"]["T"]["runs"][0]
        self.assertTrue(all("alias_hits" not in c and "component_hits" not in c for c in run["cases"]))

    def test_the_compact_json_counts_the_credits_per_answer(self):
        doc, _ = self.run_doc({"h901": ACASE})
        case = doc["holdout"]["scored"]["cells"]["T"]["runs"][0]["cases"][0]
        self.assertEqual((case["alias_hits"], case["component_hits"]), (2, 1))

    def test_the_component_is_mapped_beside_the_item_it_belongs_to_and_is_not_unmatched(self):
        gold = score_flags.load_text_gold(score_flags.GOLD_DIR / "gold_text_holdout.jsonl")
        foods = [food("Leerdammer Käse", "Leerdammer cheese", [], ["milk"]), food("Brot", "Bread", [], ["gluten"])]
        mapped = score_flags.map_items_ex("h033", gold["h033"]["core"], foods, gold["h033"].get("aliases"))
        self.assertEqual(mapped["components"]["Leerdammer cheese on bread"], [1])
        self.assertEqual(mapped["unmatched"], [])
        # control: without the alias list the bread is unmatched
        mapped = score_flags.map_items_ex("h033", gold["h033"]["core"], foods, None)
        self.assertEqual(mapped["unmatched"], [1])
        # map_items keeps its two-part answer for the callers that only want holders
        holders, unmatched = score_flags.map_items("h033", gold["h033"]["core"], foods, gold["h033"].get("aliases"))
        self.assertEqual(holders["Leerdammer cheese on bread"], [0])
        self.assertEqual(unmatched, [])


class CommittedGold(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gold = score_flags.load_text_gold(score_flags.GOLD_DIR / "gold_text_holdout.jsonl")
        spec = importlib.util.spec_from_file_location("check_new_gold", score_flags.GOLD_DIR / "check_new_gold.py")
        cls.check = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.check)

    def names(self, cid, item):
        out = []
        for e in self.gold[cid]["aliases"][item]:
            out.append(e["name"] if isinstance(e, dict) else e)
        return out

    def test_the_naming_gaps_are_closed_with_language_facts(self):
        self.assertIn("Kasseler", self.names("h034", "Kassler (cured, smoked and cooked pork)"))
        for name in ("Seelachsschnitzel", "saithe", "pollock", "Seelachs"):
            self.assertIn(name, self.names("h011", "smoked saithe slices (Seelachsschnitzel)"))
        for name in ("rutabaga", "swede", "neeps"):
            self.assertIn(name, self.names("h004", "mashed swede (neeps)"))
        self.assertIn("tabouleh", self.names("h021", "tabbouleh with lentil sprouts and feta"))
        self.assertIn("tamago kake gohan", self.names("h014", "rice with raw egg (tamago kake gohan)"))
        self.assertIn("fermented soybeans", self.names("h014", "natto"))
        for cid, item in (("h033", "Leerdammer cheese on bread"), ("h018", "wholegrain bread with cream cheese and sunflower sprouts")):
            comps = [e["name"] for e in self.gold[cid]["aliases"][item] if isinstance(e, dict) and e.get("component")]
            for name in ("Brot", "Vollkornbrot", "bread", "wholegrain bread"):
                self.assertIn(name, comps)

    def test_a_model_naming_drift_is_not_an_alias(self):
        # the decaf latte case keeps no alias: "cappuccino" is another drink
        self.assertNotIn("aliases", self.gold["h035"])
        for case in self.gold.values():
            for entries in case.get("aliases", {}).values():
                for e in entries:
                    self.assertNotIn("cappuccino", (e["name"] if isinstance(e, dict) else e).lower())

    def test_the_committed_gold_passes_the_checker(self):
        rep = self.check.Report()
        self.check.check_text(str(score_flags.GOLD_DIR / "gold_text_holdout.jsonl"), rep, set())
        self.assertEqual(rep.errors, [])

    def test_the_checker_refuses_bad_aliases_and_takes_good_ones(self):
        core = ["Kassler (cured pork)", "cheese on bread"]

        def errors(aliases):
            rep = self.check.Report()
            self.check.check_aliases("w", aliases, core, rep)
            return rep.errors

        self.assertEqual(errors({"Kassler (cured pork)": ["Kasseler"], "cheese on bread": [{"name": "Brot", "component": True}]}), [])
        self.assertIn("not a core item", errors({"sauerkraut": ["Kraut"]})[0])
        self.assertIn("non-empty list", errors({"Kassler (cured pork)": []})[0])
        self.assertIn("non-empty object", errors({})[0])
        self.assertIn("holds no letter", errors({"Kassler (cured pork)": ["  "]})[0])
        self.assertIn("must be a string", errors({"Kassler (cured pork)": [{"name": "Brot"}]})[0])
        self.assertIn("must be a string", errors({"Kassler (cured pork)": [{"name": "Brot", "component": False}]})[0])
        self.assertIn("must be a string", errors({"Kassler (cured pork)": [7]})[0])
        self.assertIn("listed twice", errors({"Kassler (cured pork)": ["Kasseler", "kasseler"]})[0])
        self.assertIn("listed twice", errors({"Kassler (cured pork)": ["Brot"], "cheese on bread": ["Brot"]})[0])
        self.assertIn("another core item", errors({"Kassler (cured pork)": ["cheese on bread"]})[0])

    def test_the_checker_names_a_bad_alias_in_a_gold_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            rows = [json.loads(line) for line in (score_flags.GOLD_DIR / "gold_text_holdout.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
            rows[33]["aliases"] = {"sauerkraut": [], "not an item": ["x"]}
            path = Path(tmp) / "gold_text_holdout.jsonl"
            path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
            rep = self.check.Report()
            self.check.check_text(str(path), rep, set())
            self.assertEqual(len(rep.errors), 2)
            self.assertTrue(any("not a core item" in e for e in rep.errors))
            self.assertTrue(any("non-empty list" in e for e in rep.errors))


if __name__ == "__main__":
    unittest.main()
