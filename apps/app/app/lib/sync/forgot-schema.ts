/**
 * `/forgot`'s form, and the two decisions around its one request.
 *
 * ── Its own schema, because it has one field ─────────────────────────────
 *
 * The page used to validate with the SIGN-IN schema, which also requires a
 * password. The form has no password field, so every submission failed on a
 * field nobody could see: the error had nowhere to render, the request was
 * never sent, and the button did nothing at all (2026-09-27 install
 * rehearsal). This schema names the address and nothing else.
 *
 * ── No mail, no request ──────────────────────────────────────────────────
 *
 * The core server says in its `/health` whether it can send mail at all
 * (`instance.mail`). Where it cannot, a reset request would mint a token that
 * no letter ever carries, and "the link is on its way" would be a false
 * promise. What does work there: the administrator makes the link on the
 * person's page in the console (`POST /v1/admin/accounts/:id/reset-mail`
 * answers with it when no letter went), so the page says to ask them.
 *
 * ── The answer still says nothing about the address ──────────────────────
 *
 * The service answers `202` for every address, so that this form cannot ask
 * whether a colleague has an account. Every outcome below is decided without
 * the address: the instance's mail setting, a request that never reached the
 * service, and a refusal (a throttle, a 5xx) that the service gives whatever
 * was typed.
 */
import { z } from 'zod';

import { describeEmailProblem } from './email';
import type { InstanceDescriptor } from './engine/protocol';
import { isSyncRequestError } from './engine/client/sync-error';
import type { Translate } from './setup-flow';

/**
 * The form's schema: one address, checked by the same rules every other
 * address field uses.
 *
 * @param t - the caller's translator.
 */
export function makeForgotPasswordSchema(t: Translate) {
  return z.object({ email: z.string().default('') }).superRefine((value, ctx) => {
    const problem = describeEmailProblem(value.email, t);
    if (problem !== null) ctx.addIssue({ code: 'custom', path: ['email'], message: problem });
  });
}

/**
 * What a valid submission does.
 *
 * - `send`: ask the service to mail a link. Also the answer when the instance
 *   has not said (`null`: no answer yet, an older service, an unreachable
 *   one), because the service may well send mail, and the request itself is
 *   what finds out whether it can be reached.
 * - `no-mail`: the instance said it sends no mail. Nothing is sent.
 *
 * @param instance - what `/health` said, or `null` when it said nothing.
 */
export function decideForgotRequest(instance: InstanceDescriptor | null): 'send' | 'no-mail' {
  return instance?.mail === false ? 'no-mail' : 'send';
}

/**
 * Which sentence a failed request gets.
 *
 * - `unreachable`: the request never got an answer (network, DNS, CORS).
 * - `failed`: the service answered and refused. It refuses the same way for
 *   every address, so saying so reveals nothing.
 *
 * @param cause - what the request threw.
 */
export function describeForgotFailure(cause: unknown): 'unreachable' | 'failed' {
  if (isSyncRequestError(cause) && cause.kind === 'transport') return 'unreachable';
  return 'failed';
}
