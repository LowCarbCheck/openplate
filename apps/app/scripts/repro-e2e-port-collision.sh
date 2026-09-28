#!/usr/bin/env bash
# Two working trees run the browser smoke tier at the same time, and both pass.
#
# This is the check behind ADR-0017. It makes a scratch git worktree of HEAD in
# a temp directory, gives it its own node_modules (never a symlink to this
# tree's, which breaks whichever agent is running here), builds both trees, then
# starts `pnpm test:e2e` in both AT THE SAME TIME and waits for both. Each run
# gets a wall-clock budget, because the failure this milestone is about was a
# run that printed nothing and never ended; a run over budget is killed and
# reported as a failure, never waited on. It prints the three ports each tree
# derived and the tail of each log, and it removes the scratch worktree and its
# branch on every exit path. It runs on the HOST, like the browser stage of
# `.githooks/pre-push`, because the ts-dev toolbox has no Chromium.
set -euo pipefail

# ── Settings ───────────────────────────────────────────────────────────────

# How long one run may take, end to end. The tier is about 1.5 minutes on a
# quiet host; fifteen minutes is "this is not slow, this is stuck".
readonly RUN_BUDGET_SECONDS=900

# How long a killed run gets to exit before it is killed harder.
readonly KILL_GRACE_SECONDS=30

# How much of each log to print. Enough for the Playwright summary and the
# failure above it.
readonly TAIL_LINES=25

readonly HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly SCRATCH_BRANCH="repro-e2e-ports-$$"

SCRATCH_ROOT=""
HERE_PID=""
SCRATCH_PID=""

# ── Cleanup, on every exit path ────────────────────────────────────────────

# Sends TERM to a process and everything it started, and to nothing else. A
# pattern kill (`pkill -f playwright`) would reach other checkouts on this host,
# which is the very thing this script exists to make safe.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  local status=$?
  for pid in "$HERE_PID" "$SCRATCH_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "▪ repro: stopping run $pid"
      kill_tree "$pid"
    fi
  done
  if [ -n "$SCRATCH_ROOT" ]; then
    # `worktree remove` drops this one's admin entry by itself. A plain
    # `worktree prune` is deliberately NOT run: it is repository-wide and would
    # reach into the bookkeeping of every other session's worktree.
    git -C "$HERE" worktree remove --force "$SCRATCH_ROOT/tree" >/dev/null 2>&1 || true
    git -C "$HERE" branch -D "$SCRATCH_BRANCH" >/dev/null 2>&1 || true
    rm -rf "$SCRATCH_ROOT"
    echo "▪ repro: scratch worktree and branch $SCRATCH_BRANCH removed"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

# ── The host this has to run on ────────────────────────────────────────────

if ! command -v pnpm >/dev/null 2>&1; then
  echo "✖ repro: pnpm is not on PATH. Run this from the host shell, not inside the ts-dev toolbox."
  exit 1
fi

# A real launch, not a path check, exactly as the pre-push hook does it: the
# toolbox has the browser bytes on a shared cache and still cannot start them.
if ! (cd "$HERE" && pnpm exec node -e \
  "const {chromium}=require('@playwright/test');chromium.launch().then((b)=>b.close()).then(()=>process.exit(0),()=>process.exit(1))") \
  >/dev/null 2>&1; then
  echo "✖ repro: Chromium will not start here. Run this from the host shell, the toolbox has no Chromium."
  exit 1
fi

if [ -n "$(git -C "$HERE" status --porcelain)" ]; then
  echo "⚠ repro: this tree has uncommitted changes. The scratch worktree is made from HEAD,"
  echo "  so it will NOT carry them and the two runs will not be testing the same code."
fi

# ── The scratch tree ───────────────────────────────────────────────────────

SCRATCH_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/openplate-repro-ports-XXXXXX")"
readonly SCRATCH="$SCRATCH_ROOT/tree"

echo "▶ repro: a second worktree of HEAD at $SCRATCH"
git -C "$HERE" worktree add -b "$SCRATCH_BRANCH" "$SCRATCH" HEAD

