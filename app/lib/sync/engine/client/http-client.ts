/**
 * Fetch-based client for the sync BLOB and KEY-RECORD endpoints
 * (`PROTOCOL.md` §5.1–§5.5), typed entirely against `../protocol` — the shared
 * wire contract, not a private copy of it. If the protocol changes, this file
 * fails to compile, which is the point.
 *
 * AUTH IS A BEARER TOKEN, NOT A COOKIE (M128 spec 04, `PROTOCOL.md` §4.1).
 * The `credentials: 'include'` this file used to send belonged to the era when
 * these routes were mounted inside the openplate app's own Express server;
 * they now live in a separate service on a different origin, which sends
 * `Access-Control-Allow-Origin: *` and never
 * `Access-Control-Allow-Credentials`. That combination is safe precisely
 * BECAUSE there is no ambient credential: a hostile page can issue the request
 * and gets a `401`, because the browser has nothing to attach automatically.
 * Sending cookies here would trade that property away for nothing.
 *
 * TOKEN HANDLING IS DELEGATED, not duplicated: a {@link SyncTokenProvider}
 * (in practice `SyncAuthClient`) owns the tokens and the rotation, and this
 * client only knows "attach the current one; on 401 ask for one more; on a
 * second 401 give up" — §11's rule, implemented once.
 */
import {
  SYNC_API_PREFIX,
  type KdfDescriptor,
  type ListSharedResponse,
  type ListSharesResponse,
  type PutShareConflictResponse,
  type PutShareRequest,
  type ReceivedShareWire,
  type RotateDekAcceptedResponse,
  type RotateDekConflictResponse,
  type RotateDekRequest,
  type ShareGrantWire,
  type SharedBlobResponse,
  type ContributionEnrolmentWire,
  type ListContributionsResponse,
  type ListStudyContributionsResponse,
  type ListStudyWithdrawalsResponse,
  type PutContributionConflictResponse,
  type PutContributionRequest,
  type StudyContributionWire,
  type StudyWithdrawalWire,
  type KeyRecordWire,
  type ListKeyRecordsResponse,
  type PullBlobResponse,
  type PushBlobAcceptedResponse,
  type PushBlobConflictResponse,
  type PushBlobRequest,
  type PutKeyRecordConflictResponse,
  type PutKeyRecordRequest,
  type SyncKeyRecordKind,
} from '../protocol';
import { base64ToBytes, bytesToBase64 } from '../crypto/base64';
import { toRequestError } from './auth-client';
import type { SyncTokenProvider } from './auth-client';
import { SyncRequestError } from './sync-error';
import { defaultFetchImpl } from './fetch-impl';

type FetchImpl = typeof fetch;

export interface SyncHttpClientOptions {
  baseUrl: string;
  /** Supplies (and refreshes) the bearer token. Every endpoint here is authenticated, always. */
  tokens: SyncTokenProvider;
  fetchImpl?: FetchImpl;
}

/** The two protocol-meaningful outcomes of a push; anything else throws. */
export type PushBlobHttpResult =
  { status: 'accepted'; newVersion: number } | { status: 'conflict'; currentVersion: number };

/** A pulled blob, with `ciphertext` already decoded from its base64 wire form. */
export interface PulledBlob {
  blobVersion: number;
  envelopeVersion: number;
  ciphertext: Uint8Array;
  createdAt: string;
}

/** A key record with `wrappedDek` decoded. `updatedAt` is the CAS token for the next write. */
export interface StoredKeyRecord {
  kind: SyncKeyRecordKind;
  kdfDescriptor: KdfDescriptor | null;
  wrappedDek: Uint8Array;
  updatedAt: string;
}

/** The two protocol-meaningful outcomes of a key-record PUT. */
export type PutKeyRecordHttpResult =
  { status: 'accepted'; record: StoredKeyRecord } | { status: 'conflict'; currentUpdatedAt: string | null };

/**
 * A read of a surface that only exists on a deployment which enabled it.
 *
 * `unavailable` is the honest name for "every path in that tree answers the
 * ordinary unknown-route 404" (ADR-0002 prohibition 10, and ADR-0003
 * prohibition 9 word for word). It is NOT an error: the caller must render
 * nothing rather than a broken screen, and must not retry.
 *
 * ONE type for both optional families, deliberately. Sharing and research are
 * independent flags on independent subtrees, but the client's obligation is
 * identical, and a second type would be a second place for "unavailable is not
 * an error" to be forgotten.
 */
