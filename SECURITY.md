# Security Policy

## Supported versions

openplate ships as a rolling `main` with tagged releases (`v0.1.0` and up). Only the **latest release** is supported — there are no LTS branches. If you are self-hosting, update to the newest tag/image before reporting a bug that might already be fixed.

## Reporting a vulnerability

**Please do not open a public issue for a security report.** Use GitHub's private vulnerability reporting instead:

**[Report a vulnerability →](https://github.com/LowCarbCheck/openplate/security/advisories/new)**

This opens a private draft security advisory visible only to you and the maintainers, so the issue isn't disclosed before a fix ships.

We'll acknowledge new reports within a few days. This is a small open-source project maintained on a best-effort basis — there's no bug bounty, and there's no fixed SLA on turnaround, but we take reports seriously and will work with you toward a fix and coordinated disclosure.

## Trust model

openplate is a local-first app: it has no database and no accounts, and a user's food diary lives entirely in the browser's own storage (IndexedDB) on their device — the server never receives it and stores no personal data of any kind. BYOK AI provider keys (OpenRouter, Mistral, OpenAI-compatible endpoints, Anthropic) are handled client-side end to end — stored on-device and sent directly from the browser to the chosen provider, never through this server. Given that shape, the interesting attack surface for this repo is:

- **XSS and CSP** — since a key or diary data compromised in the page is compromised entirely; the production Content-Security-Policy (`app/config/content-security-policy.ts`) is a load-bearing control, not decoration.
- **The service worker** (`public/sw.js`, `app/lib/service-worker.ts`) — cache-poisoning or scope issues that could serve stale or malicious assets to an installed PWA.
- **The optional, separately-hosted services a user opts into** — [openplate-sync](https://github.com/LowCarbCheck/openplate-sync) (end-to-end-encrypted diary sync) and [openplate-inference](https://github.com/LowCarbCheck/openplate-inference) (self-hosted vision endpoint). Vulnerabilities specific to those services should be reported in their own repos, but cross-cutting issues (e.g. the shared wire protocol) are welcome here too.

If you're unsure whether something is a security issue or a regular bug, err on the side of reporting it privately — we can always downgrade it to a public issue afterward.
