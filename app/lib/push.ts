/**
 * Web push, from the device's side: the ONE module that knows the
 * `/v1/push/*` paths exist, holds this device's remembered endpoint, and
 * decides whether a switch can honestly be offered at all.
 *
 * ── Why the availability question is pure ────────────────────────────────
 *
 * Most push settings pages fail before permission is ever asked, because they
 * draw a switch the platform will refuse. {@link pushAvailability} takes every
 * fact as data, so the five answers are pinned by arithmetic rather than by a
 * phone, and the page can render each one in a test.
 *
 * ── Why this device names its own predecessor ────────────────────────────
 *
 * A service worker re-registration mints a BRAND NEW endpoint and abandons the
 * old one without unsubscribing it, and the push service keeps accepting sends
 * to the orphan forever. Nothing on the server can tell an orphan from a live
 * device. This device is the only party that knows the two endpoints are one
 * phone, so it says so: `replaces` on the PUT body, remembered in storage
 * across reloads. The collie project piled up twenty orphans in one install
 * before it did this.
 *
 * ── Why every effect is injected ─────────────────────────────────────────
 *
 * `tools/oxlint/anti-slop` forbids module mocking, so the transport, the
 * permission prompt, the subscribe call, the clock-adjacent reads (time zone,
 * locale) and the storage are one injectable record
 * ({@link PushDependencies}). The defaults are the real browser; a test swaps
 * them and can then assert the property that matters, which is usually that a
 * fake fetch was never called.
 *
 * ── What the server never learns ─────────────────────────────────────────
 *
 * The words. Every push carries a kind, and the device writes the sentence
 * (M223's principle). What leaves here is an endpoint, its two keys, a time
 * zone, a language, one minute of the day and two booleans.
 */
import { createComponentLogger } from '#app/lib/logger';
import { getSyncVault } from '#app/lib/sync/sync-session';

const pushLog = createComponentLogger('push');

//////////////////////////////////////////////////////////////////////////////
// Constants
//////////////////////////////////////////////////////////////////////////////

/** The endpoint this device last registered, so the next one can supersede it. */
export const PUSH_ENDPOINT_STORAGE_KEY = 'openplate:push-endpoint';

/** The remembered "I turned this off", so the page does not ask again on the next visit. */
export const PUSH_DISABLED_STORAGE_KEY = 'openplate:push-disabled';

/** The two kinds and their settings, device-local like every other preference about this device. */
export const PUSH_PREFS_STORAGE_KEY = 'openplate:push-prefs';

/** The one value that means "on" for a stored flag. Anything else, including an absent key, is off. */
const FLAG_ON = '1';

/** 08:00 local, as minutes after midnight: the catch-up's default hour. */
export const DEFAULT_CATCH_UP_MINUTE = 480;

/** Minutes in one day, the exclusive upper bound of a valid catch-up minute. */
export const MINUTES_PER_DAY = 1440;

/**
 * How long any one PushManager or permission call is awaited.
 *
 * Those operations cannot be aborted. Giving up on a stalled one lets the
 * settings page recover instead of spinning forever; a late subscription may
 * be reused on the next attempt, but it must not register itself behind the
 * person's back.
 */
export const PUSH_OPERATION_TIMEOUT_MS = 30_000;

//////////////////////////////////////////////////////////////////////////////
// Availability
//////////////////////////////////////////////////////////////////////////////

/**
 * Why the switch is or is not offered, most fundamental first.
 *
 * `needs-install` is the iPhone case and nothing else: iOS delivers push only
 * to an installed PWA, so a person in Safari is not blocked and the instance
 * is not off, they simply have not added the app to the home screen yet.
 */
export type PushAvailability = 'unsupported' | 'needs-install' | 'blocked' | 'server-off' | 'ready';

/** Every fact the answer depends on, as data. Nothing here is read from a global. */
export interface PushEnvironment {
  /** `window.isSecureContext`. Push cannot run on plain http. */
  secureContext: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  /** An iPhone or an iPad, from the user agent and the touch points. */
  isIos: boolean;
  /** Launched from the home screen rather than in a browser tab. */
  isStandalone: boolean;
  permission: NotificationPermission;
  /** The instance advertises push on its `/health` handshake. */
  instancePush: boolean;
}

