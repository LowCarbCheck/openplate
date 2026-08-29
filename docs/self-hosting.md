# Self-hosting

openplate ships as a prebuilt multi-arch Docker image (`linux/amd64` + `linux/arm64` —
Raspberry-Pi-class boxes are a first-class target) published to the GitHub Container Registry
on every push to `main` and on version tags. There are no secrets to generate and nothing to
sign up for beyond your own AI provider key.

Nothing here is a reduced edition. Local-first tracking, BYOK AI plate scanning, PWA install,
JSON export/import, the whole interface: identical to the hosted instance, because it is the
same image. The only thing the hosted deployment adds is that we operate the optional sync
service for you — and that is also open source, for you to run yourself.

## The app on its own

```bash
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/compose.yml
docker compose -f compose.yml up -d
```

One container, no database, no `.env` step, no secret to generate. The app is reachable at
`http://localhost:3000`.

The port is published on **every** interface, so the app is also reachable at this machine's
LAN address the moment `up -d` returns. On a shared network, change the `ports:` line to
`'127.0.0.1:3000:3000'` and reach it through a reverse proxy instead.

To build from source instead of pulling the published image, comment out `image:` in
[`docker/compose.yml`](../docker/compose.yml), uncomment `build:`, and run — from the repo
root, because the build context is written relative to that file:

```bash
docker compose --project-directory . -f docker/compose.yml build
docker compose --project-directory . -f docker/compose.yml up -d
```

Every other shape (sync, self-hosted inference, both) is a separate file under
[`docker/topologies/`](../docker/topologies/). [topologies.md](topologies.md) is the map of
which one you want.

## The app plus your own sync service

[`docker/topologies/compose.sync.yml`](../docker/topologies/compose.sync.yml) is the
reference deployment for the app, the sync service, and the Postgres that **sync** needs. The
app still connects to no database of its own. (If you also want self-hosted inference, use
[`docker/topologies/compose.full.yml`](../docker/topologies/compose.full.yml) instead — same
sync setup, plus the model runtime.)

```bash
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/topologies/compose.sync.yml

# The sync service needs exactly one secret. Generate it and keep it with your backups.
echo "SERVER_SECRET=$(openssl rand -hex 32)" >> .env

# The URLs a BROWSER will use to reach each service.
echo "PUBLIC_APP_URL=https://openplate.example.com" >> .env
echo "PUBLIC_SYNC_URL=https://sync.example.com" >> .env

docker compose -f compose.sync.yml up -d
```

**Read [openplate-sync's README](https://github.com/LowCarbCheck/openplate-sync) before you
run that last line on a machine other people can reach.** Both services publish their ports
on every interface, so the account service is exposed the moment it starts — and running an
account service is a bigger undertaking than running the app.

The file is annotated line by line, including the two settings that will actually hurt you if
you get them wrong (`SERVER_SECRET` and `TRUST_PROXY`).
See [sync.md](sync.md) for what sync is and how the client reaches it.

## First run

1. Open the app and follow the short onboarding. No registration, no login — whoever opens
   the app on a device is that device's user.
2. Go to **Settings → AI** and connect an AI provider with your own API key (OpenRouter,
   Mistral, your own OpenAI-compatible endpoint, or Anthropic). See
   [configuration.md](configuration.md) for the OpenRouter one-click flow and for offering an
   instance-provided endpoint instead.
3. Take a backup early: **Profile → Your data → Download everything (JSON)**. Your diary
   lives in this browser's storage, so a backup is the only copy that survives clearing site
   data or moving to a new device.

## HTTPS

PWA install, the offline service worker, and the camera capture behind **Scan Plate** all
require a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts).
Browsers refuse `getUserMedia` and service-worker registration over plain HTTP — `localhost`
is exempt, which is why the quickstart works unmodified for local testing. Plain-HTTP LAN
access still works for the diary, manual logging and backups; you only lose install, offline
and camera.

