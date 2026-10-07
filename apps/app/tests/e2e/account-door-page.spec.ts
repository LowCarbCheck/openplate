/**
 * THE ACCOUNT DOOR (M266 design, steps 3 and 9, approved by the owner on 2026-09-29).
 *
 * THE DECISION. openplate.de sells and explains; every app host is a door and then the app.
 * So a managed instance's logged-out `/` stops being a second marketing page and becomes the
 * account door: the lockup, one sentence true of the instance, the doors the handshake allows,
 * the offer in its reserved box, and one quiet line to openplate.de in the reader's language.
 * No screenshots, no "how it works", no newsletter form, no `/dashboard` link. The header's two
 * doors step aside on `/`, so no door is drawn twice.
 *
 * WHAT IS REAL: the production build booted as a managed instance (`managed-app-server.ts`),
 * with a newsletter configured, so the old landing WOULD draw its form and the absence below is
 * a reading of the new page rather than of an instance that never had one. WHAT IS STUBBED:
 * `/health` (the fake core server has no open sign-up and sells nothing) and the anonymous
 * `GET /v1/plans/prices`, whose figures nobody charges.
 *
 * THE CONTROLS. An invite-only handshake draws no "Sign up" anywhere in the document and shows
 * "Invitation only" in the box the offer uses. The tier's own server is an OPEN instance: it
 * still draws the whole landing, with its screenshots and `/dashboard`, and no link to
 * openplate.de. Every layout reading carries a control that moves something and is seen.
 *
 * @area accounts-and-sign-in
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { LANGUAGE_COOKIE } from '../../app/i18n/language-prefs';
import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '../../app/lib/sync/engine/protocol';
import { E2E_CORE_URL } from './env';
import { useLanguage } from './helpers';
import {
  installShiftObserver,
  readShiftEntries,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { createGate, type Gate } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot, beside the tier's 30 s per spec. */
const BOOT_BUDGET_MS = 90_000;

/** The free scans the stubbed handshake promises. */
const TRIAL_SCANS = 10;

/**
 * The day limit the six-language walk's handshake promises beside the scans (M267), the
 * consumer instance's configuration. Its sentence is the longer one, so the reserve is measured
 * against it; measured on 2026-09-29, it fits the bands the scans-only sentence set.
 */
const TRIAL_DAYS = 14;

/** Figures nobody charges, in cents. */
const MONTHLY_CENTS = 321;
const YEARLY_CENTS = 2345;

/** The phone widths every reading is taken at: the narrowest phone, the design width, a large Android phone. */
const PHONE_WIDTHS = [320, 390, 412] as const;
const PHONE_HEIGHT = 800;

const LANGUAGES = ['en', 'de', 'fr', 'it', 'es', 'tr'] as const;
type Language = (typeof LANGUAGES)[number];

/**
 * THE PROJECT SITE IN EACH LANGUAGE, written out rather than computed. German owns the
 * unprefixed paths on openplate.de; every other language lives under its prefix, with no
 * trailing slash, the site's canonical form (`app/i18n/language.ts` in LowCarbCheck/openplate-website). A spec that
 * computed these with the app's own function would agree with any bug in it.
 */
const SITE_BY_LANGUAGE = {
  de: 'https://openplate.de/',
  en: 'https://openplate.de/en',
  fr: 'https://openplate.de/fr',
  it: 'https://openplate.de/it',
  es: 'https://openplate.de/es',
  tr: 'https://openplate.de/tr',
} satisfies Record<Language, string>;

/** A newsletter the managed server is told it has, so the old landing would draw the form. */
const NEWSLETTER_ENV = {
  NEWSLETTER_SUBSCRIBE_URL: 'http://127.0.0.1:9/subscribe',
  NEWSLETTER_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
};

/** The keys this spec reads from every shipped catalog, so a renamed key fails here on load. */
const doorCopySchema = z.looseObject({
  chrome: z.object({ signUp: z.string(), signIn: z.string() }),
  signupOffer: z.object({ scans_other: z.string(), prices: z.string() }),
  signUp: z.object({ title: z.string() }),
  welcome: z.object({ managed: z.object({ haveInvite: z.string(), pasteLabel: z.string() }) }),
  landing: z.object({ cta: z.object({ tryIt: z.string() }) }),
});

