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
 *
 * ── THE GATE READS A FRESH DESCRIPTOR (M245/05, decided 2026-09-23) ──────
 *
 * `/settings/plan` opened on a preview whose core answered `plans: false`.
 * The browser tier (`tests/e2e/plans-door-descriptor.spec.ts`) found the path:
 * the tab's cached descriptor (`readCachedServerInstance`) is keyed on the
 * server URL and lives as long as the tab, so a tab that read `plans: true`
 * once kept opening the page by client navigation after the core switched its
 * biller off. No descriptor is persisted across tabs; the suspected foreign
 * descriptor in the origin's storage does not exist.
 *
 * The decision: a ROUTE GATE uses a descriptor fetched for THIS server URL at
 * the moment it opens, and a cached one only while that read is still in
 * flight, which is the only cached read that is fresh by construction
 * (`readFreshServerInstance`). {@link requirePlansDoor} therefore takes the
 * server URL and reads, and never takes a descriptor a caller already held.
 * {@link hasPlansDoor} stays a pure check on a descriptor: a LINK or a notice
 * may draw from the tab's cache, because following it runs this gate.
 */
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';
import { readFreshServerInstance } from '#app/hooks/use-server-instance';
import { isCheckoutLocale, type CheckoutLocale } from '#app/lib/sync/engine/client/plans-wire';
import { isLanguageCode, type LanguageCode } from '#app/i18n/language-prefs';

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
 * Whether the navigation draws an entry to the plan page (M250): only for a
 * signed-in person, and only on an instance that sells plans. Pure, so the
 * rule is testable without a shell; `usePlanNavigationEntry` feeds it a
 * descriptor read fresh when the shell mounted.
 */
export function hasPlanNavigationEntry({
  instance,
  isSignedIn,
}: {
  instance: InstanceDescriptor | null;
  isSignedIn: boolean;
}): boolean {
  return isSignedIn && hasPlansDoor(instance);
}

/** Reads the descriptor of one server. The seam {@link requirePlansDoor} reads through. */
export type InstanceReader = (serverUrl: string) => Promise<InstanceDescriptor | null>;

/**
 * The same signal, as the route gate, read FRESH for the server named.
 *
 * @param input.serverUrl - the sync server this instance talks to.
 * @param input.readInstance - how the descriptor is read. Defaults to
 *   {@link readFreshServerInstance}; a unit test passes its own.
 * @returns the descriptor the gate passed, so the page reads the same answer.
 * @throws a 404 `Response` on an instance with no biller behind it, which is
 * every instance where `/v1/plans/*` answers 404 itself. The page says the
 * same thing the service says rather than rendering an explanation of a
 * feature this deployment does not have.
 */
export async function requirePlansDoor({
  serverUrl,
  readInstance = readFreshServerInstance,
}: {
  serverUrl: string;
  readInstance?: InstanceReader;
}): Promise<InstanceDescriptor> {
  const instance = await readInstance(serverUrl);
  if (instance === null || !hasPlansDoor(instance)) throw new Response('Not Found', { status: 404 });
  return instance;
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

/**
 * Which language the offer's texts are asked in, from the language this app is
 * drawn in.
 *
 * The six app languages pass through, because the biller holds its order texts
 * in all six (M245 decision). Anything else is German, for the reason
 * {@link checkoutLocaleFor} gives.
 */
export function offerLocaleFor(uiLanguage: string): LanguageCode {
  const base = uiLanguage.split('-')[0] ?? '';
  return isLanguageCode(base) ? base : 'de';
}
