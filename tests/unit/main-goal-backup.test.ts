/**
 * Backup round trip for the profile's main goal, against a REAL in-memory
 * store.
 *
 * `profileGoalsSchema` strips every key it does not list, and the merged sync
 * snapshot goes through the same schema, so a missing line there would lose the
 * pick on every export and never let it reach a second device. That line is
 * what the first test guards. Its control is the one the brief asks for: delete
 * `mainGoal` from `profileGoalsSchema` in `app/lib/local-store/backup.ts` and
 * the round trip below comes back `undefined` instead of `'protein'`.
 *
 * Two more claims: a backup written before the field existed imports with the
 * pick unset (read as `null`), and a value from a build with a LONGER list
 * imports with the pick cleared rather than refusing the whole file.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimaryStore } from '../../app/lib/local-store/store';
import { exportBackup, migrateEnvelopeForward, restoreBackup, serializeBackup } from '../../app/lib/local-store/backup';
import { getLocalProfileGoals, putLocalProfileGoals } from '../../app/lib/local-store/primary-store';
import { SCHEMA_VERSION } from '../../app/lib/local-store/schema';
import type { LocalProfileGoals } from '../../app/lib/local-store/schema';

/** A profile as the store writes one, with every field this test does not care about unset. */
const PROFILE: LocalProfileGoals = {
  timezone: 'Europe/Berlin',
  goalNetCarbsCeilingG: 50,
  goalProteinFloorG: null,
  goalKcalTarget: null,
  targetWeightKg: null,
  trackingFocus: 'net-carbs',
  onboardingCompletedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  eatingStyle: 'low-carb',
};

/** Exports one store and restores the file into a fresh one, as a person moving devices would. */
async function roundTrip(profile: LocalProfileGoals): Promise<LocalProfileGoals | null> {
  const store = createPrimaryStore();
  await putLocalProfileGoals(profile, { store });
  const exported = await exportBackup({ store, now: () => new Date('2026-09-23T09:00:00.000Z') });
  const restored = createPrimaryStore();
  await restoreBackup(serializeBackup(exported), { store: restored });
  return getLocalProfileGoals({ store: restored });
}

describe('the main goal in a backup', () => {
  it('survives an export and a restore', async () => {
    const restored = await roundTrip({ ...PROFILE, mainGoal: 'protein' });
    assert.equal(restored?.mainGoal, 'protein');
    // Nothing beside it was disturbed.
    assert.equal(restored?.eatingStyle, 'low-carb');
    assert.equal(restored?.goalNetCarbsCeilingG, 50);
  });

  it('survives as null when the person cleared it', async () => {
    const restored = await roundTrip({ ...PROFILE, mainGoal: null });
    assert.equal(restored?.mainGoal, null);
  });

  it('imports as unset from a backup written before the field existed', () => {
    const migrated = migrateEnvelopeForward({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-09-22T10:00:00.000Z',
      data: { foods: [], foodLogs: [], weightEntries: [], fasts: [], profile: PROFILE },
    });
    const profile = migrated.data.profile;
    assert.notEqual(profile, null, 'the profile itself must import');
    assert.equal(profile?.mainGoal ?? null, null);
    // CONTROL: the profile really was read, so the null above is the absent
    // key and not a profile that silently failed to load.
    assert.equal(profile?.eatingStyle, 'low-carb');
  });

  it('clears a value from a longer list rather than refusing the file', () => {
    const migrated = migrateEnvelopeForward({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-09-22T10:00:00.000Z',
      data: { foods: [], foodLogs: [], weightEntries: [], fasts: [], profile: { ...PROFILE, mainGoal: 'fiber' } },
    });
    assert.equal(migrated.data.profile?.mainGoal, null);
    assert.equal(migrated.data.profile?.goalNetCarbsCeilingG, 50);
  });

  it('CONTROL: a different malformed profile field is still refused', () => {
    // Without this the leniency above could be standing in for a profile
    // schema that stopped validating anything.
    assert.throws(() =>
      migrateEnvelopeForward({
        schemaVersion: SCHEMA_VERSION,
        exportedAt: '2026-09-22T10:00:00.000Z',
        data: {
          foods: [],
          foodLogs: [],
          weightEntries: [],
          fasts: [],
          profile: { ...PROFILE, trackingFocus: 'protein' },
        },
      }),
    );
  });
});
