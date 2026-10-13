/**
 * Old diary entries get their vitamins and minerals (the micronutrient
 * backfill, 2026-10-13), on the real page.
 *
 * THE BUG. An entry logged from a LowCarbCheck food before that food had
 * vitamins carries no block, so its day reads "Not enough data" for ever. The
 * entry still names its food (`curatedSource: "lowcarbcheck:<slug>"`), and the
 * background job asks `/api/food-micronutrients` once for that slug.
 *
 * WHAT IS CLAIMED.
 *
 * - An old day of such an entry first reads "Not enough data". Once the route
 *   answers `filled`, the SAME day reads covered, with no navigation, and
 *   NOTHING MOVES: the `layout-shift` total is 0 and every top in `main` is
 *   unchanged, because the block held the covered box open while a fill could
 *   still arrive. CONTROL: one line inserted into the block moves the link
 *   under it and scores a shift, so both readings can see one.
 * - The entry ON DISK is never written: it still has no
 *   `micronutrientsPer100g` key after the fill, and the answer sits in the
 *   device-local ledger instead. CONTROL: the ledger row is there, so the
 *   disk read is not a read of nothing.
 * - A `not-found` answer leaves the day at "Not enough data", and a reload
 *   sends NO second request: the answer is final on the device. CONTROL: an
 *   `unknown` answer is asked again after the same reload and the same wait.
 *
 * The route is stubbed in the browser, so these claims are about the device.
 * The route itself, its guards and its upstream reading are unit-tested in
 * `tests/unit/api-food-micronutrients*.test.ts`.
 *
 * @area diary-and-add
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding, headerStatusText } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
  turnOffScrollAnchoring,
} from './layout-shift';

/** The slug the seeded entry names. */
const SLUG = 'e2e-backfill-huhnerei-roh';
/** The seeded entry's id. */
const ENTRY_ID = 'backfill-old-entry';
/** How many days back the old entry sits. */
const DAYS_BACK = 10;

const VITAMIN_KEYS = [
  'betaCarotene',
  'vitaminA',
  'vitaminC',
  'vitaminD',
  'vitaminE',
  'vitaminB1',
  'vitaminB2',
  'vitaminB6',
  'vitaminB9',
  'vitaminB12',
] as const;
const MINERAL_KEYS = ['nacl', 'potassium', 'sodium', 'calcium', 'magnesium', 'zinc', 'phosphorus', 'iron'] as const;

/** Plentiful per 100 g, so one entry covers every nutrient. Sodium modest, under its limit. */
const PLENTY_PER_100G = 10_000;
const SODIUM_PER_100G = 250;

/** A food's per-100 g figures, in the shape the route sends. */
interface StubBlock {
  vitamins: Record<string, number>;
  minerals: Record<string, number>;
}

/** The block the stubbed route answers with. */
function filledBlock(): StubBlock {
  const minerals: Record<string, number> = Object.fromEntries(MINERAL_KEYS.map((key) => [key, PLENTY_PER_100G]));
  minerals.sodium = SODIUM_PER_100G;
  minerals.nacl = SODIUM_PER_100G * 2.5;
  return { vitamins: Object.fromEntries(VITAMIN_KEYS.map((key) => [key, PLENTY_PER_100G])), minerals };
}

/** One answer kind the stub gives for the slug. */
type StubAnswer = 'filled' | 'not-found' | 'unknown';

function stubBody(answer: StubAnswer): string {
  const outcome = answer === 'filled' ? { kind: 'filled', micronutrientsPer100g: filledBlock() } : { kind: answer };
  return JSON.stringify({ results: [{ slug: SLUG, outcome }] });
}

/** A promise and the call that settles it. */
interface Gate {
  opened: Promise<void>;
  open: () => void;
}

function createGate(): Gate {
  let settle: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { opened, open: () => settle?.() };
}

/** The stubbed route: how many requests reached it, and the slugs each one named. */
interface RouteStub {
  requests: string[][];
}

/** Stubs `/api/food-micronutrients` with one answer, held until `gate` opens when one is given. */
async function stubRoute(page: Page, { answer, gate }: { answer: StubAnswer; gate?: Gate }): Promise<RouteStub> {
  const stub: RouteStub = { requests: [] };
  await page.route(
    (url) => url.pathname === '/api/food-micronutrients',
    async (route) => {
      // SAFETY: the device's own request body, `{ slugs: string[] }`.
      const body = route.request().postDataJSON() as { slugs: string[] };
      stub.requests.push(body.slugs);
      if (gate !== undefined) await gate.opened;
      await route.fulfill({ status: 200, contentType: 'application/json', body: stubBody(answer) });
    },
  );
  return stub;
}

