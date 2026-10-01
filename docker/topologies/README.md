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
docker compose -f compose.core.yml down --remove-orphans   # your old file, never add -v
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

For one release `compose.core.yml` stays in this folder as a stub that includes
`compose.core.yml`, so `docker compose -f compose.core.yml up -d` still starts
the same stack. Fetch both files if you want that to keep working. The stub goes
away in a later release. If you start from the stub while the old `sync`
container still runs, Compose warns about an orphan container. Run
`docker compose -f compose.core.yml down --remove-orphans` once and start again.

If you wrote your own commands against the service name, such as
`docker compose logs sync` or `exec sync`, change `sync` to `core`. If you run
the shapes as Quadlet units, the commands that move an install across are in
[`../quadlet/core/README.md`](../quadlet/core/README.md).
