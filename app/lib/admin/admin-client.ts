/**
 * The admin API, wrapped: `/v1/admin/*` over the signed-in administrator's
 * own session.
 *
 * ── There is no admin credential ─────────────────────────────────────────
 *
 * An administrator is an account with `role: 'admin'`, and this client carries
 * that account's ordinary access token. The service also accepts a static
 * operator token for break-glass work from the command line; this page never
 * sees it and must never ask for one. That is what makes `/admin` the same
 * sign-in as everything else rather than a second door with a second secret.
 *
 * ── A 403 IS A RESULT ────────────────────────────────────────────────────
 *
 * Every method answers {@link AdminOutcome}, so "you are not an
 * administrator" arrives as a value the page renders instead of an exception
 * that unmounts it. Three real things produce that 403: the account was
 * demoted, it was suspended, or the person opened a bookmark from somebody
 * else's session. All three are ordinary, and all three used to end at a
 * blank page with a stack trace in the console.
 *
 * EVERYTHING ELSE STILL THROWS. A 500, a dead connection or a malformed body
 * are not outcomes an admin can act on, and swallowing them into the same
 * union would make "you are not allowed" indistinguishable from "the server
 * fell over" at every call site.
 */
import {
  ADMIN_API_PREFIX,
  accountActivitySchema,
  accountListSchema,
  activityListSchema,
  accountResponseSchema,
  adminStatsResponseSchema,
  deliverySchema,
  feedbackListSchema,
  feedbackReportResponseSchema,
  inviteCreatedSchema,
  inviteListSchema,
  type AccountRole,
  type AdminAccountActivity,
  type AdminAccountView,
  type AdminActivityList,
  type AdminActivityRow,
  type AdminActivityWindow,
  type AdminFeedbackReport,
  type AdminFeedbackReportDetail,
  type AdminStats,
  type Delivery,
  type InviteCreated,
  type InviteView,
} from './admin-wire';
import type { AuthorizedBytes, AuthorizedMethod } from '../sync/engine/client/auth-client';
import type { JsonValue } from '../sync/engine/protocol';
import { isSyncRequestError } from '../sync/engine/client/sync-error';
import { createComponentLogger } from '../logger';
import { z } from 'zod';

const log = createComponentLogger('admin-client');

/**
 * What this client needs from a session, and nothing more.
 *
 * `SyncAuthClient` satisfies it. Naming the seam rather than importing the
 * class keeps the admin page out of the token lifecycle: it cannot refresh,
 * cannot log out, and cannot reach the DEK, because none of that is on this
 * interface.
 */
export interface AdminTransport {
  requestAsAccount(input: { path: string; method: AuthorizedMethod; body?: JsonValue }): Promise<JsonValue>;
  /**
   * The same credential, for a body that is not JSON.
   *
   * ONE PATH USES IT: a reported photograph. It is here rather than behind a
   * second client because the token lifecycle is the reason this seam exists
   * at all, and a photograph fetched outside it would refresh independently.
   */
  requestBytesAsAccount(input: { path: string }): Promise<AuthorizedBytes>;
}

/**
 * The answer to an admin call: the thing, or the one refusal a page renders.
 *
 * `forbidden` covers `403` in all its forms, including the suspended-account
 * one, because they mean the same thing to this page: you may not administer
 * this instance right now.
 */
export type AdminOutcome<T> = { status: 'ok'; value: T } | { status: 'forbidden' };

/**
 * What a request for a reported photograph answered.
 *
 * `gone` IS A THIRD ANSWER, not a failure and not an empty success: the report
 * may never have carried an image (a typed meal), or the retention sweep may
 * already have taken it. The screen says different words for each of the
 * three, so collapsing them here would take that distinction away from it.
 */
export type FeedbackImageOutcome =
  | { status: 'ok'; image: AuthorizedBytes }
  | { status: 'gone' }
  | { status: 'forbidden' };

/** The reported-estimate subtree, under {@link ADMIN_API_PREFIX}. One name, so no call site spells it twice. */
const ADMIN_FEEDBACK_PATH = '/feedback';

/** What an administrator may change about somebody. Every field optional; the service applies what it is sent. */
export interface AccountPatch {
  role?: AccountRole;
  dailyAiLimit?: number;
  suspended?: boolean;
  displayName?: string | null;
}

