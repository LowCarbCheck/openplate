/**
 * A protocol-faithful sync service, built from openplate's OWN
 * `app/lib/sync/engine/protocol.ts` types and `openplate-sync/PROTOCOL.md`.
 *
 * ── Why an in-repo fake and not the real service ─────────────────────────
 *
 * This repo has to stand alone. Importing from a sibling checkout would make
 * `pnpm test:integration` pass on one machine and fail on every clone, and it
 * would quietly couple this client to a repo that ships and versions
 * separately.
 *
 * So this is a CONTRACT TEST, in the Pact sense: the client is exercised
 * against an independent reading of the specification rather than against the
 * implementation it happens to talk to. That is strictly more useful for
 * catching drift — if the client and the real service both misread the same
 * paragraph, testing them against each other proves nothing.
 *
 * It also gives the zero-knowledge test its observation point. Every request
 * body, every header and every stored byte passes through here, so a marker
 * string planted in the plaintext can be searched for across the entire
 * server-visible surface. Against the real service, that surface is inside
 * another process.
 *
 * ── What is faithful, and what is not ────────────────────────────────────
 *
 * Faithful: the endpoints, the status codes, blob CAS on `blobVersion`,
 * key-record CAS on `expectedUpdatedAt` (including "an absent field is a
 * 400"), the KDF-descriptor lookup returning a stable dummy for unknown
 * addresses, the protocol-2 invite family (`/invite-lookup` reads and spends
 * nothing, `/signup` redeems an invite into an account with BOTH key records
 * and the recovery escrow in one commit), the reset pair (`/reset/request`
 * always `202`, `/reset/open` spends the token for the escrowed code), the
 * recovery pair (`/recover` proves the code, `/recover-rotate` moves the
 * verifier, the key records and the escrow together and refuses without a
 * `passphrase` record), rotating refresh tokens with family revocation on
 * reuse, the `/health` handshake, and §5.18's research family — the
 * contribution CAS on a strictly-greater INTEGER `contributionVersion`, its
 * `409 {"currentVersion"}`, the `413`, the tier allow-list, and study-side
 * reads that carry no contributor account id.
 *
 * Not faithful, deliberately: no throttling (`PERMISSIVE_THROTTLE` exists in
 * the real service for exactly this reason — every request here comes from
 * 127.0.0.1, and the real recovery endpoints are throttled per IP and
 * address), no pepper (verifiers are stored as the submitted auth-hash, which
 * is what makes it a fake rather than a second implementation), no escrow
 * encryption (the raw recovery code is held in memory, where the real service
 * seals it under a subkey of `SERVER_SECRET`), no mail, and no retention
 * pruning.
 *
 * The research lane is always LIT here, unlike production, which runs
 * `SYNC_RESEARCH=false` and answers the unknown-route 404 on every research
 * path ahead of authentication. That terminator is the service's own
 * behaviour and is asserted in the service's repo; what this fake exists to
 * cover is the CLIENT against a lane that answers, which is the only
 * configuration in which a dropped sync is observable at all.
 *
 * WHAT CAME BACK IN M192: the mailed reset. M181 deleted it because on a
 * zero-knowledge service it restored a LOGIN to a diary it could not open;
 * protocol 2 escrows the recovery code, so the same link returns the diary.
 * The `tokens: null` branch of the old verification flow is still gone and
 * must stay gone.
 */
import { createServer, type Server } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import {
  MAX_BLOB_BYTES,
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  SYNC_API_PREFIX,
  isSyncKeyRecordKind,
  type SyncKeyRecordKind,
} from '../../app/lib/sync/engine/protocol';
import { AUTH_API_PREFIX } from '../../app/lib/sync/engine/client/auth-wire';

// ---------------------------------------------------------------------
// Request parsing — every handler below branches on a parsed value, never
// on the raw body. The service is the I/O boundary, so this is where the
// wire turns into domain types.
// ---------------------------------------------------------------------

/** An arbitrary JSON object, used where the service stores a payload it never interprets. */
const jsonObjectSchema = z.record(z.string(), z.unknown());

/**
 * The Argon2id salt + cost parameters are opaque HERE by design: the service
 * stores and echoes the descriptor verbatim and only the client reads it.
 */
const kdfDescriptorSchema = jsonObjectSchema;
type KdfDescriptor = z.infer<typeof kdfDescriptorSchema>;

const syncKeyRecordKindSchema = z.union([z.literal('passphrase'), z.literal('recovery')]);

const keyRecordSubmissionSchema = z.object({
  kind: syncKeyRecordKindSchema,
  kdfDescriptor: kdfDescriptorSchema.nullable().optional(),
  wrappedDek: z.string().min(1),
});
type KeyRecordSubmission = z.infer<typeof keyRecordSubmissionSchema>;
const keyRecordSubmissionsSchema = z.array(keyRecordSubmissionSchema);

/**
 * An address, with the structural rules the real service enforces
 * (`auth-input.ts`): non-empty, length-bounded, and containing exactly one
 * `@` with a non-empty local part and a dotted domain.
 *
 * THE INVERSE of the rule this replaced. A handle was refused for containing
 * `@`; an address is refused for not containing one. A fake that accepted a
 * handle would let a client regress unnoticed.
 */
const emailSchema = z
  .string()
  .min(1)
  .max(254)
  .refine(
    (value) => {
      const parts = value.split('@');
      const [local, domain] = parts;
      if (parts.length !== 2 || local === undefined || local === '' || domain === undefined) return false;
      const dotAt = domain.indexOf('.');
      return dotAt > 0 && dotAt < domain.length - 1;
    },
    { message: 'email must be an address' },
  );

const kdfLookupRequestSchema = z.object({ email: emailSchema });

const inviteLookupRequestSchema = z.object({ inviteToken: z.string().min(1) });

/**
 * Protocol 2's signup. NOTHING here is optional except the display name, and
 * that is the contract rather than this fake being strict: the client hides
 * the recovery code, so an account created without the escrow and both key
 * records is one nobody can ever reset.
 */
const signupRequestSchema = z.object({
  inviteToken: z.string().min(1),
  authHash: z.string(),
  kdfDescriptor: kdfDescriptorSchema.optional(),
  displayName: z.string().nullish(),
  recoveryAuthHash: z.string().min(1),
  recoveryCode: z.string().min(1),
  keyRecords: z.unknown(),
});

const loginRequestSchema = z.object({ email: z.string(), authHash: z.string() });
const refreshRequestSchema = z.object({ refreshToken: z.string() });
const patchAccountRequestSchema = z.object({ displayName: z.string().nullable() });

