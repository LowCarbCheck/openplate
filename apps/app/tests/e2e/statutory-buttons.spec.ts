/**
 * The two statutory buttons (M214/09): § 312k BGB's `Verträge hier kündigen`
 * and § 356a BGB's `Vertrag widerrufen`, both reachable with no account, both
 * carrying the exact labels the statutes demand.
 *
 * ── FRESH CONTEXT, NO ACCOUNT ──────────────────────────────────────────────
 *
 * Every Playwright `test()` already gets an isolated context (no shared
 * storage state in `playwright.config.ts`), so a plain `page.goto` is already
 * a device that has never signed in and never completed onboarding — the
 * same guarantee `first-visit.spec.ts` relies on. `_public.tsx` carries no
 * gate of any kind (ADR-0006: no accounts, no `_auth` layout), so "does not
 * redirect" is asserted by comparing the landed URL against the one visited.
 *
 * ── THE POST IS MOCKED AT THE NETWORK LEVEL ───────────────────────────────
 *
 * `page.route` answers BOTH the browser's CORS preflight (`OPTIONS`, required
 * because the request carries `Content-Type: application/json`, which is not
 * CORS-safelisted) and the `POST` itself — `connect-stub-ai-provider`'s own
 * header note records the same preflight requirement for a cross-origin
 * fetch. No real `openplate-core` is reached; this spec asserts what the PWA
 * does with the receipt, not the transport.
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import { z } from 'zod';

import { E2E_SYNC_SERVER_URL } from './env';
import { useLanguage } from './helpers';

/** The statutory labels, byte for byte — § 312k BGB and § 356a BGB. Never sourced from a catalog: they must not drift with a wordsmith pass. */
const CANCEL_TITLE = 'Verträge hier kündigen';
const CANCEL_SUBMIT = 'jetzt kündigen';
const WITHDRAW_TITLE = 'Vertrag widerrufen';
const WITHDRAW_SUBMIT = 'Widerruf bestätigen';

/**
 * The receipt titles, from the FIXTURE content folder the webServer mounts
 * (`tests/fixtures/content/de`, M246). The real titles are in private files;
 * what is asserted here is that the page draws its file's title, not a word.
 */
const CANCEL_RECEIPT_TITLE = 'Fixture-Kündigungsbeleg';
const WITHDRAW_RECEIPT_TITLE = 'Fixture-Widerrufsbeleg';
/** The fixture's `mail-notice` section, which the receipt draws after its lines. */
const MAIL_NOTICE = 'Fixture-Hinweis zur Bestätigung per E-Mail.';

/** What a § 312k confirmation page must never carry (design section 1 and the milestone's Requirements). */
const RETENTION_WORDS = ['Rabatt', 'Angebot', 'pausieren', 'Umfrage', 'Support'];

const DECLARATIONS_PATH = '/v1/legal/declarations';
const RECEIPT_ID = 'e2e-9f2c9b1a-0000-4000-8000-000000000000';
/** A full instant with an explicit offset, so the page's `dateStyle: 'long', timeStyle: 'long'` render has both a date and a time to show. */
const RECEIVED_AT = '2026-09-21T14:30:00+02:00';

/** The one field of a posted declaration these checks read. */
const postedLanguageSchema = z.object({ language: z.string() });

/**
 * The languages an older openplate-core accepts: `de` and `en` only, before
 * 2026-09-30. It refuses any other with the `400` the route still gives for
 * a language outside its list.
 */
const OLDER_CORE_LANGUAGES: readonly string[] = ['de', 'en'];

/**
 * Answers the preflight and the POST for one declaration kind, on
 * `openplate-core`'s own origin, and records the language of every POST.
 *
 * @param options.acceptedLanguages - answer a `400` naming `language` for any
 *   other, as a core older than the six languages does. Absent accepts all.
 */
async function mockDeclarationsEndpoint(
  page: Page,
  kind: 'kuendigung' | 'widerruf',
  options: { acceptedLanguages?: readonly string[] } = {},
): Promise<string[]> {
  const languages: string[] = [];
  await page.route(`${E2E_SYNC_SERVER_URL}${DECLARATIONS_PATH}`, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
      return;
    }
    const { language } = postedLanguageSchema.parse(route.request().postDataJSON());
    languages.push(language);
    if (options.acceptedLanguages !== undefined && !options.acceptedLanguages.includes(language)) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'declaration-invalid', field: 'language' }),
      });
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ receiptId: RECEIPT_ID, receivedAt: RECEIVED_AT, kind }),
    });
  });
  return languages;
}

/** The four languages the forms narrowed to German before 2026-09-30. */
const NEWER_LANGUAGES = ['fr', 'it', 'es', 'tr'] as const;

/** The two forms, each with its statutory submit label and where it lands. */
const FORMS = [
  { path: '/kuendigung', kind: 'kuendigung', submit: CANCEL_SUBMIT },
  { path: '/widerrufen', kind: 'widerruf', submit: WITHDRAW_SUBMIT },
] as const;

