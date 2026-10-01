# Changelog

All notable changes to `openplate-inference` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0, a breaking
change moves the minor.

## [Unreleased]

### Changed

- **The image runs on Node 24.** The build stages move from `node:22-bookworm-slim` to `node:24-bookworm-slim`, and the shipped image copies that Node binary. pnpm 11.5.1 comes from corepack, which reads the new `packageManager` field of `package.json`, so the Dockerfile no longer names a pnpm version. `engines.node` is `>=24`. Nothing changes in how you run the container. Check: `scripts/check-image-boots.sh inference` at the repository root.

## [0.2.0] - 2026-09-30

### Changed

- **The plate contract knows the client's flags and translations.** openplate
  now asks every provider for `flags` (food cautions) and `translations` (the
  food's name in each app language). The vendored contract accepts both as
  optional fields, and its JSON Schema lists them. This service does not fill
  them yet. openplate reads an answer without them as before.
  ([cc96887](https://github.com/LowCarbCheck/openplate/commit/cc96887))
- **The Quadlet unit reads every setting from an env file you own.** The unit
  carried each compose default as an `Environment=` line. Podman ranks those
  above an env file. On Podman 4.9, which reads no drop-in, `API_KEYS` and
  `MODEL_PROFILE` could only be changed by editing the installed unit. The
  unit now reads `inference.defaults.env`, which ships beside it, and then
  `inference.env`, which is yours and wins. Before you copy the new unit over
  an install, put your key in `inference.env` as `API_KEYS=`. The unit does
  not start without that file.
  ([4158a79](https://github.com/LowCarbCheck/openplate/commit/4158a79))
- **Every setting now reaches the inference container from your .env file.**
  The three compose files that run this service, `docker/compose.yml` here and
  openplate's `compose.inference.yml` and `compose.full.yml`, previously set
  five or six variables, mostly as fixed values. They now forward all 27
  variables that the service and its entrypoint read. To bring your own
  runtime, set `MODEL_PROFILE=external`, `MODEL_RUNTIME_URL` and `MODEL_ID` in
  `.env`, plus the health start period override in the file. A new setting,
  `OFF_API_URL`, points `FOOD_SOURCE=off` at a national OpenFoodFacts host or
  a mirror. It defaults to `https://world.openfoodfacts.org`, the host that
  was hard-coded. With an empty `.env`, nothing changes. Every entry in
  `.env.example` is now commented out. It also gains the seven entrypoint
  settings it lacked, including `LLAMA_THREADS` and `WEIGHTS_MIRROR_BASE`. If
  your `.env` is a copy of the old `.env.example`, delete its `PROFILE=custom`
  line. That line now reaches the service, which then reports `custom` instead
  of following `MODEL_PROFILE`. `tests/unit/compose-env-surface.test.ts` and
  `tests/unit/compose-defaults-inert.test.ts` keep it that way.
  ([fd225c3](https://github.com/LowCarbCheck/openplate/commit/fd225c3),
  [c4546c6](https://github.com/LowCarbCheck/openplate/commit/c4546c6))

### Fixed

- **Dependencies moved past known advisories.** `sharp`, `esbuild` and
  `express` are on versions without the published advisories.
  ([3353929](https://github.com/LowCarbCheck/openplate/commit/3353929))
- **`latest` and `cuda` now name the newest release.** Both tags moved with
  every change to the main branch. They now move only when a release is cut.
  The new `main` and `main-cuda` tags follow the main branch.
  ([f047e1e](https://github.com/LowCarbCheck/openplate/commit/f047e1e))

### Docs

- **The configuration guide lists the settings it missed.** It adds
  `MAX_IMAGE_BYTES`, `LLAMA_EXTRA_ARGS`, `RUNTIME_PORT`,
  `NVIDIA_VISIBLE_DEVICES`, `PROFILE` and `OFF_API_URL`. It links the page of
  every environment variable. The hardware guide gives the latency of a simple
  plate and of a full breakfast, measured on a 6-core machine, instead of one
  figure.
  ([4564174](https://github.com/LowCarbCheck/openplate/commit/4564174),
  [9191419](https://github.com/LowCarbCheck/openplate/commit/9191419))

## [0.1.4] - 2026-09-20

### Added

- **`LCC_API_KEY`, an optional key for the `lcc` food source.** Without it,
  lookups run on LowCarbCheck's anonymous tier. This tier allows 1,000 credits
  per UTC day across all requests from the host IP address, or about 41
  worst-case scans. A free key from lowcarbcheck.org/developers raises that to
  100,000 credits a month. The service sends the key as a bearer token to
  `LCC_API_URL` and nowhere else. It logs only whether a key is set. When unset,
  it sends no `Authorization` header.

### Changed

- **The guides name every outbound call.** The README and the privacy guide
  now list food-name lookups for `FOOD_SOURCE=off` and `FOOD_SOURCE=lcc`. They
  also list remote `EMBEDDING_RUNTIME_URL` embedding calls alongside weight
  downloads. The configuration guide now gives the anonymous tier cost per
  scan.

## [0.1.3] - 2026-09-07

- Correct the API and configuration guides. Both guides stated that every food
  entry includes a `provenance` field of `"corpus"` or `"model"`. The field is
  actually optional, omitted when nothing resolves the item, and this service
  never emits `"model"`. Both documents now describe what the service does.
- Add a validation check to the gate. An environment variable named in the docs
  must exist in the source, a list of values stated in the docs must match the
  schema, and a field documented as present on every item must not be optional.
  The check carries a written list of what it cannot verify, and lists names
  implemented in the openplate repository with the file and line where each was
  verified.

## [0.1.2] - 2026-09-07

- The runtimes guide now draws the request path from the browser to your
  runtime. It marks the grammar-constrained decoding step, since that is the
  step a runtime must support.
- The README, the guides, and the three scripts whose output the guides quote
  were reworded to drop every em dash and en dash. No claim changed.

## [0.1.1] - 2026-09-05

- The README now lists the published documentation in a Documentation table,
  so the project site at openplate.de can quote it.
- A release now tells the site to re-quote the docs.

## [0.1.0] - 2026-08-19

The first published image.
