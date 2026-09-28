/**
 * `shouldPromptStatusUpdate` (M206/04) and the banner that renders its
 * answer. Mirrors `backup-nudge.test.ts`'s shape: `describe` blocks per
 * scenario, threshold boundaries stated explicitly with a day-before and a
 * day-after case, and, the standing rule from this repo's other test
 * suites, every assertion that can pass vacuously gets a control that makes
 * it fail.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { LACTATION_STALE_THRESHOLD_MONTHS, shouldPromptStatusUpdate } from '../../app/lib/reproductive-status-nudge';
import { ReproductiveStatusPromptBanner } from '../../app/components/reproductive-status-prompt-banner';

/** An arbitrary pregnancy due date, reused across the pregnant-status cases. */
const DUE_DATE = '2026-01-15';
/** An arbitrary lactation start date, exactly 24 months before `2026-01-15`. */
const LACTATION_START_DATE = '2024-01-15';

describe('shouldPromptStatusUpdate, pregnant, due date', () => {
  it('is false the day before the due date', () => {
    assert.equal(
      shouldPromptStatusUpdate({
        reproductiveStatus: 'pregnant',
        dueDate: DUE_DATE,
        lactationStartDate: null,
        today: new Date(Date.UTC(2026, 0, 14)),
      }),
      false,
    );
  });

  it('is false on the due date itself', () => {
    assert.equal(
      shouldPromptStatusUpdate({
        reproductiveStatus: 'pregnant',
        dueDate: DUE_DATE,
        lactationStartDate: null,
        today: new Date(Date.UTC(2026, 0, 15)),
      }),
      false,
    );
  });

  it('is true the day after the due date', () => {
    assert.equal(
      shouldPromptStatusUpdate({
        reproductiveStatus: 'pregnant',
        dueDate: DUE_DATE,
        lactationStartDate: null,
        today: new Date(Date.UTC(2026, 0, 16)),
      }),
      true,
    );
  });
});

describe('shouldPromptStatusUpdate, lactating, the stale threshold', () => {
  it(`is false at exactly ${LACTATION_STALE_THRESHOLD_MONTHS} months`, () => {
    assert.equal(
      shouldPromptStatusUpdate({
        reproductiveStatus: 'lactating',
        dueDate: null,
        lactationStartDate: LACTATION_START_DATE,
        today: new Date(Date.UTC(2026, 0, 15)),
      }),
      false,
    );
  });

  it(`is true one day past ${LACTATION_STALE_THRESHOLD_MONTHS} months`, () => {
    assert.equal(
      shouldPromptStatusUpdate({
        reproductiveStatus: 'lactating',
        dueDate: null,
        lactationStartDate: LACTATION_START_DATE,
        today: new Date(Date.UTC(2026, 0, 16)),
      }),
      true,
    );
  });

  // The control for both cases above: well short of the threshold, the same
  // start date must still read false.
  it('is false well short of the threshold', () => {
    assert.equal(
      shouldPromptStatusUpdate({
        reproductiveStatus: 'lactating',
        dueDate: null,
        lactationStartDate: LACTATION_START_DATE,
        today: new Date(Date.UTC(2025, 5, 1)),
      }),
      false,
    );
  });
});

describe('shouldPromptStatusUpdate, statuses that never prompt', () => {
  it('is false for "none", even with a stale due date left over from a prior status', () => {
    assert.equal(
      shouldPromptStatusUpdate({
        reproductiveStatus: 'none',
        dueDate: DUE_DATE,
        lactationStartDate: LACTATION_START_DATE,
        today: new Date(Date.UTC(2026, 6, 1)),
      }),
      false,
    );
  });

  it('is false for null, even with a stale due date left over from a prior status', () => {
    assert.equal(
      shouldPromptStatusUpdate({
        reproductiveStatus: null,
        dueDate: DUE_DATE,
        lactationStartDate: LACTATION_START_DATE,
        today: new Date(Date.UTC(2026, 6, 1)),
      }),
      false,
    );
  });

  // The control for both cases above: without it, a function that ignored
  // `reproductiveStatus` entirely and just looked at the dates would pass
  // them too. The same clock and the same dates read true once the status
  // actually says "pregnant".
  it('is true for the control: the same clock and dates read true under "pregnant"', () => {
    assert.equal(
      shouldPromptStatusUpdate({
        reproductiveStatus: 'pregnant',
        dueDate: DUE_DATE,
        lactationStartDate: LACTATION_START_DATE,
        today: new Date(Date.UTC(2026, 6, 1)),
      }),
      true,
    );
  });
});

describe('shouldPromptStatusUpdate, the relevant date is missing', () => {
  it('is false for "pregnant" with no due date stored', () => {
    assert.equal(
      shouldPromptStatusUpdate({
        reproductiveStatus: 'pregnant',
        dueDate: null,
        lactationStartDate: null,
        today: new Date(Date.UTC(2026, 6, 1)),
      }),
      false,
    );
  });

  it('is false for "lactating" with no start date stored', () => {
    assert.equal(
      shouldPromptStatusUpdate({
        reproductiveStatus: 'lactating',
        dueDate: null,
        lactationStartDate: null,
        today: new Date(Date.UTC(2026, 6, 1)),
      }),
      false,
    );
  });

  // The control for both cases above: the same clock, the same status, but
  // the date PRESENT reads true, so the false above is the missing date and
  // not some other reason.
  it('is true for the control: the same clock and status read true once the due date is present', () => {
    assert.equal(
      shouldPromptStatusUpdate({
        reproductiveStatus: 'pregnant',
        dueDate: DUE_DATE,
        lactationStartDate: null,
        today: new Date(Date.UTC(2026, 6, 1)),
      }),
      true,
    );
  });
});

/**
 * The banner, rendered for one set of props.
 *
 * A memory router because the banner carries a `<Link>`, and the i18n harness
 * because its copy comes from the real English catalog, matching
 * `describe-route.test.ts`'s pattern for a component that reads translations.
 */
function renderBanner(props: Parameters<typeof ReproductiveStatusPromptBanner>[0]): string {
  const element = createElement(ReproductiveStatusPromptBanner, props);
  const router = createMemoryRouter([{ path: '/dashboard', element: withI18n(element) }], {
    initialEntries: ['/dashboard'],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe('ReproductiveStatusPromptBanner', () => {
  it('links to /settings/life-phase once the due date has passed', () => {
    const markup = renderBanner({
      reproductiveStatus: 'pregnant',
      dueDate: DUE_DATE,
      lactationStartDate: null,
      today: new Date(Date.UTC(2026, 0, 16)),
    });
    // The life phase left `/settings/goals` in M215 spec 01. A banner still
    // pointing at the goals page would land somebody on a card that no longer
    // asks the question it just asked them about.
    assert.match(markup, /href="\/settings\/life-phase"/, 'the banner no longer links to the life-phase page');
    assert.doesNotMatch(markup, /href="\/settings\/goals"/, 'the banner still links to the old goals page');
  });

  it('renders nothing for a due date that has not passed yet', () => {
    // The control for the case above: without it, a banner that always
    // rendered would pass the link assertion too.
    const markup = renderBanner({
      reproductiveStatus: 'pregnant',
      dueDate: DUE_DATE,
      lactationStartDate: null,
      today: new Date(Date.UTC(2025, 11, 1)),
    });
    assert.equal(markup, '', 'the banner rendered even though the due date has not passed');
  });
});
