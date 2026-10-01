---
name: inference-gate-and-lint-traps
description: apps/inference gate order, host node works, and the anti-slop and doc-claims rules that fail a first draft
metadata:
  type: project
---

The pre-push gate in apps/inference runs lint, typecheck, `pnpm check:doc-claims`, `pnpm test --run`, build. Node 24 under nvm is on the host PATH, so `pnpm ...` runs without the toolbox.

**Why:** doc-claims and anti-slop lint are the two stages a green vitest run does not cover.

**How to apply:**
- anti-slop `no-unknown-returns` also fires in tests: a helper returning `Promise<unknown>` from `JSON.parse` fails lint. Return the raw string and parse at the call site.
- anti-slop bans the substring "shape" in any identifier.
- doc-claims: writing "carries `field`" in README.md or docs/*.md fails when the field is `.optional()` in `PlateIdentificationSchema`. Two or more quoted values in code spans after a field name count as an enum claim and must match the schema.
- Service-only per-item fields (`provenance`, `attribution`, `flagsCoverage`) go on `IdentifiedFoodSchema`, never `BaseIdentifiedFoodSchema`: schema-parity compares Base to apps/app, and the wire JSON Schema is derived from Base.
- Name flags (task T4, 2026-10-01) live in `src/pipeline/food-flags.ts`, a curated table; a miss sets no `flags` key.
- anti-slop `no-known-value-widening` rejects an annotated `Record<K, string>` const and an inline object return type: use `as const satisfies Record<...>` and a named exported interface.
- Name translation (task T5, 2026-10-01): `server/request-language.ts` reads `Accept-Language`, `pipeline/translate-names.ts` makes a second text-only call inside the admission pool, fails open. `IdentifiedFoodSchema` overrides `translations` as partial; Base untouched.
- Node's `fetch` sends `Accept-Language: *` when none is set (measured, Node 24). A test that needs a truly absent header must use `node:http`.