const resetRequestSchema = z.object({ email: z.string() });
const resetOpenRequestSchema = z.object({ resetToken: z.string().min(1) });

const recoverRequestSchema = z.object({ email: z.string(), recoveryAuthHash: z.string() });

const recoverRotateRequestSchema = z.object({
  email: z.string(),
  recoveryAuthHash: z.string(),
  newAuthHash: z.string(),
  kdfDescriptor: kdfDescriptorSchema.optional(),
  // Parsed separately so "absent" and "malformed" stay distinguishable (§5.14).
  keyRecords: z.unknown(),
  newRecoveryAuthHash: z.string().optional(),
  recoveryCode: z.string().optional(),
});

const changePassphraseRequestSchema = z.object({
  currentAuthHash: z.string(),
  newAuthHash: z.string(),
  kdfDescriptor: kdfDescriptorSchema.optional(),
  keyRecords: z.unknown(),
});

const deleteAccountRequestSchema = z.object({ authHash: z.string() });

const pushBlobRequestSchema = z.object({
  baseVersion: z.number().int().min(0),
  envelopeVersion: z.number(),
  ciphertext: z.string().min(1),
});

const putKeyRecordRequestSchema = z.object({
  kdfDescriptor: kdfDescriptorSchema.nullable().optional(),
  wrappedDek: z.string().min(1),
  expectedUpdatedAt: z.string().nullable(),
});

/**
 * §5.17's rotation, with the two fields M192's addendum made REQUIRED.
 *
 * The `recovery` key record inside a rotation wraps the NEW DEK, so the
 * verifier and the escrow have to move with it. Before the addendum the
 * service kept both on the old code, and the account ended with a code that
 * authenticated and a different one that decrypted. This fake refuses a
 * request without both, which is the whole reason it parses them.
 */
const rotateDekRequestSchema = z.object({
  blob: pushBlobRequestSchema,
  keyRecords: z.unknown(),
  shares: z.unknown(),
  newRecoveryAuthHash: z.string().min(1),
  recoveryCode: z.string().min(1),
});

const rotateDekShareSchema = z.object({
  granteeAccountId: z.number().int().positive(),
  wrappedDek: z.string().min(1),
  recipientKeyFingerprint: z.string().min(1),
});

/**
 * §5.16's share `PUT`. CAS-gated exactly as a key record is, and for the same
 * reason: a rotation's re-wrap can race a re-grant, and a blind write would
 * clobber whichever landed last.
 */
const putShareRequestSchema = z.object({
  wrappedDek: z.string().min(1),
  // Pinning metadata the service stores and never endorses (ADR-0002
  // prohibition 1). It is not verified here because it cannot be: the service
  // holds no key to compute it from.
  recipientKeyFingerprint: z.string().min(1),
  expectedUpdatedAt: z.string().nullable(),
});

/** Everything the service ever sees AND everything it answers. The zero-knowledge test searches all of it. */
export interface ObservedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  /**
   * The JSON document this request was answered with, or `undefined` for the
   * `204`/`end()` replies that carry none.
   *
   * RESPONSES ARE RECORDED, not just requests, because half of §5.18 is a
   * READ: the study-side cohort is something the service SERVES, and a leak
   * there is invisible in a log of what it was sent.
   */
  response: unknown;
}

interface StoredBlob {
  blobVersion: number;
  envelopeVersion: number;
  ciphertext: string;
  createdAt: string;
}

interface StoredKeyRecord {
  kind: SyncKeyRecordKind;
  kdfDescriptor: KdfDescriptor | null;
  wrappedDek: string;
  updatedAt: string;
}

/**
 * One grant as the service holds it (§5.16).
 *
 * `wrappedDek` is stored but is NEVER served to the grantor: §5.16 defines
 * `ListSharesResponse` without it, and the grantor has no use for a wrap
 * addressed to someone else. Only the grantee's own `/shared` read carries it,
 * and that read is not modelled here — see the handlers below.
 */
