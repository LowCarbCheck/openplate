/**
 * The operator's label on an account (`accounts.label`), such as
 * "Beta supporter".
 *
 * ONE BOUND, NAMED ONCE. The schema's check constraint and the admin write
 * path both read {@link MAX_ACCOUNT_LABEL_LENGTH}, so the database and the
 * route cannot disagree about what fits.
 *
 * AN OPERATOR FACT. An admin sets it (`PATCH /v1/admin/accounts/:id`), the
 * admin API reports it, and nothing else reads it: it is never an
 * authorization input, and the account's own `GET /v1/auth/account` does not
 * carry it. It is how an operator remembers why one row is special.
 *
 * KEEP THIS MODULE'S IMPORTS TO `lib/json.ts`. `db/schema.ts` imports the bound
 * from here, and drizzle-kit loads the schema on its own to generate a
 * migration, so everything this file pulls in is loaded by that tool too. The
 * `sync-api` CLI checks a label with the same parser before it sends one, and
 * that CLI may not reach `src/accounts/` or `src/db/` at all
 * (`tests/unit/sync-api-no-db-imports.test.ts`).
 */
import { asString, type JsonValue } from '../lib/json.js';

/** A parsed label: what to store, `null` to clear it, or why it was refused. */
export type AccountLabelParse = { ok: true; value: string | null } | { ok: false; reason: string };

/**
 * The longest label an account may carry, in Unicode code points. Postgres
 * `char_length` counts the same unit, so a label the route accepts is one the
 * check constraint accepts.
 */
export const MAX_ACCOUNT_LABEL_LENGTH = 40;

/** Any C0 or C1 control character, a line break or a tab among them. A label is one line of plain text. */
const CONTROL_CHARACTER = /\p{Cc}/u;

/** The one sentence every refused label gets, so the route and a test name the same rule. */
export const ACCOUNT_LABEL_REFUSAL = `label must be a single line of at most ${MAX_ACCOUNT_LABEL_LENGTH} characters, or null to clear it`;

/**
 * The `label` field of an admin PATCH body.
 *
 * `null` CLEARS IT, and so does a string that is blank once trimmed, the way
 * `displayName` treats a blank name: an empty string is not a label, and the
 * check constraint refuses one. A label is trimmed before it is stored.
 *
 * REFUSED, NEVER CUT. A label longer than {@link MAX_ACCOUNT_LABEL_LENGTH}
 * code points, one with a control character, and anything that is not a string
 * are a `400`. Cutting it short would store a note the operator did not write.
 *
 * @param value - the field as the body carried it.
 * @returns the label to store, `null` to clear it, or the refusal.
 */
export function parseAccountLabel(value: JsonValue): AccountLabelParse {
  if (value === null) return { ok: true, value: null };
  const raw = asString(value);
  if (raw === null) return { ok: false, reason: ACCOUNT_LABEL_REFUSAL };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (CONTROL_CHARACTER.test(trimmed)) return { ok: false, reason: ACCOUNT_LABEL_REFUSAL };
  // CODE POINTS, NOT `length`. A string's `length` counts UTF-16 units, so one
  // emoji is two of them; spreading counts what Postgres `char_length` counts.
  if ([...trimmed].length > MAX_ACCOUNT_LABEL_LENGTH) return { ok: false, reason: ACCOUNT_LABEL_REFUSAL };
  return { ok: true, value: trimmed };
}
