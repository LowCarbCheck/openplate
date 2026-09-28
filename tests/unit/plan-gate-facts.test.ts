/**
 * The paywall's facts: read once per session, kept in memory, refreshed in the
 * background, and never a lock when they cannot be read.
 *
 * Every read goes through injected readers that count their calls, so "no
 * network wait" is a count of zero, not a guess about timing. The session is
 * injected too, so nothing here opens a vault.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAN_GATE_FACTS_TTL_MS,
  forgetPlanGateFacts,
  notePlanGateRenderedPath,
  peekPlanGateFacts,
  planGateAt,
  readPlanGateFacts,
  recordPlanGateView,
  refreshPlanGateFacts,
  requestPlanGateCheck,
  resolvePlanGateForNavigation,
  shouldCheckPlanGate,
  type PlanGateReaders,
  type PlanGateSession,
} from '../../app/lib/plans/plan-gate-facts';
import type { InstanceDescriptor } from '../../app/lib/sync/engine/protocol';
import type { PlanView } from '../../app/lib/sync/engine/client/plans-wire';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const SERVER_URL = 'https://core.example.test';

const SELLING: InstanceDescriptor = {
  name: 'Example',
  language: 'en',
  mail: true,
  memberInvites: true,
  plans: true,
  ai: { model: 'fake/vision-1' },
};

const NOT_SELLING: InstanceDescriptor = { ...SELLING, plans: false };

const NO_SUBSCRIPTION: PlanView = {
  plan: 'none',
  planKey: null,
  interval: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  portalAvailable: false,
};

const ACTIVE: PlanView = {
  plan: 'active',
  planKey: 'monthly',
  interval: 'month',
  currentPeriodEnd: '2026-10-28T12:00:00.000Z',
  cancelAtPeriodEnd: false,
  portalAvailable: true,
};

/** A member whose free scans are spent: locked on an instance that sells plans, with no subscription. */
const SPENT: PlanGateSession = {
  accountId: 7,
  serverUrl: SERVER_URL,
  account: { role: 'member', dailyAiLimit: 20, allowanceExpiresAt: null, trialScans: { granted: 10, left: 0 } },
};

/** The same account with scans left: open. */
const RUNNING: PlanGateSession = { ...SPENT, account: { ...SPENT.account, trialScans: { granted: 10, left: 4 } } };

/** Readers that answer what they are given, count every call, and can be held or made to fail. */
function countingReaders(answer: {
  instance?: InstanceDescriptor | null;
  planView?: PlanView | null;
  fail?: boolean;
  delayMs?: number;
}) {
  const calls = { instance: 0, planView: 0 };
  const wait = async () => {
    if (answer.delayMs !== undefined) await new Promise((settle) => setTimeout(settle, answer.delayMs));
  };
  const readers: PlanGateReaders = {
    readInstance: async () => {
      calls.instance += 1;
      await wait();
      return answer.instance === undefined ? SELLING : answer.instance;
    },
    readPlanView: async () => {
      calls.planView += 1;
      await wait();
      if (answer.fail === true) throw new Error('offline');
      return answer.planView === undefined ? NO_SUBSCRIPTION : answer.planView;
    },
  };
  return { readers, calls };
}

