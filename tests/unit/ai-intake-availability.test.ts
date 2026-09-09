/**
 * CAN THIS DEVICE RUN AN AI INTAKE, and where does a person go who cannot.
 *
 * ── The blocker this file exists for (0.20.0) ────────────────────────────
 *
 * `/describe` and `/add` gated their AI intake on the device's own BYOK row.
 * A managed instance stores no such row on purpose: the AI comes from the
 * instance's server on the account's allowance, derived from the session and
 * never saved. So on production, which is managed, Send was disabled for
 * everybody and the notice under it pointed at `/settings/ai`, a page that
 * instance redirects away from. `/scan` was right the whole time, because it
 * asked `resolveEffectiveAiSettings`.
 *
 * ── What is asserted, and why it is not a hook ───────────────────────────
 *
 * There is no DOM test library in this repo, so `useAiIntake` cannot be run.
 * Its whole decision is pure and lives in `resolveAiConnection` and
 * `resolveAiIntakeDoor`, and the answer they are given here comes from the
 * REAL `resolveEffectiveAiSettings` rather than a fixture, so the chain the
 * screens actually run is the chain under test. The React glue that remains is
 * pinned by a source read at the bottom: it is three lines, and a hook that
 * stopped feeding the rule its own inputs would pass every assertion above.
 *
 * EVERY ASSERTION HAS A CONTROL. The managed answers are paired with the open
 * ones, because a resolver that answered `connected` for everything would
 * satisfy the managed case on its own.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  resolveAiConnection,
  resolveAiIntakeDoor,
  type AiConnection,
} from '../../app/components/add/use-ai-connection';
import { resolveEffectiveAiSettings, type ManagedInstanceFacts } from '../../app/lib/ai/managed-ai-settings';
import type { LocalAiSettings } from '../../app/lib/local-store/ai-settings';
import type { SyncSessionSnapshot } from '../../app/lib/sync/sync-session';

const SERVER_URL = 'https://sync.example.test';

const MANAGED_FACTS: ManagedInstanceFacts = { managed: true, syncServerUrl: SERVER_URL, model: 'fake/vision-1' };
const OPEN_FACTS: ManagedInstanceFacts = { managed: false, syncServerUrl: null, model: null };

const SIGNED_OUT: SyncSessionSnapshot = {
  account: null,
  isResuming: false,
  phase: 'idle',
  lastSyncedAt: null,
  hasPendingChanges: false,
  error: null,
};

/** The first moments after a reload: no account yet, and no answer yet either. */
const RESUMING: SyncSessionSnapshot = { ...SIGNED_OUT, isResuming: true };

function signedIn({ dailyAiLimit = 200 }: { dailyAiLimit?: number | null } = {}): SyncSessionSnapshot {
  return {
    ...SIGNED_OUT,
    account: {
      id: 7,
      email: 'anna@example.org',
      displayName: null,
      role: 'member',
      dailyAiLimit,
      aiUsedToday: 3,
      allowanceExpiresAt: null,
      invitesLeft: null,
    },
  };
}

const BYOK_ROW: LocalAiSettings = {
  provider: 'openrouter',
  model: 'openai/gpt-5.6-luna',
  baseUrl: null,
  apiKey: 'sk-or-v1-a-key-this-person-brought',
  connectedVia: 'manual',
  updatedAt: 1,
};

/**
 * The whole chain a screen runs: the settings rule, then the connection rule.
 *
 * `hasReadDeviceRow` defaults to true, which is the settled state on an open
 * instance; the loading states name it explicitly.
 */
function connectionFor({
  instance,
  session,
  storedSettings = null,
  hasReadDeviceRow = true,
}: {
  instance: ManagedInstanceFacts;
  session: SyncSessionSnapshot;
  storedSettings?: LocalAiSettings | null;
  hasReadDeviceRow?: boolean;
}): AiConnection {
  return resolveAiConnection({
    aiComesFromTheInstance: instance.managed,
    isSessionResuming: session.isResuming,
    hasReadDeviceRow,
    effectiveSettings: resolveEffectiveAiSettings({ instance, session, storedSettings }),
  });
}