export type SurfaceRead<TValue> = { status: 'available'; value: TValue } | { status: 'unavailable' };

/** The share family's name for {@link SurfaceRead}, kept because `sharing.ts` and its tests read in ADR-0002's vocabulary. */
export type ShareSurfaceRead<TValue> = SurfaceRead<TValue>;

/** One of the caller's own grants. Never carries a wrap — it is addressed to somebody else's key. */
export interface ShareGrant {
  granteeAccountId: number;
  recipientKeyFingerprint: string;
  createdAt: string;
  /** The CAS token for the next write to this row. */
  updatedAt: string;
}

/** A share addressed to the caller, with the wrap only their private key opens. */
export interface ReceivedShare {
  grantorAccountId: number;
  wrappedDek: Uint8Array;
  recipientKeyFingerprint: string;
  createdAt: string;
  updatedAt: string;
}

/** A grantor's current blob, as a grantee reads it. `grantorAccountId` is required to rebuild the envelope AAD. */
export interface SharedBlob {
  grantorAccountId: number;
  blobVersion: number;
  envelopeVersion: number;
  ciphertext: Uint8Array;
  createdAt: string;
}

/** The three protocol-meaningful outcomes of a share PUT. `not-found` covers both "no such account" and "sharing is off here" — the service answers one 404 for both, deliberately. */
export type PutShareHttpResult =
  | { status: 'accepted'; grant: ShareGrant }
  | { status: 'conflict'; currentUpdatedAt: string | null }
  | { status: 'not-found' };

/** The two protocol-meaningful outcomes of a rotation. Everything else throws; nothing partial is ever written. */
export type RotateDekHttpResult =
  | { status: 'accepted'; newVersion: number; keptShares: number; revokedShares: number }
  | { status: 'conflict'; currentVersion: number };

// ---------------------------------------------------------------------------
// Research contributions (§5.18, `openplate-sync` ADR-0003)
// ---------------------------------------------------------------------------

/** One of the caller's OWN enrolments. Never carries a sealed body — see {@link ContributionEnrolmentWire}. */
export interface ContributionEnrolment {
  studyAccountId: number;
  pseudonym: string;
  schemaTier: string;
  contributionVersion: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The four protocol-meaningful outcomes of a contribution `PUT`.
 *
 * `not-found` covers "no such study account" AND "this deployment has no
 * research lane" — the service answers one 404 for both, deliberately, and
 * this client must not invent a distinction it cannot make.
 *
 * `too-large` is its own outcome rather than a thrown error because "your
 * window is too wide" is ADVICE: the contributor can narrow the window and
 * retry, and a study can be told its window does not fit. Collapsing it into a
 * generic failure throws that away.
 */
export type PutContributionHttpResult =
  | { status: 'accepted'; enrolment: ContributionEnrolment }
  | { status: 'conflict'; currentVersion: number }
  | { status: 'too-large' }
  | { status: 'not-found' };

/** One cohort row as it arrives, with `body` decoded from base64 and NOTHING opened yet. There is no account id here and there must never be one. */
export interface StudyContribution {
  pseudonym: string;
  contributionVersion: number;
  schemaTier: string;
  /** `ephPub(65) ‖ iv(12) ‖ AES-256-GCM(...)`. Opaque until `research/study.ts` opens it with a key this device holds. */
  body: Uint8Array;
  createdAt: string;
}

/**
 * The study-side envelope: the caller's OWN account id once, and the rows.
 *
 * The id is at the envelope's top level because it belongs there — it is the
 * same value for every row, it is the value the caller authenticated as, and
 * the researcher needs it to rebuild §3.5's AAD. Per row it would look like a
 * participant identifier, which is precisely what it must never be mistaken
 * for.
 */
export interface StudyContributionPage {
  studyAccountId: number;
  contributions: StudyContribution[];
}

/** A tombstone: a pseudonym that withdrew, and when. The purge instruction of ADR-0003 prohibition 8. */
export interface StudyWithdrawal {
  pseudonym: string;
  withdrawnAt: string;
}

export class SyncHttpClient {
  private readonly baseUrl: string;
  private readonly tokens: SyncTokenProvider;
  private readonly fetchImpl: FetchImpl;

