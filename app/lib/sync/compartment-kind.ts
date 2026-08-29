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
 * ── An unrecognised KEY is PRESERVED, not refused (M164/03) ──────────────
 *
 * The opposite answer to the opposite question, and `.adr/0009` records the
 * rejection deliberately: "is this mine?" is answered strictly, "do I
 * understand all of it?" is answered generously. Refusing an unknown key would
 * brick every older client on every compartment schema bump — the whole
 * `.default()` convention in `backup.ts` exists so a schema addition is
 * invisible to an older reader.
 *
 * But zod's `z.object` STRIPS what it does not list, so "invisible" was one
 * step short of true: an older client opened the compartment, lost the newer
 * client's field, and its next push wrote the loss back. `backup.ts:388-394`
 * defends against exactly this by LISTING the fields it must keep — a defence
 * that cannot work across versions, because a field a NEWER build added is one
 * this build cannot list.
 *
 * So {@link parseCompartmentPlaintext} returns the recognised region and the
 * leftover keys SEPARATELY, and {@link taggedCompartmentPlaintext} puts the
 * leftovers back. The client never inspects one, never validates one and never
 * merges one: an extra is opaque by definition, and the only thing this build
 * knows about it is that somebody else understands it.
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
 *  - `unreadable`: NOT AN OBJECT AT ALL, so there is nowhere for a tag to be.
 *    Not a statement about kind, and deliberately not a refusal — the region
 *    schema is left to fail on it, so the caller's existing `null` path is
 *    unchanged.
 *
 * `unreadable` means that ONE thing and nothing else (M164/06). It used to
 * also cover "the tag schema rejected this plaintext", which made a `kind` of
 * `5` indistinguishable from an absent tag and walked a mistagged study
 * compartment straight past the refusal — the exact hazard, reached through
 * the one door left open. Everything about a plaintext except "is it an
 * object" is now narrowed by hand, below.
 */
export type CompartmentKindReading = CompartmentKind | 'unrecognised' | 'unreadable';

/**
 * A compartment plaintext seen as nothing but "an object with keys" — the one
 * view that can see a key this build has never heard of.
 *
 * A schema rather than a hand-written type so the dictionary shape is derived
 * from the parser that produces it, and so the narrowing is zod's rather than
 * a cast.
 */
const compartmentExtrasSchema = z.record(z.string(), z.unknown());

/**
 * The keys of a compartment plaintext that this build does not recognise —
 * everything a NEWER client put there, carried verbatim.
 *
 * Deliberately opaque. Nothing reads a value out of this, nothing validates
 * one, and nothing merges one; the type says `unknown` because that is the
 * whole truth about it.
 */
export type CompartmentExtras = z.infer<typeof compartmentExtrasSchema>;

/**
 * What a compartment plaintext splits into: the part this build understands,
 * and the part it must give back untouched.
 *
 * Returned as two fields rather than one merged object on purpose. The region
 * goes on to `recomposeSnapshot`, where an unclassified key is a hard error
 * (`snapshot-partition.ts`) — so the extras must not be able to ride along
 * with it, and a caller that wants them has to say so.
 */
export interface ParsedCompartment<TRegion> {
  /** The region, exactly as the schema parsed it. */
  region: TRegion;
  /** Everything else in the plaintext, minus the kind tag. `{}` for a plaintext this build fully understands. */
  extras: CompartmentExtras;
}

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
 * Pure and total: it never throws, and it reads exactly two keys — `kind` and,
 * only when there is no tag, `studyKeyring`. Both compartment opens go through
 * it, so the tag and the sniff are written down exactly once.
 */
