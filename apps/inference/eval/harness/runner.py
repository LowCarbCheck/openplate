"""Config-driven eval runner.

    python3 -m harness.runner --config configs/openrouter-pilot.json \
        [--only 03] [--approach baseline] [--out runs/my-run] [--fan-out 3]
    python3 -m harness.runner check-labels        # corpus/label self-check, non-zero on failure

Run it from the `eval/` directory. Relative paths inside a config are resolved
against the eval root (the config file's grandparent), so it also works from
elsewhere.

Writes into the output directory:
  results.json         per-image per-approach results + `_summary`
  results_summary.md   per-image food-name table for human reading

Both files are rewritten (atomically) after **every** image x approach result, so a run that
is killed half-way keeps everything it already paid for. While a run is in flight the
results.json carries a top-level `"_partial": true` marker; the final write drops it, so a
completed file is format-identical to what earlier runs produced.

Re-invoking with the same `--out` **resumes**: already-recorded image x approach pairs are
skipped outright. `--force` discards the prior results and starts over. `--retry-errors` resumes too, but
re-runs the records that failed in transit (HTTP 429, any 5xx, no HTTP status, or an `error` with no `kind`) and
keeps every answer that arrived, including a 400 and a schema-invalid one, which a second call would not change.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import platform
import re
import sys
import time
from pathlib import Path

from . import approaches as approach_lib
from . import contract as contract_lib
from . import production
from . import providers


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------


_ENV_PLACEHOLDER_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


def expand_env(value):
    """Substitute `${VAR}` from the environment, recursively, in a loaded config.

    Only string values are touched, and an unset variable is a hard error rather
    than an empty string: a config whose `base_url` silently became
    "/v1/chat/completions" would fail deep inside the first request instead of at
    load time. Same fail-fast contract as `api_key_env` in providers.ChatClient.

    Escape a literal `${...}` as `$${...}`.
    """
    if isinstance(value, dict):
        return {k: expand_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [expand_env(v) for v in value]
    if not isinstance(value, str):
        return value

    missing: list[str] = []

    def substitute(match: re.Match) -> str:
        name = match.group(1)
        env_value = os.environ.get(name)
        if env_value is None:
            missing.append(name)
            return match.group(0)
        return env_value

    expanded = _ENV_PLACEHOLDER_RE.sub(substitute, value)
    if missing:
        raise SystemExit(
            f"ERROR: config references ${{{missing[0]}}} but it is not set in the "
            "environment. Export it before running, e.g.:\n"
            f"  export {missing[0]}=https://<pod-id>-8000.proxy.runpod.net/v1"
        )
    return expanded.replace("$${", "${")


def load_config(config_path: Path) -> tuple[dict, Path]:
    """Load a JSON config. Returns (config, eval_root)."""
    if not config_path.is_file():
        raise SystemExit(f"ERROR: config not found: {config_path}")
    config = expand_env(json.loads(config_path.read_text(encoding="utf-8")))
    eval_root = Path(config["base_dir"]) if config.get("base_dir") else config_path.resolve().parent.parent
    return config, eval_root


def resolve_path(eval_root: Path, value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else (eval_root / path)


def approach_keys(config: dict) -> list[str]:
    declared = config.get("approaches") or {}
    order = config.get("approach_order")
    if order:
        missing = [k for k in order if k not in declared]
        if missing:
            raise SystemExit(f"ERROR: approach_order names undeclared approaches: {missing}")
        return list(order)
    return list(declared)


# ---------------------------------------------------------------------------
# Run environment (a latency number without its machine is not a measurement)
# ---------------------------------------------------------------------------


def _meminfo_mb(key: str) -> int | None:
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if line.startswith(key + ":"):
                return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        return None
    return None


def _cpu_model() -> str | None:
    try:
        for line in Path("/proc/cpuinfo").read_text(encoding="utf-8").splitlines():
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
    except OSError:
        return None
    return None


def host_info() -> dict:
    return {
        "hostname": platform.node(),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "cpu_model": _cpu_model(),
        "cpu_count": os.cpu_count(),
        "mem_total_mb": _meminfo_mb("MemTotal"),
        "mem_available_mb_at_start": _meminfo_mb("MemAvailable"),
    }


# ---------------------------------------------------------------------------
# Mid-run memory guard
# ---------------------------------------------------------------------------


def mem_available_mb() -> int:
    """MemAvailable from /proc/meminfo, in MB. Returns a huge value if unreadable
    (non-Linux / sandbox) so the guard never blocks where it cannot measure."""
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        return 1 << 30
    return 1 << 30


def wait_for_memory(min_avail_mb: int, *, max_wait_s: int = 3600, poll_s: int = 60) -> None:
    """Block until MemAvailable is at least `min_avail_mb`, or give up and raise.

    The phase gate in run-50img.sh only checks *before* a phase starts; competing load that
    arrives mid-run (the 2026-08-12 workstation freeze) goes unnoticed. This is the per-image
    tripwire for that case. `min_avail_mb <= 0` disables the guard.

    After `max_wait_s` of waiting the run fails rather than continuing: the checkpoint file
    preserves progress, and a thrashing run produces meaningless timings, which is worse than
    no run.
    """
    if min_avail_mb <= 0:
        return
    waited = 0
    while True:
        avail = mem_available_mb()
        if avail >= min_avail_mb:
            return
        if waited >= max_wait_s:
            raise RuntimeError(
                f"memory guard: MemAvailable {avail}MB still below {min_avail_mb}MB after "
                f"{waited}s of waiting -- aborting. Progress is checkpointed in results.json; "
                "free memory on this host and re-run to resume."
            )
        print(
            f"{datetime.datetime.now().isoformat(timespec='seconds')} memory guard: "
            f"MemAvailable {avail}MB < {min_avail_mb}MB -- pausing {poll_s}s",
            flush=True,
        )
        time.sleep(poll_s)
        waited += poll_s


# ---------------------------------------------------------------------------
# Image discovery
# ---------------------------------------------------------------------------


def discover_images(images_dir: Path, only: list[str] | None) -> list[Path]:
    if not images_dir.is_dir():
        raise SystemExit(f"ERROR: images dir not found: {images_dir}")
    paths = sorted(images_dir.glob("*.jpg")) + sorted(images_dir.glob("*.jpeg")) + sorted(
        images_dir.glob("*.png")
    )
    paths = sorted(paths, key=lambda p: p.stem)
    if only:
        wanted = set(only)
        paths = [p for p in paths if p.stem in wanted or p.name in wanted]
        if not paths:
            raise SystemExit(f"ERROR: no image matching --only {only} in {images_dir}")
    return paths


# ---------------------------------------------------------------------------
# Markdown summary
# ---------------------------------------------------------------------------


def food_names(foods: list) -> str:
    names = [str(f["name"]) for f in foods if isinstance(f, dict) and "name" in f]
    return ", ".join(names) if names else "(none)"


def answer_names(result: dict) -> str:
    """What a result named: foods for a plate, items for a pantry list, titles for recipes."""
    names = food_names(result.get("foods") or [])
    if names != "(none)":
        return names
    answer = result.get("answer")
    if not isinstance(answer, dict):
        return names
    items = [str(i["name"]) for i in answer.get("items") or [] if isinstance(i, dict) and "name" in i]
    titles = [str(r["title"]) for r in answer.get("recipes") or [] if isinstance(r, dict) and "title" in r]
    return ", ".join(items or titles) or names


def write_summary_markdown(all_results: dict, keys: list[str], out_path: Path) -> None:
    lines = ["# Plate identification bench -- food lists by approach", ""]
    for image_id, per_image in all_results.items():
        if image_id.startswith("_"):
            continue
        lines += [f"## {image_id}", "", "| approach | foods |", "|---|---|"]
        for key in keys:
            result = per_image.get(key)
            if result is None:
                continue
            if "final" in result and isinstance(result.get("final"), dict):
                lines.append(
                    f"| {key} (final) | {food_names(result['final'].get('foods') or [])} |"
                )
                for cand in result.get("candidates") or []:
                    vid = cand.get("variant_id", "?")
                    lines.append(
                        f"| {key} candidate: {vid} | {food_names(cand.get('foods') or [])} |"
                    )
            else:
                lines.append(f"| {key} | {answer_names(result)} |")
        lines.append("")
    _atomic_write(out_path, "\n".join(lines))


# ---------------------------------------------------------------------------
# Checkpointing / resume
# ---------------------------------------------------------------------------


def _atomic_write(path: Path, text: str) -> None:
    """Write via temp file + rename so a kill mid-write cannot truncate the real file."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def load_prior_results(results_path: Path) -> tuple[dict, list]:
    """Load a previous (possibly partial) results.json for resume.

    Returns (results_by_image, failures). Bookkeeping keys (`_summary`, `_partial`) are
    dropped -- they are recomputed on every write. Failures are reconstructed from the
    recorded per-approach `error` fields rather than read back from `_summary`, so the
    failure list stays consistent with the results actually on disk.

    A recorded *error* counts as done and is skipped on resume like any other record --
    resume exists to avoid paying twice, not to retry. Use --retry-errors to re-run only the calls that failed
    in transit, or --force to start over.
    """
    if not results_path.is_file():
        return {}, []
    try:
        raw = json.loads(results_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise SystemExit(
            f"ERROR: {results_path} exists but is not readable JSON ({e}). "
            "Move it aside or pass --force to start over."
        ) from e
    if not isinstance(raw, dict):
        raise SystemExit(f"ERROR: {results_path} is not a JSON object; cannot resume.")

    results: dict = {}
    failures: list = []
    for image_id, per_image in raw.items():
        if image_id.startswith("_") or not isinstance(per_image, dict):
            continue
        kept = {k: v for k, v in per_image.items() if isinstance(v, dict)}
        if not kept:
            continue
        results[image_id] = kept
        for key, result in kept.items():
            if result.get("error"):
                failures.append(
                    {"image_id": image_id, "approach": key, "error": str(result["error"])}
                )
    return results, failures


def needs_retry(record) -> bool:
    """True for a recorded call that failed in transit and may succeed when asked again.

    That is an HTTP 429, any 5xx, a production record with no HTTP status at all (a transport error), or a record
    with an `error` and no `kind` (the runner's own `{"error": ...}` for an exception, or an old approach's failed
    result). A 4xx other than 429, a 200 with an invalid schema and a 200 with an error inside are answers: asking
    again would spend money on the same reply, so they are kept."""
    if not isinstance(record, dict):
        return False
    if "http_status" in record:
        status = record["http_status"]
        return status is None or (isinstance(status, int) and (status == 429 or status >= 500))
    return bool(record.get("error")) and not record.get("kind")


def drop_retryable(results: dict, failures: list, in_scope=None) -> tuple[dict, list, list]:
    """Remove the records `needs_retry` selects. Returns (kept results, kept failures, dropped (image id, approach)).

    `in_scope(image_id, key)` limits the drop to what this invocation will run again. A record outside it stays in
    the file untouched: dropping it would erase a result that nothing re-creates (a narrowed `--only` resume)."""
    kept: dict = {}
    dropped: list = []
    for image_id, per_image in results.items():
        survivors = {}
        for key, record in per_image.items():
            if needs_retry(record) and (in_scope is None or in_scope(image_id, key)):
                dropped.append((image_id, key))
            else:
                survivors[key] = record
        if survivors:
            kept[image_id] = survivors
    gone = set(dropped)
    return kept, [f for f in failures if (f["image_id"], f["approach"]) not in gone], dropped


def collect_failures(all_results: dict, failures: list) -> list:
    """The recorded failures plus every record that carries an `error`, once per (image id, approach).

    The runner appends to `failures` only in its `except` blocks. A production record with an HTTP 400, a transport
    error or an API error inside a 200 carries `error` but never raised, so counting `failures` alone printed
    "Failures: 0" over a run of 400s."""
    merged = list(failures)
    seen = {(f["image_id"], f["approach"]) for f in failures}
    for image_id, per_image in all_results.items():
        if image_id.startswith("_") or not isinstance(per_image, dict):
            continue
        for key, record in per_image.items():
            if isinstance(record, dict) and record.get("error") and (image_id, key) not in seen:
                seen.add((image_id, key))
                merged.append({"image_id": image_id, "approach": key, "error": str(record["error"])[:400]})
    return merged


def build_summary(
    all_results: dict,
    keys: list[str],
    config: dict,
    args: argparse.Namespace,
    run_name: str,
    images: list[Path],
    failures: list,
    started_at: str,
    wall_t0: float,
    extra: dict | None = None,
) -> tuple[dict, float, dict]:
    per_approach_cost = {key: 0.0 for key in keys}
    total_cost = 0.0
    for image_id, per_image in all_results.items():
        if image_id.startswith("_"):
            continue
        for key in keys:
            cost = approach_lib.approach_cost_usd(per_image.get(key) or {})
            if cost is not None:
                per_approach_cost[key] += cost
                total_cost += cost

    summary = {
        "total_cost_usd": total_cost,
        "per_approach_cost_usd": per_approach_cost,
        "failures": collect_failures(all_results, failures),
        "config_name": run_name,
        "config_path": str(args.config),
        "approaches": keys,
        "approach_configs": {k: (config.get("approaches") or {})[k] for k in keys},
        "models": config.get("models") or {},
        "fan_out_override": args.fan_out,
        "images": [p.name for p in images],
        "started_at": started_at,
        # On a resumed run this covers only the current process's segment -- the earlier
        # segments' wall time died with the killed process. Per-result `latency_ms` in the
        # records themselves is the timing of record; see PERFORMANCE.md.
        "wall_seconds": round(time.monotonic() - wall_t0, 1),
        "host": host_info(),
    }
    if extra:
        summary.update(extra)
    return summary, total_cost, per_approach_cost


def checkpoint(
    all_results: dict,
    keys: list[str],
    out_dir: Path,
    summary: dict,
    partial: bool,
) -> None:
    """Persist results.json (+ the markdown table) after a single result."""
    payload = {k: v for k, v in all_results.items() if not k.startswith("_")}
    if partial:
        payload["_partial"] = True
    payload["_summary"] = summary
    _atomic_write(out_dir / "results.json", json.dumps(payload, indent=2))
    write_summary_markdown(payload, keys, out_dir / "results_summary.md")


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def run_for_image(
    image_path: Path,
    keys: list[str],
    config: dict,
    clients: dict,
    failures: list,
    fan_out: int | None,
    prior: dict | None = None,
    sink: dict | None = None,
    on_result=None,
    contract: contract_lib.Contract | None = None,
) -> dict:
    """Run every approach for one image, checkpointing through `on_result` as each lands.

    `prior` holds already-recorded results for this image. Those approaches are skipped
    **without re-calling the model** -- deliberately, not as an optimization: a re-run would
    hit llama.cpp's warm prompt-prefix cache and come back ~10x faster than the cold number
    it is replacing, silently corrupting the latency distribution (PERFORMANCE.md §6).

    `sink` is the run-wide results dict; this image's entry is installed in it up front and
    mutated in place, so `on_result` can checkpoint the whole run after each result.
    """
    image_id = image_path.stem
    prior = dict(prior or {})
    todo = [k for k in keys if k not in prior]
    # keys order first, then any prior approaches outside this run's key set (never dropped).
    per_image: dict = {k: prior.pop(k) for k in keys if k in prior}
    per_image.update(prior)
    if sink is not None:
        sink[image_id] = per_image
    for key in keys:
        if key in per_image:
            print(f"[{image_id}] {key}: already done, skipping (resume)")

    if not todo:
        return per_image

    print(f"[{image_id}] loading image...")
    image_data_url, image_info = load_image(image_path, config, contract)

    models = config.get("models") or {}
    declared = config.get("approaches") or {}

    for key in todo:
        approach_cfg = declared[key]
        label = approach_cfg.get("label") or approach_cfg.get("type", "single")
        print(f"[{image_id}] {key} ({label})...")
        t0 = time.monotonic()
        try:
            per_image[key] = approach_lib.run_approach(
                key,
                approach_cfg,
                image_data_url,
                models,
                clients,
                fan_out,
                contract=contract,
                image_info=image_info,
            )
        except Exception as e:  # noqa: BLE001 - eval harness: record and continue
            print(f"[{image_id}] {key} FAILED: {e}")
            failures.append({"image_id": image_id, "approach": key, "error": str(e)})
            per_image[key] = {"error": str(e)}
        mem_available = _meminfo_mb("MemAvailable")
        if isinstance(per_image[key], dict) and mem_available is not None:
            per_image[key]["mem_available_mb_after"] = mem_available
        print(f"[{image_id}] {key} done in {time.monotonic() - t0:.1f}s")
        if on_result is not None:
            on_result(image_id, key)

    return per_image


def load_image(
    image_path: Path, config: dict, contract: contract_lib.Contract | None
) -> tuple[str, dict | None]:
    """The photo as a data URL, plus what was done to it.

    `image_resize: "production"` in the config means the app's own resize (longest side 1600 px, JPEG quality
    0.85, taken from the contract) for EVERY approach in the run, so an old-prompt cell and a new-prompt cell send
    the same bytes and differ only in the prompt. Without it, the older `image_max_long_edge` knob applies.
    """
    if config.get("image_resize") == "production":
        if contract is None:
            raise SystemExit("ERROR: image_resize is 'production' but no vision contract was loaded")
        return production.production_image_data_url(image_path, contract.photo_constraints)
    return providers.image_to_data_url(image_path, max_long_edge=config.get("image_max_long_edge")), None


def run_for_case(
    case: dict,
    key: str,
    config: dict,
    clients: dict,
    failures: list,
    prior: dict | None,
    sink: dict,
    on_result,
    contract: contract_lib.Contract,
) -> None:
    """Run one case-based approach on one JSONL case, with the same resume and checkpoint rules as images."""
    case_id = case["id"]
    per_case = sink.setdefault(case_id, dict(prior or {}))
    if key in per_case:
        print(f"[{case_id}] {key}: already done, skipping (resume)")
        return
    approach_cfg = (config.get("approaches") or {})[key]
    print(f"[{case_id}] {key} ({approach_cfg.get('label') or approach_cfg.get('type')})...")
    started = time.monotonic()
    try:
        per_case[key] = approach_lib.run_case_approach(
            key, approach_cfg, case, config.get("models") or {}, clients, contract
        )
    except Exception as e:  # noqa: BLE001 - eval harness: record and continue
        print(f"[{case_id}] {key} FAILED: {e}")
        failures.append({"image_id": case_id, "approach": key, "error": str(e)})
        per_case[key] = {"error": str(e)}
    print(f"[{case_id}] {key} done in {time.monotonic() - started:.1f}s")
    on_result(case_id, key)


# ---------------------------------------------------------------------------
# `check-labels`: corpus/label self-check
# ---------------------------------------------------------------------------


def _check_labels_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python3 -m harness.runner check-labels",
        description=(
            "Corpus self-check: image<->gold parity, manifest licence/provenance coverage, "
            "difficulty tags, trap plates, gram-range coverage. Exits non-zero on any FAIL."
        ),
    )
    parser.add_argument("--images-dir", type=Path, default=None)
    parser.add_argument("--gold", type=Path, default=None)
    parser.add_argument("--manifest", type=Path, default=None)
    parser.add_argument(
        "--min-images", type=int, default=45, help="Minimum corpus size (default 45)."
    )
    parser.add_argument(
        "--min-difficulty-tagged",
        type=int,
        default=40,
        help="Minimum manifest entries carrying difficulty_tags (default 40 -- the 10 pilot "
        "images predate the field).",
    )
    parser.add_argument(
        "--min-traps", type=int, default=8, help="Minimum gold entries with a `trap` (default 8)."
    )
    parser.add_argument(
        "--require-grams",
        action="store_true",
        help="Make missing weighed-gram ground truth a FAIL instead of a TODO. Off by default: "
        "grams are a known open item (M138 spec 01) and a permanently red self-check is a "
        "self-check nobody runs.",
    )
    return parser


