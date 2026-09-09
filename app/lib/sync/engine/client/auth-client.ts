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
 * TOKENS LIVE IN MEMORY HERE, AND ON DISK ONE LAYER UP (M192). This class
 * still holds them in a private field and still hands nothing out but an
 * access token; what changed is that `session-cache.ts` may now write that
 * pair, the DEK and the compartment key into a device-only IndexedDB database
 * so a reload does not end the session.
 *
 * The argument that used to stand here was: a persisted refresh token buys
 * nothing, because the DEK cannot be re-derived without the passphrase, so the
 * user must be prompted anyway. That premise was the whole load-bearing part,
 * and it is false once the DEK is cached beside the token. THE NEW RULE, and
 * why it costs nothing: the local diary is already plaintext in IndexedDB on
 * the same device and the same origin. Anything that can read the cached key
 * can read the diary it opens, directly, without it. A password prompt on
 * every reload was therefore protecting the copy in the cloud from an attacker
 * who already had the copy in front of them.
 *
 * The password is still asked at sign-in, at a passphrase change, at account
 * deletion, and whenever a refresh is refused. Nowhere else.
 *
 * The refresh token also earns its keep WITHIN a session: access tokens last
 * 15 minutes and a sync session can outlive that many times over.
 *
 * REFRESHES ARE SERIALIZED (`refreshInFlight`). Rotation is single-use, so two
 * concurrent refreshes would spend the same token twice — and a REUSED refresh
 * token is the theft signal that revokes the whole family and logs the real
 * user out (§4.2). Two tabs racing look exactly like an attacker; the cross-tab
 * half of that is handled by the orchestrator's single-writer lock, and this
 * promise handles the in-tab half.
 *
 * AND THE ROTATED PAIR IS WRITTEN BACK (M201, the 0.10.3 silent sign-out). The
 * memoized promise above serializes refreshes but did not RECORD them: a
 * mid-life rotation replaced the pair in this object and left the device's
 * cached copy holding the spent refresh token, which the next reload presented
 * as its own. See {@link SessionTokenStore} for the whole failure and the seam
 * that closes it.
 */
import {
  AUTH_API_PREFIX,
  type AccountResponseWire,
  type AccountViewWire,
  type ChangePassphraseRequestWire,
  type DeleteAccountRequestWire,
  type InviteLookupResponseWire,
  type KdfDescriptorResponse,
  type KdfDescriptorWire,
  type KeyRecordSubmissionWire,
  type LoginRequestWire,
  type MemberInviteRequestWire,
  type PatchAccountRequestWire,
  type RefreshRequestWire,
  type RecoverRequestWire,
  type RecoverRotateRequestWire,
  type RefreshResponseWire,
  type ResetOpenRequestWire,
  type ResetOpenResponseWire,
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
  readHandshakeInstance,
  readHandshakeNotice,
  type InstanceDescriptor,
  type JsonValue,
  type OperatorNotice,
  type ProtocolCompatibility,
} from '../protocol';
import { z } from 'zod';
import { createComponentLogger } from '#app/lib/logger';

const log = createComponentLogger('sync-auth-client');

type FetchImpl = typeof fetch;

/**
 * Where the token pair lives BETWEEN refreshes, and the lock that keeps two
 * spenders apart.
 *
 * WHY THIS INTERFACE EXISTS (the 0.10.3 silent sign-out). Rotation is
 * single-use: `/v1/auth/refresh` mints a new pair and revokes the old one. Up
 * to M201 this class rotated in MEMORY and nothing wrote the new pair back, so
 * the device's cached copy still held the SPENT refresh token from the moment
 * of the first mid-life refresh. The next reload resumed with it, the service
 * read an already revoked token as theft, and the whole family was revoked
 * (`PROTOCOL.md` §4.2, §1225: never reuse a spent token, serialize refreshes).
 * One tab was enough.
 *
 * The client OWNS this interface rather than importing a concrete store: the
 * durable copy is `session-cache.ts`'s IndexedDB row, which is one layer up
 * and knows about vaults, sessions and React. `session-cache.ts` implements
 * it; nothing here depends on that.
 *
 * WITH NO STORE ATTACHED THE CLIENT BEHAVES EXACTLY AS BEFORE, one in-memory
 * rotation, no lock, no read-back. Every sign-in path that builds a client and
 * hands it straight to a vault gets the store from `openSyncVault`, and the
 * tests that drive this class without one are testing the same code they were.
 */
