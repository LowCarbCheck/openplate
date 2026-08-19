# 0007 — BYOK providers are described once, in a provider registry

- **Status:** Accepted
- **Date:** 2026-08-05
- **Deciders:** openplate maintainers (M130)

## Context

openplate's plate scan is BYOK: the key lives on the device, and the browser calls the user's AI provider directly. The server is not in that path and never holds a key ([ADR-0006](0006-the-app-server-holds-no-accounts.md)).

Before M130 a "provider" was not a thing the code had a name for. It was a string literal repeated across the codebase — the adapter dispatch in `app/services/vision/index.ts`, the live key check in `verify-key.ts`, the OAuth capability test, the display label, the settings page's primary-vs-advanced grouping, the model catalog, and the production CSP's `connect-src` allowlist all carried their own `if (provider === '…')` branch or their own hand-maintained parallel map. Adding a provider meant finding all of them. Nothing failed loudly when you missed one: a forgotten CSP origin is a runtime `net::ERR_BLOCKED_BY_CSP` in the user's browser and nowhere else, and a forgotten catalog entry is a blank cost estimate on a diary entry.

At the same time we wanted a second *direct* provider (Mistral, M130/04) for a plainer reason than architecture: our German-language users deserve a first-suggested provider that is hosted in the EU.

## Decision

**One provider is one entry in `PROVIDER_REGISTRY` (`app/services/vision/registry.ts`), typed `Record<AiProviderType, ProviderDefinition>`.** Everything that used to branch on a provider literal now reads that record. The `Record` over the DB-backed enum is the enforcement mechanism: add a member to `AiProviderType` and the build fails with TS2741 until the entry exists (verified deliberately during M130/04). `PROVIDER_IDS` carries a matching compile-time exhaustiveness assertion for the tuple form, which `satisfies` alone cannot cover.

### Entry gates — two of them are hard

A candidate provider is only *addable* if it clears both. These are not preferences; failing either one disqualifies a vendor at any effort level, because a server-side proxy is forbidden by the BYOK promise.

1. **The chat endpoint must permit browser-origin calls** — permissive CORS on the actual request we make, including the `Authorization` header on the preflight. This is why there is no direct-OpenAI and no direct-Google path in this app: their APIs refuse cross-origin browser requests, and the only lawful workaround (proxying through our server) would put the key in our hands. OpenAI and Google models are reachable here only *through* OpenRouter. Mistral cleared this gate by live probe: `OPTIONS /v1/chat/completions` answers `access-control-allow-origin: *`.

2. **There must be an endpoint that actually authenticates, for the key check.** Not merely an endpoint that returns 200 — one that returns 401 for a bad key *and* for no key at all. **The cautionary tale is OpenRouter's `/models`:** it is a public listing that answers 200 to any request, key or no key. Pointed at it, our key check was a silent no-op — any string the user typed was accepted, saved, and announced as "verified", with the bad key only surfacing much later as a scan failure the user reasonably blamed on their photo. Verification now points at `/auth/key`, OpenRouter's key-introspection endpoint. Mistral's `/models`, unlike OpenRouter's, *is* a real check (401 on a bogus key and on no key), which is why the two providers share a `VerificationStrategy` shape but not a path. A provider with no authenticating endpoint reachable from the browser cannot be added: a verification step that cannot fail is worse than none, because it converts a user's typo into our credibility problem.

### Adding a provider, mechanically

1. Add the enum member to `drizzle/types/enums.ts` (`AiProviderType`).
2. Run `pnpm typecheck`. The compiler now *demands* a `PROVIDER_REGISTRY` entry — label key, auth methods, base URL, verification strategy, wire adapter, placement, key-console URL — and a `PROVIDER_IDS` tuple member.
3. Add the model catalog (`app/services/vision/catalog.ts`, also a `Record<AiProviderType, …>`, so again compiler-demanded). An empty array is legal — that is what `openai-compatible` has, since the user's own endpoint serves whatever it serves. Pricing lives with the catalog entry, which is what makes the per-scan cost estimate non-blank.
4. Add the label and model descriptions to **both** locales (`app/i18n/locales/{en,de}/common.json`). The registry stores a `labelKey`, never a display string.
5. Do nothing about the CSP. `server.ts` derives `connect-src` from the registry's fixed base URLs (M130/03); a new provider's origin appears automatically, and it is no longer possible to ship a provider the browser is forbidden to call.

### What is deliberately *not* generalised

