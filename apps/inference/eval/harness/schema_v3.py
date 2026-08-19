"""Pipeline v3 — terse vision candidates, background-aware, wire-contract judge.

NOT IMPORTED BY ANYTHING YET. `harness/approaches_v3.py` consumes it, and
`approaches.py` only reaches that after the registration diff in
`eval/V3-DESIGN.md` is applied. Importing this module has no side effects.

Why v3 exists
-------------
`PERFORMANCE.md` establishes the pipeline is DECODE-BOUND:

    wall ~= prompt_tokens / prefill_tps + completion_tokens / decode_tps   (r = 0.973)

and the measured v2 completion tokens are 126-1128 per vision call (p50 549) plus
394-771 for the judge. Most of those tokens are *fields the judge throws away*:
seven `macrosPer100g` numbers, a `portionHint` sentence and a `confidence` string
per candidate item, none of which survive the merge as written (the judge takes
medians and re-derives confidence from agreement). v3 stops paying for them.

Three changes, in the order they matter:

1. **Terse candidate format.** Vision calls emit `{"f":[{"n":..,"g":..,"bg":..}]}`
   — name, grams, background flag. ~18 tokens per item, `maxItems: 8` in the
   GBNF, so a candidate cannot exceed ~160 completion tokens. Measured p50 549
   -> designed p50 ~110.
2. **Background exclusion at the vision stage.** `runs/2026-08-11-local-v2-SCORING.md`
   finding 2: the poster-trap leak *cannot* be fixed in the judge because the
   judge is text-only and blind — when 2 of 3 candidates report a wall-poster
   burrito it sees agreement. So the exclusion rule moves into the (now shared)
   vision system prompt, AND every item carries `bg: 0|1`. `bg: 1` items are
   dropped **in code** (`drop_background_items`) before the judge ever sees them;
   the judge keeps a backstop rule but is no longer the enforcement point.
3. **Shared image prefix.** v2 varied the *system* prompt per variant, which puts
   the divergence *before* the image tokens and defeats every prefix cache. v3
   uses ONE shared system prompt and moves the variant's instruction into the
   user turn *after* the image part. Candidates 2..n then re-prefill only ~60
   tokens instead of the whole image. On llama.cpp this needs `max_parallel: 1`
   so the requests land in the same KV slot sequentially; on vLLM it is what
   makes automatic prefix caching apply to the fan-out.

The FINAL judge output is unchanged production wire contract
(`schema.PLATE_IDENTIFICATION_JSON_SCHEMA` shape) — openplate's
openai-compatible adapter consumes it untouched. Only the intermediate candidate
format is terse.
"""

from __future__ import annotations

import copy
import json

from . import schema as plate_schema

# ---------------------------------------------------------------------------
# 1. Terse candidate schema
# ---------------------------------------------------------------------------
#
# Field names are one or two characters on purpose: at 6 items the key strings
# alone are ~40 % of the JSON in the production shape. `bg` is an integer 0/1
# rather than a boolean because `false` costs more tokens than `0` in every
# tokenizer here, and because an enum of two integers is a tighter GBNF.
#
# `maxItems: 8` (not 6): the vision stage is a *candidate* generator and
# `c3_detection` is deliberately over-enumerating — consolidation is the judge's
# job (same reasoning as schema.py's comment on why the vision schema is not
# bounded, but with a ceiling that bounds worst-case decode). 8 items x ~18
# tokens + wrapper ~= 155 completion tokens, which is the token cap this module
# is designed around.
#
# No `notes`. Prose fields are pure decode cost and the judge ignored them.

V3_MAX_CANDIDATE_ITEMS = 8

TERSE_ITEM_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        # name, plain language, <= 4 words
        "n": {"type": "string"},
        # estimated grams on the plate
        "g": {"type": "number"},
        # 1 == this food is only visible in the background (poster / menu /
        # screen / packaging / another table), 0 == physically on this plate
        "bg": {"type": "integer", "enum": [0, 1]},
    },
    "required": ["n", "g", "bg"],
    "additionalProperties": False,
}

TERSE_CANDIDATE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "f": {
            "type": "array",
            "items": TERSE_ITEM_JSON_SCHEMA,
            # minItems 0: a photo with no food on the plate is a legitimate
            # answer and must not be forced into a hallucination.
            "minItems": 0,
            "maxItems": V3_MAX_CANDIDATE_ITEMS,
        }
    },
    "required": ["f"],
    "additionalProperties": False,
}

