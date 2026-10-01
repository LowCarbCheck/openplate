/**
 * A self-hosted AI server that runs one task says so BEFORE the tap, and the
 * screens that cannot work with it stop offering to.
 *
 * ── WHAT THE SERVER SAYS, AND WHERE ──────────────────────────────────────
 *
 * An openplate-inference service puts `capabilities` on its model entry in
 * `GET {baseUrl}/models`: which tasks it runs. It does plate photos and nothing
 * else. Until now the app offered typed meals, pantry photos, pantry words and
 * recipes anyway, and the call failed with a message nobody could act on. This
 * spec connects a self-hosted endpoint through the real AI settings form,
 * answers its `/models` with `page.route`, and walks every screen that asks.
 *
 * The endpoint is this app's OWN origin on a path nothing serves, for the two
 * reasons `pantry-to-recipe.spec.ts` records: the production CSP's
 * `connect-src` allows an origin it knows plus `'self'`, and a same-origin
 * address needs no CORS preflight, which `page.route` does not answer.
 *
 * ── WHAT EACH TEST PROVES, AND ITS CONTROL ───────────────────────────────
 *
 * - /add/describe: the notice is drawn in its slot and Send is disabled with
 *   words typed, and Enter does not send either. CONTROL: the same stub with no
 *   `capabilities` draws no notice and Send is live.
 * - A FAILED probe is not a verdict: a 500 from `/models` draws no notice and
 *   leaves Send live (the probe fails open).
 * - NO LAYOUT SHIFT (DESIGN.md section 7): the answer is HELD until the page is
 *   at rest, the field's `getBoundingClientRect().top` is read before and after
 *   it is released, and a `layout-shift` total of 0 is required. CONTROL: the
 *   same readers see a block pushed in above the composer.
 * - /pantry: a server that runs neither pantry task gets the card in place of
 *   the list; a server that runs only one loses only the other way in.
 *   CONTROL: no `capabilities` shows the whole strip and no card.
 * - /pantry/recipes: the card replaces the page AND no request is sent, which
 *   is the point, because the screen buys its answer on arrival. CONTROL: the
 *   same shelf with no `capabilities` sends the request.
 * - settings: the summary line names the limits, and its slot is the same
 *   height with the line as without it, with the page under it unmoved.
 *
 * No sentence is pinned: every string is read from the shipped catalog at test
 * time, so a rephrase passes and a missing key fails here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { EN } from './copy';
import { E2E_APP_URL } from './env';
import { completeOnboarding, pantryRowsOnDisk } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import type { ProviderCapabilities } from '../../app/lib/ai/provider-capabilities';
import { createGate, type Gate } from './plans-stub';

const COPY = z
  .object({
    describe: z.object({
      send: z.string(),
      unsupported: z.object({ meal: z.string(), choose: z.string() }),
    }),
    intakeUnsupported: z.object({ title: z.string(), choose: z.string() }),
    settingsAi: z.object({
      capabilities: z.object({
        lead: z.string(),
        flagsPartial: z.string(),
        task: z.object({ describe: z.string() }),
      }),
    }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** The fake provider's base URL: this app's own origin, on a path nothing serves. */
const BASE_URL = `${E2E_APP_URL}/e2e-capabilities/v1`;

/** A model id for a self-hosted endpoint. Free text, never looked up in a catalog. */
const MODEL = 'e2e-capabilities-model';

/** The key the settings form demands. It authenticates nothing: the endpoint is a route handler. */
const API_KEY = 'e2e-not-a-real-key';

/** Words long enough to be a meal, short enough to stay inside the field's floor. */
const MEAL = '2 fried eggs';

/** A meal written a line at a time, taller than the field's floor, for the position reader's control. */
const FOUR_LINE_MEAL = 'porridge\nblueberries\nhoney\ntea';

/** A valid 1 x 1 PNG, the smallest thing the photo checks accept. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The shelf item the recipes walk stores, so `/pantry/recipes` does not redirect an empty shelf away. */
const SHELF_ITEM = 'Capabilities tier eggs';

