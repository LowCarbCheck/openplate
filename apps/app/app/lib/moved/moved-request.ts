/**
 * What a request to a moved instance is asking for, read from its path alone.
 *
 * Pure, so the whole routing table of moved mode is unit tested without a server
 * (`tests/unit/moved-request.test.ts`); `moved-mode.server.ts` answers each kind.
 *
 * ── The rule every kind serves: no app page, ever ────────────────────────
 *
 * In moved mode `/sw.js` is the worker that clears the caches, unregisters itself and reloads
 * every tab. An app page loads the app's scripts, and the app registers `/sw.js` as it starts.
 * So one app page served here would register the kill switch, be reloaded by it, register it
 * again, and never stop. That is why only `/healthcheck` reaches React Router, a resource route
 * that answers plain text: `/health` is NOT passed through, because on this server it is the
 * not-found PAGE. Every other path is the moved page, a file, or one of the answers below.
 */

/** What moved mode does with a request. */
export type MovedRequestKind =
  /** The container's probe: passed through to React Router, which answers `OK`. */
  | 'health'
  /** The service worker script: the kill switch. */
  | 'worker'
  /** The app's own API: 410 Gone, naming the new address. */
  | 'api'
  /** React Router's route data for a page (`/diary.data`): the signal to load that page whole. */
  | 'route-data'
  /** React Router's route discovery (`/__manifest`): the signal to reload the page whole. */
  | 'route-discovery'
  /** A built asset (`/assets/...`): served when it exists, 404 when it does not, never a page. */
  | 'asset'
  /** Everything else: the moved page. */
  | 'page';

/** The container healthcheck path (`app/routes.ts`, `docker/compose.yml`). */
const HEALTH_PATH = '/healthcheck';

/** The path the app registers its worker at (`app/lib/service-worker.ts`, `app/lib/push.ts`). */
const WORKER_PATH = '/sw.js';

/** React Router's route discovery endpoint (`routeDiscovery` in the server build). */
const ROUTE_DISCOVERY_PATH = '/__manifest';

/** The suffix React Router's single fetch adds to a page's path for its data. */
const ROUTE_DATA_SUFFIX = '.data';

/** The name single fetch gives the data of a path that ends in a slash, the root included. */
const SLASH_ROUTE_DATA_NAME = '_.data';

/**
 * Sorts a request path into what moved mode does with it.
 *
 * @param path - the request's path, no query string (Express `req.path`).
 */
export function classifyMovedRequest(path: string): MovedRequestKind {
  if (path === HEALTH_PATH) return 'health';
  if (path === WORKER_PATH) return 'worker';
  if (path === '/api' || path.startsWith('/api/')) return 'api';
  if (path.endsWith(ROUTE_DATA_SUFFIX)) return 'route-data';
  if (path === ROUTE_DISCOVERY_PATH) return 'route-discovery';
  if (path.startsWith('/assets/')) return 'asset';
  return 'page';
}

/**
 * What a browser reads as the start of another host when it follows a path: a slash, a backslash
 * (a browser treats `\` as `/` in an http URL), and the tab and line breaks it deletes from a URL
 * before reading it, so `/\t/evil.example` is `//evil.example` to it.
 */
const LEADING_HOST_SEPARATORS = /^[/\\\t\n\r]+/;

/**
 * The same path, safe to send back as a same-origin address.
 *
 * A request line may carry `//evil.example/x` or `/\evil.example`, and a `Location` or an
 * `X-Remix-Redirect` header holding that would send the browser to another host. Express encodes
 * a backslash in `Location`, but nothing encodes `X-Remix-Redirect`. Collapsing every leading
 * separator keeps the result on this origin whichever header carries it.
 *
 * @param path - a request path.
 */
export function toSameOriginPath(path: string): string {
  return `/${path.replace(LEADING_HOST_SEPARATORS, '')}`;
}

/**
 * The page a route data path is the data of, as a same-origin path.
 *
 * `/diary.data` is `/diary`, `/_.data` is `/`, `/settings/_.data` is `/settings/`.
 *
 * @param path - a path {@link classifyMovedRequest} sorted as `route-data`.
 */
export function pageOfRouteData(path: string): string {
  const page =
    path.endsWith(`/${SLASH_ROUTE_DATA_NAME}`) ?
      path.slice(0, -SLASH_ROUTE_DATA_NAME.length)
    : path.slice(0, -ROUTE_DATA_SUFFIX.length);
  return toSameOriginPath(page);
}
