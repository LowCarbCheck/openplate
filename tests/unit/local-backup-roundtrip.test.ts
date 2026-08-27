/**
 * Round-trip tests for the schema-versioned backup (`app/lib/local-store/backup`)
 * against a REAL in-memory TinyBase store (no IndexedDB persister). A device
 * export must re-import losslessly, the envelope must be schema-versioned, and a
 * malformed / newer-than-supported backup must be rejected rather than partly
 * imported. Photos are never part of the envelope (device-only).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimaryStore } from '../../app/lib/local-store/store';
import {
  exportBackup,
  importBackup,
  migrateEnvelopeForward,
  parseBackupEnvelope,
  restoreBackup,
  serializeBackup,
  type BackupEnvelope,
} from '../../app/lib/local-store/backup';
import {
  putLocalFast,
  putLocalFood,
  putLocalFoodLog,
  putLocalProfileGoals,
  putLocalSavedMeal,
  putLocalWeightEntry,
} from '../../app/lib/local-store/primary-store';
import { SCHEMA_VERSION } from '../../app/lib/local-store/schema';
import type { Store } from 'tinybase';

/** Seeds a store with one of every entity, including null macro/goal fields. */
async function seedStore(store: Store): Promise<void> {
  await putLocalFood(
    {
      id: 'food-1',
      name: 'Acerola',
      brand: null,
      macrosPer100g: { carbs: 11, fiber: 1, sugars: null, polyols: null, protein: 0.4, fat: 0.3, kcal: 32 },
      source: 'user',
      createdAt: 1_000,
      // M123/13 review finding 6: seeded here (and on the log below) for the
      // identical reason `portion`/`micronutrientsPer100g` are — zod STRIPS
      // unrecognized keys, so if `personalFoodSchema` ever lost its
      // `carbBasis` line the export -> import -> export cycle would quietly
      // return a food/log with no basis and every future read of it would
      // silently revert to the `total` fallback and double-subtract fibre.
      carbBasis: 'available',
    },
    { store },
  );

  await putLocalFoodLog(
    {
      id: 'log-1',
      name: 'Acerola',
      quantityGrams: 50,
      macros: { carbs: 5.5, fiber: null, sugars: null, polyols: null, protein: 0.2, fat: 0.15, kcal: 16 },
      mealType: 'snack',
      source: 'manual',
      aiEstimated: false,
      curatedSource: 'lowcarbcheck:acerola',
      foodId: 'food-1',
      dayKey: '2026-07-14',
      loggedAt: 2_000,
      createdAt: 2_000,
      logBatchId: null,
      // The person's own chosen unit ("half a cup"), not just the gram weight.
      // Seeded here on purpose so the "re-imports losslessly" test above is
      // actually discriminating about it: zod STRIPS unrecognized keys, so
      // while `foodLogSchema` omitted this field the export → import → export
      // cycle quietly returned an entry with no `portion` key at all and the
      // deep-equality assertion was the thing that would have caught it.
      portion: { unit: 'cup', quantity: 0.5, gramsPerUnit: 100 },
      // Same reason as `food-1.carbBasis` above, one field over.
      carbBasis: 'available',
      // The v9 micronutrient snapshot (M135), seeded for exactly the same
      // reason `portion` above is: zod STRIPS unrecognized keys, so if
      // `foodLogSchema` ever loses its `micronutrientsPer100g` line the export
      // -> import -> export cycle would quietly return an entry with no
      // vitamins or minerals and every day it appears in would silently read as
      // uncovered. Note the deliberate mix: a measured `0` (sodium), a `null`
      // (vitaminD — source consulted, no figure), and real values. All three
      // have to survive byte-for-byte.
      micronutrientsPer100g: {
        vitamins: {
          betaCarotene: 449,
          vitaminA: 42,
          vitaminC: 1677,
          vitaminD: null,
          vitaminE: 0.54,
          vitaminB1: 0.02,
          vitaminB2: 0.06,
          vitaminB6: 0.009,
          vitaminB9: 14,
          vitaminB12: null,
        },
        minerals: {
          nacl: null,
          potassium: 146,
          sodium: 0,
          calcium: 12,
          magnesium: 18,
          zinc: 0.1,
          phosphorus: 11,
          iron: 0.2,
        },
      },
    },
    { store },
  );

  await putLocalWeightEntry(
    {
      id: 'weight-1',
      dayKey: '2026-07-14',
      weightKg: 72.4,
      loggedAt: 3_000,
      createdAt: 3_000,
    },
    { store },
  );

  // A SCHEDULED fast — `plannedStartAt` set, `startedAt` and `endedAt` still
  // null. All three timestamp states in one row, so the lossless assertion
  // above is genuinely discriminating about them: zod STRIPS unrecognized keys,
  // and a `fastSchema` that forgot one would return a row that no longer says
  // when the fast was meant to begin.
  await putLocalFast(
    {
      id: 'fast-1',
      protocolId: '16:8',
      targetDurationMs: 16 * 60 * 60 * 1000,
      plannedStartAt: 9_000,
      startedAt: null,
      endedAt: null,
      createdAt: 7_000,
    },
    { store },
  );

  await putLocalProfileGoals(
    {
      timezone: 'Europe/Berlin',
      goalNetCarbsCeilingG: 30,
      goalProteinFloorG: null,
      goalKcalTarget: 2000,
      targetWeightKg: 68,
      trackingFocus: 'net-carbs',
      onboardingCompletedAt: 5_000,
      updatedAt: 4_000,
    },
    { store },
  );

  // M123/13 review finding 6: a POPULATED saved meal, not just the empty-array
  // shape every other test in this file exercises. `savedMealItemSchema`
  // strips unrecognized keys exactly like every other entity schema here, so
  // an empty-array-only fixture cannot catch a schema that lost a field —
  // including `carbBasis`, seeded on the item below for the same reason as
  // `food-1`/`log-1` above.
  await putLocalSavedMeal(
    {
      id: 'saved-meal-1',
      name: 'Sunday breakfast',
      items: [
        {
          name: 'Acerola',
          quantityGrams: 50,
          macros: { carbs: 5.5, fiber: null, sugars: null, polyols: null, protein: 0.2, fat: 0.15, kcal: 16 },
          source: 'manual',
          aiEstimated: false,
          curatedSource: 'lowcarbcheck:acerola',
          foodId: 'food-1',
          portion: { unit: 'cup', quantity: 0.5, gramsPerUnit: 100 },
          attribution: 'LowCarbCheck, CC BY 4.0',
          netCarbsPer100g: 4.5,
          carbBasis: 'available',
        },
      ],
      createdAt: 6_000,
    },
    { store },
  );
}

