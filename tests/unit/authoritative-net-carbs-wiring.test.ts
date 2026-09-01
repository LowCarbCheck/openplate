/**
 * WIRING guard for a defect class that has now bitten SEVEN separate times: a
 * value computed correctly at its source and then silently discarded — or
 * re-derived from the wrong parts — by its consumer.
 *
 * The value here is LCC's authoritative `FoodMatch.netCarbsPer100g`. It is
 * origin-aware: bls/curated foods report EU-convention "available"
 * carbohydrates, with fiber ALREADY excluded, so re-deriving
 * `carbs - fiber - polyols` locally double-subtracts fiber and can floor a
 * genuinely high-carb food to a confident, green "0 g net carbs".
 *
 * `tests/unit/portion-preview.test.ts` already covers `computeMacroPreview`
 * thoroughly AS A FUNCTION — and could not catch any of the four incidents,
 * because every one of them was a CALLER that forgot to pass the value. So
 * this file deliberately tests the wiring instead: it drives the real render
 * path of every surface that displays this number, against one shared
 * candidate built by the real production factory, and asserts the pixels.
 *
 * If you are reading this because a test here failed: a surface stopped
 * passing `authoritativeNetCarbsPer100g` through to `computeMacroPreview`
 * (or a candidate type stopped carrying it). Re-thread it — do not relax the
 * assertion, and do not make the field optional anywhere. See
 * `SearchResultCandidate.authoritativeNetCarbsPer100g`'s doc comment for why
 * `?:` is the exact hole this class of bug crawls back through (its `undefined`
 * is a legal VALUE — "no upstream figure" — but the KEY stays required, so a
 * new candidate type cannot omit it and quietly fall back to the naive local
 * formula).
 *
 * Both surfaces live in one file on purpose: they render the SAME food and
 * must never drift into showing two different numbers for it again.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// The real, initialized shared instance — `PortionStep` renders through
// `useTranslation`, and the schema's messages come from the same catalog, so
// the markup asserted below is the actual English the app ships.
import i18next from '../../app/i18n/i18n';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { parseWithZod } from '@conform-to/zod/v4';

import { SearchResultRow } from '../../app/components/add/search-result-row';
import { PortionStep, buildLoggedEntry, createLogSchema, type AddSearchCandidate } from '../../app/routes/add';
import { ConfirmDraftForm, ConfirmDraftSchema, buildConfirmedEntry, buildConfirmedFood } from '../../app/routes/scan';
import { EntryReceipt } from '../../app/routes/diary.entry.$id';
import {
  LogRecentSchema,
  QuickAddChipButton,
  buildRecentLogEntry,
  formatEntryNetCarbs,
  formatEntryPortion,
  groupLogsByMeal,
} from '../../app/routes/diary';
import { matchMacrosToFormValues, toCuratedSource } from '../../app/services/food-resolution/apply-match';
import type { MacroFormValues } from '../../app/services/food-resolution/apply-match';
import {
  computeLocalRecentFoods,
  localCuratedMatchToCandidate,
  localFoodToCandidate,
  localRecentFoodToCandidate,
  selectLocalFrequentChips,
} from '../../app/lib/local-store/local-quick-add';
import type { LocalFrequentChip } from '../../app/lib/local-store/local-quick-add';
import { chipCarbStatus } from '../../app/lib/frequent-chips';
import { computeMacroPreview } from '../../app/lib/portion-preview';
import { computeDailyTotals, localFoodLogToSnapshot } from '../../app/lib/local-store/aggregates';
import { computeEditPatch, macrosDiffer, resolveEditedNetCarbsPer100g } from '../../app/lib/log-edit';
import { migrateEnvelopeForward, parseBackupEnvelope, serializeBackup } from '../../app/lib/local-store/backup';
import { SCHEMA_VERSION } from '../../app/lib/local-store/schema';
import type { LocalFoodLog, LocalPersonalFood } from '../../app/lib/local-store/schema';
import { computeExportNetCarbs } from '../../app/lib/export-format';
import { carbStatusBadgeClass } from '../../app/utils/carb-status';
import type { Macros } from '../../app/lib/macros';
import type { FoodMatch } from '../../app/services/food-resolution/types';

/**
 * Wheat bran, per 100 g, shaped exactly like a real bls-origin row: the
 * `carbs` field is the AVAILABLE-carbohydrate figure (fiber already removed),
 * and `fiber` is reported separately and is far LARGER than it. The naive
 * local formula therefore computes `max(0, 21.7 - 42.8) = 0` — a green,
 * confident, completely wrong badge — while the authoritative figure is 21.7,
 * which is `high` on the traffic light. The two answers disagree in the
 * number AND in the color, which is what makes this fixture discriminating.
 */
const AVAILABLE_CARBS_PER_100G = 21.7;
const FIBER_PER_100G = 42.8;
const AUTHORITATIVE_NET_CARBS_PER_100G = 21.7;

/**
 * A 100 g serving size, so the portion step's default grams are 100 and both
 * surfaces are expected to render the identical figure. The portion math is
 * not what is under test here — keeping it at 1× keeps the cross-surface
 * comparison a plain string equality.
 */
const SERVING_GRAMS = 100;

/**
 * The fixture's licence credit. Its own wiring is guarded in
 * `attribution-wiring.test.ts`; it is named here because the chip round trip
 * below has to prove all THREE fields of this class survive one tap together —
 * a chip that keeps the number and loses the credit is still broken.
 */
const BLS_CREDIT = 'Bundeslebensmittelschlüssel (BLS) 4.0 — Max Rubner-Institut, CC BY 4.0 (adapted)';

function wheatBranMatch(overrides: Partial<FoodMatch> = {}): FoodMatch {
  return {
    slug: 'wheat-bran',
    locale: 'en',
    title: 'Wheat bran',
    canonicalName: 'Wheat bran',
    url: null,
    imageUrl: null,
    macrosPer100g: {
      kcal: 216,
      protein: 15.6,
      fat: 4.3,
      carbs: AVAILABLE_CARBS_PER_100G,
      fiber: FIBER_PER_100G,
      sugars: null,
      polyols: null,
    },
    netCarbsPer100g: AUTHORITATIVE_NET_CARBS_PER_100G,
    attribution: BLS_CREDIT,
    score: 0.95,
    origin: 'bls',
    portionSize: SERVING_GRAMS,
    ...overrides,
  };
}

/**
 * Built through the REAL production factory rather than hand-assembled, so
 * the test covers the whole path `FoodMatch` → candidate → screen. `'strong'`
 * suppresses the match-tier chip, leaving the net-carb badge as the only
 * colored chip in the markup.
 */
function wheatBranCandidate(overrides: Partial<FoodMatch> = {}): AddSearchCandidate {
  return { ...localCuratedMatchToCandidate(wheatBranMatch(overrides)), matchTier: 'strong' };
}

/**
 * The SAME numbers, typed in by hand as a personal food instead of fetched
 * from a source. Nothing about it says "wheat bran from BLS" — the person is
 * the source — so it must carry no authoritative figure at all, while still
 * displaying the local estimate those numbers produce (a green 0, which is
 * genuinely the best answer available from parts alone).
 */
function wheatBranPersonalFood(): LocalPersonalFood {
  return {
    id: 'personal-wheat-bran',
    name: 'Wheat bran',
    brand: null,
    macrosPer100g: { ...wheatBranMatch().macrosPer100g },
    source: 'user',
    createdAt: Date.parse('2026-07-01T00:00:00Z'),
  };
}

const noop = () => undefined;

/** Surface 1: the search RESULT LIST row (per-100g badge, before selection). */
function renderSearchResultRow(candidate: AddSearchCandidate): string {
  return renderToStaticMarkup(createElement(SearchResultRow, { candidate, onSelect: noop }));
}

/**
 * Surface 2: the PORTION step for the same candidate. `PortionStep` calls
 * `useNavigation`/`<Form>`, so it needs a data router — a plain
 * `<MemoryRouter>` throws "useNavigation must be used within a data router".
 */
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

/**
 * The one net-carb badge on a surface. Tolerates both spellings currently in
 * use ("21.7g net carbs" in the list, "21.7 g net carbs" on the portion step)
 * so a copy tweak doesn't masquerade as a wiring regression.
 */
const NET_CARB_BADGE = /<span class="([^"]*)"[^>]*>\s*([\d.]+)\s*g net carbs\s*<\/span>/;

/** What a badge assertion inspects: the span's classes and the gram figure it renders. */
type NetCarbBadge = { classes: string; figure: string };

function findNetCarbBadge(html: string): NetCarbBadge {
  const match = NET_CARB_BADGE.exec(html);
  assert.ok(match, `expected a "<n>g net carbs" badge in the rendered markup, found none:\n${html}`);
  const [, classes, figure] = match;
  assert.ok(classes !== undefined && figure !== undefined, 'net-carb badge regex must capture classes and figure');
  return { classes, figure };
}