TERSE_JSON_SCHEMA_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "plate_candidate_terse",
        "strict": True,
        "schema": TERSE_CANDIDATE_JSON_SCHEMA,
    },
}

TERSE_SCHEMA_NUDGE_USER_MESSAGE = (
    'Return ONLY valid JSON of the form {"f":[{"n":"food name","g":120,"bg":0}]}.'
)

# ---------------------------------------------------------------------------
# 2. Token caps
# ---------------------------------------------------------------------------
#
# Vision: the grammar already bounds output at ~155 tokens, so 256 is headroom,
# not a target. A cap AT the design budget is a trap — llama.cpp returns HTTP 200
# with a truncated body when `max_tokens` bites (finish_reason "length"), and the
# tolerant parser then fails on half a JSON object.
#
# Judge: 190 designed p50 (macros null) / ~330 (macros filled). 512 covers the
# null-macros path with room for the 6-item worst case; 768 covers macros-on.
#
# HARD RULE, from serve/models.json's reasoning-budget curve: never use
# `max_tokens` as a thinking budget. On a hybrid-reasoning model a token ceiling
# truncates mid-thought and returns `content: ""`. Judges served with
# `--reasoning-budget N > 0` (i.e. `lfm-judge-think`) must add N to the cap.
V3_VISION_MAX_TOKENS = 256
V3_JUDGE_MAX_TOKENS = 512
V3_JUDGE_MAX_TOKENS_WITH_MACROS = 768

#: Client-side downscale target (long edge, px) for v3 runs. 896 is a multiple of
#: 112 == lcm(16, 28), so it lands on an exact patch boundary for both LFM2.5-VL
#: (16 px patches) and Qwen3-VL (14 px patches, 2x2 merge => 28). Measured image
#: tokens scale with pixel count, so 1280 -> 896 is ~0.49x prefill on the image.
#: See V3-DESIGN.md for the server-side alternative (`--image-max-tokens`, which
#: only applies to dynamic-resolution towers).
V3_IMAGE_MAX_LONG_EDGE = 896

#: Whether the judge estimates `macrosPer100g` or emits null and lets openplate
#: resolve nutrition from its own food database. Default False: the numbers a
#: 1.6-2.6B model invents are strictly worse than a database lookup, and they
#: cost ~140 completion tokens (~9 s on `lfm-judge`) per plate. `null` is
#: contract-legal — production's own schema declares every macro nullable.
V3_JUDGE_MACROS_DEFAULT = False

# ---------------------------------------------------------------------------
# 3. Shared vision system prompt (identical for every variant)
# ---------------------------------------------------------------------------
#
# Everything that used to differ per variant now lives in the per-variant USER
# instruction, which is sent AFTER the image part. Keep this string byte-stable
# across variants or the prefix-cache win disappears.

V3_VISION_SYSTEM_PROMPT = """You turn one photo of a plate into a short food log.

Only foods PHYSICALLY ON the photographed plate or table setting count. Ignore food that is only pictured in the background: menus, posters, signs, screens, wall art, packaging illustrations, and plates belonging to other tables. If you list such an item at all, mark it "bg": 1. Everything actually on the plate is "bg": 0. Never list non-food objects (cutlery, napkins, glasses, packaging, decorations).

Log foods the way a person would: fold garnishes, herb sprigs and lemon wedges into the dish they sit on; a sauce joins the dish it is on unless it is a substantial side of its own; prefer fewer, consolidated items, 6 or fewer. Name each item in plain language, at most 4 words ("grilled chicken breast", not "protein"; "side salad", not "mixed leaves, tomato, cucumber").

Estimate each item's portion in grams. Be conservative -- when unsure estimate low.

Respond with JSON ONLY, no markdown, no commentary:

{"f":[{"n":"food name","g":120,"bg":0}]}

"n" is the name, "g" the estimated grams, "bg" the background flag. No other fields. Do not estimate nutrition -- grams and names only."""