describe('backup round-trip', () => {
  it('re-imports a full export losslessly into a fresh store', async () => {
    const source = createPrimaryStore();
    await seedStore(source);
    const exported = await exportBackup({ store: source });

    // Serialize → parse → restore into a brand-new store, then export again.
    const json = serializeBackup(exported);
    const target = createPrimaryStore();
    await restoreBackup(json, { store: target });
    const reExported = await exportBackup({ store: target });

    assert.deepEqual(reExported.data, exported.data);
  });

  it('stamps the current schema version on every export', async () => {
    const store = createPrimaryStore();
    await seedStore(store);
    const exported = await exportBackup({ store });
    assert.equal(exported.schemaVersion, SCHEMA_VERSION);
  });

  it('preserves null macro and goal fields through the round-trip', async () => {
    const source = createPrimaryStore();
    await seedStore(source);
    const json = serializeBackup(await exportBackup({ store: source }));

    const target = createPrimaryStore();
    await restoreBackup(json, { store: target });
    const roundTripped = await exportBackup({ store: target });

    assert.equal(roundTripped.data.foods[0].macrosPer100g.sugars, null);
    assert.equal(roundTripped.data.foodLogs[0].macros.fiber, null);
    assert.equal(roundTripped.data.profile?.goalProteinFloorG, null);
  });

  it('preserves the chosen display portion through the round-trip — a backup must not silently demote "½ cup" to bare grams', async () => {
    const source = createPrimaryStore();
    await seedStore(source);
    const json = serializeBackup(await exportBackup({ store: source }));

    const target = createPrimaryStore();
    await restoreBackup(json, { store: target });
    const roundTripped = await exportBackup({ store: target });

    assert.deepEqual(
      roundTripped.data.foodLogs[0].portion,
      { unit: 'cup', quantity: 0.5, gramsPerUnit: 100 },
      'zod stripped `portion` on import — restoring a backup turns every unit-labelled entry back into bare grams',
    );
  });

  it('keeps a gram-only entry’s explicit null portion distinct from a stripped one', async () => {
    const source = createPrimaryStore();
    await putLocalFoodLog(
      {
        id: 'grams-only',
        name: 'Chicken breast',
        quantityGrams: 137,
        macros: { carbs: 0, fiber: null, sugars: null, polyols: null, protein: 42, fat: 5, kcal: 226 },
        mealType: 'dinner',
        source: 'manual',
        aiEstimated: false,
        curatedSource: null,
        foodId: null,
        dayKey: '2026-07-14',
        loggedAt: 6_000,
        createdAt: 6_000,
        logBatchId: null,
        portion: null,
      },
      { store: source },
    );
    const json = serializeBackup(await exportBackup({ store: source }));

    const target = createPrimaryStore();
    await restoreBackup(json, { store: target });
    const roundTripped = await exportBackup({ store: target });

    assert.equal(roundTripped.data.foodLogs[0].portion, null);
  });

  it('accepts a pre-v3 envelope whose entries have no portion key at all, with no migration step needed', () => {
    const envelope = {
      schemaVersion: 2,
      exportedAt: '2026-07-01T00:00:00.000Z',
      data: {
        foods: [],
        foodLogs: [
          {
            id: 'legacy-1',
            name: 'Acerola',
            quantityGrams: 50,
            macros: { carbs: 5.5, fiber: null, sugars: null, polyols: null, protein: 0.2, fat: 0.15, kcal: 16 },
            mealType: 'snack',
            source: 'manual',
            aiEstimated: false,
            curatedSource: null,
            foodId: null,
            dayKey: '2026-07-14',
            loggedAt: 2_000,
            createdAt: 2_000,
            logBatchId: null,
          },
        ],
        weightEntries: [],
        profile: null,
      },
    };
    // Stringified directly rather than via `serializeBackup`: this simulates a
    // file written by an OLDER build, so it deliberately is not a current
    // `BackupEnvelope`.
    const migrated = migrateEnvelopeForward(parseBackupEnvelope(JSON.stringify(envelope)));
    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    assert.equal(migrated.data.foodLogs[0]?.portion, undefined);
  });

  it('rejects a malformed portion like every other malformed field — an import is fail-fast, unlike the FORM path', () => {
    const envelope = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-07-28T00:00:00.000Z',
      data: {
        foods: [],
        foodLogs: [
          {
            id: 'bad-portion',
            name: 'Acerola',
            quantityGrams: 50,
            macros: { carbs: 5.5, fiber: null, sugars: null, polyols: null, protein: 0.2, fat: 0.15, kcal: 16 },
            mealType: 'snack',
            source: 'manual',
            aiEstimated: false,
            curatedSource: null,
            foodId: null,
            dayKey: '2026-07-14',
            loggedAt: 2_000,
            createdAt: 2_000,
            logBatchId: null,
            portion: { unit: 'not-a-unit', quantity: 0.5, gramsPerUnit: 100 },
          },
        ],
        weightEntries: [],
        profile: null,
      },
    };
    // DELIBERATE divergence from `#app/lib/portions`' `portionField`, which
    // fails OPEN and degrades a bad value to grams-only. That is right for a
    // FORM: refusing the submission would stop a person from logging their
    // food over a display label. It is wrong for a BACKUP FILE, which is a
    // whole-document artifact — this module's stated contract is that a bad
    // backup must never PARTLY import, and every other field here (`macros`,
    // `mealType`, `attribution`, `netCarbsPer100g`) already rejects. Silently
    // dropping the label instead would hand the user a "restore complete"
    // with data quietly missing, which is the exact failure this whole field
    // was added to close. Do not "align" the two — the contexts differ.
    assert.throws(
      () => migrateEnvelopeForward(parseBackupEnvelope(JSON.stringify(envelope))),
      /Backup migration failed/,
    );
  });

  it('an empty store exports an empty snapshot that re-imports to empty', async () => {
    const source = createPrimaryStore();
    const exported = await exportBackup({ store: source });
    assert.deepEqual(exported.data, {
      foods: [],
      foodLogs: [],
      weightEntries: [],
      profile: null,
      fasts: [],
      savedMeals: [],
      shareIdentity: null,
      sharePeers: [],
      researchIdentity: null,
      studyEnrolments: [],
    });

    const target = createPrimaryStore();
    await importBackup(exported, { store: target });
    const reExported = await exportBackup({ store: target });
    assert.deepEqual(reExported.data, exported.data);
  });

  it('migrates a current-version envelope forward as an identity', () => {
    const envelope: BackupEnvelope = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-07-15T00:00:00.000Z',
      data: {
        foods: [],
        foodLogs: [],
        weightEntries: [],
        profile: null,
        fasts: [],
        savedMeals: [],
        shareIdentity: null,
        sharePeers: [],
        researchIdentity: null,
        studyEnrolments: [],
      },
    };
    assert.deepEqual(migrateEnvelopeForward(envelope), envelope);
  });

  it('rejects a backup from a newer, unsupported schema version', () => {
    const envelope: BackupEnvelope = {
      schemaVersion: SCHEMA_VERSION + 1,
      exportedAt: '2026-07-15T00:00:00.000Z',
      data: {
        foods: [],
        foodLogs: [],
        weightEntries: [],
        profile: null,
        fasts: [],
        savedMeals: [],
        shareIdentity: null,
        sharePeers: [],
        researchIdentity: null,
        studyEnrolments: [],
      },
    };
    assert.throws(() => migrateEnvelopeForward(envelope), /newer than this app supports/);
  });

  it('preserves a fast through the round-trip, all three timestamp states intact', async () => {
    const source = createPrimaryStore();
    await seedStore(source);
    const json = serializeBackup(await exportBackup({ store: source }));

    const target = createPrimaryStore();
    await restoreBackup(json, { store: target });
    const roundTripped = await exportBackup({ store: target });

    assert.deepEqual(roundTripped.data.fasts, [
      {
        id: 'fast-1',
        protocolId: '16:8',
        targetDurationMs: 16 * 60 * 60 * 1000,
        plannedStartAt: 9_000,
        startedAt: null,
        endedAt: null,
        createdAt: 7_000,
      },
    ]);
  });

  it('rejects malformed backup JSON rather than importing partial data', () => {
    assert.throws(() => parseBackupEnvelope('{ not json'), /not valid JSON/);
    assert.throws(() => parseBackupEnvelope(JSON.stringify({ schemaVersion: 1 })), /Invalid backup file/);
  });
});

