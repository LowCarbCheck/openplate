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
 * the bottom bar's tab labels. Everything else is listed, never asserted.
 *
 * THE HEADER TITLE MUST FIT, FULL STOP (operator, 2026-09-22). It is 18 px and the size is fixed
 * (`HEADER_TITLE_PX`), so the title each route really draws must have `scrollWidth <= clientWidth`
 * at 360 and 390 px, with no comparison to Inter. A title that does not fit is a defect in its
 * string. The strings that did not fit on the day the size changed are listed in
 * `header-title-fit.ts`, and that list only shrinks: an overflow it does not name fails, and a
 * named route whose title now fits fails too. At 320 px, which only the full matrix reads, the
 * title is reported and not asserted: 360 px is the narrowest screen the app promises to fit.
 * `lcc-lineage-header-title.spec.ts` holds the same rule for every title string in all six
 * languages without visiting a route; this sweep is the check that the title a route draws is one
 * of those strings, in the real page.
 *
 * THE TAB LABELS ARE STILL HELD AGAINST INTER. A label fails the run when it is newly clipped, or
 * wraps onto a second line, in Victor Mono and not in Inter.
 *
 * HOW THE TWO FACES ARE COMPARED. `clip-baseline.ts` injects the Inter stack at runtime and
 * explains why that is one custom property. It reads the same DOM twice, so the only thing that
 * changed between the reads is the face.
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
 * ── TWO MATRICES, AND HOW TO RUN THE WIDE ONE ──
 * The full sweep is six languages at three widths: 738 page reads, about eight minutes, on a
 * browser tier that otherwise takes under three. That is the wrong price to pay on every push, so
 * the DEFAULT matrix is German and Turkish, the widest language and the one with its own font file,
 * at 360 and 390 px, the width the app promises and the width it is designed at: about two minutes.
 * The full matrix runs on demand, and is what a font or a title size change must be judged by:
 *
 *     LCC_CLIP_SWEEP=full pnpm exec playwright test tests/e2e/lcc-lineage-clip-sweep.spec.ts
 *
 * Nothing is weakened by the narrower default. Every route is still read, both faces are still
 * compared, and both hard claims still fail the run. What changes is only how many languages and
 * widths the claims are made ABOUT, and `KNOWN_TITLE_OVERFLOWS` is filtered to the matrix in play,
 * so an entry outside it is neither expected nor missed. An entry naming a route this sweep never
 * requests could never be matched here, and a test below fails on it.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ──
 * A sweep that found nothing would look exactly like a sweep that could not see. The control test
 * injects three elements known to clip in mono and not in Inter (an ordinary box, a bottom bar
 * label and an app header title), reads them through the SAME reader, and requires all three to be
 * listed, the tab label to trip the comparison, the title to trip the fit rule, and the real
 * chrome beside them to stay clean. It then writes them into the report and reads the report back, so the
 * file path is shown able to carry a finding. It runs at 360 px, which is in both matrices, so the
 * proof that the reader can see is paid for in both modes.
 *
 * A SECOND CONTROL COVERS THE PLACEHOLDER READ (M243 spec 05b). A hint may be styled at a size of
 * its own, so the reader measures the pseudo-element rather than the field, and the control places
 * two fields: one whose hint is drawn smaller than its field and fits, which must be reported as
 * clean, and one whose hint is drawn larger and does not fit, which must still be reported as
 * clipped. Neither claim can be satisfied by a reader that simply reads the field.
 *
 * NO SERVICE WORKER IS BLOCKED here: the sweep walks the app the way a person meets it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import type { LanguageCode } from '../../app/i18n/language-prefs';
import { BODY_STACK, HEADER_TITLE_FIT_WIDTHS_PX, PROSE_STACK } from '../design-contract';
import {
  clipRowSchema,
  compareClips,
  hardViolations,
  headerTitleOverflows,
  injectClipControls,
  readBothFaces,
  readClips,
  settleFonts,
  waitForQuiet,
  type ClipRead,
} from './clip-baseline';
import { completeOnboarding, logFoodManually, useLanguage } from './helpers';
import {
  KNOWN_TITLE_OVERFLOWS,
  partitionKnownOverflows,
  routeMatches,
  type KnownTitleOverflow,
} from './header-title-fit';

