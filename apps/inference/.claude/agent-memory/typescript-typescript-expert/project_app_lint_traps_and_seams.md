---
name: app-lint-traps-and-seams
description: apps/app anti-slop lint traps in tests, the host-node gate, and where the inference-facing seams live (capabilities, Accept-Language, flagsCoverage)
metadata:
  type: project
---

apps/app runs on host node 24 (no toolbox needed): `pnpm lint` (oxlint, prints nothing when clean), `pnpm typecheck`, `pnpm test:unit` (about 160 s, about 6900 tests).

**Why:** a first draft of test helpers failed lint and typecheck twice in ways a passing test run did not show.

**How to apply:**
- anti-slop `no-object-parameters` bans an `object` parameter type, also in tests; `no-known-value-widening` bans an anonymous object RETURN type on a helper. Use a named interface.
- An interface (for example `FoodFlags`) is not assignable to `UnvalidatedProviderJson` (no index signature); type a test fixture param with a named interface instead.
- Inference-facing seams (T6a, 2026-10-01): `app/lib/ai/provider-capabilities.ts` (reads `/models` capabilities, fails open to full), `probeProviderEndpoint` in `app/services/vision/verify-key.ts` (shared GET with deadline), registry field `sendsAppLanguage` (true only for `openai-compatible`), `IntakeTaskDescriptor.language`, `IdentifiedFood.flagsCoverage`. See [[inference-gate-and-lint-traps]].
