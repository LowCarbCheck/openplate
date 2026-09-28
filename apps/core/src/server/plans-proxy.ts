/**
 * The plans pass-through: `/v1/plans/*` forwarded to one configured upstream,
 * with a trusted account id and a shared secret the caller cannot write.
 *
 * WHY A PASS-THROUGH AND NOT A LINK TO THE BILLER. An outbound link cannot
 * bind a payment to an account without either forging or an oracle: an
 * `accountId` in a URL is craftable by anybody, and a biller that then read
 * that account's address to prefill a checkout would be an
 * address-disclosure oracle. Mounting the subtree here, behind the bearer
 * middleware this service already has, removes the problem instead of
 * guarding it. The gateway holds the session, the biller holds the money, and
 * the join between them is a header the browser cannot write.
 *
 * FOUR HEADERS GO OUT AND NOTHING ELSE GOES WITH THEM.
 * `X-Account-Id` comes from the resolved session, `X-Account-Email` from the
 * account row read here, `X-Plans-Secret` from `PLANS_UPSTREAM_SECRET`, and
 * `Content-Type` is the only thing copied off the inbound request. The
 * headers are BUILT rather than copied and overwritten, which is the rule
 * `ai/proxy.ts` states and the reason a client that sends its own
 * `X-Account-Id` cannot influence what the upstream reads.
 *
 * THE CALLER'S OWN ACCESS TOKEN IS NEVER FORWARDED. That single rule is what
 * stops the biller from becoming a second place a stolen token works, and it
 * is why the forwarded set is a whitelist rather than a blacklist: a header
 * nobody thought about is dropped by default.
 *
 * NO UNSCOPED BODY PARSER, ANYWHERE NEAR THIS ROUTER. The first parser
 * registered in a Router applies to every later route in the app, and a 64 KB
 * limit once capped every route in this service invisibly. The parser below
 * is declared ON the one route that needs it, exactly as
 * `server/admin-routes.ts` declares its own.
 *
 * AN EXPLICIT `AbortSignal.timeout`, because Node's `fetch` otherwise waits
 * five minutes (undici caps a non-streaming call at 300 s and names no knob
 * when it fires), and a person staring at a checkout button will not.
 *
 * ONE ROUTE IS ANONYMOUS, AND IT IS ONE PATH AND ONE METHOD: `GET
 * /v1/plans/prices`. A sign-up screen has to state the price before anybody
 * has an account, so nothing that needs a token can tell it. It is mounted
 * AHEAD of the bearer middleware and it is the only thing that is; every other
 * path and every other method in the subtree still meets `requireAuth` first.
 * It goes out with ONE header, `X-Plans-Secret`, and never with the two
 * account headers, because there is no account: a token the caller sent is
 * not read, not resolved and not forwarded. The biller's answer is kept here
 * for {@link PLANS_PRICES_CACHE_TTL_MS}, so a burst of readers is one call to
 * the biller, and each source address is held to
 * {@link PLANS_PRICES_RATE_LIMIT_PER_MINUTE} requests a minute.
 */
import express from 'express';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { PLANS_API_PREFIX } from '../protocol.js';
import type { AccountStore } from '../accounts/account-store.js';
import type { Logger } from '../logger.js';
import { asString } from '../lib/json.js';
import { createIpRateLimit } from '../lib/ip-rate-limit.js';
import { getRequestSession } from './bearer-auth.js';
import { handleNotFound } from './error-middleware.js';

/**
 * How long this service waits for the biller, in milliseconds.
 *
 * IT GUARDS AGAINST UNDICI'S HIDDEN 300 SECOND CAP as much as against a slow
 * biller. Node's global `fetch` applies a 300 s headers timeout that an
 * `AbortSignal` can only TIGHTEN, so without this constant a hung upstream is
 * five minutes of a spinner and then an error naming no knob.
 *
 * TEN SECONDS BECAUSE A PERSON IS WAITING. Every route behind this prefix is
 * a button somebody just pressed: a checkout, a portal link, a plan read.
 * There is nothing to stream and nothing to generate, so a biller that has
 * not answered in ten seconds is not going to answer usefully.
 */
