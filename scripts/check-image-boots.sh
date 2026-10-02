#!/usr/bin/env bash
# Builds one app's production image, boots it, and asks it the request that
# proves it is alive. One app per run:
#
#   scripts/check-image-boots.sh app|core|inference
#
# Each image is built from the context and file its release workflow names.
# The script prints one `ok - ...` line per proof, a `FAIL: ...` line per
# failed proof, and ends with `PASS: <app>` when every proof held. Every proof
# has a control that makes it fail:
#
#   - build:   the same Dockerfile with its node base tag replaced by a tag
#              that does not exist must fail to build;
#   - request: the booted container, once stopped, must refuse the request;
#   - node:    `node -v` of node:22-alpine must be refused by the v24 check;
#   - pnpm:    a version other than packageManager must be refused.
#
# What each app is asked:
#   app        GET /healthcheck on :3000, with APP_URL=http://localhost:3000
#   core       GET /health on :3000, against a throwaway database (below)
#   inference  GET /healthz on :8300, MODEL_PROFILE=external, no weights
#
# core needs ONE variable: M269_PG_ADMIN_URL, the admin connection URL of the
# shared local Postgres (projects-postgres-1 on port 5433). The script creates
# one uniquely named database `m269_boot_<pid>_<epoch>`, points the container at
# it, and drops it on exit. It never touches another database. The URL is
# never printed.
#
# Published ports bind to 127.0.0.1 only. core runs on the host network so it
# can reach port 5433, and listens on 127.0.0.1 through HOST.
#
# Environment:
#   CONTAINER_RUNTIME   docker or podman, default the first one found
#   BOOT_TIMEOUT        seconds to wait for the request, default 120
set -u

root=$(cd "$(dirname "$0")/.." && pwd)
app=${1:-}
case "$app" in
  app) ctx=apps/app; df=apps/app/Dockerfile.pnpm; pnpm_stage=dependencies-env ;;
  core) ctx=apps/core; df=apps/core/Dockerfile; pnpm_stage=base ;;
  inference) ctx=apps/inference; df=apps/inference/Dockerfile; pnpm_stage=build ;;
  *) echo "usage: $0 app|core|inference" >&2; exit 64 ;;
esac

rt=${CONTAINER_RUNTIME:-$(command -v docker || command -v podman)}
[ -n "$rt" ] || { echo "FAIL: no container runtime (docker or podman) found"; exit 1; }
timeout_s=${BOOT_TIMEOUT:-120}
want_pnpm=$(jq -r '.packageManager // ""' "$root/$ctx/package.json" | sed -n 's/^pnpm@//p')
[ -n "$want_pnpm" ] || { echo "FAIL: $ctx/package.json declares no pnpm packageManager"; exit 1; }

tag="m269-boot-$app"
cname="m269-boot-$app-$$"
work=$(mktemp -d)
failed=0
db=''
db_dropped=0

ok() { echo "ok - $*"; }
fail() { echo "FAIL: $*"; failed=1; }

# ── The throwaway database (core only) ───────────────────────────────────────
# The SQL runs through node and `pg` inside the core image that was just built,
# so the host needs no psql. The admin URL reaches it through the environment.
pg_sql() {
  "$rt" run --rm --network host -e M269_PG_ADMIN_URL -e M269_SQL="$1" --entrypoint node "$tag" -e '
    const { Client } = require("pg");
    const c = new Client({ connectionString: process.env.M269_PG_ADMIN_URL });
    c.connect()
      .then(() => c.query(process.env.M269_SQL))
      .then((r) => { for (const row of r.rows ?? []) console.log(Object.values(row).join(" ")); return c.end(); })
      .catch((e) => { console.error(e.message); process.exit(1); });'
}

drop_db() {
  [ -n "$db" ] && [ "$db_dropped" = 0 ] || return 0
  "$rt" rm -f "$cname" >/dev/null 2>&1
  if pg_sql "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null 2>"$work/drop.err"; then
    db_dropped=1
    return 0
  fi
  return 1
}

