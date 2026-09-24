/**
 * A YAZIO export, picked on "Data & backup", lands in the diary (M254/02).
 *
 * The two files are the synthetic fixtures in `tests/fixtures/yazio/`, whose
 * numbers `tests/unit/yazio-import.test.ts` works out by hand: 8 entries on 3
 * days, "Rolled Oats" at breakfast on 2026-09-01, 4 entries on that day.
 *
 * WHY THE SECOND IMPORT WAITS FOR A NEW `createdAt`. The ids are derived from
 * YAZIO's, so a second import writes the same rows again and the count cannot
 * grow. A count that stays the same would also stay the same if the second
 * import wrote nothing at all. Every import stamps `createdAt` with its own
 * clock, so the stamp changing on disk is the proof the second write landed,
 * and only then is the unchanged count worth anything.
 */
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { formatContentDate } from '../../app/lib/content/format-content-date';
import { completeOnboarding, expectPhoneLayout, headerStatusText, logFoodManually } from './helpers';
import { EN, fill } from './copy';

/** The id the section carries (`yazio-import-section.tsx`); the component module loads JSON catalogs this runner cannot. */
const SECTION = '#import-yazio';

const DAYS_FILE = resolve(process.cwd(), 'tests/fixtures/yazio/days.json');
const PRODUCTS_FILE = resolve(process.cwd(), 'tests/fixtures/yazio/products.json');

/** The fixture's first day, and what it holds: oats, milk, rice, lentil soup. */
const FIRST_DAY = '2026-09-01';
const ENTRIES_ON_FIRST_DAY = 4;

/** One imported row as the disk holds it, only the two fields this walk reads. */
interface StoredLog {
  id: string;
  createdAt: number;
}

/** The newest `createdAt` on disk, 0 for an empty table. */
async function newestStampOnDisk(page: Page): Promise<number> {
  return Math.max(0, ...(await foodLogsOnDisk(page)).map((log) => log.createdAt));
}

/**
 * Every food log ON DISK, read straight out of IndexedDB.
 *
 * A WAIT, NEVER THE ASSERTION, for the reason `pantryRowsOnDisk` in
 * `helpers.ts` gives: TinyBase saves after the render, and a document load
 * fired first can lose the write. What the diary shows is asserted on the
 * loaded page.
 *
 * @param page - a page on the app's origin.
 * @returns id and `createdAt` of every stored food log.
 */
async function foodLogsOnDisk(page: Page): Promise<StoredLog[]> {
  return page.evaluate(
    () =>
      new Promise<StoredLog[]>((done, reject) => {
        // `openplate-primary`, TinyBase's tables store `t`, the `foodLogs`
        // table, one `entity` cell per row: the names `persist.ts` and
        // `schema.ts` give.
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('t')) {
            db.close();
            done([]);
            return;
          }
          const read = db.transaction('t', 'readonly').objectStore('t').get('foodLogs');
          read.addEventListener('success', () => {
            db.close();
            // SAFETY: TinyBase's IndexedDB persister stores one record per table
            // as `{ k, v }`, `v` keyed by row id, and the primary store writes
            // each row as `JSON.stringify` of its entity into the `entity` cell.
            const record = read.result as { v?: Record<string, { entity?: string }> } | undefined;
            const rows = Object.values(record?.v ?? {}).map((row) => {
              // SAFETY: see above; a food log carries `id` and `createdAt`.
              const log = JSON.parse(row.entity ?? '{}') as Partial<StoredLog>;
              return { id: log.id ?? '', createdAt: log.createdAt ?? 0 };
            });
            done(rows);
          });
          read.addEventListener('error', () => {
            db.close();
            reject(new Error('the foodLogs table could not be read'));
          });
        });
      }),
  );
}

/** The document top of an element, so a scroll is not read as a move. */
async function documentTop(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
}

/** Every entry card the diary draws for the day it shows. */
function entryCards(page: Page) {
  return page.locator('main a[href^="/diary/entry/"]');
}

