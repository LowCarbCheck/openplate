# 0022: The push gate runs a scoped browser tier, the release gate and the nightly run the full one

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** Altan Sarisin (operator), Fable (architecture review)
- **Relates to:** ADR-0017

## Context

The only test gate is the local pre-push hook. Its last stage is the browser
tier. After the amendment of ADR-0017 the tier was 141 spec files and about 8
minutes over 4 shards.

The tier grows by rule. Every bug report adds a browser check, and the checks
stay. So the push gate got slower every week, and nothing in the design stopped
that. A slow gate invites `SKIP_TESTS=1`, and that is the one answer we refuse.

Most of those 8 minutes guard code the push did not touch. A change to one
settings page does not need the camera specs.

## Decision

**The push gate runs a scoped browser tier. A release tag and a nightly run the
full tier.**

1. **The push gate** runs lint, typecheck, unit tests and the production build.
   Then it runs the smoke set (8 to 12 specs that always run), every spec whose
   area matches the touched code, and every spec file the push changed. The
   target is under 3 minutes.

2. **Shared code runs the full tier.** That is `app/root.tsx`,
   `app/components/ui/**`, `app/i18n/**`, `app/lib/sync/**`, `app/services/**`,
   the e2e helpers, `package.json`, `playwright.config.ts`, the hooks and the
   scripts. An app path that no rule maps also runs the full tier. A docs-only
   push runs only the smoke set.

3. **The release gate.** A push of a tag `v*`, `core-v*` or `inference-v*` runs
   the gate of the app the tag names, with the full tier, before the tag leaves
   the machine. It runs even when origin already holds the tagged commit.
   Production changes only on a tag, because Bay pins the version. So the full
   tier guards exactly what reaches people. `OPENPLATE_E2E_FULL=1 git push`
   forces the full tier on any push.

4. **The nightly.** `scripts/nightly-e2e.sh` runs the full tier on origin/main at
   03:30 from a systemd user timer, in its own worktree `op-nightly`, on the host
   node. It writes one line, `green|red <date> <sha> <summary>`, to
   `~/.local/state/openplate/nightly-e2e/latest.txt`, and a dated log beside it.
   After the browser tier it runs the photo path guard in `apps/core`
   (`pnpm test:guard`), and a failed guard turns the line red. Every push gate
   prints that line at its start. A red nightly does not block a push. It tells
   the next session what to fix first. `make nightly` installs the timer,
   `make nightly-now` starts a run, `make nightly-status` prints the last
   result.

5. **Every spec declares its area.** Each `apps/app/tests/e2e/*.spec.ts` carries
   ` * @area <name>` in its header, one of the areas in `tests/e2e/areas.ts`.
   Smoke specs also carry ` * @smoke`. `areas.ts` holds the ordered path rules
   (path pattern to area, `all` or `none`). `scripts/e2e-select.ts` turns the
   pushed diff into a spec list (`pnpm test:e2e:select`).
   `scripts/e2e-scoped.sh` runs that list through the sharded runner
   (`pnpm test:e2e:scoped`). A unit test fails the push when a spec has no area,
   a wrong area, or the smoke set is out of bounds.

6. **The guideline for browser specs.**
   - A bug report still grows the suite. The new spec goes into the file of its
     area, or a new file with that `@area`.
   - A spec passes in any shard. It never assumes the base port, the first
     server, or state left by another file. It reads ports from
     `tests/e2e/env.ts`.
   - A spec in the smoke set is fast (under 10 seconds) and covers a door people
     walk through every day.
   - A missing path rule falls back to the full tier. A slow push is the signal
     to add the rule, never to skip the gate.
   - Signed-in specs should share saved sign-in state per worker. This is
     planned, not done yet.

## Consequences

- A regression in code that a rule maps wrongly, or in an interaction between
  areas, can live on main for up to a day. The nightly or the release gate
  catches it before a tag, and a tag is the only way code reaches production.
- A red nightly is a to-do for the next session. It blocks nothing, so it needs
  someone to read it. The push gate prints it to make that likely.
- The rules in `areas.ts` are code that can be wrong. The fallback is safe: an
  unmapped path costs time, never coverage.
- A new spec needs an area. The unit test enforces it, so the cost is one line.
- The full tier still grows. It now grows off the push path.

## Alternatives considered

- **Keep the full tier on pushes to main only.** A smaller change. Rejected,
  because most pushes go to main, so most pushes stay slow.
- **Drop the browser tier from pushes entirely.** The fastest push. Rejected,
  because there would be no smoke check, and a broken first visit could land.