/** How tall the settings slot is held (`min-h-20`), the figure the reserved box is read against. */
const SETTINGS_SLOT_PX = 80;

/** How long the page is watched after an answer lands, for anything that arrives a render late. */
const LATE_ARRIVAL_WATCH_MS = 400;

/** How tall a block the control inserts above the composer. */
const CONTROL_BLOCK_PX = 40;

/** What an openplate-inference service sends: plate photos only, and partial food flags. */
const PLATE_ONLY: ProviderCapabilities = {
  tasks: { plateImage: true, describe: false, pantryImage: false, pantryText: false, recipes: false },
  flags: 'partial',
  translations: 'request-language',
  labels: true,
};

/** A server that reads a pantry from photos and not from words, and nothing else missing. */
const NO_PANTRY_TEXT: ProviderCapabilities = {
  tasks: { plateImage: true, describe: true, pantryImage: true, pantryText: false, recipes: true },
  flags: 'complete',
  translations: 'all',
  labels: true,
};

/** What the stub's `/models` does, changed by a test between page loads. */
interface ServerState {
  /** The `capabilities` object put on the model entry, or `null` for a server that sends none. */
  capabilities: ProviderCapabilities | null;
  /** Answer `/models` with this status instead of a list, for the failed-probe test. */
  modelsStatus: number;
  /** Held until opened, for the layout reading. `null` answers at once. */
  gate: Gate | null;
  /** The `response_format.json_schema.name` of every chat completion the page sent. */
  chatSchemas: string[];
}

function newServerState(capabilities: ProviderCapabilities | null): ServerState {
  return { capabilities, modelsStatus: 200, gate: null, chatSchemas: [] };
}

/** The request body this fake reads: only the one field that names the task. */
interface TaskNamingRequest {
  response_format?: { json_schema?: { name?: string } };
}

/** What the pantry task answers with: one item, every field present (the schema is all-required-nullable). */
const PANTRY_ANSWER = {
  items: [{ name: SHELF_ITEM, amount: 6, unit: 'piece', category: 'egg', confidence: 'high' }],
  notes: null,
};

/**
 * Answers `/models` from `state`, and every chat completion with the pantry
 * answer or a refusal that names the task, recording which tasks were sent.
 *
 * @param page - the page to install the handlers on, before it is navigated.
 * @param state - read on every request, so a test changes the server between page loads.
 */
async function routeServer(page: Page, state: ServerState): Promise<void> {
  await page.route(`${BASE_URL}/models`, async (route) => {
    if (state.gate !== null) await state.gate.promise;
    if (state.modelsStatus !== 200) {
      await route.fulfill({ status: state.modelsStatus, contentType: 'application/json', body: '{}' });
      return;
    }
    const entry = { id: MODEL, object: 'model', created: 0, owned_by: 'openplate' };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        object: 'list',
        data: [state.capabilities === null ? entry : { ...entry, capabilities: state.capabilities }],
      }),
    });
  });

  await page.route(`${BASE_URL}/chat/completions`, async (route) => {
    // SAFETY: the body is this app's own request, built by `openai-compatible.ts`, and only its schema name is read.
    const body = route.request().postDataJSON() as TaskNamingRequest;
    const schemaName = body.response_format?.json_schema?.name ?? '';
    state.chatSchemas.push(schemaName);
    if (schemaName !== 'pantry_identification') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: `e2e fake has no answer for '${schemaName}'` } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(PANTRY_ANSWER) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      }),
    });
  });
}

/**
 * Connects the fake endpoint through the real AI settings form, no shortcut
 * write: a settings row planted in IndexedDB would be a second implementation
 * of what every screen reads. The key check answers from the same `/models`.
 *
 * @param page - a page on a device that is past onboarding, with `routeServer` installed.
 */
