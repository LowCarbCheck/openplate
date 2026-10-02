/**
 * `/join` and what this device already holds: a session, a stale session, or
 * a link for another server.
 *
 * THE REPORT, install rehearsal, 2026-09-27: one browser profile used an
 * invitation for one server address, later opened a correct invitation for
 * the instance's real address, and `/join` kept saying "This link is for
 * another openplate" until the site data was cleared.
 *
 * WHAT `/join` COMPARES, read in the code and measured here: the link's
 * `server=` origin against the root loader's `publicConfig.syncServerUrl`
 * (the app's `CORE_URL`, which compose fills from `PUBLIC_SYNC_URL`).
 * No value stored on the device takes part in that check. The stored half
 * that DID misbehave is the device's own session:
 *
 * - A device signed in as somebody else was never told so on a document load,
 *   because the session is only rebuilt under `_personal` and `/join` sits
 *   outside it. The page offered the new account's form over the open one.
 *   The card that says so existed, but only a tab that had come from inside
 *   the app could reach it, and its sign-out button needed a session that a
 *   document load never opens.
 * - The foreign-server card named one address, the link's server, and told
 *   the person to "open it there". That address is a core server, not an app,
 *   and nothing told them which server this app uses.
 *
 * The stale session for another server and the tunnel origin both worked on
 * the build before the fix. Their checks stay as guards: the first is the
 * control for the signed-in check above, which must never mistake a stale
 * session for a live one.
 *
 * WHAT IS REAL: the production build and the tier's fake core server, which
 * mints real invitations through its `__e2e__` seam, so every account here is
 * new and the shared fixture account is untouched.
 *
 * @area accounts-and-sign-in
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { E2E_APP_PORT, E2E_CORE_URL } from './env';

test.use({ serviceWorkers: 'block' });

const COPY = z
  .object({
    join: z.object({
      foreignServer: z.object({ title: z.string() }),
      signedInElsewhere: z.object({ title: z.string(), signOut: z.string() }),
    }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** A password the create form accepts. */
const PASSWORD = 'seventeen orange lanterns drifting home';

/** A server this tier does not run, as an older invitation would name it. */
const OTHER_SERVER = 'https://sync.another-openplate.example';

/** How long an account ceremony may take: Argon2id in the browser plus two round trips. */
const CEREMONY_BUDGET_MS = 60_000;

const inviteAnswerSchema = z.object({ inviteToken: z.string().min(1) });

/** What this device's cached session says about itself, or `null` when there is none. */
const cachedSessionSchema = z.object({ email: z.string(), serverUrl: z.string() }).nullable();

/** A fresh address per call, so no two tests and no two runs meet. */
function newAddress(label: string): string {
  return `${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.invalid`;
}

