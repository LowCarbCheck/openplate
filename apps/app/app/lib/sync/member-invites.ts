/**
 * WHETHER TO DRAW AN INVITE CARD AT ALL, as one pure question (M212 spec 04).
 *
 * ── Two facts, and neither one is enough ─────────────────────────────────
 *
 * `InstanceDescriptor.memberInvites` says the ROUTE exists on this deployment:
 * `false` means `POST /v1/auth/invites` answers the ordinary unknown-path 404
 * to everybody, signed in or not, so a card there is a button that cannot
 * work. `AccountView.invitesLeft` says the CAP is about this account:
 * `null` is an administrator, who mints through the admin API and is exempt,
 * and it is also an instance with the feature off, and it is also the moment
 * after a reload before the account view has been read. None of those three
 * draws a card, and all three read as `null` (`PROTOCOL.md` §5.15).
 *
 * `0` IS NOT `null` AND MUST NOT BE FOLDED INTO IT. Zero left is an account
 * that had five and used them, which is a card with a true sentence on it and
 * a disabled button, and telling that person nothing at all would leave them
 * looking for a feature they can see other people have.
 *
 * ── Drawn, never trusted ─────────────────────────────────────────────────
 *
 * A `true` here is permission to render, never permission to mint. The service
 * refuses the sixth invitation whatever a client believes, and it refuses a
 * second invitation to an address that already redeemed one, which no client
 * can know. So this is a display rule, and the screen shows the same neutral
 * sentence for a refusal as for a success.
 */

/**
 * Does this account get an invite card?
 *
 * @param input.memberInvites - `InstanceDescriptor.memberInvites`. `false` for
 *   a deployment without the route, for an unreachable handshake and for a
 *   service older than the field, which are one answer: draw nothing.
 * @param input.invitesLeft - `AccountView.invitesLeft`, or `null`.
 * @returns `true` only when the instance offers invitations AND the cap is
 *   about this account, whether or not it has any left.
 */
export function canSendMemberInvites({
  memberInvites,
  invitesLeft,
}: {
  memberInvites: boolean;
  invitesLeft: number | null;
}): boolean {
  return memberInvites && invitesLeft !== null;
}
