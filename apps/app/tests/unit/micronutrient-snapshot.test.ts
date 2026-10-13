/**
 * `buildMicronutrientSnapshot`, every arm, through the real pipeline.
 *
 * The rows are never hand-built. Each case logs foods, runs them through
 * `computeMicronutrientsInWindow` and `buildNutrientRows` exactly as the diary
 * and Insights do, and only then asks for the snapshot. So a case proves what a
 * person would see for those logs, not what the builder does with an invented
 * row.
 *
 * EVERY CLAIM HAS A CONTROL that makes it fail: the same logs with one fact
 * changed, which must land in another arm or another list. An arm that every
 * input reached would pass its own case and fail its control.
 *
 * The reference amounts below are fixture figures, round numbers of the right
 * size, written for this file. They are not copied from any published table.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeMicronutrientsInWindow, DEFAULT_MIN_COVERAGE_FRACTION } from '../../app/lib/local-store/aggregates';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';
import { buildMicronutrientSnapshot, SNAPSHOT_GAP_LIMIT } from '../../app/lib/micronutrient-snapshot';
import type { MicronutrientSnapshot, ReadySnapshot } from '../../app/lib/micronutrient-snapshot';
import { MINERAL_KEYS, VITAMIN_KEYS } from '../../app/lib/micronutrients';
import type { MicronutrientsPer100g, MineralKey, NutrientKey, VitaminKey } from '../../app/lib/micronutrients';
import { buildNutrientRows, DISPLAYED_NUTRIENT_KEYS } from '../../app/lib/nutrient-reference';
import type { NutrientKind, NutrientReference } from '../../app/lib/nutrient-reference';
import { EMPTY_BODY_METRICS, RDA_AGE_BANDS } from '../../app/models/body-metrics';
import type { BodyMetrics } from '../../app/models/body-metrics';

const DAY = '2026-10-11';
const CURRENT_YEAR = 2026;

/** An adult with both facts a reference amount is looked up by. */
const ADULT: BodyMetrics = { ...EMPTY_BODY_METRICS, biologicalSex: 'female', birthYear: 1990 };

/** A year of birth below the youngest published band. */
const CHILD: BodyMetrics = { ...EMPTY_BODY_METRICS, biologicalSex: 'female', birthYear: 2020 };

/** Fixture reference amount for every target nutrient, in its own unit. */
const TARGET_AMOUNT = 100;
/** Fixture limit for sodium, in mg. */
const SODIUM_LIMIT = 2000;

/** A per-100 g figure far above every fixture reference, so a nutrient at it is never a gap. */
const PLENTY = 10_000;

/** One fixture reference: the same amount for every band and both sexes. */
function reference({ key, amount, kind }: { key: NutrientKey; amount: number; kind: NutrientKind }): NutrientReference {
  const bands = Object.fromEntries(RDA_AGE_BANDS.map((band) => [band, amount]));
  // SAFETY: `RDA_AGE_BANDS` is every band, so the object has one entry per band.
  const perBand = bands as Record<(typeof RDA_AGE_BANDS)[number], number>;
  return {
    key,
    slug: key,
    unit: 'mg',
    kind,
    rda: { source: 'Fixture reference', male: perBand, female: perBand, pregnancy: null, lactation: null },
  };
}

/** A reference for every displayed nutrient: sodium a limit, the rest targets. */
const REFERENCES: NutrientReference[] = DISPLAYED_NUTRIENT_KEYS.map((key) =>
  key === 'sodium' ?
    reference({ key, amount: SODIUM_LIMIT, kind: 'ceiling' })
  : reference({ key, amount: TARGET_AMOUNT, kind: 'target' }),
);

/** A full block where every nutrient is plentiful, except the figures given. */
function plentifulBlock(overrides: Partial<Record<NutrientKey, number>> = {}): MicronutrientsPer100g {
  const valueOf = (key: NutrientKey): number => overrides[key] ?? PLENTY;
  // SAFETY: each `Object.fromEntries` maps exactly the keys of its block to a number.
  const vitamins = Object.fromEntries(VITAMIN_KEYS.map((key) => [key, valueOf(key)])) as Record<VitaminKey, number>;
  // SAFETY: as above, for the mineral keys.
  const minerals = Object.fromEntries(MINERAL_KEYS.map((key) => [key, valueOf(key)])) as Record<MineralKey, number>;
  return { vitamins, minerals };
}

