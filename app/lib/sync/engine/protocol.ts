/**
 * The E2EE sync WIRE CONTRACT — the entire shared surface between an openplate
 * client and a sync service (M128 spec 01).
 *
 * THIS FILE IS MAINTAINED IN TWO REPOS AND MUST STAY IDENTICAL IN SUBSTANCE:
 *  - `openplate/app/lib/sync/engine/protocol.ts`   (this file — the client half)
 *  - `openplate-sync/src/protocol.ts`              (the service half)
 *
 * They are deliberately NOT a shared package: the two repos ship and version
 * independently, and a third party must be able to implement either side from
 * `openplate-sync/PROTOCOL.md` alone without depending on our code. The price
 * of that independence is hand-maintained duplication, so each repo carries a
 * unit test that asserts its local `PROTOCOL_VERSION` (and the size/retention
 * limits) against TRANSCRIBED literals — there is no shared CI, so drift has
 * to fail a test rather than rely on a promise in a doc comment
 * (`tests/unit/sync-engine/protocol.test.ts` here,
 * `tests/unit/protocol.test.ts` there).
 *
 * The service stores OPAQUE BYTES. It never sees a key, never parses an
 * envelope, and never learns anything about the plaintext beyond its length.
 * Everything below is therefore either transport framing or non-secret
 * metadata the service legitimately needs (versions, sizes, CAS tokens).
 */
import { z } from 'zod';

/**
 * The wire-protocol version a client and service must agree on before any
 * sync traffic flows (see {@link checkProtocolCompatibility}).
 *
 * Bump this for ANY breaking change to the endpoints, request/response
 * shapes, auth scheme, or CAS semantics documented in `PROTOCOL.md`.
 * Purely additive changes (a new optional response field, a new endpoint that
 * older clients simply never call) do not require a bump.
 */
export const PROTOCOL_VERSION = 2;

/**
 * The encrypted-blob wire format version — INDEPENDENT of
 * {@link PROTOCOL_VERSION}. This one describes what is inside
 * `ciphertext`: `gzip(JSON(payload))` sealed with AES-256-GCM, the 12-byte IV
 * packed as the leading bytes (`engine/envelope/build-envelope.ts`).
 *
 * Bump ONLY for a genuine crypto/framing change (a different cipher, a
 * different compression codec, a different IV packing). Never bump it for a
 * payload SCHEMA change — that is the local store's own
 * `payloadSchemaVersion`, which travels through this protocol as an opaque
 * number bound into the AAD.
 */
export const ENVELOPE_VERSION = 1;

/**
 * Hard cap on one account's encrypted blob, enforced by the service and
 * mirrored by the client so it can fail early with a useful message instead
 * of eating a 413.
 *
 * CAPACITY PLAN (counsel, 2026-08-03): food-log JSON runs ~400–700 bytes per
 * entry BEFORE compression, so an un-gzipped whole-store blob would reach
 * this cap within 2–4 years of daily use. `ENVELOPE_VERSION` 1 gzips the
 * plaintext before encrypting, which buys roughly an order of magnitude of
 * headroom on highly-repetitive JSON. The long-term fix (chunked/per-entity
 * blobs) is a FUTURE PROTOCOL VERSION BUMP, deliberately deferred and
 * recorded in `PROTOCOL.md` so it is planned rather than discovered under
 * pressure.
 */
export const MAX_BLOB_BYTES = 2 * 1024 * 1024;

/** How many historical blob versions the service retains per account; older ones are pruned on every successful write. */
export const BLOB_VERSION_RETENTION = 5;

