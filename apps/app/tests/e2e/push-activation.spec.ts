/**
 * The notifications switch, in the four states a phone can put it in.
 *
 * ── The defect this file encodes ─────────────────────────────────────────
 *
 * Chrome's QUIET NOTIFICATION UI resolves `Notification.requestPermission()`
 * as `'default'` having drawn no dialog at all. A page that reads that as "the
 * person closed the question" tells them to tap again, and they can tap
 * forever. So a dismissal must leave the switch ON SCREEN (it is retryable)
 * and escalate its sentence after the first one, to the browser's own site
 * settings. `denied` is the opposite: the switch goes, because there is
 * nothing on this page that undoes it.
 *
 * ── What is real here and what is stubbed ────────────────────────────────
 *
 * REAL: the device, its diary, the account, the session, the whole settings
 * page, `pushAvailability`, `enablePush`, the service worker registration and
 * the base64url decoding of the instance's VAPID key.
 *
 * STUBBED: the permission prompt (a browser dialog cannot be answered from a
 * test), `PushManager.prototype.subscribe` (a headless Chromium has no push
 * service), and the three `/v1/push/*` responses (the fake core server is a
 * reading of the SYNC protocol and does not implement M223's push family).
 *
 * The stub still earns its keep: it RECORDS the `applicationServerKey` it was
 * handed, and the spec compares those bytes against its own decoding of the
 * key the routed config answered with. A client that subscribed with the wrong
 * key would register an endpoint that silently receives nothing, which is
 * precisely the failure `isSubscriptionForKey` exists to prevent.
 */
import { expect, test, type Page } from '@playwright/test';

import { AUTH_API_PREFIX } from '../../app/lib/sync/engine/client/auth-wire';
import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '../../app/lib/sync/engine/protocol';
import { E2E_ACCOUNT_EMAIL, E2E_CORE_URL } from './env';
import {
  HEADER_HEIGHT,
  PHONE_WIDTH,
  completeOnboarding,
  headerStatusText,
  isHeaderStatusFullyVisible,
  signInFixtureAccount,
} from './helpers';
import { EN } from './copy';

// Push needs a registered worker, so this file opts in: the tier blocks workers by default
// (`playwright.config.ts`). The routes below all go to the sync origin, which the worker never
// answers, but a route still switches the browser caches off for the page, so this file keeps the
// small chance of the cancelled boot `overtaken-page-boots.spec.ts` describes.
test.use({ serviceWorkers: 'allow' });

declare global {
  interface Window {
    /**
     * The bytes the stubbed `pushManager.subscribe` was handed, recorded so
     * the spec can compare them with its own decoding of the routed key.
     */
    e2eApplicationServerKey?: number[];
  }
}

/**
 * A VAPID public key: an uncompressed P-256 point, 65 bytes, base64url, which
 * is the shape a real instance answers with.
 */
const VAPID_PUBLIC_KEY = 'BIOtEMWdkl2XmMzt-hEj7um0Dm-ragmdFQmC9lH8M0xbyO6ZlC8kjSCm0Cj_c5UEd4WwUwltNYV9P7gQJF2zOdg';

/** Where the routed `PUT` pretends the browser's push service lives. */
const FAKE_ENDPOINT = 'https://push.example.invalid/e2e-endpoint';

/**
 * A handshake that advertises push.
 *
 * TRANSCRIBED rather than patched over the fake service's own answer, for the
 * reason `fake-sync-service.ts` gives for existing at all: a second, explicit
 * reading of the document catches a drift that echoing the first one cannot.
 * The two version numbers are imported, because a client refusing its own
 * constants would be a test of nothing.
 */
const HEALTH_WITH_PUSH = {
  protocolVersion: PROTOCOL_VERSION,
  envelopeVersion: ENVELOPE_VERSION,
  serviceVersion: 'fake-e2e',
  instance: {
    name: 'openplate-e2e',
    language: 'en',
    mail: false,
    memberInvites: false,
    plans: false,
    push: true,
    ai: { model: null },
  },
};

/** Routes the handshake so the instance advertises push on every page of the run. */
async function routePushyHealth(page: Page): Promise<void> {
  await page.route(`${E2E_CORE_URL}/health`, (route) => route.fulfill({ json: HEALTH_WITH_PUSH }));
}

/**
 * Routes `GET /v1/push/config`.
 *
 * @param page - the page to route.
 * @param status - 200 to answer with the key, 401 to say the session ended.
 */
async function routePushConfig(page: Page, status: number): Promise<void> {
  await page.route(`${E2E_CORE_URL}/v1/push/config`, (route) =>
    status === 200 ?
      route.fulfill({ json: { publicKey: VAPID_PUBLIC_KEY } })
    : route.fulfill({ status, json: { error: 'unauthorized' } }),
  );
}

