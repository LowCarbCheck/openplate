/**
 * Why the tile and the line were absent on every load, and what now makes them
 * appear.
 *
 * THE DEFECT. `usePulseToday` keyed its effect on `enabled` alone. A reload
 * mounts the dashboard BEFORE the sync session has been resumed, so the vault
 * is still null, `fetchPulseToday` answers null without a request, and nothing
 * ever ran the effect again. The one surface that worked, the header's fasting
 * chip, worked by accident: its `enabled` flips false to true once a fast is
 * open, which is after the resume.
 *
 * THE CONTROL for the key suite is the pair of assertions at the end of it: a
 * key that is merely "null when we must not read" could be a constant for the
 * rest of its life and would still pass every other case here. What the effect
 * needs is a key that CHANGES when the account arrives, and that is asserted
 * against the old behaviour explicitly.
 *
 * There is no DOM in this repo's unit tier, so the hook is not rendered. Its
 * two decisions are exported instead, and the source sweep at the bottom is
 * what stops the hook quietly going back to keying on `enabled`.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PULSE_CACHE_MS,
  pulseReadKey,
  resetPulse,
  setPulseDependencies,
  startPulseRead,
  type PulseReadHost,
  type PulseToday,
} from '../../app/lib/pulse';

const TODAY: PulseToday = {
  day: '2026-09-12',
  meals: 3,
  photos: 0,
  kcal: 600,
  protein: 45,
  contributors: 3,
  fastingNow: 3,
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

/** A tab whose visibility the test controls. */
interface TestTab {
  host: PulseReadHost;
  /** Fires the "this tab came back" event the reader listens for. */
  becomeVisible: () => void;
  /** How many listeners are still registered. Zero after the reader has stopped. */
  listeners: number;
}

function tab(): TestTab {
  const listeners = new Set<() => void>();
  return {
    host: {
      onVisible: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    becomeVisible: () => {
      for (const listener of listeners) listener();
    },
    get listeners() {
      return listeners.size;
    },
  };
}

/** Lets every queued promise callback run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => resetPulse());
afterEach(() => resetPulse());

describe('pulseReadKey', () => {
  it('reads nothing while the caller has not asked', () => {
    assert.equal(pulseReadKey({ enabled: false, accountId: 7 }), null);
  });

  it('reads nothing before the session has been resumed', () => {
    assert.equal(pulseReadKey({ enabled: true, accountId: null }), null);
  });

  it('reads once the account is there', () => {
    assert.notEqual(pulseReadKey({ enabled: true, accountId: 7 }), null);
  });

  it('CHANGES when the account arrives, which is what re-runs the effect', () => {
    const atMount = pulseReadKey({ enabled: true, accountId: null });
    const afterResume = pulseReadKey({ enabled: true, accountId: 7 });
    assert.notEqual(atMount, afterResume);
  });

  it('changes again when a different account signs in', () => {
    assert.notEqual(pulseReadKey({ enabled: true, accountId: 7 }), pulseReadKey({ enabled: true, accountId: 8 }));
  });
});

describe('startPulseRead', () => {
  it('fires exactly one read on mount and reports the figures', async () => {
    let calls = 0;
    const seen: PulseToday[] = [];
    setPulseDependencies({
      readEnabled: () => true,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(TODAY), { status: 200 });
      },
    });

    const stop = startPulseRead({ onValue: (value) => seen.push(value), host: tab().host });
    await settle();
    stop();

    assert.equal(calls, 1);
    assert.deepEqual(seen, [TODAY]);
  });

  it('fires nothing at all while the toggle is off', async () => {
    let calls = 0;
    const seen: PulseToday[] = [];
    setPulseDependencies({
      readEnabled: () => false,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(TODAY), { status: 200 });
      },
    });

    const stop = startPulseRead({ onValue: (value) => seen.push(value), host: tab().host });
    await settle();
    stop();

    assert.equal(calls, 0);
    assert.deepEqual(seen, []);
  });

  it('serves a tab that comes back inside the window from memory', async () => {
    let calls = 0;
    const time = clock(1_000_000);
    const page = tab();
    setPulseDependencies({
      nowMs: time.nowMs,
      readEnabled: () => true,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(TODAY), { status: 200 });
      },
    });

    const stop = startPulseRead({ onValue: () => undefined, host: page.host });
    await settle();
    time.advance(PULSE_CACHE_MS - 1);
    page.becomeVisible();
    await settle();
    stop();

    assert.equal(calls, 1);
  });

  it('reads again when a page left open comes back after the window', async () => {
    let calls = 0;
    const time = clock(1_000_000);
    const page = tab();
    setPulseDependencies({
      nowMs: time.nowMs,
      readEnabled: () => true,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(TODAY), { status: 200 });
      },
    });

    const stop = startPulseRead({ onValue: () => undefined, host: page.host });
    await settle();
    time.advance(PULSE_CACHE_MS);
    page.becomeVisible();
    await settle();
    stop();

    assert.equal(calls, 2);
  });

  it('stops listening and reports nothing once it has been stopped', async () => {
    let calls = 0;
    const seen: PulseToday[] = [];
    const time = clock(1_000_000);
    const page = tab();
    setPulseDependencies({
      nowMs: time.nowMs,
      readEnabled: () => true,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(TODAY), { status: 200 });
      },
    });

    const stop = startPulseRead({ onValue: (value) => seen.push(value), host: page.host });
    stop();
    await settle();
    time.advance(PULSE_CACHE_MS);
    page.becomeVisible();
    await settle();

    assert.equal(page.listeners, 0);
    assert.equal(calls, 1, 'the read already in flight is not cancellable, but its answer is dropped');
    assert.deepEqual(seen, []);
  });

  it('keeps figures already on screen when a later read fails', async () => {
    let calls = 0;
    const seen: PulseToday[] = [];
    const time = clock(1_000_000);
    const page = tab();
    setPulseDependencies({
      nowMs: time.nowMs,
      readEnabled: () => true,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
      fetchImpl: async () => {
        calls += 1;
        if (calls > 1) throw new Error('offline');
        return new Response(JSON.stringify(TODAY), { status: 200 });
      },
    });

    const stop = startPulseRead({ onValue: (value) => seen.push(value), host: page.host });
    await settle();
    time.advance(PULSE_CACHE_MS);
    page.becomeVisible();
    await settle();
    stop();

    assert.equal(calls, 2);
    assert.deepEqual(seen, [TODAY], 'the failed refetch delivered nothing, so the tile still holds the first read');
  });
});

describe('the hook that mounts on both surfaces', () => {
  const source = readFileSync(new URL('../../app/hooks/use-pulse-today.ts', import.meta.url), 'utf8');

  it('keys its effect on the read key and not on `enabled`', () => {
    assert.match(source, /pulseReadKey\(/, 'the hook must compute the key');
    assert.match(source, /\}, \[key\]\);/, 'the effect must re-run when the key changes');
    assert.doesNotMatch(source, /\}, \[enabled\]\);/, 'keying on `enabled` alone is the defect this file records');
  });

  it('reads the account from the sync session snapshot', () => {
    assert.match(source, /useSyncSession\(\)/);
  });
});
