# Changelog

All notable changes to `openplate-inference` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0, a breaking
change moves the minor.

## [Unreleased]

### Changed

- **The plate contract knows the client's flags and translations.** openplate
  now asks every provider for `flags` (food cautions) and `translations` (the
  food's name in each app language). The vendored contract accepts both as
  optional fields, and its JSON Schema lists them. This service does not fill
  them yet. openplate reads an answer without them as before.

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
