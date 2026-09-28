/**
 * The fast target one shot, from the fasting route's side (M223 spec 04).
 *
 * `wake_at` is a SERVER SIDE ONE SHOT: the server holds one instant per
 * subscription and forgets it once it has fired. So every fasting write path
 * has to say the instant again, and the interesting failure is not arithmetic,
 * it is a path that quietly says nothing. Two claims here, and they answer two
 * different failures:
 *
 *  1. THE INSTANT IS RIGHT for what the store holds after each of the five
 *     writes: a started fast, an adjusted start, an ended fast, a cancelled
 *     plan and a deleted row.
 *  2. THE ROUTE ACTUALLY CALLS IT, on all five intents. A correctness call at
 *     zero call sites passes every other gate in this repository, so the five
 *     intent bodies of `app/routes/fasting.tsx` are read as text.
 *
 * ── The control ──────────────────────────────────────────────────────────
 *
 * A device whose owner unticked the fast target kind sends NOTHING, and that
 * is asserted against a fake transport as an empty call list. Deleting the
 * `fastTargetEnabled` guard in `setFastWakeAt` turns that test red while every
 * other test in this file stays green.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fastWakeAtIso, resetPush, setFastWakeAt, setPushDependencies, PUSH_ENDPOINT_STORAGE_KEY, PUSH_PREFS_STORAGE_KEY, DEFAULT_PUSH_PREFS } from '../../app/lib/push';
import type { PushStorage } from '../../app/lib/push';
import { selectCurrentFast } from '../../app/models/fasting';
import type { LocalFast } from '../../app/lib/local-store';

//////////////////////////////////////////////////////////////////////////////
// Fixtures
//////////////////////////////////////////////////////////////////////////////

/** 20:00 UTC on the day this milestone started, the instant every fast below hangs off. */
const START_MS = Date.UTC(2026, 8, 12, 20, 0, 0);

/** Sixteen hours, the default daily window. */
const TARGET_MS = 16 * 3600_000;

/** One stored fast, with only the fields this file is about spelled out. */
function fastWith(changed: Partial<LocalFast>): LocalFast {
  return {
    id: 'fast-1',
    protocolId: '16:8',
    targetDurationMs: TARGET_MS,
    plannedStartAt: null,
    startedAt: START_MS,
    endedAt: null,
    mood: null,
    note: null,
    createdAt: START_MS,
    ...changed,
  };
}

/** What the route computes after a write: the instant, off whatever the store now holds. */
function wakeAtForStore(fasts: readonly LocalFast[]): string | null {
  return fastWakeAtIso(selectCurrentFast(fasts));
}

//////////////////////////////////////////////////////////////////////////////
// The instant after each write
//////////////////////////////////////////////////////////////////////////////

describe('the wake instant after a fasting write', () => {
  it('a started fast wakes at its target', () => {
    assert.equal(wakeAtForStore([fastWith({})]), '2026-09-13T12:00:00.000Z');
  });

  it('an adjusted start moves the instant with it', () => {
    const movedBack = fastWith({ startedAt: START_MS - 3600_000 });
    assert.equal(wakeAtForStore([movedBack]), '2026-09-13T11:00:00.000Z');
  });

  it('a scheduled fast wakes at its planned start plus the target', () => {
    const scheduled = fastWith({ startedAt: null, plannedStartAt: START_MS + 3600_000 });
    assert.equal(wakeAtForStore([scheduled]), '2026-09-13T13:00:00.000Z');
  });

  it('an ended fast clears it', () => {
    assert.equal(wakeAtForStore([fastWith({ endedAt: START_MS + TARGET_MS })]), null);
  });

  it('a cancelled plan and a deleted row clear it: the store simply has no open fast', () => {
    assert.equal(wakeAtForStore([]), null);
  });

  it('the control: an ended fast beside an open one keeps the open one', () => {
    const ended = fastWith({ id: 'older', endedAt: START_MS });
    assert.equal(wakeAtForStore([ended, fastWith({})]), '2026-09-13T12:00:00.000Z');
  });
});

//////////////////////////////////////////////////////////////////////////////
// The kind the person switched off
//////////////////////////////////////////////////////////////////////////////

/** A storage a test can seed and read back, standing in for `localStorage`. */
function fakeStorage(seed: Record<string, string>): PushStorage {
  const entries = new Map<string, string>(Object.entries(seed));
  return {
    read: (key) => entries.get(key) ?? null,
    write: (key, value) => {
      entries.set(key, value);
    },
    remove: (key) => {
      entries.delete(key);
    },
  };
}

/** A registered device with the two kinds as given, and a transport that records every call. */
function installDevice(prefs: { catchUpMinute: number | null; fastTargetEnabled: boolean }) {
  const calls: string[] = [];
  setPushDependencies({
    storage: fakeStorage({
      [PUSH_ENDPOINT_STORAGE_KEY]: 'https://push.example.test/aaa',
      [PUSH_PREFS_STORAGE_KEY]: JSON.stringify(prefs),
    }),
    readAccount: () => ({ serverUrl: 'https://sync.example.test', accessToken: 'token-abc' }),
    fetchImpl: async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return new Response(null, { status: 204 });
    },
  });
  return calls;
}

afterEach(() => {
  resetPush();
});

describe('a device whose fast target kind is off', () => {
  it('THE CONTROL: sends nothing at all, on a write that would otherwise arm the shot', async () => {
    const calls = installDevice({ catchUpMinute: 480, fastTargetEnabled: false });

    await setFastWakeAt(wakeAtForStore([fastWith({})]));

    assert.deepEqual(calls, []);
  });

  it('and the same write with the kind on does reach the server', async () => {
    const calls = installDevice(DEFAULT_PUSH_PREFS);

    await setFastWakeAt(wakeAtForStore([fastWith({})]));

    assert.deepEqual(calls, ['PATCH https://sync.example.test/v1/push/subscriptions']);
  });
});

//////////////////////////////////////////////////////////////////////////////
// The wiring
//////////////////////////////////////////////////////////////////////////////

/** The fasting route's source, read as text: this section is about call sites, not behaviour. */
const fastingSource = readFileSync(
  fileURLToPath(new URL('../../app/routes/fasting.tsx', import.meta.url)),
  'utf8',
);

/** The body of one `async function _name(...)` in that source, up to the next top-level function. */
function intentBody(name: string): string {
  const start = fastingSource.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} is no longer in the fasting route`);
  const next = fastingSource.indexOf('\nasync function ', start + 1);
  const end = next === -1 ? fastingSource.length : next;
  return fastingSource.slice(start, end);
}

describe('the fasting route', () => {
  for (const intent of ['_startFast', '_adjustStart', '_endFast', '_cancelPlan', '_deleteFast']) {
    it(`re-arms the one shot in ${intent}`, () => {
      assert.ok(intentBody(intent).includes('syncFastWakeAt()'), intent);
    });
  }

  it('the control: an intent that changes no fast does not touch it', () => {
    // `_acknowledgeCare` writes a settings field and nothing about a fast, so
    // a route that called the helper everywhere would fail here.
    assert.equal(intentBody('_acknowledgeCare').includes('syncFastWakeAt()'), false);
  });
});
