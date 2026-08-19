/**
 * Unit tests for `#app/lib/macro-sanity` — the pure per-100g plausibility
 * checks behind the scan confirm step's amber "double-check" note. Covers all
 * three rules plus their tolerances. No React/DB/network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkMacroSanity, type Translate } from '../../app/lib/macro-sanity';
import type { Macros } from '../../app/lib/macros';

/**
 * Fake translator: echoes the key plus its interpolation params, so the
 * assertions below can still pin BOTH which message a rule produced and the
 * numbers it computed — the two things these tests were always about — without
 * depending on the catalog's current English wording.
 */
const t: Translate = (key, params) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`);

/** All fields null by default so each test declares only what it exercises. */
function makeMacros(overrides: Partial<Macros> = {}): Macros {
  return {
    carbs: null,
    fiber: null,
    sugars: null,
    polyols: null,
    protein: null,
    fat: null,
    kcal: null,
    ...overrides,
  };
}

describe('checkMacroSanity — sane input', () => {
  it('returns no issues when the numbers are internally consistent', () => {
    // computed kcal = 4*10 + 4*8 + 9*4 = 108, matching the stated 108.
    const issues = checkMacroSanity(makeMacros({ carbs: 10, protein: 8, fat: 4, kcal: 108 }), t, 'en');
    assert.deepStrictEqual(issues, []);
  });

  it('returns no issues for an all-unknown macro set', () => {
    assert.deepStrictEqual(checkMacroSanity(makeMacros(), t, 'en'), []);
  });
});

describe('checkMacroSanity — single macro over 100 g/100 g', () => {
  it('flags a single gram-macro above 100', () => {
    const issues = checkMacroSanity(makeMacros({ fat: 104 }), t, 'en');
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0]?.code, 'single-macro-over-100');
    assert.match(issues[0]?.message ?? '', /^scan\.review\.sanity\.singleMacroOver100 /);
    assert.match(issues[0]?.message ?? '', /"label":"scan\.review\.sanity\.macro\.fat"/);
    assert.match(issues[0]?.message ?? '', /"value":"104"/);
  });

  it('allows exactly 100 g (physically possible, e.g. pure oil fat)', () => {
    const issues = checkMacroSanity(makeMacros({ fat: 100 }), t, 'en');
    assert.deepStrictEqual(issues, []);
  });
});

describe('checkMacroSanity — carbs + protein + fat over 105 g/100 g', () => {
  it('flags an impossible macro sum with no single macro over 100', () => {
    const issues = checkMacroSanity(makeMacros({ carbs: 60, protein: 30, fat: 20 }), t, 'en');
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0]?.code, 'macro-sum-over-100');
    assert.match(issues[0]?.message ?? '', /^scan\.review\.sanity\.macroSumOver100 /);
    assert.match(issues[0]?.message ?? '', /"sum":"110"/);
  });

  it('does not flag a sum within the 105 g slack', () => {
    const issues = checkMacroSanity(makeMacros({ carbs: 50, protein: 40, fat: 10 }), t, 'en');
    assert.deepStrictEqual(issues, []);
  });
});

describe('checkMacroSanity — kcal vs macro-derived energy', () => {
  it('flags a stated kcal that diverges past both tolerances', () => {
    const issues = checkMacroSanity(makeMacros({ carbs: 50, protein: 40, fat: 10, kcal: 900 }), t, 'en');
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0]?.code, 'kcal-macro-mismatch');
    assert.strictEqual(
      issues[0]?.message,
      'scan.review.sanity.kcalMismatch {"stated":"900","computed":"450"}',
    );
  });

  it('does not flag when the absolute gap is within 30 kcal (small foods)', () => {
    // 33% relative gap but only 20 kcal absolute — the absolute guard suppresses it.
    const issues = checkMacroSanity(makeMacros({ carbs: 10, kcal: 60 }), t, 'en');
    assert.deepStrictEqual(issues, []);
  });

  it('does not flag when the relative gap is within 20% (large foods)', () => {
    // 100 kcal absolute gap but only 10% relative — the relative guard suppresses it.
    const issues = checkMacroSanity(makeMacros({ fat: 100, kcal: 1000 }), t, 'en');
    assert.deepStrictEqual(issues, []);
  });

  it('does not run the kcal check when no carbs/protein/fat are present', () => {
    assert.deepStrictEqual(checkMacroSanity(makeMacros({ kcal: 500 }), t, 'en'), []);
  });
});

describe('checkMacroSanity — multiple rules', () => {
  it('returns every applicable issue, single-macro first then sum', () => {
    const issues = checkMacroSanity(makeMacros({ fat: 120 }), t, 'en');
    assert.deepStrictEqual(
      issues.map((issue) => issue.code),
      ['single-macro-over-100', 'macro-sum-over-100'],
    );
  });
});

describe('checkMacroSanity — the figures inside the copy follow the UI language', () => {
  it("writes a fractional value with the language's own decimal separator", () => {
    const [english] = checkMacroSanity(makeMacros({ fat: 104.5 }), t, 'en');
    const [german] = checkMacroSanity(makeMacros({ fat: 104.5 }), t, 'de');

    assert.match(english?.message ?? '', /"value":"104\.5"/);
    assert.match(german?.message ?? '', /"value":"104,5"/);
  });

  it('flags the same issues either way — language changes the wording, never the verdict', () => {
    const macros = makeMacros({ carbs: 60, protein: 30, fat: 20 });
    assert.deepStrictEqual(
      checkMacroSanity(macros, t, 'de').map((issue) => issue.code),
      checkMacroSanity(macros, t, 'en').map((issue) => issue.code),
    );
  });
});
