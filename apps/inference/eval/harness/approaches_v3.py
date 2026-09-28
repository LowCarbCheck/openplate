"""Pipeline v3 approaches: `single_v3` and `ensemble_judge_v3`.

`approaches.run_approach` dispatches the `single_v3` / `ensemble_judge_v3` kinds
to this module; nothing else imports it.

Why a separate module rather than edits to `approaches.py`: v3 changes the
*candidate* contract (terse JSON, background flag, image-first message order),
so a v3 vision call cannot go through `providers.complete_plate_identification`
— that helper validates the production plate contract and nudge-retries against
it. Keeping v3 here means `approaches.py` needs only the dispatch, and v2 rows
stay byte-identical for comparison runs.

Result shapes are deliberately unchanged from v2, so `scorecard.py` and
`runner.write_summary_markdown` work untouched:

  single_v3          -> {foods, notes, latency_ms, cost_usd, raw_ok,
                         prompt_tokens, completion_tokens, raw_text, ...}
  ensemble_judge_v3  -> {final{foods,notes,raw_ok}, candidates[],
                         judge_latency_ms, total_latency_ms, total_cost_usd, ...}

v3-only diagnostics are added alongside (never in place of) those keys:
`background_items_dropped`, `terse_items`, `shared_prefix`.
"""

from __future__ import annotations

import concurrent.futures
import time

from . import providers
from . import schema_v3


def _model(models: dict, key: str) -> dict:
    """Local copy of approaches._model — importing `approaches` from here would
    close an import cycle once `approaches` dispatches into this module."""
    if key not in models:
        raise KeyError(f"unknown model key {key!r}; declared: {sorted(models)}")
    cfg = models[key]
    if "id" not in cfg:
        raise ValueError(f"model {key!r} is missing 'id'")
    return cfg


def _client_for(model_cfg: dict, clients: dict) -> providers.ChatClient:
    provider_name = model_cfg.get("provider")
    if provider_name not in clients:
        raise KeyError(
            f"model {model_cfg.get('id')!r} names provider {provider_name!r}, "
            f"which is not declared in the config's 'providers' (have: {sorted(clients)})"
        )
    return clients[provider_name]


# ---------------------------------------------------------------------------
# Terse vision call
# ---------------------------------------------------------------------------


