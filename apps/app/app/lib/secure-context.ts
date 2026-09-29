/**
 * Can an account ceremony run on this page at all?
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Every account ceremony (sign in, create, reset) starts in `crypto.subtle`:
 * the password becomes a key through HKDF, and the diary key is wrapped with
 * AES-GCM. Browsers expose `crypto.subtle` only in a SECURE CONTEXT, which is
 * an `https:` page or a page on this very computer (`localhost`, `127.0.0.1`,
 * `::1`). A self-hosted app opened at a plain-http LAN address has none, and
 * the install rehearsal of 2026-09-27 met the result: a real account, the right
 * password, and the browser's own `Cannot read properties of undefined
 * (reading 'importKey')` printed under the password field. The pages that run
 * a ceremony now ask this module first and say what is true instead.
 *
 * ── Two answers, one for each side of the wire ───────────────────────────
 *
 * The BROWSER knows for certain ({@link canRunAccountCrypto}). The SERVER can
 * only work it out from the address the request came in on
 * ({@link isPotentiallyTrustworthyUrl}), and it needs to, because the pages
 * are rendered there first: a notice that appeared only after hydration would
 * replace the form under the reader, a layout shift (DESIGN.md section 7).
 * The server's answer is a first guess, and the browser's always wins; the
 * rules below are the ones the W3C Secure Contexts spec gives, so the two
 * agree whenever the address the server sees is the one the browser used.
 *
 * Pure: no `window`, no request. The callers read those and pass them in.
 */

/** Hostnames the Secure Contexts spec treats as this computer, beside the loopback ranges. */
const LOCALHOST_NAMES = new Set(['localhost', 'localhost.']);

/**
 * Would a browser treat a page at this URL as a secure context?
 *
 * The W3C "potentially trustworthy origin" rules, reduced to what reaches this
 * server: `https:` always; `http:` only on a loopback address (`127.0.0.0/8`,
 * `::1`) or a `localhost` name (`localhost` and anything under `.localhost`).
 * Everything else, a LAN address, a tailnet name, a plain-http domain, is not.
 *
 * FAILS TOWARD "YES" ON A URL IT CANNOT READ. This answer only decides the
 * first paint; the browser corrects it after hydration. Guessing "no" wrongly
 * would hide the form from somebody who could have used it, where guessing
 * "yes" wrongly costs one swap on a page that could not have worked anyway.
 *
 * @param url - the absolute URL the request came in on, as the server built it.
 * @returns whether that page would be a secure context.
 */
export function isPotentiallyTrustworthyUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol !== 'http:') return false;
  return isLocalHostname(parsed.hostname);
}

/**
 * A loopback address or a `localhost` name. `URL` hands an IPv6 host back in brackets.
 * Exported for `lib/admin/link-delivery.ts`, which asks the same question of a
 * link's `server=` address.
 */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOCALHOST_NAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.localhost.')) return true;
  if (host === '[::1]') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** What the browser says about itself, read by the caller so this stays pure. */
export interface BrowserCryptoFacts {
  /** `window.isSecureContext`. */
  isSecureContext: boolean;
  /** Whether `globalThis.crypto.subtle` exists. It is `undefined` off a secure context. */
  hasSubtleCrypto: boolean;
}

/**
 * Can this browser run an account ceremony here, as a fact rather than a guess?
 *
 * Both halves, because they can disagree in one direction: a secure page in a
 * browser without Web Crypto (an old engine, an embedded view) has no
 * `crypto.subtle` either, and the ceremony would fail the same way.
 *
 * @param facts - what the browser reports.
 * @returns whether `crypto.subtle` can be used on this page.
 */
export function canRunAccountCrypto(facts: BrowserCryptoFacts): boolean {
  return facts.isSecureContext && facts.hasSubtleCrypto;
}