/** What an invitation is created with. Only the address is required; the service defaults the rest. */
export interface InviteDraft {
  email: string;
  displayName?: string | null;
  role?: AccountRole;
  dailyAiLimit?: number;
  expiresInDays?: number;
}

export class AdminClient {
  private readonly transport: AdminTransport;

  constructor({ transport }: { transport: AdminTransport }) {
    this.transport = transport;
  }

  /**
   * Everybody on this instance, in one array, however many pages that takes.
   *
   * THE PAGING IS THIS CLIENT'S BUSINESS, not the console's. It used to ask
   * for `limit=500` and show whatever came back; the service caps `limit` at
   * 200 (`PROTOCOL.md` §5.20) and answered `400`, so the whole admin page
   * rendered its error card while `/stats` and `/account` returned `200` two
   * lines away. A caller that has to know a server's page ceiling is a caller
   * that will get it wrong the next time the ceiling moves.
   */
  async listAccounts(): Promise<AdminOutcome<{ accounts: AdminAccountView[]; total: number }>> {
    const outcome = await this.collectPages({
      path: `${ADMIN_API_PREFIX}/accounts`,
      readPage: (body) => {
        const page = accountListSchema.parse(body);
        return { items: page.accounts, total: page.total };
      },
    });
    if (outcome.status === 'forbidden') return outcome;
    return { status: 'ok', value: { accounts: outcome.value.items, total: outcome.value.total } };
  }

  /** One account, read fresh. Used after an edit so the row shows what the service stored, not what was typed. */
  async getAccount(input: { id: number }): Promise<AdminOutcome<AdminAccountView>> {
    return this.send({
      path: `${ADMIN_API_PREFIX}/accounts/${input.id}`,
      method: 'GET',
      parse: (body) => accountResponseSchema.parse(body).account,
    });
  }

  /**
   * One person's activity: when they last did something, and one count per UTC
   * day over a bounded window.
   *
   * THE WINDOW IS NOT THIS CLIENT'S TO CHOOSE. It asks for nothing and takes
   * what the service draws, because the cap is the service's retention window
   * and a caller that names its own number would either duplicate that number
   * or ask for a strip made entirely of zeroes for rows that have been pruned.
   * The response says which window it drew and the screen reads it from there.
   *
   * A `404` for an unknown id THROWS, like every other read of one account: it
   * is a person the list showed a moment ago and no longer exists, which is a
   * failure to report rather than an outcome to render.
   */
  async accountActivity(input: { id: number }): Promise<AdminOutcome<AdminAccountActivity>> {
    return this.send({
      path: `${ADMIN_API_PREFIX}/accounts/${input.id}/activity`,
      method: 'GET',
      parse: (body) => accountActivitySchema.parse(body),
    });
  }

  /**
   * EVERYBODY's strip, in one paged read.
   *
   * The list draws a seven day strip beside every row, and the alternative is
   * one request per person on every load of the console. The window IS named
   * here, unlike {@link accountActivity}: the list asks for seven days and the
   * activity page offers thirty and ninety, and the service answers with the
   * window it actually drew, which is what the screen reports.
   *
   * A SERVICE THAT DOES NOT HAVE THIS ENDPOINT ANSWERS 404, AND THAT THROWS,
   * like every other unexpected status. The caller degrades to rows without
   * strips; it must never degrade to a broken list, because the strip is an
   * ornament on a page whose job is to list people.
   */
  async listActivity(input: { days: number }): Promise<AdminOutcome<AdminActivityList>> {
    // The window arrives on every page and is the same on all of them. It is
    // caught on a holder rather than in a plain `let`, because a value only
    // ever assigned inside a callback reads back as its initialiser to the
    // compiler, and an explicit null check on a property does narrow.
    const collected: ActivityWindowHolder = { window: null };
    const outcome = await this.collectPages<AdminActivityRow>({
      path: `${ADMIN_API_PREFIX}/activity`,
      params: [{ name: 'days', value: input.days }],
      readPage: (body) => {
        const page = activityListSchema.parse(body);
        collected.window = page.window;
        return { items: page.accounts, total: page.total };
      },
    });
    if (outcome.status === 'forbidden') return outcome;
    const window = collected.window;
    // Unreachable while `collectPages` reads at least one page, and a throw
    // rather than a guessed window: a strip labelled with a window nobody
    // reported would say something false about a study participant.
    if (window === null) throw new Error('the activity list reported no window');
    return { status: 'ok', value: { window, accounts: outcome.value.items, total: outcome.value.total } };
  }

