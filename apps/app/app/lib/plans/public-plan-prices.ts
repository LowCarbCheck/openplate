/**
 * WHAT OPENPLATE COSTS, read before anybody has an account (2026-09-28).
 *
 * The sign-up screen and the logged-out landing say what the service costs
 * once the free scans are used up. They cannot read the offer (M245/03): that
 * route is authenticated and carries the order texts. So the core serves the
 * two gross prices anonymously at `GET /v1/plans/prices`
 * (`PLAN_PRICES_PATH` in `plans-wire.ts`), and this module reads them.
 *
 * ── NO PRICE LIVES HERE ──────────────────────────────────────────────────
 *
 * The figures arrive as `grossCents` and leave as figures. This repository is
 * public, and the price belongs to the biller's configuration, so no amount
 * is typed anywhere in the app; `plan-prices.ts` formats what arrives.
 *
 * ── ASKED ONLY WHERE THE HANDSHAKE SAYS PLANS ARE SOLD ───────────────────
 *
 * `PROTOCOL.md` §5.22 has a client read `instance.plans` before it offers a
 * plan door, never probe the path. The callers ask `hasPlansDoor`
 * first, so a 404 here is a core older than the route, not an instance with
 * nothing to sell.
 *
 * ── FAILS OPEN, TO THE SENTENCE WITHOUT A PRICE ──────────────────────────
 *
 * An unreachable core, a 404, a body that does not decode, a currency the
 * two plans do not share, or a missing plan all answer `null`, and the screen
 * says "you need a paid plan" instead of a figure. A half-read price is the
 * one thing a page about money may never show. A body that does not decode is
 * logged, because a renamed field is the most likely way this breaks.
 *
 * ── ONE READ PER TAB, AND A FAILURE IS NOT KEPT ──────────────────────────
 *
 * The landing and `/sign-up` both ask, usually one navigation apart, so an
 * answer is kept at module scope per server. The core also sends
 * `Cache-Control: public, max-age=300`, so a document load inside five minutes
 * is answered by the browser. A failed read is forgotten once it settles, so a
 * later screen asks again instead of repeating a transient failure all tab.
 */
import type { JsonValue } from '#app/lib/sync/engine/protocol';
import { defaultFetchImpl } from '#app/lib/sync/engine/client/fetch-impl';
import { PLAN_PRICES_PATH, planPricesSchema, type PlanPrices } from '#app/lib/sync/engine/client/plans-wire';
import { createComponentLogger } from '#app/lib/logger';

const log = createComponentLogger('public-plan-prices');

/** The two prices a screen states, in minor units, and the currency they share. */
export interface PublicPlanPrices {
  currency: string;
  monthlyCents: number;
  yearlyCents: number;
}

/**
 * The two figures a sentence names, or `null` when the body does not carry
 * both. The schema has already checked that each key bills at its interval.
 */
export function publicPlanPricesOf(body: PlanPrices): PublicPlanPrices | null {
  const monthly = body.plans.find((plan) => plan.key === 'monthly');
  const yearly = body.plans.find((plan) => plan.key === 'yearly');
  if (monthly === undefined || yearly === undefined) return null;
  return { currency: body.currency, monthlyCents: monthly.grossCents, yearlyCents: yearly.grossCents };
}

/**
 * Asks one core for its prices. Never rejects.
 *
 * @param input.serverUrl - the sync server this app talks to.
 * @param input.fetchImpl - the fetch to use; a unit test passes its own.
 */
export async function readPublicPlanPrices({
  serverUrl,
  fetchImpl = defaultFetchImpl,
}: {
  serverUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<PublicPlanPrices | null> {
  let body: JsonValue;
  try {
    const response = await fetchImpl(`${serverUrl}${PLAN_PRICES_PATH}`, { method: 'GET' });
    if (!response.ok) return null;
    body = await response.json();
  } catch {
    // Unreachable, or a body that is not JSON. Both are the sentence with no price.
    return null;
  }
  const decoded = planPricesSchema.safeParse(body);
  if (!decoded.success) {
    log.error('the plan prices did not match their schema', { path: PLAN_PRICES_PATH });
    return null;
  }
  return publicPlanPricesOf(decoded.data);
}

/** One read per server URL, in flight or answered with prices. */
const pricesCache = new Map<string, Promise<PublicPlanPrices | null>>();

/**
 * The prices of one core, read at most once per tab while the answer is good.
 * Never rejects.
 */
export function readCachedPublicPlanPrices(serverUrl: string): Promise<PublicPlanPrices | null> {
  const cached = pricesCache.get(serverUrl);
  if (cached !== undefined) return cached;
  const read = readPublicPlanPrices({ serverUrl });
  pricesCache.set(serverUrl, read);
  void forgetFailure({ serverUrl, read });
  return read;
}

/** Drops a read that answered nothing, so the next screen asks again. */
async function forgetFailure({
  serverUrl,
  read,
}: {
  serverUrl: string;
  read: Promise<PublicPlanPrices | null>;
}): Promise<void> {
  const prices = await read;
  if (prices === null && pricesCache.get(serverUrl) === read) pricesCache.delete(serverUrl);
}