cleanup() {
  "$rt" rm -f "$cname" >/dev/null 2>&1
  if [ -n "$db" ] && [ "$db_dropped" = 0 ]; then
    drop_db || echo "FAIL: core could not drop database $db on exit: $(cat "$work/drop.err")" >&2
  fi
  rm -rf "${work:?}"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ── Checks shared by every app, each with a control ──────────────────────────
is_node24() { case "$1" in v24.*) return 0 ;; *) echo "node is '$1', want v24.x.y"; return 1 ;; esac; }
is_pnpm() { [ "$1" = "$2" ] || { echo "pnpm is '$1', want $2 (packageManager)"; return 1; }; }

# Prints the HTTP status of a GET, or 000 when nothing answers.
status_of() { curl -s -o /dev/null -m 5 -w '%{http_code}' "$@" 2>/dev/null || true; }

wait_for_200() {
  local url=$1; shift
  local i=0 s=000
  while [ "$i" -lt "$timeout_s" ]; do
    s=$(status_of "$@" "$url")
    [ "$s" = 200 ] && { echo 200; return 0; }
    if ! "$rt" inspect -f '{{.State.Running}}' "$cname" 2>/dev/null | grep -qx true; then
      break
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "$s"
  return 1
}

# ── Control: a missing base tag fails the build ──────────────────────────────
missing='node:0-m269-no-such-tag'
sed -E "s#node:24-(alpine|bookworm-slim)#$missing#g" "$root/$df" > "$work/Dockerfile.missing"
if ! grep -q "$missing" "$work/Dockerfile.missing"; then
  fail "control $app build: no node:24 base tag found in $df to replace"
elif (cd "$root" && "$rt" build -f "$work/Dockerfile.missing" -t "$tag-control" "$ctx") >"$work/control.log" 2>&1; then
  fail "control $app build: a Dockerfile on $missing built, so a build result proves nothing"
  "$rt" rmi -f "$tag-control" >/dev/null 2>&1
elif grep -qE "0-m269-no-such-tag|not found|manifest unknown" "$work/control.log"; then
  ok "control $app build: a missing base tag fails"
else
  tail -5 "$work/control.log"
  fail "control $app build: the build failed, but not on the missing base tag"
fi

# ── The build ────────────────────────────────────────────────────────────────
start=$(date +%s)
if (cd "$root" && "$rt" build -f "$df" -t "$tag" "$ctx") >"$work/build.log" 2>&1; then
  ok "$app image builds ($(( $(date +%s) - start ))s, $df, context $ctx)"
else
  tail -20 "$work/build.log"
  fail "$app image build failed ($df, context $ctx)"
  exit 1
fi
size=$("$rt" image inspect -f '{{.Size}}' "$tag" 2>/dev/null)
echo "# $app image size: $(( size / 1000000 )) MB"

# The stage that carries pnpm, built from the same cache.
if (cd "$root" && "$rt" build -f "$df" --target "$pnpm_stage" -t "$tag-$pnpm_stage" "$ctx") >"$work/stage.log" 2>&1; then
  :
else
  tail -10 "$work/stage.log"
  fail "$app stage $pnpm_stage build failed"
  exit 1
fi

# ── node 24 and pnpm, inside the image ───────────────────────────────────────
node_img=$tag
got_node=$("$rt" run --rm --network none --entrypoint node "$node_img" -v 2>&1 | tail -1)
if m=$(is_node24 "$got_node"); then
  ok "$app image node -v is $got_node ($node_img)"
else
  fail "$app image $node_img: $m"
fi
ctl_node=$("$rt" run --rm --network none --entrypoint node node:22-alpine -v 2>&1 | tail -1)
if m=$(is_node24 "$ctl_node"); then
  fail "control $app node: node:22-alpine ($ctl_node) passed the v24 check"
else
  ok "control $app node: node:22-alpine is refused ($m)"
fi

# --network none: pnpm must already be in the image, never fetched at run time.
got_pnpm=$("$rt" run --rm --network none -w /app --entrypoint pnpm "$tag-$pnpm_stage" --version 2>&1 | tail -1)
if m=$(is_pnpm "$got_pnpm" "$want_pnpm"); then
  ok "$app image pnpm --version is $got_pnpm, equals packageManager (stage $pnpm_stage)"
else
  fail "$app stage $pnpm_stage: $m"