- **Two wire adapters stay two.** `openai-compatible.ts` and `anthropic.ts` are not folded together behind a config object: Anthropic's request and response shapes genuinely differ (system prompt placement, content blocks, `max_tokens` semantics). The `switch` remaining in `index.ts` is over the two *adapters*, not over N providers, and it does not grow when a provider is added.
- **Verification stays a discriminated union** (`base-url-path` vs `absolute-url`) for the same reason — the providers genuinely differ in *where* the check goes, and a single URL string would have forced a lie somewhere.

### Three honesty caveats

These are load-bearing. Without them this ADR overpromises, and the next contributor discovers the gap at the worst moment.

1. **"One entry adds a provider" holds only for manual-key providers.** `authMethods` can *say* `'oauth-pkce'`, but nothing reads that to build a flow: the authorize URL, the exchange URL and the callback path are hardcoded in `OPENROUTER_OAUTH_CONFIG` (`app/lib/oauth-pkce.ts`), and the callback route is a fixed path in the route tree. That is correct YAGNI with exactly one OAuth provider in existence — but **a second OAuth provider is a refactor, not a flipped field**: the flow config has to be extracted per provider (and its `callback_url` acceptance re-spiked, since OpenRouter's tolerance of arbitrary origins is a fact about OpenRouter).

2. **`baseUrl` is inert for Anthropic.** `createAnthropicProvider` composes no URLs from it — it hardcodes `ANTHROPIC_MESSAGES_URL`. The registry records the value anyway because the CSP's `connect-src` derivation reads these origins, and because leaving the field blank would have made the CSP quietly incomplete. The field's own doc comment says this too. A decorative field that looks load-bearing is its own drift trap, and the mitigation here is disclosure rather than a threading refactor of a working adapter.

3. **The locale rule is a heuristic, not a residency guarantee.** `recommendedProviderFor(uiLanguage)` puts Mistral first for German and OpenRouter first for English. Mistral being EU-hosted is a *fact about Mistral*; it is not a data-protection promise openplate makes, and UI language is not user location. openplate cannot make such a promise about a third party it never talks to — the browser talks to the provider, we do not, and where the user's plate photo ends up is governed by the provider's own terms. The rule exists because a German-speaking user is more likely to *want* to evaluate an EU provider first, and nothing more. Copy on that surface must not drift into compliance language.

## Alternatives Considered

- **Leave the literals scattered.** Cheapest until the second direct provider, which is exactly when the CSP gap bites — invisibly, in someone else's browser. Rejected once Mistral was on the table.
- **A plugin/config-file provider system** (providers described in JSON, loaded at runtime). Real flexibility, but it trades the compiler guarantee — the one thing that actually stops a half-added provider from shipping — for generality nobody has asked for. Rejected as premature.
- **A server-side proxy so any provider can be added regardless of CORS.** This would have made the OpenAI and Google APIs directly usable. Rejected outright: it puts the user's key on our server and dissolves the product's central promise. The CORS gate is a *consequence* of that promise, not an inconvenience to engineer around.
- **A single generic wire adapter driven by config.** Collapses two honest adapters into one branchy one. Rejected — see "not generalised" above.

## Consequences

- Adding a manual-key provider is a bounded, mechanical change, and the compiler names most of the work for you. The CSP can no longer fall out of sync with the provider list.
- The registry is a **data leaf** by design: it imports only `./constants` (no `fetch`, no adapters, no prompts), so the server-side CSP derivation can read it without dragging the client vision stack into the server bundle. Keep it that way — an adapter import here would be a build-weight regression that nothing else catches.
- The two hard gates mean some well-known vendors are simply not addable direct. That is a permanent constraint of BYOK-without-a-proxy, and it should be stated to users plainly rather than worked around.
- The registry carries no secret material and no key ever passes through it. That property is worth preserving on every edit.
- **Follow-on candidate, explicitly out of scope here:** Mistral's OCR / Document AI endpoint (`mistral-ocr-4`, ~$4 per 1,000 pages) is live in their `/v1/models` listing and is a strong fit for the packaged-food label scan described in [ADR-0005](0005-label-scan-over-barcode-lookup.md). It is a different call shape from chat completions, so it does not drop into the vision adapter as-is — it wants its own evaluation. Recorded here so the next person finds it instead of rediscovering it.

## References

- [ADR-0005](0005-label-scan-over-barcode-lookup.md) — packaged-food macros come from the label, not a barcode database
- [ADR-0006](0006-the-app-server-holds-no-accounts.md) — the app server holds no accounts
- `app/services/vision/registry.ts` — the registry itself, with the per-field rationale
- `app/services/vision/verify-key.ts`, `app/services/vision/catalog.ts`, `app/config/content-security-policy.ts`
- `AGENTS.md` → "BYOK Security Rules"
- Workspace tracker: milestone M130 (`.tracker/M130-openplate-multi-provider-byok/`), specs 01–05
