/**
 * `POST /v1/chat/completions` — the front door.
 *
 * THE COMPATIBILITY CONTRACT. openplate's `openai-compatible` adapter is the
 * client, unchanged: it posts a chat-completions request with a system prompt, a
 * text part, an `image_url` data URI, and a `json_schema` response_format, then
 * reads `choices[0].message.content` and runs it through
 * `parsePlateIdentificationJson`. So the reply must be a standard completion
 * envelope whose content is CLEAN, UNFENCED `PlateIdentification` JSON. The
 * client tolerates a markdown fence; relying on that would be sloppy.
 *
 * WHAT WE IGNORE FROM THE REQUEST, AND WHY. The caller's `messages` are read for
 * exactly one thing — the image. Their prompt text and their `response_format` are
 * accepted and discarded, because this endpoint is not a general vision model: it
 * is a plate identifier whose measured accuracy (72.8 % recall, 0 hallucinations)
 * belongs to a specific prompt and a specific grammar. Honouring a caller's
 * prompt would silently substitute an unmeasured pipeline for a measured one.
 *
 * ORDER OF OPERATIONS is deliberate:
 *   1. model id       — a wrong model is a 404 before any work happens
 *   2. rate limit     — cheapest gate that can reject; per key, not per IP
 *   3. request shape  — a malformed request gets a 400 even while saturated
 *   4. admission      — shed load BEFORE spending CPU/GPU on it
 *   5. prepare + call — inside the pool, so its cost is what the pool measures
 *   6. resolve macros — OUTSIDE the pool: it is I/O against a local dataset or a
 *                       remote API, not model work, and holding a KV slot during
 *                       it would shrink effective concurrency for no reason
 *
 * WHERE THE MACROS COME FROM. The model never emits them (Locked decision 13), so
 * step 6 is the only source of a nutrition number in the whole service. It is
 * bounded (~2 s for a whole plate) and fails open to `null` — see
 * `pipeline/resolve-nutrition.ts`.
 *
 * The image never leaves this call stack: it is decoded into a Buffer inside
 * step 5, handed to the runtime as a data URI, and dropped when the promise
 * settles. Nothing writes it anywhere and nothing logs it — see `scrub.ts`.
 */
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PUBLIC_MODEL_ID, type ServiceConfig } from '../config.js';
import { badRequest, modelNotFound } from '../errors.js';
import { JsonValueSchema } from '../json.js';
import type { Logger } from '../logger.js';
import { extractImageDataUri, prepareImage } from '../pipeline/image.js';
import { mapTerseToPlate } from '../pipeline/map-terse.js';
import type { ModelRuntime } from '../pipeline/runtime-client.js';
import type { NutritionResolver, ResolutionStats } from '../pipeline/resolve-nutrition.js';
import { validatePlateIdentification } from '../contract/plate-identification.js';
import type { AdmissionController } from './admission.js';
import { getApiKeyIdentity } from './api-key-auth.js';
import type { RateLimiter } from './rate-limit.js';

export interface ChatCompletionsDeps {
  config: ServiceConfig;
  runtime: ModelRuntime;
  /** Absent ⇒ resolution is off and every item keeps `macrosPer100g: null`. */
  resolver?: NutritionResolver | null;
  admission: AdmissionController;
  rateLimiter: RateLimiter;
  logger: Logger;
}

interface ChatCompletionEnvelope {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: 'assistant'; content: string };
    finish_reason: 'stop';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /**
     * Non-standard, additive: wall time for the whole request in milliseconds.
     * Extra `usage` keys are ignored by every OpenAI client including
     * openplate's, and per-request cost/latency reporting belongs here rather
     * than in openplate's pricing catalog — a self-hosted endpoint's cost is
     * unknowable to the client.
     */
    latency_ms: number;
  };
}

/**
 * The request body, decoded only as far as this endpoint cares.
 *
 * `messages` stays raw JSON here on purpose: `pipeline/image.ts` owns the rules
 * about content parts and reports its own actionable errors, and a strict schema
 * at this level would reject the prompt text and `response_format` that a
 * standard client sends and this endpoint deliberately ignores (see the module
 * header). Absent `messages` becomes `null`, which `extractImageDataUri` reports
 * as "must be an array of chat messages".
 */