fi
if m=$(is_pnpm "$got_pnpm" "11.1.1-m269-control"); then
  fail "control $app pnpm: a wrong packageManager version passed"
else
  ok "control $app pnpm: a version other than packageManager is refused ($m)"
fi

# ── Boot and request ─────────────────────────────────────────────────────────
case "$app" in
  app)
    # APP_URL is required when NODE_ENV is production (server.ts); this is
    # the default the compose file and the quadlet defaults set.
    "$rt" run -d --name "$cname" -p 127.0.0.1::3000 -e APP_URL=http://localhost:3000 "$tag" >/dev/null || { fail "app container did not start"; exit 1; }
    port=$("$rt" port "$cname" 3000/tcp | head -1 | sed 's/.*://')
    url="http://127.0.0.1:$port/healthcheck"; hdr=(); label='app boots and answers GET /healthcheck with 200'
    ;;
  core)
    [ -n "${M269_PG_ADMIN_URL:-}" ] || { fail "M269_PG_ADMIN_URL is not set: give the admin connection URL of the shared Postgres on :5433"; exit 1; }
    db="m269_boot_$$_$(date +%s)"
    if pg_sql "CREATE DATABASE \"$db\"" >/dev/null 2>"$work/create.err"; then
      ok "core created database $db"
    else
      db=''
      fail "core could not create its throwaway database: $(cat "$work/create.err")"
      exit 1
    fi
    db_url=$(M269_DB="$db" "$rt" run --rm -e M269_PG_ADMIN_URL -e M269_DB --entrypoint node "$tag" -e '
      const u = new URL(process.env.M269_PG_ADMIN_URL); u.pathname = "/" + process.env.M269_DB; console.log(u.toString());')
    port=$("$rt" run --rm --network host --entrypoint node "$tag" -e '
      const s = require("net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });')
    secret=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
    "$rt" run -d --name "$cname" --network host \
      -e HOST=127.0.0.1 -e PORT="$port" -e DATABASE_URL="$db_url" -e SERVER_SECRET="$secret" \
      "$tag" >/dev/null || { fail "core container did not start"; exit 1; }
    url="http://127.0.0.1:$port/health"; hdr=(); label='core boots and answers GET /health with 200'
    ;;
  inference)
    "$rt" run -d --name "$cname" -p 127.0.0.1::8300 \
      -e MODEL_PROFILE=external -e MODEL_RUNTIME_URL=http://127.0.0.1:9 \
      "$tag" >/dev/null || { fail "inference container did not start"; exit 1; }
    port=$("$rt" port "$cname" 8300/tcp | head -1 | sed 's/.*://')
    url="http://127.0.0.1:$port/healthz"; hdr=(); label='inference boots with MODEL_PROFILE=external and answers GET /healthz with 200'
    ;;
esac

if s=$(wait_for_200 "$url" "${hdr[@]}"); then
  ok "$label"
else
  "$rt" logs "$cname" 2>&1 | tail -15
  fail "$app answered $s, not 200, at ${url#http://127.0.0.1:"$port"} within ${timeout_s}s"
fi

# ── Control: a stopped container refuses the request ─────────────────────────
"$rt" stop -t 5 "$cname" >/dev/null 2>&1
s=$(status_of "${hdr[@]}" "$url")
if [ "$s" = 000 ]; then
  ok "control $app request: a stopped container refuses the request"
else
  fail "control $app request: a stopped container still answered $s, so the request proves nothing"
fi
"$rt" rm -f "$cname" >/dev/null 2>&1

# ── core: drop the database and prove it is gone ─────────────────────────────
if [ "$app" = core ]; then
  if drop_db; then
    ok "core dropped database $db"
  else
    fail "core could not drop database $db: $(cat "$work/drop.err")"
  fi
  left=$(pg_sql "SELECT datname FROM pg_database WHERE datname LIKE 'm269\\_boot\\_%'" 2>&1)
  if [ -z "$left" ]; then
    ok "core: no m269_boot_ database remains"
  else
    fail "core: m269_boot_ databases remain: $left"
  fi
fi

"$rt" rmi -f "$tag-$pnpm_stage" >/dev/null 2>&1
[ "$failed" = 0 ] || exit 1
echo "PASS: $app"
