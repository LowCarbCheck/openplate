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
export interface TrackedEvent {
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
export async function recordMatomo(page: Page): Promise<TrackedEvent[]> {
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
export function funnel(events: readonly TrackedEvent[]): string[] {
  return events.filter((event) => event.category === 'Plans').map((event) => `${event.action}:${event.name}`);
}
