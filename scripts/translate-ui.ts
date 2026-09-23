/**
 * translate-ui, machine-translate the app's own UI catalogs into one language.
 *
 * The app's entry over the translator this workspace already runs for its website. The library
 * under `scripts/lib/translate*.ts` is a vendored copy of `openplate-website`'s (see
 * `scripts/sync-translate-lib.ts` and `scripts/lib/TRANSLATE_SOURCE.json`); this file names what
 * differs: the catalogs are `app/i18n/locales/<locale>/*.json` (`common`, and `releases`; the
 * `legal` bundle left in M246), the memory is
 * `app/i18n/memory/<locale>.json`, the languages are this app's, and `legal` is bought in its
 * own voice. Same flags, same exit codes, same memory discipline as the website's script.
 *
 *   pnpm translate:ui --locale de --dry              # count and price the misses, spend nothing
 *   pnpm translate:ui --locale de                    # buy them. CI only, see WRITABLE
 *   pnpm translate:ui --locale de --local            # ... or override that, deliberately
 *   pnpm translate:ui --locale de --budget 0.05      # approve a spend over the default ceiling
 *   pnpm translate:ui --locale de --adopt            # record today's hand-written bundle, buy nothing
 *
 * ── EXIT CODES, BECAUSE A WORKFLOW READS THEM ──
 *   0  done, or nothing to do
 *   1  broken: no key, no rate, a memory it may not write, a banned dash in the memory
 *   2  refused on cost. Nothing was sent, or what was sent is saved and the rest is not coming.
 *
 * ── THE MEMORY IS THE RECORD, AND A HAND EDIT TO THE CATALOG IS NOT ──
 * `write()` rebuilds every target catalog from the English tree and the memory on every run,
 * memory first and the catalog's own value second. A German sentence changed by hand in
 * `de/common.json` alone is therefore put back by the next run. Change it in
 * `app/i18n/memory/de.json` (find the entry by its `path` field), or delete that entry to have
 * the string bought again. `app/i18n/memory/README.md` says the same thing next to the file.
 *
 * ── KEYED BY PATH AND ENGLISH ──
 * The vendored `scripts/lib/translate-ui.ts` says why, with the two regressions the English-only
 * keying produced on this catalog. The consequence for a reader of the memory: one entry per
 * catalog key, and an English sentence under two keys is two entries.
 *
 * ── `--adopt`, ONCE ──
 * German was hand-written before this script existed. A first ordinary run would see an empty
 * memory, call all of it a miss, buy it, and replace a reviewed translation with a machine one.
 * `--adopt` records the bundle as it stands, keyed by the hash of the English it translates and
 * stamped `hand-written`, so nothing is bought and nothing is overwritten. It is a flag and not
 * the default because adopting on every run would pair the hash of NEW English with the OLD
 * German and call the key done.
 *
 * ── THE SCREEN GLOSSARY RIDES IN THE NOTES ──
 * `scripts/translate-glossary.ts` builds the app's own name for each of its screens out of the
 * English and target `common.json` and appends it to `NOTES`, so a release lead that names a
 * screen is answered with the name the app itself uses. It also reports the remembered leads that
 * missed one. Its header says why the names are read rather than typed, and why the report never
 * fails a run.
 *
 * ── TWO VOICES, TWO BUNDLES ──
 * `common.json` says "du" and `legal.json` says "Sie", and the register goes into the system
 * prompt of a request, so the strings of the two are batched apart (`groupByBundle`) and bought
 * one bundle at a time (`buyByBundle`). The library's `buy` carries the bundle to `translate`,
 * and `style(locale, bundle)` asks for the formal register on `legal`;
 * `tests/unit/translate-bundles.test.ts` proves both through the library's seam without a paid
 * call.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { SUPPORTED_LANGUAGES } from '../app/i18n/language-prefs';
import { type Memory } from './lib/translate-shims/docs-i18n.server';
import { MODEL, type Quote, type Usage, dashOffenders, loadMemory, lookup, price, saveMemory } from './lib/translate';
import { MEMORY_DIR, SOURCE_LANGUAGE, buyByBundle, groupByBundle } from './lib/translate-bundles';
import {
  type CatalogTree,
  type UnitOfLeaf,
  catalogPath,
  collectByPath,
  leaves,
  memoAt,
  namespacesOf,
  readCatalog,
  rebuildByPath,
  saveCatalog,
  skipReason,
} from './lib/translate-ui';
import { RELEASE_NAMESPACE, SCREEN_NAMESPACE, screenGlossary, screenOffenders } from './translate-glossary';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
}

const ROOT = resolve(import.meta.dirname, '..');
const LOCALE = flag('locale') ?? 'de';
const DRY = args.includes('--dry') || args.includes('--dry-run');
const ADOPT = args.includes('--adopt');
/**
 * The spend ceiling for ONE RUN, the website's figure. This corpus is larger than the site's,
 * but rebuilding all of it from nothing is still cents; a run that wants more than this is a
 * re-segmentation or a new language, which is the moment to look before paying.
 */