export const PLANS_UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * The largest request body this subtree accepts, in bytes.
 *
 * SMALL ON PURPOSE, and unrelated to every other limit in this service. What
 * travels here is a plan identifier and a return URL. The AI and feedback
 * routes carry a photograph and are sized in megabytes; nothing on this path
 * ever should be, so the cap is the one that makes a mistake obvious rather
 * than expensive.
 */
export const PLANS_MAX_REQUEST_BYTES = 16 * 1024;

/**
 * The largest upstream answer this service relays, in bytes.
 *
 * The biller answers with a URL, a status and a date. A larger body is a
 * misconfigured upstream (an HTML error page, a proxy's own document), and
 * relaying it would put an unbounded stranger's document through this
 * service. Over the cap is a 502, the same answer a broken upstream gets.
 */
export const PLANS_MAX_RESPONSE_BYTES = 64 * 1024;

/** The methods this subtree forwards. Everything else is a 405 that never reaches the upstream. */
const FORWARDED_METHODS: ReadonlySet<string> = new Set(['GET', 'POST']);

/** The `Allow` header value for the 405, built from the one list above so the two cannot drift. */
const ALLOWED_METHODS_HEADER = [...FORWARDED_METHODS].join(', ');

/**
 * The machine codes this proxy answers with.
 *
 * CODES RATHER THAN SENTENCES, because a client branches on every one of
 * them: a 405 is a bug in the caller, an unreachable biller is a "try again"
 * screen, and a refused body is a request that must not be retried unchanged.
 * They travel in the `{"error": "..."}` envelope PROTOCOL.md §4 promises, so
 * nothing about the error shape on this service changes.
 */
export const PLANS_METHOD_NOT_ALLOWED = 'plans-method-not-allowed';
export const PLANS_REQUEST_TOO_LARGE = 'plans-request-too-large';
export const PLANS_UPSTREAM_UNREACHABLE = 'plans-upstream-unreachable';
export const PLANS_UPSTREAM_TIMEOUT = 'plans-upstream-timeout';
export const PLANS_UPSTREAM_INVALID = 'plans-upstream-invalid';

/**
 * The one anonymous path, relative to {@link PLANS_API_PREFIX}. The biller
 * serves the same suffix under its own base, so `GET /v1/plans/prices` is
 * `GET <PLANS_UPSTREAM_URL>/prices` there.
 */
export const PLANS_PRICES_PATH = '/prices';

/**
 * How long a price list from the biller is kept here, in milliseconds.
 *
 * FIVE MINUTES, and the same five minutes a browser is told it may keep the
 * answer ({@link PLANS_PRICES_CACHE_CONTROL} is built from this number, so the
 * two cannot drift). A price changes when somebody edits it at the payment
 * provider and restarts the biller, which is rare; a sign-up screen is opened far more
 * often. Only a `200` is kept: a refusal or a broken biller is asked again on
 * the next request.
 */
export const PLANS_PRICES_CACHE_TTL_MS = 5 * 60 * 1000;

/** The `Cache-Control` a `200` price list carries. Public: the answer is the same for everybody. */
export const PLANS_PRICES_CACHE_CONTROL = `public, max-age=${PLANS_PRICES_CACHE_TTL_MS / 1000}`;

/**
 * Price list reads one source address may make in any trailing minute.
 *
 * ONE A SECOND, which is generous on purpose. The read is anonymous, so many
 * people behind one mobile carrier's address share the bucket, and the answer
 * is served from memory, so a read costs this service almost nothing. The
 * bound is there to stop a loop or a script, not a person opening the screen
 * twice.
 */
export const PLANS_PRICES_RATE_LIMIT_PER_MINUTE = 60;

