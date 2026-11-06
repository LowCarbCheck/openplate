/**
 * The token in a reminder's unsubscribe link: `<accountId>.<mac>`, where
 * `mac` is base64url `HMAC-SHA-256(key, "<accountId>")` under its own subkey of
 * `SERVER_SECRET` (`lib/server-secrets.ts`, label
 * `openplate-core:activity-mail-unsubscribe:v1`).
 *
 * WHAT IT GRANTS IS ONE THING: turning this account's reminders off. It
 * cannot sign anybody in, read anything or turn reminders on, so it does not
 * expire and does not change when the person opts in again. A link in a mail
 * from last year still does the one thing it says.
 *
 * IT IS STILL NOT LOGGED. It names an account and proves the holder read that
 * account's mail, which is more than a log line needs.
 *
 * CONSTANT TIME. The mac is compared with `timingSafeEqual` after a length
 * check on the decoded bytes, so a caller learns nothing from how long a wrong
 * guess took.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** The SHA-256 output length, which every valid mac decodes to. */
const MAC_BYTES = 32;

/** A positive Postgres `serial`: no sign, no leading zero, at most ten digits. */
const ACCOUNT_ID_PATTERN = /^[1-9][0-9]{0,9}$/;

/** The largest value a Postgres `integer` holds. */
const MAX_ACCOUNT_ID = 2_147_483_647;

/** base64url, unpadded, as `Buffer.toString('base64url')` writes it. */
const MAC_PATTERN = /^[A-Za-z0-9_-]+$/;

function macOf(input: { key: string; accountId: number }): Buffer {
  return createHmac('sha256', input.key).update(String(input.accountId)).digest();
}

export function signUnsubscribeToken(input: { key: string; accountId: number }): string {
  return `${input.accountId}.${macOf(input).toString('base64url')}`;
}

/**
 * The account a token names, or `null` for anything that is not a token this
 * key signed: a wrong mac, a wrong id, a truncated or padded value. One
 * answer for every failure, so the route can show one page for all of them.
 */
export function verifyUnsubscribeToken(input: { key: string; token: string }): number | null {
  const parts = input.token.split('.');
  if (parts.length !== 2) return null;
  const [idPart = '', macPart = ''] = parts;
  if (!ACCOUNT_ID_PATTERN.test(idPart) || !MAC_PATTERN.test(macPart)) return null;
  const accountId = Number(idPart);
  if (accountId > MAX_ACCOUNT_ID) return null;

  const presented = Buffer.from(macPart, 'base64url');
  if (presented.length !== MAC_BYTES) return null;
  // The canonical form only: a second encoding of the same bytes is not a token
  // this service wrote, and accepting it would make two links for one account.
  if (presented.toString('base64url') !== macPart) return null;
  const expected = macOf({ key: input.key, accountId });
  return timingSafeEqual(presented, expected) ? accountId : null;
}
