/**
 * The community pulse: the ONE door through which anything about this device's
 * day may leave it, and the only file in the app that knows the `/v1/pulse`
 * paths exist.
 *
 * ── Why one module ───────────────────────────────────────────────────────
 *
 * The toggle on `/settings/sharing` is a promise, and a promise is only worth
 * what the code makes impossible. A second file that posted a count directly
 * would make the toggle a lie that no reader of the settings page could catch.
 * So every send is a function here, every one of them asks {@link isPulseEnabled}
 * and {@link readPulseAccount} first, and M222 spec 03 pins that with a grep:
 * the string `/v1/pulse` may appear in this file and nowhere else under `app/`.
 *
 * ── What leaves, exactly ─────────────────────────────────────────────────
 *
 * A meal: the count 1, its calories rounded to 50 and its protein rounded to
 * 5 g. Never the food, never the time, never a goal. A photo: that one was
 * parsed, and nothing about it. A fast: that this account is fasting right
 * now, which the server keeps for thirty minutes and then deletes.
 *
 * The rounding happens HERE as well as on the server. The server re-rounds
 * because it cannot trust a client; this module rounds because the unrounded
 * figure must never be on the wire in the first place, where a proxy log or a
 * request inspector would see it.
 *
 * ── Nothing here may ever throw at a caller ──────────────────────────────
 *
 * Every call site is a person logging a meal or a timer ticking. A pulse that
 * failed is not something to tell anybody about and not something to retry:
 * a retry would need a queue, a queue would need durable storage, and the
 * count of one meal is not worth a second database on the device. A failed
 * POST is one debug line and then it is gone.
 *
 * ── The seam ─────────────────────────────────────────────────────────────
 *
 * `tools/oxlint/anti-slop` forbids module mocking, so the transport, the
 * clock, the key mint, the account read and the toggle read are one injectable
 * record ({@link PulseDependencies}). The defaults are the real browser; a
 * test swaps them through {@link setPulseDependencies} and can then assert the
 * property that matters, which is that the fake fetch was never called.
 */
import { createComponentLogger } from '#app/lib/logger';
import { getSyncVault } from '#app/lib/sync/sync-session';
import { randomUuid } from '#app/lib/uuid';
import type { FastStatus } from '#app/models/fasting';

const pulseLog = createComponentLogger('pulse');

/** Browser-local (never synced, never exported) opt in. A preference about this device, not health data. */
export const PULSE_ENABLED_STORAGE_KEY = 'openplate:pulse-enabled';

/** The one value that means "on". Anything else, including an absent key, is off. */
const PULSE_ENABLED_VALUE = 'on';

/** Calories are reported to the nearest 50. */
export const PULSE_KCAL_STEP = 50;

/** Protein is reported to the nearest 5 g. */
export const PULSE_PROTEIN_STEP = 5;

/**
 * The floor under which neither surface renders anything at all.
 *
 * Three, counting the reader: two people is not a community and one is a
 * mirror. Under the floor there is no placeholder and no "be the first" line
 * (M222 spec 04), the tile and the line are simply absent.
 */
export const PULSE_FLOOR = 3;

/** How long a read of `GET /v1/pulse/today` is reused. Matches the server's own cache, so a faster poll could not see anything new. */
export const PULSE_CACHE_MS = 5 * 60 * 1000;

/** How often a running fast says it is still running. The server's presence window is thirty minutes, so this is well inside it. */
export const PULSE_HEARTBEAT_MS = 15 * 60 * 1000;

/** What the whole instance did today, as `GET /v1/pulse/today` reports it. Instance-wide figures; nothing here is about one person. */
export interface PulseToday {
  /** The server's day key (`YYYY-MM-DD`) for these figures. */
  day: string;
  meals: number;
  photos: number;
  kcal: number;
  protein: number;
  /** How many accounts contributed anything today. The floor is applied to this. */
  contributors: number;
  /** How many accounts are inside the thirty minute fasting window right now. */
  fastingNow: number;
}

