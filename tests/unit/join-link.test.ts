/**
 * The join link: one fragment, one service.
 *
 * What is worth testing here is not the parse, which is dull, but the four
 * rules the parse enforces and which nothing else can catch:
 *
 *  1. A link with no invite is the one invalid case.
 *  2. A token is bound to its service by prefix, so a value of the wrong shape
 *     yields NO token rather than one this client would post and have refused.
 *  3. The address in the link is a check, never an instruction.
 *  4. Reading the fragment strips it, and what was read survives the reload
 *     that the strip would otherwise make fatal.
 *
 * M192 narrowed this from two services to one. The `sync=` spelling is still
 * READ, because links minted before that change are already in people's
 * mailboxes, and the test below is what stops a tidy-up from dropping it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildJoinFragment,
  consumeSyncInvite,
  isForeignSyncServer,
  isJoinLinkEmpty,
  parseJoinFragment,
  parseJoinLinkInput,
  takeJoinLinkFromUrl,
} from '#app/lib/join-link';
import { PENDING_INVITE_STORAGE_KEY, readPendingInvite, sessionInviteStorage } from '#app/lib/sync/invite-link';

const SERVER_URL = 'https://sync.example.test';
const INVITE = 'si_pMTz3s2n4h9QeQnQ0O_zA-3aWjIvbCzHkqk';

function fragmentFor(link: Parameters<typeof buildJoinFragment>[0]): string {
  return buildJoinFragment(link);
}

// ---------------------------------------------------------------------------
// The shapes of link
// ---------------------------------------------------------------------------

test('a link with an address and an invite parses to both, and round-trips through the builder', () => {
  const whole = { serverUrl: SERVER_URL, invite: INVITE };
  const link = parseJoinFragment(fragmentFor(whole));
  assert.deepEqual(link, whole);
  // The builder is the ONE place a link is written, so its output has to be
  // exactly what the reader accepts.
  assert.equal(fragmentFor(link), fragmentFor(whole));
});

test('an invite with no address still admits somebody — the address is only a check', () => {
  const link = parseJoinFragment(fragmentFor({ invite: INVITE }));
  assert.equal(link.invite, INVITE);
  assert.equal(link.serverUrl, null);
  assert.equal(isJoinLinkEmpty(link), false);
});

/**
 * THE SHARED FIXTURE. The exact string the operator CLI emits for these
 * inputs, asserted here against the parser and in
 * `djinn/openplate/join-link.test.ts` against the builder. djinn cannot import
 * this module, so the grammar is written twice; this literal is what stops the
 * two copies drifting apart.
 */
const CANONICAL_JOIN_FRAGMENT = '#server=https%3A%2F%2Fsync.example.test&invite=si_pMTz3s2n4h9QeQnQ0O_zA-3aWjIvbCzHkqk';

test('the canonical operator link parses to both fields, and rebuilds to itself', () => {
  const link = parseJoinFragment(CANONICAL_JOIN_FRAGMENT);
  assert.deepEqual(link, { serverUrl: SERVER_URL, invite: INVITE });
  assert.equal(fragmentFor(link), CANONICAL_JOIN_FRAGMENT);
});

test('a link minted before M192 spells the address `sync=`, and still parses', () => {
  // THE COMPATIBILITY THIS PINS: those links are in mailboxes already, and the
  // address is only a check — dropping the spelling would turn a working
  // invitation into a "this link is for another service" card.
  const legacy = `#sync=${encodeURIComponent(SERVER_URL)}&invite=${INVITE}`;
  assert.deepEqual(parseJoinFragment(legacy), { serverUrl: SERVER_URL, invite: INVITE });
});

test('a link with no capability at all is the one invalid case', () => {
  assert.equal(isJoinLinkEmpty(parseJoinFragment('')), true);
  assert.equal(isJoinLinkEmpty(parseJoinFragment('#')), true);
  assert.equal(isJoinLinkEmpty(parseJoinFragment('#from=chat')), true);
  // An address with no invite admits nobody.
  assert.equal(isJoinLinkEmpty(parseJoinFragment(fragmentFor({ serverUrl: SERVER_URL }))), true);
});

test('the builder omits an absent field rather than writing it empty', () => {
  // `#invite=` is a link that looks like it carries an invitation and does not.
  const fragment = fragmentFor({ invite: null, serverUrl: '' });
  assert.equal(fragment.includes('invite'), false);
  assert.equal(fragment.includes('server'), false);
  assert.equal(fragmentFor({}), '');
});

test('a base64url token survives the parse intact', () => {
  // The service mints `randomBytes(32).toString('base64url')`, so `-` and `_`
  // are ordinary characters here. A parser that mangled them would produce a
  // token that looks right and is refused.
  const token = 'si_VZPqQ8gRzJ9i4wJMxfYlOZeyfqBPPwgN5e-BrMnh5R4';
  assert.equal(parseJoinFragment(`#invite=${token}`).invite, token);
});

// ---------------------------------------------------------------------------
// A token is bound to its shape
// ---------------------------------------------------------------------------

test('a token without the service prefix is refused rather than prefilled', () => {
  // The commonest paste mistakes: a reset token where an invite belongs, and a
  // copy of the wrong line of an operator's output. Both would be posted and
  // refused with a message nobody could explain.
  assert.equal(parseJoinFragment('#invite=sr_abc').invite, null);
  assert.equal(parseJoinFragment('#invite=abc').invite, null);
  assert.equal(parseJoinFragment('#invite=').invite, null);
});

