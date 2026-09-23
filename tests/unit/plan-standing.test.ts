/**
 * `planStanding`, every standing and the boundary of each (M250/01).
 *
 * Every case is paired with the case one step across its boundary, so a
 * function that answered the same standing for everything would fail half of
 * this file. The clock is fixed and passed in; nothing here reads the time.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { NO_PLANS, planStanding, type StandingAccount } from '../../app/lib/plans/plan-standing';
import type { InstanceDescriptor } from '../../app/lib/sync/engine/protocol';
import type { PlanView } from '../../app/lib/sync/engine/client/plans-wire';

const NOW = new Date('2026-09-23T12:00:00.000Z');
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** An ISO instant this many milliseconds away from {@link NOW}. */
function fromNow(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

const SELLING: InstanceDescriptor = {
  name: 'Example',
  language: 'de',
  mail: true,
  memberInvites: true,
  plans: true,
  ai: { model: 'fake/vision-1' },
};

const NOT_SELLING: InstanceDescriptor = { ...SELLING, plans: false };

/** The view the biller answers for somebody it holds no subscription for. */
const NO_SUBSCRIPTION: PlanView = {
  plan: 'none',
  planKey: null,
  interval: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  portalAvailable: false,
};

const YEARLY: PlanView = {
  plan: 'active',
  planKey: 'yearly',
  interval: 'year',
  currentPeriodEnd: fromNow(200 * DAY_MS),
  cancelAtPeriodEnd: false,
  portalAvailable: true,
};

/** A trial with three days to run, the M213/05 default. */
const IN_TRIAL: StandingAccount = { dailyAiLimit: 20, allowanceExpiresAt: fromNow(3 * DAY_MS) };

function standing(overrides: {
  instance?: InstanceDescriptor | null;
  account?: StandingAccount | null;
  planView?: PlanView | null;
}) {
  return planStanding({
    instance: overrides.instance === undefined ? SELLING : overrides.instance,
    account: overrides.account === undefined ? IN_TRIAL : overrides.account,
    planView: overrides.planView === undefined ? NO_SUBSCRIPTION : overrides.planView,
    now: NOW,
  });
}

describe('no plans', () => {
  it('sells nothing on an instance whose handshake says no biller stands behind it', () => {
    assert.deepEqual(standing({ instance: NOT_SELLING }), NO_PLANS);
    // THE CONTROL: the same person, on an instance that sells.
    assert.equal(standing({ instance: SELLING }).kind, 'trial');
  });

  it('sells nothing while the handshake is unread', () => {
    assert.deepEqual(standing({ instance: null }), NO_PLANS);
  });

  it('sells nothing while the plan is unread, even to a paying person', () => {
    // A paying person also has an allowance date ahead (the biller extends it
    // to the period end), so reading the allowance alone would draw a trial
    // countdown for them. Without the plan, the answer is nothing.
    assert.deepEqual(standing({ planView: null }), NO_PLANS);
    assert.equal(standing({ planView: YEARLY }).kind, 'subscribed');
  });

  it('sells nothing while the session or its account view is not read yet', () => {
    assert.deepEqual(standing({ account: null }), NO_PLANS);
    assert.deepEqual(standing({ account: { ...IN_TRIAL, dailyAiLimit: null } }), NO_PLANS);
    // THE CONTROL: the same account once its limit is known.
    assert.equal(standing({ account: IN_TRIAL }).kind, 'trial');
  });

  it('sells nothing to an open allowance with no end date', () => {
    assert.deepEqual(standing({ account: { dailyAiLimit: 20, allowanceExpiresAt: null } }), NO_PLANS);
  });
});

describe('trial', () => {
  it('counts whole days left, rounded up', () => {
    assert.deepEqual(standing({}), { kind: 'trial', endsAt: IN_TRIAL.allowanceExpiresAt, daysLeft: 3 });
    const longer = standing({ account: { ...IN_TRIAL, allowanceExpiresAt: fromNow(2 * DAY_MS + MINUTE_MS) } });
    assert.equal(longer.kind === 'trial' && longer.daysLeft, 3);
  });

  it('still reads one day in the last minute of a trial, never zero', () => {
    const lastMinute = standing({ account: { ...IN_TRIAL, allowanceExpiresAt: fromNow(MINUTE_MS) } });
    assert.equal(lastMinute.kind, 'trial');
    assert.equal(lastMinute.kind === 'trial' && lastMinute.daysLeft, 1);
  });

  it('reads the boundary instant itself as ended, the way the AI proxy does', () => {
    const endsNow = fromNow(0);
    assert.deepEqual(standing({ account: { ...IN_TRIAL, allowanceExpiresAt: endsNow } }), {
      kind: 'trial-ended',
      endedAt: endsNow,
    });
  });
});

describe('trial ended', () => {
  it('names the date that passed', () => {
    const ended = fromNow(-DAY_MS);
    assert.deepEqual(standing({ account: { dailyAiLimit: 20, allowanceExpiresAt: ended } }), {
      kind: 'trial-ended',
      endedAt: ended,
    });
  });

  it('carries no date for an account that never had an allowance', () => {
    assert.deepEqual(standing({ account: { dailyAiLimit: 0, allowanceExpiresAt: null } }), {
      kind: 'trial-ended',
      endedAt: null,
    });
  });

  it('reads a date ahead with no allowance as no trial, rather than counting down to nothing', () => {
    assert.deepEqual(standing({ account: { dailyAiLimit: 0, allowanceExpiresAt: fromNow(DAY_MS) } }), {
      kind: 'trial-ended',
      endedAt: null,
    });
  });

  it('treats an unparseable end date as no date', () => {
    assert.deepEqual(standing({ account: { dailyAiLimit: 20, allowanceExpiresAt: 'not a date' } }), NO_PLANS);
  });
});

describe('subscribed', () => {
  it('reads a live yearly plan with its key, interval and renewal', () => {
    assert.deepEqual(standing({ planView: YEARLY }), {
      kind: 'subscribed',
      planKey: 'yearly',
      interval: 'year',
      periodEnd: YEARLY.currentPeriodEnd,
      renews: true,
      isPastDue: false,
    });
  });

  it('asks the plan before the allowance, so a paying person never reads as a trial', () => {
    // The allowance alone says "trial, 3 days". The plan says otherwise, and wins.
    assert.equal(standing({ planView: YEARLY, account: IN_TRIAL }).kind, 'subscribed');
  });

  it('still reads subscribed on the day a cancelled subscription ends', () => {
    const endsToday = { ...YEARLY, cancelAtPeriodEnd: true, currentPeriodEnd: fromNow(60 * MINUTE_MS) };
    const today = standing({ planView: endsToday });
    assert.equal(today.kind, 'subscribed');
    assert.equal(today.kind === 'subscribed' && today.renews, false);
    // THE CONTROL: the same subscription not cancelled renews.
    const renewing = standing({ planView: { ...endsToday, cancelAtPeriodEnd: false } });
    assert.equal(renewing.kind === 'subscribed' && renewing.renews, true);
  });

  it('keeps a failed payment subscribed, and says so', () => {
    const pastDue = standing({ planView: { ...YEARLY, plan: 'past_due' } });
    assert.equal(pastDue.kind === 'subscribed' && pastDue.isPastDue, true);
    // THE CONTROL: the same plan, paid, is not past due.
    const paid = standing({ planView: YEARLY });
    assert.equal(paid.kind === 'subscribed' && paid.isPastDue, false);
  });

  it('counts a Stripe trial as a subscription, because payment details are on file', () => {
    assert.equal(standing({ planView: { ...YEARLY, plan: 'trialing' } }).kind, 'subscribed');
  });

  it('keeps a plan the biller could not name, rather than dropping the person', () => {
    const unnamed = standing({ planView: { ...YEARLY, planKey: null, interval: null } });
    assert.equal(unnamed.kind === 'subscribed' && unnamed.planKey, null);
  });

  it('does not need the account view, so the plan page never flickers to an order form', () => {
    assert.equal(standing({ planView: YEARLY, account: null }).kind, 'subscribed');
  });
});

describe('lapsed', () => {
  it('reads a subscription that is over as lapsed, whatever the allowance still says', () => {
    const over: PlanView = { ...YEARLY, plan: 'canceled', currentPeriodEnd: fromNow(-DAY_MS) };
    assert.deepEqual(standing({ planView: over }), { kind: 'lapsed' });
    // The grace allowance can still be running after a cancellation; the
    // status decides, so this is not a trial.
    assert.deepEqual(standing({ planView: over, account: IN_TRIAL }), { kind: 'lapsed' });
  });

  it('is told apart from a person who never subscribed', () => {
    // THE CONTROL for the case above: same account, no subscription ever.
    assert.equal(standing({ planView: NO_SUBSCRIPTION, account: IN_TRIAL }).kind, 'trial');
  });
});
