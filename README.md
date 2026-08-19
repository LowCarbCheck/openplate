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
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker-compose.yml
docker compose up -d
```

That is the whole setup — one container, no database, no `.env` step, no secret to generate.
The app is reachable at `http://localhost:3000`.

Upgrading is `docker compose pull && docker compose up -d`. There is no server-side state to
migrate or lose.

### Run the full stack (with sync)

If you also want end-to-end-encrypted sync across devices,
[`docker-compose.full.yml`](docker-compose.full.yml) brings up the app, the
[openplate-sync](https://github.com/LowCarbCheck/openplate-sync) service, and the Postgres that
sync — and only sync — needs:

```bash
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker-compose.full.yml
echo "SERVER_SECRET=$(openssl rand -hex 32)" >> .env
docker compose -f docker-compose.full.yml up -d
```

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

## The three components

Run any subset. Only the first one is required.

| Component                                                                     | What it is                                                                                    | Needed?                                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **openplate** (this repo)                                                     | The app. Accountless, local-first, stateless, boots with no secrets.                          | Yes — it is the product.                                         |
| **[openplate-sync](https://github.com/LowCarbCheck/openplate-sync)**          | An account service whose first feature is end-to-end-encrypted sync. Stores an email address and ciphertext it holds no key for. | No. Everything works without it.                                 |
| **[openplate-inference](https://github.com/LowCarbCheck/openplate-inference)**| A self-hosted, OpenAI-compatible plate-photo endpoint — open-weight models, your own hardware. | No. BYOK cloud providers work without it.                        |

## Documentation

- [docs/self-hosting.md](docs/self-hosting.md) — compose walkthroughs, first run, HTTPS,
  backups, upgrading.
- [docs/configuration.md](docs/configuration.md) — every environment variable, the
  Content-Security-Policy, custom and instance-provided AI endpoints, the OpenRouter flow.
- [docs/sync.md](docs/sync.md) — enabling sync across devices and how the encryption works.
- [`.adr/`](.adr/) — architecture decision records. Start with
  [ADR-0006](.adr/0006-the-app-server-holds-no-accounts.md) for why this server has no
  accounts.
- [`AGENTS.md`](AGENTS.md) — coding guidelines for this repo; [`CLAUDE.md`](CLAUDE.md) imports
  it.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to send a pull request.
- [`SECURITY.md`](SECURITY.md) — reporting a vulnerability.

## Development

Requires Node.js ≥ 22 and pnpm. There is no database to install and no service to start
alongside it.

```bash
git clone https://github.com/LowCarbCheck/openplate.git
cd openplate
pnpm install
pnpm dev            # http://localhost:3000 — nothing to provision first
```

```bash
pnpm typecheck      # react-router typegen && tsc
pnpm lint           # eslint --max-warnings 0
pnpm test:unit      # node --test against tests/unit/**
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
