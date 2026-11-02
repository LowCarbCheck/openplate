/**
 * The limit line's rules (2026-11-02): who sees it, what it costs to know, and
 * "closed for this window".
 *
 * Every refusal starts from {@link SHOWS}, a case that shows, and changes one
 * fact, so a rule that answered `null` for everything would fail the first test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeLimitRibbonForWindow,
  LIMIT_RIBBON_STORAGE_KEY,
  needsOfferRead,
  readLimitRibbonClosedWindow,
  resolveLimitRibbon,
  type LimitRibbonInput,
  type LimitRibbonStorage,
} from '../../app/lib/plans/limit-ribbon';
import type { PlanStanding } from '../../app/lib/plans/plan-standing';

const NOW = new Date('2026-11-02T12:00:00.000Z');
const NEXT_WEEK = '2026-11-09T00:00:00.000Z';

const SUBSCRIBED: PlanStanding = {
  kind: 'subscribed',
  planKey: 'monthly',
  interval: 'month',
  periodEnd: NEXT_WEEK,
  renews: true,
  isPastDue: false,
};

const SHOWS: LimitRibbonInput = {
  standing: { kind: 'free', dailyLimit: 10 },
  quota: { limit: 10, period: 'week', used: 10, resetsAt: NEXT_WEEK },
  isManagedAi: true,
  canMoveUp: false,
  closedWindow: null,
  pathname: '/diary',
  now: NOW,
};

function memoryStorage(): LimitRibbonStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const BROKEN_STORAGE: LimitRibbonStorage = {
  getItem: () => {
    throw new Error('storage is off');
  },
  setItem: () => {
    throw new Error('storage is full');
  },
};

describe('the limit line', () => {
  it('shows at the limit for a free person, and says the window and the figure', () => {
    assert.deepEqual(resolveLimitRibbon(SHOWS), { limit: 10, period: 'week', resetsAt: NEXT_WEEK });
  });

  it('shows past the limit and for a trial too', () => {
    assert.notEqual(resolveLimitRibbon({ ...SHOWS, quota: { limit: 10, period: 'day', used: 12, resetsAt: NEXT_WEEK } }), null);
    const trial: PlanStanding = { kind: 'trial', basis: 'days', endsAt: NEXT_WEEK, daysLeft: 7 };
    assert.notEqual(resolveLimitRibbon({ ...SHOWS, standing: trial }), null);
  });

  it('does not show below the limit', () => {
    assert.equal(resolveLimitRibbon({ ...SHOWS, quota: { limit: 10, period: 'week', used: 9, resetsAt: NEXT_WEEK } }), null);
  });

  it('does not show with no quota read', () => {
    assert.equal(resolveLimitRibbon({ ...SHOWS, quota: null }), null);
    assert.equal(resolveLimitRibbon({ ...SHOWS, quota: undefined }), null);
  });

  it('does not show for a window that has ended', () => {
    const quota = { limit: 10, period: 'week' as const, used: 10, resetsAt: '2026-11-02T11:59:59.000Z' };
    assert.equal(resolveLimitRibbon({ ...SHOWS, quota }), null);
  });

  it('does not show on somebody\'s own key, or where the instance supplies no AI', () => {
    assert.equal(resolveLimitRibbon({ ...SHOWS, isManagedAi: false }), null);
  });

  it('does not show on the plan page', () => {
    assert.equal(resolveLimitRibbon({ ...SHOWS, pathname: '/settings/plan' }), null);
    assert.equal(resolveLimitRibbon({ ...SHOWS, pathname: '/settings/plan/' }), null);
  });

  it('stays closed for that window, and comes back in the next', () => {
    assert.equal(resolveLimitRibbon({ ...SHOWS, closedWindow: NEXT_WEEK }), null);
    assert.notEqual(resolveLimitRibbon({ ...SHOWS, closedWindow: '2026-11-02T00:00:00.000Z' }), null);
  });

  it('leaves a locked standing to the lock screen, and no-plans to nobody', () => {
    const locked: PlanStanding[] = [
      { kind: 'lapsed' },
      { kind: 'trial-ended', basis: 'days', endedAt: null },
      { kind: 'trial-ended', basis: 'scans', endedBy: 'scans', endedAt: null },
      { kind: 'no-plans' },
    ];
    for (const standing of locked) assert.equal(resolveLimitRibbon({ ...SHOWS, standing, canMoveUp: true }), null, standing.kind);
  });

  it('shows a subscriber the line only when the offer says a higher tier can be bought', () => {
    assert.equal(resolveLimitRibbon({ ...SHOWS, standing: SUBSCRIBED, canMoveUp: false }), null);
    assert.notEqual(resolveLimitRibbon({ ...SHOWS, standing: SUBSCRIBED, canMoveUp: true }), null);
  });
});

describe('what the line costs to know', () => {
  const facts = (overrides: Partial<LimitRibbonInput>) => ({ ...SHOWS, ...overrides });

  it('reads the offer for a subscriber at the limit', () => {
    assert.equal(needsOfferRead(facts({ standing: SUBSCRIBED })), true);
  });

  it('reads nothing for everybody else', () => {
    assert.equal(needsOfferRead(SHOWS), false, 'a free person');
    const belowLimit = { limit: 10, period: 'week' as const, used: 9, resetsAt: NEXT_WEEK };
    assert.equal(needsOfferRead(facts({ standing: SUBSCRIBED, quota: belowLimit })), false, 'below the limit');
    assert.equal(needsOfferRead(facts({ standing: SUBSCRIBED, closedWindow: NEXT_WEEK })), false, 'closed');
    assert.equal(needsOfferRead(facts({ standing: SUBSCRIBED, pathname: '/settings/plan' })), false, 'the plan page');
    assert.equal(needsOfferRead(facts({ standing: SUBSCRIBED, isManagedAi: false })), false, 'an own key');
  });
});

describe('the closed window on this device', () => {
  it('reads what it wrote, under its own key', () => {
    const storage = memoryStorage();
    assert.equal(readLimitRibbonClosedWindow(storage), null);
    closeLimitRibbonForWindow({ storage, resetsAt: NEXT_WEEK });
    assert.equal(storage.data[LIMIT_RIBBON_STORAGE_KEY], NEXT_WEEK);
    assert.equal(readLimitRibbonClosedWindow(storage), NEXT_WEEK);
  });

  it('survives a storage that refuses', () => {
    assert.equal(readLimitRibbonClosedWindow(BROKEN_STORAGE), null);
    assert.doesNotThrow(() => closeLimitRibbonForWindow({ storage: BROKEN_STORAGE, resetsAt: NEXT_WEEK }));
  });
});
