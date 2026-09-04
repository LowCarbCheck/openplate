/**
 * Spending a gateway invite, and surviving the gap between the burn and the
 * save.
 *
 * ── Why this is not part of `/join` ──────────────────────────────────────
 *
 * It was, as a closure inside the route component, and that is how the bug
 * below shipped: the only copy of the gateway's answer was a local variable in
 * a React callback, which no test in this repo's DOM-less unit tier could
 * reach. Here it is an ordinary function over three injected boundaries — the
 * network, and the two stores — so the sequence is exercised directly and the
 * route is left holding only the screen.
 *
 * ── The gap ──────────────────────────────────────────────────────────────
 *
 * `POST /v1/invites/redeem` is ONE-SHOT. The gateway marks the invite used the
 * moment it answers, and the two writes that answer feeds happen afterwards,
 * in this browser's IndexedDB. They are not one transaction and cannot be made
 * into one: one side is somebody else's server, the other is local storage.
 * They are not even one DATABASE — the settings row lives in its own IndexedDB
 * database, deliberately, so that a backup of the tracker can never carry a
 * provider credential (`local-store/ai-settings.ts`).
 *
 * So there is a window in which the server has moved on and the device has
 * nothing. In it, a failing write used to lose the whole join: the screen went
 * back to the confirm card, the spent token was still parked, and "Join"
 * re-posted it. The gateway refused a token it had already burnt, the screen
 * reported an invalid invite, and the slot was emptied — leaving a member on
 * the gateway whose device had no way to reach it.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 * ONE redeem buys the join; everything after it is local and may be repeated.
 * {@link redeemAndPark} parks the gateway's answer in the pending slot and
 * takes the invite out of it in the same breath, BEFORE either write is tried,
 * so the client holds the server's answer until it is safe on disk. Every
 * retry, including one after a document reload, goes through
 * {@link savePendingRedemption}, which dials nothing.
 *
 * ── Write order ──────────────────────────────────────────────────────────
 *
 * Settings first, connection second, and the order is load-bearing because the
 * two cannot share a transaction. The settings row is what the device needs to
 * use the gateway at all; the connection row is the ACCOUNT's copy, and a
 * device that wrote the first and not the second is reconciled on the next sync
 * push (`sync/local-store-bridge.ts` derives the connection from the settings
 * when the account holds none). The reverse order has no such repair: a
 * connection with no settings row is a device that believes it is connected and
 * cannot make a request.
 */
import {
  GATEWAY_REDEEM_PATH,
  buildGatewayAiSettings,
  buildGatewayConnection,
  gatewayRedeemResponseSchema,
  type GatewayRedeemResponse,
} from '#app/lib/gateway-invite';
import {
  clearPendingGatewayRedemption,
  consumeGatewayInvite,
  parkGatewayRedemption,
  type ParkedGatewayRedemption,
} from '#app/lib/join-link';
import type { ConnectedGatewayConnection, LocalAiSettings } from '#app/lib/local-store';
import { reportError } from '#app/lib/report-error';

/** How long the browser waits on the gateway before giving up on the redemption. */
export const GATEWAY_REQUEST_TIMEOUT_MS = 10_000;

/** The captured invite. Never in React state, never in the URL — see `/join`'s header. */
export interface CapturedInvite {
  gatewayUrl: string;
  inviteToken: string;
}

/**
 * What a redemption attempt leaves the screen to say.
 *
 * `save-failed` is the state this module exists for: the invite is SPENT and
 * the answer is parked, so the only honest thing to offer is a retry of the
 * local half. It is emphatically not "the join failed".
 */
export type RedemptionOutcome =
  { status: 'joined'; gatewayName: string } | { status: 'invite-invalid' } | { status: 'save-failed' };

/** The two local writes, injected — production passes the local store, tests pass recorders. */
export interface RedemptionSaveDeps {
  putAiSettings: (settings: LocalAiSettings) => Promise<void>;
  putGatewayConnection: (connection: ConnectedGatewayConnection) => Promise<void>;
}

/** Everything a full redemption needs from outside itself: the network, the stores, the clock. */
export interface RedemptionDeps extends RedemptionSaveDeps {
  redeem: (invite: CapturedInvite) => Promise<GatewayRedeemResponse | null>;
  now: () => number;
}

