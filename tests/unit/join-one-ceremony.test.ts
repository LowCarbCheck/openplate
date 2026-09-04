/**
 * ONE ceremony on a managed instance, in the order the person experiences it.
 *
 * The production failure this file was written against, 2026-09-04: a full
 * invite link (sync half plus gateway half) was opened on openplate.de. The
 * person pressed "Create my account", and about four seconds later the app was
 * on `/join` showing "sign in to finish". No account card was ever shown, so
 * the recovery code that had just been minted and registered was lost; the
 * gateway half was never redeemed; and the parked invite was gone from the
 * tab. One link produced no card, no gateway and a sign-in prompt for an
 * account created seconds earlier.
 *
 * Three separate defects made that one screen, and each gets its own group
 * below:
 *
 * 1. THE HANDOFF FIRED TOO EARLY. `/settings/sync` read the ceremony's end off
 *    the `false` edge of `onCeremonyActiveChange`, a flag re-reported by an
 *    effect cleanup whenever its callback identity changes. The edge arrived
 *    during `generating`. The end of the ceremony is now the reducer reaching
 *    `complete`, which cannot happen before the card has been shown and
 *    acknowledged.
 * 2. `/join` ASKED INSTEAD OF WAITING. It read the sync session once, on
 *    mount, and answered `sign-in-first` because the session was still opening
 *    in that same tab.
 * 3. A FAILED REQUEST BURNED THE INVITE. `redeemInvite` answered `null` for a
 *    gateway refusal and for a request that never arrived alike, and the
 *    refusal path empties the tab's slot. Only a verdict may spend a
 *    capability.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { redeemAndPark, redeemInvite, type RedeemAttempt, type RedemptionDeps } from '#app/lib/gateway-redemption';
import { consumeGatewayInvite, consumeSyncInvite, readPendingGatewayJoin } from '#app/lib/join-link';
import { rememberPendingJoinField, sessionInviteStorage } from '#app/lib/sync/invite-link';
import { resolveSignInDestination } from '#app/lib/sign-in-flow';
import { resolveCeremonyHandoff } from '#app/lib/sync/ceremony-handoff';
import { waitForAccount, type AwaitAccountDeps } from '#app/lib/sync/await-account';
import { resolveGatewayStep } from '#app/lib/managed-join';
import {
  INITIAL_SYNC_SETUP_STATE,
  syncSetupReducer,
  type SyncSetupAction,
  type SyncSetupState,
} from '#app/lib/sync/setup-flow';

const GATEWAY_URL = 'https://gw.example.test';
const GATEWAY_INVITE = 'gi_1c8Vv3rTbn0lQpQ4Wc-yZaGkQhLmNoPq';

/** Parks a gateway half exactly as a followed link does. */
function parkGatewayHalf(): void {
  const storage = sessionInviteStorage();
  rememberPendingJoinField({ field: 'gatewayUrl', value: GATEWAY_URL, storage });
  rememberPendingJoinField({ field: 'gatewayInvite', value: GATEWAY_INVITE, storage });
}

function emptyTheSlot(): void {
  consumeSyncInvite();
  consumeGatewayInvite();
}

// ---------------------------------------------------------------------------
// 1. The order of the ceremony
// ---------------------------------------------------------------------------

/** Replays a list of actions from the wizard's starting state. */
function replay(actions: SyncSetupAction[]): SyncSetupState {
  return actions.reduce(syncSetupReducer, INITIAL_SYNC_SETUP_STATE);
}

describe('the account ceremony cannot end before its card', () => {
  const provisioned: SyncSetupAction[] = [
    { type: 'detailsSubmitted' },
    { type: 'setupSucceeded', handle: 'quick-otter-42', recoveryCode: 'RC-1' },
  ];

  it('shows the account card the moment the account exists', () => {
    const state = replay(provisioned);
    assert.equal(state.kind, 'show-account-card');
  });

  it('refuses to complete while the card is unacknowledged', () => {
    // The handoff to `/join` hangs off `complete`, so this transition is the
    // gate that keeps the recovery code on screen.
    const state = replay([...provisioned, { type: 'finishRequested' }]);
    assert.equal(state.kind, 'show-account-card');
  });

  it('completes once the person confirms they saved it', () => {
    const state = replay([...provisioned, { type: 'confirmSavedToggled', checked: true }, { type: 'finishRequested' }]);
    assert.equal(state.kind, 'complete');
  });

  it('never reaches complete straight out of provisioning', () => {
    // The bug, stated as a transition: `generating` had no path to the handoff
    // and must not grow one.
    const state = replay([{ type: 'detailsSubmitted' }, { type: 'finishRequested' }]);
    assert.equal(state.kind, 'generating');
  });
});

