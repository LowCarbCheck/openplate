/**
 * Composition root for the HTTP surface.
 *
 * It takes a fully-built runtime, admission controller and rate limiter rather
 * than a config alone, so the test suite can boot the REAL app against a fake
 * model runtime, a frozen clock, or a one-slot pool. Everything that reads
 * `process.env` lives in `main.ts`; nothing below does.
 *
 * ORDER MATTERS in four places:
 *  1. CORS first, so even a 401 and a preflight carry the headers.
 *  2. `/healthz` and `/readyz` are registered BEFORE the auth middleware and are
 *     unauthenticated: a probe that needed a key would report on the key, and a
 *     container orchestrator has no key to give.
 *  3. The auth middleware is mounted on `/v1` BEFORE the routers, so an
 *     unauthenticated caller gets 401 rather than falling through to a 404 that
 *     tells them which models exist.
 *  4. The 404 and the error handler are last — Express only reaches a
 *     four-argument handler after everything before it has passed the error along.
 *
 * THE TWO PROBES ARE NOT THE SAME QUESTION. `/healthz` asks "is this process
 * alive"; `/readyz` asks "can it serve a scan right now", which means asking the
 * model runtime. A service that 200s while a 6 GB model is still loading is worse
 * than one that 503s: the orchestrator sends it traffic and every scan fails.
 */
import express from 'express';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { PUBLIC_MODEL_ID, type ServiceConfig } from '../config.js';
import type { Embedder } from '../food-source/embedding.js';
import type { Logger } from '../logger.js';
import { jsonBodyLimitBytes } from '../pipeline/image.js';
import type { ModelRuntime } from '../pipeline/runtime-client.js';
import type { NutritionResolver } from '../pipeline/resolve-nutrition.js';
import type { AdmissionController } from './admission.js';
import { createApiKeyAuth } from './api-key-auth.js';
import { createChatCompletionsHandler } from './chat-completions.js';
import { createCorsMiddleware } from './cors.js';
import { createErrorMiddleware, handleNotFound } from './error-middleware.js';
import type { RateLimiter } from './rate-limit.js';

export interface CreateAppOptions {
  config: ServiceConfig;
  runtime: ModelRuntime;
  /**
   * Nutrition resolution. `null`/absent is a supported state, not a degraded one:
   * `FOOD_SOURCE=none`, or an FDC dataset that failed to load, and every scan
   * still answers with `macrosPer100g: null`.
   */
  resolver?: NutritionResolver | null;
  /**
   * The embedding runtime, for REPORTING only — nothing on the HTTP surface
   * calls `embed`. `null`/absent means `EMBEDDING_RUNTIME_URL` is unset, which is
   * the default and a legitimate mode, not a degradation.
   */
  embedder?: Pick<Embedder, 'status'> | null;
  admission: AdmissionController;
  rateLimiter: RateLimiter;
  logger: Logger;
}

/**
 * Express 4 does not catch a rejected promise from a handler — an async handler
 * that throws would hang the request until the client gave up, which is a worse
 * failure than any error it was trying to report. Every async route goes through
 * this.
 */
function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    void (async (): Promise<void> => {
      try {
        await handler(req, res);
      } catch (error) {
        next(error);
      }
    })();
  };
}

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');

  app.use(createCorsMiddleware());
  app.use(
    express.json({
      // Derived from MAX_IMAGE_BYTES, never hand-picked — see `jsonBodyLimitBytes`.
      limit: jsonBodyLimitBytes(options.config.maxImageBytes),
    }),
  );

  /** Liveness only. No auth, no dependencies — it must answer while the model loads. */
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  /**
   * Readiness: gated on the MODEL runtime reporting itself ready, and 503
   * otherwise.
   *
   * `embeddingReady` / `embeddingReason` ride along as a DEGRADED field and
   * deliberately do not touch the status code. Lexical-only retrieval is a
   * legitimate mode — it is the default — so a dead or mis-keyed embeddings
   * runtime must not take the service out of an orchestrator's rotation. It must
   * also not stay invisible, which is what it was before: one boot-time warning
   * and then permanently worse ranking with no signal.
   *
   * `embeddingReady: null` means "not configured", distinct from `false`
   * ("configured and currently failing"). `embeddingReason` holds the invariant
   * that a NON-NULL reason means something is wrong — so it is `null` when
   * unconfigured, not an explanatory sentence. An operator alerting on
   * `embeddingReason !== null` must not be paged by the default configuration;
   * the explanation of what lexical-only means belongs in the README.
   */
  app.get(
    '/readyz',
    asyncRoute(async (_req, res) => {
      const ready = await options.runtime.isReady();
      const stats = options.admission.stats();
      const embedding = options.embedder?.status() ?? null;
      res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'model runtime not ready',
        modelRuntimeReady: ready,
        embeddingReady: embedding ? embedding.ready : null,
        embeddingReason: embedding?.reason ?? null,
        inFlight: stats.active,
        queued: stats.queued,
      });
    }),
  );

  const requireApiKey = createApiKeyAuth(options.config.apiKeys);
  app.use('/v1', requireApiKey);

  /** The one model this service serves, in the OpenAI list shape. */
  app.get('/v1/models', (_req, res) => {
    res.status(200).json({
      object: 'list',
      data: [
        {
          id: PUBLIC_MODEL_ID,
          object: 'model',
          created: 0,
          owned_by: 'openplate',
        },
      ],
    });
  });

  app.post('/v1/chat/completions', asyncRoute(createChatCompletionsHandler(options)));

  app.use(handleNotFound);
  app.use(createErrorMiddleware(options.logger));

  return app;
}
