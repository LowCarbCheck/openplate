/**
 * The scan review says so when its foods were not fully checked for the
 * person's allergy or pregnancy (M219/03 follow-up).
 *
 * THE DEFECT. A person who listed milk got a chip when a flag matched and
 * nothing otherwise, so a scan the provider never looked at drew the same
 * screen as a scan it checked and found clear. That is a false all-clear on
 * the one screen that decides what goes into the body.
 *
 * THE FOUR ANSWERS A PROVIDER CAN GIVE, each one stubbed here:
 *
 *  - no `flags` on a food: not assessed. The line says nothing was checked.
 *  - `flags` with `flagsCoverage: 'partial'`: the provider can list what a
 *    food holds but cannot rule an allergen out. The line says the checks are
 *    partial, and the chip the flags DO earn still shows.
 *  - `flags` as three empty lists, no coverage: the model looked and found
 *    nothing. No line. (CONTROL)
 *  - no allergy and no pregnancy on the profile, nothing flagged: no line and
 *    no box either. (CONTROL)
 *
 * NO LAYOUT SHIFT (DESIGN.md section 7). The box is drawn on the first paint
 * of the review for everyone who listed something, so the line arriving, or a
 * locale wrapping it, moves nothing. Asserted with `getBoundingClientRect`,
 * sampled in the SAME commit the review appears in and then on every frame
 * for a second and a half, and with a `layout-shift` total of 0 for every
 * shift that started at or after that commit, scroll anchoring off.
 *
 * WHY NOT THE SHARED OBSERVER FROM THE CAPTURE SCREEN ON. The picture's
 * preview arriving on the capture card can move that card on a loaded host,
 * before the review exists. That is the capture screen's own business, so the
 * count here starts at the review's first commit, not at the file pick.
 *
 * THE PROFILE comes from the real onboarding body step, the way
 * `onboarding-allergens.spec.ts` ticks it, and the model is stubbed behind the
 * real settings form (`connectStubAiProvider`), so everything downstream of
 * the provider's answer is the shipped code. The sentences are read out of the
 * catalog, never typed here.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { routeStubPlateAnswer } from './ai-plate-stub';
import { EN } from './copy';
import { completeOnboarding, connectStubAiProvider } from './helpers';
import { turnOffScrollAnchoring } from './layout-shift';

/** A valid 1 x 1 PNG, the smallest thing the capture path accepts. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The eating style with no follow-up questions, so the first onboarding step is one click. */
const NEUTRAL_EATING_STYLE = 'just-track';

/** Two `text-xs` lines, the room the box keeps (`min-h-8`) and the height the English line fits in at 390 px. */
const RESERVED_HEIGHT_PX = 32;

/** The `data-slot` of the box, from `food-caution-chip.tsx`. A literal here so a rename fails this spec. */
const NOT_CHECKED_BOX = '[data-slot="cautions-not-checked"]';

/** What the model said about every food of the plate. */
const MILK_CONTAINED = { pregnancy: [], allergens: ['milk'], mayContain: [] };
const CHECKED_AND_EMPTY = { pregnancy: [], allergens: [], mayContain: [] };

/**
 * Walks a fresh device through the real questionnaire with milk ticked on the
 * body step, and leaves it on the diary.
 *
 * @param page - a page on a device that has never been used.
 */
async function completeOnboardingWithMilkAllergy(page: Page): Promise<void> {
  await page.goto('/welcome');
  await page.getByRole('link', { name: EN.welcome.start, exact: true }).click();

  await expect(page.getByText(EN.onboarding.style.title)).toBeVisible();
  await page.locator(`input[name="eatingStyle"][value="${NEUTRAL_EATING_STYLE}"]`).check();
  await page.getByRole('button', { name: EN.onboarding.actions.continue }).click();

  await expect(page.getByText(EN.onboarding.step.weight.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();

  await expect(page.getByText(EN.onboarding.step.body.title)).toBeVisible();
  // The chip is the label around an `sr-only` checkbox, so the label takes the click.
  await page
    .locator('label')
    .filter({ has: page.locator('input[name="allergens"][value="milk"]') })
    .click();
  await expect(page.locator('input[name="allergens"][value="milk"]')).toBeChecked();
  await page.getByRole('button', { name: EN.onboarding.actions.continue }).click();

  await expect(page.getByText(EN.onboarding.step.firstFood.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.firstFood.later }).click();
  await page.waitForURL('**/diary');
}

/** Hands the open capture card a photo. The tab bar has a capture input of its own, so the card is named. */
async function attachPhoto(page: Page): Promise<void> {
  const captureCard = page.locator('[data-slot="card"]').filter({ has: page.locator('input[type="file"][capture]') });
  await captureCard
    .locator('input[type="file"][capture]')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });
}

