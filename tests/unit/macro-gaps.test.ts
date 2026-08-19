/**
 * Unit tests for `#app/lib/macro-gaps` — the carb-impact tier and per-target
 * gap math behind the diary's novice-first hero and its day drill-down
 * (M129/06).
 *
 * The three things worth pinning here are the three things a screenshot can't
 * catch: that a goal-less user never gets a fabricated target or a NaN, that
 * ceilings and floors compute "remaining" in opposite directions, and that the
 * dominant gap is chosen by RELATIVE shortfall (the whole reason a 24 g fiber
 * gap can beat a 60 g protein one).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCarbImpact,
  computeDayGaps,
  describeGap,
  DEFAULT_FIBER_REFERENCE_G,
  DEFAULT_NET_CARB_REFERENCE_G,
  type Translate,
} from '../../app/lib/macro-gaps';
import { formatMacroNumber } from '../../app/lib/format-macro-number';
import i18next from '../../app/i18n/i18n';

/**
 * The REAL catalog, so the phrases below stay assertions about WORDING (the
 * reason this module produces strings at all) rather than about key spelling.
 */
const t: Translate = (key, params) => i18next.t(key, params ?? {});

describe('computeCarbImpact', () => {
  it('reads low at or under half the ceiling', () => {
    assert.equal(computeCarbImpact({ netCarbs: 10, ceiling: 50, t }).level, 'low');
    assert.equal(computeCarbImpact({ netCarbs: 25, ceiling: 50, t }).level, 'low');
  });

  it('reads moderate between half and 85% of the ceiling', () => {
    assert.equal(computeCarbImpact({ netCarbs: 26, ceiling: 50, t }).level, 'moderate');
    assert.equal(computeCarbImpact({ netCarbs: 42.5, ceiling: 50, t }).level, 'moderate');
  });

  it('reads high in the last stretch below the ceiling, and once over it', () => {
    assert.equal(computeCarbImpact({ netCarbs: 46, ceiling: 50, t }).level, 'high');
    const over = computeCarbImpact({ netCarbs: 71, ceiling: 50, t });
    assert.equal(over.level, 'high');
    assert.equal(over.isOver, true);
  });

  it('never labels the person — only the day', () => {
    for (const netCarbs of [0, 25, 49, 120]) {
      const label = computeCarbImpact({ netCarbs, ceiling: 50, t }).label;
      assert.match(label, /carb impact$/);
      assert.doesNotMatch(label, /bad|fail|poor|good/i);
    }
  });

  it('falls back to the documented 50 g reference when no ceiling is set, and says so', () => {
    const impact = computeCarbImpact({ netCarbs: 20, ceiling: null, t });
    assert.equal(impact.referenceG, DEFAULT_NET_CARB_REFERENCE_G);
    assert.equal(impact.referenceSource, 'default');
    assert.equal(impact.level, 'low');
  });

  it('uses the goal as the reference when there is one', () => {
    const impact = computeCarbImpact({ netCarbs: 20, ceiling: 120, t });
    assert.equal(impact.referenceG, 120);
    assert.equal(impact.referenceSource, 'goal');
  });

  it('never produces NaN or Infinity for a zero or negative ceiling', () => {
    const impact = computeCarbImpact({ netCarbs: 20, ceiling: 0, t });
    // A non-positive ceiling is treated as "no usable goal", so the documented
    // reference takes over rather than dividing by zero.
    assert.equal(impact.referenceG, DEFAULT_NET_CARB_REFERENCE_G);
    assert.ok(impact.fraction !== null && Number.isFinite(impact.fraction));
  });

  it('clamps the fraction to 0..1 on a day well past the reference', () => {
    const impact = computeCarbImpact({ netCarbs: 500, ceiling: 50, t });
    assert.equal(impact.fraction, 1);
  });
});

