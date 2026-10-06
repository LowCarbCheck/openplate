"""The misc scorer: every check has a planted wrong value that must be flagged and a planted fine value that must pass."""

from __future__ import annotations

import json
import unittest

from harness import score_misc as sm

CONTRACT = json.loads(sm.CONTRACT.read_text(encoding="utf-8"))

KCAL_ROWS = {row["id"]: row for row in sm.load_jsonl(sm.GOLD / "gold_kcal_text.jsonl")}
RECIPE_CASES = {row["id"]: row for row in sm.load_jsonl(sm.GOLD / "gold_recipes.jsonl")}
PANTRY_CASES = {row["id"]: row for row in sm.load_jsonl(sm.GOLD / "gold_pantry.jsonl")}


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


if __name__ == "__main__":
    unittest.main()
