/**
 * A refused gateway invite is spent, and the card it puts up leads somewhere
 * (M187 spec 01).
 *
 * The redemption WAS a closure inside `/join`'s route component, so this file
 * pinned its invariants by reading the route's source: there is no DOM in this
 * repo's `node --test` tier and rendering was not an option. It has since moved
 * to `app/lib/gateway-redemption.ts`, an ordinary function over injected
 * boundaries, so the invariants below are now exercised rather than read. Only
 * the card, which is still JSX, stays source-inspected.
 *
 * It was `handleJoin` when this file was written, then M187 spec 03's
 * `redeemAndSave` callback, and now `redeemAndPark`. The invariants did not
 * move with any of it.
 *
 * Both invariants come from one owner report: an invite parked on one day was
 * revoked the next, and because the rejection path only rendered an error, the
 * dead token stayed in the tab's slot. `sign-in-flow.ts` routes a signed-in tab
 * back to `/join` whenever a gateway half is parked, so every later sign-in in
 * that tab failed on the same token. Emptying the slot makes it fail once, and
 * the continue action gives the person a way on.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { redeemAndPark, type RedemptionOutcome } from '#app/lib/gateway-redemption';
import {
  consumeGatewayInvite,
  consumeSyncInvite,
  readPendingGatewayJoin,
  readPendingGatewayRedemption,
} from '#app/lib/join-link';

const source = readFileSync(new URL('../../app/routes/join.tsx', import.meta.url), 'utf8');
const redemptionSource = readFileSync(new URL('../../app/lib/gateway-redemption.ts', import.meta.url), 'utf8');

/**
 * Extracts a body from its opening line to the closing brace at `indent`,
 * alone on its own line.
 *
 * The indent argument is what makes this usable for both a top-level component
 * and a function nested one level inside another one. Anchoring on a brace
 * ALONE on its line matters for the same reason spec 02's worklog records: a
 * multi-line destructured signature closes with a line that itself starts with
 * `}` and would end the range early.
 */
function extractBody(opening: string, indent: string): string {
  const start = source.indexOf(opening);
  assert.ok(start !== -1, `${opening} is no longer in join.tsx`);
  const closingBrace = new RegExp(`^${indent}}$`, 'm').exec(source.slice(start));
  assert.ok(closingBrace !== null, `${opening} has no closing brace alone on its own line`);
  return source.slice(start, start + closingBrace.index);
}

/** A redemption whose gateway says no, with the two stores stubbed out. */
async function refusedRedemption(): Promise<RedemptionOutcome> {
  consumeSyncInvite();
  consumeGatewayInvite();
  return redeemAndPark({
    invite: { gatewayUrl: 'https://gw.example.test', inviteToken: 'gi_refused' },
    deps: {
      redeem: async () => null,
      putAiSettings: async () => assert.fail('a refused invite must write nothing'),
      putGatewayConnection: async () => assert.fail('a refused invite must write nothing'),
      now: () => 0,
    },
  });
}

describe('the redemption, when the gateway refuses the invite', () => {
  it('empties the gateway slot of this tab', async () => {
    await refusedRedemption();
    assert.equal(readPendingGatewayJoin(), null);
  });

  it('parks no redeemed result, because there is none', async () => {
    await refusedRedemption();
    assert.equal(readPendingGatewayRedemption(), null);
  });

  it('still asks for the invalid card', async () => {
    assert.deepEqual(await refusedRedemption(), { status: 'invite-invalid' });
  });

  it('spends the slot before the caller can put a screen up', () => {
    // Structural now, and stronger than the ordering this test used to read out
    // of the route: the slot is emptied inside the redemption, which returns
    // before `/join` sees an outcome at all.
    const branch = redemptionSource.slice(
      redemptionSource.indexOf('if (redeemed === null) {'),
      redemptionSource.indexOf('const parked: ParkedGatewayRedemption'),
    );
    assert.match(branch, /consumeGatewayInvite\(\)/);
    assert.match(branch, /status: 'invite-invalid'/);
  });

  it('leaves the sync half of the link alone', () => {
    assert.doesNotMatch(redemptionSource, /consumeSyncInvite/);
  });
});

describe('InviteInvalidCard', () => {
  const body = extractBody('function InviteInvalidCard', '');

  it('offers a way into the app as its primary action', () => {
    assert.match(body, /connectGateway\.inviteInvalid\.continue/);
  });

  it('keeps the AI settings link as the secondary action', () => {
    assert.match(body, /BackToSettingsLink/);
  });

  it('cannot send the person back to the link that just failed', () => {
    assert.doesNotMatch(body, /'\/join'/);
  });
});

describe('the invalid-invite copy', () => {
  for (const locale of ['en', 'de'] as const) {
    const strings: Record<string, string | undefined> = JSON.parse(
      readFileSync(new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url), 'utf8'),
    ).connectGateway.inviteInvalid;

    it(`${locale} carries a non-empty continue label`, () => {
      const label = strings.continue;
      assert.ok(label !== undefined, `${locale} is missing connectGateway.inviteInvalid.continue`);
      assert.notEqual(label.trim(), '');
    });

    it(`${locale} never names which of invalid, expired or used it was`, () => {
      // The gateway does not tell us, so no string here may guess. The card's
      // own comment records that as a decision.
      const causes = /revoked|already used|widerrufen|zurückgezogen/i;
      for (const value of Object.values(strings)) assert.doesNotMatch(value ?? '', causes);
    });

    it(`${locale} carries no dash of any kind`, () => {
      for (const value of Object.values(strings)) assert.doesNotMatch(value ?? '', /[-‐-―]/);
    });
  }
});