# ITS OWN node_modules. A symlink to this tree's would be recreated by pnpm and
# would break whatever is running here, and an install is what proves the second
# tree stands on its own.
echo "▶ repro: installing dependencies in the scratch worktree (its own node_modules, never a symlink)"
(cd "$SCRATCH" && CI=true pnpm install --frozen-lockfile --prefer-offline)

# ── Both builds, one after the other ───────────────────────────────────────
#
# Sequential on purpose: two production builds at once is the one part of this
# that would fail for memory rather than for ports, and the ports are the point.

echo "▶ repro: production build in this checkout"
(cd "$HERE" && CI=true pnpm build >/dev/null)

echo "▶ repro: production build in the scratch worktree"
(cd "$SCRATCH" && CI=true pnpm build >/dev/null)

# ── The ports each tree derived ────────────────────────────────────────────

# Reads them from the tree's own `tests/e2e/env.ts`, which is the module the
# run itself will read, so this cannot drift from what the run does.
readonly READ_PORTS='import("./tests/e2e/env.ts").then((env) => console.log("food database " + env.E2E_FOOD_DB_PORT + ", sync " + env.E2E_SYNC_PORT + ", app " + env.E2E_APP_PORT));'

ports_of() {
  (cd "$1" && node --import tsx -e "$READ_PORTS")
}

HERE_PORTS="$(ports_of "$HERE")"
SCRATCH_PORTS="$(ports_of "$SCRATCH")"
readonly HERE_PORTS SCRATCH_PORTS

echo "▪ repro: this checkout  ($HERE) takes $HERE_PORTS"
echo "▪ repro: scratch worktree ($SCRATCH) takes $SCRATCH_PORTS"

if [ "$HERE_PORTS" = "$SCRATCH_PORTS" ]; then
  echo "✖ repro: the two trees derived the SAME three ports. That is the 1-in-7000 hash collision"
  echo "  ADR-0017 records. Set OPENPLATE_E2E_PORT_BASE in one of the two trees and run this again."
  exit 1
fi

# ── Both runs, at the same time ────────────────────────────────────────────

readonly HERE_LOG="$SCRATCH_ROOT/here.log"
readonly SCRATCH_LOG="$SCRATCH_ROOT/scratch.log"

# STARTED IN THIS SHELL, not inside a function called through `$(...)`: a
# background job belongs to the shell that started it, and only that shell can
# `wait` for it.
echo "▶ repro: both browser tiers, concurrently, ${RUN_BUDGET_SECONDS}s budget each"

(cd "$HERE" && CI=true timeout --kill-after="${KILL_GRACE_SECONDS}s" "${RUN_BUDGET_SECONDS}s" pnpm test:e2e) \
  >"$HERE_LOG" 2>&1 &
HERE_PID=$!

(cd "$SCRATCH" && CI=true timeout --kill-after="${KILL_GRACE_SECONDS}s" "${RUN_BUDGET_SECONDS}s" pnpm test:e2e) \
  >"$SCRATCH_LOG" 2>&1 &
SCRATCH_PID=$!

here_status=0
wait "$HERE_PID" || here_status=$?
HERE_PID=""

scratch_status=0
wait "$SCRATCH_PID" || scratch_status=$?
SCRATCH_PID=""

# ── What happened ──────────────────────────────────────────────────────────

report() {
  local name="$1" status="$2" log="$3" ports="$4"
  echo
  echo "── $name ($ports), exit $status ──"
  tail -n "$TAIL_LINES" "$log"
  if [ "$status" = "124" ] || [ "$status" = "137" ]; then
    echo "✖ repro: $name did not finish inside ${RUN_BUDGET_SECONDS}s and was killed. A run that never"
    echo "  ends is the failure this check exists to catch; look for a bind that never settles."
  fi
}

report "this checkout" "$here_status" "$HERE_LOG" "$HERE_PORTS"
report "scratch worktree" "$scratch_status" "$SCRATCH_LOG" "$SCRATCH_PORTS"

echo
if [ "$here_status" -ne 0 ] || [ "$scratch_status" -ne 0 ]; then
  echo "✖ repro: two concurrent browser tiers did NOT both pass (this checkout $here_status, scratch $scratch_status)."
  exit 1
fi

echo "✅ repro: two working trees ran the browser tier at the same time and both passed."