/** Shifts a `YYYY-MM-DD` day by whole days, in UTC, which is safe because the parts are already local. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Writes the one old entry, from a LowCarbCheck food and with NO block, into the primary store on disk. */
async function writeOldEntry(page: Page, dayKey: string): Promise<void> {
  await page.evaluate(
    ({ id, slug, day }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const loggedAt = Date.parse(`${day}T08:00:00Z`);
          const entity = {
            id,
            name: 'Hühnerei, roh',
            quantityGrams: 120,
            macros: { carbs: 1, fiber: 0, sugars: null, polyols: 0, protein: 15, fat: 11, kcal: 165 },
            mealType: 'breakfast',
            source: 'manual',
            aiEstimated: false,
            curatedSource: `lowcarbcheck:${slug}`,
            foodId: null,
            dayKey: day,
            loggedAt,
            createdAt: loggedAt,
            logBatchId: null,
          };
          const transaction = db.transaction('t', 'readwrite');
          transaction.objectStore('t').put({ k: 'foodLogs', v: { [id]: { entity: JSON.stringify(entity) } } });
          transaction.addEventListener('complete', () => {
            db.close();
            resolve();
          });
          transaction.addEventListener('error', () => {
            db.close();
            reject(new Error('the food log could not be written'));
          });
        });
      }),
    { id: ENTRY_ID, slug: SLUG, day: dayKey },
  );
}

/** What is on disk: the old entry's stored JSON, and the ledger's stored row for the slug. */
interface DiskRead {
  entity: string | null;
  ledger: string | null;
}

async function readDisk(page: Page): Promise<DiskRead> {
  return page.evaluate(
    ({ id, slug }) =>
      new Promise<DiskRead>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const store = db.transaction('t', 'readonly').objectStore('t');
          const logs = store.get('foodLogs');
          const ledger = store.get('micronutrientBackfill');
          ledger.addEventListener('success', () => {
            db.close();
            // SAFETY: TinyBase's IndexedDB layout, `{ k: tableId, v: { [rowId]: { [cellId]: value } } }`.
            const logRows = (logs.result as { v?: Record<string, { entity?: string }> } | undefined)?.v;
            // SAFETY: the same layout, for the ledger table.
            const ledgerRows = (ledger.result as { v?: Record<string, { entry?: string }> } | undefined)?.v;
            resolve({ entity: logRows?.[id]?.entity ?? null, ledger: ledgerRows?.[slug]?.entry ?? null });
          });
          ledger.addEventListener('error', () => {
            db.close();
            reject(new Error('the primary database could not be read'));
          });
        });
      }),
    { id: ENTRY_ID, slug: SLUG },
  );
}

/** Saves a year of birth and a sex through the profile form, so the covered block ranks against references. */
async function saveBodyMetrics(page: Page): Promise<void> {
  await page.goto('/settings/profile');
  const form = page.locator('form').filter({ has: page.locator('input[name="_intent"][value="save-body-metrics"]') });
  await form.locator('input[name="birthYear"]').fill('1990');
  await form.getByText(EN.bodyMetrics.sex.male, { exact: true }).click();
  await form.getByRole('button', { name: EN.bodyMetrics.save }).click();
  await expect.poll(() => headerStatusText(page), { message: 'the save must be confirmed' }).not.toBe('');
}

/** Onboards a fresh device, saves the body facts, and writes the old entry. Returns its day. */
async function prepareDevice(page: Page): Promise<string> {
  await completeOnboarding(page);
  await saveBodyMetrics(page);
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const oldDay = shiftDay(today, -DAYS_BACK);
  await writeOldEntry(page, oldDay);
  return oldDay;
}

/**
 * Waits past the point where the tab's run would have asked: two idle
 * callbacks, then a second. The control in the last test proves a request
 * does arrive inside this same wait.
 */
async function waitPastTheRun(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestIdleCallback(() => requestIdleCallback(() => setTimeout(resolve, 1000)));
      }),
  );
}