/**
 * Path prefix the blob/key-record endpoints are mounted under.
 *
 * CHANGED IN M128 SPEC 02, from `/api/sync` to `/v1/sync`: the standalone
 * service owns its whole URL space now and versions it as a whole, so the
 * blob routes sit beside `/v1/auth/*` under one namespace rather than in a
 * leftover mount path from the era when they were grafted onto this app's
 * Express server. `PROTOCOL.md` §7 records it as a pre-1.0 change that does
 * NOT bump `PROTOCOL_VERSION` — zero production blobs exist, there are no
 * third-party implementations, and no deployed client can be broken by it.
 *
 * CROSS-REPO NOTE: this file is the hand-maintained duplicate of
 * `openplate-sync/src/protocol.ts`, which is the side that ships the routes
 * and is therefore the one to follow when the two disagree. The drift-guard
 * tests on both sides assert TRANSCRIBED literals rather than each other, so
 * a one-sided edit keeps both suites green while the repos diverge — exactly
 * what happened to this constant between spec 02 and spec 03. When you change
 * the contract, change four places: both `protocol.ts` files and both tests.
 */
export const SYNC_API_PREFIX = '/v1/sync';

// ---------------------------------------------------------------------------
// Key records
// ---------------------------------------------------------------------------

/**
 * The two ways an account's DEK is wrapped: under the passphrase-derived KEK
 * (Argon2id → HKDF) and under the recovery-code-derived KEK (HKDF only).
 * Exactly one record of each kind may exist per account.
 */
export type SyncKeyRecordKind = 'passphrase' | 'recovery';

/** Every valid {@link SyncKeyRecordKind}, for validation and exhaustive iteration. */
export const SYNC_KEY_RECORD_KINDS: readonly SyncKeyRecordKind[] = ['passphrase', 'recovery'];

/**
 * A value that arrived as parsed JSON and has not been decoded yet — the one
 * named type for "came off the wire", so that the undecoded-ness of a body is
 * visible in a signature instead of spreading as `unknown`. Mirrors
 * `openplate-sync/src/lib/json.ts`, which names the same boundary on the
 * service side.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

/**
 * A JSON object with unproven keys. Values are optional because an absent key
 * and a present `undefined` are indistinguishable to a decoder.
 */
export interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}

export function isSyncKeyRecordKind(value: JsonValue | undefined): value is SyncKeyRecordKind {
  return value === 'passphrase' || value === 'recovery';
}

// ---------------------------------------------------------------------------
// Version handshake
// ---------------------------------------------------------------------------

/**
 * WHAT USED TO BE HERE: `SIGNUP_MODES` and `SignupMode`.
 *
 * Protocol 2 has one way in. Every account is created by redeeming an invite
 * addressed to an email, so there is no open registration for a mode to
 * describe and no closed one to refuse. The field is gone from `/health`, and
 * a service that still sent it would simply be ignored.
 */

/**
 * What the instance says about ITSELF, as opposed to about the protocol
 * (protocol 2, `/health`).
 *
 * OPTIONAL for the same reason `notice` is: a service older than the field
 * omits it, and a client that required it would refuse to talk to that service
 * — a compatibility break wearing the clothes of an additive change.
 *
 * `ai` is `null` when the instance proxies no model. That is a MEANING, not an
 * omission: it is how a managed instance says "no AI here", and it is what the
 * derived AI settings read to decide whether a signed-in account can scan.
 */
export type InstanceDescriptor = {
  /** The operator's name for this instance. Display only, and hostile input like every other field here. */
  name: string;
  /** The language the instance writes its mail in (`en` or `de` today). Display only. */
  language: string;
  /** Whether the instance can send mail. `false` means an invite or a reset is a link somebody copies by hand. */
  mail: boolean;
  /** The model the instance's AI proxy serves, or `null` when it has no upstream key. */
  ai: { model: string | null } | null;
};

/**
 * What a service reports about itself, read by the client BEFORE its first
 * sync of a session. This replaces the same-process `HOOK_VERSION` check that
 * died with M117's build-time composition seam: client and service are now
 * separately deployed artifacts that can drift by a release, and the only
 * safe way to notice is to ask.
 *
 * A type alias rather than an interface, deliberately: only an alias gets
 * TypeScript's implicit index signature, which is what lets
 * {@link isProtocolHandshake} narrow a {@link JsonValue} to it.
 */
