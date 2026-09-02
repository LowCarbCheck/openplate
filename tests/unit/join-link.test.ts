/**
 * The join link: one fragment, up to two services.
 *
 * What is worth testing here is not the parse, which is dull, but the four
 * rules the parse enforces and which nothing else can catch:
 *
 *  1. Every combination of halves is legal, and a link with neither is the one
 *     invalid case.
 *  2. A token is bound to its service by prefix, so a link built with the two
 *     halves swapped yields NO token rather than one this client would post to
 *     the wrong service.
 *  3. The sync address in the link is a check, never an instruction.
 *  4. Reading the fragment strips it, and what was read survives the reload
 *     that the strip would otherwise make fatal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildJoinFragment,
  consumeGatewayInvite,
  consumeSyncInvite,
  hasGatewayHalf,
  isForeignSyncServer,
  isJoinLinkEmpty,
  parseJoinFragment,
  readPendingGatewayJoin,
  takeJoinLinkFromUrl,
} from '#app/lib/join-link';

const SYNC_URL = 'https://sync.example.test';
const SYNC_INVITE = 'si_pMTz3s2n4h9QeQnQ0O_zA-3aWjIvbCzHkqk';
const GATEWAY_URL = 'https://gw.example.test';
const GATEWAY_INVITE = 'gi_9c8Vv3rTbn0lQpQ4Wc-yZaGkQhLmNoPq';

function fragmentFor(link: Parameters<typeof buildJoinFragment>[0]): string {
  return buildJoinFragment(link);
}

// ---------------------------------------------------------------------------
// The three shapes of link, all ordinary
// ---------------------------------------------------------------------------

test('a sync-only link parses to a sync half and nothing else', () => {
  const link = parseJoinFragment(fragmentFor({ syncUrl: SYNC_URL, syncInvite: SYNC_INVITE }));
  assert.equal(link.syncInvite, SYNC_INVITE);
  assert.equal(link.syncUrl, SYNC_URL);
  assert.equal(link.gatewayInvite, null);
  assert.equal(hasGatewayHalf(link), false);
  assert.equal(isJoinLinkEmpty(link), false);
});

test('a gateway-only link parses to a gateway half and nothing else', () => {
  const link = parseJoinFragment(fragmentFor({ gatewayUrl: GATEWAY_URL, gatewayInvite: GATEWAY_INVITE }));
  assert.equal(link.gatewayUrl, GATEWAY_URL);
  assert.equal(link.gatewayInvite, GATEWAY_INVITE);
  assert.equal(link.syncInvite, null);
  assert.equal(hasGatewayHalf(link), true);
  assert.equal(isJoinLinkEmpty(link), false);
});

test('a both link parses to both halves, and round-trips through the builder', () => {
  const whole = { syncUrl: SYNC_URL, syncInvite: SYNC_INVITE, gatewayUrl: GATEWAY_URL, gatewayInvite: GATEWAY_INVITE };
  const link = parseJoinFragment(fragmentFor(whole));
  assert.deepEqual(link, whole);
  // The builder is the ONE place a link is written, so its output has to be
  // exactly what the reader accepts.
  assert.equal(fragmentFor(link), fragmentFor(whole));
});

/**
 * THE SHARED FIXTURE. The exact string the operator CLI emits for these inputs,
 * asserted here against the parser and in `djinn/openplate/join-link.test.ts`
 * against the builder. djinn cannot import this module, so the grammar is
 * written twice; this literal is what stops the two copies drifting apart, and
 * a change to the grammar has to be made in both files or one of them fails.
 */
const CANONICAL_JOIN_FRAGMENT =
  '#sync=https%3A%2F%2Fsync.example.test&invite=si_pMTz3s2n4h9QeQnQ0O_zA-3aWjIvbCzHkqk' +
  '&gateway=https%3A%2F%2Fgw.example.test&ginvite=gi_9c8Vv3rTbn0lQpQ4Wc-yZaGkQhLmNoPq';

test('the canonical operator link parses to both halves, and rebuilds to itself', () => {
  const link = parseJoinFragment(CANONICAL_JOIN_FRAGMENT);
  assert.deepEqual(link, {
    syncUrl: SYNC_URL,
    syncInvite: SYNC_INVITE,
    gatewayUrl: GATEWAY_URL,
    gatewayInvite: GATEWAY_INVITE,
  });
  assert.equal(fragmentFor(link), CANONICAL_JOIN_FRAGMENT);
});