/**
 * All six shipped languages, the matrix `LCC_CLIP_SWEEP=full` sweeps. German is the widest and
 * Turkish the second, with a second font file.
 */
const FULL_LOCALES = ['de', 'tr', 'en', 'es', 'fr', 'it'] as const satisfies readonly LanguageCode[];

/** The three phone widths: the narrowest a person owns, the narrowest the app promises, and the design width. */
const FULL_WIDTHS = [320, 360, 390] as const;

/** The two languages the default matrix reads: the widest, and the one with its own font file. */
const DEFAULT_LOCALES = ['de', 'tr'] as const satisfies readonly LanguageCode[];

/** The two widths the default matrix reads: the width the app promises, and the width it is designed at. */
const DEFAULT_WIDTHS = [360, 390] as const;

/** Whether the operator asked for all six languages at all three widths. See the header. */
const IS_FULL_SWEEP = process.env.LCC_CLIP_SWEEP === 'full';

/** The languages this run reads. */
const LOCALES: readonly LanguageCode[] = IS_FULL_SWEEP ? FULL_LOCALES : DEFAULT_LOCALES;

/** The widths this run reads. */
const WIDTHS: readonly number[] = IS_FULL_SWEEP ? FULL_WIDTHS : DEFAULT_WIDTHS;

/** A generous height, so width is the only thing under test. */
const PHONE_HEIGHT = 844;

/** Where the operator reads the result. */
const REPORT_PATH = resolve(process.cwd(), 'test-results/lcc-lineage-clip-report.json');

/** One locale's sweep: 11 public and 30 personal routes, at every width in the matrix, read twice. */
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
  '/add/search',
  '/add/photo',
  '/add/describe',
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

/** The route pattern of a food's own page, which the sweep reaches by tapping a diary row. */
const ENTRY_ROUTE = '/diary/entry/:id';

/** Every path this sweep requests, as patterns, so a list entry can be checked against it. */
const SWEPT_ROUTES: readonly string[] = [...PUBLIC_ROUTES, ...APP_ROUTES, ENTRY_ROUTE];

/** A header title that does not fit, where the sweep found it. */
interface TitleOverflow {
  locale: string;
  viewport: number;
  route: string;
  text: string;
  scrollWidth: number;
  clientWidth: number;
}

/** One list entry, expanded to one route at one width, which is the unit the sweep can observe. */
interface ExpectedTitleOverflow {
  locale: string;
  titleKey: string;
  route: string;
  viewport: number;
}

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
  /** Tab label rows that got worse than in Inter: the comparative hard claim. */
  hard: ReportRow[];
  /** Header titles that do not fit, at the widths the fit rule holds: the absolute hard claim. */
  titleOverflows: TitleOverflow[];
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

/**
 * The list entries this run can actually observe: the ones in the language being swept, at a
 * width the matrix in play reads, one per route the entry names. Filtering is what lets the
 * default matrix keep the `stale` claim honest, instead of demanding a row from a width or a
 * language it never visited.
 *
 * @param options.known - every list entry.
 * @param options.locale - the language being swept.
 * @param options.widths - the widths this run reads.
 * @returns one expected overflow per route and width.
 */
function titleOverflowsInMatrix({
  known,
  locale,
  widths,
}: {
  known: readonly KnownTitleOverflow[];
  locale: string;
  widths: readonly number[];
}): ExpectedTitleOverflow[] {
  const expected: ExpectedTitleOverflow[] = [];
  for (const entry of known) {
    if (entry.locale !== locale) continue;
    for (const viewport of entry.viewports) {
      if (!widths.includes(viewport)) continue;
      for (const route of entry.routes) expected.push({ locale, titleKey: entry.titleKey, route, viewport });
    }
  }
  return expected;
}

