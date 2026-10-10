/**
 * The Overview hero's lead block and ledger, rendered (layout F, 2026-10-11).
 *
 * The wording is pinned in `day-hero-lead.test.ts`; this file pins what only
 * markup can show:
 *
 * 1. **One box in every state.** The meter and its dashed stand-in share a
 *    height, and the figure row and the scale line carry the same reserved
 *    height whatever the day says. The browser tier measures it for real
 *    (`dashboard-lead.spec.ts`); here the class contract that makes it true is
 *    held, with a deliberately broken copy of the markup to prove the reader can
 *    see a difference.
 * 2. **The meter is decoration, the `progress` element is the fact.** A day at
 *    112 of 100 g reports "112 of 100", never a clamped 100.
 * 3. **Colour never carries meaning alone, and amber is the only warning.**
 *    Over is amber text and an amber fill; a reached floor wears a check mark;
 *    nothing here is `destructive`, and no block wears a left border.
 * 4. **No dot in the ledger.** The meter carries the colour.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import i18next from '../../app/i18n/i18n';
import { withI18n } from './trends-i18n-harness';
import { DayBudgetRows } from '../../app/components/day-budget-rows';
import { DayBudgetLead } from '../../app/components/day-budget-lead';
import { buildDayBudgetRows } from '../../app/lib/day-budget-rows';
import type { DayBudgetRow } from '../../app/lib/day-budget-rows';
import { buildHeroLead } from '../../app/lib/day-hero-lead';
import { computeDayGaps } from '../../app/lib/macro-gaps';
import type { Translate } from '../../app/lib/macro-gaps';
import type { MainGoalId } from '../../app/lib/main-goal';

const t: Translate = (key, params) => i18next.t(key, params ?? {});

interface Fixture {
  netCarbs?: number;
  kcal?: number;
  protein?: number;
  fat?: number;
  fiber?: number;
  ceiling?: number | null;
  kcalTarget?: number | null;
  floor?: number | null;
  mainGoal?: MainGoalId;
  entryCount?: number;
}

/** The rows of a day, main goal first, built exactly as the dashboard builds them. */
function buildRows(fixture: Fixture): DayBudgetRow[] {
  const totals = {
    netCarbs: fixture.netCarbs ?? 0,
    kcal: fixture.kcal ?? 0,
    protein: fixture.protein ?? 0,
    fat: fixture.fat ?? 0,
    fiber: fixture.fiber ?? 0,
  };
  const ceiling = fixture.ceiling === undefined ? 100 : fixture.ceiling;
  const floor = fixture.floor === undefined ? 68 : fixture.floor;
  const gaps = computeDayGaps({
    totals: { netCarbs: totals.netCarbs, protein: totals.protein, fiber: totals.fiber },
    goals: {
      netCarbsCeiling: ceiling,
      proteinFloor: floor,
      proteinReferenceG: null,
      proteinReferenceMissingDate: null,
    },
    t,
  });
  return buildDayBudgetRows({
    totals: { ...totals, hasEstimates: false },
    goals: {
      netCarbsCeiling: ceiling,
      kcalTarget: fixture.kcalTarget === undefined ? null : fixture.kcalTarget,
      proteinFloor: floor,
      missingReferenceDate: null,
    },
    gaps,
    t,
    language: 'en',
    mainGoal: fixture.mainGoal ?? 'net-carbs',
  });
}

function renderLead(fixture: Fixture): string {
  const [row] = buildRows(fixture);
  if (row === undefined) throw new Error('no rows');
  const lead = buildHeroLead({ row, entryCount: fixture.entryCount ?? 0, hasEstimates: false, t, language: 'en' });
  return renderToStaticMarkup(withI18n(createElement(MemoryRouter, null, createElement(DayBudgetLead, { lead }))));
}

function renderLedger(fixture: Fixture): string {
  const [, ...rest] = buildRows(fixture);
  return renderToStaticMarkup(
    withI18n(createElement(MemoryRouter, null, createElement(DayBudgetRows, { rows: rest, density: 'ledger' }))),
  );
}

/** The meter box: the filled track, or the dashed stand-in. Exactly one is present. */
function meterTag(markup: string): string {
  const found = /<div data-slot="budget-track(?:-none)?"[^>]*>/.exec(markup);
  if (found === null) throw new Error('the lead drew neither a meter nor its stand-in');
  return found[0];
}

function classOf(tag: string): string {
  return /class="([^"]*)"/.exec(tag)?.[1] ?? '';
}

/** The three states whose box must be one size: logged, over, reached, empty, no target. */
const STATES: ReadonlyArray<readonly [string, Fixture]> = [
  ['empty', { entryCount: 0 }],
  ['logged', { netCarbs: 74, entryCount: 5 }],
  ['over', { netCarbs: 112, entryCount: 9 }],
  ['reached', { protein: 82, mainGoal: 'protein', entryCount: 5 }],
  ['no target', { netCarbs: 74, ceiling: null, entryCount: 5 }],
];

