/**
 * Joining a study: the pure half (M163/02).
 *
 * A study publishes a link that carries its contribution public key, its sync
 * account id and the name it wants to be called. A contributor opens it, the
 * client parses it here, and the result is handed straight to the ceremony
 * that already exists (`app/lib/sync/research/enrolment.ts`). Nothing in this
 * file is a trust decision — it is transport, and keeping the two apart is the
 * whole design (`openplate-sync` ADR-0003).
 *
 * This module is `clinician-link.ts`'s sibling and obeys its two rules, for
 * the same reasons and with more at stake. It shares that module's readers
 * (`key-link.ts`) so the SEC1 length and tag checks exist once.
 *
 * ── The payload rides in the FRAGMENT ────────────────────────────────────
 *
 *     https://openplate.de/join-study#k=<key>&a=<account>&n=<name>
 *
 * A query string is TRANSMITTED: it lands in the server's access log, in a
 * `Referer` header, and in every proxy on the way. A fragment is never sent to
 * a server at all. So {@link parseStudyLink} REFUSES a link whose payload
 * arrived in the query string rather than quietly reading it — a tracking
 * mailer that rewrites links would otherwise downgrade the design in silence,
 * with every screen still working and nothing anywhere failing.
 *
 * ── The link carries no fingerprint, and here that is the whole ceremony ──
 *
 * The clinician case gets its second channel from a room: she reads twelve
 * characters aloud. A cohort has no room, so ADR-0003 moves the anchor to the
 * study's ethics-approved consent document, where the fingerprint is PRINTED.
 * The link is one channel; the printed page is the other. A fingerprint that
 * travelled beside the key would collapse them into one, and a substituted key
 * would pass the ceremony cleanly — which is why there is no fingerprint field
 * here, and why no screen above this module may display the fingerprint it
 * computed from the received key before the typed value has been submitted.
 *
 * ADR-0003 ranks study-key substitution above the clinician case by a factor
 * of N: one substituted key harvests a whole cohort.
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
import type { EnrolmentResult } from '#app/lib/sync/research/enrolment';

/** Where a study join link points. Fixed: a path printed in consent materials cannot be renamed. */
export const STUDY_JOIN_PATH = '/join-study';

/** The fragment's parameter names — the shared three, so both of this app's links read alike. */
export const STUDY_LINK_PARAMS = KEY_LINK_PARAMS;

/** How much of a claimed study name is kept. */
export const STUDY_LABEL_MAX_LENGTH = LINK_LABEL_MAX_LENGTH;

/** What a study link says. All of it unverified: this is transport, and the ceremony is the trust. */
export interface StudyInvite {
  studyAccountId: number;
  /** Standard base64, the form the enrolment ceremony takes. */
  publicKeyBase64: string;
  /**
   * The name the LINK claims, or `null` when it carried none.
   *
   * Named `claimed` rather than `name` for the reason `ClinicianInvite`'s is:
   * anybody who can write the link can write this, so it must be shown as an
   * assertion the link makes and never as an identity the app established. A
   * study name is the more tempting of the two — "Charité sleep trial" reads
   * like credentials.
   */
  claimedLabel: string | null;
}

/** Every way reading a study link can end. */
export type StudyLinkParse =
  | { status: 'ok'; invite: StudyInvite }
  /**
   * The payload arrived in the query string. REFUSED, not read — see this
   * module's header. `parameters` names what was found so the screen can tell
   * the person what happened to their link.
   */
  | { status: 'query-string'; parameters: readonly string[] }
  /** No usable fragment: a truncated link, a hand-typed URL, or a key that is not a contribution key. */
  | { status: 'invalid' };

/**
 * Reads a study join link.
 *
 * Takes the two halves of `window.location` separately so the refusal above is
 * testable without a browser, and so the caller cannot accidentally pass one
 * where the other belongs — both are strings.
 */
export function parseStudyLink({ hash, search }: { hash: string; search: string }): StudyLinkParse {
  // FIRST, before anything is read: a payload in the query string is refused
  // even when the fragment carries a perfectly good one. A link that has been
  // rewritten once is a link something in the middle is rewriting, and these
  // parameters have already reached a server.
  const transmitted = payloadParametersIn(search);
  if (transmitted.length > 0) return { status: 'query-string', parameters: transmitted };

  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const publicKeyBase64 = readLinkPublicKey(fragment.get(STUDY_LINK_PARAMS.publicKey));
  const studyAccountId = readLinkAccountId(fragment.get(STUDY_LINK_PARAMS.accountId));
  if (publicKeyBase64 === null || studyAccountId === null) return { status: 'invalid' };

  return {
    status: 'ok',
    invite: { studyAccountId, publicKeyBase64, claimedLabel: readLinkLabel(fragment.get(STUDY_LINK_PARAMS.label)) },
  };
}

/**
 * Builds a study's own join link.
 *
 * `origin` is a parameter rather than a read of `window.location` so this
 * stays pure. It is exported for the study's own tooling and for the tests
 * that prove the payload lands after the `#`.
 */
export function buildStudyLink({
  origin,
  studyAccountId,
  publicKeyBase64,
  label,
}: {
  origin: string;
  studyAccountId: number;
  publicKeyBase64: string;
  label: string | null;
}): string {
  const fragment = new URLSearchParams();
  fragment.set(STUDY_LINK_PARAMS.publicKey, toBase64Url(publicKeyBase64));
  fragment.set(STUDY_LINK_PARAMS.accountId, String(studyAccountId));
  const claimed = readLinkLabel(label);
  if (claimed !== null) fragment.set(STUDY_LINK_PARAMS.label, claimed);
  return `${origin}${STUDY_JOIN_PATH}#${fragment.toString()}`;
}

/**
 * Where the join screen is, expressed as the ceremony's own outcomes plus the
 * state before one has run.
 *
 * Written as a union WITH {@link EnrolmentResult} rather than a translation of
 * it, so the screen cannot grow a fourth outcome: `runEnrolmentCeremony` is
 * the whole of ADR-0003 prohibition 4's guarantee, and a phase type that
 * enumerated its own statuses would be the place a softened refusal could be
 * added without touching the ceremony.
 */
export type JoinStudyPhase = { status: 'verify' } | EnrolmentResult;

/** What the join screen puts on the page. One member per thing a person can be looking at. */
export type JoinStudyView =
  /** Type the fingerprint from the consent document. Also where a mismatch returns to, with a message. */
  | 'verify'
  /** Pinned, rooted, and showing the pseudonym this person will present. */
  | 'enrolled'
  /** No owner-private compartment: the recovery path, and NO way to enrol anyway. */
  | 'compartment-missing';

/**
 * Maps a phase onto what is rendered.
 *
 * Pure, and the join route branches on nothing else, so "what does an account
 * with no compartment see?" is one assertion rather than a reading of JSX.
 *
 * A `fingerprint-mismatch` returns to `verify`: it wrote nothing, so the
 * person is exactly where they were, one message wiser. `compartment-missing`
 * does NOT — it is a different screen, because there is nothing to retype and
 * offering the form again would invite a person to keep typing a fingerprint
 * at a refusal that has nothing to do with what they typed.
 */
export function joinStudyViewFor(phase: JoinStudyPhase): JoinStudyView {
  if (phase.status === 'enrolled') return 'enrolled';
  if (phase.status === 'compartment-missing') return 'compartment-missing';
  return 'verify';
}
