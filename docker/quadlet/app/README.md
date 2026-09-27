# openplate app as a rootless Quadlet unit

Generated from `docker/compose.yml`, the one-container scenario: the openplate app, no sync, no inference. Do not edit the unit files. Change the compose file and run `scripts/quadlet.sh generate`. This README is the one hand-written file here.

## What is in this directory

- `app.container`: the app, `ghcr.io/lowcarbcheck/openplate:latest`, published on port 3000, with the compose healthcheck against `/healthcheck` turned into `Notify=healthy`.
- `app.defaults.env`: the values the compose file sets.
- `openplate.network`: the private network the container joins, named after the compose project.
- `README.md`: this file.

## The env files

The unit reads two env files. Quadlet looks for both in the directory where the unit sits.

1. `app.defaults.env` ships in this directory and holds every value set by the compose file. An update replaces it, so do not edit it.
2. `app.env` is yours. Podman reads it second, so a line in it overrides the defaults file. It must exist, even when empty. Podman refuses to start a container whose env file is missing. The install below creates it empty.

Typical settings include `APP_URL` when running behind a reverse proxy, or `TRUST_PROXY=0` when running directly without one. After you change the file, run `systemctl --user restart app.service`.

## Install

The unit files go to `~/.config/containers/systemd/`, together, in one directory. Podman's systemd generator turns them into services on the next `daemon-reload`. There is no `systemctl --user enable` step. If you run it, it prints, for example, `Failed to enable unit: Unit /run/user/1000/systemd/generator/app.service is transient or generated.` That is expected, and it does not mean Quadlet failed: the service exists and starts. Start at boot comes from the `[Install] WantedBy=default.target` line in every unit together with linger (the first line of the install), not from `enable`.

**Pick one path.** These units and a compose stack (with or without a systemd unit of your own that runs it) are alternatives. Run both and they fight over the same ports after every reboot. Stop and remove the other one first.

**Linger first.** A `systemctl --user` service stops when your last session ends, and it does not start at boot, unless linger is on for your user. The first line below turns it on. Without it, closing the terminal or the ssh session you installed from stops every container in this set.

```sh
loginctl enable-linger "$USER"
mkdir -p ~/.config/containers/systemd/openplate
cp docker/quadlet/app/* ~/.config/containers/systemd/openplate/
touch ~/.config/containers/systemd/openplate/app.env
systemctl --user daemon-reload
systemctl --user start app.service
```

**No reverse proxy in front?** `app.defaults.env` sets `TRUST_PROXY=1`, which is correct behind a proxy. Without a proxy, any visitor can fake their address. Set `TRUST_PROXY=0` in your own file and restart:

```sh
echo TRUST_PROXY=0 >> ~/.config/containers/systemd/openplate/app.env
systemctl --user restart app.service
```

**On Podman 4.9 (Ubuntu 24.04)** `Notify=healthy` needs Podman 5.0 or newer, and 4.9 ignores it. `systemctl --user start` then returns about a second after the container starts, before the app answers. Wait for the healthcheck yourself:

```sh
until [ "$(podman inspect --format '{{.State.Health.Status}}' systemd-app)" = healthy ]; do sleep 5; done
```

Check it:

```sh
systemctl --user is-active app.service
podman ps --filter name=systemd-app
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```

**Update.** Pull the new image, then restart the unit that runs it:

```sh
podman pull ghcr.io/lowcarbcheck/openplate:latest
systemctl --user restart app.service
```

To take the unit of a newer release, copy this directory over your installed one again and run `systemctl --user daemon-reload`. The copy replaces `app.container` and `app.defaults.env`. It leaves your `app.env` alone, because it does not ship here. An install from before 2026-09-27 has no `app.env`: create it before the restart, or the unit does not start.

**Stop and remove.** This is the whole undo. Quadlet names the network `systemd-openplate`, after `openplate.network`. The first line also stops the network unit. Without it, systemd still counts the network as created, and the next install in the same boot fails with `unable to find network`:

```sh
systemctl --user stop app.service openplate-network.service
rm -rf ~/.config/containers/systemd/openplate
systemctl --user daemon-reload
podman network rm systemd-openplate
```

This scenario has no volume. Turn linger off with `loginctl disable-linger "$USER"` if nothing else of yours needs it.

## SELinux and rootless notes

**SELinux labels.** This scenario mounts nothing, so there is no label to get right. If you add a bind mount on an SELinux enforcing host (Fedora's default), give it `:Z` (one container uses it) or `:z` (several do), for example `Volume=/srv/data:/data:Z`, or the container gets `Permission denied`.

**Rootless ports.** The unit publishes 3000, which is above 1024, so no extra privilege is needed. A rootless container cannot bind a host port below 1024 unless you allow it, for example `sudo sysctl net.ipv4.ip_unprivileged_port_start=80`. If 3000 is taken on your host, change `PublishPort=` in your installed copy of the unit (the copy under `~/.config/containers/systemd/` is yours to edit; the copy in this repository is generated). A drop-in file cannot replace a port: `PublishPort=` in an `app.container.d/*.conf` adds a second mapping next to the first.

**Container names.** Quadlet names the container `systemd-app`, so that is what `podman ps` shows.

## Tested on

### Fedora, Podman 5.8.4

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

### Ubuntu 24.04, Podman 4.9.3

- Date: 2026-09-27
- Host: a fresh Ubuntu 24.04.5 LTS VM, 4 vCPUs, 8 GiB RAM, AppArmor, no SELinux
- Podman 4.9.3 from the Ubuntu archive, rootless, as an ordinary user; the units from this directory as committed

```sh
systemctl --user daemon-reload
systemctl --user start app.service      # returned after 1 s: 4.9 ignores Notify=healthy
podman ps                               # systemd-app  Up Less than a second (starting)
systemctl --user enable app.service
#   Failed to enable unit: Unit /run/user/1000/systemd/generator/app.service is transient or generated.
until [ "$(podman inspect --format '{{.State.Health.Status}}' systemd-app)" = healthy ]; do sleep 5; done   # 25 s later
loginctl enable-linger "$USER"
sudo systemctl reboot
podman ps                               # after the reboot: systemd-app  Up 50 seconds (healthy)
```

Outcome: the unit came back after the reboot with no `enable`, from `WantedBy=default.target` and linger alone. The undo steps above then left no container and no network behind.

A second run on the same day used a fresh VM (4 vCPUs, 8 GiB). It tested the unit in this directory as committed, with its defaults in `app.defaults.env` and no remaining `Environment=` line. The install, the health wait, the check, and the undo were copied from this README and run word for word, twice in one boot:

```sh
podman ps   # systemd-app  Up 36 seconds (healthy)  0.0.0.0:3000->3000/tcp
echo TRUST_PROXY=0 >> app.env; systemctl --user restart app.service
podman exec systemd-app printenv TRUST_PROXY   # 0, over 1 in app.defaults.env
# each undo: units=0 containers=0 volumes=0 networks=0, and the second install came up healthy
```

The undo procedure now stops `openplate-network.service` as well. The README for the full set shows why: without that stop, a second install during the same boot could not find its network.
