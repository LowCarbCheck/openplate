/**
 * Capture every landing-page screenshot for one locale.
 *
 *     tsx scripts/capture-landing.ts en
 *
 * writes `public/landing/<locale>/<name>.webp` for every view in `VIEWS`, in
 * light and dark. It starts the app, starts a headless Chrome, seeds a fixed
 * example diary, and drives the real product; nothing here draws a mock.
 *
 * ── Why it drives the DEV server ─────────────────────────────────────────
 *
 * The seed goes in through the app's own `importBackup`, reached by importing
 * `/app/lib/local-store/backup.ts` by URL inside the page. Vite serves the
 * app's source modules by URL in dev, which is what makes that possible, and
 * it is worth the whole dev-server dependency: the alternative is a hand
 * written IndexedDB write in this file, which would encode the store's private
 * layout, drift the first time a table is renamed, and fail silently rather
 * than loudly when it did. Going in through the public import path means the
 * seed is exactly as valid as a restored backup, because it is one.
 *
 * ── Environment ──────────────────────────────────────────────────────────
 *
 * All optional; the defaults start everything themselves.
 *
 *  - `CAPTURE_APP_URL`        capture an already running app instead of starting one
 *  - `CAPTURE_PORT`           port for the app this script starts (default 3111)
 *  - `CAPTURE_BROWSER_URL`    an already running CDP endpoint, e.g. http://127.0.0.1:9333
 *  - `CAPTURE_BROWSER_PORT`   debugging port for the browser this script starts (default 9333)
 *  - `CAPTURE_CHROME_PATH`    the headless shell binary to launch
 *  - `CAPTURE_CHROME_PREFIX`  a space separated command prefix for that launch
 *  - `CAPTURE_OUT_DIR`        output root (default `public/landing`)
 *
 * `CAPTURE_CHROME_PREFIX` exists because on the workstation this was written
 * on, the dev container has no browser and Chrome lives on the host, so the
 * launch has to be `flatpak-spawn --host <chrome> ...`. Anything that needs a
 * wrapper command in front of the binary goes here.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { openPage } from './lib/cdp';
import type { CdpPage } from './lib/cdp';
import { buildLandingSeed, SEED_INSTANT, SEED_TIMEZONE } from './landing-seed';
import { isLanguageCode, LANGUAGE_COOKIE, LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES } from '../app/i18n/language-prefs';
import type { LanguageCode } from '../app/i18n/language-prefs';

type Theme = 'light' | 'dark';

type LandingView = {
  /** File-name stem. The landing route and its test pin every one of these. */
  name: string;
  path: string;
  width: number;
  height: number;
  /** Device scale factors to capture at. Two entries means two files. */
  scales: readonly number[];
  mobile: boolean;
};

/**
 * Every screenshot the landing page uses, in one place, so a reader can see the
 * whole set without reading the route.
 *
 * File names follow from this table and are NOT free:
 *  - mobile:            `<name>-mobile-<theme>.webp`
 *  - desktop, scale 1:  `<name>-<theme>-1080.webp`
 *  - desktop, scale 2:  `<name>-<theme>.webp`
 * The two desktop widths are the `srcSet` the landing page already declares
 * (1080w and 2160w), and `tests/unit/landing-assets.test.ts` asserts each of
 * these names exists on disk. Renaming a view here breaks the page.
 *
 * `sync` keeps its name although its path is `/settings/account`:
 * `/settings/sync` has been a server redirect to it since M192, and the landing
 * page and its test pin the old stem.
 *
 * `scan` and `sync` carry their own `height` because a whole-screen shot is
 * captured at the height its content actually needs, and nothing else. A COPY
 * CHANGE is what moves that number: a removed sentence shortens the screen and
 * the next capture comes back with a band of empty background under the
 * content. If you find one, re-measure the screen and change the height here.
 * Cropping the file instead desynchronises it from the intrinsic `height` the
 * landing route declares, which is what reserves the space before the image
 * loads.
 */
export const VIEWS: readonly LandingView[] = [
  { name: 'diary', path: '/diary', width: 390, height: 844, scales: [2], mobile: true },
  { name: 'add', path: '/add', width: 390, height: 844, scales: [2], mobile: true },
  { name: 'scan', path: '/scan', width: 390, height: 560, scales: [2], mobile: true },
  { name: 'goals', path: '/settings/goals', width: 390, height: 844, scales: [2], mobile: true },
  { name: 'sync', path: '/settings/account', width: 390, height: 430, scales: [2], mobile: true },
  { name: 'overview', path: '/dashboard', width: 390, height: 844, scales: [2], mobile: true },
  { name: 'diary-desktop', path: '/diary', width: 1080, height: 720, scales: [1, 2], mobile: false },
];

