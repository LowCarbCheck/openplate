/**
 * The personal app shell holds its own width, even when a page draws one
 * unbreakable line.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 *
 * `SidebarInset` (`app/components/ui/sidebar.tsx`), the `<main>` beside the
 * desktop sidebar, is a flex row item with no `min-w-0`. A flex row item's
 * automatic minimum width is its own min-content width, the width of the
 * widest thing inside it that cannot shrink. `overflow: hidden` changes what
 * is painted, never what is measured, so a `truncate` element still counts at
 * its full, unclipped width for that calculation. One long unbreakable line
 * anywhere inside `main`, at any depth, can hold the whole shell wider than
 * the viewport beside it. Measured on the administration console before that
 * page's own local fix (`app/routes/admin.tsx`): a 51 character sign in email
 * held `main` at 558 px beside a 256 px sidebar in a 768 px viewport.
 *
 * ── THE INJECTED LINE, AND WHY IT IS FAIR ────────────────────────────────
 *
 * This spec appends one synthetic line straight into `main`: a generated,
 * unbreakable, 80 character token with `truncate` classes (`overflow: hidden`,
 * `text-overflow: ellipsis`, `white-space: nowrap`), declared synthetic right
 * here. It stands in fairly for a real long value, an email, a food name, an
 * identifier, because the subject under test is the SHELL's width, never the
 * content: whatever page draws the line, the shell has to hold it. A
 * generated token says the same thing as a real address, in fewer, more
 * legible characters.
 *
 * ── WHAT THIS PROVES ─────────────────────────────────────────────────────
 *
 * At a phone width with no sidebar, at the `md` breakpoint itself and at a
 * laptop width, both carrying the desktop sidebar: the document never scrolls
 * sideways, and `main` never passes the right edge of the viewport, with the
 * line sitting inside it. The probe's own `scrollWidth` is read first, so a
 * future change that made the generated token wrap or shrink would fail on
 * that reading, never be mistaken for the shell holding its own width.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ────────────────────────────────────
 *
 * On the code before this fix, `main` has no `min-w-0`, so it grows to the
 * injected line's own width at every width in the walk, and the first two
 * assertions fail with the real pixel counts in the message.
 *
 * ── GEOMETRY, NEVER `innerWidth` ─────────────────────────────────────────
 *
 * This project emulates a phone (`isMobile: true`), and a phone browser zooms
 * out until overflowing content fits, which grows `window.innerWidth` along
 * with the very overflow being measured. `document.documentElement.clientWidth`
 * is the layout width, and does not move with the zoom. The sidebar's own
 * visibility is read BEFORE the probe is injected, so that reading is never
 * taken while the page might already be zoomed out from an earlier width.
 */
import { expect, test, type Page } from '@playwright/test';

import { completeOnboarding } from './helpers';
import { settleFrames } from './layout-shift';

/** A phone with no sidebar, the `md` breakpoint itself, and a laptop, both carrying the sidebar. */
const WALK_WIDTHS = [390, 768, 1280] as const;

/** Any height: nothing here depends on it. */
const WALK_HEIGHT = 844;

/** `MOBILE_BREAKPOINT` in `app/hooks/use-mobile.ts`, repeated so this spec states its own claim. */
const DESKTOP_SIDEBAR_MIN_PX = 768;

/** How many characters the injected line holds. */
const PROBE_CHARACTER_COUNT = 80;

/** A generated, unbreakable token, standing in for a long value like an email or an id. */
const PROBE_TEXT = Array.from(
  { length: PROBE_CHARACTER_COUNT },
  (_unused, index) => 'abcdefghijklmnopqrstuvwxyz0123456789'[index % 36],
).join('');

/** The slot name the probe is found by, never a class or a tag the shell itself might also use. */
const PROBE_SLOT = 'shell-width-probe';
const PROBE_SELECTOR = `[data-slot="${PROBE_SLOT}"]`;

/** Sub pixel slack for a box edge that sits exactly on the viewport edge. */
const EDGE_TOLERANCE_PX = 0.5;

/** The narrowest a generated 80 character line can read as and still prove it cannot shrink. */
const PROBE_MIN_WIDTH_PX = 400;

/** Appends the probe line straight into `main`, fresh, for one reading. */
async function injectProbe(page: Page): Promise<void> {
  await page.evaluate(
    ({ slot, text }) => {
      const main = document.querySelector('main');
      if (main === null) throw new Error('the shell has no main element');
      const probe = document.createElement('div');
      probe.dataset.slot = slot;
      probe.className = 'truncate';
      probe.textContent = text;
      main.append(probe);
    },
    { slot: PROBE_SLOT, text: PROBE_TEXT },
  );
}

/** Removes the probe, so the next width's sidebar reading starts from a page that is not already overflowing. */
async function removeProbe(page: Page): Promise<void> {
  await page.evaluate((selector) => document.querySelector(selector)?.remove(), PROBE_SELECTOR);
}

interface WidthReading {
  documentScrollWidth: number;
  documentClientWidth: number;
  mainRight: number;
  probeScrollWidth: number;
}

/** Reads the shell's geometry, and the probe's own unclipped width, in one pass. */
async function readWidth(page: Page): Promise<WidthReading> {
  return page.evaluate((selector) => {
    const main = document.querySelector('main');
    const probe = document.querySelector(selector);
    if (main === null || probe === null) throw new Error('the shell must carry a main element and the probe');
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      mainRight: main.getBoundingClientRect().right,
      probeScrollWidth: probe.scrollWidth,
    };
  }, PROBE_SELECTOR);
}

test('the shell holds its width beside one unbreakable line, at a phone width and beside the desktop sidebar', async ({
  page,
}) => {
  await completeOnboarding(page);

  for (const width of WALK_WIDTHS) {
    await page.setViewportSize({ width, height: WALK_HEIGHT });
    await settleFrames(page);

    // Read BEFORE the probe exists, so a width that overflows cannot have
    // already zoomed the page out and skewed this reading.
    const sidebar = page.locator('[data-slot="sidebar"]').first();
    if (width >= DESKTOP_SIDEBAR_MIN_PX) {
      await expect(sidebar, `${width}px: the desktop sidebar`).toBeVisible();
    } else {
      await expect(sidebar, `${width}px: the desktop sidebar`).toBeHidden();
    }

    await injectProbe(page);
    await settleFrames(page);
    const reading = await readWidth(page);

    // CONTROL: the probe itself must be the wide, unbreakable line this spec
    // claims it is, or the checks below would be proving nothing.
    expect(reading.probeScrollWidth, `${width}px: the probe must be an unbreakable line`).toBeGreaterThan(
      PROBE_MIN_WIDTH_PX,
    );
    expect(
      reading.documentScrollWidth,
      `${width}px: the document scrolls sideways, ${reading.documentScrollWidth} px of content in ${reading.documentClientWidth} px`,
    ).toBeLessThanOrEqual(reading.documentClientWidth + EDGE_TOLERANCE_PX);
    expect(
      reading.mainRight,
      `${width}px: main's right edge is at ${reading.mainRight} px, past a ${reading.documentClientWidth} px viewport`,
    ).toBeLessThanOrEqual(reading.documentClientWidth + EDGE_TOLERANCE_PX);

    await removeProbe(page);
  }
});
