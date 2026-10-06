"""A strict JSON Schema validator for the vision contract, standard library only.

`schema.validate_plate_identification` (the August validator) is deliberately loose: it checks that a few keys
exist. This one validates an answer against the schema the app actually sends in `response_format`, so
"schema-valid" in a result file means what a strict-mode provider would have enforced.

What it checks, per node:

    type          one name or a list of names; `null` is a type, so a nullable field is `anyOf` / a type list
    enum, const   exact membership
    properties    each present key against its own sub-schema
    required      every listed key is present
    additionalProperties
                  `false` rejects any key not in `properties`; a schema validates the extra keys
    items         every array element
    anyOf, oneOf, allOf
    minItems, maxItems, minimum, maximum, exclusiveMinimum, exclusiveMaximum, minLength, maxLength, pattern

Keywords that only annotate (`default`, `description`, `title`, `$schema`, `$id`, `examples`) are ignored. ANY OTHER
keyword raises `UnsupportedSchemaKeyword`: a validator that silently skips a rule it does not know reports every
answer valid, which is the one failure a validator must not have.

Booleans are not numbers (Python's `True == 1` would otherwise pass `"type": "number"`), and a non-finite number
(NaN, Infinity: Python's `json.loads` accepts them, JSON does not) is invalid.
"""

from __future__ import annotations

import math
import re

#: Keywords that describe a schema without constraining a value.
ANNOTATION_KEYWORDS = frozenset({"default", "description", "title", "$schema", "$id", "examples", "$comment"})

#: Keywords this validator enforces.
ENFORCED_KEYWORDS = frozenset(
    {
        "type",
        "enum",
        "const",
        "properties",
        "required",
        "additionalProperties",
        "items",
        "anyOf",
        "oneOf",
        "allOf",
        "minItems",
        "maxItems",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "minLength",
        "maxLength",
        "pattern",
    }
)


class UnsupportedSchemaKeyword(ValueError):
    """The schema uses a keyword this validator would have to ignore."""


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _is_integer(value) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and math.isfinite(value) and value.is_integer()


def _type_matches(value, type_name: str) -> bool:
    if type_name == "null":
        return value is None
    if type_name == "boolean":
        return isinstance(value, bool)
    if type_name == "string":
        return isinstance(value, str)
    if type_name == "number":
        return _is_number(value)
    if type_name == "integer":
        return _is_integer(value)
    if type_name == "array":
        return isinstance(value, list)
    if type_name == "object":
        return isinstance(value, dict)
    raise UnsupportedSchemaKeyword(f"unknown type name {type_name!r}")


def _describe(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _same_json_value(left, right) -> bool:
    """Equality that does not let `True` equal `1`, as Python's `==` would."""
    return left == right and isinstance(left, bool) == isinstance(right, bool)


def _check_keywords(schema: dict, path: str) -> None:
    for keyword in schema:
        if keyword in ENFORCED_KEYWORDS or keyword in ANNOTATION_KEYWORDS:
            continue
        raise UnsupportedSchemaKeyword(f"{path or '$'}: keyword {keyword!r} is not enforced by this validator")


def _validate(value, schema, path: str, errors: list[str]) -> None:
    if schema is True or schema == {}:
        return
    if schema is False:
        errors.append(f"{path}: no value is allowed here")
        return
    if not isinstance(schema, dict):
        raise UnsupportedSchemaKeyword(f"{path or '$'}: a schema must be an object or a boolean")
    _check_keywords(schema, path)

    if "type" in schema:
        names = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_type_matches(value, name) for name in names):
            errors.append(f"{path}: expected {' or '.join(names)}, got {_describe(value)}")
            return

    if "enum" in schema and not any(_same_json_value(value, member) for member in schema["enum"]):
        errors.append(f"{path}: {value!r} is not one of {schema['enum']}")
    if "const" in schema and not _same_json_value(value, schema["const"]):
        errors.append(f"{path}: expected {schema['const']!r}, got {value!r}")

    if "anyOf" in schema:
        branches = [_branch_errors(value, branch, path) for branch in schema["anyOf"]]
        if not any(not branch for branch in branches):
            errors.append(f"{path}: matches none of the {len(branches)} anyOf branches ({_first_reasons(branches)})")
    if "oneOf" in schema:
        branches = [_branch_errors(value, branch, path) for branch in schema["oneOf"]]
        matching = sum(1 for branch in branches if not branch)
        if matching != 1:
            errors.append(f"{path}: matches {matching} oneOf branches, expected exactly 1 ({_first_reasons(branches)})")
    if "allOf" in schema:
        for branch in schema["allOf"]:
            _validate(value, branch, path, errors)

    if isinstance(value, dict):
        _validate_object(value, schema, path, errors)
    if isinstance(value, list):
        _validate_array(value, schema, path, errors)
    if isinstance(value, str):
        _validate_string(value, schema, path, errors)
    if _is_number(value):
        _validate_number(value, schema, path, errors)


