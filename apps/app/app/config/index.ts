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
import {
  assertGatewayUrlUnset,
  isManagedInstance,
  parseInstanceInferencePreset,
  parseInstanceMode,
  parseSyncServerUrl,
} from './public-config';
import { SUPPORTED_LANGUAGES, isLanguageCode, type LanguageCode } from '#app/i18n/language-prefs';
import {
  DEFAULT_NUTRIENT_REFERENCE_BASIS,
  NUTRIENT_REFERENCE_BASES,
  isNutrientReferenceBasis,
} from '#app/lib/nutrient-reference';
import type { NutrientReferenceBasis } from '#app/lib/nutrient-reference';
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
  /**
   * The instance's LowCarbCheck API key, sent as `Authorization: Bearer <key>`,
   * or `null` for the anonymous tier (the default, and byte-identical to the
   * behaviour before this field existed: no header is sent at all).
   *
   * SERVER ONLY, and it has to be. LowCarbCheck's API is CORS-open, so a key
   * that reached a browser would be a public key. It is deliberately absent
   * from `PublicConfig`'s allowlist (`app/config/public-config.ts`) and from
   * every loader payload, and it is never logged: the display prefix
   * (`foodDbKeyDisplayPrefix`) is what a log line may carry.
   */
  apiKey: string | null;
  /**
   * Whether this instance passes AI-named foods on to LowCarbCheck as
   * proposals (M251/04, `FOOD_DB_BACKFILL`). True only when the operator asked
   * for it AND the integration is on AND a key is set, because the proposal
   * endpoint accepts keyed servers only. See {@link resolveFoodDbBackfill}.
   */
  backfill: boolean;
}

const DEFAULT_FOOD_DB_API_URL = 'https://lowcarbcheck.org';

/** The three environment variables the food-database integration is built from. */
interface FoodDbEnv {
  /** `FOOD_DB_BACKFILL`, raw: `true`, `false`, or unset. See {@link resolveFoodDbBackfill}. */
  backfill: string | undefined;
  /** `FOOD_DB_API_URL`, raw. Its three states are the whole point, see below. */
  apiUrl: string | undefined;
  /** `FOOD_DB_API_KEY`, raw. Unset, empty and whitespace-only all mean the anonymous tier. */
  apiKey: string | undefined;
}

/**
 * Normalizes `FOOD_DB_API_KEY`. Blank and whitespace-only are `null` rather
 * than an empty string, so a half-filled `.env` line cannot produce an
 * `Authorization: Bearer ` header that the upstream reads as a bad key.
 */
