/**
 * Clinician onboarding: the pure half (M160/08).
 *
 * A clinician's device builds a link that carries her share public key, her
 * account id and the name she wants to be called. The patient opens it, the
 * client parses it here, and the result is handed straight to the ceremony
 * that already exists (`app/lib/sync/sharing.ts`). Nothing in this file is a
 * trust decision — it is transport, and keeping the two apart is the whole
 * design (`openplate-sync` ADR-0002, the trust section).
 *
 * ── The payload rides in the FRAGMENT, and that is not a detail ───────────
 *
 *     https://openplate.de/connect-clinician#k=<key>&a=<account>&n=<name>
 *
 * A query string is TRANSMITTED. It lands in the server's access log, in a
 * `Referer` header, and in every proxy on the way. A fragment is never sent to
 * a server at all. ADR-0002 prohibition 1 says the server never stores,
 * serves or endorses a share public key — a key directory is a rejected
 * design, not a deferred one — so putting the key in a query parameter would
 * hand the server the exact artefact the trust section exists to keep away
 * from it.
 *
 * Which is why {@link parseClinicianLink} REFUSES a link whose payload arrived
 * in the query string rather than quietly reading it. A mailer that helpfully
 * rewrites links (tracking wrappers do this routinely) would otherwise
 * downgrade the design silently: everything would still work, and nothing
 * would ever fail. The refusal is the only thing that makes the fragment a
 * requirement instead of a preference.
 *
 * ── The link carries no fingerprint, on purpose ───────────────────────────
 *
 * There is no fingerprint field, and adding one would be a security
 * regression: a fingerprint that travelled beside the key is a fingerprint the
 * same attacker who swapped the key can rewrite. The patient's client computes
 * it from the bytes it actually received, and the value the patient TYPES
 * comes from the clinician's mouth (`shareKeyFingerprint` /
 * `share-verify-step.tsx`). Nothing here is secret — a public key is public —
 * what the ceremony establishes is that it is AUTHENTIC, and a link can never
 * establish that.
 */
import { base64ToBytes, bytesToBase64 } from '#app/lib/sync/engine/crypto/base64';
import type { ShareCeremonyResult } from '#app/lib/sync/sharing';

/** Where a clinician link points. Fixed: links already sent out cannot be renamed. */
export const CLINICIAN_CONNECT_PATH = '/connect-clinician';

/** The fragment's parameter names, short because they are read off a QR code and retyped in a pinch. */
export const CLINICIAN_LINK_PARAMS = {
  /** The share public key, base64url, SEC1 uncompressed. */
  publicKey: 'k',
  /** The clinician's sync account id. */
  accountId: 'a',
  /** The name she CLAIMS. Never verified by anything — see the parse result's `claimedLabel`. */
  label: 'n',
} as const;

/**
 * The parameter names that must never appear in a query string.
 *
 * All three, not just the key: a rewriting mailer moves the whole fragment at
 * once, and a link that lost only its account id to the query string is just
 * as much a sign that something in the middle is rewriting URLs.
 */
const PAYLOAD_PARAM_NAMES: readonly string[] = [
  CLINICIAN_LINK_PARAMS.publicKey,
  CLINICIAN_LINK_PARAMS.accountId,
  CLINICIAN_LINK_PARAMS.label,
];

/** A SEC1 uncompressed P-256 public key: the tag byte plus two 32-byte coordinates (`share-wrap.ts`). */
const SHARE_PUBLIC_KEY_BYTES = 65;

/** SEC1's uncompressed-point tag. A key that does not start with it is not the key this app wraps to. */
const SEC1_UNCOMPRESSED_TAG = 0x04;

/** How much of a claimed name is kept. A label is a human's note to themselves, not a message. */
export const CLINICIAN_LABEL_MAX_LENGTH = 60;

/** The base64url alphabet, unpadded — what {@link buildClinicianLink} emits and all that is accepted back. */
const BASE64URL_PATTERN = /^[\w-]+$/;

/** What a clinician link says. All of it unverified: this is transport, and the ceremony is the trust. */
export interface ClinicianInvite {
  accountId: number;
  /** Standard base64, the form `grantShare` and the ceremony take. */
  publicKeyBase64: string;
  /**
   * The name the LINK claims, or `null` when it carried none.
   *
   * Named `claimed` rather than `name` so no call site can forget: anybody who
   * can write the link can write this, so it must be shown as an assertion the
   * link makes, never as an identity the app established.
   */
  claimedLabel: string | null;
}

/** Every way reading a clinician link can end. */
export type ClinicianLinkParse =
  | { status: 'ok'; invite: ClinicianInvite }
  /**
   * The payload arrived in the query string. REFUSED, not read — see this
   * module's header. `parameters` names what was found so the screen can tell
   * the two people what happened to their link.
   */
  | { status: 'query-string'; parameters: readonly string[] }
  /** No usable fragment: a truncated link, a hand-typed URL, or a key that is not a share key. */
  | { status: 'invalid' };

/**
 * Reads a clinician link.
 *
 * Takes the two halves of `window.location` separately so the refusal above is
 * testable without a browser, and so the caller cannot accidentally pass one
 * where the other belongs — both are strings.
 */
