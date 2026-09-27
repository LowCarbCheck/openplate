# openplate, full stack, as rootless Quadlet units

Generated from `docker/topologies/compose.full.yml`, rung 4: Postgres, openplate-inference, the openplate app, and openplate-core (the sync service). Do not edit the unit files. Change the compose file and run `scripts/quadlet.sh generate`. This README is the one hand-written file here.

## What is in this directory

- `postgres.container`: `docker.io/library/postgres:17-alpine` on `pg-data.volume`, `pg_isready` healthcheck as `Notify=healthy`. Not published.
- `inference.container`: `ghcr.io/lowcarbcheck/openplate-inference:latest`, `MODEL_PROFILE=lite`, published on 8300, weights on `inference-models.volume`.
- `app.container`: the app, published on 3000, `Requires=` the inference unit, compose healthcheck as `Notify=healthy`.
- `sync.container`: openplate-core, published on 3001, `Requires=` Postgres, healthcheck against `/health` as `Notify=healthy`.
- `pg-data.volume` and `inference-models.volume`: named volumes, `systemd-pg-data` and `systemd-inference-models` on the host.
- `openplate-full.network`: the private network all four join.
- `README.md`: this file.

## The .env file

`sync.container` sets `EnvironmentFile=openplate-full.env`. Quadlet resolves this path against the unit directory. Place the file beside the units. The unit will not start without it. One key is required:

- `SERVER_SECRET`: `openssl rand -hex 32`. Back it up with the database.

A variable whose compose default is empty gets no line in the units, so you set it in the env file: `ADMIN_TOKEN`, the mail block, the AI proxy and the member-invite limits. The install below puts `ADMIN_TOKEN` there, because the first account needs it. A variable with a non-empty default is written into the units as `Environment=`, and **an `Environment=` line beats the env file**. `API_KEYS` on the inference unit and `DEFAULT_INFERENCE_API_KEY` on the app unit must match; the install below replaces the placeholder in both. On Podman 5 you can change any other value with a drop-in; Podman 4.9 (Ubuntu 24.04) reads no drop-in directory, so there you edit your installed units. The values people change: `APP_URL`, `SYNC_SERVER_URL` and `DEFAULT_INFERENCE_BASE_URL` in `app.container`, `CLIENT_BASE_URL` and `SERVER_PUBLIC_URL` in `sync.container`, and `TRUST_PROXY` in both. Do not set `SIGNUP_MODE`. openplate-core rejects it at boot.

## Install

Place the unit files in `~/.config/containers/systemd/`, together in one directory. Podman's systemd generator turns them into services on the next `daemon-reload`. There is no `systemctl --user enable` step. If you run it, it prints, for example, `Failed to enable unit: Unit /run/user/1000/systemd/generator/app.service is transient or generated.` That is expected, and it does not mean Quadlet failed: the service exists and starts. Start at boot comes from the `[Install] WantedBy=default.target` line in every unit together with linger (below), not from `enable`.

**Pick one path.** These units and a compose stack (with or without a systemd unit of your own that runs it) are alternatives. Run both and they fight over the same ports after every reboot. Stop and remove the other one first.

```sh
mkdir -p ~/.config/containers/systemd/openplate-full
cp docker/quadlet/full/* ~/.config/containers/systemd/openplate-full/
printf 'SERVER_SECRET=%s\nADMIN_TOKEN=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > ~/.config/containers/systemd/openplate-full/openplate-full.env
chmod 600 ~/.config/containers/systemd/openplate-full/openplate-full.env
KEY="opk_$(openssl rand -hex 24)"
sed -i "s/opk_CHANGE_ME/$KEY/" ~/.config/containers/systemd/openplate-full/*.container
systemctl --user daemon-reload
systemctl --user start app.service sync.service
```

**On Podman 4.9 (Ubuntu 24.04)** `Notify=healthy` needs Podman 5.0 or newer, and 4.9 ignores it. `systemctl --user start` then returns about a second after the container starts, before the app answers. Wait for the healthcheck yourself:

