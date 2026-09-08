/**
 * `Scan / mode-chosen / label` is REACHED, not merely defined (M200/04).
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * On 2026-09-07 Matomo site 18 reported ZERO for `Scan / mode-chosen`, and an
 * hour went into deciding what the zero meant. It meant none of the obvious
 * things: the event had been ADDED that same day, in `e09af17`, and was still
 * untagged. A zero in a report says "did not happen" OR "cannot be seen", and
 * the report cannot tell you which. This file removes the third possibility,
 * "was never wired", so the NEXT zero is a finding about people rather than a
 * finding about the code.
 *
 * ── What the event actually measures, which is narrower than its name ────
 *
 * It counts a SWITCH INTO a mode on `/scan`. It does not count label scans,
 * and it never could, for four reasons that are DELIBERATE and are pinned
 * below so that a later refactor changing any of them fails loudly:
 *
 *  1. `handleModeChange` returns on `nextMode === mode` BEFORE the event, so a
 *     visit with five label captures reports one event, not five.
 *  2. The tab-bar hand-off calls `setMode` directly and fires nothing, so a
 *     person who launched label mode from the tab bar is invisible here.
 *  3. The outcome events carry no mode, so label volume cannot be recovered
 *     from the success side either.
 *  4. `/scan?mode=label` (M200/01's first-run ways-to-log lesson, whose label
 *     card links there) is read by a mount effect that also calls `setMode`
 *     directly, never `handleModeChange`, for the same reason as #2: an
 *     arrival is not a person finding the scanner. So a person TAUGHT the
 *     label scan by that lesson and following its card is invisible here too.
 *
 * Read the number as "people who, arriving on the plate default, went looking
 * for the label scan and found it". That is the discoverability question the
 * M200/04 button rename asks, and it is the only question this event answers.
 * True label volume needs a new event, which is out of scope and goes through
 * `.adr/0011-analytics-levels.md` and `no-telemetry-wiring.test.ts` first.
 *
 * ── What is EXECUTED here and what is READ ───────────────────────────────
 *
 * The event itself is executed: the real `trackScanModeChosen` runs against a
 * real `_paq` array at the level a default instance runs at, so the rows below
 * are the rows Matomo would drain. The CHAIN from the button to that call is
 * read out of `app/routes/scan.tsx`, because the route has no DOM here (there
 * is no jsdom in this repo) and `ScanFlow`/`UploadForm` are internal to it.
 * Every source assertion names a single anchor, so a rename fails it rather
 * than passing vacuously.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseAnalyticsConfig } from '../../app/config/analytics';
import {
  __resetAnalyticsEventLevelForTests,
  setAnalyticsEventLevel,
  trackScanFoundNothing,
  trackScanModeChosen,
  trackScanSucceeded,
} from '../../app/lib/matomo-events';

const SCAN_ROUTE = readFileSync(fileURLToPath(new URL('../../app/routes/scan.tsx', import.meta.url)), 'utf8');

/** Installs a bare `window` carrying an empty `_paq`, as `analytics-event-levels.test.ts` does. */
function stubWindow(): unknown[][] {
  const paq: unknown[][] = [];
  Object.defineProperty(globalThis, 'window', { value: { _paq: paq }, configurable: true, writable: true });
  return paq;
}

/**
 * The level an operator gets by turning analytics on and configuring nothing
 * else. Read from the parser rather than written as a literal: if the default
 * ever moves off `product`, these events stop firing and this file must fail.
 */
function defaultInstanceLevel(): 'pageviews' | 'product' | 'research' {
  const config = parseAnalyticsConfig({
    matomoUrl: 'https://analytics.example/',
    siteId: '18',
    eventLevel: undefined,
  });
  assert.ok(config, 'expected a configured analytics instance');
  return config.eventLevel;
}

afterEach(() => {
  __resetAnalyticsEventLevelForTests();
  Reflect.deleteProperty(globalThis, 'window');
});

describe('the level a default instance runs at admits Scan / mode-chosen', () => {
  it('is product, which is the tier this event declares', () => {
    assert.equal(defaultInstanceLevel(), 'product');
  });

  it('pushes Scan / mode-chosen / label onto the queue Matomo drains', () => {
    const paq = stubWindow();
    setAnalyticsEventLevel(defaultInstanceLevel());

    trackScanModeChosen('label');

    assert.deepEqual(paq, [['trackEvent', 'Scan', 'mode-chosen', 'label']]);
  });

  it('distinguishes the two scanners by name, so label is countable on its own', () => {
    const paq = stubWindow();
    setAnalyticsEventLevel(defaultInstanceLevel());

    trackScanModeChosen('plate');
    trackScanModeChosen('label');

    assert.deepEqual(paq, [
      ['trackEvent', 'Scan', 'mode-chosen', 'plate'],
      ['trackEvent', 'Scan', 'mode-chosen', 'label'],
    ]);
  });

  it('fires nothing at pageviews, so a level-gated zero looks different from this', () => {
    const paq = stubWindow();
    setAnalyticsEventLevel('pageviews');

    trackScanModeChosen('label');

    assert.deepEqual(paq, []);
  });
});

