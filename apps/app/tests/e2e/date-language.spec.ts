/**
 * The date picker and the admin dates follow the app language (M251 spec 01).
 *
 * ── WHAT THE OPERATOR SAW ────────────────────────────────────────────────
 *
 * The launch walk (2026-09-23) opened the diary's date picker in German and in
 * French and read `Su Mo Tu We Th Fr Sa` over `September 2026`, and the admin
 * pages printed a joined date as `9/23/2026`. The calendar was never handed a
 * locale, and the admin dates asked the browser for its own default.
 *
 * ── WHAT THIS PROVES ─────────────────────────────────────────────────────
 *
 * In a real page, in German: the weekday row starts `Mo Di Mi`, the month
 * caption is German, the month navigation is labelled in German, and both
 * dates on an admin person page read `23.9.2026`.
 *
 * ── THE CONTROL ──────────────────────────────────────────────────────────
 *
 * The same walk in English. Its assertions hold on the old code and on the new
 * one, so a failure in German cannot be a broken walk, and the English admin
 * date is required NOT to be the German form, so the German assertion cannot
 * be met by a default that happens to look German.
 *
 * ── THE ADMIN PAGE IS ROUTED, NOT SERVED ─────────────────────────────────
 *
 * The fake sync service implements no admin API and its one account is a
 * member (`tests/integration/fake-sync-service.ts`). So the two auth answers
 * that carry the role are passed through with `role` rewritten to `admin`, and
 * the two admin reads the person page makes are answered here. Nothing on the
 * shared fixture row is changed, so no later spec meets an administrator.
 *
 * ── TEXT CONTENT, NEVER A PICTURE ────────────────────────────────────────
 *
 * Every assertion reads text or an `aria-label`. A fontless headless Chromium
 * reports text as hidden, so a screenshot here would be evidence of nothing.
 */
import { expect, test, type Page } from '@playwright/test';
import { de, enGB } from 'react-day-picker/locale';
import { z } from 'zod';

import type { LanguageCode } from '../../app/i18n/language-prefs';
import { AUTH_API_PREFIX } from '../../app/lib/sync/engine/client/auth-wire';
import { E2E_SYNC_SERVER_URL } from './env';
import { completeOnboarding, signInFixtureAccount, useLanguage } from './helpers';

// A cross-origin read the service worker made would never reach `page.route`.
test.use({ serviceWorkers: 'block' });

/** A past day, so the picker opens on a fixed month whatever day the run is on. */
const PICKED_DAY = '2026-03-10';

/** The instant both admin dates are set to. Noon UTC, so every time zone on earth reads the 23rd. */
const ADMIN_INSTANT = '2026-09-23T12:00:00.000Z';

/** The id the routed person page asks for. Any id works, the reads below answer every one. */
const ADMIN_PERSON_ID = 7;

/** What the German reader must see for {@link ADMIN_INSTANT}. */
const GERMAN_ADMIN_DATE = '23.9.2026';

/** Opens the diary on {@link PICKED_DAY} and opens its date picker. */
async function openDatePicker(page: Page): Promise<void> {
  await page.goto(`/diary?date=${PICKED_DAY}`);
  const trigger = page.locator('[data-slot="date-nav"] [data-slot="popover-trigger"]');
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.locator('[data-slot="popover-content"] th[scope="col"]').first()).toBeVisible();
}

/** What the open picker says: its weekday row, its month caption and its previous-month label. */
async function readDatePicker(page: Page): Promise<{ weekdays: string[]; caption: string; previousLabel: string }> {
  const panel = page.locator('[data-slot="popover-content"]');
  const weekdays = (await panel.locator('th[scope="col"]').allTextContents()).map((text) => text.trim());
  const caption = ((await panel.locator('[role="status"]').first().textContent()) ?? '').trim();
  const previousLabel = (await panel.locator('nav button').first().getAttribute('aria-label')) ?? '';
  return { weekdays, caption, previousLabel };
}

/**
 * An auth answer that carries an account (`login` and `account` both do).
 * LOOSE, because every other field is passed through to the app untouched.
 */
const AUTH_ANSWER_WITH_ACCOUNT = z.looseObject({ account: z.looseObject({}) });

