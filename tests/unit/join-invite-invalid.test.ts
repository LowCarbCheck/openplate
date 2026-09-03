/**
 * A refused gateway invite is spent, and the card it puts up leads somewhere
 * (M187 spec 01).
 *
 * `handleJoin` is a closure inside `/join`'s route component: it reads a ref,
 * calls the gateway over the network and drives React state, so exercising it
 * means rendering the route, which this repo's `node --test` tier has no DOM
 * for. Rather than fake one, this pins the two invariants by reading the
 * source, the same idiom `tests/unit/sync-sign-out-hint.test.ts` uses for
 * `sync-actions.ts`'s composition root.
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

const source = readFileSync(new URL('../../app/routes/join.tsx', import.meta.url), 'utf8');

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

describe('handleJoin, when the gateway refuses the invite', () => {
  const body = extractBody('  async function handleJoin', '  ');
  // Bounded at the branch's own closing brace, or the success path's identical
  // `consumeGatewayInvite()` call further down would satisfy these assertions
  // on its own and the test would pass against the bug it exists to catch.
  const branchStart = body.indexOf('redeemed === null');
  assert.ok(branchStart !== -1, 'handleJoin no longer has a null-redemption branch');
  const branchEnd = /^ {4}}$/m.exec(body.slice(branchStart));
  assert.ok(branchEnd !== null, 'the null-redemption branch has no closing brace alone on its own line');
  const rejection = body.slice(branchStart, branchStart + branchEnd.index);

  it('empties the gateway slot of this tab', () => {
    assert.match(rejection, /consumeGatewayInvite\(\)/);
  });

  it('still puts the invalid card up', () => {
    assert.match(rejection, /status: 'invite-invalid'/);
  });

  it('spends the slot before setting the phase, so the state that caused the failure is gone first', () => {
    const consumedAt = rejection.indexOf('consumeGatewayInvite()');
    const phaseAt = rejection.indexOf("status: 'invite-invalid'");
    assert.ok(consumedAt !== -1 && phaseAt !== -1, 'the branch must both spend the slot and set the phase');
    assert.ok(consumedAt < phaseAt, 'consumeGatewayInvite() must run before setPhase');
  });

  it('leaves the sync half of the link alone', () => {
    assert.doesNotMatch(rejection, /consumeSyncInvite/);
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