/**
 * `POST /v1/invites/redeem`, or `null` for any failure.
 *
 * ONE null for every failure on purpose. The gateway answers an invalid,
 * expired or already-used invite with a generic 400, and this client keeps it
 * generic: telling someone which of the three it was tells an attacker holding
 * a guessed token the same thing.
 *
 * `fetchImpl` is a parameter rather than a global read so the call is testable
 * without a network, and so the one place that counts redeem attempts is a
 * place a test can see.
 */
export async function redeemInvite({
  gatewayUrl,
  inviteToken,
  fetchImpl = globalThis.fetch,
}: CapturedInvite & { fetchImpl?: typeof fetch }): Promise<GatewayRedeemResponse | null> {
  let response: Response;
  try {
    response = await fetchImpl(`${gatewayUrl}${GATEWAY_REDEEM_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ inviteToken }),
      signal: AbortSignal.timeout(GATEWAY_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Never carries the token: `reportError` receives the fetch failure only,
    // and this module logs nothing itself.
    reportError(error, { boundary: 'join-gateway-redeem' });
    return null;
  }
  if (!response.ok) return null;
  const parsed = gatewayRedeemResponseSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/**
 * Spends the invite, parks what it bought, and writes it down.
 *
 * THE ONE PLACE that redeems. A second call site would be a second chance to
 * re-post a spent token, which is the entire failure this module was written
 * to end.
 */
export async function redeemAndPark({
  invite,
  deps,
}: {
  invite: CapturedInvite;
  deps: RedemptionDeps;
}): Promise<RedemptionOutcome> {
  const redeemed = await deps.redeem(invite);
  if (redeemed === null) {
    // A rejected token is spent for this tab too: empty the slot before the
    // caller puts an error card up. The slot outlives that screen, and
    // `sign-in-flow.ts` sends a signed-in tab back to `/join` whenever gateway
    // business is parked there — so leaving a dead token behind turns one bad
    // link into every later sign-in in this tab failing the same way. The sync
    // half is not touched, exactly as on the success path.
    consumeGatewayInvite();
    return { status: 'invite-invalid' };
  }

  // Before either write, and this is the fix: the invite is gone from the slot
  // and its answer is in the slot's place. From here on nothing can re-redeem.
  const parked: ParkedGatewayRedemption = {
    gatewayUrl: invite.gatewayUrl,
    redeemed,
    redeemedAt: deps.now(),
  };
  parkGatewayRedemption(parked);

  return savePendingRedemption({ parked, deps });
}

/**
 * The two local writes, and nothing else — the retry path, and the resume path
 * after a reload.
 *
 * Idempotent by construction: both rows are keyed singletons built from the
 * same parked answer and the same parked instant, so running this twice writes
 * the same two rows twice rather than two different ones.
 */
export async function savePendingRedemption({
  parked,
  deps,
}: {
  parked: ParkedGatewayRedemption;
  deps: RedemptionSaveDeps;
}): Promise<RedemptionOutcome> {
  const { gatewayUrl, redeemed, redeemedAt: now } = parked;
  try {
    // TWO writes of one fact, and both are needed (M187/02). The settings row
    // is this DEVICE's provider configuration: the device holds one AI
    // configuration, so this write both creates the gateway connection and
    // makes it the active provider, and re-joining the SAME gateway lands on
    // the same row and simply refreshes its token. The gatewayConnection
    // singleton is the ACCOUNT's record of the same redemption, and it is what
    // rides in the owner-private compartment so a second device of this
    // account is not asked to connect to a provider all over again.
    await deps.putAiSettings(buildGatewayAiSettings({ gatewayUrl, redeemed, now }));
    await deps.putGatewayConnection(buildGatewayConnection({ gatewayUrl, redeemed, now }));
  } catch (error) {
    // The answer stays parked. Nothing is lost, and the caller offers a retry
    // of exactly this function.
    reportError(error, { boundary: 'join-gateway-save' });
    return { status: 'save-failed' };
  }

  // Now, and only now, the slot is emptied: the answer is on disk, so holding a
  // member credential in the tab any longer buys nothing. `consumeGatewayInvite`
  // covers the address and any invite too, so no successful path leaves any
  // part of the gateway half parked.
  clearPendingGatewayRedemption();
  consumeGatewayInvite();
  return { status: 'joined', gatewayName: redeemed.gateway.name };
}
