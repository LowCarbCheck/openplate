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
  parseTrackingFocus,
  carbCeilingForPreset,
  presetIdForCeiling,
  parseKcalTarget,
  parseWeightKg,
  resolveOnboardingTimezone,
  resolveExitDestination,
  validateWeightStep,
  hasWeightStepErrors,
  WEIGHT_NOT_A_NUMBER_KEY,
} from '../../app/lib/onboarding';

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

describe('parseTrackingFocus', () => {
  it('accepts the three valid focuses', () => {
    assert.equal(parseTrackingFocus('net-carbs'), 'net-carbs');
    assert.equal(parseTrackingFocus('calories'), 'calories');
    assert.equal(parseTrackingFocus('habit'), 'habit');
  });

  it('returns null for anything unrecognized', () => {
    assert.equal(parseTrackingFocus('protein'), null);
    assert.equal(parseTrackingFocus(''), null);
    assert.equal(parseTrackingFocus(null), null);
    assert.equal(parseTrackingFocus(undefined), null);
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
