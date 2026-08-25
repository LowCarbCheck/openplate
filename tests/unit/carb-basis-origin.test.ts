/**
 * Regression guard for the M123/13 SECOND architecture-review finding 1: a
 * macro edit on a CURATED (BLS-origin) entry re-created the exact double
 * subtraction spec 13 exists to prevent.
 *
 * `localCuratedMatchToCandidate` used to omit `carbBasis` entirely, on the
 * claim (in its own comment) that the compute-from-parts fallback `carbBasis`
 * governs "is never reached for a curated candidate" — because a curated
 * candidate always carries `authoritativeNetCarbsPer100g`. That claim is
 * false: `resolveEditedNetCarbsPer100g` (`#app/lib/log-edit`, driving both
 * `diary.entry.$id.tsx`'s save action and `resolveAppliedMatchSnapshot`)
 * clears that figure by design the moment the person edits any macro. Once
 * cleared, the fallback runs — and with no basis recorded, it silently
 * applied the `total` formula (`carbs - fiber - polyols`) to a BLS figure
 * that is already fibre-exclusive (`available`), flooring a genuinely
 * high-carb food to a false, confident low number.
 *
 * This file drives the REAL production pieces end to end: a `FoodMatch`
 * fixture -> `localCuratedMatchToCandidate` -> the real `PortionStep` render
 * -> the real `createLogSchema`/`buildLoggedEntry` write path -> the real
 * `computeEditPatch` a macro edit runs through -> `computeNetCarbsFromParts`,
 * the fallback formula itself. A hand-built payload that skipped
 * `PortionStep`'s actual hidden inputs could sail past a deleted one, which
 * is exactly this bug class (see `carb-basis-write-paths.test.ts`'s header
 * for the sibling files documenting it for other fields).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { parseWithZod } from '@conform-to/zod/v4';

import i18next from '../../app/i18n/i18n';
import { PortionStep, createLogSchema, buildLoggedEntry, type AddSearchCandidate } from '../../app/routes/add';
import { localCuratedMatchToCandidate } from '../../app/lib/local-store/local-quick-add';
import { resolveAppliedMatchSnapshot } from '../../app/services/food-resolution/apply-match';
import { carbBasisForOrigin, computeNetCarbsFromParts } from '../../app/lib/net-carbs';
import { computeEditPatch } from '../../app/lib/log-edit';
import { matchTier } from '../../app/lib/match-quality';
import type { FoodMatch } from '../../app/services/food-resolution';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';

////////////////////////////////////////////////////////////////////////////////
// Shared fixture: a fibre-heavy food whose BLS panel prints fibre-exclusive
// ("available") carbs — same broccoli example the review finding names.
////////////////////////////////////////////////////////////////////////////////

const AVAILABLE_CARBS_PER_100G = 2.7;
const FIBER_PER_100G = 3.0;
const SERVING_GRAMS = 100;
const DAY_KEY = '2026-08-25';
const LOGGED_AT_MS = Date.parse(`${DAY_KEY}T12:00:00Z`);

function curatedMatch(overrides: Partial<FoodMatch> = {}): FoodMatch {
  return {
    slug: 'broccoli',
    locale: 'en',
    title: 'Broccoli',
    canonicalName: 'Broccoli',
    url: null,
    imageUrl: null,
    macrosPer100g: {
      kcal: 34,
      protein: 2.8,
      fat: 0.4,
      carbs: AVAILABLE_CARBS_PER_100G,
      fiber: FIBER_PER_100G,
      sugars: 1.7,
      polyols: null,
    },
    netCarbsPer100g: AVAILABLE_CARBS_PER_100G,
    attribution: 'Bundeslebensmittelschlüssel (BLS) 4.0 — Max Rubner-Institut, CC BY 4.0 (adapted)',
    score: 0.95,
    origin: 'bls',
    portionSize: null,
    ...overrides,
  };
}

const noop = () => undefined;

/** Renders the REAL `PortionStep`, submits through the REAL `LogSchema`, builds with the REAL `buildLoggedEntry`. */
function logCandidate(candidate: AddSearchCandidate): LocalFoodLog {
  const element = createElement(PortionStep, {
    candidate,
    defaultMealType: 'lunch',
    returnTo: '/diary',
    logContext: { date: null, label: null, switchToTodayHref: '/add' },
    lastResult: undefined,
    onBack: noop,
  });
  const router = createMemoryRouter([{ path: '/add', element }], { initialEntries: ['/add'] });
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));

  const formData = new FormData();
  for (const [tag] of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(tag)?.[1];
    if (name === undefined) continue;
    const rawValue = /value="([^"]*)"/.exec(tag)?.[1] ?? '';
    formData.set(
      name,
      rawValue.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'),
    );
  }
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