/** The `429` code of the price list, in the §4 envelope. Its own, so a client can tell it from any other limit. */
export const PLANS_PRICES_RATE_LIMITED = 'plans-prices-rate-limited';

/** What an operator configured, already validated both-or-neither by `config.ts`. */
export interface PlansUpstreamConfig {
  /** Absolute http(s) base URL of the biller's internal plans surface, with no trailing slash. */
  baseUrl: string;
  /** The shared secret the biller checks before it trusts the two account headers. Never logged, never forwarded back. */
  secret: string;
  /**
   * How long to wait, in milliseconds. Absent means
   * {@link PLANS_UPSTREAM_TIMEOUT_MS}, which is what every real instance uses:
   * `config.ts` never sets this and there is no environment variable for it.
   *
   * IT EXISTS FOR ONE CALLER, a test proving the bound is really applied. The
   * alternative is a suite that waits ten real seconds to watch a hang, which
   * is a test nobody runs. `mail/mailer.ts` carries the same option for the
   * same single reason.
   */
  timeoutMs?: number;
}

export interface PlansRouteOptions {
  upstream: PlansUpstreamConfig;
  /** The bearer middleware, injected so this module never reaches for a singleton. */
  requireAuth: RequestHandler;
  /**
   * Where `X-Account-Email` comes from. THE ROW, NEVER THE REQUEST: a client
   * that sends an address is sending somebody else's as easily as its own.
   */
  accounts: AccountStore;
  logger: Logger;
  /** The app's clock, which ages the cached price list and drives its rate limit. Injected so a test moves time instead of waiting. */
  now: () => Date;
}

/** `body-parser` marks its own failures with this `type`. */
const BODY_PARSER_TOO_LARGE = 'entity.too.large';

/** The one property this module reads off a `body-parser` failure. */
interface BodyParserError {
  readonly type?: string;
}

function bodyParserType(cause: unknown): string | null {
  // `Object()` boxes rather than narrows, so a non-object error simply has no
  // `type` and reads as `null`.
  const candidate: BodyParserError = Object(cause);
  return asString(candidate.type);
}

/**
 * The upstream URL for one inbound request, or `null` when the path escapes
 * the configured base.
 *
 * THE ESCAPE CHECK IS NOT THEATRE. Express does not normalize `..` out of a
 * URL, but `new URL` resolves it, so a naive concatenation would let
 * `/v1/plans/../../admin` reach a path on the biller this prefix was never
 * meant to open. A request that resolves outside the base is answered as the
 * unknown path it is.
 */
export function resolveUpstreamTarget(input: { baseUrl: string; suffix: string }): string | null {
  const base = `${input.baseUrl}/`;
  let resolved: URL;
  try {
    resolved = new URL(`${input.baseUrl}${input.suffix}`);
  } catch {
    return null;
  }
  const target = resolved.toString();
  return target === input.baseUrl || target.startsWith(base) ? target : null;
}

/**
 * What Node's global `fetch` resolves to, named rather than imported: this
 * module deliberately adds no dependency (see `mail/mailer.ts` on why global
 * `fetch` and not undici), and `Response` alone is Express's here.
 */
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

/**
 * Reads a response body under a byte cap, or `null` when it runs over.
 *
 * A COUNTING READER RATHER THAN `response.text()`, which has no cap at all: a
 * misconfigured upstream answering with a 40 MB document would otherwise be
 * buffered whole in this process before anybody looked at its size.
 */
