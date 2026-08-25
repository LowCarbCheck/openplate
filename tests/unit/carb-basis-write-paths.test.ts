/**
 * WIRING guard for the M123/13 architecture-review findings 1-4: `carbBasis`
 * is a per-LOG field, and four of the six log-creating write paths dropped it
 * — the ADD flow's portion-step log, delete-then-Undo, copy-yesterday, and a
 * frequent/favorite chip re-log. `carb-basis-wiring.test.ts` already covers
 * the DISPLAY chain (`computeMacroPreview`/`chipCarbStatus` call sites); this
 * file is the WRITE half of the identical defect class `attribution-wiring.test.ts`
 * and `authoritative-net-carbs-wiring.test.ts` document for their own fields —
 * a value correct at its source, silently discarded by a consumer.
 *
 * Each write path is driven end to end through its REAL production pieces —
 * the real component's rendered hidden inputs (never a hand-built payload
 * that could carry a field production forgot), the real Zod schema, and the
 * real builder — for the same reason those two sibling files do it that way:
 * a mimic sails straight past a deleted hidden input, which is exactly how
 * this class of bug hides.
 *
 * If you are reading this because a test here failed: an entry-creating path
 * stopped copying `carbBasis`. Re-thread it — this is the exact
 * false-green-zero bug spec 13 exists to fix, reintroduced by whichever path
 * broke.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { parseWithZod } from '@conform-to/zod/v4';

import i18next from '../../app/i18n/i18n';
import { PortionStep, createLogSchema, buildLoggedEntry, type AddSearchCandidate } from '../../app/routes/add';
import {
  LogRecentSchema,
  QuickAddChipButton,
  RestoreLogSchema,
  buildCopiedEntry,
  buildRecentLogEntry,
  buildRestoredEntry,
} from '../../app/routes/diary';
import { buildRestorePayload } from '../../app/routes/diary.entry.$id';
import {
  computeLocalRecentFoods,
  localFoodToCandidate,
  selectLocalFrequentChips,
} from '../../app/lib/local-store/local-quick-add';
import type { LocalFoodLog, LocalPersonalFood } from '../../app/lib/local-store/schema';

////////////////////////////////////////////////////////////////////////////////
// Shared EU-basis fixture (same food as carb-basis-wiring.test.ts)
////////////////////////////////////////////////////////////////////////////////

const AVAILABLE_CARBS_PER_100G = 21.7;
const FIBER_PER_100G = 42.8;
const SERVING_GRAMS = 100;
const DAY_KEY = '2026-08-25';
const LOGGED_AT_MS = Date.parse(`${DAY_KEY}T12:00:00Z`);

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
    createdAt: LOGGED_AT_MS,
    carbBasis: 'available',
    ...overrides,
  };
}

function euBasisCandidate(overrides: Partial<LocalPersonalFood> = {}): AddSearchCandidate {
  return { ...localFoodToCandidate(euBasisPersonalFood(overrides)), matchTier: null };
}

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
    mealType: 'breakfast',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: DAY_KEY,
    loggedAt: LOGGED_AT_MS,
    createdAt: LOGGED_AT_MS,
    logBatchId: null,
    carbBasis: 'available',
    ...overrides,
  };
}

const noop = () => undefined;

/** Undoes React's SSR attribute escaping, so a rendered hidden input reads back as the string it was. */
function unescapeAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/**
 * Pulls EVERY hidden input's name/value off rendered markup into a
 * submittable `FormData`. Generic on purpose, same reason as
 * `attribution-wiring.test.ts`'s `chipRelogEntry`: a helper that hand-picks
 * which fields to carry would sail straight past a deleted hidden input,
 * which is exactly the bug class under test.
 */
function hiddenInputsToFormData(html: string): FormData {
  const formData = new FormData();
  for (const [tag] of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(tag)?.[1];
    if (name === undefined) continue;
    formData.set(name, unescapeAttribute(/value="([^"]*)"/.exec(tag)?.[1] ?? ''));
  }
  return formData;
}

////////////////////////////////////////////////////////////////////////////////
// Finding 1 — the /add portion step's log action
////////////////////////////////////////////////////////////////////////////////

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

/** The REAL add-flow write path: render the portion step, take EVERY hidden field it actually emitted, submit through the real `LogSchema`, build with the real `buildLoggedEntry`. */
function addFlowEntry(candidate: AddSearchCandidate): LocalFoodLog {
  const html = renderPortionStep(candidate);
  const formData = hiddenInputsToFormData(html);
  formData.set('name', candidate.name);
  formData.set('quantityGrams', String(SERVING_GRAMS));
  for (const [key, value] of Object.entries(candidate.macrosPer100g)) {
    formData.set(key, value === null ? '' : String(value));
  }

  const submission = parseWithZod(formData, { schema: createLogSchema(i18next.t) });
  assert.equal(submission.status, 'success', 'LogSchema rejected the portion-step submission');
  if (submission.status !== 'success') throw new Error('unreachable');

  return buildLoggedEntry({
    data: submission.value,
    id: 'log-1',
    loggedAtMs: LOGGED_AT_MS,
    dayKey: DAY_KEY,
    createdAtMs: LOGGED_AT_MS,
  });
}

