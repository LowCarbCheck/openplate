/**
 * On a plain-http origin the camera button still opens the browser's picker.
 *
 * THE REPORT, install rehearsal, 2026-09-27: on `http://<LAN-IP>:3000`, with
 * `isSecureContext` false and `navigator.mediaDevices` undefined, "Photograph
 * your plate" appeared to do nothing, while "Choose from library" worked.
 *
 * WHAT THE BUTTON IS. It does not call `getUserMedia` and never touches
 * `navigator.mediaDevices`: it clicks a hidden `<input type="file"
 * accept="image/*" capture="environment">`. The `capture` attribute is a hint
 * to the browser's own file picker (a phone opens its camera app), and the
 * picker is not a secure-context feature. So the claim to test is whether the
 * browser opens its picker for that input on an insecure page, and whether it
 * does anything different from the library button.
 *
 * HOW. A picker a headless browser opens is invisible: nothing is drawn, and
 * an automation that does not answer the `filechooser` event sees "nothing
 * happened". Playwright reports the event, so each click either produces a
 * chooser for the right input or does not. The insecure origin is made the way
 * `accounts-need-https.spec.ts` makes it, by mapping a name onto the tier's
 * loopback server, and the first assertion reads `isSecureContext` back.
 *
 * @area scan
 */
import { expect, test, type Page } from '@playwright/test';

import { E2E_APP_PORT } from './env';
import { completeOnboarding, connectStubAiProvider } from './helpers';
import { EN } from './copy';

/** A name only this browser can resolve, onto the tier's own server. */
const INSECURE_HOST = 'openplate-lan.test';

test.use({
  baseURL: `http://${INSECURE_HOST}:${E2E_APP_PORT}`,
  launchOptions: { args: [`--host-resolver-rules=MAP ${INSECURE_HOST} 127.0.0.1`] },
  serviceWorkers: 'block',
});

/** Clicks a button and returns what the browser's picker was opened for. */
async function chooserFor(page: Page, buttonName: string) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    page.getByRole('button', { name: buttonName, exact: true }).click(),
  ]);
  return {
    capture: await chooser.element().getAttribute('capture'),
    accept: await chooser.element().getAttribute('accept'),
    isMultiple: chooser.isMultiple(),
  };
}

test('the camera button opens the picker on a plain-http page, and so does the library button', async ({ page }) => {
  await completeOnboarding(page);
  expect(await page.evaluate(() => window.isSecureContext), 'the mapped origin is not insecure').toBe(false);
  expect(await page.evaluate(() => navigator.mediaDevices === undefined), 'mediaDevices exists here').toBe(true);
  await connectStubAiProvider(page);

  await page.goto('/add/photo');
  const camera = await chooserFor(page, EN.scan.capture.takePhoto);
  expect(camera).toEqual({ capture: 'environment', accept: 'image/*', isMultiple: false });

  // THE CONTROL: the button the report says works, through the same event.
  const library = await chooserFor(page, EN.scan.capture.chooseLibrary);
  expect(library).toEqual({ capture: null, accept: 'image/*', isMultiple: false });

  // THE NEGATIVE CONTROL: a click that opens no picker produces no event, so
  // the two readings above are not something every click would produce.
  const stray = page.waitForEvent('filechooser', { timeout: 1000 }).then(
    () => 'opened',
    () => 'none',
  );
  await page.locator('main [data-slot="card-title"]').first().click();
  expect(await stray).toBe('none');
});
