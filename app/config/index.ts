/**
 * Centralized Application Configuration
 *
 * Single source of truth for all environment variable access.
 *
 * Benefits:
 * - Type-safe configuration access throughout the application
 * - Single place to see all environment variable requirements
 * - Runtime validation with clear error messages
 * - Easy to mock for testing
 * - Clear separation of concerns: environment config vs domain config vs constants
 *
 * Usage:
 * ```typescript
 * import { CONFIG } from '#app/config';
 *
 * const port = CONFIG.server.port;
 * const isProduction = CONFIG.app.isProduction;
 * ```
 */

import { optionalEnv, optionalBoolEnv, optionalIntEnv } from '#app/lib/env';
import { parseInstanceInferencePreset, parseSyncServerUrl } from './public-config';
import { parseAnalyticsConfig } from '#app/config/analytics';
import { parseNewsletterConfig } from './newsletter';

/**
 * Parses the `TRUST_PROXY` env var into a value suitable for Express's
 * `app.set('trust proxy', <value>)`. Deliberately polymorphic (matches
 * Express's own accepted argument shapes), so this does NOT use the
 * single-type `optional*Env` helpers above.
 *
 * - unset/empty -> `1` hop in production (single Traefik hop), `false` otherwise
 *   (dev/test has no proxy in front of it and must not trust spoofable
 *   X-Forwarded-* headers)
 * - 'true' / 'false' (case-insensitive) -> boolean
 * - integer string (e.g. '1', '2') -> number of hops to trust
 * - anything else -> trimmed string as-is (Express presets/CIDRs, e.g.
 *   'loopback', '10.0.0.0/8', 'uniquelocal', or a comma-separated list)
 */
