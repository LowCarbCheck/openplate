#!/usr/bin/env bash
# test-check-env-drift.sh: prove scripts/check-env-drift.sh catches every
# source it claims to check.
#
# It copies the real files (flake.nix, the three package.json and .nvmrc
# files, the three Dockerfiles, the workflows) into a scratch tree, requires
# the unbroken copy to pass, then breaks one source per control in a fresh
# copy and requires exit 1 plus the DRIFT line that names that source. A
# mutation that changes nothing fails the suite, so no control can pass
# vacuously. The unbroken copy must pass first: on a tree that already
# drifts, every control would see exit 1 for the wrong reason.
#
# Usage: scripts/test-check-env-drift.sh [--source <openplate root>]
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source_root=$(cd "$here/.." && pwd)
while [ $# -gt 0 ]; do
  case "$1" in
    --source) source_root=$(cd "${2:?--source needs a directory}" && pwd); shift 2 ;;
    *) echo "usage: $0 [--source <openplate root>]" >&2; exit 2 ;;
  esac
done
check="$here/check-env-drift.sh"
scratch=$(mktemp -d)
trap 'rm -rf "${scratch:?}"' EXIT
failures=0
ok() { echo "ok - $*"; }
not_ok() { echo "not ok - $*"; failures=$((failures + 1)); }

APPS=(app core inference)
dockerfile_of() { if [ "$1" = app ]; then echo "apps/app/Dockerfile.pnpm"; else echo "apps/$1/Dockerfile"; fi; }

