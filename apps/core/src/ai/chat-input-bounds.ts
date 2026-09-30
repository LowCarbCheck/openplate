/**
 * What one proxied chat body may carry INTO the model, and what it weighs
 * against the daily counters (2026-09-30).
 *
 * WHY. `ai/chat-body-policy.ts` caps what one request may cost on the way
 * OUT: the answer, the reasoning, the number of answers. Nothing bounded the
 * way IN. The production model reads about a million tokens, and one request
 * under the byte limit could carry most of them: at $0.75 per million input
 * tokens that is about 80 cents for one request, and the daily counters
 * counted it as one request like every plate photograph. So two things live
 * here, both measured on the body AFTER the allow list, which is the body the
 * provider receives:
 *
 *  1. A BOUND. More than `AI_MAX_IMAGE_PARTS` images, more than
 *     `AI_MAX_TEXT_BYTES` of text, or more than `AI_MAX_MESSAGES` messages is
 *     refused with `400 ai-request-too-large`, before any claim, reservation
 *     or upstream call. A refusal, not a rewrite: cutting a person's words or
 *     a photograph would send the model a different question.
 *  2. A WEIGHT. A request reserves `max(1, ceil(estimated input tokens /
 *     AI_UNIT_INPUT_TOKENS))` units of the account's daily allowance and of
 *     the instance ceilings, so the counters see size and not only count.
 *
 * THE DEFAULTS ARE THE APP'S LARGEST REAL REQUEST (measured in `openplate`'s
 * `app/services/vision/` on 2026-09-30, all six languages): the plate scan,
 * two messages, one image, 9.4 KB of message text and a 2.8 KB
 * `response_format` schema. The text intake is 6.4 KB plus what the person
 * typed, the recipe proposal 4.4 KB plus one line per pantry item. So one
 * image, exactly the app's maximum; four messages, twice its two; and 48 KB of
 * text, room for the schema, the prompt and some 35 KB that a person typed or
 * a pantry listed. A plate scan then estimates at about 4,500 tokens, weight 1.
 *
 * TEXT INCLUDES `response_format`. A JSON schema is input the model reads,
 * and a field the proxy forwards without counting is a field that carries a
 * megabyte of prompt past this bound.
 *
 * NOTHING HERE READS A CLOCK, A DATABASE OR AN ENVIRONMENT.
 */
import { asArray, asObject, asString, type JsonObject } from '../lib/json.js';

/** What the instance lets one request carry in, and what one unit of the daily counters is worth. */
export interface ChatInputPolicy {
  /** `AI_MAX_IMAGE_PARTS`: the most `image_url` parts one request may carry. */
  maxImageParts: number;
  /** `AI_MAX_TEXT_BYTES`: the most UTF-8 bytes of text, message text plus `response_format`, one request may carry. */
  maxTextBytes: number;
  /** `AI_MAX_MESSAGES`: the most messages one request may carry. */
  maxMessages: number;
  /** `AI_UNIT_INPUT_TOKENS`: the estimated input tokens one unit of the daily counters covers. */
  unitInputTokens: number;
  /** `AI_IMAGE_INPUT_TOKENS`: the input tokens one image is estimated at, whatever its size. */
  imageInputTokens: number;
}

/** The default for `AI_MAX_IMAGE_PARTS`: the app sends one photograph per request. */
export const DEFAULT_AI_MAX_IMAGE_PARTS = 1;

/** The default for `AI_MAX_TEXT_BYTES`: the app's largest fixed text is 12.2 KB, see the module header. */
export const DEFAULT_AI_MAX_TEXT_BYTES = 48 * 1024;

/** The default for `AI_MAX_MESSAGES`: the app sends a system message and a user message. */
export const DEFAULT_AI_MAX_MESSAGES = 4;

/**
 * The default for `AI_UNIT_INPUT_TOKENS`. A plate scan estimates at about
 * 4,500 tokens and a text intake at 2,000 to 4,000, so both weigh one unit;
 * a request near the 48 KB text bound weighs two.
 */
export const DEFAULT_AI_UNIT_INPUT_TOKENS = 8192;

