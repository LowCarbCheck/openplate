/**
 * Which basis the protein reference follows on the device (M263/04).
 *
 * `readNutrientReferenceBasis` answers the way the vitamin and mineral rows are
 * answered: the sync server's handshake basis when it publishes one, else the
 * app server's own `NUTRIENT_REFERENCE_BASIS`. What is pinned here is that
 * order, the once-per-tab memory, the bounded wait on the handshake, and the
 * offline answer. The handshake and the wait are injected, so nothing here
 * touches a network or a real clock beyond a few milliseconds.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  forgetNutrientReferenceBasis,
  readNutrientReferenceBasis,
  readRememberedNutrientReferenceBasis,
  resolveNutrientReferenceBasis,
  type NutrientReferenceBasisDeps,
  type NutrientReferenceBasisLoaderData,
} from '../../app/lib/nutrient-reference-basis-client';
import { DEFAULT_NUTRIENT_REFERENCE_BASIS } from '../../app/lib/nutrient-reference';
import type { InstanceDescriptor } from '../../app/lib/sync/engine/protocol';

const SYNC_URL = 'https://sync.example.invalid';

/** A plain open instance, the fields this module does not read. */
const BASE_INSTANCE = {
  name: 'Test instance',
  language: 'en',
  mail: false,
  memberInvites: false,
  plans: false,
  ai: null,
} satisfies InstanceDescriptor;

/** A handshake that publishes the given basis, or none. */
function instanceWith(basis: 'dge' | 'efsa' | 'us' | null): InstanceDescriptor {
  if (basis === null) return BASE_INSTANCE;
  return { ...BASE_INSTANCE, nutrientReferenceBasis: basis };
}

/** A server loader, and how many times it was called. */
interface CountingLoader {
  load: () => Promise<NutrientReferenceBasisLoaderData>;
  calls: () => number;
}

/** A server loader that counts its calls. */
function countingLoader(data: NutrientReferenceBasisLoaderData): CountingLoader {
  let count = 0;
  return {
    load: async () => {
      count += 1;
      return data;
    },
    calls: () => count,
  };
}

/** Deps whose handshake answers at once with the given descriptor. */
function answering(instance: InstanceDescriptor | null): NutrientReferenceBasisDeps {
  return { readInstance: async () => instance, waitMs: 1000 };
}

/** Deps whose handshake never answers, with a short wait. */
function neverAnswering(): NutrientReferenceBasisDeps {
  return { readInstance: () => new Promise<InstanceDescriptor | null>(() => undefined), waitMs: 5 };
}

/** A server loader whose `.data` fetch failed at the network, as it does offline. */
async function offlineLoader(): Promise<NutrientReferenceBasisLoaderData> {
  throw new TypeError('Failed to fetch');
}

/** A server loader with a fault of its own, not the network. */
async function faultyLoader(): Promise<NutrientReferenceBasisLoaderData> {
  throw new Error('loader bug');
}

/** A server loader whose `.data` fetch never answers: a slow network that is still online. */
function hangingLoader(): Promise<NutrientReferenceBasisLoaderData> {
  return new Promise<NutrientReferenceBasisLoaderData>(() => undefined);
}

/** A server loader that answers after `delayMs`, well past a short budget. */
function lateLoader(options: {
  data: NutrientReferenceBasisLoaderData;
  delayMs: number;
}): () => Promise<NutrientReferenceBasisLoaderData> {
  return () =>
    new Promise<NutrientReferenceBasisLoaderData>((resolve) => {
      setTimeout(() => resolve(options.data), options.delayMs);
    });
}

/** The budget the timeout cases give a read. */
const SHORT_BUDGET_MS = 5;

/** How long the test itself waits for a read before it calls the read unbounded. */
const TEST_DEADLINE_MS = 500;

/**
 * The read, or `'still waiting'` when it has not settled by TEST_DEADLINE_MS. A read that awaits the
 * server loader outside the budget never settles against a hanging loader, so this is what a
 * missing race looks like from outside, as a failed assertion rather than a hung test run.
 */
