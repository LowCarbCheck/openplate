import type { AnalyticsConfig } from '#app/config/analytics';
/**
 * The app's ONE server → browser configuration channel (M128 spec 04).
 *
 * Everything else this app knows about its environment stays on the server:
 * there is no `window.ENV` dump here and there must never be one. `CONFIG`
 * reads secrets from nowhere (M128 spec 03), but "no secrets" is not the same
 * as "safe to broadcast" — a database host or a proxy setting is still
 * operational detail a page has no business carrying. So this is a MINIMAL
 * ALLOWLIST with exactly one member, and adding a second is a deliberate act
 * that should come with a reason written down next to it.
 *
 * There are two members now (M138 spec 06 added the second). Both are
 * addresses the BROWSER has to dial itself, which is the only thing that earns
 * a place here.
 *
 * The first is the sync server's base URL. It has to reach the
 * browser because the sync client runs entirely in the browser: it derives
 * keys there, encrypts there, and talks to the service directly from there,
 * never through this server (see `openplate-sync/PROTOCOL.md` §4.1 — bearer
 * tokens, no cookies, `Access-Control-Allow-Origin: *`).
 *
 * Pure module: no `process.env` reads, no imports from `#app/config`. The
 * parsing happens here, the environment lookup happens in `index.ts`, and the
 * result travels through the root loader. That split is what lets the gating
 * rules below be unit-tested without an environment.
 */

/**
 * An instance-provided AI endpoint an operator has wired up for everyone using
 * their instance (M138 spec 06) — typically an `openplate-inference` container
 * sitting next to openplate in the same compose file.
 *
 * ── READ THIS BEFORE PUTTING A KEY IN `DEFAULT_INFERENCE_API_KEY` ─────────
 *
 * `apiKey` is delivered to EVERY BROWSER that can load this instance. It is
 * embedded in the HTML the root loader renders, so anyone who can open the app
 * — and anyone who can read that HTML — has the key. That is household /
 * private-deployment trust: a key that is a secret from the internet, not from
 * your own users. It is emphatically NOT a way to hand a paid cloud provider
 * key to a public instance's visitors.
 *
 * This does not weaken the BYOK promise in the other direction: the endpoint is
 * still called browser → endpoint directly, the openplate server still proxies
 * nothing, and a user's own manually-entered key still never leaves their
 * device. See "BYOK Security Rules" in AGENTS.md.
 */
export interface InstanceInferencePreset {
  /** Absolute `http(s)` base URL of the OpenAI-compatible endpoint, no trailing slash. */
  baseUrl: string;
  /** Bearer key for that endpoint, or `null` when it needs none. PUBLIC — see above. */
  apiKey: string | null;
  /** Model id to request (`DEFAULT_INFERENCE_MODEL`). */
  model: string;
}

/**
 * The model an instance preset requests when the operator didn't name one —
 * openplate-inference's own served model id (M138 spec 02).
 */
export const DEFAULT_INSTANCE_INFERENCE_MODEL = 'openplate-plate-1';

/** The exact object the root loader serializes into the HTML. Nothing else crosses. */
export interface PublicConfig {
  /**
   * Base URL of the sync service this instance points its clients at
   * (`SYNC_SERVER_URL`), or `null` when sync is off.
   *
   * `null` is the DEFAULT and the self-host default: with it, no sync UI
   * renders anywhere in the app and no sync request ever leaves the browser.
   * openplate is a local-first tracker first; sync is an opt-in an operator
   * turns on, not a feature that quietly phones somewhere when unconfigured.
   */
  syncServerUrl: string | null;
  /**
   * The Matomo instance this deployment reports to (`MATOMO_URL` +
   * `MATOMO_SITE_ID`), or `null` when the operator configured none.
   *
   * `null` is the DEFAULT and the self-host default. It earns its place in
   * this deliberately minimal allowlist on the same test the other two members
   * pass: it is an address the BROWSER dials itself. The tracker script is
   * loaded by the page and the beacon is sent by the page; this server never
   * proxies either, which is what keeps analytics off the request path of a
   * user's actual data.
   *
   * It also drives the landing page's tracking card, so the claim a visitor
   * reads matches the instance they are reading it on rather than a hardcoded
   * string that is right on exactly one deployment.
   */
  analytics: AnalyticsConfig | null;
  /**
   * The instance's own AI endpoint (`DEFAULT_INFERENCE_BASE_URL` and friends),
   * or `null` when the operator configured none.
   *
   * `null` is the DEFAULT and the self-host default, and it means exactly what
   * `syncServerUrl: null` means for sync: zero UI, zero payload difference. No
   * card renders, no key ships to the browser, and BYOK is the only path — the
   * app behaves byte-for-byte as it did before this field existed.
   */
  instancePreset: InstanceInferencePreset | null;
}

