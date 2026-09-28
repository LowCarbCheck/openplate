/**
 * Application-wide error reporting seam.
 *
 * This module is client-safe: it holds only a mutable reporter function and
 * imports nothing server-only. The default reporter writes to `console.error`;
 * server bootstraps (`entry.server.tsx`, `server.ts`) swap in the pino-backed
 * reporter via `setErrorReporter` — see `report-error.server.ts`.
 *
 * Consumers integrating Sentry / Datadog / Highlight swap the reporter through
 * `setErrorReporter` rather than patching every error boundary individually.
 */

import type { LogMeta } from '#app/lib/logger';

type ErrorReporter = (cause: unknown, context?: LogMeta) => void;

let reporter: ErrorReporter = (error, context) => {
  console.error('unhandled error', error, context ?? {});
};

/**
 * Swap in a custom error reporter. Server bootstraps install the pino-backed
 * reporter here; consumers can install Sentry/Datadog/etc.
 */
export function setErrorReporter(next: ErrorReporter): void {
  reporter = next;
}

/** Safe to call from a render path (error boundaries) — never throws. */
export function reportError(cause: unknown, context?: LogMeta): void {
  try {
    reporter(cause, context);
  } catch {
    /* swallow — reporting must never crash the caller */
  }
}
