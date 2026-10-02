/**
 * Near the end of a DAY trial, the countdown and its recap line both read
 * whole at 390 px and at 360 px, in all six languages (M265/08). 360 px is
 * the narrow Android phone; the tier's own phone is 390.
 *
 * Three days before the end the countdown carries a second, smaller line: how
 * many meals were logged with AI in the trial (`trial-recap.ts`). The sign-off
 * saw day-based lines cut off in de, fr, es, it and tr once that recap line was
 * showing, and nothing measured it: `trial-countdown.spec.ts` sweeps every
 * countdown sentence in the ONE-line layout, and `trial-recap.spec.ts` sweeps
 * only the scan count in the two-line one.
 *
 * WHAT IS REAL: the production build, the account, the scan that logs the
 * meal, the recap count, the status row and its two lines, drawn by a real
 * trial three days before its end, in each language by a document load in
 * that language. STUBBED: the provider's answer, the handshake's
 * `plans: true`, the plan reads and the allowance (`plans-stub.ts`).
 *
 * THEN EVERY DAY SENTENCE is written into that real row, beside each recap
 * sentence, the way `doesStatusRowFit` sweeps the one-line layout: the row,
 * its classes and its fonts are the ones on screen, and only the words change.
 *
 * WHAT "WHOLE" MEANS, for each line: nothing clipped off the bottom
 * (`scrollHeight` past `clientHeight`, a clamped line with more to say) and
 * nothing out of the side (`scrollWidth` past `clientWidth`, an unbreakable
 * run, or a one-line `truncate` that ends in an ellipsis). Neither shows
 * reliably in a screenshot.
 *
 * @area plans-and-paywall
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { logOnePlateWithAi, routeStubPlateAnswer } from './ai-plate-stub';
import { catalogFor, fill } from './copy';
import {
  FIT_WIDTHS,
  HEADER_HEIGHT,
  PHONE_HEIGHT,
  completeOnboarding,
  connectStubAiProvider,
  signInFixtureAccount,
  useLanguage,
} from './helpers';
import { headerShiftAfter, installShiftObserver, readShiftEntries, settleFrames } from './layout-shift';
import { NO_SUBSCRIPTION_VIEW, routeAccountAllowance, routePlansCore } from './plans-stub';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

/** The calendar days left, today included, that an end at noon two days from today leaves. Inside the recap's reach. */
const DAYS_LEFT = 3;

/** A two-digit meal count, the longest a trial's recap plausibly says. */
const MANY_MEALS = 28;

/** An allowance that ends at local noon two days from today, so the countdown says three days. */
function noonInTwoDays(): string {
  const end = new Date();
  end.setDate(end.getDate() + 2);
  end.setHours(12, 0, 0, 0);
  return end.toISOString();
}

function headerStatus(page: Page): Locator {
  return page.locator('header [data-slot="header-status"]');
}

/** Whether each of the status row's two lines reads whole, and the boxes behind the answers. */
interface StatusLinesFit {
  isSentenceWhole: boolean;
  isRecapWhole: boolean;
  /** Each line's scroll and client size and the column's width, for a failure message. */
  boxes: string;
}

/**
 * Reads both lines of the status row as it stands.
 *
 * @param page - a page whose header shows a status with an action and a second line.
 */
async function readStatusLinesFit(page: Page): Promise<StatusLinesFit> {
  return headerStatus(page).evaluate((row) => {
    const text = row.querySelector('[data-slot="header-status-text"]');
    const recap = row.querySelector('[data-slot="header-status-description"]');
    if (text === null || recap === null) throw new Error('the status row on screen has no second line');
    // BOTH DIRECTIONS FOR BOTH LINES: a clamped line is clipped off the
    // bottom, a one-line `truncate` ends in an ellipsis at the side.
    return {
      isSentenceWhole: text.scrollHeight <= text.clientHeight && text.scrollWidth <= text.clientWidth,
      isRecapWhole: recap.scrollHeight <= recap.clientHeight && recap.scrollWidth <= recap.clientWidth,
      boxes:
        `column ${text.clientWidth} px, sentence ${text.scrollHeight}/${text.clientHeight} px tall, ` +
        `recap ${recap.scrollHeight}/${recap.clientHeight} px tall ${recap.scrollWidth}/${recap.clientWidth} px wide`,
    };
  });
}

/**
 * Writes a sentence, its action's label and a recap sentence into the real row.
 * The row is left holding these words.
 *
 * @param page - a page whose header shows a status with an action and a second line.
 * @param words - the three strings to write.
 */
async function writeStatusLines(page: Page, words: { sentence: string; label: string; recap: string }): Promise<void> {
  await headerStatus(page).evaluate((row, { sentence, label, recap }) => {
    const sentenceSpan = row.querySelector('[data-slot="header-status-sentence"]');
    const action = row.querySelector('[data-slot="header-status-action"]');
    const recapSpan = row.querySelector('[data-slot="header-status-description"]');
    if (sentenceSpan === null || action === null || recapSpan === null) {
      throw new Error('the status row on screen carries no action or no second line');
    }
    sentenceSpan.textContent = sentence;
    action.textContent = label;
    recapSpan.textContent = recap;
  }, words);
}

/** Names what a reading found cut off, or nothing when both lines are whole. */
function clippedLines(fit: StatusLinesFit, where: string): string[] {
  const clipped: string[] = [];
  if (!fit.isSentenceWhole) clipped.push(`${where}: the countdown sentence is cut off (${fit.boxes})`);
  if (!fit.isRecapWhole) clipped.push(`${where}: the recap line is cut off (${fit.boxes})`);
  return clipped;
}

