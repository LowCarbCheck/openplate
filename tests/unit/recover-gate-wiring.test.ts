/**
 * WIRING guard for the data-loss recovery path (M123 spec 01).
 *
 * `onboarding-gate.test.ts` proves the DECISION is right. This file proves the
 * decision is actually the one the app takes: that `_personal.tsx`'s gate
 * delegates to the resolver instead of re-deriving the branches inline, that
 * the `recover` outcome ends at `/recover` and never at `/onboarding`, and that
 * `/recover` is registered where its own gate cannot bounce it.
 *
 * Source-text assertions rather than an executed loader, because the loader
 * reads IndexedDB through the local-store singleton and this repo's unit runner
 * has no module mocking (`node --import tsx --test`, no `--experimental-test-
 * module-mocks`). The three facts below are the ones a regression would break,
 * and all three are visible in the source without running it.
 *
 * If you are reading this because a test here failed: the gate stopped routing
 * a wiped device to its recovery screen, which means it is showing that device
 * the first-run wizard again. That is the exact bug this spec closed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const personalSource = readFileSync(new URL('../../app/routes/_personal.tsx', import.meta.url), 'utf8');
const recoverSource = readFileSync(new URL('../../app/routes/recover.tsx', import.meta.url), 'utf8');
const routesSource = readFileSync(new URL('../../app/routes.ts', import.meta.url), 'utf8');

/** The body of `clientLoader`, comments included — everything up to the `hydrate` flag. */
function clientLoaderSource(): string {
  // Matched WITHOUT the argument list: the gate took a `{ request }` argument
  // when `/settings/preferences` became exempt, and a signature-exact grep here
  // would fail on every future argument change while proving nothing.
  const start = personalSource.indexOf('export async function clientLoader(');
  const end = personalSource.indexOf('clientLoader.hydrate');
  assert.ok(start !== -1 && end > start, '_personal.tsx no longer has a clientLoader to check');
  return personalSource.slice(start, end);
}

describe('the _personal gate consults the had-data marker', () => {
  it('reads the marker from the local store', () => {
    assert.match(personalSource, /hasEverHadData/);
  });

  it('delegates the branch order to the shared resolver', () => {
    assert.match(clientLoaderSource(), /resolveOnboardingGate\(/);
  });

  it('sends the recover outcome to /recover', () => {
    assert.match(clientLoaderSource(), /'recover'[\s\S]*redirect\('\/recover'\)/);
  });

  it('has exactly one /onboarding redirect, guarded by the onboarding outcome', () => {
    const body = clientLoaderSource();
    assert.equal(body.match(/redirect\('\/onboarding'\)/g)?.length, 1);
    assert.match(body, /outcome\.kind === 'onboarding'\) throw redirect\('\/onboarding'\)/);
  });
});

describe('the gate exempts the preferences page before it decides anything', () => {
  // The exemption has to come FIRST. Placed after the store reads it would
  // still work, but placed after the redirects it would not exist at all — so
  // the assertion is about the order, not just the presence of the call.
  it('consults the exemption before it reaches the resolver', () => {
    const body = clientLoaderSource();
    const exemptAt = body.indexOf('isOnboardingGateExempt(');
    const resolveAt = body.indexOf('resolveOnboardingGate(');
    assert.ok(exemptAt !== -1, 'the gate no longer consults isOnboardingGateExempt');
    assert.ok(exemptAt < resolveAt, 'the exemption must be checked before the gate decides');
  });
});

describe('/recover is reachable from a wiped device', () => {
  it('is registered at /recover', () => {
    assert.match(routesSource, /route\('\/recover', 'routes\/recover\.tsx'\)/);
  });

  it('is registered outside the _personal layout, whose gate redirects to it', () => {
    const personalLayout = routesSource.slice(routesSource.indexOf("layout('routes/_personal.tsx'"));
    assert.doesNotMatch(personalLayout, /routes\/recover\.tsx/);
  });

  // A loader or clientLoader here would be one more thing that can fail on a
  // device that is already in a broken state — and a server loader would mean
  // the route depends on a network this screen must work without.
  it('exports no loader, action or clientLoader', () => {
    assert.doesNotMatch(recoverSource, /export (async )?function (loader|action|clientLoader|clientAction)\b/);
  });

  it('offers a restore from a backup file', () => {
    assert.match(recoverSource, /restoreBackup\(/);
  });
});
