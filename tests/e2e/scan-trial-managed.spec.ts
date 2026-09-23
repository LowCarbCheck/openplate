/**
 * The free scans count down from the proxy's own answer, and every person
 * action is one intake (M253/05).
 *
 * WHAT IS REAL: the production build booted as a MANAGED instance
 * (`managed-app-server.ts`), so AI goes through the managed credential to
 * `${SYNC_SERVER_URL}/v1/chat/completions`, the only path that sends
 * `X-Intake-Id` and reads `X-Trial-Scans-Left`. The sign-in, the session, the
 * header's status slot, the countdown, the scan screen, the describe screen,
 * the pantry and the recipes are the app's own.
 *
 * WHAT IS STUBBED: `/health` (a model and a biller), the plan reads, the
 * account's allowance and scan count on every auth answer, and the proxy's
 * chat completions, which answer each task by its schema name and state the
 * scans left in a response header.
 *
 * THE ACCOUNT STUB NEVER MOVES ITS COUNT. It says 3 on every read. So a header
 * that says 2 after a scan can only have read the response header, and the
 * spec counts account reads to show no refetch happened.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type Request } from '@playwright/test';
import { z } from 'zod';

import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '../../app/lib/sync/engine/protocol';
import { EN, fill } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_ACCOUNT_PASSPHRASE, E2E_SYNC_SERVER_URL } from './env';
import { pantryRowsOnDisk } from './helpers';
import { settleFrames } from './layout-shift';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { FIXTURE_OFFER_BODY, NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** A walk through four screens takes longer than the tier's 30 s per spec. */
const WALK_BUDGET_MS = 90_000;

/** The recipes screen's sentence for an instance with no model, read from the shipped English bundle. */
const NO_MODEL_SENTENCE = z
  .object({ recipes: z.object({ errors: z.object({ noModel: z.string() }) }) })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8'))).recipes.errors
  .noModel;

/** The scans the stubbed account says are left, on every read. */
const ACCOUNT_SCANS_LEFT = 3;

/** A valid 1 x 1 PNG, the smallest thing the photo checks accept. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** One food, every field of the plate schema present. */
const PLATE_ANSWER = {
  foods: [
    {
      name: 'Scan trial tier rye bread',
      estimatedGrams: 40,
      confidence: 'high',
      portionHint: null,
      macrosPer100g: { carbs: 40, fiber: 6, sugars: null, polyols: null, protein: 8, fat: 3, kcal: 230 },
      macroSource: 'estimated',
      carbBasis: null,
      brand: null,
      servingSize: null,
    },
  ],
  unreadable: false,
  unreadableReason: null,
  notes: null,
};

/** One pantry item, every field present. */
const PANTRY_ANSWER = {
  items: [{ name: 'Scan trial tier eggs', amount: 6, unit: 'piece', category: 'egg', confidence: 'high' }],
  notes: null,
};

/** Two recipes, the smallest count the recipe schema accepts. */
const RECIPE_ANSWER = {
  recipes: ['Scan trial tier omelette', 'Scan trial tier scramble'].map((title) => ({
    title,
    servings: 1,
    servingGrams: 250,
    ingredients: [{ name: 'Scan trial tier eggs', amount: 3, unit: 'piece', fromPantry: true }],
    steps: ['Beat the eggs.', 'Cook them.'],
    perServing: { kcal: 300, proteinG: 20, carbsG: 2, fiberG: 0, fatG: 22 },
    whyItFits: 'Protein, almost no carbohydrate.',
    prepMinutes: 10,
  })),
};

/** The part of a chat completion request this stub reads. */
const taskRequestSchema = z.object({
  response_format: z.object({ json_schema: z.object({ name: z.string() }) }).optional(),
});

/** What one proxied request carried. */
interface ProxyCall {
  task: string;
  intakeId: string | null;
}

/** What the stubs saw, and the model the handshake names, which a spec may change between loads. */
interface Recorded {
  calls: ProxyCall[];
  accountReads: number;
  model: string | null;
}

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** The answer one task name is given, or `null` for a name this stub does not know. */
function answerFor(task: string): object | null {
  if (task === 'plate_identification') return PLATE_ANSWER;
  if (task === 'pantry_identification') return PANTRY_ANSWER;
  if (task === 'recipe_proposals') return RECIPE_ANSWER;
  return null;
}

