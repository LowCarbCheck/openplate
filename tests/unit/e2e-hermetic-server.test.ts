/**
 * THE BROWSER TIER NEVER ASKS GITHUB FOR A RELEASE.
 *
 * ── What went wrong ──────────────────────────────────────────────────────
 *
 * The tier's production server ran with the release check on, its default.
 * When openplate 0.43.0 was tagged, every branch still on 0.42.0 drew an
 * "update available" ribbon above the header, and eight layout specs failed on
 * trees nobody had touched. `tests/e2e/server-env.ts` now turns the check off
 * for both servers the tier boots.
 *
 * ── What is asserted ─────────────────────────────────────────────────────
 *
 * What each server would receive is fed through `parseUpdateCheck`, the same
 * function the app reads `UPDATE_CHECK` with, so a spelling the app does not
 * honour fails here. Both cases also run with an `UPDATE_CHECK=on` in the
 * inherited environment, because the operator's shell must not reopen it. The
 * last case checks that both servers are really built from `server-env.ts`.
 *
 * ── The control ──────────────────────────────────────────────────────────
 *
 * The reader is also shown the command this tier had before the change, and
 * must call the check ON for it. A reader that always said "off" would pass
 * every other case here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseUpdateCheck } from '../../app/config';
import { buildManagedServerEnv, buildTierServerCommand } from '../e2e/server-env';

/** The values the tier passes; none of them matters to the release check. */
const TIER_OPTIONS = {
  port: 20_000,
  appUrl: 'http://127.0.0.1:20000',
  syncServerUrl: 'http://127.0.0.1:20001',
  contentDir: '/tmp/content',
  foodDbUrl: 'http://127.0.0.1:20002',
  foodDbApiKey: 'e2e-key',
  matomoUrl: 'http://127.0.0.1:9',
} as const;

/**
 * The `UPDATE_CHECK` a `cross-env ... tsx ./server.ts` command hands its child.
 *
 * `cross-env` assignments override the inherited value, and the last of two
 * assignments wins, so the inherited value counts only when none is written.
 */
function readUpdateCheckFromCommand(options: { command: string; inherited: string | undefined }): string | undefined {
  const tokens = options.command.split(' ');
  assert.equal(tokens[0], 'cross-env', `the command does not start with cross-env: ${options.command}`);
  const assignments = tokens.slice(1, tokens.indexOf('tsx'));
  const written = assignments.findLast((token) => token.startsWith('UPDATE_CHECK='));
  return written === undefined ? options.inherited : written.slice('UPDATE_CHECK='.length);
}

/** Reads a file of this checkout. */
function readSource(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('the browser tier servers keep the release check off', () => {
  it('turns the check off in the tier server command, even when the shell turns it on', () => {
    const value = readUpdateCheckFromCommand({ command: buildTierServerCommand(TIER_OPTIONS), inherited: 'on' });

    assert.equal(parseUpdateCheck(value), false, `the tier server would run with UPDATE_CHECK=${value}`);
  });

  it('turns the check off for the managed server, over the shell and over its own values', () => {
    const env = buildManagedServerEnv({ inherited: { UPDATE_CHECK: 'on' }, values: { UPDATE_CHECK: 'on' } });

    assert.equal(
      parseUpdateCheck(env.UPDATE_CHECK),
      false,
      `the managed server would run with UPDATE_CHECK=${env.UPDATE_CHECK}`,
    );
  });

  it('control: reads the command this tier had before the change as a check that is on', () => {
    const before = 'cross-env NODE_ENV=production PORT=20000 HOST=127.0.0.1 MATOMO_SITE_ID=1 tsx ./server.ts';

    assert.equal(parseUpdateCheck(readUpdateCheckFromCommand({ command: before, inherited: undefined })), true);
  });

  it('builds both servers from server-env.ts', () => {
    assert.match(readSource('playwright.config.ts'), /command: buildTierServerCommand\(/);
    assert.match(readSource('tests/e2e/managed-app-server.ts'), /env: buildManagedServerEnv\(/);
  });
});
