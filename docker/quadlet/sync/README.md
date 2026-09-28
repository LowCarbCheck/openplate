# openplate with sync as rootless Quadlet units

Generated from `docker/topologies/compose.sync.yml`, rung 2: Postgres, the openplate app, and openplate-core (the sync service). Do not edit the unit files. Change the compose file and run `apps/app/scripts/quadlet.sh generate`. This README is the one hand-written file here.

## What is in this directory

- `postgres.container`: `docker.io/library/postgres:17-alpine` on the volume below, with the `pg_isready` healthcheck as `Notify=healthy`. Not published to the host.
- `sync.container`: openplate-core, `ghcr.io/lowcarbcheck/openplate-core:latest`, published on 3001, `Requires=` and `After=` Postgres, healthcheck against `/health` as `Notify=healthy`.
- `app.container`: the app, `ghcr.io/lowcarbcheck/openplate:latest`, published on 3000, with `SYNC_SERVER_URL=http://localhost:3001` in its defaults file. The browser talks to the sync service directly, so that address must be one your browser can reach.
- `app.defaults.env`, `sync.defaults.env`, `postgres.defaults.env`: the values the compose file sets, one file per unit.
- `pg-data.volume`: the Postgres data volume; Podman names it `systemd-pg-data`.
- `openplate-with-sync.network`: the private network all three join.
- `README.md`: this file.

## The env files

Every unit reads two env files. Quadlet looks for both in the directory where the unit sits.

1. `<unit>.defaults.env` ships in this directory and holds every value set by the compose file. An update replaces it, so do not edit it.
2. `<unit>.env` is yours: `app.env`, `sync.env` and `postgres.env`. Podman reads it second, so a line in it overrides the defaults file. It must exist, even when empty. Podman refuses to start a container whose env file is missing.

Your files use the container's own variable names, not the names in the compose file's `.env`. What compose calls `PUBLIC_APP_URL` is `APP_URL` for the app and `CLIENT_BASE_URL` for sync.

- `sync.env` requires `SERVER_SECRET` (`openssl rand -hex 32`). Back this value up alongside the database. If you restore the database without the secret, no user can log in. The first account also requires `ADMIN_TOKEN` in this file. The install instructions below generate and write both.
- Values people change: `APP_URL` and `SYNC_SERVER_URL` in `app.env`; `CLIENT_BASE_URL` and `SERVER_PUBLIC_URL` in `sync.env`, the same two addresses, which build every invitation link; `TRUST_PROXY` in `app.env` and `sync.env` both. Variables with an empty compose default (`ADMIN_TOKEN`, the mail block, the AI proxy, the member-invite limits) are in the defaults file with no value. Set them in `sync.env`.
- `POSTGRES_PASSWORD` in `postgres.env` takes effect only on an empty volume, when Postgres creates its database. Put the same password into `DATABASE_URL` in `sync.env`.
- Do not set `SIGNUP_MODE`. openplate-core rejects it at boot. Signup is invite-only.

After you change a file, restart its unit, for example `systemctl --user restart sync.service`.

## Install

The unit files go to `~/.config/containers/systemd/`, together, in one directory. Podman's systemd generator turns them into services on the next `daemon-reload`. There is no `systemctl --user enable` step. If you run it, it prints, for example, `Failed to enable unit: Unit /run/user/1000/systemd/generator/app.service is transient or generated.` That is expected, and it does not mean Quadlet failed: the service exists and starts. Start at boot comes from the `[Install] WantedBy=default.target` line in every unit together with linger (the first line of the install), not from `enable`.

**Pick one path.** These units and a compose stack (with or without a systemd unit of your own that runs it) are alternatives. Run both and they fight over the same ports after every reboot. Stop and remove the other one first.

**Linger first.** A `systemctl --user` service stops when your last session ends, and it does not start at boot, unless linger is on for your user. The first line below turns it on. Without it, closing the terminal or the ssh session you installed from stops every container in this set.

