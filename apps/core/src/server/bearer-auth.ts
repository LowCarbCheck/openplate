/**
 * Bearer-token authentication middleware, and the bridge from this service's
 * accounts to the sync handler cores' `resolveEntitledUser` contract.
 *
 * NO COOKIES, ANYWHERE. The token travels in `Authorization: Bearer <token>`
 * so that any openplate client — ours, or a self-hoster's on a completely
 * different origin — can talk to any instance of this service. That is what
 * makes `Access-Control-Allow-Origin: *` safe here: with no ambient
 * credential attached to the request, a hostile page can issue a cross-origin
 * call but has nothing to authenticate it with, so CSRF has no purchase.
 *
 * The resolved session hangs off a `WeakMap` keyed by the request rather than
 * a mutated `req.session` property. Declaration-merging Express's `Request`
 * would make the field appear on EVERY request in the type system, including
 * unauthenticated ones, which is exactly the confusion this middleware
 * exists to prevent.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { parseBearerHeader } from '../lib/tokens.js';
import {
  ACCOUNT_SUSPENDED,
  resolveAccessToken,
  type AuthContext,
  type ResolvedSession,
} from '../accounts/auth-handlers.js';
import { HEALTH_CONSENT_REQUIRED, holdsHealthConsent } from '../accounts/health-consent.js';
import type { SyncEntitledUser } from '../contract-types.js';
import type { InstanceHealthConsent } from '../protocol.js';

const sessionsByRequest = new WeakMap<Request, ResolvedSession>();

/** The session attached by `createBearerAuthMiddleware`, or `null` on an unauthenticated request. */
export function getRequestSession(req: Request): ResolvedSession | null {
  return sessionsByRequest.get(req) ?? null;
}

/**
 * Rejects with `401` unless the request carries a live access token. Absent,
 * malformed, unknown, expired and revoked tokens are all the same `401` with
 * the same message — telling them apart tells an attacker which guesses were
 * close.
 *
 * A SUSPENDED ACCOUNT IS A `403`, NOT A `401`, and the distinction is the
 * whole reason `resolveAccessToken` returns three answers instead of two. A
 * `401` means "sign in again", and a client that got one for a suspension
 * would try, fail at the login door with a different status, and have learned
 * nothing it could show the person. `403 account-suspended` is the one answer
 * that lets a client say what happened.
 */
export function createBearerAuthMiddleware(ctx: AuthContext): RequestHandler {
  return function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const rawToken = parseBearerHeader(req.header('authorization') ?? undefined);
    if (rawToken === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    // Express 4 does not await a handler, so the async work is wrapped here
    // and every rejection is handed to `next` explicitly.
    void (async () => {
      try {
        const resolution = await resolveAccessToken(rawToken, ctx);
        if (resolution.status === 'suspended') {
          res.status(403).json({ error: ACCOUNT_SUSPENDED });
          return;
        }
        if (resolution.status !== 'valid') {
          res.status(401).json({ error: 'authentication required' });
          return;
        }
        sessionsByRequest.set(req, resolution.session);
        next();
      } catch (cause) {
        next(cause);
      }
    })();
  };
}

/**
 * Refuses with `403 health-consent-required` an account that does not hold
 * the instance's current health-data consent (`HEALTH_CONSENT_VERSION`), on
 * every route it is mounted on. Owner decision, 2026-09-29: "Whatever check
 * we need we should require." Before it, the consent was asked for where an
 * account is created and on the prompt route, and an account that never
 * agreed synced, scanned and subscribed exactly like one that had.
 *
 * MOUNTED BEHIND `createBearerAuthMiddleware`, NEVER IN FRONT OF IT. It reads
 * the version the bearer middleware already read off the account row
 * ({@link ResolvedSession.healthConsentVersion}), so it costs no query, and an
 * anonymous caller still gets the `401` that says "sign in" rather than a
 * `403` that says "agree". No session on the request is therefore a wiring
 * bug, and it fails CLOSED with that same `401`.
 *
 * A `403` AND NOT A `401`, for the reason the suspension is one: signing in
 * again will not help. The token is good, the person is who they say, and
 * the one thing missing is an act only they can perform, on the prompt route
 * (`POST /v1/auth/account/health-consent`), which this is never mounted on.
 *
 * `null` IS A PASS-THROUGH, and it is what every self-hosted instance runs:
 * an instance that asks for no consent answers exactly as it did before this
 * middleware existed.
 */
