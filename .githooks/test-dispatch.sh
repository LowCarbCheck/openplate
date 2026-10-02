#!/usr/bin/env bash
# Proves the root hook dispatchers (.githooks/pre-push, .githooks/pre-commit)
# pick the right apps. M262 spec 05.
#
# It builds a scratch repository with the real root hooks, the real
# apps/website/.githooks/pre-commit, and a STUB pre-push in each of the four
# apps that records its name, its git prefix and the stdin it was given. Then
# it pushes to a scratch bare origin, from the main checkout and from a linked
# worktree, and feeds hand-written ref lines, and checks which stubs ran.
# Nothing here touches this repository, a database or the network.
#
# After the suite passes it runs itself again against three broken copies (a
# path mapping that sends apps/core to inference, a website pre-commit without
# --relative, and a pre-push that does not export GIT_WORK_TREE) and requires
# every run to FAIL. A suite that passes a
# broken dispatcher proves nothing.
#
#   .githooks/test-dispatch.sh                 the suite, then the self-test
#   .githooks/test-dispatch.sh --no-self-test  the suite only
#
# HOOKS_DIR and WEBSITE_PRE_COMMIT name the files under test; they default to
# the ones beside this script. The self-test sets them to the broken copies.
set -euo pipefail

self=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/$(basename -- "$0")
HOOKS_DIR=${HOOKS_DIR:-$(dirname -- "$self")}
WEBSITE_PRE_COMMIT=${WEBSITE_PRE_COMMIT:-$HOOKS_DIR/../apps/website/.githooks/pre-commit}
self_test=1
[ "${1:-}" = "--no-self-test" ] && self_test=0

# A run started from inside a hook must not aim git at the outer repository.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX SKIP_TESTS GIT_DIFF_OVERRIDE \
  OPENPLATE_GATE_LOCK OPENPLATE_GATE_LOCK_WAIT_SECONDS