interface StoredShare {
  grantorAccountId: number;
  granteeAccountId: number;
  wrappedDek: string;
  recipientKeyFingerprint: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * §5.18's contribution limits, TRANSCRIBED rather than imported.
 *
 * `protocol.ts` in this repo does not declare them, and it should not: they
 * are the SERVICE's limits, and a fake that imported the client's copy of a
 * number would stop being an independent reading of the specification for
 * exactly the field where the two sides have to agree.
 */
const MAX_CONTRIBUTION_BYTES = 256 * 1024;
/** The envelope's floor: `ephPub(65, uncompressed SEC1) ‖ iv(12) ‖ GCM tag(16)`. Only the floor is checkable — the payload is a window of days, not a fixed-size key. */
const RESEARCH_BODY_MIN_BYTES = 65 + 12 + 16;
/** A bound on the pseudonym, never a format check — see the `PUT` handler. */
const MAX_PSEUDONYM_CHARS = 64;
/**
 * The tiers this protocol revision defines, written out here rather than
 * imported from `research/tiers.ts`.
 *
 * Importing the client's constant would make the server-side tier check
 * vacuous: prohibition 1 has teeth on BOTH sides of the wire precisely because
 * the two lists are maintained separately and must match.
 */
const RESEARCH_SCHEMA_TIERS = ['daily-intake:v1'] as const;

/** One contribution as the service holds it. `body` stays base64 — the service has no key for it and never decodes it. */
interface StoredContribution {
  contributorAccountId: number;
  studyAccountId: number;
  pseudonym: string;
  schemaTier: string;
  body: string;
  contributionVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** A tombstone: a pseudonym that withdrew from one study, and when. There is no account id here and there must never be one. */
interface StoredWithdrawal {
  studyAccountId: number;
  pseudonym: string;
  withdrawnAt: string;
}

interface StoredAccount {
  id: number;
  email: string;
  displayName: string | null;
  /** The submitted auth-hash. The real service stores an HMAC of it under a pepper held outside the database. */
  verifier: string;
  /** The recovery code's auth proof. Set at signup and replaced by a rotation; never `null` under protocol 2. */
  recoveryVerifier: string;
  /**
   * The RAW recovery code (M192).
   *
   * Held in the clear here, where the real service seals it under a subkey of
   * `SERVER_SECRET`. That difference is what makes this a fake; what it models
   * faithfully is that the SERVICE HAS IT AT ALL, which is the whole change —
   * a mailed reset can only return somebody's diary because of this field.
   */
  recoveryCodeEscrow: string;
  role: 'admin' | 'member';
  dailyAiLimit: number;
  aiUsedToday: number;
  suspendedAt: string | null;
  createdAt: string;
  kdfDescriptor: KdfDescriptor | undefined;
  blobs: StoredBlob[];
  keyRecords: Map<SyncKeyRecordKind, StoredKeyRecord>;
}

/** One invite as the service holds it. The email on it is what the account is created at. */
interface StoredInvite {
  token: string;
  email: string;
  displayName: string | null;
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
}

/** One outstanding password-reset token. The digest is the token itself here; the real service stores a SHA-256 of it. */
interface StoredReset {
  token: string;
  accountId: number;
  expiresAt: string;
  spentAt: string | null;
}

interface StoredToken {
  accountId: number;
  family: string;
  kind: 'access' | 'refresh';
  revoked: boolean;
}

const ENUMERATION_SECRET = 'fake-service-enumeration-secret';

/**
 * Canonicalises an address the way the real store's unique index does: NFKC,
 * trim, lowercase. Two spellings of one address must collide here too, or the
 * fake would accept a duplicate the real service refuses.
 */
const canonical = (email: string): string => email.normalize('NFKC').trim().toLowerCase();

/** Protocol 2's `AccountView`. One projection, so what an admin sees and what an owner sees cannot drift. */
const summarize = (account: StoredAccount) => ({
  id: account.id,
  email: account.email,
  displayName: account.displayName,
  role: account.role,
  dailyAiLimit: account.dailyAiLimit,
  aiUsedToday: account.aiUsedToday,
  suspendedAt: account.suspendedAt,
  createdAt: account.createdAt,
});

const applyKeyRecords = (account: StoredAccount, submissions: KeyRecordSubmission[]): boolean => {
  for (const record of submissions) {
    if (record.kind === 'recovery' && record.kdfDescriptor !== null) return false;
    if (record.kind === 'passphrase' && record.kdfDescriptor === null) return false;
    account.keyRecords.set(record.kind, {
      kind: record.kind,
      kdfDescriptor: record.kdfDescriptor ?? null,
      wrappedDek: record.wrappedDek,
      updatedAt: new Date().toISOString(),
    });
  }
  return true;
};

/** A counterpart account id from a research URL. Serial ids are positive integers; anything else is malformed, not a miss. */
function parseAccountIdParam(raw: string | undefined): number | null {
  return raw !== undefined && /^[1-9][0-9]{0,9}$/.test(raw) ? Number(raw) : null;
}

/** The ONE 404 of the research family: an unknown study and a study with no relationship to the caller are identical on the wire. */
function sendContributionNotFound(res: Response): void {
  res.status(404).json({ error: 'no such study' });
}

/** The grantor-facing projection of a share: §5.16's `ShareGrantWire`, and nothing else. The wrap is not in scope for a future edit to spread. */
function shareGrantOf(row: StoredShare) {
  return {
    granteeAccountId: row.granteeAccountId,
    recipientKeyFingerprint: row.recipientKeyFingerprint,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The contributor-facing projection of a contribution. Never carries `body` — the contributor still holds the source it was reduced from. */
function contributionEnrolmentOf(row: StoredContribution) {
  return {
    studyAccountId: row.studyAccountId,
    pseudonym: row.pseudonym,
    schemaTier: row.schemaTier,
    contributionVersion: row.contributionVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface FakeSyncService {
  url: string;
  observed: ObservedRequest[];
  /**
   * Mints an invite, the way an admin would.
   *
   * A TEST SEAM rather than an endpoint: `/v1/admin/invites` is spec 02's, and
   * a fake that implemented an admin surface no client calls would be a second
   * reading of a contract nothing here exercises. What every test below needs
   * is a live `si_` token addressed to somebody.
   */
  createInvite(input: { email: string; displayName?: string | null; expiresInDays?: number }): string;
  /** Mints a password-reset token, the way `/reset/request` would when mail is configured. */
  createResetToken(email: string): string | null;
  /**
   * Empties an account's key records — a TIME MACHINE, and the only way to
   * reach a state protocol 2 can no longer create.
   *
   * A pre-M192 client wrote the account and its key records in two requests,
   * so a device that died between them left an account nobody could ever
   * unlock. `signInToSync`'s repair exists for exactly those accounts and must
   * keep working; protocol 2's signup commits both records with the account,
   * so nothing a current client does can produce one to test against.
   */
  stripKeyRecords(email: string): void;
  /** Everything the service holds at rest, as JSON — the other half of the zero-knowledge search. */
  dump(): string;
  close(): Promise<void>;
}

export async function startFakeSyncService(): Promise<FakeSyncService> {
  const accounts = new Map<number, StoredAccount>();
  const invites = new Map<string, StoredInvite>();
  const resets = new Map<string, StoredReset>();
  const tokens = new Map<string, StoredToken>();
  const shares: StoredShare[] = [];
  const contributions: StoredContribution[] = [];
  const withdrawals: StoredWithdrawal[] = [];
  const observed: ObservedRequest[] = [];
  let nextAccountId = 1;

  const app: Express = express();
  app.use(express.json({ limit: Math.ceil((MAX_BLOB_BYTES * 4) / 3) + 4096 }));
  app.use((req, res, next) => {
    const record: ObservedRequest = {
      method: req.method,
      path: req.path,
      headers: { ...req.headers },
      body: req.body,
      response: undefined,
    };
    observed.push(record);
    const answerWithJson = res.json.bind(res);
    res.json = (body) => {
      record.response = body;
      return answerWithJson(body);
    };
    next();
  });

  const findAccountByEmail = (email: string | undefined): StoredAccount | undefined =>
    email === undefined ? undefined : [...accounts.values()].find((account) => account.email === canonical(email));

  /**
   * The invite behind a token, or `undefined` for one that is unknown, spent,
   * revoked or expired.
   *
   * ONE ANSWER for all four, because the endpoints above give all four one
   * status: telling them apart would let a caller probe which tokens exist.
   */
  const liveInvite = (token: string): StoredInvite | undefined => {
    const invite = invites.get(token);
    if (invite === undefined) return undefined;
    if (invite.redeemedAt !== null || invite.revokedAt !== null) return undefined;
    return Date.parse(invite.expiresAt) > Date.now() ? invite : undefined;
  };

  const mintInvite = (input: { email: string; displayName?: string | null; expiresInDays?: number }): string => {
    const token = `si_${randomUUID()}`;
    invites.set(token, {
      token,
      email: canonical(input.email),
      displayName: input.displayName ?? null,
      expiresAt: new Date(Date.now() + (input.expiresInDays ?? 7) * 86_400_000).toISOString(),
      redeemedAt: null,
      revokedAt: null,
    });
    return token;
  };

  /**
   * Mints a reset token, or `null` when the address has no account.
   *
   * The `null` NEVER reaches a caller over HTTP — `/reset/request` answers
   * `202` either way. It is returned to the TEST seam, which is inside the
   * trust boundary and needs to know whether there is a link to follow.
   *
   * A new request revokes older ones: one outstanding token per account, so a
   * link somebody forwarded a week ago stops working the moment they ask
   * again.
   */
  const mintResetToken = (email: string): string | null => {
    const account = findAccountByEmail(email);
    if (account === undefined) return null;
    for (const reset of resets.values()) {
      if (reset.accountId === account.id) reset.spentAt = reset.spentAt ?? new Date().toISOString();
    }
    const token = `sr_${randomUUID()}`;
    resets.set(token, {
      token,
      accountId: account.id,
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      spentAt: null,
    });
    return token;
  };

  const mintTokens = (accountId: number, family: string = randomUUID()) => {
    const accessToken: string = randomUUID();
    const refreshToken: string = randomUUID();
    tokens.set(accessToken, { accountId, family, kind: 'access', revoked: false });
    tokens.set(refreshToken, { accountId, family, kind: 'refresh', revoked: false });
    return {
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      refreshToken,
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
  };

  const revokeAll = (accountId: number): void => {
    for (const token of tokens.values()) {
      if (token.accountId === accountId) token.revoked = true;
    }
  };

  /** Resolves the bearer caller. `401` and `403` are never conflated (`PROTOCOL.md` §4.1). */
  const requireAccount = (req: Request, res: Response): StoredAccount | null => {
    const header = req.headers.authorization;
    const raw = header !== undefined && header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = raw === null ? undefined : tokens.get(raw);
    if (token === undefined || token.revoked || token.kind !== 'access') {
      res.status(401).json({ error: 'authentication required' });
      return null;
    }
    const account = accounts.get(token.accountId);
    if (account === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return null;
    }
    return account;
  };

  // ---------------------------------------------------------------------
  // Handshake
  // ---------------------------------------------------------------------

  app.get('/health', (_req, res) => {
    res.json({
      protocolVersion: PROTOCOL_VERSION,
      envelopeVersion: ENVELOPE_VERSION,
      serviceVersion: 'fake-0.6.0',
      // Protocol 2's instance block. `ai.model` is what the client's derived
      // managed settings read; `mail: false` says an invite or a reset is a
      // link somebody copies by hand, which is what this fake does.
      instance: { name: 'openplate-fake', language: 'en', mail: false, ai: { model: 'fake/vision-1' } },
    });
  });

  // ---------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------

  app.post(`${AUTH_API_PREFIX}/kdf`, (req, res) => {
    const parsed = kdfLookupRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid email' });
      return;
    }
    const email = canonical(parsed.data.email);
    // Derived UNCONDITIONALLY, before the branch: a lazily-computed dummy is a
    // timing oracle even when the response is identical. Over the CANONICAL
    // address, so two spellings of one unknown address cannot be told apart by
    // their descriptors.
    const dummy = {
      salt: createHmac('sha256', ENUMERATION_SECRET).update(email).digest('base64').slice(0, 24),
      params: { memorySizeKib: 65536, iterations: 3, parallelism: 1 },
    };
    const account = findAccountByEmail(email);
    res.json({ kdfDescriptor: account?.kdfDescriptor ?? dummy });
  });

  /**
   * `POST /v1/auth/invite-lookup` — what an unspent invite says about itself.
   *
   * READS AND SPENDS NOTHING, which is what makes it safe for the join screen
   * to call on load: invite links get fetched by mail scanners and link
   * previewers, and a bare GET of that page must burn nothing.
   *
   * ONE 404 for every dead invite — unknown, spent, revoked, expired. Telling
   * them apart would let a caller probe which tokens exist.
   */
  app.post(`${AUTH_API_PREFIX}/invite-lookup`, (req, res) => {
    const parsed = inviteLookupRequestSchema.safeParse(req.body);
    const invite = parsed.success ? liveInvite(parsed.data.inviteToken) : undefined;
    if (invite === undefined) {
      res.status(404).json({ error: 'invite-invalid' });
      return;
    }
    res.json({ email: invite.email, displayName: invite.displayName, expiresAt: invite.expiresAt });
  });

  /**
   * `POST /v1/auth/signup` — redeem an invite into an account.
   *
   * THE EMAIL COMES FROM THE INVITE, never from the body, and that is what
   * makes the invite the address verification: a body that carried its own
   * address would let somebody create an account at one nobody invited.
   *
   * The account, BOTH key records, the escrow and the invite redemption commit
   * together. That closes the "an account with no key records" hole the older
   * two-step shape left open, which `signInToSync` still repairs for accounts
   * created before it.
   */
  app.post(`${AUTH_API_PREFIX}/signup`, (req, res) => {
    const parsed = signupRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid signup' });
      return;
    }
    const { inviteToken, authHash, kdfDescriptor, displayName, recoveryAuthHash, recoveryCode } = parsed.data;
    const invite = liveInvite(inviteToken);
    if (invite === undefined) {
      res.status(403).json({ error: 'invite-invalid' });
      return;
    }
    const submissions = keyRecordSubmissionsSchema.safeParse(parsed.data.keyRecords);
    if (!submissions.success) {
      res.status(400).json({ error: 'invalid key records' });
      return;
    }
    // BOTH kinds are required. The client hides the recovery code, so an
    // account created with only a passphrase record is one nobody can reset.
    const kinds = new Set(submissions.data.map((record) => record.kind));
    if (!kinds.has('passphrase') || !kinds.has('recovery')) {
      res.status(400).json({ error: 'both key records are required' });
      return;
    }
    if (findAccountByEmail(invite.email) !== undefined) {
      // The ONE accepted enumeration oracle here, and it is narrow: only
      // somebody holding a live invite can reach it, and the address it
      // discloses is the one written on the invite they are holding.
      res.status(409).json({ error: 'an account already exists for this address' });
      return;
    }
    const account: StoredAccount = {
      id: nextAccountId,
      email: canonical(invite.email),
      displayName: displayName ?? invite.displayName,
      verifier: authHash,
      recoveryVerifier: recoveryAuthHash,
      recoveryCodeEscrow: recoveryCode,
      role: 'member',
      dailyAiLimit: 0,
      aiUsedToday: 0,
      suspendedAt: null,
      createdAt: new Date().toISOString(),
      kdfDescriptor,
      blobs: [],
      keyRecords: new Map(),
    };
    if (!applyKeyRecords(account, submissions.data)) {
      res.status(400).json({ error: 'invalid key records' });
      return;
    }
    nextAccountId += 1;
    accounts.set(account.id, account);
    invite.redeemedAt = new Date().toISOString();
    res.status(201).json({ account: summarize(account), tokens: mintTokens(account.id) });
  });

  app.post(`${AUTH_API_PREFIX}/login`, (req, res) => {
    const parsed = loginRequestSchema.safeParse(req.body);
    const account = parsed.success ? findAccountByEmail(parsed.data.email) : undefined;
    // One message for both failures — never "no such account" vs "wrong password".
    if (!parsed.success || account === undefined || account.verifier !== parsed.data.authHash) {
      res.status(401).json({ error: 'invalid email or password' });
      return;
    }
    // A SUSPENDED ACCOUNT IS ITS OWN STATUS, and it is deliberately NOT folded
    // into the 401 above: the credential is right, and telling somebody their
    // password is wrong would send them round a loop only an admin can end.
    if (account.suspendedAt !== null) {
      res.status(403).json({ error: 'account-suspended' });
      return;
    }
    res.json({ account: summarize(account), tokens: mintTokens(account.id) });
  });

  app.post(`${AUTH_API_PREFIX}/refresh`, (req, res) => {
    const parsed = refreshRequestSchema.safeParse(req.body);
    const token = parsed.success ? tokens.get(parsed.data.refreshToken) : undefined;
    if (token === undefined || token.kind !== 'refresh') {
      res.status(401).json({ error: 'invalid refresh token' });
      return;
    }
    if (token.revoked) {
      // Reuse detection: the legitimate client already rotated this one, so
      // whoever holds it now holds a copy. Burn the whole family.
      for (const candidate of tokens.values()) {
        if (candidate.family === token.family) candidate.revoked = true;
      }
      res.status(401).json({ error: 'refresh token reuse detected' });
      return;
    }
    const account = accounts.get(token.accountId);
    if (account !== undefined && account.suspendedAt !== null) {
      res.status(403).json({ error: 'account-suspended' });
      return;
    }
    token.revoked = true;
    res.json({ tokens: mintTokens(token.accountId, token.family) });
  });

  app.post(`${AUTH_API_PREFIX}/logout`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    res.status(204).end();
  });

  app.get(`${AUTH_API_PREFIX}/account`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    res.json({ account: summarize(account) });
  });

  /** `PATCH /v1/auth/account` — the one field an account owner may edit about themselves. */
  app.patch(`${AUTH_API_PREFIX}/account`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    const parsed = patchAccountRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid account patch' });
      return;
    }
    account.displayName = parsed.data.displayName;
    res.json({ account: summarize(account) });
  });

