/**
 * `resolvePlanGate`, every standing, every exempt path, and the boundary of
 * each (the SaaS paywall, 2026-09-28).
 *
 * Every paywall answer below is paired with an open answer that differs in one
 * input only: the standing, the door or the path. A gate that answered the
 * same thing for everybody fails half of this file, in either direction.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAN_GATE_EXEMPT_PATHS,
  hasFreeScansLeft,
  isPlanGateExempt,
  paywallNoticeFor,
  planGateStanding,
  resolvePlanGate,
  type PlanGateAccount,
} from '../../app/lib/plans/plan-gate';
import { PLAN_PAGE_HREF } from '../../app/lib/plans/plans-door';
import { NO_PLANS, type PlanStanding } from '../../app/lib/plans/plan-standing';
import type { InstanceDescriptor } from '../../app/lib/sync/engine/protocol';
import type { PlanView } from '../../app/lib/sync/engine/client/plans-wire';

const NOW = new Date('2026-09-28T12:00:00.000Z');

/** Every standing a person can be in, one of each shape `planStanding` answers. */
const STANDINGS = {
  noPlans: NO_PLANS,
  trialDays: { kind: 'trial', basis: 'days', endsAt: '2026-10-01T12:00:00.000Z', daysLeft: 3 },
  trialScans: { kind: 'trial', basis: 'scans', scansLeft: 4, scansGranted: 10, endsAt: null },
  // M267: the free tier with its day limit still running.
  trialScansAndDays: {
    kind: 'trial',
    basis: 'scans',
    scansLeft: 4,
    scansGranted: 10,
    endsAt: '2026-10-05T12:00:00.000Z',
  },
  trialEndedOnADate: { kind: 'trial-ended', basis: 'days', endedAt: '2026-09-20T12:00:00.000Z' },
  trialEndedNoAllowance: { kind: 'trial-ended', basis: 'days', endedAt: null },
  trialEndedScans: { kind: 'trial-ended', basis: 'scans', endedBy: 'scans', endedAt: null },
  // M267: the free tier's fourteen days are over, with scans still left.
  trialEndedDays: { kind: 'trial-ended', basis: 'scans', endedBy: 'days', endedAt: '2026-09-27T12:00:00.000Z' },
  subscribed: {
    kind: 'subscribed',
    planKey: 'monthly',
    interval: 'month',
    periodEnd: '2026-10-28T12:00:00.000Z',
    renews: true,
    isPastDue: false,
  },
  subscribedNotRenewing: {
    kind: 'subscribed',
    planKey: 'yearly',
    interval: 'year',
    periodEnd: '2026-10-28T12:00:00.000Z',
    renews: false,
    isPastDue: false,
  },
  subscribedPastDue: {
    kind: 'subscribed',
    planKey: 'monthly',
    interval: 'month',
    periodEnd: '2026-10-28T12:00:00.000Z',
    renews: true,
    isPastDue: true,
  },
  subscribedUnnamed: {
    kind: 'subscribed',
    planKey: null,
    interval: null,
    periodEnd: null,
    renews: true,
    isPastDue: false,
  },
  lapsed: { kind: 'lapsed' },
} satisfies Record<string, PlanStanding>;

/** The standings that lock the app, and the ones that never do. */
const LOCKING = [
  STANDINGS.trialEndedOnADate,
  STANDINGS.trialEndedNoAllowance,
  STANDINGS.trialEndedScans,
  STANDINGS.trialEndedDays,
  STANDINGS.lapsed,
];
const OPEN = [
  STANDINGS.noPlans,
  STANDINGS.trialDays,
  STANDINGS.trialScans,
  STANDINGS.trialScansAndDays,
  STANDINGS.subscribed,
  STANDINGS.subscribedNotRenewing,
  STANDINGS.subscribedPastDue,
  STANDINGS.subscribedUnnamed,
];

/** Feature screens: every one of them sends a locked person to the plan page. */
const GATED_PATHS = [
  '/dashboard',
  '/diary',
  '/diary/entry/abc123',
  '/add',
  '/add/photo',
  '/add/search',
  '/add/describe',
  '/trends',
  '/awards',
  '/foods',
  '/meals',
  '/pantry',
  '/pantry/recipes',
  '/nutrients',
  '/fasting',
  '/catch-up',
  '/shared',
  '/shared/42',
  '/settings/ai',
  '/settings/profile',
  '/settings/nutrition',
  '/settings/fasting',
  '/settings/goals',
  '/settings/life-phase',
  '/settings/about',
  '/settings/whats-new',
];

/** The pages a locked person must still reach: the plan, the data, the account and the privacy switches. */
const EXEMPT_PATHS = [
  '/settings',
  '/settings/plan',
  '/settings/data',
  '/settings/account',
  '/settings/sync',
  '/settings/preferences',
  '/settings/notifications',
  '/settings/research',
  '/settings/sharing',
  // The one-time consent to health data (2026-09-28): never paid for, and
  // asked before the plan page.
  '/consent',
  '/admin',
  '/admin/invitations',
  '/admin/people/7',
  '/admin/feedback/3',
];

