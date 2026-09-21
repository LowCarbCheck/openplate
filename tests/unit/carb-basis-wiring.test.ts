/**
 * WIRING guard for spec 13 (M123): `carbBasis` computed correctly at its
 * source and then silently dropped by a consumer, the exact defect class
 * `authoritative-net-carbs-wiring.test.ts` documents for
 * `authoritativeNetCarbsPer100g`, this file is that same class, one field
 * over. `tests/unit/carb-basis.test.ts` already covers `computeNetCarbsFromParts`
 * thoroughly AS A FUNCTION; it could not catch a caller that built the value
 * correctly and then forgot to pass it through. So this file drives the REAL
 * render path of every surface that shows a per-100g net-carb figure for a
 * food with no authoritative figure of its own, against one shared EU-basis
 * fixture, and asserts the pixels, both the number and the traffic-light
 * colour.
 *
 * The fixture: a hand-typed / label-scanned food whose printed panel is EU
 * convention (`carbBasis: 'available'`), 21.7 g carbs, 42.8 g fibre already
 * excluded from that figure, and NO authoritative `netCarbsPer100g` (the
 * state of every `source: 'user'` personal food and its logs, see
 * `LocalPersonalFood.carbBasis`'s doc comment in `#app/lib/local-store/schema`).
 * The naive `carbs - fiber - polyols` fallback computes a confident, wrong
 * `-21.1` (clamped/floored to a GREEN "low carb" reading depending on the
 * surface) for this fixture; the correct, basis-aware answer is 21.7 (RED,
 * "high"). If a surface stops threading `carbBasis` through to
 * `computeMacroPreview`/`chipCarbStatus`, it silently reverts to the wrong
 * number and the wrong colour, exactly the failure mode this file exists to
 * catch, and exactly what the M123/10 checkpoint that opened spec 13
 * described as "the dangerous direction" for a low-carb tracker.
 *
 * The plate-scan review card (`ConfirmDraftForm` in `app/routes/scan.tsx`)
 * used to be listed here as deliberately NOT tested, on the reasoning that a
 * plate item is an AI estimate off a photo of food and so never carries a
 * `carbBasis`. That stopped being true with the M138 label merge (ADR-0005's
 * amendment): one photo task now answers per ITEM, so a plate item may come
 * back with `macroSource: 'label'` and the panel convention it was read from
 * (`IdentifiedFood.carbBasis`). The card kept computing without it, and that
 * is exactly where the defect lived, reported by the operator on 2026-09-14:
 * an item with 5.5 g carbs and 8 g fibre on an EU panel showed "0 g net
 * carbs" on the review card while the saved entry read 5.5 g, because only
 * the confirm path's hidden field threaded the basis through. The card is
 * covered below, through `computeReviewItemPreview`, the one function it
 * calls for that figure.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { parseWithZod } from '@conform-to/zod/v4';

import i18next from '../../app/i18n/i18n';
import { SearchResultRow } from '../../app/components/add/search-result-row';
import { PortionStep, type AddSearchCandidate } from '../../app/routes/add';
import { EntryReceipt, EditEntry } from '../../app/routes/diary.entry.$id';
import { formatEntryNetCarbs } from '../../app/routes/diary';
import { localFoodToCandidate } from '../../app/lib/local-store/local-quick-add';
import { computeMacroPreview } from '../../app/lib/portion-preview';
import { ConfirmDraftForm, ConfirmDraftSchema, computeReviewItemPreview } from '../../app/routes/scan';
import { toCuratedSource } from '../../app/services/food-resolution/apply-match';
import { formatMacroNumberIn } from '../../app/lib/format-macro-number';
import { carbStatusBadgeClass } from '../../app/utils/carb-status';
import type { LocalFoodLog, LocalPersonalFood } from '../../app/lib/local-store/schema';
import type { Macros } from '../../app/lib/macros';
import type { CarbBasis } from '../../app/lib/net-carbs';
import type { AppliedMatchSnapshot } from '../../app/services/food-resolution/apply-match';
import type { FoodMatch } from '../../app/services/food-resolution/types';

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
    // `netCarbsPer100g` deliberately absent, this is exactly the
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
    // No linked food (`foodId: null`), the basis reconstructs from the log's
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
    // 21.7 - 42.8 = -21.1, clamped at 0 by `computeMacroPreview`, a
    // confident, wrong "0 g net carbs" for a food whose real figure is 21.7.
    assert.equal(naive?.netCarbsPer100g, 0);
    assert.notEqual(AVAILABLE_CARBS_PER_100G, 0);
  });

  it('the search-result row shows the basis-aware figure, not the double-subtracted local recompute', () => {
    const { figure } = findNetCarbBadge(renderSearchResultRow(euBasisCandidate()));
    assert.equal(figure, String(AVAILABLE_CARBS_PER_100G));
  });

  it('colours the search-result traffic light from the basis-aware figure, must not render green/low', () => {
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

  it('colours the receipt hero from the basis-aware figure, a 21.7 g entry must not read green', () => {
    const { classes } = findNetCarbBadge(renderEntryReceipt(euBasisLog()));
    assert.ok(classes.includes(carbStatusBadgeClass.high), `expected the high-carb palette, got: ${classes}`);
    assert.equal(classes.includes('green'), false, `a 21.7 g net-carb entry rendered a low-carb badge: ${classes}`);
  });

  it('the live edit-form preview shows the basis-aware figure, the exact surface a macro edit always reaches (netCarbsPer100g clears, carbBasis does not)', () => {
    const { figure } = findNetCarbBadge(renderEditEntry(euBasisLog()));
    assert.equal(figure, String(AVAILABLE_CARBS_PER_100G));
  });

  it('colours the live edit-form preview from the basis-aware figure too', () => {
    const { classes } = findNetCarbBadge(renderEditEntry(euBasisLog()));
    assert.ok(classes.includes(carbStatusBadgeClass.high), `expected the high-carb palette, got: ${classes}`);
    assert.equal(classes.includes('green'), false, `a 21.7 g net-carb entry rendered a low-carb badge: ${classes}`);
  });

  it('the receipt hero and the diary row agree on the same entry, to the character, the exact disagreement spec 13 was reopened over', () => {
    const log = euBasisLog();
    const heroFigure = findNetCarbBadge(renderEntryReceipt(log)).figure;
    assert.equal(`${heroFigure} g net carbs`, formatEntryNetCarbs(log, i18next.t, 'en'));
  });

  it('a `total`-basis food is unaffected, still subtracts fibre, still renders correctly', () => {
    const candidate = euBasisCandidate({ carbBasis: 'total' });
    const { figure, classes } = findNetCarbBadge(renderSearchResultRow(candidate));
    // 21.7 - 42.8 clamped at 0, the correct `total`-basis answer for these
    // parts, and genuinely low-carb (0 <= 5).
    assert.equal(figure, '0');
    assert.ok(classes.includes(carbStatusBadgeClass.low), `expected the low-carb palette, got: ${classes}`);
  });

  it('an UNKNOWN basis (absent, every pre-spec-13 row) is unaffected, still today\'s formula, unchanged', () => {
    const candidate = euBasisCandidate({ carbBasis: undefined });
    const { figure } = findNetCarbBadge(renderSearchResultRow(candidate));
    assert.equal(figure, '0');
  });
});

////////////////////////////////////////////////////////////////////////////////
// Surface 5: the plate-scan review card
////////////////////////////////////////////////////////////////////////////////

/** The reported item: an EU panel whose fibre exceeds its carbohydrate figure. */
const SCAN_CARBS_PER_100G = 5.5;
const SCAN_FIBER_PER_100G = 8;

