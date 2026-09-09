/**
 * Unit tests for `#app/lib/onboarding` — the pure step/goal/parsing helpers
 * behind the `/onboarding` flow. No DB, no React, so these run under the
 * no-database convention (mirrors `user-days.test.ts`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ONBOARDING_STEPS,
  parseOnboardingStep,
  nextOnboardingStep,
  onboardingStepNumber,
  carbCeilingForPreset,
  presetIdForCeiling,
  parseKcalTarget,
  parseWeightKg,
  resolveOnboardingTimezone,
  resolveExitDestination,
  validateWeightStep,
  hasWeightStepErrors,
  initialCarbPresetSelection,
  initialStyleSelection,
  trackingFocusForPatch,
  validateStyleStep,
  CARB_PRESET_REQUIRED_KEY,
  KCAL_TARGET_REQUIRED_KEY,
  STYLE_CARB_PRESETS,
  STYLE_REQUIRED_KEY,
  WEIGHT_NOT_A_NUMBER_KEY,
} from '../../app/lib/onboarding';
import type { StyleStepInput } from '../../app/lib/onboarding';

describe('parseOnboardingStep', () => {
  it('returns the value when it is a known step', () => {
    assert.equal(parseOnboardingStep('weight'), 'weight');
    assert.equal(parseOnboardingStep('first-food'), 'first-food');
  });

  it('defaults to the first step for unknown, empty, or missing values', () => {
    assert.equal(parseOnboardingStep('bogus'), ONBOARDING_STEPS[0]);
    assert.equal(parseOnboardingStep(''), ONBOARDING_STEPS[0]);
    assert.equal(parseOnboardingStep(null), ONBOARDING_STEPS[0]);
    assert.equal(parseOnboardingStep(undefined), ONBOARDING_STEPS[0]);
  });
});

describe('nextOnboardingStep', () => {
  it('advances through the flow', () => {
    assert.equal(nextOnboardingStep('focus'), 'weight');
    // `body` (M135) sits between the weigh-in it reuses and the flow's exit.
    assert.equal(nextOnboardingStep('weight'), 'body');
    assert.equal(nextOnboardingStep('body'), 'first-food');
  });

  it('returns null at the final step', () => {
    assert.equal(nextOnboardingStep('first-food'), null);
  });
});

describe('onboardingStepNumber', () => {
  it('is a 1-based position in the flow', () => {
    assert.equal(onboardingStepNumber('focus'), 1);
    assert.equal(onboardingStepNumber('weight'), 2);
    assert.equal(onboardingStepNumber('body'), 3);
    assert.equal(onboardingStepNumber('first-food'), 4);
  });
});

describe('carbCeilingForPreset', () => {
  it('maps each preset id to its ceiling', () => {
    assert.equal(carbCeilingForPreset('keto'), 20);
    assert.equal(carbCeilingForPreset('low-carb'), 50);
    assert.equal(carbCeilingForPreset('moderate'), 100);
  });

  it('resolves "decide later" and unknown ids to null (no fabricated goal)', () => {
    assert.equal(carbCeilingForPreset('later'), null);
    assert.equal(carbCeilingForPreset('bogus'), null);
    assert.equal(carbCeilingForPreset(null), null);
    assert.equal(carbCeilingForPreset(undefined), null);
  });
});

describe('presetIdForCeiling', () => {
  it('round-trips a known ceiling back to its preset id', () => {
    assert.equal(presetIdForCeiling(20), 'keto');
    assert.equal(presetIdForCeiling(50), 'low-carb');
    assert.equal(presetIdForCeiling(100), 'moderate');
  });

  it('falls back to "later" for a null goal or an unmatched ceiling', () => {
    assert.equal(presetIdForCeiling(null), 'later');
    assert.equal(presetIdForCeiling(37), 'later');
  });
});

describe('parseKcalTarget', () => {
  it('parses a positive number, rounding to a whole kcal', () => {
    assert.equal(parseKcalTarget('2000'), 2000);
    assert.equal(parseKcalTarget('1800.4'), 1800);
    assert.equal(parseKcalTarget('1800.6'), 1801);
  });

  it('resolves blank, zero, negative, non-numeric, or out-of-range input to null', () => {
    assert.equal(parseKcalTarget(''), null);
    assert.equal(parseKcalTarget('   '), null);
    assert.equal(parseKcalTarget('0'), null);
    assert.equal(parseKcalTarget('-500'), null);
    assert.equal(parseKcalTarget('abc'), null);
    assert.equal(parseKcalTarget('100000'), null);
    assert.equal(parseKcalTarget(null), null);
  });
});

describe('parseWeightKg', () => {
  it('parses a positive weight, rounding to 2 decimals', () => {
    assert.equal(parseWeightKg('72'), 72);
    assert.equal(parseWeightKg('72.345'), 72.35);
    assert.equal(parseWeightKg('72.344'), 72.34);
  });

  it('resolves blank, zero, negative, non-numeric, or out-of-range input to null', () => {
    assert.equal(parseWeightKg(''), null);
    assert.equal(parseWeightKg('0'), null);
    assert.equal(parseWeightKg('-10'), null);
    assert.equal(parseWeightKg('heavy'), null);
    assert.equal(parseWeightKg('1000'), null);
    assert.equal(parseWeightKg(undefined), null);
  });

  it('accepts a decimal comma, and still rejects ambiguous comma usage', () => {
    assert.equal(parseWeightKg('72,5'), 72.5);
    assert.equal(parseWeightKg('1.234,5'), null);
    assert.equal(parseWeightKg('7,,5'), null);
  });
});

describe('validateWeightStep', () => {
  it('parses both fields, decimal comma included', () => {
    const submission = validateWeightStep({ currentWeightKg: '72,5', targetWeightKg: '68' });
    assert.deepEqual(submission.values, { currentWeightKg: 72.5, targetWeightKg: 68 });
    assert.deepEqual(submission.errors, {});
    assert.equal(hasWeightStepErrors(submission), false);
  });

  it('treats blank and missing fields as "skip", not as an error', () => {
    const submission = validateWeightStep({ currentWeightKg: '   ', targetWeightKg: null });
    assert.deepEqual(submission.values, { currentWeightKg: null, targetWeightKg: null });
    assert.equal(hasWeightStepErrors(submission), false);
  });

  it('errors on a field that was filled in but cannot be read', () => {
    const submission = validateWeightStep({ currentWeightKg: '1.234,5', targetWeightKg: '68' });
    assert.equal(submission.errors.currentWeightKg, WEIGHT_NOT_A_NUMBER_KEY);
    assert.equal(submission.errors.targetWeightKg, undefined);
    assert.equal(hasWeightStepErrors(submission), true);
    // Never saves a partial step behind an error.
    assert.equal(submission.values.currentWeightKg, null);
  });

  it('errors on a filled-in target weight too, and on out-of-range values', () => {
    const submission = validateWeightStep({ currentWeightKg: '72', targetWeightKg: 'sixty eight' });
    assert.equal(submission.errors.targetWeightKg, WEIGHT_NOT_A_NUMBER_KEY);
    assert.equal(hasWeightStepErrors(validateWeightStep({ currentWeightKg: '1000', targetWeightKg: '' })), true);
    assert.equal(hasWeightStepErrors(validateWeightStep({ currentWeightKg: '0', targetWeightKg: '' })), true);
  });
});

describe('resolveOnboardingTimezone', () => {
  it('keeps a valid IANA time zone', () => {
    assert.equal(resolveOnboardingTimezone('Europe/Berlin'), 'Europe/Berlin');
    assert.equal(resolveOnboardingTimezone('UTC'), 'UTC');
  });

  it('falls back to UTC for an invalid, empty, or missing zone', () => {
    assert.equal(resolveOnboardingTimezone('Mars/Olympus_Mons'), 'UTC');
    assert.equal(resolveOnboardingTimezone(''), 'UTC');
    assert.equal(resolveOnboardingTimezone(null), 'UTC');
    assert.equal(resolveOnboardingTimezone(undefined), 'UTC');
  });
});

describe('resolveExitDestination', () => {
  it('keeps an allowlisted in-app destination', () => {
    assert.equal(resolveExitDestination('/diary'), '/diary');
    assert.equal(resolveExitDestination('/add'), '/add');
    assert.equal(resolveExitDestination('/scan'), '/scan');
  });

  it('keeps the speak entry, which is the composer with its field focused', () => {
    assert.equal(resolveExitDestination('/describe?speak=1'), '/describe?speak=1');
    // A stored exit value from before M203 may still name the search screen
    // with the same flag. It must land there rather than be silently rewritten
    // to the diary; `/add` simply ignores the flag now.
    assert.equal(resolveExitDestination('/add?speak=1'), '/add?speak=1');
  });

  it('keeps the meal composer, which is where the type card now lands', () => {
    assert.equal(resolveExitDestination('/describe'), '/describe');
  });

  it('no longer allows the label scanner, because there is no second scanner', () => {
    // It was allowlisted for the ways-to-log lesson's third card until
    // 2026-09-08, when the two photo tasks merged (amends ADR-0005). A
    // destination that still resolved would send somebody to a mode nothing
    // reads, which is a dead URL that looks alive.
    assert.equal(resolveExitDestination('/scan?mode=label'), '/diary');
  });

  it('keeps the settings-connect exit (finishes onboarding, then returns to the diary)', () => {
    assert.equal(resolveExitDestination('/settings/ai?next=diary'), '/settings/ai?next=diary');
  });

  it('defaults to the diary for a missing or off-allowlist value (no open redirect)', () => {
    // The bare settings path is NOT allowlisted — only the `?next=diary` exit is.
    assert.equal(resolveExitDestination('/settings/ai'), '/diary');
    assert.equal(resolveExitDestination('https://evil.example'), '/diary');
    assert.equal(resolveExitDestination(null), '/diary');
    assert.equal(resolveExitDestination(undefined), '/diary');
  });
});

/**
 * The style step (M210). The old focus step submitted two independent
 * switches; it now submits one style, and the two follow-up answers that style
 * asks for. The suites below are the whole of that decision: what a submission
 * must carry, what the list starts on, and what `trackingFocus` is reduced to
 * afterwards.
 */