test('a YAZIO export previews, imports into the right day and meal, and imports again without duplicates', async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.goto('/settings/data');
  const section = page.locator(SECTION);
  await expect(section).toBeVisible();
  const input = section.locator('[data-slot="yazio-file-input"]');

  // ── The error line: one file is not enough ───────────────────────────────
  await input.setInputFiles([DAYS_FILE]);
  await expect(section.locator('[data-slot="yazio-error"]')).toHaveText(EN.settings.data.yazio.error.missingProducts);
  await expect(section.locator('[data-slot="yazio-preview"]')).toHaveCount(0);

  // ── The preview, and nothing above the button moves when it opens ────────
  await page.goto('/settings/data');
  await expect(section).toBeVisible();
  const backupTop = await documentTop(page, '#import-backup');
  const sectionTop = await documentTop(page, SECTION);
  // CONTROL: the card below the section. It must move, or the measurement
  // below could not see a move at all.
  const belowSelector = '#your-data + *';
  const belowTop = await documentTop(page, belowSelector);

  await input.setInputFiles([PRODUCTS_FILE, DAYS_FILE]);
  const preview = section.locator('[data-slot="yazio-preview"]');
  await expect(preview).toBeVisible();
  await expect(preview.locator('[data-slot="yazio-entry-count"]')).toHaveText('8');
  await expect(preview.locator('[data-slot="yazio-day-count"]')).toHaveText('3');
  await expect(preview.locator('[data-slot="yazio-first-day"]')).toHaveText(
    formatContentDate({ isoDate: FIRST_DAY, language: 'en' }),
  );
  await expect(preview.locator('[data-slot="yazio-last-day"]')).toHaveText(
    formatContentDate({ isoDate: '2026-09-03', language: 'en' }),
  );
  // One line per skip reason the fixture carries, five of them.
  await expect(preview.locator('[data-slot="yazio-skipped"]')).toHaveCount(5);
  // A fresh diary holds nothing on these days, so there is no overlap line.
  await expect(preview.locator('[data-slot="yazio-overlap"]')).toHaveCount(0);

  expect(await documentTop(page, '#import-backup'), 'the backup import must not move').toBe(backupTop);
  expect(await documentTop(page, SECTION), 'the section itself must not move').toBe(sectionTop);
  expect(await documentTop(page, belowSelector), 'control: the card below must be pushed down').toBeGreaterThan(
    belowTop,
  );
  await expectPhoneLayout(page);

  // NOTHING IS WRITTEN BEFORE CONFIRM. Checked against the disk the confirm
  // below then fills, so the same probe is seen to read 0 and then 8.
  expect(await foodLogsOnDisk(page)).toEqual([]);

  // ── Confirm ──────────────────────────────────────────────────────────────
  await preview.getByRole('button', { name: EN.settings.data.yazio.confirm }).click();
  await expect.poll(() => headerStatusText(page)).toBe(fill(EN.settings.data.yazio.success_other, { count: '8' }));
  await expect(preview).toHaveCount(0);
  await expect.poll(async () => (await foodLogsOnDisk(page)).length).toBe(8);
  const firstStamp = await newestStampOnDisk(page);

  // ── The diary on the first fixture day ───────────────────────────────────
  await page.goto(`/diary?date=${FIRST_DAY}`);
  const breakfast = page.locator('[data-slot="meal-group"][data-meal="breakfast"]');
  await expect(breakfast.getByText('Rolled Oats')).toBeVisible();
  // CONTROL: the same name is not found in a meal it was not eaten at.
  await expect(page.locator('[data-slot="meal-group"][data-meal="lunch"]').getByText('Rolled Oats')).toHaveCount(0);
  await expect(page.locator('[data-slot="meal-group"][data-meal="lunch"]').getByText('Lentil Soup')).toBeVisible();
  await expect(entryCards(page)).toHaveCount(ENTRIES_ON_FIRST_DAY);

  // ── The same files again ─────────────────────────────────────────────────
  await page.goto('/settings/data');
  await expect(section).toBeVisible();
  await input.setInputFiles([DAYS_FILE, PRODUCTS_FILE]);
  await expect(preview.locator('[data-slot="yazio-entry-count"]')).toHaveText('8');
  // The days now hold only the first import's rows, which this one rewrites:
  // still no overlap line.
  await expect(preview.locator('[data-slot="yazio-overlap"]')).toHaveCount(0);
  await preview.getByRole('button', { name: EN.settings.data.yazio.confirm }).click();
  await expect.poll(() => headerStatusText(page)).toBe(fill(EN.settings.data.yazio.success_other, { count: '8' }));
  // The second write reached disk: a row carries the second import's stamp.
  // Every row of one import lands in the same coalesced save.
  await expect.poll(() => newestStampOnDisk(page)).toBeGreaterThan(firstStamp);
  expect((await foodLogsOnDisk(page)).length, 'a second import must not add rows').toBe(8);

  await page.goto(`/diary?date=${FIRST_DAY}`);
  await expect(breakfast.getByText('Rolled Oats')).toBeVisible();
  await expect(entryCards(page)).toHaveCount(ENTRIES_ON_FIRST_DAY);
});

test('a fixture day that already holds an entry of your own is named in the preview (M254/04)', async ({ page }) => {
  await completeOnboarding(page);
  // THE CONTROL FIRST: the same device, before it holds anything, shows no line.
  await page.goto('/settings/data');
  const section = page.locator(SECTION);
  await expect(section).toBeVisible();
  const input = section.locator('[data-slot="yazio-file-input"]');
  const preview = section.locator('[data-slot="yazio-preview"]');
  await input.setInputFiles([DAYS_FILE, PRODUCTS_FILE]);
  await expect(preview.locator('[data-slot="yazio-entry-count"]')).toHaveText('8');
  await expect(preview.locator('[data-slot="yazio-overlap"]')).toHaveCount(0);

  // One food of the person's own on the first fixture day, through the real
  // manual form. The page load below would race the save, so wait for the disk.
  await logFoodManually(page, { name: 'Own breakfast eggs', grams: '120', mealType: 'breakfast', date: FIRST_DAY });
  await expect.poll(async () => (await foodLogsOnDisk(page)).length).toBe(1);

  await page.goto('/settings/data');
  await expect(section).toBeVisible();
  await input.setInputFiles([DAYS_FILE, PRODUCTS_FILE]);
  await expect(preview.locator('[data-slot="yazio-overlap"]')).toHaveText(
    fill(EN.settings.data.yazio.overlap_one, { count: '1' }),
  );
  await expectPhoneLayout(page);
});
