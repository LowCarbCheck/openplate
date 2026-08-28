/**
 * THE STUDY PULL (M161/04, `openplate-sync` ADR-0003 prohibition 8 and
 * `PROTOCOL.md` §5.18).
 *
 * Three claims, and each one is written so that the obvious wrong
 * implementation fails a NAMED assertion rather than sliding through:
 *
 *  1. **The pull is the purge.** A withdrawn pseudonym is absent AND a live
 *     one is present — the second half matters, because a filter that dropped
 *     everything would satisfy the first half perfectly.
 *  2. **A withdrawn row is never decrypted.** Asserted with a SPY on the
 *     opener, not by inspecting the result: purging after decryption produces
 *     an identical cohort and is still wrong, so a result-only test cannot
 *     tell the two apart.
 *  3. **A tag failure is a key statement.** Every held key is tried before a
 *     row is called un-openable, and a tag failure is never reported as
 *     `malformed` — AES-GCM does not say why it failed and no code here may
 *     pretend otherwise.
 *
 * Real crypto throughout: the fixtures are sealed by `sealContribution`, the
 * same function the contributor's device runs, so a change to the packing or
 * the AAD fails here rather than on a researcher's laptop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { StudyContribution, SurfaceRead } from '../../app/lib/sync/engine/client/http-client';
import { generateEciesKeyPair } from '../../app/lib/sync/engine/crypto/ecies';
import { sealContribution } from '../../app/lib/sync/research/contribution-wrap';
import { encodeDailyIntakeV1Payload } from '../../app/lib/sync/research/payload';
import { exportStudyCohortCsv } from '../../app/lib/sync/research/export';
import {
  pullStudyCohort,
  openCohortContribution,
  type StudyKeyPair,
  type StudyTransport,
} from '../../app/lib/sync/research/study';
import { DAILY_INTAKE_V1, type DailyIntakeV1Row } from '../../app/lib/sync/research/tiers';

const STUDY_ACCOUNT_ID = 7;
const LIVE_PSEUDONYM = '1YYFSZXRK6DTYM03TZ22VR1M9M';
const WITHDRAWN_PSEUDONYM = '0000000000000000000000000';

/** One day, distinctive enough that finding it in a cohort means something. */
function dayRows(energyKcal: number): DailyIntakeV1Row[] {
  return [{ date: '2026-08-24', energyKcal, proteinG: 0.3, carbsG: 41, fatG: 1, fiberG: 4, loggedEntryCount: 2 }];
}

async function seal({
  key,
  pseudonym,
  rows,
  contributionVersion = 1,
}: {
  key: StudyKeyPair;
  pseudonym: string;
  rows: DailyIntakeV1Row[];
  contributionVersion?: number;
}): Promise<StudyContribution> {
  const body = await sealContribution({
    payload: encodeDailyIntakeV1Payload(rows),
    studyPublicKeyRaw: key.publicKeyRaw,
    studyAccountId: STUDY_ACCOUNT_ID,
    pseudonym,
    contributionVersion,
    schemaTier: DAILY_INTAKE_V1,
  });
  return { pseudonym, contributionVersion, schemaTier: DAILY_INTAKE_V1, body, createdAt: '2026-08-28T09:00:00.000Z' };
}

function stubTransport({
  contributions,
  withdrawnPseudonyms = [],
}: {
  contributions: StudyContribution[];
  withdrawnPseudonyms?: string[];
}): StudyTransport {
  return {
    listStudyContributions: async (): Promise<
      SurfaceRead<{ studyAccountId: number; contributions: StudyContribution[] }>
    > => ({
      status: 'available',
      value: { studyAccountId: STUDY_ACCOUNT_ID, contributions },
    }),
    listStudyWithdrawals: async () => ({
      status: 'available',
      value: withdrawnPseudonyms.map((pseudonym) => ({ pseudonym, withdrawnAt: '2026-08-27T12:00:00.000Z' })),
    }),
  };
}

async function studyKey(): Promise<StudyKeyPair> {
  const pair = await generateEciesKeyPair();
  return { publicKeyRaw: pair.publicKeyRaw, privateKeyPkcs8: pair.privateKeyPkcs8 };
}

test('the pull purges withdrawn pseudonyms and keeps the live ones', async () => {
  const key = await studyKey();
  const transport = stubTransport({
    contributions: [
      await seal({ key, pseudonym: LIVE_PSEUDONYM, rows: dayRows(120) }),
      await seal({ key, pseudonym: WITHDRAWN_PSEUDONYM, rows: dayRows(999) }),
    ],
    withdrawnPseudonyms: [WITHDRAWN_PSEUDONYM],
  });

  const pulled = await pullStudyCohort({ transport, keys: [key] });
  assert.equal(pulled.status, 'available');
  if (pulled.status !== 'available') return;

  // ABSENT: the tombstone is honoured on this pull, mechanically.
  assert.ok(
    !pulled.value.rows.some((row) => row.pseudonym === WITHDRAWN_PSEUDONYM),
    'a withdrawn pseudonym must not survive the pull',
  );
  // PRESENT: and the purge did not simply empty the cohort — a filter that
  // dropped everything would pass the assertion above and fail this one.
  assert.deepEqual(
    pulled.value.rows.map((row) => row.pseudonym),
    [LIVE_PSEUDONYM],
    'the live pseudonym must still be in the cohort',
  );
  assert.deepEqual(pulled.value.rows[0]?.days, dayRows(120));
  // One tombstone, so one withdrawal — and the fixture is the ANOMALOUS shape
  // in which the server still returned the withdrawn row, which is what gives
  // the filter something to remove. The healthy shape is its own test below.
  assert.equal(pulled.value.withdrawnCount, 1);
  assert.equal(pulled.value.serverRetainedWithdrawnCount, 1);
  assert.equal(pulled.value.unopenableCount, 0);
  assert.equal(pulled.value.malformedCount, 0);
});

