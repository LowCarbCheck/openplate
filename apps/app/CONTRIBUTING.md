# Contributing

Thanks for looking at openplate. This is a small, opinionated project — issues and pull
requests are welcome, but please open an issue to discuss anything non-trivial before
sending a PR.

## Dev setup

See the [Quickstart](README.md#quickstart) in the README — `pnpm install`, `pnpm dev`. There
is no database and no required configuration; `.env` is optional tuning only.

Run this once after cloning:

```bash
git config core.hooksPath .githooks
```

`core.hooksPath` lives in `.git/config`, which is not cloned. Without it the pre-push gate
below never runs. This repo has no cloud CI, so nothing else would catch the failure — a
broken push simply lands.

## Before opening a PR

```bash
pnpm lint              # oxlint --max-warnings 0
pnpm typecheck         # react-router typegen && tsc
pnpm test:unit         # node --test against tests/unit/**
pnpm test:integration  # node --test against tests/integration/**
pnpm build             # react-router build
```

All five must pass. They are exactly what `.githooks/pre-push` runs, in that order, so a
green run here is a push that will not be stopped. Tests are required for new pure logic (see `tests/unit/`) — if you're
adding a route or model change, prefer extracting the non-I/O decision into a small pure
function so it stays testable in isolation (see `AGENTS.md` for the project's
functional-core/imperative-shell convention).

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`,
`refactor:`, `docs:`.

## Coding guidelines

[`AGENTS.md`](AGENTS.md) is the source of truth for stack conventions, project structure, and
coding style. Read it before making changes — it covers things like config access (`CONFIG`
only, never raw `process.env`), the data model, and the schema-migration workflow.

## Licensing

openplate is open source under the [MIT License](LICENSE). See the README's
[License](README.md#license) section for the details.

By opening a pull request you agree that your contribution is licensed to the project under
those same terms. There is no CLA to sign and no copyright assignment.