type DoorCopy = z.infer<typeof doorCopySchema>;

/** The English source of the one line the translations have not reached yet, read from `en` alone. */
const englishOnlySchema = z.looseObject({ accountDoor: z.object({ inviteOnly: z.string() }) });

/** One shipped catalog, as raw text. Each schema below parses what it reads from it. */
function catalogText(language: Language): string {
  return readFileSync(resolve(process.cwd(), `app/i18n/locales/${language}/common.json`), 'utf8');
}

function doorCopy(language: Language): DoorCopy {
  return doorCopySchema.parse(JSON.parse(catalogText(language)));
}

const COPY = {
  en: doorCopy('en'),
  de: doorCopy('de'),
  fr: doorCopy('fr'),
  it: doorCopy('it'),
  es: doorCopy('es'),
  tr: doorCopy('tr'),
} satisfies Record<Language, DoorCopy>;
const EN = COPY.en;
const EN_ONLY = englishOnlySchema.parse(JSON.parse(catalogText('en')));

/** The door page's own boxes. */
const DOORS = '[data-slot="account-door-doors"]';
const SMALL_PRINT = '[data-slot="account-door-small-print"]';
const SITE_LINE = '[data-slot="account-door-site-line"]';
const FOOTER_SITE_LINK = 'footer a[data-slot="footer-project-site"]';

/** What the stubbed `/health` says. */
interface HandshakeStub {
  openSignup: boolean;
  plans: boolean;
  gate?: Promise<void>;
  /** `instance.trial.days`, or absent for a trial with no day limit (M267). */
  trialDays?: number;
}

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer({ extraEnv: NEWSLETTER_ENV });
});

test.afterAll(async () => {
  await server.stop();
});

/** Answers `/health` for the managed server's sync origin. */
async function routeHandshake(page: Page, stub: HandshakeStub): Promise<void> {
  await page.route(`${E2E_CORE_URL}/health`, async (route) => {
    await stub.gate;
    await route.fulfill({
      json: {
        protocolVersion: PROTOCOL_VERSION,
        envelopeVersion: ENVELOPE_VERSION,
        serviceVersion: 'fake-e2e',
        instance: {
          name: 'openplate-e2e',
          language: 'en',
          mail: true,
          memberInvites: false,
          plans: stub.plans,
          openSignup: stub.openSignup,
          ai: { model: 'e2e-model' },
          trial: stub.trialDays === undefined ? { scans: TRIAL_SCANS } : { scans: TRIAL_SCANS, days: stub.trialDays },
        },
      },
    });
  });
}

/** Answers the anonymous price read, held by `gate` when one is given, and counts the reads. */
async function routePrices(page: Page, gate?: Gate): Promise<{ reads: number }> {
  const seen = { reads: 0 };
  await page.route(`${E2E_CORE_URL}/v1/plans/prices`, async (route) => {
    seen.reads += 1;
    await gate?.promise;
    await route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' },
      json: {
        currency: 'EUR',
        plans: [
          { key: 'monthly', interval: 'month', grossCents: MONTHLY_CENTS },
          { key: 'yearly', interval: 'year', grossCents: YEARLY_CENTS },
        ],
      },
    });
  });
  return seen;
}

/** Waits for fonts and animations, so a shift baseline is not taken inside a font swap. */
async function settleForBaseline(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await settleAnimations(page);
}

/** What overflows at the current width: the document, and any door or line wider than the screen. */
async function readOverflow(page: Page): Promise<{ documentWidth: number; viewportWidth: number; outside: string[] }> {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const outside = [
      ...document.querySelectorAll(
        '[data-slot="account-door-page"] a, [data-slot="account-door-page"] button, [data-slot="account-door-page"] p',
      ),
    ]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        return rect.left < 0 || rect.right > viewportWidth || element.scrollWidth > element.clientWidth + 1;
      })
      .map((element) => `${element.tagName} "${(element.textContent ?? '').trim().slice(0, 40)}"`);
    return { documentWidth: document.documentElement.scrollWidth, viewportWidth, outside };
  });
}

// ─── an instance that takes sign-ups and sells plans ────────────────────────

