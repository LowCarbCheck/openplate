/**
 * WHAT A COMPARTMENT PLAINTEXT IS — the one field that says so, and the
 * refusal that reads it (M164/02).
 *
 * Two compartments now share one crypto construction
 * (`engine/crypto/private-store.ts`): the DIARY's owner-private compartment
 * (`private-store.ts` over `OwnerPrivateRegion`) and the STUDY console's
 * (`research/study-compartment.ts` over `StudyPrivateRegion`). Same CDK, same
 * two wraps, same AAD. What they do not share is the plaintext shape — and
 * until this module existed, nothing said which one a given plaintext was.
 *
 * ── Why the crypto cannot answer this, and never could ───────────────────
 *
 * Measured, both directions, 2026-08-28: each region's schema parses the
 * other's plaintext without throwing and yields a plausible EMPTY region,
 * because every field on both sides carries a zod default and zod strips the
 * keys it does not know. The passphrase KEK does not help either — `K_pp`
 * derives from the passphrase of whichever account signed in, so slot 1
 * unwraps and the AAD binds the right account id. Both checks pass. The
 * crypto is working exactly as designed; it authenticates the BYTES, and it
 * was never asked what they mean.
 *
 * The reachable direction is the quiet one: a researcher who types her DIARY
 * address into `/study` gets a working sign-in, and the next mint would write
 * `{ studyKeyring: [...] }` over her share private key, her pseudonym root and
 * every study she has joined.
 *
 * ── An absent tag means `diary`, and that IS the forward migration ───────
 *
 * The same pattern `backup.ts` uses for every field it has ever added: the
 * default is the migration, and there is no migration step. Every compartment
 * written before today is a diary one — with one exception nobody can check.
 *
 * ── The sniff, and why it is not defensive padding ───────────────────────
 *
 * `/study` is an unconditional client route (`routes.ts`), so a study
 * compartment can already exist in production with the research lane dark.
 * Whether one does is NOT a question anybody can answer: the service is
 * zero-knowledge by construction, and nobody — including us — can look inside
 * a compartment on the server. So "no study compartment predates the tag" is
 * an assumption, and code must not rest on one it cannot test.
 *
 * Hence {@link readCompartmentKind}'s sniff: an untagged plaintext that
 * carries a `studyKeyring` is a study compartment. Without it, a study account
 * created before this spec would be locked out of its own keyring — not
 * destroyed, thanks to M164/01's re-emit, but unreadable, which one support
 * ticket later is the same outcome.
 *
 * ── A wrong kind THROWS; it is the opposite of a `null` ──────────────────
 *
 * Both `tryOpen`s return `null` for every decrypt failure, and their comments
 * give the honest reason: a GCM tag check does not say why it failed. That
 * reason expires the moment the bytes decrypt. The client is then holding
 * plaintext and can read what it is, so `null` — "we learned nothing" — would
 * be a lie about the one case where it learned exactly what it is holding.
 *
 * ── What this module deliberately does NOT do ────────────────────────────
 *
 * It does not refuse an unrecognised KEY inside the right kind. That is a
 * different case (spec 03), and refusing on it would brick every older client
 * on every compartment schema bump — see `.adr/0009`.
 */
import { z } from 'zod';

/**
 * The two compartment plaintexts, as a value.
 *
 * A const object rather than a bare union so that the tag written by a seal
 * and the tag read by an open are the SAME symbol — the twins cannot drift by
 * one string literal being retyped.
 */
export const COMPARTMENT_KIND = { diary: 'diary', study: 'study' } as const;

/** Which compartment a plaintext is. There is no third kind, and no "either". */
export type CompartmentKind = (typeof COMPARTMENT_KIND)[keyof typeof COMPARTMENT_KIND];

/**
 * What {@link readCompartmentKind} can conclude — a kind, or one of the two
 * answers that are not a kind.
 *
 *  - `unrecognised`: tagged, with something this build has never heard of. A
 *    NEWER client wrote it, and opening it as ours would be a guess.
 *  - `unreadable`: not shaped like a compartment plaintext at all. Not a
 *    statement about kind, and deliberately not a refusal — the region schema
 *    is left to fail on it, so the caller's existing `null` path is unchanged.
 */
export type CompartmentKindReading = CompartmentKind | 'unrecognised' | 'unreadable';

/**
 * The tag, read WITHOUT committing to either region's schema.
 *
 * `kind` is `z.string()` rather than an enum on purpose: an enum would make an
 * unrecognised tag indistinguishable from a malformed plaintext, and those two
 * take different exits below.
 */