async function connectEndpoint(page: Page): Promise<void> {
  await page.goto('/settings/ai');
  await page.getByRole('button', { name: EN.settingsAi.advanced.toggle }).click();
  await page.getByRole('radio', { name: EN.settingsAi.advanced.openaiCompatibleOption }).check();
  await page.locator('input[name="model"]').fill(MODEL);
  await page.locator('input[name="baseUrl"]').fill(BASE_URL);
  await page.locator('input[name="apiKey"]').fill(API_KEY);
  await page.getByRole('button', { name: EN.settingsAi.save.settings }).click();
  // A verified first connect returns to the diary: the signal that the row was written.
  await page.waitForURL('**/diary');
}

/** A device past onboarding with the endpoint connected, ready to open any screen. */
async function prepare(page: Page, state: ServerState): Promise<void> {
  await routeServer(page, state);
  await completeOnboarding(page);
  await connectEndpoint(page);
}

/** The composer's field, and its send key. */
function describeControls(page: Page) {
  return {
    field: page.locator('textarea#describe-meal'),
    send: page.getByRole('button', { name: COPY.describe.send, exact: true }),
  };
}

/** The slot the notice is drawn in. */
function noticeSlot(page: Page): Locator {
  return page.locator('[data-slot="describe-notice"]');
}

////////////////////////////////////////////////////////////////////////////////
// /add/describe
////////////////////////////////////////////////////////////////////////////////

test('a server that does not read typed meals says so above the box and turns Send off', async ({ page }) => {
  await prepare(page, newServerState(PLATE_ONLY));
  await page.goto('/add/describe');
  const { field, send } = describeControls(page);
  await field.fill(MEAL);

  await expect(noticeSlot(page)).toContainText(COPY.describe.unsupported.meal);
  await expect(page.getByRole('link', { name: COPY.describe.unsupported.choose })).toHaveAttribute(
    'href',
    '/settings/ai?next=describe',
  );
  // WITH WORDS TYPED, so it is the server and not the empty box that disables it.
  await expect(send).toBeDisabled();
  // ENTER IS THE OTHER WAY TO SEND, and it goes nowhere either.
  await field.press('Enter');
  await settleFrames(page);
  expect(new URL(page.url()).pathname).toBe('/add/describe');
});

test('CONTROL: the same stub with no capabilities draws no notice and Send is live', async ({ page }) => {
  const state = newServerState(null);
  await prepare(page, state);
  const probe = page.waitForResponse(`${BASE_URL}/models`);
  await page.goto('/add/describe');
  await probe;
  const { field, send } = describeControls(page);
  await field.fill(MEAL);

  await expect(send).toBeEnabled();
  // The probe has answered and been read: the slot is there and holds nothing.
  await settleFrames(page);
  await expect(noticeSlot(page)).toBeAttached();
  await expect(noticeSlot(page)).toHaveText('');
});

test('a probe that fails is not a verdict: no notice, and Send stays live', async ({ page }) => {
  const state = newServerState(PLATE_ONLY);
  await prepare(page, state);
  state.modelsStatus = 500;
  const probe = page.waitForResponse(`${BASE_URL}/models`);
  await page.goto('/add/describe');
  await probe;
  const { field, send } = describeControls(page);
  await field.fill(MEAL);

  await settleFrames(page);
  await expect(send).toBeEnabled();
  await expect(noticeSlot(page)).toHaveText('');
});

