# openplate

An open-source, self-hosted food tracker with **BYOK (bring-your-own-key) AI plate
identification**. Snap a photo of your plate and your own AI provider — OpenRouter, Mistral,
any OpenAI-compatible endpoint, or Anthropic — estimates the macros. Your key, your provider,
your data.

**There are no accounts.** No sign-up, no login, no password: open the app and start logging.
Your diary lives in your browser's own IndexedDB on the device you use, and the app server has
no database at all — one stateless container, no secrets, nothing to provision. Optional
end-to-end-encrypted sync between devices is a separate service you can ignore forever.

## Try it without installing anything

**<https://openplate.lowcarbcheck.org>** runs this code. There is nothing to sign up for —
open it and start logging, the same as a local install.

It is a demo instance, so treat it as one: no uptime promise, no support, and nothing there
is backed up for you. Your diary lives in that browser's storage, and clearing the browser
clears it. Self-hosting is the equally supported option, and it is the one below.

## Quickstart

```bash
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/compose.yml
docker compose -f compose.yml up -d
```

That is the whole setup — one container, no database, no `.env` step, no secret to generate.
The app is reachable at `http://localhost:3000`.

Upgrading is `docker compose -f compose.yml pull && docker compose -f compose.yml up -d`. There is no server-side state to
migrate or lose.

### Pick a language

openplate ships English and German. A visitor who has not chosen yet sees
English; set `DEFAULT_UI_LANGUAGE=de` to start them in German instead.

```bash
DEFAULT_UI_LANGUAGE=de
```

It is a starting language, not a lock: whatever you set, anyone can switch in
Settings and their choice sticks. An unsupported code fails the boot rather than
falling back, so a typo is loud instead of serving the wrong language forever.

This is the interface only. It does not translate food names or AI replies.

### Add sync

If you also want end-to-end-encrypted sync across devices,
[`docker/topologies/compose.sync.yml`](docker/topologies/compose.sync.yml) brings up the app, the
[openplate-sync](https://github.com/LowCarbCheck/openplate-sync) service, and the Postgres that
sync — and only sync — needs:

```bash
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/topologies/compose.sync.yml
echo "SERVER_SECRET=$(openssl rand -hex 32)" >> .env
# The URLs a BROWSER will use. Skip these two only for a localhost trial.
echo "PUBLIC_APP_URL=https://openplate.example.com" >> .env
echo "PUBLIC_SYNC_URL=https://sync.example.com" >> .env
docker compose -f compose.sync.yml up -d
```

There are two larger shapes as well — self-hosted AI, and everything at once.
[`docker/topologies/README.md`](docker/topologies/README.md) is the one-page map of all four,
and `compose.full.yml` in particular needs four values edited inside the file before it will
work.

Full walkthrough: [docs/self-hosting.md](docs/self-hosting.md) and [docs/sync.md](docs/sync.md).

## Using it

1. Open the app and go through the short onboarding — there is nothing to sign up for.
2. Go to **Settings → AI** and connect an AI provider with your own API key. The fastest path
   is **Connect with OpenRouter** (one-click OAuth, no key to copy-paste). The key is stored
   only in that browser and is sent to nobody but the provider you chose.
3. Use **Scan Plate** to upload a photo and get an AI-estimated macro breakdown, or **Add** to
   log entries manually.
4. **Profile → Your data** downloads a full JSON backup and imports one. Your diary lives on
   this device, so that file is how you move it and how you keep it safe. Plate photos stay on
   the device that took them — they are never exported or synced.

## The components

Run any subset. Only the first one is required.

| Component                                                                     | What it is                                                                                    | Needed?                                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **openplate** (this repo)                                                     | The app. Accountless, local-first, stateless, boots with no secrets.                          | Yes — it is the product.                                         |
| **[openplate-sync](https://github.com/LowCarbCheck/openplate-sync)**          | An account service whose first feature is end-to-end-encrypted sync. Stores an email address and ciphertext it holds no key for. It also backs the optional research console at `/study` ([docs/sync.md](docs/sync.md)), which stays dark unless the sync service sets `SYNC_RESEARCH=true` (off by default). | No. Everything works without it.                                 |
| **[openplate-inference](https://github.com/LowCarbCheck/openplate-inference)**| A self-hosted, OpenAI-compatible plate-photo endpoint — open-weight models, your own hardware. | No. BYOK cloud providers work without it.                        |
| ~~openplate-gateway~~                                                         | Archived 2026-09-04 (M192), merged into openplate-sync: a managed instance's own account now carries the AI allowance, so the separate proxy is gone. | — |

## Documentation

| Guide | What it covers |
| --- | --- |
| [**Architecture**](./docs/architecture.md) | The four programs, what each one stores, and how they compose |
| [**Self-hosting**](./docs/self-hosting.md) | Compose walkthroughs, first run, HTTPS, backups, upgrading |
| [**Configuration**](./docs/configuration.md) | Every environment variable, the Content-Security-Policy, custom and instance-provided AI endpoints |
| [**Sync**](./docs/sync.md) | Enabling sync across devices, the encryption, and the operator's escrowed recovery key |
| [**Topologies**](./docs/topologies.md) | What to run, from a browser-only install up to a self-hosted household |
| [**Family setup**](./docs/family-setup.md) | Sharing one AI bill across a household, with a spend limit and revocation per person |
| [**Legal review**](./docs/legal-review.md) | Status of the German legal text, machine-translated and awaiting a lawyer |

Repository-level specifications live at the root: [`.adr/`](.adr/) — architecture decision
records. Start with
[ADR-0006](.adr/0006-the-app-server-holds-no-accounts.md) for why this server has no
accounts. Also [`AGENTS.md`](AGENTS.md) — coding guidelines for this repo;
[`CLAUDE.md`](CLAUDE.md) imports it. [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to send a
pull request. [`SECURITY.md`](SECURITY.md) — reporting a vulnerability.

## Development

Requires Node.js ≥ 22 and pnpm, on **Linux x64 or arm64**. There is no database to install
and no service to start alongside it.

The repo pins an exact pnpm in `package.json`'s `packageManager` field, so run `corepack
enable` first and let it fetch that version — a different global pnpm installs against a
lockfile it does not match. `pnpm-workspace.yaml` also restricts optional native packages to
Linux, so an install on macOS or Windows silently resolves none of them; build in a container
there.

```bash
corepack enable
git clone https://github.com/LowCarbCheck/openplate.git
cd openplate
pnpm install
pnpm dev            # http://localhost:3000 — nothing to provision first
```

```bash
pnpm typecheck      # react-router typegen && tsc
pnpm lint           # oxlint --max-warnings 0
pnpm test:unit      # node --test against tests/unit/**
pnpm test:integration # node --test against tests/integration/**
pnpm build          # react-router build (NODE_ENV=production)
pnpm start          # tsx ./server.ts (NODE_ENV=production)
```

Built with React Router v8, Express, and IndexedDB in the browser. Every environment variable
is optional tuning — copy `.env.example` to `.env` if you want to change one. The image is
built from `Dockerfile.pnpm`; its entrypoint just starts the server, with no migration or
provisioning step.

## License

openplate is open source under the [MIT License](LICENSE) (SPDX: `MIT`), as is
[openplate-sync](https://github.com/LowCarbCheck/openplate-sync). Run it, read it, change it,
fork it, redistribute it, host it for others — commercially or not — with no restrictions
beyond keeping the copyright and license notice attached to any copy you distribute.
