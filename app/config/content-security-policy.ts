/**
 * The production Content-Security-Policy, as a pure function of its inputs.
 *
 * Extracted out of `server.ts` (M128 spec 04) so it can be unit-tested.
 * `server.ts` starts a listener at import time, so nothing in it is reachable
 * from a test — which is how a policy that silently killed a whole feature in
 * production shipped past a green suite. A header this load-bearing needs a
 * regression guard, and a guard needs something importable.
 *
 * ── What this policy is for ──────────────────────────────────────────────
 *
 * The primary threat is XSS. The BYOK key lives client-side in IndexedDB
 * (`app/lib/local-store/ai-settings.ts`) and the sync passphrase is typed into
 * this page, so an injected script could read and exfiltrate both. This CSP
 * shrinks that injection/exfiltration surface; it does not eliminate it.
 * `connect-src` is the meaningful half — it decides where a compromised page
 * is allowed to send anything.
 *
 * PRODUCTION ONLY. Vite's dev server (HMR websocket, on-demand module fetches,
 * error overlay) needs a much looser policy, and getting that wrong silently
 * breaks local development. The cost of that split is visible in this file's
 * history: a directive can be wrong for months and only production notices.
 */

/**
 * Loopback carve-out for self-hosted openai-compatible endpoints (Ollama,
 * vLLM, LM Studio…) on the same box.
 *
 * A browser on an `https://` page treats these as potentially-trustworthy
 * origins reachable over plain `http://` anyway, and the mixed-content rule
 * already blocks a LAN `http://` IP regardless of CSP — so this costs nothing
 * real. No `ws:` scheme: these endpoints are plain HTTP REST.
 *
 * `[::1]` is deliberately absent: CSP source-list grammar does not accept
 * IPv6-literal hosts, so Chrome rejects the entry as invalid and logs a
 * console error on every page load while contributing nothing. Self-hosters
 * bound to `::1` should point their client at `localhost`.
 */
const LOOPBACK_ORIGINS = ['http://localhost:*', 'http://127.0.0.1:*'];

/**
 * Cloudflare Turnstile's origin — the ONE third-party script origin this app
 * can ever name, and only while `NEWSLETTER_SUBSCRIBE_URL` is set. The loader
 * that actually fetches it is `app/lib/turnstile.ts`.
 */
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

export interface ContentSecurityPolicyInput {
  /** The sync service's ORIGIN (`syncConnectSrcOrigin`), or `null` when sync is off. */
  syncOrigin: string | null;
  /** Extra operator-supplied `connect-src` origins (`CSP_CONNECT_EXTRA`). */
  connectExtra: readonly string[];
  /**
   * Origins the BYOK vision calls reach directly from the browser, derived
   * from `PROVIDER_REGISTRY`'s fixed base URLs (M130/03). `server.ts` does the
   * registry → origin derivation; this module stays a leaf and only places
   * the already-derived list into the header, so it never needs to import
   * `app/services/vision/*`.
   */
  providerOrigins: readonly string[];
  /**
   * Origin of the instance's own AI endpoint (`DEFAULT_INFERENCE_BASE_URL`,
   * M138 spec 06) — `inferenceConnectSrcOrigin(CONFIG.inference.instancePreset)`
   * — or `null` when no preset is configured.
   *
   * `providerOrigins` above CANNOT cover this: the preset drives the
   * `openai-compatible` registry entry, whose `baseUrl` is `null` precisely
   * because the endpoint is normally user-typed and therefore unknowable at
   * boot. A PRESET is different — the operator set it in this server's own
   * environment — so it is the one bring-your-own-endpoint address the CSP can
   * legitimately allowlist, and it must, for the same reason `syncOrigin`
   * exists: without it the one-click connect saves happily (a local-store
   * write, no network) and then every scan dies on a CSP violation with no
   * server-side symptom to debug from.
   */
  presetOrigin: string | null;
  /**
   * Whether the optional newsletter capture is configured
   * (`NEWSLETTER_SUBSCRIBE_URL` + `NEWSLETTER_TURNSTILE_SITE_KEY` — see
   * `app/config/newsletter.ts`).
   *
   * `false` is the default and the self-host default, and it MUST leave this
   * header byte-for-byte what it was before the newsletter existed. openplate
   * loads no third-party script at all on an unconfigured instance, and that
   * is a product claim rather than an accident: widening `script-src` for a
   * feature nobody turned on would quietly give up the claim for everyone.
   */
  newsletterEnabled: boolean;
  /**
   * The Matomo ORIGIN (`analyticsCspOrigin(CONFIG.analytics)`), or `null` when
   * no operator configured analytics — which is the default and the self-host
   * default.
   *
   * `null` MUST leave this header byte-for-byte what it was before analytics
   * existed, for exactly the reason `newsletterEnabled: false` must: the
   * landing page and the privacy policy both tell a self-hoster that their
   * instance counts nothing, and a widened `script-src` would quietly make
   * that false for everyone rather than only for the instance that opted in.
   *
   * Matomo needs THREE directives, which is one more than Turnstile:
   * `script-src` to load `matomo.js`, `connect-src` for the tracker's own
   * beacon, and `img-src` — Matomo falls back to a GET on a 1×1 image when a
   * beacon is unavailable, and `img-src` here already allows `https:` so that
   * third one costs nothing new and is named only for the reader's benefit.
   */
  analyticsOrigin: string | null;
}

