/**
 * Reads what one completion cost, off the response as it passes by.
 *
 * WHY IT EXISTS. The proxy pipes the provider's answer straight out through a
 * byte counter and never looks inside, so the operator knew how many requests
 * were made and nothing about what they cost. A provider that reports usage
 * (OpenRouter does, with a price in dollars) puts it in the answer: this tap
 * reads those few numbers and hands them back when the answer has ended.
 *
 * ── IT CHANGES NOTHING ABOUT THE RELAY ──────────────────────────────────────
 * Every chunk is passed on the moment it arrives, byte for byte. The tap is a
 * `Transform` that calls `push` first and looks second, so a streaming answer
 * is not held back and an answer in a shape nobody has heard of still passes
 * through unchanged. It never throws: a body it cannot read is a result of
 * `null`s, and the relay goes on.
 *
 * ── IT KEEPS NUMBERS AND ONE SHORT NAME, NEVER THE BODY ─────────────────────
 * The answer is a description of somebody's meal, so it is never stored and
 * never logged (hard rule 2 of `ai/proxy.ts`, and the photo path guard). What
 * leaves this module is three non-negative numbers and a model name that has
 * to look like a model name (`SAFE_MODEL_NAME`); anything else is `null`. The
 * text of the answer is parsed in memory and dropped.
 *
 * ── BOUNDED, SO A HUGE ANSWER IS NOT A MEMORY BILL ──────────────────────────
 * A JSON answer is buffered up to {@link MAX_JSON_BYTES}; a longer one is not
 * read, and its usage is `null`. A server-sent stream is read line by line and
 * a line longer than {@link MAX_SSE_LINE_BYTES} is skipped, so the tap never
 * holds more than one line of an arbitrarily long stream.
 *
 * THE UNIT. `usage.cost` is dollars, a float. It is stored and logged in MICRO
 * dollars, a whole number, so a day's sum is exact.
 */
import { StringDecoder } from 'node:string_decoder';
import { Transform } from 'node:stream';
import { asNumber, asObject, asString, type JsonObject, type JsonValue } from '../lib/json.js';

/** The most of a JSON answer the tap buffers. A scan answer is a few kilobytes. */
export const MAX_JSON_BYTES = 1024 * 1024;

/** The longest server-sent line the tap reads. A longer one carries no usage a provider would put on one line. */
export const MAX_SSE_LINE_BYTES = 64 * 1024;

/** A model name worth logging: letters, digits and the punctuation model names use, at most 64 characters. */
const SAFE_MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,63}$/;

/** The sanity ceiling on a token count. Anything above it is a field that is not what it claims to be. */
const MAX_TOKEN_COUNT = 1_000_000_000;

/** The sanity ceiling on one answer's cost, in dollars. */
const MAX_COST_USD = 1000;

