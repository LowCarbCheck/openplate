/**
 * Reading a page for clipped text, in the app's own face and in the face it replaced (M243 spec 08).
 *
 * WHAT THE PROBLEM IS. A page-level `scrollWidth` of 390 cannot see text that is clipped INSIDE a
 * `truncate` or `overflow-hidden` box: the box is 172 px wide, the text wants 209, the tail is
 * gone, and the document is still exactly as wide as the phone. Victor Mono is a flat 0.6 em per
 * character and Inter is proportional, so the same mixed-case German string is 13 to 31 percent
 * wider in the new face, and every one of the app's roughly 63 `truncate` sites gets worse
 * without any test noticing. Food names are user data, so no static list can name them all.
 *
 * WHAT THIS MODULE DOES. It reads every element that CAN clip (an ellipsis, `overflow: hidden`,
 * or one of the two labels the brief holds hard) and how many pixels of its content run past its
 * box, then reads the same page again with the Inter stack injected, and compares. The result is
 * a list of what the wider face changed, not a pass or a fail.
 *
 * THE BASELINE IS ONE CUSTOM PROPERTY, ON PURPOSE. `--font-body` is the role the `body` asks for
 * (`app/app.css`), so setting it back to the prose stack at `:root` puts the body in Inter exactly
 * as it was before M243 while `font-mono` elements stay mono and the wordmark stays serif, which
 * is what the old build did. It is injected at runtime with `page.addStyleTag`, so both reads
 * come from the SAME build and the SAME DOM: no second build, no second port, and no drift
 * between what the two reads measured.
 *
 * THE HEADER TITLE IS NOT JUDGED AGAINST INTER ANY MORE (operator, 2026-09-22). It is 18 px in
 * both reads, the size it had in Inter, and its claim is absolute: it fits its slot or it is a
 * defect in its string (`headerTitleOverflows`, and `header-title-fit.ts` for the titles still
 * waiting for a shorter string). Only the bottom bar's tab labels are still held against Inter.
 *
 * READING RULES, so a number means one thing:
 *
 * - `clip` is `scrollWidth - clientWidth`, never negative. `scrollWidth` is an integer, so a
 *   difference under one pixel is rounding and is not reported.
 * - Elements are joined across the two reads by their position in the DOM, not by an id the page
 *   would have to carry. A node present in only one read is not compared.
 * - A box a pixel or less on a side is `sr-only` and is skipped: it clips by design.
 * - Animations and transitions are stopped before the first read (`FREEZE_MOTION_CSS`), so the
 *   document width is the layout's and not the phase of a sliding progress bar.
 * - An `input`'s placeholder is measured too (its `scrollWidth` ignores it). A `textarea`'s is not:
 *   it wraps onto more lines instead of being cut.
 * - The document itself is one more reading, so a page that grew wider than the phone in mono and
 *   not in Inter is reported beside the elements.
 */
import type { Page } from '@playwright/test';
import { z } from 'zod';

import {
  BODY_STACK,
  HEADER_TITLE_PX,
  INTER,
  PROSE_STACK,
  VICTOR_MONO,
  familyStartsWith,
} from '../design-contract';

/** The app header's title, and only that one: `header` is also an element inside pages. */
export const APP_HEADER_TITLE = 'header.sticky h1';

/** The bottom bar. A label in it is the last `span` of a tab, holding text and nothing else. */
export const BOTTOM_BAR = '[data-slot="bottom-nav-shell"] nav';

/** The baseline stylesheet: the body role back to Inter, and nothing else. */
export const INTER_BASELINE_CSS = `:root { --font-body: ${PROSE_STACK} !important; }\n`;

/**
 * Stops every animation and transition, so a measurement is of the layout and not of a frame.
 *
 * WHY. The first six-locale run listed `/onboarding` as a page that grew wider than the phone in
 * Victor Mono and not in Inter, by 14 to 89 px. It was not the face: the indeterminate progress bar
 * (`animate-indeterminate`) slides a `w-1/3` block past the right edge, so the document is as wide
 * as wherever the bar happened to be when it was read. Both faces are read with motion stopped.
 * The `transition` half matters for the same reason in a control that sets a size and reads it back
 * (a button with `transition-all` reports the OLD size for 150 ms).
 */
export const FREEZE_MOTION_CSS = '*, *::before, *::after { animation: none !important; transition: none !important; }\n';

/** A difference smaller than this many pixels is integer rounding, not a clip. */
export const MIN_CLIP_DELTA_PX = 1;

