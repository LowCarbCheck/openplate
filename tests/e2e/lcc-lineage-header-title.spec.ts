/**
 * Every header page title fits the 18 px slot, in all six languages, at 360 and 390 px.
 *
 * THE DECISION (operator, 2026-09-22, after a playground comparison). The phone header title is
 * 18 px, weight 600, and the size is fixed (`HEADER_TITLE_PX`). It had been 14 px since M243 spec
 * 08, chosen as the largest size at which no title clipped harder in Victor Mono than it had in
 * Inter at 18 px. That comparison is gone: there is no Inter baseline to be measured against any
 * more. FITTING IS NOW A REQUIREMENT ON THE STRINGS. A title that does not fit is a defect in its
 * locale file, fixed by a shorter string, never by a smaller size, a clamp or a shrink to fit.
 *
 * WHAT IS MEASURED. Every title key a route under the personal layout declares in its `handle`,
 * plus the two titles the layout's error boundary puts in the same slot, is read out of each
 * shipped `common.json` and written into the REAL header `h1`, so the slot width, the tracking,
 * the weight and `truncate` are the ones a person gets. A title fits when its `scrollWidth` is no
 * larger than its `clientWidth`. No tolerance: the rule is the operator's, and a sub-pixel of
 * overflow is still an ellipsis. The computed size is read beside every title, so a size change
 * that made titles fit would fail here instead of passing.
 *
 * THE LIST OF TITLES THAT DO NOT FIT YET lives in `header-title-fit.ts`, and it only shrinks: a
 * title that overflows and is not listed fails, and a listed title that now fits fails too, so the
 * entry is deleted in the change that shortens the string.
 *
 * THE REPORT. Each language writes `test-results/header-title-fit/<locale>.json`: every title, its
 * overflow in px at both widths, the slot width, and how many characters the slot holds at 18 px,
 * found by growing a string one character at a time in the same element. That is the number a
 * translator needs.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ──
 * The control test sends a string that cannot fit through the same reader and the same
 * partition and requires it to come back unexplained, hands the partition an entry for a title
 * that fits and requires it to come back stale, and forces the title to 14 px and requires the
 * size read to see it.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import type { LanguageCode } from '../../app/i18n/language-prefs';
import { HEADER_TITLE_FIT_WIDTHS_PX, HEADER_TITLE_PX } from '../design-contract';
import { completeOnboarding, useLanguage } from './helpers';
import { KNOWN_TITLE_OVERFLOWS, partitionKnownOverflows, type KnownTitleOverflow } from './header-title-fit';

/** All six shipped languages. */
const LOCALES = ['de', 'tr', 'en', 'es', 'fr', 'it'] as const satisfies readonly LanguageCode[];

/** The app header's title, and only that one: `header` is also an element inside pages. */
const HEADER_TITLE = 'header.sticky h1';

/**
 * The titles the personal layout's error boundary writes into the same slot. They are not in any
 * route's `handle`, and a person meets them on a bad link.
 */
const ERROR_TITLE_KEYS = ['errors.title', 'errors.notFoundTitle'] as const;

/** Where each language's measurements go. */
const REPORT_DIR = resolve(process.cwd(), 'test-results/header-title-fit');

/** A string long enough that no phone slot can hold it at 18 px: 60 characters is about 620 px. */
const CONTROL_TITLE = 'W'.repeat(60);

/** The size the control forces the title to, the size it had before 2026-09-22. */
const CONTROL_SIZE_PX = 14;

/** A JSON value, so a catalog can be walked without a cast. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Any JSON document, parsed recursively so the walk below never asserts a type. */
const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonSchema), z.record(z.string(), jsonSchema)]),
);

/** A JSON object, for descending one dotted-path segment at a time. */
const jsonObjectSchema = z.record(z.string(), jsonSchema);

/**
 * The string at a dotted path in a catalog, or null.
 *
 * @param tree - the parsed catalog.
 * @param path - a dotted key such as `settings.fasting.title`.
 * @returns the string there, or null when any segment is missing or the leaf is not a string.
 */
function stringAt(tree: Json, path: string): string | null {
  let current: Json = tree;
  for (const part of path.split('.')) {
    const parsed = jsonObjectSchema.safeParse(current);
    if (!parsed.success) return null;
    const next = parsed.data[part];
    if (next === undefined) return null;
    current = next;
  }
  return z.string().safeParse(current).data ?? null;
}