test('an address the browser could never dial is refused', () => {
  // `http:` off loopback is blocked by the browser's own mixed-content rule, so
  // accepting it here would only move the failure somewhere harder to explain.
  assert.equal(parseJoinFragment('#server=http%3A%2F%2Fsync.example.test').serverUrl, null);
  assert.equal(parseJoinFragment('#server=not-a-url').serverUrl, null);
  assert.equal(parseJoinFragment('#server=http%3A%2F%2Flocalhost%3A3100').serverUrl, 'http://localhost:3100');
});

// ---------------------------------------------------------------------------
// The address is a CHECK, never an instruction
// ---------------------------------------------------------------------------

test('a link naming another service is foreign, and one naming this one is not', () => {
  assert.equal(isForeignSyncServer({ linkServerUrl: SERVER_URL, configuredSyncUrl: SERVER_URL }), false);
  // Compared by ORIGIN: a trailing slash is not a different service.
  assert.equal(isForeignSyncServer({ linkServerUrl: `${SERVER_URL}/`, configuredSyncUrl: SERVER_URL }), false);
  assert.equal(
    isForeignSyncServer({ linkServerUrl: 'https://other.example.test', configuredSyncUrl: SERVER_URL }),
    true,
  );
  // A link with no address at all names nothing, so it is not foreign.
  assert.equal(isForeignSyncServer({ linkServerUrl: null, configuredSyncUrl: SERVER_URL }), false);
  // An instance with no sync configured can honour no link at all.
  assert.equal(isForeignSyncServer({ linkServerUrl: SERVER_URL, configuredSyncUrl: null }), true);
});

// ---------------------------------------------------------------------------
// Read once, park, strip
// ---------------------------------------------------------------------------

/** What a fake window hands back: the URLs `replaceState` was called with, and the undo. */
interface FakeWindow {
  restore: () => void;
  replaced: string[];
}

/** A window just real enough for `takeJoinLinkFromUrl`: a hash, a path, and a `replaceState` that records. */
function withFakeWindow(hash: string): FakeWindow {
  const replaced: string[] = [];
  const fake = {
    location: { hash, pathname: '/join', search: '' },
    history: {
      // `replaceState`'s first two arguments are ignored by every caller in
      // this app and by this fake; only the URL is read.
      replaceState: (_state: null, _title: string, url: string) => {
        replaced.push(url);
        fake.location.hash = '';
      },
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: fake, configurable: true, writable: true });
  return {
    replaced,
    restore: () => {
      if (previous === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.defineProperty(globalThis, 'window', previous);
    },
  };
}

/** A `sessionStorage` just real enough for the pending slot. */
function withFakeSessionStorage(): () => void {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
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
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'sessionStorage');
    else Object.defineProperty(globalThis, 'sessionStorage', previous);
  };
}

test('reading the link strips the fragment and parks the invite, so a reload finds it again', () => {
  const restoreStorage = withFakeSessionStorage();
  const fake = withFakeWindow(fragmentFor({ serverUrl: SERVER_URL, invite: INVITE }));
  try {
    const first = takeJoinLinkFromUrl({ configuredSyncUrl: SERVER_URL });
    assert.equal(first.invite, INVITE);
    // The fragment is gone from the bar, and `replaceState` was used rather
    // than an assignment (which would push a history entry and put the token
    // straight back on Back).
    assert.deepEqual(fake.replaced, ['/join']);
    assert.equal(sessionInviteStorage()?.getItem(PENDING_INVITE_STORAGE_KEY), INVITE);

    // THE RELOAD. The fragment is gone, and the parked copy is what the second
    // read returns — the whole reason the slot exists.
    const second = takeJoinLinkFromUrl({ configuredSyncUrl: SERVER_URL });
    assert.equal(second.invite, INVITE);
  } finally {
    consumeSyncInvite();
    fake.restore();
    restoreStorage();
  }
});

test('a link for ANOTHER service parks nothing, so its token cannot be spent here later', () => {
  const restoreStorage = withFakeSessionStorage();
  const fake = withFakeWindow(fragmentFor({ serverUrl: 'https://other.example.test', invite: INVITE }));
  try {
    takeJoinLinkFromUrl({ configuredSyncUrl: SERVER_URL });
    // Parking it would leave a token this app can never spend sitting in the
    // slot, where the next link read picks it up and offers a signup that
    // belongs to somebody else's server.
    assert.equal(readPendingInvite(sessionInviteStorage()), null);
  } finally {
    fake.restore();
    restoreStorage();
  }
});

test('consuming the invite empties the slot, so a later visit does not resurrect a spent token', () => {
  const restoreStorage = withFakeSessionStorage();
  const fake = withFakeWindow(fragmentFor({ invite: INVITE }));
  try {
    takeJoinLinkFromUrl({ configuredSyncUrl: SERVER_URL });
    assert.equal(readPendingInvite(sessionInviteStorage()), INVITE);
    consumeSyncInvite();
    assert.equal(readPendingInvite(sessionInviteStorage()), null);
    assert.equal(takeJoinLinkFromUrl({ configuredSyncUrl: SERVER_URL }).invite, null);
  } finally {
    fake.restore();
    restoreStorage();
  }
});

test('a PASTED link reads the same as an opened one, whole URL or bare fragment', () => {
  const expected = { serverUrl: SERVER_URL, invite: INVITE };
  assert.deepEqual(parseJoinLinkInput(`https://app.example.test/join${CANONICAL_JOIN_FRAGMENT}`), expected);
  assert.deepEqual(parseJoinLinkInput(CANONICAL_JOIN_FRAGMENT), expected);
  assert.deepEqual(parseJoinLinkInput(`  ${CANONICAL_JOIN_FRAGMENT}  `), expected);
  assert.deepEqual(parseJoinLinkInput(''), { serverUrl: null, invite: null });
});
