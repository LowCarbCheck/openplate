/**
 * `Diary / logged` is REACHED from both scans, not merely defined (M200/04).
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * On 2026-09-07 Matomo site 18 reported ZERO for `Diary / logged`, for all
 * eight input paths, and the category had never appeared at all. The first
 * reading of that zero was wrong. It was not a broken chain and not a dead
 * funnel: `trackFoodLogged` was added hours earlier in `e09af17`, which is
 * untagged, so the event had never had a chance to fire anywhere.
 *
 * A zero says "did not happen" OR "cannot be seen". This file removes the
 * third possibility, "was never wired", for the two paths M200/04 cares about,
 * so the next zero is evidence rather than noise.
 *
 * ── What is EXECUTED and what is READ ────────────────────────────────────
 *
 * The event is executed: the real `trackFoodLogged` runs against a real `_paq`
 * at the level a default instance runs at, so the rows below are the rows
 * Matomo would drain, one distinct row per input path. The CHAIN from the
 * confirm handler to that call is read out of `app/routes/scan.tsx`, because
 * `handleConfirm` and `handleConfirmLabel` are internal to the route and
 * driving them needs the device store and the toast layer, which is the
 * integration tier's job rather than this one's.
 *
 * The source assertions are about POSITION, not about presence: each call must
 * sit at the top level of its handler, after the entry is written and before
 * the redirect. That is what makes it unconditional on the success path, a
 * call moved into a branch, or above the write, would still be "present" and
 * would still report a log that may not have happened.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseAnalyticsConfig } from '../../app/config/analytics';
import {
  __resetAnalyticsEventLevelForTests,
  setAnalyticsEventLevel,
  trackFoodLogged,
  type LogInputPath,
} from '../../app/lib/matomo-events';

const SCAN_ROUTE = readFileSync(fileURLToPath(new URL('../../app/routes/scan.tsx', import.meta.url)), 'utf8');

/** Installs a bare `window` carrying an empty `_paq`, as `analytics-event-levels.test.ts` does. */
function stubWindow(): unknown[][] {
  const paq: unknown[][] = [];
  Object.defineProperty(globalThis, 'window', { value: { _paq: paq }, configurable: true, writable: true });
  return paq;
}

/** The level an operator gets by turning analytics on and configuring nothing else. */
function defaultInstanceLevel(): 'pageviews' | 'product' | 'research' {
  const config = parseAnalyticsConfig({
    matomoUrl: 'https://analytics.example/',
    siteId: '18',
    eventLevel: undefined,
  });
  assert.ok(config, 'expected a configured analytics instance');
  return config.eventLevel;
}

/**
 * The body of a top-level function in the route source, from its header to the
 * next column-zero `}`. Throws rather than returning empty: a renamed handler
 * must fail the test that reads it, never silently pass on nothing.
 */
function topLevelFunctionBody(source: string, name: string): string {
  const header = new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, 'm').exec(source);
  if (header === null) throw new Error(`function ${name} was not found in app/routes/scan.tsx`);
  const start = header.index;
  const end = source.indexOf('\n}\n', start);
  if (end === -1) throw new Error(`function ${name} has no closing brace at column zero`);
  return source.slice(start, end);
}

/**
 * Asserts the call is unconditional on the handler's success path, in the
 * right place.
 *
 * `call` is the WHOLE expression, not just the path, because the plate confirm
 * no longer names its path as a literal: a photo, a typed sentence and a
 * spoken one all reach that one handler, so the path is looked up from the
 * intake the form carried (`SCAN_LOG_PATH_BY_SOURCE`). What this still pins is
 * the property that matters, that the call sits at the handler's own top level
 * rather than inside a branch that reports some logs and not others.
 */