describe('the lead block is one box in every state', () => {
  it('gives the meter and its dashed stand-in the same height and the same gap above', () => {
    const withMeter = classOf(meterTag(renderLead({ netCarbs: 74, entryCount: 5 })));
    const standIn = classOf(meterTag(renderLead({ netCarbs: 74, ceiling: null, entryCount: 5 })));
    for (const token of ['h-2', 'mt-3.5']) {
      assert.ok(withMeter.split(' ').includes(token), `the meter lost ${token}`);
      assert.ok(standIn.split(' ').includes(token), `the no-target stand-in lost ${token}`);
    }
    // CONTROL: the two ARE different elements, so the shared height is a
    // decision and not two identical readings of one thing.
    assert.match(renderLead({ netCarbs: 74, entryCount: 5 }), /data-slot="budget-track"/);
    assert.match(renderLead({ netCarbs: 74, ceiling: null, entryCount: 5 }), /data-slot="budget-track-none"/);
  });

  it('draws the same figure row, meter box and scale reservation in all five states', () => {
    const boxes = STATES.map(([name, fixture]) => {
      const markup = renderLead(fixture);
      return {
        name,
        figureRow: /<div class="(flex items-end gap-x-2\.5)">/.exec(markup)?.[1],
        figureSize: /data-slot="budget-lead-figure" class="[^"]*(text-\[2\.875rem\])/.exec(markup)?.[1],
        meter: classOf(meterTag(markup))
          .split(' ')
          .filter((token) => token.startsWith('h-') || token.startsWith('mt-')),
        scale: /<div class="(mt-1\.5 flex min-h-8[^"]*)"/.exec(markup)?.[1],
      };
    });
    const [first, ...others] = boxes;
    assert.ok(first !== undefined);
    assert.notEqual(first.figureRow, undefined, 'the probe cannot find the figure row');
    assert.notEqual(first.scale, undefined, 'the probe cannot find the scale line');
    for (const other of others) {
      assert.deepEqual({ ...other, name: '' }, { ...first, name: '' }, `${other.name} is not the box ${first.name} is`);
    }
    // CONTROL: the reader can see a difference when there is one.
    const broken = { ...first, scale: first.scale?.replace('min-h-8', 'min-h-4') };
    assert.notDeepEqual(broken, first);
  });
});

describe("the lead keeps the rows' accessibility rule", () => {
  it('reports the real, unclamped figures on a progress element, and states a sentence with no target', () => {
    const over = renderLead({ netCarbs: 112, entryCount: 9 });
    assert.match(over, /<progress[^>]*value="112"[^>]*max="100"/, 'the progress element clamped the day');
    // CONTROL: the meter itself IS clamped, so the two are different facts.
    assert.match(over, /width:100%/);

    const noTarget = renderLead({ netCarbs: 74, ceiling: null, entryCount: 5 });
    assert.doesNotMatch(noTarget, /<progress/, 'a progress element with no maximum');
    assert.match(noTarget, /class="sr-only"/, 'no sentence for a row with no target');
  });

  it('hides the meter from assistive tech, and the scale line is not hidden', () => {
    const markup = renderLead({ netCarbs: 74, entryCount: 5 });
    assert.match(meterTag(markup), /aria-hidden="true"/);
    assert.doesNotMatch(/<span data-slot="budget-lead-scale-start"[^>]*>/.exec(markup)?.[0] ?? '', /aria-hidden/);
  });
});

describe("the lead's colour", () => {
  it('goes amber over a limit, in the figure, the caption and the fill, and never destructive', () => {
    const over = renderLead({ netCarbs: 112, entryCount: 9 });
    assert.match(over, /data-slot="budget-lead-figure" class="[^"]*text-accent-amber/);
    assert.match(over, /data-slot="budget-lead-caption" class="[^"]*text-accent-amber/);
    assert.match(over, /bg-accent-amber/);
    assert.doesNotMatch(over, /destructive/);
    // CONTROL: under the limit the same three are not amber.
    const under = renderLead({ netCarbs: 74, entryCount: 5 });
    assert.doesNotMatch(under, /accent-amber/);
  });

  it('wears the brand and a check mark once a floor is reached, and never amber', () => {
    const met = renderLead({ protein: 82, mainGoal: 'protein', entryCount: 5 });
    assert.match(met, /data-slot="budget-lead-figure" class="[^"]*text-primary/);
    assert.match(met, /lucide-check/, 'the reached state is colour alone');
    assert.doesNotMatch(met, /accent-amber/);
    // CONTROL: still under the floor, no check mark.
    const needed = renderLead({ protein: 54, mainGoal: 'protein', entryCount: 3 });
    assert.doesNotMatch(needed, /lucide-check/);
  });

  it('wears no thick left border, anywhere in the lead or the ledger', () => {
    for (const [name, fixture] of STATES) {
      assert.doesNotMatch(renderLead(fixture), /border-l-(?!0)/, `${name}: a left rule on the lead`);
    }
    assert.doesNotMatch(renderLedger({ netCarbs: 74, entryCount: 5 }), /border-l-(?!0)/);
  });
});

