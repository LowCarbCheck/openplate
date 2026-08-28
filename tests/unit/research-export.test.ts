/**
 * THE COHORT EXPORT (M161/04, `openplate-sync` ADR-0003 prohibitions 5 and 8).
 *
 * What a researcher actually keeps is the file, so the file has to carry the
 * three things a screen would otherwise carry alone: that this data is
 * PSEUDONYMISED and not anonymous, what the window was, and what is missing
 * from it. A cohort that silently shrinks is worse than one that says how much
 * it lost — so the counts are asserted here by value, not by "the header is
 * non-empty".
 *
 * M161/05 moved the sentences into the `research` i18n namespace. The
 * assertions below are unchanged and deliberately still English: they are what
 * proves the move dropped no field, since a header line that stopped being
 * emitted — or a key that stopped resolving — fails here rather than shipping
 * a quietly shorter research artifact.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { exportStudyCohortCsv } from '../../app/lib/sync/research/export';
import type { StudyCohort } from '../../app/lib/sync/research/study';
import { englishExportStrings as strings } from './research-i18n-harness';

const PSEUDONYM = '1YYFSZXRK6DTYM03TZ22VR1M9M';

function cohort(overrides: Partial<StudyCohort> = {}): StudyCohort {
  return {
    studyAccountId: 7,
    rows: [
      {
        pseudonym: PSEUDONYM,
        contributionVersion: 3,
        schemaTier: 'daily-intake:v1',
        createdAt: '2026-08-28T09:00:00.000Z',
        days: [
          { date: '2026-08-24', energyKcal: 120, proteinG: 0.3, carbsG: 41, fatG: 1, fiberG: 4, loggedEntryCount: 2 },
          { date: '2026-08-25', energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, loggedEntryCount: 0 },
        ],
      },
    ],
    withdrawnCount: 2,
    serverRetainedWithdrawnCount: 0,
    unopenableCount: 4,
    malformedCount: 0,
    ...overrides,
  };
}

test('the export header counts the rows it could not open', async () => {
  const csv = exportStudyCohortCsv({ cohort: cohort(), fromDayKey: '2026-08-24', toDayKey: '2026-08-25', strings });

  // Four un-openable rows out of five considered (one opened + four sealed to
  // a key this device does not hold). The NUMBERS are asserted, because a
  // header that merely mentions keys tells a researcher nothing.
  assert.match(csv, /Sealed to a key this device does not hold: 4 of 5 contributions/);
  assert.ok(csv.includes(strings.unopenable(4, 5)), 'the un-openable count must reach the header');
  // Purged people are reported too — the shrink is visible, never silent.
  assert.match(csv, /Withdrawn and purged before this export: 2/);
});

test('the export says pseudonymised, never anonymous, and states the auxiliary-join caveat', async () => {
  const csv = exportStudyCohortCsv({ cohort: cohort(), fromDayKey: '2026-08-24', toDayKey: '2026-08-25', strings });

  const firstLine = csv.split('\r\n')[0] ?? '';
  assert.match(firstLine, /PSEUDONYMISED, not anonymous/);
  assert.match(firstLine, /re-identify/, 'the auxiliary-join caveat travels with the word');
  // ADR-0003 prohibition 5: no wording anywhere may call a contribution
  // anonymous. The only permitted occurrence of the substring is inside
  // "not anonymous".
  assert.equal(csv.split(/anonymous/i).length - 1, 1, 'the word may appear only in the sentence that refuses it');
});

test('the export carries the tier, the window and the unknown-macro caveat', async () => {
  const csv = exportStudyCohortCsv({ cohort: cohort(), fromDayKey: '2026-08-24', toDayKey: '2026-08-25', strings });

  assert.match(csv, /Schema tier: daily-intake:v1/);
  assert.match(csv, /Window: 2026-08-24 to 2026-08-25 \(inclusive\)/);
  // Slice 03's finding, carried into the artifact: an unknown macro
  // contributes nothing to a day total, so a low total is not evidence of low
  // intake and `loggedEntryCount` is how a researcher tells them apart.
  assert.match(csv, /a low total may mean unknown rather than low intake/);
});

test('the export table is the frozen tier, one row per participant per day', async () => {
  const csv = exportStudyCohortCsv({ cohort: cohort(), fromDayKey: '2026-08-24', toDayKey: '2026-08-25', strings });

  const lines = csv.split('\r\n').filter((line) => !line.startsWith('# '));
  // The column list is written LITERALLY here, not imported: importing it
  // would compare the implementation to itself and pass on any column
  // somebody added to both.
  assert.equal(lines[0], 'pseudonym,date,energyKcal,proteinG,carbsG,fatG,fiberG,loggedEntryCount');
  assert.equal(lines[1], `${PSEUDONYM},2026-08-24,120,0.3,41,1,4,2`);
  assert.equal(lines[2], `${PSEUDONYM},2026-08-25,0,0,0,0,0,0`);
  assert.equal(lines.length, 3, 'one header row and one row per day, and nothing else');
});

test('an empty cohort still exports its window and its counts', async () => {
  const csv = exportStudyCohortCsv({
    cohort: cohort({ rows: [], unopenableCount: 3, withdrawnCount: 0 }),
    fromDayKey: '2026-08-24',
    toDayKey: '2026-08-25',
    strings,
  });

  assert.match(csv, /Participants in this file: 0/);
  assert.match(csv, /Sealed to a key this device does not hold: 3 of 3 contributions/);
  assert.match(csv, /Window: 2026-08-24 to 2026-08-25/);
});

test('the anomaly line is printed only when the server retained a withdrawn contribution', async () => {
  const clean = exportStudyCohortCsv({
    cohort: cohort({ serverRetainedWithdrawnCount: 0 }),
    fromDayKey: '2026-08-24',
    toDayKey: '2026-08-25',
    strings,
  });
  // "0 anomalies" on every file is how a reader learns to skip the line that
  // one day says 2.
  assert.ok(!clean.includes('WARNING FOR THE OPERATOR'), 'a normal pull carries no anomaly line');

  const retained = exportStudyCohortCsv({
    cohort: cohort({ serverRetainedWithdrawnCount: 2 }),
    fromDayKey: '2026-08-24',
    toDayKey: '2026-08-25',
    strings,
  });
  // Addressed to the OPERATOR, not the researcher: the deployment handed over
  // a contribution it had already been instructed to delete.
  assert.match(retained, /WARNING FOR THE OPERATOR: this server handed over 2 contribution\(s\)/);
});
