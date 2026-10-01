#!/usr/bin/env bash
# The release check for the Postgres the self-host files ship (M272 spec 03).
#
#   scripts/check-postgres-18.sh        or        make check-pg18
#
# The local gates test against Postgres 17, the version production runs, so a
# feature that only 18 has fails there before it reaches production. This check
# is the other half: it proves the self-host files still START on 18. It is a
# release check, not a pre-push step, because it builds the core image and
# takes a few minutes. Run it before you cut a core tag.
#
# What it does, in order, and stops on the first failed step:
#
#   1. reads the Postgres image out of docker/topologies/compose.core.yml and
#      requires major 18, so the check follows the file a self-hoster runs;
#   2. starts that image on a free loopback port, with the volume mounted at
#      /var/lib/postgresql, the layout the shipped files use;
#   3. asks the server for its version and requires major 18;
#   4. builds the core image from apps/core/Dockerfile (or uses CORE_IMAGE),
#      starts it on the host network against that database, and waits for
#      GET /health to answer 200;
#   5. requires the migrations the server ran at boot to be all of the committed
#      ones, and the serviceVersion in /health to equal apps/core/package.json;
#   6. tears everything down and proves nothing it created remains.
#
# Every proof has a control that makes it fail:
#
#   - image:   a postgres:17 line is refused by the major check;
#   - server:  a server_version_num of 17.x is refused by the major check;
#   - version: a serviceVersion that differs from package.json is refused;
#   - count:   a migration count one short of the files is refused;
#   - request: the core container, once stopped, must refuse the request.
#
# Published ports bind to 127.0.0.1 only. No secret is printed: the database
# password and SERVER_SECRET are random per run and exist only in this process
# and the two containers.
#
# Environment:
#   CONTAINER_RUNTIME   docker or podman, default the first one found
#   CORE_IMAGE          a core image to test instead of building the checkout
#   BOOT_TIMEOUT        seconds to wait for the database and for /health, default 120
set -u

root=$(cd "$(dirname "$0")/.." && pwd)
rt=${CONTAINER_RUNTIME:-$(command -v docker || command -v podman)}
[ -n "$rt" ] || { echo "FAIL: no container runtime (docker or podman) found"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "FAIL: jq is required"; exit 1; }
timeout_s=${BOOT_TIMEOUT:-120}

stamp="pg18check-$$"
pg_name="$stamp-postgres"
core_name="$stamp-core"
vol_name="$stamp-data"
core_tag="$stamp-core-image"
built_image=0
work=$(mktemp -d)
failed=0

ok() { echo "ok - $*"; }
fail() { echo "FAIL: $*"; failed=1; }
die() { echo "FAIL: $*"; exit 1; }

# ── Predicates, each with a control below ───────────────────────────────────
# is_major_18 takes an image line or a server_version_num.
is_postgres_18_image() {
  case "$1" in
    docker.io/library/postgres:18*) return 0 ;;
    *) echo "image is '$1', want docker.io/library/postgres:18..."; return 1 ;;
  esac
}
is_server_18() {
  [ "$(( $1 / 10000 ))" = 18 ] || { echo "server_version_num is $1, want 18xxxx"; return 1; }
}
same() { [ "$1" = "$2" ] || { echo "got '$1', want '$2'"; return 1; }; }

status_of() { curl -s -o /dev/null -m 5 -w '%{http_code}' "$@" 2>/dev/null || true; }

teardown() {
  "$rt" rm -f "$core_name" "$pg_name" >/dev/null 2>&1
  "$rt" volume rm -f "$vol_name" >/dev/null 2>&1
  [ "$built_image" = 1 ] && "$rt" rmi -f "$core_tag" >/dev/null 2>&1
  rm -rf "${work:?}"
}
trap teardown EXIT
trap 'exit 130' INT TERM

psql_in() { "$rt" exec "$pg_name" psql -U openplate -d openplate_sync -tA -c "$1"; }

# ── 1. The image the self-host file ships ───────────────────────────────────
compose=docker/topologies/compose.core.yml
pg_image=$(sed -n 's/^ *image: *\(docker\.io\/library\/postgres:[^ #]*\).*/\1/p' "$root/$compose" | head -1)
[ -n "$pg_image" ] || die "no docker.io/library/postgres image line in $compose"
if m=$(is_postgres_18_image "$pg_image"); then
  ok "$compose pins $pg_image"
else
  die "$compose: $m"
fi
if m=$(is_postgres_18_image 'docker.io/library/postgres:17-alpine'); then
  fail "control image: postgres:17-alpine passed the major check"
else
  ok "control image: postgres:17-alpine is refused ($m)"
fi

# ── 2. Start Postgres the way the files do ──────────────────────────────────
pg_pass=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
"$rt" volume create "$vol_name" >/dev/null || die "could not create volume $vol_name"
"$rt" run -d --name "$pg_name" -p 127.0.0.1::5432 -v "$vol_name:/var/lib/postgresql" \
  -e POSTGRES_USER=openplate -e POSTGRES_PASSWORD="$pg_pass" -e POSTGRES_DB=openplate_sync \
  "$pg_image" >/dev/null || die "the Postgres container did not start"
pg_port=$("$rt" port "$pg_name" 5432/tcp | head -1 | sed 's/.*://')