test('the pull never attempts to open a withdrawn row', async () => {
  const key = await studyKey();
  const transport = stubTransport({
    contributions: [
      await seal({ key, pseudonym: LIVE_PSEUDONYM, rows: dayRows(120) }),
      await seal({ key, pseudonym: WITHDRAWN_PSEUDONYM, rows: dayRows(999) }),
    ],
    withdrawnPseudonyms: [WITHDRAWN_PSEUDONYM],
  });

  // The SPY is the whole test. Purging after decryption yields exactly the
  // same cohort as purging before it, so only the opener's own call log can
  // tell the two implementations apart — and the difference is whether a
  // withdrawn person's diary was decrypted on a researcher's machine.
  const opened: string[] = [];
  const spy: typeof openCohortContribution = async (input) => {
    opened.push(input.contribution.pseudonym);
    return openCohortContribution(input);
  };

  const pulled = await pullStudyCohort({ transport, keys: [key], open: spy });
  assert.equal(pulled.status, 'available');
  assert.deepEqual(opened, [LIVE_PSEUDONYM], 'only the surviving row may reach the opener');
});

test('an unopenable row is a key statement: every held key is tried before the verdict', async () => {
  const retired = await studyKey();
  const current = await studyKey();
  // Sealed to the CURRENT generation, while `retired` is the one this device
  // happens to try first — the ordinary state of a study that rotated.
  const contribution = await seal({ key: current, pseudonym: LIVE_PSEUDONYM, rows: dayRows(120) });
  const transport = stubTransport({ contributions: [contribution] });

  const withBothKeys = await pullStudyCohort({ transport, keys: [retired, current] });
  assert.equal(withBothKeys.status, 'available');
  if (withBothKeys.status !== 'available') return;
  // THE ASSERTION THAT FAILS WHEN THE LOOP STOPS AT THE FIRST KEY.
  assert.equal(withBothKeys.value.rows.length, 1, 'a row must open under a later key generation, not only the first');
  assert.equal(withBothKeys.value.unopenableCount, 0);
  assert.deepEqual(withBothKeys.value.rows[0]?.days, dayRows(120));

  const withRetiredOnly = await pullStudyCohort({ transport, keys: [retired] });
  assert.equal(withRetiredOnly.status, 'available');
  if (withRetiredOnly.status !== 'available') return;
  // Counted out loud, and NOT an error: the cohort reports the shrink.
  assert.equal(withRetiredOnly.value.rows.length, 0);
  assert.equal(withRetiredOnly.value.unopenableCount, 1);
  assert.equal(withRetiredOnly.value.malformedCount, 0, 'a key this device lacks is not a corruption verdict');
});

test('a tag failure is never reported as malformed', async () => {
  const held = await studyKey();
  const foreign = await studyKey();
  const transport = stubTransport({
    contributions: [await seal({ key: foreign, pseudonym: LIVE_PSEUDONYM, rows: dayRows(120) })],
  });

  const pulled = await pullStudyCohort({ transport, keys: [held] });
  assert.equal(pulled.status, 'available');
  if (pulled.status !== 'available') return;
  assert.equal(pulled.value.unopenableCount, 1, 'a row sealed to another key is un-openable, not malformed');
  assert.equal(pulled.value.malformedCount, 0);
});

test('a structurally impossible body is malformed, and only that case is', async () => {
  const key = await studyKey();
  const good = await seal({ key, pseudonym: LIVE_PSEUDONYM, rows: dayRows(120) });
  // Shorter than the 65-byte ephemeral public key it claims to start with:
  // nothing was ever sealed in this shape, and no key could change that.
  const truncated: StudyContribution = { ...good, pseudonym: WITHDRAWN_PSEUDONYM, body: good.body.slice(0, 40) };
  const transport = stubTransport({ contributions: [good, truncated] });

  const pulled = await pullStudyCohort({ transport, keys: [key] });
  assert.equal(pulled.status, 'available');
  if (pulled.status !== 'available') return;
  assert.equal(pulled.value.malformedCount, 1);
  assert.equal(pulled.value.unopenableCount, 0, 'a structural failure must not be charged to the keyring');
  assert.equal(pulled.value.rows.length, 1, 'one bad row must not cost the cohort the good ones');
});

