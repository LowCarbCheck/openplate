/**
 * The `/v1/plans/*` wire shapes, transcribed from `openplate-core/PROTOCOL.md`
 * §5.22 and from the biller's own handlers.
 *
 * ── WHY THIS IS TRANSCRIBED AND NOT IMPORTED ─────────────────────────────
 *
 * §5.22 is explicit that NOTHING behind this prefix is part of the protocol:
 * the routes, the request bodies and the response bodies belong to
 * openplate-billing, which is a separate, PRIVATE service on its own release
 * cycle. This client cannot import from it, and the protocol document does not
 * describe it either. So the shapes are copied here by hand, from
 * `openplate-billing/src/plans/me.ts`, `checkout.ts` and `portal.ts`, and
 * `tests/unit/plans-client.test.ts` is the contract test that says out loud
 * what was copied, so a drift is a failing assertion rather than a screen that
 * renders "undefined".
 *
 * ── THE DOOR IS THE HANDSHAKE, NEVER A PROBE ─────────────────────────────
 *
 * §5.22 requires a client to read `instance.plans` before offering a plan door
 * rather than asking the path. With no biller configured the whole subtree
 * answers the ordinary unknown-path `404`, to everybody, which is
 * indistinguishable from a gateway built before plans existed. So a `404` here
 * is decoded as {@link PLANS_ABSENT} and never as an error somebody could read
 * a fact out of.
 *
 * ── DECODED, NOT CAST ────────────────────────────────────────────────────
 *
 * Every response goes through a zod schema. The gateway relays the biller's
 * JSON body untouched, so what arrives is a body from a service this
 * repository has never compiled against; a cast would turn a renamed field
 * into `undefined` on a page about money.
 */
import { z } from 'zod';

/** Mount prefix for the pass-through, beside `AUTH_API_PREFIX` and `ADMIN_API_PREFIX`. */
export const PLANS_API_PREFIX = '/v1/plans';

/**
 * The five statuses `GET /plans/me` may answer.
 *
 * A NARROWING THE BILLER ALREADY DID, not Stripe's vocabulary. Stripe has
 * eight subscription statuses; `incomplete`, `unpaid` and `paused` all mean
 * "not paying and not covered" to a screen, and the biller collapses them into
 * `canceled` before the value ever leaves it
 * (`openplate-billing/src/plans/me.ts`, `toPlanStatus`). This union is that
 * narrowing transcribed, so a sixth value arriving from a newer biller is a
 * decode failure here rather than an unhandled branch on the screen.
 */
export const PLAN_STATUSES = ['none', 'trialing', 'active', 'past_due', 'canceled'] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** `GET /plans/me`, transcribed field for field from `PlanView` in the biller. */
export const planViewSchema = z.object({
  plan: z.enum(PLAN_STATUSES),
  /** An ISO instant, or `null` when there is no subscription at all. */
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  /** Whether there is a customer to open the portal onto. `false` for somebody who never paid. */
  portalAvailable: z.boolean(),
});

export type PlanView = z.infer<typeof planViewSchema>;

/**
 * The answer of both `POST /plans/checkout` and `POST /plans/portal`: one
 * address to send the browser to.
 *
 * ONE SCHEMA FOR BOTH because the biller really does answer the same shape
 * from both handlers, and two identical schemas would let one drift while the
 * test still passed against the other.
 */
export const redirectTargetSchema = z.object({ url: z.string() });

export type RedirectTarget = z.infer<typeof redirectTargetSchema>;

/**
 * The languages the biller holds a reviewed consumer acknowledgement in
 * (`openplate-billing/src/plans/consumer-consent.ts`).
 *
 * IT DECIDES NOTHING THAT COSTS MONEY, and that is why it is the one thing
 * about a checkout a client may influence: it names no price, no account and
 * no customer, it chooses which of two reviewed sentences a person reads
 * before they consent, and an unknown value falls back to German at the
 * biller rather than refusing the payment.
 */
export const CHECKOUT_LOCALES = ['de', 'en'] as const;

export type CheckoutLocale = (typeof CHECKOUT_LOCALES)[number];

/**
 * `POST /plans/checkout`. One field, and it is not the price.
 *
 * A TYPE ALIAS RATHER THAN AN INTERFACE, deliberately: an interface has no
 * implicit index signature, so it is not assignable to `JsonValue` and the
 * transport would have to be handed a re-typed literal that nothing checks
 * against this transcription.
 */
export type CheckoutRequestWire = {
  locale: CheckoutLocale;
};

/** Whether a UI language is one the biller holds a reviewed sentence for. */
export function isCheckoutLocale(value: string): value is CheckoutLocale {
  // SAFETY: widening a `readonly ['de','en']` to `readonly string[]` so an
  // arbitrary string can be looked up in it. Nothing is narrowed by the
  // assertion; the narrowing is the predicate's return, and it is true exactly
  // when the value is one of the two members.
  const known: readonly string[] = CHECKOUT_LOCALES;
  return known.includes(value);
}
