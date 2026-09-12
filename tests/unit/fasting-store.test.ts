/**
 * Unit tests for the fasting CRUD in `app/lib/local-store/primary-store`,
 * driven against a REAL in-memory TinyBase store (no IndexedDB persister) ,
 * the harness `local-store-primary-retention.test.ts` established.
 *
 * The invariant this file exists to pin is the one the UI cannot enforce: AT
 * MOST ONE non-ended fast. `createLocalFast` REJECTS a second one rather than
 * auto-ending the first, because silently stamping an `endedAt` on somebody's
 * running fast writes a duration they never declared into their own history.
 * `putLocalFast` stays unguarded for exactly one caller, the backup restore,
 * which must reproduce the file rather than adjudicate it.
 *
 * It also extends the M117/01 no-eviction invariant to the new table: a write
 * to `fasts` must never delete another row anywhere in the primary store.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimaryStore } from '../../app/lib/local-store/store';
import {
  createLocalFast,
  deleteLocalFast,
  endLocalFast,
  FastConflictError,
  FastNoteTooLongError,
  findOpenLocalFast,
  getLocalFast,
  getLocalFastingSettings,
  listLocalFasts,
  listLocalFoodLogs,
  peekLocalFastingSettings,
  putLocalFast,
  putLocalFastingSettings,
  putLocalFastingSettingsRecord,
  putLocalFoodLog,
  setLocalFastPlannedStart,
  setLocalFastReflection,
  setLocalFastStart,
} from '../../app/lib/local-store/primary-store';
import { FAST_NOTE_MAX_LENGTH } from '../../app/models/fasting';
import type { LocalFast } from '../../app/lib/local-store/schema';

const HOUR = 3_600_000;
const T = Date.parse('2026-08-06T20:00:00Z');
const SIXTEEN = 16 * HOUR;

/** A stored row, written through the UNGUARDED put (the restore path). */
function row(overrides: Partial<LocalFast> = {}): LocalFast {
  return {
    id: 'fast-1',
    protocolId: '16:8',
    targetDurationMs: SIXTEEN,
    plannedStartAt: null,
    startedAt: T,
    endedAt: null,
    createdAt: T,
    ...overrides,
  };
}

/** The start-now input shape `createLocalFast` takes. */
function startNowInput(startedAt = T) {
  return { protocolId: '16:8' as const, targetDurationMs: SIXTEEN, plannedStartAt: null, startedAt };
}

describe('createLocalFast', () => {
  it('mints an id and a createdAt, and the row round-trips through getLocalFast', async () => {
    const store = createPrimaryStore();
    const created = await createLocalFast(startNowInput(), { store });

    assert.ok(created.id.length > 0, 'a fast must get a client-generated id');
    assert.ok(created.createdAt > 0, 'a fast must be stamped with its creation instant');
    assert.equal(created.endedAt, null);
    assert.deepEqual(await getLocalFast(created.id, { store }), created);
  });

  it('refuses a second fast while one is SCHEDULED', async () => {
    const store = createPrimaryStore();
    await createLocalFast(
      { protocolId: '16:8', targetDurationMs: SIXTEEN, plannedStartAt: T + 3 * HOUR, startedAt: null },
      { store },
    );

    await assert.rejects(() => createLocalFast(startNowInput(), { store }), FastConflictError);
    assert.equal((await listLocalFasts({ store })).length, 1, 'the rejected create must write nothing');
  });

  it('refuses a second fast while one is ACTIVE', async () => {
    const store = createPrimaryStore();
    await createLocalFast(startNowInput(), { store });

    await assert.rejects(() => createLocalFast(startNowInput(T + HOUR), { store }), FastConflictError);
  });

  it('allows a new fast once the open one has ended, the guard is "non-ended", not "ever existed"', async () => {
    const store = createPrimaryStore();
    const first = await createLocalFast(startNowInput(), { store });
    await endLocalFast(first.id, { endedAt: T + SIXTEEN }, { store });

    const second = await createLocalFast(startNowInput(T + 20 * HOUR), { store });

    assert.notEqual(second.id, first.id);
    assert.equal((await listLocalFasts({ store })).length, 2);
  });
});

describe('putLocalFast (unguarded, the restore path)', () => {
  it('writes a second OPEN row without throwing', async () => {
    // A restore must reproduce the file. `selectCurrentFast` then picks the
    // latest effective start and the loser shows in history as "Still open".
    const store = createPrimaryStore();
    await putLocalFast(row({ id: 'restored-a', startedAt: T }), { store });
    await putLocalFast(row({ id: 'restored-b', startedAt: T + HOUR, createdAt: T + HOUR }), { store });

    assert.equal((await listLocalFasts({ store })).length, 2);
  });
});

