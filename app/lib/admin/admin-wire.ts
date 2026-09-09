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
  /**
   * When this account's AI allowance ends, or `null` for no end at all.
   *
   * `.catch(null)` RATHER THAN A HARD FAILURE, which is the opposite of the
   * choice `aiUsedToday` above makes, and the difference is what a wrong answer
   * would say. A missing count renders `undefined / 200` and reads as "nobody
   * scanned today", so it must fail at the boundary. A missing end date has a
   * true reading already: `null` IS "no end date", which is what a service
   * built before this field means, so degrading to it states a fact rather than
   * inventing one.
   */
  allowanceExpiresAt: z.string().nullable().catch(null),
  suspendedAt: z.string().nullable(),
  /**
   * How many invitations this account may still send, or `null` when the cap is
   * not about it.
   *
   * `null`, NEVER `0`, for an administrator and for an instance with the route
   * switched off (`PROTOCOL.md` §5.15). `.catch(null)` for the same reason as
   * the end date above: an older service means exactly "there is no cap here".
   */
  invitesLeft: z.number().int().nullable().catch(null),
  createdAt: z.string(),
  /**
   * When this person last did something on purpose, or `null` if they never
   * have.
   *
   * NULLABLE, AND IT STAYS NULLABLE. An invited account that has not signed in
   * yet has no value at all, and the screen owes that person words rather than
   * an epoch. The service writes it on a sign-in and on a proxied photo read,
   * and deliberately not on a token refresh or a sync poll, so it means
   * "somebody acted" and not "a client was running" (`PROTOCOL.md` §5.20).
   *
   * A TIMESTAMP, never a phrase. "3 days ago" is a rendering decision that
   * depends on the reader's clock and the reader's language, and an API that
   * made it would make it once for every client.
   */
  lastSeenAt: z.string().nullable(),
});
export type AdminAccountView = z.infer<typeof accountViewSchema>;

/**
 * One UTC day of somebody's photo reading. A count, never a log.
 *
 * The service keeps one integer per account per day and nothing else: no
 * prompt, no model, no clock time inside the day. Days are the whole
 * resolution that exists, on purpose (`openplate-core/src/db/schema.ts:412`).
 */
export const activityDaySchema = z.object({ day: z.string(), count: z.number().int() });
export type AdminActivityDay = z.infer<typeof activityDaySchema>;

/** The window a strip covers: how many days, and the first and last day key in it. */
export const activityWindowSchema = z.object({ days: z.number().int(), fromDay: z.string(), toDay: z.string() });
export type AdminActivityWindow = z.infer<typeof activityWindowSchema>;

/**
 * `GET /v1/admin/accounts/:id/activity`, one person's strip, unwrapped.
 *
 * UNLIKE THE LISTS, THIS BODY IS NOT IN AN ENVELOPE. It is the view itself, as
 * `admin-routes.ts` sends it; transcribed from `PROTOCOL.md` §5.20 rather than
 * from a summary table, which is the mistake `adminStatsResponseSchema` above
 * records.
 *
 * `days` carries EVERY day of the window, in order, zero-filled by the
 * service. That is what lets the strip draw a quiet day and refuse to draw a
 * day it has no answer for: inside the window a missing entry cannot happen,
 * so an absent square can only mean "outside the window".
 *
 * `window` reports the window the service actually drew, which is not always
 * the one that was asked for: anything longer than the retention window is
 * answered with the retention window.
 */
export const accountActivitySchema = z.object({
  accountId: z.number().int(),
  lastSeenAt: z.string().nullable(),
  window: activityWindowSchema,
  days: z.array(activityDaySchema),
});
export type AdminAccountActivity = z.infer<typeof accountActivitySchema>;

/**
 * `GET /v1/admin/activity?days=&limit=&offset=` — everybody's strip in one
 * read, paged exactly like `/v1/admin/accounts`.
 *
 * WHY A BATCH ENDPOINT AT ALL. The list draws a seven day strip beside every
 * row, and one request per person would be one request per row on every load
 * of the console. The service already holds one integer per account per day,
 * so the join is cheaper there than the round trips are here.
 *
 * `accounts` carries EVERY account on the page, zero filled by the service and
 * in the same order the accounts list returns, so an account with no reading
 * at all arrives as a run of zeroes rather than as an absent entry. The screen
 * relies on that in the same way the single-person strip does
 * (`activity-strip.ts`), and an account this client never received simply has
 * no strip drawn, which is a different picture from a quiet one.
 *
 * `window` is the window the SERVICE drew, which is not always the one that
 * was asked for: anything longer than its retention window is answered with
 * the retention window.
 */
export const activityRowSchema = z.object({ accountId: z.number().int(), days: z.array(activityDaySchema) });
export type AdminActivityRow = z.infer<typeof activityRowSchema>;

export const activityListSchema = z.object({
  window: activityWindowSchema,
  accounts: z.array(activityRowSchema),
  total: z.number().int(),
});