/**
 * The default for `AI_IMAGE_INPUT_TOKENS`. The instance's model bills an image
 * by resolution tiers and not by bytes, about 1,100 tokens at its highest; 1500
 * leaves room for a model that bills a little more.
 */
export const DEFAULT_AI_IMAGE_INPUT_TOKENS = 1500;

/** Every default above, for the wiring and the tests. */
export const DEFAULT_CHAT_INPUT_POLICY: ChatInputPolicy = {
  maxImageParts: DEFAULT_AI_MAX_IMAGE_PARTS,
  maxTextBytes: DEFAULT_AI_MAX_TEXT_BYTES,
  maxMessages: DEFAULT_AI_MAX_MESSAGES,
  unitInputTokens: DEFAULT_AI_UNIT_INPUT_TOKENS,
  imageInputTokens: DEFAULT_AI_IMAGE_INPUT_TOKENS,
};

/** The refusal for a body over one of the bounds. The body names which one and its value. */
export const AI_REQUEST_TOO_LARGE = 'ai-request-too-large';

/** Which bound a refused body crossed, as the refusal's `limit` field names it. */
export type ChatInputLimit = 'image-parts' | 'text-bytes' | 'messages';

/** What one body carries in, counted on the body the provider receives. */
export interface ChatInputSize {
  imageParts: number;
  textBytes: number;
  messages: number;
}

/** The characters of text one token is estimated at. A rough figure, and the one the weight needs. */
const BYTES_PER_TOKEN = 4;

/** Counts one message's text bytes and image parts into `size`. */
function addMessage(input: { size: ChatInputSize; message: JsonObject }): void {
  const { size, message } = input;
  size.textBytes += Buffer.byteLength(asString(message.name) ?? '', 'utf8');
  size.textBytes += Buffer.byteLength(asString(message.content) ?? '', 'utf8');
  for (const value of asArray(message.content) ?? []) {
    const part = asObject(value);
    if (part === null) continue;
    size.textBytes += Buffer.byteLength(asString(part.text) ?? '', 'utf8');
    if (asString(part.type) === 'image_url') size.imageParts += 1;
  }
}

/**
 * What a body carries in: its messages, their text in UTF-8 bytes (plus a
 * serialised `response_format`), and their `image_url` parts.
 *
 * @param body - the body AFTER `applyChatBodyPolicy`, which is what is billed.
 */
export function measureChatInput(body: JsonObject): ChatInputSize {
  const messages = asArray(body.messages) ?? [];
  const size: ChatInputSize = { imageParts: 0, textBytes: 0, messages: messages.length };
  for (const value of messages) {
    const message = asObject(value);
    if (message !== null) addMessage({ size, message });
  }
  if (body.response_format !== undefined) {
    size.textBytes += Buffer.byteLength(JSON.stringify(body.response_format), 'utf8');
  }
  return size;
}

/** The first bound a body crosses, with the bound's value, or `null` when it crosses none. */
export function findExceededInputLimit(input: {
  size: ChatInputSize;
  policy: ChatInputPolicy;
}): { limit: ChatInputLimit; max: number } | null {
  const { size, policy } = input;
  if (size.imageParts > policy.maxImageParts) return { limit: 'image-parts', max: policy.maxImageParts };
  if (size.textBytes > policy.maxTextBytes) return { limit: 'text-bytes', max: policy.maxTextBytes };
  if (size.messages > policy.maxMessages) return { limit: 'messages', max: policy.maxMessages };
  return null;
}

/** The input tokens a body is estimated at before the call: text bytes over four, plus a fixed figure per image. */
export function estimateInputTokens(input: { size: ChatInputSize; policy: ChatInputPolicy }): number {
  return Math.ceil(input.size.textBytes / BYTES_PER_TOKEN) + input.size.imageParts * input.policy.imageInputTokens;
}

/**
 * The units one request reserves: `max(1, ceil(estimated input tokens /
 * AI_UNIT_INPUT_TOKENS))`. Never below one, so an empty body still counts as
 * the request it is.
 */
export function requestWeight(input: { size: ChatInputSize; policy: ChatInputPolicy }): number {
  return Math.max(1, Math.ceil(estimateInputTokens(input) / input.policy.unitInputTokens));
}
