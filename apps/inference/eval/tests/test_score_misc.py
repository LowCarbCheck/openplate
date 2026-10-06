"""The misc scorer: every check has a planted wrong value that must be flagged and a planted fine value that must pass."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from harness import score_misc as sm

CONTRACT = json.loads(sm.CONTRACT.read_text(encoding="utf-8"))

KCAL_ROWS = {row["id"]: row for row in sm.load_jsonl(sm.GOLD / "gold_kcal_text.jsonl")}
RECIPE_CASES = {row["id"]: row for row in sm.load_jsonl(sm.GOLD / "gold_recipes.jsonl")}
PANTRY_CASES = {row["id"]: row for row in sm.load_jsonl(sm.GOLD / "gold_pantry.jsonl")}
TEXT_IDS = {row["id"] for row in sm.load_jsonl(sm.GOLD / "gold_text.jsonl")}


def food(name, kcal=None, carbs=None, confidence="high", en=None):
    return {"name": name, "confidence": confidence, "translations": {"en": en or name},
            "macrosPer100g": {"kcal": kcal, "carbs": carbs}}


class Numbers(unittest.TestCase):
    def test_percentile_interpolates(self):
        self.assertEqual(sm.percentile([1, 2, 3, 4, 5], 50), 3)
        self.assertAlmostEqual(sm.percentile([0, 10], 95), 9.5)
        self.assertIsNone(sm.percentile([], 95))


class KcalScorer(unittest.TestCase):
    def test_a_planted_wrong_kcal_is_flagged_and_a_fine_one_passes(self):
        # k004 cooked white rice: 130 kcal and 28.17 g carbs per 100 g
        wrong = sm.kcal_comparisons("r1:t015", "t015", {"foods": [food("cooked rice", kcal=200, carbs=28)]}, KCAL_ROWS)
        fine = sm.kcal_comparisons("r1:t015", "t015", {"foods": [food("cooked rice", kcal=135, carbs=28)]}, KCAL_ROWS)
        self.assertFalse(wrong[0]["kcal_ok"])
        self.assertAlmostEqual(wrong[0]["kcal_err_pct"], (200 - 130) / 130 * 100)
        self.assertTrue(fine[0]["kcal_ok"])

    def test_the_tolerance_edge(self):
        self.assertTrue(sm.within_tolerance(149.5, 130))   # +15.0 percent
        self.assertFalse(sm.within_tolerance(150, 130))    # +15.4 percent
        self.assertTrue(sm.within_tolerance(111, 130))
        self.assertFalse(sm.within_tolerance(110, 130))
        self.assertFalse(sm.within_tolerance(None, 130))

    def test_carbs_near_zero_use_the_absolute_floor(self):
        # k003 hard-boiled egg has 1.12 g carbs: 0.6 is 46 percent off but within 1 g
        row = sm.kcal_comparisons("r1:t013", "t013", {"foods": [food("hard-boiled eggs", kcal=155, carbs=0.6)]}, KCAL_ROWS)[0]
        self.assertTrue(row["carbs_ok"])
        row = sm.kcal_comparisons("r1:t013", "t013", {"foods": [food("hard-boiled eggs", kcal=155, carbs=5)]}, KCAL_ROWS)[0]
        self.assertFalse(row["carbs_ok"])

    def test_a_missing_item_is_reported_not_counted_as_right(self):
        row = sm.kcal_comparisons("r1:t015", "t015", {"foods": [food("spaghetti", kcal=130, carbs=28)]}, KCAL_ROWS)[0]
        self.assertFalse(row["matched"])
        summary = sm.summarise_kcal([row], "kcal")
        self.assertEqual((summary["compared"], summary["matched"], summary["within"]), (1, 0, 0))

    def test_a_null_kcal_is_not_within_tolerance(self):
        row = sm.kcal_comparisons("r1:t015", "t015", {"foods": [food("cooked rice", kcal=None, carbs=None)]}, KCAL_ROWS)[0]
        self.assertFalse(row["kcal_ok"])
        self.assertEqual(sm.summarise_kcal([row], "kcal")["null_value"], 1)

    def test_a_chocolate_bar_is_not_the_cola(self):
        # "chocolate" contains "cola": the pattern needs word boundaries
        answer = {"foods": [food("Snickers", kcal=490, carbs=60, en="peanut caramel chocolate bar"),
                            food("Cola", kcal=42, carbs=10.5, en="cola")]}
        row = sm.kcal_comparisons("r1:t017", "t017", answer, KCAL_ROWS)[0]
        self.assertEqual(row["item"], "Cola")
        self.assertTrue(row["kcal_ok"])
        only_bar = sm.kcal_comparisons("r1:t017", "t017", {"foods": [answer["foods"][0]]}, KCAL_ROWS)[0]
        self.assertFalse(only_bar["matched"])

    def test_summary_median_worst_and_low_reference_split(self):
        answers = [(105, "high"), (130, "high"), (200, "high")]
        rows = [sm.kcal_comparisons(f"r{i}:t015", "t015", {"foods": [food("rice", kcal=k, carbs=28, confidence=c)]}, KCAL_ROWS)[0]
                for i, (k, c) in enumerate(answers)]
        summary = sm.summarise_kcal(rows, "kcal")
        self.assertEqual(summary["within"], 1)
        self.assertEqual(summary["worst"][0]["kcal"], 200)
        self.assertAlmostEqual(summary["median_signed_err_pct"], 0.0)

    def test_calibration_counts_wrong_items_rated_high(self):
        rows = [
            sm.kcal_comparisons("a", "t015", {"foods": [food("rice", kcal=200, carbs=28, confidence="high")]}, KCAL_ROWS)[0],
            sm.kcal_comparisons("b", "t015", {"foods": [food("rice", kcal=200, carbs=28, confidence="low")]}, KCAL_ROWS)[0],
            sm.kcal_comparisons("c", "t015", {"foods": [food("rice", kcal=135, carbs=28, confidence="high")]}, KCAL_ROWS)[0],
        ]
        result = sm.calibration(rows)
        self.assertEqual((result["wrong"], result["wrong_rated_high"]), (2, 1))


class BrandChecks(unittest.TestCase):
    CASE = {"id": "t017", "expect_brand": {"Snickers bar": "Snickers"}, "expect_confidence": {"Snickers bar": "low"}}

    def test_high_confidence_and_a_wrong_brand_are_visible(self):
        good = {"foods": [dict(food("Snickers", confidence="low"), brand="Snickers")]}
        bad = {"foods": [dict(food("Snickers", confidence="high"), brand=None)]}
        good_result = sm.brand_checks("r1:t017", self.CASE, good)
        bad_result = sm.brand_checks("r1:t017", self.CASE, bad)
        self.assertEqual((good_result["confidence"], good_result["brand_ok"]), ("low", True))
        self.assertEqual((bad_result["confidence"], bad_result["brand_ok"]), ("high", False))

    def test_a_case_without_a_brand_is_skipped(self):
        self.assertIsNone(sm.brand_checks("r1:t001", {"id": "t001"}, {"foods": []}))


class NameMatching(unittest.TestCase):
    def test_matches_and_non_matches(self):
        self.assertTrue(sm.name_match("chopped tomatoes", "canned chopped tomatoes"))
        self.assertTrue(sm.name_match("Lachsfilet", "Lachs"))
        self.assertTrue(sm.name_match("Frischkäse", "Käse"))
        self.assertTrue(sm.name_match("rice", "bag of rice"))
        self.assertFalse(sm.name_match("rice", "rye bread"))
        self.assertFalse(sm.name_match("saffron", "rice"))
        self.assertFalse(sm.name_match("", "rice"))


class PantryChecker(unittest.TestCase):
    def answer(self, *items):
        return {"items": [{"name": n, "amount": a, "unit": u, "category": c, "confidence": conf,
                           "translations": {"en": en}} for n, en, a, u, c, conf in items], "notes": None}

    def test_a_planted_fine_answer_passes(self):
        good = self.answer(("Mehl", "flour", 2000, "g", "grain", "high"), ("Eier", "eggs", 6, "piece", "egg", "high"),
                           ("Milch", "milk", 1000, "ml", "dairy", "high"))
        self.assertEqual(sm.check_pantry_case(PANTRY_CASES["p001"], good)["failures"], [])

    def test_a_wrong_amount_is_flagged(self):
        bad = self.answer(("Mehl", "flour", 2, "g", "grain", "high"), ("Eier", "eggs", 6, "piece", "egg", "high"),
                          ("Milch", "milk", 1000, "ml", "dairy", "high"))
        self.assertEqual([k for k, _ in sm.check_pantry_case(PANTRY_CASES["p001"], bad)["failures"]], ["wrong_amount_unit"])

    def test_an_invented_amount_is_flagged_when_none_was_stated(self):
        bad = self.answer(("Butter", "butter", 250, "g", "dairy", "high"), ("Margarine", "margarine", None, None, "other", "high"),
                          ("Quark", "quark", 500, "g", "dairy", "high"))
        self.assertEqual([k for k, _ in sm.check_pantry_case(PANTRY_CASES["p003"], bad)["failures"]], ["amount_not_null"])

    def test_a_merged_item_is_a_missing_item(self):
        bad = self.answer(("Butter und Margarine", "butter and margarine", None, None, "dairy", "high"),
                          ("Quark", "quark", 500, "g", "dairy", "high"))
        kinds = [k for k, _ in sm.check_pantry_case(PANTRY_CASES["p003"], bad)["failures"]]
        self.assertIn("missing_item", kinds)

    def test_an_accepted_alternative_passes(self):
        good = self.answer(("rice", "rice", 1, "pack", "grain", "high"), ("cheese", "cheese", None, None, "dairy", "low"),
                           ("onions", "onions", 3, "piece", "produce", "high"))
        self.assertEqual(sm.check_pantry_case(PANTRY_CASES["p002"], good)["failures"], [])

    def test_missing_low_confidence_is_flagged(self):
        bad = self.answer(("rice", "rice", None, None, "grain", "high"), ("cheese", "cheese", None, None, "dairy", "high"),
                          ("onions", "onions", 3, "piece", "produce", "high"))
        self.assertEqual([k for k, _ in sm.check_pantry_case(PANTRY_CASES["p002"], bad)["failures"]], ["low_confidence_missing"])

    def test_a_forbidden_item_and_a_non_empty_answer_are_flagged(self):
        bad = self.answer(("spaghetti", "spaghetti", 400, "g", "grain", "high"),
                          ("chopped tomatoes", "chopped tomatoes", 400, "g", "produce", "high"),
                          ("dish soap", "dish soap", None, None, "other", "high"))
        self.assertIn("forbidden_item", [k for k, _ in sm.check_pantry_case(PANTRY_CASES["p004"], bad)["failures"]])
        filled = self.answer(("Abend", "dinner", None, None, "other", "low"))
        self.assertEqual([k for k, _ in sm.check_pantry_case(PANTRY_CASES["p006"], filled)["failures"]], ["not_empty"])
        self.assertEqual(sm.check_pantry_case(PANTRY_CASES["p006"], {"items": [], "notes": None})["failures"], [])

    def test_a_bad_category_is_flagged_and_no_answer_fails(self):
        bad = self.answer(("Mehl", "flour", 2000, "g", "flour-ish", "high"), ("Eier", "eggs", 6, "piece", "egg", "high"),
                          ("Milch", "milk", 1000, "ml", "dairy", "high"))
        self.assertEqual([k for k, _ in sm.check_pantry_case(PANTRY_CASES["p001"], bad)["failures"]], ["bad_category"])
        self.assertEqual(sm.check_pantry_case(PANTRY_CASES["p001"], None)["failures"][0][0], "no_answer")


def ingredient(name, amount, unit, from_pantry):
    return {"name": name, "amount": amount, "unit": unit, "fromPantry": from_pantry}


def recipe(title="Chicken rice", grams=400, ingredients=None, kcal=480, protein=40, carbs=40, fat=18):
    return {"title": title, "servings": 2, "servingGrams": grams,
            "ingredients": ingredients if ingredients is not None else [
                ingredient("chicken breast", 300, "g", True), ingredient("rice", 100, "g", True),
                ingredient("cooking oil", 1, "tbsp", False), ingredient("salt", None, None, False)],
            "steps": ["cook"], "perServing": {"kcal": kcal, "proteinG": protein, "carbsG": carbs, "fiberG": 2, "fatG": fat},
            "whyItFits": "High in protein.", "prepMinutes": 20}


def kinds(result):
    return sorted({kind for kind, _ in result["violations"]})


class RecipeChecker(unittest.TestCase):
    CASE = RECIPE_CASES["r001"]  # 2 to 3 recipes, 800 kcal, 60 g net carbs; chicken 400 g, eggs 6, rice 500 g

    def test_a_fine_answer_passes(self):
        # 4 * 40 + 4 * 40 + 9 * 18 = 482
        result = sm.check_recipe_answer(self.CASE, {"recipes": [recipe(), recipe(title="Egg rice", ingredients=[
            ingredient("eggs", 4, "piece", True), ingredient("rice", 100, "g", True), ingredient("Olive oil", 1, "tbsp", False)])]})
        self.assertEqual(result["violations"], [])
        self.assertEqual((result["raw"], result["shown"]), (2, 2))

    def test_recipe_count(self):
        self.assertEqual(kinds(sm.check_recipe_answer(self.CASE, {"recipes": [recipe()]})), ["recipe_count"])
        self.assertEqual(kinds(sm.check_recipe_answer(self.CASE, {"recipes": [recipe()] * 4})), ["recipe_count"])

    def test_serving_grams_outside_the_band_is_flagged_and_not_shown(self):
        result = sm.check_recipe_answer(self.CASE, {"recipes": [recipe(), recipe(grams=1600), recipe(grams=20)]})
        self.assertEqual(kinds(result), ["serving_grams"])
        self.assertEqual(len([1 for k, _ in result["violations"] if k == "serving_grams"]), 2)
        self.assertEqual((result["raw"], result["shown"]), (3, 1))

    def test_from_pantry_true_for_an_item_not_on_the_shelf(self):
        bad = recipe(ingredients=[ingredient("chicken breast", 300, "g", True), ingredient("saffron", 1, "g", True)])
        self.assertEqual(kinds(sm.check_recipe_answer(self.CASE, {"recipes": [bad, recipe()]})), ["from_pantry_true_not_on_shelf"])

    def test_from_pantry_false_for_a_non_staple(self):
        bad = recipe(ingredients=[ingredient("chicken breast", 300, "g", True), ingredient("saffron", 1, "g", False)])
        self.assertEqual(kinds(sm.check_recipe_answer(self.CASE, {"recipes": [bad, recipe()]})), ["from_pantry_false_not_staple"])

    def test_from_pantry_false_for_a_shelf_item(self):
        bad = recipe(ingredients=[ingredient("chicken breast", 300, "g", False)])
        self.assertEqual(kinds(sm.check_recipe_answer(self.CASE, {"recipes": [bad, recipe()]})), ["from_pantry_false_on_shelf"])

    def test_more_than_the_pantry_amount(self):
        bad = recipe(ingredients=[ingredient("chicken breast", 450, "g", True)])
        self.assertEqual(kinds(sm.check_recipe_answer(self.CASE, {"recipes": [bad, recipe()]})), ["exceeds_pantry_amount"])
        edge = recipe(ingredients=[ingredient("chicken breast", 400, "g", True)])
        self.assertEqual(sm.check_recipe_answer(self.CASE, {"recipes": [edge, recipe()]})["violations"], [])

    def test_amount_and_unit_must_be_null_together(self):
        bad = recipe(ingredients=[ingredient("chicken breast", 300, "g", True), ingredient("salt", 2, None, False)])
        self.assertEqual(kinds(sm.check_recipe_answer(self.CASE, {"recipes": [bad, recipe()]})), ["amount_unit_not_null_together"])

    def test_per_serving_numbers_must_agree_with_the_macros(self):
        # 4 * 40 + 4 * 40 + 9 * 18 = 482: 579 is +20.1 percent, 578 is +19.9 percent
        self.assertEqual(kinds(sm.check_recipe_answer(self.CASE, {"recipes": [recipe(kcal=579), recipe()]})), ["per_serving_inconsistent"])
        self.assertEqual(sm.check_recipe_answer(self.CASE, {"recipes": [recipe(kcal=578), recipe()]})["violations"], [])
        self.assertEqual(kinds(sm.check_recipe_answer(self.CASE, {"recipes": [recipe(kcal=300), recipe()]})), ["per_serving_inconsistent"])

    def test_budgets(self):
        over_kcal = recipe(kcal=900, protein=60, carbs=50, fat=50)  # consistent: 4*50+4*60+9*50 = 890
        self.assertEqual(kinds(sm.check_recipe_answer(self.CASE, {"recipes": [over_kcal, recipe()]})), ["over_kcal_budget"])
        over_carbs = recipe(kcal=4 * 70 + 4 * 30 + 9 * 10, protein=30, carbs=70, fat=10)
        self.assertEqual(kinds(sm.check_recipe_answer(self.CASE, {"recipes": [over_carbs, recipe()]})), ["over_carb_budget"])
        no_carb_target = RECIPE_CASES["r010"]
        self.assertIsNone(no_carb_target["checks"]["max_net_carbs_g_per_serving"])
        result = sm.check_recipe_answer(no_carb_target, {"recipes": [over_carbs, over_carbs]})
        self.assertNotIn("over_carb_budget", kinds(result))

    def test_no_answer_is_a_violation_with_zero_recipes_shown(self):
        result = sm.check_recipe_answer(self.CASE, None)
        self.assertEqual((result["raw"], result["shown"], kinds(result)), (0, 0, ["no_answer"]))

    def test_staples_in_the_six_languages(self):
        for name in ("salt", "Pfeffer", "Olivenöl", "huile d'olive", "olio d'oliva", "aceite de oliva", "zeytinyağı", "sirke",
                     "agua", "Wasser", "eau", "tuz", "sale"):
            self.assertTrue(sm.is_staple(name), name)
        for name in ("saffron", "chicken stock", "Brühe", "caldo de pescado", "rice", "cream"):
            self.assertFalse(sm.is_staple(name), name)


class CallMechanics(unittest.TestCase):
    def record(self, content, stored_valid, **extra):
        base = {"kind": "production", "task": "pantry_text", "http_status": 200, "raw_content": content,
                "schema_valid": stored_valid, "latency_ms": 1000, "cost_usd": 0.01, "finish_reason": "stop"}
        base.update(extra)
        return base

    VALID = json.dumps({"items": [], "notes": None})

    def test_revalidation_agrees_on_valid_and_invalid_content(self):
        self.assertTrue(sm.revalidate(self.record(self.VALID, True), CONTRACT))
        self.assertFalse(sm.revalidate(self.record('{"items": []}', False), CONTRACT))
        self.assertFalse(sm.revalidate(self.record("not json", False), CONTRACT))
        self.assertFalse(sm.revalidate(self.record(None, False), CONTRACT))

    def test_a_stored_flag_that_disagrees_is_reported(self):
        stats = sm.call_stats([("ok", self.record(self.VALID, True)), ("lie", self.record('{"items": []}', True)),
                               ("miss", self.record(self.VALID, False))], CONTRACT)
        self.assertEqual(sorted(stats["revalidation_disagreements"]), ["lie", "miss"])
        self.assertEqual(stats["schema_valid_stored"], 2)

    def test_slow_calls_and_cost(self):
        stats = sm.call_stats([("a", self.record(self.VALID, True, latency_ms=59_999)),
                               ("b", self.record(self.VALID, True, latency_ms=60_001, finish_reason="length"))], CONTRACT)
        self.assertEqual([label for label, _ in stats["slow"]], ["b"])
        self.assertAlmostEqual(stats["cost_total"], 0.02)
        self.assertEqual(stats["not_stop_ids"], ["b"])

    def test_empty_and_unreadable_answers_on_food_inputs(self):
        def rec(foods, unreadable=False):
            return {"kind": "production", "answer": {"foods": foods, "unreadable": unreadable}}
        labelled = [("r1:t001", rec([{"name": "x"}])), ("r1:t002", rec([])), ("r1:t003", rec([], True)),
                    ("r1:t004", {"kind": "production", "answer": None}),
                    ("r1:t033", rec([])), ("r1:t070", rec([{"name": "invented"}]))]
        result = sm.food_answer_problems(labelled, {"t033", "t070"})
        self.assertEqual(result["empty"], ["r1:t002", "r1:t003"])
        self.assertEqual(result["unreadable"], ["r1:t003"])
        self.assertEqual(result["no_answer"], ["r1:t004"])
        self.assertEqual((result["empty_kept_empty"], result["empty_expected_total"]), (1, 2))
        self.assertEqual(result["empty_expected_wrongly_filled"], ["r1:t070"])


class RealRuns(unittest.TestCase):
    """The scorer against the committed gold files: the gold itself must be consistent with the scorer."""

    def test_overlap_rows_and_cases_exist(self):
        text_ids = {row["id"] for row in sm.load_jsonl(sm.GOLD / "gold_text.jsonl")}
        self.assertTrue(set(sm.KCAL_OVERLAP) <= text_ids)
        self.assertTrue({row for mapped in sm.KCAL_OVERLAP.values() for row, _ in mapped} <= set(KCAL_ROWS))

    def test_a_gold_pantry_answer_built_from_the_gold_passes(self):
        for case in PANTRY_CASES.values():
            items = [{"name": e["name"], "amount": e["amount"], "unit": e["unit"], "category": "other",
                      "confidence": e.get("expect_confidence", "high"), "translations": {"en": e["name"]}}
                     for e in case["expect_items"]]
            self.assertEqual(sm.check_pantry_case(case, {"items": items, "notes": None})["failures"], [], case["id"])


class KcalGoldRuns(unittest.TestCase):
    """The kcal gold mode: each kcal row was sent as its own case, so the answer's item is scored directly."""

    def test_a_planted_wrong_kcal_row_is_flagged_and_a_fine_one_passes(self):
        row = KCAL_ROWS["k004"]  # cooked white rice: 130 kcal, 28.17 g carbs
        wrong = sm.kcal_gold_comparison("x:k004", row, {"foods": [food("cooked white rice", kcal=180, carbs=40)]})
        fine = sm.kcal_gold_comparison("x:k004", row, {"foods": [food("cooked white rice", kcal=128, carbs=28)]})
        self.assertEqual((wrong["kcal_ok"], wrong["carbs_ok"]), (False, False))
        self.assertEqual((fine["kcal_ok"], fine["carbs_ok"]), (True, True))
        self.assertAlmostEqual(wrong["kcal_err_pct"], (180 - 130) / 130 * 100)

    def test_several_items_pick_the_one_that_names_the_row(self):
        row = KCAL_ROWS["k001"]  # banana, 89 kcal
        answer = {"foods": [food("Apfel", kcal=52, en="apple"), food("Banane", kcal=89, en="banana")]}
        self.assertEqual(sm.kcal_gold_comparison("x:k001", row, answer)["item"], "Banane")
        # control: no item names the row, so it is unmatched and counts as outside tolerance
        none = sm.kcal_gold_comparison("x:k001", row, {"foods": [food("Apfel", kcal=89, en="apple"), food("Birne", en="pear")]})
        self.assertEqual((none["matched"], none["kcal_ok"]), (False, False))

    def test_gather_reads_a_run_and_leaves_out_an_incomplete_one(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            runs = Path(tmp)
            full = {rid: {"plate_text": {"answer": {"foods": [food(r["item"], kcal=r["reference"]["kcal_per_100g"],
                                                                    carbs=r["reference"]["carbs_per_100g"])]},
                                         "schema_valid": True}} for rid, r in KCAL_ROWS.items()}
            full["k005"]["plate_text"]["answer"]["foods"][0]["macrosPer100g"]["kcal"] = 999  # planted wrong value
            (runs / "full").mkdir()
            (runs / "full" / "results.json").write_text(json.dumps(full), encoding="utf-8")
            (runs / "half").mkdir()
            (runs / "half" / "results.json").write_text(json.dumps({"k001": full["k001"]}), encoding="utf-8")
            data = sm.gather_kcal_gold({"X": ["full"], "Y": ["half"]}, {}, runs)
        x = data["cells"]["X"]["kcal"]
        self.assertEqual((x["compared"], x["within"]), (len(KCAL_ROWS), len(KCAL_ROWS) - 1))
        self.assertEqual(x["worst"][0]["row"], "k005")
        self.assertEqual(data["cells"]["Y"]["runs"], [])
        self.assertTrue(any("half" in n for n in data["notes"]))

    def test_labelled_arguments(self):
        self.assertEqual(sm.parse_labelled(["B=a,b", "D=c"]), {"B": ["a", "b"], "D": ["c"]})
        with self.assertRaises(SystemExit):
            sm.parse_labelled(["no-label"])


class ErrorRecords(unittest.TestCase):
    """A call that raised is stored as {"error": ...} with no `kind`. It must count as a failed call, never vanish."""

    VALID = json.dumps({"items": [], "notes": None})

    def ok(self, **extra):
        base = {"kind": "production", "task": "pantry_text", "http_status": 200, "raw_content": self.VALID,
                "schema_valid": True, "latency_ms": 1000, "cost_usd": 0.01, "finish_reason": "stop"}
        return {**base, **extra}

    def test_an_error_record_is_an_invalid_call_with_its_id(self):
        stats = sm.call_stats([("r1:t001", self.ok()), ("r1:t002", {"error": "the call raised"})], CONTRACT)
        self.assertEqual(stats["schema_invalid_ids"], ["r1:t002"])
        self.assertEqual(stats["error_ids"], ["r1:t002"])
        self.assertEqual(stats["http_status"], {"200": 1, "None": 1})
        self.assertEqual(stats["schema_valid_stored"], 1)
        # control: with no error record nothing is listed
        clean = sm.call_stats([("r1:t001", self.ok()), ("r1:t002", self.ok())], CONTRACT)
        self.assertEqual((clean["schema_invalid_ids"], clean["error_ids"]), ([], []))

    def test_an_error_record_is_no_answer_not_an_empty_food_list(self):
        problems = sm.food_answer_problems([("r1:t001", {"error": "boom"}), ("r1:t002", {"kind": "production", "answer": {"foods": []}})])
        self.assertEqual(problems["no_answer"], ["r1:t001"])
        self.assertEqual(problems["empty"], ["r1:t002"])

    def test_the_old_schema_cells_count_an_error_record_apart_from_raw_ok(self):
        stats = sm.call_stats([("01", {"foods": [{}], "raw_ok": True, "cost_usd": 0.1, "latency_ms": 10}), ("02", {"error": "x"})], CONTRACT)
        self.assertEqual((stats["old_schema_raw_ok"], stats["error_ids"]), (1, ["02"]))

    def write_typed(self, root: Path, name: str, ids: list[str], error_ids: tuple[str, ...] = ()) -> None:
        results = {}
        for cid in ids:
            if cid in error_ids:
                results[cid] = {"plate_text": {"error": "the call raised"}}
            else:
                results[cid] = {"plate_text": {"kind": "production", "task": "plate_text", "http_status": 200, "schema_valid": True,
                                               "answer": {"foods": [food("x")], "unreadable": False}, "cost_usd": 0.001,
                                               "latency_ms": 100, "finish_reason": "stop", "raw_content": "{}"}}
        (root / name).mkdir()
        (root / name / "results.json").write_text(json.dumps({**results, "_summary": {}}), encoding="utf-8")

    def test_typed_runs_keeps_a_repeat_that_holds_an_error_record(self):
        ids = sorted(TEXT_IDS)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_typed(root, "text-X-r1", ids, error_ids=("t005",))
            self.write_typed(root, "text-X-r2", ids)
            self.write_typed(root, "text-X-r3", ids)
            runs, notes = sm.typed_runs("X", set(ids), root)
        self.assertEqual(sorted(runs), ["r1", "r2", "r3"])
        self.assertTrue(any("r1" in n and "t005" in n and "failed" in n for n in notes), notes)

    def test_typed_runs_leaves_a_repeat_out_only_when_case_ids_are_missing(self):
        ids = sorted(TEXT_IDS)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_typed(root, "text-X-r1", ids[:-1])
            self.write_typed(root, "text-X-r2", ids, error_ids=tuple(ids[:3]))
            runs, notes = sm.typed_runs("X", set(ids), root)
        self.assertEqual(sorted(runs), ["r2"])
        self.assertTrue(any(n.startswith("r1:") and ids[-1] in n for n in notes), notes)
        self.assertTrue(any(n.startswith("r3:") and "no results.json" in n for n in notes), notes)

    def test_fewer_than_three_repeats_is_incomplete_in_the_report_and_the_exit_code(self):
        ids = sorted(TEXT_IDS)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for suffix in ("eu-cell-38-newprompt", "eu-cell-38-minimal-newprompt", "eu-cell-35-eu-newprompt"):
                for repeat in (1, 2):
                    self.write_typed(root, f"text-{suffix}-r{repeat}", ids)
            code = self.run_main(root)
            report = (root / f"{sm.REPORT_NAME}.md").read_text(encoding="utf-8")
            self.assertEqual(code, 2)
            self.assertIn("Verdict: INCOMPLETE", report)
            self.assertIn("2 of 3 typed repeats", report)
            # control: three repeats in every cell is complete, exit 0
            for suffix in ("eu-cell-38-newprompt", "eu-cell-38-minimal-newprompt", "eu-cell-35-eu-newprompt"):
                self.write_typed(root, f"text-{suffix}-r3", ids)
            self.assertEqual(self.run_main(root), 0)
            report = (root / f"{sm.REPORT_NAME}.md").read_text(encoding="utf-8")
            self.assertNotIn("INCOMPLETE", report)
            self.assertIn("complete, 3 of 3", report)

    def run_main(self, root: Path) -> int:
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            return sm.main(["--out-dir", str(root), "--runs-dir", str(root)])


class CostAndLatencyColumns(unittest.TestCase):
    def rec(self, **extra):
        base = {"kind": "production", "task": "pantry_text", "http_status": 200, "raw_content": json.dumps({"items": [], "notes": None}),
                "schema_valid": True, "latency_ms": 1000, "cost_usd": 0.01, "finish_reason": "stop"}
        return {**base, **extra}

    def test_a_production_record_with_no_cost_is_flagged_and_does_not_lower_the_mean(self):
        stats = sm.call_stats([("a", self.rec(cost_usd=0.02, cost_source="usage")), ("b", self.rec(cost_usd=None, cost_source=None)),
                               ("c", self.rec(cost_usd=0.04, cost_source="price_table"))], CONTRACT)
        self.assertEqual(stats["n"], 3)
        self.assertEqual(stats["cost_calls"], 2)
        self.assertAlmostEqual(stats["cost_mean"], 0.03)
        self.assertEqual(stats["cost_null_ids"], ["b"])
        self.assertEqual(stats["cost_sources"], {"usage": 1, "price_table": 1})
        # control: all costed, nothing flagged
        clean = sm.call_stats([("a", self.rec()), ("b", self.rec())], CONTRACT)
        self.assertEqual((clean["cost_calls"], clean["cost_null_ids"]), (2, []))

    def test_the_wait_is_the_total_latency_and_the_last_attempt_stays_a_second_column(self):
        stats = sm.call_stats([("a", self.rec(latency_ms=1000, total_latency_ms=9000, attempts=3)),
                               ("b", self.rec(latency_ms=2000, total_latency_ms=2000))], CONTRACT)
        self.assertEqual(stats["latency_median"], 5.5)
        self.assertEqual(stats["last_attempt_latency_median"], 1.5)
        self.assertEqual(stats["latency_max"], 9.0)
        # control: a record from before the field existed has only the last attempt, and both columns agree
        old = sm.call_stats([("a", self.rec(latency_ms=4000))], CONTRACT)
        self.assertEqual((old["latency_median"], old["last_attempt_latency_median"]), (4.0, 4.0))

    def test_a_call_slow_only_because_of_retries_is_listed_as_slow(self):
        stats = sm.call_stats([("a", self.rec(latency_ms=1000, total_latency_ms=61_000))], CONTRACT)
        self.assertEqual(stats["slow"], [("a", 61.0)])
        self.assertEqual(sm.call_stats([("a", self.rec(latency_ms=1000, total_latency_ms=2000))], CONTRACT)["slow"], [])


class SplitItemsInKcalMode(unittest.TestCase):
    def split_answer(self, a_kcal, a_grams, b_kcal, b_grams):
        a, b = food("cooked white rice", kcal=a_kcal, carbs=30, en="cooked white rice"), food("white rice", kcal=b_kcal, carbs=30, en="white rice")
        a["estimatedGrams"], b["estimatedGrams"] = a_grams, b_grams
        return {"foods": [a, b, food("Apfel", kcal=52, en="apple")]}

    def test_two_items_for_one_food_are_combined_by_grams_not_the_first_taken(self):
        row = KCAL_ROWS["k004"]  # 130 kcal per 100 g
        result = sm.kcal_gold_comparison("x:k004", row, self.split_answer(100, 300, 220, 100))
        self.assertTrue(result["split"])
        self.assertEqual(result["n_matched_items"], 2)
        self.assertAlmostEqual(result["kcal"], (100 * 300 + 220 * 100) / 400)  # 130
        self.assertTrue(result["kcal_ok"])
        self.assertEqual(result["combine_weighting"], "grams")
        self.assertEqual(result["item"], "cooked white rice + white rice")
        # the first item alone is 100 kcal (23 percent off): taking it would have failed the row
        self.assertFalse(sm.kcal_gold_comparison("x:k004", row, {"foods": [food("cooked white rice", kcal=100, carbs=30)]})["kcal_ok"])

    def test_without_grams_the_plain_mean_stands_in(self):
        row = KCAL_ROWS["k004"]
        answer = self.split_answer(100, None, 160, None)
        result = sm.kcal_gold_comparison("x:k004", row, answer)
        self.assertEqual((result["kcal"], result["combine_weighting"]), (130, "mean"))

    def test_a_null_in_one_part_makes_the_nutrient_unknown_not_a_smaller_sum(self):
        result = sm.kcal_gold_comparison("x:k004", KCAL_ROWS["k004"], self.split_answer(130, 100, None, 100))
        self.assertIsNone(result["kcal"])
        self.assertFalse(result["kcal_ok"])
        self.assertEqual(result["carbs"], 30)

    def test_the_summary_counts_split_cases_and_the_sample_size(self):
        rows = [
            sm.kcal_gold_comparison("x:k004", KCAL_ROWS["k004"], self.split_answer(130, 100, 130, 100)),
            sm.kcal_gold_comparison("x:k001", KCAL_ROWS["k001"], {"foods": [food("Banane", kcal=89, carbs=23)]}),
            sm.kcal_gold_comparison("x:k002", KCAL_ROWS["k002"], {"foods": []}),
        ]
        summary = sm.summarise_kcal(rows, "kcal")
        self.assertEqual((summary["n"], summary["split"], summary["matched"]), (3, 1, 2))
        # control: no split anywhere
        self.assertEqual(sm.summarise_kcal(rows[1:], "kcal")["split"], 0)

    def test_the_overlap_proxy_combines_split_items_too(self):
        answer = {"foods": [food("Ei", kcal=100, carbs=1, en="egg"), food("Eigelb", kcal=200, carbs=1, en="egg yolk")]}
        for f, grams in zip(answer["foods"], (50, 50)):
            f["estimatedGrams"] = grams
        row = sm.kcal_comparisons("r1:t013", "t013", answer, KCAL_ROWS)[0]
        self.assertTrue(row["split"])
        self.assertEqual(row["kcal"], 150)

    def test_a_kcal_gold_run_with_a_split_row_still_scores_and_renders_through_the_cli(self):
        import contextlib
        import io
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            full = {rid: {"plate_text": {"answer": {"foods": [food(r["item"], kcal=r["reference"]["kcal_per_100g"],
                                                                    carbs=r["reference"]["carbs_per_100g"])]},
                                         "schema_valid": True, "finish_reason": "stop"}} for rid, r in KCAL_ROWS.items()}
            row = KCAL_ROWS["k004"]
            half = {**food("cooked white rice", kcal=130, carbs=28), "estimatedGrams": 100}
            half2 = {**food("white rice", kcal=130, carbs=28), "estimatedGrams": 100}
            full["k004"]["plate_text"]["answer"]["foods"] = [half, half2]
            (root / "run").mkdir()
            (root / "run" / "results.json").write_text(json.dumps(full), encoding="utf-8")
            stem = root / "KCAL"
            with contextlib.redirect_stdout(io.StringIO()):
                code = sm.main(["--kcal-run", "X=run", "--runs-dir", str(root), "--out", str(stem)])
            report = Path(f"{stem}.md").read_text(encoding="utf-8")
            data = json.loads(Path(f"{stem}.json").read_text(encoding="utf-8"))
        self.assertEqual(code, 0)
        self.assertEqual(data["cells"]["X"]["kcal"]["split"], 1)
        self.assertEqual(data["cells"]["X"]["kcal"]["n"], len(KCAL_ROWS))
        self.assertEqual(data["cells"]["X"]["kcal"]["within"], len(KCAL_ROWS))
        self.assertIn("split", report)
        self.assertIn(", split)", report)
        self.assertEqual(row["id"], "k004")


if __name__ == "__main__":
    unittest.main()
