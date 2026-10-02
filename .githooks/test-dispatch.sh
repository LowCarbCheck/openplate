#!/usr/bin/env bash
# Proves the root pre-push dispatcher (.githooks/pre-push) picks the right
# apps. M262 spec 05.
#
# It builds a scratch repository with the real root hook and a STUB pre-push
# in each of the three apps that records its name, its git prefix and the stdin it was given. Then
# it pushes to a scratch bare origin, from the main checkout and from a linked
# worktree, and feeds hand-written ref lines, and checks which stubs ran.
# Nothing here touches this repository, a database or the network.
#
# After the suite passes it runs itself again against broken copies (a path
# mapping that sends apps/core to inference, a pre-push that does not export
# GIT_WORK_TREE, and a pre-push that lets flake.nix skip the run-all rule) and
# requires every run to FAIL. A suite that passes a broken dispatcher proves
# nothing.
#
#   .githooks/test-dispatch.sh                 the suite, then the self-test
#   .githooks/test-dispatch.sh --no-self-test  the suite only
#
# HOOKS_DIR names the files under test; it defaults to the folder beside this
# script. The self-test sets it to the broken copies.
set -euo pipefail

self=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/$(basename -- "$0")
HOOKS_DIR=${HOOKS_DIR:-$(dirname -- "$self")}
self_test=1
[ "${1:-}" = "--no-self-test" ] && self_test=0

# A run started from inside a hook must not aim git at the outer repository.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX SKIP_TESTS GIT_DIFF_OVERRIDE

