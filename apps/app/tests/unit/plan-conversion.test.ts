/**
 * The figures and rules behind the plan page's sales view (2026-11-02): the
 * multiple of the free scans, the saving, the recommended card, the meter and the
 * quota count that follows a scan.
 *
 * Every `null` has a control beside it that answers a figure, so a rule that said
 * nothing for everything would fail.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { PlanMeter } from '../../app/components/plans/plan-hero';
import { TierList } from '../../app/components/plans/tier-list';
import enCommon from '../../app/i18n/locales/en/common.json';
import { readQuotaCount, withQuotaCount, type AiQuota } from '../../app/lib/plans/ai-quota';
import { FEATURE_LABELS, FEATURES_WITH_SCREEN } from '../../app/lib/plans/capabilities';
import { heroMeterOf, meterPercent, type HeroMeter } from '../../app/lib/plans/plan-meter';
import { canMoveUp, NO_OWN_PLAN, scanMultipleOf, tiersViewOf, type OwnPlan } from '../../app/lib/plans/tier-view';
import { planOfferSchema, type PlanOffer } from '../../app/lib/sync/engine/client/plans-wire';
import fixtureTiers from '../fixtures/plan-offer-tiers.json';

const NOW = new Date('2026-11-02T12:00:00.000Z');
const NEXT_WEEK = '2026-11-09T00:00:00.000Z';
const LAST_WEEK = '2026-11-01T00:00:00.000Z';

/** The neutral offer with the middle tier recommended, through the real decoder. */
function offerWithFlag(flag: boolean | string = true): PlanOffer {
  const tiers = fixtureTiers.tiers.map((tier) => (tier.id === 'fixture-beta' ? { ...tier, recommended: flag } : tier));
  return planOfferSchema.parse({ ...fixtureTiers, tiers });
}

const OFFER_NO_FLAG = planOfferSchema.parse(fixtureTiers);

function onTier(tierId: string, overrides: Partial<OwnPlan> = {}): OwnPlan {
  return { tierId, planKey: 'monthly', isPastDue: false, ...overrides };
}

function rowsOf(offer: PlanOffer, own: OwnPlan = NO_OWN_PLAN) {
  const view = tiersViewOf({ offer, own });
  assert.ok(view !== null, 'the fixture sells tiers');
  return view.rows;
}

function recommendedIds(offer: PlanOffer, own: OwnPlan = NO_OWN_PLAN): string[] {
  return rowsOf(offer, own)
    .filter((row) => row.isRecommended)
    .map((row) => row.id);
}

function week(limit: number | null) {
  return { limit, period: 'week' as const };
}

describe('the multiple of the free scans', () => {
  it('is the exact ratio when it is whole', () => {
    assert.equal(scanMultipleOf({ tier: week(40), free: week(10) }), 4);
  });

  it('rounds DOWN to one decimal, so it never flatters', () => {
    assert.equal(scanMultipleOf({ tier: week(50), free: week(3) }), 16.6);
    assert.equal(scanMultipleOf({ tier: week(11), free: week(10) }), 1.1);
  });

  it('says nothing when it cannot be said truly', () => {
    const cases = [
      ['no free entry', { tier: week(40), free: null }],
      ['a free entry with no scans', { tier: week(40), free: week(0) }],
      ['a free entry with no stated limit', { tier: week(40), free: week(null) }],
      ['a tier with no stated limit', { tier: week(null), free: week(10) }],
      ['no gain', { tier: week(10), free: week(10) }],
      ['less than free', { tier: week(5), free: week(10) }],
      ['two windows', { tier: { limit: 40, period: 'day' as const }, free: week(10) }],
    ] as const;
    for (const [name, input] of cases) assert.equal(scanMultipleOf(input), null, name);
  });

  it('reaches the row, and the free entry has none', () => {
    const rows = rowsOf(OFFER_NO_FLAG);
    assert.deepEqual(
      rows.map((row) => [row.id, row.scanMultiple]),
      [
        ['fixture-zero', null],
        ['fixture-alpha', 3.3],
        ['fixture-beta', 8.3],
        ['fixture-gamma', 16.6],
      ],
    );
  });
});

describe('the saving and the prices on a row', () => {
  it('compares twelve monthly payments, rounded down', () => {
    const rows = rowsOf(OFFER_NO_FLAG);
    // 299 x 12 = 3588 against 1499: 58.2 percent.
    assert.equal(rows.find((row) => row.id === 'fixture-alpha')?.yearlySaving, 58);
  });

  it('says nothing for a tier with no monthly plan to compare with', () => {
    const tiers = fixtureTiers.tiers.map((tier) =>
      tier.id === 'fixture-alpha' ? { ...tier, plans: tier.plans.filter((plan) => plan.key === 'yearly') } : tier,
    );
    const rows = rowsOf(planOfferSchema.parse({ ...fixtureTiers, tiers }));
    assert.equal(rows.find((row) => row.id === 'fixture-alpha')?.yearlySaving, null);
    // THE CONTROL: its neighbour still has one.
    assert.notEqual(rows.find((row) => row.id === 'fixture-beta')?.yearlySaving, null);
  });

  it('names a subscriber\'s own prices although they can order nothing there', () => {
    const own = rowsOf(OFFER_NO_FLAG, onTier('fixture-beta', { planKey: 'yearly' })).find((row) => row.id === 'fixture-beta');
    assert.deepEqual(own?.plans, []);
    assert.deepEqual(
      own?.prices.map((plan) => plan.key),
      ['monthly', 'yearly'],
    );
  });
});

