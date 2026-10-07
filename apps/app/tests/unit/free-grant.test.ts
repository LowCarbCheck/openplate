/**
 * The standing free grant as the app reads it (2026-09-30): the decoder, the
 * limit a screen names, and the scan count it lifts. Every case beside the
 * case one step across its boundary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { adminUsage } from '../../app/lib/admin/admin-usage';
import { decodeFreeDailyAiLimit, hasFreeGrant, shownAiLimit } from '../../app/lib/plans/free-grant';
import { bindingTrialScans } from '../../app/lib/plans/trial-scans';

const NOW = new Date('2026-10-01T12:00:00.000Z');

/** The limit a screen names, without its window: what these cases were written about. */
function shownLimit(input: Parameters<typeof shownAiLimit>[0]): number | null {
  return shownAiLimit(input)?.limit ?? null;
}
const PAST = '2026-09-01T00:00:00.000Z';
const FUTURE = '2026-11-01T00:00:00.000Z';

test('the decoder reads a whole number, and an older core or a broken value as no grant', () => {
  assert.equal(decodeFreeDailyAiLimit(10), 10);
  assert.equal(decodeFreeDailyAiLimit(0), 0);
  assert.equal(decodeFreeDailyAiLimit(undefined), 0);
  assert.equal(decodeFreeDailyAiLimit(null), 0);
  assert.equal(decodeFreeDailyAiLimit(-3), 0);
  assert.equal(decodeFreeDailyAiLimit(2.5), 0);
});

test('a grant is a number above zero, and not-read is none', () => {
  assert.equal(hasFreeGrant({ freeDailyAiLimit: 10 }), true);
  assert.equal(hasFreeGrant({ freeDailyAiLimit: 0 }), false);
  assert.equal(hasFreeGrant({ freeDailyAiLimit: null }), false);
  assert.equal(hasFreeGrant({}), false);
});

test('a screen names the free limit once a paid window ended above it', () => {
  const ended = { dailyAiLimit: 200, freeDailyAiLimit: 10, allowanceExpiresAt: PAST, now: NOW };
  assert.equal(shownLimit(ended), 10);
  // THE CONTROL: while the paid window runs, its own limit is named.
  assert.equal(shownLimit({ ...ended, allowanceExpiresAt: FUTURE }), 200);
  // The boundary instant has ended, as in the proxy.
  assert.equal(shownLimit({ ...ended, allowanceExpiresAt: NOW.toISOString() }), 10);
});

test('a free grant with no paid limit is named, and everything else is drawn as before', () => {
  assert.equal(shownLimit({ dailyAiLimit: 0, freeDailyAiLimit: 10, allowanceExpiresAt: null, now: NOW }), 10);
  // No free grant, or a core older than the field: the paid limit, as always.
  assert.equal(shownLimit({ dailyAiLimit: 20, freeDailyAiLimit: 0, allowanceExpiresAt: null, now: NOW }), 20);
  assert.equal(
    shownLimit({ dailyAiLimit: 20, freeDailyAiLimit: undefined, allowanceExpiresAt: PAST, now: NOW }),
    20,
  );
  // Not read yet stays not read.
  assert.equal(
    shownLimit({ dailyAiLimit: null, freeDailyAiLimit: 10, allowanceExpiresAt: null, now: NOW }),
    null,
  );
});

test('a free grant lifts the scan count a screen states', () => {
  const trialScans = { granted: 10, left: 0 };
  assert.equal(bindingTrialScans({ trialScans, allowanceExpiresAt: null, freeDailyAiLimit: 10 }), null);
  // THE CONTROL: without one, the spent count binds.
  assert.deepEqual(bindingTrialScans({ trialScans, allowanceExpiresAt: null, freeDailyAiLimit: 0 }), trialScans);
});

/** A translate stand-in that prints the key and its parameters, so the assertion names both. */
function t(key: string, params?: Readonly<Record<string, string | number>>): string {
  return params === undefined ? key : `${key} ${JSON.stringify(params)}`;
}

test("the admin's used-today line reads the limit that binds", () => {
  const invited = { dailyAiLimit: 0, freeDailyAiLimit: 10, allowanceExpiresAt: null, aiUsedToday: 3 };
  assert.equal(adminUsage({ person: invited, t, now: NOW }), 'admin.usage {"used":3,"limit":10}');
  // THE CONTROL: the paid column alone said "No photos" for this person.
  assert.equal(adminUsage({ person: { ...invited, freeDailyAiLimit: 0 }, t, now: NOW }), 'admin.usageNone');
});