/** A line worth parsing in a stream: it carries a `usage` object. */
const USAGE_OBJECT_PATTERN = /"usage"\s*:\s*\{/;

/** What was read off one answer. `null` is "the answer did not say", never zero. */
export interface CompletionUsage {
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  /** The provider's price for the answer, in micro dollars (a millionth of a dollar). */
  costMicroUsd: number | null;
}

export const NO_COMPLETION_USAGE: CompletionUsage = {
  model: null,
  promptTokens: null,
  completionTokens: null,
  costMicroUsd: null,
};

export interface UsageTap {
  /** Put this in the pipeline. It passes every chunk on unchanged. */
  stream: Transform;
  /** What was read, valid once the stream has ended. Never throws. */
  result(): CompletionUsage;
}

function readTokenCount(value: JsonValue | undefined): number | null {
  const count = asNumber(value);
  if (count === null || !Number.isInteger(count) || count < 0 || count > MAX_TOKEN_COUNT) return null;
  return count;
}

function readCostMicroUsd(value: JsonValue | undefined): number | null {
  const dollars = asNumber(value);
  if (dollars === null || !Number.isFinite(dollars) || dollars < 0 || dollars > MAX_COST_USD) return null;
  return Math.round(dollars * 1_000_000);
}

function readModel(value: JsonValue | undefined): string | null {
  const model = asString(value);
  return model !== null && SAFE_MODEL_NAME.test(model) ? model : null;
}

/** The usage fields of one parsed object: a whole completion, or one chunk of a stream. Only what it says. */
export function readUsageFields(parsed: JsonObject): CompletionUsage {
  const usage = asObject(parsed.usage);
  return {
    model: readModel(parsed.model),
    promptTokens: usage === null ? null : readTokenCount(usage.prompt_tokens),
    completionTokens: usage === null ? null : readTokenCount(usage.completion_tokens),
    costMicroUsd: usage === null ? null : readCostMicroUsd(usage.cost),
  };
}

/** Parses JSON text to an object, or `null` for anything that is not one. Never throws. */
function parseObject(text: string): JsonObject | null {
  try {
    // SAFETY: `JSON.parse` returns JSON by construction; `asObject` re-establishes
    // that at the type level and yields `null` for anything that is not an object.
    return asObject(JSON.parse(text) as JsonValue);
  } catch {
    return null;
  }
}

/** Later values win for the numbers, and the first name stays: every chunk of a stream repeats the model. */
function mergeUsage(current: CompletionUsage, next: CompletionUsage): CompletionUsage {
  return {
    model: current.model ?? next.model,
    promptTokens: next.promptTokens ?? current.promptTokens,
    completionTokens: next.completionTokens ?? current.completionTokens,
    costMicroUsd: next.costMicroUsd ?? current.costMicroUsd,
  };
}

/**
 * @param input.isEventStream - whether the answer is `text/event-stream`, which is read line by line; anything else is one JSON document.
 */
export function createUsageTap(input: { isEventStream: boolean }): UsageTap {
  let usage: CompletionUsage = NO_COMPLETION_USAGE;

  // ── JSON ────────────────────────────────────────────────────────────────
  const jsonChunks: Buffer[] = [];
  let jsonBytes = 0;
  let isJsonOverflow = false;

  // ── Server-sent events ──────────────────────────────────────────────────
  const decoder = new StringDecoder('utf8');
  let partialLine = '';
  let isSkippingLongLine = false;

  function readLine(rawLine: string): void {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') return;
    // Parse the first data line for the model, and any line that carries a
    // usage object: a stream of a thousand chunks costs a thousand parses
    // otherwise, for numbers that arrive once.
    if (usage.model !== null && !USAGE_OBJECT_PATTERN.test(payload)) return;
    const parsed = parseObject(payload);
    if (parsed !== null) usage = mergeUsage(usage, readUsageFields(parsed));
  }

  function readText(text: string): void {
    const lines = (partialLine + text).split('\n');
    // The last piece has no newline yet: it is the start of the next line.
    partialLine = lines.pop() ?? '';
    for (const line of lines) {
      if (isSkippingLongLine) {
        // The end of a line that was too long: skipped, and the next one is read.
        isSkippingLongLine = false;
        continue;
      }
      readLine(line);
    }
    if (partialLine.length > MAX_SSE_LINE_BYTES) {
      partialLine = '';
      isSkippingLongLine = true;
    }
  }

  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback): void {
      // PASSED ON FIRST. Nothing below may delay, change or drop a byte.
      callback(null, chunk);
      try {
        if (input.isEventStream) {
          readText(decoder.write(chunk));
          return;
        }
        if (isJsonOverflow) return;
        jsonBytes += chunk.byteLength;
        if (jsonBytes > MAX_JSON_BYTES) {
          isJsonOverflow = true;
          jsonChunks.length = 0;
          return;
        }
        jsonChunks.push(chunk);
      } catch {
        // A tap that throws would fail the relay it only watches. The numbers
        // it could not read stay `null`.
      }
    },
    flush(callback): void {
      callback();
    },
  });

  return {
    stream,
    result(): CompletionUsage {
      try {
        if (input.isEventStream) {
          // A final line that ended without a newline.
          readText(`${decoder.end()}\n`);
          return usage;
        }
        if (isJsonOverflow || jsonChunks.length === 0) return usage;
        const parsed = parseObject(Buffer.concat(jsonChunks).toString('utf8'));
        return parsed === null ? usage : readUsageFields(parsed);
      } catch {
        return usage;
      }
    },
  };
}