describe('the recommended card', () => {
  it('follows the biller, on the one tier it names', () => {
    assert.deepEqual(recommendedIds(offerWithFlag()), ['fixture-beta']);
  });

  it('control: an offer without the flag highlights nothing', () => {
    assert.deepEqual(recommendedIds(OFFER_NO_FLAG), []);
  });

  it('reads anything but exactly true as absent, and keeps the offer', () => {
    assert.deepEqual(recommendedIds(offerWithFlag('yes')), []);
    assert.deepEqual(recommendedIds(offerWithFlag(false)), []);
  });

  it('is shown to a subscriber below it, and not to one on it or above it', () => {
    assert.deepEqual(recommendedIds(offerWithFlag(), onTier('fixture-alpha')), ['fixture-beta']);
    assert.deepEqual(recommendedIds(offerWithFlag(), onTier('fixture-beta')), []);
    assert.deepEqual(recommendedIds(offerWithFlag(), onTier('fixture-gamma')), []);
  });
});

describe('moving up, for the limit line', () => {
  it('is open below the top tier and shut on it', () => {
    assert.equal(canMoveUp({ offer: OFFER_NO_FLAG, own: onTier('fixture-alpha') }), true);
    assert.equal(canMoveUp({ offer: OFFER_NO_FLAG, own: onTier('fixture-gamma') }), false);
  });

  it('fails closed on everything unknown', () => {
    const noTiers = planOfferSchema.parse({ ...fixtureTiers, tiers: undefined, plans: fixtureTiers.tiers[1]?.plans });
    assert.equal(canMoveUp({ offer: noTiers, own: onTier('fixture-alpha') }), false, 'no tiers');
    assert.equal(canMoveUp({ offer: OFFER_NO_FLAG, own: onTier('fixture-gone') }), false, 'a tier the offer does not list');
    assert.equal(canMoveUp({ offer: OFFER_NO_FLAG, own: onTier('fixture-alpha', { isPastDue: true }) }), false, 'overdue');
    assert.equal(canMoveUp({ offer: OFFER_NO_FLAG, own: NO_OWN_PLAN }), false, 'a subscriber with no tier');
  });
});

describe('the features with a screen', () => {
  it('are known to the gate, and leave out voice and chat', () => {
    for (const feature of FEATURES_WITH_SCREEN) assert.ok(FEATURE_LABELS.includes(feature));
    const drawn: readonly string[] = FEATURES_WITH_SCREEN;
    assert.ok(!drawn.includes('voice') && !drawn.includes('chat'));
    // THE CONTROL: the gate itself keeps them.
    assert.ok(FEATURE_LABELS.includes('voice') && FEATURE_LABELS.includes('chat'));
  });
});

function renderList(offer: PlanOffer, pickedTierId: string | null = null): string {
  const view = tiersViewOf({ offer, own: NO_OWN_PLAN });
  assert.ok(view !== null);
  return renderToStaticMarkup(
    withI18n(createElement(TierList, { rows: view.rows, pickedTierId, canPick: true, onPick: () => undefined })),
  );
}

describe('the tier list as drawn', () => {
  it('never writes voice or chat on a card', () => {
    const markup = renderList(OFFER_NO_FLAG);
    assert.ok(!markup.includes(enCommon.featureGate.names.voice));
    assert.ok(!markup.includes(enCommon.featureGate.names.chat));
    // THE CONTROL: the features that have a screen are drawn.
    assert.ok(markup.includes(enCommon.featureGate.names.pantry));
    assert.ok(markup.includes(enCommon.featureGate.names.fasting));
  });

  it('draws the badge and only with the flag', () => {
    assert.ok(renderList(offerWithFlag()).includes(enCommon.plan.tiers.recommended));
    assert.ok(!renderList(OFFER_NO_FLAG).includes(enCommon.plan.tiers.recommended));
  });

  it('never claims popularity', () => {
    assert.ok(!/popular/iu.test(JSON.stringify(enCommon.plan.tiers)));
  });

  it('keeps the radio for a first order, and a pick says so in words', () => {
    const name = fixtureTiers.tiers[2]?.name ?? '';
    const before = renderList(OFFER_NO_FLAG);
    assert.ok(before.includes(enCommon.plan.tiers.choose.replace('{{name}}', name)));
    assert.ok(!before.includes(enCommon.plan.tiers.chosen.replace('{{name}}', name)));
    const after = renderList(OFFER_NO_FLAG, 'fixture-beta');
    assert.ok(after.includes(enCommon.plan.tiers.chosen.replace('{{name}}', name)));
    assert.equal([...after.matchAll(/type="radio"/g)].length, 3);
  });
});

