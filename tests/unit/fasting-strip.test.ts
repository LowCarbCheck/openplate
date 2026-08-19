/**
 * Unit tests for `#app/components/fast-strip` — the Overview page's conditional
 * fasting row (M132). Renders to static markup inside a `MemoryRouter` with a
 * hermetic inline i18next catalog, the exact harness `bottom-nav.test.ts` uses.
 *
 * Two things this pins that no other test can:
 *
 * 1. **The live figures are `tabular-nums` and never `font-display`.**
 *    DESIGN.md §4 — the Fraunces subset carries no tabular figures, so a
 *    minute-ticking number set in it would jitter in width as it updates.
 * 2. **The strip is a LINK, not a Card.** The Overview page's no-scroll budget
 *    is built on this row costing ~57 px; the moment someone "tidies" it into a
 *    `Card` it inherits `p-6` and the arithmetic in `dashboard.tsx`'s header
 *    stops being true.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { FastStrip } from '../../app/components/fast-strip';
import type { LocalFast } from '../../app/lib/local-store/schema';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const SIXTEEN = 16 * HOUR;

/**
 * A hermetic catalog rather than `app/i18n/i18n.ts`: what matters here is that
 * the strip asks for the right keys and lays the answers out, not that the
 * shipped catalog is complete (that is `i18n-key-parity.test.ts`'s job).
 */
void i18next.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        fasting: {
          duration: { hoursMinutes: '{{hours}}h {{minutes}}m', hoursOnly: '{{hours}}h', minutesOnly: '{{minutes}}m' },
          strip: {
            activeLine: '{{elapsed}} in · {{remaining}} left',
            fasting: 'Fasting',
            overtimeLine: '{{elapsed}} in · {{overtime}} past goal',
            scheduled: 'Fast scheduled',
            scheduledLine: 'Starts in {{duration}}',
          },
        },
      },
    },
  },
  react: { useSuspense: false },
});

/**
 * The strip reads the wall clock through `useNow`, whose initial state is
 * `Date.now()` — so the fixtures are anchored to NOW rather than to a fixed
 * instant, and every assertion below is about a duration, never a date.
 */
function fastStartedHoursAgo(hours: number, overrides: Partial<LocalFast> = {}): LocalFast {
  const startedAt = Date.now() - hours * HOUR;
  return {
    id: 'fast-1',
    protocolId: '16:8',
    targetDurationMs: SIXTEEN,
    plannedStartAt: null,
    startedAt,
    endedAt: null,
    createdAt: startedAt,
    ...overrides,
  };
}

/** The rendered TEXT, with every tag (and therefore every hyphenated class name) removed. */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

function render(fast: LocalFast): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ['/dashboard'] }, createElement(FastStrip, { fast })),
  );
}

describe('FastStrip', () => {
  it('shows elapsed and remaining for a running fast, and hands off to /fasting', () => {
    // 8 h in on a 16:8 window, offset by a minute so neither figure is a
    // suspiciously round number that a bug could produce by accident.
    const html = render(fastStartedHoursAgo(8));

    assert.ok(html.includes('Fasting'), 'the eyebrow names the state');
    assert.ok(/8h( \d+m)? in/.test(html), `expected an elapsed figure of ~8h in: ${html}`);
    assert.ok(/(7h \d+m|8h) left/.test(html), `expected a remaining figure of ~8h left: ${html}`);
    assert.ok(html.includes('href="/fasting"'), 'the whole row is the handoff to the timer screen');
  });

  it('shows overtime past the target, never a negative remaining', () => {
    const text = textOf(render(fastStartedHoursAgo(18)));

    assert.ok(text.includes('past goal'), `expected the overtime framing: ${text}`);
    assert.ok(!text.includes('left'), 'a fast past its goal has no "left" figure to show');
    assert.ok(!/-\s*\d/.test(text), `nothing may render as a negative duration: ${text}`);
  });

  it('counts down to a scheduled start rather than showing a zero-length fast', () => {
    const startsIn = Date.now() + 3 * HOUR + 12 * MINUTE;
    const html = render(fastStartedHoursAgo(0, { startedAt: null, plannedStartAt: startsIn }));

    assert.ok(html.includes('Fast scheduled'), 'the eyebrow names the scheduled state');
    assert.ok(/Starts in 3h \d+m/.test(html), `expected a "starts in" countdown: ${html}`);
  });

  it('sets the live figures in tabular-nums and never in the display serif', () => {
    const html = render(fastStartedHoursAgo(8));

    assert.ok(html.includes('tabular-nums'), 'ticking digits must not shift width as they change');
    assert.ok(!html.includes('font-display'), 'Fraunces has no tabular figures — never on a live number');
  });

  it('is a link row, not a card — the Overview height budget depends on it', () => {
    const html = render(fastStartedHoursAgo(8));

    assert.ok(html.includes('px-3 py-2.5'), 'the strip keeps its one-row padding');
    assert.ok(!html.includes('p-6'), 'a Card would bring p-6 and blow the ~57 px budget');
  });
});