/** One meal's contribution, before rounding. */
export interface PulseMealDelta {
  kcal: number;
  protein: number;
}

/** Where a pulse goes and what it may present. `null` on a device with no account, which sends nothing. */
export interface PulseAccount {
  serverUrl: string;
  accessToken: string | null;
}

/** Everything this module touches that is not its own arithmetic. Injected so a test can prove the zero-fetch case. */
export interface PulseDependencies {
  fetchImpl: typeof fetch;
  nowMs: () => number;
  newIdempotencyKey: () => string;
  readAccount: () => PulseAccount | null;
  readEnabled: () => boolean;
}

/**
 * The live session, reduced to the two things a pulse needs.
 *
 * The VAULT rather than the React snapshot, because the snapshot deliberately
 * carries no token (see `sync-session.ts`). Reading it here is the same access
 * every other authenticated client in the app has.
 */
function readAccountFromVault(): PulseAccount | null {
  const vault = getSyncVault();
  if (vault === null) return null;
  return { serverUrl: vault.serverUrl, accessToken: vault.authClient.getAccessToken() };
}

const DEFAULT_DEPENDENCIES: PulseDependencies = {
  fetchImpl: (...args) => globalThis.fetch(...args),
  nowMs: () => Date.now(),
  newIdempotencyKey: randomUuid,
  readAccount: readAccountFromVault,
  readEnabled: () => isPulseEnabled(),
};

let dependencies: PulseDependencies = DEFAULT_DEPENDENCIES;

/** Swaps one or more dependencies. For tests; the app never calls it. */
export function setPulseDependencies(overrides: Partial<PulseDependencies>): void {
  dependencies = { ...dependencies, ...overrides };
}

/** Restores the real browser dependencies and empties the read cache. For tests; the app never calls it. */
export function resetPulse(): void {
  dependencies = DEFAULT_DEPENDENCIES;
  cached = null;
  if (pendingBatch !== null) clearTimeout(pendingBatch.timer);
  pendingBatch = null;
}

/**
 * Whether this device has been asked to share, and said yes.
 *
 * Defaults to OFF on every path that cannot answer: no window (a server
 * render), a storage read that throws (private browsing), an absent key. An
 * opt in that a failed read could turn on would not be an opt in.
 */
export function isPulseEnabled(): boolean {
  if (globalThis.window === undefined) return false;
  try {
    return window.localStorage.getItem(PULSE_ENABLED_STORAGE_KEY) === PULSE_ENABLED_VALUE;
  } catch {
    return false;
  }
}

/**
 * Records the answer. A write failure is swallowed for the same reason the
 * weight-unit preference swallows one: a preference must never take a page
 * down. It fails CLOSED, because the read above defaults to off.
 *
 * @param on - true when the person has just turned sharing on.
 */
export function setPulseEnabled(on: boolean): void {
  if (globalThis.window === undefined) return;
  try {
    if (on) window.localStorage.setItem(PULSE_ENABLED_STORAGE_KEY, PULSE_ENABLED_VALUE);
    else window.localStorage.removeItem(PULSE_ENABLED_STORAGE_KEY);
  } catch {
    // Ignored by design, see this function's doc.
  }
}

/** Calories to the nearest 50. `roundKcal(1234)` is 1250. */
export function roundKcal(kcal: number): number {
  return Math.round(kcal / PULSE_KCAL_STEP) * PULSE_KCAL_STEP;
}

/** Protein to the nearest 5 g. `roundProtein(33)` is 35. */
export function roundProtein(protein: number): number {
  return Math.round(protein / PULSE_PROTEIN_STEP) * PULSE_PROTEIN_STEP;
}

/**
 * Sums one log action into the delta the pulse carries.
 *
 * A `null` macro stays out of the sum rather than becoming a zero: the figure
 * is already rounded to 50, and an unknown treated as nothing is the honest
 * reading for a total.
 *
 * @param entries - the rows one user action wrote.
 * @returns the unrounded calories and protein of the whole action.
 */