def complete_terse_candidate(
    client: providers.ChatClient,
    model_cfg: dict,
    messages: list,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> dict:
    """One terse vision call, plus one nudge retry when the reply doesn't parse.

    Returns the v2 candidate shape (`foods` in production wire form so the
    scorecard can read it) PLUS the terse payload and the background-drop count.
    """
    model = model_cfg["id"]
    use_json_schema = model_cfg.get("use_json_schema", True)
    if max_tokens is None:
        max_tokens = model_cfg.get("max_tokens_v3", schema_v3.V3_VISION_MAX_TOKENS)
    if temperature is None:
        temperature = model_cfg.get("temperature")
    extra_body = model_cfg.get("extra_body")

    try:
        resp, latency_ms = client.chat_once(
            model,
            messages,
            temperature,
            use_json_schema,
            max_tokens,
            extra_body,
            schema_v3.TERSE_JSON_SCHEMA_RESPONSE_FORMAT,
        )
    except Exception as e:  # noqa: BLE001 - eval harness: surface every failure
        failed = providers.failed_result(f"call failed: {e}")
        failed.update({"terse": None, "terse_items": 0, "background_items_dropped": 0})
        return failed

    content = providers.extract_content(resp)
    usage = providers.extract_usage(resp)
    parsed, ok, errors = schema_v3.parse_terse_candidate(content)
    error: str | None = None

    if not ok:
        nudge_messages = list(messages) + [
            {"role": "assistant", "content": content or ""},
            {"role": "user", "content": schema_v3.TERSE_SCHEMA_NUDGE_USER_MESSAGE},
        ]
        try:
            resp2, latency_ms2 = client.chat_once(
                model,
                nudge_messages,
                temperature,
                use_json_schema,
                max_tokens,
                extra_body,
                schema_v3.TERSE_JSON_SCHEMA_RESPONSE_FORMAT,
            )
            latency_ms += latency_ms2
            usage = providers.merge_usage(usage, providers.extract_usage(resp2))
            content2 = providers.extract_content(resp2)
            parsed2, ok2, errors2 = schema_v3.parse_terse_candidate(content2)
            if ok2:
                content, parsed, ok = content2, parsed2, ok2
            else:
                error = f"terse schema validation failed twice: {errors2}"
        except Exception as e:  # noqa: BLE001
            error = f"nudge retry failed: {e}"
    if not ok and error is None:
        error = f"terse schema validation failed: {errors}"

    terse = parsed if ok else None
    filtered, dropped = schema_v3.drop_background_items(terse or {"f": []})
    result = {
        # production wire form, so scorecard.py / results_summary.md need no change
        "foods": schema_v3.terse_items_to_wire_foods(filtered.get("f")) if ok else [],
        "notes": None,
        "latency_ms": latency_ms,
        "cost_usd": providers.compute_cost_usd(model_cfg, usage),
        "raw_ok": ok,
        "prompt_tokens": usage.get("prompt_tokens", 0) or 0,
        "completion_tokens": usage.get("completion_tokens", 0) or 0,
        "raw_text": None if ok else content,
        # v3 diagnostics
        "terse": filtered if ok else None,
        "terse_items": len(filtered.get("f") or []) if ok else 0,
        "background_items_dropped": dropped,
    }
    if error and not ok:
        result["error"] = error
    return result


# ---------------------------------------------------------------------------
# single_v3
# ---------------------------------------------------------------------------


def single_v3(image_data_url: str, model_cfg: dict, clients: dict) -> dict:
    """One terse vision call, converted to the wire contract in code.

    No judge, so no merge — `confidence` is a flat "medium" and `portionHint` /
    `macrosPer100g` are null (see schema_v3.terse_items_to_wire_foods on why not
    fabricated). This is the cheapest v3 row and the one closest to the 10 s SLO.
    """
    client = _client_for(model_cfg, clients)
    variant = schema_v3.V3_VARIANTS["a3_production"]
    messages = schema_v3.build_v3_vision_messages(variant["user_instruction"], image_data_url)
    result = complete_terse_candidate(client, model_cfg, messages)
    result["model"] = model_cfg["id"]
    result["pipeline"] = "v3"
    return result


# ---------------------------------------------------------------------------
# ensemble_judge_v3
# ---------------------------------------------------------------------------


def _run_variant_v3(
    variant: dict, image_data_url: str, model_cfg: dict, clients: dict
) -> dict:
    client = _client_for(model_cfg, clients)
    messages = schema_v3.build_v3_vision_messages(variant["user_instruction"], image_data_url)
    result = complete_terse_candidate(
        client, model_cfg, messages, temperature=variant.get("temperature")
    )
    result["variant_id"] = variant["id"]
    return result


def _run_judge_v3(
    candidates: list[dict],
    judge_cfg: dict,
    clients: dict,
    temperature: float | None = None,
    max_tokens: int | None = None,
    with_macros: bool = schema_v3.V3_JUDGE_MACROS_DEFAULT,
) -> dict:
    """The merge call. Terse `name=grams` lines in, production contract out."""
    client = _client_for(judge_cfg, clients)
    terse_candidates = [
        {"f": (c.get("terse") or {}).get("f") or [], "variant_id": c.get("variant_id")}
        for c in candidates
    ]
    messages = providers.build_text_messages(
        schema_v3.build_v3_judge_system_prompt(len(candidates), with_macros),
        schema_v3.build_v3_judge_user_text(terse_candidates),
    )
    if temperature is None:
        # same reasoning as v2: merging is bookkeeping, sampling variance is
        # pure downside (schema.DEFAULT_JUDGE_TEMPERATURE).
        temperature = 0.0
    if max_tokens is None:
        max_tokens = schema_v3.v3_judge_max_tokens(with_macros)
    return providers.complete_plate_identification(
        client,
        judge_cfg,
        messages,
        temperature=temperature,
        max_tokens=max_tokens,
        response_format=schema_v3.v3_judge_response_format(with_macros),
    )


def ensemble_judge_v3(
    image_data_url: str,
    vision_cfg: dict,
    judge_cfg: dict,
    variants: list[dict],
    clients: dict,
    max_parallel: int = 1,
    judge_temperature: float | None = None,
    judge_max_tokens: int | None = None,
    judge_macros: bool = schema_v3.V3_JUDGE_MACROS_DEFAULT,
) -> dict:
    """N terse vision calls + one judge merge.

    `max_parallel` defaults to **1**, unlike v2's 5. That is not a throughput
    concession, it is the point: v3 shares the `system + image` prefix across the
    fan-out, and llama.cpp's prompt cache is per KV slot, so sequential requests
    reuse the cached image while concurrent ones land in different slots and
    re-prefill it. Sequential is *faster* here.
    """
    if not variants:
        raise ValueError("ensemble_judge_v3 needs at least one variant")
    workers = max(1, min(int(max_parallel or 1), len(variants)))
    wall_t0 = time.monotonic()

    if workers == 1:
        candidates = [_run_variant_v3(v, image_data_url, vision_cfg, clients) for v in variants]
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [
                executor.submit(_run_variant_v3, v, image_data_url, vision_cfg, clients)
                for v in variants
            ]
            candidates = [f.result() for f in futures]

    judge_result = _run_judge_v3(
        candidates, judge_cfg, clients, judge_temperature, judge_max_tokens, judge_macros
    )
    wall_latency_ms = (time.monotonic() - wall_t0) * 1000

    total_cost = sum(c["cost_usd"] for c in candidates) + judge_result["cost_usd"]
    prompt_tokens = sum(c["prompt_tokens"] for c in candidates) + judge_result["prompt_tokens"]
    completion_tokens = (
        sum(c["completion_tokens"] for c in candidates) + judge_result["completion_tokens"]
    )

    return {
        "final": {
            "foods": judge_result["foods"],
            "notes": judge_result["notes"],
            "raw_ok": judge_result["raw_ok"],
        },
        "candidates": candidates,
        "judge_latency_ms": judge_result["latency_ms"],
        "total_latency_ms": wall_latency_ms,
        "total_cost_usd": total_cost,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "fan_out": len(variants),
        "max_parallel": workers,
        "vision_model": vision_cfg["id"],
        "judge_model": judge_cfg["id"],
        "judge_temperature": 0.0 if judge_temperature is None else judge_temperature,
        "judge_max_tokens": (
            schema_v3.v3_judge_max_tokens(judge_macros)
            if judge_max_tokens is None
            else judge_max_tokens
        ),
        "judge_macros": judge_macros,
        "pipeline": "v3",
        "shared_prefix": workers == 1,
        "background_items_dropped": sum(
            c.get("background_items_dropped", 0) for c in candidates
        ),
    }


# ---------------------------------------------------------------------------
# Dispatch (called from approaches.run_approach after the registration diff)
# ---------------------------------------------------------------------------


def run_approach_v3(
    kind: str,
    approach_cfg: dict,
    image_data_url: str,
    models: dict,
    clients: dict,
    fan_out_override: int | None = None,
) -> dict:
    if kind == "single_v3":
        return single_v3(image_data_url, _model(models, approach_cfg["model"]), clients)

    if kind == "ensemble_judge_v3":
        vision_cfg = _model(models, approach_cfg["vision_model"])
        judge_cfg = _model(models, approach_cfg.get("judge_model", approach_cfg["vision_model"]))
        variants = schema_v3.resolve_v3_variants(approach_cfg.get("variants"))
        if fan_out_override is not None:
            if fan_out_override < 1:
                raise ValueError("--fan-out must be >= 1")
            if fan_out_override > len(variants):
                raise ValueError(
                    f"--fan-out {fan_out_override} exceeds the {len(variants)} variants "
                    "configured for this v3 approach"
                )
            variants = variants[:fan_out_override]
        return ensemble_judge_v3(
            image_data_url,
            vision_cfg,
            judge_cfg,
            variants,
            clients,
            max_parallel=approach_cfg.get("max_parallel", 1),
            judge_temperature=approach_cfg.get("judge_temperature"),
            judge_max_tokens=approach_cfg.get("judge_max_tokens"),
            judge_macros=approach_cfg.get(
                "judge_macros", schema_v3.V3_JUDGE_MACROS_DEFAULT
            ),
        )

    raise ValueError(f"approaches_v3 cannot handle approach type {kind!r}")