export function createHealthConsentMiddleware(policy: InstanceHealthConsent | null): RequestHandler {
  return function requireHealthConsent(req: Request, res: Response, next: NextFunction): void {
    const session = getRequestSession(req);
    if (session === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!holdsHealthConsent({ policy, consentedVersion: session.healthConsentVersion })) {
      res.status(403).json({ error: HEALTH_CONSENT_REQUIRED });
      return;
    }
    next();
  };
}

/**
 * The two reads under `SYNC_API_PREFIX` an account without the consent keeps,
 * as paths relative to that prefix: its own blob and its own key records.
 *
 * WHY THESE TWO STAY OPEN, and they are the only sync routes that do:
 *
 *  1. SIGNING IN NEEDS THEM before the app can show a consent screen. A new
 *     device reads the wrapped keys to open the diary, then pulls it, because
 *     the profile that says where the person belongs travels INSIDE the blob.
 *     Refused, an account that never agreed could not finish signing in on a
 *     new device, so it could never reach the screen that asks.
 *  2. TAKING THE DIARY OUT NEVER WAITS ON A CONSENT TO KEEPING IT. The app's
 *     export is built on the device from what the pull brought down, so on a
 *     new device the export IS the pull.
 *  3. NOTHING IS STORED. A read hands the account the ciphertext it already
 *     has here. Every write under the prefix, the blob push, a key-record
 *     write or delete, a DEK rotation, and every share and research route,
 *     stays refused.
 *
 * EXACT, AND FAIL-CLOSED. A method other than `GET`, a trailing slash or a
 * differently cased path is refused, never let through: a spelling this list
 * did not name is a spelling the app never sends.
 */
const OWN_COPY_READ_PATHS: ReadonlySet<string> = new Set(['/blob', '/key-records']);

/**
 * `requireHealthConsent` for the sync prefix: the same refusal, with the two
 * reads of {@link OWN_COPY_READ_PATHS} let through. Mounted as
 * `app.use(SYNC_API_PREFIX, requireAuth, ...)`, where `req.path` is relative to
 * the prefix.
 */
export function exceptOwnCopyReads(requireConsent: RequestHandler): RequestHandler {
  return function requireHealthConsentExceptOwnCopy(req: Request, res: Response, next: NextFunction): void {
    if (req.method === 'GET' && OWN_COPY_READ_PATHS.has(req.path)) {
      next();
      return;
    }
    requireConsent(req, res, next);
  };
}

/**
 * The `SyncHostContext.resolveEntitledUser` implementation for the standalone
 * service.
 *
 * It reads the session the middleware already attached rather than
 * re-resolving the token — the sync routes are mounted BEHIND
 * `createBearerAuthMiddleware`, so an unauthenticated caller never reaches
 * them and gets a `401` instead of the `403` this function's `null` would
 * produce. The `null` branch stays because the handler cores' contract
 * demands it, and because a future entitlement rule (a paid tier, a
 * per-account quota) is exactly what it is for.
 *
 * AN EXPIRED AI ALLOWANCE IS NOT SUCH A RULE, and M212 spec 01 decided that
 * deliberately rather than by omission. `accounts.allowance_expires_at` gates
 * the AI proxy and nothing else. Returning `null` here for a lapsed allowance
 * would answer `403 sync not enabled for this account` on every sync route,
 * and the diary belongs to the account: a person whose trial ended must still
 * be able to sign in on a new device and pull what they wrote. An expired
 * allowance is a feature ending, not an account ending. Deletion is the
 * erasure path and it already exists; suspension is the reversible lockout and
 * it already exists too. Do not add the expiry to this function.
 */
export function createEntitledUserResolver(): (req: Request) => Promise<SyncEntitledUser | null> {
  return async (req: Request): Promise<SyncEntitledUser | null> => {
    const session = getRequestSession(req);
    return session === null ? null : { userId: session.accountId };
  };
}
