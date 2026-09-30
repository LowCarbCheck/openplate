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

| Folder | What it is | Image | Release tags |
| --- | --- | --- | --- |
| [`apps/app`](apps/app) | The app. Accountless, local-first, stateless, boots with no required secrets. | `ghcr.io/lowcarbcheck/openplate` | `v*` |
| [`apps/core`](apps/core) | The account service. Includes encrypted sync with an operator-held backup key, and the AI allowance of a managed instance. | `ghcr.io/lowcarbcheck/openplate-core` | `core-v*` |
| [`apps/inference`](apps/inference) | A self-hosted, OpenAI-compatible plate-photo endpoint: open-weight models, your own hardware. | `ghcr.io/lowcarbcheck/openplate-inference` | `inference-v*` |
| [`apps/website`](apps/website) | [openplate.de](https://openplate.de), the project site and the rendered documentation. | none | none |
| [`docker/`](docker) | The compose files and Podman units that run the apps together. | | |

Until 2026-09-28, the three services lived in separate repositories: `openplate-core`, `openplate-inference`, and `openplate-website`. Those repositories are now archived, and their full history is here.

## Documentation

Start with [Architecture](apps/app/docs/architecture.md) and [Self-hosting](apps/app/docs/self-hosting.md). The app [README](apps/app/README.md) lists every guide, and [openplate.de](https://openplate.de) renders all of them.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) explains how to submit a pull request, and [`SECURITY.md`](SECURITY.md) explains how to report a vulnerability. Each app builds, tests, and releases independently. Run `cd apps/<name>`, run `pnpm install`, and use the scripts in its README.

## License

MIT license, see [LICENSE](LICENSE). You can run, read, modify, fork, redistribute, and host it for others, commercially or non-commercially. The only requirement is keeping the copyright and license notice attached to any copy you distribute.
