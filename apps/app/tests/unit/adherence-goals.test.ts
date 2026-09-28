/**
 * Unit tests for `#app/lib/adherence-goals`, the ONE builder behind every
 * surface that grades a day.
 *
 * Two claims are pinned here.
 *
 * 1. **The energy addition reaches the grid.** Somebody pregnant is compared
 *    against their own calorie target plus the EFSA addition for their stage,
 *    the same DISPLAYED figure the day's budget rows use. The control is the
 *    identical profile with status `none`, which must keep the stored figure,
 *    so a builder that added nothing at all would fail the pair.
 * 2. **All three surfaces call it.** A source sweep over the three route
 *    files, because a fourth copy of this arithmetic is exactly how the diary
 *    calendar, Overview's grid and the `/trends` grid would start disagreeing
 *    about one day. Read as text: the routes are client-only modules with
 *    IndexedDB imports behind them, so a test cannot import them.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { resolveAdherenceGoals } from '../../app/lib/adherence-goals';
import { EFSA_PREGNANCY_T3_KCAL_ADDITION } from '../../app/models/body-metrics';

const TODAY = '2026-09-11';

/** The three targets, as somebody who set all of them has them stored. */
const GOALS = { netCarbsCeiling: 50, proteinFloor: 90, kcalTarget: 1800 };

/** A third-trimester pregnancy: the due date is inside the next few weeks. */
const PREGNANT = {
  reproductiveStatus: 'pregnant' as const,
  pregnancyDueDate: '2026-10-02',
  lactationStartDate: null,
};

/** The control profile: the same two dates on file, but no stage to adjust for. */
const NO_STAGE = {
  reproductiveStatus: 'none' as const,
  pregnancyDueDate: '2026-10-02',
  lactationStartDate: null,
};

describe('resolveAdherenceGoals', () => {
  it('grades a pregnant person against their target plus the EFSA energy addition', () => {
    const resolved = resolveAdherenceGoals({ goals: GOALS, bodyMetrics: PREGNANT, today: TODAY });
    assert.equal(resolved.stage.trimester, 3);
    assert.equal(resolved.goals.kcalTarget, 1800 + EFSA_PREGNANCY_T3_KCAL_ADDITION);
    assert.equal(resolved.kcalTarget, resolved.goals.kcalTarget);
  });

  it('CONTROL: the same profile with no reproductive status keeps the stored target', () => {
    const resolved = resolveAdherenceGoals({ goals: GOALS, bodyMetrics: NO_STAGE, today: TODAY });
    assert.equal(resolved.goals.kcalTarget, 1800);
    assert.equal(resolved.stage.reproductiveStatus, 'none');
    // And the pair is the point: the adjusted target must be the LARGER one.
    const pregnant = resolveAdherenceGoals({ goals: GOALS, bodyMetrics: PREGNANT, today: TODAY });
    assert.ok(
      (pregnant.goals.kcalTarget ?? 0) > (resolved.goals.kcalTarget ?? 0),
      'a pregnant profile must get a higher kcalTarget than the same profile with no stage',
    );
  });

  it('passes the two figures nobody adjusts through untouched', () => {
    const resolved = resolveAdherenceGoals({ goals: GOALS, bodyMetrics: PREGNANT, today: TODAY });
    assert.equal(resolved.goals.netCarbsCeilingG, 50);
    assert.equal(resolved.goals.proteinFloorG, 90);
  });

  it('adds nothing to a target nobody set, rather than inventing one', () => {
    const resolved = resolveAdherenceGoals({
      goals: { ...GOALS, kcalTarget: null },
      bodyMetrics: PREGNANT,
      today: TODAY,
    });
    assert.equal(resolved.goals.kcalTarget, null);
    assert.equal(resolved.kcalTarget, null);
    // The stage still resolves; the addition simply has nothing to land on.
    assert.equal(resolved.stage.trimester, 3);
  });

  it('falls back to the largest figure for the status when the date is missing', () => {
    const resolved = resolveAdherenceGoals({
      goals: GOALS,
      bodyMetrics: { reproductiveStatus: 'pregnant', pregnancyDueDate: null, lactationStartDate: null },
      today: TODAY,
    });
    assert.equal(resolved.stage.trimester, null);
    assert.equal(resolved.goals.kcalTarget, 1800 + EFSA_PREGNANCY_T3_KCAL_ADDITION);
  });
});

/** Every route that paints a day by its goals, and the file it lives in. */
const ADHERENCE_ROUTES = ['dashboard.tsx', 'diary.tsx', 'trends.tsx'] as const;

function routeSource(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../../app/routes/${file}`, import.meta.url)), 'utf8');
}

describe('the three adherence surfaces share one builder', () => {
  for (const file of ADHERENCE_ROUTES) {
    it(`${file} imports resolveAdherenceGoals from #app/lib/adherence-goals`, () => {
      assert.match(
        routeSource(file),
        /import\s*\{\s*resolveAdherenceGoals\s*\}\s*from\s*'#app\/lib\/adherence-goals'/,
        `${file} must build its adherence goals through the shared builder`,
      );
    });

    /**
     * The control for the import assertion: importing the builder is worth
     * nothing if the route also keeps its own copy of the arithmetic. Both
     * `dashboard.tsx` and `diary.tsx` DID carry these two lines before this
     * change, so this assertion had something to fail against.
     */
    it(`${file} keeps no second copy of the kcal addition`, () => {
      const source = routeSource(file);
      assert.doesNotMatch(
        source,
        /computeReferenceKcalAddition\(/,
        `${file} must read the addition off resolveAdherenceGoals, not compute its own`,
      );
      assert.doesNotMatch(
        source,
        /resolveGestation\(/,
        `${file} must read the stage off resolveAdherenceGoals, not resolve its own`,
      );
    });
  }
});