/**
 * Whether a found overflow is the place an expected one names.
 *
 * @param finding - a title the sweep found overflowing.
 * @param entry - one expanded list entry.
 * @returns true for the same language, width and route.
 */
function isExpectedOverflow(finding: TitleOverflow, entry: ExpectedTitleOverflow): boolean {
  return (
    finding.locale === entry.locale &&
    finding.viewport === entry.viewport &&
    routeMatches({ pattern: entry.route, path: finding.route })
  );
}

/** Whether the fit rule holds at a width: 360 and 390, never 320. */
function isFitWidth(width: number): boolean {
  return HEADER_TITLE_FIT_WIDTHS_PX.some((fit) => fit === width);
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
      if (isFitWidth(width)) {
        for (const reading of headerTitleOverflows(mono)) {
          into.titleOverflows.push({
            locale,
            viewport: width,
            route,
            text: reading.text,
            scrollWidth: reading.scrollWidth,
            clientWidth: reading.clientWidth,
          });
        }
      }
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

test('the matrix is the two-language default unless LCC_CLIP_SWEEP=full, and the title list is filtered to it', () => {
  // WHAT THIS RUN IS READING. Named out loud, so a report of "nothing clipped" is read against the
  // matrix that produced it and not against the full one.
  if (IS_FULL_SWEEP) {
    expect(LOCALES, 'the full sweep reads all six languages').toEqual([...FULL_LOCALES]);
    expect(WIDTHS, 'the full sweep reads all three widths').toEqual([...FULL_WIDTHS]);
  } else {
    expect(LOCALES, 'the default sweep reads German and Turkish').toEqual(['de', 'tr']);
    expect(WIDTHS, 'the default sweep reads 360 and 390').toEqual([360, 390]);
  }
  // Both matrices hold the width the control test injects at, and both widths the fit rule holds.
  expect(WIDTHS, 'the control test injects at 360, so both matrices must read it').toContain(360);
  for (const fit of HEADER_TITLE_FIT_WIDTHS_PX) {
    expect(WIDTHS, `the header title must fit at ${fit}px, so both matrices must read it`).toContain(fit);
  }

  // An entry must name a route this sweep requests, or the sweep can never match it and never
  // notice the day it is fixed.
  for (const entry of KNOWN_TITLE_OVERFLOWS) {
    for (const route of entry.routes) {
      expect(
        SWEPT_ROUTES.some((swept) => routeMatches({ pattern: route, path: swept })),
        `${entry.locale} ${entry.titleKey}: ${route} must be a route this sweep requests`,
      ).toBe(true);
    }
  }

  // CONTROL: the filter really drops what this run cannot see.
  const italian: KnownTitleOverflow = {
    locale: 'it',
    titleKey: 'catchUp.title',
    routes: ['/catch-up'],
    viewports: [360, 390],
  };
  expect(
    titleOverflowsInMatrix({ known: [italian], locale: 'de', widths: FULL_WIDTHS }),
    'an Italian entry is not expected by a German run',
  ).toEqual([]);
  expect(
    titleOverflowsInMatrix({ known: [italian], locale: 'it', widths: [320] }),
    'nor by a run that reads only 320 px',
  ).toEqual([]);
  expect(
    titleOverflowsInMatrix({ known: [italian], locale: 'it', widths: DEFAULT_WIDTHS }),
    'and it IS expected, once per width, by an Italian run at 360 and 390',
  ).toEqual([
    { locale: 'it', titleKey: 'catchUp.title', route: '/catch-up', viewport: 360 },
    { locale: 'it', titleKey: 'catchUp.title', route: '/catch-up', viewport: 390 },
  ]);
  expect(routeMatches({ pattern: ENTRY_ROUTE, path: '/diary/entry/abc' }), 'a :id matches one segment').toBe(true);
  expect(routeMatches({ pattern: ENTRY_ROUTE, path: '/diary' }), 'and not a shorter path').toBe(false);
});

for (const locale of LOCALES) {
  test(`every header title fits and the wider face clips no tab label, ${locale} at ${WIDTHS.join(' and ')}`, async ({
    page,
  }) => {
    test.setTimeout(SWEEP_TIMEOUT_MS);
    const result: SweepResult = {
      rows: [],
      hard: [],
      titleOverflows: [],
      pagesRead: 0,
      titlesRead: 0,
      tabLabelsRead: 0,
      badHosts: [],
    };

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
    const labels = result.hard.map(
      (row) =>
        `${row.route} at ${row.viewport}px: ${row.role} "${row.text}" ${row.kind}, mono clips ${row.mono.clip}px on ${row.mono.lines} line(s), Inter ${row.inter.clip}px on ${row.inter.lines}`,
    );
    expect(labels, `${locale}: a bottom bar label is newly clipped in Victor Mono`).toEqual([]);

    const titles = partitionKnownOverflows({
      found: result.titleOverflows,
      known: titleOverflowsInMatrix({ known: KNOWN_TITLE_OVERFLOWS, locale, widths: WIDTHS }),
      isMatch: isExpectedOverflow,
    });
    expect(
      titles.unexplained.map(
        (row) =>
          `${row.route} at ${row.viewport}px: "${row.text}" overflows ${row.scrollWidth - row.clientWidth}px of a ${row.clientWidth}px slot`,
      ),
      `${locale}: a header page title does not fit at 18px; shorten the string, never the size`,
    ).toEqual([]);
    expect(
      titles.stale.map((listed) => `${listed.route} at ${listed.viewport}px: ${listed.titleKey} fits now`),
      `${locale}: a listed title fits now, so delete it from KNOWN_TITLE_OVERFLOWS`,
    ).toEqual([]);
  });
}

test('CONTROL: the sweep lists a known overflow, and the hard claims fail on a title that does not fit and a clipped tab label', async ({
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

  // The tab label control trips the comparison, and nothing else does.
  const violations = hardViolations(rows);
  expect(
    violations.map((row) => row.role),
    'the comparative claim must flag the clipped tab label, and nothing else',
  ).toEqual(['tab-label']);
  expect(violations[0]?.text.startsWith('illl'), 'and the flagged row must be the injected control').toBe(true);

  // The title control trips the fit rule, and the real header title beside it does not.
  const overflowing = headerTitleOverflows(mono);
  expect(
    overflowing.map((reading) => reading.text.startsWith('illl')),
    'the fit rule must flag the injected title, and only it',
  ).toEqual([true]);

  // The list fails in both directions: with no entry the title overflow is unexplained, with a
  // matching entry it is explained, and an entry no overflow matches is stale.
  const found: TitleOverflow[] = overflowing.map((reading) => ({
    locale: 'control',
    viewport: 360,
    route: '/diary',
    text: reading.text,
    scrollWidth: reading.scrollWidth,
    clientWidth: reading.clientWidth,
  }));
  const entry: ExpectedTitleOverflow = { locale: 'control', titleKey: 'control', route: '/diary', viewport: 360 };
  expect(
    partitionKnownOverflows({ found, known: [], isMatch: isExpectedOverflow }).unexplained.length,
    'with no entry the control title is unexplained',
  ).toBe(1);
  const withEntry = partitionKnownOverflows({ found, known: [entry], isMatch: isExpectedOverflow });
  expect(withEntry.unexplained, 'a matching entry explains it').toEqual([]);
  expect(withEntry.stale, 'and is not stale while the title overflows').toEqual([]);
  expect(
    partitionKnownOverflows({ found: [], known: [entry], isMatch: isExpectedOverflow }).stale,
    'an entry no overflow matches is stale, so a shortened string is noticed',
  ).toEqual([entry]);

  // The real chrome beside them is clean: the claim is not simply "everything fails".
  expect(hardViolations(realRows), 'the real tab labels must not be flagged').toEqual([]);

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

/** The two placeholder controls: the text, and how the pseudo-element is sized against the field. */
const PLACEHOLDER_CONTROLS = {
  /** A hint drawn SMALLER than the field. Read in the field's size it would look clipped; it is not. */
  smaller: { id: 'lcc-ph-smaller', text: 'CONTROL smaller hint', fieldPx: 20, hintPx: 10, boxFactor: 0.7 },
  /** A hint drawn LARGER than the field. Read in the field's size it would look fine; it is clipped. */
  larger: { id: 'lcc-ph-larger', text: 'CONTROL larger hint', fieldPx: 20, hintPx: 28, boxFactor: 1.1 },
} as const;

test('CONTROL: a placeholder is measured in the placeholder font, and still goes red when it is too wide', async ({
  page,
}) => {
  // A PUBLIC PAGE, because this claim is about the reader and not about a screen. `/welcome` is
  // the cheapest page in the app that a device with no diary is allowed to see.
  await page.setViewportSize({ width: 390, height: PHONE_HEIGHT });
  await page.goto('/welcome');
  await waitForQuiet(page);
  await settleFonts(page);

  const geometry = await page.evaluate((controls) => {
    const style = document.createElement('style');
    style.textContent = Object.values(controls)
      .map((control) => `#${control.id}::placeholder { font-size: ${control.hintPx}px; }`)
      .join('\n');
    document.head.append(style);

    const measured: { id: string; boxWidth: number; atField: number; atHint: number }[] = [];
    for (const control of Object.values(controls)) {
      const probe = document.createElement('span');
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-size:${control.fieldPx}px`;
      probe.textContent = control.text;
      document.body.append(probe);
      const atField = probe.getBoundingClientRect().width;
      probe.remove();
      const atHint = (atField / control.fieldPx) * control.hintPx;

      const field = document.createElement('input');
      field.id = control.id;
      field.type = 'text';
      field.placeholder = control.text;
      const boxWidth = Math.round(atField * control.boxFactor);
      field.style.cssText =
        `position:absolute;left:0;top:0;width:${boxWidth}px;height:30px;padding:0;border:0;` +
        `font-size:${control.fieldPx}px;`;
      document.body.append(field);
      measured.push({ id: control.id, boxWidth, atField: Math.round(atField), atHint: Math.round(atHint) });
    }
    return measured;
  }, PLACEHOLDER_CONTROLS);

  // The two controls are only controls if the two sizes really straddle the box. Stated before
  // anything is read, so a control that had stopped separating the sizes fails here and not later
  // as a confusing assertion about a clip.
  const smaller = geometry.find((entry) => entry.id === PLACEHOLDER_CONTROLS.smaller.id);
  const larger = geometry.find((entry) => entry.id === PLACEHOLDER_CONTROLS.larger.id);
  expect(smaller, 'the smaller control must have been placed').toBeDefined();
  expect(larger, 'the larger control must have been placed').toBeDefined();
  expect(smaller?.atHint ?? 0, 'the small hint must fit its box').toBeLessThan(smaller?.boxWidth ?? 0);
  expect(smaller?.atField ?? 0, 'and would not fit if it were read at the field size').toBeGreaterThan(
    smaller?.boxWidth ?? 0,
  );
  expect(larger?.atField ?? 0, 'the large hint would fit if it were read at the field size').toBeLessThan(
    larger?.boxWidth ?? 0,
  );
  expect(larger?.atHint ?? 0, 'and does not fit at its own size').toBeGreaterThan(larger?.boxWidth ?? 0);

  const readings = await readClips(page);
  const readingFor = (text: string) =>
    readings.readings.find((reading) => reading.selector.endsWith('::placeholder') && reading.text === text);

  const small = readingFor(PLACEHOLDER_CONTROLS.smaller.text);
  expect(small, 'the smaller control must have been read').toBeDefined();
  expect(small?.clip, 'a hint drawn smaller than its field is not clipped, and must not be reported as clipped').toBe(
    0,
  );

  const big = readingFor(PLACEHOLDER_CONTROLS.larger.text);
  expect(big, 'the larger control must have been read').toBeDefined();
  expect(
    big?.clip ?? 0,
    'CONTROL: a hint drawn larger than its field IS clipped, and the reader must still say so',
  ).toBeGreaterThan(0);
});
