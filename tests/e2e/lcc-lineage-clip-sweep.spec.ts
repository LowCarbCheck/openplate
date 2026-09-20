/**
 * What the wider face clips, listed for a person to read (M243 spec 08).
 *
 * THE QUESTION. Victor Mono is a flat 0.6 em per character. Inter is proportional. A mixed-case
 * German string is 13 to 31 percent wider in the new face, and the app has roughly 63 `truncate`
 * and `overflow-hidden` sites, most of them holding text nobody chose in advance: food names,
 * translated titles, a version number. A page-level `scrollWidth` of 390 cannot see any of it.
 * This sweep reads every clipping box on every first-visit screen, in the app's own face and
 * again in Inter, in the SAME page, and writes down what got worse.
 *
 * A REPORT, NOT A VERDICT. Almost everything found here is a fact for the operator to weigh, so it
 * goes to `test-results/lcc-lineage-clip-report.json` and this spec does not fail on it. Exactly
 * two things are hard, because a person cannot work around them: the app header's page title and
 * the bottom bar's tab labels. Those fail the run when they are newly clipped, or when a tab label
 * wraps onto a second line, compared with Inter. Everything else is listed, never asserted.
 *
 * THE HARD CLAIM FOUND SOMETHING ON ITS FIRST RUN, and it was fixed rather than listed. At 15 px
 * the header title clipped harder than Inter at 18 px for seven Spanish, French and Italian titles
 * at 320 and 360 px, which the German and Turkish measurement of spec 02 could not see. The title
 * is now 14 px (`text-sm`, the floor in `tests/design-contract.ts`). One row is left, and it is
 * frozen in `KNOWN_HARD_RESIDUE` with its reason: it fails in both directions, so a fix is noticed.
 *
 * HOW THE TWO FACES ARE COMPARED. `clip-baseline.ts` injects the Inter stack at runtime and
 * explains why that is one custom property and why the header title is put back to 18 px in the
 * baseline. It reads the same DOM twice, so the only thing that changed between the reads is the
 * face.
 *
 * FIRST-VISIT ROUTES, IN TWO GROUPS. A fresh device meets `/welcome`, the onboarding, the landing
 * page, the sign-in doors and the legal pages BEFORE it has a diary, and `_personal.tsx` sends it
 * away from them once it has one. So the public group is swept first, on a device that has never
 * been used, and the personal group after the real onboarding and four logged foods. Routes that
 * need a link's fragment, an account or an administrator (`/join`, `/study`, `/admin`, `/reset`)
 * are not first-visit screens and are not swept.
 *
 * LONG FOOD NAMES. Food names are user data. Four names of 34 to 37 characters (two German, two
 * Turkish, with `ß ü ö ä ı ş ğ İ`) are logged through the real form, two of them twice so the
 * diary offers them as quick-add chips too. They appear on the diary, on the add screen and on the
 * dashboard, which is where a clipped name would hide.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ──
 * A sweep that found nothing would look exactly like a sweep that could not see. The control test
 * injects three elements known to clip in mono and not in Inter (an ordinary box, a bottom bar
 * label and an app header title), reads them through the SAME reader and the SAME comparison, and
 * requires all three to be listed, the last two to trip the hard assertion, and the real chrome
 * beside them to stay clean. It then writes them into the report and reads the report back, so the
 * file path is shown able to carry a finding.
 *
 * NO SERVICE WORKER IS BLOCKED here: the sweep walks the app the way a person meets it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import type { LanguageCode } from '../../app/i18n/language-prefs';
import { BODY_STACK, PROSE_STACK } from '../design-contract';
import {
  clipRowSchema,
  compareClips,
  hardViolations,
  injectClipControls,
  readBothFaces,
  settleFonts,
  waitForQuiet,
  type ClipRead,
} from './clip-baseline';
import { completeOnboarding, logFoodManually, useLanguage } from './helpers';

/**
 * All six shipped languages. The brief names German (the widest) and Turkish (the second, with a
 * second font file) and asks for all six if the run stays under ten minutes. One language takes
 * about 80 seconds, so six take about eight minutes, and the three that are not German or Turkish
 * are the ones to drop from this list first if the run ever has to be shorter.
 */
const LOCALES = ['de', 'tr', 'en', 'es', 'fr', 'it'] as const satisfies readonly LanguageCode[];

/** The three phone widths: the narrowest a person owns, the narrowest the app promises, and the design width. */
const WIDTHS = [320, 360, 390] as const;