describe('parse-before-migrate ordering (review fix)', () => {
  // `parseBackupEnvelope` used to validate `data` against the FULL current
  // schema before `migrateEnvelopeForward` ever ran — which would reject a
  // genuinely older envelope's (different-shaped) payload before migration
  // got a chance to upgrade it. These fixtures exercise the wrapper-only
  // parse + post-migration validation ordering directly.

  it('parseBackupEnvelope accepts an older schemaVersion wrapper without validating the payload shape', () => {
    // A pre-v1-style wrapper missing the current schema's `profile` field —
    // this would have failed at PARSE time under the old combined schema.
    const legacyJson = JSON.stringify({
      schemaVersion: 0,
      exportedAt: '2026-01-01T00:00:00.000Z',
      data: { foods: [], foodLogs: [], weightEntries: [] },
    });

    const raw = parseBackupEnvelope(legacyJson);
    assert.equal(raw.schemaVersion, 0);
    assert.deepEqual(raw.data, { foods: [], foodLogs: [], weightEntries: [] });
  });

  it('migrateEnvelopeForward is reached with the raw payload — an unmigratable shape fails AFTER migration, not before', () => {
    const legacyJson = JSON.stringify({
      schemaVersion: 0,
      exportedAt: '2026-01-01T00:00:00.000Z',
      data: { foods: [], foodLogs: [], weightEntries: [] }, // still missing `profile`
    });

    // parseBackupEnvelope does NOT throw (proves the full-schema check no
    // longer runs before migration)...
    const raw = parseBackupEnvelope(legacyJson);

    // ...but migrateEnvelopeForward's final, post-migration validation
    // correctly rejects it, since no real v0→v1 transform exists yet to add
    // the missing `profile` field. This proves migration is genuinely
    // reached (not short-circuited), not that the shape gets a free pass.
    assert.throws(() => migrateEnvelopeForward(raw), /Backup migration failed/);
  });

  it('a version-0-style envelope with an already-current-shaped payload migrates forward to the current schema version (identity today)', () => {
    const legacyJson = JSON.stringify({
      schemaVersion: 0,
      exportedAt: '2026-01-01T00:00:00.000Z',
      data: { foods: [], foodLogs: [], weightEntries: [], profile: null },
    });

    const migrated = migrateEnvelopeForward(parseBackupEnvelope(legacyJson));

    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    // `fasts: []`/`savedMeals: []` are filled in by `snapshotSchema`'s two
    // `.default([])`s — the whole v6 -> v7 (M132) and v10 -> v11 (M123/07)
    // forward migrations, each in one line of schema.
    assert.deepEqual(migrated.data, {
      foods: [],
      foodLogs: [],
      weightEntries: [],
      profile: null,
      fasts: [],
      savedMeals: [],
      shareIdentity: null,
      sharePeers: [],
      researchIdentity: null,
      studyEnrolments: [],
    });
  });
});