# Per-variant user instruction, appended AFTER the image content part.
V3_VARIANTS = {
    "a3_production": {
        "id": "a3_production",
        "user_instruction": (
            "Identify the foods worth logging on this plate and answer with the JSON shape "
            "from the system prompt."
        ),
        "temperature": None,
    },
    "b3_production_hot": {
        "id": "b3_production_hot",
        "user_instruction": (
            "Identify the foods worth logging on this plate and answer with the JSON shape "
            "from the system prompt."
        ),
        "temperature": 0.9,
    },
    "c3_detection": {
        "id": "c3_detection",
        "user_instruction": (
            "First enumerate every visually distinct food ON this plate or table, including "
            "sides, sauces and drinks; then consolidate to at most 8 items and answer with "
            "the JSON shape from the system prompt. Anything you can only see in a poster, "
            "menu, screen or another table gets \"bg\": 1."
        ),
        "temperature": None,
    },
    "d3_taxonomy_first": {
        "id": "d3_taxonomy_first",
        "user_instruction": (
            "Decide the meal category first (breakfast / lunch-dinner plate / salad / "
            "sandwich-burger / dessert / snack / drink / mixed), then identify that "
            "category's component foods on this plate and answer with the JSON shape from "
            "the system prompt."
        ),
        "temperature": None,
    },
    "e3_skeptic": {
        "id": "e3_skeptic",
        "user_instruction": (
            "Identify the foods on this plate, then re-check what could be misidentified "
            "(rice vs couscous, yogurt vs cream, chicken vs pork) and what is only pictured "
            "in the background. Answer with your corrected list in the JSON shape from the "
            "system prompt."
        ),
        "temperature": None,
    },
}

#: The n=3 CPU lite profile, v3 flavour (mirrors v2's a/c/d choice).
V3_DEFAULT_VARIANT_ORDER = ["a3_production", "c3_detection", "d3_taxonomy_first"]


def resolve_v3_variants(spec: list | None) -> list[dict]:
    """Resolve a config's `variants` list into v3 variant dicts.

    Entries are built-in ids or inline dicts carrying at least
    `user_instruction`. Mirrors `schema.resolve_variants`, but v3 variants differ
    only in the user instruction — the system prompt is shared and must stay so.
    """
    entries = V3_DEFAULT_VARIANT_ORDER if spec is None else spec
    resolved: list[dict] = []
    for i, entry in enumerate(entries):
        if isinstance(entry, str):
            if entry not in V3_VARIANTS:
                raise KeyError(
                    f"unknown v3 variant {entry!r}; known: {sorted(V3_VARIANTS)}"
                )
            resolved.append(dict(V3_VARIANTS[entry]))
            continue
        if not isinstance(entry, dict) or "user_instruction" not in entry:
            raise ValueError(
                f"v3 variant[{i}] must be a built-in id or a dict with 'user_instruction'"
            )
        variant = dict(entry)
        variant.setdefault("id", f"inline_v3_{i}")
        variant.setdefault("temperature", None)
        resolved.append(variant)
    return resolved


def build_v3_vision_messages(user_instruction: str, image_data_url: str) -> list:
    """Image FIRST, variant instruction second — that ordering is the whole
    point: it keeps `system + image` byte-identical across the fan-out so a
    prefix cache can serve candidates 2..n."""
    return [
        {"role": "system", "content": V3_VISION_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": image_data_url}},
                {"type": "text", "text": user_instruction},
            ],
        },
    ]


# ---------------------------------------------------------------------------
# 4. Terse parsing / validation / background filtering
# ---------------------------------------------------------------------------


def validate_terse_candidate(value) -> tuple[bool, list[str]]:
    """Structural validation of `{"f":[{"n","g","bg"}]}`. Returns (ok, errors)."""
    errors: list[str] = []
    if not isinstance(value, dict):
        return False, ["response is not a JSON object"]
    items = value.get("f")
    if not isinstance(items, list):
        return False, ["missing or non-array 'f'"]
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"f[{i}] is not an object")
            continue
        if not isinstance(item.get("n"), str) or not item["n"].strip():
            errors.append(f"f[{i}].n is not a non-empty string")
        if not isinstance(item.get("g"), (int, float)) or isinstance(item.get("g"), bool):
            errors.append(f"f[{i}].g is not a number")
        if item.get("bg") not in (0, 1, True, False):
            errors.append(f"f[{i}].bg is not 0 or 1")
    return (len(errors) == 0), errors


