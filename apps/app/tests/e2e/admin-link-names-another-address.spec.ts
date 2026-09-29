/**
 * A link the administrator passes on by hand says so when it opens another
 * address than the one they are using.
 *
 * ── WHAT A SELF-HOSTER GOT ───────────────────────────────────────────────
 *
 * The compose files default the core's `CLIENT_BASE_URL` and
 * `SERVER_PUBLIC_URL` to `http://localhost:3000` and `http://localhost:3001`
 * when `PUBLIC_APP_URL` and `PUBLIC_SYNC_URL` are unset. On an instance with no
 * mail, the invitation screen then handed the administrator
 * `http://localhost:3000/join#server=http%3A%2F%2Flocalhost%3A3001&invite=...`
 * to send to a family member, a link that opens nothing on any other device,
 * and nothing on the screen said so (`docker/quadlet/full/README.md` shows that
 * exact link from a real install).
 *
 * ── WHAT THIS PROVES ─────────────────────────────────────────────────────
 *
 * On the page's own origin (this tier's `http://127.0.0.1:<port>`):
 *
 * - an invitation whose link names `http://localhost:3000` shows one line
 *   under the link that names that address and the two settings to change;
 * - the line arrives with the link: from the press to the settled result, the
 *   browser records no layout shift and nothing already drawn moves;
 * - a reset link on a person's page gets the same line.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ────────────────────────────────────
 *
 * The control hands back a link on the page's own origin: the same locator
 * finds no line, after the link itself was found, so an empty page cannot pass
 * it. The layout readings have their own control, which grows a line above the
 * copy button in the live result and requires both readings to see it. That
 * control is why scroll anchoring is off here: with it on, the browser scrolled
 * the grown line away and recorded no shift (see `turnOffScrollAnchoring` in
 * `layout-shift.ts`). On the
 * code before this change, the first test fails at the warning line: it is
 * never drawn.
 *
 * ── WHAT IS ROUTED ───────────────────────────────────────────────────────
 *
 * The role and every admin request, through `admin-console-stub.ts`, which
 * says why. The link is the stub's `handedLink`, so the page gets exactly the
 * body a core with no mail sends. The session, the sign-in and the handshake
 * are the fake sync service's own.
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
      invite: z.object({ submit: z.string(), linkCopy: z.string() }),
      resetMail: z.object({ cta: z.string() }),
      link: z.object({ otherAddress: z.string() }),
    }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** The address the compose files fall back to when PUBLIC_APP_URL is unset. */
const LOCALHOST_APP = 'http://localhost:3000';

/** The invitation such a core builds. */
const LOCALHOST_INVITE_LINK = `${LOCALHOST_APP}/join#server=http%3A%2F%2Flocalhost%3A3001&invite=si_e2e_foreign`;

/** The same invitation, built by a core whose PUBLIC_APP_URL is the address this page runs on. */
const OWN_ORIGIN_INVITE_LINK = `${E2E_APP_URL}/join#server=http%3A%2F%2F127.0.0.1%3A3001&invite=si_e2e_own`;

/** A reset link from a core on the compose defaults. */
const LOCALHOST_RESET_LINK = `${LOCALHOST_APP}/reset#server=http%3A%2F%2Flocalhost%3A3001&token=sr_e2e_foreign`;

/** A reset link on this page's own origin. */
const OWN_ORIGIN_RESET_LINK = `${E2E_APP_URL}/reset#server=http%3A%2F%2F127.0.0.1%3A3001&token=sr_e2e_own`;

/**
 * How long a result is watched after it is drawn. A line that arrived one
 * render late (a `useEffect` that read the origin) lands within a frame or
 * two; this is many times that.
 */
const LATE_ARRIVAL_WATCH_MS = 500;

/** The warning line, by its slot: its wording belongs to the wordsmith, not to this file. */
function originWarning(page: Page): Locator {
  return page.locator('main [data-slot="link-origin-warning"]');
}

/** The link as the result card shows it, readable in full. */
function shownLink(page: Page, link: string): Locator {
  return page.locator('main p.font-mono').filter({ hasText: link });
}

/** The sentence the line must say for this origin, from the bundle. */
function warningFor(origin: string): string {
  return COPY.admin.link.otherAddress.replace('{{origin}}', origin);
}

/** Signs the device in as an administrator, through the real sign-in, with every admin request routed. */
async function signInAsAdministrator(page: Page, stub: AdminConsoleStub): Promise<void> {
  await routeAdminConsole(page, stub);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  expect(stub.selfId, 'the sign-in answer must have named the account').not.toBeNull();
}

/** Opens the invite form and types an address. Returns the submit button, scrolled into view and settled. */
async function openFilledInviteForm(page: Page): Promise<Locator> {
  await page.goto('/admin/invite');
  const email = page.locator('main input[name="email"]');
  await expect(email).toBeVisible({ timeout: 15_000 });
  await email.fill('bea@example.invalid');
  const submit = page.getByRole('button', { name: COPY.admin.invite.submit, exact: true });
  // IN VIEW BEFORE THE BASELINE: the browser reports a layout shift only inside
  // the viewport, and the press would scroll here anyway.
  await submit.scrollIntoViewIfNeeded();
  await settleAnimations(page);
  return submit;
}