/** CORS for a stubbed cross-origin answer, including the one header the app must read. */
function corsHeaders(request: Request) {
  return {
    'Access-Control-Allow-Origin': request.headers().origin ?? '*',
    'Access-Control-Expose-Headers': 'X-Trial-Scans-Left',
  };
}

/** Routes the handshake, the plan reads, the account and the proxy. */
async function routeManagedCore(page: Page): Promise<Recorded> {
  const recorded: Recorded = { calls: [], accountReads: 0, model: 'e2e-model' };
  let scansLeft = ACCOUNT_SCANS_LEFT;

  await page.route(`${E2E_SYNC_SERVER_URL}/health`, (route) =>
    route.fulfill({
      json: {
        protocolVersion: PROTOCOL_VERSION,
        envelopeVersion: ENVELOPE_VERSION,
        serviceVersion: 'fake-e2e',
        instance: {
          name: 'openplate-e2e',
          language: 'en',
          mail: false,
          memberInvites: false,
          plans: true,
          openSignup: true,
          ai: { model: recorded.model },
          trial: { scans: 10 },
        },
      },
    }),
  );
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/plans/me`, (route) => route.fulfill({ json: NO_SUBSCRIPTION_VIEW }));
  await page.route(
    (url) => url.href.startsWith(`${E2E_SYNC_SERVER_URL}/v1/plans/offer`),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: FIXTURE_OFFER_BODY }),
  );
  await page.route(
    (url) => url.href.startsWith(`${E2E_SYNC_SERVER_URL}/v1/auth/`),
    async (route) => {
      const request = route.request();
      if (request.method() === 'GET' && request.url() === `${E2E_SYNC_SERVER_URL}/v1/auth/account`) {
        recorded.accountReads += 1;
      }
      const response = await route.fetch();
      const text = await response.text();
      const parsed = z.looseObject({ account: z.record(z.string(), z.unknown()) }).safeParse(text === '' ? null : JSON.parse(text));
      if (!parsed.success) return route.fulfill({ response, body: text });
      return route.fulfill({
        response,
        json: {
          ...parsed.data,
          account: {
            ...parsed.data.account,
            dailyAiLimit: 20,
            allowanceExpiresAt: null,
            trialScans: { granted: 10, left: ACCOUNT_SCANS_LEFT },
          },
        },
      });
    },
  );
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/chat/completions`, (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...corsHeaders(request),
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': request.headers()['access-control-request-headers'] ?? '*',
        },
      });
    }
    const task = taskRequestSchema.parse(request.postDataJSON()).response_format?.json_schema.name ?? '';
    recorded.calls.push({ task, intakeId: request.headers()['x-intake-id'] ?? null });
    const answer = answerFor(task);
    if (answer === null) return route.fulfill({ status: 400, json: { error: `no answer for ${task}` } });
    scansLeft = Math.max(0, scansLeft - 1);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { ...corsHeaders(request), 'X-Trial-Scans-Left': String(scansLeft) },
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(answer) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    });
  });
  return recorded;
}

/** Signs the fixture account in on the managed build, finishing onboarding when its diary holds no profile yet. */
async function signInManaged(page: Page): Promise<void> {
  await page.goto(`${server.url}/sign-in`);
  await page.locator('input[autocomplete="username"]').fill(E2E_ACCOUNT_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ACCOUNT_PASSPHRASE);
  await page.getByRole('button', { name: EN.sync.signIn.submit, exact: true }).click();
  await page.waitForURL(/\/(diary|onboarding)/);
  if (!page.url().includes('/onboarding')) return;
  // The same steps `completeOnboarding` takes, each after its own heading.
  await expect(page.getByText(EN.onboarding.style.title)).toBeVisible();
  await page.locator('input[name="eatingStyle"][value="just-track"]').check();
  await page.getByRole('button', { name: EN.onboarding.actions.continue }).click();
  await expect(page.getByText(EN.onboarding.step.weight.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.body.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.actions.skip }).click();
  await expect(page.getByText(EN.onboarding.step.firstFood.title)).toBeVisible();
  await page.getByRole('button', { name: EN.onboarding.firstFood.later }).click();
  await page.waitForURL('**/diary');
}

/** The header's status row. */
function headerStatus(page: Page) {
  return page.locator('header [data-slot="header-status"]');
}

