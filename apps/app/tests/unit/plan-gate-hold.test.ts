/**
 * The paywall's marker for the next cold start (M265 spec 10).
 *
 * A locked person's cold start drew the diary until the session had reopened
 * and the plan was read. The marker is what lets the loader hold that start on
 * the boot splash WITHOUT holding everybody else's, so both halves are held
 * here: every standing that must hold does, and every standing that must not
 * hold does not.
 *
 * EVERY CASE HAS A CONTROL that changes one input and must get the other
 * answer, so no case can pass against a function that returns a constant.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { PlanGateAccount } from '../../app/lib/plans/plan-gate';
import type { PlanGateFacts } from '../../app/lib/plans/plan-gate-facts';
import {
  PLAN_GATE_HOLD_KEY,
  isStartHeldForPlanGate,
  planGateHoldFrom,
  readPlanGateHold,
  recordPlanGateHold,
  shouldHoldStartForPlanGate,
} from '../../app/lib/plans/plan-gate-hold';
import { createMemoryStorage } from '../../app/lib/sync/sync-state';
import type { InstanceDescriptor } from '../../app/lib/sync/engine/protocol';
import type { PlanView } from '../../app/lib/sync/engine/client/plans-wire';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const TOMORROW = '2026-09-29T12:00:00.000Z';
const YESTERDAY = '2026-09-27T12:00:00.000Z';

const SELLING: InstanceDescriptor = {
  name: 'Example',
  language: 'en',
  mail: true,
  memberInvites: true,
  plans: true,
  ai: { model: 'fake/vision-1' },
};

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
  currentPeriodEnd: TOMORROW,
  cancelAtPeriodEnd: false,
  portalAvailable: true,
};

/** A member whose ten free scans are spent: locked on an instance that sells plans. */
const SPENT: PlanGateAccount & { id: number } = {
  id: 7,
  role: 'member',
  dailyAiLimit: 20,
  allowanceExpiresAt: null,
  trialScans: { granted: 10, left: 0 },
};

/** The same member with scans left: open, and nothing on the clock will lock it. */
const RUNNING: PlanGateAccount & { id: number } = { ...SPENT, trialScans: { granted: 10, left: 4 } };

/** Facts the gate could hold for {@link SPENT}. */
function facts(overrides: Partial<PlanGateFacts> = {}): PlanGateFacts {
  return {
    accountId: SPENT.id,
    serverUrl: 'https://core.example.test',
    instance: SELLING,
    planView: NO_SUBSCRIPTION,
    readAt: NOW.getTime(),
    ...overrides,
  };
}

describe('planGateHoldFrom', () => {
  it('holds from now for a standing that locks', () => {
    assert.equal(
      planGateHoldFrom({ instance: SELLING, account: SPENT, planView: NO_SUBSCRIPTION, now: NOW }),
      NOW.getTime(),
    );
  });

  it('never holds for the same account with scans left', () => {
    // THE CONTROL: one field changed, and the answer is never.
    assert.equal(planGateHoldFrom({ instance: SELLING, account: RUNNING, planView: NO_SUBSCRIPTION, now: NOW }), null);
  });

  it('never holds on an instance that sells nothing, however the account stands', () => {
    assert.equal(
      planGateHoldFrom({ instance: { ...SELLING, plans: false }, account: SPENT, planView: NO_SUBSCRIPTION, now: NOW }),
      null,
    );
    assert.equal(planGateHoldFrom({ instance: null, account: SPENT, planView: NO_SUBSCRIPTION, now: NOW }), null);
  });

  it('never holds an administrator, whom the gate never locks', () => {
    assert.equal(
      planGateHoldFrom({
        instance: SELLING,
        account: { ...SPENT, role: 'admin' },
        planView: NO_SUBSCRIPTION,
        now: NOW,
      }),
      null,
    );
  });

  it('holds a day trial from the instant it ends', () => {
    const dayTrial = { ...SPENT, trialScans: null, allowanceExpiresAt: TOMORROW };
    assert.equal(
      planGateHoldFrom({ instance: SELLING, account: dayTrial, planView: NO_SUBSCRIPTION, now: NOW }),
      Date.parse(TOMORROW),
    );
    // THE CONTROL: the same trial after its end is locked, and holds from now.
    assert.equal(
      planGateHoldFrom({
        instance: SELLING,
        account: { ...dayTrial, allowanceExpiresAt: YESTERDAY },
        planView: NO_SUBSCRIPTION,
        now: NOW,
      }),
      NOW.getTime(),
    );
  });

  it('holds a free tier with a day limit from the instant its days end (M267)', () => {
    const freeTier = { ...RUNNING, trialEndsAt: TOMORROW };
    assert.equal(
      planGateHoldFrom({ instance: SELLING, account: freeTier, planView: NO_SUBSCRIPTION, now: NOW }),
      Date.parse(TOMORROW),
    );
    // THE CONTROLS: past its end it is locked and holds from now, and the
    // same free tier with no end date never holds.
    assert.equal(
      planGateHoldFrom({
        instance: SELLING,
        account: { ...freeTier, trialEndsAt: YESTERDAY },
        planView: NO_SUBSCRIPTION,
        now: NOW,
      }),
      NOW.getTime(),
    );
    assert.equal(
      planGateHoldFrom({
        instance: SELLING,
        account: { ...freeTier, trialEndsAt: null },
        planView: NO_SUBSCRIPTION,
        now: NOW,
      }),
      null,
    );
  });

  it('holds a subscription that will not renew from the end of its paid period', () => {
    const endingPlan = { ...ACTIVE, cancelAtPeriodEnd: true };
    assert.equal(
      planGateHoldFrom({ instance: SELLING, account: SPENT, planView: endingPlan, now: NOW }),
      Date.parse(TOMORROW),
    );
  });

  it('never holds a subscription that renews', () => {
    // THE CONTROL for the case above: the renewal is the only difference.
    assert.equal(planGateHoldFrom({ instance: SELLING, account: SPENT, planView: ACTIVE, now: NOW }), null);
  });

  it('holds a plan that lapsed from now', () => {
    assert.equal(
      planGateHoldFrom({
        instance: SELLING,
        account: SPENT,
        planView: { ...ACTIVE, plan: 'canceled', cancelAtPeriodEnd: true, currentPeriodEnd: YESTERDAY },
        now: NOW,
      }),
      NOW.getTime(),
    );
  });
});

