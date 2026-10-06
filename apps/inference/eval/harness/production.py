"""The PRODUCTION request, measured: `production`, `single_text` and `recipe` approaches.

The older approaches here send the August 2026 prompt and a smaller schema. These send what the app sends today,
and take every prompt, schema name, schema and upload constraint from `generated/vision-contract.json`
(`harness/contract.py`), which is written by the app's own builders. Nothing in this module spells a prompt.

What a production call carries, and where each part comes from:

    messages          the contract: system prompt, user prompt, then the photo or the person's words
    response_format   the contract: `json_schema`, strict, the schema name and the schema
    max_tokens        the model entry (default 8192)
    reasoning         the model entry, present ONLY when the config sets it ({"effort": "minimal"} or absent)
    provider, ...     the model entry's `extra_body` (the routing block: zdr, data_collection, only, fallbacks)
    usage             {"include": true}, so the answer reports its own cost
    temperature       never sent, as the app never sends one

What each call RECORDS (see `record_call`): the HTTP status, the raw content, whether it is schema-valid under a
strict validator, the latency, prompt / completion / reasoning tokens, `usage.cost`, the provider that answered and
the model id that answered. A 400 or a 404 is recorded as a result, never raised: a route that cannot serve the
strict schema is a finding.

IMAGES. The app downscales in the browser: longest side at most 1600 px (never upscaled, rounded the way
JavaScript rounds), re-encoded as JPEG at quality 0.85, always, even when the photo was already small. The harness
does the same with Pillow, which the harness already used (optionally) for its older 896 px downscale, and falls
back to ImageMagick (`magick`) when Pillow is missing. With neither it STOPS: an unresized photo would be a
different request and a different cost.
"""

from __future__ import annotations

import base64
import copy
import io
import json
import math
import shutil
import subprocess
from pathlib import Path

from . import schema as plate_schema
from . import schema_validate
from .contract import PHOTO_TASKS, RECIPE_TASK, TEXT_TASKS, Contract, ContractError

DEFAULT_MAX_TOKENS = 8192
JPEG_DATA_URL_PREFIX = "data:image/jpeg;base64,"

#: Body keys the contract and the model entry own. `extra_body` may add others (the routing block) but never
#: replace these, which would silently change the request being measured.
RESERVED_BODY_KEYS = ("model", "messages", "response_format", "reasoning", "usage", "max_tokens", "temperature")

PLATE_TASKS = ("plate_photo", "plate_text")


class ProductionConfigError(SystemExit):
    def __init__(self, message: str):
        super().__init__(f"ERROR: {message}")


# ---------------------------------------------------------------------------
# Images: the app's client-side resize
# ---------------------------------------------------------------------------


def js_round(value: float) -> int:
    """JavaScript's Math.round: halves go up. Python's round() sends halves to the even number."""
    return math.floor(value + 0.5)


def scaled_dimensions(width: int, height: int, max_dimension: int) -> tuple[int, int]:
    """`computeScaledDimensions` from `app/lib/photo-constraints.ts`: fit the longest side, never upscale."""
    longest = max(width, height)
    if longest <= max_dimension:
        return width, height
    scale = max_dimension / longest
    return js_round(width * scale), js_round(height * scale)


def _jpeg_quality_percent(quality: float) -> int:
    return js_round(quality * 100)


def _resize_with_pillow(raw: bytes, max_dimension: int, quality: float) -> tuple[bytes, dict] | None:
    try:
        import PIL
        from PIL import Image, ImageOps
    except ImportError:
        return None
    with Image.open(io.BytesIO(raw)) as opened:
        # createImageBitmap applies the EXIF orientation, so a phone photo is upright before it is scaled.
        image = ImageOps.exif_transpose(opened).convert("RGB")
    source_width, source_height = image.size
    width, height = scaled_dimensions(source_width, source_height, max_dimension)
    width, height = max(width, 1), max(height, 1)
    if (width, height) != image.size:
        image = image.resize((width, height), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=_jpeg_quality_percent(quality))
    return buffer.getvalue(), {
        "resizer": f"pillow {PIL.__version__}",
        "source_width": source_width,
        "source_height": source_height,
        "width": width,
        "height": height,
    }


