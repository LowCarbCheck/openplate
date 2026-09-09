/**
 * The plan surface, wrapped: `/v1/plans/*` over the signed-in account's own
 * session.
 *
 * ── ONE TOKEN LIFECYCLE, AND THIS CLIENT DOES NOT OWN IT ─────────────────
 *
 * The three routes here are authenticated by the account's ordinary access
 * token, exactly like `/v1/auth/account` and `/v1/admin/*`, so this client
 * borrows {@link PlansTransport} from the open session instead of opening a
 * second one. A second lifecycle would rotate the refresh token
 * independently, and a REUSED refresh token is the theft signal that revokes
 * the whole family: the plan page would be the thing that signed everybody
 * out. That failure has already happened once in this repository, for a
 * different reason, and the fix was the same seam.
 *
 * ── A 404 IS A RESULT, NOT AN ERROR ──────────────────────────────────────
 *
 * `PROTOCOL.md` §5.22: with no biller configured the whole subtree answers the
 * ordinary unknown-path 404, to everybody, so that an instance with plans
 * switched off cannot be told from a gateway built before plans existed. The
 * portal answers its own 404 for an account that never paid. Both mean the
 * same thing to the one screen that reads them, "there is nothing to open
 * here", so both arrive as {@link PLANS_ABSENT} rather than as an exception
 * that unmounts the page.
 *
 * EVERYTHING ELSE STILL THROWS. A `502` from an unreachable biller, a dead
 * connection or a body that does not decode are not outcomes a person can act
 * on, and folding them into the same union would make "there is no plan door
 * here" indistinguishable from "the biller fell over" at every call site.
 *
 * ── THE CLIENT NAMES NO PRICE ────────────────────────────────────────────
 *
 * There is no price, no plan id and no account id in any request below. The
 * catalogue lives in the biller's own configuration and the account comes from
 * a header the gateway builds from the session, so nothing a browser can
 * choose reaches either. The one field a request carries is the consent
 * language, which chooses which of two reviewed sentences a person reads.
 */
import { planViewSchema, redirectTargetSchema, PLANS_API_PREFIX } from './plans-wire';
import type { CheckoutLocale, CheckoutRequestWire, PlanView, RedirectTarget } from './plans-wire';
import type { AuthorizedMethod } from './auth-client';
import type { JsonValue } from '../protocol';
import { isSyncRequestError } from './sync-error';
import { createComponentLogger } from '#app/lib/logger';
import { z } from 'zod';

const log = createComponentLogger('plans-client');

/**
 * What this client needs from a session, and nothing more.
 *
 * `SyncAuthClient` satisfies it. Naming the seam rather than importing the
 * class keeps the plan page out of the token lifecycle: it cannot refresh,
 * cannot log out and cannot reach the DEK, because none of that is here.
 */
export interface PlansTransport {
  requestAsAccount(input: { path: string; method: AuthorizedMethod; body?: JsonValue }): Promise<JsonValue>;
}

/**
 * The answer to a plan call: the thing, or the one refusal a page renders.
 *
 * `absent` is every 404 in the subtree. See the header for why the two
 * different 404s are deliberately not told apart.
 */
export type PlansOutcome<T> = { status: 'ok'; value: T } | { status: 'absent' };

/** The single `absent` value, so no call site builds a second one. */
export const PLANS_ABSENT: PlansOutcome<never> = { status: 'absent' };

export class PlansClient {
  private readonly transport: PlansTransport;

  constructor({ transport }: { transport: PlansTransport }) {
    this.transport = transport;
  }

  /**
   * The plan this account holds, read from the biller's own tables.
   *
   * NO STRIPE CALL STANDS BEHIND IT, which is why a settings screen may open
   * it on every mount without waiting on somebody else's uptime.
   */
  async readPlan(): Promise<PlansOutcome<PlanView>> {
    return this.send({
      path: `${PLANS_API_PREFIX}/me`,
      method: 'GET',
      parse: (body) => planViewSchema.parse(body),
    });
  }

  /**
   * Opens a checkout and answers the address to send the browser to.
   *
   * The locale is the ONLY thing the body carries, and it decides only which
   * reviewed consumer acknowledgement is displayed. See `plans-wire.ts`.
   */
  async startCheckout(input: { locale: CheckoutLocale }): Promise<PlansOutcome<RedirectTarget>> {
    const request: CheckoutRequestWire = { locale: input.locale };
    return this.send({
      path: `${PLANS_API_PREFIX}/checkout`,
      method: 'POST',
      body: request,
      parse: (body) => redirectTargetSchema.parse(body),
    });
  }

  /**
   * Opens the customer portal, which is where cancelling, changing a card and
   * downloading an invoice live.
   *
   * `absent` here is an account that has never paid: there is no customer to
   * open a portal onto. It is not an oracle, because the caller already proved
   * it holds this account's own session.
   */
  async openPortal(): Promise<PlansOutcome<RedirectTarget>> {
    return this.send({
      path: `${PLANS_API_PREFIX}/portal`,
      method: 'POST',
      parse: (body) => redirectTargetSchema.parse(body),
    });
  }

  /**
   * One call: send it, turn a 404 into an outcome, decode everything else.
   *
   * The 404 catch is here rather than at three call sites because the rule is
   * one rule, and a method that forgot it would throw past the page's boundary
   * and blank a screen somebody opened to cancel a payment.
   */
  private async send<T>(input: {
    path: string;
    method: AuthorizedMethod;
    body?: JsonValue;
    parse: (body: JsonValue) => T;
  }): Promise<PlansOutcome<T>> {
    try {
      const body = await this.transport.requestAsAccount({
        path: input.path,
        method: input.method,
        body: input.body,
      });
      return { status: 'ok', value: input.parse(body) };
    } catch (error) {
      if (isSyncRequestError(error) && error.kind === 'not-found') return PLANS_ABSENT;
      // A SHAPE MISMATCH IS NEVER SILENT. The biller is a separate repository
      // this one cannot compile against, so a renamed field is the most
      // likely way this breaks, and it must not look like three successful
      // requests and an empty console.
      if (error instanceof z.ZodError) {
        log.error('a plan response did not match its schema', { path: input.path });
      }
      throw error;
    }
  }
}