/** An instant this far after {@link NOW}. */
function later(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

afterEach(() => {
  forgetPlanGateFacts();
});

describe('the first read of a session', () => {
  it('waits for the facts, locks a spent trial, and caches them', async () => {
    const { readers, calls } = countingReaders({});
    const outcome = await resolvePlanGateForNavigation({ pathname: '/dashboard', now: NOW, session: SPENT, readers });
    assert.equal(outcome.kind, 'paywall');
    assert.deepEqual(calls, { instance: 1, planView: 1 });
    assert.equal(peekPlanGateFacts(SPENT)?.planView?.plan, 'none');
  });

  it('CONTROL: the same read opens for scans left', async () => {
    const { readers } = countingReaders({});
    const outcome = await resolvePlanGateForNavigation({ pathname: '/dashboard', now: NOW, session: RUNNING, readers });
    assert.equal(outcome.kind, 'open');
  });

  it('asks no network at all within the cache life, which is the whole point of the cache', async () => {
    const { readers, calls } = countingReaders({});
    await resolvePlanGateForNavigation({ pathname: '/dashboard', now: NOW, session: SPENT, readers });
    const second = await resolvePlanGateForNavigation({
      pathname: '/diary',
      now: later(PLAN_GATE_FACTS_TTL_MS - 1),
      session: SPENT,
      readers,
    });
    assert.equal(second.kind, 'paywall');
    assert.deepEqual(calls, { instance: 1, planView: 1 });
  });

  it('never asks for the plan on an instance that sells nothing, and opens', async () => {
    const { readers, calls } = countingReaders({ instance: NOT_SELLING });
    const outcome = await resolvePlanGateForNavigation({ pathname: '/dashboard', now: NOW, session: SPENT, readers });
    assert.equal(outcome.kind, 'open');
    assert.equal(calls.planView, 0);
  });

  it('opens on an unreadable handshake, which says no door', async () => {
    const { readers } = countingReaders({ instance: null });
    assert.equal(
      (await resolvePlanGateForNavigation({ pathname: '/dashboard', now: NOW, session: SPENT, readers })).kind,
      'open',
    );
  });

  it('opens when the biller answers no plan view', async () => {
    const { readers } = countingReaders({ planView: null });
    assert.equal(
      (await resolvePlanGateForNavigation({ pathname: '/dashboard', now: NOW, session: SPENT, readers })).kind,
      'open',
    );
  });
});

describe('failing open', () => {
  it('opens when the plan read fails, and remembers nothing', async () => {
    const { readers } = countingReaders({ fail: true });
    const outcome = await resolvePlanGateForNavigation({ pathname: '/dashboard', now: NOW, session: SPENT, readers });
    assert.equal(outcome.kind, 'open');
    assert.equal(peekPlanGateFacts(SPENT), null);
  });

  it('opens when the read outlasts the timeout, and keeps the answer once it lands', async () => {
    const { readers } = countingReaders({ delayMs: 60 });
    const outcome = await resolvePlanGateForNavigation({
      pathname: '/dashboard',
      now: NOW,
      session: SPENT,
      readers,
      timeoutMs: 10,
    });
    assert.equal(outcome.kind, 'open');
    assert.equal(peekPlanGateFacts(SPENT), null, 'the facts arrived before the timeout, so this proves nothing');
    // Two held hops, the door and then the plan, each 60 ms.
    await new Promise((settle) => setTimeout(settle, 250));
    assert.equal(planGateAt({ pathname: '/dashboard', now: NOW, session: SPENT }).kind, 'paywall');
  });

  it('opens with no session, and reads nothing', async () => {
    const { readers, calls } = countingReaders({});
    const outcome = await resolvePlanGateForNavigation({ pathname: '/dashboard', now: NOW, session: null, readers });
    assert.equal(outcome.kind, 'open');
    assert.deepEqual(calls, { instance: 0, planView: 0 });
  });

  it('opens an exempt page without reading anything', async () => {
    const { readers, calls } = countingReaders({});
    const outcome = await resolvePlanGateForNavigation({
      pathname: '/settings/data',
      now: NOW,
      session: SPENT,
      readers,
    });
    assert.equal(outcome.kind, 'open');
    assert.deepEqual(calls, { instance: 0, planView: 0 });
  });
});

describe('stale facts', () => {
  it('answer an open verdict at once and refresh behind it', async () => {
    const first = countingReaders({});
    await resolvePlanGateForNavigation({ pathname: '/dashboard', now: NOW, session: RUNNING, readers: first.readers });
    const second = countingReaders({ delayMs: 30 });
    const outcome = await resolvePlanGateForNavigation({
      pathname: '/dashboard',
      now: later(PLAN_GATE_FACTS_TTL_MS + 1),
      session: RUNNING,
      readers: second.readers,
      timeoutMs: 5,
    });
    assert.equal(outcome.kind, 'open');
    assert.equal(second.calls.instance, 1, 'no refresh was started behind the stale answer');
  });

  it('are read again before they lock anybody, so a plan bought elsewhere opens', async () => {
    const first = countingReaders({});
    await resolvePlanGateForNavigation({ pathname: '/dashboard', now: NOW, session: SPENT, readers: first.readers });
    const second = countingReaders({ planView: ACTIVE });
    const outcome = await resolvePlanGateForNavigation({
      pathname: '/dashboard',
      now: later(PLAN_GATE_FACTS_TTL_MS + 1),
      session: SPENT,
      readers: second.readers,
    });
    assert.equal(outcome.kind, 'open');
    assert.equal(second.calls.planView, 1);
  });

  it('CONTROL: a stale lock that is read again and still holds, still locks', async () => {
    const first = countingReaders({});
    await resolvePlanGateForNavigation({ pathname: '/dashboard', now: NOW, session: SPENT, readers: first.readers });
    const second = countingReaders({});
    const outcome = await resolvePlanGateForNavigation({
      pathname: '/dashboard',
      now: later(PLAN_GATE_FACTS_TTL_MS + 1),
      session: SPENT,
      readers: second.readers,
    });
    assert.equal(outcome.kind, 'paywall');
  });

  it('open when the refresh of a stale lock fails, because an offline device is not locked out', async () => {
    const first = countingReaders({});
    await resolvePlanGateForNavigation({ pathname: '/dashboard', now: NOW, session: SPENT, readers: first.readers });
    const offline = countingReaders({ fail: true });
    const outcome = await resolvePlanGateForNavigation({
      pathname: '/dashboard',
      now: later(PLAN_GATE_FACTS_TTL_MS + 1),
      session: SPENT,
      readers: offline.readers,
    });
    assert.equal(outcome.kind, 'open');
  });
});

describe('an offline device', () => {
  // The plan page reads the network before it draws, so a locked person sent
  // there offline would land on an error. Offline opens instead, as the core's
  // AI proxy still refuses what nobody paid for.
  it('opens a navigation even with fresh facts that lock, and reads nothing', async () => {
    const { readers, calls } = countingReaders({});
    await readPlanGateFacts({ accountId: SPENT.accountId, serverUrl: SERVER_URL, now: NOW, readers });
    const outcome = await resolvePlanGateForNavigation({
      pathname: '/dashboard',
      now: NOW,
      session: SPENT,
      readers,
      isOnline: false,
    });
    assert.equal(outcome.kind, 'open');
    assert.equal(planGateAt({ pathname: '/dashboard', now: NOW, session: SPENT, isOnline: false }).kind, 'open');
    assert.deepEqual(calls, { instance: 1, planView: 1 }, 'the offline navigation read again');
  });

  it('CONTROL: the same facts lock the same navigation online', async () => {
    const { readers } = countingReaders({});
    await readPlanGateFacts({ accountId: SPENT.accountId, serverUrl: SERVER_URL, now: NOW, readers });
    assert.equal(planGateAt({ pathname: '/dashboard', now: NOW, session: SPENT, isOnline: true }).kind, 'paywall');
    const outcome = await resolvePlanGateForNavigation({
      pathname: '/dashboard',
      now: NOW,
      session: SPENT,
      readers,
      isOnline: true,
    });
    assert.equal(outcome.kind, 'paywall');
  });
});

describe('the synchronous verdict a navigation reads', () => {
  it('is open before any facts exist', () => {
    assert.equal(planGateAt({ pathname: '/dashboard', now: NOW, session: SPENT }).kind, 'open');
  });

  it('reads the live account over the cached plan, so a spent last scan locks the next page', async () => {
    const { readers } = countingReaders({});
    await readPlanGateFacts({ accountId: RUNNING.accountId, serverUrl: SERVER_URL, now: NOW, readers });
    assert.equal(planGateAt({ pathname: '/diary', now: NOW, session: RUNNING }).kind, 'open');
    assert.equal(planGateAt({ pathname: '/diary', now: NOW, session: SPENT }).kind, 'paywall');
  });

  it('belongs to one account on one server', async () => {
    const { readers } = countingReaders({});
    await readPlanGateFacts({ accountId: SPENT.accountId, serverUrl: SERVER_URL, now: NOW, readers });
    assert.equal(planGateAt({ pathname: '/diary', now: NOW, session: { ...SPENT, accountId: 8 } }).kind, 'open');
    assert.equal(
      planGateAt({ pathname: '/diary', now: NOW, session: { ...SPENT, serverUrl: 'https://other.test' } }).kind,
      'open',
    );
  });
});

describe('what the plan page tells the gate', () => {
  it('opens the next navigation once the page reads an active plan', async () => {
    const { readers } = countingReaders({});
    await readPlanGateFacts({ accountId: SPENT.accountId, serverUrl: SERVER_URL, now: NOW, readers });
    recordPlanGateView({
      accountId: SPENT.accountId,
      serverUrl: SERVER_URL,
      instance: SELLING,
      planView: ACTIVE,
      readAt: later(1).getTime(),
    });
    assert.equal(planGateAt({ pathname: '/dashboard', now: NOW, session: SPENT }).kind, 'open');
  });

  it('keeps the newer read when an older one lands after it', async () => {
    recordPlanGateView({
      accountId: SPENT.accountId,
      serverUrl: SERVER_URL,
      instance: SELLING,
      planView: ACTIVE,
      readAt: later(10).getTime(),
    });
    const { readers } = countingReaders({});
    await readPlanGateFacts({ accountId: SPENT.accountId, serverUrl: SERVER_URL, now: NOW, readers });
    assert.equal(peekPlanGateFacts(SPENT)?.planView?.plan, 'active');
  });

  it('forgets everything when told the door shut, and a read in flight does not bring it back', async () => {
    const { readers } = countingReaders({ delayMs: 20 });
    const pending = readPlanGateFacts({ accountId: SPENT.accountId, serverUrl: SERVER_URL, now: NOW, readers });
    forgetPlanGateFacts();
    await pending;
    assert.equal(peekPlanGateFacts(SPENT), null);
  });
});

describe('the page already on screen', () => {
  // THE DEFECT this guards: the last free scan's own action revalidated the
  // layout on the same address, the count had just reached zero, and the
  // review of the plate the person had just scanned was replaced by the plan
  // page. A navigation is decided; the page on screen is left alone.
  afterEach(() => {
    notePlanGateRenderedPath(null);
  });

  it('is decided when it is a different page', () => {
    notePlanGateRenderedPath('/add/photo');
    assert.equal(shouldCheckPlanGate('/diary'), true);
  });

  it('is left alone when a load re-reads the page on screen', () => {
    notePlanGateRenderedPath('/add/photo');
    assert.equal(shouldCheckPlanGate('/add/photo'), false);
    assert.equal(shouldCheckPlanGate('/add/photo/'), false, 'a trailing slash is the same page');
  });

  it('is decided once when the layout asks, and left alone again after', () => {
    notePlanGateRenderedPath('/dashboard');
    requestPlanGateCheck();
    assert.equal(shouldCheckPlanGate('/dashboard'), true);
    assert.equal(shouldCheckPlanGate('/dashboard'), false);
  });

  it('is decided when nothing is on screen, a document load or a layout that unmounted', () => {
    notePlanGateRenderedPath(null);
    assert.equal(shouldCheckPlanGate('/diary'), true);
  });
});

describe('the background refresh', () => {
  it('reads nothing while the facts are fresh', async () => {
    const first = countingReaders({});
    await readPlanGateFacts({ accountId: SPENT.accountId, serverUrl: SERVER_URL, now: NOW, readers: first.readers });
    const second = countingReaders({});
    await refreshPlanGateFacts({ session: SPENT, now: later(1), readers: second.readers });
    assert.deepEqual(second.calls, { instance: 0, planView: 0 });
  });

  it('reads again once they are stale', async () => {
    const first = countingReaders({});
    await readPlanGateFacts({ accountId: SPENT.accountId, serverUrl: SERVER_URL, now: NOW, readers: first.readers });
    const second = countingReaders({ planView: ACTIVE });
    await refreshPlanGateFacts({ session: SPENT, now: later(PLAN_GATE_FACTS_TTL_MS + 1), readers: second.readers });
    assert.equal(second.calls.planView, 1);
    assert.equal(peekPlanGateFacts(SPENT)?.planView?.plan, 'active');
  });

  it('shares one read between two callers that ask at once', async () => {
    const { readers, calls } = countingReaders({ delayMs: 10 });
    await Promise.all([
      refreshPlanGateFacts({ session: SPENT, now: NOW, readers }),
      refreshPlanGateFacts({ session: SPENT, now: NOW, readers }),
    ]);
    assert.equal(calls.instance, 1);
  });
});