function parseTrustProxy(raw: string | undefined, isProduction: boolean): boolean | number | string {
  if (raw === undefined || raw.trim() === '') return isProduction ? 1 : false;
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * Parses `CSP_CONNECT_EXTRA` — a space-separated list of extra origins a
 * self-hoster/operator wants their `connect-src` CSP directive to allow
 * (e.g. a remote openai-compatible endpoint that isn't `localhost`). Empty
 * when unset, which is the common case: the CSP's baked-in carve-out already
 * covers `localhost`/`127.0.0.1`/`[::1]` for local self-hosted endpoints —
 * see `server.ts`'s `CONTENT_SECURITY_POLICY`.
 */
function parseCspConnectExtra(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(/\s+/)
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

/** Resolved LowCarbCheck food-database integration settings (see `CONFIG.foodDb`). */
export interface FoodDbConfig {
  /** When false, the food-resolution service short-circuits to empty matches — no HTTP calls at all. */
  enabled: boolean;
  /** Base URL of the public LowCarbCheck food API (no trailing slash). Empty string when disabled. */
  apiUrl: string;
}

const DEFAULT_FOOD_DB_API_URL = 'https://lowcarbcheck.org';

/**
 * Parses `FOOD_DB_API_URL` into the food-database integration config. This
 * cannot use `optionalEnv` because that helper treats an empty string the same
 * as "unset" — here the two must differ:
 *
 * - unset -> the public default (integration ON)
 * - explicit empty string -> integration OFF (a self-hoster's opt-out switch,
 *   so no food names ever leave their box)
 * - any URL -> that URL (integration ON), trailing slash trimmed
 */
function parseFoodDbConfig(raw: string | undefined): FoodDbConfig {
  if (raw === undefined) return { enabled: true, apiUrl: DEFAULT_FOOD_DB_API_URL };
  const trimmed = raw.trim();
  if (trimmed === '') return { enabled: false, apiUrl: '' };
  return { enabled: true, apiUrl: trimmed.replace(/\/+$/, '') };
}

export const CONFIG = {
  /**
   * Application Environment
   */
  app: {
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    isDevelopment: process.env.NODE_ENV !== 'production',
    isProduction: process.env.NODE_ENV === 'production',
    isTest: process.env.NODE_ENV === 'test',
    url: optionalEnv('APP_URL', 'http://localhost:3000'),
  },

  /**
   * Server Configuration
   */
  server: {
    port: optionalIntEnv('PORT', 3000),
    hmrPort: optionalIntEnv('HMR_PORT', 24678),
    /**
     * Express `trust proxy` setting. Required behind a reverse proxy (Traefik)
     * so `request.url`'s host/proto reflect X-Forwarded-* headers — React
     * Router v8's CSRF check compares the browser's Origin against that host,
     * so without this, same-origin POST actions get aborted in production.
     * Configurable via TRUST_PROXY (see parseTrustProxy above for accepted formats).
     */
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY, process.env.NODE_ENV === 'production'),
  },

  /**
   * Security Configuration
   *
   * ZERO-SECRET BOOT (M128 spec 03): this app reads no secret from the
   * environment at all. The cookie-session signing key went with the sessions
   * themselves (there are no accounts), and the AES-256-GCM key went with the
   * server-side BYOK-at-rest encryption — the AI provider key lives on the
   * device (`app/lib/local-store/ai-settings.ts`) and never reaches this
   * server. There is no database either (the data-migration ledger and the
   * whole Postgres dependency went with it), so an empty environment is a
   * complete boot. Anything added below must keep that true.
   */
  security: {
    /**
     * Extra `connect-src` origins for the strict CSP (`server.ts`), space-
     * separated (e.g. `"https://ai.example.com https://ai2.example.com"`).
     * A self-hoster running their own remote (non-localhost) openai-compatible
     * endpoint sets this so their browser is allowed to call it directly —
     * the CSP otherwise only permits `'self'`, OpenRouter, Anthropic, and
     * localhost/127.0.0.1/[::1] (see the self-host docs in README.md).
     */
    cspConnectExtra: parseCspConnectExtra(process.env.CSP_CONNECT_EXTRA),
  },

  /**
   * Logging Configuration
   */
  logging: {
    level: optionalEnv('LOG_LEVEL', 'info'),
  },

  /**
   * LowCarbCheck Food Database Integration
   *
   * openplate resolves each identified plate food against the public
   * LowCarbCheck food API to attach curated per-100g nutrition + images.
   * Only food NAMES are ever sent — never photos, never user data. The whole
   * integration is fail-open and can be turned off by setting
   * `FOOD_DB_API_URL` to an empty string.
   */
  foodDb: parseFoodDbConfig(process.env.FOOD_DB_API_URL),

  /**
   * E2EE Sync (M128 spec 04)
   *
   * `syncServerUrl` is the ONE value this server publishes to the browser
   * (through the root loader's `publicConfig` — see
   * `app/config/public-config.ts` for why the channel is an allowlist rather
   * than an env dump). It is not a secret: the browser has to know the
   * address it is about to send encrypted blobs to.
   *
   * `null` (unset) turns sync off completely — no UI renders, no request
   * leaves. That is the self-host default; the hosted deployment sets it.
   * A malformed value throws at boot rather than degrading to `null`, so a
   * typo can't present as "sync is quietly disabled".
   */
  sync: {
    syncServerUrl: parseSyncServerUrl(process.env.SYNC_SERVER_URL),
  },

  /**
   * Optional Matomo analytics (M165/05) — `null` unless BOTH `MATOMO_URL` and
   * `MATOMO_SITE_ID` are set.
   *
   * `null` is the self-host default and is what keeps two public claims true
   * at once: the landing page's tracking card and `content-security-policy.ts`'s
   * "no third-party script on an unconfigured instance". A half-configured pair
   * throws at boot rather than degrading, exactly as the newsletter pair does —
   * see `app/config/analytics.ts` for why silence would be worse here.
   */
  analytics: parseAnalyticsConfig({
    matomoUrl: process.env.MATOMO_URL,
    siteId: process.env.MATOMO_SITE_ID,
  }),

  /**
   * Instance-provided AI endpoint (M138 spec 06)
   *
   * An operator running openplate next to an `openplate-inference` container
   * sets `DEFAULT_INFERENCE_BASE_URL` (plus optionally `_API_KEY`/`_MODEL`) and
   * every browser on that instance gets a one-click "use this instance's AI"
   * option instead of having to bring its own provider key.
   *
   * NOT A SECRET, BY CONSTRUCTION: like `syncServerUrl`, this whole object
   * travels to the browser through the root loader's `publicConfig` — including
   * the API key, which every visitor to the instance can therefore read. That
   * is household/private-deployment trust, and it is spelled out in
   * `public-config.ts`'s `InstanceInferencePreset` doc and in `.env.example`.
   * Never put a metered cloud provider key here.
   *
   * `DEFAULT_INFERENCE_MODEL` defaults to `openplate-plate-1` (the model id
   * openplate-inference serves) and `DEFAULT_INFERENCE_API_KEY` may be omitted
   * entirely for an endpoint that needs no key — the common local case.
   *
   * `null` (unset base URL) is the default and means zero UI and zero payload
   * difference. A malformed base URL throws at boot rather than silently
   * disabling the feature. See `parseInstanceInferencePreset`.
   */
  inference: {
    instancePreset: parseInstanceInferencePreset({
      baseUrl: process.env.DEFAULT_INFERENCE_BASE_URL,
      apiKey: process.env.DEFAULT_INFERENCE_API_KEY,
      model: process.env.DEFAULT_INFERENCE_MODEL,
    }),
  },

  /**
   * Optional newsletter capture on the landing page (M146 spec 02)
   *
   * `null` (both variables unset) is the DEFAULT and the self-host default: no
   * section renders, the landing action 404s, no Turnstile script loads and
   * the production CSP is byte-for-byte what it was before this existed. The
   * mailing list belongs to whoever runs the instance, so the software ships
   * with none — the same contract `sync` above has.
   *
   * `subscribeUrl` is SERVER-ONLY (operator topology); only the Turnstile site
   * key reaches the browser. See `app/config/newsletter.ts`.
   */
  newsletter: parseNewsletterConfig({
    subscribeUrl: process.env.NEWSLETTER_SUBSCRIBE_URL,
    turnstileSiteKey: process.env.NEWSLETTER_TURNSTILE_SITE_KEY,
  }),

  /**
   * Feature Flags
   */
  features: {
    debugMode: optionalBoolEnv('DEBUG_MODE', false),
  },
} as const;

export type Config = typeof CONFIG;
