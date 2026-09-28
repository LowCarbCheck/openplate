/**
 * The v22 -> v23 forward migration for the marks and the awards (M235/02), and
 * the round trip that proves an UNKNOWN award key survives it.
 *
 * What the migration protects: `snapshotSchema` is strict about REQUIRED keys,
 * and both `activityMarks` and `awards` are required. Without the two
 * `.default([])`s, every backup file any device has ever written would stop
 * importing, because none of them carries either key. That failure is total and
 * silent until somebody tries to restore.
 *
 * What the round trip protects is a different thing, and it is the reason this
 * file exists at all: `awardSchema.key` is `z.string()` and MUST STAY ONE. The
 * catalog grows every round, so a person who earns a badge on a newer build and
 * restores their file on an older one must get the row back untouched. With an
 * enum there, zod would reject the whole file. The test asserting that is
 * paired with its control, a malformed award that must STILL be refused, or the
 * widening would be standing in for the absence of validation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { migrateEnvelopeForward, parseBackupEnvelope, serializeBackup } from '../../app/lib/local-store/backup';
import { SCHEMA_VERSION } from '../../app/lib/local-store/schema';
import type { UnvalidatedProviderJson } from '../../app/services/vision/schema';

/**
 * A JSON object as a device would have written one into an envelope, the same
 * closed JSON value type the vision parser takes. A backup payload IS JSON, it
 * is just not validated yet, and the schema under test is what validates it.
 */
type WireObject = Record<string, UnvalidatedProviderJson>;

/** A v22 payload: everything that version had, and neither new key. */
function v22Payload() {
  return {
    foods: [],
    foodLogs: [],
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals: [],
    pantryItems: [],
    fastingSettings: null,
    shareIdentity: null,
    sharePeers: [],
    researchIdentity: null,
    studyEnrolments: [],
  };
}

/** A serialized envelope of any version, as a device would have written it. */
function envelopeJson(schemaVersion: number, data: WireObject): string {
  return JSON.stringify({ schemaVersion, exportedAt: '2026-09-18T08:00:00.000Z', data });
}

describe('a v22 backup envelope', () => {
  it('imports, and arrives with NO marks and NO awards', () => {
    const envelope = parseBackupEnvelope(envelopeJson(22, v22Payload()));

    const migrated = migrateEnvelopeForward(envelope);

    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(migrated.data.activityMarks, []);
    assert.deepEqual(migrated.data.awards, []);
  });

  it('is still refused when a DIFFERENT required key is missing, which is the control', () => {
    // Without this the test above would pass against a `snapshotSchema` that
    // had simply stopped checking anything: the two defaults must stand in for
    // absent tables, not for a payload nobody validated.
    const { foods: _dropped, ...missingFoods } = v22Payload();

    assert.throws(
      () => migrateEnvelopeForward(parseBackupEnvelope(envelopeJson(22, missingFoods))),
      /migration failed/i,
    );
  });
});

