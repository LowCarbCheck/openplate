# openplate

An open-source, self-hosted food tracker with **BYOK (bring-your-own-key) AI plate identification**. Take a photo of your plate. Your chosen AI provider (OpenRouter, Mistral, any OpenAI-compatible endpoint, or Anthropic) estimates the macros. You keep your key, your provider, and your data.

**By default, there are no accounts.** There is no sign-up, no login, and no password. Open the app and start logging. Your diary lives in IndexedDB in your browser on your device. The app server has no database. An operator can run a managed instance instead, with `INSTANCE_MODE=managed`. There, an administrator invites people, each person gets an account and signs in, and accounts carry a shared AI allowance. Device sync is optional on either setup. A separate service handles it. The diary is encrypted on the device before upload. Whoever runs the sync server keeps a backup key to reset forgotten passwords, and that key lets them read the diary.

## Try it

**<https://openplate.lowcarbcheck.org>** runs this code. This demo instance comes with no uptime guarantee, no support, and no backups. Your diary stays in that browser. Clearing the browser clears your diary.

## Quickstart

```bash
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/compose.yml
docker compose -f compose.yml up -d
```

This deployment uses one container, no database, and no `.env` configuration step. The app is reachable at `http://localhost:3000`. [`docker/topologies/`](docker/topologies/README.md) contains larger setups for sync, self-hosted AI, and running all services together.

## What is in this repository

Each app has its own folder, README, releases, and container image. Only the app is required. You can run any subset of the remaining services.

| App | What it is | Run it | Docs |
| --- | --- | --- | --- |
| [app](apps/app) | The app. Accountless, local-first, stateless, boots with no required secrets. Image `ghcr.io/lowcarbcheck/openplate`, release tags `v*`. | `make dev APP=app`, port 3000 | [README](apps/app/README.md) |
| [core](apps/core) | The account service. Includes encrypted sync with an operator-held backup key, and the AI allowance of a managed instance. Image `ghcr.io/lowcarbcheck/openplate-core`, release tags `core-v*`. | `make dev APP=core`, port 3000. Needs Postgres and an `apps/core/.env` first. | [README](apps/core/README.md) |
| [inference](apps/inference) | A self-hosted, OpenAI-compatible plate-photo endpoint: open-weight models, your own hardware. Image `ghcr.io/lowcarbcheck/openplate-inference`, release tags `inference-v*`. | `make dev APP=inference`, port 8300. Needs a model runtime. | [README](apps/inference/README.md) |
| [website](apps/website) | [openplate.de](https://openplate.de), the project site and the rendered documentation. No image, no release tags. | `make dev APP=website`, port 3000 | [README](apps/website/README.md) |

[`docker/`](docker) holds the compose files and Podman units that run the apps together.

Until 2026-09-28, the three services lived in separate repositories: `openplate-core`, `openplate-inference`, and `openplate-website`. Those repositories are now archived, and their full history is here.

## Documentation

Start with [Architecture](apps/app/docs/architecture.md) and [Self-hosting](apps/app/docs/self-hosting.md). The app [README](apps/app/README.md) lists every guide, and [openplate.de](https://openplate.de) renders all of them.

## First ten minutes

Prerequisites: Node 24 or newer, pnpm 11, git and make. Make is required, as Node and pnpm are.

```bash
git clone https://github.com/LowCarbCheck/openplate.git && cd openplate
make install
make test
make dev APP=app
```

`make install` turns on the pre-push hook and installs each app. `make test` runs the unit tests of all four apps. `make dev APP=app` serves the app at `http://localhost:3000`. The table above shows how to run the other apps. Each app keeps its own lockfile and scripts; the root `Makefile` only runs them for you.

## Before you push

The pre-push hook is the only test gate. There is no cloud test runner. `make check` runs the same gate for all four apps without a push. Some stages need a tool besides Node and pnpm. Each stage stops the push and names the tool when it is missing:

- **podlet** (app, core, inference): checks the Podman units under `docker/quadlet/`. Install it with `brew install podlet`, or with `apps/app/scripts/quadlet.sh --install <dir>` and put that directory on your `PATH`. The script also needs `python3`.
- **Chromium** (app, website): the browser tests. Run `pnpm exec playwright install chromium` in the app folder. On Linux, `pnpm exec playwright install --with-deps chromium` also installs its system libraries.
- **Postgres** (core): the integration tests. In `apps/core`, run `docker compose -f docker/compose.dev.yml up -d`, or set `TEST_DATABASE_URL` to another Postgres. `SKIP_INTEGRATION=1 git push` skips them once.
- **The network** (website): the docs check clones three repositories. `SKIP_SYNC=1 git push` skips it once when you are offline.

## Optional environments

You do not need any of these. They are other ways to get the same Node and pnpm.

- **toolbox**: when a `toolbox` command exists, every hook runs its Node stages in a toolbox container named `ts-dev`. The maintainers work this way, because their host has no build tools. The browser tests always run on the host.
- **nix**: `nix develop` at the repository root opens a shell with Node 24 and pnpm 11 from the root `flake.nix`.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) explains how to submit a pull request, and [`SECURITY.md`](SECURITY.md) explains how to report a vulnerability. Each app builds, tests, and releases independently. Start with [First ten minutes](#first-ten-minutes), then use the scripts in each app's README.

## License

MIT license, see [LICENSE](LICENSE). You can run, read, modify, fork, redistribute, and host it for others, commercially or non-commercially. The only requirement is keeping the copyright and license notice attached to any copy you distribute.
