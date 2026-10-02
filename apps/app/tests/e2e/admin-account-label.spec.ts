/**
 * The operator's label shows as a chip in /admin, and a chip never moves or
 * grows a row.
 *
 * ── WHAT THE OWNER ASKED FOR ─────────────────────────────────────────────
 *
 * People moved over from the beta get the label "Beta supporter", and the
 * owner wants to see it in the console: on the person's row in People, and on
 * their page. The core sends it as `label` on each account (`PROTOCOL.md`
 * §5.20); a core built before labels sends no such key, and the console must
 * work against both.
 *
 * ── WHAT THIS PROVES ─────────────────────────────────────────────────────
 *
 * Against a stubbed core that sends labels, the labelled rows carry exactly
 * one chip each with the label's text, the unlabelled rows carry none, and the
 * person's page carries the chip too. Against the same stub playing an older
 * core, no chip is drawn anywhere. That older load is the control for every
 * chip assertion.
 *
 * No layout shift, read two ways, at 360 and 390 px on a phone and at 1280 px
 * on a desktop. Between the two loads, every row keeps its page-relative top
 * and its height to a tenth of a pixel, with a 40 character label beside the
 * longest address. Inside the labelled page, with the labelled rows scrolled
 * into view, taking every chip out moves nothing and the browser records a
 * layout shift total of 0: the chip is the last thing on the address line, so
 * no badge and no line depends on it. The document never scrolls sideways and
 * every chip ends inside its row.
 *
 * THE CONTROL for both geometry readings is the last spec: a chip padded to
 * 14 px makes its row taller, and both readings see it.
 *
 * ── WHAT IT DOES NOT PROVE ───────────────────────────────────────────────
 *
 * That a real openplate-core stores or sends a label. The admin reads are
 * routed (`admin-console-stub.ts`); `apps/core/tests/integration/
 * admin-account-label.test.ts` proves the service side.
 *
 * ── GEOMETRY, NEVER A PICTURE ────────────────────────────────────────────
 *
 * Headless Chrome hides scrollbars, so every claim is a number read from the
 * layout.
 *
 * @area admin
 */
import { expect, test, type Page } from '@playwright/test';

import {
  LONG_PERSON_EMAIL,
  LONG_PERSON_ID,
  adminConsoleStub,
  routeAdminConsole,
  type AdminConsoleStub,
} from './admin-console-stub';
import { completeOnboarding, signInFixtureAccount } from './helpers';
import {
  installShiftObserver,
  readShiftEntries,
  settleFrames,
  shiftScoreAfter,
  turnOffScrollAnchoring,
  type ShiftEntry,
} from './layout-shift';

// A cross-origin read the service worker made would never reach `page.route`.
test.use({ serviceWorkers: 'block' });

/** The longest label the core accepts, beside the longest address, so one of the two has to give way. */
const LONG_LABEL = 'Beta supporter from the first public day';

/** The label the owner named. */
const BETA_LABEL = 'Beta supporter';

/** The second labelled person in the stub: the other administrator. */
const SECOND_ADMIN_ID = 9003;

/** Two labelled people, and everybody else with none. */
const LABELS: ReadonlyMap<number, string> = new Map([
  [LONG_PERSON_ID, LONG_LABEL],
  [SECOND_ADMIN_ID, BETA_LABEL],
]);

/** The people list's rows, each the link to one person's page. */
const ROW_SELECTOR = 'main a[href^="/admin/people/"]';

/** The chip, found by the marker the component carries. */
const CHIP_SELECTOR = '[data-slot="account-label"]';

/** Sub-pixel slack for an edge that sits exactly on another. */
const EDGE_TOLERANCE_PX = 0.5;

/** How long the labelled page is watched after the chips go, for anything that arrives a frame late. */
const LATE_ARRIVAL_WATCH_MS = 300;

/** One row, as the layout drew it. */
interface RowReading {
  href: string;
  /** From the top of the PAGE, so a scroll between two readings is not a move. */
  top: number;
  height: number;
}

/** Everything one reading of the people list knows. */
interface ListReading {
  rows: RowReading[];
  documentScrollWidth: number;
  documentClientWidth: number;
  /** Every chip whose right edge passes its row's, as `href: right > row right`. */
  chipsOutsideTheirRow: string[];
}

/**
 * Reads the rows and the chips in one pass.
 *
 * @param page - a page showing the loaded people list.
 * @returns the reading.
 */
