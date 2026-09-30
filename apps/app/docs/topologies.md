# What should I run?

Four rungs. Each one adds a capability and adds something you now have to operate. Start at
the bottom and stop as soon as you have what you need: most people stop at rung 0 or 1.

| Rung | You get | You operate | Compose file |
| --- | --- | --- | --- |
| 0 | Plate tracking + AI scans | Nothing | none |
| 1 | The same, on your own box | One stateless container | `docker/compose.yml` |
| 2 | Your diary on two devices, and, on a managed instance, a shared AI bill for a household or org | + a database and one secret | `docker/topologies/compose.sync.yml` |
| 3 | Scans on your own hardware | + a model runtime | `docker/topologies/compose.inference.yml` |
| 4 | All of it | All of it | `docker/topologies/compose.full.yml` |

Every compose file is annotated line by line;
[`docker/topologies/README.md`](../../../docker/topologies/README.md) is the same map from the
compose side.

At every rung, the app server also looks food names up at the LowCarbCheck food database for
the people using it. It sends names, never a photo or a diary entry. From rung 1 up that is
your server doing it: if more than one person scans, give it a free key. See
[architecture.md](architecture.md#the-food-database-is-a-lookup-by-name-through-the-app-server).

Every command below also runs under [Podman](https://podman.io) as
`podman compose`. On Ubuntu, that subcommand needs the `podman-compose` package
installed beside it. See [podman.md](podman.md).

---

## Rung 0: run nothing

Open an existing instance, such as <https://openplate.lowcarbcheck.org>, and paste your own
provider key into **Settings → AI**. There is no sign-up. Your diary lives in that browser's
storage and never reaches the instance's server, so "using someone else's instance" gives
that operator far less than the phrase suggests: see [architecture.md](architecture.md). The
names of the foods you scan or search do pass through it, on their way to the food database.

Nothing on this rung is yours to run. The browser holds the diary, the browser calls the
provider with the key you pasted into it, and the operator's server only sends the page.

```mermaid
%% alt: On rung zero the browser holds the diary and calls a cloud provider directly with your key.
flowchart LR
  host["Someone else's instance"] -->|"HTML and JS"| browser["Your browser"]
  browser --- diary["Diary in this browser"]
  browser -->|"photo and your key"| cloud["Cloud AI provider"]
```

**You gain:** the whole product, in one minute, for the cost of your own AI usage.
**You operate:** nothing.

The honest catch: a public demo instance carries no uptime promise and nothing there is
backed up for you. Your diary is in that browser, and clearing the browser clears it. Take
the JSON export from **Profile → Your data** regularly, or move to rung 1.

## Rung 1: the app on your own box

```bash
mkdir -p ~/openplate && cd ~/openplate
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/compose.yml
docker compose -f compose.yml up -d
```

```bash
mkdir -p ~/openplate && cd ~/openplate
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/compose.yml
podman compose -f compose.yml up -d
```

> **Open it as `http://localhost:3000` on that machine, or over HTTPS.** From another device,
> `http://<its address>:3000` shows the diary. App installation, offline use and the one-click
> OpenRouter connect do not work there. See [self-hosting.md](self-hosting.md#https).

Rung 1 changes one box. The page comes from a container you run, and the photo path is
exactly the one above.

```mermaid
%% alt: On rung one the page comes from your own stateless container, and the photo path is unchanged.
flowchart LR
  app["openplate app, your box"] -->|"HTML and JS"| browser["Your browser"]
  browser --- diary["Diary in this browser"]
  browser -->|"photo and your key"| cloud["Cloud AI provider"]
```

**You gain:** the app on hardware you control, upgradeable on your schedule, with no
dependence on anyone else's instance.
**You operate:** one container. No database, no `.env` step, no secret to generate, nothing
to migrate on upgrade. If it dies, nothing is lost, because it stores nothing.
**Compose file:** [`docker/compose.yml`](../../../docker/compose.yml).

This is the recommended stopping point. Everything below adds real operational work.

The full walkthrough is in [self-hosting.md](self-hosting.md). It covers HTTPS, which you need for PWA install, the one-click OpenRouter connect, and signing in from rung 2 up.

## Rung 2: add sync

**You gain:** one diary across your devices. The honest way to sell this is **one person, two
devices**: a phone and a laptop that stay in agreement. Families are the *second* use, and a
weaker one: sync is per account, so two people sharing one account share one diary rather
than getting one each. Two people who want separate diaries want two accounts, or simply two
rung-1 devices and no sync at all.

Rung 2 adds a second server and a database behind it. Each device pushes the same encrypted
blob and pulls the other device's, and the photo still leaves each device for the provider.

```mermaid
%% alt: On rung two both devices push one encrypted blob to the sync server, and the photo still goes straight to the provider.
flowchart LR
  app["openplate app"] -->|"HTML and JS"| phone["Phone"]
  app -->|"HTML and JS"| laptop["Laptop"]
  phone -->|"ciphertext"| sync["openplate-core"]
  laptop -->|"ciphertext"| sync
  sync --> db[("Postgres")]
  phone -->|"photo and your key"| cloud["Cloud AI provider"]
  laptop -->|"photo and your key"| cloud
```

**You operate:** the app, an account service, and a Postgres. That is a real step up: an
account service has a database worth backing up, a `SERVER_SECRET` worth keeping, and users
who can lock themselves out. Read
[openplate-core's README](https://github.com/LowCarbCheck/openplate/tree/main/apps/core#readme) before you
put it on the public internet.
**Compose file:** [`docker/topologies/compose.sync.yml`](../../../docker/topologies/compose.sync.yml).

```bash
mkdir -p ~/openplate && cd ~/openplate
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/topologies/compose.sync.yml
echo "SERVER_SECRET=$(openssl rand -hex 32)" >> .env
echo "ADMIN_TOKEN=$(openssl rand -hex 32)" >> .env
echo "PUBLIC_APP_URL=https://openplate.example.com"  >> .env
echo "PUBLIC_SYNC_URL=https://sync.example.com"      >> .env
docker compose -f compose.sync.yml up -d
```

```bash
mkdir -p ~/openplate && cd ~/openplate
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/topologies/compose.sync.yml
echo "SERVER_SECRET=$(openssl rand -hex 32)" >> .env
echo "ADMIN_TOKEN=$(openssl rand -hex 32)" >> .env
echo "PUBLIC_APP_URL=https://openplate.example.com"  >> .env
echo "PUBLIC_SYNC_URL=https://sync.example.com"      >> .env
podman compose -f compose.sync.yml up -d
```

> **Accounts need a secure page.** Signing in, signing up, and opening an invitation fail on
> plain `http://<LAN address>`. Use HTTPS, with a domain name or on a home network without one,
> or `localhost` through an ssh tunnel for a test.
> Nobody signs up on their own. You mint the first invitation on the server with
> `ADMIN_TOKEN`. Both are in [self-hosting.md](self-hosting.md#create-the-first-account) and
> [self-hosting.md](self-hosting.md#https).

The service stores each entry as ciphertext and never receives your password. It does hold
each account's recovery code, sealed under a secret of its own, so a forgotten password is
reset by a link (mailed, or handed out by you on an instance with no mail) and the diary
comes back. That also means the operator of the service
can, in principle, open a diary on it. [sync.md](sync.md) states that trade-off in full, and
so does the app before you finish setting sync up.

**The same server also carries a shared AI bill, if you turn it on.** Set
`INSTANCE_MODE=managed` and the instance becomes one an administrator runs for a household or
an organization: they invite people by email from `/admin` (or with the admin API), give each
account a daily allowance, and every signed-in scan runs through the sync server's own AI
proxy: no separate service, no separate invite link. See
[configuration.md#managed-instances](configuration.md#managed-instances) and
[family-setup.md](family-setup.md) for when this is worth turning on instead of provider
sub-keys.

On a managed instance that same server also carries the scan. A signed-in member posts the
photo to the AI proxy, the server counts it against that account's daily allowance, and it
forwards the request to whatever the operator pointed it at.

```mermaid
%% alt: On a managed instance the signed-in member scans through the sync server's AI proxy, which counts the request against a daily allowance.
flowchart LR
  browser["Member's browser"] -->|"ciphertext"| sync["openplate-core, managed"]
  browser -->|"photo"| sync
  sync --- quota["Daily allowance per account"]
  sync -->|"photo"| upstream["Cloud provider, or inference"]
```

**Let members invite each other, but keep the number small.** On a managed instance, set
`MEMBER_INVITE_DAILY_AI_LIMIT` and `MEMBER_INVITE_ALLOWANCE_DAYS` on the sync server. This lets
an ordinary member invite somebody without asking you first. If you pay for the provider key, set
`MEMBER_INVITE_LIFETIME_CAP=2` as well. The default is 5, which suits an instance where the AI
bill is shared. Setting it to 2 is enough for a partner and a friend, and it keeps growth slow
enough to watch. See [configuration.md#member-invites](configuration.md#member-invites).

## Rung 3: add self-hosted inference

Rung 3 runs the scan on your hardware. The browser sends photos directly to the inference container. Your browsers must resolve that container's address. The model identifies each food and estimates weight in grams. openplate-inference reads macros from your configured food source.

```mermaid
%% alt: On rung three the browser sends the photo to your own inference container, which looks the macros up in its configured food source.
flowchart LR
  app["openplate app"] -->|"HTML and JS"| browser["Your browser"]
  browser --- diary["Diary in this browser"]
  browser -->|"photo, browser reachable address"| inf["openplate-inference"]
  inf --- weights["Model runtime and weights"]
  inf --- usda["Configured food data, USDA by default"]
```

**You gain:** local plate scans without a cloud AI account, per-scan fees, or outbound photo traffic. The container image bundles a USDA FoodData Central extract by default, so openplate-inference looks macros up instead of inventing them.
**You operate:** a model runtime and a few gigabytes of weights, plus whatever it takes to
make the endpoint reachable **from your browsers** (the photo goes device → endpoint, so a
compose hostname does not work here).
**Compose file:** [`docker/topologies/compose.inference.yml`](../../../docker/topologies/compose.inference.yml).

```bash
mkdir -p ~/openplate && cd ~/openplate
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/topologies/compose.inference.yml
echo "INFERENCE_API_KEY=opk_$(openssl rand -hex 24)" >> .env
echo "PUBLIC_APP_URL=http://192.168.1.20:3000" >> .env
echo "PUBLIC_INFERENCE_URL=http://192.168.1.20:8300/v1" >> .env
docker compose -f compose.inference.yml up -d
```

Replace `192.168.1.20` with your server's address. Once the app is on HTTPS, the inference
address must be `https://` too. [self-hosting.md](self-hosting.md#the-app-plus-self-hosted-inference)
walks through it. Podman runs this the same way: `podman compose -f compose.inference.yml up -d`.

This rung is for two kinds of people:

- **You own the hardware.** A GPU box, or a reasonably strong CPU one.
- **You already run a model runtime.** If you have llama.cpp, Ollama, or vLLM-on-GPU up
  today, set `MODEL_PROFILE=external` and `MODEL_RUNTIME_URL`: openplate-inference then
  downloads nothing and starts no second model, and just wraps what you have. Check the
  [support matrix](https://github.com/LowCarbCheck/openplate/blob/main/apps/inference/docs/runtimes.md#support-matrix)
  first; vLLM's **CPU** build cannot run this.

**Hardware honesty.** The small `lite` profile is 2.0 GiB of weights and wants **8+ modern
cores with AVX2 and 4 GB of free RAM** on a CPU-only box; the larger `quality` profile is
5.8 GiB of weights and a 5.8 GiB VRAM floor. CPU scans take seconds to minutes, and
throughput does not improve with concurrency: plan capacity as if the box were serial. The
measured numbers, per profile, are in
[openplate-inference's docs/hardware.md](https://github.com/LowCarbCheck/openplate/blob/main/apps/inference/docs/hardware.md).
Read it before you buy anything.

Once it is running, you can either hand each person a key (**Settings → AI →
OpenAI-compatible**) or set `DEFAULT_INFERENCE_BASE_URL` and friends so every visitor gets a
one-tap connect, with the caveat that `DEFAULT_INFERENCE_API_KEY` is embedded in the page
and readable by anyone who can open the app. See
[configuration.md](configuration.md#instance-provided-ai).

### The sync server and inference are different layers

They are easy to confuse and they compose.

- **openplate-inference is the compute layer.** It answers the question *what is on this
  plate*. It carries a model runtime and weights, and it wants hardware.
- **openplate-core, on a managed instance, is the tenancy layer.** It answers *who is allowed
  to spend, how much, and how do I take it away*. It carries no model and forwards everything.

Point a managed instance's AI proxy at your inference box (openplate-core's
`UPSTREAM_BASE_URL`, with one of the inference service's `API_KEYS` as `UPSTREAM_API_KEY`) and you get both: scans on your own hardware, with per-account
allowances in front of them. Point it at a cloud provider instead and you get shared spend
with no hardware. Either way, the same sync server also carries the diary: sync and the AI
proxy are one service now, not two ([architecture.md](architecture.md)).

## Rung 4: everything

Rung 4 is the two rungs above, drawn together. Nothing new appears on it.

```mermaid
%% alt: Rung four is rungs two and three together, one diary on every device and scans on your own hardware.
flowchart LR
  app["openplate app"] -->|"HTML and JS"| phone["Phone"]
  app -->|"HTML and JS"| laptop["Laptop"]
  phone -->|"ciphertext"| sync["openplate-core"]
  laptop -->|"ciphertext"| sync
  sync --> db[("Postgres")]
  phone -->|"photo"| inf["openplate-inference"]
  laptop -->|"photo"| inf
```

**You gain:** rung 2 and rung 3 together (your diary on every device, scanned on your own
hardware, with nothing going to any third party).
**You operate:** all of it. App, sync service, Postgres, model runtime, and browser-reachable
addresses for two of them.
**Compose file:** [`docker/topologies/compose.full.yml`](../../../docker/topologies/compose.full.yml).
Its header lists the `.env` lines: those of rung 2 and rung 3 together.

Podman runs this the same way: `podman compose -f compose.full.yml up -d`.

There is nothing new to learn at this rung. It is the union of the two above, with the same
`SERVER_SECRET`, the same backup obligation, and the same hardware floor.

---

## Sharing a bill instead of a server

If your reason for climbing this ladder was "my household needs more than one AI key", the
first answer is not a rung at all. It is solved at the provider, with per-person keys and
per-person spend limits, and it needs no extra software.
[family-setup.md](family-setup.md) has the steps, and, when your provider will not issue
capped sub-keys, a managed sync server as the fallback (rung 2, with `INSTANCE_MODE=managed`).
