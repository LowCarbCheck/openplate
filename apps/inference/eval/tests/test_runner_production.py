"""The runner end to end without a network: dry runs for every cell, the stale-contract stop, a faked run."""

from __future__ import annotations

import contextlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from harness import providers, runner
from harness.contract import DEFAULT_CONTRACT_PATH

from .support import EVAL_ROOT, FakeClient, valid_plate_answer, valid_recipe_answer

CELLS = [
    "eu-cell-38-prod-oldprompt",
    "eu-cell-38-newprompt",
    "eu-cell-35-eu-newprompt",
    "eu-cell-35-eu-oldprompt",
]


def run_main(argv: list[str]) -> tuple[int | None, str]:
    out = io.StringIO()
    code: int | None
    with contextlib.redirect_stdout(out), mock.patch.dict("os.environ", {}, clear=False):
        try:
            code = runner.main(argv)
        except SystemExit as e:
            code = e.code if isinstance(e.code, int) else None
            out.write(f"\nSystemExit: {e.code}\n")
    return code, out.getvalue()


class DryRuns(unittest.TestCase):
    def test_every_cell_dry_runs_without_a_key_and_checks_the_body(self):
        with mock.patch.dict("os.environ"):
            import os

            os.environ.pop("OPENROUTER_API_KEY", None)
            for name in CELLS:
                code, text = run_main(["--config", str(EVAL_ROOT / "configs" / f"{name}.json"), "--dry-run", "--only", "03"])
                self.assertEqual(code, 0, f"{name}\n{text[-600:]}")
                self.assertIn("no model calls made", text)
                self.assertIn("image data url:", text)
                if name.endswith("newprompt"):
                    self.assertIn("contract check: ok", text, name)

    def test_a_dry_run_writes_nothing(self):
        before = set((EVAL_ROOT / "runs").glob("eu-cell-*")) if (EVAL_ROOT / "runs").exists() else set()
        run_main(["--config", str(EVAL_ROOT / "configs/eu-cell-38-newprompt.json"), "--dry-run", "--only", "03"])
        after = set((EVAL_ROOT / "runs").glob("eu-cell-*")) if (EVAL_ROOT / "runs").exists() else set()
        self.assertEqual(before, after)

    def test_text_pantry_and_recipe_previews_read_the_cases_file(self):
        directory = Path(tempfile.mkdtemp(prefix="rc-"))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        text_cases = directory / "text.jsonl"
        text_cases.write_text(
            '{"id": "a", "input": "two eggs", "lang": "en"}\n{"id": "b", "input": "zwei Eier", "lang": "de"}\n',
            encoding="utf-8",
        )
        recipe_cases = directory / "recipe.jsonl"
        recipe_cases.write_text(
            json.dumps({"id": "r", "lang": "fr", "slot": "dinner", "remaining_day_block": "Rest of the day", "pantry": [{"name": "oeufs", "amount": 6, "unit": "piece"}]})
            + "\n",
            encoding="utf-8",
        )
        config = str(EVAL_ROOT / "configs/eu-cell-35-eu-newprompt.json")
        for approach, cases, fragment in (
            ("plate_text", text_cases, "contract check: ok (task plate_text, language en"),
            ("pantry_text", text_cases, "contract check: ok (task pantry_text, language en"),
            ("recipe", recipe_cases, "contract check: ok (task recipe, language fr"),
        ):
            code, text = run_main(["--config", config, "--dry-run", "--approach", approach, "--cases", str(cases)])
            self.assertEqual(code, 0, f"{approach}\n{text[-500:]}")
            self.assertIn(fragment, text)
            self.assertIn('"reasoning"', text)

    def test_a_missing_cases_file_is_said_not_hidden(self):
        code, text = run_main(
            ["--config", str(EVAL_ROOT / "configs/eu-cell-38-newprompt.json"), "--dry-run", "--approach", "recipe", "--cases", "nope.jsonl"]
        )
        self.assertIn("cases file not found", text)