/** Routes `PUT /v1/push/subscriptions` to accept the registration. */
async function routeSubscriptionAccepted(page: Page): Promise<void> {
  await page.route(`${E2E_CORE_URL}/v1/push/subscriptions`, (route) => route.fulfill({ json: {} }));
}

/**
 * The `locale` field of the next subscription PUT, read off the request the
 * browser actually sends. The real server accepts the six bare codes and
 * answers 400 to a region tag, and this client once sent `navigator.language`
 * (`en-US`), which no unit test saw because every unit fake read `'de'`.
 *
 * @param page - the page, before the switch is flipped.
 */
function nextSubscriptionLocale(page: Page): Promise<string> {
  return page
    .waitForRequest((request) => request.url().endsWith('/v1/push/subscriptions') && request.method() === 'PUT')
    .then((request) => String(request.postDataJSON()?.locale));
}

/**
 * Fixes what the browser will say about notification permission.
 *
 * @param page - the page, before its first navigation.
 * @param permission - what `Notification.permission` reads as at mount.
 * @param answer - what `Notification.requestPermission()` resolves with.
 */
async function stubPermission(
  page: Page,
  permission: NotificationPermission,
  answer: NotificationPermission,
): Promise<void> {
  await page.addInitScript(
    (settings: { permission: NotificationPermission; answer: NotificationPermission }) => {
      Object.defineProperty(Notification, 'permission', {
        configurable: true,
        get: () => settings.permission,
      });
      Notification.requestPermission = () => Promise.resolve(settings.answer);
    },
    { permission, answer },
  );
}

/**
 * Where the stub keeps "this browser holds a subscription", so the answer
 * survives the document load a sign-out ends with. A window global would not:
 * the stub is reinstalled on every document, and a subscription that vanished
 * with the reload would make "it is gone after the sign-out" true for the wrong
 * reason.
 */
const STUB_SUBSCRIPTION_KEY = 'e2e-push-subscription-key';

/**
 * Replaces the push subscription with one a headless browser can produce,
 * recording the key it was asked to subscribe with.
 *
 * `getSubscription` answers from device storage (`STUB_SUBSCRIPTION_KEY`) and
 * `unsubscribe` removes it, so a spec can ask the browser whether it still
 * holds a subscription, before and after a sign-out.
 *
 * Every member of `PushSubscription` is implemented rather than asserted past:
 * a cast would hide the day the app starts reading a fourth one.
 *
 * @param page - the page, before its first navigation.
 */
async function stubPushSubscribe(page: Page): Promise<void> {
  await page.addInitScript(
    (settings: { endpoint: string; storeKey: string }) => {
      const { endpoint, storeKey } = settings;
      const subscriptionFor = (recorded: number[], userVisibleOnly: boolean): PushSubscription => ({
        endpoint,
        expirationTime: null,
        options: { applicationServerKey: new Uint8Array(recorded).buffer, userVisibleOnly },
        getKey: () => null,
        toJSON: () => ({ endpoint, keys: { p256dh: 'e2e-p256dh', auth: 'e2e-auth' } }),
        unsubscribe: () => {
          window.localStorage.removeItem(storeKey);
          return Promise.resolve(true);
        },
      });
      PushManager.prototype.subscribe = (options?: PushSubscriptionOptionsInit): Promise<PushSubscription> => {
        // The key arrives as the bytes `decodePublicKey` produced. A string form
        // is legal in the DOM signature and this app never sends one, so it
        // records nothing and the assertion in the spec goes red.
        const key = options?.applicationServerKey ?? null;
        let recorded: number[] = [];
        if (key instanceof ArrayBuffer) recorded = [...new Uint8Array(key)];
        else if (ArrayBuffer.isView(key)) recorded = [...new Uint8Array(key.buffer, key.byteOffset, key.byteLength)];
        window.e2eApplicationServerKey = recorded;
        window.localStorage.setItem(storeKey, JSON.stringify(recorded));
        return Promise.resolve(subscriptionFor(recorded, options?.userVisibleOnly ?? true));
      };
      PushManager.prototype.getSubscription = (): Promise<PushSubscription | null> => {
        const stored = window.localStorage.getItem(storeKey);
        if (stored === null) return Promise.resolve(null);
        // SAFETY: this stub wrote the value itself, as a JSON array of bytes.
        return Promise.resolve(subscriptionFor(JSON.parse(stored) as number[], true));
      };
    },
    { endpoint: FAKE_ENDPOINT, storeKey: STUB_SUBSCRIPTION_KEY },
  );
}

