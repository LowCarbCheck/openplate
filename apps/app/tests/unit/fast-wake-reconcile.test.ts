/**
 * THE ARMED FAST ALERT FOLLOWS THE FAST, NOT THE SCREEN (M240 counsel item 1).
 *
 * `wake_at` is one instant the server holds against THIS device's push
 * subscription. Until fasts synced, only `/fasting` on this device could
 * change the fast, so re-arming from that screen's own actions was complete
 * and `tests/unit/fast-wake-at.test.ts` pins that half.
 *
 * Fasts sync now, and two faults came with it:
 *
 *  1. a fast STARTED on another device armed nothing here, so this device says
 *     nothing when the person's fast finishes;
 *  2. a fast ENDED or REMOVED on another device left this device armed, so it
 *     buzzes "target reached" for a fast that is over. That is the worse one:
 *     a notification about something that did not happen is how people learn
 *     to switch notifications off.
 *
 * `app/lib/fast-wake.ts` answers both in one pure function, and this file
 * drives it. The third case is the one that keeps the fix affordable: a cycle
 * that changed nothing the instant depends on must send NOTHING, or every
 * device patches its subscription on every sync.
 *
 * THE LAST SECTION IS THE WIRING, read as text, because a correctness rule at
 * zero call sites passes every other gate in this repository.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fastWakeAtFor, reconcileFastWakeAtAfterMerge, resolveFastWakeChange } from '../../app/lib/fast-wake';
import {
  DEFAULT_PUSH_PREFS,
  PUSH_ENDPOINT_STORAGE_KEY,
  PUSH_PREFS_STORAGE_KEY,
  resetPush,
  setPushDependencies,
  type PushStorage,
} from '../../app/lib/push';
import type { LocalFast } from '../../app/lib/local-store/schema';

/** 20:00 UTC, the instant every fast below hangs off. */
const START_MS = Date.UTC(2026, 8, 12, 20, 0, 0);
const TARGET_MS = 16 * 3_600_000;
/** What a 16 hour fast started at {@link START_MS} reaches its target at. */
const TARGET_ISO = '2026-09-13T12:00:00.000Z';