def parse_terse_candidate(raw_text: str | None) -> tuple[dict | None, bool, list[str]]:
    """Tolerant parse + validate. Returns (parsed, ok, errors)."""
    if not raw_text:
        return None, False, ["empty content"]
    parsed = plate_schema.tolerant_parse_json(raw_text)
    ok, errors = validate_terse_candidate(parsed)
    return parsed, ok, errors


def drop_background_items(candidate: dict) -> tuple[dict, int]:
    """Mechanically remove `bg == 1` items. Returns (filtered_candidate, dropped).

    This is the enforcement point for the poster trap. Doing it in code rather
    than in the judge prompt is the direct consequence of
    runs/2026-08-11-local-v2-SCORING.md finding 2: an LLM merge stage cannot
    filter what it cannot see, and it *can* be talked into keeping an item three
    candidates agree on. A boolean the vision model already set is not a
    judgement call — it is a filter.
    """
    items = (candidate or {}).get("f") or []
    kept = [it for it in items if not _is_background(it)]
    dropped = len(items) - len(kept)
    out = dict(candidate or {})
    out["f"] = kept
    return out, dropped


def _is_background(item) -> bool:
    if not isinstance(item, dict):
        return False
    return item.get("bg") in (1, True)


def terse_items_to_wire_foods(items: list, confidence: str = "medium") -> list:
    """Mechanical terse -> production-contract conversion, no LLM involved.

    Used by the `single_v3` approach, which has no judge stage to build the wire
    shape for it. `portionHint` and `macrosPer100g` are null: a single terse call
    was never asked for them, and inventing them here would be fabrication
    dressed as a default. Both are nullable in the production schema.
    """
    foods = []
    for item in items or []:
        if not isinstance(item, dict) or _is_background(item):
            continue
        name = item.get("n")
        grams = item.get("g")
        if not isinstance(name, str) or not isinstance(grams, (int, float)):
            continue
        foods.append(
            {
                "name": name.strip(),
                "estimatedGrams": float(grams),
                "confidence": confidence,
                "portionHint": None,
                "macrosPer100g": None,
            }
        )
    return foods


# ---------------------------------------------------------------------------
# 5. Judge — consumes terse candidates, emits the production wire contract
# ---------------------------------------------------------------------------
#
# The judge schema stays the *bounded* production schema (minItems/maxItems on
# `foods`), for the reason schema.py already records: llama-server compiles JSON
# Schema to GBNF, so `maxItems` makes "at most 6 items" a decoding constraint
# rather than a request the 2.6B judge can ignore.

V3_JUDGE_MAX_FOODS = plate_schema.JUDGE_MAX_FOODS
V3_JUDGE_MIN_FOODS = plate_schema.JUDGE_MIN_FOODS

#: macros-null variant: `macrosPer100g` is pinned to null in the grammar, so the
#: judge physically cannot spend ~140 tokens inventing nutrition numbers.
V3_JUDGE_JSON_SCHEMA_NULL_MACROS = copy.deepcopy(
    plate_schema.JUDGE_PLATE_IDENTIFICATION_JSON_SCHEMA
)
V3_JUDGE_JSON_SCHEMA_NULL_MACROS["properties"]["foods"]["items"]["properties"][
    "macrosPer100g"
] = {"type": "null"}

#: macros-on variant: byte-identical to the v2 judge schema.
V3_JUDGE_JSON_SCHEMA_WITH_MACROS = copy.deepcopy(
    plate_schema.JUDGE_PLATE_IDENTIFICATION_JSON_SCHEMA
)

V3_JUDGE_RESPONSE_FORMAT_NULL_MACROS = {
    "type": "json_schema",
    "json_schema": {
        "name": "plate_identification_merged_v3",
        "strict": True,
        "schema": V3_JUDGE_JSON_SCHEMA_NULL_MACROS,
    },
}

V3_JUDGE_RESPONSE_FORMAT_WITH_MACROS = {
    "type": "json_schema",
    "json_schema": {
        "name": "plate_identification_merged_v3_macros",
        "strict": True,
        "schema": V3_JUDGE_JSON_SCHEMA_WITH_MACROS,
    },
}


def v3_judge_response_format(with_macros: bool = V3_JUDGE_MACROS_DEFAULT) -> dict:
    return (
        V3_JUDGE_RESPONSE_FORMAT_WITH_MACROS
        if with_macros
        else V3_JUDGE_RESPONSE_FORMAT_NULL_MACROS
    )