/** The two labels the brief holds hard. */
export const clipRoleSchema = z.enum(['header-title', 'tab-label']);
export type ClipRole = z.infer<typeof clipRoleSchema>;

/** One element, measured in one face. */
export interface ClipReading {
  /** The element's place in the DOM, the key that joins the two reads. */
  path: string;
  /** A short name a person can find the element by. */
  selector: string;
  /** The landmark it sits in: `main`, `header`, `nav`, `aside`, `dialog` or `html`. */
  landmark: string;
  /** Its own text, first 80 characters. */
  text: string;
  role: ClipRole | null;
  scrollWidth: number;
  clientWidth: number;
  /** Pixels of content past the box: `max(0, scrollWidth - clientWidth)`. */
  clip: number;
  /** How many lines of text it drew. */
  lines: number;
}

/** Everything one read found on one page. */
export interface ClipRead {
  readings: ClipReading[];
  /**
   * How many app headers the page draws. The header rule needs exactly one, and NO fallback bar
   * over it: a live page that calls `resetStatusChannel` paints `[data-slot="status-fallback"]`
   * over the real header, and a measurement then reads the wrong row (design brief, risk 3). The
   * status host itself draws no element while it is idle, so the DOM sees the header and the bar,
   * which is the same fact.
   */
  appHeaders: number;
  /** How many fallback bars are painted. Zero on a healthy page. */
  fallbackBars: number;
}

/** How an element compares across the two faces. */
export const clipKindSchema = z.enum(['newly-clipped', 'clips-harder', 'wraps-more']);
export type ClipKind = z.infer<typeof clipKindSchema>;

/** One face's numbers for one element, as they go in the report. */
export const clipMeasureSchema = z.object({
  scrollWidth: z.number(),
  clientWidth: z.number(),
  clip: z.number(),
  lines: z.number(),
});
export type ClipMeasure = z.infer<typeof clipMeasureSchema>;

/** One element that the wider face changed for the worse. */
export const clipRowSchema = z.object({
  path: z.string(),
  selector: z.string(),
  landmark: z.string(),
  text: z.string(),
  role: clipRoleSchema.nullable(),
  kind: clipKindSchema,
  mono: clipMeasureSchema,
  inter: clipMeasureSchema,
  /** Pixels more clipped in mono than in Inter. */
  delta: z.number(),
});
export type ClipRow = z.infer<typeof clipRowSchema>;

/**
 * Reads every element that can clip, plus the two hard labels, plus the document.
 *
 * @param page - a page that is loaded and quiet.
 * @returns the readings and the status host count.
 */