/** Passes an auth answer through with the account's role rewritten to `admin`. */
async function actAsAdministrator(page: Page): Promise<void> {
  for (const path of ['login', 'account']) {
    await page.route(`${E2E_SYNC_SERVER_URL}${AUTH_API_PREFIX}/${path}`, async (route) => {
      const response = await route.fetch();
      if (!response.ok()) {
        await route.fulfill({ response });
        return;
      }
      const body = AUTH_ANSWER_WITH_ACCOUNT.safeParse(await response.json());
      if (!body.success) {
        await route.fulfill({ response });
        return;
      }
      await route.fulfill({ response, json: { ...body.data, account: { ...body.data.account, role: 'admin' } } });
    });
  }
}

/** Answers the two reads `/admin/people/:id` makes, with both dates on {@link ADMIN_INSTANT}. */
async function routeAdminPerson(page: Page): Promise<void> {
  await page.route(new RegExp(`/v1/admin/accounts/\\d+$`, 'u'), (route) =>
    route.fulfill({
      json: {
        account: {
          id: ADMIN_PERSON_ID,
          email: 'person@example.invalid',
          displayName: null,
          role: 'member',
          dailyAiLimit: 0,
          aiUsedToday: 0,
          allowanceExpiresAt: null,
          suspendedAt: null,
          invitesLeft: null,
          createdAt: ADMIN_INSTANT,
          lastSeenAt: ADMIN_INSTANT,
        },
      },
    }),
  );
  await page.route(new RegExp(`/v1/admin/accounts/\\d+/activity$`, 'u'), (route) =>
    route.fulfill({
      json: {
        accountId: ADMIN_PERSON_ID,
        lastSeenAt: ADMIN_INSTANT,
        window: { days: 1, fromDay: '2026-09-23', toDay: '2026-09-23' },
        days: [{ day: '2026-09-23', count: 0 }],
      },
    }),
  );
}

/** Signs in as an administrator, switches to `language` and reads the person page's two dates. */
async function readAdminDates(page: Page, language: LanguageCode): Promise<string[]> {
  await completeOnboarding(page);
  await actAsAdministrator(page);
  await routeAdminPerson(page);
  await signInFixtureAccount(page);
  await useLanguage(page, language);
  await page.goto(`/admin/people/${ADMIN_PERSON_ID}`);
  // INSIDE THE CARD: the console's counts are a `dl` too, above this one, and
  // they keep their box (with hidden stand-in numbers) even when the unrouted
  // `/stats` read fails here.
  const values = page.locator('[data-slot="card"] dl dd');
  // POLLED, because the person is read from the (routed) service after the
  // session reopens, and the first paint is the loading line.
  await expect.poll(() => values.count(), { message: 'the person page must draw its facts' }).toBeGreaterThanOrEqual(2);
  // The first two facts are "last seen" and "joined", in that order.
  return (await values.allTextContents()).slice(0, 2).map((text) => text.trim());
}

test('the date picker speaks German on a German screen', async ({ page }) => {
  await completeOnboarding(page);
  await useLanguage(page, 'de');
  await openDatePicker(page);
  const picker = await readDatePicker(page);

  expect(picker.weekdays.slice(0, 3), 'the week starts on Monday, in German').toEqual(['Mo', 'Di', 'Mi']);
  expect(picker.caption).toBe('März 2026');
  expect(picker.previousLabel).toBe(de.labels?.labelPrevious);
});

test('control: the date picker stays English on an English screen', async ({ page }) => {
  await completeOnboarding(page);
  await useLanguage(page, 'en');
  await openDatePicker(page);
  const picker = await readDatePicker(page);

  // ORDER-FREE, because this control has to hold on the old picker, whose
  // English week started on Sunday, and on the new one, whose starts on Monday.
  expect(picker.weekdays).toEqual(expect.arrayContaining(['Mo', 'Tu', 'We']));
  expect(picker.caption).toBe('March 2026');
  expect(picker.previousLabel).toBe(enGB.labels?.labelPrevious);
});

test('the admin dates are German on a German screen', async ({ page }) => {
  const dates = await readAdminDates(page, 'de');
  expect(dates).toEqual([GERMAN_ADMIN_DATE, GERMAN_ADMIN_DATE]);
});

test('control: the admin dates are English on an English screen', async ({ page }) => {
  const dates = await readAdminDates(page, 'en');
  for (const date of dates) {
    expect(date).toMatch(/\b23\b/u);
    expect(date).toMatch(/2026/u);
    expect(date, 'an English screen must not print the German form').not.toBe(GERMAN_ADMIN_DATE);
  }
});
