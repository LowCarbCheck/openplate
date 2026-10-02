/**
 * An administrator's role lands after the page, and the sidebar moves nothing
 * (DESIGN.md section 7; the `[sidebar` excuse in `whats-new.spec.ts` is gone).
 *
 * THE FINDING. At 1280 px wide, an account whose role is read after the first
 * paint gets an Administration row in the desktop sidebar. The row used to sit
 * in the footer, which is anchored to the bottom of the rail, so adding a row
 * and its rule to it moved the footer's top edge up by 49 px. The browser
 * recorded that as a layout shift of about 0.0014, with the What's new card
 * switched off too.
 *
 * WHAT IS READ. Every element inside the sidebar, not only its links: its top,
 * its bottom and its height before the role lands and after it, matched by a
 * key that holds no coordinates. And the browser's own `layout-shift` entries,
 * all of them, for the whole load. A move of any element that exists in both
 * readings, or a total above 0, fails with the names.
 *
 * THE ORDER IS NOT ASSUMED. The plan entry arrives after a session and a fresh
 * handshake, the Administration row after the session. So the role lands three
 * ways: alone, together with the plan entry, and before it, with the handshake
 * held. A layout that kept one of them still only because the other had not
 * come yet would pass the first and fail the others.
 *
 * THE CONTROLS. The reader is shown to see a move: a box pushed in under
 * Settings must be reported as a move and as a shift. And the rule that a role
 * landing is a real change is a plain count: no Administration link before, one
 * after, and a member never gets one.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { AUTH_API_PREFIX } from '../../app/lib/sync/engine/client/auth-wire';
import { adminConsoleStub, routeAdminConsole } from './admin-console-stub';
import { EN } from './copy';
import { E2E_CORE_URL } from './env';
import { completeOnboarding, signInFixtureAccount } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
  turnOffScrollAnchoring,
} from './layout-shift';
import { FIXTURE_OFFER_BODY, NO_SUBSCRIPTION_VIEW, createGate, routePlansCore, type PlansStub } from './plans-stub';

test.use({
  serviceWorkers: 'block',
  viewport: { width: 1280, height: 800 },
  isMobile: false,
  hasTouch: false,
  deviceScaleFactor: 1,
});

/** A page that draws nothing of its own from the role or the handshake, so only the sidebar can move. */
const QUIET_PAGE = '/pantry';

/** The height the control's injected box takes, larger than any rounding. */
const CONTROL_BOX_PX = 32;

/** One box in the sidebar, in CSS px. */
interface SidebarBox {
  top: number;
  bottom: number;
  height: number;
}

/** The desktop sidebar, never the avatar menu. */
function sidebar(page: Page): Locator {
  return page.locator('[data-slot="sidebar-container"]');
}

/** The Administration row's link. */
function adminLink(page: Page): Locator {
  return sidebar(page).locator('a[href="/admin"]');
}

/** The Plan row's link. */
function planLink(page: Page): Locator {
  return sidebar(page).locator('a[href="/settings/plan"]');
}

/** The Settings row's link. */
function settingsLink(page: Page): Locator {
  return sidebar(page).locator('a[href="/settings"]');
}

/**
 * Holds the page's first account read until `release` is called, so the page
 * is drawn WITHOUT the role first.
 *
 * @param page - a signed-in page that has not navigated since.
 * @returns `asked`, which settles when the page has asked, and `release`.
 */
async function holdAccountRead(page: Page): Promise<{ asked: Promise<void>; release: () => void }> {
  const gate = createGate();
  const asked = createGate();
  await page.route(`${E2E_CORE_URL}${AUTH_API_PREFIX}/account`, async (route) => {
    asked.open();
    await gate.promise;
    await route.fallback();
  });
  return { asked: asked.promise, release: () => gate.open() };
}

/**
 * The top, bottom and height of every element in the sidebar that has a box.
 *
 * AN ELEMENT IS KNOWN BY ITSELF, never by where it sits or what it says. The
 * first reading gives every element it sees a number and a label and keeps
 * them in a `WeakMap` in the page; the next reading finds the same DOM nodes
 * again and reports them under the same name. A key built from the element's
 * place in the document would read an inserted row as every later icon having
 * moved, and one built from its text would lose the footer the moment its
 * first row changed.
 *
 * @param page - a page with the desktop sidebar on it.
 * @returns the boxes by name, only for elements the FIRST reading saw when `isFirst`, else for all.
 */
