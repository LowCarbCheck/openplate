/**
 * Gateway-mode onboarding — the pure half (`app/lib/gateway-invite.ts`).
 *
 * Everything a gateway join decides is decided here: whether a link is usable,
 * what settings row it writes, whether the audit disclosure is shown, and which
 * of the two "it didn't answer" explanations a failure earns. The route is a
 * shell around these, so this suite is the real gate — there is no browser in
 * `node --test`, and the network half is one `fetch` call each way.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GATEWAY_API_PREFIX,
  GATEWAY_INFO_PATH,
  GATEWAY_REDEEM_PATH,
  buildGatewayAiSettings,
  gatewayInfoSchema,
  gatewayRedeemResponseSchema,
  isGatewayInviteToken,
  isAuditDisclosureRequired,
  normalizeGatewayUrl,
  normalizeInviteToken,
  requiresOperatorCspAllowlisting,
  type GatewayRedeemResponse,
} from '../../app/lib/gateway-invite';
import { classifyVisionHttpFailure } from '../../app/services/vision/failure-cause';

const REDEEMED: GatewayRedeemResponse = {
  memberId: 'member-1',
  memberToken: 'gwt_member_token',
  gateway: { name: 'The Muellers', model: 'qwen3-vl-8b', auditEnabled: false },
};

describe('normalizeGatewayUrl', () => {
  it('accepts an https gateway and trims trailing slashes', () => {
    assert.equal(normalizeGatewayUrl('https://gw.example.com/'), 'https://gw.example.com');
    assert.equal(normalizeGatewayUrl('  https://gw.example.com/ai///  '), 'https://gw.example.com/ai');
  });

  it('keeps a non-default port — it is part of the origin the browser matches on', () => {
    assert.equal(normalizeGatewayUrl('https://gw.example.com:8443'), 'https://gw.example.com:8443');
  });

  it('allows plain http ONLY for loopback, matching the CSP carve-out', () => {
    assert.equal(normalizeGatewayUrl('http://localhost:8080/'), 'http://localhost:8080');
    assert.equal(normalizeGatewayUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
    // A LAN gateway over plain http is blocked by mixed-content anyway; saying
    // no here makes the failure explainable instead of mysterious.
    assert.equal(normalizeGatewayUrl('http://192.168.1.10:8080'), null);
    assert.equal(normalizeGatewayUrl('http://gw.example.com'), null);
  });

  it('rejects anything that is not an absolute http(s) URL', () => {
    assert.equal(normalizeGatewayUrl('gw.example.com'), null);
    assert.equal(normalizeGatewayUrl('ftp://gw.example.com'), null);
    assert.equal(normalizeGatewayUrl('javascript:alert(1)'), null);
    assert.equal(normalizeGatewayUrl('/relative'), null);
  });

  it('treats absent, empty and blank the same — a truncated link, not a gateway', () => {
    assert.equal(normalizeGatewayUrl(null), null);
    assert.equal(normalizeGatewayUrl(undefined), null);
    assert.equal(normalizeGatewayUrl(''), null);
    assert.equal(normalizeGatewayUrl('   '), null);
  });

  it('drops any query string or fragment rather than carrying it into every request', () => {
    assert.equal(normalizeGatewayUrl('https://gw.example.com/?invite=leaked#frag'), 'https://gw.example.com');
  });
});

describe('normalizeInviteToken', () => {
  it('trims a real token and rejects every empty shape', () => {
    assert.equal(normalizeInviteToken('  gi_abc  '), 'gi_abc');
    assert.equal(normalizeInviteToken(''), null);
    assert.equal(normalizeInviteToken('   '), null);
    assert.equal(normalizeInviteToken(null), null);
    assert.equal(normalizeInviteToken(undefined), null);
  });

  it('refuses a SYNC invite, so the wrong half of a link is never posted to a gateway', () => {
    // `si_` is an openplate-sync signup invite. The two tokens travel in the
    // same link and are otherwise interchangeable strings; this is the client
    // half of the binding the gateway also enforces on the way in.
    assert.equal(normalizeInviteToken('si_a_sync_signup_invite'), null);
    // And a token with no prefix at all, which is what a pre-M181 gateway
    // minted, is no longer accepted either.
    assert.equal(normalizeInviteToken('opgwi_an_old_gateway_invite'), null);
    assert.equal(isGatewayInviteToken('gi_ok'), true);
    assert.equal(isGatewayInviteToken('si_no'), false);
  });
});

describe('requiresOperatorCspAllowlisting', () => {
  it('is true for an ordinary remote gateway — the operator must allow the origin', () => {
    assert.equal(
      requiresOperatorCspAllowlisting({ gatewayUrl: 'https://gw.example.com/', appOrigin: 'https://app.example.org' }),
      true,
    );
  });

  it('is false for loopback and for this app’s own origin — both are already allowed', () => {
    assert.equal(
      requiresOperatorCspAllowlisting({ gatewayUrl: 'http://localhost:8080', appOrigin: 'https://app.example.org' }),
      false,
    );
    assert.equal(
      requiresOperatorCspAllowlisting({
        gatewayUrl: 'https://app.example.org/gateway',
        appOrigin: 'https://app.example.org',
      }),
      false,
    );
  });
});

describe('isAuditDisclosureRequired', () => {
  it('is shown if and only if the source says auditEnabled is true', () => {
    assert.equal(isAuditDisclosureRequired({ auditEnabled: true }), true);
    assert.equal(isAuditDisclosureRequired({ auditEnabled: false }), false);
  });

  it('is false for every shape of "nobody told us" — an older row, a null config, a missing field', () => {
    assert.equal(isAuditDisclosureRequired(null), false);
    assert.equal(isAuditDisclosureRequired(undefined), false);
    assert.equal(isAuditDisclosureRequired({}), false);
    assert.equal(isAuditDisclosureRequired({ auditEnabled: null }), false);
  });
});

describe('gateway wire schemas', () => {
  it('parses the documented /v1/gateway/info body, model included or null', () => {
    const parsed = gatewayInfoSchema.parse({
      name: 'The Muellers',
      model: null,
      auditEnabled: true,
      version: '1.2.3',
    });
    assert.equal(parsed.model, null);
    assert.equal(parsed.auditEnabled, true);
  });

  it('rejects an info body missing a member rather than half-configuring the device', () => {
    assert.equal(gatewayInfoSchema.safeParse({ name: 'x', model: null, version: '1' }).success, false);
    assert.equal(
      gatewayInfoSchema.safeParse({ name: '', model: null, auditEnabled: false, version: '1' }).success,
      false,
    );
  });

  it('parses a redeem response, and rejects one with a blank member token', () => {
    assert.equal(gatewayRedeemResponseSchema.safeParse(REDEEMED).success, true);
    assert.equal(
      gatewayRedeemResponseSchema.safeParse({ ...REDEEMED, memberToken: '' }).success,
      false,
      'an empty token would save a connection that can never work',
    );
  });

  it('pins the paths the gateway contract fixes', () => {
    assert.equal(GATEWAY_INFO_PATH, '/v1/gateway/info');
    assert.equal(GATEWAY_REDEEM_PATH, '/v1/invites/redeem');
    assert.equal(GATEWAY_API_PREFIX, '/v1');
  });
});

describe('buildGatewayAiSettings', () => {
  it('writes an ordinary openai-compatible row pointed at the gateway’s /v1', () => {
    const settings = buildGatewayAiSettings({
      gatewayUrl: 'https://gw.example.com',
      redeemed: REDEEMED,
      now: 1_700_000_000_000,
    });

    assert.deepEqual(settings, {
      provider: 'openai-compatible',
      model: 'qwen3-vl-8b',
      baseUrl: 'https://gw.example.com/v1',
      apiKey: 'gwt_member_token',
      connectedVia: 'invite',
      auditEnabled: false,
      updatedAt: 1_700_000_000_000,
    });
  });

  it('falls back to the instance-preset default model when the gateway names none', () => {
    const settings = buildGatewayAiSettings({
      gatewayUrl: 'https://gw.example.com',
      redeemed: { ...REDEEMED, gateway: { ...REDEEMED.gateway, model: null } },
      now: 0,
    });
    assert.equal(settings.model, 'openplate-plate-1');
  });

  it('persists the gateway’s audit declaration onto the row, so the notice survives offline', () => {
    const settings = buildGatewayAiSettings({
      gatewayUrl: 'https://gw.example.com',
      redeemed: { ...REDEEMED, gateway: { ...REDEEMED.gateway, auditEnabled: true } },
      now: 0,
    });
    assert.equal(settings.auditEnabled, true);
    assert.equal(isAuditDisclosureRequired(settings), true, 'the settings page and the scan screen both read this');
  });

  it('re-joining the same gateway lands on the same baseUrl, so the row updates in place', () => {
    const first = buildGatewayAiSettings({ gatewayUrl: 'https://gw.example.com', redeemed: REDEEMED, now: 1 });
    const second = buildGatewayAiSettings({
      gatewayUrl: 'https://gw.example.com',
      redeemed: { ...REDEEMED, memberToken: 'gwt_rotated' },
      now: 2,
    });
    assert.equal(first.baseUrl, second.baseUrl);
    assert.equal(second.apiKey, 'gwt_rotated');
  });
});

describe('an invalid invite', () => {
  it('is a 400 whose body is never parsed — the client says one generic thing', () => {
    // The route maps ANY non-200 to the single `invite-invalid` state; this
    // pins the contract half of that: the 400 body carries no field this app
    // reads, so there is nothing that could leak which of invalid / expired /
    // already-used it was.
    assert.equal(gatewayRedeemResponseSchema.safeParse({ error: 'invite_expired' }).success, false);
  });
});

describe('a gateway that revoked consent', () => {
  it('classifies 403 {"error":"reconsent_required"} as its own cause, not a bad key', async () => {
    const response = new Response(JSON.stringify({ error: 'reconsent_required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    const classified = await classifyVisionHttpFailure(response);
    assert.equal(classified.cause, 'reconsent-required');
    assert.match(classified.message, /new invite/);
  });

  it('leaves an ordinary 403 as an auth failure', async () => {
    const response = new Response(JSON.stringify({ error: { code: 'invalid_api_key' } }), { status: 403 });
    const classified = await classifyVisionHttpFailure(response);
    assert.equal(classified.cause, 'auth');
  });
});
