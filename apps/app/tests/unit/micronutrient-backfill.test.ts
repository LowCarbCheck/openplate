/**
 * The micronutrient backfill on the device (2026-10-13): which entries
 * qualify, the ledger's stop rule, the compare-and-set write, the read-time
 * overlay, and the promise the whole design rests on, that the diary's own
 * rows are never written.
 *
 * Every claim has a control beside it that makes it fail.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Store } from 'tinybase';
import { createPrimaryStore } from '../../app/lib/local-store/store';
import { listLocalFoodLogs, putLocalFoodLog } from '../../app/lib/local-store/primary-store';
import { exportBackup } from '../../app/lib/local-store/backup';
import {
  FOOD_LOGS_TABLE,
  MICRONUTRIENT_BACKFILL_CELL,
  MICRONUTRIENT_BACKFILL_TABLE,
  type LocalFoodLog,
} from '../../app/lib/local-store/schema';
import {
  readMicronutrientBackfillCells,
  readMicronutrientBackfillLedger,
  recordMicronutrientBackfill,
} from '../../app/lib/local-store/micronutrient-backfill';
import {
  BACKFILL_BATCH_SIZE,
  MAX_BACKFILL_ATTEMPTS,
  hasPendingBackfill,
  lowCarbCheckSlugOf,
  nextLedgerEntry,
  selectSlugsToAsk,
  withBackfilledMicronutrients,
  type BackfillLedger,
  type BackfillLedgerEntry,
} from '../../app/lib/micronutrient-backfill';
import { runMicronutrientBackfill } from '../../app/lib/micronutrient-backfill-job';
import type { BackfillRequestResult } from '../../app/lib/micronutrient-backfill-client';
import type { SlugMicronutrientsOutcome } from '../../app/services/food-db/micronutrients-wire';
import { MINERAL_KEYS, VITAMIN_KEYS, type MicronutrientsPer100g } from '../../app/lib/micronutrients';

const DAY_KEY = '2026-09-01';
const NOW = Date.parse('2026-10-13T12:00:00Z');

/** A whole block as the route answers it: every key of the block, `null` where there is no figure. */
function fullBlock(keys: readonly string[], figures: Record<string, number>): Record<string, number | null> {
  return Object.fromEntries(keys.map((key) => [key, figures[key] ?? null]));
}

/** A block as the route would answer it. */
const BLOCK: MicronutrientsPer100g = {
  // SAFETY: built over `MINERAL_KEYS`, the key list `Minerals` is declared over, with `number | null` members.
  minerals: fullBlock(MINERAL_KEYS, { calcium: 56 }) as MicronutrientsPer100g['minerals'],
};

/** An old entry from a LowCarbCheck food, with no block; override any field. */
function log(id: string, overrides: Partial<LocalFoodLog> = {}): LocalFoodLog {
  return {
    id,
    name: id,
    quantityGrams: 100,
    macros: { carbs: 1, fiber: 0, sugars: 1, polyols: null, protein: 13, fat: 9, kcal: 137 },
    mealType: 'breakfast',
    source: 'manual',
    aiEstimated: false,
    curatedSource: `lowcarbcheck:${id}`,
    foodId: null,
    dayKey: DAY_KEY,
    loggedAt: Date.parse(`${DAY_KEY}T08:00:00Z`),
    createdAt: Date.parse(`${DAY_KEY}T08:00:00Z`),
    logBatchId: null,
    ...overrides,
  };
}

function ledgerOf(entries: Record<string, BackfillLedgerEntry>): BackfillLedger {
  return new Map(Object.entries(entries));
}

const FILLED: BackfillLedgerEntry = { status: 'filled', micronutrientsPer100g: BLOCK, settledAt: NOW };

describe('which entries qualify', () => {
  it('reads the slug from a lowcarbcheck source', () => {
    assert.equal(lowCarbCheckSlugOf('lowcarbcheck:huhnerei-roh'), 'huhnerei-roh');
  });

  it('control: no other source, no empty slug, no source at all', () => {
    assert.equal(lowCarbCheckSlugOf('usda:171287'), null);
    assert.equal(lowCarbCheckSlugOf('lowcarbcheck:'), null);
    assert.equal(lowCarbCheckSlugOf(null), null);
  });

  it('selects each unsettled slug once, sorted, and skips entries that have a block or no LCC source', () => {
    const logs = [
      log('b-food'),
      log('a-food'),
      log('a-food', { id: 'second-a' }),
      log('has-block', { micronutrientsPer100g: BLOCK }),
      log('ai', { curatedSource: null, aiEstimated: true }),
      log('typed', { curatedSource: null }),
    ];
    assert.deepEqual(selectSlugsToAsk({ logs, ledger: ledgerOf({}) }), ['a-food', 'b-food']);
  });

  it('never selects a settled slug, and selects a failing one until its third attempt', () => {
    const logs = ['filled', 'no-data', 'not-found', 'retry-2', 'retry-3'].map((id) => log(id));
    const ledger = ledgerOf({
      filled: FILLED,
      'no-data': { status: 'no-data', settledAt: NOW },
      'not-found': { status: 'not-found', settledAt: NOW },
      'retry-2': { status: 'retry', attempts: 2, lastAttemptAt: NOW },
      'retry-3': { status: 'retry', attempts: MAX_BACKFILL_ATTEMPTS, lastAttemptAt: NOW },
    });
    assert.deepEqual(selectSlugsToAsk({ logs, ledger }), ['retry-2']);
  });
});

