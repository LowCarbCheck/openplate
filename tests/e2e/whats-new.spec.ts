/**
 * The release notes the app ships with itself (ADR-0018), on the real pages.
 *
 * WHAT IS CLAIMED, AND WHAT EACH CLAIM'S CONTROL IS.
 *
 * - A device that walked the first-visit flow is told nothing and is recorded
 *   silently. The control is the same device one line later: give it an older
 *   acknowledgement and the card appears, so "told nothing" is about this
 *   device and not about a card that never renders for anybody.
 * - A device that was using the app before this build was made, and has no
 *   acknowledgement at all, is shown what the rule says it must be shown. See
 *   `EXPECTED_FOR_ESTABLISHED` below for why that is computed rather than
 *   written down.
 * - An older acknowledgement is shown the releases in between, opens the page
 *   from the card, and ends up acknowledged. Dismiss hides the card and it
 *   stays gone across a reload, which is the only check a component that hid
 *   it in local state would fail.
 * - A device that is already up to date, and a device that has acknowledged a
 *   NEWER build than it is running, are both silent, and the newer value is
 *   never written back down.
 * - At 360 px in English, German and Turkish neither the card nor the page
 *   overflows the document, every key takes a thumb, and no text is drawn
 *   under the type floor.
 *
 * NOTHING HERE PINS A VERSION, A DATE OR A SENTENCE. The versions come from
 * `build/build-info.json`, which is written by the build these specs run
 * against; the releases and their words come from the shipped English catalog.
 * A release cut tomorrow moves both, and this file follows.
 *
 * SEEDING AN OLD DEVICE. `helpers.ts` drives the real UI for everything, and
 * this spec keeps to that for the first visit and for every tap. It cannot for
 * one input: "this device was in use before the bundle was built" is a state no
 * sequence of clicks can reach, because the bundle was built minutes ago. So
 * the onboarding stamp that the real questionnaire just wrote is back-dated on
 * disk, and the seed is read back through a fresh document before anything is
 * asserted.
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { WHATS_NEW_STORAGE_KEY } from '#app/lib/whats-new';

import { completeOnboarding, useLanguage } from './helpers';

////////////////////////////////////////////////////////////////////////////////
// What this build is, and what it ships
////////////////////////////////////////////////////////////////////////////////

/** The stamp the build under test wrote for itself, the same file the server reads. */
const buildInfoSchema = z.object({ version: z.string(), builtAt: z.string() });

const BUILD = buildInfoSchema.parse(
  JSON.parse(readFileSync(resolvePath(process.cwd(), 'build/build-info.json'), 'utf8')),
);

/** One release in the shipped catalog: a date, and up to three groups of leads. */
const releaseSchema = z.object({
  date: z.string(),
  added: z.record(z.string(), z.string()).optional(),
  changed: z.record(z.string(), z.string()).optional(),
  fixed: z.record(z.string(), z.string()).optional(),
});

/** Every release the bundle carries, keyed `v` plus the version with underscores. */
const CATALOG = z
  .record(z.string(), releaseSchema)
  .parse(JSON.parse(readFileSync(resolvePath(process.cwd(), 'app/i18n/locales/en/releases.json'), 'utf8')));

/** The strings this spec reads back off the page, in whichever language is on screen. */
const copySchema = z.object({
  whatsNew: z.object({
    title: z.string(),
    card: z.object({ title: z.string(), open: z.string(), dismiss: z.string() }),
    groups: z.object({ added: z.string(), changed: z.string(), fixed: z.string() }),
    new: z.string(),
    allReleases: z.string(),
  }),
});

/** The `whatsNew` block of one language's shipped bundle, or null when it has none yet. */
function parseWhatsNewCopy(locale: string): z.infer<typeof copySchema>['whatsNew'] | null {
  const catalog = JSON.parse(
    readFileSync(resolvePath(process.cwd(), `app/i18n/locales/${locale}/common.json`), 'utf8'),
  );
  const parsed = copySchema.safeParse(catalog);
  return parsed.success ? parsed.data.whatsNew : null;
}