# fresh <name>: a new scratch copy of the real files, its path on stdout.
fresh() {
  local t=$scratch/$1 a f
  mkdir -p "$t/.github/workflows"
  cp "$source_root/flake.nix" "$t/"
  for a in "${APPS[@]}"; do
    mkdir -p "$t/apps/$a"
    for f in package.json .nvmrc; do
      [ -f "$source_root/apps/$a/$f" ] && cp "$source_root/apps/$a/$f" "$t/apps/$a/"
    done
    f=$(dockerfile_of "$a")
    [ -f "$source_root/$f" ] && cp "$source_root/$f" "$t/$f"
  done
  cp "$source_root"/.github/workflows/*.yml "$t/.github/workflows/" 2>/dev/null
  echo "$t"
}

# The values the controls break away from, read from the real files.
T=$(grep -vE '^[[:space:]]*#' "$source_root/flake.nix" | grep -oE 'nodejs_[0-9]+' | head -1 | sed 's/nodejs_//')
[ -n "$T" ] || { echo "FAIL: $source_root/flake.nix names no nodejs_<N>, nothing to test against"; exit 1; }
O=$((T - 2))
PM=$(tr -d '\n' <"$source_root/apps/app/package.json" | grep -oE '"packageManager"[[:space:]]*:[[:space:]]*"pnpm@[^"]*"' | sed -E 's/.*pnpm@([^"]*)"/\1/')
PM_MAJOR=${PM%%.*}

# ── the unbroken copy passes ────────────────────────────────────────────────
base=$(fresh base)
out=$("$check" --root "$base" --toolbox-major "$T" 2>&1)
rc=$?
if [ "$rc" = 0 ] && printf '%s\n' "$out" | grep -qx "OK: node $T" && printf '%s\n' "$out" | grep -qx "OK: pnpm $PM"; then
  ok "baseline: the unbroken copy passes with OK: node $T and OK: pnpm $PM"
else
  not_ok "baseline: the unbroken copy of $source_root must pass, got exit $rc"
  printf '%s\n' "$out" | sed 's/^/    /'
  echo "FAIL: the real files drift already, so no control below could prove anything"
  exit 1
fi

# control <name> <file to break> <sed expression|append:<line>> <DRIFT regex> [check args]
control() {
  local name=$1 file=$2 how=$3 want=$4
  shift 4
  local t
  t=$(fresh "$name")
  if [ ! -f "$t/$file" ]; then
    echo "$T" >"$t/$file" # an absent .nvmrc is planted at the target, then broken
  fi
  cp "$t/$file" "$t/$file.orig"
  case "$how" in
    append:*) printf '%s\n' "${how#append:}" >>"$t/$file" ;;
    *) sed -i -E "$how" "$t/$file" ;;
  esac
  if cmp -s "$t/$file" "$t/$file.orig"; then
    not_ok "control $name: the mutation of $file changed nothing, fix the expression"
    return
  fi
  rm -f "$t/$file.orig"
  local out rc=0 hit
  out=$("$check" --root "$t" --toolbox-major "$T" "$@" 2>&1) || rc=$?
  hit=$(printf '%s\n' "$out" | grep -E "^DRIFT: $want" | head -1)
  if [ "$rc" = 1 ] && [ -n "$hit" ]; then
    ok "control $name: exit 1 and $hit"
  else
    not_ok "control $name: want exit 1 and a line matching 'DRIFT: $want', got exit $rc"
    printf '%s\n' "$out" | sed 's/^/    /'
  fi
}

nvmrc=apps/app/.nvmrc
for a in "${APPS[@]}"; do [ -f "$source_root/apps/$a/.nvmrc" ] && { nvmrc=apps/$a/.nvmrc; break; }; done

# ── node: the dev sources ───────────────────────────────────────────────────
control flake flake.nix "s/nodejs_$T/nodejs_$O/g" ".* says $T, flake says $O\$"
control nvmrc "$nvmrc" "1s/.*/$O/" "${nvmrc//./\\.} says $O, flake says $T\$"
control engines apps/core/package.json "s/(\"node\"[[:space:]]*:[[:space:]]*\")[^\"]*\"/\\1>=$((T + 1))\"/" "apps/core/package\\.json engines\\.node says >=$((T + 1)), flake says $T\$"

# toolbox: the flag stands in for the toolbox, so this needs no file break.
out=$("$check" --root "$base" --toolbox-major "$O" 2>&1)
rc=$?
hit=$(printf '%s\n' "$out" | grep -E "^DRIFT: toolbox ts-dev says $O, flake says $T\$")
if [ "$rc" = 1 ] && [ -n "$hit" ]; then ok "control toolbox: exit 1 and $hit"; else not_ok "control toolbox: want exit 1 and a DRIFT line for the toolbox, got exit $rc"; printf '%s\n' "$out" | sed 's/^/    /'; fi
out=$("$check" --root "$base" --toolbox-major skip 2>&1)
rc=$?
if [ "$rc" = 0 ] && printf '%s\n' "$out" | grep -qx 'SKIP: toolbox node major not checked, no toolbox on this host'; then
  ok "no toolbox: the skip is loud and does not fail the run"
else
  not_ok "no toolbox: want exit 0 and the SKIP line, got exit $rc"
  printf '%s\n' "$out" | sed 's/^/    /'
fi

# ── node: the images ────────────────────────────────────────────────────────
control dockerfile apps/core/Dockerfile "s/node:$T/node:$O/g" "apps/core/Dockerfile says $O, flake says $T\$"
control dockerfile-arg apps/inference/Dockerfile "s/^(ARG [A-Z_]*=node:)$T/\\1$O/" "apps/inference/Dockerfile says $O, flake says $T\$"
control release-workflow .github/workflows/release-app.yml "s/(node-version:[[:space:]]*)$T/\\1$O/" "\\.github/workflows/release-app\\.yml says $O, flake says $T\$"

# A comment that names another node image is history, not a pin.
t=$(fresh comment)
printf '# this image ran on node:%s before\n' "$O" >>"$t/apps/core/Dockerfile"
out=$("$check" --root "$t" --toolbox-major "$T" 2>&1)
rc=$?
if [ "$rc" = 0 ]; then ok "a comment naming node:$O in a Dockerfile is not drift"; else not_ok "a comment naming node:$O was read as a pin, exit $rc"; printf '%s\n' "$out" | sed 's/^/    /'; fi

# ── pnpm ────────────────────────────────────────────────────────────────────
control packagemanager apps/inference/package.json "s/\"pnpm@$PM\"/\"pnpm@$PM_MAJOR.0.0\"/" "apps/inference/package\\.json packageManager says pnpm@$PM_MAJOR\\.0\\.0, apps/app says pnpm@$PM\$"
control flake-pnpm flake.nix "s/pnpm_$PM_MAJOR/pnpm_$((PM_MAJOR - 1))/g" "flake\\.nix says pnpm_$((PM_MAJOR - 1)), packageManager says $PM\$"
control dockerfile-pnpm apps/core/Dockerfile "append:RUN corepack prepare pnpm@$PM --activate" "apps/core/Dockerfile says pnpm@$PM, packageManager says"
control dockerfile-npm apps/inference/Dockerfile "append:RUN npm i -g pnpm" "apps/inference/Dockerfile says npm install of pnpm"
control workflow-pnpm .github/workflows/release-app.yml "append:      - run: npm install --global pnpm" "\\.github/workflows/release-app\\.yml says npm install of pnpm"

# ── result ──────────────────────────────────────────────────────────────────
if [ "$failures" != 0 ]; then
  echo "FAIL: $failures check(s) failed"
  exit 1
fi
echo "PASS: every source is controlled"
