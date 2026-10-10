/**
 * Finding somebody in /admin: newest first, quick views with counts, the choice
 * kept in the address, and a list that never moves while it narrows.
 *
 * ── WHAT THE OPERATOR ASKED FOR (2026-10-11) ─────────────────────────────
 *
 * The People tab opens on the newest sign-ups, marks a fresh account "New",
 * and answers "who has never signed in" with one tap on a chip that already
 * carries the number. The invitations tab opens on the pending ones and keeps
 * the expired, revoked and accepted behind chips of their own.
 *
 * ── WHAT THIS PROVES ─────────────────────────────────────────────────────
 *
 * Against the routed console (`admin-console-stub.ts`, with one fresh sign-up
 * and every invitation state added): the newest account is the first row and
 * the only one with the badge; a chip's count is the number of rows it leaves;
 * the chosen view is in the address and a reload restores it; typing in the
 * search and pressing chips move the top edge of the list by nothing, and the
 * only things the browser records as shifting are the rows and band headings
 * that the filter itself added, removed or reordered; "/" puts the cursor in the search
 * and a slash typed into a field stays a slash; the invitations open on
 * pending, and the Expired chip shows the expired invitation that Pending hides.
 *
 * THE ROWS MOVE, AND MUST. Narrowing a list is the change the person asked for,
 * so its rows shifting is not a finding, and the browser's own total counts
 * them. The claim is about everything else: the search, the menus, the chips,
 * the result line. The control is that the observer DID record the rows
 * moving, so a quiet toolbar is not a quiet observer.
 *
 * THE CONTROLS: a view with no chip pressed shows every row, the Expired chip
 * is empty in a stub that has no expired invitation, and the badge is missing
 * from every row but one.
 *
 * ── GEOMETRY, NEVER A PICTURE ────────────────────────────────────────────
 *
 * Page-relative tops from `getBoundingClientRect`, and `layout-shift` entries
 * with scroll anchoring off, so a scrolled page cannot hide a move.
 *
 * @area admin
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  EXPIRED_INVITE_EMAIL,
  FRESH_PERSON_EMAIL,
  LONG_INVITE_EMAIL,
  adminConsoleStub,
  routeAdminConsole,
  type AdminConsoleStub,
} from './admin-console-stub';
import { completeOnboarding, signInFixtureAccount } from './helpers';
import {
  installShiftObserver,
  readShiftEntries,
  settleFrames,
  turnOffScrollAnchoring,
  type ShiftEntry,
} from './layout-shift';

// A cross-origin read the service worker made would never reach `page.route`.
test.use({ serviceWorkers: 'block' });

/** The people list's rows, each the link to one person's page. */
const ROW_SELECTOR = 'main a[href^="/admin/people/"]';

/** The box the rows sit in. */
const LIST_SELECTOR = 'main [data-people-list]';

/** Sub-pixel slack for an edge that sits exactly on another. */
const EDGE_TOLERANCE_PX = 0.5;

/** What a shift source looks like when it is a row or a band heading of the list, as `describe` in `layout-shift.ts` writes it. */
const LIST_SOURCE = /^(li|h3) "|^div "(This week|This month|Earlier)/u;

/** The shifts with at least one source outside the list: the toolbar, the page chrome, anything else. */
function shiftsOutsideTheList(entries: readonly ShiftEntry[]): ShiftEntry[] {
  return entries.filter((entry) => entry.sources.some((source) => !LIST_SOURCE.test(source)));
}

/** Longer than the 250 ms the search waits before writing the address. */
const SEARCH_WRITE_WAIT_MS = 1500;

/** Signs in as an administrator through the real sign-in, with every admin request routed. */
async function signInAsAdministrator(page: Page, stub: AdminConsoleStub): Promise<void> {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  await routeAdminConsole(page, stub);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  expect(stub.selfId, 'the sign-in answer must have named the account').not.toBeNull();
}

