/**
 * Reading an invite out of a URL, and the rule that it travels in the FRAGMENT.
 *
 * The parsing is dull; the placement is not. A query string carries a live
 * capability into browser history, into the next request's `Referer`, and into
 * the access log of every server the link crosses. The fragment never leaves
 * the browser. These tests pin the parse; `tests/unit/no-invite-in-query.test.ts`
 * pins that no code path builds the other kind of link.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PENDING_INVITE_STORAGE_KEY,
  clearPendingInvite,
  consumePendingInvite,
  parseInviteFragment,
  readPendingInvite,
  rememberPendingInvite,
  takeInviteFromUrl,
  type PendingInviteStorage,
} from '#app/lib/sync/invite-link';

test('an invite is read from the fragment, with or without the leading hash', () => {
  assert.equal(parseInviteFragment('#invite=si_abc123'), 'si_abc123');
  assert.equal(parseInviteFragment('invite=si_abc123'), 'si_abc123');
});

test('a base64url token survives the parse intact', () => {
  // The service mints `randomBytes(32).toString('base64url')`, so `-` and `_`
  // are ordinary characters here. A parser that decoded them wrongly would
  // produce a token that looks right and is refused.
  const token = 'si_VZPqQ8gRzJ9i4wJMxfYlOZeyfqBPPwgN5e-BrMnh5R4';
  assert.equal(parseInviteFragment(`#invite=${token}`), token);
});

test('an absent, empty or unrelated fragment yields null', () => {
  assert.equal(parseInviteFragment(''), null);
  assert.equal(parseInviteFragment('#'), null);
  assert.equal(parseInviteFragment('#section-two'), null);
  assert.equal(parseInviteFragment('#other=abc'), null);
  // `#invite=` is a malformed link, not a request to submit an empty token.
  assert.equal(parseInviteFragment('#invite='), null);
});

test('a fragment carrying the OTHER service\'s token yields no invite', () => {
  // `gi_` is an openplate-gateway invite. Reading it here would prefill a
  // gateway credential into the sync signup form, which posts it to the sync
  // service. The client half of the service binding; the server runs its own.
  assert.equal(parseInviteFragment('#invite=gi_a_gateway_invite'), null);
  // And a bare token, which is what this service minted before M181.
  assert.equal(parseInviteFragment('#invite=abc123'), null);
});

test('the invite is found beside other fragment parameters', () => {
  assert.equal(parseInviteFragment('#from=email&invite=si_abc123'), 'si_abc123');
});

// ---------------------------------------------------------------------------
// The pending slot: what keeps the token alive after the fragment is cleared
// ---------------------------------------------------------------------------

/**
 * Reading the fragment DESTROYS it, so the read has to be survivable. The two
 * things it must survive are a remount and a full document reload — on a
 * production first visit the service worker takes control and the page reloads
 * once, which is exactly how a real invite was lost. A remount keeps module
 * memory and loses React state; a reload loses both and keeps `sessionStorage`.
 * So the slot is tested through both of its layers.
 */

/** A `sessionStorage` stand-in — a plain object, so no test touches a global. */
function fakeStorage(): PendingInviteStorage & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

/** A storage that is present and throws on every call — a Safari private window. */
const throwingStorage: PendingInviteStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

/** The two `window` members `takeInviteFromUrl` touches, and nothing else. */
interface FakeLocation {
  hash: string;
  pathname: string;
  search: string;
}

interface FakeHistory {
  replaceState(state: null, title: string, url: string): void;
}

interface FakeWindowHandle {
  /** The live location object, so a test can assert the fragment was cleared. */
  location: FakeLocation;
  restore: () => void;
}

/**
 * Installs a minimal `window` so `takeInviteFromUrl` can be driven without a
 * browser, and returns the teardown. `location.hash` is writable so the test
 * can assert the clear, and `history.replaceState` rewrites it the way the real
 * one does.
 */
function withFakeWindow(hash: string): FakeWindowHandle {
  const location: FakeLocation = { hash, pathname: '/settings/sync', search: '' };
  const history: FakeHistory = {
    replaceState: (_state, _title, url) => {
      location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
    },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: { location, history }, configurable: true, writable: true });
  return {
    location,
    restore: () => {
      if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
      else Reflect.deleteProperty(globalThis, 'window');
    },
  };
}

test('the first read takes the token from the URL and clears the fragment', () => {
  const fake = withFakeWindow('#invite=si_abc123');
  try {
    consumePendingInvite();
    assert.equal(takeInviteFromUrl(), 'si_abc123');
    assert.equal(fake.location.hash, '');
  } finally {
    consumePendingInvite();
    fake.restore();
  }
});

test('a second read after a remount still returns the token, though the fragment is gone', () => {
  const fake = withFakeWindow('#invite=si_abc123');
  try {
    consumePendingInvite();
    assert.equal(takeInviteFromUrl(), 'si_abc123');
    // The remount: same module, no fragment left to read. Before the pending
    // slot existed this returned `null` and the invite was lost for good.
    assert.equal(takeInviteFromUrl(), 'si_abc123');
    assert.equal(takeInviteFromUrl(), 'si_abc123');
  } finally {
    consumePendingInvite();
    fake.restore();
  }
});

test('once consumed, a re-read returns null rather than resurrecting a spent token', () => {
  const fake = withFakeWindow('#invite=si_abc123');
  try {
    consumePendingInvite();
    assert.equal(takeInviteFromUrl(), 'si_abc123');
    consumePendingInvite();
    assert.equal(takeInviteFromUrl(), null);
  } finally {
    consumePendingInvite();
    fake.restore();
  }
});

test('an arrival with no invite anywhere reads as no invite', () => {
  const fake = withFakeWindow('#section-two');
  try {
    consumePendingInvite();
    assert.equal(takeInviteFromUrl(), null);
  } finally {
    consumePendingInvite();
    fake.restore();
  }
});

test('there is no window during SSR, so the read is null and nothing is parked', () => {
  consumePendingInvite();
  assert.equal(globalThis.window, undefined, 'this test only means anything without a window');
  assert.equal(takeInviteFromUrl(), null);
});

test('the token is parked in web storage, so it survives a reload that empties module memory', () => {
  const storage = fakeStorage();
  rememberPendingInvite('si_abc123', storage);
  assert.equal(storage.entries.get(PENDING_INVITE_STORAGE_KEY), 'si_abc123');

  // The reload: a fresh module has an empty mirror, and only storage is left.
  // Passing `null` clears the mirror and nothing else, which is that state.
  clearPendingInvite(null);
  assert.equal(readPendingInvite(storage), 'si_abc123');

  clearPendingInvite(storage);
  assert.equal(storage.entries.has(PENDING_INVITE_STORAGE_KEY), false);
  assert.equal(readPendingInvite(storage), null);
});

test('a storage that throws degrades to module memory instead of crashing', () => {
  clearPendingInvite(throwingStorage);
  rememberPendingInvite('abc123', throwingStorage);
  // The remount case still works; only the reload case is lost, which is the
  // documented degradation and not a crash on a Safari private window.
  assert.equal(readPendingInvite(throwingStorage), 'abc123');
  clearPendingInvite(throwingStorage);
  assert.equal(readPendingInvite(throwingStorage), null);
});

test('an absent storage (SSR) is handled the same way', () => {
  clearPendingInvite(null);
  assert.equal(readPendingInvite(null), null);
  rememberPendingInvite('abc123', null);
  assert.equal(readPendingInvite(null), 'abc123');
  clearPendingInvite(null);
});
