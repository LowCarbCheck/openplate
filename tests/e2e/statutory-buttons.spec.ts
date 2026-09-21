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

import { E2E_SYNC_SERVER_URL } from './env';
import { useLanguage } from './helpers';

/** The statutory labels, byte for byte — § 312k BGB and § 356a BGB. Never sourced from a catalog: they must not drift with a wordsmith pass. */
const CANCEL_TITLE = 'Verträge hier kündigen';
const CANCEL_SUBMIT = 'jetzt kündigen';
const WITHDRAW_TITLE = 'Vertrag widerrufen';
const WITHDRAW_SUBMIT = 'Widerruf bestätigen';

/** What a § 312k confirmation page must never carry (design section 1 and the milestone's Requirements). */
const RETENTION_WORDS = ['Rabatt', 'Angebot', 'pausieren', 'Umfrage', 'Support'];

const DECLARATIONS_PATH = '/v1/legal/declarations';
const RECEIPT_ID = 'e2e-9f2c9b1a-0000-4000-8000-000000000000';
/** A full instant with an explicit offset, so the page's `dateStyle: 'long', timeStyle: 'long'` render has both a date and a time to show. */
const RECEIVED_AT = '2026-09-21T14:30:00+02:00';

/** Answers the preflight and the POST for one declaration kind, on `openplate-core`'s own origin. */
async function mockDeclarationsEndpoint(page: Page, kind: 'kuendigung' | 'widerruf'): Promise<void> {
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
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ receiptId: RECEIPT_ID, receivedAt: RECEIVED_AT, kind }),
    });
  });
}

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
    await expect(page.getByRole('heading', { name: 'Kündigung bestätigt', exact: true })).toBeVisible();
    const text = await page.locator('article').innerText();

    // The receipt id, and both halves of the received instant.
    expect(text).toContain(RECEIPT_ID);
    expect(text).toContain('2026');
    expect(text).toMatch(/\d{1,2}:\d{2}/u);
    expect(text).toContain('erika@example.invalid');

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
    await expect(page.getByRole('heading', { name: 'Widerruf bestätigt', exact: true })).toBeVisible();
    const text = await page.locator('article').innerText();

    expect(text).toContain(RECEIPT_ID);
    expect(text).toContain('2026');
    expect(text).toMatch(/\d{1,2}:\d{2}/u);
    expect(text).toContain('erika@example.invalid');

    for (const word of RETENTION_WORDS) {
      expect(text, `the confirmation page must not carry "${word}"`).not.toContain(word);
    }
  });
});
