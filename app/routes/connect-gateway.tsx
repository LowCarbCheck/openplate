/**
 * `/connect-gateway?gateway=<url>&invite=<token>` — the OLD gateway invite
 * link, kept working as a REDIRECT into `/join`.
 *
 * Gateway operators have already handed these out by mail and pasted them into
 * household chats, and an invite that stops working is an invite nobody can
 * fix: the person holding it cannot rebuild somebody else's link. So this route
 * survives, and it does exactly one thing — it rewrites what it was given as a
 * `/join` fragment and hands over.
 *
 * A REDIRECT AND NOT A SECOND COPY, deliberately. The join screen carries the
 * token hygiene, the CSP explanation, the audit disclosure and the pre-join
 * confirm; two implementations of a capability-redemption screen is how one of
 * them ends up missing a guard. Everything below is address translation.
 *
 * CLIENT-ONLY, like `/join`. There is no `loader` and no `action`: the query
 * string is read in the browser and immediately rewritten as a fragment, which
 * no browser sends anywhere. That the old form put a live token in the query at
 * all is precisely why the new one does not, and why this translation runs
 * before anything else — including a render.
 */
import { useEffect } from 'react';

import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { buildJoinFragment } from '#app/lib/join-link';
import { normalizeGatewayUrl, normalizeInviteToken } from '#app/lib/gateway-invite';

export { RouteErrorBoundary as ErrorBoundary };

export default function ConnectGatewayRedirect() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Normalized here rather than passed through raw, so a mangled legacy link
    // lands on `/join`'s own "this link doesn't look right" card instead of
    // being rebuilt into a fragment that says nothing useful.
    const fragment = buildJoinFragment({
      gatewayUrl: normalizeGatewayUrl(params.get('gateway')),
      gatewayInvite: normalizeInviteToken(params.get('invite')),
    });
    // A DOCUMENT replace, not a client-side `navigate`. Two reasons: `replace`
    // keeps the URL that still carries the token in its query string out of the
    // history, and a router navigation issued from the first effect of a
    // hydrating route can be dropped before the router is ready — which leaves
    // a blank page and an invite nobody can redeem. A full load costs a beat
    // and cannot be lost. `/join` strips the fragment as it reads it.
    window.location.replace(`/join${fragment}`);
  }, []);

  // Nothing renders: this is an address, not a screen. `/join` shows its own
  // "checking" card within one tick.
  return null;
}
