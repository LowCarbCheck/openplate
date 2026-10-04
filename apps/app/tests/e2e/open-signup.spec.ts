/**
 * Open sign-up says "Sign up" (M253/02, absorbing M250/11).
 *
 * THE REPORT, owner, 2026-09-23: on app.openplate.de the logged-out pages say
 * "Anmelden" and "Zugang anfragen", and the invite wording is wrong on an
 * instance anybody may join. Before this spec the header drew the invite-only
 * dialog on every managed instance, so the first test below failed on the
 * build it was written against.
 *
 * WHAT IS REAL: the production build booted as a managed instance
 * (`managed-app-server.ts`), its CSP, the header, `/welcome`,
 * `/sign-up`, the handshake decoder and the sign-up request. WHAT IS STUBBED:
 * `/health` (the fake core server has no open sign-up), the
 * `POST /v1/auth/signup-request` answer, and Cloudflare's Turnstile script and
 * frame. The real Cloudflare script is never loaded: its URL is answered here.
 *
 * Every absence has a control that finds the same thing through the same
 * query on the other kind of instance.
 *
 * THE HEADER IS READ ON A LEGAL PAGE since M266: a managed `/` is the account
 * door, which draws its doors in the page and none in the header
 * (`account-door-page.spec.ts` covers that page). Every other public page keeps
 * the header's two doors, and `/imprint` is one every instance with legal
 * pages serves.
 *
 * THE DATA BOX (M3/07, 2026-10-04). `/sign-up` on a managed instance says what
 * happens to a photo, a diary and a deletion, directly below the form. It is
 * drawn in the same commit as the form, from the public config (the instance
 * mode and the legal pages), never from a second read, so nothing on screen
 * moves when it arrives and nothing moves when the form turns into the inbox
 * line. The control is the tier's own OPEN server: the same page, the same
 * fixture legal pages, the same handshake, and no box.
 *
 * @area accounts-and-sign-in
 * @smoke
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '../../app/lib/sync/engine/protocol';
import { E2E_CORE_URL } from './env';
import { installShiftObserver, readShiftEntries, settleFrames, shiftScoreAfter } from './layout-shift';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { createGate } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot, beside the tier's 30 s per spec. */
const BOOT_BUDGET_MS = 90_000;

/** The narrowest phone the header must fit. */
const NARROW_PHONE = { width: 360, height: 800 } as const;

/** The strings this spec reads, parsed from the shipped English bundle so a missing key fails here. */
const copySchema = z.object({
  chrome: z.object({ signUp: z.string(), requestAccess: z.string(), signIn: z.string() }),
  welcome: z.object({ managed: z.object({ signUp: z.string(), haveInvite: z.string() }) }),
  signUp: z.object({
    whatHappens: z.object({
      title: z.string(),
      photo: z.string(),
      notice: z.string(),
      proof: z.string(),
    }),
    sent: z.string(),
    submit: z.string(),
    wait_other: z.string(),
    captchaFailed: z.string(),
    captchaUnavailable: z.string(),
    domainBlocked: z.string(),
  }),
  sync: z.object({ email: z.object({ invalid: z.string() }) }),
  signupOffer: z.object({ scans_other: z.string() }),
});
const COPY = copySchema.parse(
  JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')),
);

/** A catalog sentence with `{{count}}` filled, the way i18next does for a plural. */
function withCount(sentence: string, count: number): string {
  return sentence.replaceAll('{{count}}', String(count));
}

/** The Turnstile script URL the app asks for, transcribed from `app/lib/turnstile.ts` so a change fails here. */
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** A frame on Cloudflare's origin, so the stub exercises `frame-src` the way the real widget does. */
const TURNSTILE_FRAME = 'https://challenges.cloudflare.com/e2e-stub/frame';

/** A site key. Public by design; this one names nothing. */
const SITE_KEY = '0x4AAAAAAAe2e-stub';

/** A public page that wears the header's two doors. */
const HEADER_PAGE = '/imprint';

