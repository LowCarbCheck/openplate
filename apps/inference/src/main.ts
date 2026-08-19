/**
 * Service entry point — the only module in `src/` that reads `process.env`,
 * opens sockets, or decides when the process should die.
 *
 * Boot order:
 *   1. Parse config. A misconfiguration kills the process here, before anything
 *      downstream can half-work.
 *   2. Resolve the API key set (generating one if the operator gave none).
 *   3. Open the listener. The model runtime is NOT waited for: it may take
 *      minutes to load a multi-GB model, and `/readyz` is what reports that. A
 *      boot that blocked on it would look like a hung container.
 */
import { randomBytes } from 'node:crypto';
import { parseConfig, PUBLIC_MODEL_ID, type ServiceConfig } from './config.js';
import { createEmbedderFromConfig, createFoodSourceFromConfig } from './food-source/index.js';
import { createLogger, type Logger } from './logger.js';
import { createNutritionResolver, type NutritionResolver } from './pipeline/resolve-nutrition.js';
import { createModelRuntime } from './pipeline/runtime-client.js';
import { createAdmissionController } from './server/admission.js';
import { apiKeyId } from './server/api-key-auth.js';
import { createApp } from './server/create-app.js';
import { createRateLimiter } from './server/rate-limit.js';

/** 24 random bytes ≈ 192 bits, base64url-encoded. Prefixed so it is recognisable in a config file. */
function generateApiKey(): string {
  return `opk_${randomBytes(24).toString('base64url')}`;
}

/**
 * The first-boot key story for a self-hoster: `docker run` with no `API_KEYS`
 * and the key you need is the first thing in the log.
 *
 * IT IS IN MEMORY ONLY. A restart generates a NEW key and the old one stops
 * working — deliberately, because the alternative is writing a secret to a file
 * or a database this service otherwise does not have, and a stateless service is
 * the whole reason it can be deployed by copying one compose file. The moment a
 * self-hoster wants a stable key they set `API_KEYS`, which is what the printed
 * banner tells them to do. Spec 05 (packaging) makes that the documented default
 * by generating it into `.env` at first `docker compose up`.
 */
function resolveApiKeys(config: ServiceConfig): string[] {
  if (config.apiKeys.length > 0) return config.apiKeys;

  const generated = generateApiKey();
  // Written straight to stdout, NOT through the logger: this is a one-time
  // operator handover, not a log event, and it must be readable in a terminal
  // rather than buried in a JSON line. It is also the one and only time a key
  // is ever printed.
  process.stdout.write(
    [
      '',
      '='.repeat(72),
      '  No API_KEYS configured — generated a temporary key for this process:',
      '',
      `    ${generated}`,
      '',
      '  This key lives in memory only. Restarting this container generates a',
      '  new one. Set API_KEYS=<key>[,<key>] in the environment for a stable key.',
      '='.repeat(72),
      '',
    ].join('\n'),
  );
  return [generated];
}

function main(): void {
  const config = parseConfig(process.env);
  const logger: Logger = createLogger({ component: 'openplate-inference', level: config.logLevel });
  const apiKeys = resolveApiKeys(config);

  // Built at boot rather than lazily: an unreadable FDC dataset should be the
  // second thing an operator reads in the log, not a surprise on their first scan.
  const foodSource = createFoodSourceFromConfig({ config, logger });
  // Held in a variable rather than inlined: `/readyz` reports its state, so the
  // same instance the resolver ranks with is the one the probe describes.
  const embedder = createEmbedderFromConfig({ config, logger });
  const resolver: NutritionResolver | null = foodSource
    ? createNutritionResolver({ source: foodSource, embedder, logger })
    : null;

  const app = createApp({
    config: { ...config, apiKeys },
    runtime: createModelRuntime({
      baseUrl: config.modelRuntimeUrl,
      modelId: config.runtimeModelId,
      apiKey: config.modelRuntimeApiKey,
      completionTimeoutMs: config.runtimeCompletionTimeoutMs,
    }),
    embedder,
    admission: createAdmissionController({
      concurrency: config.concurrency,
      maxQueueDepth: config.maxQueueDepth,
      latencyCeilingMs: config.latencyCeilingMs,
    }),
    rateLimiter: createRateLimiter({ requestsPerMinute: config.rateLimitRpm }),
    resolver,
    logger,
  });

  const server = app.listen(config.port, () => {
    logger.info('openplate-inference listening', {
      port: config.port,
      model: PUBLIC_MODEL_ID,
      profile: config.profile,
      concurrency: config.concurrency,
      maxQueueDepth: config.maxQueueDepth,
      latencyCeilingMs: config.latencyCeilingMs,
      // Logged next to the ceiling so the two are visibly different settings:
      // one sheds load, the other releases a wedged worker slot.
      runtimeCompletionTimeoutMs: config.runtimeCompletionTimeoutMs,
      rateLimitRpm: config.rateLimitRpm,
      maxLongEdge: config.imageMaxLongEdge,
      foodSource: resolver?.describe().name ?? 'none',
      // Fingerprints, never the keys themselves.
      keyIds: apiKeys.map(apiKeyId).join(','),
    });
  });

  function shutdown(signal: string): void {
    logger.info('Shutting down', { signal });
    server.close(() => process.exit(0));
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  main();
} catch (error) {
  // Scrubbed: a config error can quote a connection string.
  process.stderr.write(`${error instanceof Error ? error.message : 'unknown startup error'}\n`);
  process.exit(1);
}
