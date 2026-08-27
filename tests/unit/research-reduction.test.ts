/**
 * THE REDUCTION TEST (M161/03, `openplate-sync` ADR-0003 prohibitions 1 and
 * 11) — the gate that makes "the reduction map fails closed" a fact rather
 * than a sentence in a document.
 *
 * Three design rules, and each one is the difference between a real guard and
 * a comforting one:
 *
 *  1. **The snapshot comes from the REAL builder** (`createPrimaryStore` → the
 *     `put*` helpers → `exportBackup`), exactly as `snapshot-partition.test.ts`
 *     does. A hand-rolled snapshot literal is a second thing to forget, and it
 *     would pass cleanly through the very drift this file exists to catch.
 *  2. **The expected field list is written LITERALLY below**, not imported
 *     from `tiers.ts`. Importing it would compare a constant to itself and
 *     pass on any field somebody added to both. Two edits, one of them a
 *     human review gate — that is the whole mechanism.
 *  3. **The assertions are POSITIVE.** A grep for the absence of a timestamp
 *     passes on an empty result, so the fixture is genuinely populated, the
 *     macro sums are asserted to exact expected values, and the per-serving
 *     figures are chosen so that a second scaling by `quantityGrams` would
 *     change them.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimaryStore } from '../../app/lib/local-store/store';
import { exportBackup } from '../../app/lib/local-store/backup';
import { putLocalFood, putLocalFoodLog } from '../../app/lib/local-store/primary-store';
import type { LocalStoreSnapshot } from '../../app/lib/local-store/schema';
import { reduceDailyIntakeV1 } from '../../app/lib/sync/research/reduce';

/**
 * THE FROZEN TIER, restated by hand.
 *
 * This list must equal `PROTOCOL.md` §3.5's `daily-intake:v1` — `date`,
 * `energyKcal`, `proteinG`, `carbsG`, `fatG`, `fiberG`, `loggedEntryCount` —
 * and CHANGING IT IS A PROTOCOL REVISION, never a configuration and never a
 * convenience. It is deliberately NOT imported from `tiers.ts`: an import
 * would make the assertion below compare the implementation to itself, and it
 * would pass on any field added to the tier without anyone reading this file.
 */
const PROTOCOL_DAILY_INTAKE_V1_FIELDS = [
  'date',
  'energyKcal',
  'proteinG',
  'carbsG',
  'fatG',
  'fiberG',
  'loggedEntryCount',
];

/** The window every test below reduces over. `2026-08-25` is inside it and deliberately holds nothing. */
const FROM_DAY = '2026-08-24';
const TO_DAY = '2026-08-27';

/** A food name distinctive enough that finding it in a payload means something. */
const DIARY_MARKER = 'Acerola';

/** The epoch-ms stamps the fixture writes. No reduced row may contain any of them, in any field. */
const LOGGED_AT_STAMPS = [1_756_000_000_000, 1_756_000_111_000, 1_756_100_000_000, 1_756_200_000_000];

/**
 * A snapshot built by the REAL builder, holding entries on three of the four
 * days in the window and two entries OUTSIDE it.
 *
 * Every `macros` block here is per-serving, exactly as the app writes them —
 * `quantityGrams` is 250 on purpose, so a reducer that re-scaled by it would
 * multiply every figure by 2.5 and fail the arithmetic assertions below.
 */
async function buildSnapshotWithDiary(): Promise<LocalStoreSnapshot> {
  const store = createPrimaryStore();
  await putLocalFood(
    {
      id: 'food-1',
      name: DIARY_MARKER,
      brand: null,
      macrosPer100g: { carbs: 11, fiber: 1, sugars: null, polyols: null, protein: 0.4, fat: 0.3, kcal: 32 },
      source: 'user',
      createdAt: 1_000,
    },
    { store },
  );

  const log = async ({
    id,
    dayKey,
    loggedAt,
    kcal,
    protein,
    carbs,
    fat,
    fiber,
  }: {
    id: string;
    dayKey: string;
    loggedAt: number;
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number | null;
  }): Promise<void> => {
    await putLocalFoodLog(
      {
        id,
        name: DIARY_MARKER,
        quantityGrams: 250,
        macros: { carbs, fiber, sugars: null, polyols: null, protein, fat, kcal },
        mealType: 'snack',
        source: 'manual',
        aiEstimated: false,
        curatedSource: 'lowcarbcheck:acerola',
        foodId: 'food-1',
        dayKey,
        loggedAt,
        createdAt: loggedAt,
        logBatchId: null,
      },
      { store },
    );
  };

  // Two entries on one day — so the row is a SUM, not a passthrough. The two
  // protein figures are 0.1 and 0.2, whose float sum is 0.30000000000000004:
  // the rounding rule is what makes the assertion below exact.
  await log({ id: 'log-1', dayKey: '2026-08-24', loggedAt: 1_756_000_000_000, kcal: 80, protein: 0.1, carbs: 27.5, fat: 0.75, fiber: 2.5 });
  await log({ id: 'log-2', dayKey: '2026-08-24', loggedAt: 1_756_000_111_000, kcal: 40, protein: 0.2, carbs: 13.5, fat: 0.25, fiber: 1.5 });
  // 2026-08-25 is deliberately EMPTY — it is the day the second test is about.
  // A `fiber: null` entry: unknown contributes nothing, and the count says so.
  await log({ id: 'log-3', dayKey: '2026-08-26', loggedAt: 1_756_100_000_000, kcal: 32, protein: 0.4, carbs: 11, fat: 0.3, fiber: null });
  await log({ id: 'log-4', dayKey: '2026-08-27', loggedAt: 1_756_200_000_000, kcal: 16, protein: 0.2, carbs: 5.5, fat: 0.2, fiber: 0.5 });
  // OUTSIDE the window on both sides. Neither may appear in any row.
  await log({ id: 'log-before', dayKey: '2026-08-23', loggedAt: 1_755_000_000_000, kcal: 999, protein: 99, carbs: 99, fat: 99, fiber: 99 });
  await log({ id: 'log-after', dayKey: '2026-08-28', loggedAt: 1_757_000_000_000, kcal: 777, protein: 77, carbs: 77, fat: 77, fiber: 77 });

  return (await exportBackup({ store })).data;
}