/** Opens the people list at `search` and waits until every row is drawn. */
async function openPeople(page: Page, search = ''): Promise<void> {
  await page.goto(`/admin${search}`);
  await expect(page.locator(LIST_SELECTOR)).toBeVisible({ timeout: 15_000 });
  await settleFrames(page);
}

function chip(page: Page, id: string) {
  return page.locator(`main [data-chip="${id}"]`);
}

/** The number a chip carries. */
async function chipCount(page: Page, id: string): Promise<number> {
  const text = await chip(page, id).locator('span').innerText();
  return Number(text);
}

/** A box measured from the top of the PAGE, rounded to a tenth of a pixel. */
// THE CALLBACK IS SERIALISED INTO THE PAGE, so its helper lives inside it.
// oxlint-disable unicorn/consistent-function-scoping
async function pageBox(target: Locator): Promise<{ top: number; left: number; width: number; height: number }> {
  return target.evaluate((node) => {
    const tenth = (value: number): number => Math.round(value * 10) / 10;
    const box = node.getBoundingClientRect();
    return {
      top: tenth(box.top + window.scrollY),
      left: tenth(box.left),
      width: tenth(box.width),
      height: tenth(box.height),
    };
  });
}
// oxlint-enable unicorn/consistent-function-scoping

/** The top of the list box measured from the top of the PAGE, so a scroll is not a move. */
async function listTop(page: Page): Promise<number> {
  return page.evaluate((selector) => {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    if (box === undefined) throw new Error('the list box is not drawn');
    return Math.round((box.top + window.scrollY) * 10) / 10;
  }, LIST_SELECTOR);
}

test('the list opens newest first, and only the fresh sign-up is marked New', async ({ page }) => {
  const stub: AdminConsoleStub = { ...adminConsoleStub(), fresh: true };
  await signInAsAdministrator(page, stub);
  await openPeople(page);

  await expect(page.locator(ROW_SELECTOR)).toHaveCount(5);
  await expect(page.locator(ROW_SELECTOR).first()).toContainText(FRESH_PERSON_EMAIL);
  await expect(page.locator(`${ROW_SELECTOR} [data-new-badge]`)).toHaveCount(1);
  await expect(page.locator(ROW_SELECTOR).first().locator('[data-new-badge]')).toBeVisible();
  // CONTROL: the badge is a property of the row, not of the page.
  await expect(page.locator(ROW_SELECTOR).last().locator('[data-new-badge]')).toHaveCount(0);

  expect(stub.unanswered).toEqual([]);
});

test('a chip carries the number of rows it leaves, and the choice lives in the address', async ({ page }) => {
  const stub: AdminConsoleStub = { ...adminConsoleStub(), fresh: true };
  await signInAsAdministrator(page, stub);
  await openPeople(page);

  expect(await chipCount(page, 'all')).toBe(5);
  expect(await chipCount(page, 'new')).toBe(1);
  expect(await chipCount(page, 'never')).toBe(2);
  expect(await chipCount(page, 'suspended')).toBe(1);
  expect(await chipCount(page, 'administrators')).toBe(2);

  const promised = await chipCount(page, 'never');
  await chip(page, 'never').click();
  await expect(page.locator(ROW_SELECTOR)).toHaveCount(promised);
  await expect(chip(page, 'never')).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/[?&]view=never(&|$)/);
  await expect(page.locator('main output')).toHaveText(`${promised} of 5 people`);
  // Counts do not fall to zero because a chip is pressed.
  expect(await chipCount(page, 'administrators')).toBe(2);

  // The address survives a reload.
  await page.reload();
  await expect(page.locator(LIST_SELECTOR)).toBeVisible({ timeout: 15_000 });
  await expect(chip(page, 'never')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(ROW_SELECTOR)).toHaveCount(promised);

  // Pressing the pressed chip is the way back, and the address forgets the view.
  await chip(page, 'never').click();
  await expect(page.locator(ROW_SELECTOR)).toHaveCount(5);
  await expect(page).not.toHaveURL(/view=/);
  await expect(chip(page, 'all')).toHaveAttribute('aria-pressed', 'true');

  expect(stub.unanswered).toEqual([]);
});

