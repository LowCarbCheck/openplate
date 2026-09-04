/**
 * `/forgot` and `/reset` — the two halves of "I have forgotten my password".
 *
 * ── The property that is a refusal ───────────────────────────────────────
 *
 * `/forgot` MUST ANSWER THE SAME WAY whether or not the address has an
 * account. The service returns `202` either way, deliberately, so that the
 * form cannot be used to ask whether a colleague is a member of the
 * organization; a screen that said "we could not find that address" would
 * rebuild the oracle in the UI. That is the first thing this file pins, and it
 * is pinned on the SCREEN rather than only on the client, because the client
 * already cannot tell the difference.
 *
 * ── And the three that are ordinary ──────────────────────────────────────
 *
 *  - `/reset` asks for a new password twice and never for the old one:
 *    somebody arriving there does not have it.
 *  - A dead token is one card pointing back at `/forgot`, covering unknown,
 *    spent and expired as one outcome — the service refuses to say which, and
 *    saying which would report whether a forwarded link had been used.
 *  - Success SIGNS THE PERSON IN, PULLS THE DIARY, and only then decides where
 *    to go. The last two are what 0.10.1 was missing: the ceremony opened the
 *    session and navigated to `/` immediately, so an account with a diary was
 *    handed the first-run questionnaire while its entries were still on the
 *    server.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWithZod } from '@conform-to/zod/v4';

import { buildResetFragment, consumeResetToken, takeResetLinkFromUrl } from '../../app/lib/join-link';
import { readPendingJoinField, sessionInviteStorage } from '../../app/lib/sync/invite-link';
import { makeSyncRecoverySchema } from '../../app/lib/sync/recovery-schema';
import { MIN_SYNC_PASSPHRASE_LENGTH, type Translate } from '../../app/lib/sync/setup-flow';

const SERVER_URL = 'https://sync.example.test';
const RESET_TOKEN = 'sr_HrKq9m2v4XbtLpQ0Zc-yWaGkQhLmNoPqRsTu';
const GOOD_PASSWORD = 'a correct horse battery staple';

/** Renders `key` plus any interpolation params, so both are assertable without i18next. */
const fakeT: Translate = (key, params) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`);

const forgotRoute = readFileSync(new URL('../../app/routes/forgot.tsx', import.meta.url), 'utf8');
const resetRoute = readFileSync(new URL('../../app/routes/reset.tsx', import.meta.url), 'utf8');

/** A window just real enough for `takeResetLinkFromUrl`, plus a `sessionStorage` for the pending slot. */
function withBrowser(hash: string): () => void {
  const values = new Map<string, string>();
  const fake = {
    location: { hash, pathname: '/reset', search: '' },
    history: {
      replaceState: (_state: null, _title: string, _url: string) => {
        fake.location.hash = '';
      },
    },
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'window', { value: fake, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
    configurable: true,
    writable: true,
  });
  return () => {
    consumeResetToken();
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', previousWindow);
    if (previousStorage === undefined) Reflect.deleteProperty(globalThis, 'sessionStorage');
    else Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
  };
}

// ---------------------------------------------------------------------------
// /forgot
// ---------------------------------------------------------------------------

describe('/forgot answers the same way for every address', () => {
  it('has ONE confirmation sentence, and no branch that could differ', () => {
    // The whole property, read off the source: there is exactly one success
    // string, and nothing between the submit and it that inspects an answer.
    assert.match(forgotRoute, /forgot\.sent/);
    assert.doesNotMatch(forgotRoute, /notFound|unknownEmail|noSuchAccount/i);
  });

  it('does not await the request, and swallows its failure', () => {
    // Both halves of the same decision. The answer is `202` whatever happened,
    // so there is nothing for the person to do differently and nothing true to
    // tell them; awaiting it would only be a chance to render something that
    // differs between the two cases.
    assert.match(forgotRoute, /void requestSyncPasswordReset/);
    assert.match(forgotRoute, /\.catch\(/);
    assert.match(forgotRoute, /setIsSent\(true\)/);
  });

  it('is client-only: nothing about this address is this server’s business', () => {
    assert.doesNotMatch(forgotRoute, /^export (async )?function (loader|action|clientLoader|clientAction)\b/m);
  });
});

// ---------------------------------------------------------------------------
// The reset link
// ---------------------------------------------------------------------------

describe('the reset link is read exactly like a join link', () => {
  it('reads the token out of the fragment and strips it in the same breath', () => {
    const restore = withBrowser(buildResetFragment({ serverUrl: SERVER_URL, resetToken: RESET_TOKEN }));
    try {
      const link = takeResetLinkFromUrl({ configuredSyncUrl: SERVER_URL });
      assert.deepEqual(link, { serverUrl: SERVER_URL, resetToken: RESET_TOKEN });
      // A token that sets a password on an account is at least as sensitive as
      // an invite, so it does not sit in the address bar either.
      assert.equal(globalThis.window.location.hash, '');
    } finally {
      restore();
    }
  });

  it('survives the reload the strip would otherwise make fatal', () => {
    const restore = withBrowser(buildResetFragment({ resetToken: RESET_TOKEN }));
    try {
      takeResetLinkFromUrl({ configuredSyncUrl: SERVER_URL });
      assert.equal(readPendingJoinField({ field: 'reset', storage: sessionInviteStorage() }), RESET_TOKEN);
      assert.equal(takeResetLinkFromUrl({ configuredSyncUrl: SERVER_URL }).resetToken, RESET_TOKEN);
    } finally {
      restore();
    }
  });

  it('refuses an invite pasted where a reset token belongs', () => {
    // The commonest paste mistake, caught locally rather than remotely: the
    // service would answer `404`, which reads as "your link has expired".
    const restore = withBrowser('#token=si_an-invite-not-a-reset');
    try {
      assert.equal(takeResetLinkFromUrl({ configuredSyncUrl: SERVER_URL }).resetToken, null);
    } finally {
      restore();
    }
  });

  it('parks nothing from a link that belongs to another openplate', () => {
    const restore = withBrowser(
      buildResetFragment({ serverUrl: 'https://other.example.test', resetToken: RESET_TOKEN }),
    );
    try {
      takeResetLinkFromUrl({ configuredSyncUrl: SERVER_URL });
      assert.equal(readPendingJoinField({ field: 'reset', storage: sessionInviteStorage() }), null);
    } finally {
      restore();
    }
  });

  it('and the invite slot is untouched by all of it', () => {
    // Two capabilities, two fields. `/reset` reading a join fragment would
    // leave an invite in the slot that `/join` then offers, to somebody who
    // came to change a password.
    const restore = withBrowser(buildResetFragment({ resetToken: RESET_TOKEN }));
    try {
      takeResetLinkFromUrl({ configuredSyncUrl: SERVER_URL });
      assert.equal(readPendingJoinField({ field: 'invite', storage: sessionInviteStorage() }), null);
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// /reset
// ---------------------------------------------------------------------------

describe('/reset asks for a new password and nothing else', () => {
  const parse = (values: Record<string, string>) => {
    const formData = new FormData();
    for (const [name, value] of Object.entries(values)) formData.append(name, value);
    return parseWithZod(formData, { schema: makeSyncRecoverySchema(fakeT) });
  };

  it('accepts a new password and its confirmation', () => {
    assert.equal(parse({ passphrase: GOOD_PASSWORD, confirmPassphrase: GOOD_PASSWORD }).status, 'success');
  });

  it('holds the new password to the signup floor', () => {
    const submission = parse({ passphrase: 'short', confirmPassphrase: 'short' });
    assert.equal(submission.status, 'error');
    assert.match(
      JSON.stringify(submission.status === 'error' ? submission.error : {}),
      new RegExp(String(MIN_SYNC_PASSPHRASE_LENGTH)),
    );
  });

  it('never asks for the old password, and never shows a recovery code', () => {
    // Somebody arriving here does not have the old one. And the code the
    // ceremony underneath uses came from the service moments earlier and is
    // dropped when that call frame ends (M192).
    assert.doesNotMatch(resetRoute, /currentPassword|currentPassphrase/);
    assert.doesNotMatch(resetRoute, /recoveryCode/);
  });

  it('consumes the token on SUBMIT, not on mount', () => {
    // Until the submit a reload has to be able to bring the token back; after
    // it, a later visit must not resurrect one the service has spent.
    const submitBody = resetRoute.slice(resetRoute.indexOf('async function submit'));
    assert.match(submitBody, /consumeResetToken\(\)/);
    const effectBody = resetRoute.slice(resetRoute.indexOf('useEffect('), resetRoute.indexOf('async function submit'));
    assert.doesNotMatch(effectBody, /consumeResetToken/);
  });

  it('pulls the diary before it decides anywhere to send anybody', () => {
    // THE DEFECT, in one line. Walking 0.10.1: the escrow worked, the password
    // was set, the session opened, and an account with a diary was handed the
    // first-run questionnaire, because the gate was asked while the profile
    // row was still inside an undownloaded snapshot. The salad turned up
    // afterwards, behind the answers.
    const submitBody = resetRoute.slice(resetRoute.indexOf('async function submit'));
    assert.match(submitBody, /firstPull\.start\(\)/, 'a finished reset runs the first pull');
    assert.doesNotMatch(submitBody, /navigate\(/, 'and the ceremony itself navigates nowhere');
  });

  it('lands exactly where a sign-in lands, never on the marketing page', () => {
    // `useFirstPull` reads the gate and hands back a path; the route follows
    // it. `/` is the landing page, which describes the app to somebody who
    // does not have it.
    assert.match(resetRoute, /useFirstPull/);
    assert.match(resetRoute, /onArrived:.*navigate\(path\)/s);
    assert.doesNotMatch(resetRoute, /navigate\('\/'\)/, 'the marketing page is not a destination');
    assert.doesNotMatch(resetRoute, /navigate\('\/sign-in'\)/, 'a completed reset must not ask for a password again');
  });

  it('shows the retry card on a failed pull, and keeps the new password', () => {
    // The session is OPEN and the password IS set: only the download failed.
    // Signing out here, or falling through to `/onboarding`, is the bug M183
    // spec 03 exists to kill.
    assert.match(resetRoute, /FirstPullStatus/);
    assert.match(resetRoute, /onRetry=\{firstPull\.start\}/);
    assert.doesNotMatch(resetRoute, /signOutOfSync/);
  });

  it('runs the SAME pull as /sign-in, not a second copy of it', () => {
    // Two screens with one rule between them is one screen too many. `/reset`
    // had no pull at all until this fix, and a copied one would have been the
    // next thing to drift.
    const pullHook = readFileSync(new URL('../../app/hooks/use-first-pull.ts', import.meta.url), 'utf8');
    assert.match(pullHook, /syncNow/);
    assert.match(pullHook, /readOnboardingGateKind/);
    assert.doesNotMatch(resetRoute, /completeSignIn|syncNow/, 'the route runs no cycle of its own');
  });

  it('sends a dead token back to /forgot rather than to an error screen', () => {
    assert.match(resetRoute, /status: 'invalid-token'/);
    assert.match(resetRoute, /to="\/forgot"/);
  });

  it('is client-only: no loader could read the fragment even if one existed', () => {
    assert.doesNotMatch(resetRoute, /^export (async )?function (loader|action|clientLoader|clientAction)\b/m);
  });
});
