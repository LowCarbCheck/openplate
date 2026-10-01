# Self-hosting shapes

openplate needs one container and offers two optional services. Pick the
smallest shape that fits your needs. Every added service is one more thing
you back up, upgrade, and debug. [docs/topologies.md](../../apps/app/docs/topologies.md)
explains the same four shapes in more detail, as rungs 1 to 4.

| # | Shape | File | What you gain | What you now operate |
|---|-------|------|---------------|----------------------|
| 0 | Nothing to run | none | Use the hosted instance, or any public instance, and connect your own AI provider key in Settings → AI. Your diary stays in your browser either way. | Nothing. Someone else handles uptime, and you pay your provider bill directly. |
| 1 | App only | [`../compose.yml`](../compose.yml) | The whole tracker, self-hosted. You need no database, no secret, and no `.env` step. Users still bring their own AI key. | One stateless container. Nothing to back up on the server. Diaries live on each device. |
| 2 | App + core server | [`compose.core.yml`](compose.core.yml) | Sync across a user's devices, plus user accounts. Devices encrypt diaries before upload. Accounts need an email, a password, and an invite. | Three containers, Postgres, `SERVER_SECRET` (back it up with the database), and `ADMIN_TOKEN`. The core server holds a backup key per account to reset passwords: this key lets the operator read the diary. A reset restores the diary. Mail is optional. Without it, share invite and reset links by hand. |
| 3 | App + inference | [`compose.inference.yml`](compose.inference.yml) | One-tap AI for everyone on the instance. You need no provider account and no per-user key. Plate photos never leave your network. | Two containers, about 2 GiB of model weights, and the hardware to run them. The inference key sits in the page every browser loads. Anyone who can open the app can read it. |
| 4 | Everything | [`compose.full.yml`](compose.full.yml) | Shapes 2 and 3 together. | Four containers. All of the above at once. |

Diaries are per-device in every shape. Shape 2 moves a diary between devices.
The in-app JSON export moves it anywhere else.

Each file header lists setup steps and the `.env` lines it needs. Read the file
you picked before running it. Keep it in a folder that lasts, such as
`~/openplate`.

