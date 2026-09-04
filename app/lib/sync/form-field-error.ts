/**
 * A refusal from the SERVICE that belongs under one particular field.
 *
 * ── Why an error class and not a second return value ─────────────────────
 *
 * The sync ceremony's `provision` contract is "reject on failure, and anything
 * you throw is the failure" (`sync-setup-flow.tsx`). That is what keeps a
 * half-completed setup impossible. But some of the service's refusals are
 * about a field the person can still see and fix — "that invitation is no
 * longer valid" — and a message about one field, rendered under the submit
 * button, is the shape the owner asked us to stop producing (2026-09-02).
 *
 * So the throw carries the field with it. Everything else keeps throwing an
 * ordinary `Error` and lands, as before, on the failure screen with a retry.
 *
 * The message is ALREADY TRANSLATED copy: the thrower is the surface that
 * knows the service's status code, and `PROTOCOL.md` §4 is explicit that a
 * client branches on the status rather than on the service's own English
 * prose.
 */

/**
 * The signup fields a service refusal can be attributed to.
 *
 * ONE, since M192: the form no longer collects a sign-in name, because the
 * address comes from the invite. The type is kept as a union rather than
 * collapsed to a literal so that adding a second field is a member rather than
 * a refactor of every signature that mentions it.
 */
export type SyncFormField = 'invite';

/**
 * A refusal plus the field it belongs under, or `null` for one that belongs to
 * the form.
 *
 * Named rather than written inline at each `return`: the surface that maps the
 * service's statuses to copy (`create-account-panel.tsx`'s
 * `describeSignupError`) has four branches, and this is the contract they all
 * owe.
 */
export type SyncRefusal = { field: SyncFormField | null; message: string };

/** A failure the user can fix in a named field, rather than one they can only retry. */
export class SyncFieldError extends Error {
  readonly field: SyncFormField;

  constructor(field: SyncFormField, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SyncFieldError';
    this.field = field;
  }
}

/**
 * The field a caught failure belongs to, or `null` when it belongs to the form.
 *
 * @param cause - anything a `catch` produced.
 */
export function readSyncErrorField(cause: unknown): SyncFormField | null {
  return cause instanceof SyncFieldError ? cause.field : null;
}
