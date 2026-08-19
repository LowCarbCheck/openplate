/**
 * The one place a provider is described (M130/01). Everything that used to be
 * a per-provider `if (provider === '<literal>')` branch or a hand-maintained
 * parallel map — the adapter dispatch (`./index`), the live key check
 * (`./verify-key`), the OAuth capability table, the display label, and the
 * settings page's primary-vs-advanced grouping — now reads a single
 * `Record<AiProviderType, ProviderDefinition>`. Adding a provider is one new
 * entry, and the compiler refuses to build until every field is supplied.
 *
 * THE ROUTING PROSE LIVES HERE, not on `AiProviderType` (M130/04): which
 * adapter a provider rides on is a property of its entry below, not of the
 * enum. `openrouter` and `mistral` both run the openai-compatible wire adapter
 * against a fixed base URL — OpenRouter as one key for every model (plus
 * attribution headers), Mistral as a direct EU-hosted endpoint — while
 * `openai-compatible` is the same adapter pointed at the user's own address
 * and `anthropic` is its own adapter.
 *
 * DELIBERATELY A DATA LEAF: this module imports only `./constants` (wire
 * constants, no `fetch`) so that a server-side consumer — the CSP's
 * `connect-src` derivation — can read it without dragging in the adapters,
 * their prompts, or their schemas.
 *
 * Security: carries no secret material. Nothing here is ever logged, and no
 * API key, base URL or header VALUE passes through this module — the auth
 * headers are built by the call-time helpers in `./constants` from a key the
 * caller holds.
 */
import type { AiProviderType } from '#types/enums';
import {
  ANTHROPIC_KEYS_URL,
  MISTRAL_KEYS_URL,
  OPENROUTER_BASE_URL,
  OPENROUTER_KEYS_URL,
  getOpenrouterAttributionHeaders,
} from './constants';

/** How a user hands openplate a key for a provider, in UI-preference order. */
export type AuthMethod = 'manual' | 'oauth-pkce';

/** Whether the provider gets its own primary tab or sits behind "Advanced". */
export type ProviderPlacement = 'primary' | 'advanced';

/** Which wire adapter runs the scan — a tag, not a factory (see `./index`). */
export type VisionAdapterTag = 'openai-compatible' | 'anthropic';

/**
 * How to build the live "is this key valid" request. A union rather than a
 * URL string because the providers genuinely differ in WHERE the check goes:
 * OpenRouter's `/models` answers 200 to any request (key or no key), so it
 * needs its key-introspection endpoint instead, and a self-hosted endpoint's
 * path can only be composed once the user's own base URL is known.
 *
 * Auth headers are deliberately NOT part of this — they are a property of the
 * adapter (`./constants`' `getAnthropicAuthHeaders` / bearer) plus
 * `extraHeaders`, byte-identical between the scan call and the key check.
 */
export type VerificationStrategy =
  /**
   * `GET <base URL><path>`, where the base URL is the definition's when it is
   * fixed and the user's when `baseUrl` is `null`.
   */
  | { readonly kind: 'base-url-path'; readonly path: string }
  /**
   * `GET <url>` — for a provider whose key check does not live under the base
   * URL its adapter composes requests from (Anthropic's adapter hardcodes a
   * full endpoint and has no base-URL concept at all).
   */
  | { readonly kind: 'absolute-url'; readonly url: string };