test('the door on an open, paid instance draws one "Sign up", one "Sign in", the offer and the way to openplate.de, and none of the landing', async ({
  page,
}) => {
  await routeHandshake(page, { openSignup: true, plans: true });
  await routePrices(page);
  await page.goto(`${server.url}/`);

  const signUp = page.getByRole('link', { name: EN.chrome.signUp, exact: true });
  const signIn = page.getByRole('link', { name: EN.chrome.signIn, exact: true });
  await expect(signUp).toBeVisible({ timeout: 10_000 });
  // ONE OF EACH ON THE WHOLE PAGE: the header's pair steps aside on `/`, so these counts would be
  // two each if the header still drew its doors beside the page's.
  await expect(signUp).toHaveCount(1);
  await expect(signIn).toHaveCount(1);
  await expect(signUp).toHaveAttribute('href', '/sign-up');
  await expect(signIn).toHaveAttribute('href', '/sign-in');
  // The filled door is the sign-up form, and it comes first.
  await expect(page.locator(`${DOORS} a:visible`).first()).toHaveText(EN.chrome.signUp);
  await expect(page.locator(`${DOORS} a:visible[data-door="primary"]`)).toHaveText(EN.chrome.signUp);

  await expect(page.locator(`${SMALL_PRINT} [data-slot="signup-offer-scans"]`)).toHaveText(
    EN.signupOffer.scans_other.replace('{{count}}', String(TRIAL_SCANS)),
  );
  await expect(page.locator(`${SMALL_PRINT} [data-slot="signup-offer-prices"]`)).toContainText('€3.21');

  // THE WAY TO THE PITCH, in English, twice: the line under the doors and the footer.
  await expect(page.locator(`${SITE_LINE} a`)).toHaveAttribute('href', SITE_BY_LANGUAGE.en);
  await expect(page.locator(`${SITE_LINE} a`)).toHaveText('openplate.de');
  await expect(page.locator(FOOTER_SITE_LINK)).toHaveAttribute('href', SITE_BY_LANGUAGE.en);

  // NONE OF THE LANDING. The anchors above say the door is drawn, so these absences are readings.
  await expect(page.locator('#newsletter-consent'), 'a newsletter form on the account door').toHaveCount(0);
  await expect(page.locator('main img[src*="/landing/"], main source[srcset*="/landing/"]')).toHaveCount(0);
  await expect(page.locator('a[href="/dashboard"]')).toHaveCount(0);
  await expect(page.locator('#how'), 'a "how it works" section').toHaveCount(0);

  const fit = await readOverflow(page);
  expect(fit.outside, 'a door or a line wider than the screen').toEqual([]);
  expect(fit.documentWidth).toBeLessThanOrEqual(fit.viewportWidth);

  // THE CONTROL: the same reader names a line that is wider than the screen. Without this the
  // empty list above could be a reader that sees nothing.
  await page.locator(`${SITE_LINE}`).evaluate((node) => {
    if (!(node instanceof HTMLElement)) throw new Error('the site line is not an HTML element');
    node.style.whiteSpace = 'nowrap';
    node.style.width = '900px';
  });
  expect((await readOverflow(page)).outside.length, 'the overflow reader missed a 900 px line').toBeGreaterThan(0);
});

test('a pricing-page link with ?plan=yearly&lang=fr still reaches /sign-up in French, plan kept', async ({ page }) => {
  await routeHandshake(page, { openSignup: true, plans: true });
  await routePrices(page);
  await page.goto(`${server.url}/?plan=yearly&lang=fr`);

  // The language switch ran: the document was reloaded in French, and only `lang` left the address.
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr', { timeout: 10_000 });
  await expect(page).toHaveURL(`${server.url}/?plan=yearly`);
  const signUp = page.getByRole('link', { name: COPY.fr.chrome.signUp, exact: true });
  await expect(signUp).toHaveAttribute('href', '/sign-up?plan=yearly', { timeout: 10_000 });
  // The French page's way to the site is the French one.
  await expect(page.locator(`${SITE_LINE} a`)).toHaveAttribute('href', SITE_BY_LANGUAGE.fr);

  await signUp.click();
  await page.waitForURL(`${server.url}/sign-up?plan=yearly`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByText(COPY.fr.signUp.title)).toBeVisible();
});

