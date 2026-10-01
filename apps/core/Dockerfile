# openplate-core, self-hostable account server with encrypted diary sync.
#
# Builds from tracked source and public npm only. There is no build secret,
# no private `.npmrc` and no `@sprqvntrs/*` dependency anywhere in the tree ,
# that is a release invariant of this repo, not an accident of the current
# dependency list, and it is what makes this image reproducible by anyone.
#
# The runtime layer carries the esbuild bundle plus exactly five real
# dependencies (`express`, `pg`, `dotenv`, `undici`, `web-push`, see
# `scripts/build.ts` for why those are external), and the committed migrations,
# which the service applies itself at boot. A self-hoster pulling a newer tag
# never runs a second command.

FROM node:24-alpine AS base
WORKDIR /app
# pnpm comes from corepack, which reads `packageManager` in package.json and
# installs exactly that version, so this file carries no pnpm version. A global
# pnpm newer than `packageManager` would self-manage and fetch a second binary
# that has no musl build for arm64 (the app's 2026-08 arm64 segfault). The
# package.json copy comes first, or corepack falls back to its own default.
COPY package.json ./
RUN corepack enable && corepack prepare --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
RUN pnpm build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Data, not code: read by the migrator at boot (`src/main.ts`).
COPY drizzle ./drizzle

# Never run as root. `node` exists in the base image with uid 1000.
USER node

EXPOSE 3000

# `/health` is unauthenticated by design (PROTOCOL.md §5.6) precisely so a
# healthcheck can use it without holding a credential.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
