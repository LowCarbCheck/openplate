"""The production request and the per-call record, with a fake HTTP client (no network, no key)."""

from __future__ import annotations

import base64
import copy
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from harness import approaches, production

from .support import (
    EVAL_ROOT,
    FakeClient,
    real_contract,
    tiny_jpeg_bytes,
    valid_pantry_answer,
    valid_plate_answer,
    valid_recipe_answer,
)

CONTRACT = real_contract()

MODEL_38 = {
    "id": "google/gemini-3.8-flash",
    "provider": "p",
    "extra_body": {"provider": {"zdr": True, "data_collection": "deny", "only": ["google-vertex"], "allow_fallbacks": False}},
}
MODEL_35 = {
    "id": "google/gemini-3.5-flash-lite",
    "provider": "p",
    "reasoning": {"effort": "minimal"},
    "extra_body": {"provider": {"zdr": True, "data_collection": "deny", "only": ["google-vertex/eu"], "allow_fallbacks": False}},
}
DATA_URL = "data:image/jpeg;base64," + base64.b64encode(tiny_jpeg_bytes()).decode("ascii")


def body_for(model_cfg: dict = MODEL_38, task: str = "plate_photo", language: str = "en", **kwargs) -> dict:
    return production.build_request_body(CONTRACT, model_cfg, task, language, **kwargs)


class RequestShape(unittest.TestCase):
    def test_a_photo_body_has_every_production_field(self):
        body = body_for(image_data_url=DATA_URL)
        self.assertEqual(body["model"], "google/gemini-3.8-flash")
        self.assertEqual(body["response_format"]["type"], "json_schema")
        self.assertIs(body["response_format"]["json_schema"]["strict"], True)
        self.assertEqual(body["response_format"]["json_schema"]["name"], "plate_identification")
        self.assertEqual(body["usage"], {"include": True})
        self.assertEqual(body["max_tokens"], 8192)
        self.assertEqual(body["provider"]["only"], ["google-vertex"])
        self.assertEqual(body["messages"][1]["content"][1]["image_url"]["url"], DATA_URL)
        self.assertNotIn("temperature", body)

    def test_no_reasoning_field_unless_the_config_sets_one(self):
        self.assertNotIn("reasoning", body_for(MODEL_38, image_data_url=DATA_URL))
        self.assertEqual(body_for(MODEL_35, image_data_url=DATA_URL)["reasoning"], {"effort": "minimal"})

    def test_the_body_matches_the_contract_for_both_models(self):
        for model in (MODEL_38, MODEL_35):
            body = body_for(model, image_data_url=DATA_URL)
            self.assertEqual(production.check_request_body(body, CONTRACT, model, "plate_photo", "en"), [])

    def test_text_pantry_and_recipe_bodies_match_the_contract(self):
        text = body_for(task="plate_text", language="de", input_text="zwei Eier")
        self.assertEqual(production.check_request_body(text, CONTRACT, MODEL_38, "plate_text", "de"), [])
        pantry = body_for(task="pantry_text", language="fr", input_text="6 oeufs")
        self.assertEqual(production.check_request_body(pantry, CONTRACT, MODEL_38, "pantry_text", "fr"), [])
        recipe_text = CONTRACT.recipe_user_text("it", {"slot": "lunch", "remaining_day_block": "R", "pantry": []})
        recipe = body_for(task="recipe", language="it", input_text=recipe_text)
        self.assertEqual(production.check_request_body(recipe, CONTRACT, MODEL_38, "recipe", "it"), [])

    def test_an_extra_body_may_not_replace_a_field_the_contract_owns(self):
        for key in ("response_format", "messages", "reasoning", "max_tokens", "usage"):
            model = {**MODEL_38, "extra_body": {key: "x"}}
            with self.assertRaises(SystemExit, msg=key):
                body_for(model, image_data_url=DATA_URL)

    def test_a_photo_task_needs_a_jpeg_data_url(self):
        with self.assertRaises(SystemExit):
            body_for(image_data_url="data:image/png;base64,AAAA")
        with self.assertRaises(SystemExit):
            body_for()


