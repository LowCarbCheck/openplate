/**
 * Express glue for the `/v1/auth/*` endpoints — mapping only. Every decision
 * lives in `auth-handlers.ts`; this file turns a typed `AuthOutcome` into a
 * status code and wires the per-IP throttle, which is the one concern that
 * genuinely needs the request object (`req.ip`, folded by
 * `lib/client-address.ts`).
 *
 * The JSON body parser is applied to the `/v1/auth` PREFIX only, with a small
 * limit. Other routers mount their own, far larger ones
 * (`server/register-routes.ts`, `ai/register-ai-route.ts`) — a multi-megabyte
 * body limit has no business anywhere near a login endpoint.
 *
 * THE PREFIX ON THAT `use` IS LOAD-BEARING, and its absence was a live defect
 * until M192/03. This router is mounted with `app.use(router)` — at the ROOT,
 * with no path — so a `router.use(parser)` with no path of its own ran the
 * 64 KB parser on EVERY request to EVERY path in the service, before routing.
 * A JSON parser marks a request as parsed, so the second parser on the
 * blob, share, research and AI routers found the work already done and their
 * own declared limits were unreachable. The observable effect: a blob push
 * over 64 KB answered `413` even though `MAX_BLOB_BYTES` is 2 MiB, and every
 * plate photograph posted to `/v1/chat/completions` did too. Nothing caught
 * it because no test in either tier ever sent a body larger than a sentence.
 *
 * THE ADDRESS IN EVERY KEY BELOW IS FOLDED (`lib/client-address.ts`): an IPv6
 * caller is its /64, an IPv4-mapped address is its IPv4 address, an IPv4
 * address is itself. One home connection holds 2^64 IPv6 addresses, so a key
 * on the raw `req.ip` gave anybody with IPv6 a fresh allowance per address.
 *
 * THROTTLE POLICY, per route and deliberately different:
 *  - **login**: two buckets, both counting failures only and both cleared on
 *    success. One keyed by IP **and** email, which slows a single-source
 *    brute force without letting anyone lock a victim out of their own account
 *    from a different IP. One keyed by the email ALONE, in its own store on
 *    {@link LOGIN_ACCOUNT_THROTTLE}, which bounds a guesser who rotates
 *    addresses: twenty failures, then a lock of one to fifteen minutes. An
 *    address with no account is counted the same way, and the refusal is the
 *    same `429` either bucket gives, so it says nothing about who has one.
 *  - **recover** and **recover-rotate** — keyed by IP **and** email, exactly
 *    like login and for the same reason, but they matter more: both accept a
 *    guess at the ONE authenticator left to a user who has lost their
 *    passphrase, and a success on either hands over the account. Neither is
 *    cleared on success — a legitimate recovery happens once, so there is no
 *    honest client that needs its allowance back.
 *  - **reset/request** — keyed by IP **and** email, never cleared, for the
 *    same reason. It does not accept a guess at anything, but it is the one
 *    endpoint whose two branches do measurably different work (one INSERT and
 *    one mail send on the known branch), and a residual timing signal that
 *    small only emerges from many samples per address. It is also what a
 *    caller would use to fill somebody's mailbox.
 *  - **signup**, **kdf**, **invite-lookup**, **invites** and **reset/open**,
 *    keyed by IP ALONE, and every attempt counts, successful or not. These are
 *    volume controls (account-farming, bulk address probing, token guessing),
 *    not credential guards, and keying them by a submitted value would let an
 *    attacker evade them by simply rotating it — which is precisely the
 *    attack, in the `kdf` case. The member mint is on this list even though it
 *    is authenticated: VOLUME is the attack there too, because every accepted
 *    call sends a letter to an address the caller chose, and a bucket keyed by
 *    that address would hand out a fresh allowance per mailbox.
 *
 * `kdf` is throttled for two reasons that are easy to miss because its
 * RESPONSE already gives nothing away (unknown addresses get a real-shaped
 * dummy). First, it is an unauthenticated endpoint that hits the database on
 * every call, so without a bound it is free amplification. Second, the
 * indistinguishability is statistical, not absolute: `handleGetKdfDescriptor`
 * equalises the work both branches do, but no server-side measure makes two
 * paths bit-identical in wall-clock terms, and a timing signal that small only
 * emerges from many samples per address. Denying the samples is what closes
 * the gap. Its traffic is genuinely low — a client fetches a descriptor on a
 * fresh login, and refresh tokens last 30 days — so the shared allowance is
 * not a burden on a household behind one NAT.
 */
