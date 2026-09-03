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
 * The gateway membership is the weak signal and the tests say so: it may
 * reorder the buttons, and it must NEVER produce a name to prefill, because
 * redeeming a gateway invite says nothing about a sync account existing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveWelcomeHint } from '../../app/lib/welcome-hint';

describe('resolveWelcomeHint', () => {
  it('leads with Start on a device carrying neither hint', () => {
    assert.deepEqual(resolveWelcomeHint({ accountHint: null, connectedVia: null }), {
      primary: 'start',
      accountName: null,
    });
  });

  it('leads with Sign in, named, when the device remembers a sign-in name', () => {
    assert.deepEqual(resolveWelcomeHint({ accountHint: 'anna', connectedVia: null }), {
      primary: 'sign-in',
      accountName: 'anna',
    });
  });

  // The weak signal on its own: it reorders the buttons and stops there.
  it('leads with Sign in, unnamed, on a gateway membership alone', () => {
    assert.deepEqual(resolveWelcomeHint({ accountHint: null, connectedVia: 'invite' }), {
      primary: 'sign-in',
      accountName: null,
    });
  });

  it('leads with Sign in, named, when the device carries both hints', () => {
    assert.deepEqual(resolveWelcomeHint({ accountHint: 'anna', connectedVia: 'invite' }), {
      primary: 'sign-in',
      accountName: 'anna',
    });
  });

  // Every other connection method is somebody typing their own provider key.
  // That is not a trace of an openplate account and must not reorder anything.
  it('ignores every AI connection method except an invite', () => {
    for (const connectedVia of ['manual', 'oauth', 'preset'] as const) {
      assert.deepEqual(
        resolveWelcomeHint({ accountHint: null, connectedVia }),
        { primary: 'start', accountName: null },
        connectedVia,
      );
    }
  });

  it('treats a blank or whitespace-only remembered name as no name at all', () => {
    for (const accountHint of ['', '   ']) {
      assert.deepEqual(
        resolveWelcomeHint({ accountHint, connectedVia: null }),
        { primary: 'start', accountName: null },
        JSON.stringify(accountHint),
      );
    }
  });

  it('trims the remembered name it hands to the button', () => {
    assert.equal(resolveWelcomeHint({ accountHint: '  anna \n', connectedVia: null }).accountName, 'anna');
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

  it('reads both device hints', () => {
    assert.match(welcomeSource, /readAccountHint/);
    assert.match(welcomeSource, /connectedVia/);
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