describe('what an answer leaves in the ledger', () => {
  const UNKNOWN: SlugMicronutrientsOutcome = { kind: 'unknown' };

  it('counts a failure as one attempt, up to the stop', () => {
    const first = nextLedgerEntry({ previous: undefined, outcome: UNKNOWN, now: NOW });
    const second = nextLedgerEntry({ previous: first, outcome: UNKNOWN, now: NOW });
    const third = nextLedgerEntry({ previous: second, outcome: UNKNOWN, now: NOW });
    assert.deepEqual(
      [first, second, third].map((entry) => (entry.status === 'retry' ? entry.attempts : entry.status)),
      [1, 2, 3],
    );
  });

  it('settles on a real answer after failures', () => {
    const retry: BackfillLedgerEntry = { status: 'retry', attempts: 2, lastAttemptAt: NOW };
    assert.equal(nextLedgerEntry({ previous: retry, outcome: { kind: 'not-found' }, now: NOW }).status, 'not-found');
  });

  it('never downgrades a settled row, whatever arrives late', () => {
    assert.equal(nextLedgerEntry({ previous: FILLED, outcome: UNKNOWN, now: NOW }), FILLED);
    assert.equal(nextLedgerEntry({ previous: FILLED, outcome: { kind: 'no-data' }, now: NOW }), FILLED);
  });
});

describe('the read-time overlay', () => {
  it('lends a filled block to every entry with that slug and no block', () => {
    const logs = [log('egg'), log('egg', { id: 'egg-2' })];
    const lent = withBackfilledMicronutrients({ logs, ledger: ledgerOf({ egg: FILLED }) });
    assert.deepEqual(
      lent.map((entry) => entry.micronutrientsPer100g),
      [BLOCK, BLOCK],
    );
  });

  it('control: no block for no-data, retry, another source, or an entry with its own block', () => {
    // SAFETY: built over `VITAMIN_KEYS`, the key list `Vitamins` is declared over, with `number | null` members.
    const own: MicronutrientsPer100g = {
      vitamins: fullBlock(VITAMIN_KEYS, { vitaminD: 1 }) as MicronutrientsPer100g['vitamins'],
    };
    const logs = [
      log('nodata'),
      log('retry'),
      log('ai', { curatedSource: null }),
      log('egg', { id: 'own', micronutrientsPer100g: own }),
    ];
    const ledger = ledgerOf({
      nodata: { status: 'no-data', settledAt: NOW },
      retry: { status: 'retry', attempts: 1, lastAttemptAt: NOW },
      ai: FILLED,
      egg: FILLED,
    });
    const lent = withBackfilledMicronutrients({ logs, ledger });
    assert.deepEqual(
      lent.map((entry) => entry.micronutrientsPer100g),
      [undefined, undefined, undefined, own],
    );
  });

  it('changes nothing else on the entry, and never mutates the input', () => {
    const entry = log('egg');
    const before = structuredClone(entry);
    const [lent] = withBackfilledMicronutrients({ logs: [entry], ledger: ledgerOf({ egg: FILLED }) });
    assert.deepEqual(entry, before);
    assert.deepEqual({ ...lent, micronutrientsPer100g: undefined }, { ...before, micronutrientsPer100g: undefined });
  });

  it('says a window is pending only while one of its slugs is unsettled', () => {
    const logs = [log('egg')];
    assert.equal(hasPendingBackfill({ logs, ledger: ledgerOf({}) }), true);
    assert.equal(hasPendingBackfill({ logs, ledger: ledgerOf({ egg: FILLED }) }), false);
    assert.equal(hasPendingBackfill({ logs: [log('ai', { curatedSource: null })], ledger: ledgerOf({}) }), false);
  });
});