test('a value in the address that the console does not know falls back to everybody', async ({ page }) => {
  const stub: AdminConsoleStub = { ...adminConsoleStub(), fresh: true };
  await signInAsAdministrator(page, stub);
  await openPeople(page, '?view=sideways&sort=nonsense&label=nothing');

  await expect(page.locator(ROW_SELECTOR)).toHaveCount(5);
  await expect(chip(page, 'all')).toHaveAttribute('aria-pressed', 'true');
});

test('pressing chips and typing in the search move nothing above or below the list', async ({ page }) => {
  const stub: AdminConsoleStub = { ...adminConsoleStub(), fresh: true };
  await signInAsAdministrator(page, stub);
  await openPeople(page);

  const topBefore = await listTop(page);
  const since = (await readShiftEntries(page)).length;

  for (const id of ['never', 'administrators', 'suspended', 'quiet', 'new']) {
    await chip(page, id).click();
    await expect(chip(page, id)).toHaveAttribute('aria-pressed', 'true');
    await settleFrames(page);
    const top = await listTop(page);
    expect(Math.abs(top - topBefore), `the list moved by ${top - topBefore} px under the ${id} chip`).toBeLessThan(
      EDGE_TOLERANCE_PX,
    );
  }
  await chip(page, 'new').click();
  await expect(page.locator(ROW_SELECTOR)).toHaveCount(5);

  const search = page.getByLabel('Search', { exact: true });
  await search.click();
  await search.pressSequentially('fresh', { delay: 40 });
  await expect(page.locator(ROW_SELECTOR)).toHaveCount(1);
  await page.waitForTimeout(SEARCH_WRITE_WAIT_MS);
  await expect(page).toHaveURL(/[?&]q=fresh(&|$)/);
  expect(Math.abs((await listTop(page)) - topBefore)).toBeLessThan(EDGE_TOLERANCE_PX);

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator(ROW_SELECTOR)).toHaveCount(5);
  await settleFrames(page);
  expect(Math.abs((await listTop(page)) - topBefore)).toBeLessThan(EDGE_TOLERANCE_PX);

  const entries = (await readShiftEntries(page)).slice(since);
  // CONTROL: the observer saw the rows move, so an empty answer below is not a deaf observer.
  expect(entries.length, 'the rows shifted, and the observer must have seen it').toBeGreaterThan(0);
  expect(shiftsOutsideTheList(entries), `layout-shift outside the list: ${JSON.stringify(entries)}`).toEqual([]);
});

test('Clear filters is in its box before it is needed', async ({ page }) => {
  const stub: AdminConsoleStub = { ...adminConsoleStub(), fresh: true };
  await signInAsAdministrator(page, stub);
  await openPeople(page);

  const clear = page.getByRole('button', { name: 'Clear filters' });
  // Invisible, so out of the accessibility tree, but laid out.
  await expect(clear).toHaveCount(0);
  const hidden = page.locator('main button', { hasText: 'Clear filters' });
  await expect(hidden).toHaveCount(1);
  const box = await pageBox(hidden);
  expect(box.height, 'the hidden button still has a box').toBeGreaterThan(0);

  await chip(page, 'never').click();
  await expect(clear).toBeVisible();
  expect(await pageBox(clear)).toEqual(box);
});

test('"/" jumps to the search, and a slash typed in a field stays a slash', async ({ page }) => {
  const stub: AdminConsoleStub = { ...adminConsoleStub(), fresh: true };
  await signInAsAdministrator(page, stub);
  await openPeople(page);

  const search = page.getByLabel('Search', { exact: true });
  await expect(search).not.toBeFocused();
  await page.locator('main').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  // The shortcut key itself did not land in the box.
  await expect(search).toHaveValue('');

  await page.keyboard.type('a/b');
  await expect(search).toHaveValue('a/b');
});

