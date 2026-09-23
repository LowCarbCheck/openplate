/**
 * The shipped catalogs, read off disk at test time.
 *
 * NO SPEC PINS A SENTENCE. Copy in this repository is owned by the wordsmith
 * pass and is rephrased whenever it reads badly; a test that transcribed
 * "The question closed, or your browser never asked it." would go red on an
 * improvement rather than on a defect. So every spec asks this module for the
 * key it cares about and compares the page against whatever the bundle says
 * today.
 *
 * PARSED BY ZOD RATHER THAN ASSERTED. The schema names exactly the keys this
 * tier reads, so a renamed or deleted key fails here, on load, with the path
 * that moved, instead of surfacing later as an assertion against `undefined`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const catalogSchema = z.object({
  chrome: z.object({
    logoMenuLabel: z.string(),
    terms: z.string(),
    status: z.object({ dismiss: z.string() }),
  }),
  nav: z.object({
    trends: z.string(),
  }),
  welcome: z.object({
    start: z.string(),
    startFresh: z.string(),
  }),
  onboarding: z.object({
    actions: z.object({ continue: z.string(), skip: z.string() }),
    style: z.object({ title: z.string() }),
    step: z.object({
      weight: z.object({ title: z.string() }),
      body: z.object({ title: z.string() }),
      firstFood: z.object({ title: z.string() }),
    }),
    firstFood: z.object({ later: z.string() }),
  }),
  add: z.object({
    manual: z.object({
      title: z.string(),
      name: z.string(),
      grams: z.string(),
      submit: z.string(),
      nutritionToggle: z.string(),
    }),
    errors: z.object({ nameRequired: z.string() }),
    custom: z.object({ editAria: z.string(), removeAria: z.string() }),
    search: z.object({ addManually: z.string() }),
    portion: z.object({ submit: z.string() }),
    meal: z.object({
      breakfast: z.string(),
      lunch: z.string(),
      dinner: z.string(),
      snack: z.string(),
    }),
  }),
  bodyMetrics: z.object({ save: z.string(), sex: z.object({ male: z.string() }) }),
  launcher: z.object({
    moreOptions: z.string(),
    photo: z.string(),
  }),
  entry: z.object({
    action: z.object({ delete: z.string(), logAgain: z.string() }),
    toast: z.object({ removed: z.string(), undo: z.string() }),
    edit: z.object({ save: z.string() }),
  }),
  aiIntake: z.object({ plansLink: z.string() }),
  scan: z.object({
    errors: z.object({ titles: z.object({ allowanceExpired: z.string() }) }),
    review: z.object({
      heading: z.string(),
      fromLabel: z.string(),
      foodDbUnavailable: z.string(),
      netCarbsForPortion: z.string(),
      confirmAndLog: z.string(),
      match: z.object({ useThisData: z.string() }),
      fineTune: z.string(),
      sanity: z.object({
        componentOverTotal: z.string(),
        macro: z.object({ carbs: z.string(), fiber: z.string() }),
      }),
    }),
  }),
  pantry: z.object({
    door: z.object({ title: z.string() }),
    review: z.object({
      title: z.string(),
      removeAria: z.string(),
      confirm: z.string(),
      saveList: z.string(),
    }),
    recipes: z.object({ link: z.string() }),
  }),
  recipes: z.object({
    servingsEaten: z.object({ increase: z.string(), logOf: z.string() }),
    macros: z.object({ ofLeft: z.string() }),
  }),
  portions: z.object({
    unit: z.object({ serving_other: z.string() }),
  }),
  diary: z.object({
    netCarbsValue: z.string(),
    meals: z.object({ breakfast: z.string(), dinner: z.string() }),
    copy: z.object({ door: z.string(), title: z.string() }),
    saveMeal: z.object({
      trigger: z.string(),
      namePlaceholder: z.string(),
      save: z.string(),
      hint: z.object({ title: z.string(), dismiss: z.string() }),
    }),
    budget: z.object({ leadNoTarget: z.string() }),
  }),
  trends: z.object({
    slot: z.object({ all: z.string() }),
    range: z.object({ threeMonths: z.string(), month: z.string(), week: z.string() }),
    metric: z.object({ protein: z.string(), fat: z.string(), calories: z.string() }),
    streak: z.object({ active_one: z.string(), empty: z.string() }),
    tabs: z.object({ overview: z.string(), nutrition: z.string(), meals: z.string(), goals: z.string() }),
    grid: z.object({ titleActivity: z.string() }),
    meals: z.object({
      averages: z.object({ loggedDays: z.string() }),
    }),
    goals: z.object({ invite: z.string(), hitRate: z.string(), honesty: z.string() }),
    overview: z.object({ openInsights: z.string() }),
    controls: z.object({ metricGroup: z.string(), rangeGroup: z.string(), slotGroup: z.string() }),
    weight: z.object({ singleEntry: z.string(), title: z.string() }),
  }),
  dashboard: z.object({
    insightsHint: z.object({ title: z.string() }),
    week: z.object({ title: z.string() }),
  }),
  meals: z.object({ logNow: z.string(), removeAria: z.string() }),
  plan: z.object({
    countdown: z.object({ daysLeft_other: z.string(), lastDay: z.string(), action: z.string() }),
    offer: z.object({ from: z.string() }),
    recap: z.object({ meals_one: z.string() }),
    manage: z.string(),
    returned: z.object({ success: z.string() }),
    card: z.object({
      name: z.object({ month: z.string(), year: z.string() }),
      yearThenMonthly: z.string(),
      orderYearly: z.string(),
      switchBooked: z.string(),
    }),
    order: z.object({
      failed: z.string(),
      stale: z.string(),
      alreadySubscribed: z.string(),
      unavailable: z.string(),
    }),
    choice: z.object({
      legend: z.string(),
      monthlyEquivalent: z.string(),
      saving: z.string(),
      pickFirst: z.string(),
      interval: z.object({ month: z.string(), year: z.string() }),
    }),
  }),
  catchUp: z.object({ yesterdayHeading: z.string() }),
  describe: z.object({ title: z.string() }),
  goals: z.object({ save: z.string() }),
  awards: z.object({
    title: z.string(),
    hide: z.string(),
    note: z.string(),
    explorer: z.object({
      log: z.object({ food: z.object({ title: z.string(), note: z.string() }) }),
    }),
  }),
  usual: z.object({
    title: z.object({ breakfast: z.string(), dinner: z.string() }),
    confirm: z.object({ portionLabel: z.string(), decrease: z.string(), increase: z.string(), add: z.string() }),
    toast: z.object({ logged_one: z.string() }),
  }),
  settingsAi: z.object({
    advanced: z.object({ toggle: z.string(), openaiCompatibleOption: z.string() }),
    save: z.object({ settings: z.string() }),
    foodDb: z.object({ label: z.string() }),
  }),
  settings: z.object({
    notifications: z.object({
      master: z.string(),
      state: z.object({
        unsupported: z.string(),
        needsInstall: z.string(),
        blocked: z.string(),
        serverOff: z.string(),
        dismissed: z.string(),
        dismissedAgain: z.string(),
        signedOut: z.string(),
        ready: z.string(),
      }),
      toast: z.object({ on: z.string() }),
    }),
    mainGoal: z.object({ save: z.string(), saved: z.string() }),
  }),
  sync: z.object({
    emailLabel: z.string(),
    passphraseLabel: z.string(),
    signIn: z.object({ submit: z.string() }),
  }),
  signOut: z.object({ confirm: z.string() }),
});

/** Every string this tier reads, in one language, validated against that language's shipped bundle. */
export type Copy = z.infer<typeof catalogSchema>;

/**
 * The catalog of one language. The locale walks (M230) drive the same flows in
 * every language the app ships, so a delete button is found by what the
 * French bundle calls it, never by its English name.
 *
 * @param locale - one of `SUPPORTED_LANGUAGES`.
 */
export function catalogFor(locale: string): Copy {
  return catalogSchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), `app/i18n/locales/${locale}/common.json`), 'utf8')),
  );
}

/** Every English string this tier reads, validated against the shipped bundle. */
export const EN = catalogFor('en');

/**
 * A catalog sentence with its `{{placeholders}}` filled, the way i18next would.
 *
 * Only the interpolation, because that is all these specs need: no plurals, no
 * nesting and no formatting. A placeholder with no value is left standing, so
 * a forgotten one shows up in the failure message rather than becoming an
 * empty string that matches everything.
 *
 * @param sentence - the catalog value.
 * @param values - one entry per `{{name}}` in it.
 * @returns the interpolated sentence.
 */
export function fill(sentence: string, values: Readonly<Record<string, string>>): string {
  return sentence.replaceAll(/\{\{(\w+)\}\}/gu, (whole, name: string) => values[name] ?? whole);
}