  constructor({ baseUrl, tokens, fetchImpl = defaultFetchImpl }: SyncHttpClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.tokens = tokens;
    this.fetchImpl = fetchImpl;
  }

  // -------------------------------------------------------------------------
  // Blobs
  // -------------------------------------------------------------------------

  /**
   * CAS push (§5.1). A `409` is a NORMAL, EXPECTED outcome — another device
   * wrote first — and is returned, not thrown. The caller must run the
   * pull-merge-repush loop; treating a 409 as fatal strands the device out of
   * sync permanently.
   */
  async pushBlob(input: {
    baseVersion: number;
    envelopeVersion: number;
    ciphertext: Uint8Array;
  }): Promise<PushBlobHttpResult> {
    const body: PushBlobRequest = {
      baseVersion: input.baseVersion,
      envelopeVersion: input.envelopeVersion,
      ciphertext: bytesToBase64(input.ciphertext),
    };
    const response = await this.send({ path: `${SYNC_API_PREFIX}/blob`, method: 'POST', body });
    if (response.status === 409) {
      // SAFETY: `PROTOCOL.md` §5.1 defines the 409 body of this endpoint as
      // `PushBlobConflictResponse`, and the service is version-checked by the
      // handshake before any blob traffic flows.
      const conflict = (await response.json()) as PushBlobConflictResponse;
      return { status: 'conflict', currentVersion: conflict.currentVersion };
    }
    if (!response.ok) throw await toRequestError(response);
    // SAFETY: §5.1 defines the 200 body of this endpoint as
    // `PushBlobAcceptedResponse`; every non-2xx has already been thrown above.
    const accepted = (await response.json()) as PushBlobAcceptedResponse;
    return { status: 'accepted', newVersion: accepted.newVersion };
  }

  /**
   * Reads the account's current blob (§5.2). `null` means this account has
   * never pushed one — a fresh account, NOT an error, and a client that treats
   * the 404 as a failure never completes a first sync.
   */
  async pullBlob(): Promise<PulledBlob | null> {
    const response = await this.send({ path: `${SYNC_API_PREFIX}/blob`, method: 'GET' });
    if (response.status === 404) return null;
    if (!response.ok) throw await toRequestError(response);
    // SAFETY: §5.2 defines the 200 body of this endpoint as `PullBlobResponse`;
    // the 404 and every other non-2xx are handled above.
    const body = (await response.json()) as PullBlobResponse;
    return {
      blobVersion: body.blobVersion,
      envelopeVersion: body.envelopeVersion,
      ciphertext: base64ToBytes(body.ciphertext),
      createdAt: body.createdAt,
    };
  }

  // -------------------------------------------------------------------------
  // Key records
  // -------------------------------------------------------------------------

  /** Lists the account's wrapped-DEK records (§5.3). An empty array means setup has never completed. */
  async listKeyRecords(): Promise<StoredKeyRecord[]> {
    const response = await this.send({ path: `${SYNC_API_PREFIX}/key-records`, method: 'GET' });
    if (!response.ok) throw await toRequestError(response);
    // SAFETY: §5.3 defines the 200 body of this endpoint as
    // `ListKeyRecordsResponse`; every non-2xx has already been thrown above.
    const body = (await response.json()) as ListKeyRecordsResponse;
    return body.records.map(decodeKeyRecord);
  }

