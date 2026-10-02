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
 * - NO LAYOUT SHIFT FROM THE SWITCH (DESIGN.md section 7). A hidden card
 *   reserves nothing and moves nothing, the switch row is one fixed box in
 *   every state, and an administrator whose role arrives late flips a thumb on
 *   Preferences and inserts a row in About without the browser recording a
 *   shift.
 * - THE CARD ITSELF IS SHIFT-FREE WHEN IT SHOWS. It decides in an effect, so it
 *   always arrives after first paint, and it used to arrive at the TOP of the
 *   page (a 0.2226 shift, 234 px of content pushed down). It now sits at the
 *   END of `/diary` and `/dashboard`, where nothing in the page flow sits below
 *   it, so its late arrival displaces nothing and tapping Dismiss lifts nothing
 *   either. At the phone width and at 1280 x 800, on both pages, for a device
 *   that switched it on and for an administrator whose role lands late: the
 *   `layout-shift` total is 0 across the load, across the card arriving and
 *   across Dismiss; every other element in `main` keeps its top; nothing but
 *   padding and the fixed chrome sits under the card; and the card neither
 *   overflows the document nor clips its own keys. NOT CLAIMED: that the card
 *   is easy to find. At the end of a long day on `/diary` it is a scroll away,
 *   which is the price of moving nothing.
 * - THE CARD IS BEHIND A SWITCH (Preferences). Every case above runs with the
 *   switch turned ON before the first load, because a signed-out device has the
 *   card off by default. The default itself is claimed separately: a signed-out
 *   device and a signed-in member see no card and no About row, are never
 *   stamped, and get the right card the moment they turn it on. An
 *   administrator with nothing stored sees it, and an explicit off beats the
 *   role. Each of those has its control in the same test: the same device with
 *   one input changed, shown the card.
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
 *
 * @area offline-and-updates
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { WHATS_NEW_STORAGE_KEY } from '#app/lib/whats-new';
import { WHATS_NEW_VISIBLE_EVENT, WHATS_NEW_VISIBLE_KEY } from '#app/lib/whats-new-visibility';

import { AUTH_API_PREFIX } from '../../app/lib/sync/engine/client/auth-wire';
import { adminConsoleStub, routeAdminConsole } from './admin-console-stub';
import { EN as APP_EN } from './copy';
import { E2E_CORE_URL } from './env';
import { completeOnboarding, signInFixtureAccount, useLanguage } from './helpers';
import {
  installShiftObserver,
  readShiftEntries,
  readTops,
  movedBetween,
  settleFrames,
  shiftScoreAfter,
  turnOffScrollAnchoring,
} from './layout-shift';

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

/** What the person chose about the card, read straight out of `localStorage`. `null` is "never chose". */
async function storedChoice(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), WHATS_NEW_VISIBLE_KEY);
}

/**
 * Puts the card's switch on the device for the NEXT document load, the way the
 * switch on Preferences leaves it. `null` leaves the device as one that never
 * chose, which is the default under test.
 *
 * Every case that is about the card itself calls this with `'on'`: the card is
 * off by default for anybody who is not an administrator.
 */
async function chooseCard(page: Page, choice: 'on' | 'off' | null): Promise<void> {
  await page.evaluate(
    ({ key, value }) => {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    },
    { key: WHATS_NEW_VISIBLE_KEY, value: choice },
  );
}

/** The row in About that opens the notes page. */
function aboutRow(page: Page) {
  return page.locator('main a[href="/settings/whats-new"]');
}