/**
 * The one answer the page renders, in the order the milestone fixes.
 *
 * THE ORDER IS THE DESIGN, not a convenience. A browser that cannot do push at
 * all is told that first, because nothing else is actionable. An iPhone in
 * Safari is told to install, BEFORE the permission is consulted, because a
 * non-installed iOS Safari can only ever report `default` for a push it could
 * not receive, so reading a refusal there would be reading noise. Then the
 * refusal the person can undo, then the instance that sends nothing, then the
 * switch.
 *
 * @param environment - the browser, the platform, the permission and the instance.
 * @returns the state whose sentence the page shows.
 */
export function pushAvailability(environment: PushEnvironment): PushAvailability {
  if (!environment.secureContext) return 'unsupported';
  if (!environment.hasServiceWorker) return 'unsupported';
  if (!environment.hasPushManager) return 'unsupported';
  if (environment.isIos && !environment.isStandalone) return 'needs-install';
  if (environment.permission === 'denied') return 'blocked';
  if (!environment.instancePush) return 'server-off';
  return 'ready';
}

/** Every state except `ready`: a reason an attempt to turn push on gave up. */
export type PushBlockedReason = Exclude<PushAvailability, 'ready'>;

/** Thrown by {@link enablePush} when the platform, the person or the instance refused. */
export class PushSetupError extends Error {
  readonly reason: PushBlockedReason;

  constructor(reason: PushBlockedReason) {
    super(`push is not available: ${reason}`);
    this.name = 'PushSetupError';
    this.reason = reason;
  }
}

//////////////////////////////////////////////////////////////////////////////
// Preferences (device-local)
//////////////////////////////////////////////////////////////////////////////

/**
 * What this device asked for, once the master switch is on.
 *
 * `catchUpMinute` is `null` when the daily catch-up is unticked, never 0:
 * midnight is a real answer a person can pick, so absence needs a value of
 * its own.
 */
export interface PushPrefs {
  catchUpMinute: number | null;
  fastTargetEnabled: boolean;
}

/**
 * What both kinds are set to before anybody touches them: the catch-up at
 * 08:00 and the fast target on. Used ONLY once the person turns the master
 * switch on, never to send anything on its own.
 */
export const DEFAULT_PUSH_PREFS: PushPrefs = {
  catchUpMinute: DEFAULT_CATCH_UP_MINUTE,
  fastTargetEnabled: true,
};

/** A minute of the local day, or `null` for "no catch-up". Anything else is not a setting. */
export function isValidCatchUpMinute(minute: number): boolean {
  return Number.isInteger(minute) && minute >= 0 && minute < MINUTES_PER_DAY;
}

//////////////////////////////////////////////////////////////////////////////
// The wire bodies
//////////////////////////////////////////////////////////////////////////////

/** Everything a registration carries beyond the subscription itself. */
export interface PushRegistrationContext {
  timeZone: string;
  locale: string;
  catchUpMinute: number | null;
  fastTargetEnabled: boolean;
}

/**
 * The body of `PUT /v1/push/subscriptions`.
 *
 * NO IDENTIFIER OF OUR OWN. The endpoint is the identity, on this device and
 * on the server alike; a uuid minted here would be a second name for one
 * phone and would out-live the endpoint it was supposed to describe.
 */
export interface PushSubscribeBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** The endpoint this registration supersedes. Absent when there is nothing to supersede. */
  replaces?: string;
  timeZone: string;
  locale: string;
  catchUpMinute: number | null;
  fastTargetEnabled: boolean;
}

/**
 * The subscribe body, built field by field rather than by serialising the
 * subscription whole: the server stores what it is sent, so the shape is a
 * contract. Pure, and exported, because {@link enablePush} itself needs a real
 * PushManager and this is the part worth pinning.
 *
 * @param json - `subscription.toJSON()`, the browser's own shape.
 * @param previousEndpoint - what this device registered last, or null.
 * @param context - the time zone, the language and the two kinds.
 * @returns the body to PUT.
 */
