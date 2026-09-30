/**
 * The kill switch worker moved mode serves at `/sw.js` (`app/lib/moved/kill-switch-worker.ts`),
 * run for real against a `self` that records every call it makes.
 *
 * WHAT IS HELD: install skips waiting; activate deletes every cache, claims the tabs, unregisters,
 * and only then navigates every tab to its own address; and there is no `fetch` listener, so
 * nothing is answered from a cache while it runs. The order is the point: a tab navigated before
 * the unregister would load through a worker again.
 *
 * THE CONTROLS. `problemsIn` is the whole judgement, and each control hands it the source with one
 * line changed, a missing unregister, a missing navigate, a navigate moved ahead of the
 * unregister, a fetch listener added, and watches it name exactly that problem. Each mutation is
 * checked to have changed the source, so a control whose search string drifted cannot pass by
 * running the real worker. The browser tier proves the same worker against the app's real one
 * (`tests/e2e/moved-instance.spec.ts`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { KILL_SWITCH_WORKER } from '../../app/lib/moved/kill-switch-worker';

/** What the worker hands `waitUntil` in both events. */
interface WaitableEvent {
  waitUntil: (promise: PromiseLike<void>) => void;
}

/** One open tab, as `clients.matchAll` hands it back. */
interface FakeTab {
  readonly url: string;
  navigate: (url: string) => Promise<void>;
}

/** The origin's caches before the worker runs: the app's three and the shared photo. */
const CACHE_NAMES = ['static-v6', 'pages-v6', 'images-v6', 'share-target'];

/** The tabs open on the origin. */
const TAB_URLS = ['https://beta.openplate.example/diary', 'https://beta.openplate.example/settings'];

/** Everything one run recorded. */
interface Run {
  /** Every call, in order, with `-- activate` between the two events. */
  readonly calls: readonly string[];
  /** The event types the worker listened for. */
  readonly listenerTypes: readonly string[];
}