/** Scans one plate and waits until the review is on screen with both of its food cards. */
async function openReview(page: Page): Promise<void> {
  await page.goto('/add/photo');
  await attachPhoto(page);
  await expect(page.getByText(EN.scan.review.heading)).toBeVisible();
  await expect(page.locator('form [data-slot="card"]')).toHaveCount(2);
}

/** The box's height in CSS px, read off its rect. */
async function heightOf(box: Locator): Promise<number> {
  return box.evaluate((element) => element.getBoundingClientRect().height);
}

/** What the page recorded from the commit the review appeared in. */
interface ReviewReading {
  /** `performance.now()` at the review's first commit, or `null` when the review never appeared. */
  reviewStart: number | null;
  /** The first food card's and the confirm button's page tops, one pair per sample, the first taken in the commit itself. */
  samples: { card: number; confirm: number }[];
  /** Every `layout-shift` entry the page saw. */
  shifts: { value: number; startTime: number; sources: string[] }[];
}

/** How long the page keeps sampling after the review's first commit, in ms. */
const SAMPLE_WINDOW_MS = 1500;

/**
 * Installs, before any page script runs, a recorder that samples the review on
 * its first commit and on every animation frame after it, next to a
 * `layout-shift` observer that keeps each entry's start time.
 *
 * THE FIRST SAMPLE IS TAKEN IN THE MUTATION CALLBACK, a microtask after React
 * commits and before the browser paints, so it is the review as the first
 * paint draws it. A line added one commit later moves the first food card and
 * shows up as a second distinct value.
 *
 * @param page - a page that has not navigated yet.
 * @param windowMs - how long to keep sampling after the first commit.
 */
async function recordReviewFromFirstCommit(page: Page, windowMs: number): Promise<void> {
  // THE CALLBACK BELOW IS SERIALISED INTO THE PAGE. It cannot see this module's
  // scope, so its helpers cannot move out of it, which is exactly what
  // `consistent-function-scoping` asks for (the same note as `layout-shift.ts`).
  // oxlint-disable unicorn/consistent-function-scoping
  await page.addInitScript((sampleWindowMs: number) => {
    const reading: ReviewReading = { reviewStart: null, samples: [], shifts: [] };
    Object.defineProperty(window, '__reviewReading', { value: reading });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const json = entry.toJSON();
        const sources: { node?: Node | null }[] = Array.isArray(json.sources) ? json.sources : [];
        reading.shifts.push({
          value: Number(json.value),
          startTime: entry.startTime,
          sources: sources.map((source) =>
            source.node instanceof Element ?
              `${source.node.tagName.toLowerCase()} "${(source.node.textContent ?? '').trim().slice(0, 40)}"`
            : 'unknown',
          ),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });

    const pageTop = (element: Element | null): number =>
      element === null ? Number.NaN : element.getBoundingClientRect().top + window.scrollY;
    const sample = (): void => {
      const form = document.getElementById('confirm-plate-draft');
      reading.samples.push({
        card: pageTop(form?.querySelector('[data-slot="card"]') ?? null),
        confirm: pageTop(form?.querySelector('button[type="submit"]') ?? null),
      });
    };
    const watcher = new MutationObserver(() => {
      if (document.getElementById('confirm-plate-draft') === null) return;
      watcher.disconnect();
      const start = performance.now();
      reading.reviewStart = start;
      const tick = (): void => {
        sample();
        if (performance.now() - start < sampleWindowMs) requestAnimationFrame(tick);
      };
      tick();
    });
    watcher.observe(document, { childList: true, subtree: true });
  }, windowMs);
  // oxlint-enable unicorn/consistent-function-scoping
}

/** Reads what `recordReviewFromFirstCommit` recorded. */
async function readReviewReading(page: Page): Promise<ReviewReading> {
  return page.evaluate(() => {
    // SAFETY: only `recordReviewFromFirstCommit` defines this property, with exactly this shape.
    const reading = Object.getOwnPropertyDescriptor(window, '__reviewReading')?.value as ReviewReading | undefined;
    if (reading === undefined) throw new Error('the review recorder was never installed');
    return structuredClone(reading);
  });
}