  /**
   * `POST /v1/auth/reset/request` — always `202`, whether or not the address
   * has an account.
   *
   * THE STATUS IS THE POINT. A 404 for an unknown address would turn this into
   * a membership oracle: anybody could ask whether a colleague has an account
   * on the organization's instance. This fake mints the token and holds it;
   * the real service mails it.
   */
  app.post(`${AUTH_API_PREFIX}/reset/request`, (req, res) => {
    const parsed = resetRequestSchema.safeParse(req.body);
    if (parsed.success) mintResetToken(parsed.data.email);
    res.status(202).json({});
  });

  /**
   * `POST /v1/auth/reset/open` — spend the mailed token for the account's
   * address and its ESCROWED recovery code.
   *
   * The token is consumed here, so the code it returns is the only copy the
   * client will ever get: the rotation has to run in the same call frame.
   */
  app.post(`${AUTH_API_PREFIX}/reset/open`, (req, res) => {
    const parsed = resetOpenRequestSchema.safeParse(req.body);
    const reset = parsed.success ? resets.get(parsed.data.resetToken) : undefined;
    const account = reset === undefined ? undefined : accounts.get(reset.accountId);
    if (
      reset === undefined ||
      account === undefined ||
      reset.spentAt !== null ||
      Date.parse(reset.expiresAt) <= Date.now()
    ) {
      // ONE message for unknown, spent and expired. Telling them apart would
      // say whether a forwarded link had already been used.
      res.status(404).json({ error: 'reset-invalid' });
      return;
    }
    reset.spentAt = new Date().toISOString();
    res.json({ email: account.email, recoveryCode: account.recoveryCodeEscrow });
  });

