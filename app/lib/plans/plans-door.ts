/**
 * WHETHER THIS INSTANCE SELLS A PLAN, and what that permits a screen to draw.
 *
 * ── One fact, from the handshake, never from a probe ──────────────────────
 *
 * `PROTOCOL.md` §5.22 requires a client to read `instance.plans` before
 * offering a plan door rather than asking the path: with no biller configured
 * the whole `/v1/plans` subtree answers the ordinary unknown-path 404, to
 * everybody, so that an instance with the door shut cannot be told from a
 * gateway built before plans existed. A probe would learn nothing and would
 * still have to fail open.
 *
 * ── It is NOT an `InstancePolicy` question ────────────────────────────────
 *
 * M212's README lists "putting a plans fact into `InstancePolicy`" as a
 * non-goal and M213 spec 05 repeats it as a decision. `InstancePolicy` answers
 * questions about a MODE, and a freeze test enforces that the mode is its only
 * input. Whether a deployment sells plans is a fact about that deployment: two
 * managed instances answer it differently, exactly as they do for
 * `memberInvites`. So it arrives on `/health`, through the cached read every
 * screen already shares.
 *
 * ── `null` MEANS NO DOOR ─────────────────────────────────────────────────
 *
 * An unreachable service, a malformed body, a build older than the field and
 * a read still in flight all read `null`, and all four answer `false` here.
 * Unknown must not offer to sell somebody something.
 */
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';
import { isCheckoutLocale, type CheckoutLocale } from '#app/lib/sync/engine/client/plans-wire';

/**
 * The address of the plan page.
 *
 * ONE CONSTANT because three surfaces link to it, the notice under a dead AI
 * intake, the refusal on `/scan` and the account page, and the biller ALSO
 * names it: `checkoutReturnUrls` and `portalReturnUrl` send a browser back to
 * `/settings/plan`. A fourth spelling of this string would be a page somebody
 * pays on and cannot get back to.
 */
export const PLAN_PAGE_HREF = '/settings/plan';

/** Whether a plan page exists on this instance. The one signal, without a throw, for a link or a notice. */
export function hasPlansDoor(instance: InstanceDescriptor | null): boolean {
  return instance?.plans ?? false;
}

/**
 * The same signal, as the route gate.
 *
 * @throws a 404 `Response` on an instance with no biller behind it, which is
 * every instance where `/v1/plans/*` answers 404 itself. The page says the
 * same thing the service says rather than rendering an explanation of a
 * feature this deployment does not have.
 */
export function requirePlansDoor(instance: InstanceDescriptor | null): void {
  if (!hasPlansDoor(instance)) throw new Response('Not Found', { status: 404 });
}

/**
 * Which reviewed consumer acknowledgement a checkout should display, from the
 * language this app is currently drawn in.
 *
 * ANYTHING ELSE IS GERMAN, matching the biller's own fallback: the instance
 * sells in Germany and the obligation is German law, so a language nobody
 * wrote a reviewed sentence for must not become an empty consent.
 */
export function checkoutLocaleFor(uiLanguage: string): CheckoutLocale {
  const base = uiLanguage.split('-')[0] ?? '';
  return isCheckoutLocale(base) ? base : 'de';
}