class BodyCheckControls(unittest.TestCase):
    """The check must be able to fail: each plant below must be reported."""

    def check(self, body: dict, model: dict = MODEL_38, task: str = "plate_photo", language: str = "en") -> list[str]:
        return production.check_request_body(body, CONTRACT, model, task, language)

    def fresh(self) -> dict:
        return body_for(image_data_url=DATA_URL)

    def test_a_changed_system_prompt(self):
        body = self.fresh()
        body["messages"][0]["content"] += " extra"
        self.assertTrue(any("system prompt" in p for p in self.check(body)))

    def test_a_changed_user_prompt(self):
        body = self.fresh()
        body["messages"][1]["content"][0]["text"] = "Describe the photo."
        self.assertTrue(any("user prompt" in p for p in self.check(body)))

    def test_a_loosened_schema(self):
        body = self.fresh()
        body["response_format"]["json_schema"]["strict"] = False
        self.assertTrue(any("response_format" in p for p in self.check(body)))

    def test_a_dropped_schema_property(self):
        body = self.fresh()
        del body["response_format"]["json_schema"]["schema"]["properties"]["notes"]
        self.assertTrue(any("response_format" in p for p in self.check(body)))

    def test_a_wrong_schema_name(self):
        body = self.fresh()
        body["response_format"]["json_schema"]["name"] = "plate"
        self.assertTrue(self.check(body))

    def test_a_stray_reasoning_field(self):
        body = self.fresh()
        body["reasoning"] = {"effort": "high"}
        self.assertTrue(any("reasoning" in p for p in self.check(body)))

    def test_a_missing_reasoning_field_when_the_config_sets_one(self):
        body = body_for(MODEL_35, image_data_url=DATA_URL)
        del body["reasoning"]
        self.assertTrue(any("reasoning" in p for p in self.check(body, MODEL_35)))

    def test_a_missing_usage_block_and_a_wrong_token_cap(self):
        body = self.fresh()
        del body["usage"]
        body["max_tokens"] = 4096
        problems = self.check(body)
        self.assertTrue(any("usage" in p for p in problems))
        self.assertTrue(any("max_tokens" in p for p in problems))

    def test_a_changed_routing_block(self):
        body = self.fresh()
        body["provider"]["allow_fallbacks"] = True
        self.assertTrue(any("provider" in p for p in self.check(body)))

    def test_a_sent_temperature(self):
        body = self.fresh()
        body["temperature"] = 0
        self.assertTrue(any("unexpected body keys" in p for p in self.check(body)))

    def test_an_empty_image(self):
        body = self.fresh()
        body["messages"][1]["content"][1]["image_url"]["url"] = "data:image/jpeg;base64,"
        self.assertTrue(any("JPEG data URL" in p for p in self.check(body)))

    def test_the_wrong_language_is_noticed(self):
        body = self.fresh()
        self.assertTrue(self.check(body, language="de"))

    def test_control_the_untouched_body_passes(self):
        self.assertEqual(self.check(self.fresh()), [])


class Redaction(unittest.TestCase):
    def test_image_bytes_are_shown_as_a_length_and_the_original_is_untouched(self):
        body = body_for(image_data_url=DATA_URL)
        original = copy.deepcopy(body)
        shown = production.redact_body(body)
        url = shown["messages"][1]["content"][1]["image_url"]["url"]
        self.assertIn(f"{len(DATA_URL)} chars", url)
        self.assertNotIn("base64,/", url)
        self.assertEqual(body, original)

    def test_the_printed_form_does_not_contain_the_photo_bytes(self):
        text = production.format_body(body_for(image_data_url=DATA_URL))
        self.assertNotIn(DATA_URL[40:80], text)
        self.assertIn('"strict": true', text)