const THEMES: readonly Theme[] = ['light', 'dark'];

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const DEFAULT_APP_PORT = 3111;
const DEFAULT_BROWSER_PORT = 9333;
const DEFAULT_OUT_DIR = 'public/landing';

const APP_READY_TIMEOUT_MS = 60_000;
const APP_READY_POLL_MS = 500;
const BROWSER_READY_TIMEOUT_MS = 30_000;
const BROWSER_READY_POLL_MS = 250;

const SETTLE_TIMEOUT_MS = 20_000;
const SETTLE_POLL_MS = 300;
/** Identical text this many polls running before the page counts as still. */
const SETTLE_STABLE_POLLS = 3;
/** Below this, "the text stopped changing" only means the page is still empty. */
const SETTLE_MIN_TEXT_LENGTH = 20;

const PERSIST_TIMEOUT_MS = 15_000;
const PERSIST_POLL_MS = 250;

const screenshotSchema = z.object({ data: z.string() });

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// The app under capture
// ---------------------------------------------------------------------------

/**
 * `SYNC_SERVER_URL` is not decoration. The account and sync surfaces do not
 * render at all on an instance that has no sync server, so a run without it
 * would produce a perfectly sharp screenshot of a different product, and the
 * `sync` view above would capture an empty settings page. Set here rather than
 * left to `.env` so the capture cannot depend on a developer's local file.
 */
function startApp(port: number): ChildProcess {
  return spawn('node_modules/.bin/tsx', ['server.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      SYNC_SERVER_URL: 'https://sync.openplate.de',
    },
    stdio: 'inherit',
  });
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
    await delay(APP_READY_POLL_MS);
  }
  throw new Error(`The app at ${appUrl} did not answer /healthcheck within ${APP_READY_TIMEOUT_MS} ms.`);
}

// ---------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------

type BrowserLaunch = {
  chromePath: string;
  /** `CAPTURE_CHROME_PREFIX` split on spaces, e.g. `['flatpak-spawn', '--host']`. */
  prefix: readonly string[];
  port: number;
  userDataDir: string;
};

function launchBrowser(launch: BrowserLaunch): ChildProcess {
  const args = [
    `--remote-debugging-port=${launch.port}`,
    '--remote-allow-origins=*',
    '--no-sandbox',
    `--user-data-dir=${launch.userDataDir}`,
    '--hide-scrollbars',
    '--disable-gpu',
    '--force-color-profile=srgb',
    'about:blank',
  ];
  const argv = [...launch.prefix.slice(1), launch.chromePath, ...args];
  const command = launch.prefix[0] ?? launch.chromePath;
  return spawn(command, launch.prefix.length > 0 ? argv : args, { stdio: 'inherit' });
}