  /**
   * Changes a role, an allowance, a standing or a name.
   *
   * The service refuses an admin's changes to their own account with `400`,
   * which throws here rather than becoming an outcome: the page does not offer
   * those controls on your own row, so reaching this is a bug on this side.
   */
  async patchAccount(input: { id: number } & AccountPatch): Promise<AdminOutcome<AdminAccountView>> {
    const { id, ...patch } = input;
    return this.send({
      path: `${ADMIN_API_PREFIX}/accounts/${id}`,
      method: 'PATCH',
      body: patchBody(patch),
      parse: (body) => accountResponseSchema.parse(body).account,
    });
  }

  /** Deletes an account and its blob. Irreversible, which is why the page asks for the address to be typed. */
  async deleteAccount(input: { id: number }): Promise<AdminOutcome<void>> {
    return this.send({
      path: `${ADMIN_API_PREFIX}/accounts/${input.id}`,
      method: 'DELETE',
      parse: () => undefined,
    });
  }

  /**
   * Sends somebody a password-reset mail, or hands back the link when the
   * instance has no mail configured.
   *
   * This is the ONE path by which a person who has lost their password gets
   * their diary back, so an instance without mail must still produce the link
   * rather than silently do nothing.
   */
  async sendResetMail(input: { id: number }): Promise<AdminOutcome<Delivery>> {
    return this.send({
      path: `${ADMIN_API_PREFIX}/accounts/${input.id}/reset-mail`,
      method: 'POST',
      parse: (body) => deliverySchema.parse(body),
    });
  }

  /** Invites somebody. A `409` (the address already has an account) throws, and the form says so. */
  async createInvite(draft: InviteDraft): Promise<AdminOutcome<InviteCreated>> {
    return this.send({
      path: `${ADMIN_API_PREFIX}/invites`,
      method: 'POST',
      body: inviteBody(draft),
      parse: (body) => inviteCreatedSchema.parse(body),
    });
  }

  /** Every invitation the service knows about, in every state, across every page. The console shows the pending ones. */
  async listInvites(): Promise<AdminOutcome<{ invites: InviteView[]; total: number }>> {
    const outcome = await this.collectPages({
      path: `${ADMIN_API_PREFIX}/invites`,
      readPage: (body) => {
        const page = inviteListSchema.parse(body);
        return { items: page.invites, total: page.total };
      },
    });
    if (outcome.status === 'forbidden') return outcome;
    return { status: 'ok', value: { invites: outcome.value.items, total: outcome.value.total } };
  }

  /** Withdraws an invitation. The link in the mail stops working; a redeemed invite `404`s and throws. */
  async revokeInvite(input: { id: number }): Promise<AdminOutcome<void>> {
    return this.send({
      path: `${ADMIN_API_PREFIX}/invites/${input.id}`,
      method: 'DELETE',
      parse: () => undefined,
    });
  }

  /**
   * Sends the invitation again, with a NEW link.
   *
   * The old one stops working, which is the point rather than a side effect:
   * the previous link went to a mailbox that did not receive it, or to one
   * that should not keep a working capability.
   */
  async resendInvite(input: { id: number }): Promise<AdminOutcome<InviteCreated>> {
    return this.send({
      path: `${ADMIN_API_PREFIX}/invites/${input.id}/resend`,
      method: 'POST',
      parse: (body) => inviteCreatedSchema.parse(body),
    });
  }

  /**
   * Every reported estimate, newest first, however many pages that takes.
   *
   * PAGED INSIDE THIS CLIENT, exactly like {@link listAccounts}, and for the
   * same reason: the service caps `limit` and a caller that has to know the
   * ceiling gets it wrong the next time it moves. The queue is bounded by the
   * retention window rather than by the age of the instance, so there is no
   * screen here that needs paging controls of its own.
   */
  async listFeedbackReports(): Promise<AdminOutcome<{ reports: AdminFeedbackReport[]; total: number }>> {
    const outcome = await this.collectPages({
      path: `${ADMIN_API_PREFIX}${ADMIN_FEEDBACK_PATH}`,
      readPage: (body) => {
        const page = feedbackListSchema.parse(body);
        return { items: page.reports, total: page.total };
      },
    });
    if (outcome.status === 'forbidden') return outcome;
    return { status: 'ok', value: { reports: outcome.value.items, total: outcome.value.total } };
  }