/** The page-relative top of the "What you ate" macro breakdown. */
async function macroTop(page: Page): Promise<number> {
  return page
    .locator('[data-slot="macro-breakdown"]')
    .first()
    .evaluate((element) => Math.round((element.getBoundingClientRect().top + window.scrollY) * 10) / 10);
}

test('an old day fills in its vitamins in place, and the entry on disk is never written', async ({ page }) => {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  const oldDay = await prepareDevice(page);

  const gate = createGate();
  const stub = await stubRoute(page, { answer: 'filled', gate });

  await page.goto(`/diary?date=${oldDay}`);
  const block = page.locator('[data-slot="micronutrient-snapshot"]');
  await expect(block).toHaveAttribute('data-state', 'not-enough-data');
  await expect(block).toContainText(EN.nutrients.coverage.notEnoughData);
  // The block knows a fill may still arrive, and holds the covered box open.
  await expect(block.locator('[data-slot="micronutrient-snapshot-fill-reserve"]')).toHaveCount(1);
  // The job asked, once, for exactly the old entry's slug, and is held there.
  await expect.poll(() => stub.requests).toEqual([[SLUG]]);

  // In view, because the browser reports no shift for a box below the fold.
  await block.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await settleAnimations(page);
  const since = (await readShiftEntries(page)).length;
  const before = await readTops(page);
  const macroBefore = await macroTop(page);

  gate.open();
  await expect(block).toHaveAttribute('data-state', 'ready');
  await expect(block).not.toContainText(EN.nutrients.coverage.notEnoughData);
  await settleFrames(page);

  expect(movedBetween(before, await readTops(page))).toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), since)).toBe(0);
  expect(await macroTop(page)).toBe(macroBefore);

  // The answer is in the device-local ledger, and the entry is untouched.
  await expect.poll(async () => (await readDisk(page)).ledger ?? '').toContain('"status":"filled"');
  const disk = await readDisk(page);
  expect(disk.entity, 'the entry is still on disk').not.toBeNull();
  expect(disk.entity).not.toContain('micronutrientsPer100g');
  expect(disk.entity).toContain(`lowcarbcheck:${SLUG}`);

  // CONTROL: one line inserted above the block's link moves the link and
  // everything under it, and both readings see it.
  const sinceControl = (await readShiftEntries(page)).length;
  const beforeControl = await readTops(page);
  await block.evaluate((element) => {
    const line = document.createElement('p');
    line.textContent = 'An inserted line';
    line.style.height = '24px';
    element.querySelector('[data-slot="micronutrient-snapshot-link"]')?.before(line);
  });
  await settleFrames(page);
  expect(movedBetween(beforeControl, await readTops(page)).length).toBeGreaterThan(0);
  expect(shiftScoreAfter(await readShiftEntries(page), sinceControl)).toBeGreaterThan(0);
});

test('a not-found answer is final: the day stays not-enough-data and a reload asks nothing', async ({ page }) => {
  const oldDay = await prepareDevice(page);
  const stub = await stubRoute(page, { answer: 'not-found' });

  await page.goto(`/diary?date=${oldDay}`);
  await expect.poll(() => stub.requests.length).toBe(1);
  await expect.poll(async () => (await readDisk(page)).ledger ?? '').toContain('"status":"not-found"');

  await page.reload();
  const block = page.locator('[data-slot="micronutrient-snapshot"]');
  await expect(block).toHaveAttribute('data-state', 'not-enough-data');
  // Settled, so nothing is pending and no box is held open for a fill.
  await expect(block.locator('[data-slot="micronutrient-snapshot-fill-reserve"]')).toHaveCount(0);
  await waitPastTheRun(page);
  expect(stub.requests.length, 'a settled slug is never asked again').toBe(1);
  expect((await readDisk(page)).entity).not.toContain('micronutrientsPer100g');
});

test('control: an unknown answer is asked again after the same reload and the same wait', async ({ page }) => {
  const oldDay = await prepareDevice(page);
  const stub = await stubRoute(page, { answer: 'unknown' });

  await page.goto(`/diary?date=${oldDay}`);
  await expect.poll(() => stub.requests.length).toBe(1);
  await expect.poll(async () => (await readDisk(page)).ledger ?? '').toContain('"attempts":1');

  await page.reload();
  const block = page.locator('[data-slot="micronutrient-snapshot"]');
  await expect(block).toHaveAttribute('data-state', 'not-enough-data');
  await waitPastTheRun(page);
  expect(stub.requests.length, 'a failed slug is asked again on the next run').toBe(2);
});
