"""The strict validator: one valid answer per task, and answers that must fail."""

from __future__ import annotations

import unittest

from harness import schema_validate
from harness.schema_validate import UnsupportedSchemaKeyword, assert_strict_mode_schema, validate

from .support import deep, real_contract, valid_pantry_answer, valid_plate_answer, valid_recipe_answer

CONTRACT = real_contract()
PLATE = CONTRACT.schema("plate_photo")


class ValidAnswers(unittest.TestCase):
    def test_a_valid_plate_answer_passes(self):
        self.assertEqual(validate(valid_plate_answer(), PLATE), [])

    def test_a_valid_pantry_answer_passes(self):
        self.assertEqual(validate(valid_pantry_answer(), CONTRACT.schema("pantry_photo")), [])
        self.assertEqual(validate(valid_pantry_answer(), CONTRACT.schema("pantry_text")), [])

    def test_a_valid_recipe_answer_passes(self):
        self.assertEqual(validate(valid_recipe_answer(), CONTRACT.schema("recipe")), [])

    def test_an_empty_foods_list_with_unreadable_true_passes(self):
        answer = {"foods": [], "unreadable": True, "unreadableReason": "too dark", "notes": None}
        self.assertEqual(validate(answer, PLATE), [])


class AnswersThatMustFail(unittest.TestCase):
    def assert_fails_with(self, answer: dict, fragment: str) -> None:
        errors = validate(answer, PLATE)
        self.assertTrue(errors, "the validator accepted an answer it must reject")
        self.assertTrue(any(fragment in error for error in errors), f"{fragment!r} not in {errors}")

    def test_a_missing_top_level_field(self):
        answer = valid_plate_answer()
        del answer["notes"]
        self.assert_fails_with(answer, "missing required property 'notes'")

    def test_a_missing_nested_field(self):
        answer = valid_plate_answer()
        del answer["foods"][0]["flags"]["mayContain"]
        self.assert_fails_with(answer, "$.foods[0].flags: missing required property 'mayContain'")

    def test_a_wrong_enum_value(self):
        answer = valid_plate_answer()
        answer["foods"][0]["confidence"] = "certain"
        self.assert_fails_with(answer, "$.foods[0].confidence")

    def test_an_extra_field(self):
        answer = valid_plate_answer()
        answer["foods"][0]["calories"] = 5
        self.assert_fails_with(answer, "unexpected property 'calories'")

    def test_an_extra_field_at_the_top(self):
        answer = valid_plate_answer()
        answer["extra"] = True
        self.assert_fails_with(answer, "unexpected property 'extra'")

    def test_a_wrong_type(self):
        answer = valid_plate_answer()
        answer["foods"][0]["estimatedGrams"] = "120"
        self.assert_fails_with(answer, "$.foods[0].estimatedGrams: expected number, got string")

    def test_a_boolean_is_not_a_number(self):
        answer = valid_plate_answer()
        answer["foods"][0]["estimatedGrams"] = True
        self.assert_fails_with(answer, "expected number, got boolean")

    def test_null_where_a_value_is_required(self):
        answer = valid_plate_answer()
        answer["foods"][0]["name"] = None
        self.assert_fails_with(answer, "$.foods[0].name")

    def test_null_is_fine_where_the_schema_allows_it(self):
        answer = valid_plate_answer()
        answer["foods"][0]["brand"] = None
        self.assertEqual(validate(answer, PLATE), [])

    def test_a_value_outside_every_anyof_branch(self):
        answer = valid_plate_answer()
        answer["foods"][0]["portionHint"] = 3
        self.assert_fails_with(answer, "anyOf")

    def test_a_not_a_number_value(self):
        answer = valid_plate_answer()
        answer["foods"][0]["estimatedGrams"] = float("nan")
        self.assert_fails_with(answer, "$.foods[0].estimatedGrams")

    def test_a_wrong_enum_inside_a_list(self):
        answer = valid_plate_answer()
        answer["foods"][0]["flags"]["allergens"] = ["gluten", "pollen"]
        self.assert_fails_with(answer, "pollen")

    def test_the_wrong_task_schema_rejects_the_answer(self):
        self.assertTrue(validate(valid_pantry_answer(), PLATE))
        self.assertTrue(validate(valid_plate_answer(), CONTRACT.schema("recipe")))

    def test_a_missing_recipe_field(self):
        answer = valid_recipe_answer()
        del answer["recipes"][0]["prepMinutes"]
        self.assertTrue(validate(answer, CONTRACT.schema("recipe")))

    def test_control_the_valid_answer_is_not_mutated_by_validation(self):
        answer = valid_plate_answer()
        before = deep(answer)
        validate(answer, PLATE)
        self.assertEqual(answer, before)


class TheValidatorItself(unittest.TestCase):
    def test_an_unknown_keyword_raises_instead_of_being_skipped(self):
        with self.assertRaises(UnsupportedSchemaKeyword):
            validate({"a": 1}, {"type": "object", "dependentRequired": {"a": ["b"]}})

    def test_annotations_are_ignored(self):
        self.assertEqual(validate("x", {"type": "string", "description": "a name", "default": "y"}), [])

    def test_enum_does_not_let_true_equal_one(self):
        self.assertTrue(validate(True, {"enum": [1, 2]}))
        self.assertEqual(validate(1, {"enum": [1, 2]}), [])

    def test_type_list_means_either(self):
        self.assertEqual(validate(None, {"type": ["string", "null"]}), [])
        self.assertTrue(validate(3, {"type": ["string", "null"]}))

    def test_every_contract_schema_follows_strict_mode_rules(self):
        for task_key in CONTRACT.data["tasks"]:
            assert_strict_mode_schema(CONTRACT.schema(task_key))

    def test_control_a_schema_that_breaks_strict_mode_is_caught(self):
        loose = deep(PLATE)
        loose["required"] = loose["required"][:-1]
        with self.assertRaises(ValueError):
            assert_strict_mode_schema(loose)
        open_object = deep(PLATE)
        open_object["additionalProperties"] = True
        with self.assertRaises(ValueError):
            assert_strict_mode_schema(open_object)

    def test_is_valid_agrees_with_validate(self):
        self.assertTrue(schema_validate.is_valid(valid_plate_answer(), PLATE))
        self.assertFalse(schema_validate.is_valid({}, PLATE))


if __name__ == "__main__":
    unittest.main()
