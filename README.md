<p align="center"><img src=".github/brand/readme-banner.png" alt="openplate, an open-source food diary that runs on your device" width="100%"></p>

# openplate

An open-source, self-hosted food tracker with **BYOK (bring-your-own-key) AI plate identification**. Take a photo of your plate. Your chosen AI provider (OpenRouter, Mistral, any OpenAI-compatible endpoint, or Anthropic) estimates the macros. You keep your key, your provider, and your data.

**By default, there are no accounts.** There is no sign-up, no login, and no password. Open the app and start logging. Your diary lives in IndexedDB in your browser on your device. The app server has no database. An operator can run a managed instance instead, with `INSTANCE_MODE=managed`. There, an administrator invites people, each person gets an account and signs in, and accounts carry a shared AI allowance. Device sync is optional on either setup. A separate service handles it. The diary is encrypted on the device before upload. Whoever runs the core server keeps a backup key to reset forgotten passwords, and that key lets them read the diary.

Find guides, screenshots, and full documentation on [openplate.de](https://openplate.de), or see the repository [Documentation](#documentation) section.

## Quickstart

Run openplate on your machine. Start the base setup with two commands:

```bash
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/compose.yml
docker compose -f compose.yml up -d
```

This command runs one container from `ghcr.io/lowcarbcheck/openplate`. It needs no database, secret, or `.env` file. Open `http://localhost:3000`. The server stores no data. Your diary stays in your browser storage. Back it up using the in-app JSON export. Add your own AI key in Settings.

To add services, pick a compose file:

| Setup | What you gain | What you now run |
| --- | --- | --- |
| App only, [`docker/compose.yml`](docker/compose.yml) | The whole tracker. This is the quickstart above. | One stateless container. |
| App and core server, [`compose.core.yml`](docker/topologies/compose.core.yml) | Accounts, and sync across a person's devices. | Three containers with Postgres. Back up the database and `SERVER_SECRET`. |
| App and inference, [`compose.inference.yml`](docker/topologies/compose.inference.yml) | One-tap AI for everyone, on your own hardware. | Two containers and about 2 GiB of model weights. |
| Everything, [`compose.full.yml`](docker/topologies/compose.full.yml) | All of the above together. | Four containers. |

See [`docker/topologies/`](docker/topologies/README.md) for setup and backup guides. Podman units live in [`docker/quadlet/`](docker/quadlet).

### Hosted by the maintainers

To skip hosting, use the maintainer instance at **<https://app.openplate.de>**. New signups get 10 free AI scans or 14 days, whichever comes first. No credit card is needed. Continued use requires a paid subscription. See [Pricing](https://openplate.de/pricing) for details. The client encrypts your diary before sync. As with any managed instance, the operator holds a backup key that can read your data.

## What is in this repository

Each app has its own folder, README, releases, and container image. Only the app is required. You can run any subset of the remaining services.

| App | What it is | Run it | Docs |
| --- | --- | --- | --- |
| [app](apps/app) | The app. Accountless, local-first, stateless, boots with no required secrets. Image `ghcr.io/lowcarbcheck/openplate`, release tags `v*`. | `make dev APP=app`, port 3000 | [README](apps/app/README.md) |
| [core](apps/core) | The account service. Includes encrypted sync with an operator-held backup key, and the AI allowance of a managed instance. Image `ghcr.io/lowcarbcheck/openplate-core`, release tags `core-v*`. | `make dev APP=core`, port 3000. Needs Postgres and an `apps/core/.env` first. | [README](apps/core/README.md) |
| [inference](apps/inference) | A self-hosted, OpenAI-compatible plate-photo endpoint: open-weight models, your own hardware. Image `ghcr.io/lowcarbcheck/openplate-inference`, release tags `inference-v*`. | `make dev APP=inference`, port 8300. Needs a model runtime. | [README](apps/inference/README.md) |

[`docker/`](docker) holds the compose files and Podman units that run the apps together.

The project site, [openplate.de](https://openplate.de), lives in the private repository `LowCarbCheck/openplate-website` and is built by Bay from its `main`.

Until 2026-09-28, the three services lived in separate repositories: `openplate-core`, `openplate-inference`, and `openplate-website`. Those repositories are now archived, and the history of core and inference is here. The website was split out again on 2026-10-02 and now lives in the private repository `LowCarbCheck/openplate-website`.

## Documentation

Start with [Architecture](apps/app/docs/architecture.md) and [Self-hosting](apps/app/docs/self-hosting.md). The app [README](apps/app/README.md) lists every guide, and [openplate.de](https://openplate.de) renders all of them.

## Development

The sections through [License](#license) cover contributing to the codebase; to only run the app, jump to [Quickstart](#quickstart).

### First ten minutes

Prerequisites: Node 24 or newer, pnpm 11, git, and make. Make, Node, and pnpm are all required.

```bash
git clone https://github.com/LowCarbCheck/openplate.git && cd openplate
make install
make test
make dev APP=app
```

`make install` sets up the pre-push hook and installs each app. `make test` runs the unit tests for all three apps. `make dev APP=app` serves the app at `http://localhost:3000`. The table above shows how to run the other apps. Each app keeps its own lockfile and scripts. The root `Makefile` only runs them.

### Before you push

The pre-push hook is the only test gate. There is no cloud test runner. `make check` runs the drift check, then this gate for all three apps, without pushing. The gate and its hooks run without nix and without the toolbox. Node, pnpm, and make suffice for most stages. Only one full gate runs at a time on a host: a push takes an exclusive `flock` on `/tmp/openplate-gate.lock`. A second push waits up to an hour and says who holds the lock. Without `flock`, the gate runs unguarded and says so.

The gate has two tiers. The push gate runs lint, typecheck, unit tests, the build, and a scoped browser run: the smoke set, the specs for the touched area, and the specs the push changed. Shared code runs the full browser tier. A push of a tag `v*`, `core-v*` or `inference-v*` runs the full tier before the tag leaves your machine, and `OPENPLATE_E2E_FULL=1 git push` forces it on any push. A nightly run of the full tier on origin/main writes its result to `~/.local/state/openplate/nightly-e2e/latest.txt`. `make nightly` installs the timer, and `make nightly-status` prints the last result. A red nightly does not block a push. See ADR-0022 in `apps/app/.adr/`.

```bash
make check
```

Some stages need extra tools. Each stage stops the push and names any missing tool:

- **podlet** (app, core, inference): checks the Podman units under `docker/quadlet/`. Install it with `brew install podlet`, or run `apps/app/scripts/quadlet.sh --install <dir>` and add that directory to your `PATH`. The script also needs `python3`.
- **Chromium** (app): runs browser tests. Run `pnpm exec playwright install chromium` in the app directory. On Linux, `pnpm exec playwright install --with-deps chromium` also installs system libraries.
- **Postgres** (core): runs integration tests. In `apps/core`, run `docker compose -f docker/compose.dev.yml up -d`, or point `TEST_DATABASE_URL` to another Postgres instance. `SKIP_INTEGRATION=1 git push` skips these tests once.

### Optional environments

These environments are optional. They offer alternative ways to run Node and pnpm.

- **toolbox**: if the `toolbox` command exists, every hook runs its Node stages inside a container named `ts-dev`. Maintainers use this setup because their host lacks build tools. Browser tests always run on the host.
- **nix**: running `nix develop` at the repository root opens a shell with Node 24 and pnpm 11 from the root `flake.nix`. It also provides git and make. It works on x86_64-linux, aarch64-linux, and aarch64-darwin.

The browser tier does not run in the nix shell or in the toolbox. It runs on the host with the Chromium that Playwright downloads. The flake does not set `PLAYWRIGHT_BROWSERS_PATH`, because nixpkgs browsers belong to Playwright 1.63.0 while the apps pin 1.62.1. The flake can set it once the versions match.

`make drift` checks that the flake, `.nvmrc` files, `engines` and `packageManager` fields, Dockerfiles, and the release workflow agree on Node and pnpm.

### Three independent apps

The repository holds three independent apps. It has no root pnpm workspace and no shared lockfile. Each app has its own lockfile, pnpm settings, and release. Each image builds from its own app folder, and corepack installs the pnpm version from that app's `packageManager` field. All three apps use Node 24 and pnpm 11.5.1. Two conditions would change this setup:

- Trigger 1: two apps really import the same package.
- Trigger 2: a dependency bump that must change in three places and really hurts.

### Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) explains how to submit a pull request, and [`SECURITY.md`](SECURITY.md) explains how to report a vulnerability. Each app builds, tests, and releases independently. Start with [First ten minutes](#first-ten-minutes), then use the scripts in each app's README.

## License

MIT license, see [LICENSE](LICENSE). You can run, read, modify, fork, redistribute, and host it for others, commercially or non-commercially. The only requirement is keeping the copyright and license notice attached to any copy you distribute.
