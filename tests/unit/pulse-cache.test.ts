/**
 * The read side: at most one request every five minutes, and none at all from
 * a device with no account or with the toggle off.
 *
 * THE SIGNED OUT CASE IS THE CONTROL for the cache tests: a reader that never
 * fetched would satisfy "does not fetch twice" trivially, so the first suite
 * proves a fetch happens at all and the second proves the second one does not.
 *
 * The clock is injected. A test that slept for five minutes would be a test
 * nobody runs.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { PULSE_CACHE_MS, fetchPulseToday, resetPulse, setPulseDependencies, type PulseToday } from '../../app/lib/pulse';

const TODAY: PulseToday = {
  day: '2026-09-12',
  meals: 41,
  photos: 7,
  kcal: 52_300,
  protein: 1_240,
  contributors: 9,
  fastingNow: 4,
};

/** A clock the test moves by hand. */
interface TestClock {
  nowMs: () => number;
  advance: (byMs: number) => void;
}

function clock(startMs: number): TestClock {
  let current = startMs;
  return {
    nowMs: () => current,
    advance: (byMs) => {
      current += byMs;
    },
  };
}

beforeEach(() => resetPulse());
afterEach(() => resetPulse());

describe('fetchPulseToday', () => {
  it('reads once and then serves the same value from memory inside five minutes', async () => {
    let calls = 0;
    const time = clock(1_000_000);
    setPulseDependencies({
      nowMs: time.nowMs,
      readEnabled: () => true,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(TODAY), { status: 200 });
      },
    });

    const first = await fetchPulseToday();
    time.advance(PULSE_CACHE_MS - 1);
    const second = await fetchPulseToday();

    assert.deepEqual(first, TODAY);
    assert.deepEqual(second, TODAY);
    assert.equal(calls, 1);
  });

  it('reads again once the window has passed', async () => {
    let calls = 0;
    const time = clock(1_000_000);
    setPulseDependencies({
      nowMs: time.nowMs,
      readEnabled: () => true,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(TODAY), { status: 200 });
      },
    });

    await fetchPulseToday();
    time.advance(PULSE_CACHE_MS);
    await fetchPulseToday();

    assert.equal(calls, 2);
  });

  it('never fetches on a device with no account', async () => {
    let calls = 0;
    setPulseDependencies({
      readEnabled: () => true,
      readAccount: () => null,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(TODAY), { status: 200 });
      },
    });

    assert.equal(await fetchPulseToday(), null);
    assert.equal(calls, 0);
  });

  it('never fetches while the toggle is off, even with an account', async () => {
    let calls = 0;
    setPulseDependencies({
      readEnabled: () => false,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(TODAY), { status: 200 });
      },
    });

    assert.equal(await fetchPulseToday(), null);
    assert.equal(calls, 0);
  });

  it('returns null on a network error and does not cache the failure', async () => {
    let calls = 0;
    setPulseDependencies({
      readEnabled: () => true,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw new Error('offline');
        return new Response(JSON.stringify(TODAY), { status: 200 });
      },
    });

    assert.equal(await fetchPulseToday(), null);
    assert.deepEqual(await fetchPulseToday(), TODAY);
    assert.equal(calls, 2);
  });
});
