/**
 * What the AI proxy changes in a chat body before it forwards it (M256/01).
 *
 * WHY THE PROXY TOUCHES THE BODY AT ALL. Until M256 it forwarded the body
 * unchanged, so the CALLER chose the model and the length of the answer. With
 * open sign-up any stranger holds a token, and every instance may share one
 * provider key with a small monthly limit. One caller asking for an expensive
 * model, a huge answer, five answers at once or a paid web search could drain
 * that key and stop AI for every account until the provider's reset. The
 * daily request counters cannot see any of that: they count requests, not
 * what one request costs.
 *
 * THE RULES, every one of them quiet (a body is rewritten, never refused, so
 * a client that sends an extra field is not broken by it):
 *
 *  - AN ALLOW LIST, NOT A DENY LIST (2026-09-30). Only the top-level fields in
 *    {@link ALLOWED_CHAT_FIELDS} are forwarded; every other one is dropped,
 *    and the proxy logs the dropped NAMES (never a value). Until then a short
 *    deny list removed the fields known to multiply a request, and a field
 *    the list did not know yet went through: `tools`, `functions` or a new
 *    provider extension each carry input the provider bills. Inside
 *    `messages`, a message keeps `role`, `content` and `name`, a content part
 *    is `text` or `image_url`, and an `image_url` keeps `url` alone, which
 *    must be a `data:image/` URI (a remote URL or a document behind a data
 *    URI is input nobody measured, see `ai/chat-input-bounds.ts`).
 *  - `model` becomes the instance's model (`AI_ADVERTISED_MODEL`) when the
 *    operator set one. Unset keeps the caller's model: a self-hosted instance
 *    may let its people pick, and that is the operator's call.
 *  - `max_tokens` and `max_completion_tokens` are capped at
 *    `AI_MAX_OUTPUT_TOKENS`. A body with neither gets `max_tokens` written in,
 *    so no answer is unbounded. A value that is not a number (`null`, a
 *    string) is replaced by the ceiling too, because `null` means "no limit".
 *  - `reasoning.max_tokens` is capped at the same ceiling. Reasoning tokens
 *    are billed as output, and this is the one field that asks for them by
 *    count. `reasoning.effort` is kept: it moves where inside the cap the
 *    answer lands, not the cap.
 *  - `n` becomes 1 when it is present: n answers cost n times one.
 *  - On OpenRouter, `provider` is written back as
 *    {@link OPENROUTER_PROVIDER_PREFERENCES}: route only to endpoints that do
 *    not store or train on what they receive (2026-09-28, the pre-launch
 *    privacy audit). A plate photo is a health-adjacent picture of somebody's
 *    meal, and deleting the caller's `provider` field used to delete the only
 *    place that request could have been made. Two OPTIONAL operator settings
 *    tighten it (2026-10-04, M3 spec 02), both off by default: `UPSTREAM_ZDR`
 *    adds `zdr: true` (zero data retention endpoints only) and
 *    `UPSTREAM_PROVIDER_ONLY` adds `only: [slugs]` with `allow_fallbacks:
 *    false` (one named provider, and no quiet fall back to another).
 *    {@link openRouterProviderPreferences} builds the object. The CALLER never
 *    sets any of it: its own `provider` field is replaced, not merged. Any
 *    other upstream gets no `provider` field at all, whatever is set: it is an
 *    OpenRouter extension, and another host would reject or ignore it.
 *
 * The app sends `model`, `messages`, `response_format` and, for a catalog
 * model that reasons by default, `reasoning` (measured in `openplate`'s
 * `app/services/vision/openai-compatible.ts` on 2026-09-30): a system message
 * with string content, and a user message with text parts and at most one
 * `image_url` part carrying only `url`. Nothing it sends is dropped.
 *
 * NOTHING HERE READS A CLOCK, A DATABASE OR AN ENVIRONMENT.
 */
import { asArray, asNumber, asObject, asString, type JsonObject, type JsonValue } from '../lib/json.js';

