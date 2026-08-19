/**
 * The terminal error handler — and the reason it is not optional twice over.
 *
 * FIRST: SHAPE. Every non-2xx body must be an OpenAI error envelope
 * (`{"error": {message, type, param?, code?}}`), because the client is
 * openplate's `openai-compatible` adapter and anything else is an unparseable
 * surprise. Express's default handler does not honour that — an oversize body
 * raised by `body-parser` produces an HTML page with a stack trace in
 * development and a bare status line otherwise, on precisely the failure paths
 * (413, 400 parse) a client is most likely to hit in the field.
 *
 * SECOND: PRIVACY. This is the one place in the service that sees every
 * unhandled error, which makes it the one place a plate photo could leak out of.
 * Two rules, both load-bearing:
 *
 *   - The request BODY is never logged and never echoed. Not the parsed body, not
 *     a truncated preview of it, not "just the keys". The body is where the image
 *     is.
 *   - The error's own text goes through `scrubPayloads` before it is logged.
 *     Our errors never carry image bytes, but a dependency's might — a library
 *     that quotes the input it choked on, wrapped by a `${error}` somewhere. The
 *     scrubber is what makes that a non-event instead of a breach, and
 *     `tests/unit/no-image-in-error-paths.test.ts` proves it by throwing exactly
 *     such an error.
 *
 * Unexpected errors get a fixed sentence, so an internal detail cannot escape
 * through a message someone forgot to write carefully.
 */
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import { getApiKeyIdentity } from './api-key-auth.js';
import { describeError, scrubPayloads } from './scrub.js';

/** `body-parser` marks its own failures with a `type` field. */
const BODY_PARSER_TOO_LARGE = 'entity.too.large';
const BODY_PARSER_PARSE_FAILED = 'entity.parse.failed';

/**
 * The one thing this handler reads off a thrown value. Anything without a string
 * `type` — including every error we raise ourselves — parses as a miss and falls
 * through to the unexpected-error branch.
 */
const BodyParserErrorSchema = z.looseObject({ type: z.string() });

export interface OpenAiErrorBody {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

export function openAiErrorBody(options: {
  message: string;
  type: string;
  param?: string;
  code?: string;
}): OpenAiErrorBody {
  return {
    error: {
      message: options.message,
      type: options.type,
      param: options.param ?? null,
      code: options.code ?? null,
    },
  };
}

function sendApiError(res: Response, error: ApiError): void {
  if (error.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(error.retryAfterSeconds));
  }
  res.status(error.status).json(
    openAiErrorBody({
      // Scrubbed on the way OUT as well as into the log. An `ApiError` message is
      // the one error string this service returns verbatim, so it is the one
      // place a message built around the request payload would escape — and
      // "the message is written by us" is a promise about today's code, not
      // tomorrow's.
      message: scrubPayloads(error.message),
      type: error.type,
      param: error.param,
      code: error.code,
    }),
  );
}

export function createErrorMiddleware(logger: Logger): ErrorRequestHandler {
  // Express hands the terminal handler whatever a route threw, and JS permits
  // throwing any value. `unknown` is the honest annotation here and it is what
  // forces every branch below to establish the shape it reads before reading it;
  // any narrower type would be a guess this handler is not entitled to make.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see above: the thrown value has no contract
  return function handleError(error: unknown, req: Request, res: Response, next: NextFunction): void {
    // Headers already flushed means a handler partially responded and then
    // failed; there is no valid JSON to send, so hand it back to Express to
    // destroy the socket.
    if (res.headersSent) {
      next(error);
      return;
    }

    const keyId = getApiKeyIdentity(req)?.keyId ?? null;

    if (error instanceof ApiError) {
      // Expected, client-visible failures. Logged at warn with metadata only —
      // path, status, key fingerprint. Never the body.
      logger.warn('Request rejected', {
        method: req.method,
        path: req.path,
        status: error.status,
        code: error.code ?? null,
        keyId,
      });
      sendApiError(res, error);
      return;
    }

    const parsedBodyParserError = BodyParserErrorSchema.safeParse(error);
    const type = parsedBodyParserError.success ? parsedBodyParserError.data.type : null;
    if (type === BODY_PARSER_TOO_LARGE) {
      logger.warn('Request body exceeded the parser limit', { method: req.method, path: req.path, keyId });
      res.status(413).json(
        openAiErrorBody({
          message: 'Request body exceeds the maximum accepted size.',
          type: 'invalid_request_error',
          code: 'payload_too_large',
        }),
      );
      return;
    }
    if (type === BODY_PARSER_PARSE_FAILED) {
      logger.warn('Request body was not valid JSON', { method: req.method, path: req.path, keyId });
      res.status(400).json(
        openAiErrorBody({
          message: 'Request body is not valid JSON.',
          type: 'invalid_request_error',
          code: 'invalid_json',
        }),
      );
      return;
    }

    // Genuinely unexpected. `describeError` scrubs; the response says nothing
    // about it at all.
    logger.error('Unhandled request error', {
      method: req.method,
      path: req.path,
      keyId,
      error: describeError(error),
    });
    res.status(500).json(
      openAiErrorBody({ message: 'Internal server error.', type: 'server_error', code: 'internal_error' }),
    );
  };
}

/** 404 in the OpenAI shape, so an unknown path does not fall through to Express's HTML default either. */
export function handleNotFound(req: Request, res: Response): void {
  res.status(404).json(
    openAiErrorBody({
      message: `Unknown endpoint: ${req.method} ${req.path}`,
      type: 'invalid_request_error',
      code: 'unknown_endpoint',
    }),
  );
}
