/**
 * The account check in front of the two routes that spend the LowCarbCheck
 * key, `/api/food-matches` and `/api/food-proposals`.
 *
 * ON A MANAGED INSTANCE ONLY. An open instance keeps the behaviour it always
 * had: there are no accounts to ask about, and a self-hoster's instance
 * answers whoever reaches it. On a managed instance a person needs an account
 * before they can use the app at all (`InstancePolicy.requiresAccount`), and
 * every screen that looks a food up is behind that, so a caller with no live
 * account is not a person using the app.
 *
 * FAILS CLOSED. No token and a refused token are both `401`, before the body
 * is read and before anything leaves for LowCarbCheck. Core unreachable is
 * `503`: a lookup is an enrichment the page already survives without, and
 * letting it through while the check is down would reopen exactly the door
 * this closes.
 *
 * Its own `.server` module because it reads `CONFIG`, and for the reason
 * `food-matches-rate-limit.server.ts` gives about route files.
 */
import { CONFIG } from '#app/config';
import { createComponentLogger } from '#app/lib/logger';
import {
  createAccountTokenVerifier,
  parseBearerToken,
  type AccountTokenVerifier,
} from '#app/lib/account-token-verifier.server';

const logger = createComponentLogger('account-gate');

/** The body of a `401`. It says what to do and nothing about why. */
export interface AccountRequiredBody {
  error: 'account-required';
}

/** The body of a `503`, when core could not be asked. */
export interface AccountCheckUnavailableBody {
  error: 'account-check-unavailable';
}

/** Built on first use, so an open instance never creates one. */
let verifier: AccountTokenVerifier | null = null;

/** The one verifier, for the configured core. */
function managedVerifier(syncServerUrl: string): AccountTokenVerifier {
  verifier ??= createAccountTokenVerifier({ syncServerUrl });
  return verifier;
}

/** `401`, with the challenge a bearer-protected resource sends. */
function accountRequired(): Response {
  const body: AccountRequiredBody = { error: 'account-required' };
  return Response.json(body, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
}

/**
 * The refusal for a caller this instance does not serve, or `null` to let the
 * request through.
 *
 * `null` on an open instance, always, without reading a header. On a managed
 * one, `null` only for a bearer core calls live.
 *
 * @param request - the incoming request; only its `Authorization` header is read.
 * @returns a `401` or `503` to answer with, or `null`.
 */
export async function refuseWithoutAccount(request: Request): Promise<Response | null> {
  const { syncServerUrl } = CONFIG.sync;
  if (!CONFIG.instance.managed) return null;
  // A managed instance cannot boot without a sync server (`isManagedInstance`),
  // so this is the belt to that braces, and it fails closed like the rest.
  if (syncServerUrl === null) return accountRequired();

  const token = parseBearerToken(request.headers.get('authorization'));
  if (token === null) return accountRequired();

  const verdict = await managedVerifier(syncServerUrl).verify(token);
  if (verdict === 'valid') return null;
  if (verdict === 'invalid') return accountRequired();

  logger.warn('Could not ask the account service about a food lookup, refusing it');
  const body: AccountCheckUnavailableBody = { error: 'account-check-unavailable' };
  return Response.json(body, { status: 503 });
}

/** Forgets every cached verdict. TEST SEAM, and nothing in the app calls it. */
export function clearAccountTokenCache(): void {
  verifier?.clear();
}