describe('authoritative net carbs reach every surface that displays them', () => {
  it('FIXTURE CHECK: the naive local formula really does floor this food to 0 (if this fails the other tests below prove nothing)', () => {
    const candidate = wheatBranCandidate();
    const naive = computeMacroPreview({ macrosPer100g: candidate.macrosPer100g, grams: SERVING_GRAMS });
    assert.equal(naive?.netCarbsPer100g, 0);
    assert.notEqual(AUTHORITATIVE_NET_CARBS_PER_100G, 0);
  });

  it('the search-result row shows the authoritative figure, not the double-subtracted local recompute', () => {
    const html = renderSearchResultRow(wheatBranCandidate());
    assert.equal(findNetCarbBadge(html).figure, String(AUTHORITATIVE_NET_CARBS_PER_100G));
  });

  it('the portion step shows the authoritative figure for the same candidate', () => {
    const html = renderPortionStep(wheatBranCandidate());
    assert.equal(findNetCarbBadge(html).figure, String(AUTHORITATIVE_NET_CARBS_PER_100G));
  });

  it('the search list and the portion step never contradict each other for the same food', () => {
    const candidate = wheatBranCandidate();
    const listFigure = findNetCarbBadge(renderSearchResultRow(candidate)).figure;
    const portionFigure = findNetCarbBadge(renderPortionStep(candidate)).figure;
    assert.equal(
      listFigure,
      portionFigure,
      'the search list and the portion step rendered different net-carb numbers for one food — ' +
        'the surface showing the wrong one is not passing authoritativeNetCarbsPer100g through',
    );
  });

  it('colors the search-result traffic light from the authoritative figure — a 21.7 g food must never render green', () => {
    const { classes } = findNetCarbBadge(renderSearchResultRow(wheatBranCandidate()));
    assert.ok(classes.includes(carbStatusBadgeClass.high), `expected the high-carb palette, got: ${classes}`);
    assert.equal(classes.includes('green'), false, `a 21.7 g net-carb food rendered a low-carb badge: ${classes}`);
  });

  it('colors the portion-step traffic light from the authoritative figure too', () => {
    const { classes } = findNetCarbBadge(renderPortionStep(wheatBranCandidate()));
    assert.ok(classes.includes(carbStatusBadgeClass.high), `expected the high-carb palette, got: ${classes}`);
    assert.equal(classes.includes('green'), false, `a 21.7 g net-carb food rendered a low-carb badge: ${classes}`);
  });

  it('renders no net-carb badge at all when the upstream figure is unknown — never falls back to a fabricated 0', () => {
    // An explicit `null` means "the authoritative figure itself is unknown for
    // this food", which must resolve to no number rather than silently
    // reverting to the local formula (which would happily print "0g" here).
    const candidate = wheatBranCandidate({ netCarbsPer100g: null });
    assert.equal(NET_CARB_BADGE.test(renderSearchResultRow(candidate)), false);
    assert.equal(NET_CARB_BADGE.test(renderPortionStep(candidate)), false);
  });
});

////////////////////////////////////////////////////////////////////////////////
// Persistence round trip
//
// The two surfaces above were only ever half the story: the figure reached the
// screen and then DIED at the store boundary, because `LocalFoodLog` had
// nowhere to keep it. Every diary/trends/streak/goal read of a logged curated
// food was therefore permanently wrong, not just transiently mis-rendered.
//
// These tests drive the real production chain end to end — `PortionStep`'s own
// rendered hidden input → the real `LogSchema` → the real `buildLoggedEntry` →
// the real `localFoodLogToSnapshot`/`computeDailyTotals` — so a break anywhere
// along it fails here. Nothing below re-implements a mapping under test.
////////////////////////////////////////////////////////////////////////////////

/**
 * Floating-point-safe equality for gram figures (`21.7 * 250 / 100` is not
 * exact in binary). Always embeds BOTH numbers in the failure message: the
 * whole point of this file is that the wrong answer here is a plausible-looking
 * "0", so a failure must show "got 0, expected 21.7" rather than a bare
 * `false !== true`.
 */
function assertGrams(actual: number | null | undefined, expected: number, context?: string): void {
  const detail = `expected ~${expected} g net carbs, got ${String(actual)}${context ? ` — ${context}` : ''}`;
  assert.ok(actual !== null && actual !== undefined, detail);
  assert.ok(Math.abs(actual - expected) < 1e-9, detail);
}

/** The hidden input `PortionStep` emits to carry the authoritative figure into the log action. */
const HIDDEN_NET_CARBS_FIELD = /<input[^>]*name="netCarbsPer100g"[^>]*value="([^"]*)"[^>]*>/;

/** The hidden input `PortionStep` emits to carry the chosen display portion ("1 serving") into the log action. */
const HIDDEN_PORTION_FIELD = /<input[^>]*name="portion"[^>]*value="([^"]*)"[^>]*>/;

/** The hidden input `PortionStep` emits to carry the source's licence credit into the log action. */
const HIDDEN_ATTRIBUTION_FIELD = /<input[^>]*name="attribution"[^>]*value="([^"]*)"[^>]*>/;

const DAY_KEY = '2026-07-28';

/** Undoes React's SSR attribute escaping, so a JSON-valued hidden input can be read back as the string it was. */
function unescapeAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/**
 * The REAL add-flow write path for a candidate: render the portion step, take
 * the authoritative figure from the hidden input IT actually emitted (not from
 * the candidate object — that would bypass the wiring under test), submit it
 * through the real `LogSchema`, and build the entry with the real
 * `buildLoggedEntry`. Deleting the hidden input, the schema field, or the
 * builder's assignment each breaks this chain.
 */
function logEntryFromAddFlow(candidate: AddSearchCandidate, { grams }: { grams: number }): LocalFoodLog {
  const html = renderPortionStep(candidate);
  const formData = new FormData();
  formData.set('name', candidate.name);
  formData.set('quantityGrams', String(grams));
  formData.set('aiEstimated', candidate.aiEstimated ? 'true' : 'false');
  formData.set('curatedSource', candidate.curatedSource ?? '');
  for (const [key, value] of Object.entries(candidate.macrosPer100g)) {
    formData.set(key, value === null ? '' : String(value));
  }
  const emitted = HIDDEN_NET_CARBS_FIELD.exec(html);
  if (emitted) formData.set('netCarbsPer100g', emitted[1] ?? '');
  // Also taken from the step's own markup, for the same reason: the chip
  // round-trip below uses this entry as its source, and a chip can only carry
  // a portion the original log actually recorded. Only meaningful at the
  // step's default grams, which is what every caller that cares uses.
  const emittedPortion = HIDDEN_PORTION_FIELD.exec(html);
  if (emittedPortion) formData.set('portion', unescapeAttribute(emittedPortion[1] ?? ''));
  const emittedAttribution = HIDDEN_ATTRIBUTION_FIELD.exec(html);
  if (emittedAttribution) formData.set('attribution', unescapeAttribute(emittedAttribution[1] ?? ''));

  const submission = parseWithZod(formData, { schema: createLogSchema(i18next.t) });
  assert.equal(submission.status, 'success', `LogSchema rejected the portion-step submission: ${html.slice(0, 200)}`);
  if (submission.status !== 'success') throw new Error('unreachable');

  return buildLoggedEntry({
    data: submission.value,
    id: 'log-1',
    loggedAtMs: Date.parse(`${DAY_KEY}T12:00:00Z`),
    dayKey: DAY_KEY,
    createdAtMs: Date.parse(`${DAY_KEY}T12:00:00Z`),
  });
}

/** The diary's headline net-carb total for a day holding exactly these entries. */
function diaryNetCarbsFor(logs: LocalFoodLog[]): number | null | undefined {
  return computeDailyTotals(logs, DAY_KEY).summary?.netCarbs;
}

