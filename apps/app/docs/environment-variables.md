# Environment variables

Every setting of the three openplate containers is an environment variable. This page lists all of them, for the app, the sync service (openplate-core) and the inference service. Most are optional. When you leave one unset, the default in its row applies.

Some settings stop the boot on purpose. A value the service cannot use, or one half of a pair, makes the container exit. The exit message names the variable. The container does not start with a guess. [Settings that stop the boot](#settings-that-stop-the-boot) lists every such rule.

## How to set a variable

- **Docker Compose.** Put the line in the `.env` file next to the compose file, for example `LOG_LEVEL=debug`. Then run `docker compose -f <your file> up -d` again. Every shipped compose file passes each variable its service reads on to the container. `docker compose restart` does not read `.env` again.
- **Quadlet.** Put the line in the `<unit>.env` file next to the unit, for example `app.env`, `sync.env` or `inference.env`. Use the container's own names from this page. Then restart the unit, for example `systemctl --user restart sync.service`. [podman.md](podman.md#quadlet-units) explains the files.
- **Without a container.** The app and the sync service each read a `.env` file in the folder they run in. You can also set the variable in the shell or in the systemd unit. [Without Docker](self-hosting.md#without-docker) shows the app's setup.

The Default column says what the service does when the variable is unset. A compose file can pass a value of its own, for example `MODEL_PROFILE: lite`. The compose file shows that value next to the name.

### Names the compose files fill for you

The three topology files, `compose.sync.yml`, `compose.inference.yml` and `compose.full.yml`, fill some container variables from shared names in `.env`. Set the shared name there. The container variable on its own has no effect in these files.

| In `.env` | Fills |
| --- | --- |
| `PUBLIC_APP_URL` | the app's `APP_URL`, and the sync service's `CLIENT_BASE_URL` |
| `PUBLIC_SYNC_URL` | the app's `SYNC_SERVER_URL`, and the sync service's `SERVER_PUBLIC_URL` |
| `PUBLIC_INFERENCE_URL` | the app's `DEFAULT_INFERENCE_BASE_URL` |
| `INFERENCE_API_KEY` | the app's `DEFAULT_INFERENCE_API_KEY`, and the inference service's `API_KEYS` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `SYNC_DB_NAME` | the database, and the sync service's `DATABASE_URL` |

`docker/compose.yml`, the app on its own, takes `APP_URL` under its own name. The sync service's own quickstart file is `apps/core/docker/compose.yml`. It takes `SERVER_PUBLIC_URL` and `CLIENT_BASE_URL` under their own names. It builds `DATABASE_URL` from `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`.

## The app

The app container, `ghcr.io/lowcarbcheck/openplate`. It starts with nothing set. [configuration.md](configuration.md) explains its larger features in depth.

### Server and addresses

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` in the image, otherwise `development` | `production` serves the built app, makes `APP_URL` required, and makes `1` the `TRUST_PROXY` default. The image sets it. | |
| `APP_URL` | `http://localhost:3000`, **required** in production | The public address people open, for example `https://openplate.example.com`. The front page puts it in its share links. The server does not start in production without it. | [Caddy](self-hosting.md#a-domain-name-caddy) |
| `PORT` | `3000` | The port the server listens on. | |
| `HOST` | unset, every interface | The address the server listens on. Leave it unset in a container. Without a container, `127.0.0.1` keeps the server on this machine, for a proxy on the same box. | [Without Docker](self-hosting.md#without-docker) |
| `TRUST_PROXY` | `1` in production, otherwise off | How many reverse proxies stand in front of the app: a number, `true`, `false`, or an Express preset or address range such as `loopback` or `10.0.0.0/8`. The check that stops cross-site form posts needs the right value behind a proxy. Use `0` with no proxy. | [The app on its own](self-hosting.md#the-app-on-its-own) |
| `CSP_CONNECT_EXTRA` | unset | Extra origins for the `connect-src` of the Content-Security-Policy, separated by spaces. Your own AI endpoint on another host needs this. | [Custom AI endpoints](configuration.md#custom-ai-endpoints) |

### Language and content

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `DEFAULT_UI_LANGUAGE` | `en` | The language a visitor sees before choosing one: `en`, `de`, `fr`, `it`, `es` or `tr`. A person's own choice always wins. Any other value stops the boot. | |
| `NUTRIENT_REFERENCE_BASIS` | `dge` | The reference values the Nutrients screen quotes: `dge` (German DGE), `efsa` (EU) or `us` (NASEM). Any other value stops the boot. | |
| `CONTENT_DIR` | unset, no legal pages | A folder of markdown files for the legal pages, mounted read-only. A value that names no folder stops the boot. | [Content pages](content.md) |

### Sync and the kind of instance

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `SYNC_SERVER_URL` | unset, sync off | The address of your sync service, as a browser reaches it. Its origin goes into the Content-Security-Policy. A malformed value stops the boot. | [Sync](sync.md) |
| `INSTANCE_MODE` | `open` | `open` or `managed`. On a managed instance an administrator invites people, and the sync service supplies the AI. `managed` needs `SYNC_SERVER_URL`. Any other value stops the boot. | [Managed instances](configuration.md#managed-instances) |

### Instance-provided AI

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `DEFAULT_INFERENCE_BASE_URL` | unset | An OpenAI-compatible endpoint this instance offers to every visitor, as a browser reaches it. A malformed value stops the boot. | [Instance-provided AI](configuration.md#instance-provided-ai) |
| `DEFAULT_INFERENCE_API_KEY` | unset | The key for that endpoint. **It is public**: every visitor's browser receives it. | [Instance-provided AI](configuration.md#instance-provided-ai) |
| `DEFAULT_INFERENCE_MODEL` | `openplate-plate-1` | The model name sent to that endpoint. | [Instance-provided AI](configuration.md#instance-provided-ai) |

### Food database

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `FOOD_DB_API_URL` | `https://lowcarbcheck.org` | The LowCarbCheck food database the server looks food names up in. An empty value turns the lookup off. | [The food database key](configuration.md#the-food-database-key) |
| `FOOD_DB_API_KEY` | unset, the anonymous tier | Your LowCarbCheck key. Only the server reads it, and it never reaches a browser. | [The food database key](configuration.md#the-food-database-key) |
| `FOOD_DB_BACKFILL` | `false` | `true` passes the foods people save from an AI answer on to LowCarbCheck as proposals. It needs `FOOD_DB_API_KEY` and stays off without it. Any value other than `true` or `false` stops the boot. | [Proposals to the food database](configuration.md#proposals-to-the-food-database) |

### Analytics, newsletter and updates

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `MATOMO_URL` | unset, analytics off | A Matomo install you run yourself. Set it together with `MATOMO_SITE_ID`. | [Analytics](configuration.md#analytics) |
| `MATOMO_SITE_ID` | unset | The Matomo site id, a positive whole number. Set it together with `MATOMO_URL`. | [Analytics](configuration.md#analytics) |
| `MATOMO_EVENT_LEVEL` | `product` | How much the instance counts: `pageviews`, `product` or `research`. It needs the two above. | [What a level decides](configuration.md#what-a-level-decides) |
| `NEWSLETTER_SUBSCRIBE_URL` | unset, no form | Where the server forwards the landing page's newsletter form. Set it together with `NEWSLETTER_TURNSTILE_SITE_KEY`. | [Newsletter sign-up](configuration.md#newsletter-sign-up) |
| `NEWSLETTER_TURNSTILE_SITE_KEY` | unset | The Cloudflare Turnstile site key of that form. It is not the sign-up captcha, see [Sign-up with Turnstile](#sign-up-with-turnstile). | [Newsletter sign-up](configuration.md#newsletter-sign-up) |
| `UPDATE_CHECK` | on | `off` or `false` stops the server asking GitHub for a newer release. | [The release check](configuration.md#the-release-check) |

### Logging

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `LOG_LEVEL` | `info` | How much the server logs, as a pino level: `debug`, `info`, `warn` or `error`. | |

### Closing an instance

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `MOVED_TO_URL` | unset | Closes this instance and directs users to another one, for example `https://app.openplate.de`. Every page request serves a page that names the new address, the service worker installed on phones clears its caches and unregisters itself, and the API returns 410. The value must be an `https://` address on a host other than `APP_URL`; anything else stops the boot. | [Moving people to another instance](configuration.md#moving-people-to-another-instance) |

## The sync service (openplate-core)

The sync service container, `ghcr.io/lowcarbcheck/openplate-core`. It needs two values: `DATABASE_URL`, which the compose files fill for you, and `SERVER_SECRET`. Everything else is optional and off until you set it. [openplate-core's README](https://github.com/LowCarbCheck/openplate/blob/main/apps/core/README.md) explains the features.

### Server and addresses

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` in the image | With mail set, `production` requires both link addresses below to be `https://` addresses on another host. | [Mail needs the public addresses](self-hosting.md#mail-needs-the-public-addresses) |
| `PORT` | `3000` | The port the service listens on. | |
| `HOST` | unset, every interface | The address the service listens on. Leave it unset in a container. `127.0.0.1` keeps a development instance on its own machine. | |
| `TRUST_PROXY` | `false` | How many reverse proxies stand in front: a number, `true` or `false`. With the wrong value behind a proxy, every request seems to come from the proxy. One person can then use up the limit for everybody. | [Three settings that matter](https://github.com/LowCarbCheck/openplate/blob/main/apps/core/README.md#three-settings-that-matter-more-than-the-rest) |
| `SERVER_PUBLIC_URL` | unset | This service's own public address. It goes into the links in invitation and password reset letters. Set it together with `CLIENT_BASE_URL`. | [Mail needs the public addresses](self-hosting.md#mail-needs-the-public-addresses) |
| `CLIENT_BASE_URL` | unset | The address of the openplate app, the other half of those links. | [Mail needs the public addresses](self-hosting.md#mail-needs-the-public-addresses) |
| `INSTANCE_NAME` | `openplate` | Sets the instance name for the `/health` handshake (`instance.name`) and the start-up log. The letters do not use it. Maximum 64 characters. | |
| `INSTANCE_LANGUAGE` | `en` | Sets the letter language when a request specifies none. Accepted values are `en`, `de`, `fr`, `it`, `es` or `tr`. Any other value stops the boot. | |
| `NUTRIENT_REFERENCE_BASIS` | `dge` | A new instance starts with one of these reference values: `dge`, `efsa` or `us`. An administrator can change the live setting later through the admin API. Any other value stops the boot. | |
| `CONTENT_DIR` | unset | A folder, mounted read-only, with the text of the declaration letters. The app can read its legal pages from this folder. The service never checks it at boot. | [Declaration letters](https://github.com/LowCarbCheck/openplate/blob/main/apps/core/docs/operations/declaration-mail-text.md) |

### Database

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `DATABASE_URL` | none, **required** | The Postgres connection string. The compose files build it for you. | |
| `DATABASE_SSL` | `false` | Set to `true` if Postgres requires TLS. Accepts `true`, `false`, `1` or `0`. | |
| `MIGRATIONS_DIR` | `drizzle/migrations` | This sets where the service finds its database migrations at start. The image keeps them there, so leave it unset. | |

### Secrets

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `SERVER_SECRET` | none, **required** | The root secret must be at least 32 characters. Generate it with `openssl rand -hex 32` and back it up with the database. Changing this secret locks out every account permanently. | [Three settings that matter](https://github.com/LowCarbCheck/openplate/blob/main/apps/core/README.md#three-settings-that-matter-more-than-the-rest) |
| `ADMIN_TOKEN` | unset | The operator admin credential must be at least 24 characters. You need it to create the first account. With no token and no administrator account, the admin API returns 404. | [Create the first account](self-hosting.md#create-the-first-account) |

### Accounts and sign-up

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `OPEN_SIGNUP` | unset, invitations only | `true` lets anyone request an account with their own address. This requires mail. The server accepts only `true`. Any other value, including `false`, stops the boot. | [Sign-up with Turnstile](#sign-up-with-turnstile) |
| `TURNSTILE_SECRET_KEY` | unset, no captcha | The Cloudflare Turnstile secret key that verifies the sign-up captcha. Set it together with `TURNSTILE_SITE_KEY`, and only with `OPEN_SIGNUP=true`. | [Sign-up with Turnstile](#sign-up-with-turnstile) |
| `TURNSTILE_SITE_KEY` | unset | The public Turnstile site key. `/health` publishes it, and the app renders the captcha with it. | [Sign-up with Turnstile](#sign-up-with-turnstile) |

### Invitations and trials

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `MEMBER_INVITE_DAILY_AI_LIMIT` | unset, members cannot invite | The number of AI requests per UTC day an account gets when a member invited it, 1 to 10000. Set it together with `MEMBER_INVITE_ALLOWANCE_DAYS`. | [Member invites](configuration.md#member-invites) |
| `MEMBER_INVITE_ALLOWANCE_DAYS` | unset | The number of days after sign-up that this allowance lasts. | [Member invites](configuration.md#member-invites) |
| `MEMBER_INVITE_LIFETIME_CAP` | `5` | The total invitations one member can send, ever: 0 or more. This requires the pair above, or `MEMBER_INVITE_TRIAL=true`. | [Member invites](configuration.md#member-invites) |
| `MEMBER_INVITE_TRIAL` | `false` | `true` makes a member invitation grant the scan trial below instead of the day allowance. It requires the trial, and cannot be used with the pair above. | |
| `TRIAL_SCANS` | unset, no trial | The free AI scans a new account gets, 1 to 100. Set it together with `TRIAL_DAILY_AI_LIMIT`, and set `TRIAL_ADDRESS_PEPPER` with them. | |
| `TRIAL_DAILY_AI_LIMIT` | unset | The number of AI requests per UTC day during the trial, 1 to 10000. | |
| `TRIAL_DAYS` | unset, no end date | The trial also ends at midnight after this many days, 1 to 90, whichever comes first. It requires the trial pair. | |
| `TRIAL_TIME_ZONE` | `UTC` | The time zone of that midnight, as an IANA name such as `Europe/Berlin`. It requires `TRIAL_DAYS`. An unknown zone stops the boot. | |
| `TRIAL_ADDRESS_PEPPER` | unset | The secret that enforces one trial per mailbox. It must be at least 32 characters. Required with the trial pair. Changing this value forgets which mailboxes had a trial. | |
| `AI_TRIAL_INSTANCE_DAILY_LIMIT` | unset, no limit | The total amount all trial accounts together can spend per UTC day. Requires the trial. | |

### Mail

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `SMTP_HOST` | unset | The SMTP server name or address, with no scheme, port, or path. | [SMTP](self-hosting.md#smtp) |
| `SMTP_PORT` | `587` | `465` uses TLS from the first byte. Every other port must upgrade with STARTTLS, except a mail catcher on this machine. | [SMTP](self-hosting.md#smtp) |
| `SMTP_USER` | unset | The SMTP username. Set it together with `SMTP_PASSWORD`, or leave both unset for a server with no login. | [SMTP](self-hosting.md#smtp) |
| `SMTP_PASSWORD` | unset | The SMTP password. | [SMTP](self-hosting.md#smtp) |
| `SMTP_FROM` | unset | The sender, formatted as `address` or `Name <address>`. SMTP requires it. | [SMTP](self-hosting.md#smtp) |
| `MAIL_API_URL` | unset | A Resend-compatible HTTP mail API. Set it together with `MAIL_API_KEY`, `MAIL_API_FROM`, and `MAIL_OPERATOR_EMAIL`. | [An HTTP mail API](self-hosting.md#an-http-mail-api) |
| `MAIL_API_KEY` | unset | The mail API key, sent as a Bearer token. | [An HTTP mail API](self-hosting.md#an-http-mail-api) |
| `MAIL_API_FROM` | unset | The sender address for the mail API. | [An HTTP mail API](self-hosting.md#an-http-mail-api) |
| `MAIL_OPERATOR_EMAIL` | unset | Your own address. It receives your copy of a cancellation or a withdrawal. Both transports require it. | [SMTP](self-hosting.md#smtp) |
| `NODE_EXTRA_CA_CERTS` | unset | The path inside the container to a PEM file with extra certificate authorities. Node.js reads it at start. Mount the file for a mail relay whose certificate a private authority signed. | [A relay with a private certificate authority](self-hosting.md#a-relay-with-a-private-certificate-authority) |

### AI proxy and limits

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `UPSTREAM_BASE_URL` | unset, no AI | The provider's OpenAI-compatible address, for example `https://openrouter.ai/api/v1`. Set it together with `UPSTREAM_API_KEY`. | [Managed instances](configuration.md#managed-instances) |
| `UPSTREAM_API_KEY` | unset | The provider key. It never reaches a browser. | [Managed instances](configuration.md#managed-instances) |
| `UPSTREAM_TIMEOUT_MS` | `120000` | The time in milliseconds the proxy waits for the provider's first answer, and then between parts of it. | |
| `AI_ADVERTISED_MODEL` | unset | The model every scan uses. `/health` names it, and the proxy writes it into every request. The app does not scan without it. | [Managed instances](configuration.md#managed-instances) |
| `AI_MAX_OUTPUT_TOKENS` | `8192` | The maximum output tokens one request can ask for. | |
| `AI_RATE_LIMIT_PER_MINUTE` | `20` | The maximum requests one account can make in any 60 seconds. | |
| `AI_INSTANCE_DAILY_LIMIT` | unset, no limit | The limit for the whole instance, in AI requests per UTC day. | [The AI proxy](https://github.com/LowCarbCheck/openplate/blob/main/apps/core/README.md#the-ai-proxy-and-the-allowance-that-bounds-it) |
| `AI_MAX_REQUEST_BYTES` | `8000000` | The largest request the proxy accepts, in bytes. | |

### Consent

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `HEALTH_CONSENT_VERSION` | unset, no consent asked | The health data consent version every account must accept, such as `2026-09-28`. Use 1 to 32 letters, digits, `.`, `_` or `-`. A changed version asks everybody again. | [Explicit consent](https://github.com/LowCarbCheck/openplate/blob/main/apps/core/README.md#explicit-consent-to-health-data-when-you-run-an-instance-for-others) |

### Push

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `VAPID_PUBLIC_KEY` | unset, no notifications | The public key for web push. Set all three or none. Make a pair with `pnpm sync-api push keygen`. | |
| `VAPID_PRIVATE_KEY` | unset | The private key for web push. | |
| `VAPID_SUBJECT` | unset | How a push service reaches you: a `mailto:` address or an `https://` address. | |

### Plans

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `PLANS_UPSTREAM_URL` | unset, no plans | The internal address of the billing service that receives `/v1/plans/*`. Set it together with `PLANS_UPSTREAM_SECRET`. | [Paid plans](https://github.com/LowCarbCheck/openplate/blob/main/apps/core/README.md#paid-plans-and-what-the-plans-service-can-reach) |
| `PLANS_UPSTREAM_SECRET` | unset | The shared secret the billing service checks. | [Paid plans](https://github.com/LowCarbCheck/openplate/blob/main/apps/core/README.md#paid-plans-and-what-the-plans-service-can-reach) |
| `BILLING_TOKEN` | unset | The billing service's own credential, at least 24 characters. It reaches three admin routes and nothing else. | [Paid plans](https://github.com/LowCarbCheck/openplate/blob/main/apps/core/README.md#paid-plans-and-what-the-plans-service-can-reach) |

### Feedback, sharing and research

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `SYNC_FEEDBACK` | `false` | `true` accepts reported estimates with their photographs, kept for 30 days. You can view those photographs. | [Reported estimates](https://github.com/LowCarbCheck/openplate/blob/main/apps/core/README.md#reported-estimates-and-what-holding-one-costs-you) |
| `FEEDBACK_DAILY_LIMIT` | `5` | The reports one account can send per UTC day. | |
| `FEEDBACK_MAX_REQUEST_BYTES` | `8000000` | The largest report the service accepts, in bytes. | |
| `SYNC_SHARING` | `false` | `true` turns on sharing a diary with a clinician. | |
| `SYNC_RESEARCH` | `false` | `true` turns on research contributions and the study console. | [Sync](sync.md) |

### Logging and other

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. Any other value stops the boot. | |
| `SYNC_NOTICE` | unset | A short message every app shows when it connects, at most 280 characters. | |
| `SYNC_NOTICE_URL` | unset | A link next to the notice, `https://` or `http://`. It needs `SYNC_NOTICE`. | |
| `SERVICE_VERSION` | unset, the image's version | Replaces the version `/health` reports. Leave it unset. | |

## The inference service (openplate-inference)

The inference container, `ghcr.io/lowcarbcheck/openplate-inference`. It runs the model runtime and the service in one container. [openplate-inference's configuration guide](https://github.com/LowCarbCheck/openplate/blob/main/apps/inference/docs/configuration.md) explains the options in depth.

### Service and access

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `PORT` | `8300` | The port the service listens on. It is the only port the container publishes. | |
| `API_KEYS` | unset, a temporary key | The keys a caller must send, separated by commas. When unset, the service creates one key at start, prints it once, and forgets it at the next restart. | [Get the key](https://github.com/LowCarbCheck/openplate/blob/main/apps/inference/README.md#2-get-the-key) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. Any other value stops the boot. | |
| `PROFILE` | set from `MODEL_PROFILE` | The profile name the start-up log prints: `lite`, `quality` or `custom`. The container sets it from `MODEL_PROFILE`, and it changes nothing else. | |

### Model and weights

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `MODEL_PROFILE` | `lite` | The weights the container downloads and runs: `lite`, `lite-apache` or `quality`. `external` downloads nothing and uses your own runtime at `MODEL_RUNTIME_URL`. | [Hardware](https://github.com/LowCarbCheck/openplate/blob/main/apps/inference/docs/hardware.md) |
| `MODELS_DIR` | `/models` | Where the weights live in the container, on a volume. Change it only when you mount the weights elsewhere. | |
| `WEIGHTS_MIRROR_BASE` | unset | A mirror to download the weights from, with Hugging Face as the fallback. The service checks checksums either way. | |
| `MODEL_RUNTIME_URL` | `http://127.0.0.1:8080`, the bundled runtime | The address of your own runtime, without `/v1`. `MODEL_PROFILE=external` requires it. With any other profile, a different address stops the container. | [External-mode variables](https://github.com/LowCarbCheck/openplate/blob/main/apps/inference/docs/runtimes.md#external-mode-variables) |
| `MODEL_RUNTIME_API_KEY` | unset | A key the service sends to your runtime, for a runtime or proxy that requires one. | [External-mode variables](https://github.com/LowCarbCheck/openplate/blob/main/apps/inference/docs/runtimes.md#external-mode-variables) |
| `MODEL_ID` | `openplate-plate-1` | The model name the service sends to the runtime. vLLM needs its exact served name. | [External-mode variables](https://github.com/LowCarbCheck/openplate/blob/main/apps/inference/docs/runtimes.md#external-mode-variables) |
| `RUNTIME_PORT` | `8080` | The port of the bundled llama-server, on the container's loopback address only. | |
| `CONTEXT_SIZE` | `8192` | The context for each scan in flight. The container multiplies it by `CONCURRENCY` for llama.cpp. | |
| `LLAMA_THREADS` | the number of cores minus two, at least 1 | The CPU threads for llama.cpp. | |
| `LLAMA_EXTRA_ARGS` | unset | Extra flags for the end of the llama-server command, split at spaces. Bundled runtime only. | |
| `GPU_LAYERS` | detected: `99` with a GPU, otherwise `0` | How many model layers go to the GPU. `0` forces the CPU. | |
| `NVIDIA_VISIBLE_DEVICES` | set by the NVIDIA container runtime | `--gpus all` sets it. Any value other than `void` or `none` makes the container use the GPU. You do not set it yourself. | |

### Limits

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `CONCURRENCY` | `2` | The scans in flight at one time. It also sets llama.cpp's slots. | |
| `MAX_QUEUE_DEPTH` | `8` | The scans that can wait. Past this, a caller gets 429. | |
| `RATE_LIMIT_RPM` | `60` | The requests per minute for each key. | |
| `LATENCY_CEILING_MS` | `0`, off | The service refuses a scan it cannot finish in this many milliseconds. | [Hardware](https://github.com/LowCarbCheck/openplate/blob/main/apps/inference/docs/hardware.md#no-latency-ceiling-by-default) |
| `RUNTIME_COMPLETION_TIMEOUT_MS` | `600000` | The longest one call to the runtime can take, in milliseconds. `0` turns the limit off. | |
| `MAX_IMAGE_BYTES` | `8388608` | The largest photo the service accepts after decoding, in bytes (8 MiB). | |
| `IMAGE_MAX_LONG_EDGE` | `896` | The long edge the service scales each photo down to, in pixels, at least 112. | |

### Food data

| Variable | Default | What it does | More |
| --- | --- | --- | --- |
| `FOOD_SOURCE` | `fdc` | Where the macros come from: `fdc` (the USDA extract in the image, no network), `off` (Open Food Facts), `lcc` (LowCarbCheck) or `none`. | [Food data](https://github.com/LowCarbCheck/openplate/blob/main/apps/inference/docs/configuration.md#food-data-foodsource) |
| `FDC_DATASET_PATH` | `./data/fdc-foods.json` | The USDA extract, relative to the working directory. | |
| `OFF_API_URL` | `https://world.openfoodfacts.org` | The Open Food Facts address, read with `FOOD_SOURCE=off`. | |
| `LCC_API_URL` | `https://lowcarbcheck.org` | The LowCarbCheck address, read with `FOOD_SOURCE=lcc`. | |
| `LCC_API_KEY` | unset, the anonymous tier | Your LowCarbCheck key, read with `FOOD_SOURCE=lcc`. | |
| `EMBEDDING_RUNTIME_URL` | unset | An OpenAI-compatible runtime that serves `/v1/embeddings`, for better food matching. | |
| `EMBEDDING_RUNTIME_API_KEY` | unset | The key for that runtime. | |

## Settings that stop the boot

A container that does not start is easy to notice, and it costs one restart. A setting that is quietly ignored lets you believe something works when it does not. So each rule below stops the boot, and the log names the variable.

### Refused names

These names were settings once. Now the service refuses to start while one is set, and says what to use instead. The sync service refuses them even with an empty value, so delete the line. The app refuses `GATEWAY_URL` only when it has a value.

| Variable | Refused by | Use instead |
| --- | --- | --- |
| `GATEWAY_URL` | the app | `INSTANCE_MODE=managed`. The sync service took over the AI proxy. |
| `SIGNUP_MODE` | the sync service | Nothing. Accounts come from invitations, and `OPEN_SIGNUP=true` lets people ask for one. |
| `SIGNUPS_OPEN` | the sync service | Nothing, for the same reason. |
| `REQUIRE_EMAIL_VERIFICATION` | the sync service | Nothing. The invitation is the address check. |
| `EMAIL_FROM` | the sync service | `MAIL_API_FROM`, or `SMTP_FROM`. |
| `SMTP_SECURE` | the sync service | Nothing. `SMTP_PORT` decides the encryption. |
| `PIGEON_API_KEY` | the sync service | `MAIL_API_KEY`, or `SMTP_USER` and `SMTP_PASSWORD`. |
| `PIGEON_BASE_URL` | the sync service | `MAIL_API_URL`, or `SMTP_HOST`. |

### Rules between variables

**The app.**

- `MATOMO_URL` and `MATOMO_SITE_ID`: set both or neither. `MATOMO_EVENT_LEVEL` needs both.
- `NEWSLETTER_SUBSCRIBE_URL` and `NEWSLETTER_TURNSTILE_SITE_KEY`: set both or neither.
- `INSTANCE_MODE=managed` needs `SYNC_SERVER_URL`.
- `APP_URL` is required when `NODE_ENV=production`.
- `MOVED_TO_URL` must be an `https://` address on a host other than `APP_URL`, without a user name or password.
- A value outside its list stops the boot: `DEFAULT_UI_LANGUAGE`, `NUTRIENT_REFERENCE_BASIS`, `INSTANCE_MODE`, `MATOMO_EVENT_LEVEL` and `FOOD_DB_BACKFILL`. Malformed addresses in `SYNC_SERVER_URL`, `DEFAULT_INFERENCE_BASE_URL`, `MATOMO_URL` or `NEWSLETTER_SUBSCRIBE_URL` also stop the boot. Boot also stops if `MATOMO_SITE_ID` is not a positive whole number, or if `CONTENT_DIR` is not a folder.

**The sync service.**

- `DATABASE_URL` and `SERVER_SECRET` are required.
- Minimum lengths: 32 characters for `SERVER_SECRET` and `TRIAL_ADDRESS_PEPPER`, 24 for `ADMIN_TOKEN` and `BILLING_TOKEN`.
- Mail uses one transport. The HTTP mail API needs `MAIL_API_URL`, `MAIL_API_KEY`, `MAIL_API_FROM` and `MAIL_OPERATOR_EMAIL`, all four. SMTP needs `SMTP_HOST`, `SMTP_FROM` and `MAIL_OPERATOR_EMAIL`, and `SMTP_USER` and `SMTP_PASSWORD` go together. Variables of both transports at once stop the boot, and so does `MAIL_OPERATOR_EMAIL` with no transport.
- Mail needs `SERVER_PUBLIC_URL` and `CLIENT_BASE_URL`. With `NODE_ENV=production`, both must be `https://` addresses on another host, not `localhost`.
- Set both or neither: `UPSTREAM_BASE_URL` and `UPSTREAM_API_KEY`; `PLANS_UPSTREAM_URL` and `PLANS_UPSTREAM_SECRET`; `TURNSTILE_SECRET_KEY` and `TURNSTILE_SITE_KEY`; `MEMBER_INVITE_DAILY_AI_LIMIT` and `MEMBER_INVITE_ALLOWANCE_DAYS`; `TRIAL_SCANS` and `TRIAL_DAILY_AI_LIMIT`.
- Set all three or none: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.
- X requires Y: `OPEN_SIGNUP=true` requires mail. The Turnstile pair requires `OPEN_SIGNUP=true`. `MEMBER_INVITE_LIFETIME_CAP` requires the member-invite pair or `MEMBER_INVITE_TRIAL=true`. `MEMBER_INVITE_TRIAL=true` requires the trial pair and refuses the member-invite pair. The trial pair requires `TRIAL_ADDRESS_PEPPER`. `TRIAL_DAYS` and `AI_TRIAL_INSTANCE_DAILY_LIMIT` require the trial pair. `TRIAL_TIME_ZONE` requires `TRIAL_DAYS`. `SYNC_NOTICE_URL` requires `SYNC_NOTICE`.
- Zero is refused where it would read as "off" and mean the opposite: `AI_INSTANCE_DAILY_LIMIT`, `AI_TRIAL_INSTANCE_DAILY_LIMIT`, `TRIAL_SCANS`, `TRIAL_DAILY_AI_LIMIT`, `TRIAL_DAYS`, `MEMBER_INVITE_DAILY_AI_LIMIT` and `MEMBER_INVITE_ALLOWANCE_DAYS`. Every other number must be positive too, except two that accept `0`: `TRUST_PROXY`, and `MEMBER_INVITE_LIFETIME_CAP`, where `0` leaves members nothing to send.
- Upper limits: `TRIAL_SCANS` 100, `TRIAL_DAYS` 90, `TRIAL_DAILY_AI_LIMIT` and `MEMBER_INVITE_DAILY_AI_LIMIT` 10000, `SYNC_NOTICE` 280 characters, `INSTANCE_NAME` 64 characters.
- `SYNC_SHARING`, `SYNC_RESEARCH`, `SYNC_FEEDBACK`, `DATABASE_SSL` and `MEMBER_INVITE_TRIAL` accept `true`, `false`, `1` or `0`. `OPEN_SIGNUP` accepts only `true`.
- A value outside its list stops the boot: `INSTANCE_LANGUAGE`, `NUTRIENT_REFERENCE_BASIS`, `LOG_LEVEL`, `TRIAL_TIME_ZONE` and `HEALTH_CONSENT_VERSION`. A `VAPID_SUBJECT` that is not `mailto:` or `https:` stops the boot. So does an `SMTP_HOST` with a scheme, port or path. Malformed addresses in `SERVER_PUBLIC_URL`, `CLIENT_BASE_URL`, `UPSTREAM_BASE_URL`, `PLANS_UPSTREAM_URL` or `SYNC_NOTICE_URL` also stop the boot.

**The inference service.**

- `MODEL_PROFILE=external` requires `MODEL_RUNTIME_URL`. With any other profile, a `MODEL_RUNTIME_URL` other than the bundled address stops the container.
- A `MODEL_PROFILE`, `FOOD_SOURCE`, `PROFILE` or `LOG_LEVEL` outside its list stops the boot. A `MODEL_RUNTIME_URL` or `EMBEDDING_RUNTIME_URL` that is not an `http://` or `https://` address also stops the boot.
- Counts and sizes must be positive whole numbers. `LATENCY_CEILING_MS` and `RUNTIME_COMPLETION_TIMEOUT_MS` also accept `0`. `IMAGE_MAX_LONG_EDGE` must be at least 112, and `PORT` at most 65535.

## Sign-up with Turnstile

By default an account comes only from an invitation. Set `OPEN_SIGNUP=true` on the sync service, and anybody can ask for an account with their own address. The service then mails that address an invitation, and the letter proves the address works. So open sign-up needs mail, and the service does not start without it. The app shows the sign-up form only when the sync service says its door is open.

A captcha stops scripts from flooding the service with requests. The sync service checks a Cloudflare Turnstile captcha when you configure two keys:

1. Sign in to the Cloudflare dashboard, open **Turnstile**, and choose **Add widget**. A free account is sufficient. Your domain does not have to use Cloudflare.
2. Give the widget a name, add the host name of your app, such as `openplate.example.com`, and keep the mode **Managed**. Choose **Create**.
3. Set the site key in `TURNSTILE_SITE_KEY` and the secret key in `TURNSTILE_SECRET_KEY` on the sync service. Set both keys or neither.
4. Recreate the sync service, for example with `docker compose -f <your file> up -d`.

`/health` then publishes the site key. The app's sign-up page shows the captcha. Its submit button stays inactive until the user solves it. The secret key never leaves the sync service. The service sends Cloudflare the captcha response and the secret key, not the visitor's address.

The service checks only the sign-up request, `POST /v1/auth/signup-request`. Signing in, opening an invitation, and all other routes carry no captcha. When the service cannot reach Cloudflare, it returns `503`, and the person can try again later. The check fails closed, so an unanswered request never passes.

The app's Content-Security-Policy allows Cloudflare's captcha only on a managed instance (`INSTANCE_MODE=managed`), or when the newsletter form is on. On other instances, the browser blocks the captcha and nobody can submit the form. Set the app to managed before you turn the captcha on.

Without the two keys, open sign-up still works. Its other limits still apply. The service allows five requests an hour from one address, and one letter a day for one mailbox. It blocks addresses from known throwaway mail services. The service logs a warning at start.

`NEWSLETTER_TURNSTILE_SITE_KEY` is a separate setting. It belongs to the app and protects the newsletter form on the landing page. Its secret key stays with the service that receives that form, not with openplate. [Newsletter sign-up](configuration.md#newsletter-sign-up) explains it.

## Building an image yourself

The Dockerfiles accept several build arguments. They are not settings for a running container. `OPENPLATE_BUILD_SHA` stamps the commit into the app's bundle. The inference image takes `BASE_IMAGE`, the llama.cpp server image to build on. It also takes `NODE_IMAGE`, the Node.js image for the build. `VITE_ALLOWED_HOSTS` applies only to the app's development server and has no default hosts.