const compartmentTagSchema = z.object({
  kind: z.string().nullish(),
  /** The SNIFF's only evidence. A diary compartment has never had this key; a study one always has it. */
  studyKeyring: z.array(z.unknown()).nullish(),
});

/** Thrown when a compartment opened cleanly and turned out to belong to the other kind of account. */
export class WrongCompartmentKindError extends Error {
  /** The kind the caller can actually use. */
  readonly expected: CompartmentKind;
  /** What the plaintext says it is. Never the raw tag string — an untrusted string must not be echoed onto a screen. */
  readonly actual: CompartmentKind | 'unrecognised';

  constructor({ expected, actual }: { expected: CompartmentKind; actual: CompartmentKind | 'unrecognised' }) {
    super(wrongKindMessage({ expected, actual }));
    this.name = 'WrongCompartmentKindError';
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * The sentence a person sees. It reaches `describeSyncFailure` on the diary
 * side and `describeErrorForUser` on the console, so it has to name the
 * mistake that was actually made rather than the field that detected it.
 */
function wrongKindMessage({
  expected,
  actual,
}: {
  expected: CompartmentKind;
  actual: CompartmentKind | 'unrecognised';
}): string {
  if (actual === 'unrecognised') {
    return 'This account’s private data was written by a newer version of openplate. Update this device before signing in again.';
  }
  if (expected === COMPARTMENT_KIND.study) {
    return 'This is not a study account — its private data belongs to a personal diary. Sign in with the study’s own address.';
  }
  return 'This account is a study console, not a diary. Sign in with your own address, or open it at /study.';
}

/**
 * What a decrypted plaintext SAYS it is.
 *
 * Pure and total: it never throws, and it reads nothing but the two fields
 * above. Both compartment opens go through it, so the tag and the sniff are
 * written down exactly once.
 */
export function readCompartmentKind({ value }: { value: unknown }): CompartmentKindReading {
  const tag = compartmentTagSchema.safeParse(value);
  if (!tag.success) return 'unreadable';

  const { kind, studyKeyring } = tag.data;
  if (kind === COMPARTMENT_KIND.diary) return COMPARTMENT_KIND.diary;
  if (kind === COMPARTMENT_KIND.study) return COMPARTMENT_KIND.study;
  if (kind !== null && kind !== undefined) return 'unrecognised';

  // UNTAGGED — written before M164/02. A `studyKeyring` here is the only
  // evidence that survives, and it is conclusive in one direction: the diary's
  // region has never carried that key, and the study's region always does
  // (`studyPrivateRegionSchema` defaults it to `[]`, and the seal stringifies
  // the parsed region). See this module's header on why the alternative — a
  // flat "untagged means diary" — is a lockout nobody can rule out, because
  // the server cannot be asked.
  if (studyKeyring !== null && studyKeyring !== undefined) return COMPARTMENT_KIND.study;
  return COMPARTMENT_KIND.diary;
}

/**
 * Validates a just-decrypted compartment plaintext AS the kind the caller can
 * use, and refuses the other one.
 *
 * The one place both sides share, so a refusal cannot exist on one side only.
 * The region schemas stay apart, and so do the two session types: nothing here
 * accepts either region, and no function above it does.
 *
 * @throws {WrongCompartmentKindError} when the plaintext is the other kind, or
 * a kind this build does not know. NOT when it is malformed — that stays the
 * schema's own error, which each caller already turns into the `null` that
 * means "we learned nothing".
 */
export function parseCompartmentPlaintext<TRegion>({
  value,
  expected,
  schema,
}: {
  value: unknown;
  expected: CompartmentKind;
  schema: z.ZodType<TRegion>;
}): TRegion {
  const actual = readCompartmentKind({ value });
  // `unreadable` is not a claim about kind, so it is not refused here — the
  // schema below rejects it, and the caller's existing failure path applies.
  if (actual !== expected && actual !== 'unreadable') throw new WrongCompartmentKindError({ expected, actual });
  return schema.parse(value);
}

/**
 * The bytes a seal encrypts: the region, plus what it is.
 *
 * Both seals go through here so that neither can write an untagged
 * compartment. The tag is spread LAST, so a region that somehow carried a
 * `kind` of its own cannot mislabel the compartment it is sealed into.
 */
export function taggedCompartmentPlaintext<TRegion extends object>({
  region,
  kind,
}: {
  region: TRegion;
  kind: CompartmentKind;
}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ ...region, kind }));
}