describe('v1 -> v2 profile migration (M117/03: targetWeightKg/trackingFocus/onboardingCompletedAt)', () => {
  it('fills the three new profile fields with null on a v1 envelope with a non-null profile', () => {
    const v1Json = JSON.stringify({
      schemaVersion: 1,
      exportedAt: '2026-07-01T00:00:00.000Z',
      data: {
        foods: [],
        foodLogs: [],
        weightEntries: [],
        profile: {
          timezone: 'UTC',
          goalNetCarbsCeilingG: 20,
          goalProteinFloorG: null,
          goalKcalTarget: null,
          updatedAt: 1,
        },
      },
    });

    const migrated = migrateEnvelopeForward(parseBackupEnvelope(v1Json));

    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(migrated.data.profile, {
      timezone: 'UTC',
      goalNetCarbsCeilingG: 20,
      goalProteinFloorG: null,
      goalKcalTarget: null,
      targetWeightKg: null,
      trackingFocus: null,
      onboardingCompletedAt: null,
      updatedAt: 1,
    });
  });

  it('leaves a null v1 profile as null (nothing to fill)', () => {
    const v1Json = JSON.stringify({
      schemaVersion: 1,
      exportedAt: '2026-07-01T00:00:00.000Z',
      data: { foods: [], foodLogs: [], weightEntries: [], profile: null },
    });

    const migrated = migrateEnvelopeForward(parseBackupEnvelope(v1Json));
    assert.equal(migrated.data.profile, null);
  });

  it('a v2 envelope with the new fields already present migrates as an identity', () => {
    const envelope: BackupEnvelope = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-07-15T00:00:00.000Z',
      data: {
        foods: [],
        foodLogs: [],
        weightEntries: [],
        fasts: [],
        savedMeals: [],
        shareIdentity: null,
        sharePeers: [],
        researchIdentity: null,
        studyEnrolments: [],
        profile: {
          timezone: 'UTC',
          goalNetCarbsCeilingG: null,
          goalProteinFloorG: null,
          goalKcalTarget: null,
          targetWeightKg: 70,
          trackingFocus: 'habit',
          onboardingCompletedAt: 42,
          updatedAt: 1,
        },
      },
    };
    assert.deepEqual(migrateEnvelopeForward(envelope), envelope);
  });
});

