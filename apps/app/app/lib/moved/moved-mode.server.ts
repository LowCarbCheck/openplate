/**
 * Moved mode's two Express handlers: what a closed instance answers (`MOVED_TO_URL`).
 *
 * ── The routes ───────────────────────────────────────────────────────────
 *
 * | Request                     | Answer                                                        |
 * | --------------------------- | ------------------------------------------------------------- |
 * | `/sw.js`                    | 200, the kill switch worker (`kill-switch-worker.ts`), no-cache |
 * | `/api/*`                    | 410 Gone, `{ "error": "moved", "movedTo": <MOVED_TO_URL> }`   |
 * | `*.data` (route data)       | 204 with React Router's "load this page whole" headers        |
 * | `/__manifest` (discovery)   | 204 with React Router's "reload the document" header          |
 * | `/healthcheck`              | passed through to React Router: 200 `OK`, as before           |
 * | a file in the build         | served as before (styles, fonts, icons, `site.webmanifest`)   |
 * | a missing `/assets/` file   | 404, plain text                                               |
 * | any other GET or HEAD       | 200, the moved page, in the reader's language                 |
 * | any other method            | 303 to the same path, so the browser asks again with GET      |
 *
 * ── Why route data is not a 410 ──────────────────────────────────────────
 *
 * An app that was already open when the instance closed keeps running its own scripts. When it
 * moves to another screen it asks for that screen's data at `<path>.data`, and a 410 there would
 * put the app's error screen in front of the person. The 204 with `X-Remix-Redirect` and
 * `X-Remix-Reload-Document` is React Router's own instruction to leave the app and load an
 * address as a whole document (`fetchAndDecodeViaTurboStream` in `react-router`'s single fetch),
 * so the next tap lands on the moved page instead. `/__manifest` gets the answer React Router's
 * own server gives a client from an older build, which reloads the page the same way.
 *
 * ── Why two handlers ─────────────────────────────────────────────────────
 *
 * `beforeFiles` is mounted above the static file handlers, because `/sw.js` IS a static file (the
 * app's worker, `public/sw.js`) and must never be served in this mode. `everyPage` is mounted
 * below them, in place of React Router, so that the stylesheets, fonts and icons the moved page
 * links are still served from the build.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ServerBuild } from 'react-router';

import type { MovedConfig } from '#app/config/moved';
import type { LanguageCode } from '#app/i18n/language-prefs';
import { KILL_SWITCH_WORKER } from './kill-switch-worker';
import { movedPageCopy, resolveMovedPageLanguage } from './moved-copy';
import { renderMovedPage } from './moved-page';
import { readMovedPageLinks } from './moved-page-links';
import { classifyMovedRequest, pageOfRouteData, toSameOriginPath } from './moved-request';

/** The two handlers `server.ts` mounts. */
export interface MovedModeHandlers {
  /** Above the static files: the worker script, the API, and React Router's own requests. */
  readonly beforeFiles: RequestHandler;
  /** Below the static files, in place of React Router: every page is the moved page. */
  readonly everyPage: RequestHandler;
}

/** No cache may keep an answer of this mode: the operator may turn it off again. */
const NO_STORE = 'no-store';

/** The kill switch worker, never cached, so a browser's next update check always reaches it. */
function answerWorker(response: Response): void {
  response
    .status(200)
    .set({ 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' })
    .send(KILL_SWITCH_WORKER);
}

/** 410 for the API, with the new address, for an old copy of the app or a script that calls it. */
function answerGone(response: Response, moved: MovedConfig): void {
  response.status(410).set('Cache-Control', NO_STORE).json({ error: 'moved', movedTo: moved.url });
}

/** React Router's instruction to load `page` as a whole document (see the module doc). */
function answerLoadPageWhole(response: Response, page: string): void {
  response
    .status(204)
    .set({
      'X-Remix-Redirect': page,
      'X-Remix-Reload-Document': 'true',
      'Cache-Control': NO_STORE,
    })
    .end();
}

/** React Router's instruction to reload the current document, as its server sends an old client. */
function answerReloadDocument(response: Response): void {
  response.status(204).set({ 'X-Remix-Reload-Document': 'true', 'Cache-Control': NO_STORE }).end();
}

/** A missing built asset: never a page, because nothing that asks for one can show a page. */
function answerMissingAsset(response: Response): void {
  response.status(404).set('Cache-Control', NO_STORE).type('text/plain').send('Not found');
}

/**
 * Builds moved mode's handlers, after reading the page's links once.
 *
 * THE READ AT BUILD TIME IS THE CHECK. A server build with no root route would leave every page
 * without its stylesheet, and here it stops the boot instead. Each page reads the links again,
 * which costs nothing in production, where the build is one module, and follows Vite in dev,
 * where the loader answers afresh.
 *
 * @param options.moved - `CONFIG.moved`, the new address.
 * @param options.defaultLanguage - `CONFIG.i18n.defaultLanguage`, the last step of the language choice.
 * @param options.loadServerBuild - the React Router server build `server.ts` hands its request handler.
 * @throws when the build has no root route to read the page's links from.
 */
export async function createMovedModeHandlers(options: {
  moved: MovedConfig;
  defaultLanguage: LanguageCode;
  loadServerBuild: () => Promise<ServerBuild>;
}): Promise<MovedModeHandlers> {
  readMovedPageLinks(await options.loadServerBuild());

  const beforeFiles: RequestHandler = (request, response, next) => {
    const kind = classifyMovedRequest(request.path);
    if (kind === 'worker') {
      answerWorker(response);
      return;
    }
    if (kind === 'api') {
      answerGone(response, options.moved);
      return;
    }
    if (kind === 'route-data') {
      answerLoadPageWhole(response, pageOfRouteData(request.path));
      return;
    }
    if (kind === 'route-discovery') {
      answerReloadDocument(response);
      return;
    }
    next();
  };

  /** The moved page, or the error handed to Express, which answers 500 as it does for any route. */
  async function answerPage(request: Request, response: Response, next: NextFunction): Promise<void> {
    try {
      const language = resolveMovedPageLanguage({
        cookieHeader: request.get('cookie') ?? null,
        acceptLanguage: request.get('accept-language') ?? null,
        instanceDefault: options.defaultLanguage,
      });
      const html = renderMovedPage({
        language,
        copy: movedPageCopy({ language, host: options.moved.host }),
        signInUrl: options.moved.signInUrl,
        links: readMovedPageLinks(await options.loadServerBuild()),
      });
      response
        .status(200)
        .set({
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Language': language,
          'Cache-Control': NO_STORE,
          Vary: 'Cookie, Accept-Language',
        })
        .send(html);
    } catch (error) {
      next(error);
    }
  }

  const everyPage: RequestHandler = (request, response, next) => {
    const kind = classifyMovedRequest(request.path);
    if (kind === 'health') {
      next();
      return;
    }
    if (kind === 'asset') {
      answerMissingAsset(response);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.redirect(303, toSameOriginPath(request.path));
      return;
    }
    void answerPage(request, response, next);
  };

  return { beforeFiles, everyPage };
}
