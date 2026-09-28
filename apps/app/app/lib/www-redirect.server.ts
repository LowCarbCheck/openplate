/**
 * The Express shell around `#app/lib/www-redirect`'s pure
 * `resolveWwwRedirectLocation`. It lives here rather than in `server.ts`
 * because importing `server.ts` starts a listener, so nothing declared there
 * can be reached by a test — and a canonical-host rule that is subtly wrong
 * (a substring test instead of a label test, a dropped query string, a
 * redirected healthcheck) stays invisible until real traffic hits real
 * production. From this module the whole middleware, wiring included, is
 * exercised end to end by `tests/unit/www-redirect.test.ts` against a real
 * Express app.
 *
 * Read `#app/lib/www-redirect` for WHY the target is derived from the
 * request's own host rather than from a configured canonical name.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { resolveWwwRedirectLocation } from '#app/lib/www-redirect';

/**
 * Sends a permanent redirect from a `www.` host to the same URL without it.
 *
 * `req.hostname` and `req.protocol` are deliberate: both consult the
 * `X-Forwarded-Host` / `X-Forwarded-Proto` headers Traefik sets, gated on the
 * app's `trust proxy` setting, so behind the proxy they describe THE ORIGIN
 * THE BROWSER ASKED FOR. The socket-level alternatives — `req.headers.host`
 * and `req.socket.encrypted` — describe the internal hop instead, and would
 * emit a `Location` pointing at the container's own address over plain
 * `http`. Note that Express 4's `req.hostname` strips the port; that is what
 * we want behind a proxy, where the public port is implicit and the internal
 * one must never leak into a `Location` header. It is also undefined when a
 * request arrives with no `Host` header at all, which is not a `www.` host
 * and so must simply pass through.
 *
 * 301 rather than 302 because this is a permanent statement about the two
 * spellings of the name, and we want it cached and consolidated by crawlers.
 * It applies to every method: a `www.` origin should never have been the
 * target of a form post either, since the page that posted it was itself
 * redirected to the apex before it rendered.
 */
export function createWwwRedirectMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const location = resolveWwwRedirectLocation({
      host: req.hostname ?? '',
      protocol: req.protocol,
      url: req.originalUrl,
    });
    if (location === null) {
      next();
      return;
    }
    res.redirect(301, location);
  };
}