/** One log on {@link DAY}. With no block it is an AI estimate, which carries no micronutrients. */
function foodLog({
  id,
  grams,
  block,
}: {
  id: string;
  grams: number;
  block?: MicronutrientsPer100g;
}): LocalFoodLog {
  const loggedAt = Date.parse(`${DAY}T12:00:00Z`);
  const log: LocalFoodLog = {
    id,
    name: id,
    quantityGrams: grams,
    macros: { carbs: 5, fiber: 1, sugars: null, polyols: null, protein: 2, fat: 1, kcal: 40 },
    mealType: null,
    source: block === undefined ? 'plate_ai' : 'manual',
    aiEstimated: block === undefined,
    curatedSource: block === undefined ? null : 'fixture',
    foodId: null,
    dayKey: DAY,
    loggedAt,
    createdAt: loggedAt,
    logBatchId: null,
  };
  if (block !== undefined) log.micronutrientsPer100g = block;
  return log;
}

/** What the builder is given besides the logs. */
interface SnapshotSetup {
  metrics?: BodyMetrics;
  references?: readonly NutrientReference[];
}

/** Runs logs through the same pipeline the panes use, then builds the snapshot. */
function snapshotOf(logs: readonly LocalFoodLog[], { metrics = ADULT, references = REFERENCES }: SnapshotSetup = {}) {
  const window = computeMicronutrientsInWindow(
    logs,
    { fromDate: DAY, toDate: DAY },
    { minCoverageFraction: DEFAULT_MIN_COVERAGE_FRACTION },
  );
  const rows = buildNutrientRows({
    byNutrient: window.byNutrient,
    loggedDays: window.loggedDays,
    references,
    metrics,
    currentYear: CURRENT_YEAR,
  });
  return buildMicronutrientSnapshot({
    rows,
    totalEntries: window.totalEntries,
    referencesReachable: references.length > 0,
    hasBodyMetrics: metrics.biologicalSex !== null && metrics.birthYear !== null,
  });
}

/** The snapshot, asserted to be the ready arm. */
function readyOf(snapshot: MicronutrientSnapshot): ReadySnapshot {
  assert.equal(snapshot.kind, 'ready');
  // SAFETY: the line above fails the test unless the arm is `ready`.
  return snapshot as ReadySnapshot;
}

/** 100 g of food whose magnesium is 30% of the fixture reference, and everything else plentiful. */
const LOW_MAGNESIUM = [foodLog({ id: 'greens', grams: 100, block: plentifulBlock({ magnesium: 30 }) })];

describe('empty: nothing logged', () => {
  it('is empty for a window with no entry', () => {
    assert.deepEqual(snapshotOf([]), { kind: 'empty' });
  });

  it('control: one logged entry is not empty, even an AI estimate', () => {
    assert.notEqual(snapshotOf([foodLog({ id: 'plate', grams: 300 })]).kind, 'empty');
  });
});

describe('not-enough-data: no displayed nutrient clears the coverage bar', () => {
  it('reports a coverage of 0 for a day of AI estimates only', () => {
    const snapshot = snapshotOf([foodLog({ id: 'plate', grams: 300 }), foodLog({ id: 'bowl', grams: 200 })]);
    assert.deepEqual(snapshot, { kind: 'not-enough-data', bestCoveredFraction: 0 });
  });

  it('carries the best gram-weighted coverage of a mixed day just under the bar', () => {
    const snapshot = snapshotOf([
      foodLog({ id: 'greens', grams: 55, block: plentifulBlock() }),
      foodLog({ id: 'plate', grams: 45 }),
    ]);
    assert.equal(snapshot.kind, 'not-enough-data');
    assert.ok(snapshot.kind === 'not-enough-data' && Math.abs(snapshot.bestCoveredFraction - 0.55) < 1e-9);
  });

  it('control: the same mix at the bar is ready, so the arm is decided by the bar', () => {
    const snapshot = snapshotOf([
      foodLog({ id: 'greens', grams: 60, block: plentifulBlock() }),
      foodLog({ id: 'plate', grams: 40 }),
    ]);
    assert.equal(snapshot.kind, 'ready');
  });
});

