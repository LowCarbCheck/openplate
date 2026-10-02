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
  isPulseSettled,
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

/** Dependencies that answer every read with `answer`. */
function answering(answer: () => Response | Promise<Response>): void {
  setPulseDependencies({
    readEnabled: () => true,
    readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
    fetchImpl: async () => answer(),
  });
}

describe('isPulseSettled', () => {
  const KEY = 'account:7';
  const SETTLED = { isResuming: false, readKey: KEY, settledKey: KEY, isOverdue: false };

  it('is settled once the first read for this key has finished', () => {
    assert.equal(isPulseSettled(SETTLED), true);
  });

  it('is NOT settled while the first read is in flight', () => {
    assert.equal(isPulseSettled({ ...SETTLED, settledKey: null }), false);
  });

  it('is NOT settled while the session is still reopening, even though no key exists yet', () => {
    // `readKey` is null in that window too, and there it means "not yet". Reading it as "never"
    // would let the card mount before the tile's request has even been made.
    assert.equal(isPulseSettled({ isResuming: true, readKey: null, settledKey: null, isOverdue: false }), false);
  });

  it('is settled when nothing will be read at all', () => {
    assert.equal(isPulseSettled({ isResuming: false, readKey: null, settledKey: null, isOverdue: false }), true);
  });

  it('does not take a finished read of ANOTHER account for this one', () => {
    assert.equal(isPulseSettled({ ...SETTLED, settledKey: 'account:8' }), false);
  });

  it('stops waiting once the wait has run out', () => {
    assert.equal(isPulseSettled({ ...SETTLED, settledKey: null, isOverdue: true }), true);
  });
});

describe('startPulseRead and its first read', () => {
  it('reports the first read after the figures, so the tile is in before anything waits on it', async () => {
    answering(() => new Response(JSON.stringify(TODAY), { status: 200 }));
    const order: string[] = [];
    const stop = startPulseRead({
      onValue: () => order.push('figures'),
      onFirstRead: () => order.push('first read'),
      host: tab().host,
    });
    await settle();
    stop();
    assert.deepEqual(order, ['figures', 'first read']);
  });

  it('reports the first read when it FAILED, which is what makes "absent" known', async () => {
    answering(() => new Response('nope', { status: 503 }));
    const order: string[] = [];
    const stop = startPulseRead({
      onValue: () => order.push('figures'),
      onFirstRead: () => order.push('first read'),
      host: tab().host,
    });
    await settle();
    stop();
    assert.deepEqual(order, ['first read']);
  });

  it('reports the first read when the door is closed and no request is made', async () => {
    setPulseDependencies({ readEnabled: () => false });
    let isDone = false;
    const stop = startPulseRead({ onValue: () => undefined, onFirstRead: () => (isDone = true), host: tab().host });
    await settle();
    stop();
    assert.equal(isDone, true);
  });

  it('reports the first read once, not again when the tab comes back', async () => {
    const time = clock(1_000_000);
    const page = tab();
    setPulseDependencies({
      nowMs: time.nowMs,
      readEnabled: () => true,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
      fetchImpl: async () => new Response(JSON.stringify(TODAY), { status: 200 }),
    });
    let firstReads = 0;
    const stop = startPulseRead({ onValue: () => undefined, onFirstRead: () => (firstReads += 1), host: page.host });
    await settle();
    time.advance(PULSE_CACHE_MS);
    page.becomeVisible();
    await settle();
    stop();
    assert.equal(firstReads, 1);
  });

  it('says nothing for a read that was stopped before it finished', async () => {
    answering(() => new Response(JSON.stringify(TODAY), { status: 200 }));
    let isDone = false;
    const stop = startPulseRead({ onValue: () => undefined, onFirstRead: () => (isDone = true), host: tab().host });
    stop();
    await settle();
    assert.equal(isDone, false);
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

  it('settles on the session AND the read, and gives up waiting after a deadline', () => {
    assert.match(source, /isPulseSettled\(/, 'the hook must ask the pure rule');
    assert.match(source, /isResuming: session\.isResuming/, 'an unsettled session is not an absent tile');
    assert.match(source, /onFirstRead:/, 'the first read, whatever it found, is what settles');
    assert.match(source, /PULSE_SETTLE_DEADLINE_MS/, 'a hung request must not hold a waiting surface for good');
  });
});