/** The switch on Preferences, found by the name the bundle gives it. */
function cardSwitch(page: Page) {
  return page.getByRole('switch', { name: APP_EN.preferences.whatsNew.label, exact: true });
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
  await chooseCard(page, 'on');

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
  await chooseCard(page, 'on');

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

  // The card's decision is made in an effect that awaits a profile read, so it
  // has not necessarily landed the moment settleWhatsNew returns; a one-shot
  // read here raced that effect under load and read a card that had not
  // decided yet as absent. Each branch below waits on the decision's own
  // observable outcome first. A shown card proves itself by appearing. A card
  // that stays away proves itself only through the write its branch makes, so
  // that write is waited on before a one-shot read is trusted to answer.
  if (EXPECTED_FOR_ESTABLISHED !== null) {
    await expect(
      whatsNewCard(page),
      `an established device with no acknowledgement is shown ${EXPECTED_FOR_ESTABLISHED}`,
    ).toHaveAttribute('data-version', EXPECTED_FOR_ESTABLISHED);
    // The other half of the same rule: told something means the record waits
    // for the tap that says it was read.
    expect(await acknowledgedVersion(page), 'a device told something is not recorded until it is read').toBeNull();
  } else {
    // Told nothing means recorded, and that write is this branch's only
    // observable trace, so it is waited on before the count of zero is asked.
    await expect
      .poll(() => acknowledgedVersion(page), { message: 'a device told nothing is recorded' })
      .toBe(BUILD.version);
    expect(await whatsNewCard(page).count(), 'an established device with no acknowledgement is shown nothing').toBe(0);
  }

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
  await chooseCard(page, 'on');
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
  await chooseCard(page, 'on');
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
  await chooseCard(page, 'on');

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
    await chooseCard(page, 'on');
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

////////////////////////////////////////////////////////////////////////////////
// The switch: the card is off by default, and Preferences turns it on
////////////////////////////////////////////////////////////////////////////////

test('a signed-out device sees no card and no About row until it switches them on', async ({ page }) => {
  await completeOnboarding(page);
  expect(await storedChoice(page), 'the device has never chosen').toBeNull();

  // A BRAND NEW DEVICE is the one case where a mounted card WRITES: it records
  // the build silently. So it is the one that can tell a hidden card from a card
  // that is merely not drawn, and a hidden card must leave it blank. The first
  // test above is the control, the same device with the switch on is recorded.
  await forgetAcknowledgement(page);
  await page.goto('/diary');
  await expect(page.locator('[data-slot="date-nav"]')).toBeVisible();
  await settleWhatsNew(page);
  expect(await acknowledgedVersion(page), 'a hidden card does not even record a new device').toBeNull();
  await acknowledge(page, OLDEST_VERSION);

  ////////////////////////////////////////////////////////////////////////////
  // THE DEFAULT: nothing on either screen that carries the card, and nothing
  // written. A hidden card that still stamped would tell this device it had
  // been told, and the card would never come when it was switched on.
  ////////////////////////////////////////////////////////////////////////////
  for (const path of ['/diary', '/dashboard']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await settleWhatsNew(page);
    await expect(whatsNewCard(page), `${path}: no card by default`).toHaveCount(0);
  }
  expect(await acknowledgedVersion(page), 'a hidden card must not change what was acknowledged').toBe(OLDEST_VERSION);

  await page.goto('/settings/about');
  await expect(page.locator('[data-slot="settings-inset"]').first()).toBeVisible();
  await settleFrames(page);
  await expect(aboutRow(page), 'no release notes row in About by default').toHaveCount(0);

  ////////////////////////////////////////////////////////////////////////////
  // THE SWITCH, through the real page. It shows the EFFECTIVE state (off), and
  // flipping it is what the device then remembers.
  ////////////////////////////////////////////////////////////////////////////
  await page.goto('/settings/preferences');
  const toggle = cardSwitch(page);
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  // The switch holds no state of its own, it reads the store, so it can only
  // turn over if the change reached the store and came back as an event.
  await expect(toggle).toBeChecked();
  expect(await storedChoice(page), 'the switch stores an explicit on').toBe('on');

  // THE CONTROL: the same device, one switch later, is told.
  await page.goto('/dashboard');
  const card = whatsNewCard(page);
  await expect(card, 'the control: switched on, the same device is told').toBeVisible();
  await expect(card).toHaveAttribute('data-version', UNSEEN_FROM_OLDEST[0] ?? '');
  await page.goto('/settings/about');
  await expect(aboutRow(page), 'the control: switched on, the row is there').toHaveCount(1);

  ////////////////////////////////////////////////////////////////////////////
  // OFF AGAIN, explicitly, and the page itself stays open at its address.
  ////////////////////////////////////////////////////////////////////////////
  await page.goto('/settings/preferences');
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect(await storedChoice(page), 'the switch stores an explicit off, not a removal').toBe('off');

  await page.goto('/diary');
  await expect(page.locator('main')).toBeVisible();
  await settleWhatsNew(page);
  await expect(whatsNewCard(page), 'switched off, no card').toHaveCount(0);
  await page.goto('/settings/about');
  await expect(page.locator('[data-slot="settings-inset"]').first()).toBeVisible();
  await settleFrames(page);
  await expect(aboutRow(page), 'switched off, no row').toHaveCount(0);

  await page.goto('/settings/whats-new');
  await expect(page.locator('[data-slot="release"]'), 'the notes page itself is not behind the switch').toHaveCount(
    CATALOG_VERSIONS.length,
  );
});

test('a device that was never told still gets the right card the moment it switches the card on', async ({ page }) => {
  await completeOnboarding(page);
  const oneDayMs = 24 * 60 * 60 * 1000;
  await backdateOnboarding(page, Date.parse(BUILD.builtAt) - oneDayMs);
  await forgetAcknowledgement(page);

  // Hidden: the established device is neither told nor recorded. A card that
  // stamped while hidden would make the answer below "nothing to say".
  await page.goto('/dashboard');
  await expect(page.locator('[data-slot="week-glance-card"]')).toBeVisible();
  await settleWhatsNew(page);
  await expect(whatsNewCard(page)).toHaveCount(0);
  expect(await acknowledgedVersion(page), 'a hidden card records nothing').toBeNull();

  await chooseCard(page, 'on');
  await page.goto('/dashboard');
  if (EXPECTED_FOR_ESTABLISHED !== null) {
    await expect(
      whatsNewCard(page),
      `switched on, the established device is shown ${EXPECTED_FOR_ESTABLISHED}`,
    ).toHaveAttribute('data-version', EXPECTED_FOR_ESTABLISHED);
    return;
  }
  await expect
    .poll(() => acknowledgedVersion(page), { message: 'switched on, a device with nothing to hear is recorded' })
    .toBe(BUILD.version);
});

////////////////////////////////////////////////////////////////////////////////
// The role: an administrator has it on by default, a member does not
////////////////////////////////////////////////////////////////////////////////

test.describe('a signed-in account', () => {
  // A cross-origin read the service worker made would never reach `page.route`.
  test.use({ serviceWorkers: 'block' });

  test('an administrator with nothing stored sees the card, and an explicit off beats the role', async ({ page }) => {
    const stub = adminConsoleStub();
    await routeAdminConsole(page, stub);
    await completeOnboarding(page);
    await signInFixtureAccount(page);
    expect(stub.selfId, 'the sign-in answer named the account').not.toBeNull();
    expect(await storedChoice(page), 'the administrator never chose').toBeNull();
    // The card ran for this account: the new device was recorded silently, and
    // only a mounted card does that. Waited on so a late stamp cannot land on
    // top of the older acknowledgement written next.
    await expect
      .poll(() => acknowledgedVersion(page), { message: 'the administrator default mounts the card' })
      .toBe(BUILD.version);

    await acknowledge(page, OLDEST_VERSION);
    await page.goto('/diary');
    await expect(whatsNewCard(page), 'an administrator is told by default').toBeVisible();
    await page.goto('/settings/about');
    await expect(aboutRow(page), 'and has the row by default').toHaveCount(1);

    // The switch shows the EFFECTIVE state, so it reads on with nothing stored.
    await page.goto('/settings/preferences');
    const toggle = cardSwitch(page);
    await expect(toggle, 'the switch reads on for an administrator who never chose').toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(await storedChoice(page), 'off is stored, not removed').toBe('off');

    await page.goto('/diary');
    await expect(page.locator('[data-slot="date-nav"]')).toBeVisible();
    await settleWhatsNew(page);
    await expect(whatsNewCard(page), 'an explicit off beats the role').toHaveCount(0);
    expect(await acknowledgedVersion(page), 'and a hidden card leaves the acknowledgement alone').toBe(OLDEST_VERSION);
    await page.goto('/settings/about');
    await expect(page.locator('[data-slot="settings-inset"]').first()).toBeVisible();
    await settleFrames(page);
    await expect(aboutRow(page), 'and takes the row with it').toHaveCount(0);
  });

  test('a member with nothing stored sees neither the card nor the row, and is never stamped', async ({ page }) => {
    // The CONTROL for the administrator case above: the same sign-in, the same
    // pages, with the role left as the account has it.
    await completeOnboarding(page);
    await signInFixtureAccount(page);
    // A mounted card would have recorded this new device by now, see the
    // signed-out test for why that is the write that tells hidden from unmounted.
    await settleWhatsNew(page);
    expect(await acknowledgedVersion(page), 'a card that never mounted records nothing').toBeNull();
    await acknowledge(page, OLDEST_VERSION);

    await page.goto('/diary');
    await expect(page.locator('[data-slot="date-nav"]')).toBeVisible();
    await settleWhatsNew(page);
    await expect(whatsNewCard(page), 'a member is not told by default').toHaveCount(0);
    expect(await acknowledgedVersion(page), 'and a card that never mounted never stamps').toBe(OLDEST_VERSION);

    await page.goto('/settings/about');
    await expect(page.locator('[data-slot="settings-inset"]').first()).toBeVisible();
    await settleFrames(page);
    await expect(aboutRow(page)).toHaveCount(0);

    // And the switch is theirs to turn on.
    await chooseCard(page, 'on');
    await page.goto('/diary');
    await expect(whatsNewCard(page), 'the control: a member who switched it on is told').toBeVisible();
  });
});

////////////////////////////////////////////////////////////////////////////////
// No layout shift
////////////////////////////////////////////////////////////////////////////////

/**
 * An element's top and height measured from the top of the PAGE, so a scroll
 * between two readings (a click scrolls its target into view) is not a move.
 */
async function pageBox(target: Locator): Promise<{ top: number; height: number }> {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top + window.scrollY, height: rect.height };
  });
}

