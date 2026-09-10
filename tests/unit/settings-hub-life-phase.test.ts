/**
 * The settings hub's life-phase row, and the line under it (M215 spec 01).
 *
 * Two claims are worth a test, and neither of them is "the JSX was typed":
 *
 *  1. THE ROW IS NOT GATED. The fieldset behind it asks nobody who answered
 *     "male", and before this milestone the whole question lived inside a card
 *     on `/settings/goals`, reachable only by somebody who already knew it was
 *     there. The row has to render for an account that has answered NOTHING,
 *     including the biological sex question, or the page it opens is as
 *     undiscoverable as the fieldset was.
 *  2. THE LINE IS DERIVED. "Not active" for no status, and the phase with the
 *     number the stored date implies once there is one.
 *
 * ── Why the render is the empty-account case ──────────────────────────────
 *
 * `renderToStaticMarkup` runs no effects, so the hub's device reads never
 * resolve: this render IS an account with no height, no birth year, no
 * biological sex and no life phase on file. That is exactly the account the
 * row must not disappear for.
 *
 * ── Every assertion has a control ─────────────────────────────────────────
 *
 * `hasLifePhaseRow` is checked against a fixture that carries the neighbouring
 * goals row and nothing else, so a predicate that matched any settings markup
 * would fail here instead of passing quietly. Same for the derived line: each
 * status is asserted against the key the OTHER status would have produced.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import SettingsIndex from '../../app/routes/settings._index';
import { reproductiveStatusLine } from '../../app/lib/reproductive-status-line';
import enCommon from '../../app/i18n/locales/en/common.json';
import type { PublicConfig } from '../../app/config/public-config';

/** An instance with sync configured, which is the richest hub (most rows render). */
const PUBLIC_CONFIG: PublicConfig = {
  syncServerUrl: 'https://sync.openplate.test',
  analytics: null,
  instancePreset: null,
  managed: false,
};

/**
 * The hub, rendered under a router whose ROOT carries the public config, which
 * is the channel `useSyncServerUrl()` and `useInstancePolicy()` actually read.
 *
 * @returns the page's markup.
 */
function renderHub(): string {
  const router = createMemoryRouter(
    [
      {
        id: 'root',
        path: '/',
        loader: () => ({ publicConfig: PUBLIC_CONFIG }),
        children: [{ index: true, element: withI18n(createElement(SettingsIndex)) }],
      },
    ],
    { initialEntries: ['/'], hydrationData: { loaderData: { root: { publicConfig: PUBLIC_CONFIG } } } },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** Does this markup carry a row that opens the life-phase page and names it? */
function hasLifePhaseRow(markup: string): boolean {
  return markup.includes('href="/settings/life-phase"') && markup.includes(enCommon.lifePhase.title);
}

/**
 * Settings markup WITHOUT the row: the neighbouring goals row on its own. The
 * control that makes `hasLifePhaseRow` falsifiable.
 */
const HUB_WITHOUT_THE_ROW = `<a href="/settings/goals"><span>${enCommon.settings.rows.goals.title}</span></a>`;

describe('the settings hub life-phase row', () => {
  it('renders for an account that has answered nothing, biological sex included', () => {
    assert.equal(hasLifePhaseRow(renderHub()), true, renderHub().slice(0, 600));
  });

  it('the control: the same predicate is false for hub markup that lacks the row', () => {
    assert.equal(hasLifePhaseRow(HUB_WITHOUT_THE_ROW), false);
  });

  it('resolves its copy rather than rendering a raw key', () => {
    assert.equal(renderHub().includes('lifePhase.'), false);
  });
});

/** Identity translator: the assertions read the KEY, so they stay language-proof. */
const t = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`;

const TODAY = '2026-09-09';
/** 140 days out is 20 weeks until the due date, which is gestation week 20. */
const DUE_DATE_20_WEEKS_ALONG = '2027-01-27';

describe('reproductiveStatusLine', () => {
  it('says "not active" when no status is stored', () => {
    const line = reproductiveStatusLine({
      reproductiveStatus: null,
      pregnancyDueDate: null,
      lactationStartDate: null,
      today: TODAY,
      t,
    });
    assert.equal(line, 'lifePhase.inactive');
  });

  it('treats an explicit "none" the same as nothing stored', () => {
    const line = reproductiveStatusLine({
      reproductiveStatus: 'none',
      pregnancyDueDate: null,
      lactationStartDate: null,
      today: TODAY,
      t,
    });
    assert.equal(line, 'lifePhase.inactive');
  });

  it('names the gestation week a due date implies', () => {
    const line = reproductiveStatusLine({
      reproductiveStatus: 'pregnant',
      pregnancyDueDate: DUE_DATE_20_WEEKS_ALONG,
      lactationStartDate: null,
      today: TODAY,
      t,
    });
    assert.equal(line, 'lifePhase.summary.pregnant:{"week":20}');
  });

  it('counts the months of breastfeeding from the birth date', () => {
    const line = reproductiveStatusLine({
      reproductiveStatus: 'lactating',
      pregnancyDueDate: null,
      lactationStartDate: '2026-05-09',
      today: TODAY,
      t,
    });
    assert.equal(line, 'lifePhase.summary.lactating:{"count":4}');
  });

  it('names the phase alone while its date is missing, rather than reporting week 1', () => {
    // The control for the two cases above: the same status, the same clock, no
    // date, and the number is gone instead of fabricated.
    assert.equal(
      reproductiveStatusLine({
        reproductiveStatus: 'pregnant',
        pregnancyDueDate: null,
        lactationStartDate: null,
        today: TODAY,
        t,
      }),
      'bodyMetrics.reproductive.pregnant',
    );
    assert.equal(
      reproductiveStatusLine({
        reproductiveStatus: 'lactating',
        pregnancyDueDate: null,
        lactationStartDate: null,
        today: TODAY,
        t,
      }),
      'bodyMetrics.reproductive.lactating',
    );
  });
});