export async function readClips(page: Page): Promise<ClipRead> {
  // THE CALLBACK BELOW IS SERIALISED INTO THE PAGE. It cannot see this module's scope, so a helper
  // that captures nothing from the callback still cannot be moved out of it, which is exactly what
  // `consistent-function-scoping` asks for.
  // oxlint-disable unicorn/consistent-function-scoping
  const read = await page.evaluate(
    ({ headerTitle, bottomBar }) => {
      const readings: ClipReading[] = [];

      const pathOf = (element: Element): string => {
        const parts: string[] = [];
        let current: Element | null = element;
        while (current !== null && current !== document.body) {
          const parent: Element | null = current.parentElement;
          const index = parent === null ? 0 : Array.prototype.indexOf.call(parent.children, current);
          parts.unshift(`${current.tagName.toLowerCase()}:${index}`);
          current = parent;
        }
        return parts.join('>');
      };

      const landmarkOf = (element: Element): string =>
        element.closest('main, header, nav, aside, dialog, [role="dialog"]')?.tagName.toLowerCase() ?? 'body';

      const nameOf = (element: Element): string => {
        const tag = element.tagName.toLowerCase();
        const slot = element.getAttribute('data-slot');
        const own = slot === null ? tag : `${tag}[data-slot="${slot}"]`;
        const hint = [...element.classList]
          .filter((token) => token === 'truncate' || token.startsWith('overflow-') || token.startsWith('line-clamp'))
          .join('.');
        const owner = element.parentElement?.closest('[data-slot]')?.getAttribute('data-slot') ?? null;
        return `${own}${hint === '' ? '' : `.${hint}`}${owner === null ? '' : ` in [data-slot="${owner}"]`}`;
      };

      const linesOf = (element: Element): number => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
      };

      const roleOf = (element: HTMLElement): ClipRole | null => {
        if (element.matches(headerTitle)) return 'header-title';
        const isLabelBox =
          element.tagName === 'SPAN' && element.childElementCount === 0 && (element.textContent ?? '').trim() !== '';
        return isLabelBox && element.closest(bottomBar) !== null ? 'tab-label' : null;
      };

      for (const element of document.body.querySelectorAll('*')) {
        if (!(element instanceof HTMLElement)) continue;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const box = element.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1) continue;

        const role = roleOf(element);
        const isEllipsis = style.textOverflow === 'ellipsis';
        const isHidden = style.overflowX === 'hidden' || style.overflowX === 'clip';
        if (role === null && !isEllipsis && !isHidden) continue;

        readings.push({
          path: pathOf(element),
          selector: nameOf(element),
          landmark: landmarkOf(element),
          text: (element.textContent ?? '').trim().replaceAll(/\s+/gu, ' ').slice(0, 80),
          role,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          clip: Math.max(0, element.scrollWidth - element.clientWidth),
          lines: linesOf(element),
        });
      }

      // A PLACEHOLDER IS TEXT THE BOX CLIPS TOO. An input's `scrollWidth` does not include its
      // placeholder, so the placeholder is measured in a hidden span set in the placeholder's own
      // font. A `textarea` is left out on purpose: its placeholder WRAPS onto more lines, it is
      // not cut.
      //
      // THE PSEUDO-ELEMENT'S FONT, NOT THE FIELD'S (M243 spec 05b). A page may set
      // `placeholder:text-sm` on a field whose value is drawn at 16 px, which is exactly how the
      // add screen's search hint was made to fit; read in the field's own size the reader called
      // that hint 32 px too wide when the browser was drawing it with 7 px to spare. It fails in
      // the other direction too: a placeholder styled LARGER than its field used to read as
      // fitting. `getComputedStyle(el, '::placeholder')` leaves the `font` SHORTHAND empty in
      // Chromium, so the longhands are read one by one and the field's own value stands in for
      // any the pseudo-element does not answer.
      for (const field of document.body.querySelectorAll('input[placeholder]')) {
        if (!(field instanceof HTMLInputElement)) continue;
        if (field.value !== '') continue;
        const box = field.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1) continue;
        const style = getComputedStyle(field);
        const hint = getComputedStyle(field, '::placeholder');
        const inherited = (property: 'fontSize' | 'fontFamily' | 'fontWeight' | 'fontStyle' | 'letterSpacing'): string =>
          hint[property] === '' ? style[property] : hint[property];
        const probe = document.createElement('span');
        probe.style.cssText =
          `position:absolute;visibility:hidden;white-space:pre;font-size:${inherited('fontSize')};` +
          `font-family:${inherited('fontFamily')};font-weight:${inherited('fontWeight')};` +
          `font-style:${inherited('fontStyle')};letter-spacing:${inherited('letterSpacing')}`;
        probe.textContent = field.placeholder;
        document.body.append(probe);
        const wanted = probe.getBoundingClientRect().width;
        probe.remove();
        const room = field.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
        readings.push({
          path: pathOf(field),
          selector: `${field.tagName.toLowerCase()}::placeholder`,
          landmark: landmarkOf(field),
          text: field.placeholder.slice(0, 80),
          role: null,
          scrollWidth: Math.round(field.clientWidth + Math.max(0, wanted - room)),
          clientWidth: field.clientWidth,
          clip: Math.max(0, Math.round(wanted - room)),
          lines: 1,
        });
      }

      const root = document.documentElement;
      readings.push({
        path: 'html',
        selector: 'html (the document)',
        landmark: 'html',
        text: '',
        role: null,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        clip: Math.max(0, root.scrollWidth - root.clientWidth),
        lines: 1,
      });

      return {
        readings,
        appHeaders: document.querySelectorAll('header.sticky').length,
        fallbackBars: document.querySelectorAll('[data-slot="status-fallback"]').length,
      };
    },
    { headerTitle: APP_HEADER_TITLE, bottomBar: BOTTOM_BAR },
  );
  // oxlint-enable unicorn/consistent-function-scoping
  return read;
}

/**
 * Sets the two faces side by side and lists what the wider one made worse.
 *
 * An element is a row when it clips at least a pixel more in mono than in Inter (`newly-clipped`
 * when Inter did not clip it at all, `clips-harder` when it clipped less), or when a tab label
 * wraps onto more lines in mono than in Inter.
 *
 * @param mono - the read taken in the app's own face.
 * @param inter - the read taken with the Inter baseline injected.
 * @returns one row per element that got worse, in DOM order.
 */