describe('a managed instance', () => {
  it('can run an AI intake with a session and an allowance, and no BYOK row anywhere', () => {
    assert.equal(connectionFor({ instance: MANAGED_FACTS, session: signedIn() }), 'connected');
  });

  it('cannot when nobody is signed in', () => {
    // The control for the case above: an answer of `connected` here would mean
    // the rule stopped reading the session at all.
    assert.equal(connectionFor({ instance: MANAGED_FACTS, session: SIGNED_OUT }), 'absent');
  });

  it('waits, rather than guessing, while a session is being reopened', () => {
    // `account === null` is also what a reload looks like, and the two answers
    // are opposite. `unknown` disables the button and shows no notice, so
    // nobody is told they are signed out for the second the resume takes.
    assert.equal(connectionFor({ instance: MANAGED_FACTS, session: RESUMING }), 'unknown');
  });

  it('cannot when the account has no allowance, which is what a new account looks like', () => {
    assert.equal(connectionFor({ instance: MANAGED_FACTS, session: signedIn({ dailyAiLimit: 0 }) }), 'absent');
    // Not read yet is not an allowance of zero, and both refuse.
    assert.equal(connectionFor({ instance: MANAGED_FACTS, session: signedIn({ dailyAiLimit: null }) }), 'absent');
  });

  it('refuses a leftover BYOK row instead of scanning through a provider nobody chose', () => {
    assert.equal(
      connectionFor({ instance: MANAGED_FACTS, session: SIGNED_OUT, storedSettings: BYOK_ROW }),
      'absent',
      'a leftover key was honoured on an instance that brings its own AI',
    );
  });

  it('does not wait for the device row it will never read', () => {
    // The BYOK read is skipped outright on a managed instance, so a `false`
    // here is the standing state rather than a loading one. An answer of
    // `unknown` would disable Send forever, which is the blocker coming back.
    assert.equal(connectionFor({ instance: MANAGED_FACTS, session: signedIn(), hasReadDeviceRow: false }), 'connected');
  });
});

describe('an open instance, unchanged', () => {
  it('is connected with a BYOK row and absent without one', () => {
    assert.equal(connectionFor({ instance: OPEN_FACTS, session: SIGNED_OUT, storedSettings: BYOK_ROW }), 'connected');
    assert.equal(connectionFor({ instance: OPEN_FACTS, session: SIGNED_OUT, storedSettings: null }), 'absent');
  });

  it('answers nothing until the row has been read', () => {
    assert.equal(
      connectionFor({ instance: OPEN_FACTS, session: SIGNED_OUT, storedSettings: null, hasReadDeviceRow: false }),
      'unknown',
    );
    // The control: with the read landed, the same inputs settle to `absent`.
    assert.equal(
      connectionFor({ instance: OPEN_FACTS, session: SIGNED_OUT, storedSettings: null, hasReadDeviceRow: true }),
      'absent',
    );
  });

  it('needs no session, because there may be no account on the instance at all', () => {
    assert.equal(
      connectionFor({ instance: OPEN_FACTS, session: signedIn(), storedSettings: null }),
      'absent',
      'a session started deciding BYOK availability',
    );
  });
});

