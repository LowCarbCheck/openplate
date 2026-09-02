/**
 * Gateway-mode onboarding: the pure half.
 *
 * A "gateway" is a family/household box someone else runs. They email an invite
 * link, the link opens `/connect-gateway?gateway=…&invite=…` in THIS client, and
 * the client configures itself: it asks the gateway who it is, shows a confirm
 * card, redeems the invite for a member token, and writes an ORDINARY
 * `openai-compatible` BYOK settings row — exactly like `instance-preset.ts`
 * does for an operator-configured preset. There is no new provider concept, no
 * server state, and no secret anywhere near this app's server: every request
 * below is made BY THE BROWSER, straight to the gateway (see the route's header
 * for why that constraint is load-bearing).
 *
 * Everything in this file is pure so the route stays a thin shell: URL
 * normalization, the two wire schemas, the settings-row construction and the
 * "must we warn about auditing" predicate are all directly unit-testable
 * without a DOM, a store or a clock (`now` is a parameter, never `Date.now()`).
 */
import { z } from 'zod';

import { DEFAULT_INSTANCE_INFERENCE_MODEL } from '#app/config/public-config';
import type { LocalAiSettings } from '#app/lib/local-store';

/**
 * The gateway's API namespace, and the suffix a connected settings row's
 * `baseUrl` carries.
 *
 * The gateway speaks the OpenAI-compatible chat-completions API under the same
 * `/v1` prefix its own endpoints live under, so `${gatewayUrl}/v1` is what
 * `openai-compatible.ts` must be given — it appends `/chat/completions` itself.
 * This mirrors an instance preset, whose operator types the `/v1` by hand into
 * `DEFAULT_INFERENCE_BASE_URL`; here the invite link carries only the gateway
 * root, so the suffix is appended for them.
 */
export const GATEWAY_API_PREFIX = '/v1';

/** `GET` — who this gateway is, asked before the user is offered anything. */
export const GATEWAY_INFO_PATH = `${GATEWAY_API_PREFIX}/gateway/info`;

/** `POST {"inviteToken"}` — the one-shot invite → member-token exchange. */
export const GATEWAY_REDEEM_PATH = `${GATEWAY_API_PREFIX}/invites/redeem`;

/**
 * Hostnames the production CSP already allows over plain `http:`
 * (`app/config/content-security-policy.ts`'s `LOOPBACK_ORIGINS`). Kept in step
 * with that list deliberately: those are exactly the addresses a browser will
 * let this page dial without an operator touching `CSP_CONNECT_EXTRA`, and they
 * are also the only ones where an unencrypted gateway URL is defensible.
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

/** The `/v1/gateway/info` body, parsed rather than asserted — it is a third party's HTTP response. */
export const gatewayInfoSchema = z.object({
  name: z.string().min(1),
  model: z.string().nullable(),
  auditEnabled: z.boolean(),
  version: z.string(),
});

export type GatewayInfo = z.infer<typeof gatewayInfoSchema>;

/** The 200 body of `/v1/invites/redeem`. A 400 body is deliberately never parsed — see the route. */
export const gatewayRedeemResponseSchema = z.object({
  memberId: z.string().min(1),
  memberToken: z.string().min(1),
  gateway: z.object({
    name: z.string().min(1),
    model: z.string().nullable(),
    auditEnabled: z.boolean(),
  }),
});

export type GatewayRedeemResponse = z.infer<typeof gatewayRedeemResponseSchema>;

/**
 * Normalizes the `?gateway=` parameter, or `null` when it is not a usable
 * gateway address.
 *
 * `null` rather than a throw: this value arrives from a link in someone's
 * inbox, so a mangled one is an ordinary user-facing outcome ("this link
 * doesn't look right"), not an exceptional condition. Contrast
 * `parseSyncServerUrl`, which throws — that one is an OPERATOR's own
 * environment variable, where failing loudly at boot is the cheap option.
 *
 * The rules:
 * - `https:` anywhere;
 * - `http:` ONLY for loopback, matching the CSP's standing carve-out. A plain
 *   `http://` gateway on the LAN is blocked by the browser's mixed-content rule
 *   regardless of what this function returns, so accepting it here would only
 *   move the failure later and make it harder to explain;
 * - trailing slashes trimmed, so `${gatewayUrl}${GATEWAY_INFO_PATH}` can never
 *   produce a double slash;
 * - any query string or fragment dropped — a gateway address has neither, and
 *   silently carrying one into every request URL is a debugging trap.
 */
export function normalizeGatewayUrl(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }

  const isLoopback = LOOPBACK_HOSTNAMES.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) return null;

  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

