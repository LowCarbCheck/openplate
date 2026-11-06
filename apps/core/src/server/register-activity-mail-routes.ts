/**
 * The activity reminder routes: the unauthenticated unsubscribe link, and the
 * administrator's stats and test send.
 *
 * ── `GET /v1/mail/unsubscribe?token=...` ────────────────────────────────────
 * A small page in the account's reminder language with one button. IT CHANGES
 * NOTHING: mail providers and link scanners open every link in a mail, and a
 * GET that unsubscribed would turn reminders off for people who never clicked.
 *
 * ── `POST /v1/mail/unsubscribe?token=...` ───────────────────────────────────
 * Turns reminders off (`optOutOfActivityMail`) and answers a short "done" page.
 * The page's form posts here, and so does a mail client's one-click
 * unsubscribe (RFC 8058, body `List-Unsubscribe=One-Click`). The body is not
 * read: the token in the query string is the whole request.
 *
 * ONE PAGE FOR EVERY BAD LINK, `400`, on both verbs: a token this key did not
 * sign and a token for an account that is gone look the same, so the route is
 * no oracle about which accounts exist. The token is never logged, and
 * `req.path` in the error log has no query string.
 *
 * Both verbs sit behind the per-IP burst limit every unauthenticated route
 * here has (`lib/ip-rate-limit.ts`).
 *
 * ── THE ADMIN ROUTES ────────────────────────────────────────────────────────
 * `GET /v1/admin/activity-mail/stats` and `POST /v1/admin/activity-mail/test`,
 * mounted behind the admin door in `create-app.ts`. A test goes to the CALLING
 * administrator's own address and stamps nothing, at most
 * {@link TEST_SENDS_PER_HOUR} per administrator per hour.
 */
import express, { type Express, type Request, type Response, type Router } from 'express';
import { verifyUnsubscribeToken, signUnsubscribeToken } from '../activity-mail/unsubscribe-token.js';
import {
  renderUnsubscribeConfirmPage,
  renderUnsubscribeDonePage,
  renderUnsubscribeInvalidPage,
} from '../activity-mail/unsubscribe-page.js';
import { isActivityMailKind } from '../activity-mail/due-rules.js';
import { kindSettingsOf, type ActivityMailSettings } from '../activity-mail/settings.js';
import type { ActivityMailStore } from '../activity-mail/store.js';
import type { AccountRecord, AccountStore } from '../accounts/account-store.js';
import { createIpRateLimit } from '../lib/ip-rate-limit.js';
import { asObject, type JsonValue } from '../lib/json.js';
import { errorFields } from '../log-error.js';
import type { Logger } from '../logger.js';
import type { Mailer } from '../mail/mailer.js';
import { UNSUBSCRIBE_PATH } from '../mail/activity-mail-message.js';
import type { InstanceLanguage } from '../protocol.js';
import { getAdminPrincipal } from './admin-auth.js';
import { asyncHandler } from './async-handler.js';

/** Requests per IP per minute on the unsubscribe route. A person clicks once; a mail client posts once. */
export const UNSUBSCRIBE_RATE_LIMIT_PER_MINUTE = 30;

/** The `429` code of the unsubscribe route. */
export const UNSUBSCRIBE_RATE_LIMITED = 'unsubscribe-rate-limited';

/** Test sends per administrator per trailing hour. */
export const TEST_SENDS_PER_HOUR = 5;

const HOUR_MS = 60 * 60 * 1000;

export interface ActivityMailSurface {
  /** The activity reminder queries, for the stats. */
  store: ActivityMailStore;
  /** The key behind the unsubscribe token. */
  unsubscribeKey: string;
  /** `INSTANCE_LANGUAGE`: the page language for a bad link and for an account that named none. */
  defaultLanguage: InstanceLanguage;
  /** Requests per IP per minute on the unsubscribe route. Absent is {@link UNSUBSCRIBE_RATE_LIMIT_PER_MINUTE}. */
  rateLimitPerMinute?: number;
}

/** The query value, read from the original URL. Never logged. */
function tokenOf(req: Request): string | null {
  return new URL(req.originalUrl, 'http://placeholder.invalid').searchParams.get('token');
}

/** The headers every page sends: no cache, no referrer (the URL carries a token), no index, no script. */
function sendPage(input: { res: Response; status: number; html: string }): void {
  input.res
    .status(input.status)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    })
    .send(input.html);
}

/** The account a request's token names, or `null` for every kind of bad link. */
async function accountOfToken(input: {
  req: Request;
  surface: ActivityMailSurface;
  accounts: AccountStore;
}): Promise<{ account: AccountRecord; token: string } | null> {
  const token = tokenOf(input.req);
  if (token === null) return null;
  const accountId = verifyUnsubscribeToken({ key: input.surface.unsubscribeKey, token });
  if (accountId === null) return null;
  const account = await input.accounts.findAccountById(accountId);
  return account === null ? null : { account, token };
}