describe('the ledger', () => {
  it("is one bordered block with a row per remaining metric, in the rows' own order", () => {
    const markup = renderLedger({
      netCarbs: 74,
      kcal: 1640,
      kcalTarget: 1950,
      protein: 82,
      fat: 104,
      fiber: 19,
      entryCount: 5,
    });
    assert.match(markup, /^<ul data-slot="budget-ledger" class="border bg-card">/);
    const metrics = [...markup.matchAll(/data-slot="budget-row" data-metric="([a-zA-Z]+)"/g)].map((match) => match[1]);
    // Net carbs leads, so it is not in the ledger; calories is, because a calorie target is set.
    assert.deepEqual(metrics, ['calories', 'protein', 'fat', 'fiber']);
    // CONTROL: with protein leading, protein leaves the ledger and net carbs joins it.
    const proteinLeads = renderLedger({ mainGoal: 'protein', kcal: 1640, kcalTarget: 1950, entryCount: 5 });
    const leadMetrics = [...proteinLeads.matchAll(/data-metric="([a-zA-Z]+)"/g)].map((match) => match[1]);
    assert.deepEqual(leadMetrics, ['netCarbs', 'calories', 'fat', 'fiber']);
  });

  it('draws a status under every value, a meter where there is a target, and no dot', () => {
    const markup = renderLedger({ netCarbs: 74, protein: 82, fat: 104, fiber: 19, kcalTarget: null, entryCount: 5 });
    assert.equal(markup.match(/data-slot="budget-status"/g)?.length, 3, 'one status line per row');
    assert.match(markup, /Reached/, 'the protein row reached its floor');
    assert.match(markup, /no target/, 'the fat row has no target');
    // Protein and fiber have targets; fat does not: two meters and one stand-in.
    assert.equal(markup.match(/data-slot="budget-track"/g)?.length, 2);
    assert.equal(markup.match(/data-slot="budget-track-none"/g)?.length, 1);
    // No status dot: the meter carries the colour.
    assert.doesNotMatch(markup, /rounded-full/);
  });

  it("keeps every row's three columns the same fixed width, so the meters are one length", () => {
    const markup = renderLedger({ netCarbs: 74, protein: 82, fat: 104, fiber: 19, entryCount: 5 });
    const columns = [...markup.matchAll(/grid-cols-\[([^\]]+)\]/g)].map((match) => match[1]);
    // Three rows, each declaring a phone template and a wider one.
    assert.equal(columns.length, 6);
    assert.equal(new Set(columns).size, 2, 'rows size their columns differently');
    assert.doesNotMatch(columns.join(' '), /\bauto\b/, "an auto column sizes itself to the row's own number");
  });

  it('marks a reference row with the word, and lets the date request take a line of its own', () => {
    const rows = buildRows({ netCarbs: 74, floor: null, entryCount: 5 });
    const protein = rows.find((row) => row.key === 'protein');
    assert.ok(protein !== undefined);
    const withReference: DayBudgetRow = { ...protein, targetSource: 'default', referenceDateMissing: false };
    const plain = renderToStaticMarkup(
      withI18n(
        createElement(MemoryRouter, null, createElement(DayBudgetRows, { rows: [withReference], density: 'ledger' })),
      ),
    );
    assert.match(plain, /reference/);
    assert.doesNotMatch(plain, /col-span-3/, 'an ordinary reference tag needs no line of its own');

    const withMissingDate: DayBudgetRow = {
      ...withReference,
      referenceDateMissing: true,
      missingReferenceDate: 'due-date',
    };
    const asked = renderToStaticMarkup(
      withI18n(
        createElement(MemoryRouter, null, createElement(DayBudgetRows, { rows: [withMissingDate], density: 'ledger' })),
      ),
    );
    assert.match(asked, /href="\/settings\/life-phase"/);
    assert.match(asked, /col-span-3/);
  });

  it('leaves the other layouts alone: no density means the filled rows, with their dots', () => {
    const [, ...rest] = buildRows({ netCarbs: 74, protein: 82, entryCount: 5 });
    const filled = renderToStaticMarkup(
      withI18n(createElement(MemoryRouter, null, createElement(DayBudgetRows, { rows: rest }))),
    );
    assert.doesNotMatch(filled, /budget-ledger/);
    assert.match(filled, /rounded-full/, 'the filled rows lost their status dot');
  });
});