```sh
until [ "$(podman inspect --format '{{.State.Health.Status}}' systemd-sync)" = healthy ]; do sleep 5; done
```

The first account: mint an invitation to yourself as [self-hosting.md](../../../docs/self-hosting.md#create-the-first-account) shows, with the token from `openplate-full.env`.

Check it:

```sh
systemctl --user is-active postgres.service inference.service app.service sync.service
podman ps --filter name=systemd-
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
curl -s http://127.0.0.1:3001/health
curl -s http://127.0.0.1:8300/readyz
```

**Linger.** A `systemctl --user` service stops when your session closes. It will not start at boot unless the user's systemd manager runs at boot. Enable linger once:

```sh
loginctl enable-linger "$USER"
```

**Update.** Pull the new images, then restart the matching units:

```sh
podman pull ghcr.io/lowcarbcheck/openplate:latest ghcr.io/lowcarbcheck/openplate-core:latest ghcr.io/lowcarbcheck/openplate-inference:latest
systemctl --user restart app.service sync.service inference.service
```

**Stop and remove.** This is the whole undo. Stopping `app` and `sync` leaves Postgres and inference running, so name all four. The last line deletes every account and diary, and the downloaded weights:

```sh
systemctl --user stop app.service sync.service postgres.service inference.service
rm -rf ~/.config/containers/systemd/openplate-full
systemctl --user daemon-reload
podman network rm systemd-openplate-full
podman volume rm systemd-pg-data systemd-inference-models
```

## CPU, and which runtimes can run this

The default profile is `lite` (LFM2.5-VL-1.6B, 1.96 GiB of weights). It runs on CPU, slowly. The test run below ran on a CPU-only host. If you switch the profile or the runtime, read the [support matrix](https://github.com/LowCarbCheck/openplate-inference/blob/main/docs/runtimes.md#support-matrix) first. If you already run llama.cpp, Ollama, or vLLM on a GPU, set `MODEL_PROFILE=external` and `MODEL_RUNTIME_URL`. openplate-inference then downloads no files, starts no second model, and forwards requests to your existing runtime. Check the support matrix first; vLLM's **CPU** build cannot run this. The matrix records the vLLM CPU build as broken, not slow. A `json_schema` request crashes the server. It reports healthy until the first scan kills the process.

**Health.** The image defines a `HEALTHCHECK` with a 60 minute start period for downloading weights. Podman drops that check during pull because GHCR serves an OCI manifest without health fields. `podman ps` shows no health column for `systemd-inference`. The generator sets no `Notify=healthy` on it, so systemd does not wait on the initial download. Query the service directly instead. A `GET /readyz` request to the published port returns 200 with `{"status":"ready", ...}` once the model loads, and returns 503 before that. `/healthz` checks liveness only, and `/health` does not exist (404).

**API key.** The compose default provides `API_KEYS=opk_CHANGE_ME`, and the install above replaces it in both units. On Podman 5 a drop-in file does the same without touching the units:

```sh
mkdir -p ~/.config/containers/systemd/openplate-full/inference.container.d
printf '[Container]\nEnvironment=API_KEYS=%s\n' "$(openssl rand -base64 24)" > ~/.config/containers/systemd/openplate-full/inference.container.d/keys.conf
systemctl --user daemon-reload && systemctl --user restart inference.service
```

A subsequent `Environment=` line for the same variable overrides the earlier entry. The generator dry run on this host confirmed that behavior.

## SELinux and rootless notes

**SELinux labels.** This host runs SELinux in enforcing mode. Every mount here uses a named volume (`pg-data.volume`, `inference-models.volume`). Podman labels named volumes on creation, so no `:Z` flag was needed. Host directory mounts behave differently. A bind mount on an enforcing host requires `:Z` for a dedicated container or `:z` for shared access, such as `Volume=/srv/pg-data:/var/lib/postgresql/data:Z`. Without that flag, the container receives `Permission denied` on its data directory.

**Rootless Postgres.** The Postgres image runs as an unprivileged user inside the container and runs `chown` on its data directory on first boot. Named volumes handle this cleanly. Podman maps the container user into your subordinate UID range and sets volume permissions automatically. Bind mounts require manual host-side ownership changes before start. Run `podman unshare chown -R 70:70 ./pg-data` for the alpine image. The alpine image uses UID 70 for `postgres`, while the Debian image uses 999. Without this step, the container exits with a permissions error.

**Rootless ports.** The units publish ports 3000, 3001, and 8300. All three sit above 1024, so they require no elevated privileges. Rootless containers cannot bind host ports below 1024 by default. Lowering that limit requires `sudo sysctl net.ipv4.ip_unprivileged_port_start=80`. If a port conflicts on your host, edit `PublishPort=` in your copy under `~/.config/containers/systemd/`. Drop-in files cannot override ports. Adding `PublishPort=` in `<unit>.container.d/*.conf` adds a second port mapping next to the first.

**Container and volume names.** Quadlet names each container `systemd-<unit>`, so `podman ps` lists `systemd-postgres`. Named volumes from `.volume` units become `systemd-<name>`. Containers also resolve each other across the network by their compose names (`postgres, inference, app, sync`) through network aliases added by the generator. Connection strings such as `DATABASE_URL` rely on these aliases.

## Tested on

- Date: 2026-09-14
- Host: Fedora (Bluefin), kernel `7.0.11-200.fc44.x86_64`, SELinux `Enforcing`, no GPU, 16 cores, 60 GiB RAM
- Podman 5.8.4, rootless, as an ordinary user; podlet 0.3.2 generated the units
- Linger was already on for the user (`loginctl show-user $USER -p Linger` printed `Linger=yes`)
- Images: `ghcr.io/lowcarbcheck/openplate:latest` (400 MB), `ghcr.io/lowcarbcheck/openplate-core:latest` (189 MB, serviceVersion 0.15.0), `ghcr.io/lowcarbcheck/openplate-inference:latest` (1.01 GB), `docker.io/library/postgres:17-alpine` (300 MB)

Ran after the sync and inference tests on the same day, with every fix from the sync README present in the generator and compose files. The weights volume remained from the earlier inference run (same `systemd-inference-models` name), so inference started without downloading files. A fresh host downloads 1.96 GiB first, which took about 5 minutes on this link.

```sh
systemctl --user daemon-reload
systemctl --user start app.service sync.service      # returned after 38 s; Requires= pulled postgres and inference in
systemctl --user is-active postgres.service inference.service app.service sync.service   # active, four times
podman ps --filter name=systemd-
#   systemd-inference  Up 38 seconds            0.0.0.0:8300->8300/tcp
#   systemd-postgres   Up 37 seconds (healthy)  5432/tcp
#   systemd-app        Up 37 seconds (healthy)  0.0.0.0:3000->3000/tcp
#   systemd-sync       Up 32 seconds (healthy)  0.0.0.0:3001->3000/tcp
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/         # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/health   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8300/readyz   # 200
```

Outcome: clean start on the first try with the updated generator. This run marked the first time `systemd-sync` reported `(healthy)`, because the compose file now declares the `/health` check that Podman drops on pull. `systemd-inference` never displays a health column for the same reason, and the generator sets no `Notify=healthy` because the image specifies a 60 minute start window. The `/readyz` endpoint provides the health check.

After verification, the units were stopped, both volumes and the network removed, unit files deleted, and `daemon-reload` executed. `podman ps -a`, `podman volume ls`, and `podman network ls` returned no remaining artifacts from the run.

These units were not run on Podman 4.9. The app and sync sets were (see their READMEs), and what they found applies here too: `Notify=healthy` is ignored, drop-ins are not read, and an `Environment=` line beats the env file. Only a non-empty default gets such a line; the generator drops empty ones.