import express from 'express';
import type { Express, Request, RequestHandler, Response } from 'express';
import type { AuthContext, AuthOutcome } from './auth-handlers.js';
import {
  handleChangePassphrase,
  handleDeleteAccount,
  handleGetAccount,
  handleGetKdfDescriptor,
  handleInviteLookup,
  handleLogin,
  handleLogout,
  handleMintMemberInvite,
  handleRecordHealthConsent,
  handleRecover,
  handleRecoverRotate,
  handleRefresh,
  handleResetOpen,
  handleResetRequest,
  handleSignup,
  handleSignupRequest,
  handleUpdateAccount,
} from './auth-handlers.js';
import { handleNotFound } from '../server/error-middleware.js';
import { getRequestSession } from '../server/bearer-auth.js';
import {
  createThrottleStore,
  identifierThrottleKey,
  LOGIN_ACCOUNT_THROTTLE,
  throttleKey,
  type ThrottleStore,
} from '../lib/throttle.js';
import { clientAddressKey } from '../lib/client-address.js';
import { SIGNUP_REQUEST_IP_THROTTLE } from './open-signup.js';
import { passphraseThrottleKey, sendThrottled } from './passphrase-gate.js';
import { asFields } from './auth-input.js';
import { asString } from '../lib/json.js';

/** Mount prefix for the account endpoints. The sync endpoints live beside it under `/v1/sync`. */
export const AUTH_API_PREFIX = '/v1/auth';

/** Auth bodies are small; only the blob endpoint has any business being large. */
const AUTH_JSON_BODY_LIMIT = 64 * 1024;

export interface AuthRoutesOptions {
  ctx: AuthContext;
  throttle: ThrottleStore;
  /** The bearer middleware — injected so this module never reaches for a singleton. */
  requireAuth: RequestHandler;
  /**
   * `requireHealthConsent` (`server/bearer-auth.ts`), mounted behind
   * `requireAuth` on the three routes here that use the account rather than
   * let it agree or leave: the account patch, the passphrase change and the
   * member mint. A pass-through on an instance that asks for no consent.
   *
   * REQUIRED, like `requireAuth`. A `?` would let a wiring change that forgot
   * it compile into three routes an account that never agreed still reaches.
   */
  requireConsent: RequestHandler;
  /**
   * The per-source bucket of `POST /v1/auth/signup-request` (M253), or absent
   * for a fresh one on {@link SIGNUP_REQUEST_IP_THROTTLE}.
   *
   * ITS OWN STORE, NOT {@link AuthRoutesOptions.throttle}. That store runs on
   * one config for every route (fifteen minutes of memory), and this door
   * counts per HOUR. A bucket's config is fixed by its store, so a second
   * bound needs a second store.
   */
  signupRequestThrottle?: ThrottleStore;
  /**
   * The login bucket per account, keyed on the submitted email alone, or
   * absent for a fresh one on {@link LOGIN_ACCOUNT_THROTTLE}.
   *
   * ITS OWN STORE, for the reason {@link AuthRoutesOptions.signupRequestThrottle}
   * gives: its ceiling is twenty failures, not the five of the shared store,
   * and a bucket's config is fixed by its store. Absent is the production
   * bound, so a wiring that forgets it still guards login.
   */
  loginAccountThrottle?: ThrottleStore;
}

