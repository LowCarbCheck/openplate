/**
 * THE RULE for letting a synced gateway connection touch a device's AI
 * settings — pure, and deliberately conservative (M187/02).
 *
 * A gateway member token is issued to the PERSON, so it rides in the account's
 * owner-private compartment and reaches every device the account signs in on
 * (`snapshot-partition.ts`). What it must never do is overwrite a provider
 * connection somebody set up by hand: a person who pasted their own OpenRouter
 * key on the laptop does not lose it because the phone joined a household
 * gateway. So the only row this may write over is one that came from a gateway
 * in the first place (`connectedVia: 'invite'`), and the only row it may clear
 * is that same one.
 *
 * The functions here take everything they read as an argument — no store, no
 * clock — so all four cases are unit-testable directly
 * (`tests/unit/gateway-connection-apply.test.ts`). The impure half lives in
 * `local-store-bridge.ts`, which is the one seam sync writes through.
 */
import { aiSettingsFromGatewayConnection } from '#app/lib/gateway-invite';
import type { LocalAiSettings, LocalGatewayConnection } from '#app/lib/local-store';

/** What the apply path should do to this device's AI settings row. */
export type GatewayConnectionApplyDecision =
  /** Leave the device alone. The row is not ours to touch, or it already says this. */
  | { action: 'none' }
  /** Write this row — either the device had none, or the one it had came from a gateway too. */
  | { action: 'write'; settings: LocalAiSettings }
  /** Delete the row: the account disconnected, and this device is still following that gateway. */
  | { action: 'clear' };

/**
 * The newer of two records of the same account fact, by `updatedAt`.
 *
 * The compartment itself merges as ONE unit (`mergeSnapshots` stamps
 * `privateStore:me` and the higher Lamport stamp takes the whole thing), so a
 * device that pulls an older compartment could otherwise adopt a connection it
 * had already replaced — or, worse, resurrect one it had just disconnected.
 * This is the per-key last-writer-wins that stops it.
 *
 * A present record always beats an absent one: absence carries no instant to
 * compare, which is exactly why a disconnect writes a stamped tombstone rather
 * than deleting the row.
 */
export function pickNewerGatewayConnection({
  synced,
  local,
}: {
  synced: LocalGatewayConnection | null | undefined;
  local: LocalGatewayConnection | null | undefined;
}): LocalGatewayConnection | null {
  if (!synced) return local ?? null;
  if (!local) return synced;
  return synced.updatedAt >= local.updatedAt ? synced : local;
}

/**
 * Whether two settings rows describe the same connection.
 *
 * Field by field rather than a JSON comparison: both sides are built by
 * `aiSettingsFromGatewayConnection`, but the stored one has been through
 * `JSON.parse` and a `connectedVia` backfill, so key order is not something to
 * lean on. Its only job is to keep a sync cycle from rewriting an unchanged
 * row every time it runs.
 */
function describesSameConnection(a: LocalAiSettings, b: LocalAiSettings): boolean {
  return (
    a.provider === b.provider &&
    a.model === b.model &&
    a.baseUrl === b.baseUrl &&
    a.apiKey === b.apiKey &&
    a.connectedVia === b.connectedVia &&
    (a.auditEnabled ?? false) === (b.auditEnabled ?? false) &&
    a.updatedAt === b.updatedAt
  );
}

/**
 * The decision, over the four cases the spec names:
 *
 *  1. no row on this device and a connection to apply → write it;
 *  2. the row came from a gateway (`invite`) → overwrite it, which is how a
 *     refreshed member token reaches a device that never saw the new link;
 *  3. the row is `manual` / `oauth` / `preset` → do nothing, ever, in either
 *     direction;
 *  4. the account disconnected (a tombstone) → clear an `invite` row, and only
 *     an `invite` row.
 *
 * `connection` is the WINNER of {@link pickNewerGatewayConnection}, not the
 * pulled value: the ordering question is settled before this is called, so
 * this function never compares instants and cannot be given a stale one to
 * reason about.
 */
export function decideGatewayConnectionApply({
  connection,
  settings,
}: {
  connection: LocalGatewayConnection | null;
  settings: LocalAiSettings | null;
}): GatewayConnectionApplyDecision {
  // Case 3, stated first because it outranks everything below it: a
  // hand-configured provider is never touched by sync, in either direction.
  if (settings !== null && settings.connectedVia !== 'invite') return { action: 'none' };

  // Nothing the account knows about. A device that never joined a gateway and
  // an account that never had one land here together, and both mean "leave it".
  if (connection === null) return { action: 'none' };

  // Case 4. The row is absent or `invite` by the guard above, so this clears
  // only what a gateway put there.
  if (connection.status === 'disconnected') {
    return settings === null ? { action: 'none' } : { action: 'clear' };
  }

  // Cases 1 and 2 — the same write, which is the point: a synced device and
  // the redeeming device end up with the identical row.
  const next = aiSettingsFromGatewayConnection({ connection });
  if (settings !== null && describesSameConnection(settings, next)) return { action: 'none' };
  return { action: 'write', settings: next };
}
