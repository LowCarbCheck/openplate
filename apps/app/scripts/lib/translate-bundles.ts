/**
 * The decisions `scripts/translate-ui.ts` makes that are this app's and not the library's.
 *
 * The library under `scripts/lib/translate*.ts` is a vendored copy of the website's and may not be
 * edited here (see `scripts/sync-translate-lib.ts`). What the app decides for itself lives in this
 * file, where a test can call it: which language the catalogs are written in, where the memory is
 * kept, and which namespace is spoken in which voice.
 *
 * ── ONE REGISTER PER REQUEST, SO ONE BUNDLE PER REQUEST ──
 * `app/i18n/locales/<locale>/common.json` addresses the reader as "du"; `legal.json` is the
 * imprint, the privacy notice and the terms, and addresses the reader as "Sie". Both are right,
 * and they are opposite instructions. The register is written into the SYSTEM prompt of a request
 * (`style()` in the vendored `translate.ts`), so one request can carry one voice, and the strings
 * of the two voices must never share a batch. The rule itself, `bundleForNamespace`, is the
 * library's and is imported rather than restated, so the two repositories cannot answer that one
 * question differently. What is this app's is the grouping and the buy loop around it.
 *
 * ── THE MEMORY KEY IS THE LIBRARY'S NOW ──
 * The memory is keyed by `hash(path + english)`, not by English alone. That keying was born here:
 * the first `--adopt` over the German catalog rewrote 26 values when an English-keyed rebuild put
 * one entry's answer under every key with that English (`nav.fasting` "Fasten" became "Fasten
 * läuft", `scan.capture.takePhoto` became the landing headline). The website took the keying into
 * `scripts/lib/translate-ui.ts` in M230, so `pathOf`, `unitKey`, `collectByPath`, `memoAt` and
 * `rebuildByPath` are imported from the vendored copy and no longer restated here. The key format
 * is unchanged, `hash(path\nenglish)`, so the memory written under the app's own copy reads back
 * under the library's; `tests/unit/translate-bundles.test.ts` proves the de bundles rebuild byte
 * for byte from the committed memory.
 */
import { type LanguageCode } from '../../app/i18n/language-prefs';
import { CHUNK, type Usage, chunk, translate } from './translate';
import { type TranslateFn, type UnitOfLeaf, bundleForNamespace, buy } from './translate-ui';

/**
 * The language every other catalog is made from, and the key the memory is filed under.
 *
 * A literal rather than `DEFAULT_LANGUAGE` from `language-prefs.ts`, on purpose. That constant is
 * documented as "the reference bundle" today, but it is the answer to "what does a visitor with no
 * preference get", and the two questions can come apart the way they did on the website when
 * German took the root URL. This one is the answer to "what are the translations made from", and
 * `satisfies` keeps it one of the app's languages.
 */
export const SOURCE_LANGUAGE = 'en' satisfies LanguageCode;

/**
 * Where the per-locale translation memory lives, relative to the repository root.
 *
 * Beside the catalogs rather than under `src/generated/` as on the website, because this app has
 * no `src/` and because the person who edits `de/common.json` by hand is the person who most needs
 * to find `memory/README.md` next to it: the memory is the record, and a hand edit to the catalog
 * that is not also made to the memory is undone by the next run. Nothing under `app/` reaches a
 * build unless it is imported, and nothing imports this directory.
 */
export const MEMORY_DIR = 'app/i18n/memory';

/** The namespaces of each bundle, in the order given, with only the bundles that have any. */
export function groupByBundle(namespaces: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const namespace of namespaces) {
    const bundle = bundleForNamespace(namespace);
    const group = out.get(bundle) ?? [];
    group.push(namespace);
    out.set(bundle, group);
  }
  return out;
}

/** What the buy loop tells its caller after every chunk, and where the caller may stop it. */
export interface ChunkReport {
  bundle: string;
  /** This chunk's ordinal within its bundle, from 1. */
  at: number;
  /** The number of chunks in this bundle. */
  of: number;
  batch: UnitOfLeaf[];
}

export interface BuyRun {
  locale: string;
  key: string;
  /** Every answer this run has, by memory key. `buy` writes into it. */
  done: Map<string, string>;
  total: Usage;
  notes: readonly string[];
  /** The network call. A test passes a stub and reads its call log; the CLI leaves the default. */
  translateFn?: TranslateFn;
  /** Runs after every chunk is bought. `'stop'` ends the run; what was bought stays in `done`. */
  afterChunk: (report: ChunkReport) => 'continue' | 'stop';
}

/**
 * Buy every bundle's misses, one bundle at a time.
 *
 * ONE BUNDLE PER REQUEST, never two, because the register is in the system prompt and a request
 * has one system prompt. The library's `buy` takes the bundle as data and asks under it; this
 * loop is what keeps the batches of two bundles from ever being one batch. `afterChunk` is where
 * the CLI saves the memory and checks the money actually spent.
 */
export async function buyByBundle(pending: Map<string, UnitOfLeaf[]>, run: BuyRun): Promise<'done' | 'stopped'> {
  const translateFn = run.translateFn ?? translate;
  for (const [bundle, misses] of pending) {
    if (misses.length === 0) continue;
    const batches = chunk(misses, CHUNK);
    let at = 0;
    for (const batch of batches) {
      at += 1;
      await buy(batch, bundle, run.key, run.locale, run.done, run.total, run.notes, translateFn);
      if (run.afterChunk({ bundle, at, of: batches.length, batch }) === 'stop') return 'stopped';
    }
  }
  return 'done';
}
