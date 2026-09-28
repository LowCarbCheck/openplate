/**
 * Forwards a batch of food proposals to LowCarbCheck (M251 spec 04).
 *
 * THE OPENPLATE SERVER IS THE RELAY because it holds the key. LowCarbCheck's
 * proposal endpoint accepts keyed servers only and refuses any request that
 * carries a browser `Origin`, so a page could not send these itself, and must
 * not: the key would be on the page. `openplate-core` is not involved.
 *
 * FAILS SILENTLY TOWARD THE PERSON. A proposal is a contribution, never part
 * of logging a meal, so nothing here throws and the route answers the page the
 * same way whatever LowCarbCheck said. The outcome is logged for the operator,
 * with the key's display prefix and never the key.
 *
 * ONE RETRY AT MOST, and only for weather: a network failure or a 5xx. A 4xx
 * is LowCarbCheck's answer about this batch or this key, and asking again
 * would get the same answer.
 */
import { createComponentLogger } from '#app/lib/logger';

import type { FoodProposal } from './proposals';
import { foodDbKeyDisplayPrefix, foodDbRequestHeaders } from './request';

const logger = createComponentLogger('food-proposals');

/** How long one attempt may take. A proposal is never worth holding a request open for. */
const REQUEST_TIMEOUT_MS = 10_000;

/** One attempt, and one retry for weather. */
const MAX_ATTEMPTS = 2;

/** What happened to a batch, for the log line and the unit test, never for the person. */
export type ProposalForwardOutcome = 'accepted' | 'refused' | 'failed';

/** The subset of `fetch` this module uses, so a test can hand in a fake. */
export type ProposalFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The upstream address proposals are posted to.
 *
 * @param apiUrl - `CONFIG.foodDb.apiUrl`, without a trailing slash.
 * @returns the proposal endpoint.
 */
export function foodProposalsUrl(apiUrl: string): string {
  return `${apiUrl}/api/v1/foods/proposals`;
}

/**
 * Posts `{ proposals }` to LowCarbCheck with the instance key.
 *
 * @param options.proposals - the wire proposals, already rebuilt by `toWireProposal`.
 * @param options.apiUrl - `CONFIG.foodDb.apiUrl`.
 * @param options.apiKey - `CONFIG.foodDb.apiKey`; backfill is never on without one.
 * @param options.fetchImpl - the fetch to use, the global one in production.
 * @returns what LowCarbCheck did with the batch.
 */
export async function forwardFoodProposals(options: {
  proposals: readonly FoodProposal[];
  apiUrl: string;
  apiKey: string | null;
  fetchImpl?: ProposalFetch;
}): Promise<ProposalForwardOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = foodDbRequestHeaders({ apiKey: options.apiKey });
  headers.set('content-type', 'application/json');
  const body = JSON.stringify({ proposals: options.proposals });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(foodProposalsUrl(options.apiUrl), {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      logger.debug('LowCarbCheck proposal request failed', { attempt });
      continue;
    }
    if (response.ok) {
      logger.info('LowCarbCheck accepted food proposals', { count: options.proposals.length });
      return 'accepted';
    }
    if (response.status < 500) {
      logger.warn('LowCarbCheck refused food proposals', {
        status: response.status,
        count: options.proposals.length,
        keyPrefix: foodDbKeyDisplayPrefix(options.apiKey),
      });
      return 'refused';
    }
    logger.debug('LowCarbCheck proposal request returned a server error', { status: response.status, attempt });
  }
  return 'failed';
}
