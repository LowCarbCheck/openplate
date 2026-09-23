# Test fixtures

## `nutrients-response.json` is a SHARED, CROSS-REPO file

One real `GET /api/v1/nutrients` body from LowCarbCheck, all 25 nutrients, 16 of
them carrying the `rdaDe` block added in M234. LowCarbCheck commits a
byte-identical copy at
`apps/remix-lcc/app/lib/nutrient-api/__fixtures__/nutrients-response.json`, and
both repos pin the same SHA-256 in a test:

```
a60159701f3b6b21d1f45cf836d42d51db19bb016928ab878c528735398cb647
```

Why: openplate transcribes this wire shape by hand in
`app/lib/nutrient-reference.ts`, because the two repos deploy independently and
neither imports the other. Nothing else ties the two transcriptions together.
The hash does: change the file there and openplate goes red until someone copies
the new file across and updates both literals.

To change it, in one commit per repo:

1. Regenerate or edit the file in LowCarbCheck.
2. `sha256sum nutrients-response.json`.
3. Put the new hash in that repo's `__tests__/wire-fixture.test.ts`.
4. Copy the file here and put the same hash in
   `tests/unit/nutrient-reference.test.ts`.

Keep the formatting as it is: `JSON.stringify(body, null, 2)` plus a trailing
newline. A reformat changes the hash without changing the contract, which is
noise both repos have to absorb for nothing. `.prettierignore` keeps
`pnpm format` off it for the same reason.

## `sync-payload-v0.35.1.json` was WRITTEN BY THE 0.35.1 ENGINE

Not a hand-built object shaped to look like one. M240 merged fasts and the
pantry and argued, on a reading of the code, that a 0.35.1 device could not
lose anybody a row. That argument rested on hand-built payloads, which is the
one thing a compatibility claim must not rest on.

This file was produced by checking out tag `v0.35.1` into its own worktree with
its own `node_modules`, and running THAT release's `stampSnapshot` and
`mergeSnapshots` over a small fixed diary: two food logs with one of them
deleted and journalled, two fasts (one open, one finished), two pantry rows and
one saved meal. Every instant and id in it is a literal, so the output is
deterministic and the file can be regenerated and diffed.

What it proves, and what `tests/integration/old-release-payload.test.ts`
asserts, is the shape rather than the wish: the snapshot carries fasts, pantry
rows and saved meals, `meta.perEntity` carries NO stamp for any of them, and
`meta.tombstones` carries the food log the old device really did delete.

Regenerate it only from a real `v0.35.1` checkout. A payload this repository's
current engine wrote would assert nothing at all.

## `plan-offer.json` is a NEUTRAL `GET /v1/plans/offer` body

The shape M250 and M245/03 share, with placeholder texts that say "Fixture" on
purpose. It is read by `tests/unit/plans-client.test.ts`, the plan card and
plan page unit tests, and served by the browser tier's stubbed core. Never put
a real order sentence, legal sentence or consent text here: those live in the
private biller. The two numbers are fixture prices, and no app code holds them.