for (const language of LANGUAGES) {
  test(`the door moves nothing while the doors and the offer arrive, fits, and links the ${language} site, at 320, 390 and 412 px`, async ({
    page,
  }) => {
    await page.context().addCookies([{ name: LANGUAGE_COOKIE, value: language, url: server.url }]);
    await installShiftObserver(page);
    for (const width of PHONE_WIDTHS) {
      const where = `${language} at ${width} px`;
      await page.unrouteAll({ behavior: 'wait' });
      await page.setViewportSize({ width, height: PHONE_HEIGHT });
      const health = createGate();
      const prices = createGate();
      await routeHandshake(page, { openSignup: true, plans: true, gate: health.promise, trialDays: TRIAL_DAYS });
      await routePrices(page, prices);

      await page.goto(`${server.url}/`);
      const below = page.locator(SITE_LINE);
      await expect(below, `${where}: the door page is not drawn`).toBeVisible({ timeout: 10_000 });
      // IN VIEW FIRST: the browser records no layout shift for a box outside the viewport.
      await below.scrollIntoViewIfNeeded();
      await settleForBaseline(page);
      // BEFORE THE HANDSHAKE: no door is visible yet, so the reading below spans its arrival.
      await expect(page.getByRole('link', { name: COPY[language].chrome.signUp, exact: true })).toHaveCount(0);
      const belowTop = (await below.boundingBox())?.y;
      const since = (await readShiftEntries(page)).length;

      health.open();
      await expect(page.getByRole('link', { name: COPY[language].chrome.signUp, exact: true })).toBeVisible();
      await expect(page.locator(`${SMALL_PRINT} [data-slot="signup-offer-scans"]`)).toBeVisible();
      // The day limit's sentence is the one on screen, so the reading below is taken against it.
      await expect(page.locator(`${SMALL_PRINT} [data-slot="signup-offer-scans"]`)).toContainText(String(TRIAL_DAYS));
      prices.open();
      await expect(page.locator(`${SMALL_PRINT} [data-slot="signup-offer-prices"]`)).toBeVisible();
      await settleFrames(page);

      expect((await below.boundingBox())?.y, `${where}: the line under the doors moved`).toBe(belowTop);
      expect(shiftScoreAfter(await readShiftEntries(page), since), `${where}: layout-shift`).toBe(0);

      const fit = await readOverflow(page);
      expect(fit.outside, `${where}: a door or a line wider than the screen`).toEqual([]);
      expect(fit.documentWidth, `${where}: the page is wider than the screen`).toBeLessThanOrEqual(fit.viewportWidth);

      await expect(page.locator(`${SITE_LINE} a`)).toHaveAttribute('href', SITE_BY_LANGUAGE[language]);
      await expect(page.locator(FOOTER_SITE_LINK)).toHaveAttribute('href', SITE_BY_LANGUAGE[language]);
    }

    // THE CONTROL: a line that does grow above the reading point is seen by both readings, so the
    // zeros above are a page that held still.
    const below = page.locator(SITE_LINE);
    const topBefore = (await below.boundingBox())?.y;
    const beforeControl = (await readShiftEntries(page)).length;
    await page.locator(SMALL_PRINT).evaluate((node) => {
      const grown = document.createElement('p');
      grown.textContent = 'control line';
      grown.style.height = '40px';
      node.before(grown);
    });
    await settleFrames(page);
    expect((await below.boundingBox())?.y).not.toBe(topBefore);
    await expect.poll(async () => shiftScoreAfter(await readShiftEntries(page), beforeControl)).toBeGreaterThan(0);
  });
}

// ─── the controls ────────────────────────────────────────────────────────────