/** What the stubbed `/health` says about sign-up. */
interface SignupStub {
  openSignup: boolean;
  trialScans?: number;
  captcha?: boolean;
}

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
  // Every CSP violation the page reports, recorded from before its first script.
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, '__cspViolations', { value: seen });
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
});

/**
 * Answers `/health` for the managed server's sync origin.
 *
 * @param gate - holds every answer until it settles, for a reading taken before the handshake lands.
 */
async function routeHealth(page: Page, stub: SignupStub, gate?: Promise<void>): Promise<void> {
  const instance = new Map<string, unknown>([
    ['name', 'openplate-e2e'],
    ['language', 'en'],
    ['mail', true],
    ['memberInvites', false],
    ['plans', true],
    ['openSignup', stub.openSignup],
    ['ai', { model: 'e2e-model' }],
  ]);
  // THE TWO PROMISES are absent unless named, as a core without them sends them.
  if (stub.trialScans !== undefined) instance.set('trial', { scans: stub.trialScans });
  if (stub.captcha === true) instance.set('signupCaptcha', { provider: 'turnstile', siteKey: SITE_KEY });
  await page.route(`${E2E_CORE_URL}/health`, async (route) => {
    await gate;
    await route.fulfill({
      json: {
        protocolVersion: PROTOCOL_VERSION,
        envelopeVersion: ENVELOPE_VERSION,
        serviceVersion: 'fake-e2e',
        instance: Object.fromEntries(instance),
      },
    });
  });
}

/** One answer of the stubbed sign-up request. */
interface SignupAnswer {
  status: number;
  json: object;
  headers?: Record<string, string>;
}

/** Every body the page posted to the sign-up route. */
async function routeSignupRequest(page: Page, answers: readonly SignupAnswer[]): Promise<unknown[]> {
  const bodies: unknown[] = [];
  await page.route(`${E2E_CORE_URL}/v1/auth/signup-request`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    const answer = answers[Math.min(bodies.length, answers.length) - 1];
    if (answer === undefined) throw new Error('routeSignupRequest was given no answer');
    return route.fulfill({
      status: answer.status,
      json: answer.json,
      headers: { 'Access-Control-Expose-Headers': 'Retry-After', ...answer.headers },
    });
  });
  return bodies;
}

/**
 * Answers Cloudflare's script with a stand-in that draws one frame from
 * Cloudflare's origin and hands out a token. Counts resets.
 */
async function routeTurnstileStub(page: Page, gate?: Promise<void>): Promise<void> {
  await page.route(TURNSTILE_SCRIPT, async (route) => {
    await gate;
    await route.fulfill({
      contentType: 'text/javascript',
      body: `
        (() => {
          let issued = 0;
          const widgets = new Map();
          document.documentElement.dataset.turnstileResets = '0';
          window.turnstile = {
            render(container, options) {
              const id = 'w' + widgets.size;
              const frame = document.createElement('iframe');
              frame.src = ${JSON.stringify(TURNSTILE_FRAME)};
              frame.style.cssText = 'display:block;width:100%;height:65px;border:0';
              container.appendChild(frame);
              widgets.set(id, options);
              setTimeout(() => options.callback('stub-token-' + (issued += 1)), 50);
              return id;
            },
            reset(id) {
              const root = document.documentElement.dataset;
              root.turnstileResets = String(Number(root.turnstileResets) + 1);
              const options = widgets.get(id);
              if (options) setTimeout(() => options.callback('stub-token-' + (issued += 1)), 50);
            },
            remove(id) { widgets.delete(id); },
          };
        })();`,
    });
  });
  await page.route(TURNSTILE_FRAME, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>challenge</title><p>ok</p>' }),
  );
}

async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const recorded = Object.getOwnPropertyDescriptor(window, '__cspViolations')?.value;
    return Array.isArray(recorded) ? recorded.map(String) : [];
  });
}

/** The violations whose blocked address is on Cloudflare's challenge origin. */
async function cloudflareViolations(page: Page): Promise<string[]> {
  return (await cspViolations(page)).filter((entry) => entry.includes('challenges.cloudflare.com'));
}