/**
 * The default for `AI_MAX_OUTPUT_TOKENS`.
 *
 * WHY 8192. The app sends no output cap on the managed path at all; the
 * largest value it sends anywhere is 1536, to Anthropic on a person's own key.
 * Its largest managed answer is a round of three recipes with ingredients and
 * steps, estimated at 2000 to 3000 tokens, and the instance's model may spend
 * part of the cap on reasoning it does by default. 8192 leaves room for both,
 * and at a flash model's price it bounds one request to a few cents.
 */
export const DEFAULT_AI_MAX_OUTPUT_TOKENS = 8192;

/**
 * The top-level fields a forwarded chat body may carry. Everything else is
 * dropped, see the module header. The output fields, `reasoning` and `n` are
 * here because the rules below cap them, and `model` because it is overwritten
 * whenever the instance names one. `provider` is NOT here: it is written back
 * for OpenRouter, never taken from the caller.
 */
export const ALLOWED_CHAT_FIELDS: ReadonlySet<string> = new Set([
  'model',
  'messages',
  'stream',
  'stream_options',
  'temperature',
  'top_p',
  'response_format',
  'max_tokens',
  'max_completion_tokens',
  'reasoning',
  'n',
]);

/** The fields a message keeps. `tool_calls`, `tool_call_id` and the rest are input a tool-free proxy never measured. */
const ALLOWED_MESSAGE_FIELDS: ReadonlySet<string> = new Set(['role', 'content', 'name']);

/**
 * An image the proxy forwards: a base64 data URI of an image type. A remote
 * URL would have the provider fetch something nobody measured, and a data URI
 * of a PDF or a text file is a document the provider may read page by page.
 */
const IMAGE_DATA_URI = /^data:image\/[a-z0-9.+-]+;base64,/i;

/** How many dropped names one log line carries, and how long each may be: a name is caller input too. */
const MAX_LOGGED_DROPPED_FIELDS = 20;
const MAX_LOGGED_FIELD_NAME_LENGTH = 64;

/**
 * OpenRouter's provider preferences for every forwarded body. `data_collection:
 * 'deny'` restricts routing to endpoints whose provider does not store or train
 * on the request; checked live on 2026-09-28 that `google/gemini-3.7-flash`
 * still routes (to Google) under it. This is what an instance with no routing
 * settings sends, byte for byte what it sent before 2026-10-04.
 */
export const OPENROUTER_PROVIDER_PREFERENCES: JsonObject = { data_collection: 'deny' };

/**
 * The operator's two optional routing settings for OpenRouter, already parsed
 * by `config.ts`. Both off is today's behaviour.
 */
export interface OpenRouterRouting {
  /** `UPSTREAM_ZDR`: route only to endpoints with zero data retention (`zdr: true`). */
  zeroDataRetention: boolean;
  /** `UPSTREAM_PROVIDER_ONLY`: provider slugs that may serve a request, or empty for any. */
  onlyProviders: readonly string[];
}

/** The routing of an instance that set neither variable. */
export const NO_OPENROUTER_ROUTING: OpenRouterRouting = { zeroDataRetention: false, onlyProviders: [] };

/**
 * The `provider` object an OpenRouter body carries: the base preferences, plus
 * `zdr: true` when zero retention is on, plus `only` and `allow_fallbacks:
 * false` when providers are pinned. `allow_fallbacks: false` goes with `only`
 * because a pin that falls back to another provider when the first is busy is
 * no pin. Verified against the live API on 2026-10-04: `{"zdr":true,
 * "data_collection":"deny","only":["google-vertex"],"allow_fallbacks":false}`
 * is accepted for `google/gemini-3.7-flash`.
 */
export function openRouterProviderPreferences(routing: OpenRouterRouting): JsonObject {
  const preferences: WritableJsonObject = {};
  if (routing.zeroDataRetention) preferences.zdr = true;
  preferences.data_collection = OPENROUTER_PROVIDER_PREFERENCES.data_collection;
  if (routing.onlyProviders.length > 0) {
    preferences.only = [...routing.onlyProviders];
    preferences.allow_fallbacks = false;
  }
  return preferences;
}

