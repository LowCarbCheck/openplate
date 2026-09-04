/**
 * The post-sign-in decision (`app/lib/sign-in-flow.ts`) and the wiring of
 * `/sign-in` around it (M183 spec 03).
 *
 * Two things are pinned here, and both are the same bug from opposite sides.
 * The DESTINATION must never be the questionnaire for somebody whose pulled
 * profile says they are onboarded, and a FAILED PULL must never be treated as
 * "no profile, therefore a new person" — that is exactly how a returning user
 * meets the first-run wizard, which this milestone exists to stop.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { completeSignIn, resolveSignInDestination } from '../../app/lib/sign-in-flow';

describe('resolveSignInDestination', () => {
  it('sends an onboarded profile to the diary', () => {
    assert.equal(resolveSignInDestination({ gate: 'pass' }), '/diary');
  });

  it('sends a pre-stamp device with logs to the diary, where the layout stamps it', () => {
    assert.equal(resolveSignInDestination({ gate: 'self-heal' }), '/diary');
  });

  it('sends an account whose snapshot held no onboarded profile to the questionnaire', () => {
    assert.equal(resolveSignInDestination({ gate: 'welcome' }), '/onboarding');
  });

  it('never answers /welcome, which would bounce the person back to the screen they came from', () => {
    for (const gate of ['pass', 'self-heal', 'recover', 'welcome'] as const) {
      assert.notEqual(resolveSignInDestination({ gate }), '/welcome');
    }
  });

  // WHAT M192 DELETED: a `/join` answer for a parked GATEWAY half. One link
  // carries one capability now, and signing in spends all of it, so there is
  // no half left to strand and `/join` is unreachable from here.
  it('never answers /join, which a completed sign-in has nothing left to finish', () => {
    for (const gate of ['pass', 'self-heal', 'recover', 'welcome'] as const) {
      // A DEAD COMPARISON by construction — `/join` left the union — and that
      // is the point: the destination is collected into a `string[]` so the
      // assertion is legal without an assertion, and it documents the removal
      // rather than restating the type.
      const reachable: string[] = [resolveSignInDestination({ gate })];
      assert.equal(reachable.includes('/join'), false, gate);
    }
  });

  it('lets possible data loss outrank everything else', () => {
    assert.equal(resolveSignInDestination({ gate: 'recover' }), '/recover');
  });
});

describe('completeSignIn', () => {
  it('asks for the destination only after the pull has finished', async () => {
    const order: string[] = [];
    const outcome = await completeSignIn({
      pull: async () => {
        order.push('pull');
      },
      readDestination: async () => {
        order.push('read');
        return '/diary';
      },
    });

    assert.deepEqual(order, ['pull', 'read']);
    assert.deepEqual(outcome, { status: 'navigate', path: '/diary' });
  });

  it('reports a failed pull instead of throwing, and never reads a destination from the stale store', async () => {
    let didRead = false;
    const cause = new Error('offline');
    const outcome = await completeSignIn({
      pull: () => Promise.reject(cause),
      readDestination: async () => {
        didRead = true;
        return '/onboarding';
      },
    });

    assert.equal(didRead, false);
    assert.deepEqual(outcome, { status: 'pull-failed', cause });
  });
});

describe('/sign-in wiring', () => {
  const route = readFileSync(new URL('../../app/routes/sign-in.tsx', import.meta.url), 'utf8');

  it('runs a real sync cycle and asks the real gate', () => {
    assert.match(route, /syncNow/);
    assert.match(route, /resolveOnboardingGate/);
  });

  it('prefills the remembered name and can disown it', () => {
    assert.match(route, /readAccountHint/);
    assert.match(route, /clearAccountHint/);
  });

  it('sends "forgot password" to its own page rather than opening a form here', () => {
    // A reset takes minutes and arrives by mail. A card three taps deep inside
    // a sign-in screen is not somewhere a person can come back to, so `/forgot`
    // is a page and this route only links to it (M192/05).
    assert.match(route, /navigate\('\/forgot'\)/);
    assert.doesNotMatch(route, /SyncResetRequestForm|SyncRecoveryFlow/);
  });

  it('keeps a failed pull signed in', () => {
    assert.doesNotMatch(route, /signOutOfSync/);
  });

  it('has no server loader: nothing it reads is any of the server business', () => {
    assert.doesNotMatch(route, /^export (async )?function (loader|action)/m);
  });
});
