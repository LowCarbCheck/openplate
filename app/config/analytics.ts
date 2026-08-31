/**
 * Optional Matomo analytics — OFF unless an operator turns it on.
 *
 * ── Why this is env-gated, and why that is not negotiable ────────────────
 *
 * `content-security-policy.ts` states the contract this module has to keep:
 * "openplate loads no third-party script at all on an unconfigured instance,
 * and that is a product claim rather than an accident." A self-hoster's
 * instance must therefore render byte-for-byte the same HTML and the same CSP
 * header it did before analytics existed. Same shape as
 * `parseNewsletterConfig` and `parseSyncServerUrl`, for the same reason: the
 * mailing list, the sync server and the analytics account all belong to
 * whoever RUNS an instance, never to the software.
 *
 * ── Both variables, or neither ───────────────────────────────────────────
 *
 * A site id without a URL cannot be tracked to, and a URL without a site id
 * would send every instance's traffic into whatever site id Matomo defaults
 * to — silently polluting somebody else's numbers. So a half-configured pair
 * THROWS at boot, exactly as the newsletter pair does. A throw is the cheaper
 * failure: the alternative is an operator who believes they have analytics.
 *
 * ── What this deliberately does NOT do ───────────────────────────────────
 *
 * No cookies (`disableCookies` is pushed before the tracker loads), so there
 * is no consent banner to build and nothing to store on the device. And no
 * diary content EVER becomes an event value. openplate's whole claim is that
 * food logs stay on the device; an event that carried a food name, a weight,
 * or a photo would break that claim far more quietly than a network request
 * would. The events in `app/lib/matomo-events.ts` carry feature names and
 * counts only — see the rules written at the top of that file.
 *
 * Pure module: no `process.env` reads and no imports from `#app/config`, so
 * the gating rules below are unit-testable without an environment.
 */

/** A configured Matomo instance. `null` anywhere means "analytics do not exist here". */
export interface AnalyticsConfig {
  /** Absolute `http(s)` base URL of the Matomo install, with a single trailing slash. */
  matomoUrl: string;
  /** The Matomo site id this instance reports as. */
  siteId: number;
}

/**
 * Parses `MATOMO_URL` + `MATOMO_SITE_ID`.
 *
 * - both unset/blank → `null` (the default, and the self-host default)
 * - exactly one set → THROWS (see the module doc)
 * - malformed or non-`http(s)` URL → THROWS
 * - site id that is not a positive integer → THROWS
 */
export function parseAnalyticsConfig({
  matomoUrl,
  siteId,
}: {
  matomoUrl: string | undefined;
  siteId: string | undefined;
}): AnalyticsConfig | null {
  const url = matomoUrl?.trim() ?? '';
  const id = siteId?.trim() ?? '';

  if (url === '' && id === '') return null;
  if (url === '') throw new Error('MATOMO_SITE_ID is set but MATOMO_URL is not — set both or neither');
  if (id === '') throw new Error('MATOMO_URL is set but MATOMO_SITE_ID is not — set both or neither');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`MATOMO_URL is not a valid absolute URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`MATOMO_URL must be an http(s) URL, got ${parsed.protocol}`);
  }

  // Reject anything that is not a plain positive integer. `Number('12abc')` is
  // NaN but `parseInt('12abc')` is 12 — a typo'd id must not silently become a
  // real, different site's id.
  if (!/^\d+$/.test(id) || Number(id) === 0) {
    throw new Error(`MATOMO_SITE_ID must be a positive integer, got: ${id}`);
  }

  // Normalised with exactly one trailing slash so callers can append
  // `matomo.php` / `matomo.js` without re-deriving the join.
  const base = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}/`;

  return { matomoUrl: base, siteId: Number(id) };
}

/**
 * The ORIGIN to name in the CSP, or `null` when analytics are off.
 *
 * Origin only: `script-src`/`connect-src`/`img-src` match scheme, host and
 * port and silently ignore a path, so including one would be misleading rather
 * than stricter.
 */
export function analyticsCspOrigin(config: AnalyticsConfig | null): string | null {
  return config === null ? null : new URL(config.matomoUrl).origin;
}