export interface SessionTokenStore {
  /**
   * The pair this device currently holds, or `null` when there is none to read
   * (no cached record, no storage, an unreadable database).
   *
   * `null` means "proceed with the pair you already have", never "you are
   * signed out". A storage failure must not end a live session. What comes
   * back is not assumed to be newer than what the caller holds, because
   * `onRotated` may have failed: see `adoptNewerTokens`.
   */
  latest(): Promise<SessionTokensWire | null>;
  /** Records a pair this client just minted. Best effort: a failed write costs a reload, not a session. */
  onRotated(tokens: SessionTokensWire): Promise<void>;
  /** Runs `task` as the device's only refresher. See `sync-lock.ts` for the ordering rule. */
  withLock<T>(task: () => Promise<T>): Promise<T>;
}

/**
 * How much life an ADOPTED access token must have left before it is used as
 * is, instead of being refreshed.
 *
 * The margin exists because the request this token is about to authorize has
 * not been sent yet. A token with two seconds left would be adopted, sent, and
 * answered `401`, which sends the caller straight back here, having spent
 * nothing and learned nothing.
 */
const ADOPTED_ACCESS_TOKEN_MARGIN_MS = 30_000;

/** True when this access token has more than {@link ADOPTED_ACCESS_TOKEN_MARGIN_MS} left to live. */
function hasUsableAccessToken(tokens: SessionTokensWire): boolean {
  const expiresAt = Date.parse(tokens.accessTokenExpiresAt);
  // An unparseable expiry is treated as expired: refreshing one time too often
  // costs a round trip, and trusting one costs the session.
  if (Number.isNaN(expiresAt)) return false;
  return expiresAt - Date.now() > ADOPTED_ACCESS_TOKEN_MARGIN_MS;
}

/**
 * Is `candidate` a LATER pair than `held`?
 *
 * `refreshTokenExpiresAt` is the clock: the service mints a fresh one on every
 * rotation and it moves only forward within a token family, so a later value
 * is exactly "minted after". Two different refresh tokens with the SAME expiry
 * are not ordered by anything this client can see.
 *
 * `false` for an unparseable timestamp on either side, and for a tie, both for
 * the reason `adoptNewerTokens` sets out: a wrong "no" costs one visible
 * re-authentication, a wrong "yes" revokes the family.
 */
function isStrictlyNewerPair({ candidate, held }: { candidate: SessionTokensWire; held: SessionTokensWire }): boolean {
  const candidateExpiry = Date.parse(candidate.refreshTokenExpiresAt);
  const heldExpiry = Date.parse(held.refreshTokenExpiresAt);
  if (Number.isNaN(candidateExpiry) || Number.isNaN(heldExpiry)) return false;
  return candidateExpiry > heldExpiry;
}

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

/** A signed-in session, as this client tracks it. See the module header on where these tokens may be written. */
export interface SyncAuthSession {
  account: AccountViewWire;
  tokens: SessionTokensWire;
}

/**
 * Held for the single round trip inside {@link SyncAuthClient.adoptTokens},
 * between "we have tokens" and "we have read who they belong to". It exists
 * only so the bearer header can be attached to that one request; nothing
 * outside that method ever observes it.
 *
 * ITS FIELDS ARE NOT DATA — `role: 'member'`, `dailyAiLimit: 0`, and the rest
 * are filler that satisfies `AccountViewWire`'s type, not an answer to "does
 * this account administer" or "how much allowance is left". Every reader that
 * copies a `SyncAuthSession`'s account into somewhere React can see (M192,
 * `sync-session.ts`) must run it through {@link isPendingAccountView} first —
 * treating this object's fields as real is exactly the 0.10.1 walk defect 2
 * bug (an administrator's `role` read as `'member'` because a session was
 * published before the real `AccountView` had come back).
 *
 * `createdAt: ''` IS THE SENTINEL, not `id`: {@link SyncAuthClient.restoreSession}
 * spreads this object over the CACHED account's real `id` and `email` — the
 * one placeholder that ever reaches `openSyncSession` with a real-looking id
 * — so a check keyed on `id` would miss exactly the case this exists to
 * catch. `createdAt` is the one field neither `restoreSession` nor anything
 * else overwrites before a real read replaces the whole object, and the
 * service never issues an account with an empty `createdAt`.
 */