/**
 * The shape every gateway invite carries, and the client's half of the service
 * binding minted in `openplate-gateway/src/invite-store.ts`.
 *
 * A join link can carry this token beside an `openplate-sync` signup invite,
 * which wears `si_`. Without the prefix the two are interchangeable strings,
 * and posting one to the wrong service is one swapped argument away. The
 * gateway runs the same gate on the way in, and that is the one that matters;
 * this one only stops the accident before it becomes a network call and turns a
 * remote refusal into a local message.
 */
export const GATEWAY_INVITE_PREFIX = 'gi_';

/** Whether a string could be a gateway invite at all. A shape gate, never a validity check. */
export function isGatewayInviteToken(token: string): boolean {
  return token.startsWith(GATEWAY_INVITE_PREFIX);
}

/**
 * The invite token, trimmed, or `null` when absent, blank or minted by the
 * other service.
 *
 * A wrong-service token reads as NO token, which lands on the same "this link
 * doesn't look right" card a truncated link gets. There is nothing better to
 * offer: the person holding it cannot fix a link somebody else built, and the
 * only useful instruction is to ask for another one.
 */
export function normalizeInviteToken(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return isGatewayInviteToken(trimmed) ? trimmed : null;
}

/**
 * Whether the operator must add this gateway's origin to `CSP_CONNECT_EXTRA`
 * before the browser is allowed to talk to it.
 *
 * A gateway URL is typed into a LINK, not into this server's environment, so
 * the production `connect-src` allowlist cannot possibly contain it — and
 * widening the policy at runtime is not on the table (the allowlist is what
 * stops an injected script exfiltrating the key that lives in this page; see
 * AGENTS.md "BYOK Security Rules"). So the app cannot fix this; it can only say
 * precisely what a person has to do. Two origins are already allowed and need
 * no action: this app's own origin, and loopback.
 *
 * Used to pick the failure copy, never to skip a request: a CSP block and an
 * offline gateway are indistinguishable from `fetch`, so the request is always
 * attempted and this only decides what the failure card explains.
 */
export function requiresOperatorCspAllowlisting({
  gatewayUrl,
  appOrigin,
}: {
  gatewayUrl: string;
  appOrigin: string;
}): boolean {
  const gatewayOrigin = new URL(gatewayUrl).origin;
  if (gatewayOrigin === appOrigin) return false;
  return !LOOPBACK_HOSTNAMES.has(new URL(gatewayUrl).hostname);
}

/**
 * THE disclosure predicate: does this connection have to tell the user their
 * submissions are reviewable?
 *
 * One function for both surfaces — the pre-join confirm card and the persistent
 * settings notice — so "an administrator can read your photos" can never be
 * true on one screen and absent on the other. Anything that isn't an explicit
 * `true` (an older settings row with no field, a `null` config, an info body
 * this build didn't parse) resolves to `false`, which is safe in the only
 * direction that matters: `auditEnabled` is set BY THE GATEWAY, and a gateway
 * that says it audits always says so as a boolean.
 */
export function isAuditDisclosureRequired(source: { auditEnabled?: boolean | null } | null | undefined): boolean {
  return source?.auditEnabled === true;
}

/**
 * The settings row a redeemed invite saves — the whole point of the flow, as one
 * pure function.
 *
 * Deliberately the same shape `buildPresetAiSettings` produces, for the same
 * reason: what a gateway hands over is a base URL and a bearer token, which is
 * precisely a BYOK `openai-compatible` configuration. `connectedVia: 'invite'`
 * is the only record of where it came from, and it exists so the settings page
 * can word the disconnect dialog honestly (there is no provider account to
 * revoke anything at) — it never gates behaviour.
 *
 * `auditEnabled` is persisted rather than re-fetched because the notice has to
 * render on a settings page that may be opened offline, weeks later. It is a
 * snapshot of what the gateway said at join time; a gateway that turns auditing
 * on afterwards is outside what this client can observe.
 */
export function buildGatewayAiSettings({
  gatewayUrl,
  redeemed,
  now,
}: {
  gatewayUrl: string;
  redeemed: GatewayRedeemResponse;
  now: number;
}): LocalAiSettings {
  return {
    provider: 'openai-compatible',
    model: redeemed.gateway.model ?? DEFAULT_INSTANCE_INFERENCE_MODEL,
    baseUrl: `${gatewayUrl}${GATEWAY_API_PREFIX}`,
    apiKey: redeemed.memberToken,
    connectedVia: 'invite',
    auditEnabled: redeemed.gateway.auditEnabled,
    updatedAt: now,
  };
}
