#!/usr/bin/env bash
# Proves the control flow of scripts/e2e-scoped.sh, with no browser and no node.
#
# The script under test is copied into a scratch git repository at
# apps/app/scripts/, next to a STUB e2e-sharded.sh that records its arguments.
# The selector is a stub too, through OPENPLATE_E2E_SELECT: it records the
# stdin it was given and prints what SELECT_OUTPUT holds. The diff is real git.
#
# Cases: `all` goes to sharded with no arguments; a list goes to sharded with
# those arguments; an empty list exits 0 without calling sharded; no range, and
# OPENPLATE_E2E_FULL=1, go to sharded with no selector call; only paths under
# apps/app/ reach the selector, stripped of the prefix.
# Then it runs itself against broken copies and requires every one to FAIL.
#
#   scripts/test-e2e-scoped.sh                 the suite, then the self-test
#   scripts/test-e2e-scoped.sh --no-self-test  the suite only
#
# SCRIPT names the file under test; the self-test sets it to broken copies.
set -u

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P) || exit 1
self=$here/$(basename -- "$0")
SCRIPT=${SCRIPT:-$here/e2e-scoped.sh}
self_test=1
[ "${1:-}" = "--no-self-test" ] && self_test=0
unset OPENPLATE_E2E_FULL OPENPLATE_PUSH_RANGE OPENPLATE_E2E_SELECT GIT_DIR GIT_WORK_TREE

scratch=$(mktemp -d "${TMPDIR:-/tmp}/test-e2e-scoped.XXXXXX") || exit 1
trap 'rm -rf "$scratch"' EXIT
failures=0
ok() { echo "ok - $1"; }
not_ok() {
  echo "not ok - $1"
  failures=$((failures + 1))
}

repo=$scratch/repo
mkdir -p "$repo/apps/app/scripts"
cp "$SCRIPT" "$repo/apps/app/scripts/e2e-scoped.sh"
cat >"$repo/apps/app/scripts/e2e-sharded.sh" <<'STUB'
#!/usr/bin/env bash
printf 'sharded:%s\n' "$#" >>"$STUB_LOG"
for a in "$@"; do printf 'arg:%s\n' "$a" >>"$STUB_LOG"; done
exit "${SHARDED_RC:-0}"
STUB
cat >"$scratch/select" <<'STUB'
#!/usr/bin/env bash
echo selector-called >>"$STUB_LOG"
cat >"$STUB_LOG.stdin"
printf '%s' "$SELECT_OUTPUT"
STUB
chmod +x "$scratch/select" "$repo/apps/app/scripts/"*.sh
git -C "$repo" init -q -b main
git -C "$repo" config user.name t
git -C "$repo" config user.email t@invalid
git -C "$repo" config commit.gpgsign false
echo a >"$repo/apps/app/a.txt"
echo c >"$repo/README.md"
git -C "$repo" add -A
git -C "$repo" commit -q -m one
base=$(git -C "$repo" rev-parse HEAD)
echo b >>"$repo/apps/app/a.txt"
echo d >>"$repo/README.md"
mkdir -p "$repo/apps/core"
echo e >"$repo/apps/core/x.ts"
git -C "$repo" add -A
git -C "$repo" commit -q -m two
head=$(git -C "$repo" rev-parse HEAD)

# run_scoped [VAR=value ...]: sets $out, $rc and $log (the stub calls).
run_scoped() {
  export STUB_LOG=$scratch/log
  : >"$STUB_LOG"
  rm -f "$STUB_LOG.stdin"
  rc=0
  out=$(cd "$repo/apps/app" && env OPENPLATE_E2E_SELECT="$scratch/select" "$@" \
    bash scripts/e2e-scoped.sh 2>&1) || rc=$?
  log=$(cat "$STUB_LOG")
}
has() { grep -qxF -- "$1" <<<"$log"; }
says() { grep -qF -- "$1" <<<"$out"; }
range="$base..$head"

run_scoped OPENPLATE_PUSH_RANGE="$range" SELECT_OUTPUT=all
if [ "$rc" = 0 ] && says 'e2e-scoped: full tier (the push touches shared code)' && has 'sharded:0' && has selector-called; then
  ok "all: sharded runs with no arguments"
else
  not_ok "all: rc $rc, out '$out', log '$log'"
fi

