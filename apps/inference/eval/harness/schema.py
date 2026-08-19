"""Prompts, output schema, tolerant parsing and validation.

The system prompt and the JSON schema are ported verbatim/faithfully from
openplate's `app/services/vision/{prompt,schema}.ts` (by way of the pilot
script `runs/2026-08-11-openrouter-pilot/run_bench.py.ref`) so the harness
scores what actually ships.
"""

from __future__ import annotations

import copy
import json
import math
import re

# ---------------------------------------------------------------------------
# Ported verbatim from openplate/app/services/vision/prompt.ts
# ---------------------------------------------------------------------------

PLATE_IDENTIFICATION_SYSTEM_PROMPT = """You are a nutrition assistant that turns a single photo of a plate into a concise, useful food log.

Log foods the way a person would, not the way a lab would:
- Only list foods that meaningfully affect nutrition. Fold garnishes, herb sprigs, and decorations (e.g. a parsley garnish, a lemon wedge, a dusting of herbs) into the dish they sit on, or omit them -- never list them as separate items.
- A sauce or dressing joins the dish it's on, unless it's clearly a substantial side of its own.
- Prefer fewer, consolidated items. Aim for 6 or fewer. Combine components that are eaten together into one natural item when that better matches how someone would log it.
- Name each item in plain language (e.g. "grilled chicken breast", not "protein"; "side salad", not "mixed leaves, tomato, cucumber").

For each item you keep:
- Estimate its portion size in grams. Be conservative -- when unsure, estimate on the lower end rather than overestimating.
- Add a short everyday-size comparison in "portionHint" -- how a normal person would describe the amount, e.g. "about half the plate", "a fist-sized portion", "a small bowl", "two slices", "a large handful". Use null when nothing natural fits.
- Rate your confidence in the identification as "high", "medium", or "low".
- Estimate macronutrients per 100g (carbs, fiber, sugars, polyols, protein, fat, kcal) ONLY when you are reasonably confident. If you are not confident about a specific macro field, set it to null -- never guess a number, and never use 0 to mean "unknown". This matters most for fiber and sugar alcohols (polyols), which are easy to miss.

Respond with JSON ONLY, matching exactly this shape (no markdown, no commentary outside the JSON):

{
  "foods": [
    {
      "name": "string",
      "estimatedGrams": 0,
      "confidence": "high | medium | low",
      "portionHint": "string or null",
      "macrosPer100g": {
        "carbs": 0,
        "fiber": 0,
        "sugars": 0,
        "polyols": 0,
        "protein": 0,
        "fat": 0,
        "kcal": 0
      }
    }
  ],
  "notes": "string or null"
}

Every field must be present. "portionHint" may be null when no natural comparison fits. Each macro field must be present but may be null. "macrosPer100g" itself may be null if you cannot estimate any macros for that item. "notes" may be null if you have nothing to add."""

PRODUCTION_USER_PROMPT = (
    "Identify the foods worth logging on the plate in the attached photo and "
    "respond with the JSON shape described in the system prompt."
)

# ---------------------------------------------------------------------------
# Ported faithfully from openplate/app/services/vision/schema.ts
# (PlateIdentificationSchema -> strict-mode JSON Schema)
# ---------------------------------------------------------------------------

_MACROS_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "carbs": {"type": ["number", "null"]},
        "fiber": {"type": ["number", "null"]},
        "sugars": {"type": ["number", "null"]},
        "polyols": {"type": ["number", "null"]},
        "protein": {"type": ["number", "null"]},
        "fat": {"type": ["number", "null"]},
        "kcal": {"type": ["number", "null"]},
    },
    "required": ["carbs", "fiber", "sugars", "polyols", "protein", "fat", "kcal"],
    "additionalProperties": False,
}

_FOOD_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "estimatedGrams": {"type": "number"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "portionHint": {"type": ["string", "null"]},
        "macrosPer100g": {"anyOf": [_MACROS_JSON_SCHEMA, {"type": "null"}]},
    },
    "required": ["name", "estimatedGrams", "confidence", "portionHint", "macrosPer100g"],
    "additionalProperties": False,
}

PLATE_IDENTIFICATION_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "foods": {"type": "array", "items": _FOOD_JSON_SCHEMA},
        "notes": {"type": ["string", "null"]},
    },
    "required": ["foods", "notes"],
    "additionalProperties": False,
}

JSON_SCHEMA_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "plate_identification",
        "strict": True,
        "schema": PLATE_IDENTIFICATION_JSON_SCHEMA,
    },
}

SCHEMA_NUDGE_USER_MESSAGE = "Return ONLY valid JSON matching the schema."

