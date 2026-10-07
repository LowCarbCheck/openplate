/**
 * What is left on the provider key, read from the provider (2026-09-30).
 *
 * ── THE KEY READ IS THE SOURCE, NOT THE PER-REQUEST COST ────────────────────
 * An answer from the provider carries what THAT request cost, never what the
 * key has left. OpenRouter publishes the rest at `GET <base>/key` with the same
 * bearer the proxy forwards with: the limit, what remains of it, when it resets
 * and what was spent today, this week and this month, in dollars. The call is
 * free. So the operator's budget is read there, and nothing here adds up
 * request costs.
 *
 * ── PARSED FIELD BY FIELD, NEVER PASSED THROUGH ─────────────────────────────
 * {@link parseOpenRouterKeyBody} names every field it keeps and reads nothing
 * else. The body also carries the key's `label`, which is the operator's own
 * name for the key and can hold part of it, and a free-tier flag. Neither is
 * read, so neither can reach a response or a log line. A body that does not
 * parse is an unavailable read, not a partial one.
 *
 * ── CACHED, BECAUSE A CONSOLE RELOAD IS NOT A REASON TO ASK AGAIN ───────────
 * A successful read is kept 60 seconds and a failed one 15, so a provider
 * that is down is asked again soon without being asked on every page load.
 * Two reads that overlap share one request. The clock is injected, like every
 * clock in this service, so a test moves time rather than waiting for it.
 *
 * ── THE KEY NEVER LEAVES THIS MODULE'S REQUEST ──────────────────────────────
 * It is the bearer on the one `fetch` below. A failure is logged with the HTTP
 * status or the error's name, never its message, which could echo a URL, and
 * never the body.
 */
import { asNumber, asObject, asString, type JsonValue } from '../lib/json.js';
import type { Logger } from '../logger.js';
import { isOpenRouterUpstream } from './chat-body-policy.js';
import type { AiUpstreamConfig } from './proxy.js';
import { stripTrailingSlashes } from '../lib/trailing-slashes.js';

/** How often the provider resets the key's limit. `null` is a limit that never resets on its own. */
export type UpstreamBudgetReset = 'daily' | 'weekly' | 'monthly';

/** The three periods OpenRouter names, in one list so the parser and the type cannot drift. */
const UPSTREAM_BUDGET_RESETS: readonly UpstreamBudgetReset[] = ['daily', 'weekly', 'monthly'];

/** What the key read yields, in dollars. Every field is named here and nothing else crosses. */
export interface UpstreamKeyBudget {
  /** The key's spending limit, or `null` for a key with no limit. */
  limitUsd: number | null;
  /** What is left of that limit, or `null` when the key has none. */
  remainingUsd: number | null;
  /** When the limit resets, or `null` for never. A period OpenRouter adds later reads as `null` too. */
  reset: UpstreamBudgetReset | null;
  usageDailyUsd: number;
  usageWeeklyUsd: number;
  usageMonthlyUsd: number;
}

/** One read, successful or not, with the time it was made. */
export type UpstreamBudgetRead =
  { status: 'ok'; budget: UpstreamKeyBudget; checkedAt: Date } | { status: 'unavailable'; checkedAt: Date };

/** What the admin route and the alert timer read. The cached source and the watch around it both answer it. */
export interface UpstreamBudgetSource {
  read(): Promise<UpstreamBudgetRead>;
}

/** The longest one key read may take. A console waits for it, so it is short. */
export const UPSTREAM_BUDGET_TIMEOUT_MS = 5000;

/** How long a successful read is served from memory. */
export const UPSTREAM_BUDGET_OK_TTL_MS = 60_000;

/** How long a failed read is served from memory, shorter so a recovered provider shows soon. */
export const UPSTREAM_BUDGET_FAILED_TTL_MS = 15_000;

/** `<base>/key`, the OpenRouter route that describes the bearer's own key. */
export function openRouterKeyUrl(baseUrl: string): string {
  return `${stripTrailingSlashes(baseUrl)}/key`;
}

/**
 * The key read's URL for this upstream, or `null` when the upstream is not
 * OpenRouter. Another provider has no such route, so the console hides the
 * budget rather than calling something that does not exist.
 */
export function upstreamBudgetKeyUrl(upstream: AiUpstreamConfig): string | null {
  return isOpenRouterUpstream(upstream.baseUrl) ? openRouterKeyUrl(upstream.baseUrl) : null;
}

/** A dollar amount: a finite number, or `null` for anything else. */
function asDollars(value: JsonValue | undefined): number | null {
  const parsed = asNumber(value);
  return parsed !== null && Number.isFinite(parsed) ? parsed : null;
}

/** A field that may be `null` on the wire: `undefined` when it is present and malformed, so the parse can refuse it. */
function asNullableDollars(value: JsonValue | undefined): number | null | undefined {
  if (value === null) return null;
  return asDollars(value) ?? undefined;
}

function asReset(value: JsonValue | undefined): UpstreamBudgetReset | null {
  const raw = asString(value);
  return UPSTREAM_BUDGET_RESETS.find((reset) => reset === raw) ?? null;
}

