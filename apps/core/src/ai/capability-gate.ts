/**
 * The capability check of the AI proxy, as one pure decision.
 *
 * WHAT IT DECIDES. Whether the account may make THIS request, given the
 * capabilities it holds (`lib/capabilities.ts`), the feature the request
 * names and the structured-output schema its body asks for. The proxy calls it
 * once, after the allowance and before it counts anything, so a refused
 * request writes no usage row, takes no scan and reaches no provider.
 *
 * ── TWO WAYS A REQUEST NAMES A FEATURE ──────────────────────────────────────
 * 1. THE HEADER, `X-Openplate-Feature: <label>`. It is the CLIENT's word, so
 *    on its own it protects nothing: a client that wants a feature it does not
 *    hold can name one it does.
 * 2. THE SCHEMA. A body that asks for `response_format.json_schema.name` the
 *    operator tied to a label (`CAPABILITY_SCHEMA_MAP`) needs that label
 *    WHATEVER THE HEADER SAYS. The name is what the provider is actually asked
 *    to produce, so a lie in the header gains nothing. A request that names a
 *    mapped schema is checked against the mapped label first, then against the
 *    header's.
 *
 * ── WHEN NOTHING IS CHECKED ─────────────────────────────────────────────────
 * An effective `null` (no record on the account and no instance default) is NO
 * CHECK AT ALL: not even a malformed header is refused, so an instance that
 * sets nothing behaves exactly as it did before capabilities existed. And a
 * request that names no feature and no mapped schema asks for nothing the gate
 * can compare, so it passes: the schema map is what makes a feature
 * enforceable against a client that sends no header.
 */
import { allowsCapability, CAPABILITY_LABEL_PATTERN } from '../lib/capabilities.js';
import { asObject, asString, type JsonObject } from '../lib/json.js';

/** The `error` of the `403` for a feature the account does not hold. A code: a client branches on it. */
export const CAPABILITY_REQUIRED = 'capability-required';

/** The `error` of the `400` for a feature header that is not a label. */
export const FEATURE_HEADER_INVALID = 'feature-header-invalid';

/** What the gate answers. */
export type CapabilityDecision =
  | { kind: 'allowed' }
  | { kind: 'refused'; status: 400; error: typeof FEATURE_HEADER_INVALID }
  | { kind: 'refused'; status: 403; error: typeof CAPABILITY_REQUIRED; capability: string };

export interface CapabilityGateInput {
  /** The account's effective capabilities, `null` for no check. */
  effective: readonly string[] | null;
  /** The raw `X-Openplate-Feature` value, or `undefined` when the request sent none. */
  featureHeader: string | undefined;
  /** The `CAPABILITY_SCHEMA_MAP`. */
  schemaMap: ReadonlyMap<string, string>;
  /** The body the provider will receive. */
  body: JsonObject;
}

/** The structured-output schema name a body asks for, or `null` when it asks for none. */
export function schemaNameOf(body: JsonObject): string | null {
  const format = asObject(body.response_format);
  const schema = asObject(format?.json_schema);
  return asString(schema?.name);
}

export function decideCapability(input: CapabilityGateInput): CapabilityDecision {
  const { effective } = input;
  if (effective === null) return { kind: 'allowed' };

  const header = input.featureHeader?.trim();
  if (header !== undefined && !CAPABILITY_LABEL_PATTERN.test(header)) {
    return { kind: 'refused', status: 400, error: FEATURE_HEADER_INVALID };
  }

  const schemaName = schemaNameOf(input.body);
  const mapped = schemaName === null ? undefined : input.schemaMap.get(schemaName);
  for (const label of [mapped, header]) {
    if (label === undefined) continue;
    if (!allowsCapability({ effective, label })) {
      return { kind: 'refused', status: 403, error: CAPABILITY_REQUIRED, capability: label };
    }
  }
  return { kind: 'allowed' };
}
