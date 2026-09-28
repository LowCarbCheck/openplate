# Security Policy

## Supported versions

openplate ships as a rolling `main` with tagged releases (`v0.1.0` and up). Only the **latest release** is supported. There are no LTS branches. If you are self-hosting, update to the newest tag/image before reporting a bug that might already be fixed.

## Reporting a vulnerability

**Please do not open a public issue for a security report.** Use GitHub's private vulnerability reporting instead:

**[Report a vulnerability →](https://github.com/LowCarbCheck/openplate/security/advisories/new)**

This opens a private draft security advisory visible only to you and the maintainers, so the issue isn't disclosed before a fix ships.

We'll acknowledge new reports within a few days. This is a small open-source project maintained on a best-effort basis. There's no bug bounty, and there's no fixed SLA on turnaround, but we take reports seriously and will work with you toward a fix and coordinated disclosure.

## Trust model

openplate is a local-first app. The app server has no database. On an instance that runs it alone, a user's food diary lives only in the browser's own storage (IndexedDB) on their device. The server never receives it. BYOK AI provider keys (OpenRouter, Mistral, OpenAI-compatible endpoints, Anthropic) stay on the device and go straight from the browser to the chosen provider. An instance that also runs [openplate-core](https://github.com/LowCarbCheck/openplate/tree/main/apps/core), such as the hosted app.openplate.de, adds accounts. Each device encrypts the diary before it uploads a copy there. The operator keeps a sealed backup of each recovery code so a forgotten password restores the diary. Whoever holds that service's database and `SERVER_SECRET` can therefore read the diary. AI then goes through that service's proxy. Given that shape, the interesting attack surface for this repo is:

- **XSS and CSP**, since a key or diary data compromised in the page is compromised entirely; the production Content-Security-Policy (`app/config/content-security-policy.ts`) is a load-bearing control, not decoration.
- **The service worker** (`public/sw.js`, `app/lib/service-worker.ts`): cache-poisoning or scope issues that could serve stale or malicious assets to an installed PWA.
- **The optional, separately-hosted services**: [openplate-core](https://github.com/LowCarbCheck/openplate/tree/main/apps/core) (accounts and encrypted diary sync, whose operator can read the diary through the recovery escrow) and [openplate-inference](https://github.com/LowCarbCheck/openplate/tree/main/apps/inference) (self-hosted vision endpoint). Vulnerabilities specific to those services should be reported in their own repos, but cross-cutting issues (e.g. the shared wire protocol) are welcome here too.

If you're unsure whether something is a security issue or a regular bug, err on the side of reporting it privately. We can always downgrade it to a public issue afterward.
