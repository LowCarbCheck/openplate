/**
 * The English catalog, read off disk at test time.
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
    }),
    search: z.object({ addManually: z.string() }),
  }),
  entry: z.object({
    action: z.object({ delete: z.string() }),
    toast: z.object({ removed: z.string(), undo: z.string() }),
  }),
  scan: z.object({
    review: z.object({
      heading: z.string(),
      fromLabel: z.string(),
      netCarbsForPortion: z.string(),
      confirmAndLog: z.string(),
    }),
  }),
  diary: z.object({
    netCarbsValue: z.string(),
  }),
  settingsAi: z.object({
    advanced: z.object({ toggle: z.string(), openaiCompatibleOption: z.string() }),
    save: z.object({ settings: z.string() }),
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
  }),
  sync: z.object({
    emailLabel: z.string(),
    passphraseLabel: z.string(),
    signIn: z.object({ submit: z.string() }),
  }),
});

/** Every English string this tier reads, validated against the shipped bundle. */
export const EN = catalogSchema.parse(
  JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')),
);

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