export function subscribeBody(
  json: PushSubscriptionJSON,
  previousEndpoint: string | null,
  context: PushRegistrationContext,
): PushSubscribeBody {
  const endpoint = json.endpoint ?? '';
  const body: PushSubscribeBody = {
    endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    timeZone: context.timeZone,
    locale: context.locale,
    catchUpMinute: context.catchUpMinute,
    fastTargetEnabled: context.fastTargetEnabled,
  };
  // RE-REGISTERING THE SAME ENDPOINT SUPERSEDES NOTHING, so `replaces` stays
  // absent: a server told to replace X with X would have to decide whether to
  // delete the row it just wrote.
  if (previousEndpoint === null || previousEndpoint === '' || previousEndpoint === endpoint) return body;
  return { ...body, replaces: previousEndpoint };
}

/** The body of `PATCH /v1/push/subscriptions`. Every field but the endpoint is a change, so every one is optional. */
export interface PushPatchBody {
  endpoint: string;
  timeZone?: string;
  locale?: string;
  catchUpMinute?: number | null;
  fastTargetEnabled?: boolean;
  /** The next instant this device wants waking, or `null` to cancel the one shot. */
  wakeAt?: string | null;
}

//////////////////////////////////////////////////////////////////////////////
// The seam
//////////////////////////////////////////////////////////////////////////////

/** Where a registration goes. `null` on a device with no account, which registers nothing. */
export interface PushAccount {
  serverUrl: string;
  accessToken: string | null;
}

/** The three storage operations this module needs, so a test never touches `localStorage`. */
export interface PushStorage {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  remove: (key: string) => void;
}

/** Everything this module touches that is not its own arithmetic. */
export interface PushDependencies {
  fetchImpl: typeof fetch;
  readAccount: () => PushAccount | null;
  requestPermission: () => Promise<NotificationPermission>;
  /** Registers the worker and subscribes this device, yielding the browser's own JSON shape. */
  subscribeToPush: (publicKey: string) => Promise<PushSubscriptionJSON>;
  /** Drops this device's browser subscription, if it has one. */
  unsubscribeFromPush: () => Promise<void>;
  readPermission: () => NotificationPermission;
  readTimeZone: () => string;
  readLocale: () => string;
  storage: PushStorage;
}

/** The live session, reduced to the two things a registration needs. Mirrors `pulse.ts`. */
function readAccountFromVault(): PushAccount | null {
  const vault = getSyncVault();
  if (vault === null) return null;
  return { serverUrl: vault.serverUrl, accessToken: vault.authClient.getAccessToken() };
}

/**
 * `localStorage`, with every failure swallowed.
 *
 * A blocked store (private browsing, a server render) must never take a
 * settings page down, and every read below defaults to the safe answer, so
 * failing closed here is the honest direction.
 */
const browserStorage: PushStorage = {
  read: (key) => {
    if (globalThis.window === undefined) return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write: (key, value) => {
    if (globalThis.window === undefined) return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Ignored by design, see this record's doc.
    }
  },
  remove: (key) => {
    if (globalThis.window === undefined) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignored by design, see this record's doc.
    }
  },
};

/**
 * Stops awaiting a PushManager call that will never settle.
 *
 * @param operation - the unabortable promise.
 * @returns its value, or a rejection once {@link PUSH_OPERATION_TIMEOUT_MS} has passed.
 */
async function pushOperation<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('push operation timed out')), PUSH_OPERATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The base64url VAPID key as the bytes `pushManager.subscribe` wants. */
function decodePublicKey(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(normalised);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.codePointAt(index) ?? 0;
  return bytes;
}

/** Registers the worker, subscribes, and hands back the browser's JSON. The real browser path. */
async function subscribeInBrowser(publicKey: string): Promise<PushSubscriptionJSON> {
  await pushOperation(navigator.serviceWorker.register('/sw.js'));
  const registration = await pushOperation(navigator.serviceWorker.ready);
  const existing = await pushOperation(registration.pushManager.getSubscription());
  if (existing !== null) return existing.toJSON();
  const subscription = await pushOperation(
    registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePublicKey(publicKey) }),
  );
  return subscription.toJSON();
}

