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
 *
 * The weight file (M254/06) is built in the test, around the day onboarding
 * wrote the person's own weigh-in on, because that day is today and a static
 * fixture cannot know it.
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { formatContentDate } from '../../app/lib/content/format-content-date';
import { completeOnboarding, expectPhoneLayout, headerStatusText, logFoodManually } from './helpers';
import { EN, fill } from './copy';
import { installShiftObserver, readShiftEntries, settleFrames } from './layout-shift';

/** The id the section carries (`yazio-import-section.tsx`); the component module loads JSON catalogs this runner cannot. */
const SECTION = '#import-yazio';

const DAYS_FILE = resolve(process.cwd(), 'tests/fixtures/yazio/days.json');
const PRODUCTS_FILE = resolve(process.cwd(), 'tests/fixtures/yazio/products.json');

/** The fixture's first day, and what it holds: oats, milk, rice, lentil soup. */
const FIRST_DAY = '2026-09-01';
const ENTRIES_ON_FIRST_DAY = 4;

/** The weight file's name in a pick; the importer sorts by content, so it is never read. */
const WEIGHT_FILE_NAME = 'weight.json';

/** The no-break space `formatMeasureIn` puts between a number and its unit. */
const UNIT_SPACE = '\u00a0';

/** One stored row as the disk holds it, only the fields this walk reads. */
interface StoredRow {
  id: string;
  createdAt: number;
  dayKey: string;
  /** Weight entries only; 0 on a food log. */
  weightKg: number;
}

/** The two primary-store tables this walk reads, by the names `schema.ts` gives them. */
type StoredTable = 'foodLogs' | 'weightEntries';

/** The newest `createdAt` on disk, 0 for an empty table. */
async function newestStampOnDisk(page: Page): Promise<number> {
  return Math.max(0, ...(await foodLogsOnDisk(page)).map((log) => log.createdAt));
}

/** Every food log ON DISK, see {@link rowsOnDisk}. */
async function foodLogsOnDisk(page: Page): Promise<StoredRow[]> {
  return rowsOnDisk(page, 'foodLogs');
}

/** Every weigh-in ON DISK, see {@link rowsOnDisk}. */
async function weighInsOnDisk(page: Page): Promise<StoredRow[]> {
  return rowsOnDisk(page, 'weightEntries');
}

/**
 * Every row of one primary-store table ON DISK, read straight out of IndexedDB.
 *
 * A WAIT, NEVER THE ASSERTION, for the reason `pantryRowsOnDisk` in
 * `helpers.ts` gives: TinyBase saves after the render, and a document load
 * fired first can lose the write. What the diary shows is asserted on the
 * loaded page.
 *
 * @param page - a page on the app's origin.
 * @param table - the table to read.
 * @returns the fields of {@link StoredRow} for every stored row.
 */
async function rowsOnDisk(page: Page, table: StoredTable): Promise<StoredRow[]> {
  return page.evaluate(
    (tableKey) =>
      new Promise<StoredRow[]>((done, reject) => {
        // `openplate-primary`, TinyBase's tables store `t`, one record per
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
          const read = db.transaction('t', 'readonly').objectStore('t').get(tableKey);
          read.addEventListener('success', () => {
            db.close();
            // SAFETY: TinyBase's IndexedDB persister stores one record per table
            // as `{ k, v }`, `v` keyed by row id, and the primary store writes
            // each row as `JSON.stringify` of its entity into the `entity` cell.
            const record = read.result as { v?: Record<string, { entity?: string }> } | undefined;
            const rows = Object.values(record?.v ?? {}).map((row) => {
              // SAFETY: see above; both tables' rows carry `id`, `createdAt` and `dayKey`, a weigh-in `weightKg`.
              const entity = JSON.parse(row.entity ?? '{}') as Partial<StoredRow>;
              return {
                id: entity.id ?? '',
                createdAt: entity.createdAt ?? 0,
                dayKey: entity.dayKey ?? '',
                weightKg: entity.weightKg ?? 0,
              };
            });
            done(rows);
          });
          read.addEventListener('error', () => {
            db.close();
            reject(new Error(`the ${tableKey} table could not be read`));
          });
        });
      }),
    table,
  );
}