def _resize_with_magick(raw: bytes, max_dimension: int, quality: float) -> tuple[bytes, dict] | None:
    magick = shutil.which("magick")
    if magick is None:
        return None
    identify = subprocess.run(
        [magick, "-", "-auto-orient", "-format", "%w %h", "info:"],
        input=raw,
        capture_output=True,
        check=True,
    )
    source_width, source_height = (int(part) for part in identify.stdout.decode("ascii").split()[:2])
    width, height = scaled_dimensions(source_width, source_height, max_dimension)
    width, height = max(width, 1), max(height, 1)
    converted = subprocess.run(
        [
            magick,
            "-",
            "-auto-orient",
            "-resize",
            f"{width}x{height}!",
            "-quality",
            str(_jpeg_quality_percent(quality)),
            "jpg:-",
        ],
        input=raw,
        capture_output=True,
        check=True,
    )
    return converted.stdout, {
        "resizer": "magick",
        "source_width": source_width,
        "source_height": source_height,
        "width": width,
        "height": height,
    }


def production_image_data_url(image_path: Path, constraints: dict) -> tuple[str, dict]:
    """The photo as the app uploads it: a JPEG data URL, plus a small record of what was done to it."""
    raw = image_path.read_bytes()
    max_dimension = int(constraints["maxLongSidePx"])
    quality = float(constraints["jpegQuality"])
    prepared = _resize_with_pillow(raw, max_dimension, quality) or _resize_with_magick(raw, max_dimension, quality)
    if prepared is None:
        raise ProductionConfigError(
            "the production approach needs Pillow or ImageMagick (`magick`) to resize photos to "
            f"{max_dimension} px JPEG quality {quality}; neither is available. It will not send an unresized photo."
        )
    jpeg, info = prepared
    info.update({"jpeg_bytes": len(jpeg), "jpeg_quality": quality, "max_long_side_px": max_dimension})
    return JPEG_DATA_URL_PREFIX + base64.b64encode(jpeg).decode("ascii"), info


# ---------------------------------------------------------------------------
# The request body
# ---------------------------------------------------------------------------


def build_request_body(
    contract: Contract,
    model_cfg: dict,
    task_key: str,
    language: str,
    *,
    image_data_url: str | None = None,
    input_text: str | None = None,
) -> dict:
    """The body the app's request builder would produce, plus the routing, usage and token fields the proxy adds."""
    task = contract.task(task_key)
    image_base64 = None
    if task["inputKind"] == "photo":
        if image_data_url is None or not image_data_url.startswith(JPEG_DATA_URL_PREFIX):
            raise ProductionConfigError(f"task {task_key!r} needs a JPEG data URL from production_image_data_url")
        image_base64 = image_data_url[len(JPEG_DATA_URL_PREFIX) :]

    body: dict = {
        "model": model_cfg["id"],
        "messages": contract.build_messages(task_key, language, image_base64=image_base64, input_text=input_text),
        "response_format": contract.response_format(task_key),
    }
    reasoning = model_cfg.get("reasoning")
    if reasoning is not None:
        body["reasoning"] = copy.deepcopy(reasoning)
    extra = copy.deepcopy(model_cfg.get("extra_body") or {})
    clashes = [key for key in extra if key in RESERVED_BODY_KEYS]
    if clashes:
        raise ProductionConfigError(
            f"model {model_cfg['id']!r}: extra_body sets {clashes}, which the contract or the model entry owns"
        )
    body.update(extra)
    body["usage"] = {"include": True}
    body["max_tokens"] = model_cfg.get("max_tokens", DEFAULT_MAX_TOKENS)
    return body