/**
 * The route modules the personal layout renders, which are the ones whose title reaches the
 * app header. Read from `app/routes.ts`, so a new route is covered the day it is registered.
 *
 * @returns module file names such as `settings.research.tsx`.
 */
function personalRouteFiles(): Set<string> {
  const tree = readFileSync(resolve(process.cwd(), 'app/routes.ts'), 'utf8');
  const start = tree.indexOf("layout('routes/_personal.tsx'");
  if (start === -1) throw new Error('app/routes.ts has no personal layout, so no title reaches the header');
  const files = new Set<string>();
  for (const match of tree.slice(start).matchAll(/'routes\/([^'/]+\.tsx)'/g)) {
    if (match[1] !== '_personal.tsx') files.add(match[1]);
  }
  return files;
}

/**
 * Every title key that can land in the header, with the modules that declare it.
 *
 * @returns title key to module file names, sorted by key.
 */
function headerTitleKeys(): Map<string, string[]> {
  const directory = resolve(process.cwd(), 'app/routes');
  const personal = personalRouteFiles();
  const keys = new Map<string, string[]>();
  for (const name of readdirSync(directory).filter((file) => personal.has(file))) {
    const source = readFileSync(resolve(directory, name), 'utf8');
    for (const block of source.matchAll(/export const handle[^=]*=\s*\{([^}]*)\}/g)) {
      const key = /titleKey:\s*'([^']+)'/.exec(block[1]);
      if (key !== null) keys.set(key[1], [...(keys.get(key[1]) ?? []), name]);
    }
  }
  for (const key of ERROR_TITLE_KEYS) keys.set(key, ['_personal.tsx (ErrorBoundary)']);
  return new Map([...keys].toSorted(([a], [b]) => a.localeCompare(b)));
}

/** One title, as a language ships it. */
interface HeaderTitle {
  titleKey: string;
  title: string;
  modules: string[];
}

/**
 * Every header title in one language, from the shipped catalog.
 *
 * @param locale - a shipped language code.
 * @returns each key with its string. A key the catalog does not hold fails the run.
 */
function headerTitlesFor(locale: LanguageCode): HeaderTitle[] {
  const tree = jsonSchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), `app/i18n/locales/${locale}/common.json`), 'utf8')),
  );
  const titles: HeaderTitle[] = [];
  for (const [titleKey, modules] of headerTitleKeys()) {
    const title = stringAt(tree, titleKey);
    if (title === null) throw new Error(`${locale}/common.json has no string at ${titleKey}`);
    titles.push({ titleKey, title, modules });
  }
  return titles;
}

/** One title, measured in the real header. */
interface TitleReading {
  titleKey: string;
  title: string;
  scrollWidth: number;
  clientWidth: number;
  /** `scrollWidth - clientWidth`, never negative. Any value above zero is a title that does not fit. */
  overflow: number;
  /** The computed font size, in px, with this title in the element. */
  fontSize: number;
}

/** One title at one width, as it goes in the report file. */
interface ReportedTitle extends TitleReading {
  width: number;
  /** The route modules that declare the title. */
  modules: string[];
}

/** What one width says about the slot itself. */
interface SlotReading {
  /** The `h1`'s own `clientWidth`, the room a title has. */
  slotWidth: number;
  /** The most characters of `x` the slot holds without overflowing, grown one at a time. */
  maxChars: number;
}

/**
 * Writes each title into the real header `h1` and reads whether it fits.
 *
 * @param page - a page on a route with the app header.
 * @param titles - the titles to measure.
 * @returns one reading per title, in the order given.
 */
async function measureTitles(page: Page, titles: readonly { titleKey: string; title: string }[]): Promise<TitleReading[]> {
  return page.evaluate(
    ({ list, selector }) => {
      const heading = document.querySelector(selector);
      if (!(heading instanceof HTMLElement)) throw new Error('the page has no app header h1');
      const original = heading.textContent;
      const readings = list.map(({ titleKey, title }) => {
        heading.textContent = title;
        return {
          titleKey,
          title,
          scrollWidth: heading.scrollWidth,
          clientWidth: heading.clientWidth,
          overflow: Math.max(0, heading.scrollWidth - heading.clientWidth),
          fontSize: Number.parseFloat(getComputedStyle(heading).fontSize),
        };
      });
      heading.textContent = original;
      return readings;
    },
    { list: [...titles], selector: HEADER_TITLE },
  );
}