/**
 * A signed-in device standing on the notifications page.
 *
 * The last hop is a CLICK on the settings hub's own row rather than a
 * `goto`, and that is load-bearing: the session is restored from the device by
 * `SyncController` after a document load, so navigating in the client keeps
 * the vault that `enablePush` is about to ask for. Waiting for the account row
 * to print the address is how this knows the restore has landed.
 *
 * @param page - a page with its routes and init scripts already installed.
 */
async function openNotificationsSignedIn(page: Page): Promise<void> {
  await completeOnboarding(page);
  await signInFixtureAccount(page);

  await page.goto('/settings');
  await expect(page.getByText(E2E_ACCOUNT_EMAIL)).toBeVisible();
  await page.locator('a[href="/settings/notifications"]').click();
  await page.waitForURL('**/settings/notifications');
}

/** The master switch, which is drawn only in the `ready` state. */
function masterSwitch(page: Page) {
  return page.getByRole('switch', { name: EN.settings.notifications.master });
}

test('a prompt that closes without an answer keeps the switch and escalates its sentence', async ({ page }) => {
  await routePushyHealth(page);
  await routePushConfig(page, 200);
  await stubPermission(page, 'default', 'default');
  await openNotificationsSignedIn(page);

  await expect(page.getByText(EN.settings.notifications.state.ready)).toBeVisible();
  await masterSwitch(page).click();

  await expect.poll(() => headerStatusText(page)).toContain(EN.settings.notifications.state.dismissed);
  // THE SWITCH STAYS. A dismissal is retryable, so taking the control away
  // would remove the only way to retry.
  await expect(masterSwitch(page)).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(PHONE_WIDTH);
  const headerBox = await page.locator('header').first().boundingBox();
  expect(Math.round(headerBox?.height ?? 0), 'a refusal must not open the header').toBe(HEADER_HEIGHT);
  expect(await isHeaderStatusFullyVisible(page), 'the refusal must not be clipped').toBe(true);

  // The second tap is the whole point: the same outcome gets a DIFFERENT
  // sentence, one that names the browser's site settings.
  await masterSwitch(page).click();
  await expect.poll(() => headerStatusText(page)).toContain(EN.settings.notifications.state.dismissedAgain);
});

test('a browser that has blocked notifications is told so, and gets no switch', async ({ page }) => {
  await routePushyHealth(page);
  await routePushConfig(page, 200);
  await stubPermission(page, 'denied', 'denied');
  await openNotificationsSignedIn(page);

  await expect(page.getByText(EN.settings.notifications.state.blocked)).toBeVisible();
  await expect(masterSwitch(page)).toHaveCount(0);
  // CONTROL: the sentence that WOULD have been shown had the block not been
  // read, so a page that stopped consulting the permission fails here.
  await expect(page.getByText(EN.settings.notifications.state.ready)).toHaveCount(0);
});

test('an allowed prompt registers this device with the instance key', async ({ page }) => {
  await routePushyHealth(page);
  await routePushConfig(page, 200);
  await routeSubscriptionAccepted(page);
  await stubPermission(page, 'granted', 'granted');
  await stubPushSubscribe(page);
  await openNotificationsSignedIn(page);

  const localeSent = nextSubscriptionLocale(page);
  await masterSwitch(page).click();

  await expect.poll(() => headerStatusText(page)).toContain(EN.settings.notifications.toast.on);
  await expect(masterSwitch(page)).toBeChecked();

  // The language on the wire is the document's own bare code, never the
  // browser's region tag. Headless Chromium reports `en-US` as
  // `navigator.language`, which is the control this assertion needs: a client
  // that read it would send exactly that and fail here.
  expect(await page.evaluate(() => navigator.language)).toMatch(/^[a-z]{2}-[A-Z]{2}$/u);
  expect(await localeSent, 'the registration carries the bare code').toBe(
    await page.locator('html').getAttribute('lang'),
  );

  // The bytes the client subscribed with, against this spec's own decoding of
  // the key the routed config answered. An independent reading on purpose: the
  // client's decoder is the thing under test.
  const subscribedWith = await page.evaluate(() => window.e2eApplicationServerKey ?? []);
  expect(subscribedWith, 'the subscribe call must carry the instance key').toEqual([
    ...Buffer.from(VAPID_PUBLIC_KEY, 'base64url'),
  ]);
});

test('a session that has ended is named as a sign-in, not as an instance with push off', async ({ page }) => {
  await routePushyHealth(page);
  await routePushConfig(page, 401);
  await stubPermission(page, 'granted', 'granted');
  await stubPushSubscribe(page);
  await openNotificationsSignedIn(page);

  await masterSwitch(page).click();

  await expect.poll(() => headerStatusText(page)).toContain(EN.settings.notifications.state.signedOut);
  // A 401 IS NOT "this instance sends nothing": the switch stays, because
  // signing in again is what fixes it.
  await expect(masterSwitch(page)).toBeVisible();
  await expect(page.getByText(EN.settings.notifications.state.serverOff)).toHaveCount(0);
});

