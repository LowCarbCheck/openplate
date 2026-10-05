/**
 * Matomo, stubbed for the browser tier (M250/06), shared by every spec that
 * counts a funnel step: `plans-funnel.spec.ts`, and each placement that draws
 * an offer (M250/03, M250/04).
 *
 * The stub tracker does what Matomo's does with the queue: it drains what was
 * pushed before it loaded, replaces `_paq` with an object whose `push` sends,
 * and sends every event as a GET to `matomo.php` with `e_c`, `e_a` and `e_n`.
 * So what a spec counts is a REQUEST that passed the page's own `connect-src`,
 * not an array in memory.
 */
import type { Page } from '@playwright/test';

import { E2E_MATOMO_URL } from './env';

/** A stand-in for `matomo.js`, with the one behaviour this spec relies on: queued and later pushes become requests. */
const STUB_TRACKER = `(function () {
  var state = { url: '', site: '', customUrl: '', referrer: '' };
  function send(params) {
    params.set('idsite', state.site);
    params.set('rec', '1');
    // What the real tracker reports for the page: the custom URL an EARLIER queue entry set, else the real address.
    params.set('url', state.customUrl || location.href);
    params.set('urlref', state.referrer || document.referrer);
    fetch(state.url + '?' + params.toString(), { mode: 'no-cors', keepalive: true });
  }
  function handle(args) {
    if (args[0] === 'setTrackerUrl') state.url = args[1];
    else if (args[0] === 'setSiteId') state.site = String(args[1]);
    else if (args[0] === 'setCustomUrl') state.customUrl = String(args[1]);
    else if (args[0] === 'setReferrerUrl') state.referrer = String(args[1]);
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
export interface TrackedEvent {
  category: string;
  action: string;
  name: string | null;
  /** The page address the request reported: the custom URL when one was set before it, else the real one. */
  url: string | null;
  /** The referrer the request reported. */
  urlRef: string | null;
  /** The whole request address, for a spec that must prove a secret appears nowhere in it. */
  request: string;
}

/**
 * Serves the stub tracker and records every event request that reaches `matomo.php`.
 *
 * @param page - the page, before its first navigation.
 * @param options.holdScript - when given, `matomo.js` is not served until this promise settles, which keeps the
 *   tracker unloaded while a spec fires the events that a real, slow script would find already queued. A held
 *   script delays the page's `load` event, so navigate with `waitUntil: 'commit'`.
 * @returns the recorded events, appended as they arrive.
 */
export async function recordMatomo(page: Page, options: { holdScript?: Promise<void> } = {}): Promise<TrackedEvent[]> {
  const events: TrackedEvent[] = [];
  await page.route(`${E2E_MATOMO_URL}matomo.js`, async (route) => {
    await options.holdScript;
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_TRACKER });
  });
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
        url: params.get('url'),
        urlRef: params.get('urlref'),
        request: route.request().url(),
      });
      return route.fulfill({ status: 204 });
    },
  );
  return events;
}

/** The funnel's own events, in arrival order, as `action:name`. */
export function funnel(events: readonly TrackedEvent[]): string[] {
  return events.filter((event) => event.category === 'Plans').map((event) => `${event.action}:${event.name}`);
}
