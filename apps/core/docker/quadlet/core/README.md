# openplate-core as rootless Quadlet units

The files here come from `docker/compose.yml`. They run Postgres and openplate-core, nothing else. Do not edit the unit files. Change the compose file, then run `scripts/quadlet.sh generate`. This README is the only hand-written file in this directory.

## What is in this directory

- `postgres.container`: `docker.io/library/postgres:18-alpine` on the volume below, `pg_isready` healthcheck as `Notify=healthy`. Not published to the host.
- `core.container`: openplate-core, `ghcr.io/lowcarbcheck/openplate-core:latest`, published on 3000, `Requires=` and `After=` Postgres, healthcheck against `/health` as `Notify=healthy`.
- `core.defaults.env` and `postgres.defaults.env`: the values the compose file sets, one file per unit. Every optional setting from the compose file (mail, upstream AI, admin token, instance name, reported estimates, push, plans and member invites) is listed in `core.defaults.env` with its default, most of them empty.
- `postgres-data-18.volume`: the Postgres 18 data volume; Podman names it `systemd-postgres-data-18`. Units from before Postgres 18 used `postgres-data.volume` (`systemd-postgres-data`), which Postgres 18 cannot open, see [Postgres 18 upgrade](#postgres-18-upgrade).
- `openplate-core.network`: the private network both join.
- `README.md`: this file.

## The env files

Every unit reads two env files. Quadlet looks for both in the directory where the unit sits.

1. `<unit>.defaults.env` ships in this directory and holds every value set by the compose file. An update replaces it, so do not edit it.
2. `<unit>.env` is yours: `core.env` and `postgres.env`. Podman reads it second, so a line in it overrides the defaults file. It must exist, even when empty. Podman refuses to start a container whose env file is missing.

- `core.env` requires `SERVER_SECRET` (`openssl rand -hex 32`). Back this value up with the database. If you restore the database without the secret, no one can log in.
- Put any other setting in `core.env`, using the variable name defined in `core.defaults.env`. This includes `ADMIN_TOKEN` to mint the first invitation, `SERVER_PUBLIC_URL` and `CLIENT_BASE_URL` for links, `TRUST_PROXY`, and the mail block. Keep file permissions set to mode 600, because the file stores the secret.
- `POSTGRES_PASSWORD` in `postgres.env` takes effect only on an empty volume, when Postgres creates its database. Put the same password into `DATABASE_URL` in `core.env`.
- Do not set `SIGNUP_MODE` or `SMTP_SECURE`. They make the service refuse to start. Configure SMTP mail with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` in `core.env`. The `.env.example` file explains them.

After you change a file, restart its unit, for example `systemctl --user restart core.service`.

## Install

Put the unit files together in `~/.config/containers/systemd/`. Podman's systemd generator creates services from them during the next `daemon-reload`. You do not need to run `systemctl --user enable`. Every unit includes `WantedBy=default.target`, so the generator sets this up automatically. Running `systemctl --user enable` on a generated unit fails by design.

**Linger first.** A `systemctl --user` service stops when your last session ends, and it does not start at boot, unless linger is on for your user. The first line below turns it on. Without it, closing the terminal or the ssh session you installed from stops every container in this set.

```sh
loginctl enable-linger "$USER"
D=~/.config/containers/systemd/openplate-core
mkdir -p "$D"
cp docker/quadlet/core/* "$D"/
printf 'SERVER_SECRET=%s\nADMIN_TOKEN=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > "$D/core.env"
touch "$D/postgres.env"
chmod 600 "$D/core.env" "$D/postgres.env"
systemctl --user daemon-reload
systemctl --user start core.service
```

**On Podman 4.9 (Ubuntu 24.04)** `Notify=healthy` needs Podman 5.0 or newer, and 4.9 ignores it. `systemctl --user start` then returns about a second after the container starts, before the service answers. Wait for the healthcheck yourself:

```sh
until [ "$(podman inspect --format '{{.State.Health.Status}}' systemd-core)" = healthy ]; do sleep 5; done
```

**The first account.** Mint an invitation to yourself with the token from `core.env`. The answer carries a link only when `CLIENT_BASE_URL` and `SERVER_PUBLIC_URL` are set in `core.env`. Without them it says `"link":null` and gives the bare invite token:

```sh
ADMIN_TOKEN=$(grep '^ADMIN_TOKEN=' ~/.config/containers/systemd/openplate-core/core.env | cut -d= -f2)
curl -s -X POST http://127.0.0.1:3000/v1/admin/invites \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","displayName":"You","role":"admin"}'
```

Check it:

```sh
systemctl --user is-active postgres.service core.service
podman ps --filter name=systemd-
curl -s http://127.0.0.1:3000/health
```

**Update.** Pull the new image, then restart the unit:

```sh
podman pull ghcr.io/lowcarbcheck/openplate-core:latest
systemctl --user restart core.service
```

To take the units of a newer release, copy this directory over your installed one again and run `systemctl --user daemon-reload`. The copy replaces the units and the `*.defaults.env` files. It leaves your `core.env` and `postgres.env` alone, because neither ships here.

**Coming from an earlier install?** Units generated before 2026-09-27 read `openplate-core.env` and set every value with an `Environment=` line, which took precedence over that file. Rename `openplate-core.env` to `core.env`, move any setting from drop-ins into that file, and create an empty `postgres.env` next to it.

**Renamed units (2026-10-01).** The unit that runs openplate-core was `sync.container` and is `core.container` now, with `core.defaults.env` and your own `core.env` in place of `sync.env`. Your data is untouched: the volume and network units kept their names. Stop the old unit and move its files before you copy the new units over the old ones. Otherwise `sync.service` and `core.service` both start and fight over the same port. Run it from the root of the repository checkout, with `D` set to your install directory (`openplate-core` if you followed the old install steps):

```sh
D=~/.config/containers/systemd/openplate-core
systemctl --user stop sync.service
rm "$D/sync.container" "$D/sync.defaults.env"
mv "$D/sync.env" "$D/core.env"
cp docker/quadlet/core/* "$D"/
systemctl --user daemon-reload
systemctl --user start core.service
```

**Stop and remove.** This is the whole undo. Stopping `core.service` does not stop Postgres, so name both. The last line deletes every account on the instance. The first line also stops the network and volume units. Without that step, systemd still counts the network as created, and the next install in the same boot fails with `unable to find network`.

```sh
systemctl --user stop core.service postgres.service openplate-core-network.service postgres-data-18-volume.service
rm -rf ~/.config/containers/systemd/openplate-core
systemctl --user daemon-reload
podman network rm systemd-openplate-core
podman volume rm systemd-postgres-data-18
```

## Postgres 18 upgrade

These units run Postgres 18 now. They ran 17 before. Skip this section for a new install. Read it if you run an existing deployment with data in the old volume.

**What changed.** A Postgres 18 container cannot open a Postgres 17 data directory. It also nests its data one directory level deeper. The new volume unit `postgres-data-18.volume` makes Podman create volume `systemd-postgres-data-18`. Your old volume `systemd-postgres-data` remains intact. Do not copy the new units over the old ones and start them. If you do, Postgres 18 initializes an empty database in the new volume. Your data remains safe in the old volume. Migrate it as shown below. The old volume remains your rollback target until you remove it.

The steps mirror the compose upgrade in [`docker/topologies/README.md`](https://github.com/LowCarbCheck/openplate/blob/main/docker/topologies/README.md#postgres-18-upgrade), using `podman` instead of `docker` and systemd instead of compose. Run them from the repository root. `D` is your install directory. If you set custom `POSTGRES_USER` or `POSTGRES_DB` values in `postgres.env`, use them in place of `openplate` and `openplate_sync`.

```sh
D=~/.config/containers/systemd/openplate-core
COUNTS="SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"

# 1. Stop the units. Do not remove the volume.
systemctl --user stop core.service postgres.service

# 2. Start a throwaway Postgres 17 on the old volume. Count the rows. Dump everything.
podman run -d --name openplate-pg17-dump -v systemd-postgres-data:/var/lib/postgresql/data docker.io/library/postgres:17-alpine
until podman exec openplate-pg17-dump pg_isready -q -h 127.0.0.1; do sleep 1; done
podman exec openplate-pg17-dump psql -U openplate -d openplate_sync -tA -c "$COUNTS" > counts-17.txt
podman exec openplate-pg17-dump pg_dumpall -U openplate > openplate-17.sql
podman stop openplate-pg17-dump && podman rm openplate-pg17-dump
tail -n 3 openplate-17.sql    # must show: -- PostgreSQL database cluster dump complete

# 3. Replace the units, then start only Postgres 18 on the new volume.
rm "$D/postgres-data.volume"
cp apps/core/docker/quadlet/core/* "$D"/
systemctl --user daemon-reload
systemctl --user start postgres.service
until podman exec systemd-postgres pg_isready -q -h 127.0.0.1; do sleep 1; done

# 4. Restore. Postgres 18 made an empty openplate_sync, so drop it first.
#    One error line is normal: role "openplate" already exists.
podman exec -i systemd-postgres psql -U openplate -d postgres -c 'DROP DATABASE openplate_sync'
podman exec -i systemd-postgres psql -U openplate -d postgres < openplate-17.sql

# 5. Compare the rows. diff prints nothing when they match.
podman exec systemd-postgres psql -U openplate -d openplate_sync -tA -c "$COUNTS" > counts-18.txt
diff counts-17.txt counts-18.txt && echo "row counts match"

# 6. Start the rest and check the core server.
systemctl --user start core.service
until curl -sf http://127.0.0.1:3000/health; do sleep 2; done
```

A Postgres 17 container must dump the data, matching the server version that wrote it. Check the dump file's last line to verify completion. Stop here if it is incomplete. `pg_dumpall` exports roles as well, preserving the database password and leaving `SERVER_SECRET` valid. The two count files must match. If they do not, halt the upgrade and keep both volumes. The wait loops check TCP (`-h 127.0.0.1`) intentionally. During initial cluster setup, Postgres starts an ephemeral server that listens only on a domain socket. Queries sent during this phase fail with "the database system is shutting down".

**Go back.** Stop the units. Restore the original unit files: `postgres-data.volume` and `postgres.container`. Run `systemctl --user daemon-reload` and start them. They attach to the untouched `systemd-postgres-data` volume.

**Clean up** when the new units have run for a few days and a backup of them exists:

```sh
podman volume rm systemd-postgres-data
rm -f openplate-17.sql counts-17.txt counts-18.txt
```

The dump contains every account and encrypted diary. Secure it like a database backup, and delete it once verification finishes.

## SELinux and rootless notes

**SELinux labels.** This host runs SELinux in enforcing mode. Every mount here uses a named volume (`postgres-data-18.volume`). Podman labels named volumes for container access at creation time, so these units do not need `:Z`. If you point a mount at a host directory, that changes. A bind mount on an enforcing host requires `:Z` for one container or `:z` for shared access, such as `Volume=/srv/pg-data:/var/lib/postgresql:Z`. Without that flag, the container gets `Permission denied` on its data directory.

**Rootless Postgres.** The Postgres image runs as a non-root user inside the container. It runs `chown` on its data directory during the first boot. With a named volume, this works directly. Podman maps the container user into your subordinate UID range and creates the volume to match. The test run below confirmed this. For a bind mount, you must set ownership from the host first. Run `podman unshare chown -R 70:70 ./pg-data` for the alpine image. The alpine image uses UID 70 for `postgres`, while the Debian image uses UID 999. Without this step, the container stops on startup with a permissions error.

**Rootless ports.** The units publish port 3000. That sits above 1024, so it requires no extra privileges. A rootless container cannot bind host ports below 1024 unless configured on the host, such as through `sudo sysctl net.ipv4.ip_unprivileged_port_start=80`. If another process uses port 3000 on your host, change `PublishPort=` in your installed unit under `~/.config/containers/systemd/`. That local file is yours to edit. The unit file in this repository is generated. A drop-in file cannot replace a port mapping. Adding `PublishPort=` to `<unit>.container.d/*.conf` creates a second mapping alongside the first.

**Container and volume names.** Quadlet names containers using the pattern `systemd-<unit>`. For example, `podman ps` shows `systemd-postgres`. A named volume from a `.volume` unit becomes `systemd-<name>`. Within the network, each container also resolves by its compose service name (`postgres, core`). The generator assigns that name as a network alias. Environment variables like `DATABASE_URL` use this alias.

## Tested on

The record below was run before the unit was renamed from `sync` to `core` (2026-10-01). Its commands and output keep the old names: `sync.service`, `sync.env`, `systemd-sync`. The same steps now use `core.service`, `core.env` and `systemd-core`.

### Fedora, Podman 5.8.4

- Date: 2026-09-14
- Host: Fedora (Bluefin), kernel `7.0.11-200.fc44.x86_64`, SELinux `Enforcing`, no GPU, 16 cores, 60 GiB RAM
- Podman 5.8.4, rootless, as an ordinary user; podlet 0.3.2 generated the units
- Linger was already on for the user (`loginctl show-user $USER -p Linger` printed `Linger=yes`)
- Images: `ghcr.io/lowcarbcheck/openplate:latest` (400 MB), `ghcr.io/lowcarbcheck/openplate-core:latest` (189 MB, serviceVersion 0.15.0), `ghcr.io/lowcarbcheck/openplate-inference:latest` (1.01 GB), the Postgres 17 Alpine image (300 MB; the files ran 17 on that date)

The test used a temporary copy of the unit files under `~/.config/containers/systemd/`, with a new `SERVER_SECRET` in `openplate-core.env` beside them:

```sh
systemctl --user daemon-reload
systemctl --user start sync.service              # returned after 12 s the first time, 31 s with the healthcheck below
systemctl --user is-active postgres.service sync.service   # active, active
podman ps --filter name=systemd-
#   systemd-postgres  Up 47 seconds (healthy)  5432/tcp
#   systemd-sync      Up 31 seconds (healthy)  0.0.0.0:3000->3000/tcp
curl -s http://127.0.0.1:3000/health
#   {"protocolVersion":2,"envelopeVersion":1,"serviceVersion":"0.15.0","instance":{"name":"openplate",...}}  200
```

Outcome: the services started cleanly twice, once before and once after the healthcheck change described below. Fixes from testing the sync scenario earlier that day were already present. The generator used `docker.io/library/postgres` with a registry instead of the short image name, because rootless Podman requires a fully qualified name without an interactive terminal. It set `TimeoutStartSec=300` beside `Notify=healthy`, because initial `initdb` execution took 40 seconds against the 45 second default. It also set the service name as a network alias (`Network=openplate-core.network:alias=postgres`). Without that alias, the `postgres` host in `DATABASE_URL` fails to resolve, because Quadlet names the container `systemd-postgres`.

What changed here: the openplate-core image defines a `HEALTHCHECK` against `/health`. Podman discards this check on pull because GHCR serves an OCI manifest, which lacks a health field. During the first test run, `podman ps` showed `systemd-sync` without health status. The compose file now defines this check directly. The unit now includes `Notify=healthy`, and the second run reported `(healthy)`.

After testing, the units were stopped. The test run removed `systemd-postgres-data` and the network, deleted the unit files, and ran `daemon-reload`. Final checks with `podman ps -a`, `podman volume ls`, and `podman network ls` showed no remaining resources from the test.

### Ubuntu 24.04, Podman 4.9.3

- Date: 2026-09-27
- Host: a fresh Ubuntu 24.04.5 LTS VM, 4 vCPUs, 10 GiB RAM, AppArmor, no SELinux
- Podman 4.9.3 from the Ubuntu archive, rootless, as an ordinary user; openplate-core 0.22.0

Until this date, the units carried every setting as an `Environment=` line, including `Environment=ADMIN_TOKEN=` and `Environment=CLIENT_BASE_URL=`. Podman ranks those lines above the env file. The openplate app's sync set measured what that does on this Podman the same day: an `ADMIN_TOKEN` in the env file never reached the container, and 4.9 ignores the drop-in this README used to recommend. The units are now generated with every default in `sync.defaults.env` and `postgres.defaults.env`. The install, the health wait, the first account, the check and the undo were cut out of this README as committed and run word for word:

```sh
grep -c '^Environment=' sync.container   # 0
podman ps
#   systemd-postgres  Up 42 seconds (healthy)
#   systemd-sync      Up 37 seconds (healthy)  0.0.0.0:3000->3000/tcp
curl -s -X POST http://127.0.0.1:3000/v1/admin/invites ...   # with ADMIN_TOKEN= empty in sync.defaults.env, the real one in sync.env
#   {"emailed":false,"link":null,"token":"si_..."}
printf 'CLIENT_BASE_URL=https://app.fromenvfile.example\nSERVER_PUBLIC_URL=https://sync.fromenvfile.example\n' >> sync.env
systemctl --user restart sync.service
curl -s -X POST http://127.0.0.1:3000/v1/admin/invites ...
#   "link":"https://app.fromenvfile.example/join#server=https%3A%2F%2Fsync.fromenvfile.example&invite=si_..."
# the undo: units=0 containers=0 volumes=0 networks=0
```

Outcome: both units came up healthy. The token in `sync.env` minted an invitation, and the two addresses in `sync.env` built its link over the empty defaults. Two fixes from the openplate app's full set run on the same day are in this README too: linger is the first line of the install, and the undo stops the network and volume units. In the full set, the old undo left the network unit `active (exited)`, and the next install in that boot could not find its network.