describe('ready: counts and gaps', () => {
  it('counts every displayed nutrient as covered on a fully covered day', () => {
    const snapshot = readyOf(snapshotOf(LOW_MAGNESIUM));
    assert.equal(snapshot.totalCount, DISPLAYED_NUTRIENT_KEYS.length);
    assert.equal(snapshot.coveredCount, DISPLAYED_NUTRIENT_KEYS.length);
    assert.equal(snapshot.references, 'available');
  });

  it('control: a nutrient with no figure is not counted as covered', () => {
    const snapshot = readyOf(
      snapshotOf([foodLog({ id: 'greens', grams: 100, block: { minerals: plentifulBlock().minerals } })]),
    );
    assert.equal(snapshot.coveredCount, MINERAL_KEYS.filter((key) => DISPLAYED_NUTRIENT_KEYS.includes(key)).length);
  });

  it('names the light nutrient with its share, and only that one', () => {
    const snapshot = readyOf(snapshotOf(LOW_MAGNESIUM));
    assert.deepEqual(snapshot.gaps, [{ key: 'magnesium', share: 0.3 }]);
  });

  it('control: a plentiful day has no gaps', () => {
    const snapshot = readyOf(snapshotOf([foodLog({ id: 'greens', grams: 100, block: plentifulBlock() })]));
    assert.deepEqual(snapshot.gaps, []);
  });

  it(`names at most ${SNAPSHOT_GAP_LIMIT}, lowest share first`, () => {
    const snapshot = readyOf(
      snapshotOf([
        foodLog({
          id: 'greens',
          grams: 100,
          block: plentifulBlock({ magnesium: 50, calcium: 10, zinc: 40, iron: 20 }),
        }),
      ]),
    );
    assert.deepEqual(
      snapshot.gaps.map((gap) => gap.key),
      ['calcium', 'iron', 'zinc'],
    );
  });

  it('control: a share at the 80% suggestion ceiling is not a gap', () => {
    const snapshot = readyOf(
      snapshotOf([foodLog({ id: 'greens', grams: 100, block: plentifulBlock({ magnesium: 80 }) })]),
    );
    assert.deepEqual(snapshot.gaps, []);
  });
});

describe('ready: limits', () => {
  it('lists sodium above its limit with both figures, and never as a gap', () => {
    const snapshot = readyOf(
      snapshotOf([foodLog({ id: 'broth', grams: 100, block: plentifulBlock({ sodium: 3000 }) })]),
    );
    assert.deepEqual(snapshot.overLimits, [{ key: 'sodium', unit: 'mg', amount: 3000, limit: SODIUM_LIMIT }]);
    assert.ok(snapshot.gaps.every((gap) => gap.key !== 'sodium'));
  });

  it('control: sodium under its limit is in neither list, however low', () => {
    const snapshot = readyOf(snapshotOf([foodLog({ id: 'greens', grams: 100, block: plentifulBlock({ sodium: 5 }) })]));
    assert.deepEqual(snapshot.overLimits, []);
    assert.deepEqual(snapshot.gaps, []);
  });
});

describe('ready: why there are no gaps', () => {
  it('says no-body-metrics with no sex or year of birth, and ranks nothing', () => {
    const snapshot = readyOf(snapshotOf(LOW_MAGNESIUM, { metrics: EMPTY_BODY_METRICS }));
    assert.equal(snapshot.references, 'no-body-metrics');
    assert.deepEqual(snapshot.gaps, []);
    assert.equal(snapshot.coveredCount, DISPLAYED_NUTRIENT_KEYS.length);
  });

  it('says unreachable when the reference list came back empty, and ranks nothing', () => {
    const snapshot = readyOf(snapshotOf(LOW_MAGNESIUM, { references: [] }));
    assert.equal(snapshot.references, 'unreachable');
    assert.deepEqual(snapshot.gaps, []);
    assert.deepEqual(snapshot.overLimits, []);
  });

  it('says age-out-of-bands for a year of birth below the youngest band', () => {
    const snapshot = readyOf(snapshotOf(LOW_MAGNESIUM, { metrics: CHILD }));
    assert.equal(snapshot.references, 'age-out-of-bands');
    assert.deepEqual(snapshot.gaps, []);
  });

  it('names the missing body metrics first when the references are unreachable as well', () => {
    const snapshot = readyOf(snapshotOf(LOW_MAGNESIUM, { metrics: EMPTY_BODY_METRICS, references: [] }));
    assert.equal(snapshot.references, 'no-body-metrics');
  });

  it('control: the same day with an adult and references ranks the gap, so each case above changed one fact', () => {
    const snapshot = readyOf(snapshotOf(LOW_MAGNESIUM));
    assert.equal(snapshot.references, 'available');
    assert.equal(snapshot.gaps.length, 1);
  });
});
