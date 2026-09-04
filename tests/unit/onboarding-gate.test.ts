/**
 * The `_personal` onboarding gate's decision table (`app/lib/onboarding-gate.ts`).
 *
 * The case these tests exist for is the third branch. Before M123 spec 01 the
 * gate ended in an unconditional `redirect('/onboarding')`, so a device whose
 * local tables had been wiped by the load/autosave race — no profile, no logs,
 * but the `firstDataAt` marker still sitting in the surviving values partition
 * — was shown the first-run wizard. A data-loss event presented as a fresh
 * start. `recover` is the outcome that must fire there instead.
 *
 * The other cases are the guardrails around it, and they matter just as much:
 * every one of them ALSO has the marker set (a profile write stamps it), so a
 * sloppier rule would show a recovery warning to a user who has lost nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isOnboardingGateExempt, resolveOnboardingGate, type OnboardingGateInput } from '../../app/lib/onboarding-gate';

/**
 * A device that has never been written to: the only shape with no marker.
 *
 * The two SESSION fields default to "nobody is signed in and the question is
 * settled", which is what an open instance with no server looks like for ever.
 * The cases that turn them on are grouped at the bottom of this file.
 */
function newDevice(overrides: Partial<OnboardingGateInput> = {}): OnboardingGateInput {
  return {
    hasProfile: false,
    hasCompletedOnboarding: false,
    logCount: 0,
    hasEverHadData: false,
    hasSyncAccount: false,
    isResumingSession: false,
    ...overrides,
  };
}

describe('resolveOnboardingGate', () => {
  it('sends a genuinely blank device to welcome — no marker, no profile, no logs', () => {
    assert.deepEqual(resolveOnboardingGate(newDevice()), { kind: 'welcome' });
  });

  // THE REGRESSION. Same visible state as the line above except for the marker,
  // and the marker is the whole difference between a first run and a wipe.
  it('sends a wiped device to recover — marker set, but nothing at all in the tables', () => {
    assert.deepEqual(resolveOnboardingGate(newDevice({ hasEverHadData: true })), { kind: 'recover' });
  });

  // Both names, because this is the assertion M183 spec 02 renamed: a wiped
  // device must reach neither the welcome screen nor, under its old name, the
  // wizard. "Start fresh" offered to someone who has just lost weeks of data is
  // the exact failure `recover` exists to prevent.
  it('never resolves a marked, empty device to welcome or onboarding', () => {
    const kind = resolveOnboardingGate(newDevice({ hasEverHadData: true })).kind;
    assert.notEqual(kind, 'welcome');
    assert.notEqual(kind, 'onboarding');
  });

  // The day-one user: onboarded this morning, nothing logged yet. Their profile
  // write set the marker, so they satisfy "marker set, zero logs" too — and they
  // must never see the recovery screen.
  it('passes an onboarded device with no logs yet', () => {
    const outcome = resolveOnboardingGate(
      newDevice({ hasProfile: true, hasCompletedOnboarding: true, hasEverHadData: true }),
    );
    assert.deepEqual(outcome, { kind: 'pass' });
  });

  it('passes an onboarded device that has logs', () => {
    const outcome = resolveOnboardingGate(
      newDevice({ hasProfile: true, hasCompletedOnboarding: true, logCount: 12, hasEverHadData: true }),
    );
    assert.deepEqual(outcome, { kind: 'pass' });
  });

  // Branch 1 returns before `logCount` is read at all — which is what lets the
  // route skip the expensive log listing on the hot path (see `_personal.tsx`).
  it('passes on the completion stamp alone, whatever the log count is', () => {
    for (const logCount of [0, 1, 5000]) {
      const outcome = resolveOnboardingGate(
        newDevice({ hasProfile: true, hasCompletedOnboarding: true, logCount, hasEverHadData: true }),
      );
      assert.deepEqual(outcome, { kind: 'pass' }, `logCount ${logCount}`);
    }
  });

  it('self-heals a pre-stamp device: logs present, completion never stamped', () => {
    const outcome = resolveOnboardingGate(newDevice({ logCount: 3, hasEverHadData: true }));
    assert.deepEqual(outcome, { kind: 'self-heal' });
  });

  it('self-heals rather than recovering whenever logs are present', () => {
    const outcome = resolveOnboardingGate(newDevice({ hasProfile: true, logCount: 1, hasEverHadData: true }));
    assert.deepEqual(outcome, { kind: 'self-heal' });
  });

  // Mid-onboarding is the false positive the `hasProfile` condition exists to
  // prevent. The wizard writes timezone/focus/weight to the profile BEFORE it
  // stamps completion, and each of those writes sets the marker — so this user
  // has the marker and zero logs while nothing whatsoever has been lost. A
  // surviving profile row is positive evidence the tables were not wiped (the
  // failure empties the whole partition in one replace), so they go to the
  // welcome screen like any other device with nothing to recover.
  it('keeps a mid-onboarding device out of recovery, marker and all', () => {
    const outcome = resolveOnboardingGate(newDevice({ hasProfile: true, hasEverHadData: true }));
    assert.deepEqual(outcome, { kind: 'welcome' });
  });

  it('does not recover a device with no marker, whatever else is missing', () => {
    assert.deepEqual(resolveOnboardingGate(newDevice({ hasProfile: true })), { kind: 'welcome' });
    assert.deepEqual(resolveOnboardingGate(newDevice()), { kind: 'welcome' });
  });
});

