/**
 * The account half of the sync client: everything under `/v1/auth/*`, plus
 * the token lifecycle that keeps a session alive without ever holding the
 * passphrase (`PROTOCOL.md` §4.2, §5.7–§5.15).
 *
 * THE INVARIANT THIS FILE EXISTS TO HOLD: the master passphrase is never
 * stored, never cached, never logged, and never sent. It enters
 * `derive-credentials.ts` as an argument, produces `authHash` (a sibling HKDF
 * branch, useless for decryption) and the KEK, and is unreachable from
 * anywhere else. This class never accepts a passphrase at all — callers hand
 * it an already-derived `authHash` — which makes the invariant structural
 * rather than a rule someone has to remember.
 *
 * TOKENS LIVE IN MEMORY ONLY, and that is a design decision with a visible
 * consequence: reloading the page signs the session out and the user re-enters
 * their passphrase. That is not an oversight to be "fixed" with localStorage.
 * A persisted refresh token would only restore the SESSION — the DEK still
 * cannot be re-derived without the passphrase, so the user has to be prompted
 * anyway, and the persisted token would buy nothing except an XSS-readable
 * credential sitting on disk. Bitwarden's vault locks on reload for the same
 * reason. The refresh token earns its keep WITHIN a session: access tokens
 * last 15 minutes and a sync session can outlive that many times over.
 *
 * REFRESHES ARE SERIALIZED (`refreshInFlight`). Rotation is single-use, so two
 * concurrent refreshes would spend the same token twice — and a REUSED refresh
 * token is the theft signal that revokes the whole family and logs the real
 * user out (§4.2). Two tabs racing look exactly like an attacker; the cross-tab
 * half of that is handled by the orchestrator's single-writer lock, and this
 * promise handles the in-tab half.
 */
import {
  AUTH_API_PREFIX,
  type AccountResponseWire,
  type AccountSummaryWire,
  type ChangePassphraseRequestWire,
  type DeleteAccountRequestWire,
  type KdfDescriptorResponse,
  type KdfDescriptorWire,
  type KeyRecordSubmissionWire,
  type LoginRequestWire,
  type RefreshRequestWire,
  type RefreshResponseWire,
  type ResetRequestWire,
  type RotationResponseWire,
  type SessionResponseWire,
  type SessionTokensWire,
  type SignupRequestWire,
} from './auth-wire';
import { errorKindForStatus, SyncRequestError } from './sync-error';
import { defaultFetchImpl } from './fetch-impl';
import {
  checkProtocolCompatibility,
  isProtocolHandshake,
  readHandshakeNotice,
  type JsonValue,
  type OperatorNotice,
  type ProtocolCompatibility,
  type SignupMode,
} from '../protocol';
import { z } from 'zod';

type FetchImpl = typeof fetch;

export interface SyncAuthClientOptions {
  baseUrl: string;
  fetchImpl?: FetchImpl;
}

/** What the blob client needs from an authenticated session — nothing more. */
export interface SyncTokenProvider {
  getAccessToken(): string | null;
  /** Spends the refresh token for a new pair. Returns the new access token, or `null` when the user must sign in again. */
  refreshAccessToken(): Promise<string | null>;
}

/** A signed-in session, as this client tracks it. Both tokens are memory-only (see the module header). */
export interface SyncAuthSession {
  account: AccountSummaryWire;
  tokens: SessionTokensWire;
}

/**
 * Held for the single round trip inside {@link SyncAuthClient.adoptTokens},
 * between "we have tokens" and "we have read who they belong to". It exists
 * only so the bearer header can be attached to that one request; nothing
 * outside that method ever observes it.
 */
const PENDING_ACCOUNT: AccountSummaryWire = { id: -1, email: '', displayName: null, emailVerified: false };