async function readList(page: Page): Promise<ListReading> {
  // THE CALLBACK IS SERIALISED INTO THE PAGE, so its helpers live inside it.
  // oxlint-disable unicorn/consistent-function-scoping
  return page.evaluate(
    ({ rowSelector, chipSelector, tolerance }) => {
      const tenth = (value: number): number => Math.round(value * 10) / 10;
      const links = [...document.querySelectorAll(rowSelector)];
      const rows = links.map((link) => {
        const box = link.getBoundingClientRect();
        return {
          href: link.getAttribute('href') ?? '',
          top: tenth(box.top + window.scrollY),
          height: tenth(box.height),
        };
      });
      const chipsOutsideTheirRow = links.flatMap((link) => {
        const row = link.getBoundingClientRect();
        return [...link.querySelectorAll(chipSelector)]
          .map((chip) => chip.getBoundingClientRect())
          .filter((chip) => chip.right > row.right + tolerance || chip.left < row.left - tolerance)
          .map((chip) => `${link.getAttribute('href') ?? ''}: ${Math.round(chip.right)} > ${Math.round(row.right)}`);
      });
      return {
        rows,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
        chipsOutsideTheirRow,
      };
    },
    { rowSelector: ROW_SELECTOR, chipSelector: CHIP_SELECTOR, tolerance: EDGE_TOLERANCE_PX },
  );
  // oxlint-enable unicorn/consistent-function-scoping
}

/**
 * Every row whose top or height differs between two readings, named.
 *
 * @param before - the reading without labels.
 * @param after - the reading with them.
 * @returns one line per difference; empty when nothing moved or grew.
 */
function rowDifferences(before: ListReading, after: ListReading): string[] {
  const earlier = new Map(before.rows.map((row) => [row.href, row]));
  const differences = after.rows.flatMap((row) => {
    const was = earlier.get(row.href);
    if (was === undefined) return [`${row.href}: not in the first reading`];
    const lines: string[] = [];
    if (was.height !== row.height) lines.push(`${row.href}: height ${was.height} -> ${row.height}`);
    if (was.top !== row.top) lines.push(`${row.href}: top ${was.top} -> ${row.top}`);
    return lines;
  });
  if (before.rows.length !== after.rows.length) {
    differences.push(`${before.rows.length} rows before, ${after.rows.length} after`);
  }
  return differences;
}

/** Signs the device in as an administrator, through the real sign-in, with every admin request routed. */
async function signInAsAdministrator(page: Page, stub: AdminConsoleStub): Promise<void> {
  await routeAdminConsole(page, stub);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  expect(stub.selfId, 'the sign-in answer must have named the account').not.toBeNull();
}

/** Opens the people list and waits until every row and every strip beside them is drawn. */
async function openPeople(page: Page): Promise<void> {
  await page.goto('/admin');
  await expect(page.locator(ROW_SELECTOR).filter({ hasText: LONG_PERSON_EMAIL })).toBeVisible({ timeout: 15_000 });
  // Four rows: the administrator and the three people in the stub.
  await expect(page.locator(ROW_SELECTOR)).toHaveCount(4);
  // The strips arrive in a second read; the geometry is read after them.
  await expect(page.locator(`${ROW_SELECTOR} ul`)).toHaveCount(4);
  await settleFrames(page);
}

/**
 * The whole claim at the current width: the chips against an older core and a
 * newer one, and the rows the same in both.
 *
 * @param page - a signed-in administrator's page.
 * @param stub - the routed core, switched to labels half way.
 */
async function walkPresentAndAbsent(page: Page, stub: AdminConsoleStub): Promise<void> {
  stub.labels = undefined;
  await openPeople(page);
  // THE CONTROL: an older core sends no label key, and no chip is drawn.
  await expect(page.locator(CHIP_SELECTOR)).toHaveCount(0);
  const without = await readList(page);

  stub.labels = LABELS;
  await openPeople(page);
  await expect(page.locator(CHIP_SELECTOR)).toHaveCount(2);
  const longRow = page.locator(ROW_SELECTOR).filter({ hasText: LONG_PERSON_EMAIL });
  await expect(longRow.locator(CHIP_SELECTOR)).toHaveCount(1);
  await expect(longRow.locator(CHIP_SELECTOR)).toHaveAttribute('title', LONG_LABEL);
  const secondRow = page.locator(`main a[href="/admin/people/${SECOND_ADMIN_ID}"]`);
  await expect(secondRow.locator(CHIP_SELECTOR)).toHaveText(BETA_LABEL);
  await expect(secondRow.locator(CHIP_SELECTOR)).toBeVisible();
  const withLabels = await readList(page);

  expect(rowDifferences(without, withLabels), 'rows that moved or grew when the chips arrived').toEqual([]);
  expect(withLabels.chipsOutsideTheirRow, 'chips that pass the edge of their row').toEqual([]);
  expect(withLabels.documentScrollWidth, 'the document must not scroll sideways').toBeLessThanOrEqual(
    withLabels.documentClientWidth,
  );
  expect(stub.unanswered).toEqual([]);
}

/** What taking the chips out did: the rows that moved or grew, and the layout shift the browser recorded. */
interface ChipRemoval {
  moved: string[];
  shift: number;
  /** The entries behind `shift`, for the failure message: they name what moved. */
  entries: ShiftEntry[];
}

/**
 * Scrolls the two labelled rows into view, and proves they are.
 *
 * THE BROWSER'S READING IS BLIND BELOW THE FOLD. A `layout-shift` entry is
 * only recorded for an element in the viewport, and on a phone the list starts
 * under the counts and the filter, so a shift reading taken where the page
 * opens would be 0 whatever the rows did.
 *
 * @param page - the labelled people list, settled.
 */
