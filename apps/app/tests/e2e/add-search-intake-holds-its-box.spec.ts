/**
 * The AI intake block on `/add/search` keeps its box while nobody knows yet
 * whether this device has an AI (2026-10-13).
 *
 * THE BUG. Under the search box the screen draws one of two things: "Log with
 * AI" and its hint for a device that has an AI, or a one-line notice for one
 * that has none. Which one is only known after a read (the session resume on
 * a managed instance, the device's AI row on an open one), and until then the
 * screen drew nothing. When the answer landed, everything below moved down,
 * "Can't find it? Add manually" included. A tap aimed at that button in the
 * same moment pressed it and released on whatever had moved under the finger,
 * so it did nothing: `logFoodManually` timed out that way on the CI runner and
 * in 2 of 40 runs of `usual-at-slot.spec.ts` under load.
 *
 * HOW THE ANSWER IS HELD. A managed instance, whose AI state stays `unknown`
 * while the session resumes, and the resume's first request
 * (`POST /v1/auth/refresh`) held behind a gate. The page is fully drawn in
 * that window, which is exactly the window a person taps in. An open
 * instance's AI row is an IndexedDB read with no request to hold, and the
 * screen draws both instance kinds from the same `aiConnection` value.
 *
 * BOTH ANSWERS, AT 390 AND 320 PX, AND IN GERMAN, the longest language: the
 * notice and the hint wrap to a different number of lines at each, so a box
 * sized for one would move things for another.
 *
 * THE CONTROL is a 40 px block put above the button by hand after the same
 * baseline: both readings must see it, so the zeros above are a page that
 * held still and not a reading that cannot move.
 *
 * @area diary-and-add
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { LANGUAGE_COOKIE } from '../../app/i18n/language-prefs';
import { catalogFor } from './copy';
import { E2E_CORE_URL } from './env';
import { PHONE_HEIGHT } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
  turnOffScrollAnchoring,
} from './layout-shift';
import { routeManagedCore, signInManaged, type ManagedCoreStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { createGate, NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot, beside the tier's 30 s per spec. */
const BOOT_BUDGET_MS = 90_000;

/** The height of the block the control puts above the button. */
const CONTROL_BLOCK_PX = 40;

type Language = 'en' | 'de';
type Outcome = 'connected' | 'absent';

/** The two strings this spec reads beyond `catalogFor`, from the shipped catalog, so a renamed key fails on load. */
const intakeCopySchema = z.looseObject({
  add: z.looseObject({ aiIntake: z.looseObject({ submit: z.string() }) }),
  aiIntake: z.looseObject({ noAllowance: z.string() }),
});

function intakeCopy(language: Language): z.infer<typeof intakeCopySchema> {
  return intakeCopySchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), `app/i18n/locales/${language}/common.json`), 'utf8')),
  );
}

/**
 * An account on an instance that sells nothing, so no paywall and no offer
 * card can enter the picture, and with no invitations, so an account without
 * AI reads the one-line `ask-admin` notice before and after the handshake.
 */
function accountStub(outcome: Outcome): ManagedCoreStub {
  return {
    trialScans: null,
    allowanceExpiresAt: null,
    dailyAiLimit: outcome === 'connected' ? 20 : 0,
    invitesLeft: null,
    memberInvites: false,
    planView: NO_SUBSCRIPTION_VIEW,
    plans: false,
  };
}

/** What the screen draws for each answer, found by the shipped words. */
function outcomeLocator(page: Page, outcome: Outcome, language: Language) {
  const copy = intakeCopy(language);
  return outcome === 'connected' ?
      page.getByRole('button', { name: copy.add.aiIntake.submit, exact: true })
    : page.getByText(copy.aiIntake.noAllowance, { exact: true });
}

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

const CASES = [
  { width: 390, language: 'en' },
  { width: 320, language: 'en' },
  { width: 320, language: 'de' },
] as const;

for (const outcome of ['absent', 'connected'] as const) {
  for (const { width, language } of CASES) {
    test(`the intake block holds its box while the AI is unknown, and nothing moves when it resolves ${outcome} (${width} px, ${language})`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: PHONE_HEIGHT });
      await routeManagedCore(page, accountStub(outcome));
      await signInManaged(page, server.url);

      // THE HOLD, installed after the sign-in so that one runs normally.
      // Registered last, so it answers first; the preflight goes straight on.
      const gate = createGate();
      const held = { refreshes: 0 };
      await page.route(`${E2E_CORE_URL}/v1/auth/refresh`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        held.refreshes += 1;
        await gate.promise;
        return route.fallback();
      });
      await installShiftObserver(page);
      await turnOffScrollAnchoring(page);
      await page.context().addCookies([{ name: LANGUAGE_COOKIE, value: language, url: server.url }]);

      await page.goto(`${server.url}/add/search`);
      const toggle = page.getByRole('button', { name: catalogFor(language).add.search.addManually, exact: true });
      await expect(toggle).toBeVisible();
      await expect.poll(() => held.refreshes, { message: 'the resume never asked for a refresh' }).toBeGreaterThan(0);
      // STILL UNKNOWN: neither answer is on screen, so the reading below is
      // taken inside the window the bug lived in, not after it.
      await expect(outcomeLocator(page, 'connected', language)).toBeHidden();
      await expect(outcomeLocator(page, 'absent', language)).toBeHidden();

      // On screen, because a layout-shift entry only counts what moved in the viewport.
      await toggle.scrollIntoViewIfNeeded();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await settleAnimations(page);
      const toggleTop = await toggle.evaluate((element) => element.getBoundingClientRect().top);
      const before = await readTops(page);
      const since = (await readShiftEntries(page)).length;

      gate.open();
      await expect(outcomeLocator(page, outcome, language)).toBeVisible();
      await settleFrames(page);
      await settleFrames(page);

      expect(
        await toggle.evaluate((element) => element.getBoundingClientRect().top),
        `"Add manually" moved when the AI state resolved ${outcome}`,
      ).toBe(toggleTop);
      expect(movedBetween(before, await readTops(page)), 'what sits below the intake block').toEqual([]);
      const entries = await readShiftEntries(page);
      expect(
        shiftScoreAfter(entries, since),
        `layout-shift as the AI state resolved: ${JSON.stringify(entries.slice(since))}`,
      ).toBe(0);

      // THE CONTROL: a block that does appear above the button is seen by both
      // readings. AT LEAST its height, because the column spaces its children
      // and the block gets that margin too.
      const controlSince = (await readShiftEntries(page)).length;
      await page.locator('input#food-search').evaluate((input, height) => {
        const block = document.createElement('div');
        block.style.height = `${height}px`;
        input.closest('.grid')?.after(block);
      }, CONTROL_BLOCK_PX);
      await settleFrames(page);
      expect(await toggle.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(
        toggleTop + CONTROL_BLOCK_PX,
      );
      await expect
        .poll(async () => shiftScoreAfter(await readShiftEntries(page), controlSince))
        .toBeGreaterThan(0);
    });
  }
}
