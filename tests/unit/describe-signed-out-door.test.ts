/**
 * THE DECISION M204 SPEC 01 ASKED FOR, WRITTEN AS A TEST.
 *
 * ── The contradiction ────────────────────────────────────────────────────
 *
 * `/describe` carried a notice for a signed-out visitor on a managed
 * instance, with a link back to the sign in screen. The M201 managed walk
 * (worklog, "M201, the managed walk of the meal composer on 0.20.1") proved
 * the notice was correct and that nobody could ever read it: signing out of a
 * managed instance writes the device lock, and `_personal.tsx`'s gate turns
 * every personal route, `/describe` included, into a redirect to `/welcome`.
 * The screenshot of the real signed-out visit shows the welcome screen and no
 * composer at all.
 *
 * ── What was decided, and why ────────────────────────────────────────────
 *
 * The door was REMOVED and the lock was left alone. The alternative on the
 * table was an exception to the lock for the two add-food screens. It was
 * refused, and this file is where that refusal is nailed down, because the
 * exception is one line in `GATE_EXEMPT_PATHS` and nothing else in the repo
 * would have failed: `/add` lists this device's own foods and both screens
 * WRITE to the diary, so a shared, signed-out device would have shown the
 * last account holder's rows and let the next person add to them. That is the
 * one thing the lock exists to stop.
 *
 * EVERY ASSERTION HAS A CONTROL. "This path is not exempt" passes against a
 * typo'd path, an empty set, or a renamed function, so each one is paired
 * with a path that IS exempt and with the pass the same device gets once the
 * lock is off.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { isOnboardingGateExempt, resolveOnboardingGate, type OnboardingGateInput } from '../../app/lib/onboarding-gate';
import { resolveAiIntakeDoor } from '../../app/components/add/use-ai-connection';

/** The one namespace this file reads, parsed at the file boundary rather than asserted. */
const catalogSchema = z.object({ aiIntake: z.record(z.string(), z.string()) });

/** Every locale the app ships, read as shipped. */
const CATALOGS = ['en', 'de'].map((locale) => ({
  locale,
  aiIntake: catalogSchema.parse(
    JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url)), 'utf8'),
    ),
  ).aiIntake,
}));

/** The screens the refused exception would have opened. */
const ADD_FOOD_PATHS = ['/describe', '/add'] as const;

/** An onboarded device with no session open on it. */
const ONBOARDED_SIGNED_OUT: OnboardingGateInput = {
  hasProfile: true,
  hasCompletedOnboarding: true,
  logCount: 3,
  hasEverHadData: true,
  hasSyncAccount: false,
  isResumingSession: false,
  isDeviceLocked: false,
  isExemptPath: false,
};

describe('the device lock has no exception for the add-food screens', () => {
  it('does not let /describe or /add past the gate untested', () => {
    for (const path of ADD_FOOD_PATHS) {
      assert.equal(isOnboardingGateExempt(path), false, `${path} was exempted from the device lock`);
    }
  });

  it('still lets the gate own two destinations through', () => {
    // THE CONTROL. Without it the assertion above passes against a function
    // that answers `false` for everything, which is what a renamed set or a
    // typo'd prefix produces.
    assert.equal(isOnboardingGateExempt('/welcome'), true);
    assert.equal(isOnboardingGateExempt('/sign-in'), true);
  });

  it('sends a locked, signed-out device to the welcome screen', () => {
    const outcome = resolveOnboardingGate({ ...ONBOARDED_SIGNED_OUT, isDeviceLocked: true });
    assert.deepEqual(outcome, { kind: 'welcome' }, 'a locked device reached a personal route');
  });

  it('lets the same device through once the lock is off', () => {
    // THE CONTROL for the branch above: a resolver that answered `welcome`
    // for every signed-out device would satisfy it and lock out every
    // self-hoster, who never signs in at all.
    assert.deepEqual(resolveOnboardingGate(ONBOARDED_SIGNED_OUT), { kind: 'pass' });
  });
});

describe('the composer has no signed-out AI door left to reach', () => {
  it('names the administrator or the provider settings, and nothing else', () => {
    // An organization's instance, and an open one. Neither has an end date on
    // the account, so neither answer is the M212 expiry door.
    const allowance = { memberInvites: false, allowanceExpiresAt: null, now: new Date('2026-09-09T10:00:00.000Z') };
    const doors: string[] = [
      resolveAiIntakeDoor({ aiComesFromTheInstance: true, plansAvailable: false, allowance }).kind,
      resolveAiIntakeDoor({ aiComesFromTheInstance: false, plansAvailable: false, allowance }).kind,
    ];
    assert.ok(!doors.includes('sign-in'), `the signed-out door came back: ${doors.join(', ')}`);
    // THE CONTROL. The two answers are still DIFFERENT, so the check above is
    // reading a rule that decides something rather than one constant.
    assert.deepEqual(doors, ['ask-admin', 'byok']);
  });
});

describe('the strings that door used are gone from every locale', () => {
  // A branch can be deleted from a component and its copy left behind, and
  // nothing else in this repo would notice: the copy-ban test walks the keys
  // it is given, and every catalog reader parses with a zod object that
  // silently drops what it did not ask for. This is the one place a
  // resurrected string fails.
  it('carries no signed-out sentence and no way back into a session', () => {
    for (const { locale, aiIntake } of CATALOGS) {
      assert.deepEqual(
        Object.keys(aiIntake).toSorted(),
        // The two M212 spec 04 sentences joined `noAllowance`: an allowance
        // that ended on a date, and an instance with no administrator to ask.
        // M213 spec 05 added the three for the one door that HAS a page
        // behind it. The list is exhaustive on purpose, so a resurrected
        // signed-out string still fails here.
        ['allowanceEnded', 'noAllowance', 'notSwitchedOn', 'plansEnded', 'plansLink', 'plansNotSwitchedOn'],
        `${locale} still carries copy for a door that cannot be reached`,
      );
    }
  });

  it('still carries the one sentence that notice does show', () => {
    // THE CONTROL. Without it the assertion above passes against an empty
    // object, a renamed namespace and a catalog that failed to load at all.
    for (const { locale, aiIntake } of CATALOGS) {
      assert.ok(
        aiIntake.noAllowance?.includes('administrator') || aiIntake.noAllowance?.includes('Administrator'),
        `${locale} lost the sentence that names the administrator`,
      );
    }
  });
});
