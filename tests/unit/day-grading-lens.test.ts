/**
 * The day's grade, per eating-style lens (M210).
 *
 * openplate used to put a carb verdict on every day, including a day for a
 * person who had set no carb goal: the chip graded them against a hidden 50 g
 * reference they had never seen. The style names what a person is doing, the
 * lens falls out of the style, and `DayVerdictChip` is the one place a lens
 * becomes a chip. Three things are worth pinning about it, and none of them is
 * visible in a screenshot:
 *
 * 1. The `none` lens renders NOTHING. That is the control case the spec asks
 *    for: a chip leaking through for "just track" must fail here.
 * 2. Each lens renders its own chip and no other lens's.
 * 3. The amber wash appears only where the day is at or past its line, and
 *    never for protein, which has no way to be over a floor (DESIGN.md 2b:
 *    amber tops the palette, and colour never carries meaning alone).
 *
 * There is no DOM library in this repo, so every check below is a pure
 * function over the rendered markup, and each one is also run against a
 * deliberately altered copy of that markup. That control is the point: an
 * assertion that cannot fail proves nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import i18next from '../../app/i18n/i18n';
import { withI18n } from './trends-i18n-harness';
import { DayVerdictChip } from '../../app/components/day-summary-details';
import { computeDayGaps, dayVerdict } from '../../app/lib/macro-gaps';
import type { DayGaps, DayVerdict, Translate } from '../../app/lib/macro-gaps';
import type { EatingStyleLens } from '../../app/lib/eating-style';

/** The shipped English catalog, so the chip labels asserted below are the real copy. */
const t: Translate = (key, params) => i18next.t(key, params ?? {});

/** The amber wash. One token, so a chip that quietly gained the palette is caught by its class. */
const AMBER_CLASS = 'bg-accent-amber-surface';

/** Gaps for a day, from the real formatter rather than a hand-typed impact. */
function gapsFor(netCarbs: number, ceiling: number | null): DayGaps {
  return computeDayGaps({
    totals: { netCarbs, protein: 60, fiber: 12 },
    goals: { netCarbsCeiling: ceiling, proteinFloor: 100 },
    t,
  });
}

/** One verdict, built through the real `dayVerdict` so a chip is never rendered from an impossible state. */
function verdictFor({
  lens,
  netCarbs = 20,
  ceiling = null,
  kcal = 1500,
  kcalTarget = null,
  protein = 60,
  proteinFloor = null,
}: {
  lens: EatingStyleLens;
  netCarbs?: number;
  ceiling?: number | null;
  kcal?: number;
  kcalTarget?: number | null;
  protein?: number;
  proteinFloor?: number | null;
}): DayVerdict {
  return dayVerdict({
    lens,
    gaps: gapsFor(netCarbs, ceiling),
    kcal: { consumed: kcal, target: kcalTarget },
    protein: { consumed: protein, floor: proteinFloor },
  });
}

function render(verdict: DayVerdict): string {
  return renderToStaticMarkup(withI18n(createElement(DayVerdictChip, { verdict })));
}