describe('findOpenLocalFast', () => {
  it('returns null when every fast has ended', async () => {
    const store = createPrimaryStore();
    await putLocalFast(row({ id: 'done', endedAt: T + SIXTEEN }), { store });

    assert.equal(await findOpenLocalFast({ store }), null);
  });

  it('agrees with selectCurrentFast on two open rows, the latest effective start wins', async () => {
    const store = createPrimaryStore();
    await putLocalFast(row({ id: 'earlier', startedAt: T - 5 * HOUR, createdAt: T - 5 * HOUR }), { store });
    await putLocalFast(row({ id: 'later', startedAt: T }), { store });

    assert.equal((await findOpenLocalFast({ store }))?.id, 'later');
  });
});

describe('endLocalFast', () => {
  it('stamps endedAt and leaves every other field untouched', async () => {
    const store = createPrimaryStore();
    const created = await createLocalFast(startNowInput(), { store });

    const ended = await endLocalFast(created.id, { endedAt: T + 9 * HOUR }, { store });

    assert.deepEqual(ended, { ...created, endedAt: T + 9 * HOUR });
    assert.deepEqual(await getLocalFast(created.id, { store }), ended);
  });

  it('throws on an already-ended fast, a double end is a bug, not a no-op', async () => {
    // Swallowing it would make a duplicated submit look successful while
    // discarding the second end instant.
    const store = createPrimaryStore();
    const created = await createLocalFast(startNowInput(), { store });
    await endLocalFast(created.id, { endedAt: T + HOUR }, { store });

    await assert.rejects(() => endLocalFast(created.id, { endedAt: T + 2 * HOUR }, { store }), /already ended/);
  });

  it('throws on a fast that does not exist', async () => {
    const store = createPrimaryStore();
    await assert.rejects(() => endLocalFast('nope', { endedAt: T }, { store }), /No fast with id/);
  });
});

describe('ending a fast with a reflection', () => {
  it('writes the mood and the note alongside endedAt', async () => {
    const store = createPrimaryStore();
    const created = await createLocalFast(startNowInput(), { store });

    const ended = await endLocalFast(
      created.id,
      { endedAt: T + 16 * HOUR, mood: 'good', note: 'Easier than last time.' },
      { store },
    );

    assert.equal(ended.mood, 'good');
    assert.equal(ended.note, 'Easier than last time.');
    assert.deepEqual(await getLocalFast(created.id, { store }), ended);
  });

  it('leaves both absent when neither is given, silence is not an answer', async () => {
    const store = createPrimaryStore();
    const created = await createLocalFast(startNowInput(), { store });

    const ended = await endLocalFast(created.id, { endedAt: T + 16 * HOUR }, { store });

    assert.equal(ended.mood, undefined);
    assert.equal(ended.note, undefined);
  });

  it('accepts a note of exactly the ceiling', async () => {
    // The control case for the rejection below: without it, a bug that
    // refused every note would pass the next test and look like the rule.
    const store = createPrimaryStore();
    const created = await createLocalFast(startNowInput(), { store });

    const ended = await endLocalFast(
      created.id,
      { endedAt: T + 16 * HOUR, note: 'x'.repeat(FAST_NOTE_MAX_LENGTH) },
      { store },
    );

    assert.equal(ended.note?.length, FAST_NOTE_MAX_LENGTH);
  });

  it('REJECTS a note one character over the ceiling, and the fast is left running', async () => {
    // Rejection, not truncation: cutting somebody's own sentence in half and
    // storing the stump loses words they cannot see were lost. And the guard
    // runs BEFORE the write, so a refused end must not have ended anything.
    const store = createPrimaryStore();
    const created = await createLocalFast(startNowInput(), { store });

    await assert.rejects(
      () =>
        endLocalFast(created.id, { endedAt: T + 16 * HOUR, note: 'x'.repeat(FAST_NOTE_MAX_LENGTH + 1) }, { store }),
      FastNoteTooLongError,
    );

    assert.equal((await getLocalFast(created.id, { store }))?.endedAt, null, 'a refused end must not end the fast');
  });
});