function gate(standing: PlanStanding, pathname: string, hasPlansDoor = true) {
  return resolvePlanGate({ hasPlansDoor, standing, pathname });
}

describe('resolvePlanGate: every standing on a feature screen', () => {
  for (const standing of LOCKING) {
    it(`sends ${describeStanding(standing)} to the plan page`, () => {
      assert.deepEqual(gate(standing, '/dashboard'), { kind: 'paywall', destination: PLAN_PAGE_HREF });
    });
  }

  for (const standing of OPEN) {
    it(`lets ${describeStanding(standing)} through`, () => {
      assert.deepEqual(gate(standing, '/dashboard'), { kind: 'open' });
    });
  }
});

describe('resolvePlanGate: an instance that sells nothing never locks', () => {
  // Beta and self-hosted instances answer `plans: false`, or nothing at all.
  // The same standings that lock above must pass here, on the same path.
  for (const standing of LOCKING) {
    it(`lets ${describeStanding(standing)} through with the door shut`, () => {
      assert.deepEqual(gate(standing, '/dashboard', false), { kind: 'open' });
    });
  }
});

describe('resolvePlanGate: every feature screen is gated', () => {
  for (const pathname of GATED_PATHS) {
    it(`locks ${pathname} for an ended trial, and opens it for a running one`, () => {
      assert.equal(gate(STANDINGS.trialEndedScans, pathname).kind, 'paywall');
      assert.equal(gate(STANDINGS.trialScans, pathname).kind, 'open');
    });
  }
});

describe('resolvePlanGate: the exempt pages stay open while locked', () => {
  for (const pathname of EXEMPT_PATHS) {
    it(`opens ${pathname} for every locking standing`, () => {
      for (const standing of LOCKING) assert.equal(gate(standing, pathname).kind, 'open', describeStanding(standing));
    });
  }

  it('lists exactly the exempt pages this file checks, so a new one is a decision', () => {
    assert.deepEqual(
      [...PLAN_GATE_EXEMPT_PATHS].toSorted(),
      EXEMPT_PATHS.filter((path) => !path.startsWith('/admin')).toSorted(),
    );
  });

  it('exempts its own destination, so the redirect can never loop', () => {
    for (const standing of LOCKING) assert.equal(gate(standing, PLAN_PAGE_HREF).kind, 'open');
  });
});

describe('isPlanGateExempt: the boundaries', () => {
  it('reads a trailing slash as the same page', () => {
    assert.equal(isPlanGateExempt('/settings/plan/'), true);
    assert.equal(isPlanGateExempt('/settings/data//'), true);
    assert.equal(isPlanGateExempt('/settings/'), true);
    assert.equal(isPlanGateExempt('/admin/'), true);
  });

  it('reads the path without regard to case, as the router matches it', () => {
    assert.equal(isPlanGateExempt('/Settings/Data'), true);
    assert.equal(isPlanGateExempt('/ADMIN/people/7'), true);
  });

  it('never exempts a page that merely starts with an exempt name', () => {
    for (const pathname of [
      '/settings/plans',
      '/settings/planx',
      '/settings/data-export',
      '/settings-plan',
      '/administer',
      '/admin-tools',
    ]) {
      assert.equal(isPlanGateExempt(pathname), false, pathname);
    }
  });

  it('does not open a page below an exact exempt page', () => {
    // `/settings` is exempt as the hub; the pages under it are decided one by one.
    assert.equal(isPlanGateExempt('/settings/ai'), false);
    assert.equal(isPlanGateExempt('/settings/data/extra'), false);
  });

  it('gates the root and an empty path, which no exempt page is', () => {
    assert.equal(isPlanGateExempt('/'), false);
    assert.equal(isPlanGateExempt(''), false);
  });
});

