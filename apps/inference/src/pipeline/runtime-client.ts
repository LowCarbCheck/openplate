/**
 * The model-runtime boundary: one client speaking OpenAI-compatible chat
 * completions to llama.cpp's `llama-server` (or vLLM), addressed by config.
 *
 * GRAMMAR-CONSTRAINED DECODING LIVES HERE. The request carries
 * `response_format: {type: 'json_schema', ...}`; llama-server compiles that into
 * a GBNF grammar server-side and constrains generation with it. That is what
 * makes the terse shape structurally guaranteed rather than hoped for, and it is
 * why there is no parse-and-retry loop below: a retry loop would be a second,
 * weaker correctness mechanism papering over a first one that stopped working.
 * If the body does not parse, something is wrong with the runtime (grammar
 * silently dropped, wrong model, truncation) and a 502 saying so is more useful
 * than a slower answer.
 *
 * THE COMPLETION CALL IS BOUNDED, AND WE CHOOSE THE BOUND. It always was: Node's
 * global `fetch` applies a default `headersTimeout` of 300 s, and since every
 * target runtime buffers a non-streaming completion and writes headers only when
 * generation finishes, time-to-headers IS total duration — a 300 s total cap
 * nobody picked, low enough to kill a legitimately slow CPU plate. (An earlier
 * version of this comment claimed there was no timeout. There was.) So the call
 * goes through undici's own `fetch` with a dispatcher we configure from
 * `RUNTIME_COMPLETION_TIMEOUT_MS` (default 600 s, `0` disables). `undici` is a
 * declared dependency for exactly this: it is the library Node's `fetch` already
 * runs on, and `AbortSignal.timeout` can only ADD a cap, never raise the implicit
 * one underneath.
 *
 * IT IS A LIVENESS BACKSTOP, NOT A LATENCY POLICY. Bounding how long a scan is
 * ALLOWED to take is the admission controller's job (`server/admission.ts`,
 * `LATENCY_CEILING_MS`), which sheds load BEFORE accepting work it cannot finish
 * in time. This bound exists because an in-flight call that never returns holds a
 * worker slot forever: with `CONCURRENCY=2`, two wedged scans brick the service
 * while `/readyz` stays green, since the probes hit a different endpoint. It is
 * ~60× the hosted latency policy on purpose.
 *
 * On the wire a thinking runtime and a mute one are identical — an open socket
 * delivering zero bytes — so without streaming, hung and slow are not separable,
 * only boundable. `/health` does get a short timeout of its own — a readiness
 * probe that hangs is a readiness probe that lies.
 */
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from 'undici';
import { DEFAULT_RUNTIME_COMPLETION_TIMEOUT_MS } from '../config.js';
import { upstreamFailure } from '../errors.js';
import {
  TERSE_MAX_TOKENS,
  TERSE_RESPONSE_FORMAT,
  TERSE_TEMPERATURE,
  TerseCandidateSchema,
  buildTerseMessages,
  type TerseCandidate,
} from './terse-contract.js';

const HEALTH_TIMEOUT_MS = 2000;

/**
 * How many consecutive `/v1/models` failures undo the cached choice and send the
 * next probe back to `/health`.
 *
 * 3 because `/readyz` is polled by Docker's HEALTHCHECK every 30 s: three misses
 * is ~90 s of an upstream that has stopped answering the endpoint it was
 * resolved to, which is cheap to spend one extra 2 s probe on, while a single
 * blip (a restart, a dropped connection) does not throw away a resolution that
 * is still correct. It also bounds the wrong-forever case: if the URL is
 * repointed at a `/health`-speaking runtime, the cache re-resolves within ~1.5
 * minutes instead of never.
 */
const FALLBACK_FAILURES_BEFORE_REPROBE = 3;

/**
 * undici's codes for "the socket was open and nothing arrived in time".
 *
 * THE TWO FIRE IN DIFFERENT PLACES, which is the whole reason this is a shared
 * helper rather than one inline check. MEASURED 2026-08-16 with both bounds at
 * 2000 ms against a server that writes headers plus a partial chunk and stalls:
 *
 *   headersTimeout ⇒ the `fetch()` call itself rejects
 *   bodyTimeout    ⇒ `fetch()` RESOLVES 200, and the failure lands later, in
 *                    `response.json()`, as `TypeError: terminated`
 *
 * So a body timeout reaches us through the JSON catch, where the obvious and
 * wrong diagnosis is "the runtime sent a malformed body".
 */