def check_labels(argv: list[str]) -> int:
    """The coverage one-liners that used to live in the spec's verification checklist."""
    args = _check_labels_parser().parse_args(argv)
    eval_root = Path(__file__).resolve().parent.parent
    images_dir = args.images_dir or (eval_root / "images")
    gold_path = args.gold or (eval_root / "gold" / "gold_labels.json")
    manifest_path = args.manifest or (images_dir / "manifest.json")

    rows: list[tuple[str, str, str]] = []  # (status, check, detail)

    def add(ok: bool | None, check: str, detail: str) -> None:
        rows.append(("PASS" if ok else ("TODO" if ok is None else "FAIL"), check, detail))

    if not images_dir.is_dir():
        print(f"ERROR: images dir not found: {images_dir}", file=sys.stderr)
        return 2
    image_ids = sorted(
        p.stem for p in images_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )
    add(
        len(image_ids) >= args.min_images,
        "corpus size",
        f"{len(image_ids)} images in {images_dir.name}/ (min {args.min_images})",
    )

    try:
        gold = json.loads(gold_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR: cannot read gold labels {gold_path}: {e}", file=sys.stderr)
        return 2
    gold_keys = sorted(k for k in gold if not k.startswith("_"))

    missing_gold = sorted(set(image_ids) - set(gold_keys))
    orphan_gold = sorted(set(gold_keys) - set(image_ids))
    add(
        not missing_gold and not orphan_gold,
        "image <-> gold key parity",
        f"{len(gold_keys)} gold entries"
        + (f"; images without gold: {missing_gold}" if missing_gold else "")
        + (f"; gold without image: {orphan_gold}" if orphan_gold else ""),
    )

    empty_core = [k for k in gold_keys if not (gold[k].get("core") or [])]
    core_total = sum(len(gold[k].get("core") or []) for k in gold_keys)
    add(
        not empty_core,
        "every gold entry has core items",
        f"{core_total} core items total"
        + (f"; empty: {empty_core}" if empty_core else f", mean {core_total / max(len(gold_keys), 1):.1f}/plate"),
    )

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR: cannot read manifest {manifest_path}: {e}", file=sys.stderr)
        return 2
    no_licence = [e.get("id") or e.get("commons_title") for e in manifest if not e.get("license")]
    no_source = [e.get("id") or e.get("commons_title") for e in manifest if not e.get("source_url")]
    add(
        len(manifest) >= len(image_ids) and not no_licence and not no_source,
        "manifest licence + source_url",
        f"{len(manifest)} entries for {len(image_ids)} images"
        + (f"; missing license: {no_licence}" if no_licence else "")
        + (f"; missing source_url: {no_source}" if no_source else ""),
    )

    tagged = sum(1 for e in manifest if e.get("difficulty_tags") is not None)
    add(
        tagged >= args.min_difficulty_tagged,
        "difficulty_tags coverage",
        f"{tagged}/{len(manifest)} entries tagged (min {args.min_difficulty_tagged})",
    )

    traps = [k for k in gold_keys if gold[k].get("trap")]
    add(
        len(traps) >= args.min_traps,
        "adversarial trap plates",
        f"{len(traps)} flagged (min {args.min_traps}): {', '.join(traps)}",
    )

    with_grams = [k for k in gold_keys if gold[k].get("gram_ranges") or gold[k].get("grams")]
    with_kcal = [k for k in gold_keys if gold[k].get("kcal_range")]
    grams_ok = len(with_grams) >= len(image_ids) if args.require_grams else (
        True if with_grams else None
    )
    add(
        grams_ok,
        "weighed-gram ground truth",
        f"gram ranges on {len(with_grams)}/{len(image_ids)} images, kcal ranges on "
        f"{len(with_kcal)}/{len(image_ids)} -- portion/macro metrics are "
        + ("scorable" if with_grams else "UNSCORABLE (needs a scale, not a labeller's guess)"),
    )

    width = max(len(check) for _, check, _ in rows)
    print(f"{'status':<6}  {'check':<{width}}  detail")
    print(f"{'-' * 6}  {'-' * width}  {'-' * 40}")
    for status, check, detail in rows:
        print(f"{status:<6}  {check:<{width}}  {detail}")

    failed = [check for status, check, _ in rows if status == "FAIL"]
    todo = [check for status, check, _ in rows if status == "TODO"]
    print()
    print(
        f"{len(rows) - len(failed) - len(todo)} pass, {len(todo)} todo, {len(failed)} fail"
        + (f" -> {failed}" if failed else "")
    )
    return 1 if failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python3 -m harness.runner",
        description=(
            "Run a plate-identification eval config over the image corpus. "
            "Subcommand: `check-labels` (corpus/label self-check)."
        ),
    )
    parser.add_argument("--config", type=Path, required=True, help="Path to a JSON eval config.")
    parser.add_argument(
        "--only",
        action="append",
        default=None,
        metavar="IMAGE_ID",
        help="Only this image id (e.g. 03). Repeatable.",
    )
    parser.add_argument(
        "--approach",
        action="append",
        default=None,
        metavar="KEY",
        help="Only this approach key from the config. Repeatable.",
    )
    parser.add_argument("--out", type=Path, default=None, help="Output directory for this run.")
    parser.add_argument(
        "--images-dir", type=Path, default=None, help="Override the config's images_dir."
    )
    parser.add_argument(
        "--fan-out",
        type=int,
        default=None,
        metavar="N",
        help="Ablation: truncate ensemble approaches to the first N prompt variants.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Discard any prior results in the output dir and start over (default is to resume).",
    )
    parser.add_argument(
        "--retry-errors",
        action="store_true",
        help=(
            "Resume, but re-run the recorded calls that failed in transit: HTTP 429, any 5xx, no HTTP status, or "
            "an `error` with no `kind`. Every other record is kept as it is. Without this flag a resume skips "
            "every record, errors included. Ignored with --force."
        ),
    )
    parser.add_argument(
        "--min-avail-mb",
        type=int,
        default=0,
        metavar="MB",
        help=(
            "Mid-run memory guard: before each image, pause (re-checking every 60s) while "
            "MemAvailable is below this many MB, and abort the run after 60 min of waiting. "
            "0 (default) disables the guard."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Resolve config, images and providers, print the first request body of every approach "
            "(photo bytes shown as a length), check the production ones against the vision contract, "
            "then exit without calling any model. Needs no API key."
        ),
    )
    parser.add_argument(
        "--cases",
        type=Path,
        default=None,
        metavar="JSONL",
        help=(
            "JSONL file of cases for the text and recipe approaches (`single_text`: input, lang; "
            "`recipe`: lang, slot, pantry, remaining_day_block). Overrides an approach's own `cases`."
        ),
    )
    parser.add_argument(
        "--allow-stale-contract",
        action="store_true",
        help=(
            "Run although the app sources changed since generated/vision-contract.json was written. "
            "The run records that it did. Default: refuse, and print how to regenerate."
        ),
    )
    return parser


