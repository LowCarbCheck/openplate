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
 * ── The event LEVEL, and why it is a third variable rather than a flag ──
 *
 * `MATOMO_EVENT_LEVEL` decides HOW MUCH the events module is allowed to say,
 * on an instance that already has analytics on. `'product'` is the default and
 * counts software use only. `'research'` additionally counts fasting, weight,
 * clinician sharing and study participation, which are facts about a person's
 * health rather than about the software. `'pageviews'` counts nothing beyond
 * the page.
 *
 * The health-adjacent events ship rather than being cut, because a researcher
 * running their own instance genuinely needs them. They are switchable and
 * advertised instead of hidden, and the DEFAULT protects everybody who is not
 * that researcher. An operator who wants them has to name them.
 *
 * A level set on an instance with no `MATOMO_URL`/`MATOMO_SITE_ID` THROWS, for
 * the reason the pair itself throws: it describes an operator who believes
 * they have analytics and does not. Silence would let that belief stand.
 *
 * Pure module: no `process.env` reads and no imports from `#app/config`, so
 * the gating rules below are unit-testable without an environment.
 */

/**
 * How much the events module may report (`MATOMO_EVENT_LEVEL`).
 *
 * - `'pageviews'` — pageviews only, no custom event ever fires.
 * - `'product'` — pageviews plus software-feature events. THE DEFAULT.
 * - `'research'` — everything, including events about health behaviour and
 *   study participation.
 *
 * See the tier section at the top of `app/lib/matomo-events.ts` for which
 * event sits where, and why the split exists at all.
 */
export type AnalyticsEventLevel = 'pageviews' | 'product' | 'research';

/** The three accepted values, in order of how much they permit. */
const EVENT_LEVELS: readonly AnalyticsEventLevel[] = ['pageviews', 'product', 'research'];

/** A configured Matomo instance. `null` anywhere means "analytics do not exist here". */
export interface AnalyticsConfig {
  /** Absolute `http(s)` base URL of the Matomo install, with a single trailing slash. */
  matomoUrl: string;
  /** The Matomo site id this instance reports as. */
  siteId: number;
  /**
   * How much the events module may report. `'product'` when the operator set
   * no `MATOMO_EVENT_LEVEL`, which is the default an operator gets by turning
   * analytics on and nothing else.
   */
  eventLevel: AnalyticsEventLevel;
}

/**
 * Parses `MATOMO_URL` + `MATOMO_SITE_ID` + `MATOMO_EVENT_LEVEL`.
 *
 * - all unset/blank → `null` (the default, and the self-host default)
 * - exactly one of the pair set → THROWS (see the module doc)
 * - malformed or non-`http(s)` URL → THROWS
 * - site id that is not a positive integer → THROWS
 * - level set while the pair is unset → THROWS
 * - level outside the three accepted values → THROWS
 * - level unset while the pair is set → `'product'`
 */
export function parseAnalyticsConfig({
  matomoUrl,
  siteId,
  eventLevel,
}: {
  matomoUrl: string | undefined;
  siteId: string | undefined;
  eventLevel: string | undefined;
}): AnalyticsConfig | null {
  const url = matomoUrl?.trim() ?? '';
  const id = siteId?.trim() ?? '';
  // Case-insensitive and trimmed, like the pair above: an operator writing
  // `Research` in a compose file means the level, not a typo worth a boot
  // failure.
  const level = eventLevel?.trim().toLowerCase() ?? '';

  if (url === '' && id === '') {
    if (level !== '') {
      throw new Error(
        'MATOMO_EVENT_LEVEL is set but MATOMO_URL and MATOMO_SITE_ID are not — a level with no analytics counts nothing',
      );
    }
    return null;
  }
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

  // Unset resolves to `product`, the level an operator gets for turning
  // analytics on and saying nothing else. An unrecognised value throws rather
  // than falling back: a typo'd `reserach` would otherwise silently downgrade
  // the very instance whose operator asked for more.
  const matched = EVENT_LEVELS.find((candidate) => candidate === level);
  if (level !== '' && matched === undefined) {
    throw new Error(`MATOMO_EVENT_LEVEL must be one of pageviews, product, research — got: ${eventLevel}`);
  }
  const resolvedLevel: AnalyticsEventLevel = matched ?? 'product';

  return { matomoUrl: base, siteId: Number(id), eventLevel: resolvedLevel };
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
