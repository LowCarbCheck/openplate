# Repository Guidelines

openplate is an **open source**, self-hosted food tracker with BYOK (bring-your-own-key) AI plate identification: snap a photo of your plate and your own AI provider (OpenRouter, Mistral, any OpenAI-compatible endpoint, or Anthropic) estimates the macros. Key handling and the provider call are client-side end to end — see "BYOK Security Rules" below.

**Licensing:** this repo is under the [MIT License](LICENSE), a permissive OSI-approved open-source license. Write **"open source"** in code comments, docs and UI copy. The README's License section is the reference; do not restate or reinterpret it elsewhere.

**There are no accounts** (M128 spec 03). No login, no session, no superadmin, no `users` table. Whoever opens the app on a device is that device's user; the tracker lives in the browser's IndexedDB and the server holds zero personal data and reads zero secrets from the environment. There is also no multi-tenancy, no CMS, no public HTTP API — and no database: the server is a single stateless container that persists nothing. The one account in the whole system belongs to the optional, separately deployed sync service — see "Sync Architecture" below.

## Stack

- **React Router v8** (framework mode) + Vite — file-based routing via `app/routes.ts`, loaders/actions, typed route modules (`./+types/<route>`)
- **Express** custom server (`server.ts`) as both the dev and production entrypoint — see [ADR-0004](.adr/0004-custom-server-is-the-production-entry.md) for why `react-router-serve` isn't used
- **No database** — the server is stateless; the browser's IndexedDB store (`app/lib/local-store/`) is the only place data is persisted
- **Conform + Zod v4** for form validation (`@conform-to/react`, `@conform-to/zod/v4`)
- **Tailwind CSS v4 + Radix primitives** for UI (`app/components/ui/*`)
- **pino** for structured logging (`app/lib/logger.ts`)

## Project Structure

```
app/
├── routes.ts          # Route tree (single source of truth for URL structure)
├── routes/            # Route modules (loaders/actions/components)
├── models/            # Pure derivation/formatting helpers (no DB — see "Data Model")
├── services/          # The BYOK vision (AI plate-ID) integration + food resolution
│   └── vision/        # Plate-identification calls; registry.ts describes every BYOK provider once
├── lib/               # Cross-cutting utilities (logger, config helpers, rate limiting)
│   ├── local-store/   # IndexedDB primary store — where tracker data actually lives
│   └── sync/engine/   # E2EE sync client: crypto, envelope, merge, HTTP (see "Sync Architecture")
├── config/            # CONFIG object — the only place env vars are read
├── components/        # Shared UI (ui/ = Radix-based primitives, rest = app components)
├── hooks/, context/, utils/, types/
types/                 # Cross-cutting types shared outside app/ (route handles, domain enums)
tests/
├── unit/              # node:test against pure functions (vision schema, macros, local store, ...)
.claude/               # AI assistant rules, skills, and commands
.adr/                  # Architecture decision records
```

## Commands

```bash
pnpm dev              # Dev server (no database, no setup — just run it)
pnpm build            # Production build (react-router build)
pnpm start            # Production server (tsx ./server.ts, NODE_ENV=production)
pnpm typecheck        # react-router typegen && tsc — never run bare `tsc` (emits .js files)
pnpm lint             # eslint --max-warnings 0
pnpm test:unit        # node --test against tests/unit/**
```

## Key Documentation

| Topic                    | Location                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| TypeScript               | [.claude/typescript-rules.md](.claude/typescript-rules.md)                                                                   |
| React                    | [.claude/react-rules.md](.claude/react-rules.md)                                                                             |
| React Router v8          | [.claude/react-router-rules.md](.claude/react-router-rules.md), [skill](.claude/skills/react-router-framework-mode/SKILL.md) |
| Forms (Conform + Zod v4) | [.claude/conform-to-react.md](.claude/conform-to-react.md)                                                                   |
| Architecture Decisions   | [.adr/README.md](.adr/README.md)                                                                                             |

## Architecture Decision Records (ADRs)

Significant decisions — anything that constrains future work, locks in a trade-off, or would surprise a new contributor — are recorded as ADRs in [`.adr/`](.adr/). Read them before proposing a change that touches the same area; if you're making a new big-call decision, write a new ADR in the same conversation.

**When to write an ADR:**

- Adopting or dropping a framework, runtime, or major library
- Cross-cutting architectural patterns (auth model, transport layer)
- Decisions that take effort to reverse (DB schema shape, file layout, public API contracts)
- "Why didn't you just X?" answers that future-you will forget

**Workflow:** copy `.adr/0000-template.md` to the next zero-padded number, fill in `Status`, `Context`, `Decision`, `Consequences`, then add the entry to the index below and to `.adr/README.md`.

