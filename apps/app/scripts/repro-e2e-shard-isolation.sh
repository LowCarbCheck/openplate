#!/usr/bin/env bash
# Several shards of ONE checkout share no port and no fontconfig cache.
#
# The sibling of repro-e2e-port-collision.sh, which proves two TREES do not
# collide. This one proves two SHARDS of one tree do not, and it does it
# WITHOUT the real tier: no build, no browser, no spec. Each shard is a
# `tsx` process (scripts/e2e-shard-isolation-probe.ts) that does what a
# Playwright shard does before its first page: it takes the shard's port base
# and fontconfig config, then runs the tier's own global-setup.ts, so the cache
# wipe, the two fake services and the fixture account are all the real ones.
#
# THREE RUNS, in this order:
#   1. the real plan: every shard on its own ports and its own cache. All
#      shards must finish their setup, shard 1's canary file must survive the
#      other shards' cache wipes, and every fake service must still answer.
#   2. CONTROL, one cache: ports of their own, but no OPENPLATE_E2E_SHARD, so
#      every shard wipes the one directory the tier had before sharding. The
#      canary MUST be deleted, and this run must FAIL.
#   3. CONTROL, one port base: caches of their own, but every shard on the
#      same ports. The second shard's setup MUST die with EADDRINUSE, and this
#      run must FAIL.
# A proof that cannot fail proves nothing, so the script exits 0 only when run 1
# passes and both controls fail.
#
#   scripts/repro-e2e-shard-isolation.sh [shards]      default 3
#
# It needs node and the app's node_modules, and it needs no browser. The host's
# real fontconfig cache is never touched: XDG_CACHE_HOME is a scratch folder.
set -u

SHARDS=${1:-3}
case $SHARDS in
  '' | *[!0-9]* | 0 | 1)
    echo "✖ repro: the shard count has to be a whole number of 2 or more, got '$SHARDS'."
    exit 2
    ;;
esac

APP_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P) || exit 1
cd "$APP_DIR" || exit 1

readonly RUN_BUDGET_SECONDS=120

scratch=$(mktemp -d "${TMPDIR:-/tmp}/openplate-repro-shards-XXXXXX") || exit 1
pids=()
cleanup() {
  local pid
  for pid in ${pids[@]+"${pids[@]}"}; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$scratch"
}
trap cleanup EXIT INT TERM

# The plan, read from the same code the runner reads it from.
bases=()
while IFS= read -r base; do bases+=("$base"); done < <(node --import tsx tests/e2e/print-shard-ports.ts "$SHARDS")
if [ "${#bases[@]}" -ne "$SHARDS" ]; then
  echo "✖ repro: print-shard-ports.ts gave ${#bases[@]} bases for $SHARDS shards."
  exit 1
fi

echo "▶ repro: $SHARDS shards of this checkout"
all_ports=()
for ((i = 1; i <= SHARDS; i++)); do
  base=${bases[i - 1]}
  echo "▪ repro: shard $i takes ports $base, $((base + 1)), $((base + 2))"
  all_ports+=("$base" "$((base + 1))" "$((base + 2))")
done
distinct=$(printf '%s\n' "${all_ports[@]}" | sort -u | wc -l | tr -d ' ')
if [ "$distinct" != "${#all_ports[@]}" ]; then
  echo "✖ repro: the plan has ${#all_ports[@]} ports but only $distinct are different."
  exit 1
fi
echo "▪ repro: all ${#all_ports[@]} ports are different"

# One run of every shard. $1 names it, $2 is "own" or "shared" for the ports,
# $3 is "own" or "shared" for the cache. Prints each shard's lines, returns 0
# when every shard exited 0.
run_case() {
  local name=$1 ports=$2 cache=$3 dir=$scratch/$1 i base status=0
  mkdir -p "$dir/barrier" "$dir/xdg"
  pids=()
  for ((i = 1; i <= SHARDS; i++)); do
    base=${bases[i - 1]}
    [ "$ports" = shared ] && base=${bases[0]}
    (
      export PROBE_INDEX=$i PROBE_COUNT=$SHARDS PROBE_DIR=$dir/barrier XDG_CACHE_HOME=$dir/xdg
      export OPENPLATE_E2E_PORT_BASE=$base
      if [ "$cache" = own ]; then export OPENPLATE_E2E_SHARD=$i; else unset OPENPLATE_E2E_SHARD; fi
      exec timeout "${RUN_BUDGET_SECONDS}s" node --import tsx scripts/e2e-shard-isolation-probe.ts
    ) >"$dir/shard-$i.log" 2>&1 &
    pids+=($!)
  done
  for ((i = 1; i <= SHARDS; i++)); do
    wait "${pids[i - 1]}" || status=1
  done
  pids=()
  for ((i = 1; i <= SHARDS; i++)); do sed "s/^/  [$name shard $i] /" "$dir/shard-$i.log" | tail -n 4; done
  return "$status"
}

result=0

echo "▶ repro: run 1, the real plan (own ports, own cache per shard)"
if run_case real own own; then
  echo "✅ repro: run 1 passed: every shard set up, the canary survived, every fake service answers"
else
  echo "✖ repro: run 1 FAILED: the shards of one checkout are not isolated"
  result=1
fi

echo "▶ repro: control A, one shared cache directory (this run must FAIL)"
if run_case shared-cache own shared; then
  echo "✖ repro: control A PASSED: a shared cache did not destroy the canary, so run 1 proves nothing about the cache"
  result=1
else
  echo "✅ repro: control A failed as it must: one shared cache is deleted under a sibling"
fi

echo "▶ repro: control B, one shared port base (this run must FAIL)"
if run_case shared-ports shared own; then
  echo "✖ repro: control B PASSED: shards on one port base did not collide, so run 1 proves nothing about the ports"
  result=1
else
  echo "✅ repro: control B failed as it must: shards on one port base collide"
fi

[ "$result" = 0 ] && echo "✅ repro: $SHARDS shards of one checkout share no port and no fontconfig cache"
exit "$result"