const BUDGET = Number(flag('budget') ?? process.env.OPENPLATE_TRANSLATE_UI_BUDGET ?? '0.05');
/** The exit code for "the run was refused on cost", distinct from "the run broke". */
const OVER_BUDGET = 2;
/** The one-writer rule: translation is not deterministic, so two writers produce two truths. */
const WRITABLE = process.env.CI !== undefined || process.env.GITHUB_ACTIONS !== undefined || args.includes('--local');
const OUT = resolve(ROOT, MEMORY_DIR);
const FILE = resolve(OUT, `${LOCALE}.json`);

/** What a catalog leaf carries that a parsed document never does: a named placeholder, a Trans tag. */
const NOTES = [
  'A {{name}} placeholder is a value the application substitutes at render time. Keep the name',
  'exactly as written, in English, inside the double braces. Never translate the name.',
  'An <example> ... </example> tag pair wraps words that become a link or a bold phrase. Keep both',
  'halves, keep the tag name in English, and keep some words between them.',
  'You may move a placeholder or a tag pair to wherever the target grammar puts it.',
];

if (LOCALE === SOURCE_LANGUAGE) {
  console.error(`translate-ui: ${LOCALE} is the source language. It is what the other catalogs are made from.`);
  process.exit(1);
}
if (!SUPPORTED_LANGUAGES.some((language) => language === LOCALE)) {
  console.error(`translate-ui: ${LOCALE} is not one of the app's languages (${SUPPORTED_LANGUAGES.join(', ')}).`);
  process.exit(1);
}

const NAMESPACES = namespacesOf(ROOT, SOURCE_LANGUAGE);
const ENGLISH = new Map<string, CatalogTree>(
  NAMESPACES.map((namespace) => [namespace, readCatalog(catalogPath(ROOT, SOURCE_LANGUAGE, namespace))]),
);
const TARGET = new Map<string, CatalogTree>(
  NAMESPACES.map((namespace) => [namespace, readCatalog(catalogPath(ROOT, LOCALE, namespace))]),
);

/** The two catalogs the screen names come out of. A run without them is a run that cannot name a screen. */
const SCREEN_ENGLISH = catalogOrExit({ trees: ENGLISH, namespace: SCREEN_NAMESPACE, locale: SOURCE_LANGUAGE });
const SCREEN_TARGET = catalogOrExit({ trees: TARGET, namespace: SCREEN_NAMESPACE, locale: LOCALE });
/** The app's own name for each of its screens, in this locale, appended to every request's notes. */
const SCREENS = screenGlossary({ english: SCREEN_ENGLISH, target: SCREEN_TARGET });

