/**
 * OpenAI-compatible chat-completions adapter (covers OpenAI itself, plus any
 * gateway that mirrors its API — OpenRouter, local Ollama/vLLM, etc.). Plain
 * `fetch`, no SDK.
 *
 * Structured output is enforced via a `json_schema` response_format derived
 * from the shared Zod schema. Some custom OpenAI-compatible servers reject the
 * `response_format` parameter — that's the ONE case worth retrying without it
 * (the response content still goes through the same Zod validation either way,
 * the text-parse path being the universal fallback). A 401/402/403/429 is
 * never retried this way: resending the identical request can't turn a bad
 * key, an empty balance, or a rate limit into success — it would just
 * double-bill the user and re-upload their photo for nothing (see
 * `isStructuredOutputRejection` below).
 */
import { z } from 'zod';

import type { PlateImageInput, PlateIdentification, VisionProvider } from './types';
import { VisionProviderError } from './types';
import { VisionProviderFailure, classifyVisionHttpFailure } from './failure-cause';
import { PLATE_IDENTIFICATION_SYSTEM_PROMPT, buildPlateIdentificationUserPrompt } from './prompt';
import { PLATE_IDENTIFICATION_JSON_SCHEMA, parsePlateIdentificationJson } from './schema';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const HTTP_CLIENT_ERROR_START = 400;
const HTTP_SERVER_ERROR_START = 500;
/** Statuses that mean "this exact request can never succeed by resending it" — never retried. */
const NON_RETRYABLE_CLIENT_ERROR_STATUSES: ReadonlySet<number> = new Set([401, 402, 403, 429]);

export interface OpenAiCompatibleProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Merged into every request's headers — used for OpenRouter attribution (see `./constants`). */
  extraHeaders?: Record<string, string>;
  /**
   * Sends `reasoning: { effort: 'none' }` — set from the catalog entry's
   * `disableReasoning` flag by `./index`, never guessed here. See
   * `buildOpenAiCompatibleRequestBody`.
   */
  disableReasoning?: boolean;
}

/** One part of a multimodal user message — text, or the plate photo as a data URL. */
type ChatMessageContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

interface ChatCompletionsMessage {
  role: 'system' | 'user';
  content: string | ChatMessageContentPart[];
}

/**
 * The request body this adapter sends. `reasoning` and `response_format` are
 * optional because their keys must be genuinely ABSENT, not null/false, for
 * the servers that reject unknown body fields — see the builder below.
 */
export interface ChatCompletionsRequestBody {
  model: string;
  messages: ChatCompletionsMessage[];
  reasoning?: { effort: 'none' };
  response_format?: {
    type: 'json_schema';
    json_schema: { name: string; strict: boolean; schema: typeof PLATE_IDENTIFICATION_JSON_SCHEMA };
  };
}

/**
 * The chat-completions envelope, parsed rather than asserted — it is a raw HTTP
 * body from a third party. `.catch(undefined)` on each member keeps a malformed
 * part (a usage block missing a counter, an unexpected choices array) from
 * discarding the rest, which is what the old defensive `typeof` checks did by
 * hand.
 */
const ChatCompletionsResponseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullish() }).optional() }))
    .optional()
    .catch(undefined),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional().catch(undefined),
});

type ChatCompletionsResponse = z.infer<typeof ChatCompletionsResponseSchema>;

/**
 * Parses a 2xx chat-completions envelope. An envelope that isn't even an object
 * degrades to an empty one, which the caller reports as "returned nothing
 * usable" — the same outcome the previous unchecked cast reached by falling
 * through every `?.` below.
 */
async function readChatCompletionsEnvelope(response: Response): Promise<ChatCompletionsResponse> {
  const parsed = ChatCompletionsResponseSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : {};
}

/** True for a 4xx status. */
function isClientErrorStatus(status: number): boolean {
  return status >= HTTP_CLIENT_ERROR_START && status < HTTP_SERVER_ERROR_START;
}

/**
 * True only for the 4xx statuses presumed to be a custom server rejecting
 * the `response_format` parameter — the sole case worth retrying without it.
 * Excludes `NON_RETRYABLE_CLIENT_ERROR_STATUSES` (401/402/403/429): those
 * mean the request itself can never succeed by resending it unchanged, so
 * retrying would only double-bill the user and re-upload their photo.
 */