/**
 * What this browser says it is subscribed to, read from the page: the endpoint,
 * or `null` for no subscription, or `'no-registration'` when the worker is not
 * there at all (which would make a `null` below meaningless, so it is its own
 * answer).
 */
async function readBrowserSubscription(page: Page): Promise<string | null> {
  return await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration === undefined) return 'no-registration';
    const subscription = await registration.pushManager.getSubscription();
    return subscription === null ? null : subscription.endpoint;
  });
}

/** One request to the core, reduced to what the order and the bearer check need. */
interface CoreRequest {
  method: string;
  path: string;
  authorization: string | undefined;
}

test("signing out without an erase releases this device's push subscription and keeps the kinds", async ({ page }) => {
  await routePushyHealth(page);
  await routePushConfig(page, 200);
  await routeSubscriptionAccepted(page);
  await stubPermission(page, 'granted', 'granted');
  await stubPushSubscribe(page);

  const coreRequests: CoreRequest[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(E2E_CORE_URL)) return;
    coreRequests.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      authorization: request.headers().authorization,
    });
  });

  await openNotificationsSignedIn(page);
  await masterSwitch(page).click();
  await expect(masterSwitch(page)).toBeChecked();

  // CONTROLS, all before the sign-out: the browser HOLDS a subscription, this
  // device remembers its endpoint, and the kinds are on storage. Without them,
  // a stub that never subscribed would pass every "gone" below.
  expect(await readBrowserSubscription(page), 'the browser holds a subscription before the sign-out').toBe(
    FAKE_ENDPOINT,
  );
  const storageBefore = await page.evaluate(() => ({
    endpoint: window.localStorage.getItem('openplate:push-endpoint'),
    prefs: window.localStorage.getItem('openplate:push-prefs'),
    disabled: window.localStorage.getItem('openplate:push-disabled'),
  }));
  expect(storageBefore.endpoint).toBe(FAKE_ENDPOINT);
  expect(storageBefore.prefs, 'the kinds were written when the switch went on').not.toBeNull();

  // A plain sign-out: the erase box stays unticked.
  await page.goto('/settings/account');
  await expect(page.getByText(E2E_ACCOUNT_EMAIL).first()).toBeVisible();
  await page.locator('button:has(svg.lucide-log-out)').first().click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByRole('alertdialog').getByRole('checkbox')).not.toBeChecked();

  // Only the sign-out's own traffic counts.
  coreRequests.length = 0;
  await page.getByRole('alertdialog').getByRole('button', { name: EN.signOut.confirm, exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/dashboard');

  // THE DEFECT, stated as state: the browser no longer holds the subscription,
  // so nothing can wake this device with the last person's numbers.
  expect(await readBrowserSubscription(page), 'the browser subscription is released').toBeNull();

  // The server row is released too, with the bearer, and BEFORE the logout
  // revokes that bearer.
  const deleteIndex = coreRequests.findIndex(
    (request) => request.method === 'DELETE' && request.path === '/v1/push/subscriptions',
  );
  const logoutIndex = coreRequests.findIndex(
    (request) => request.method === 'POST' && request.path === `${AUTH_API_PREFIX}/logout`,
  );
  // CONTROL: the recorder saw the logout, so an order check on an empty list
  // cannot pass by accident.
  expect(logoutIndex, 'the recorder saw the logout').toBeGreaterThanOrEqual(0);
  expect(deleteIndex, 'the subscription is deleted on the server').toBeGreaterThanOrEqual(0);
  expect(deleteIndex, 'the delete goes out before the logout').toBeLessThan(logoutIndex);
  expect(coreRequests[deleteIndex]?.authorization ?? '', 'the delete carries the bearer').toMatch(/^Bearer \S+/u);

  // The endpoint is forgotten, the kinds survive and no refusal is recorded:
  // the person did not turn notifications off, they signed out.
  const storageAfter = await page.evaluate(() => ({
    endpoint: window.localStorage.getItem('openplate:push-endpoint'),
    prefs: window.localStorage.getItem('openplate:push-prefs'),
    disabled: window.localStorage.getItem('openplate:push-disabled'),
  }));
  expect(storageAfter.endpoint, 'the endpoint is forgotten').toBeNull();
  expect(storageAfter.prefs, 'the kinds survive the sign-out').toBe(storageBefore.prefs);
  expect(storageAfter.disabled, 'a sign-out is not an opt-out').toBeNull();
});
