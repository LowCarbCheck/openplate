/**
 * WHAT AN ADMINISTRATOR CAN SEE ABOUT ONE PERSON, and the copy that says so,
 * tied together field by field (M201 spec 06).
 *
 * ── Why a table and not a paragraph ──────────────────────────────────────
 *
 * M196 exists because a managed instance rendered privacy copy written for an
 * open one. The fix there was to write the managed sentences; it did not stop
 * the same drift happening again, and spec 04 immediately proved that: it put
 * `lastSeenAt` and a day-by-day strip on the operator's screen, and every
 * sentence in the app about what an operator can see stayed exactly as it was.
 *
 * So the list is not prose. It is a `Record` over the very type the admin API
 * hands the console, `AdminAccountView`, and every field in it has to be
 * answered: either with the copy key that names it to the person it is about,
 * or with a written reason for having no line. A field added to
 * `accountViewSchema` without an entry does not compile, and
 * `tests/unit/operator-visibility.test.ts` proves the same thing at runtime
 * against a fixture rather than arguing it.
 *
 * ── What this construction CANNOT do ─────────────────────────────────────
 *
 * The same honest limit M199 spec 01 wrote down for its identifier checker.
 * The list of limits lives beside the test, in one place, and this is a
 * pointer to it rather than a second copy that could drift from it.
 *
 * ── Reading order, not wire order ────────────────────────────────────────
 *
 * The entries are declared in the order a person would want to read them, not
 * in the order `accountViewSchema` declares them. Totality is what is
 * enforced, and totality does not care about order, so the order is free to
 * serve the reader: who you are first, then when, then the photo counters,
 * then the two facts about standing.
 */
import type { z } from 'zod';

import { accountViewSchema, type AdminAccountView } from '#app/lib/admin/admin-wire';

/**
 * An admin response object, read only for the NAMES of its fields.
 *
 * The loosest schema `fieldsOfSchema` can answer for, so the fixture in the
 * test beside this module may carry one field more than the real view without
 * the two having to be the same type.
 */
type AdminObjectSchema = z.ZodObject<Record<string, z.ZodType>>;

/**
 * How long the service keeps one person's daily photo counts, in days.
 *
 * TRANSCRIBED FROM `openplate-core/PROTOCOL.md` §5.20, where it is normative
 * for every conforming server: an hourly sweep deletes every `ai_usage_days`
 * row older than this, on every instance and without an operator action, and
 * the activity endpoint refuses to draw a longer window because a longer strip
 * could only be zeroes for rows that are gone.
 *
 * IT IS NOT READ FROM THE SERVER, and that is a limit rather than a design.
 * The feedback retention window is advertised on `/health` and this app
 * refuses to state it without that handshake (M200 spec 06); this number has
 * no such field, and the endpoint that reports its own `window` is an
 * ADMINISTRATOR's endpoint that the person this copy is written for may never
 * call. So the number is stated from the protocol, the protocol is the same
 * document the version handshake pins the rest of the wire to, and the test
 * beside this module lists "the number is still 90 on the instance this build
 * talks to" among the things it cannot check.
 */
export const USAGE_COUNTER_RETENTION_DAYS = 90;

/**
 * One field of the admin account view, answered.
 *
 * Two shapes and no third: a field is either named to the person it describes,
 * or it is deliberately not named and carries the reason. `noLine` is not a
 * loophole that makes the check vacuous, it is the same escape M199 spec 01
 * required, "a claim that is deliberately not checkable is listed in one place,
 * with the reason". Reaching for it is a deliberate act that a reviewer reads.
 */
export type OperatorVisibility = { readonly copyKey: string } | { readonly noLine: string };

/**
 * Every field of `AdminAccountView`, and the line of copy that discloses it.
 *
 * `satisfies` rather than an annotation, so the object keeps its literal keys
 * for `OPERATOR_VISIBLE_LINES` below while the compiler still demands one
 * entry per field of the view.
 */
