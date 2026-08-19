/**
 * Generic browser-only OAuth 2.0 PKCE client (M127/02) — the mechanics of
 * "start a code_verifier/state pair, redirect, and exchange the callback
 * `code` for a provider-issued key" factored out so it isn't OpenRouter-
 * specific. A provider is described purely by an `OAuthPkceConfig` (its
 * authorize/exchange endpoints and the app-local callback path); the flow
 * itself never hardcodes a provider name.
 *
 * SECURITY: this module deliberately never logs the verifier, the state, the
 * authorization `code`, or the issued key — not in a thrown error message,
 * not truncated, not anywhere. Same rule as `#app/services/vision/verify-key`,
 * which this mirrors: no dependency on `#app/lib/logger` (pino's dev
 * pretty-transport touches `process.stdout` at module init, which throws in a
 * browser bundle), and every caught error becomes a typed, generic-copy
 * `OAuthPkceError` — never the raw provider response.
 *
 * STORAGE: the pending flow (`verifier`/`state`/`createdAt`) is kept in
 * `localStorage`, NOT `sessionStorage` — per the M127/01 spike's counsel,
 * `sessionStorage` does not reliably survive the cross-origin round trip in
 * an installed PWA (backgrounding on iOS can tear down the session storage
 * before the provider redirects back). `localStorage` is shared across tabs,
 * which is why the "multi-tab last-write-wins" behavior below is a deliberate
 * accepted trade-off, not a bug: a second `beginConnect()` call overwrites the
 * first tab's pending flow, and that first tab's own callback then fails with
 * `state-mismatch` — a safe failure (never a wrong key on the wrong flow),
 * with a plain "try connecting again" recovery.
 *
 * TESTABILITY: every impure dependency (storage, `fetch`, `crypto`, the
 * clock, `window.location.origin`) is injectable via the `deps` parameter so
 * `beginConnect`/`exchangeCode` unit-test under plain `node:test` with no
 * jsdom — the defaults only resolve `globalThis.localStorage`/`.crypto`/
 * `.fetch`/`window.location` when actually called, so importing this module
 * from a server-side (Node) context is always safe; only invoking it without
 * injected deps outside a browser throws.
 *
 * CSP: the exchange POST (`OPENROUTER_OAUTH_CONFIG.exchangeUrl`, on
 * `openrouter.ai`) is already covered by `server.ts`'s `connect-src`, which
 * has allowlisted `https://openrouter.ai` since M117/02 for the existing
 * BYOK vision calls — no change needed for this module's own network call.
 * The authorize-page redirect (`beginConnect`'s `redirectUrl`) is a top-level
 * navigation (`window.location.href = ...`), which `connect-src` never
 * governs in the first place.
 */
import { z } from 'zod';

/** Where a provider's PKCE endpoints live, plus the app-local callback route it redirects back to. */
export interface OAuthPkceConfig {
  /** The provider's user-facing consent/authorize page (full-page redirect target). */
  readonly authorizeUrl: string;
  /** The provider's token-exchange endpoint (POSTed to directly from the browser). */
  readonly exchangeUrl: string;
  /** This app's callback route path (e.g. `/oauth/openrouter/callback`) — combined with `window.location.origin` to build `callback_url`. */
  readonly callbackPath: string;
}

/** OpenRouter's PKCE endpoints (M127/01 spike: browser-`fetch`-reachable, CORS-enabled, arbitrary `callback_url` accepted). */
export const OPENROUTER_OAUTH_CONFIG: OAuthPkceConfig = {
  authorizeUrl: 'https://openrouter.ai/auth',
  exchangeUrl: 'https://openrouter.ai/api/v1/auth/keys',
  callbackPath: '/oauth/openrouter/callback',
};

/**
 * Every way `exchangeCode` (and the callback route reading its inputs) can
 * fail, each mapped to its own novice-phrased copy and retry affordance by
 * the callback route — see spec 02's UX doc.
 * - `denied` — the provider redirected back with no `code` (the user declined
 *   consent or cancelled).
 * - `missing-verifier` — no pending flow found in storage (expected after
 *   context loss — e.g. an installed iOS PWA reclaiming the page while the
 *   user was on the provider's site — or a stale/replayed callback URL).
 * - `state-mismatch` — the stored flow's `state` doesn't match the callback's
 *   `state` (a second `beginConnect()` overwrote it — multi-tab — or the URL
 *   was tampered with). Deliberately never clears storage on this path — the
 *   entry present may belong to a different, still-valid pending flow.
 * - `expired` — the stored flow is older than the TTL.
 * - `exchange-failed` — the exchange POST itself failed (network error, or
 *   the provider rejected the code/verifier pair).
 */
