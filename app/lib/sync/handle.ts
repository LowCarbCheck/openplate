/**
 * The account handle: minted here, on the device, and never an email address.
 *
 * ── Why the client mints it ───────────────────────────────────────────────
 *
 * M181 took email out of `openplate-sync` entirely. What is left is a handle
 * plus a passphrase, and the handle exists only to name a row — the service
 * has no opinion about it beyond "non-empty, no `@`, length-bounded, unique".
 * Asking a person to invent one would produce either their email address or
 * their first name, and the first of those is exactly the PII the milestone
 * removed. So the client offers a name, and the user may edit it.
 *
 * ── Two mints, for two different jobs ────────────────────────────────────
 *
 * `generateHandle` produces ten Crockford characters. `suggestHandle` (bottom
 * of this file) produces `flink-otter-42`. The difference is not cosmetic:
 * the first is what the STUDY console mints into a field nobody reads aloud,
 * the second is what the sync signup form's "suggest a name" button fills in,
 * where a base32 string reads as a password and stops people editing it
 * (owner decision, 2026-09-02). Both stay lowercase, `@`-free and inside
 * `MAX_HANDLE_LENGTH`, so either is a handle the service accepts.
 *
 * ── Why Crockford base32 ─────────────────────────────────────────────────
 *
 * For the reason that alphabet exists: it omits `I`, `L`, `O` and `U`, so a
 * handle read off a screen, written on a card, or dictated down a phone does
 * not come back as a different handle. The table is imported from
 * `engine/crypto/base32.ts` rather than restated — that module's header is
 * explicit that a second copy which drifted by one character is how two
 * different values come to render the same string, and the recovery code
 * printed beside the handle on the same account card uses this same table.
 *
 * ── The `@` rule lives in two places on purpose ──────────────────────────
 *
 * The server's rejection (`openplate-sync/src/accounts/auth-input.ts`) is the
 * CONTRACT; the one below is a COURTESY, so a person who types their email
 * address into the handle box is told immediately instead of after a round
 * trip. Both must exist: dropping the server rule would let the column drift
 * back into an address register, and dropping this one would make the only
 * feedback a `400`.
 */
import { CROCKFORD_BASE32_ALPHABET } from './engine/crypto/base32';
import { DE_HANDLE_ADJECTIVES, DE_HANDLE_ANIMALS } from './handle-words.de';
import { EN_HANDLE_ADJECTIVES, EN_HANDLE_ANIMALS } from './handle-words.en';

/**
 * Handle length, in characters.
 *
 * Ten Crockford characters is 50 bits. The collision margin against a
 * server-side unique index is what sets the floor: at 50 bits a self-hosted
 * instance would need on the order of a million accounts before a single
 * duplicate became likely, and a duplicate is a recoverable `409` at signup
 * rather than a loss. The ceiling is human: this string is printed on the
 * account card and typed on another device, so every character costs
 * transcription.
 */
export const HANDLE_LENGTH = 10;

/** Matches the service's own bound (`auth-input.ts`'s `MAX_HANDLE_LENGTH`), so a handle this client accepts is one the server will. */
export const MAX_HANDLE_LENGTH = 64;

/**
 * The generated handle's alphabet — the single frozen Crockford table, shared
 * with the recovery code and the share-key fingerprint.
 */
const HANDLE_ALPHABET = CROCKFORD_BASE32_ALPHABET;

/**
 * The narrow translation lookup this module needs for {@link describeHandleProblem}.
 *
 * Threaded in as a parameter, never imported: the file stays pure and callable
 * from `node:test`, which has no i18next instance.
 */
export type HandleTranslate = (key: string) => string;

/** Fills a byte buffer with randomness. Injected so the generator is testable without stubbing a global. */
export type RandomBytes = (length: number) => Uint8Array;

function webCryptoRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Canonicalises a handle the way the server does (`normalizeHandle` there):
 * NFKC, then trim, then lowercase.
 *
 * THE ORDER MATTERS. NFKC can turn a full-width space into an ordinary one, so
 * normalising before trimming is what makes `"ａ　"` collapse to `a`
 * rather than to `a ` — and a client that canonicalised differently from the
 * server would show the user one handle and register another.
 */
export function normalizeHandle(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase();
}

/** Why a handle was refused, or `null` when it is acceptable. The caller turns this into copy. */
export type HandleProblem = 'empty' | 'too-long' | 'email-shaped';

/**
 * Validates a candidate handle with the same rule the service enforces.
 *
 * Returns the REASON rather than a message: this module is pure and has no
 * translator, and the three cases need three different sentences.
 */
export function findHandleProblem(raw: string): HandleProblem | null {
  const handle = normalizeHandle(raw);
  if (handle.length === 0) return 'empty';
  if (handle.length > MAX_HANDLE_LENGTH) return 'too-long';
  // The one rule that is about meaning rather than shape: a handle is not an
  // address, and this service never stores a mailbox.
  if (handle.includes('@')) return 'email-shaped';
  return null;
}

/**
 * Mints a fresh handle.
 *
 * NO MODULO BIAS: the alphabet has exactly 32 entries and 256 is a whole
 * multiple of 32, so masking each random byte with `0x1f` selects uniformly.
 * Rejection sampling would be the fix if the table were ever resized, and it
 * is not, because the table is frozen.
 *
 * The result is lowercase because that is the server's canonical form — a
 * handle shown in one case and stored in another is a handle the user cannot
 * verify they typed correctly.
 */
