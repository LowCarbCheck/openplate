/**
 * The bound on what accounts on a FREE grant may spend (2026-10-07), opt in.
 *
 * WHY IT EXISTS. Until the free tier, the only unpaid traffic of the managed
 * instance was the scan trial, and it had two bounds of its own: a ceiling of
 * its own (`AI_TRIAL_INSTANCE_DAILY_LIMIT`) and one network's share of it
 * (`AI_TRIAL_NETWORK_DAILY_LIMIT`, `ai/trial-network.ts`). A standing free
 * grant replaces the trial (`DEFAULT_FREE_WEEKLY_AI_LIMIT` refuses to boot
 * beside it), so with the trial settings gone, free requests would share
 * `AI_INSTANCE_DAILY_LIMIT` with paying people, and twenty farmed free
 * accounts on one network could spend what the paying ones need. The two
 * settings here give the free tier the same two bounds:
 *
 *  - `AI_FREE_INSTANCE_DAILY_LIMIT`: the requests ALL free-grant accounts may
 *    spend per UTC day, counted in `ai_instance_days.free_count`. Set, free
 *    requests stop counting against `AI_INSTANCE_DAILY_LIMIT`, so that
 *    ceiling is the paying accounts' alone, exactly as a trial ceiling takes
 *    trial requests out of it. The provider spend of one day is then bounded
 *    by the sum of the two.
 *  - `AI_FREE_NETWORK_DAILY_LIMIT`: the requests one caller network (an IPv6
 *    /64 or one IPv4 address, `lib/client-address.ts`) may spend per UTC day
 *    on free grants, counted in `ai_free_network_days`.
 *
 * Each is a positive integer, and UNSET MEANS OFF: no statement is issued, no
 * row is written, and nothing is refused, so a self-hosted instance that sets
 * neither behaves exactly as before. A refusal is the instance ceiling's own
 * `503 ai-instance-ceiling` with `Retry-After` at the next 00:00 UTC, so a
 * client needs no new branch, and the person's own unit is never taken.
 *
 * WHICH REQUESTS ARE FREE TRAFFIC: those on the free grant with no live paid
 * window ({@link isFreeTraffic}). A paying account held to its own larger free
 * grant by the paid floor (`accounts/ai-allowance.ts`) is paying, and is not
 * bounded here.
 *
 * THE ADDRESS IS NEVER STORED. The row holds an HMAC-SHA256 of the network key
 * and the UTC day under `SERVER_SECRET`, with a label of its own, so it can
 * never collide with another use of the secret, and one network's rows on two
 * days cannot be linked. The hourly sweep deletes every row before today.
 */
import { createHmac } from 'node:crypto';
import type { TrialNetworkHasher } from './trial-network.js';

/** What the proxy needs to apply the free bounds. Each part is `null` when its setting is unset. */
export interface FreeBound {
  /** `AI_FREE_INSTANCE_DAILY_LIMIT`: requests per UTC day for every free account together. */
  instanceDailyLimit: number | null;
  /** `AI_FREE_NETWORK_DAILY_LIMIT` and how a network is named in its table, or `null`. */
  network: { dailyLimit: number; hashNetwork: TrialNetworkHasher } | null;
}

/** No bound at all: what every instance that sets neither variable gets. */
export const NO_FREE_BOUND: FreeBound = { instanceDailyLimit: null, network: null };

/** A domain label, so this HMAC can never collide with another use of `SERVER_SECRET`. */
const HASH_LABEL = 'openplate-core/free-network/v1';

export function createFreeNetworkHasher(serverSecret: string): TrialNetworkHasher {
  return (input: { networkKey: string; day: string }): string =>
    createHmac('sha256', serverSecret).update(`${HASH_LABEL}\n${input.day}\n${input.networkKey}`).digest('hex');
}

/**
 * Whether a request is free traffic: the allowance picked the free grant AND
 * no paid window runs. The paid floor can pick the free grant for a paying
 * account; that account is not bounded as free.
 */
export function isFreeTraffic(input: { allowanceKind: string; isPaidWindowLive: boolean }): boolean {
  return input.allowanceKind === 'free' && !input.isPaidWindowLive;
}
