/**
 * Environment → typed config, zod-validated, with a PURE parser (`parseConfig`)
 * so every rule below is unit-testable without touching `process.env`.
 *
 * FAIL FAST. A misconfiguration throws at boot rather than degrading: a service
 * that starts with no model runtime address answers every scan with a 502, and
 * a self-hoster reads that as "the product is broken".
 *
 * `.env.example` is the operator-facing counterpart to this file and must be
 * kept in step with it.
 */
import { z } from 'zod';
import { isLogLevel, type LogLevel } from './logger.js';
import { FOOD_SOURCE_NAMES, type FoodSourceName } from './food-source/types.js';

/** The model id this service advertises and accepts. The runtime's own id is `MODEL_ID`. */
export const PUBLIC_MODEL_ID = 'openplate-plate-1';

/** 8 MB of decoded image. A phone photo is 2–5 MB; this is headroom, not a target. */
export const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Long-edge cap for the downscale, in pixels. 896 is a multiple of
 * 112 = lcm(16, 28) — an exact patch boundary for both LFM2.5-VL (16 px patches)
 * and Qwen3-VL (14 px, 2×2 merged ⇒ 28). Benchmarked: 72.8 % recall / 0
 * hallucinations at 896 px on the 50-image gold set (eval, 2026-08-13).
 */
export const DEFAULT_IMAGE_MAX_LONG_EDGE = 896;

/**
 * Default worker-pool size. 2 mirrors `llama-server --parallel 2`: more
 * in-flight requests than the runtime has KV slots does not add throughput, it
 * just moves the queue somewhere we cannot measure it.
 */
export const DEFAULT_CONCURRENCY = 2;

/**
 * `0` disables the latency ceiling, and that is the SELF-HOST default on
 * purpose: slow-and-local is a legitimate product, and a CPU box that shed load
 * at 10 s would refuse every request it is capable of serving. The hosted
 * profile sets `LATENCY_CEILING_MS=10000` (owner, 2026-08-11: a hard maximum,
 * not a target).
 */
export const DEFAULT_LATENCY_CEILING_MS = 0;

/**
 * Total bound on ONE completion call, milliseconds. `0` disables it.
 *
 * THIS BOUND ALREADY EXISTED — it was just never chosen. Node's `fetch` applies
 * a default `headersTimeout` of 300 s, and because every target runtime buffers
 * a non-streaming completion and writes headers only when generation finishes,
 * time-to-headers IS total duration. Measured 2026-08-16: a server returning a
 * correct 200 after 310 s was killed at 300.7 s with `UND_ERR_HEADERS_TIMEOUT`,
 * and `headersTimeout: 0` disables the timer rather than expiring immediately.
 *
 * WHY 600000: the worst measured single-shot plate is 155.9 s (`qwen-vl`,
 * `eval/PERFORMANCE.md:26`, 14 threads), and halving threads roughly doubles it,
 * so an ordinary 8-core box lands near 300 s. 600 s is ~4× the worst measured
 * call, ~2× the worst extrapolated ordinary box, and 2× the accidental status
 * quo — shipping it LOOSENS the cap on every existing deployment rather than
 * tightening anything.
 *
 * THIS IS NOT `LATENCY_CEILING_MS`. That one is admission policy: refuse work
 * you cannot finish in time. This one is liveness: release a worker slot an
 * upstream will never return. With `CONCURRENCY=2`, two wedged in-flight scans
 * brick the service permanently while `/readyz` stays green, because the
 * readiness probes hit a different endpoint entirely.
 */
export const DEFAULT_RUNTIME_COMPLETION_TIMEOUT_MS = 600_000;

/**
 * Default nutrition-resolution backend. FDC because it is the only one that can be
 * SHIPPED: public domain, so a self-hoster resolves macros with no key, no
 * account, and no outbound request — to us or to anyone (spec 04). OpenFoodFacts
 * (ODbL share-alike) and lowcarbcheck (BLS forbids redistribution) are therefore
 * remote, opt-in connectors rather than fallbacks.
 */
export const DEFAULT_FOOD_SOURCE: FoodSourceName = 'fdc';

/** Where the generated USDA extract lives, relative to the working directory. */
export const DEFAULT_FDC_DATASET_PATH = './data/fdc-foods.json';

