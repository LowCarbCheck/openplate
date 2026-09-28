/**
 * translate-glossary, the app's own name for each of its screens, said to the translator.
 *
 * The vendored `GLOSSARY` in `scripts/lib/translate.ts` pins seven product terms and no screen, so
 * a release lead that names a screen was rendered however the model felt that day, and the 0.35.0
 * and 0.36.0 leads reached five languages calling screens things the app does not call them. The
 * app already answers that question, once per language, in
 * `app/i18n/locales/<locale>/common.json`. This module reads the answer at run time and hands it
 * to the request, and `scripts/translate-ui.ts` is its only caller.
 *
 * ── THE CATALOG IS THE ONE SOURCE OF THE NAMES ──
 * Nothing here types a screen name, in any language. `SCREENS` holds a catalog KEY and a short
 * phrase saying where that screen is; both names on a line come out of the two catalogs. A table
 * of names typed here would be a second copy of what the app defines, and the copy is what goes
 * stale. That is also why a tab names the screen it sits inside by reading that screen's own key
 * rather than repeating the word: rename `nav.trends` and every line follows.
 *
 * ── A MISSING ENGLISH KEY THROWS, A MISSING TARGET KEY IS SKIPPED ──
 * A key that is gone from `en/common.json` was renamed, and a renamed key must fail the run and
 * the test rather than quietly drop a screen from the glossary. A key that is gone from the target
 * is a locale that has not bought that string yet, which is ordinary, so it is skipped and
 * counted: the caller prints how many of the screens it could name.
 *
 * ── THE GLOSSARY IS OUTSIDE THE PRICE QUOTE ──
 * `price` estimates a request from the system prompt and never sees `notes`, and these lines ride
 * in the notes. Ten short lines is about 700 characters per request, cents over a whole run. The
 * vendored library is not edited to account for it; `translate-ui.ts` says so in its output.
 *
 * ── AND A REPORT, BECAUSE A RULE STATED IS NOT A RULE KEPT ──
 * `screenOffenders` is the ask side, in the shape of the library's own `glossaryOffenders`: every
 * remembered release lead whose English names a screen and whose target answers with some other
 * word, printed with the memory hash you delete to buy that lead again. It is a report and never a
 * gate, for the reason the library gives: a good translation is allowed to leave a noun out.
 */
import { type Memory } from './lib/translate-shims/docs-i18n.server';
import { type CatalogTree, leaves } from './lib/translate-ui';

/** The namespace the screen names live in. */
export const SCREEN_NAMESPACE = 'common';

/** The namespace the release leads live in, which is the only one the report reads. */
export const RELEASE_NAMESPACE = 'releases';

/** One screen a release lead can name, and where it is, so two screens with one English name stay apart. */
interface Screen {
  /** Its key in `common.json`. The catalogs hold the names; this file holds only the key. */
  key: string;
  /** Where the screen is, in the words the model reads. Never a name. */
  where: string;
  /** For a tab, the key of the screen it sits inside. Its English name completes `where`. */
  inside?: string;
}

/**
 * The screens the release notes name, tabs in the order the strip lists them
 * (`app/components/trends/insights-tab-strip.tsx`).
 */
const SCREENS: readonly Screen[] = [
  { key: 'nav.trends', where: 'the charts screen' },
  { key: 'dashboard.title', where: 'the home screen' },
  { key: 'about.title', where: 'the screen that describes the app' },
  { key: 'add.custom.title', where: 'the screen listing the foods you saved' },
  { key: 'nav.pantry', where: 'the screen listing what you keep at home' },
  { key: 'trends.tabs.overview', where: 'the first tab', inside: 'nav.trends' },
  { key: 'trends.tabs.nutrition', where: 'the second tab', inside: 'nav.trends' },
  { key: 'trends.tabs.meals', where: 'the third tab', inside: 'nav.trends' },
  { key: 'trends.tabs.goals', where: 'the fourth tab', inside: 'nav.trends' },
];

/** Every key the glossary names, in the order its lines are printed. */
export const SCREEN_KEYS: readonly string[] = SCREENS.map((screen) => screen.key);

/** The lines the translator is sent, and how much of the app they could name. */
export interface ScreenGlossary {
  /** What to append to the notes of a request. Empty when the target catalog names no screen at all. */
  lines: string[];
  /** How many screens the target catalog could name. */
  named: number;
  /** How many screens there are to name. */
  of: number;
}

/** One remembered release lead that names a screen and answers it with another word. */
export interface ScreenOffender {
  /** The memory key. Delete this entry from `app/i18n/memory/<locale>.json` to buy the lead again. */
  hash: string;
  /** The catalog path it was bought under, `releases:v0_36_0.fixed.13`. */
  path: string;
  /** The English name the lead used. */
  screen: string;
  /** Every target name that would have answered it. More than one when the English is ambiguous. */
  expected: string[];
  /** The English lead. */
  en: string;
  /** What the memory says in the target language. */
  say: string;
}

