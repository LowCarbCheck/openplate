/**
 * Screenshot every in-scope internal route for a manual visual design review.
 *
 *     tsx scripts/capture-app-audit.ts
 *
 * Writes `/tmp/openplate-visual-audit/<route-name>.png`, one file per route in
 * `ROUTES`, German locale, dark theme, one phone viewport. This is a review
 * artefact, not a shipped asset: nothing here is committed, and it does not
 * feed `public/landing` or any test.
 *
 * ── Why this duplicates `capture-landing.ts` rather than importing it ───────
 *
 * `capture-landing.ts` solves settle detection, seeding through the app's own
 * `importBackup`, the persist-race, the clock freeze and the per-shot fresh
 * page for the marketing screenshots. Every one of those problems is reused
 * here, but reimplemented against Playwright (already a dependency, already
 * proven on this host by `pnpm test:e2e`) instead of that file's hand-rolled
 * CDP client (`lib/cdp.ts`), which exists only because ITS environment has no
 * local browser at all. Nothing in that file is exported for reuse, and nor is
 * anything here reimplementing a general capture library, this is a diagnostic
 * script sized for the ~27 routes below and no more.
 *
 * ── A found bug in `capture-landing.ts`, not fixed here ─────────────────────
 *
 * Its persist probe reads `counts[schema.FOOD_LOGS_TABLE]` straight off
 * `readPersistedTableRowCounts`'s result. That function's CURRENT return type
 * is `PersistedTablesProbe`, a `{ kind: 'absent' | 'blocked' }` or
 * `{ kind: 'present'; counts: Record<string, number> }` union (`persist.ts`
 * added the `'blocked'` branch in M225); the row counts live one level deeper,
 * at `probe.counts[table]`, and only when `kind === 'present'`. Read as a flat
 * map, `counts[schema.FOOD_LOGS_TABLE]` is `undefined` on every poll, so that
 * probe can only ever time out, never see the save land early, on whatever
 * build is current. `buildSeedPersistProbeExpression` below reads the actual
 * current shape. Worth a look before anyone next touches that file.
 *
 * ── Where this diverges from `capture-landing.ts` on purpose ────────────────
 *
 *  - Diary data comes from `buildSeedDiary` (`lib/seed-diary.ts`), a three
 *    week generator with a spread of states, not the single frozen marketing
 *    day `buildLandingSeed` produces.
 *  - `SYNC_SERVER_URL` is never set. Every route in `ROUTES` is reachable on a
 *    self-hosted instance with no sync server, and that is the configuration
 *    this audit means to cover.
 *  - One locale (German), one theme (dark), one viewport (390x844 at 2x). No
 *    light pass, no other locale, no desktop width, this is an internal check
 *    and not the six-way matrix the landing page ships.
 *  - Screenshots are `fullPage: true` PNGs. The landing page's `VIEWS` table
 *    hand-picks a `height` per view because those files are curated marketing
 *    crops; a design review wants the whole page a route renders, not what
 *    fits above 844px of it.
 *  - `/diary/entry/:id` needs a real id, resolved once, on the seeding page,
 *    after the persist probe confirms the row is actually on disk (see
 *    `resolveDiaryEntryId`).
 *
 * ── The port ──────────────────────────────────────────────────────────────
 *
 * 3131, picked after `ss -tlnp` showed 3101, 3111, 3121, 3123 and 3000 already
 * held by other sessions on this host. Unlike the Playwright e2e tier
 * (`tests/e2e/env.ts`), this script has no companion process to coordinate
 * ports with and is meant to be run by one person at a time, so a literal is
 * enough; it is not the `pnpm test:e2e` triple and must never collide with it.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { buildSeedDiary, summarizeSeedDiary } from './lib/seed-diary';
import { serializeBackup } from '../app/lib/local-store/backup';
import { LANGUAGE_COOKIE, LANGUAGE_STORAGE_KEY } from '../app/i18n/language-prefs';
import type { LanguageCode } from '../app/i18n/language-prefs';
import { resetFontconfigCache } from '../tests/e2e/font-cache';

// ---------------------------------------------------------------------------
// Fixed configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = '/tmp/openplate-visual-audit';

const AUDIT_APP_PORT = 3131;
const AUDIT_APP_URL = `http://127.0.0.1:${AUDIT_APP_PORT}`;

const LOCALE: LanguageCode = 'de';
const SEED_TIMEZONE = 'Europe/Berlin';
/** The last, most recent day of the generated diary. Literal, so re-runs are byte-identical. */
const SEED_END_DAY = '2026-09-14';
/** A moment inside `SEED_END_DAY` in `SEED_TIMEZONE` (CEST, UTC+2 in September), same technique as `landing-seed.ts`'s `SEED_INSTANT`. */
const FROZEN_INSTANT = Date.UTC(2026, 8, 14, 19, 40);
const SEED_WEEKS = 3;
const SEED_RNG_SEED = 'openplate-audit';

