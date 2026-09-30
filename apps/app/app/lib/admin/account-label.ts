/**
 * The operator's label on an account, as the console edits it.
 *
 * The core owns the rule (`PROTOCOL.md` §5.20): at most 40 characters, one
 * line, trimmed, and blank means none. This module is what the Change form on
 * a person's page needs from it, kept out of the component so a test can reach
 * it without a render.
 */

/**
 * The core's bound on a label, in characters. The form field's `maxLength`
 * counts UTF-16 units, which is never more permissive than the core's code
 * points, so the field cannot hold a label the core refuses.
 */
export const MAX_ACCOUNT_LABEL_LENGTH = 40;

/**
 * The typed label as the core stores it: trimmed, and `null` when blank, which
 * takes the label away.
 *
 * @param typed - what the field holds.
 * @returns the label to send, or `null` for none.
 */
export function readAccountLabel(typed: string): string | null {
  const trimmed = typed.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * What a save sends for the label: the new value, or `undefined` when the field
 * says what the account already carries.
 *
 * UNCHANGED IS NOT SENT, for two reasons. A core built before labels never
 * receives a key it does not know, and a save that only moved the allowance
 * cannot overwrite a label a colleague set in another tab.
 *
 * @param input.typed - what the field holds.
 * @param input.current - the label the account carried when the form opened.
 * @returns the label to send, `null` to take it away, or `undefined` to leave it alone.
 */
export function changedAccountLabel(input: { typed: string; current: string | null }): string | null | undefined {
  const next = readAccountLabel(input.typed);
  return next === input.current ? undefined : next;
}