describe('computeDayGaps — the net-carb ceiling row', () => {
  it('reports headroom left while under the ceiling', () => {
    const { netCarbs } = computeDayGaps({
      totals: { netCarbs: 32, protein: 60, fiber: 10 },
      goals: { netCarbsCeiling: 50, proteinFloor: 100 },
      t,
    });
    assert.equal(netCarbs.kind, 'ceiling');
    assert.equal(netCarbs.remainingG, 18);
    assert.equal(netCarbs.overByG, 0);
    assert.equal(netCarbs.isMet, true);
    assert.equal(netCarbs.isOver, false);
  });

  it('never reports a negative headroom once over — the overshoot moves to overByG', () => {
    const { netCarbs, carbHeadroomG } = computeDayGaps({
      totals: { netCarbs: 62, protein: 60, fiber: 10 },
      goals: { netCarbsCeiling: 50, proteinFloor: 100 },
      t,
    });
    assert.equal(netCarbs.remainingG, 0);
    assert.equal(netCarbs.overByG, 12);
    assert.equal(netCarbs.isOver, true);
    assert.equal(carbHeadroomG, 0);
  });

  it('decides over/under on whole grams, matching what the UI renders', () => {
    // 50.3 renders as "50 of 50 g" — a verdict of "over" would contradict it.
    const under = computeDayGaps({
      totals: { netCarbs: 50.3, protein: 0, fiber: 0 },
      goals: { netCarbsCeiling: 50, proteinFloor: null },
      t,
    });
    assert.equal(under.netCarbs.isOver, false);
    const over = computeDayGaps({
      totals: { netCarbs: 50.7, protein: 0, fiber: 0 },
      goals: { netCarbsCeiling: 50, proteinFloor: null },
      t,
    });
    assert.equal(over.netCarbs.isOver, true);
  });

  it('shows absolute net carbs with NO target for a user who set no ceiling', () => {
    const { netCarbs, carbHeadroomG } = computeDayGaps({
      totals: { netCarbs: 32, protein: 60, fiber: 10 },
      goals: { netCarbsCeiling: null, proteinFloor: null },
      t,
    });
    assert.equal(netCarbs.consumed, 32);
    assert.equal(netCarbs.target, null);
    assert.equal(netCarbs.targetSource, 'none');
    assert.equal(netCarbs.remainingG, null);
    assert.equal(netCarbs.fraction, null);
    // No ceiling means no budget to spend against — not a fabricated one.
    assert.equal(carbHeadroomG, null);
  });
});

describe('computeDayGaps — the protein and fiber floors', () => {
  it('reports grams still to go on an unmet protein floor', () => {
    const { protein } = computeDayGaps({
      totals: { netCarbs: 20, protein: 46, fiber: 10 },
      goals: { netCarbsCeiling: 50, proteinFloor: 100 },
      t,
    });
    assert.equal(protein.kind, 'floor');
    assert.equal(protein.remainingG, 54);
    assert.equal(protein.isMet, false);
    assert.equal(protein.isOver, false);
  });

  it('reports 0 to go once the floor is reached, never a negative', () => {
    const { protein } = computeDayGaps({
      totals: { netCarbs: 20, protein: 130, fiber: 10 },
      goals: { netCarbsCeiling: 50, proteinFloor: 100 },
      t,
    });
    assert.equal(protein.remainingG, 0);
    assert.equal(protein.isMet, true);
    assert.equal(protein.fraction, 1);
  });

  it('leaves protein target-less (never defaulted) when the user set no floor', () => {
    const { protein } = computeDayGaps({
      totals: { netCarbs: 20, protein: 46, fiber: 10 },
      goals: { netCarbsCeiling: 50, proteinFloor: null },
      t,
    });
    assert.equal(protein.target, null);
    assert.equal(protein.targetSource, 'none');
    assert.equal(protein.consumed, 46);
  });

  it('always gives fiber the documented default reference, tagged as a default', () => {
    const { fiber } = computeDayGaps({
      totals: { netCarbs: 20, protein: 46, fiber: 9 },
      goals: { netCarbsCeiling: null, proteinFloor: null },
      t,
    });
    assert.equal(fiber.target, DEFAULT_FIBER_REFERENCE_G);
    assert.equal(fiber.targetSource, 'default');
    assert.equal(fiber.remainingG, DEFAULT_FIBER_REFERENCE_G - 9);
  });

  it('renders three rows in a fixed order', () => {
    const { gaps } = computeDayGaps({
      totals: { netCarbs: 1, protein: 1, fiber: 1 },
      goals: { netCarbsCeiling: 50, proteinFloor: 100 },
      t,
    });
    assert.deepEqual(
      gaps.map((gap) => gap.key),
      ['netCarbs', 'protein', 'fiber'],
    );
  });
});

