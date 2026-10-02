#!/usr/bin/env bash
# The SCOPED browser tier: only the specs a push can affect.
#
#   scripts/e2e-scoped.sh [playwright arguments...]
#   pnpm test:e2e:scoped
#
# WHY. The full tier is minutes of browser time, and most pushes touch a corner
# of the app. The pre-push gate runs this instead; a release tag push and the
# nightly run the FULL tier (scripts/e2e-sharded.sh), so a miss here is caught
# within a day and never reaches a release.
#
# HOW. The root hook exports OPENPLATE_PUSH_RANGE=<base>..<head> for a push of
# exactly one content ref. This script lists the changed paths under apps/app/,
# strips that prefix, and gives them on stdin to the selector
# (scripts/e2e-select.ts), which prints either the word `all` or the spec files
# to run, one per line. Then it hands over to scripts/e2e-sharded.sh, which
# caps the shard count by the number of specs.
#
# It runs the FULL tier, and says why in one line, when
#   * OPENPLATE_E2E_FULL=1 is set,
#   * OPENPLATE_PUSH_RANGE is unset or empty (more than one ref, a base that
#     could not be computed, or a person running `pnpm test:e2e:scoped` by
#     hand): guessing "nothing changed" would pass untested code,
#   * the selector says `all` (the push touches shared code).
# An empty selection is a pass: no spec covers the change.
#
# OPENPLATE_E2E_RETRIES (0 to 3, read by playwright.config.ts) is exported here:
# 1 on every full-tier path, 0 on the scoped path, unless the caller set it.
#
# Test seam: OPENPLATE_E2E_SELECT is a command (run through `bash -c`) that
# replaces `node --import tsx scripts/e2e-select.ts`. It reads the same stdin
# and prints the same words. scripts/test-e2e-scoped.sh uses it.
set -euo pipefail

app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$app_dir"

select_cmd=${OPENPLATE_E2E_SELECT:-node --import tsx scripts/e2e-select.ts}

# The full tier gets one retry by default and the scoped tier none. On a loaded
# host a layout spec can fail once and pass 18 of 18 alone; Playwright lists a
# test that passes on retry as flaky by name and exits 0. The scoped tier keeps
# 0, so a real race in a push still fails loudly. A caller's value wins.
run_full() {
  export OPENPLATE_E2E_RETRIES=${OPENPLATE_E2E_RETRIES:-1}
  echo "e2e-scoped: full tier ($1), retries=$OPENPLATE_E2E_RETRIES"
  exec bash scripts/e2e-sharded.sh "${@:2}"
}

if [ "${OPENPLATE_E2E_FULL:-0}" = "1" ]; then
  run_full "OPENPLATE_E2E_FULL=1" "$@"
fi
if [ -z "${OPENPLATE_PUSH_RANGE:-}" ]; then
  run_full "no single pushed range to scope by" "$@"
fi

repo_root=$(git rev-parse --show-toplevel)
# `|| true`: grep exits 1 for a push that touched nothing under apps/app/.
changed=$(git -C "$repo_root" diff --name-only "$OPENPLATE_PUSH_RANGE" | grep '^apps/app/' | sed 's#^apps/app/##' || true)

# stderr stays on the terminal: the selector explains itself there.
selection=$(printf '%s' "$changed" | bash -c "$select_cmd")

if [ "$selection" = "all" ]; then
  run_full "the push touches shared code" "$@"
fi
if [ -z "$selection" ]; then
  echo "e2e-scoped: no browser specs for this push"
  exit 0
fi

specs=()
while IFS= read -r spec; do
  [ -z "$spec" ] || specs+=("$spec")
done <<<"$selection"

export OPENPLATE_E2E_RETRIES=${OPENPLATE_E2E_RETRIES:-0}
echo "e2e-scoped: ${#specs[@]} specs, retries=$OPENPLATE_E2E_RETRIES"
printf '  %s\n' "${specs[@]}"
exec bash scripts/e2e-sharded.sh "${specs[@]}" "$@"