async function readSidebarBoxes(page: Page): Promise<Record<string, SidebarBox>> {
  // Serialised into the page: its helpers cannot move out of it.
  // oxlint-disable unicorn/consistent-function-scoping
  const boxes = await page.evaluate(() => {
    const root = document.querySelector('[data-slot="sidebar-container"]');
    if (root === null) throw new Error('the page has no sidebar');
    interface Identity {
      id: number;
      label: string;
    }
    // Kept on `window` by `defineProperty`, the way `layout-shift.ts` keeps its entries, so a
    // second reading finds the first one's names.
    const kept = Object.getOwnPropertyDescriptor(window, '__sidebarIdentity')?.value;
    const identities = kept instanceof WeakMap ? kept : new WeakMap<Element, Identity>();
    if (!(kept instanceof WeakMap)) Object.defineProperty(window, '__sidebarIdentity', { value: identities });
    const keptCounter = Object.getOwnPropertyDescriptor(window, '__sidebarCounter')?.value;
    const counter: { next: number } = keptCounter ?? { next: 0 };
    if (keptCounter === undefined) Object.defineProperty(window, '__sidebarCounter', { value: counter });
    const found: Record<string, { top: number; bottom: number; height: number }> = {};
    for (const element of root.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      let identity = identities.get(element);
      if (identity === undefined) {
        const slot = element.getAttribute('data-slot') ?? '';
        const href = element.getAttribute('href') ?? '';
        const text = (element.textContent ?? '').trim().slice(0, 24);
        counter.next += 1;
        identity = {
          id: counter.next,
          label: `#${counter.next} ${element.tagName.toLowerCase()}[${slot}|${href}] "${text}"`,
        };
        identities.set(element, identity);
      }
      found[identity.label] = {
        top: Math.round((rect.top + window.scrollY) * 10) / 10,
        bottom: Math.round((rect.bottom + window.scrollY) * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
      };
    }
    return found;
  });
  // oxlint-enable unicorn/consistent-function-scoping
  return boxes;
}

/**
 * Every sidebar element present in both readings whose top, bottom or height
 * differs, as one line each.
 *
 * @param before - the earlier reading.
 * @param after - the later reading.
 * @returns the lines, empty when nothing moved.
 */
function movesBetween(before: Record<string, SidebarBox>, after: Record<string, SidebarBox>): string[] {
  const tops = movedBetween(
    Object.fromEntries(Object.entries(before).map(([key, box]) => [key, box.top])),
    Object.fromEntries(Object.entries(after).map(([key, box]) => [key, box.top])),
  ).map((move) => `${move.element} top moved ${move.dy} px`);
  const resized = Object.entries(after)
    .filter(([key, box]) => key in before && (before[key].bottom !== box.bottom || before[key].height !== box.height))
    .filter(([key, box]) => before[key].top === box.top)
    .map(
      ([key, box]) =>
        `${key} bottom ${before[key].bottom} -> ${box.bottom}, height ${before[key].height} -> ${box.height}`,
    );
  return [...tops, ...resized];
}

/**
 * Signs an administrator in on a fresh device, with the plan door routed
 * through a stub whose handshake the spec can hold.
 *
 * @param page - a fresh page.
 * @param stub - what the biller answers, `healthGate` included.
 */
async function signInAsAdministrator(page: Page, stub: PlansStub): Promise<void> {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  await routeAdminConsole(page, adminConsoleStub());
  await routePlansCore(page, stub);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
}

/**
 * Reads the sidebar and the shift count at one moment.
 *
 * @param page - a page with the sidebar on it.
 * @returns the boxes and how many `layout-shift` entries were recorded so far.
 */
async function readNow(page: Page): Promise<{ boxes: Record<string, SidebarBox>; since: number }> {
  await settleAnimations(page);
  return { boxes: await readSidebarBoxes(page), since: (await readShiftEntries(page)).length };
}

/**
 * Names the shifts a reading recorded after `since`, for a failure message.
 *
 * @param page - the page.
 * @param since - the entry count at the earlier reading.
 * @returns the sources, joined.
 */
async function shiftSourcesSince(page: Page, since: number): Promise<string> {
  return (await readShiftEntries(page))
    .slice(since)
    .flatMap((entry) => entry.sources)
    .join('; ');
}

test('the role landing alone adds the Administration row and moves nothing in the sidebar', async ({ page }) => {
  await signInAsAdministrator(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY, plans: false });
  const { asked, release } = await holdAccountRead(page);
  await page.goto(QUIET_PAGE, { waitUntil: 'commit' });
  await asked;
  await expect(settingsLink(page)).toBeVisible();
  const before = await readNow(page);
  expect(await adminLink(page).count(), 'CONTROL: with the role unread there is no Administration row').toBe(0);
  expect(await planLink(page).count(), 'CONTROL: this instance sells no plans, so no Plan row').toBe(0);

  release();
  await expect(adminLink(page), 'the role landed: the row is there').toHaveText(EN.nav.admin);
  await settleFrames(page);
  const after = await readNow(page);

  expect(movesBetween(before.boxes, after.boxes), 'sidebar elements that moved when the role landed').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), 0), `the load moved ${await shiftSourcesSince(page, 0)}`).toBe(
    0,
  );
});

