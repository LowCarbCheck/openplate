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
| [0005](0005-label-scan-over-barcode-lookup.md)        | Packaged-food macros come from the label, not a barcode database | Accepted   |
| [0006](0006-the-app-server-holds-no-accounts.md)      | The app server holds no accounts                                 | Accepted   |
| [0007](0007-byok-provider-registry.md)                | BYOK providers are described once, in a provider registry        | Accepted   |