/** Photographs one plate on the scan screen and waits for the review. */
async function scanOnePlate(page: Page): Promise<void> {
  const captureCard = page.locator('[data-slot="card"]').filter({ has: page.locator('input[type="file"][capture]') });
  await captureCard
    .locator('input[type="file"][capture]')
    .setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  await expect(page.getByText(EN.scan.review.heading)).toBeVisible({ timeout: 10_000 });
}

test('one plate scan moves the header from 3 to 2 from the response, with no account read', async ({ page }) => {
  const recorded = await routeManagedCore(page);
  await signInManaged(page);

  await page.goto(`${server.url}/add/photo`);
  const three = fill(EN.plan.countdown.scansLeft_other, { count: '3' });
  await expect(headerStatus(page)).toContainText(three, { timeout: 10_000 });
  await settleFrames(page);
  const readsBefore = recorded.accountReads;

  await scanOnePlate(page);
  await expect(headerStatus(page)).toContainText(fill(EN.plan.countdown.scansLeft_other, { count: '2' }));
  await expect(headerStatus(page)).not.toContainText(three);
  expect(recorded.accountReads - readsBefore, 'the count came from an account refetch').toBe(0);

  expect(recorded.calls.map((call) => call.task)).toEqual(['plate_identification']);
  expect(recorded.calls[0]?.intakeId, 'the scan carried no intake id').toMatch(/^[A-Za-z0-9_-]{16,64}$/);
});

test('a second photo, a typed meal, a pantry read and a recipe round each send one new intake id', async ({
  page,
}) => {
  test.setTimeout(WALK_BUDGET_MS);
  const recorded = await routeManagedCore(page);
  await signInManaged(page);

  // A plate, and a second photo (a label is the same person action).
  await page.goto(`${server.url}/add/photo`);
  await scanOnePlate(page);
  await page.goto(`${server.url}/add/photo`);
  await scanOnePlate(page);

  // A typed meal.
  // Typed once the screen is live: the send button enables on the typed text,
  // and a fill that lands before hydration would leave it off.
  await page.goto(`${server.url}/add/describe`);
  const send = page.getByRole('button', { name: EN.describe.send, exact: true });
  await expect(async () => {
    await page.locator('#describe-meal').fill('two slices of rye bread');
    await expect(send).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await send.click();
  await expect(page.getByText(EN.scan.review.heading)).toBeVisible({ timeout: 10_000 });

  // A pantry read, kept, then one round of recipes.
  await page.goto(`${server.url}/pantry`);
  await page
    .locator('main div.max-w-xl input[type="file"][capture]')
    .setInputFiles({ name: 'shelf.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  await expect(page.getByText(EN.pantry.review.title)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: EN.pantry.review.confirm }).click();
  // The recipes read the pantry off the disk, so the save must have landed.
  await expect.poll(() => pantryRowsOnDisk(page)).toBe(1);
  await page.getByRole('link', { name: EN.pantry.recipes.link }).click();
  await expect.poll(() => recorded.calls.filter((call) => call.task === 'recipe_proposals').length).toBe(1);

  expect(recorded.calls.map((call) => call.task)).toEqual([
    'plate_identification',
    'plate_identification',
    'plate_identification',
    'pantry_identification',
    'recipe_proposals',
  ]);
  const ids = recorded.calls.map((call) => call.intakeId);
  expect(ids.every((id) => id !== null), 'an action sent no intake id').toBe(true);
  expect(new Set(ids).size, 'two actions shared one intake id').toBe(ids.length);
});

test('a recipe round on an instance with no model says so instead of waiting', async ({ page }) => {
  const recorded = await routeManagedCore(page);
  await signInManaged(page);

  // A pantry to ask about, read while the instance still names a model.
  await page.goto(`${server.url}/pantry`);
  await page
    .locator('main div.max-w-xl input[type="file"][capture]')
    .setInputFiles({ name: 'shelf.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  await expect(page.getByText(EN.pantry.review.title)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: EN.pantry.review.confirm }).click();
  await expect.poll(() => pantryRowsOnDisk(page)).toBe(1);

  // The operator's model goes away. A document load reads the handshake again.
  recorded.model = null;
  await page.goto(`${server.url}/pantry/recipes`);
  await expect(page.getByText(NO_MODEL_SENTENCE)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(EN.recipes.asking)).toHaveCount(0);
  // THE CONTROL is the walk above, where the same screen with a model sends a round.
  expect(recorded.calls.filter((call) => call.task === 'recipe_proposals')).toEqual([]);
});
