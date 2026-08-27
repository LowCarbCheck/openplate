/**
 * WIRING guard for the v9 → v10 bump: `LocalPersonalFood.micronutrientsPer100g`.
 *
 * This is the SAME defect `authoritative-net-carbs-wiring.test.ts` documents at
 * length, happening a second time on the same line of the same function. One
 * scan confirm writes TWO rows from one upstream fact — a `LocalFoodLog` and a
 * `LocalPersonalFood` — and v9 gave the micronutrient snapshot to only the log.
 * The consequence was invisible and asymmetric: re-logging that saved food from
 * /add's "Your foods" contributed ZERO micronutrient coverage, while the
 * identical food re-logged from "Recent" contributed full coverage. Same food,
 * two entry points, two different answers to "do we know enough to show your
 * magnesium?", and the lossy one is the path a person uses for the foods they
 * eat most.
 *
 * The rule this file pins in BOTH directions, because only one of them is a
 * "more data is better" story:
 *
 *  1. A personal food created from an applied LCC match CARRIES the match's
 *     figures, all the way through to the coverage a re-log contributes.
 *  2. A personal food created any other way — hand-typed manual entry, plain AI
 *     plate estimate — carries NONE, and that absence must stay absent. Not
 *     `{}`, not blocks of `null`, and above all not zeros. Nobody measured those
 *     vitamins; a fabricated figure is worse than a missing one because the
 *     coverage model cannot see through it (milestone locked decision 3).
 *
 * And one thing that must NOT change: undo-restore and copy-yesterday read the
 * ORIGINAL LOG's snapshot, never the personal food's current one. A log records
 * what was true when the food was eaten. Re-deriving from the food would let an
 * edit made today silently rewrite last month's diary — so the tests below edit
 * the food in between and assert the restored entry ignored the edit.
 *
 * Every chain here runs through the production functions (and, where one
 * exists, the real rendered hidden input) rather than hand-assembled fixtures,
 * because every incident in this class was a CALLER that forgot to pass the
 * value — not a function that computed it wrongly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { parseWithZod } from '@conform-to/zod/v4';

import i18next from '../../app/i18n/i18n';
import {
  PortionStep,
  buildLoggedEntry,
  buildManualFood,
  createLogSchema,
  type AddSearchCandidate,
} from '../../app/routes/add';
import { ConfirmDraftForm, ConfirmDraftSchema, buildConfirmedEntry, buildConfirmedFood } from '../../app/routes/scan';
import { RestoreLogSchema, buildCopiedEntry, buildRestoredEntry } from '../../app/routes/diary';
import { buildRestorePayload } from '../../app/routes/diary.entry.$id';
import { localCuratedMatchToCandidate, localFoodToCandidate } from '../../app/lib/local-store/local-quick-add';
import { matchMacrosToFormValues, toCuratedSource } from '../../app/services/food-resolution/apply-match';
import { computeDailyMicronutrients } from '../../app/lib/local-store/aggregates';
import { migrateEnvelopeForward, parseBackupEnvelope, serializeBackup } from '../../app/lib/local-store/backup';
import { SCHEMA_VERSION } from '../../app/lib/local-store/schema';
import type { LocalFoodLog, LocalPersonalFood } from '../../app/lib/local-store/schema';
import { MINERAL_KEYS, VITAMIN_KEYS, readNutrientPer100g } from '../../app/lib/micronutrients';
import type { MicronutrientsPer100g } from '../../app/lib/micronutrients';
import type { Macros } from '../../app/lib/macros';
import type { FoodMatch } from '../../app/services/food-resolution/types';

const DAY_KEY = '2026-08-07';
const YESTERDAY_KEY = '2026-08-06';
const SERVING_GRAMS = 100;
const AT_NOON = Date.parse(`${DAY_KEY}T12:00:00Z`);

/** Spinach's vitamin C per 100 g — the figure every assertion below follows end to end. */
const VITAMIN_C_PER_100G = 28;

