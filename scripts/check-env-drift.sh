#!/usr/bin/env bash
# check-env-drift.sh: fail when the node or pnpm sources of the three apps
# disagree. Needs only bash, grep, sed and awk: no nix, no node, no jq.
#
# Node. The target is the nodejs_<N> attribute in flake.nix. Checked against it:
#   - the .nvmrc major of every app that has one (equal),
#   - the toolbox node major, `toolbox run -c ts-dev node --version` (equal),
#   - the lower bound of every engines.node (at most the target),
#   - every Dockerfile node image, read from `FROM node:<N>` or from an
#     `ARG ...=node:<N>` default (equal), printed as an IMAGE line,
#   - every `node-version: <N>` and `node:<N>` in .github/workflows (equal),
#     printed as an IMAGE line; release-app.yml must carry one.
# pnpm. The reference is packageManager in apps/app/package.json:
#   - packageManager is pnpm@x.y.z and identical in all three apps,
#   - the flake pnpm_<M> major equals its major,
#   - no Dockerfile and no workflow carries a pnpm version literal (pnpm@<n>)
#     or installs pnpm with npm: corepack reads packageManager instead.
#
# Output: one `DRIFT: <source> says <value>, <reference> says <value>` line
# per disagreement and exit 1. With no node drift `OK: node <target>`, with
# no pnpm drift `OK: pnpm <version>`; exit 0 when both are OK.
#
# Options:
#   --root <dir>          read a scratch tree instead of this repo
#   --toolbox-major <n>   use <n> as the toolbox node major instead of asking
#                         the toolbox; `skip` behaves as if no toolbox exists
set -uo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
toolbox_major=""
while [ $# -gt 0 ]; do
  case "$1" in
    --root) root=${2:?--root needs a directory}; shift 2 ;;
    --toolbox-major) toolbox_major=${2:?--toolbox-major needs a number or skip}; shift 2 ;;
    *) echo "usage: $0 [--root <dir>] [--toolbox-major <n>|skip]" >&2; exit 2 ;;
  esac
done
[ -f "$root/flake.nix" ] || { echo "ERROR: $root/flake.nix not found, is --root the openplate root?" >&2; exit 2; }

APPS=(app core inference)
node_drift=0
pnpm_drift=0
drift_node() { echo "DRIFT: $*"; node_drift=1; }
drift_pnpm() { echo "DRIFT: $*"; pnpm_drift=1; }

# Lines that are not comments, for Dockerfiles and YAML.
code() { grep -vE '^[[:space:]]*#' "$1"; }
major() { sed -E 's/^[^0-9]*//; s/[^0-9].*$//'; }
dockerfile_of() { if [ "$1" = app ]; then echo "apps/app/Dockerfile.pnpm"; else echo "apps/$1/Dockerfile"; fi; }
# A string field of package.json, or nothing. Flat objects only, which is
# what engines and packageManager are.
pkg_field() { # <file> <key> [<parent>]
  local flat
  flat=$(tr -d '\n' <"$1")
  if [ -n "${3:-}" ]; then
    flat=$(printf '%s' "$flat" | grep -oE "\"$3\"[[:space:]]*:[[:space:]]*\\{[^}]*\\}" | head -1)
  fi
  printf '%s' "$flat" | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)"$/\1/'
}

# ── node ────────────────────────────────────────────────────────────────────
target=$(code "$root/flake.nix" | grep -oE 'nodejs_[0-9]+' | head -1 | major)
if [ -z "$target" ]; then
  drift_node "flake.nix says no nodejs_<N> attribute, flake says nothing to compare"
  target="?"
fi

for a in "${APPS[@]}"; do
  f="apps/$a/.nvmrc"
  [ -f "$root/$f" ] || continue
  n=$(head -1 "$root/$f" | major)
  [ "$n" = "$target" ] || drift_node "$f says ${n:-nothing}, flake says $target"
done

if [ "$toolbox_major" = skip ] || { [ -z "$toolbox_major" ] && ! command -v toolbox >/dev/null 2>&1; }; then
  echo "SKIP: toolbox node major not checked, no toolbox on this host"
else
  if [ -z "$toolbox_major" ]; then
    v=$(toolbox run -c ts-dev node --version </dev/null 2>/dev/null | tail -1)
    toolbox_major=$(printf '%s' "$v" | major)
  fi
  if [ -z "$toolbox_major" ]; then
    echo "SKIP: toolbox node major not checked, toolbox ts-dev gave no node version"
  elif [ "$toolbox_major" != "$target" ]; then
    drift_node "toolbox ts-dev says $toolbox_major, flake says $target"
  fi
fi