function assertLoggedOnTheSuccessPath(handler: string, call: string): void {
  const body = topLevelFunctionBody(SCAN_ROUTE, handler);

  assert.match(
    body,
    new RegExp(`^ {2}${call.replace(/[(){}'.[\]]/g, '\\$&')}$`, 'm'),
    `${handler} no longer fires ${call} at its own top level. A call nested in a branch reports some logs and not others, which is worse than reporting none.`,
  );

  const written = body.indexOf('putLocalFoodLog(');
  const fired = body.indexOf(call);
  const redirected = body.indexOf('return redirect(');
  assert.notEqual(written, -1, `${handler} no longer writes an entry`);
  assert.notEqual(redirected, -1, `${handler} no longer redirects to the diary`);
  assert.ok(
    written < fired,
    `${handler} reports the log BEFORE writing it, that would count a write that can still fail`,
  );
  assert.ok(fired < redirected, `${handler} redirects before it reports the log`);
}

afterEach(() => {
  __resetAnalyticsEventLevelForTests();
  Reflect.deleteProperty(globalThis, 'window');
});

describe('the level a default instance runs at admits Diary / logged', () => {
  it('is product, which is the tier this event declares', () => {
    assert.equal(defaultInstanceLevel(), 'product');
  });

  it('pushes one row per scan path onto the queue Matomo drains', () => {
    const paq = stubWindow();
    setAnalyticsEventLevel(defaultInstanceLevel());

    trackFoodLogged('scan-plate');
    trackFoodLogged('scan-label');
    trackFoodLogged('scan-text');
    trackFoodLogged('scan-speech');

    assert.deepEqual(paq, [
      ['trackEvent', 'Diary', 'logged', 'scan-plate'],
      ['trackEvent', 'Diary', 'logged', 'scan-label'],
      ['trackEvent', 'Diary', 'logged', 'scan-text'],
      ['trackEvent', 'Diary', 'logged', 'scan-speech'],
    ]);
  });

  it('keeps the four scan paths apart from the other six input paths', () => {
    const paq = stubWindow();
    setAnalyticsEventLevel(defaultInstanceLevel());
    const paths: readonly LogInputPath[] = [
      'add-search',
      'add-manual',
      'scan-plate',
      'scan-label',
      'scan-text',
      'scan-speech',
      'diary-chip',
      'diary-copy-day',
      'entry-log-again',
      'saved-meal',
    ];

    for (const path of paths) trackFoodLogged(path);

    // Ten distinct names and nothing else on the row: the event says HOW an
    // entry arrived, never what the entry was. There is no value slot to leak
    // a carb count into, and there is no fourth field to leak a food name into.
    assert.deepEqual(
      paq,
      paths.map((path) => ['trackEvent', 'Diary', 'logged', path]),
    );
  });

  it('fires nothing at pageviews, so a level-gated zero looks different from this', () => {
    const paq = stubWindow();
    setAnalyticsEventLevel('pageviews');

    trackFoodLogged('scan-plate');
    trackFoodLogged('scan-label');

    assert.deepEqual(paq, []);
  });
});

describe('the chain from a confirmed scan to Diary / logged', () => {
  it('reports the way in once the plate confirm has written its entries', () => {
    assertLoggedOnTheSuccessPath(
      'handleConfirm',
      'trackFoodLogged(SCAN_LOG_PATH_BY_SOURCE[readIntakeSource(formData)]);',
    );
  });

  it('reports scan-label once the label confirm has written its entry', () => {
    assertLoggedOnTheSuccessPath('handleConfirmLabel', "trackFoodLogged('scan-label');");
  });

  it('maps each of the three intakes onto its own input path, exhaustively', () => {
    // A `satisfies Record<IntakeSource, LogInputPath>` in the route, so a
    // fourth way in is a compile error rather than a batch of entries quietly
    // filed under the photo path.
    assert.match(SCAN_ROUTE, /satisfies Record<IntakeSource, LogInputPath>/);
    assert.match(SCAN_ROUTE, /photo: 'scan-plate',\s*\n\s*text: 'scan-text',\s*\n\s*speech: 'scan-speech',/);
  });

  it('reports a four-item plate ONCE, because a confirm is one log action', () => {
    const body = topLevelFunctionBody(SCAN_ROUTE, 'handleConfirm');
    const calls = body.match(/trackFoodLogged\(/g) ?? [];
    assert.equal(
      calls.length,
      1,
      'the plate confirm fires more than once. It must stay outside the per-item loop: a four-item plate is one log action, exactly as its single toast is.',
    );
  });
});
