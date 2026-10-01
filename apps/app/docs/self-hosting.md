# Self-hosting

openplate ships as a prebuilt multi-arch Docker image (`linux/amd64` + `linux/arm64`;
Raspberry-Pi-class boxes are a first-class target) published to the GitHub Container Registry.
The `latest` tag is the newest release. Each release also has its own version tag. The `main`
tag follows every change on the main branch. There are no secrets to generate and nothing to
sign up for beyond your own AI provider key.

Nothing here is a reduced edition. Local-first tracking, BYOK AI plate scanning, PWA install,
JSON export/import, the whole interface: identical to the hosted instance, because it is the
same image. The only thing the hosted deployment adds is that we operate the optional sync
service for you, and that is also open source, for you to run yourself.

## What you can run

- **The app on its own.** Adds one container. You gain a fast setup with no database or secrets to manage. You risk losing your diary if you clear the browser, there is no sync across devices, and scans require a cloud AI key.
- **The app plus the sync service.** Adds `openplate-core` and Postgres. You gain encrypted sync across devices and an optional shared AI bill. You risk data loss if you do not back up the database, the secret, and your recovery key.
- **The app plus self-hosted inference.** Adds `openplate-inference`. You gain local plate scans with no cloud account and no photos leaving your network. You risk hardware strain, and every browser must reach the inference container directly.
- **[Everything](#the-app-plus-sync-and-self-hosted-inference).** Sync and inference together, four containers in all. You gain complete data privacy with multi-device sync. You risk the highest operational maintenance and resource load.

Each shape is one compose file under [`docker/topologies/`](../../../docker/topologies/); [topologies.md](topologies.md) explains how to choose.

## Before you start

**Install Docker.** A fresh server does not have it. Follow Docker's guide for your distribution at [docs.docker.com/engine/install](https://docs.docker.com/engine/install/). On Ubuntu 24.04, the distribution packages work too:

```bash
sudo apt-get update
sudo apt install docker.io docker-compose-v2
sudo usermod -aG docker "$USER"   # then log out and back in, to use docker without sudo
```

Podman works as well. Read [podman.md](podman.md) for what differs.

**Pick a folder that lasts.** Every walkthrough below starts with `mkdir -p ~/openplate && cd ~/openplate`. The compose file and its `.env` live there. Run every later command from there, including upgrades, backups, and logs. Do not use `/tmp`. A reboot can empty it, and your `.env` with its secrets will disappear.

> **If you run this for your family, do two things early.**
>
> - **Back up `.env` and the database.** Copy `.env` to a safe place, above all the `SERVER_SECRET` line. Without it, a restored database opens no account. Then dump the database on a schedule. [Backups](#backups) has the commands.
> - **Let other devices reach only the HTTPS port.** Many servers start with no firewall, so every port a container publishes is open to your network. Keep the container ports on `127.0.0.1`, as the [HTTPS](#https) section shows, so that only your reverse proxy reaches them. A firewall such as `ufw` does not close them for you, because Docker publishes its ports past it. `ufw` still closes everything else on the server. Allow SSH first, then HTTPS:
>
>   ```bash
>   sudo ufw allow OpenSSH
>   sudo ufw allow 443/tcp
>   sudo ufw allow 8443/tcp   # the sync service's HTTPS port, in the recipes below
>   sudo ufw enable
>   ```
>
>   With a domain name, Caddy also needs port 80 for its certificate: `sudo ufw allow 80/tcp`.

## The app on its own

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

> **Open it as `http://localhost:3000` on the server itself, or over HTTPS.** From another
> device, `http://<the server's address>:3000` shows the diary. Installing the app,
> offline use and the one-click OpenRouter connect do not work there. See [HTTPS](#https).

Podman runs these files with `podman compose`. On Ubuntu that subcommand needs the `podman-compose` package installed as its provider: see [podman.md](podman.md).

You get one container, no database, no `.env` step, and no secret to generate. The app is reachable at `http://localhost:3000`.

The port is published on **every** interface. The app is reachable at this machine's LAN address the moment `up -d` returns. On a shared network, change the `ports:` line to `'127.0.0.1:3000:3000'` and reach it through a reverse proxy instead.

**`TRUST_PROXY` sets how many reverse proxies stand in front of the app.** The compose file defaults to `1`. This is correct behind one proxy such as Caddy or nginx. Without it, the app CSRF check sees the wrong address and form posts fail. With no proxy in front, set it to `0`:

```bash
echo "TRUST_PROXY=0" >> .env
docker compose -f compose.yml up -d
```

With no proxy, pages work at either value. However, `1` lets a visitor fake their address in `X-Forwarded-For` and bypass the per-address limit on food lookups.

### Build the image yourself

To build from source instead of pulling the published image, comment out `image:` in [`docker/compose.yml`](../../../docker/compose.yml), uncomment `build:`, and run this from the repo root, because the build context is relative to that file:

```bash
docker compose --project-directory . -f docker/compose.yml build
docker compose --project-directory . -f docker/compose.yml up -d
```

```bash
podman compose --project-directory . -f docker/compose.yml build
podman compose --project-directory . -f docker/compose.yml up -d
```

To run with no container at all, see [Without Docker](#without-docker).

Every other setup (sync, self-hosted inference, or both) is a separate file under [`docker/topologies/`](../../../docker/topologies/). See [topologies.md](topologies.md) to choose one.

## The app plus your own sync service

[`docker/topologies/compose.sync.yml`](../../../docker/topologies/compose.sync.yml) is the reference deployment for the app, the sync service, and the Postgres database that **sync** needs. The app still connects to no database of its own. (If you also want self-hosted inference, see [The app plus sync and self-hosted inference](#the-app-plus-sync-and-self-hosted-inference) below. That setup uses the same sync configuration, plus the model runtime.)

```bash
mkdir -p ~/openplate && cd ~/openplate
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/topologies/compose.sync.yml

# The sync service needs exactly one secret. Generate it and keep it with your backups.
echo "SERVER_SECRET=$(openssl rand -hex 32)" >> .env

# Your key to the admin API. You need it to create the first account.
echo "ADMIN_TOKEN=$(openssl rand -hex 32)" >> .env

# The URLs a BROWSER will use to reach each service. Skip these two for a test
# on this machine, or through the ssh tunnel in the HTTPS section.
echo "PUBLIC_APP_URL=https://openplate.example.com" >> .env
echo "PUBLIC_SYNC_URL=https://sync.example.com" >> .env

# 1 behind one reverse proxy, 0 with none.
echo "TRUST_PROXY=1" >> .env

docker compose -f compose.sync.yml up -d
```

```bash
mkdir -p ~/openplate && cd ~/openplate
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/topologies/compose.sync.yml

echo "SERVER_SECRET=$(openssl rand -hex 32)" >> .env
echo "ADMIN_TOKEN=$(openssl rand -hex 32)" >> .env

echo "PUBLIC_APP_URL=https://openplate.example.com" >> .env
echo "PUBLIC_SYNC_URL=https://sync.example.com" >> .env
echo "TRUST_PROXY=1" >> .env

podman compose -f compose.sync.yml up -d
```

> **Accounts need a secure page.** Signing in, signing up and opening an invitation link all
> fail on plain `http://<the server's address>`: the browser withholds the cryptography they
> use. Serve both addresses over HTTPS, or test through `localhost`. See [HTTPS](#https).

**Read [openplate-core's README](https://github.com/LowCarbCheck/openplate/tree/main/apps/core) before you run that last line on a machine other people can reach.** Both services publish their ports on every interface. The account service is exposed the moment it starts, and running an account service is a bigger undertaking than running the app.

The file is annotated line by line, including the two settings that cause problems if set incorrectly (`SERVER_SECRET` and `TRUST_PROXY`). `TRUST_PROXY` applies to both services, because they sit behind the same proxy or behind none. The file passes every variable the services read from `.env` to their containers. [environment-variables.md](environment-variables.md) lists them all. See [sync.md](sync.md) for what sync is and how the client reaches it.

### Create the first account

Nobody can sign up on their own. An account is created by opening an invitation addressed to one email address. You mint the first invitation for yourself on the server using `ADMIN_TOKEN`. Run this in `~/openplate` with your own address. Port 3001 is where `compose.sync.yml` and `compose.full.yml` publish the sync service. The sync service's own compose file in `apps/core` uses port 3000 instead:

```bash
ADMIN_TOKEN=$(grep '^ADMIN_TOKEN=' .env | cut -d= -f2)
curl -s -X POST http://127.0.0.1:3001/v1/admin/invites \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","displayName":"You","role":"admin"}'
```

The answer is one line of JSON. The part that matters looks like this:

```json
"emailed":false,"link":"https://openplate.example.com/join#server=https%3A%2F%2Fsync.example.com&invite=si_..."
```

- **No mail configured** (the default): `"emailed": false`. Nobody was written to. Copy the `link` and open it yourself.
- **Mail configured** (see [Mail](#mail)): `"emailed": true`. The same link is on its way to that address as a letter.

Open the link in a browser on a secure page, choose a password, and the account exists. A phone or second device can sign in only after you set up [HTTPS](#https), because the ssh tunnel and `localhost` serve one computer only. The link works once and runs out after seven days. `"role":"admin"` makes this first account an administrator. From now on, you invite people in the app itself at `/admin`. On an instance with no mail, it displays each new link. Leave `role` out for an ordinary member. [Mail](#mail) explains both ways: passing each link on by hand, or letting the sync service mail it.

On a managed instance, where the sync service pays for everyone's scans, add `"dailyAiLimit":200` to the body to give the account 200 AI requests a day. The default is 0. A managed instance needs four more lines in `.env`. Scans refuse to start without `AI_ADVERTISED_MODEL`, because the app will not choose a model on your bill:

```bash
echo "INSTANCE_MODE=managed" >> .env
echo "UPSTREAM_BASE_URL=https://openrouter.ai/api/v1" >> .env
echo "UPSTREAM_API_KEY=sk-or-..." >> .env
echo "AI_ADVERTISED_MODEL=google/gemini-3.5-flash-lite" >> .env
```

The model name must match the provider's exact spelling. See [configuration.md](configuration.md#managed-instances).

### When someone forgets their password

With mail configured, **Forgot password** in the app mails a reset link, and the diary returns after the reset. With no mail, the app cannot send anything, and the forgot page tells the user to ask the administrator. You make the link:

- **In the app:** **Administration**, under **People**, open the person and choose **Send a reset link**. With no mail, the page displays the link. Share it the same way you would share a password.
- **On the server:** find the account's `id`, then ask for a link for it. The port is 3001 again, as in the topology compose files.

```bash
ADMIN_TOKEN=$(grep '^ADMIN_TOKEN=' .env | cut -d= -f2)
curl -s http://127.0.0.1:3001/v1/admin/accounts -H "Authorization: Bearer $ADMIN_TOKEN"
curl -s -X POST http://127.0.0.1:3001/v1/admin/accounts/1/reset-mail \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

The second call answers `{"emailed":false,"link":"https://openplate.example.com/reset#server=...&token=sr_..."}`. A reset link works once and runs out after one hour.

### Mail

The sync service can send invitation and password reset letters. It does not have to. A family instance works with no mail setup at all, and that is the simplest path.

#### No mail

Leave every mail setting unset. The sync service sends no letters. It shows each link to you instead, and you pass it on the way you would share a password.

- **An invitation:** open **Administration** at `/admin` and choose **Invite someone**. Enter the address and choose **Send the invitation**. The page says **Invitation ready for** that address and shows the link. Choose **Copy the link** and send it to the person, for example in a private message. Whoever holds the link can open the account.
- **A forgotten password:** under **People**, open the person and choose **Send a reset link**. The page shows the link. Pass it on the same way. It works once, within one hour.
- **A lost invitation:** under **Invitations**, choose **Send again** next to the address. This creates a new link and invalidates the old one. The page shows the new link to copy. Choose **Back to the list** to return to your open invitations.

If the link uses an address different from your browser, a warning appears below it. Set `PUBLIC_APP_URL` and `PUBLIC_SYNC_URL` to the addresses your family uses, then generate the link again. The page also warns you if the link opens the page but directs the app to a sync server at `localhost` or a plain `http://` address that other devices cannot reach. Set `PUBLIC_SYNC_URL` to the `https://` address your family uses, then generate the link again.

`OPEN_SIGNUP=true` lets strangers ask for an account. The sync service refuses to start with that setting when there is no mail configured. A family instance leaves it off, and it stays off until you set it. [Sign-up with Turnstile](environment-variables.md#sign-up-with-turnstile) explains the setting and its captcha.

#### SMTP

Any standard mail account can send the letters over SMTP. Add these lines to `.env`:

- `SMTP_HOST`: the server name, with no scheme and no port.
- `SMTP_PORT`: `587` when you leave it out.
- `SMTP_USER` and `SMTP_PASSWORD`: the login. Set both, or leave both empty for a server that requires no login.
- `SMTP_FROM`: the sender address, as a bare address or `Name <address>`.
- `MAIL_OPERATOR_EMAIL`: your own address. It receives your copy of a cancellation or a withdrawal. Both transports require it.

The port decides the encryption mode. Port 465 uses TLS from the start. Any other port must upgrade through STARTTLS, and the service sends no letters to a server that lacks it. Plain text is allowed only when `SMTP_HOST` is a loopback address such as `localhost`, for a local catcher such as Mailpit (see [Test with Mailpit](#test-with-mailpit)). The service always checks certificates.

A Gmail account needs an [app password](https://support.google.com/accounts/answer/185833). Google generates one only for accounts with 2-Step Verification turned on. [Google's SMTP settings](https://support.google.com/mail/answer/7104828) specify `smtp.gmail.com` and port 587:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=family.openplate@gmail.com
SMTP_PASSWORD="the app password"
SMTP_FROM="openplate <family.openplate@gmail.com>"
MAIL_OPERATOR_EMAIL=you@example.org
```

Amazon SES needs [SMTP credentials made for SES](https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html), which differ from your AWS access key, and a verified sending address. The host names your AWS region. Check the [endpoint list](https://docs.aws.amazon.com/general/latest/gr/ses.html) for details. While your account remains in the [SES sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), SES delivers only to verified recipient addresses.

```bash
SMTP_HOST=email-smtp.eu-central-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=<SES SMTP user name>
SMTP_PASSWORD=<SES SMTP password>
SMTP_FROM="openplate <noreply@example.org>"
MAIL_OPERATOR_EMAIL=you@example.org
```

Recreate the sync service with `docker compose -f <your file> up -d` after any edit to `.env`.

#### An HTTP mail API

A mail service with an HTTP API works as well. Set `MAIL_API_URL`, `MAIL_API_KEY`, and `MAIL_API_FROM`, all three, plus `MAIL_OPERATOR_EMAIL`. The sync service sends each letter as a JSON `POST` request to `MAIL_API_URL`, with `MAIL_API_KEY` as a Bearer token, using the format expected by the Resend API. [Resend](https://resend.com/docs/api-reference/emails/send-email) is one compatible service. On Resend, `MAIL_API_URL` is `https://api.resend.com/emails`.

Configure one transport only. If you set both SMTP and the mail API, the sync service refuses to start.

#### Mail needs the public addresses

Every letter carries a link, and that link must open on the reader's phone. When you configure SMTP or a mail API, set `PUBLIC_APP_URL` and `PUBLIC_SYNC_URL` to the `https://` addresses your family uses. If either setting uses plain `http://` or a loopback address such as `localhost`, the sync service refuses to start. Its log names each value to fix, in a message that starts like this:

```
Mail is configured. Its messages would carry links that recipients cannot open.
```

The log message refers to these values as `CLIENT_BASE_URL` and `SERVER_PUBLIC_URL`. Those are the internal names the sync service reads, and the compose files map them from `PUBLIC_APP_URL` and `PUBLIC_SYNC_URL`. View the message with `docker compose -f <your file> logs sync`.

#### Check that mail works

Send an invitation to a second address of your own in `/admin`. The page should display **Invitation sent to** that address, and the letter should arrive in your inbox. If the page displays **Invitation ready for** and prints a link, the delivery failed. The link remains valid. Check the sync service log for a `Mail send failed` line to see the reason. When you finish testing, choose **Withdraw** for the test invitation under **Invitations**.

#### Test with Mailpit

[Mailpit](https://mailpit.axllent.org) catches every letter and shows it on a web page, so you can test mail with no mail account. Run it as a sidecar that shares the network of the sync container. The sync service then reaches it as `localhost`, where plain text is allowed. Save this file next to your compose file as `compose.mailpit.yml`:

```yaml
# compose.mailpit.yml: a mail catcher for testing, next to your compose file
services:
  sync:
    ports:
      - '127.0.0.1:8025:8025' # Mailpit's web page, on this machine only
  mailpit:
    image: docker.io/axllent/mailpit:latest
    restart: unless-stopped
    network_mode: 'service:sync'
```

Add these lines to `.env`. Mailpit takes letters on port 1025:

```bash
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM="openplate <test@example.org>"
MAIL_OPERATOR_EMAIL=you@example.org
```

Start both files together, then send an invitation and read it at `http://localhost:8025` on the server:

```bash
docker compose -f compose.sync.yml -f compose.mailpit.yml up -d
```

The rule in [Mail needs the public addresses](#mail-needs-the-public-addresses) still applies. Set `PUBLIC_APP_URL` and `PUBLIC_SYNC_URL` to `https://` addresses first, or the sync service does not start.

A separate Mailpit container reached by service name, such as `SMTP_HOST=mailpit`, does not work. The sync service sends plain text only to this machine. A service name counts as another host. The service asks for STARTTLS, Mailpit offers none, and every letter fails with `Mail send failed` in the log. The shared network puts Mailpit on the same machine.

When you finish testing, remove the four lines from `.env`. Then drop Mailpit with `docker compose -f compose.sync.yml up -d --remove-orphans`.

#### A relay with a private certificate authority

The sync service checks the certificate of every mail server. A relay inside a company network may use a certificate signed by a private certificate authority. Node.js does not trust that authority by default. Give the sync service that authority's certificate as a PEM file. Mount the file into the container and set `NODE_EXTRA_CA_CERTS` to its path. For example, in a `compose.ca.yml` next to your compose file:

```yaml
# compose.ca.yml: trust a private certificate authority for the mail relay
services:
  sync:
    volumes:
      - ./relay-ca.pem:/etc/openplate/relay-ca.pem:ro
```

```bash
echo "NODE_EXTRA_CA_CERTS=/etc/openplate/relay-ca.pem" >> .env
docker compose -f compose.sync.yml -f compose.ca.yml up -d
```

Node.js reads the file once, at start. The certificate is added to the ones Node.js already trusts, so public mail servers keep working.

## The app plus self-hosted inference

[`docker/topologies/compose.inference.yml`](../../../docker/topologies/compose.inference.yml) runs the app beside [openplate-inference](https://github.com/LowCarbCheck/openplate/tree/main/apps/inference). Plate photos are read on your own hardware, and every visitor gets a one-tap "this openplate provides its own AI". Read the hardware section of [topologies.md](topologies.md#rung-3-add-self-hosted-inference) first. The small `lite` model wants about 1.6 GB of RAM and a few seconds to a minute per plate on a CPU.

```bash
mkdir -p ~/openplate && cd ~/openplate
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/topologies/compose.inference.yml

# One key, generated here on the server. The inference service accepts it and
# the app hands it to every browser.
echo "INFERENCE_API_KEY=opk_$(openssl rand -hex 24)" >> .env

# The two URLs a BROWSER will use. Replace 192.168.1.20 with this machine's
# address, or with the names your reverse proxy serves.
echo "PUBLIC_APP_URL=http://192.168.1.20:3000" >> .env
echo "PUBLIC_INFERENCE_URL=http://192.168.1.20:8300/v1" >> .env

# 0 with no reverse proxy, 1 behind one.
echo "TRUST_PROXY=0" >> .env

docker compose -f compose.inference.yml up -d
docker compose -f compose.inference.yml logs -f inference
```

> **Plain HTTP works for scans, HTTPS needs HTTPS all the way.** Over plain
> `http://<the server's address>`, a plate photo reaches the inference container, but installing
> the app does not work. Once the app runs on `https://`, the inference address must be
> `https://` as well. Otherwise, the browser blocks the call from the secure page. See [HTTPS](#https).

`PUBLIC_INFERENCE_URL` must be an address a **browser** can open, because the photo goes from the phone straight to the inference container. `http://inference:8300/v1`, the name the containers use for each other, does not work there. Keep the `/v1` at the end.

The first start downloads about 2 GiB of weights (1.96 GiB) into a named volume, which took six to seven minutes in our tests, and then loads the model. The log shows each step. The app is up at once; the one-tap AI works when this answers 200:

```bash
curl -s http://127.0.0.1:8300/readyz
```

The key sits in the page every browser loads, so anyone who can open the app can read it. That is fine on a home network or a tailnet, and wrong on an instance open to the internet. [configuration.md](configuration.md#instance-provided-ai) has the full rule. The inference container uses every CPU core but two; set `LLAMA_THREADS` in `.env` to change that.

## The app plus sync and self-hosted inference

[`docker/topologies/compose.full.yml`](../../../docker/topologies/compose.full.yml) runs four containers: the app, the sync service, Postgres, and self-hosted inference. Read [The app plus your own sync service](#the-app-plus-your-own-sync-service) and [The app plus self-hosted inference](#the-app-plus-self-hosted-inference) first. This section only covers what changes when every piece runs together.

```bash
mkdir -p ~/openplate && cd ~/openplate
curl -O https://raw.githubusercontent.com/LowCarbCheck/openplate/main/docker/topologies/compose.full.yml

# The sync service needs exactly one secret. Generate it and keep it with your backups.
echo "SERVER_SECRET=$(openssl rand -hex 32)" >> .env

# Your key to the admin API. You need it to create the first account.
echo "ADMIN_TOKEN=$(openssl rand -hex 32)" >> .env

# One key for the inference service, which the app hands to every browser.
echo "INFERENCE_API_KEY=opk_$(openssl rand -hex 24)" >> .env

# The URLs a BROWSER will use to reach each service. PUBLIC_APP_URL and
# PUBLIC_SYNC_URL default to localhost, so skip both for a test on this
# machine. PUBLIC_INFERENCE_URL has no such default: set it even for a
# local test, for example to http://localhost:8300/v1.
echo "PUBLIC_APP_URL=https://openplate.example.com" >> .env
echo "PUBLIC_SYNC_URL=https://sync.example.com" >> .env
echo "PUBLIC_INFERENCE_URL=https://ai.example.com/v1" >> .env

# 1 behind one reverse proxy, 0 with none.
echo "TRUST_PROXY=1" >> .env

docker compose -f compose.full.yml up -d
```

Create the first account the same way as [above](#create-the-first-account). The first start also downloads the inference weights, about 2 GiB. The model-loading log and the readiness check work the same way as in [The app plus self-hosted inference](#the-app-plus-self-hosted-inference). For real devices instead of a trial, put all three addresses behind HTTPS. See [HTTPS](#https).

## Without Docker

The app is a single Node.js program. It runs directly from a checkout. Here is how to run it on Ubuntu 24.04 with systemd keeping it alive across logouts and reboots.

**Node.js 24 or newer.** Ubuntu 24.04 provides `nodejs` version 18, which is too old. Install 24 from [NodeSource](https://github.com/nodesource/distributions):

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o nodesource_setup.sh
sudo -E bash nodesource_setup.sh
sudo apt install -y nodejs git
node --version      # v24.x
```

[nvm](https://github.com/nvm-sh/nvm) also works, but it puts Node in your home folder. The systemd unit below must then use that path (`command -v node` prints it).

**pnpm, the version the repository asks for.** `corepack` comes with Node 24. It fetches the exact pnpm set in the `packageManager` field of the app's `package.json`, but only inside `apps/app`. Outside that folder, `pnpm` defaults to whatever corepack chooses. Run every `pnpm` command inside `apps/app`. On the first run, confirm the download prompt.

```bash
sudo corepack enable
git clone https://github.com/LowCarbCheck/openplate.git ~/openplate-src
cd ~/openplate-src/apps/app
pnpm install --frozen-lockfile
pnpm build
```

**The settings.** The server reads `.env` from the folder it runs in. In production it refuses to start without `APP_URL`:

```bash
cat > .env <<'EOF'
NODE_ENV=production
PORT=3000
APP_URL=http://localhost:3000
TRUST_PROXY=0
EOF
```

Set `APP_URL` to the address people open, and `TRUST_PROXY=1` once a reverse proxy stands in front. Every other variable of [the app](environment-variables.md#the-app) goes in the same file. `HOST=127.0.0.1` makes the server listen on this machine only, which is what you want behind a proxy on the same box.

**A systemd unit**, so the app starts at boot and keeps running after you log out. The `$USER` and `$HOME` below are filled in as you paste it:

```bash
sudo tee /etc/systemd/system/openplate.service > /dev/null <<EOF
[Unit]
Description=openplate
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$HOME/openplate-src/apps/app
Environment=NODE_ENV=production
ExecStart=/usr/bin/node --import tsx ./server.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now openplate
curl -s http://127.0.0.1:3000/healthcheck
```

`sudo journalctl -u openplate -f` shows the log. To upgrade, pull and build again, then restart:

```bash
cd ~/openplate-src/apps/app
git pull
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart openplate
```

The [HTTPS](#https) section applies here unchanged: point the reverse proxy at port 3000.

## First run

1. Open the app and follow the short onboarding. No registration, no login: whoever opens
   the app on a device is that device's user.
2. Go to **Settings → AI** and connect an AI provider with your own API key (OpenRouter,
   Mistral, your own OpenAI-compatible endpoint, or Anthropic). See
   [configuration.md](configuration.md) for the OpenRouter one-click flow and for offering an
   instance-provided endpoint instead.
3. Take a backup early: **Settings → Data & backup → Download everything (JSON)**. Your diary
   lives in this browser's storage, so a backup is the only copy that survives clearing site
   data or moving to a new device.
4. If more than one person scans on this instance, get a free food-database key at
   [lowcarbcheck.org/developers](https://lowcarbcheck.org/developers), add it to `.env` as
   `FOOD_DB_API_KEY=...`, and run `docker compose -f <your file> up -d` again. Without a
   key everyone on the instance shares one small anonymous allowance. See
   [configuration.md](configuration.md#the-food-database-key).
   With a key you can also set `FOOD_DB_BACKFILL=true`, which passes the foods people save
   from an AI answer on to LowCarbCheck as proposals. See
   [configuration.md](configuration.md#proposals-to-the-food-database).

## HTTPS

Browsers restrict several features to a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). A secure context is a page served over `https://`, or from `localhost` on the local machine. openplate requires a secure context for several functions:

- **Accounts, sign-in and sync.** Signing in, signing up, and opening an invitation or reset link derive keys with the Web Crypto API (`crypto.subtle`). Browsers disable this API on a plain `http://` page. On `http://192.168.1.20:3000`, these screens fail. Sharing and the research console fail too, because they use the same API.
- **Connect with OpenRouter**, the one-click sign-in to OpenRouter, for the same reason. Pasting a key by hand works anywhere.
- **Installing the app** and **offline use** (the service worker).

On plain HTTP from another device, the diary, manual logging, backups and plate photos still work. The photo button hands over to the phone's own camera through a file picker, which needs no secure page. The quickstart works without changes on the server itself, because `localhost` counts as secure.

Your devices need a secure address. You can set one up in four ways: an ssh tunnel for a quick test, Caddy with a domain name, Caddy on a home network with no domain name, or Tailscale.

### A quick test from one computer: an ssh tunnel

> **This is a test for one computer, not a setup.** The tunnel serves only the computer that
> runs it, and only while the command runs. A phone or a second device cannot sign in through
> it. For those, set up HTTPS with [Caddy](#a-domain-name-caddy) below.

To test accounts and sync before configuring a certificate, forward the two ports to your computer. Leave `PUBLIC_APP_URL` and `PUBLIC_SYNC_URL` unset so both keep their `localhost` defaults. Leave mail unset here as well. With mail set, the sync service refuses to start while its link addresses name `localhost`. Without mail, it starts, and you copy each link yourself. Run this command on your computer, not on the server:

```bash
ssh -N -L 3000:localhost:3000 -L 3001:localhost:3001 you@192.168.1.20
```

While the command runs, open `http://localhost:3000` in your browser. This counts as a secure page, so signing in works. An invitation link from the server (`http://localhost:3000/join#...`) also opens there. Add `-L 8300:localhost:8300` for the inference container.

### A domain name: Caddy

Caddy fetches and renews a Let's Encrypt certificate automatically. It requires a domain name directed at your server. It also requires ports 80 and 443 reachable from the internet for certificate verification.

```
# Caddyfile
openplate.example.com {
    reverse_proxy localhost:3000
}
```

Next, set `APP_URL=https://openplate.example.com` in `.env`. Set `TRUST_PROXY=1`, which is the production default. Recreate the `app` service with `docker compose -f compose.yml up -d`. A plain `docker compose restart` does **not** re-read `.env`. It only restarts the existing container, so new values never load.

For sync, give the sync service its own domain name. Set both public URLs instead of `APP_URL`:

```
# Caddyfile
openplate.example.com {
    reverse_proxy localhost:3000
}
sync.example.com {
    reverse_proxy localhost:3001
}
```

```bash
PUBLIC_APP_URL=https://openplate.example.com
PUBLIC_SYNC_URL=https://sync.example.com
TRUST_PROXY=1
```

Change the `ports:` line to `'127.0.0.1:3000:3000'`, and use `'127.0.0.1:3001:3000'` for sync. Apply the change with `docker compose -f <your file> up -d`. A reverse proxy does not unpublish container ports. If you leave it as `'3000:3000'`, the app continues serving plain HTTP on port 3000 across your local network alongside the HTTPS address.

Podman recreates the service the same way with `podman compose -f compose.yml up -d`. Note one rootless detail before skipping the reverse proxy: a rootless Podman container cannot bind a host port below 1024 without extra configuration. Publishing directly to port 80 or 443 requires `sudo sysctl net.ipv4.ip_unprivileged_port_start=80` first. See [podman.md](podman.md).

### No domain name, home network only: Caddy with a local certificate

With no domain name, Caddy can still serve HTTPS on your home network. It makes its own certificate authority and uses it to sign a certificate for the server's address. Every phone and computer that opens openplate must trust that authority once. After that, the family's phones get a secure page. Signing in, sync and installing the app work over `https://`.

**Give the server a fixed address.** In your router, reserve the server's current address, for example `192.168.1.20`, so that it never changes. The certificate and both public addresses name it.

**Install Caddy and point it at the address.** On Ubuntu, `sudo apt install caddy` installs Caddy as a service. Replace `/etc/caddy/Caddyfile` with this, using your server's address. `tls internal` tells Caddy to sign the certificate itself:

```
# /etc/caddy/Caddyfile
https://192.168.1.20 {
    tls internal
    reverse_proxy localhost:3000
}
https://192.168.1.20:8443 {
    tls internal
    reverse_proxy localhost:3001
}
```

```bash
sudo systemctl reload caddy
```

**Set the same addresses in `.env`**, then recreate the containers with `docker compose -f <your file> up -d`:

```bash
PUBLIC_APP_URL=https://192.168.1.20
PUBLIC_SYNC_URL=https://192.168.1.20:8443
TRUST_PROXY=1
```

For the app on its own, set `APP_URL=https://192.168.1.20` instead. Leave the second block out of the Caddyfile. As in the recipe above, change the `ports:` lines to `'127.0.0.1:3000:3000'` and `'127.0.0.1:3001:3000'`, so that only Caddy reaches the containers.

**Copy Caddy's root certificate off the server.** Ubuntu's Caddy keeps it at `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`. The certificate is public. Its private key is in the same folder and must never leave the server, so copy only `root.crt`:

```bash
sudo cp /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt ~/openplate-root.crt
sudo chown "$USER" ~/openplate-root.crt
```

On your computer, fetch it with `scp you@192.168.1.20:openplate-root.crt .`. Then send it to each phone, for example as a mail attachment to yourself, or with AirDrop.

**Trust it on every device, once.** This is the step that makes the family's phones work over `https://`.

- **iPhone and iPad:** open the file and allow the download. In **Settings**, tap **Profile Downloaded** near the top, or find it under **General > VPN & Device Management**, and install it. Then turn on full trust for it under **Settings > General > About > Certificate Trust Settings**. Without this last step, the browser still refuses the page.
- **Android:** save the file on the phone. Open **Settings > Security > Encryption & credentials > Install a certificate > CA certificate**, accept the warning, and pick the file. On newer phones the path starts at **Security & privacy > More security settings**, and the names differ a little between phone makers. If the phone has no screen lock, Android asks you to set one.
- **A computer:** add it to the system's certificates. Some browsers keep their own list and need it there as well.

Open `https://192.168.1.20` on a phone. The page should load with no warning, and signing in should work. The address works only on your home network. Keep Caddy's data folder with your backups. A new Caddy install makes a new authority, and every device must then trust the new one.

### Any other reverse proxy

nginx, Traefik, or another proxy can take Caddy's place. We have tested none of them, so this is a checklist, not a recipe. The proxy must do all of this:

- **Two `https://` addresses.** The app and the sync service each get their own.
- **The same addresses in `.env`.** Set `PUBLIC_APP_URL` and `PUBLIC_SYNC_URL` to those exact addresses. For the app on its own, that is `APP_URL`.
- **`TRUST_PROXY=1`**, or the number of proxies in the chain.
- **`Host` and `X-Forwarded-Proto` reach the app.** Pass the browser's `Host` header through unchanged, or set `X-Forwarded-Host` to it. Set `X-Forwarded-Proto` to `https`. The app's CSRF check builds the page's own address from these and compares it with the browser's `Origin`. If they are wrong, form posts fail.
- **`X-Forwarded-For` reaches both services.** Their per-address limits read it.
- **The container ports stay on `127.0.0.1`.** Keep `'127.0.0.1:3000:3000'` and `'127.0.0.1:3001:3000'`, so nothing reaches them past the proxy.

### No domain name: Tailscale Serve

Tailscale gives every machine on your tailnet an HTTPS address under `ts.net`. You need no domain name, no open ports, and no manual certificate management. Tailscale Serve puts that address in front of a port on this machine. openplate with sync needs two addresses. You serve two ports under the same machine name: the app on 443 and the sync service on 8443.

Before you start:

- **Turn on MagicDNS and HTTPS certificates** for your tailnet on the DNS page of the Tailscale admin console. [Tailscale's HTTPS guide](https://tailscale.com/docs/how-to/set-up-https-certificates) has the steps. The machine name appears in a public certificate log, so choose a name that reveals nothing private.
- **Every family member runs Tailscale** on each device that opens openplate. Each person must be in your tailnet, or have this machine [shared with them](https://tailscale.com/docs/features/sharing).
- **Keep the container ports on `127.0.0.1`**: `'127.0.0.1:3000:3000'` for the app and `'127.0.0.1:3001:3000'` for sync. Tailscale Serve reaches them on this machine. Nothing else needs access.

Then serve both ports. `--bg` keeps them running in the background, and Tailscale serves them again after a reboot:

```bash
tailscale serve --bg --https=443 3000
tailscale serve --bg --https=8443 3001
tailscale serve status
```

Tailscale issues and renews the certificate. Set both addresses in `.env`, using your own machine and tailnet names:

```bash
PUBLIC_APP_URL=https://<machine-name>.<tailnet>.ts.net
PUBLIC_SYNC_URL=https://<machine-name>.<tailnet>.ts.net:8443
TRUST_PROXY=1
```

Tailscale Serve is a reverse proxy, so `TRUST_PROXY` stays at `1`. Recreate the stack with `docker compose -f <your file> up -d`. If you run the app on its own, serve only port 3000 and set `APP_URL` to the first address.

We have not run this path end to end. The [`tailscale serve` reference](https://tailscale.com/docs/reference/tailscale-cli/serve) documents the flags above, and [Tailscale's documentation](https://tailscale.com/docs/features/tailscale-serve) describes `tailscale serve`. The Caddy recipe above is the one we verified.

Headscale, a self-hosted Tailscale control server, gives out no HTTPS certificates. A Headscale tailnet needs the Caddy recipe with a domain instead.

## Backups

**There is nothing on the app server to back up.** It holds no database and writes no state:
a destroyed app container loses nothing.

**The per-device JSON export is the backup that matters**: **Settings → Data & backup →
Download everything (JSON)**. That file is the copy that outlives a cleared browser or a dead
phone. The app shows a reminder banner when a device holds data you have never exported, or
have not exported in a while.

**Keep the export as private as the diary.** It holds every entry in the clear, and it also
holds the private key of this device's sharing identity and the root the research pseudonym is
derived from. Whoever holds the file can open a diary that was shared with this person, and can
link their study contributions back to them. Two things stay out of it: the AI provider key,
and the plate photographs, which never leave the device.

If you also run the sync service, its Postgres is worth a scheduled dump, together with the
`SERVER_SECRET`, which is useless without the database and vice versa:

```bash
docker compose -f compose.sync.yml exec postgres \
  pg_dump -U openplate openplate_sync > sync-backup.sql
```

```bash
podman compose -f compose.sync.yml exec postgres \
  pg_dump -U openplate openplate_sync > sync-backup.sql
```

## Upgrading

```bash
docker compose -f compose.yml pull
docker compose -f compose.yml up -d
```

```bash
podman compose -f compose.yml pull
podman compose -f compose.yml up -d
```

Use the same `-f` file you deployed with. If you brought up a topology from
[`docker/topologies/`](../../../docker/topologies/), name that file instead, for example
`docker compose -f compose.sync.yml pull`. A bare `docker compose pull` beside
`compose.sync.yml` fails with `no configuration file provided: not found`.

The compose files use the `latest` tag, which is the newest release, so `pull` takes you to
it. To choose when you upgrade, pin a version in the `image:` line, for example
`ghcr.io/lowcarbcheck/openplate:0.54.0`. Change the number when you want the next release. The
sync service and the inference service have version numbers of their own, so pin each image to
its own. The `main` tag follows every change on the main branch. It is for testing, not for a
server your family uses.

There is nothing to migrate: the app container holds no state, so a new image just replaces
the old one. If you run the full stack, the sync service applies its own migrations on start.

### Upgrading from a pre-0.1.x image (one time)

Older images ran an account system and a Postgres of their own. Both are gone. The upgrade
drops the `users` table and everything hanging off it: accounts, sessions, verification and
reset tokens. Nothing you logged is affected: tracker data had already moved onto the device.
It is a one-way change, so:

1. **Back up first.** Take a `pg_dump` of the app's old database if you want the account rows
   recoverable, and have every person on every device take a JSON export from **Profile → Your
   data**. That export is the copy that holds their diary.
2. **Upgrade.** First update the `image:` line to `ghcr.io/lowcarbcheck/openplate:latest`, the newest release:
   pre-0.1.x images were published under `ghcr.io/sprqvntrs/openplate`, and pulling without
   this change just re-fetches the old one. The migration then runs on container start. Afterwards there is no login page:
   every device that already has data keeps it and simply stops asking who you are.
3. **Prune your `.env`.** The session-secret, encryption-key, signup-gate and seeded-superadmin
   variables are gone, and so are `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` and
   the pool-tuning variables. Nothing reads them. Leaving them set is harmless, but they are
   dead weight.
4. **Drop the old volume** once you are happy. Older releases pinned no Compose project name,
   so the prefix came from whatever directory you ran in (confirm the real name first):
   `docker volume ls | grep pg-data`, then `docker compose down && docker volume rm <that name>`.

If two accounts were signed in on the **same** browser profile, note that the device store was
always device-scoped: their data was already sharing one store and stays that way. Separate
browser profiles remain the way to keep two people's diaries apart on one device.
