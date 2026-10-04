/**
 * Tells the biller that an account is about to be erased, so it cancels every
 * live subscription of that account BEFORE the account is gone.
 *
 * WHY THIS EXISTS (2026-09-30). Until now neither erasure path, the person's
 * own `POST /v1/auth/delete` nor the operator's `DELETE /v1/admin/accounts/:id`,
 * told the biller anything. Only its nightly reconciliation cancelled the
 * orphaned subscription, so one failed night meant a person could be charged
 * after they deleted their account. The nightly job stays as the backstop;
 * this call closes the window in the ordinary case.
 *
 * THE CONTRACT, which the biller implements: `POST {PLANS_UPSTREAM_URL}/erase`
 * (the biller's `/plans/erase`, because `PLANS_UPSTREAM_URL` already ends in
 * `/plans`, exactly as `legal/forward-declaration.ts` reaches
 * `/plans/declarations`), with `X-Plans-Secret` and `X-Account-Id` built by
 * {@link buildPlansAccountHeaders}, the same two headers the plans pass-through
 * sends, and an empty body. The biller answers `204` once every live
 * subscription of that account is cancelled, and also when there is none.
 *
 * IT NEVER THROWS AND NEVER BLOCKS AN ERASURE. A person's right to erasure
 * does not depend on a remote service answering. A timeout (five seconds), a
 * refusal or a dead host is logged at `error` with the account id, which is
 * the correlation handle every other erasure log line carries, and the caller
 * deletes anyway.
 *
 * NOT CALLED AT ALL when no biller stands behind the instance: the auth
 * context and the admin routes then hold `null` instead of a notifier.
 */
import { buildPlansAccountHeaders, type PlansUpstreamConfig } from '../server/plans-proxy.js';
import type { Logger } from '../logger.js';
import { errorFields } from '../log-error.js';

/** How long an erasure waits for the biller before it deletes anyway. */
export const ERASE_NOTIFY_TIMEOUT_MS = 5_000;

/** The path under `PLANS_UPSTREAM_URL`, which already ends in `/plans`. */
export const ERASE_NOTIFY_PATH = '/erase';

/** Called once per erasure, before the account is deleted. Resolves whatever the biller did. */
export type AccountEraseNotifier = (input: { accountId: number }) => Promise<void>;

export interface CreatePlansEraseNotifierOptions {
  upstream: PlansUpstreamConfig;
  logger: Logger;
  /** Defaults to {@link ERASE_NOTIFY_TIMEOUT_MS}. A test passes milliseconds so it does not wait five seconds. */
  timeoutMs?: number;
}

export function createPlansEraseNotifier(options: CreatePlansEraseNotifierOptions): AccountEraseNotifier {
  const timeoutMs = options.timeoutMs ?? ERASE_NOTIFY_TIMEOUT_MS;
  const target = `${options.upstream.baseUrl}${ERASE_NOTIFY_PATH}`;

  return async function notifyAccountErased(input: { accountId: number }): Promise<void> {
    let status: number;
    try {
      const response = await fetch(target, {
        method: 'POST',
        headers: buildPlansAccountHeaders({ secret: options.upstream.secret, accountId: input.accountId }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      await response.body?.cancel();
    } catch (cause) {
      options.logger.error('Could not tell the biller about an erasure, deleting anyway', {
        accountId: input.accountId,
        ...errorFields(cause),
      });
      return;
    }
    if (status !== 204) {
      options.logger.error('The biller refused an erasure notice, deleting anyway', {
        accountId: input.accountId,
        status,
      });
      return;
    }
    options.logger.info('The biller cancelled the subscriptions of an erased account', { accountId: input.accountId });
  };
}