/** Mints an invitation on the fake service, the way an admin would. */
async function mintInvite(email: string): Promise<string> {
  const response = await fetch(`${E2E_CORE_URL}/__e2e__/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(`the fake service minted no invite: ${response.status}`);
  return inviteAnswerSchema.parse(await response.json()).inviteToken;
}

/** The join link an admin hands out, for this tier's own server unless told otherwise. */
function joinPath({ inviteToken, serverUrl = E2E_CORE_URL }: { inviteToken: string; serverUrl?: string }): string {
  return `/join#server=${encodeURIComponent(serverUrl)}&invite=${inviteToken}`;
}

/** The create form's password fields: their presence is the proof the invitation was accepted. */
function passwordFields(page: Page) {
  return page.locator('main input[type="password"]');
}

/** Fills and submits the create form that is on screen, and waits to leave `/join`. */
async function createAccountOnScreen(page: Page): Promise<void> {
  await expect(passwordFields(page).first()).toBeVisible({ timeout: 10_000 });
  await passwordFields(page).nth(0).fill(PASSWORD);
  await passwordFields(page).nth(1).fill(PASSWORD);
  await page.locator('main form button[type="submit"]').last().click();
  await page.waitForURL(/\/(diary|onboarding)/, { timeout: CEREMONY_BUDGET_MS });
}

/** Reads the one row of `openplate-session`, the session a reload would resume. */
async function readCachedSession(page: Page): Promise<z.infer<typeof cachedSessionSchema>> {
  const row: unknown = await page.evaluate(
    () =>
      new Promise((resolveRow, rejectRow) => {
        const open = indexedDB.open('openplate-session');
        open.addEventListener('error', () => rejectRow(open.error));
        open.addEventListener('success', () => {
          const database = open.result;
          if (!database.objectStoreNames.contains('session')) {
            database.close();
            resolveRow(null);
            return;
          }
          const request = database.transaction('session', 'readonly').objectStore('session').get('me');
          request.addEventListener('error', () => rejectRow(request.error));
          request.addEventListener('success', () => {
            // Two fields only: the row also holds a `CryptoKey`, which cannot
            // leave the page.
            const record = request.result;
            database.close();
            resolveRow(record ? { email: record.email, serverUrl: record.serverUrl } : null);
          });
        });
      }),
  );
  return cachedSessionSchema.parse(row);
}

/** Rewrites the cached session's server, as if an operator had since moved the instance to another one. */
async function pointCachedSessionAt(page: Page, serverUrl: string): Promise<void> {
  await page.evaluate(
    (nextServerUrl) =>
      new Promise<void>((resolveWrite, rejectWrite) => {
        const open = indexedDB.open('openplate-session');
        open.addEventListener('error', () => rejectWrite(open.error));
        open.addEventListener('success', () => {
          const database = open.result;
          const transaction = database.transaction('session', 'readwrite');
          const store = transaction.objectStore('session');
          const request = store.get('me');
          request.addEventListener('success', () => {
            store.put({ ...request.result, serverUrl: nextServerUrl }, 'me');
          });
          transaction.addEventListener('complete', () => {
            database.close();
            resolveWrite();
          });
          transaction.addEventListener('error', () => rejectWrite(transaction.error));
        });
      }),
    serverUrl,
  );
}

test('a device signed in as somebody else says so on a document load, and signing out continues', async ({ page }) => {
  test.setTimeout(3 * CEREMONY_BUDGET_MS);
  const first = newAddress('first');
  const second = newAddress('second');
  await page.goto(joinPath({ inviteToken: await mintInvite(first) }));
  await createAccountOnScreen(page);
  expect(await readCachedSession(page), 'the first account left no session on this device').toMatchObject({
    email: first,
  });

  // A DOCUMENT LOAD, the way a link from a mail app arrives.
  await page.goto(joinPath({ inviteToken: await mintInvite(second) }));
  const card = page.locator('main [data-slot="join-signed-in-elsewhere"]');
  await expect(page.getByText(COPY.join.signedInElsewhere.title, { exact: true })).toBeVisible();
  await expect(card).toContainText(first);
  await expect(card).toContainText(second);
  await expect(passwordFields(page)).toHaveCount(0);

  // THE WAY FORWARD: one press signs this device out and brings the same
  // invitation back, with no second link.
  await page.getByRole('button', { name: COPY.join.signedInElsewhere.signOut, exact: true }).click();
  await expect(page.locator('main')).toContainText(second, { timeout: 15_000 });
  await createAccountOnScreen(page);
  await expect
    .poll(() => readCachedSession(page), { message: 'the second account did not replace the first' })
    .toMatchObject({ email: second, serverUrl: E2E_CORE_URL });
});

test('a session saved for another server never blocks an invitation, and is replaced', async ({ page }) => {
  test.setTimeout(3 * CEREMONY_BUDGET_MS);
  const first = newAddress('stale');
  const second = newAddress('fresh');
  await page.goto(joinPath({ inviteToken: await mintInvite(first) }));
  await createAccountOnScreen(page);
  await pointCachedSessionAt(page, OTHER_SERVER);
  expect(await readCachedSession(page)).toMatchObject({ email: first, serverUrl: OTHER_SERVER });

  await page.goto(joinPath({ inviteToken: await mintInvite(second) }));
  await expect(page.locator('main')).toContainText(second);
  await expect(passwordFields(page).first()).toBeVisible();
  await expect(page.getByText(COPY.join.signedInElsewhere.title, { exact: true })).toHaveCount(0);
  await expect(page.getByText(COPY.join.foreignServer.title, { exact: true })).toHaveCount(0);

  await createAccountOnScreen(page);
  await expect
    .poll(() => readCachedSession(page), { message: 'the stale session was not replaced' })
    .toMatchObject({ email: second, serverUrl: E2E_CORE_URL });
});

test('a link for another server names that server and the one this app uses', async ({ page }) => {
  await page.goto(joinPath({ inviteToken: 'si_e2e-never-minted', serverUrl: OTHER_SERVER }));
  await expect(page.getByText(COPY.join.foreignServer.title, { exact: true })).toBeVisible();
  const main = page.locator('main');
  await expect(main).toContainText(OTHER_SERVER);
  await expect(main).toContainText(new URL(E2E_CORE_URL).origin);
});

test('an app opened at another address than its own still takes a link for its server', async ({ page }) => {
  test.setTimeout(2 * CEREMONY_BUDGET_MS);
  // THE TUNNEL: the tier's server says its address is 127.0.0.1, and this page
  // is on `localhost`, as an ssh tunnel or a second name for the host gives.
  const tunnelOrigin = `http://localhost:${E2E_APP_PORT}`;
  const email = newAddress('tunnel');
  await page.goto(`${tunnelOrigin}${joinPath({ inviteToken: await mintInvite(email) })}`);
  expect(new URL(page.url()).origin).toBe(tunnelOrigin);
  await createAccountOnScreen(page);
  expect(await readCachedSession(page)).toMatchObject({ email, serverUrl: E2E_CORE_URL });
});
