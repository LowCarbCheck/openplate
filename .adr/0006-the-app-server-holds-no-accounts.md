# 0006 — The app server holds no accounts

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** openplate maintainers

## Context

openplate shipped with a conventional self-hosted account system: cookie sessions, registration with an email-verification and password-reset flow, a first-user-becomes-admin bootstrap, a signup gate, and a `/super/users` panel. By the time this decision was taken, none of it was still load-bearing:

- **The tracker had already left the server.** M117/03 moved food logs, personal foods, weigh-ins and profile/goals into the browser's IndexedDB primary store and dropped the server tables. The account row no longer had any health data hanging off it.
- **The BYOK key had already left the server.** M117/02 moved the AI provider key onto the device, so the AES-256-GCM at-rest encryption — and the key material it needed in the environment — protected nothing.
- **Accounts had already stopped gating the product.** M117/04 made the whole tracker work with no session at all; the login page was an entrance to a building nobody had to enter.
- **The one remaining reason to have an account was sync**, and M128 spec 01/02 moved sync out of this app entirely, into a standalone `openplate-sync` service with its own identity, its own database, and its own secrets.

What was left was an account system whose only real effects were costs: two required secrets in every deployment's environment, a `users` table that made this server a processor of personal data (an email address is personal data even with no health data attached), a login wall in front of a product that did not need one, and a large surface of auth code — throttles, token tables, session-freshness checks, superadmin gating — to keep correct and reviewed for no user-visible benefit.

## Decision

**The openplate app server has no accounts, and holds no personal data.**

Removed entirely: the `users`, email-verification-token, password-reset-token and feature-entitlement tables; the E2EE sync-storage tables (relocated to `openplate-sync`); every auth route (`/login`, `/logout`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`); the `/super/*` panel; auth and superadmin middleware; the session service; the mail transports; the login/registration throttles; and the `user` CLI command group.

Two consequences of that removal are themselves decisions, and are the ones worth defending:

1. **The app boots with zero secrets.** `SESSION_SECRET` and `ENCRYPTION_KEY` are gone from `CONFIG`, `.env.example` and the self-host compose file (today `docker/compose.yml`). A database connection is a complete boot; the self-hosting quickstart has no `.env` step. `app/config/index.ts` carries a note that anything added must keep this true. The one cookie that survives — the toast flash — signs itself with a per-boot random key (`app/utils/toast.server.ts`), which is correct precisely because its payload is a one-shot UI message with no identity in it.
2. **The database keeps exactly one table:** `data_migrations`, the runner's own ledger. Adding a table is now a deliberate act to be justified against the "no personal data" promise, not a routine step.

> **Update (2026-08-19):** that last table is gone too, and with it Drizzle, the connection pool, the data-migration runner, the CLI and the `DB_*` environment. The app is a single stateless container with no database at all — an empty environment is now a complete boot. Reintroducing persistence would need its own ADR. See ADR-0002 (superseded).

Device-local state that was keyed by account id is re-keyed onto a single sentinel owner (`ANONYMOUS_USER_ID`). In practice that was only the plate-photo cache, whose row keys are `${userId}::${logBatchId}`; `app/lib/local-store/photo-rekey.ts` moves those rows at boot, idempotently. The primary tracker store never had per-user namespacing, so it needed no migration.

## Alternatives Considered

- **Keep accounts as an optional feature, gated off by default.** Rejected: "optional" still means the `users` table exists, the secrets are still required to boot, and the auth code still has to be maintained and reviewed. It would have preserved every cost of the system while none of its users had a reason to turn it on.
- **Keep accounts purely so the future sync client has an identity to bind to.** Rejected: sync's identity belongs to the sync service, which already has its own account store. Two account systems that must agree with each other is strictly worse than one that lives where the feature does.
- **Keep the `users` table but stop using it (soft removal).** Rejected as the worst of both: a dormant table of email addresses and password hashes is exactly the liability this decision exists to remove, and dead schema invites re-use.
- **Keep a superadmin account for operational access.** Rejected: there is nothing left to administer through the browser. Operational access is the CLI and the database, both of which need shell access to the box anyway.

## Consequences

**Good**

- The privacy claim is now structural rather than a policy promise: there is no personal data on this server to leak, subpoena, or mishandle, and no credential store to breach.
- Self-hosting is a single `docker compose up -d` with nothing to generate. The most common setup failure — a missing or weak secret — cannot happen.
- Every route that used to make a server round trip purely to resolve "who is this" is now client-only. `/scan`, `/diary/entry/:id` and `/profile` lost their server loaders entirely.
- A large, security-sensitive code surface is gone, along with four runtime dependencies (`remix-auth`, `remix-auth-form`, `bcryptjs`, `nodemailer`). ESLint now bans re-importing the first three, with the reason attached.

**Costs and constraints**

- **This is a one-way migration.** Migration `0008` drops the `users` table and everything referencing it. Existing account rows are not recoverable after it runs; self-hosters are told to `pg_dump` first, and — more importantly — to take the per-device JSON export, which is where their actual diary lives.
- **A device is the unit of identity.** Two people sharing one browser profile share one diary. Separate browser profiles are the only isolation boundary, and now the only one there could be.
- **Moving data between devices is a manual export/import** until sync ships. The profile page says so plainly rather than implying an account would help.
- **The food-lookup rate limiter buckets by IP only**, since there is no per-caller identifier left. Behind a shared NAT the budget is shared; the cache-miss-only accounting (M123/07) is what keeps that tolerable, and it is now load-bearing rather than an optimisation.
- **`/privacy` and `/terms` still describe an account system that no longer exists.** That is knowingly deferred to a single legal pass alongside the sync service's own policies (M128 spec 07) rather than patched piecemeal here.

## References

- `.tracker/M128-openplate-public-release-split/03-accountless-app.md` — the spec this implements.
- ADR-0003 — app-enforced multi-tenancy, superseded long before this; there is now not even a single-tenant user.
- `app/lib/local-store/index.ts` — the device-ownership model this decision makes unconditional.
- `drizzle/migrations/0008_huge_silver_sable.sql` — the drop (in git history; the `drizzle/` tree itself was removed in 2026-08).
