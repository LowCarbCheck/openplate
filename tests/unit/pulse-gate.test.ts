/**
 * The door: with the toggle off, nothing leaves this device.
 *
 * THE "ON" HALF IS THE CONTROL, and it is the whole reason this file has two
 * suites. A module that had been broken into never sending anything at all
 * would pass the off case perfectly, which is exactly the failure the toggle
 * is supposed to protect against in the other direction. So the same three
 * actions are run twice and the counts are asserted both ways: zero, then
 * exactly three.
 *
 * `tools/oxlint/anti-slop` forbids module mocking, so the fetch is injected
 * (`setPulseDependencies`) rather than stubbed. That is a better test anyway:
 * the assertion is on a function the module was HANDED, so a send through any
 * other transport would show up as a missing call here and as a `/v1/pulse`
 * string outside `app/lib/pulse.ts` in spec 03's grep.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  reportFastingHeartbeat,
  reportMealLogged,
  reportPhotoParsed,
  resetPulse,
  setPulseDependencies,
} from '../../app/lib/pulse';

/** Every request the module made, in order. */
interface Sent {
  url: string;
  init: RequestInit | undefined;
}

function recordingFetch(sent: Sent[]): typeof fetch {
  return async (input, init) => {
    sent.push({ url: String(input), init });
    return new Response('{}', { status: 202 });
  };
}

/** The three actions the milestone names, run once each. */
async function runTheThreeActions(): Promise<void> {
  await reportMealLogged({ kcal: 512, protein: 33 });
  await reportPhotoParsed();
  await reportFastingHeartbeat();
}

beforeEach(() => {
  resetPulse();
});

afterEach(() => {
  resetPulse();
});

describe('the pulse gate', () => {
  it('sends nothing at all while the toggle is off', async () => {
    const sent: Sent[] = [];
    setPulseDependencies({
      fetchImpl: recordingFetch(sent),
      readEnabled: () => false,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
    });

    await runTheThreeActions();

    assert.equal(sent.length, 0);
  });

  it('sends nothing at all on a device with no account, toggle on', async () => {
    const sent: Sent[] = [];
    setPulseDependencies({
      fetchImpl: recordingFetch(sent),
      readEnabled: () => true,
      readAccount: () => null,
    });

    await runTheThreeActions();

    assert.equal(sent.length, 0);
  });

  it('sends exactly three requests with the toggle on and an account present', async () => {
    const sent: Sent[] = [];
    setPulseDependencies({
      fetchImpl: recordingFetch(sent),
      readEnabled: () => true,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
    });

    await runTheThreeActions();

    assert.equal(sent.length, 3);
    assert.deepEqual(
      sent.map((request) => request.url),
      [
        'https://sync.example/v1/pulse/meal',
        'https://sync.example/v1/pulse/photo',
        'https://sync.example/v1/pulse/fasting',
      ],
    );
  });

  it('never throws at the caller when the network fails', async () => {
    setPulseDependencies({
      fetchImpl: async () => {
        throw new Error('offline');
      },
      readEnabled: () => true,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: 'token' }),
    });

    await assert.doesNotReject(runTheThreeActions());
  });
});
