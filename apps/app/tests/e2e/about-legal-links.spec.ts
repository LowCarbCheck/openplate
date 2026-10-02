/**
 * The legal pages, reached from inside the app.
 *
 * THE REPORT, owner, 2026-10-02: "even when I am logged in the app does not
 * render the imprint". The public footer draws the five legal links, but a
 * person who uses the app lives inside `_personal`, which has no footer, and
 * the settings pages had no legal row. `/settings/about` now draws a Legal
 * group, behind the footer's own gate (`useHasLegalPages`).
 *
 * The webServer in `playwright.config.ts` mounts `tests/fixtures/content`, so
 * the gate is open here and the imprint is the fixture's, titled
 * "Fixture imprint". The CLOSED gate (no `CONTENT_DIR`, no group) is proved in
 * `tests/unit/about-legal-links.test.tsx`: this tier boots one server and that
 * server has the folder.
 *
 * The person is a device past onboarding with no account, which is who the
 * report is about as much as anyone: the group does not depend on a session.
 *
 * ── EVERY CHECK HAS A CONTROL ──
 * The order check is read both ways, so a page that drew the group above the
 * provenance rows fails it. The no-shift reading is handed a block injected
 * above the group and must see it move.
 *
 * @area settings
 */
import { expect, test, type Page } from '@playwright/test';

import { completeOnboarding } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';

test.use({ serviceWorkers: 'block' });

/** The five links in the footer's order, and the smallest target a finger gets. */
const LEGAL_PATHS = ['/privacy', '/terms', '/imprint', '/kuendigung', '/widerrufen'] as const;
const TOUCH_TARGET_PX = 44;

/** The fixture's own title for `/imprint`, copied from `tests/fixtures/content/en/imprint.md`. */
const FIXTURE_IMPRINT_TITLE = 'Fixture imprint';

/** The group's section, found by its heading, so the selector says what a person sees. */
function legalGroup(page: Page) {
  return page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name: 'Legal', exact: true }) });
}

/** Opens About on a device past onboarding and waits until the group is drawn. */
async function openAbout(page: Page): Promise<void> {
  await completeOnboarding(page);
  await page.goto('/settings/about');
  await expect(page.getByRole('heading', { level: 2, name: 'Legal', exact: true })).toBeVisible();
}

test.describe('the Legal group on /settings/about', () => {
  test('lists the five footer links in order and the imprint opens the fixture page', async ({ page }) => {
    await openAbout(page);

    const group = legalGroup(page);
    await expect(group, 'exactly one Legal group').toHaveCount(1);
    const hrefs = await group.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(hrefs, 'the same five links as the footer, in its order').toEqual([...LEGAL_PATHS]);

    // TAP TARGETS: every row is a full-width link, at least a finger high.
    const heights = await group
      .locator('a[href]')
      .evaluateAll((links) => links.map((link) => Math.round(link.getBoundingClientRect().height)));
    for (const height of heights) {
      expect(height, `a legal row is ${height}px tall, heights: ${heights.join(', ')}`).toBeGreaterThanOrEqual(
        TOUCH_TARGET_PX,
      );
    }

    await group.locator('a[href="/imprint"]').click();
    await expect(page).toHaveURL(/\/imprint$/u);
    await expect(page.getByRole('heading', { level: 1, name: FIXTURE_IMPRINT_TITLE })).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(FIXTURE_IMPRINT_TITLE, 'u'));
  });

  test('the group sits below the provenance links, not above them', async ({ page }) => {
    await openAbout(page);

    // The last link that was on this page before the group: the release notes row.
    const lastExisting = page.locator('main a[href="/settings/whats-new"]');
    await expect(lastExisting).toBeVisible();
    const heading = page.getByRole('heading', { level: 2, name: 'Legal', exact: true });

    const existingTop = (await lastExisting.boundingBox())?.y;
    const headingTop = (await heading.boundingBox())?.y;
    expect(existingTop, 'the release notes link must be measurable').toBeDefined();
    expect(headingTop, 'the Legal heading must be measurable').toBeDefined();
    expect(headingTop ?? 0, 'the Legal heading is below the last existing link').toBeGreaterThan(existingTop ?? 0);
    // CONTROL: read the other way round, the same two numbers fail, so the line above can fail.
    expect((existingTop ?? 0) > (headingTop ?? 0), 'CONTROL: the existing link is not below the heading').toBe(false);
  });

  test('the group is there from the first paint and moves nothing while the page settles', async ({ page }) => {
    await installShiftObserver(page);
    await completeOnboarding(page);
    await page.goto('/settings/about');
    await expect(page.getByRole('heading', { level: 2, name: 'Legal', exact: true })).toBeVisible();
    // FROM HERE, not from the navigation: the header's brand word swaps from the
    // fallback face to the web font on every document load, which is not this
    // screen's doing (`no-shift-on-load.spec.ts` reads it the same way).
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await settleAnimations(page);

    const baseline = await readTops(page);
    const since = (await readShiftEntries(page)).length;
    // Long enough for the Updates card's own read of `/api/update-status` to answer.
    await page.waitForLoadState('networkidle');
    await settleFrames(page);

    const entries = await readShiftEntries(page);
    const detail = entries
      .slice(since)
      .flatMap((entry) => entry.sources)
      .join('\n');
    expect(movedBetween(baseline, await readTops(page)), `elements moved\n${detail}`).toEqual([]);
    expect(shiftScoreAfter(entries, since), `layout-shift score\n${detail}`).toBe(0);
    // NON-VACUITY: the baseline really did contain the group's links.
    expect(
      Object.keys(baseline).filter((key) => key.includes('Imprint')).length,
      'the baseline holds the imprint link',
    ).toBeGreaterThan(0);
  });

  test('CONTROL: a block injected above the group is seen by the same reading', async ({ page }) => {
    await installShiftObserver(page);
    await openAbout(page);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await settleAnimations(page);
    const baseline = await readTops(page);
    const since = (await readShiftEntries(page)).length;

    await page.evaluate(() => {
      const block = document.createElement('div');
      block.style.height = '40px';
      block.textContent = 'injected';
      document.querySelector('main section')?.before(block);
    });
    await settleFrames(page);

    const moves = movedBetween(baseline, await readTops(page));
    expect(moves.length, 'CONTROL: a block above must move the links below it').toBeGreaterThan(0);
    expect(
      moves.some((move) => move.element.includes('Imprint')),
      'CONTROL: the imprint link is among the moved elements',
    ).toBe(true);
    expect(
      shiftScoreAfter(await readShiftEntries(page), since),
      'CONTROL: the browser records the shift',
    ).toBeGreaterThan(0);
  });
});