function fast(id: string, changed: Partial<LocalFast> = {}): LocalFast {
  return {
    id,
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

describe('resolveFastWakeChange', () => {
  it('CLEARS the alert when the fast was ended on another device', () => {
    // The fault that matters most. This device armed the shot when the fast
    // started here; the person ended it on their phone; the merge hands this
    // device the ended row. Nothing else would ever take the instant back.
    const change = resolveFastWakeChange({
      before: [fast('running')],
      after: [fast('running', { endedAt: START_MS + TARGET_MS })],
    });

    assert.equal(change.hasChanged, true, 'an ended fast must reach the server');
    assert.equal(change.wakeAt, null, 'and it must reach it as a CLEAR, not as a new instant');
  });

  it('CLEARS it when the fast was removed on another device', () => {
    const change = resolveFastWakeChange({ before: [fast('running')], after: [] });

    assert.equal(change.hasChanged, true);
    assert.equal(change.wakeAt, null);
  });

  it('ARMS it when a fast was started on another device', () => {
    const change = resolveFastWakeChange({ before: [], after: [fast('from-the-phone')] });

    assert.equal(change.hasChanged, true, 'a fast this device did not start still finishes on it');
    assert.equal(change.wakeAt, TARGET_ISO);
  });

  it('MOVES it when the start was adjusted on another device', () => {
    const change = resolveFastWakeChange({
      before: [fast('running')],
      after: [fast('running', { startedAt: START_MS - 3_600_000 })],
    });

    assert.equal(change.hasChanged, true);
    assert.equal(change.wakeAt, '2026-09-13T11:00:00.000Z');
  });

  it('THE CONTROL: an unchanged fast list sends nothing', () => {
    // Without this, every case above passes against a reconcile that patches
    // the subscription on every cycle, which is one network request per sync
    // per device for a value that almost never moves.
    const change = resolveFastWakeChange({ before: [fast('running')], after: [fast('running')] });

    assert.equal(change.hasChanged, false);
  });

  it('THE CONTROL, the sharper half: a fast that changed WITHOUT moving its target sends nothing', () => {
    // A mood and a note are written on the fast that just ended, and an
    // already-ended fast implies no instant either way. A reconcile that
    // compared the LIST rather than the INSTANT would fire here.
    const ended = fast('done', { endedAt: START_MS + TARGET_MS });
    const change = resolveFastWakeChange({
      before: [ended],
      after: [{ ...ended, mood: 'good', note: 'easier than last time' }],
    });

    assert.equal(change.hasChanged, false);
  });

  it('THE CONTROL, the other side: an unrelated fast arriving does not disturb the running one', () => {
    // A finished fast pulled down from another device changes the list and
    // must not re-arm anything, because `selectCurrentFast` still names the
    // same open fast.
    const change = resolveFastWakeChange({
      before: [fast('running')],
      after: [fast('running'), fast('history', { startedAt: START_MS - 86_400_000, endedAt: START_MS - 40_000_000 })],
    });

    assert.equal(change.hasChanged, false);
  });

  it('follows the CURRENT fast when a sync left two open, which is the latest start', () => {
    // Two devices that each started a fast offline both keep theirs
    // (ADR-0014). The screen calls the latest-started one current, and the
    // alert has to name the same one or the person is told about a fast the
    // app is not showing them.
    const later = fast('from-the-tablet', { startedAt: START_MS + 3_600_000 });
    assert.equal(fastWakeAtFor([fast('running'), later]), '2026-09-13T13:00:00.000Z');
  });
});

//////////////////////////////////////////////////////////////////////////////
// What actually reaches the server
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

/** Every `wakeAt` the device sent, in order. One entry per PATCH. */
interface SentWakeAts {
  /** The parsed `wakeAt` of each call, so an empty array is "the device stayed silent". */
  values(): (string | null)[];
}

/** The one shape a recorded PATCH body has, parsed rather than asserted. */
const patchBodySchema = z.object({ wakeAt: z.string().nullable() });

/** A registered device with the fast target kind on, and a transport that records every body. */
function installDevice(): SentWakeAts {
  const bodies: string[] = [];
  setPushDependencies({
    storage: fakeStorage({
      [PUSH_ENDPOINT_STORAGE_KEY]: 'https://push.example.test/aaa',
      [PUSH_PREFS_STORAGE_KEY]: JSON.stringify(DEFAULT_PUSH_PREFS),
    }),
    readAccount: () => ({ serverUrl: 'https://sync.example.test', accessToken: 'token-abc' }),
    fetchImpl: async (_input, init) => {
      bodies.push(String(init?.body ?? ''));
      return new Response(null, { status: 204 });
    },
  });
  // PARSED, not cast: a body that stopped carrying `wakeAt` at all would
  // otherwise read as `undefined` and quietly satisfy a deepEqual against
  // `[null]`, which is the exact difference between a clear and a silence.
  return { values: () => bodies.map((body) => patchBodySchema.parse(JSON.parse(body)).wakeAt) };
}

afterEach(() => {
  resetPush();
});

describe('reconcileFastWakeAtAfterMerge, against a real transport', () => {
  it('SENDS A CLEAR when the fast was ended elsewhere, which is the fault this closes', async () => {
    // The pure comparison above says "clear"; this is the half that proves the
    // clear leaves the device. Drop the null branch from `setFastWakeAt`'s
    // caller and this line goes red while every pure case stays green.
    const device = installDevice();

    await reconcileFastWakeAtAfterMerge({
      before: [fast('running')],
      after: [fast('running', { endedAt: START_MS + TARGET_MS })],
    });

    assert.deepEqual(device.values(), [null], 'the server must be told the fast is over, as a clear');
  });

  it('SENDS THE INSTANT when a fast was started elsewhere', async () => {
    const device = installDevice();

    await reconcileFastWakeAtAfterMerge({ before: [], after: [fast('from-the-phone')] });

    assert.deepEqual(device.values(), [TARGET_ISO]);
  });

  it('THE CONTROL: an unchanged list reaches the network not at all', async () => {
    const device = installDevice();

    await reconcileFastWakeAtAfterMerge({ before: [fast('running')], after: [fast('running')] });

    assert.deepEqual(device.values(), [], 'an ordinary cycle must stay silent');
  });
});

//////////////////////////////////////////////////////////////////////////////
// The wiring
//////////////////////////////////////////////////////////////////////////////

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');
}

describe('the reconcile has its two callers', () => {
  it('the sync apply path re-arms after every merge', () => {
    const source = readSource('app/lib/sync/sync-actions.ts');
    assert.match(
      source,
      /reconcileFastWakeAtAfterMerge\(\{\s*before: local\.fasts,\s*after: merged\.fasts\s*\}\)/,
      'a merge that changed the fasts must tell the server what is open now',
    );
  });

  it('the app re-arms once at launch, for the cycle this device slept through', () => {
    const source = readSource('app/root.tsx');
    assert.ok(
      source.includes('reconcileFastWakeAtOnBoot()'),
      'a device closed while another ended the fast has nothing else to repair it',
    );
  });

  it('THE CONTROL: the rule is NOT in the fasting screen, which is only one of three writers', () => {
    const source = readSource('app/routes/fasting.tsx');
    assert.ok(
      !source.includes('resolveFastWakeChange'),
      'the comparison belongs in one module, or a writer that forgets it is a writer that buzzes wrongly',
    );
    // And the screen still asks the same question, through the same module.
    assert.ok(source.includes('fastWakeAtFor('), 'the screen must not re-derive the instant for itself');
  });
});
