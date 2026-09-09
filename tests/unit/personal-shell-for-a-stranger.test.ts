/**
 * WHICH SHELL A GATE-EXEMPT SETTINGS PAGE WEARS, M204 spec 09.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * On a managed instance `/settings/preferences`, `/settings/account` and
 * `/settings/sync` are reachable without an account, on purpose: the language
 * switch has to be reachable before the wizard, and the sign-in door is one of
 * those pages. They rendered inside `_personal.tsx`, so a visitor who had
 * never signed in got the full sidebar, the device chip and a back arrow. No
 * data leaked, every sidebar item redirected to `/welcome`, and that is the
 * point: it was a shell that invited clicking around and answered nothing.
 *
 * ── Every assertion here has a control ───────────────────────────────────
 *
 * "This device gets the public shell" passes against a resolver that answers
 * `exempt` for everybody, which would take the app away from every person
 * using it. So each case is paired with a MUTATED INPUT, one field changed,
 * that must come back with a different kind. The control changes the input,
 * never the assertion.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  isOnboardingGateExempt,
  resolveOnboardingGate,
  type OnboardingGateInput,
} from '../../app/lib/onboarding-gate';
import { INSTANCE_POLICIES } from '../../app/config/instance-policy';
import { strangerNoteVariantForPath } from '../../app/components/stranger-note';

/**
 * A stranger's device on a page the gate does not guard: nothing written, no
 * session, no lock, and the path exempt.
 */
function stranger(overrides: Partial<OnboardingGateInput> = {}): OnboardingGateInput {
  return {
    hasProfile: false,
    hasCompletedOnboarding: false,
    logCount: 0,
    hasEverHadData: false,
    hasSyncAccount: false,
    isResumingSession: false,
    isDeviceLocked: false,
    isExemptPath: true,
    ...overrides,
  };
}

/** The same device with a diary and an account on it. */
function owner(overrides: Partial<OnboardingGateInput> = {}): OnboardingGateInput {
  return stranger({
    hasProfile: true,
    hasCompletedOnboarding: true,
    logCount: 12,
    hasEverHadData: true,
    hasSyncAccount: true,
    ...overrides,
  });
}

describe('the six cases the layout branches on', () => {
  it('gives a managed stranger on /settings/preferences the exempt kind', () => {
    assert.equal(isOnboardingGateExempt('/settings/preferences'), true);
    assert.deepEqual(resolveOnboardingGate(stranger()), { kind: 'exempt' });
  });

  it('does not give that kind to the same device on a guarded page', () => {
    // THE CONTROL for the case above: one field changed, and the answer is
    // the redirect every other personal route already gives a stranger. A
    // resolver that ignored the path would fail here.
    assert.deepEqual(resolveOnboardingGate(stranger({ isExemptPath: false })), { kind: 'welcome' });
  });

  it('gives a person with a profile and an account the pass kind on the same page', () => {
    assert.deepEqual(resolveOnboardingGate(owner()), { kind: 'pass' });
  });

  it('still gives the stranger kind once the profile and the account are gone', () => {
    // THE CONTROL for the case above: a resolver that answered `pass` for
    // every exempt path would satisfy it and leave the defect in place.
    assert.deepEqual(
      resolveOnboardingGate(owner({ hasProfile: false, hasCompletedOnboarding: false, logCount: 0, hasEverHadData: false, hasSyncAccount: false })),
      { kind: 'exempt' },
    );
  });

  it('gives an open instance device with a local diary the pass kind, never exempt', () => {
    // No account and no lock anywhere in this input: this is the self-hoster,
    // for whom `exempt` would swap the app for the public chrome on a page
    // they reach from their own sidebar.
    const localOnly = stranger({ hasProfile: true, hasCompletedOnboarding: true, logCount: 4, hasEverHadData: true });
    assert.deepEqual(resolveOnboardingGate(localOnly), { kind: 'pass' });
  });

  it('gives the pass kind for a diary that is only a marker and a log', () => {
    // THE CONTROL for the case above: the marker and the log are read, not
    // just the stamped profile. Drop all three and the same device is a
    // stranger again, which the last assertion here proves.
    assert.deepEqual(resolveOnboardingGate(stranger({ logCount: 1 })), { kind: 'pass' });
    assert.deepEqual(resolveOnboardingGate(stranger({ hasEverHadData: true })), { kind: 'pass' });
    assert.deepEqual(resolveOnboardingGate(stranger()), { kind: 'exempt' });
  });

  it('gives a locked device with no account the exempt kind', () => {
    assert.deepEqual(resolveOnboardingGate(owner({ hasSyncAccount: false, isDeviceLocked: true })), {
      kind: 'exempt',
    });
  });

  it('gives the same locked device the pass kind while a session is open on it', () => {
    // THE CONTROL: an open session lifts the lock, exactly as the gated order
    // says it does. Without this the assertion above passes against a
    // resolver that answers `exempt` for every locked device for ever.
    assert.deepEqual(resolveOnboardingGate(owner({ isDeviceLocked: true })), { kind: 'pass' });
  });

  it('gives a resuming session the wait kind on an exempt path', () => {
    assert.deepEqual(resolveOnboardingGate(stranger({ isResumingSession: true })), { kind: 'wait' });
    // A locked device mid-resume waits too: the resume is what will lift the
    // lock, and deciding first shows the public shell to somebody signed in.
    assert.deepEqual(resolveOnboardingGate(stranger({ isResumingSession: true, isDeviceLocked: true })), {
      kind: 'wait',
    });
  });

  it('stops waiting the moment the resume settles', () => {
    // THE CONTROL: a resolver that answered `wait` for every stranger would
    // hang the three exempt pages on a loading screen for ever.
    assert.deepEqual(resolveOnboardingGate(stranger({ isResumingSession: false })), { kind: 'exempt' });
  });

  it('resolves /settings/about as exempt', () => {
    assert.equal(isOnboardingGateExempt('/settings/about'), true);
    assert.equal(isOnboardingGateExempt('/settings/about/'), true);
  });

  it('does not exempt a path that merely starts like it', () => {
    // THE CONTROL for the case above: it passes against a prefix match, or
    // against a function that answers `true` for everything, and either one
    // would open the whole settings hub to a stranger.
    assert.equal(isOnboardingGateExempt('/settings/about-us'), false);
    assert.equal(isOnboardingGateExempt('/settings'), false);
  });
});