test.describe('the two statutory buttons', () => {
  test('/kuendigung is reachable with no account, carries the exact § 312k labels, and does not redirect', async ({
    page,
  }) => {
    await page.goto('/kuendigung');
    await expect(page).toHaveURL(/\/kuendigung$/u);
    await expect(page.getByRole('heading', { name: CANCEL_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: CANCEL_SUBMIT, exact: true })).toBeVisible();
  });

  test('/widerrufen is reachable with no account, carries the exact § 356a labels, and does not redirect', async ({
    page,
  }) => {
    await page.goto('/widerrufen');
    await expect(page).toHaveURL(/\/widerrufen$/u);
    await expect(page.getByRole('heading', { name: WITHDRAW_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: WITHDRAW_SUBMIT, exact: true })).toBeVisible();
  });

  test('submitting /kuendigung reaches the confirmation page with the received date and time, and carries no retention offer', async ({
    page,
  }) => {
    // German: the banned-word control is a German vocabulary list, so the
    // render has to be in the language that could contain it.
    await useLanguage(page, 'de');
    await mockDeclarationsEndpoint(page, 'kuendigung');

    await page.goto('/kuendigung');
    await page.locator('input[name="name"]').fill('Erika Musterfrau');
    await page.locator('input[name="email"]').fill('erika@example.invalid');
    await page.getByRole('button', { name: CANCEL_SUBMIT, exact: true }).click();

    await page.waitForURL(/\/kuendigung\/bestaetigt$/u);
    // Waits for the CONFIRMATION page's own heading, not the URL: the URL
    // updates before React finishes swapping the article's content, and a
    // one-shot `innerText()` read right after `waitForURL` can still catch
    // the form's stale DOM for a frame.
    await expect(page.getByRole('heading', { name: CANCEL_RECEIPT_TITLE, exact: true })).toBeVisible();
    const text = await page.locator('article').innerText();

    // The receipt id, and both halves of the received instant.
    expect(text).toContain(RECEIPT_ID);
    expect(text).toContain('2026');
    expect(text).toMatch(/\d{1,2}:\d{2}/u);
    expect(text).toContain('erika@example.invalid');
    expect(text, 'the mail notice comes from the content file').toContain(MAIL_NOTICE);

    for (const word of RETENTION_WORDS) {
      expect(text, `the confirmation page must not carry "${word}"`).not.toContain(word);
    }
  });

  test('submitting /widerrufen reaches the confirmation page with the received date and time, and carries no retention offer', async ({
    page,
  }) => {
    await useLanguage(page, 'de');
    await mockDeclarationsEndpoint(page, 'widerruf');

    await page.goto('/widerrufen');
    await page.locator('input[name="name"]').fill('Erika Musterfrau');
    await page.locator('input[name="email"]').fill('erika@example.invalid');
    await page.getByRole('button', { name: WITHDRAW_SUBMIT, exact: true }).click();

    await page.waitForURL(/\/widerrufen\/bestaetigt$/u);
    // Waits for the CONFIRMATION page's own heading, not the URL: the URL
    // updates before React finishes swapping the article's content, and a
    // one-shot `innerText()` read right after `waitForURL` can still catch
    // the form's stale DOM for a frame.
    await expect(page.getByRole('heading', { name: WITHDRAW_RECEIPT_TITLE, exact: true })).toBeVisible();
    const text = await page.locator('article').innerText();

    expect(text).toContain(RECEIPT_ID);
    expect(text).toContain('2026');
    expect(text).toMatch(/\d{1,2}:\d{2}/u);
    expect(text).toContain('erika@example.invalid');
    expect(text, 'the mail notice comes from the content file').toContain(MAIL_NOTICE);

    for (const word of RETENTION_WORDS) {
      expect(text, `the confirmation page must not carry "${word}"`).not.toContain(word);
    }
  });
});

// ── The language a declaration carries (2026-09-30) ────────────────────────
//
// One test per form and language, so no walk shares the 30 second budget. The
// fixture folder has no file in these four languages, so each page draws the
// English article; the declaration still carries the reader's own language,
// which is what chooses the receipt.

test.describe('the reader language on the two statutory forms', () => {
  for (const form of FORMS) {
    for (const language of NEWER_LANGUAGES) {
      test(`${form.path} in ${language} sends the declaration in ${language}`, async ({ page }) => {
        await useLanguage(page, language);
        const languages = await mockDeclarationsEndpoint(page, form.kind);

        await page.goto(form.path);
        await page.locator('input[name="name"]').fill('Erika Musterfrau');
        await page.locator('input[name="email"]').fill('erika@example.invalid');
        await page.getByRole('button', { name: form.submit, exact: true }).click();

        await page.waitForURL(new RegExp(`${form.path}/bestaetigt$`, 'u'));
        expect(languages).toEqual([language]);
      });
    }

    test(`CONTROL: ${form.path} in German still sends de`, async ({ page }) => {
      await useLanguage(page, 'de');
      const languages = await mockDeclarationsEndpoint(page, form.kind);

      await page.goto(form.path);
      await page.locator('input[name="name"]').fill('Erika Musterfrau');
      await page.locator('input[name="email"]').fill('erika@example.invalid');
      await page.getByRole('button', { name: form.submit, exact: true }).click();

      await page.waitForURL(new RegExp(`${form.path}/bestaetigt$`, 'u'));
      expect(languages).toEqual(['de']);
    });
  }

  test('against a core older than the six languages, a French cancellation goes again in English and is received', async ({
    page,
  }) => {
    await useLanguage(page, 'fr');
    const languages = await mockDeclarationsEndpoint(page, 'kuendigung', { acceptedLanguages: OLDER_CORE_LANGUAGES });

    await page.goto('/kuendigung');
    await page.locator('input[name="name"]').fill('Erika Musterfrau');
    await page.locator('input[name="email"]').fill('erika@example.invalid');
    await page.getByRole('button', { name: CANCEL_SUBMIT, exact: true }).click();

    await page.waitForURL(/\/kuendigung\/bestaetigt$/u);
    await expect(page.locator('article')).toContainText(RECEIPT_ID);
    expect(languages).toEqual(['fr', 'en']);
  });
});
