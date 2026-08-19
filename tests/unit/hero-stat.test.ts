/**
 * Unit tests for `#app/components/hero-stat`'s `formatHeroStat` — the diary
 * hero's remaining-first framing (M129/03).
 *
 * These pin the four states as literal strings, on purpose: the whole point of
 * routing every framing through one function was that the wording stops being
 * a screenshot detail. The rules that must never regress are here too — a
 * negative remainder is impossible, an over-goal day never renders as red-tone
 * copy or an exclamation, and a user with no targets never sees a NaN or an
 * invented ceiling.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import i18next from '../../app/i18n/i18n';
import { HeroStat, formatHeroStat, formatHeroValue, type Translate } from '../../app/components/hero-stat';

/**
 * The REAL catalog, not a stub. These assertions are about the exact wording,
 * and routing them through the shipped English resources is what keeps this
 * file a copy test rather than a key-spelling test — a renamed or missing
 * `diary.hero.*` key fails here instead of shipping a raw key to the hero.
 */
const t: Translate = (key, params) => i18next.t(key, params ?? {});

const NO_GOALS = { netCarbsCeiling: null, kcalTarget: null, hasEstimates: false, t, language: 'en' };

describe('formatHeroStat — under a net-carb goal', () => {
  it('leads with what is LEFT, not what was eaten', () => {
    const stat = formatHeroStat({ ...NO_GOALS, netCarbs: 42.1, netCarbsCeiling: 50, kcal: 0 });
    assert.equal(stat.mode, 'carbs-remaining');
    assert.equal(stat.value, '7.9');
    assert.equal(stat.context, 'g left of 50');
    assert.equal(stat.unitLabel, 'net carbs');
    assert.equal(stat.isOver, false);
    assert.equal(stat.srLabel, '7.9 g left today of your 50 g net-carb goal.');
  });

  it('reads 0 left at exactly the ceiling — never a negative remainder', () => {
    const stat = formatHeroStat({ ...NO_GOALS, netCarbs: 50, netCarbsCeiling: 50, kcal: 0 });
    assert.equal(stat.value, '0');
    assert.equal(stat.isOver, false);
  });

  it('hedges the figure when the day includes AI estimates', () => {
    const stat = formatHeroStat({ netCarbsCeiling: 50, kcalTarget: null, hasEstimates: true, netCarbs: 20, kcal: 0, t, language: 'en' });
    assert.equal(stat.value, '~30');
  });
});

describe('formatHeroStat — over a net-carb goal', () => {
  it('flips to a factual over-by figure rather than a negative remainder', () => {
    const stat = formatHeroStat({ ...NO_GOALS, netCarbs: 62, netCarbsCeiling: 50, kcal: 0 });
    assert.equal(stat.mode, 'carbs-over');
    assert.equal(stat.isOver, true);
    assert.equal(stat.value, '12');
    assert.equal(stat.context, 'g over today');
    assert.equal(stat.unitLabel, 'net carbs');
    assert.equal(stat.srLabel, '12 g over your 50 g net-carb goal today.');
  });

  it('never renders a negative number in any over-goal string', () => {
    const stat = formatHeroStat({ ...NO_GOALS, netCarbs: 120, netCarbsCeiling: 50, kcal: 0 });
    for (const text of [stat.value, stat.context, stat.srLabel]) {
      // A minus immediately before a digit — the hyphen in "net-carb" is fine.
      assert.doesNotMatch(text, /-\d/, `"${text}" must not carry a negative figure`);
    }
    assert.ok(stat.numericValue > 0);
  });

  it('carries no exclamation or scolding punctuation', () => {
    const stat = formatHeroStat({ ...NO_GOALS, netCarbs: 200, netCarbsCeiling: 50, kcal: 0 });
    assert.ok(!`${stat.value}${stat.context}${stat.srLabel}`.includes('!'));
  });

  it('agrees with the shared rounded over-goal comparison at the boundary', () => {
    // 50.3 rounds to 50 against a 50 ceiling — the habit strip calls that met,
    // so the hero must not call it over.
    assert.equal(formatHeroStat({ ...NO_GOALS, netCarbs: 50.3, netCarbsCeiling: 50, kcal: 0 }).isOver, false);
    assert.equal(formatHeroStat({ ...NO_GOALS, netCarbs: 50.6, netCarbsCeiling: 50, kcal: 0 }).isOver, true);
  });
});