/** The prose of each bundle, keyed by path and English (see `translate-bundles.ts`). */
const BUNDLES = new Map<string, UnitOfLeaf[]>(
  [...groupByBundle(NAMESPACES)].map(([bundle, namespaces]) => [
    bundle,
    namespaces.flatMap((namespace) => {
      const tree = ENGLISH.get(namespace);
      return tree === undefined ? [] : collectByPath(namespace, tree);
    }),
  ]),
);
/** Every unit, for the count and the memory write. */
const units = new Map<string, UnitOfLeaf>();
for (const group of BUNDLES.values()) for (const unit of group) units.set(unit.hash, unit);
const skipped = [...ENGLISH.values()].flatMap((tree) => leaves(tree)).filter((leaf) => skipReason(leaf.value) !== null);

const memory: Memory = loadMemory(FILE);
if (ADOPT && DRY) console.log('translate-ui: --adopt does nothing under --dry. Re-run without it to record them.');
if (ADOPT && !DRY) adopt();
const done = lookup(memory, LOCALE);
const misses = [...units.values()].filter((unit) => !done.has(unit.hash));
const words = misses.reduce((sum, unit) => sum + unit.source.split(/\s+/).length, 0);

console.log(
  `translate-ui: ${LOCALE}, ${NAMESPACES.length} namespaces in ${BUNDLES.size} bundles, ${units.size} strings to translate, ` +
    `${skipped.length} skipped as a name, a number or a placeholder, ${done.size} in memory, ` +
    `${misses.length} misses (~${words} words).`,
);

/** The misses of each bundle, in the order they are bought. A request never spans two. */
const PENDING = new Map<string, UnitOfLeaf[]>(
  [...BUNDLES].map(([bundle, group]) => [bundle, group.filter((unit) => !done.has(unit.hash))]),
);

const quote = await quoteByBundle();
if (quote === null) {
  console.error(`translate-ui: could not read ${MODEL}'s rate. An unpriced run is an unbounded one.`);
  process.exit(1);
}
if (quote.requests > 0) {
  console.log(
    `translate-ui: ${quote.requests} requests, ~${quote.promptTokens} prompt tokens, ` +
      `~${quote.completionTokens} completion tokens, estimated ${quote.cost.toFixed(4)} USD.`,
  );
} else {
  console.log('translate-ui: nothing to translate, 0.0000 USD.');
}
console.log(
  `translate-ui: glossary: ${SCREENS.named} of ${SCREENS.of} screen names from ${LOCALE}/${SCREEN_NAMESPACE}.json, ` +
    'outside the quote above. It rides in the notes, and `price` reads only the system prompt.',
);

if (DRY) {
  for (const unit of misses.slice(0, 20)) console.log(`  miss  ${unit.key}  ${unit.source.slice(0, 80)}`);
  if (misses.length > 20) console.log(`  ... and ${misses.length - 20} more`);
  reportScreens();
  console.log('translate-ui: dry run, nothing was sent and nothing was written.');
  process.exit(0);
}

const total: Usage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
let refused = false;

