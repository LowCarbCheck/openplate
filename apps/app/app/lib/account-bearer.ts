/**
 * The account bearer for this app's OWN food routes, `/api/food-matches` and
 * `/api/food-proposals`.
 *
 * On a managed instance those routes spend the operator's LowCarbCheck key,
 * and they ask core whether the caller's access token is live before they do
 * (`managed-account-gate.server.ts`). So the page sends the token it already
 * sends to core. On an open instance the server reads no header, and a device
 * with no session sends none.
 *
 * SAME ORIGIN, AND NO WIDER THAN BEFORE. The token goes to the server that
 * served the very script holding it, so this adds no party that could not
 * already read it.
 *
 * ONE REFRESH AFTER A `401`, never before. A refresh token is single use, and
 * spending one speculatively is what a stolen token looks like
 * (`managedAiCredential` says the same). The auth client shares one refresh
 * among concurrent callers, so a search and a scan that both meet a `401`
 * spend it once.
 */
import { getSyncVault } from '#app/lib/sync/sync-session';

/** Where the bearer comes from: the live session, or a fake in a unit test. */
export interface AccountBearer {
  /** The current access token, or `null` with no session. Read at send time, never closed over. */
  getBearer: () => string | null;
  /** Spends the refresh token for a new access token, or `null` when the person must sign in again. */
  refreshBearer: () => Promise<string | null>;
}

/** The bearer of the session this tab holds, if any. */
export function sessionAccountBearer(): AccountBearer {
  return {
    getBearer: () => getSyncVault()?.authClient.getAccessToken() ?? null,
    refreshBearer: async () => (await getSyncVault()?.authClient.refreshAccessToken()) ?? null,
  };
}

/** `init` with the bearer set, or with no `Authorization` at all when there is none. */
function withBearer(init: RequestInit, token: string | null): RequestInit {
  const headers = new Headers(init.headers);
  if (token === null) headers.delete('authorization');
  else headers.set('authorization', `Bearer ${token}`);
  return { ...init, headers };
}

/**
 * `fetch`, with the account bearer attached and one refresh and retry after
 * a `401`.
 *
 * Throws what `fetch` throws; every caller already fails open around it.
 *
 * @param options.url - a same-origin path.
 * @param options.init - the request, without `Authorization`.
 * @param options.bearer - where the token comes from.
 * @returns the last response.
 */
export async function fetchWithAccountBearer({
  url,
  init,
  bearer,
}: {
  url: string;
  init: RequestInit;
  bearer: AccountBearer;
}): Promise<Response> {
  const response = await fetch(url, withBearer(init, bearer.getBearer()));
  if (response.status !== 401) return response;
  const refreshed = await bearer.refreshBearer();
  if (refreshed === null) return response;
  return fetch(url, withBearer(init, refreshed));
}
