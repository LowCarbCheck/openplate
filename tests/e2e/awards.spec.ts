/**
 * The loop M235 exists for, walked once on a fresh device: log a food, earn
 * the first explorer award, read the note once, and find the streak at one.
 *
 * ── WHY THIS WALK AND NOT A UNIT TEST ────────────────────────────────────
 *
 * Every part of this feature is already covered by a pure test: the catalog,
 * the streak walk, the recorder, the backfill and the three surfaces each have
 * one. What none of them can see is the CHAIN: the food form's client action
 * has to reach the recorder, the recorder has to reach the on-device store,
 * the store has to reach disk, and the note has to read it back on a different
 * screen. Four seams, four files, and a break in any of them leaves every
 * unit test green. This spec is the only thing in the repository that holds
 * all four at once, against the production build a person actually gets.
 *
 * ── THE CONTROL IS HALF THE SPEC ─────────────────────────────────────────
 *
 * Every locator below is read TWICE: once before the first log, when it must
 * find nothing, and once after, when it must find exactly one. A check that
 * only ever looked after the act would pass unchanged against a screen that
 * always draws the note, or an awards screen that marks everything earned.
 * The before-half is what makes the after-half mean something.
 *
 * ── WHY THE STORE IS NEVER TOUCHED FROM HERE ─────────────────────────────
 *
 * Seeding a mark or an award would be a second implementation of the thing
 * under test: the recorder could stop being called from `/add` altogether and
 * a seeded spec would still pass. The food goes in through the manual form,
 * the same way `log-a-food.spec.ts` puts one in, and everything after that is
 * read off the app's own screens.
 *
 * ── NO SENTENCE IS TRANSCRIBED ───────────────────────────────────────────
 *
 * The copy here is wordsmith-owned and gets rephrased. Every string comes out
 * of the shipped bundle through `copy.ts`, so a better sentence changes this
 * spec's expectations with it and only a missing or wrong RENDER goes red.
 */
import { expect, test } from '@playwright/test';

import { completeOnboarding, expectPhoneLayout, logFoodManually } from './helpers';
import { EN, fill } from './copy';

/** A name no food database would return, so the diary entry can only be this one. */
const FOOD_NAME = 'Smoke tier award oats';

/** How much of it, in grams. */
const FOOD_GRAMS = '120';

/** The one-line note the dashboard shows for the first explorer award, as the bundle words it. */
const AWARD_NOTE = fill(EN.awards.note, { title: EN.awards.explorer.log.food.title });

/** The streak sentence for a person who has used the app on exactly one day. */
const STREAK_OF_ONE = fill(EN.trends.streak.active_one, { count: '1' });

test('a first logged food earns the explorer award, notes it once, and puts the streak at one', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await completeOnboarding(page);

  // The note, keyed on the award's own title. On the awards screen the same
  // award's past-tense note is drawn ONLY once it is held (`award-tile.tsx`),
  // which is what tells an earned tile from an unearned one without reading a
  // colour.
  const awardNote = page.getByText(AWARD_NOTE);
  const explorerTile = page.getByText(EN.awards.explorer.log.food.title, { exact: true });
  const explorerEarned = page.getByText(EN.awards.explorer.log.food.note);
  const streakOfOne = page.getByText(STREAK_OF_ONE);
  const noStreakYet = page.getByText(EN.trends.streak.empty);

  ////////////////////////////////////////////////////////////////////////////
  // THE CONTROL: before the first log, the same three reads find nothing.
  ////////////////////////////////////////////////////////////////////////////

  await page.goto('/dashboard');
  // ANCHORED FIRST, every time: a `toHaveCount(0)` against a page that has not
  // finished rendering passes instantly and says nothing. The streak line is
  // drawn by the same card as the number asserted later, so seeing it proves
  // the screen is up before anything is counted as absent.
  await expect(noStreakYet).toBeVisible();
  await expect(awardNote, 'no award may be announced before the first log').toHaveCount(0);

  await page.goto('/awards');
  await expect(explorerTile).toBeVisible();
  await expect(explorerEarned, 'the first-food award must not read as earned yet').toHaveCount(0);
  await expectPhoneLayout(page);

  ////////////////////////////////////////////////////////////////////////////
  // THE ACT: one food, through the manual form, like a person.
  ////////////////////////////////////////////////////////////////////////////

  await logFoodManually(page, { name: FOOD_NAME, grams: FOOD_GRAMS });

  ////////////////////////////////////////////////////////////////////////////
  // THE NOTE, ONCE.
  ////////////////////////////////////////////////////////////////////////////

  await page.goto('/dashboard');
  await expect(streakOfOne).toBeVisible();
  await expect(awardNote, 'the newly earned award is named exactly once').toHaveCount(1);

  ////////////////////////////////////////////////////////////////////////////
  // THE NUMBER AND THE RECORD, reached the way the app offers them: the
  // streak card on `/trends` is the only door to `/awards`.
  ////////////////////////////////////////////////////////////////////////////

  await page.goto('/trends');
  await expect(streakOfOne, 'one day of use reads as a streak of one').toBeVisible();
  await expect(noStreakYet).toHaveCount(0);

  await page.locator('main a[href="/awards"]').click();
  await page.waitForURL('**/awards');
  await expect(explorerEarned, 'the explorer award reads as earned').toBeVisible();
  await expectPhoneLayout(page);

  ////////////////////////////////////////////////////////////////////////////
  // THE REGRESSION GUARD FOR `seenAt`: a note that survives a full document
  // load is a note that never goes away. `page.goto` and `page.reload` both
  // throw away every piece of in-memory state, so what comes back came off
  // this device's own disk.
  ////////////////////////////////////////////////////////////////////////////

  await page.goto('/dashboard');
  await expect(streakOfOne).toBeVisible();
  await expect(awardNote, 'an acknowledged award is never announced again').toHaveCount(0);

  await page.reload();
  await expect(streakOfOne).toBeVisible();
  await expect(awardNote, 'a reload must not resurrect the note').toHaveCount(0);

  expect(pageErrors, 'the walk must raise no uncaught page error').toEqual([]);
});
