/**
 * The four things more than one spec needs: a device past onboarding, a device
 * with a session, the phone-layout budget, and the header's status line.
 *
 * EVERY HELPER DRIVES THE REAL UI. There is no "write the flag the app would
 * have written" shortcut in here, because a shortcut is a second
 * implementation of the thing under test: a gate that stopped reading
 * `onboardingCompletedAt` would still pass a suite that stamped it directly.
 * The one exception is the fixture ACCOUNT, which `global-setup.ts` creates on
 * the fake sync service in node, and even then the browser still signs in
 * through `/sign-in` with an address and a password.
 */
import { expect, type Locator, type Page } from '@playwright/test';

import { LANGUAGE_COOKIE, type LanguageCode } from '../../app/i18n/language-prefs';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_APP_URL } from './env';
import { EN } from './copy';

/** The phone this tier emulates, and the width the layout budget is written against. */
export const PHONE_WIDTH = 390;

/** The app header's fixed height (`min-h-16`), which no status message may change. */
export const HEADER_HEIGHT = 64;

/** The eating style with no follow-up questions, so the first onboarding step is one click. */
const NEUTRAL_EATING_STYLE = 'just-track';

/**
 * Puts the device in `locale` for its NEXT document load.
 *
 * THE COOKIE, because that is the app's own mechanism: the server renders
 * `<html lang>` and every string from `openplate-language` and nothing else
 * (`app/i18n/language-prefs.ts`), and a switch in the UI writes exactly this
 * cookie before reloading. Writing it here rather than clicking the switcher
 * keeps a per-locale layout walk from spending six reloads on the way in;
 * the switcher itself has its own check. It takes effect on the next `goto`,
 * never on the page already open.
 *
 * @param page - the page whose context gets the cookie.
 * @param locale - the language to render the next document in.
 */
export async function useLanguage(page: Page, locale: LanguageCode): Promise<void> {
  await page.context().addCookies([{ name: LANGUAGE_COOKIE, value: locale, url: E2E_APP_URL }]);
}

/**
 * Walks a fresh device from `/welcome` to the diary, through the real
 * questionnaire.
 *
 * FOUR STEPS AND NO SHORTCUT. The first one has no Skip on purpose (`just-track`
 * IS the "no goal" answer, see `StepActions`), so it is answered rather than
 * skipped; the next two are skipped; the last offers "I'll do it later", which
 * is what lands on the diary.
 *
 * @param page - a page on a device that has never been used.
 */