/** Drops the browser subscription. Best effort: a failure here still leaves the server row deleted. */
async function unsubscribeInBrowser(): Promise<void> {
  if (globalThis.navigator === undefined) return;
  try {
    const registration = await pushOperation(navigator.serviceWorker.getRegistration());
    const subscription = registration === undefined ? null : await pushOperation(registration.pushManager.getSubscription());
    if (subscription !== null) await pushOperation(subscription.unsubscribe());
  } catch (caught) {
    pushLog.debug('unsubscribe failed', { error: caught instanceof Error ? caught.message : 'unknown' });
  }
}

/** The browser's current answer, or `'default'` where there is no Notification API to ask. */
function readBrowserPermission(): NotificationPermission {
  if (globalThis.window === undefined) return 'default';
  if (!('Notification' in window)) return 'default';
  return Notification.permission;
}

const DEFAULT_DEPENDENCIES: PushDependencies = {
  fetchImpl: (...args) => globalThis.fetch(...args),
  readAccount: readAccountFromVault,
  requestPermission: () => Notification.requestPermission(),
  subscribeToPush: subscribeInBrowser,
  unsubscribeFromPush: unsubscribeInBrowser,
  readPermission: readBrowserPermission,
  readTimeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  readLocale: () => (globalThis.navigator === undefined ? 'en' : navigator.language),
  storage: browserStorage,
};

let dependencies: PushDependencies = DEFAULT_DEPENDENCIES;

/** Swaps one or more dependencies. For tests; the app never calls it. */
export function setPushDependencies(overrides: Partial<PushDependencies>): void {
  dependencies = { ...dependencies, ...overrides };
}

/** Restores the real browser dependencies. For tests; the app never calls it. */
export function resetPush(): void {
  dependencies = DEFAULT_DEPENDENCIES;
}

//////////////////////////////////////////////////////////////////////////////
// Remembered state
//////////////////////////////////////////////////////////////////////////////

/** The endpoint this device last registered with the server, or null. */
export function rememberedEndpoint(): string | null {
  const stored = dependencies.storage.read(PUSH_ENDPOINT_STORAGE_KEY);
  return stored === null || stored === '' ? null : stored;
}

/** Records (or forgets) the endpoint this device holds. */
function rememberEndpoint(endpoint: string | null): void {
  if (endpoint === null) dependencies.storage.remove(PUSH_ENDPOINT_STORAGE_KEY);
  else dependencies.storage.write(PUSH_ENDPOINT_STORAGE_KEY, endpoint);
}

/** Whether this device said no. Defaults to false on every path that cannot answer. */
export function isPushDisabledByUser(): boolean {
  return dependencies.storage.read(PUSH_DISABLED_STORAGE_KEY) === FLAG_ON;
}

/** Records the answer to the master switch, so the page does not ask again. */
function setPushDisabledByUser(disabled: boolean): void {
  if (disabled) dependencies.storage.write(PUSH_DISABLED_STORAGE_KEY, FLAG_ON);
  else dependencies.storage.remove(PUSH_DISABLED_STORAGE_KEY);
}

/**
 * This device's kinds, with the defaults for anything unreadable.
 *
 * A stored record that no longer parses is treated as absent rather than
 * repaired: the defaults are what the page shows a newcomer, and showing them
 * again is a smaller surprise than an invented hour.
 */
export function readPushPrefs(): PushPrefs {
  const stored = dependencies.storage.read(PUSH_PREFS_STORAGE_KEY);
  if (stored === null) return DEFAULT_PUSH_PREFS;
  try {
    // SAFETY: the value is re-validated field by field below, so the assertion
    // only says "some JSON", never that it is a `PushPrefs`.
    const parsed = JSON.parse(stored) as Partial<PushPrefs> | null;
    if (parsed === null) return DEFAULT_PUSH_PREFS;
    const minute = parsed.catchUpMinute ?? null;
    return {
      catchUpMinute: minute !== null && isValidCatchUpMinute(minute) ? minute : null,
      fastTargetEnabled: parsed.fastTargetEnabled === true,
    };
  } catch {
    return DEFAULT_PUSH_PREFS;
  }
}

/** Records this device's kinds. */
export function writePushPrefs(prefs: PushPrefs): void {
  dependencies.storage.write(PUSH_PREFS_STORAGE_KEY, JSON.stringify(prefs));
}

