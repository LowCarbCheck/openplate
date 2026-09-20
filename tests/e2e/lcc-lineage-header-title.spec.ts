/**
 * The header page title, measured against the face it replaced (M243 spec 02).
 *
 * WHY MEASURE. The header title is `truncate`: a title wider than its slot loses its tail to an
 * ellipsis, and nothing else in the app notices. Victor Mono is a flat 0.6 em per character and
 * Inter is proportional, so the same German title is wider in Victor Mono at the same size. The
 * slot is about 170 px, and one title already truncated in Inter. A face swap with no size
 * change therefore truncates more titles, earlier, on every phone, and passes every other test.
 *
 * THE RULE, IN ONE SENTENCE. No route title in German or Turkish is clipped harder than it was
 * clipped in Inter at the size Inter was set at (18 px). The baseline is measured in the same
 * page, at runtime, by forcing the Inter stack onto the same header element, so the comparison
 * survives a change of slot width, a new title or a new language string. Every route title is
 * read out of the shipped bundle through the route's own `handle.titleKey`, so a new route is
 * covered the day it exists.
 *
 * ── THE MEASURED TABLE (2026-09-20, production build, headless Chromium) ──
 * `clip` is `scrollWidth - clientWidth` of the header `h1` with the title in it. Each cell is
 * "titles clipped harder than Inter at 18 px, and by how many px at worst". The other four
 * languages were measured too and are in the report that came with this spec; only German and
 * Turkish are held here, as asked.
 *
 *                 390 px phone                    360 px phone
 *   size      German        Turkish          German         Turkish
 *   18 px     3, +11.0      0                4, +44.0       1, +13.0
 *   17 px     0             0                3, +19.0       0
 *   16 px     0             0                3, +20.0       0
 *   15 px     0             0                0              0        <- chosen
 *   14 px     0             0                0              0
 *
 * 15 px is the largest size at which nothing clips harder at either width. 16 and 17 pass at
 * 390 px and fail for German at 360 px, which is the narrowest screen this app promises to fit.
 * Headless Chromium on Linux rounds glyph advances to whole pixels at these sizes (16 px and
 * 17 px measure the same, so do 13 px and 14 px), so the table steps in pairs. A phone that
 * positions glyphs at fractions of a pixel measures a little narrower than this, never wider.
 *
 * ── SPEC 08 MOVED THE SIZE TO 14 PX ──
 * The table above is spec 02's record and is left as it was measured, for German and Turkish. The
 * clip sweep (`lcc-lineage-clip-sweep.spec.ts`, M243 spec 08) reads all six languages, and at 15 px
 * it found Italian and French titles clipped harder than Inter at 360 px: "Il tuo riepilogo
 * giornaliero" clipped 12 px where Inter clipped 0, and "Contributions à la recherche" 12 px where
 * Inter clipped 4. 14 px is a row of the table that already passed for German and Turkish, and it is
 * the floor in `tests/design-contract.ts`, so `HEADER_TITLE_PX` now reads 14.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ──
 * The comparison is also run at the old 18 px size, in the new face, and MUST find a title that
 * clips harder than Inter did. A comparison that answered "fine" at every size would pass the
 * walk and prove nothing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import type { LanguageCode } from '../../app/i18n/language-prefs';
import {
  HEADER_TITLE_FLOOR_PX,
  HEADER_TITLE_INTER_BASELINE_PX,
  HEADER_TITLE_PX,
  INTER,
} from '../design-contract';
import { completeOnboarding, useLanguage } from './helpers';

/** The two languages held here. German is the widest of the six, Turkish the second. */
const LOCALES = ['de', 'tr'] as const satisfies readonly LanguageCode[];

/** The two phone widths. 360 px is the narrowest screen the app promises to fit. */
const WIDTHS = [390, 360] as const;

/** A sub-pixel of layout rounding is not a clip. */
const CLIP_TOLERANCE_PX = 0.5;

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
 * The `titleKey` of every route's `handle`, read from the route modules.
 *
 * @returns each key once, sorted.
 */
function routeTitleKeys(): string[] {
  const directory = resolve(process.cwd(), 'app/routes');
  const keys = new Set<string>();
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.tsx'))) {
    const source = readFileSync(resolve(directory, name), 'utf8');
    for (const block of source.matchAll(/export const handle[^=]*=\s*\{([^}]*)\}/g)) {
      const key = /titleKey:\s*'([^']+)'/.exec(block[1]);
      if (key !== null) keys.add(key[1]);
    }
  }
  return [...keys].toSorted();
}

