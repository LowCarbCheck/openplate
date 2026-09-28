# YAZIO export fixtures

`days.json` and `products.json` are SYNTHETIC. No person's diary is in them.
They mimic the two files that the open-source exporter
[`aleksandr-bogdanov/yazio-exporter`](https://github.com/aleksandr-bogdanov/yazio-exporter)
writes with `yazio-exporter days` and `yazio-exporter products`. The importer
in `app/lib/yazio-import.ts` reads exactly these two files, and
`tests/unit/yazio-import.test.ts` pins its numbers against them.

Every key comes from
`.tracker/M254-openplate-yazio-import/research/PROVENANCE.md` in the workspace,
which names the source file and line for each one. The two files here are that
folder's `sample-export.json` split at its `days` and `products` keys, which
the real tool never combines.

Three cases were added to the sample so that every skip reason has a row:

- `2026-09-02`, a recipe portion that points at `recipe-ghost-missing-001`,
  which is not in `products.json` (missing recipe).
- `2026-09-02`, a product item whose `amount` is the string `"a handful"`
  (invalid item).
- `2026-09-03`, a portion of `recipe-no-ingredients-001`, a recipe with an
  empty ingredient list, so its weight cannot be computed.

The `simple_products` entries are a guess at a shape no source has shown. The
importer counts them and never reads their contents.

Formatting is `JSON.stringify(value, null, 2)` plus a trailing newline.
