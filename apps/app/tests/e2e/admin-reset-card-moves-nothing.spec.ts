/**
 * The reset link on a person's page moves nothing that is already on screen.
 *
 * ── WHAT THE PAGE DID ────────────────────────────────────────────────────
 *
 * On an instance without mail, "Send a reset link" puts a card with the link
 * on the page. The card went ABOVE the person's details, so the whole page,
 * the button just pressed included, jumped down by the card's height under the
 * administrator's finger. `apps/app/DESIGN.md` section 7 forbids exactly that:
 * an expansion the person asked for never pushes down content above the tap
 * point.
 *
 * ── WHAT THIS PROVES ─────────────────────────────────────────────────────
 *
 * From before the press, through the busy button (the answer is held until it
 * has painted, as a slow network would), to the settled card: every button and link in the
 * person's details keeps its page-relative top, the details card and the
 * activity card keep their `getBoundingClientRect` tops (page-relative, so
 * scrolling the new card into view is not read as a move), the browser records
 * a layout shift total of 0, and the card is in the viewport at the end.
 *
 * THE CONTROL grows a 40 px line above the details in the same state, and both
 * readings see it. Scroll anchoring is off in both tests, because with it on
 * Chrome can scroll such a line away and record nothing
 * (`turnOffScrollAnchoring` in `layout-shift.ts`). On the code before this
 * change the first test fails at the details' tops.
 *
 * @area admin
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import {
  LONG_PERSON_EMAIL,
  LONG_PERSON_ID,
  adminConsoleStub,
  routeAdminConsole,
  type AdminConsoleStub,
} from './admin-console-stub';
import { E2E_APP_URL } from './env';
import { completeOnboarding, signInFixtureAccount } from './helpers';
import { createGate } from './plans-stub';
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

// A cross-origin read the service worker made would never reach `page.route`.
test.use({ serviceWorkers: 'block' });

const COPY = z
  .object({
    admin: z.object({
      resetMail: z.object({ cta: z.string() }),
      person: z.object({ activityTitle: z.string() }),
    }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** A reset link on this page's own origin, so no warning line is part of the reading. */
const RESET_LINK = `${E2E_APP_URL}/reset#server=http%3A%2F%2F127.0.0.1%3A3001&token=sr_e2e_moves_nothing`;

/** How long the page is watched after the card is drawn, for anything that arrives a render late. */
const LATE_ARRIVAL_WATCH_MS = 500;

/** Signs the device in as an administrator, through the real sign-in, with every admin request routed. */
async function signInAsAdministrator(page: Page, stub: AdminConsoleStub): Promise<void> {
  await routeAdminConsole(page, stub);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  expect(stub.selfId, 'the sign-in answer must have named the account').not.toBeNull();
}

/** The two cards of the person's details. */
interface DetailCards {
  person: Locator;
  activity: Locator;
}

/**
 * The card with the person's facts, and the card with their activity.
 *
 * The facts card is the one with the address AND a `dl`: the reset card names
 * the address too, in its sentence, and must never be mistaken for it.
 */
function detailCards(page: Page): DetailCards {
  const cards = page.locator('main [data-slot="card"]');
  return {
    person: cards.filter({ hasText: LONG_PERSON_EMAIL, has: page.locator('dl') }),
    activity: cards.filter({
      has: page.locator('[data-slot="card-title"]', { hasText: COPY.admin.person.activityTitle }),
    }),
  };
}

/** A card's top edge from the top of the PAGE, so a scroll between two readings is not a move. */
async function pageTop(card: Locator): Promise<number> {
  return card.evaluate((node) => Math.round((node.getBoundingClientRect().top + window.scrollY) * 10) / 10);
}

/** Opens the person's page and returns the reset button, scrolled into view and settled. */
async function openResetButton(page: Page): Promise<Locator> {
  await page.goto(`/admin/people/${LONG_PERSON_ID}`);
  await expect(detailCards(page).person).toBeVisible({ timeout: 15_000 });
  await expect(detailCards(page).activity.locator('.animate-spin')).toHaveCount(0);
  const reset = page.getByRole('button', { name: COPY.admin.resetMail.cta, exact: true });
  await reset.scrollIntoViewIfNeeded();
  await settleAnimations(page);
  return reset;
}

test("a reset link moves nothing on a person's page, and the card with the link is in view", async ({ page }) => {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  const stub = adminConsoleStub();
  stub.handedLink = RESET_LINK;
  const answer = createGate();
  stub.writeGate = answer.promise;
  await signInAsAdministrator(page, stub);
  const reset = await openResetButton(page);
  const cards = detailCards(page);
  const topsBefore = await readTops(page);
  const personBefore = await pageTop(cards.person);
  const activityBefore = await pageTop(cards.activity);
  const since = (await readShiftEntries(page)).length;

  await reset.click();
  // THE BUSY BUTTON IS INSIDE THE READING, as a slow network would put it: the
  // answer is held until it has painted.
  await expect(reset).toBeDisabled();
  await settleFrames(page);
  expect(movedBetween(topsBefore, await readTops(page)), 'what moved while the reset was busy').toEqual([]);
  answer.open();
  const link = page.locator('main p.font-mono').filter({ hasText: RESET_LINK });
  await expect(link).toBeVisible();
  await page.waitForTimeout(LATE_ARRIVAL_WATCH_MS);
  await settleFrames(page);

  expect(movedBetween(topsBefore, await readTops(page)), 'what moved in the details').toEqual([]);
  expect(await pageTop(cards.person), 'the details card').toBe(personBefore);
  expect(await pageTop(cards.activity), 'the activity card').toBe(activityBefore);
  const entries = await readShiftEntries(page);
  expect(shiftScoreAfter(entries, since), `layout-shift: ${JSON.stringify(entries.slice(since))}`).toBe(0);
  // The administrator sees the link without hunting for it.
  await expect(link).toBeInViewport();
  expect(stub.unanswered).toEqual([]);
});

test('the control: a line grown above the details moves them, and both readings see it', async ({ page }) => {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  const stub = adminConsoleStub();
  stub.handedLink = RESET_LINK;
  await signInAsAdministrator(page, stub);
  await openResetButton(page);
  const cards = detailCards(page);
  const topsBefore = await readTops(page);
  const personBefore = await pageTop(cards.person);
  const since = (await readShiftEntries(page)).length;

  // What the page used to do: a box inserted above the details.
  await cards.person.evaluate((node) => {
    const grown = document.createElement('p');
    grown.textContent = 'control line';
    grown.style.height = '40px';
    node.before(grown);
  });
  await settleFrames(page);

  expect(movedBetween(topsBefore, await readTops(page)).length).toBeGreaterThan(0);
  expect(await pageTop(cards.person)).toBeGreaterThan(personBefore);
  await expect
    .poll(async () => shiftScoreAfter(await readShiftEntries(page), since), {
      message: 'the browser must record the grown line as a layout shift',
    })
    .toBeGreaterThan(0);
});
