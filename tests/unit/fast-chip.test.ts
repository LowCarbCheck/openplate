/**
 * Unit tests for `#app/components/fast-chip`, the header's fasting pill.
 *
 * Renders the PRESENTATIONAL half (`FastChip`, prop-driven) rather than
 * `FastChipSlot`: the slot calls `useCurrentFast`, whose `useEffect` never
 * runs under `renderToStaticMarkup`, so the slot could only ever render its
 * null branch here. That split is why the chip is two components.
 *
 * Real English copy through `withI18n`, not a fixture catalog: an assertion
 * here should fail when `fasting.chip.*` is renamed in one place and not the
 * other, which a hermetic catalog would hide.
 *
 * Three things pinned that nothing else can:
 *
 * 1. **Overtime is never amber.** Fasting past the target is the intended
 *    outcome; colouring it as a warning would turn a win into an alarm.
 * 2. **The height contract.** `min-h-9` inside the header's `min-h-16` is what
 *    keeps the bar from growing when a fast starts.
 * 3. **The stage label is `md:` only**, so a narrow phone keeps the pill short
 *    enough for the `h1` to truncate first.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { FastChip } from '../../app/components/fast-chip';
import type { LocalFast } from '../../app/lib/local-store/schema';
import { withI18n } from './trends-i18n-harness';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const SIXTEEN = 16 * HOUR;

/** A fixed clock, so every figure below is arithmetic rather than a race. */
const NOW = 1_760_000_000_000;

function fastStartedHoursAgo(hours: number, overrides: Partial<LocalFast> = {}): LocalFast {
  const startedAt = NOW - hours * HOUR;
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

function render(fast: LocalFast, stageLabel?: string): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ['/diary'] }, withI18n(createElement(FastChip, { fast, nowMs: NOW, stageLabel }))),
  );
}

/** The rendered TEXT, with every tag (and therefore every class name) removed. */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

const ACTIVE_LABEL_STEM = 'Fasting for';
const SCHEDULED_LABEL_STEM = 'Fast starts in';

describe('FastChip, a running fast', () => {
  const html = render(fastStartedHoursAgo(8));

  it('shows the elapsed figure', () => {
    assert.ok(textOf(html).includes('8h'), `expected an 8h elapsed figure: ${html}`);
  });

  it('hands off to the timer screen', () => {
    assert.ok(html.includes('href="/fasting"'), `the whole pill is the link to /fasting: ${html}`);
  });

  it('names the state in a full sentence for assistive tech', () => {
    assert.ok(
      html.includes(`aria-label="${ACTIVE_LABEL_STEM} 8h, open the timer"`),
      `expected the active aria-label sentence: ${html}`,
    );
  });

  it('fits inside the header height budget and sets its digits tabular', () => {
    assert.ok(html.includes('min-h-9'), 'the pill must stay under the header`s min-h-16');
    assert.ok(html.includes('tabular-nums'), 'ticking digits must not shift width as they change');
    assert.ok(!html.includes('font-display'), 'Fraunces has no tabular figures, never on a live number');
  });
});

describe('FastChip past its target', () => {
  // 18 h into a 16 h window: two hours of overtime, which is a good outcome.
  const html = render(fastStartedHoursAgo(18));

  it('still shows only the elapsed figure', () => {
    assert.ok(textOf(html).includes('18h'), `expected the elapsed figure to keep counting: ${html}`);
  });

  it('never turns amber', () => {
    assert.ok(!html.includes('amber'), `overtime is normal and must not be styled as a warning: ${html}`);
    // The control: the resting pill IS tinted, so "no colour at all" would be a
    // vacuous assertion. Prove the tint that should be there is there.
    assert.ok(html.includes('text-primary'), `the pill keeps its brand tint: ${html}`);
  });
});

describe('FastChip, a scheduled fast', () => {
  const scheduled = fastStartedHoursAgo(0, {
    startedAt: null,
    plannedStartAt: NOW + 3 * HOUR + 12 * MINUTE,
  });
  const html = render(scheduled);

  it('counts down to the start rather than showing a zero-length fast', () => {
    assert.ok(textOf(html).includes('in 3h 12m'), `expected a "starts in" countdown: ${html}`);
  });

  it('carries the scheduled sentence, and NOT the active one', () => {
    assert.ok(
      html.includes(`aria-label="${SCHEDULED_LABEL_STEM} 3h 12m, open the timer"`),
      `expected the scheduled aria-label sentence: ${html}`,
    );
    // The control for the pair above: the two labels are different strings, so
    // a chip that ignored its status would fail exactly here.
    assert.ok(!html.includes(ACTIVE_LABEL_STEM), `a scheduled fast must not claim to be running: ${html}`);
  });
});

describe('FastChip stage label', () => {
  it('renders the caller`s stage after a middle dot, from md up only', () => {
    const html = render(fastStartedHoursAgo(8), 'Fat burning');

    assert.ok(textOf(html).includes('· Fat burning'), `expected the stage after a middle dot: ${html}`);
    assert.ok(html.includes('hidden md:inline'), `the stage must be md:-only so the pill stays short: ${html}`);
  });

  it('renders no stage and no stray dot when the caller passes none', () => {
    const html = render(fastStartedHoursAgo(8));

    assert.ok(!textOf(html).includes('·'), `no separator without a stage to separate: ${html}`);
    assert.ok(!html.includes('md:inline'), `no md:-only span exists without a stage: ${html}`);
  });
});
