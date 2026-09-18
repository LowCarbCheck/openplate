/**
 * The mark and award CRUD in `app/lib/local-store/primary-store` (M235/02),
 * driven against a REAL in-memory TinyBase store, the harness
 * `local-store-primary-retention.test.ts` established.
 *
 * Three invariants live here, and none of them is visible on a screen.
 *
 *  1. WRITE-ONCE BY KEY. A second `putLocalActivityMark` for the same id must
 *     change no bytes, because `stampSnapshot` mints a new Lamport stamp for a
 *     row that CHANGED. A person who opens the app ten times a day fires the
 *     same signal ten times, and without the read before the write every one of
 *     those would push churn a peer has to merge. The assertion is on the
 *     stored cell itself rather than on the return value, so a version that
 *     rewrote identical bytes with a new `seenAt` would be caught.
 *
 *  2. A MARK IS NOT DATA. `firstDataAt` is the durable "this device has had
 *     data before" marker, and `had-data.ts` stamps it on a food log or a
 *     profile write only. A mark says the app was OPENED, which is a weaker
 *     claim than anything that marker is read for, so it must not stamp it and
 *     `hasAnyLocalData` must not count it. Its control is the food log written
 *     in the same test, which MUST stamp it, or the assertion would pass
 *     against a store whose marker was simply broken.
 *
 *  3. `markAwardSeen` IS THE ONE MUTATING VERB. Its control is `putLocalAward`
 *     beside it, which must NOT overwrite a stamp the person already has.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimaryStore } from '../../app/lib/local-store/store';
import {
  hasLocalActivityMark,
  listLocalActivityMarks,
  listLocalAwards,
  markAwardSeen,
  putLocalActivityMark,
  putLocalAward,
  putLocalFoodLog,
} from '../../app/lib/local-store/primary-store';
import { getFirstDataAt, hasEverHadData } from '../../app/lib/local-store/had-data';
import { hasAnyLocalData } from '../../app/lib/local-store/backup';
import { ACTIVITY_MARKS_TABLE, AWARDS_TABLE, PRIMARY_ENTITY_CELL } from '../../app/lib/local-store/schema';
import type { LocalActivityMark, LocalAward, LocalFoodLog } from '../../app/lib/local-store/schema';
import type { Cell, Store } from 'tinybase';

const NOW = 1_700_000_000_000;

/** A mark, always with the id the pure core would have minted for it. */
function mark(dayKey: string, signal: string): LocalActivityMark {
  return { id: `${dayKey}#${signal}`, dayKey, signal };
}

/** An earned award, unseen unless the caller says otherwise. */
function award(key: string, overrides: Partial<LocalAward> = {}): LocalAward {
  return { key, earnedAt: NOW, earnedOnDay: '2026-09-18', seenAt: null, ...overrides };
}

/** A minimal food log, the one write that IS data. */
function foodLog(id: string): LocalFoodLog {
  return {
    id,
    name: 'Acerola',
    quantityGrams: 50,
    macros: { carbs: 5.5, fiber: null, sugars: null, polyols: null, protein: 0.2, fat: 0.15, kcal: 16 },
    mealType: 'snack',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: '2026-09-18',
    loggedAt: NOW,
    createdAt: NOW,
    logBatchId: null,
  };
}

/**
 * The raw JSON cell a row holds, which is what a sync stamp compares.
 *
 * `table` and `id` are both strings, so they arrive named rather than in an
 * order a reader has to remember.
 */
function cell({ store, table, id }: { store: Store; table: string; id: string }): Cell | undefined {
  return store.getCell(table, id, PRIMARY_ENTITY_CELL);
}

