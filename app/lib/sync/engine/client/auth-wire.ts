/**
 * The `/v1/auth/*` wire shapes, transcribed from `openplate-sync/PROTOCOL.md`
 * and, for protocol 2, from M192's contract table.
 *
 * WHY THESE AREN'T IN `protocol.ts`: that file is the hand-maintained
 * duplicate of `openplate-sync/src/protocol.ts`, and changing the contract it
 * describes means editing FOUR places (both copies plus both transcribed-
 * literal drift-guard tests). The account endpoints arrived with the
 * standalone service in M128 spec 02 and were never mirrored into the client
 * copy; keeping them here — CLIENT-SIDE ONLY, alongside the code that calls
 * them — keeps a client wiring change from making a unilateral edit to a
 * two-repo contract file.
 *
 * ── PROTOCOL 2: THE ADDRESS IS THE IDENTITY ──────────────────────────────
 *
 * `handle` is gone from every request and every response here. An account is
 * an EMAIL, created by redeeming an invite addressed to that email, and the
 * invite is the verification. The `@`-rejection rule that used to guard this
 * surface is inverted: a value with no `@` is now the malformed one.
 *
 * These are transport shapes, not domain types. Two sensitive values appear in
 * them and both are deliberate:
 *  - `authHash`, the `AUTH` HKDF branch (`derive-credentials.ts`) — a sibling
 *    of the KEK, never the KEK itself and never the passphrase;
 *  - `recoveryCode`, the RAW recovery code, sent exactly once at signup so the
 *    service can escrow it (M192's recovery decision). That is a real change
 *    to what the operator holds, it is stated in the privacy copy, and it is
 *    what makes a mailed password reset return the DIARY rather than just a
 *    login to an unreadable one.
 */
import type { Base64Bytes, IsoTimestamp, KdfDescriptor, SyncKeyRecordKind } from '../protocol';

/** Mount prefix for the account endpoints; the blob endpoints live beside it under `SYNC_API_PREFIX`. */
export const AUTH_API_PREFIX = '/v1/auth';

/** Argon2id salt + cost parameters — non-secret by design; served pre-login so a new device can derive. */
export interface KdfDescriptorWire {
  /** base64, 16 bytes. */
  salt: string;
  params: {
    memorySizeKib: number;
    iterations: number;
    parallelism: number;
  };
}

/** `POST /v1/auth/kdf` — the pre-login lookup. An UNKNOWN email gets a stable, real-shaped dummy, never a 404. */
export interface KdfDescriptorResponse {
  kdfDescriptor: KdfDescriptorWire;
}

/** What an account may be, to an instance that belongs to one organization. */
export type AccountRole = 'admin' | 'member';

/**
 * The account as the service describes it (protocol 2's `AccountView`).
 *
 * No credential material of any kind. Everything else about an account IS
 * here, because the admin page and the person's own settings render the same
 * object — one shape, so "what the admin sees" and "what I see about myself"
 * cannot drift into two readings of one account.
 */
export interface AccountViewWire {
  id: number;
  /** The account's canonical email: NFKC, trimmed, lowercased by the service. */
  email: string;
  displayName: string | null;
  role: AccountRole;
  /** Requests per UTC day this account may put through the instance's AI proxy. `0` means no AI. */
  dailyAiLimit: number;
  /** Requests spent so far on the current UTC day. */
  aiUsedToday: number;
  /** When an admin suspended this account, or `null`. A suspended account cannot log in, refresh, sync or scan. */
  suspendedAt: IsoTimestamp | null;
  createdAt: IsoTimestamp;
}

/**
 * A freshly minted token pair. Both are opaque random strings the service
 * stores only as SHA-256 digests (`PROTOCOL.md` §4.2).
 */
export interface SessionTokensWire {
  accessToken: string;
  accessTokenExpiresAt: IsoTimestamp;
  refreshToken: string;
  refreshTokenExpiresAt: IsoTimestamp;
}

/**
 * A signed-in account and its tokens.
 *
 * `tokens` IS NEVER NULL. It was nullable while an instance could withhold a
 * session until an address was confirmed; the invite IS that confirmation
 * under protocol 2, so signup, login and both recovery endpoints hand out a
 * session or fail.
 */
export interface SessionResponseWire {
  account: AccountViewWire;
  tokens: SessionTokensWire;
}

/** `POST /v1/auth/invite-lookup` — what an unspent invite says about itself, before anything is derived. */
export interface InviteLookupResponseWire {
  /** The address this invite was written to. The signup uses it; the body never carries an email of its own. */
  email: string;
  displayName: string | null;
  expiresAt: IsoTimestamp;
}

/**
 * `POST /v1/auth/signup` — redeem an invite into an account, in ONE
 * transaction with both key records and the recovery escrow.
 *
 * NOTHING HERE IS OPTIONAL, and that is the point. The client hides the
 * recovery code, so an account created without `recoveryAuthHash`,
 * `recoveryCode` and both key records is an account nobody can ever reset —
 * a silent, permanent loss discovered the day somebody forgets a password.
 * The service refuses a partial body rather than accept one.
 */