describe('the meter', () => {
  const quota = (overrides: Partial<AiQuota> = {}): AiQuota => ({
    limit: 10,
    period: 'week',
    used: 7,
    resetsAt: NEXT_WEEK,
    ...overrides,
  });
  const free = { kind: 'free', dailyLimit: 10 } as const;
  const scanTrial = { kind: 'trial', basis: 'scans', scansLeft: 7, scansGranted: 10, endsAt: null } as const;

  it('reads the real window for a free person', () => {
    assert.deepEqual(heroMeterOf({ standing: free, trialScans: null, quota: quota(), now: NOW }), {
      basis: 'week',
      used: 7,
      limit: 10,
      resetsAt: NEXT_WEEK,
    });
  });

  it('draws nothing with no quota read, and invents nothing', () => {
    assert.equal(heroMeterOf({ standing: free, trialScans: null, quota: null, now: NOW }), null);
    assert.equal(heroMeterOf({ standing: free, trialScans: null, quota: undefined, now: NOW }), null);
  });

  it('draws nothing for a window that has ended', () => {
    assert.equal(heroMeterOf({ standing: free, trialScans: null, quota: quota({ resetsAt: LAST_WEEK }), now: NOW }), null);
  });

  it('counts a scan trial by its scans, never by the burst limit in aiQuota', () => {
    const meter = heroMeterOf({
      standing: scanTrial,
      trialScans: { granted: 10, left: 7 },
      quota: quota({ limit: 200, period: 'day', used: 3 }),
      now: NOW,
    });
    assert.deepEqual(meter, { basis: 'trial-scans', used: 3, limit: 10, resetsAt: null });
  });

  it('shows a trial spent on its scans as full, and one that ended on its days by the window', () => {
    const spent = { kind: 'trial-ended', basis: 'scans', endedBy: 'scans', endedAt: null } as const;
    assert.deepEqual(heroMeterOf({ standing: spent, trialScans: { granted: 10, left: 0 }, quota: null, now: NOW }), {
      basis: 'trial-scans',
      used: 10,
      limit: 10,
      resetsAt: null,
    });
    const byDays = { kind: 'trial-ended', basis: 'scans', endedBy: 'days', endedAt: LAST_WEEK } as const;
    assert.equal(heroMeterOf({ standing: byDays, trialScans: { granted: 10, left: 4 }, quota: null, now: NOW }), null);
  });

  it('never says more than all of it', () => {
    assert.equal(heroMeterOf({ standing: free, trialScans: null, quota: quota({ used: 15 }), now: NOW })?.used, 10);
    assert.equal(meterPercent({ used: 15, limit: 10 }), 100);
    assert.equal(meterPercent({ used: 7, limit: 10 }), 70);
    assert.equal(meterPercent({ used: 0, limit: 10 }), 0);
    assert.equal(meterPercent({ used: 1, limit: 0 }), 0);
  });

  it('renders its sentence and a bar, and with no meter keeps the same box empty', () => {
    const meter: HeroMeter = { basis: 'week', used: 7, limit: 10, resetsAt: NEXT_WEEK };
    const read = renderToStaticMarkup(withI18n(createElement(PlanMeter, { meter })));
    assert.ok(read.includes('7 of 10'), read);
    assert.ok(read.includes('role="progressbar"'));
    assert.ok(read.includes('width:70%'));
    const empty = renderToStaticMarkup(withI18n(createElement(PlanMeter, { meter: null })));
    assert.ok(empty.includes('data-state="empty"'));
    assert.ok(empty.includes('invisible'));
    assert.ok(!empty.includes('role="progressbar"'));
    assert.ok(!/\d of \d/u.test(empty));
  });
});

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe('the quota count on a proxy answer', () => {
  const QUOTA: AiQuota = { limit: 10, period: 'week', used: 3, resetsAt: NEXT_WEEK };

  it('reads both headers', () => {
    assert.deepEqual(readQuotaCount(headers({ 'X-Quota-Used': '10', 'X-Quota-Limit': '10' })), { used: 10, limit: 10 });
  });

  it('says nothing for one header, none or a malformed one', () => {
    assert.equal(readQuotaCount(headers({})), null);
    assert.equal(readQuotaCount(headers({ 'X-Quota-Used': '10' })), null);
    assert.equal(readQuotaCount(headers({ 'X-Quota-Used': 'lots', 'X-Quota-Limit': '10' })), null);
    assert.equal(readQuotaCount(headers({ 'X-Quota-Used': '-1', 'X-Quota-Limit': '10' })), null);
  });

  it('moves the count of the same grant', () => {
    assert.equal(withQuotaCount({ quota: QUOTA, count: { used: 10, limit: 10 }, now: NOW }).used, 10);
  });

  it('leaves another grant and an ended window for the next account read', () => {
    assert.equal(withQuotaCount({ quota: QUOTA, count: { used: 10, limit: 40 }, now: NOW }), QUOTA);
    const ended = { ...QUOTA, resetsAt: LAST_WEEK };
    assert.equal(withQuotaCount({ quota: ended, count: { used: 1, limit: 10 }, now: NOW }), ended);
  });
});