  /**
   * The ONE failure both recovery endpoints report — an unknown address and a
   * wrong code collapse into it. Telling them apart would hand a caller an
   * oracle.
   */
  const RECOVERY_REJECTED = 'invalid email or recovery code';

  const authenticateRecoveryCode = (email: string, recoveryAuthHash: string): StoredAccount | undefined => {
    const account = findAccountByEmail(email);
    if (account === undefined) return undefined;
    return account.recoveryVerifier === recoveryAuthHash ? account : undefined;
  };

  app.post(`${AUTH_API_PREFIX}/recover`, (req, res) => {
    const parsed = recoverRequestSchema.safeParse(req.body);
    const account =
      parsed.success ? authenticateRecoveryCode(parsed.data.email, parsed.data.recoveryAuthHash) : undefined;
    if (account === undefined) {
      res.status(401).json({ error: RECOVERY_REJECTED });
      return;
    }
    // An ORDINARY session, not a lesser one: the holder of the recovery code
    // is the account owner by construction.
    res.json({ account: summarize(account), tokens: mintTokens(account.id) });
  });

  app.post(`${AUTH_API_PREFIX}/recover-rotate`, (req, res) => {
    const parsed = recoverRotateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid rotation' });
      return;
    }
    if (parsed.data.keyRecords === undefined) {
      res.status(400).json({ error: 'keyRecords must be present, even as []' });
      return;
    }
    const submissions = keyRecordSubmissionsSchema.safeParse(parsed.data.keyRecords);
    if (!submissions.success) {
      res.status(400).json({ error: 'invalid key records' });
      return;
    }
    // A `passphrase` record is REQUIRED here, unlike change-passphrase where
    // an empty array is a legitimate "I am changing nothing": the
    // passphrase-KEK necessarily changed, so a rotation without a re-wrapped
    // DEK would mint an account that logs in and decrypts nothing.
    const kinds = new Set(submissions.data.map((record) => record.kind));
    if (!kinds.has('passphrase')) {
      res.status(400).json({ error: 'a passphrase key record is required' });
      return;
    }
    // Rotating the code is all-or-nothing and travels in THREE parts under
    // protocol 2: a new verifier, a re-wrapped `recovery` record, and the raw
    // replacement that re-escrows. A verifier without the escrow would leave
    // the service holding a code that opens nothing, and the NEXT reset would
    // appear to work and return an unreadable diary.
    const rotatesCode = parsed.data.newRecoveryAuthHash !== undefined;
    if (rotatesCode !== kinds.has('recovery') || rotatesCode !== (parsed.data.recoveryCode !== undefined)) {
      res.status(400).json({ error: 'rotating the recovery code requires all three halves' });
      return;
    }

    // The proof is checked in the SAME call that writes — the whole reason
    // this endpoint exists rather than a session minted by `/recover`.
    const account = authenticateRecoveryCode(parsed.data.email, parsed.data.recoveryAuthHash);
    if (account === undefined) {
      res.status(401).json({ error: RECOVERY_REJECTED });
      return;
    }
    if (!applyKeyRecords(account, submissions.data)) {
      res.status(400).json({ error: 'invalid key records' });
      return;
    }
    account.verifier = parsed.data.newAuthHash;
    account.kdfDescriptor = parsed.data.kdfDescriptor;
    if (parsed.data.newRecoveryAuthHash !== undefined && parsed.data.recoveryCode !== undefined) {
      account.recoveryVerifier = parsed.data.newRecoveryAuthHash;
      account.recoveryCodeEscrow = parsed.data.recoveryCode;
    }
    revokeAll(account.id);
    res.json({ account: summarize(account), tokens: mintTokens(account.id) });
  });

