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
 * addresses, reset semantics (`keyRecords: []` leaves kinds untouched), rotating
 * refresh tokens with family revocation on reuse, and the `/health` handshake.
 *
 * Not faithful, deliberately: no throttling (`PERMISSIVE_THROTTLE` exists in
 * the real service for exactly this reason — every request here comes from
 * 127.0.0.1), no email delivery (the reset and verification tokens are exposed
 * on the harness object instead), no pepper (verifiers are stored as the
 * submitted auth-hash, which is what makes it a fake rather than a second
 * implementation), and no retention pruning.
 *
 * `requireEmailVerification` models the real service's config flag of the same
 * name, because the client's behaviour under it is not a variation — it is a
 * different flow (signup answers `tokens: null`, login answers `403` until the
 * address is confirmed, and the key records therefore cannot be written until
 * afterwards). That flow deadlocked in production while every test here passed,
 * for the simple reason that nothing here could express it.
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

const kdfLookupRequestSchema = z.object({ email: z.string().includes('@') });

const signupRequestSchema = z.object({
  email: z.string().includes('@'),
  authHash: z.string(),
  kdfDescriptor: kdfDescriptorSchema.optional(),
  displayName: z.string().nullish(),
});

const verifyEmailRequestSchema = z.object({ token: z.string() });
const loginRequestSchema = z.object({ email: z.string(), authHash: z.string() });
const refreshRequestSchema = z.object({ refreshToken: z.string() });
const requestResetRequestSchema = z.object({ email: z.string() });