export function parseClinicianLink({ hash, search }: { hash: string; search: string }): ClinicianLinkParse {
  // FIRST, before anything is read: a payload in the query string is refused
  // even when the fragment carries a perfectly good one. A link that has been
  // rewritten once is a link something in the middle is rewriting.
  const transmitted = payloadParametersIn(search);
  if (transmitted.length > 0) return { status: 'query-string', parameters: transmitted };

  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const publicKeyBase64 = readSharePublicKey(fragment.get(CLINICIAN_LINK_PARAMS.publicKey));
  const accountId = readAccountId(fragment.get(CLINICIAN_LINK_PARAMS.accountId));
  if (publicKeyBase64 === null || accountId === null) return { status: 'invalid' };

  return {
    status: 'ok',
    invite: { accountId, publicKeyBase64, claimedLabel: readLabel(fragment.get(CLINICIAN_LINK_PARAMS.label)) },
  };
}

/**
 * Builds the clinician's own link, on her device, from her own key.
 *
 * `origin` is a parameter rather than a read of `window.location` so this stays
 * pure — but it must always BE this app's own origin, read in the browser. No
 * server hands it over: prohibition 1 again.
 */
export function buildClinicianLink({
  origin,
  accountId,
  publicKeyBase64,
  label,
}: {
  origin: string;
  accountId: number;
  publicKeyBase64: string;
  label: string | null;
}): string {
  const fragment = new URLSearchParams();
  fragment.set(CLINICIAN_LINK_PARAMS.publicKey, toBase64Url(publicKeyBase64));
  fragment.set(CLINICIAN_LINK_PARAMS.accountId, String(accountId));
  const claimed = readLabel(label);
  if (claimed !== null) fragment.set(CLINICIAN_LINK_PARAMS.label, claimed);
  return `${origin}${CLINICIAN_CONNECT_PATH}#${fragment.toString()}`;
}

/**
 * Where a ceremony outcome leaves the connect screen.
 *
 * `key-changed` is a PHASE, not an error. A clinician who regenerated her key
 * offers different bytes than the ones this device pinned, and rotation and
 * substitution look identical from here — so both land in a fresh ceremony
 * with the fingerprint typed again, and neither is ever auto-accepted.
 */
export type ClinicianCeremonyPhase =
  /** The first ceremony: type what she reads out. */
  | { status: 'verify' }
  /** A pinned peer offered different bytes. A SECOND ceremony, explicitly acknowledged. */
  | { status: 'key-changed'; pinnedFingerprintDisplay: string; offeredFingerprintDisplay: string }
  | { status: 'granted'; fingerprintDisplay: string }
  /** Nothing was shared. `sharing-off` is the honest one: the ceremony passed, the instance has no share surface. */
  | { status: 'refused'; reason: 'fingerprint-mismatch' | 'unknown-grantee' | 'conflict' | 'sharing-off' };

/** Maps a ceremony outcome onto the screen's next phase. Pure, so "what does a changed key do" is one assertion. */
export function ceremonyPhaseFor(result: ShareCeremonyResult): ClinicianCeremonyPhase {
  if (result.status === 'granted') return { status: 'granted', fingerprintDisplay: result.fingerprintDisplay };
  if (result.status === 'key-changed') {
    return {
      status: 'key-changed',
      pinnedFingerprintDisplay: result.pinnedFingerprintDisplay,
      offeredFingerprintDisplay: result.offeredFingerprintDisplay,
    };
  }
  if (result.status === 'unavailable') return { status: 'refused', reason: 'sharing-off' };
  return { status: 'refused', reason: result.status };
}

/**
 * Whether the next submission may replace an existing pin.
 *
 * Only ever true from the `key-changed` phase — the one the person reached by
 * being SHOWN that the key changed. It never skips the typed check;
 * `runShareCeremony` still refuses a fingerprint that is not this key's.
 */
export function acceptsKeyChangeIn(phase: ClinicianCeremonyPhase): boolean {
  return phase.status === 'key-changed';
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** Which payload names a query string carries, in the order this module declares them. */
function payloadParametersIn(search: string): string[] {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return PAYLOAD_PARAM_NAMES.filter((name) => query.has(name));
}

/**
 * The share public key as standard base64, or `null` if it is not one.
 *
 * Re-encoded from the decoded bytes rather than string-shuffled, so what the
 * ceremony receives is exactly what the length and tag checks passed.
 */
function readSharePublicKey(value: string | null): string | null {
  if (value === null || !BASE64URL_PATTERN.test(value)) return null;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(fromBase64Url(value));
  } catch {
    return null;
  }
  if (bytes.length !== SHARE_PUBLIC_KEY_BYTES || bytes[0] !== SEC1_UNCOMPRESSED_TAG) return null;
  return bytesToBase64(bytes);
}

/** A sync account id, or `null`. Positive integers only — the server issues no others. */
function readAccountId(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const accountId = Number.parseInt(value, 10);
  return Number.isSafeInteger(accountId) && accountId > 0 ? accountId : null;
}

/** A claimed name, trimmed and capped, or `null` for absent/blank. */
function readLabel(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim().slice(0, CLINICIAN_LABEL_MAX_LENGTH).trim();
  return trimmed === '' ? null : trimmed;
}

function toBase64Url(base64: string): string {
  return base64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(base64url: string): string {
  const base64 = base64url.replaceAll('-', '+').replaceAll('_', '/');
  return base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
}
