#!/bin/sh
set -e

# openplate's server is stateless — no database, no migrations, nothing to
# prepare before it can serve. This entrypoint exists only to default
# NODE_ENV and exec the server.
#
# Not `pnpm start`: that script wraps tsx in cross-env, a devDependency absent
# from the --prod-pruned production image. NODE_ENV is defaulted here so the
# image also behaves outside compose (which sets it explicitly).
export NODE_ENV="${NODE_ENV:-production}"
echo "[start] Starting server..."
#
# Node directly, not `pnpm exec tsx`. pnpm and the tsx CLI each stayed resident
# as an idle parent of the real process, about 70 MB per instance. `node
# --import tsx` loads the same TypeScript in one process, and server.ts handles
# SIGTERM itself, so a stop still drains connections.
exec node --import tsx ./server.ts