/** Whether the upstream is OpenRouter, which reads the `provider` preferences above. */
export function isOpenRouterUpstream(baseUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    return false;
  }
  return hostname === 'openrouter.ai' || hostname.endsWith('.openrouter.ai');
}

/** The two names OpenAI-compatible APIs read an output cap from. */
const OUTPUT_CAP_FIELDS = ['max_tokens', 'max_completion_tokens'];

/** What the instance decides for every forwarded chat body. */
export interface ChatBodyPolicy {
  /** `AI_ADVERTISED_MODEL`, or `null` to keep the caller's model. */
  model: string | null;
  /** `AI_MAX_OUTPUT_TOKENS`: the most output tokens one request may ask for. */
  maxOutputTokens: number;
}

/** A JSON object this module builds and may still write to. */
interface WritableJsonObject {
  [key: string]: JsonValue | undefined;
}

/** A requested output count, or the ceiling when it is above the ceiling or not a number. */
function capTokenCount(input: { requested: JsonValue | undefined; ceiling: number }): number {
  const requested = asNumber(input.requested);
  if (requested === null || requested > input.ceiling) return input.ceiling;
  return requested;
}

/** Caps each output field the body names, or writes `max_tokens` when it names none. */
function capOutputTokens(input: { body: WritableJsonObject; ceiling: number }): void {
  const named = OUTPUT_CAP_FIELDS.filter((field) => input.body[field] !== undefined);
  if (named.length === 0) {
    input.body.max_tokens = input.ceiling;
    return;
  }
  for (const field of named) {
    input.body[field] = capTokenCount({ requested: input.body[field], ceiling: input.ceiling });
  }
}

/** Caps `reasoning.max_tokens` when the body asks for a reasoning budget by count. */
function capReasoningBudget(input: { body: WritableJsonObject; ceiling: number }): void {
  const reasoning = asObject(input.body.reasoning);
  if (reasoning === null || reasoning.max_tokens === undefined) return;
  input.body.reasoning = {
    ...reasoning,
    max_tokens: capTokenCount({ requested: reasoning.max_tokens, ceiling: input.ceiling }),
  };
}

/** One content part as forwarded, or `null` when it is dropped. */
function allowContentPart(value: JsonValue): JsonObject | null {
  const part = asObject(value);
  if (part === null) return null;
  const type = asString(part.type);
  if (type === 'text') {
    const text = asString(part.text);
    return text === null ? null : { type: 'text', text };
  }
  if (type === 'image_url') {
    const url = asString(asObject(part.image_url)?.url);
    if (url === null || !IMAGE_DATA_URI.test(url)) return null;
    return { type: 'image_url', image_url: { url } };
  }
  return null;
}

/**
 * One message as forwarded, or `null` when it is not an object. `content` is
 * kept when it is a string or a list of parts; any other value is dropped, so
 * nothing unmeasured rides in it.
 */
function allowMessage(value: JsonValue): JsonObject | null {
  const message = asObject(value);
  if (message === null) return null;
  const allowed: WritableJsonObject = {};
  const role = asString(message.role);
  if (role !== null) allowed.role = role;
  const name = asString(message.name);
  if (name !== null) allowed.name = name;
  const text = asString(message.content);
  const parts = asArray(message.content);
  if (text !== null) allowed.content = text;
  if (parts !== null) {
    allowed.content = parts.map(allowContentPart).filter((part): part is JsonObject => part !== null);
  }
  return allowed;
}

/** The messages as forwarded: each one through {@link allowMessage}, and non-objects dropped. */
function allowMessages(value: JsonValue | undefined): JsonValue[] | undefined {
  const messages = asArray(value);
  if (messages === null) return undefined;
  return messages.map(allowMessage).filter((message): message is JsonObject => message !== null);
}

