/**
 * The v21 -> v22 forward migration for the pantry (M233/02), which is one line
 * in `backup.ts` and nothing else.
 *
 * What it protects: `snapshotSchema` is strict about REQUIRED keys, and
 * `pantryItems` is required. Without the `.default([])` every backup file any
 * device has ever written would stop importing, because none of them carries
 * the key. That failure is total and silent until somebody tries to restore.
 *
 * The control is the third test: an envelope carrying a MALFORMED pantry must
 * still be refused, or the default would be standing in for validation rather
 * than for absence.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { migrateEnvelopeForward, parseBackupEnvelope, serializeBackup } from '../../app/lib/local-store/backup';
import { SCHEMA_VERSION } from '../../app/lib/local-store/schema';
import type { UnvalidatedProviderJson } from '../../app/services/vision/schema';

/**
 * A JSON object as a device would have written one into an envelope.
 *
 * The same closed JSON value type the vision parser takes, rather than an open
 * dictionary of `unknown`: a backup payload IS JSON, it is just not validated
 * yet, and the schema under test is what validates it.
 */
type WireObject = Record<string, UnvalidatedProviderJson>;

/** A v21 payload: everything that version had, and no `pantryItems` key at all. */
function v21Payload() {
  return {
    foods: [],
    foodLogs: [],
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals: [],
    fastingSettings: null,
    shareIdentity: null,
    sharePeers: [],
    researchIdentity: null,
    studyEnrolments: [],
  };
}

/** A serialized envelope of any version, as a device would have written it. */
function envelopeJson(schemaVersion: number, data: WireObject): string {
  return JSON.stringify({ schemaVersion, exportedAt: '2026-09-17T08:00:00.000Z', data });
}

describe('a v21 backup envelope', () => {
  it('imports, and arrives with an EMPTY pantry', () => {
    const envelope = parseBackupEnvelope(envelopeJson(21, v21Payload()));

    const migrated = migrateEnvelopeForward(envelope);

    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(migrated.data.pantryItems, []);
  });

  it('is still refused when a DIFFERENT required key is missing, which is the control', () => {
    // Without this the test above would pass against a `snapshotSchema` that
    // had simply stopped checking anything: the default must stand in for an
    // absent pantry, not for a payload nobody validated.
    const { foods: _dropped, ...missingFoods } = v21Payload();

    assert.throws(() => migrateEnvelopeForward(parseBackupEnvelope(envelopeJson(21, missingFoods))), /migration failed/i);
  });

  it('is refused when it carries a pantry row with an unknown unit', () => {
    const badUnit = {
      ...v21Payload(),
      pantryItems: [
        {
          id: 'p1',
          name: 'Flour',
          amount: 2,
          unit: 'kg',
          category: 'grain',
          source: 'photo',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };

    assert.throws(() => migrateEnvelopeForward(parseBackupEnvelope(envelopeJson(21, badUnit))), /migration failed/i);
  });
});

describe('a current-version envelope', () => {
  it('round-trips a pantry row through serialize and parse without losing a field', () => {
    const item = {
      id: 'p1',
      name: 'Rolled oats',
      amount: 500,
      unit: 'g',
      category: 'grain',
      source: 'photo',
      createdAt: 10,
      updatedAt: 20,
    };
    const json = serializeBackup({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-09-17T08:00:00.000Z',
      // SAFETY: this literal is the current snapshot shape spelled out, and
      // `migrateEnvelopeForward` below validates it against the real schema,
      // so a drifted field fails this test rather than passing silently.
      data: { ...v21Payload(), pantryItems: [item] } as never,
    });

    const migrated = migrateEnvelopeForward(parseBackupEnvelope(json));

    assert.deepEqual(migrated.data.pantryItems, [item]);
  });
});