export function compareClips({ mono, inter }: { mono: ClipRead; inter: ClipRead }): ClipRow[] {
  const interByPath = new Map(inter.readings.map((reading) => [reading.path, reading]));
  const rows: ClipRow[] = [];
  for (const m of mono.readings) {
    const i = interByPath.get(m.path);
    if (i === undefined) continue;
    const delta = m.clip - i.clip;
    const isWorse = delta >= MIN_CLIP_DELTA_PX;
    const wraps = m.role === 'tab-label' && m.lines > i.lines;
    if (!isWorse && !wraps) continue;
    const kind: ClipKind = !isWorse ? 'wraps-more' : i.clip === 0 ? 'newly-clipped' : 'clips-harder';
    rows.push({
      path: m.path,
      selector: m.selector,
      landmark: m.landmark,
      text: m.text,
      role: m.role,
      kind,
      mono: { scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, clip: m.clip, lines: m.lines },
      inter: { scrollWidth: i.scrollWidth, clientWidth: i.clientWidth, clip: i.clip, lines: i.lines },
      delta,
    });
  }
  return rows;
}

/**
 * The one comparative hard claim left: a bottom bar label that got worse than it was in Inter.
 *
 * The header title used to be held here too. Since 2026-09-22 its claim is absolute and does not
 * read Inter at all, see {@link headerTitleOverflows}; its rows still come out of
 * {@link compareClips} and go in the report, and this filter leaves them there.
 *
 * @param rows - the output of {@link compareClips}.
 * @returns the rows that are tab labels.
 */
export function hardViolations<Row extends { role: ClipRole | null }>(rows: readonly Row[]): Row[] {
  return rows.filter((row) => row.role === 'tab-label');
}

/**
 * The app header titles in one read that do not fit their slot.
 *
 * The operator's rule, word for word: `scrollWidth <= clientWidth`, so there is no tolerance and
 * no comparison with another face. A title that does not fit is a defect in its string.
 *
 * @param read - the read taken in the app's own face.
 * @returns the header title readings whose `scrollWidth` exceeds their `clientWidth`.
 */
export function headerTitleOverflows(read: ClipRead): ClipReading[] {
  return read.readings.filter((reading) => reading.role === 'header-title' && reading.scrollWidth > reading.clientWidth);
}

/**
 * Waits until the page has stopped changing, so a read does not land on a skeleton.
 *
 * "Stopped" is: the element count is the same over five samples 80 ms apart, capped at 4 s. A
 * first visit hydrates, reads IndexedDB and paints the data in three separate steps, and the
 * count moves on each.
 *
 * @param page - a page that has just loaded.
 */
export async function waitForQuiet(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const deadline = Date.now() + 4000;
        let last = -1;
        let steady = 0;
        const sample = (): void => {
          const count = document.body.getElementsByTagName('*').length;
          steady = count === last ? steady + 1 : 0;
          last = count;
          if (steady >= 5 || Date.now() > deadline) {
            resolve();
            return;
          }
          setTimeout(sample, 80);
        };
        sample();
      }),
  );
}

/**
 * Loads every face the page's own text needs, then lets layout settle.
 *
 * A face still downloading is measured as its fallback, so a read taken early would compare the
 * fallback with the fallback. `load` fetches exactly the subsets the given text falls in, which
 * is what makes the Turkish latin-ext file arrive before the read and not during it.
 *
 * @param page - a page that is loaded.
 */
export async function settleFonts(page: Page): Promise<void> {
  await page.evaluate(
    async ({ families }) => {
      const text = `${document.body.innerText}ıİşŞğĞẞß`;
      for (const family of families) {
        for (const weight of [400, 500, 600, 700]) {
          await document.fonts.load(`${weight} 16px "${family}"`, text);
        }
      }
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    },
    { families: [VICTOR_MONO, INTER] },
  );
}

/**
 * Puts the page in the face it replaced, in place.
 *
 * Fails loudly if the injection did not take: a baseline that quietly stayed in Victor Mono would
 * compare the app with itself and report a clean sweep.
 *
 * @param page - a loaded page, already read in Victor Mono.
 */
export async function useInterBaseline(page: Page): Promise<void> {
  await page.addStyleTag({ content: INTER_BASELINE_CSS });
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  if (!familyStartsWith(INTER).test(family)) {
    throw new Error(`the Inter baseline did not take: the body is still drawn in ${family}`);
  }
  await settleFonts(page);
}

