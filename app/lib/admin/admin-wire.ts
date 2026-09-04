/**
 * The admin API's shapes, transcribed from M192's contract table.
 *
 * ── Parsed, not asserted ─────────────────────────────────────────────────
 *
 * Every response here is PARSED with zod rather than cast. The rest of the
 * sync client casts, and it earns that: those shapes are pinned by the
 * ceremony that consumes them, where a wrong field fails loudly a line later
 * as a decryption error. Nothing on this page decrypts anything. A missing
 * `aiUsedToday` would render `undefined / 200` and an admin would read it as
 * "nobody has scanned today" rather than as a bug, so the boundary is where it
 * has to fail.
 *
 * ── Why these types are not the auth client's ────────────────────────────
 *
 * `AccountView` is shared, deliberately: it is the same row, and an admin
 * looking at somebody's allowance must see the field the person's own account
 * page sees. `InviteView` is new and lives only here, because an invitation is
 * not a thing an ordinary account may ever look at.
 */
import { z } from 'zod';

/** `/v1/admin` — the whole surface an administrator's token may reach. */
export const ADMIN_API_PREFIX = '/v1/admin';

/** `'admin' | 'member'` on the wire. The client's word for the second one is never shown; see `admin.role.*`. */
export const accountRoleSchema = z.union([z.literal('admin'), z.literal('member')]);
export type AccountRole = z.infer<typeof accountRoleSchema>;

/** An account as an administrator sees it. Identical to the owner's own view: same row, same fields. */
export const accountViewSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: accountRoleSchema,
  dailyAiLimit: z.number().int(),
  aiUsedToday: z.number().int(),
  suspendedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminAccountView = z.infer<typeof accountViewSchema>;

/**
 * Where an invitation is in its life.
 *
 * `pending` is the only one the page lists. The other three are kept because
 * the service sends them and dropping them at the parser would turn a
 * redeemed invite into a parse failure rather than a row that is simply not
 * shown.
 */
export const inviteStatusSchema = z.union([
  z.literal('pending'),
  z.literal('redeemed'),
  z.literal('revoked'),
  z.literal('expired'),
]);
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

export const inviteViewSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: accountRoleSchema,
  dailyAiLimit: z.number().int(),
  expiresAt: z.string(),
  status: inviteStatusSchema,
  createdAt: z.string(),
  redeemedAccountId: z.number().int().nullable(),
});
export type InviteView = z.infer<typeof inviteViewSchema>;

export const accountListSchema = z.object({ accounts: z.array(accountViewSchema), total: z.number().int() });
export const accountResponseSchema = z.object({ account: accountViewSchema });
export const inviteListSchema = z.object({ invites: z.array(inviteViewSchema), total: z.number().int() });

/**
 * What a mail-sending endpoint answers.
 *
 * `emailed` and `link` are the two halves of one decision the OPERATOR made:
 * an instance with no mail configured returns the link so the page can show
 * it, and one with mail returns `null` so the link exists in exactly one
 * place, the mailbox. A page that showed a link whenever it got one would be
 * correct; a page that assumed it always gets one would print "null" on every
 * properly configured instance.
 */
export const deliverySchema = z.object({ emailed: z.boolean(), link: z.string().nullable() });
export type Delivery = z.infer<typeof deliverySchema>;

export const inviteCreatedSchema = deliverySchema.extend({ invite: inviteViewSchema });
export type InviteCreated = z.infer<typeof inviteCreatedSchema>;

/** `GET /v1/admin/stats`. Only the four counts this page shows are required of it. */
export const adminStatsSchema = z.object({
  accounts: z.number().int(),
  admins: z.number().int(),
  pendingInvites: z.number().int(),
  aiRequestsToday: z.number().int(),
});
export type AdminStats = z.infer<typeof adminStatsSchema>;
