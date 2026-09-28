/**
 * `/welcome`'s hint decision (`app/lib/welcome-hint.ts`), plus the wiring that
 * makes that screen reachable at all (M183 spec 02).
 *
 * The decision is small and the stakes are asymmetric, which is why all four
 * input combinations are pinned rather than sampled. Leading with "Start" for
 * somebody who already has an account is how a second, empty account gets
 * created beside a full one, and the two never meet. Leading with "Sign in" for
 * somebody who has never had an account is merely a wasted tap.
 *
 * There WAS a second, weaker signal: a gateway membership
 * (`connectedVia: 'invite'`). It could reorder the buttons and never produced
 * a name to prefill, because redeeming a gateway invite said nothing about an
 * account existing. M192 deleted the gateway and with it that input, so the
 * remembered address is the only trace left.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveWelcomeHint } from '../../app/lib/welcome-hint';

describe('resolveWelcomeHint', () => {
  it('leads with Start on a device carrying no hint', () => {
    assert.deepEqual(resolveWelcomeHint({ accountHint: null, managed: false }), {
      primary: 'start',
      secondary: 'sign-in',
      accountName: null,
      isReturning: false,
    });
  });

  it('leads with Sign in, named, when the device remembers an address', () => {
    assert.deepEqual(resolveWelcomeHint({ accountHint: 'anna@example.org', managed: false }), {
      primary: 'sign-in',
      secondary: 'start',
      accountName: 'anna@example.org',
      isReturning: true,
    });
  });

  it('treats a blank or whitespace-only remembered address as none at all', () => {
    for (const accountHint of ['', '   ']) {
      assert.deepEqual(
        resolveWelcomeHint({ accountHint, managed: false }),
        { primary: 'start', secondary: 'sign-in', accountName: null, isReturning: false },
        JSON.stringify(accountHint),
      );
    }
  });

  it('trims the remembered address it hands to the button', () => {
    assert.equal(
      resolveWelcomeHint({ accountHint: '  anna@example.org \n', managed: false }).accountName,
      'anna@example.org',
    );
  });
});

/**
 * WIRING. The route is client-only and top-level, and both properties are
 * load-bearing rather than stylistic: a `loader` here would put two device
 * hints through this server, and nesting the route under `_personal` would put
 * it behind the very gate that redirects to it.
 */
describe('/welcome is reachable from a blank device', () => {
  const routesSource = readFileSync(new URL('../../app/routes.ts', import.meta.url), 'utf8');
  const welcomeSource = readFileSync(new URL('../../app/routes/welcome.tsx', import.meta.url), 'utf8');

  it('is registered outside the gated layout', () => {
    const registeredAt = routesSource.indexOf("route('/welcome', 'routes/welcome.tsx')");
    const personalLayoutAt = routesSource.indexOf("layout('routes/_personal.tsx'");
    assert.ok(registeredAt !== -1, '/welcome is no longer registered');
    assert.ok(personalLayoutAt !== -1, 'the _personal layout is gone');
    assert.ok(registeredAt < personalLayoutAt, '/welcome must sit outside the layout whose gate redirects to it');
  });

  it('has no server loader or action', () => {
    assert.doesNotMatch(welcomeSource, /^export (async )?function (loader|action)\b/m);
  });

  it('reads the device hint', () => {
    assert.match(welcomeSource, /readAccountHint/);
  });

  // The welcome screen is a QUESTION, not a decision: it must not clear the
  // home hint cookie and must not touch onboarding state. `/onboarding` still
  // clears the hint when the person actually chooses to start fresh.
  it('touches neither the home hint nor onboarding state', () => {
    assert.doesNotMatch(welcomeSource, /clearHomeHint|writeHomeHint|patchLocalProfileGoals/);
  });

  // "Not you?" (M183 spec 04): the prefilled name is disowned in the same
  // storage the sign-in route and the settings choose screen share, and the
  // clear must reach the screen's own state too, not just localStorage — the
  // whole point is "Start" becoming primary without a reload.
  it('offers "Not you?" and clears both the stored hint and its own state', () => {
    assert.match(welcomeSource, /clearAccountHint/);
    assert.match(welcomeSource, /sync\.signIn\.notYou/);
  });
});