export function mealDeltaFor(entries: readonly { macros: { kcal: number | null; protein: number | null } }[]): PulseMealDelta {
  let kcal = 0;
  let protein = 0;
  for (const entry of entries) {
    kcal += entry.macros.kcal ?? 0;
    protein += entry.macros.protein ?? 0;
  }
  return { kcal, protein };
}

/** The gate, in one place: the answer every send asks for first. */
function openDoor(): PulseAccount | null {
  if (!dependencies.readEnabled()) return null;
  return dependencies.readAccount();
}

/**
 * One POST, fire and forget.
 *
 * A fresh uuid v4 rides every request as `Idempotency-Key` so a duplicate
 * delivery is counted once by the server. It is minted per CALL, never reused
 * across calls: two meals a minute apart are two facts, and one key would
 * silently collapse them.
 */
async function post(path: string, body: Record<string, number> | null): Promise<void> {
  const account = openDoor();
  if (account === null) return;
  const headers = new Headers({ 'Idempotency-Key': dependencies.newIdempotencyKey() });
  if (body !== null) headers.set('Content-Type', 'application/json');
  if (account.accessToken !== null) headers.set('Authorization', `Bearer ${account.accessToken}`);
  try {
    await dependencies.fetchImpl(`${account.serverUrl}${path}`, {
      method: 'POST',
      headers,
      body: body === null ? undefined : JSON.stringify(body),
    });
  } catch (caught) {
    // Not retried and not surfaced. See the module header.
    pulseLog.debug('pulse post failed', { path, error: caught instanceof Error ? caught.message : 'unknown' });
  }
}

/**
 * One meal was logged on this device.
 *
 * @param meal - the action's calories and protein, unrounded; this function rounds them.
 */
export async function reportMealLogged(meal: PulseMealDelta): Promise<void> {
  await post('/v1/pulse/meal', { kcal: roundKcal(meal.kcal), protein: roundProtein(meal.protein) });
}

/**
 * How long rows that share a `logBatchId` are held open before the batch is
 * sent as one meal.
 *
 * A confirmed plate, a saved meal and a copied day all write several rows in
 * one `await` loop, and each row passes through `putLocalFoodLog` on its own.
 * Four rows must be ONE meal with the plate's calories, not four meals with a
 * quarter of them each, and the store has no "the batch is finished" moment to
 * hang that on. Two seconds is far longer than a loop of writes takes and far
 * shorter than the gap to the next thing a person does.
 */
export const PULSE_BATCH_MS = 2000;

