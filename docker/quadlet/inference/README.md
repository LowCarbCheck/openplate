# openplate with inference as rootless Quadlet units

Generated from `docker/topologies/compose.inference.yml`, rung 3: openplate-inference and the openplate app. Do not edit the unit files directly. Change the compose file and run `scripts/quadlet.sh generate`. This README is the one hand-written file here.

## What is in this directory

- `inference.container`: `ghcr.io/lowcarbcheck/openplate-inference:latest`, `MODEL_PROFILE=lite`, published on 8300, weights on the volume below.
- `openplate.container`: the app, `ghcr.io/lowcarbcheck/openplate:latest`, published on 3000, `Requires=` and `After=` the inference unit, with the compose healthcheck as `Notify=healthy`. `DEFAULT_INFERENCE_BASE_URL` points at `http://openplate.example.lan:8300/v1`: the browser calls the inference endpoint directly, so replace that host with an address your browsers resolve (a drop-in with `Environment=DEFAULT_INFERENCE_BASE_URL=...` and `Environment=APP_URL=...` does it).
- `inference-models.volume`: the weights; Podman names it `systemd-inference-models`. About 2 GiB after the first boot.
- `openplate-with-inference.network`: the private network both join.
- `README.md`: this file.

## The .env file

None. Every value has a compose default, written into the units as `Environment=`. You will change two values: `API_KEYS` on the inference unit and `DEFAULT_INFERENCE_API_KEY` on the app unit. These must match. Use a drop-in for each, as shown below.

## Install

The unit files go to `~/.config/containers/systemd/`, together in one directory. Podman's systemd generator turns them into services on the next `daemon-reload`. There is no `systemctl --user enable` step. Every unit carries `WantedBy=default.target`, and the generator wires that up for you. A `systemctl --user enable` command on a generated unit fails, and that is expected.

```sh
mkdir -p ~/.config/containers/systemd/openplate-inference
cp docker/quadlet/inference/* ~/.config/containers/systemd/openplate-inference/
systemctl --user daemon-reload
systemctl --user start openplate.service
```

Check it:

```sh
systemctl --user is-active inference.service openplate.service
podman ps --filter name=systemd-
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
curl -s http://127.0.0.1:8300/readyz
```

**Linger.** A `systemctl --user` service stops when your last session ends. It does not start at boot unless the user's systemd instance starts at boot. Turn that on once:

```sh
loginctl enable-linger "$USER"
```

**Update.** Pull the new image, then restart the unit that runs it:

```sh
podman pull ghcr.io/lowcarbcheck/openplate:latest ghcr.io/lowcarbcheck/openplate-inference:latest
systemctl --user restart openplate.service inference.service
```

**Stop and remove.** `systemctl --user stop openplate.service` stops the containers. Remove the unit files and run `systemctl --user daemon-reload` to drop the services. Named volumes stay until you run `podman volume rm` on them. That applies to `systemd-inference-models` here. Removing it means downloading the weights again.

## CPU, and which runtimes can run this