/** A blank submission: nothing picked, nothing typed, which is a first run. */
function blankStyleSubmission(overrides: Partial<StyleStepInput> = {}): StyleStepInput {
  return { style: null, carbPresetId: null, kcalTarget: null, ...overrides };
}

describe('validateStyleStep', () => {
  it('refuses a submission with no style at all, because nothing is preselected', () => {
    const result = validateStyleStep(blankStyleSubmission());
    assert.equal(result.ok, false);
    assert.deepEqual(result.ok === false ? result.errors : null, { style: STYLE_REQUIRED_KEY });
  });

  it('refuses a style string this build has never heard of', () => {
    const result = validateStyleStep(blankStyleSubmission({ style: 'paleo' }));
    assert.equal(result.ok, false);
  });

  // THE CARB RULE. A carb style with no ceiling is the state M210 removed: the
  // day would be graded by a carb lens with no number behind it, which is what
  // the deleted 50 g reference used to paper over.
  it('refuses a carb style with no sub preset', () => {
    for (const style of ['low-carb', 'low-carb-low-kcal']) {
      const result = validateStyleStep(blankStyleSubmission({ style, kcalTarget: '1800' }));
      assert.equal(result.ok, false, `${style} must not save without a ceiling`);
      assert.equal(result.ok === false ? result.errors.carbPreset : null, CARB_PRESET_REQUIRED_KEY);
    }
  });

  it('refuses "decide later" as a sub preset, since it is no longer on offer', () => {
    const result = validateStyleStep(blankStyleSubmission({ style: 'low-carb', carbPresetId: 'later' }));
    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.errors.carbPreset : null, CARB_PRESET_REQUIRED_KEY);
  });

  // THE KCAL RULE, the same failure on the other axis.
  it('refuses a kcal style with no target, blank or unreadable', () => {
    for (const style of ['low-kcal', 'low-carb-low-kcal']) {
      for (const raw of [null, '', '   ', 'abc', '0', '-100']) {
        const result = validateStyleStep(blankStyleSubmission({ style, carbPresetId: 'keto', kcalTarget: raw }));
        assert.equal(result.ok, false, `${style} must not save on kcal ${JSON.stringify(raw)}`);
        assert.equal(result.ok === false ? result.errors.kcalTarget : null, KCAL_TARGET_REQUIRED_KEY);
      }
    }
  });

  // THE CONTROL for both rules above: the two styles that ask for neither
  // number pass with neither given. Without this, a validator that simply
  // rejected everything would satisfy every assertion above.
  it('accepts high-protein and just-track with neither a preset nor a target', () => {
    for (const style of ['high-protein', 'just-track']) {
      const result = validateStyleStep(blankStyleSubmission({ style }));
      assert.equal(result.ok, true, `${style} asks for no number`);
      assert.deepEqual(result.ok === true ? result.values : null, {
        style,
        carbPresetCeiling: null,
        kcalTarget: null,
      });
    }
  });

  it('accepts a carb style once its ceiling is picked, and reads the grams off the chip', () => {
    const result = validateStyleStep(blankStyleSubmission({ style: 'low-carb', carbPresetId: 'keto' }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok === true ? result.values : null, {
      style: 'low-carb',
      carbPresetCeiling: 20,
      kcalTarget: null,
    });
  });

  it('accepts the style that asks for both, and carries both answers', () => {
    const result = validateStyleStep(
      blankStyleSubmission({ style: 'low-carb-low-kcal', carbPresetId: 'moderate', kcalTarget: '1800' }),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok === true ? result.values : null, {
      style: 'low-carb-low-kcal',
      carbPresetCeiling: 100,
      kcalTarget: 1800,
    });
  });

  it('ignores an answer the style never asked for, rather than storing it', () => {
    // Someone who picks a carb style, fills the kcal field, then switches to
    // low-carb: the field is no longer rendered, but a stale value could still
    // ride along. It must not become a target the style does not own.
    const result = validateStyleStep(
      blankStyleSubmission({ style: 'low-carb', carbPresetId: 'keto', kcalTarget: '1800' }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.ok === true ? result.values.kcalTarget : null, 1800);
    // `applyEatingStyle` is what drops it: the validator reports what was
    // submitted, the style decides what is stored. Proven in eating-style.test.ts.
  });
});

describe('STYLE_CARB_PRESETS', () => {
  it('is the three real ceilings, without "decide later"', () => {
    assert.deepEqual(
      STYLE_CARB_PRESETS.map((preset) => preset.ceiling),
      [20, 50, 100],
    );
    assert.equal(
      STYLE_CARB_PRESETS.some((preset) => preset.id === 'later'),
      false,
    );
  });
});

describe('initialStyleSelection', () => {
  // THE CONTROL THE SPEC NAMES: no item is preselected on a first render, and
  // a convenient default must not defeat it. `effectiveEatingStyle` answers
  // `just-track` for an empty profile, so returning its answer unconditionally
  // would tick a box nobody ticked.
  it('selects nothing for a device that has told us nothing', () => {
    assert.equal(
      initialStyleSelection({ goalNetCarbsCeilingG: null, goalKcalTarget: null, goalProteinFloorG: null }),
      null,
    );
    assert.equal(
      initialStyleSelection({
        goalNetCarbsCeilingG: null,
        goalKcalTarget: null,
        goalProteinFloorG: null,
        eatingStyle: null,
      }),
      null,
    );
  });

  it('selects the stored pick when there is one', () => {
    assert.equal(
      initialStyleSelection({
        goalNetCarbsCeilingG: null,
        goalKcalTarget: null,
        goalProteinFloorG: null,
        eatingStyle: 'just-track',
      }),
      'just-track',
    );
  });

  it('derives the pick from the numbers for a profile written before the style existed', () => {
    assert.equal(
      initialStyleSelection({ goalNetCarbsCeilingG: 20, goalKcalTarget: null, goalProteinFloorG: null }),
      'low-carb',
    );
    assert.equal(
      initialStyleSelection({ goalNetCarbsCeilingG: 20, goalKcalTarget: 1800, goalProteinFloorG: null }),
      'low-carb-low-kcal',
    );
    assert.equal(
      initialStyleSelection({ goalNetCarbsCeilingG: null, goalKcalTarget: 1800, goalProteinFloorG: null }),
      'low-kcal',
    );
    assert.equal(
      initialStyleSelection({ goalNetCarbsCeilingG: null, goalKcalTarget: null, goalProteinFloorG: 110 }),
      'high-protein',
    );
  });
});

describe('initialCarbPresetSelection', () => {
  it('ticks nothing when there is no stored ceiling', () => {
    assert.equal(initialCarbPresetSelection(null), null);
  });

  it('ticks nothing for a ceiling no chip carries, rather than an id no chip has', () => {
    // `presetIdForCeiling` answers `later` here, and `later` is not offered.
    assert.equal(presetIdForCeiling(37), 'later');
    assert.equal(initialCarbPresetSelection(37), null);
  });

  it('ticks the chip a returning person already has', () => {
    assert.equal(initialCarbPresetSelection(20), 'keto');
    assert.equal(initialCarbPresetSelection(50), 'low-carb');
    assert.equal(initialCarbPresetSelection(100), 'moderate');
  });
});

describe('trackingFocusForPatch', () => {
  // The rings are derived from the VALUES (`goal-rings.ts`), and the stored
  // focus has to agree with them, or an older build on another device draws a
  // hero for a goal this one just cleared.
  it('follows the numbers the style wrote', () => {
    assert.equal(trackingFocusForPatch({ goalNetCarbsCeilingG: 20, goalKcalTarget: null }), 'net-carbs');
    assert.equal(trackingFocusForPatch({ goalNetCarbsCeilingG: 20, goalKcalTarget: 1800 }), 'net-carbs');
    assert.equal(trackingFocusForPatch({ goalNetCarbsCeilingG: null, goalKcalTarget: 1800 }), 'calories');
  });

  it('falls to habit when the style keeps neither number, which is just-track', () => {
    assert.equal(trackingFocusForPatch({ goalNetCarbsCeilingG: null, goalKcalTarget: null }), 'habit');
  });
});
