/**
 * What happens the moment the account ceremony ENDS, as a pure decision.
 *
 * ── The bug this replaced ────────────────────────────────────────────────
 *
 * `/settings/sync` used to read the ceremony's end off the `false` edge of
 * `onCeremonyActiveChange`. That callback does not mean "the ceremony ended":
 * it is re-fired by an effect whose cleanup runs whenever its identity
 * changes, and the identity changed on the very first render after
 * provisioning started. So the edge arrived while the wizard was still in
 * `generating`, the route navigated to `/join` before the account existed, and
 * the account card, which is the only display of the recovery code there will
 * ever be, was never rendered. Seen on production 2026-09-04.
 *
 * The end of the ceremony is now ONE event, fired by the wizard when its
 * reducer reaches `complete` — which the reducer only allows after the card
 * has been shown and the person has ticked "I saved it" (`setup-flow.ts`).
 * This function is what that event is spent on, and it is here rather than in
 * the route so it can be read and tested in one place.
 */

/** Where a finished account ceremony leaves the person. */
export type CeremonyHandoff =
  /** Stay on the settings screen, which now shows the connected panel. */
  | 'stay'
  /** Go on to `/join`: this instance's link carried a gateway half and it is still parked. */
  | 'join';

/**
 * Decides whether the finished ceremony is the END of the journey or its
 * middle.
 *
 * On an OPEN instance it is the end. A gateway is genuinely optional there,
 * the parked half waits in the slot, and the banner on `/settings/sync` points
 * at it — taking the person somewhere they did not ask to go would be the
 * surprise.
 *
 * On a MANAGED instance the person followed one link carrying two
 * capabilities, and this ceremony spent the first. There is nothing to decide
 * about the second, so `/join` picks it up and finishes.
 *
 * @param managed - `PublicConfig.managed`.
 * @param hasPendingGatewayJoin - is there gateway business left in this tab's pending slot?
 */
export function resolveCeremonyHandoff({
  managed,
  hasPendingGatewayJoin,
}: {
  managed: boolean;
  hasPendingGatewayJoin: boolean;
}): CeremonyHandoff {
  if (!managed) return 'stay';
  return hasPendingGatewayJoin ? 'join' : 'stay';
}