  /**
   * Creates or rotates one key record (§5.4), CAS-gated on `expectedUpdatedAt`
   * — `null` asserting "no record of this kind exists yet".
   *
   * The key is always sent, never omitted: an absent `expectedUpdatedAt` is a
   * `400` by design, so that no caller can skip the concurrency check by
   * forgetting a field. Passing it explicitly here means the compiler enforces
   * what the protocol would otherwise only catch at runtime.
   */
  async putKeyRecord(input: {
    kind: SyncKeyRecordKind;
    kdfDescriptor: KdfDescriptor | null;
    wrappedDek: Uint8Array;
    expectedUpdatedAt: string | null;
  }): Promise<PutKeyRecordHttpResult> {
    const body: PutKeyRecordRequest = {
      kdfDescriptor: input.kdfDescriptor,
      wrappedDek: bytesToBase64(input.wrappedDek),
      expectedUpdatedAt: input.expectedUpdatedAt,
    };
    const response = await this.send({
      path: `${SYNC_API_PREFIX}/key-records/${input.kind}`,
      method: 'PUT',
      body,
    });
    if (response.status === 409) {
      // SAFETY: §5.4 defines the 409 body of this endpoint as
      // `PutKeyRecordConflictResponse`.
      const conflict = (await response.json()) as PutKeyRecordConflictResponse;
      return { status: 'conflict', currentUpdatedAt: conflict.currentUpdatedAt };
    }
    if (!response.ok) throw await toRequestError(response);
    // SAFETY: §5.4 defines the 200 body of this endpoint as the stored
    // `KeyRecordWire`; every non-2xx has already been thrown above.
    return { status: 'accepted', record: decodeKeyRecord((await response.json()) as KeyRecordWire) };
  }

  /**
   * Deletes a key record (§5.5). Idempotent.
   *
   * Deleting the LAST remaining record makes every stored blob permanently
   * undecryptable. The service does not stop you; no caller here should reach
   * this without an unmistakable warning in front of it.
   */
  async deleteKeyRecord(kind: SyncKeyRecordKind): Promise<void> {
    const response = await this.send({ path: `${SYNC_API_PREFIX}/key-records/${kind}`, method: 'DELETE' });
    if (!response.ok) throw await toRequestError(response);
  }

  // -------------------------------------------------------------------------
  // Shares — grantor side (§5.16)
  // -------------------------------------------------------------------------

  /**
   * The caller's own grants (§5.16). A `404` means this deployment has no
   * sharing at all, which is reported as {@link ShareSurfaceRead} rather than
   * thrown — the surface has to disappear, not break.
   */
  async listShares(): Promise<ShareSurfaceRead<ShareGrant[]>> {
    const response = await this.send({ path: `${SYNC_API_PREFIX}/shares`, method: 'GET' });
    if (response.status === 404) return { status: 'unavailable' };
    if (!response.ok) throw await toRequestError(response);
    // SAFETY: §5.16 defines the 200 body of this endpoint as
    // `ListSharesResponse`; the 404 and every other non-2xx are handled above.
    const body = (await response.json()) as ListSharesResponse;
    return { status: 'available', value: body.shares.map(decodeShareGrant) };
  }

  /**
   * Creates or re-wraps one share (§5.16), CAS-gated on `expectedUpdatedAt`
   * exactly as a key record is — a rotation re-wrap can race a re-grant.
   *
   * The key is always sent, never omitted: an absent `expectedUpdatedAt` is a
   * `400` by design, so no caller can skip the concurrency check by forgetting
   * a field.
   */
  async putShare(input: {
    granteeAccountId: number;
    wrappedDek: Uint8Array;
    recipientKeyFingerprint: string;
    expectedUpdatedAt: string | null;
  }): Promise<PutShareHttpResult> {
    const body: PutShareRequest = {
      wrappedDek: bytesToBase64(input.wrappedDek),
      recipientKeyFingerprint: input.recipientKeyFingerprint,
      expectedUpdatedAt: input.expectedUpdatedAt,
    };
    const response = await this.send({
      path: `${SYNC_API_PREFIX}/shares/${input.granteeAccountId}`,
      method: 'PUT',
      body,
    });
    if (response.status === 404) return { status: 'not-found' };
    if (response.status === 409) {
      // SAFETY: §5.16 defines the 409 body of this endpoint as
      // `PutShareConflictResponse`.
      const conflict = (await response.json()) as PutShareConflictResponse;
      return { status: 'conflict', currentUpdatedAt: conflict.currentUpdatedAt };
    }
    if (!response.ok) throw await toRequestError(response);
    // SAFETY: §5.16 defines the 200 body of this endpoint as the stored grant,
    // without its wrap; every non-2xx has already been handled above.
    return { status: 'accepted', grant: decodeShareGrant((await response.json()) as ShareGrantWire) };
  }

