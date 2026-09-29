/**
 * The order page links widerrufen (M265 spec 05).
 *
 * The biller's withdrawal notice names two pages. It prints the address of the
 * § 356a BGB withdrawal function, `https://<host>/widerrufen`, inside its own
 * sentence, and ends on the page with the instruction and the model form,
 * which the app links with a label of its own. Before this spec the printed
 * address stayed inert text: a person could read where to withdraw and could
 * not go there.
 *
 * The sentence is the biller's and stays byte-identical. The app turns the
 * address it prints into a link to its own `/widerrufen` route, with the
 * address itself as the link text. No offer field and no biller change is
 * involved, so an old app and a new app both work with the live biller.
 *
 * No assertion pins a live sentence. The notice here is a fixture sentence
 * with an address in it, on a host that is not openplate's, because the rule
 * is "any https address of that page", not one host. THE CONTROL is the
 * neutral fixture offer, whose notice holds no address: it keeps exactly the
 * one link it had.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { installShiftObserver, readShiftEntries, settleAnimations, settleFrames, shiftScoreAfter } from './layout-shift';
import { FIXTURE_OFFER_BODY, NO_SUBSCRIPTION_VIEW, openPlanPageSignedIn, routePlansCore } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** The address a notice prints, on a host that is deliberately not openplate's. */
const ADDRESS = 'https://plans.example.org/widerrufen';

/** A fixture notice that prints the address mid-sentence, followed by a full stop, as the live texts do. */
const NOTICE_WITH_ADDRESS = `Fixture withdrawal notice. Declare it online at ${ADDRESS}. The fixture form is on the page:`;

/** The part of the fixture offer this spec rewrites and reads, validated rather than asserted. */
const fixtureSchema = z.looseObject({
  texts: z.looseObject({ withdrawal: z.string() }),
  links: z.looseObject({ withdrawal: z.string() }),
});

const FIXTURE = fixtureSchema.parse(JSON.parse(FIXTURE_OFFER_BODY));

/** The fixture offer with a notice that prints the address, every other byte as the fixture has it. */
const OFFER_WITH_ADDRESS = JSON.stringify({ ...FIXTURE, texts: { ...FIXTURE.texts, withdrawal: NOTICE_WITH_ADDRESS } });

function notice(page: Page): Locator {
  return page.locator('[data-slot="plan-order-withdrawal"]');
}

/** Every link in the notice whose address ends in `/widerrufen`. */
function widerrufenLinks(page: Page): Locator {
  return notice(page).locator('a[href$="/widerrufen"]');
}

/** Every shift this document recorded, as one readable failure message. */
async function shiftDetail(page: Page, since: number): Promise<string> {
  const entries = (await readShiftEntries(page)).slice(since);
  return entries.map((entry) => `${entry.value.toFixed(4)}: ${entry.sources.join('; ')}`).join('\n');
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

test('the order page links widerrufen: the printed address is a link to the withdrawal function', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: OFFER_WITH_ADDRESS });
  await openPlanPageSignedIn(page);
  await expect(notice(page)).toBeVisible();
  const since = (await readShiftEntries(page)).length;

  // THE CLAIM: one anchor inside the notice goes to `/widerrufen`, and it
  // reads as the address the biller printed.
  await expect(widerrufenLinks(page), 'the notice links no /widerrufen page').toHaveCount(1);
  await expect(widerrufenLinks(page)).toHaveText(ADDRESS);

  // THE SENTENCE IS THE BILLER'S, byte for byte. The link sits inside it, and
  // the app's own link to the instruction page follows it as before.
  const text = await notice(page).evaluate((node) => node.textContent ?? '');
  expect(text).toBe(`${NOTICE_WITH_ADDRESS} ${EN.plan.order.withdrawalLink}`);
  await expect(notice(page).getByRole('link', { name: EN.plan.order.withdrawalLink, exact: true })).toHaveAttribute(
    'href',
    FIXTURE.links.withdrawal,
  );

  // The link is inline, inside the paragraph's own box, and drawing it moved nothing.
  const [paragraph, link] = await Promise.all([
    notice(page).evaluate((node) => node.getBoundingClientRect().toJSON()),
    widerrufenLinks(page).evaluate((node) => node.getBoundingClientRect().toJSON()),
  ]);
  expect(link.top).toBeGreaterThanOrEqual(paragraph.top);
  expect(link.bottom).toBeLessThanOrEqual(paragraph.bottom);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await settleAnimations(page);
  await settleFrames(page);
  expect(shiftScoreAfter(await readShiftEntries(page), since), await shiftDetail(page, since)).toBe(0);

  // CONTROL: the same reading sees a line pushed in above the notice.
  const controlSince = (await readShiftEntries(page)).length;
  await notice(page).evaluate((node) => {
    const line = document.createElement('p');
    line.textContent = 'control line';
    line.style.height = '40px';
    node.before(line);
  });
  await expect
    .poll(async () => shiftScoreAfter(await readShiftEntries(page), controlSince), {
      message: 'CONTROL: an injected line must register a layout shift',
    })
    .toBeGreaterThan(0);
});

test('CONTROL: a notice with no address keeps its one link and gains none', async ({ page }) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page);
  await expect(notice(page)).toBeVisible();

  await expect(widerrufenLinks(page)).toHaveCount(0);
  await expect(notice(page).locator('a')).toHaveCount(1);
  const text = await notice(page).evaluate((node) => node.textContent ?? '');
  expect(text).toBe(`${FIXTURE.texts.withdrawal} ${EN.plan.order.withdrawalLink}`);
});