/** Public LCC deployment. Only ever contacted when `FOOD_SOURCE=lcc`. */
export const DEFAULT_LCC_API_URL = 'https://lowcarbcheck.org';

export type ServiceProfile = 'lite' | 'quality' | 'custom';

export interface ServiceConfig {
  port: number;
  /**
   * Base address of the model runtime. No trailing `/v1`.
   *
   * The runtime MUST enforce grammar-constrained decoding — see `.env.example`
   * for the measured support table. Verified working: llama.cpp `llama-server`,
   * Ollama ≥ 0.32.13. Verified BROKEN: vLLM's CPU build (a `json_schema`
   * request kills the server); vLLM on GPU is untested.
   */
  modelRuntimeUrl: string;
  /**
   * Bearer sent TO the model runtime, on the completion call AND on both
   * readiness probes. `null` (the default) sends no `Authorization` header at
   * all — the bundled llama-server wants none, and an empty one is not the same
   * thing as an absent one to a proxy sitting in front of someone else's stack.
   *
   * It exists because `vllm serve --api-key …` and auth proxies are ordinary
   * BYO-runtime setups, and measured 2026-08-15 they answer every unauthenticated
   * `/v1/chat/completions` with 401 while leaving `/health` open — i.e. without
   * this the service reports ready and fails every scan.
   */
  modelRuntimeApiKey: string | null;
  /** Model id sent TO the runtime. llama-server ignores it; vLLM requires an exact match. */
  runtimeModelId: string;
  /** Accepted bearer keys. Empty ⇒ `main.ts` generates one and prints it once. */
  apiKeys: string[];
  concurrency: number;
  /** Hard queue cap; the (queue_depth+1)th waiter beyond this gets a 429. */
  maxQueueDepth: number;
  latencyCeilingMs: number;
  /**
   * Total bound on one completion call, milliseconds; `0` disables it. A
   * LIVENESS backstop, not a latency policy — see
   * `DEFAULT_RUNTIME_COMPLETION_TIMEOUT_MS` for why the two are different jobs.
   */
  runtimeCompletionTimeoutMs: number;
  maxImageBytes: number;
  rateLimitRpm: number;
  imageMaxLongEdge: number;
  /** Informational for now — spec 05 (packaging) is what consumes it. */
  profile: ServiceProfile;
  logLevel: LogLevel;
  /** Nutrition-resolution backend. `none` skips the stage entirely. */
  foodSource: FoodSourceName;
  /** Path to the generated USDA FDC extract. Only read when `foodSource === 'fdc'`. */
  fdcDatasetPath: string;
  /** LCC base URL. Only contacted when `foodSource === 'lcc'`. */
  lccApiUrl: string;
  /**
   * OpenAI-compatible embeddings endpoint for the semantic half of hybrid
   * retrieval. `null` (the default) means lexical-only retrieval, which is a
   * degraded ranking and never a failure — see `food-source/embedding.ts`.
   */
  embeddingRuntimeUrl: string | null;
  /**
   * Bearer for the embeddings runtime. `null` sends no `Authorization` header.
   * Only read when `embeddingRuntimeUrl` is set; a wrong value degrades retrieval
   * to lexical-only rather than failing a scan, which is why `/readyz` reports
   * `embeddingReady` — see `food-source/embedding.ts`.
   */
  embeddingRuntimeApiKey: string | null;
}

/**
 * Strips absent and blank values so a `FOO=` line in a `.env` file means
 * "unset" rather than "the empty string". Without this, `z.coerce.number()`
 * turns `''` into `0` and a blank `CONCURRENCY=` would silently configure a
 * pool that can never run anything.
 */
function compactEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const compacted = new Map<string, string>();
  for (const [key, value] of Object.entries(env)) {
    const trimmed = value?.trim();
    if (trimmed) compacted.set(key, trimmed);
  }
  return Object.fromEntries(compacted);
}

const positiveInt = z.coerce.number().int().positive();

