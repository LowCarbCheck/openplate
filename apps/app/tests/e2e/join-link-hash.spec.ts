/**
 * `/join` reads a second link that arrives in the same tab.
 *
 * THE REPORT, install rehearsal, 2026-09-27: `/join#server=<wrong>&invite=...`
 * showed the right card, "This link is for another openplate". Then, in the
 * same tab, `/join#server=<right>&invite=...`: the old card stayed until a
 * full reload. A navigation that changes only the fragment keeps the page
 * mounted, and the page read its link once, on mount.
 *
 * `page.goto` to the same path with a new fragment is that navigation: the
 * browser treats it as a same-document fragment change, exactly like editing
 * the fragment in the address bar, and fires `hashchange` without a load.
 *
 * WHAT IS REAL: the production build and the tier's fake sync service, which
 * does not know the invite below and answers 404, so the page lands on "this
 * invitation is no longer valid". That card, and not a form, is the proof the
 * second link was read and dialled.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { z } from 'zod';

import { E2E_SYNC_SERVER_URL } from './env';

test.use({ serviceWorkers: 'block' });

const COPY = z
  .object({
    join: z.object({
      foreignServer: z.object({ title: z.string() }),
      inviteInvalid: z.object({ title: z.string() }),
    }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** A well-formed invite the fake service has never minted. */
const UNKNOWN_INVITE = 'si_e2e-never-minted';

/** A join fragment for one server. */
function joinFragment(serverUrl: string): string {
  return `#server=${encodeURIComponent(serverUrl)}&invite=${UNKNOWN_INVITE}`;
}

test('a second link in the same tab replaces the first one', async ({ page }) => {
  await page.goto(`/join${joinFragment('https://sync.another-openplate.example')}`);
  const foreign = page.getByText(COPY.join.foreignServer.title, { exact: true });
  await expect(foreign).toBeVisible();

  // A mark on this document. A reload would start a new one without it.
  await page.evaluate(() => Object.defineProperty(window, '__e2eFirstDocument', { value: true }));
  await page.goto(`/join${joinFragment(E2E_SYNC_SERVER_URL)}`);
  // Same document: no reload happened, so what follows is the page reacting.
  expect(await page.evaluate(() => '__e2eFirstDocument' in window), 'the fragment change reloaded the page').toBe(true);

  await expect(page.getByText(COPY.join.inviteInvalid.title, { exact: true })).toBeVisible();
  await expect(foreign).toHaveCount(0);
});

test('control: the right link on a fresh load lands on the same card', async ({ page }) => {
  await page.goto(`/join${joinFragment(E2E_SYNC_SERVER_URL)}`);
  await expect(page.getByText(COPY.join.inviteInvalid.title, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.join.foreignServer.title, { exact: true })).toHaveCount(0);
});