export type ProtocolHandshake = {
  /** The service's {@link PROTOCOL_VERSION}. */
  protocolVersion: number;
  /** The highest {@link ENVELOPE_VERSION} the service is willing to accept on a push. */
  envelopeVersion: number;
  /** Human-readable build identifier — diagnostics only, never compared. */
  serviceVersion: string;
  /**
   * What the instance says about itself — see {@link InstanceDescriptor}.
   *
   * OPTIONAL, and it must stay optional, for the reason the deleted
   * `signupMode` field carried in this slot: a service older than the field
   * omits it, and requiring it would refuse every such instance.
   */
  instance?: InstanceDescriptor;
  /**
   * A short message the operator of that instance wants shown — a planned
   * migration, a shutdown date, a "read this before you sync again".
   *
   * WHY IT IS HERE AT ALL. The service holds no addresses (M181), so it has no
   * channel to write to anybody. This is PULL, never push: the client already
   * reads `/health` on connect, so a person who opens the app sees it and a
   * person who does not, does not. It is not a notification system.
   *
   * OPTIONAL, exactly like `instance`: an instance with nothing to say omits
   * it, and a service older than the field never had it.
   *
   * TREAT IT AS HOSTILE INPUT. It comes from whatever server the user pointed
   * at, which on a self-hosted product is not necessarily the operator they
   * think it is. Render `text` as text and never as markup, and never build a
   * link from `url` without checking its scheme first — see
   * `#app/components/sync-notice-banner`.
   */
  notice?: OperatorNotice;
};

/** The optional operator message of {@link ProtocolHandshake.notice}. `url` is absent when the notice links nowhere. */
export type OperatorNotice = {
  text: string;
  url?: string;
};

/** The decoder for {@link OperatorNotice} — a hostile-input boundary, so the body is parsed, never assumed. */
const operatorNoticeSchema = z.object({
  text: z.string(),
  url: z.string().optional(),
});

/** The decoder for {@link InstanceDescriptor} — same hostile-input boundary as the notice above. */
const instanceDescriptorSchema = z.object({
  name: z.string(),
  language: z.string(),
  mail: z.boolean(),
  ai: z.object({ model: z.string().nullable() }).nullable(),
});

/** The decoder for {@link ProtocolHandshake} — the health endpoint is an I/O boundary, so its body is parsed, not assumed. */
const protocolHandshakeSchema = z.object({
  protocolVersion: z.number(),
  envelopeVersion: z.number(),
  serviceVersion: z.string(),
  // `.optional()` is load-bearing, not tidiness — see the field's doc comment.
  // A required entry here would reject every service older than the field.
  instance: instanceDescriptorSchema.optional(),
  // Optional for the same reason, and dropped rather than fatal when
  // malformed: a broken notice must never stop a client talking to a service
  // whose protocol version is fine.
  notice: operatorNoticeSchema.optional(),
});

/** Result of {@link checkProtocolCompatibility} — `reason` is a user-presentable sentence. */
export type ProtocolCompatibility = { status: 'compatible' } | { status: 'incompatible'; reason: string };

export function isProtocolHandshake(value: JsonValue | undefined): value is ProtocolHandshake {
  return protocolHandshakeSchema.safeParse(value).success;
}

/**
 * The operator notice carried by a `/health` body, or `null` — for a body that
 * is not a handshake, an instance that set no notice, or a service older than
 * the field.
 *
 * Returns the PARSED value rather than the raw one on purpose: this is the
 * boundary where a server-supplied object becomes a typed one, and the caller
 * renders it. Nothing downstream should be re-deriving it from a `JsonValue`.
 */
export function readHandshakeNotice(value: JsonValue | undefined): OperatorNotice | null {
  const parsed = protocolHandshakeSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data.notice ?? null;
}

/**
 * The instance descriptor carried by a `/health` body, or `null` — for a body
 * that is not a handshake, and for a service older than the field.
 *
 * Parsed rather than asserted, like the notice above: this is the boundary
 * where a server-supplied object becomes a typed one. The one consumer that
 * matters is the managed-AI settings derivation, which reads `instance.ai` to
 * learn which model to ask for.
 */
export function readHandshakeInstance(value: JsonValue | undefined): InstanceDescriptor | null {
  const parsed = protocolHandshakeSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data.instance ?? null;
}