scratch=$(mktemp -d "${TMPDIR:-/tmp}/test-dispatch.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
export DISPATCH_TEST_LOG="$scratch/ran.log"
ZERO=0000000000000000000000000000000000000000
failures=0

ok() { echo "ok - $1"; }
not_ok() {
  echo "not ok - $1"
  failures=$((failures + 1))
}

# ── the scratch repository ──────────────────────────────────────────────────
git init -q --bare -b main "$scratch/origin.git"
git init -q -b main "$scratch/repo"
repo=$scratch/repo
git -C "$repo" config user.name test-dispatch
git -C "$repo" config user.email test-dispatch@invalid
git -C "$repo" config commit.gpgsign false
git -C "$repo" config core.hooksPath .githooks
git -C "$repo" remote add origin "$scratch/origin.git"

mkdir -p "$repo/.githooks"
cp "$HOOKS_DIR/pre-push" "$repo/.githooks/"
for app in app core inference; do
  mkdir -p "$repo/apps/$app/.githooks"
  cat >"$repo/apps/$app/.githooks/pre-push" <<'STUB'
#!/usr/bin/env bash
# Stub gate: records who ran, from where, with which stdin.
set -euo pipefail
app=$(basename "$PWD")
input=$(cat)
printf '%s\n' "$input" >"$DISPATCH_TEST_LOG.stdin.$app"
printf '%s prefix=%s\n' "$app" "$(git rev-parse --show-prefix)" >>"$DISPATCH_TEST_LOG"
if [ "${STUB_FAIL_APP:-}" = "$app" ]; then exit 3; fi
exit 0
STUB
  echo "$app" >"$repo/apps/$app/README.md"
done
chmod +x "$repo"/.githooks/* "$repo"/apps/*/.githooks/*

git -C "$repo" add -A
git -C "$repo" commit -q --no-verify -m init
git -C "$repo" push -q --no-verify origin main 2>/dev/null
base_sha=$(git -C "$repo" rev-parse HEAD)

# ── helpers ─────────────────────────────────────────────────────────────────
# dispatch <stdin> [env assignments...]: runs the root pre-push from the repo
# root, as git does. Sets $out, $rc and $ran (the apps that ran, in order).
dispatch() {
  local input=$1
  shift
  : >"$DISPATCH_TEST_LOG"
  rc=0
  out=$(cd "$repo" && env "$@" ./.githooks/pre-push 2>&1 <<<"$input") || rc=$?
  collect
}

collect() {
  ran=$(awk '{print $1}' "$DISPATCH_TEST_LOG" | tr '\n' ' ' | sed 's/ $//')
}

# every stub that ran saw itself as apps/<app>/, so git works from its cwd
prefixes_ok() {
  local app prefix
  while read -r app prefix; do
    [ "$prefix" = "prefix=apps/$app/" ] || return 1
  done <"$DISPATCH_TEST_LOG"
}

expect_ran() {
  local name=$1 want=$2 want_rc=${3:-0}
  if [ "$ran" = "$want" ] && [ "$rc" = "$want_rc" ] && prefixes_ok; then
    ok "$name (ran: ${ran:-none}, exit $rc)"
  else
    not_ok "$name: want ran '${want:-none}' exit $want_rc, got '${ran:-none}' exit $rc"
    printf '%s\n' "$out" "$(cat "$DISPATCH_TEST_LOG")" | sed 's/^/    /'
  fi
}

expect_out() {
  local name=$1 pattern=$2
  if grep -qE -- "$pattern" <<<"$out"; then
    ok "$name"
  else
    not_ok "$name: output lacks /$pattern/"
    printf '%s\n' "$out" | sed 's/^/    /'
  fi
}

push_line="refs/heads/main $base_sha refs/heads/main $ZERO"

# ── GIT_DIFF_OVERRIDE: the app selection ────────────────────────────────────
dispatch "$push_line" GIT_DIFF_OVERRIDE='apps/core/README.md'
expect_ran "a core-only path list runs core only" "core"
for other in app inference; do
  expect_out "  and logs apps/$other as skipped" "apps/$other skipped"
done

dispatch "$push_line" GIT_DIFF_OVERRIDE=$'apps/inference/src/x.ts\napps/app/app/root.tsx'
expect_ran "an inference plus app path list runs exactly those two" "app inference"
expect_out "  and logs apps/core as skipped" "apps/core skipped"

dispatch "$push_line" GIT_DIFF_OVERRIDE='.github/workflows/x.yml'
expect_ran "a root-only path runs all three" "app core inference"

# The flake sets the node and pnpm every app runs under in a nix shell, so a
# change to it can break any app. Pinned here, so a dispatcher tidy-up that
# counted only the apps/ prefixes cannot drop the rule quietly.
dispatch "$push_line" GIT_DIFF_OVERRIDE='flake.nix'
expect_ran "a root flake.nix change runs all three" "app core inference"

dispatch "$push_line" GIT_DIFF_OVERRIDE='flake.lock'
expect_ran "a root flake.lock change runs all three" "app core inference"

dispatch "$push_line" GIT_DIFF_OVERRIDE='docker/compose.yml'
expect_ran "a root docker/ path runs all three, the app among them" "app core inference"

dispatch "$push_line" GIT_DIFF_OVERRIDE='apps/newapp/x.ts'
expect_ran "a folder under apps/ that is none of the three runs all three" "app core inference"

dispatch "refs/heads/gone $ZERO refs/heads/gone $base_sha" GIT_DIFF_OVERRIDE='apps/core/README.md'
expect_ran "a deletion-only push runs none" ""
expect_out "  and says deletion-only" "deletion-only push"

dispatch "$push_line" GIT_DIFF_OVERRIDE='.github/workflows/x.yml' STUB_FAIL_APP=core
expect_ran "a failing core gate stops the push, inference never runs" "app core" 3
expect_out "  and names the failed app" "apps/core gate failed with exit 3"

dispatch "$push_line" SKIP_TESTS=1 GIT_DIFF_OVERRIDE='apps/core/README.md'
expect_ran "SKIP_TESTS=1 runs none" ""
expect_out "  and logs the warning" "gate SKIPPED explicitly \\(SKIP_TESTS=1\\)"

two_lines="$push_line"$'\n'"refs/tags/v1 $base_sha refs/tags/v1 $ZERO"
dispatch "$two_lines" GIT_DIFF_OVERRIDE='apps/inference/README.md'
if [ "$ran" = "inference" ] && [ "$(cat "$DISPATCH_TEST_LOG.stdin.inference")" = "$two_lines" ]; then
  ok "the app hook gets the same stdin lines the dispatcher got"
else
  not_ok "stdin replay: ran '$ran', stdin '$(cat "$DISPATCH_TEST_LOG.stdin.inference" 2>/dev/null)'"
fi

dispatch "refs/heads/main $base_sha refs/heads/main 1111111111111111111111111111111111111111"
expect_ran "a remote sha this clone lacks runs all three" "app core inference"
expect_out "  and says why" "is not in this clone"

# ── real pushes: git writes the stdin, git diff computes the range ──────────
real_push() {
  local dir=$1 ref=$2
  : >"$DISPATCH_TEST_LOG"
  rc=0
  out=$(git -C "$dir" push origin "$ref" 2>&1) || rc=$?
  collect
}

echo core >>"$repo/apps/core/README.md"
git -C "$repo" commit -q -am "touch core"
real_push "$repo" main
expect_ran "a real push of a core commit runs core only" "core"

git -C "$repo" checkout -q -b feat
echo inference >>"$repo/apps/inference/README.md"
git -C "$repo" commit -q -am "touch inference"
real_push "$repo" feat
expect_ran "a real new-branch push diffs from the merge-base, runs inference only" "inference"
git -C "$repo" checkout -q main

git -C "$repo" worktree add -q -b linked "$scratch/linked" main
echo app >>"$scratch/linked/apps/app/README.md"
git -C "$scratch/linked" commit -q -am "touch app"
real_push "$scratch/linked" linked
expect_ran "a real push from a linked worktree runs app, and git inside it sees apps/app/" "app"

# ── result ──────────────────────────────────────────────────────────────────
if [ "$failures" != "0" ]; then
  echo "FAIL: $failures check(s) failed"
  exit 1
fi
echo "PASS: every check passed"

[ "$self_test" = "1" ] || exit 0

# ── self-test: a broken dispatcher must fail this suite ─────────────────────
# mutate <name> <file> <sed expression>: copy the hooks, break one, rerun.
mutate() {
  local name=$1 file=$2 expr=$3
  local broken=$scratch/broken-$name
  mkdir -p "$broken/hooks"
  cp "$HOOKS_DIR/pre-push" "$broken/hooks/"
  local target=$broken/$file
  cp "$target" "$target.orig"
  sed -i "$expr" "$target"
  if cmp -s "$target" "$target.orig"; then
    echo "not ok - self-test $name: the mutation changed nothing, fix the sed expression"
    exit 1
  fi
  local result=0
  HOOKS_DIR=$broken/hooks \
    "$self" --no-self-test >"$broken/log" 2>&1 || result=$?
  if [ "$result" = "0" ]; then
    echo "not ok - self-test $name: the suite PASSED a broken hook, it proves nothing"
    exit 1
  fi
  echo "ok - self-test $name: the suite fails ($(grep -c '^not ok' "$broken/log") check(s)), as it must"
}

mutate mapping hooks/pre-push 's#apps/core/\*) touched\[core\]#apps/core/*) touched[inference]#'
mutate worktree-env hooks/pre-push 's#^  export GIT_DIR GIT_WORK_TREE#  :#'
mutate flake-root hooks/pre-push 's#^      \*) outside=#      flake.nix|flake.lock) : ;;\n&#'
echo "PASS: the self-test caught every broken copy"