  app.post(`${AUTH_API_PREFIX}/change-passphrase`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    const parsed = changePassphraseRequestSchema.safeParse(req.body);
    if (!parsed.success || account.verifier !== parsed.data.currentAuthHash) {
      res.status(401).json({ error: 'invalid passphrase' });
      return;
    }
    const submissions = keyRecordSubmissionsSchema.safeParse(parsed.data.keyRecords);
    if (!submissions.success || !applyKeyRecords(account, submissions.data)) {
      res.status(400).json({ error: 'invalid key records' });
      return;
    }
    account.verifier = parsed.data.newAuthHash;
    account.kdfDescriptor = parsed.data.kdfDescriptor;
    revokeAll(account.id);
    res.json({ tokens: mintTokens(account.id) });
  });

  app.post(`${AUTH_API_PREFIX}/delete`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    const parsed = deleteAccountRequestSchema.safeParse(req.body);
    // Re-authentication, even though a valid token was presented.
    if (!parsed.success || account.verifier !== parsed.data.authHash) {
      res.status(401).json({ error: 'invalid passphrase' });
      return;
    }
    accounts.delete(account.id);
    revokeAll(account.id);
    res.status(204).end();
  });

  // ---------------------------------------------------------------------
  // Sync — blobs and key records
  // ---------------------------------------------------------------------

  app.get(`${SYNC_API_PREFIX}/blob`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    const latest = account.blobs[account.blobs.length - 1];
    if (latest === undefined) {
      res.status(404).json({ error: 'no blob for this account' });
      return;
    }
    res.json(latest);
  });

  app.post(`${SYNC_API_PREFIX}/blob`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    const parsed = pushBlobRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const baseVersionRejected = parsed.error.issues.some((issue) => issue.path[0] === 'baseVersion');
      res.status(400).json({
        error:
          baseVersionRejected ? 'baseVersion must be a non-negative integer' : 'ciphertext must be non-empty base64',
      });
      return;
    }
    const { baseVersion, envelopeVersion, ciphertext } = parsed.data;
    if (Buffer.from(ciphertext, 'base64').byteLength > MAX_BLOB_BYTES) {
      res.status(413).json({ error: 'blob exceeds the size limit' });
      return;
    }
    const current = account.blobs[account.blobs.length - 1]?.blobVersion ?? 0;
    if (baseVersion !== current) {
      res.status(409).json({ currentVersion: current });
      return;
    }
    const newVersion = current + 1;
    account.blobs.push({
      blobVersion: newVersion,
      envelopeVersion,
      ciphertext,
      createdAt: new Date().toISOString(),
    });
    res.json({ newVersion });
  });

  app.get(`${SYNC_API_PREFIX}/key-records`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    res.json({ records: [...account.keyRecords.values()] });
  });

  app.put(`${SYNC_API_PREFIX}/key-records/:kind`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    const kind = req.params.kind;
    if (!isSyncKeyRecordKind(kind)) {
      res.status(400).json({ error: 'unknown key record kind' });
      return;
    }
    // An ABSENT `expectedUpdatedAt` is a 400 — a caller must not be able to
    // skip the concurrency check by forgetting a field.
    const body = jsonObjectSchema.safeParse(req.body);
    if (!body.success || !Object.hasOwn(body.data, 'expectedUpdatedAt')) {
      res.status(400).json({ error: 'expectedUpdatedAt must be present' });
      return;
    }
    const parsed = putKeyRecordRequestSchema.safeParse(body.data);
    if (!parsed.success) {
      res.status(400).json({ error: 'wrappedDek must not be empty' });
      return;
    }
    const { kdfDescriptor, wrappedDek, expectedUpdatedAt } = parsed.data;
    if (kind === 'recovery' && kdfDescriptor !== null) {
      res.status(400).json({ error: 'recovery key records must not carry a kdfDescriptor' });
      return;
    }
    if (kind === 'passphrase' && kdfDescriptor === null) {
      res.status(400).json({ error: 'passphrase key records require a kdfDescriptor' });
      return;
    }
    const existing = account.keyRecords.get(kind);
    if ((existing?.updatedAt ?? null) !== expectedUpdatedAt) {
      res.status(409).json({ currentUpdatedAt: existing?.updatedAt ?? null });
      return;
    }
    const record: StoredKeyRecord = {
      kind,
      kdfDescriptor: kdfDescriptor ?? null,
      wrappedDek,
      updatedAt: new Date().toISOString(),
    };
    account.keyRecords.set(kind, record);
    res.json(record);
  });

  app.delete(`${SYNC_API_PREFIX}/key-records/:kind`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    const kind = req.params.kind;
    if (isSyncKeyRecordKind(kind)) account.keyRecords.delete(kind);
    res.status(204).end();
  });

  // ---------------------------------------------------------------------
  // Shares — grantor side (§5.16, `openplate-sync` ADR-0002)
  //
  // This fake models a deployment with `SYNC_SHARING` SET. Production's dark
  // mode is the ordinary unknown-route 404 mounted ahead of authentication —
  // the service's own behaviour, asserted in the service's repo — and against
  // that configuration a client can never reach the `granted` branch at all,
  // so a ceremony's own sync is unobservable. Lighting the family here is what
  // makes it observable, exactly as the research lane is lit above.
  //
  // The GRANTEE side (`GET /shared`, `GET /shared/:id/blob`) is deliberately
  // ABSENT. Nothing under `tests/` drives a clinician-side read yet, and a
  // handler written ahead of its caller is a second reading of the
  // specification that nothing checks — which is the one thing a contract
  // test must not carry.
  // ---------------------------------------------------------------------

  app.get(`${SYNC_API_PREFIX}/shares`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    res.status(200).json({
      shares: shares.filter((row) => row.grantorAccountId === account.id).map((row) => shareGrantOf(row)),
    });
  });

  /**
   * §5.17's atomic rotation, plus M192's addendum.
   *
   * ALL OR NOTHING, and the order below is what makes that true here: every
   * refusal happens before the first write, so a `400` or a `409` leaves the
   * account exactly as it was. The keep list is silence-is-revocation,
   * inverting §5.14, because those rows are somebody else's capability.
   */
  app.post(`${SYNC_API_PREFIX}/rotate-dek`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    const parsed = rotateDekRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // THE ADDENDUM'S REFUSAL. A rotation without the new verifier and the
      // new escrow would leave this account with a recovery code that
      // authenticates and a different one that decrypts.
      res.status(400).json({ error: 'a rotation must carry newRecoveryAuthHash and recoveryCode' });
      return;
    }
    const submissions = keyRecordSubmissionsSchema.safeParse(parsed.data.keyRecords);
    const keepList = z.array(rotateDekShareSchema).safeParse(parsed.data.shares);
    if (!submissions.success || !keepList.success) {
      res.status(400).json({ error: 'invalid rotation' });
      return;
    }
    const kinds = new Set(submissions.data.map((record) => record.kind));
    if (!kinds.has('passphrase') || !kinds.has('recovery')) {
      res.status(400).json({ error: 'both key records are required' });
      return;
    }
    const current = account.blobs[account.blobs.length - 1]?.blobVersion ?? 0;
    if (parsed.data.blob.baseVersion !== current) {
      res.status(409).json({ currentVersion: current });
      return;
    }
    if (!applyKeyRecords(account, submissions.data)) {
      res.status(400).json({ error: 'invalid key records' });
      return;
    }
    account.blobs.push({
      blobVersion: current + 1,
      envelopeVersion: parsed.data.blob.envelopeVersion,
      ciphertext: parsed.data.blob.ciphertext,
      createdAt: new Date().toISOString(),
    });
    account.recoveryVerifier = parsed.data.newRecoveryAuthHash;
    account.recoveryCodeEscrow = parsed.data.recoveryCode;

    const kept = new Map(keepList.data.map((entry) => [entry.granteeAccountId, entry]));
    const before = shares.filter((row) => row.grantorAccountId === account.id).length;
    for (let index = shares.length - 1; index >= 0; index -= 1) {
      const row = shares[index];
      if (row === undefined || row.grantorAccountId !== account.id) continue;
      const keep = kept.get(row.granteeAccountId);
      if (keep === undefined) {
        shares.splice(index, 1);
        continue;
      }
      row.wrappedDek = keep.wrappedDek;
      row.recipientKeyFingerprint = keep.recipientKeyFingerprint;
      row.updatedAt = new Date().toISOString();
    }
    res.status(200).json({
      newVersion: current + 1,
      keptShares: kept.size,
      revokedShares: before - kept.size,
    });
  });

  app.put(`${SYNC_API_PREFIX}/shares/:granteeAccountId`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    const granteeAccountId = parseAccountIdParam(req.params.granteeAccountId);
    // An ABSENT `expectedUpdatedAt` is a 400, exactly as it is for a key
    // record: no caller may skip the concurrency check by forgetting a field.
    const carrier = jsonObjectSchema.safeParse(req.body);
    const parsed = putShareRequestSchema.safeParse(req.body);
    const carriesCasToken = carrier.success && Object.hasOwn(carrier.data, 'expectedUpdatedAt');
    if (granteeAccountId === null || !carriesCasToken || !parsed.success) {
      res.status(400).json({ error: 'invalid request body' });
      return;
    }
    // ONE 404 for "no such account" and for "sharing is off on this
    // deployment". The client is not able to tell them apart and must not be:
    // a distinguishable answer here is an account-enumeration oracle.
    if (!accounts.has(granteeAccountId)) {
      res.status(404).json({ error: 'no such account' });
      return;
    }
    const existing = shares.find(
      (row) => row.grantorAccountId === account.id && row.granteeAccountId === granteeAccountId,
    );
    if ((existing?.updatedAt ?? null) !== parsed.data.expectedUpdatedAt) {
      res.status(409).json({ currentUpdatedAt: existing?.updatedAt ?? null });
      return;
    }
    const now = new Date().toISOString();
    const row: StoredShare = {
      grantorAccountId: account.id,
      granteeAccountId,
      wrappedDek: parsed.data.wrappedDek,
      recipientKeyFingerprint: parsed.data.recipientKeyFingerprint,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing === undefined) shares.push(row);
    else shares.splice(shares.indexOf(existing), 1, row);
    res.status(200).json(shareGrantOf(row));
  });

  // ---------------------------------------------------------------------
  // Research contributions (§5.18, ADR-0003)
  //
  // The STRUCTURAL INVERSION of every other family here: the study side is
  // read-only and carries no contributor account id, ever. `studyAccountId`
  // on a study-side response is the CALLER'S OWN id, echoed once at the top
  // level of the envelope, because §3.5's AAD needs it and it is the value
  // the caller authenticated as. A per-row account id is the one shape this
  // lane exists to prevent, so `studyRows` below projects the five §5.18
  // fields and nothing else — there is no contributor id in scope for a
  // future edit to spread.
  // ---------------------------------------------------------------------

  /** The §5.18 contributor `PUT`. `body` is held exactly as submitted — base64 of a ciphertext this service cannot open. */
  const contributionSubmissionSchema = z.object({
    // Bounded, never format-checked: the service never holds the root, so it
    // cannot verify a pseudonym and must not imply that it can.
    pseudonym: z
      .string()
      .transform((value) => value.trim())
      .refine((value) => value.length > 0 && value.length <= MAX_PSEUDONYM_CHARS),
    schemaTier: z.enum(RESEARCH_SCHEMA_TIERS),
    body: z.string(),
    // THE NEW VERSION, not a base — it rides in the AAD. Absent is a 400.
    contributionVersion: z.number().int().positive(),
  });

  const findContribution = (contributorAccountId: number, studyAccountId: number): StoredContribution | undefined =>
    contributions.find(
      (row) => row.contributorAccountId === contributorAccountId && row.studyAccountId === studyAccountId,
    );

  app.put(`${SYNC_API_PREFIX}/contributions/:studyAccountId`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;

    const studyAccountId = parseAccountIdParam(req.params.studyAccountId);
    const parsed = contributionSubmissionSchema.safeParse(req.body);
    if (studyAccountId === null || !parsed.success) {
      res.status(400).json({ error: 'invalid request body' });
      return;
    }
    const sealed = Buffer.from(parsed.data.body, 'base64');
    // The envelope's floor — `ephPub(65) ‖ iv(12) ‖ tag(16)`. Not a parse: the
    // service still holds no key. A structurally impossible body accepted here
    // would fail much later, on a researcher's machine, as an unexplained tag
    // failure.
    if (sealed.byteLength < RESEARCH_BODY_MIN_BYTES || studyAccountId === account.id) {
      res.status(400).json({ error: 'invalid request body' });
      return;
    }
    if (sealed.byteLength > MAX_CONTRIBUTION_BYTES) {
      res.status(413).json({ error: 'contribution too large' });
      return;
    }
    if (!accounts.has(studyAccountId)) {
      sendContributionNotFound(res);
      return;
    }
    const { pseudonym, schemaTier, contributionVersion } = parsed.data;
    // ONE PSEUDONYM PER STUDY. The real service enforces this with a unique
    // index and maps only foreign-key violations, so a collision surfaces as
    // an unhandled 500 rather than a designed status — which is faithful, and
    // is the point: at 2^-128 it should never fire, and it makes two
    // contributors silently merging into one participant series impossible
    // rather than improbable.
    const collision = contributions.find(
      (row) =>
        row.studyAccountId === studyAccountId && row.pseudonym === pseudonym && row.contributorAccountId !== account.id,
    );
    if (collision !== undefined) {
      res.status(500).json({ error: 'pseudonym already present for this study' });
      return;
    }

    const existing = findContribution(account.id, studyAccountId);
    // THE CAS: strictly greater, never exact-successor. A client that
    // recomputes and re-pushes the whole projection must not be wedged by a
    // version that never left the device.
    if (existing !== undefined && contributionVersion <= existing.contributionVersion) {
      res.status(409).json({ currentVersion: existing.contributionVersion });
      return;
    }
    const now = new Date().toISOString();
    const row: StoredContribution = {
      contributorAccountId: account.id,
      studyAccountId,
      pseudonym,
      schemaTier,
      body: parsed.data.body,
      contributionVersion,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing === undefined) contributions.push(row);
    else contributions.splice(contributions.indexOf(existing), 1, row);
    res.status(200).json(contributionEnrolmentOf(row));
  });

  app.get(`${SYNC_API_PREFIX}/contributions`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    res.status(200).json({
      contributions: contributions
        .filter((row) => row.contributorAccountId === account.id)
        .map((row) => contributionEnrolmentOf(row)),
    });
  });

  app.delete(`${SYNC_API_PREFIX}/contributions/:studyAccountId`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    const studyAccountId = parseAccountIdParam(req.params.studyAccountId);
    if (studyAccountId === null) {
      res.status(400).json({ error: 'invalid request body' });
      return;
    }
    // WITHDRAWAL — one transaction on the real service: hard-delete the row
    // and insert the pseudonym-keyed tombstone. Idempotent, and a withdrawal
    // with nothing enrolled writes no tombstone: there would be no pseudonym
    // to key one on.
    const existing = findContribution(account.id, studyAccountId);
    if (existing !== undefined) {
      contributions.splice(contributions.indexOf(existing), 1);
      const tombstone = withdrawals.find(
        (row) => row.studyAccountId === studyAccountId && row.pseudonym === existing.pseudonym,
      );
      const withdrawnAt = new Date().toISOString();
      if (tombstone === undefined) withdrawals.push({ studyAccountId, pseudonym: existing.pseudonym, withdrawnAt });
      else tombstone.withdrawnAt = withdrawnAt;
    }
    res.status(204).end();
  });

  app.get(`${SYNC_API_PREFIX}/study/contributions`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    res.status(200).json({
      studyAccountId: account.id,
      contributions: contributions
        .filter((row) => row.studyAccountId === account.id)
        .map((row) => ({
          pseudonym: row.pseudonym,
          contributionVersion: row.contributionVersion,
          schemaTier: row.schemaTier,
          body: row.body,
          createdAt: row.createdAt,
        })),
    });
  });

  app.get(`${SYNC_API_PREFIX}/study/withdrawals`, (req, res) => {
    const account = requireAccount(req, res);
    if (account === null) return;
    res.status(200).json({
      withdrawals: withdrawals
        .filter((row) => row.studyAccountId === account.id)
        .map((row) => ({ pseudonym: row.pseudonym, withdrawnAt: row.withdrawnAt })),
    });
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // SAFETY: `listen(0, '127.0.0.1')` binds a TCP socket, and `Server#address()`
  // returns `AddressInfo` for every TCP bind — the `string` form is reachable
  // only from a pipe/UDS bind, which this server never performs.
  const address = server.address() as AddressInfo | null;
  if (address === null) throw new Error('fake sync service failed to bind a port');

  return {
    url: `http://127.0.0.1:${address.port}`,
    observed,
    createInvite: mintInvite,
    createResetToken: mintResetToken,
    stripKeyRecords: (email: string) => {
      const account = findAccountByEmail(email);
      if (account === undefined) throw new Error(`no account at ${email} to strip`);
      account.keyRecords.clear();
    },
    dump: () =>
      JSON.stringify({
        accounts: [...accounts.values()].map((account) => ({
          id: account.id,
          email: account.email,
          displayName: account.displayName,
          verifier: account.verifier,
          recoveryVerifier: account.recoveryVerifier,
          // DUMPED, and it has to be: the zero-knowledge search runs over this
          // document, and M192's whole change is that the service now holds a
          // value that opens a diary. A dump that hid it would make the search
          // pass by omission.
          recoveryCodeEscrow: account.recoveryCodeEscrow,
          kdfDescriptor: account.kdfDescriptor,
          blobs: account.blobs,
          keyRecords: [...account.keyRecords.values()],
        })),
        // Every OTHER surface the service stores is dumped too, or the
        // zero-knowledge search would have a blind spot exactly where a
        // ciphertext sits: a share's wrap (§5.16) and a contribution's body
        // (§5.18) are both held here and neither is inside `accounts`.
        // Invites carry an address and a live capability, and resets carry the
        // token that fetches an escrowed recovery code. Both belong in the
        // search for the same reason `accounts` does.
        invites: [...invites.values()],
        resets: [...resets.values()],
        shares,
        contributions,
        withdrawals,
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
