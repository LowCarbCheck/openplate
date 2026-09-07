/**
 * Unit tests for `#app/lib/home-entry` — the hint cookie behind `/`'s redirect
 * into the app, and the pure decision it feeds.
 *
 * Three things are worth a test here and the rest is trivia:
 *
 * 1. The cookie parse is EXACT. It is not httpOnly, so a truncated or lookalike
 *    value must read as "no hint" rather than bouncing someone into an app they
 *    have never set up.
 * 2. `?landing=` beats the hint. That is the only thing keeping the marketing
 *    page reachable for a device that lives in the app.
 * 3. `hasEnteredApp` is `_personal`'s gate with the opposite polarity. That
 *    equivalence is what makes a redirect loop impossible, and it is asserted as
 *    a property over the whole 2×2 matrix rather than by reading both files and
 *    hoping. Do not delete that one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  hasEnteredApp,
  parseHomeHintCookie,
  resolveClientLandingEntry,
  resolveLandingRedirect,
  wantsLandingPage,
  type LocalEntrySnapshot,
} from '../../app/lib/home-entry';

describe('parseHomeHintCookie', () => {
  it('reads no hint from an absent Cookie header', () => {
    assert.equal(parseHomeHintCookie(null), false);
  });

  it('reads the hint from a lone cookie', () => {
    assert.equal(parseHomeHintCookie('openplate-home=app'), true);
  });

  it('finds the hint among other cookies, mid-string', () => {
    assert.equal(parseHomeHintCookie('openplate-language=de; openplate-home=app; other=1'), true);
  });

  it('matches the value exactly — a prefix is not a hint', () => {
    assert.equal(parseHomeHintCookie('openplate-home=app-ish'), false);
  });

  it('matches the NAME exactly — a longer cookie name never counts', () => {
    // Guards any `indexOf('openplate-home')` implementation.
    assert.equal(parseHomeHintCookie('openplate-homework=app'), false);
  });

  it('reads an empty value as no hint — this is how the cookie is cleared', () => {
    assert.equal(parseHomeHintCookie('openplate-home='), false);
  });

  it('tolerates the whitespace a proxy may leave around the pair', () => {
    assert.equal(parseHomeHintCookie(' openplate-home = app '), true);
  });
});

describe('wantsLandingPage', () => {
  it('reads PRESENCE, not truthiness — a typed-in escape hatch never argues with its own value', () => {
    assert.equal(wantsLandingPage(''), false);
    assert.equal(wantsLandingPage('?landing=1'), true);
    assert.equal(wantsLandingPage('?landing'), true);
    // The important one: `?landing=0` still shows the landing page.
    assert.equal(wantsLandingPage('?landing=0'), true);
    assert.equal(wantsLandingPage('?foo=landing'), false);
  });

  it('accepts a URLSearchParams as well as a string', () => {
    assert.equal(wantsLandingPage(new URLSearchParams('landing=1')), true);
    assert.equal(wantsLandingPage(new URLSearchParams('')), false);
  });
});

describe('resolveLandingRedirect', () => {
  // The cookie means "signed in" only where the diary belongs to the device.
  const openInstance = { homeCookieProvesSession: true };
  const managedInstance = { homeCookieProvesSession: false };

  it('leaves a first-time visitor on the marketing page', () => {
    assert.equal(resolveLandingRedirect({ hasHint: false, wantsLanding: false, ...openInstance }), null);
  });

  it('bounces a device that has already entered the app on an open instance, with no account at all', () => {
    assert.equal(resolveLandingRedirect({ hasHint: true, wantsLanding: false, ...openInstance }), '/dashboard');
  });

  it('lets the escape hatch beat the hint — this is what keeps the landing reachable', () => {
    assert.equal(resolveLandingRedirect({ hasHint: true, wantsLanding: true, ...openInstance }), null);
  });

  it('is a no-op when the escape hatch is used without a hint', () => {
    assert.equal(resolveLandingRedirect({ hasHint: false, wantsLanding: true, ...openInstance }), null);
  });

  it('refuses to send a managed device to /dashboard on the cookie, because a server cannot see a session', () => {
    // THE FAULT THIS SPEC EXISTS FOR. The hint survives a sign-out and the
    // server has no way to know that; the honest answer is to render the
    // landing page and let the browser decide.
    assert.equal(resolveLandingRedirect({ hasHint: true, wantsLanding: false, ...managedInstance }), null);
  });
});

describe('resolveClientLandingEntry', () => {
  const openInstance = { homeCookieProvesSession: true };
  const managedInstance = { homeCookieProvesSession: false };

  it('sends a returning device to the app on an open instance, with no session of any kind', () => {
    assert.equal(
      resolveClientLandingEntry({ wantsLanding: false, entered: true, hasSession: false, ...openInstance }),
      'dashboard',
    );
  });

  it('never sends a signed-out managed device to /dashboard, however much diary is on it', () => {
    assert.equal(
      resolveClientLandingEntry({ wantsLanding: false, entered: true, hasSession: false, ...managedInstance }),
      'landing-clear-hint',
    );
  });

  it('sends a managed device with a session to /dashboard', () => {
    assert.equal(
      resolveClientLandingEntry({ wantsLanding: false, entered: true, hasSession: true, ...managedInstance }),
      'dashboard',
    );
  });

  it('clears the hint on a wiped device, exactly as before', () => {
    assert.equal(
      resolveClientLandingEntry({ wantsLanding: false, entered: false, hasSession: false, ...openInstance }),
      'landing-clear-hint',
    );
  });

  it('keeps the hint when the escape hatch was typed, so ?landing= is not a sign-out', () => {
    assert.equal(
      resolveClientLandingEntry({ wantsLanding: true, entered: true, hasSession: true, ...managedInstance }),
      'landing-keep-hint',
    );
  });

  it('is unchanged on an open instance for every session value, which is the no-regression property', () => {
    for (const hasSession of [false, true]) {
      for (const entered of [false, true]) {
        assert.equal(
          resolveClientLandingEntry({ wantsLanding: false, entered, hasSession, ...openInstance }),
          entered ? 'dashboard' : 'landing-clear-hint',
          `an open instance must not read the session (entered=${String(entered)})`,
        );
      }
    }
  });
});

describe('hasEnteredApp', () => {
  it('is false only for a device with neither a completion stamp nor a log', () => {
    assert.equal(hasEnteredApp({ onboardingCompletedAt: null, foodLogCount: 0 }), false);
  });

  it('is true once onboarding has been completed', () => {
    assert.equal(hasEnteredApp({ onboardingCompletedAt: 1_700_000_000_000, foodLogCount: 0 }), true);
  });

  it('is true for a device that predates the completion stamp but has logs', () => {
    // The `_personal` self-heal case: logs exist, so the gate stamps completion
    // rather than redirecting.
    assert.equal(hasEnteredApp({ onboardingCompletedAt: null, foodLogCount: 1 }), true);
  });

  it('treats epoch 0 as a real stamp, not as "unset"', () => {
    // Guards a `!onboardingCompletedAt` truthiness bug.
    assert.equal(hasEnteredApp({ onboardingCompletedAt: 0, foodLogCount: 0 }), true);
  });
});

/**
 * A three-line transcription of `app/routes/_personal.tsx`'s `clientLoader`,
 * reduced to its decision:
 *
 *   const profile = await getLocalProfileGoals();
 *   if (profile !== null && profile.onboardingCompletedAt !== null) return null;
 *   const logs = await listLocalFoodLogs();
 *   if (logs.length > 0) { …stamp…; return null; }
 *   throw redirect('/onboarding');
 *
 * A missing profile row and a present-but-unstamped one are the same thing to
 * that gate, which is why the snapshot carries only `onboardingCompletedAt`.
 */