export interface ProviderDefinition {
  readonly id: AiProviderType;
  /** i18n key for the display name — resolved by the caller, never a literal string. */
  readonly labelKey: string;
  /** Auth methods in UI-preference order. Drives the Connect button with no literals. */
  readonly authMethods: readonly AuthMethod[];
  /**
   * Fixed endpoint, or `null` when the user must supply their own base URL.
   * Load-bearing only for the openai-compatible-adapter providers
   * (`openrouter`, `mistral`, `openai-compatible`) — that adapter composes
   * every request from this value. For `anthropic` it is INERT:
   * `createAnthropicProvider` (`./anthropic.ts`) hardcodes
   * `ANTHROPIC_MESSAGES_URL` and never reads this field. It is still recorded
   * there because the production CSP's `connect-src` is derived from these
   * origins (M130/03), and a decorative-looking field one adapter silently
   * ignores is its own drift trap. See ADR-0007
   * (`.adr/0007-byok-provider-registry.md`).
   */
  readonly baseUrl: string | null;
  /** Extra request headers, computed at call time (OpenRouter attribution reads `window`). */
  readonly extraHeaders?: () => Record<string, string>;
  /** How to build the live key check — per-provider because OpenRouter's `/models` 200s on a bad key. */
  readonly verification: VerificationStrategy;
  /** Which wire adapter runs the scan. */
  readonly adapter: VisionAdapterTag;
  /** Primary tab vs. behind the "Advanced" panel. */
  readonly placement: ProviderPlacement;
  /** Where a user goes to mint a key — `null` for a self-hosted endpoint, which has no vendor dashboard. */
  readonly keyConsoleUrl: string | null;
}

/** One definition per provider — the registry is total over `AiProviderType`. */
type ProviderRegistry = { readonly [K in AiProviderType]: ProviderDefinition };

export const PROVIDER_REGISTRY: ProviderRegistry = {
  openrouter: {
    id: 'openrouter',
    labelKey: 'settingsAi.provider.openrouter',
    // The only provider with a browser-only OAuth PKCE flow today (M127/01
    // spike: CORS-enabled token exchange, arbitrary `callback_url` accepted).
    authMethods: ['oauth-pkce', 'manual'],
    baseUrl: OPENROUTER_BASE_URL,
    extraHeaders: getOpenrouterAttributionHeaders,
    // NOT `/models` — OpenRouter's models list is public and answers 200 to
    // any request, key or no key (confirmed directly: `curl` with a bogus
    // key, and with no Authorization header at all, both return 200). That
    // made the key check a no-op — any string was accepted, saved, and
    // announced as "verified," with the bad key only surfacing later as a
    // scan failure blamed on the photo. `/auth/key` is OpenRouter's
    // key-introspection endpoint: it requires a valid key and returns 401
    // for a missing or bad one.
    verification: { kind: 'base-url-path', path: '/auth/key' },
    adapter: 'openai-compatible',
    placement: 'primary',
    keyConsoleUrl: OPENROUTER_KEYS_URL,
  },
  mistral: {
    id: 'mistral',
    labelKey: 'settingsAi.provider.mistral',
    // Manual key only. There is no third-party authorize flow to build on:
    // the Mistral console's Google/GitHub/Microsoft/Apple buttons are account
    // sign-in, not key provisioning, and their own client library still has an
    // open request for even a device-code grant
    // (https://github.com/mistralai/client-python/issues/295).
    authMethods: ['manual'],
    // Fixed endpoint, reachable straight from the browser: `OPTIONS
    // /v1/chat/completions` answers `access-control-allow-origin: *`, so BYOK
    // needs no proxy and no Anthropic-style direct-browser-access opt-in
    // (live-probed 2026-08-04).
    baseUrl: 'https://api.mistral.ai/v1',
    // `/models`, unlike OpenRouter's, is a REAL key check here: it returns 401
    // both for a bogus key and for a request with no Authorization header at
    // all (live-probed 2026-08-04, same `access-control-allow-origin: *`).
    verification: { kind: 'base-url-path', path: '/models' },
    adapter: 'openai-compatible',
    placement: 'primary',
    keyConsoleUrl: MISTRAL_KEYS_URL,
  },
  'openai-compatible': {
    id: 'openai-compatible',
    labelKey: 'settingsAi.provider.openaiCompatible',
    authMethods: ['manual'],
    // No fixed endpoint: the user's own Ollama/vLLM/LM Studio address. A
    // `null` here is what makes both the scan call and the key check demand
    // one rather than silently falling back to api.openai.com, which the
    // browser can never reach anyway (CSP/CORS).
    baseUrl: null,
    verification: { kind: 'base-url-path', path: '/models' },
    adapter: 'openai-compatible',
    placement: 'advanced',
    keyConsoleUrl: null,
  },
  anthropic: {
    id: 'anthropic',
    labelKey: 'settingsAi.provider.anthropic',
    authMethods: ['manual'],
    // Recorded even though `createAnthropicProvider` composes no URLs from
    // it: this is the origin the browser talks to, which is what the CSP's
    // `connect-src` is derived from.
    baseUrl: 'https://api.anthropic.com/v1',
    verification: { kind: 'absolute-url', url: 'https://api.anthropic.com/v1/models' },
    adapter: 'anthropic',
    placement: 'advanced',
    keyConsoleUrl: ANTHROPIC_KEYS_URL,
  },
};