/**
 * The keys of the delete journal ON DISK (M225, `deletedEntities`), each
 * `<entity type>:<id>`. Sync may only tombstone a row this names, so a key
 * here is the proof a removal will reach the person's other devices.
 */
async function journalKeysOnDisk(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((done, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const read = db.transaction('t', 'readonly').objectStore('t').get('deletedEntities');
          read.addEventListener('success', () => {
            db.close();
            // SAFETY: the same `{ k, v }` record as above, `v` keyed by row id.
            const record = read.result as { v?: Record<string, { deletedAt?: number }> } | undefined;
            done(Object.keys(record?.v ?? {}));
          });
          read.addEventListener('error', () => {
            db.close();
            reject(new Error('the deletedEntities table could not be read'));
          });
        });
      }),
  );
}

/** `dayKey` moved by `days` calendar days, in plain date arithmetic. */
function shiftDay(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * A `weight.json` the way the exporter writes it, around `ownDay`, the day
 * that already holds the person's own weigh-in:
 *
 * - six days before: 81.2, the first weigh-in; five days before: 81.2 again, a repeat;
 * - four days before: 80.6; three days before: 80.6 again, a repeat;
 * - two days before: 999, not a weight in kilograms, skipped;
 * - the day before: 79.4;
 * - `ownDay`: 79, a new value, but the day already holds a weigh-in.
 *
 * So the import writes 3 weigh-ins, 81.2 to 79.4 kg, skips 1 value and 1 day.
 * With the repeats NOT collapsed it would write 5.
 */
function weightFileAround(ownDay: string) {
  return {
    [shiftDay(ownDay, -6)]: 81.2,
    [shiftDay(ownDay, -5)]: 81.2,
    [shiftDay(ownDay, -4)]: 80.6,
    [shiftDay(ownDay, -3)]: 80.6,
    [shiftDay(ownDay, -2)]: 999,
    [shiftDay(ownDay, -1)]: 79.4,
    [ownDay]: 79,
  };
}

/** The ids the import gives the weigh-ins of {@link weightFileAround}, oldest first. */
function importedWeighInIds(ownDay: string): string[] {
  return [-6, -4, -1].map((days) => `yazio-weight-${shiftDay(ownDay, days)}`);
}

/** A fixture file as a pick payload. */
function fixtureFile(path: string) {
  return { name: basename(path), mimeType: 'application/json', buffer: readFileSync(path) };
}

/**
 * The two fixture files and a weight file built in the test, in one pick.
 * Playwright takes either paths or payloads in one call, never both, so the
 * fixtures travel as payloads too.
 */
function pickWithWeight(weight: ReturnType<typeof weightFileAround>) {
  const weightFile = {
    name: WEIGHT_FILE_NAME,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(weight)),
  };
  return [fixtureFile(DAYS_FILE), fixtureFile(PRODUCTS_FILE), weightFile];
}

/**
 * Goes through onboarding with a weigh-in, and returns that weigh-in as the
 * disk holds it. Waits for the disk, for the reason {@link rowsOnDisk} gives.
 */
