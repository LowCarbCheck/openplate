/**
 * Anthropic Messages API adapter. Plain `fetch`, no SDK. Structured output is
 * enforced via forced tool-use: the model must call the scan task's tool (see
 * `./task`) with input matching that task's JSON Schema, and the tool input is
 * validated by the same task descriptor every other adapter uses. If no
 * tool_use block comes back (e.g. a proxy that drops tools), it falls back to
 * parsing a text block. Nothing here knows which task it is running.
 */
import { z } from 'zod';

import type { PlateImageInput, ScanResultBase, ScanTokenUsage, VisionProvider } from './types';
import { VisionProviderError } from './types';
import { VisionProviderFailure, classifyVisionHttpFailure } from './failure-cause';
import type { ScanTaskDescriptor } from './task';
import { attachScanUsage } from './task';
// The auth headers live in `./constants` (M130/01), not here: the live key
// check in `./verify-key` sends byte-identical headers, and a second copy is
// only ever a way for the two to drift apart.
import { getAnthropicAuthHeaders } from './constants';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const MAX_OUTPUT_TOKENS = 1536;

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
}

/**
 * The Messages envelope, parsed rather than asserted — it is a raw HTTP body
 * from a third party, so `as` would only be a wish. `.catch(undefined)` on
 * each member keeps a malformed part (a usage block missing a counter, an
 * unexpected content array) from discarding the rest of the response, which is
 * exactly what the old defensive `typeof` checks did by hand.
 */
const AnthropicMessagesResponseSchema = z.object({
  content: z
    .array(
      z.object({
        type: z.string().optional(),
        text: z.string().optional(),
        input: z.json().optional(),
      }),
    )
    .optional()
    .catch(undefined),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional().catch(undefined),
});

type AnthropicMessagesResponse = z.infer<typeof AnthropicMessagesResponseSchema>;

/**
 * Parses a 2xx Messages envelope. An envelope that isn't even an object
 * degrades to an empty one, which the caller reports as "returned nothing
 * usable" — the same outcome the previous unchecked cast reached by falling
 * through every `?.` below.
 */
async function readAnthropicEnvelope(response: Response): Promise<AnthropicMessagesResponse> {
  const parsed = AnthropicMessagesResponseSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : {};
}

/**
 * Wraps a parse/validation failure in a display-safe error, carrying any
 * billed usage. Classified `genuinely-no-food` — the call succeeded (2xx)
 * but returned nothing usable, the one case where "try a different photo" is
 * the accurate message.
 */
function toMalformedOutputFailure(cause: unknown, usage: ScanTokenUsage | undefined): VisionProviderFailure {
  return new VisionProviderFailure(
    'genuinely-no-food',
    cause instanceof VisionProviderError ? cause.message : 'Vision provider returned malformed output',
    { usage, cause },
  );
}

/**
 * Builds the Messages request body with forced tool-use. Pure — no `fetch` —
 * so the tools + `tool_choice` shape is unit-testable without mocking network.
 */
export function buildAnthropicRequestBody({
  model,
  image,
  task,
}: {
  model: string;
  image: PlateImageInput;
  task: ScanTaskDescriptor<ScanResultBase>;
}) {
  return {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: task.systemPrompt,
    tools: [
      {
        name: task.toolName,
        description: task.toolDescription,
        input_schema: task.jsonSchema,
      },
    ],
    tool_choice: { type: 'tool', name: task.toolName },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: task.userPrompt },
          {
            type: 'image',
            source: { type: 'base64', media_type: image.mimeType, data: image.base64 },
          },
        ],
      },
    ],
  };
}

export function createAnthropicProvider(options: AnthropicProviderOptions): VisionProvider {
  async function runScan<TResult extends ScanResultBase>({
    task,
    image,
  }: {
    task: ScanTaskDescriptor<TResult>;
    image: PlateImageInput;
  }): Promise<TResult> {
    let response: Response;
    try {
      response = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAnthropicAuthHeaders({ apiKey: options.apiKey }),
        },
        body: JSON.stringify(buildAnthropicRequestBody({ model: options.model, image, task })),
      });
    } catch (error) {
      // Network-level failure — nothing was billed, and it may well
      // succeed on a later attempt.
      throw new VisionProviderFailure('transient', 'Failed to reach the vision provider', { cause: error });
    }

    if (!response.ok) {
      const classification = await classifyVisionHttpFailure(response);
      throw new VisionProviderFailure(classification.cause, classification.message, {
        retryAfterSeconds: classification.retryAfterSeconds,
      });
    }

    const payload = await readAnthropicEnvelope(response);
    // Read usage from the (2xx) envelope before parsing content, so a
    // billed-but-unparseable response can still surface what it cost.
    const usage =
      payload.usage ?
        { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens }
      : undefined;

    // Primary path: forced tool-use — validate the tool input directly.
    const toolUseBlock = payload.content?.find((block) => block.type === 'tool_use' && block.input !== undefined);
    if (toolUseBlock && toolUseBlock.input !== undefined) {
      let result: TResult;
      try {
        result = task.validate(toolUseBlock.input);
      } catch (error) {
        throw toMalformedOutputFailure(error, usage);
      }
      return attachScanUsage(result, usage);
    }

    // Fallback path: a text block of JSON (proxy dropped tools, etc.).
    const textBlock = payload.content?.find((block) => block.type === 'text' && block.text);
    if (!textBlock?.text) {
      // The call succeeded but returned nothing usable — the one case
      // where "try a different photo" is the accurate message.
      throw new VisionProviderFailure('genuinely-no-food', 'Vision provider returned an empty response', {
        usage,
      });
    }

    let result: TResult;
    try {
      result = task.parse(textBlock.text);
    } catch (error) {
      throw toMalformedOutputFailure(error, usage);
    }

    return attachScanUsage(result, usage);
  }

  return { runScan };
}