/** Everybody's strip, collected across pages. `window` is the one the service reported on the first page. */
export interface AdminActivityList {
  window: AdminActivityWindow;
  accounts: AdminActivityRow[];
  total: number;
}

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

/**
 * The four counts the console shows.
 *
 * UNKNOWN FIELDS ARE TOLERATED, by zod's default stripping. The service sends
 * `accountsWithBlob`, `blobVersions`, `keyRecords` and `blobBytes` beside
 * these, and it will send more: a schema that refused them would turn every
 * new operator metric into a broken admin page.
 */
export const adminStatsSchema = z.object({
  accounts: z.number().int(),
  admins: z.number().int(),
  pendingInvites: z.number().int(),
  aiRequestsToday: z.number().int(),
});
export type AdminStats = z.infer<typeof adminStatsSchema>;

/**
 * `GET /v1/admin/stats` — WRAPPED, like every other admin response.
 *
 * The body is `{"stats": {...}}`, as the 0.5.0 admin API always sent it. This
 * client read the counts at the top level, so the parse failed, the throw
 * escaped `Promise.all`, and the console rendered its retry card with three
 * `200`s in the network log and nothing in the browser console. The lists next
 * to it are wrapped the same way (`{"accounts": [...]}`) and were right; this
 * one was transcribed from the milestone's summary table rather than from a
 * body.
 */
export const adminStatsResponseSchema = z.object({ stats: adminStatsSchema });

// ─── Reported estimates ─────────────────────────────────────────────────────
//
// `GET /v1/admin/feedback`, `GET /v1/admin/feedback/:id` and
// `DELETE /v1/admin/feedback/:id`, transcribed from
// `openplate-core/src/server/admin-feedback-routes.ts`: `toSummaryView` at
// `:79`, `toDetailView` at `:97`, the list envelope at `:183` and the detail
// envelope at `:209`.
//
// A SUMMARY CARRIES NO FIGURES, AND THAT IS THE SERVICE'S DECISION, not an
// omission this client should route around by reading every row.
// `feedback-admin-store.ts` says why in its header: the list is the queue an
// operator scans, so a screenshot of it carries nothing out of anybody's
// diary, and the figures belong to the one report they opened. That is why
// there is a detail screen at all.

/** One report in the operator's queue. Everything needed to decide whether to open it, and nothing from a diary. */
export const feedbackReportSummarySchema = z.object({
  id: z.number().int(),
  accountId: z.number().int(),
  /** `false` is a typed meal, or a photograph the person's device had already evicted. Never an error. */
  hasImage: z.boolean(),
  consentWordingVersion: z.string(),
  createdAt: z.string(),
});
export type AdminFeedbackReport = z.infer<typeof feedbackReportSummarySchema>;

/**
 * The figures the model produced for the reported entry.
 *
 * TOLERANT, FIELD BY FIELD, and deliberately so. The service stores
 * `measurements` verbatim and has no opinion about it
 * (`admin-feedback-routes.ts:90-96`), so a report written by an older or a
 * newer build of this app is a body this screen still has to draw. A strict
 * object would turn one missing macro into an unreadable report, and the
 * reviewer would lose the six figures that did arrive.
 *
 * The field list is `FeedbackMeasurements` in
 * `#app/lib/feedback/feedback-report`, which is the writer.
 *
 * THERE IS NO NOTE AND NO MODEL NAME HERE. The writer sends neither, on
 * purpose: the report is the entry, not a message. `source` and `aiEstimated`
 * are as close as this wire comes to naming where the figures came from.
 */
export const reportedMeasurementsSchema = z.object({
  name: z.string().catch(''),
  quantityGrams: z.number().nullable().catch(null),
  loggedAt: z.string().catch(''),
  source: z.string().catch(''),
  aiEstimated: z.boolean().catch(false),
  carbs: z.number().nullable().catch(null),
  fiber: z.number().nullable().catch(null),
  sugars: z.number().nullable().catch(null),
  polyols: z.number().nullable().catch(null),
  protein: z.number().nullable().catch(null),
  fat: z.number().nullable().catch(null),
  kcal: z.number().nullable().catch(null),
});
export type ReportedMeasurements = z.infer<typeof reportedMeasurementsSchema>;

/** One opened report: the summary, the figures, and the consent record that let them be kept. */
export const feedbackReportDetailSchema = feedbackReportSummarySchema.extend({
  measurements: reportedMeasurementsSchema,
  consent: z.object({ agreedAt: z.string(), wordingVersion: z.string() }),
});
export type AdminFeedbackReportDetail = z.infer<typeof feedbackReportDetailSchema>;

export const feedbackListSchema = z.object({
  reports: z.array(feedbackReportSummarySchema),
  total: z.number().int(),
});
export const feedbackReportResponseSchema = z.object({ report: feedbackReportDetailSchema });
