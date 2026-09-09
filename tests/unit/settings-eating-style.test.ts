/**
 * THE EATING STYLE CARD on `/settings/goals` (M210 spec 05), and the note that
 * goes under it (spec 04).
 *
 * Three things are pinned here, and each one is a thing the card would get
 * quietly wrong rather than loudly:
 *
 * 1. **A style makes its own answer mandatory.** A carb style with no ceiling
 *    and a calorie style with no target both save "successfully" and leave the
 *    person with a lens graded against nothing. The schema refuses them, and
 *    only them: the other three styles submit with neither number.
 * 2. **A style change removes what it no longer owns.** Switching from low-carb
 *    to low-calorie must NULL the ceiling. A stale ceiling survives into every
 *    export, every sync blob and every later derivation, and the day would go
 *    on being graded against a goal the person believes they dropped. The
 *    control for it is in `planEatingStyleSave`: make it pass the stored
 *    ceiling through and the switch test fails.
 * 3. **A derived style is displayed, never written.** An account from before
 *    schema v20 has no stored `eatingStyle`; the card preselects the derived
 *    one, and the loader writes nothing.
 *
 * The card's own markup is proven through `EatingStylePicker`, which is
 * presentational for exactly this reason: `renderToStaticMarkup` can show that
 * the 20/50/100 step exists for the two carb styles and for no other, without a
 * DOM, a fetcher or a store (there is no jsdom in this repo).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import {
  CARB_SUB_PRESETS,
  makeEatingStyleSchema,
  planEatingStyleSave,
  styleNeedsWeight,
  type EatingStyleFormValues,
} from '../../app/lib/eating-style-form';
import {
  EATING_STYLE_IDS,
  effectiveEatingStyle,
  STYLE_CAUTION_SOURCE_URL,
  styleCaution,
  type EatingStyleGoals,
  type EatingStyleId,
} from '../../app/lib/eating-style';
import { EatingStyleCautionNote, EatingStylePicker } from '../../app/components/eating-style-picker';
import type { ReproductiveStatus } from '../../app/lib/local-store/schema';
import { eatingStyleCardKey, goalsCardKey, type GoalsCardValues } from '../../app/lib/goals-form-key';

/** The key itself, which is what the schema's messages are here: no copy is pinned. */
const identityT = (key: string): string => key;

const schema = makeEatingStyleSchema(identityT);

/** A submission as `FormData` hands it over: strings, and absent fields simply missing. */
function submit(fields: Record<string, string>) {
  return schema.safeParse(fields);
}

/** The stored numbers, all unset unless a case says otherwise. */
function goals(overrides: Partial<EatingStyleGoals> = {}): EatingStyleGoals {
  return {
    goalNetCarbsCeilingG: null,
    goalKcalTarget: null,
    goalProteinFloorG: null,
    eatingStyle: null,
    ...overrides,
  };
}