def redact_body(body: dict) -> dict:
    """The body with photo bytes replaced by their length, for printing and for the result file."""
    shown = copy.deepcopy(body)
    for message in shown.get("messages", []):
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            image = part.get("image_url") if isinstance(part, dict) else None
            if isinstance(image, dict) and isinstance(image.get("url"), str) and image["url"].startswith("data:"):
                image["url"] = f"<image data url: {len(image['url'])} chars, bytes not shown>"
    return shown


def format_body(body: dict) -> str:
    """The redacted body as readable JSON, with the (long) schema kept on one line."""
    shown = redact_body(body)
    placeholder = "@@SCHEMA_ONE_LINE@@"
    schema = None
    format_block = shown.get("response_format")
    if isinstance(format_block, dict) and isinstance(format_block.get("json_schema"), dict):
        schema = format_block["json_schema"].get("schema")
        if schema is not None:
            format_block["json_schema"]["schema"] = placeholder
    text = json.dumps(shown, indent=2, ensure_ascii=False)
    if schema is not None:
        text = text.replace(json.dumps(placeholder), json.dumps(schema, ensure_ascii=False, separators=(",", ":")))
    return text


def check_request_body(body: dict, contract: Contract, model_cfg: dict, task_key: str, language: str) -> list[str]:
    """Where `body` departs from the contract. Empty means the body IS the contract's request.

    Independent of `build_request_body`: it reads the contract entry directly, so a bug in the builder (or a
    hand-edited body) shows up here instead of agreeing with itself.
    """
    problems: list[str] = []
    task = contract.task(task_key)
    entry = contract.entry(task_key, language)

    if body.get("model") != model_cfg["id"]:
        problems.append(f"model is {body.get('model')!r}, config says {model_cfg['id']!r}")

    messages = body.get("messages") or []
    if len(messages) != 2:
        problems.append(f"expected a system and a user message, got {len(messages)} messages")
    else:
        system, user = messages
        if system != {"role": "system", "content": entry["systemPrompt"]}:
            problems.append("the system message is not the contract system prompt")
        parts = user.get("content") if user.get("role") == "user" else None
        if not isinstance(parts, list) or len(parts) != 2:
            problems.append("the user message is not an instruction part plus one payload part")
        else:
            if parts[0] != {"type": "text", "text": entry["userPrompt"]}:
                problems.append("the first user part is not the contract user prompt")
            second = parts[1]
            if task["inputKind"] == "photo":
                url = (second.get("image_url") or {}).get("url", "") if second.get("type") == "image_url" else ""
                if not url.startswith(JPEG_DATA_URL_PREFIX) or len(url) == len(JPEG_DATA_URL_PREFIX):
                    problems.append("the second user part is not a JPEG data URL with bytes")
            elif second.get("type") != "text" or not second.get("text"):
                problems.append("the second user part is not the person's text")

    expected_format = contract.response_format(task_key)
    if body.get("response_format") != expected_format:
        problems.append("response_format is not the contract json_schema block (name, strict, schema)")
    elif expected_format["json_schema"]["strict"] is not True:
        problems.append("the contract schema is not strict")

    if body.get("usage") != {"include": True}:
        problems.append("usage is not {'include': true}")
    expected_tokens = model_cfg.get("max_tokens", DEFAULT_MAX_TOKENS)
    if body.get("max_tokens") != expected_tokens:
        problems.append(f"max_tokens is {body.get('max_tokens')!r}, expected {expected_tokens!r}")
    if model_cfg.get("reasoning") is None and "reasoning" in body:
        problems.append("a reasoning field is present although the config sets none")
    if model_cfg.get("reasoning") is not None and body.get("reasoning") != model_cfg["reasoning"]:
        problems.append("reasoning is not the config value")
    for key, value in (model_cfg.get("extra_body") or {}).items():
        if body.get(key) != value:
            problems.append(f"{key} is not the config extra_body value")
    allowed = set(RESERVED_BODY_KEYS) | set(model_cfg.get("extra_body") or {})
    allowed.discard("temperature")
    stray = sorted(set(body) - allowed)
    if stray:
        problems.append(f"unexpected body keys: {stray}")
    return problems