/**
 * Decides whether this build may talk to the service that returned `remote`.
 *
 * Pure and total — it never throws and never guesses. A mismatch is REFUSAL
 * with a clear message, never a best-effort attempt: pushing an envelope a
 * service can't store, or decrypting one framed by rules this build doesn't
 * know, corrupts an account's only copy of its data. Silent wrongness is the
 * one outcome this whole handshake exists to prevent.
 */
export function checkProtocolCompatibility(remote: ProtocolHandshake): ProtocolCompatibility {
  if (remote.protocolVersion !== PROTOCOL_VERSION) {
    return {
      status: 'incompatible',
      reason: `This sync server speaks protocol version ${remote.protocolVersion}; this app speaks version ${PROTOCOL_VERSION}. Update whichever side is older before syncing.`,
    };
  }
  if (remote.envelopeVersion !== ENVELOPE_VERSION) {
    return {
      status: 'incompatible',
      reason: `This sync server expects envelope version ${remote.envelopeVersion}; this app produces version ${ENVELOPE_VERSION}. Update whichever side is older before syncing.`,
    };
  }
  return { status: 'compatible' };
}

// ---------------------------------------------------------------------------
// Wire shapes — blobs
// ---------------------------------------------------------------------------

/**
 * A base64-encoded byte string. Binary fields (`ciphertext`, `wrappedDek`)
 * travel as base64 inside JSON bodies rather than as a binary content type,
 * so that every field of every request is inspectable by a self-hoster
 * debugging their own instance.
 */
export type Base64Bytes = string;

/** An ISO-8601 UTC timestamp string, e.g. `2026-08-04T10:11:12.000Z`. */
export type IsoTimestamp = string;

/** `POST {prefix}/blob` — a compare-and-swap write of the account's single encrypted blob. */
export interface PushBlobRequest {
  /**
   * The `blobVersion` this client believes is currently stored (`0` for "no
   * blob exists yet"). The write succeeds only if it still matches — this is
   * the entire concurrency model, and it is never a blind overwrite.
   */
  baseVersion: number;
  envelopeVersion: number;
  ciphertext: Base64Bytes;
}

/** `200` — the CAS write won. */
export interface PushBlobAcceptedResponse {
  newVersion: number;
}

/**
 * `409` — the CAS write lost: another device wrote first. The client must
 * pull `currentVersion`, merge (`engine/merge/merge-entities.ts`), and retry
 * with `baseVersion: currentVersion`.
 */
export interface PushBlobConflictResponse {
  currentVersion: number;
}