export class SyncAuthClient implements SyncTokenProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchImpl;
  private session: SyncAuthSession | null = null;
  private refreshInFlight: Promise<string | null> | null = null;

  constructor({ baseUrl, fetchImpl = defaultFetchImpl }: SyncAuthClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  // -------------------------------------------------------------------------
  // Session state
  // -------------------------------------------------------------------------

  getSession(): SyncAuthSession | null {
    return this.session;
  }

  getAccessToken(): string | null {
    return this.session?.tokens.accessToken ?? null;
  }

  /** Drops all token state. Local only — call `logout()` to also revoke server-side. */
  clearSession(): void {
    this.session = null;
    this.refreshInFlight = null;
  }

  /**
   * Adopts a token pair minted by an endpoint other than login/signup — in
   * practice `POST /v1/auth/reset`, which returns a session for the caller
   * without ever describing the account.
   *
   * The account is then READ from `/v1/auth/account` rather than assumed. A
   * placeholder id would end up in the envelope's AAD, where it would bind
   * every blob this session wrote to an account that does not exist — silent
   * at write time and undecryptable forever afterwards.
   */
  async adoptTokens(tokens: SessionTokensWire): Promise<SyncAuthSession> {
    this.session = { account: PENDING_ACCOUNT, tokens };
    const account = await this.getAccount();
    const session: SyncAuthSession = { account, tokens };
    this.session = session;
    return session;
  }

  // -------------------------------------------------------------------------
  // Handshake (§5.6 / §6) — mandatory before the first sync of a session
  // -------------------------------------------------------------------------

  /**
   * Reads `/health` and decides whether this build may talk to that service.
   *
   * FAILS CLOSED: an unreachable or malformed handshake is reported as
   * incompatible, not as "probably fine". §6 is unambiguous about why — the
   * blob is often the user's only copy, and a client that pushes an envelope a
   * newer service frames differently can destroy it. A refused sync is a
   * visible inconvenience; a silently wrong one is a data-loss incident found
   * weeks later.
   *
   * NO RETRY, deliberately. A retry was briefly added here for an apparently
   * intermittent "could not be reached" seen in browser testing — which turned
   * out to be a 100% deterministic `Illegal invocation` from an unbound
   * `fetch` default (`fetch-impl.ts`), surfacing through this catch. With the
   * real cause fixed there is nothing left for a retry to paper over, and
   * removing it keeps a genuinely unreachable service failing fast instead of
   * taking two timeouts to say so. Retry logic added for a symptom that has
   * since been explained is exactly the residue that misleads the next reader.
   */
  async handshake(): Promise<ProtocolCompatibility> {
    let body: JsonValue | undefined;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, { method: 'GET' });
      if (!response.ok) {
        return { status: 'incompatible', reason: `The sync server answered ${response.status} to a health check.` };
      }
      body = await response.json();
    } catch {
      return { status: 'incompatible', reason: 'The sync server could not be reached.' };
    }
    if (!isProtocolHandshake(body)) {
      return { status: 'incompatible', reason: 'The sync server did not report a recognizable protocol version.' };
    }
    return checkProtocolCompatibility(body);
  }

  /**
   * Reads the instance's signup policy from the same `/health` body (§5.6).
   *
   * SEPARATE FROM `handshake()` ON PURPOSE. That method fails CLOSED — an
   * unreachable service is reported as incompatible, because a wrong sync
   * destroys a blob. This one fails OPEN, returning `null` for an unreachable
   * service, a malformed body, or a service too old to carry the field, and
   * `null` means "attempt the signup and handle the 403". Folding the two
   * together would force one failure posture onto both, and the right posture
   * genuinely differs: refusing to sync on doubt protects data, whereas
   * refusing to show a sign-up form on doubt just hides a working feature.
   *
   * The answer is a HINT for choosing which form to draw. The `403` is the
   * contract — an operator can change the mode between this call and the
   * submit.
   */
  async signupMode(): Promise<SignupMode | null> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, { method: 'GET' });
      if (!response.ok) return null;
      const body: JsonValue = await response.json();
      if (!isProtocolHandshake(body)) return null;
      return body.signupMode ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Reads the operator's notice from the same `/health` body (§5.6).
   *
   * FAILS OPEN, like `signupMode()` above and unlike `handshake()`: an
   * unreachable service, a malformed body or a service older than the field
   * all mean `null`, which means "show no banner". A message the operator
   * wanted shown is worth reaching for, and is never worth blocking a sync
   * over.
   *
   * The value is SERVER-SUPPLIED and hostile: `readHandshakeNotice` parses it,
   * and the banner renders it as text and scheme-checks the link.
   */
  async notice(): Promise<OperatorNotice | null> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, { method: 'GET' });
      if (!response.ok) return null;
      const body: JsonValue = await response.json();
      return readHandshakeNotice(body);
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Pre-login
  // -------------------------------------------------------------------------

  /**
   * Fetches the account's Argon2id salt and parameters BEFORE deriving
   * anything (§5.7). Never assume this build's defaults: an account created
   * under raised costs derives differently, and getting it wrong looks exactly
   * like a wrong passphrase.
   *
   * An unknown address returns a stable, real-shaped dummy — by design, so
   * this endpoint cannot be used to enumerate accounts. The client cannot tell
   * the difference and must not try to.
   */
  async fetchKdfDescriptor(email: string): Promise<KdfDescriptorWire> {
    const body = await this.requestJson<KdfDescriptorResponse>({
      path: `${AUTH_API_PREFIX}/kdf`,
      method: 'POST',
      body: { email },
    });
    return body.kdfDescriptor;
  }

  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------

  /**
   * Creates an account. `tokens: null` in the response means this instance
   * requires email verification — the account exists, but there is no session
   * yet and the caller must say so rather than showing a signed-in screen.
   */
  async signup(input: {
    email: string;
    authHash: string;
    kdfDescriptor: KdfDescriptorWire;
    displayName?: string | null;
    /** Required by an invite-only instance; ignored by an open one. */
    inviteToken?: string;
  }): Promise<SessionResponseWire> {
    const request: SignupRequestWire = {
      email: input.email,
      authHash: input.authHash,
      kdfDescriptor: input.kdfDescriptor,
      displayName: input.displayName ?? null,
    };
    // Assigned rather than spread, so an absent invite omits the field instead
    // of sending an explicit `undefined`.
    if (input.inviteToken !== undefined) request.inviteToken = input.inviteToken;
    const response = await this.requestJson<SessionResponseWire>({
      path: `${AUTH_API_PREFIX}/signup`,
      method: 'POST',
      body: request,
    });
    this.adoptSession(response);
    return response;
  }

  async login(input: { email: string; authHash: string }): Promise<SyncAuthSession> {
    const request: LoginRequestWire = { email: input.email, authHash: input.authHash };
    const response = await this.requestJson<SessionResponseWire>({
      path: `${AUTH_API_PREFIX}/login`,
      method: 'POST',
      body: request,
    });
    if (response.tokens === null) {
      throw new SyncRequestError({
        kind: 'forbidden',
        message: 'This account still needs its email address confirmed before it can sync.',
        status: 403,
      });
    }
    const session: SyncAuthSession = { account: response.account, tokens: response.tokens };
    this.session = session;
    return session;
  }

  /**
   * Spends the current refresh token for a new pair.
   *
   * Returns `null` — rather than throwing — when the session is simply gone
   * (no token, or the service rejected it). "The user must sign in again" is
   * an expected state of a long-lived app, not an exceptional one, and the
   * caller's response to it is a prompt, never a crash. A transport failure
   * still throws: that is "we don't know", which must not be mistaken for
   * "you are signed out".
   */
  async refreshAccessToken(): Promise<string | null> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const refreshToken = this.session?.tokens.refreshToken;
    if (refreshToken === undefined) return null;

    this.refreshInFlight = this.performRefresh(refreshToken).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async performRefresh(refreshToken: string): Promise<string | null> {
    const request: RefreshRequestWire = { refreshToken };
    let response: RefreshResponseWire;
    try {
      response = await this.requestJson<RefreshResponseWire>({
        path: `${AUTH_API_PREFIX}/refresh`,
        method: 'POST',
        body: request,
      });
    } catch (error) {
      if (error instanceof SyncRequestError && error.kind === 'unauthorized') {
        this.clearSession();
        return null;
      }
      throw error;
    }
    const account = this.session?.account;
    if (account === undefined) return null;
    this.session = { account, tokens: response.tokens };
    return response.tokens.accessToken;
  }

  /** Revokes this device's token family server-side and drops local state. Other devices keep their sessions. */
  async logout(): Promise<void> {
    const token = this.getAccessToken();
    this.clearSession();
    if (token === null) return;
    try {
      await this.fetchImpl(`${this.baseUrl}${AUTH_API_PREFIX}/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Local state is already cleared, which is the part the user can see.
      // A failed revocation leaves a token that expires on its own within
      // minutes; throwing here would turn "signed out" into an error screen.
    }
  }

  // -------------------------------------------------------------------------
  // Account management
  // -------------------------------------------------------------------------

  async getAccount(): Promise<AccountSummaryWire> {
    const body = await this.requestJson<AccountResponseWire>({
      path: `${AUTH_API_PREFIX}/account`,
      method: 'GET',
      authenticated: true,
    });
    return body.account;
  }

  /**
   * Rotates the passphrase: new verifier, new KDF descriptor, and the DEK
   * re-wrapped under the new KEK — applied atomically server-side, because a
   * verifier stored without its re-wrapped DEK produces an account that logs
   * in fine and can never decrypt its own data again.
   *
   * `keyRecords` must carry the re-wrapped passphrase record. The `recovery`
   * record wraps the same unchanged DEK and is deliberately left alone.
   */
  async changePassphrase(input: {
    currentAuthHash: string;
    newAuthHash: string;
    kdfDescriptor: KdfDescriptorWire;
    keyRecords: KeyRecordSubmissionWire[];
  }): Promise<SessionTokensWire> {
    const request: ChangePassphraseRequestWire = input;
    const body = await this.requestJson<RotationResponseWire>({
      path: `${AUTH_API_PREFIX}/change-passphrase`,
      method: 'POST',
      body: request,
      authenticated: true,
    });
    const account = this.session?.account;
    if (account !== undefined) this.session = { account, tokens: body.tokens };
    return body.tokens;
  }

  /** Always `202`, whether or not the address has an account. The email is the only channel that reveals anything. */
  async requestReset(email: string): Promise<void> {
    await this.requestJson<unknown>({
      path: `${AUTH_API_PREFIX}/request-reset`,
      method: 'POST',
      body: { email },
    });
  }

  /**
   * Completes an emailed reset.
   *
   * Reset restores LOGIN. It restores DATA only when `keyRecords` carries a
   * DEK re-wrapped under the new passphrase — which is possible only if the
   * user still has their recovery code. Submitting `[]` produces a working
   * account whose existing blob is permanently undecryptable, which is why the
   * UI in front of this makes the user choose that branch explicitly
   * (`app/lib/sync/reset-flow.ts`) rather than discover it afterwards.
   */
  async resetCredential(input: {
    token: string;
    authHash: string;
    kdfDescriptor: KdfDescriptorWire;
    keyRecords: KeyRecordSubmissionWire[];
  }): Promise<SessionTokensWire> {
    const request: ResetRequestWire = input;
    const body = await this.requestJson<RotationResponseWire>({
      path: `${AUTH_API_PREFIX}/reset`,
      method: 'POST',
      body: request,
    });
    return body.tokens;
  }

  /**
   * Deletes the account and, by cascade, every blob and key record it owns.
   * No soft delete, no grace period.
   *
   * Re-authentication is required even though a valid token is already held:
   * a session left behind on a shared device must not be enough to destroy
   * someone's data irreversibly.
   */
  async deleteAccount(input: { authHash: string }): Promise<void> {
    const request: DeleteAccountRequestWire = { authHash: input.authHash };
    await this.requestJson<unknown>({
      path: `${AUTH_API_PREFIX}/delete`,
      method: 'POST',
      body: request,
      authenticated: true,
    });
    this.clearSession();
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  /**
   * One request, with §11's "on 401, refresh once and retry once; on a second
   * 401, send the user to log in" rule implemented exactly once rather than at
   * every call site.
   */
  private async requestJson<T>({
    path,
    method,
    body,
    authenticated = false,
  }: {
    path: string;
    method: 'GET' | 'POST';
    body?: unknown;
    authenticated?: boolean;
  }): Promise<T> {
    const send = async (accessToken: string | null): Promise<Response> => {
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

    let response = await send(authenticated ? this.getAccessToken() : null);
    if (authenticated && response.status === 401) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed !== null) response = await send(refreshed);
    }
    if (!response.ok) throw await toRequestError(response);
    if (response.status === 204) {
      // SAFETY: a 204 carries no body by definition, and every call site that
      // can receive one asks for `T = void` (`logout`, `deleteAccount`).
      return undefined as T;
    }
    // SAFETY: `T` is fixed at each call site to the §5.x response shape that
    // path requests, and the service is version-checked by `handshake()`
    // before any of these calls run.
    return (await readJson(response)) as T;
  }

  private adoptSession(response: SessionResponseWire): void {
    if (response.tokens === null) return;
    this.session = { account: response.account, tokens: response.tokens };
  }
}

/** Builds a {@link SyncRequestError} from a non-2xx response, keeping the server's prose for diagnostics only. */
export async function toRequestError(response: Response): Promise<SyncRequestError> {
  const kind = errorKindForStatus(response.status);
  let message = `sync request failed with status ${response.status}`;
  try {
    const parsed = protocolErrorBodySchema.safeParse(await response.json());
    if (parsed.success) message = parsed.data.error;
  } catch {
    // A non-JSON error body is itself diagnostic; the status already carries
    // the meaning a client is allowed to branch on.
  }
  const retryAfter = response.headers.get('Retry-After');
  return new SyncRequestError({
    kind,
    message,
    status: response.status,
    retryAfterSeconds: retryAfter === null ? null : Number.parseInt(retryAfter, 10),
  });
}

/** Every non-2xx body the service documents (`ProtocolErrorResponse`); a blank `error` is treated as absent. */
const protocolErrorBodySchema = z.object({ error: z.string().min(1) });

async function readJson(response: Response): Promise<JsonValue> {
  try {
    return await response.json();
  } catch {
    throw new SyncRequestError({
      kind: 'transport',
      message: 'The sync server returned a response this app could not read.',
      status: response.status,
    });
  }
}
