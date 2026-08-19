import { logger, type LogMeta } from '#app/lib/logger';
import { setErrorReporter } from '#app/lib/report-error';

export function reportErrorOnServer(cause: unknown, context?: LogMeta): void {
  const normalized = cause instanceof Error ? cause : new Error(String(cause));
  logger.error('unhandled error', { ...context, error: normalized });
}

/** Install the pino-backed reporter as the process-wide error reporter. */
export function installServerErrorReporter(): void {
  setErrorReporter(reportErrorOnServer);
}
