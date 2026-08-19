/**
 * Per-provider wire constants and auth headers. Shared by the provider
 * adapters (`./anthropic`, `./openai-compatible` — the latter reached via
 * `./index`'s registry-driven dispatch) and the live key check
 * (`./verify-key`). Kept in one place so the scan call and the key check can
 * never drift apart: they authenticate against the same provider with the
 * same key, so they must send the same headers.
 *
 * Security: every helper here TAKES a key and returns headers; none stores,
 * caches, or logs one.
 */

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Where a user mints a key for each provider — the deep links the settings
 * page offers, surfaced as `keyConsoleUrl` on the provider registry.
 */
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/settings/keys';
export const ANTHROPIC_KEYS_URL = 'https://console.anthropic.com/settings/keys';
export const MISTRAL_KEYS_URL = 'https://console.mistral.ai/api-keys';

/**
 * OpenRouter attribution headers (used for their app rankings/analytics —
 * https://openrouter.ai/docs#custom-headers). Only ever attached on the
 * `openrouter` call path, never for `openai-compatible`/`anthropic`.
 *
 * WHY a function, not a constant: OpenRouter's OAuth consent screen and the
 * default key label it generates both display the app's real name only when
 * the attributed `HTTP-Referer` domain matches the OAuth `callback_url`
 * domain used to mint the key. A hardcoded GitHub URL can never match either
 * the hosted origin (openplate.lowcarbcheck.org) or any self-hosted
 * instance's own origin, so every deployment showed up to OpenRouter as an
 * anonymous "An app". Deriving the referer from `window.location.origin` at
 * call time makes every instance — hosted or self-hosted — attribute (and
 * eventually name) itself correctly. Both call sites run client-side only
 * (`verify-key.ts`'s browser-only key check, `index.ts`'s `createVisionProvider`
 * invoked from `scan.tsx`'s `clientAction`), so `window` is available in
 * practice; the fallback only guards non-browser contexts like unit tests.
 */
export function getOpenrouterAttributionHeaders() {
  const origin =
    globalThis.window === undefined ? 'https://github.com/openplate/openplate' : window.location.origin;
  return {
    'HTTP-Referer': origin,
    'X-Title': 'openplate',
  };
}

/** Anthropic's dated API-version header — required on every Messages/Models call. */
export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Anthropic's auth headers — THE one source, read by both the scan adapter
 * (`./anthropic`) and the live key check (`./verify-key`). They used to be
 * copied into both files; they are a property of the adapter, byte-identical
 * on either call, so a copy is only ever a way for the two to disagree.
 *
 * `anthropic-dangerous-direct-browser-access` opts this fetch into Anthropic's
 * direct browser-access mode. Since M117/02 the plate-identity call runs
 * client-side (the key never touches the openplate server), so the request
 * originates from the browser; without this header Anthropic rejects a
 * cross-origin `fetch` with a CORS error. Harmless when the same adapter is
 * exercised server-side (e.g. unit tests).
 */
export function getAnthropicAuthHeaders({ apiKey }: { apiKey: string }) {
  return {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}
