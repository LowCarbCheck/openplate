# The translation memory

`<locale>.json` in this directory is the record of every translated string in
`app/i18n/locales/<locale>/`, keyed by a hash of the English it translates:

```json
"3f2a9c1e0b7d4e61": { "en": "Log a meal", "model": "hand-written", "at": "2026-09-14", "de": "Mahlzeit eintragen" }
```

It is written by `pnpm translate:ui` (`scripts/translate-ui.ts`) and read by
nothing at runtime. The app ships the catalogs, not this file.

## The memory is the record, the catalog is its output

Every run rebuilds the target catalogs from the English tree and this memory,
memory first. A German sentence changed by hand in `de/common.json` alone is
put back by the next run. To change a translation:

- edit the entry here, found by its `en` field, or
- delete the entry, and the next run buys that one string again.

## Why an English edit costs one string

Editing an English string changes its hash, so exactly that key stops matching
and is bought on the next run. Every other entry still resolves. A key added to
`en/common.json` is a miss until a run buys it; the parity test in
`tests/unit/i18n-key-parity.test.ts` is what turns that miss red.

## Two voices

`common.json` addresses the reader as "du". There used to be a second bundle,
`legal.json`, in "Sie", bought in separate requests so one register never
leaked into the other. It left the repository in M246: the legal pages are
markdown files an operator mounts (`docs/content.md`).

ONE EXCEPTION IN `common.json`. The chrome of the two statutory forms
(`declarations.*`, `content.lastUpdated`) moved there from `legal.json` with
its hand-written "Sie" translations, because it sits on pages whose text is in
"Sie". A run buys a changed English string in the `common` voice, so after an
English edit under `declarations`, check the German answer for "du" and fix it
here by hand.
