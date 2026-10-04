/**
 * A photo reaches an AI as a fresh JPEG with no EXIF, or it does not reach it
 * at all (M3/05, 2026-10-04).
 *
 * THE PROMISE this guards: "our server does not save your photo" is only half
 * of what a person is told. The other half is that what leaves the phone is the
 * picture and nothing about where it was taken. The original file carries the
 * GPS position, the camera and the time in an EXIF segment. `downscaleToJpeg`
 * draws the picture onto a canvas and encodes it again, which drops all of it.
 *
 * THE DEFECT before this spec: when that re-encode failed (a HEIC outside
 * Safari, a decoder that gave up) `/add/photo` sent the ORIGINAL file, the most
 * identifying version of the picture, and `/pantry` never re-encoded at all.
 *
 * WHAT IS REAL: the production build, the capture inputs, the real canvas
 * re-encode in Chromium, the real vision adapter and its request body. WHAT IS
 * STUBBED: the provider, an endpoint on this app's own origin answered with
 * `page.route`, so the request body is READ, not guessed at.
 *
 * THE CONTROLS. A fixture file that really carries an Exif segment and a
 * marker string is checked to carry them BEFORE anything is asserted about what
 * was sent, so "the sent image has no EXIF" cannot pass on a fixture that never
 * had any. A valid photo picked after the broken one IS posted, so "nothing
 * was posted" cannot pass on a spy that sees no requests.
 *
 * @area scan
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { E2E_APP_URL } from './env';
import { completeOnboarding, connectStubAiProvider } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { routeStubPlateAnswer } from './ai-plate-stub';

test.use({ serviceWorkers: 'block' });

/** The endpoint `connectStubAiProvider` connects. */
const STUB_COMPLETIONS_URL = `${E2E_APP_URL}/e2e-stub-provider/v1/chat/completions`;

/** The narrowest phone the status slot must hold its box on. */
const NARROW_PHONE = { width: 360, height: 800 } as const;

/** How long a send that must not happen is waited for: the library pick's grace window and then some. */
const NO_SEND_WATCH_MS = 2_500;

/** The APP1 header every EXIF segment starts with: `Exif`, then two zero bytes. */
const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1');

/** Text only a position tag would hold, placed inside the EXIF segment so a leak is found by name too. */
const GPS_MARKER = 'GPSLatitude=48.137154 GPSLongitude=11.576124';

/** Bytes that are not an image at all, under a name and type that say they are. */
const NOT_AN_IMAGE = Buffer.from('this is a note, not a picture '.repeat(40), 'utf8');

/** A pantry answer, complete as the strict schema wants it. */
const PANTRY_ANSWER = {
  items: [{ name: 'Re-encode tier eggs', amount: 6, unit: 'piece', category: 'egg', confidence: 'high' }],
  notes: null,
};

/** One real JPEG, drawn and encoded in the browser, as base64. */
async function drawJpeg(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    context.fillStyle = '#c0392b';
    context.fillRect(0, 0, 64, 48);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (blob === null) throw new Error('no jpeg');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCodePoint(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

/**
 * A decodable JPEG with an EXIF segment spliced in right after the start-of-image
 * marker, the place a camera writes it.
 *
 * @param page - any page on the app's origin, used only to draw the picture.
 */
async function jpegWithExif(page: Page): Promise<Buffer> {
  const plain = await drawJpeg(page);
  // A minimal big-endian TIFF header with an empty first directory, then the marker text.
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const payload = Buffer.concat([EXIF_HEADER, tiff, Buffer.from(GPS_MARKER, 'latin1')]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xff_e1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([plain.subarray(0, 2), app1, payload, plain.subarray(2)]);
}

/** Whether the bytes hold an EXIF segment header or the position text. */
function carriesExif(bytes: Buffer): boolean {
  return bytes.includes(EXIF_HEADER) || bytes.includes(Buffer.from(GPS_MARKER, 'latin1'));
}

/** Answers the stub provider with the pantry's reading. Register it before {@link recordProviderPosts}. */
async function answerWithPantry(page: Page): Promise<void> {
  await page.route(STUB_COMPLETIONS_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(PANTRY_ANSWER) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      }),
    }),
  );
}

/** Every request body the stub provider received, in order. Registered AFTER the provider's own answer. */
async function recordProviderPosts(page: Page): Promise<string[]> {
  const bodies: string[] = [];
  await page.route(STUB_COMPLETIONS_URL, async (route) => {
    bodies.push(route.request().postData() ?? '');
    await route.fallback();
  });
  return bodies;
}

/** The image a request body carries, decoded. */
interface SentImage {
  mimeType: string;
  bytes: Buffer;
}

/** The image a request body carries. Throws when there is none. */
function sentImage(body: string): SentImage {
  const found = /data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)/u.exec(body);
  if (found?.[1] === undefined || found[2] === undefined) throw new Error('the request carried no image');
  return { mimeType: found[1], bytes: Buffer.from(found[2], 'base64') };
}

/** The plate screen's own camera input, found through its card: the tab bar's launcher has one too. */
function plateCameraInput(page: Page) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('input[type="file"][capture]') })
    .locator('input[type="file"][capture]');
}