const EnvSchema = z.object({
  MODEL_RUNTIME_URL: z.string().refine((value) => /^https?:\/\//.test(value), {
    message: 'must be an http(s) URL, e.g. http://127.0.0.1:8080',
  }),
  MODEL_RUNTIME_API_KEY: z.string().min(1).optional(),
  PORT: positiveInt.max(65_535).default(8300),
  MODEL_ID: z.string().min(1).default(PUBLIC_MODEL_ID),
  API_KEYS: z.string().default(''),
  CONCURRENCY: positiveInt.default(DEFAULT_CONCURRENCY),
  MAX_QUEUE_DEPTH: positiveInt.default(8),
  LATENCY_CEILING_MS: z.coerce.number().int().min(0).default(DEFAULT_LATENCY_CEILING_MS),
  RUNTIME_COMPLETION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(DEFAULT_RUNTIME_COMPLETION_TIMEOUT_MS),
  MAX_IMAGE_BYTES: positiveInt.default(DEFAULT_MAX_IMAGE_BYTES),
  RATE_LIMIT_RPM: positiveInt.default(60),
  IMAGE_MAX_LONG_EDGE: positiveInt.min(112).default(DEFAULT_IMAGE_MAX_LONG_EDGE),
  LOG_LEVEL: z.string().default('info'),
  PROFILE: z.enum(['lite', 'quality', 'custom']).default('custom'),
  FOOD_SOURCE: z.enum(FOOD_SOURCE_NAMES).default(DEFAULT_FOOD_SOURCE),
  FDC_DATASET_PATH: z.string().min(1).default(DEFAULT_FDC_DATASET_PATH),
  LCC_API_URL: z.string().min(1).default(DEFAULT_LCC_API_URL),
  EMBEDDING_RUNTIME_URL: z
    .string()
    .refine((value) => /^https?:\/\//.test(value), {
      message: 'must be an http(s) URL, e.g. http://127.0.0.1:8081',
    })
    .optional(),
  EMBEDDING_RUNTIME_API_KEY: z.string().min(1).optional(),
});

/** Splits `API_KEYS` on commas, dropping blanks and duplicates. */
export function parseApiKeys(raw: string): string[] {
  const keys = raw
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  return [...new Set(keys)];
}

/** Drops trailing slashes so URL building never doubles them. */
function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Drops a trailing `/v1` (and any trailing slashes) so URL building never doubles it. */
function normalizeRuntimeUrl(value: string): string {
  return value.replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** Pure: builds the config from an arbitrary env bag. Throws on anything invalid. */
export function parseConfig(env: NodeJS.ProcessEnv): ServiceConfig {
  const parsed = EnvSchema.safeParse(compactEnv(env));
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration — ${details} (see .env.example)`);
  }
  const raw = parsed.data;

  if (!isLogLevel(raw.LOG_LEVEL)) {
    throw new Error(`Invalid LOG_LEVEL: expected debug/info/warn/error, got "${raw.LOG_LEVEL}"`);
  }

  return {
    port: raw.PORT,
    modelRuntimeUrl: normalizeRuntimeUrl(raw.MODEL_RUNTIME_URL),
    // `compactEnv` already dropped blanks, so `?? null` only ever sees a real
    // key or an absent variable — never the empty string.
    modelRuntimeApiKey: raw.MODEL_RUNTIME_API_KEY ?? null,
    runtimeModelId: raw.MODEL_ID,
    apiKeys: parseApiKeys(raw.API_KEYS),
    concurrency: raw.CONCURRENCY,
    maxQueueDepth: raw.MAX_QUEUE_DEPTH,
    latencyCeilingMs: raw.LATENCY_CEILING_MS,
    runtimeCompletionTimeoutMs: raw.RUNTIME_COMPLETION_TIMEOUT_MS,
    maxImageBytes: raw.MAX_IMAGE_BYTES,
    rateLimitRpm: raw.RATE_LIMIT_RPM,
    imageMaxLongEdge: raw.IMAGE_MAX_LONG_EDGE,
    profile: raw.PROFILE,
    logLevel: raw.LOG_LEVEL,
    foodSource: raw.FOOD_SOURCE,
    fdcDatasetPath: raw.FDC_DATASET_PATH,
    // NOT `normalizeRuntimeUrl`: that strips a trailing `/v1`, which is correct
    // for a model runtime and wrong for a site whose API paths we build ourselves.
    lccApiUrl: stripTrailingSlashes(raw.LCC_API_URL),
    embeddingRuntimeUrl: raw.EMBEDDING_RUNTIME_URL
      ? normalizeRuntimeUrl(raw.EMBEDDING_RUNTIME_URL)
      : null,
    embeddingRuntimeApiKey: raw.EMBEDDING_RUNTIME_API_KEY ?? null,
  };
}