/**
 * The exemption is a second, independent question the gate asks BEFORE the
 * decision table above: is this route reachable at all before onboarding?
 *
 * Four routes are. `/settings/preferences` holds the language switcher, and on
 * an instance whose default language a visitor cannot read it is the only way
 * out — so putting it behind the wizard hides the fix behind the problem.
 * `/settings/sync` is where an emailed invite link lands, and the redirect
 * threw away the URL FRAGMENT the single-use token rides in, so the invite
 * could never be redeemed on a device that had not onboarded. `/welcome` and
 * `/sign-in` are the gate's own destinations (M183 spec 02).
 *
 * Everything else under `_personal` stays gated, which is what the negative
 * cases here pin down: a prefix match would have opened the whole hub.
 */
describe('isOnboardingGateExempt', () => {
  it('exempts the preferences page, with or without a trailing slash', () => {
    assert.equal(isOnboardingGateExempt('/settings/preferences'), true);
    assert.equal(isOnboardingGateExempt('/settings/preferences/'), true);
  });

  it('exempts the sync page, where an invite link lands', () => {
    assert.equal(isOnboardingGateExempt('/settings/sync'), true);
    assert.equal(isOnboardingGateExempt('/settings/sync/'), true);
  });

  // The gate's own destinations (M183 spec 02). Both sit outside `_personal`
  // today, so this is belt and braces — but a redirect target the gate would
  // itself redirect away from is a loop, and that is worth pinning down.
  it('exempts the two screens the gate itself redirects to', () => {
    for (const path of ['/welcome', '/welcome/', '/sign-in', '/sign-in/']) {
      assert.equal(isOnboardingGateExempt(path), true, path);
    }
  });

  it('still gates the settings hub itself', () => {
    assert.equal(isOnboardingGateExempt('/settings'), false);
  });

  it('still gates every other personal route', () => {
    for (const path of ['/diary', '/dashboard', '/scan', '/settings/goals', '/settings/ai', '/settings/data']) {
      assert.equal(isOnboardingGateExempt(path), false, path);
    }
  });

  it('does not exempt a route that merely starts with an exempt path', () => {
    assert.equal(isOnboardingGateExempt('/settings/preferences-export'), false);
    assert.equal(isOnboardingGateExempt('/settings/sync-debug'), false);
  });
});

// ---------------------------------------------------------------------------
// The session dimension (M192/06)
// ---------------------------------------------------------------------------

describe('a session that is still reopening', () => {
  // THE DEFECT, in one line. Walking 0.10.0: join an instance, then open
  // /scan in a fresh tab, and the app offered "Sign in as walker@example.org"
  // to somebody whose session was in IndexedDB and halfway open. `account ===
  // null` is what a resume looks like from outside, and the gate read it as
  // "signed out".
  it('waits instead of showing the door, on a managed instance', () => {
    assert.deepEqual(
      resolveOnboardingGate(newDevice({ hasSyncAccount: false, isResumingSession: true })),
      { kind: 'wait' },
      'a resume in flight is not an answer',
    );
  });

  // The rule is about the SESSION, not about the instance. There is no
  // `managed` input because a managed instance changes nothing here: an open
  // instance with a server resumes the same way, and one without a server
  // settles the flag before this can fire.
  it('waits the same way on an open instance', () => {
    assert.deepEqual(resolveOnboardingGate(newDevice({ isResumingSession: true })), { kind: 'wait' });
  });

  it('holds the wait ahead of the data-loss warning, because a resume can bring the tables back', () => {
    assert.deepEqual(
      resolveOnboardingGate(newDevice({ hasEverHadData: true, isResumingSession: true })),
      { kind: 'wait' },
      'telling somebody their data is gone while it is on its way is the false positive to avoid',
    );
  });

  it('lets a device that already has a diary straight through, resume or not', () => {
    // Nothing a resume brings can make an onboarded profile falser, so the two
    // branches above it win and the person never sees a loading screen.
    assert.deepEqual(
      resolveOnboardingGate(newDevice({ hasProfile: true, hasCompletedOnboarding: true, isResumingSession: true })),
      { kind: 'pass' },
    );
    assert.deepEqual(resolveOnboardingGate(newDevice({ logCount: 3, isResumingSession: true })), {
      kind: 'self-heal',
    });
  });

  it('sends a settled account with no diary to the questionnaire, never to the door', () => {
    assert.deepEqual(
      resolveOnboardingGate(newDevice({ hasSyncAccount: true })),
      { kind: 'onboard' },
      'they have signed in; the welcome screen would ask them to do it again',
    );
  });

  it('and only reaches welcome once the resume has settled with no account', () => {
    assert.deepEqual(resolveOnboardingGate(newDevice({ hasSyncAccount: false, isResumingSession: false })), {
      kind: 'welcome',
    });
  });
});