function parseFoodDbApiKey(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Parses `FOOD_DB_API_URL` into the food-database integration config. This
 * cannot use `optionalEnv` because that helper treats an empty string the same
 * as "unset" — here the two must differ:
 *
 * - unset -> the public default (integration ON)
 * - explicit empty string -> integration OFF (a self-hoster's opt-out switch,
 *   so no food names ever leave their box)
 * - any URL -> that URL (integration ON), trailing slash trimmed
 *
 * `FOOD_DB_API_KEY` rides along (M238 spec 01). It is an OPTIONS OBJECT rather
 * than two positional strings because both parameters are `string | undefined`
 * and a swapped pair would compile, send the key as the base URL, and fail in
 * a way no type checks.
 */
export function parseFoodDbConfig(env: FoodDbEnv): FoodDbConfig {
  const apiKey = parseFoodDbApiKey(env.apiKey);
  if (env.apiUrl === undefined) {
    return {
      enabled: true,
      apiUrl: DEFAULT_FOOD_DB_API_URL,
      apiKey,
      backfill: resolveFoodDbBackfill({ raw: env.backfill, isEnabled: true, apiKey }),
    };
  }
  const trimmed = env.apiUrl.trim();
  // Integration OFF: no request ever goes out, so the key is dropped here
  // rather than carried around in a config nothing reads.
  if (trimmed === '') {
    return {
      enabled: false,
      apiUrl: '',
      apiKey: null,
      backfill: resolveFoodDbBackfill({ raw: env.backfill, isEnabled: false, apiKey: null }),
    };
  }
  return {
    enabled: true,
    apiUrl: trimmed.replace(/\/+$/, ''),
    apiKey,
    backfill: resolveFoodDbBackfill({ raw: env.backfill, isEnabled: true, apiKey }),
  };
}

/**
 * Parses `FOOD_DB_BACKFILL` (M251/04): whether AI-named foods are proposed to
 * LowCarbCheck.
 *
 * OFF BY DEFAULT, and off unless all three hold: the operator wrote `true`,
 * the integration is on, and a key is set. LowCarbCheck accepts proposals
 * from keyed servers only, so `true` without a key would send requests that
 * are refused every time; it is read as off instead, and the operator sees
 * the reason in the docs, not in a stream of refusals.
 *
 * Unset and empty are `false`. Any word other than `true` or `false` stops the
 * boot, the house rule for a typo: `FOOD_DB_BACKFILL=ture` is somebody who
 * wanted it on.
 *
 * @param options.raw - `FOOD_DB_BACKFILL`, raw.
 * @param options.isEnabled - whether the food-database integration is on at all.
 * @param options.apiKey - the parsed key, or `null`.
 * @returns whether this instance sends proposals.
 */
export function resolveFoodDbBackfill(options: {
  raw: string | undefined;
  isEnabled: boolean;
  apiKey: string | null;
}): boolean {
  const value = options.raw?.trim().toLowerCase() ?? '';
  if (value !== '' && value !== 'true' && value !== 'false') {
    throw new Error(`FOOD_DB_BACKFILL must be "true" or "false", got "${options.raw}".`);
  }
  return value === 'true' && options.isEnabled && options.apiKey !== null;
}

/**
 * Parses `DEFAULT_UI_LANGUAGE` — the language a visitor who has NOT yet chosen
 * one is served.
 *
 * ── THIS IS ONE OF THREE THINGS SPELLED "DEFAULT LANGUAGE"; IT IS NOT THE OTHER TWO ──
 *
 *  1. THIS ONE: the instance default. Only `app/root.tsx`'s loader consumes it,
 *     at the single point where a request arrives with no locale cookie. It is
 *     the operator's choice and the only one of the three that is configurable.
 *  2. `DEFAULT_LANGUAGE` in `app/i18n/language-prefs.ts`: the value-level
 *     fallback for a cookie or loader payload that did not parse. ~24 call
 *     sites. Stays `'en'`.
 *  3. `fallbackLng` in `app/i18n/i18n.ts`: i18next's MISSING-KEY fallback.
 *     Stays `'en'`, and must — `en` is the reference bundle. Point it at `de`
 *     and a key missing from German falls back to German, which resolves to
 *     nothing and renders the raw key path to the user.
 *
 * Collapsing them would look like a tidy-up and behave like a bug.
 *
 * ── WHY AN UNKNOWN CODE IS A BOOT FAILURE ───────────────────────────────────
 * An operator who wrote `DEFAULT_UI_LANGUAGE=fr` wants French. Falling back to
 * English would serve the wrong language to every visitor, forever, and say
 * nothing. There is no correct silent answer here, so there is no silent answer.
 *
 * Unset and empty both mean `en`, which is what every instance gets today.
 */
export function parseDefaultUiLanguage(raw: string | undefined): LanguageCode {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '') return 'en';
  if (!isLanguageCode(value)) {
    throw new Error(
      `Invalid DEFAULT_UI_LANGUAGE: expected one of ${SUPPORTED_LANGUAGES.join('/')}, got "${raw}". ` +
        'It is refused rather than ignored because ignoring it would serve the wrong language to every ' +
        'visitor with no cookie, and log nothing.',
    );
  }
  return value;
}

