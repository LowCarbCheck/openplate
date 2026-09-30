/**
 * Passes a routed request on to its real server and reads the answer, for a
 * stub that rewrites what the server said.
 *
 * ── A PAGE MAY LET GO OF THE REQUEST FIRST ──
 *
 * A spec that loads a new document (`page.goto`) while a routed request is
 * still inside its handler makes Playwright drop that request. The response
 * `route.fetch()` returned is disposed, so `response.text()` throws "Response
 * has been disposed", and a later `route.fulfill()` finds the route gone.
 * Playwright reports a throw in a route handler as a failure of the running
 * test, although nothing waits for that answer any more. On a slower machine
 * the window is wide: `synced-diary-location-copy.spec.ts` failed this way in
 * four of five CI runs up to 2026-09-30, and passed on the developer host.
 *
 * So a request the page abandoned reads as `null`, and the handler answers
 * nothing. Any other failure still throws: a stub that cannot reach its
 * server, or an answer it cannot read, must fail the spec.
 */
/**
 * Playwright's messages for a routed request the page, the context or the
 * browser let go of before the handler finished with it.
 */
const ABANDONED_ROUTE_MESSAGE =
  /Response has been disposed|Target page, context or browser has been closed|Route is already handled/u;

/** Whether an error message only says the page no longer waits for this request. */
export function isAbandonedRouteMessage(message: string): boolean {
  return ABANDONED_ROUTE_MESSAGE.test(message);
}

/** Whether a caught value is Playwright saying the page let go of the request. */
function isAbandonment(caught: Error | string | null): boolean {
  return caught instanceof Error && isAbandonedRouteMessage(caught.message);
}

/** The part of Playwright's `APIResponse` this module reads. */
interface ReadableResponse {
  text(): Promise<string>;
}

/** A routed request's real answer, with its body read as text. */
export interface FetchedRoute<Response extends ReadableResponse> {
  response: Response;
  text: string;
}

/**
 * The real server's answer to a routed request, or `null` when the page let
 * go of the request before it could be read. See the module header.
 *
 * @param route - the route inside its handler (Playwright's `Route`).
 */
export async function fetchRouteText<Response extends ReadableResponse>(route: {
  fetch(): Promise<Response>;
}): Promise<FetchedRoute<Response> | null> {
  try {
    const response = await route.fetch();
    return { response, text: await response.text() };
  } catch (error) {
    if (isAbandonment(error instanceof Error ? error : null)) return null;
    throw error;
  }
}

/**
 * Runs a `route.fulfill()` that may come after the page let go of the
 * request, and ignores only that case.
 *
 * @param fulfil - the call that answers the route.
 */
export async function fulfilUnlessAbandoned(fulfil: () => Promise<void>): Promise<void> {
  try {
    await fulfil();
  } catch (error) {
    if (!isAbandonment(error instanceof Error ? error : null)) throw error;
  }
}
