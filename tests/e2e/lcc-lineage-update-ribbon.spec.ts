/**
 * The update ribbon keeps its version number, its link and its dismiss key in the wider face
 * (M243 spec 08).
 *
 * WHAT WENT WRONG. The ribbon was one `truncate`d line: an icon, the sentence "openplate 0.35.1 is
 * available", a link, and a 28 px dismiss key. At 390 px in Victor Mono the sentence lost its tail
 * to an ellipsis ("openplate 0.35.1 is ava..."), and in German, French, Italian and Spanish it
 * lost more, in Inter as well as in Victor Mono. The version number is the reason the row exists.
 * At 320 px the French and Italian rows also pushed the document wider than the phone. The ribbon
 * is now allowed to wrap onto a second row (`update-ribbon.tsx` records why), and both keys are 44 px.
 *
 * WHAT IS ASSERTED, IN EVERY SHIPPED LANGUAGE, AT 360 AND 390 PX, IN VICTOR MONO AND IN INTER
 *
 * 1. The whole sentence is drawn: no ellipsis, nothing wider than its box, and the version number
 *    sits inside the visible part of the page.
 * 2. The dismiss key and the link are each at least 44 px tall and wide, and entirely on screen.
 * 3. The document is not wider than the phone.
 * 4. The ribbon does not balloon: it stays inside a stated height. Two rows are 77 px at worst
 *    today (a 20 px sentence line and a 44 px key row, with 8 px of padding), so the bound is 90.
 * 5. The key really dismisses. A tap on it hides the ribbon and remembers the version.
 *
 * TWO FACES, BECAUSE THE PROBLEM IS THE FACE. Both are read in the same page: the Victor Mono read
 * first, then the Inter baseline injected by `clip-baseline.ts`, so the ribbon is shown to fit in
 * the face it was built for and the face it replaced.
 *
 * THE SERVICE WORKER IS BLOCKED, because `page.route` cannot answer a request a service worker
 * makes. The update store polls `/api/update-status`, and this spec answers it with a release newer
 * than the running build, which is the only way to make the ribbon appear on a build that is
 * current.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ──
 * The reader is pointed at the OLD ribbon, rebuilt in place from the markup it had (one `truncate`d
 * line, a 28 px key), and must report that the version is clipped and the key too small. A reader
 * that said "fine" to that would say "fine" to everything.
 */
import { expect, test, type Page } from '@playwright/test';

import type { LanguageCode } from '../../app/i18n/language-prefs';
import { useInterBaseline, waitForQuiet } from './clip-baseline';
import { completeOnboarding, useLanguage } from './helpers';

test.use({ serviceWorkers: 'block' });

/** All six shipped languages: the ribbon's sentence and its link are different lengths in each. */
const LOCALES = ['de', 'en', 'es', 'fr', 'it', 'tr'] as const satisfies readonly LanguageCode[];

/** The narrowest screen the app promises to fit, and the design width. */
const WIDTHS = [360, 390] as const;

const PHONE_HEIGHT = 844;

/** The floor for a key a thumb hits. */
const TAP_FLOOR_PX = 44;

/** The ribbon's tallest acceptable height. See the header. */
const RIBBON_MAX_HEIGHT_PX = 90;

/** Where the store remembers a dismissed release (`DISMISSED_STORAGE_KEY` in `app/lib/update-store.ts`). */
const DISMISSED_STORAGE_KEY = 'openplate:update-dismissed';

/** The release the fake server announces. It is the text a person needs to read. */
const LATEST_VERSION = '0.35.1';

/** What `/api/update-status` answers: a release newer than the running build, with a link. */
const UPDATE_AVAILABLE = {
  enabled: true,
  currentVersion: '0.35.0',
  sha: 'abc1234',
  builtAt: '2026-09-01T00:00:00.000Z',
  latest: LATEST_VERSION,
  releaseUrl: `https://github.com/LowCarbCheck/openplate/releases/tag/v${LATEST_VERSION}`,
  checkedAt: '2026-09-20T00:00:00.000Z',
  updateAvailable: true,
  throttled: false,
  nextCheckAllowedAt: null,
} as const;

/** What one read of the ribbon found. */
interface RibbonReading {
  height: number;
  documentWidth: number;
  viewportWidth: number;
  /** The sentence's text and whether it is drawn whole. */
  sentence: { text: string; isWhole: boolean; hasEllipsis: boolean; isVersionSeen: boolean };
  /** The link and the dismiss key: their boxes, or null when the ribbon has none. */
  link: KeyBox | null;
  dismiss: KeyBox | null;
}