const PENDING_ACCOUNT: AccountViewWire = {
  id: -1,
  email: '',
  displayName: null,
  role: 'member',
  dailyAiLimit: 0,
  aiUsedToday: 0,
  // FILLER, like every field above it. `null` is the honest shape for both:
  // "no end date" and "the invite cap is not about you" are what a reader of a
  // real view sees for these, so a placeholder that said anything else would
  // be a fact rather than a hole. Nothing publishes them from here anyway,
  // because `isPendingAccountView` gates the copy into the snapshot.
  allowanceExpiresAt: null,
  suspendedAt: null,
  invitesLeft: null,
  createdAt: '',
};

/** True for {@link PENDING_ACCOUNT} and any session still carrying its placeholder — see that constant's header. */
export function isPendingAccountView(account: AccountViewWire): boolean {
  return account.createdAt === PENDING_ACCOUNT.createdAt;
}

export class SyncAuthClient implements SyncTokenProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchImpl;
  private session: SyncAuthSession | null = null;
  private refreshInFlight: Promise<string | null> | null = null;
  private tokenStore: SessionTokenStore | null = null;

  constructor({ baseUrl, fetchImpl = defaultFetchImpl }: SyncAuthClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  /**
   * Attaches the device's durable token store (see {@link SessionTokenStore}).
   *
   * IDEMPOTENT: `session-cache.ts` attaches the same singleton twice on the
   * resume path, once before the refresh that reopens the session, once when
   * `openSyncVault` runs, and the second call must change nothing.
   */
  setTokenStore(store: SessionTokenStore): void {
    if (this.tokenStore === store) return;
    this.tokenStore = store;
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
   * Restores a session from a CACHED pair, with no round trip.
   *
   * The `account` handed in is a placeholder taken from the cache: it carries
   * the id and the address, and nothing else that has to be right. The caller
   * (`resumeSyncSession`) reads the real `AccountView` from `/v1/auth/account`
   * immediately afterwards, and it must — `dailyAiLimit`, `aiUsedToday` and
   * `suspendedAt` all change on the server between one visit and the next, so
   * a resumed session that trusted its cached copy of them would show a
   * suspended account a working scan button.
   *
   * DISTINCT FROM {@link adoptTokens}, which reads the account itself before
   * returning. The difference is what happens on the way: `adoptTokens` runs
   * one authenticated request under a fake id, which is safe for a rotation
   * that just proved itself, and would be a silent 401 here where the cached
   * access token is usually already expired.
   */
  restoreSession(input: { account: { id: number; email: string }; tokens: SessionTokensWire }): void {
    this.session = {
      account: { ...PENDING_ACCOUNT, id: input.account.id, email: input.account.email },
      tokens: input.tokens,
    };
    this.refreshInFlight = null;
  }

  /**
   * Adopts a token pair minted elsewhere — a rotation endpoint that returns
   * fresh tokens for the caller without describing the account again.
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
   * Reads the instance's self-description from the same `/health` body — its
   * name, its language, whether it can send mail, and which model its AI proxy
   * serves (protocol 2).
   *
   * SEPARATE FROM `handshake()` ON PURPOSE. That method fails CLOSED — an
   * unreachable service is reported as incompatible, because a wrong sync
   * destroys a blob. This one fails OPEN, returning `null` for an unreachable
   * service, a malformed body, or a service too old to carry the field.
   * Folding the two together would force one failure posture onto both, and
   * the right posture genuinely differs: refusing to sync on doubt protects
   * data, whereas refusing to name a model on doubt just hides a working
   * feature behind a blank card.
   *
   * It replaced `signupMode()`, which asked a question protocol 2 no longer
   * has an answer to: every account comes from an addressed invite.
   */
  async instance(): Promise<InstanceDescriptor | null> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, { method: 'GET' });
      if (!response.ok) return null;
      const body: JsonValue = await response.json();
      return readHandshakeInstance(body);
    } catch {
      return null;
    }
  }

  /**
   * Reads the operator's notice from the same `/health` body (§5.6).
   *
   * FAILS OPEN, like `instance()` above and unlike `handshake()`: an
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
   * An unknown email returns a stable, real-shaped dummy — by design, so this
   * endpoint cannot be used to enumerate accounts. The client cannot tell the
   * difference and must not try to.
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
   * Looks an invite up before anything is derived from it.
   *
   * The answer is what the join screen shows the person: the address the
   * invite was written to, and the name whoever sent it typed. So the screen
   * says "you were invited as anna@example.org" rather than asking somebody to
   * type an address that is already decided.
   *
   * An invalid, spent, revoked or expired token is ONE outcome
   * (`{ status: 'invalid' }`), not four, and it is a RETURN rather than a
   * throw: a dead invite is an ordinary thing to arrive with, and it has a
   * screen of its own. Every other failure — offline, a 500, a service that
   * does not speak protocol 2 — still throws, because those mean "we do not
   * know", which must never be shown as "your invitation is not valid".
   */
  async inviteLookup(input: { inviteToken: string }): Promise<InviteLookupResponseWire | { status: 'invalid' }> {
    try {
      return await this.requestJson<InviteLookupResponseWire>({
        path: `${AUTH_API_PREFIX}/invite-lookup`,
        method: 'POST',
        body: { inviteToken: input.inviteToken },
      });
    } catch (error) {
      if (error instanceof SyncRequestError && error.kind === 'not-found') return { status: 'invalid' };
      throw error;
    }
  }

  /**
   * Redeems an invite into an account and returns its first session.
   *
   * EVERY RECOVERY FIELD IS REQUIRED, and the signature says so rather than
   * leaving it to a server 400. The client no longer shows the recovery code
   * to anybody, so an account created without the escrow is an account nobody
   * can ever reset — and unlike a missing key record, nothing detects that
   * afterwards. Making the three fields non-optional here is what stops a
   * future caller from omitting one and getting an account that works
   * perfectly until somebody forgets their password.
   *
   * The email is NOT in this body. It comes from the invite, server-side,
   * which is what makes the invite the address verification.
   */
  async signup(input: {
    inviteToken: string;
    authHash: string;
    kdfDescriptor: KdfDescriptorWire;
    displayName?: string | null;
    recoveryAuthHash: string;
    /** The RAW code, escrowed by the service. See `auth-wire.ts` on why this is here. */
    recoveryCode: string;
    keyRecords: KeyRecordSubmissionWire[];
  }): Promise<SessionResponseWire> {
    const request: SignupRequestWire = {
      inviteToken: input.inviteToken,
      authHash: input.authHash,
      kdfDescriptor: input.kdfDescriptor,
      displayName: input.displayName ?? null,
      recoveryAuthHash: input.recoveryAuthHash,
      recoveryCode: input.recoveryCode,
      keyRecords: input.keyRecords,
    };
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
    const session: SyncAuthSession = { account: response.account, tokens: response.tokens };
    this.session = session;
    return session;
  }

  /**
   * `POST /v1/auth/recover` — a session proved with the recovery code instead
   * of the passphrase.
   *
   * The session it returns is an ORDINARY one, deliberately: the holder of the
   * recovery code is the account owner by construction, and a lesser
   * "recovery mode" token would add a second authorization surface carrying no
   * property the code does not already have.
   *
   * Throttled per IP and email server-side, and never cleared on success.
   *
   * NO SCREEN CALLS THIS WITH A TYPED CODE any more. Its only caller is
   * `resetSyncPassphrase`, which fetched the code from `/reset/open` moments
   * earlier — see `sync-actions.ts`.
   */
  async recover(input: { email: string; recoveryAuthHash: string }): Promise<SyncAuthSession> {
    const request: RecoverRequestWire = { email: input.email, recoveryAuthHash: input.recoveryAuthHash };
    const response = await this.requestJson<SessionResponseWire>({
      path: `${AUTH_API_PREFIX}/recover`,
      method: 'POST',
      body: request,
    });
    const session: SyncAuthSession = { account: response.account, tokens: response.tokens };
    this.session = session;
    return session;
  }

  /**
   * `POST /v1/auth/recover-rotate` — prove the recovery code and set a new
   * passphrase, atomically.
   *
   * `keyRecords` MUST carry the `passphrase` record re-wrapped under the new
   * KEK; the service refuses the rotation without it rather than mint an
   * account that signs in and decrypts nothing.
   *
   * Rotating the recovery code is all-or-nothing and now travels in THREE
   * parts: `newRecoveryAuthHash`, a `recovery` key record, and the raw
   * `recoveryCode` that replaces the escrow. Moving the verifier and leaving
   * the old escrow behind would leave the service holding a code that opens
   * nothing, and the NEXT reset would appear to work and return an unreadable
   * diary — the failure would surface one reset later, on a different day,
   * with nothing to connect it to.
   */
  async recoverRotate(input: {
    email: string;
    recoveryAuthHash: string;
    newAuthHash: string;
    kdfDescriptor: KdfDescriptorWire;
    keyRecords: KeyRecordSubmissionWire[];
    newRecoveryAuthHash?: string;
    /** REQUIRED whenever `newRecoveryAuthHash` is sent; the service refuses one half without the other. */
    recoveryCode?: string;
  }): Promise<SyncAuthSession> {
    const request: RecoverRotateRequestWire = {
      email: input.email,
      recoveryAuthHash: input.recoveryAuthHash,
      newAuthHash: input.newAuthHash,
      kdfDescriptor: input.kdfDescriptor,
      keyRecords: input.keyRecords,
    };
    // Assigned rather than spread, so an unrotated code omits the fields
    // instead of sending an explicit `undefined` the service has no rule for.
    if (input.newRecoveryAuthHash !== undefined) request.newRecoveryAuthHash = input.newRecoveryAuthHash;
    if (input.recoveryCode !== undefined) request.recoveryCode = input.recoveryCode;
    const response = await this.requestJson<SessionResponseWire>({
      path: `${AUTH_API_PREFIX}/recover-rotate`,
      method: 'POST',
      body: request,
    });
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

  /**
   * One refresh, under the device's lock and after a last look at what
   * somebody else may have written.
   *
   * ── ADOPT BEFORE YOU SPEND ───────────────────────────────────────────────
   *
   * Inside the lock, the store is asked what pair this device actually holds.
   * If it is STRICTLY NEWER than the one in hand, another context (another
   * tab, a second client in this one) rotated while this call waited its turn,
   * and the token in hand is spent. Spending it is the theft signal. So the
   * newer pair is adopted whole, and the request is skipped entirely when its
   * access token still has real life left, which is the common case, because
   * the context that just rotated did so seconds ago. "Newer" is a comparison,
   * not an inequality; {@link SyncAuthClient.adoptNewerTokens} says why.
   *
   * `null` from `latest()` is "carry on with your own pair", never "sign out":
   * a device with no storage at all must still be able to refresh.
   *
   * WITH NO STORE this is the pre-M201 path exactly: no lock, no read, one
   * request.
   */
  private async performRefresh(refreshToken: string): Promise<string | null> {
    const store = this.tokenStore;
    if (store === null) return this.spendRefreshToken(refreshToken);
    return store.withLock(async () => {
      const adopted = await this.adoptNewerTokens(store);
      if (adopted !== null && hasUsableAccessToken(adopted)) return adopted.accessToken;
      return this.spendRefreshToken(adopted?.refreshToken ?? refreshToken);
    });
  }

  /**
   * Reads the store and takes over a pair STRICTLY NEWER than the one this
   * client holds.
   *
   * ── Different is not newer ───────────────────────────────────────────────
   *
   * The first version of this compared the two refresh tokens for inequality,
   * which is wrong in one direction that matters. `reportRotation` is best
   * effort by design, so a failed write leaves the store holding the OLDER
   * pair while this client holds the newer one in memory. Inequality would
   * then read that older pair as "somebody rotated" and adopt it, spending a
   * token the rotation whose write failed has already revoked. That is the
   * family revocation this whole change exists to prevent, reached through a
   * different door and rare enough to be very hard to diagnose.
   *
   * `refreshTokenExpiresAt` is the ordering: the service mints it fresh on
   * every rotation and it only moves forward within a family, so LATER is
   * exactly NEWER.
   *
   * ── Ties and unreadable timestamps do not adopt ──────────────────────────
   *
   * Both are "we cannot prove the stored pair is newer", and the two mistakes
   * are not the same size. Declining to adopt a pair that really was newer
   * costs one refused refresh, which now ends the session VISIBLY
   * (`endSessionRefused`) and asks the person to sign in. Adopting a pair that
   * was not newer spends a revoked token and revokes the family on every
   * device the account has. So the tie goes to the pair in hand.
   *
   * @returns the adopted pair, or `null` when there is nothing newer to adopt.
   */
  private async adoptNewerTokens(store: SessionTokenStore): Promise<SessionTokensWire | null> {
    const session = this.session;
    if (session === null) return null;
    let latest: SessionTokensWire | null;
    try {
      latest = await store.latest();
    } catch (cause) {
      // An unreadable store is not a refused session. Fall through to the
      // ordinary refresh with the pair this client already holds.
      log.warn('could not read the stored session tokens before refreshing', {
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return null;
    }
    if (latest === null) return null;
    if (!isStrictlyNewerPair({ candidate: latest, held: session.tokens })) return null;
    this.session = { account: session.account, tokens: latest };
    return latest;
  }

  private async spendRefreshToken(refreshToken: string): Promise<string | null> {
    const request: RefreshRequestWire = { refreshToken };
    let response: RefreshResponseWire;
    try {
      response = await this.requestJson<RefreshResponseWire>({
        path: `${AUTH_API_PREFIX}/refresh`,
        method: 'POST',
        body: request,
      });
    } catch (error) {
      // A SUSPENDED ACCOUNT ENDS THE SESSION TOO, and it has to be handled
      // here rather than only at the call sites: a suspension arrives mid
      // session, on whatever call happens next, and every one of those calls
      // goes through a refresh first. Treating it as an unexplained error
      // would leave a device retrying a refresh it can never win, quietly, for
      // as long as the tab stays open.
      if (error instanceof SyncRequestError && (error.kind === 'unauthorized' || error.kind === 'suspended')) {
        this.clearSession();
        return null;
      }
      throw error;
    }
    const account = this.session?.account;
    if (account === undefined) return null;
    this.session = { account, tokens: response.tokens };
    await this.reportRotation(response.tokens);
    return response.tokens.accessToken;
  }

  /**
   * Tells the store about a pair this client just minted.
   *
   * NEVER FAILS THE REFRESH. The pair is already in hand and already valid;
   * a store that could not record it costs a reload, which is exactly where
   * this app stood before the session cache existed. Throwing here would turn
   * a successful rotation into a signed-out app.
   */
  private async reportRotation(tokens: SessionTokensWire): Promise<void> {
    const store = this.tokenStore;
    if (store === null) return;
    try {
      await store.onRotated(tokens);
    } catch (cause) {
      log.warn('could not record the rotated session tokens on this device', {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
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

  /**
   * Reads the account, and ADOPTS what it read into the held session.
   *
   * The adopt is the load-bearing half. `AccountView` carries three fields
   * that move on the SERVER between one call and the next — `dailyAiLimit`,
   * `aiUsedToday` and `suspendedAt` — and the session snapshot is what every
   * screen branches on. Returning a fresh view while the session kept a stale
   * one is how a resumed session offers a scan button to a suspended account,
   * or to one whose allowance an admin lowered to zero.
   *
   * A no-op when no session is held: this method is `authenticated: true`, so
   * that state is unreachable, and the guard is what keeps it from being a
   * `!` assertion.
   */
  async getAccount(): Promise<AccountViewWire> {
    const body = await this.requestJson<AccountResponseWire>({
      path: `${AUTH_API_PREFIX}/account`,
      method: 'GET',
      authenticated: true,
    });
    const tokens = this.session?.tokens;
    if (tokens !== undefined) this.session = { account: body.account, tokens };
    return body.account;
  }

  /**
   * Sets the display name — the only field an account owner may edit about
   * themselves.
   *
   * The email is deliberately NOT editable here. It is the identity, an admin
   * issued the invite that carries it, and changing it would silently move an
   * account away from the person the organization invited.
   *
   * The updated view is ADOPTED into the session, so the next screen reads the
   * new name from the same object every other screen reads. Returning it
   * without adopting is how a settings page shows a saved name and an avatar
   * menu two rows away keeps the old one.
   */
  async patchAccount(input: { displayName: string | null }): Promise<AccountViewWire> {
    const request: PatchAccountRequestWire = { displayName: input.displayName };
    const body = await this.requestJson<AccountResponseWire>({
      path: `${AUTH_API_PREFIX}/account`,
      method: 'PATCH',
      body: request,
      authenticated: true,
    });
    const tokens = this.session?.tokens;
    if (tokens !== undefined) this.session = { account: body.account, tokens };
    return body.account;
  }

  /**
   * Invites somebody to this instance, as an ordinary account rather than as
   * an operator (`PROTOCOL.md` §5.21).
   *
   * RETURNS NOTHING, AND MUST NOT. The service answers one fixed `202` with an
   * empty body for a new address, for an address that already holds a pending
   * invitation and for an address that already holds an account. That is the
   * anti-enumeration rule of the reset endpoint below, applied to the one call
   * a person points at somebody else's mailbox: a caller that branched on the
   * answer would hand every account an oracle for who else is here. So there is
   * nothing to return and the caller shows one sentence.
   *
   * A TRANSPORT failure still throws, because "we could not reach the server"
   * is worth saying and says nothing about the address.
   *
   * The cap, the re-invite rule and the throttle all live on the service.
   * `invitesLeft` is drawn, never trusted: this call may be refused after a
   * client believed it had one left.
   */
  async createMemberInvite(input: { email: string }): Promise<void> {
    const request: MemberInviteRequestWire = { email: input.email };
    await this.requestJson<unknown>({
      path: `${AUTH_API_PREFIX}/invites`,
      method: 'POST',
      body: request,
      authenticated: true,
    });
  }

  /**
   * Asks the instance to mail a password-reset link.
   *
   * RETURNS NOTHING, and cannot fail in a way the caller may show. The service
   * answers `202` whether or not the address has an account, so that this
   * endpoint cannot be used to ask whether somebody is a member of the
   * organization. A caller that branched on the answer would be building the
   * oracle the endpoint exists to refuse.
   *
   * Unconfigured mail is the operator's problem, not the person's: the service
   * still answers `202` and the admin page is where the link appears instead.
   */
  async resetRequest(input: { email: string }): Promise<void> {
    const request: ResetRequestWire = { email: input.email };
    await this.requestJson<unknown>({
      path: `${AUTH_API_PREFIX}/reset/request`,
      method: 'POST',
      body: request,
    });
  }

  /**
   * Spends a mailed reset token for the account's email and its ESCROWED
   * recovery code.
   *
   * The token is consumed by this call, so the code it returns is the only
   * copy the client will ever get — the rotation that follows has to run in
   * the same call frame (`resetSyncPassphrase`), and a caller that stored this
   * answer anywhere would be writing the account's master door to disk.
   *
   * An unknown, spent or expired token is ONE outcome, like a dead invite:
   * telling them apart would say whether a link had already been used, which
   * is exactly what somebody reading a forwarded mail would want to know.
   */
  async resetOpen(input: { resetToken: string }): Promise<ResetOpenResponseWire | { status: 'invalid' }> {
    const request: ResetOpenRequestWire = { resetToken: input.resetToken };
    try {
      return await this.requestJson<ResetOpenResponseWire>({
        path: `${AUTH_API_PREFIX}/reset/open`,
        method: 'POST',
        body: request,
      });
    } catch (error) {
      if (error instanceof SyncRequestError && error.kind === 'not-found') return { status: 'invalid' };
      throw error;
    }
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
   * ONE request, with §11's "on 401, refresh once and retry once; on a second
   * 401, send the user to log in" rule applied exactly once, and the raw
   * {@link Response} handed back.
   *
   * SEPARATE FROM {@link requestJson} SO THE ONE RULE IS NOT COPIED. A second
   * reader is needed for a body that is not JSON (an administrator opening a
   * reported photograph), and the alternative was a second refresh loop. A
   * reused refresh token is the theft signal that revokes the whole family, so
   * a second loop is not a duplicated helper, it is a way to sign the person
   * out.
   */
  private async sendWithRefresh({
    path,
    method,
    body,
    authenticated = false,
  }: {
    path: string;
    method: AuthorizedMethod;
    body?: unknown;
    authenticated?: boolean;
  }): Promise<Response> {
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
    return response;
  }

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
    method: AuthorizedMethod;
    body?: unknown;
    authenticated?: boolean;
  }): Promise<T> {
    const response = await this.sendWithRefresh({ path, method, body, authenticated });
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

  /**
   * ONE authenticated request to a path this class knows nothing about,
   * carrying the signed-in account's token and §11's refresh-once rule.
   *
   * WHY THIS EXISTS: the admin surface (`/v1/admin/*`) is authenticated by a
   * signed-in admin's access token, exactly like `/v1/auth/account`, and
   * `PROTOCOL.md` §11's "on 401 refresh once, on a second 401 sign the user
   * out" rule is written down once in this file. A second client that opened
   * its own token lifecycle would rotate the refresh token independently, and
   * a REUSED refresh token is the theft signal that revokes the whole family
   * and logs the real user out. The admin page would be the thing that logged
   * them out.
   *
   * RETURNS PARSED JSON RATHER THAN A CAST. Everything on the other side of
   * this method belongs to another module's contract, so this one cannot know
   * its shape; the caller parses what it asked for. A `204` becomes `null`,
   * which is what a body-less success looks like to a parser.
   */
  async requestAsAccount(input: { path: string; method: AuthorizedMethod; body?: JsonValue }): Promise<JsonValue> {
    const body = await this.requestJson<JsonValue | undefined>({
      path: input.path,
      method: input.method,
      body: input.body,
      authenticated: true,
    });
    return body ?? null;
  }

  /**
   * ONE authenticated read whose body is NOT JSON: the bytes, and the type the
   * service labelled them with.
   *
   * WHY THIS EXISTS: `/v1/admin/feedback/:id/image` answers a photograph, and
   * an administrator's browser may not fetch it as an ordinary `<img src>`.
   * The credential is a bearer token, so the only way to put one on that
   * request without writing it into a URL, a query string or a browser history
   * entry is to read the bytes here and hand the screen an object URL it owns
   * and revokes.
   *
   * `GET` ONLY, and no body, because there is no other verb this reader is
   * for. A `contentType` the service did not label is answered as an opaque
   * stream rather than guessed: guessing is how a stored type becomes an
   * executed one.
   */
  async requestBytesAsAccount(input: { path: string }): Promise<AuthorizedBytes> {
    const response = await this.sendWithRefresh({ path: input.path, method: 'GET', authenticated: true });
    try {
      const bytes = await response.arrayBuffer();
      return { contentType: response.headers.get('Content-Type') ?? 'application/octet-stream', bytes };
    } catch (error) {
      throw new SyncRequestError({
        kind: 'transport',
        message: error instanceof Error ? error.message : 'The sync server returned a body this app could not read.',
        status: response.status,
      });
    }
  }

  private adoptSession(response: SessionResponseWire): void {
    this.session = { account: response.account, tokens: response.tokens };
  }
}

/** The bytes of one authenticated resource, with the type the service labelled them with. */
export interface AuthorizedBytes {
  contentType: string;
  bytes: ArrayBuffer;
}

/** The verbs an authenticated call may use. `PUT` is absent because the protocol has no `PUT`. */
export type AuthorizedMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Builds a {@link SyncRequestError} from a non-2xx response, keeping the server's prose for diagnostics only. */
export async function toRequestError(response: Response): Promise<SyncRequestError> {
  let message = `sync request failed with status ${response.status}`;
  let errorText: string | undefined;
  try {
    const parsed = protocolErrorBodySchema.safeParse(await response.json());
    if (parsed.success) {
      message = parsed.data.error;
      errorText = parsed.data.error;
    }
  } catch {
    // A non-JSON error body is itself diagnostic; the status already carries
    // the meaning a client is allowed to branch on.
  }
  // The body is read BEFORE the kind is decided, for the one documented token
  // that a status cannot express — see `errorKindForStatus`. Everything else
  // still branches on the status alone.
  const kind = errorKindForStatus(response.status, errorText);
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
