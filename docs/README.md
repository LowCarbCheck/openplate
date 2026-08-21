# openplate documentation

openplate is a plate tracker: log what you eat, and optionally photograph it and let an AI
model estimate the macros. It is four separate programs, and **you run only the ones you
need**. The app is the product — it works alone, with no account, no database and no server
secret, because your diary lives in your browser's own IndexedDB.
[openplate-sync](https://github.com/LowCarbCheck/openplate-sync) adds an account so a diary
can move between your devices, encrypted so the service cannot read it.
[openplate-inference](https://github.com/LowCarbCheck/openplate-inference) adds a
photo-to-macros endpoint on your own hardware, so no cloud AI provider is involved at all.
[openplate-gateway](https://github.com/LowCarbCheck/openplate-gateway) shares one AI key
across a household, with a token and a quota per person — the one most people can skip
outright, because a provider that issues capped sub-keys does the same job with no server.
Most people run the app and nothing else.

## The map

| Document | What is in it |
| --- | --- |
| [topologies.md](topologies.md) | **Start here.** What should I actually run? Five rungs and one variant, from "nothing" to "everything", with the compose file for each. |
| [self-hosting.md](self-hosting.md) | Running it: compose walkthroughs, first run, HTTPS, backups, upgrading. |
| [configuration.md](configuration.md) | Every environment variable, the Content-Security-Policy, custom and instance-provided AI endpoints, the OpenRouter flow. |
| [sync.md](sync.md) | Turning on sync across devices, and what the encryption does and does not hide. |
| [family-setup.md](family-setup.md) | Sharing one AI bill across a household, with a per-person spend limit and per-person revocation. Provider sub-keys first; openplate-gateway when your provider has none. |
| [architecture.md](architecture.md) | The layer picture: which component holds what, and which one is in the path of your photo. |

Decisions that constrain the code live in [`.adr/`](../.adr/). Start with
[ADR-0006](../.adr/0006-the-app-server-holds-no-accounts.md) — why this server has no
accounts.

## The other three repos

Each service documents its own operation. Read those before you run it, not this page.

- **openplate-sync** — [README](https://github.com/LowCarbCheck/openplate-sync#readme) for
  running it, [PROTOCOL.md](https://github.com/LowCarbCheck/openplate-sync/blob/main/PROTOCOL.md)
  for the normative wire format and an honest list of the metadata the server does learn.
- **openplate-inference** — [README](https://github.com/LowCarbCheck/openplate-inference#readme)
  for the quickstart,
  [docs/hardware.md](https://github.com/LowCarbCheck/openplate-inference/blob/main/docs/hardware.md)
  for whether your box can run it,
  [docs/runtimes.md](https://github.com/LowCarbCheck/openplate-inference/blob/main/docs/runtimes.md)
  for pointing it at an Ollama, vLLM or llama.cpp you already run, and
  [docs/configuration.md](https://github.com/LowCarbCheck/openplate-inference/blob/main/docs/configuration.md)
  for its environment variables.
- **openplate-gateway** — [README](https://github.com/LowCarbCheck/openplate-gateway#readme),
  whose first section is an honest argument for not running it, then the quickstart and the
  three topologies, and
  [ADR-0001](https://github.com/LowCarbCheck/openplate-gateway/blob/main/docs/adr/0001-a-separate-gateway-service.md)
  for why tenancy is a separate service from compute and from sync.

## Working on openplate itself

Every repo in the family ships a dev-shell flake, so `nix develop` in any of them opens
a shell with Node 22 and pnpm already on the path ([`flake.nix`](../flake.nix)). If you would
rather not use Nix, install Node ≥ 22 and pnpm yourself; there is no database to provision and
no service to start alongside the app. The commands are in the
[README](../README.md#development).
