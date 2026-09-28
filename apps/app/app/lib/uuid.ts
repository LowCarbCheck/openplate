/**
 * `randomUuid()` — the ONE way this app mints a UUID. Never call
 * `crypto.randomUUID()` directly (an ESLint rule enforces that).
 *
 * WHY THIS EXISTS: `crypto.randomUUID` is only exposed in a **secure context**
 * — https, or `localhost`. openplate is routinely opened over plain http on a
 * non-localhost origin: a LAN/tailnet address while developing on a phone, and
 * self-hosted installs that run behind no TLS terminator at all. On those
 * origins `crypto.randomUUID` is simply absent, and calling it throws
 * `TypeError: crypto.randomUUID is not a function` — which is exactly how the
 * whole scan flow died before this module existed.
 *
 * `crypto.getRandomValues` has no secure-context requirement and is available
 * everywhere the app runs (every browser, and Node via the global WebCrypto),
 * so the fallback is just as cryptographically strong as the native call. It
 * is NOT a "good enough" degradation and must never be rewritten in terms of
 * `Math.random()`.
 */

const HEX_BY_BYTE: readonly string[] = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

/** RFC 4122 v4 UUID from 16 CSPRNG bytes, formatted 8-4-4-4-12 lowercase hex. */
function uuidFromRandomBytes(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Version 4 in the high nibble of byte 6, RFC 4122 variant in the top bits of byte 8.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => HEX_BY_BYTE[byte]!);
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

/** A random v4 UUID, in secure and non-secure contexts alike. */
export function randomUuid(): string {
  // The optional annotation restores what lib.dom hides: outside a secure
  // context this property is simply absent (see the module doc).
  // eslint-disable-next-line no-restricted-properties -- this module IS the seam
  const native: typeof crypto.randomUUID | undefined = crypto.randomUUID;
  return native === undefined ? uuidFromRandomBytes() : native.call(crypto);
}