def _branch_errors(value, branch, path: str) -> list[str]:
    errors: list[str] = []
    _validate(value, branch, path, errors)
    return errors


def _first_reasons(branches: list[list[str]]) -> str:
    return "; ".join(branch[0] for branch in branches if branch)[:300]


def _validate_object(value: dict, schema: dict, path: str, errors: list[str]) -> None:
    properties = schema.get("properties") or {}
    for key in schema.get("required") or []:
        if key not in value:
            errors.append(f"{path}: missing required property {key!r}")
    for key, item in value.items():
        child = f"{path}.{key}"
        if key in properties:
            _validate(item, properties[key], child, errors)
            continue
        extra = schema.get("additionalProperties", True)
        if extra is False:
            errors.append(f"{path}: unexpected property {key!r}")
        elif extra is not True:
            _validate(item, extra, child, errors)


def _validate_array(value: list, schema: dict, path: str, errors: list[str]) -> None:
    if "minItems" in schema and len(value) < schema["minItems"]:
        errors.append(f"{path}: {len(value)} items, at least {schema['minItems']} required")
    if "maxItems" in schema and len(value) > schema["maxItems"]:
        errors.append(f"{path}: {len(value)} items, at most {schema['maxItems']} allowed")
    if "items" in schema:
        for index, item in enumerate(value):
            _validate(item, schema["items"], f"{path}[{index}]", errors)


def _validate_string(value: str, schema: dict, path: str, errors: list[str]) -> None:
    if "minLength" in schema and len(value) < schema["minLength"]:
        errors.append(f"{path}: shorter than {schema['minLength']}")
    if "maxLength" in schema and len(value) > schema["maxLength"]:
        errors.append(f"{path}: longer than {schema['maxLength']}")
    if "pattern" in schema and re.search(schema["pattern"], value) is None:
        errors.append(f"{path}: does not match {schema['pattern']!r}")


def _validate_number(value, schema: dict, path: str, errors: list[str]) -> None:
    if "minimum" in schema and value < schema["minimum"]:
        errors.append(f"{path}: {value} is below {schema['minimum']}")
    if "maximum" in schema and value > schema["maximum"]:
        errors.append(f"{path}: {value} is above {schema['maximum']}")
    if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
        errors.append(f"{path}: {value} is not above {schema['exclusiveMinimum']}")
    if "exclusiveMaximum" in schema and value >= schema["exclusiveMaximum"]:
        errors.append(f"{path}: {value} is not below {schema['exclusiveMaximum']}")


def validate(value, schema) -> list[str]:
    """Every way `value` breaks `schema`, as short path-prefixed messages. Empty means valid.

    Raises `UnsupportedSchemaKeyword` when the schema uses a keyword this module does not enforce.
    """
    errors: list[str] = []
    _validate(value, schema, "$", errors)
    return errors


def is_valid(value, schema) -> bool:
    return not validate(value, schema)


def assert_strict_mode_schema(schema, path: str = "$") -> None:
    """The OpenAI strict-mode rules the app's schemas follow: raise when a schema node breaks one.

    Every object node lists ALL its properties in `required` and sets `additionalProperties: false`. A schema
    that fails this is not what the app sends, so a validator run against it would measure something else.
    """
    if not isinstance(schema, dict):
        return
    _check_keywords(schema, path)
    properties = schema.get("properties")
    if properties is not None:
        if schema.get("additionalProperties") is not False:
            raise ValueError(f"{path}: an object node must set additionalProperties to false")
        if sorted(schema.get("required") or []) != sorted(properties):
            raise ValueError(f"{path}: required must list every property")
        for key, child in properties.items():
            assert_strict_mode_schema(child, f"{path}.{key}")
    if "items" in schema:
        assert_strict_mode_schema(schema["items"], f"{path}[]")
    for combinator in ("anyOf", "oneOf", "allOf"):
        for index, branch in enumerate(schema.get(combinator) or []):
            assert_strict_mode_schema(branch, f"{path}.{combinator}[{index}]")