class RecordedCall(unittest.TestCase):
    def run_photo(self, client: FakeClient, model: dict = MODEL_38) -> dict:
        models = {"m": model}
        cfg = {"type": "production", "model": "m", "task": "plate_photo", "language": "en"}
        return production.run_production(cfg, DATA_URL, {"resizer": "test"}, models, {"p": client}, CONTRACT)

    def test_a_valid_answer_records_every_field_the_task_asks_for(self):
        client = FakeClient(valid_plate_answer())
        record = self.run_photo(client)
        self.assertEqual(record["http_status"], 200)
        self.assertIs(record["schema_valid"], True)
        self.assertEqual(record["parse"], "strict")
        self.assertEqual(json.loads(record["raw_content"]), valid_plate_answer())
        self.assertEqual(record["latency_ms"], 12.5)
        self.assertEqual(record["prompt_tokens"], 1000)
        self.assertEqual(record["completion_tokens"], 200)
        self.assertEqual(record["reasoning_tokens"], 30)
        self.assertEqual(record["usage_cost_usd"], 0.00123)
        self.assertEqual(record["provider"], "FakeVertex")
        self.assertEqual(record["model_returned"], "fake/model-001")
        self.assertIsNone(record["error"])
        self.assertEqual(len(record["foods"]), 1)
        self.assertEqual(record["cost_usd"], 0.00123)
        self.assertEqual(len(client.bodies), 1)

    def test_the_record_keeps_the_request_without_the_photo_bytes(self):
        record = self.run_photo(FakeClient(valid_plate_answer()), MODEL_35)
        self.assertEqual(record["request"]["reasoning"], {"effort": "minimal"})
        self.assertEqual(record["request"]["max_tokens"], 8192)
        self.assertNotIn("messages", record["request"])
        self.assertNotIn(DATA_URL[40:80], json.dumps(record))

    def test_a_schema_invalid_answer_is_recorded_as_invalid_with_the_reason(self):
        answer = valid_plate_answer()
        answer["foods"][0]["confidence"] = "certain"
        record = self.run_photo(FakeClient(answer))
        self.assertEqual(record["http_status"], 200)
        self.assertIs(record["schema_valid"], False)
        self.assertTrue(any("confidence" in e for e in record["schema_errors"]))
        self.assertIsNone(record["error"])

    def test_json_wrapped_in_a_markdown_fence_is_not_strict_valid(self):
        fenced = "```json\n" + json.dumps(valid_plate_answer()) + "\n```"
        record = self.run_photo(FakeClient(fenced))
        self.assertIs(record["schema_valid"], False)
        self.assertEqual(record["parse"], "tolerant")
        self.assertIs(record["schema_valid_after_tolerant_parse"], True)

    def test_an_http_400_is_a_result_not_an_exception(self):
        client = FakeClient(status=400, envelope={"error": {"message": "schema not supported for this route"}})
        record = self.run_photo(client)
        self.assertEqual(record["http_status"], 400)
        self.assertIs(record["schema_valid"], False)
        self.assertIn("HTTP 400", record["error"])
        self.assertIsNone(record["raw_content"])

    def test_an_error_inside_a_200_body_is_an_error(self):
        client = FakeClient(envelope={"error": {"code": 502, "message": "upstream"}})
        record = self.run_photo(client)
        self.assertIn("API error in a 200 body", record["error"])
        self.assertIs(record["schema_valid"], False)

    def test_empty_content_is_invalid(self):
        record = self.run_photo(FakeClient(""))
        self.assertIs(record["schema_valid"], False)

    def test_a_missing_usage_block_gives_none_not_zero(self):
        envelope = {"model": "m", "choices": [{"message": {"content": json.dumps(valid_plate_answer())}}]}
        record = self.run_photo(FakeClient(envelope=envelope))
        self.assertIsNone(record["usage_cost_usd"])
        self.assertIsNone(record["prompt_tokens"])
        self.assertIsNone(record["reasoning_tokens"])
        self.assertIsNone(record["provider"])