**Shapes 2 and 4 need a secure page to sign in.** Over plain
`http://<LAN address>`, sign-in, sign-up, and invitation links fail. In every
shape, plain HTTP breaks app installation and offline use. See the HTTPS
section of [docs/self-hosting.md](../../apps/app/docs/self-hosting.md#https). The same
page shows how to create the first account in shapes 2 and 4.

Every file here also runs under `podman compose`, the same way. That is a
different tool from `podman-compose`. On Ubuntu, it needs `podman-compose`
installed as its provider. See [docs/podman.md](../../apps/app/docs/podman.md) for the
distinction, and for rootless notes on SELinux volume labels, ports below
1024, and the Postgres data directory for shapes 2 through 4.

## Self-host upgrade note

The shape 2 file was `compose.sync.yml`. It is `compose.core.yml` now, and the
compose service that runs openplate-core is called `core`, not `sync`. Your data
does not move. The project name (`openplate-with-sync`) and the volume (`pg-data`)
are unchanged, so Compose finds the volume your database already lives in. Shape 4
(`compose.full.yml`) keeps its file name. Only its service is renamed, and its
project name and volumes are unchanged as well. For shape 4, fetch the new
`compose.full.yml`, then run `docker compose -f compose.full.yml down --remove-orphans`
and `docker compose -f compose.full.yml up -d`. The `down` clears the old `sync`
container, which would otherwise hold port 3001.

To move a running shape 2 install across:

```sh
cd ~/openplate
docker compose -f compose.sync.yml down --remove-orphans   # your old file, never add -v
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/topologies/compose.core.yml
docker compose -f compose.core.yml pull
docker compose -f compose.core.yml up -d
```

1. Stop the stack with the file name you used before. `down` removes the
   containers and keeps the volumes. Do not add `-v`, because that deletes the
   database.
2. Fetch the new file beside your `.env`. The `.env` needs no change.
3. Start the stack with the new file name.
4. Run `docker volume ls`. The volume `openplate-with-sync_pg-data` is still
   there, and `docker compose -f compose.core.yml logs core` shows the service
   starting on your existing database.

For one release `compose.sync.yml` stays in this folder as a stub that includes
`compose.core.yml`, so `docker compose -f compose.sync.yml up -d` still starts
the same stack. Fetch both files if you want that to keep working. The stub goes
away in a later release. If you start from the stub while the old `sync`
container still runs, Compose warns about an orphan container. Run
`docker compose -f compose.sync.yml down --remove-orphans` once and start again.

If you wrote your own commands against the service name, such as
`docker compose logs sync` or `exec sync`, change `sync` to `core`. If you run
the shapes as Quadlet units, the commands that move an install across are in
[`../quadlet/core/README.md`](../quadlet/core/README.md).

## Postgres 18 upgrade

`compose.core.yml` and `compose.full.yml` now run Postgres 18 (`postgres:18-alpine`),
up from 17. Skip this section for a new install. Read it if you run shape 2 or 4
and have diary data in the old volume.

**What changed.** A Postgres 18 container cannot read a Postgres 17 data
directory. It also stores data one level deeper, moving the mount point from
`/var/lib/postgresql/data` to `/var/lib/postgresql`. The files define a new volume,
`pg-data-18`, for this reason. Your old volume `pg-data` remains intact. If you
only swap the file and start it, Compose makes an empty `pg-data-18` and the core
server starts without your data. The data remains safe in `pg-data`. Follow the
steps below to migrate it. Keep the old volume for rollback until you remove it.

**The steps.** The example uses shape 2. For shape 4, use `compose.full.yml`
and replace `openplate-with-sync_pg-data` with `openplate-full_pg-data`. Run the
commands from the directory with your compose file and `.env`. If you set
`POSTGRES_USER` or `SYNC_DB_NAME` in `.env`, use those values instead of
`openplate` and `openplate_sync`.

```sh
cd ~/openplate

# The query that counts the rows of every table. Used twice, to compare.
COUNTS="SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"

# 1. Stop the stack. Never add -v, it deletes the volume.
docker compose -f compose.core.yml down

# 2. Start a throwaway Postgres 17 on the old volume. Count the rows. Dump everything.
docker run -d --name openplate-pg17-dump -v openplate-with-sync_pg-data:/var/lib/postgresql/data docker.io/library/postgres:17-alpine
until docker exec openplate-pg17-dump pg_isready -q -h 127.0.0.1; do sleep 1; done
docker exec openplate-pg17-dump psql -U openplate -d openplate_sync -tA -c "$COUNTS" > counts-17.txt
docker exec openplate-pg17-dump pg_dumpall -U openplate > openplate-17.sql
docker stop openplate-pg17-dump && docker rm openplate-pg17-dump
tail -n 3 openplate-17.sql    # must show: -- PostgreSQL database cluster dump complete

# 3. Keep the old file, fetch the new one, and start only Postgres 18 on the new volume.
cp compose.core.yml compose.core.17.yml
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/topologies/compose.core.yml
docker compose -f compose.core.yml up -d postgres
until docker compose -f compose.core.yml exec -T postgres pg_isready -q -h 127.0.0.1; do sleep 1; done

# 4. Restore. Postgres 18 made an empty openplate_sync, so drop it first.
#    One error line is normal: role "openplate" already exists.
docker compose -f compose.core.yml exec -T postgres psql -U openplate -d postgres -c 'DROP DATABASE openplate_sync'
docker compose -f compose.core.yml exec -T postgres psql -U openplate -d postgres < openplate-17.sql

# 5. Compare the rows. diff prints nothing when they match.
docker compose -f compose.core.yml exec -T postgres psql -U openplate -d openplate_sync -tA -c "$COUNTS" > counts-18.txt
diff counts-17.txt counts-18.txt && echo "row counts match"

# 6. Start the rest of the stack and check the core server.
docker compose -f compose.core.yml up -d
until curl -sf http://127.0.0.1:3001/health; do sleep 2; done
```

1. Stop the stack with your old file. `down` removes containers but keeps volumes.
2. The throwaway 17 container reads the old volume, so the matching server
   version dumps the data. Check the final line of the dump to confirm it
   finished cleanly. Stop here if it failed.
3. `compose.core.17.yml` lets you roll back. Compose creates `pg-data-18` on the
   first start, and Postgres 18 sets up an empty cluster. The wait loop checks
   TCP (`-h 127.0.0.1`) intentionally. During setup, Postgres runs a
   brief bootstrap server that listens only on a socket. The container can report
   `healthy` during that phase, causing commands to fail with "the database
   system is shutting down".
4. `pg_dumpall` includes roles, so it exports the user password. The restore
   needs no changes to `SERVER_SECRET`.
5. The row count files must match. If they differ, stop and keep both volumes.
6. The core server connects to its tables and starts. The loop polls `/health`
   until it responds. Sign in from a previously synced device to confirm it works.

**Go back.** If migration fails, run `docker compose -f compose.core.yml down`
without `-v`. Then run `docker compose -f compose.core.17.yml up -d` to restart
Postgres 17 on the untouched volume.

**Clean up** once the new stack runs smoothly for a few days and you have a
working backup:

```sh
docker volume rm openplate-with-sync_pg-data
rm -f openplate-17.sql counts-17.txt counts-18.txt compose.core.17.yml
```

The dump contains every account and encrypted diary. Guard it like a database
backup, and remove it when you finish.

**Quadlet.** The unit files use the same naming: `pg-data.volume` is now
`pg-data-18.volume`, and Podman creates `systemd-pg-data-18`. Run the same
commands with `podman` instead of `docker`. The old volume is `systemd-pg-data`.
See [`../quadlet/core/README.md`](../quadlet/core/README.md#postgres-18-upgrade).

