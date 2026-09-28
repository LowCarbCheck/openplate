/**
 * The settings hub's group model (M215 spec 04).
 *
 * Three claims, none of them "the JSX was typed":
 *
 *  1. SEVEN GROUPS, IN ONE ORDER. The hub is grouped around the person now,
 *     so "About you" and "Eating and targets" come first and the account
 *     features stopped sharing a group with two device-local lists. The order
 *     is the whole point of the regroup, so it is pinned as a sequence rather
 *     than as a set.
 *  2. THE PLAN ROW EXISTS, AND ONLY WHERE IT SHOULD. Before this spec the plan
 *     page was reachable only from three contextual moments. It now has a hub
 *     row, gated on the instance selling a plan at all, and the control is the
 *     same call with that one fact flipped.
 *  3. THE NUTRITION ROW STILL READS THE PERSON'S OWN FIGURE. The row that
 *     replaced "Ziele" keeps the live line off the device, carbs first and
 *     calories for a calorie-only tracker, and only says what the page holds
 *     when there is no goal at all. A static subtitle here would have quietly
 *     dropped a number the hub used to show.
 *  4. AN EMPTY GROUP DRAWS NOTHING. "Account and plan" is built entirely from
 *     conditional rows, so on an instance with no sync server, no biller and
 *     an ordinary account every one of them is hidden. Without the filter in
 *     `buildSettingsHubGroups` the page would draw that heading over nothing.
 *
 * ── Why the labels are resolved, never typed ──────────────────────────────
 *
 * Every expected label comes out of the SHIPPED English catalog, so this file
 * says nothing about German and a renamed key fails here instead of rendering
 * `settings.groups.account` to a person.
 *
 * ── The mutation that proves the empty-group test can fail ────────────────
 *
 * Removing `.filter((group) => group.rows.length > 0)` from
 * `buildSettingsHubGroups` makes both empty-group assertions fail: the model
 * keeps a group with zero rows, and the render draws its heading.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import i18next from '../../app/i18n/i18n';
import { withI18n } from './trends-i18n-harness';
import SettingsIndex, { buildSettingsHubGroups, type SettingsHubFacts } from '../../app/routes/settings._index';
import type { LocalProfileGoals } from '../../app/lib/local-store';
import enCommon from '../../app/i18n/locales/en/common.json';
import { PLAN_PAGE_HREF } from '../../app/lib/plans/plans-door';
import type { PublicConfig } from '../../app/config/public-config';

/** The REAL catalog: the labels below are resolved, not transcribed. */
const t = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) =>
  i18next.t(key, params ?? {});

/** The richest instance: sync configured, a biller behind it, an administrator looking. */
const RICHEST: SettingsHubFacts = {
  t,
  aiStatus: null,
  lifePhaseStatus: null,
  preferencesStatus: null,
  notificationsStatus: null,
  // Nothing stored, which is the account the static line is written for.
  goals: null,
  fastingSettings: null,
  accountStatus: 'someone@example.test',
  aiComesFromTheInstance: false,
  hasSyncServer: true,
  isAdmin: true,
  hasPlanPage: true,
  version: '1.2.3',
};

/** The seven headings, in the order the spec fixes, read off the shipped catalog. */
const EXPECTED_LABELS = [
  enCommon.settings.groups.profile,
  enCommon.settings.groups.nutrition,
  enCommon.settings.groups.scanning,
  enCommon.settings.groups.appearance,
  enCommon.settings.groups.account,
  enCommon.settings.groups.lists,
  enCommon.settings.groups.about,
];

/** The rows of one group, or `[]` when the group is not on the page at all. */
function rowsOf(facts: SettingsHubFacts, label: string) {
  return buildSettingsHubGroups(facts).find((group) => group.label === label)?.rows ?? [];
}

describe('the settings hub groups', () => {
  it('renders seven groups in the order the regroup fixes', () => {
    assert.deepEqual(
      buildSettingsHubGroups(RICHEST).map((group) => group.label),
      EXPECTED_LABELS,
    );
  });

  it('puts the profile and life-phase rows first, before anything about food', () => {
    const [first] = buildSettingsHubGroups(RICHEST);
    assert.deepEqual(
      first?.rows.map((row) => row.to),
      ['/settings/profile', '/settings/life-phase'],
    );
  });

  it('keeps the device-local lists out of the account group', () => {
    const accountRows = rowsOf(RICHEST, enCommon.settings.groups.account).map((row) => row.to);
    assert.deepEqual(accountRows, [
      '/settings/account',
      PLAN_PAGE_HREF,
      '/settings/sharing',
      '/settings/research',
      '/admin',
    ]);
    assert.deepEqual(
      rowsOf(RICHEST, enCommon.settings.groups.lists).map((row) => row.to),
      ['/foods', '/meals', '/settings/data'],
    );
  });
});

