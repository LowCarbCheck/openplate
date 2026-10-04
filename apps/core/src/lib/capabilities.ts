/**
 * Capabilities: named permissions an account holds for the AI proxy.
 *
 * WHAT A CAPABILITY IS. A short lower case label, such as `scan` or `recipes`,
 * that says one kind of AI request this account may make. The proxy checks the
 * label a request names against what the account holds, before it counts the
 * request and before anything leaves the host (`ai/proxy.ts`).
 *
 * THIS FILE IS PURE AND KNOWS NO PLAN. The instance does not know why an
 * account holds a label. A biller writes labels the same way an operator does,
 * and this service reads them the same way for both.
 *
 * ── NULL IS "NO RECORD", AND AN EMPTY LIST IS "NONE" ────────────────────────
 * An account's own record has three states, and they are three different
 * facts:
 *
 *   `null`      no record. The instance default decides.
 *   `[]`        a record that grants nothing. The account may use no feature.
 *   `['scan']`  a record that grants exactly these labels.
 *
 * The EFFECTIVE value is the account's own record, else the instance default
 * (`DEFAULT_CAPABILITIES`), else `null`. And an effective `null` means NO
 * CHECK AT ALL: every request passes. That is what a self-hosted instance,
 * which sets nothing, has always had, and it is why an instance that never
 * configures this behaves exactly as it did before the field existed.
 *
 * ── THE RESERVED LABEL `none` ───────────────────────────────────────────────
 * `DEFAULT_CAPABILITIES` is read from an environment variable, and the compose
 * files forward every variable as `NAME: ${NAME:-}`, so an unset variable
 * reaches the process as the EMPTY STRING. An empty value therefore has to
 * mean "not configured", the same as unset (`tests/unit/compose-defaults-inert.test.ts`
 * holds every parser to that). The instance default that grants nothing needs
 * a spelling of its own, and it is the word `none`. So `none` is reserved: no
 * account may hold a capability called that, and a list that names it is
 * refused.
 */

import { asArray, asString, type JsonValue } from './json.js';

/** A label: a lower case letter, then lower case letters, digits and hyphens, at most 32 characters. */
export const CAPABILITY_LABEL_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** The most labels one list may carry. A bound, so a list in a row or an env value stays a list a person can read. */
export const MAX_CAPABILITIES = 32;

/** The word that spells "grants nothing" in `DEFAULT_CAPABILITIES`. It cannot be a label. See the header. */
export const NO_CAPABILITIES_WORD = 'none';

/** What {@link parseCapabilityLabels} gives back: the clean list, or a sentence for the 400. */
export type ParsedCapabilities = { ok: true; value: string[] } | { ok: false; reason: string };

/** Whether a string is a valid capability label. `none` is not one. */
export function isCapabilityLabel(value: string): boolean {
  return value !== NO_CAPABILITIES_WORD && CAPABILITY_LABEL_PATTERN.test(value);
}

/** A list with its duplicates removed and its labels in alphabetical order, so the same grant is always the same list. */
export function normalizeCapabilities(labels: readonly string[]): string[] {
  return [...new Set(labels)].toSorted();
}

/**
 * Checks a list of labels, from a PATCH body, a CLI flag or an env value, and
 * returns it normalized. It refuses rather than repairs: a label that is
 * trimmed or lower-cased on the way in is a grant the caller did not write.
 */
export function parseCapabilityLabels(labels: readonly string[]): ParsedCapabilities {
  if (labels.length > MAX_CAPABILITIES) {
    return { ok: false, reason: `capabilities may hold at most ${MAX_CAPABILITIES} labels` };
  }
  for (const label of labels) {
    if (label === NO_CAPABILITIES_WORD) {
      return { ok: false, reason: `"${NO_CAPABILITIES_WORD}" is reserved and cannot be a capability` };
    }
    if (!CAPABILITY_LABEL_PATTERN.test(label)) {
      return {
        ok: false,
        reason:
          'a capability is a lower case letter followed by up to 31 lower case letters, digits or hyphens, for example "scan"',
      };
    }
  }
  return { ok: true, value: normalizeCapabilities(labels) };
}

