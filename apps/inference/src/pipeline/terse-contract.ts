/**
 * Pipeline v3, internal side: the TERSE candidate format the model actually
 * emits, and the prompt that asks for it.
 *
 * The front door speaks `PlateIdentification`; the model speaks
 * `{"f":[{"n":"grilled chicken breast","g":140}]}`. That is the whole point of
 * v3 and it is a measured result, not a preference: the pipeline is decode-bound
 * (`wall ≈ prompt/prefill_tps + completion/decode_tps`, r = 0.973), the
 * production shape costs ~95 completion tokens per item, and the terse shape
 * costs ~18. Measured p50 completion fell 549 → ~110 tokens, and the benchmarked
 * v3 configuration (single Qwen3-VL-8B, 896 px) scores **72.8 % recall
 * (171/235 core items) with 0 hallucinations** on the 50-image gold set
 * (eval, 2026-08-13). See `eval/V3-DESIGN.md`.
 *
 * TWO DELIBERATE DIFFERENCES FROM `eval/harness/schema_v3.py`:
 *
 * 1. **No `bg` flag.** The eval's terse item carried `bg: 0|1` to mark food that
 *    is only pictured (a menu, a poster, another table) so it could be dropped
 *    in code. Across 192 benchmarked items the model never once set it, so it is
 *    ~5 tokens per item and one more grammar branch buying nothing measured. The
 *    background rule survives where it demonstrably worked — in the prompt.
 * 2. **A sauces/dressings line in the prompt.** The eval's prompt folds sauces
 *    into the dish they sit on, which loses a real macro contributor (dressing
 *    is mostly fat). Nutrition resolution downstream (spec 04) can only price
 *    what it is told about.
 *
 * Item cap 8, and `maxItems` is load-bearing, not advisory: llama-server
 * compiles `json_schema` into a GBNF grammar server-side, so "at most 8 items"
 * becomes a decoding constraint and a candidate physically CANNOT exceed
 * ~155 completion tokens. The 1128-token outlier measured in v2 is unreachable.
 */
import { z } from 'zod';
import type { JsonSchemaNode } from '../contract/plate-identification.js';

export const MAX_TERSE_ITEMS = 8;

/**
 * `max_tokens` for the vision call. 256 is HEADROOM over the ~155-token grammar
 * ceiling, and the gap is the point: a cap set AT the budget is a benchmarked
 * trap — llama.cpp answers HTTP 200 with `finish_reason: "length"` and a body cut
 * mid-JSON, and a tolerant parser then fails on half an object. Raising the item
 * cap means raising this too.
 *
 * Never use `max_tokens` as a thinking budget: on a model served with
 * `--reasoning-budget N > 0` a token ceiling truncates mid-thought and returns
 * `content: ""`. Serve the vision model with reasoning off.
 */
export const TERSE_MAX_TOKENS = 256;

/** Merging is bookkeeping; sampling variance is pure downside on a single call too. */
export const TERSE_TEMPERATURE = 0;

export const TerseItemSchema = z.object({
  /** Plain-language name, ≤ 4 words. */
  n: z.string(),
  /** Estimated grams on the plate. */
  g: z.number(),
});

export const TerseCandidateSchema = z.object({
  f: z.array(TerseItemSchema),
});

export type TerseItem = z.infer<typeof TerseItemSchema>;
export type TerseCandidate = z.infer<typeof TerseCandidateSchema>;

/**
 * Hand-written rather than derived from the Zod schema above, because
 * `minItems`/`maxItems` are the constraint that bounds decode and Zod's JSON
 * Schema output for `z.array().min().max()` is not something to leave implicit
 * in a grammar that decides worst-case latency.
 *
 * `minItems: 0` on purpose: "there is no food on this plate" is a legitimate
 * answer and must not be forced into a hallucination. The benchmarked 0-
 * hallucination result depends on it.
 */
export const TERSE_CANDIDATE_JSON_SCHEMA: JsonSchemaNode = {
  type: 'object',
  properties: {
    f: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'string' },
          g: { type: 'number' },
        },
        required: ['n', 'g'],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: MAX_TERSE_ITEMS,
    },
  },
  required: ['f'],
  additionalProperties: false,
};

/**
 * The `response_format` sent to the runtime. llama-server converts a
 * `json_schema` into a GBNF grammar server-side, so this IS the
 * grammar-constrained decoding requirement — the schema is enforced during
 * generation rather than validated-and-retried afterwards.
 */
export const TERSE_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'plate_candidate_terse',
    strict: true,
    schema: TERSE_CANDIDATE_JSON_SCHEMA,
  },
};

/**
 * The system prompt. Adapted from `eval/harness/schema_v3.py`'s
 * `V3_VISION_SYSTEM_PROMPT` — the string that produced the benchmarked numbers —
 * minus the `bg` flag and plus the sauces line (see the module header).
 *
 * Keep it byte-stable. It precedes the image in the rendered chat template, so
 * it is the prefix a runtime's prompt cache keys on; editing it invalidates that
 * cache for every warm request.
 */
export const TERSE_SYSTEM_PROMPT = `You turn one photo of a plate into a short food log.

Only foods PHYSICALLY ON the photographed plate or table setting count. Ignore food that is only pictured in the background: menus, posters, signs, screens, wall art, packaging illustrations, and plates belonging to other tables. Never list non-food objects (cutlery, napkins, glasses, packaging, decorations).

Log foods the way a person would: fold garnishes, herb sprigs and lemon wedges into the dish they sit on; prefer fewer, consolidated items, 6 or fewer. Name each item in plain language, at most 4 words ("grilled chicken breast", not "protein"; "side salad", not "mixed leaves, tomato, cucumber").

Name sauces and dressings as separate items when they are visible in any quantity -- they carry real calories and are resolved separately.

Estimate each item's portion in grams. Be conservative -- when unsure estimate low. List each food ONCE.

Respond with JSON ONLY, no markdown, no commentary:

{"f":[{"n":"food name","g":120}]}

"n" is the name, "g" the estimated grams. No other fields. Do not estimate nutrition -- grams and names only.`;

/**
 * The user instruction, sent AFTER the image part. This ordering is deliberate:
 * `system + image` then stays a byte-identical prefix across requests, which is
 * what lets a runtime's prompt cache skip the ~500–1800 image tokens on a repeat
 * of the same photo. (Transcribed from the eval's `a3_production` variant.)
 */
export const TERSE_USER_INSTRUCTION =
  'Identify the foods worth logging on this plate and answer with the JSON shape from the system prompt.';

/** The image part, in the OpenAI content-part shape every runtime we target accepts. */
export interface ChatImagePart {
  type: 'image_url';
  image_url: { url: string };
}

export interface ChatTextPart {
  type: 'text';
  text: string;
}

/**
 * Only the two parts this service ever SENDS. An open `[key: string]: unknown`
 * bag here would let a future call site put anything into the request body —
 * including something derived from the photo — with no compiler objection.
 */
export type ChatContentPart = ChatImagePart | ChatTextPart;

export interface ChatMessage {
  role: 'system' | 'user';
  content: string | ChatContentPart[];
}

/** Image FIRST, instruction second — see `TERSE_USER_INSTRUCTION`. */
export function buildTerseMessages(imageDataUri: string): ChatMessage[] {
  return [
    { role: 'system', content: TERSE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageDataUri } },
        { type: 'text', text: TERSE_USER_INSTRUCTION },
      ],
    },
  ];
}