/** Maps a handler outcome onto the wire. The only place status codes are chosen. */
function sendOutcome<T>(res: Response, outcome: AuthOutcome<T>): void {
  switch (outcome.status) {
    case 'ok':
      res.status(200).json(outcome.body);
      return;
    case 'created':
      res.status(201).json(outcome.body);
      return;
    case 'accepted':
      res.status(202).json(outcome.body);
      return;
    case 'no-content':
      res.status(204).end();
      return;
    case 'invalid':
      res.status(400).json({ error: outcome.reason });
      return;
    case 'unauthorized':
      res.status(401).json({ error: outcome.reason });
      return;
    case 'forbidden':
      res.status(403).json({ error: outcome.reason });
      return;
    case 'not-found':
      res.status(404).json({ error: outcome.reason });
      return;
    case 'conflict':
      res.status(409).json({ error: outcome.reason });
      return;
    case 'unavailable':
      res.status(503).json({ error: outcome.reason });
      return;
  }
}

/**
 * Books one passphrase-checking outcome against the account's bucket: a
 * refusal of the credential is a failure, a success clears the bucket, and
 * anything else (a malformed body) is neither.
 */
function recordPassphraseOutcome(input: { throttle: ThrottleStore; key: string; outcome: AuthOutcome<unknown> }): void {
  if (input.outcome.status === 'unauthorized') {
    input.throttle.recordFailure(input.key);
    return;
  }
  if (input.outcome.status === 'ok' || input.outcome.status === 'no-content') input.throttle.clear(input.key);
}

/**
 * Both recovery routes share ONE throttle bucket per (IP, email), on purpose:
 * they authenticate the same secret, so letting an attacker spend a fresh
 * allowance on each would halve the cost of guessing it.
 */
function recoveryThrottleKey(req: Request): string {
  return throttleKey({
    namespace: 'recover',
    ip: clientAddressKey(req),
    identifier: asString(asFields(req.body).email) ?? undefined,
  });
}

