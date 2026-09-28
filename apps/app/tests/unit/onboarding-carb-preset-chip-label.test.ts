/**
 * Unit test for `#app/routes/onboarding`'s `carbPresetChipLabel` — folds a
 * preset's gram ceiling into its chip text, so "Keto"/"Low-carb"/"Moderate"
 * are never shown as bare, unexplained names a first-run visitor has to guess
 * at before picking one.
 *
 * Since M129/05 the copy lives in the i18n catalog and the function takes a
 * `t` explicitly, so this drives it with a fake catalog rather than reaching
 * for the i18next singleton — the assertions are still about the English text
 * a user actually sees.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { carbPresetChipLabel } from '../../app/routes/onboarding';
import { CARB_PRESETS, type Translate } from '../../app/lib/onboarding';

/** The English values of exactly the keys this function reaches for. */
const CATALOG = new Map([
  ['onboarding.carbPreset.keto.label', 'Keto'],
  ['onboarding.carbPreset.lowCarb.label', 'Low-carb'],
  ['onboarding.carbPreset.moderate.label', 'Moderate'],
  ['onboarding.carbPreset.later.label', 'Decide later'],
  ['onboarding.carbPreset.chipWithCeiling', '{{label}} — under {{ceiling}} g'],
]);

/** Minimal stand-in for i18next's `t`: catalog lookup plus `{{name}}` interpolation. */
const t: Translate = (key, params) => {
  const template = CATALOG.get(key);
  if (template === undefined) throw new Error(`Unexpected translation key: ${key}`);
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params[name]));
};

function presetById(id: string) {
  const preset = CARB_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`No preset with id ${id}`);
  return preset;
}

describe('carbPresetChipLabel', () => {
  it('folds the gram ceiling into the chip text for a numeric preset', () => {
    assert.equal(carbPresetChipLabel(presetById('keto'), t), 'Keto — under 20 g');
  });

  it('does so for every numeric preset, not just one', () => {
    assert.equal(carbPresetChipLabel(presetById('low-carb'), t), 'Low-carb — under 50 g');
    assert.equal(carbPresetChipLabel(presetById('moderate'), t), 'Moderate — under 100 g');
  });

  it('leaves the "decide later" preset as its plain label — it has no number to show', () => {
    assert.equal(carbPresetChipLabel(presetById('later'), t), 'Decide later');
  });
});
