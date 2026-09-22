/**
 * The brand word and the page title are two things, not one blur (2026-09-21).
 *
 * THE BUG, IN THE OPERATOR'S WORDS, against a diary screenshot: "the brand name is too close to
 * the page title". The phone header stacks the wordmark over the `h1` in one column, and that
 * column carried `gap-px`. Measured on the production build, that left 1.67 CSS pixels of white
 * between the bottom of the word's ink and the top of the title's, at 12 px over 14 px. At that
 * distance a reader cannot say at a glance which line is the product and which is the page they
 * are on, and the defect was on EVERY page that goes through `AppWrapper`, which is every page of
 * the personal layout.
 *
 * ── WHY INK AND NOT BOXES ──
 * The obvious reader is `h1.top - wordmark.bottom`, and it would be wrong in both directions. The
 * word is set `leading-none`, so the "p" of "openplate" hangs BELOW its own box and a box reader
 * overstates the white. The title is set `leading-tight`, so its box starts about 1.75 px above
 * the first capital and a box reader understates it. What a person sees is the distance between
 * the lowest ink of the word and the highest ink of the title, so that is what is measured: the
 * baseline of each line from a zero-size inline probe, and the ascent and descent of the real
 * strings from a canvas set to the face the page actually computed. No number below is a font
 * constant of this file. This is the same machinery `wordmark.spec.ts` uses to centre the word on
 * the mark, extended by one metric.
 *
 * ── THE CONTROL ──
 * The reader is then pointed at the old layout, by putting `row-gap: 1px` back on the column
 * inline, and it MUST report a gap under the minimum. A reader that answered "roomy" whatever it
 * was handed would pass this claim and guard nothing. The control runs on the same page, in the
 * same read, so it cannot pass by measuring a different element.
 *
 * ── TWO TITLE LENGTHS, TWO LANGUAGES ──
 * The header title is `truncate` and this repo has a history of clipping it
 * (`lcc-lineage-clip-sweep.spec.ts`). A vertical gap cannot clip a title, but a change to this
 * column could, so a short title and a long one are both read, in English and in German, and the
 * header's own fixed 64 px is re-read beside every one of them. German is where the operator saw
 * the defect and is where the titles are longest.
 */
import { expect, test, type Page } from '@playwright/test';

import { completeOnboarding, HEADER_HEIGHT, useLanguage } from './helpers';

/**
 * The least white, in CSS pixels, that may sit between the word's ink and the title's.
 *
 * WHERE IT COMES FROM. The column asks for 4 px (`gap-1`) above an 18 px title, the pair the
 * operator chose on 2026-09-22. Measured on the production build that lands at 5.21 px of ink gap
 * under "Diary", "Research contributions" and "Forschungsbeiträge", and 6.38 px under "Tagebuch",
 * because the title's box starts above its capitals. 4.5 leaves room for a browser that rounds
 * glyph metrics differently, and it is still more than twice the 1.67 px the defect measured, so
 * a partial revert (`gap-0.5` reads about 3.2 px) fails here rather than passing at a hair's width.
 * Until 2026-09-22 the column asked for 6 px over a 14 px title and this minimum was 5.
 */
const MIN_INK_GAP_PX = 4.5;

/** The row gap the column carried while the two lines read as one block. */
const OLD_GAP_CSS = '1px';

/** A route with a short title, and one whose title is long enough to test the slot. */
const ROUTES = ['/diary', '/settings/research'] as const;

/** English and German: German is where the defect was reported and where titles run longest. */
const LANGUAGES = ['en', 'de'] as const;

/** What one read of the header says about the two stacked lines. */
interface KickerRead {
  /** The page title as it was rendered, for the failure message. */
  title: string;
  /** White between the lowest ink of the word and the highest ink of the title, in CSS pixels. */
  inkGap: number;
  /** The header's own height, which this column may not change. */
  headerHeight: number;
}

/**
 * Reads the phone header's brand kicker and page title, optionally with the old gap forced back.
 *
 * @param page - a page on the production build, on a route inside the personal layout.
 * @param options.rowGap - a CSS length to force onto the column, for the control read. Left off,
 *   the column keeps whatever the app ships.
 * @returns the measurement.
 */