async function scrollLabelledRowsIntoView(page: Page): Promise<void> {
  const longRow = page.locator(ROW_SELECTOR).filter({ hasText: LONG_PERSON_EMAIL });
  await longRow.evaluate((row) => row.scrollIntoView({ block: 'start' }));
  await settleFrames(page);
  await expect(longRow).toBeInViewport();
  await expect(page.locator(`main a[href="/admin/people/${SECOND_ADMIN_ID}"]`)).toBeInViewport();
}

/**
 * Takes every chip out of the labelled page and reports what moved: the
 * in-page half of the no-shift claim.
 *
 * @param page - the labelled people list, settled.
 * @returns the row differences, and the layout shift recorded since the chips went.
 */
async function removeTheChips(page: Page): Promise<ChipRemoval> {
  await scrollLabelledRowsIntoView(page);
  const before = await readList(page);
  const since = (await readShiftEntries(page)).length;
  await page.locator(CHIP_SELECTOR).evaluateAll((chips) => {
    for (const chip of chips) chip.remove();
  });
  await page.waitForTimeout(LATE_ARRIVAL_WATCH_MS);
  await settleFrames(page);
  await expect(page.locator(CHIP_SELECTOR)).toHaveCount(0);
  const entries = (await readShiftEntries(page)).slice(since);
  return { moved: rowDifferences(before, await readList(page)), shift: shiftScoreAfter(entries, 0), entries };
}

test.describe('on a phone', () => {
  test('a label is a chip on its row, and a row with a chip is exactly as tall as one without, at 360 and 390 px', async ({
    page,
  }) => {
    expect([...LONG_LABEL].length, 'the long label is the longest the core accepts').toBe(40);
    await installShiftObserver(page);
    await turnOffScrollAnchoring(page);
    const stub = adminConsoleStub();
    await signInAsAdministrator(page, stub);

    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await walkPresentAndAbsent(page, stub);
      const removed = await removeTheChips(page);
      expect(removed.moved, `rows that moved when the chips went, at ${width} px`).toEqual([]);
      expect(
        removed.shift,
        `layout shift when the chips went, at ${width} px: ${JSON.stringify(removed.entries)}`,
      ).toBe(0);
    }
  });

  test("a labelled person's page shows the chip, and an older core's page shows none", async ({ page }) => {
    const stub = adminConsoleStub();
    stub.labels = LABELS;
    await signInAsAdministrator(page, stub);

    await page.goto(`/admin/people/${LONG_PERSON_ID}`);
    const chip = page.locator(`main ${CHIP_SELECTOR}`);
    await expect(chip).toHaveCount(1, { timeout: 15_000 });
    await expect(chip).toHaveAttribute('title', LONG_LABEL);
    await expect(chip).toBeVisible();
    const fit = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(fit.scrollWidth, 'a 40 character chip must not push the page sideways').toBeLessThanOrEqual(fit.clientWidth);

    // THE CONTROL: the same page against a core with no labels draws no chip.
    stub.labels = undefined;
    await page.goto(`/admin/people/${LONG_PERSON_ID}`);
    await expect(page.getByText(LONG_PERSON_EMAIL).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`main ${CHIP_SELECTOR}`)).toHaveCount(0);
    expect(stub.unanswered).toEqual([]);
  });

  test('the control: a chip that grows its row is seen by both readings', async ({ page }) => {
    await installShiftObserver(page);
    await turnOffScrollAnchoring(page);
    const stub = adminConsoleStub();
    await signInAsAdministrator(page, stub);

    stub.labels = undefined;
    await openPeople(page);
    const without = await readList(page);
    stub.labels = LABELS;
    await openPeople(page);
    await scrollLabelledRowsIntoView(page);

    // What a chip taller than the name line would do.
    const since = (await readShiftEntries(page)).length;
    await page.locator(CHIP_SELECTOR).evaluateAll((chips) => {
      for (const chip of chips) {
        if (chip instanceof HTMLElement) chip.style.padding = '14px 8px';
      }
    });
    await settleFrames(page);

    const grown = rowDifferences(without, await readList(page));
    expect(
      grown.some((line) => line.includes('height')),
      `the row reading must see the taller row: ${grown}`,
    ).toBe(true);
    await expect
      .poll(async () => shiftScoreAfter(await readShiftEntries(page), since), {
        message: 'the browser must record the taller row as a layout shift',
      })
      .toBeGreaterThan(0);
  });
});

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test('a label is a chip on its row, and a row with a chip is exactly as tall as one without, at 1280 px', async ({
    page,
  }) => {
    await installShiftObserver(page);
    await turnOffScrollAnchoring(page);
    const stub = adminConsoleStub();
    await signInAsAdministrator(page, stub);

    await walkPresentAndAbsent(page, stub);
    const removed = await removeTheChips(page);
    expect(removed.moved, 'rows that moved when the chips went').toEqual([]);
    expect(removed.shift, `layout shift when the chips went: ${JSON.stringify(removed.entries)}`).toBe(0);
  });
});