describe('the compare-and-set ledger write', () => {
  const NEXT: BackfillLedgerEntry = { status: 'no-data', settledAt: NOW };

  it('writes a row that is still absent', async () => {
    const store = createPrimaryStore();
    const written = await recordMicronutrientBackfill({
      store,
      writes: [{ slug: 'egg', expectedCell: null, entry: NEXT }],
    });
    assert.deepEqual(written, ['egg']);
    assert.deepEqual((await readMicronutrientBackfillLedger({ store })).get('egg'), NEXT);
  });

  it('skips a row somebody else wrote since it was read, and keeps theirs', async () => {
    const store = createPrimaryStore();
    store.setRow(MICRONUTRIENT_BACKFILL_TABLE, 'egg', { [MICRONUTRIENT_BACKFILL_CELL]: JSON.stringify(FILLED) });
    const written = await recordMicronutrientBackfill({
      store,
      writes: [{ slug: 'egg', expectedCell: null, entry: NEXT }],
    });
    assert.deepEqual(written, []);
    assert.deepEqual((await readMicronutrientBackfillLedger({ store })).get('egg'), FILLED);
  });

  it('control: a row unchanged since it was read is replaced', async () => {
    const store = createPrimaryStore();
    store.setRow(MICRONUTRIENT_BACKFILL_TABLE, 'egg', { [MICRONUTRIENT_BACKFILL_CELL]: JSON.stringify(FILLED) });
    const expectedCell = (await readMicronutrientBackfillCells({ store })).get('egg') ?? null;
    const written = await recordMicronutrientBackfill({ store, writes: [{ slug: 'egg', expectedCell, entry: NEXT }] });
    assert.deepEqual(written, ['egg']);
  });

  it('reads a row that no longer parses as never asked, and lets the next answer replace it', async () => {
    const store = createPrimaryStore();
    store.setRow(MICRONUTRIENT_BACKFILL_TABLE, 'egg', { [MICRONUTRIENT_BACKFILL_CELL]: '{"status":"bogus"' });
    assert.equal((await readMicronutrientBackfillLedger({ store })).has('egg'), false);
    const expectedCell = (await readMicronutrientBackfillCells({ store })).get('egg') ?? null;
    assert.notEqual(expectedCell, null);
    assert.deepEqual(
      await recordMicronutrientBackfill({ store, writes: [{ slug: 'egg', expectedCell, entry: NEXT }] }),
      ['egg'],
    );
  });
});

/** A fake route, and every batch it was sent. */
interface FakeRoute {
  ask: (slugs: readonly string[]) => Promise<BackfillRequestResult>;
  batches: string[][];
}

/** A fake route: answers each slug by `answer`, and records every batch it was sent. */
function fakeAsk(answer: (slug: string) => SlugMicronutrientsOutcome): FakeRoute {
  const batches: string[][] = [];
  return {
    batches,
    ask: (slugs) => {
      batches.push([...slugs]);
      return Promise.resolve({ kind: 'answered', answers: slugs.map((slug) => ({ slug, outcome: answer(slug) })) });
    },
  };
}

async function storeWith(logs: readonly LocalFoodLog[]): Promise<Store> {
  const store = createPrimaryStore();
  for (const entry of logs) await putLocalFoodLog(entry, { store, origin: 'restore' });
  return store;
}

const now = (): number => NOW;