for a in "${APPS[@]}"; do
  f="apps/$a/package.json"
  [ -f "$root/$f" ] || { drift_node "$f says missing, flake says $target"; continue; }
  range=$(pkg_field "$root/$f" node engines)
  floor=$(printf '%s' "$range" | major)
  if [ -z "$floor" ]; then
    drift_node "$f engines.node says ${range:-nothing}, flake says $target"
  elif [ "$target" != "?" ] && [ "$floor" -gt "$target" ]; then
    drift_node "$f engines.node says $range, flake says $target"
  fi
done

# Every node major an image file names. `node:<N>` covers FROM lines, ARG
# defaults and docker run lines; `node-version: <N>` covers setup-node.
image_majors() { code "$1" | grep -oE '(node:|node-version:[[:space:]]*["'"'"']?)[0-9]+' | major | awk '!seen[$0]++'; }
image_line() { # <relative file> <required: 1|0>
  local f=$1 majors first m
  majors=$(image_majors "$root/$f")
  if [ -z "$majors" ]; then
    [ "$2" = 1 ] && drift_node "$f says no node image, flake says $target"
    return
  fi
  first=$(printf '%s\n' "$majors" | head -1)
  echo "IMAGE: $f node $first, flake says $target"
  while IFS= read -r m; do
    [ "$m" = "$target" ] || drift_node "$f says $m, flake says $target"
  done <<<"$majors"
}
for a in "${APPS[@]}"; do
  f=$(dockerfile_of "$a")
  [ -f "$root/$f" ] || { drift_node "$f says missing, flake says $target"; continue; }
  image_line "$f" 1
done
if [ -f "$root/.github/workflows/release-app.yml" ]; then
  image_line .github/workflows/release-app.yml 1
else
  drift_node ".github/workflows/release-app.yml says missing, flake says $target"
fi
for w in "$root"/.github/workflows/*.yml "$root"/.github/workflows/*.yaml; do
  [ -f "$w" ] || continue
  f=${w#"$root"/}
  [ "$f" = .github/workflows/release-app.yml ] && continue
  image_line "$f" 0
done

[ "$node_drift" = 0 ] && echo "OK: node $target"

# ── pnpm ────────────────────────────────────────────────────────────────────
ref=""
[ -f "$root/apps/app/package.json" ] && ref=$(pkg_field "$root/apps/app/package.json" packageManager)
if ! printf '%s' "$ref" | grep -qE '^pnpm@[0-9]+\.[0-9]+\.[0-9]+$'; then
  drift_pnpm "apps/app/package.json packageManager says ${ref:-nothing}, the rule says pnpm@x.y.z"
fi
for a in core inference; do
  f="apps/$a/package.json"
  [ -f "$root/$f" ] || continue
  pm=$(pkg_field "$root/$f" packageManager)
  [ "$pm" = "$ref" ] || drift_pnpm "$f packageManager says ${pm:-nothing}, apps/app says ${ref:-nothing}"
done
ref_version=${ref#pnpm@}
ref_major=$(printf '%s' "$ref_version" | major)

flake_pnpm=$(code "$root/flake.nix" | grep -oE 'pnpm_[0-9]+' | head -1 | major)
if [ -z "$flake_pnpm" ]; then
  drift_pnpm "flake.nix says no pnpm_<M> attribute, packageManager says ${ref_version:-nothing}"
elif [ "$flake_pnpm" != "$ref_major" ]; then
  drift_pnpm "flake.nix says pnpm_$flake_pnpm, packageManager says ${ref_version:-nothing}"
fi

pnpm_files=()
for a in "${APPS[@]}"; do
  f=$(dockerfile_of "$a")
  [ -f "$root/$f" ] && pnpm_files+=("$f")
done
for w in "$root"/.github/workflows/*.yml "$root"/.github/workflows/*.yaml; do
  [ -f "$w" ] && pnpm_files+=("${w#"$root"/}")
done
for f in "${pnpm_files[@]}"; do
  lit=$(code "$root/$f" | grep -oE 'pnpm@[0-9][0-9.]*' | head -1)
  [ -z "$lit" ] || drift_pnpm "$f says $lit, packageManager says ${ref_version:-nothing} (corepack reads it, a file carries no pnpm version)"
  if code "$root/$f" | grep -qE '(^|[^[:alnum:]_-])npm[[:space:]]+(i|install|add)[^|&;]*[[:space:]]pnpm'; then
    drift_pnpm "$f says npm install of pnpm, packageManager says ${ref_version:-nothing} (install pnpm with corepack)"
  fi
done

[ "$pnpm_drift" = 0 ] && echo "OK: pnpm $ref_version"

[ "$node_drift" = 0 ] && [ "$pnpm_drift" = 0 ] && exit 0
exit 1