test.describe('a person with a milk allergy', () => {
  test('a scan with no flags says nothing was checked', async ({ page }) => {
    await completeOnboardingWithMilkAllergy(page);
    await connectStubAiProvider(page);
    await routeStubPlateAnswer(page);

    await openReview(page);

    const box = page.locator(NOT_CHECKED_BOX);
    await expect(box).toHaveCount(1);
    await expect(box.getByRole('note')).toHaveText(EN.cautions.notChecked.all);
    // No chip either: with nothing flagged there is none to draw, which is
    // exactly why the line has to exist.
    await expect(page.locator('[data-slot="food-caution-chip"]')).toHaveCount(0);
    // The two lines fit the room that was kept for them.
    expect(await heightOf(box)).toBe(RESERVED_HEIGHT_PX);
  });

  test('a partly checked scan says the checks are partial, and keeps the chip its flags earn', async ({ page }) => {
    await completeOnboardingWithMilkAllergy(page);
    await connectStubAiProvider(page);
    await routeStubPlateAnswer(page, { flags: MILK_CONTAINED, flagsCoverage: 'partial' });

    await openReview(page);

    const box = page.locator(NOT_CHECKED_BOX);
    await expect(box.getByRole('note')).toHaveText(EN.cautions.notChecked.partial);
    // The line is about the rest of the food, the chip about what was found:
    // both food cards still say the food contains milk.
    const chips = page.locator('[data-slot="food-caution-chip"][data-caution-kind="allergen"]');
    await expect(chips).toHaveCount(2);
    await expect(chips.first()).toHaveText(EN.cautions.contains.milk);
    expect(await heightOf(box)).toBe(RESERVED_HEIGHT_PX);
  });

  test('CONTROL: a scan flagged with three empty lists gets no line, and keeps an empty box', async ({ page }) => {
    await completeOnboardingWithMilkAllergy(page);
    await connectStubAiProvider(page);
    await routeStubPlateAnswer(page, { flags: CHECKED_AND_EMPTY });

    await openReview(page);

    const box = page.locator(NOT_CHECKED_BOX);
    // The box is kept for a person who listed something, whether or not
    // there is a line to put in it, so nothing below it depends on the answer.
    await expect(box).toHaveCount(1);
    await expect(page.getByRole('note')).toHaveCount(0);
    await expect(box).toHaveText('');
    expect(await heightOf(box)).toBe(RESERVED_HEIGHT_PX);
  });

  test('the line moves nothing, on the first paint or in the second and a half after it', async ({ page }) => {
    await recordReviewFromFirstCommit(page, SAMPLE_WINDOW_MS);
    await turnOffScrollAnchoring(page);
    await completeOnboardingWithMilkAllergy(page);
    await connectStubAiProvider(page);
    await routeStubPlateAnswer(page);

    await openReview(page);
    await expect(page.getByRole('note')).toHaveText(EN.cautions.notChecked.all);
    // Let the sampling window close, the 1500 ms the page keeps watching.
    await page.waitForTimeout(SAMPLE_WINDOW_MS + 250);

    const reading = await readReviewReading(page);
    const start = reading.reviewStart;
    // NOT VACUOUS: the recorder saw the review, and sampled it many times.
    expect(start, 'the recorder never saw the review appear').not.toBeNull();
    expect(reading.samples.length, 'the recorder sampled too few frames to mean anything').toBeGreaterThan(10);
    const [first] = reading.samples;
    if (first === undefined) throw new Error('unreachable: sampled above');
    expect(Number.isFinite(first.card), 'no food card in the first sample').toBe(true);
    expect(Number.isFinite(first.confirm), 'no confirm button in the first sample').toBe(true);

    // The first sample is the first paint's layout. Every later frame agrees.
    expect(new Set(reading.samples.map((sample) => sample.card)), 'the first food row moved').toEqual(
      new Set([first.card]),
    );
    expect(new Set(reading.samples.map((sample) => sample.confirm)), 'the confirm button moved').toEqual(
      new Set([first.confirm]),
    );

    const afterReview = reading.shifts.filter((shift) => shift.startTime >= (start ?? 0));
    const score = afterReview.reduce((sum, shift) => sum + shift.value, 0);
    expect(score, `layout shift sources: ${afterReview.flatMap((shift) => shift.sources).join(' | ')}`).toBe(0);
  });
});

test('CONTROL: a person with no allergy and no pregnancy gets no line and no box', async ({ page }) => {
  await completeOnboarding(page);
  await connectStubAiProvider(page);
  // The same unflagged answer that earned the line above.
  await routeStubPlateAnswer(page);

  await openReview(page);

  await expect(page.locator(NOT_CHECKED_BOX)).toHaveCount(0);
  await expect(page.getByRole('note')).toHaveCount(0);
  await expect(page.getByText(EN.cautions.notChecked.all)).toHaveCount(0);
});