async function readKicker(page: Page, { rowGap }: { rowGap?: string } = {}): Promise<KickerRead> {
  return page.evaluate(async (forcedGap) => {
    const header = document.querySelector('header.sticky');
    if (header === null) throw new Error('no sticky header on this page');
    const word = header.querySelector('[data-slot="header-brand-kicker"]');
    const title = header.querySelector('h1');
    if (word === null || title === null) throw new Error('the header has no brand kicker or no h1');

    const column = title.parentElement;
    if (column === null) throw new Error('the title has no column');
    const previousGap = column.style.rowGap;
    if (forcedGap !== undefined) column.style.rowGap = forcedGap;

    await document.fonts.ready;

    // MEASURED AT 200 px AND SCALED DOWN, because a hinted face rounds its metrics at 12 px and
    // the two lines would round in different directions at their own sizes.
    const SAMPLE_PX = 200;
    const canvas = document.createElement('canvas').getContext('2d');
    if (canvas === null) throw new Error('no 2d canvas');

    // ONE LOOP over the two lines, and no helper functions: everything below runs inside
    // `page.evaluate`, so a helper cannot live at this module's top level, and a helper nested
    // here is what the repo's lint rules refuse.
    const edges: number[] = [];
    for (const line of [word, title]) {
      // The alphabetic baseline, from a zero-size inline probe: its box bottom SITS on the
      // baseline, whatever line height the element was given.
      const probe = document.createElement('i');
      probe.style.cssText = 'display:inline-block;width:0;height:0';
      line.append(probe);
      const baseline = probe.getBoundingClientRect().bottom;
      probe.remove();

      const style = getComputedStyle(line);
      canvas.font = `${style.fontWeight} ${SAMPLE_PX}px ${style.fontFamily}`;
      const metrics = canvas.measureText(line.textContent ?? '');
      const size = Number.parseFloat(style.fontSize);
      // The word contributes its lowest ink (the descender of its two "p"s), the title its
      // highest (the cap of its first letter), so each pushes one edge of the white between them.
      const reach = line === word ? metrics.actualBoundingBoxDescent : -metrics.actualBoundingBoxAscent;
      edges.push(baseline + (reach / SAMPLE_PX) * size);
    }

    const [wordInkBottom, titleInkTop] = edges;
    if (wordInkBottom === undefined || titleInkTop === undefined) throw new Error('a line went unread');
    const headerHeight = header.getBoundingClientRect().height;

    column.style.rowGap = previousGap;
    return { title: title.textContent ?? '', inkGap: titleInkTop - wordInkBottom, headerHeight };
  }, rowGap);
}

for (const language of LANGUAGES) {
  for (const route of ROUTES) {
    test(`the brand kicker stands clear of the page title on ${route} in ${language}`, async ({ page }) => {
      await completeOnboarding(page);
      await useLanguage(page, language);
      await page.goto(route);
      await expect(page.locator('header.sticky h1'), 'the header title is up').toBeVisible();
      await expect(page.locator('header.sticky [data-slot="header-brand-kicker"]')).toBeVisible();

      const shipped = await readKicker(page);
      expect(
        shipped.inkGap,
        `"${shipped.title}" sits ${shipped.inkGap.toFixed(2)} px under the brand word; a reader cannot ` +
          `tell a brand kicker from a page title at less than ${MIN_INK_GAP_PX} px`,
      ).toBeGreaterThanOrEqual(MIN_INK_GAP_PX);

      expect(shipped.headerHeight, 'the gap above may not change the header height').toBe(HEADER_HEIGHT);

      const control = await readKicker(page, { rowGap: OLD_GAP_CSS });
      expect(
        control.inkGap,
        `CONTROL: with the old \`gap-px\` forced back the reader must call "${control.title}" too close, ` +
          `and it reads ${control.inkGap.toFixed(2)} px`,
      ).toBeLessThan(MIN_INK_GAP_PX);
    });
  }
}