# ---------------------------------------------------------------------------
# One call, recorded
# ---------------------------------------------------------------------------


def _read_envelope(body_text: str) -> dict | None:
    try:
        parsed = json.loads(body_text)
    except (json.JSONDecodeError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _content_of(envelope: dict | None) -> tuple[str | None, str | None]:
    """(message content, finish_reason) from a chat-completions envelope."""
    if not envelope:
        return None, None
    choices = envelope.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        return None, None
    message = choices[0].get("message") or {}
    content = message.get("content") if isinstance(message, dict) else None
    return (content if isinstance(content, str) else None), choices[0].get("finish_reason")


def _number(value) -> float | int | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def grade_content(content: str | None, schema: dict) -> dict:
    """Parse and validate an answer. `schema_valid` demands strict JSON: that is what strict mode promises."""
    if not content:
        return {
            "parse": "empty",
            "schema_valid": False,
            "schema_errors": ["empty content"],
            "schema_valid_after_tolerant_parse": False,
            "answer": None,
        }
    try:
        answer = json.loads(content)
        parse = "strict"
    except json.JSONDecodeError:
        answer = plate_schema.tolerant_parse_json(content)
        parse = "tolerant" if answer is not None else "failed"
    if answer is None:
        return {
            "parse": "failed",
            "schema_valid": False,
            "schema_errors": ["content is not JSON"],
            "schema_valid_after_tolerant_parse": False,
            "answer": None,
        }
    errors = schema_validate.validate(answer, schema)
    return {
        "parse": parse,
        "schema_valid": parse == "strict" and not errors,
        "schema_errors": errors[:20],
        "schema_valid_after_tolerant_parse": not errors,
        "answer": answer if not errors else None,
    }


def record_call(
    *,
    raw,
    body: dict,
    contract: Contract,
    model_cfg: dict,
    task_key: str,
    language: str,
    base_url: str,
    extra: dict | None = None,
) -> dict:
    """Turn one HTTP exchange into the per-call record the result file keeps."""
    envelope = _read_envelope(raw.body_text)
    content, finish_reason = _content_of(envelope)
    usage = (envelope or {}).get("usage") if envelope else None
    usage = usage if isinstance(usage, dict) else {}
    details = usage.get("completion_tokens_details")
    reasoning_tokens = details.get("reasoning_tokens") if isinstance(details, dict) else None
    cost = _number(usage.get("cost"))

    api_error = (envelope or {}).get("error") if envelope else None
    error = None
    if raw.transport_error:
        error = f"transport: {raw.transport_error}"
    elif raw.status != 200:
        error = f"HTTP {raw.status}: {raw.body_text[:400]}"
    elif api_error:
        error = f"API error in a 200 body: {json.dumps(api_error)[:400]}"
    elif content is None:
        error = "the answer has no message content"

    graded = grade_content(content, contract.schema(task_key))
    answer = graded["answer"]
    record = {
        "kind": "production",
        "task": task_key,
        "language": language,
        "model": model_cfg["id"],
        "base_url": base_url,
        "http_status": raw.status,
        "attempts": raw.attempts,
        "latency_ms": raw.latency_ms,
        "raw_content": content,
        "finish_reason": finish_reason,
        "parse": graded["parse"],
        "schema_valid": graded["schema_valid"],
        "schema_errors": graded["schema_errors"],
        "schema_valid_after_tolerant_parse": graded["schema_valid_after_tolerant_parse"],
        "prompt_tokens": _number(usage.get("prompt_tokens")),
        "completion_tokens": _number(usage.get("completion_tokens")),
        "reasoning_tokens": _number(reasoning_tokens),
        "usage_cost_usd": cost,
        "provider": (envelope or {}).get("provider") if envelope else None,
        "model_returned": (envelope or {}).get("model") if envelope else None,
        "request": {
            key: value
            for key, value in redact_body(body).items()
            if key not in ("messages", "response_format")
        },
        "error": error,
        # Keys the scorecard and the summary already read, so a production result scores like any other.
        "raw_ok": graded["schema_valid"],
        "cost_usd": cost,
        "foods": (answer or {}).get("foods", []) if task_key in PLATE_TASKS and isinstance(answer, dict) else [],
        "notes": (answer or {}).get("notes") if isinstance(answer, dict) else None,
        "answer": answer,
    }
    if extra:
        record.update(extra)
    return record


def _run_task(
    *,
    approach_cfg: dict,
    models: dict,
    clients: dict,
    contract: Contract,
    task_key: str,
    language: str,
    image_data_url: str | None = None,
    input_text: str | None = None,
    extra: dict | None = None,
) -> dict:
    model_cfg = _model(models, approach_cfg["model"])
    client = _client_for(model_cfg, clients)
    body = build_request_body(
        contract, model_cfg, task_key, language, image_data_url=image_data_url, input_text=input_text
    )
    raw = client.post_raw(body)
    return record_call(
        raw=raw,
        body=body,
        contract=contract,
        model_cfg=model_cfg,
        task_key=task_key,
        language=language,
        base_url=client.base_url,
        extra=extra,
    )


def _model(models: dict, key: str) -> dict:
    if key not in models:
        raise KeyError(f"unknown model key {key!r}; declared: {sorted(models)}")
    cfg = models[key]
    if "id" not in cfg:
        raise ValueError(f"model {key!r} is missing 'id'")
    return cfg


def _client_for(model_cfg: dict, clients: dict):
    provider_name = model_cfg.get("provider")
    if provider_name not in clients:
        raise KeyError(
            f"model {model_cfg.get('id')!r} names provider {provider_name!r}, "
            f"which is not declared in the config's 'providers' (have: {sorted(clients)})"
        )
    return clients[provider_name]


# ---------------------------------------------------------------------------
# The three approach types
# ---------------------------------------------------------------------------


def approach_task(approach_cfg: dict) -> str:
    kind = approach_cfg.get("type")
    if kind == "production":
        task = approach_cfg.get("task", "plate_photo")
        allowed = PHOTO_TASKS
    elif kind == "single_text":
        task = approach_cfg.get("task", "plate_text")
        allowed = TEXT_TASKS
    elif kind == "recipe":
        task = RECIPE_TASK
        allowed = (RECIPE_TASK,)
    else:
        raise ProductionConfigError(f"approach type {kind!r} is not a production type")
    if task not in allowed:
        raise ProductionConfigError(f"approach type {kind!r} runs {list(allowed)}, not {task!r}")
    return task


def run_production(
    approach_cfg: dict,
    image_data_url: str,
    image_info: dict | None,
    models: dict,
    clients: dict,
    contract: Contract,
) -> dict:
    """A photo task (the plate by default, or the pantry shelf) sent as the app sends it."""
    return _run_task(
        approach_cfg=approach_cfg,
        models=models,
        clients=clients,
        contract=contract,
        task_key=approach_task(approach_cfg),
        language=approach_cfg.get("language", "en"),
        image_data_url=image_data_url,
        extra={"image": image_info},
    )


def run_text_case(approach_cfg: dict, case: dict, models: dict, clients: dict, contract: Contract) -> dict:
    """A typed meal or a typed pantry list: one JSONL case, in the language it names."""
    return _run_task(
        approach_cfg=approach_cfg,
        models=models,
        clients=clients,
        contract=contract,
        task_key=approach_task(approach_cfg),
        language=case["lang"],
        input_text=case["input"],
        extra={"case": _case_summary(case)},
    )


def run_recipe_case(approach_cfg: dict, case: dict, models: dict, clients: dict, contract: Contract) -> dict:
    """One recipe request: the shelf, the rest of the day, the slot and the language, put together by the contract."""
    return _run_task(
        approach_cfg=approach_cfg,
        models=models,
        clients=clients,
        contract=contract,
        task_key=RECIPE_TASK,
        language=case["lang"],
        input_text=contract.recipe_user_text(case["lang"], case),
        extra={"case": _case_summary(case)},
    )


def _case_summary(case: dict) -> dict:
    return {key: value for key, value in case.items() if key != "input" or len(str(value)) <= 400}


def preview_request(
    approach_cfg: dict,
    models: dict,
    contract: Contract,
    *,
    image_data_url: str | None = None,
    case: dict | None = None,
) -> tuple[dict, str, str]:
    """(body, task, language) for the first request of a production approach, without sending anything."""
    task_key = approach_task(approach_cfg)
    model_cfg = _model(models, approach_cfg["model"])
    kind = approach_cfg["type"]
    if kind == "production":
        language = approach_cfg.get("language", "en")
        body = build_request_body(contract, model_cfg, task_key, language, image_data_url=image_data_url)
    elif kind == "single_text":
        if case is None:
            raise ProductionConfigError("a text preview needs a case")
        language = case["lang"]
        body = build_request_body(contract, model_cfg, task_key, language, input_text=case["input"])
    else:
        if case is None:
            raise ProductionConfigError("a recipe preview needs a case")
        language = case["lang"]
        body = build_request_body(
            contract, model_cfg, task_key, language, input_text=contract.recipe_user_text(language, case)
        )
    return body, task_key, language


# ---------------------------------------------------------------------------
# JSONL cases
# ---------------------------------------------------------------------------

TEXT_CASE_FIELDS = ("input", "lang")
RECIPE_CASE_FIELDS = ("lang", "slot", "pantry", "remaining_day_block")


def load_cases(path: Path, *, kind: str, languages: list[str]) -> list[dict]:
    """Read a JSONL file of cases. `kind` is `text` (`input`, `lang`) or `recipe`.

    One JSON object per line; blank lines and lines starting with `#` are skipped. `id` is optional and defaults to
    the line number. Anything wrong is an error naming the line: a case that half-loads would be a silently
    smaller test set.
    """
    if not path.is_file():
        raise ProductionConfigError(f"cases file not found: {path}")
    needed = TEXT_CASE_FIELDS if kind == "text" else RECIPE_CASE_FIELDS
    cases: list[dict] = []
    seen: set[str] = set()
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        try:
            case = json.loads(stripped)
        except json.JSONDecodeError as e:
            raise ProductionConfigError(f"{path}:{line_number}: not JSON ({e})") from e
        if not isinstance(case, dict):
            raise ProductionConfigError(f"{path}:{line_number}: a case is a JSON object")
        missing = [field for field in needed if field not in case]
        if missing:
            raise ProductionConfigError(f"{path}:{line_number}: missing {missing}")
        if case["lang"] not in languages:
            raise ProductionConfigError(f"{path}:{line_number}: lang {case['lang']!r} is not one of {languages}")
        if kind == "text" and (not isinstance(case["input"], str) or not case["input"].strip()):
            raise ProductionConfigError(f"{path}:{line_number}: input must be a non-empty string")
        if kind == "recipe" and not isinstance(case["pantry"], list):
            raise ProductionConfigError(f"{path}:{line_number}: pantry must be a list")
        case_id = str(case.get("id") or f"case-{line_number:04d}")
        if case_id in seen:
            raise ProductionConfigError(f"{path}:{line_number}: duplicate id {case_id!r}")
        seen.add(case_id)
        case["id"] = case_id
        cases.append(case)
    if not cases:
        raise ProductionConfigError(f"{path}: no cases")
    return cases