export function readCompartmentKind({ value }: { value: unknown }): CompartmentKindReading {
  // THE ONLY SCHEMA IN THIS FUNCTION, and it asks the only question whose
  // failure honestly means "there is no tag here": is this a dictionary? Every
  // field below is then narrowed by hand against the value it must equal.
  //
  // A schema per field would put the two answers back on one exit — a `kind`
  // the schema rejects is a REFUSAL, and a `kind` that is absent is a
  // migration, and a whole-object parse cannot tell them apart. That collapse
  // is what M164/06 found: `{"kind":5,…}` failed the old tag schema, came back
  // `'unreadable'`, and was opened as an empty diary.
  const plaintext = compartmentExtrasSchema.safeParse(value);
  if (!plaintext.success) return 'unreadable';

  const kind: unknown = plaintext.data['kind'];
  if (kind === COMPARTMENT_KIND.diary) return COMPARTMENT_KIND.diary;
  if (kind === COMPARTMENT_KIND.study) return COMPARTMENT_KIND.study;
  // PRESENT, and not one of the two. A newer client's third kind, a corrupted
  // byte, or a hostile plaintext — this build cannot tell which, and all three
  // have the same correct answer: do not guess, refuse.
  //
  // PRESENCE, not truthiness (M164/08). An explicit `kind: null` is "present
  // but meaningless", and ADR-0009's amendment puts that on the refusal side:
  // a plaintext that IS an object and carries a `kind` this build cannot read
  // is refused, and only an ABSENT tag takes the migration exit below. Reading
  // `null` as absent was the one shape where present meant absent — masked
  // today by the untagged sniff, which catches a study plaintext anyway, and
  // masks are not guarantees.
  if (Object.hasOwn(plaintext.data, 'kind')) return 'unrecognised';

  // UNTAGGED — written before M164/02. A `studyKeyring` here is the only
  // evidence that survives, and it is conclusive in one direction: the diary's
  // region has never carried that key, and the study's region always does
  // (`studyPrivateRegionSchema` defaults it to `[]`, and the seal stringifies
  // the parsed region). See this module's header on why the alternative — a
  // flat "untagged means diary" — is a lockout nobody can rule out, because
  // the server cannot be asked.
  //
  // PRESENCE is the evidence, not shape: a `studyKeyring` this build cannot
  // parse is still a key nothing on the diary side has ever written, and
  // demanding an array here would hand the malformed case back to the diary
  // open — which is the whole class of mistake this spec closes.
  const studyKeyring: unknown = plaintext.data['studyKeyring'];
  if (studyKeyring !== null && studyKeyring !== undefined) return COMPARTMENT_KIND.study;
  return COMPARTMENT_KIND.diary;
}

/**
 * Validates a just-decrypted compartment plaintext AS the kind the caller can
 * use, refuses the other one, and hands back what it did not understand.
 *
 * The one place both sides share, so neither a refusal nor a preservation can
 * exist on one side only. The region schemas stay apart, and so do the two
 * session types: nothing here accepts either region, and no function above it
 * does.
 *
 * @throws {WrongCompartmentKindError} when the plaintext is the other kind, or
 * a kind this build does not know. NOT when it is malformed — that stays the
 * schema's own error, which each caller already turns into the `null` that
 * means "we learned nothing". And NOT when it merely carries a key this build
 * has never seen: that one comes back in {@link ParsedCompartment.extras}.
 */
export function parseCompartmentPlaintext<TRegion extends object>({
  value,
  expected,
  schema,
}: {
  value: unknown;
  expected: CompartmentKind;
  schema: z.ZodType<TRegion>;
}): ParsedCompartment<TRegion> {
  const actual = readCompartmentKind({ value });
  // `unreadable` is not a claim about kind, so it is not refused here — the
  // schema below rejects it, and the caller's existing failure path applies.
  if (actual !== expected && actual !== 'unreadable') throw new WrongCompartmentKindError({ expected, actual });
  const region = schema.parse(value);
  return { region, extras: unrecognisedKeys({ value, region }) };
}

/**
 * The keys the region schema did not take — computed by DIFFERENCE against the
 * parsed region, never by reading the schema.
 *
 * The parsed region is the authority on what this build recognises because
 * every field on both regions carries a `.default()`, so a successful parse
 * always names all of them — including the ones the plaintext omitted. Asking
 * the schema instead would mean reaching into its internals for a list the
 * parse has already produced.
 *
 * The kind tag is excluded because it is not part of either region: it is
 * written by {@link taggedCompartmentPlaintext} and re-written by it on every
 * seal, so carrying it as an extra would mean spreading a stale tag back in.
 */
function unrecognisedKeys<TRegion extends object>({
  value,
  region,
}: {
  value: unknown;
  region: TRegion;
}): CompartmentExtras {
  const plaintext = compartmentExtrasSchema.safeParse(value);
  // Unreachable for a plaintext the schema above accepted, and not asserted:
  // "no extras" is the answer that loses nothing, and a throw here would turn
  // a preservation feature into a new way to fail an open.
  if (!plaintext.success) return {};

  const recognised = new Set<string>([...Object.keys(region), 'kind']);
  return Object.fromEntries(Object.entries(plaintext.data).filter(([key]) => !recognised.has(key)));
}

/**
 * The bytes a seal encrypts: the region, what it is, and everything the last
 * open did not understand.
 *
 * Both seals go through here so that neither can write an untagged compartment
 * or drop a newer client's field.
 *
 * ── The ORDER is the whole safety property ───────────────────────────────
 *
 * `extras` first, then the tag, then the REGION LAST. A recognised key can
 * therefore never be shadowed by a stale extra: if a future build promotes an
 * extra into the region, this build's own value for it wins the moment it
 * becomes recognised. The tag sits between them, where a leftover key called
 * `kind` cannot reach it — and neither region type has a `kind` field to
 * overwrite it with, which is why the region may safely go last.
 */
export function taggedCompartmentPlaintext<TRegion extends object>({
  region,
  kind,
  extras,
}: {
  region: TRegion;
  kind: CompartmentKind;
  extras: CompartmentExtras;
}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ ...extras, kind, ...region }));
}
