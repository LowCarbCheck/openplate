/**
 * The service's error vocabulary. Every failure a client can see is one of
 * these, carrying the HTTP status and the OpenAI error `type`/`code` it should
 * be rendered with — so the wire shape is decided here, once, instead of at
 * twenty `res.status(...)` call sites.
 *
 * NOTHING IN HERE MAY CARRY IMAGE BYTES. Messages are written by us, for a
 * human reading a client-side error toast. When a message has to quote something
 * that came off the wire (a dependency's error text), it goes through
 * `server/scrub.ts#scrubPayloads` first.
 */

export type OpenAiErrorType = 'invalid_request_error' | 'rate_limit_error' | 'server_error';

export interface ApiErrorOptions {
  status: number;
  type: OpenAiErrorType;
  code?: string;
  param?: string;
  /** Seconds. Rendered as a `Retry-After` header — only for 429/503. */
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly type: OpenAiErrorType;
  readonly code?: string;
  readonly param?: string;
  readonly retryAfterSeconds?: number;

  constructor(message: string, options: ApiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.status = options.status;
    this.type = options.type;
    this.code = options.code;
    this.param = options.param;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function badRequest(message: string, options: { code?: string; param?: string } = {}): ApiError {
  return new ApiError(message, { status: 400, type: 'invalid_request_error', ...options });
}

export function unauthorized(message: string): ApiError {
  return new ApiError(message, { status: 401, type: 'invalid_request_error', code: 'invalid_api_key' });
}

/** The model id in the request is not one this service serves. */
export function modelNotFound(requested: string): ApiError {
  return new ApiError(
    `The model \`${requested}\` does not exist or you do not have access to it.`,
    { status: 404, type: 'invalid_request_error', code: 'model_not_found', param: 'model' },
  );
}

export function payloadTooLarge(message: string): ApiError {
  return new ApiError(message, { status: 413, type: 'invalid_request_error', code: 'image_too_large' });
}

export function tooManyRequests(message: string, retryAfterSeconds: number): ApiError {
  return new ApiError(message, {
    status: 429,
    type: 'rate_limit_error',
    code: 'rate_limit_exceeded',
    retryAfterSeconds,
  });
}

/**
 * Load shed. `503` rather than `429` because the cause is the SERVICE being
 * saturated, not this caller misbehaving — a well-behaved client should retry,
 * and its own rate budget should not be charged for our capacity problem.
 */
export function serviceOverloaded(message: string, retryAfterSeconds: number): ApiError {
  return new ApiError(message, {
    status: 503,
    type: 'server_error',
    code: 'service_overloaded',
    retryAfterSeconds,
  });
}

/** The model runtime failed us: unreachable, non-2xx, truncated, or unparseable. */
export function upstreamFailure(message: string, cause?: unknown): ApiError {
  return new ApiError(message, { status: 502, type: 'server_error', code: 'model_runtime_error', cause });
}