# ---------------------------------------------------------------------------
# Judge-call schema (2026-08-11 hardening)
# ---------------------------------------------------------------------------
#
# DELIBERATE DIVERGENCE from the vision schema above.
#
# The vision schema is a faithful port of what openplate ships
# (`app/services/vision/schema.ts`) and stays that way: the eval must score the
# production contract, and a *candidate* that over-enumerates is not a defect —
# the judge exists to consolidate it. Constraining the vision call would change
# the thing under test.
#
# The judge call is harness-internal, so its schema is allowed to be stricter
# than production's. The local LFM2.5-2.6B judge emitted 9-10 items despite the
# prompt's "aim for 6 or fewer" rule (see
# runs/2026-08-11-local-lfm/SCORING.md — dedup failures on 2-4 of 10 images),
# and a prompt rule the model can ignore is not an enforcement mechanism.
# llama-server compiles JSON Schema to GBNF, so `maxItems` on the judge call is
# a hard decoding constraint: the model *cannot* emit a 7th item, which forces
# the merge instead of merely requesting it. `minItems: 1` blocks the degenerate
# empty-merge.
#
# Cloud caveat: OpenAI-style `strict: true` structured outputs do not support
# minItems/maxItems and some providers 400 on them. That is survivable — the
# client drops `response_format` and retries on any 4xx (providers.chat_once),
# so a cloud judge falls back to prompt-only enforcement rather than failing.
JUDGE_MAX_FOODS = 6
JUDGE_MIN_FOODS = 1

JUDGE_PLATE_IDENTIFICATION_JSON_SCHEMA = copy.deepcopy(PLATE_IDENTIFICATION_JSON_SCHEMA)
JUDGE_PLATE_IDENTIFICATION_JSON_SCHEMA["properties"]["foods"].update(
    {"minItems": JUDGE_MIN_FOODS, "maxItems": JUDGE_MAX_FOODS}
)

JUDGE_JSON_SCHEMA_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "plate_identification_merged",
        "strict": True,
        "schema": JUDGE_PLATE_IDENTIFICATION_JSON_SCHEMA,
    },
}

#: Judge sampling default. The merge is a deterministic bookkeeping task, not a
#: creative one — diversity is supplied by the vision fan-out, and merge
#: variance (a real item dropped on one run, kept on the next; see the SCORING
#: findings on sausages/bread and Yorkshire pudding) is pure downside here.
DEFAULT_JUDGE_TEMPERATURE = 0.0

# ---------------------------------------------------------------------------
# Ensemble prompt variants
# ---------------------------------------------------------------------------

_SCHEMA_INSTRUCTIONS = (
    "\n\nRespond with JSON ONLY, matching exactly this shape (no markdown, no "
    "commentary outside the JSON):\n\n"
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
    'Every field must be present. "portionHint" may be null when no natural '
    'comparison fits. Each macro field must be present but may be null. '
    '"macrosPer100g" itself may be null if you cannot estimate any macros for '
    'that item. "notes" may be null if you have nothing to add.'
)

#: Built-in diverse prompt variants a-e. Configs select them by id, so the
#: ensemble size is tunable (CPU profiles may want n=3 -- see M138 counsel:
#: llama.cpp serialises concurrent generations, so fan-out costs wall clock).
ENSEMBLE_VARIANTS = {
    "a_production": {
        "id": "a_production",
        "system_prompt": PLATE_IDENTIFICATION_SYSTEM_PROMPT,
        "temperature": None,
    },
    "b_production_hot": {
        "id": "b_production_hot",
        "system_prompt": PLATE_IDENTIFICATION_SYSTEM_PROMPT,
        "temperature": 0.9,
    },
    "c_detection": {
        "id": "c_detection",
        "system_prompt": (
            "You are a nutrition assistant analyzing a photo of a plate/table of food.\n\n"
            "Enumerate every visually distinct food item on the plate/table, including "
            "sides, sauces, garnishes and drinks. Be exhaustive first, then consolidate "
            "to the schema (max 6 items)." + _SCHEMA_INSTRUCTIONS
        ),
        "temperature": None,
    },
    "d_taxonomy_first": {
        "id": "d_taxonomy_first",
        "system_prompt": (
            "You are a nutrition assistant analyzing a photo of a plate/table of food.\n\n"
            "First decide the meal category (breakfast / lunch-dinner plate / salad / "
            "sandwich-burger / dessert / snack / drink / mixed). Then, within that "
            "category, identify each component food." + _SCHEMA_INSTRUCTIONS
        ),
        "temperature": None,
    },
    "e_skeptic": {
        "id": "e_skeptic",
        "system_prompt": (
            "You are a nutrition assistant analyzing a photo of a plate/table of food.\n\n"
            "Identify the foods, then critically re-examine: what might be misidentified "
            "(e.g. rice vs couscous, yogurt vs cream)? Output your final corrected "
            "identification." + _SCHEMA_INSTRUCTIONS
        ),
        "temperature": None,
    },
}

