/**
 * The account address, as this client checks and canonicalises it (M192).
 *
 * It replaced `handle.ts`, and the rule it enforces is the INVERSE of the one
 * that stood there: a handle was refused for containing `@`, and an address is
 * refused for not containing exactly one. The owner's reason, on 2026-09-04:
 * "they will forget their usernames, they will forget their passwords, they
 * know their email though."
 *
 * ── This is a SHAPE gate, not a validity check ───────────────────────────
 *
 * Nothing here can tell whether an address exists, and it does not try. What
 * it catches is the ordinary typing accident — a name with no `@`, two of
 * them, a domain with no dot, a trailing paste of the surrounding sentence —
 * before it becomes a round trip whose refusal a person cannot explain.
 *
 * There is deliberately no RFC 5322 grammar here. That grammar admits
 * addresses no mail provider issues and rejects none that anybody would type
 * by mistake, and every regex claiming to implement it is wrong in a different
 * way. The service applies these same rules; ITS answer is the one that
 * decides.
 *
 * ── Canonical form, and why the client computes it too ───────────────────
 *
 * NFKC, trimmed, lowercased. The service stores addresses this way and its
 * unique index is over that form, so two spellings of one address are one
 * account. The client canonicalises before sending for one specific reason:
 * `POST /v1/auth/kdf` and `POST /v1/auth/login` must agree on the string, and
 * an Argon2id run against a differently-spelled address derives a verifier
 * that simply does not match — which is indistinguishable, on screen, from a
 * wrong password.
 */
import type { Translate } from './setup-flow';

/**
 * The service's length bound, transcribed. 254 is the longest address SMTP
 * will carry (RFC 5321 §4.5.3.1.3), so it is a real ceiling rather than a
 * chosen one.
 */
export const MAX_EMAIL_LENGTH = 254;

/**
 * The canonical form of an address: NFKC, trimmed, lowercased.
 *
 * PURE, and applied to whatever it is given — including a value this module
 * would refuse. Canonicalising and validating are separate steps because the
 * caller does both in a different order: a form validates what was typed, and
 * a request sends what was canonicalised.
 */
export function canonicalizeEmail(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase();
}

/**
 * Why an address was refused, or `null` when it passes the shape gate.
 *
 * @param raw - the address exactly as typed, uncanonicalised.
 * @param t - the caller's translator; every message here is copy.
 */
export function describeEmailProblem(raw: string, t: Translate): string | null {
  const value = canonicalizeEmail(raw);
  if (value === '') return t('sync.email.required');
  if (value.length > MAX_EMAIL_LENGTH) return t('sync.email.tooLong', { max: MAX_EMAIL_LENGTH });
  if (!isDeliverableAddress(value)) return t('sync.email.invalid');
  return null;
}

/**
 * The four structural rules, and nothing else: exactly one `@`, a non-empty
 * local part, a domain containing a dot, and no whitespace anywhere.
 *
 * Written as explicit checks rather than one regex so that each rule is
 * readable and so that adding a fifth does not mean re-deriving a pattern
 * nobody can review.
 */
export function isDeliverableAddress(canonical: string): boolean {
  if (/\s/.test(canonical)) return false;
  const parts = canonical.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (local === undefined || local === '') return false;
  if (domain === undefined) return false;
  // A dot with something either side of it. `a@b.` and `a@.b` are typing
  // accidents; `a@localhost` is a real address on a machine and not one an
  // organization invites anybody at.
  const dotAt = domain.indexOf('.');
  return dotAt > 0 && dotAt < domain.length - 1;
}