/**
 * OpenRouter's `GET /key` answer, `{ data: { limit, limit_remaining,
 * limit_reset, usage_daily, usage_weekly, usage_monthly, ... } }`, as the
 * fields this service keeps, or `null` when the body is not that.
 *
 * `limit` and `limit_remaining` must be a number or `null`, and the three
 * usage figures a number. An absent field is a refusal, not a zero: a
 * console that showed "$0 spent" for a field the provider stopped sending
 * would say something false about the operator's bill.
 */
export function parseOpenRouterKeyBody(body: JsonValue): UpstreamKeyBudget | null {
  const data = asObject(asObject(body)?.data);
  if (data === null) return null;
  const limitUsd = asNullableDollars(data.limit);
  const remainingUsd = asNullableDollars(data.limit_remaining);
  const usageDailyUsd = asDollars(data.usage_daily);
  const usageWeeklyUsd = asDollars(data.usage_weekly);
  const usageMonthlyUsd = asDollars(data.usage_monthly);
  if (limitUsd === undefined || remainingUsd === undefined) return null;
  if (usageDailyUsd === null || usageWeeklyUsd === null || usageMonthlyUsd === null) return null;
  return {
    limitUsd,
    remainingUsd,
    reset: asReset(data.limit_reset),
    usageDailyUsd,
    usageWeeklyUsd,
    usageMonthlyUsd,
  };
}

/** The part of `fetch` the source uses. Injected so a test can count calls and answer without a network. */
export type FetchKey = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

export interface CreateUpstreamBudgetSourceOptions {
  /** `upstreamBudgetKeyUrl(...)`, already known to be OpenRouter's. */
  keyUrl: string;
  /** `UPSTREAM_API_KEY`. The bearer of the one request below, and nowhere else. */
  apiKey: string;
  logger: Logger;
  now: () => Date;
  fetchKey?: FetchKey;
  timeoutMs?: number;
  okTtlMs?: number;
  failedTtlMs?: number;
}

/** A read and the instant it stops being served. */
interface CachedRead {
  read: UpstreamBudgetRead;
  expiresAt: number;
}

/** The source's memory: the last read, and the request in flight, if any. */
interface BudgetCache {
  entry: CachedRead | null;
  inFlight: Promise<UpstreamBudgetRead> | null;
}

/** Why a read failed, in words a log may carry: a status, or an error's name. Never a message or a body. */
class KeyReadFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'KeyReadFailure';
  }
}

const defaultFetchKey: FetchKey = (url, init) => fetch(url, init);

/** The cached key read. See the module header for the two lifetimes and the shared request. */
export function createUpstreamBudgetSource(options: CreateUpstreamBudgetSourceOptions): UpstreamBudgetSource {
  const fetchKey = options.fetchKey ?? defaultFetchKey;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_BUDGET_TIMEOUT_MS;
  const okTtlMs = options.okTtlMs ?? UPSTREAM_BUDGET_OK_TTL_MS;
  const failedTtlMs = options.failedTtlMs ?? UPSTREAM_BUDGET_FAILED_TTL_MS;
  const cache: BudgetCache = { entry: null, inFlight: null };

  async function fetchBudget(): Promise<UpstreamKeyBudget> {
    let response: Response;
    try {
      response = await fetchKey(options.keyUrl, {
        headers: { Authorization: `Bearer ${options.apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new KeyReadFailure(cause instanceof Error ? cause.name : 'unknown error');
    }
    if (!response.ok) {
      // Not read: an error body may echo the request, and the request carried the key.
      await response.body?.cancel();
      throw new KeyReadFailure(`status ${response.status}`);
    }
    let body: JsonValue;
    try {
      // SAFETY: `Response.json()` yields parsed JSON, which is `JsonValue` by
      // construction; the parse below proves every field it keeps.
      body = (await response.json()) as JsonValue;
    } catch {
      throw new KeyReadFailure('body is not JSON');
    }
    const budget = parseOpenRouterKeyBody(body);
    if (budget === null) throw new KeyReadFailure('body does not match the key read');
    return budget;
  }

  async function readFresh(): Promise<UpstreamBudgetRead> {
    const checkedAt = options.now();
    try {
      const budget = await fetchBudget();
      const read: UpstreamBudgetRead = { status: 'ok', budget, checkedAt };
      cache.entry = { read, expiresAt: checkedAt.getTime() + okTtlMs };
      return read;
    } catch (cause) {
      options.logger.warn('Upstream key read failed', {
        reason: cause instanceof KeyReadFailure ? cause.reason : 'unexpected error',
      });
      const read: UpstreamBudgetRead = { status: 'unavailable', checkedAt };
      cache.entry = { read, expiresAt: checkedAt.getTime() + failedTtlMs };
      return read;
    }
  }

  return {
    async read(): Promise<UpstreamBudgetRead> {
      const cached = cache.entry;
      if (cached !== null && options.now().getTime() < cached.expiresAt) return cached.read;
      if (cache.inFlight !== null) return cache.inFlight;
      const pending = readFresh();
      cache.inFlight = pending;
      try {
        return await pending;
      } finally {
        cache.inFlight = null;
      }
    },
  };
}
