/**
 * One ceremony on a managed instance, and no half left parked at the end of it
 * (M187 spec 03).
 *
 * Two things are pinned here, and they fail in different ways.
 *
 * THE DECISION is pure (`app/lib/managed-join.ts`) and is tested as a matrix,
 * because each of its three answers is wrong in a different place: confirming
 * on a managed instance is a speed bump, auto-redeeming while signed out
 * writes a connection nothing carries anywhere, and auto-redeeming past an
 * audit disclosure would automate away the one consent that must not be.
 *
 * THE SLOTS are not pure and cannot be: they live in `sessionStorage` behind
 * a module mirror, and the flow that empties them is a React closure driving
 * three screens. So that half is source inspection, in the idiom of
 * `join-invite-invalid.test.ts`, with every slice bounded to the BRANCH that
 * owns the call. An unbounded slice would pass against the very bug it exists
 * to catch: the rejection path holds an identical `consumeGatewayInvite()`.
 *
 * Why a parked half matters at all: `sign-in-flow.ts` sends a signed-in tab
 * back to `/join` whenever a gateway half is parked, and `/join` puts a parked
 * sync half straight back on the step that sent the person away. Either one
 * left behind after a SUCCESS is a loop, not a leftover.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { redeemAndPark, type RedemptionOutcome } from '#app/lib/gateway-redemption';
import {
  consumeGatewayInvite,
  consumeSyncInvite,
  readPendingGatewayJoin,
  readPendingGatewayRedemption,
} from '#app/lib/join-link';
import { resolveGatewayStep } from '../../app/lib/managed-join';

describe('resolveGatewayStep', () => {
  it('always confirms on an open instance', () => {
    for (const hasAccount of [true, false]) {
      for (const auditRequired of [true, false]) {
        assert.equal(
          resolveGatewayStep({ managed: false, hasAccount, auditRequired }),
          'confirm',
          `${String(hasAccount)} / ${String(auditRequired)}`,
        );
      }
    }
  });

  it('redeems by itself for somebody signed in to a managed instance', () => {
    assert.equal(resolveGatewayStep({ managed: true, hasAccount: true, auditRequired: false }), 'auto-redeem');
  });

  it('asks for a sign-in first when there is no account to attach it to', () => {
    // The connection belongs to the ACCOUNT now (M187 spec 02). Redeeming into
    // a signed-out device would write it where nothing carries it anywhere.
    assert.equal(resolveGatewayStep({ managed: true, hasAccount: false, auditRequired: false }), 'sign-in-first');
  });

  it('never redeems past an audit disclosure, however managed the instance is', () => {
    // Consent to being watched is the one thing a smoother flow may not
    // automate away, so an auditing gateway keeps its card and its tap.
    assert.equal(resolveGatewayStep({ managed: true, hasAccount: true, auditRequired: true }), 'confirm');
  });

  it('asks for the account before it asks about the audit', () => {
    // Both stop the auto-redeem, and the order is what decides which screen a
    // signed-out person sees: a confirm card they cannot act on, or the
    // sign-in that makes the card meaningful.
    assert.equal(resolveGatewayStep({ managed: true, hasAccount: false, auditRequired: true }), 'sign-in-first');
  });
});

const joinSource = readFileSync(new URL('../../app/routes/join.tsx', import.meta.url), 'utf8');
const settingsSyncSource = readFileSync(new URL('../../app/routes/settings.sync.tsx', import.meta.url), 'utf8');
const signInSource = readFileSync(new URL('../../app/routes/sign-in.tsx', import.meta.url), 'utf8');
const createPanelSource = readFileSync(
  new URL('../../app/components/create-account-panel.tsx', import.meta.url),
  'utf8',
);

/**
 * The two slot invariants below were source-inspected while the redemption
 * lived inside the route. It now lives in `app/lib/gateway-redemption.ts` and
 * is exercised directly, which is both stronger and immune to a rename.
 */
async function redemptionWith({ refuses }: { refuses: boolean }): Promise<RedemptionOutcome> {
  consumeSyncInvite();
  consumeGatewayInvite();
  return redeemAndPark({
    invite: { gatewayUrl: 'https://gw.example.test', inviteToken: 'gi_managed' },
    deps: {
      redeem: async () =>
        refuses ? null : (
          { memberId: 'm', memberToken: 'mt_x', gateway: { name: 'Haus', model: null, auditEnabled: false } }
        ),
      putAiSettings: async () => undefined,
      putGatewayConnection: async () => undefined,
      now: () => 0,
    },
  });
}

describe('no successful path leaves a parked half', () => {
  it('empties the gateway slot on the SUCCESS path, before the person is sent on', async () => {
    const outcome = await redemptionWith({ refuses: false });
    assert.equal(outcome.status, 'joined');
    // The route only navigates on this outcome, so an empty slot HERE is an
    // empty slot before the person is sent on.
    assert.equal(readPendingGatewayJoin(), null);
    assert.equal(readPendingGatewayRedemption(), null);
  });

  it('empties it on the REJECTION path too (spec 01)', async () => {
    const outcome = await redemptionWith({ refuses: true });
    assert.equal(outcome.status, 'invite-invalid');
    assert.equal(readPendingGatewayJoin(), null);
  });

  it('spends the sync half when the account is created, not when the form renders', () => {
    // The other half of "nothing parked": the create ceremony consumes the
    // signup invite as the person acts on it. A reload before that must still
    // bring the token back, which is why it is not consumed on mount.
    const provision = createPanelSource.slice(createPanelSource.indexOf('provision={async ('));
    assert.match(provision, /consumePendingInvite\(\)/);
  });

  it('spends the sync half when a sign-in returns to /join instead', () => {
    // The person had an account already, so the signup invite is moot — and a
    // parked one would put `/join` back on the step that sent them away.
    assert.match(signInSource, /if \(outcome\.path === '\/join'\) consumeSyncInvite\(\);/);
  });
});

describe('the managed ceremony runs without a detour', () => {
  it('offers no skip on a managed instance, and keeps it on an open one', () => {
    const card = joinSource.slice(
      joinSource.indexOf('function SyncStepCard('),
      joinSource.indexOf('function SignInFirstCard('),
    );
    assert.ok(card.length > 0, 'SyncStepCard has been renamed');
    assert.match(card, /hasGateway && !managed/, 'the skip must be conditional on the instance being open');
    assert.match(card, /join\.sync\.skip/, 'the skip itself must stay for open instances');
  });

  it('comes back from the account ceremony by itself, only when a half is parked', () => {
    const handler = settingsSyncSource.slice(
      settingsSyncSource.indexOf('const handleCeremonyActiveChange = useCallback('),
      settingsSyncSource.indexOf('[managed, navigate],'),
    );
    assert.ok(handler.length > 0, 'the ceremony-edge handler has been renamed or restructured');
    // The `false` this callback also receives on mount and on unmount must not
    // navigate anywhere — only a true→false edge is a ceremony that ended.
    assert.match(handler, /wasCeremonyActive\.current/);
    assert.match(handler, /if \(!managed \|\| readPendingGatewayJoin\(\) === null\) return;/);
    assert.match(handler, /navigate\('\/join'\)/);
  });

  it('lands the person in the app rather than in settings', () => {
    const destination = joinSource.slice(joinSource.indexOf('async function destinationAfterJoin('));
    assert.match(destination, /if \(!managed\) return '\/settings\/ai';/, 'open instances are unchanged');
    assert.match(destination, /resolveSignInDestination/);
    assert.match(destination, /hasPendingGatewayJoin: false/, 'the slot is empty by then; anything else loops');
  });
});