/** Every entry the browser recorded since the document loaded, summed, with what moved for a failure message. */
async function wholeLoadShift(page: Page): Promise<{ score: number; moved: string[] }> {
  const entries = await readShiftEntries(page);
  return { score: shiftScoreAfter(entries, 0), moved: entries.flatMap((entry) => entry.sources) };
}

/** A promise and the function that settles it. */
interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

/** A {@link Deferred}. This repo's `lib` predates `Promise.withResolvers`, and the executor runs at once. */
function createDeferred(): Deferred {
  const settlers: Array<() => void> = [];
  const promise = new Promise<void>((resolve) => {
    settlers.push(resolve);
  });
  return {
    promise,
    resolve: () => {
      for (const settle of settlers) settle();
    },
  };
}

/**
 * Holds the core's account read, the answer that carries the role, until
 * `release` is called. Registered AFTER the administrator routing, so it runs
 * first and hands on to it with `fallback`.
 *
 * @param page - a signed-in page that has not navigated since.
 * @returns `asked`, which settles when the page has asked for the account, and `release`.
 */
async function holdAccountRead(page: Page): Promise<{ asked: Promise<void>; release: () => void }> {
  const gate = createDeferred();
  const asked = createDeferred();
  await page.route(`${E2E_CORE_URL}${AUTH_API_PREFIX}/account`, async (route) => {
    asked.resolve();
    await gate.promise;
    await route.fallback();
  });
  return { asked: asked.promise, release: () => gate.resolve() };
}