run_scoped OPENPLATE_PUSH_RANGE="$range" SELECT_OUTPUT=$'tests/e2e/a.spec.ts\ntests/e2e/b.spec.ts'
if [ "$rc" = 0 ] && says 'e2e-scoped: 2 specs' && has 'sharded:2' && has 'arg:tests/e2e/a.spec.ts' && has 'arg:tests/e2e/b.spec.ts'; then
  ok "a list: sharded runs with exactly those specs"
else
  not_ok "list: rc $rc, out '$out', log '$log'"
fi
# Control: the list case must NOT look like the `all` case.
if ! has 'sharded:0'; then
  ok "  control: a list is not mistaken for the full tier"
else
  not_ok "list control: sharded was called with no arguments"
fi

run_scoped OPENPLATE_PUSH_RANGE="$range" SELECT_OUTPUT=''
if [ "$rc" = 0 ] && says 'e2e-scoped: no browser specs for this push' && ! grep -q '^sharded' <<<"$log"; then
  ok "empty: exits 0 and never calls sharded"
else
  not_ok "empty: rc $rc, out '$out', log '$log'"
fi
# Control: with a failing sharded stub, the list case must exit non-zero, so
# "exit 0 without sharded" above cannot be a script that ignores sharded.
run_scoped OPENPLATE_PUSH_RANGE="$range" SELECT_OUTPUT='tests/e2e/a.spec.ts' SHARDED_RC=7
if [ "$rc" = 7 ]; then
  ok "  control: the sharded exit code comes back (7)"
else
  not_ok "exit control: want 7, got $rc"
fi

run_scoped SELECT_OUTPUT=all
if [ "$rc" = 0 ] && says 'e2e-scoped: full tier (no single pushed range' && has 'sharded:0' && ! has selector-called; then
  ok "no range: the full tier, selector never asked"
else
  not_ok "no range: rc $rc, out '$out', log '$log'"
fi
run_scoped OPENPLATE_PUSH_RANGE= SELECT_OUTPUT=''
if says 'full tier' && has 'sharded:0'; then
  ok "an empty range is the same as none"
else
  not_ok "empty range: out '$out', log '$log'"
fi

run_scoped OPENPLATE_E2E_FULL=1 OPENPLATE_PUSH_RANGE="$range" SELECT_OUTPUT='tests/e2e/a.spec.ts'
if says 'full tier (OPENPLATE_E2E_FULL=1)' && has 'sharded:0' && ! has selector-called; then
  ok "OPENPLATE_E2E_FULL=1 runs the full tier even with a range"
else
  not_ok "full flag: out '$out', log '$log'"
fi

run_scoped OPENPLATE_PUSH_RANGE="$range" SELECT_OUTPUT=''
if [ "$(cat "$STUB_LOG.stdin")" = "a.txt" ]; then
  ok "the selector gets only apps/app paths, prefix stripped"
else
  not_ok "selector stdin: '$(cat "$STUB_LOG.stdin" 2>/dev/null)'"
fi

if [ "$failures" != 0 ]; then
  echo "FAIL: $failures check(s) failed"
  exit 1
fi
echo "PASS: every check passed"
[ "$self_test" = 1 ] || exit 0

mutate() {
  local name=$1 expr=$2 broken=$scratch/broken-$1
  mkdir -p "$broken"
  cp "$here/e2e-scoped.sh" "$broken/e2e-scoped.sh"
  sed -i "$expr" "$broken/e2e-scoped.sh"
  if cmp -s "$broken/e2e-scoped.sh" "$here/e2e-scoped.sh"; then
    echo "not ok - self-test $name: the mutation changed nothing"
    exit 1
  fi
  local result=0
  SCRIPT=$broken/e2e-scoped.sh "$self" --no-self-test >"$broken/log" 2>&1 || result=$?
  if [ "$result" = 0 ]; then
    echo "not ok - self-test $name: the suite PASSED a broken script"
    exit 1
  fi
  echo "ok - self-test $name: the suite fails ($(grep -c '^not ok' "$broken/log") check(s)), as it must"
}
mutate no-range-scopes 's#^if \[ -z "${OPENPLATE_PUSH_RANGE:-}" \]; then#if false; then#'
mutate empty-runs-sharded 's#^  exit 0#  :#'
mutate all-is-a-spec 's#^if \[ "$selection" = "all" \]; then#if false; then#'
mutate drops-specs 's#"${specs\[@\]}" "$@"#"$@"#'
mutate no-prefix-filter "s#grep '^apps/app/' | ##"
mutate full-flag-ignored 's#^if \[ "${OPENPLATE_E2E_FULL:-0}" = "1" \]; then#if false; then#'
echo "PASS: the self-test caught every broken copy"