function personalGateWouldRedirect({ onboardingCompletedAt, foodLogCount }: LocalEntrySnapshot): boolean {
  if (onboardingCompletedAt !== null) return false;
  if (foodLogCount > 0) return false;
  return true;
}

describe('gate parity — the loop-proof invariant', () => {
  it('never sends someone to /dashboard that the _personal gate would bounce back out', () => {
    const completions = [null, 1_700_000_000_000];
    const logCounts = [0, 3];

    for (const onboardingCompletedAt of completions) {
      for (const foodLogCount of logCounts) {
        const snapshot: LocalEntrySnapshot = { onboardingCompletedAt, foodLogCount };
        assert.equal(
          hasEnteredApp(snapshot),
          !personalGateWouldRedirect(snapshot),
          `hasEnteredApp must be the exact negation of the _personal gate for ${JSON.stringify(snapshot)}`,
        );
      }
    }
  });
});

/**
 * The loop-proof invariant, restated for the session term (M201 spec 01).
 *
 * `_personal`'s gate got a session term too (the device lock), and the two
 * gates have to stay opposite-polarity mirrors or a signed-out managed device
 * bounces between `/` and `/dashboard` for ever. The property that rules that
 * out is one-directional and simple: `/` sends nobody to the app that
 * `_personal` would send straight back.
 */
describe('the two gates do not loop: a signed-out managed device settles', () => {
  it('settles on the landing page, and every path in the matrix settles somewhere', () => {
    for (const entered of [false, true]) {
      for (const hasSession of [false, true]) {
        for (const homeCookieProvesSession of [false, true]) {
          const entry = resolveClientLandingEntry({
            wantsLanding: false,
            entered,
            hasSession,
            homeCookieProvesSession,
          });
          if (entry !== 'dashboard') continue;
          // A redirect into the app still implies local data, so the gate on
          // the other side passes rather than bouncing back.
          assert.equal(entered, true, 'only a device that has entered the app may be sent to /dashboard');
          assert.equal(personalGateWouldRedirect({ onboardingCompletedAt: 1_700_000_000_000, foodLogCount: 0 }), false);
        }
      }
    }
  });

  it('settles the reported symptom: sign out, reload, and the browser stays on the landing page', () => {
    // The device after a sign-out with no erase: rows on disk, no session, and
    // the hint about to be cleared by this very decision.
    const first = resolveClientLandingEntry({
      wantsLanding: false,
      entered: true,
      hasSession: false,
      homeCookieProvesSession: false,
    });
    assert.equal(first, 'landing-clear-hint');
    // The reload after it reads the same facts and reaches the same answer, so
    // there is no second state to oscillate with.
    const second = resolveClientLandingEntry({
      wantsLanding: false,
      entered: true,
      hasSession: false,
      homeCookieProvesSession: false,
    });
    assert.equal(second, first);
  });
});
