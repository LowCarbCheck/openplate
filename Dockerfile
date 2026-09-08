FROM node:20-alpine AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN npm ci

FROM node:20-alpine AS production-dependencies-env
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev

FROM node:20-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app

# The commit this image is built from, stamped into the bundle and reported by
# the `X-Openplate-Build` header. It has to be passed in: `.dockerignore`
# excludes `.git` and the alpine base carries no git binary, so the build cannot
# work it out for itself. Unset is fine, the stamp then says `unknown` and the
# app simply never claims a newer bundle is ready.
ARG OPENPLATE_BUILD_SHA=""
ENV OPENPLATE_BUILD_SHA=$OPENPLATE_BUILD_SHA
RUN npm run build

FROM node:20-alpine
COPY ./package.json package-lock.json /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
WORKDIR /app
CMD ["npm", "run", "start"]