describe('v6 -> v7 fasts migration (M132: the default IS the migration)', () => {
  it('imports a v6 envelope with no `fasts` key at all and fills it with an empty array', () => {
    // THE case this whole `.default([])` exists for: every backup file already
    // on every device predates fasting and simply has no `fasts` key. Without
    // the default, `snapshotSchema.safeParse` would reject all of them and the
    // v7 build would refuse to import anyone's existing backup.
    const v6Json = JSON.stringify({
      schemaVersion: 6,
      exportedAt: '2026-08-01T00:00:00.000Z',
      data: { foods: [], foodLogs: [], weightEntries: [], profile: null },
    });

    const migrated = migrateEnvelopeForward(parseBackupEnvelope(v6Json));

    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(migrated.data.fasts, []);
  });

  it('restores a v6 envelope into a store without disturbing anything else', async () => {
    const v6Json = JSON.stringify({
      schemaVersion: 6,
      exportedAt: '2026-08-01T00:00:00.000Z',
      data: { foods: [], foodLogs: [], weightEntries: [], profile: null },
    });

    const store = createPrimaryStore();
    const restored = await restoreBackup(v6Json, { store });

    assert.deepEqual(restored.data.fasts, []);
    assert.deepEqual((await exportBackup({ store })).data.fasts, []);
  });

  it('rejects a fast with a zero target duration rather than importing a ring with no denominator', () => {
    const envelope = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-08-06T00:00:00.000Z',
      data: {
        foods: [],
        foodLogs: [],
        weightEntries: [],
        profile: null,
        fasts: [
          {
            id: 'bad-target',
            protocolId: '16:8',
            targetDurationMs: 0,
            plannedStartAt: null,
            startedAt: 1_000,
            endedAt: null,
            createdAt: 1_000,
          },
        ],
      },
    };

    assert.throws(
      () => migrateEnvelopeForward(parseBackupEnvelope(JSON.stringify(envelope))),
      /Backup migration failed/,
    );
  });
});