test('the notice arriving moves nothing: the field keeps its top and the page records no layout shift', async ({
  page,
}) => {
  await installShiftObserver(page);
  const state = newServerState(PLATE_ONLY);
  await prepare(page, state);

  // THE ANSWER IS HELD, so the first reading is of the page before the server
  // has said anything, which is what a person types into.
  state.gate = createGate();
  const probe = page.waitForRequest(`${BASE_URL}/models`);
  await page.goto('/add/describe');
  await probe;
  const { field, send } = describeControls(page);
  await field.fill(MEAL);
  // FAIL OPEN: with the answer still outstanding, Send is live.
  await expect(send).toBeEnabled();
  await expect(noticeSlot(page)).toHaveText('');
  await settleAnimations(page);

  const fieldTop = (): Promise<number> => field.evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
  const topBefore = await fieldTop();
  const topsBefore = await readTops(page);
  const since = (await readShiftEntries(page)).length;

  state.gate.open();
  await expect(noticeSlot(page)).toContainText(COPY.describe.unsupported.meal);
  await expect(send).toBeDisabled();
  await page.waitForTimeout(LATE_ARRIVAL_WATCH_MS);
  await settleFrames(page);

  expect(await fieldTop(), 'the field moved when the notice arrived').toBe(topBefore);
  expect(movedBetween(topsBefore, await readTops(page)), 'what moved when the notice arrived').toEqual([]);
  const entries = await readShiftEntries(page);
  expect(shiftScoreAfter(entries, since), `layout-shift: ${JSON.stringify(entries.slice(since))}`).toBe(0);

  // THE CONTROLS. The position reader sees the field move when the field itself
  // grows (the composer is pinned to the bottom, so a taller field rises)...
  await field.fill(FOUR_LINE_MEAL);
  await settleFrames(page);
  expect(await fieldTop(), 'the position reader does not see the field grow').not.toBe(topBefore);
  await field.fill(MEAL);
  await settleFrames(page);
  // ...and the shift observer sees a block pushed in above the composer.
  const entriesAtControl = (await readShiftEntries(page)).length;
  await page.locator('[data-slot="describe-page"]').evaluate((column, px) => {
    const block = document.createElement('div');
    block.style.height = `${px}px`;
    column.prepend(block);
  }, CONTROL_BLOCK_PX);
  await settleFrames(page);
  await expect
    .poll(async () => shiftScoreAfter(await readShiftEntries(page), entriesAtControl), {
      message: 'the observer does not see a block pushed in above the composer',
    })
    .toBeGreaterThan(0);
});

////////////////////////////////////////////////////////////////////////////////
// /pantry
////////////////////////////////////////////////////////////////////////////////

/** The strip the pantry draws, the card it can draw instead, and the strip's two ways in. */
function pantryParts(page: Page) {
  const strip = page.locator('main [data-slot="intake-composer"]');
  return {
    strip,
    card: page.locator('main [data-slot="intake-unsupported-card"]'),
    photo: strip.locator('[data-slot="intake-composer-photo"]'),
    words: strip.locator('a[href^="/add/describe"]').first(),
  };
}

test('a server that reads no pantry gets the card in place of the list, with the way to another provider', async ({
  page,
}) => {
  await prepare(page, newServerState(PLATE_ONLY));
  await page.goto('/pantry');
  const { strip, card } = pantryParts(page);

  await expect(card).toBeVisible();
  await expect(card).toContainText(COPY.intakeUnsupported.title);
  await expect(card.getByRole('link', { name: COPY.intakeUnsupported.choose })).toHaveAttribute('href', '/settings/ai');
  await expect(strip).toHaveCount(0);
});

test('CONTROL: the same stub with no capabilities shows the whole strip and no card', async ({ page }) => {
  await prepare(page, newServerState(null));
  await page.goto('/pantry');
  const { strip, card, photo, words } = pantryParts(page);

  await expect(strip).toBeVisible();
  await expect(photo).toBeVisible();
  await expect(words).toBeVisible();
  await expect(card).toHaveCount(0);
});

test('a server that reads photos and not words keeps the camera and loses only the typing row', async ({ page }) => {
  await prepare(page, newServerState(NO_PANTRY_TEXT));
  await page.goto('/pantry');
  const { strip, card, photo, words } = pantryParts(page);

  await expect(strip).toBeVisible();
  await expect(photo).toBeVisible();
  await expect(words).toHaveCount(0);
  await expect(card).toHaveCount(0);
});

////////////////////////////////////////////////////////////////////////////////
// /pantry/recipes
////////////////////////////////////////////////////////////////////////////////

/**
 * Stores one shelf item through the pantry's own photo path, so the recipes
 * screen has a shelf and does not redirect to the list.
 *
 * @param page - a page with the endpoint connected, answering no capabilities.
 */