describe('setLocalFastReflection', () => {
  it('records a mood and a note on a fast that has already ended', async () => {
    const store = createPrimaryStore();
    await putLocalFast(row({ id: 'over', endedAt: T + SIXTEEN }), { store });

    const reflected = await setLocalFastReflection('over', { mood: 'rough', note: 'Long afternoon.' }, { store });

    assert.equal(reflected.mood, 'rough');
    assert.equal(reflected.note, 'Long afternoon.');
    assert.equal(reflected.endedAt, T + SIXTEEN, 'editing a reflection must not touch the timestamps');
  });

  it('leaves an untouched field alone, and clears one passed as null', async () => {
    const store = createPrimaryStore();
    await putLocalFast(row({ id: 'over', endedAt: T + SIXTEEN, mood: 'good', note: 'First draft.' }), { store });

    const edited = await setLocalFastReflection('over', { note: 'Second draft.' }, { store });
    assert.equal(edited.mood, 'good', 'an absent field must not erase a recorded mood');
    assert.equal(edited.note, 'Second draft.');

    const cleared = await setLocalFastReflection('over', { mood: null }, { store });
    assert.equal(cleared.mood, null, 'an explicit null takes the answer back');
    assert.equal(cleared.note, 'Second draft.');
  });

  it('rejects a note over the ceiling here too, through the same guard', async () => {
    const store = createPrimaryStore();
    await putLocalFast(row({ id: 'over', endedAt: T + SIXTEEN, note: 'kept' }), { store });

    await assert.rejects(
      () => setLocalFastReflection('over', { note: 'x'.repeat(FAST_NOTE_MAX_LENGTH + 1) }, { store }),
      FastNoteTooLongError,
    );

    assert.equal((await getLocalFast('over', { store }))?.note, 'kept', 'a refused edit must write nothing');
  });

  it('throws on a fast that does not exist', async () => {
    const store = createPrimaryStore();
    await assert.rejects(() => setLocalFastReflection('nope', { mood: 'ok' }, { store }), /No fast with id/);
  });
});

describe('the fasting settings record', () => {
  it('reads as fully unset on a device that has never written one', async () => {
    const store = createPrimaryStore();

    assert.deepEqual(await getLocalFastingSettings({ store }), {
      routineProtocolId: null,
      routineStartMinute: null,
      routineCustomHours: null,
      extendedAcknowledgedAt: null,
      updatedAt: 0,
    });
    // And the row itself is genuinely absent, which is the distinction the
    // backup and the sync merge need: an exported record of nulls would
    // compete with a peer's real routine as though it were an answer.
    assert.equal(await peekLocalFastingSettings({ store }), null);
  });

  it('MERGES a patch rather than replacing the record, and stamps updatedAt', async () => {
    const store = createPrimaryStore();

    const first = await putLocalFastingSettings({ routineProtocolId: '18:6', routineStartMinute: 1_200 }, { store });
    assert.equal(first.routineProtocolId, '18:6');
    assert.ok(first.updatedAt > 0, 'a write must stamp the record');

    const second = await putLocalFastingSettings({ routineStartMinute: 1_260 }, { store });
    assert.equal(second.routineStartMinute, 1_260);
    assert.equal(second.routineProtocolId, '18:6', 'an untouched field must survive the patch');
    assert.ok(second.updatedAt >= first.updatedAt);
  });

  it('clears a field passed as null, the same undefined-versus-null rule the profile row uses', async () => {
    const store = createPrimaryStore();
    await putLocalFastingSettings({ routineProtocolId: 'custom', routineCustomHours: 30 }, { store });

    const cleared = await putLocalFastingSettings({ routineProtocolId: null, routineCustomHours: null }, { store });

    assert.equal(cleared.routineProtocolId, null);
    assert.equal(cleared.routineCustomHours, null);
  });

  it('persists extendedAcknowledgedAt across later, unrelated writes, it is asked once per person', async () => {
    const store = createPrimaryStore();
    await putLocalFastingSettings({ extendedAcknowledgedAt: T }, { store });

    await putLocalFastingSettings({ routineProtocolId: '48h' }, { store });

    const settings = await getLocalFastingSettings({ store });
    assert.equal(settings.extendedAcknowledgedAt, T, 'the care sheet must not be re-asked by an unrelated edit');
    assert.equal(settings.routineProtocolId, '48h');
  });

  it('writes the record WHOLE on the restore path, keeping the stored updatedAt', async () => {
    // `putLocalFastingSettings` would re-stamp, which would make every restore
    // look like this device's freshest edit and push it over a peer's newer one.
    const store = createPrimaryStore();

    await putLocalFastingSettingsRecord(
      {
        routineProtocolId: '16:8',
        routineStartMinute: 1_200,
        routineCustomHours: null,
        extendedAcknowledgedAt: null,
        updatedAt: T,
      },
      { store },
    );

    assert.equal((await getLocalFastingSettings({ store })).updatedAt, T);
  });
});

