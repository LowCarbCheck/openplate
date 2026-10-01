# openplate-inference as a rootless Quadlet unit

Generated from `docker/compose.yml`: the inference endpoint on its own, a plate scanner any OpenAI-compatible client can call. Do not edit the unit files; change the compose file and run `scripts/quadlet.sh generate`. This README is the one hand-written file here.

## What is in this directory

- `inference.container`: `ghcr.io/lowcarbcheck/openplate-inference:latest`, published on 8300, weights on the volume below.
- `inference.defaults.env`: the values the compose file sets, `MODEL_PROFILE=lite` and the placeholder `API_KEYS=opk_CHANGE_ME` among them.
- `inference-models.volume`: the weights; Podman names it `systemd-inference-models`. About 2 GiB after the first boot, verified by sha256 on every start.
- `openplate-inference.network`: the private network the container joins.
- `README.md`: this file.

## The env files

The unit reads two env files. Quadlet looks for both in the directory where the unit sits.

1. `inference.defaults.env` ships in this directory and holds every value set by the compose file. An update replaces it, so do not edit it.
2. `inference.env` is yours. Podman reads it second, so a line in it overrides the defaults file. It must exist, even when empty. Podman refuses to start a container whose env file is missing.

The primary value to change is `API_KEYS`. The install steps below write a generated key there. Add `MODEL_PROFILE`, `CONCURRENCY`, and any remaining options to this same file. After you save changes, run `systemctl --user restart inference.service`.

## Install

The unit files go to `~/.config/containers/systemd/`, together, in one directory. Podman's systemd generator turns them into services on the next `daemon-reload`. There is no `systemctl --user enable` step: every unit carries `WantedBy=default.target`, and the generator wires that up for you. A `systemctl --user enable` on a generated unit fails, and that is expected.

**Linger first.** A `systemctl --user` service stops when your last session ends, and it does not start at boot, unless linger is on for your user. The first line below turns it on. Without it, closing the terminal or the ssh session you installed from stops every container in this set. A weights download stopped that way resumes from where it paused, but only once you log in again.

```sh
loginctl enable-linger "$USER"
mkdir -p ~/.config/containers/systemd/openplate-inference
cp docker/quadlet/inference/* ~/.config/containers/systemd/openplate-inference/
printf 'API_KEYS=opk_%s\n' "$(openssl rand -hex 24)" > ~/.config/containers/systemd/openplate-inference/inference.env
chmod 600 ~/.config/containers/systemd/openplate-inference/inference.env
systemctl --user daemon-reload
systemctl --user start inference.service
```

Check it:

```sh
systemctl --user is-active inference.service
podman ps --filter name=systemd-inference
curl -s http://127.0.0.1:8300/readyz
```

**Update.** Pull the new image, then restart the unit that runs it:

```sh
podman pull ghcr.io/lowcarbcheck/openplate-inference:latest
systemctl --user restart inference.service
```

To take the units of a newer release, copy this directory over your installed one again and run `systemctl --user daemon-reload`. The copy replaces the unit and `inference.defaults.env`. It leaves your `inference.env` alone, because it does not ship here.

**Coming from an earlier install?** Units generated before 2026-09-27 did not read an environment file, which meant keys were set in the unit file or a drop-in. Move your key into `inference.env` as `API_KEYS=` before restarting, or the unit fails to start.

**Stop and remove.** This is the whole undo. The last line deletes the weights, so a new install downloads them again. The first line also stops the network and volume units. Without that step, systemd still counts the network as created, and the next install in the same boot fails with `unable to find network`.

```sh
systemctl --user stop inference.service openplate-inference-network.service inference-models-volume.service
rm -rf ~/.config/containers/systemd/openplate-inference
systemctl --user daemon-reload
podman network rm systemd-openplate-inference
podman volume rm systemd-inference-models
```

## CPU, and which runtimes can run this

