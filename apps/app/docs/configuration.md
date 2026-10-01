# Configuration

openplate boots with nothing configured. There is no database URL, no session key and no
encryption key, because the server keeps no accounts and stores nothing. Every variable
is optional tuning.

Most variables are read in one place, `app/config/index.ts`, and exposed as a typed `CONFIG`
object:

```typescript
import { CONFIG } from '#config';

const port = CONFIG.server.port;
const appUrl = CONFIG.app.url;
```

`.env.example` carries the full list with inline notes. Copy it to `.env` to change one.

## Environment variables

[environment-variables.md](environment-variables.md#the-app) lists every variable the app
reads, with its default. It also lists the variables for the core server and the inference
service. The sections below explain the larger features in depth.

One variable has no section of its own. `DEFAULT_UI_LANGUAGE` sets the language a visitor
sees before choosing one: `en`, the default, `de`, `fr`, `it`, `es` or `tr`. A person's own
choice always wins. The setting translates no food name, no AI answer, and nothing a person
typed. Any other value stops the boot.

Provider API keys are never read from the environment. A user's key is entered in the
browser, stored on the device and sent browser → provider directly; the server has no copy.
`MISTRAL_API_KEY` / `OPENROUTER_API_KEY` in `.env.example` exist only so a developer can
point verification scripts at a live provider. Setting them on a deployed instance does
nothing.

## The food database key

`FOOD_DB_API_URL` and `FOOD_DB_API_KEY` are two different decisions and it helps to keep
them apart.

The URL decides **whether** this instance looks foods up at all. Set it to an empty string
and no food name ever leaves your machine.

The key decides **how much** you may look up. There are three tiers:

| tier | what you do | what you get |
| --- | --- | --- |
| anonymous | nothing | a small daily allowance, shared per network address |
| free | give an email address at [lowcarbcheck.org/developers](https://lowcarbcheck.org/developers) | a generous monthly allowance |
| partner | ask | no monthly cap |

LowCarbCheck counts in credits, and one food search costs one. At the time of writing the
anonymous tier is 1,000 credits a day and the free key 100,000 a month;
[lowcarbcheck.org/developers](https://lowcarbcheck.org/developers) has the current numbers.
LowCarbCheck sees the address of your app server, not the addresses of its users. On the
anonymous tier, everyone on your instance shares one daily allowance.

An instance with no key keeps working. It is the anonymous tier, and for one person trying
openplate out it is usually enough. A household, or anything that scans several plates a
day, wants the free key.

`FOOD_DB_DAILY_CALL_LIMIT` caps how many LowCarbCheck calls this server makes in one UTC
day. The default, 3,200, keeps a month inside the free key's 100,000. A name someone searched
in the last five minutes is answered from memory and costs nothing. Past the limit, food
lookups pause until midnight UTC, the app says so, and scans still complete with the AI's own
numbers. Raise it if your key allows more. The count lives in memory, so a restart starts it
again.

On a managed instance, a food lookup also needs a signed-in account. The app sends the
account's session with each lookup, and the app server asks the core server at
`CORE_URL` whether the session is live before anything reaches LowCarbCheck. The app
server must therefore reach that address as well. If it cannot, lookups are refused until it
can, and scans still complete with the AI's own numbers. An open instance answers every
lookup, as before.

The lookup is fail-open either way: if the food database is unreachable, refused or out of
allowance, a scan still completes and still shows numbers. Those numbers are then the AI's
own estimate rather than a database figure, and the app says so on screen rather than
letting the difference pass unnoticed.

## Proposals to the food database

With `FOOD_DB_BACKFILL=true` and a key, openplate passes each food a person saves from a
photo or a typed meal on to LowCarbCheck, through this server:

- A food the person matched to a LowCarbCheck row sends the food's names in every app
  language, so the row gains the titles it lacks.
- A food with no match sends its names in every app language and its macros per 100 g, so
  LowCarbCheck can add it. It needs an English name and all four of carbs, fat, protein and
  energy. A food without them is not sent.
- A name the person typed or changed themselves is never sent.

A proposal carries the names, the macros, and whether the food came from a photo or a typed
meal. It carries no account, no diary entry, no photo, and no address of the person.
LowCarbCheck sees your server and your key. LowCarbCheck judges each proposal with a model
when it arrives and publishes what passes. A food published this way comes back from the
food database marked as an estimate, and openplate shows and stores it as one, never as a
curated source.

Each person can switch it off for their device in **Settings → AI**. It is off on every
instance until the operator sets `FOOD_DB_BACKFILL=true`.

## Newsletter sign-up

openplate ships with no mailing list. Set both `NEWSLETTER_SUBSCRIBE_URL` and
`NEWSLETTER_TURNSTILE_SITE_KEY` and the landing page adds a sign-up form. The browser posts it
to the openplate server, which forwards `{email, locale, consent, source, turnstileToken}` to
your URL, at most five requests a minute from one address. The browser never learns that URL,
so it can sit on a private network. Set one without the other and the boot stops. Leave both
unset, the default, and there is no form, no extra script and no change to the CSP.

## The release check

Every six hours the server asks `api.github.com` for the tag list of the openplate
repository, compares the newest `vX.Y.Z` with the version it is running, and reports the
answer at **Settings > About**. There is also a "Check now" button, which is limited to one
real request a minute across the whole instance.

The request is made by the **server**, not by the browser, and that is the point: adding
`api.github.com` to the production `connect-src` would widen the one allowlist that stops an
injected script exfiltrating a BYOK key. It carries no token, no instance identifier and no
version number, so GitHub sees an IP address and a default user agent and nothing else. See
[ADR-0012](../.adr/0012-the-server-asks-github-about-releases.md).

```bash
UPDATE_CHECK=off
```

turns it off completely: no timer is started, no request is ever made, and the About page
says checks are disabled.

The check only ever **reports**. openplate is a single stateless container and cannot replace
its own image, so upgrading stays what it always was:

```bash
docker compose -f compose.yml pull && docker compose -f compose.yml up -d
```

The one button in the app that does change something is "Reload to update", which appears
when the server is already serving a newer build than the open page is running. That reloads
the browser onto assets the server has, and touches nothing on the host.

## Moving people to another instance

When you close an instance and its users move to another one, keep the old container running
with one setting:

```bash
MOVED_TO_URL=https://app.openplate.example
```

Every route on the old instance then serves a single notice page. It states where openplate
is now, provides a button to the sign-in page there, and tells people who added the app to
their home screen to remove that icon and add the new address. The page chooses its language
in this order: the user's saved choice, the languages requested by the browser, then
`DEFAULT_UI_LANGUAGE`.

The page tells users that their account and diary moved with them. Enable this mode only when
that is true: the new instance uses the same core server, or you migrated the accounts
there. A diary stored only in one browser stays in that browser under the old address; the
new address cannot read it.

An HTTP redirect cannot handle this migration. A phone with the installed app runs a service
worker that caches application pages. Browsers do not follow redirects when checking that
worker for updates, so an installed app would keep opening its saved copy. In this mode,
`/sw.js` serves a small worker that deletes every cache under the old address, unregisters
itself, and reloads the page. The next request then loads the notice directly from the
server. The worker leaves diary data stored in the browser untouched.

The API returns `410 Gone` with the new address in the response body. `/healthcheck` answers
as before, and the web app manifest stays unchanged, so a home-screen icon still opens the
old address and loads the page. Keep this mode running until traffic to the old address
stops. The value must be an `https://` address on a host other than `APP_URL`, without a user
name or password; anything else stops the boot.

## The Content-Security-Policy

The BYOK vision call and the key both live entirely in the browser, so the production build
ships a strict Content-Security-Policy. Its `connect-src` allows:

- `'self'`
- the built-in providers' own origins (OpenRouter, Mistral, Anthropic), derived automatically
  from the provider registry: see [ADR-0007](../.adr/0007-byok-provider-registry.md)
- `localhost` and `127.0.0.1` on any port. `[::1]` is not on the list, because a CSP source
  cannot name an IPv6 address; point a client at `localhost` instead.
- your `CORE_URL` and `DEFAULT_INFERENCE_BASE_URL`, if set
- anything in `CSP_CONNECT_EXTRA`

That allowlist is what stops an injected script from exfiltrating a key that lives in the
page. Widen it deliberately.

On a managed instance the AI proxy is the core server the client already talks to, so its
origin is `CORE_URL`, already in the list above. There is no second remote endpoint to
allow and nothing extra to add to `CSP_CONNECT_EXTRA` for it.

## Analytics

openplate can count how it is used. It counts nothing until you configure it, and it never
counts what you eat.

Set `MATOMO_URL` and `MATOMO_SITE_ID` to point an instance at a [Matomo](https://matomo.org)
install you run yourself. Leave both unset, which is the default, and the instance loads no
analytics script, sends no request, and serves the same Content-Security-Policy header it
served before analytics existed. Set one without the other and the boot fails on purpose: an
operator who believes they have analytics and does not is worse off than one who sees an
error.

The tracker runs with cookies disabled. It stores nothing on the device, so there is no
consent banner to build.

### What a level decides

`MATOMO_EVENT_LEVEL` decides how much the instance is allowed to report. It applies only
when analytics are already on.

| Level | What it counts |
| ----------- | ------------------------------------------------------------------------------- |
| `pageviews` | Page views only. No feature event ever fires. |
| `product`   | Page views plus software use. The default. |
| `research`  | Everything, including fasting, weight, clinician sharing and study participation. |

Unset means `product`. An unrecognised value stops the boot. A level set on an instance with
no Matomo configured also stops the boot, for the same reason a half-configured pair does.

### What `product` counts

36 events, all of them about the software rather than about the person.

| Area | Events |
| ------------ | ------------------------------------------------------------------------------------ |
| Onboarding   | completed, step completed (focus, weight, body), step skipped |
| Scan         | succeeded, failed (with a fixed failure category), found nothing, mode chosen, started from a shared photo |
| Diary        | logged (with the input path: search, manual, plate scan, label scan, chip, copy day, log again, saved meal), entry edited, entry deleted, entry restored, meal saved |
| Custom foods | edited, deleted |
| AI provider  | connected (manual, OAuth, instance preset), key check failed, disconnected |
| Preferences  | changed (theme or language) |
| Backup       | exported, imported, CSV exported, photo cache cleared |
| Account      | created, deleted, password changed, password reset requested, password reset completed, setup completed |
| Invitations  | link pasted, join completed |
| App install  | install prompt shown, installed, offline page view |
| Landing page | newsletter subscribed, call to action clicked |

### What `research` adds

12 more events. Each one says something about a person's health or their participation in a
study, which is why they are off unless you ask for them.

| Area              | Events |
| ----------------- | -------------------------------------------------------------- |
| Fasting           | fast started (now or scheduled), fast ended |
| Goals and weight  | goals saved (targets or body metrics), weight logged |
| Clinician sharing | share granted, revoked, key rotated, identity created, shared diary opened |
| Research studies  | enrolled, withdrawn, contribution sent |

These carry no values. A fast event does not carry its length, and a weight event does not
carry a weight. But the events are timestamped, as every analytics event is, so a start and
an end together give a duration by subtraction, and a share event says the person has a
clinician. Study participation is special-category data under Art. 9 GDPR.

That is the whole reason the level exists. A researcher running a study on their own
instance needs these numbers and can lawfully collect them from consenting participants. A
general-purpose instance should not collect them, and by default does not.

If you turn on `research`, say so in your own privacy policy. openplate's policy describes
openplate's hosted instances, not yours.

### What is never counted, at any level

- Anything from a diary. No food name, no weight, no goal, no photo, no meal time, no study
  id.
- Any number measured off a person. Events carry a fixed label or nothing at all.
- Any identifier. No account id, no email address, no device id.
- Query strings and URL fragments, which are dropped whole before a page view is reported.
  openplate puts single-use tokens there.
- Identifiers in a path. `/diary/entry/<id>` and `/shared/<account id>` are replaced with a
  placeholder before the page view is reported.

The rules are enforced by types rather than by review. Every event function in
`app/lib/matomo-events.ts` takes either nothing or one value from a fixed list, so a food
name cannot be passed without a compile error. `tests/unit/no-telemetry-wiring.test.ts`
fails the build if any other file reaches for the tracker directly, or if a Matomo host or
site id is written into the source, which is what would make a self-hosted instance report
into somebody else's account.

See [ADR-0010](../.adr/0010-hosted-analytics.md) for the decision and its reasoning.

## Managed instances

An instance that sets `INSTANCE_MODE=managed` is a **managed instance**: an administrator
invites people by email, and each account carries a daily AI allowance, so signing in gives a
person both the diary and the AI in one step. The hosted instances at beta.openplate.de and
app.openplate.de use this mode. It is off by default: a self-hoster who sets nothing gets the
open app.

`INSTANCE_MODE=managed` requires `CORE_URL`. The account is what carries the diary and
the allowance together; declaring `managed` without a core server stops the boot rather than
half-enabling anything.

An administrator invites people from the app itself, at `/admin`, or with openplate-core's
admin API and `ADMIN_TOKEN`. The very first account, before any administrator exists, comes
from that API. [self-hosting.md](self-hosting.md#create-the-first-account) has the command.
With mail configured on the core server, the invitation is mailed. With no mail configured, the answer
carries the link and you pass it on. A forgotten password is reset by a link. That link is mailed or, with
no mail, made by an administrator (see
[self-hosting.md](self-hosting.md#when-someone-forgets-their-password)). The server holds an
escrowed recovery code that unwraps the data key after the reset (see
[sync.md](sync.md#encryption-and-what-the-operator-holds)).

A managed instance with AI needs three values on the core server as well: `UPSTREAM_BASE_URL`
and `UPSTREAM_API_KEY` (the provider and its key) and `AI_ADVERTISED_MODEL`, the model every
scan uses. **`AI_ADVERTISED_MODEL` is required for scans.** Without it, the core server
reports no model, and the app refuses to scan rather than pick a model on your bill. Name the
model the way your provider does, for example `google/gemini-3.5-flash-lite` with
`UPSTREAM_BASE_URL=https://openrouter.ai/api/v1`, or `openplate-plate-1` in front of
openplate-inference. Each account then needs a daily allowance,
which starts at 0. Give it with `"dailyAiLimit"` when you mint the invitation, or set it later in
`/admin`.

What changes when it is set:

- `/welcome` offers exactly two actions: **Sign in**, and **I have an invite link** (which takes a
  pasted link and hands it to `/join`). There is no "Start".
- `/onboarding` redirects to `/welcome` for a device with neither a local diary nor an account. The
  anonymous local-only path is closed, not merely hidden: on a managed instance it leads nowhere,
  because there is no AI without an account and no diary that survives the device without one.
  A device that already holds a diary is never thrown out.
- `/join` runs one ceremony: the invite is redeemed by the signup request itself, in one
  transaction, and the account carries both the diary and the allowance from that point on.
  The "Skip, I already have an account" action is gone, because on such an instance the person
  offered it has neither.
- **Settings → Account**, signed out, offers signing in and says that accounts here come from an invite
  link. There is no "create an account" button.

Everything above is unchanged on an open instance (`INSTANCE_MODE` unset or `open`), and a test
pins both variants side by side.

### Member invites

On a managed instance, an administrator is not the only person who can invite. Three
openplate-core variables decide whether an ordinary member may invite someone, and on what terms.
They are set on the core server, not on the app. `compose.core.yml` and `compose.full.yml`
pass all three from `.env` to the core server.

| Variable                       | Default                | Description                                                                                                                    |
| ------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `MEMBER_INVITE_DAILY_AI_LIMIT` | unset (invites off)    | How many AI requests per UTC day the invited account gets. Set this and `MEMBER_INVITE_ALLOWANCE_DAYS`, or neither.              |
| `MEMBER_INVITE_ALLOWANCE_DAYS` | unset (invites off)    | How many days after signup that allowance lasts. Set this and `MEMBER_INVITE_DAILY_AI_LIMIT`, or neither.                        |
| `MEMBER_INVITE_LIFETIME_CAP`   | `5`                    | How many invitations one member may send in total, ever. An integer of 0 or more. Needs the two above to be set.                 |

**The first two are both or neither.** Setting one alone stops the boot and names the one you
left out. With neither set, which is the default, members cannot invite anybody and
`POST /v1/auth/invites` answers 404 to everyone. You then mint every invitation yourself.

**What an invitation grants is the trial.** The invited person gets their own account and their
own diary, plus `MEMBER_INVITE_DAILY_AI_LIMIT` AI requests per day for
`MEMBER_INVITE_ALLOWANCE_DAYS` days after they sign up. When the window closes, the AI proxy
answers 403. Their diary keeps working. Sync is never gated on an allowance. The inviter chooses
none of this. They send an address and nothing else.

**The cap counts letters, not successes.** Withdrawing an invitation does not give it back. The
count is per account, not per instance. `MEMBER_INVITE_LIFETIME_CAP=0` leaves the route mounted
and gives every member nothing to spend. That is different from unsetting the pair and taking the
route away. Read the cap together with `AI_INSTANCE_DAILY_LIMIT`. The daily allowance above is
multiplied by every member on the instance times the cap before it reaches your provider bill.

**Administrators are exempt.** The cap does not apply to them, and neither does the rule that an
address which already spent a member invitation gets no second one. They invite from `/admin` as
often as they like.

A member sees how many invitations they have left in the app. It is in **Settings, Account**,
under **Invite somebody**. That section only appears on an instance where the feature is on.

## Custom AI endpoints

[openplate-inference](https://github.com/LowCarbCheck/openplate/tree/main/apps/inference) is a self-hosted,
OpenAI-compatible plate-photo endpoint you run on your own hardware with open-weight models,
so nobody needs a cloud AI key at all. It, Ollama, vLLM, LM Studio, or anything else speaking
the OpenAI chat-completions protocol all connect the same way: in **Settings → AI**, add an
`openai-compatible` provider and give it your base URL.

- **A local endpoint on the same box** (`http://localhost:11434/v1` and friends) needs no
  configuration: the loopback carve-out already covers it.
- **A remote endpoint** (another box on your LAN, or an inference server you host) is blocked
  by the CSP by default. Add its origin and restart the app:

  ```bash
  echo "CSP_CONNECT_EXTRA=https://ai.example.com" >> .env
  docker compose -f compose.yml up -d
  ```

- **`api.openai.com` is never reachable from a browser**: OpenAI's API blocks cross-origin
  requests. Route OpenAI models through OpenRouter instead, regardless of
  `CSP_CONNECT_EXTRA`.

### Instance-provided AI

Instead of asking every visitor to bring a key, an instance can offer its own endpoint.

**Before you set `DEFAULT_INFERENCE_API_KEY`, know that it is public**: it is embedded in the
page HTML and readable with view-source by anyone who can open the app. The full rule is the
second bullet below. Read it first.

Set `DEFAULT_INFERENCE_BASE_URL` (plus `DEFAULT_INFERENCE_MODEL`, and `DEFAULT_INFERENCE_API_KEY`
if the endpoint needs one) and the AI settings page and the scan screen grow a one-tap
"this openplate provides its own AI" connect. Leave it unset and bring-your-own-key is the
only path; nothing extra renders and nothing extra is sent to the browser.

Three rules:

- **It must be an address a BROWSER can reach.** The photo goes device → endpoint, never
  through the openplate server, so a compose hostname like `http://openplate-inference:8080/v1`
  does not work. Publish the endpoint or put it behind your reverse proxy. Its origin is added
  to the CSP for you.
- **`DEFAULT_INFERENCE_MODEL` must name a model your endpoint actually serves.** The default,
  `openplate-plate-1`, is the id openplate-inference serves, and it is sent verbatim. Point
  the base URL at Ollama, vLLM or LM Studio instead and you must set this to that runtime's own
  served name, or every request fails.
- **`DEFAULT_INFERENCE_API_KEY` is public.** It is not kept on the server: it is embedded in
  the page HTML and readable with view-source by anyone who can open the app. That is fine for
  an endpoint only your household or tailnet can reach. It is **not** fine for a metered cloud
  provider key, and not fine on an instance exposed to the open internet without a VPN, tailnet
  or auth proxy in front of it. If your endpoint needs no key, leave it unset.

A malformed `DEFAULT_INFERENCE_BASE_URL` fails the boot deliberately, so a typo cannot look
like "the button just never appeared".

This instance preset (`connectedVia: 'preset'`) is set by this instance's own operator for
every visitor. `connectedVia: 'invite'` is a related, now-legacy value: it marked an AI
settings row handed out by the old openplate-gateway invite flow, retired in M192. A managed
instance no longer writes that row at all: the account itself carries the allowance, and the
AI proxy is reached through `CORE_URL`, not a separate settings entry.

## Connecting with OpenRouter

**Settings → AI → Connect with OpenRouter** is a one-click, browser-only OAuth flow (PKCE):
no key to copy-paste. It takes this tab to OpenRouter's consent screen and back; approve it,
and the issued key lands directly in this browser's local storage. The openplate server is never in
that loop: it never sees, stores, or proxies the key.

- **Set a spending cap while you are there.** OpenRouter's consent screen offers a
  self-service credit cap (optional, with a reset interval) next to the account picker. It
  bounds what the connected key can ever spend, independent of anything openplate does.
- **The default model is `google/gemini-3.5-flash-lite`**, a paid model, roughly **$0.001
  per scan**. It was chosen over any `:free` model because OpenRouter's `:free` endpoints only
  become reachable after you enable that provider's account-level "may train on request data"
  / "may publish prompts" toggles, and some free vision models retain prompts for weeks. You
  can still pick a `:free` model yourself from the model list, an explicit, disclosed opt-in.
- **Manual key entry works for every provider**, OpenRouter included, via the "paste an API
  key manually" panel.
- The connected key appears in your [OpenRouter key settings](https://openrouter.ai/settings/keys)
  labeled **"An app"**. Disconnecting in openplate only clears the key from that device: it
  does **not** revoke it at OpenRouter. Revoke it from that page yourself.
- Same guarantee as any other key: stored only in the device's local storage, excluded from
  the JSON backup/export, never sent to the openplate server.

**It works from any secure origin.** The OAuth callback URL is derived at request time from
`window.location.origin`. It is never hardcoded and never pre-registered with OpenRouter. The button
works without changes on `http://localhost:3000` or on your own `https://` domain. On a plain
`http://` LAN address it fails, because it hashes its one-time code with the Web Crypto API,
which browsers disable there. Paste a key by hand instead, or see
[self-hosting.md](self-hosting.md#https).

One note if you self-host behind a reverse proxy that logs request URLs: the callback URL
(including its one-time `state` parameter) will appear in your access logs like any other
URL. It is not a secret (knowing it grants access to nobody's key), but scrub it if your log
retention is a concern.