/** A key's box, and whether it sits entirely on the screen. */
interface KeyBox {
  width: number;
  height: number;
  isOnScreen: boolean;
}

/**
 * Reads the ribbon: the sentence, the two keys, the height and the document.
 *
 * The version is judged by its own rectangle, taken with a `Range` over exactly those characters,
 * so it says whether the NUMBER is on screen and inside the sentence's box, not merely whether the
 * element that contains it exists.
 *
 * @param page - a page showing the ribbon.
 * @returns the reading, or null when no ribbon is drawn.
 */
async function readRibbon(page: Page): Promise<RibbonReading | null> {
  // THE CALLBACK IS SERIALISED INTO THE PAGE, so `boxOf` cannot be hoisted out of it.
  // oxlint-disable unicorn/consistent-function-scoping
  const reading = await page.evaluate((version) => {
    const ribbon = [...document.querySelectorAll('output')].find((output) =>
      (output.textContent ?? '').includes(version),
    );
    if (ribbon === undefined) return null;

    const boxOf = (element: Element | null): KeyBox | null => {
      if (element === null) return null;
      const box = element.getBoundingClientRect();
      return {
        width: Math.round(box.width),
        height: Math.round(box.height),
        isOnScreen: box.left >= 0 && box.right <= window.innerWidth + 0.5,
      };
    };

    const sentence = ribbon.querySelector('span');
    if (sentence === null) throw new Error('the ribbon has no sentence');
    const text = sentence.textContent ?? '';
    const style = getComputedStyle(sentence);

    // The version's own rectangle, over exactly its characters in the sentence's text node.
    const node = sentence.firstChild;
    const start = text.indexOf(version);
    let isVersionSeen = false;
    if (node !== null && start >= 0) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + version.length);
      const versionBox = range.getBoundingClientRect();
      const room = sentence.getBoundingClientRect();
      const isInsideSentence = versionBox.right <= room.right + 0.5 && versionBox.left >= room.left - 0.5;
      isVersionSeen = versionBox.width > 0 && isInsideSentence && versionBox.left >= 0 && versionBox.right <= window.innerWidth;
    }

    return {
      height: Math.round(ribbon.getBoundingClientRect().height),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      sentence: {
        text,
        isWhole: sentence.scrollWidth <= sentence.clientWidth && sentence.scrollHeight <= sentence.clientHeight + 1,
        hasEllipsis: style.textOverflow === 'ellipsis',
        isVersionSeen,
      },
      link: boxOf(ribbon.querySelector('a')),
      dismiss: boxOf(ribbon.querySelector('button')),
    };
  }, LATEST_VERSION);
  // oxlint-enable unicorn/consistent-function-scoping
  return reading;
}

/**
 * What is wrong with a reading, in words, or nothing when the ribbon is sound.
 *
 * @param reading - one read of the ribbon.
 * @returns one sentence per problem.
 */
function problemsWith(reading: RibbonReading): string[] {
  const problems: string[] = [];
  if (!reading.sentence.isVersionSeen) problems.push(`the version ${LATEST_VERSION} is not visible`);
  if (reading.sentence.hasEllipsis) problems.push('the sentence carries an ellipsis');
  if (!reading.sentence.isWhole) problems.push('the sentence is wider or taller than its box');
  if (!reading.sentence.text.includes(LATEST_VERSION)) problems.push('the sentence does not name the version');
  for (const [name, key] of [
    ['the link', reading.link],
    ['the dismiss key', reading.dismiss],
  ] as const) {
    if (key === null) {
      problems.push(`${name} is missing`);
      continue;
    }
    if (key.height < TAP_FLOOR_PX) problems.push(`${name} is ${key.height} px tall`);
    if (key.width < TAP_FLOOR_PX) problems.push(`${name} is ${key.width} px wide`);
    if (!key.isOnScreen) problems.push(`${name} runs past the screen edge`);
  }
  if (reading.documentWidth > reading.viewportWidth) {
    problems.push(`the document is ${reading.documentWidth} px wide on a ${reading.viewportWidth} px phone`);
  }
  if (reading.height > RIBBON_MAX_HEIGHT_PX) problems.push(`the ribbon is ${reading.height} px tall`);
  return problems;
}

/**
 * Answers the update poll with a newer release, then opens the diary and waits for the ribbon.
 *
 * @param page - a page past onboarding.
 * @param width - the phone width to draw at.
 */