/**
 * A vitamin block with `vitaminC` measured, `vitaminD` explicitly `null`, and a
 * measured `0` for `vitaminB12` — one of each of the three states that must
 * survive intact, in one fixture. The `0` is the sharp one: it is a real
 * measurement, so it has to sum as 0 AND count as covered.
 */
function spinachVitamins(vitaminC: number = VITAMIN_C_PER_100G): MicronutrientsPer100g['vitamins'] {
  // SAFETY: `VITAMIN_KEYS` is the exhaustive key list of `MicronutrientsPer100g['vitamins']`,
  // so mapping over it yields an entry for every required key exactly once; the assertion only
  // narrows `Object.fromEntries`' widened `string` key type back to that closed key set.
  return Object.fromEntries(
    VITAMIN_KEYS.map((key) => {
      if (key === 'vitaminC') return [key, vitaminC];
      if (key === 'vitaminB12') return [key, 0];
      return [key, null];
    }),
  ) as MicronutrientsPer100g['vitamins'];
}

/**
 * The match's snapshot deliberately has NO `minerals` block. That absence is
 * the third state and the easiest one to destroy by accident: a round trip or a
 * clone that helpfully materializes it as eighteen `null`s has turned "this
 * source has no mineral dimension" into "we looked and found nothing", which
 * are different facts with different futures.
 */
function spinachMicronutrients(vitaminC: number = VITAMIN_C_PER_100G): MicronutrientsPer100g {
  return { vitamins: spinachVitamins(vitaminC) };
}

function spinachMatch(): FoodMatch {
  return {
    slug: 'spinach',
    locale: 'en',
    title: 'Spinach',
    canonicalName: 'Spinach',
    url: null,
    imageUrl: null,
    macrosPer100g: { kcal: 23, protein: 2.9, fat: 0.4, carbs: 1.4, fiber: 2.2, sugars: null, polyols: null },
    netCarbsPer100g: 1.4,
    attribution: 'Bundeslebensmittelschlüssel (BLS) 4.0 — Max Rubner-Institut, CC BY 4.0 (adapted)',
    score: 0.95,
    origin: 'bls',
    portionSize: SERVING_GRAMS,
    micronutrientsPer100g: spinachMicronutrients(),
  };
}

/** Reads one nutrient off a snapshot as a plain assertion subject, states and all. */
function reading(micronutrients: MicronutrientsPer100g | undefined, key: 'vitaminC' | 'vitaminB12' | 'magnesium') {
  return readNutrientPer100g(micronutrients, key);
}

// ---------------------------------------------------------------------------
// The scan confirm chain: match -> rendered hidden input -> schema -> both rows
// ---------------------------------------------------------------------------

const AI_IDENTIFICATION = {
  foods: [
    {
      name: 'Spinach',
      estimatedGrams: SERVING_GRAMS,
      confidence: 'high' as const,
      macrosPer100g: { kcal: 20, protein: 2, fat: 0.5, carbs: 3 },
    },
  ],
};

/**
 * The confirm form's field values for one item: the match's own macros (mapped
 * by the REAL `matchMacrosToFormValues`) plus, optionally, the `curatedSource`
 * token that means "a match is applied". The micronutrient hidden field is
 * deliberately NOT seeded — it must be re-derived from `curatedSource` on every
 * render, so seeding it could make a broken derivation look fine.
 */
function confirmFormData({ applyMatch }: { applyMatch: boolean }): FormData {
  const formData = new FormData();
  formData.set('items[0].include', 'on');
  formData.set('items[0].name', 'Spinach');
  formData.set('items[0].estimatedGrams', String(SERVING_GRAMS));
  formData.set('items[0].confidence', 'high');
  formData.set('items[0].curatedSource', applyMatch ? toCuratedSource(spinachMatch().slug) : '');
  const macros = matchMacrosToFormValues(spinachMatch().macrosPer100g);
  for (const [key, value] of Object.entries(macros)) formData.set(`items[0].macros.${key}`, value);
  return formData;
}

