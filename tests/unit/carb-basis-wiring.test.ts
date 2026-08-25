/**
 * WIRING guard for spec 13 (M123): `carbBasis` computed correctly at its
 * source and then silently dropped by a consumer, the exact defect class
 * `authoritative-net-carbs-wiring.test.ts` documents for
 * `authoritativeNetCarbsPer100g` — this file is that same class, one field
 * over. `tests/unit/carb-basis.test.ts` already covers `computeNetCarbsFromParts`
 * thoroughly AS A FUNCTION; it could not catch a caller that built the value
 * correctly and then forgot to pass it through. So this file drives the REAL
 * render path of every surface that shows a per-100g net-carb figure for a
 * food with no authoritative figure of its own, against one shared EU-basis
 * fixture, and asserts the pixels — both the number and the traffic-light
 * colour.
 *
 * The fixture: a hand-typed / label-scanned food whose printed panel is EU
 * convention (`carbBasis: 'available'`) — 21.7 g carbs, 42.8 g fibre already
 * excluded from that figure, and NO authoritative `netCarbsPer100g` (the
 * state of every `source: 'user'` personal food and its logs — see
 * `LocalPersonalFood.carbBasis`'s doc comment in `#app/lib/local-store/schema`).
 * The naive `carbs - fiber - polyols` fallback computes a confident, wrong
 * `-21.1` (clamped/floored to a GREEN "low carb" reading depending on the
 * surface) for this fixture; the correct, basis-aware answer is 21.7 (RED,
 * "high"). If a surface stops threading `carbBasis` through to
 * `computeMacroPreview`/`chipCarbStatus`, it silently reverts to the wrong
 * number and the wrong colour — exactly the failure mode this file exists to
 * catch, and exactly what the M123/10 checkpoint that opened spec 13
 * described as "the dangerous direction" for a low-carb tracker.
 *
 * One surface is deliberately NOT tested here: the plate-scan confirm card
 * (`ConfirmDraftForm` in `app/routes/scan.tsx`). A plate item is an AI
 * estimate off a photo of food, never a transcribed printed panel, so it has
 * no `carbBasis` to carry — see the comment beside its `computeMacroPreview`
 * call for the full reasoning.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import i18next from '../../app/i18n/i18n';
import { SearchResultRow } from '../../app/components/add/search-result-row';
import { PortionStep, type AddSearchCandidate } from '../../app/routes/add';
import { EntryReceipt, EditEntry } from '../../app/routes/diary.entry.$id';
import { formatEntryNetCarbs } from '../../app/routes/diary';
import { localFoodToCandidate } from '../../app/lib/local-store/local-quick-add';
import { computeMacroPreview } from '../../app/lib/portion-preview';
import { carbStatusBadgeClass } from '../../app/utils/carb-status';
import type { LocalFoodLog, LocalPersonalFood } from '../../app/lib/local-store/schema';

////////////////////////////////////////////////////////////////////////////////
// Shared EU-basis fixture
////////////////////////////////////////////////////////////////////////////////

const AVAILABLE_CARBS_PER_100G = 21.7;
const FIBER_PER_100G = 42.8;
const SERVING_GRAMS = 100;
const DAY_KEY = '2026-08-25';

/** A hand-typed/label-scanned EU-panel personal food: no authoritative figure, `carbBasis: 'available'`. */
function euBasisPersonalFood(overrides: Partial<LocalPersonalFood> = {}): LocalPersonalFood {
  return {
    id: 'eu-rye-crispbread',
    name: 'German rye crispbread',
    brand: null,
    macrosPer100g: {
      carbs: AVAILABLE_CARBS_PER_100G,
      fiber: FIBER_PER_100G,
      sugars: null,
      polyols: null,
      protein: 8,
      fat: 2,
      kcal: 250,
    },
    source: 'user',
    createdAt: Date.parse(`${DAY_KEY}T00:00:00Z`),
    carbBasis: 'available',
    // `netCarbsPer100g` deliberately absent — this is exactly the
    // compute-from-parts fallback path `carbBasis` has to reach.
    ...overrides,
  };
}

/** Built through the REAL production factory, mirroring the food above. */
function euBasisCandidate(overrides: Partial<LocalPersonalFood> = {}): AddSearchCandidate {
  return { ...localFoodToCandidate(euBasisPersonalFood(overrides)), matchTier: null };
}