class TextAndRecipeModes(unittest.TestCase):
    """Two inline cases per mode, so the loaders and the runners are exercised end to end."""

    def jsonl(self, lines: list[dict]) -> Path:
        directory = Path(tempfile.mkdtemp(prefix="cases-"))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        path = directory / "cases.jsonl"
        path.write_text("\n".join(json.dumps(line) for line in lines) + "\n", encoding="utf-8")
        return path

    def test_typed_meal_cases(self):
        path = self.jsonl(
            [
                {"id": "t1", "input": "Two scrambled eggs and a black coffee", "lang": "en"},
                {"id": "t2", "input": "Zwei Scheiben Roggenbrot mit Butter", "lang": "de"},
            ]
        )
        cases = production.load_cases(path, kind="text", languages=CONTRACT.languages)
        self.assertEqual([c["id"] for c in cases], ["t1", "t2"])
        client = FakeClient(valid_plate_answer())
        cfg = {"type": "single_text", "model": "m", "task": "plate_text"}
        records = [production.run_text_case(cfg, c, {"m": MODEL_38}, {"p": client}, CONTRACT) for c in cases]
        for case, record, body in zip(cases, records, client.bodies):
            self.assertIs(record["schema_valid"], True)
            self.assertEqual(record["language"], case["lang"])
            self.assertEqual(body["messages"][1]["content"][1]["text"], case["input"])
            self.assertEqual(body["messages"][0]["content"], CONTRACT.entry("plate_text", case["lang"])["systemPrompt"])
            self.assertEqual(production.check_request_body(body, CONTRACT, MODEL_38, "plate_text", case["lang"]), [])
        self.assertNotEqual(client.bodies[0]["messages"][0], client.bodies[1]["messages"][0])

    def test_typed_pantry_cases(self):
        path = self.jsonl(
            [
                {"id": "p1", "input": "6 eggs, 2 kg flour, some cheese", "lang": "en"},
                {"id": "p2", "input": "ein Liter Milch und Butter", "lang": "de"},
            ]
        )
        cases = production.load_cases(path, kind="text", languages=CONTRACT.languages)
        client = FakeClient(valid_pantry_answer())
        cfg = {"type": "single_text", "model": "m", "task": "pantry_text"}
        for case in cases:
            record = production.run_text_case(cfg, case, {"m": MODEL_35}, {"p": client}, CONTRACT)
            self.assertIs(record["schema_valid"], True, record["schema_errors"])
            self.assertEqual(record["task"], "pantry_text")
            self.assertEqual(record["request"]["reasoning"], {"effort": "minimal"})
        self.assertEqual(client.bodies[0]["response_format"]["json_schema"]["name"], CONTRACT.task("pantry_text")["schemaName"])

    def test_recipe_cases(self):
        remaining = "Rest of the day, remaining against the targets already set.\nMeal slot: dinner"
        path = self.jsonl(
            [
                {
                    "id": "r1",
                    "lang": "en",
                    "slot": "dinner",
                    "remaining_day_block": remaining,
                    "pantry": [{"name": "eggs", "amount": 6, "unit": "piece"}, {"name": "spinach", "amount": None, "unit": None}],
                },
                {"id": "r2", "lang": "tr", "slot": "lunch", "remaining_day_block": remaining, "pantry": [{"name": "rice", "amount": 300, "unit": "g"}]},
            ]
        )
        cases = production.load_cases(path, kind="recipe", languages=CONTRACT.languages)
        client = FakeClient(valid_recipe_answer())
        cfg = {"type": "recipe", "model": "m"}
        for case in cases:
            record = production.run_recipe_case(cfg, case, {"m": MODEL_38}, {"p": client}, CONTRACT)
            self.assertIs(record["schema_valid"], True, record["schema_errors"])
        first = client.bodies[0]["messages"][1]["content"][1]["text"]
        self.assertIn("- eggs, 6 piece", first)
        self.assertIn("- spinach\n", first)
        self.assertIn("Meal slot to cook for: dinner", first)
        self.assertIn("language: tr", client.bodies[1]["messages"][1]["content"][1]["text"])
        self.assertEqual(production.check_request_body(client.bodies[1], CONTRACT, MODEL_38, "recipe", "tr"), [])

    def test_a_recipe_answer_is_not_valid_under_the_plate_schema(self):
        # control: the recorded schema_valid really depends on the task schema.
        client = FakeClient(valid_recipe_answer())
        cfg = {"type": "single_text", "model": "m", "task": "plate_text"}
        record = production.run_text_case(cfg, {"id": "x", "input": "eggs", "lang": "en"}, {"m": MODEL_38}, {"p": client}, CONTRACT)
        self.assertIs(record["schema_valid"], False)

    def test_bad_case_files_stop_with_the_line_number(self):
        directory = Path(tempfile.mkdtemp(prefix="cases-"))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        path = directory / "bad.jsonl"
        for text, fragment in (
            ('{"input": "x"}\n', "missing"),
            ('{"input": "x", "lang": "xx"}\n', "lang"),
            ("not json\n", "not JSON"),
            ('{"input": "  ", "lang": "en"}\n', "non-empty"),
            ('{"id": "a", "input": "x", "lang": "en"}\n{"id": "a", "input": "y", "lang": "en"}\n', "duplicate"),
            ("# only a comment\n", "no cases"),
        ):
            path.write_text(text, encoding="utf-8")
            with self.assertRaises(SystemExit, msg=text) as caught:
                production.load_cases(path, kind="text", languages=CONTRACT.languages)
            self.assertIn(fragment, str(caught.exception))
        with self.assertRaises(SystemExit):
            production.load_cases(directory / "absent.jsonl", kind="text", languages=CONTRACT.languages)

    def test_comments_and_blank_lines_are_skipped_and_ids_default_to_the_line(self):
        directory = Path(tempfile.mkdtemp(prefix="cases-"))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        path = directory / "ok.jsonl"
        path.write_text('# c\n\n{"input": "x", "lang": "en"}\n', encoding="utf-8")
        cases = production.load_cases(path, kind="text", languages=CONTRACT.languages)
        self.assertEqual(cases[0]["id"], "case-0003")

    def test_a_task_the_approach_type_does_not_run_is_refused(self):
        with self.assertRaises(SystemExit):
            production.approach_task({"type": "single_text", "task": "recipe"})
        with self.assertRaises(SystemExit):
            production.approach_task({"type": "production", "task": "plate_text"})


