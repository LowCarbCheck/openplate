# Configuration

openplate boots with nothing configured. There is no database URL, no session key and no
encryption key, because the server keeps no accounts and stores nothing. Every variable
below is optional tuning.

All variables are read in one place, `app/config/index.ts`, and exposed as a typed `CONFIG`
object:

```typescript
import { CONFIG } from '#config';

const port = CONFIG.server.port;
const appUrl = CONFIG.app.url;
```

`.env.example` carries the full list with inline notes. Copy it to `.env` to change one.

## Environment variables

| Variable                    | Default                     | Description                                                                                                                                                                                    |
| --------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | `development`               | Standard Node environment flag.                                                                                                                                                                |
| `PORT`                      | `3000`                      | HTTP port the app listens on.                                                                                                                                                                  |
| `HMR_PORT`                  | `24678`                     | Vite HMR port in dev.                                                                                                                                                                          |
| `LOG_LEVEL`                 | `info`                      | pino log level.                                                                                                                                                                                |
| `APP_URL`                   | `http://localhost:3000`     | Public URL this instance is reachable at. Required in production — the server refuses to boot without it. Behind a reverse proxy this is the public `https://` address, not the container port. |
| `TRUST_PROXY`               | `1` in prod, off in dev     | Express `trust proxy`. Required behind a proxy: React Router's CSRF check compares the browser `Origin` against the host it thinks it is serving. Use the hop count (1 = one proxy, 2 = Cloudflare → Traefik). |
| `VITE_ALLOWED_HOSTS`        | unset                       | Dev only. Comma-separated extra hostnames Vite should accept (for example your tailnet MagicDNS name).                                                                                          |
| `FOOD_DB_API_URL`           | `https://lowcarbcheck.org`  | Curated nutrition data and food images for identified foods. Only food **names** are sent — never photos, never anything about you — and the lookup fails open. Set to an empty string to disable it entirely. |
| `SYNC_SERVER_URL`           | unset (sync off)            | Base URL of an [openplate-sync](https://github.com/LowCarbCheck/openplate-sync) service. See [sync.md](sync.md). Its origin is added to the production CSP automatically. A malformed value stops the boot on purpose. |
| `DEFAULT_INFERENCE_BASE_URL`| unset                       | An OpenAI-compatible vision endpoint this instance offers to every visitor. See [Instance-provided AI](#instance-provided-ai) below.                                                            |
| `DEFAULT_INFERENCE_API_KEY` | unset                       | Optional key for that endpoint. **Read the security warning below before setting it.**                                                                                                         |
| `DEFAULT_INFERENCE_MODEL`   | unset                       | Model name to request from that endpoint.                                                                                                                                                      |
| `CSP_CONNECT_EXTRA`         | unset                       | Space-separated extra origins for the production CSP's `connect-src`. Needed when your own AI endpoint is a **remote** host. See [Custom AI endpoints](#custom-ai-endpoints).                    |

Provider API keys are never read from the environment. A user's key is entered in the
browser, stored on the device and sent browser → provider directly; the server has no copy.
`MISTRAL_API_KEY` / `OPENROUTER_API_KEY` in `.env.example` exist only so a developer can
point verification scripts at a live provider. Setting them on a deployed instance does
nothing.

## The Content-Security-Policy

The BYOK vision call and the key both live entirely in the browser, so the production build
ships a strict Content-Security-Policy. Its `connect-src` allows:

- `'self'`
- the built-in providers' own origins (OpenRouter, Mistral, Anthropic), derived automatically
  from the provider registry — see [ADR-0007](../.adr/0007-byok-provider-registry.md)
- `localhost`, `127.0.0.1` and `[::1]` on any port
- your `SYNC_SERVER_URL` and `DEFAULT_INFERENCE_BASE_URL`, if set
- anything in `CSP_CONNECT_EXTRA`

That allowlist is what stops an injected script from exfiltrating a key that lives in the
page. Widen it deliberately.

## Custom AI endpoints

[openplate-inference](https://github.com/LowCarbCheck/openplate-inference) is a self-hosted,
OpenAI-compatible plate-photo endpoint you run on your own hardware with open-weight models,
so nobody needs a cloud AI key at all. It, Ollama, vLLM, LM Studio, or anything else speaking
the OpenAI chat-completions protocol all connect the same way: in **Settings → AI**, add an
`openai-compatible` provider and give it your base URL.

- **A local endpoint on the same box** (`http://localhost:11434/v1` and friends) needs no
  configuration — the loopback carve-out already covers it.
- **A remote endpoint** (another box on your LAN, or an inference server you host) is blocked
  by the CSP by default. Add its origin and restart the app:

  ```bash
  echo "CSP_CONNECT_EXTRA=https://ai.example.com" >> .env
  docker compose up -d
  ```

- **`api.openai.com` is never reachable from a browser** — OpenAI's API blocks cross-origin
  requests. Route OpenAI models through OpenRouter instead, regardless of
  `CSP_CONNECT_EXTRA`.

### Instance-provided AI

Instead of asking every visitor to bring a key, an instance can offer its own endpoint. Set
`DEFAULT_INFERENCE_BASE_URL` (plus `DEFAULT_INFERENCE_MODEL`, and `DEFAULT_INFERENCE_API_KEY`
if the endpoint needs one) and the AI settings page and the scan screen grow a one-tap
"this openplate provides its own AI" connect. Leave it unset and bring-your-own-key is the
only path; nothing extra renders and nothing extra is sent to the browser.

Two rules:

- **It must be an address a BROWSER can reach.** The photo goes device → endpoint, never
  through the openplate server, so a compose hostname like `http://openplate-inference:8080/v1`
  does not work. Publish the endpoint or put it behind your reverse proxy. Its origin is added
  to the CSP for you.
- **`DEFAULT_INFERENCE_API_KEY` is public.** It is not kept on the server — it is embedded in
  the page HTML and readable with view-source by anyone who can open the app. That is fine for
  an endpoint only your household or tailnet can reach. It is **not** fine for a metered cloud
  provider key, and not fine on an instance exposed to the open internet without a VPN, tailnet
  or auth proxy in front of it. If your endpoint needs no key, leave it unset.

A malformed `DEFAULT_INFERENCE_BASE_URL` fails the boot deliberately, so a typo cannot look
like "the button just never appeared".

## Connecting with OpenRouter

**Settings → AI → Connect with OpenRouter** is a one-click, browser-only OAuth flow (PKCE) —
no key to copy-paste. It opens OpenRouter's consent screen in a new tab; approve it, and the
issued key lands directly in this browser's local storage. The openplate server is never in
that loop: it never sees, stores, or proxies the key.

- **Set a spending cap while you are there.** OpenRouter's consent screen offers a
  self-service credit cap (optional, with a reset interval) next to the account picker. It
  bounds what the connected key can ever spend, independent of anything openplate does.
- **The default model is `google/gemini-3.5-flash-lite`** — a paid model, roughly **$0.001
  per scan**. It was chosen over any `:free` model because OpenRouter's `:free` endpoints only
  become reachable after you enable that provider's account-level "may train on request data"
  / "may publish prompts" toggles, and some free vision models retain prompts for weeks. You
  can still pick a `:free` model yourself from the model list — an explicit, disclosed opt-in.
- **Manual key entry works for every provider**, OpenRouter included, via the "paste an API
  key manually" panel.
- The connected key appears in your [OpenRouter key settings](https://openrouter.ai/settings/keys)
  labeled **"An app"**. Disconnecting in openplate only clears the key from that device — it
  does **not** revoke it at OpenRouter. Revoke it from that page yourself.
- Same guarantee as any other key: stored only in the device's local storage, excluded from
  the JSON backup/export, never sent to the openplate server.

**It works from any origin.** The OAuth callback URL is derived at request time from
`window.location.origin` — never hardcoded, never pre-registered with OpenRouter. The button
works unmodified on `http://localhost:3000`, a LAN IP, or your own domain.

One note if you self-host behind a reverse proxy that logs request URLs: the callback URL
(including its one-time `state` parameter) will appear in your access logs like any other
URL. It is not a secret — knowing it grants access to nobody's key — but scrub it if your log
retention is a concern.