scratch=$(mktemp -d "${TMPDIR:-/tmp}/test-dispatch.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
export DISPATCH_TEST_LOG="$scratch/ran.log"
# Every run below takes THIS lock, never the real /tmp/openplate-gate.lock, so
# the suite neither waits behind a real gate nor makes one wait.
export OPENPLATE_GATE_LOCK="$scratch/gate.lock"
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
cp "$HOOKS_DIR/pre-push" "$HOOKS_DIR/pre-commit" "$repo/.githooks/"
for app in app core inference website; do
  mkdir -p "$repo/apps/$app/.githooks"
  cat >"$repo/apps/$app/.githooks/pre-push" <<'STUB'
#!/usr/bin/env bash
# Stub gate: records who ran, from where, with which stdin.
set -euo pipefail
app=$(basename "$PWD")
input=$(cat)
printf '%s\n' "$input" >"$DISPATCH_TEST_LOG.stdin.$app"
printf '%s prefix=%s\n' "$app" "$(git rev-parse --show-prefix)" >>"$DISPATCH_TEST_LOG"
# Whether the dispatcher's lock descriptor reached this hook: writing to fd 9
# works only while it is open.
if { : >&9; } 2>/dev/null; then fd9=open; else fd9=closed; fi
printf '%s\n' "$fd9" >"$DISPATCH_TEST_LOG.fd9.$app"
if [ "${STUB_FAIL_APP:-}" = "$app" ]; then exit 3; fi
exit 0
STUB
  echo "$app" >"$repo/apps/$app/README.md"
done
mkdir -p "$repo/apps/website/src"
cp "$WEBSITE_PRE_COMMIT" "$repo/apps/website/.githooks/pre-commit"
chmod +x "$repo"/.githooks/* "$repo"/apps/*/.githooks/*

# A fake pnpm for the website pre-commit: it fails when oxlint would be handed
# a path that does not exist relative to the folder it runs in.
mkdir -p "$scratch/bin"
cat >"$scratch/bin/pnpm" <<'FAKE'
#!/usr/bin/env bash
shift 4 # exec oxlint --max-warnings 0
for file in "$@"; do
  if [ ! -f "$file" ]; then
    echo "fake oxlint: no such file $file (cwd $PWD)" >&2
    exit 1
  fi
done
echo "oxlint $(basename "$PWD"): $*" >>"$DISPATCH_TEST_LOG"
FAKE
chmod +x "$scratch/bin/pnpm"
export PATH="$scratch/bin:$PATH"

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
  ran=$(awk '$1 !~ /^oxlint/ {print $1}' "$DISPATCH_TEST_LOG" | tr '\n' ' ' | sed 's/ $//')
}

# every stub that ran saw itself as apps/<app>/, so git works from its cwd
prefixes_ok() {
  local app prefix
  while read -r app prefix; do
    case "$app" in oxlint) continue ;; esac
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
for other in app inference website; do
  expect_out "  and logs apps/$other as skipped" "apps/$other skipped"
done

dispatch "$push_line" GIT_DIFF_OVERRIDE=$'apps/website/src/x.ts\napps/app/app/root.tsx'
expect_ran "a website plus app path list runs exactly those two" "app website"
expect_out "  and logs apps/core as skipped" "apps/core skipped"

dispatch "$push_line" GIT_DIFF_OVERRIDE='.github/workflows/x.yml'
expect_ran "a root-only path runs all four" "app core inference website"

# The flake sets the node and pnpm every app runs under in a nix shell, so a
# change to it can break any app. Pinned here, so a dispatcher tidy-up that
# counted only the apps/ prefixes cannot drop the rule quietly.
dispatch "$push_line" GIT_DIFF_OVERRIDE='flake.nix'
expect_ran "a root flake.nix change runs all four" "app core inference website"

dispatch "$push_line" GIT_DIFF_OVERRIDE='flake.lock'
expect_ran "a root flake.lock change runs all four" "app core inference website"

dispatch "$push_line" GIT_DIFF_OVERRIDE='docker/compose.yml'
expect_ran "a root docker/ path runs all four, the app among them" "app core inference website"

dispatch "$push_line" GIT_DIFF_OVERRIDE='apps/newapp/x.ts'
expect_ran "a folder under apps/ that is none of the four runs all four" "app core inference website"

dispatch "refs/heads/gone $ZERO refs/heads/gone $base_sha" GIT_DIFF_OVERRIDE='apps/core/README.md'
expect_ran "a deletion-only push runs none" ""
expect_out "  and says deletion-only" "deletion-only push"

dispatch "$push_line" GIT_DIFF_OVERRIDE='.github/workflows/x.yml' STUB_FAIL_APP=core
expect_ran "a failing core gate stops the push, inference and website never run" "app core" 3
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
expect_ran "a remote sha this clone lacks runs all four" "app core inference website"
expect_out "  and says why" "is not in this clone"


# ── ONE FULL GATE AT A TIME: the lock ───────────────────────────────────────
# Another gate is a background process that holds the lock file's flock for a
# few seconds and has left its note in the file, as a real gate does.
hold_lock() {
  local seconds=$1 note=$2
  printf '%s\n' "$note" >"$OPENPLATE_GATE_LOCK"
  (
    exec 8>>"$OPENPLATE_GATE_LOCK"
    flock 8
    exec sleep "$seconds"
  ) &
  holder_pid=$!
  local _
  for _ in $(seq 1 100); do
    flock -n "$OPENPLATE_GATE_LOCK" true 2>/dev/null || return 0
    sleep 0.1
  done
  not_ok "lock setup: the background holder never took the lock"
}

release_lock() {
  kill "$holder_pid" 2>/dev/null || true
  wait "$holder_pid" 2>/dev/null || true
}

# Takes the lock freely and leaves its note.
rm -f "$OPENPLATE_GATE_LOCK"
dispatch "$push_line" GIT_DIFF_OVERRIDE='apps/core/README.md'
expect_ran "a free lock is taken without a word and the gate runs" "core"
if ! grep -q 'another gate holds' <<<"$out" && grep -q '^branch .* at .*, pid [0-9]*$' "$OPENPLATE_GATE_LOCK"; then
  ok "  and the lock file names the branch, the path and the pid of the gate that took it"
else
  not_ok "free lock: said it was held, or left no note: $(cat "$OPENPLATE_GATE_LOCK" 2>/dev/null)"
fi
fd9_states=$(cat "$DISPATCH_TEST_LOG".fd9.* 2>/dev/null | sort -u | tr '\n' ' ')
if [ "$fd9_states" = "closed " ]; then
  ok "  and the app hook runs with the lock's file descriptor closed"
else
  not_ok "the app hook saw the lock descriptor: '$fd9_states'"
fi

# A second holder waits, says who holds it, and gets the lock when it is freed.
hold_lock 3 "branch other-feature at /tmp/other-tree, pid 4242"
dispatch "$push_line" GIT_DIFF_OVERRIDE='apps/core/README.md'
release_lock
expect_ran "a held lock makes the second gate wait, then run" "core"
expect_out "  and says another gate holds it, naming the holder" "another gate holds .*gate.lock \(branch other-feature at /tmp/other-tree, pid 4242\)"
expect_out "  and says how long it waited" "got the gate lock after waiting [1-9][0-9]*s"

# A wait that runs out goes on, unguarded, and says so.
hold_lock 4 "branch other-feature at /tmp/other-tree, pid 4242"
dispatch "$push_line" GIT_DIFF_OVERRIDE='apps/core/README.md' OPENPLATE_GATE_LOCK_WAIT_SECONDS=1
release_lock
expect_ran "a lock still held after the wait runs the gate unguarded" "core"
expect_out "  and says so" "still held after 1s, running this gate without it"

# A push that tests nothing never waits for one that does.
hold_lock 5 "branch other-feature at /tmp/other-tree, pid 4242"
started=$SECONDS
dispatch "refs/heads/gone $ZERO refs/heads/gone $base_sha" GIT_DIFF_OVERRIDE='apps/core/README.md'
deletion_seconds=$((SECONDS - started))
expect_ran "a deletion-only push takes no lock and runs none" ""
if [ "$deletion_seconds" -lt 3 ] && ! grep -q 'another gate holds' <<<"$out"; then
  ok "  and does not wait for the gate that holds it (${deletion_seconds}s)"
else
  not_ok "deletion-only push waited ${deletion_seconds}s: $out"
fi
started=$SECONDS
dispatch "$push_line" SKIP_TESTS=1 GIT_DIFF_OVERRIDE='apps/core/README.md'
skip_seconds=$((SECONDS - started))
if [ "$skip_seconds" -lt 3 ] && ! grep -q 'another gate holds' <<<"$out"; then
  ok "SKIP_TESTS=1 takes no lock and does not wait (${skip_seconds}s)"
else
  not_ok "SKIP_TESTS=1 waited ${skip_seconds}s: $out"
fi
# THE CONTROL for the two cases above: the same held lock DOES stop a push that
# tests something, so "did not wait" is a statement about those pushes and not
# about a lock that nothing can hold.
started=$SECONDS
dispatch "$push_line" GIT_DIFF_OVERRIDE='apps/core/README.md' OPENPLATE_GATE_LOCK_WAIT_SECONDS=1
control_seconds=$((SECONDS - started))
release_lock
if [ "$control_seconds" -ge 1 ] && grep -q 'another gate holds' <<<"$out"; then
  ok "  control: the same held lock makes a push that tests something wait (${control_seconds}s)"
else
  not_ok "lock control: a content push did not wait for the held lock: $out"
fi

# A host without flock goes on, with one line. The PATH has the tools the hooks
# use and nothing else, so `command -v flock` finds nothing.
bare=$scratch/bare-bin
mkdir -p "$bare"
for tool in bash env git cat basename dirname head tail sed awk grep tr sort mktemp rm uname sleep; do
  tool_path=$(command -v "$tool" 2>/dev/null) || continue
  case "$tool_path" in /*) ln -sf "$tool_path" "$bare/$tool" ;; esac
done
if PATH=$bare command -v flock >/dev/null 2>&1; then
  not_ok "lock setup: the flock-less PATH still finds flock"
fi
hold_lock 4 "branch other-feature at /tmp/other-tree, pid 4242"
dispatch "$push_line" GIT_DIFF_OVERRIDE='apps/core/README.md' PATH="$bare"
release_lock
expect_ran "without flock the gate runs, even with the lock file held" "core"
expect_out "  and says the lock is skipped" "flock is not installed, the one-gate-at-a-time lock is skipped"
dispatch "$push_line" GIT_DIFF_OVERRIDE='apps/core/README.md'
if ! grep -q 'flock is not installed' <<<"$out"; then
  ok "  control: with flock on PATH the same push does not say that"
else
  not_ok "flock control: the skip line printed although flock is on PATH"
fi

# The stdin still reaches the app hook after the lock was taken first.
dispatch "$two_lines" GIT_DIFF_OVERRIDE='apps/inference/README.md'
if [ "$(cat "$DISPATCH_TEST_LOG.stdin.inference")" = "$two_lines" ]; then
  ok "the app hook still gets the stdin lines with the lock in front of it"
else
  not_ok "stdin replay after the lock: '$(cat "$DISPATCH_TEST_LOG.stdin.inference" 2>/dev/null)'"
fi

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
echo website >>"$scratch/linked/apps/website/README.md"
git -C "$scratch/linked" commit -q -am "touch website"
real_push "$scratch/linked" linked
expect_ran "a real push from a linked worktree runs website, and git inside it sees apps/website/" "website"

# ── the root pre-commit ─────────────────────────────────────────────────────
commit_case() {
  local dir=$1 name=$2 want=$3
  shift 3
  : >"$DISPATCH_TEST_LOG"
  git -C "$dir" reset -q # a failed case must not leave its files staged for the next
  for path in "$@"; do
    mkdir -p "$(dirname "$dir/$path")"
    echo "export const x = 1;" >"$dir/$path"
    git -C "$dir" add "$path"
  done
  rc=0
  out=$(git -C "$dir" commit -q -m "$name" 2>&1) || rc=$?
  local got
  got=$(grep '^oxlint' "$DISPATCH_TEST_LOG" || true)
  if [ "$rc" = "0" ] && [ "$got" = "$want" ]; then
    ok "$name (${got:-website pre-commit not run})"
  else
    not_ok "$name: want '${want:-nothing}' exit 0, got '${got:-nothing}' exit $rc"
    printf '%s\n' "$out" | sed 's/^/    /'
  fi
}

commit_case "$repo" "pre-commit lints staged website files relative to apps/website" \
  "oxlint website: src/a.ts" apps/website/src/a.ts apps/core/b.ts
commit_case "$repo" "pre-commit skips the website hook when no website path is staged" \
  "" apps/core/c.ts
commit_case "$scratch/linked" "pre-commit from a linked worktree lints relative to apps/website" \
  "oxlint website: src/d.ts" apps/website/src/d.ts

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
  cp "$HOOKS_DIR/pre-push" "$HOOKS_DIR/pre-commit" "$broken/hooks/"
  cp "$WEBSITE_PRE_COMMIT" "$broken/website-pre-commit"
  local target=$broken/$file
  cp "$target" "$target.orig"
  sed -i "$expr" "$target"
  if cmp -s "$target" "$target.orig"; then
    echo "not ok - self-test $name: the mutation changed nothing, fix the sed expression"
    exit 1
  fi
  local result=0
  HOOKS_DIR=$broken/hooks WEBSITE_PRE_COMMIT=$broken/website-pre-commit \
    "$self" --no-self-test >"$broken/log" 2>&1 || result=$?
  if [ "$result" = "0" ]; then
    echo "not ok - self-test $name: the suite PASSED a broken hook, it proves nothing"
    exit 1
  fi
  echo "ok - self-test $name: the suite fails ($(grep -c '^not ok' "$broken/log") check(s)), as it must"
}

mutate mapping hooks/pre-push 's#apps/core/\*) touched\[core\]#apps/core/*) touched[inference]#'
mutate relative website-pre-commit 's# --relative##'
mutate worktree-env hooks/pre-push 's#^  export GIT_DIR GIT_WORK_TREE#  :#'
mutate flake-root hooks/pre-push 's#^      \*) outside=#      flake.nix|flake.lock) : ;;\n&#'
# The lock, broken one part at a time. Nothing takes it:
mutate lock-never-taken hooks/pre-push 's#^  if ! flock -n 9; then#  if false; then#'
# a second gate that does not wait for the first:
mutate lock-no-wait hooks/pre-push 's#^    if ! flock -w "\$GATE_LOCK_WAIT_SECONDS" 9; then#    if false; then#'
# a host without flock that fails instead of going on:
mutate lock-needs-flock hooks/pre-push 's#^  if ! command -v flock >/dev/null 2>&1; then#  if false; then#'
# the lock descriptor left open in the app hooks:
mutate lock-fd-leaks hooks/pre-push 's# 9>&- <<<"\$stdin_lines"# <<<"$stdin_lines"#'
echo "PASS: the self-test caught every broken copy"