/** The pantry composer's own camera input, not the tab bar's raised launcher. */
function pantryCameraInput(page: Page) {
  return page.locator('main div.max-w-xl input[type="file"][capture]');
}

test('a photo this device cannot re-encode is refused, nothing is sent, and the card holds still', async ({ page }) => {
  await installShiftObserver(page);
  await page.setViewportSize(NARROW_PHONE);
  await completeOnboarding(page);
  await routeStubPlateAnswer(page);
  await connectStubAiProvider(page);
  const posts = await recordProviderPosts(page);
  await page.goto('/add/photo');

  const status = page.locator('[data-slot="photo-status"]');
  await expect(status).toBeAttached();
  await settleFrames(page);
  const slotBefore = await status.boundingBox();
  const topsBefore = await readTops(page);
  const shiftsBefore = (await readShiftEntries(page)).length;

  // A CAMERA PICK, which dispatches at once when it works, so a send would not wait for a grace window.
  await plateCameraInput(page).setInputFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: NOT_AN_IMAGE });
  await expect(status).toHaveText(EN.scan.errors.photo.notPrepared);
  await settleFrames(page);
  await page.waitForTimeout(NO_SEND_WATCH_MS);

  expect(posts, 'a photo that could not be re-encoded was sent as it was').toEqual([]);
  await expect(page.getByAltText(EN.scan.capture.previewAlt)).toHaveCount(0);
  expect((await status.boundingBox())?.height, 'the error grew its box').toBe(slotBefore?.height);
  expect(movedBetween(topsBefore, await readTops(page)), 'what moved when the error appeared').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift as the error appeared').toBe(0);

  // THE CONTROL OF THE SPY: a picture that does decode is picked next, and IS posted.
  const good = await jpegWithExif(page);
  await plateCameraInput(page).setInputFiles({ name: 'plate.jpg', mimeType: 'image/jpeg', buffer: good });
  await expect(page.getByText(EN.scan.review.heading)).toBeVisible();
  expect(posts, 'the spy saw no request for a photo that was sent').toHaveLength(1);
});

test('the JPEG a plate photo reaches the provider as carries no EXIF', async ({ page }) => {
  await completeOnboarding(page);
  await routeStubPlateAnswer(page);
  await connectStubAiProvider(page);
  const posts = await recordProviderPosts(page);
  await page.goto('/add/photo');

  const original = await jpegWithExif(page);
  // THE CONTROL: the fixture really holds what the assertion below looks for.
  expect(carriesExif(original), 'the fixture carries no EXIF, so the check below proves nothing').toBe(true);

  await plateCameraInput(page).setInputFiles({ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: original });
  await expect(page.getByText(EN.scan.review.heading)).toBeVisible();

  expect(posts).toHaveLength(1);
  const image = sentImage(posts[0] ?? '');
  expect(image.mimeType).toBe('image/jpeg');
  // A JPEG: it starts with the start-of-image marker.
  expect([...image.bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  expect(carriesExif(image.bytes), 'the photo sent to the provider still carries EXIF').toBe(false);
});

test('the JPEG a shelf photo reaches the provider as carries no EXIF', async ({ page }) => {
  await completeOnboarding(page);
  await connectStubAiProvider(page);
  // The shelf is read by the same endpoint, so its answer is the pantry's. The
  // answer is registered FIRST: the spy below runs before it and falls back to it.
  await answerWithPantry(page);
  const posts = await recordProviderPosts(page);
  await page.goto('/pantry');

  const original = await jpegWithExif(page);
  expect(carriesExif(original), 'the fixture carries no EXIF, so the check below proves nothing').toBe(true);

  await pantryCameraInput(page).setInputFiles({ name: 'IMG_0002.jpg', mimeType: 'image/jpeg', buffer: original });
  await expect(page.getByText(EN.pantry.review.title)).toBeVisible();

  expect(posts).toHaveLength(1);
  const image = sentImage(posts[0] ?? '');
  expect(image.mimeType).toBe('image/jpeg');
  expect(carriesExif(image.bytes), 'the shelf photo sent to the provider still carries EXIF').toBe(false);
});

test('a shelf photo this device cannot re-encode is refused and nothing is sent', async ({ page }) => {
  await completeOnboarding(page);
  await connectStubAiProvider(page);
  await answerWithPantry(page);
  const posts = await recordProviderPosts(page);
  await page.goto('/pantry');

  await pantryCameraInput(page).setInputFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: NOT_AN_IMAGE });
  await expect(page.getByText(EN.scan.errors.photo.notPrepared)).toBeVisible();
  await page.waitForTimeout(NO_SEND_WATCH_MS);
  expect(posts, 'a shelf photo that could not be re-encoded was sent as it was').toEqual([]);

  // THE CONTROL OF THE SPY: a picture that does decode is posted.
  await pantryCameraInput(page).setInputFiles({
    name: 'shelf.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegWithExif(page),
  });
  await expect(page.getByText(EN.pantry.review.title)).toBeVisible();
  expect(posts, 'the spy saw no request for a photo that was sent').toHaveLength(1);
});