/** English is the source, and it is also what every other language falls back to. */
const EN =
  parseWhatsNewCopy('en') ??
  (() => {
    throw new Error('app/i18n/locales/en/common.json carries no whatsNew block');
  })();

/**
 * What one language actually renders.
 *
 * A bundle that has not been translated yet renders ENGLISH, because that is
 * i18next's `fallbackLng`. So a walk in that language has to click the English
 * words, or it would be looking for a sentence the page never drew.
 *
 * @param locale - one of `SUPPORTED_LANGUAGES`.
 */
function copyFor(locale: string): z.infer<typeof copySchema>['whatsNew'] {
  return parseWhatsNewCopy(locale) ?? EN;
}

/** `v0_35_0` back to `0.35.0`. */
function versionOfKey(key: string): string {
  return key.slice(1).replaceAll('_', '.');
}

/**
 * Orders two `x.y.z` versions. Written out here rather than imported from the
 * app, so this file is a second opinion about what "newer" means and not a
 * restatement of the thing under test.
 */
function compare(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (const [index, part] of left.entries()) {
    const other = right[index] ?? 0;
    if (part !== other) return part < other ? -1 : 1;
  }
  return 0;
}

/** Every shipped release, newest first. */
const CATALOG_VERSIONS = Object.keys(CATALOG)
  .map(versionOfKey)
  .toSorted((a, b) => compare(b, a));

/** The oldest release the bundle carries. Used as "an acknowledgement from before". */
const OLDEST_VERSION = CATALOG_VERSIONS[CATALOG_VERSIONS.length - 1] ?? '';

/** The releases a device that acknowledged {@link OLDEST_VERSION} still has to hear about. */
const UNSEEN_FROM_OLDEST = CATALOG_VERSIONS.filter(
  (version) => compare(OLDEST_VERSION, version) < 0 && compare(version, BUILD.version) <= 0,
);

/**
 * What an ESTABLISHED device with no acknowledgement at all must be shown, and
 * why it is computed.
 *
 * The rule is "the release whose version is the one you are running, and only
 * that one": with no acknowledgement there is no baseline, so "everything
 * since" has no answer. A release that changed nothing an operator can see is
 * not in the catalog at all (a docs-only release, see AGENTS.md), so the build
 * being run does not always have an entry, and then the honest answer is to say
 * nothing and record silently. Written down as a literal this assertion would
 * go red on the next release rather than on a defect.
 */
const EXPECTED_FOR_ESTABLISHED = CATALOG_VERSIONS.includes(BUILD.version) ? BUILD.version : null;

////////////////////////////////////////////////////////////////////////////////
// The device
////////////////////////////////////////////////////////////////////////////////

/** The card, wherever it is mounted. */
function whatsNewCard(page: Page) {
  return page.locator('[data-slot="whats-new"]');
}

/** What this device has acknowledged, read straight out of `localStorage`. */
async function acknowledgedVersion(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), WHATS_NEW_STORAGE_KEY);
}

/** Puts an acknowledgement on the device for the NEXT document load. */
async function acknowledge(page: Page, version: string): Promise<void> {
  await page.evaluate((written) => window.localStorage.setItem(written.key, written.version), {
    key: WHATS_NEW_STORAGE_KEY,
    version,
  });
}

/** Takes the acknowledgement off the device, so it reads as a device that never had one. */
async function forgetAcknowledgement(page: Page): Promise<void> {
  await page.evaluate((key) => window.localStorage.removeItem(key), WHATS_NEW_STORAGE_KEY);
}

/**
 * Back-dates the onboarding stamp the real questionnaire just wrote, so the
 * device reads as one that was in use before this bundle existed.
 *
 * The primary store's own layout, the same one `helpers.ts` reads awards and
 * pantry rows through: database `openplate-primary`, TinyBase's tables store
 * `t` with one record per table, and every row carries its entity as JSON in
 * the single `entity` cell. `profileGoals` holds one row, `me`.
 *
 * @param page - a page on the app's origin, on a device past onboarding.
 * @param at - the epoch milliseconds to stamp instead.
 */