  /**
   * Tier 1 revocation (§5.16): a HARD DELETE, effective on the very next
   * request because the row is read every time and never cached. Idempotent.
   *
   * A `404` is accepted silently for one reason only: it means this deployment
   * has no share table, so there is no row to remove and nothing to report.
   */
  async deleteShare(granteeAccountId: number): Promise<void> {
    const response = await this.send({ path: `${SYNC_API_PREFIX}/shares/${granteeAccountId}`, method: 'DELETE' });
    if (response.status === 404) return;
    if (!response.ok) throw await toRequestError(response);
  }

  // -------------------------------------------------------------------------
  // Shares — grantee side (§5.16). READ ONLY, always.
  // -------------------------------------------------------------------------

  /** The shares addressed to this caller, each with the wrap only their key opens (§5.16). */
  async listSharedWithMe(): Promise<ShareSurfaceRead<ReceivedShare[]>> {
    const response = await this.send({ path: `${SYNC_API_PREFIX}/shared`, method: 'GET' });
    if (response.status === 404) return { status: 'unavailable' };
    if (!response.ok) throw await toRequestError(response);
    // SAFETY: §5.16 defines the 200 body of this endpoint as
    // `ListSharedResponse`; the 404 and every other non-2xx are handled above.
    const body = (await response.json()) as ListSharedResponse;
    return { status: 'available', value: body.shares.map(decodeReceivedShare) };
  }