/**
 * Tuple form, for `z.enum` and iteration order — `Object.keys` is typed
 * `string[]`, which `z.enum` will not accept. Order is the BASE order the
 * settings page offers providers in: the primary tabs first, then the
 * providers behind "Advanced". The one thing layered on top of it is
 * presentation-only — `recommendedProviderFor`
 * (`app/models/ai-provider-recommendation.ts`) rotates the recommended
 * provider to the front of the primary group for the UI language. Nothing
 * about storage, validation or dispatch reads that order.
 */
// Deliberately one line (two columns over `printWidth`): the tuple, its `as
// const`, and the `satisfies` constraint are a single guarantee, and the
// milestone's verification greps for them together.
// prettier-ignore
export const PROVIDER_IDS = ['openrouter', 'mistral', 'openai-compatible', 'anthropic'] as const satisfies readonly AiProviderType[];

/** Compiles only for `never` — the assertion vehicle for the check below. */
type AssertNever<T extends never> = T;

/**
 * Compile-time exhaustiveness: adding a member to `AiProviderType` without
 * adding it to `PROVIDER_IDS` leaves `Exclude<...>` non-`never`, which fails
 * `AssertNever`'s constraint and breaks `pnpm typecheck`. (`PROVIDER_REGISTRY`
 * is already exhaustive by virtue of `Record<AiProviderType, …>`; this covers
 * the tuple, which a `satisfies` alone cannot.)
 */
export type ProviderIdsAreExhaustive = AssertNever<Exclude<AiProviderType, (typeof PROVIDER_IDS)[number]>>;

/**
 * The ONLY sanctioned way to look a provider up. Never index
 * `PROVIDER_REGISTRY` directly with a value that came from storage: the
 * device's BYOK settings are an opaque JSON blob
 * (`app/lib/local-store/ai-settings.ts`) with no schema behind it, so a row
 * written by a newer build — then rolled back one image — hands this app a
 * provider it has never heard of. Local-first data outlives the code that
 * wrote it. Callers degrade an `undefined` to "not connected" and prompt the
 * user to reconnect, rather than throwing a TypeError deep in render.
 */
export function getProviderDefinition(provider: string): ProviderDefinition | undefined {
  // `Object.hasOwn`, not a truthiness check: a plain index would happily
  // return `Object.prototype`'s members for e.g. `'toString'`.
  if (!Object.hasOwn(PROVIDER_REGISTRY, provider)) return undefined;
  // SAFETY: `Object.hasOwn` above proved `provider` is an own key of
  // `PROVIDER_REGISTRY`, whose keys are exactly `AiProviderType`.
  return PROVIDER_REGISTRY[provider as AiProviderType];
}

/** Provider definitions in UI order, filtered to one placement group. */
export function getProvidersByPlacement(placement: ProviderPlacement): readonly ProviderDefinition[] {
  return PROVIDER_IDS.map((id) => PROVIDER_REGISTRY[id]).filter((definition) => definition.placement === placement);
}

/**
 * Whether `provider` supports the one-click OAuth PKCE connect flow. Kept as a
 * function (rather than pushing `authMethods.includes` into JSX) so the Connect
 * button components need no edit when a second OAuth-capable provider lands.
 */
export function supportsOauthPkce(provider: AiProviderType): boolean {
  return PROVIDER_REGISTRY[provider].authMethods.includes('oauth-pkce');
}
