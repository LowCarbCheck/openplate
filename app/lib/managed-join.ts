/**
 * What `/join` does with a gateway half, as a pure decision (M187 spec 03).
 *
 * On an OPEN instance the answer has one shape and always did: show the
 * confirm card and wait for a tap. The gateway's address arrived in somebody's
 * link, the person may never have heard of it, and joining hands that machine
 * photographs of their meals. A tap is the least that deserves.
 *
 * On a MANAGED instance the same link is the instance's own front door. The
 * operator minted both halves together, the person is holding the one link
 * they were sent, and the account ceremony they just finished was step one of
 * two. Asking them to confirm a connection to the instance they are already
 * standing on is a speed bump, not consent — so the redemption runs by itself
 * and the person lands in the app.
 *
 * TWO THINGS STILL STOP IT, and both are here rather than in the route so they
 * can be read in one place and tested without a browser:
 *
 * 1. **No account yet.** A gateway connection now belongs to the ACCOUNT
 *    (M187 spec 02), so redeeming into a signed-out device would write it
 *    where nothing carries it anywhere. The person signs in first.
 * 2. **The gateway declares that it audits.** `auditEnabled` means that
 *    gateway's operator can read submitted photos, and that disclosure is
 *    designed to be the loudest thing on the confirm card. Consent to being
 *    watched is the one thing a smoother flow may not automate away, so an
 *    auditing gateway keeps its card and its tap on every kind of instance.
 */

/** What the join screen does next with a parked gateway half. */
export type ManagedGatewayStep =
  /** Show the confirm card and wait for a tap. The open-instance behaviour, and the audit case. */
  | 'confirm'
  /** Redeem straight away: the person is signed in, on the instance that issued the link. */
  | 'auto-redeem'
  /** Ask for a sign-in first, because a gateway connection belongs to an account. */
  | 'sign-in-first';

/**
 * Decides how the gateway half is spent.
 *
 * @param managed - `PublicConfig.managed`. `false` yields `confirm` for every
 *   input, which is exactly the behaviour this route had before the flag.
 * @param hasAccount - is a sync session open on this device right now?
 * @param auditRequired - `isAuditDisclosureRequired(info)` for the gateway that answered the probe.
 */
export function resolveGatewayStep({
  managed,
  hasAccount,
  auditRequired,
}: {
  managed: boolean;
  hasAccount: boolean;
  auditRequired: boolean;
}): ManagedGatewayStep {
  if (!managed) return 'confirm';
  if (!hasAccount) return 'sign-in-first';
  if (auditRequired) return 'confirm';
  return 'auto-redeem';
}
