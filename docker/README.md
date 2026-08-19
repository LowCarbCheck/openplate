# Docker build notes

openplate's real Dockerfiles live at the repo root (`Dockerfile`, `Dockerfile.bun`, `Dockerfile.pnpm` — the hosted instance builds `Dockerfile.pnpm`, see `argo-sprqvntrs/group_vars/all/services.yml`'s `openplate` service block). This directory holds build-related documentation only, no Dockerfile of its own.

## Compose files at the repo root

| File                      | What it brings up                                                  | Who it is for                                         |
| ------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| `docker-compose.yml`      | Postgres + the app.                                                | Everyone. No secrets, no accounts, no sync.           |
| `docker-compose.full.yml` | Postgres + the app + the `openplate-sync` service, wired together. | Self-hosters who also want end-to-end-encrypted sync. |

`docker-compose.full.yml` is the only place the two components are described together; the sync service's own repo ships a compose file for running it alone.

## E2EE sync needs no build step here

M117 shipped a build-time composition seam: a private sync engine was built in a separate repo and its `dist/` copied into a gitignored `app/lib/sync/engine/` **before** `docker build` ran. That required a pre-build hook Argo's `services.yml` never had, so the step stayed manual — and the browser half of the bundle was never built at all, which is why the sync UI only ever said "coming soon".

The seam is gone (M128 spec 01). `app/lib/sync/engine/` is ordinary tracked source, built by Vite like the rest of the app, so **the Dockerfiles need no sync-specific step whatsoever** — there is no copy stage, no private build context and no extra script to run before an image build.

The sync _server_ is a separate deployable (`openplate-sync`) with its own image, database and secrets. This app reaches it only from the browser, at a runtime `SYNC_SERVER_URL`; nothing in this image talks to it.