class Images(unittest.TestCase):
    def photo(self, width: int, height: int) -> Path:
        directory = Path(tempfile.mkdtemp(prefix="img-"))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        path = directory / "p.jpg"
        path.write_bytes(tiny_jpeg_bytes(width, height))
        return path

    def decode(self, data_url: str):
        from PIL import Image

        self.assertTrue(data_url.startswith("data:image/jpeg;base64,"))
        return Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1])))

    def test_a_large_photo_is_scaled_to_1600_on_the_long_side(self):
        url, info = production.production_image_data_url(self.photo(2400, 1800), CONTRACT.photo_constraints)
        image = self.decode(url)
        self.assertEqual(image.size, (1600, 1200))
        self.assertEqual((info["width"], info["height"]), (1600, 1200))
        self.assertEqual(image.format, "JPEG")

    def test_a_small_photo_is_not_upscaled_but_is_still_a_jpeg(self):
        url, info = production.production_image_data_url(self.photo(40, 30), CONTRACT.photo_constraints)
        self.assertEqual(self.decode(url).size, (40, 30))
        self.assertEqual(info["jpeg_quality"], 0.85)

    def test_the_magick_fallback_gives_the_same_geometry(self):
        if shutil.which("magick") is None:
            self.skipTest("magick is not installed")
        path = self.photo(2400, 1800)
        with mock.patch.object(production, "_resize_with_pillow", return_value=None):
            url, info = production.production_image_data_url(path, CONTRACT.photo_constraints)
        self.assertEqual(info["resizer"], "magick")
        self.assertEqual(self.decode(url).size, (1600, 1200))

    def test_with_neither_tool_it_stops_instead_of_sending_a_big_photo(self):
        path = self.photo(40, 30)
        with mock.patch.object(production, "_resize_with_pillow", return_value=None), mock.patch.object(
            production, "_resize_with_magick", return_value=None
        ):
            with self.assertRaises(SystemExit) as caught:
                production.production_image_data_url(path, CONTRACT.photo_constraints)
        self.assertIn("unresized", str(caught.exception))


