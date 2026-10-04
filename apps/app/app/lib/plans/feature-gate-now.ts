/**
 * THE FEATURE GATE, read from what the tab already holds (ADR-0024).
 *
 * `canUseFeature` (`capabilities.ts`) is pure. This module is where its three
 * inputs come from, and it reads ONLY memory: the session snapshot for the
 * account's list, and the descriptor the paywall's facts or the tab's own
 * handshake read already hold for the door. It never waits and never sends a
 * request, because its callers decide in the FIRST render of an entry point.
 *
 * ── WHAT IS NOT KNOWN IS OPEN ────────────────────────────────────────────
 *
 * No session, an account view not read yet, no descriptor held for this server,
 * a descriptor that says `plans: false`: every one answers open. A cold boot
 * straight onto a gated screen therefore paints the open form first, and the
 * screen keeps it for that visit (`use-feature-gate.ts`), which is the price of
 * a gate that never flips after paint. The core's proxy is what enforces.
 */
import { registerFastingGate } from '#app/lib/push';
import { peekSettledServerInstance } from '#app/hooks/use-server-instance';
import { getSyncSessionSnapshot } from '#app/lib/sync/sync-session';
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';

import { canUseFeature, type FeatureLabel } from './capabilities';
import { currentPlanGateSession, peekPlanGateFacts } from './plan-gate-facts';
import { hasPlansDoor } from './plans-door';

/**
 * The descriptor held for the open session's server, or `null` when none is.
 * The gate's facts first (read for this account, refreshed in the
 * background), then the tab's own handshake read.
 */
function heldInstance(): InstanceDescriptor | null {
  const session = currentPlanGateSession();
  if (session === null) return null;
  return peekPlanGateFacts(session)?.instance ?? peekSettledServerInstance(session.serverUrl);
}

/**
 * Whether a feature is open for the person on this device right now.
 *
 * @param input.feature - the feature word.
 * @param input.isOwnKey - `true` for an AI feature on the person's own key,
 *   which is never gated.
 */
export function isFeatureOpenNow({
  feature,
  isOwnKey = false,
}: {
  feature: FeatureLabel;
  isOwnKey?: boolean;
}): boolean {
  return canUseFeature({
    feature,
    isOwnKey,
    hasPlansDoor: hasPlansDoor(heldInstance()),
    capabilities: getSyncSessionSnapshot().account?.capabilities,
  });
}

// THE FAST TARGET REMINDER IS PART OF FASTING, and `push.ts` cannot import this
// module (it would close a loop through the sync actions), so it is handed the
// answer here. This module is in the app shell's chunk through the fast chip.
registerFastingGate(() => isFeatureOpenNow({ feature: 'fasting' }));
