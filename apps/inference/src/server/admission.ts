/**
 * Backpressure: a bounded worker pool with admission control.
 *
 * THE SHAPE IS FORCED BY THE ROUTE. `/v1/chat/completions` is a synchronous
 * contract — the caller holds a socket open and expects a plate back on it. A job
 * queue behind that would need a polling side-channel the OpenAI API does not
 * have, which would defeat the entire point of being OpenAI-compatible.
 * Explicitly: NO pg-boss, no broker, no durable queue for inference requests.
 * What is bounded is the in-process pool and the short waiting line in front of
 * it, and both refuse work rather than growing.
 *
 * THREE GATES, in this order:
 *
 * 1. **Latency ceiling (503).** If the PROJECTED completion —
 *    `(queue_depth + 1) × mean_service_time` — exceeds `LATENCY_CEILING_MS`, the
 *    request is refused with `503` + `Retry-After`. This encodes a product
 *    requirement, not an implementation preference: the hosted tier's bar is
 *    "p95 ≤ 10 s per scan, hard maximum" (owner, 2026-08-11), which makes a slow
 *    success a FAILED request. Serving it anyway would hit the SLO while
 *    honouring nothing.
 *
 *    Mean service time is an exponentially-weighted moving average of real
 *    completions, so the threshold tracks the hardware it is actually running on
 *    instead of a number someone guessed. Until the first request completes there
 *    is no mean, and the gate stays open — refusing traffic on the basis of no
 *    measurement would make a cold start look like an outage.
 *
 *    `LATENCY_CEILING_MS = 0` disables this gate, and that is the SELF-HOST
 *    default. A CPU box legitimately takes 25–110 s per plate; shedding load at
 *    10 s there would refuse every request it is capable of serving. The ceiling
 *    binds the tier we operate and sell, not the one a stranger runs on a NUC.
 *
 * 2. **Hard queue cap (429).** Independent of any timing: past `MAX_QUEUE_DEPTH`
 *    waiters the answer is `429` + `Retry-After`. This is the gate that holds when
 *    the ceiling is disabled — without it, "no ceiling" would mean an unbounded
 *    waiting line and an OOM instead of a refusal.
 *
 * 3. **The pool itself.** `CONCURRENCY` in flight, default 2, mirroring
 *    `llama-server --parallel 2`. More in-flight requests than the runtime has KV
 *    slots does not add throughput; it just moves the queue somewhere we cannot
 *    measure.
 *
 * 429 vs 503 is not cosmetic: `429` says "you asked for too much", `503` says "we
 * are too slow right now". A client should back off on both, but only one of them
 * is the client's fault.
 */
import { serviceOverloaded, tooManyRequests } from '../errors.js';

/**
 * EWMA weight for the newest sample. 0.2 ≈ a 5-request memory: fast enough to
 * notice a model reload or a thermally throttled box, slow enough that one
 * unusually large plate does not start shedding traffic.
 */
const DEFAULT_EWMA_ALPHA = 0.2;

export interface AdmissionStats {
  active: number;
  queued: number;
  /** `null` until the first request completes — see gate 1. */
  meanServiceMs: number | null;
}

export interface AdmissionController {
  /** Runs `task` under the pool, or throws `ApiError` (503/429) rather than accepting it. */
  run<T>(task: () => Promise<T>): Promise<T>;
  stats(): AdmissionStats;
  /** Feeds a service-time sample in. Exposed so a test can establish a mean without waiting. */
  recordServiceMs(durationMs: number): void;
}

export interface CreateAdmissionControllerOptions {
  concurrency: number;
  maxQueueDepth: number;
  /** `0` disables the projected-latency gate. */
  latencyCeilingMs: number;
  ewmaAlpha?: number;
  /** Injectable clock (milliseconds) so tests need not actually be slow. */
  monotonicNow?: () => number;
}

export function createAdmissionController(
  options: CreateAdmissionControllerOptions,
): AdmissionController {
  const alpha = options.ewmaAlpha ?? DEFAULT_EWMA_ALPHA;
  const now = options.monotonicNow ?? (() => performance.now());
  const waiters: Array<() => void> = [];
  let active = 0;
  let meanServiceMs: number | null = null;

  /**
   * Seconds a client should wait before retrying: how long the work already
   * ahead of it takes to drain, given the pool width. Derived from the same
   * measured mean the ceiling uses, so the two numbers can never disagree.
   */
  function retryAfterSeconds(): number {
    if (meanServiceMs === null) return 1;
    const ahead = waiters.length + active;
    const drainMs = (ahead / options.concurrency) * meanServiceMs;
    return Math.max(1, Math.ceil(drainMs / 1000));
  }

  /** `(queue_depth + 1) × mean`: this request's own service plus everything queued ahead of it. */
  function projectedCompletionMs(): number | null {
    if (meanServiceMs === null) return null;
    return (waiters.length + 1) * meanServiceMs;
  }

  function recordServiceMs(durationMs: number): void {
    meanServiceMs =
      meanServiceMs === null ? durationMs : alpha * durationMs + (1 - alpha) * meanServiceMs;
  }

  function release(): void {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  }

  async function acquire(): Promise<void> {
    if (active < options.concurrency) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      waiters.push(() => {
        active += 1;
        resolve();
      });
    });
  }

  return {
    stats(): AdmissionStats {
      return { active, queued: waiters.length, meanServiceMs };
    },

    recordServiceMs,

    async run<T>(task: () => Promise<T>): Promise<T> {
      // Gate 1 — projected latency.
      if (options.latencyCeilingMs > 0) {
        const projectedMs = projectedCompletionMs();
        if (projectedMs !== null && projectedMs > options.latencyCeilingMs) {
          throw serviceOverloaded(
            `Refusing the request: projected completion ${Math.round(projectedMs)} ms exceeds the ${options.latencyCeilingMs} ms latency ceiling. Retry shortly.`,
            retryAfterSeconds(),
          );
        }
      }

      // Gate 2 — hard queue cap.
      if (active >= options.concurrency && waiters.length >= options.maxQueueDepth) {
        throw tooManyRequests(
          `Server is at capacity (${options.concurrency} in flight, ${options.maxQueueDepth} queued). Retry shortly.`,
          retryAfterSeconds(),
        );
      }

      // Gate 3 — the pool.
      await acquire();
      const startedAt = now();
      try {
        return await task();
      } finally {
        // Timed even when the task threw: a failure that took 30 s consumed 30 s
        // of capacity, and an average that ignored failures would make a
        // degraded runtime look fast.
        recordServiceMs(now() - startedAt);
        release();
      }
    },
  };
}
