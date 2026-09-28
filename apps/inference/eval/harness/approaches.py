"""The approaches under test: single call, and ensemble fan-out + judge merge.

Approach configs (from the eval config file) look like:

  {"type": "single", "model": "<model key>"}

  {"type": "ensemble_judge",
   "vision_model": "<model key>",
   "judge_model":  "<model key>",
   "variants": ["a_production", "b_production_hot", ...],
   "max_parallel": 5,
   "judge_temperature": 0,      # optional; default 0 (deterministic merge)
   "judge_max_tokens": 1024}    # optional; overrides the judge model's max_tokens

`max_parallel` matters: on a CPU host llama.cpp effectively serialises
concurrent generations against one model instance, so fan-out costs wall clock
rather than hiding behind it (M138 counsel). Cloud runs use 5, local 1-2.
"""

from __future__ import annotations

import concurrent.futures
import time

from . import providers
from . import approaches_v3
from . import schema as plate_schema


def _client_for(model_cfg: dict, clients: dict) -> providers.ChatClient:
    provider_name = model_cfg.get("provider")
    if provider_name not in clients:
        raise KeyError(
            f"model {model_cfg.get('id')!r} names provider {provider_name!r}, "
            f"which is not declared in the config's 'providers' (have: {sorted(clients)})"
        )
    return clients[provider_name]


def single(image_data_url: str, model_cfg: dict, clients: dict) -> dict:
    """One production-prompt vision call. Result shape == pilot's per-approach
    dict: foods, notes, latency_ms, cost_usd, raw_ok, tokens, raw_text."""
    client = _client_for(model_cfg, clients)
    messages = providers.build_vision_messages(
        plate_schema.PLATE_IDENTIFICATION_SYSTEM_PROMPT,
        plate_schema.PRODUCTION_USER_PROMPT,
        image_data_url,
    )
    result = providers.complete_plate_identification(client, model_cfg, messages)
    result["model"] = model_cfg["id"]
    return result


def _run_variant(variant: dict, image_data_url: str, model_cfg: dict, clients: dict) -> dict:
    client = _client_for(model_cfg, clients)
    messages = providers.build_vision_messages(
        variant["system_prompt"], plate_schema.PRODUCTION_USER_PROMPT, image_data_url
    )
    result = providers.complete_plate_identification(
        client, model_cfg, messages, temperature=variant.get("temperature")
    )
    result["variant_id"] = variant["id"]
    return result