if (misses.length > 0) {
  // EVERY REFUSAL COMES BEFORE THE FIRST REQUEST, not at the write and not between two bundles.
  // Reaching one later means the run already paid for strings it is about to throw away.
  if (!WRITABLE) {
    console.error('translate-ui: there is work to buy, but the memory is not writable here.');
    console.error('  The memory has one writer, and it is CI. Pass --local to override.');
    process.exit(1);
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (key === undefined || key === '') {
    console.error('translate-ui: OPENROUTER_API_KEY is not set.');
    process.exit(1);
  }
  if (quote.cost > BUDGET) {
    console.error(
      `translate-ui: ${quote.cost.toFixed(4)} USD is over the ${BUDGET.toFixed(2)} USD budget. Nothing was sent.`,
    );
    console.error(`  Re-run with --budget ${(Math.ceil(quote.cost * 100) / 100).toFixed(2)} to approve it.`);
    process.exit(OVER_BUDGET);
  }

  mkdirSync(OUT, { recursive: true });
  let before = total.cost;
  const outcome = await buyByBundle(PENDING, {
    locale: LOCALE,
    key,
    done,
    total,
    notes: [...NOTES, ...SCREENS.lines],
    afterChunk: ({ bundle, at, of, batch }) => {
      console.log(
        `  ${LOCALE} ${bundle} ${at}/${of} (${batch.length} strings) ... ${(total.cost - before).toFixed(6)} USD  ` +
          `(running ${total.cost.toFixed(4)} USD)`,
      );
      before = total.cost;
      // WRITTEN AFTER EVERY CHUNK. A stall or a Ctrl-C must not throw away the strings already bought.
      save();
      // THE SECOND CEILING, against money actually spent rather than money predicted.
      if (total.cost <= BUDGET) return 'continue';
      console.error(
        `translate-ui: spent ${total.cost.toFixed(4)} USD against a ${BUDGET.toFixed(2)} USD budget. ` +
          `Stopping. What was bought is saved.`,
      );
      return 'stop';
    },
  });
  refused = outcome === 'stopped';
  console.log(
    `translate-ui: ${total.prompt_tokens} prompt tokens, ${total.completion_tokens} completion tokens, ` +
      `${total.cost.toFixed(4)} USD total.`,
  );
}

save();
write();

reportScreens();

// THE DASH PASS, over the whole memory and not only over what was bought: a hand-written bundle
// adopted with one in it, a hand edit, a model swap. It names the hash, because the hash is what
// you delete from the file to buy the string again.
const offenders = dashOffenders(memory, LOCALE);
if (offenders.length > 0) {
  console.error(`translate-ui: ${offenders.length} translations carry a banned dash. Delete these hashes and re-run:`);
  for (const key of offenders) console.error(`  ${key}  ${memory[key]?.[LOCALE]?.slice(0, 90) ?? ''}`);
  process.exit(1);
}

const covered = [...units.keys()].filter((key) => done.has(key)).length;
console.log(
  `translate-ui: ${LOCALE}, ${covered}/${units.size} strings translated` +
    `${units.size - covered > 0 ? `, ${units.size - covered} still English` : ''}.`,
);

if (refused) process.exit(OVER_BUDGET);

/**
 * What the run would cost, bundle by bundle, because that is how it is bought: `price` counts
 * requests over the list it is given, and one list over both bundles would count one request
 * where two are sent. `null` from any bundle is `null` for the run, the same refusal to spend
 * unpriced.
 */
async function quoteByBundle(): Promise<Quote | null> {
  const sum = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
  for (const pending of PENDING.values()) {
    const part = await price(pending);
    if (part === null) return null;
    sum.requests += part.requests;
    sum.promptTokens += part.promptTokens;
    sum.completionTokens += part.completionTokens;
    sum.cost += part.cost;
  }
  return sum;
}

/**
 * The catalogs as they stand today, recorded as the answer to today's English and stamped
 * `hand-written`. Only keys the memory has no entry for are adopted, so running it twice does
 * nothing, and a key the memory already answers keeps the answer it already has. Every path is
 * its own entry, so a hand-written catalog cannot disagree with itself here; the website's
 * version of this has to report splits, and the module note in `translate-bundles.ts` says why
 * this one does not.
 */
function adopt(): void {
  const today = new Date().toISOString().slice(0, 10);
  let taken = 0;
  for (const namespace of NAMESPACES) {
    const english = ENGLISH.get(namespace);
    const target = TARGET.get(namespace);
    if (english === undefined || target === undefined) continue;
    const held = new Map(leaves(target).map((leaf) => [leaf.key, leaf.value]));
    for (const unit of collectByPath(namespace, english)) {
      if (memory[unit.hash] !== undefined) continue;
      const value = held.get(unit.leaf);
      if (value === undefined || value === '') continue;
      memory[unit.hash] = memoAt({ unit, target: value, locale: LOCALE, at: today, model: 'hand-written' });
      taken += 1;
    }
  }
  console.log(`translate-ui: adopted ${taken} hand-written strings into the ${LOCALE} memory.`);
  mkdirSync(OUT, { recursive: true });
  if (saveMemory(FILE, memory, WRITABLE) !== 'refused') return;
  console.error('translate-ui: refusing to write the memory outside CI. Pass --local to override.');
  process.exit(1);
}

/** The memory as it stands: what was on disk, plus what this run bought. */
function save(): void {
  const today = new Date().toISOString().slice(0, 10);
  for (const unit of units.values()) {
    const target = done.get(unit.hash);
    if (target === undefined || memory[unit.hash] !== undefined) continue;
    memory[unit.hash] = memoAt({ unit, target, locale: LOCALE, at: today });
  }
  mkdirSync(OUT, { recursive: true });
  if (saveMemory(FILE, memory, WRITABLE) !== 'refused') return;
  console.error('translate-ui: refusing to write the memory outside CI. Pass --local to override.');
  process.exit(1);
}

/**
 * The target catalogs, rebuilt from the English tree and the memory. Runs even when nothing was
 * bought: it is what carries a key ADDED to the English catalog into the German one, so the parity
 * test has a value to check rather than a missing key nobody notices.
 */
function write(): void {
  for (const namespace of NAMESPACES) {
    const english = ENGLISH.get(namespace);
    const target = TARGET.get(namespace);
    if (english === undefined || target === undefined) continue;
    const file = catalogPath(ROOT, LOCALE, namespace);
    const state = saveCatalog(file, rebuildByPath(namespace, english, done, target), WRITABLE);
    console.log(`translate-ui: ${LOCALE}/${namespace}.json ${state}.`);
    if (state !== 'refused') continue;
    console.error('translate-ui: refusing to write the catalogs outside CI. Pass --local to override.');
    process.exit(1);
  }
}

/**
 * Which remembered release leads name a screen and answer it with another word.
 *
 * A REPORT AND NEVER AN EXIT CODE, the same bargain the library's `glossaryOffenders` strikes and
 * the opposite of the dash pass above: a dash is a character, a screen name is a word in a
 * sentence, and a good translation is allowed to leave the noun out. It runs on every run,
 * including one with nothing to buy, because that is the run a release does after the last locale
 * is bought. The hash is what you delete from the memory to buy that one lead again.
 */
function reportScreens(): void {
  const missed = screenOffenders({
    memory,
    locale: LOCALE,
    english: SCREEN_ENGLISH,
    target: SCREEN_TARGET,
  });
  if (missed.length === 0) {
    console.log(`translate-ui: ${LOCALE}, no remembered ${RELEASE_NAMESPACE} lead misses a screen name.`);
    return;
  }
  console.log(
    `translate-ui: ${missed.length} remembered ${RELEASE_NAMESPACE} leads name a screen the ${LOCALE} catalog ` +
      'names otherwise. A report, not a failure. Delete a hash from the memory to buy that lead again.',
  );
  for (const offender of missed) {
    console.log(`  ${offender.hash}  ${offender.path}  ${offender.screen} -> ${offender.expected.join(' or ')}`);
    console.log(`      en  ${offender.en}`);
    console.log(`      ${LOCALE}  ${offender.say}`);
  }
}

/**
 * One namespace's catalog, or the end of the run.
 *
 * A NAMED FUNCTION rather than a guard beside the constants, because `reportScreens` below is a
 * hoisted declaration and TypeScript will not carry a narrowing from the module body into it.
 */
function catalogOrExit(ask: { trees: Map<string, CatalogTree>; namespace: string; locale: string }): CatalogTree {
  const tree = ask.trees.get(ask.namespace);
  if (tree !== undefined) return tree;
  console.error(`translate-ui: there is no ${ask.namespace} catalog for ${ask.locale}, so no screen can be named.`);
  process.exit(1);
}