  /**
   * One report, with the figures the list deliberately withholds.
   *
   * A `404` THROWS, like every other read of one thing by id: it is a row the
   * queue showed a moment ago, and a screen that rendered "nothing here" would
   * hide a report that is still on the instance.
   */
  async getFeedbackReport(input: { id: number }): Promise<AdminOutcome<AdminFeedbackReportDetail>> {
    return this.send({
      path: `${ADMIN_API_PREFIX}${ADMIN_FEEDBACK_PATH}/${input.id}`,
      method: 'GET',
      parse: (body) => feedbackReportResponseSchema.parse(body).report,
    });
  }

  /**
   * The photograph, as bytes, over the administrator's own credential.
   *
   * NEVER A URL A BROWSER FETCHES BY ITSELF. The credential is a bearer token
   * and the only ways to put one on an `<img>` request are a query string or a
   * cookie, so the bytes are read here and the screen holds an object URL it
   * created and revokes.
   *
   * A `404` IS `gone`, NOT AN ERROR, and the service says why
   * (`admin-feedback-routes.ts:224-229`): a report that never had an image and
   * one whose image has already been deleted get the same answer, and both are
   * things this screen has to draw rather than fail on.
   */
  async feedbackImage(input: { id: number }): Promise<FeedbackImageOutcome> {
    try {
      const image = await this.transport.requestBytesAsAccount({
        path: `${ADMIN_API_PREFIX}${ADMIN_FEEDBACK_PATH}/${input.id}/image`,
      });
      return { status: 'ok', image };
    } catch (error) {
      if (!isSyncRequestError(error)) throw error;
      if (error.kind === 'forbidden' || error.kind === 'suspended') return { status: 'forbidden' };
      if (error.kind === 'not-found') return { status: 'gone' };
      throw error;
    }
  }

  /**
   * Deletes one report now, rather than when its window runs out. The service
   * deletes the image through its own store before it drops the row.
   *
   * A `404` RESOLVES rather than throws. "There is no such report" is the
   * outcome this call asked for, and a second tab or a retention sweep getting
   * there first is ordinary rather than a failure to report.
   */
  async deleteFeedbackReport(input: { id: number }): Promise<AdminOutcome<void>> {
    try {
      return await this.send({
        path: `${ADMIN_API_PREFIX}${ADMIN_FEEDBACK_PATH}/${input.id}`,
        method: 'DELETE',
        parse: () => undefined,
      });
    } catch (error) {
      if (isSyncRequestError(error) && error.kind === 'not-found') return { status: 'ok', value: undefined };
      throw error;
    }
  }

  /** The four counts across the top of the page, unwrapped from the `{"stats": …}` envelope. */
  async stats(): Promise<AdminOutcome<AdminStats>> {
    return this.send({
      path: `${ADMIN_API_PREFIX}/stats`,
      method: 'GET',
      parse: (body) => adminStatsResponseSchema.parse(body).stats,
    });
  }

  /**
   * Follows `offset` until the whole list is in hand.
   *
   * THE LOOP IS BOUNDED THREE WAYS, and each bound is a real failure rather
   * than defensive noise: `total` is the service's own answer, an empty page
   * stops it (a service that reports a total it will not serve would otherwise
   * spin for ever), and {@link MAX_ADMIN_PAGES} is the ceiling for a `total`
   * that grows faster than the pages are read. Any of the three ends it.
   *
   * A `forbidden` on page two ends the whole read: being demoted between two
   * requests is the case, and half a list is worse than none.
   */
  private async collectPages<T>(input: {
    path: string;
    /** Anything the endpoint takes beyond the paging pair, in front of it in the query string. */
    params?: readonly AdminQueryParam[];
    readPage: (body: JsonValue) => { items: T[]; total: number };
  }): Promise<AdminOutcome<{ items: T[]; total: number }>> {
    const items: T[] = [];
    let total = 0;
    for (let page = 0; page < MAX_ADMIN_PAGES; page += 1) {
      const offset = page * ADMIN_PAGE_SIZE;
      const outcome = await this.send({
        path: `${input.path}${query([
          ...(input.params ?? []),
          { name: 'limit', value: ADMIN_PAGE_SIZE },
          { name: 'offset', value: offset },
        ])}`,
        method: 'GET',
        parse: input.readPage,
      });
      if (outcome.status === 'forbidden') return outcome;
      total = outcome.value.total;
      items.push(...outcome.value.items);
      if (outcome.value.items.length === 0) break;
      if (items.length >= total) break;
    }
    return { status: 'ok', value: { items, total } };
  }

