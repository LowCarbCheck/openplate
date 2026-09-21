# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs) — short markdown files documenting significant choices we've made about how this codebase is built. The point is not bureaucracy; it's so that six months from now somebody (often us) can ask "why did we do it this way?" and find a real answer instead of guessing from the code.

## When to write an ADR

Write one whenever you make a decision that:

- Constrains future work in a non-obvious way (e.g. picking a transport, a tenancy model, a framework)
- Has a clear alternative we considered and rejected
- Would be expensive to reverse (DB schema shape, public API contracts, build tooling)
- A future contributor might second-guess without context

Skip it for routine local choices — naming a function, picking between two equivalent libraries for a one-off, choosing a CSS color. ADRs are for the stuff that bites you when you forget.

## Workflow

1. Copy `0000-template.md` to the next zero-padded number — `NNNN-kebab-case-title.md`.
2. Fill in: **Status** (Proposed / Accepted / Superseded), **Context**, **Decision**, **Consequences**.
3. Add the ADR to the index in [AGENTS.md](../AGENTS.md#index) and to the list below.
4. If the new ADR supersedes an older one, set the older ADR's **Status** to `Superseded by NNNN`.

ADRs are immutable once Accepted. To change a decision, write a new ADR that supersedes the old one — don't edit history.

## Index

| #                                                     | Title                                                            | Status     |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ---------- |
| [0001](0001-cli-wraps-the-api.md)                     | CLI wraps the API                                                | Superseded |
| [0002](0002-data-migrations.md)                       | Data migrations alongside schema migrations                      | Superseded |
| [0003](0003-app-enforced-multi-tenancy.md)            | App-enforced multi-tenancy (no RLS)                              | Superseded |
| [0004](0004-custom-server-is-the-production-entry.md) | The custom `server.ts` is the production entrypoint              | Accepted   |
| [0005](0005-label-scan-over-barcode-lookup.md)        | Packaged-food macros come from the label, not a barcode database | Amended    |
| [0006](0006-the-app-server-holds-no-accounts.md)      | The app server holds no accounts                                 | Accepted   |
| [0007](0007-byok-provider-registry.md)                | BYOK providers are described once, in a provider registry        | Accepted   |
| [0008](0008-the-study-console-lives-in-openplate.md)  | The study console lives in openplate, at `/study`                | Accepted   |
| [0009](0009-a-compartment-carries-its-kind.md)         | A compartment carries its kind, and a wrong kind is refused       | Accepted   |
| [0010](0010-hosted-analytics.md)                      | Analytics on the hosted instance, off everywhere else            | Amended    |
| [0011](0011-analytics-levels.md)                      | Analytics levels, and the research tier ADR-0010 refused         | Accepted   |
| [0012](0012-the-server-asks-github-about-releases.md) | The server asks GitHub about releases, and it asks by default     | Accepted   |
| [0013](0013-a-recreated-store-cannot-vouch-for-an-absence.md) | A recreated store cannot vouch for an absence; a delete needs a journal row | Accepted |
| [0014](0014-fasts-are-a-merged-entity.md)             | Fasts are a merged entity, and the merge adjudicates nothing              | Accepted   |
| [0015](0015-the-pantry-is-a-merged-entity.md)         | The pantry is a merged entity, reversing M233/02                         | Accepted   |
| [0016](0016-the-sign-out-dialog-says-only-what-is-true.md) | The sign-out dialog says only what it can prove                       | Accepted   |
| [0017](0017-a-browser-run-takes-its-ports-from-its-checkout.md) | A browser run takes its ports from its checkout | Accepted |
| [0018](0018-in-app-release-notes-come-from-the-changelog.md) | In-app release notes come from the changelog | Accepted |
| [0019](0019-intake-routes-nest-under-add.md) | Intake routes nest under `/add`, and voice is a query flag, not a route | Accepted |
