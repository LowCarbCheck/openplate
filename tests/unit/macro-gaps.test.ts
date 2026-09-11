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
 *
 * M210 removed the fourth thing this file used to pin: a goal-less day was
 * graded against a hidden 50 g reference. It is not graded at all now, and the
 * tests that used to assert the fallback assert its absence instead.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  computeCarbImpact,
  computeDayGaps,
  dayVerdict,
  describeGap,
  DEFAULT_FIBER_REFERENCE_G,
  type CarbImpact,
  type DayGaps,
  type Translate,
} from '../../app/lib/macro-gaps';
import { formatMacroNumber } from '../../app/lib/format-macro-number';
import i18next from '../../app/i18n/i18n';

/**
 * The REAL catalog, so the phrases below stay assertions about WORDING (the
 * reason this module produces strings at all) rather than about key spelling.
 */
const t: Translate = (key, params) => i18next.t(key, params ?? {});

/** Narrows the impact for the tests that are about a graded day, so a null is a failure rather than an optional chain. */
function gradedImpact(netCarbs: number, ceiling: number): CarbImpact {
  const impact = computeCarbImpact({ netCarbs, ceiling, t });
  assert.ok(impact !== null, 'expected a ceiling to produce a verdict');
  return impact;
}

describe('computeCarbImpact', () => {
  it('reads low at or under half the ceiling', () => {
    assert.equal(gradedImpact(10, 50).level, 'low');
    assert.equal(gradedImpact(25, 50).level, 'low');
  });

  it('reads moderate between half and 85% of the ceiling', () => {
    assert.equal(gradedImpact(26, 50).level, 'moderate');
    assert.equal(gradedImpact(42.5, 50).level, 'moderate');
  });

  it('reads high in the last stretch below the ceiling, and once over it', () => {
    assert.equal(gradedImpact(46, 50).level, 'high');
    const over = gradedImpact(71, 50);
    assert.equal(over.level, 'high');
    assert.equal(over.isOver, true);
  });

  it('never labels the person — only the day', () => {
    for (const netCarbs of [0, 25, 49, 120]) {
      const label = gradedImpact(netCarbs, 50).label;
      assert.match(label, /carb impact$/);
      assert.doesNotMatch(label, /bad|fail|poor|good/i);
    }
  });

  it('grades nothing when no ceiling is set, there is no 50 g fallback any more', () => {
    assert.equal(computeCarbImpact({ netCarbs: 20, ceiling: null, t }), null);
  });

  it('uses the goal as the reference when there is one', () => {
    assert.equal(gradedImpact(20, 120).referenceG, 120);
  });

  it('never produces NaN or Infinity for a zero or negative ceiling', () => {
    // A non-positive ceiling is not a usable goal, so there is nothing to
    // divide against and nothing to say, rather than a division by zero.
    assert.equal(computeCarbImpact({ netCarbs: 20, ceiling: 0, t }), null);
    assert.equal(computeCarbImpact({ netCarbs: 20, ceiling: -50, t }), null);
  });

  it('clamps the fraction to 0..1 on a day well past the ceiling', () => {
    assert.equal(gradedImpact(500, 50).fraction, 1);
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

  it('leaves protein target-less when there is neither a floor nor a reference', () => {
    // The pre-M205 behaviour, kept for a caller that has no body metrics to
    // compute a reference from: no target is still better than a made-up one.
    const { protein } = computeDayGaps({
      totals: { netCarbs: 20, protein: 46, fiber: 10 },
      goals: { netCarbsCeiling: 50, proteinFloor: null },
      t,
    });
    assert.equal(protein.target, null);
    assert.equal(protein.targetSource, 'none');
    assert.equal(protein.consumed, 46);
  });

  it('gives protein the reference floor, tagged as a default, when the user set none', () => {
    const { protein } = computeDayGaps({
      totals: { netCarbs: 20, protein: 46, fiber: 10 },
      goals: { netCarbsCeiling: 50, proteinFloor: null, proteinReferenceG: 62 },
      t,
    });
    assert.equal(protein.target, 62);
    assert.equal(protein.targetSource, 'default');
    assert.equal(protein.remainingG, 16);
    assert.equal(protein.isMet, false);
  });

  it('lets a floor the user set beat the reference, and tags it as a goal', () => {
    const { protein } = computeDayGaps({
      totals: { netCarbs: 20, protein: 46, fiber: 10 },
      goals: { netCarbsCeiling: 50, proteinFloor: 100, proteinReferenceG: 62 },
      t,
    });
    assert.equal(protein.target, 100);
    assert.equal(protein.targetSource, 'goal');
    // CONTROL: the reference was a live, DIFFERENT number in the same call ,
    // 62 would have been reached at 46 g of protein short by 16, not 54, so
    // this cannot pass by the reference having been ignored everywhere.
    assert.equal(protein.remainingG, 54);
  });

  it('keeps a floor of 0 winning over the reference, since 0 is a choice too', () => {
    const { protein } = computeDayGaps({
      totals: { netCarbs: 20, protein: 46, fiber: 10 },
      goals: { netCarbsCeiling: 50, proteinFloor: 0, proteinReferenceG: 62 },
      t,
    });
    assert.equal(protein.target, 0);
    assert.equal(protein.targetSource, 'goal');
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

/**
 * `referenceDateMissing` (M206/03): the flag that lets the day view say "this
 * is the LARGEST published figure, because you gave no due date" instead of
 * tagging every default alike.
 *
 * Only a reference that was actually used can carry it, which is what the two
 * controls below check: a floor the person typed in owes nothing to a date, and
 * a row with no target at all has no figure to qualify.
 */
describe('computeDayGaps, the missing reference date', () => {
  const totals = { netCarbs: 20, protein: 46, fiber: 10 };

  it('flags the protein reference when the pregnancy has no due date on file', () => {
    const { protein } = computeDayGaps({
      totals,
      goals: {
        netCarbsCeiling: 50,
        proteinFloor: null,
        proteinReferenceG: 86,
        proteinReferenceMissingDate: 'due-date',
      },
      t,
    });
    assert.equal(protein.referenceDateMissing, true);
    // The source is still a plain default: the figure is defensible, it is only
    // less exact than it could be.
    assert.equal(protein.targetSource, 'default');
    assert.equal(protein.target, 86);
  });

  it('flags it for breastfeeding with no birth date too', () => {
    const { protein } = computeDayGaps({
      totals,
      goals: {
        netCarbsCeiling: 50,
        proteinFloor: null,
        proteinReferenceG: 77,
        proteinReferenceMissingDate: 'birth-date',
      },
      t,
    });
    assert.equal(protein.referenceDateMissing, true);
  });

  it('leaves it false when a date resolved a stage', () => {
    const { protein } = computeDayGaps({
      totals,
      goals: { netCarbsCeiling: 50, proteinFloor: null, proteinReferenceG: 67, proteinReferenceMissingDate: null },
      t,
    });
    assert.equal(protein.referenceDateMissing, false);
    // CONTROL: same call, same reference, only the missing-date field differs.
    const flagged = computeDayGaps({
      totals,
      goals: {
        netCarbsCeiling: 50,
        proteinFloor: null,
        proteinReferenceG: 67,
        proteinReferenceMissingDate: 'due-date',
      },
      t,
    });
    assert.equal(flagged.protein.referenceDateMissing, true);
  });

  it('leaves it false when the caller passes no missing date at all', () => {
    const { protein, fiber, netCarbs } = computeDayGaps({
      totals,
      goals: { netCarbsCeiling: 50, proteinFloor: null, proteinReferenceG: 62 },
      t,
    });
    assert.equal(protein.referenceDateMissing, false);
    // The other two rows never carry it: fiber's reference has no date behind
    // it, and a ceiling is always the person's own figure.
    assert.equal(fiber.referenceDateMissing, false);
    assert.equal(netCarbs.referenceDateMissing, false);
  });

  it('leaves it false for a floor the person set themselves', () => {
    const { protein } = computeDayGaps({
      totals,
      goals: {
        netCarbsCeiling: 50,
        proteinFloor: 100,
        proteinReferenceG: 86,
        proteinReferenceMissingDate: 'due-date',
      },
      t,
    });
    // The reference was never used, so no fallback happened to report.
    assert.equal(protein.targetSource, 'goal');
    assert.equal(protein.referenceDateMissing, false);
  });

  it('leaves it false when there is no protein target at all', () => {
    const { protein } = computeDayGaps({
      totals,
      goals: { netCarbsCeiling: 50, proteinFloor: null, proteinReferenceMissingDate: 'due-date' },
      t,
    });
    assert.equal(protein.targetSource, 'none');
    assert.equal(protein.referenceDateMissing, false);
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
    assert.equal(describeGap(gapsFor({ netCarbs: 20, protein: 46, fiber: 10 }).protein, formatMacroNumber, t), '54 g still needed');
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


/**
 * The day's one verdict, per lens (M210).
 *
 * The boundaries are the whole test: a tier that moves by one calorie is the
 * kind of change nobody sees in a screenshot and everybody feels on the card.
 * Each assertion below has its neighbour beside it, so a threshold moved in
 * either direction fails here.
 */
describe('dayVerdict', () => {
  const KCAL_TARGET = 2000;

  /** Gaps for a day, from the real formatter, so a verdict is never graded against a hand-typed impact. */
  function gapsFor({ netCarbs, ceiling }: { netCarbs: number; ceiling: number | null }): DayGaps {
    return computeDayGaps({
      totals: { netCarbs, protein: 60, fiber: 12 },
      goals: { netCarbsCeiling: ceiling, proteinFloor: 100 },
      t,
    });
  }

  const NO_KCAL = { consumed: 1500, target: null };
  const NO_PROTEIN = { consumed: 60, floor: null };

  it('renders the carb impact for a carb lens', () => {
    const gaps = gapsFor({ netCarbs: 45, ceiling: 50 });
    const verdict = dayVerdict({ lens: 'carb', gaps, kcal: NO_KCAL, protein: NO_PROTEIN });
    assert.equal(verdict.lens, 'carb');
    assert.equal(verdict.lens === 'carb' && verdict.impact.level, 'high');
  });

  it('grades nothing for a carb lens with no ceiling, rather than inventing one', () => {
    const gaps = gapsFor({ netCarbs: 45, ceiling: null });
    assert.equal(dayVerdict({ lens: 'carb', gaps, kcal: NO_KCAL, protein: NO_PROTEIN }).lens, 'none');
  });

  /** The kcal tier for a day, with everything else held constant. */
  function kcalTierFor(consumed: number): string {
    const verdict = dayVerdict({
      lens: 'kcal',
      gaps: gapsFor({ netCarbs: 20, ceiling: null }),
      kcal: { consumed, target: KCAL_TARGET },
      protein: NO_PROTEIN,
    });
    return verdict.lens === 'kcal' ? verdict.tier : verdict.lens;
  }

  it('reads within the budget below 0.9 of the target, and near it from 0.9', () => {
    assert.equal(kcalTierFor(0.89 * KCAL_TARGET), 'within');
    assert.equal(kcalTierFor(0.9 * KCAL_TARGET), 'near');
  });

  it('still reads near at exactly the target, and over only above it', () => {
    assert.equal(kcalTierFor(KCAL_TARGET), 'near');
    assert.equal(kcalTierFor(1.01 * KCAL_TARGET), 'over');
  });

  it('reports the remaining and over-by calories, never a negative one', () => {
    const under = dayVerdict({
      lens: 'kcal',
      gaps: gapsFor({ netCarbs: 20, ceiling: null }),
      kcal: { consumed: 1500, target: KCAL_TARGET },
      protein: NO_PROTEIN,
    });
    assert.deepEqual(
      under.lens === 'kcal' ? [under.remainingKcal, under.overByKcal, under.fraction] : null,
      [500, 0, 0.75],
    );
    const over = dayVerdict({
      lens: 'kcal',
      gaps: gapsFor({ netCarbs: 20, ceiling: null }),
      kcal: { consumed: 2400, target: KCAL_TARGET },
      protein: NO_PROTEIN,
    });
    assert.deepEqual(
      over.lens === 'kcal' ? [over.remainingKcal, over.overByKcal, over.fraction] : null,
      [0, 400, 1],
    );
  });

  it('grades nothing for a kcal lens with no target', () => {
    const gaps = gapsFor({ netCarbs: 20, ceiling: null });
    assert.equal(dayVerdict({ lens: 'kcal', gaps, kcal: NO_KCAL, protein: NO_PROTEIN }).lens, 'none');
    assert.equal(
      dayVerdict({ lens: 'kcal', gaps, kcal: { consumed: 1500, target: 0 }, protein: NO_PROTEIN }).lens,
      'none',
    );
  });

  /** The protein state for a day, with everything else held constant. */
  function proteinStateFor(consumed: number): string {
    const verdict = dayVerdict({
      lens: 'protein',
      gaps: gapsFor({ netCarbs: 20, ceiling: null }),
      kcal: NO_KCAL,
      protein: { consumed, floor: 120 },
    });
    return verdict.lens === 'protein' ? verdict.state : verdict.lens;
  }

  it('reads to-go just under the floor and met at it', () => {
    assert.equal(proteinStateFor(119.4), 'toGo');
    assert.equal(proteinStateFor(120), 'met');
  });

  it('rounds both sides before the comparison, so a sub-gram shortfall does not read as unmet', () => {
    // 119.6 g renders as "120 g"; a verdict decided on the raw value would say
    // "1 g to go" beside it.
    assert.equal(proteinStateFor(119.6), 'met');
  });

  it('reports the grams still to go, and zero once met', () => {
    const toGo = dayVerdict({
      lens: 'protein',
      gaps: gapsFor({ netCarbs: 20, ceiling: null }),
      kcal: NO_KCAL,
      protein: { consumed: 80, floor: 120 },
    });
    assert.equal(toGo.lens === 'protein' && toGo.remainingG, 40);
    const met = dayVerdict({
      lens: 'protein',
      gaps: gapsFor({ netCarbs: 20, ceiling: null }),
      kcal: NO_KCAL,
      protein: { consumed: 140, floor: 120 },
    });
    assert.equal(met.lens === 'protein' && met.remainingG, 0);
  });

  it('grades nothing for a protein lens with no floor the person set', () => {
    const gaps = gapsFor({ netCarbs: 20, ceiling: null });
    assert.equal(dayVerdict({ lens: 'protein', gaps, kcal: NO_KCAL, protein: NO_PROTEIN }).lens, 'none');
  });

  it('grades nothing for the none lens, even with every number available', () => {
    const verdict = dayVerdict({
      lens: 'none',
      gaps: gapsFor({ netCarbs: 45, ceiling: 50 }),
      kcal: { consumed: 2400, target: KCAL_TARGET },
      protein: { consumed: 40, floor: 120 },
    });
    // The control for this one is the line above it: the same figures under a
    // carb lens DO produce a verdict, so a `none` that graded anything would
    // fail here rather than pass vacuously.
    assert.equal(verdict.lens, 'none');
    assert.equal(
      dayVerdict({
        lens: 'carb',
        gaps: gapsFor({ netCarbs: 45, ceiling: 50 }),
        kcal: { consumed: 2400, target: KCAL_TARGET },
        protein: { consumed: 40, floor: 120 },
      }).lens,
      'carb',
    );
  });
});

/** Whether a module's source still declares the reference. */
function declaresCarbReference(source: string): boolean {
  return source.includes('DEFAULT_NET_CARB_REFERENCE_G');
}

/**
 * The 50 g reference is GONE from the source, not merely unused.
 *
 * A dead export is exactly the thing a future reader wires back in, and the
 * milestone's decision was that a goal-less day has no carb line at all. The
 * check reads the module's own text, because a deleted export cannot be
 * imported to assert against.
 */
describe('the deleted 50 g carb reference', () => {
  it('no longer appears anywhere in macro-gaps.ts', () => {
    const source = readFileSync(fileURLToPath(new URL('../../app/lib/macro-gaps.ts', import.meta.url)), 'utf8');
    assert.equal(declaresCarbReference(source), false);
    // Control: the same check on a source that DOES declare it must be true,
    // or the assertion above would pass against any string at all.
    assert.equal(declaresCarbReference('export const DEFAULT_NET_CARB_REFERENCE_G = 50;'), true);
  });
});
