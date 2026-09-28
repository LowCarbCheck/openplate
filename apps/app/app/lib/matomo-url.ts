/**
 * Turns a real openplate URL into one that is safe to send to analytics.
 *
 * ── Why this module exists ───────────────────────────────────────────────
 *
 * The obvious pageview call is `_paq.push(['setCustomUrl', location.href])`,
 * and that is what the sibling SelfHostedWorld tracker does. Copying it here
 * would have sent LIVE CREDENTIALS to Matomo, because openplate puts
 * single-use tokens in the query string:
 *
 *   /verify-email?token=…              (email verification)
 *   /reset-passphrase?token=…          (password reset)
 *   /oauth/openrouter/callback?code=…  (OAuth authorization code)
 *
 * Those would land in Matomo's visitor log and its database, and a reset token
 * sitting in an analytics table is a reset token an analytics admin can use.
 * SHW has no equivalent because its tokens never ride a tracked URL.
 *
 * It also puts identifiers in the PATH:
 *
 *   /diary/entry/<local id>            (a diary entry)
 *   /shared/<grantor account id>       (a clinician share — an ACCOUNT id)
 *
 * A grantor account id is a stable per-person identifier for a health-data
 * share. Aggregated analytics must not be able to single anyone out, so the
 * segment is replaced rather than hashed: a hash is still an identifier.
 *
 * ── The chosen policy: allowlist nothing ─────────────────────────────────
 *
 * The query string and fragment are dropped ENTIRELY rather than filtered
 * key-by-key. openplate has no query parameter whose value is worth an
 * analytics row, so a filter would be all risk and no benefit — and the next
 * token-bearing route someone adds would be included by default instead of
 * excluded by default. The one thing lost is campaign tracking (`utm_*`);
 * that is a real cost, and it is the right trade for a health app.
 *
 * Pure module: no `window`, no imports. Unit-testable directly.
 */

/**
 * Path segments that are identifiers, keyed by the literal segment that
 * precedes them. Kept as a table rather than a regex over "anything that looks
 * like an id" so that adding a route with an id is a deliberate edit here,
 * and so a legitimate literal path can never be mangled by accident.
 *
 * Derived from `app/routes.ts` — the only two dynamic segments the router
 * declares are `/diary/entry/:id` and `/shared/:grantorAccountId`.
 */
const ID_SEGMENT_PARENTS = {
  // `/diary/entry/<id>` — the parent is `entry`, itself under `diary`.
  entry: ':id',
  // `/shared/<grantorAccountId>`
  shared: ':grantorAccountId',
} satisfies Readonly<Record<string, string>>;

/** The literal parent segments above, as a lookup guard that keeps the inferred keys. */
type IdSegmentParent = keyof typeof ID_SEGMENT_PARENTS;

function placeholderFor(parent: string | undefined): string | undefined {
  if (parent === undefined) return undefined;
  if (!Object.hasOwn(ID_SEGMENT_PARENTS, parent)) return undefined;
  // SAFETY: `Object.hasOwn` on the line above established that `parent` is one
  // of this object's own keys, which is exactly what `IdSegmentParent` names.
  // `hasOwn` rather than `in` so a segment called "toString" cannot reach a
  // prototype member and produce a placeholder out of nothing.
  return ID_SEGMENT_PARENTS[parent as IdSegmentParent];
}

/**
 * Replaces id path segments with their placeholder and drops the query and
 * fragment.
 *
 * Takes and returns a full absolute URL so the caller can hand it straight to
 * `setCustomUrl`, which Matomo expects to be absolute.
 *
 * An unparseable input returns `null` — the caller then reports no custom URL
 * at all rather than guessing, which degrades to Matomo's own default instead
 * of inventing a page.
 */
export function sanitizeAnalyticsUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const segments = url.pathname.split('/');
  const cleaned = segments.map((segment, i) => {
    if (segment === '') return segment;
    const placeholder = placeholderFor(segments[i - 1]);
    // Only substitute when the parent is a known id-bearing segment AND this
    // segment is not itself one of those literals — `/shared` on its own (the
    // index route) must stay `/shared`.
    return placeholder !== undefined ? placeholder : segment;
  });

  // Query and fragment are dropped wholesale. See the module doc.
  return `${url.origin}${cleaned.join('/')}`;
}