/**
 * Parses `NUTRIENT_REFERENCE_BASIS` (M234 spec 05), the published reference
 * document an instance's `/nutrients` screen quotes.
 *
 * Unset and empty both mean `dge`, the German DGE values, because this
 * instance's people are advised by that body. The basis is per INSTANCE and
 * never per language or per person: language and reference body are
 * orthogonal, and a Turkish speaker in Germany is advised by the same body as
 * a German speaker.
 *
 * An unrecognised value throws at boot for the same reason
 * `DEFAULT_UI_LANGUAGE` does. An operator who typed `efas` wants EFSA, and
 * silently serving DGE instead would put the wrong document's numbers in front
 * of every visitor and say nothing.
 */
export function parseNutrientReferenceBasis(raw: string | undefined): NutrientReferenceBasis {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '') return DEFAULT_NUTRIENT_REFERENCE_BASIS;
  if (!isNutrientReferenceBasis(value)) {
    throw new Error(
      `Invalid NUTRIENT_REFERENCE_BASIS: expected one of ${NUTRIENT_REFERENCE_BASES.join('/')}, got "${raw}". ` +
        'It is refused rather than ignored because ignoring it would quote the wrong standards body to ' +
        'every visitor, under a footnote naming a document nobody chose.',
    );
  }
  return value;
}

/**
 * Parses `OPENPLATE_BUILD_SHA` into the seven characters a short sha has, or
 * `null` when it is unset. Trimmed and truncated exactly as `vite.config.ts`
 * does, so the two readings of one variable cannot differ.
 */
export function parseBuildShaOverride(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value === undefined || value === '' ? null : value.slice(0, 7);
}

/**
 * Parses `UPDATE_CHECK` (M203).
 *
 * ON by default, which is a deliberate choice and not an oversight: an instance
 * that never says a newer version exists is an instance that quietly runs an old
 * one, and the person who set it up is usually the only person who could notice.
 * See ADR-0012 for what leaves the box and why the browser is not the caller.
 *
 * `off` (or `false`) turns it off completely: no timer is started, no request is
 * ever made, and `/api/update-status` answers `enabled: false`. Anything else,
 * including an unset variable, leaves it on. Deliberately NOT a boot failure on
 * a typo, unlike the analytics pair: a misspelt value here leaves the default
 * behaviour, which is the same behaviour the operator had before they touched
 * anything, and stopping an instance from booting over a version banner would be
 * out of all proportion.
 */
export function parseUpdateCheck(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value !== 'off' && value !== 'false';
}

/**
 * What KIND of instance this is, decided once before `CONFIG` is built.
 *
 * `managed` is derived from BOTH values, so they are read here rather than
 * inline below: parsing either one twice inside the object literal would mean
 * two chances for the two readings to drift apart.
 *
 * The refusal comes FIRST. `GATEWAY_URL` is the variable that used to make an
 * instance managed, and an operator who upgrades without editing their
 * environment must not get an open instance out of a file that still reads as
 * a closed one — see `assertGatewayUrlUnset`.
 */