describe('v8 -> v9 micronutrient snapshot (M135: an optional field, so the zod line IS the migration)', () => {
  const V8_LOG = {
    id: 'log-v8',
    name: 'Rye bread',
    quantityGrams: 60,
    macros: { carbs: 24, fiber: 4, sugars: null, polyols: null, protein: 3, fat: 0.6, kcal: 130 },
    mealType: 'breakfast',
    source: 'manual',
    aiEstimated: false,
    curatedSource: 'lowcarbcheck:rye-bread',
    foodId: null,
    dayKey: '2026-08-05',
    loggedAt: 4_000,
    createdAt: 4_000,
    logBatchId: null,
  };

  it('imports a v8 envelope whose logs have no `micronutrientsPer100g` key at all', () => {
    // Every backup file already on every device predates micronutrients. An
    // absent key is the CORRECT "we captured nothing" state, so this must
    // import cleanly with no migration step and no key invented for it.
    const v8Json = JSON.stringify({
      schemaVersion: 8,
      exportedAt: '2026-08-06T00:00:00.000Z',
      data: {
        foods: [],
        foodLogs: [V8_LOG],
        weightEntries: [],
        profile: null,
        fasts: [],
        savedMeals: [],
        shareIdentity: null,
        sharePeers: [],
        researchIdentity: null,
        studyEnrolments: [],
      },
    });

    const migrated = migrateEnvelopeForward(parseBackupEnvelope(v8Json));

    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    assert.equal(migrated.data.foodLogs.length, 1);
    // Absent, NOT filled with an empty object or a block of zeros: an entry
    // logged before this feature existed has no micronutrient dimension, and
    // the aggregation has to be able to count it as uncovered.
    assert.equal('micronutrientsPer100g' in migrated.data.foodLogs[0], false);
  });

  it('round-trips a v9 snapshot through the store, keeping a measured 0 and a null apart', async () => {
    const store = createPrimaryStore();
    await seedStore(store);
    const json = serializeBackup(await exportBackup({ store }));

    const target = createPrimaryStore();
    await restoreBackup(json, { store: target });
    const roundTripped = await exportBackup({ store: target });

    const log = roundTripped.data.foodLogs.find((entry) => entry.id === 'log-1');
    assert.ok(log);
    const micronutrients = log.micronutrientsPer100g;
    assert.ok(micronutrients);
    // A measured 0 is DATA and must come back as 0, not as null and not as a
    // dropped key — this is the assertion that would catch a `|| null`
    // creeping into the encode/parse path.
    assert.equal(micronutrients.minerals?.sodium, 0);
    // An upstream null is an unknown and must come back as null, not 0.
    assert.equal(micronutrients.vitamins?.vitaminD, null);
    assert.equal(micronutrients.vitamins?.vitaminC, 1677);
  });

  it('keeps an absent BLOCK absent rather than materializing it as all-null', () => {
    // "This origin has no mineral dimension" and "this food's mineral figures
    // are all unknown" are different facts about different futures; the import
    // path must not turn the first into the second.
    const envelope = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-08-06T00:00:00.000Z',
      data: {
        foods: [],
        foodLogs: [
          {
            ...V8_LOG,
            micronutrientsPer100g: {
              vitamins: {
                betaCarotene: null,
                vitaminA: null,
                vitaminC: 0.4,
                vitaminD: null,
                vitaminE: null,
                vitaminB1: null,
                vitaminB2: null,
                vitaminB6: null,
                vitaminB9: null,
                vitaminB12: null,
              },
            },
          },
        ],
        weightEntries: [],
        profile: null,
        fasts: [],
      },
    };

    const migrated = migrateEnvelopeForward(parseBackupEnvelope(JSON.stringify(envelope)));
    const stored = migrated.data.foodLogs[0].micronutrientsPer100g;

    assert.ok(stored);
    assert.equal(stored.minerals, undefined);
    assert.equal(stored.vitamins?.vitaminC, 0.4);
  });
});
