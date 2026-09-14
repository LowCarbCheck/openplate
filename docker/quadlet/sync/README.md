# openplate with sync as rootless Quadlet units

Generated from `docker/topologies/compose.sync.yml`, rung 2: Postgres, the openplate app, and openplate-core (the sync service). Do not edit the unit files. Change the compose file and run `scripts/quadlet.sh generate`. This README is the one hand-written file here.

## What is in this directory

- `postgres.container`: `docker.io/library/postgres:17-alpine` on the volume below, with the `pg_isready` healthcheck as `Notify=healthy`. Not published to the host.
- `sync.container`: openplate-core, `ghcr.io/lowcarbcheck/openplate-core:latest`, published on 3001, `Requires=` and `After=` Postgres, healthcheck against `/health` as `Notify=healthy`.
- `app.container`: the app, `ghcr.io/lowcarbcheck/openplate:latest`, published on 3000, with `SYNC_SERVER_URL=http://localhost:3001`. The browser talks to the sync service directly, so that address must be one your browser can reach.
- `pg-data.volume`: the Postgres data volume; Podman names it `systemd-pg-data`.
- `openplate-with-sync.network`: the private network all three join.
- `README.md`: this file.

## The .env file

`sync.container` carries `EnvironmentFile=openplate-with-sync.env`. The path is relative. Quadlet resolves it against the directory the unit sits in, so the file goes beside the units. The unit refuses to start without it. One key is required:

- `SERVER_SECRET`: `openssl rand -hex 32`. Back it up with the database; a restored database with a lost secret is one nobody can log into.

Every other value has a compose default and is written into the units as `Environment=`. Override one with a drop-in (`sync.container.d/local.conf`, a `[Container]` section, one `Environment=KEY=value` per line). Do not set `SIGNUP_MODE`. openplate-core rejects it at boot. Signup is invite-only, always.

## Install

The unit files go to `~/.config/containers/systemd/`, together, in one directory. Podman's systemd generator turns them into services on the next `daemon-reload`. There is no `systemctl --user enable` step. Every unit carries `WantedBy=default.target`, and the generator wires that up for you. A `systemctl --user enable` on a generated unit fails, and that is expected.

```sh
mkdir -p ~/.config/containers/systemd/openplate-sync
cp docker/quadlet/sync/* ~/.config/containers/systemd/openplate-sync/
printf 'SERVER_SECRET=%s\n' "$(openssl rand -hex 32)" > ~/.config/containers/systemd/openplate-sync/openplate-with-sync.env
chmod 600 ~/.config/containers/systemd/openplate-sync/openplate-with-sync.env
systemctl --user daemon-reload
systemctl --user start app.service sync.service
```

Check it:

```sh
systemctl --user is-active postgres.service sync.service app.service
podman ps --filter name=systemd-
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
curl -s http://127.0.0.1:3001/health
```

**Linger.** A `systemctl --user` service stops when your last session ends. It does not start at boot unless the user's systemd instance starts at boot. Turn that on once:

```sh
loginctl enable-linger "$USER"
```

**Update.** Pull the new image, then restart the unit that runs it:

```sh
podman pull ghcr.io/lowcarbcheck/openplate:latest ghcr.io/lowcarbcheck/openplate-core:latest
systemctl --user restart app.service sync.service
```

**Stop and remove.** `systemctl --user stop app.service sync.service` stops the containers. Remove the unit files and run `systemctl --user daemon-reload` to drop the services. Named volumes stay until you `podman volume rm` them (`systemd-pg-data` here).

## SELinux and rootless notes

**SELinux labels.** This host runs SELinux enforcing. Every mount here is a named volume (`pg-data.volume`). Podman labels a named volume for container access when it creates it, so nothing needed a `:Z`. That changes the moment you point a mount at a host directory instead. A bind mount on an enforcing host needs `:Z` (one container uses it) or `:z` (several do), for example `Volume=/srv/pg-data:/var/lib/postgresql/data:Z`. Otherwise, the container gets `Permission denied` on its own data directory.

**Rootless Postgres.** The Postgres image runs as its own non-root user inside the container and `chown`s its data directory at first boot. On a named volume that just works. Podman maps the container user into your subordinate UID range, and the volume is created to match. That is what the test run below saw. With a bind mount you must fix ownership from the host first. Run `podman unshare chown -R 70:70 ./pg-data` for the alpine image (70 is `postgres` there; the Debian image uses 999). Otherwise, the container stops at start with a permissions error.

**Rootless ports.** The units publish 3000 and 3001, all above 1024. No extra privilege is needed. A rootless container cannot bind a host port below 1024 unless you allow it, for example `sudo sysctl net.ipv4.ip_unprivileged_port_start=80`. If a port is taken on your host, change `PublishPort=` in your installed copy of the unit. The copy under `~/.config/containers/systemd/` is yours to edit. The copy in this repository is generated. A drop-in file cannot replace a port. `PublishPort=` in a `<unit>.container.d/*.conf` adds a second mapping next to the first.

**Container and volume names.** Quadlet names each container `systemd-<unit>`, so `podman ps` shows `systemd-postgres`. A named volume from a `.volume` unit becomes `systemd-<name>`. Inside the network every container also answers to its compose service name (`postgres, sync, app`), because the generator sets that name as a network alias. That alias is what `DATABASE_URL` and the like rely on.

## Tested on

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
