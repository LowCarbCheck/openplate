/**
 * Remembers that a verification token has already been redeemed, so reloading
 * `/verify-email` does not tell a user their confirmation failed.
 *
 * ── The bug ──────────────────────────────────────────────────────────────
 *
 * Verification tokens are SINGLE USE — correctly, and that is not something to
 * relax. The route POSTs its token on every mount, so the first load confirms
 * the address and every load after that (a reload, a back-navigation, a link
 * opened twice from a mail client that prefetches) gets the same rejection an
 * expired or forged token gets, and shows "That link didn't work". The account
 * is fine; only the page is lying.
 *
 * The fix is entirely client-side by design: the service's token semantics are
 * exactly right and this is a display problem.
 *
 * ── Why a HASH of the token, and why `sessionStorage` ────────────────────
 *
 * The key is derived, never the token itself. A redeemed token is spent, but a
 * verification link is still a credential-shaped thing, and writing one into
 * web storage where any script on the origin can read it buys nothing — all
 * this needs is to recognise the same token again. `sessionStorage` because the
 * claim being remembered ("this tab already redeemed this") is a tab-lifetime
 * fact; a marker that outlived the browser session would keep asserting success
 * long after it could be checked.
 *
 * Every function here is total: web storage throws in a Safari private window
 * and when a quota is exhausted, and a storage failure must degrade to the old
 * behaviour, never to a crash on a page whose whole job is reassurance.
 */

/** The subset of `Storage` this needs — so tests pass a plain object and never touch a global. */
export interface VerifyEmailMarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MARKER_PREFIX = 'openplate.verify-email.';

/**
 * FNV-1a over 32 bits, rendered as 8 hex characters.
 *
 * Collision resistance is irrelevant here and cryptographic hashing would be
 * theatre: the only consequence of a collision is that a *different* token
 * shows the success state on a page that shows nothing else, and `crypto.subtle`
 * is async, which would put an await between mount and the fetch this guards.
 */
function fingerprint(token: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The storage key for a token. Exported so a test can assert the token itself never appears in it. */
export function verifyEmailMarkerKey(token: string): string {
  return `${MARKER_PREFIX}${fingerprint(token)}`;
}

/** @returns whether this token was already redeemed successfully in this session. */
export function hasRedeemedVerifyEmailToken({
  token,
  storage,
}: {
  token: string;
  storage: VerifyEmailMarkerStorage | null;
}): boolean {
  if (storage === null) return false;
  try {
    return storage.getItem(verifyEmailMarkerKey(token)) !== null;
  } catch {
    return false;
  }
}

/** Records a successful redemption. A storage failure is silent — the confirmation itself still worked. */
export function rememberRedeemedVerifyEmailToken({
  token,
  storage,
}: {
  token: string;
  storage: VerifyEmailMarkerStorage | null;
}): void {
  if (storage === null) return;
  try {
    storage.setItem(verifyEmailMarkerKey(token), '1');
  } catch {
    // Private-mode or quota. The next reload shows the old failure message,
    // which is the behaviour this replaces — not a regression, just no fix.
  }
}

/** `sessionStorage`, or `null` during SSR and wherever it is blocked outright. */
export function sessionMarkerStorage(): VerifyEmailMarkerStorage | null {
  try {
    return globalThis.sessionStorage === undefined ? null : sessionStorage;
  } catch {
    return null;
  }
}