/** An instance whose handshake says a biller stands behind it. */
const SELLING: InstanceDescriptor = {
  name: 'Example',
  language: 'de',
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

/** An account with no AI at all, the shape an invited member with no allowance has. */
const NO_ALLOWANCE: PlanGateAccount = { role: 'member', dailyAiLimit: 0, allowanceExpiresAt: null, trialScans: null };

describe('planGateStanding: an administrator is never locked', () => {
  it('answers no plans for an administrator whose facts would lock a member', () => {
    const admin = planGateStanding({
      instance: SELLING,
      account: { ...NO_ALLOWANCE, role: 'admin' },
      planView: NO_SUBSCRIPTION,
      now: NOW,
    });
    assert.deepEqual(admin, NO_PLANS);
  });

  it('CONTROL: the same facts on a member are an ended trial', () => {
    const member = planGateStanding({ instance: SELLING, account: NO_ALLOWANCE, planView: NO_SUBSCRIPTION, now: NOW });
    assert.equal(member.kind, 'trial-ended');
  });

  it('reads a role not yet read as a member, never as an administrator', () => {
    const unread = planGateStanding({
      instance: SELLING,
      account: { ...NO_ALLOWANCE, role: null },
      planView: NO_SUBSCRIPTION,
      now: NOW,
    });
    assert.equal(unread.kind, 'trial-ended');
  });

  it('answers no plans with no account at all, which fails open', () => {
    assert.deepEqual(
      planGateStanding({ instance: SELLING, account: null, planView: NO_SUBSCRIPTION, now: NOW }),
      NO_PLANS,
    );
  });
});

describe('paywallNoticeFor: the heading the plan page draws', () => {
  it('counts the free scans for a spent scan trial', () => {
    assert.deepEqual(paywallNoticeFor({ standing: STANDINGS.trialEndedScans, scansGranted: 10, trialDays: 14 }), {
      kind: 'scans-used',
      count: 10,
    });
  });

  it('counts the free days when the days ended the free tier (M267)', () => {
    assert.deepEqual(paywallNoticeFor({ standing: STANDINGS.trialEndedDays, scansGranted: 10, trialDays: 14 }), {
      kind: 'days-over',
      count: 14,
    });
    // THE NUMBER IS THE ONE HANDED IN, never a typed fourteen.
    assert.deepEqual(paywallNoticeFor({ standing: STANDINGS.trialEndedDays, scansGranted: 10, trialDays: 30 }), {
      kind: 'days-over',
      count: 30,
    });
  });

  it('never names the days for spent scans, nor the scans for days that ran out', () => {
    // THE CONTROLS for the two above: the same inputs, the other limit.
    const scans = paywallNoticeFor({ standing: STANDINGS.trialEndedScans, scansGranted: 10, trialDays: 14 });
    assert.equal(scans?.kind, 'scans-used');
    const days = paywallNoticeFor({ standing: STANDINGS.trialEndedDays, scansGranted: 10, trialDays: 14 });
    assert.equal(days?.kind, 'days-over');
  });

  it('falls back to the plain heading when no count is known, never a blank number', () => {
    assert.deepEqual(paywallNoticeFor({ standing: STANDINGS.trialEndedScans, scansGranted: null, trialDays: 14 }), {
      kind: 'choose',
    });
    assert.deepEqual(paywallNoticeFor({ standing: STANDINGS.trialEndedScans, scansGranted: 0, trialDays: 14 }), {
      kind: 'choose',
    });
    assert.deepEqual(paywallNoticeFor({ standing: STANDINGS.trialEndedDays, scansGranted: 10, trialDays: null }), {
      kind: 'choose',
    });
    assert.deepEqual(paywallNoticeFor({ standing: STANDINGS.trialEndedDays, scansGranted: 10, trialDays: 0 }), {
      kind: 'choose',
    });
  });

  it('asks for a plan when a dated trial ended or there never was an allowance', () => {
    assert.deepEqual(paywallNoticeFor({ standing: STANDINGS.trialEndedOnADate, scansGranted: 10, trialDays: 14 }), {
      kind: 'choose',
    });
    assert.deepEqual(
      paywallNoticeFor({ standing: STANDINGS.trialEndedNoAllowance, scansGranted: null, trialDays: 14 }),
      {
        kind: 'choose',
      },
    );
  });

  it('says the plan ended when a subscription lapsed', () => {
    assert.deepEqual(paywallNoticeFor({ standing: STANDINGS.lapsed, scansGranted: 10, trialDays: 14 }), {
      kind: 'lapsed',
    });
  });

  it('draws no notice for a standing that does not lock', () => {
    for (const standing of OPEN)
      assert.equal(paywallNoticeFor({ standing, scansGranted: 10, trialDays: 14 }), null, describeStanding(standing));
  });
});

describe('hasFreeScansLeft: the "use my free scans first" link', () => {
  it('is offered on a scan trial with scans left, with or without a day limit', () => {
    assert.equal(hasFreeScansLeft(STANDINGS.trialScans), true);
    assert.equal(hasFreeScansLeft(STANDINGS.trialScansAndDays), true);
  });

  it('is not offered on a dated trial, a spent trial, a plan or no plans', () => {
    for (const standing of [
      STANDINGS.trialDays,
      STANDINGS.trialEndedScans,
      STANDINGS.trialEndedDays,
      STANDINGS.subscribed,
      STANDINGS.noPlans,
      STANDINGS.lapsed,
    ]) {
      assert.equal(hasFreeScansLeft(standing), false, describeStanding(standing));
    }
  });
});

/** A test name for one standing. */
function describeStanding(standing: PlanStanding): string {
  if (standing.kind === 'subscribed') {
    return `subscribed (renews ${String(standing.renews)}, past due ${String(standing.isPastDue)}, plan ${standing.planKey ?? 'unnamed'})`;
  }
  if (standing.kind === 'trial-ended' && standing.basis === 'days') {
    return `trial-ended on days (${standing.endedAt === null ? 'no allowance' : 'dated'})`;
  }
  if (standing.kind === 'trial-ended') return `the free tier ended by its ${standing.endedBy}`;
  if (standing.kind === 'trial' && standing.basis === 'scans') {
    return `trial on scans${standing.endsAt === null ? '' : ' and days'}`;
  }
  if (standing.kind === 'trial') return `trial on ${standing.basis}`;
  return standing.kind;
}