describe('Finding 1 — the /add portion step keeps carbBasis', () => {
  it('ROUND TRIP: logging an EU-basis candidate stores carbBasis: "available"', () => {
    assert.equal(
      addFlowEntry(euBasisCandidate()).carbBasis,
      'available',
      'the portion step logged the EU-basis candidate without its carbBasis — the stored row will silently double-subtract fibre on every future read, while the preview it was logged from read correctly',
    );
  });

  it('a candidate with no basis logs no basis, never a fabricated "total"', () => {
    assert.equal(addFlowEntry(euBasisCandidate({ carbBasis: undefined })).carbBasis, undefined);
  });
});

////////////////////////////////////////////////////////////////////////////////
// Finding 2 — delete-then-Undo
////////////////////////////////////////////////////////////////////////////////

/** The REAL undo-restore write path: `buildRestorePayload` -> `RestoreLogSchema` -> `buildRestoredEntry`. */
function restoredEntry(log: LocalFoodLog): LocalFoodLog {
  const formData = new FormData();
  for (const [name, value] of Object.entries(buildRestorePayload(log))) formData.set(name, value);
  const submission = parseWithZod(formData, { schema: RestoreLogSchema });
  assert.equal(submission.status, 'success', 'RestoreLogSchema rejected the Undo payload');
  if (submission.status !== 'success') throw new Error('unreachable');
  return buildRestoredEntry({
    value: submission.value,
    id: 'restored-1',
    loggedAtMs: log.loggedAt,
    dayKey: log.dayKey,
    createdAtMs: LOGGED_AT_MS,
  });
}

describe('Finding 2 — delete-then-Undo keeps carbBasis', () => {
  it('ROUND TRIP: Undo restores an EU-basis entry with carbBasis: "available"', () => {
    assert.equal(
      restoredEntry(euBasisLog()).carbBasis,
      'available',
      'Undo brought the entry back stripped of its carbBasis — it now silently double-subtracts fibre, permanently',
    );
  });

  it('Undo of a basis-less entry restores no basis, never a fabricated "total"', () => {
    assert.equal(restoredEntry(euBasisLog({ carbBasis: undefined })).carbBasis, undefined);
  });
});

////////////////////////////////////////////////////////////////////////////////
// Finding 3 — copy yesterday
////////////////////////////////////////////////////////////////////////////////

describe('Finding 3 — copy-yesterday keeps carbBasis', () => {
  it('ROUND TRIP: a copied EU-basis entry keeps carbBasis: "available"', () => {
    const copy = buildCopiedEntry({
      log: euBasisLog(),
      id: 'copy-1',
      dayKey: '2026-08-26',
      loggedAtMs: LOGGED_AT_MS + 86_400_000,
      createdAtMs: LOGGED_AT_MS + 86_400_000,
      logBatchId: 'copy-batch-1',
    });
    assert.equal(
      copy.carbBasis,
      'available',
      'the copy claims the same food and source but drops its carbBasis — it silently double-subtracts fibre on the new day',
    );
  });

  it('copying a basis-less entry copies no basis, never a fabricated "total"', () => {
    const copy = buildCopiedEntry({
      log: euBasisLog({ carbBasis: undefined }),
      id: 'copy-2',
      dayKey: '2026-08-26',
      loggedAtMs: LOGGED_AT_MS + 86_400_000,
      createdAtMs: LOGGED_AT_MS + 86_400_000,
      logBatchId: 'copy-batch-2',
    });
    assert.equal(copy.carbBasis, undefined);
  });
});

////////////////////////////////////////////////////////////////////////////////
// Finding 4 — frequent/favorite chip re-log
////////////////////////////////////////////////////////////////////////////////

/** The REAL chip re-log write path, all four links: a stored log -> `computeLocalRecentFoods` -> `selectLocalFrequentChips` -> the chip's OWN rendered hidden inputs -> `LogRecentSchema` -> `buildRecentLogEntry`. */
function chipRelogEntry(log: LocalFoodLog): LocalFoodLog {
  // Two identical logs so the food clears the diary's real `minTimesLogged: 2` floor.
  const recents = computeLocalRecentFoods([log, { ...log, id: `${log.id}-again` }], { limit: 5 });
  const [chip] = selectLocalFrequentChips(recents, { limit: 4, minTimesLogged: 2 });
  assert.ok(chip, 'expected the logged food to earn a chip');

  const element = createElement(QuickAddChipButton, { chip, date: DAY_KEY });
  const router = createMemoryRouter([{ path: '/diary', element }], { initialEntries: ['/diary'] });
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
  const formData = hiddenInputsToFormData(html);

  const submission = parseWithZod(formData, { schema: LogRecentSchema });
  assert.equal(submission.status, 'success', 'LogRecentSchema rejected the chip’s own submission');
  if (submission.status !== 'success') throw new Error('unreachable');
  return buildRecentLogEntry({
    value: submission.value,
    id: 'chip-log-1',
    loggedAtMs: LOGGED_AT_MS,
    mealType: 'breakfast',
    createdAtMs: LOGGED_AT_MS,
  });
}

describe('Finding 4 — a frequent/favorite chip re-log keeps carbBasis', () => {
  it('ROUND TRIP: tapping a chip for an EU-basis food stores carbBasis: "available"', () => {
    assert.equal(
      chipRelogEntry(euBasisLog()).carbBasis,
      'available',
      'the chip re-log dropped carbBasis — the dot colour (already basis-aware) and the row the tap created now disagree',
    );
  });

  it('re-logging a basis-less chip stores no basis, never a fabricated "total"', () => {
    assert.equal(chipRelogEntry(euBasisLog({ carbBasis: undefined })).carbBasis, undefined);
  });
});
