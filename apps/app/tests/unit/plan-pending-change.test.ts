/**
 * The booked downgrade on the plan page: what is known, and what the page may
 * say about it.
 *
 * Two pure functions carry the whole decision (`app/lib/plans/pending-change.ts`).
 * `pendingFactsOf` says WHAT is booked, from the plan read, from the order
 * answer that booked it, and from the press that took it back. `pendingChangeOf`
 * says whether the page can NAME it: a sentence about money needs the tier it
 * moves to, the tier the person keeps and a day, and it is left out rather than
 * guessed when any of the three is missing.
 *
 * Every claim has a control that differs in exactly one input.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { pendingChangeOf, pendingFactsOf } from '../../app/lib/plans/pending-change';
import { tiersViewOf } from '../../app/lib/plans/tier-view';
import { planOfferSchema, planViewSchema } from '../../app/lib/sync/engine/client/plans-wire';
import fixtureTiers from '../fixtures/plan-offer-tiers.json';

const AT = '2026-10-09T00:00:00.000Z';

const VIEW = planViewSchema.parse({
  plan: 'active',
  planKey: 'monthly',
  interval: 'month',
  currentPeriodEnd: AT,
  cancelAtPeriodEnd: false,
  portalAvailable: true,
  tier: 'fixture-gamma',
});

const BOOKED_VIEW = planViewSchema.parse({ ...VIEW, pendingTier: 'fixture-alpha', pendingChangeAt: AT });

const OFFER = planOfferSchema.parse(fixtureTiers);

/** The tier view of a reader on the named tier. */
function tiersFor(tierId: string) {
  const view = tiersViewOf({ offer: OFFER, own: { tierId, planKey: 'monthly', isPastDue: false } });
  assert.ok(view !== null);
  return view;
}

describe('pendingFactsOf, what is booked', () => {
  it('reads the pair off the plan view', () => {
    assert.deepEqual(pendingFactsOf({ planView: BOOKED_VIEW, booked: null, isCancelled: false }), {
      tierId: 'fixture-alpha',
      at: AT,
    });
  });

  it('CONTROL: a view with nothing booked, or with only half a pair, books nothing', () => {
    assert.equal(pendingFactsOf({ planView: VIEW, booked: null, isCancelled: false }), null);
    const halfTier = planViewSchema.parse({ ...VIEW, pendingTier: 'fixture-alpha' });
    const halfDay = planViewSchema.parse({ ...VIEW, pendingChangeAt: AT });
    assert.equal(pendingFactsOf({ planView: halfTier, booked: null, isCancelled: false }), null);
    assert.equal(pendingFactsOf({ planView: halfDay, booked: null, isCancelled: false }), null);
    assert.equal(pendingFactsOf({ planView: null, booked: null, isCancelled: false }), null);
  });

  it('keeps what the order answer booked until a plan read says the same or more', () => {
    const booked = { tierId: 'fixture-alpha', at: AT };
    assert.deepEqual(pendingFactsOf({ planView: VIEW, booked, isCancelled: false }), booked);
    // THE CONTROL: the read, once it names a change, wins over the older answer.
    const other = planViewSchema.parse({ ...VIEW, pendingTier: 'fixture-beta', pendingChangeAt: AT });
    assert.equal(pendingFactsOf({ planView: other, booked, isCancelled: false })?.tierId, 'fixture-beta');
  });

  it('shows nothing once the person took the change back, whatever an older read still says', () => {
    assert.equal(pendingFactsOf({ planView: BOOKED_VIEW, booked: null, isCancelled: true }), null);
    // THE CONTROL: the same inputs, not taken back, show it.
    assert.notEqual(pendingFactsOf({ planView: BOOKED_VIEW, booked: null, isCancelled: false }), null);
  });
});

describe('pendingChangeOf, what the page can name', () => {
  const facts = { tierId: 'fixture-alpha', at: AT };

  it('names the tier it moves to, the tier the person keeps and the day, from the offer', () => {
    assert.deepEqual(pendingChangeOf({ facts, tiers: tiersFor('fixture-gamma') }), {
      tierName: 'Fixture Alpha',
      keepTierName: 'Fixture Gamma',
      at: AT,
    });
  });

  it('says nothing for what it cannot name: no facts, no offer, a tier the offer does not list', () => {
    assert.equal(pendingChangeOf({ facts: null, tiers: tiersFor('fixture-gamma') }), null);
    assert.equal(pendingChangeOf({ facts, tiers: null }), null);
    assert.equal(pendingChangeOf({ facts: { ...facts, tierId: 'no-such-tier' }, tiers: tiersFor('fixture-gamma') }), null);
    // The own tier is not in the list, so no row is current and "keep" has no name.
    assert.equal(pendingChangeOf({ facts, tiers: tiersFor('no-such-tier') }), null);
  });

  it('says nothing when the booked tier is the tier the person is on, because that is not a downgrade', () => {
    // A yearly switch on the own tier may carry the same id. "Switches to Gamma"
    // beside "Keep Gamma" would be a sentence that lies.
    assert.equal(pendingChangeOf({ facts: { ...facts, tierId: 'fixture-gamma' }, tiers: tiersFor('fixture-gamma') }), null);
  });
});
