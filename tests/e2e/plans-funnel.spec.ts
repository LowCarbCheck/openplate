/**
 * The plans funnel reports each step once, read off the Matomo requests
 * (M250/06).
 *
 * ── WHAT IS REAL AND WHAT IS STUBBED ─────────────────────────────────────
 *
 * REAL: the production build with analytics configured (`playwright.config.ts`
 * passes `MATOMO_URL` and `MATOMO_SITE_ID`), the tracker hook, the event level,
 * the production CSP, the account, the session and the plan page.
 *
 * STUBBED: the plan reads and the checkout (`plans-stub.ts`), and `matomo.js`
 * itself. The stub tracker below does what Matomo's does with the queue: it
 * drains what was pushed before it loaded, replaces `_paq` with an object
 * whose `push` sends, and sends every event as a GET to `matomo.php` with
 * `e_c`, `e_a` and `e_n`. So what is counted here is a REQUEST that passed the
 * page's own `connect-src`, not an array in memory.
 *
 * ── THE WALK ─────────────────────────────────────────────────────────────
 *
 * Offer seen on the plan page, a plan picked, the order sent, and the browser
 * sent back from "payment" with `?checkout=success`, by then a subscriber
 * (the webhook arrived), so the returning page draws no second offer. Each
 * step must reach Matomo exactly once, and a reload must not count the return
 * again.
 */
import { expect, test, type Page } from '@playwright/test';

import { E2E_APP_URL, E2E_MATOMO_URL } from './env';
import { EN } from './copy';
import {
  FIXTURE_OFFER_BODY,
  NO_SUBSCRIPTION_VIEW,
  YEARLY_SUBSCRIBER_VIEW,
  openPlanPageSignedIn,
  routeCheckout,
  routePlansCore,
  type PlansStub,
} from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** A stand-in for `matomo.js`, with the one behaviour this spec relies on: queued and later pushes become requests. */
const STUB_TRACKER = `(function () {
  var state = { url: '', site: '' };
  function send(params) {
    params.set('idsite', state.site);
    params.set('rec', '1');
    fetch(state.url + '?' + params.toString(), { mode: 'no-cors', keepalive: true });
  }
  function handle(args) {
    if (args[0] === 'setTrackerUrl') state.url = args[1];
    else if (args[0] === 'setSiteId') state.site = String(args[1]);
    else if (args[0] === 'trackPageView') send(new URLSearchParams({ action_name: 'pageview' }));
    else if (args[0] === 'trackEvent') {
      var params = new URLSearchParams({ e_c: args[1], e_a: args[2] });
      if (args[3] !== undefined) params.set('e_n', args[3]);
      send(params);
    }
  }
  var queued = window._paq || [];
  window._paq = { push: function () { for (var i = 0; i < arguments.length; i++) handle(arguments[i]); } };
  for (var j = 0; j < queued.length; j++) handle(queued[j]);
})();`;

/** One Matomo request, reduced to what the funnel sends. */
interface TrackedEvent {
  category: string;
  action: string;
  name: string | null;
}

/**
 * Serves the stub tracker and records every event request that reaches `matomo.php`.
 *
 * @param page - the page, before its first navigation.
 * @returns the recorded events, appended as they arrive.
 */
async function recordMatomo(page: Page): Promise<TrackedEvent[]> {
  const events: TrackedEvent[] = [];
  await page.route(`${E2E_MATOMO_URL}matomo.js`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_TRACKER }),
  );
  await page.route(
    (url) => url.href.startsWith(`${E2E_MATOMO_URL}matomo.php`),
    (route) => {
      const params = new URL(route.request().url()).searchParams;
      // A pageview carries no event category; it is recorded under its own
      // name so a reload can be seen to have reached Matomo at all.
      events.push({
        category: params.get('e_c') ?? 'pageview',
        action: params.get('e_a') ?? '',
        name: params.get('e_n'),
      });
      return route.fulfill({ status: 204 });
    },
  );
  return events;
}

/** The funnel's own events, in arrival order, as `action:name`. */
function funnel(events: readonly TrackedEvent[]): string[] {
  return events.filter((event) => event.category === 'Plans').map((event) => `${event.action}:${event.name}`);
}

test('the funnel sends offer seen, plan picked, order sent and back from payment, each once', async ({ page }) => {
  const events = await recordMatomo(page);
  // Mutable on purpose: the route reads it per request, and the webhook
  // "arrives" while the browser is away paying.
  const stub: PlansStub = { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY };
  await routePlansCore(page, stub);
  await routeCheckout(page, `${E2E_APP_URL}/settings/plan?checkout=success`);

  await openPlanPageSignedIn(page);
  await expect(page.locator('[data-slot="plan-card"][data-plan-key="yearly"]')).toBeVisible();
  await expect.poll(() => funnel(events)).toEqual(['offer-seen:plan-page']);

  // THE CONTROL that the recorder sees anything the page pushes at all, so the
  // "exactly once" readings below cannot pass against a deaf recorder.
  await page.evaluate(() => window._paq.push(['trackEvent', 'Control', 'probe', 'x']));
  await expect.poll(() => events.some((event) => event.category === 'Control')).toBe(true);

  await page.locator('[data-slot="plan-card"][data-plan-key="yearly"]').click();
  await expect.poll(() => funnel(events)).toEqual(['offer-seen:plan-page', 'plan-picked:yearly']);

  stub.planView = YEARLY_SUBSCRIBER_VIEW;
  await page.getByRole('button', { name: EN.plan.start }).click();
  await page.waitForURL('**/settings/plan?checkout=success');

  await expect
    .poll(() => funnel(events))
    .toEqual(['offer-seen:plan-page', 'plan-picked:yearly', 'order-sent:yearly', 'payment-returned:paid']);
  // The marker leaves the address once it has been read.
  await expect.poll(() => new URL(page.url()).searchParams.has('checkout')).toBe(false);

  // A reload of the returned page counts nothing again.
  const pageviewsBefore = events.length;
  await page.reload();
  await expect
    .poll(() => events.length, { message: 'the reloaded page reached Matomo' })
    .toBeGreaterThan(pageviewsBefore);
  await page.waitForTimeout(500);
  expect(funnel(events)).toEqual([
    'offer-seen:plan-page',
    'plan-picked:yearly',
    'order-sent:yearly',
    'payment-returned:paid',
  ]);
});

test('a cancelled payment is reported as cancelled, not as paid', async ({ page }) => {
  const events = await recordMatomo(page);
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page, '?checkout=cancelled');
  await expect.poll(() => funnel(events)).toContain('payment-returned:cancelled');
  expect(funnel(events)).not.toContain('payment-returned:paid');
});
