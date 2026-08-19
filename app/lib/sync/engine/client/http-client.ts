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

function decodeKeyRecord(wire: KeyRecordWire): StoredKeyRecord {
  return {
    kind: wire.kind,
    kdfDescriptor: wire.kdfDescriptor,
    wrappedDek: base64ToBytes(wire.wrappedDek),
    updatedAt: wire.updatedAt,
  };
}