export type OAuthPkceErrorCode = 'denied' | 'missing-verifier' | 'state-mismatch' | 'expired' | 'exchange-failed';

/** Thrown by `exchangeCode` with a machine-readable `code` the callback route branches its copy on. */
export class OAuthPkceError extends Error {
  readonly code: OAuthPkceErrorCode;

  constructor(code: OAuthPkceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OAuthPkceError';
    this.code = code;
  }
}

/** Minimal storage contract `beginConnect`/`exchangeCode` need — satisfied by `localStorage`, or a plain object in tests. */
export interface OAuthPkceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Injectable seams so the flow is fully testable without a browser (`node:test`, no jsdom). */
export interface OAuthPkceDeps {
  storage?: OAuthPkceStorage;
  fetchImpl?: typeof fetch;
  /** Defaults to `window.location.origin` — only read when actually invoked. */
  origin?: string;
  now?: () => number;
  randomBytes?: (byteLength: number) => Uint8Array;
  digestSha256?: (data: Uint8Array) => Promise<ArrayBuffer>;
}

const STORAGE_KEY = 'openplate:oauth-flow';
const FLOW_TTL_MS = 10 * 60 * 1000;
const VERIFIER_BYTE_LENGTH = 32; // -> 43-char base64url string, well above PKCE's 43-char minimum.
const STATE_BYTE_LENGTH = 16;

const storedFlowSchema = z.object({
  verifier: z.string(),
  state: z.string(),
  createdAt: z.number(),
});

type StoredFlow = z.infer<typeof storedFlowSchema>;

function resolveStorage(storage: OAuthPkceStorage | undefined): OAuthPkceStorage {
  const resolved = storage ?? globalThis.localStorage;
  if (!resolved) {
    throw new Error('oauth-pkce requires localStorage (or an injected `deps.storage`) — this module is browser-only.');
  }
  return resolved;
}

function resolveFetch(fetchImpl: typeof fetch | undefined): typeof fetch {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (!resolved) {
    throw new Error('oauth-pkce requires `fetch` (or an injected `deps.fetchImpl`).');
  }
  return resolved;
}

function defaultRandomBytes(byteLength: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(byteLength));
}

async function defaultDigestSha256(data: Uint8Array): Promise<ArrayBuffer> {
  // SAFETY: `TextEncoder` always yields an ArrayBuffer-backed view, so narrowing
  // the generic is sound — `digest` rejects only SharedArrayBuffer-backed views.
  return globalThis.crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
}

/** Only referenced when no `deps.origin` is supplied — never at module load. */
function defaultOrigin(): string {
  return window.location.origin;
}

function base64UrlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const array = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let binary = '';
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function readStoredFlow(storage: OAuthPkceStorage): StoredFlow | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed = storedFlowSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function clearStoredFlow(storage: OAuthPkceStorage): void {
  storage.removeItem(STORAGE_KEY);
}

/** The redirect target for the provider's consent screen, plus the `state` embedded in it (informational — already stored). */
export interface BeginConnectResult {
  redirectUrl: string;
  state: string;
}

/**
 * Starts a new PKCE flow: generates a fresh `code_verifier` + `state`,
 * persists them (overwriting any prior pending flow — see the multi-tab note
 * above), and returns the URL to send the browser to. Does NOT navigate
 * itself — the caller (a button's click handler) does
 * `window.location.href = redirectUrl`, keeping this function a pure
 * "compute the next step" call the UI can await before leaving the page.
 */