async function readCappedBody(response: FetchResponse, maxBytes: number): Promise<string | null> {
  const body = response.body;
  if (body === null) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(step.value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** A parsed upstream answer, or the reason it is not one this service will relay. */
type UpstreamOutcome =
  { ok: true; status: number; contentType: string | null; body: string } | { ok: false; code: string };

/** `AbortSignal.timeout` rejects with this name; a dead host rejects with something else. */
const TIMEOUT_ERROR_NAME = 'TimeoutError';

async function callUpstream(input: {
  target: string;
  timeoutMs: number;
  method: string;
  headers: Headers;
  /**
   * `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`, because that is
   * what `fetch`'s `BodyInit` accepts: the default parameter is
   * `ArrayBufferLike`, which includes a `SharedArrayBuffer` and is refused.
   */
  body: Uint8Array<ArrayBuffer> | null;
}): Promise<UpstreamOutcome> {
  let response: FetchResponse;
  try {
    response = await fetch(input.target, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      // The whole point of the constant: see its doc comment on undici's cap.
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : '';
    return { ok: false, code: name === TIMEOUT_ERROR_NAME ? PLANS_UPSTREAM_TIMEOUT : PLANS_UPSTREAM_UNREACHABLE };
  }

  const body = await readCappedBody(response, PLANS_MAX_RESPONSE_BYTES).catch(() => null);
  if (body === null) return { ok: false, code: PLANS_UPSTREAM_INVALID };

  // THE ANSWER MUST BE JSON, whatever its status. A biller behind a proxy that
  // answers an HTML error page is a 502 here rather than an HTML document
  // relayed to a client that was promised an object.
  if (body !== '') {
    try {
      JSON.parse(body);
    } catch {
      return { ok: false, code: PLANS_UPSTREAM_INVALID };
    }
  }

  return { ok: true, status: response.status, contentType: response.headers.get('content-type'), body };
}

/**
 * The forwarding handler. Behind `requireAuth`, so a session is present in
 * every ordinary case, and the `null` branch is defence in depth rather than
 * a path a caller can reach.
 */
function createPlansForwarder(options: PlansRouteOptions): RequestHandler {
  const timeoutMs = options.upstream.timeoutMs ?? PLANS_UPSTREAM_TIMEOUT_MS;

  return function forwardToPlansUpstream(req: Request, res: Response, next: NextFunction): void {
    void (async () => {
      try {
        const session = getRequestSession(req);
        if (session === null) {
          // Unreachable behind the bearer gate. The same answer that gate
          // gives, so a mount that lost its middleware fails closed.
          res.status(401).json({ error: 'authentication required' });
          return;
        }

        // THE ADDRESS COMES FROM THE ROW. A missing row means the account was
        // erased between the token resolution and this read, and the caller is
        // then nobody this service can name to a biller.
        const account = await options.accounts.findAccountById(session.accountId);
        if (account === null) {
          res.status(401).json({ error: 'authentication required' });
          return;
        }

        const suffix = req.originalUrl.slice(PLANS_API_PREFIX.length);
        const target = resolveUpstreamTarget({ baseUrl: options.upstream.baseUrl, suffix });
        if (target === null) {
          handleNotFound(req, res);
          return;
        }

        // BUILT, NEVER COPIED. Nothing the caller sent reaches the upstream
        // except the content type of the body it sent with it.
        const headers = new Headers();
        headers.set('X-Account-Id', String(session.accountId));
        headers.set('X-Account-Email', account.email);
        headers.set('X-Plans-Secret', options.upstream.secret);
        const contentType = req.header('content-type');
        if (contentType !== undefined && contentType !== '') headers.set('Content-Type', contentType);

        // `express.raw` leaves an empty Buffer on a request with no body, and
        // `fetch` refuses a body on a GET, so both cases send none.
        const raw = Buffer.isBuffer(req.body) ? req.body : null;
        // Copied into a plain `Uint8Array` because `fetch` accepts one and a
        // Node `Buffer` is not in its `BodyInit` union. The cap above bounds
        // what is copied.
        const body = req.method === 'POST' && raw !== null && raw.byteLength > 0 ? new Uint8Array(raw) : null;

        const outcome = await callUpstream({ target, timeoutMs, method: req.method, headers, body });
        if (!outcome.ok) {
          // THE STATUS AND THE PATH, AND NOTHING ELSE. Not the body, which is
          // the upstream's document, and not the secret, which is in no field
          // here at all. The path is the mounted one, so it names the route
          // without carrying a query string.
          options.logger.warn('Plans upstream refused', { status: 502, path: `${PLANS_API_PREFIX}${req.path}` });
          res.status(502).json({ error: outcome.code });
          return;
        }

        // ONLY `Content-Type` COMES BACK. An upstream `Set-Cookie`, an
        // `Authorization` echo or a cache directive is the biller's business
        // with itself, and relaying one would make this service a channel for
        // a header nobody here reviewed.
        if (outcome.contentType !== null) res.setHeader('Content-Type', outcome.contentType);
        // `end` rather than `send`: `send` would stamp a `Content-Type` of its
        // own on an upstream answer that carried none, which is this service
        // inventing a claim about somebody else's document.
        res.status(outcome.status).end(outcome.body);
      } catch (cause) {
        next(cause);
      }
    })();
  };
}

/** A relayed answer the price list keeps: always a `200`, see {@link PLANS_PRICES_CACHE_TTL_MS}. */
interface CachedPrices {
  at: number;
  outcome: Extract<UpstreamOutcome, { ok: true }>;
}

/**
 * Reads the biller's price list, from memory when a `200` younger than
 * {@link PLANS_PRICES_CACHE_TTL_MS} is held.
 *
 * ONE LOAD IN FLIGHT IS SHARED, so readers who arrive together on a cold
 * entry are one call to the biller, not one each. The load is cleared on every
 * outcome, so a biller that failed once is asked again by the next reader.
 *
 * THE OUTBOUND HEADERS ARE BUILT FROM NOTHING, per call, and carry the secret
 * alone. There is no request to copy from here: the reader never sees one.
 */
function createPlansPricesReader(input: {
  upstream: PlansUpstreamConfig;
  timeoutMs: number;
  now: () => number;
}): () => Promise<UpstreamOutcome> {
  const resolved = resolveUpstreamTarget({ baseUrl: input.upstream.baseUrl, suffix: PLANS_PRICES_PATH });
  // Unreachable with a base `config.ts` accepted; a boot failure rather than a
  // price list that silently never loads.
  if (resolved === null) throw new Error('PLANS_UPSTREAM_URL cannot carry the price list path');
  const target: string = resolved;
  let cached: CachedPrices | null = null;
  let inFlight: Promise<UpstreamOutcome> | null = null;

  async function load(): Promise<UpstreamOutcome> {
    const headers = new Headers();
    headers.set('X-Plans-Secret', input.upstream.secret);
    const outcome = await callUpstream({ target, timeoutMs: input.timeoutMs, method: 'GET', headers, body: null });
    if (outcome.ok && outcome.status === 200) cached = { at: input.now(), outcome };
    return outcome;
  }

  return async function readPlansPrices(): Promise<UpstreamOutcome> {
    if (cached !== null && input.now() - cached.at < PLANS_PRICES_CACHE_TTL_MS) return cached.outcome;
    if (inFlight !== null) return inFlight;
    inFlight = load();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  };
}

/**
 * Lets only `GET` into the anonymous route. Express answers a `HEAD` with a
 * `GET` route, and a `HEAD` here would be a second anonymous method; it is
 * sent on to the authenticated subtree instead, which answers it exactly as it
 * answered before this route existed.
 */
function admitOnlyGet(req: Request, _res: Response, next: NextFunction): void {
  if (req.method !== 'GET') {
    next('route');
    return;
  }
  next();
}

/**
 * `GET /v1/plans/prices`: the biller's answer, its status and its JSON body,
 * with `Content-Type` and, on a `200`, {@link PLANS_PRICES_CACHE_CONTROL}. A
 * biller that cannot be read is the same `502` envelope the rest of the
 * subtree gives.
 */
function createPlansPricesHandler(options: { read: () => Promise<UpstreamOutcome>; logger: Logger }): RequestHandler {
  return function servePlansPrices(_req: Request, res: Response, next: NextFunction): void {
    void (async () => {
      try {
        const outcome = await options.read();
        if (!outcome.ok) {
          // The status and the path, as the forwarder logs a refusal.
          options.logger.warn('Plans upstream refused', {
            status: 502,
            path: `${PLANS_API_PREFIX}${PLANS_PRICES_PATH}`,
          });
          res.status(502).json({ error: outcome.code });
          return;
        }
        if (outcome.contentType !== null) res.setHeader('Content-Type', outcome.contentType);
        if (outcome.status === 200) res.setHeader('Cache-Control', PLANS_PRICES_CACHE_CONTROL);
        // `end`, not `send`, for the reason the forwarder gives.
        res.status(outcome.status).end(outcome.body);
      } catch (cause) {
        next(cause);
      }
    })();
  };
}

/** The 405 for every verb that is not forwarded. It never reaches the upstream, and it never reads a body. */
function refuseMethod(req: Request, res: Response, next: NextFunction): void {
  if (FORWARDED_METHODS.has(req.method)) {
    next();
    return;
  }
  res.setHeader('Allow', ALLOWED_METHODS_HEADER);
  res.status(405).json({ error: PLANS_METHOD_NOT_ALLOWED });
}

/**
 * This subtree's own body-parser failure handler.
 *
 * A REFUSED BODY IS A 413 AND NOT A 502, because the two mean opposite things
 * to a caller: a 502 says "the biller is having a bad day, try again" and
 * this says "what you sent will never be accepted". Anything that is not a
 * body-parser failure is passed along to the terminal handler.
 */
function handlePlansBodyError(cause: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(cause);
    return;
  }
  if (bodyParserType(cause) === BODY_PARSER_TOO_LARGE) {
    res.status(413).json({ error: PLANS_REQUEST_TOO_LARGE });
    return;
  }
  next(cause);
}

/**
 * Mounts the subtree. Called ONLY when an upstream is configured; the
 * unconfigured case is `app.use(PLANS_API_PREFIX, handleNotFound)` in
 * `create-app.ts`, mounted ahead of everything.
 */
export function registerPlansRoutes(app: Express, options: PlansRouteOptions): void {
  const router = express.Router();
  const forward = createPlansForwarder(options);
  const nowMs = (): number => options.now().getTime();
  const readPrices = createPlansPricesReader({
    upstream: options.upstream,
    timeoutMs: options.upstream.timeoutMs ?? PLANS_UPSTREAM_TIMEOUT_MS,
    now: nowMs,
  });

  // THE ORDER IS THE POLICY. The one anonymous route first, and it is one
  // path and one method: the price list a sign-up screen shows before anybody
  // has an account. Authentication next, so every other anonymous probe gets
  // the ordinary 401 the rest of the authenticated surface gives and learns
  // nothing about which verbs exist. The method refusal third, so a `DELETE`
  // is answered before any parser has read a byte of it. The parser last,
  // and only on the route that can carry a body.
  router.get(
    PLANS_PRICES_PATH,
    admitOnlyGet,
    createIpRateLimit({
      perMinute: PLANS_PRICES_RATE_LIMIT_PER_MINUTE,
      refusal: PLANS_PRICES_RATE_LIMITED,
      now: nowMs,
    }),
    createPlansPricesHandler({ read: readPrices, logger: options.logger }),
  );
  router.use(options.requireAuth);
  router.use(refuseMethod);
  router.get('/*', forward);
  router.post('/*', express.raw({ type: () => true, limit: PLANS_MAX_REQUEST_BYTES }), forward);
  // AFTER the routes, on the same router: Express only reaches a
  // four-argument handler once everything before it has passed an error along.
  router.use(handlePlansBodyError);

  app.use(PLANS_API_PREFIX, router);
}