export function registerUnsubscribeRoutes(
  app: Express,
  options: { surface: ActivityMailSurface; accounts: AccountStore; logger: Logger; now: () => Date },
): void {
  const { surface, accounts } = options;
  const rateLimit = createIpRateLimit({
    perMinute: surface.rateLimitPerMinute ?? UNSUBSCRIBE_RATE_LIMIT_PER_MINUTE,
    refusal: UNSUBSCRIBE_RATE_LIMITED,
  });
  const invalidPage = (res: Response): void =>
    sendPage({ res, status: 400, html: renderUnsubscribeInvalidPage({ language: surface.defaultLanguage }) });

  app.get(
    UNSUBSCRIBE_PATH,
    rateLimit,
    asyncHandler(async (req, res) => {
      const found = await accountOfToken({ req, surface, accounts });
      if (found === null) {
        invalidPage(res);
        return;
      }
      const language = found.account.activityMail.language ?? surface.defaultLanguage;
      sendPage({ res, status: 200, html: renderUnsubscribeConfirmPage({ language, token: found.token }) });
    }),
  );

  app.post(
    UNSUBSCRIBE_PATH,
    rateLimit,
    asyncHandler(async (req, res) => {
      const found = await accountOfToken({ req, surface, accounts });
      if (found === null) {
        invalidPage(res);
        return;
      }
      await accounts.optOutOfActivityMail({ accountId: found.account.id, now: options.now() });
      // The id, never the token or the address.
      options.logger.info('Activity reminders turned off by link', { accountId: found.account.id });
      const language = found.account.activityMail.language ?? surface.defaultLanguage;
      sendPage({ res, status: 200, html: renderUnsubscribeDonePage({ language }) });
    }),
  );
}

/** Whether one more test send fits in an administrator's trailing hour, and books it when it does. */
interface TestSendLimit {
  tryTake(accountId: number): boolean;
}

/** A sliding hour of test sends per administrator, in memory, like every other limiter here. */
function createTestSendLimit(input: { now: () => Date }): TestSendLimit {
  const sends = new Map<number, number[]>();
  return {
    tryTake(accountId: number): boolean {
      const nowMs = input.now().getTime();
      const recent = (sends.get(accountId) ?? []).filter((at) => at > nowMs - HOUR_MS);
      if (recent.length >= TEST_SENDS_PER_HOUR) {
        sends.set(accountId, recent);
        return false;
      }
      sends.set(accountId, [...recent, nowMs]);
      return true;
    },
  };
}

export interface AdminActivityMailRoutesOptions {
  surface: ActivityMailSurface | null;
  accounts: AccountStore;
  mailer: Mailer;
  /** Whether a real mailer exists. The no-op one resolves, so a test send through it would report a letter that never left. */
  mailConfigured: boolean;
  /** The process-local settings, for the days a test letter states. `null` when the build wires none. */
  settings: (() => ActivityMailSettings) | null;
  now: () => Date;
  logger: Logger;
}

/** `GET /activity-mail/stats` and `POST /activity-mail/test`, relative to the admin prefix. */
export function createAdminActivityMailRoutes(options: AdminActivityMailRoutesOptions): Router {
  const router = express.Router();
  const { surface } = options;
  // Without a surface the two paths fall through to the ordinary 404.
  if (surface === null) return router;
  const testSends = createTestSendLimit({ now: options.now });

  router.get(
    '/activity-mail/stats',
    asyncHandler(async (_req, res) => {
      res.status(200).json(await surface.store.stats());
    }),
  );

  router.post(
    '/activity-mail/test',
    express.json({ limit: 1024 }),
    asyncHandler(async (req, res) => {
      // SAFETY: `express.json()` above has already parsed this body, so it is
      // JSON-shaped by construction; `asObject` re-establishes that at the type
      // level and yields `null` for anything that is not an object.
      const kind = (asObject(req.body as JsonValue) ?? {}).kind;
      if (!isActivityMailKind(kind)) {
        res.status(400).json({ error: "kind must be 'first-scan' or 'quiet'" });
        return;
      }
      const principal = getAdminPrincipal(req);
      if (principal?.kind !== 'account') {
        res
          .status(400)
          .json({ error: 'a test mail goes to the calling administrator, and this credential has no address' });
        return;
      }
      if (!options.mailConfigured || options.settings === null) {
        res.status(409).json({ error: 'mail is not configured on this instance' });
        return;
      }
      const account = await options.accounts.findAccountById(principal.accountId);
      if (account === null) {
        res.status(401).json({ error: 'account no longer exists' });
        return;
      }
      if (!testSends.tryTake(account.id)) {
        res.set('Retry-After', String(HOUR_MS / 1000));
        res.status(429).json({ error: 'activity-mail-test-limit' });
        return;
      }
      try {
        await options.mailer.sendActivityReminder({
          email: account.email,
          kind,
          days: kindSettingsOf({ settings: options.settings(), kind }).days,
          language: account.activityMail.language ?? surface.defaultLanguage,
          unsubscribeToken: signUnsubscribeToken({ key: surface.unsubscribeKey, accountId: account.id }),
          isTest: true,
        });
      } catch (cause) {
        options.logger.warn('Activity reminder test send failed', {
          accountId: account.id,
          kind,
          ...errorFields(cause),
        });
        res.status(502).json({ error: 'the mail service refused the test mail' });
        return;
      }
      res.status(202).json({ kind });
    }),
  );

  return router;
}