const VIEWPORT = { width: 390, height: 844 };
const DEVICE_SCALE_FACTOR = 2;

const APP_READY_TIMEOUT_MS = 60_000;
const APP_READY_POLL_MS = 500;

const SETTLE_TIMEOUT_MS = 20_000;
const SETTLE_POLL_MS = 300;
/** Identical text this many polls running before the page counts as still. */
const SETTLE_STABLE_POLLS = 3;
/** Below this, "the text stopped changing" only means the page is still empty. */
const SETTLE_MIN_TEXT_LENGTH = 20;

const PERSIST_TIMEOUT_MS = 15_000;
const PERSIST_POLL_MS = 250;

/**
 * Filters `ROUTES` to a comma-separated subset of `name`s, for a smoke run
 * that proves the mechanism before spending the full ~27-route pass. Unset
 * captures everything, which is the only mode the operator needs.
 */
const ROUTE_NAMES_FILTER_VAR = 'CAPTURE_AUDIT_ROUTE_NAMES';

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// The route list
// ---------------------------------------------------------------------------

type AuditRoute = {
  /** URL path relative to the app origin. */
  path: string;
  /** File-name stem: the screenshot lands at `<OUT_DIR>/<name>.png`. */
  name: string;
};

/**
 * Every route in scope, in the order the spec lists them, EXCEPT
 * `/diary/entry/:id`: its id is not known until after seeding, so `main`
 * splices it in right after `diary` once `resolveDiaryEntryId` has one. No
 * sync-gated page, no legal page, out of scope by the same spec.
 */
const STATIC_ROUTES: readonly AuditRoute[] = [
  { path: '/welcome', name: 'welcome' },
  { path: '/onboarding', name: 'onboarding' },
  { path: '/dashboard', name: 'dashboard' },
  { path: '/catch-up', name: 'catch-up' },
  { path: '/diary', name: 'diary' },
  { path: '/add/search', name: 'add-search' },
  { path: '/add/photo', name: 'add-photo' },
  { path: '/add/describe', name: 'add-describe' },
  { path: '/trends', name: 'trends' },
  { path: '/awards', name: 'awards' },
  { path: '/foods', name: 'foods' },
  { path: '/meals', name: 'meals' },
  { path: '/pantry', name: 'pantry' },
  { path: '/pantry/recipes', name: 'pantry-recipes' },
  { path: '/nutrients', name: 'nutrients' },
  { path: '/fasting', name: 'fasting' },
  { path: '/settings', name: 'settings' },
  { path: '/settings/ai', name: 'settings-ai' },
  { path: '/settings/preferences', name: 'settings-preferences' },
  { path: '/settings/notifications', name: 'settings-notifications' },
  { path: '/settings/profile', name: 'settings-profile' },
  { path: '/settings/nutrition', name: 'settings-nutrition' },
  { path: '/settings/life-phase', name: 'settings-life-phase' },
  { path: '/settings/data', name: 'settings-data' },
  { path: '/settings/about', name: 'settings-about' },
  { path: '/settings/whats-new', name: 'settings-whats-new' },
];

/** Inserts the resolved `/diary/entry/:id` route right after `diary`. */
function buildRouteList(diaryEntryId: string): AuditRoute[] {
  const routes: AuditRoute[] = [];
  for (const route of STATIC_ROUTES) {
    routes.push(route);
    if (route.name === 'diary') routes.push({ path: `/diary/entry/${diaryEntryId}`, name: 'diary-entry' });
  }
  return routes;
}