export const OPERATOR_VISIBILITY = {
  email: { copyKey: 'account.operatorSees.email' },
  displayName: { copyKey: 'account.operatorSees.displayName' },
  createdAt: { copyKey: 'account.operatorSees.createdAt' },
  lastSeenAt: { copyKey: 'account.operatorSees.lastSeenAt' },
  aiUsedToday: { copyKey: 'account.operatorSees.aiUsedToday' },
  dailyAiLimit: { copyKey: 'account.operatorSees.dailyAiLimit' },
  role: { copyKey: 'account.operatorSees.role' },
  suspendedAt: { copyKey: 'account.operatorSees.suspendedAt' },
  // THE TWO M212 FIELDS. Both are facts about this person's standing, both are
  // on the operator's screen, and both therefore get a line rather than a
  // reason: an allowance that ends on a date is the one thing somebody most
  // wants to know an administrator can move, and a count of invitations left
  // says how many addresses this account has already handed over.
  allowanceExpiresAt: { copyKey: 'account.operatorSees.allowanceExpiresAt' },
  invitesLeft: { copyKey: 'account.operatorSees.invitesLeft' },
  // THE ONE FIELD WITH NO LINE. It is the primary key of the account row: an
  // administrator does see it, and it says nothing about the person that the
  // address above it does not say better. A line for it would spend a
  // reader's attention on the fact that databases number their rows, and the
  // list is short on purpose so that the lines which do matter get read.
  id: { noLine: 'the account row number, which describes the database and not the person' },
} satisfies Record<keyof AdminAccountView, OperatorVisibility>;

/** One disclosed field: the wire name, and the key of the sentence that discloses it. */
export interface OperatorVisibleLine {
  readonly field: string;
  readonly copyKey: string;
}

/**
 * The lines the card draws, in declaration order.
 *
 * DERIVED, so the card cannot render a subset. A component that listed the
 * keys itself would let a key exist in the table, pass the coupling test, and
 * never reach a screen, which is precisely the failure
 * `managed-instance-copy.test.ts` was written for: a `*Managed` twin in the
 * catalog with no call site.
 */
export const OPERATOR_VISIBLE_LINES: readonly OperatorVisibleLine[] = Object.entries(OPERATOR_VISIBILITY).flatMap(
  ([field, entry]) => ('copyKey' in entry ? [{ field, copyKey: entry.copyKey }] : []),
);

/**
 * The field names an object schema exposes.
 *
 * Takes the schema rather than reading `accountViewSchema` directly, so the
 * test can hand it a fixture that has one field more than the real one and
 * watch the check fail.
 *
 * `keyof().options` rather than the schema's own field map: zod already
 * publishes the field names as a literal union, and reading them from there
 * keeps this module naming a role rather than a structure.
 *
 * @param schema - an object schema, normally `accountViewSchema`.
 * @returns its field names, in declaration order.
 */
export function fieldsOfSchema(schema: AdminObjectSchema): readonly string[] {
  return schema.keyof().options;
}

/**
 * The fields nobody has answered for.
 *
 * @param input.fields - the field names the admin view exposes.
 * @param input.visibility - the table above, or a fixture standing in for it.
 * @returns every exposed field with no entry, plus every entry naming a field
 *   that is not exposed, each tagged with which way round it is wrong.
 */
export function unansweredAdminFields(input: {
  fields: readonly string[];
  visibility: Readonly<Record<string, OperatorVisibility>>;
}): string[] {
  const { fields, visibility } = input;
  const exposed = new Set(fields);
  const undisclosed = fields.filter((field) => !(field in visibility)).map((field) => `exposed, no line: ${field}`);
  const invented = Object.keys(visibility)
    .filter((field) => !exposed.has(field))
    .map((field) => `named in the copy, not exposed: ${field}`);
  return [...undisclosed, ...invented];
}

/** The real question this module is about, resolved once so callers do not re-key it. */
export const ADMIN_ACCOUNT_FIELDS = fieldsOfSchema(accountViewSchema);