describe('putLocalActivityMark', () => {
  it('writes a mark, and reads it back through both readers', async () => {
    const store = createPrimaryStore();

    await putLocalActivityMark({ mark: mark('2026-09-18', 'food.logged'), store });

    assert.deepEqual(await listLocalActivityMarks({ store }), [mark('2026-09-18', 'food.logged')]);
    assert.equal(await hasLocalActivityMark({ id: '2026-09-18#food.logged', store }), true);
    assert.equal(await hasLocalActivityMark({ id: '2026-09-18#weight.logged', store }), false);
  });

  it('is WRITE-ONCE: a second call for the same id changes no bytes', async () => {
    const store = createPrimaryStore();
    const id = '2026-09-18#food.logged';
    await putLocalActivityMark({ mark: mark('2026-09-18', 'food.logged'), store });
    const first = cell({ store, table: ACTIVITY_MARKS_TABLE, id });

    // A second signal on the same day, with a DIFFERENT day key inside the
    // cell, so a version that simply rewrote the row would be visible here
    // rather than hidden behind identical content.
    const second = await putLocalActivityMark({ mark: { id, dayKey: '2099-01-01', signal: 'tampered' }, store });

    assert.equal(cell({ store, table: ACTIVITY_MARKS_TABLE, id }), first);
    assert.deepEqual(second, mark('2026-09-18', 'food.logged'), 'the stored mark comes back, not the new one');
    assert.equal((await listLocalActivityMarks({ store })).length, 1);
  });

  it('keeps two signals on one day apart, because the id carries both halves', async () => {
    const store = createPrimaryStore();

    await putLocalActivityMark({ mark: mark('2026-09-18', 'food.logged'), store });
    await putLocalActivityMark({ mark: mark('2026-09-18', 'weight.logged'), store });

    assert.deepEqual(
      (await listLocalActivityMarks({ store })).map((entry) => entry.signal),
      ['food.logged', 'weight.logged'],
    );
  });
});

describe('a mark write and firstDataAt', () => {
  it('does NOT stamp firstDataAt, and the food log beside it DOES', async () => {
    const store = createPrimaryStore();

    await putLocalActivityMark({ mark: mark('2026-09-18', 'food.logged'), store });
    await putLocalAward({ award: award('streak.active.3'), store });

    assert.equal(await getFirstDataAt({ store }), null, 'a mark is not data of the kind this marker records');
    assert.equal(await hasEverHadData({ store }), false);
    assert.equal(await hasAnyLocalData({ store }), false);

    // THE CONTROL. Without it, every assertion above would pass against a store
    // whose marker never worked at all.
    await putLocalFoodLog(foodLog('log-1'), { store });

    assert.notEqual(await getFirstDataAt({ store }), null);
    assert.equal(await hasEverHadData({ store }), true);
    assert.equal(await hasAnyLocalData({ store }), true);
  });
});

describe('putLocalAward', () => {
  it('is WRITE-ONCE by key, so a re-earn never resets a stamp the person already has', async () => {
    const store = createPrimaryStore();
    await putLocalAward({ award: award('streak.active.3', { seenAt: NOW + 5 }), store });
    const first = cell({ store, table: AWARDS_TABLE, id: 'streak.active.3' });

    const again = await putLocalAward({ award: award('streak.active.3'), store });

    assert.equal(cell({ store, table: AWARDS_TABLE, id: 'streak.active.3' }), first);
    assert.equal(again.seenAt, NOW + 5, 'an unseen re-earn must not make the note fire a second time');
  });

  it('holds an award key this build does not know, and lists oldest earned first', async () => {
    const store = createPrimaryStore();

    await putLocalAward({ award: award('streak.active.365', { earnedAt: NOW + 10 }), store });
    await putLocalAward({ award: award('explorer.food.logged', { earnedAt: NOW }), store });

    assert.deepEqual(
      (await listLocalAwards({ store })).map((entry) => entry.key),
      ['explorer.food.logged', 'streak.active.365'],
    );
  });
});

describe('markAwardSeen', () => {
  it('stamps an unseen award, and is the only verb that changes one', async () => {
    const store = createPrimaryStore();
    await putLocalAward({ award: award('streak.active.7'), store });

    const seen = await markAwardSeen({ key: 'streak.active.7', seenAt: NOW + 1, store });

    assert.equal(seen?.seenAt, NOW + 1);
    assert.deepEqual((await listLocalAwards({ store })).map((entry) => entry.seenAt), [NOW + 1]);
  });

  it('leaves an already seen award alone, and answers null for a key nobody holds', async () => {
    const store = createPrimaryStore();
    await putLocalAward({ award: award('streak.active.7', { seenAt: NOW + 1 }), store });
    const first = cell({ store, table: AWARDS_TABLE, id: 'streak.active.7' });

    const again = await markAwardSeen({ key: 'streak.active.7', seenAt: NOW + 900, store });
    const missing = await markAwardSeen({ key: 'never.earned', seenAt: NOW + 900, store });

    assert.equal(again?.seenAt, NOW + 1);
    assert.equal(cell({ store, table: AWARDS_TABLE, id: 'streak.active.7' }), first);
    assert.equal(missing, null);
    assert.equal(store.hasRow(AWARDS_TABLE, 'never.earned'), false, 'a stamp must never mint the award itself');
  });
});