async function backdateOnboarding(page: Page, at: number): Promise<void> {
  await page.evaluate(
    (stampedAt) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const store = db.transaction('t', 'readwrite').objectStore('t');
          const read = store.get('profileGoals');
          read.addEventListener('error', () => {
            db.close();
            reject(new Error('the profile table could not be read'));
          });
          read.addEventListener('success', () => {
            // SAFETY: TinyBase's IndexedDB persister stores one record per
            // table as `{ k, v }`, with `v` an object keyed by row id, and
            // every primary-store row carries its entity as JSON in `entity`.
            const record = read.result as { k?: string; v?: Record<string, { entity?: string }> } | undefined;
            const entity = record?.v?.me?.entity;
            if (record?.v === undefined || entity === undefined) {
              db.close();
              reject(new Error('there is no profile row to back-date'));
              return;
            }
            // SAFETY: that cell is written only by the primary store's
            // `writeEntity`, as `JSON.stringify` of a `LocalProfileGoals`.
            const profile = JSON.parse(entity) as { onboardingCompletedAt?: number | null };
            profile.onboardingCompletedAt = stampedAt;
            const write = store.put({ k: 'profileGoals', v: { ...record.v, me: { entity: JSON.stringify(profile) } } });
            write.addEventListener('error', () => {
              db.close();
              reject(new Error('the profile row could not be written'));
            });
            write.addEventListener('success', () => {
              db.close();
              resolve();
            });
          });
        });
      }),
    at,
  );
}

/** What the DISK says this device finished onboarding, so a seed can be read back. */
async function onboardedAtOnDisk(page: Page): Promise<number | null> {
  return page.evaluate(
    () =>
      new Promise<number | null>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const read = db.transaction('t', 'readonly').objectStore('t').get('profileGoals');
          read.addEventListener('error', () => {
            db.close();
            reject(new Error('the profile table could not be read'));
          });
          read.addEventListener('success', () => {
            db.close();
            // SAFETY: the same `{ k, v }` layout as above.
            const record = read.result as { v?: Record<string, { entity?: string }> } | undefined;
            const entity = record?.v?.me?.entity;
            if (entity === undefined) {
              resolve(null);
              return;
            }
            // SAFETY: as above, the cell is a serialised `LocalProfileGoals`.
            const profile = JSON.parse(entity) as { onboardingCompletedAt?: number | null };
            resolve(profile.onboardingCompletedAt ?? null);
          });
        });
      }),
  );
}

/**
 * Waits until the card has HAD ITS CHANCE, so that finding it absent is a
 * result rather than a race.
 *
 * `toHaveCount(0)` resolves on its first matching poll, and the card is drawn
 * from an effect that first reads the device's profile out of IndexedDB. An
 * absence asserted straight after a navigation therefore passes against a page
 * whose effect has not run, which is an assertion that cannot go red.
 *
 * This is not a sleep. The read below opens its own IndexedDB transaction,
 * issued after the card's, and transactions against one store complete in the
 * order they were issued, so its answer arriving means the card's read has
 * already arrived. The two animation frames after it are the render and the
 * paint that a `setState` from that read would produce.
 *
 * @param page - the page whose card is being waited on.
 */