function isStructuredOutputRejection(status: number): boolean {
  return isClientErrorStatus(status) && !NON_RETRYABLE_CLIENT_ERROR_STATUSES.has(status);
}

/**
 * Builds the chat-completions request body. Pure — no `fetch` — so the enforced
 * and fallback shapes are unit-testable without mocking the network.
 *
 * @param useStructuredOutput - when true, attaches the `json_schema`
 *   response_format that enforces the plate-identification shape; when false,
 *   the body omits `response_format` entirely (for servers that reject it).
 * @param disableReasoning - when true, asks the model not to reason
 *   (`reasoning: { effort: 'none' }`). Only for models the catalog marks with
 *   `disableReasoning` — models that reason by default and cost completion-rate
 *   tokens for it on a plate photo that needs none. Never sent otherwise: this
 *   adapter also serves Mistral and self-hosted endpoints, and an unknown body
 *   field is exactly what some of those reject (see the `response_format`
 *   fallback above).
 */
export function buildOpenAiCompatibleRequestBody({
  model,
  dataUrl,
  useStructuredOutput,
  disableReasoning = false,
}: {
  model: string;
  dataUrl: string;
  useStructuredOutput: boolean;
  disableReasoning?: boolean;
}): ChatCompletionsRequestBody {
  const body: ChatCompletionsRequestBody = {
    model,
    messages: [
      { role: 'system', content: PLATE_IDENTIFICATION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPlateIdentificationUserPrompt() },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  };
  if (disableReasoning) {
    body.reasoning = { effort: 'none' };
  }
  if (useStructuredOutput) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'plate_identification', strict: true, schema: PLATE_IDENTIFICATION_JSON_SCHEMA },
    };
  }
  return body;
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleProviderOptions): VisionProvider {
  const baseUrl = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${options.apiKey}`,
    ...options.extraHeaders,
  };

  return {
    async identifyPlate(image: PlateImageInput): Promise<PlateIdentification> {
      const dataUrl = `data:${image.mimeType};base64,${image.base64}`;

      const sendRequest = async (useStructuredOutput: boolean): Promise<Response> => {
        try {
          return await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(
              buildOpenAiCompatibleRequestBody({
                model: options.model,
                dataUrl,
                useStructuredOutput,
                disableReasoning: options.disableReasoning,
              }),
            ),
          });
        } catch (error) {
          // Network-level failure (unreachable host, CSP/CORS block, DNS) —
          // nothing was billed, and it may well succeed on a later attempt.
          throw new VisionProviderFailure('transient', 'Failed to reach the vision provider', { cause: error });
        }
      };

      let response = await sendRequest(true);
      // A custom server that rejects `response_format` answers with a 4xx —
      // retry exactly once without it, then rely on the prompt + text parse.
      // Only for the subset of 4xx that plausibly means that (see
      // `isStructuredOutputRejection`) — never for a bad key, an empty
      // balance, or a rate limit, where resending changes nothing.
      if (isStructuredOutputRejection(response.status)) {
        response = await sendRequest(false);
      }

      if (!response.ok) {
        const classification = await classifyVisionHttpFailure(response);
        throw new VisionProviderFailure(classification.cause, classification.message);
      }

      const payload = await readChatCompletionsEnvelope(response);
      // Read usage from the (2xx) envelope before parsing content, so a
      // billed-but-unparseable response can still surface what it cost.
      const usage =
        payload.usage ?
          { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens }
        : undefined;

      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        // The call succeeded but returned nothing usable — the one case
        // where "try a different photo" is the accurate message.
        throw new VisionProviderFailure('genuinely-no-food', 'Vision provider returned an empty response', {
          usage,
        });
      }

      let identification: PlateIdentification;
      try {
        identification = parsePlateIdentificationJson(content);
      } catch (error) {
        throw new VisionProviderFailure(
          'genuinely-no-food',
          error instanceof VisionProviderError ? error.message : 'Vision provider returned malformed output',
          { usage, cause: error },
        );
      }

      return usage ? { ...identification, usage } : identification;
    },
  };
}