/** The paths of every issue a failed parse reported. */
function issuePaths(result: ReturnType<typeof submit>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

//////////////////////////////////////////////////////////////////////////////
// 1. What each style makes mandatory
//////////////////////////////////////////////////////////////////////////////

test('a carb style is refused without a ceiling, and accepted with one', () => {
  for (const style of ['low-carb', 'low-carb-low-kcal'] as const) {
    const withoutPreset = submit(
      style === 'low-carb' ? { eatingStyle: style } : { eatingStyle: style, kcalTarget: '1800' },
    );
    assert.equal(withoutPreset.success, false, `${style} must not save without a ceiling`);
    assert.deepEqual(issuePaths(withoutPreset), ['carbPresetCeiling']);
  }

  const accepted = submit({ eatingStyle: 'low-carb', carbPresetCeiling: '20' });
  assert.equal(accepted.success, true);
  assert.equal(accepted.success && accepted.data.carbPresetCeiling, 20);
});

test('a calorie style is refused without a target, and accepted with one', () => {
  const lowKcal = submit({ eatingStyle: 'low-kcal' });
  assert.equal(lowKcal.success, false);
  assert.deepEqual(issuePaths(lowKcal), ['kcalTarget']);

  const both = submit({ eatingStyle: 'low-carb-low-kcal', carbPresetCeiling: '50' });
  assert.deepEqual(issuePaths(both), ['kcalTarget']);

  const accepted = submit({ eatingStyle: 'low-kcal', kcalTarget: '1800' });
  assert.equal(accepted.success, true);
  assert.equal(accepted.success && accepted.data.kcalTarget, 1800);
  assert.equal(accepted.success && accepted.data.carbPresetCeiling, null);
});

test('the three styles that own neither number submit with neither', () => {
  for (const style of ['high-protein', 'just-track'] as const) {
    const result = submit({ eatingStyle: style });
    assert.equal(result.success, true, `${style} must save on its own`);
  }
  // An empty field posted by a rendered-but-untouched input is the same as an
  // absent one, never a zero.
  const blanks = submit({ eatingStyle: 'just-track', carbPresetCeiling: '', kcalTarget: '' });
  assert.equal(blanks.success, true);
  assert.equal(blanks.success && blanks.data.kcalTarget, null);
});

test('a style id this build has never heard of is refused', () => {
  assert.equal(submit({ eatingStyle: 'carnivore' }).success, false);
});

test('the carb sub step offers exactly the three ceilings, never a "decide later"', () => {
  assert.deepEqual(
    CARB_SUB_PRESETS.map((preset) => preset.ceiling),
    [20, 50, 100],
  );
});

//////////////////////////////////////////////////////////////////////////////
// 2. What a saved style writes, and what it removes
//////////////////////////////////////////////////////////////////////////////

/** A parsed submission, defaulting to "no numbers given". */
function values(overrides: Partial<EatingStyleFormValues> & { eatingStyle: EatingStyleId }): EatingStyleFormValues {
  return { carbPresetCeiling: null, kcalTarget: null, ...overrides };
}

test('switching low-carb to low-kcal nulls the ceiling and keeps the calorie target', () => {
  const { patch } = planEatingStyleSave({
    values: values({ eatingStyle: 'low-kcal', kcalTarget: 1800 }),
    currentGoals: goals({ goalNetCarbsCeilingG: 20, eatingStyle: 'low-carb' }),
    latestWeightKg: 78,
    referenceProteinFloorG: 60,
  });

  // CONTROL: this is the assertion that fails if `planEatingStyleSave` passes
  // the stored ceiling through instead of letting `applyEatingStyle` null it.
  assert.equal(patch.goalNetCarbsCeilingG, null);
  assert.equal(patch.goalKcalTarget, 1800);
  assert.equal(patch.eatingStyle, 'low-kcal');
});

test('switching back to low-carb nulls the calorie target and writes the picked ceiling', () => {
  const { patch } = planEatingStyleSave({
    values: values({ eatingStyle: 'low-carb', carbPresetCeiling: 50 }),
    currentGoals: goals({ goalKcalTarget: 1800, eatingStyle: 'low-kcal' }),
    latestWeightKg: 78,
    referenceProteinFloorG: 60,
  });

  assert.equal(patch.goalNetCarbsCeilingG, 50);
  assert.equal(patch.goalKcalTarget, null);
});

test('just-track drops both targets and leaves the reference protein floor', () => {
  const { patch, needsWeight } = planEatingStyleSave({
    values: values({ eatingStyle: 'just-track' }),
    currentGoals: goals({ goalNetCarbsCeilingG: 20, goalKcalTarget: 1800, goalProteinFloorG: 125 }),
    latestWeightKg: 78,
    referenceProteinFloorG: 60,
  });

  assert.equal(patch.goalNetCarbsCeilingG, null);
  assert.equal(patch.goalKcalTarget, null);
  assert.equal(patch.goalProteinFloorG, 60);
  assert.equal(needsWeight, false);
});

test('high-protein scales the floor by the latest weight, and says so when there is none', () => {
  const withWeight = planEatingStyleSave({
    values: values({ eatingStyle: 'high-protein' }),
    currentGoals: goals(),
    latestWeightKg: 78,
    referenceProteinFloorG: 60,
  });
  assert.equal(withWeight.patch.goalProteinFloorG, 125);
  assert.equal(withWeight.needsWeight, false);

  const withoutWeight = planEatingStyleSave({
    values: values({ eatingStyle: 'high-protein' }),
    currentGoals: goals(),
    latestWeightKg: null,
    referenceProteinFloorG: 60,
  });
  assert.equal(withoutWeight.patch.goalProteinFloorG, 60);
  assert.equal(withoutWeight.needsWeight, true);
});

test('only a weight-scaled style asks for a weight', () => {
  const asking = EATING_STYLE_IDS.filter((style) => styleNeedsWeight({ style, latestWeightKg: null }));
  assert.deepEqual(asking, ['high-protein']);
  assert.equal(styleNeedsWeight({ style: 'high-protein', latestWeightKg: 78 }), false);
});

//////////////////////////////////////////////////////////////////////////////
// 3. A legacy account: derived for display, never written
//////////////////////////////////////////////////////////////////////////////

function routeSource(): string {
  return readFileSync(fileURLToPath(new URL('../../app/routes/settings.goals.tsx', import.meta.url)), 'utf8');
}

test('an account with no stored style preselects the one its numbers describe', () => {
  assert.equal(effectiveEatingStyle(goals({ goalNetCarbsCeilingG: 20 })), 'low-carb');
  assert.equal(effectiveEatingStyle(goals({ goalNetCarbsCeilingG: 20, goalKcalTarget: 1800 })), 'low-carb-low-kcal');
  assert.equal(effectiveEatingStyle(goals({ goalKcalTarget: 1800 })), 'low-kcal');
  assert.equal(effectiveEatingStyle(goals()), 'just-track');
  // A stored pick always wins over the numbers, which is what makes an explicit
  // save the only thing that changes the answer.
  assert.equal(effectiveEatingStyle(goals({ goalNetCarbsCeilingG: 20, eatingStyle: 'just-track' })), 'just-track');
});

test('the client loader derives the style and writes nothing while it does', () => {
  const source = routeSource();
  const loaderBody = source.slice(
    source.indexOf('export async function clientLoader'),
    source.indexOf('clientLoader.hydrate'),
  );
  assert.ok(loaderBody.length > 0, 'clientLoader must still be there to check');
  assert.ok(loaderBody.includes('effectiveEatingStyle('), 'the loader must derive the style');
  assert.ok(!loaderBody.includes('patchLocalProfileGoals'), 'the loader must never write the derived style back');
});

test('the style card posts its own intent, so it can never fall through to the goals save', () => {
  const source = routeSource();
  assert.ok(source.includes("SAVE_EATING_STYLE: 'save-eating-style'"));
  assert.ok(source.includes('if (intent === INTENT.SAVE_EATING_STYLE) return _saveEatingStyle(formData);'));
});

//////////////////////////////////////////////////////////////////////////////
// 4. The caution note (spec 04): three styles, two statuses, nothing else
//////////////////////////////////////////////////////////////////////////////

const STATUSES: readonly (ReproductiveStatus | null)[] = ['none', 'pregnant', 'lactating', null];

test('the note appears for exactly six of the twenty style and status combinations', () => {
  const raising: string[] = [];
  for (const style of EATING_STYLE_IDS) {
    for (const status of STATUSES) {
      if (styleCaution(style, status) !== null) raising.push(`${style}/${String(status)}`);
    }
  }

  // The COUNT is the honest half of this: an assertion that the six listed
  // combinations raise the note would still pass if a seventh did too.
  assert.equal(raising.length, 6);
  assert.deepEqual(raising.toSorted(), [
    'low-carb-low-kcal/lactating',
    'low-carb-low-kcal/pregnant',
    'low-carb/lactating',
    'low-carb/pregnant',
    'low-kcal/lactating',
    'low-kcal/pregnant',
  ]);
});

test('a style that restricts nothing never raises the note, whatever the status', () => {
  for (const status of STATUSES) {
    assert.equal(styleCaution('just-track', status), null);
    assert.equal(styleCaution('high-protein', status), null);
  }
});

test('the note is one muted paragraph with one working source link, and no number', () => {
  const markup = renderToStaticMarkup(withI18n(createElement(EatingStyleCautionNote)));

  assert.equal(markup.split('<p').length - 1, 1, 'exactly one note, never a stack');
  assert.ok(markup.includes('text-muted-foreground'));
  assert.ok(markup.includes(`href="${STYLE_CAUTION_SOURCE_URL}"`));
  assert.ok(markup.includes('German Nutrition Society'), 'the link says where it goes');
  // Information, not a prescription: no colour beyond muted text, and no
  // adjusted figure anywhere in it.
  assert.ok(!markup.includes('text-red'));
  assert.ok(!/\d/u.test(markup.replace(/<[^>]*>/gu, '')), 'the note carries no number');
});

//////////////////////////////////////////////////////////////////////////////
// 5. The rendered card: five styles, and the sub steps gated to their owners
//////////////////////////////////////////////////////////////////////////////

const NO_ERRORS = { name: 'x', id: 'x', errorId: 'x-error', errors: undefined };

function renderPicker(style: EatingStyleId, options: { latestWeightKg: number | null } = { latestWeightKg: 78 }) {
  return renderToStaticMarkup(
    withI18n(
      createElement(EatingStylePicker, {
        selectedStyle: style,
        onSelectStyle: () => {},
        styleFieldName: 'eatingStyle',
        carbField: { ...NO_ERRORS, name: 'carbPresetCeiling', id: 'carb', errorId: 'carb-error' },
        carbPresetCeiling: '',
        onCarbPresetCeilingChange: () => {},
        kcalField: { ...NO_ERRORS, name: 'kcalTarget', id: 'kcal', errorId: 'kcal-error' },
        kcalTarget: '',
        onKcalTargetChange: () => {},
        needsWeight: styleNeedsWeight({ style, latestWeightKg: options.latestWeightKg }),
      }),
    ),
  );
}

test('all five styles are offered, whichever one is picked', () => {
  const markup = renderPicker('just-track');
  for (const style of EATING_STYLE_IDS) {
    assert.ok(markup.includes(`value="${style}"`), `${style} must be offered`);
  }
  assert.equal(markup.split('type="radio"').length - 1, EATING_STYLE_IDS.length, 'five style radios, and nothing else');
  assert.ok(markup.includes('checked=""'), 'the picked style is preselected');
});

test('the 20/50/100 step shows for the two carb styles and for no other', () => {
  const showing = EATING_STYLE_IDS.filter((style) => renderPicker(style).includes('name="carbPresetCeiling"'));
  assert.deepEqual(showing, ['low-carb', 'low-carb-low-kcal']);
});

test('the calorie field shows for the two calorie styles and for no other', () => {
  const showing = EATING_STYLE_IDS.filter((style) => renderPicker(style).includes('name="kcalTarget"'));
  assert.deepEqual(showing, ['low-carb-low-kcal', 'low-kcal']);
});

test('the weight note shows only for high-protein without a weigh-in', () => {
  const asking = EATING_STYLE_IDS.filter((style) =>
    renderPicker(style, { latestWeightKg: null }).includes('Log your weight'),
  );
  assert.deepEqual(asking, ['high-protein']);
  assert.ok(!renderPicker('high-protein', { latestWeightKg: 78 }).includes('Log your weight'));
});

////////////////////////////////////////////////////////////////////////////////
// The remount key, which is what makes a style save VISIBLE on the goals card
////////////////////////////////////////////////////////////////////////////////

/**
 * The walk that produced this: saving "low calorie" removed the 50 g carb
 * ceiling and wrote 1800 kcal, and the goals card below went on printing 50
 * until the page was reloaded. Conform seeds an uncontrolled input from
 * `defaultValue` at mount and never re-reads it, so only a remount can move it.
 */
const WALK_BEFORE: GoalsCardValues = {
  netCarbsCeilingG: 50,
  proteinFloorG: null,
  kcalTarget: 1800,
  targetWeightKg: null,
};

const WALK_AFTER: GoalsCardValues = { ...WALK_BEFORE, netCarbsCeilingG: null };

test('two different goal states get different keys', () => {
  assert.notEqual(goalsCardKey(WALK_BEFORE), goalsCardKey(WALK_AFTER));
  assert.notEqual(goalsCardKey(WALK_BEFORE), goalsCardKey({ ...WALK_BEFORE, proteinFloorG: 90 }));
  assert.notEqual(goalsCardKey(WALK_BEFORE), goalsCardKey({ ...WALK_BEFORE, kcalTarget: 1900 }));
  assert.notEqual(goalsCardKey(WALK_BEFORE), goalsCardKey({ ...WALK_BEFORE, targetWeightKg: 72 }));
});

test('an unchanged goal state keeps its key, so typing is never interrupted', () => {
  assert.equal(goalsCardKey(WALK_BEFORE), goalsCardKey({ ...WALK_BEFORE }));
  assert.equal(goalsCardKey(WALK_AFTER), goalsCardKey({ ...WALK_AFTER }));
});

/**
 * The naive builder the fix could have been: everything except the one field
 * the style save actually cleared. It cannot tell the two walk states apart, so
 * the card would not remount and the removed 50 would stay on screen.
 */
function ceilingBlindKey(stored: GoalsCardValues): string {
  return [stored.proteinFloorG, stored.kcalTarget, stored.targetWeightKg].map((value) => String(value)).join('|');
}

/** The style card key, with the two inputs spelled out per call. */
function withStyle(style: EatingStyleId, stored: GoalsCardValues): string {
  return eatingStyleCardKey({ style, goals: stored });
}

test('CONTROL: a key that ignores the carb ceiling collides on the exact walk case', () => {
  assert.equal(ceilingBlindKey(WALK_BEFORE), ceilingBlindKey(WALK_AFTER), 'the control must collide');
  assert.notEqual(goalsCardKey(WALK_BEFORE), goalsCardKey(WALK_AFTER), 'the shipped builder must not');
});

test('the style card key follows the style AND the numbers it preselects from', () => {
  assert.notEqual(withStyle('low-carb', WALK_BEFORE), withStyle('low-kcal', WALK_BEFORE));
  // A goals save that leaves the derived style alone still has to re-seed the
  // card's carb chip and calorie field.
  assert.notEqual(withStyle('low-carb', WALK_BEFORE), withStyle('low-carb', { ...WALK_BEFORE, netCarbsCeilingG: 20 }));
  assert.equal(withStyle('low-carb', WALK_BEFORE), withStyle('low-carb', { ...WALK_BEFORE }));
});

test('the settings route actually keys both cards off the loader values', () => {
  const source = readFileSync(new URL('../../app/routes/settings.goals.tsx', import.meta.url), 'utf8');
  // `assert.ok` rather than `assert.match`: a failure here should print the one
  // line that is missing, not the whole route module.
  assert.ok(
    /<GoalsCard\s+key=\{goalsCardKey\(goals\)\}/.test(source),
    'the goals card must remount on a goals change',
  );
  assert.ok(
    /<EatingStyleCard\s+key=\{eatingStyleCardKey\(\{ style, goals \}\)\}/.test(source),
    'the style card must remount on a style or goals change',
  );
});