export function generateHandle(randomBytes: RandomBytes = webCryptoRandomBytes): string {
  const bytes = randomBytes(HANDLE_LENGTH);
  let handle = '';
  for (const byte of bytes) {
    handle += HANDLE_ALPHABET[byte & 0x1f];
  }
  return handle.toLowerCase();
}

/**
 * The two-digit tail's range. Two digits, never `0`-prefixed: the suffix is
 * there to make a suggestion collision-resistant enough to be worth offering,
 * and `flink-otter-07` reads as a version number rather than as a name.
 */
export const HANDLE_NUMBER_MIN = 10;
const HANDLE_NUMBER_COUNT = 90;

/**
 * How many draws `pickIndex` will make before giving up.
 *
 * With a bound in the low hundreds the rejection window covers all but a few
 * parts per ten million of the 32-bit range, so a single retry is already
 * vanishingly unlikely and sixty-four is a bound, not a budget. It exists so
 * this loop can never spin: a `randomBytes` that returns a constant is a bug
 * worth a thrown error rather than a hung tab.
 */
const MAX_DRAW_ATTEMPTS = 64;

/**
 * Picks a uniform index in `[0, bound)` from the injected randomness.
 *
 * REJECTION SAMPLING, not modulo. `generateHandle` above can mask because 32
 * divides 256; a word list has an arbitrary length, so `value % bound` would
 * quietly favour the first `2^32 % bound` entries of the list. Every draw
 * outside the largest whole multiple of `bound` is discarded instead.
 */
function pickIndex(bound: number, randomBytes: RandomBytes): number {
  const limit = Math.floor(0x1_00000000 / bound) * bound;
  for (let attempt = 0; attempt < MAX_DRAW_ATTEMPTS; attempt += 1) {
    const bytes = randomBytes(4);
    const value = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    if (value < limit) return value % bound;
  }
  throw new Error('Could not draw an unbiased index: the random source is not producing varied bytes.');
}

/** The adjective and animal lists a given UI language draws from. */
export type HandleWordLists = { adjectives: readonly string[]; animals: readonly string[] };

/**
 * Chooses the word lists for a UI language tag.
 *
 * ENGLISH IS THE FALLBACK, deliberately: a suggestion in the wrong language is
 * still a usable handle, whereas throwing would break the one button whose
 * whole job is to unblock someone who cannot think of a name. The tag is
 * matched on its primary subtag, so `de`, `de-DE` and `de-AT` all land on the
 * German lists.
 */
export function resolveHandleWords(language: string): HandleWordLists {
  const primary = language.toLowerCase().replace(/[^a-z].*$/, '');
  if (primary === 'de') return { adjectives: DE_HANDLE_ADJECTIVES, animals: DE_HANDLE_ANIMALS };
  return { adjectives: EN_HANDLE_ADJECTIVES, animals: EN_HANDLE_ANIMALS };
}

/**
 * Suggests a READABLE handle: `<adjective>-<animal>-<two digits>`, in the UI
 * language — `quick-otter-42`, `flink-otter-42`.
 *
 * ── Why this is not `generateHandle` ─────────────────────────────────────
 *
 * `generateHandle` mints ten Crockford characters, which is the right shape
 * for a recovery code and the wrong shape for a name: `b7k2xq9m4t` reads as a
 * password, and someone shown one in a field they are allowed to edit
 * concludes they must keep it (owner decision, 2026-09-02). A suggestion has
 * to look like something a person could have chosen. `generateHandle` stays
 * for the study console, which mints rather than suggests.
 *
 * ── The bounds this respects ─────────────────────────────────────────────
 *
 * Twenty-four characters at the very longest (10 + 1 + 10 + 1 + 2), well
 * inside {@link MAX_HANDLE_LENGTH}, and no `@` can appear because both lists
 * are `[a-z]` only — so every value this returns passes
 * {@link findHandleProblem} and the service's own rule. `handle-words.test.ts`
 * pins that hygiene on the lists themselves.
 */
export function suggestHandle(language: string, randomBytes: RandomBytes = webCryptoRandomBytes): string {
  const { adjectives, animals } = resolveHandleWords(language);
  const adjective = adjectives[pickIndex(adjectives.length, randomBytes)];
  const animal = animals[pickIndex(animals.length, randomBytes)];
  const number = HANDLE_NUMBER_MIN + pickIndex(HANDLE_NUMBER_COUNT, randomBytes);
  return `${adjective}-${animal}-${number}`;
}

/**
 * Turns a refused handle into the sentence that names the rule.
 *
 * Three cases, three sentences: "a handle is not an email address" is the one
 * that has to be unmistakable, because typing an address into this box is the
 * single most likely mistake a person arriving from any other service makes.
 *
 * It lives HERE, beside {@link findHandleProblem}, rather than in a component:
 * three forms need it (signup, sign-in, recovery) and each one feeds it into a
 * Zod schema, so a copy of the mapping in any one of them would be a fourth
 * place for the `@` rule to drift.
 */
export function describeHandleProblem(candidate: string, t: HandleTranslate): string | null {
  const problem = findHandleProblem(candidate);
  if (problem === null) return null;
  if (problem === 'email-shaped') return t('sync.setup.handleNotAnEmail');
  if (problem === 'too-long') return t('sync.setup.handleTooLong');
  return t('sync.setup.handleRequired');
}