//////////////////////////////////////////////////////////////////////////////
// The four routes
//////////////////////////////////////////////////////////////////////////////

/** The account, or a thrown `server-off`: with no account there is nowhere to register. */
function requireAccount(): PushAccount {
  const account = dependencies.readAccount();
  if (account === null) throw new PushSetupError('server-off');
  return account;
}

/** The headers every call carries. Bearer auth, member scope. */
function authHeaders(account: PushAccount, hasBody: boolean): Headers {
  const headers = new Headers();
  if (hasBody) headers.set('Content-Type', 'application/json');
  if (account.accessToken !== null) headers.set('Authorization', `Bearer ${account.accessToken}`);
  return headers;
}

/** The instance's VAPID public key, or a thrown `server-off` when push is not configured there. */
async function readPublicKey(account: PushAccount): Promise<string> {
  const response = await dependencies.fetchImpl(`${account.serverUrl}/v1/push/config`, {
    method: 'GET',
    headers: authHeaders(account, false),
  });
  if (!response.ok) throw new PushSetupError('server-off');
  // SAFETY: the 200 body of `GET /v1/push/config` is defined by M223 spec 01
  // as exactly this shape; every non-2xx returned above.
  const config = (await response.json()) as { publicKey?: string };
  const publicKey = config.publicKey ?? '';
  if (publicKey === '') throw new PushSetupError('server-off');
  return publicKey;
}

/**
 * Turns push on for this device.
 *
 * THROWS rather than returning a flag, because every failure here has a
 * different sentence on the page: a refused permission is not an instance with
 * no VAPID key. The order matters: the key is read BEFORE the permission
 * prompt, so an instance that sends nothing never costs a person a permission
 * dialog they gain nothing from.
 *
 * @param prefs - the two kinds as the person left them, usually {@link DEFAULT_PUSH_PREFS}.
 * @throws PushSetupError when the person, the platform or the instance refused.
 */
