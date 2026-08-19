/**
 * CORS — wide open by design, and load-bearing rather than convenient.
 *
 * openplate's BYOK vision call is made FROM THE BROWSER: the photo is read on
 * the device and posted straight to the configured endpoint, with no server of
 * openplate's in the loop. So without these headers a browser client cannot
 * reach this service at all, and "openplate scans against it with zero client
 * changes" is false. An origin allowlist would mean every self-hoster editing
 * server config to use their own client build.
 *
 * What makes `*` safe is the absence of ambient credentials. This service issues
 * NO cookies and reads none; authentication is a bearer key the client attaches
 * deliberately. A hostile page can therefore issue a cross-origin request and
 * get a `401` — it has nothing to authenticate with, because the browser has
 * nothing to attach automatically. That is exactly the CSRF property cookies
 * lack.
 *
 * `Access-Control-Allow-Credentials` is deliberately NEVER sent: browsers reject
 * it alongside `*`, and it would signal an intent (cookie auth) this service must
 * not develop.
 *
 * `Retry-After` is exposed because the backpressure contract is worthless if the
 * one header telling a browser client when to retry is unreadable to it.
 *
 * Hand-rolled rather than the `cors` package: a dozen lines against a dependency
 * every self-hoster would have to trust.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = 'Authorization, Content-Type';
const EXPOSED_HEADERS = 'Retry-After';
/** 24h — the policy is static, so re-asking is pure latency. */
const PREFLIGHT_MAX_AGE_SECONDS = 86_400;

export function createCorsMiddleware(): RequestHandler {
  return function applyCors(req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
    res.setHeader('Access-Control-Max-Age', String(PREFLIGHT_MAX_AGE_SECONDS));

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}
