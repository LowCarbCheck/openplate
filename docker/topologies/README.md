# Self-hosting shapes

openplate needs one container and offers two optional services. Pick the
smallest shape that fits your needs. Every added service is one more thing
you back up, upgrade, and debug. [docs/topologies.md](../../apps/app/docs/topologies.md)
explains the same four shapes in more detail, as rungs 1 to 4.

| # | Shape | File | What you gain | What you now operate |
|---|-------|------|---------------|----------------------|
| 0 | Nothing to run | none | Use the hosted instance, or any public instance, and connect your own AI provider key in Settings → AI. Your diary stays in your browser either way. | Nothing. Someone else handles uptime, and you pay your provider bill directly. |
| 1 | App only | [`../compose.yml`](../compose.yml) | The whole tracker, self-hosted. You need no database, no secret, and no `.env` step. Users still bring their own AI key. | One stateless container. Nothing to back up on the server. Diaries live on each device. |
| 2 | App + sync | [`compose.sync.yml`](compose.sync.yml) | End-to-end-encrypted sync between a person's devices, and accounts to hold it. An account is an email address and a password, created from an invitation. | Three containers, Postgres, `SERVER_SECRET` (back it up with the database), and `ADMIN_TOKEN`. The service keeps each account's recovery code sealed. A password reset brings the diary back, and its operator could open a diary. Mail is optional. Without it, you pass invitation and reset links yourself. |
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
