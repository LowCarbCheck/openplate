/**
 * The two shapes of the front door, side by side (M187 spec 03).
 *
 * A managed instance has one door: sign in, or paste the invite link somebody
 * sent. An open instance has the door it has always had: start a diary nobody
 * gave you permission for. This file pins BOTH, on purpose and in the same
 * cases, because the risk runs in both directions and only one of them is
 * loud.
 *
 * - If the managed branch quietly became the only branch, every self-hoster's
 *   app would tell its owner to go and find an invite to an instance they run
 *   themselves. Nothing would throw; the app would simply refuse everybody.
 * - If the open branch quietly won on a managed instance, a closed beta would
 *   be offering strangers an anonymous diary again, which is the bug the whole
 *   spec exists to close.
 *
 * The onboarding half is here too, because hiding a button is not closing a
 * path: `/onboarding` is one typed address away from any welcome screen.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveWelcomeHint } from '../../app/lib/welcome-hint';
import { isAnonymousStartAllowed } from '../../app/lib/onboarding-gate';

describe('the welcome screen on an OPEN instance is unchanged', () => {
  it('offers Start to a blank device, with sign in underneath', () => {
    assert.deepEqual(resolveWelcomeHint({ accountHint: null, connectedVia: null, managed: false }), {
      primary: 'start',
      secondary: 'sign-in',
      accountName: null,
      isReturning: false,
    });
  });

  it('offers Start fresh under a remembered name', () => {
    assert.deepEqual(resolveWelcomeHint({ accountHint: 'anna', connectedVia: null, managed: false }), {
      primary: 'sign-in',
      secondary: 'start',
      accountName: 'anna',
      isReturning: true,
    });
  });

  it('never offers the invite-link box', () => {
    for (const accountHint of [null, 'anna']) {
      for (const connectedVia of [null, 'invite'] as const) {
        assert.notEqual(
          resolveWelcomeHint({ accountHint, connectedVia, managed: false }).secondary,
          'invite-link',
          `${String(accountHint)} / ${String(connectedVia)}`,
        );
      }
    }
  });
});

describe('the welcome screen on a MANAGED instance has one door', () => {
  it('leads with sign in on a device carrying nothing at all', () => {
    // The open branch would lead with Start here. That is the whole difference.
    assert.deepEqual(resolveWelcomeHint({ accountHint: null, connectedVia: null, managed: true }), {
      primary: 'sign-in',
      secondary: 'invite-link',
      accountName: null,
      isReturning: false,
    });
  });

  it('still prefills the remembered name, and still knows this device is returning', () => {
    assert.deepEqual(resolveWelcomeHint({ accountHint: 'anna', connectedVia: null, managed: true }), {
      primary: 'sign-in',
      secondary: 'invite-link',
      accountName: 'anna',
      isReturning: true,
    });
  });

  it('offers neither Start nor Start fresh, whatever the device carries', () => {
    for (const accountHint of [null, 'anna', '   ']) {
      for (const connectedVia of [null, 'invite', 'manual', 'oauth', 'preset'] as const) {
        const hint = resolveWelcomeHint({ accountHint, connectedVia, managed: true });
        assert.equal(hint.primary, 'sign-in', `${String(accountHint)} / ${String(connectedVia)}`);
        assert.equal(hint.secondary, 'invite-link', `${String(accountHint)} / ${String(connectedVia)}`);
      }
    }
  });

  // A gateway membership never invents a name, on either kind of instance:
  // redeeming an invite says nothing about a sync account existing.
  it('never invents a name from a gateway membership', () => {
    assert.equal(resolveWelcomeHint({ accountHint: null, connectedVia: 'invite', managed: true }).accountName, null);
  });
});

describe('/onboarding is closed on a managed instance, and only there', () => {
  it('lets anybody in on an open instance', () => {
    for (const hasProfile of [true, false]) {
      for (const hasSyncAccount of [true, false]) {
        assert.equal(
          isAnonymousStartAllowed({ managed: false, hasProfile, hasSyncAccount }),
          true,
          `${String(hasProfile)} / ${String(hasSyncAccount)}`,
        );
      }
    }
  });

  it('turns away a device with neither a diary nor an account', () => {
    assert.equal(isAnonymousStartAllowed({ managed: true, hasProfile: false, hasSyncAccount: false }), false);
  });

  it('never throws out somebody who already answered something here', () => {
    // Including a device that onboarded BEFORE the instance became managed.
    assert.equal(isAnonymousStartAllowed({ managed: true, hasProfile: true, hasSyncAccount: false }), true);
  });

  it('lets the create-account flow through on its last step', () => {
    // The ceremony ends with a session open and no profile row yet, and the
    // questionnaire is the very next screen. Without this the flow would
    // redirect itself back to `/welcome` at the finish line.
    assert.equal(isAnonymousStartAllowed({ managed: true, hasProfile: false, hasSyncAccount: true }), true);
  });
});

/**
 * WIRING. The rules above are pure, so a test can only prove the routes call
 * them. Both greps are bounded to the function that owns the decision.
 */
describe('the two screens actually consult the rules', () => {
  const welcomeSource = readFileSync(new URL('../../app/routes/welcome.tsx', import.meta.url), 'utf8');
  const onboardingSource = readFileSync(new URL('../../app/routes/onboarding.tsx', import.meta.url), 'utf8');

  it('welcome reads the instance shape and offers the paste box from the resolver', () => {
    assert.match(welcomeSource, /useManagedInstance/);
    assert.match(welcomeSource, /welcome\.managed\.haveInvite/);
  });

  it('welcome hands a pasted link to /join rather than redeeming anything itself', () => {
    // The join ceremony has exactly one implementation, and it is not here.
    assert.match(welcomeSource, /parseJoinLinkInput/);
    assert.match(welcomeSource, /buildJoinFragment/);
    assert.doesNotMatch(welcomeSource, /redeem|consumeGatewayInvite/i);
  });

  it("onboarding's client loader asks the rule and redirects to /welcome", () => {
    const clientLoader = onboardingSource.slice(
      onboardingSource.indexOf('export async function clientLoader'),
      onboardingSource.indexOf('clientLoader.hydrate'),
    );
    assert.ok(clientLoader.length > 0, 'the onboarding clientLoader is gone');
    assert.match(clientLoader, /isAnonymousStartAllowed/);
    assert.match(clientLoader, /redirect\('\/welcome'\)/);
  });
});