export async function completeOnboarding(page: Page): Promise<void> {
  await page.goto('/welcome');
  await page.getByRole('link', { name: EN.welcome.start, exact: true }).click();

  await expect(page.getByText(EN.onboarding.style.title)).toBeVisible();
  await page.locator(`input[name="eatingStyle"][value="${NEUTRAL_EATING_STYLE}"]`).check();
  await page.getByRole('button', { name: EN.onboarding.actions.continue }).click();

  await expect(page.getByText(EN.onboarding.step.weight.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();

  await expect(page.getByText(EN.onboarding.step.body.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();

  await expect(page.getByText(EN.onboarding.step.firstFood.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.firstFood.later }).click();

  await page.waitForURL('**/diary');
}

/**
 * Signs the device in as the fixture account `global-setup.ts` created.
 *
 * The two fields are found by their `autocomplete` tokens rather than by their
 * labels: the labels are wordsmith-owned copy and the tokens are a contract
 * with the password manager, so the tokens are the stable half.
 *
 * @param page - a page on a device that has already been through onboarding.
 */
export async function signInFixtureAccount(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
  await page.waitForURL('**/diary');
}

/**
 * Gives the device an AI provider, so the camera gesture opens a camera.
 *
 * WHY A SPEC WOULD WANT ONE. `useCameraCapture` refuses to ask for a camera on
 * a device that has no provider: it navigates to `/scan` and shows the connect
 * card instead. A spec about the capture gesture therefore has to connect
 * something first, or it is asserting the fallback.
 *
 * THE ENDPOINT IS THIS APP'S OWN ORIGIN, on a path nothing serves, for the two
 * reasons `scan-review.spec.ts` records at length: the production CSP only
 * allows an origin it knows about plus `'self'`, and a same-origin address
 * needs no CORS preflight, which `page.route` does not answer. The one request
 * this makes, the key check, is answered here. Nothing is spent and nothing
 * leaves the machine.
 *
 * NO SHORTCUT WRITE: the settings row is written by the real form, for the
 * reason at the top of this file.
 *
 * @param page - a page on a device that is past onboarding.
 */
export async function connectStubAiProvider(page: Page): Promise<void> {
  const baseUrl = `${E2E_APP_URL}/e2e-stub-provider/v1`;

  // The key check `settings.ai` runs before it saves (`verify-key.ts`). Any
  // answer that is not a 401 or a 403 means "reachable, key not refused".
  await page.route(`${baseUrl}/models`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
  );

  await page.goto('/settings/ai');
  await page.getByRole('button', { name: EN.settingsAi.advanced.toggle }).click();
  await page.getByRole('radio', { name: EN.settingsAi.advanced.openaiCompatibleOption }).check();
  await page.locator('input[name="model"]').fill('e2e-stub-model');
  await page.locator('input[name="baseUrl"]').fill(baseUrl);
  await page.locator('input[name="apiKey"]').fill('e2e-not-a-real-key');
  await page.getByRole('button', { name: EN.settingsAi.save.settings }).click();

  // A verified first connect returns to the diary, which is the one signal
  // that the row was written rather than refused by the key check.
  await page.waitForURL('**/diary');
}

/** One hand-typed entry, as `logFoodManually` posts it. */
export interface ManualFood {
  /** The name to type. */
  name: string;
  /** How many grams of it, as the field takes it. */
  grams: string;
  /**
   * Grams of carbohydrate PER 100 g, typed into the nutrition panel. Left out,
   * the entry carries no macros at all and every chart reads it as "logged,
   * nothing computable", so any spec that needs a bar with a HEIGHT has to
   * pass this. With fibre and polyols absent, net carbs come out equal to it.
   */
  carbs?: string;
  /** The meal slot to pick, or left out for "no meal". */
  mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  /** A back-dated `YYYY-MM-DD` day to log onto, or left out for today. */
  date?: string;
}

/**
 * Logs one food through `/add`'s manual form and waits for the diary.
 *
 * THE MANUAL FORM, not the search: the search asks this app's server, which
 * asks the food database over the network, and a smoke tier must not go red
 * because somebody else's service was slow.
 *
 * The nutrition panel is a collapsible. Its fields are `forceMount`ed, so they
 * are in the DOM while it is closed, but they are `display:none` and cannot be
 * typed into, which is why `carbs` opens it first rather than filling through
 * the fold. The meal picker is a Radix `<Select>` rather than a `<select>`, so
 * it is opened and its row clicked, never assigned to.
 *
 * @param page - a page on a device that is past onboarding.
 * @param food - what to type, and optionally which meal and which day.
 */
export async function logFoodManually(page: Page, food: ManualFood): Promise<void> {
  await page.goto(food.date === undefined ? '/add' : `/add?date=${food.date}`);
  await page.getByRole('button', { name: EN.add.search.addManually }).click();

  const manual = page.locator('form').filter({ has: page.locator('input[name="_intent"][value="manual"]') });
  await manual.locator('input[name="name"]').fill(food.name);
  await manual.locator('input[name="quantityGrams"]').fill(food.grams);
  if (food.carbs !== undefined) {
    await manual.getByRole('button', { name: EN.add.manual.nutritionToggle }).click();
    await manual.locator('input[name="carbs"]').fill(food.carbs);
  }
  if (food.mealType !== undefined) {
    await manual.getByRole('combobox').click();
    await page.getByRole('option', { name: EN.add.meal[food.mealType], exact: true }).click();
  }
  await manual.getByRole('button', { name: EN.add.manual.submit }).click();

  await page.waitForURL('**/diary**');
  // Inside `main`, so the header's own "Added <name>" status line is not what
  // is being read back: everything under `main` is rendered from the local
  // store, so a match there is evidence the write landed. `.first()` because
  // the diary also offers the same food as a quick-add chip once it is known.
  await expect(page.locator('main').getByText(food.name).first()).toBeVisible();
}

/**
 * The two numbers that say the page still fits the phone it is drawn on.
 *
 * `scrollWidth` on the DOCUMENT ELEMENT, not on a container, because the
 * document IS this app's scroll container: anything wider than the viewport
 * shows up here and nowhere else. The header is checked in the same breath
 * because its fixed height is the promise the status channel is allowed to
 * write into.
 *
 * @param page - the page to measure.
 */
export async function expectPhoneLayout(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(PHONE_WIDTH);

  const header = page.locator('header').first();
  await expect(header).toBeVisible();
  const box = await header.boundingBox();
  expect(box, 'the header must have a box to measure').not.toBeNull();
  expect(Math.round(box?.height ?? 0)).toBe(HEADER_HEIGHT);
}

/** The header's status line, or `''` when nothing is being said. */
export async function headerStatusText(page: Page): Promise<string> {
  const output = page.locator('[data-slot="header-status"] output');
  if ((await output.count()) === 0) return '';
  return (await output.first().innerText()).trim();
}

/**
 * Whether the status line has room for every line it is drawing.
 *
 * The status row wraps rather than truncating (M225), so a sentence too long
 * for the header does not overflow the document, it CLIPS inside its own span
 * and the clipping is invisible in a screenshot. This is the read that sees it.
 *
 * @param page - the page whose header is showing a status.
 * @returns true when nothing is cut off.
 */
export async function isHeaderStatusFullyVisible(page: Page): Promise<boolean> {
  const span = page.locator('[data-slot="header-status"] output span span').first();
  return span.evaluate((element) => element.scrollHeight <= element.clientHeight);
}

////////////////////////////////////////////////////////////////////////////////
// The pantry's rows, on screen and on disk
////////////////////////////////////////////////////////////////////////////////

/** Every editable pantry row on screen, review form or stored list: they are one component. */
export function pantryRows(page: Page): Locator {
  return page.locator('main input[id^="pantry-name-"]');
}

/**
 * What those rows are named, in the order they are drawn.
 *
 * @param page - a page showing `/pantry`.
 * @returns one name per row.
 */
export async function pantryRowNames(page: Page): Promise<string[]> {
  // SAFETY: the locator selects `input` elements by id prefix, and an input is
  // the only element in the DOM that carries a `value` property.
  return pantryRows(page).evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value));
}

/**
 * How many pantry rows are ON DISK, read straight out of IndexedDB.
 *
 * A WAIT, NEVER AN ASSERTION. The store writes through TinyBase, whose
 * persister saves asynchronously after the transaction that changed it
 * (`app/lib/local-store/persist.ts` documents the window at length), so a
 * reload fired the instant the screen updates can beat the save and lose the
 * write for real. Polling this before a reload is how a walk waits for the
 * save it is about to check. What the pantry then holds is asserted on the
 * reloaded PAGE, through the app's own read, so this probe can never stand in
 * for the thing under test.
 *
 * @param page - a page on the app's origin.
 * @returns the number of rows the persisted `pantryItems` table holds.
 */
export async function pantryRowsOnDisk(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        // The database and object store `persist.ts` names: `openplate-primary`,
        // and TinyBase's own tables store `t`, one record per table.
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('t')) {
            db.close();
            resolve(0);
            return;
          }
          const read = db.transaction('t', 'readonly').objectStore('t').get('pantryItems');
          read.addEventListener('success', () => {
            db.close();
            // SAFETY: TinyBase's IndexedDB persister stores one record per
            // table as `{ k, v }`, with `v` an object keyed by row id. An
            // absent record is a table nothing has saved yet.
            const record = read.result as { v?: object } | undefined;
            resolve(Object.keys(record?.v ?? {}).length);
          });
          read.addEventListener('error', () => {
            db.close();
            reject(new Error('the pantry table could not be read'));
          });
        });
      }),
  );
}