The default profile is `lite` (LFM2.5-VL-1.6B, 1.96 GiB of weights), and it runs on a CPU, slowly. The test run below was on a CPU-only host. If you switch the profile or the runtime, read the [support matrix](https://github.com/LowCarbCheck/openplate-inference/blob/main/docs/runtimes.md#support-matrix) first. The compose docs state it in one line, and it holds here too: if you have llama.cpp, Ollama, or vLLM-on-GPU running today, set `MODEL_PROFILE=external` and `MODEL_RUNTIME_URL`. openplate-inference then downloads nothing and starts no second model. It wraps what you have. Check the support matrix first; vLLM's **CPU** build cannot run this. The matrix records the CPU build of vLLM as broken, not slow. A `json_schema` request kills the server, so it looks healthy until the first real scan takes the process down.

**Health.** The image bakes in a `HEALTHCHECK` with a 60 minute start period, sized for the first-boot weight download. Podman drops that check when it pulls the image. GHCR serves an OCI manifest, which has no health field. Because of that, `podman ps` shows no health column for `systemd-inference`. The generator deliberately sets no `Notify=healthy` on it, or the unit would wait for the whole download. Query the service directly instead. A `GET /readyz` request on the published port answers 200 with `{"status":"ready", ...}` once the model is loaded, and 503 before that. `/healthz` provides liveness checks only, and `/health` does not exist (404).

**API key.** `API_KEYS=opk_CHANGE_ME` comes from the compose default. Set your own key with a drop-in file, without touching the unit:

```sh
mkdir -p ~/.config/containers/systemd/openplate-inference/inference.container.d
printf '[Container]\nEnvironment=API_KEYS=%s\n' "$(openssl rand -base64 24)" > ~/.config/containers/systemd/openplate-inference/inference.container.d/keys.conf
systemctl --user daemon-reload && systemctl --user restart inference.service
```

A later `Environment=` for the same key replaces the earlier one. This was confirmed on this host with the generator dry run.

## SELinux and rootless notes

**SELinux labels.** This host runs SELinux enforcing. Every mount here is a named volume (`inference-models.volume`), and Podman labels a named volume for container access when creating it, so nothing needed a `:Z`. That changes when you point a mount at a host directory instead. A bind mount on an enforcing host needs `:Z` (one container uses it) or `:z` (several do), for example `Volume=/srv/pg-data:/var/lib/postgresql/data:Z`. Without it, the container gets `Permission denied` on its data directory.

**Rootless ports.** The units publish 3000 and 8300, both above 1024, so no extra privilege is needed. A rootless container cannot bind a host port below 1024 unless you allow it, for example with `sudo sysctl net.ipv4.ip_unprivileged_port_start=80`. If a port is taken on your host, change `PublishPort=` in your installed copy of the unit. The copy under `~/.config/containers/systemd/` is yours to edit; the copy in this repository is generated. A drop-in file cannot replace a port. Setting `PublishPort=` in a `<unit>.container.d/*.conf` file adds a second mapping next to the first.

**Container and volume names.** Quadlet names each container `systemd-<unit>`, so `podman ps` shows `systemd-inference`. A named volume from a `.volume` unit becomes `systemd-<name>`. Inside the network, every container also answers to its compose service name (`inference, openplate`), because the generator sets that name as a network alias. That alias is what `DATABASE_URL` and related settings rely on.

## Tested on

- Date: 2026-09-14
- Host: Fedora (Bluefin), kernel `7.0.11-200.fc44.x86_64`, SELinux `Enforcing`, no GPU, 16 cores, 60 GiB RAM
- Podman 5.8.4, rootless, as an ordinary user; podlet 0.3.2 generated the units
- Linger was already on for the user (`loginctl show-user $USER -p Linger` printed `Linger=yes`)
- Images: `ghcr.io/lowcarbcheck/openplate:latest` (400 MB), `ghcr.io/lowcarbcheck/openplate-core:latest` (189 MB, serviceVersion 0.15.0), `ghcr.io/lowcarbcheck/openplate-inference:latest` (1.01 GB), `docker.io/library/postgres:17-alpine` (300 MB)

The weights volume already held the `lite` profile from the standalone openplate-inference run on the same day (same `.volume` unit, same `systemd-inference-models` name), so this start did not run a download. That run measured the download: 1.96 GiB in two files, downloaded, sha256-verified, and loaded in 5 minutes 14 seconds on this connection. The `/readyz` endpoint answered 200 at that point.

```sh
systemctl --user daemon-reload
systemctl --user start openplate.service         # returned after 32 s; Requires= pulled inference.service in
systemctl --user is-active inference.service openplate.service   # active, active
podman ps --filter name=systemd-
#   systemd-inference  Up 32 seconds            0.0.0.0:8300->8300/tcp
#   systemd-openplate  Up 32 seconds (healthy)  0.0.0.0:3000->3000/tcp
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/   # 200
curl -s http://127.0.0.1:8300/readyz     # {"status":"ready","modelRuntimeReady":true,...}  200, about 5 s after start
podman exec systemd-openplate node -e "fetch('http://inference:8300/readyz').then(r=>console.log(r.status))"   # 200
```

Outcome: started clean. `systemd-inference` shows no health column (see the CPU section: Podman drops the baked-in check), which is why verification uses `/readyz`, not `podman ps`. The last line shows the app container reaching the inference container by its service name over the private network, through the alias the generator sets.

Afterward, the units were stopped, the volume and network were removed, the files were deleted, and `daemon-reload` was run again. `podman ps -a`, `podman volume ls`, and `podman network ls` showed nothing remaining from this run.
