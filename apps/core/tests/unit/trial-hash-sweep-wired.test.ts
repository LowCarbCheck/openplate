/**
 * The hash purge and the trial flag are wired in `main.ts` (ADR-0010).
 *
 * `main.ts` boots a whole service and cannot be imported by a test, so a purge
 * that was written, tested and never called from it would pass every other
 * suite and leave every hash in the table for ever. This reads the source, the
 * way `compose-env-surface.test.ts` does, and looks for the three lines that
 * make the feature real. The control runs the same checks over a source with
 * the lines removed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');

const WIRING = [
  { what: 'the purge is called on the hourly tick', pattern: /await purgeExpiredTrialHashes\(database\.db,/ },
  { what: 'with the configured period', pattern: /retentionDays: config\.trialHashRetentionDays/ },
  {
    what: 'a deletion keeps a hash only on an instance that grants a trial',
    pattern: /grantsScanTrial: config\.trial !== null/,
  },
] as const;

test('main.ts calls the purge with the configured period and tells the store whether a trial is granted', () => {
  for (const { what, pattern } of WIRING) {
    assert.match(MAIN, pattern, what);
  }
});

test('CONTROL: the same checks fail on a source with the wiring removed', () => {
  const stripped = MAIN.replaceAll('purgeExpiredTrialHashes', 'x')
    .replaceAll('config.trialHashRetentionDays', 'y')
    .replaceAll('config.trial !== null', 'z');
  for (const { what, pattern } of WIRING) {
    assert.doesNotMatch(stripped, pattern, what);
  }
});
