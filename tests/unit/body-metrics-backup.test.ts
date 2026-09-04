/**
 * Backup and store round-trip for the v8 body metrics (M135), against a REAL
 * in-memory TinyBase store.
 *
 * Three things have to hold, and each has burned a previous schema bump:
 *  1. A **v7 envelope** — taken before these fields existed — still imports.
 *     The v7 → v8 bump added only optional fields, so there is deliberately no
 *     `migrateProfileToV8`; this test is what proves that was the right call.
 *  2. A **v8 envelope round-trips losslessly**, including an explicitly cleared
 *     field. Zod strips unrecognized keys, so a missing line on
 *     `profileGoalsSchema` would silently empty someone's body metrics — and
 *     `reproductiveStatus` is the most sensitive datum in the file to lose
 *     without a word.
 *  3. A profile with **no body metrics** set behaves exactly as it always did.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimaryStore } from '../../app/lib/local-store/store';
import { exportBackup, migrateEnvelopeForward, restoreBackup, serializeBackup } from '../../app/lib/local-store/backup';
import {
  clearLocalBodyMetrics,
  getLocalBodyMetrics,
  getLocalProfileGoals,
  putLocalBodyMetrics,
  putLocalProfileGoals,
} from '../../app/lib/local-store/primary-store';
import { SCHEMA_VERSION } from '../../app/lib/local-store/schema';
import { EMPTY_BODY_METRICS } from '../../app/models/body-metrics';

/** The profile fields that existed before v8 — the shape a v7 backup carries. */
const V7_PROFILE = {
  timezone: 'Europe/Berlin',
  goalNetCarbsCeilingG: 50,
  goalProteinFloorG: 110,
  goalKcalTarget: null,
  targetWeightKg: 70,
  trackingFocus: 'net-carbs',
  onboardingCompletedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

describe('schema version', () => {
  // A deliberate pin, and it MOVES on every bump: body metrics landed at v8,
  // the micronutrient snapshot on the LOG at v9, the same snapshot on the
  // PERSONAL FOOD at v10, saved meals at v11, the carb-basis flag (spec 13)
  // at v12, clinician sharing at v13, the snapshot partition (M160/07) at
  // v14, research contributions (M161/03) at v15, the submitted research
  // window (M163/01) at v16, the gateway connection (M187/02) at v17, and its
  // REMOVAL (M192) at v18 — the first bump here that deletes an entity.
  // What it guards is that a bump is never silent —
  // the version the envelope stamps is the version an older build refuses, so
  // a change here has to be a change someone chose.
  it('is 18 — bumped past the v8 body-metrics bump by everything through the M192 gateway removal', () => {
    assert.equal(SCHEMA_VERSION, 18);
  });
});

describe('a v7 backup envelope', () => {
  it('migrates forward under v8 with every body metric simply unset', () => {
    const migrated = migrateEnvelopeForward({
      schemaVersion: 7,
      exportedAt: '2026-08-01T10:00:00.000Z',
      data: { foods: [], foodLogs: [], weightEntries: [], fasts: [], profile: V7_PROFILE },
    });

    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    const profile = migrated.data.profile;
    assert.notEqual(profile, null);
    // Absent, not null-filled — an absent key already means "never told us",
    // which is why no migration function was written for this bump.
    assert.equal(profile?.heightCm, undefined);
    assert.equal(profile?.birthYear, undefined);
    assert.equal(profile?.biologicalSex, undefined);
    assert.equal(profile?.reproductiveStatus, undefined);
    // Nothing else about the older envelope was disturbed.
    assert.equal(profile?.goalNetCarbsCeilingG, 50);
    assert.equal(profile?.trackingFocus, 'net-carbs');
  });

  it('restores into a store, and the metrics read back as fully unset', async () => {
    const store = createPrimaryStore();
    await restoreBackup(
      JSON.stringify({
        schemaVersion: 7,
        exportedAt: '2026-08-01T10:00:00.000Z',
        data: { foods: [], foodLogs: [], weightEntries: [], fasts: [], profile: V7_PROFILE },
      }),
      { store },
    );

    assert.deepEqual(await getLocalBodyMetrics({ store }), EMPTY_BODY_METRICS);
  });
});

describe('a v8 backup envelope', () => {
  it('round-trips every body metric, including a deliberately cleared one', async () => {
    const store = createPrimaryStore();
    await putLocalProfileGoals({ ...V7_PROFILE, trackingFocus: 'net-carbs' }, { store });
    await putLocalBodyMetrics(
      { heightCm: 165, birthYear: 1990, biologicalSex: 'female', reproductiveStatus: 'lactating' },
      { store },
    );

    const exported = await exportBackup({ store, now: () => new Date('2026-08-07T09:00:00.000Z') });
    assert.equal(exported.schemaVersion, SCHEMA_VERSION);

    const restored = createPrimaryStore();
    await restoreBackup(serializeBackup(exported), { store: restored });

    assert.deepEqual(await getLocalBodyMetrics({ store: restored }), {
      heightCm: 165,
      birthYear: 1990,
      biologicalSex: 'female',
      reproductiveStatus: 'lactating',
    });
  });

  it('round-trips a cleared metric as cleared, not as never-set-then-guessed', async () => {
    const store = createPrimaryStore();
    await putLocalBodyMetrics(
      { heightCm: 180, birthYear: null, biologicalSex: 'male', reproductiveStatus: null },
      { store },
    );

    const restored = createPrimaryStore();
    await restoreBackup(
      serializeBackup(await exportBackup({ store, now: () => new Date('2026-08-07T09:00:00.000Z') })),
      { store: restored },
    );

    const metrics = await getLocalBodyMetrics({ store: restored });
    assert.equal(metrics.heightCm, 180);
    assert.equal(metrics.birthYear, null);
    assert.equal(metrics.biologicalSex, 'male');
    assert.equal(metrics.reproductiveStatus, null);
  });
});

describe('a device with no body metrics', () => {
  it('exports and re-imports cleanly with body metrics unset throughout', async () => {
    const store = createPrimaryStore();
    await putLocalProfileGoals({ ...V7_PROFILE, trackingFocus: 'habit' }, { store });

    const restored = createPrimaryStore();
    await restoreBackup(
      serializeBackup(await exportBackup({ store, now: () => new Date('2026-08-07T09:00:00.000Z') })),
      { store: restored },
    );

    assert.deepEqual(await getLocalBodyMetrics({ store: restored }), EMPTY_BODY_METRICS);
    // The rest of the profile is untouched — the app works exactly as before.
    assert.equal((await getLocalProfileGoals({ store: restored }))?.goalProteinFloorG, 110);
  });

  it('reads as fully unset on a brand-new device that has no profile row at all', async () => {
    assert.deepEqual(await getLocalBodyMetrics({ store: createPrimaryStore() }), EMPTY_BODY_METRICS);
  });
});

describe('the store accessors', () => {
  it('never stores a pregnancy status without the sex it applies to', async () => {
    const store = createPrimaryStore();
    await putLocalBodyMetrics(
      { heightCm: null, birthYear: null, biologicalSex: 'male', reproductiveStatus: 'pregnant' },
      { store },
    );

    assert.equal((await getLocalBodyMetrics({ store })).reproductiveStatus, null);
  });

  it('clears every metric on request and leaves the rest of the profile alone', async () => {
    const store = createPrimaryStore();
    await putLocalProfileGoals({ ...V7_PROFILE, trackingFocus: 'net-carbs' }, { store });
    await putLocalBodyMetrics(
      { heightCm: 165, birthYear: 1990, biologicalSex: 'female', reproductiveStatus: 'pregnant' },
      { store },
    );

    await clearLocalBodyMetrics({ store });

    assert.deepEqual(await getLocalBodyMetrics({ store }), EMPTY_BODY_METRICS);
    assert.equal((await getLocalProfileGoals({ store }))?.goalNetCarbsCeilingG, 50);
  });
});