function header(page: Page): Locator {
  return page.locator('header');
}

function signUpDoor(page: Page): Locator {
  return header(page).locator('a[href="/sign-up"]');
}

function inviteDoor(page: Page): Locator {
  return header(page).getByRole('button', { name: COPY.chrome.requestAccess, exact: true });
}

/** Opens the sign-up page and waits for its form. */
async function openSignUp(page: Page): Promise<void> {
  await page.goto(`${server.url}/sign-up`);
  await expect(page.getByRole('button', { name: COPY.signUp.submit })).toBeEnabled({ timeout: 10_000 });
}

/** Types an address and presses the button. */
async function submitAddress(page: Page, email: string): Promise<void> {
  await page.locator('input[name="email"]').fill(email);
  await page.getByRole('button', { name: COPY.signUp.submit }).click();
}

test('an open instance says "Sign up" and no invite wording, and the door moves nothing when it arrives', async ({
  page,
}) => {
  const gate = createGate();
  await routeHealth(page, { openSignup: true }, gate.promise);
  await page.setViewportSize(NARROW_PHONE);
  await page.goto(`${server.url}${HEADER_PAGE}`);

  // BEFORE THE HANDSHAKE: neither door, so an open instance never shows the
  // invite wording for a moment. Sign in is already there.
  const signIn = header(page).locator('a[href="/sign-in"]');
  await expect(signIn).toBeVisible();
  await settleFrames(page);
  await expect(inviteDoor(page)).toHaveCount(0);
  const signInBefore = await signIn.boundingBox();
  const shiftsBefore = (await readShiftEntries(page)).length;

  gate.open();
  await expect(signUpDoor(page)).toBeVisible({ timeout: 10_000 });
  await expect(signUpDoor(page)).toHaveText(COPY.chrome.signUp);
  await expect(inviteDoor(page)).toHaveCount(0);
  await settleFrames(page);
  expect(await signIn.boundingBox(), 'sign in moved when the door arrived').toEqual(signInBefore);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift while the door arrived').toBe(0);

  // THE HEADER FITS 360 px: nothing in its row paints past its box, and the
  // page is no wider than the screen.
  const fit = await page.evaluate(() => {
    const row = document.querySelector('header')?.firstElementChild;
    if (row === null || row === undefined) throw new Error('no header row');
    return {
      overflowing: [row, ...row.children]
        .filter((element) => element.scrollWidth > element.clientWidth)
        .map((element) => `${element.tagName} ${element.scrollWidth} > ${element.clientWidth}`),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(fit.overflowing, 'header content paints past its box').toEqual([]);
  expect(fit.documentWidth).toBeLessThanOrEqual(fit.viewportWidth);

  // /welcome offers the same door.
  await page.goto(`${server.url}/welcome`);
  await expect(page.getByRole('link', { name: COPY.welcome.managed.signUp })).toHaveAttribute('href', '/sign-up');
});

test('the control: an invite-only instance keeps the invite wording and offers no sign-up', async ({ page }) => {
  await routeHealth(page, { openSignup: false });
  await page.goto(`${server.url}${HEADER_PAGE}`);

  await expect(inviteDoor(page)).toBeVisible({ timeout: 10_000 });
  await expect(signUpDoor(page)).toHaveCount(0);

  // /welcome keeps its two doors, and the invite one is the anchor that the
  // screen has drawn its buttons before the absence is read.
  await page.goto(`${server.url}/welcome`);
  await expect(page.getByRole('button', { name: COPY.welcome.managed.haveInvite })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('link', { name: COPY.welcome.managed.signUp })).toHaveCount(0);
});

test('the form posts one request with the address and turns into the inbox line without moving anything', async ({
  page,
}) => {
  await routeHealth(page, { openSignup: true });
  const bodies = await routeSignupRequest(page, [{ status: 202, json: {} }]);
  await openSignUp(page);

  const below = page.locator('[data-slot="sign-up-sign-in"]');
  await settleFrames(page);
  const topBefore = (await below.boundingBox())?.y;
  const shiftsBefore = (await readShiftEntries(page)).length;

  await submitAddress(page, 'Anna@Example.org');
  await expect(page.locator('[data-slot="sign-up-sent"]')).toBeVisible();
  await expect(page.locator('[data-slot="sign-up-sent"]')).toHaveText(COPY.signUp.sent);
  await settleFrames(page);

  expect(bodies, 'exactly one request, carrying the canonical address and the form language, nothing else').toEqual([
    { email: 'anna@example.org', locale: 'en' },
  ]);
  expect((await below.boundingBox())?.y, 'the link under the form moved').toBe(topBefore);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift as the form turned').toBe(0);
});

test('the control: a 429 shows the wait from Retry-After and not the inbox line', async ({ page }) => {
  await routeHealth(page, { openSignup: true });
  await routeSignupRequest(page, [{ status: 429, json: { error: 'rate-limited' }, headers: { 'Retry-After': '120' } }]);
  await openSignUp(page);

  await submitAddress(page, 'anna@example.org');
  await expect(page.locator('[data-slot="sign-up-problem"]')).toHaveText(withCount(COPY.signUp.wait_other, 2));
  await expect(page.locator('[data-slot="sign-up-sent"]')).toBeHidden();
});

test('a refused address and an unreachable challenge each get their own line, never the inbox line', async ({
  page,
}) => {
  await routeHealth(page, { openSignup: true });
  await routeSignupRequest(page, [
    { status: 400, json: { error: 'email-invalid' } },
    { status: 503, json: { error: 'captcha-unavailable' } },
  ]);
  await openSignUp(page);

  await submitAddress(page, 'anna@example.org');
  await expect(page.locator('[data-slot="sign-up-problem"]')).toHaveText(COPY.sync.email.invalid);
  await page.getByRole('button', { name: COPY.signUp.submit }).click();
  await expect(page.locator('[data-slot="sign-up-problem"]')).toHaveText(COPY.signUp.captchaUnavailable);
  await expect(page.locator('[data-slot="sign-up-sent"]')).toBeHidden();
});

test('the free scans sentence comes from the handshake, and says nothing without it', async ({ page }) => {
  await routeHealth(page, { openSignup: true, trialScans: 10 });
  await openSignUp(page);
  await expect(page.locator('[data-slot="signup-offer-scans"]')).toHaveText(
    withCount(COPY.signupOffer.scans_other, 10),
  );

  // THE CONTROL: the same page against a handshake with no trial states no number.
  await page.unrouteAll({ behavior: 'wait' });
  await routeHealth(page, { openSignup: true });
  await openSignUp(page);
  await expect(page.locator('[data-slot="signup-offer-scans"]')).toHaveCount(0);
});

test('the challenge loads under the CSP, holds its box, rides with the request and is renewed after a refusal', async ({
  page,
}) => {
  await routeHealth(page, { openSignup: true, captcha: true });
  const scriptGate = createGate();
  await routeTurnstileStub(page, scriptGate.promise);
  const bodies = await routeSignupRequest(page, [
    { status: 400, json: { error: 'captcha-failed' } },
    { status: 400, json: { error: 'email-domain-refused' } },
    { status: 202, json: {} },
  ]);
  await page.goto(`${server.url}/sign-up`);

  // THE BOX IS THERE BEFORE THE WIDGET, at the widget's height. The script is
  // held, so this reading is taken with no widget in the box.
  const box = page.locator('[data-slot="sign-up-challenge"]');
  const button = page.getByRole('button', { name: COPY.signUp.submit });
  await expect(button).toBeVisible({ timeout: 10_000 });
  await expect(box.locator('iframe')).toHaveCount(0);
  expect((await box.boundingBox())?.height, 'the box is not reserved before the widget').toBe(65);
  await settleFrames(page);
  const buttonTop = (await button.boundingBox())?.y;
  const shiftsBefore = (await readShiftEntries(page)).length;

  scriptGate.open();
  await expect(box.locator('iframe')).toHaveCount(1);
  await expect(button).toBeEnabled();
  expect((await box.boundingBox())?.height, 'the widget grew its box').toBe(65);
  expect((await button.boundingBox())?.y, 'the widget moved the button').toBe(buttonTop);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift as the widget drew').toBe(0);

  // A refused challenge asks for a new one, and the widget is reset.
  await submitAddress(page, 'anna@example.org');
  await expect(page.locator('[data-slot="sign-up-problem"]')).toHaveText(COPY.signUp.captchaFailed);
  await expect(page.locator('html')).not.toHaveAttribute('data-turnstile-resets', '0');
  await expect(button).toBeEnabled();

  // A blocked domain asks for another address.
  await page.getByRole('button', { name: COPY.signUp.submit }).click();
  await expect(page.locator('[data-slot="sign-up-problem"]')).toHaveText(COPY.signUp.domainBlocked);

  await expect(button).toBeEnabled();
  await submitAddress(page, 'anna@example.net');
  await expect(page.locator('[data-slot="sign-up-sent"]')).toBeVisible();

  expect(bodies, 'every request carried a token, and never the same one twice').toEqual([
    { email: 'anna@example.org', captchaToken: 'stub-token-1', locale: 'en' },
    { email: 'anna@example.org', captchaToken: 'stub-token-2', locale: 'en' },
    { email: 'anna@example.net', captchaToken: 'stub-token-3', locale: 'en' },
  ]);
  // ONLY CLOUDFLARE'S: the page reports one violation of its own on every
  // load, zod probing whether it may `eval`, which the policy refuses by
  // design and which has nothing to do with the challenge.
  expect(await cloudflareViolations(page), 'the CSP refused part of the challenge').toEqual([]);
});

test('the control: the open instance, whose CSP names no Cloudflare, refuses the same script', async ({ page }) => {
  // The tier's own server is an OPEN instance, so its policy has no Turnstile
  // entries. The same recorder, the same script URL: a violation is seen, so
  // the empty list above is a policy that allowed the challenge, not a
  // recorder that sees nothing.
  await routeTurnstileStub(page);
  await page.goto('/sign-up');
  await page.evaluate((src) => {
    const script = document.createElement('script');
    script.src = src;
    document.head.append(script);
  }, TURNSTILE_SCRIPT);
  await expect.poll(() => cloudflareViolations(page)).not.toEqual([]);
});

/** The words a catalog sentence puts inside `<tag>...</tag>`. Throws when the tag is not there. */
function textInsideTag(sentence: string, tag: string): string {
  const inside = new RegExp(`<${tag}>(.+?)</${tag}>`, 'u').exec(sentence)?.[1];
  if (inside === undefined) throw new Error(`the sentence has no <${tag}> run: ${sentence}`);
  return inside;
}

/** The box the managed `/sign-up` draws. */
function dataBox(page: Page): Locator {
  return page.locator('[data-slot="sign-up-what-happens"]');
}

/** Where an element's top is on the PAGE, not in the viewport: a press scrolls, and a scroll is not a move. */
async function pageTop(locator: Locator): Promise<number> {
  return locator.evaluate((element) => Math.round((element.getBoundingClientRect().top + window.scrollY) * 10) / 10);
}

test('the managed sign-up says what happens to the data below the form, and nothing moves when it arrives or when the form turns', async ({
  page,
}) => {
  const gate = createGate();
  await routeHealth(page, { openSignup: true, trialScans: 10 }, gate.promise);
  const bodies = await routeSignupRequest(page, [{ status: 202, json: {} }]);
  await page.setViewportSize(NARROW_PHONE);
  await page.goto(`${server.url}/sign-up`);

  // BEFORE THE HANDSHAKE there is no form, so there is no box either: the two
  // arrive in one commit, and a box with no form to belong to would be the
  // thing that arrives alone.
  await expect(page.getByRole('heading', { name: COPY.signUp.whatHappens.title })).toHaveCount(0);
  await settleFrames(page);

  gate.open();
  await expect(page.getByRole('button', { name: COPY.signUp.submit })).toBeEnabled({ timeout: 10_000 });
  await expect(dataBox(page)).toBeVisible();
  await expect(dataBox(page).getByRole('heading', { name: COPY.signUp.whatHappens.title })).toBeVisible();
  await expect(dataBox(page).locator('[data-slot="sign-up-what-happens-photo"]')).toHaveText(
    COPY.signUp.whatHappens.photo,
  );
  await settleFrames(page);
  expect(shiftScoreAfter(await readShiftEntries(page), 0), 'layout-shift from the load to the form and the box').toBe(
    0,
  );

  // BELOW THE FORM: under the submit button, above the way back to sign in.
  const field = page.locator('input[name="email"]');
  const submit = page.getByRole('button', { name: COPY.signUp.submit });
  const signIn = page.locator('[data-slot="sign-up-sign-in"]');
  const submitBottom = (await pageTop(submit)) + ((await submit.boundingBox())?.height ?? 0);
  expect(await pageTop(dataBox(page)), 'the box is not below the submit button').toBeGreaterThan(submitBottom);
  expect(await pageTop(field), 'the box is above the address field').toBeLessThan(await pageTop(dataBox(page)));
  expect(await pageTop(signIn), 'the way back is not below the box').toBeGreaterThan(await pageTop(dataBox(page)));

  // THE FORM TURNING INTO THE INBOX LINE moves neither the box nor what is under it.
  const boxTop = await pageTop(dataBox(page));
  const signInTop = await pageTop(signIn);
  const shiftsBefore = (await readShiftEntries(page)).length;
  await submitAddress(page, 'anna@example.org');
  await expect(page.locator('[data-slot="sign-up-sent"]')).toBeVisible();
  await settleFrames(page);
  expect(bodies).toHaveLength(1);
  expect(await pageTop(dataBox(page)), 'the box moved when the form turned').toBe(boxTop);
  expect(await pageTop(signIn), 'the link under the box moved when the form turned').toBe(signInTop);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift as the form turned').toBe(0);

  // THE LINKS GO WHERE THEY SAY. The link TEXT is read, not only the address:
  // a link tag named like a void element renders empty. The text is the run
  // the catalog entry puts inside the tag, so a reword passes and an empty link fails.
  const privacyText = textInsideTag(COPY.signUp.whatHappens.notice, 'privacy');
  const privacy = dataBox(page).getByRole('link', { name: privacyText });
  await expect(privacy).toHaveText(privacyText);
  await expect(privacy).toHaveAttribute('href', '/privacy');
  const proxyText = textInsideTag(COPY.signUp.whatHappens.proof, 'proxy');
  const proxy = dataBox(page).getByRole('link', { name: proxyText });
  await expect(proxy).toHaveText(proxyText);
  await expect(proxy).toHaveAttribute(
    'href',
    'https://github.com/LowCarbCheck/openplate/blob/main/apps/core/src/ai/proxy.ts',
  );

  // SQUARE, with a hairline on all four sides and no thick rule down one edge.
  const edges = await dataBox(page).evaluate((box) => {
    const style = getComputedStyle(box);
    return {
      radius: style.borderTopLeftRadius,
      widths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
    };
  });
  expect(edges.radius).toBe('0px');
  expect(new Set(edges.widths).size, 'the border is not the same on all four sides').toBe(1);
});

test('the control: the open instance draws the same sign-up form and no data box', async ({ page }) => {
  // The tier's own server mounts the same fixture legal pages, so the only
  // thing that differs from the test above is the instance mode.
  await routeHealth(page, { openSignup: true });
  await page.goto('/sign-up');
  await expect(page.getByRole('button', { name: COPY.signUp.submit })).toBeEnabled({ timeout: 10_000 });
  await expect(page.locator('[data-slot="sign-up-sign-in"]')).toBeVisible();
  await expect(dataBox(page)).toHaveCount(0);
  await expect(page.getByText(COPY.signUp.whatHappens.photo)).toHaveCount(0);
  // THE CONTROL OF THE CONTROL: this server does publish legal pages, so the
  // absence above is the mode and not a missing notice.
  const imprint = await page.request.get('/imprint');
  expect(imprint.status()).toBe(200);
});
