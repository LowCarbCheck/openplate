/**
 * THE STUDY PSEUDONYM (`PROTOCOL.md` §3.5, `openplate-sync` ADR-0003).
 *
 * A contributor presents a different, stable identifier to every study:
 *
 * ```
 * pid = HMAC-SHA-256(root, "openplate-sync:study-pseudonym:v1" || studyAccountId)
 *       truncated to the leading 128 bits, Crockford base32, 26 characters
 * ```
 *
 * Three properties, and all three are load-bearing:
 *
 *  1. **Stable** across submissions and devices, because the root lives in the
 *     owner-private compartment and therefore survives a recovery restore.
 *     Without stability a study sees one participant as many.
 *  2. **Unlinkable across studies** — HMAC outputs under different messages
 *     are independent, so two researchers pooling cohorts cannot tell that a
 *     row in each belongs to one person.
 *  3. **Underivable by anyone holding the account table.** This is why the
 *     construction is keyed on a secret random root and not `H(accountId ||
 *     studyId)`: with public inputs that reverses by enumeration.
 *
 * IT DEFENDS AGAINST THE RESEARCHER, NOT THE SERVER. The server authenticates
 * the push by bearer token and knows the account behind every row regardless
 * (§9.2). Nothing here changes that, and no wording anywhere may imply it does.
 *
 * ── The byte encoding is FROZEN, and it had to be written down ───────────
 *
 * `PROTOCOL.md` originally wrote the message as `label || studyAccountId`
 * without fixing the id's bytes, which is two implementations that disagree in
 * one deployment: a study client deriving over the ASCII digits of the id and
 * a contributor client deriving over 8 big-endian bytes both satisfy that
 * sentence and produce different pseudonyms. §3.5 now states it, and this
 * module implements it: **8-byte big-endian unsigned**, always eight bytes,
 * never the decimal text, never a minimal-length encoding.
 *
 * Pure apart from {@link generatePseudonymRoot}'s single CSPRNG call. No
 * store, no network, no clock.
 */
import { encodeCrockfordBase32 } from '../engine/crypto/base32';
import { toBufferSource } from '../engine/crypto/buffer-source';

/** The pseudonym root's length in bytes — 256 bits, as ADR-0003 specifies. A shorter root is a weaker unlinkability claim, not a smaller one. */
export const PSEUDONYM_ROOT_BYTES = 32;

/** The frozen HMAC message prefix. Changing a character re-pseudonymises every contributor in every study, which a researcher reads as a whole new cohort. */
const PSEUDONYM_LABEL = new TextEncoder().encode('openplate-sync:study-pseudonym:v1');

/** The `studyAccountId` encoding fixed by §3.5: unsigned, big-endian, ALWAYS eight bytes. */
const STUDY_ACCOUNT_ID_BYTES = 8;

/** The MAC is truncated to its leading 128 bits before encoding — 2^-128 collision odds, which is what makes the server's one-pseudonym-per-study constraint a proof rather than a hope. */
const PSEUDONYM_TRUNCATED_BYTES = 16;

/** 128 bits in a 5-bit alphabet is 25 full characters plus 3 leftover bits, so every pseudonym is exactly this long. Asserted, not assumed. */
const PSEUDONYM_CHARACTERS = 26;

/**
 * Mints a fresh 256-bit pseudonym root.
 *
 * CALL THIS ONCE PER ACCOUNT, at first enrolment. A second root silently
 * re-pseudonymises the person in every study they already contribute to, and
 * the researcher reads the new identifier as a second participant whose series
 * starts from nothing.
 */
export function generatePseudonymRoot(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(PSEUDONYM_ROOT_BYTES));
}

/**
 * Derives this contributor's pseudonym for one study.
 *
 * @param root - the 256-bit pseudonym root, read from the owner-private compartment. It never leaves the device and must never enter a payload, a log line or an error message.
 * @param studyAccountId - the study's sync account id, encoded as 8 big-endian bytes into the HMAC message.
 * @returns 26 upper-case Crockford base32 characters, ungrouped — a machine identifier, not a value anyone types.
 * @throws when the root is the wrong length, or the id is not a non-negative safe integer. Both are refusals rather than best-effort derivations: a pseudonym derived from a half-understood input is a participant series pointing at the wrong person.
 */
export async function deriveStudyPseudonym({
  root,
  studyAccountId,
}: {
  root: Uint8Array;
  studyAccountId: number;
}): Promise<string> {
  if (root.byteLength !== PSEUDONYM_ROOT_BYTES) {
    throw new Error(`pseudonym root must be ${PSEUDONYM_ROOT_BYTES} bytes, got ${root.byteLength}`);
  }
  const key = await crypto.subtle.importKey('raw', toBufferSource(root), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, toBufferSource(buildMessage(studyAccountId))));
  const pseudonym = encodeCrockfordBase32(mac.slice(0, PSEUDONYM_TRUNCATED_BYTES));
  if (pseudonym.length !== PSEUDONYM_CHARACTERS) {
    // Unreachable while the two constants above agree, and asserted anyway:
    // the length is part of what a study client and this client must agree on.
    throw new Error(`pseudonym must be ${PSEUDONYM_CHARACTERS} characters, got ${pseudonym.length}`);
  }
  return pseudonym;
}

/**
 * `label || uint64be(studyAccountId)` — the HMAC message, spelled out.
 *
 * `setBigUint64` rather than any hand-rolled shift loop: JavaScript's bitwise
 * operators are 32-bit, so a hand-rolled version of this is wrong for exactly
 * the ids that are large enough to matter and right for every id a test
 * fixture is likely to use.
 */
function buildMessage(studyAccountId: number): Uint8Array {
  if (!Number.isSafeInteger(studyAccountId) || studyAccountId < 0) {
    throw new Error(`studyAccountId must be a non-negative safe integer, got ${studyAccountId}`);
  }
  const message = new Uint8Array(PSEUDONYM_LABEL.byteLength + STUDY_ACCOUNT_ID_BYTES);
  message.set(PSEUDONYM_LABEL, 0);
  new DataView(message.buffer).setBigUint64(PSEUDONYM_LABEL.byteLength, BigInt(studyAccountId), false);
  return message;
}