DEFAULT_VARIANT_ORDER = [
    "a_production",
    "b_production_hot",
    "c_detection",
    "d_taxonomy_first",
    "e_skeptic",
]


def resolve_variants(spec: list | None) -> list[dict]:
    """Resolve a config's `variants` list into variant dicts.

    Each entry is either a built-in variant id (string) or an inline dict with
    at least `system_prompt` (and optionally `id` / `temperature`).
    """
    entries = DEFAULT_VARIANT_ORDER if spec is None else spec
    resolved: list[dict] = []
    for i, entry in enumerate(entries):
        if isinstance(entry, str):
            if entry not in ENSEMBLE_VARIANTS:
                raise KeyError(
                    f"unknown ensemble variant {entry!r}; known: {sorted(ENSEMBLE_VARIANTS)}"
                )
            resolved.append(dict(ENSEMBLE_VARIANTS[entry]))
            continue
        if not isinstance(entry, dict) or "system_prompt" not in entry:
            raise ValueError(f"variant[{i}] must be a built-in id or a dict with 'system_prompt'")
        variant = dict(entry)
        variant.setdefault("id", f"inline_{i}")
        variant.setdefault("temperature", None)
        resolved.append(variant)
    return resolved


def _agreement_buckets(n: int) -> tuple[str, str, str]:
    """Confidence buckets phrased as fractions of n candidates.

    n=5 reproduces the pilot script's wording exactly
    ("5/5 or 4/5" / "3/5 or 2/5" / "1/5").
    """
    high_floor = max(2, math.ceil(0.8 * n))

    def fractions(counts: list[int]) -> str:
        return " or ".join(f"{k}/{n}" for k in counts)

    high = fractions(list(range(n, high_floor - 1, -1)))
    medium = fractions(list(range(high_floor - 1, 1, -1))) or f"2/{n}"
    return high, medium, f"1/{n}"


def build_judge_system_prompt(candidate_count: int) -> str:
    """Judge prompt, parameterised by ensemble size.

    Hardened 2026-08-11 against the three judge failure modes measured in
    runs/2026-08-11-local-lfm/SCORING.md: duplicate/synonym survivals
    ("Pizza" x3, "cheeseburger" + "Hamburger", "fries" + "French Fries"),
    hallucination leak-through (a non-food "napkin"; "lime wedges" and
    "guacamole" read off image 10's background menu poster), and merge variance
    (a real multi-candidate item such as sausages dropped, while a distinctive
    single-candidate item such as a Yorkshire pudding was folded away).

    The bullet list became numbered rules so each failure mode has an
    addressable instruction; the confidence-from-agreement and median-grams
    rules are preserved, and the agreement buckets stay parameterised by n.
    """
    n = candidate_count
    high, medium, low = _agreement_buckets(n)
    return (
        "You are a judge that merges multiple independent food-identification candidates "
        "for the same plate photo into one final, high-confidence result.\n\n"
        f"You will be given {n} candidate JSON food lists, each produced independently by "
        "a vision model looking at the same photo. You are MERGING, not identifying. Apply "
        "these rules in order:\n\n"
        "1. EACH REAL-WORLD FOOD APPEARS EXACTLY ONCE. Before you emit an item, compare it "
        "against every item you have already emitted and merge them if they name the same "
        'food: case variants ("Pizza" = "pizza"), synonyms ("cheeseburger" = "Hamburger", '
        '"fries" = "French Fries", "rice" = "white rice"), plural/singular ("sausage" = '
        '"sausages"), and a specific name of something you already listed generically '
        '("cheddar" belongs in "cheese"). Two output rows that differ only in wording are a '
        "bug, not two foods. Merge their grams and macros per rule 6 and keep ONE plain-"
        "language name.\n"
        "2. OUTPUT ONLY FOODS PHYSICALLY ON THE PHOTOGRAPHED PLATE / TABLE SETTING. Exclude "
        "non-food objects entirely (napkins, cutlery, plates, glasses, straws, packaging, "
        "table decorations) -- they are not food and must never become an item. Exclude any "
        "food a candidate can only have read off the background: dishes depicted in a menu, "
        "poster, sign, screen, wall art, or packaging illustration are NOT on the table, no "
        "matter how many candidates list them.\n"
        f"3. SINGLE-CANDIDATE ITEMS ARE KEPT ONLY IF DISTINCTIVE AND MAJOR. An item reported "
        f"by 2 or more of the {n} candidates is kept. An item reported by only ONE candidate "
        "is kept ONLY if it is a visually distinctive major component of the meal (e.g. a "
        "Yorkshire pudding, the main protein, a whole side dish) -- those are exactly the "
        "items a single sharper candidate spotted correctly. A minor, generic or garnish-"
        "level item reported by only one candidate is noise: drop it.\n"
        "4. NEVER INVENT AN ITEM. Every item you output must appear in at least one candidate "
        "list. Do not add foods you merely expect to accompany the meal.\n"
        '5. CONFIDENCE FROM AGREEMENT. Set "confidence" from the fraction of candidates that '
        f'agreed the item is present (counting rows you merged into it): {high} -> "high", '
        f'{medium} -> "medium", {low} -> "low".\n'
        '6. GRAMS AND MACROS FROM MEDIANS. For "estimatedGrams", take the median across the '
        "candidates that included the item (again counting merged rows). For each field of "
        '"macrosPer100g", take the median across the candidates that included the item AND '
        "provided a non-null value for that field; if none provided a non-null value, use "
        "null.\n"
        f'7. AT MOST {JUDGE_MAX_FOODS} ITEMS. The final "foods" array must hold between '
        f"{JUDGE_MIN_FOODS} and {JUDGE_MAX_FOODS} items -- never more. Prefer fewer, "
        "consolidated items, as the underlying product prompt instructs. If more than "
        f"{JUDGE_MAX_FOODS} survive rules 1-4, keep the {JUDGE_MAX_FOODS} with the strongest "
        "candidate agreement, breaking ties by portion size.\n\n"
        "Then re-read your own finished list once and merge any two rows that name the same "
        "food before you answer.\n\n"
        "Output ONLY the merged result in the exact same JSON schema used by the "
        "candidates -- no markdown, no commentary outside the JSON."
        + _SCHEMA_INSTRUCTIONS
    )