test('a hidden card reserves nothing and moves nothing on the diary and the dashboard', async ({ page }) => {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  await completeOnboarding(page);
  await acknowledge(page, OLDEST_VERSION);

  for (const [path, anchor] of [
    ['/diary', '[data-slot="date-nav"]'],
    ['/dashboard', '[data-slot="week-glance-card"]'],
  ] as const) {
    await page.goto(path);
    await expect(page.locator(anchor)).toBeVisible();
    await settleWhatsNew(page);
    await expect(whatsNewCard(page)).toHaveCount(0);
    const { score, moved } = await wholeLoadShift(page);
    expect(score, `${path}: a hidden card moved ${moved.join('; ')}`).toBe(0);
  }

  ////////////////////////////////////////////////////////////////////////////
  // THE CONTROL, for the instrument and not for the card: a box of 100 px put
  // in at the top of the page after load is read as a move by both readings.
  // Without it, the zeros above would pass against a reading that is blind.
  ////////////////////////////////////////////////////////////////////////////
  await settleFrames(page);
  const before = await readTops(page);
  const since = (await readShiftEntries(page)).length;
  const isInserted = await page.evaluate(() => {
    const box = document.createElement('div');
    box.style.height = '100px';
    const container = document.querySelector('main .mx-auto.max-w-2xl');
    container?.prepend(box);
    return container !== null;
  });
  expect(isInserted, 'the control found the page to put its box in').toBe(true);
  await settleFrames(page);
  expect(movedBetween(before, await readTops(page)), 'the control: the geometry reading sees a box arrive').not.toEqual(
    [],
  );
  expect(
    shiftScoreAfter(await readShiftEntries(page), since),
    'the control: the browser records the box as a layout shift',
  ).toBeGreaterThan(0);
});