# Ask over TCP. During its first start Postgres runs a short server that answers
# only on a socket, and the container can look healthy then.
i=0
until "$rt" exec "$pg_name" pg_isready -q -h 127.0.0.1 -U openplate -d openplate_sync >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt "$timeout_s" ] || { "$rt" logs "$pg_name" 2>&1 | tail -15; die "Postgres did not accept connections within ${timeout_s}s"; }
  sleep 1
done
ok "$pg_image accepts connections on 127.0.0.1:$pg_port"

# ── 3. The server really is 18 ──────────────────────────────────────────────
num=$(psql_in 'SHOW server_version_num') || die "could not ask the server for its version"
if m=$(is_server_18 "$num"); then
  ok "server_version_num is $num ($(psql_in 'SHOW server_version'))"
else
  die "$m"
fi
if m=$(is_server_18 170011); then
  fail "control server: 170011 passed the major check"
else
  ok "control server: 17.x is refused ($m)"
fi
layout=$("$rt" exec "$pg_name" sh -c 'echo "$PGDATA"')
if m=$(same "$layout" /var/lib/postgresql/18/docker); then
  ok "the cluster lives in $layout, under the mounted /var/lib/postgresql"
else
  fail "PGDATA: $m"
fi

# ── 4. Build and start core against it ──────────────────────────────────────
core_image=${CORE_IMAGE:-}
if [ -z "$core_image" ]; then
  start=$(date +%s)
  if (cd "$root" && "$rt" build -f apps/core/Dockerfile -t "$core_tag" apps/core) >"$work/build.log" 2>&1; then
    built_image=1
    core_image=$core_tag
    ok "core image builds ($(( $(date +%s) - start ))s, apps/core/Dockerfile)"
  else
    tail -20 "$work/build.log"
    die "the core image did not build"
  fi
fi

port=$("$rt" run --rm --network host --entrypoint node "$core_image" -e '
  const s = require("net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });') \
  || die "could not pick a free port with $core_image"
secret=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
"$rt" run -d --name "$core_name" --network host \
  -e HOST=127.0.0.1 -e PORT="$port" -e SERVER_SECRET="$secret" \
  -e DATABASE_URL="postgres://openplate:$pg_pass@127.0.0.1:$pg_port/openplate_sync" \
  "$core_image" >/dev/null || die "the core container did not start"

url="http://127.0.0.1:$port/health"
i=0
s=000
while [ "$i" -lt "$timeout_s" ]; do
  s=$(status_of "$url")
  [ "$s" = 200 ] && break
  "$rt" inspect -f '{{.State.Running}}' "$core_name" 2>/dev/null | grep -qx true || break
  sleep 1
  i=$((i + 1))
done
if [ "$s" = 200 ]; then
  ok "core answers GET /health with 200 on Postgres 18"
else
  "$rt" logs "$core_name" 2>&1 | tail -15
  die "core answered $s, not 200, at /health within ${timeout_s}s"
fi

# ── 5. Migrations and version ───────────────────────────────────────────────
if "$rt" logs "$core_name" 2>&1 | grep -q '"message":"Migrations applied"'; then
  ok "core logged Migrations applied"
else
  fail "core did not log Migrations applied"
fi
files=$(find "$root/apps/core/drizzle/migrations" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
rows=$(psql_in 'SELECT count(*) FROM drizzle.__drizzle_migrations') || die "could not read drizzle.__drizzle_migrations"
if m=$(same "$rows" "$files"); then
  ok "$rows of $files committed migrations are recorded in drizzle.__drizzle_migrations"
else
  fail "migrations recorded: $m"
fi
if m=$(same "$((files - 1))" "$files"); then
  fail "control count: a count one short of the files passed"
else
  ok "control count: one migration short is refused ($m)"
fi

want_version=$(jq -r '.version' "$root/apps/core/package.json")
got_version=$(curl -s -m 5 "$url" | jq -r '.serviceVersion // empty')
if m=$(same "$got_version" "$want_version"); then
  ok "/health serviceVersion is $got_version, equals apps/core/package.json"
else
  fail "serviceVersion: $m"
fi
if m=$(same "$want_version-m272-control" "$want_version"); then
  fail "control version: a different serviceVersion passed"
else
  ok "control version: a serviceVersion that differs from package.json is refused"
fi

# ── Control: a stopped core refuses the request ─────────────────────────────
"$rt" stop -t 5 "$core_name" >/dev/null 2>&1
s=$(status_of "$url")
if [ "$s" = 000 ]; then
  ok "control request: a stopped core refuses the request"
else
  fail "control request: a stopped core still answered $s, so the request proves nothing"
fi

# ── 6. Tear down and prove it ───────────────────────────────────────────────
"$rt" rm -f "$core_name" "$pg_name" >/dev/null 2>&1
"$rt" volume rm -f "$vol_name" >/dev/null 2>&1
left=$("$rt" ps -a --filter "name=$stamp" --format '{{.Names}}'; "$rt" volume ls -q --filter "name=$stamp")
if [ -z "$left" ]; then
  ok "no container or volume of this run remains"
else
  fail "left behind: $left"
fi

[ "$failed" = 0 ] || exit 1
echo "PASS: postgres 18"
