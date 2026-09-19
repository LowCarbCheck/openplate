# Podman

Every `docker compose` and `docker run` command in these docs also works with
[Podman](https://podman.io): swap `docker` for `podman`. This page states the
one naming trap and the rootless differences once, so the other docs can link
here instead of repeating them.

## `podman compose` is not `podman-compose`

These are two different tools, and the wrong one runs a less compatible
implementation with no warning.

- **`podman compose`** (a space) is a subcommand built into Podman. It is a
  thin wrapper: it finds an external compose provider on your machine, either
  `docker-compose` or `podman-compose`, and hands the command to it. If
  `docker-compose` is installed, Podman prefers it, because it is the
  original implementation of the Compose spec. Run `podman compose --help`
  and the provider it will use is printed once, in a banner.
- **`podman-compose`** (a hyphen) is a separate, Python-based reimplementation
  of the Compose spec. It runs on its own, with no Docker involved, and it
  supports less of the spec: notably, its support for
  `depends_on: condition: service_healthy` is weaker, and it names networks
  differently by default.

Every compose file that starts Postgres (`compose.sync.yml`, `compose.full.yml`, and
openplate-core's quickstart `compose.yml`) uses
`depends_on: condition: service_healthy` to gate a service on Postgres's
healthcheck. Run `podman compose`, not `podman-compose`, unless you have
confirmed your `podman-compose` install handles that condition.

## Rootless notes

Podman runs rootless by default: your containers run as your own user, not
root. That is safer, and it brings three differences from Docker worth
knowing before you self-host.

**SELinux volume labels.** On a host with SELinux enforcing, which is
Fedora's default, a container cannot read or write a bind-mounted host
directory unless that directory carries a label for container access. Add
`:Z` to the mount if only one container uses it, or `:z` if more than one
does, for example `-v ./pg-data:/var/lib/postgresql/data:Z`. None of the
compose files in these three repos bind-mount a host directory today; they
all use named volumes, which Podman labels for you. This only applies if you
change a `volumes:` entry to a host path. It touches the sync rungs (2 and 4,
for Postgres) and the inference rung (3, for the model weights), if you make
that change.

**Ports below 1024.** A rootless container cannot bind a host port below
1024 unless you allow it, for example with
`sudo sysctl net.ipv4.ip_unprivileged_port_start=80`. None of the ports these
compose files publish by default (3000, 3001, 8300) are affected. This comes
up only if you remap one of them to 80 or 443 to skip a reverse proxy.
Because every rung publishes at least one port, it can touch any of the four.

**Rootless Postgres.** Postgres's container runs as a non-root user inside
the container, and that user needs to own its data directory. A named
volume, which is what `openplate-core/docker/compose.yml` and openplate's
`compose.sync.yml` and `compose.full.yml` already use, solves this
automatically: Podman creates the volume with the right ownership. If you
switch to a bind-mounted host directory instead, fix its ownership first,
from the host, with `podman unshare chown -R 70:70 ./pg-data` (70 is the
`postgres` user in the `postgres:17-alpine` image these files pin; the
Debian-based image uses 999), or the container fails to start with a
permissions error. Touches rungs 2 and 4.

## Quadlet units

Every compose file above also ships as a set of rootless systemd units,
generated from it by `scripts/quadlet.sh` and committed under
`docker/quadlet/`. A unit set survives a reboot under `systemctl --user`
with no compose process attached. Each directory has a README with the
install steps, the `.env` it needs, and a record of the run that started
it on a Fedora host with SELinux enforcing:

- [app](../docker/quadlet/app/README.md): rung 1, the app alone
- [sync](../docker/quadlet/sync/README.md): rung 2, Postgres, the app and openplate-core
- [inference](../docker/quadlet/inference/README.md): rung 3, openplate-inference and the app
- [full](../docker/quadlet/full/README.md): rung 4, all four
- [openplate-core](https://github.com/LowCarbCheck/openplate-core/blob/main/docker/quadlet/core/README.md): the sync service on its own
- [openplate-inference](https://github.com/LowCarbCheck/openplate-inference/blob/main/docker/quadlet/inference/README.md): the inference endpoint on its own