class Configs(unittest.TestCase):
    """The four EU cells say what the brief says they say."""

    def load(self, name: str) -> dict:
        return json.loads((EVAL_ROOT / "configs" / f"{name}.json").read_text(encoding="utf-8"))

    def test_the_four_cells(self):
        names = [
            "eu-cell-38-prod-oldprompt",
            "eu-cell-38-newprompt",
            "eu-cell-35-eu-newprompt",
            "eu-cell-35-eu-oldprompt",
        ]
        for name in names:
            config = self.load(name)
            self.assertEqual(config["name"], name)
            self.assertEqual(config["image_resize"], "production", name)
            self.assertEqual(config["contract"], "generated/vision-contract.json")
            (model,) = config["models"].values()
            self.assertEqual(model["max_tokens"], 8192)
            self.assertTrue(model["usage_include"])
            routing = model["extra_body"]["provider"]
            self.assertEqual((routing["zdr"], routing["data_collection"], routing["allow_fallbacks"]), (True, "deny", False))
            (provider,) = config["providers"].values()
            self.assertEqual(provider["api_key_env"], "OPENROUTER_API_KEY")
            self.assertNotIn("api_key", provider)
            is_35 = "35" in name
            self.assertEqual(model["id"], "google/gemini-3.5-flash-lite" if is_35 else "google/gemini-3.8-flash")
            self.assertEqual(provider["base_url"], "https://eu.openrouter.ai/api/v1" if is_35 else "https://openrouter.ai/api/v1")
            self.assertEqual(routing["only"], ["google-vertex/eu"] if is_35 else ["google-vertex"])
            if is_35:
                self.assertEqual(model["reasoning"], {"effort": "minimal"})
            else:
                self.assertNotIn("reasoning", model)
            old = name.endswith("oldprompt")
            self.assertEqual(config["approach_order"], ["baseline"] if old else ["production"])
            (first_type,) = {config["approaches"][config["approach_order"][0]]["type"]}
            self.assertEqual(first_type, "single" if old else "production")

    def test_every_declared_approach_type_is_known(self):
        for path in sorted((EVAL_ROOT / "configs").glob("eu-cell-*.json")):
            config = json.loads(path.read_text(encoding="utf-8"))
            for key, approach in config["approaches"].items():
                kind = approach["type"]
                self.assertIn(kind, approaches.IMAGE_APPROACH_TYPES + approaches.CASE_APPROACH_TYPES, f"{path.name}:{key}")

    def test_old_prompt_cells_send_reasoning_and_usage_like_the_new_ones(self):
        for name in ("eu-cell-35-eu-oldprompt", "eu-cell-35-eu-newprompt"):
            config = self.load(name)
            (model,) = config["models"].values()
            extra = production_legacy_extra(model)
            self.assertEqual(extra["reasoning"], {"effort": "minimal"})
            self.assertEqual(extra["usage"], {"include": True})
            self.assertIn("provider", extra)
        old38 = production_legacy_extra(next(iter(self.load("eu-cell-38-prod-oldprompt")["models"].values())))
        self.assertNotIn("reasoning", old38)


def production_legacy_extra(model: dict) -> dict:
    from harness import providers

    return providers.legacy_extra_body(model) or {}


if __name__ == "__main__":
    unittest.main()