def resolve_cases(
    approach_cfg: dict, args: argparse.Namespace, eval_root: Path, contract: contract_lib.Contract
) -> tuple[Path | None, list[dict] | None]:
    """The cases file of a case-based approach and its parsed cases (None when the file is not there)."""
    declared = args.cases if args.cases is not None else approach_cfg.get("cases")
    if declared is None:
        raise SystemExit(
            "ERROR: a text or recipe approach needs a cases file: set `cases` on the approach or pass --cases"
        )
    path = resolve_path(eval_root, str(declared))
    kind = "recipe" if approach_cfg.get("type") == "recipe" else "text"
    if not path.is_file():
        return path, None
    return path, production.load_cases(path, kind=kind, languages=contract.languages)


def dry_run_report(
    keys: list[str],
    config: dict,
    args: argparse.Namespace,
    eval_root: Path,
    images: list[Path],
    contract: contract_lib.Contract | None,
) -> int:
    """Print the first request body of each approach, checked against the contract. Sends nothing.

    Returns 1 when a production approach's body departs from the contract or cannot be built, else 0.
    """
    declared = config.get("approaches") or {}
    models = config.get("models") or {}
    problems_total = 0
    first_image: tuple[str, dict | None] | None = None
    for key in keys:
        approach_cfg = declared[key]
        kind = approach_cfg.get("type", "single")
        model_cfg = models.get(approach_cfg.get("model") or approach_cfg.get("vision_model") or "", {})
        print()
        print(f"--- {key} ({kind}) model={model_cfg.get('id')} ---")
        language = approach_cfg.get("language", "en")
        try:
            if approach_lib.approach_unit(approach_cfg) == "image":
                if first_image is None and images:
                    first_image = load_image(images[0], config, contract)
                if first_image is None:
                    print("no image to build a request from")
                    continue
                if first_image[1]:
                    print(f"image {images[0].name}: {json.dumps(first_image[1])}")
                body = approach_lib.preview_first_request(
                    key, approach_cfg, models, contract=contract, image_data_url=first_image[0]
                )
            else:
                path, cases = resolve_cases(approach_cfg, args, eval_root, contract)
                if cases is None:
                    print(f"cases file not found yet: {path}. No request body to preview for this approach.")
                    continue
                print(f"cases: {len(cases)} in {path}; previewing {cases[0]['id']}")
                language = cases[0]["lang"]
                body = approach_lib.preview_first_request(key, approach_cfg, models, contract=contract, case=cases[0])
        except SystemExit as e:
            print(f"cannot build the request: {e}")
            problems_total += 1
            continue
        if body is None:
            print(f"(no request preview for approach type {kind!r})")
            continue
        print(production.format_body(body))
        if kind not in approach_lib.CONTRACT_APPROACH_TYPES or contract is None:
            continue
        task_key = production.approach_task(approach_cfg)
        problems = production.check_request_body(body, contract, model_cfg, task_key, language)
        if problems:
            problems_total += len(problems)
            print("contract check: FAILED")
            for problem in problems:
                print(f"  - {problem}")
        else:
            print(f"contract check: ok (task {task_key}, language {language}, the body matches the contract)")
    return 1 if problems_total else 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] in {"check-labels", "check_labels"}:
        return check_labels(argv[1:])

    args = build_parser().parse_args(argv)
    config, eval_root = load_config(args.config)
    declared = config.get("approaches") or {}

    keys = approach_keys(config)
    if args.approach:
        unknown = [k for k in args.approach if k not in declared]
        if unknown:
            raise SystemExit(f"ERROR: unknown approach(es) {unknown}; config declares {sorted(declared)}")
        # An approach declared but left out of `approach_order` (a text approach whose cases file does not
        # exist yet, say) can still be named on the command line.
        keys = [k for k in keys if k in set(args.approach)] + [k for k in args.approach if k not in keys]

    image_keys = [k for k in keys if approach_lib.approach_unit(declared[k]) == "image"]
    case_keys = [k for k in keys if approach_lib.approach_unit(declared[k]) == "case"]

    contract: contract_lib.Contract | None = None
    needs_contract = config.get("image_resize") == "production" or any(
        declared[k].get("type") in approach_lib.CONTRACT_APPROACH_TYPES for k in keys
    )
    if needs_contract:
        contract = contract_lib.load_contract(
            resolve_path(eval_root, config.get("contract", contract_lib.DEFAULT_CONTRACT_PATH))
        )
        contract_lib.assert_fresh(contract, eval_root, allow_stale=args.allow_stale_contract)
    for k in image_keys:
        if declared[k].get("type") == "production" and config.get("image_resize") != "production":
            raise SystemExit(
                f'ERROR: approach {k!r} is `production` but the config does not set `"image_resize": "production"`. '
                "The production request carries the app's 1600 px JPEG, so the whole run must send it."
            )

    images: list[Path] = []
    if image_keys:
        images_dir = (
            args.images_dir
            if args.images_dir is not None
            else resolve_path(eval_root, config.get("images_dir", "images"))
        )
        images = discover_images(images_dir, args.only)
    else:
        images_dir = None

    run_name = config.get("name") or args.config.stem
    default_out = config.get("out_dir") or f"runs/{datetime.date.today().isoformat()}-{run_name}"
    out_dir = args.out if args.out is not None else resolve_path(eval_root, default_out)
    results_path = out_dir / "results.json"

    # Resume is the default: a prior results.json (partial or complete) is loaded and its
    # image x approach pairs are skipped. --force throws it away and starts from scratch.
    prior_results: dict = {}
    prior_failures: list = []
    if results_path.exists():
        if args.force:
            print(f"--force: discarding prior results at {results_path}")
        else:
            prior_results, prior_failures = load_prior_results(results_path)
            done = sum(len(v) for v in prior_results.values())
            print(f"resume: {done} prior image x approach result(s) loaded from {results_path}")
    if args.retry_errors and args.force:
        print("--retry-errors has no effect with --force: everything runs again")

    print(f"config: {args.config} (eval root {eval_root})")
    if image_keys:
        print(f"images: {len(images)} in {images_dir}: {[p.name for p in images]}")
    print(f"approaches: {keys}")
    print(f"output: {out_dir}")
    if contract is not None:
        print(f"contract: {contract.path} (freshness: {json.dumps(contract.freshness)})")

    clients = providers.build_clients(config.get("providers") or {}, dry_run=args.dry_run)
    providers.preflight(clients)

    if args.dry_run:
        status = dry_run_report(keys, config, args, eval_root, images, contract)
        print()
        print(
            "dry run: config, images and providers resolved; no model calls made."
            + (" CONTRACT CHECK FAILED." if status else "")
        )
        return status

    # Case files are read up front, so a bad line stops the run before the first paid call.
    case_sets: dict[str, list[dict]] = {}
    case_files: dict[str, str] = {}
    for k in case_keys:
        path, cases = resolve_cases(declared[k], args, eval_root, contract)
        if cases is None:
            raise SystemExit(f"ERROR: cases file for approach {k!r} not found: {path}")
        case_sets[k] = cases
        case_files[k] = str(path)
    seen_ids = {p.stem for p in images}
    for k, cases in case_sets.items():
        clash = sorted(seen_ids & {c["id"] for c in cases})
        if clash:
            raise SystemExit(f"ERROR: case ids {clash} of approach {k!r} are also image ids; rename the cases")

    if args.retry_errors and prior_results:
        image_ids = {p.stem for p in images}
        case_ids = {k: {c["id"] for c in cases} for k, cases in case_sets.items()}

        def in_scope(image_id: str, key: str) -> bool:
            if key in case_ids:
                return image_id in case_ids[key]
            return key in image_keys and image_id in image_ids

        prior_results, prior_failures, dropped = drop_retryable(prior_results, prior_failures, in_scope)
        print(f"retry-errors: {len(dropped)} failed record(s) will run again: {dropped}")

    out_dir.mkdir(parents=True, exist_ok=True)

    started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    wall_t0 = time.monotonic()
    # Seed with every prior image entry, including images outside this invocation's --only
    # selection, so a narrowed resume never truncates the file it is appending to.
    all_results: dict = {k: dict(v) for k, v in prior_results.items()}
    failures: list = list(prior_failures)

    summary_extra: dict = {}
    if contract is not None:
        summary_extra["contract"] = {
            "path": str(contract.path),
            "generatedFrom": contract.data.get("generatedFrom"),
            "freshness": contract.freshness,
        }
    if case_files:
        summary_extra["case_files"] = case_files
        summary_extra["case_counts"] = {k: len(v) for k, v in case_sets.items()}
    if config.get("image_resize"):
        summary_extra["image_resize"] = config["image_resize"]

    def summarize() -> tuple[dict, float, dict]:
        return build_summary(
            all_results,
            keys,
            config,
            args,
            run_name,
            images,
            failures,
            started_at,
            wall_t0,
            extra=summary_extra,
        )

    def on_result(image_id: str, key: str) -> None:
        summary, _, _ = summarize()
        checkpoint(all_results, keys, out_dir, summary, partial=True)

    image_selected = [k for k in keys if k in image_keys]
    for image_path in images:
        wait_for_memory(args.min_avail_mb)
        run_for_image(
            image_path,
            image_selected,
            config,
            clients,
            failures,
            args.fan_out,
            prior=prior_results.get(image_path.stem),
            sink=all_results,
            on_result=on_result,
            contract=contract,
        )

    for k in case_keys:
        for case in case_sets[k]:
            wait_for_memory(args.min_avail_mb)
            run_for_case(
                case,
                k,
                config,
                clients,
                failures,
                prior_results.get(case["id"]),
                all_results,
                on_result,
                contract,
            )

    summary, total_cost, per_approach_cost = summarize()
    failures = summary["failures"]
    checkpoint(all_results, keys, out_dir, summary, partial=False)
    print(f"Wrote {results_path}")
    print(f"Wrote {out_dir / 'results_summary.md'}")

    print(f"Total cost: ${total_cost:.4f}")
    print(f"Per-approach cost: {json.dumps(per_approach_cost, indent=2)}")
    if failures:
        print(f"Failures: {len(failures)} -- see results.json._summary.failures")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