/** The item's live per-100g macro field values, as the review card reads them off the form. */
const SCAN_MACROS_PER_100G: Macros = {
  carbs: SCAN_CARBS_PER_100G,
  fiber: SCAN_FIBER_PER_100G,
  sugars: null,
  polyols: null,
  protein: 10,
  fat: 20,
  kcal: 300,
};

/**
 * No curated match applied, which is the state the report was made in: every
 * field `undefined`/`null`, so `authoritativeNetCarbsPer100g` is absent and the
 * card is on the compute-from-parts path the basis governs.
 */
const NO_APPLIED_MATCH: AppliedMatchSnapshot = {
  netCarbsPer100g: undefined,
  carbBasis: undefined,
  attribution: null,
  micronutrientsPer100g: undefined,
};

describe('the plate-scan review card honours a label item\'s own panel convention', () => {
  it('an EU-panel item reports its printed carbohydrate figure, not the double-subtracted one', () => {
    const preview = computeReviewItemPreview({
      macrosPer100g: SCAN_MACROS_PER_100G,
      grams: 100,
      identifiedCarbBasis: 'available',
      appliedSnapshot: NO_APPLIED_MATCH,
    });
    assert.equal(preview?.netCarbsPer100g, SCAN_CARBS_PER_100G);
  });

  it('CONTROL: the same macros with no basis (a plain plate estimate) still floor to 0, so the basis is what changes the number', () => {
    const preview = computeReviewItemPreview({
      macrosPer100g: SCAN_MACROS_PER_100G,
      grams: 100,
      identifiedCarbBasis: undefined,
      appliedSnapshot: NO_APPLIED_MATCH,
    });
    // 5.5 - 8 = -2.5, floored at 0 by `computeMacroPreview`. Correct for a
    // `total`-basis reading, and the confident zero the operator saw.
    assert.equal(preview?.netCarbsPer100g, 0);
    assert.notEqual(SCAN_CARBS_PER_100G, 0);
  });

  it('falls back to the applied match\'s basis when the item carries none, exactly as the hidden `carbBasis` field does', () => {
    const preview = computeReviewItemPreview({
      macrosPer100g: SCAN_MACROS_PER_100G,
      grams: 100,
      identifiedCarbBasis: undefined,
      appliedSnapshot: { ...NO_APPLIED_MATCH, carbBasis: 'available' },
    });
    assert.equal(preview?.netCarbsPer100g, SCAN_CARBS_PER_100G);
  });

  it('the item\'s own panel wins over the applied match\'s basis, again exactly as the hidden field resolves it', () => {
    const preview = computeReviewItemPreview({
      macrosPer100g: SCAN_MACROS_PER_100G,
      grams: 100,
      identifiedCarbBasis: 'available',
      appliedSnapshot: { ...NO_APPLIED_MATCH, carbBasis: 'total' },
    });
    assert.equal(preview?.netCarbsPer100g, SCAN_CARBS_PER_100G);
  });

  it('an applied match\'s authoritative figure still wins outright, basis or not', () => {
    const preview = computeReviewItemPreview({
      macrosPer100g: SCAN_MACROS_PER_100G,
      grams: 100,
      identifiedCarbBasis: 'available',
      appliedSnapshot: { ...NO_APPLIED_MATCH, netCarbsPer100g: 3.2 },
    });
    assert.equal(preview?.netCarbsPer100g, 3.2);
  });
});