```sh
loginctl enable-linger "$USER"
D=~/.config/containers/systemd/openplate-sync
mkdir -p "$D"
cp docker/quadlet/sync/* "$D"/
printf 'SERVER_SECRET=%s\nADMIN_TOKEN=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > "$D/sync.env"
touch "$D/app.env" "$D/postgres.env"
chmod 600 "$D/app.env" "$D/sync.env" "$D/postgres.env"
systemctl --user daemon-reload
systemctl --user start app.service sync.service
```

**No reverse proxy in front?** `app.defaults.env` sets `TRUST_PROXY=1`, which is correct behind a proxy. Without a proxy, any visitor can fake their address. Set `TRUST_PROXY=0` in your own `app.env` and restart. `sync.env` does not need this line, because `sync.defaults.env` already sets `TRUST_PROXY=0`:

```sh
echo TRUST_PROXY=0 >> ~/.config/containers/systemd/openplate-sync/app.env
systemctl --user restart app.service
```

**On Podman 4.9 (Ubuntu 24.04)** `Notify=healthy` needs Podman 5.0 or newer, and 4.9 ignores it. `systemctl --user start` then returns about a second after the container starts, before the app answers. Wait for the healthcheck yourself:

```sh
until [ "$(podman inspect --format '{{.State.Health.Status}}' systemd-sync)" = healthy ]; do sleep 5; done
```

