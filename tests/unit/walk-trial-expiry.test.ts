/**
 * Tests for the pure half of `scripts/walk-trial-expiry.ts`, the M214 spec 05
 * walk.
 *
 * The script's job is to FAIL when an expired trial does not open the plans
 * door, so every assertion here is paired with a control that makes the same
 * check fail. `assertPlansDoor` that only ever saw a `plans` door would pass
 * against a screen still showing the administrator sentence, which is the one
 * outcome the walk exists to catch.
 *
 * Nothing here sends a request. The impure half is the walk itself.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  accountReferenceMatches,
  assertPlansDoor,
  parseArgs,
  WalkError,
  yesterdayIso,
} from '../../scripts/walk-trial-expiry';
import type { AiIntakeDoor } from '../../app/components/add/use-ai-connection';

const ENDED_AT = '2026-09-09T12:00:00.000Z';

/** No `SYNC_SERVER_URL`, so a case that does not name one gets the loopback default. */
const EMPTY_ENV: NodeJS.ProcessEnv = {};

describe('parseArgs', () => {
  it('falls back to SYNC_SERVER_URL, then to loopback', () => {
    assert.equal(parseArgs([], EMPTY_ENV).baseUrl, 'http://localhost:3000');
    assert.equal(parseArgs([], { SYNC_SERVER_URL: 'https://api.example.test' }).baseUrl, 'https://api.example.test');
  });

  it('lets --url win over the environment', () => {
    const invocation = parseArgs(['--url', 'https://other.example.test'], { SYNC_SERVER_URL: 'https://api.example.test' });
    assert.equal(invocation.baseUrl, 'https://other.example.test');
  });

  it('reads no account reference when none is given', () => {
    assert.equal(parseArgs([], EMPTY_ENV).account, null);
  });

  it('trims the account reference', () => {
    assert.equal(parseArgs(['--account', ' 42 '], EMPTY_ENV).account, '42');
  });

  it('refuses an empty account reference', () => {
    assert.throws(() => parseArgs(['--account', '  '], EMPTY_ENV), WalkError);
  });

  it('carries --help', () => {
    assert.equal(parseArgs(['--help'], EMPTY_ENV).help, true);
    assert.equal(parseArgs([], EMPTY_ENV).help, false);
  });
});

describe('yesterdayIso', () => {
  it('is exactly one day before the instant it is given', () => {
    assert.equal(yesterdayIso(new Date('2026-09-10T08:30:00.000Z')), '2026-09-09T08:30:00.000Z');
  });

  it('crosses a month boundary', () => {
    assert.equal(yesterdayIso(new Date('2026-09-01T00:00:00.000Z')), '2026-08-31T00:00:00.000Z');
  });

  it('is never the instant it was given, which is what makes the date read as passed', () => {
    const today = new Date('2026-09-10T08:30:00.000Z');
    assert.notEqual(yesterdayIso(today), today.toISOString());
    assert.ok(Date.parse(yesterdayIso(today)) < today.getTime());
  });
});

describe('assertPlansDoor', () => {
  it('accepts a plans door carrying the date that was written', () => {
    const verdict = assertPlansDoor({ kind: 'plans', endedAt: ENDED_AT }, ENDED_AT);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.ok ? verdict.endedAt : null, ENDED_AT);
  });

  it('accepts the same instant spelled in another offset', () => {
    const verdict = assertPlansDoor({ kind: 'plans', endedAt: '2026-09-09T14:00:00.000+02:00' }, ENDED_AT);
    assert.equal(verdict.ok, true);
  });

  // THE CONTROLS. Each of these is a door a broken build would draw, and each
  // must fail: a check that only ever saw the passing case records nothing.
  const OTHER_DOORS: AiIntakeDoor[] = [
    { kind: 'ask-admin' },
    { kind: 'byok' },
    { kind: 'not-switched-on' },
    { kind: 'allowance-ended', endedAt: ENDED_AT },
  ];

  for (const door of OTHER_DOORS) {
    it(`refuses a "${door.kind}" door`, () => {
      const verdict = assertPlansDoor(door, ENDED_AT);
      assert.equal(verdict.ok, false);
      assert.match(verdict.ok ? '' : verdict.reason, new RegExp(door.kind));
    });
  }

  it('refuses a plans door with no date, which is the account that never had an allowance', () => {
    const verdict = assertPlansDoor({ kind: 'plans', endedAt: null }, ENDED_AT);
    assert.equal(verdict.ok, false);
  });

  it('refuses a plans door naming a different instant', () => {
    const verdict = assertPlansDoor({ kind: 'plans', endedAt: '2026-01-01T00:00:00.000Z' }, ENDED_AT);
    assert.equal(verdict.ok, false);
    assert.match(verdict.ok ? '' : verdict.reason, /2026-01-01T00:00:00.000Z/);
  });

  it('refuses a date that is not an instant, on either side', () => {
    assert.equal(assertPlansDoor({ kind: 'plans', endedAt: 'yesterday' }, ENDED_AT).ok, false);
    assert.equal(assertPlansDoor({ kind: 'plans', endedAt: ENDED_AT }, 'yesterday').ok, false);
  });
});

describe('accountReferenceMatches', () => {
  const ACCOUNT = { id: 42, email: 'walker@example.invalid' };

  it('matches the id', () => {
    assert.equal(accountReferenceMatches({ reference: ' 42 ', ...ACCOUNT }), true);
  });

  it('matches the handle, whatever its case', () => {
    assert.equal(accountReferenceMatches({ reference: 'Walker@Example.Invalid', ...ACCOUNT }), true);
  });

  it('refuses another account, which is the reference that would prove nothing', () => {
    assert.equal(accountReferenceMatches({ reference: '43', ...ACCOUNT }), false);
    assert.equal(accountReferenceMatches({ reference: 'somebody@example.invalid', ...ACCOUNT }), false);
  });
});