def v3_judge_max_tokens(with_macros: bool = V3_JUDGE_MACROS_DEFAULT) -> int:
    return V3_JUDGE_MAX_TOKENS_WITH_MACROS if with_macros else V3_JUDGE_MAX_TOKENS


_V3_WIRE_SHAPE_NULL_MACROS = (
    "\n\nRespond with JSON ONLY, no markdown, no commentary:\n\n"
    "{\n"
    '  "foods": [\n'
    "    {\n"
    '      "name": "string",\n'
    '      "estimatedGrams": 0,\n'
    '      "confidence": "high | medium | low",\n'
    '      "portionHint": "string or null",\n'
    '      "macrosPer100g": null\n'
    "    }\n"
    "  ],\n"
    '  "notes": null\n'
    "}\n\n"
    'Every field must be present. Always set "macrosPer100g" to null and "notes" to null -- '
    "nutrition is resolved downstream from a food database, so do not estimate it."
)

_V3_WIRE_SHAPE_WITH_MACROS = (
    "\n\nRespond with JSON ONLY, no markdown, no commentary:\n\n"
    "{\n"
    '  "foods": [\n'
    "    {\n"
    '      "name": "string",\n'
    '      "estimatedGrams": 0,\n'
    '      "confidence": "high | medium | low",\n'
    '      "portionHint": "string or null",\n'
    '      "macrosPer100g": {\n'
    '        "carbs": 0, "fiber": 0, "sugars": 0, "polyols": 0,\n'
    '        "protein": 0, "fat": 0, "kcal": 0\n'
    "      }\n"
    "    }\n"
    "  ],\n"
    '  "notes": "string or null"\n'
    "}\n\n"
    'Every macro field must be present; use null for any macro you are not confident '
    'about -- never 0 to mean "unknown". "macrosPer100g" itself may be null.'
)


def build_v3_judge_system_prompt(
    candidate_count: int, with_macros: bool = V3_JUDGE_MACROS_DEFAULT
) -> str:
    """Judge prompt for terse candidates, emitting the production contract.

    Deliberately shorter than `schema.build_judge_system_prompt`: that prompt is
    ~800 prompt tokens and this stage is now the largest single cost in the
    pipeline (18-19 s of a ~35 s v3 ensemble). Rules 1/3/4/7 of the v2 hardened
    prompt survive verbatim in substance — the SCORING verdict was that they are
    sound and the 2.6B judge is capability-bound, not prompt-bound. What shrank:
    the poster/background rule (now enforced in code before the judge sees the
    candidates, kept here only as a backstop) and the schema restatement.

    Note the input format: candidates arrive as `name=grams` lines, not JSON.
    That is ~45 prompt tokens per candidate instead of ~130 and is easier to
    count agreement over.
    """
    n = candidate_count
    high, medium, low = plate_schema._agreement_buckets(n)
    return (
        "You merge independent food-identification candidates for ONE plate photo into one "
        "final list. You are MERGING, not identifying.\n\n"
        f"You get {n} candidate lists, each written by a vision model that looked at the same "
        "photo, in the form `food name=grams`, one candidate per line. Apply these rules in "
        "order:\n\n"
        "1. EACH REAL FOOD APPEARS EXACTLY ONCE. Before emitting an item, compare it with "
        'everything you already emitted and merge same-food rows: case ("Pizza" = "pizza"), '
        'synonyms ("cheeseburger" = "Hamburger", "fries" = "French Fries"), plural/singular, '
        'and a specific name of something already listed generically ("cheddar" belongs in '
        '"cheese"). Two rows differing only in wording are a bug.\n'
        f"2. ITEMS REPORTED BY 2+ OF THE {n} CANDIDATES ARE KEPT. An item reported by only ONE "
        "candidate is kept ONLY if it is a distinctive major component (the main protein, a "
        "whole side dish, a Yorkshire pudding); a minor or garnish-level single-candidate item "
        "is noise -- drop it.\n"
        "3. NEVER INVENT AN ITEM. Every item you output must appear in at least one candidate "
        "line. Do not add foods you merely expect to accompany the meal, and drop anything "
        "that is not food.\n"
        '4. CONFIDENCE FROM AGREEMENT. Set "confidence" from how many candidates reported the '
        f'item (counting merged rows): {high} -> "high", {medium} -> "medium", {low} -> "low".\n'
        '5. GRAMS FROM THE MEDIAN. "estimatedGrams" is the median of the grams reported by the '
        "candidates that included the item (counting merged rows).\n"
        '6. PORTION HINT. "portionHint" is a short everyday-size phrase implied by the grams '
        '("about half the plate", "a fist-sized portion", "two slices"); use null when nothing '
        "natural fits.\n"
        f"7. AT MOST {V3_JUDGE_MAX_FOODS} ITEMS, at least {V3_JUDGE_MIN_FOODS}. If more survive, "
        f"keep the {V3_JUDGE_MAX_FOODS} with the strongest agreement, breaking ties by portion "
        "size.\n"
        "8. BACKSTOP: background-only foods (from a menu, poster, screen, packaging or another "
        "table) have already been filtered out upstream. If a candidate line still names "
        "something that could only be pictured rather than plated, drop it."
        + (_V3_WIRE_SHAPE_WITH_MACROS if with_macros else _V3_WIRE_SHAPE_NULL_MACROS)
    )