const RequestBodySchema = z.looseObject({
  model: z.string().min(1),
  messages: JsonValueSchema.default(null),
});

/**
 * Returns a plain async function rather than an Express `RequestHandler`:
 * `create-app.ts` wraps it in `asyncRoute`, which is the only thing that turns a
 * rejected promise into a `next(error)` on Express 4. Typing it as a
 * `RequestHandler` here would make it look safe to mount directly.
 */
export function createChatCompletionsHandler(
  deps: ChatCompletionsDeps,
): (req: Request, res: Response) => Promise<void> {
  return async function handleChatCompletions(req: Request, res: Response): Promise<void> {
    const startedAt = performance.now();
    const parsedBody = RequestBodySchema.safeParse(req.body);

    // 1. Model id. The only field this endpoint requires of the caller; a body
    // that does not carry a usable one never reaches the rest of the pipeline.
    if (!parsedBody.success) {
      throw badRequest('`model` is required.', { param: 'model' });
    }
    const requestedModel = parsedBody.data.model;
    if (requestedModel !== PUBLIC_MODEL_ID) {
      throw modelNotFound(requestedModel);
    }

    // 2. Rate limit. `keyId` is always present — the auth middleware runs first.
    const keyId = getApiKeyIdentity(req)?.keyId ?? 'unknown';
    deps.rateLimiter.consume(keyId);

    // 3. Request shape. Cheap: reads the URI out of the JSON, decodes nothing.
    const imageDataUri = extractImageDataUri(parsedBody.data.messages);

    // 4 + 5. Admission, then the actual work.
    const result = await deps.admission.run(async () => {
      const prepared = await prepareImage(imageDataUri, {
        maxImageBytes: deps.config.maxImageBytes,
        maxLongEdge: deps.config.imageMaxLongEdge,
      });
      const completion = await deps.runtime.identify(prepared.dataUri);
      return { prepared, completion };
    });

    const { plate, duplicatesDropped } = mapTerseToPlate(result.completion.candidate);

    // 6. Nutrition resolution. Never throws: a corpus outage leaves macros null.
    let resolutionStats: ResolutionStats | null = null;
    let resolvedPlate = plate;
    if (deps.resolver) {
      const outcome = await deps.resolver.resolve(plate);
      resolvedPlate = outcome.plate;
      resolutionStats = outcome.stats;
    }

    // Self-check on our OWN payload: the response is built in code, so a mapping
    // bug is the only way an invalid shape could ship. Better a 500 here than a
    // `VisionProviderError` in the client.
    const validated = validatePlateIdentification(resolvedPlate);
    const latencyMs = performance.now() - startedAt;

    const envelope: ChatCompletionEnvelope = {
      id: `chatcmpl-${randomUUID().replace(/-/g, '')}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: PUBLIC_MODEL_ID,
      choices: [
        {
          index: 0,
          // Unfenced, no leading prose — see the module header.
          message: { role: 'assistant', content: JSON.stringify(validated) },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: result.completion.usage.promptTokens,
        completion_tokens: result.completion.usage.completionTokens,
        total_tokens: result.completion.usage.promptTokens + result.completion.usage.completionTokens,
        latency_ms: Math.round(latencyMs),
      },
    };

    // Metadata only: sizes, timings, counts, key fingerprint. No payload, no
    // food names (a food log is personal data too).
    deps.logger.info('Plate identified', {
      keyId,
      latencyMs: Math.round(latencyMs),
      runtimeMs: Math.round(result.completion.latencyMs),
      promptTokens: envelope.usage.prompt_tokens,
      completionTokens: envelope.usage.completion_tokens,
      items: validated.foods.length,
      duplicatesDropped,
      // Resolution counters, never food names — a food log is personal data too.
      foodSource: resolutionStats?.source ?? 'none',
      itemsResolved: resolutionStats?.resolved ?? 0,
      resolutionFailures: resolutionStats?.failed ?? 0,
      corpusQueries: resolutionStats?.queries ?? 0,
      resolutionMs: resolutionStats ? Math.round(resolutionStats.durationMs) : 0,
      sourceBytes: result.prepared.originalBytes,
      sentBytes: result.prepared.preparedBytes,
      longEdge: Math.max(result.prepared.width, result.prepared.height),
      downscaled: result.prepared.downscaled,
    });

    res.status(200).json(envelope);
  };
}