/** A generous height, so width is the only thing under test. */
const PHONE_HEIGHT = 844;

/** Where the operator reads the result. */
const REPORT_PATH = resolve(process.cwd(), 'test-results/lcc-lineage-clip-report.json');

/** One locale's sweep: 13 public and ~30 personal routes, at three widths, read twice. */
const SWEEP_TIMEOUT_MS = 600_000;

/** Screens a device meets before it has a diary. They are swept on a fresh device. */
const PUBLIC_ROUTES = [
  '/',
  '/welcome',
  '/onboarding',
  '/sign-in',
  '/forgot',
  '/recover',
  '/terms',
  '/privacy',
  '/imprint',
  '/withdrawal',
  '/offline',
] as const;

/** Screens of the app itself, swept after onboarding and four logged foods. */
const APP_ROUTES = [
  '/dashboard',
  '/diary',
  '/add',
  '/scan',
  '/describe',
  '/trends',
  '/awards',
  '/foods',
  '/meals',
  '/pantry',
  '/pantry/recipes',
  '/nutrients',
  '/fasting',
  '/catch-up',
  '/settings',
  '/settings/ai',
  '/settings/preferences',
  '/settings/notifications',
  '/settings/profile',
  '/settings/nutrition',
  '/settings/fasting',
  '/settings/life-phase',
  '/settings/data',
  '/settings/account',
  '/settings/about',
  '/settings/whats-new',
  '/settings/sharing',
  '/settings/research',
  '/shared',
] as const;

/**
 * Four food names of 34 to 37 characters, which is what a branded product reads like in a
 * database, with the characters the wider face and the German and Turkish locales stress. The
 * first two are logged twice so the diary offers them as a quick-add chip.
 */
const LONG_FOODS = [
  { name: 'Hähnchenbrustfilet mit Süßkartoffel', mealType: 'breakfast', times: 2 },
  { name: 'Vollkornbrot mit Frischkäse und Gurke', mealType: 'lunch', times: 1 },
  { name: 'Ispanaklı peynirli börek, şekersiz', mealType: 'dinner', times: 2 },
  { name: 'Şekersiz ıhlamurlu ağaç çileği çayı', mealType: 'snack', times: 1 },
] as const;

/** The length band the brief asks the fixtures to sit in. */
const FOOD_NAME_MIN_CHARS = 30;
const FOOD_NAME_MAX_CHARS = 40;

/** What the bottom bar holds today: the diary, the raised launcher and the add screen. */
const MIN_TAB_LABELS = 3;

/** A place where a hard claim is known to be broken and cannot be fixed by size. */
interface KnownHardResidue {
  locale: string;
  viewport: number;
  route: string;
  role: 'header-title' | 'tab-label';
  why: string;
}

/**
 * The hard rows that survive the 14 px title. See the header: this is a frozen set, and it fails
 * when a NEW row appears and when a listed one stops appearing.
 */
const KNOWN_HARD_RESIDUE: readonly KnownHardResidue[] = [
  {
    locale: 'it',
    viewport: 320,
    route: '/catch-up',
    role: 'header-title',
    why: 'The Italian title "Il tuo riepilogo giornaliero" is 28 characters. At 14 px, the floor in design-contract.ts, it clips 24 px in Victor Mono against 21 px in Inter at 320 px: 3 px more, on a screen narrower than the 360 px the app promises to fit. Below 14 px a title is not read, so size cannot close it; a tighter letter spacing or a shorter Italian title would.',
  },
];

/** One finding, with the place it was found. */
const reportRowSchema = clipRowSchema.extend({
  locale: z.string(),
  viewport: z.number(),
  route: z.string(),
  landed: z.string(),
});
type ReportRow = z.infer<typeof reportRowSchema>;

/** The report file, as it is written and read back. */
const reportSchema = z.object({
  generatedAt: z.string(),
  bodyStack: z.string(),
  interStack: z.string(),
  widths: z.array(z.number()),
  /** Per locale: how many page reads were taken and how many rows came out. */
  locales: z.array(z.object({ locale: z.string(), pagesRead: z.number(), rows: z.number() })),
  rows: z.array(reportRowSchema),
  /** The control test's findings, kept apart so the operator's list is never padded by them. */
  controls: z.array(reportRowSchema),
});
type Report = z.infer<typeof reportSchema>;

/**
 * The report as it stands on disk, or an empty one.
 *
 * @returns the parsed file, or a report with nothing in it.
 */