/** The `capabilities` field of a JSON body: an array of label strings. `null` is the caller's to handle, not this function's. */
export function parseCapabilityArray(value: JsonValue | undefined): ParsedCapabilities {
  const items = asArray(value);
  if (items === null) return { ok: false, reason: 'capabilities must be an array of labels, or null' };
  const labels: string[] = [];
  for (const item of items) {
    const label = asString(item);
    if (label === null) return { ok: false, reason: 'capabilities must be an array of labels, or null' };
    labels.push(label);
  }
  return parseCapabilityLabels(labels);
}

/**
 * What `DEFAULT_CAPABILITIES` means. Unset, empty or only white space is
 * `null`, no default and no check. The word `none` is the empty list. Anything
 * else is a comma separated list of labels.
 *
 * Throws on a malformed list, and names the variable: this runs at boot, and
 * an instance that guesses at its own permissions is worse than one that does
 * not start.
 */
export function parseDefaultCapabilities(raw: string | undefined): string[] | null {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return null;
  if (trimmed === NO_CAPABILITIES_WORD) return [];
  const parsed = parseCapabilityLabels(trimmed.split(',').map((label) => label.trim()));
  if (!parsed.ok) {
    throw new Error(
      `DEFAULT_CAPABILITIES is not valid: ${parsed.reason}. Use comma separated labels such as "scan,recipes", or "${NO_CAPABILITIES_WORD}" for no capability at all.`,
    );
  }
  return parsed.value;
}

/** The capabilities an account really has: its own record, else the instance default, else `null` (no check). */
export function effectiveCapabilities(input: {
  own: readonly string[] | null;
  instanceDefault: readonly string[] | null;
}): readonly string[] | null {
  return input.own ?? input.instanceDefault;
}

/** Whether the effective capabilities allow a label. `null` allows everything: there is no check to fail. */
export function allowsCapability(input: { effective: readonly string[] | null; label: string }): boolean {
  if (input.effective === null) return true;
  return input.effective.includes(input.label);
}

/** The name a client gives a structured-output schema: what OpenAI accepts, so a name that reaches the map is one a provider would take. */
const SCHEMA_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * What `CAPABILITY_SCHEMA_MAP` means: comma separated `schemaName:label` pairs,
 * such as `scan_result:scan,recipe_list:recipes`. Unset or empty is an empty
 * map, which makes no schema name require anything.
 *
 * The map exists because the feature header is the CLIENT's word. A request
 * whose body asks for a schema the operator tied to a label needs that label
 * whatever the header says, so a caller that lies in the header gains nothing.
 *
 * Throws on a malformed entry or a repeated schema name, naming the variable.
 */
export function parseCapabilitySchemaMap(raw: string | undefined): ReadonlyMap<string, string> {
  const trimmed = raw?.trim() ?? '';
  const map = new Map<string, string>();
  if (trimmed === '') return map;
  for (const entry of trimmed.split(',')) {
    const [schemaName, label, ...rest] = entry.split(':').map((part) => part.trim());
    if (schemaName === undefined || label === undefined || rest.length > 0) {
      throw new Error(`CAPABILITY_SCHEMA_MAP entry "${entry.trim()}" is not schemaName:label.`);
    }
    if (!SCHEMA_NAME_PATTERN.test(schemaName)) {
      throw new Error(`CAPABILITY_SCHEMA_MAP schema name "${schemaName}" is not 1 to 64 letters, digits, "_" or "-".`);
    }
    if (!isCapabilityLabel(label)) {
      throw new Error(`CAPABILITY_SCHEMA_MAP label "${label}" for "${schemaName}" is not a valid capability label.`);
    }
    if (map.has(schemaName)) {
      throw new Error(`CAPABILITY_SCHEMA_MAP names the schema "${schemaName}" twice.`);
    }
    map.set(schemaName, label);
  }
  return map;
}

/** A copy of a capability list for a response body, so a body never aliases the instance's own list. */
export function toWireCapabilities(value: readonly string[] | null): string[] | null {
  return value === null ? null : [...value];
}
