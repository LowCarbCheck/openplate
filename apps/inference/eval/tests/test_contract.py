"""The contract reader: messages, the recipe text, upload constraints, and staleness."""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from harness.contract import Contract, ContractError, assert_fresh, git_blob_sha1, load_contract
from harness.production import js_round, scaled_dimensions

from .support import EVAL_ROOT, real_contract

CONTRACT = real_contract()


class Messages(unittest.TestCase):
    def test_a_photo_task_lays_out_system_then_instruction_and_image(self):
        messages = CONTRACT.build_messages("plate_photo", "en", image_base64="AAAA")
        entry = CONTRACT.entry("plate_photo", "en")
        self.assertEqual(messages[0], {"role": "system", "content": entry["systemPrompt"]})
        self.assertEqual(messages[1]["content"][0], {"type": "text", "text": entry["userPrompt"]})
        self.assertEqual(
            messages[1]["content"][1], {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,AAAA"}}
        )

    def test_a_text_task_carries_the_persons_words_as_a_second_part(self):
        messages = CONTRACT.build_messages("plate_text", "de", input_text="zwei Eier")
        self.assertEqual(messages[1]["content"][1], {"type": "text", "text": "zwei Eier"})
        self.assertEqual(messages[0]["content"], CONTRACT.entry("plate_text", "de")["systemPrompt"])

    def test_a_marker_inside_the_input_is_not_substituted_again(self):
        text = "eggs @@SYSTEM_PROMPT@@"
        messages = CONTRACT.build_messages("plate_text", "en", input_text=text)
        self.assertEqual(messages[1]["content"][1]["text"], text)

    def test_a_photo_task_without_a_photo_stops(self):
        with self.assertRaises(ContractError):
            CONTRACT.build_messages("plate_photo", "en")

    def test_an_unknown_language_stops_and_names_the_languages(self):
        with self.assertRaises(ContractError) as caught:
            CONTRACT.build_messages("plate_text", "xx", input_text="a")
        self.assertIn("'de'", str(caught.exception))

    def test_every_language_of_every_task_builds(self):
        for task_key, task in CONTRACT.data["tasks"].items():
            for language in CONTRACT.languages:
                if task["inputKind"] == "photo":
                    messages = CONTRACT.build_messages(task_key, language, image_base64="QQ==")
                else:
                    messages = CONTRACT.build_messages(task_key, language, input_text="x")
                self.assertEqual(len(messages), 2, f"{task_key}/{language}")
                self.assertNotIn("@@", json.dumps(messages), f"{task_key}/{language} left a marker")


class RecipeText(unittest.TestCase):
    def test_the_fixed_example_rebuilds_the_exact_text_the_app_produced(self):
        expected = CONTRACT.entry("recipe", "en")["userText"]
        start = expected.index("Rest of the day")
        end = expected.index("\n\nMeal slot to cook for")
        case = {
            "lang": "en",
            "slot": "dinner",
            "remaining_day_block": expected[start:end],
            "pantry": [
                {"name": "eggs", "amount": 6, "unit": "piece"},
                {"name": "spinach", "amount": None, "unit": None},
                {"name": "rolled oats", "amount": 500, "unit": "g"},
            ],
        }
        self.assertEqual(CONTRACT.recipe_user_text("en", case), expected)

    def test_control_a_different_slot_changes_the_text(self):
        base = {"slot": "dinner", "remaining_day_block": "R", "pantry": []}
        other = {**base, "slot": "lunch"}
        self.assertNotEqual(CONTRACT.recipe_user_text("en", base), CONTRACT.recipe_user_text("en", other))

    def test_a_case_without_a_slot_stops(self):
        with self.assertRaises(ContractError):
            CONTRACT.recipe_user_text("en", {"remaining_day_block": "", "pantry": []})

    def test_a_float_amount_that_is_whole_prints_like_javascript(self):
        case = {"slot": "dinner", "remaining_day_block": "R", "pantry": [{"name": "oats", "amount": 500.0, "unit": "g"}]}
        self.assertIn("- oats, 500 g", CONTRACT.recipe_user_text("en", case))


class UploadConstraints(unittest.TestCase):
    def test_the_values_are_the_apps(self):
        self.assertEqual(CONTRACT.photo_constraints["maxLongSidePx"], 1600)
        self.assertEqual(CONTRACT.photo_constraints["jpegQuality"], 0.85)

    def test_the_python_resize_matches_every_example_the_app_computed(self):
        examples = CONTRACT.photo_constraints["scaledDimensionExamples"]
        self.assertGreaterEqual(len(examples), 5)
        for example in examples:
            got = scaled_dimensions(example["width"], example["height"], CONTRACT.photo_constraints["maxLongSidePx"])
            self.assertEqual(got, (example["scaledWidth"], example["scaledHeight"]), example)

    def test_control_the_parity_check_can_fail(self):
        # A resize that floors instead of rounding must disagree with the app on at least one example.
        def flooring(width: int, height: int, longest_max: int) -> tuple[int, int]:
            longest = max(width, height)
            if longest <= longest_max:
                return width, height
            scale = longest_max / longest
            return int(width * scale), int(height * scale)

        examples = CONTRACT.photo_constraints["scaledDimensionExamples"]
        mismatches = [
            e
            for e in examples
            if flooring(e["width"], e["height"], 1600) != (e["scaledWidth"], e["scaledHeight"])
        ]
        self.assertTrue(mismatches, "the examples cannot tell a flooring resize from the app's rounding")

    def test_js_round_sends_halves_up_where_python_round_does_not(self):
        self.assertEqual(js_round(2.5), 3)
        self.assertEqual(round(2.5), 2)


class Staleness(unittest.TestCase):
    def make_checkout(self, source_text: str) -> tuple[Path, Path, Contract]:
        root = Path(tempfile.mkdtemp(prefix="contract-fresh-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        source = root / "apps/app/app/services/vision/prompt.ts"
        source.parent.mkdir(parents=True)
        source.write_text(source_text, encoding="utf-8")
        eval_root = root / "apps/inference/eval"
        eval_root.mkdir(parents=True)
        data = json.loads(json.dumps(CONTRACT.data))
        data["generatedFrom"] = {
            "hashAlgorithm": "git-blob-sha1",
            "files": {"apps/app/app/services/vision/prompt.ts": git_blob_sha1(source_text.encode("utf-8"))},
        }
        return root, eval_root, Contract(data=data, path=eval_root / "contract.json")

    def test_a_contract_that_matches_its_sources_is_fresh(self):
        _root, eval_root, contract = self.make_checkout("export const a = 1;\n")
        assert_fresh(contract, eval_root)
        self.assertEqual(contract.freshness["stale"], [])
        self.assertTrue(contract.freshness["checked"])

    def test_control_a_changed_source_makes_the_run_stop(self):
        root, eval_root, contract = self.make_checkout("export const a = 1;\n")
        (root / "apps/app/app/services/vision/prompt.ts").write_text("export const a = 2;\n", encoding="utf-8")
        with self.assertRaises(ContractError) as caught:
            assert_fresh(contract, eval_root)
        self.assertIn("STALE", str(caught.exception))
        self.assertIn("prompt.ts", str(caught.exception))
        self.assertIn("pnpm vision:export-contract", str(caught.exception))

    def test_allow_stale_runs_and_records_it(self):
        root, eval_root, contract = self.make_checkout("export const a = 1;\n")
        (root / "apps/app/app/services/vision/prompt.ts").write_text("changed\n", encoding="utf-8")
        assert_fresh(contract, eval_root, allow_stale=True)
        self.assertTrue(contract.freshness["allowed_stale"])
        self.assertEqual(contract.freshness["stale"], ["apps/app/app/services/vision/prompt.ts"])

    def test_a_missing_source_counts_as_stale(self):
        root, eval_root, contract = self.make_checkout("x\n")
        contract.data["generatedFrom"]["files"]["apps/app/app/services/vision/gone.ts"] = "0" * 40
        with self.assertRaises(ContractError):
            assert_fresh(contract, eval_root)

    def test_the_committed_contract_matches_the_sources_in_this_checkout(self):
        fresh = assert_fresh(real_contract(), EVAL_ROOT)
        self.assertTrue(fresh.freshness["checked"], "this checkout holds the app sources, so the check must run")
        self.assertEqual(fresh.freshness["stale"], [])

    def test_a_missing_contract_file_says_how_to_make_it(self):
        with self.assertRaises(ContractError) as caught:
            load_contract(EVAL_ROOT / "generated" / "nope.json")
        self.assertIn("vision:export-contract", str(caught.exception))

    def test_git_blob_ids_match_git(self):
        self.assertEqual(git_blob_sha1(b""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391")
        self.assertEqual(git_blob_sha1(b"hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a")


if __name__ == "__main__":
    unittest.main()