describe('the door a person with no AI is shown', () => {
  /** An organization's instance: nobody invites anybody, and the allowance has no end date. */
  const ORGANIZATION = { memberInvites: false, allowanceExpiresAt: null, now: new Date('2026-09-09T10:00:00.000Z') };

  it('is the administrator on a managed instance, because there is no page that fixes an allowance', () => {
    assert.deepEqual(resolveAiIntakeDoor({ aiComesFromTheInstance: true, plansAvailable: false, allowance: ORGANIZATION }), {
      kind: 'ask-admin',
    });
  });

  it('is the provider settings on an open instance', () => {
    // The control for the managed answer: a door that was always `byok` would
    // pass nothing above, and one that was never `byok` would send a
    // self-hoster to an administrator their instance does not have.
    assert.deepEqual(resolveAiIntakeDoor({ aiComesFromTheInstance: false, plansAvailable: false, allowance: ORGANIZATION }), {
      kind: 'byok',
    });
    assert.notDeepEqual(
      resolveAiIntakeDoor({ aiComesFromTheInstance: true, plansAvailable: false, allowance: ORGANIZATION }),
      resolveAiIntakeDoor({ aiComesFromTheInstance: false, plansAvailable: false, allowance: ORGANIZATION }),
      'the door stopped depending on the instance at all',
    );
  });

  // M212 spec 04. An instance that hands its accounts invitations has no
  // administrator to send anybody to, so the sentence must stop being about a
  // person. The three answers themselves are `resolveAllowanceDoor`'s, in
  // `managed-ai-settings.test.ts`; what is checked here is that this door
  // carries them rather than flattening them back into one.
  it('names no administrator on an instance whose accounts invite each other', () => {
    const door = resolveAiIntakeDoor({
      aiComesFromTheInstance: true,
      plansAvailable: false,
      allowance: { ...ORGANIZATION, memberInvites: true },
    });
    assert.deepEqual(door, { kind: 'not-switched-on' });
  });

  it('names the date when the allowance ended, whatever kind of instance it is', () => {
    for (const memberInvites of [true, false]) {
      const door = resolveAiIntakeDoor({
        aiComesFromTheInstance: true,
        plansAvailable: false,
        allowance: { ...ORGANIZATION, memberInvites, allowanceExpiresAt: '2026-09-01T00:00:00.000Z' },
      });
      assert.deepEqual(door, { kind: 'allowance-ended', endedAt: '2026-09-01T00:00:00.000Z' });
    }
  });

  // M213 spec 05. On an instance with a biller behind it there IS a page that
  // fixes a missing allowance, so the two answers a payment would fix become
  // one door that carries a link. `ask-admin` deliberately does not: an
  // organization's deployment has somebody who switches the allowance on, and
  // selling a plan there would be wrong even if that deployment also happened
  // to have a biller.
  describe('and the plans door, on an instance that sells one', () => {
    const CONSUMER = { ...ORGANIZATION, memberInvites: true };

    it('replaces the dateless not-switched-on answer, and keeps its datelessness', () => {
      assert.deepEqual(
        resolveAiIntakeDoor({ aiComesFromTheInstance: true, plansAvailable: true, allowance: CONSUMER }),
        { kind: 'plans', endedAt: null },
      );
      // THE CONTROL for the flag: one input changed, and the answer is the
      // sentence that stops.
      assert.deepEqual(
        resolveAiIntakeDoor({ aiComesFromTheInstance: true, plansAvailable: false, allowance: CONSUMER }),
        { kind: 'not-switched-on' },
      );
    });

    it('replaces the ended answer and CARRIES THE DATE, which is the fact M212 fought for', () => {
      const expired = { ...CONSUMER, allowanceExpiresAt: '2026-09-01T00:00:00.000Z' };
      assert.deepEqual(
        resolveAiIntakeDoor({ aiComesFromTheInstance: true, plansAvailable: true, allowance: expired }),
        { kind: 'plans', endedAt: '2026-09-01T00:00:00.000Z' },
      );
      // THE CONTROL: without the flag the same account gets the same date on
      // the older door, so this branch cannot be passing by losing the date.
      assert.deepEqual(
        resolveAiIntakeDoor({ aiComesFromTheInstance: true, plansAvailable: false, allowance: expired }),
        { kind: 'allowance-ended', endedAt: '2026-09-01T00:00:00.000Z' },
      );
    });

    it('leaves an organization instance alone, biller or not', () => {
      for (const plansAvailable of [true, false]) {
        assert.deepEqual(
          resolveAiIntakeDoor({ aiComesFromTheInstance: true, plansAvailable, allowance: ORGANIZATION }),
          { kind: 'ask-admin' },
          'a plans door was offered where an administrator can switch the allowance on',
        );
      }
    });

    it('leaves an open instance alone, because nobody there is buying an allowance', () => {
      assert.deepEqual(
        resolveAiIntakeDoor({ aiComesFromTheInstance: false, plansAvailable: true, allowance: CONSUMER }),
        { kind: 'byok' },
      );
    });
  });
});

describe('the hook feeds those rules the real inputs', () => {
  const SOURCE = readFileSync(new URL('../../app/components/add/use-ai-connection.ts', import.meta.url), 'utf8');

  it('resolves the settings through the shared rule, never the BYOK row alone', () => {
    assert.match(SOURCE, /useEffectiveAiSettings\(deviceRow\)/);
    assert.match(SOURCE, /effectiveSettings,/);
    // The policy question, never the mode flag: `managed === true` says
    // nothing about why this screen cares.
    assert.match(SOURCE, /const \{ aiComesFromTheInstance \} = useInstancePolicy\(\);/);
  });

  it('reads the session for the half that needs it, and asks it nothing about the door', () => {
    assert.match(SOURCE, /isSessionResuming: session\.isResuming/);
    // THREADED, NOT DEFAULTED (M212 spec 04). `resolveAiIntakeDoor` takes the
    // instance's invitations and the account's end date as one required
    // argument, and a hook that stopped passing them would be the whole
    // feature reaching zero call sites while every type still checked.
    assert.match(SOURCE, /memberInvites: instance\?\.memberInvites \?\? false/);
    assert.match(SOURCE, /allowanceExpiresAt: session\.account\?\.allowanceExpiresAt \?\? null/);
    // M213 spec 05: the handshake's plans flag, threaded the same way and for
    // the same reason. `PROTOCOL.md` §5.22 forbids probing the path, so this
    // is the only input that may answer the question, and a hook that stopped
    // passing it would leave the door at zero call sites while every type
    // still checked.
    assert.match(SOURCE, /plansAvailable: instance\?\.plans \?\? false/);
    // M204 spec 01: the door has no signed-out branch left to feed, because a
    // managed device with no session is locked out of `/describe` and `/add`
    // before either renders. A resolver handed the session again would be the
    // first sign that branch had come back.
    assert.doesNotMatch(SOURCE, /isSignedIn/);
  });

  it('opens no second database on an instance that would refuse the row', () => {
    assert.match(SOURCE, /if \(aiComesFromTheInstance\) return;/);
  });
});