async function settleWhatsNew(page: Page): Promise<void> {
  await onboardedAtOnDisk(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

////////////////////////////////////////////////////////////////////////////////
// A fresh device
////////////////////////////////////////////////////////////////////////////////

test('a first visit is told nothing about the release, and is recorded silently', async ({ page }) => {
  await completeOnboarding(page);

  await page.goto('/diary');
  await expect(page.locator('[data-slot="date-nav"]')).toBeVisible();
  await settleWhatsNew(page);

  await expect(whatsNewCard(page), 'a brand new device has missed nothing').toHaveCount(0);
  // THE POSITIVE HALF, and the reason the absence above is not the whole
  // claim: the device is recorded as up to date, so the NEXT release has a
  // baseline to measure from instead of looking like another first run.
  expect(await acknowledgedVersion(page), 'the first visit records this build').toBe(BUILD.version);

  ////////////////////////////////////////////////////////////////////////////
  // THE CONTROL. The same device, with an older acknowledgement, IS told.
  // Without it, the absence above would pass against a card that never renders.
  ////////////////////////////////////////////////////////////////////////////
  expect(UNSEEN_FROM_OLDEST.length, 'the catalog must carry more than one release').toBeGreaterThan(0);
  await acknowledge(page, OLDEST_VERSION);
  await page.goto('/diary');
  await expect(whatsNewCard(page), 'the control: an older acknowledgement is told').toBeVisible();
});

////////////////////////////////////////////////////////////////////////////////
// A device that was here before this build
////////////////////////////////////////////////////////////////////////////////

test('a device that predates this build is told what the rule says, and nothing more', async ({ page }) => {
  await completeOnboarding(page);

  const oneDayMs = 24 * 60 * 60 * 1000;
  const beforeTheBuild = Date.parse(BUILD.builtAt) - oneDayMs;
  await backdateOnboarding(page, beforeTheBuild);
  await forgetAcknowledgement(page);

  await page.goto('/dashboard');
  await expect(page.locator('[data-slot="week-glance-card"]')).toBeVisible();
  // THE SEED IS READ BACK, through a document that loaded after it was written:
  // without this the two assertions below would describe a device that is still
  // stamped with today, which is a different case entirely.
  expect(await onboardedAtOnDisk(page), 'the device must read as one that predates this build').toBe(beforeTheBuild);
  await settleWhatsNew(page);

  // `count()` answers now, where `getAttribute()` on an absent card would wait
  // out the whole spec timeout before reporting the absence this case expects.
  const shown = (await whatsNewCard(page).count()) === 0 ? null : await whatsNewCard(page).getAttribute('data-version');
  expect(shown, `an established device with no acknowledgement is shown ${EXPECTED_FOR_ESTABLISHED ?? 'nothing'}`).toBe(
    EXPECTED_FOR_ESTABLISHED,
  );
  // The other half of the same rule: told nothing means recorded, told
  // something means the record waits for the tap that says it was read.
  expect(await acknowledgedVersion(page), 'a device told nothing is recorded, a device told something is not').toBe(
    EXPECTED_FOR_ESTABLISHED === null ? BUILD.version : null,
  );

  ////////////////////////////////////////////////////////////////////////////
  // THE CONTROL: this same seeded device, given an older acknowledgement, is
  // told. So the reading above is the rule's answer, not a card that is
  // missing for some other reason.
  ////////////////////////////////////////////////////////////////////////////
  await acknowledge(page, OLDEST_VERSION);
  await page.goto('/dashboard');
  await expect(whatsNewCard(page), 'the control: an older acknowledgement is told').toBeVisible();
});

////////////////////////////////////////////////////////////////////////////////
// An older acknowledgement: the card, the page, and the record
////////////////////////////////////////////////////////////////////////////////

test('an older acknowledgement opens the notes from the card and ends up recorded', async ({ page }) => {
  await completeOnboarding(page);
  await acknowledge(page, OLDEST_VERSION);

  const newestUnseen = UNSEEN_FROM_OLDEST[0] ?? '';
  expect(newestUnseen, 'the catalog must carry a release newer than the oldest one').not.toBe('');

  await page.goto('/diary');
  const card = whatsNewCard(page);
  await expect(card).toBeVisible();
  await expect(card, 'the card names the newest release this device has not read').toHaveAttribute(
    'data-version',
    newestUnseen,
  );
  await expect(card).toContainText(EN.card.title.replace('{{version}}', newestUnseen));
  // THE WORDS COME FROM THE CATALOG. The first lead of the newest unseen
  // release is on the card, and it is read out of the shipped bundle rather
  // than transcribed, so a rewording is not a failure.
  const release = CATALOG[`v${newestUnseen.replaceAll('.', '_')}`];
  const firstLead = release?.added?.['01'] ?? release?.changed?.['01'] ?? release?.fixed?.['01'] ?? '';
  expect(firstLead, 'the newest unseen release must carry at least one lead').not.toBe('');
  await expect(card).toContainText(firstLead);

  ////////////////////////////////////////////////////////////////////////////
  // The door, and what the page says
  ////////////////////////////////////////////////////////////////////////////

  await card.getByRole('link', { name: EN.card.open, exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/whats-new$/);

  const openedRelease = page.locator(`[data-slot="release"][data-version="${newestUnseen}"]`);
  await expect(openedRelease, 'the page lists the release the card named').toBeVisible();
  await expect(openedRelease).toContainText(firstLead);
  // EVERY release is listed, not only the unread ones: the page is the record,
  // the card is the notice.
  await expect(page.locator('[data-slot="release"]')).toHaveCount(CATALOG_VERSIONS.length);
  // The releases that were still unread when the page opened are marked, and
  // only those. The mark is a word, so it is read as text.
  await expect(page.locator('[data-slot="release-new"]')).toHaveCount(UNSEEN_FROM_OLDEST.length);
  await expect(openedRelease.locator('[data-slot="release-new"]')).toHaveText(EN.new);
  await expect(page.getByRole('link', { name: EN.allReleases, exact: true })).toHaveAttribute(
    'href',
    'https://github.com/LowCarbCheck/openplate/releases',
  );

  // READING THE PAGE IS READING THE NOTES.
  await expect
    .poll(() => acknowledgedVersion(page), { message: 'opening the page records this build' })
    .toBe(BUILD.version);

  // And the card is gone for good, on the page that offered it.
  await page.goto('/diary');
  await expect(page.locator('[data-slot="date-nav"]')).toBeVisible();
  await settleWhatsNew(page);
  await expect(whatsNewCard(page), 'a card whose notes were read must not come back').toHaveCount(0);
});

test('Dismiss hides the card and it stays gone across a reload', async ({ page }) => {
  await completeOnboarding(page);
  await acknowledge(page, OLDEST_VERSION);

  await page.goto('/diary');
  const card = whatsNewCard(page);
  await expect(card, 'the control: it is offered before it is dismissed').toBeVisible();

  await card.getByRole('button', { name: EN.card.dismiss, exact: true }).click();
  await expect(card, 'the tap hides it at once').toHaveCount(0);
  // A component that only hid it in state would satisfy everything above.
  await expect
    .poll(() => acknowledgedVersion(page), { message: 'Dismiss records this build on the device' })
    .toBe(BUILD.version);

  await page.reload();
  await expect(page.locator('[data-slot="date-nav"]')).toBeVisible();
  await settleWhatsNew(page);
  await expect(card, 'a dismissed card must not come back on reload').toHaveCount(0);
});

////////////////////////////////////////////////////////////////////////////////
// Up to date, and ahead of the build
////////////////////////////////////////////////////////////////////////////////

test('a device on this build, or ahead of it, is told nothing and keeps its record', async ({ page }) => {
  await completeOnboarding(page);

  ////////////////////////////////////////////////////////////////////////////
  // THE CONTROL FIRST, so both silences below are known to be about the
  // acknowledgement and not about a card that cannot render on this page.
  ////////////////////////////////////////////////////////////////////////////
  await acknowledge(page, OLDEST_VERSION);
  await page.goto('/dashboard');
  await expect(whatsNewCard(page), 'the control: an older acknowledgement is told').toBeVisible();

  // Up to date.
  await acknowledge(page, BUILD.version);
  await page.goto('/dashboard');
  await expect(page.locator('[data-slot="week-glance-card"]')).toBeVisible();
  await settleWhatsNew(page);
  await expect(whatsNewCard(page), 'a device on this build has nothing to hear').toHaveCount(0);
  expect(await acknowledgedVersion(page)).toBe(BUILD.version);

  // A ROLLBACK: this device read a newer build's notes before the instance went
  // back. It must stay quiet AND keep the newer value, or rolling forward again
  // would announce those notes a second time.
  const aheadOfTheBuild = `${Number(BUILD.version.split('.')[0] ?? 0) + 1}.0.0`;
  await acknowledge(page, aheadOfTheBuild);
  await page.goto('/dashboard');
  await expect(page.locator('[data-slot="week-glance-card"]')).toBeVisible();
  await settleWhatsNew(page);
  await expect(whatsNewCard(page), 'a rolled-back instance says nothing').toHaveCount(0);
  expect(await acknowledgedVersion(page), 'the newer acknowledgement is never written back down').toBe(aheadOfTheBuild);
});

////////////////////////////////////////////////////////////////////////////////
// The phone budget, in three languages
////////////////////////////////////////////////////////////////////////////////

/** The narrow end of the phone budget this app is written against. */
const NARROW_PHONE_WIDTH = 360;

/** A generous height, so width is the only thing under test. */
const PHONE_HEIGHT = 844;

/** The phone touch target floor this repo holds itself to. */
const TOUCH_TARGET_PX = 44;

/** The smallest type this app draws. */
const MIN_TEXT_PX = 12;

/** The languages this walk renders in: the source, the longest, and the one past audits broke in. */
const LOCALES = ['en', 'de', 'tr'] as const;

/** One element that is drawn smaller than the floor it has to clear. */
interface Reading {
  where: string;
  what: string;
  height: number;
  fontSize: number;
}

/** Every key inside `selector` that a finger could not land on. */
async function smallKeys(page: Page, selector: string, where: string): Promise<Reading[]> {
  return page.locator(`${selector} :is(a, button)`).evaluateAll(
    (elements, { floor, label }) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            where: label,
            what: (element.textContent ?? '').trim().slice(0, 40),
            height: Math.round(box.height),
            fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
          };
        })
        .filter((reading) => reading.height > 0 && reading.height + 0.5 < floor),
    { floor: TOUCH_TARGET_PX, label: where },
  );
}

