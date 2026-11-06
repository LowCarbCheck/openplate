/**
 * The two body fields a person sends about activity reminders, on
 * `POST /v1/auth/signup` and `PATCH /v1/auth/account`: `activityMail` and
 * `language`.
 *
 * ABSENT IS NOT FALSE. `undefined` means the body said nothing, which the
 * caller turns into "no consent" at sign-up and "leave it alone" on a PATCH.
 * A present value that is not a boolean, or not one of the six languages, is
 * a 400 like every other malformed field, so a client bug is not read as a
 * person's answer.
 */
import type { ParseResult } from '../accounts/auth-input.js';
import type { JsonValue } from '../lib/json.js';
import { INSTANCE_LANGUAGES, isInstanceLanguage, type InstanceLanguage } from '../protocol.js';

/** What the body said: both fields, each `undefined` when absent. */
export interface ActivityMailFields {
  activityMail: boolean | undefined;
  language: InstanceLanguage | undefined;
}

export function parseActivityMailFields(input: {
  activityMail: JsonValue | undefined;
  language: JsonValue | undefined;
}): ParseResult<ActivityMailFields> {
  const { activityMail, language } = input;
  if (activityMail !== undefined && activityMail !== true && activityMail !== false) {
    return { ok: false, reason: 'activityMail must be true or false' };
  }
  if (language !== undefined && !isInstanceLanguage(language)) {
    return { ok: false, reason: `language must be one of ${INSTANCE_LANGUAGES.join(', ')}` };
  }
  return { ok: true, value: { activityMail, language } };
}
