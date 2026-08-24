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

import { resolveOnboardingGate, type OnboardingGateInput } from '../../app/lib/onboarding-gate';

/** A device that has never been written to: the only shape with no marker. */
function newDevice(overrides: Partial<OnboardingGateInput> = {}): OnboardingGateInput {
  return { hasProfile: false, hasCompletedOnboarding: false, logCount: 0, hasEverHadData: false, ...overrides };
}

describe('resolveOnboardingGate', () => {
  it('sends a genuinely new device to onboarding — no marker, no profile, no logs', () => {
    assert.deepEqual(resolveOnboardingGate(newDevice()), { kind: 'onboarding' });
  });

  // THE REGRESSION. Same visible state as the line above except for the marker,
  // and the marker is the whole difference between a first run and a wipe.
  it('sends a wiped device to recover — marker set, but nothing at all in the tables', () => {
    assert.deepEqual(resolveOnboardingGate(newDevice({ hasEverHadData: true })), { kind: 'recover' });
  });

  it('never resolves a marked, empty device to onboarding', () => {
    assert.notEqual(resolveOnboardingGate(newDevice({ hasEverHadData: true })).kind, 'onboarding');
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
  // failure empties the whole partition in one replace), so they keep today's
  // onboarding redirect.
  it('keeps a mid-onboarding device in the wizard, marker and all', () => {
    const outcome = resolveOnboardingGate(newDevice({ hasProfile: true, hasEverHadData: true }));
    assert.deepEqual(outcome, { kind: 'onboarding' });
  });

  it('does not recover a device with no marker, whatever else is missing', () => {
    assert.deepEqual(resolveOnboardingGate(newDevice({ hasProfile: true })), { kind: 'onboarding' });
    assert.deepEqual(resolveOnboardingGate(newDevice()), { kind: 'onboarding' });
  });
});