### Index

| #                                                          | Title                                                            | Status     |
| ---------------------------------------------------------- | ---------------------------------------------------------------- | ---------- |
| [0001](.adr/0001-cli-wraps-the-api.md)                     | CLI wraps the API                                                | Superseded |
| [0002](.adr/0002-data-migrations.md)                       | Data migrations alongside schema migrations                      | Superseded |
| [0003](.adr/0003-app-enforced-multi-tenancy.md)            | App-enforced multi-tenancy (no RLS)                              | Superseded |
| [0004](.adr/0004-custom-server-is-the-production-entry.md) | The custom `server.ts` is the production entrypoint              | Accepted   |
| [0005](.adr/0005-label-scan-over-barcode-lookup.md)        | Packaged-food macros come from the label, not a barcode database | Accepted   |
| [0006](.adr/0006-the-app-server-holds-no-accounts.md)      | The app server holds no accounts                                 | Accepted   |
| [0007](.adr/0007-byok-provider-registry.md)                | BYOK providers are described once, in a provider registry        | Accepted   |

ADR-0001, ADR-0002 and ADR-0003 are historical record only — the HTTP API, the data-migration runner and the multi-tenancy they describe have all been removed. See their superseded-status notes for what replaced them.

## Coding Style Summary

- **TypeScript**: Strict types, no `any`, use Zod inference for form/schema types
- **Files**: `kebab-case.ts`/`kebab-case.tsx`; server-only modules end in `.server.ts`; route layouts use `_layout.tsx`/`_name.tsx` patterns
- **React**: Avoid `useEffect` for derived state; prefer early returns over nested ternaries; see [.claude/react-rules.md](.claude/react-rules.md)
- **Path aliases**: `#app/*`, `#config`, `#build/*`, `#types/*` — defined in `tsconfig.json` `paths` only (no `package.json` `imports` field)
- **Config access**: always go through `CONFIG` from `#config` (`app/config/index.ts`). Never read `process.env` directly outside that file — it's the only place with prod-vs-dev fallback logic and `requireEnv`/`optionalEnv` validation
- **Logging**: always via `#app/lib/logger` (`createComponentLogger('name')`), never raw `console.*` in application code

## Data Model

**There is no database.** The server persists nothing at all — no ORM, no connection pool, no migrations, no `DB_*` environment variables. A self-hoster runs one stateless container.

It emptied out in three waves: the personal tracker tables (`foods`, `food_logs`, `weight_entries`, `user_profiles`, the per-user AI settings table, `ai_usage_events`) moved onto the device in M117/03; the account system (`users`, `email_verification_tokens`, `password_reset_tokens`, `user_entitlements`) plus the E2EE sync storage (`sync_blobs`, `sync_key_records`) were dropped in M128 spec 03; and the last table — `data_migrations`, the data-migration runner's own ledger — went with Drizzle and Postgres themselves once nothing was left to migrate. Git history has every one of those definitions if you need to look one up.

**Reintroducing a database is an architectural decision, not a routine step.** The product promise is that this server holds no personal data; a new table needs an ADR arguing against that promise, not just "it would be convenient". Persistent state belongs either on the device (`app/lib/local-store/`) or in the separately deployed `openplate-sync` service.

## Local-First Data Ownership (Client-Side)

Tracker health data (personal foods, food logs, weight entries, profile/goals) lives in the browser's IndexedDB primary store (`app/lib/local-store/`, M117), not the server — see that module's `index.ts` header for the full architecture. **The local store is DEVICE-scoped**: one flat store per browser profile, no per-user namespacing, which is now simply the only coherent design since there is no identity to namespace by. The photo cache was the one account-keyed local surface; `photo-rekey.ts` moves its rows onto the `ANONYMOUS_USER_ID` sentinel at boot so every local surface agrees on one owner. Separate browser profiles are the isolation boundary between two people sharing a device.

## Sync Architecture (optional, off by default, entirely in the browser)

Sync exists to move a diary between devices. It is opt-in, and it is split across two repos:

