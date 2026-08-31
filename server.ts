import { createServer } from 'node:http';
import { createRequestHandler } from '@react-router/express';
import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import compression from 'compression';
import { createComponentLogger } from '#app/lib/logger';
import { reportError } from '#app/lib/report-error';
import { installServerErrorReporter } from '#app/lib/report-error.server';
import { CONFIG } from '#app/config';
import { inferenceConnectSrcOrigin, syncConnectSrcOrigin } from '#app/config/public-config';
import { buildContentSecurityPolicy } from '#app/config/content-security-policy';
import { analyticsCspOrigin } from '#app/config/analytics';
import { createWwwRedirectMiddleware } from '#app/lib/www-redirect.server';
import { PROVIDER_REGISTRY } from '#app/services/vision/registry';

const logger = createComponentLogger('server');

// The plain-tsx module graph is separate from the Vite SSR graph, so install
// the pino-backed reporter here too (before any process-level handlers below
// route through `reportError`).
installServerErrorReporter();

type ServerStartMeta = { url: string };

function logServerStart(port: number, meta?: ServerStartMeta): void {
  logger.info(`Server listening on port ${port}`, meta);
}

function logShutdown(signal: string): void {
  logger.info('Received shutdown signal, starting graceful shutdown', { signal });
}

function logServerClosed(): void {
  logger.info('Server closed');
}

const HTTP_LOG_EXCLUDE_PATHS = new Set(['/healthcheck', '/__manifest', '/bullboard']);
const HTTP_LOG_EXCLUDE_EXTENSIONS = ['.ts', '.tsx', '.css', '.js', '.json', '.data', '.ico', '.png', '.svg'];

/**
 * The strict production Content-Security-Policy (M117/02).
 *
 * The policy itself lives in `app/config/content-security-policy.ts` — a pure
 * builder, because nothing declared in THIS file is importable by a test (it
 * starts a listener at import time), and a CSP directive that is wrong is
 * invisible until a real browser hits real production. That is not
 * hypothetical: a missing `'wasm-unsafe-eval'` silently killed sync passphrase
 * derivation in production while every suite stayed green. See that module for
 * each directive's reasoning and `tests/unit/content-security-policy.test.ts`
 * for the regression guard.
 *
 * PRODUCTION ONLY — applied below only when `CONFIG.app.isProduction`.
 */

/**
 * The origins the BYOK vision calls reach directly from the browser, derived
 * from each provider's FIXED base URL in `PROVIDER_REGISTRY` (M130/03) — never
 * hand-written, so a newly added provider cannot ship with its endpoint
 * silently blocked by `connect-src`. A provider with a user-supplied endpoint
 * (`baseUrl: null`, e.g. `openai-compatible`) contributes nothing here; its
 * loopback carve-out is handled separately inside the CSP builder.
 */
const providerOrigins = Object.values(PROVIDER_REGISTRY)
  .map((definition) => (definition.baseUrl === null ? null : new URL(definition.baseUrl).origin))
  .filter((origin): origin is string => origin !== null);

const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy({
  syncOrigin: syncConnectSrcOrigin(CONFIG.sync.syncServerUrl),
  connectExtra: CONFIG.security.cspConnectExtra,
  providerOrigins,
  // The instance's own AI endpoint (M138 spec 06). Unlike a user-typed
  // openai-compatible base URL — which is why `providerOrigins` above skips
  // that provider entirely — a preset IS known here at boot, so its origin can
  // and must be allowlisted; otherwise the one-click connect ships a button
  // whose first scan is blocked by CSP in production only.
  presetOrigin: inferenceConnectSrcOrigin(CONFIG.inference.instancePreset),
  // The optional newsletter's Turnstile widget (M146 spec 02). `false` on
  // every instance that didn't configure NEWSLETTER_SUBSCRIBE_URL, which
  // leaves this header exactly as it was before the feature existed.
  newsletterEnabled: CONFIG.newsletter !== null,
  // `null` unless an operator set MATOMO_URL + MATOMO_SITE_ID, which leaves
  // this header byte-for-byte what it was before analytics existed.
  analyticsOrigin: analyticsCspOrigin(CONFIG.analytics),
});

function createContentSecurityPolicyMiddleware() {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    next();
  };
}