/**
 * The glossary for one locale, built from the two catalogs as they stand on disk.
 *
 * The line shape is the library's, `  <en> -> <target>`, with the screen it names appended so the
 * two Overview screens read as two instructions rather than one contradiction.
 */
export function screenGlossary(catalogs: { english: CatalogTree; target: CatalogTree }): ScreenGlossary {
  const english = namesOf(catalogs.english);
  const target = namesOf(catalogs.target);

  const lines: string[] = [];
  for (const screen of SCREENS) {
    const en = nameOf(english, screen.key);
    const say = target.get(screen.key);
    if (say === undefined || say === '') continue;
    lines.push(`  ${en} -> ${say} (${whereOf(screen, english)}, ${screen.key})`);
  }
  if (lines.length === 0) return { lines: [], named: 0, of: SCREENS.length };

  return {
    lines: [
      '',
      'The application gives each of its own screens one name per language. These are those names:',
      ...lines,
      'When a sentence names one of these screens, write exactly the name above, never a synonym.',
    ],
    named: lines.length,
    of: SCREENS.length,
  };
}

/**
 * Every remembered release lead that names a screen the target catalog names differently.
 *
 * ── THE AMBIGUITY RULE, WHICH IS WHY THIS GROUPS BY THE ENGLISH ──
 * `dashboard.title` and `trends.tabs.overview` are both "Overview" in English, and French gives
 * them two different words. Nothing in a lead says which screen it meant, so a lead is flagged
 * only when its target contains NONE of the target names that share that English name. A lead that
 * uses either French word is right as far as this report can tell, and a report that cried wolf on
 * half the French corpus would be read by nobody.
 */
export function screenOffenders(run: {
  memory: Memory;
  locale: string;
  english: CatalogTree;
  target: CatalogTree;
}): ScreenOffender[] {
  const english = namesOf(run.english);
  const target = namesOf(run.target);

  /** One English name, and every target name it stands for. An English name the target cannot answer is absent. */
  const groups = new Map<string, string[]>();
  for (const screen of SCREENS) {
    const en = nameOf(english, screen.key);
    const say = target.get(screen.key);
    if (say === undefined || say === '') continue;
    groups.set(en, [...(groups.get(en) ?? []), say]);
  }

  const prefix = `${RELEASE_NAMESPACE}:`;
  const out: ScreenOffender[] = [];
  for (const [hash, entry] of Object.entries(run.memory)) {
    const say = entry[run.locale];
    const path = entry.path;
    if (say === undefined || path === undefined || !path.startsWith(prefix)) continue;
    for (const [screen, expected] of groups) {
      if (!namesScreen(entry.en, screen)) continue;
      if (expected.some((name) => answersWith(say, name))) continue;
      out.push({ hash, path, screen, expected, en: entry.en, say });
    }
  }
  return out;
}

/** Every leaf of a catalog by its dotted key, which is how a screen is named here. */
function namesOf(tree: CatalogTree): Map<string, string> {
  return new Map(leaves(tree).map((leaf) => [leaf.key, leaf.value]));
}

function nameOf(names: Map<string, string>, key: string): string {
  const name = names.get(key);
  if (name === undefined || name === '') {
    throw new Error(
      `translate-glossary: ${key} is not in the English catalog. A screen key that was renamed is renamed here too, ` +
        'in SCREENS, or the glossary silently stops naming that screen.',
    );
  }
  return name;
}

function whereOf(screen: Screen, english: Map<string, string>): string {
  if (screen.inside === undefined) return screen.where;
  return `${screen.where} inside ${nameOf(english, screen.inside)}`;
}

/**
 * Does this English lead NAME the screen, rather than use the same word for the thing?
 *
 * CASE SENSITIVE, and that is the conservative half of the report. The catalog writes a screen
 * name capitalised, so "the Insights charts" names a screen and "your pantry now follows you too"
 * does not, and the second is a sentence the report must stay quiet about. A lead that opens with
 * the word is the one case this cannot tell apart, which costs one line to read; flagging every
 * lower-case noun would cost the report its readers.
 */
function namesScreen(source: string, name: string): boolean {
  return new RegExp(`\\b${forRegExp(name)}\\b`).test(source);
}

/**
 * Does the translation carry that name? Case-insensitive, as the library's own term check is,
 * because the target grammar inflects and capitalises for its own reasons. The apostrophe is
 * folded because a French name carries one, the catalog writes it as ' and a model may answer with
 * ’, and that answer is right.
 */
function answersWith(say: string, name: string): boolean {
  return flatten(say).includes(flatten(name));
}

function flatten(text: string): string {
  return text.toLowerCase().replaceAll('’', "'");
}

function forRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