async function readOrStillWaiting(read: Promise<string>): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve('still waiting'), TEST_DEADLINE_MS);
  });
  try {
    return await Promise.race([read, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Node has a `navigator` with no `onLine`, which the offline check reads as offline. Set it per case. */
function setOnline(isOnline: boolean): void {
  Object.defineProperty(globalThis.navigator, 'onLine', { value: isOnline, configurable: true });
}

beforeEach(() => {
  forgetNutrientReferenceBasis();
  setOnline(true);
});

afterEach(() => {
  forgetNutrientReferenceBasis();
});

describe('resolveNutrientReferenceBasis', () => {
  it('takes the sync server basis over the app server basis', () => {
    assert.equal(resolveNutrientReferenceBasis({ instanceBasis: 'efsa', serverBasis: 'dge' }), 'efsa');
    // CONTROL: with none published, the app server's stands.
    assert.equal(resolveNutrientReferenceBasis({ instanceBasis: null, serverBasis: 'us' }), 'us');
  });
});

/** A read that loses its budget hangs; the suite turns that into a failure instead of a stuck run. */
const SUITE_TIMEOUT_MS = 10_000;

describe('readNutrientReferenceBasis', { timeout: SUITE_TIMEOUT_MS }, () => {
  it('uses the handshake basis when the sync server publishes one', async () => {
    const loader = countingLoader({ syncServerUrl: SYNC_URL, nutrientReferenceBasis: 'dge' });
    assert.equal(await readNutrientReferenceBasis(loader.load, answering(instanceWith('efsa'))), 'efsa');
  });

  it('uses the app server basis when the handshake names none', async () => {
    const loader = countingLoader({ syncServerUrl: SYNC_URL, nutrientReferenceBasis: 'us' });
    assert.equal(await readNutrientReferenceBasis(loader.load, answering(instanceWith(null))), 'us');
  });

  it('uses the app server basis when there is no sync server, without asking for a handshake', async () => {
    const loader = countingLoader({ syncServerUrl: null, nutrientReferenceBasis: 'efsa' });
    let handshakes = 0;
    const deps: NutrientReferenceBasisDeps = {
      readInstance: async () => {
        handshakes += 1;
        return instanceWith('us');
      },
      waitMs: 1000,
    };
    assert.equal(await readNutrientReferenceBasis(loader.load, deps), 'efsa');
    assert.equal(handshakes, 0);
  });

  it('remembers a settled answer for the tab and does not ask the server loader again', async () => {
    const loader = countingLoader({ syncServerUrl: SYNC_URL, nutrientReferenceBasis: 'dge' });
    await readNutrientReferenceBasis(loader.load, answering(instanceWith('efsa')));
    // A later load whose handshake would say otherwise still gets the tab's answer.
    assert.equal(await readNutrientReferenceBasis(loader.load, answering(instanceWith('us'))), 'efsa');
    assert.equal(loader.calls(), 1);
    assert.equal(readRememberedNutrientReferenceBasis(), 'efsa');
  });

  it('stops waiting for a handshake that does not answer, and asks again on the next load', async () => {
    const loader = countingLoader({ syncServerUrl: SYNC_URL, nutrientReferenceBasis: 'us' });
    assert.equal(await readOrStillWaiting(readNutrientReferenceBasis(loader.load, neverAnswering())), 'us');
    // The action on that page computes with what the page showed.
    assert.equal(readRememberedNutrientReferenceBasis(), 'us');
    // CONTROL: not remembered as the tab's answer, so a handshake that answers
    // on the next load wins.
    assert.equal(await readNutrientReferenceBasis(loader.load, answering(instanceWith('efsa'))), 'efsa');
    assert.equal(loader.calls(), 2);
  });

  it('settles within the budget with the default basis when the server loader never answers', async () => {
    const started = Date.now();
    const basis = await readOrStillWaiting(
      readNutrientReferenceBasis(hangingLoader, { ...answering(instanceWith('efsa')), waitMs: SHORT_BUDGET_MS }),
    );
    // CONTROL: `readOrStillWaiting` answers 'still waiting' for a read that awaits the loader
    // without the race, so this fails rather than hangs if the budget stops covering the loader.
    assert.equal(basis, 'dge');
    assert.equal(basis, DEFAULT_NUTRIENT_REFERENCE_BASIS);
    assert.ok(Date.now() - started < TEST_DEADLINE_MS, 'settled well inside the test deadline');
    // The action on that page computes with what the page showed.
    assert.equal(readRememberedNutrientReferenceBasis(), 'dge');
  });

  it('control: the test deadline really reports a read that never settles', async () => {
    assert.equal(await readOrStillWaiting(hangingLoader().then(() => 'answered')), 'still waiting');
  });

  it('does not remember the default from a slow load, so a later load that answers wins', async () => {
    const slow = lateLoader({ data: { syncServerUrl: null, nutrientReferenceBasis: 'efsa' }, delayMs: 50 });
    const budget = { ...answering(null), waitMs: SHORT_BUDGET_MS };
    assert.equal(await readNutrientReferenceBasis(slow, budget), 'dge');
    const fast = countingLoader({ syncServerUrl: null, nutrientReferenceBasis: 'efsa' });
    assert.equal(await readNutrientReferenceBasis(fast.load, answering(null)), 'efsa');
    assert.equal(fast.calls(), 1);
  });

  it('counts the server loader and the handshake against ONE budget, not one budget each', async () => {
    // Each step alone fits a 300 ms budget; the two together, 50 + 280 ms, do not. With a budget per step the
    // handshake's 'efsa' would arrive and win.
    const loader = lateLoader({ data: { syncServerUrl: SYNC_URL, nutrientReferenceBasis: 'us' }, delayMs: 50 });
    const deps: NutrientReferenceBasisDeps = {
      readInstance: () =>
        new Promise<InstanceDescriptor | null>((resolve) => {
          setTimeout(() => resolve(instanceWith('efsa')), 280);
        }),
      waitMs: 300,
    };
    // The server loader answered in time, so its basis stands for this load.
    assert.equal(await readNutrientReferenceBasis(loader, deps), 'us');
    // CONTROL: with room for both steps, the handshake's basis wins.
    forgetNutrientReferenceBasis();
    assert.equal(await readNutrientReferenceBasis(loader, { ...deps, waitMs: 1000 }), 'efsa');
  });

  it('answers the default basis offline, and remembers nothing', async () => {
    setOnline(false);
    assert.equal(
      await readNutrientReferenceBasis(offlineLoader, answering(instanceWith('efsa'))),
      DEFAULT_NUTRIENT_REFERENCE_BASIS,
    );
    assert.equal(DEFAULT_NUTRIENT_REFERENCE_BASIS, 'dge');
    // CONTROL: back online, the real answer arrives, so the default was not kept.
    setOnline(true);
    const loader = countingLoader({ syncServerUrl: null, nutrientReferenceBasis: 'efsa' });
    assert.equal(await readNutrientReferenceBasis(loader.load, answering(null)), 'efsa');
  });

  it('rethrows a loader fault that is not the network', async () => {
    await assert.rejects(readNutrientReferenceBasis(faultyLoader, answering(null)), /loader bug/);
  });
});

describe('readRememberedNutrientReferenceBasis', () => {
  it('answers the default basis before any load settled one', () => {
    assert.equal(readRememberedNutrientReferenceBasis(), DEFAULT_NUTRIENT_REFERENCE_BASIS);
  });
});