test('a tier this revision does not define is malformed rather than opened', async () => {
  const key = await studyKey();
  const good = await seal({ key, pseudonym: LIVE_PSEUDONYM, rows: dayRows(120) });
  const transport = stubTransport({ contributions: [{ ...good, schemaTier: 'weight-trajectory:v1' }] });

  const pulled = await pullStudyCohort({ transport, keys: [key] });
  assert.equal(pulled.status, 'available');
  if (pulled.status !== 'available') return;
  assert.equal(pulled.value.malformedCount, 1);
  assert.equal(pulled.value.rows.length, 0);
});

test('a dark research lane yields unavailable, and no cohort at all', async () => {
  const key = await studyKey();
  const dark: StudyTransport = {
    listStudyContributions: async () => ({ status: 'unavailable' }),
    listStudyWithdrawals: async () => ({ status: 'unavailable' }),
  };
  assert.deepEqual(await pullStudyCohort({ transport: dark, keys: [key] }), { status: 'unavailable' });
});

test('a withdrawal the server already honoured still counts as a withdrawal', async () => {
  const key = await studyKey();
  // THE NORMAL CASE, and the one a naive implementation gets wrong.
  // `withdrawContribution` on the service HARD-DELETES the row and inserts the
  // tombstone in one transaction, so `GET /study/contributions` never returns
  // a withdrawn row. A count derived from "how many rows did my filter remove"
  // is therefore structurally zero on every healthy deployment — and would
  // print "Withdrawn: 0" on a study where somebody did withdraw.
  const transport = stubTransport({
    contributions: [await seal({ key, pseudonym: LIVE_PSEUDONYM, rows: dayRows(120) })],
    withdrawnPseudonyms: [WITHDRAWN_PSEUDONYM],
  });

  const pulled = await pullStudyCohort({ transport, keys: [key] });
  assert.equal(pulled.status, 'available');
  if (pulled.status !== 'available') return;

  // THE RENDERED LINE FIRST, deliberately: the number a researcher reads is
  // the one that has to be right, and asserting the field alone would leave
  // the sentence free to print something else.
  const csv = exportStudyCohortCsv({ cohort: pulled.value, fromDayKey: '2026-08-24', toDayKey: '2026-08-24' });
  assert.match(
    csv,
    /# Withdrawn and purged before this export: 1\./,
    'the export must report the withdrawal the server already honoured',
  );
  assert.equal(pulled.value.withdrawnCount, 1, 'the tombstone count is the answer to "how many withdrew"');
  assert.equal(
    pulled.value.serverRetainedWithdrawnCount,
    0,
    'the server honoured the deletion, so the client filter had nothing to remove',
  );
});

test('a row the server should have deleted is purged AND reported as an anomaly', async () => {
  const key = await studyKey();
  // The server returned a row that also carries a tombstone. That is not a
  // routine purge — it is the service failing to honour an erasure it recorded
  // — so the client purges it (defence in depth) and says so separately.
  const transport = stubTransport({
    contributions: [
      await seal({ key, pseudonym: LIVE_PSEUDONYM, rows: dayRows(120) }),
      await seal({ key, pseudonym: WITHDRAWN_PSEUDONYM, rows: dayRows(999) }),
    ],
    withdrawnPseudonyms: [WITHDRAWN_PSEUDONYM],
  });

  const opened: string[] = [];
  const spy: typeof openCohortContribution = async (input) => {
    opened.push(input.contribution.pseudonym);
    return openCohortContribution(input);
  };

  const pulled = await pullStudyCohort({ transport, keys: [key], open: spy });
  assert.equal(pulled.status, 'available');
  if (pulled.status !== 'available') return;

  assert.deepEqual(opened, [LIVE_PSEUDONYM], 'a retained withdrawn row still never reaches the opener');
  assert.equal(pulled.value.serverRetainedWithdrawnCount, 1);
  // NOT SUMMED into the tombstone count: one tombstone, one withdrawal, and
  // separately one row the server should not have sent.
  assert.equal(pulled.value.withdrawnCount, 1, 'the anomaly must not be added to the tombstone count');

  const csv = exportStudyCohortCsv({ cohort: pulled.value, fromDayKey: '2026-08-24', toDayKey: '2026-08-24' });
  assert.match(csv, /# Withdrawn and purged before this export: 1\./);
  assert.match(csv, /returned 1 contribution\(s\) it had already been instructed to delete/);
});

test('the anomaly line is absent when there is no anomaly', async () => {
  const key = await studyKey();
  const transport = stubTransport({
    contributions: [await seal({ key, pseudonym: LIVE_PSEUDONYM, rows: dayRows(120) })],
    withdrawnPseudonyms: [WITHDRAWN_PSEUDONYM],
  });

  const pulled = await pullStudyCohort({ transport, keys: [key] });
  assert.equal(pulled.status, 'available');
  if (pulled.status !== 'available') return;
  const csv = exportStudyCohortCsv({ cohort: pulled.value, fromDayKey: '2026-08-24', toDayKey: '2026-08-24' });
  // A line that appears on every export saying "0 anomalies" trains a reader
  // to skip it. It appears only when it means something.
  assert.doesNotMatch(csv, /already been instructed to delete/);
});
