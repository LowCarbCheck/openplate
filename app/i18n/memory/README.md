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

`common.json` addresses the reader as "du"; `legal.json` as "Sie". The script
buys the two in separate requests so one register never leaks into the other.
Both share this one memory: an English sentence that appears in both catalogs
is one entry, in the voice of whichever bundle bought it first.