const COMPLETION_TIMEOUT_CODES = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

/** How far to follow `.cause`. See `isCompletionTimeout` — measured depth is 1. */
const MAX_CAUSE_DEPTH = 5;

// Reads one link of a thrown value's `cause` chain. Everything here is
// deliberately unparsed: undici's codes arrive on values nobody typed, the walk
// must not throw on a hostile shape, and a parse step that reshaped the chain
// would break the attribution this classifier exists for.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a link of a thrown `cause` chain has no contract
function errorCodeOf(value: unknown): string | undefined {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- guarding `in` against a primitive; a parse would rebuild the chain
  if (typeof value !== 'object' || value === null || !('code' in value)) return undefined;
  // SAFETY: `'code' in value` was just checked on a non-null object, and the
  // asserted property is itself `unknown` — the assertion claims presence, which
  // was checked, and nothing about the value's type.
  const code = (value as { code?: unknown }).code;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- a `code` that is not a string is not a code we know
  return typeof code === 'string' ? code : undefined;
}

/**
 * `fetch` reports both timeouts as an opaque `TypeError` (`fetch failed` /
 * `terminated`) and hangs the real reason off `cause`, which is the ONLY thing
 * separating a ten-minute timeout from an instant connection refusal.
 *
 * MEASURED DEPTH IS 1 in both cases — the code sits at `error.cause.code`. The
 * loop is purely defensive against undici nesting one level deeper in some
 * future release; it is NOT evidence that we have ever seen a deeper chain. The
 * `seen` set guards a self-referential `cause`, which would otherwise spin here.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- classifies a caught throwable; see the doc comment above
function isCompletionTimeout(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (current === null || current === undefined || seen.has(current)) return false;
    seen.add(current);

    const code = errorCodeOf(current);
    if (code !== undefined && COMPLETION_TIMEOUT_CODES.has(code)) return true;

    if (!(current instanceof Error)) return false;
    current = current.cause;
  }
  return false;
}

/**
 * The half of a timeout message that is identical either way: name the knob and
 * both remedies, per the convention the entrypoint's conflict error set. Written
 * once so the two call sites cannot drift into naming different variables.
 */
function completionTimeoutMessage(options: { lead: string; timeoutMs: number }): string {
  const seconds = Math.round(options.timeoutMs / 1000);
  return (
    `${options.lead.replace('{seconds}', String(seconds))} ` +
    `If this hardware legitimately needs longer than ${seconds}s per plate, ` +
    `raise RUNTIME_COMPLETION_TIMEOUT_MS or set it to 0 to remove the bound.`
  );
}

/** No bytes at all: the socket opened and the runtime never began answering. */
const MUTE_UPSTREAM_LEAD =
  'The model runtime accepted the connection but sent nothing back within {seconds}s. ' +
  'That usually means MODEL_RUNTIME_URL points somewhere that is not the runtime, or a proxy in front of it swallowed the request.';

/**
 * Headers arrived, then the body stopped. Deliberately NOT the mute copy: this
 * upstream did start answering, so "sent nothing back" would be false and would
 * send the operator hunting a routing problem that does not exist.
 */
const STALLED_MID_BODY_LEAD =
  'The model runtime began answering and then stalled mid-response, sending nothing further for {seconds}s. ' +
  'That usually means the runtime died or was restarted mid-generation, or a proxy in front of it dropped the connection.';

export interface RuntimeUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface RuntimeCompletion {
  candidate: TerseCandidate;
  usage: RuntimeUsage;
  /** Time spent inside the runtime call, milliseconds. */
  latencyMs: number;
}

export interface ModelRuntime {
  /** One grammar-constrained vision call. Throws `ApiError` (502) on any runtime failure. */
  identify(imageDataUri: string): Promise<RuntimeCompletion>;
  /** True when the runtime reports itself ready to serve. Never throws. */
  isReady(): Promise<boolean>;
}

interface ChatCompletionEnvelope {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Strips a markdown code fence if a runtime wrapped the JSON in one. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

export function parseTerseContent(content: string): TerseCandidate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(content));
  } catch (error) {
    throw upstreamFailure('The model runtime returned output that was not valid JSON.', error);
  }
  const result = TerseCandidateSchema.safeParse(parsed);
  if (!result.success) {
    throw upstreamFailure(
      'The model runtime returned JSON that did not match the expected shape. Is grammar-constrained decoding (`response_format`) supported by this runtime?',
      result.error,
    );
  }
  return result.data;
}