- **The client engine lives in this repo**, at `app/lib/sync/engine/` — ordinary tracked source, built by Vite like everything else. M117's build-time composition seam (a private engine `dist/` copied into a gitignored directory before the image build, driven by a script that no longer exists) was deleted in M128 spec 01. There is no composition step, no gitignored engine directory, and nothing sync-specific in any Dockerfile. Any doc that still implies otherwise is stale and should be fixed, not worked around.
- **The server is a separate deployable**: [`openplate-sync`](https://github.com/LowCarbCheck/openplate-sync), with its own image, database and secrets. **This app serves no sync HTTP routes and stores nothing on sync's behalf** — the browser talks to that service directly.
- **`SYNC_SERVER_URL` is the only switch.** Unset ⇒ no sync UI renders anywhere and no sync request leaves the app. Set ⇒ the value flows `CONFIG` → root-loader public config → browser, and the origin is appended to the production CSP's `connect-src`. It must be an address a **browser** can reach; the server never proxies sync traffic.
- **All key material is client-side.** Passphrase → Argon2id → HKDF gives two independent branches: one wraps the data key and never leaves the device, one is sent as the login credential. Neither server can decrypt a blob, by construction rather than by policy.
- **The wire contract is duplicated on purpose.** `app/lib/sync/engine/protocol.ts` is a hand-maintained duplicate of `openplate-sync/src/protocol.ts`; each repo's unit test asserts _transcribed literals_, not the other repo. Changing the protocol is four edits (two sources, two tests), and `openplate-sync/PROTOCOL.md` is the normative document — start there. A one-sided edit keeps both suites green while the repos silently disagree.

## Adding a new feature

There is no mandatory "HTTP API first" layering. A typical feature touches:

1. **Local store** (`app/lib/local-store/`) — for anything the user owns. This is where tracker data lives; there is no server model layer for it.
2. **Route** (`app/routes/<name>.tsx`, registered in `app/routes.ts`) — most routes are client-only (`clientLoader`/`clientAction` over the local store) and have no server loader at all. There is no auth middleware to attach; nothing is gated.

## BYOK Security Rules

The core product promise is "your key, your provider, your data." **BYOK is fully client-side** — key storage, the provider request, and the response parsing all happen in the browser, and the server is not in the loop at any point. This is load-bearing, not aspirational:

- **The API key never reaches the server, because key handling is client-side end to end.** The key is stored on the device (`app/lib/local-store/ai-settings.ts`) and the request goes browser → provider directly. There is no server-side copy (encrypted or otherwise), no server-side proxy of the provider call, and consequently no encryption key in this app's environment. Never add a code path that posts the key to this server or routes a provider call through it — including "just for debugging".
- **Never log a raw API key, a decrypted secret, or the packed ciphertext.** Not in `logger.*` calls, not in thrown error messages, not echoed back in a loader/action response.
- **Plate photos never transit this server.** An uploaded photo is read in the browser and sent straight to the user's configured AI provider for macro estimation; it is not uploaded here, not written to disk, and not stored in the DB. Only the resulting food-log entry (numbers, not the image) is saved — into the device's local store. The photo cache is likewise device-local, and photos are excluded from JSON exports and from sync payloads.
- **Vision provider calls are provider-agnostic at the call site, and a provider is described exactly once.** `app/services/vision/registry.ts` holds `PROVIDER_REGISTRY`, a `Record<AiProviderType, ProviderDefinition>`; `app/services/vision/index.ts` picks a wire adapter from the definition's `adapter` tag rather than branching on a provider literal, and the key check, model catalog, display label, settings placement and CSP origins all read the same entry. The provider itself comes from the device's AI settings (`app/lib/local-store/ai-settings.ts` — settings live on the device, not in any table). Don't hardcode a provider assumption elsewhere in the app, and don't add a parallel per-provider map — add a registry field. See [ADR-0007](.adr/0007-byok-provider-registry.md), which also records the two hard entry gates a new provider must clear (browser-origin CORS, and a key-check endpoint that actually authenticates). Despite living under `app/services/`, these modules are client-side: they carry no `.server.ts` suffix and are imported by client-only routes.
- **The CSP is part of this promise, not decoration.** The production `connect-src` allowlist is **derived from the registry** (`server.ts` maps `PROVIDER_REGISTRY`'s fixed base URLs to origins, M130/03) plus `'self'`, loopback, `CSP_CONNECT_EXTRA` and `SYNC_SERVER_URL` if set — so a new provider's origin appears automatically and can't be forgotten. That allowlist is what stops an injected script exfiltrating a key that lives in the page. Widening it by hand needs the same scrutiny as touching the key path itself.

## Migrations live on the device

There is no server-side migration story any more — no schema migrations, no data migrations, no runner, no ledger. The only persisted shape the app owns is the IndexedDB store, and it versions itself: bump the version in `app/lib/local-store/schema.ts` and write the upgrade path there, so an existing device's data is transformed on its next load. A change that would need "run this once against production" is a signal you are persisting something on the server that should not be there.

## Commits

Use Conventional Commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`

See: [.claude/commands/commit.md](.claude/commands/commit.md)

## Claude Code Integration

```
.claude/
├── commands/       # /commit
├── skills/         # form-persistence, react-router-framework-mode
└── *.md            # Coding standards
```
