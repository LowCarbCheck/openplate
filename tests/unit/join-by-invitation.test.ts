/**
 * `/join` — the page an invited person lands on.
 *
 * ── What is worth pinning here ───────────────────────────────────────────
 *
 * Not the render, which is dull, but the five rules the page enforces and
 * which nothing else can catch:
 *
 *  1. The lookup is IDEMPOTENT and the signup is not. Invite links get fetched
 *     by mail scanners and link previewers, so a page load must burn nothing:
 *     `invite-lookup` reads, and the signup that redeems waits for a person to
 *     choose a password.
 *  2. The invite SURVIVES a reload before the submit. The fragment is stripped
 *     as it is read, and on a production first visit the whole document
 *     reloads when the service worker takes control; without the pending slot
 *     the person lands on a page with their one capability already destroyed.
 *  3. The address is SHOWN, never asked for. A field would let somebody create
 *     an account at an address nobody invited.
 *  4. A `409` leads to sign-in, not to a field error. Nothing typed on this
 *     form fixes an account that already exists.
 *  5. A dead invite is ONE card. The service refuses to say which of unknown,
 *     spent, revoked or expired it was, and the person's next step is the same
 *     for all four.
 *
 * The page itself is a route with an effect and a fetch, so what is exercised
 * below is the seam each rule actually lives on: the link parser, the pending
 * slot, the signup schema, and the failure classifier. That is the same shape
 * `sign-in-flow.test.ts` uses, and the route wiring is asserted by reading the
 * source rather than by rendering it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWithZod } from '@conform-to/zod/v4';

import { consumeSyncInvite, parseJoinFragment, takeJoinLinkFromUrl } from '../../app/lib/join-link';
import { readPendingInvite, sessionInviteStorage } from '../../app/lib/sync/invite-link';
import { makeSyncSignupSchema } from '../../app/lib/sync/signup-schema';
import { classifySignupFailure } from '../../app/lib/sync/signup-error';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';
import type { Translate } from '../../app/lib/sync/setup-flow';

const SERVER_URL = 'https://sync.example.test';
const INVITE = 'si_pMTz3s2n4h9QeQnQ0O_zA-3aWjIvbCzHkqk';
const GOOD_PASSWORD = 'a correct horse battery staple';

/** Renders `key` plus any interpolation params, so both are assertable without i18next. */
const fakeT: Translate = (key, params) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`);

const route = readFileSync(new URL('../../app/routes/join.tsx', import.meta.url), 'utf8');

/** A window just real enough for `takeJoinLinkFromUrl`, plus a `sessionStorage` for the pending slot. */
function withBrowser(hash: string): () => void {
  const values = new Map<string, string>();
  const fake = {
    location: { hash, pathname: '/join', search: '' },
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
    consumeSyncInvite();
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', previousWindow);
    if (previousStorage === undefined) Reflect.deleteProperty(globalThis, 'sessionStorage');
    else Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
  };
}

// ---------------------------------------------------------------------------
// 1 and 2: the link, read once, parked, and survivable
// ---------------------------------------------------------------------------

describe('the invitation survives arriving', () => {
  it('reads the invite out of the fragment and strips it in the same breath', () => {
    const restore = withBrowser(`#server=${encodeURIComponent(SERVER_URL)}&invite=${INVITE}`);
    try {
      const link = takeJoinLinkFromUrl({ configuredSyncUrl: SERVER_URL });
      assert.equal(link.invite, INVITE);
      // The token must not sit in the address bar for a screenshot or a screen
      // share to carry.
      assert.equal(globalThis.window.location.hash, '');
    } finally {
      restore();
    }
  });

  it('SURVIVES the reload the strip would otherwise make fatal', () => {
    // The production first visit reloads the whole document when the service
    // worker takes control. Without the pending slot the fragment is gone, the
    // in-memory copy is gone, and the person lands on a page that no longer
    // knows they were invited.
    const restore = withBrowser(`#invite=${INVITE}`);
    try {
      takeJoinLinkFromUrl({ configuredSyncUrl: SERVER_URL });
      assert.equal(readPendingInvite(sessionInviteStorage()), INVITE, 'the invite must be parked');
      assert.equal(takeJoinLinkFromUrl({ configuredSyncUrl: SERVER_URL }).invite, INVITE, 'and read again after');
    } finally {
      restore();
    }
  });

  it('parks nothing from a link that belongs to another openplate', () => {
    const restore = withBrowser(`#server=${encodeURIComponent('https://other.example.test')}&invite=${INVITE}`);
    try {
      takeJoinLinkFromUrl({ configuredSyncUrl: SERVER_URL });
      // A token this app can never spend, sitting in the slot, would be picked
      // up by the next link read and offered as a signup on somebody else's
      // server.
      assert.equal(readPendingInvite(sessionInviteStorage()), null);
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 3: the address is shown, never asked for
// ---------------------------------------------------------------------------

describe('the form asks for a password, and not for an address', () => {
  const parse = (values: Record<string, string>) => {
    const formData = new FormData();
    for (const [name, value] of Object.entries(values)) formData.append(name, value);
    return parseWithZod(formData, { schema: makeSyncSignupSchema(fakeT, { invite: 'required' }) });
  };

  it('accepts an invite, a password and a confirmation', () => {
    const submission = parse({ invite: INVITE, passphrase: GOOD_PASSWORD, confirmPassphrase: GOOD_PASSWORD });
    assert.equal(submission.status, 'success');
  });

  it('carries no address, whatever is posted alongside it', () => {
    // The service reads the address off the invite. A form that collected one
    // would let somebody create an account at an address their admin did not
    // invite, and the schema is where that becomes impossible rather than
    // merely absent from the markup.
    const submission = parse({
      invite: INVITE,
      email: 'somebody-else@example.org',
      passphrase: GOOD_PASSWORD,
      confirmPassphrase: GOOD_PASSWORD,
    });
    assert.equal(submission.status, 'success');
    assert.equal(submission.status === 'success' && 'email' in submission.value, false);
  });

  it('reports a mismatch under the confirmation, not over the button', () => {
    const submission = parse({ invite: INVITE, passphrase: GOOD_PASSWORD, confirmPassphrase: 'something else' });
    assert.equal(submission.status, 'error');
    assert.deepEqual(Object.keys(submission.status === 'error' ? (submission.error ?? {}) : {}), ['confirmPassphrase']);
  });

  it('shows the invited address rather than a field for it', () => {
    assert.match(route, /join\.invitedAs/);
    assert.doesNotMatch(route, /getInputProps\(fields\.email/, 'the join form must not collect an address');
  });
});

// ---------------------------------------------------------------------------
// 4 and 5: the two refusals
// ---------------------------------------------------------------------------

describe('the two refusals lead somewhere', () => {
  it('a 409 is an account that exists, and the page offers sign-in for it', () => {
    const conflict = new SyncRequestError({ kind: 'conflict', message: 'an account already exists', status: 409 });
    assert.equal(classifySignupFailure(conflict), 'account-exists');
    // The route swaps the whole card rather than putting an error under a
    // field: nothing typed on this form fixes an account that already exists.
    assert.match(route, /already-registered/);
    assert.match(route, /navigate\('\/sign-in'\)/);
  });

  it('a dead invite is one card, whatever made it dead', () => {
    // Unknown, spent, revoked and expired are one `404` on the wire and one
    // screen here. Telling them apart would let a caller probe which tokens
    // exist.
    assert.match(route, /invite-invalid/);
    assert.match(route, /join\.inviteInvalid\.body/);
  });

  it('never redeems on load: the signup waits for a submitted form', () => {
    // Invite links get fetched by mail scanners and link previewers, so a bare
    // GET of this page must burn nothing. The only call the effect makes is
    // the idempotent lookup.
    assert.match(route, /readSyncInvite/);
    // Checked as an IMPORT rather than as a mention: the route cannot call the
    // signup without importing it, and the name legitimately appears in prose
    // above (`CreateAccountPanel` is what owns the call).
    assert.doesNotMatch(route, /import[^;]*\bcreateSyncAccount\b/, 'the signup belongs to the form, not the effect');
  });
});

// ---------------------------------------------------------------------------
// The route's own shape
// ---------------------------------------------------------------------------

describe('/join stays client-only', () => {
  it('exports no loader and no action', () => {
    // The token rides in the FRAGMENT, which no browser sends anywhere, so
    // there is nothing here a loader could read even if one existed.
    assert.doesNotMatch(route, /^export (async )?function (loader|action|clientLoader|clientAction)\b/m);
  });

  it('parses a fragment with no invite as the one invalid case', () => {
    assert.deepEqual(parseJoinFragment(`#server=${encodeURIComponent(SERVER_URL)}`), {
      serverUrl: SERVER_URL,
      invite: null,
    });
    assert.match(route, /invalid-link/);
  });
});