test('a link with no capability at all is the one invalid case', () => {
  assert.equal(isJoinLinkEmpty(parseJoinFragment('')), true);
  assert.equal(isJoinLinkEmpty(parseJoinFragment('#')), true);
  assert.equal(isJoinLinkEmpty(parseJoinFragment('#from=chat')), true);
  // A gateway address with no invite admits nobody, and neither does an invite
  // with no address to redeem it against.
  assert.equal(isJoinLinkEmpty(parseJoinFragment(fragmentFor({ gatewayUrl: GATEWAY_URL }))), true);
  assert.equal(isJoinLinkEmpty(parseJoinFragment(fragmentFor({ gatewayInvite: GATEWAY_INVITE }))), true);
});

test('the builder omits an absent field rather than writing it empty', () => {
  // `#ginvite=` is a link that looks like it carries a gateway and does not.
  const fragment = fragmentFor({ syncInvite: SYNC_INVITE, gatewayInvite: null, gatewayUrl: '' });
  assert.equal(fragment.includes('ginvite'), false);
  assert.equal(fragment.includes('gateway'), false);
  assert.equal(fragmentFor({}), '');
});

test('a base64url token survives the parse intact', () => {
  // Both services mint `randomBytes(32).toString('base64url')`, so `-` and `_`
  // are ordinary characters here. A parser that mangled them would produce a
  // token that looks right and is refused.
  const token = 'si_VZPqQ8gRzJ9i4wJMxfYlOZeyfqBPPwgN5e-BrMnh5R4';
  assert.equal(parseJoinFragment(`#invite=${token}`).syncInvite, token);
});

// ---------------------------------------------------------------------------
// The service binding
// ---------------------------------------------------------------------------

test('a link with the two tokens swapped yields no tokens at all', () => {
  // The ordinary accident: a link built with the arguments the wrong way round,
  // or a copy of the wrong line of an operator's output. Each half is refused
  // by the OTHER service's shape gate, so nothing is posted anywhere.
  const swapped = parseJoinFragment(
    `#sync=${encodeURIComponent(SYNC_URL)}&invite=${GATEWAY_INVITE}` +
      `&gateway=${encodeURIComponent(GATEWAY_URL)}&ginvite=${SYNC_INVITE}`,
  );
  assert.equal(swapped.syncInvite, null);
  assert.equal(swapped.gatewayInvite, null);
  assert.equal(isJoinLinkEmpty(swapped), true);
});

test('an unprefixed token is refused on both sides', () => {
  // What both services minted before M181. Pre-launch, so there is no
  // population to keep working, and accepting one would defeat the binding.
  const bare = parseJoinFragment('#invite=abc123&gateway=https%3A%2F%2Fgw.example.test&ginvite=abc123');
  assert.equal(bare.syncInvite, null);
  assert.equal(bare.gatewayInvite, null);
});

test('an address that a browser could not dial anyway is refused', () => {
  // `http:` off loopback is blocked by the browser's mixed-content rule
  // regardless, so accepting it here would only move the failure later.
  assert.equal(parseJoinFragment('#gateway=http%3A%2F%2Fgw.example.test&ginvite=gi_x').gatewayUrl, null);
  assert.equal(parseJoinFragment('#gateway=not-a-url&ginvite=gi_x').gatewayUrl, null);
  // Loopback is the standing carve-out, and the sync address takes the same
  // rule as the gateway one.
  assert.equal(parseJoinFragment('#sync=http%3A%2F%2Flocalhost%3A4000&invite=si_x').syncUrl, 'http://localhost:4000');
});

// ---------------------------------------------------------------------------
// The sync address is a check, not an instruction
// ---------------------------------------------------------------------------

test('a link naming another sync server is foreign, whatever the path or trailing slash', () => {
  assert.equal(isForeignSyncServer({ linkSyncUrl: SYNC_URL, configuredSyncUrl: 'https://other.example.test' }), true);
  assert.equal(isForeignSyncServer({ linkSyncUrl: SYNC_URL, configuredSyncUrl: `${SYNC_URL}/` }), false);
  assert.equal(isForeignSyncServer({ linkSyncUrl: SYNC_URL, configuredSyncUrl: SYNC_URL }), false);
});

test('a link naming a sync server on an instance that has none is foreign', () => {
  // Not a redirect: this client posts its verifier to the server ITS operator
  // configured, and an instance with sync off has nowhere to send it.
  assert.equal(isForeignSyncServer({ linkSyncUrl: SYNC_URL, configuredSyncUrl: null }), true);
});

test('a link that names no sync server is never foreign', () => {
  assert.equal(isForeignSyncServer({ linkSyncUrl: null, configuredSyncUrl: SYNC_URL }), false);
  assert.equal(isForeignSyncServer({ linkSyncUrl: null, configuredSyncUrl: null }), false);
});

// ---------------------------------------------------------------------------
// Read once, strip, park
// ---------------------------------------------------------------------------

interface FakeWindowHandle {
  location: { hash: string; pathname: string; search: string };
  restore: () => void;
}