describe('the sentence each exempt page shows', () => {
  it('says what the setting applies to on the two pages a stranger can use', () => {
    for (const path of ['/settings/preferences', '/settings/about']) {
      assert.equal(strangerNoteVariantForPath(path), 'device', path);
    }
  });

  it('asks for a sign-in on the two pages that are the door', () => {
    // THE CONTROL: the two answers are DIFFERENT, so the assertion above
    // reads a rule rather than one constant.
    for (const path of ['/settings/account', '/settings/sync', '/settings/account/']) {
      assert.equal(strangerNoteVariantForPath(path), 'needs-sign-in', path);
    }
  });
});

describe('the instance decides whether a stranger sees the public shell', () => {
  it('is a managed instance question', () => {
    assert.equal(INSTANCE_POLICIES.managed.strangerSeesThePublicShell, true);
  });

  it('leaves an open instance in the app shell', () => {
    // THE CONTROL: the two modes differ, so the layout is reading a question
    // and not a constant that would change every self-hoster's chrome.
    assert.equal(INSTANCE_POLICIES.open.strangerSeesThePublicShell, false);
  });
});

/**
 * ONE SHELL, TWO LAYOUTS, read as source.
 *
 * This repo has no DOM test library (see the module note on
 * `no-dom-test-library-in-openplate`), and a render of `_personal.tsx` would
 * need a data router, the local store and i18next. The claim being pinned is
 * about the SOURCE anyway: that neither layout draws its own public chrome.
 * The control is the pair, since a grep for one file passes against a repo
 * where the other one grew a second shell.
 */
function layoutSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../app/routes/${name}`, import.meta.url)), 'utf8');
}

describe('both layouts draw the same public shell', () => {
  it('is imported and rendered by each of them', () => {
    for (const name of ['_public.tsx', '_personal.tsx']) {
      const source = layoutSource(name);
      assert.match(source, /from '#app\/components\/public-shell'/, `${name} does not import the shared shell`);
      assert.match(source, /<PublicShell/, `${name} does not render the shared shell`);
    }
  });

  it('leaves the wrapper with exactly one importer, the shell itself', () => {
    // THE CONTROL. The assertion above passes while either layout ALSO keeps
    // its own `PublicWrapper` call, which is the second shell this change
    // exists to avoid. `public-shell.tsx` is the one place that may import it.
    for (const name of ['_public.tsx', '_personal.tsx']) {
      assert.doesNotMatch(layoutSource(name), /public-wrapper/, `${name} still reaches past the shared shell`);
    }
    assert.match(
      readFileSync(fileURLToPath(new URL('../../app/components/public-shell.tsx', import.meta.url)), 'utf8'),
      /public-wrapper/,
    );
  });
});