describe('computeDayGaps — the dominant gap', () => {
  it('picks the larger RELATIVE shortfall, not the larger gram gap', () => {
    // Protein: 60 g short of 200 (30% short). Fiber: 24 g short of 25 (96%).
    // Raw grams would pick protein; the fiber day is plainly the one to fix.
    const { dominantGap } = computeDayGaps({
      totals: { netCarbs: 20, protein: 140, fiber: 1 },
      goals: { netCarbsCeiling: 50, proteinFloor: 200 },
      t,
    });
    assert.equal(dominantGap?.nutrient, 'fiber');
    assert.equal(dominantGap?.remainingG, 24);
  });

  it('picks protein when protein is proportionally further behind', () => {
    const { dominantGap } = computeDayGaps({
      totals: { netCarbs: 20, protein: 10, fiber: 22 },
      goals: { netCarbsCeiling: 50, proteinFloor: 100 },
      t,
    });
    assert.equal(dominantGap?.nutrient, 'protein');
    assert.equal(dominantGap?.remainingG, 90);
  });

  it('is null once both floors are met', () => {
    const { dominantGap } = computeDayGaps({
      totals: { netCarbs: 20, protein: 120, fiber: 30 },
      goals: { netCarbsCeiling: 50, proteinFloor: 100 },
      t,
    });
    assert.equal(dominantGap, null);
  });

  it('falls back to fiber for a user with no protein goal', () => {
    const { dominantGap } = computeDayGaps({
      totals: { netCarbs: 20, protein: 5, fiber: 4 },
      goals: { netCarbsCeiling: null, proteinFloor: null },
      t,
    });
    assert.equal(dominantGap?.nutrient, 'fiber');
  });

  it('prefers a gap against the user’s own goal over one against a default reference, all else equal', () => {
    // Both exactly half short: protein 50/100 (the user's goal), fiber 12.5/25
    // (the app's default reference). The target the user actually chose wins.
    const { dominantGap } = computeDayGaps({
      totals: { netCarbs: 20, protein: 50, fiber: 12.5 },
      goals: { netCarbsCeiling: 50, proteinFloor: 100 },
      t,
    });
    assert.equal(dominantGap?.nutrient, 'protein');
  });

  it('still yields to the default reference when the goal gap is nearly closed and the default one is gaping', () => {
    // Protein 2 g short of 110 (2%); fiber 24 g short of 25 (96%). Weighting a
    // personal goal must not send someone protein foods for a 2 g gap.
    const { dominantGap } = computeDayGaps({
      totals: { netCarbs: 20, protein: 108, fiber: 1 },
      goals: { netCarbsCeiling: 50, proteinFloor: 110 },
      t,
    });
    assert.equal(dominantGap?.nutrient, 'fiber');
  });

  it('flips to the user’s goal on a shortfall the weight is enough to carry', () => {
    // Protein 44% short × 1.25 = 0.55 beats fiber at 52% short.
    const { dominantGap } = computeDayGaps({
      totals: { netCarbs: 20, protein: 56, fiber: 12 },
      goals: { netCarbsCeiling: 50, proteinFloor: 100 },
      t,
    });
    assert.equal(dominantGap?.nutrient, 'protein');
  });
});

describe('describeGap', () => {
  const gapsFor = (totals: { netCarbs: number; protein: number; fiber: number }) =>
    computeDayGaps({ totals, goals: { netCarbsCeiling: 50, proteinFloor: 100 }, t });

  it('phrases an unmet floor as grams to go', () => {
    assert.equal(describeGap(gapsFor({ netCarbs: 20, protein: 46, fiber: 10 }).protein, formatMacroNumber, t), '54 g to go');
  });

  it('phrases a met floor without a number', () => {
    assert.equal(describeGap(gapsFor({ netCarbs: 20, protein: 120, fiber: 10 }).protein, formatMacroNumber, t), 'Reached');
  });

  it('phrases a ceiling as headroom left, and as an over-by once exceeded', () => {
    assert.equal(
      describeGap(gapsFor({ netCarbs: 32, protein: 46, fiber: 10 }).netCarbs, formatMacroNumber, t),
      '18 g of headroom left',
    );
    assert.equal(describeGap(gapsFor({ netCarbs: 62, protein: 46, fiber: 10 }).netCarbs, formatMacroNumber, t), 'Over by 12 g');
  });

  it('phrases a target-less row as a plain total — never a NaN or an em dash', () => {
    const { protein } = computeDayGaps({
      totals: { netCarbs: 20, protein: 46, fiber: 10 },
      goals: { netCarbsCeiling: null, proteinFloor: null },
      t,
    });
    const phrase = describeGap(protein, formatMacroNumber, t);
    assert.equal(phrase, '46 g logged');
    assert.doesNotMatch(phrase, /NaN|Infinity|undefined|null/);
  });
});