test('an invitation link on another address than the page says so under the link, and nothing moves', async ({
  page,
}) => {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  const stub = adminConsoleStub();
  stub.handedLink = LOCALHOST_INVITE_LINK;
  await signInAsAdministrator(page, stub);
  const submit = await openFilledInviteForm(page);
  const since = (await readShiftEntries(page)).length;

  await submit.click();
  await expect(shownLink(page, LOCALHOST_INVITE_LINK)).toBeVisible();
  const topsAtFirstSight = await readTops(page);

  // ── The line: there, under the link, naming the address and the fix ─────
  await expect(originWarning(page)).toBeVisible();
  await expect(originWarning(page)).toHaveText(warningFor(LOCALHOST_APP));
  const linkBox = await shownLink(page, LOCALHOST_INVITE_LINK).boundingBox();
  const warningBox = await originWarning(page).boundingBox();
  const copyBox = await page.getByRole('button', { name: COPY.admin.invite.linkCopy, exact: true }).boundingBox();
  expect(linkBox && warningBox && copyBox, 'the link, the line and the copy button are all drawn').toBeTruthy();
  if (linkBox === null || warningBox === null || copyBox === null) return;
  expect(warningBox.y, 'the line sits under the link').toBeGreaterThanOrEqual(linkBox.y + linkBox.height);
  expect(copyBox.y, 'and above the copy button').toBeGreaterThanOrEqual(warningBox.y + warningBox.height);

  // ── And it arrived WITH the link: nothing moved once the result was drawn ─
  await page.waitForTimeout(LATE_ARRIVAL_WATCH_MS);
  await settleFrames(page);
  expect(movedBetween(topsAtFirstSight, await readTops(page)), 'what moved after the result was drawn').toEqual([]);
  const entries = await readShiftEntries(page);
  expect(
    shiftScoreAfter(entries, since),
    `layout-shift from the press to the settled result: ${JSON.stringify(entries.slice(since))}`,
  ).toBe(0);
  expect(stub.unanswered, 'every admin request the page made was answered').toEqual([]);
});

test('the control: an invitation link on the page origin draws no line, and the layout readings can see a line that grows', async ({
  page,
}) => {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  const stub = adminConsoleStub();
  stub.handedLink = OWN_ORIGIN_INVITE_LINK;
  await signInAsAdministrator(page, stub);
  const submit = await openFilledInviteForm(page);

  await submit.click();
  // The link first, so an empty result cannot pass the absence below.
  await expect(shownLink(page, OWN_ORIGIN_INVITE_LINK)).toBeVisible();
  await page.waitForTimeout(LATE_ARRIVAL_WATCH_MS);
  await expect(originWarning(page)).toHaveCount(0);
  expect(stub.unanswered).toEqual([]);

  // ── The layout readings above are able to fail ──────────────────────────
  // The same result, the same viewport, and a 40 px line grown between the
  // link and the copy button: what a late warning would do.
  const copy = page.getByRole('button', { name: COPY.admin.invite.linkCopy, exact: true });
  await copy.scrollIntoViewIfNeeded();
  await settleAnimations(page);
  const topsBefore = await readTops(page);
  const since = (await readShiftEntries(page)).length;
  await shownLink(page, OWN_ORIGIN_INVITE_LINK).evaluate((node) => {
    const grown = document.createElement('p');
    grown.textContent = 'control line';
    grown.style.height = '40px';
    node.after(grown);
  });
  await settleFrames(page);
  const topsAfter = await readTops(page);
  expect(
    movedBetween(topsBefore, topsAfter).length,
    `the grown line moved nothing that was read: ${JSON.stringify({ topsBefore, topsAfter })}`,
  ).toBeGreaterThan(0);
  await expect
    .poll(async () => shiftScoreAfter(await readShiftEntries(page), since), {
      message: 'the browser must record the grown line as a layout shift',
    })
    .toBeGreaterThan(0);
});

test("a reset link on a person's page says so too, and a reset link on the page origin does not", async ({ page }) => {
  const stub = adminConsoleStub();
  stub.handedLink = LOCALHOST_RESET_LINK;
  await signInAsAdministrator(page, stub);
  await page.goto(`/admin/people/${LONG_PERSON_ID}`);
  await expect(page.getByText(LONG_PERSON_EMAIL).first()).toBeVisible({ timeout: 15_000 });
  const reset = page.getByRole('button', { name: COPY.admin.resetMail.cta, exact: true });

  await reset.click();
  await expect(shownLink(page, LOCALHOST_RESET_LINK)).toBeVisible();
  await expect(originWarning(page)).toHaveText(warningFor(LOCALHOST_APP));

  // THE CONTROL, on the same page: the stub is read per request, so the next
  // press brings a link on this page's own origin, and the line goes with the
  // old link.
  stub.handedLink = OWN_ORIGIN_RESET_LINK;
  await reset.click();
  await expect(shownLink(page, OWN_ORIGIN_RESET_LINK)).toBeVisible();
  await expect(originWarning(page)).toHaveCount(0);
  expect(stub.unanswered).toEqual([]);
});