def build_judge_user_text(candidates: list[dict]) -> str:
    blocks = []
    for i, cand in enumerate(candidates):
        payload = {"foods": cand.get("foods", []), "notes": cand.get("notes")}
        blocks.append(
            f"Candidate {i + 1} ({cand.get('variant_id', '?')}):\n{json.dumps(payload)}"
        )
    return (
        f"Here are {len(candidates)} independent candidate identifications of the same "
        "plate photo:\n\n"
        + "\n\n".join(blocks)
        + "\n\nMerge them into one final result per your instructions."
    )


# ---------------------------------------------------------------------------
# Tolerant JSON extraction / structural validation
# ---------------------------------------------------------------------------


def strip_code_fence(text: str) -> str:
    trimmed = text.strip()
    match = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", trimmed)
    return match.group(1) if match else trimmed


def extract_first_json_object(text: str) -> str | None:
    """Find the first balanced {...} block, tolerant of surrounding prose."""
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def tolerant_parse_json(raw_text: str) -> dict | None:
    """Try, in order: whole-text parse, fenced-block parse, first {...} block."""
    candidates: list[str] = []
    stripped = strip_code_fence(raw_text)
    candidates.append(stripped)
    first_obj = extract_first_json_object(stripped)
    if first_obj is not None:
        candidates.append(first_obj)
    first_obj_raw = extract_first_json_object(raw_text)
    if first_obj_raw is not None:
        candidates.append(first_obj_raw)

    for candidate in candidates:
        try:
            return json.loads(candidate)
        except (json.JSONDecodeError, TypeError):
            continue
    return None


def validate_plate_identification(value) -> tuple[bool, list[str]]:
    """Loose structural validation mirroring PlateIdentificationSchema.

    Returns (ok, errors). Not a full Zod port -- just enough to know when a
    response is malformed and should be re-nudged.
    """
    errors: list[str] = []
    if not isinstance(value, dict):
        return False, ["response is not a JSON object"]
    if "foods" not in value or not isinstance(value["foods"], list):
        errors.append("missing or non-array 'foods'")
    else:
        for i, food in enumerate(value["foods"]):
            if not isinstance(food, dict):
                errors.append(f"foods[{i}] is not an object")
                continue
            for required_key in (
                "name",
                "estimatedGrams",
                "confidence",
                "portionHint",
                "macrosPer100g",
            ):
                if required_key not in food:
                    errors.append(f"foods[{i}] missing '{required_key}'")
            if "name" in food and not isinstance(food["name"], str):
                errors.append(f"foods[{i}].name is not a string")
            if "estimatedGrams" in food and not isinstance(food["estimatedGrams"], (int, float)):
                errors.append(f"foods[{i}].estimatedGrams is not a number")
            if "confidence" in food and food["confidence"] not in ("high", "medium", "low"):
                errors.append(f"foods[{i}].confidence is not high|medium|low")
    if "notes" in value:
        if value["notes"] is not None and not isinstance(value["notes"], str):
            errors.append("'notes' is not a string or null")
    else:
        errors.append("missing 'notes'")
    return (len(errors) == 0), errors
