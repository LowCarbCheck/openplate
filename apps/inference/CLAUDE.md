# openplate-inference

Self-hostable, OpenAI-compatible plate-identification endpoint. See `README.md`
for architecture and `SECURITY.md` for the threat model and how to report a
vulnerability.

## Issue & PR triage

**Every issue** gets exactly one `area:` label, one type label (`bug`,
`enhancement`, `question`, `documentation`, ...), and a `runtime: *` label
whenever the report is specific to one runtime (llama.cpp / Ollama / vLLM).

- `area: pipeline` — image intake, terse contract, ensemble/map, nutrition
  resolution (`src/pipeline/`)
- `area: runtime-client` — the model-runtime HTTP client: endpoint
  compatibility, timeouts, health/readiness probing (`src/pipeline/runtime-client.ts`)
- `area: food-source` — FDC/OFF/LCC food resolution, lexical scoring,
  embeddings (`src/food-source/`)
- `area: server` — Express app, auth, CORS, admission control, rate limiting
  (`src/server/`)
- `area: eval` — eval harness, gold set, benchmark/performance results (`eval/`)
- `area: packaging` — Dockerfile, entrypoint, weight fetching, esbuild bundling
  (`scripts/`, `Dockerfile`)

**`needs info` protocol.** Apply and ask for whatever of this is missing:
runtime kind + version (llama.cpp / Ollama / vLLM), the model in use, the exact
request and response (or error) involved, and `/readyz` output. Don't guess at
an area label from a vague report — `needs info` first, area label once the
report is triageable.

**`regression`** requires a last-known-good version or commit; ask for one if
it's not stated.

**`upstream`** means the root cause is in the model runtime (llama.cpp /
Ollama / vLLM) or the model itself, not in this repo's code. Link the external
issue tracker. Keep it open here only as long as we can offer a workaround
(docs, a config default, a guard) — once nothing here can help, close with a
pointer to the upstream issue rather than leaving it to rot.

**Support-matrix reports** — "runtime/model X doesn't work" — are
`enhancement` + the relevant `runtime: *` label, not `bug`, *unless* the
support matrix in `README.md` already claims that combination works. If it
does, it's a `bug` (and likely a `regression`).

**Security reports never go through public issues.** Point the reporter at
GitHub private vulnerability reporting per `SECURITY.md`; if a public issue
already contains a security-relevant detail, ask GitHub support/repo admin to
redact or convert it rather than continuing the discussion in the open.

### PRs

- One `area:` label, same taxonomy as issues.
- There is no CI on this repo (deliberate — see `.githooks/pre-push`). The
  reviewer is the gate: run the pre-push hook locally
  (`lint → typecheck → unit → esbuild production build`) against the PR branch
  before approving, and say so in the review. A PR that hasn't been run
  through the gate doesn't get merged on the strength of a description alone.
- `pnpm test:integration` and `scripts/smoke-lite.sh`/`smoke-external.sh` need
  a live model runtime and are not part of the gate — only run them by hand
  when the change actually touches runtime-facing behavior.