/** `200` from `GET {prefix}/blob`. A `404` means this account has never pushed. */
export interface PullBlobResponse {
  blobVersion: number;
  envelopeVersion: number;
  ciphertext: Base64Bytes;
  createdAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Wire shapes — key records
// ---------------------------------------------------------------------------

/**
 * The non-secret KDF metadata a `passphrase` key record carries: the base64
 * Argon2id salt plus the cost parameters any device needs to re-derive the
 * same KEK.
 *
 * CROSS-REPO NOTE: the service half (`openplate-sync/src/protocol.ts`) types
 * this field as an opaque `JsonObject` — it stores and echoes the descriptor
 * verbatim and never interprets it. The client DOES produce and consume it
 * (`client/passphrase-kek.ts`'s `PassphraseKdfDescriptor`, which is
 * structurally this type), so naming the shape here is a client-side
 * narrowing of the same wire bytes, not a different contract.
 */
export interface KdfDescriptor {
  /** base64-encoded Argon2id salt. */
  salt: Base64Bytes;
  /** Argon2id cost parameters, recorded so a second device derives identically. */
  params: {
    memorySizeKib: number;
    iterations: number;
    parallelism: number;
  };
}

/** One wrapped-DEK record as it appears on the wire. */
export interface KeyRecordWire {
  kind: SyncKeyRecordKind;
  /**
   * Argon2id salt + m/t/p parameters for the `passphrase` kind so any device
   * can re-derive the KEK; ALWAYS `null` for `recovery` (HKDF-only — a
   * ≥128-bit random code needs no memory-hard stretch and therefore has no
   * parameters to record). Non-secret by design.
   */
  kdfDescriptor: KdfDescriptor | null;
  wrappedDek: Base64Bytes;
  updatedAt: IsoTimestamp;
}

/** `200` from `GET {prefix}/key-records`. */
export interface ListKeyRecordsResponse {
  records: KeyRecordWire[];
}

/** `PUT {prefix}/key-records/:kind` — also CAS-gated, mirroring the blob endpoint. */
export interface PutKeyRecordRequest {
  kdfDescriptor: KdfDescriptor | null;
  wrappedDek: Base64Bytes;
  /**
   * `null` asserts "no record of this kind exists yet" (first-time setup);
   * any other value asserts "the record I last read had exactly this
   * `updatedAt`" (rotation).
   *
   * The key MUST be present. An ABSENT key is a `400`, deliberately — a
   * caller must not be able to skip the concurrency check by forgetting a
   * field.
   */
  expectedUpdatedAt: IsoTimestamp | null;
}

/** `409` from a key-record PUT whose `expectedUpdatedAt` no longer matches. */
export interface PutKeyRecordConflictResponse {
  currentUpdatedAt: IsoTimestamp | null;
}

/** Every non-2xx response body shape. `error` is diagnostic text, never a machine-readable code. */
export interface ProtocolErrorResponse {
  error: string;
}

/**
 * The status codes that carry protocol meaning. Anything else is a transport
 * or infrastructure failure and should be retried or surfaced as such.
 */
export const PROTOCOL_STATUS = {
  ok: 200,
  noContent: 204,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  payloadTooLarge: 413,
} as const;

// ---------------------------------------------------------------------------
// Wire shapes — shares (§5.16, `openplate-sync` ADR-0002)
// ---------------------------------------------------------------------------

/**
 * These endpoints exist ONLY on a deployment that sets `SYNC_SHARING`.
 * Everywhere else every path below answers the ordinary unknown-route `404`,
 * to every caller, credentialed or not — the terminator is mounted ahead of
 * authentication, so an unconfigured instance is indistinguishable from one
 * where the feature was never written (ADR-0002 prohibition 10).
 *
 * A client must therefore treat a `404` from the LIST endpoints as "this
 * server has no sharing", not as an error, and render nothing rather than a
 * broken screen.
 */
export interface ShareGrantWire {
  /** The clinician's account id. Both sides address a share by the counterpart's account id, never a synthetic share id. */
  granteeAccountId: number;
  /** Pinning metadata only — the server neither computes nor endorses it (ADR-0002 prohibition 1). */
  recipientKeyFingerprint: string;
  createdAt: IsoTimestamp;
  /** The CAS token for the next `PUT`, exactly as a key record's is. */
  updatedAt: IsoTimestamp;
}

/** `200` from `GET {prefix}/shares` — the grantor's own grants. NEVER carries `wrappedDek`. */
export interface ListSharesResponse {
  shares: ShareGrantWire[];
}

/** `PUT {prefix}/shares/:granteeAccountId` — CAS-gated exactly as §5.4. */
export interface PutShareRequest {
  /** The 125-byte share wrap, base64. See `crypto/share-wrap.ts` for the construction. */
  wrappedDek: Base64Bytes;
  recipientKeyFingerprint: string;
  /** `null` asserts "no share for this grantee yet". An ABSENT key is a `400`, deliberately. */
  expectedUpdatedAt: IsoTimestamp | null;
}

/** `409` from a share `PUT` whose `expectedUpdatedAt` no longer matches. */
export interface PutShareConflictResponse {
  currentUpdatedAt: IsoTimestamp | null;
}

/** One share addressed to the calling account — `GET {prefix}/shared`. The wrap DOES travel here; only this caller can open it. */
export interface ReceivedShareWire {
  grantorAccountId: number;
  wrappedDek: Base64Bytes;
  recipientKeyFingerprint: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** `200` from `GET {prefix}/shared`. */
export interface ListSharedResponse {
  shares: ReceivedShareWire[];
}

/**
 * `200` from `GET {prefix}/shared/:grantorAccountId/blob` — the grantor's
 * CURRENT blob and nothing else. No version history, no key records, no
 * profile.
 *
 * `grantorAccountId` is part of the contract rather than a convenience echo:
 * §3.2's AAD binds it, so a grantee who does not know it cannot decrypt this
 * response at all.
 */
export interface SharedBlobResponse {
  grantorAccountId: number;
  blobVersion: number;
  envelopeVersion: number;
  ciphertext: Base64Bytes;
  createdAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Wire shapes — atomic DEK rotation (§5.17)
// ---------------------------------------------------------------------------

/** One re-wrapped key record inside a rotation. There is no per-record CAS token: the submission itself is the concurrency unit. */
export interface RotateDekKeyRecordWire {
  kind: SyncKeyRecordKind;
  kdfDescriptor: KdfDescriptor | null;
  wrappedDek: Base64Bytes;
}

/** One entry of the rotation's KEEP list. Every share row not named here is deleted in the same transaction. */
export interface RotateDekShareWire {
  granteeAccountId: number;
  wrappedDek: Base64Bytes;
  recipientKeyFingerprint: string;
}

/**
 * `POST {prefix}/rotate-dek` — Tier 2 revocation, all of it, in one
 * transaction (ADR-0002 prohibition 8: a rotation is atomic or it does not
 * exist).
 *
 * PRESENT ON EVERY DEPLOYMENT, unlike §5.16: it rewrites the caller's own blob
 * and own two key records, rows every account everywhere has. On an instance
 * without `SYNC_SHARING` the keep list must be empty.
 */
export interface RotateDekRequest {
  blob: { baseVersion: number; envelopeVersion: number; ciphertext: Base64Bytes };
  /** BOTH kinds, always. A missing kind is a `400`, never a silent partial rotation. */
  keyRecords: RotateDekKeyRecordWire[];
  /** The keep list. `[]` is valid and revokes everything; an ABSENT key is a `400`. */
  shares: RotateDekShareWire[];
  /**
   * The new recovery code's auth proof, and the raw code itself. BOTH REQUIRED
   * (M192 addendum); a request without either is a `400`.
   *
   * ── The bug this closes, which was live from M181 to M192 ───────────────
   *
   * A rotation always mints a fresh recovery code, because the `recovery` key
   * record above wraps the NEW DEK. Until this addendum the request carried no
   * verifier and no escrow, so the service kept both on the OLD code: the old
   * code authenticated and unwrapped nothing, the new code unwrapped and
   * authenticated nothing, and neither opened the account. Nothing threw. The
   * failure surfaced on a later reset, on a different day, as a diary that
   * would not decrypt.
   *
   * So the verifier and the escrow move inside the rotation's transaction,
   * with the key records they belong to. `recoveryCode` is Crockford base32
   * text; the service canonicalizes it, exactly as it does at signup.
   */
  newRecoveryAuthHash: Base64Bytes;
  recoveryCode: string;
}

/** `200` from a rotation. `revokedShares` counts the rows the keep list did not name. */
export interface RotateDekAcceptedResponse {
  newVersion: number;
  keptShares: number;
  revokedShares: number;
}

/** `409` — the blob CAS did not hold, and NOTHING was written. */
export interface RotateDekConflictResponse {
  currentVersion: number;
}

// ---------------------------------------------------------------------------
// Wire shapes — research contributions (§5.18, `openplate-sync` ADR-0003)
// ---------------------------------------------------------------------------

/**
 * These endpoints exist ONLY on a deployment that sets `SYNC_RESEARCH`, and
 * the rule is `SYNC_SHARING`'s word for word: everywhere else every path below
 * answers the ordinary unknown-route `404`, to every caller, credentialed or
 * not, with the terminator mounted ahead of authentication (ADR-0003
 * prohibition 9). A `404` from a list endpoint is therefore "this server has
 * no research lane", never an error.
 *
 * The two flags are independent — neither implies the other — so a client must
 * ask each surface separately and must not infer one from the other.
 *
 * WHAT IS NOT HERE IS THE POINT. There is no contributor account id on any
 * study-side shape below, and there must never be one: §3.5's AAD was designed
 * so the researcher never needs one, which is the deliberate inversion of
 * §5.16's `SharedBlobResponse` (ADR-0003 prohibition 2). Anyone reusing that
 * shape here imports a re-identification leak.
 *
 * The service builds these documents as literals in its own
 * `server/research-routes.ts` rather than from a mirrored type — `PROTOCOL.md`
 * §5.18 is the contract both sides answer to, and this file is the client's
 * reading of it.
 */
export interface PutContributionRequest {
  /** Computed on the contributor's device. The server stores it and cannot verify it — it never holds the root. */
  pseudonym: string;
  /** A tier name this protocol revision defines. An unknown name is a `400`, so prohibition 1 has teeth on both sides. */
  schemaTier: string;
  /** `ephPub(65) ‖ iv(12) ‖ AES-256-GCM(...)`, base64. Opaque to the service. */
  body: Base64Bytes;
  /**
   * The NEW version, not a base. It binds into §3.5's AAD, so it must be the
   * value the ciphertext was sealed under, and the server's rule is strictly
   * greater than the stored one rather than exact-successor: a client
   * recomputing and re-pushing the whole projection must never be wedged by a
   * version that never left the device.
   */
  contributionVersion: number;
}

/**
 * One of the CONTRIBUTOR's own enrolments — `GET {prefix}/contributions`, and
 * the `200` body of a `PUT`.
 *
 * `studyAccountId` is the only account id in this family, and it is the
 * counterpart the contributor named itself. **Never carries `body`**: the
 * contributor's own client holds the source it was reduced from and has no
 * use for its own ciphertext.
 */
export interface ContributionEnrolmentWire {
  studyAccountId: number;
  pseudonym: string;
  schemaTier: string;
  contributionVersion: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** `200` from `GET {prefix}/contributions`. */
export interface ListContributionsResponse {
  contributions: ContributionEnrolmentWire[];
}

/**
 * `409` from a contribution `PUT`. Mirrors §5.1's blob conflict rather than
 * §5.16's share conflict: the CAS token in this lane is a monotonic INTEGER,
 * because that integer also rides in the AAD and the attack it refuses is a
 * rollback to an older contribution.
 */
export interface PutContributionConflictResponse {
  currentVersion: number;
}

/**
 * One contribution AS THE STUDY SEES IT — `GET {prefix}/study/contributions`.
 *
 * Five fields, and the sixth that would matter is absent by construction. Four
 * of §3.5's five AAD fields ride here; the fifth, `studyKeyFingerprint`, the
 * researcher computes locally from her own key, which is what keeps the
 * key-substitution defence out of the server's hands.
 */
export interface StudyContributionWire {
  pseudonym: string;
  contributionVersion: number;
  schemaTier: string;
  body: Base64Bytes;
  createdAt: IsoTimestamp;
}

/**
 * `200` from `GET {prefix}/study/contributions`.
 *
 * `studyAccountId` is echoed ONCE, at the top level, and never per row: it is
 * the caller's own id, it authenticated as it, it is identical for every row,
 * and it is not a contributor identifier. The researcher needs it to rebuild
 * §3.5's AAD; per row it would be noise, and a per-row account id is exactly
 * the shape prohibition 2 forbids.
 */
export interface ListStudyContributionsResponse {
  studyAccountId: number;
  contributions: StudyContributionWire[];
}

/** One tombstone — `GET {prefix}/study/withdrawals`. Pseudonym and time, and nothing else; prohibition 6 forbids an account id here. */
export interface StudyWithdrawalWire {
  pseudonym: string;
  withdrawnAt: IsoTimestamp;
}

/** `200` from `GET {prefix}/study/withdrawals`. The purge instructions — see `research/study.ts`, where honouring them is not optional. */
export interface ListStudyWithdrawalsResponse {
  withdrawals: StudyWithdrawalWire[];
}
