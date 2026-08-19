/**
 * The `/v1/auth/*` wire shapes, transcribed from `openplate-sync/PROTOCOL.md`
 * §5.7–§5.15.
 *
 * WHY THESE AREN'T IN `protocol.ts`: that file is the hand-maintained
 * duplicate of `openplate-sync/src/protocol.ts`, and changing the contract it
 * describes means editing FOUR places (both copies plus both transcribed-
 * literal drift-guard tests). The account endpoints arrived with the
 * standalone service in M128 spec 02 and were never mirrored into the client
 * copy; adding them here — CLIENT-SIDE ONLY, alongside the code that calls
 * them — keeps this spec from making a unilateral edit to a two-repo contract
 * file. Folding `AUTH_API_PREFIX` and these shapes into both `protocol.ts`
 * copies is a real and probably correct follow-up; it is a contract change,
 * not a side effect of wiring a client.
 *
 * These are transport shapes, not domain types. Nothing here is secret: the
 * only sensitive value that ever appears in one of these bodies is `authHash`,
 * which is the `AUTH` HKDF branch (`derive-credentials.ts`) — a sibling of the
 * KEK, never the KEK itself and never the passphrase.
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

/** The account as the service describes it. No credential material of any kind. */
export interface AccountSummaryWire {
  id: number;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
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

/** `tokens: null` means this instance requires email verification and the address is unconfirmed. */
export interface SessionResponseWire {
  account: AccountSummaryWire;
  tokens: SessionTokensWire | null;
}

export interface SignupRequestWire {
  email: string;
  authHash: Base64Bytes;
  kdfDescriptor: KdfDescriptorWire;
  displayName: string | null;
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

/** `POST /v1/auth/reset` — proof is the emailed token. Restores LOGIN; restores data only if `keyRecords` carries a re-wrapped DEK. */
export interface ResetRequestWire {
  token: string;
  authHash: Base64Bytes;
  kdfDescriptor: KdfDescriptorWire;
  keyRecords: KeyRecordSubmissionWire[];
}

/** Both rotation endpoints return a fresh pair for the caller. */
export interface RotationResponseWire {
  tokens: SessionTokensWire;
}

export interface AccountResponseWire {
  account: AccountSummaryWire;
}

/** `POST /v1/auth/delete` — re-authentication required even though the caller already holds a token. */
export interface DeleteAccountRequestWire {
  authHash: Base64Bytes;
}