/**
 * Reads a loaded page in Victor Mono and then again in Inter.
 *
 * @param page - a page that is loaded and quiet, in the app's own face.
 * @returns both reads, in the same DOM.
 */
export async function readBothFaces(page: Page): Promise<{ mono: ClipRead; inter: ClipRead }> {
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  if (!familyStartsWith(VICTOR_MONO).test(family)) {
    throw new Error(`the mono read must be taken in Victor Mono, and the body is drawn in ${family}`);
  }
  await page.addStyleTag({ content: FREEZE_MOTION_CSS });
  await settleFonts(page);
  const mono = await readClips(page);
  await useInterBaseline(page);
  const inter = await readClips(page);
  return { mono, inter };
}

/** The ids of the three elements {@link injectClipControls} adds. */
export const CONTROL_IDS = {
  plain: 'lcc-clip-control-plain',
  tab: 'lcc-clip-control-tab',
  title: 'lcc-clip-control-title',
} as const;

/**
 * Adds three elements that are known to clip in mono and not in Inter, so the reader and the hard
 * assertion can be shown to fail.
 *
 * Each control is a single line of `overflow: hidden` text with an ellipsis, in a box as wide as
 * the MIDPOINT between the string's width in Inter and its width in Victor Mono. It inherits the
 * body's face, so it is clipped in the first read and fits in the second, by construction:
 *
 * - `plain` is an ordinary element, which the reader must list.
 * - `tab` is a label inside the bottom bar, which must carry the `tab-label` role.
 * - `title` is a heading inside the app header, which must carry the `header-title` role.
 *
 * THE STRING IS NARROW LETTERS ON PURPOSE. Inter is proportional and Victor Mono is a flat
 * 0.6 em, so a run of `i` and `l` is the string on which the two faces differ MOST, and the box
 * between the two widths is as wide as it can be. The header title control is at 18 px in both
 * faces, the size the real title has in both reads.
 *
 * All three are taken out of flow, so they move nothing else on the page.
 *
 * @param page - a loaded personal page, in the app's own face.
 * @returns each control's box width and the two widths it sat between, so a caller can assert the
 * control is really separated by the face.
 */
export async function injectClipControls(page: Page): Promise<ControlGeometry[]> {
  return page.evaluate(
    ({ ids, monoStack, interStack, sizes }) => {
      const text = 'illlliillilllliilllliilllli';
      const widthIn = ({ stack, size }: { stack: string; size: number }): number => {
        const probe = document.createElement('span');
        probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:600 ${size}px ${stack}`;
        probe.textContent = text;
        document.body.append(probe);
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        return width;
      };

      const geometry: ControlGeometry[] = [];
      const place = ({
        element,
        id,
        monoSize,
        interSize,
      }: {
        element: HTMLElement;
        id: string;
        monoSize: number;
        interSize: number;
      }): void => {
        const monoWidth = widthIn({ stack: monoStack, size: monoSize });
        const interWidth = widthIn({ stack: interStack, size: interSize });
        const boxWidth = Math.floor((monoWidth + interWidth) / 2);
        element.id = id;
        element.textContent = text;
        element.style.cssText =
          `position:absolute;left:0;top:0;margin:0;display:block;width:${boxWidth}px;` +
          `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${monoSize}px;font-weight:600;`;
        geometry.push({ id, boxWidth, monoWidth, interWidth });
      };

      const plain = document.createElement('div');
      place({ element: plain, id: ids.plain, monoSize: sizes.body, interSize: sizes.body });
      document.body.append(plain);

      const tabLink = document.querySelector('[data-slot="bottom-nav-shell"] nav a');
      if (tabLink === null) throw new Error('the page has no bottom bar tab to hold a control');
      const tab = document.createElement('span');
      place({ element: tab, id: ids.tab, monoSize: sizes.body, interSize: sizes.body });
      tabLink.append(tab);

      const header = document.querySelector('header.sticky');
      if (header === null) throw new Error('the page has no app header to hold a control');
      const title = document.createElement('h1');
      place({ element: title, id: ids.title, monoSize: sizes.title, interSize: sizes.title });
      header.append(title);

      return geometry;
    },
    {
      ids: CONTROL_IDS,
      monoStack: BODY_STACK,
      interStack: PROSE_STACK,
      sizes: { body: 14, title: HEADER_TITLE_PX },
    },
  );
}

/** One control's box, and the two widths its text has in the two faces. */
export interface ControlGeometry {
  id: string;
  boxWidth: number;
  monoWidth: number;
  interWidth: number;
}
