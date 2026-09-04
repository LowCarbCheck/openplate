/**
 * A failed local write must never cost the join (M187 follow-up).
 *
 * The bug this file was written against, seen on production: `/join` posted the
 * one-shot gateway invite, the gateway burnt it and answered, and then one of
 * the two local writes threw. The screen went back to the confirm card, the
 * spent token was still parked, and "Join" re-posted it. The gateway refused a
 * token it had already used, the screen said the invite was invalid, and the
 * slot was emptied. Server side the member existed; on the device there were no
 * AI settings and no connection. There was no other path: the answer lived in a
 * local variable and nothing else held it.
 *
 * So the invariant is not "the writes succeed" — they can fail, IndexedDB is
 * allowed to be full or blocked. It is that ONE redeem buys the join, and every
 * retry after it is local. That is what is pinned below: the redeem endpoint is
 * called exactly once across a failure and a retry, the answer survives in the
 * slot in the meantime, and the invite is gone from the slot the moment it is
 * spent so nothing can re-post it.
 *
 * The pending slot is real here rather than faked: it falls back to its module
 * mirror where `sessionStorage` does not exist, which is exactly the case under
 * `node --test`. Only the two boundaries the flow cannot own are injected — the
 * network and the two stores.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { redeemInvite, redeemAndPark, savePendingRedemption, type RedemptionDeps } from '#app/lib/gateway-redemption';
import {
  consumeGatewayInvite,
  consumeSyncInvite,
  parkGatewayRedemption,
  readPendingGatewayJoin,
  readPendingGatewayRedemption,
} from '#app/lib/join-link';
import { GATEWAY_API_PREFIX, GATEWAY_REDEEM_PATH } from '#app/lib/gateway-invite';
import type { ConnectedGatewayConnection, LocalAiSettings } from '#app/lib/local-store';

const GATEWAY_URL = 'https://gw.example.test';
const INVITE_TOKEN = 'gi_9c8Vv3rTbn0lQpQ4Wc-yZaGkQhLmNoPq';
const MEMBER_TOKEN = 'mt_QsRt7uVw8xYz9AbCdEfGhIjKlMnOpQr';
const REDEEM_BODY = {
  memberId: 'member-1',
  memberToken: MEMBER_TOKEN,
  gateway: { name: 'Haushalt', model: 'vision-1', auditEnabled: false },
};
const REDEEMED_AT = 1_700_000_000_000;

/** A one-shot gateway, plus the count this whole file turns on. */
interface CountingGateway {
  fetchImpl: typeof fetch;
  calls: () => number;
}