async function storeOneShelfItem(page: Page): Promise<void> {
  await page.goto('/pantry');
  await page
    .locator('main div.max-w-xl input[type="file"][capture]')
    .setInputFiles({ name: 'shelf.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  await expect(page.getByText(EN.pantry.review.title)).toBeVisible();
  await page.getByRole('button', { name: EN.pantry.review.confirm }).click();
  await expect.poll(() => pantryRowsOnDisk(page)).toBe(1);
}

test('a server that suggests no recipes gets the card and is sent NO request, which is the point', async ({ page }) => {
  const state = newServerState(null);
  await prepare(page, state);
  await storeOneShelfItem(page);

  // THE SAME SHELF, now against a plate-only server, on a fresh document.
  state.capabilities = PLATE_ONLY;
  state.chatSchemas.length = 0;
  const probe = page.waitForResponse(`${BASE_URL}/models`);
  await page.goto('/pantry/recipes');
  await probe;
  const card = page.locator('main [data-slot="intake-unsupported-card"]');

  await expect(card).toBeVisible();
  await page.waitForTimeout(LATE_ARRIVAL_WATCH_MS);
  expect(state.chatSchemas, 'a recipe request was sent to a server that does not suggest recipes').toEqual([]);
});

test('CONTROL: the same shelf with no capabilities sends the recipe request on arrival', async ({ page }) => {
  const state = newServerState(null);
  await prepare(page, state);
  await storeOneShelfItem(page);

  state.chatSchemas.length = 0;
  await page.goto('/pantry/recipes');

  await expect.poll(() => state.chatSchemas).toContain('recipe_proposals');
  await expect(page.locator('main [data-slot="intake-unsupported-card"]')).toHaveCount(0);
});

////////////////////////////////////////////////////////////////////////////////
// /settings/ai
////////////////////////////////////////////////////////////////////////////////

test('settings names what the server does not do, in a box that is the same height without the line', async ({
  page,
}) => {
  await installShiftObserver(page);
  const state = newServerState(PLATE_ONLY);
  await prepare(page, state);
  const slot = page.locator('[data-slot="provider-capability-summary"]');
  const slotHeight = async (): Promise<number> => Math.round((await slot.boundingBox())?.height ?? Number.NaN);

  // WITH THE LINE, answer held, so the page is read before and after it lands.
  state.gate = createGate();
  const probe = page.waitForRequest(`${BASE_URL}/models`);
  await page.goto('/settings/ai');
  await probe;
  await expect(slot).toBeAttached();
  await expect(slot).toHaveText('');
  await settleAnimations(page);
  const heightBefore = await slotHeight();
  const topsBefore = await readTops(page);
  const since = (await readShiftEntries(page)).length;

  state.gate.open();
  await expect(slot).toContainText(COPY.settingsAi.capabilities.task.describe);
  await expect(slot).toContainText(COPY.settingsAi.capabilities.flagsPartial);
  await page.waitForTimeout(LATE_ARRIVAL_WATCH_MS);
  await settleFrames(page);

  const heightWith = await slotHeight();
  expect(heightWith, 'the box changed height when the line arrived').toBe(heightBefore);
  expect(heightWith, 'the box is not the reserved height').toBe(SETTINGS_SLOT_PX);
  expect(movedBetween(topsBefore, await readTops(page)), 'what moved when the line arrived').toEqual([]);
  const entries = await readShiftEntries(page);
  expect(shiftScoreAfter(entries, since), `layout-shift: ${JSON.stringify(entries.slice(since))}`).toBe(0);
  const topsWith = await readTops(page);

  // THE CONTROL: the same page against a server that sends no capabilities.
  state.gate = null;
  state.capabilities = null;
  const answered = page.waitForResponse(`${BASE_URL}/models`);
  await page.goto('/settings/ai');
  await answered;
  await expect(slot).toBeAttached();
  await settleFrames(page);
  await expect(slot).toHaveText('');
  await expect(page.getByText(COPY.settingsAi.capabilities.flagsPartial)).toHaveCount(0);
  expect(await slotHeight(), 'the box is a different height without the line').toBe(heightWith);
  expect(movedBetween(topsWith, await readTops(page)), 'the page under the box differs without the line').toEqual([]);
});
