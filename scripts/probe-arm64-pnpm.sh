#!/usr/bin/env bash
# A local smoke probe of the pnpm install path on linux/arm64 alpine.
#
# pnpm once segfaulted on arm64 alpine (2026-08-06 to 2026-08-18): a global pnpm
# from npm that was NEWER than `packageManager` downloaded the declared version
# as a self-managed binary, that binary has no musl build for arm64, and it
# crashed before printing a line. The Dockerfiles now install pnpm through
# corepack, which installs the `packageManager` version itself.
#
# This script runs, on node:24-alpine under QEMU user emulation:
#   - the NEW path: corepack reading apps/app/package.json, which must print
#     the packageManager version;
#   - the CONTROL, the OLD path: a global pnpm newer than packageManager from
#     npm. If the segfault reproduces, this run is empty or crashed.
#
# It is a SMOKE TEST. QEMU user emulation is not the native arm64 runner, and
# QEMU has died on unrelated steps before. The next release run on the native
# arm64 runner is the proof.
#
# Exit codes: 0 the new path printed the right version, 1 it did not,
# 2 inconclusive (the emulator itself crashed).
#
# Environment:
#   PROBE_RUNTIME      container runtime, default podman
#   PROBE_IMAGE        base image, default node:24-alpine
#   PROBE_OLD_PNPM     the npm version spec the control installs, default
#                      latest (must be newer than packageManager)
#   PROBE_PACKAGE_JSON the package.json to mount, default apps/app/package.json
#                      (a control points it at a version that does not exist)
set -u

root=$(cd "$(dirname "$0")/.." && pwd)
pkg=${PROBE_PACKAGE_JSON:-$root/apps/app/package.json}
rt=${PROBE_RUNTIME:-podman}
image=${PROBE_IMAGE:-node:24-alpine}
old=${PROBE_OLD_PNPM:-latest}
note='NOTE: this probe is a smoke test under QEMU user emulation, it is not a proof. The next release run on the native arm64 runner is the proof.'

command -v "$rt" >/dev/null 2>&1 || { echo "FAIL: container runtime $rt not found"; echo "$note"; exit 1; }
want=$(jq -r '.packageManager // ""' "$pkg" | sed -n 's/^pnpm@//p')
[ -n "$want" ] || { echo "FAIL: $pkg declares no pnpm packageManager"; echo "$note"; exit 1; }

# The single file, read only, never the directory over /app. The label
# option lets an SELinux host share it without relabelling the file.
run() {
  "$rt" run --rm --platform linux/arm64 --security-opt label=disable \
    -v "$pkg:/app/package.json:ro" -w /app \
    -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    "$image" sh -c "$1" 2>&1
}

inconclusive() {
  if printf '%s\n' "$1" | grep -q 'qemu: uncaught target signal'; then
    printf '%s\n' "$1" | tail -5
    echo "inconclusive - $2: qemu crashed (uncaught target signal), an emulator failure and not a pnpm result"
    echo "$note"
    exit 2
  fi
}

# The new path.
new_out=$(run 'corepack enable && corepack prepare --activate && pnpm --version')
new_rc=$?
inconclusive "$new_out" 'arm64 probe'
got=$(printf '%s\n' "$new_out" | tail -1)
rc=0
if [ "$new_rc" -eq 0 ] && [ "$got" = "$want" ]; then
  echo "ok - arm64 probe: the corepack path prints $got"
else
  printf '%s\n' "$new_out" | tail -5
  echo "FAIL: arm64 probe: the corepack path printed '$got' with exit $new_rc, want $want"
  rc=1
fi

# The control, the old path. The global version is printed first, so the log
# shows it really was newer than packageManager.
old_out=$(run "npm i -g --silent pnpm@$old >/dev/null 2>&1 && echo \"global pnpm: \$(npm ls -g pnpm --depth 0 --parseable --long | sed -n 's/.*pnpm@//p')\" && pnpm --version")
old_rc=$?
inconclusive "$old_out" 'control arm64 probe'
printf '%s\n' "$old_out" | grep -m1 '^global pnpm: ' | sed 's/^/# control: /'
old_last=$(printf '%s\n' "$old_out" | tail -1)
if [ "$old_rc" -ne 0 ] || [ -z "$old_last" ] || printf '%s\n' "$old_out" | grep -qiE 'segmentation fault|signal 11'; then
  printf '%s\n' "$old_out" | tail -3 | sed 's/^/# control: /'
  echo "ok - control arm64 probe: the old path (global pnpm newer than packageManager) fails, the segfault reproduced"
else
  echo "# control: the old path printed '$old_last' with exit $old_rc"
  echo "note - control arm64 probe: the old path did not fail here, so this probe is a smoke test and not a proof"
fi

echo "$note"
exit $rc
