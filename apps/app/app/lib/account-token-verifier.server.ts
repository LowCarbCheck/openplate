/**
 * Asks openplate-core whether an account access token is live, and remembers
 * the answer for a few minutes.
 *
 * ── Why this server asks at all ──────────────────────────────────────────
 *
 * This app holds no accounts (ADR-0006), but on a MANAGED instance it holds
 * something an account protects: the LowCarbCheck key, whose allowance every
 * food lookup spends. An unauthenticated `/api/food-matches` let anyone on the
 * internet spend it. So on a managed instance the page sends the same bearer
 * it already sends to core, and this server asks core whether it is live
 * before any lookup leaves. The token is never stored, only a SHA-256 of it,
 * as the cache key.
 *
 * ── Which read ───────────────────────────────────────────────────────────
 *
 * `GET /v1/auth/account`. It is the one authenticated read core mounts on
 * every instance, it sits behind `requireAuth` and nothing else (no consent
 * gate, so an account that has not agreed yet is still an account), and it
 * answers `401` for an absent, unknown, expired or revoked token and `403` for
 * a suspended account. `/v1/push/config` is cheaper but exists only where push
 * is configured and sits behind the consent gate, so it would answer "no" for
 * reasons that are not about the token.
 *
 * ── Three answers ────────────────────────────────────────────────────────
 *
 *  - `valid`: core answered `200` with an account. Cached for five minutes, so
 *    a search-as-you-type session costs core one read, not one per keystroke.
 *    A revoked token therefore keeps searching for at most that long, which is
 *    the price of not asking core on every keystroke.
 *  - `invalid`: core answered `401` or `403`. Cached for one minute, so a
 *    caller replaying a dead token does not turn every request into a read on
 *    core, and a token that was refused for a moment (a clock skew, a
 *    rotation) recovers quickly.
 *  - `unavailable`: anything else, a network failure, a timeout, a `5xx`, or a
 *    `200` that carries no account (a `SYNC_SERVER_URL` that points at the
 *    wrong thing). Never cached: it says nothing about the token, and the
 *    caller fails CLOSED on it.
 *
 * ── Bounded ──────────────────────────────────────────────────────────────
 *
 * The cache holds at most `maxEntries` hashes and drops the oldest first, the
 * same insertion-order eviction the food-resolution cache uses. A flood of
 * random tokens can push real sessions out, which costs each of them one more
 * read on core, never a wrong answer.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

/** What core said about a token. See the module header for each answer. */
export type AccountTokenVerdict = 'valid' | 'invalid' | 'unavailable';

/** The subset of `fetch` this module uses, so a test can hand in a fake. */
export type AccountFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Core's account read, appended to `SYNC_SERVER_URL`. */
export const ACCOUNT_READ_PATH = '/v1/auth/account';

/** How long a live token is believed without asking again. */
export const VALID_TOKEN_TTL_MS = 5 * 60 * 1000;

/** How long a refused token is refused without asking again. */
export const INVALID_TOKEN_TTL_MS = 60 * 1000;

/** The most token hashes held at once. */
export const MAX_CACHED_TOKENS = 2000;

/** How long one read on core may take before the answer is `unavailable`. */
const CORE_TIMEOUT_MS = 3000;

/**
 * The longest token accepted from a header. Core's access tokens are a few
 * dozen characters; the ceiling only stops a megabyte header from being hashed
 * and forwarded.
 */
const MAX_TOKEN_LENGTH = 512;

/** `Bearer <token>`, the scheme in any case, one token with no whitespace or comma in it. */
const BEARER_PATTERN = /^bearer +([^\s,]+)$/i;

/**
 * The token in an `Authorization` header, or `null` when there is none or the
 * header is not one bearer token.
 *
 * @param header - the raw header value, or `null` when absent.
 */
export function parseBearerToken(header: string | null): string | null {
  if (header === null) return null;
  const match = BEARER_PATTERN.exec(header.trim());
  const token = match?.[1];
  if (token === undefined || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

/** A cached verdict. `unavailable` is never cached, see the module header. */
interface CachedVerdict {
  verdict: 'valid' | 'invalid';
  expiresAt: number;
}

/** Everything a verifier needs; every boundary is injectable for the unit tests. */
export interface AccountTokenVerifierOptions {
  /** `CONFIG.sync.syncServerUrl`, without a trailing slash. */
  syncServerUrl: string;
  fetchImpl?: AccountFetch;
  now?: () => number;
  maxEntries?: number;
}

/** A verifier with its own cache. */
export interface AccountTokenVerifier {
  /** Core's verdict on `token`, from the cache when it holds a live one. */
  verify(token: string): Promise<AccountTokenVerdict>;
  /** Forgets every cached verdict. TEST SEAM. */
  clear(): void;
}

/** The cache key for a token: its SHA-256, so no token is ever held in memory past its request. */
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The part of core's `GET /v1/auth/account` answer this check relies on: an
 * account with an id. Everything else in the account view is ignored.
 */
const accountReadSchema = z.object({ account: z.object({ id: z.number() }) });

/** Whether core's `200` body carries an account, the proof that this was core's account read. */
async function carriesAccount(response: Response): Promise<boolean> {
  const body: z.infer<ReturnType<typeof z.json>> | null = await response.json().catch(() => null);
  return accountReadSchema.safeParse(body).success;
}

/** One read on core, mapped to a verdict. Never throws. */
async function askCore(options: { url: string; token: string; fetchImpl: AccountFetch }): Promise<AccountTokenVerdict> {
  let response: Response;
  try {
    response = await options.fetchImpl(options.url, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${options.token}` },
      signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
    });
  } catch {
    return 'unavailable';
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    return 'invalid';
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    return 'unavailable';
  }
  return (await carriesAccount(response)) ? 'valid' : 'unavailable';
}

/**
 * A verifier with an empty cache.
 *
 * Concurrent checks of one token share one read on core: the first starts it
 * and the rest wait on the same promise.
 */
export function createAccountTokenVerifier(options: AccountTokenVerifierOptions): AccountTokenVerifier {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? MAX_CACHED_TOKENS;
  const url = `${options.syncServerUrl}${ACCOUNT_READ_PATH}`;
  const cache = new Map<string, CachedVerdict>();
  const inFlight = new Map<string, Promise<AccountTokenVerdict>>();

  function remember(key: string, verdict: AccountTokenVerdict): void {
    if (verdict === 'unavailable') return;
    const ttl = verdict === 'valid' ? VALID_TOKEN_TTL_MS : INVALID_TOKEN_TTL_MS;
    cache.delete(key);
    cache.set(key, { verdict, expiresAt: now() + ttl });
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) return;
      cache.delete(oldest);
    }
  }

  async function verify(token: string): Promise<AccountTokenVerdict> {
    const key = tokenHash(token);
    const cached = cache.get(key);
    if (cached !== undefined && cached.expiresAt > now()) return cached.verdict;
    if (cached !== undefined) cache.delete(key);

    const pending = inFlight.get(key);
    if (pending !== undefined) return pending;

    const read = askCore({ url, token, fetchImpl })
      .then((verdict) => {
        remember(key, verdict);
        return verdict;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, read);
    return read;
  }

  return {
    verify,
    clear() {
      cache.clear();
      inFlight.clear();
    },
  };
}