async function openWithRibbon(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: PHONE_HEIGHT });
  await page.evaluate((key) => window.localStorage.removeItem(key), DISMISSED_STORAGE_KEY);
  await page.goto('/diary');
  await expect(page.locator('output', { hasText: LATEST_VERSION }), 'the ribbon must be drawn').toBeVisible();
  await waitForQuiet(page);
}

test('the update ribbon keeps its version and two 44 px keys in Victor Mono and in Inter, in all six languages', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.route('**/api/update-status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(UPDATE_AVAILABLE) }),
  );
  await completeOnboarding(page);

  let readings = 0;
  const problems: string[] = [];
  for (const locale of LOCALES) {
    await useLanguage(page, locale);
    for (const width of WIDTHS) {
      await openWithRibbon(page, width);
      const where = `${locale} at ${width}px`;

      const mono = await readRibbon(page);
      expect(mono, `${where}: the ribbon must be readable in Victor Mono`).not.toBeNull();
      if (mono !== null) {
        readings += 1;
        problems.push(...problemsWith(mono).map((problem) => `${where} in Victor Mono: ${problem}`));
      }

      await useInterBaseline(page);
      const inter = await readRibbon(page);
      expect(inter, `${where}: the ribbon must be readable in Inter`).not.toBeNull();
      if (inter !== null) {
        readings += 1;
        problems.push(...problemsWith(inter).map((problem) => `${where} in Inter: ${problem}`));
      }
    }
  }

  // NON-VACUITY: every language, both widths, both faces.
  expect(readings, 'the ribbon must have been read in every language, width and face').toBe(
    LOCALES.length * WIDTHS.length * 2,
  );
  expect(problems, 'the update ribbon lost its version, its link or a 44 px key').toEqual([]);
});

test('the dismiss key hides the ribbon and remembers the version', async ({ page }) => {
  await page.route('**/api/update-status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(UPDATE_AVAILABLE) }),
  );
  await completeOnboarding(page);
  await useLanguage(page, 'de');
  await openWithRibbon(page, 360);

  const ribbon = page.locator('output', { hasText: LATEST_VERSION });
  await ribbon.locator('button').click();
  await expect(ribbon, 'a tap on the dismiss key must hide the ribbon').toBeHidden();
  expect(
    await page.evaluate((key) => window.localStorage.getItem(key), DISMISSED_STORAGE_KEY),
    'and the store must remember which release was dismissed',
  ).toBe(LATEST_VERSION);
});

test('CONTROL: the reader flags the old ribbon, one truncated line with a 28 px key', async ({ page }) => {
  await page.route('**/api/update-status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(UPDATE_AVAILABLE) }),
  );
  await completeOnboarding(page);
  await useLanguage(page, 'de');
  await openWithRibbon(page, 360);

  const sound = await readRibbon(page);
  expect(sound, 'the ribbon must be drawn').not.toBeNull();
  if (sound === null) return;
  expect(problemsWith(sound), 'the real ribbon reads sound before it is broken').toEqual([]);

  // Put the OLD markup's constraints back on the real elements: one line, `truncate`, a 28 px key.
  await page.evaluate((version) => {
    const ribbon = [...document.querySelectorAll('output')].find((output) =>
      (output.textContent ?? '').includes(version),
    );
    if (ribbon === undefined) throw new Error('the ribbon is gone');
    if (!(ribbon instanceof HTMLElement)) throw new Error('the ribbon is not an element');
    ribbon.style.flexWrap = 'nowrap';
    const sentence = ribbon.querySelector('span');
    if (sentence instanceof HTMLElement) {
      sentence.style.cssText = 'min-width:0;flex:1 1 0%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    }
    const button = ribbon.querySelector('button');
    // `transition: none`, because the button carries `transition-all`: without it the size is
    // ANIMATED to 28 px and a read taken straight after still sees 44.
    if (button instanceof HTMLElement) {
      button.style.cssText = 'height:28px;width:28px;flex-shrink:0;transition:none;';
    }
  }, LATEST_VERSION);

  const broken = await readRibbon(page);
  expect(broken, 'the broken ribbon must still be drawn').not.toBeNull();
  if (broken === null) return;
  const found = problemsWith(broken);
  expect(found, 'the old sentence must read as clipped').toEqual(
    expect.arrayContaining([expect.stringContaining('ellipsis')]),
  );
  expect(found, 'the old dismiss key must read as too small').toEqual(
    expect.arrayContaining([expect.stringContaining('dismiss key is 28 px tall')]),
  );
});
