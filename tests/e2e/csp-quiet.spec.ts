/**
 * A page load reports no content security policy violation (M253/11 item 3).
 *
 * THE DEFECT. Every page load reported one blocked `eval` from the shared
 * `schemas-*.js` chunk. Zod 4 decides whether it may compile a fast object
 * parser by calling `new Function("")` once, catches the refusal, and falls
 * back. The production policy refuses `eval` on purpose, so the probe never
 * helped, and the browser reported it as a violation on every page. A real
 * violation (a script from a host the policy does not name) would have been
 * lost in that noise. The app now sets zod's `jitless` flag before any schema
 * is built (`app/lib/zod-jitless.ts`), which skips the probe.
 *
 * THE LISTENER IS INSTALLED BEFORE ANY PAGE SCRIPT, so a violation raised
 * while the first module evaluates is recorded too.
 *
 * THE CONTROL loads a script from a host the policy does not allow and
 * requires the same listener to record it. Without it, a listener that never
 * fired would pass the zero check.
 */
import { expect, test, type Page } from '@playwright/test';

import { settleFrames } from './layout-shift';

test.use({ serviceWorkers: 'block' });

/** A host no policy of this app names. Nothing is ever fetched from it: the policy refuses it first. */
const DISALLOWED_SCRIPT = 'https://csp-control.invalid/probe.js';

/** The pages read. Each is a full document load, so each evaluates the module graph afresh. */
const PAGES = ['/', '/diary', '/add/photo', '/settings'] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, '__cspViolations', { value: seen });
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`);
    });
  });
});

/** Every violation this document recorded so far. */
async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const recorded = Object.getOwnPropertyDescriptor(window, '__cspViolations')?.value;
    return Array.isArray(recorded) ? recorded.map(String) : [];
  });
}

/** Loads one page and waits until its scripts ran and the network went quiet. */
async function loadQuietly(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await settleFrames(page);
}

test('no page load reports a content security policy violation', async ({ page }) => {
  for (const path of PAGES) {
    await loadQuietly(page, path);
    expect(await cspViolations(page), `${path} reported a violation`).toEqual([]);
  }
});

test('control: the same listener records a script the policy refuses', async ({ page }) => {
  await loadQuietly(page, '/diary');
  await page.evaluate((src) => {
    const script = document.createElement('script');
    script.src = src;
    document.head.append(script);
  }, DISALLOWED_SCRIPT);
  await expect
    .poll(async () => (await cspViolations(page)).some((entry) => entry.includes('csp-control.invalid')))
    .toBe(true);
});
