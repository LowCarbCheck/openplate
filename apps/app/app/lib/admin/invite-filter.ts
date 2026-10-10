/**
 * Narrowing and ordering the invitations, and what each one says about its expiry.
 *
 * ── Every state is reachable, and pending is where you land ──────────────
 *
 * The service returns every invitation it has ever minted, in four states
 * (operator decision, 2026-10-11). The list used to show only the pending
 * ones, on the argument that the useful list is "who have I invited who has not
 * arrived yet". That list is still the one the tab opens on. The rest sit
 * behind chips that carry their counts, so "did the invitation I withdrew last
 * week really go?" has an answer without a trip to the database.
 *
 * ── Pure, with `now` passed in ───────────────────────────────────────────
 *
 * "Expires in 2 days" is a fact about two instants. The functions take the
 * clock as a parameter, so a test can pin it.
 *
 * ── The address holds the choice ─────────────────────────────────────────
 *
 * `?status=expired`. The default (pending) is never written, and a value this
 * build does not know reads as the default.
 */
import { MS_PER_DAY } from './people-age';
import type { InviteStatus, InviteView } from './admin-wire';

/** The chips. A status, or `all`. */
export type InviteStatusFilter = InviteStatus | 'all';

/** Every chip, in the order they are drawn. Pending first, because it is the default. */
export const INVITE_STATUS_FILTERS: readonly InviteStatusFilter[] = [
  'pending',
  'expired',
  'revoked',
  'redeemed',
  'all',
];

/** The chip a fresh visit opens on. */
export const DEFAULT_INVITE_STATUS: InviteStatusFilter = 'pending';

/** An invitation that runs out in fewer whole days than this is flagged. */
export const EXPIRES_SOON_DAYS = 3;

/** How many invitations each chip would leave. */
export interface InviteCounts {
  pending: number;
  expired: number;
  revoked: number;
  redeemed: number;
  all: number;
}

export function countInvites(invites: readonly InviteView[]): InviteCounts {
  const count = (status: InviteStatus): number => invites.filter((invite) => invite.status === status).length;
  return {
    pending: count('pending'),
    expired: count('expired'),
    revoked: count('revoked'),
    redeemed: count('redeemed'),
    all: invites.length,
  };
}

/** The invitations a chip shows, newest first. Ties go to the later number. Never mutates its input. */
export function selectInvites({
  invites,
  status,
}: {
  invites: readonly InviteView[];
  status: InviteStatusFilter;
}): InviteView[] {
  const shown = status === 'all' ? invites : invites.filter((invite) => invite.status === status);
  return shown.toSorted((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt) || b.id - a.id);
}

function timeOf(iso: string): number {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
}

/** What a row says about the end of an invitation, if it says anything. */
export type InviteExpiry =
  { kind: 'none' } | { kind: 'in-days'; days: number; isSoon: boolean } | { kind: 'ended'; iso: string };

/**
 * The expiry line of one invitation.
 *
 * - PENDING: the whole days left, rounded DOWN, with "0" meaning "today". Down,
 *   not to the nearest, so the amber flag (fewer than {@link EXPIRES_SOON_DAYS})
 *   and the number agree: 2.6 days left says "2 days" and is amber, and never
 *   says "3 days" in amber.
 * - EXPIRED: the instant it ended, which the row prints as a date.
 * - REVOKED and ACCEPTED: nothing. A withdrawn link and a spent one have no
 *   expiry worth reading.
 */
export function inviteExpiry({ invite, now }: { invite: InviteView; now: Date }): InviteExpiry {
  if (invite.status === 'expired') return { kind: 'ended', iso: invite.expiresAt };
  if (invite.status !== 'pending') return { kind: 'none' };
  const endsAt = Date.parse(invite.expiresAt);
  if (Number.isNaN(endsAt)) return { kind: 'none' };
  const days = Math.max(0, Math.floor((endsAt - now.getTime()) / MS_PER_DAY));
  return { kind: 'in-days', days, isSoon: days < EXPIRES_SOON_DAYS };
}

/** The chip an address names, or the default. */
export function readInviteStatus(params: URLSearchParams): InviteStatusFilter {
  return INVITE_STATUS_FILTERS.find((candidate) => candidate === params.get('status')) ?? DEFAULT_INVITE_STATUS;
}

/** The address parameters for a chip. The default is left out. */
export function writeInviteStatus(status: InviteStatusFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (status !== DEFAULT_INVITE_STATUS) params.set('status', status);
  return params;
}
