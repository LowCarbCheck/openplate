/**
 * The backup nudge, and the one thing it must never say.
 *
 * ── The defect this file encodes ─────────────────────────────────────────
 *
 * The banner says "Your diary only lives here: one device, no cloud." The
 * decision behind it (`shouldShowBackupNudge`) read three numbers about this
 * device and never asked whether a server already holds a copy. So a person
 * who had signed in to sync was told their diary had no copy anywhere, by the
 * app that was copying it.
 *
 * ── What is real here and what is stubbed ────────────────────────────────
 *
 * REAL: the device, onboarding, one hand-typed food, the fixture account, the
 * sign-in, the resume after a full document load, the sync cycle against the
 * fake service, and the sign-out through its own dialog.
 *
 * STUBBED: nothing. One value is written straight to disk, and only one: the
 * instant this device first held data. No sequence of clicks can reach "this
 * diary is three weeks old" inside a test that started two minutes ago, so
 * that marker is back-dated and then read back through a document that loaded
 * after it was written.
 *
 * ── Which instance this runs on ──────────────────────────────────────────
 *
 * OPEN. `playwright.config.ts` starts the production server with no
 * `INSTANCE_MODE`, which `parseInstanceMode` reads as `open`, so every walk
 * below is an open instance with sync configured. The managed rule, where the
 * account keeps a copy whether or not this device has a session, cannot be
 * driven here without a second app server on a fourth port, and this tier
 * takes exactly three (ADR-0017). It is covered in `tests/unit/backup-nudge.test.ts`,
 * which renders the banner under both policies.
 *
 * ── Why a mutation observer and not a count ──────────────────────────────
 *
 * `toHaveCount(0)` says the banner is absent NOW. The rule under test is
 * stronger: on a device that is reopening a session, the banner must never be
 * drawn at all, not drawn and then withdrawn. A withdrawal is one or two
 * frames of a false sentence, which no screenshot and no count can see. So a
 * probe installed before any page script records whether the banner ever
 * reached the document, and the control for it is the signed-out load, where
 * the same probe must answer `true`.
 */
import { expect, test, type Page } from '@playwright/test';

import { BACKUP_NUDGE_THRESHOLD_DAYS } from '#app/lib/backup-nudge';
import { HAD_DATA_MARKER_VALUE, LAST_EXPORT_VALUE } from '#app/lib/local-store/schema';
import { SYNC_API_PREFIX } from '#app/lib/sync/engine/protocol';

import { E2E_ACCOUNT_EMAIL, E2E_SYNC_SERVER_URL } from './env';
import { EN } from './copy';
import { completeOnboarding, logFoodManually, signInFixtureAccount } from './helpers';

/** The entry that gives this device something worth backing up. */
const FOOD_NAME = 'Backup nudge smoke tier stew';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Comfortably past the threshold, so a rounding difference can never decide this spec. */
const FIRST_DATA_AT = Date.now() - (BACKUP_NUDGE_THRESHOLD_DAYS + 6) * DAY_MS;

/** Where a sync cycle pulls from. Its answer is the proof that a session was reopened. */
const BLOB_URL = `${E2E_SYNC_SERVER_URL}${SYNC_API_PREFIX}/blob`;

/** What the flash probe leaves on the page for this spec to read back. */
interface BackupNudgeProbe {
  everSeen: boolean;
}

declare global {
  interface Window {
    openplateBackupNudgeProbe?: BackupNudgeProbe;
  }
}

/** The banner itself, wherever it is mounted. */
function banner(page: Page) {
  return page.locator('[data-slot="backup-nudge"]');
}

/**
 * Installs the probe that records whether the banner EVER reached the
 * document, on this document load and every later one.
 *
 * It runs before any page script, so a banner drawn in the first render and
 * removed in the next is still recorded. The flag lives on the page, so each
 * document load starts it again at `false` and one install covers the whole
 * walk.
 *
 * @param page - the page whose future documents are watched.
 */
async function watchForTheBanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = { everSeen: false };
    window.openplateBackupNudgeProbe = probe;
    const look = (): void => {
      if (document.querySelector('[data-slot="backup-nudge"]') !== null) probe.everSeen = true;
    };
    new MutationObserver(look).observe(document, { childList: true, subtree: true });
  });
}

/**
 * Whether the banner reached this document at any point.
 *
 * Throws rather than answering `false` when the probe is missing: a probe that
 * never ran would otherwise read as "the banner was never drawn", which is an
 * assertion that cannot fail.
 *
 * @param page - a page on the app's origin.
 */
async function bannerEverAppeared(page: Page): Promise<boolean> {
  const seen = await page.evaluate(() => window.openplateBackupNudgeProbe?.everSeen ?? null);
  if (seen === null) throw new Error('the flash probe did not run on this document');
  return seen;
}

/**
 * One primary-store VALUE, read straight out of IndexedDB.
 *
 * The layout TinyBase's persister writes, the same one `helpers.ts` reads
 * tables through: database `openplate-primary`, one record per value in the
 * values store `v`, `{ k: <valueId>, v: <value> }`. Both markers this spec
 * cares about live there rather than in a table, which is why they survive a
 * tables wipe (`had-data.ts`).
 *
 * @param page - a page on the app's origin, on a device that has a store.
 * @param key - the value id.
 * @returns the number stored, or `null` when nothing is stored for the key.
 */
