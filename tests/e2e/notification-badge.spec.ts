/**
 * The push notification badge, read pixel by pixel out of the shipped file.
 *
 * ── The defect this file encodes ─────────────────────────────────────────
 *
 * On 2026-09-14 the operator reported a plain WHITE CIRCLE in the Android
 * status bar. The service worker was passing `/icons/icon-192.png` as the
 * notification `badge`, and the app icon is a solid teal disc. Android does
 * not draw the badge's colours: it reads the ALPHA CHANNEL only, and fills
 * every pixel that is not transparent with its own tint. A disc on a
 * transparent square therefore arrives as a disc, with the glyph inside it
 * gone. The badge has to be a SILHOUETTE, white on transparency, cut in
 * `openplate-brand` and copied here by `pnpm sync:brand`.
 *
 * ── Why a canvas read and not a screenshot ───────────────────────────────
 *
 * The status bar is the operating system's, not the page's, so there is
 * nothing on any page to photograph. The property that decides how Android
 * renders the badge is in the file's own pixels, so the file is what this
 * spec reads: it decodes the PNG in the browser, draws it into a canvas and
 * looks at every RGBA quadruple. A screenshot could not see the alpha channel
 * at all.
 *
 * ── The control ─────────────────────────────────────────────────────────
 *
 * The same routine runs over `/icons/icon-192.png`, the teal disc, and must
 * report `monochrome: false`. Without it, a bug in the reader, an empty
 * canvas, a failed decode, would pass the badge silently.
 */
import { expect, test } from '@playwright/test';

/** How much of the badge must be opaque, so an empty or blank PNG cannot pass. */
const MIN_OPAQUE_FRACTION = 0.05;

/** What one canvas read of an icon says about it. */
interface IconPixels {
  /** The decoded size, so a failed decode cannot look like a pass. */
  width: number;
  height: number;
  /** Whether every opaque pixel is pure white, which is what Android needs. */
  monochrome: boolean;
  /** The share of pixels with a non-zero alpha. */
  opaqueFraction: number;
}

/**
 * Decodes one icon in the page and reports what its pixels are.
 *
 * @param page - any page on the app origin, so the icon is same-origin and the
 *   canvas stays untainted. A cross-origin image would make `getImageData`
 *   throw a security error instead of answering.
 * @param path - the icon's path, relative to the app origin.
 */
async function readIconPixels(page: import('@playwright/test').Page, path: string): Promise<IconPixels> {
  return page.evaluate(async (source: string) => {
    const image = new Image();
    image.src = source;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    context.drawImage(image, 0, 0);

    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let opaque = 0;
    let monochrome = true;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a === 0) continue;
      opaque += 1;
      if (r !== 255 || g !== 255 || b !== 255) monochrome = false;
    }

    return {
      width: canvas.width,
      height: canvas.height,
      monochrome,
      opaqueFraction: opaque / (canvas.width * canvas.height),
    };
  }, path);
}

test('the badge the worker names is a white-on-transparent silhouette', async ({ page }) => {
  await page.goto('/');

  const badge = await readIconPixels(page, '/icons/badge-96.png');

  expect(badge.width, 'the badge must decode to a real bitmap').toBeGreaterThan(0);
  expect(badge.height, 'the badge must decode to a real bitmap').toBeGreaterThan(0);
  expect(
    badge.opaqueFraction,
    'a badge that is almost entirely transparent draws nothing in the status bar',
  ).toBeGreaterThan(MIN_OPAQUE_FRACTION);
  expect(
    badge.monochrome,
    'Android tints every opaque pixel itself, so a coloured badge arrives as a filled shape',
  ).toBe(true);
});

test('the app icon FAILS the same rule, so the reader is not vacuous', async ({ page }) => {
  await page.goto('/');

  const appIcon = await readIconPixels(page, '/icons/icon-192.png');

  expect(appIcon.opaqueFraction, 'the app icon is a solid disc, so most of it is opaque').toBeGreaterThan(
    MIN_OPAQUE_FRACTION,
  );
  expect(appIcon.monochrome, 'the app icon is teal: this read must go false or it sees nothing').toBe(false);
});

test('the service worker still points its badge at the silhouette', async ({ page }) => {
  await page.goto('/');

  const source = await page.evaluate(async () => {
    const response = await fetch('/sw.js');
    return response.text();
  });

  expect(
    source,
    'pointing the badge back at the 192 icon is the 2026-09-14 white circle, returning',
  ).toMatch(/NOTIFICATION_BADGE = '\/icons\/badge-96\.png'/);
});