describe('the daily-intake:v1 reduction', () => {
  it('reduction emits exactly the tier: seven fields per row, from a snapshot the real builder produced', async () => {
    const snapshot = await buildSnapshotWithDiary();
    // The fixture must be genuinely populated, or every claim below is vacuous.
    assert.ok(snapshot.foodLogs.length >= 6, 'the fixture must actually hold a diary');

    const rows = reduceDailyIntakeV1({ snapshot, fromDayKey: FROM_DAY, toDayKey: TO_DAY });

    // THE KEY-SET GATE. Compared against the hand-written list at the top of
    // this file — an eighth field fails here, on every row, by name.
    const expectedFields = PROTOCOL_DAILY_INTAKE_V1_FIELDS.toSorted();
    for (const row of rows) {
      assert.deepEqual(
        Object.keys(row).toSorted(),
        expectedFields,
        `a reduced row's fields must be exactly PROTOCOL.md §3.5's daily-intake:v1 tier`,
      );
    }

    // POSITIVE: the reduction is real arithmetic over the fixture. The two
    // 2026-08-24 entries are SUMMED, and 0.1 + 0.2 is rounded to 0.3 rather
    // than shipping 0.30000000000000004 — device float noise is itself a
    // signal, so it does not travel.
    assert.deepEqual(rows[0], {
      date: '2026-08-24',
      energyKcal: 120,
      proteinG: 0.3,
      carbsG: 41,
      fatG: 1,
      fiberG: 4,
      loggedEntryCount: 2,
    });

    // Macros are used AS STORED — already per-serving. `quantityGrams` is 250
    // in the fixture, so a reducer that rescaled would report 40 kcal here.
    assert.deepEqual(rows[3], {
      date: '2026-08-27',
      energyKcal: 16,
      proteinG: 0.2,
      carbsG: 5.5,
      fatG: 0.2,
      fiberG: 0.5,
      loggedEntryCount: 1,
    });

    // An UNKNOWN macro contributes nothing and is not invented; the count is
    // what tells a researcher there was an entry behind the zero.
    assert.equal(rows[2]?.fiberG, 0);
    assert.equal(rows[2]?.loggedEntryCount, 1);

    // The window is inclusive and gapless, oldest first.
    assert.deepEqual(
      rows.map((row) => row.date),
      ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27'],
    );

    // NOTHING outside the window leaked in: the two 999/777 entries would be
    // unmissable in any total.
    const serialized = JSON.stringify(rows);
    assert.equal(serialized.includes('999'), false, 'an entry before the window reached a row');
    assert.equal(serialized.includes('77'), false, 'an entry after the window reached a row');

    // NO TIMESTAMP REACHES A PAYLOAD, and no entry-level field either.
    for (const stamp of LOGGED_AT_STAMPS) {
      assert.equal(serialized.includes(String(stamp)), false, `epoch-ms ${stamp} reached a reduced row`);
    }
    assert.equal(serialized.includes(DIARY_MARKER), false, 'a food name reached a reduced row');
    for (const forbidden of ['loggedAt', 'createdAt', 'logBatchId', 'quantityGrams', 'mealType', 'curatedSource']) {
      assert.equal(serialized.includes(forbidden), false, `entry-level field "${forbidden}" reached a reduced row`);
    }
  });

  it('an empty day inside the window still emits a row, counted zero', async () => {
    const snapshot = await buildSnapshotWithDiary();
    const rows = reduceDailyIntakeV1({ snapshot, fromDayKey: FROM_DAY, toDayKey: TO_DAY });

    // 2026-08-25 holds nothing. It must still be here, because "ate nothing"
    // and "did not log" are the same absence without a row — and telling them
    // apart is why `loggedEntryCount` exists at all.
    const emptyDay = rows.find((row) => row.date === '2026-08-25');
    assert.deepEqual(emptyDay, {
      date: '2026-08-25',
      energyKcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      loggedEntryCount: 0,
    });

    // And the window is complete: one row per calendar day, no gaps, even
    // across a window whose every day is empty.
    assert.equal(rows.length, 4);
    const empties = reduceDailyIntakeV1({ snapshot, fromDayKey: '2026-09-01', toDayKey: '2026-09-03' });
    assert.deepEqual(
      empties.map((row) => row.loggedEntryCount),
      [0, 0, 0],
    );
  });
});
