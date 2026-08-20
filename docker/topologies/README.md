# Self-hosting shapes

openplate is one required container and two optional services. Pick the
smallest shape that does what you want — every extra service is one more thing
you back up, upgrade and debug.

| # | Shape | File | What you gain | What you now operate |
|---|-------|------|---------------|----------------------|
| 0 | Nothing to run | — | Use the hosted instance (or anyone's) and connect your own AI provider key in Settings → AI. Your diary stays in your browser either way. | Nothing. Someone else's uptime, and a provider bill on your own key. |
| 1 | App only | [`../compose.yml`](../compose.yml) | The whole tracker, self-hosted. No database, no secret, no `.env` step. Users still bring their own AI key. | One stateless container. Nothing to back up on the server — diaries live on each device. |
| 2 | App + sync | [`compose.sync.yml`](compose.sync.yml) | End-to-end-encrypted sync between a person's devices, and accounts to hang it on. The server cannot read the entries. | Three containers, a Postgres, `SERVER_SECRET` (back it up *with* the database), and optionally SMTP. |
| 3 | App + inference | [`compose.inference.yml`](compose.inference.yml) | A one-tap AI for everyone on the instance: no provider account, no per-user key, and plate photos never leave your network. | Two containers, a few GiB of model weights, and the hardware to run them. The instance API key is public in the page HTML. |
| 4 | Everything | [`compose.full.yml`](compose.full.yml) | Shapes 2 and 3 together. | Four containers: all of the above at once. |

Diaries are per-device in every shape. Shape 2 is what moves one between
devices; the in-app JSON export is what moves it anywhere else.

Each file's header comments carry the setup steps and the values you must edit.
Read the file you picked before running it.
