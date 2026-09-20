# 0017: A browser run takes its ports from its checkout

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** Altan Sarisin (operator), Fable (architecture review)
- **Tracker:** M241/01

## Context

The browser smoke tier binds three TCP ports: the fake LowCarbCheck, the fake
sync service and the production app server. Until now `tests/e2e/env.ts`
exported them as three literals, 5297, 5298 and 5299, and those were the same
three numbers in every clone and every worktree of this repository on a host.

The tier is the LAST stage of the only test gate this repository has, run from
`.githooks/pre-push` after a full production build. So the collision costs the
most at the worst moment: two people pushing at once, or one person with two
worktrees, meet on all three ports after several minutes of build time.

On 2026-09-19/20 one session lost sixteen minutes to it in `/tmp/op-fix` and a
second session hit the same symptom independently on two of its workers. Both
read it as flakiness, because the same tree passed on a bare rerun once the
other run had finished. It is not flakiness. It is a deterministic resource
conflict whose outcome depends on who binds first.

Commit `5067833` fixed the HANG, which was a separate defect: both fake
services awaited a bare `server.listen()` in a promise with no `'error'`
handler, so an `EADDRINUSE` left that promise unsettled for ever. Both now
reject within milliseconds and name the port, and
`tests/unit/fake-service-port-in-use.test.ts` proves it. That made the
collision loud. It did not make two trees able to run at the same time, which
is what this ADR decides.

One constraint shapes every candidate. `playwright.config.ts` builds the
`webServer` command line at MODULE LOAD, with `PORT`, `APP_URL`,
`SYNC_SERVER_URL` and `FOOD_DB_API_URL` already baked into the string, before
`globalSetup` runs and before anything is listening. That module is also
evaluated in the runner AND in every worker process, which is exactly why the
`FONTCONFIG_FILE` assignment sits at module load in that file rather than in
`globalSetup`. Whatever decides a port inherits that precedent: it must be
resolved synchronously, at module load, and must be a pure function of inputs
every process shares.

## Decision

The three ports are derived from the real path of the checkout they belong to.

- **Root.** `tests/e2e/env.ts` resolves its own location two directories up and
  passes it through `realpathSync`, so a checkout reached through a symlink and
  the same checkout reached directly derive one answer.
- **Hash.** sha256 of that path string. The first four bytes, read as an
  unsigned big-endian integer, are the hash.
- **Slot.** `hash mod 7000`.
- **Base.** `10000 + 3 * slot`. The triple is `base`, `base + 1`, `base + 2`,
  keeping the previous relative order: food database at the base, sync service
  at `base + 1`, app server at `base + 2`.
- **Override.** `OPENPLATE_E2E_PORT_BASE` wins over the hash when it is set to
  a non-empty value. It must be a whole decimal number between 1024 and 65533,
  so that it and the next two numbers are all ports this tier can bind. A value
  outside that is refused at module load, in one sentence that names the
  variable. A variable that is exported but empty falls back to the hash rather
  than failing, so a blank in somebody's shell profile cannot stop the gate.

`deriveE2ePortBase` and `canonicalRepoRoot` are exported from
`tests/e2e/env.ts` and covered by `tests/unit/e2e-ports.test.ts`.

### Why this range

The top of the range is `10000 + 3 * 6999 + 2`, which is 30999. That is below
32768, where Linux's ephemeral range starts, so the kernel never hands one of
this tier's ports to some other process's outgoing socket between the
derivation and the bind. The bottom is well above the ports this repository and
this host already use: 3000 (dev server), 3007 (a seeded instance), 5173
(Vite), 5433 (the shared Postgres every project here talks to) and the 52xx
literals this decision replaces, which an older checkout may still be holding.
7000 slots is enough that a host would need a great many checkouts before a
pair met, and small enough to keep the whole range inside one tidy band a
person can recognise in `ss -ltnp` output.

## Alternatives Considered

**A free port taken at run time.** Ask the kernel for port 0, read back what it
gave, use that. Rejected on the ordering constraint above: `playwright.config.ts`
is re-evaluated in the runner and in every worker process, so a scan would
answer differently in each one, and the specs would talk to a different port
from the one the server was started on. Threading one runner-side answer into
the workers means an environment variable the runner sets before it forks,
which Playwright does not offer before `webServer.command` is built. A scan
also has a race of its own: the port is free when it is read and can be taken
by somebody else before the bind.

**A lock file that serialises the two runs.** Keep the three literals, add
`tests/e2e/port-lock.ts`, make the second run wait with a printed sentence.
Rejected for two reasons. It puts a wait of minutes on the LAST stage of a push
gate, which is where a person's patience is already spent, and a silent-looking
wait there is the same experience as the hang this milestone set out to remove.
And it serialises runs that have no reason to be serialised: two worktrees
share nothing but the host, so the correct answer is two sets of ports, not one
set used politely in turn.

**A port derived from the process id.** Rejected because it is not stable
across the runner and the worker processes, which is the same defect as the
scan, and because two runs of the same tree would drift onto different ports
for no benefit.

## Consequences

Two working trees on one host run the browser tier at the same time, with no
coordination, no lock, no wait and no shared state. `scripts/repro-e2e-port-collision.sh`
is the check: it makes a scratch worktree of `HEAD` in a temp directory,
installs and builds it, runs `pnpm test:e2e` there and here at the same time,
and fails with a sentence if either run exceeds fifteen minutes.

The residual risk is a hash collision. Two checkouts whose real paths land on
the same slot get the same triple, at about 1 in 7000 per pair of trees on one
host. It fails LOUDLY, not silently: the second run's fake service rejects
within milliseconds, naming the port, pointing at `ss -ltnp` and naming
`OPENPLATE_E2E_PORT_BASE`, which is the fix. Setting that variable in one of
the two trees moves it and nothing else changes.

Nobody can predict a checkout's ports by reading the source any more. That is
the cost of the decision, and it is paid back by every run printing its own
three numbers and by the failure message naming the port it wanted.

One piece of host state is still shared and stays that way: the tier's
fontconfig cache, `~/.cache/openplate-e2e-fontconfig`, whose name is written
into `tests/e2e/fonts.conf` as XML and cannot read a TypeScript constant. Two
concurrent runs therefore reset and fill one cache. That is safe in a way a TCP
port is not, because a cache rebuilds itself when it is missing, and the two
concurrent runs this decision was verified against passed 39 checks each with
it shared. Making it per checkout would mean generating `fonts.conf`, which
buys nothing until a run is seen to fail on it.

CI is unaffected in substance: a fresh GitHub runner has one checkout, so it
derives one triple from the runner's workspace path and every port in the range
is free there.

## References

- `.tracker/M241-e2e-port-collision/01-a-colliding-port-fails-fast-instead-of-hanging.md`
- `tests/e2e/env.ts` (the derivation and its constants)
- `tests/unit/e2e-ports.test.ts` (the derivation's guard)
- `tests/unit/fake-service-port-in-use.test.ts` (a taken port fails, it does not hang)
- `scripts/repro-e2e-port-collision.sh` (two concurrent runs, proven)
- `playwright.config.ts` (the `FONTCONFIG_FILE` precedent this follows)
- Commit `5067833`, the fast-failure half that shipped first