/**
 * Every route title in one language, from the shipped bundle.
 *
 * @param locale - a shipped language code.
 * @returns the titles that resolve to a string.
 */
function routeTitlesFor(locale: LanguageCode): string[] {
  const tree = jsonSchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), `app/i18n/locales/${locale}/common.json`), 'utf8')),
  );
  return routeTitleKeys()
    .map((key) => stringAt(tree, key))
    .filter((title): title is string => title !== null);
}

/** How hard each title clips: in the app's own face, in the old size of that face, and in Inter. */
interface ClipReading {
  title: string;
  /** Clipped px in the header as it is built now. */
  actual: number;
  /** Clipped px in the new face at the OLD size, the control. */
  atOldSize: number;
  /** Clipped px in Inter at its old size, the baseline. */
  inter: number;
}

/**
 * Measures every title in the real header `h1`, three ways.
 *
 * The title is written into the header's own element, so the slot width, the tracking, the
 * weight and `truncate` are the real ones. The Inter baseline and the old-size control are
 * written as inline styles on that same element and removed afterwards.
 *
 * @param page - a page on a route with the app header.
 * @param titles - the strings to measure.
 * @returns one reading per title.
 */
async function measureClips(page: Page, titles: readonly string[]): Promise<ClipReading[]> {
  return page.evaluate(
    ({ list, interFamily, baseline }) => {
      const heading = document.querySelector('header h1');
      if (!(heading instanceof HTMLElement)) throw new Error('the page has no header h1');
      const original = heading.textContent;
      const readings = list.map((title) => {
        heading.textContent = title;
        const actual = Math.max(0, heading.scrollWidth - heading.clientWidth);

        heading.style.fontSize = `${baseline}px`;
        const atOldSize = Math.max(0, heading.scrollWidth - heading.clientWidth);

        heading.style.fontFamily = `"${interFamily}", sans-serif`;
        const inter = Math.max(0, heading.scrollWidth - heading.clientWidth);

        heading.style.fontFamily = '';
        heading.style.fontSize = '';
        return { title, actual, atOldSize, inter };
      });
      heading.textContent = original;
      return readings;
    },
    { list: [...titles], interFamily: INTER, baseline: HEADER_TITLE_INTER_BASELINE_PX },
  );
}

test('no German or Turkish route title clips harder than it did in Inter, at 390 and 360', async ({ page }) => {
  await completeOnboarding(page);

  let controlFoundAWorseTitle = false;
  let titlesMeasured = 0;

  for (const locale of LOCALES) {
    await useLanguage(page, locale);
    const titles = routeTitlesFor(locale);
    expect(titles.length, `${locale}: the route handles must yield titles`).toBeGreaterThan(20);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/diary');
      await expect(page.locator('header h1').first()).toBeVisible();
      const where = `${locale} at ${width}px`;

      // The header's own promises, so the measurement is of the real thing.
      const style = await page
        .locator('header h1')
        .first()
        .evaluate((element) => ({
          size: Number.parseFloat(getComputedStyle(element).fontSize),
          overflow: getComputedStyle(element).textOverflow,
        }));
      expect(style.overflow, `${where}: the header title must still truncate with an ellipsis`).toBe('ellipsis');
      expect(style.size, `${where}: the header title size is the contract size`).toBe(HEADER_TITLE_PX);
      expect(style.size, `${where}: the header title may not be shrunk below the floor`).toBeGreaterThanOrEqual(
        HEADER_TITLE_FLOOR_PX,
      );

      const readings = await measureClips(page, titles);
      titlesMeasured += readings.length;

      // THE CLAIM.
      const worse = readings
        .filter((reading) => reading.actual > reading.inter + CLIP_TOLERANCE_PX)
        .map((reading) => `"${reading.title}" clips ${reading.actual}px, Inter clipped ${reading.inter}px`);
      expect(worse, `${where}: these titles clip harder than they did in Inter`).toEqual([]);

      if (readings.some((reading) => reading.atOldSize > reading.inter + CLIP_TOLERANCE_PX)) {
        controlFoundAWorseTitle = true;
      }
    }
  }

  // CONTROL: the same comparison, at the old 18 px size in the new face, found a title that
  // clips harder than Inter. Without this the claim above could pass at every size.
  expect(titlesMeasured, 'the walk must have measured titles').toBeGreaterThan(0);
  expect(
    controlFoundAWorseTitle,
    'at 18px in the new face some title must clip harder than Inter, or the comparison cannot fail',
  ).toBe(true);
});
