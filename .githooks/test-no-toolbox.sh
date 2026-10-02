#!/usr/bin/env bash
# Proves the four app pre-push hooks run without the toolbox. M269 spec 08.
#
# A contributor has Node, pnpm and make, and no `toolbox` and no container.
# Each hook must then run its stages with the node and pnpm on PATH. Before
# M269 every hook refused that case with "no ts-dev toolbox and not inside a
# container", so nobody outside the maintainer's workstation could push.
#
# Each run gets a PATH built from symlinks to plain system tools plus the real
# node. `toolbox`, `podlet`, `nc` and the real pnpm are never on it. pnpm is a
# STUB that records every call ("<CI>|<arguments>") and passes, so a run proves
# which stages the hook reaches, in which order and how, and never runs a real
# suite, a database or the network. The stub can play a missing Chromium or a
# missing network. Two things stay real: node (the Postgres probe in the core
# hook is real node against a real socket) and, for the podlet rows, the app's
# own scripts/check-docs-manifest.sh and scripts/quadlet.sh.
#
# Cases, for each app:
#   * with no toolbox, the hook gets past the toolbox selection and runs lint
#     with CI=true and the pnpm on PATH;
#   * fed a synthetic push line, it runs every stage it has;
#   * the control: fed empty stdin, it runs no stage, and the same check FAILS;
#   * with a `toolbox` that lists a ts-dev container, it still runs its stages
#     in ts-dev, and with a toolbox that has no ts-dev it runs them bare.
# Then one case per row of the `## Stage needs` table in spec 08: a missing
# outside tool is named, with the way to get it, and the hook exits 1.
#
# After the suite passes it runs itself again against broken copies of the
# hooks and requires every run to FAIL, in the style of test-dispatch.sh.
#
#   .githooks/test-no-toolbox.sh                 the suite, then the self-test
#   .githooks/test-no-toolbox.sh --no-self-test  the suite only
#
# HOOKS_DIR, when set, holds <app>.pre-push files that replace the real
# apps/<app>/.githooks/pre-push. The self-test sets it to the broken copies.
set -euo pipefail

self=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/$(basename -- "$0")
root=$(dirname -- "$(dirname -- "$self")")
HOOKS_DIR=${HOOKS_DIR:-}
self_test=1
[ "${1:-}" = "--no-self-test" ] && self_test=0

APPS="app core inference website"
ZERO=0000000000000000000000000000000000000000
failures=0

ok() { echo "ok - $1"; }
not_ok() {
  echo "not ok - $1"
  failures=$((failures + 1))
}

hook_of() {
  if [ -n "$HOOKS_DIR" ]; then echo "$HOOKS_DIR/$1.pre-push"; else echo "$root/apps/$1/.githooks/pre-push"; fi
}

# Inside a container every hook takes its container branch, so the path this
# suite exists for is never reached. A pass there would prove nothing.
if [ -f /run/.containerenv ] || [ -f /.dockerenv ]; then
  echo "not ok - this suite must run outside a container: inside one, every hook takes its container branch"
  exit 1
fi
real_node=$(command -v node) || {
  echo "not ok - node is not on PATH, and this suite runs the hooks' node probes for real"
  exit 1
}

scratch=$(mktemp -d "${TMPDIR:-/tmp}/test-no-toolbox.XXXXXX")
listener_pid=
cleanup() {
  [ -n "$listener_pid" ] && kill "$listener_pid" 2>/dev/null
  rm -rf "$scratch"
}
trap cleanup EXIT

