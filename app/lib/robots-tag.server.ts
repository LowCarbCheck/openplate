/**
 * The Express shell around `#app/lib/robots-tag`'s pure `robotsTagHeader`.
 *
 * It lives here rather than in `server.ts` for the same reason
 * `www-redirect.server.ts` does: importing `server.ts` starts a listener, so
 * nothing declared there can be reached by a test, and a header that is
 * missing from some responses is invisible until a search engine has already
 * indexed the pages it was meant to hide. From this module the whole
 * middleware, wiring included, is exercised by `tests/unit/robots-tag.test.ts`
 * against a real Express app.
 *
 * Read `#app/lib/robots-tag` for WHY the app is not indexed at all.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { robotsTagHeader } from '#app/lib/robots-tag';

/**
 * Sets the indexing header on every response, then hands the request on.
 *
 * Mounted above everything that serves content, so the header is on the HTML,
 * on the static files, on the canonical-host redirect and on every error
 * response alike. There is no exemption list on purpose: unlike the
 * canonical-host redirect, a header cannot break a health probe, since it
 * changes no status code and no body.
 */
export function createRobotsTagMiddleware(): RequestHandler {
  const { name, value } = robotsTagHeader();
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(name, value);
    next();
  };
}
