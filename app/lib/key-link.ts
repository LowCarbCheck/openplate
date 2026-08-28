/**
 * The reading rules a KEY-CARRYING LINK obeys — shared by the clinician
 * connect link (M160/08) and the study join link (M163/02).
 *
 * Two links, one set of readers, deliberately. Both carry a 65-byte SEC1
 * public key, an account id and a claimed name, and both put that payload in
 * the URL FRAGMENT. A second copy of these readers would be a second place for
 * the byte length, the SEC1 tag check or the base64url alphabet to drift —
 * and all three are checks on key material, not formatting niceties.
 *
 * ── What is deliberately NOT here: the refusal ───────────────────────────
 *
 * Each link module runs the query-string check as its own first statement,
 * before it reads anything else, because the ORDERING is the property being
 * kept (see `clinician-link.ts` and `study-link.ts`, which both say why). This
 * module only answers the factual question "which payload names does this
 * query string carry" and never decides what that means.
 */
import { base64ToBytes, bytesToBase64 } from '#app/lib/sync/engine/crypto/base64';

/**
 * The fragment's parameter names, short because they are read off a QR code
 * and retyped in a pinch.
 *
 * The SAME three names in both links. A person who has learned to distrust a
 * `?k=` in an address bar has learned it for every link this app hands out.
 */
export const KEY_LINK_PARAMS = {
  /** The public key, base64url, SEC1 uncompressed. */
  publicKey: 'k',
  /** The sync account id. */
  accountId: 'a',
  /** The name the link CLAIMS. Never verified by anything. */
  label: 'n',
} as const;

/**
 * The parameter names that must never appear in a query string.
 *
 * All three, not just the key: a rewriting mailer moves the whole fragment at
 * once, and a link that lost only its account id to the query string is just
 * as much a sign that something in the middle is rewriting URLs.
 */
export const KEY_LINK_PAYLOAD_PARAM_NAMES: readonly string[] = [
  KEY_LINK_PARAMS.publicKey,
  KEY_LINK_PARAMS.accountId,
  KEY_LINK_PARAMS.label,
];

/** How much of a claimed name is kept. A label is a human's note to themselves, not a message. */
export const LINK_LABEL_MAX_LENGTH = 60;

/** A SEC1 uncompressed P-256 public key: the tag byte plus two 32-byte coordinates (`share-wrap.ts`). */
const SEC1_PUBLIC_KEY_BYTES = 65;

/** SEC1's uncompressed-point tag. A key that does not start with it is not the key this app wraps to. */
const SEC1_UNCOMPRESSED_TAG = 0x04;

/** The base64url alphabet, unpadded — what the link builders emit and all that is accepted back. */
const BASE64URL_PATTERN = /^[\w-]+$/;

/** Which payload names a query string carries, in the order this module declares them. */
export function payloadParametersIn(search: string): string[] {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return KEY_LINK_PAYLOAD_PARAM_NAMES.filter((name) => query.has(name));
}

/**
 * A public key as standard base64, or `null` if it is not one.
 *
 * Re-encoded from the decoded bytes rather than string-shuffled, so what a
 * ceremony receives is exactly what the length and tag checks passed.
 */
export function readLinkPublicKey(value: string | null): string | null {
  if (value === null || !BASE64URL_PATTERN.test(value)) return null;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(fromBase64Url(value));
  } catch {
    return null;
  }
  if (bytes.length !== SEC1_PUBLIC_KEY_BYTES || bytes[0] !== SEC1_UNCOMPRESSED_TAG) return null;
  return bytesToBase64(bytes);
}

/** A sync account id, or `null`. Positive integers only — the server issues no others. */
export function readLinkAccountId(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const accountId = Number.parseInt(value, 10);
  return Number.isSafeInteger(accountId) && accountId > 0 ? accountId : null;
}

/** A claimed name, trimmed and capped, or `null` for absent/blank. */
export function readLinkLabel(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim().slice(0, LINK_LABEL_MAX_LENGTH).trim();
  return trimmed === '' ? null : trimmed;
}

export function toBase64Url(base64: string): string {
  return base64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(base64url: string): string {
  const base64 = base64url.replaceAll('-', '+').replaceAll('_', '/');
  return base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
}
