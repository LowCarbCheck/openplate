# German legal text — review record

## Status: AWAITING REVIEW

The German Impressum, Datenschutzerklärung and Nutzungsbedingungen are **machine
translations that no lawyer has read**. They are live. This file exists so that
fact is written down somewhere other than a commit message.

| | |
|---|---|
| Translated | 2026-09-01 |
| Source | `app/i18n/locales/en/legal.json`, at the English text corrected the same day (M167/02 Phase A) |
| Tool | `pnpm -C djinn wordsmith translate` |
| Model | `google/gemini-3.7-flash` via OpenRouter, temperature 0 |
| Scope | 116 strings across all three documents |
| Reviewed by a lawyer | **No** |

## What is and is not machine-produced

**Not translated, and cannot be:** the operator's identity — company name,
address, managing director, register number and court, VAT id. Those live in
`app/routes/legal/operator.ts` and are rendered from one copy in both languages,
so the two documents cannot name different companies. The tool never saw them.

**Translated:** every sentence of prose. `tests/unit/legal-locales.test.ts`
asserts key parity in both directions, that no placeholder or markup tag was
lost, and that no German entry is a copy of its English source.

Those tests check STRUCTURE. None of them can tell you the German is legally
right. That is what the review is for.

## What a reviewer should look at first

1. **Datenschutzerklärung §3 and §6** — the split between the app server, which
   stores nothing, and the separate sync service, which holds an account. This
   distinction is new in the English as of 2026-09-01 and is the part most
   likely to have been flattened in translation.
2. **§9 Cookies** — the four preference cookies. Whether the German supports
   the position that §25 TTDSG is not engaged.
3. **§9a** — only rendered when the instance actually runs analytics. It is
   currently NOT rendered in production. Review it anyway; it appears the moment
   `MATOMO_URL` is set.
4. **Nutzungsbedingungen §7** — the sync terms, including the claim that
   deletion is immediate with no grace period. Confirm that matches what the
   product does before relying on it.
5. **Nutzungsbedingungen §11** — Governing law, and whether the German phrasing
   preserves the consumer-protection carve-out.

## How to change the German

Re-run the tool. Do not hand-edit `app/i18n/locales/de/legal.json`: a hand edit
is invisible to the next run and silently reverts. If a reviewer supplies a
corrected sentence, change the ENGLISH source if the meaning changed, or add the
correction to the tool's `--notes` and re-run.