describe('resolveCeremonyHandoff', () => {
  it('goes on to the gateway when a managed instance parked a half', () => {
    assert.equal(resolveCeremonyHandoff({ managed: true, hasPendingGatewayJoin: true }), 'join');
  });

  it('stays put on a managed instance with nothing parked', () => {
    assert.equal(resolveCeremonyHandoff({ managed: true, hasPendingGatewayJoin: false }), 'stay');
  });

  it('never moves anybody on an open instance, parked half or not', () => {
    // A gateway is optional there, and the banner on `/settings/sync` is how it
    // is offered. Moving the person would be the surprise.
    for (const hasPendingGatewayJoin of [true, false]) {
      assert.equal(resolveCeremonyHandoff({ managed: false, hasPendingGatewayJoin }), 'stay');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. /join waits for the account the same tab just created
// ---------------------------------------------------------------------------

/** A fake session store, plus the two levers a test pulls on it. */
interface ScriptedSession {
  deps: AwaitAccountDeps;
  /** Publishes a session change, as `openSyncSession` does in the browser. */
  notify: () => void;
  /** Runs the wait's give-up callback, standing in for the clock. */
  fireTimeout: () => void;
}

/** A session that opens after `opensAfter` notifications, with a timer the test drives. */
function scriptedSession({ opensAfter }: { opensAfter: number | null }): ScriptedSession {
  let notifications = 0;
  let isOpen = opensAfter === 0;
  const listeners = new Set<() => void>();
  let timeoutCallback: (() => void) | null = null;

  return {
    deps: {
      hasAccount: () => isOpen,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      schedule: (callback) => {
        timeoutCallback = callback;
        return () => {
          timeoutCallback = null;
        };
      },
    },
    notify: () => {
      notifications += 1;
      if (opensAfter !== null && notifications >= opensAfter) isOpen = true;
      for (const listener of listeners) listener();
    },
    fireTimeout: () => timeoutCallback?.(),
  };
}

describe('waitForAccount', () => {
  it('answers at once when the session is already open', async () => {
    const session = scriptedSession({ opensAfter: 0 });
    assert.equal(await waitForAccount({ deps: session.deps, timeoutMs: 1000 }), true);
  });

  it('answers as soon as the session opens', async () => {
    const session = scriptedSession({ opensAfter: 1 });
    const pending = waitForAccount({ deps: session.deps, timeoutMs: 1000 });
    session.notify();
    assert.equal(await pending, true);
  });

  it('gives up when the wait runs out', async () => {
    const session = scriptedSession({ opensAfter: null });
    const pending = waitForAccount({ deps: session.deps, timeoutMs: 1000 });
    session.fireTimeout();
    assert.equal(await pending, false);
  });

  it('stops listening once it has answered', async () => {
    const session = scriptedSession({ opensAfter: 1 });
    const pending = waitForAccount({ deps: session.deps, timeoutMs: 1000 });
    session.notify();
    await pending;
    // A second change must reach nobody: the wait is over and its screen has
    // moved on.
    session.notify();
    session.fireTimeout();
  });
});

describe('the step /join takes after an account arrives', () => {
  it('is the automatic redemption, not another sign-in', async () => {
    // The whole point of the wait: the same inputs that answered
    // `sign-in-first` on mount answer `auto-redeem` once the session the tab
    // was already opening is open.
    const session = scriptedSession({ opensAfter: 1 });
    assert.equal(
      resolveGatewayStep({ managed: true, hasAccount: session.deps.hasAccount(), auditRequired: false }),
      'sign-in-first',
    );

    const pending = waitForAccount({ deps: session.deps, timeoutMs: 1000 });
    session.notify();
    assert.equal(await pending, true);

    assert.equal(
      resolveGatewayStep({ managed: true, hasAccount: session.deps.hasAccount(), auditRequired: false }),
      'auto-redeem',
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Only a verdict spends the invite
// ---------------------------------------------------------------------------

/** Redemption deps whose gateway answers `attempt` and whose stores refuse to be written. */
function depsAnswering(attempt: RedeemAttempt): RedemptionDeps {
  return {
    redeem: async () => attempt,
    putAiSettings: async () => assert.fail('an unspent invite must write nothing'),
    putGatewayConnection: async () => assert.fail('an unspent invite must write nothing'),
    now: () => 0,
  };
}

describe('a redemption that never reached the gateway', () => {
  beforeEach(emptyTheSlot);

  it('keeps the invite parked', async () => {
    parkGatewayHalf();
    const outcome = await redeemAndPark({
      invite: { gatewayUrl: GATEWAY_URL, inviteToken: GATEWAY_INVITE },
      deps: depsAnswering({ status: 'unreachable' }),
    });

    assert.deepEqual(outcome, { status: 'gateway-unreachable' });
    assert.deepEqual(
      readPendingGatewayJoin(),
      { gatewayUrl: GATEWAY_URL, gatewayInvite: GATEWAY_INVITE },
      'a dropped connection must not cost a live capability',
    );
  });

  it('empties it only once the gateway itself says no', async () => {
    parkGatewayHalf();
    const outcome = await redeemAndPark({
      invite: { gatewayUrl: GATEWAY_URL, inviteToken: GATEWAY_INVITE },
      deps: depsAnswering({ status: 'refused' }),
    });

    assert.deepEqual(outcome, { status: 'invite-invalid' });
    assert.equal(readPendingGatewayJoin(), null);
  });
});

/** A `fetch` that answers with one status, or throws before answering at all. */
function gatewayAnswering(status: number | 'throws'): typeof fetch {
  const answer = async (): Promise<Response> => {
    if (status === 'throws') throw new TypeError('Failed to fetch');
    return new Response('{}', { status });
  };
  // SAFETY: `redeemInvite` calls this with one URL and one init, and reads
  // only `status`, `ok` and `json()` off the result.
  return answer as typeof fetch;
}

describe('redeemInvite tells a verdict from a silence', () => {
  const attempt = async (status: number | 'throws'): Promise<RedeemAttempt> =>
    redeemInvite({ gatewayUrl: GATEWAY_URL, inviteToken: GATEWAY_INVITE, fetchImpl: gatewayAnswering(status) });

  it('reads a 400 as the gateway refusing this token', async () => {
    assert.deepEqual(await attempt(400), { status: 'refused' });
  });

  it('reads a thrown fetch as no answer at all', async () => {
    // A CSP block, a dead host, a DNS miss or a timeout. None of them says
    // anything about the invite.
    assert.deepEqual(await attempt('throws'), { status: 'unreachable' });
  });

  it('reads a 500 as the gateway failing, not as a refusal', async () => {
    assert.deepEqual(await attempt(500), { status: 'unreachable' });
  });

  it('reads an unreadable 200 as no answer either', async () => {
    assert.deepEqual(await attempt(200), { status: 'unreachable' });
  });
});

// ---------------------------------------------------------------------------
// The slot survives everything that is not a redemption
// ---------------------------------------------------------------------------

describe('the parked gateway half survives the sign-in destination', () => {
  beforeEach(emptyTheSlot);

  it('is still there after the destination has been resolved', async () => {
    parkGatewayHalf();
    const destination = resolveSignInDestination({
      gate: 'welcome',
      hasPendingGatewayJoin: readPendingGatewayJoin() !== null,
    });

    assert.equal(destination, '/join', 'a parked half is what sends a signed-in tab back');
    assert.deepEqual(readPendingGatewayJoin(), { gatewayUrl: GATEWAY_URL, gatewayInvite: GATEWAY_INVITE });
    await Promise.resolve();
  });

  it('is still there when the gate sends the person to recovery instead', () => {
    // A postponed half is not a spent one: `/settings/sync` still links to it.
    parkGatewayHalf();
    assert.equal(
      resolveSignInDestination({ gate: 'recover', hasPendingGatewayJoin: readPendingGatewayJoin() !== null }),
      '/recover',
    );
    assert.deepEqual(readPendingGatewayJoin(), { gatewayUrl: GATEWAY_URL, gatewayInvite: GATEWAY_INVITE });
  });
});