async function storeValueOnDisk(page: Page, key: string): Promise<number | null> {
  return page.evaluate(
    (valueId) =>
      new Promise<number | null>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('v')) {
            db.close();
            resolve(null);
            return;
          }
          const read = db.transaction('v', 'readonly').objectStore('v').get(valueId);
          read.addEventListener('error', () => {
            db.close();
            reject(new Error('the values store could not be read'));
          });
          read.addEventListener('success', () => {
            db.close();
            // SAFETY: the persister stores one record per value as `{ k, v }`,
            // and both markers this spec reads are written as epoch-ms numbers.
            const record = read.result as { v?: number } | undefined;
            resolve(Number.isFinite(record?.v) ? (record?.v ?? null) : null);
          });
        });
      }),
    key,
  );
}

/**
 * Back-dates the instant this device first held data.
 *
 * Written to disk and not through the app, because the app has no way to say
 * it: `markDeviceHasData` stamps the marker once, on the first profile or food
 * write, and never moves it again. The write is followed immediately by a
 * document load, and the seed is read back afterwards, so a store that saved
 * over it fails the spec instead of quietly making the walk describe a
 * two-minute-old device.
 *
 * @param page - a page on the app's origin, on a device past onboarding.
 * @param at - the epoch milliseconds to stamp instead.
 */
async function backdateFirstData(page: Page, at: number): Promise<void> {
  await page.evaluate(
    (stamp) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const write = db.transaction('v', 'readwrite').objectStore('v').put({ k: stamp.key, v: stamp.at });
          write.addEventListener('error', () => {
            db.close();
            reject(new Error('the first-data marker could not be written'));
          });
          write.addEventListener('success', () => {
            db.close();
            resolve();
          });
        });
      }),
    { key: HAD_DATA_MARKER_VALUE, at },
  );
}

/** Two animation frames: the render and the paint a session update would produce. */
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** The diary, loaded and drawn. */
async function openDiary(page: Page): Promise<void> {
  await page.goto('/diary');
  await expect(page.locator('[data-slot="date-nav"]')).toBeVisible();
}

test('the nudge speaks for a device whose only copy is here, and never for one the account holds', async ({ page }) => {
  await watchForTheBanner(page);
  await completeOnboarding(page);
  await logFoodManually(page, { name: FOOD_NAME, grams: '180' });
  await backdateFirstData(page, FIRST_DATA_AT);

  //////////////////////////////////////////////////////////////////////////
  // THE CONTROL. No server holds this diary, so the banner says so. Without
  // it every absence below would pass against a banner that never renders.
  //////////////////////////////////////////////////////////////////////////
  await openDiary(page);
  expect(await storeValueOnDisk(page, HAD_DATA_MARKER_VALUE), 'the back-dated marker must be read back').toBe(
    FIRST_DATA_AT,
  );
  expect(await storeValueOnDisk(page, LAST_EXPORT_VALUE), 'this device has never exported').toBe(null);
  await expect(banner(page), 'a device with an old, un-exported, un-synced diary is nudged').toBeVisible();
  expect(await bannerEverAppeared(page), 'the probe sees the banner it is watching for').toBe(true);

  //////////////////////////////////////////////////////////////////////////
  // THE CLAIM. The same device, the same diary, signed in to sync.
  //////////////////////////////////////////////////////////////////////////
  await signInFixtureAccount(page);

  // Started before the load, because the load is what triggers it. A blob
  // answered on this document proves the resume opened a real session here:
  // a cycle with no vault is a silent no-op and asks for nothing.
  const pulled = page.waitForResponse(
    (response) => response.url().startsWith(BLOB_URL) && response.request().method() === 'GET',
  );
  await openDiary(page);
  await pulled;
  await settleFrames(page);

  // The three numbers the decision used to read are unchanged, so the silence
  // below is about the session and about nothing else.
  expect(await storeValueOnDisk(page, HAD_DATA_MARKER_VALUE), 'the diary is still as old as it was').toBe(
    FIRST_DATA_AT,
  );
  expect(await storeValueOnDisk(page, LAST_EXPORT_VALUE), 'and still never exported').toBe(null);
  await expect(page.locator('main').getByText(FOOD_NAME).first(), 'and still holds the entry').toBeVisible();

  await expect(banner(page), 'a synced device is not told its diary lives on one device').toHaveCount(0);
  expect(await bannerEverAppeared(page), 'and it is never drawn, not even for the frames the resume takes').toBe(false);

  //////////////////////////////////////////////////////////////////////////
  // AND IT COMES BACK. Signing out on an open instance takes nothing away,
  // so the same device is nudged again. This is what proves the silence
  // above was the session rather than something the sign-in wrote.
  //////////////////////////////////////////////////////////////////////////
  await page.goto('/settings/account');
  await expect(page.getByText(E2E_ACCOUNT_EMAIL).first()).toBeVisible();
  await page.locator('button:has(svg.lucide-log-out)').first().click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: EN.signOut.confirm, exact: true }).click();
  // The sign-out ends the document itself (`sign-out-flow.ts`), so leaving the
  // account page is how this knows it finished.
  await page.waitForURL((url) => !url.pathname.startsWith('/settings/account'));

  await openDiary(page);
  expect(await storeValueOnDisk(page, HAD_DATA_MARKER_VALUE), 'the sign-out took nothing away').toBe(FIRST_DATA_AT);
  await expect(banner(page), 'the same device, signed out again, is nudged once more').toBeVisible();
});