async function waitForBrowser(browserUrl: string): Promise<void> {
  const deadline = Date.now() + BROWSER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${browserUrl}/json/version`);
      if (response.ok) return;
    } catch {
      // Not listening yet. Keep polling until the deadline.
    }
    await delay(BROWSER_READY_POLL_MS);
  }
  throw new Error(`The browser at ${browserUrl} did not answer /json/version within ${BROWSER_READY_TIMEOUT_MS} ms.`);
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
 * The probed `output` is `AppLoading` (`app/components/app-loading.tsx`). Its
 * presence in the DOM is the app saying, in its own words, that it has not
 * finished.
 *
 * The selector carries the loading icon as well as the live region, and it has
 * to: `/add` renders a status `output[aria-live="polite"]` of its own, so the
 * bare live-region selector read as "still loading" forever and every capture
 * after the diary failed on the settle deadline.
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
 * This is the one helper that silently produces a picture of a spinner if it is
 * too lenient, and it did: an earlier version waited on the load event and
 * captured the desktop diary mid-render. So readiness needs ALL of four things,
 * not any of them. No `AppLoading` in the DOM, every image decoded, body text
 * unchanged across three consecutive polls, and more than a token amount of
 * text so that "unchanged" cannot be satisfied by an empty page. Fonts are
 * awaited last, after the DOM has stopped moving, because a font swap moves
 * every line of the shot.
 *
 * A timeout FAILS the run. A capture that quietly ships a loading state is
 * worse than no capture, because the file exists and every check downstream
 * passes.
 */
async function settle(page: CdpPage): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let lastText = '';
  let stablePolls = 0;
  let lastPath = '(not yet probed)';

  while (Date.now() < deadline) {
    const probe = await page.evaluate<SettleProbe>(SETTLE_PROBE_EXPRESSION);
    lastPath = probe.path;
    // `CAPTURE_DEBUG=1` prints one line per poll to stderr. Settling is the
    // step that fails opaquely, and seeing WHICH of the four conditions is
    // still false is what turned "it timed out" into a diagnosis twice.
    if (process.env.CAPTURE_DEBUG !== undefined) {
      console.error(
        `settle ${probe.path}: loading=${probe.loading} imagesReady=${probe.imagesReady} textLength=${probe.text.length}`,
      );
    }
    stablePolls = probe.text === lastText ? stablePolls + 1 : 1;
    lastText = probe.text;

    const isStill = stablePolls >= SETTLE_STABLE_POLLS && probe.text.length > SETTLE_MIN_TEXT_LENGTH;
    if (!probe.loading && probe.imagesReady && isStill) {
      await page.evaluate<boolean>('document.fonts.ready.then(() => true)');
      return;
    }
    await delay(SETTLE_POLL_MS);
  }

  throw new Error(
    `The page at ${lastPath} never settled within ${SETTLE_TIMEOUT_MS} ms. Capturing it now would photograph a loading state, so this run fails instead.`,
  );
}

// ---------------------------------------------------------------------------
// The capture
// ---------------------------------------------------------------------------

/**
 * The script that runs in every document BEFORE any app code does.
 *
 * The clock: only `Date` is replaced, never `performance.now`. Timers and
 * animations therefore still advance and the app runs normally; it just always
 * believes it is `SEED_INSTANT`, which is what pins the diary header, the "last
 * 7 days" dots and every relative time in the shots.
 *
 * The locale: this script writes the localStorage MIRROR only, which is what
 * the client-side detector reads after hydration. The cookie is deliberately
 * not here, because this script is too late for it. See `setLanguageCookie`.
 */
function buildInitScript(theme: Theme, locale: LanguageCode): string {
  return `
const F = ${SEED_INSTANT};
const R = Date;
class D extends R {
  constructor(...a) { if (a.length === 0) super(F); else super(...a); }
  static now() { return F; }
}
Object.defineProperty(globalThis, 'Date', { value: D, writable: true, configurable: true });
try {
  localStorage.setItem('theme', ${JSON.stringify(theme)});
  localStorage.setItem(${JSON.stringify(LANGUAGE_STORAGE_KEY)}, ${JSON.stringify(locale)});
} catch (error) {
  /* storage blocked; the cookie set through CDP still carries the locale */
}
`;
}

function outputFileName(view: LandingView, theme: Theme, scale: number): string {
  if (view.mobile) return `${view.name}-mobile-${theme}.webp`;
  return scale === 1 ? `${view.name}-${theme}-1080.webp` : `${view.name}-${theme}.webp`;
}

type CaptureRun = {
  appUrl: string;
  browserUrl: string;
  locale: LanguageCode;
  theme: Theme;
  outDir: string;
};

/**
 * The viewport the seeding page runs at. Nothing is photographed here, but a
 * phone viewport is what the app boots into everywhere else, so the seeding
 * load exercises the same layout as the shots that follow.
 */
const SEED_PAGE_METRICS = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

type PageSetup = {
  browserUrl: string;
  /** Runs before any app code in every document this page loads. */
  initScript: string;
};

type CookieTarget = {
  appUrl: string;
  locale: LanguageCode;
};

/**
 * Write the locale cookie into the browser's jar, before the page navigates.
 *
 * This CANNOT be done from the init script, and getting that wrong is what
 * shipped an English screenshot inside a German set. The server picks the
 * language from the cookie ON THE REQUEST, so by the time
 * `Page.addScriptToEvaluateOnNewDocument` runs, the HTML it would influence
 * already exists; a `document.cookie` write there only takes effect from the
 * NEXT navigation. With one fresh page per shot and a cookie jar shared by the
 * whole browser profile, that means the first shot of a run renders in
 * whatever language the PREVIOUS run left behind. Setting it through CDP
 * beforehand makes `document.documentElement.lang` correct on the very first
 * navigation of a clean profile.
 *
 * The localStorage mirror stays in the init script: the cookie is what the
 * server reads while producing the first byte, the mirror is what the client
 * reads after hydration, and both have to agree.
 */
async function setLanguageCookie(page: CdpPage, target: CookieTarget): Promise<void> {
  await page.send('Network.setCookie', {
    name: LANGUAGE_COOKIE,
    value: target.locale,
    url: target.appUrl,
    path: '/',
  });
}

/**
 * Open a page and apply the setup every page in a run needs, before it has
 * navigated anywhere.
 */
async function preparePage(setup: PageSetup): Promise<CdpPage> {
  const page = await openPage(setup.browserUrl);
  await page.send('Page.enable');
  await page.send('Emulation.setTimezoneOverride', { timezoneId: SEED_TIMEZONE });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: setup.initScript });
  return page;
}

type SeedPersistProbe = {
  persisted: boolean;
  foodLogRows: number;
  /** The last counts the probe saw, already JSON, so a failure can name them. */
  counts: string;
};

/**
 * Wait, inside the seeding page, until the seed is actually ON DISK.
 *
 * `importBackup` resolving does NOT mean persisted. It writes to the in-memory
 * tinybase store, and the IndexedDB write is the persister's coalescing
 * autosave, which is asynchronous (see the window `installFlushOnHide` exists
 * for, in `app/lib/local-store/persist.ts`). Closing the seeding page the
 * instant `importBackup` resolves races that save against the tab teardown.
 *
 * It is a race, so it is intermittent, and it fails silently in the worst
 * possible shape: every capture page after this one is a FRESH TAB that reads
 * the ORIGIN's IndexedDB and knows nothing about the tab that wrote it, so
 * losing the race produces a full set of screenshots of "Welcome to openplate.
 * This device has no diary on it yet." with a green run and no error anywhere.
 * That is exactly what happened, on the dark pass of a run whose light pass had
 * won the same race.
 *
 * The rule this waits on: the PERSISTED food-log table's row count reaches the
 * number of logs the seed contains. Anything less, `null` included, means the
 * save has not landed yet and the probe keeps waiting.
 *
 * `performance.now`, not `Date.now`: the init script freezes `Date`, so a
 * deadline computed from `Date.now()` would never move and this loop would
 * never end. See `buildInitScript`.
 */
function buildPersistProbeExpression(expectedFoodLogs: number): string {
  return `(async () => {
  const persist = await import('/app/lib/local-store/persist.ts');
  const store = await import('/app/lib/local-store/store.ts');
  const schema = await import('/app/lib/local-store/schema.ts');
  const start = performance.now();
  let counts = null;
  let rows = 0;
  while (performance.now() - start < ${PERSIST_TIMEOUT_MS}) {
    counts = await persist.readPersistedTableRowCounts(store.PRIMARY_DB_NAME);
    rows = counts === null ? 0 : (counts[schema.FOOD_LOGS_TABLE] ?? 0);
    if (rows >= ${expectedFoodLogs}) {
      return { persisted: true, foodLogRows: rows, counts: JSON.stringify(counts) };
    }
    await new Promise((resolve) => setTimeout(resolve, ${PERSIST_POLL_MS}));
  }
  return { persisted: false, foodLogRows: rows, counts: JSON.stringify(counts) };
})()`;
}

/**
 * Put the example diary into the origin's IndexedDB, on a page of its own.
 *
 * The data outlives this tab, which is the whole reason the seeding can be its
 * own page: IndexedDB belongs to the origin, not to the document that wrote it.
 *
 * `Storage.clearDataForOrigin` runs HERE and only here, and only while no other
 * page holds the origin open. A clear issued against an origin that some other
 * tab still has a connection to blocks on that connection, and the next load
 * then hangs in `AppLoading` with no error at all. A previous run's data is not
 * inert either: the seed is an upsert, so its logs survived into the next
 * capture and the ring showed double the carbs against a blown goal.
 *
 * Order matters between those two: `'all'` includes COOKIES, so the clear has
 * to happen BEFORE the locale cookie is written or it takes the locale with it.
 */
async function seedOrigin(run: CaptureRun): Promise<void> {
  const page = await preparePage({
    browserUrl: run.browserUrl,
    initScript: buildInitScript(run.theme, run.locale),
  });
  try {
    await page.send('Storage.clearDataForOrigin', { origin: run.appUrl, storageTypes: 'all' });
    await setLanguageCookie(page, { appUrl: run.appUrl, locale: run.locale });
    await page.send('Emulation.setDeviceMetricsOverride', SEED_PAGE_METRICS);
    await page.send('Page.navigate', { url: `${run.appUrl}/welcome` });
    await settle(page);

    const seed = buildLandingSeed(run.locale);
    const seedJson = JSON.stringify(seed);
    const seeded = await page.evaluate<string>(
      `(async () => { const m = await import('/app/lib/local-store/backup.ts'); await m.importBackup(${seedJson}); return 'seeded'; })()`,
    );
    if (seeded !== 'seeded') {
      throw new Error(`The seed import returned ${JSON.stringify(seeded)} instead of 'seeded'.`);
    }

    // The expected count comes from the SAME envelope that was just imported,
    // so the two can never disagree about how many logs the seed has.
    const expectedFoodLogs = seed.data.foodLogs.length;
    const probe = await page.evaluate<SeedPersistProbe>(buildPersistProbeExpression(expectedFoodLogs));
    if (!probe.persisted) {
      throw new Error(
        `The seed never reached IndexedDB within ${PERSIST_TIMEOUT_MS} ms: the persisted food-log table held ${probe.foodLogRows} of ${expectedFoodLogs} rows. Last counts seen: ${probe.counts}. Capturing now would photograph the welcome screen on every view.`,
      );
    }
  } finally {
    await page.close();
  }
}

type ShotRun = CaptureRun & {
  view: LandingView;
  scale: number;
};

/** One screenshot, on a page opened for it and closed after it. */
async function captureView(shot: ShotRun): Promise<void> {
  const page = await preparePage({
    browserUrl: shot.browserUrl,
    initScript: buildInitScript(shot.theme, shot.locale),
  });
  try {
    await setLanguageCookie(page, { appUrl: shot.appUrl, locale: shot.locale });
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: shot.theme }],
    });
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: shot.view.width,
      height: shot.view.height,
      deviceScaleFactor: shot.scale,
      mobile: shot.view.mobile,
    });
    await page.send('Page.navigate', { url: `${shot.appUrl}${shot.view.path}` });
    await settle(page);

    const capture = screenshotSchema.parse(await page.send('Page.captureScreenshot', { format: 'webp', quality: 92 }));
    const file = path.join(shot.outDir, shot.locale, outputFileName(shot.view, shot.theme, shot.scale));
    const bytes = Buffer.from(capture.data, 'base64');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    console.log(`wrote ${file} (${bytes.byteLength} bytes)`);
  } finally {
    await page.close();
  }
}

async function captureTheme(run: CaptureRun): Promise<void> {
  await seedOrigin(run);

  // ONE FRESH PAGE PER SHOT, which looks wasteful and is not. A single reused
  // renderer dies after roughly eight document loads: the app comes up stuck in
  // `AppLoading` forever, the body text stays empty and settle times out. It is
  // not one particular view, it moved between the seventh and the eighth
  // navigation across runs, so it is state accumulating in the renderer, almost
  // certainly the local store's IndexedDB connections and Web Locks from every
  // previous load. Collapsing this back into one page brings that back.
  for (const view of VIEWS) {
    for (const scale of view.scales) {
      await captureView({ ...run, view, scale });
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const locale = process.argv[2];
  if (!isLanguageCode(locale)) {
    console.error('usage: tsx scripts/capture-landing.ts <locale>');
    console.error(`  <locale> is one of: ${SUPPORTED_LANGUAGES.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const outDir = process.env.CAPTURE_OUT_DIR ?? DEFAULT_OUT_DIR;
  const configuredAppUrl = process.env.CAPTURE_APP_URL ?? null;
  const configuredBrowserUrl = process.env.CAPTURE_BROWSER_URL ?? null;
  const appPort = Number(process.env.CAPTURE_PORT ?? DEFAULT_APP_PORT);
  const browserPort = Number(process.env.CAPTURE_BROWSER_PORT ?? DEFAULT_BROWSER_PORT);

  let appProcess: ChildProcess | null = null;
  let browserProcess: ChildProcess | null = null;

  try {
    const appUrl = configuredAppUrl ?? `http://127.0.0.1:${appPort}`;
    if (configuredAppUrl === null) {
      appProcess = startApp(appPort);
      await waitForApp(appUrl);
    }

    const browserUrl = configuredBrowserUrl ?? `http://127.0.0.1:${browserPort}`;
    if (configuredBrowserUrl === null) {
      const chromePath = process.env.CAPTURE_CHROME_PATH ?? null;
      if (chromePath === null) {
        throw new Error(
          'Set CAPTURE_CHROME_PATH to a headless Chrome binary, or CAPTURE_BROWSER_URL to an endpoint that is already running one.',
        );
      }
      const prefix = (process.env.CAPTURE_CHROME_PREFIX ?? '').split(' ').filter((part) => part.length > 0);
      const userDataDir = await mkdtemp(path.join(tmpdir(), 'openplate-capture-'));
      browserProcess = launchBrowser({ chromePath, prefix, port: browserPort, userDataDir });
      await waitForBrowser(browserUrl);
    }

    for (const theme of THEMES) {
      await captureTheme({ appUrl, browserUrl, locale, theme, outDir });
    }
  } finally {
    killChild(browserProcess);
    killChild(appProcess);
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
