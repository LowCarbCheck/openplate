/**
 * WHETHER THIS INSTANCE SELLS A PLAN, and the two things that answer depends
 * on being right about.
 *
 * The gate is asserted in both directions, because a gate that always opened
 * would put a payment page on every self-hoster's instance, and one that never
 * did would make the whole milestone unreachable.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  PLAN_PAGE_HREF,
  checkoutLocaleFor,
  hasPlansDoor,
  requirePlansDoor,
} from '../../app/lib/plans/plans-door';
import type { InstanceDescriptor } from '../../app/lib/sync/engine/protocol';

const INSTANCE: InstanceDescriptor = {
  name: 'Example',
  language: 'de',
  mail: true,
  memberInvites: true,
  plans: false,
  ai: { model: 'fake/vision-1' },
};

describe('the plans door', () => {
  it('is open only where the handshake says so', () => {
    assert.equal(hasPlansDoor({ ...INSTANCE, plans: true }), true);
    // THE CONTROL. Everything else about the instance is identical, so a
    // reader of a different field would fail here.
    assert.equal(hasPlansDoor({ ...INSTANCE, plans: false }), false);
  });

  it('treats an unread handshake as no door, never as a licence to sell', () => {
    assert.equal(hasPlansDoor(null), false);
  });

  it('answers the ordinary 404, exactly as the service does', () => {
    assert.doesNotThrow(() => requirePlansDoor({ ...INSTANCE, plans: true }));
    for (const instance of [{ ...INSTANCE, plans: false }, null]) {
      // The status is read off the caught value rather than matched by a
      // predicate, so the assertion says WHICH status it wants and a 500
      // would fail it.
      let caught: Response | null = null;
      try {
        requirePlansDoor(instance);
      } catch (error) {
        caught = error instanceof Response ? error : null;
      }
      assert.ok(caught !== null, 'no Response was thrown');
      assert.equal(caught.status, 404);
    }
  });

  it('is not a policy question, and did not become one', () => {
    // M212's README lists this as a non-goal and M213 spec 05 repeats it as a
    // decision: `InstancePolicy` answers questions about a MODE, and a freeze
    // test enforces that the mode is its only input. A `plans` fact in there
    // would have to be answered by a mode, which cannot be done: two managed
    // instances answer it differently.
    const policy = readFileSync(
      fileURLToPath(new URL('../../app/config/instance-policy.ts', import.meta.url)),
      'utf8',
    );
    assert.doesNotMatch(policy, /plans/i);
    // The control for that grep: the file really is the one that holds the
    // policy questions, so the assertion above is not passing on an empty
    // read.
    assert.match(policy, /aiComesFromTheInstance/);
  });
});

describe('the consent language a checkout is opened in', () => {
  it('matches the language the app is drawn in, where the biller holds a reviewed sentence', () => {
    assert.equal(checkoutLocaleFor('en'), 'en');
    assert.equal(checkoutLocaleFor('de'), 'de');
    assert.equal(checkoutLocaleFor('de-DE'), 'de');
    assert.equal(checkoutLocaleFor('en-GB'), 'en');
  });

  it('falls back to German rather than to nothing', () => {
    // The obligation is German law and the instance sells in Germany, so an
    // unknown language must not become an empty consent. Matches the biller's
    // own `DEFAULT_CONSENT_LOCALE`.
    for (const unknown of ['fr', 'pt-BR', '', 'nonsense']) {
      assert.equal(checkoutLocaleFor(unknown), 'de');
    }
  });
});

describe('the address the plan page lives at', () => {
  it('is the one the biller sends a browser back to', () => {
    // Transcribed from `openplate-billing/src/plans/checkout.ts`
    // (`checkoutReturnUrls`) and `portal.ts` (`portalReturnUrl`), both of
    // which append this path to the public app URL. A second spelling here
    // would be a page somebody pays on and cannot get back to.
    assert.equal(PLAN_PAGE_HREF, '/settings/plan');
  });

  it('is a route this app actually registers', () => {
    const routes = readFileSync(fileURLToPath(new URL('../../app/routes.ts', import.meta.url)), 'utf8');
    assert.match(routes, /route\('\/settings\/plan', 'routes\/settings\.plan\.tsx'\)/);
  });
});