async function onboardWithOwnWeighIn(page: Page): Promise<StoredRow> {
  await completeOnboarding(page, { current: '84', target: '78' });
  await expect.poll(async () => (await weighInsOnDisk(page)).length).toBe(1);
  const [own] = await weighInsOnDisk(page);
  if (own === undefined) throw new Error('onboarding wrote no weigh-in');
  return own;
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

test('weight.json brings the weigh-ins over, repeats collapsed, and never overwrites a day of your own (M254/06)', async ({
  page,
}) => {
  const own = await onboardWithOwnWeighIn(page);
  expect(own.weightKg).toBe(84);

  await page.goto('/settings/data');
  const section = page.locator(SECTION);
  await expect(section).toBeVisible();
  await section.locator('[data-slot="yazio-file-input"]').setInputFiles(pickWithWeight(weightFileAround(own.dayKey)));

  // ── The preview names the weigh-ins, their range, and both kinds of skip ─
  const preview = section.locator('[data-slot="yazio-preview"]');
  await expect(preview.locator('[data-slot="yazio-entry-count"]')).toHaveText('8');
  // THE COLLAPSE: seven days in the file, three weigh-ins. Uncollapsed it reads 5.
  await expect(preview.locator('[data-slot="yazio-weigh-in-count"]')).toHaveText('3');
  await expect(preview.locator('[data-slot="yazio-weight-range"]')).toHaveText(
    fill(EN.settings.data.yazio.preview.weightRangeValue, {
      first: `81.2${UNIT_SPACE}kg`,
      last: `79.4${UNIT_SPACE}kg`,
    }),
  );
  await expect(preview.locator('[data-slot="yazio-weight-skipped"]')).toHaveText(
    fill(EN.settings.data.yazio.skipped.implausibleWeight_one, { count: '1' }),
  );
  await expect(preview.locator('[data-slot="yazio-weight-already-logged"]')).toHaveText(
    fill(EN.settings.data.yazio.skipped.weightAlreadyLogged_one, { count: '1' }),
  );
  await expectPhoneLayout(page);
  // Nothing is written before confirm: the weight log still holds only your own.
  expect((await weighInsOnDisk(page)).map((row) => row.id)).toEqual([own.id]);

  // ── Confirm ──────────────────────────────────────────────────────────────
  await preview.getByRole('button', { name: EN.settings.data.yazio.confirm }).click();
  await expect
    .poll(() => headerStatusText(page))
    .toBe(
      `${fill(EN.settings.data.yazio.success_other, { count: '8' })} ${fill(EN.settings.data.yazio.successWeighIns_other, { count: '3' })}`,
    );
  await expect.poll(async () => (await weighInsOnDisk(page)).length).toBe(4);

  // ── The weight log: the three collapsed weigh-ins and your own, untouched ─
  const weighIns = (await weighInsOnDisk(page)).toSorted((a, b) => a.dayKey.localeCompare(b.dayKey));
  expect(weighIns.map((row) => [row.id, row.dayKey, row.weightKg])).toEqual([
    [importedWeighInIds(own.dayKey)[0], shiftDay(own.dayKey, -6), 81.2],
    [importedWeighInIds(own.dayKey)[1], shiftDay(own.dayKey, -4), 80.6],
    [importedWeighInIds(own.dayKey)[2], shiftDay(own.dayKey, -1), 79.4],
    // CONTROL: YAZIO said 79 on this day; your 84 stays, under its own id and stamp.
    [own.id, own.dayKey, 84],
  ]);
  expect(weighIns.at(-1)).toEqual(own);
});

test('"Remove YAZIO entries" takes the import back and leaves your own entries, with no layout shift (M254/05)', async ({
  page,
}) => {
  await installShiftObserver(page);
  // Every frame of a load of the data page, the tops of the blocks above
  // where the remove section appears, and its own top once it is there.
  // oxlint-disable unicorn/consistent-function-scoping
  await page.addInitScript(() => {
    if (location.pathname !== '/settings/data') return;
    const frames: (number | null)[][] = [];
    Object.defineProperty(window, '__yazioRemoveFrames', { value: frames });
    // The photo card by its own switch, never by position: `#your-data + *`
    // would become the remove section itself if it were ever placed there.
    const selectors = ['#your-data', '#save-plate-photos', '#remove-yazio'];
    const readTop = (selector: string): number | null => {
      const element = document.querySelector(selector);
      return element === null ? null : element.getBoundingClientRect().top + window.scrollY;
    };
    const record = (): void => {
      frames.push(selectors.map(readTop));
      if (frames.length < 600) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  // oxlint-enable unicorn/consistent-function-scoping

  const own = await onboardWithOwnWeighIn(page);
  // One food of your own on the first fixture day.
  await logFoodManually(page, { name: 'Own breakfast eggs', grams: '120', mealType: 'breakfast', date: FIRST_DAY });
  await expect.poll(async () => (await foodLogsOnDisk(page)).length).toBe(1);
  const [ownLog] = await foodLogsOnDisk(page);

  // ── Import foods and weigh-ins; the section appears on the same page ────
  await page.goto('/settings/data');
  const section = page.locator(SECTION);
  await expect(section).toBeVisible();
  const removeSection = page.locator('#remove-yazio');
  await section.locator('[data-slot="yazio-file-input"]').setInputFiles(pickWithWeight(weightFileAround(own.dayKey)));
  await section.getByRole('button', { name: EN.settings.data.yazio.confirm }).click();
  await expect(removeSection.locator('[data-slot="yazio-remove-entry-count"]')).toHaveText('8');
  await expect(removeSection.locator('[data-slot="yazio-remove-weigh-in-count"]')).toHaveText('3');
  await expect.poll(async () => (await foodLogsOnDisk(page)).length).toBe(9);
  await expect.poll(async () => (await weighInsOnDisk(page)).length).toBe(4);

  // ── A fresh load: the section arrives after the store read, and moves nothing ─
  await page.goto('/settings/data');
  await expect(removeSection).toBeVisible();
  await settleFrames(page);
  const frames = await page.evaluate(() => {
    const recorded: unknown = Object.getOwnPropertyDescriptor(window, '__yazioRemoveFrames')?.value;
    // SAFETY: the init script above is the one writer, one `(number | null)[]` per frame.
    return (Array.isArray(recorded) ? recorded : []) as (number | null)[][];
  });
  // EVERY FRAME, not one reading before and one after. The section can land in
  // the same frame as the page's first paint or several frames later, which
  // depends on how fast the store answers; either way, from the frame the two
  // cards are first drawn to the last, neither may move.
  const drawnAt = frames.findIndex((frame) => frame[0] !== null && frame[1] !== null);
  const arrivedAt = frames.findIndex((frame) => frame[2] !== null);
  const firstDrawn = frames[drawnAt]?.slice(0, 2);
  expect(drawnAt, 'the two cards above the section are drawn').toBeGreaterThanOrEqual(0);
  expect(arrivedAt, 'the section never arrives before the cards above it').toBeGreaterThanOrEqual(drawnAt);
  const moves = frames
    .slice(drawnAt)
    .map((frame, index) => ({ frame: drawnAt + index, tops: frame.slice(0, 2) }))
    .filter(({ tops }) => tops[0] !== firstDrawn?.[0] || tops[1] !== firstDrawn?.[1]);
  expect(
    moves,
    `nothing above the section moves (first drawn at ${JSON.stringify(firstDrawn)}, section arrived at frame ${arrivedAt - drawnAt} after them)`,
  ).toEqual([]);
  // CONTROL for the reading: the section itself sits BELOW the photo card.
  const last = frames.at(-1);
  expect(last?.[2] ?? 0).toBeGreaterThan(last?.[1] ?? Number.POSITIVE_INFINITY);
  const shifts = await readShiftEntries(page);
  expect(
    shifts.reduce((sum, entry) => sum + entry.value, 0),
    `layout shifts on load: ${JSON.stringify(shifts.flatMap((entry) => entry.sources))}`,
  ).toBe(0);
  await expectPhoneLayout(page);

  // ── Remove, through the confirm step ───────────────────────────────────
  await removeSection.locator('[data-slot="yazio-remove"]').click();
  await page.locator('[data-slot="yazio-remove-confirm"]').click();
  await expect.poll(() => headerStatusText(page)).toBe(EN.settings.data.yazio.remove.success);
  // Anchored: the section was visible above, so its absence is the removal's doing.
  await expect(removeSection).toHaveCount(0);

  // Only your own rows are left, and every removed row is in the delete journal.
  await expect.poll(async () => (await foodLogsOnDisk(page)).map((row) => row.id)).toEqual([ownLog?.id]);
  await expect.poll(async () => (await weighInsOnDisk(page)).map((row) => row.id)).toEqual([own.id]);
  const journal = await journalKeysOnDisk(page);
  expect(journal.filter((key) => key.startsWith('foodLog:yazio-'))).toHaveLength(8);
  expect(journal.filter((key) => key.startsWith('weightEntry:yazio-weight-'))).toHaveLength(3);
  // CONTROL: your own rows were not journalled, so sync will not remove them anywhere.
  expect(journal).not.toContain(`foodLog:${ownLog?.id}`);
  expect(journal).not.toContain(`weightEntry:${own.id}`);

  // ── The diary on the first fixture day shows only your own entry ────────
  await page.goto(`/diary?date=${FIRST_DAY}`);
  await expect(page.locator('main').getByText('Own breakfast eggs')).toBeVisible();
  await expect(entryCards(page)).toHaveCount(1);
  await expect(page.locator('main').getByText('Rolled Oats')).toHaveCount(0);

  // ── And the section stays away on a fresh load ─────────────────────────
  await page.goto('/settings/data');
  await expect(section).toBeVisible();
  await settleFrames(page);
  await expect(removeSection).toHaveCount(0);
});

test('a weigh-in you log on an imported day is yours, and "Remove YAZIO entries" leaves it (M254/05)', async ({
  page,
}) => {
  // No weigh-in at onboarding: today then holds only the imported one.
  await completeOnboarding(page);
  // The day the app logs a weigh-in on. The profile has no zone set, so the
  // app reads the browser's, the same one this reads.
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const importedTodayId = `yazio-weight-${today}`;

  await page.goto('/settings/data');
  const section = page.locator(SECTION);
  await expect(section).toBeVisible();
  await section.locator('[data-slot="yazio-file-input"]').setInputFiles(pickWithWeight(weightFileAround(today)));
  // Nothing of your own on any day: the day the file gives 79 lands too.
  await expect(section.locator('[data-slot="yazio-weigh-in-count"]')).toHaveText('4');
  await section.getByRole('button', { name: EN.settings.data.yazio.confirm }).click();
  await expect.poll(async () => (await weighInsOnDisk(page)).map((row) => row.id)).toContain(importedTodayId);

  // ── Your own weigh-in for today, through the profile page's weight form ──
  await page.goto('/settings/profile');
  // Found by its intent, a contract with the route action, never by its label.
  const weightForm = page.locator('form').filter({ has: page.locator('input[name="_intent"][value="log-weight"]') });
  await weightForm.locator('input[inputmode="decimal"]').fill('77.5');
  await weightForm.locator('button[type="submit"]').click();
  await expect.poll(async () => (await weighInsOnDisk(page)).find((row) => row.dayKey === today)?.weightKg).toBe(77.5);
  const ownToday = (await weighInsOnDisk(page)).find((row) => row.dayKey === today);
  // Your measurement has an id of its own, and the imported row it replaced is journalled.
  expect(ownToday?.id).not.toBe(importedTodayId);
  expect(ownToday?.id.startsWith('yazio-')).toBe(false);
  expect(await journalKeysOnDisk(page)).toContain(`weightEntry:${importedTodayId}`);

  // ── The remove section no longer counts it ─────────────────────────────
  await page.goto('/settings/data');
  const removeSection = page.locator('#remove-yazio');
  await expect(removeSection.locator('[data-slot="yazio-remove-weigh-in-count"]')).toHaveText('3');
  await removeSection.locator('[data-slot="yazio-remove"]').click();
  await page.locator('[data-slot="yazio-remove-confirm"]').click();
  await expect.poll(() => headerStatusText(page)).toBe(EN.settings.data.yazio.remove.success);
  await expect(removeSection).toHaveCount(0);

  // Only your own weigh-in is left, with the value you typed.
  await expect
    .poll(async () => (await weighInsOnDisk(page)).map((row) => [row.id, row.dayKey, row.weightKg]))
    .toEqual([[ownToday?.id, today, 77.5]]);
});