test('the switch on Preferences is one fixed box, and flipping it moves nothing', async ({ page }) => {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  await completeOnboarding(page);

  await page.goto('/settings/preferences');
  const toggle = cardSwitch(page);
  await expect(toggle).toBeVisible();
  await settleFrames(page);
  const inset = page.locator('[data-slot="settings-inset"]').filter({ has: toggle });
  const boxBefore = await pageBox(inset);
  const topsBefore = await readTops(page);
  const since = (await readShiftEntries(page)).length;

  await toggle.click();
  await expect(toggle, 'the switch turned over, so the reading is of a real change').toBeChecked();
  await settleFrames(page);

  const boxAfter = await pageBox(inset);
  expect(boxAfter.height, 'the row keeps its height').toBe(boxBefore.height);
  expect(boxAfter.top, 'the row keeps its place').toBe(boxBefore.top);
  expect(movedBetween(topsBefore, await readTops(page)), 'elements that moved when the switch flipped').toEqual([]);
  const entries = await readShiftEntries(page);
  expect(shiftScoreAfter(entries, since), 'layout shift recorded by flipping the switch').toBe(0);
  const whole = await wholeLoadShift(page);
  expect(whole.score, `the page load moved ${whole.moved.join('; ')}`).toBe(0);
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll, 'the document must not scroll sideways').toBeLessThanOrEqual(widths.client);
});

test.describe('an administrator whose role arrives after the page', () => {
  test.use({ serviceWorkers: 'block' });

  for (const path of ['/settings/preferences', '/settings/about'] as const) {
    test(`${path} records no layout shift when the role lands`, async ({ page }) => {
      const stub = adminConsoleStub();
      await installShiftObserver(page);
      await turnOffScrollAnchoring(page);
      await routeAdminConsole(page, stub);
      await completeOnboarding(page);
      await signInFixtureAccount(page);

      // The role is held back until the page has asked for it, so the page is
      // drawn (or waiting) WITHOUT it first. Without this hold the answer could
      // arrive before the first paint and the reading below would be of nothing.
      const { asked, release } = await holdAccountRead(page);
      await page.goto(path, { waitUntil: 'commit' });
      await asked;
      await settleFrames(page);
      release();

      if (path === '/settings/preferences') {
        await expect(cardSwitch(page), 'the role landed: the switch reads on').toBeChecked();
      } else {
        await expect(aboutRow(page), 'the role landed: the row is there').toHaveCount(1);
      }
      await settleFrames(page);
      const { score, moved } = await wholeLoadShift(page);
      expect(score, `${path}: the role landing moved ${moved.join('; ')}`).toBe(0);
    });
  }
});

////////////////////////////////////////////////////////////////////////////////
// The card arriving moves nothing: it sits at the END of the page
////////////////////////////////////////////////////////////////////////////////

/** The two pages that carry the card, and an element that proves each one has drawn. */
const CARD_PAGES = [
  { path: '/diary', anchor: '[data-slot="date-nav"]' },
  { path: '/dashboard', anchor: '[data-slot="week-glance-card"]' },
] as const;

