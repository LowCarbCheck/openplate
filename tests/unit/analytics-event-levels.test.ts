/**
 * The event LEVEL gate in `#app/lib/matomo-events`, asserted against `_paq`.
 *
 * What makes this worth a file of its own: the gate is the only thing standing
 * between an ordinary instance and the research-tier events, which say that a
 * person fasts, weighs themselves, has a clinician and takes part in a study.
 * A regression here would not throw, would not fail a typecheck and would not
 * change a single call site. It would simply start sending more.
 *
 * So every assertion below reads the queue Matomo actually drains, rather than
 * any internal flag. The first test is the load-bearing one: it pins the
 * module DEFAULT, before anything has told it a level, and it must stay first
 * in the file for that reason.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetAnalyticsEventLevelForTests,
  setAnalyticsEventLevel,
  trackFastEnded,
  trackScanSucceeded,
} from '../../app/lib/matomo-events';

/**
 * Installs a bare `window` carrying an empty `_paq`, and hands back the array.
 *
 * `defineProperty` rather than a cast: the module only ever reads
 * `globalThis.window` and `window._paq`, so a two-field stub is the whole
 * surface, and pretending it is a real `Window` would need an assertion that
 * buys nothing.
 */
function stubWindow(): unknown[][] {
  const paq: unknown[][] = [];
  Object.defineProperty(globalThis, 'window', {
    value: { _paq: paq },
    configurable: true,
    writable: true,
  });
  return paq;
}

afterEach(() => {
  __resetAnalyticsEventLevelForTests();
  Reflect.deleteProperty(globalThis, 'window');
});

describe('the analytics event level gate', () => {
  it('fires NOTHING before the tracker hook has set a level — the module default', () => {
    // Must stay the first test in this file: it is the only place the
    // pre-hook default can be observed, and `setAnalyticsEventLevel` has not
    // been called in this process yet. The default is `pageviews` because the
    // config arrives with the root loader, and firing nothing is the right
    // answer in the window before it does.
    const paq = stubWindow();

    trackScanSucceeded();
    trackFastEnded();

    assert.deepEqual(paq, []);
  });

  it('fires NOTHING at pageviews, neither tier', () => {
    const paq = stubWindow();
    setAnalyticsEventLevel('pageviews');

    trackScanSucceeded();
    trackFastEnded();

    assert.deepEqual(paq, []);
  });

  it('fires product events but NOT research events at product, the default level', () => {
    const paq = stubWindow();
    setAnalyticsEventLevel('product');

    trackScanSucceeded();
    trackFastEnded();

    assert.deepEqual(paq, [['trackEvent', 'Scan', 'succeeded']]);
  });

  it('fires both tiers at research, which is the level an operator has to name', () => {
    const paq = stubWindow();
    setAnalyticsEventLevel('research');

    trackScanSucceeded();
    trackFastEnded();

    assert.deepEqual(paq, [
      ['trackEvent', 'Scan', 'succeeded'],
      ['trackEvent', 'Fasting', 'ended'],
    ]);
  });

  it('treats null as pageviews, so an instance with analytics off counts nothing', () => {
    const paq = stubWindow();
    setAnalyticsEventLevel(null);

    trackScanSucceeded();
    trackFastEnded();

    assert.deepEqual(paq, []);
  });

  it('goes back to firing nothing when a level is withdrawn', () => {
    const paq = stubWindow();
    setAnalyticsEventLevel('research');
    trackFastEnded();
    setAnalyticsEventLevel(null);
    trackFastEnded();

    assert.deepEqual(paq, [['trackEvent', 'Fasting', 'ended']]);
  });
});
