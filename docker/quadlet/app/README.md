# openplate app as a rootless Quadlet unit

Generated from `docker/compose.yml`, the one-container scenario: the openplate app, no sync, no inference. Do not edit the unit files. Change the compose file and run `scripts/quadlet.sh generate`. This README is the one hand-written file here.

## What is in this directory

- `app.container`: the app, `ghcr.io/lowcarbcheck/openplate:latest`, published on port 3000, with the compose healthcheck against `/healthcheck` turned into `Notify=healthy`.
- `openplate.network`: the private network the container joins, named after the compose project.
- `README.md`: this file.

## The .env file

None. Every value this scenario needs has a default in the compose file, and the generator wrote those defaults into the unit as `Environment=` lines. To change one, add a drop-in: `~/.config/containers/systemd/openplate/app.container.d/local.conf` with a `[Container]` section and one `Environment=KEY=value` line per key. A later `Environment=` for the same key replaces the earlier one.

## Install

The unit files go to `~/.config/containers/systemd/`, together, in one directory. Podman's systemd generator turns them into services on the next `daemon-reload`. There is no `systemctl --user enable` step: every unit carries `WantedBy=default.target`, and the generator wires that up for you. A `systemctl --user enable` on a generated unit fails, and that is expected.

```sh
mkdir -p ~/.config/containers/systemd/openplate
cp docker/quadlet/app/* ~/.config/containers/systemd/openplate/
systemctl --user daemon-reload
systemctl --user start app.service
```

Check it:

```sh
systemctl --user is-active app.service
podman ps --filter name=systemd-app
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```

**Linger.** A `systemctl --user` service stops when your last session ends, and it does not start at boot unless the user's systemd instance starts at boot. Turn that on once:

```sh
loginctl enable-linger "$USER"
```

**Update.** Pull the new image, then restart the unit that runs it:

```sh
podman pull ghcr.io/lowcarbcheck/openplate:latest
systemctl --user restart app.service
```

**Stop and remove.** `systemctl --user stop app.service` stops the containers. Remove the unit files and run `systemctl --user daemon-reload` to drop the services. Named volumes stay until you `podman volume rm` them.

## SELinux and rootless notes

**SELinux labels.** This scenario mounts nothing, so there is no label to get right. If you add a bind mount on an SELinux enforcing host (Fedora's default), give it `:Z` (one container uses it) or `:z` (several do), for example `Volume=/srv/data:/data:Z`, or the container gets `Permission denied`.

**Rootless ports.** The unit publishes 3000, which is above 1024, so no extra privilege is needed. A rootless container cannot bind a host port below 1024 unless you allow it, for example `sudo sysctl net.ipv4.ip_unprivileged_port_start=80`. If 3000 is taken on your host, change `PublishPort=` in your installed copy of the unit (the copy under `~/.config/containers/systemd/` is yours to edit; the copy in this repository is generated). A drop-in file cannot replace a port: `PublishPort=` in an `app.container.d/*.conf` adds a second mapping next to the first.

**Container names.** Quadlet names the container `systemd-app`, so that is what `podman ps` shows.

## Tested on

- Date: 2026-09-14
- Host: Fedora (Bluefin), kernel `7.0.11-200.fc44.x86_64`, SELinux `Enforcing`, no GPU, 16 cores, 60 GiB RAM
- Podman 5.8.4, rootless, as an ordinary user; podlet 0.3.2 generated the units
- Linger was already on for the user (`loginctl show-user $USER -p Linger` printed `Linger=yes`)
- Images: `ghcr.io/lowcarbcheck/openplate:latest` (400 MB), `ghcr.io/lowcarbcheck/openplate-core:latest` (189 MB, serviceVersion 0.15.0), `ghcr.io/lowcarbcheck/openplate-inference:latest` (1.01 GB), `docker.io/library/postgres:17-alpine` (300 MB)

What was run, from a throwaway copy of the unit files under `~/.config/containers/systemd/`:

```sh
systemctl --user daemon-reload
systemctl --user start app.service        # returned after 31 s, once the healthcheck passed
systemctl --user is-active app.service    # active
podman ps --filter name=systemd-app       # systemd-app  Up 31 seconds (healthy)  0.0.0.0:3000->3000/tcp
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/   # 200
curl -s http://127.0.0.1:3000/healthcheck                             # OK
```

Outcome: started clean, first try. The 31 seconds are the healthcheck's 30 second start period plus one probe; `Notify=healthy` holds the `start` until then.

Afterwards the unit was stopped, the network removed, the files deleted, `daemon-reload` run again, and `podman ps -a`, `podman volume ls` and `podman network ls` showed nothing from this run.

Two generator fixes from the other scenarios of the same test pass also reach this unit:

- Every unit that gets `Notify=healthy` also gets `TimeoutStartSec=300`. The user manager's default on this host is 45 seconds, which a first boot of Postgres in the sync scenario exceeded. The generator now writes both lines together.
- The compose service name is set as a network alias, so the container is reachable as `app` inside its network, not only as `systemd-app`.