/** Every piece of text inside `selector` drawn under the type floor. */
async function smallText(page: Page, selector: string, where: string): Promise<Reading[]> {
  return page.locator(`${selector} :is(p, li, span, h1, h2, h3, h4, a, button)`).evaluateAll(
    (elements, { floor, label }) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            where: label,
            what: (element.textContent ?? '').trim().slice(0, 40),
            height: Math.round(box.height),
            fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
          };
        })
        // A box of nothing is not drawn, and type nobody can see is not type.
        .filter((reading) => reading.height > 0 && reading.fontSize + 0.01 < floor),
    { floor: MIN_TEXT_PX, label: where },
  );
}

/** The document must never ask for more width than the phone gives it. */
async function expectNoOverflow(page: Page, where: string): Promise<void> {
  const measured = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    measured.scrollWidth,
    `${where}: needs ${measured.scrollWidth} px of ${measured.clientWidth}`,
  ).toBeLessThanOrEqual(measured.clientWidth);
}

for (const locale of LOCALES) {
  test(`the card and the notes fit a 360px phone in ${locale}`, async ({ page }) => {
    await completeOnboarding(page);
    await acknowledge(page, OLDEST_VERSION);
    await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: PHONE_HEIGHT });
    await useLanguage(page, locale);
    const copy = copyFor(locale);

    ////////////////////////////////////////////////////////////////////////////
    // The card, on the diary
    ////////////////////////////////////////////////////////////////////////////
    await page.goto('/diary');
    const card = whatsNewCard(page);
    await expect(card, `${locale}: the card must be on screen to be measured`).toBeVisible();
    // NON-VACUITY: the card drew its two keys, so the measurements below have
    // something to measure.
    await expect(card.locator('a, button')).toHaveCount(2);

    await expectNoOverflow(page, `${locale} the diary`);
    expect(await smallKeys(page, '[data-slot="whats-new"]', `${locale} card`)).toEqual([]);
    expect(await smallText(page, '[data-slot="whats-new"]', `${locale} card`)).toEqual([]);

    ////////////////////////////////////////////////////////////////////////////
    // The notes page
    ////////////////////////////////////////////////////////////////////////////
    await card.getByRole('link', { name: copy.card.open, exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/whats-new$/);

    const inset = page.locator('[data-slot="settings-inset"]');
    await expect(inset.first(), `${locale}: the page must draw its settings chrome`).toBeVisible();
    await expect(page.locator('[data-slot="release"]')).toHaveCount(CATALOG_VERSIONS.length);

    await expectNoOverflow(page, `${locale} the notes page`);
    expect(await smallKeys(page, '[data-slot="settings-inset"]', `${locale} page`)).toEqual([]);
    expect(await smallText(page, '[data-slot="settings-inset"]', `${locale} page`)).toEqual([]);
  });
}