class StaleContract(unittest.TestCase):
    def stale_config(self) -> Path:
        eval_copy = Path(tempfile.mkdtemp(prefix="stale-")) / "apps/inference/eval"
        self.addCleanup(shutil.rmtree, eval_copy.parents[2], ignore_errors=True)
        # A checkout that holds an app source whose hash is not the one the contract names.
        source = eval_copy.parents[2] / "apps/app/app/services/vision/prompt.ts"
        source.parent.mkdir(parents=True)
        source.write_text("export const changed = true;\n", encoding="utf-8")
        (eval_copy / "generated").mkdir(parents=True)
        (eval_copy / "images").mkdir()
        shutil.copy(EVAL_ROOT / "images/03.jpg", eval_copy / "images/03.jpg")
        contract = json.loads((EVAL_ROOT / DEFAULT_CONTRACT_PATH).read_text(encoding="utf-8"))
        contract["generatedFrom"]["files"] = {"apps/app/app/services/vision/prompt.ts": "0" * 40}
        (eval_copy / DEFAULT_CONTRACT_PATH).write_text(json.dumps(contract), encoding="utf-8")
        config = json.loads((EVAL_ROOT / "configs/eu-cell-38-newprompt.json").read_text(encoding="utf-8"))
        (eval_copy / "configs").mkdir()
        path = eval_copy / "configs" / "config.json"
        path.write_text(json.dumps(config), encoding="utf-8")
        return path

    def test_control_a_stale_contract_stops_the_run_before_any_request(self):
        code, text = run_main(["--config", str(self.stale_config()), "--dry-run"])
        self.assertNotEqual(code, 0)
        self.assertIn("STALE", text)
        self.assertIn("pnpm vision:export-contract", text)

    def test_allow_stale_runs_and_records_it(self):
        code, text = run_main(["--config", str(self.stale_config()), "--dry-run", "--allow-stale-contract"])
        self.assertEqual(code, 0, text[-500:])
        self.assertIn('"allowed_stale": true', text)


class FakedRun(unittest.TestCase):
    """A whole run with the HTTP client replaced: results.json carries the per-call record, and resume skips it."""

    def test_a_production_run_and_a_recipe_run_write_records_and_resume(self):
        directory = Path(tempfile.mkdtemp(prefix="fake-run-"))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        cases = directory / "recipe.jsonl"
        cases.write_text(
            json.dumps({"id": "r1", "lang": "en", "slot": "dinner", "remaining_day_block": "Rest of the day", "pantry": []}) + "\n",
            encoding="utf-8",
        )
        plate, recipe = FakeClient(valid_plate_answer()), FakeClient(valid_recipe_answer())

        def build_clients(*_args, **_kwargs):
            return {"openrouter_global": plate}

        out = directory / "out"
        config = str(EVAL_ROOT / "configs/eu-cell-38-newprompt.json")
        argv = ["--config", config, "--only", "03", "--out", str(out), "--min-avail-mb", "0"]
        with mock.patch.object(providers, "build_clients", build_clients), mock.patch.object(providers, "preflight", lambda _c: None):
            code, _ = run_main(argv)
            self.assertEqual(code, 0)
            code, text = run_main(argv)
        self.assertEqual(code, 0)
        self.assertIn("already done, skipping", text)
        self.assertEqual(len(plate.bodies), 1, "the resumed run must not call the model again")
        results = json.loads((out / "results.json").read_text(encoding="utf-8"))
        record = results["03"]["production"]
        self.assertIs(record["schema_valid"], True)
        self.assertEqual(record["http_status"], 200)
        self.assertEqual(record["provider"], "FakeVertex")
        self.assertEqual(record["image"]["max_long_side_px"], 1600)

        recipe_out = directory / "recipe-out"
        argv = ["--config", config, "--only", "03", "--approach", "recipe", "--cases", str(cases), "--out", str(recipe_out), "--min-avail-mb", "0"]
        with mock.patch.object(providers, "build_clients", lambda *a, **k: {"openrouter_global": recipe}), mock.patch.object(
            providers, "preflight", lambda _c: None
        ):
            code, text = run_main(argv)
        self.assertEqual(code, 0, text[-800:])
        recipe_results = json.loads((recipe_out / "results.json").read_text(encoding="utf-8"))
        self.assertIs(recipe_results["r1"]["recipe"]["schema_valid"], True)
        self.assertEqual(len(recipe.bodies), 1)


if __name__ == "__main__":
    unittest.main()
