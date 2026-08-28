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
import {
  KEY_LINK_PARAMS,
  LINK_LABEL_MAX_LENGTH,
  payloadParametersIn,
  readLinkAccountId,
  readLinkLabel,
  readLinkPublicKey,
  toBase64Url,
} from '#app/lib/key-link';
import type { ShareCeremonyResult } from '#app/lib/sync/sharing';

/** Where a clinician link points. Fixed: links already sent out cannot be renamed. */
export const CLINICIAN_CONNECT_PATH = '/connect-clinician';

/**
 * The fragment's parameter names. The shared ones (`key-link.ts`): a link
 * already in somebody's inbox cannot be renamed, and the study link beside it
 * uses the same three so a person only ever learns one shape.
 */
export const CLINICIAN_LINK_PARAMS = KEY_LINK_PARAMS;

/** How much of a claimed name is kept. A label is a human's note to themselves, not a message. */
export const CLINICIAN_LABEL_MAX_LENGTH = LINK_LABEL_MAX_LENGTH;

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
  const publicKeyBase64 = readLinkPublicKey(fragment.get(CLINICIAN_LINK_PARAMS.publicKey));
  const accountId = readLinkAccountId(fragment.get(CLINICIAN_LINK_PARAMS.accountId));
  if (publicKeyBase64 === null || accountId === null) return { status: 'invalid' };

  return {
    status: 'ok',
    invite: { accountId, publicKeyBase64, claimedLabel: readLinkLabel(fragment.get(CLINICIAN_LINK_PARAMS.label)) },
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
  const claimed = readLinkLabel(label);
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