/** A logged entry for the same EU-panel food: 100 g serving, so per-serving == per-100g. */
function euBasisLog(overrides: Partial<LocalFoodLog> = {}): LocalFoodLog {
  return {
    id: 'log-eu-rye-crispbread',
    name: 'German rye crispbread',
    quantityGrams: SERVING_GRAMS,
    macros: {
      carbs: AVAILABLE_CARBS_PER_100G,
      fiber: FIBER_PER_100G,
      sugars: null,
      polyols: null,
      protein: 8,
      fat: 2,
      kcal: 250,
    },
    mealType: null,
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: DAY_KEY,
    loggedAt: Date.parse(`${DAY_KEY}T12:00:00Z`),
    createdAt: Date.parse(`${DAY_KEY}T12:00:00Z`),
    logBatchId: null,
    carbBasis: 'available',
    // `netCarbsPer100g` deliberately absent, same reason as the food above.
    ...overrides,
  };
}

const noop = () => undefined;

/** Surface 1: the search RESULT LIST row (per-100g badge, before selection). */
function renderSearchResultRow(candidate: AddSearchCandidate): string {
  return renderToStaticMarkup(createElement(SearchResultRow, { candidate, onSelect: noop }));
}

/** Surface 2: the PORTION step for the same candidate. Needs a data router (`useNavigation`). */
function renderPortionStep(candidate: AddSearchCandidate): string {
  const element = createElement(PortionStep, {
    candidate,
    defaultMealType: 'lunch',
    returnTo: '/diary',
    logContext: { date: null, label: null, switchToTodayHref: '/add' },
    lastResult: undefined,
    onBack: noop,
  });
  const router = createMemoryRouter([{ path: '/add', element }], { initialEntries: ['/add'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** Loader data for the receipt/edit surfaces, exactly as `clientLoader` shapes it for an unlinked (no personal food) entry. */
function entryLoaderData(log: LocalFoodLog) {
  const siblings: LocalFoodLog[] = [];
  return {
    userId: 0,
    log,
    siblings,
    grams: log.quantityGrams,
    snapshotMacros: log.macros,
    // No linked food (`foodId: null`) — the basis reconstructs from the log's
    // own per-serving snapshot, exactly `derivePer100gBasis`'s "no honest
    // upstream basis" branch.
    basisPer100g: log.macros,
    loggedAtDate: 'Tue, Aug 25, 2026',
    loggedAtTime: '12:00 PM',
    loggedAtDateValue: DAY_KEY,
    loggedAtTimeValue: '12:00',
    todayValue: DAY_KEY,
    backTo: '/diary',
  };
}

/** Surface 3: the entry receipt hero. Uses `<Link>`/`useSubmit`, so it needs a data router. */
function renderEntryReceipt(log: LocalFoodLog): string {
  const element = createElement(EntryReceipt, { loaderData: entryLoaderData(log) });
  const router = createMemoryRouter([{ path: '/diary/entry/1', element }], { initialEntries: ['/diary/entry/1'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** Surface 4: the live edit-form preview. Same data-router requirement as the receipt. */
function renderEditEntry(log: LocalFoodLog): string {
  const element = createElement(EditEntry, { loaderData: entryLoaderData(log), actionData: undefined });
  const router = createMemoryRouter([{ path: '/diary/entry/1', element }], {
    initialEntries: ['/diary/entry/1?edit=1'],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/**
 * The one net-carb badge on a surface. Tolerates every spelling currently in
 * use ("21.7g net carbs" on the search/portion surfaces, "21.7 g net carbs /
 * 100 g" on the receipt hero, "21.7 g net carbs" on the edit preview) so a
 * copy tweak doesn't masquerade as a wiring regression.
 */
const NET_CARB_BADGE = /<span class="([^"]*)"[^>]*>\s*([\d.]+)\s*g net carbs(?:\s*\/\s*100\s*g)?\s*<\/span>/;

type NetCarbBadge = { classes: string; figure: string };

function findNetCarbBadge(html: string): NetCarbBadge {
  const match = NET_CARB_BADGE.exec(html);
  assert.ok(match, `expected a net-carb badge in the rendered markup, found none:\n${html}`);
  const [, classes, figure] = match;
  assert.ok(classes !== undefined && figure !== undefined, 'net-carb badge regex must capture classes and figure');
  return { classes, figure };
}

describe('carbBasis reaches every surface that displays a compute-from-parts net-carb figure', () => {
  it('FIXTURE CHECK: the naive (basis-blind) formula really does double-subtract fibre on this food', () => {
    const naive = computeMacroPreview({
      macrosPer100g: euBasisPersonalFood().macrosPer100g,
      grams: SERVING_GRAMS,
    });
    // 21.7 - 42.8 = -21.1, clamped at 0 by `computeMacroPreview` — a
    // confident, wrong "0 g net carbs" for a food whose real figure is 21.7.
    assert.equal(naive?.netCarbsPer100g, 0);
    assert.notEqual(AVAILABLE_CARBS_PER_100G, 0);
  });

  it('the search-result row shows the basis-aware figure, not the double-subtracted local recompute', () => {
    const { figure } = findNetCarbBadge(renderSearchResultRow(euBasisCandidate()));
    assert.equal(figure, String(AVAILABLE_CARBS_PER_100G));
  });

  it('colours the search-result traffic light from the basis-aware figure — must not render green/low', () => {
    const { classes } = findNetCarbBadge(renderSearchResultRow(euBasisCandidate()));
    assert.ok(classes.includes(carbStatusBadgeClass.high), `expected the high-carb palette, got: ${classes}`);
    assert.equal(classes.includes('green'), false, `a 21.7 g net-carb food rendered a low-carb badge: ${classes}`);
  });

  it('the portion step shows the basis-aware figure for the same candidate', () => {
    const { figure } = findNetCarbBadge(renderPortionStep(euBasisCandidate()));
    assert.equal(figure, String(AVAILABLE_CARBS_PER_100G));
  });

  it('colours the portion-step traffic light from the basis-aware figure too', () => {
    const { classes } = findNetCarbBadge(renderPortionStep(euBasisCandidate()));
    assert.ok(classes.includes(carbStatusBadgeClass.high), `expected the high-carb palette, got: ${classes}`);
    assert.equal(classes.includes('green'), false, `a 21.7 g net-carb food rendered a low-carb badge: ${classes}`);
  });

  it('the search list and the portion step never contradict each other for the same food', () => {
    const candidate = euBasisCandidate();
    const listFigure = findNetCarbBadge(renderSearchResultRow(candidate)).figure;
    const portionFigure = findNetCarbBadge(renderPortionStep(candidate)).figure;
    assert.equal(listFigure, portionFigure);
  });

  it('the entry receipt hero shows the basis-aware figure, not the double-subtracted local recompute', () => {
    const { figure } = findNetCarbBadge(renderEntryReceipt(euBasisLog()));
    assert.equal(figure, String(AVAILABLE_CARBS_PER_100G));
  });

  it('colours the receipt hero from the basis-aware figure — a 21.7 g entry must not read green', () => {
    const { classes } = findNetCarbBadge(renderEntryReceipt(euBasisLog()));
    assert.ok(classes.includes(carbStatusBadgeClass.high), `expected the high-carb palette, got: ${classes}`);
    assert.equal(classes.includes('green'), false, `a 21.7 g net-carb entry rendered a low-carb badge: ${classes}`);
  });

  it('the live edit-form preview shows the basis-aware figure — the exact surface a macro edit always reaches (netCarbsPer100g clears, carbBasis does not)', () => {
    const { figure } = findNetCarbBadge(renderEditEntry(euBasisLog()));
    assert.equal(figure, String(AVAILABLE_CARBS_PER_100G));
  });

  it('colours the live edit-form preview from the basis-aware figure too', () => {
    const { classes } = findNetCarbBadge(renderEditEntry(euBasisLog()));
    assert.ok(classes.includes(carbStatusBadgeClass.high), `expected the high-carb palette, got: ${classes}`);
    assert.equal(classes.includes('green'), false, `a 21.7 g net-carb entry rendered a low-carb badge: ${classes}`);
  });

  it('the receipt hero and the diary row agree on the same entry, to the character — the exact disagreement spec 13 was reopened over', () => {
    const log = euBasisLog();
    const heroFigure = findNetCarbBadge(renderEntryReceipt(log)).figure;
    assert.equal(`${heroFigure}g net carbs`, formatEntryNetCarbs(log, i18next.t, 'en'));
  });

  it('a `total`-basis food is unaffected — still subtracts fibre, still renders correctly', () => {
    const candidate = euBasisCandidate({ carbBasis: 'total' });
    const { figure, classes } = findNetCarbBadge(renderSearchResultRow(candidate));
    // 21.7 - 42.8 clamped at 0 — the correct `total`-basis answer for these
    // parts, and genuinely low-carb (0 <= 5).
    assert.equal(figure, '0');
    assert.ok(classes.includes(carbStatusBadgeClass.low), `expected the low-carb palette, got: ${classes}`);
  });

  it('an UNKNOWN basis (absent, every pre-spec-13 row) is unaffected — still today\'s formula, unchanged', () => {
    const candidate = euBasisCandidate({ carbBasis: undefined });
    const { figure } = findNetCarbBadge(renderSearchResultRow(candidate));
    assert.equal(figure, '0');
  });
});