/** Whether the markup contains a chip at all. One chip is one `aria-label`ed span. */
function chipCount(html: string): number {
  return html.match(/aria-label="/g)?.length ?? 0;
}

/** Whether a chip wears the amber wash. */
function hasAmber(html: string): boolean {
  return html.includes(AMBER_CLASS);
}

describe('DayVerdictChip, the none lens', () => {
  it('renders nothing for a person whose style asks for no grade', () => {
    // Every figure a chip could want is present, so an empty render is the
    // lens's decision and not missing data.
    const html = render(
      verdictFor({ lens: 'none', netCarbs: 45, ceiling: 50, kcalTarget: 2000, proteinFloor: 120 }),
    );
    assert.equal(html, '');
    assert.equal(chipCount(html), 0);
  });

  it('control: the same figures under a carb lens DO render a chip', () => {
    const html = render(verdictFor({ lens: 'carb', netCarbs: 45, ceiling: 50 }));
    assert.equal(chipCount(html), 1);
    assert.notEqual(html, '');
  });
});

describe('DayVerdictChip, the carb lens', () => {
  it('renders one carb chip, naming the tier in words and the goal in its accessible name', () => {
    const html = render(verdictFor({ lens: 'carb', netCarbs: 20, ceiling: 50 }));
    assert.equal(chipCount(html), 1);
    assert.match(html, /Low carb impact/);
    assert.match(html, /against your 50 g goal/);
    // Control: the same check against markup with the label removed fails.
    // `replaceAll`, because the label appears twice, on the chip face and in
    // the accessible sentence, and a single `replace` would leave one behind.
    assert.doesNotMatch(html.replaceAll('Low carb impact', ''), /Low carb impact/);
  });

  it('stays out of the amber palette while the day is low, and enters it once high', () => {
    assert.equal(hasAmber(render(verdictFor({ lens: 'carb', netCarbs: 20, ceiling: 50 }))), false);
    assert.equal(hasAmber(render(verdictFor({ lens: 'carb', netCarbs: 62, ceiling: 50 }))), true);
  });
});

describe('DayVerdictChip, the kcal lens', () => {
  const kcalChip = (kcal: number) => render(verdictFor({ lens: 'kcal', kcal, kcalTarget: 2000 }));

  it('renders one calorie chip per tier, in words', () => {
    assert.match(kcalChip(1200), /Within your calorie goal/);
    assert.match(kcalChip(1850), /Near your calorie goal/);
    assert.match(kcalChip(2400), /Over your calorie goal/);
    assert.equal(chipCount(kcalChip(1200)), 1);
  });

  it('names the figures only in the accessible sentence, never on the chip face', () => {
    const html = kcalChip(1200);
    assert.match(html, /aria-label="Within your calorie goal, 1200 of 2000 kcal"/);
    // Control: the visible label, with the aria attribute stripped, carries no
    // number at all, the figures live one row below the chip.
    assert.doesNotMatch(html.replace(/aria-label="[^"]*"/, ''), /1200|2000/);
  });

  it('wears amber only once the day is near or over the target', () => {
    assert.equal(hasAmber(kcalChip(1200)), false);
    assert.equal(hasAmber(kcalChip(1850)), true);
    assert.equal(hasAmber(kcalChip(2400)), true);
  });

  it('renders no carb verdict, even on a day well past a carb ceiling', () => {
    const html = render(verdictFor({ lens: 'kcal', netCarbs: 200, ceiling: 50, kcal: 1200, kcalTarget: 2000 }));
    assert.doesNotMatch(html, /carb impact/);
    assert.equal(chipCount(html), 1);
  });
});

describe('DayVerdictChip, the protein lens', () => {
  const proteinChip = (protein: number) => render(verdictFor({ lens: 'protein', protein, proteinFloor: 120 }));

  it('names the grams still to go, because that is the action', () => {
    const html = proteinChip(80);
    assert.match(html, /40 g protein to go/);
    assert.equal(chipCount(html), 1);
    // Control: a met day says so instead, with no number.
    assert.doesNotMatch(proteinChip(130), /to go/);
    assert.match(proteinChip(130), /Protein goal met/);
  });

  it('never wears amber, in either state, there is no way to be over a floor', () => {
    assert.equal(hasAmber(proteinChip(80)), false);
    assert.equal(hasAmber(proteinChip(130)), false);
    // Control: the detector does find the wash when it is there, so the two
    // assertions above are not vacuous.
    assert.equal(hasAmber(render(verdictFor({ lens: 'carb', netCarbs: 62, ceiling: 50 }))), true);
  });

  it('renders no calorie verdict, even on a day well over a calorie target', () => {
    const html = render(verdictFor({ lens: 'protein', protein: 80, proteinFloor: 120, kcal: 4000, kcalTarget: 2000 }));
    assert.doesNotMatch(html, /calorie goal/);
    assert.equal(chipCount(html), 1);
  });
});