/** Where the card sits and whether it fits, read in one evaluate so every number belongs to one frame. */
interface CardGeometry {
  /**
   * Elements in `main` whose top is at or under the card's top and that are not
   * the card, one of its ancestors, or fixed or sticky chrome. Empty means the
   * card is the last thing in the page flow.
   */
  below: string[];
  left: number;
  right: number;
  cardScrollWidth: number;
  cardClientWidth: number;
  cardScrollHeight: number;
  cardClientHeight: number;
  /** Descendants of the card that draw past the card's own edges. */
  spilling: string[];
  documentScrollWidth: number;
  documentClientWidth: number;
}

/** Reads {@link CardGeometry} off the page. The card must be on it. */
async function readCardGeometry(page: Page): Promise<CardGeometry> {
  // Serialised into the page, so its helpers cannot live outside it.
  // oxlint-disable unicorn/consistent-function-scoping
  return page.evaluate(() => {
    const card = document.querySelector('[data-slot="whats-new"]');
    const main = document.querySelector('main');
    if (card === null || main === null) throw new Error('the card or main is not on the page');
    // Fixed and sticky chrome keeps its place in the viewport and is never pushed by content.
    const isPinned = (element: Element): boolean => {
      for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const position = getComputedStyle(node).position;
        if (position === 'fixed' || position === 'sticky') return true;
      }
      return false;
    };
    const describe = (element: Element): string =>
      `${element.tagName.toLowerCase()}[${element.getAttribute('data-slot') ?? ''}] "${(element.textContent ?? '').trim().slice(0, 30)}"`;
    const cardRect = card.getBoundingClientRect();
    const cardTop = cardRect.top + window.scrollY;
    const below: string[] = [];
    for (const element of main.querySelectorAll('*')) {
      if (card.contains(element) || element.contains(card) || isPinned(element)) continue;
      const rect = element.getBoundingClientRect();
      // A box of nothing takes no room and is not under the card in any sense a person meets.
      if (rect.width === 0 || rect.height === 0) continue;
      const top = rect.top + window.scrollY;
      if (top + 0.5 >= cardTop)
        below.push(`${describe(element)} top ${Math.round(top)} px, card top ${Math.round(cardTop)} px`);
    }
    const spilling: string[] = [];
    for (const element of card.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right > cardRect.right + 0.5 || rect.left < cardRect.left - 0.5 || rect.bottom > cardRect.bottom + 0.5) {
        spilling.push(describe(element));
      }
    }
    return {
      below,
      left: cardRect.left,
      right: cardRect.right,
      cardScrollWidth: card.scrollWidth,
      cardClientWidth: card.clientWidth,
      cardScrollHeight: card.scrollHeight,
      cardClientHeight: card.clientHeight,
      spilling,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
    };
  });
  // oxlint-enable unicorn/consistent-function-scoping
}

/** The card neither overflows the document nor clips or spills its own contents. */
function expectCardFits(geometry: CardGeometry, where: string): void {
  // NON-VACUITY: a card that measured as a point would fit anywhere.
  expect(geometry.right - geometry.left, `${where}: the card must have been drawn to be measured`).toBeGreaterThan(150);
  expect(
    geometry.documentScrollWidth,
    `${where}: the document needs ${geometry.documentScrollWidth} px of ${geometry.documentClientWidth}`,
  ).toBeLessThanOrEqual(geometry.documentClientWidth);
  expect(geometry.left, `${where}: the card starts left of the screen`).toBeGreaterThanOrEqual(0);
  expect(geometry.right, `${where}: the card ends right of the screen`).toBeLessThanOrEqual(
    geometry.documentClientWidth,
  );
  expect(geometry.cardScrollWidth, `${where}: the card clips sideways`).toBeLessThanOrEqual(geometry.cardClientWidth);
  expect(geometry.cardScrollHeight, `${where}: the card clips its height`).toBeLessThanOrEqual(
    geometry.cardClientHeight + 1,
  );
  expect(geometry.spilling, `${where}: something draws outside the card`).toEqual([]);
}