# ── the PATH a contributor has: plain tools and node, nothing else ──────────
sys=$scratch/sys
mkdir -p "$sys"
for tool in sh bash env git sed grep awk cat mkdir rm mktemp dirname basename head tail tr cut \
  sort uniq wc find diff cmp comm python3 ls touch chmod readlink realpath sleep date tee xargs \
  printf test expr id uname; do
  p=$(command -v "$tool" 2>/dev/null) || continue
  case "$p" in /*) ln -s "$p" "$sys/$tool" ;; esac
done
ln -s "$real_node" "$sys/node"

stub=$scratch/stub
mkdir -p "$stub"
cat >"$stub/pnpm" <<'STUB'
#!/bin/sh
# Stub pnpm: records "<CI>|<arguments>", plays a missing browser or network.
printf '%s|%s\n' "${CI:-unset}" "$*" >>"$STUB_LOG"
case "$*" in
  *"exec node -e"*chromium*)
    [ "${STUB_NO_CHROMIUM:-0}" = "1" ] && exit 1
    exit 0
    ;;
  sync:docs)
    if [ "${STUB_NO_NETWORK:-0}" = "1" ]; then
      echo "fatal: unable to access 'https://github.com/LowCarbCheck/openplate.git/': Could not resolve host: github.com" >&2
      exit 128
    fi
    ;;
esac
exit 0
STUB
mkdir -p "$scratch/with-toolbox"
cat >"$scratch/with-toolbox/toolbox" <<'STUB'
#!/bin/sh
# Stub toolbox: records the call, lists the containers named in
# STUB_TOOLBOX_CONTAINERS, and runs what follows `run -c ts-dev`.
printf 'toolbox|%s\n' "$*" >>"$STUB_LOG"
if [ "$1 $2" = "list -c" ]; then
  echo "CONTAINER ID  CONTAINER NAME     CREATED       STATUS   IMAGE NAME"
  for c in ${STUB_TOOLBOX_CONTAINERS:-}; do
    echo "fbae04df892b  $c  2 days ago  running  quay.io/toolbx/ubuntu-toolbox:24.04"
  done
  exit 0
fi
[ "$1 $2 $3" = "run -c ts-dev" ] || exit 99
shift 3
exec "$@"
STUB
chmod +x "$stub/pnpm" "$scratch/with-toolbox/toolbox"

for dir in "$sys" "$stub"; do
  if PATH=$dir command -v toolbox >/dev/null 2>&1; then
    echo "not ok - the test PATH has a toolbox in $dir, the suite would test nothing"
    exit 1
  fi
done

# ── push lines ──────────────────────────────────────────────────────────────
push_line=$scratch/push-line
echo "refs/heads/make-check $(git -C "$root" rev-parse HEAD) refs/heads/make-check $ZERO" >"$push_line"

# ── a Postgres stand-in: any listening socket satisfies the core probe ──────
"$real_node" -e '
  const server = require("node:net").createServer((c) => c.end());
  server.listen(0, "127.0.0.1", () => console.log(server.address().port));
  setTimeout(() => process.exit(0), 600000);
' >"$scratch/listener-port" &
listener_pid=$!
for _ in $(seq 1 50); do [ -s "$scratch/listener-port" ] && break; sleep 0.1; done
pg_up=$(cat "$scratch/listener-port")
# A port nothing listens on: ask the kernel for a free one, then close it.
pg_down=$("$real_node" -e '
  const s = require("node:net").createServer();
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => console.log(p)); });
')

# ── sandboxes: an app folder with stub first-tier scripts ───────────────────
# The docs manifest and quadlet scripts are stubbed here; the podlet rows below
# run the real ones in the real app folder.
sandbox() {
  local app=$1 dir=$scratch/sb-$1
  rm -rf "$dir"
  mkdir -p "$dir/scripts"
  for s in check-docs-manifest.sh quadlet.sh; do
    printf '#!/bin/sh\necho "stub %s $*"\n' "$s" >"$dir/scripts/$s"
    chmod +x "$dir/scripts/$s"
  done
  if [ "$app" = website ]; then
    mkdir -p "$dir/src/generated" "$dir/public"
    echo '{"app":{"ref":"v1.0.0"},"core":{"ref":"core-v1.0.0"},"inference":{"ref":"inference-v1.0.0"}}' \
      >"$dir/src/generated/SOURCE.json"
    cp "$dir/src/generated/SOURCE.json" "$dir/public/SOURCE.json"
    git -C "$dir" init -q
    git -C "$dir" add -A
    git -C "$dir" -c user.name=t -c user.email=t@invalid -c commit.gpgsign=false commit -q -m fixture
  fi
  echo "$dir"
}

# run_hook <app> <dir> <stdin> <extra PATH or ''> [VAR=value ...]
# Sets $out (stdout and stderr), $rc and $calls (the stub log).
run_hook() {
  local app=$1 dir=$2 input=$3 extra=$4
  shift 4
  local log=$scratch/calls-$app
  : >"$log"
  local path=$stub:$sys
  [ -n "$extra" ] && path=$extra:$path
  rc=0
  out=$(cd "$dir" && env -i HOME="$HOME" LANG=C.UTF-8 PATH="$path" STUB_LOG="$log" \
    TEST_DATABASE_URL="postgres://u:p@127.0.0.1:$pg_up/t" "$@" \
    sh "$(hook_of "$app")" origin test-no-toolbox <"$input" 2>&1) || rc=$?
  calls=$(cat "$log")
}

# The stages each hook must reach, as the stub sees them (arguments only).
stages_of() {
  case "$1" in
    app) printf '%s\n' lint typecheck test:unit test:integration build test:e2e:sharded ;;
    core) printf '%s\n' lint format:check typecheck test:unit test:integration build ;;
    inference) printf '%s\n' lint typecheck check:doc-claims 'test --run' build ;;
    website) printf '%s\n' lint typecheck test:unit sync:docs build:stub-core test:e2e ;;
  esac
}

# ran_stages <app>: the hook printed its lint stage line and called every stage.
ran_stages() {
  printf '%s\n' "$out" | grep -qF '▶ pre-push: lint' || return 1
  local stage
  while IFS= read -r stage; do
    printf '%s\n' "$calls" | cut -d'|' -f2- | grep -qxF -- "$stage" || return 1
  done < <(stages_of "$1")
}

called() { printf '%s\n' "$calls" | cut -d'|' -f2- | grep -qxF -- "$1"; }
said() { printf '%s\n' "$out" | grep -qF -- "$1"; }

# ── per app: no toolbox, stages from a push line, the control, a toolbox ────
for app in $APPS; do
  dir=$(sandbox "$app")

  run_hook "$app" "$dir" "$push_line" ''
  if [ "$rc" = 0 ] && ! said 'cannot run the gate' && printf '%s\n' "$calls" | grep -qxF 'true|lint' \
    && ! printf '%s\n' "$calls" | grep -q '^toolbox|'; then
    ok "$app: no toolbox, the hook gets past the toolbox selection"
  else
    not_ok "$app: no toolbox, the hook stopped (exit $rc): $(printf '%s\n' "$out" | tail -2 | tr '\n' ' ')"
  fi
  if ran_stages "$app"; then
    ok "$app: the hook runs its stages from a synthetic push line"
  else
    not_ok "$app: from a synthetic push line the hook missed a stage, calls: $(printf '%s\n' "$calls" | tr '\n' ' ')"
  fi

  run_hook "$app" "$dir" /dev/null ''
  if ! ran_stages "$app" && said 'deletion-only push'; then
    ok "control $app: empty stdin runs no stage and the check fails"
  else
    not_ok "control $app: empty stdin still passed the stage check, so the check cannot fail"
  fi

  run_hook "$app" "$dir" "$push_line" "$scratch/with-toolbox" STUB_TOOLBOX_CONTAINERS='fedora-toolbox-42 ts-dev'
  if [ "$rc" = 0 ] && printf '%s\n' "$calls" | grep -qxF 'toolbox|run -c ts-dev env CI=true pnpm lint'; then
    ok "$app: with a toolbox, the stages still run in ts-dev"
  else
    not_ok "$app: with a toolbox, lint did not run through 'toolbox run -c ts-dev' (exit $rc)"
  fi

  # A toolbox with no ts-dev container (a stock Silverblue host) is a
  # contributor's host: the stages run bare. The case above is its control,
  # the same stub with ts-dev listed takes the toolbox path.
  run_hook "$app" "$dir" "$push_line" "$scratch/with-toolbox" STUB_TOOLBOX_CONTAINERS='fedora-toolbox-42 ts-dev-old'
  if [ "$rc" = 0 ] && printf '%s\n' "$calls" | grep -qxF 'true|lint' \
    && ! printf '%s\n' "$calls" | grep -q '^toolbox|run '; then
    ok "$app: a toolbox without ts-dev, the stages run with the node and pnpm on PATH"
  else
    not_ok "$app: a toolbox without ts-dev still sent the stages to toolbox run, or stopped (exit $rc)"
  fi
done

# ── Stage needs: one case per row of the table in spec 08 ───────────────────
# podlet: the REAL first-tier scripts in the REAL app folder, with no podlet.
for app in app core inference; do
  run_hook "$app" "$root/apps/$app" "$push_line" ''
  if [ "$rc" = 1 ] && said 'podlet is not on PATH' && said 'quadlet.sh --install' && ! said '▶ pre-push: lint'; then
    ok "$app quadlet: missing podlet is named and the hook exits 1"
  else
    not_ok "$app quadlet: with no podlet the hook gave exit $rc: $(printf '%s\n' "$out" | tail -2 | tr '\n' ' ')"
  fi
done

# app integration: the tier needs node and pnpm and nothing else (measured
# 2026-10-01 on a fresh Ubuntu 24.04 VM). Without pnpm the hook names it.
dir=$(sandbox app)
run_hook app "$dir" "$push_line" '' PATH="$sys"
if [ "$rc" = 1 ] && said 'pnpm is not on PATH' && said 'pnpm 11' && ! said '▶ pre-push: integration tests'; then
  ok "app integration: missing pnpm is named and the hook exits 1"
else
  not_ok "app integration: with no pnpm the hook gave exit $rc: $(printf '%s\n' "$out" | tail -2 | tr '\n' ' ')"
fi

# The app hook checks Chromium FIRST and runs its browser tier through the
# sharded runner; the website hook checks it late and runs `test:e2e`. So the
# app row also requires that no earlier stage ran: lint, the build and the unit
# tests never start on a host with no browser. (The old hook ran lint first, so
# that part of the row fails against it.)
for app in app website; do
  dir=$(sandbox "$app")
  run_hook "$app" "$dir" "$push_line" '' STUB_NO_CHROMIUM=1
  if [ "$app" = app ]; then
    tier=test:e2e:sharded
    early_stage_ran() { called lint || called test:unit || called build; }
  else
    tier=test:e2e
    early_stage_ran() { false; }
  fi
  if [ "$rc" = 1 ] && said 'Chromium will not start here' && said 'pnpm exec playwright install chromium' \
    && ! called "$tier" && ! early_stage_ran; then
    ok "$app browser: missing Chromium is named and the hook exits 1"
  else
    not_ok "$app browser: with no Chromium the hook gave exit $rc: $(printf '%s\n' "$out" | tail -3 | tr '\n' ' ')"
  fi
done

dir=$(sandbox core)
run_hook core "$dir" "$push_line" '' TEST_DATABASE_URL="postgres://u:p@127.0.0.1:$pg_down/t"
if [ "$rc" = 1 ] && said "no Postgres on 127.0.0.1:$pg_down" && said 'docker/compose.dev.yml' \
  && said 'SKIP_INTEGRATION=1' && ! called test:integration; then
  ok "core integration: missing Postgres is named and the hook exits 1"
else
  not_ok "core integration: with no Postgres the hook gave exit $rc: $(printf '%s\n' "$out" | tail -3 | tr '\n' ' ')"
fi

dir=$(sandbox website)
run_hook website "$dir" "$push_line" '' STUB_NO_NETWORK=1
if [ "$rc" = 1 ] && said 'the docs sync failed' && said 'so it needs the network' && said 'SKIP_SYNC=1' && ! called build:stub-core; then
  ok "website docs-sync: missing network is named and the hook exits 1"
else
  not_ok "website docs-sync: with no network the hook gave exit $rc: $(printf '%s\n' "$out" | tail -3 | tr '\n' ' ')"
fi

# ── result ──────────────────────────────────────────────────────────────────
if [ "$failures" != "0" ]; then
  echo "FAIL: $failures check(s) failed"
  exit 1
fi
echo "PASS: every check passed"

[ "$self_test" = "1" ] || exit 0

# ── self-test: a broken hook must fail this suite ───────────────────────────
# mutate <name> <app> <sed expression>: copy the four hooks, break one, rerun.
mutate() {
  local name=$1 app=$2 expr=$3
  local broken=$scratch/broken-$name
  mkdir -p "$broken"
  local a
  for a in $APPS; do cp "$root/apps/$a/.githooks/pre-push" "$broken/$a.pre-push"; done
  local target=$broken/$app.pre-push
  cp "$target" "$target.orig"
  sed -i "$expr" "$target"
  if cmp -s "$target" "$target.orig"; then
    echo "not ok - self-test $name: the mutation changed nothing, fix the sed expression"
    exit 1
  fi
  local result=0
  HOOKS_DIR=$broken "$self" --no-self-test >"$broken/log" 2>&1 || result=$?
  if [ "$result" = "0" ]; then
    echo "not ok - self-test $name: the suite PASSED a broken hook, it proves nothing"
    exit 1
  fi
  echo "ok - self-test $name: the suite fails ($(grep -c '^not ok' "$broken/log") check(s)), as it must"
}

# The old refusal, back in each hook's no-toolbox branch.
for app in $APPS; do
  mutate "refusal-$app" "$app" 's#^  for tool in node pnpm; do#  echo "no ts-dev toolbox, cannot run the gate"; exit 1\n  for tool in node pnpm; do#'
done
# A hook that reads every push as content, so empty stdin runs the stages.
mutate stdin inference 's#^has_content=0#has_content=1#'
# A Chromium message that no longer says how to get it.
mutate chromium-hint website 's#pnpm exec playwright install chromium"#install a browser"#'
# A Postgres probe that always says yes.
mutate postgres-probe core 's#socket.on("error", () => process.exit(1));#socket.on("error", () => process.exit(0));#'
# A docs sync failure that no longer names the network.
mutate network-hint website 's#so it needs the network#so it stopped#'
# A hook that takes any toolbox as ts-dev, as the hooks did before M269.
mutate any-toolbox core 's#^  \&\& toolbox list -c .*; then$#  ; then#'
# A missing pnpm that is no longer caught before the stages.
mutate pnpm-check app 's#^  for tool in node pnpm; do#  for tool in node; do#'
echo "PASS: the self-test caught every broken copy"
