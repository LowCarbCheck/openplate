/**
 * Turns "this promise must reject" into a typed value the test can assert on.
 *
 * Written once, here, because the `.catch((e) => e)` idiom it replaces forced
 * every call site to accept an `unknown` and then assert it back to `Error` —
 * an assertion nothing had checked. These helpers do the check: a rejection that
 * is not the expected kind fails the test where it happens, with a message that
 * names what actually came back.
 */
import { ApiError } from '../../src/errors.js';

export async function captureRejection(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (caught) {
    if (caught instanceof Error) return caught;
    throw new TypeError(`Expected a rejection with an Error, got: ${String(caught)}`, {
      cause: caught,
    });
  }
  throw new Error('Expected the operation to reject, but it resolved.');
}

/** The same, narrowed to the service's error vocabulary (status/type/code). */
export async function captureApiError(operation: Promise<unknown>): Promise<ApiError> {
  const error = await captureRejection(operation);
  if (error instanceof ApiError) return error;
  throw new TypeError(`Expected an ApiError, got ${error.name}: ${error.message}`, {
    cause: error,
  });
}