export interface SignupRequestWire {
  /** The `si_` invite. The email comes from the invite server-side, never from this body. */
  inviteToken: string;
  authHash: Base64Bytes;
  kdfDescriptor: KdfDescriptorWire;
  displayName?: string | null;
  /** The recovery code's auth proof, derived under `RECOVERY_AUTH` — never the recovery KEK's label. */
  recoveryAuthHash: Base64Bytes;
  /**
   * The RAW recovery code, escrowed by the service under a subkey of its own
   * `SERVER_SECRET`.
   *
   * This is the one value in this file that the zero-knowledge story used to
   * forbid, and M192 changed the story rather than hiding the change: a mailed
   * reset can only return somebody's DIARY if the server can hand back the
   * code that unwraps it. The operator of a managed instance already sees
   * every plate photo that passes through its AI proxy.
   */
  recoveryCode: string;
  /** Both records, `passphrase` and `recovery`, written in the same transaction as the account. */
  keyRecords: KeyRecordSubmissionWire[];
}

export interface LoginRequestWire {
  email: string;
  authHash: Base64Bytes;
}

export interface RefreshRequestWire {
  refreshToken: string;
}

export interface RefreshResponseWire {
  tokens: SessionTokensWire;
}

/**
 * A key record as submitted alongside a credential rotation (§5.14). Note the
 * missing `expectedUpdatedAt`: the whole rotation applies atomically
 * server-side, so these are not individually CAS-gated the way §5.4's
 * standalone `PUT` is.
 */
export interface KeyRecordSubmissionWire {
  kind: SyncKeyRecordKind;
  kdfDescriptor: KdfDescriptor | null;
  wrappedDek: Base64Bytes;
}

/** `POST /v1/auth/change-passphrase` — proof is the CURRENT passphrase's auth branch. */
export interface ChangePassphraseRequestWire {
  currentAuthHash: Base64Bytes;
  newAuthHash: Base64Bytes;
  kdfDescriptor: KdfDescriptorWire;
  /** MUST be present, even as `[]`. An absent key is a `400` — silence is never read as consent on a path that can strand data. */
  keyRecords: KeyRecordSubmissionWire[];
}

/**
 * `POST /v1/auth/recover` — log in with the recovery code instead of the
 * passphrase.
 *
 * NO UI TAKES A CODE FROM A PERSON any more. The only caller left is the
 * mailed-reset path, which fetches the escrowed code from `/reset/open` and
 * runs this ceremony with it. The endpoint is unchanged; what changed is who
 * holds the code.
 */
export interface RecoverRequestWire {
  email: string;
  recoveryAuthHash: Base64Bytes;
}

/**
 * `POST /v1/auth/recover-rotate` — prove the recovery code and set a new
 * passphrase, in ONE request applied as one transaction.
 *
 * A `passphrase` key record is REQUIRED: the passphrase-KEK necessarily
 * changed, so accepting the rotation without a re-wrapped DEK would mint an
 * account that logs in perfectly and decrypts nothing.
 *
 * Rotating the CODE is all-or-nothing and now travels in THREE parts:
 * `newRecoveryAuthHash`, a `recovery` key record, and `recoveryCode` — the raw
 * replacement, which re-escrows in the same transaction. A rotation that moved
 * the verifier and left the old escrow behind would leave the service holding
 * a code that opens nothing, and the next reset would appear to work and
 * return an unreadable diary.
 */
export interface RecoverRotateRequestWire {
  email: string;
  recoveryAuthHash: Base64Bytes;
  newAuthHash: Base64Bytes;
  kdfDescriptor: KdfDescriptorWire;
  keyRecords: KeyRecordSubmissionWire[];
  newRecoveryAuthHash?: Base64Bytes;
  /** REQUIRED whenever `newRecoveryAuthHash` is present; the service refuses one without the other. */
  recoveryCode?: string;
}

/** Both rotation endpoints return a fresh pair for the caller. */
export interface RotationResponseWire {
  tokens: SessionTokensWire;
}

export interface AccountResponseWire {
  account: AccountViewWire;
}

/** `PATCH /v1/auth/account` — the one thing an account owner may edit about themselves. */
export interface PatchAccountRequestWire {
  displayName: string | null;
}

/** `POST /v1/auth/reset/request` — always answered `202`, whether or not the address has an account. */
export interface ResetRequestWire {
  email: string;
}

/** `POST /v1/auth/reset/open` — spends the mailed token for the escrowed code. */
export interface ResetOpenRequestWire {
  resetToken: string;
}

/** The `200` of `/reset/open`: who this is, and the code that opens their data. */
export interface ResetOpenResponseWire {
  email: string;
  recoveryCode: string;
}

/** `POST /v1/auth/delete` — re-authentication required even though the caller already holds a token. */
export interface DeleteAccountRequestWire {
  authHash: Base64Bytes;
}