export interface CreateModelRuntimeOptions {
  /** Base address, no trailing `/v1` — `config.ts` normalizes it. */
  baseUrl: string;
  modelId: string;
  /**
   * Bearer for the runtime. Absent ⇒ NO `Authorization` header is sent at all;
   * an empty header is not the same thing as an absent one to a proxy.
   */
  apiKey?: string | null;
  /**
   * Total bound on one completion call, milliseconds; `0` disables it. Absent ⇒
   * `DEFAULT_RUNTIME_COMPLETION_TIMEOUT_MS`. Never inherit the ambient default:
   * it is 300 s, nobody picked it, and it is reachable on supported hardware.
   */
  completionTimeoutMs?: number;
}

/**
 * Whether the fallback endpoint has been resolved. `null` ⇒ run the full chain,
 * starting at `/health`.
 *
 * There is deliberately NO `'health'` state. `/health` is the first link in the
 * chain and costs one round-trip, so caching it saves nothing — and running the
 * chain from the top is what lets a `/health`-resolved runtime fall through to
 * `/v1/models` WITHIN THE SAME CALL if `/health` later disappears (a swapped
 * upstream, a proxy that stops mapping the path). Turning that into a "already
 * resolved to health, skip ahead" fast path would trade a saved zero round-trips
 * for a readiness probe that can never recover.
 */
type ResolvedProbe = 'models' | null;

