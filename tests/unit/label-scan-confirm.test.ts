/**
 * The label scan's confirm core (M123/10 phase 2).
 *
 * These tests exist for the four things that make a label read trustworthy,
 * each of which fails SILENTLY if it regresses — a wrong macro entering the
 * diary looks exactly like a right one:
 *
 *  1. a macro the panel never printed stays BLANK, all the way to the form
 *     value (a `0` for polyols is the bug this whole feature exists to kill);
 *  2. `unreadable: true` is terminal even when the model also sent macros;
 *  3. a panel printing BOTH columns cross-checks them against each other, so a
 *     misread digit surfaces as a note rather than as data;
 *  4. a panel printing ONLY a per-serving column still yields a correct
 *     per-100 g figure.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLabelConfirmView,
  buildLabelFoodName,
  buildLabelScanEntry,
  buildLabelScanFood,
  collectLabelSanityIssues,
  defaultLabelLogGrams,
  toLabelMacroFieldValues,
} from '../../app/lib/label-scan-confirm';
import type { LabelReading } from '../../app/services/vision/types';
import type { Translate } from '../../app/lib/macro-sanity';

/** Key-echo translator: these tests assert on issue CODES and shapes, never on wording. */
const t: Translate = (key) => key;

/** A readable panel with both columns; every field overridable per test. */
function panelReading(overrides: Partial<LabelReading> = {}): LabelReading {
  return {
    unreadable: false,
    productName: 'Keto Bar, Chocolate',
    brand: 'Testbrand',
    servingSize: { asPrinted: '1 bar (35 g)', grams: 35 },
    servingsPerPackage: 1,
    macrosPerServing: { carbs: 14.7, fiber: 3.5, sugars: 0.7, polyols: 9.1, protein: 7, fat: 12.6, kcal: 180 },
    macrosPer100g: { carbs: 42, fiber: 10, sugars: 2, polyols: 26, protein: 20, fat: 36, kcal: 514 },
    ...overrides,
  };
}

/** Narrows a view to its readable arm, failing the test rather than the assertion below. */
function readingView(reading: LabelReading) {
  const view = buildLabelConfirmView(reading);
  assert.equal(view.kind, 'reading', 'expected a readable panel');
  if (view.kind !== 'reading') throw new Error('unreachable');
  return view;
}

describe('buildLabelConfirmView — a null macro never becomes a zero', () => {
  it('keeps an unprinted macro null through the view', () => {
    const view = readingView(
      panelReading({
        macrosPerServing: undefined,
        // A panel with no "of which polyols" row at all.
        macrosPer100g: { carbs: 42, fiber: 10, protein: 20, fat: 36, kcal: 514 },
      }),
    );

    assert.equal(view.macrosPer100g.polyols, null);
    assert.equal(view.macrosPer100g.sugars, null);
    assert.equal(view.macrosPer100g.carbs, 42);
  });

  it('renders an unprinted macro as an EMPTY form field, not "0"', () => {
    const view = readingView(
      panelReading({
        macrosPerServing: undefined,
        macrosPer100g: { carbs: 42, fiber: 10, protein: 20, fat: 36, kcal: 514 },
      }),
    );

    const values = toLabelMacroFieldValues(view.macrosPer100g);
    assert.equal(values.polyols, undefined);
    assert.equal(values.sugars, undefined);
    assert.equal(values.carbs, '42');
  });

  it('renders a genuinely printed zero as "0" — absent and zero stay different facts', () => {
    const view = readingView(
      panelReading({
        macrosPerServing: undefined,
        macrosPer100g: { carbs: 42, fiber: 10, sugars: 0, polyols: 26, protein: 20, fat: 36, kcal: 514 },
      }),
    );

    const values = toLabelMacroFieldValues(view.macrosPer100g);
    assert.equal(values.sugars, '0');
    assert.equal(values.polyols, '26');
  });
});

describe('buildLabelConfirmView — unreadable is terminal', () => {
  it('answers unreadable even when the model also returned macros', () => {
    const view = buildLabelConfirmView(panelReading({ unreadable: true, unreadableReason: 'out of focus' }));

    assert.equal(view.kind, 'unreadable');
    if (view.kind !== 'unreadable') throw new Error('unreachable');
    assert.equal(view.reason, 'out of focus');
    // The stray macros must be nowhere on the answer — a `kind: 'reading'`
    // field cannot exist on this arm, which is the point of the union.
    assert.equal('macrosPer100g' in view, false);
  });

  it('answers unreadable with a null reason when the model gave none', () => {
    const view = buildLabelConfirmView(panelReading({ unreadable: true }));
    assert.equal(view.kind, 'unreadable');
    if (view.kind !== 'unreadable') throw new Error('unreachable');
    assert.equal(view.reason, null);
  });
});

describe('buildLabelConfirmView — per-serving only', () => {
  it('converts a per-serving column to per 100 g using the printed serving weight', () => {
    const view = readingView(
      panelReading({
        macrosPer100g: undefined,
        servingSize: { asPrinted: '1 bar (35 g)', grams: 35 },
        macrosPerServing: { carbs: 14.7, fiber: 3.5, sugars: 0.7, polyols: 9.1, protein: 7, fat: 12.6, kcal: 180 },
      }),
    );

    assert.equal(view.basis, 'perServing');
    assert.equal(view.macrosPer100g.carbs, 42);
    assert.equal(view.macrosPer100g.polyols, 26);
    assert.ok(Math.abs((view.macrosPer100g.kcal ?? 0) - 514.2857) < 0.01);
  });

  it('prefers the panel’s own per-100 g column when both are printed', () => {
    const view = readingView(panelReading());
    assert.equal(view.basis, 'per100g');
    assert.equal(view.macrosPer100g.carbs, 42);
  });

  it('degrades to no usable macros — never fabricated ones — when the serving weight is missing', () => {
    const view = readingView(
      panelReading({
        macrosPer100g: undefined,
        servingSize: { asPrinted: '2 pieces' },
      }),
    );

    assert.equal(view.basis, null);
    assert.equal(view.macrosPer100g.carbs, null);
    assert.equal(view.macrosPer100g.polyols, null);
  });
});

