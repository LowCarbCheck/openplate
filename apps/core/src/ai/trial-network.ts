/**
 * One caller network's share of the trial accounts' daily ceiling
 * (M270 spec 12, owner's decision 2026-10-01).
 *
 * WHY IT EXISTS. `AI_TRIAL_INSTANCE_DAILY_LIMIT` keeps trial traffic away from
 * the capacity paying accounts use, but inside it every trial account spends
 * from one pool. A trial account may spend `TRIAL_DAILY_AI_LIMIT` units a day
 * (50 in production), so about twenty farmed accounts used up the whole
 * 1000-unit ceiling, and every real new person that day met a refusal on
 * their first scan. Turnstile, the disposable domain list and the trial key
 * make farming slower; they do not bound it.
 *
 * THE BOUND IS PER NETWORK, NOT PER ACCOUNT. One network may spend at most
 * `AI_TRIAL_NETWORK_DAILY_LIMIT` units of the trial ceiling per UTC day, 10
 * percent of it by default. A network is the key `lib/client-address.ts`
 * makes, the same fold every address throttle in this service uses: an IPv6
 * caller is its /64, an IPv4 caller its address. Many people behind one IPv4
 * carrier NAT therefore share one bucket, which is the trade-off the owner
 * accepted; an IPv6 caller gets a /64 of their own.
 *
 * ONLY TRIAL REQUESTS COUNT, the ones that count against the trial ceiling
 * (`ai/proxy.ts`). A paid window and a standing free grant never reach this
 * counter.
 *
 * THE ADDRESS IS NEVER STORED. The row holds an HMAC-SHA256 of the network key
 * under `TRIAL_ADDRESS_PEPPER`, the secret the trial already requires, with
 * its own label so it can never collide with the mailbox hash, and with the
 * UTC day in the input, so two days' rows of one network cannot be linked to
 * each other. The hourly sweep deletes every row before today.
 */
import { createHmac } from 'node:crypto';

/** Turns one network key on one UTC day into the value its counter row is keyed by. */
export type TrialNetworkHasher = (input: { networkKey: string; day: string }) => string;

/** What the proxy needs to apply the share: the bound, and how a network is named in the table. */
export interface TrialNetworkShare {
  /** Units one network may spend per UTC day, `AI_TRIAL_NETWORK_DAILY_LIMIT`. */
  dailyLimit: number;
  hashNetwork: TrialNetworkHasher;
}

/** The share of the trial ceiling one network gets when the operator names no number (owner, 2026-10-01). */
export const DEFAULT_TRIAL_NETWORK_SHARE_PERCENT = 10;

const PERCENT = 100;

/** A domain label, so this HMAC can never collide with another use of the same secret. */
const HASH_LABEL = 'openplate-core/trial-network/v1';

/**
 * The default bound: {@link DEFAULT_TRIAL_NETWORK_SHARE_PERCENT} of the trial
 * ceiling, rounded down, and at least one unit, so a small ceiling still lets
 * every network make a request.
 */
export function defaultTrialNetworkDailyLimit(trialInstanceDailyLimit: number): number {
  return Math.max(1, Math.floor((trialInstanceDailyLimit * DEFAULT_TRIAL_NETWORK_SHARE_PERCENT) / PERCENT));
}

export function createTrialNetworkHasher(pepper: string): TrialNetworkHasher {
  return (input: { networkKey: string; day: string }): string =>
    createHmac('sha256', pepper).update(`${HASH_LABEL}\n${input.day}\n${input.networkKey}`).digest('hex');
}
