# openplate

An **open-source**, self-hosted food tracker with **BYOK (bring-your-own-key) AI plate identification**. Snap a photo of your plate, and your own AI provider (OpenRouter, Mistral, any OpenAI-compatible endpoint, or Anthropic) estimates the macros. Your key, your provider, your data.

**There are no accounts.** No sign-up, no login, no password — open the app and start logging. Your diary lives in your browser's own storage on the device you're using; the server never sees it, and it holds no personal data of any kind. That is structural rather than a promise: the server has no database at all — no user table, no tables, nothing to sit in ([ADR-0006](.adr/0006-the-app-server-holds-no-accounts.md)). It is also why the app boots with **nothing to configure**: one stateless container, no secrets, no database.

Syncing a diary between devices is the one thing that needs an account, so it lives somewhere else entirely: an optional, separately self-hostable service called [openplate-sync](https://github.com/LowCarbCheck/openplate-sync), which stores end-to-end-encrypted bytes it cannot read. You switch it on by setting one environment variable, and you can ignore it forever without losing a feature.

Built with React Router v8, Express, and IndexedDB in the browser. The server has no datastore.

> **Open source, MIT licensed.** openplate is free to run, read, change, fork and redistribute — for yourself, your family, your friends, or your employer, commercially or not, hosted or not. There is no restriction on offering it as a service to others. See [License](#license) at the bottom of this file.

## Three components, and you can run any subset of them

| Component                                                                      | What it is                                                                                         | What it stores                                                    | Needed?                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **openplate** (this repo)                                                       | The app. Accountless, local-first, boots with no secrets.                                              | Nothing. It has no database — no people, no food logs, no keys.       | Yes — it is the product.                                                |
| **[openplate-sync](https://github.com/LowCarbCheck/openplate-sync)**           | An account service whose first feature is end-to-end-encrypted sync.                                   | An email address and opaque ciphertext it holds no key for.           | No. Everything works without it.                                        |
| **[openplate-inference](https://github.com/LowCarbCheck/openplate-inference)** | A self-hosted, OpenAI-compatible plate-photo AI endpoint — open-weight models, your own hardware.      | Nothing of yours — it's a stateless inference server.                 | No. BYOK cloud providers (OpenRouter, Mistral, …) work without it.      |

`SYNC_SERVER_URL` is the entire switch for sync:

- **Unset** — the default, and the default for self-hosting: openplate is a pure local app. No sync interface renders anywhere, and no request ever leaves for a sync service.
- **Set** — the sync screens appear and talk to that URL, whether it is our hosted service, your own instance, or a third-party server implementing [the protocol](https://github.com/LowCarbCheck/openplate-sync/blob/main/PROTOCOL.md).

Inference has no dedicated switch — it's a plain "OpenAI-compatible" provider. Point [openplate-inference](https://github.com/LowCarbCheck/openplate-inference) (or Ollama/vLLM/LM Studio) at your instance and connect to it manually in **Settings → AI**, the same way you'd add any other `openai-compatible` endpoint. If you'd rather every visitor to your instance get a one-tap connect button instead of typing in a URL, set `DEFAULT_INFERENCE_BASE_URL` (see [Environment variables](#environment-variables)) and the app offers it automatically — no code change either way. Details: [Self-hosting a custom AI endpoint](#self-hosting-a-custom-ai-endpoint).

So there are several sane ways to run this:

1. **App only.** One stateless container. Nothing to sign up for, nothing to trust, no database to run, BYOK for the AI.
2. **App you host + our hosted sync service.** You keep the app; we run the account service so you do not have to. It still cannot read your diary.
3. **Both, self-hosted.** [`docker-compose.full.yml`](docker-compose.full.yml) in this repo brings up the app, the sync service and the Postgres that sync (not the app) needs, wired together.
4. **Any of the above + your own AI.** Add [openplate-inference](https://github.com/LowCarbCheck/openplate-inference) (or any OpenAI-compatible endpoint you run) alongside it and skip cloud AI providers entirely.

## Your diary lives on your device — here is what keeps it alive

This is the first question a local-first app should answer, so: **what happens if you never make a sync account?** Four things, all already shipped:

- **A real database in the browser.** Everything you log goes into an IndexedDB store (`app/lib/local-store/`), not into `localStorage` and not into a server. It survives reloads, restarts and being offline.
- **Eviction-resistant storage.** When you install openplate as an app (the PWA install card), it asks the browser to make this origin's storage persistent — which is what stops an aggressive browser from reclaiming your diary as if it were a cache.
- **Backup reminders that are honest about the risk.** A quiet banner appears when a device holds data you have never exported, or have not exported in a while. It says the true thing — "your diary only lives here" — and links straight to the export.
- **A full JSON export and import.** **Profile → Your data → Download everything (JSON)** hands you the whole diary as a file, and the import on the same screen restores it onto any device. That file is the copy that outlives a cleared browser, a dead phone, or this project.

Optional end-to-end-encrypted sync sits on top of all of that; it does not replace any of it. Plate photos stay on the device that took them — they are never part of an export or a sync payload.

## Requirements

- Node.js ≥ 22
- pnpm

That is the whole list. There is no database to install and no service to start alongside it.

## Quickstart

```bash
git clone https://github.com/LowCarbCheck/openplate.git
cd openplate
pnpm install

# Start the dev server. There is nothing to provision first.
pnpm dev
```

The app is served at `http://localhost:3000`. Every environment variable is
optional tuning — copy `.env.example` to `.env` if you want to change one.

## Using it

1. Open the app and go through the short onboarding — there is nothing to sign up for.
2. Go to **Settings → AI** and connect an AI provider with your own API key — the fastest path is **Connect with OpenRouter** (see below). **Mistral** (EU-hosted, manual key) is offered alongside it, and your own OpenAI-compatible endpoint or Anthropic are available under “Advanced”, also via manual key entry. The key never leaves your device: it's stored only in this browser's local storage and is sent to no one but the provider you choose.
3. Use **Scan Plate** to upload a photo and get an AI-estimated macro breakdown, or use **Add** to log entries manually.
4. Your diary lives on this device. **Profile → Your data** downloads a full JSON backup (and imports one) — that is how you move it to another device, and how you keep it safe.

### Connect with OpenRouter

**Settings → AI → Connect with OpenRouter** is a one-click, browser-only OAuth flow (PKCE) — no key to copy-paste. It opens OpenRouter's own consent screen in a new tab; approve it, and the issued key lands directly in this browser's local storage. openplate's server is never in that loop: it never sees, stores, or proxies the key.

- **Set a spending cap while you're there.** OpenRouter's consent screen offers a self-service credit cap (optional, with a reset interval) right next to the account picker — use it. It bounds what the connected key can ever spend, independent of anything openplate does.
- **The default model is `google/gemini-3.5-flash-lite`** — a paid model, roughly **$0.001 per scan**. It was chosen deliberately over any `:free` model: OpenRouter's `:free` endpoints only become reachable after you flip on that provider's account-level "may train on request data" / "may publish prompts" toggles, and some free vision models retain prompts for weeks. openplate does not default to a free model to avoid nudging you into that trade-off. You can still pick a `:free` model yourself from the model list — that's an explicit, disclosed opt-in, not the default.
- **Manual key entry still works for every provider** — OpenRouter included — via the "paste an API key manually" panel, if you'd rather not use OAuth (or your provider doesn't support it).
- The connected key appears in your [OpenRouter key settings](https://openrouter.ai/settings/keys) labeled **"An app"**. Disconnecting in openplate only clears the key from this device — it does **not** revoke it at OpenRouter. To fully deactivate it, revoke it from that page yourself.
- Same local-first guarantee as any other provider's key: it's stored only in this device's local storage, is excluded from the JSON backup/export (so a shared or restored backup never leaks it), and is never sent to the openplate server.

## Sync across devices (optional)

Sync is a separate service, a separate repo, and a separate decision. openplate talks to it over a documented HTTP protocol; it never becomes part of this app.

**What the sync service can see:** an email address, the size and timing of your uploads, and a blob of ciphertext. **What it cannot see:** anything you ate. Your passphrase never leaves your browser. The key that decrypts your data is derived on your device and wrapped there; the value the service receives to authenticate you is a cryptographic sibling of that key, not a parent — holding it reveals nothing about the other. That is a property of the maths, not a policy we promise to keep. [PROTOCOL.md](https://github.com/LowCarbCheck/openplate-sync/blob/main/PROTOCOL.md) states it in full, including an honest list of the metadata the server does learn.

**The cost of that design, stated up front:** if you forget your passphrase and lose your recovery code, your synced data is gone — to us and to you. An email reset restores your _login_, never your _data_. The app says this in those words before you finish setting sync up, and the recovery code is shown once, behind an explicit acknowledgment.

To turn it on, set `SYNC_SERVER_URL` to the service you want to use and restart the app. To turn it off, unset it: the sync screens disappear and the app stops reaching out. Your local diary is untouched either way.

## Environment variables

All environment variables are read through `app/config/index.ts` (`CONFIG`). **None of them is a secret and none is required** — there is no session key, no encryption key and no database URL to configure, because there are no accounts, no server-side storage and nothing personal on the server. See `.env.example` for the full list with defaults; the ones you're most likely to touch:

| Variable                                                                          | Default                                                             | Description                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                        | `development`                                                       | Standard Node environment flag.                                                                                                                                                                                                                                                                                                                   |
| `PORT`                                                                            | `3000`                                                              | HTTP port the app listens on.                                                                                                                                                                                                                                                                                                                     |
| `HMR_PORT`                                                                        | `24678`                                                             | Vite HMR port in dev.                                                                                                                                                                                                                                                                                                                             |
| `LOG_LEVEL`                                                                       | `info`                                                              | pino log level.                                                                                                                                                                                                                                                                                                                                   |
| `APP_URL`                                                                         | `http://localhost:3000`                                             | Public URL of the app; required in production.                                                                                                                                                                                                                                                                                                    |
| `SYNC_SERVER_URL`                                                                 | unset (sync off)                                                    | Base URL of an [openplate-sync](https://github.com/LowCarbCheck/openplate-sync) service. Unset ⇒ no sync interface and no outbound sync requests. Set ⇒ the sync screens appear and that origin is added to the production CSP's `connect-src` for you. A malformed URL stops the boot on purpose, so a typo cannot look like "sync is quietly off". |
| `TRUST_PROXY`                                                                     | `1` in prod, `false` in dev                                         | Express `trust proxy` setting — required behind a reverse proxy (see `.env.example` for details).                                                                                                                                                                                                                                                 |
| `CSP_CONNECT_EXTRA`                                                               | unset (empty)                                                       | Space-separated extra origins for the production CSP's `connect-src` — set this if your BYOK `openai-compatible` endpoint is a **remote** host (not `localhost`). See [Self-hosting a custom AI endpoint](#self-hosting-a-custom-ai-endpoint) below.                                                                                              |

## There is no database

The server stores nothing, so there is no schema, no ORM, no migration runner and no `DB_*` configuration. `scripts/start.sh` simply starts the server.

The only persisted shape the project owns is the browser's IndexedDB store (`app/lib/local-store/`), and it versions itself: bump the version in `app/lib/local-store/schema.ts` and write the upgrade path there, and each device migrates its own data on the next load. See [ADR-0006](.adr/0006-the-app-server-holds-no-accounts.md) for why the server holds nothing, and [ADR-0002](.adr/0002-data-migrations.md) (superseded) for the server-side data-migration runner this replaced.

## Configuration

Environment variables flow through `app/config/`. Import the `CONFIG` object for typed access:

```typescript
import { CONFIG } from '#config';

const port = CONFIG.server.port;
const appUrl = CONFIG.app.url;
```

## Tests

```bash
pnpm typecheck            # react-router typegen && tsc
pnpm lint                 # eslint --max-warnings 0
pnpm test:unit            # node --test against pure functions (vision schema, food-log summary, local store, ...)
```

## Building for production

```bash
pnpm build       # react-router build (NODE_ENV=production)
pnpm start       # tsx ./server.ts (NODE_ENV=production)
```

The Dockerfile (`Dockerfile.pnpm`) builds the image and uses `scripts/start.sh` as the entrypoint, which just starts the server — there is no migration or provisioning step.

## Self-hosting

openplate ships as a prebuilt multi-arch Docker image (`linux/amd64` + `linux/arm64` — Raspberry-Pi-class boxes are a first-class target) published to GitHub Container Registry by [`.github/workflows/release-image.yml`](.github/workflows/release-image.yml) on every push to `main` and on version tags. There are no secrets to generate and nothing to sign up for beyond your own AI provider key — one `docker compose up -d` gets you a running instance.

<!-- Delete this note when the repo and its GHCR package are flipped public (M128 spec 07). -->

> **Availability note:** this repository (and its GHCR package) is currently private while the project is early. The release workflow is already live and publishing images on every push — the `curl` quickstart below will work as written the moment the repo and package are flipped to public. Until then, clone the repo and run the same `docker compose up -d` from a checkout.

Nothing here is a reduced edition. Local-first tracking, BYOK AI plate scanning, PWA install, JSON export/import, the whole interface: identical to what our hosted instance runs, because it is the same image. The only thing our hosted deployment adds is that we operate the optional sync service for you — and even that is in this project's second repo, under the same license, for you to run yourself if you'd rather.

### Quickstart — the app on its own

```bash
# Download the compose file — no git clone needed.
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker-compose.yml

docker compose up -d
```

That's the whole setup: **one container, no database, no `.env` step, no secret to generate**. openplate has no accounts and stores nothing on the server, so there is nothing to provision, sign or encrypt. The app is reachable at `http://localhost:3000`.

Everything you log lives in your browser's IndexedDB (see [above](#your-diary-lives-on-your-device--here-is-what-keeps-it-alive)), which is also why upgrading is just `docker compose pull` — there is no server-side state to migrate or lose.

### Quickstart — the app plus your own sync service

[`docker-compose.full.yml`](docker-compose.full.yml) is the reference deployment for the full experience: the app, the sync service, and a Postgres. The database belongs to the **sync service** — it keeps accounts and encrypted blobs. The app still connects to nothing.

```bash
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker-compose.full.yml

# The sync service needs exactly one secret. Generate it and keep it with your backups.
echo "SERVER_SECRET=$(openssl rand -hex 32)" >> .env
echo "PUBLIC_APP_URL=https://openplate.example.com" >> .env
echo "PUBLIC_SYNC_URL=https://sync.example.com" >> .env

docker compose -f docker-compose.full.yml up -d
```

The file is annotated line by line, including which two settings will actually hurt you if you get them wrong. Read [openplate-sync's README](https://github.com/LowCarbCheck/openplate-sync) before you put it on the public internet — running an account service is a genuinely bigger undertaking than running the app, and it is worth knowing what you are taking on.

### First run

1. Open `http://localhost:3000` and follow the short onboarding. No registration, no login — whoever opens the app on a device is that device's user.
2. Go to **Settings → AI** and connect your own AI provider (OpenRouter, Mistral, your own OpenAI-compatible endpoint, or Anthropic) with your own API key.
3. Take a backup early: **Profile → Your data → Download everything (JSON)**. Your diary lives in this browser's storage, so a backup is the only copy that survives clearing site data or moving to a new device.

### Upgrading

```bash
docker compose pull
docker compose up -d
```

There is nothing to migrate: the app container holds no state, so a new image just replaces the old one. (If you run the full stack, the sync service applies its own migrations on start.)

#### Upgrading across the accountless cutover (important, one-time)

The release that removed accounts **drops the `users` table and everything hanging off it** — accounts, sessions, verification/reset tokens. Tracker data was already on the device by then (the earlier local-first cutover moved it there), so nothing you logged is affected. But it is a one-way schema change:

1. **Back up first.** Take a `pg_dump` (below) if you want the old account rows recoverable, and have each person on each device take a JSON export from **Profile → Your data** — that is the copy that actually holds their diary.
2. **Upgrade.** The migration runs on container start. Afterwards there is no login page: every device that already has data keeps it and simply stops asking who you are.
3. **Prune your `.env`.** The session-secret, encryption-key, signup-gate and seeded-superadmin variables are all gone — and so, since the Postgres removal, are `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` and the pool-tuning variables. Nothing reads them any more and `.env.example` no longer lists them; leaving them set is harmless, but they are dead weight. You can also delete the app's old `pg-data` volume once you are happy: `docker compose down && docker volume rm openplate_pg-data`.

If you had more than one account signed in on the SAME browser profile, note that the tracker store was always device-scoped — their data was already sharing one store, and it stays that way. Separate browser profiles remain the way to keep two people's diaries apart on one device.

### Backups

**There is nothing on the app server to back up.** It holds no database and writes no state — a destroyed app container loses nothing.

**The per-device JSON export is the backup that matters** (**Profile → Your data → Download everything**), because that is where your diary actually is.

If you also run the sync service, its Postgres is worth a scheduled dump — together with the `SERVER_SECRET`, which is useless without it and vice versa:

```bash
docker compose -f docker-compose.full.yml exec postgres \
  pg_dump -U openplate openplate_sync > sync-backup.sql
```

### HTTPS

PWA install, the offline-caching service worker, and the camera capture behind **Scan Plate** all require a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) — browsers refuse `getUserMedia` and service-worker registration over plain HTTP (`localhost` is exempt, which is why the quickstart above works unmodified for local testing). Plain-HTTP LAN access still works for everything else — diary, manual logging, backups — you only lose install/offline/camera without TLS.

Two easy paths to a real certificate for a home server:

**Caddy reverse proxy** (automatic Let's Encrypt renewal; needs a domain pointed at your server):

```
# Caddyfile
openplate.example.com {
    reverse_proxy localhost:3000
}
```

Then set `APP_URL=https://openplate.example.com` in `.env` (and `TRUST_PROXY=1`, the production default) and restart the `app` service.

**Tailscale Serve** (no domain, no port-forwarding, HTTPS on your own tailnet):

```bash
tailscale serve --bg 3000
```

Tailscale issues and renews the certificate for you; the app becomes reachable at `https://<machine-name>.<tailnet>.ts.net`. Set `APP_URL` to that URL.

### Self-hosting a custom AI endpoint

[openplate-inference](https://github.com/LowCarbCheck/openplate-inference) is exactly this: a self-hosted, OpenAI-compatible plate-photo endpoint you run on your own hardware with open-weight models, so nobody needs a cloud AI key at all. It, Ollama, vLLM, LM Studio, or anything else speaking the OpenAI chat-completions protocol all connect the same way, described below.

Since the BYOK vision call and key live entirely in the browser (M117), the production build ships a strict Content-Security-Policy whose `connect-src` only allows `'self'`, the built-in providers' own origins (OpenRouter, Mistral, Anthropic — derived automatically from the provider registry, see [ADR-0007](.adr/0007-byok-provider-registry.md)), `localhost`/`127.0.0.1`/`[::1]` (any port), and your `SYNC_SERVER_URL` if you set one — this is what protects your key from exfiltration if the page is ever compromised by an injected script.

- **A local `openai-compatible` endpoint on the same box** (Ollama, vLLM, LM Studio, etc.) — no configuration needed, the localhost carve-out already covers it. In AI settings, use a base URL like `http://localhost:11434/v1`.
- **A remote `openai-compatible` endpoint** (a different box on your LAN, or a hosted inference server you run) — the CSP blocks it by default. Set `CSP_CONNECT_EXTRA` in `.env` to the origin(s) you need, space-separated, then restart the `app` service:
  ```bash
  echo "CSP_CONNECT_EXTRA=https://ai.example.com" >> .env
  docker compose up -d
  ```
- **Direct `api.openai.com`** is never reachable from the browser (OpenAI's own API blocks cross-origin requests) — route OpenAI models through OpenRouter instead, regardless of `CSP_CONNECT_EXTRA`.

### Self-hosting: "Connect with OpenRouter" works from any origin

The OAuth PKCE connect flow's `callback_url` is derived at request time from `window.location.origin` — it is **never hardcoded and never needs pre-registration** with OpenRouter. This was verified end to end during the M127 spike: an arbitrary origin (including plain `http://` on a LAN address) is accepted by OpenRouter's authorize endpoint without any allowlisting step on your part. Practically: the button works unmodified whether you're on `http://localhost:3000`, a LAN IP, or your own domain — there's nothing to configure for it, unlike `CSP_CONNECT_EXTRA` above.

One privacy note if you self-host behind a reverse proxy that logs request URLs: the callback URL (including its one-time `state` query parameter) will appear as a line in your proxy/access logs, the same as any other URL your users visit. It's not a secret — knowing it doesn't grant access to anyone's key — but if your log retention or log shipping is a concern, scrub that line or accept it as you would any other access-log entry.

## License

openplate is **open source**, licensed under the [MIT License](LICENSE) (SPDX: `MIT`). [openplate-sync](https://github.com/LowCarbCheck/openplate-sync) is under the same license. MIT is one of the most permissive licenses available: run it, read it, change it, fork it, redistribute it, host it for others — commercially or not — with no restrictions beyond keeping the copyright and license notice attached to any copy you distribute.

## More

- [`AGENTS.md`](AGENTS.md) — coding guidelines for this repo. AI coding agents (Claude, Codex, Cursor) read this file by convention; [`CLAUDE.md`](CLAUDE.md) imports it.
- [`.adr/`](.adr/) — architecture decision records. Start with [ADR-0006](.adr/0006-the-app-server-holds-no-accounts.md) for why this server has no accounts. ADR-0001 and ADR-0003 are superseded (multi-tenancy and the HTTP API were both removed) but kept as historical record.
- [openplate-sync](https://github.com/LowCarbCheck/openplate-sync) — the optional account and sync service, and its [PROTOCOL.md](https://github.com/LowCarbCheck/openplate-sync/blob/main/PROTOCOL.md) wire specification.
