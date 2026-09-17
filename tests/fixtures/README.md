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