test('the role and the Plan row landing together move nothing', async ({ page }) => {
  await signInAsAdministrator(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  const { asked, release } = await holdAccountRead(page);
  await page.goto(QUIET_PAGE, { waitUntil: 'commit' });
  await asked;
  await expect(settingsLink(page)).toBeVisible();
  const before = await readNow(page);

  // Both rows need the account: the Plan row also needs the handshake, which has answered by now.
  release();
  await expect(adminLink(page)).toBeVisible();
  await expect(planLink(page)).toBeVisible();
  await settleFrames(page);
  const after = await readNow(page);

  expect(movesBetween(before.boxes, after.boxes), 'sidebar elements that moved').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), 0), `the load moved ${await shiftSourcesSince(page, 0)}`).toBe(
    0,
  );
});

test('the Plan row landing after the Administration row moves nothing', async ({ page }) => {
  const handshake = createGate();
  const stub: PlansStub = { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY };
  await signInAsAdministrator(page, stub);
  // The stub reads its gate PER REQUEST, so the handshake is held for the next document only.
  stub.healthGate = handshake.promise;
  await page.goto(QUIET_PAGE);
  await expect(adminLink(page), 'the role landed while the handshake is held').toBeVisible();
  await expect(planLink(page), 'the handshake is held, so no Plan row yet').toHaveCount(0);
  const before = await readNow(page);

  handshake.open();
  await expect(planLink(page)).toBeVisible();
  await settleFrames(page);
  const after = await readNow(page);

  expect(movesBetween(before.boxes, after.boxes), 'sidebar elements that moved when the Plan row landed').toEqual([]);
  expect(
    shiftScoreAfter(await readShiftEntries(page), before.since),
    `the Plan row landing moved ${await shiftSourcesSince(page, before.since)}`,
  ).toBe(0);
});

test('CONTROL: a box pushed in under Settings is seen by both readers', async ({ page }) => {
  await signInAsAdministrator(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY, plans: false });
  await page.goto(QUIET_PAGE);
  await expect(adminLink(page)).toBeVisible();
  const before = await readNow(page);

  // The footer is anchored to the bottom of the rail, so a box under Settings pushes it UP.
  await settingsLink(page).evaluate((element, height) => {
    const box = document.createElement('div');
    box.style.height = `${height}px`;
    element.closest('ul')?.after(box);
  }, CONTROL_BOX_PX);
  await settleFrames(page);
  const after = await readNow(page);

  expect(movesBetween(before.boxes, after.boxes).length, 'CONTROL: the box reads as a move').toBeGreaterThan(0);
  expect(
    shiftScoreAfter(await readShiftEntries(page), before.since),
    'CONTROL: the browser records a layout shift',
  ).toBeGreaterThan(0);
});

test('a member never gets the Administration row', async ({ page }) => {
  await installShiftObserver(page);
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY, plans: false });
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  await page.goto(QUIET_PAGE);
  await expect(settingsLink(page)).toBeVisible();
  await settleAnimations(page);
  expect(await adminLink(page).count()).toBe(0);
});