////////////////////////////////////////////////////////////////////////////////
// Surface 5b: the same review card's SANITY WARNING
////////////////////////////////////////////////////////////////////////////////

/**
 * The second half of the same wiring, and a second defect (M226): the card's
 * plausibility check ran basis-blind while the figure beside it did not.
 *
 * `checkMacroSanity`'s fourth parameter suppresses the fibre-vs-carbs
 * comparisons on an `available` basis, because an EU panel prints a
 * carbohydrate figure that already excludes the fibre row below it, so fibre
 * above carbs is ordinary there (a seed cracker, wheat bran). The call site
 * passed three arguments, so a perfectly normal EU panel was told its numbers
 * were impossible. The basis is now resolved ONCE per item and handed to both
 * `computeReviewItemPreview` and `checkMacroSanity`, so the figure and the
 * warning cannot disagree about which panel the item was read from.
 *
 * These tests drive the real card, not the checker: the checker's own rules
 * are covered by `tests/unit/macro-sanity.test.ts`. What can only be caught
 * here is the argument going missing again.
 */

const SANITY_FOOD_NAME = 'EU panel seed cracker';

/** The item's macro fields, as strings, exactly as the confirm form carries them. */
const SCAN_MACRO_FIELD_VALUES = {
  carbs: String(SCAN_CARBS_PER_100G),
  fiber: String(SCAN_FIBER_PER_100G),
  sugars: '',
  polyols: '',
  protein: '10',
  fat: '20',
  kcal: '300',
} satisfies Record<string, string>;

/** The wheat-bran match the card may have applied: `origin: 'bls'`, which derives an `available` basis. */
function euBasisMatch(): FoodMatch {
  return {
    slug: 'eu-panel-seed-cracker',
    locale: 'en',
    title: SANITY_FOOD_NAME,
    canonicalName: SANITY_FOOD_NAME,
    url: null,
    imageUrl: null,
    macrosPer100g: {
      kcal: 300,
      protein: 10,
      fat: 20,
      carbs: SCAN_CARBS_PER_100G,
      fiber: SCAN_FIBER_PER_100G,
      sugars: null,
      polyols: null,
    },
    netCarbsPer100g: SCAN_CARBS_PER_100G,
    attribution: null,
    score: 0.95,
    origin: 'bls',
    portionSize: 100,
  };
}