function renderConfirmStep(formData: FormData): string {
  const submission = parseWithZod(formData, { schema: ConfirmDraftSchema });
  const element = createElement(ConfirmDraftForm, {
    identification: AI_IDENTIFICATION,
    modelId: 'test-model',
    matches: [[spinachMatch()]],
    lastResult: submission.reply({ formErrors: ['Select at least one food to log.'] }),
    logDate: null,
    logDateLabel: null,
    photoFile: null,
    userId: 0,
  });
  const router = createMemoryRouter([{ path: '/scan', element }], { initialEntries: ['/scan'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** Undoes React's SSR attribute escaping, so a JSON-valued hidden input reads back as the string it was. */
function unescapeAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function emittedHiddenValue(html: string, name: string): string {
  const pattern = new RegExp(
    `<input[^>]*name="${name.replaceAll('[', '\\[').replaceAll(']', '\\]').replaceAll('.', '\\.')}"[^>]*value="([^"]*)"[^>]*>`,
  );
  const match = pattern.exec(html);
  assert.ok(match, `expected a hidden input named "${name}" in the rendered markup, found none`);
  return unescapeAttribute(match[1] ?? '');
}

/**
 * The REAL scan submission: render the confirm step, take the micronutrient
 * snapshot from the hidden input IT emitted, and parse through the real
 * `ConfirmDraftSchema` exactly as `handleConfirm` does. One shared item,
 * because the confirm writes two rows from it and the pair proves nothing
 * unless both are built from the same parsed fact.
 */
function confirmedItem({ applyMatch }: { applyMatch: boolean }) {
  const formData = confirmFormData({ applyMatch });
  const html = renderConfirmStep(formData);
  const submitted = new FormData();
  for (const [key, value] of formData.entries()) submitted.set(key, value);
  submitted.set('items[0].micronutrientsPer100g', emittedHiddenValue(html, 'items[0].micronutrientsPer100g'));

  const submission = parseWithZod(submitted, { schema: ConfirmDraftSchema });
  assert.equal(submission.status, 'success', 'ConfirmDraftSchema rejected the confirm-step submission');
  if (submission.status !== 'success') throw new Error('unreachable');
  const item = submission.value.items[0];
  assert.ok(item, 'expected one confirmed item');
  return item;
}

function confirmedPer100g(item: ReturnType<typeof confirmedItem>): Macros {
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

/** The PERSONAL FOOD half of the scan write, through the real `buildConfirmedFood`. */
function scannedFood({ applyMatch }: { applyMatch: boolean }): LocalPersonalFood {
  const item = confirmedItem({ applyMatch });
  return buildConfirmedFood({ item, per100g: confirmedPer100g(item), id: 'scan-food-1', createdAtMs: AT_NOON });
}

/** The LOG half of the same write, through the real `buildConfirmedEntry`. */
function scannedLog({ applyMatch }: { applyMatch: boolean }): LocalFoodLog {
  const item = confirmedItem({ applyMatch });
  return buildConfirmedEntry({
    item,
    per100g: confirmedPer100g(item),
    id: 'scan-log-1',
    foodId: 'scan-food-1',
    loggedAtMs: AT_NOON,
    dayKey: DAY_KEY,
    createdAtMs: AT_NOON,
    logBatchId: 'batch-1',
  });
}

// ---------------------------------------------------------------------------
// The /add re-log chain: saved food -> candidate -> portion step -> entry
// ---------------------------------------------------------------------------

function renderPortionStep(candidate: AddSearchCandidate): string {
  const element = createElement(PortionStep, {
    candidate,
    defaultMealType: 'lunch' as const,
    returnTo: '/diary',
    logContext: { date: null, label: null, switchToTodayHref: '/add' },
    lastResult: undefined,
    onBack: () => {},
  });
  const router = createMemoryRouter([{ path: '/add', element }], { initialEntries: ['/add'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/**
 * The REAL "Your foods" re-log path: a saved personal food through the real
 * `localFoodToCandidate`, rendered by the real `PortionStep`, with the
 * micronutrient snapshot taken from the hidden input the STEP emitted (never
 * from the candidate object — that would bypass the wiring under test), parsed
 * by the real `createLogSchema` and built by the real `buildLoggedEntry`.
 * Deleting the candidate field, the hidden input, the schema field, or the
 * builder's assignment each breaks this chain.
 */
function reLogEntryFromSavedFood(food: LocalPersonalFood, { id = 'relog-1' }: { id?: string } = {}): LocalFoodLog {
  const candidate: AddSearchCandidate = { ...localFoodToCandidate(food), matchTier: null };
  const html = renderPortionStep(candidate);
  const formData = new FormData();
  formData.set('name', candidate.name);
  formData.set('quantityGrams', String(SERVING_GRAMS));
  formData.set('aiEstimated', candidate.aiEstimated ? 'true' : 'false');
  formData.set('curatedSource', candidate.curatedSource ?? '');
  formData.set('foodId', candidate.foodId ?? '');
  for (const [key, value] of Object.entries(candidate.macrosPer100g)) {
    formData.set(key, value === null ? '' : String(value));
  }
  formData.set('micronutrientsPer100g', emittedHiddenValue(html, 'micronutrientsPer100g'));

  const submission = parseWithZod(formData, { schema: createLogSchema(i18next.t) });
  assert.equal(submission.status, 'success', 'LogSchema rejected the portion-step submission');
  if (submission.status !== 'success') throw new Error('unreachable');
  return buildLoggedEntry({ data: submission.value, id, loggedAtMs: AT_NOON, dayKey: DAY_KEY, createdAtMs: AT_NOON });
}

/** The day's vitamin-C result for exactly these entries, through the real aggregation. */
function vitaminCForDay(logs: LocalFoodLog[]) {
  return computeDailyMicronutrients(logs, DAY_KEY).byNutrient.vitaminC;
}

////////////////////////////////////////////////////////////////////////////////

describe('a personal food created from an applied LCC match carries its micronutrients', () => {
  it('FIXTURE CHECK: the match really does carry a vitamin block and no mineral block', () => {
    const match = spinachMatch();
    assert.equal(reading(match.micronutrientsPer100g, 'vitaminC').state, 'measured');
    assert.equal(reading(match.micronutrientsPer100g, 'magnesium').state, 'no-block');
  });

  it('the saved food carries the match’s figures, per 100 g like its macros', () => {
    const food = scannedFood({ applyMatch: true });
    const vitaminC = reading(food.micronutrientsPer100g, 'vitaminC');
    assert.equal(vitaminC.state, 'measured');
    assert.equal(vitaminC.state === 'measured' ? vitaminC.value : null, VITAMIN_C_PER_100G);
  });

  it('keeps a measured 0 as a MEASUREMENT, not as a gap', () => {
    const b12 = reading(scannedFood({ applyMatch: true }).micronutrientsPer100g, 'vitaminB12');
    assert.equal(b12.state, 'measured');
    assert.equal(b12.state === 'measured' ? b12.value : null, 0);
  });

  it('does NOT materialize the match’s absent mineral block into a block of nulls', () => {
    const food = scannedFood({ applyMatch: true });
    assert.equal(food.micronutrientsPer100g?.minerals, undefined, 'an absent block was invented into an empty one');
    assert.equal(reading(food.micronutrientsPer100g, 'magnesium').state, 'no-block');
  });

  it('the LOG and the FOOD written by one confirm never disagree — they come from one upstream fact', () => {
    assert.deepEqual(
      scannedFood({ applyMatch: true }).micronutrientsPer100g,
      scannedLog({ applyMatch: true }).micronutrientsPer100g,
      'one confirm stored two different micronutrient snapshots for one food',
    );
  });

  it('hands the food and the log SEPARATE objects, so editing one can never mutate the other', () => {
    const item = confirmedItem({ applyMatch: true });
    const per100g = confirmedPer100g(item);
    const food = buildConfirmedFood({ item, per100g, id: 'f', createdAtMs: AT_NOON });
    const log = buildConfirmedEntry({
      item,
      per100g,
      id: 'l',
      foodId: 'f',
      loggedAtMs: AT_NOON,
      dayKey: DAY_KEY,
      createdAtMs: AT_NOON,
      logBatchId: 'b',
    });
    assert.notEqual(food.micronutrientsPer100g, log.micronutrientsPer100g);
    assert.notEqual(food.micronutrientsPer100g?.vitamins, log.micronutrientsPer100g?.vitamins);
  });
});

describe('a personal food nobody measured claims nothing — the honest-absent rule', () => {
  it('a plain AI plate estimate (no match applied) carries NO micronutrients', () => {
    const food = scannedFood({ applyMatch: false });
    assert.equal(food.micronutrientsPer100g, undefined);
  });

  it('a hand-typed manual food carries NO micronutrients', () => {
    const food = buildManualFood({
      name: 'Grandma’s soup',
      macrosPer100g: { carbs: 4, fiber: 1, sugars: null, polyols: null, protein: 2, fat: 3, kcal: 60 },
      carbBasis: null,
      id: 'manual-1',
      createdAtMs: AT_NOON,
    });
    assert.equal(food.micronutrientsPer100g, undefined);
  });

  it('never stands that absence in with an empty snapshot, null-filled blocks, or zeros', () => {
    for (const food of [
      scannedFood({ applyMatch: false }),
      buildManualFood({
        name: 'Grandma’s soup',
        macrosPer100g: { carbs: 4, fiber: 1, sugars: null, polyols: null, protein: 2, fat: 3, kcal: 60 },
        carbBasis: null,
        id: 'manual-1',
        createdAtMs: AT_NOON,
      }),
    ]) {
      // Not `{}` — an empty snapshot is indistinguishable from a populated one
      // at the type level, and would read as "we have the dimension".
      assert.notDeepEqual(food.micronutrientsPer100g, {});
      // Every nutrient must read `no-block`. `no-value` would mean "we looked",
      // and a `measured` 0 would be a fabricated measurement.
      for (const key of [...VITAMIN_KEYS, ...MINERAL_KEYS]) {
        assert.equal(
          readNutrientPer100g(food.micronutrientsPer100g, key).state,
          'no-block',
          `${key} claims more than this food knows`,
        );
      }
    }
  });

  it('and its logs therefore read as genuinely uncovered, never as a confident zero', () => {
    const entry = reLogEntryFromSavedFood(scannedFood({ applyMatch: false }));
    const vitaminC = vitaminCForDay([entry]);
    assert.equal(vitaminC.hasEnoughData, false);
    assert.equal(vitaminC.amount, null);
    assert.equal(vitaminC.coveredFraction, 0);
  });
});

describe('re-logging a saved food from "Your foods" now contributes coverage', () => {
  it('FIXTURE CHECK: the same food WITHOUT the field (the v9 behaviour) contributes none', () => {
    const { micronutrientsPer100g: _dropped, ...v9Food } = scannedFood({ applyMatch: true });
    const entry = reLogEntryFromSavedFood(v9Food);
    const vitaminC = vitaminCForDay([entry]);
    assert.equal(vitaminC.coveredFraction, 0, 'the fixture is not discriminating — v9 already covered this day');
    assert.equal(vitaminC.hasEnoughData, false);
  });

  it('the re-logged entry carries the food’s snapshot all the way to the day’s coverage', () => {
    const entry = reLogEntryFromSavedFood(scannedFood({ applyMatch: true }));
    const vitaminC = vitaminCForDay([entry]);
    assert.equal(vitaminC.coveredFraction, 1, 'a re-logged saved food is still contributing no coverage');
    assert.equal(vitaminC.hasEnoughData, true);
    assert.equal(vitaminC.amount, VITAMIN_C_PER_100G);
  });

  it('and a "Recent" re-log of the same food agrees with it — one food, one coverage answer', () => {
    // The two paths differ only in which factory built the candidate. Before
    // v10 they disagreed: `localCuratedMatchToCandidate` carried the snapshot
    // and `localFoodToCandidate` dropped it.
    const fromSavedFood = localFoodToCandidate(scannedFood({ applyMatch: true })).micronutrientsPer100g;
    const fromMatch = localCuratedMatchToCandidate(spinachMatch()).micronutrientsPer100g;
    assert.deepEqual(fromSavedFood, fromMatch);
  });
});

describe('undo-restore and copy-yesterday read the LOG, never the food’s current state', () => {
  /**
   * The food as it stands TODAY, after the person corrected its vitamin C —
   * deliberately a different number from the one its old logs recorded. Any
   * path that re-derives from the food instead of copying the log will return
   * this figure, and every assertion below is written to catch exactly that.
   */
  const CORRECTED_VITAMIN_C = 99;

  function editedFood(): LocalPersonalFood {
    return { ...scannedFood({ applyMatch: true }), micronutrientsPer100g: spinachMicronutrients(CORRECTED_VITAMIN_C) };
  }

  it('FIXTURE CHECK: the food has genuinely diverged from the log it produced', () => {
    const logValue = reading(scannedLog({ applyMatch: true }).micronutrientsPer100g, 'vitaminC');
    const foodValue = reading(editedFood().micronutrientsPer100g, 'vitaminC');
    assert.equal(logValue.state === 'measured' ? logValue.value : null, VITAMIN_C_PER_100G);
    assert.equal(foodValue.state === 'measured' ? foodValue.value : null, CORRECTED_VITAMIN_C);
  });

  it('Undo restores the figures the entry was logged with, not the food’s corrected ones', () => {
    const original = scannedLog({ applyMatch: true });
    // The food is edited between the delete and the Undo — the whole point.
    const stillOnDevice = editedFood();
    assert.equal(original.foodId, stillOnDevice.id, 'the log must point at the food that was edited');

    const payload = buildRestorePayload(original);
    const formData = new FormData();
    for (const [key, value] of Object.entries(payload)) formData.set(key, value);
    const submission = parseWithZod(formData, { schema: RestoreLogSchema });
    assert.equal(submission.status, 'success', 'RestoreLogSchema rejected the Undo payload');
    if (submission.status !== 'success') throw new Error('unreachable');

    const restored = buildRestoredEntry({
      value: submission.value,
      id: 'restored-1',
      loggedAtMs: original.loggedAt,
      dayKey: DAY_KEY,
      createdAtMs: AT_NOON,
    });
    const vitaminC = reading(restored.micronutrientsPer100g, 'vitaminC');
    assert.equal(
      vitaminC.state === 'measured' ? vitaminC.value : null,
      VITAMIN_C_PER_100G,
      'Undo rewrote history — it took the food’s current figures instead of the entry’s own',
    );
    // The absent mineral block survives the form round trip too.
    assert.equal(reading(restored.micronutrientsPer100g, 'magnesium').state, 'no-block');
  });

  it('Copy-yesterday copies the source ENTRY’s figures, not the food’s corrected ones', () => {
    const yesterdaysLog: LocalFoodLog = { ...scannedLog({ applyMatch: true }), dayKey: YESTERDAY_KEY };
    const stillOnDevice = editedFood();
    assert.equal(yesterdaysLog.foodId, stillOnDevice.id, 'the log must point at the food that was edited');

    const copy = buildCopiedEntry({
      log: yesterdaysLog,
      id: 'copy-1',
      dayKey: DAY_KEY,
      loggedAtMs: AT_NOON,
      createdAtMs: AT_NOON,
      logBatchId: 'copy-batch',
    });
    const vitaminC = reading(copy.micronutrientsPer100g, 'vitaminC');
    assert.equal(
      vitaminC.state === 'measured' ? vitaminC.value : null,
      VITAMIN_C_PER_100G,
      'copy-yesterday re-derived from the food instead of copying the entry',
    );
    assert.equal(vitaminCForDay([copy]).amount, VITAMIN_C_PER_100G);
  });
});

describe('backup round trip', () => {
  const V9_FOOD = {
    id: 'v9-food',
    name: 'Spinach',
    brand: null,
    macrosPer100g: { carbs: 1.4, fiber: 2.2, sugars: null, polyols: null, protein: 2.9, fat: 0.4, kcal: 23 },
    source: 'plate_ai',
    createdAt: 1_700_000_000_000,
    netCarbsPer100g: 1.4,
  };

  it('a v9 envelope — taken before personal foods had the field — imports cleanly', () => {
    const migrated = migrateEnvelopeForward({
      schemaVersion: 9,
      exportedAt: '2026-08-06T10:00:00.000Z',
      data: { foods: [V9_FOOD], foodLogs: [], weightEntries: [], fasts: [], profile: null },
    });

    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    const food = migrated.data.foods[0];
    assert.ok(food);
    // Absent, not back-filled — an absent key already means "never captured",
    // which is why no migration function was written for this bump.
    assert.equal(food.micronutrientsPer100g, undefined);
    // Nothing else about the older envelope was disturbed.
    assert.equal(food.netCarbsPer100g, 1.4);
  });

  it('a v10 envelope round-trips a saved food’s snapshot losslessly, absent block included', () => {
    const food = scannedFood({ applyMatch: true });
    const serialized = serializeBackup({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-08-07T10:00:00.000Z',
      data: {
        foods: [food],
        foodLogs: [],
        weightEntries: [],
        fasts: [],
        savedMeals: [],
        profile: null,
        shareIdentity: null,
        sharePeers: [],
        researchIdentity: null,
        studyEnrolments: [],
      },
    });

    const restored = migrateEnvelopeForward(parseBackupEnvelope(serialized)).data.foods[0];
    assert.ok(restored);
    assert.deepEqual(
      restored.micronutrientsPer100g,
      food.micronutrientsPer100g,
      'zod stripped the key — a saved food’s vitamins vanish on every export/import',
    );
    assert.equal(restored.micronutrientsPer100g?.minerals, undefined, 'the absent mineral block was materialized');
    // A measured 0 must survive as a measurement, not be dropped as falsy.
    assert.equal(reading(restored.micronutrientsPer100g, 'vitaminB12').state, 'measured');
  });

  it('a v10 envelope round-trips a food with NO snapshot as still having none', () => {
    const food = buildManualFood({
      name: 'Grandma’s soup',
      macrosPer100g: { carbs: 4, fiber: 1, sugars: null, polyols: null, protein: 2, fat: 3, kcal: 60 },
      carbBasis: null,
      id: 'manual-1',
      createdAtMs: AT_NOON,
    });
    const serialized = serializeBackup({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-08-07T10:00:00.000Z',
      data: {
        foods: [food],
        foodLogs: [],
        weightEntries: [],
        fasts: [],
        savedMeals: [],
        profile: null,
        shareIdentity: null,
        sharePeers: [],
        researchIdentity: null,
        studyEnrolments: [],
      },
    });

    const restored = migrateEnvelopeForward(parseBackupEnvelope(serialized)).data.foods[0];
    assert.ok(restored);
    assert.equal(restored.micronutrientsPer100g, undefined, 'an import invented a snapshot for a food that had none');
  });
});