const resetRequestSchema = z.object({
  token: z.string(),
  authHash: z.string(),
  kdfDescriptor: kdfDescriptorSchema.optional(),
  // Parsed separately so "absent" and "malformed" stay distinguishable (§5.14).
  keyRecords: z.unknown(),
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

/** Everything the service ever sees. The zero-knowledge test searches all of it. */
export interface ObservedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
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

interface StoredAccount {
  id: number;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  /** The submitted auth-hash. The real service stores an HMAC of it under a pepper held outside the database. */
  verifier: string;
  kdfDescriptor: KdfDescriptor | undefined;
  blobs: StoredBlob[];
  keyRecords: Map<SyncKeyRecordKind, StoredKeyRecord>;
}

interface StoredToken {
  accountId: number;
  family: string;
  kind: 'access' | 'refresh';
  revoked: boolean;
}

const ENUMERATION_SECRET = 'fake-service-enumeration-secret';

const summarize = (account: StoredAccount) => ({
  id: account.id,
  email: account.email,
  displayName: account.displayName,
  emailVerified: account.emailVerified,
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

export interface FakeSyncService {
  url: string;
  observed: ObservedRequest[];
  /** Everything the service holds at rest, as JSON — the other half of the zero-knowledge search. */
  dump(): string;
  /** The most recent reset token, standing in for the email the real service would send. */
  lastResetToken(): string | null;
  /** The most recent email-verification token, likewise standing in for the inbox. */
  lastVerificationToken(): string | null;
  close(): Promise<void>;
}

export interface FakeSyncServiceOptions {
  /** Mirrors the service's `REQUIRE_EMAIL_VERIFICATION`: signup withholds the session and login refuses until confirmed. */
  requireEmailVerification?: boolean;
}

export async function startFakeSyncService(options: FakeSyncServiceOptions = {}): Promise<FakeSyncService> {
  const requireEmailVerification = options.requireEmailVerification ?? false;
  const accounts = new Map<number, StoredAccount>();
  const tokens = new Map<string, StoredToken>();
  const verificationTokens = new Map<string, number>();
  const observed: ObservedRequest[] = [];
  let nextAccountId = 1;
  let lastResetToken: string | null = null;
  let lastVerificationToken: string | null = null;

  const app: Express = express();
  app.use(express.json({ limit: Math.ceil((MAX_BLOB_BYTES * 4) / 3) + 4096 }));
  app.use((req, _res, next) => {
    observed.push({ method: req.method, path: req.path, headers: { ...req.headers }, body: req.body });
    next();
  });

  const findAccountByEmail = (email: string | undefined): StoredAccount | undefined =>
    email === undefined ?
      undefined
    : [...accounts.values()].find((account) => account.email.toLowerCase() === email.toLowerCase());

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
    res.json({ protocolVersion: PROTOCOL_VERSION, envelopeVersion: ENVELOPE_VERSION, serviceVersion: 'fake-0.0.0' });
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
    const email = parsed.data.email;
    // Derived UNCONDITIONALLY, before the branch: a lazily-computed dummy is a
    // timing oracle even when the response is identical.
    const dummy = {
      salt: createHmac('sha256', ENUMERATION_SECRET).update(email.toLowerCase()).digest('base64').slice(0, 24),
      params: { memorySizeKib: 65536, iterations: 3, parallelism: 1 },
    };
    const account = findAccountByEmail(email);
    res.json({ kdfDescriptor: account?.kdfDescriptor ?? dummy });
  });

  app.post(`${AUTH_API_PREFIX}/signup`, (req, res) => {
    const parsed = signupRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid signup' });
      return;
    }
    const { email, authHash, kdfDescriptor, displayName } = parsed.data;
    if (findAccountByEmail(email) !== undefined) {
      res.status(409).json({ error: 'an account already exists for this email' });
      return;
    }
    const account: StoredAccount = {
      id: nextAccountId,
      email,
      displayName: displayName ?? null,
      emailVerified: !requireEmailVerification,
      verifier: authHash,
      kdfDescriptor,
      blobs: [],
      keyRecords: new Map(),
    };
    nextAccountId += 1;
    accounts.set(account.id, account);

    if (requireEmailVerification) {
      // §5.8: the account exists, and there is NO session until the address is
      // confirmed — otherwise the requirement is bypassed by never leaving the
      // tab. The key records consequently cannot be written yet either.
      const verificationToken: string = randomUUID();
      lastVerificationToken = verificationToken;
      verificationTokens.set(verificationToken, account.id);
      res.status(201).json({ account: summarize(account), tokens: null });
      return;
    }
    res.status(201).json({ account: summarize(account), tokens: mintTokens(account.id) });
  });

  app.post(`${AUTH_API_PREFIX}/verify-email`, (req, res) => {
    const parsed = verifyEmailRequestSchema.safeParse(req.body);
    const accountId = parsed.success ? verificationTokens.get(parsed.data.token) : undefined;
    const account = accountId === undefined ? undefined : accounts.get(accountId);
    if (!parsed.success || account === undefined) {
      res.status(400).json({ error: 'invalid or expired verification token' });
      return;
    }
    // SINGLE USE. Replaying a spent link is indistinguishable from a forged
    // one here, which is correct on the wire and is exactly why the client
    // keeps its own "already redeemed" marker.
    verificationTokens.delete(parsed.data.token);
    account.emailVerified = true;
    res.status(204).end();
  });

  app.post(`${AUTH_API_PREFIX}/login`, (req, res) => {
    const parsed = loginRequestSchema.safeParse(req.body);
    const account = parsed.success ? findAccountByEmail(parsed.data.email) : undefined;
    // One message for both failures — never "no such account" vs "wrong passphrase".
    if (!parsed.success || account === undefined || account.verifier !== parsed.data.authHash) {
      res.status(401).json({ error: 'invalid email or passphrase' });
      return;
    }
    // 403, NOT 401: the credentials were right. Conflating the two is what
    // makes a client tell someone to retype a passphrase that already worked.
    if (requireEmailVerification && !account.emailVerified) {
      res.status(403).json({ error: 'email address is not verified' });
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

  app.post(`${AUTH_API_PREFIX}/request-reset`, (req, res) => {
    const parsed = requestResetRequestSchema.safeParse(req.body);
    const account = parsed.success ? findAccountByEmail(parsed.data.email) : undefined;
    // Always 202 — the only channel that reveals anything is the inbox.
    if (account !== undefined) {
      const resetToken: string = randomUUID();
      lastResetToken = resetToken;
      tokens.set(resetToken, { accountId: account.id, family: 'reset', kind: 'access', revoked: false });
    }
    res.status(202).json({});
  });

  app.post(`${AUTH_API_PREFIX}/reset`, (req, res) => {
    const parsed = resetRequestSchema.safeParse(req.body);
    const stored = parsed.success ? tokens.get(parsed.data.token) : undefined;
    if (!parsed.success || stored === undefined || stored.revoked || stored.family !== 'reset') {
      res.status(400).json({ error: 'invalid or expired reset token' });
      return;
    }
    if (parsed.data.keyRecords === undefined) {
      res.status(400).json({ error: 'keyRecords must be present, even as []' });
      return;
    }
    const account = accounts.get(stored.accountId);
    if (account === undefined) {
      res.status(400).json({ error: 'invalid reset token' });
      return;
    }
    const submissions = keyRecordSubmissionsSchema.safeParse(parsed.data.keyRecords);
    if (!submissions.success || !applyKeyRecords(account, submissions.data)) {
      res.status(400).json({ error: 'invalid key records' });
      return;
    }
    stored.revoked = true;
    account.verifier = parsed.data.authHash;
    account.kdfDescriptor = parsed.data.kdfDescriptor;
    revokeAll(account.id);
    res.json({ tokens: mintTokens(account.id) });
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
    dump: () =>
      JSON.stringify(
        [...accounts.values()].map((account) => ({
          id: account.id,
          email: account.email,
          displayName: account.displayName,
          emailVerified: account.emailVerified,
          verifier: account.verifier,
          kdfDescriptor: account.kdfDescriptor,
          blobs: account.blobs,
          keyRecords: [...account.keyRecords.values()],
        })),
      ),
    lastResetToken: () => lastResetToken,
    lastVerificationToken: () => lastVerificationToken,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