/** A `fetch` that answers the redeem endpoint once and counts every call to it. */
function countingGateway(): CountingGateway {
  let calls = 0;
  const answer = async (input: RequestInfo | URL): Promise<Response> => {
    assert.equal(String(input), `${GATEWAY_URL}${GATEWAY_REDEEM_PATH}`);
    calls += 1;
    // The gateway burns a one-shot invite on the FIRST redeem. Every later post
    // of the same token is refused, exactly as the real one does.
    if (calls > 1) return new Response('{}', { status: 400 });
    return new Response(JSON.stringify(REDEEM_BODY), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  // SAFETY: the redemption calls `fetch` with one URL and one init and reads
  // only `ok` and `json()` off the result, all of which `answer` provides. The
  // assertion buys the wider `fetch` signature this fake never needs.
  return { fetchImpl: answer as typeof fetch, calls: () => calls };
}

interface RecordedWrites {
  settings: LocalAiSettings[];
  connections: ConnectedGatewayConnection[];
}

/** Deps whose settings write throws the first `failures` times, then works. */
function depsWithFailingSettings({
  fetchImpl,
  failures,
  writes,
}: {
  fetchImpl: typeof fetch;
  failures: number;
  writes: RecordedWrites;
}): RedemptionDeps {
  let remaining = failures;
  return {
    redeem: (invite) => redeemInvite({ ...invite, fetchImpl }),
    putAiSettings: async (settings) => {
      if (remaining > 0) {
        remaining -= 1;
        throw new Error('QuotaExceededError');
      }
      writes.settings.push(settings);
    },
    putGatewayConnection: async (connection) => {
      writes.connections.push(connection);
    },
    now: () => REDEEMED_AT,
  };
}

function emptyTheSlot(): void {
  consumeSyncInvite();
  consumeGatewayInvite();
}

describe('a gateway redemption whose local write fails', () => {
  beforeEach(emptyTheSlot);

  it('spends the invite once, keeps the answer, and finishes on a retry', async () => {
    const gateway = countingGateway();
    const writes: RecordedWrites = { settings: [], connections: [] };
    const deps = depsWithFailingSettings({ fetchImpl: gateway.fetchImpl, failures: 1, writes });

    const first = await redeemAndPark({
      invite: { gatewayUrl: GATEWAY_URL, inviteToken: INVITE_TOKEN },
      deps,
    });

    assert.deepEqual(first, { status: 'save-failed' });
    assert.equal(gateway.calls(), 1, 'the invite is posted once');
    assert.equal(writes.settings.length, 0, 'the failing write left nothing behind');

    // The server's answer is held on the device, because the server has already
    // moved on and this is now the only copy.
    const parked = readPendingGatewayRedemption();
    assert.ok(parked !== null, 'the redeemed result must be parked');
    assert.equal(parked.redeemed.memberToken, MEMBER_TOKEN);
    assert.equal(parked.gatewayUrl, GATEWAY_URL);

    // And the spent token is gone, so no retry path can re-post it.
    assert.deepEqual(
      readPendingGatewayJoin(),
      { gatewayUrl: GATEWAY_URL, gatewayInvite: null },
      'the tab still has unfinished gateway business, but no invite left to spend',
    );

    // The retry: local writes only.
    const retry = await savePendingRedemption({ parked, deps });

    assert.deepEqual(retry, { status: 'joined', gatewayName: 'Haushalt' });
    assert.equal(gateway.calls(), 1, 'a retry must never re-redeem');
    assert.equal(writes.settings.length, 1);
    assert.equal(writes.settings[0]?.apiKey, MEMBER_TOKEN);
    assert.equal(writes.settings[0]?.baseUrl, `${GATEWAY_URL}${GATEWAY_API_PREFIX}`);
    assert.equal(writes.connections.length, 1);
    assert.equal(writes.connections[0]?.memberToken, MEMBER_TOKEN);
    // The join, not the retry, is what the connection records.
    assert.equal(writes.connections[0]?.connectedAt, REDEEMED_AT);

    // Nothing is left in the tab once it is all on disk.
    assert.equal(readPendingGatewayRedemption(), null);
    assert.equal(readPendingGatewayJoin(), null);
  });

  it('leaves nothing parked when the writes succeed the first time', async () => {
    const gateway = countingGateway();
    const writes: RecordedWrites = { settings: [], connections: [] };
    const outcome = await redeemAndPark({
      invite: { gatewayUrl: GATEWAY_URL, inviteToken: INVITE_TOKEN },
      deps: depsWithFailingSettings({ fetchImpl: gateway.fetchImpl, failures: 0, writes }),
    });

    assert.deepEqual(outcome, { status: 'joined', gatewayName: 'Haushalt' });
    assert.equal(gateway.calls(), 1);
    assert.equal(readPendingGatewayJoin(), null);
    assert.equal(readPendingGatewayRedemption(), null);
  });

  it('empties the slot when the gateway refuses the invite, and parks no answer', async () => {
    const gateway = countingGateway();
    // Burn the one answer this fake has, so the redemption below is refused.
    await gateway.fetchImpl(`${GATEWAY_URL}${GATEWAY_REDEEM_PATH}`);
    const writes: RecordedWrites = { settings: [], connections: [] };

    const outcome = await redeemAndPark({
      invite: { gatewayUrl: GATEWAY_URL, inviteToken: INVITE_TOKEN },
      deps: depsWithFailingSettings({ fetchImpl: gateway.fetchImpl, failures: 0, writes }),
    });

    assert.deepEqual(outcome, { status: 'invite-invalid' });
    assert.equal(readPendingGatewayRedemption(), null);
    assert.equal(readPendingGatewayJoin(), null);
    assert.equal(writes.settings.length, 0);
  });

  it('reports a failure again when the retry fails again, and keeps the answer', async () => {
    const gateway = countingGateway();
    const writes: RecordedWrites = { settings: [], connections: [] };
    const deps = depsWithFailingSettings({ fetchImpl: gateway.fetchImpl, failures: 2, writes });

    await redeemAndPark({ invite: { gatewayUrl: GATEWAY_URL, inviteToken: INVITE_TOKEN }, deps });
    const parked = readPendingGatewayRedemption();
    assert.ok(parked !== null);

    assert.deepEqual(await savePendingRedemption({ parked, deps }), { status: 'save-failed' });
    assert.equal(gateway.calls(), 1);
    assert.ok(readPendingGatewayRedemption() !== null, 'a second failure must not throw the answer away');
  });

  it('writes the same rows after a reload, from the slot alone', async () => {
    // The document reload the pending slot exists for: nothing survives but
    // what is in storage, and the retry has to be able to run off that.
    parkGatewayRedemption({ gatewayUrl: GATEWAY_URL, redeemed: REDEEM_BODY, redeemedAt: REDEEMED_AT });
    const gateway = countingGateway();
    const writes: RecordedWrites = { settings: [], connections: [] };
    const parked = readPendingGatewayRedemption();
    assert.ok(parked !== null);

    const outcome = await savePendingRedemption({
      parked,
      deps: depsWithFailingSettings({ fetchImpl: gateway.fetchImpl, failures: 0, writes }),
    });

    assert.deepEqual(outcome, { status: 'joined', gatewayName: 'Haushalt' });
    assert.equal(gateway.calls(), 0, 'a resume after a reload dials nothing');
    assert.equal(writes.settings[0]?.apiKey, MEMBER_TOKEN);
    assert.equal(writes.connections[0]?.connectedAt, REDEEMED_AT);
  });
});

/**
 * The route's half of the same invariant.
 *
 * `/join` is a React component with no DOM under `node --test`, so the screen
 * it puts up after a failed write is pinned by reading the source — the idiom
 * `join-invite-invalid.test.ts` established for this route. What matters is
 * that the failure lands on its OWN state with a retry action, rather than back
 * on the confirm card whose button re-redeems.
 */
describe('the retry card on /join', () => {
  const source = readFileSync(new URL('../../app/routes/join.tsx', import.meta.url), 'utf8');

  it('has a save-retry phase', () => {
    assert.match(source, /status: 'save-retry'/);
  });

  it('words it with the retry copy, not the old one-shot failure toast', () => {
    assert.match(source, /connectGateway\.saveRetry/);
    assert.match(source, /connectGateway\.retry/);
  });

  it('never sends a failed save back to the confirm card', () => {
    const start = source.indexOf('const redeemAndSave = useCallback(');
    assert.ok(start !== -1, 'the redemption callback is no longer in join.tsx');
    const end = source.indexOf('  );', start);
    const body = source.slice(start, end);
    assert.doesNotMatch(body, /save-failed'[\s\S]{0,200}status: 'confirm'/);
  });

  it('redeems from one place only, so no second call site can re-post a spent token', () => {
    const occurrences = source.split('redeemAndPark(').length - 1;
    assert.equal(occurrences, 1, 'redeemAndPark must have exactly one call site');
  });
});