/**
 * The keys of the card that a thumb could NOT land on once the page is scrolled
 * as far down as it goes: each key's centre is hit-tested, and a key under the
 * fixed tab bar, or off screen, answers with something that is not the key.
 */
async function unreachableKeys(page: Page): Promise<string[]> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await settleFrames(page);
  return whatsNewCard(page)
    .locator('a, button')
    .evaluateAll((keys) =>
      keys
        .filter((key) => {
          const box = key.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return hit === null || !key.contains(hit);
        })
        .map((key) => (key.textContent ?? '').trim()),
    );
}

/** Switches the card on the way the Preferences switch does, in the page that is already open. */
async function switchCardOnLive(page: Page): Promise<void> {
  await page.evaluate(
    ({ key, event }) => {
      window.localStorage.setItem(key, 'on');
      window.dispatchEvent(new CustomEvent(event, { detail: { isVisible: true } }));
    },
    { key: WHATS_NEW_VISIBLE_KEY, event: WHATS_NEW_VISIBLE_EVENT },
  );
}

/**
 * Everything the card's arrival and its Dismiss must leave alone, asserted on a
 * page where the card has JUST appeared and `before` is the reading taken the
 * moment before it did.
 *
 * @param page - the page the card appeared on.
 * @param reading - the tops and the shift count taken before the card showed.
 * @param where - what to call this reading in a failure message.
 */
async function expectArrivalAndDismissMoveNothing(
  page: Page,
  reading: { tops: Record<string, number>; since: number },
  where: string,
): Promise<void> {
  const card = whatsNewCard(page);
  await expect(card, `${where}: the card must have arrived for this to be a reading of it`).toBeVisible();
  await settleFrames(page);

  const afterArrival = await readTops(page);
  expect(movedBetween(reading.tops, afterArrival), `${where}: elements that moved when the card arrived`).toEqual([]);
  // EVERY entry counts, the administrator's sidebar included: the role's own
  // row no longer moves anything (`admin-sidebar-row-moves-nothing.spec.ts`),
  // so there is nothing left to excuse.
  const arrivalEntries = (await readShiftEntries(page)).slice(reading.since);
  expect(
    shiftScoreAfter(arrivalEntries, 0),
    `${where}: the card arriving moved ${arrivalEntries.flatMap((entry) => entry.sources).join('; ')}`,
  ).toBe(0);

  const geometry = await readCardGeometry(page);
  expect(geometry.below, `${where}: something sits under the card in the page flow`).toEqual([]);
  expectCardFits(geometry, where);
  expect(await unreachableKeys(page), `${where}: keys a thumb cannot land on`).toEqual([]);

  // DISMISS is a tap on the card, so nothing the person did not ask to move may
  // move. With nothing under the card, nothing can.
  const topsWithCard = await readTops(page);
  const sinceDismiss = (await readShiftEntries(page)).length;
  await card.getByRole('button', { name: EN.card.dismiss, exact: true }).click();
  await expect(card, `${where}: the tap hides the card`).toHaveCount(0);
  await settleFrames(page);
  expect(movedBetween(topsWithCard, await readTops(page)), `${where}: elements that moved on Dismiss`).toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), sinceDismiss), `${where}: Dismiss recorded a layout shift`).toBe(
    0,
  );
}

/**
 * The same walk at whatever viewport the enclosing `describe` set.
 *
 * @param label - the viewport, for failure messages and test names.
 */