def _run_judge(
    candidates: list[dict],
    judge_cfg: dict,
    clients: dict,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> dict:
    """The merge call.

    Two deliberate differences from a vision call (M138 judge hardening):
      * temperature defaults to 0 — merging is bookkeeping, and the measured
        failure mode was variance (a real item kept on one run, dropped on the
        next), so sampling diversity is pure downside here.
      * the response_format carries the bounded judge schema, which makes the
        <= 6-item rule a decoding constraint rather than a request.
    """
    client = _client_for(judge_cfg, clients)
    messages = providers.build_text_messages(
        plate_schema.build_judge_system_prompt(len(candidates)),
        plate_schema.build_judge_user_text(candidates),
    )
    if temperature is None:
        temperature = plate_schema.DEFAULT_JUDGE_TEMPERATURE
    return providers.complete_plate_identification(
        client,
        judge_cfg,
        messages,
        temperature=temperature,
        max_tokens=max_tokens,
        response_format=plate_schema.JUDGE_JSON_SCHEMA_RESPONSE_FORMAT,
    )


def ensemble_judge(
    image_data_url: str,
    vision_cfg: dict,
    judge_cfg: dict,
    variants: list[dict],
    clients: dict,
    max_parallel: int = 5,
    judge_temperature: float | None = None,
    judge_max_tokens: int | None = None,
) -> dict:
    """N diverse-prompt vision calls (fan-out `max_parallel` at a time), then a
    text-only judge call that merges the candidates.

    Returns the pilot's ensemble shape: final{foods,notes,raw_ok}, candidates[],
    judge_latency_ms, total_latency_ms, total_cost_usd (plus token totals and
    the model ids actually used).
    """
    if not variants:
        raise ValueError("ensemble_judge needs at least one variant")
    workers = max(1, min(int(max_parallel or 1), len(variants)))
    wall_t0 = time.monotonic()

    if workers == 1:
        candidates = [_run_variant(v, image_data_url, vision_cfg, clients) for v in variants]
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [
                executor.submit(_run_variant, v, image_data_url, vision_cfg, clients)
                for v in variants
            ]
            candidates = [f.result() for f in futures]

    judge_result = _run_judge(
        candidates, judge_cfg, clients, judge_temperature, judge_max_tokens
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
        "judge_temperature": (
            plate_schema.DEFAULT_JUDGE_TEMPERATURE
            if judge_temperature is None
            else judge_temperature
        ),
        "judge_max_tokens": judge_max_tokens,
    }
    # NOTE: judge failures surface as final.raw_ok == False with empty foods,
    # matching the pilot; the candidates are still recorded for inspection.


def run_approach(
    approach_key: str,
    approach_cfg: dict,
    image_data_url: str,
    models: dict,
    clients: dict,
    fan_out_override: int | None = None,
) -> dict:
    """Dispatch one approach for one image."""
    kind = approach_cfg.get("type", "single")

    if kind == "single":
        model_key = approach_cfg["model"]
        return single(image_data_url, _model(models, model_key), clients)

    if kind == "ensemble_judge":
        vision_cfg = _model(models, approach_cfg["vision_model"])
        judge_cfg = _model(models, approach_cfg.get("judge_model", approach_cfg["vision_model"]))
        variants = plate_schema.resolve_variants(approach_cfg.get("variants"))
        if fan_out_override is not None:
            if fan_out_override < 1:
                raise ValueError("--fan-out must be >= 1")
            if fan_out_override > len(variants):
                raise ValueError(
                    f"--fan-out {fan_out_override} exceeds the {len(variants)} variants "
                    f"configured for approach {approach_key!r}"
                )
            variants = variants[:fan_out_override]
        return ensemble_judge(
            image_data_url,
            vision_cfg,
            judge_cfg,
            variants,
            clients,
            max_parallel=approach_cfg.get("max_parallel", 5),
            judge_temperature=approach_cfg.get("judge_temperature"),
            judge_max_tokens=approach_cfg.get("judge_max_tokens"),
        )

    if kind in ("single_v3", "ensemble_judge_v3"):
        return approaches_v3.run_approach_v3(
            kind, approach_cfg, image_data_url, models, clients, fan_out_override
        )

    raise ValueError(f"approach {approach_key!r} has unknown type {kind!r}")


def _model(models: dict, key: str) -> dict:
    if key not in models:
        raise KeyError(f"unknown model key {key!r}; declared: {sorted(models)}")
    cfg = models[key]
    if "id" not in cfg:
        raise ValueError(f"model {key!r} is missing 'id'")
    return cfg


def approach_foods(approach_result: dict) -> list:
    """The food list an approach's *final answer* reported (ensemble -> judge)."""
    if not isinstance(approach_result, dict):
        return []
    if "final" in approach_result and isinstance(approach_result["final"], dict):
        return approach_result["final"].get("foods") or []
    return approach_result.get("foods") or []


def approach_latency_ms(approach_result: dict) -> float | None:
    if not isinstance(approach_result, dict):
        return None
    for key in ("total_latency_ms", "latency_ms"):
        value = approach_result.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    return None


def approach_cost_usd(approach_result: dict) -> float | None:
    if not isinstance(approach_result, dict):
        return None
    for key in ("total_cost_usd", "cost_usd"):
        value = approach_result.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    return None


def approach_json_ok(approach_result: dict) -> bool | None:
    if not isinstance(approach_result, dict):
        return None
    if "final" in approach_result and isinstance(approach_result["final"], dict):
        return bool(approach_result["final"].get("raw_ok"))
    if "raw_ok" in approach_result:
        return bool(approach_result["raw_ok"])
    return None
