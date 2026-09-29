/**
 * "Send again" on the invitations tab shows what a fresh invitation shows.
 *
 * ── WHAT A FAMILY SERVER WITHOUT MAIL GOT ─────────────────────────────────
 *
 * A resend mints a new link and the old one stops working. On an instance
 * without mail the core hands that new link back (`emailed: false`), and the
 * tab threw it away: it re-read the list, and the administrator was left with
 * a dead link in somebody's chat and no new one to send. On an instance with
 * mail the tab said nothing either, so nobody could tell a resend went out.
 *
 * ── WHAT THIS PROVES ─────────────────────────────────────────────────────
 *
 * - Without mail, a resend shows the new link to copy, in the same card a new
 *   invitation gets, with the origin warning when the link names another
 *   address, and "Back to the list" returns to the list.
 * - The card replaces the list: from the press, through the busy button (the
 *   answer is held until it has painted), to the settled result, nothing moves
 *   and the browser records no layout shift. Before this change the busy
 *   button's spinner widened it and pushed "Withdraw" 22 px sideways. The control that
 *   shows these readings can fail in this console, with scroll anchoring off,
 *   is in `admin-link-names-another-address.spec.ts`.
 * - THE CONTROL: with mail, a resend says the letter went and shows no link.
 *
 * On the code before this change the first test fails at the link: it is never
 * drawn, because the tab reloads the list instead.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { LONG_INVITE_EMAIL, adminConsoleStub, routeAdminConsole, type AdminConsoleStub } from './admin-console-stub';
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

/** The strings this file reads, from the shipped English bundle. No sentence is transcribed here. */
const COPY = z
  .object({
    admin: z.object({
      invite: z.object({ linkTitle: z.string(), sentTitle: z.string(), back: z.string(), linkCopy: z.string() }),
      invites: z.object({ resend: z.string() }),
      link: z.object({ otherAddress: z.string() }),
    }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** The address the compose files fall back to when PUBLIC_APP_URL is unset. */
const LOCALHOST_APP = 'http://localhost:3000';

/** The new link a core on the compose defaults hands back for a resend. */
const RESENT_LINK = `${LOCALHOST_APP}/join#server=http%3A%2F%2Flocalhost%3A3001&invite=si_e2e_resent`;

/** How long the result is watched after it is drawn, for a line that arrives a render late. */
const LATE_ARRIVAL_WATCH_MS = 500;

/** The pending invitation with the long address, as the list draws it. */
function longInviteRow(page: Page): Locator {
  return page.locator('main li').filter({ hasText: LONG_INVITE_EMAIL });
}

/** The link as the result card shows it, readable in full. */
function shownLink(page: Page, link: string): Locator {
  return page.locator('main p.font-mono').filter({ hasText: link });
}

function originWarning(page: Page): Locator {
  return page.locator('main [data-slot="link-origin-warning"]');
}

/** Signs the device in as an administrator, through the real sign-in, with every admin request routed. */
async function signInAsAdministrator(page: Page, stub: AdminConsoleStub): Promise<void> {
  await routeAdminConsole(page, stub);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  expect(stub.selfId, 'the sign-in answer must have named the account').not.toBeNull();
}

/** Opens the invitations tab and returns the long invitation's "Send again", scrolled into view and settled. */
async function openResendButton(page: Page): Promise<Locator> {
  await page.goto('/admin/invitations');
  await expect(longInviteRow(page)).toBeVisible({ timeout: 15_000 });
  const resend = longInviteRow(page).getByRole('button', { name: COPY.admin.invites.resend, exact: true });
  await resend.scrollIntoViewIfNeeded();
  await settleAnimations(page);
  return resend;
}

test('without mail, "Send again" shows the new link to copy, as a new invitation does, and moves nothing', async ({
  page,
}) => {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  const stub = adminConsoleStub();
  stub.handedLink = RESENT_LINK;
  const answer = createGate();
  stub.writeGate = answer.promise;
  await signInAsAdministrator(page, stub);
  const resend = await openResendButton(page);
  const topsBefore = await readTops(page);
  const since = (await readShiftEntries(page)).length;

  await resend.click();
  // THE BUSY BUTTON IS INSIDE THE READING: the answer is held until it has
  // painted, so a spinner that widened it would push its neighbour here.
  await expect(resend).toBeDisabled();
  await settleFrames(page);
  expect(movedBetween(topsBefore, await readTops(page)), 'what moved while the resend was busy').toEqual([]);
  answer.open();

  // THE NEW LINK, in the card a fresh invitation gets.
  await expect(shownLink(page, RESENT_LINK)).toBeVisible();
  await expect(page.getByText(COPY.admin.invite.linkTitle.replace('{{email}}', LONG_INVITE_EMAIL))).toBeVisible();
  await expect(page.getByRole('button', { name: COPY.admin.invite.linkCopy, exact: true })).toBeVisible();
  // With the origin warning, because this link names another address.
  await expect(originWarning(page)).toHaveText(COPY.admin.link.otherAddress.replace('{{origin}}', LOCALHOST_APP));

  // Nothing that stayed on screen moved, and nothing arrived late.
  await page.waitForTimeout(LATE_ARRIVAL_WATCH_MS);
  await settleFrames(page);
  // `movedBetween` compares only what is in both readings: the list's own rows
  // are gone, which is a removal and not a move.
  expect(movedBetween(topsBefore, await readTops(page)), 'what moved when the result replaced the list').toEqual([]);
  const entries = await readShiftEntries(page);
  expect(shiftScoreAfter(entries, since), `layout-shift: ${JSON.stringify(entries.slice(since))}`).toBe(0);

  // "Back to the list" returns to the list the resend came from.
  await page.getByRole('button', { name: COPY.admin.invite.back, exact: true }).click();
  await expect(longInviteRow(page)).toBeVisible();
  await expect(shownLink(page, RESENT_LINK)).toHaveCount(0);
  expect(stub.unanswered, 'every admin request the page made was answered').toEqual([]);
});

test('the control: with mail, "Send again" says the letter went and shows no link', async ({ page }) => {
  const stub = adminConsoleStub();
  stub.sendsMail = true;
  await signInAsAdministrator(page, stub);
  const resend = await openResendButton(page);

  await resend.click();

  await expect(page.getByText(COPY.admin.invite.sentTitle.replace('{{email}}', LONG_INVITE_EMAIL))).toBeVisible();
  // After the positive anchor above, so an empty page cannot pass these.
  await expect(page.locator('main p.font-mono')).toHaveCount(0);
  await expect(page.getByRole('button', { name: COPY.admin.invite.linkCopy, exact: true })).toHaveCount(0);
  await expect(originWarning(page)).toHaveCount(0);
  expect(stub.unanswered).toEqual([]);
});
