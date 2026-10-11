/**
 * Invitations, as `GET /v1/admin/invites` sends them, for the invitation table cards.
 *
 * Plain objects that satisfy `InviteView`. Dates are measured from
 * `PLAYGROUND_NOW`, the instant the cards hand the table as `now`.
 */
import type { InviteView } from '#app/lib/admin/admin-wire';
import { isoAfter, isoBefore } from './clock';

type InviteInput = Pick<InviteView, 'id' | 'email' | 'status' | 'createdAt' | 'expiresAt'> &
  Partial<Omit<InviteView, 'id' | 'email' | 'status' | 'createdAt' | 'expiresAt'>>;

/** One invitation with the usual defaults: a member, 20 photos a day, nobody redeemed it. */
function makeInvite(input: InviteInput): InviteView {
  return { displayName: null, role: 'member', dailyAiLimit: 20, redeemedAccountId: null, ...input };
}

/** No invitation was ever sent. Every chip answers with its own empty sentence. */
export const NO_INVITES: InviteView[] = [];

/** Only open invitations. The Expired, Revoked and Accepted chips have nothing behind them. */
export const ONLY_PENDING_INVITES: InviteView[] = [
  makeInvite({
    id: 1,
    email: 'open.plenty@example.org',
    displayName: 'Olive Open',
    status: 'pending',
    createdAt: isoBefore({ days: 2 }),
    expiresAt: isoAfter({ days: 12 }),
  }),
];

/**
 * Every state at once: open (with time to spare, nearly out, out today),
 * expired (one with its address erased by the retention sweep), withdrawn, and
 * accepted, plus an invitation for an administrator.
 */
export const MIXED_INVITES: InviteView[] = [
  makeInvite({
    id: 1,
    email: 'open.plenty@example.org',
    displayName: 'Olive Open',
    status: 'pending',
    createdAt: isoBefore({ days: 2 }),
    expiresAt: isoAfter({ days: 12 }),
  }),
  makeInvite({
    id: 2,
    email: 'open.soon@example.org',
    status: 'pending',
    createdAt: isoBefore({ days: 11 }),
    expiresAt: isoAfter({ days: 2, hours: 6 }),
    dailyAiLimit: 50,
  }),
  makeInvite({
    id: 3,
    email: 'open.today@example.org',
    displayName: 'Tomas Today',
    status: 'pending',
    createdAt: isoBefore({ days: 13 }),
    expiresAt: isoAfter({ days: 0, hours: 5 }),
  }),
  makeInvite({
    id: 4,
    email: 'open.admin@example.org',
    displayName: 'Rae Admin',
    role: 'admin',
    status: 'pending',
    createdAt: isoBefore({ days: 1 }),
    expiresAt: isoAfter({ days: 13 }),
    dailyAiLimit: 0,
  }),
  makeInvite({
    id: 5,
    email: 'expired.recently@example.org',
    displayName: 'Ewa Expired',
    status: 'expired',
    createdAt: isoBefore({ days: 17 }),
    expiresAt: isoBefore({ days: 3 }),
  }),
  makeInvite({
    id: 6,
    email: '',
    status: 'expired',
    createdAt: isoBefore({ days: 80 }),
    expiresAt: isoBefore({ days: 66 }),
  }),
  makeInvite({
    id: 7,
    email: 'withdrawn@example.org',
    displayName: 'Will Withdrawn',
    status: 'revoked',
    createdAt: isoBefore({ days: 9 }),
    expiresAt: isoAfter({ days: 5 }),
  }),
  makeInvite({
    id: 8,
    email: 'accepted@example.org',
    displayName: 'Alma Accepted',
    status: 'redeemed',
    createdAt: isoBefore({ days: 6 }),
    expiresAt: isoAfter({ days: 8 }),
    redeemedAccountId: 41,
  }),
];