function registerArrivalTests(label: string): void {
  for (const { path, anchor } of CARD_PAGES) {
    test(`${label} ${path}: a device that switched the card on gets it with nothing moving`, async ({ page }) => {
      await installShiftObserver(page);
      await turnOffScrollAnchoring(page);
      await completeOnboarding(page);
      await acknowledge(page, OLDEST_VERSION);

      ////////////////////////////////////////////////////////////////////////
      // THE REAL LOAD: switched on before the page opens, so the card arrives
      // after the profile read, exactly as it does for a person.
      ////////////////////////////////////////////////////////////////////////
      await chooseCard(page, 'on');
      await page.goto(path);
      await expect(page.locator(anchor)).toBeVisible();
      await expect(whatsNewCard(page), 'the control: an older acknowledgement is told').toBeVisible();
      await settleFrames(page);
      const load = await wholeLoadShift(page);
      expect(load.score, `${label} ${path}: the load moved ${load.moved.join('; ')}`).toBe(0);

      ////////////////////////////////////////////////////////////////////////
      // THE ARRIVAL, caught between two readings: the card is hidden, the
      // tops are read, and then the card is switched on in the open page.
      ////////////////////////////////////////////////////////////////////////
      await chooseCard(page, 'off');
      await page.goto(path);
      await expect(page.locator(anchor)).toBeVisible();
      await settleWhatsNew(page);
      await expect(whatsNewCard(page), 'the reading starts from a page without the card').toHaveCount(0);
      const tops = await readTops(page);
      const since = (await readShiftEntries(page)).length;
      await switchCardOnLive(page);
      await expectArrivalAndDismissMoveNothing(page, { tops, since }, `${label} ${path}`);
    });
  }

  test.describe(`${label}: an administrator whose role lands after the page`, () => {
    test.use({ serviceWorkers: 'block' });

    for (const { path, anchor } of CARD_PAGES) {
      test(`${label} ${path}: the card arrives with the role and nothing moves`, async ({ page }) => {
        const stub = adminConsoleStub();
        await installShiftObserver(page);
        await turnOffScrollAnchoring(page);
        await routeAdminConsole(page, stub);
        await completeOnboarding(page);
        await signInFixtureAccount(page);
        // The administrator default mounted the card and recorded this new
        // device; waited on so that write cannot land on the older
        // acknowledgement written next.
        await expect
          .poll(() => acknowledgedVersion(page), { message: 'the administrator default mounts the card' })
          .toBe(BUILD.version);
        await acknowledge(page, OLDEST_VERSION);

        // The role is held back until the page has asked for it, so the page is
        // drawn WITHOUT it first and the card can only come with the answer.
        const { asked, release } = await holdAccountRead(page);
        await page.goto(path, { waitUntil: 'commit' });
        await asked;
        await expect(page.locator(anchor)).toBeVisible();
        await settleFrames(page);
        await expect(whatsNewCard(page), 'the control: with the role unread there is no card').toHaveCount(0);
        const tops = await readTops(page);
        const since = (await readShiftEntries(page)).length;

        release();
        await expectArrivalAndDismissMoveNothing(
          page,
          { tops, since },
          `${label} ${path} (administrator)`,
        );
      });
    }
  });
}

test.describe('on a phone', () => {
  registerArrivalTests('phone 390x844');
});

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  registerArrivalTests('desktop 1280x800');
});

test('the arrival reading is not blind: a card put at the top of the page is read as a move', async ({ page }) => {
  await installShiftObserver(page);
  await turnOffScrollAnchoring(page);
  await completeOnboarding(page);
  await acknowledge(page, OLDEST_VERSION);
  await chooseCard(page, 'off');
  await page.goto('/diary');
  await expect(page.locator('[data-slot="date-nav"]')).toBeVisible();
  await settleWhatsNew(page);
  const tops = await readTops(page);
  const since = (await readShiftEntries(page)).length;
  await switchCardOnLive(page);
  await expect(whatsNewCard(page)).toBeVisible();
  await settleFrames(page);

  // The card is lifted to the top of the page, where it used to be mounted.
  // Every reading the tests above rely on has to see that.
  await page.evaluate(() => {
    const card = document.querySelector('[data-slot="whats-new"]');
    card?.parentElement?.prepend(card);
  });
  await settleFrames(page);
  const geometry = await readCardGeometry(page);
  expect(geometry.below, 'the control: the geometry reading sees things under a card at the top').not.toEqual([]);
  expect(
    movedBetween(tops, await readTops(page)),
    'the control: the tops reading sees the page pushed down',
  ).not.toEqual([]);
  expect(
    shiftScoreAfter(await readShiftEntries(page), since),
    'the control: the browser records the push as a layout shift',
  ).toBeGreaterThan(0);
});