export function registerAuthRoutes(app: Express, options: AuthRoutesOptions): void {
  const { ctx, throttle, requireAuth, requireConsent } = options;
  const loginAccountThrottle = options.loginAccountThrottle ?? createThrottleStore(LOGIN_ACCOUNT_THROTTLE);
  const router = express.Router();
  // SCOPED TO THE PREFIX. See the module header: unscoped, this parser applies
  // to every path in the service and silently caps them all at 64 KB.
  router.use(AUTH_API_PREFIX, express.json({ limit: AUTH_JSON_BODY_LIMIT }));

  router.post(`${AUTH_API_PREFIX}/kdf`, async (req, res, next) => {
    try {
      const key = throttleKey({ namespace: 'kdf', ip: clientAddressKey(req) });
      const decision = throttle.check(key);
      if (decision.locked) {
        sendThrottled(res, decision.retryAfterMs);
        return;
      }
      // Counts every attempt. Keying this by the submitted address would be
      // worse than useless: probing many addresses is the attack, so a
      // per-address bucket would hand the attacker a fresh allowance for each
      // one he wants to test.
      throttle.recordFailure(key);
      sendOutcome(res, await handleGetKdfDescriptor({ email: asFields(req.body).email }, ctx));
    } catch (error) {
      next(error);
    }
  });

  router.post(`${AUTH_API_PREFIX}/invite-lookup`, async (req, res, next) => {
    try {
      // By IP alone, and every attempt counts. Guessing invite tokens is the
      // attack, so a bucket keyed by the submitted token would hand out a fresh
      // allowance for every guess.
      const key = throttleKey({ namespace: 'invite-lookup', ip: clientAddressKey(req) });
      const decision = throttle.check(key);
      if (decision.locked) {
        sendThrottled(res, decision.retryAfterMs);
        return;
      }
      throttle.recordFailure(key);
      sendOutcome(res, await handleInviteLookup(req.body, ctx));
    } catch (error) {
      next(error);
    }
  });

  router.post(`${AUTH_API_PREFIX}/signup`, async (req, res, next) => {
    try {
      const key = throttleKey({ namespace: 'signup', ip: clientAddressKey(req) });
      const decision = throttle.check(key);
      if (decision.locked) {
        sendThrottled(res, decision.retryAfterMs);
        return;
      }
      // Counts every attempt: this is a volume control, not a credential guard.
      throttle.recordFailure(key);
      sendOutcome(res, await handleSignup(req.body, ctx));
    } catch (error) {
      next(error);
    }
  });

  router.post(`${AUTH_API_PREFIX}/login`, async (req, res, next) => {
    try {
      const submittedEmail = asString(asFields(req.body).email);
      const addressKey = throttleKey({
        namespace: 'login',
        ip: clientAddressKey(req),
        identifier: submittedEmail ?? undefined,
      });
      // An absent or non-string email gets the empty identifier. Such a body
      // is a `400` before any credential check, so nothing is ever recorded
      // against that bucket; it only has to exist for the check below.
      const accountKey = identifierThrottleKey({ namespace: 'login', identifier: submittedEmail ?? '' });
      const addressDecision = throttle.check(addressKey);
      const accountDecision = loginAccountThrottle.check(accountKey);
      // ONE ANSWER FOR EITHER LOCK, the longer wait of the two. A distinct
      // body or status for the account bucket would tell a caller that the
      // account it names is being guessed at from elsewhere.
      if (addressDecision.locked || accountDecision.locked) {
        sendThrottled(res, Math.max(addressDecision.retryAfterMs, accountDecision.retryAfterMs));
        return;
      }

      const outcome = await handleLogin(req.body, ctx);
      if (outcome.status === 'unauthorized') {
        throttle.recordFailure(addressKey);
        loginAccountThrottle.recordFailure(accountKey);
      } else if (outcome.status === 'ok') {
        throttle.clear(addressKey);
        loginAccountThrottle.clear(accountKey);
      }
      sendOutcome(res, outcome);
    } catch (error) {
      next(error);
    }
  });

  router.post(`${AUTH_API_PREFIX}/recover`, async (req, res, next) => {
    try {
      const key = recoveryThrottleKey(req);
      const decision = throttle.check(key);
      if (decision.locked) {
        sendThrottled(res, decision.retryAfterMs);
        return;
      }

      const outcome = await handleRecover(req.body, ctx);
      // Counts every attempt, successful or not, and is never cleared. A
      // recovery is a once-in-an-account's-life event; a caller making a
      // second one within the window is far more likely to be guessing than
      // to be the owner.
      throttle.recordFailure(key);
      sendOutcome(res, outcome);
    } catch (error) {
      next(error);
    }
  });

  router.post(`${AUTH_API_PREFIX}/recover-rotate`, async (req, res, next) => {
    try {
      const key = recoveryThrottleKey(req);
      const decision = throttle.check(key);
      if (decision.locked) {
        sendThrottled(res, decision.retryAfterMs);
        return;
      }

      const outcome = await handleRecoverRotate(req.body, ctx);
      throttle.recordFailure(key);
      sendOutcome(res, outcome);
    } catch (error) {
      next(error);
    }
  });

  router.post(`${AUTH_API_PREFIX}/reset/request`, async (req, res, next) => {
    try {
      // Per (IP, email), and NEVER cleared. A person forgets their password
      // once; a caller measuring the difference between a known and an unknown
      // address, or filling somebody's mailbox, does it thousands of times.
      const key = throttleKey({
        namespace: 'reset-request',
        ip: clientAddressKey(req),
        identifier: asString(asFields(req.body).email) ?? undefined,
      });
      const decision = throttle.check(key);
      if (decision.locked) {
        sendThrottled(res, decision.retryAfterMs);
        return;
      }
      throttle.recordFailure(key);
      sendOutcome(res, await handleResetRequest(req.body, ctx));
    } catch (error) {
      next(error);
    }
  });

  router.post(`${AUTH_API_PREFIX}/reset/open`, async (req, res, next) => {
    try {
      // By IP alone: the submitted value IS the secret being guessed, so a
      // bucket keyed by it would reset on every guess.
      const key = throttleKey({ namespace: 'reset-open', ip: clientAddressKey(req) });
      const decision = throttle.check(key);
      if (decision.locked) {
        sendThrottled(res, decision.retryAfterMs);
        return;
      }
      throttle.recordFailure(key);
      sendOutcome(res, await handleResetOpen(req.body, ctx));
    } catch (error) {
      next(error);
    }
  });

  router.post(`${AUTH_API_PREFIX}/refresh`, async (req, res, next) => {
    try {
      sendOutcome(res, await handleRefresh(req.body, ctx));
    } catch (error) {
      next(error);
    }
  });

  router.post(`${AUTH_API_PREFIX}/logout`, requireAuth, async (req, res, next) => {
    try {
      const session = getRequestSession(req);
      if (session === null) {
        res.status(401).json({ error: 'authentication required' });
        return;
      }
      sendOutcome(res, await handleLogout(session, ctx));
    } catch (error) {
      next(error);
    }
  });

  // BEHIND THE CONSENT, and not only because it is not a way out. A passphrase
  // change is two writes in the app: this one, and the compartment's new wrap
  // on the blob, which the sync prefix refuses to an account without the
  // consent. Accepting this half alone would revoke every session and leave
  // the compartment on a passphrase nobody has any more, so the whole change
  // waits until the person has agreed.
  //
  // THROTTLED PER ACCOUNT, in the bucket rotate-dek and a key-record overwrite
  // spend from too (`passphrase-gate.ts`). The caller holds a token already,
  // and `currentAuthHash` is a guess at the passphrase that token cannot
  // prove; per IP, a stolen token would buy a fresh allowance per address.
  router.post(`${AUTH_API_PREFIX}/change-passphrase`, requireAuth, requireConsent, async (req, res, next) => {
    try {
      const session = getRequestSession(req);
      if (session === null) {
        res.status(401).json({ error: 'authentication required' });
        return;
      }
      const key = passphraseThrottleKey(session.accountId);
      const decision = throttle.check(key);
      if (decision.locked) {
        sendThrottled(res, decision.retryAfterMs);
        return;
      }
      const outcome = await handleChangePassphrase({ accountId: session.accountId, body: req.body }, ctx);
      recordPassphraseOutcome({ throttle, key, outcome });
      sendOutcome(res, outcome);
    } catch (error) {
      next(error);
    }
  });

  router.get(`${AUTH_API_PREFIX}/account`, requireAuth, async (req, res, next) => {
    try {
      const session = getRequestSession(req);
      if (session === null) {
        res.status(401).json({ error: 'authentication required' });
        return;
      }
      sendOutcome(res, await handleGetAccount({ accountId: session.accountId }, ctx));
    } catch (error) {
      next(error);
    }
  });

  // THE READ ABOVE IS OPEN, the patch is not. The app reads the account to
  // learn that it must ask, so `GET` is reachable by exactly the accounts the
  // consent refuses, and the patch is using the account, not agreeing or
  // leaving.
  router.patch(`${AUTH_API_PREFIX}/account`, requireAuth, requireConsent, async (req, res, next) => {
    try {
      const session = getRequestSession(req);
      if (session === null) {
        res.status(401).json({ error: 'authentication required' });
        return;
      }
      sendOutcome(res, await handleUpdateAccount({ accountId: session.accountId, body: req.body }, ctx));
    } catch (error) {
      next(error);
    }
  });

  // THE HEALTH-DATA CONSENT PROMPT, OR NOTHING THAT ADMITS TO BEING ONE.
  //
  // `HEALTH_CONSENT_VERSION` is unset on every instance whose operator asks
  // for no consent, which is the self-hosted default. The path then answers
  // the ordinary unknown-path 404, to everybody, signed in or not, with the
  // terminator in the same position the route would occupy, for the reason
  // the member mint below gives. Bearer when mounted, like `PATCH /account`,
  // and unthrottled like it: it writes one row the caller owns and sends
  // nothing anywhere. NEVER BEHIND `requireConsent`: it is the route an
  // account without the consent uses to agree, so gating it would lock that
  // account out of every data route for good.
  if (ctx.healthConsent != null) {
    router.post(`${AUTH_API_PREFIX}/account/health-consent`, requireAuth, async (req, res, next) => {
      try {
        const session = getRequestSession(req);
        if (session === null) {
          res.status(401).json({ error: 'authentication required' });
          return;
        }
        sendOutcome(res, await handleRecordHealthConsent({ accountId: session.accountId, body: req.body }, ctx));
      } catch (error) {
        next(error);
      }
    });
  } else {
    router.use(`${AUTH_API_PREFIX}/account/health-consent`, handleNotFound);
  }

  // THE MEMBER MINT, OR NOTHING THAT ADMITS TO BEING ONE (M212).
  //
  // `MEMBER_INVITE_DAILY_AI_LIMIT` and `MEMBER_INVITE_ALLOWANCE_DAYS` are
  // unset on every deployment whose operator has not decided to let members
  // invite people. The member mint then answers the ordinary unknown-path
  // 404 on its path, to everybody, signed in or not, which is the same
  // bargain the admin, share, research, feedback and AI surfaces make, for the
  // same reason: this service auto-deploys on push, so the commit that adds a
  // route is the commit that puts it in production.
  //
  // The terminator sits in the SAME position the real route would occupy, so
  // it is reached before the fallthrough and cannot be turned into a 401 by
  // anything mounted later. It is mounted on the path rather than wrapped
  // around a registered-but-refusing handler, so a second verb added here
  // later is dark by default.
  if (ctx.memberInvites != null) {
    router.post(`${AUTH_API_PREFIX}/invites`, requireAuth, requireConsent, async (req, res, next) => {
      try {
        const session = getRequestSession(req);
        if (session === null) {
          res.status(401).json({ error: 'authentication required' });
          return;
        }
        // By IP alone, and every attempt counts, see the module header. It is
        // checked BEFORE the handler, so a caller who is already locked out
        // costs no database read and, more importantly, causes no letter.
        const key = throttleKey({ namespace: 'member-invite', ip: clientAddressKey(req) });
        const decision = throttle.check(key);
        if (decision.locked) {
          sendThrottled(res, decision.retryAfterMs);
          return;
        }
        throttle.recordFailure(key);
        sendOutcome(res, await handleMintMemberInvite({ accountId: session.accountId, body: req.body }, ctx));
      } catch (error) {
        next(error);
      }
    });
  } else {
    router.use(`${AUTH_API_PREFIX}/invites`, handleNotFound);
  }

  // THE OPEN SIGN-UP DOOR, OR NOTHING THAT ADMITS TO BEING ONE (M253).
  //
  // `OPEN_SIGNUP` is unset on every invite-only instance. The path then
  // answers the ordinary unknown-path 404, with the terminator in the same
  // position the route would occupy, for the reason the member mint above
  // gives. Unauthenticated when mounted, like `/signup` and `/invite-lookup`.
  if (ctx.openSignup != null) {
    const signupRequestThrottle = options.signupRequestThrottle ?? createThrottleStore(SIGNUP_REQUEST_IP_THROTTLE);
    router.post(`${AUTH_API_PREFIX}/signup-request`, async (req, res, next) => {
      try {
        // By IP alone, and every attempt counts, BEFORE the handler: a caller
        // who is locked out costs no captcha call, no database read and no
        // letter. Keying it by the submitted address would hand out a fresh
        // allowance per address, which is the attack.
        const key = throttleKey({ namespace: 'signup-request', ip: clientAddressKey(req) });
        const decision = signupRequestThrottle.check(key);
        if (decision.locked) {
          sendThrottled(res, decision.retryAfterMs);
          return;
        }
        signupRequestThrottle.recordFailure(key);
        sendOutcome(res, await handleSignupRequest(req.body, ctx));
      } catch (error) {
        next(error);
      }
    });
  } else {
    router.use(`${AUTH_API_PREFIX}/signup-request`, handleNotFound);
  }

  // Throttled per account in the passphrase bucket, for the reason
  // change-passphrase above gives: `authHash` here is a guess at the
  // passphrase from a caller who already holds a token.
  router.post(`${AUTH_API_PREFIX}/delete`, requireAuth, async (req, res, next) => {
    try {
      const session = getRequestSession(req);
      if (session === null) {
        res.status(401).json({ error: 'authentication required' });
        return;
      }
      const key = passphraseThrottleKey(session.accountId);
      const decision = throttle.check(key);
      if (decision.locked) {
        sendThrottled(res, decision.retryAfterMs);
        return;
      }
      const outcome = await handleDeleteAccount({ accountId: session.accountId, body: req.body }, ctx);
      recordPassphraseOutcome({ throttle, key, outcome });
      sendOutcome(res, outcome);
    } catch (error) {
      next(error);
    }
  });

  app.use(router);
}