function readReport(): Report {
  const empty: Report = {
    generatedAt: new Date().toISOString(),
    bodyStack: BODY_STACK,
    interStack: PROSE_STACK,
    widths: [...WIDTHS],
    locales: [],
    rows: [],
    controls: [],
  };
  if (!existsSync(REPORT_PATH)) return empty;
  return reportSchema.parse(JSON.parse(readFileSync(REPORT_PATH, 'utf8')));
}

/**
 * Writes the report. Every write is a READ-MERGE-WRITE, so a worker that Playwright restarts after
 * a failure, or a single locale run on its own, never overwrites what an earlier test wrote.
 *
 * @param change - what to put on top of what is on disk.
 */
function writeReport(change: {
  locale?: { locale: string; pagesRead: number; rows: ReportRow[] };
  controls?: ReportRow[];
}): void {
  const current = readReport();
  const next: Report = { ...current, generatedAt: new Date().toISOString() };
  if (change.locale !== undefined) {
    const { locale, pagesRead, rows } = change.locale;
    next.rows = [...current.rows.filter((row) => row.locale !== locale), ...rows];
    next.locales = [
      ...current.locales.filter((entry) => entry.locale !== locale),
      { locale, pagesRead, rows: rows.length },
    ];
  }
  if (change.controls !== undefined) next.controls = change.controls;
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

/** Everything one sweep learned. */
interface SweepResult {
  rows: ReportRow[];
  /** Header title and tab label rows that got worse: the two hard claims. */
  hard: ReportRow[];
  /** Pages read. */
  pagesRead: number;
  /** Pages on which a header title was read, and tab labels in total, so the hard claim is not vacuous. */
  titlesRead: number;
  tabLabelsRead: number;
  /** Pages whose header read was not of exactly one app header with no fallback bar over it. */
  badHosts: string[];
}

/**
 * Whether a read holds an app header title, and how many tab labels it holds.
 *
 * @param read - one face's read.
 * @returns the two counts.
 */
function chromeCounts(read: ClipRead) {
  return {
    titles: read.readings.filter((reading) => reading.role === 'header-title').length,
    labels: read.readings.filter((reading) => reading.role === 'tab-label').length,
  };
}

/**
 * Loads one route at one width and reads it in both faces.
 *
 * @param page - the page to drive.
 * @param options - the route, the width and the language it is read in.
 * @returns the rows the wider face made worse, and what the read held.
 */
async function sweepOne({
  page,
  route,
  width,
  locale,
}: {
  page: Page;
  route: string;
  width: number;
  locale: string;
}): Promise<{ rows: ReportRow[]; mono: ClipRead; landed: string }> {
  await page.setViewportSize({ width, height: PHONE_HEIGHT });
  await page.goto(route);
  await waitForQuiet(page);
  const landed = new URL(page.url()).pathname;
  const { mono, inter } = await readBothFaces(page);
  const rows: ReportRow[] = [];
  for (const row of compareClips({ mono, inter })) {
    rows.push({ ...row, locale, viewport: width, route, landed });
  }
  return { rows, mono, landed };
}

/** Whether a hard row is the place a frozen entry names. */
function isResidue(row: ReportRow, residue: KnownHardResidue): boolean {
  return (
    row.locale === residue.locale &&
    row.viewport === residue.viewport &&
    row.route === residue.route &&
    row.role === residue.role
  );
}

/**
 * Splits the hard rows into the ones a frozen entry explains and the ones nothing explains.
 *
 * @param rows - the hard rows a sweep collected.
 * @param known - the frozen residue.
 * @returns the explained rows, the unexplained rows, and the entries no row matched.
 */
function partitionHard({ rows, known }: { rows: readonly ReportRow[]; known: readonly KnownHardResidue[] }) {
  return {
    explained: rows.filter((row) => known.some((residue) => isResidue(row, residue))),
    unexplained: rows.filter((row) => !known.some((residue) => isResidue(row, residue))),
    unmatched: known.filter((residue) => !rows.some((row) => isResidue(row, residue))),
  };
}

/**
 * Sweeps a list of routes at every width and folds the result into one record.
 *
 * @param page - the page to drive.
 * @param routes - the routes to visit.
 * @param locale - the language the device is in.
 * @param into - the record to add to.
 */
async function sweepRoutes({
  page,
  routes,
  locale,
  into,
}: {
  page: Page;
  routes: readonly string[];
  locale: string;
  into: SweepResult;
}): Promise<void> {
  for (const width of WIDTHS) {
    for (const route of routes) {
      const { rows, mono } = await sweepOne({ page, route, width, locale });
      const { titles, labels } = chromeCounts(mono);
      into.pagesRead += 1;
      into.rows.push(...rows);
      into.hard.push(...hardViolations(rows));
      into.titlesRead += titles;
      into.tabLabelsRead += labels;
      // Every header measurement needs exactly one status host, or a fallback bar is painted over
      // the real header and the row read is the wrong one (design brief, risk 3).
      if (titles > 0 && (mono.appHeaders !== 1 || mono.fallbackBars !== 0)) {
        into.badHosts.push(
          `${locale} ${width}px ${route}: ${mono.appHeaders} app headers and ${mono.fallbackBars} fallback bars`,
        );
      }
    }
  }
}

/**
 * Logs the four long-named foods through the real form, in English, on a device past onboarding.
 *
 * @param page - a page past onboarding, in English.
 */
async function logLongFoods(page: Page): Promise<void> {
  for (const food of LONG_FOODS) {
    for (let time = 0; time < food.times; time += 1) {
      await logFoodManually(page, { name: food.name, grams: '150', carbs: '5', mealType: food.mealType });
    }
  }
}

test('the fixtures are 30 to 40 characters, so the long-name claim is not vacuous', () => {
  for (const food of LONG_FOODS) {
    expect(food.name.length, `${food.name} must be a long name`).toBeGreaterThanOrEqual(FOOD_NAME_MIN_CHARS);
    expect(food.name.length, `${food.name} must stay inside the band`).toBeLessThanOrEqual(FOOD_NAME_MAX_CHARS);
  }
});

for (const locale of LOCALES) {
  test(`the wider face clips no header title and no tab label, ${locale} at 320, 360 and 390`, async ({ page }) => {
    test.setTimeout(SWEEP_TIMEOUT_MS);
    const result: SweepResult = { rows: [], hard: [], pagesRead: 0, titlesRead: 0, tabLabelsRead: 0, badHosts: [] };

    // 1. The first-visit screens, on a device that has never been used, in the language under test.
    await useLanguage(page, locale);
    await sweepRoutes({ page, routes: PUBLIC_ROUTES, locale, into: result });

    // 2. A diary to look at. Onboarding and the form are driven in English, because their helpers
    // click by English label, and the language is put back before anything is read.
    await useLanguage(page, 'en');
    await page.setViewportSize({ width: 390, height: PHONE_HEIGHT });
    await completeOnboarding(page);
    await logLongFoods(page);
    await useLanguage(page, locale);

    // 3. One food's own page, found the way a person finds it: by tapping the row.
    await page.goto('/diary');
    const entry = page.locator('main a[href^="/diary/entry/"]').first();
    await expect(entry, `${locale}: the diary must list a logged food as a link`).toBeVisible();
    const entryHref = await entry.getAttribute('href');
    expect(entryHref, `${locale}: the food row must carry an address`).not.toBeNull();

    // 4. The app itself.
    await sweepRoutes({ page, routes: [...APP_ROUTES, entryHref ?? ''], locale, into: result });

    writeReport({ locale: { locale, pagesRead: result.pagesRead, rows: result.rows } });

    // NON-VACUITY FIRST: a hard claim over zero titles and zero labels is a claim about nothing.
    const appPages = WIDTHS.length * (APP_ROUTES.length + 1);
    expect(result.titlesRead, `${locale}: every app page must have been read with its header title`).toBeGreaterThanOrEqual(
      appPages,
    );
    expect(
      result.tabLabelsRead,
      `${locale}: every app page must have been read with its ${MIN_TAB_LABELS} tab labels`,
    ).toBeGreaterThanOrEqual(appPages * MIN_TAB_LABELS);
    expect(result.badHosts, `${locale}: a header read needs exactly one header and no fallback bar`).toEqual([]);

    // THE TWO HARD CLAIMS. Listed before asserted, so a failure names the element and the numbers.
    const { unexplained, unmatched } = partitionHard({
      rows: result.hard,
      known: KNOWN_HARD_RESIDUE.filter((residue) => residue.locale === locale),
    });
    const described = unexplained.map(
      (row) =>
        `${row.route} at ${row.viewport}px: ${row.role} "${row.text}" ${row.kind}, mono clips ${row.mono.clip}px on ${row.mono.lines} line(s), Inter ${row.inter.clip}px on ${row.inter.lines}`,
    );
    expect(described, `${locale}: a header page title or a bottom bar label is newly clipped in Victor Mono`).toEqual([]);
    expect(
      unmatched.map((residue) => `${residue.route} at ${residue.viewport}px: ${residue.why}`),
      `${locale}: a frozen hard row no longer appears, so delete it from KNOWN_HARD_RESIDUE`,
    ).toEqual([]);
  });
}

test('CONTROL: the sweep lists a known overflow, and the hard claims fail on a clipped title and tab label', async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: 360, height: PHONE_HEIGHT });
  await page.goto('/diary');
  await expect(page.locator('header.sticky h1')).toBeVisible();
  await waitForQuiet(page);
  await settleFonts(page);

  const geometry = await injectClipControls(page);
  expect(geometry.length, 'three controls are injected').toBe(3);
  for (const control of geometry) {
    // The control only means something if the two faces really differ on it, and the box sits
    // strictly between them. A box that fit in both, or clipped in both, would prove nothing.
    expect(control.monoWidth, `${control.id}: the text must be wider in Victor Mono than in Inter`).toBeGreaterThan(
      control.interWidth + 20,
    );
    expect(control.boxWidth, `${control.id}: the box must be narrower than the mono text`).toBeLessThan(control.monoWidth);
    expect(control.boxWidth, `${control.id}: the box must be wider than the Inter text`).toBeGreaterThan(
      control.interWidth,
    );
  }

  const { mono, inter } = await readBothFaces(page);
  const rows = compareClips({ mono, inter });
  const controlRows = rows.filter((row) => row.text.startsWith('illl'));
  const realRows = rows.filter((row) => !row.text.startsWith('illl'));

  // The ordinary control is listed, as newly clipped: it fit in Inter and does not fit in mono.
  const plain = controlRows.find((row) => row.role === null);
  expect(plain?.kind, 'the plain control must be listed as newly clipped').toBe('newly-clipped');
  expect(plain?.mono.clip ?? 0, 'the plain control must clip in mono').toBeGreaterThan(0);
  expect(plain?.inter.clip ?? -1, 'the plain control must not clip in Inter').toBe(0);

  // The two hard controls carry their role, and the hard claim finds exactly them.
  const violations = hardViolations(rows);
  expect(
    violations.map((row) => row.role).toSorted(),
    'the hard claim must flag the clipped title and the clipped tab label, and nothing else',
  ).toEqual(['header-title', 'tab-label']);
  expect(
    violations.every((row) => row.text.startsWith('illl')),
    'and both flagged rows must be the injected controls',
  ).toBe(true);

  // The frozen residue can fail in both directions: handed the control's own row as an entry, the
  // partition explains it and reports nothing unmatched; handed no entry, it leaves it unexplained.
  const asReportRows: ReportRow[] = [];
  for (const row of violations) {
    asReportRows.push({ ...row, locale: 'control', viewport: 360, route: '/diary', landed: '/diary' });
  }
  const first = asReportRows[0];
  expect(
    partitionHard({ rows: asReportRows, known: [] }).unexplained.length,
    'with no frozen entry both control rows are unexplained',
  ).toBe(2);
  const frozen: KnownHardResidue = {
    locale: 'control',
    viewport: 360,
    route: '/diary',
    role: first.role ?? 'header-title',
    why: 'control',
  };
  const withEntry = partitionHard({ rows: asReportRows, known: [frozen] });
  expect(withEntry.explained.length, 'a matching entry explains its row').toBe(1);
  expect(withEntry.unexplained.length, 'and leaves the other one').toBe(1);
  expect(
    partitionHard({ rows: [], known: [frozen] }).unmatched,
    'an entry no row matches is reported, so a fixed row is noticed',
  ).toEqual([frozen]);

  // The real chrome beside them is clean: the claim is not simply "everything fails".
  expect(hardViolations(realRows), 'the real header title and tab labels must not be flagged').toEqual([]);

  // The report path carries a finding: written to the file, read back from the file.
  const controlReportRows: ReportRow[] = [];
  for (const row of controlRows) {
    controlReportRows.push({ ...row, locale: 'control', viewport: 360, route: '/diary', landed: '/diary' });
  }
  writeReport({ controls: controlReportRows });
  const written = readReport().controls;
  expect(
    written.some((row) => row.role === null && row.text.startsWith('illl') && row.kind === 'newly-clipped'),
    'the known overflow must be in the report file',
  ).toBe(true);
});