describe('a current-version envelope', () => {
  it('round-trips a mark and an award through serialize and parse without losing a field', () => {
    const mark = { id: '2026-09-18#food.logged', dayKey: '2026-09-18', signal: 'food.logged' };
    const award = { key: 'explorer.food.logged', earnedAt: 1_700_000_000_000, earnedOnDay: '2026-09-18', seenAt: null };
    const json = serializeBackup({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-09-18T08:00:00.000Z',
      // SAFETY: this literal is the current snapshot shape spelled out, and
      // `migrateEnvelopeForward` below validates it against the real schema, so
      // a drifted field fails this test rather than passing silently.
      data: { ...v22Payload(), activityMarks: [mark], awards: [award] } as never,
    });

    const migrated = migrateEnvelopeForward(parseBackupEnvelope(json));

    assert.deepEqual(migrated.data.activityMarks, [mark]);
    assert.deepEqual(migrated.data.awards, [award]);
  });

  it('keeps an unknown award key, and a signal this build has never heard of', () => {
    // THE CONTROL FOR THE WIDENING. This test is what would go red if somebody
    // tightened `awardSchema.key` or `activityMarkSchema.signal` into an enum
    // of the catalog this build ships: neither literal below is in it, and a
    // file written by a NEWER build is exactly where they come from. A stripped
    // row is a badge a person earned and lost by restoring their own backup.
    const futureMark = { id: '2027-01-01#recipe.cooked', dayKey: '2027-01-01', signal: 'recipe.cooked' };
    const futureAward = {
      key: 'streak.active.365',
      earnedAt: 1_800_000_000_000,
      earnedOnDay: '2027-01-01',
      seenAt: 1_800_000_001_000,
    };
    const json = serializeBackup({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-09-18T08:00:00.000Z',
      // SAFETY: as above, the real schema validates it one line down.
      data: { ...v22Payload(), activityMarks: [futureMark], awards: [futureAward] } as never,
    });

    const migrated = migrateEnvelopeForward(parseBackupEnvelope(json));

    assert.deepEqual(migrated.data.awards, [futureAward], 'an unknown award key must survive export and import');
    assert.deepEqual(migrated.data.activityMarks, [futureMark]);
  });

  it('is still refused when an award is MALFORMED, which is the control for the widening', () => {
    // `key: z.string()` accepting anything must not mean the row is unchecked.
    // `earnedAt` is a number and a string there is a broken file, not a newer
    // build, so this one has to throw while the test above passes.
    const badAward = {
      ...v22Payload(),
      awards: [{ key: 'streak.active.3', earnedAt: 'yesterday', earnedOnDay: '2026-09-18', seenAt: null }],
    };

    assert.throws(() => migrateEnvelopeForward(parseBackupEnvelope(envelopeJson(23, badAward))), /migration failed/i);
  });

  it('is still refused when a mark has no day key, the second half of that control', () => {
    const badMark = { ...v22Payload(), activityMarks: [{ id: 'x', signal: 'food.logged' }] };

    assert.throws(() => migrateEnvelopeForward(parseBackupEnvelope(envelopeJson(23, badMark))), /migration failed/i);
  });
});

/**
 * The other half of the v22 -> v23 step (M235/05). The defaults above make an
 * old file IMPORT; these make it arrive with the history it implies, so a
 * person restoring two years of diary onto a new phone reads two years rather
 * than a device that started today.
 */
/** One ordinary log, as a v22 device wrote it into a file. */
function wireFoodLog(id: string, dayKey: string) {
  return {
    id,
    name: 'Acerola',
    quantityGrams: 100,
    macros: { carbs: 5, fiber: 0, sugars: null, polyols: null, protein: 0.2, fat: 0.15, kcal: 16 },
    mealType: 'snack',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey,
    loggedAt: 1_789_000_000_000,
    createdAt: 1_789_000_000_000,
    logBatchId: null,
  } satisfies WireObject;
}

describe('a v22 envelope with a diary in it', () => {
  it('v22 envelope backfills the marks and the awards its own diary implies', () => {
    const days = ['2026-09-14', '2026-09-15', '2026-09-16'];
    const payload = { ...v22Payload(), foodLogs: days.map((day, index) => wireFoodLog(`log-${index}`, day)) };

    const migrated = migrateEnvelopeForward(parseBackupEnvelope(envelopeJson(22, payload)));

    assert.deepEqual(
      migrated.data.activityMarks.map((mark) => mark.dayKey),
      days,
      'a file with three logged days arrived with no history',
    );
    // Three consecutive days is the first streak badge, dated to the day it was
    // earned, and ALREADY SEEN: importing a backup must never announce a badge.
    assert.deepEqual(
      migrated.data.awards.map((award) => award.key),
      ['explorer.log.food', 'streak.active.3'],
    );
    for (const award of migrated.data.awards) {
      assert.equal(award.seenAt, award.earnedAt, `${award.key} would fire a note on the importing device`);
    }
    assert.deepEqual(
      migrated.data.awards.map((award) => award.earnedOnDay),
      ['2026-09-14', '2026-09-16'],
    );
  });

  it('is still left empty when the file has no diary at all, which is the control', () => {
    // The control for the test above: the backfill must derive, not invent. A
    // v22 file with nothing in it has no history, and a migration that handed
    // one a streak badge would be writing fiction.
    const migrated = migrateEnvelopeForward(parseBackupEnvelope(envelopeJson(22, v22Payload())));

    assert.deepEqual(migrated.data.activityMarks, []);
    assert.deepEqual(migrated.data.awards, []);
  });
});
