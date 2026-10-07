/**
 * What one proxied chat body may carry INTO the model (2026-09-30), and what
 * it counts against the AI limits (one, since 2026-10-07).
 *
 * WHY. `ai/chat-body-policy.ts` caps what one request may cost on the way
 * OUT: the answer, the reasoning, the number of answers. Nothing bounded the
 * way IN. The production model reads about a million tokens, and one request
 * under the byte limit could carry most of them: at the input price recorded
 * in `ai-tiers.json` (`price.inputUsdPerMillion`) that is real money for one
 * request, and the daily counters counted it as one request like every plate
 * photograph. So two things live
 * here, the bound measured on the body AFTER the allow list, which is the
 * body the provider receives:
 *
 *  1. A BOUND. More than `AI_MAX_IMAGE_PARTS` images, more than
 *     `AI_MAX_TEXT_BYTES` of text, or more than `AI_MAX_MESSAGES` messages is
 *     refused with `400 ai-request-too-large`, before any claim, reservation
 *     or upstream call. A refusal, not a rewrite: cutting a person's words or
 *     a photograph would send the model a different question.
 *  2. A WEIGHT OF ONE. Every request that passes the bound reserves exactly
 *     {@link REQUEST_WEIGHT} unit of the account's allowance and of every
 *     instance ceiling, whatever its size. Decided by the owner on
 *     2026-10-07: one action a person starts is one scan, because the number
 *     a plan advertises ("20 AI scans a week") must be the number a person
 *     can count. Until then a request weighed `max(1, ceil(estimated input
 *     tokens / AI_UNIT_INPUT_TOKENS))`, so a long text or a large pantry list
 *     could take two. The BOUND above is now the only guard on size: a body
 *     over it is refused and costs nothing, and a body under it is one.
 *
 * THE DEFAULTS ARE THE APP'S LARGEST REAL REQUEST (measured in `openplate`'s
 * `app/services/vision/` on 2026-10-06 from the committed vision contract, all
 * six languages within 3 bytes of each other): the plate scan, two messages,
 * one image, 12.2 KB of message text (the 2026-09-30 figure was 9.4 KB, before
 * the food flags grew) and a 2.7 KB `response_format` schema, 14.9 KB in all.
 * The text intake is 8.4 KB plus what the person typed, the recipe proposal
 * 4.3 KB plus one line per pantry item. So one image, exactly the app's
 * maximum; four messages, twice its two; and 48 KB of text, room for the
 * schema, the prompt and some 33 KB that a person typed or a pantry listed.
 *
 * TEXT INCLUDES `response_format`. A JSON schema is input the model reads,
 * and a field the proxy forwards without counting is a field that carries a
 * megabyte of prompt past this bound.
 *
 * NOTHING HERE READS A CLOCK, A DATABASE OR AN ENVIRONMENT.
 */
import { asArray, asObject, asString, type JsonObject } from '../lib/json.js';

/** What the instance lets one request carry in. */
export interface ChatInputPolicy {
  /** `AI_MAX_IMAGE_PARTS`: the most `image_url` parts one request may carry. */
  maxImageParts: number;
  /** `AI_MAX_TEXT_BYTES`: the most UTF-8 bytes of text, message text plus `response_format`, one request may carry. */
  maxTextBytes: number;
  /** `AI_MAX_MESSAGES`: the most messages one request may carry. */
  maxMessages: number;
}

/** The default for `AI_MAX_IMAGE_PARTS`: the app sends one photograph per request. */
export const DEFAULT_AI_MAX_IMAGE_PARTS = 1;

/** The default for `AI_MAX_TEXT_BYTES`: the app's largest fixed text is 14.9 KB, see the module header. */
export const DEFAULT_AI_MAX_TEXT_BYTES = 48 * 1024;

/** The default for `AI_MAX_MESSAGES`: the app sends a system message and a user message. */
export const DEFAULT_AI_MAX_MESSAGES = 4;

/** Every default above, for the wiring and the tests. */
export const DEFAULT_CHAT_INPUT_POLICY: ChatInputPolicy = {
  maxImageParts: DEFAULT_AI_MAX_IMAGE_PARTS,
  maxTextBytes: DEFAULT_AI_MAX_TEXT_BYTES,
  maxMessages: DEFAULT_AI_MAX_MESSAGES,
};

/**
 * The units one request reserves on the account's allowance and on every
 * instance ceiling, and gives back wherever a unit is given back: ONE, for
 * any body the bound let through (owner decision, 2026-10-07). A refused
 * body reserves nothing.
 */
export const REQUEST_WEIGHT = 1;

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