describe('setLocalFastStart', () => {
  it('writes startedAt AND clears plannedStartAt, one fact, one source', async () => {
    const store = createPrimaryStore();
    const created = await createLocalFast(
      { protocolId: '16:8', targetDurationMs: SIXTEEN, plannedStartAt: T + 3 * HOUR, startedAt: null },
      { store },
    );

    const adjusted = await setLocalFastStart(created.id, { startedAt: T + 2 * HOUR }, { store });

    assert.equal(adjusted.startedAt, T + 2 * HOUR);
    assert.equal(adjusted.plannedStartAt, null, 'the spent plan must not linger as a second source of truth');
  });
});

describe('setLocalFastPlannedStart', () => {
  it('moves a scheduled fast', async () => {
    const store = createPrimaryStore();
    const created = await createLocalFast(
      { protocolId: '16:8', targetDurationMs: SIXTEEN, plannedStartAt: T + 3 * HOUR, startedAt: null },
      { store },
    );

    const moved = await setLocalFastPlannedStart(created.id, { plannedStartAt: T + 5 * HOUR }, { store });

    assert.equal(moved.plannedStartAt, T + 5 * HOUR);
    assert.equal(moved.startedAt, null);
  });

  it('throws on a fast that has already started, and on an ended one', async () => {
    const store = createPrimaryStore();
    await putLocalFast(row({ id: 'running', startedAt: T }), { store });
    await putLocalFast(row({ id: 'over', startedAt: T, endedAt: T + SIXTEEN }), { store });

    await assert.rejects(
      () => setLocalFastPlannedStart('running', { plannedStartAt: T + HOUR }, { store }),
      /already started/,
    );
    await assert.rejects(
      () => setLocalFastPlannedStart('over', { plannedStartAt: T + HOUR }, { store }),
      /already ended/,
    );
  });
});

describe('listing and deleting', () => {
  it('deletes exactly one row and leaves the others', async () => {
    const store = createPrimaryStore();
    await putLocalFast(row({ id: 'a', endedAt: T + HOUR }), { store });
    await putLocalFast(row({ id: 'b', endedAt: T + 2 * HOUR }), { store });

    await deleteLocalFast('a', { store });

    assert.deepEqual(
      (await listLocalFasts({ store })).map((fast) => fast.id),
      ['b'],
    );
  });

  it('lists oldest-first by createdAt then id, matching every other list function', async () => {
    const store = createPrimaryStore();
    await putLocalFast(row({ id: 'z-same', createdAt: T, endedAt: T + HOUR }), { store });
    await putLocalFast(row({ id: 'a-same', createdAt: T, endedAt: T + HOUR }), { store });
    await putLocalFast(row({ id: 'oldest', createdAt: T - HOUR, endedAt: T }), { store });

    assert.deepEqual(
      (await listLocalFasts({ store })).map((fast) => fast.id),
      ['oldest', 'a-same', 'z-same'],
    );
  });

  it('never evicts another row, the M117/01 invariant, extended to the new table', async () => {
    const store = createPrimaryStore();
    await putLocalFoodLog(
      {
        id: 'ancient-log',
        name: 'Acerola',
        quantityGrams: 50,
        macros: { carbs: 5.5, fiber: null, sugars: null, polyols: null, protein: 0.2, fat: 0.15, kcal: 16 },
        mealType: 'snack',
        source: 'manual',
        aiEstimated: false,
        curatedSource: null,
        foodId: null,
        dayKey: '2025-01-01',
        loggedAt: 1_000,
        createdAt: 1_000,
        logBatchId: null,
      },
      { store },
    );
    await putLocalFast(row({ id: 'keeper', endedAt: T + HOUR }), { store });

    for (let index = 0; index < 25; index += 1) {
      await putLocalFast(row({ id: `churn-${index}`, createdAt: T + index, endedAt: T + index + 1 }), { store });
    }

    assert.equal((await listLocalFoodLogs({ store })).length, 1, 'a fast write must not touch the food logs');
    assert.ok(
      (await listLocalFasts({ store })).some((fast) => fast.id === 'keeper'),
      'a fast write must not evict an older fast',
    );
  });
});