Two easy paths to a real certificate on a home server.

**Caddy reverse proxy** (automatic Let's Encrypt renewal; needs a domain pointed at your
server):

```
# Caddyfile
openplate.example.com {
    reverse_proxy localhost:3000
}
```

Then set `APP_URL=https://openplate.example.com` in `.env` (and `TRUST_PROXY=1`, the
production default) and recreate the `app` service with
`docker compose -f compose.yml up -d`. A plain `docker compose restart` does **not** re-read
`.env` — it restarts the container it already built, so the new values never arrive.

Also change the `ports:` line to `'127.0.0.1:3000:3000'`, then apply it the same way with
`docker compose -f compose.yml up -d`. A proxy in front does not unpublish the container port:
leave it as `'3000:3000'` and the app keeps answering plain HTTP on port 3000 to the whole
network, beside the HTTPS address you just set up.

**Tailscale Serve** (no domain, no port-forwarding, HTTPS on your own tailnet):

```bash
tailscale serve --bg 3000
```

Tailscale issues and renews the certificate; the app becomes reachable at
`https://<machine-name>.<tailnet>.ts.net`. Set `APP_URL` to that URL.

## Backups

**There is nothing on the app server to back up.** It holds no database and writes no state —
a destroyed app container loses nothing.

**The per-device JSON export is the backup that matters**: **Profile → Your data → Download
everything**. That file is the copy that outlives a cleared browser or a dead phone. The app
shows a reminder banner when a device holds data you have never exported, or have not exported
in a while.

If you also run the sync service, its Postgres is worth a scheduled dump — together with the
`SERVER_SECRET`, which is useless without the database and vice versa:

```bash
docker compose -f compose.sync.yml exec postgres \
  pg_dump -U openplate openplate_sync > sync-backup.sql
```

## Upgrading

```bash
docker compose -f compose.yml pull
docker compose -f compose.yml up -d
```

Use the same `-f` file you deployed with. If you brought up a topology from
[`docker/topologies/`](../docker/topologies/), name that file instead — for example
`docker compose -f compose.sync.yml pull`. A bare `docker compose pull` beside
`compose.sync.yml` fails with `no configuration file provided: not found`.

There is nothing to migrate: the app container holds no state, so a new image just replaces
the old one. If you run the full stack, the sync service applies its own migrations on start.

### Upgrading from a pre-0.1.x image (one time)

Older images ran an account system and a Postgres of their own. Both are gone. The upgrade
drops the `users` table and everything hanging off it — accounts, sessions, verification and
reset tokens. Nothing you logged is affected: tracker data had already moved onto the device.
It is a one-way change, so:

1. **Back up first.** Take a `pg_dump` of the app's old database if you want the account rows
   recoverable, and have every person on every device take a JSON export from **Profile → Your
   data**. That export is the copy that holds their diary.
2. **Upgrade.** First update the `image:` line to `ghcr.io/lowcarbcheck/openplate:latest` —
   pre-0.1.x images were published under `ghcr.io/sprqvntrs/openplate`, and pulling without
   this change just re-fetches the old one. The migration then runs on container start. Afterwards there is no login page:
   every device that already has data keeps it and simply stops asking who you are.
3. **Prune your `.env`.** The session-secret, encryption-key, signup-gate and seeded-superadmin
   variables are gone, and so are `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` and
   the pool-tuning variables. Nothing reads them. Leaving them set is harmless, but they are
   dead weight.
4. **Drop the old volume** once you are happy. Older releases pinned no Compose project name,
   so the prefix came from whatever directory you ran in — confirm the real name first:
   `docker volume ls | grep pg-data`, then `docker compose down && docker volume rm <that name>`.

If two accounts were signed in on the **same** browser profile, note that the device store was
always device-scoped — their data was already sharing one store and stays that way. Separate
browser profiles remain the way to keep two people's diaries apart on one device.
