/**
 * The `www.` → apex canonical-host redirect (M147 spec 01), as a pure decision.
 *
 * ## Why a redirect at all
 *
 * One container answers on several hostnames at once. As of 2026-08-26 the
 * hosted instance is reachable as `openplate.lowcarbcheck.org` (the original
 * name), `openplate.de` and `www.openplate.de`. Serving identical content on
 * `www.openplate.de` AND `openplate.de` is a duplicate origin: it splits link
 * equity between two URLs for every page, and — worse for this app — splits
 * the browser's per-origin storage, so a user who lands on the `www.` spelling
 * once gets an EMPTY local store even though all their data is sitting in the
 * apex origin's IndexedDB. This app is local-first; an accidental second
 * origin looks exactly like data loss to the person it happens to.
 *
 * ## Why "strip a leading `www.`" and not "redirect to a canonical host"
 *
 * The obvious shape — a `CANONICAL_HOST` setting that every other host
 * redirects to — is wrong here, twice over:
 *
 *  1. It would drag `openplate.lowcarbcheck.org` along with it. That name is
 *     the original public address and must keep working unchanged; both
 *     origins stay live on purpose. A single canonical host cannot express
 *     "these two are both fine, that third one is a typo of the second".
 *  2. It would need configuring. This repo ships to self-hosters, and a
 *     self-hoster who puts the app on `www.theirdomain.example` gets the
 *     correct behaviour from this rule with no configuration at all, because
 *     the target is derived from the request's OWN host rather than from any
 *     setting. There is nothing to get wrong in an env file, and no way for
 *     this rule to strand an instance on a hostname it cannot serve: the
 *     redirect target is, by construction, a name that already resolved here.
 *
 * So: if — and only if — the request host begins with the label `www.`, send a
 * permanent redirect to the same scheme, the same host minus that label, and
 * the same path and query. Every other host, including every host that merely
 * CONTAINS the letters `www` (`wwwx.example.com`, `mywww.example.com`), is
 * left completely alone. That distinction is the whole reason this is a
 * prefix test on a label with its dot, never a substring search.
 *
 * ## Why the healthcheck is exempt
 *
 * `/healthcheck` is polled by Bay's post-deploy gate and by Gatus, and those
 * probes assert on the status code. A prober that does not follow redirects
 * reads a `301` as "not `200`", i.e. as a failed deploy — a hostname typo
 * would take the whole service red. The probe is worth more to us than the
 * canonicalisation of a single path that no human ever links to, so the
 * healthcheck answers on any host it is asked on.
 */

/** The host label — including its separating dot — this rule strips. */
const WWW_PREFIX = 'www.';

/**
 * Paths that answer on ANY host, never redirected. See the module header: a
 * probe that does not follow redirects would read the `301` as a failure.
 */
const REDIRECT_EXEMPT_PATHS: ReadonlySet<string> = new Set(['/healthcheck']);

export interface WwwRedirectRequest {
  /**
   * The request host. May carry a port (`www.example.test:8080`), which is
   * preserved in the target — only the leading `www.` label is removed.
   * Supply the proxy-aware value, not the raw `Host` header; see `server.ts`.
   */
  host: string;
  /** The request scheme, `http` or `https`. Preserved as-is. */
  protocol: string;
  /** The path and query exactly as requested, e.g. `/diary?date=2026-08-26`. */
  url: string;
}

/** Splits `/some/path?a=1` into its path, discarding the query. */
function pathOf(url: string): string {
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

/**
 * Returns the absolute URL a `www.` host should be redirected to, or `null`
 * when the request must be served as-is.
 *
 * `null` — the common case — covers every host without a leading `www.` label,
 * plus the exempt paths above.
 */
export function resolveWwwRedirectLocation(request: WwwRedirectRequest): string | null {
  const { host, protocol, url } = request;
  // Host names are case-insensitive, so `WWW.` is the same typo as `www.`;
  // the slice below runs against the original string, so nothing else in the
  // host is re-cased on the way through.
  if (!host.toLowerCase().startsWith(WWW_PREFIX)) return null;
  if (REDIRECT_EXEMPT_PATHS.has(pathOf(url))) return null;

  const apexHost = host.slice(WWW_PREFIX.length);
  // A bare `www.` host has nothing left to redirect to; serving it is a far
  // better failure than emitting a `Location` with an empty authority.
  if (apexHost.length === 0) return null;

  return `${protocol}://${apexHost}${url}`;
}