/**
 * Reads the slot's width and how many characters it holds, in the real `h1`.
 *
 * @param page - a page on a route with the app header.
 * @returns the slot's width and its character budget.
 */
async function measureSlot(page: Page): Promise<SlotReading> {
  return page.evaluate((selector) => {
    const heading = document.querySelector(selector);
    if (!(heading instanceof HTMLElement)) throw new Error('the page has no app header h1');
    const original = heading.textContent;
    let maxChars = 0;
    for (let count = 1; count <= 200; count += 1) {
      heading.textContent = 'x'.repeat(count);
      if (heading.scrollWidth > heading.clientWidth) break;
      maxChars = count;
    }
    const slotWidth = heading.clientWidth;
    heading.textContent = original;
    return { slotWidth, maxChars };
  }, HEADER_TITLE);
}

/**
 * The titles that do not fit.
 *
 * @param readings - the output of {@link measureTitles}.
 * @returns the readings whose `scrollWidth` exceeds their `clientWidth`.
 */
function overflowsOf(readings: readonly TitleReading[]): TitleReading[] {
  return readings.filter((reading) => reading.scrollWidth > reading.clientWidth);
}

/**
 * Matches a measured overflow to a list entry for one width.
 *
 * @param options.locale - the language measured.
 * @param options.width - the width measured.
 * @returns a matcher for {@link partitionKnownOverflows}.
 */
function matcherFor({ locale, width }: { locale: LanguageCode; width: number }) {
  return (reading: TitleReading, entry: KnownTitleOverflow): boolean =>
    entry.locale === locale && entry.titleKey === reading.titleKey && entry.viewports.some((port) => port === width);
}

/**
 * The list entries one width of one language can observe.
 *
 * @param options.locale - the language measured.
 * @param options.width - the width measured.
 * @returns the entries this read must find overflowing.
 */
function knownFor({ locale, width }: { locale: LanguageCode; width: number }): KnownTitleOverflow[] {
  return KNOWN_TITLE_OVERFLOWS.filter(
    (entry) => entry.locale === locale && entry.viewports.some((port) => port === width),
  );
}

/**
 * Puts the phone at a width on the diary, with the header title up and no status in its place.
 *
 * @param page - a page past onboarding.
 * @param width - the phone width.
 */
