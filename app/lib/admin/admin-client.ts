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
  accountListSchema,
  accountResponseSchema,
  adminStatsSchema,
  deliverySchema,
  inviteCreatedSchema,
  inviteListSchema,
  type AccountRole,
  type AdminAccountView,
  type AdminStats,
  type Delivery,
  type InviteCreated,
  type InviteView,
} from './admin-wire';
import type { AuthorizedMethod } from '../sync/engine/client/auth-client';
import type { JsonValue } from '../sync/engine/protocol';
import { isSyncRequestError } from '../sync/engine/client/sync-error';

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
}

/**
 * The answer to an admin call: the thing, or the one refusal a page renders.
 *
 * `forbidden` covers `403` in all its forms, including the suspended-account
 * one, because they mean the same thing to this page: you may not administer
 * this instance right now.
 */
export type AdminOutcome<T> = { status: 'ok'; value: T } | { status: 'forbidden' };

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

  /** Everybody on this instance. Paged by the service; the page asks for one large page and shows what it gets. */
  async listAccounts(input: { limit?: number; offset?: number } = {}): Promise<
    AdminOutcome<{ accounts: AdminAccountView[]; total: number }>
  > {
    return this.send({
      path: `${ADMIN_API_PREFIX}/accounts${query(input)}`,
      method: 'GET',
      parse: (body) => accountListSchema.parse(body),
    });
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

  /** Every invitation the service knows about, in every state. The page shows the pending ones. */
  async listInvites(input: { limit?: number; offset?: number } = {}): Promise<
    AdminOutcome<{ invites: InviteView[]; total: number }>
  > {
    return this.send({
      path: `${ADMIN_API_PREFIX}/invites${query(input)}`,
      method: 'GET',
      parse: (body) => inviteListSchema.parse(body),
    });
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

  /** The four counts across the top of the page. */
  async stats(): Promise<AdminOutcome<AdminStats>> {
    return this.send({
      path: `${ADMIN_API_PREFIX}/stats`,
      method: 'GET',
      parse: (body) => adminStatsSchema.parse(body),
    });
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
      throw error;
    }
  }
}

/** `?limit=&offset=`, or nothing at all when neither was asked for. */
function query(input: { limit?: number; offset?: number }): string {
  const parts: string[] = [];
  if (input.limit !== undefined) parts.push(`limit=${input.limit}`);
  if (input.offset !== undefined) parts.push(`offset=${input.offset}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
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