  /**
   * One call: send it, turn a 403 into an outcome, parse everything else.
   *
   * The 403 catch is here rather than at ten call sites because the rule is
   * one rule. A method that forgot it would throw past the page's boundary and
   * blank the screen, and that failure is invisible until an admin is demoted.
   */
  private async send<T>(input: {
    path: string;
    method: AuthorizedMethod;
    body?: JsonValue;
    parse: (body: JsonValue) => T;
  }): Promise<AdminOutcome<T>> {
    try {
      const body = await this.transport.requestAsAccount({
        path: input.path,
        method: input.method,
        body: input.body,
      });
      return { status: 'ok', value: input.parse(body) };
    } catch (error) {
      if (isSyncRequestError(error) && (error.kind === 'forbidden' || error.kind === 'suspended')) {
        return { status: 'forbidden' };
      }
      // A SHAPE MISMATCH IS NEVER SILENT AGAIN. The only two things inside the
      // try are the request and the parse, so anything here that is not a
      // `SyncRequestError` came from zod — and a `{"stats": …}` envelope this
      // client did not expect cost an afternoon precisely because it looked
      // like three successful requests and an empty console.
      if (error instanceof z.ZodError) {
        log.error('an admin response did not match its schema', {
          path: input.path,
          issues: summarizeZodIssues(error),
        });
      }
      throw error;
    }
  }
}

/**
 * The service's own ceiling on `limit`, transcribed from `PROTOCOL.md` §5.20.
 *
 * Asking for more is a `400`, not a truncated page, which is why the console
 * showed an error card rather than a short list.
 */
const ADMIN_PAGE_SIZE = 200;

/**
 * The most pages one read will follow.
 *
 * 50 pages is 10,000 accounts, far past any instance this is for, and it is
 * the bound that keeps a service reporting an unreachable `total` from turning
 * a page load into an endless request loop.
 */
const MAX_ADMIN_PAGES = 50;

/** One numeric query parameter. Every parameter this API takes is a number, so nothing here needs escaping. */
interface AdminQueryParam {
  name: string;
  value: number;
}

/** The holder {@link AdminClient.listActivity} catches the window on. Named, because an inline one reads back as null. */
interface ActivityWindowHolder {
  window: AdminActivityWindow | null;
}

/** `?days=&limit=&offset=`, in the order given, or nothing at all when nothing was asked for. */
function query(params: readonly AdminQueryParam[]): string {
  if (params.length === 0) return '';
  return `?${params.map((param) => `${param.name}=${param.value}`).join('&')}`;
}

/**
 * A JSON body carrying only the fields the caller actually set.
 *
 * ABSENT AND NULL ARE DIFFERENT, and the difference is load-bearing:
 * `displayName: null` clears somebody's name, while an absent `displayName`
 * leaves it alone. A body built by spreading everything would clear a name on
 * every allowance change, and nothing about that failure looks like a bug
 * until somebody's name is gone.
 */
function definedFields(fields: AdminRequestFields): JsonValue {
  const body: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) body[key] = value;
  }
  return body;
}

/** The one shape {@link definedFields} accepts: named request fields, any of which the caller may have left unset. */
type AdminRequestFields = Readonly<Record<string, JsonValue | undefined>>;

/** The patch body. Every field is optional and the service applies exactly what it receives. */
function patchBody(patch: AccountPatch): JsonValue {
  return definedFields({
    role: patch.role,
    dailyAiLimit: patch.dailyAiLimit,
    suspended: patch.suspended,
    displayName: patch.displayName,
  });
}

/** The invite body. What the form left blank is left to the service's defaults: member, no allowance, 7 days. */
function inviteBody(draft: InviteDraft): JsonValue {
  return definedFields({
    email: draft.email,
    displayName: draft.displayName,
    role: draft.role,
    dailyAiLimit: draft.dailyAiLimit,
    expiresInDays: draft.expiresInDays,
  });
}

/**
 * A zod failure as one readable line.
 *
 * The PATHS and MESSAGES only. A zod error also carries the value it refused,
 * and an admin response holds email addresses; a log line is the wrong place
 * for them.
 */
function summarizeZodIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}