describe('collectLabelSanityIssues — the two printed columns cross-check each other', () => {
  it('is silent when the two columns agree within panel rounding', () => {
    const view = readingView(panelReading());
    const issues = collectLabelSanityIssues(view, t, 'en');
    assert.deepEqual(
      issues.map((issue) => issue.code),
      [],
    );
  });

  it('flags a misread digit that makes the two columns disagree', () => {
    // 4.2 g/100 g cannot be true of a bar printing 14.7 g in a 35 g serving —
    // exactly the shape of a dropped or misread leading digit.
    const view = readingView(panelReading({ macrosPer100g: { ...panelReading().macrosPer100g!, carbs: 4.2 } }));
    const issues = collectLabelSanityIssues(view, t, 'en');
    assert.ok(
      issues.some((issue) => issue.code === 'label-columns-disagree'),
      `expected a column disagreement, got ${JSON.stringify(issues.map((i) => i.code))}`,
    );
  });

  it('flags a polyols misread specifically — the row this feature exists for', () => {
    const view = readingView(panelReading({ macrosPer100g: { ...panelReading().macrosPer100g!, polyols: 2.6 } }));
    const issues = collectLabelSanityIssues(view, t, 'en');
    assert.ok(issues.some((issue) => issue.code === 'label-columns-disagree'));
  });

  it('cannot cross-check when only one column was printed, and says nothing', () => {
    const view = readingView(panelReading({ macrosPerServing: undefined }));
    assert.equal(view.convertedPer100g, null);
    assert.deepEqual(
      collectLabelSanityIssues(view, t, 'en').map((issue) => issue.code),
      [],
    );
  });

  it('still runs the shared per-100g rules (the kcal 4/4/9 check) on the converted values', () => {
    const view = readingView(
      panelReading({
        macrosPer100g: undefined,
        macrosPerServing: { carbs: 14.7, fiber: 3.5, sugars: 0.7, polyols: 9.1, protein: 7, fat: 12.6, kcal: 35 },
      }),
    );
    const issues = collectLabelSanityIssues(view, t, 'en');
    assert.ok(issues.some((issue) => issue.code === 'kcal-macro-mismatch'));
  });
});

describe('a confirmed label scan → the reusable custom food', () => {
  it('carries polyols onto both the food and the entry, end to end', () => {
    const view = readingView(panelReading({ macrosPer100g: undefined }));
    const per100g = view.macrosPer100g;
    assert.equal(per100g.polyols, 26);

    const food = buildLabelScanFood({
      name: buildLabelFoodName(view),
      brand: view.brand,
      macrosPer100g: { ...per100g, carbs: 42 },
      carbBasis: view.carbBasis,
      id: 'food-1',
      createdAtMs: 1_700_000_000_000,
    });
    const entry = buildLabelScanEntry({
      name: food.name,
      quantityGrams: defaultLabelLogGrams(view),
      macrosPer100g: per100g,
      carbBasis: view.carbBasis,
      foodId: food.id,
      id: 'log-1',
      loggedAtMs: 1_700_000_000_000,
      dayKey: '2026-08-25',
      createdAtMs: 1_700_000_000_000,
    });

    assert.equal(food.macrosPer100g.polyols, 26);
    assert.equal(food.brand, 'Testbrand');
    assert.equal(food.name, 'Testbrand Keto Bar, Chocolate');
    assert.equal(food.source, 'user');
    // 35 g serving → the per-serving figure the panel printed, recovered.
    assert.equal(entry.quantityGrams, 35);
    assert.ok(Math.abs((entry.macros.polyols ?? 0) - 9.1) < 0.001);
    assert.equal(entry.foodId, 'food-1');
  });

  it('keeps an unprinted macro absent on the stored rows too', () => {
    const view = readingView(
      panelReading({
        macrosPerServing: undefined,
        macrosPer100g: { carbs: 42, fiber: 10, protein: 20, fat: 36, kcal: 514 },
      }),
    );
    const food = buildLabelScanFood({
      name: 'Bar',
      brand: null,
      macrosPer100g: { ...view.macrosPer100g, carbs: 42 },
      carbBasis: view.carbBasis,
      id: 'food-2',
      createdAtMs: 0,
    });
    assert.equal(food.macrosPer100g.polyols, null);
    const entry = buildLabelScanEntry({
      name: 'Bar',
      quantityGrams: 100,
      macrosPer100g: view.macrosPer100g,
      carbBasis: view.carbBasis,
      foodId: 'food-2',
      id: 'log-2',
      loggedAtMs: 0,
      dayKey: '2026-08-25',
      createdAtMs: 0,
    });
    assert.equal(entry.macros.polyols, null);
  });

  it('defaults the logged amount to 100 g when the panel printed no serving weight', () => {
    const view = readingView(panelReading({ servingSize: { asPrinted: '2 pieces' } }));
    assert.equal(defaultLabelLogGrams(view), 100);
  });

  it('does not repeat a brand already inside the product name', () => {
    const view = readingView(panelReading({ productName: 'Testbrand Keto Bar', brand: 'Testbrand' }));
    assert.equal(buildLabelFoodName(view), 'Testbrand Keto Bar');
  });
});