test('the invitations open on the pending ones, and the Expired chip shows what Pending hides', async ({ page }) => {
  const stub: AdminConsoleStub = { ...adminConsoleStub(), everyInviteState: true };
  await signInAsAdministrator(page, stub);
  await page.goto('/admin/invitations');
  await expect(page.locator('main [data-invite-status]').first()).toBeVisible({ timeout: 15_000 });

  await expect(chip(page, 'pending')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main [data-invite-status="pending"]')).toHaveCount(2);
  await expect(page.locator('main [data-invite-status]')).toHaveCount(2);
  await expect(page.getByText(LONG_INVITE_EMAIL)).toBeVisible();
  await expect(page.getByText(EXPIRED_INVITE_EMAIL)).toHaveCount(0);
  expect(await chipCount(page, 'pending')).toBe(2);
  expect(await chipCount(page, 'expired')).toBe(1);
  expect(await chipCount(page, 'revoked')).toBe(1);
  expect(await chipCount(page, 'redeemed')).toBe(1);
  expect(await chipCount(page, 'all')).toBe(5);

  await chip(page, 'expired').click();
  await expect(page.locator('main [data-invite-status="expired"]')).toHaveCount(1);
  await expect(page.locator('main [data-invite-status]')).toHaveCount(1);
  await expect(page.getByText(EXPIRED_INVITE_EMAIL)).toBeVisible();
  await expect(page.getByText(LONG_INVITE_EMAIL)).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]status=expired(&|$)/);

  await page.reload();
  await expect(chip(page, 'expired')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect(page.getByText(EXPIRED_INVITE_EMAIL)).toBeVisible();

  await chip(page, 'all').click();
  await expect(page.locator('main [data-invite-status]')).toHaveCount(5);

  expect(stub.unanswered).toEqual([]);
});

test('the control: a console with no expired invitation has an empty Expired chip', async ({ page }) => {
  const stub = adminConsoleStub();
  await signInAsAdministrator(page, stub);
  await page.goto('/admin/invitations');
  await expect(page.locator('main [data-invite-status]').first()).toBeVisible({ timeout: 15_000 });

  expect(await chipCount(page, 'expired')).toBe(0);
  await chip(page, 'expired').click();
  await expect(page.locator('main [data-invite-status]')).toHaveCount(0);
  await expect(page.getByText('No invitation has expired.')).toBeVisible();
});

test('on a phone the chips scroll sideways inside their row and the page never does; on a laptop they wrap', async ({
  page,
}) => {
  const stub: AdminConsoleStub = { ...adminConsoleStub(), fresh: true };
  await signInAsAdministrator(page, stub);

  const read = async () =>
    page.evaluate(() => {
      const row = document.querySelector('main [data-chip="all"]')?.parentElement;
      if (row === null || row === undefined) throw new Error('the chip row is not drawn');
      const root = document.documentElement;
      return {
        rowScrollWidth: row.scrollWidth,
        rowClientWidth: row.clientWidth,
        pageScrollWidth: root.scrollWidth,
        pageClientWidth: root.clientWidth,
      };
    });

  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await openPeople(page);
    const phone = await read();
    expect(phone.rowScrollWidth, `${width} px: seven chips are wider than the row`).toBeGreaterThan(
      phone.rowClientWidth,
    );
    expect(phone.pageScrollWidth, `${width} px: the page does not scroll sideways`).toBeLessThanOrEqual(
      phone.pageClientWidth,
    );
  }

  // CONTROL: a laptop has room, so the row wraps and has nothing to scroll.
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPeople(page);
  const laptop = await read();
  expect(laptop.rowScrollWidth).toBeLessThanOrEqual(laptop.rowClientWidth);
});
