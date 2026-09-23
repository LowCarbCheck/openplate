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
 * There is no price, no price id and no account id in any request below. The
 * catalogue lives in the biller's own configuration and the account comes from
 * a header the gateway builds from the session, so nothing a browser can
 * choose reaches either. An order names a plan KEY, the language and version
 * of the page the person read, and the two consents.
 *
 * ── AN ORDER HAS MORE THAN TWO OUTCOMES ──────────────────────────────────
 *
 * `POST /plans/checkout` is gone (410 since M245/03); the order replaced it.
 * Its answers are not "an address or nothing": a booked switch, a stale page
 * and an account that already pays are each a thing the page says. So
 * {@link PlansClient.placeOrder} answers {@link OrderOutcome}, decoded from the
 * status AND the biller's machine code, and still throws what a person cannot
 * act on beyond "try again" (a 502, a dead connection, a body it cannot read).
 */
import {
  ORDER_ALREADY_SUBSCRIBED,
  ORDER_STALE_VERSION,
  orderAnswerSchema,
  planOfferSchema,
  planViewSchema,
  redirectTargetSchema,
  PLANS_API_PREFIX,
} from './plans-wire';
import type {
  OrderAnswer,
  OrderConsents,
  OrderRequestWire,
  PlanKey,
  PlanOffer,
  PlanView,
  RedirectTarget,
} from './plans-wire';
import type { AuthorizedMethod } from './auth-client';
import type { JsonValue } from '../protocol';
import { isSyncRequestError, type SyncRequestError } from './sync-error';
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

/**
 * What one order came to.
 *
 * - `redirect`: a first order; Stripe takes the payment at `url`.
 * - `switched`: a monthly subscription moves to the yearly plan at `startsAt`.
 * - `stale`: the page the person read is no longer the offer. Read it again.
 * - `already-subscribed`: the account pays for a plan this order cannot move.
 * - `refused`: any other 400. The page let through something it should not
 *   have, so it says the order failed and nothing more.
 * - `absent`: the door shut between the handshake and the press.
 */
export type OrderOutcome =
  | { kind: 'redirect'; url: string }
  | { kind: 'switched'; plan: PlanKey; startsAt: string }
  | { kind: 'stale' }
  | { kind: 'already-subscribed' }
  | { kind: 'refused'; code: string | null }
  | { kind: 'absent' };

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
   * What this instance sells, in one language: the plans with their gross
   * prices and terms, the order texts and their links (M245/03).
   *
   * A BODY THAT DOES NOT DECODE IS NO OFFER. Unlike the plan read, which a
   * page reports as a failure, an offer the client cannot fully read must
   * not be half drawn: a price without its term, or a term without its price,
   * is the one thing a page about money may never show. So a shape mismatch
   * is logged and answered as {@link PLANS_ABSENT}, and the placement draws
   * nothing, exactly as it does on an instance with no biller.
   *
   * @param input.locale - the language the texts are wanted in. It chooses
   *   words, never a price.
   */
  async readOffer(input: { locale: string }): Promise<PlansOutcome<PlanOffer>> {
    const outcome = await this.send({
      path: `${PLANS_API_PREFIX}/offer?locale=${encodeURIComponent(input.locale)}`,
      method: 'GET',
      parse: (body) => planOfferSchema.safeParse(body),
    });
    if (outcome.status === 'absent') return PLANS_ABSENT;
    if (outcome.value.success) return { status: 'ok', value: outcome.value.data };
    log.error('the plan offer did not match its schema', { path: `${PLANS_API_PREFIX}/offer` });
    return PLANS_ABSENT;
  }

  /**
   * Places an order for one plan, with the consents the person ticked.
   *
   * @param input.plan - the plan KEY, never a price.
   * @param input.locale - the language of the offer the person read,
   *   `offer.locale`, so the biller rebuilds the same page to compare.
   * @param input.consentVersion - `offer.consentVersion`, opaque.
   * @param input.consents - both `true`, by type.
   * @throws a {@link SyncRequestError} for a 502 or any status not decoded
   *   below, and a `ZodError` for a 200 body that is neither answer.
   */
  async placeOrder(input: {
    plan: PlanKey;
    locale: string;
    consentVersion: string;
    consents: OrderConsents;
  }): Promise<OrderOutcome> {
    const request: OrderRequestWire = {
      plan: input.plan,
      locale: input.locale,
      consentVersion: input.consentVersion,
      consents: { terms: input.consents.terms, earlyStart: input.consents.earlyStart },
    };
    let outcome: PlansOutcome<OrderAnswer>;
    try {
      outcome = await this.send({
        path: `${PLANS_API_PREFIX}/order`,
        method: 'POST',
        body: request,
        parse: (body) => orderAnswerSchema.parse(body),
      });
    } catch (error) {
      if (!isSyncRequestError(error)) throw error;
      const refusal = orderRefusalOf(error);
      if (refusal === null) throw error;
      return refusal;
    }
    if (outcome.status === 'absent') return { kind: 'absent' };
    const answer = outcome.value;
    if ('switched' in answer) return { kind: 'switched', ...answer.switched };
    return { kind: 'redirect', url: answer.url };
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

/**
 * The order outcome a refused request stands for, or `null` for a failure
 * that is not a refusal and must be thrown on.
 *
 * The status says which family; the biller's machine code says which member.
 * Only these two codes change what the page does, so only they are named.
 */
function orderRefusalOf(error: SyncRequestError): OrderOutcome | null {
  if (error.status === 409 && error.code === ORDER_ALREADY_SUBSCRIBED) return { kind: 'already-subscribed' };
  if (error.status !== 400) return null;
  if (error.code === ORDER_STALE_VERSION) return { kind: 'stale' };
  return { kind: 'refused', code: error.code };
}
