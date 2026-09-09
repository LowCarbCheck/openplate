/**
 * The form half of the eating style (M210 spec 05): the Conform/Zod schema the
 * settings card submits through, and the pure step from a parsed submission to
 * the patch the local store is given.
 *
 * `#app/lib/eating-style` owns the styles and the arithmetic. This module owns
 * only what a FORM adds: which answers a style makes mandatory, the copy for
 * the two answers it can be missing, and the mapping from field names to
 * `applyEatingStyle`'s input. Kept out of the route so both halves can be
 * exercised by `node:test` without a DOM, a fetcher or a store.
 *
 * Nothing here reads a clock, a store or the i18next singleton: the translation
 * lookup is threaded in, exactly as `body-metrics-schema.ts` threads it.
 */
import { z } from 'zod';
import { CARB_PRESETS as ONBOARDING_CARB_PRESETS, type CarbPreset } from '#app/lib/onboarding';
import {
  applyEatingStyle,
  EATING_STYLE_IDS,
  eatingStyle,
  type ApplyEatingStyleResult,
  type EatingStyleGoals,
  type EatingStyleId,
} from '#app/lib/eating-style';
import type { Translate } from '#app/lib/body-metrics-schema';

/**
 * The 20 / 50 / 100 g sub step, the onboarding table minus its "decide later"
 * row. A style that opens this step REQUIRES an answer, so an entry meaning
 * "no answer yet" would contradict the step it belongs to.
 *
 * Derived from the one table rather than re-listed, for the reason the goals
 * card's own filter records: two parallel preset tables drifted apart once
 * already.
 */
export const CARB_SUB_PRESETS: readonly (CarbPreset & { ceiling: number })[] = ONBOARDING_CARB_PRESETS.filter(
  (preset): preset is CarbPreset & { ceiling: number } => preset.ceiling !== null,
);

/**
 * Message for a carb style submitted with no ceiling picked.
 *
 * REUSED, not new: M210 shipped no `settings.style.errors.*` keys, and the
 * onboarding legend already asks this exact question in both locales. An
 * English-only new key would fail the i18n parity test.
 */
export const STYLE_CARB_REQUIRED_KEY = 'onboarding.carbPreset.legend';

/** Message for a kcal style submitted with no target. Reused for the same reason as above. */
export const STYLE_KCAL_REQUIRED_KEY = 'errors.notANumber';

/**
 * A goal number that may be absent from the submission entirely: the card only
 * renders the field the chosen style opens, so the other one never posts. An
 * empty string is the same as absent, because a rendered-but-untouched input
 * posts one.
 *
 * @param t - translation lookup for the message.
 * @returns a schema resolving to a positive number, or `null` when not given.
 */
function _optionalGoalNumber(t: Translate): z.ZodType<number | null> {
  return z.preprocess(
    (value) => {
      if (value === undefined || value === null) return null;
      const raw = z.string().safeParse(value);
      return raw.success && raw.data.trim() === '' ? null : value;
    },
    z.coerce.number().positive(t('goals.errors.positiveOrBlank')).nullable(),
  );
}

/**
 * The eating style card's schema. The style itself is always required; the two
 * numbers are required only for the styles that own them, which is the whole
 * reason this is a `superRefine` and not two `.min()` calls: "required" here is
 * a property of the OTHER field's value.
 *
 * @param t - translation lookup, resolved against the active language by the caller.
 * @returns the schema Conform validates and the action parses with.
 */
export function makeEatingStyleSchema(t: Translate) {
  return z
    .object({
      eatingStyle: z.enum(EATING_STYLE_IDS),
      carbPresetCeiling: _optionalGoalNumber(t),
      kcalTarget: _optionalGoalNumber(t),
    })
    .superRefine((value, ctx) => {
      const definition = eatingStyle(value.eatingStyle);
      if (definition.carbSubPreset && value.carbPresetCeiling === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['carbPresetCeiling'],
          message: t(STYLE_CARB_REQUIRED_KEY),
        });
      }
      if (definition.kcalMode === 'asked' && value.kcalTarget === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['kcalTarget'],
          message: t(STYLE_KCAL_REQUIRED_KEY),
        });
      }
    });
}

/** A parsed eating style submission: the pick, and the answers the pick made mandatory. */
export interface EatingStyleFormValues {
  eatingStyle: EatingStyleId;
  carbPresetCeiling: number | null;
  kcalTarget: number | null;
}

/** Everything the save needs beyond the submitted form: today's stored numbers and the two body figures. */
export interface EatingStyleSavePlanInput {
  values: EatingStyleFormValues;
  currentGoals: EatingStyleGoals;
  /** The latest logged weight, `null` when the person has never logged one. */
  latestWeightKg: number | null;
  /** The reference protein intake, `null` when there is no body data to compute one from. */
  referenceProteinFloorG: number | null;
}

/**
 * The submission turned into the patch to store. A one-call seam over
 * `applyEatingStyle` so the settings action stays glue: the route reads the
 * store and writes the store, and every decision about WHICH numbers survive a
 * style change is made here, where a test can reach it.
 *
 * @param input - the parsed submission plus the stored numbers and body figures.
 * @returns the patch to merge onto the profile, and whether a weight is missing.
 */
export function planEatingStyleSave(input: EatingStyleSavePlanInput): ApplyEatingStyleResult {
  const { values, currentGoals, latestWeightKg, referenceProteinFloorG } = input;
  return applyEatingStyle({
    style: values.eatingStyle,
    currentGoals,
    carbPresetCeiling: values.carbPresetCeiling,
    kcalTarget: values.kcalTarget,
    latestWeightKg,
    referenceProteinFloorG,
  });
}

/**
 * Whether the style being looked at needs a logged weight the person does not
 * have. The same condition `applyEatingStyle` reports after a save, evaluated
 * against the SELECTION so the card can say it before one, rather than letting
 * someone save and then learn their goal fell back to the reference.
 *
 * @param input - the style under consideration and the latest logged weight.
 * @returns true only for a weight-scaled style with no weight on file.
 */
export function styleNeedsWeight(input: { style: EatingStyleId; latestWeightKg: number | null }): boolean {
  return eatingStyle(input.style).proteinRule === 'g-per-kg' && input.latestWeightKg === null;
}