/** The identification for one item, with or without the panel convention the model read. */
function sanityIdentification(carbBasis: CarbBasis | undefined) {
  return {
    unreadable: false,
    foods: [
      {
        name: SANITY_FOOD_NAME,
        estimatedGrams: 100,
        confidence: 'high' as const,
        macroSource: carbBasis === undefined ? ('estimated' as const) : ('label' as const),
        flags: { pregnancy: [], allergens: [], mayContain: [] },
        carbBasis,
        macrosPer100g: {
          kcal: 300,
          protein: 10,
          fat: 20,
          carbs: SCAN_CARBS_PER_100G,
          fiber: SCAN_FIBER_PER_100G,
        },
      },
    ],
  };
}

/** The confirm form's field values for that one item. */
function sanityFormData(appliedCuratedSource: string): FormData {
  const formData = new FormData();
  formData.set('items[0].include', 'on');
  formData.set('items[0].name', SANITY_FOOD_NAME);
  formData.set('items[0].estimatedGrams', '100');
  formData.set('items[0].confidence', 'high');
  formData.set('items[0].curatedSource', appliedCuratedSource);
  for (const [key, value] of Object.entries(SCAN_MACRO_FIELD_VALUES)) {
    formData.set(`items[0].macros.${key}`, value);
  }
  return formData;
}

/**
 * Renders the REAL review card, through the real re-validation path.
 *
 * @param options.carbBasis - the model's answer for this item, `undefined` for a plain estimate.
 * @param options.applyMatch - whether a curated `bls` match is applied to the item.
 * @returns the rendered markup.
 */
function renderReviewCard({ carbBasis, applyMatch }: { carbBasis: CarbBasis | undefined; applyMatch: boolean }): string {
  const match = euBasisMatch();
  const formData = sanityFormData(applyMatch ? toCuratedSource(match.slug) : '');
  const submission = parseWithZod(formData, { schema: ConfirmDraftSchema });
  const element = createElement(ConfirmDraftForm, {
    intakeSource: 'photo' as const,
    identification: sanityIdentification(carbBasis),
    modelId: 'test-model',
    matches: [[match]],
    // Nothing known about the food database: this case is not about it, and
    // `undefined` is the honest value for a render that ran no lookup.
    foodDb: undefined,
    lastResult: submission.reply({ formErrors: ['Select at least one food to log.'] }),
    logDate: null,
    logDateLabel: null,
    photoFile: null,
    userId: 0,
    defaultMealType: null,
    typedText: null,
  });
  const router = createMemoryRouter([{ path: '/scan', element }], { initialEntries: ['/scan'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** The exact sentence the card prints when it thinks fibre exceeds carbs, from the shipped catalog. */
const FIBRE_OVER_CARBS_ISSUE = i18next.t('scan.review.sanity.componentOverTotal', {
  component: i18next.t('scan.review.sanity.macro.fiber'),
  componentValue: formatMacroNumberIn(i18next.language, SCAN_FIBER_PER_100G),
  total: i18next.t('scan.review.sanity.macro.carbs'),
  totalValue: formatMacroNumberIn(i18next.language, SCAN_CARBS_PER_100G),
});

describe('the plate-scan review card checks plausibility against the same panel convention it displays', () => {
  it('CONTROL: with no basis at all (a plain plate estimate) the same macros DO raise the fibre-vs-carbs warning', () => {
    const html = renderReviewCard({ carbBasis: undefined, applyMatch: false });
    assert.ok(
      html.includes(FIBRE_OVER_CARBS_ISSUE),
      `a basis-blind reading must still warn, so the assertions below can fail:\n${FIBRE_OVER_CARBS_ISSUE}`,
    );
  });

  it('an EU-panel item raises no fibre-vs-carbs warning, its printed carbs figure already excludes the fibre', () => {
    const html = renderReviewCard({ carbBasis: 'available', applyMatch: false });
    assert.equal(
      html.includes(FIBRE_OVER_CARBS_ISSUE),
      false,
      'the card warned about an ordinary EU panel, so the resolved basis never reached `checkMacroSanity`',
    );
  });

  it('takes the applied match\'s basis when the item carries none, the same fallback the figure uses', () => {
    const html = renderReviewCard({ carbBasis: undefined, applyMatch: true });
    assert.equal(
      html.includes(FIBRE_OVER_CARBS_ISSUE),
      false,
      'an applied `bls` match means an `available` basis, and the warning must follow it',
    );
  });

  it('a `total`-basis item still warns, the suppression is the basis and nothing else', () => {
    const html = renderReviewCard({ carbBasis: 'total', applyMatch: false });
    assert.ok(html.includes(FIBRE_OVER_CARBS_ISSUE), 'a US panel with fibre above carbs is genuinely impossible');
  });
});