export async function beginConnect(config: OAuthPkceConfig, deps: OAuthPkceDeps = {}): Promise<BeginConnectResult> {
  const storage = resolveStorage(deps.storage);
  const randomBytes = deps.randomBytes ?? defaultRandomBytes;
  const digestSha256 = deps.digestSha256 ?? defaultDigestSha256;
  const now = deps.now ?? Date.now;
  const origin = deps.origin ?? defaultOrigin();

  const verifier = base64UrlEncode(randomBytes(VERIFIER_BYTE_LENGTH));
  const state = base64UrlEncode(randomBytes(STATE_BYTE_LENGTH));
  const challenge = base64UrlEncode(await digestSha256(new TextEncoder().encode(verifier)));

  const flow: StoredFlow = { verifier, state, createdAt: now() };
  storage.setItem(STORAGE_KEY, JSON.stringify(flow));

  // `state` has no first-class PKCE/OpenRouter parameter — the M127/01 spike
  // confirmed a `state` query param riding inside `callback_url` is preserved
  // verbatim through the round trip, so CSRF binding happens via this
  // embedded param plus the local comparison in `exchangeCode` below.
  const callbackUrl = new URL(config.callbackPath, origin);
  callbackUrl.searchParams.set('state', state);

  const authorizeUrl = new URL(config.authorizeUrl);
  authorizeUrl.searchParams.set('callback_url', callbackUrl.toString());
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  return { redirectUrl: authorizeUrl.toString(), state };
}

/** What the callback route read off the URL — `code` is `null` when the provider indicates the user declined/cancelled consent. */
export interface ExchangeCodeInput {
  code: string | null;
  state: string;
}

export interface ExchangeCodeResult {
  apiKey: string;
}

/** OpenRouter's token-exchange response — only the field this module actually reads. */
const exchangeResponseSchema = z.object({ key: z.string().min(1) });

/**
 * Validates and completes a pending PKCE flow against the callback's `code`/
 * `state`. Single-use by design: the stored flow is deleted on every exit
 * path (success or any failure) so a replayed/stale callback URL can never
 * re-trigger a real exchange — see the callback route's idempotency handling
 * for how a repeat visit is presented to the user (never a raw error).
 *
 * Validation order matters: `state` and the TTL are both checked BEFORE the
 * network call, so a mismatched/expired flow never reaches the provider.
 */
export async function exchangeCode(
  config: OAuthPkceConfig,
  input: ExchangeCodeInput,
  deps: OAuthPkceDeps = {},
): Promise<ExchangeCodeResult> {
  const storage = resolveStorage(deps.storage);
  const fetchImpl = resolveFetch(deps.fetchImpl);
  const now = deps.now ?? Date.now;

  const stored = readStoredFlow(storage);
  // Only true once `state` is confirmed to match — from here on it's safe to
  // mutate/delete the stored entry, because we know it's THIS flow's, not a
  // different (still-pending, still-valid) flow that happens to be occupying
  // the single shared storage slot — see the multi-tab note above.
  const ownsStoredFlow = stored !== null && stored.state === input.state;

  if (input.code === null) {
    if (ownsStoredFlow) clearStoredFlow(storage);
    throw new OAuthPkceError('denied', 'Connection was cancelled — no problem, try again whenever you like.');
  }

  if (stored === null) {
    throw new OAuthPkceError(
      'missing-verifier',
      'This device lost track of the connection attempt — start over and it should go straight through.',
    );
  }

  if (!ownsStoredFlow) {
    // Deliberately does NOT clear storage: the entry present right now may be
    // a DIFFERENT, still-valid flow (a second tab's `beginConnect()` already
    // overwrote this one) — deleting it here would break that other tab's own
    // still-pending exchange. This callback simply fails safely instead.
    throw new OAuthPkceError(
      'state-mismatch',
      "This connection doesn't match the one this device started — try connecting again.",
    );
  }

  if (now() - stored.createdAt > FLOW_TTL_MS) {
    clearStoredFlow(storage);
    throw new OAuthPkceError('expired', 'This connection attempt took too long — try connecting again.');
  }

  let response: Response;
  try {
    response = await fetchImpl(config.exchangeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: input.code,
        code_verifier: stored.verifier,
        code_challenge_method: 'S256',
      }),
    });
  } catch (cause) {
    clearStoredFlow(storage);
    throw new OAuthPkceError(
      'exchange-failed',
      "Couldn't reach the provider to finish connecting — try again in a moment.",
      { cause },
    );
  }

  if (!response.ok) {
    clearStoredFlow(storage);
    throw new OAuthPkceError('exchange-failed', 'The provider rejected the connection attempt — try again.');
  }

  clearStoredFlow(storage);

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new OAuthPkceError(
      'exchange-failed',
      'The provider returned an unexpected response — try connecting again.',
      { cause },
    );
  }

  const parsed = exchangeResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new OAuthPkceError('exchange-failed', "The provider didn't return a usable key — try connecting again.");
  }

  return { apiKey: parsed.data.key };
}