/** Collects what one message loses to the allow list, as `message.<field>`, `part.<type>` and `image_url.<field>`. */
function collectDroppedInMessage(input: { value: JsonValue; dropped: Set<string> }): void {
  const message = asObject(input.value);
  if (message === null) {
    input.dropped.add('message.<not an object>');
    return;
  }
  for (const field of Object.keys(message)) {
    if (!ALLOWED_MESSAGE_FIELDS.has(field)) input.dropped.add(`message.${field}`);
  }
  for (const value of asArray(message.content) ?? []) {
    const part = asObject(value);
    const type = asString(part?.type) ?? '<untyped>';
    const imageUrl = asObject(part?.image_url);
    for (const field of Object.keys(imageUrl ?? {})) {
      if (field !== 'url') input.dropped.add(`image_url.${field}`);
    }
    if (allowContentPart(value) === null) input.dropped.add(`part.${type}`);
  }
}

/**
 * The NAMES of what {@link applyChatBodyPolicy} drops from this body, for the
 * proxy's log line: top-level fields as they are, and inside `messages` as
 * `message.<field>`, `part.<type>` and `image_url.<field>`. Never a value.
 *
 * A NAME IS CALLER INPUT TOO, so each is cut to 64 characters and the list to
 * 20 entries: a key made of a photograph must not reach a log line whole.
 * A caller's `provider` field is not listed: on OpenRouter it is written
 * back rather than dropped, and elsewhere a client that sends it did nothing
 * wrong (it is dropped all the same).
 */
export function listDroppedChatFields(body: JsonObject): string[] {
  const dropped = new Set<string>();
  for (const field of Object.keys(body)) {
    if (!ALLOWED_CHAT_FIELDS.has(field) && field !== 'provider') dropped.add(field);
  }
  for (const message of asArray(body.messages) ?? []) collectDroppedInMessage({ value: message, dropped });
  return [...dropped].slice(0, MAX_LOGGED_DROPPED_FIELDS).map((name) => name.slice(0, MAX_LOGGED_FIELD_NAME_LENGTH));
}

/**
 * The body the provider receives, built from the body the caller sent.
 *
 * A NEW OBJECT: the caller's body is not changed, so the proxy's own log
 * fields (streaming or not) still read what was asked for.
 *
 * @param input.body - the parsed request body, already proved to be an object.
 * @param input.policy - the instance's model and output ceiling.
 * @param input.upstreamBaseUrl - where the body goes, which decides the `provider` preferences.
 * @param input.openRouterRouting - the operator's optional zero retention and provider pin; read for an OpenRouter host only.
 * @returns the body to serialise and forward.
 */
export function applyChatBodyPolicy(input: {
  body: JsonObject;
  policy: ChatBodyPolicy;
  /** The upstream the body goes to; OpenRouter gets {@link OPENROUTER_PROVIDER_PREFERENCES}. */
  upstreamBaseUrl?: string;
  /** Absent means today's preferences, `data_collection: 'deny'` alone. Ignored for any other upstream. */
  openRouterRouting?: OpenRouterRouting;
}): JsonObject {
  const rewritten: WritableJsonObject = Object.fromEntries(
    Object.entries(input.body).filter(([field]) => ALLOWED_CHAT_FIELDS.has(field)),
  );
  if (rewritten.messages !== undefined) rewritten.messages = allowMessages(rewritten.messages);
  if (input.upstreamBaseUrl !== undefined && isOpenRouterUpstream(input.upstreamBaseUrl)) {
    rewritten.provider = openRouterProviderPreferences(input.openRouterRouting ?? NO_OPENROUTER_ROUTING);
  }
  if (input.policy.model !== null) rewritten.model = input.policy.model;
  capOutputTokens({ body: rewritten, ceiling: input.policy.maxOutputTokens });
  capReasoningBudget({ body: rewritten, ceiling: input.policy.maxOutputTokens });
  if (rewritten.n !== undefined) rewritten.n = 1;
  return rewritten;
}