async function openHeaderAt(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/diary');
  await expect(page.locator(HEADER_TITLE), 'the header title is up').toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

test('the list names only shipped languages, fit widths and real title keys', () => {
  const keys = headerTitleKeys();
  expect(keys.size, 'the route handles must yield titles').toBeGreaterThan(20);
  for (const entry of KNOWN_TITLE_OVERFLOWS) {
    const where = `${entry.locale} ${entry.titleKey}`;
    expect(LOCALES, `${where}: a listed title must be in a shipped language`).toContain(entry.locale);
    expect(keys.has(entry.titleKey), `${where}: a listed title must be a key the header draws`).toBe(true);
    expect(entry.viewports.length, `${where}: a listed title must name a width`).toBeGreaterThan(0);
    expect(entry.routes.length, `${where}: a listed title must name the routes that draw it`).toBeGreaterThan(0);
  }
});

for (const locale of LOCALES) {
  test(`every ${locale} header title fits at 18 px, at ${HEADER_TITLE_FIT_WIDTHS_PX.join(' and ')} px`, async ({
    page,
  }) => {
    await completeOnboarding(page);
    await useLanguage(page, locale);
    const titles = headerTitlesFor(locale);

    const report: ReportedTitle[] = [];
    const slots: Record<number, SlotReading> = {};
    const problems: string[] = [];
    const stale: string[] = [];

    for (const width of HEADER_TITLE_FIT_WIDTHS_PX) {
      await openHeaderAt(page, width);
      const where = `${locale} at ${width}px`;
      slots[width] = await measureSlot(page);
      const readings = await measureTitles(page, titles);
      expect(readings.length, `${where}: every title must have been measured`).toBe(titles.length);

      // THE SIZE. Read beside every title, so a size change that made a title fit fails here.
      const offSize = readings.filter((reading) => reading.fontSize !== HEADER_TITLE_PX);
      expect(
        offSize.map((reading) => `"${reading.title}" is drawn at ${reading.fontSize}px`),
        `${where}: the header title size is fixed at ${HEADER_TITLE_PX}px`,
      ).toEqual([]);

      // THE FIT, against the list of strings still waiting to be shortened.
      const partition = partitionKnownOverflows({
        found: overflowsOf(readings),
        known: knownFor({ locale, width }),
        isMatch: matcherFor({ locale, width }),
      });
      for (const reading of partition.unexplained) {
        problems.push(
          `${where}: "${reading.title}" (${reading.titleKey}) overflows ${reading.overflow}px; ` +
            `the slot holds ${slots[width]?.maxChars} characters and the title has ${[...reading.title].length}`,
        );
      }
      for (const entry of partition.stale) {
        stale.push(`${where}: ${entry.titleKey} now fits, delete it from KNOWN_TITLE_OVERFLOWS`);
      }
      for (const reading of readings) {
        const modules = titles.find((title) => title.titleKey === reading.titleKey)?.modules ?? [];
        report.push({ width, ...reading, modules });
      }
    }

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(
      resolve(REPORT_DIR, `${locale}.json`),
      `${JSON.stringify({ locale, sizePx: HEADER_TITLE_PX, slots, readings: report }, null, 2)}\n`,
    );

    expect(problems, `${locale}: these header titles do not fit at ${HEADER_TITLE_PX}px; shorten the string`).toEqual(
      [],
    );
    expect(stale, `${locale}: these listed titles fit now`).toEqual([]);
  });
}

test('CONTROL: a title that cannot fit is caught, a listed title that fits is stale, and a smaller size is seen', async ({
  page,
}) => {
  await completeOnboarding(page);
  await useLanguage(page, 'en');
  await openHeaderAt(page, 360);

  const [longTitle, shortTitle] = await measureTitles(page, [
    { titleKey: 'control.long', title: CONTROL_TITLE },
    { titleKey: 'diary.title', title: 'Diary' },
  ]);
  expect(longTitle?.overflow ?? 0, 'the control string must overflow the slot').toBeGreaterThan(0);
  expect(shortTitle?.overflow ?? -1, 'and a five-letter title must not').toBe(0);

  const readings = [longTitle, shortTitle].filter((reading): reading is TitleReading => reading !== undefined);
  const isMatch = matcherFor({ locale: 'en', width: 360 });

  // An overflow nothing lists is unexplained, which is what fails a locale above.
  expect(
    partitionKnownOverflows({ found: overflowsOf(readings), known: [], isMatch }).unexplained.map((r) => r.titleKey),
    'CONTROL: an unlisted overflow must be unexplained',
  ).toEqual(['control.long']);

  // A listed entry for a title that fits comes back stale, which is what keeps the list shrinking.
  const fitsButListed: KnownTitleOverflow = { locale: 'en', titleKey: 'diary.title', routes: ['/diary'], viewports: [360] };
  expect(
    partitionKnownOverflows({ found: overflowsOf(readings), known: [fitsButListed], isMatch }).stale,
    'CONTROL: a listed title that fits must be stale',
  ).toEqual([fitsButListed]);

  // And a listed entry for the overflow explains it, so the list is able to hold a real finding.
  const listed: KnownTitleOverflow = { locale: 'en', titleKey: 'control.long', routes: ['/diary'], viewports: [360] };
  const withEntry = partitionKnownOverflows({ found: overflowsOf(readings), known: [listed], isMatch });
  expect(withEntry.unexplained, 'a listed overflow is explained').toEqual([]);
  expect(withEntry.stale, 'and is not stale while it still overflows').toEqual([]);

  // The size read sees a smaller title.
  await page.locator(HEADER_TITLE).evaluate((element, size) => {
    if (element instanceof HTMLElement) element.style.fontSize = `${size}px`;
  }, CONTROL_SIZE_PX);
  const [shrunk] = await measureTitles(page, [{ titleKey: 'diary.title', title: 'Diary' }]);
  expect(shrunk?.fontSize, 'CONTROL: the size read must see a title forced to 14px').toBe(CONTROL_SIZE_PX);
  expect(shrunk?.fontSize, 'and that is not the contract size').not.toBe(HEADER_TITLE_PX);
});