/** Runs `source` as a service worker would: evaluate it, then install, then activate. */
async function runWorker(source: string): Promise<Run> {
  const calls: string[] = [];
  const listeners = new Map<string, (event: WaitableEvent) => void>();
  const tabs: FakeTab[] = TAB_URLS.map((url) => ({
    url,
    navigate: async (to: string) => {
      calls.push(`navigate ${to}`);
    },
  }));
  const context = {
    self: {
      addEventListener: (type: string, listener: (event: WaitableEvent) => void) => listeners.set(type, listener),
      skipWaiting: async () => {
        calls.push('skipWaiting');
      },
      clients: {
        claim: async () => {
          calls.push('claim');
        },
        matchAll: async (options: { type: string; includeUncontrolled: boolean }) => {
          calls.push(`matchAll ${options.type} includeUncontrolled=${String(options.includeUncontrolled)}`);
          return tabs;
        },
      },
      registration: {
        unregister: async () => {
          calls.push('unregister');
          return true;
        },
      },
    },
    caches: {
      keys: async () => [...CACHE_NAMES],
      delete: async (name: string) => {
        calls.push(`delete ${name}`);
        return true;
      },
    },
  };
  vm.runInNewContext(source, context);

  for (const type of ['install', 'activate']) {
    if (type === 'activate') calls.push('-- activate');
    const pending: PromiseLike<void>[] = [];
    listeners.get(type)?.({ waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
  }
  return { calls, listenerTypes: [...listeners.keys()] };
}

/** What is wrong with a run, in words. Empty for a worker that does its job. */
function problemsIn(run: Run): string[] {
  const problems: string[] = [];
  const at = (call: string): number => run.calls.indexOf(call);
  const activateAt = at('-- activate');
  const unregisterAt = at('unregister');

  const skipAt = at('skipWaiting');
  if (skipAt === -1 || skipAt > activateAt) problems.push('install does not skip waiting');

  for (const name of CACHE_NAMES) {
    const deleteAt = at(`delete ${name}`);
    if (deleteAt === -1) problems.push(`cache ${name} is not deleted`);
    else if (unregisterAt !== -1 && deleteAt > unregisterAt) problems.push(`cache ${name} is deleted after the unregister`);
  }

  const claimAt = at('claim');
  if (claimAt === -1) problems.push('the tabs are not claimed');
  if (unregisterAt === -1) problems.push('the worker does not unregister');
  if (!run.calls.includes('matchAll window includeUncontrolled=true')) {
    problems.push('the tabs are not listed with the uncontrolled ones');
  }

  for (const url of TAB_URLS) {
    const navigateAt = at(`navigate ${url}`);
    if (navigateAt === -1) problems.push(`the tab at ${url} is not reloaded`);
    else if (navigateAt < unregisterAt || navigateAt < claimAt) {
      problems.push(`the tab at ${url} is reloaded before the worker let go`);
    }
  }

  if (run.listenerTypes.includes('fetch')) problems.push('the worker answers fetches');
  return problems;
}

/** The source with one piece replaced, refusing a replacement that changed nothing. */
function mutate(options: { from: string; to: string }): string {
  const mutated = KILL_SWITCH_WORKER.replace(options.from, options.to);
  assert.notEqual(mutated, KILL_SWITCH_WORKER, `the control's search string "${options.from}" is not in the worker`);
  return mutated;
}

describe('the kill switch worker', () => {
  it('skips waiting, clears every cache, claims, unregisters, then reloads every tab', async () => {
    assert.deepEqual(problemsIn(await runWorker(KILL_SWITCH_WORKER)), []);
  });

  it('reloads each tab at its own address, once', async () => {
    const run = await runWorker(KILL_SWITCH_WORKER);
    assert.deepEqual(
      run.calls.filter((call) => call.startsWith('navigate ')),
      TAB_URLS.map((url) => `navigate ${url}`),
    );
  });

  it('listens for install and activate only', async () => {
    assert.deepEqual((await runWorker(KILL_SWITCH_WORKER)).listenerTypes, ['install', 'activate']);
  });
});

describe('the judgement, fed a broken worker (controls)', () => {
  it('names a worker that never unregisters', async () => {
    const source = mutate({ from: 'await self.registration.unregister();', to: '' });
    assert.ok(problemsIn(await runWorker(source)).includes('the worker does not unregister'));
  });

  it('names a worker that never reloads the tabs', async () => {
    const source = mutate({ from: 'tab.navigate(tab.url)', to: 'Promise.resolve()' });
    assert.ok(problemsIn(await runWorker(source)).includes(`the tab at ${TAB_URLS[0]} is not reloaded`));
  });

  it('names a worker that reloads the tabs before it unregisters', async () => {
    const source = mutate({
      from: 'await self.registration.unregister();',
      to: "await Promise.all((await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).map((tab) => tab.navigate(tab.url)));\n      await self.registration.unregister();",
    });
    assert.ok(problemsIn(await runWorker(source)).includes(`the tab at ${TAB_URLS[0]} is reloaded before the worker let go`));
  });

  it('names a worker that keeps a cache', async () => {
    const source = mutate({ from: 'names.map((name) => caches.delete(name))', to: 'names.slice(1).map((name) => caches.delete(name))' });
    assert.ok(problemsIn(await runWorker(source)).includes(`cache ${CACHE_NAMES[0]} is not deleted`));
  });

  it('names a worker that waits for its old tabs to close', async () => {
    const source = mutate({ from: 'event.waitUntil(self.skipWaiting());', to: '' });
    assert.ok(problemsIn(await runWorker(source)).includes('install does not skip waiting'));
  });

  it('names a worker that answers fetches', async () => {
    const source = `${KILL_SWITCH_WORKER}\nself.addEventListener('fetch', () => {});\n`;
    assert.ok(problemsIn(await runWorker(source)).includes('the worker answers fetches'));
  });
});