/** The batch being accumulated, or null. At most one is ever open: a second batch flushes the first. */
let pendingBatch: {
  batchId: string;
  kcal: number;
  protein: number;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

/** Sends the open batch now, if there is one. Exported so a test does not have to wait out {@link PULSE_BATCH_MS}. */
export function flushPulseBatch(): void {
  if (pendingBatch === null) return;
  clearTimeout(pendingBatch.timer);
  const { kcal, protein } = pendingBatch;
  pendingBatch = null;
  void reportMealLogged({ kcal, protein });
}

/**
 * THE ONE MEAL CALL SITE'S ENTRY POINT: one row a person just logged.
 *
 * A row with no `logBatchId` is a single add and goes immediately. A row that
 * carries one joins (or opens) a batch, and the whole batch is sent once.
 *
 * @param entry - the row that was just written.
 */
export function reportMealFromLog(entry: {
  logBatchId: string | null;
  macros: { kcal: number | null; protein: number | null };
}): void {
  const delta = mealDeltaFor([entry]);
  if (entry.logBatchId === null) {
    void reportMealLogged(delta);
    return;
  }
  if (pendingBatch !== null && pendingBatch.batchId === entry.logBatchId) {
    pendingBatch.kcal += delta.kcal;
    pendingBatch.protein += delta.protein;
    return;
  }
  flushPulseBatch();
  pendingBatch = {
    batchId: entry.logBatchId,
    kcal: delta.kcal,
    protein: delta.protein,
    timer: setTimeout(flushPulseBatch, PULSE_BATCH_MS),
  };
}

/** One photograph was parsed by the AI. Carries nothing about the photograph. */
export async function reportPhotoParsed(): Promise<void> {
  await post('/v1/pulse/photo', null);
}

/** This account is fasting right now. The server forgets it again after thirty minutes. */
export async function reportFastingHeartbeat(): Promise<void> {
  await post('/v1/pulse/fasting', null);
}

/** The last successful read, with the instant it was taken. */
let cached: { atMs: number; value: PulseToday } | null = null;

/**
 * What the instance did today, from memory when the last read is under five
 * minutes old.
 *
 * A NETWORK ERROR RETURNS NULL AND IS NOT CACHED. Caching a failure would
 * blank both surfaces for five minutes after one dropped connection, which is
 * a longer punishment than the fault deserves; not caching it means the next
 * render tries again. A signed out device never reaches the fetch at all.
 *
 * The READ asks {@link openDoor}, the same gate every send asks, so a device
 * with the toggle off makes no request in either direction. Reading the totals
 * while contributing nothing to them is not what the toggle promises, and the
 * request itself would tell the server that this device is here.
 *
 * @returns today's figures, or `null` when the toggle is off, there is no account, or the read failed.
 */
export async function fetchPulseToday(): Promise<PulseToday | null> {
  const account = openDoor();
  if (account === null) return null;
  const now = dependencies.nowMs();
  if (cached !== null && now - cached.atMs < PULSE_CACHE_MS) return cached.value;
  const headers = new Headers();
  if (account.accessToken !== null) headers.set('Authorization', `Bearer ${account.accessToken}`);
  try {
    const response = await dependencies.fetchImpl(`${account.serverUrl}/v1/pulse/today`, { method: 'GET', headers });
    if (!response.ok) return null;
    // SAFETY: the 200 body of `GET /v1/pulse/today` is defined by M222 spec 02
    // as exactly this shape; every non-2xx returned above.
    const value = (await response.json()) as PulseToday;
    cached = { atMs: now, value };
    return value;
  } catch {
    return null;
  }
}

/**
 * The one value an effect may watch to decide when to read.
 *
 * ── The defect this exists to make impossible ────────────────────────────
 *
 * The reader used to key its effect on `enabled` alone. At the moment the
 * dashboard mounts, the sync session is still being resumed from the device
 * cache, so `getSyncVault()` is null, `fetchPulseToday` answers null without a
 * request, and the effect never runs a second time: the tile was absent on
 * every plain load and reload, and the one surface that did work, the header's
 * fasting chip, worked only because its `enabled` flips false to true after
 * the resume has finished and thereby re-ran the effect by accident.
 *
 * So the account is part of the key. `null` means "do not read at all", and a
 * key that CHANGES when the session opens is what makes the read happen once
 * the vault is there.
 *
 * PURE, so the whole rule is pinned without a browser.
 *
 * @param input - whether this caller wants a read, and the signed in account id or null.
 * @returns a key that changes when the answer changes, or null when nothing may be read.
 */
export function pulseReadKey({ enabled, accountId }: { enabled: boolean; accountId: number | null }): string | null {
  if (!enabled) return null;
  if (accountId === null) return null;
  return `account:${accountId}`;
}

/** The tab, as the reader needs it. Injected so a node test can drive a tab that comes back. */
export interface PulseReadHost {
  /** Registers a "this tab just became visible" listener and returns its remover. */
  onVisible: (listener: () => void) => () => void;
}

/** The real tab. Does nothing at all where there is no document. */
const BROWSER_READ_HOST: PulseReadHost = {
  onVisible: (listener) => {
    if (globalThis.document === undefined) return () => undefined;
    const handler = (): void => {
      if (document.visibilityState === 'visible') listener();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },
};

/**
 * Reads now, and again whenever the tab comes back.
 *
 * The five minute window is {@link fetchPulseToday}'s, so a tab that is
 * switched away from and back ten times in a minute makes ONE request: the
 * later calls are served from memory. A page left open all afternoon reads
 * again the first time it is looked at after the window has passed, which is
 * the only refetch either surface needs. There is no timer, because a timer
 * would keep a hidden tab talking to the server for no reader.
 *
 * A read that answers `null` is NOT reported. Only the gate closing takes a
 * tile off the screen, and that is the caller's business; a dropped connection
 * must not blank figures that are already drawn.
 *
 * @param input - where to deliver a value, and the tab to listen to.
 * @returns the stop function; after it is called nothing is delivered.
 */
export function startPulseRead({
  onValue,
  host = BROWSER_READ_HOST,
}: {
  onValue: (value: PulseToday) => void;
  host?: PulseReadHost;
}): () => void {
  let isCancelled = false;
  const read = (): void => {
    void (async () => {
      const value = await fetchPulseToday();
      if (!isCancelled && value !== null) onValue(value);
    })();
  };
  read();
  const stopListening = host.onVisible(read);
  return () => {
    isCancelled = true;
    stopListening();
  };
}

/**
 * Whether the Overview tile renders.
 *
 * PURE and exported so the floor is pinned by arithmetic rather than by a
 * screenshot. `null` (no read yet, no account, a failed read) renders nothing,
 * exactly as two contributors do.
 *
 * @param today - the last read, or null.
 * @returns true only at or above {@link PULSE_FLOOR} contributors.
 */
export function showPulseTile(today: PulseToday | null): boolean {
  if (today === null) return false;
  return today.contributors >= PULSE_FLOOR;
}

/**
 * How many OTHER people are fasting right now, or `null` when the line must
 * not render.
 *
 * The count is `fastingNow - 1` because the reader is inside `fastingNow`, and
 * the floor is applied to `fastingNow` rather than to the difference: at the
 * floor of three the line says two others, and below it there is no line. The
 * function can never return 0, which is the whole point, "0 others are
 * fasting" is worse than silence.
 *
 * @param today - the last read, or null.
 * @returns the number of other fasters, or null.
 */
export function othersFastingLine(today: PulseToday | null): number | null {
  if (today === null) return null;
  if (today.fastingNow < PULSE_FLOOR) return null;
  return today.fastingNow - 1;
}

/**
 * What the heartbeat needs to know about the fast it is reporting.
 *
 * The app's own {@link FastStatus} plus `none` for a device with no open fast
 * at all. Only `active` sends: `scheduled` is a plan, and a plan is not a
 * fast.
 */
export type PulseFastStatus = FastStatus | 'none';

/**
 * Whether a heartbeat is due right now.
 *
 * PURE, so the three rules are pinned without a timer: a hidden tab never
 * sends, a scheduled or absent fast never sends, and a visible active fast
 * sends IMMEDIATELY the first time (`lastSentMs === null`) and then once every
 * fifteen minutes. The immediate send is what makes a fast that has just
 * started, or a tab that has just come back, appear in the count now rather
 * than a quarter of an hour from now.
 *
 * @param input - the fast's status, the tab's visibility, the last send and the clock.
 * @returns true when the caller should send one heartbeat.
 */
export function heartbeatDue({
  status,
  visible,
  lastSentMs,
  nowMs,
  intervalMs = PULSE_HEARTBEAT_MS,
}: {
  status: PulseFastStatus;
  visible: boolean;
  /** When this mount last sent, or `null` when it never has. */
  lastSentMs: number | null;
  nowMs: number;
  intervalMs?: number;
}): boolean {
  if (status !== 'active') return false;
  if (!visible) return false;
  if (lastSentMs === null) return true;
  return nowMs - lastSentMs >= intervalMs;
}