The default profile is `lite` (LFM2.5-VL-1.6B, 1.96 GiB of weights), and it runs on a CPU, slowly. The test run below was on a CPU-only host. If you switch the profile or the runtime, read the [support matrix](https://github.com/LowCarbCheck/openplate/blob/main/apps/inference/docs/runtimes.md#support-matrix) first. The compose docs say it in one line, and it holds here too: if you have llama.cpp, Ollama, or vLLM-on-GPU up today, set `MODEL_PROFILE=external` and `MODEL_RUNTIME_URL`. openplate-inference then downloads nothing and starts no second model, and just wraps what you have. Check the support matrix first; vLLM's **CPU** build cannot run this. The matrix records vLLM's CPU build as broken, not slow: a `json_schema` request kills the server, so it looks healthy until the first real scan takes the process down.

**Health.** The image bakes in a `HEALTHCHECK` with a 60 minute start period, sized for the first-boot weight download. Podman drops that check when it pulls the image, because GHCR serves an OCI manifest, which has no health field. Because of this, `podman ps` shows no health column for `systemd-inference`, and the generator deliberately sets no `Notify=healthy` on it, or the unit would wait for the whole download. Ask the service itself instead: `GET /readyz` on the published port answers 200 with `{"status":"ready", ...}` once the model is loaded, and 503 before that. During the first-boot download, nothing answers on the port at all, and curl reports `000`. That means it is still downloading, not broken. `podman logs systemd-inference` shows the progress. `/healthz` is liveness only, and `/health` does not exist (404).

**API key.** `API_KEYS` accepts a comma-separated list. To add a key for a second client, append it to the same line in `inference.env`.

## SELinux and rootless notes

**SELinux labels.** This host runs SELinux enforcing. Every mount here is a named volume (`inference-models.volume`), and Podman labels a named volume for container access when it creates it, so nothing needed a `:Z`. That changes the moment you point a mount at a host directory instead: a bind mount on an enforcing host needs `:Z` (one container uses it) or `:z` (several do), for example `Volume=/srv/pg-data:/var/lib/postgresql:Z`, or the container gets `Permission denied` on its own data directory.

**Rootless ports.** The units publish 8300, all above 1024, so no extra privilege is needed. A rootless container cannot bind a host port below 1024 unless you allow it, for example `sudo sysctl net.ipv4.ip_unprivileged_port_start=80`. If a port is taken on your host, change `PublishPort=` in your installed copy of the unit. The copy under `~/.config/containers/systemd/` is yours to edit; the copy in this repository is generated. A drop-in file cannot replace a port: `PublishPort=` in a `<unit>.container.d/*.conf` adds a second mapping next to the first.

**Container and volume names.** Quadlet names each container `systemd-<unit>`, so `podman ps` shows `systemd-inference`, and a named volume from a `.volume` unit becomes `systemd-<name>`. Inside the network every container also answers to its compose service name (`inference`), because the generator sets that name as a network alias. That alias lets another container on the network call `http://inference:8300`.

## Tested on

### Fedora, Podman 5.8.4

- Date: 2026-09-14
- Host: Fedora (Bluefin), kernel `7.0.11-200.fc44.x86_64`, SELinux `Enforcing`, no GPU, 16 cores, 60 GiB RAM
- Podman 5.8.4, rootless, as an ordinary user; podlet 0.3.2 generated the units
- Linger was already on for the user (`loginctl show-user $USER -p Linger` printed `Linger=yes`)
- Images: `ghcr.io/lowcarbcheck/openplate:latest` (400 MB), `ghcr.io/lowcarbcheck/openplate-core:latest` (189 MB, serviceVersion 0.15.0), `ghcr.io/lowcarbcheck/openplate-inference:latest` (1.01 GB), the Postgres 17 Alpine image (300 MB; the files ran 17 on that date)

What was run, from a throwaway copy of the unit files under `~/.config/containers/systemd/`, with an empty weights volume:

```sh
systemctl --user daemon-reload
systemctl --user start inference.service     # returned in under a second: no Notify=healthy on this unit
systemctl --user is-active inference.service # active
podman ps --filter name=systemd-inference    # systemd-inference  Up 20 seconds  0.0.0.0:8300->8300/tcp
podman logs systemd-inference
#   openplate-inference: weights for MODEL_PROFILE=lite  destination: /models  total: 1.96 GiB
#   [model] downloading LFM2.5-VL-1.6B-Q8_0.gguf (1.16 GiB) ...
#   [mmproj] downloading mmproj-LFM2.5-VL-1.6b-F16.gguf (814 MiB) ...
#   llama_server: model loaded
curl -s http://127.0.0.1:8300/readyz   # {"status":"ready","modelRuntimeReady":true,"embeddingReady":null,...}  200
curl -s -H 'Authorization: Bearer opk_CHANGE_ME' http://127.0.0.1:8300/v1/models   # {"data":[{"id":"openplate-plate-1",...}]}  200
```

Timing: container start to `model loaded` took 5 minutes 14 seconds (download of 1.96 GiB, sha256 verification, load into RAM), and the volume held 2.0 GiB afterwards. `/readyz` answered 200 from then on. `podman ps` shows no health column for this container because Podman drops the image's baked-in `HEALTHCHECK` on pull (OCI manifest); `/readyz` is the proof. `/health` is not an endpoint here (404), `/healthz` is liveness only.

Outcome: started clean, first try. No fix came out of this scenario; the generator fixes from the openplate sync scenario (the network alias, `TimeoutStartSec=300` beside `Notify=healthy`) were already in place and do not change this unit's behaviour.

Afterwards the unit was stopped, the volume and the network removed, the files deleted, `daemon-reload` run again, and `podman ps -a`, `podman volume ls` and `podman network ls` showed nothing from this run.

### Ubuntu 24.04, Podman 4.9.3

- Date: 2026-09-27
- Host: a fresh Ubuntu 24.04.5 LTS VM, 4 vCPUs, 8 GiB RAM, AppArmor, no SELinux, no GPU
- Podman 4.9.3 from the Ubuntu archive, rootless, as an ordinary user

The weights volume already contained the `lite` profile from the openplate app's inference set, run on the same VM that day under the same `systemd-inference-models` name. Because of that, this start skipped the download. The install, the check, and the undo were copied from this README as committed and run word for word:

```sh
grep -c '^Environment=' inference.container   # 0
curl -s http://127.0.0.1:8300/readyz           # {"status":"ready","modelRuntimeReady":true,...} 200
curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer <the key from inference.env>" http://127.0.0.1:8300/v1/models   # 200
curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer opk_CHANGE_ME" http://127.0.0.1:8300/v1/models                # 401
# the undo: units=0 containers=0 volumes=0 networks=0
```

Outcome: the key in `inference.env` overrode the placeholder in `inference.defaults.env`. The openplate app's inference set on the same VM verified reboot recovery: with linger enabled, the container ran 10 s after boot with no user logged in. Two fixes from those test runs appear in this README. First, linger is enabled on the first line of the install, because an ssh logout without it stopped the container and restarted the download. Second, the undo stops the network and volume units. The old undo left the app's inference set with its network unit in state `active (exited)` without a network, which broke the next install in the full set.