/** Narrows `ROUTES` to `CAPTURE_AUDIT_ROUTE_NAMES` when set, for a smoke run. */
function filterRoutes(routes: readonly AuditRoute[]): AuditRoute[] {
  const raw = process.env[ROUTE_NAMES_FILTER_VAR];
  if (raw === undefined || raw.trim() === '') return [...routes];
  const wanted = new Set(
    raw
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );
  const filtered = routes.filter((route) => wanted.has(route.name));
  const missing = [...wanted].filter((name) => !filtered.some((route) => route.name === name));
  if (missing.length > 0) {
    throw new Error(`${ROUTE_NAMES_FILTER_VAR} named routes that do not exist: ${missing.join(', ')}`);
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// The app under capture
// ---------------------------------------------------------------------------

/**
 * `SYNC_SERVER_URL` is deliberately absent: this audit covers the
 * self-hosted-with-no-sync default, and every route above renders fully
 * without it. `delete` rather than an omitted spread, so a `.env` picked up by
 * `server.ts`'s own `dotenv/config` cannot reintroduce it through
 * `process.env`.
 */
function startApp(port: number): ChildProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), NODE_ENV: 'development' };
  delete env.SYNC_SERVER_URL;
  return spawn('node_modules/.bin/tsx', ['server.ts'], { cwd: REPO_ROOT, env, stdio: 'inherit' });
}