**The first account.** Mint an invitation to yourself as [self-hosting.md](../../../apps/app/docs/self-hosting.md#create-the-first-account) shows, reading the token from `sync.env`:

```sh
ADMIN_TOKEN=$(grep '^ADMIN_TOKEN=' ~/.config/containers/systemd/openplate-sync/sync.env | cut -d= -f2)
```

Check it:

```sh
systemctl --user is-active postgres.service sync.service app.service
podman ps --filter name=systemd-
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
curl -s http://127.0.0.1:3001/health
```

**Update.** Pull the new image, then restart the unit that runs it:

```sh
podman pull ghcr.io/lowcarbcheck/openplate:latest ghcr.io/lowcarbcheck/openplate-core:latest
systemctl --user restart app.service sync.service
```

To take the units of a newer release, copy this directory over your installed one again and run `systemctl --user daemon-reload`. The copy replaces the units and the `*.defaults.env` files. It leaves your three `<unit>.env` files alone, because none ships here.

**Coming from an earlier install?** Units generated before 2026-09-27 read a single file, `openplate-with-sync.env`, and only on `sync.container`. Rename that file to `sync.env`, then create an empty `app.env` and `postgres.env` next to it.

**Stop and remove.** This is the whole undo. Stopping `sync.service` does not stop Postgres, so name all three. The last line deletes every account and diary on the instance. The first line also stops the network and volume units. Without that step, systemd still counts the network as created, and the next install in the same boot fails with `unable to find network`.:

```sh
systemctl --user stop app.service sync.service postgres.service openplate-with-sync-network.service pg-data-volume.service
rm -rf ~/.config/containers/systemd/openplate-sync
systemctl --user daemon-reload
podman network rm systemd-openplate-with-sync
podman volume rm systemd-pg-data
```

## SELinux and rootless notes

**SELinux labels.** This host runs SELinux enforcing. Every mount here is a named volume (`pg-data.volume`). Podman labels a named volume for container access when it creates it, so nothing needed a `:Z`. That changes the moment you point a mount at a host directory instead. A bind mount on an enforcing host needs `:Z` (one container uses it) or `:z` (several do), for example `Volume=/srv/pg-data:/var/lib/postgresql/data:Z`. Otherwise, the container gets `Permission denied` on its own data directory.

**Rootless Postgres.** The Postgres image runs as its own non-root user inside the container and `chown`s its data directory at first boot. On a named volume that just works. Podman maps the container user into your subordinate UID range, and the volume is created to match. That is what the test run below saw. With a bind mount you must fix ownership from the host first. Run `podman unshare chown -R 70:70 ./pg-data` for the alpine image (70 is `postgres` there; the Debian image uses 999). Otherwise, the container stops at start with a permissions error.

**Rootless ports.** The units publish 3000 and 3001, all above 1024. No extra privilege is needed. A rootless container cannot bind a host port below 1024 unless you allow it, for example `sudo sysctl net.ipv4.ip_unprivileged_port_start=80`. If a port is taken on your host, change `PublishPort=` in your installed copy of the unit. The copy under `~/.config/containers/systemd/` is yours to edit. The copy in this repository is generated. A drop-in file cannot replace a port. `PublishPort=` in a `<unit>.container.d/*.conf` adds a second mapping next to the first.

**Container and volume names.** Quadlet names each container `systemd-<unit>`, so `podman ps` shows `systemd-postgres`. A named volume from a `.volume` unit becomes `systemd-<name>`. Inside the network every container also answers to its compose service name (`postgres, sync, app`), because the generator sets that name as a network alias. That alias is what `DATABASE_URL` and the like rely on.

## Tested on

### Fedora, Podman 5.8.4

- Date: 2026-09-14
- Host: Fedora (Bluefin), kernel `7.0.11-200.fc44.x86_64`, SELinux `Enforcing`, no GPU, 16 cores, 60 GiB RAM
- Podman 5.8.4, rootless, as an ordinary user; podlet 0.3.2 generated the units
- Linger was already on for the user (`loginctl show-user $USER -p Linger` printed `Linger=yes`)
- Images: `ghcr.io/lowcarbcheck/openplate:latest` (400 MB), `ghcr.io/lowcarbcheck/openplate-core:latest` (189 MB, serviceVersion 0.15.0), `ghcr.io/lowcarbcheck/openplate-inference:latest` (1.01 GB), `docker.io/library/postgres:17-alpine` (300 MB)

What was run, from a throwaway copy of the unit files under `~/.config/containers/systemd/`, with a fresh `SERVER_SECRET` in `openplate-with-sync.env` beside them:

```sh
systemctl --user daemon-reload
systemctl --user start app.service sync.service      # returned after 31 s
systemctl --user is-active postgres.service sync.service app.service   # active, active, active
podman ps --filter name=systemd-
#   systemd-postgres  Up 56 seconds (healthy)  5432/tcp
#   systemd-app       Up 56 seconds (healthy)  0.0.0.0:3000->3000/tcp
#   systemd-sync      Up 31 seconds (healthy)  0.0.0.0:3001->3000/tcp
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/   # 200
curl -s http://127.0.0.1:3001/health
#   {"protocolVersion":2,"envelopeVersion":1,"serviceVersion":"0.15.0","instance":{"name":"openplate",...}}  200
```

Outcome: started clean with the units as committed now. It took four attempts to get there. Each failure changed the generator or the compose file, never a unit:

1. **Short image name.** `postgres:17-alpine` is a short name, and rootless Podman refuses to pick a registry for one without a terminal to ask on, so the unit could not pull. Fix: the compose file now says `docker.io/library/postgres:17-alpine`.
2. **First boot beat the start timeout.** Postgres's first boot runs `initdb`, which took 40 seconds on this laptop (two rounds of fsync). The user manager's `TimeoutStartSec` default here is 45 seconds, and the `pg_isready` probe runs every 5 seconds, so `Notify=healthy` had not fired when systemd killed the container. `Restart=always` brought Postgres back, but `sync.service` has `Requires=postgres.service` and its start job had already failed for good. Fix: the generator writes `TimeoutStartSec=300` under `[Service]` in every unit it gives `Notify=healthy`.
3. **`SIGNUP_MODE` is a boot failure.** The compose file still forwarded `SIGNUP_MODE=open`; openplate-core 0.15.0 rejects it and exits, and the container restarted in a loop. Fix: the variable is gone from `compose.sync.yml` and `compose.full.yml`. This one also broke the compose path.
4. **`postgres` did not resolve.** Quadlet names the container `systemd-postgres`, and that is the only name Podman's DNS knew, so `DATABASE_URL=postgres://...@postgres:5432/...` failed with `ENOTFOUND` ten times and the sync service gave up. Compose sets the service name as a DNS alias; the generator now does the same (`Network=openplate-with-sync.network:alias=postgres`).

One more thing came out of the run: the openplate-core image bakes in a `HEALTHCHECK`. Podman drops it on pull because GHCR serves an OCI manifest, which has no health field. `podman ps` showed `systemd-sync` with no health at all. The compose file now declares the same check. The unit gets `Notify=healthy`, and `podman ps` reports `(healthy)`.

Afterwards the units were stopped. The `systemd-pg-data` volume and the network were removed. The files were deleted. `daemon-reload` ran again. `podman ps -a`, `podman volume ls`, and `podman network ls` showed nothing from this run.

### Ubuntu 24.04, Podman 4.9.3

- Dates: 2026-09-27, three times
- Host: fresh Ubuntu 24.04.5 LTS VMs (4 vCPUs and 8 GiB, then 2 vCPUs and 4 GiB), AppArmor, no SELinux
- Podman 4.9.3 from the Ubuntu archive, rootless, linger on; openplate-core 0.22.0

The first run used units that still carried `Environment=ADMIN_TOKEN=` and friends, written by the generator for every empty compose default:

```sh
podman exec systemd-sync printenv ADMIN_TOKEN     # empty: the unit's Environment=ADMIN_TOKEN= beat the env file
# a drop-in sync.container.d/local.conf with Environment=ADMIN_TOKEN=...: still empty, 4.9 reads no drop-in
```

So the generator now drops every empty default. The second run used the units from this directory as committed, with `ADMIN_TOKEN` only in the env file:

```sh
grep -c ADMIN_TOKEN sync.container                # 0
systemctl --user daemon-reload
systemctl --user start app.service sync.service
podman ps
#   systemd-app       Up 58 seconds (healthy)
#   systemd-postgres  Up 42 seconds (healthy)
#   systemd-sync      Up 36 seconds (healthy)
curl -s -X POST http://127.0.0.1:3001/v1/admin/invites -H "Authorization: Bearer $ADMIN_TOKEN" ...
#   "emailed":false,"link":"http://localhost:3000/join#server=http%3A%2F%2Flocalhost%3A3001&invite=si_..."
echo CLIENT_BASE_URL=https://fromenvfile.example >> openplate-with-sync.env; systemctl --user restart sync.service
podman exec systemd-sync printenv CLIENT_BASE_URL # http://localhost:3000: a non-empty default still wins
```

Outcome of that second run: all three units came up healthy, and the token in the env file minted an invitation. A value with a non-empty default could still be changed only inside the unit.

A third run on the same day used a fresh VM (4 vCPUs, 10 GiB). It used the units in this directory as committed, with every default moved to a `*.defaults.env` file and no `Environment=` line remaining. The install, the health wait, the first account, the check, and the undo were copied from this README and run word for word:

```sh
podman ps   # systemd-app, systemd-postgres, systemd-sync, all (healthy) after about 32 s
curl -s -X POST http://127.0.0.1:3001/v1/admin/invites -H "Authorization: Bearer $ADMIN_TOKEN" ...
#   "emailed":false,"link":"http://localhost:3000/join#server=..."
echo CLIENT_BASE_URL=https://fromenvfile.example >> sync.env; systemctl --user restart sync.service
podman exec systemd-sync printenv CLIENT_BASE_URL   # https://fromenvfile.example, over http://localhost:3000 in sync.defaults.env
#   and the next invitation link began https://fromenvfile.example/join
# the undo: units=0 containers=0 volumes=0 networks=0
```

Testing on the same day showed that the old undo left `openplate-with-sync-network.service` in state `active (exited)`. Because of that, the next install during the same boot could not find its network. The README for the full set records the error. The undo above now stops both the network and volume units.