/**
 * Parses `SYNC_SERVER_URL` into the value {@link PublicConfig.syncServerUrl}
 * carries.
 *
 * Deliberately strict, and deliberately silent-on-absence:
 * - unset, empty, or whitespace → `null` (sync off — the default)
 * - a syntactically valid absolute `http`/`https` URL → that URL with any
 *   trailing slash trimmed, so `${base}${SYNC_API_PREFIX}` never produces a
 *   double slash
 * - anything else → THROWS
 *
 * The throw is the point. A typo'd sync URL that quietly resolved to `null`
 * would present a working, sync-free app to an operator who believes they
 * enabled sync, and the failure would surface as "my second device never sees
 * anything" weeks later. Failing at boot is the cheaper of the two.
 */
export function parseSyncServerUrl(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`SYNC_SERVER_URL is not a valid absolute URL: ${trimmed}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`SYNC_SERVER_URL must be an http(s) URL, got ${parsed.protocol}`);
  }
  return trimmed.replace(/\/+$/, '');
}

/**
 * The CSP `connect-src` entry the sync server needs, or `null` when sync is
 * off.
 *
 * Only the ORIGIN is returned, never the full URL: `connect-src` matches on
 * scheme/host/port, and a path component in a source expression is both
 * meaningless for `connect-src` and a source of "why is my CSP silently not
 * matching" confusion. Kept here rather than in `server.ts` so the derivation
 * is unit-testable without booting Express.
 */
export function syncConnectSrcOrigin(syncServerUrl: string | null): string | null {
  if (syncServerUrl === null) return null;
  return new URL(syncServerUrl).origin;
}

/**
 * Whether any sync UI may render at all.
 *
 * One predicate, used by every sync surface (the settings route, the profile
 * card, the diary empty state's "enable sync" link), so "sync is off" can
 * never be true on one screen and false on another.
 */
export function isSyncConfigured(config: PublicConfig | undefined): boolean {
  return (config?.syncServerUrl ?? '').length > 0;
}

/**
 * Parses the three `DEFAULT_INFERENCE_*` env vars into the preset the browser
 * receives, or `null` when the operator set none.
 *
 * Same shape of contract as {@link parseSyncServerUrl}, for the same reasons:
 * - `baseUrl` unset/blank → `null`, i.e. the feature is simply off (the
 *   default). Nothing else is read in that case, so a stray
 *   `DEFAULT_INFERENCE_API_KEY` with no base URL can never reach a browser.
 * - `baseUrl` malformed or non-`http(s)` → THROWS at boot. A typo that
 *   degraded to `null` would present an ordinary BYOK-only app to an operator
 *   who believes they gave their household one-click AI, and the "bug report"
 *   would arrive as "the button never showed up".
 * - `apiKey` blank/unset → `null` (an endpoint that needs no key — the common
 *   local case).
 * - `model` blank/unset → {@link DEFAULT_INSTANCE_INFERENCE_MODEL}.
 *
 * Takes an options object rather than reading `process.env` so it stays pure
 * and unit-testable; `app/config/index.ts` does the environment lookup.
 */
export function parseInstanceInferencePreset({
  baseUrl,
  apiKey,
  model,
}: {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  model: string | undefined;
}): InstanceInferencePreset | null {
  if (baseUrl === undefined || baseUrl.trim() === '') return null;
  const trimmed = baseUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`DEFAULT_INFERENCE_BASE_URL is not a valid absolute URL: ${trimmed}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`DEFAULT_INFERENCE_BASE_URL must be an http(s) URL, got ${parsed.protocol}`);
  }
  const trimmedKey = apiKey?.trim() ?? '';
  const trimmedModel = model?.trim() ?? '';
  return {
    baseUrl: trimmed.replace(/\/+$/, ''),
    apiKey: trimmedKey === '' ? null : trimmedKey,
    model: trimmedModel === '' ? DEFAULT_INSTANCE_INFERENCE_MODEL : trimmedModel,
  };
}

/**
 * The CSP `connect-src` entry the instance endpoint needs, or `null` when there
 * is no preset — same origin-only rule as {@link syncConnectSrcOrigin}.
 *
 * Without this a preset pointing at anything other than loopback (the CSP's
 * standing carve-out for local endpoints) would be blocked in production the
 * moment the browser tried to scan, with a one-click "Connect" button that
 * appears to work and a scan that always fails.
 */
export function inferenceConnectSrcOrigin(preset: InstanceInferencePreset | null): string | null {
  if (preset === null) return null;
  return new URL(preset.baseUrl).origin;
}

/**
 * THE GATE for every instance-AI surface: the preset, or `null`.
 *
 * `undefined` config (an error boundary, where the root loader never ran)
 * resolves to `null` — the safe direction, identical to how the sync surfaces
 * treat it. A caller that gets `null` renders nothing at all; there is no
 * disabled-button state.
 */
export function getInstanceInferencePreset(config: PublicConfig | undefined): InstanceInferencePreset | null {
  return config?.instancePreset ?? null;
}
