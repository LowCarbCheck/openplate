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


class RetryErrors(unittest.TestCase):
    """`--retry-errors` re-runs what failed in transit and nothing else; the summary counts every `error` record."""

    def test_which_records_are_retried(self):
        retry = [
            {"kind": "production", "http_status": 429, "error": "HTTP 429: slow"},
            {"kind": "production", "http_status": 500, "error": "HTTP 500"},
            {"kind": "production", "http_status": 503, "error": "HTTP 503"},
            {"kind": "production", "http_status": None, "error": "transport: ConnectionResetError: reset"},
            {"error": "the call raised"},
            {"foods": [], "raw_ok": False, "error": "call failed: HTTP 500"},
        ]
        keep = [
            {"kind": "production", "http_status": 200, "schema_valid": True, "error": None},
            {"kind": "production", "http_status": 200, "schema_valid": False, "error": None},
            {"kind": "production", "http_status": 200, "schema_valid": False, "error": "API error in a 200 body: {}"},
            {"kind": "production", "http_status": 400, "error": "HTTP 400: bad schema"},
            {"kind": "production", "http_status": 404, "error": "HTTP 404"},
            {"foods": [{"name": "egg"}], "raw_ok": True},
            "not a record",
        ]
        for record in retry:
            self.assertTrue(runner.needs_retry(record), record)
        for record in keep:
            self.assertFalse(runner.needs_retry(record), record)

    def test_drop_retryable_keeps_everything_outside_the_scope(self):
        results = {
            "03": {"production": {"kind": "production", "http_status": 500, "error": "HTTP 500"}, "other": {"kind": "production", "http_status": 200}},
            "04": {"production": {"kind": "production", "http_status": 429, "error": "HTTP 429"}},
        }
        failures = [{"image_id": "03", "approach": "production", "error": "x"}, {"image_id": "04", "approach": "production", "error": "y"}]
        kept, kept_failures, dropped = runner.drop_retryable(results, failures, lambda image_id, key: image_id == "03")
        self.assertEqual(dropped, [("03", "production")])
        self.assertEqual(sorted(kept), ["03", "04"])
        self.assertEqual(list(kept["03"]), ["other"])
        self.assertEqual(kept_failures, [failures[1]])
        # control: without a scope both failed records go
        _, _, dropped_all = runner.drop_retryable(results, failures)
        self.assertEqual(sorted(dropped_all), [("03", "production"), ("04", "production")])

    def test_the_summary_counts_a_record_with_an_error_even_when_nothing_raised(self):
        results = {
            "03": {"production": {"kind": "production", "http_status": 400, "error": "HTTP 400: bad"}},
            "04": {"production": {"kind": "production", "http_status": 200, "error": None}},
        }
        merged = runner.collect_failures(results, [])
        self.assertEqual([(f["image_id"], f["approach"]) for f in merged], [("03", "production")])
        # control: a failure the runner already listed is not counted twice
        again = runner.collect_failures(results, [{"image_id": "03", "approach": "production", "error": "HTTP 400: bad"}])
        self.assertEqual(len(again), 1)
        self.assertEqual(runner.collect_failures({"04": results["04"]}, []), [])

    def go(self, directory: Path, client: FakeClient, extra: list[str] | None = None) -> tuple[int | None, str]:
        argv = ["--config", str(EVAL_ROOT / "configs/eu-cell-38-newprompt.json"), "--only", "03", "--out", str(directory), "--min-avail-mb", "0"]
        with mock.patch.object(providers, "build_clients", lambda *a, **k: {"openrouter_global": client}), mock.patch.object(
            providers, "preflight", lambda _c: None
        ):
            return run_main(argv + (extra or []))

    def test_a_run_of_http_errors_reports_failures_and_retry_errors_runs_only_those_again(self):
        directory = Path(tempfile.mkdtemp(prefix="retry-"))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        broken = FakeClient(status=500, envelope={"error": {"message": "upstream"}})
        code, text = self.go(directory, broken)
        self.assertEqual(code, 1, text[-400:])
        self.assertIn("Failures: 1", text)
        summary = json.loads((directory / "results.json").read_text(encoding="utf-8"))["_summary"]
        self.assertEqual([(f["image_id"], f["approach"]) for f in summary["failures"]], [("03", "production")])

        # a plain resume skips the failed record and calls nothing
        silent = FakeClient(valid_plate_answer())
        code, text = self.go(directory, silent)
        self.assertEqual(len(silent.bodies), 0)
        self.assertIn("already done, skipping", text)
        self.assertEqual(code, 1)

        # --retry-errors calls it again, keeps the new answer, and the failure is gone
        healed = FakeClient(valid_plate_answer())
        code, text = self.go(directory, healed, ["--retry-errors"])
        self.assertEqual(len(healed.bodies), 1, text[-600:])
        self.assertIn("retry-errors: 1 failed record(s) will run again", text)
        self.assertEqual(code, 0, text[-400:])
        results = json.loads((directory / "results.json").read_text(encoding="utf-8"))
        self.assertEqual(results["03"]["production"]["http_status"], 200)
        self.assertEqual(results["_summary"]["failures"], [])

        # control: once healed, the flag has nothing to run
        again = FakeClient(valid_plate_answer())
        self.go(directory, again, ["--retry-errors"])
        self.assertEqual(len(again.bodies), 0)

    def test_retry_errors_leaves_a_400_alone(self):
        directory = Path(tempfile.mkdtemp(prefix="retry400-"))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        self.go(directory, FakeClient(status=400, envelope={"error": {"message": "schema not supported"}}))
        client = FakeClient(valid_plate_answer())
        code, text = self.go(directory, client, ["--retry-errors"])
        self.assertIn("retry-errors: 0 failed record(s) will run again", text)  # the flag ran and chose nothing
        self.assertEqual(len(client.bodies), 0)
        record = json.loads((directory / "results.json").read_text(encoding="utf-8"))["03"]["production"]
        self.assertEqual(record["http_status"], 400)


if __name__ == "__main__":
    unittest.main()