describe('recordPlanGateHold', () => {
  it('writes the marker for a locked account, and removes it once the same account is open', () => {
    const storage = createMemoryStorage();
    recordPlanGateHold({ account: SPENT, held: facts(), now: NOW, storage });
    assert.equal(readPlanGateHold(storage), NOW.getTime());

    recordPlanGateHold({ account: RUNNING, held: facts(), now: NOW, storage });
    assert.equal(storage.getItem(PLAN_GATE_HOLD_KEY), null);
  });

  it('writes nothing from an account view that has not been read yet', () => {
    const storage = createMemoryStorage({ [PLAN_GATE_HOLD_KEY]: String(NOW.getTime()) });
    // Unread, the standing reads as no plans, and judging it would remove the
    // marker the next cold start needs.
    recordPlanGateHold({ account: { ...RUNNING, dailyAiLimit: null }, held: facts(), now: NOW, storage });
    assert.equal(readPlanGateHold(storage), NOW.getTime());
    // THE CONTROL: the same open account, read, removes it.
    recordPlanGateHold({ account: RUNNING, held: facts(), now: NOW, storage });
    assert.equal(readPlanGateHold(storage), null);
  });

  it('writes nothing from facts read for another account, or from none', () => {
    const storage = createMemoryStorage();
    recordPlanGateHold({ account: SPENT, held: facts({ accountId: 8 }), now: NOW, storage });
    recordPlanGateHold({ account: SPENT, held: null, now: NOW, storage });
    assert.equal(readPlanGateHold(storage), null);
    // THE CONTROL: this account's own facts write it.
    recordPlanGateHold({ account: SPENT, held: facts(), now: NOW, storage });
    assert.equal(readPlanGateHold(storage), NOW.getTime());
  });

  it('reads a marker that does not parse as none', () => {
    assert.equal(readPlanGateHold(createMemoryStorage({ [PLAN_GATE_HOLD_KEY]: 'soon' })), null);
    assert.equal(readPlanGateHold(createMemoryStorage({ [PLAN_GATE_HOLD_KEY]: '1759060800000' })), 1759060800000);
  });
});

/** A cold start of the diary on a device whose marker says it is locked. */
const HELD_START = {
  pathname: '/diary',
  isResuming: true,
  isOnline: true,
  holdFrom: NOW.getTime(),
  now: NOW,
} as const;

describe('isStartHeldForPlanGate', () => {
  it('holds a cold start of the diary on a device the paywall locked', () => {
    assert.equal(isStartHeldForPlanGate(HELD_START), true);
  });

  // Each row changes ONE input of the held start above, and must let it through.
  const CONTROLS = [
    { name: 'a session that has settled', change: { isResuming: false } },
    { name: 'an offline device, which the gate opens', change: { isOnline: false } },
    { name: 'the export, which is open to a locked person', change: { pathname: '/settings/data' } },
    { name: 'the plan page itself', change: { pathname: '/settings/plan' } },
    { name: 'a device with no marker', change: { holdFrom: null } },
    { name: 'a marker whose instant has not come', change: { holdFrom: Date.parse(TOMORROW) } },
  ] as const;

  for (const control of CONTROLS) {
    it(`does not hold ${control.name}`, () => {
      assert.equal(isStartHeldForPlanGate({ ...HELD_START, ...control.change }), false);
    });
  }

  it('holds the home screen too, a guarded page like the diary', () => {
    assert.equal(isStartHeldForPlanGate({ ...HELD_START, pathname: '/dashboard' }), true);
  });
});

describe('shouldHoldStartForPlanGate', () => {
  it('holds a marked start when a saved session is there to reopen', async () => {
    assert.equal(await shouldHoldStartForPlanGate({ ...HELD_START, hasSavedSession: async () => true }), true);
  });

  it('does not hold a device signed out since the marker was written', async () => {
    // THE CONTROL: the saved session is the only difference.
    assert.equal(await shouldHoldStartForPlanGate({ ...HELD_START, hasSavedSession: async () => false }), false);
  });

  it('never reads the saved session for a start that is not held', async () => {
    let reads = 0;
    const hasSavedSession = async (): Promise<boolean> => {
      reads += 1;
      return true;
    };
    assert.equal(await shouldHoldStartForPlanGate({ ...HELD_START, holdFrom: null, hasSavedSession }), false);
    assert.equal(reads, 0, 'an unheld start paid for an IndexedDB read');
    // THE CONTROL: a held start does read it, so the count above can move.
    await shouldHoldStartForPlanGate({ ...HELD_START, hasSavedSession });
    assert.equal(reads, 1);
  });
});