async function waitForApp(appUrl: string): Promise<void> {
  const deadline = Date.now() + APP_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${appUrl}/healthcheck`);
      if (response.ok) return;
    } catch {
      // Not listening yet. Keep polling until the deadline.
    }
    await sleep(APP_READY_POLL_MS);
  }
  throw new Error(`The app at ${appUrl} did not answer /healthcheck within ${APP_READY_TIMEOUT_MS} ms.`);
}

function killChild(child: ChildProcess | null): void {
  if (child === null || child.exitCode !== null) return;
  child.kill();
}

// ---------------------------------------------------------------------------
// Waiting for a page to be worth photographing
// ---------------------------------------------------------------------------

type SettleProbe = {
  loading: boolean;
  imagesReady: boolean;
  text: string;
  path: string;
};

/**
 * The probed `output` is `AppLoading` (`app/components/app-loading.tsx`). The
 * selector carries the loading icon as well as the live region on purpose:
 * `/add/search` renders a status `output[aria-live="polite"]` of its own with
 * no icon inside it, and the bare live-region selector would read that as
 * "still loading" forever.
 */
const SETTLE_PROBE_EXPRESSION = `(() => ({
  loading: document.querySelector('output[aria-live="polite"] img[src*="icon-192"]') !== null,
  imagesReady: Array.from(document.images).every((image) => image.complete),
  text: document.body === null ? '' : document.body.innerText,
  path: location.pathname,
}))()`;

/**
 * Wait until the page is worth photographing, and throw when it never is.
 *
 * No `AppLoading` in the DOM, every image decoded, body text unchanged across
 * three consecutive polls, and more than a token amount of text so "unchanged"
 * cannot be satisfied by an empty page. Fonts are awaited last, after the DOM
 * has stopped moving. A timeout FAILS the run: a capture that quietly ships a
 * loading state is worse than no capture, because the file exists and every
 * check downstream passes.
 */
async function settle(page: Page): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let lastText = '';
  let stablePolls = 0;
  let lastPath = '(not yet probed)';

  while (Date.now() < deadline) {
    const probe = await page.evaluate<SettleProbe>(SETTLE_PROBE_EXPRESSION);
    lastPath = probe.path;
    stablePolls = probe.text === lastText ? stablePolls + 1 : 1;
    lastText = probe.text;

    const isStill = stablePolls >= SETTLE_STABLE_POLLS && probe.text.length > SETTLE_MIN_TEXT_LENGTH;
    if (!probe.loading && probe.imagesReady && isStill) {
      await page.evaluate<boolean>('document.fonts.ready.then(() => true)');
      return;
    }
    await sleep(SETTLE_POLL_MS);
  }

  throw new Error(
    `The page at ${lastPath} never settled within ${SETTLE_TIMEOUT_MS} ms. Capturing it now would photograph a loading state, so this run fails instead.`,
  );
}

// ---------------------------------------------------------------------------
// The clock and locale, frozen before any app code runs
// ---------------------------------------------------------------------------

/**
 * Registered once on the context (`context.addInitScript`), so it runs before
 * app code on every page this run opens, including the ones opened after this
 * call, with no per-page re-registration needed the way a raw CDP session
 * would.
 *
 * Only `Date` is replaced, never `performance.now`: timers and animations
 * still advance, the app just always believes it is `FROZEN_INSTANT`, which
 * pins the diary header, "today" on the dashboard and catch-up, and every
 * relative time on screen. `theme` is written straight to `dark`, which is
 * root.tsx's own short-circuit (`theme === 'dark'`) ahead of any media-query
 * check, and the locale mirror is what the client reads after hydration; the
 * cookie the server reads for the first byte is set separately, see
 * `setLanguageCookie`.
 */
function buildClockAndLocaleInitScript(): string {
  return `
const F = ${FROZEN_INSTANT};
const R = Date;
class D extends R {
  constructor(...a) { if (a.length === 0) super(F); else super(...a); }
  static now() { return F; }
}
Object.defineProperty(globalThis, 'Date', { value: D, writable: true, configurable: true });
try {
  localStorage.setItem('theme', 'dark');
  localStorage.setItem(${JSON.stringify(LANGUAGE_STORAGE_KEY)}, ${JSON.stringify(LOCALE)});
} catch (error) {
  /* storage blocked; the cookie set on the context still carries the locale */
}
`;
}

/**
 * Write the locale cookie into the context's jar, before the seeding page
 * navigates anywhere.
 *
 * This cannot be done from the init script: the server picks the language
 * from the cookie ON THE REQUEST, so by the time an init script runs, the HTML
 * it would influence already exists. One fresh Playwright context starts with
 * an empty cookie jar, so this only has to happen once, unlike
 * `capture-landing.ts`'s per-shot re-set, which guards against a *persistent*
 * `--user-data-dir` carrying a previous script invocation's language forward.
 */
async function setLanguageCookie(context: BrowserContext, appUrl: string): Promise<void> {
  await context.addCookies([{ name: LANGUAGE_COOKIE, value: LOCALE, url: appUrl }]);
}

// ---------------------------------------------------------------------------
// Seeding: the app's own import path, waited out to an actual disk write
// ---------------------------------------------------------------------------

type SeedPersistProbe = {
  persisted: boolean;
  foodLogRows: number;
  /** The last probe seen, already JSON, so a failure can name it. */
  probe: string;
};

/**
 * Wait, inside the seeding page, until the seed is actually ON DISK.
 *
 * `importBackup` resolving does NOT mean persisted, it writes to the
 * in-memory store, and the IndexedDB write is the persister's asynchronous
 * autosave. Closing this page the instant `importBackup` resolves races that
 * save against the tab teardown; losing that race produces a full set of
 * screenshots of the welcome screen with no error anywhere, because every
 * later page is a FRESH TAB reading the origin's IndexedDB cold. So: wait for
 * the persisted `foodLogs` table's row count to reach the seed's own count.
 *
 * `readPersistedTableRowCounts`'s return type is the `PersistedTablesProbe`
 * union (`kind: 'absent' | 'blocked' | 'present'`), not a bare `Record`, so
 * the row count only exists at `probe.counts[table]` and only when
 * `probe.kind === 'present'`, see this file's header for where reading it as
 * a flat map goes wrong elsewhere in this repo.
 *
 * `performance.now`, not `Date.now`: the init script freezes `Date`, so a
 * deadline computed from `Date.now()` would never move and this loop would
 * never end.
 */
function buildSeedPersistProbeExpression(expectedFoodLogs: number): string {
  return `(async () => {
  const persist = await import('/app/lib/local-store/persist.ts');
  const store = await import('/app/lib/local-store/store.ts');
  const schema = await import('/app/lib/local-store/schema.ts');
  const start = performance.now();
  let probe = null;
  let rows = 0;
  while (performance.now() - start < ${PERSIST_TIMEOUT_MS}) {
    probe = await persist.readPersistedTableRowCounts(store.PRIMARY_DB_NAME);
    rows = probe.kind === 'present' ? (probe.counts[schema.FOOD_LOGS_TABLE] ?? 0) : 0;
    if (rows >= ${expectedFoodLogs}) {
      return { persisted: true, foodLogRows: rows, probe: JSON.stringify(probe) };
    }
    await new Promise((resolve) => setTimeout(resolve, ${PERSIST_POLL_MS}));
  }
  return { persisted: false, foodLogRows: rows, probe: JSON.stringify(probe) };
})()`;
}

/**
 * Reads one real food-log row's id for `dayKey`, off the SAME in-memory
 * primary store `importBackup` just wrote into and the persist probe above
 * just confirmed reached disk: `getPrimaryStore()` (`persist.ts`, not
 * `store.ts`, which only holds the table/cell id constants and the empty
 * `createPrimaryStore()` factory) is a module-level singleton, and a repeated
 * dynamic import of the same URL in the same document resolves to the same
 * module instance, so this call returns the exact store the import wrote, not
 * a second one.
 *
 * `dayKey === lastDayKey` always matches at least one row: `seed-diary.ts`'s
 * carb-level cycle puts `'under'` (never `'empty'`) at offset 0, the most
 * recent day, by construction.
 *
 * A row is not read as separate TinyBase cells. `primary-store.ts`'s
 * `writeEntity` puts the WHOLE entity, `dayKey` included, as one JSON string
 * under a single cell, `schema.PRIMARY_ENTITY_CELL` (`'entity'`), so every row
 * has to be parsed to read a field off it.
 */
function buildDiaryEntryIdExpression(lastDayKey: string): string {
  return `(async () => {
  const persist = await import('/app/lib/local-store/persist.ts');
  const schema = await import('/app/lib/local-store/schema.ts');
  const primaryStore = await persist.getPrimaryStore();
  const rowIds = primaryStore.getRowIds(schema.FOOD_LOGS_TABLE);
  for (const rowId of rowIds) {
    const raw = primaryStore.getCell(schema.FOOD_LOGS_TABLE, rowId, schema.PRIMARY_ENTITY_CELL);
    const entity = JSON.parse(raw);
    if (entity.dayKey === ${JSON.stringify(lastDayKey)}) {
      return rowId;
    }
  }
  throw new Error(${JSON.stringify(`No food-log row found for day ${lastDayKey}`)});
})()`;
}

type SeedResult = {
  diaryEntryId: string;
  foodLogCount: number;
};

/** How long a cold Vite dev server's forced dependency-optimizer reload takes to settle. */
const VITE_COLD_START_SETTLE_MS = 3_000;

/**
 * Absorbs Vite's dependency-optimizer reload for every in-scope route, on a
 * throwaway page, before the real timed capture pass ever visits one of them.
 *
 * A freshly started `vite` dev server discovers which npm packages need
 * pre-bundling lazily, PER ROUTE, not once at process start: the crawl a page
 * load triggers only follows the import graph that page's own render
 * actually reaches. `/welcome` needs one set of packages; `/settings` pulls
 * in Conform on ITS first visit; `/diary/entry/:id` pulls in
 * `@conform-to/react` from whatever form it renders. Each is a separate
 * discovery event, the first time that route's dependency graph is exercised
 * against a given server process, and each ends the same way: Vite's
 * injected client calls `location.reload()`, a moment after that page's own
 * `load` event, not before it. Work issued in that window, most dangerously
 * a `page.evaluate` dynamic `import()` such as `seedOrigin`'s, gets torn down
 * mid-flight and fails with "Failed to fetch dynamically imported module";
 * `settle()`'s own poll loop tolerates a mid-poll reload fine (it just
 * rereads `document.body.innerText`), but a bare `page.goto` racing a
 * route's first-ever discovery-and-reload is exactly what killed
 * `/diary/entry/:id`, the sixth route, mid capture, on a route no earlier
 * navigation in the run had ever touched.
 *
 * So: give every route in scope a turn on one throwaway page before the
 * timed pass starts, one after another, each followed by a fixed wait long
 * enough for that route's reload (if any) to land. No settle detection and
 * no per-route timeout enforcement here; a route whose warm-up navigation
 * errors is logged and skipped, never thrown, because the only goal is
 * making Vite discover and bundle every route's chunks at least once, and
 * one flaky warm-up hit shouldn't abort a run before the timed pass even
 * begins. `captureRoute`'s own `settle()` still throws loudly on a page that
 * never actually settles, so a failure there keeps meaning something is
 * genuinely broken, not that Vite was still cold.
 */
async function warmUpViteDevServer(
  context: BrowserContext,
  appUrl: string,
  routes: readonly AuditRoute[],
): Promise<void> {
  const page = await context.newPage();
  try {
    for (const route of routes) {
      try {
        await page.goto(`${appUrl}${route.path}`);
        await sleep(VITE_COLD_START_SETTLE_MS);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`warm-up navigation to ${route.path} failed, continuing: ${message}`);
      }
    }
  } finally {
    await page.close();
  }
}

/**
 * Put the generated diary into the origin's IndexedDB, on a page of its own,
 * and read back one real diary-entry id before closing it.
 *
 * `Storage.clearDataForOrigin` runs first, belt and suspenders: a fresh
 * Playwright context already starts with empty storage for every origin, so
 * this guards against nothing today, but it is what makes `seedOrigin` safe
 * to call more than once in a run if this script ever grows a second locale
 * or theme the way `capture-landing.ts` has two.
 */
async function seedOrigin(context: BrowserContext, appUrl: string): Promise<SeedResult> {
  const envelope = buildSeedDiary({
    weeks: SEED_WEEKS,
    seed: SEED_RNG_SEED,
    endDay: SEED_END_DAY,
    timezone: SEED_TIMEZONE,
  });
  const summary = summarizeSeedDiary(envelope);
  console.log(
    `seed diary: ${summary.dayCount} days (${summary.emptyDayCount} empty), ` +
      `${summary.foodLogCount} food logs, ${summary.personalFoodCount} personal foods, ` +
      `${summary.weightEntryCount} weight entries, ${summary.firstDay} to ${summary.lastDay}`,
  );
  const seedJson = serializeBackup(envelope);

  const page = await context.newPage();
  try {
    const client = await context.newCDPSession(page);
    await client.send('Storage.clearDataForOrigin', { origin: appUrl, storageTypes: 'all' });
    await setLanguageCookie(context, appUrl);
    await page.goto(`${appUrl}/welcome`);
    await settle(page);

    const seeded = await page.evaluate<string>(
      `(async () => { const m = await import('/app/lib/local-store/backup.ts'); await m.importBackup(${seedJson}); return 'seeded'; })()`,
    );
    if (seeded !== 'seeded') {
      throw new Error(`The seed import returned ${JSON.stringify(seeded)} instead of 'seeded'.`);
    }

    const expectedFoodLogs = envelope.data.foodLogs.length;
    const persistProbe = await page.evaluate<SeedPersistProbe>(buildSeedPersistProbeExpression(expectedFoodLogs));
    if (!persistProbe.persisted) {
      throw new Error(
        `The seed never reached IndexedDB within ${PERSIST_TIMEOUT_MS} ms: the persisted food-log table held ` +
          `${persistProbe.foodLogRows} of ${expectedFoodLogs} rows. Last probe seen: ${persistProbe.probe}. ` +
          'Capturing now would photograph the welcome screen on every route.',
      );
    }

    const diaryEntryId = await page.evaluate<string>(buildDiaryEntryIdExpression(SEED_END_DAY));
    return { diaryEntryId, foodLogCount: expectedFoodLogs };
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// The capture
// ---------------------------------------------------------------------------

type CaptureResult = {
  route: AuditRoute;
  file: string;
  bytes: number;
};

/** One screenshot, on a page opened for it and closed after it. */
async function captureRoute(context: BrowserContext, appUrl: string, route: AuditRoute): Promise<CaptureResult> {
  const page = await context.newPage();
  try {
    // Belt and suspenders alongside the context's own `colorScheme: 'dark'`
    // and the init script's `localStorage.setItem('theme', 'dark')`.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${appUrl}${route.path}`);
    await settle(page);

    const file = `${OUT_DIR}/${route.name}.png`;
    const bytes = await page.screenshot({ path: file, type: 'png', fullPage: true });
    return { route, file, bytes: bytes.byteLength };
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  // Set before `chromium.launch()` spawns the real Chromium subprocess, which
  // reads this from its inherited environment. `tests/e2e/fonts.conf` is the
  // same fontconfig `playwright.config.ts` points the e2e tier at; this host's
  // own `/etc/fonts/fonts.conf` has previously made every character in a
  // headless Chromium page measure as hidden text.
  const fontsConf = fileURLToPath(new URL('../tests/e2e/fonts.conf', import.meta.url));
  process.env.FONTCONFIG_FILE ??= fontsConf;
  await resetFontconfigCache();

  let appProcess: ChildProcess | null = null;
  let browser: Browser | null = null;

  try {
    appProcess = startApp(AUDIT_APP_PORT);
    await waitForApp(AUDIT_APP_URL);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      isMobile: true,
      hasTouch: true,
      colorScheme: 'dark',
      timezoneId: SEED_TIMEZONE,
    });
    await context.addInitScript(buildClockAndLocaleInitScript());

    const seedResult = await seedOrigin(context, AUDIT_APP_URL);
    const routes = filterRoutes(buildRouteList(seedResult.diaryEntryId));

    await warmUpViteDevServer(context, AUDIT_APP_URL, routes);

    console.log(`capturing ${routes.length} route(s) into ${OUT_DIR}`);

    let totalBytes = 0;
    for (const route of routes) {
      const result = await captureRoute(context, AUDIT_APP_URL, route);
      totalBytes += result.bytes;
      console.log(`wrote ${result.file} (${result.bytes} bytes)`);
    }

    console.log(`done: ${routes.length} file(s), ${totalBytes} bytes total`);
  } finally {
    if (browser !== null) await browser.close();
    killChild(appProcess);
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