describe('the chain from the plate default to Scan / mode-chosen / label', () => {
  it('starts on the plate mode, so the first press of the label button is a real switch', () => {
    assert.match(
      SCAN_ROUTE,
      /useState<VisionMode>\('plate'\)/,
      'the initial scan mode is no longer plate, this event only counts a SWITCH, so the label button may now be a no-op on arrival',
    );
  });

  it('has the label capture button ask for the label mode', () => {
    assert.match(SCAN_ROUTE, /onModeChange\('label'\)/, 'the label capture button no longer calls onModeChange');
  });

  it('binds that prop to handleModeChange, which is what fires the event', () => {
    assert.match(SCAN_ROUTE, /onModeChange=\{handleModeChange\}/, 'onModeChange is no longer handleModeChange');
  });

  it('fires trackScanModeChosen with the mode the button asked for', () => {
    assert.match(SCAN_ROUTE, /^ {4}trackScanModeChosen\(nextMode\);$/m, 'handleModeChange no longer fires the event');
  });
});

describe('the four undercounts, pinned as deliberate', () => {
  it('does not count a repeat: the no-op guard sits BEFORE the event', () => {
    const guard = SCAN_ROUTE.indexOf('if (nextMode === mode) return;');
    const fire = SCAN_ROUTE.indexOf('trackScanModeChosen(nextMode);');
    assert.notEqual(guard, -1, 'the nextMode === mode guard is gone, repeats would now be counted');
    assert.notEqual(fire, -1, 'handleModeChange no longer fires the event');
    assert.ok(
      guard < fire,
      'the guard moved below the event. That would change what the number means: one visit with five label captures would report five, not one. Update the reading of this event before you change this.',
    );
  });

  it('does not count the tab-bar hand-off: it calls setMode directly', () => {
    assert.match(
      SCAN_ROUTE,
      /setMode\(handed\.mode\);/,
      'the tab-bar hand-off no longer calls setMode directly, if it now goes through handleModeChange it FIRES, and the event covers more people than this file says',
    );
    const handoff = SCAN_ROUTE.slice(
      SCAN_ROUTE.indexOf('const handed = takeIntakeHandoff();'),
      SCAN_ROUTE.indexOf('// Web Share Target v2'),
    );
    assert.ok(handoff.length > 0, 'the tab-bar hand-off effect was not found');
    assert.doesNotMatch(handoff, /handleModeChange|trackScanModeChosen/, 'the hand-off now reports a mode choice');
  });

  it('does not count the /scan?mode=label URL read: it calls setMode directly', () => {
    assert.match(
      SCAN_ROUTE,
      /setMode\(asked\);/,
      'the /scan?mode=label mount effect no longer calls setMode directly, if it now goes through handleModeChange it FIRES, and a person taught the label scan by the ways-to-log lesson would be visible here after all',
    );
    const urlHandoff = SCAN_ROUTE.slice(
      SCAN_ROUTE.indexOf('const asked = requestedScanMode(window.location.search);'),
      SCAN_ROUTE.indexOf('const handed = takeIntakeHandoff();'),
    );
    assert.ok(urlHandoff.length > 0, 'the /scan?mode=label mount effect was not found');
    assert.doesNotMatch(
      urlHandoff,
      /handleModeChange|trackScanModeChosen/,
      "the URL read now reports a mode choice, so a person following the first-run lesson's label card would count as discovering the scanner on arrival, which they did not",
    );
  });

  it('cannot recover label volume from the outcome: the outcome events carry no mode', () => {
    const paq = stubWindow();
    setAnalyticsEventLevel(defaultInstanceLevel());

    trackScanSucceeded();
    trackScanFoundNothing();

    // Three fields, never four: there is no name slot on either row, so no
    // amount of querying separates a label success from a plate success.
    assert.deepEqual(paq, [
      ['trackEvent', 'Scan', 'succeeded'],
      ['trackEvent', 'Scan', 'found-nothing'],
    ]);
    assert.equal(trackScanSucceeded.length, 0, 'trackScanSucceeded now takes an argument');
    assert.equal(trackScanFoundNothing.length, 0, 'trackScanFoundNothing now takes an argument');
  });
});