/** Minimal request logging middleware — logs method/path/status/duration on response finish. */
function createHttpLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (HTTP_LOG_EXCLUDE_PATHS.has(req.path) || HTTP_LOG_EXCLUDE_EXTENSIONS.some((ext) => req.path.endsWith(ext))) {
      next();
      return;
    }
    const startedAt = Date.now();
    res.on('finish', () => {
      logger.info(`${req.method} ${req.originalUrl}`, {
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  };
}

if (process.env.NODE_ENV === 'production' && !process.env.APP_URL) {
  throw new Error('APP_URL is not set');
}

// Create the HTTP server up front so Vite can run its HMR websocket over the
// same server/port as the Express app (middleware-mode `server.hmr.server`
// pattern). This avoids a second dedicated HMR port entirely — the Vite client
// connects back over the page's own host:port.
const app = express();
const server = createServer(app);

const viteDevServer =
  process.env.NODE_ENV === 'production' ?
    undefined
  : await import('vite').then((vite) =>
      vite.createServer({
        server: { middlewareMode: true, hmr: { server } },
      }),
    );

// handle SSR requests

const remixHandler = createRequestHandler({
  build:
    viteDevServer ?
      () => viteDevServer.ssrLoadModule('virtual:react-router/server-build')
      // @ts-expect-error this file is generated at build time and relative to build directory
      // eslint-disable-next-line import/no-unresolved
    : await import('#build/server/index.js'),
});

// Trust the reverse proxy (Traefik) so req.protocol/req.hostname/req.ip and the
// URL the @react-router/express adapter builds reflect X-Forwarded-* headers.
// Required in v8: the CSRF check compares the browser Origin against request.url's
// host, so behind a proxy this must be enabled or same-origin actions get aborted.
// Configurable via TRUST_PROXY (default: 1 in production, off in dev). See app/config.
app.set('trust proxy', CONFIG.server.trustProxy);
app.use(compression());
app.disable('x-powered-by');
// See `createContentSecurityPolicyMiddleware` above for why this is prod-only.
if (CONFIG.app.isProduction) {
  app.use(createContentSecurityPolicyMiddleware());
}

// Canonicalise the host BEFORE anything serves content — the asset handlers,
// the static handler and the React Router handler all sit below this line, so
// a `www.` request never produces a cacheable body, and never touches the
// local-first origin's storage. It sits AFTER the security headers on purpose:
// the redirect response carries them too. See `createWwwRedirectMiddleware`.
app.use(createWwwRedirectMiddleware());

// handle asset requests
if (viteDevServer) {
  app.use(viteDevServer.middlewares);
} else {
  app.use(
    '/assets',
    express.static('build/client/assets', {
      immutable: true,
      maxAge: '1y',
    }),
  );
}

app.use(createHttpLogger());

// Remix fingerprints its assets so we can cache forever.

app.use(express.static('build/client', { maxAge: '1h' }));

// NOTE (M128 spec 01): this app no longer serves any sync HTTP routes. M117
// mounted them here through a build-time composition seam that resolved a
// gitignored private module via a runtime-computed dynamic import; that seam
// (and the never-built browser bundle behind it) is gone. Sync is now a
// standalone service — `openplate-sync`, spoken to over the wire contract in
// `app/lib/sync/engine/protocol.ts` — and the client reaches it directly at
// its own origin (`SYNC_SERVER_URL`, M128 spec 04). Nothing sync-related
// belongs in this file again.

// handle SSR requests
app.all('*', remixHandler);

const port = process.env.PORT || 3000;
server.listen(port, () => {
  logServerStart(Number(port), { url: `http://localhost:${port}` });
});

// Graceful shutdown
// Timeline: SIGTERM → app cleanup (0-8s) → force exit (8s) → Docker SIGKILL (10s)
const FORCE_EXIT_TIMEOUT_MS = 8_000;
const CONNECTION_DRAIN_TIMEOUT_MS = 5_000;
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress, ignoring duplicate signal', { signal });
    return;
  }
  isShuttingDown = true;
  logShutdown(signal);

  // Force exit safety net — fires before Docker's SIGKILL
  const forceExitTimer = setTimeout(() => {
    logger.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, FORCE_EXIT_TIMEOUT_MS);
  forceExitTimer.unref();

  try {
    // 1. Stop accepting new connections and drain idle keep-alive connections
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    server.closeIdleConnections();

    // Force-close remaining connections after grace period
    const drainTimer = setTimeout(() => {
      logger.warn('Forcing remaining connections closed');
      server.closeAllConnections();
    }, CONNECTION_DRAIN_TIMEOUT_MS);
    drainTimer.unref();

    // 2. Close Vite dev server in development
    if (viteDevServer) {
      await viteDevServer.close();
    }

    clearTimeout(drainTimer);
    logServerClosed();
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { error: err instanceof Error ? err : String(err) });
    reportError(err, { source: 'server-shutdown' });
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Forward process-level errors into the reportError seam so consumer
// telemetry (Sentry/Datadog/etc.) sees these too.
process.on('uncaughtException', (error) => {
  reportError(error, { source: 'server-uncaught' });
});
process.on('unhandledRejection', (reason) => {
  reportError(reason, { source: 'server-unhandled-rejection' });
});