export async function enablePush(prefs: PushPrefs): Promise<void> {
  const account = requireAccount();
  const publicKey = await readPublicKey(account);

  if (dependencies.readPermission() === 'denied') throw new PushSetupError('blocked');
  if (dependencies.readPermission() !== 'granted') {
    const granted = await dependencies.requestPermission();
    if (granted !== 'granted') throw new PushSetupError('blocked');
  }

  const subscription = await dependencies.subscribeToPush(publicKey);
  const body = subscribeBody(subscription, rememberedEndpoint(), {
    timeZone: dependencies.readTimeZone(),
    locale: dependencies.readLocale(),
    catchUpMinute: prefs.catchUpMinute,
    fastTargetEnabled: prefs.fastTargetEnabled,
  });

  const response = await dependencies.fetchImpl(`${account.serverUrl}/v1/push/subscriptions`, {
    method: 'PUT',
    headers: authHeaders(account, true),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`push registration refused: ${response.status}`);

  // Only after the server took it: a failed attempt keeps the remembered
  // endpoint, which is still the one the server holds.
  rememberEndpoint(body.endpoint);
  writePushPrefs(prefs);
  setPushDisabledByUser(false);
}

/**
 * Turns push off for this device: the server row goes, the browser
 * subscription goes, and the choice is remembered so the page does not ask
 * again on the next visit.
 *
 * The DELETE is sent first and its failure is swallowed. An explicitly
 * unsubscribed endpoint 410s on the next send and is pruned there anyway, so a
 * dropped connection must not leave a person looking at a switch that refused
 * to move.
 */
export async function disablePush(): Promise<void> {
  setPushDisabledByUser(true);
  const endpoint = rememberedEndpoint();
  const account = dependencies.readAccount();

  if (endpoint !== null && account !== null) {
    try {
      await dependencies.fetchImpl(`${account.serverUrl}/v1/push/subscriptions`, {
        method: 'DELETE',
        headers: authHeaders(account, true),
        body: JSON.stringify({ endpoint }),
      });
    } catch (caught) {
      pushLog.debug('push delete failed', { error: caught instanceof Error ? caught.message : 'unknown' });
    }
  }

  await dependencies.unsubscribeFromPush();
  rememberEndpoint(null);
}

/** One PATCH against this device's row. Returns false when there is nothing registered to patch. */
async function patchSubscription(patch: Omit<PushPatchBody, 'endpoint'>): Promise<boolean> {
  const endpoint = rememberedEndpoint();
  if (endpoint === null) return false;
  const account = dependencies.readAccount();
  if (account === null) return false;

  const response = await dependencies.fetchImpl(`${account.serverUrl}/v1/push/subscriptions`, {
    method: 'PATCH',
    headers: authHeaders(account, true),
    body: JSON.stringify({ endpoint, ...patch }),
  });
  if (!response.ok) throw new Error(`push update refused: ${response.status}`);
  return true;
}

/**
 * Changes what this device asked for, without re-subscribing.
 *
 * The time zone and the locale ride along because a person changing their
 * catch-up hour is often a person who has moved or switched language, and the
 * server writes no text: it only needs to know when to wake and which language
 * the kind is for.
 *
 * @param prefs - the two kinds as the form now has them.
 */
export async function updatePushSchedule(prefs: PushPrefs): Promise<void> {
  writePushPrefs(prefs);
  await patchSubscription({
    timeZone: dependencies.readTimeZone(),
    locale: dependencies.readLocale(),
    catchUpMinute: prefs.catchUpMinute,
    fastTargetEnabled: prefs.fastTargetEnabled,
  });
}

/**
 * Arms (or cancels) the server's ONE SHOT for a fast reaching its target.
 *
 * A NO-OP ON THREE PATHS, and each one matters: a device with no registration
 * has nothing to arm, and a person who unticked the fast target kind must not
 * have a wake instant written for them by a screen they were not on. Nothing
 * here ever throws at a caller: it is called from a fasting action whose job
 * is the fast, and a fast must not fail because a notification did.
 *
 * @param wakeAt - the target instant as ISO, or `null` when no fast is open.
 */
export async function setFastWakeAt(wakeAt: string | null): Promise<void> {
  if (rememberedEndpoint() === null) return;
  if (!readPushPrefs().fastTargetEnabled) return;
  try {
    await patchSubscription({ wakeAt });
  } catch (caught) {
    pushLog.debug('wake_at update failed', { error: caught instanceof Error ? caught.message : 'unknown' });
  }
}

/**
 * When an open fast reaches its target, as ISO, or `null` when nothing is
 * running.
 *
 * PURE and structural: it takes the four fields it reads rather than a stored
 * record, so the fasting route can hand it the current fast and a test can
 * hand it a literal. A fast with no effective start at all (neither started
 * nor planned) has no target instant, so it is `null` rather than an epoch.
 *
 * @param fast - the current fast, or null.
 * @returns the ISO instant to wake at, or null.
 */
export function fastWakeAtIso(
  fast: {
    startedAt: number | null;
    plannedStartAt: number | null;
    targetDurationMs: number;
    endedAt: number | null;
  } | null,
): string | null {
  if (fast === null) return null;
  if (fast.endedAt !== null) return null;
  const startAt = fast.startedAt ?? fast.plannedStartAt;
  if (startAt === null) return null;
  return new Date(startAt + fast.targetDurationMs).toISOString();
}

//////////////////////////////////////////////////////////////////////////////
// The browser's own facts
//////////////////////////////////////////////////////////////////////////////

/**
 * This browser's half of {@link PushEnvironment}, read once on mount.
 *
 * @param facts - what only the caller knows: the platform checks the install
 *   hook already performs, and whether the instance advertises push.
 * @returns the record {@link pushAvailability} answers from.
 */
export function readPushEnvironment(facts: {
  isIos: boolean;
  isStandalone: boolean;
  instancePush: boolean;
}): PushEnvironment {
  const hasWindow = globalThis.window !== undefined;
  return {
    secureContext: hasWindow && window.isSecureContext,
    hasServiceWorker: hasWindow && 'serviceWorker' in navigator,
    hasPushManager: hasWindow && 'PushManager' in window,
    isIos: facts.isIos,
    isStandalone: facts.isStandalone,
    permission: dependencies.readPermission(),
    instancePush: facts.instancePush,
  };
}