describe('authoritative net carbs survive being logged', () => {
  it('FIXTURE CHECK: an entry WITHOUT the stored figure really does total 0 (if this fails the tests below prove nothing)', () => {
    const entry = logEntryFromAddFlow(wheatBranCandidate(), { grams: 100 });
    const { netCarbsPer100g: _dropped, ...withoutFigure } = entry;
    assertGrams(diaryNetCarbsFor([withoutFigure]), 0);
  });

  it('the diary total for a logged curated food shows the authoritative figure, not the double-subtracted 0', () => {
    const entry = logEntryFromAddFlow(wheatBranCandidate(), { grams: 100 });
    assertGrams(
      diaryNetCarbsFor([entry]),
      AUTHORITATIVE_NET_CARBS_PER_100G,
      'the logged entry lost its authoritative net carbs — the diary is back to double-subtracting fibre',
    );
  });

  it('stores the figure PER 100 g, so a non-100 g portion scales instead of copying the per-100 g number', () => {
    const entry = logEntryFromAddFlow(wheatBranCandidate(), { grams: 250 });
    assert.equal(entry.netCarbsPer100g, AUTHORITATIVE_NET_CARBS_PER_100G, 'the stored basis must stay per-100 g');
    assertGrams(diaryNetCarbsFor([entry]), (AUTHORITATIVE_NET_CARBS_PER_100G * 250) / 100);
  });

  it('persists NO authoritative figure for a personal food — a local estimate must never masquerade as one', () => {
    // Built by the REAL factory, not by spreading a curated candidate and
    // relabelling its `source`: what makes this candidate honest is that it
    // genuinely carries no upstream figure, not which tier it came from.
    //
    // This pins the invariant that replaced `PortionStep`'s old
    // `source === 'curated'` gate. The gate asked "which tier is this?"; the
    // data now answers "do I have an upstream figure?" — so the step emits the
    // input unconditionally and a candidate with none submits a blank that
    // decodes straight back to `undefined`. Persisting anything here would
    // claim an authority this food doesn't have, freeze a value that should
    // track later macro edits, and suppress the day's `hasUnknowns` caveat
    // when fibre is genuinely unknown.
    const localCandidate: AddSearchCandidate = { ...localFoodToCandidate(wheatBranPersonalFood()), matchTier: null };
    const emitted = HIDDEN_NET_CARBS_FIELD.exec(renderPortionStep(localCandidate));
    assert.ok(
      emitted,
      'the portion step must emit the field for every candidate — the DATA is the gate, not the source tier',
    );
    assert.equal(
      emitted[1],
      '',
      'a candidate with no upstream figure must submit the blank that decodes to `undefined`',
    );
    assert.equal(logEntryFromAddFlow(localCandidate, { grams: 100 }).netCarbsPer100g, undefined);
  });

  it('still SHOWS a personal food its local estimate, even though it persists none', () => {
    // The other half of the same invariant: withholding the figure from the
    // store must not blank the screen. `computeMacroPreview` owns the
    // `carbs - fiber - polyols` fallback, so the estimate is derived at render
    // time rather than stored as a second, drift-prone copy on the candidate.
    const localCandidate: AddSearchCandidate = { ...localFoodToCandidate(wheatBranPersonalFood()), matchTier: null };
    assert.equal(localCandidate.authoritativeNetCarbsPer100g, undefined);
    assert.equal(findNetCarbBadge(renderSearchResultRow(localCandidate)).figure, '0');
    assert.equal(findNetCarbBadge(renderPortionStep(localCandidate)).figure, '0');
  });

  it('the diary ENTRY ROW renders the authoritative figure — this is the exact string that read "0g net carbs"', () => {
    const entry = logEntryFromAddFlow(wheatBranCandidate(), { grams: 100 });
    assert.equal(
      formatEntryNetCarbs(entry, i18next.t, 'en'),
      `${AUTHORITATIVE_NET_CARBS_PER_100G} g net carbs`,
      'the diary entry row is projecting the log itself instead of going through localFoodLogToSnapshot',
    );
  });

  it('the diary MEAL SUBTOTAL agrees with the day headline for the same entry', () => {
    const entry = logEntryFromAddFlow(wheatBranCandidate(), { grams: 100 });
    const [group] = groupLogsByMeal([entry]);
    assert.ok(group, 'expected one meal group');
    assertGrams(
      group.subtotal.netCarbs,
      AUTHORITATIVE_NET_CARBS_PER_100G,
      'the meal subtotal disagrees with the day total — diary.tsx has re-grown its own macro-snapshot mapper',
    );
    assertGrams(diaryNetCarbsFor([entry]), group.subtotal.netCarbs);
  });

  it('a pre-v5 entry (no such key at all) still loads and falls back to the parts — never crashes, never null', () => {
    // Exactly what a row written by an older build reads back as: the key is
    // simply absent. It must behave precisely as it always did.
    const legacyEntry: LocalFoodLog = {
      id: 'legacy-1',
      name: 'Wheat bran',
      quantityGrams: 100,
      macros: {
        carbs: AVAILABLE_CARBS_PER_100G,
        fiber: FIBER_PER_100G,
        sugars: null,
        polyols: null,
        protein: 15.6,
        fat: 4.3,
        kcal: 216,
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
    };
    assert.equal('netCarbsPer100g' in legacyEntry, false, 'the fixture must genuinely lack the key');
    assert.equal(localFoodLogToSnapshot(legacyEntry).netCarbs, undefined, 'absent must stay absent, not become null');
    assertGrams(diaryNetCarbsFor([legacyEntry]), 0);
  });
});

////////////////////////////////////////////////////////////////////////////////
// The SCAN confirm step
//
// The fifth site of the same defect, and the one with the loudest symptom: the
// confirm card rendered a green "0 g net carbs" for a food while the curated
// match card DIRECTLY BELOW IT — on the same screen, for the same food —
// rendered "21.7g net carbs". Applying the match copied its macros and its
// provenance token into the form and dropped its origin-aware net-carbs figure
// on the floor, so both the preview and the eventually-persisted entry fell
// back to double-subtracting the fibre.
//
// The confirm form's macro fields are USER-EDITABLE, unlike the add flow's, so
// there is a second rule to pin here: a figure snapshotted from a match must
// be WITHDRAWN once the person hand-changes the numbers it described.
////////////////////////////////////////////////////////////////////////////////

/** The AI's own guess for the same food — deliberately different from the match, so a swap is visible. */
const AI_DRAFT_MACROS = { kcal: 200, protein: 10, fat: 4, carbs: 30, fiber: 5 };

const AI_IDENTIFICATION = {
  foods: [
    {
      name: 'Wheat bran',
      estimatedGrams: SERVING_GRAMS,
      confidence: 'high' as const,
      macrosPer100g: AI_DRAFT_MACROS,
    },
  ],
};

/**
 * The confirm form's field values for one item. `curatedSource` + the match's
 * own macros (mapped by the REAL `matchMacrosToFormValues` that `applyMatch`
 * calls) is exactly the state the form is in the instant after a match is
 * applied.
 *
 * The two derived hidden fields are deliberately NOT seeded here: they must be
 * re-derived from `curatedSource` + the live macros on every render, so a
 * fixture that pre-supplied them could make a broken derivation look fine.
 */
function confirmFormData(overrides: { curatedSource?: string; macros?: MacroFormValues } = {}): FormData {
  const formData = new FormData();
  formData.set('items[0].include', 'on');
  formData.set('items[0].name', 'Wheat bran');
  formData.set('items[0].estimatedGrams', String(SERVING_GRAMS));
  formData.set('items[0].confidence', 'high');
  formData.set('items[0].curatedSource', overrides.curatedSource ?? '');
  const macros = overrides.macros ?? matchMacrosToFormValues(wheatBranMatch().macrosPer100g);
  for (const [key, value] of Object.entries(macros)) formData.set(`items[0].macros.${key}`, value);
  return formData;
}

/**
 * Renders the real confirm step in the state that `formData` describes.
 *
 * The state is injected the way production actually re-creates it — through a
 * real `ConfirmDraftSchema` parse replied with a form-level error, i.e. the
 * exact `submission.reply({ formErrors })` path `handleConfirm` takes when a
 * confirm comes back for re-validation. That keeps the fixture honest: it is a
 * `SubmissionResult` Conform itself produced, not a hand-shaped lookalike.
 */
function renderConfirmStep(formData: FormData): string {
  const submission = parseWithZod(formData, { schema: ConfirmDraftSchema });
  const element = createElement(ConfirmDraftForm, {
    identification: AI_IDENTIFICATION,
    modelId: 'test-model',
    matches: [[wheatBranMatch()]],
    lastResult: submission.reply({ formErrors: ['Select at least one food to log.'] }),
    logDate: null,
    logDateLabel: null,
    photoFile: null,
    userId: 0,
  });
  const router = createMemoryRouter([{ path: '/scan', element }], { initialEntries: ['/scan'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** The hidden input the confirm step emits to carry the authoritative figure into the log write. */
const CONFIRM_NET_CARBS_FIELD = /<input[^>]*name="items\[0\]\.netCarbsPer100g"[^>]*value="([^"]*)"[^>]*>/;

function emittedConfirmNetCarbs(html: string): string {
  const match = CONFIRM_NET_CARBS_FIELD.exec(html);
  assert.ok(match, `the confirm step emitted no items[0].netCarbsPer100g input at all:\n${html.slice(0, 400)}`);
  return match[1] ?? '';
}

/**
 * Every net-carb badge on the confirm screen, in document order: index 0 is the
 * ITEM's own badge (the number that gets logged), the rest belong to the
 * curated match cards below it. The two disagreeing is the whole defect.
 */
function confirmBadges(html: string): { classes: string; figure: string }[] {
  const badges: { classes: string; figure: string }[] = [];
  const pattern = new RegExp(NET_CARB_BADGE.source, 'g');
  for (const match of html.matchAll(pattern)) {
    const [, classes, figure] = match;
    if (classes !== undefined && figure !== undefined) badges.push({ classes, figure });
  }
  return badges;
}

/**
 * The REAL scan submission: render the confirm step, take the authoritative
 * figure from the hidden input IT emitted, and parse the result through the real
 * `ConfirmDraftSchema` exactly as `handleConfirm` does. Deleting the hidden
 * input or the schema field breaks this chain.
 *
 * Returned as one shared item because `handleConfirm` writes TWO rows from it —
 * a log AND a personal food — and the pair only proves anything if both are
 * built from the same parsed fact rather than from two independent fixtures.
 */
function confirmedItemFromScanFlow(formData: FormData) {
  const html = renderConfirmStep(formData);
  const submitted = new FormData();
  for (const [key, value] of formData.entries()) submitted.set(key, value);
  submitted.set('items[0].netCarbsPer100g', emittedConfirmNetCarbs(html));

  const submission = parseWithZod(submitted, { schema: ConfirmDraftSchema });
  assert.equal(submission.status, 'success', 'ConfirmDraftSchema rejected the confirm-step submission');
  if (submission.status !== 'success') throw new Error('unreachable');
  const item = submission.value.items[0];
  assert.ok(item, 'expected one confirmed item');
  return item;
}

/** The per-100g macros `handleConfirm` narrows out of a confirmed item before persisting either row. */
function confirmedPer100g(item: ReturnType<typeof confirmedItemFromScanFlow>): Macros {
  return {
    carbs: item.macros.carbs,
    fiber: item.macros.fiber ?? null,
    sugars: item.macros.sugars ?? null,
    polyols: item.macros.polyols ?? null,
    protein: item.macros.protein ?? null,
    fat: item.macros.fat ?? null,
    kcal: item.macros.kcal ?? null,
  };
}

/** The LOG half of the scan write path, through the real `buildConfirmedEntry`. */
function confirmedEntryFromScanFlow(formData: FormData): LocalFoodLog {
  const item = confirmedItemFromScanFlow(formData);
  return buildConfirmedEntry({
    item,
    per100g: confirmedPer100g(item),
    id: 'scan-log-1',
    foodId: 'scan-food-1',
    loggedAtMs: Date.parse(`${DAY_KEY}T12:00:00Z`),
    dayKey: DAY_KEY,
    createdAtMs: Date.parse(`${DAY_KEY}T12:00:00Z`),
    logBatchId: 'batch-1',
  });
}

/** The PERSONAL FOOD half of the same write, through the real `buildConfirmedFood`. */
function confirmedFoodFromScanFlow(formData: FormData): LocalPersonalFood {
  const item = confirmedItemFromScanFlow(formData);
  return buildConfirmedFood({
    item,
    per100g: confirmedPer100g(item),
    id: 'scan-food-1',
    createdAtMs: Date.parse(`${DAY_KEY}T12:00:00Z`),
  });
}

describe('the scan confirm step carries an applied match’s authoritative net carbs', () => {
  const APPLIED = { curatedSource: toCuratedSource('wheat-bran') };

  it('FIXTURE CHECK: the AI’s own draft and the applied match really do disagree (else nothing below is discriminating)', () => {
    const aiOnly = confirmBadges(
      renderConfirmStep(confirmFormData({ macros: matchMacrosToFormValues(wheatBranMatch().macrosPer100g) })),
    );
    assert.ok(aiOnly[0], 'expected an item badge');
    // With the match's macros in the fields but NO match applied, the local
    // formula floors this food to 0 — the exact wrong answer the fix removes.
    assert.equal(aiOnly[0].figure, '0');
  });

  it('shows the authoritative figure on the item card once a match is applied — not the double-subtracted 0', () => {
    const badges = confirmBadges(renderConfirmStep(confirmFormData(APPLIED)));
    assert.ok(badges[0], 'expected an item badge');
    assert.equal(
      badges[0].figure,
      String(AUTHORITATIVE_NET_CARBS_PER_100G),
      'the confirm card is still recomputing net carbs from parts instead of using the applied match’s figure',
    );
  });

  it('never contradicts the match card rendered directly beneath it for the same food', () => {
    const badges = confirmBadges(renderConfirmStep(confirmFormData(APPLIED)));
    assert.ok(badges.length >= 2, `expected an item badge and a match-card badge, got ${badges.length}`);
    assert.equal(
      badges[0]?.figure,
      badges[1]?.figure,
      'the item card and the curated match card showed different net-carb numbers for one food on one screen',
    );
  });

  it('colors the item traffic light from the authoritative figure — a 21.7 g food must never render green here either', () => {
    const badges = confirmBadges(renderConfirmStep(confirmFormData(APPLIED)));
    assert.ok(badges[0], 'expected an item badge');
    assert.ok(
      badges[0].classes.includes(carbStatusBadgeClass.high),
      `expected the high-carb palette: ${badges[0].classes}`,
    );
    assert.equal(
      badges[0].classes.includes('green'),
      false,
      `a 21.7 g food rendered a low-carb badge: ${badges[0].classes}`,
    );
  });

  it('emits the figure into the form so it survives the log write', () => {
    assert.equal(
      emittedConfirmNetCarbs(renderConfirmStep(confirmFormData(APPLIED))),
      String(AUTHORITATIVE_NET_CARBS_PER_100G),
    );
  });

  it('emits NO figure for a plain AI plate estimate — the scan’s own guess has no upstream authority to claim', () => {
    // This path must keep computing from parts: the LLM reported these numbers
    // itself, so freezing a "net carbs" figure for them would both invent
    // authority and stop tracking the user's later macro corrections.
    assert.equal(emittedConfirmNetCarbs(renderConfirmStep(confirmFormData())), '');
  });

  it('WITHDRAWS the figure once the macros are hand-edited — a snapshot of numbers that are no longer there is a lie', () => {
    const edited = confirmFormData({
      ...APPLIED,
      macros: { ...matchMacrosToFormValues(wheatBranMatch().macrosPer100g), carbs: '30' },
    });
    assert.equal(
      emittedConfirmNetCarbs(renderConfirmStep(edited)),
      '',
      'the applied match’s figure survived a hand edit of the very macros it described',
    );
    // Cleared to "none", never to `null`: `null` means "an upstream source was
    // consulted and had none", a captured fact. After a user edit there is no
    // upstream source in play at all.
    assert.equal(confirmedEntryFromScanFlow(edited).netCarbsPer100g, undefined);
    // And the preview follows the numbers the person actually typed.
    const badges = confirmBadges(renderConfirmStep(edited));
    assert.equal(badges[0]?.figure, '0', '30 − 42.8 clamps to 0 — the user’s own parts, not the stale 21.7');
  });

  it('a scanned-then-matched food totals the authoritative figure on the diary, not 0', () => {
    const entry = confirmedEntryFromScanFlow(confirmFormData(APPLIED));
    assert.equal(entry.netCarbsPer100g, AUTHORITATIVE_NET_CARBS_PER_100G, 'the stored basis must stay per-100 g');
    assertGrams(
      diaryNetCarbsFor([entry]),
      AUTHORITATIVE_NET_CARBS_PER_100G,
      'the confirmed scan entry lost its authoritative net carbs between the form and the store',
    );
  });

  it('keeps the entry’s curated provenance and the figure consistent — both come from the same applied match', () => {
    const entry = confirmedEntryFromScanFlow(confirmFormData(APPLIED));
    assert.equal(entry.curatedSource, toCuratedSource('wheat-bran'));
    assert.equal(entry.aiEstimated, false);
    const aiEntry = confirmedEntryFromScanFlow(confirmFormData());
    assert.equal(aiEntry.curatedSource, null);
    assert.equal(aiEntry.aiEstimated, true);
    assert.equal(aiEntry.netCarbsPer100g, undefined);
  });
});

////////////////////////////////////////////////////////////////////////////////
// The scan confirm's OTHER row — the EIGHTH and last site of the same defect.
//
// One confirm writes TWO rows from one upstream fact: a `LocalFoodLog` (which
// carried the figure) and a `LocalPersonalFood` (which had nowhere to keep it).
// So the very same scanned-and-matched food showed 21.7 g on its diary entry
// and a green 0 on /add's "Your food" row — the exact "one food, two screens,
// two numbers" symptom this whole file exists to prevent, reached by a path no
// test drove because the food row was written inline and never asserted on.
//
// The chain below is the production one end to end: the confirm step's OWN
// rendered hidden input -> the real `ConfirmDraftSchema` -> the real
// `buildConfirmedFood` -> the real `localFoodToCandidate` -> the real
// `SearchResultRow`/`PortionStep`/`buildLoggedEntry`/day totals. Both rows come
// from ONE parsed item (`confirmedItemFromScanFlow`), so a figure that reaches
// only one of them fails here.
////////////////////////////////////////////////////////////////////////////////

/** The /add candidate a saved personal food produces, through the real factory (never hand-assembled). */
function customCandidateFor(food: LocalPersonalFood): AddSearchCandidate {
  return { ...localFoodToCandidate(food), matchTier: null };
}

describe('one scan confirm writes two rows — and both carry the same number', () => {
  const APPLIED = { curatedSource: toCuratedSource('wheat-bran') };

  it('FIXTURE CHECK: the saved food’s own macros really would estimate 0 (else nothing below is discriminating)', () => {
    const food = confirmedFoodFromScanFlow(confirmFormData(APPLIED));
    const naive = computeMacroPreview({ macrosPer100g: food.macrosPer100g, grams: SERVING_GRAMS });
    assert.equal(naive?.netCarbsPer100g, 0);
  });

  it('the personal food the confirm creates carries the applied match’s authoritative figure', () => {
    assert.equal(
      confirmedFoodFromScanFlow(confirmFormData(APPLIED)).netCarbsPer100g,
      AUTHORITATIVE_NET_CARBS_PER_100G,
      'buildConfirmedFood dropped the figure — /add’s "Your food" row is back to double-subtracting fibre',
    );
  });

  it('stores it PER 100 g on the food, matching `macrosPer100g`’s own basis', () => {
    const food = confirmedFoodFromScanFlow(confirmFormData(APPLIED));
    assert.equal(food.macrosPer100g.carbs, AVAILABLE_CARBS_PER_100G, 'the fixture must be on the per-100 g basis');
    assert.equal(food.netCarbsPer100g, AUTHORITATIVE_NET_CARBS_PER_100G);
  });

  it('the LOG and the FOOD written by one confirm never disagree — they come from one upstream fact', () => {
    const formData = confirmFormData(APPLIED);
    assert.equal(
      confirmedFoodFromScanFlow(formData).netCarbsPer100g,
      confirmedEntryFromScanFlow(formData).netCarbsPer100g,
      'one confirm stored two different figures for one food — the row that lost it is not being built from `item`',
    );
  });

  it('THE USER-VISIBLE INVARIANT: /add’s "Your food" row shows the same number the diary entry does', () => {
    const formData = confirmFormData(APPLIED);
    const diaryFigure = formatEntryNetCarbs(confirmedEntryFromScanFlow(formData), i18next.t, 'en');
    const candidate = customCandidateFor(confirmedFoodFromScanFlow(formData));
    assert.equal(
      findNetCarbBadge(renderSearchResultRow(candidate)).figure,
      String(AUTHORITATIVE_NET_CARBS_PER_100G),
      'the "Your food" row rendered a different number than the same food’s diary entry',
    );
    assert.equal(diaryFigure, `${AUTHORITATIVE_NET_CARBS_PER_100G} g net carbs`);
  });

  it('colours that row’s traffic light from the authoritative figure — a 21.7 g food must not be green here either', () => {
    const candidate = customCandidateFor(confirmedFoodFromScanFlow(confirmFormData(APPLIED)));
    const { classes } = findNetCarbBadge(renderSearchResultRow(candidate));
    assert.ok(classes.includes(carbStatusBadgeClass.high), `expected the high-carb palette, got: ${classes}`);
    assert.equal(classes.includes('green'), false, `a 21.7 g net-carb food rendered a low-carb badge: ${classes}`);
  });

  it('ROUND TRIP: re-logging the saved food from /add totals exactly what the original scan entry did', () => {
    const formData = confirmFormData(APPLIED);
    const scanned = confirmedEntryFromScanFlow(formData);
    const candidate = customCandidateFor(confirmedFoodFromScanFlow(formData));
    const relogged = logEntryFromAddFlow(candidate, { grams: SERVING_GRAMS });

    assert.equal(
      relogged.netCarbsPer100g,
      scanned.netCarbsPer100g,
      'the food re-logged from /add stored a different figure than the scan that created it — ' +
        'one plate, logged twice, gives two different day totals with nothing on screen to explain it',
    );
    assertGrams(diaryNetCarbsFor([relogged]), AUTHORITATIVE_NET_CARBS_PER_100G, 'via /add’s "Your food" row');
    assertGrams(diaryNetCarbsFor([scanned]), AUTHORITATIVE_NET_CARBS_PER_100G, 'via the original scan confirm');
  });

  it('claims nothing for a plain AI plate estimate — the scan’s own guess has no authority to hand on', () => {
    const food = confirmedFoodFromScanFlow(confirmFormData());
    assert.equal(food.netCarbsPer100g, undefined);
    const candidate = customCandidateFor(food);
    assert.equal(candidate.authoritativeNetCarbsPer100g, undefined);
    // And it still SHOWS the local estimate those parts produce — withholding
    // the figure from storage must never blank the screen.
    assert.equal(findNetCarbBadge(renderSearchResultRow(candidate)).figure, '0');
    assert.equal(logEntryFromAddFlow(candidate, { grams: SERVING_GRAMS }).netCarbsPer100g, undefined);
  });

  it('withdraws it from the FOOD too once the macros are hand-edited — both rows follow one rule', () => {
    const edited = confirmFormData({
      ...APPLIED,
      macros: { ...matchMacrosToFormValues(wheatBranMatch().macrosPer100g), carbs: '30' },
    });
    // Cleared to "none", never to `null`: after a user edit there is no upstream
    // source in play at all.
    assert.equal(confirmedFoodFromScanFlow(edited).netCarbsPer100g, undefined);
    assert.equal(confirmedEntryFromScanFlow(edited).netCarbsPer100g, undefined);
  });

  it('keeps an upstream-unknown null distinct from "never captured" on the food as well', () => {
    // The item's own figure is `null` (upstream consulted, genuinely unknown),
    // so the saved food must carry `null` — never collapse to absent, never
    // fabricate a 0 — and its /add row renders no number at all.
    const food: LocalPersonalFood = { ...confirmedFoodFromScanFlow(confirmFormData(APPLIED)), netCarbsPer100g: null };
    const candidate = customCandidateFor(food);
    assert.equal(candidate.authoritativeNetCarbsPer100g, null);
    assert.equal(NET_CARB_BADGE.test(renderSearchResultRow(candidate)), false);
    assert.equal(NET_CARB_BADGE.test(renderPortionStep(candidate)), false);
  });

  it('round-trips the food’s figure through a backup export/import instead of being stripped by the schema', () => {
    const food = confirmedFoodFromScanFlow(confirmFormData(APPLIED));
    const envelope = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-07-28T12:00:00.000Z',
      data: {
        foods: [food],
        foodLogs: [],
        weightEntries: [],
        profile: null,
        fasts: [],
        savedMeals: [],
        shareIdentity: null,
        sharePeers: [],
        researchIdentity: null,
        studyEnrolments: [],
      },
    };
    const restored = migrateEnvelopeForward(parseBackupEnvelope(serializeBackup(envelope)));
    const [restoredFood] = restored.data.foods;
    assert.ok(restoredFood, 'the restored envelope must still contain the food');
    assert.equal(
      restoredFood.netCarbsPer100g,
      AUTHORITATIVE_NET_CARBS_PER_100G,
      'zod stripped the figure on import — a backup restore would silently corrupt every scanned-and-matched food',
    );
    // And the restored food still renders the right number, not a green 0.
    assert.equal(
      findNetCarbBadge(renderSearchResultRow(customCandidateFor(restoredFood))).figure,
      String(AUTHORITATIVE_NET_CARBS_PER_100G),
    );
  });

  it('keeps an explicit null on a food distinct from an absent key across a backup round trip', () => {
    const base = confirmedFoodFromScanFlow(confirmFormData(APPLIED));
    const envelope = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-07-28T12:00:00.000Z',
      data: {
        foods: [
          { ...base, id: 'unknown-food', netCarbsPer100g: null },
          { ...base, id: 'never-captured', netCarbsPer100g: undefined },
        ],
        foodLogs: [],
        weightEntries: [],
        profile: null,
        fasts: [],
        savedMeals: [],
        shareIdentity: null,
        sharePeers: [],
        researchIdentity: null,
        studyEnrolments: [],
      },
    };
    const restored = migrateEnvelopeForward(parseBackupEnvelope(serializeBackup(envelope)));
    assert.equal(restored.data.foods[0]?.netCarbsPer100g, null);
    assert.equal(restored.data.foods[1]?.netCarbsPer100g, undefined);
  });

  it('accepts a v5 envelope whose foods predate the field, with no migration step needed', () => {
    const envelope = {
      schemaVersion: 5,
      exportedAt: '2026-07-28T12:00:00.000Z',
      data: {
        foods: [
          {
            id: 'legacy-food-1',
            name: 'Wheat bran',
            brand: null,
            macrosPer100g: {
              carbs: AVAILABLE_CARBS_PER_100G,
              fiber: FIBER_PER_100G,
              sugars: null,
              polyols: null,
              protein: 15.6,
              fat: 4.3,
              kcal: 216,
            },
            source: 'plate_ai',
            createdAt: Date.parse(`${DAY_KEY}T12:00:00Z`),
          },
        ],
        foodLogs: [],
        weightEntries: [],
        profile: null,
      },
    };
    // Stringified directly, not via `serializeBackup`: this simulates a file
    // written by an OLDER build, which is the whole point of the test.
    const restored = migrateEnvelopeForward(parseBackupEnvelope(JSON.stringify(envelope)));
    assert.equal(restored.schemaVersion, SCHEMA_VERSION);
    assert.equal(restored.data.foods[0]?.netCarbsPer100g, undefined, 'absent must stay absent, not become null');
  });
});

////////////////////////////////////////////////////////////////////////////////
// The ENTRY RECEIPT's hero — the same defect reached through the linked food.
//
// `derivePer100gBasis` hands the receipt the LINKED PERSONAL FOOD's per-100 g
// macros as its display basis whenever the entry still carries curated/AI
// provenance. Those macros are the fibre-EXCLUSIVE "available" carbohydrate, so
// recomputing `carbs - fiber - polyols` from them floored the hero to a
// confident, green 0 while the diary row for the very same entry read 21.7 —
// one tap apart. The fix is the entry's own stored figure, which is also what
// `handleSave` preserves/clears, so the hero can never show a stale number.
////////////////////////////////////////////////////////////////////////////////

/** Builds the receipt's loaderData around one entry + its linked food, exactly as `clientLoader` shapes it. */
function receiptLoaderData({ log, food }: { log: LocalFoodLog; food: LocalPersonalFood | null }) {
  const siblings: LocalFoodLog[] = [];
  return {
    userId: 0,
    log,
    siblings,
    grams: log.quantityGrams,
    snapshotMacros: log.macros,
    // The real rule: the linked food is the basis while provenance is intact.
    basisPer100g: food !== null && (log.curatedSource !== null || log.aiEstimated) ? food.macrosPer100g : null,
    loggedAtDate: 'Tue, Jul 28, 2026',
    loggedAtTime: '12:00 PM',
    loggedAtDateValue: DAY_KEY,
    loggedAtTimeValue: '12:00',
    todayValue: DAY_KEY,
    backTo: '/diary',
  };
}

/** Surface: the entry receipt. Uses `<Link>`/`useSubmit`, so it needs a data router. */
function renderEntryReceipt({ log, food }: { log: LocalFoodLog; food: LocalPersonalFood | null }): string {
  const element = createElement(EntryReceipt, { loaderData: receiptLoaderData({ log, food }) });
  const router = createMemoryRouter([{ path: '/diary/entry/1', element }], { initialEntries: ['/diary/entry/1'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** The receipt's per-100 g hero badge ("21.7 g net carbs / 100 g"). */
const RECEIPT_HERO_BADGE = /<span class="([^"]*)"[^>]*>\s*([\d.]+) g net carbs \/ 100 g\s*<\/span>/;

describe('the entry receipt hero reads the entry’s figure, not the linked food’s parts', () => {
  const APPLIED = { curatedSource: toCuratedSource('wheat-bran') };
  const scanned = () => {
    const formData = confirmFormData(APPLIED);
    return { log: confirmedEntryFromScanFlow(formData), food: confirmedFoodFromScanFlow(formData) };
  };

  it('FIXTURE CHECK: the basis the receipt is handed really would recompute to 0', () => {
    const { food } = scanned();
    assert.equal(computeMacroPreview({ macrosPer100g: food.macrosPer100g, grams: 100 })?.netCarbsPer100g, 0);
  });

  it('renders the authoritative figure in the hero, not the double-subtracted 0', () => {
    const match = RECEIPT_HERO_BADGE.exec(renderEntryReceipt(scanned()));
    assert.ok(match, 'expected a "<n> g net carbs / 100 g" hero badge on the receipt');
    assert.equal(
      match[2],
      String(AUTHORITATIVE_NET_CARBS_PER_100G),
      'the receipt hero is recomputing from the linked food’s macros again — it shows 0 while the diary row shows 21.7',
    );
  });

  it('agrees with the diary row for the same entry, to the character', () => {
    const { log, food } = scanned();
    const heroFigure = RECEIPT_HERO_BADGE.exec(renderEntryReceipt({ log, food }))?.[2];
    assert.equal(`${heroFigure} g net carbs`, formatEntryNetCarbs(log, i18next.t, 'en'));
  });

  it('colours the hero from the authoritative figure — a 21.7 g entry must not read green', () => {
    const match = RECEIPT_HERO_BADGE.exec(renderEntryReceipt(scanned()));
    assert.ok(match, 'expected a hero badge');
    assert.ok(match[1]?.includes(carbStatusBadgeClass.high), `expected the high-carb palette, got: ${match[1]}`);
  });

  it('falls back to the parts for an entry that never had a figure — unchanged behaviour', () => {
    const { log, food } = scanned();
    const manual: LocalFoodLog = { ...log, netCarbsPer100g: undefined };
    assert.equal(RECEIPT_HERO_BADGE.exec(renderEntryReceipt({ log: manual, food }))?.[2], '0');
  });

  it('renders "Macros unknown" rather than a fabricated 0 when the upstream figure is null', () => {
    const { log, food } = scanned();
    const html = renderEntryReceipt({ log: { ...log, netCarbsPer100g: null }, food });
    assert.equal(RECEIPT_HERO_BADGE.test(html), false);
    assert.ok(html.includes('Macros unknown'), 'expected the explicit unknown copy instead of a number');
  });
});

////////////////////////////////////////////////////////////////////////////////
// Editing a saved personal food
//
// The mirror of `computeEditPatch`'s rule for logs: hand-changing the macros
// makes the person the source, so a figure snapshotted from a food database
// stops describing them and has to clear. `handleEditFood` reuses the very same
// pure helpers rather than re-deciding the rule, so the two can't drift — these
// pin that composition on the food's own shape.
////////////////////////////////////////////////////////////////////////////////

describe('editing a saved personal food keeps its authoritative figure honest', () => {
  const savedFood = (): LocalPersonalFood =>
    confirmedFoodFromScanFlow(confirmFormData({ curatedSource: toCuratedSource('wheat-bran') }));

  it('a NAME-only edit preserves the figure — the numbers it describes are untouched', () => {
    const food = savedFood();
    const kept = resolveEditedNetCarbsPer100g({
      macrosChanged: macrosDiffer(food.macrosPer100g, { ...food.macrosPer100g }),
      current: food.netCarbsPer100g,
    });
    assert.equal(kept, AUTHORITATIVE_NET_CARBS_PER_100G);
  });

  it('a MACRO edit CLEARS it — a snapshot of numbers that are no longer there is a lie', () => {
    const food = savedFood();
    const cleared = resolveEditedNetCarbsPer100g({
      macrosChanged: macrosDiffer(food.macrosPer100g, { ...food.macrosPer100g, carbs: 30 }),
      current: food.netCarbsPer100g,
    });
    assert.equal(cleared, undefined, 'a hand-edited food must not keep the upstream figure');
    // And its /add row then follows the numbers the person actually typed.
    const edited: LocalPersonalFood = {
      ...food,
      macrosPer100g: { ...food.macrosPer100g, carbs: 30 },
      netCarbsPer100g: cleared,
    };
    assert.equal(findNetCarbBadge(renderSearchResultRow(customCandidateFor(edited))).figure, '0');
  });
});

////////////////////////////////////////////////////////////////////////////////
// The DIARY's frequent / favourite CHIP re-log
//
// The sixth site of the same defect, and by volume the most important one:
// re-tapping a favourite is the single most common action a returning user
// takes, so a chip that logs the wrong number means the whole net-carbs fix
// does not hold on the main path.
//
// The chip form dropped THREE fields of this class at once — the authoritative
// net carbs, the licence credit, and the chosen portion — so a favourite tapped
// from the diary came back as a curated-provenance entry with a
// double-subtracted 0 g, no credit, and a bare gram figure where the person had
// chosen a real portion. The chain driven below is the production one end to
// end: a real logged entry -> `computeLocalRecentFoods` -> `selectLocalFrequentChips`
// -> the chip's OWN rendered hidden inputs -> the real `LogRecentSchema` ->
// the real `buildRecentLogEntry` -> the real diary totals.
////////////////////////////////////////////////////////////////////////////////

/** The chip's own rendered hidden inputs, by name — read off the markup, never assumed. */
function chipHiddenInputs(chip: LocalFrequentChip): Map<string, string> {
  const element = createElement(QuickAddChipButton, { chip, date: DAY_KEY });
  const router = createMemoryRouter([{ path: '/diary', element }], { initialEntries: ['/diary'] });
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));

  const fields = new Map<string, string>();
  for (const [tag] of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(tag)?.[1];
    if (name === undefined) continue;
    fields.set(name, unescapeAttribute(/value="([^"]*)"/.exec(tag)?.[1] ?? ''));
  }
  return fields;
}

/** The REAL chip write path: whatever the chip's markup carries -> `LogRecentSchema` -> `buildRecentLogEntry`. */
function relogEntryFromChip(chip: LocalFrequentChip): LocalFoodLog {
  const formData = new FormData();
  for (const [name, value] of chipHiddenInputs(chip)) formData.set(name, value);

  const submission = parseWithZod(formData, { schema: LogRecentSchema });
  assert.equal(submission.status, 'success', 'LogRecentSchema rejected the chip’s own submission');
  if (submission.status !== 'success') throw new Error('unreachable');

  return buildRecentLogEntry({
    value: submission.value,
    id: 'chip-log-1',
    loggedAtMs: Date.parse(`${DAY_KEY}T12:00:00Z`),
    mealType: 'lunch',
    createdAtMs: Date.parse(`${DAY_KEY}T12:00:00Z`),
  });
}

/** The chip a previously-logged food produces, through the real recents ranking + chip selection. */
function chipFor(log: LocalFoodLog): LocalFrequentChip {
  // Two identical logs so the food clears the diary's real `minTimesLogged: 2`
  // eligibility floor — a chip is by definition a repeatedly-logged food.
  const recents = computeLocalRecentFoods([log, { ...log, id: `${log.id}-again` }], { limit: 5 });
  const [chip] = selectLocalFrequentChips(recents, { limit: 4, minTimesLogged: 2 });
  assert.ok(chip, 'expected the logged food to earn a chip');
  return chip;
}

describe('the diary’s frequent/favourite chip re-logs the same food, not a stripped copy of it', () => {
  /** A credited curated food, logged through the real add flow — the chip's source. */
  const sourceLog = (): LocalFoodLog => logEntryFromAddFlow(wheatBranCandidate(), { grams: SERVING_GRAMS });

  it('FIXTURE CHECK: the source log really carries all three fields (else nothing below is discriminating)', () => {
    const log = sourceLog();
    assert.equal(log.netCarbsPer100g, AUTHORITATIVE_NET_CARBS_PER_100G);
    assert.equal(log.attribution, BLS_CREDIT);
    assert.deepEqual(log.portion, { unit: 'serving', quantity: 1, gramsPerUnit: SERVING_GRAMS });
  });

  it('the chip itself carries all three fields off the underlying log', () => {
    const chip = chipFor(sourceLog());
    assert.equal(chip.netCarbsPer100g, AUTHORITATIVE_NET_CARBS_PER_100G, 'LocalFrequentChip dropped the figure');
    assert.equal(chip.attribution, BLS_CREDIT, 'LocalFrequentChip dropped the licence credit');
    assert.deepEqual(chip.portion, { unit: 'serving', quantity: 1, gramsPerUnit: SERVING_GRAMS });
  });

  it('ROUND TRIP: tapping the chip stores an entry carrying all three fields, not a bare-macros copy', () => {
    const relogged = relogEntryFromChip(chipFor(sourceLog()));
    assert.equal(
      relogged.netCarbsPer100g,
      AUTHORITATIVE_NET_CARBS_PER_100G,
      'the chip re-log lost the authoritative figure — a re-tapped favourite is back to double-subtracting fibre',
    );
    assert.equal(relogged.attribution, BLS_CREDIT, 'the chip re-log stripped the licence credit');
    assert.deepEqual(
      relogged.portion,
      { unit: 'serving', quantity: 1, gramsPerUnit: SERVING_GRAMS },
      'the chip re-log dropped the chosen portion — the entry comes back as bare grams',
    );
    // And the provenance it already carried still lines up with the figure.
    assert.equal(relogged.curatedSource, toCuratedSource('wheat-bran'));
    assert.equal(relogged.quantityGrams, SERVING_GRAMS);
  });

  it('the DIARY TOTAL for a re-tapped favourite shows the authoritative figure, not 0', () => {
    const relogged = relogEntryFromChip(chipFor(sourceLog()));
    assertGrams(
      diaryNetCarbsFor([relogged]),
      AUTHORITATIVE_NET_CARBS_PER_100G,
      'the most common action a returning user takes still totals a confident, wrong 0',
    );
    assert.equal(formatEntryNetCarbs(relogged, i18next.t, 'en'), `${AUTHORITATIVE_NET_CARBS_PER_100G} g net carbs`);
    assert.equal(formatEntryPortion(relogged, 'en'), `1 serving (${SERVING_GRAMS}\u00a0g)`);
  });

  it('colours the chip’s traffic-light dot from the authoritative figure — a 21.7 g food must not show a green dot', () => {
    assert.equal(
      chipFor(sourceLog()).carbStatus,
      'high',
      'the chip dot is still derived from the raw macros, so it contradicts the badge every other surface shows',
    );
  });

  it('FIXTURE CHECK: without the authoritative figure that same dot really would be green', () => {
    // 21.7 − 42.8 = −21.1, which classifies `low`. This is what the dot showed.
    assert.equal(chipCarbStatus({ ...wheatBranMatch().macrosPer100g }, SERVING_GRAMS), 'low');
  });

  it('carries NO figure and NO credit for a chip built from a plain manual log — nothing to claim, nobody to credit', () => {
    const manual: LocalFoodLog = {
      ...sourceLog(),
      curatedSource: null,
      netCarbsPer100g: undefined,
      attribution: null,
      portion: null,
    };
    const chip = chipFor(manual);
    assert.equal(chip.netCarbsPer100g, undefined);
    assert.equal(chip.attribution, null);
    // The chip's markup still emits the fields; each encodes "none" to a value
    // that decodes straight back to none, so no authority is fabricated.
    const relogged = relogEntryFromChip(chip);
    assert.equal(relogged.netCarbsPer100g, undefined, 'a manual food’s chip must not invent an authoritative figure');
    assert.equal(relogged.attribution, null);
    assert.equal(relogged.portion, null);
    assertGrams(diaryNetCarbsFor([relogged]), 0, 'and it still computes from the parts, exactly as before');
  });

  it('keeps an upstream-unknown null distinct from "never captured" across the chip round trip', () => {
    // `null` means an upstream source was consulted and had none — a captured
    // fact that must not collapse into "no figure" (nor be fabricated into 0).
    const chip = chipFor({ ...sourceLog(), netCarbsPer100g: null });
    assert.equal(chip.netCarbsPer100g, null);
    assert.equal(relogEntryFromChip(chip).netCarbsPer100g, null);
    // And with no figure to classify, the dot is absent rather than green.
    assert.equal(chip.carbStatus, null);
  });
});

////////////////////////////////////////////////////////////////////////////////
// /add's "Recent" row — the SEVENTH site of the same defect, and the first one
// whose symptom a user could see directly.
//
// `localRecentFoodToCandidate` re-derived a display estimate from the recent
// food's macros instead of passing the underlying log's own authoritative
// figure through, and `PortionStep` then gated persistence on
// `source === 'curated'` — a gate that existed only because that field
// conflated "an upstream figure" with "a local estimate". Consequence: ONE
// favourite food, logged from the diary chip and from /add's Recent row,
// stored two different numbers and produced two different day totals. Before
// the chip was fixed both paths were consistently wrong; afterwards they were
// inconsistently right, which is worse — a person re-logging the same breakfast
// two ways got two answers with nothing on screen to explain the difference.
//
// The chain driven below is the production one end to end, and it deliberately
// SHARES its source log with the chip block above, so the two paths are
// compared on literally the same entry.
////////////////////////////////////////////////////////////////////////////////

/**
 * The /add "Recent" row a previously-logged food produces, through the real
 * recents ranking and the real candidate factory (never hand-assembled — a
 * hand-built candidate would sail straight past the mapping under test).
 */
function recentCandidateFor(log: LocalFoodLog): AddSearchCandidate {
  const [recent] = computeLocalRecentFoods([log, { ...log, id: `${log.id}-again` }], { limit: 5 });
  assert.ok(recent, 'expected the logged food to appear in the recents list');
  return { ...localRecentFoodToCandidate(recent), matchTier: null };
}

describe('one favourite food, two logging paths, one number', () => {
  /** A credited curated food, logged through the real add flow — the shared source of both paths. */
  const sourceLog = (): LocalFoodLog => logEntryFromAddFlow(wheatBranCandidate(), { grams: SERVING_GRAMS });

  it('FIXTURE CHECK: the Recent candidate’s own macros really would estimate 0 (else nothing below is discriminating)', () => {
    const candidate = recentCandidateFor(sourceLog());
    const naive = computeMacroPreview({ macrosPer100g: candidate.macrosPer100g, grams: SERVING_GRAMS });
    assert.equal(naive?.netCarbsPer100g, 0);
  });

  it('the Recent candidate carries the original log’s figure, not a re-derived estimate', () => {
    assert.equal(
      recentCandidateFor(sourceLog()).authoritativeNetCarbsPer100g,
      AUTHORITATIVE_NET_CARBS_PER_100G,
      'localRecentFoodToCandidate is re-deriving from macros again instead of passing the log’s figure through',
    );
  });

  it('the /add Recent ROW shows the same number the diary does — no green 0 beside a red 21.7', () => {
    assert.equal(
      findNetCarbBadge(renderSearchResultRow(recentCandidateFor(sourceLog()))).figure,
      String(AUTHORITATIVE_NET_CARBS_PER_100G),
    );
  });

  it('THE USER-VISIBLE INVARIANT: the same favourite stores the same figure and totals the same day, whichever path logs it', () => {
    const source = sourceLog();
    const viaChip = relogEntryFromChip(chipFor(source));
    const viaRecentRow = logEntryFromAddFlow(recentCandidateFor(source), { grams: SERVING_GRAMS });

    assert.equal(
      viaRecentRow.netCarbsPer100g,
      viaChip.netCarbsPer100g,
      'the same food logged from /add’s Recent row and from the diary chip stored two different figures — ' +
        'a person re-logging one breakfast two ways gets two different day totals with nothing on screen to explain it',
    );
    assertGrams(diaryNetCarbsFor([viaRecentRow]), AUTHORITATIVE_NET_CARBS_PER_100G, 'via /add’s Recent row');
    assertGrams(diaryNetCarbsFor([viaChip]), AUTHORITATIVE_NET_CARBS_PER_100G, 'via the diary chip');
    // The credit travels with the data on both paths too — a re-log that keeps
    // the number and loses the licence line is still broken.
    assert.equal(viaRecentRow.attribution, viaChip.attribution);
    assert.equal(viaRecentRow.attribution, BLS_CREDIT);
  });

  it('a Recent row for a plain manual log claims nothing and still estimates from the parts', () => {
    const manual: LocalFoodLog = { ...sourceLog(), curatedSource: null, netCarbsPer100g: undefined, attribution: null };
    const candidate = recentCandidateFor(manual);
    assert.equal(candidate.authoritativeNetCarbsPer100g, undefined);
    const relogged = logEntryFromAddFlow(candidate, { grams: SERVING_GRAMS });
    assert.equal(relogged.netCarbsPer100g, undefined, 'a manual food’s Recent row must not invent an upstream figure');
    assertGrams(diaryNetCarbsFor([relogged]), 0, 'and it still computes from the parts, exactly as before');
  });

  it('keeps an upstream-unknown null distinct from "never captured" across the Recent-row round trip', () => {
    const candidate = recentCandidateFor({ ...sourceLog(), netCarbsPer100g: null });
    assert.equal(candidate.authoritativeNetCarbsPer100g, null);
    assert.equal(logEntryFromAddFlow(candidate, { grams: SERVING_GRAMS }).netCarbsPer100g, null);
  });
});

describe('editing an entry keeps the authoritative figure honest', () => {
  const originalBasis = {
    carbs: AVAILABLE_CARBS_PER_100G,
    fiber: FIBER_PER_100G,
    sugars: null,
    polyols: null,
    protein: 15.6,
    fat: 4.3,
    kcal: 216,
  };

  it('a QUANTITY-only edit preserves the figure — it is per-100 g, so re-portioning leaves it valid', () => {
    const patch = computeEditPatch({
      grams: 250,
      editedPer100g: { ...originalBasis },
      originalBasis,
      currentProvenance: { aiEstimated: false, curatedSource: 'lowcarbcheck:wheat-bran' },
      currentNetCarbsPer100g: AUTHORITATIVE_NET_CARBS_PER_100G,
    });
    assert.equal(patch.macrosChanged, false);
    assert.equal(patch.netCarbsPer100g, AUTHORITATIVE_NET_CARBS_PER_100G);

    const edited = logEntryFromAddFlow(wheatBranCandidate(), { grams: 100 });
    assertGrams(
      diaryNetCarbsFor([
        { ...edited, quantityGrams: 250, macros: patch.snapshot, netCarbsPer100g: patch.netCarbsPer100g },
      ]),
      (AUTHORITATIVE_NET_CARBS_PER_100G * 250) / 100,
    );
  });

  it('a MACRO edit CLEARS the figure — the user is now the source, so a stale upstream number would be a lie', () => {
    const patch = computeEditPatch({
      grams: 100,
      // The person corrects the carbs by hand.
      editedPer100g: { ...originalBasis, carbs: 30 },
      originalBasis,
      currentProvenance: { aiEstimated: false, curatedSource: 'lowcarbcheck:wheat-bran' },
      currentNetCarbsPer100g: AUTHORITATIVE_NET_CARBS_PER_100G,
    });
    assert.equal(patch.macrosChanged, true);
    assert.equal(patch.netCarbsPer100g, undefined, 'a hand-edited entry must not keep the upstream figure');
    // Provenance clears on the same signal — the two rules must not drift apart.
    assert.equal(patch.provenance.curatedSource, null);

    const logged = logEntryFromAddFlow(wheatBranCandidate(), { grams: 100 });
    const edited: LocalFoodLog = { ...logged, macros: patch.snapshot, netCarbsPer100g: patch.netCarbsPer100g };
    // Now the readers follow the numbers the user actually typed: 30 − 42.8 → clamped to 0.
    assertGrams(diaryNetCarbsFor([edited]), 0);
  });

  it('leaves an entry that never had a figure without one (a macro edit cannot invent authority)', () => {
    const patch = computeEditPatch({
      grams: 100,
      editedPer100g: { ...originalBasis, carbs: 30 },
      originalBasis,
      currentProvenance: { aiEstimated: false, curatedSource: null },
      currentNetCarbsPer100g: undefined,
    });
    assert.equal(patch.netCarbsPer100g, undefined);
  });
});

describe('authoritative net carbs survive serialization', () => {
  it('round-trips through a backup export/import instead of being stripped by the schema', () => {
    const entry = logEntryFromAddFlow(wheatBranCandidate(), { grams: 100 });
    const envelope = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-07-28T12:00:00.000Z',
      data: {
        foods: [],
        foodLogs: [entry],
        weightEntries: [],
        profile: null,
        fasts: [],
        savedMeals: [],
        shareIdentity: null,
        sharePeers: [],
        researchIdentity: null,
        studyEnrolments: [],
      },
    };
    const restored = migrateEnvelopeForward(parseBackupEnvelope(serializeBackup(envelope)));
    const [restoredLog] = restored.data.foodLogs;
    assert.ok(restoredLog, 'the restored envelope must still contain the log');
    assert.equal(
      restoredLog.netCarbsPer100g,
      AUTHORITATIVE_NET_CARBS_PER_100G,
      'zod stripped the figure on import — a backup restore would silently corrupt every curated entry',
    );
    assertGrams(diaryNetCarbsFor([restoredLog]), AUTHORITATIVE_NET_CARBS_PER_100G);
  });

  it('keeps an explicit null distinct from an absent key across a backup round trip', () => {
    // `null` ("upstream was consulted and had none") and absent ("never
    // captured") both fall back to the parts today, but collapsing them in
    // storage would lose the ability to tell them apart later.
    const base = logEntryFromAddFlow(wheatBranCandidate(), { grams: 100 });
    const envelope = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-07-28T12:00:00.000Z',
      data: {
        foods: [],
        foodLogs: [{ ...base, id: 'unknown-1', netCarbsPer100g: null }],
        weightEntries: [],
        profile: null,
        fasts: [],
        savedMeals: [],
        shareIdentity: null,
        sharePeers: [],
        researchIdentity: null,
        studyEnrolments: [],
      },
    };
    const restored = migrateEnvelopeForward(parseBackupEnvelope(serializeBackup(envelope)));
    assert.equal(restored.data.foodLogs[0]?.netCarbsPer100g, null);
  });

  it('accepts a v4 envelope whose entries predate the field, with no migration step needed', () => {
    const envelope = {
      schemaVersion: 4,
      exportedAt: '2026-07-28T12:00:00.000Z',
      data: {
        foods: [],
        foodLogs: [
          {
            id: 'legacy-1',
            name: 'Wheat bran',
            quantityGrams: 100,
            macros: {
              carbs: AVAILABLE_CARBS_PER_100G,
              fiber: FIBER_PER_100G,
              sugars: null,
              polyols: null,
              protein: 15.6,
              fat: 4.3,
              kcal: 216,
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
          },
        ],
        weightEntries: [],
        profile: null,
      },
    };
    // Stringified directly, not via `serializeBackup`: this simulates a file
    // written by an OLDER build, so it is deliberately not a current
    // `BackupEnvelope` — that is the whole point of the test.
    const restored = migrateEnvelopeForward(parseBackupEnvelope(JSON.stringify(envelope)));
    assert.equal(restored.schemaVersion, SCHEMA_VERSION);
    assert.equal(restored.data.foodLogs[0]?.netCarbsPer100g, undefined);
  });

  it('exports the authoritative figure to CSV/JSON rather than re-deriving a negative from the parts', () => {
    const entry = logEntryFromAddFlow(wheatBranCandidate(), { grams: 100 });
    const row = {
      carbs: entry.macros.carbs,
      fiber: entry.macros.fiber,
      polyols: entry.macros.polyols,
      netCarbs: localFoodLogToSnapshot(entry).netCarbs,
    };
    assertGrams(computeExportNetCarbs(row), AUTHORITATIVE_NET_CARBS_PER_100G);
    // Without the override the export would read 21.7 − 42.8 = −21.1.
    assertGrams(computeExportNetCarbs({ ...row, netCarbs: undefined }), AVAILABLE_CARBS_PER_100G - FIBER_PER_100G);
  });
});