test('the control: an invite-only instance draws no "Sign up" anywhere, and says "Invitation only" in the same box', async ({
  page,
}) => {
  await installShiftObserver(page);
  await page.setViewportSize({ width: 390, height: PHONE_HEIGHT });
  const health = createGate();
  await routeHandshake(page, { openSignup: false, plans: true, gate: health.promise });
  const prices = await routePrices(page);
  await page.goto(`${server.url}/`);

  const below = page.locator(SITE_LINE);
  await expect(below, 'the door page is not drawn').toBeVisible({ timeout: 10_000 });
  await below.scrollIntoViewIfNeeded();
  await settleForBaseline(page);
  const belowTop = (await below.boundingBox())?.y;
  const since = (await readShiftEntries(page)).length;

  health.open();
  const inviteOnly = page.locator(SMALL_PRINT).getByText(EN_ONLY.accountDoor.inviteOnly, { exact: true });
  await expect(inviteOnly).toBeVisible({ timeout: 10_000 });
  // "Sign in" leads, and the second door is the invite link.
  const signIn = page.getByRole('link', { name: EN.chrome.signIn, exact: true });
  await expect(signIn).toHaveCount(1);
  await expect(page.locator(`${DOORS} a:visible[data-door="primary"]`)).toHaveText(EN.chrome.signIn);
  const haveInvite = page.getByRole('button', { name: EN.welcome.managed.haveInvite, exact: true });
  await expect(haveInvite).toBeVisible();
  await settleFrames(page);

  // NO "SIGN UP" IN THE DOCUMENT AT ALL, hidden or not: a reserved label would still be a claim.
  await expect(page.locator('a[href^="/sign-up"]')).toHaveCount(0);
  expect(await page.evaluate((label) => document.body.textContent?.includes(label), EN.chrome.signUp)).toBe(false);
  // No offer, and no price asked for.
  await expect(page.locator('[data-slot="signup-offer"]')).toHaveCount(0);
  expect(prices.reads, 'an invite-only door asked for the prices').toBe(0);
  // The line took the offer's box, so nothing under it moved when the handshake answered.
  expect((await below.boundingBox())?.y, 'the line under the doors moved').toBe(belowTop);
  expect(shiftScoreAfter(await readShiftEntries(page), since), 'layout-shift as the handshake answered').toBe(0);

  // THE SECOND DOOR OPENS THE PASTE BOX in place of the doors, and nothing above the tap moves.
  const lead = page.locator('[data-slot="account-door-lead"]');
  const leadTop = (await lead.boundingBox())?.y;
  const doorsTop = (await page.locator(DOORS).boundingBox())?.y;
  await haveInvite.click();
  await expect(page.getByLabel(EN.welcome.managed.pasteLabel)).toBeVisible();
  expect((await lead.boundingBox())?.y, 'the sentence above the tap moved').toBe(leadTop);
  expect((await page.locator('[data-slot="account-door-paste"]').boundingBox())?.y, 'the box opened elsewhere').toBe(
    doorsTop,
  );
});

test('the control: a self-hosted open instance still draws the whole landing, and no way to openplate.de', async ({
  page,
}) => {
  // The tier's own server is an OPEN instance.
  await page.goto('/');
  await expect(page.locator('main a[href="/dashboard"]').first()).toHaveText(EN.landing.cta.tryIt);
  await expect(page.locator('#how')).toHaveCount(1);
  await expect(page.locator('main img[src*="/landing/"]').first()).toBeAttached();
  await expect(page.locator('[data-slot="account-door-page"]')).toHaveCount(0);
  // The footer is drawn (its Source link is the anchor), and it names no project site.
  await expect(page.locator('footer a[href*="github.com"]').first()).toBeVisible();
  await expect(page.locator('a[href^="https://openplate.de"]')).toHaveCount(0);
  await expect(page.locator(FOOTER_SITE_LINK)).toHaveCount(0);
});

/**
 * Which capture folder each language's landing draws from: its own where one exists (English and
 * German today), English for a language with none. French is the fallback case.
 */
const SHOT_FOLDERS: readonly { language: Language; folder: string }[] = [
  { language: 'en', folder: '/landing/en/' },
  { language: 'de', folder: '/landing/de/' },
  { language: 'fr', folder: '/landing/en/' },
];

for (const { language, folder } of SHOT_FOLDERS) {
  test(`the open landing draws its screenshots from ${folder} for a ${language} reader`, async ({ page }) => {
    await useLanguage(page, language);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    const sources = await page
      .locator('main img[src*="/landing/"]')
      .evaluateAll((images) => images.map((image) => image.getAttribute('src') ?? ''));
    expect(sources.length, 'the landing draws no screenshot at all').toBeGreaterThan(0);
    const elsewhere = sources.filter((source) => !source.startsWith(folder));
    expect(elsewhere, `a ${language} landing drew a capture from another folder`).toEqual([]);
  });
}