/**
 * Builds the `Content-Security-Policy` header value.
 *
 * Pure and total: same inputs, same string, no environment reads. `server.ts`
 * supplies these values from `CONFIG` and `PROVIDER_REGISTRY`.
 */
export function buildContentSecurityPolicy({
  syncOrigin,
  connectExtra,
  providerOrigins,
  presetOrigin,
  newsletterEnabled,
  analyticsOrigin,
}: ContentSecurityPolicyInput): string {
  const connectSrc = [
    "'self'",
    ...providerOrigins,
    ...LOOPBACK_ORIGINS,
    // The E2EE sync server (M128 spec 04), from SYNC_SERVER_URL. The browser
    // talks to it DIRECTLY — key derivation, encryption and the blob push/pull
    // all happen client-side and never transit this server — so without this
    // entry a correctly configured instance fails every sync request on a CSP
    // violation, with no server-side symptom to debug from. Origin only:
    // `connect-src` matches scheme/host/port and silently ignores a path.
    // Nothing is appended when sync is off.
    ...(syncOrigin === null ? [] : [syncOrigin]),
    // The instance's own AI endpoint (M138 spec 06), from
    // DEFAULT_INFERENCE_BASE_URL. Same failure mode as the sync entry above:
    // the browser calls this endpoint directly with the photo, so without the
    // entry a configured preset fails its first scan and nothing on the server
    // notices. Nothing is appended when no preset is configured. Origin only.
    ...(presetOrigin === null ? [] : [presetOrigin]),
    // The instance's own AI gateway (M187 spec 03), from GATEWAY_URL. The
    // browser redeems the invite there and then sends every plate photo there,
    // so this is the same failure mode once more: without the entry a managed
    // instance's very first join dies on a CSP violation. Nothing is appended
    // when no gateway is configured. Origin only.
    ...connectExtra,
    // Cloudflare Turnstile, ONLY when the newsletter is configured
    // (NEWSLETTER_SUBSCRIBE_URL). The widget's own callbacks fetch from this
    // origin; nothing is appended when the feature is off.
    ...(newsletterEnabled ? [TURNSTILE_ORIGIN] : []),
    // Matomo's tracker beacon, ONLY when analytics are configured. Nothing is
    // appended when they are not.
    ...(analyticsOrigin === null ? [] : [analyticsOrigin]),
  ];

  // Turnstile draws itself in an iframe from the same origin, so the widget
  // needs `frame-src` as well as `script-src`. Both are appended ONLY when
  // NEWSLETTER_SUBSCRIBE_URL is configured; with the feature off there is no
  // `frame-src` directive at all and `default-src 'self'` governs, exactly as
  // before.
  const scriptSrc = [
    ...SCRIPT_SRC,
    ...(newsletterEnabled ? [TURNSTILE_ORIGIN] : []),
    // `matomo.js`. Appended only when analytics are configured — with them off
    // this list is identical to `SCRIPT_SRC`, which is the property the
    // unconfigured-instance claim rests on.
    ...(analyticsOrigin === null ? [] : [analyticsOrigin]),
  ];
  const frameSrc = newsletterEnabled ? [`frame-src 'self' ${TURNSTILE_ORIGIN}`] : [];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src ${connectSrc.join(' ')}`, // carries the sync-server origin when SYNC_SERVER_URL is set
    // The Argon2id key-derivation Worker (`engine/crypto/argon2.worker.ts`) is
    // a same-origin bundled asset, so `'self'` covers loading it. What it may
    // then DO is governed by `script-src` — see `WASM_UNSAFE_EVAL`.
    "worker-src 'self'",
    "manifest-src 'self'",
    ...frameSrc,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

/**
 * `'wasm-unsafe-eval'` — REQUIRED, and not the same thing as `'unsafe-eval'`.
 *
 * ── The bug this fixes ───────────────────────────────────────────────────
 *
 * Chrome refuses ALL WebAssembly compilation under a `script-src` that lacks
 * it: `WebAssembly.Module(): … violates … because 'unsafe-eval' is not an
 * allowed source of script`. `hash-wasm` compiles Argon2id from bytes inlined
 * in its own bundle, so without this directive the sync passphrase derivation
 * cannot initialize at all — account creation dies immediately after the
 * passphrase step, before any request reaches the sync service.
 *
 * It was invisible until a real browser hit the real production server: the
 * CSP is production-only (see this module's header), `pnpm dev` sends no
 * policy, and `node:test` has no CSP engine. Neither the unit suite nor the
 * integration suite could have caught it — which is exactly why
 * `tests/unit/content-security-policy.test.ts` now asserts on this string.
 *
 * ── Why this is not a real weakening ─────────────────────────────────────
 *
 * `'wasm-unsafe-eval'` is WASM-SCOPED. It permits `WebAssembly.compile` /
 * `.instantiate` and nothing else — `eval()`, `new Function()` and
 * `setTimeout('…')` all stay blocked, which is the part an injected script
 * actually wants. Full `'unsafe-eval'` would unblock all of them and MUST NOT
 * be used here (AGENTS.md: "The CSP is part of this promise, not
 * decoration"). Removing this line does not harden anything; it only turns
 * sync off in production, silently.
 *
 * ── The one browser caveat ───────────────────────────────────────────────
 *
 * Chrome 97+, Firefox 102+ and Safari 16.4+ understand it. Older browsers
 * ignore the unrecognised source expression and keep blocking WASM, so sync
 * setup fails there. That is the accepted outcome: the alternative is granting
 * every browser full `'unsafe-eval'` to accommodate a shrinking minority.
 *
 * The Worker inherits this policy — a same-origin worker whose own response
 * carries no CSP of its own runs under the creating document's — so this one
 * addition covers both the main thread and `argon2.worker.ts`.
 */
const WASM_UNSAFE_EVAL = "'wasm-unsafe-eval'";

/**
 * `'unsafe-inline'` stays: the boot-time theme script in `root.tsx` and
 * Radix's JS-driven inline positioning styles both rely on it, and a
 * byte-perfect hash/nonce migration is out of scope. `connect-src` is where
 * this policy earns its keep.
 */
const SCRIPT_SRC = ["'self'", "'unsafe-inline'", WASM_UNSAFE_EVAL];