/** Simulates the diary entry edit page's real save decision (`computeEditPatch`), then the real `...existing` spread write `diary.entry.$id.tsx`'s `handleSave` performs — `carbBasis` is NOT part of the patch; it survives only because the spread carries it. */
function applyMacroEdit(log: LocalFoodLog, editedFiberPer100g: number): LocalFoodLog {
  const editedPer100g = { ...log.macros, fiber: editedFiberPer100g };
  const patch = computeEditPatch({
    grams: log.quantityGrams,
    editedPer100g,
    originalBasis: log.macros,
    currentProvenance: { aiEstimated: log.aiEstimated, curatedSource: log.curatedSource },
    currentNetCarbsPer100g: log.netCarbsPer100g,
  });
  return {
    ...log,
    macros: patch.snapshot,
    aiEstimated: patch.provenance.aiEstimated,
    curatedSource: patch.provenance.curatedSource,
    netCarbsPer100g: patch.netCarbsPer100g,
  };
}

describe('carbBasisForOrigin — the open-union mapping', () => {
  it('maps bls/curated to "available", fdc/user to "total"', () => {
    assert.equal(carbBasisForOrigin('bls'), 'available');
    assert.equal(carbBasisForOrigin('curated'), 'available');
    assert.equal(carbBasisForOrigin('fdc'), 'total');
    assert.equal(carbBasisForOrigin('user'), 'total');
  });

  it('never guesses for an unrecognised or absent origin — undefined, not a default "total"', () => {
    assert.equal(carbBasisForOrigin('some-future-origin-lcc-hasnt-told-us-about'), undefined);
    assert.equal(carbBasisForOrigin(null), undefined);
  });
});

describe('localCuratedMatchToCandidate — derives carbBasis from origin instead of always omitting it', () => {
  it('a bls-origin match carries carbBasis: "available" onto the candidate', () => {
    assert.equal(localCuratedMatchToCandidate(curatedMatch({ origin: 'bls' })).carbBasis, 'available');
  });

  it('an fdc-origin match carries carbBasis: "total"', () => {
    assert.equal(localCuratedMatchToCandidate(curatedMatch({ origin: 'fdc' })).carbBasis, 'total');
  });

  it('an unrecognised origin carries no basis at all — never a guess', () => {
    assert.equal(localCuratedMatchToCandidate(curatedMatch({ origin: 'not-a-real-origin' })).carbBasis, undefined);
    assert.equal(localCuratedMatchToCandidate(curatedMatch({ origin: null })).carbBasis, undefined);
  });
});

