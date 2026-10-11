/**
 * The four counts across the top of the admin console, as `GET /v1/admin/stats` sends them.
 */
import type { AdminStats } from '#app/lib/admin/admin-wire';

/** A new instance: nobody yet but the administrator who set it up. */
export const ZERO_STATS: AdminStats = { accounts: 0, admins: 0, pendingInvites: 0, aiRequestsToday: 0 };

/** One administrator, no other account, no invitation, no photo read yet. */
export const FRESH_INSTANCE_STATS: AdminStats = { accounts: 1, admins: 1, pendingInvites: 0, aiRequestsToday: 0 };

/** A busy instance, with five-figure counts to show how the cells take a wide number. */
export const BUSY_STATS: AdminStats = { accounts: 12_846, admins: 7, pendingInvites: 312, aiRequestsToday: 48_190 };