def format_terse_candidate_line(candidate: dict) -> str:
    """`chicken=140g; rice=180g` — the compact judge input encoding."""
    items = (candidate or {}).get("f") or []
    parts = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = item.get("n")
        grams = item.get("g")
        if not isinstance(name, str):
            continue
        if isinstance(grams, (int, float)) and not isinstance(grams, bool):
            parts.append(f"{name.strip()}={int(round(grams))}g")
        else:
            parts.append(name.strip())
    return "; ".join(parts) if parts else "(no food identified)"


def build_v3_judge_user_text(candidates: list[dict]) -> str:
    """One line per candidate. `candidates` are terse dicts (already
    background-filtered) each optionally carrying `variant_id`."""
    lines = []
    for i, cand in enumerate(candidates):
        lines.append(f"C{i + 1}: {format_terse_candidate_line(cand)}")
    return (
        f"{len(candidates)} candidate identifications of the same plate photo:\n\n"
        + "\n".join(lines)
        + "\n\nMerge them into one final result per your instructions."
    )


# ---------------------------------------------------------------------------
# 6. Token budget (design targets — the numbers V3-DESIGN.md projects from)
# ---------------------------------------------------------------------------

V3_TOKEN_BUDGET = {
    "vision_system_prompt_tokens_est": 285,
    "vision_user_instruction_tokens_est": 28,  # a3; c3/d3/e3 run 66-90
    "vision_completion_tokens_target_p50": 110,
    "vision_completion_tokens_ceiling": 155,  # 8 items x ~18 + wrapper, GBNF-bounded
    "judge_system_prompt_tokens_est": 605,
    "judge_candidate_line_tokens_est": 45,
    "judge_completion_tokens_target_p50": 190,  # macros null
    "judge_completion_tokens_target_p50_with_macros": 330,
    "_measured_v2_baseline": {
        "vision_completion_p50": 549,
        "vision_completion_max": 1128,
        "judge_prompt_p50": 2372,
        "judge_completion_p50": 685,
        "source": "runs/2026-08-11-local-v2-hardjudge/results.json",
    },
}


def estimate_tokens(text: str) -> int:
    """chars/4 estimate — for sanity-checking prompt sizes only.

    Calibrated against measured counts: v2's `a_production` system+user prompt is
    2480 chars and llama.cpp reported 620 prompt tokens for it (2433-token
    request minus 1813 image tokens); `c_detection` is 1084 chars / 279 measured.
    chars/4 reproduces both within 3 %. Real counts still come from
    `usage.prompt_tokens` in a run's results.json.
    """
    return int(len(text) / 4.0)


if __name__ == "__main__":  # pragma: no cover - sanity print, no model calls
    print("vision system prompt ~", estimate_tokens(V3_VISION_SYSTEM_PROMPT), "tokens")
    for vid, v in V3_VARIANTS.items():
        print(f"  {vid} user instruction ~{estimate_tokens(v['user_instruction'])} tokens")
    print(
        "judge system prompt (n=3, macros off) ~",
        estimate_tokens(build_v3_judge_system_prompt(3, False)),
        "tokens",
    )
    print(
        "judge system prompt (n=3, macros on) ~",
        estimate_tokens(build_v3_judge_system_prompt(3, True)),
        "tokens",
    )
    print(json.dumps(V3_TOKEN_BUDGET, indent=2))