/** A stored goals row with nothing set, the starting point every case below overrides. */
const NOTHING_SET: LocalProfileGoals = {
  timezone: null,
  goalNetCarbsCeilingG: null,
  goalProteinFloorG: null,
  goalKcalTarget: null,
  targetWeightKg: null,
  trackingFocus: null,
  onboardingCompletedAt: null,
  updatedAt: 0,
};

/** A stored goals row carrying only what the assertion is about. */
function goalsWith(stored: Partial<LocalProfileGoals>): LocalProfileGoals {
  return { ...NOTHING_SET, ...stored };
}

describe('the nutrition row status line', () => {
  it('reads the ceiling the person set, not a description of the page', () => {
    const [row] = rowsOf(
      { ...RICHEST, goals: goalsWith({ goalNetCarbsCeilingG: 20 }) },
      enCommon.settings.groups.nutrition,
    );
    assert.equal(row?.status, t('settings.rows.goals.carbs', { grams: 20 }));
    // The catalog really does put the figure in the sentence, so the assertion
    // above is not comparing two copies of an unresolved key.
    assert.ok(row?.status?.includes('20'));
  });

  it('falls back to calories for a tracker with no carb ceiling', () => {
    const [row] = rowsOf(
      { ...RICHEST, goals: goalsWith({ goalKcalTarget: 1800 }) },
      enCommon.settings.groups.nutrition,
    );
    assert.equal(row?.status, t('settings.rows.goals.calories', { kcal: 1800 }));
  });

  it('the control: with no goal stored the row names what the page holds instead', () => {
    const [row] = rowsOf(RICHEST, enCommon.settings.groups.nutrition);
    assert.equal(row?.status, enCommon.settings.rows.nutrition.status);
  });

  it('says nothing at all while the device read is still in flight', () => {
    const [row] = rowsOf({ ...RICHEST, goals: undefined }, enCommon.settings.groups.nutrition);
    assert.equal(row?.status, null);
  });
});

describe('the plan row', () => {
  it('sits in the account group, at the plan page address, when the instance sells a plan', () => {
    const row = rowsOf(RICHEST, enCommon.settings.groups.account).find((candidate) => candidate.to === PLAN_PAGE_HREF);
    assert.equal(row?.title, enCommon.settings.rows.plan.title);
    assert.equal(row?.status, enCommon.settings.rows.plan.status);
  });

  it('the control: no plan row anywhere on an instance with no biller', () => {
    const withoutPlans = buildSettingsHubGroups({ ...RICHEST, hasPlanPage: false });
    const everyRow = withoutPlans.flatMap((group) => group.rows);
    assert.equal(
      everyRow.some((row) => row.to === PLAN_PAGE_HREF),
      false,
    );
    // CONTROL for the control: the group itself is still there, so the
    // assertion above is about the row and not about a missing group.
    assert.ok(withoutPlans.some((group) => group.label === enCommon.settings.groups.account));
  });
});

/** An instance with no sync server, which is what empties the account group. */
const NO_SYNC_CONFIG: PublicConfig = {
  syncServerUrl: null,
  analytics: null,
  instancePreset: null,
  managed: false,
  foodDbBackfill: false,
};