describe('the job', () => {
  it('asks each distinct slug once, in batches of 20', async () => {
    const store = await storeWith(
      Array.from({ length: 45 }, (_, index) => log(`food-${String(index).padStart(2, '0')}`)),
    );
    const { ask, batches } = fakeAsk(() => ({ kind: 'no-data' }));
    const report = await runMicronutrientBackfill({ ask, now, store });
    assert.deepEqual(
      batches.map((batch) => batch.length),
      [BACKFILL_BATCH_SIZE, BACKFILL_BATCH_SIZE, 5],
    );
    assert.equal(report.askedSlugs, 45);
  });

  it('never asks a settled slug again: a rerun over a settled history sends nothing', async () => {
    const store = await storeWith([log('filled'), log('nodata'), log('gone')]);
    const answers = new Map<string, SlugMicronutrientsOutcome>([
      ['filled', { kind: 'filled', micronutrientsPer100g: BLOCK }],
      ['nodata', { kind: 'no-data' }],
      ['gone', { kind: 'not-found' }],
    ]);
    await runMicronutrientBackfill({ ...fakeAsk((slug) => answers.get(slug) ?? { kind: 'unknown' }), now, store });
    const rerun = fakeAsk(() => ({ kind: 'unknown' }));
    await runMicronutrientBackfill({ ask: rerun.ask, now, store });
    assert.deepEqual(rerun.batches, []);
  });

  it('control: a slug that failed is asked again on the next run', async () => {
    const store = await storeWith([log('flaky')]);
    await runMicronutrientBackfill({ ...fakeAsk(() => ({ kind: 'unknown' })), now, store });
    const rerun = fakeAsk(() => ({ kind: 'unknown' }));
    await runMicronutrientBackfill({ ask: rerun.ask, now, store });
    assert.deepEqual(rerun.batches, [['flaky']]);
  });

  it('stops asking a slug after three failed attempts', async () => {
    const store = await storeWith([log('flaky')]);
    const runs: number[] = [];
    for (let run = 0; run < MAX_BACKFILL_ATTEMPTS + 2; run += 1) {
      const attempt = fakeAsk(() => ({ kind: 'unknown' }));
      await runMicronutrientBackfill({ ask: attempt.ask, now, store });
      runs.push(attempt.batches.length);
    }
    assert.deepEqual(runs, [1, 1, 1, 0, 0]);
  });

  it('counts nothing when the route does not answer, so the slug is still asked later', async () => {
    const store = await storeWith([log('egg')]);
    const report = await runMicronutrientBackfill({
      ask: () => Promise.resolve({ kind: 'stopped', reason: 'throttled' }),
      now,
      store,
    });
    assert.equal(report.stoppedBy, 'throttled');
    assert.equal((await readMicronutrientBackfillLedger({ store })).size, 0);
  });

  it('keeps an answer another tab settled while this one waited on the network', async () => {
    const store = await storeWith([log('egg')]);
    await runMicronutrientBackfill({
      ask: (slugs) => {
        store.setRow(MICRONUTRIENT_BACKFILL_TABLE, 'egg', { [MICRONUTRIENT_BACKFILL_CELL]: JSON.stringify(FILLED) });
        return Promise.resolve({
          kind: 'answered',
          answers: slugs.map((slug) => ({ slug, outcome: { kind: 'unknown' } })),
        });
      },
      now,
      store,
    });
    assert.deepEqual((await readMicronutrientBackfillLedger({ store })).get('egg'), FILLED);
  });

  it('control: without the other tab, the failure is recorded', async () => {
    const store = await storeWith([log('egg')]);
    await runMicronutrientBackfill({ ...fakeAsk(() => ({ kind: 'unknown' })), now, store });
    assert.equal((await readMicronutrientBackfillLedger({ store })).get('egg')?.status, 'retry');
  });
});

describe('the diary is never written', () => {
  it('a run that fills every entry leaves every food log row byte-identical', async () => {
    const store = await storeWith([log('egg'), log('cheese'), log('ai', { curatedSource: null })]);
    const before = JSON.stringify(store.getTable(FOOD_LOGS_TABLE));
    let foodLogWrites = 0;
    store.addTableListener(FOOD_LOGS_TABLE, () => (foodLogWrites += 1));

    const report = await runMicronutrientBackfill({
      ...fakeAsk(() => ({ kind: 'filled', micronutrientsPer100g: BLOCK })),
      now,
      store,
    });

    assert.equal(report.writtenSlugs, 2, 'the ledger did change');
    assert.equal(foodLogWrites, 0);
    assert.equal(JSON.stringify(store.getTable(FOOD_LOGS_TABLE)), before);
    const stored = await listLocalFoodLogs({ store });
    assert.ok(stored.every((entry) => entry.micronutrientsPer100g === undefined));
    // ...and yet the screens read the block.
    const lent = withBackfilledMicronutrients({
      logs: stored,
      ledger: await readMicronutrientBackfillLedger({ store }),
    });
    assert.equal(lent.filter((entry) => entry.micronutrientsPer100g !== undefined).length, 2);
  });

  it('control: the listener does see a food log write', async () => {
    const store = await storeWith([]);
    let foodLogWrites = 0;
    store.addTableListener(FOOD_LOGS_TABLE, () => (foodLogWrites += 1));
    await putLocalFoodLog(log('egg'), { store, origin: 'restore' });
    assert.equal(foodLogWrites, 1);
  });
});

describe('the ledger never leaves the device', () => {
  it('is absent from the export sync and the backup both read', async () => {
    const store = await storeWith([log('egg-marker-food')]);
    await runMicronutrientBackfill({
      ...fakeAsk(() => ({ kind: 'filled', micronutrientsPer100g: BLOCK })),
      now,
      store,
    });
    assert.equal(store.getRowIds(MICRONUTRIENT_BACKFILL_TABLE).length, 1, 'the ledger holds the row');

    const exported = JSON.stringify(await exportBackup({ store, now: () => new Date(NOW) }));
    assert.equal(exported.includes(MICRONUTRIENT_BACKFILL_TABLE), false);
    assert.equal(exported.includes('settledAt'), false);
    // Control: the export does carry the entry itself, so a search that finds
    // nothing is not a search of an empty export.
    assert.equal(exported.includes('egg-marker-food'), true);
  });
});