  /**
   * A grantor's CURRENT blob (§5.16). `null` for every absence — the share was
   * revoked, the grantor never pushed, the account does not exist, or this
   * deployment has no sharing. The service answers ONE 404 for all of them on
   * purpose, and this client must not invent a distinction it cannot make.
   */
  async pullSharedBlob(grantorAccountId: number): Promise<SharedBlob | null> {
    const response = await this.send({
      path: `${SYNC_API_PREFIX}/shared/${grantorAccountId}/blob`,
      method: 'GET',
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await toRequestError(response);
    // SAFETY: §5.16 defines the 200 body of this endpoint as
    // `SharedBlobResponse`; the 404 and every other non-2xx are handled above.
    const body = (await response.json()) as SharedBlobResponse;
    return {
      grantorAccountId: body.grantorAccountId,
      blobVersion: body.blobVersion,
      envelopeVersion: body.envelopeVersion,
      ciphertext: base64ToBytes(body.ciphertext),
      createdAt: body.createdAt,
    };
  }

  /** Drops a share aimed at this caller (§5.16). Without it, anyone knowing an account id could park junk in a clinician's list forever. */
  async deleteSharedWithMe(grantorAccountId: number): Promise<void> {
    const response = await this.send({ path: `${SYNC_API_PREFIX}/shared/${grantorAccountId}`, method: 'DELETE' });
    if (response.status === 404) return;
    if (!response.ok) throw await toRequestError(response);
  }

  // -------------------------------------------------------------------------
  // Atomic DEK rotation (§5.17)
  // -------------------------------------------------------------------------

  /**
   * Tier 2 revocation (§5.17): one submission carrying the re-encrypted blob,
   * BOTH re-wrapped key records, and a re-wrap for every share to keep. The
   * service applies it all or none.
   *
   * `shares` is the KEEP list and every row it does not name is deleted in the
   * same transaction — silence is revocation here, inverting §5.14, because
   * these rows are somebody else's capability on the caller's diary.
   *
   * Present on every deployment: an owner who never shared anything still
   * needs a way to retire a DEK they believe leaked.
   */
  async rotateDek(request: RotateDekRequest): Promise<RotateDekHttpResult> {
    const response = await this.send({ path: `${SYNC_API_PREFIX}/rotate-dek`, method: 'POST', body: request });
    if (response.status === 409) {
      // SAFETY: §5.17 defines the 409 body of this endpoint as
      // `RotateDekConflictResponse`. Nothing was written.
      const conflict = (await response.json()) as RotateDekConflictResponse;
      return { status: 'conflict', currentVersion: conflict.currentVersion };
    }
    if (!response.ok) throw await toRequestError(response);
    // SAFETY: §5.17 defines the 200 body of this endpoint as
    // `RotateDekAcceptedResponse`; every non-2xx has already been handled.
    const accepted = (await response.json()) as RotateDekAcceptedResponse;
    return {
      status: 'accepted',
      newVersion: accepted.newVersion,
      keptShares: accepted.keptShares,
      revokedShares: accepted.revokedShares,
    };
  }

  // -------------------------------------------------------------------------
  // Research — contributor side (§5.18). ADR-0003.
  // -------------------------------------------------------------------------

  /**
   * Pushes the cumulative contribution for a window (§5.18), CAS-gated on a
   * monotonic `contributionVersion` that is ALSO an AAD field — so the value
   * sent here must be the value the body was sealed under.
   *
   * A `409` is normal: another of the contributor's own devices recomputed and
   * pushed first. The caller re-seals at the returned version and retries; it
   * always still holds the source.
   */
  async putContribution(input: {
    studyAccountId: number;
    pseudonym: string;
    schemaTier: string;
    body: Uint8Array;
    contributionVersion: number;
  }): Promise<PutContributionHttpResult> {
    const body: PutContributionRequest = {
      pseudonym: input.pseudonym,
      schemaTier: input.schemaTier,
      body: bytesToBase64(input.body),
      contributionVersion: input.contributionVersion,
    };
    const response = await this.send({
      path: `${SYNC_API_PREFIX}/contributions/${input.studyAccountId}`,
      method: 'PUT',
      body,
    });
    if (response.status === 404) return { status: 'not-found' };
    if (response.status === 413) return { status: 'too-large' };
    if (response.status === 409) {
      // SAFETY: §5.18 defines the 409 body of this endpoint as
      // `PutContributionConflictResponse`, and its `currentVersion` is the
      // integer to re-seal above.
      const conflict = (await response.json()) as PutContributionConflictResponse;
      return { status: 'conflict', currentVersion: conflict.currentVersion };
    }
    if (!response.ok) throw await toRequestError(response);
    // SAFETY: §5.18 defines the 200 body of this endpoint as the stored
    // enrolment without its body; every non-2xx has already been handled.
    return {
      status: 'accepted',
      enrolment: decodeContributionEnrolment((await response.json()) as ContributionEnrolmentWire),
    };
  }

  /** The caller's own enrolments (§5.18). Never carries a sealed body. A `404` means this deployment has no research lane. */
  async listMyContributions(): Promise<SurfaceRead<ContributionEnrolment[]>> {
    const response = await this.send({ path: `${SYNC_API_PREFIX}/contributions`, method: 'GET' });
    if (response.status === 404) return { status: 'unavailable' };
    if (!response.ok) throw await toRequestError(response);
    // SAFETY: §5.18 defines the 200 body of this endpoint as
    // `ListContributionsResponse`; the 404 and every other non-2xx are handled above.
    const body = (await response.json()) as ListContributionsResponse;
    return { status: 'available', value: body.contributions.map(decodeContributionEnrolment) };
  }

  /**
   * WITHDRAWAL (§5.18): one transaction on the service — hard-delete the row,
   * insert the pseudonym-keyed tombstone. Idempotent.
   *
   * On this side it is genuine erasure: a contribution the study has not yet
   * pulled reaches nobody. What a study has already pulled cannot be
   * repossessed — the tombstone carries the instruction, `research/study.ts`
   * honours it on every pull, and no wording anywhere may claim more than
   * that.
   *
   * A `404` is accepted silently for one reason only: it means this deployment
   * has no research lane, so there is no row to remove and nothing to report.
   */
  async withdrawContribution(studyAccountId: number): Promise<void> {
    const response = await this.send({
      path: `${SYNC_API_PREFIX}/contributions/${studyAccountId}`,
      method: 'DELETE',
    });
    if (response.status === 404) return;
    if (!response.ok) throw await toRequestError(response);
  }

  // -------------------------------------------------------------------------
  // Research — study side (§5.18). READ ONLY, and carrying no contributor
  // account id, ever.
  // -------------------------------------------------------------------------

  /**
   * The cohort (§5.18): every contribution pointed at the calling study, still
   * sealed.
   *
   * THIS IS NOT THE FUNCTION A RESEARCHER'S SCREEN CALLS. It returns rows
   * before withdrawal tombstones are applied, which is why nothing above
   * `research/study.ts`'s `pullStudyCohort` may call it — the purge is part of
   * the pull, not a step a caller can forget (ADR-0003 prohibition 8).
   */
  async listStudyContributions(): Promise<SurfaceRead<StudyContributionPage>> {
    const response = await this.send({ path: `${SYNC_API_PREFIX}/study/contributions`, method: 'GET' });
    if (response.status === 404) return { status: 'unavailable' };
    if (!response.ok) throw await toRequestError(response);
    // SAFETY: §5.18 defines the 200 body of this endpoint as
    // `ListStudyContributionsResponse`; the 404 and every other non-2xx are handled above.
    const body = (await response.json()) as ListStudyContributionsResponse;
    return {
      status: 'available',
      value: {
        studyAccountId: body.studyAccountId,
        contributions: body.contributions.map(decodeStudyContribution),
      },
    };
  }

  /** The pseudonyms that withdrew (§5.18), with timestamps. Read on every pull, and applied before anything is decrypted. */
  async listStudyWithdrawals(): Promise<SurfaceRead<StudyWithdrawal[]>> {
    const response = await this.send({ path: `${SYNC_API_PREFIX}/study/withdrawals`, method: 'GET' });
    if (response.status === 404) return { status: 'unavailable' };
    if (!response.ok) throw await toRequestError(response);
    // SAFETY: §5.18 defines the 200 body of this endpoint as
    // `ListStudyWithdrawalsResponse`; the 404 and every other non-2xx are handled above.
    const body = (await response.json()) as ListStudyWithdrawalsResponse;
    return { status: 'available', value: body.withdrawals.map(decodeStudyWithdrawal) };
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private async send({
    path,
    method,
    body,
  }: {
    path: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
  }): Promise<Response> {
    const attempt = async (accessToken: string | null): Promise<Response> => {
      const headers: Record<string, string> = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (accessToken !== null) headers.Authorization = `Bearer ${accessToken}`;
      try {
        return await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (error) {
        throw new SyncRequestError({
          kind: 'transport',
          message: error instanceof Error ? error.message : 'The sync server could not be reached.',
        });
      }
    };

    const response = await attempt(this.tokens.getAccessToken());
    if (response.status !== 401) return response;

    // §11: refresh once, retry once. A second 401 means the session is really
    // gone — loop here and a revoked token becomes an infinite retry.
    const refreshed = await this.tokens.refreshAccessToken();
    if (refreshed === null) return response;
    return attempt(refreshed);
  }
}

function decodeContributionEnrolment(wire: ContributionEnrolmentWire): ContributionEnrolment {
  return {
    studyAccountId: wire.studyAccountId,
    pseudonym: wire.pseudonym,
    schemaTier: wire.schemaTier,
    contributionVersion: wire.contributionVersion,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}

/** Decodes one cohort row. The field list is exhaustive on purpose: an account id could only appear here by somebody adding it. */
function decodeStudyContribution(wire: StudyContributionWire): StudyContribution {
  return {
    pseudonym: wire.pseudonym,
    contributionVersion: wire.contributionVersion,
    schemaTier: wire.schemaTier,
    body: base64ToBytes(wire.body),
    createdAt: wire.createdAt,
  };
}

function decodeStudyWithdrawal(wire: StudyWithdrawalWire): StudyWithdrawal {
  return { pseudonym: wire.pseudonym, withdrawnAt: wire.withdrawnAt };
}

function decodeKeyRecord(wire: KeyRecordWire): StoredKeyRecord {
  return {
    kind: wire.kind,
    kdfDescriptor: wire.kdfDescriptor,
    wrappedDek: base64ToBytes(wire.wrappedDek),
    updatedAt: wire.updatedAt,
  };
}

function decodeShareGrant(wire: ShareGrantWire): ShareGrant {
  return {
    granteeAccountId: wire.granteeAccountId,
    recipientKeyFingerprint: wire.recipientKeyFingerprint,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}

function decodeReceivedShare(wire: ReceivedShareWire): ReceivedShare {
  return {
    grantorAccountId: wire.grantorAccountId,
    wrappedDek: base64ToBytes(wire.wrappedDek),
    recipientKeyFingerprint: wire.recipientKeyFingerprint,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}
