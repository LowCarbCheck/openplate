/**
 * Puts zod's compacted type unions back into the `anyOf` form the wire schema
 * has always had.
 *
 * WHY THIS EXISTS. zod 4.6.7 (the first release past GHSA-mrhx-c7xc-m3w5, a
 * high severity memory exhaustion on an oversized array) changed `z.toJSONSchema`
 * for a nullable field from
 *
 *   { "anyOf": [{ "type": "string" }, { "type": "null" }] }
 *
 * to
 *
 *   { "type": ["string", "null"] }
 *
 * zod only folds an `anyOf` whose branches are all a bare `{ type }`, so this
 * walk is the exact inverse: every `type` array becomes an `anyOf` of one bare
 * `{ type }` per member, put first in the node, ahead of the other keywords, as
 * zod emitted it before. The inverse is exact except for one case that never
 * occurs here: zod also de-duplicates the members of a nested union when it
 * folds, and that cannot be recovered.
 *
 * THE WIRE SHAPE IS PINNED. This schema is what is sent to the AI models as the
 * structured output contract. A change to it, even an equivalent spelling, goes
 * out only after a provider test shows the providers accept and honour it. Do
 * not remove this helper to "follow zod" before that test exists.
 *
 * Pure: the input is never modified, and the result shares no node with it
 * except leaf values such as `enum` arrays.
 */
/** A JSON value, which is all `z.toJSONSchema` ever emits. */
export type JsonSchemaValue = string | number | boolean | null | JsonSchemaValue[] | JsonSchemaObject;

export interface JsonSchemaObject {
  [keyword: string]: JsonSchemaValue;
}

/** Keywords whose value is one schema (or, in old drafts, a list of them). */
const SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  'items',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'not',
  'contains',
  'propertyNames',
  'if',
  'then',
  'else',
  'anyOf',
  'allOf',
  'oneOf',
  'prefixItems',
]);

/** Keywords whose value is a map from a name to a schema. */
const SCHEMA_MAP_KEYWORDS: ReadonlySet<string> = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
]);

/** A plain object, as `JSON.parse`, `structuredClone` and zod build them. Arrays and `null` are not. */
function isJsonObject(value: JsonSchemaValue): value is JsonSchemaObject {
  return value?.constructor === Object;
}

function restoreSchemaValue(value: JsonSchemaValue): JsonSchemaValue {
  if (Array.isArray(value)) return value.map(restoreSchemaValue);
  if (!isJsonObject(value)) return value;
  return restoreAnyOfTypeUnions(value);
}

function restoreKeywordValue(keyword: string, value: JsonSchemaValue): JsonSchemaValue {
  if (SCHEMA_KEYWORDS.has(keyword)) return restoreSchemaValue(value);
  if (!SCHEMA_MAP_KEYWORDS.has(keyword) || !isJsonObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, restoreSchemaValue(child)]));
}

/**
 * @param schema - the finished output of `z.toJSONSchema`
 * @returns a copy in which every `type: [A, B, ...]` node is `anyOf: [{ type: A }, { type: B }, ...]`
 */
export function restoreAnyOfTypeUnions(schema: JsonSchemaObject): JsonSchemaObject {
  const walked = Object.fromEntries(
    Object.entries(schema).map(([keyword, value]) => [keyword, restoreKeywordValue(keyword, value)]),
  );
  const { type, ...rest } = walked;
  // A node that has both keywords was written by hand, not folded by zod: leave it.
  if (!Array.isArray(type) || type.length < 2 || 'anyOf' in rest) return walked;
  return { anyOf: type.map((member) => ({ type: member })), ...rest };
}