/** A minimal `window`, so the read can be driven without a browser. */
function withFakeWindow(hash: string): FakeWindowHandle {
  const location = { hash, pathname: '/join', search: '' };
  const history = {
    replaceState: (_state: null, _title: string, url: string): void => {
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

function emptyTheSlot(): void {
  consumeSyncInvite();
  consumeGatewayInvite();
}

test('the first read takes both halves and clears the fragment', () => {
  const fake = withFakeWindow(
    fragmentFor({ syncUrl: SYNC_URL, syncInvite: SYNC_INVITE, gatewayUrl: GATEWAY_URL, gatewayInvite: GATEWAY_INVITE }),
  );
  try {
    emptyTheSlot();
    const link = takeJoinLinkFromUrl({ configuredSyncUrl: SYNC_URL });
    assert.equal(link.syncInvite, SYNC_INVITE);
    assert.equal(link.gatewayInvite, GATEWAY_INVITE);
    // Nothing is left in the address bar for a screenshot or a screen share.
    assert.equal(fake.location.hash, '');
  } finally {
    emptyTheSlot();
    fake.restore();
  }
});

test('a second read after the fragment is gone still returns both halves', () => {
  const fake = withFakeWindow(
    fragmentFor({ syncInvite: SYNC_INVITE, gatewayUrl: GATEWAY_URL, gatewayInvite: GATEWAY_INVITE }),
  );
  try {
    emptyTheSlot();
    takeJoinLinkFromUrl({ configuredSyncUrl: SYNC_URL });
    // The remount, or the mount after the service worker's first-visit reload:
    // no fragment left to read, and the pending slot is the only copy.
    const again = takeJoinLinkFromUrl({ configuredSyncUrl: SYNC_URL });
    assert.equal(again.syncInvite, SYNC_INVITE);
    assert.equal(again.gatewayUrl, GATEWAY_URL);
    assert.equal(again.gatewayInvite, GATEWAY_INVITE);
  } finally {
    emptyTheSlot();
    fake.restore();
  }
});

test('spending the sync half leaves the gateway half waiting', () => {
  // The whole reason the slot holds two fields separately: the sync invite is
  // spent on `/settings/sync`, minutes before the gateway one is.
  const fake = withFakeWindow(
    fragmentFor({ syncInvite: SYNC_INVITE, gatewayUrl: GATEWAY_URL, gatewayInvite: GATEWAY_INVITE }),
  );
  try {
    emptyTheSlot();
    takeJoinLinkFromUrl({ configuredSyncUrl: SYNC_URL });
    consumeSyncInvite();

    const left = takeJoinLinkFromUrl({ configuredSyncUrl: SYNC_URL });
    assert.equal(left.syncInvite, null);
    assert.deepEqual(readPendingGatewayJoin(), { gatewayUrl: GATEWAY_URL, gatewayInvite: GATEWAY_INVITE });
  } finally {
    emptyTheSlot();
    fake.restore();
  }
});

test('a spent gateway half is not resurrected on a later visit', () => {
  const fake = withFakeWindow(fragmentFor({ gatewayUrl: GATEWAY_URL, gatewayInvite: GATEWAY_INVITE }));
  try {
    emptyTheSlot();
    takeJoinLinkFromUrl({ configuredSyncUrl: SYNC_URL });
    consumeGatewayInvite();
    assert.equal(readPendingGatewayJoin(), null);
    assert.equal(takeJoinLinkFromUrl({ configuredSyncUrl: SYNC_URL }).gatewayInvite, null);
  } finally {
    emptyTheSlot();
    fake.restore();
  }
});

test('a foreign link parks nothing, so its token cannot be offered to the wrong server later', () => {
  // Parking runs BEFORE the route can show its "this link is for a different
  // server" card, so the skip has to live in the read itself. Otherwise the
  // token sits in the slot and the next link read offers a signup that belongs
  // to somebody else's instance.
  const fake = withFakeWindow(fragmentFor({ syncUrl: 'https://elsewhere.example.test', syncInvite: SYNC_INVITE }));
  try {
    emptyTheSlot();
    const link = takeJoinLinkFromUrl({ configuredSyncUrl: SYNC_URL });
    assert.equal(link.syncUrl, 'https://elsewhere.example.test');
    assert.equal(link.syncInvite, null);
    // And the fragment is stripped all the same: a refused link's token is
    // just as sensitive as an accepted one's.
    assert.equal(fake.location.hash, '');
  } finally {
    emptyTheSlot();
    fake.restore();
  }
});

test('there is no window during SSR, so the read is empty and nothing is parked', () => {
  emptyTheSlot();
  assert.equal(globalThis.window, undefined, 'this test only means anything without a window');
  assert.equal(isJoinLinkEmpty(takeJoinLinkFromUrl({ configuredSyncUrl: SYNC_URL })), true);
});
