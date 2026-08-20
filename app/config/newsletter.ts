/**
 * The optional newsletter capture (M146 spec 02) — OFF unless an operator
 * turns it on.
 *
 * ── Why this is env-gated at all ─────────────────────────────────────────
 *
 * openplate is a public repository and has to stay useful to someone who has
 * never heard of the project's sibling site. A mailing list belongs to whoever
 * runs an instance, not to the software, so an unconfigured instance — the
 * self-host default — renders no newsletter section, exposes no action, loads
 * no third-party script and makes no request. Same contract as
 * `SYNC_SERVER_URL` (`parseSyncServerUrl` in `public-config.ts`), for the same
 * reason.
 *
 * ── Both variables, or neither ───────────────────────────────────────────
 *
 * `NEWSLETTER_SUBSCRIBE_URL` alone would ship a bare email input: a personal-
 * data collection point with no bot protection in front of it. Turnstile is
 * part of the feature, not a decoration on it, so a half-configured pair
 * THROWS at boot rather than degrading. A throw is the cheaper failure — the
 * alternative presents an operator with a form they believe is protected.
 *
 * ── What crosses to the browser ──────────────────────────────────────────
 *
 * The site key only. `subscribeUrl` is the operator's own infrastructure
 * topology (typically an internal address on their private network) and stays
 * on the server: the browser posts to openplate's own action, which forwards
 * it. That is also what keeps Turnstile meaningful — a browser posting
 * straight to the subscribe endpoint would leak its address to every visitor.
 *
 * Pure module: no `process.env` reads and no imports from `#app/config`, so
 * the gating rules below are unit-testable without an environment (see
 * `tests/unit/landing-gates.test.ts`).
 */

/** A configured newsletter endpoint. `null` everywhere else means "the feature does not exist here". */
export interface NewsletterConfig {
  /**
   * Absolute `http(s)` URL of the subscribe endpoint the openplate server
   * POSTs to, no trailing slash. SERVER-ONLY — never sent to a browser.
   */
  subscribeUrl: string;
  /** Cloudflare Turnstile site key. Public by design: it is rendered into the widget. */
  turnstileSiteKey: string;
}

/**
 * Parses `NEWSLETTER_SUBSCRIBE_URL` + `NEWSLETTER_TURNSTILE_SITE_KEY`.
 *
 * - both unset/blank → `null` (the default, and the self-host default)
 * - exactly one set → THROWS (see the module doc: no unprotected form)
 * - malformed or non-`http(s)` URL → THROWS
 */
export function parseNewsletterConfig({
  subscribeUrl,
  turnstileSiteKey,
}: {
  subscribeUrl: string | undefined;
  turnstileSiteKey: string | undefined;
}): NewsletterConfig | null {
  const url = subscribeUrl?.trim() ?? '';
  const siteKey = turnstileSiteKey?.trim() ?? '';

  if (url === '' && siteKey === '') return null;
  if (url === '') {
    throw new Error('NEWSLETTER_TURNSTILE_SITE_KEY is set but NEWSLETTER_SUBSCRIBE_URL is not — set both or neither');
  }
  if (siteKey === '') {
    throw new Error(
      'NEWSLETTER_SUBSCRIBE_URL is set but NEWSLETTER_TURNSTILE_SITE_KEY is not — the form never ships without Turnstile',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`NEWSLETTER_SUBSCRIBE_URL is not a valid absolute URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`NEWSLETTER_SUBSCRIBE_URL must be an http(s) URL, got ${parsed.protocol}`);
  }

  return { subscribeUrl: url.replace(/\/+$/, ''), turnstileSiteKey: siteKey };
}

/**
 * What the LANDING PAGE's loader publishes about the newsletter: the site key,
 * or `null`. The endpoint is deliberately absent from this shape — see the
 * module doc.
 */
export interface NewsletterPublicConfig {
  turnstileSiteKey: string;
}

/** The browser-safe projection of {@link NewsletterConfig}. `null` in, `null` out. */
export function toNewsletterPublicConfig(config: NewsletterConfig | null): NewsletterPublicConfig | null {
  if (config === null) return null;
  return { turnstileSiteKey: config.turnstileSiteKey };
}

/**
 * Where a subscription came from, forwarded to the endpoint as `source` so an
 * operator can tell landing-page signups from any other capture point.
 */
export const NEWSLETTER_SOURCE = 'openplate-landing';
