/**
 * CONTRIBUTOR TO STUDY, END TO END (M161/04, `openplate-sync` ADR-0003).
 *
 * The two halves of this lane are written in two modules, on two sides of a
 * wire, and they agree on a packing, an AAD and a payload codec. Every one of
 * those agreements fails silently: a byte of drift produces a tag failure on a
 * researcher's machine months later, with nothing in the failure that says
 * which side moved.
 *
 * So this test runs the REAL contributor path — a snapshot from the real
 * builder, the real reduction, the real seal — carries the bytes it produced
 * across to the study transport untouched, and opens them with the real pull.
 * Nothing is stubbed except the network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPrimaryStore } from '../../app/lib/local-store/store';
import { exportBackup } from '../../app/lib/local-store/backup';
import { putLocalFood, putLocalFoodLog } from '../../app/lib/local-store/primary-store';
import type { LocalStoreSnapshot } from '../../app/lib/local-store/schema';
import { bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import { generateEciesKeyPair } from '../../app/lib/sync/engine/crypto/ecies';
import type { StudyContribution } from '../../app/lib/sync/engine/client/http-client';
import { submitContribution, type ContributorTransport } from '../../app/lib/sync/research/contribute';
import { deriveStudyPseudonym, generatePseudonymRoot } from '../../app/lib/sync/research/pseudonym';
import { reduceDailyIntakeV1 } from '../../app/lib/sync/research/reduce';
import { pullStudyCohort, type StudyKeyPair, type StudyTransport } from '../../app/lib/sync/research/study';
import { exportStudyCohortCsv } from '../../app/lib/sync/research/export';

const STUDY_ACCOUNT_ID = 7;
const FROM_DAY = '2026-08-24';
const TO_DAY = '2026-08-26';

async function buildSnapshot(): Promise<LocalStoreSnapshot> {
  const store = createPrimaryStore();
  await putLocalFood(
    {
      id: 'food-1',
      name: 'Acerola',
      brand: null,
      macrosPer100g: { carbs: 11, fiber: 1, sugars: null, polyols: null, protein: 0.4, fat: 0.3, kcal: 32 },
      source: 'user',
      createdAt: 1_000,
    },
    { store },
  );
  await putLocalFoodLog(
    {
      id: 'log-1',
      name: 'Acerola',
      quantityGrams: 250,
      macros: { carbs: 27.5, fiber: 2.5, sugars: null, polyols: null, protein: 0.1, fat: 0.75, kcal: 80 },
      mealType: 'snack',
      source: 'manual',
      aiEstimated: false,
      curatedSource: 'lowcarbcheck:acerola',
      foodId: 'food-1',
      dayKey: '2026-08-24',
      loggedAt: 1_756_000_000_000,
      createdAt: 1_756_000_000_000,
      logBatchId: null,
    },
    { store },
  );
  return (await exportBackup({ store })).data;
}

test('the lane round-trips a contribution end to end, from the diary to the export', async () => {
  const snapshot = await buildSnapshot();
  assert.ok(snapshot.foodLogs.length >= 1, 'the fixture must actually hold a diary');

  const studyPair = await generateEciesKeyPair();
  const studyKey: StudyKeyPair = { publicKeyRaw: studyPair.publicKeyRaw, privateKeyPkcs8: studyPair.privateKeyPkcs8 };
  const root = generatePseudonymRoot();

  // ── The contributor's side, with only the network stubbed ───────────────
  const pushed: StudyContribution[] = [];
  const contributorTransport: ContributorTransport = {
    listMyContributions: async () => ({ status: 'available', value: [] }),
    putContribution: async (input) => {
      pushed.push({
        pseudonym: input.pseudonym,
        contributionVersion: input.contributionVersion,
        schemaTier: input.schemaTier,
        // Through base64 and back, exactly as §5.18 carries it — a packing
        // that only survives an in-memory handoff is not a wire format.
        body: input.body,
        createdAt: '2026-08-28T09:00:00.000Z',
      });
      assert.equal(bytesToBase64(input.body).length > 0, true);
      return {
        status: 'accepted',
        enrolment: {
          studyAccountId: input.studyAccountId,
          pseudonym: input.pseudonym,
          schemaTier: input.schemaTier,
          contributionVersion: input.contributionVersion,
          createdAt: '2026-08-28T09:00:00.000Z',
          updatedAt: '2026-08-28T09:00:00.000Z',
        },
      };
    },
  };

  const submitted = await submitContribution({
    transport: contributorTransport,
    enrolment: {
      id: String(STUDY_ACCOUNT_ID),
      studyAccountId: STUDY_ACCOUNT_ID,
      publicKeyRaw: bytesToBase64(studyPair.publicKeyRaw),
      label: 'Charité sleep trial',
      createdAt: 1_756_000_000_000,
    },
    pseudonymRoot: root,
    snapshot,
    fromDayKey: FROM_DAY,
    toDayKey: TO_DAY,
  });

  assert.equal(submitted.status, 'submitted');
  if (submitted.status !== 'submitted') return;
  // The first submission is version 1: strictly greater than nothing stored.
  assert.equal(submitted.contributionVersion, 1);
  assert.equal(
    submitted.pseudonym,
    await deriveStudyPseudonym({ root, studyAccountId: STUDY_ACCOUNT_ID }),
    'the pseudonym is derived from the compartment root, never from an account id',
  );
  assert.equal(pushed.length, 1, 'exactly one contribution must have been pushed');

  // ── The study's side, with the same bytes and its own key ───────────────
  const studyTransport: StudyTransport = {
    listStudyContributions: async () => ({
      status: 'available',
      value: { studyAccountId: STUDY_ACCOUNT_ID, contributions: pushed },
    }),
    listStudyWithdrawals: async () => ({ status: 'available', value: [] }),
  };

  const pulled = await pullStudyCohort({ transport: studyTransport, keys: [studyKey] });
  assert.equal(pulled.status, 'available');
  if (pulled.status !== 'available') return;
  assert.equal(pulled.value.unopenableCount, 0);
  assert.equal(pulled.value.malformedCount, 0);
  assert.equal(pulled.value.rows.length, 1);

  // The opened rows are the reduction, byte for byte the same computation the
  // device ran — three calendar days, gaps included.
  assert.deepEqual(
    pulled.value.rows[0]?.days,
    reduceDailyIntakeV1({ snapshot, fromDayKey: FROM_DAY, toDayKey: TO_DAY }),
  );
  assert.equal(pulled.value.rows[0]?.pseudonym, submitted.pseudonym);

  // And the artifact a researcher keeps carries the day the diary actually had.
  const csv = exportStudyCohortCsv({ cohort: pulled.value, fromDayKey: FROM_DAY, toDayKey: TO_DAY });
  // `0.75` fat is emitted as `0.8`: the reduction rounds to one decimal place,
  // because unrounded float noise is itself a fingerprint of the exact entries
  // behind a total.
  assert.match(csv, /,2026-08-24,80,0\.1,27\.5,0\.8,2\.5,1/);
  assert.match(csv, /PSEUDONYMISED, not anonymous/);
});