describe('formatHeroStat — calorie tracking', () => {
  it('frames a calorie-only tracker the same way, in kcal', () => {
    const stat = formatHeroStat({ netCarbsCeiling: null, kcalTarget: 1800, hasEstimates: false, netCarbs: 42, kcal: 1180, t, language: 'en' });
    assert.equal(stat.mode, 'kcal-remaining');
    assert.equal(stat.value, '620');
    assert.equal(stat.context, 'left of 1800');
    assert.equal(stat.unitLabel, 'calories');
    assert.equal(stat.srLabel, '620 calories left today of your 1800 calorie goal.');
  });

  it('goes over in kcal without a negative remainder', () => {
    const stat = formatHeroStat({ netCarbsCeiling: null, kcalTarget: 1800, hasEstimates: false, netCarbs: 42, kcal: 1920, t, language: 'en' });
    assert.equal(stat.mode, 'kcal-over');
    assert.equal(stat.value, '120');
    assert.equal(stat.context, 'over today');
    assert.equal(stat.isOver, true);
  });

  it('renders whole calories, never a decimal', () => {
    const stat = formatHeroStat({ netCarbsCeiling: null, kcalTarget: 1800, hasEstimates: false, netCarbs: 0, kcal: 1180.4, t, language: 'en' });
    assert.equal(stat.value, '620');
  });

  it('lets a net-carb ceiling win when the user set both', () => {
    const stat = formatHeroStat({ netCarbsCeiling: 50, kcalTarget: 1800, hasEstimates: false, netCarbs: 20, kcal: 900, t, language: 'en' });
    assert.equal(stat.mode, 'carbs-remaining');
  });
});

describe('formatHeroStat — no goal at all', () => {
  it('shows the absolute total and invents no target', () => {
    const stat = formatHeroStat({ ...NO_GOALS, netCarbs: 42.1, kcal: 900 });
    assert.equal(stat.mode, 'carbs-absolute');
    assert.equal(stat.value, '42.1');
    assert.equal(stat.context, 'g net carbs');
    assert.equal(stat.unitLabel, null);
    assert.equal(stat.srLabel, '42.1 g net carbs today.');
  });

  it('never produces NaN for any degenerate target', () => {
    for (const goals of [
      { netCarbsCeiling: 0, kcalTarget: 0 },
      { netCarbsCeiling: -10, kcalTarget: null },
      { netCarbsCeiling: null, kcalTarget: 0 },
    ]) {
      const stat = formatHeroStat({ ...goals, hasEstimates: false, netCarbs: 12, kcal: 300, t, language: 'en' });
      assert.ok(!stat.value.includes('NaN'), `value was "${stat.value}"`);
      assert.ok(!stat.context.includes('NaN'), `context was "${stat.context}"`);
      assert.equal(Number.isFinite(stat.numericValue), true);
    }
  });
});

describe('formatHeroValue', () => {
  it('formats a mid-tween figure exactly as the settled one would be', () => {
    const stat = formatHeroStat({ ...NO_GOALS, netCarbs: 42.1, netCarbsCeiling: 50, kcal: 0 });
    assert.equal(formatHeroValue({ numericValue: stat.numericValue, mode: stat.mode, hasEstimates: false, language: 'en' }), stat.value);
  });

  it('rounds calorie modes to whole numbers mid-tween', () => {
    assert.equal(formatHeroValue({ numericValue: 619.6, mode: 'kcal-remaining', hasEstimates: false, language: 'en' }), '620');
  });

  it("writes the gram figure with the active language's decimal separator", () => {
    // The hero is the app's biggest number; "7,9" is what a German reader
    // expects to see there, and "7.9" reads as a different quantity entirely.
    const shared = { numericValue: 7.9, mode: 'carbs-remaining' as const, hasEstimates: false };
    assert.equal(formatHeroValue({ ...shared, language: 'en' }), '7.9');
    assert.equal(formatHeroValue({ ...shared, language: 'de' }), '7,9');
  });

  it('keeps the "~" hedge outside the localised figure', () => {
    const shared = { numericValue: 7.9, mode: 'carbs-remaining' as const, hasEstimates: true };
    assert.equal(formatHeroValue({ ...shared, language: 'de' }), '~7,9');
  });
});

describe('HeroStat rendering', () => {
  it('paints the over-goal figure amber, never destructive', () => {
    const stat = formatHeroStat({ ...NO_GOALS, netCarbs: 62, netCarbsCeiling: 50, kcal: 0 });
    const html = renderToStaticMarkup(createElement(HeroStat, { stat, value: stat.value }));
    assert.match(html, /text-accent-amber/);
    assert.ok(!html.includes('destructive'), 'over-goal must never use the destructive token');
  });

  it('omits the third tier when there is no unit label to show', () => {
    const stat = formatHeroStat({ ...NO_GOALS, netCarbs: 42.1, kcal: 0 });
    const html = renderToStaticMarkup(createElement(HeroStat, { stat, value: stat.value }));
    assert.match(html, /g net carbs/);
    assert.ok(!html.includes('uppercase'), 'the eyebrow tier should be absent in the absolute framing');
  });
});