assertGatewayUrlUnset(process.env.GATEWAY_URL);
const SYNC_SERVER_URL = parseSyncServerUrl(process.env.SYNC_SERVER_URL);
const INSTANCE_MODE = parseInstanceMode(process.env.INSTANCE_MODE);

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
   * UI language (M167 spec 01).
   *
   * `defaultLanguage` answers exactly one question: what does a visitor see
   * BEFORE they have chosen? The locale cookie always wins over it — see
   * `app/root.tsx`'s loader, the only consumer. It is emphatically not a lock,
   * and it does not translate food names, AI replies, or anything the user typed.
   */
  i18n: {
    defaultLanguage: parseDefaultUiLanguage(process.env.DEFAULT_UI_LANGUAGE),
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
   *
   * `FOOD_DB_API_KEY` is optional and server-only: unset is the anonymous
   * tier, which is what every instance ran on before M238.
   */
  foodDb: parseFoodDbConfig({
    apiUrl: process.env.FOOD_DB_API_URL,
    apiKey: process.env.FOOD_DB_API_KEY,
    backfill: process.env.FOOD_DB_BACKFILL,
  }),

  /**
   * Micronutrient reference basis (M234 spec 05)
   *
   * Which published document the `/nutrients` screen quotes: the German DGE
   * (default), EFSA, or the US NASEM/IOM values. One basis per instance, named
   * on screen by its own `source` string. `/api/nutrients?basis=` overrides it
   * per request; see that route for why a typo there is a 400 rather than a
   * quiet fall back to this default.
   */
  nutrients: {
    referenceBasis: parseNutrientReferenceBasis(process.env.NUTRIENT_REFERENCE_BASIS),
  },

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
    syncServerUrl: SYNC_SERVER_URL,
  },

  /**
   * What KIND of instance this is (M192)
   *
   * `INSTANCE_MODE` unset is the DEFAULT and the self-host default: `managed`
   * is `false` and the app is an anonymous local diary anyone can start, with
   * sync an optional extra and AI a provider key the person brings.
   *
   * `INSTANCE_MODE=managed` says an organization runs this instance for its
   * people: an admin invites by email, there is no anonymous path because on
   * such an instance it leads nowhere, and the AI comes from the sync server
   * on the account's own daily allowance. It requires `SYNC_SERVER_URL` and
   * stops the boot without it — see `isManagedInstance`.
   *
   * It replaced `GATEWAY_URL`, which said the same thing by naming a second
   * service. There is no second service.
   */
  instance: {
    mode: INSTANCE_MODE,
    managed: isManagedInstance({ instanceMode: INSTANCE_MODE, syncServerUrl: SYNC_SERVER_URL }),
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
   *
   * `MATOMO_EVENT_LEVEL` decides how much the custom events may say once the
   * pair is set: `pageviews`, `product` (the default) or `research`. The
   * research level counts fasting, weight, clinician sharing and study
   * participation, which is why an operator has to name it rather than get it
   * by turning analytics on. A level set with no pair throws, for the same
   * reason a half-configured pair does.
   */
  analytics: parseAnalyticsConfig({
    matomoUrl: process.env.MATOMO_URL,
    siteId: process.env.MATOMO_SITE_ID,
    eventLevel: process.env.MATOMO_EVENT_LEVEL,
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
   * Build-time identity (M203)
   *
   * `OPENPLATE_BUILD_SHA` is the commit the image was built from. It is a DOCKER
   * BUILD ARGUMENT first and foremost, read by `vite.config.ts` and baked into
   * the bundles, because `.dockerignore` excludes `.git` and the alpine base has
   * no git binary, so the build cannot work it out for itself.
   *
   * It is read here as well, and only the DEV server consults the result
   * (`app/lib/build-info.server.ts`). Vite prefers the override over git when it
   * stamps the bundle, so a developer who sets the variable and did not get the
   * same preference on the server side would see the bundle and the server
   * disagree, which renders as a permanent and false "a newer version of this
   * page is ready". `null` when unset, which is every normal case.
   */
  build: {
    shaOverride: parseBuildShaOverride(process.env.OPENPLATE_BUILD_SHA),
  },

  /**
   * The release check (M203)
   *
   * `checkEnabled` is the single switch behind `UPDATE_CHECK`. It gates the boot
   * timer, the six-hourly one, and the manual button alike, so `off` means no
   * request to GitHub can originate here by any path. See
   * `app/lib/update-check.server.ts` for what the request contains.
   */
  updates: {
    checkEnabled: parseUpdateCheck(process.env.UPDATE_CHECK),
  },

  /**
   * Feature Flags
   */
  features: {
    debugMode: optionalBoolEnv('DEBUG_MODE', false),
  },
} as const;

export type Config = typeof CONFIG;