describe('resolveAppliedMatchSnapshot — carbBasis is NOT withdrawn by a macro edit, unlike netCarbsPer100g', () => {
  it('macros unchanged: both the figure and the basis survive', () => {
    const match = curatedMatch({ origin: 'bls' });
    const snapshot = resolveAppliedMatchSnapshot({
      appliedCuratedSource: 'lowcarbcheck:broccoli',
      matches: [match],
      editedMacrosPer100g: match.macrosPer100g,
    });
    assert.equal(snapshot.netCarbsPer100g, AVAILABLE_CARBS_PER_100G);
    assert.equal(snapshot.carbBasis, 'available');
  });

  it('macros edited: the figure clears, but the basis — a fact about the printed panel, not the numbers — does not', () => {
    const match = curatedMatch({ origin: 'bls' });
    const snapshot = resolveAppliedMatchSnapshot({
      appliedCuratedSource: 'lowcarbcheck:broccoli',
      matches: [match],
      editedMacrosPer100g: { ...match.macrosPer100g, fiber: FIBER_PER_100G + 0.1 },
    });
    assert.equal(snapshot.netCarbsPer100g, undefined, 'a hand-edited macro should clear the authoritative figure');
    assert.equal(snapshot.carbBasis, 'available', 'the basis must survive the edit — this is what keeps the fallback honest afterward');
  });
});

describe('FINDING 1, end to end — logging a curated match then editing a macro must not double-subtract fibre', () => {
  it('ROUND TRIP: a BLS-origin curated entry, macro-edited by 0.1g, keeps its fibre-exclusive basis and does not double-subtract', () => {
    const candidate = { ...localCuratedMatchToCandidate(curatedMatch({ origin: 'bls' })), matchTier: matchTier(0.95) };
    const logged = logCandidate(candidate);
    assert.equal(logged.carbBasis, 'available', 'the logged entry must carry the BLS-derived basis from the moment it is created');
    assert.equal(logged.netCarbsPer100g, AVAILABLE_CARBS_PER_100G, 'the authoritative figure should still win before any edit');

    // The exact trigger from the review finding: nudge one macro by 0.1g.
    const edited = applyMacroEdit(logged, FIBER_PER_100G + 0.1);
    assert.equal(edited.netCarbsPer100g, undefined, 'a real macro edit must clear the authoritative figure (existing, correct behaviour)');
    assert.equal(edited.carbBasis, 'available', 'the basis must survive the edit unchanged');

    const netCarbs = computeNetCarbsFromParts(edited.macros, edited.carbBasis);
    assert.equal(
      netCarbs,
      AVAILABLE_CARBS_PER_100G - 0,
      'an "available"-basis food must not subtract fibre a second time — this is the exact false-green understatement spec 13 exists to prevent',
    );
    assert.notEqual(netCarbs, AVAILABLE_CARBS_PER_100G - (FIBER_PER_100G + 0.1), 'the old (double-subtracting) answer must not reappear');
  });

  it('an FDC-origin entry, macro-edited the same way, still subtracts fibre — the total-basis formula is unaffected', () => {
    const candidate = { ...localCuratedMatchToCandidate(curatedMatch({ origin: 'fdc' })), matchTier: matchTier(0.95) };
    const logged = logCandidate(candidate);
    assert.equal(logged.carbBasis, 'total');

    const edited = applyMacroEdit(logged, FIBER_PER_100G + 0.1);
    const netCarbs = computeNetCarbsFromParts(edited.macros, edited.carbBasis);
    assert.equal(netCarbs, AVAILABLE_CARBS_PER_100G - (FIBER_PER_100G + 0.1), 'a total-basis food must still subtract the (edited) fibre figure');
  });

  it('an unrecognised-origin entry, macro-edited the same way, behaves exactly as before this fix (undefined basis == total formula)', () => {
    const candidate = { ...localCuratedMatchToCandidate(curatedMatch({ origin: 'some-future-origin' })), matchTier: matchTier(0.95) };
    const logged = logCandidate(candidate);
    assert.equal(logged.carbBasis, undefined, 'an unrecognised origin must never guess a basis');

    const edited = applyMacroEdit(logged, FIBER_PER_100G + 0.1);
    const netCarbs = computeNetCarbsFromParts(edited.macros, edited.carbBasis);
    assert.equal(
      netCarbs,
      AVAILABLE_CARBS_PER_100G - (FIBER_PER_100G + 0.1),
      'UNKNOWN basis must still behave exactly like "total" — no existing user history should move because of this fix',
    );
  });
});