test('near the end of a day trial, every day sentence and its recap line read whole at 390 and 360 px in all six languages', async ({
  page,
}) => {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: null });
  // THE TRIAL STARTS NOW: the fixture account is shared by the whole run, and
  // a meal an earlier spec synced into it must not count here.
  await routeAccountAllowance(page, {
    dailyAiLimit: 20,
    allowanceExpiresAt: noonInTwoDays(),
    createdAt: new Date().toISOString(),
  });
  await routeStubPlateAnswer(page);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  await connectStubAiProvider(page);
  await logOnePlateWithAi(page);

  const clipped: string[] = [];
  for (const width of FIT_WIDTHS) {
    await page.setViewportSize({ width, height: PHONE_HEIGHT });
    for (const locale of SUPPORTED_LANGUAGES) {
      const copy = catalogFor(locale);
      const countdown = copy.plan.countdown;
      const recap = copy.plan.recap;

      // ── The real row, in this language ──────────────────────────────────
      await useLanguage(page, locale);
      await page.goto('/diary');
      expect(await page.locator('html').getAttribute('lang'), `${locale}: the document is in that language`).toBe(
        locale,
      );
      await expect(headerStatus(page)).toContainText(fill(countdown.daysLeft_other, { count: String(DAYS_LEFT) }), {
        timeout: 10_000,
      });
      // ONE MEAL: the two-item plate is one intake.
      await expect(headerStatus(page)).toContainText(fill(recap.meals_one, { count: '1' }));
      const layout = await page.evaluate(() => ({
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        headerHeight: Math.round(document.querySelector('header')?.getBoundingClientRect().height ?? 0),
      }));
      expect(layout.documentClientWidth, `${width} ${locale}: the phone`).toBe(width);
      expect(layout.documentScrollWidth, `${width} ${locale}: the document overflows`).toBe(width);
      expect(layout.headerHeight, `${width} ${locale}: the two lines opened the header`).toBe(HEADER_HEIGHT);
      clipped.push(...clippedLines(await readStatusLinesFit(page), `${width} ${locale} as drawn`));
      // THE ROW ARRIVED WITHOUT MOVING THE HEADER. Four lines are taller than
      // the brand mark the header's boxes were sized by at rest; a box that
      // grew around them moved its top, which the browser counts as a shift
      // even when the controls inside it stayed put. Read in the header, from
      // the start of this document: the countdown replaced the title after
      // the load.
      await settleFrames(page);
      const arrival = headerShiftAfter(await readShiftEntries(page), 0);
      if (arrival.score !== 0) {
        clipped.push(
          `${width} ${locale} as drawn: the header shifted ${arrival.score} (${arrival.sources.join('; ')})`,
        );
      }

      // ── Every day sentence beside every recap sentence ──────────────────
      // `daysLeft_one` is in the catalog but the line never says it: on the
      // last day the countdown says `lastDay` instead (`trial-countdown.tsx`).
      // It is read anyway, so a future caller of the key finds it fits.
      const sentences = {
        [`daysLeft_other (${DAYS_LEFT})`]: fill(countdown.daysLeft_other, { count: String(DAYS_LEFT) }),
        'daysLeft_other (2)': fill(countdown.daysLeft_other, { count: '2' }),
        'daysLeft_one (1)': fill(countdown.daysLeft_one, { count: '1' }),
        lastDay: countdown.lastDay,
      };
      const recaps = {
        'meals_one (1)': fill(recap.meals_one, { count: '1' }),
        [`meals_other (${MANY_MEALS})`]: fill(recap.meals_other, { count: String(MANY_MEALS) }),
      };
      for (const [sentenceKey, sentence] of Object.entries(sentences)) {
        for (const [recapKey, recapSentence] of Object.entries(recaps)) {
          await writeStatusLines(page, { sentence, label: countdown.action, recap: recapSentence });
          clipped.push(
            ...clippedLines(await readStatusLinesFit(page), `${width} ${locale} ${sentenceKey} + ${recapKey}`),
          );
        }
      }
    }
  }
  expect(clipped, 'these lines are cut off near the end of a day trial').toEqual([]);

  // THE CONTROLS, one per line: the English sentence four times over does not
  // fit two lines, and the English recap three times over does not fit one.
  const english = catalogFor('en').plan;
  const sentence = fill(english.countdown.daysLeft_other, { count: String(DAYS_LEFT) });
  const recapSentence = fill(english.recap.meals_one, { count: '1' });
  await writeStatusLines(page, { sentence: sentence.repeat(4), label: english.countdown.action, recap: recapSentence });
  expect((await readStatusLinesFit(page)).isSentenceWhole, 'the reading cannot see a clipped sentence').toBe(false);
  await writeStatusLines(page, { sentence, label: english.countdown.action, recap: recapSentence.repeat(3) });
  expect((await readStatusLinesFit(page)).isRecapWhole, 'the reading cannot see a clipped recap line').toBe(false);
  // And for the header reading: the brand mark moved on purpose must register.
  const quiet = (await readShiftEntries(page)).length;
  await page.locator('header [data-slot="header-mark"]').evaluate((mark) => {
    if (mark instanceof HTMLElement) mark.style.marginTop = '12px';
  });
  await settleFrames(page);
  expect(
    headerShiftAfter(await readShiftEntries(page), quiet).score,
    'the header reading cannot see a header control move',
  ).toBeGreaterThan(0);
});