/** The hub, rendered under a router whose ROOT carries the public config the hooks read. */
function renderHub(config: PublicConfig): string {
  const router = createMemoryRouter(
    [
      {
        id: 'root',
        path: '/',
        loader: () => ({ publicConfig: config }),
        children: [{ index: true, element: withI18n(createElement(SettingsIndex)) }],
      },
    ],
    { initialEntries: ['/'], hydrationData: { loaderData: { root: { publicConfig: config } } } },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** Counts non-overlapping occurrences of `needle` in `haystack`. */
function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The `class="..."` value of every `<a>` in `markup`, one row link per entry. */
function anchorClassLists(markup: string): string[] {
  return [...markup.matchAll(/<a\b[^>]*\bclass="([^"]*)"/g)].map((match) => match[1] ?? '');
}

describe('the hub reads as one inset grouped list, not a stack of cards', () => {
  const markup = renderHub(NO_SYNC_CONFIG);
  const renderedGroupCount = EXPECTED_LABELS.filter((label) => label !== enCommon.settings.groups.account).length;

  it('draws exactly one list container, with one hairline divider set, per rendered group', () => {
    // THE SLOT IS THE IDENTITY, NOT THE RADIUS. This counted `rounded-2xl`
    // until M243 spec 03 moved the inset onto the ladder's card step, and the
    // ladder itself is gone since 2026-09-22 (square corners everywhere): a
    // radius-as-identity check says nothing about the container and everything
    // about a taste call. `data-slot` is put on the container by
    // `SettingsGroup` and by nothing else.
    //
    // CONTROL: the old per-row card markup (a box on every row, `space-y-2`
    // between rows) carried zero of either attribute, so both counts would be 0
    // against 5 rendered groups if the grouped list regressed to one box a row.
    assert.equal(
      countOf(markup, 'data-slot="settings-inset"'),
      renderedGroupCount,
      `expected one inset list container per rendered group (${renderedGroupCount})`,
    );
    assert.equal(
      countOf(markup, 'divide-y'),
      renderedGroupCount,
      `expected one divide-y row-divider set per rendered group (${renderedGroupCount})`,
    );
  });

  it('gives no row its own box: no row Link carries a radius or a border of its own', () => {
    const rowClassLists = anchorClassLists(markup);
    // CONTROL for the control: the page really does render row links, so an
    // empty list here would make the assertions below pass for the wrong
    // reason (nothing to check).
    assert.ok(rowClassLists.length > 0, 'expected at least one row <a> in the rendered hub');
    for (const classList of rowClassLists) {
      const tokens = classList.split(/\s+/);
      // ANY radius utility, whole or variant-prefixed, not one class typed
      // here: a row that came back as its own box would come back wearing
      // whatever radius was fashionable that week, and corners are square
      // app-wide now anyway (2026-09-22), so a row link may carry none at all.
      const radiusToken = tokens.find((token) => /(?:^|:)rounded(?:-|$)/.test(token));
      assert.equal(radiusToken, undefined, `a row link still carries its own radius box: "${classList}"`);
      assert.ok(!tokens.includes('border'), `a row link still carries its own border: "${classList}"`);
    }
  });

  it('keeps a grey icon on every row, and never a teal tile', () => {
    // The icon survived the de-tealising (M243 spec 03) because fifteen rows in
    // six languages are scanned by shape before they are read. What went is the
    // `bg-muted text-primary` tile it sat on.
    const iconBoxes = [...markup.matchAll(/<span class="(flex size-9[^"]*)"/g)].map((found) => found[1] ?? '');
    assert.ok(iconBoxes.length > 0, 'expected an icon box on the rows');
    for (const classList of iconBoxes) {
      const tokens = classList.split(/\s+/);
      assert.ok(tokens.includes('text-muted-foreground'), `a row icon is not grey: "${classList}"`);
      assert.ok(!tokens.includes('text-primary'), `a row icon is still teal: "${classList}"`);
      assert.ok(!tokens.includes('bg-muted'), `a row icon still sits on a tile: "${classList}"`);
    }
    // CONTROL: the same reader DOES see a fill and a teal ink when they are
    // there, so the three absences above are not a reader that sees nothing.
    const sample = 'flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary';
    const sampleTokens = sample.split(/\s+/);
    assert.ok(sampleTokens.includes('bg-muted') && sampleTokens.includes('text-primary'));
  });
});

describe('an empty group', () => {
  it('is dropped from the model when every one of its rows is hidden', () => {
    const groups = buildSettingsHubGroups({
      ...RICHEST,
      hasSyncServer: false,
      isAdmin: false,
      hasPlanPage: false,
    });
    assert.equal(
      groups.some((group) => group.label === enCommon.settings.groups.account),
      false,
    );
    // CONTROL: the same call keeps every group that still has a row, so the
    // assertion above is not passing because the model came back empty.
    assert.deepEqual(
      groups.map((group) => group.label),
      EXPECTED_LABELS.filter((label) => label !== enCommon.settings.groups.account),
    );
  });

  it('draws no heading on the page: an empty group is not a bare eyebrow', () => {
    const markup = renderHub(NO_SYNC_CONFIG);
    assert.equal(markup.includes(enCommon.settings.groups.account), false, markup.slice(0, 600));
    // CONTROL: the render really did produce headings, so the absence above is
    // about this one group rather than about an empty page.
    assert.ok(markup.includes(enCommon.settings.groups.lists));
    assert.ok(markup.includes(enCommon.settings.groups.profile));
  });
});