export function createModelRuntime(options: CreateModelRuntimeOptions): ModelRuntime {
  const completionsUrl = `${options.baseUrl}/v1/chat/completions`;
  const healthUrl = `${options.baseUrl}/health`;
  const modelsUrl = `${options.baseUrl}/v1/models`;

  /** `{}` rather than `{Authorization: 'Bearer '}` when unset — see `apiKey`. */
  const authHeader: Record<string, string> = options.apiKey
    ? { Authorization: `Bearer ${options.apiKey}` }
    : {};

  const completionTimeoutMs = options.completionTimeoutMs ?? DEFAULT_RUNTIME_COMPLETION_TIMEOUT_MS;

  /**
   * ONE dispatcher for the life of the client, not one per request: an `Agent`
   * owns the connection pool, so building it per call would throw away keep-alive
   * and leak a pool per scan.
   */
  const completionDispatcher = new Agent({
    headersTimeout: completionTimeoutMs,
    bodyTimeout: completionTimeoutMs,
  });

  let resolvedProbe: ResolvedProbe = null;
  let consecutiveFallbackFailures = 0;

  /**
   * `/health`, read as three answers rather than a boolean.
   *
   * MEASURED 2026-08-15: llama.cpp answers **503 while the model loads** (~0.8 s
   * window) and 200 once it can serve, so a 503 is a real "not ready" and must
   * NOT fall through to `/v1/models` — that would report ready mid-load. Every
   * other non-2xx (Ollama has no `/health` at all ⇒ 404; an auth-everything
   * proxy answers 401/403 for an unmapped path) and any connect error means
   * "this endpoint does not answer the question", which is what the fallback is
   * for.
   */
  async function probeHealth(): Promise<'ready' | 'not-ready' | 'unanswerable'> {
    try {
      const response = await fetch(healthUrl, {
        headers: authHeader,
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (response.ok) return 'ready';
      if (response.status === 503) return 'not-ready';
      return 'unanswerable';
    } catch {
      return 'unanswerable';
    }
  }

  /**
   * `GET /v1/models`, WITH the bearer.
   *
   * LIVENESS, NOT READINESS — measured 2026-08-15: Ollama answers this 200 with
   * zero models resident (it loads lazily on first request), and so did a broken
   * install that could not have produced a single token. It fixes the
   * HEALTHCHECK restart-loop for `/health`-less runtimes; it must not be read as
   * parity with the bundled path.
   *
   * A 401 here is deliberately NOT ready: against an authed vLLM `/health` is
   * open while every scan 401s, so surfacing the key misconfiguration is the
   * whole point of sending the bearer on a probe.
   */
  async function probeModels(): Promise<boolean> {
    try {
      const response = await fetch(modelsUrl, {
        headers: authHeader,
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  return {
    async identify(imageDataUri: string): Promise<RuntimeCompletion> {
      const body = {
        model: options.modelId,
        messages: buildTerseMessages(imageDataUri),
        temperature: TERSE_TEMPERATURE,
        max_tokens: TERSE_MAX_TOKENS,
        response_format: TERSE_RESPONSE_FORMAT,
      };

      const startedAt = performance.now();
      let response: UndiciResponse;
      try {
        response = await undiciFetch(completionsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify(body),
          dispatcher: completionDispatcher,
        });
      } catch (error) {
        // Network-level failure. The error is not echoed to the client: it can
        // name internal addresses, and the caller can do nothing with it.
        //
        // A timeout gets its OWN message. Folding it into "could not be reached"
        // makes a ten-minute mute upstream indistinguishable from an instant
        // connection refusal — same words, opposite remedies.
        if (isCompletionTimeout(error)) {
          throw upstreamFailure(
            completionTimeoutMessage({
              lead: MUTE_UPSTREAM_LEAD,
              timeoutMs: completionTimeoutMs,
            }),
            error,
          );
        }
        throw upstreamFailure('The model runtime could not be reached.', error);
      }

      if (!response.ok) {
        // The runtime's own error body is NOT forwarded — on some runtimes it
        // echoes the request back, image and all.
        throw upstreamFailure(`The model runtime answered ${response.status}.`);
      }

      let envelope: ChatCompletionEnvelope;
      try {
        // SAFETY: nothing below trusts this shape — every field of
        // `ChatCompletionEnvelope` is optional and every read is optional-chained
        // and guarded, so a runtime that answers with a different body lands on
        // the empty-completion failure rather than on a property of `undefined`.
        envelope = (await response.json()) as ChatCompletionEnvelope;
      } catch (error) {
        // `bodyTimeout` LANDS HERE, not in the catch above — `fetch()` already
        // resolved 200 by the time the body stalls, and undici surfaces the
        // stall as `TypeError: terminated`. Without this check that reads as
        // "the runtime sent a malformed body": a confident, wrong diagnosis
        // that names no knob, which is the exact failure this bound exists to
        // stop being unattributable.
        if (isCompletionTimeout(error)) {
          throw upstreamFailure(
            completionTimeoutMessage({
              lead: STALLED_MID_BODY_LEAD,
              timeoutMs: completionTimeoutMs,
            }),
            error,
          );
        }
        throw upstreamFailure('The model runtime returned a body that was not JSON.', error);
      }

      const latencyMs = performance.now() - startedAt;
      const choice = envelope.choices?.[0];

      // The benchmarked trap: llama.cpp answers HTTP 200 with a body cut
      // mid-JSON when `max_tokens` bites. Named explicitly so the failure reads
      // as "raise the cap", not "the model is broken".
      if (choice?.finish_reason === 'length') {
        throw upstreamFailure(
          `The model runtime truncated its answer at the ${TERSE_MAX_TOKENS}-token cap (finish_reason: length).`,
        );
      }

      const content = choice?.message?.content;
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the envelope is asserted, not parsed: a non-string `content` must land on the empty-completion failure below, not on a TypeError from `.trim()`
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw upstreamFailure('The model runtime returned an empty completion.');
      }

      return {
        candidate: parseTerseContent(content),
        usage: {
          promptTokens: envelope.usage?.prompt_tokens ?? 0,
          completionTokens: envelope.usage?.completion_tokens ?? 0,
        },
        latencyMs,
      };
    },

    /**
     * `/readyz` calls this per request and Docker's HEALTHCHECK polls it every
     * 30 s, so the endpoint that answered is CACHED: without that, every
     * `/health`-less runtime pays two sequential probes (up to 4 s) forever.
     */
    async isReady(): Promise<boolean> {
      if (resolvedProbe === 'models') {
        const ready = await probeModels();
        if (ready) {
          consecutiveFallbackFailures = 0;
          return true;
        }
        consecutiveFallbackFailures += 1;
        if (consecutiveFallbackFailures >= FALLBACK_FAILURES_BEFORE_REPROBE) {
          resolvedProbe = null;
          consecutiveFallbackFailures = 0;
        }
        return false;
      }

      const health = await probeHealth();
      if (health === 'ready') return true;
      // 503: the runtime answered the question with "still loading". No fallback,
      // and no cache change — `/health` is clearly present and speaking.
      if (health === 'not-ready') return false;

      const ready = await probeModels();
      if (!ready) return false;
      resolvedProbe = 'models';
      consecutiveFallbackFailures = 0;
      return true;
    },
  };
}
