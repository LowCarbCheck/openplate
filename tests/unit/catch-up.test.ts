/**
 * Unit tests for `#app/models/catch-up`, the module that turns the last three
 * days into words.
 *
 * Every expected sentence below is asserted in full against the SHIPPED
 * English catalog, not against a key name. That is deliberate: this module's
 * whole product is the wording, so a test that only checked the key spelling
 * would pass while the app said something nobody agreed to.
 *
 * The shapes pinned here are the four the spec names: a normal day, a fasting
 * day (never "0 meals"), an empty yesterday, and a fast in progress ahead,
 * plus the body truncation the notification depends on. The nudge has its own
 * file (`catch-up-nudge.test.ts`) and the banned word list has a third
 * (`catch-up-tone.test.ts`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import i18next from '../../app/i18n/i18n';
import {
  CATCH_UP_BODY_MAX_LENGTH,
  CATCH_UP_URL,
  buildCatchUp,
  resolveFallbackFoods,
  truncateCatchUpBody,
} from '../../app/models/catch-up';
import type { CatchUpDay, CatchUpFast, CatchUpGoals, CatchUpInput } from '../../app/models/catch-up';
import type { Translate } from '../../app/models/fasting';

/** The REAL catalog. See the module doc: these are copy assertions, not key assertions. */
const t: Translate = (key, params) => i18next.t(key, params ?? {});

const TODAY = '2026-09-12';
const YESTERDAY = '2026-09-11';

/** A day with entries; every test overrides what it cares about. */
function day(overrides: Partial<CatchUpDay> & { dayKey: string }): CatchUpDay {
  return { meals: 3, netCarbsG: 42, proteinG: 96, kcal: 1800, fatG: 60, fiberG: 28, ...overrides };
}

/** Three logged days, all comfortably inside every goal, so nothing nudges by accident. */
const GOOD_DAYS: CatchUpDay[] = [
  day({ dayKey: YESTERDAY }),
  day({ dayKey: '2026-09-10' }),
  day({ dayKey: '2026-09-09' }),
];

const BOTH_GOALS: CatchUpGoals = { netCarbsCeiling: 50, proteinFloor: 90, kcalTarget: 1800 };

const NO_FAST: CatchUpFast = { status: 'none', coveredYesterday: false };

function input(overrides: Partial<CatchUpInput> = {}): CatchUpInput {
  return {
    days: GOOD_DAYS,
    goals: BOTH_GOALS,
    fast: NO_FAST,
    recentFoods: [],
    fallbackFoods: resolveFallbackFoods(t),
    today: TODAY,
    locale: 'en',
    t,
    ...overrides,
  };
}

describe('buildCatchUp, yesterday in one sentence', () => {
  it('names the meals, the carbs against the ceiling and the protein against the floor', () => {
    const result = buildCatchUp(input());

    assert.equal(result.title, 'Your daily catch-up');
    assert.equal(result.forDay, TODAY);
    assert.equal(result.url, CATCH_UP_URL);
    assert.deepEqual(result.lines, [
      'Yesterday: 3 meals, 42 g net carbs of your 50 g ceiling, 96 g protein of your 90 g floor.',
    ]);
  });

  it('says "1 meal", not "1 meals"', () => {
    const days = [day({ dayKey: YESTERDAY, meals: 1 }), ...GOOD_DAYS.slice(1)];
    const result = buildCatchUp(input({ days }));

    assert.equal(
      result.lines[0],
      'Yesterday: 1 meal, 42 g net carbs of your 50 g ceiling, 96 g protein of your 90 g floor.',
    );
  });

  it('drops the ceiling half for somebody who set no carb ceiling', () => {
    const result = buildCatchUp(input({ goals: { netCarbsCeiling: null, proteinFloor: 90, kcalTarget: null } }));

    assert.equal(result.lines[0], 'Yesterday: 3 meals, 42 g net carbs, 96 g protein of your 90 g floor.');
  });

  it('drops the floor half for somebody who set no protein floor', () => {
    const result = buildCatchUp(input({ goals: { netCarbsCeiling: 50, proteinFloor: null, kcalTarget: null } }));

    assert.equal(result.lines[0], 'Yesterday: 3 meals, 42 g net carbs of your 50 g ceiling, 96 g protein.');
  });

  it('names no goal at all for somebody who set none', () => {
    const result = buildCatchUp(input({ goals: { netCarbsCeiling: null, proteinFloor: null, kcalTarget: null } }));

    assert.equal(result.lines[0], 'Yesterday: 3 meals, 42 g net carbs, 96 g protein.');
  });

  it('rounds to whole grams, because a decimal gram is noise in a sentence', () => {
    const days = [day({ dayKey: YESTERDAY, netCarbsG: 42.4, proteinG: 95.6 }), ...GOOD_DAYS.slice(1)];
    const result = buildCatchUp(input({ days }));

    assert.equal(
      result.lines[0],
      'Yesterday: 3 meals, 42 g net carbs of your 50 g ceiling, 96 g protein of your 90 g floor.',
    );
  });

  it('reads yesterday off the LATEST day key, whatever order the caller passed them in', () => {
    const days = [...GOOD_DAYS].toReversed();
    const yesterdayOnly = [day({ dayKey: YESTERDAY, meals: 5 }), ...GOOD_DAYS.slice(1)].toReversed();
    const result = buildCatchUp(input({ days: yesterdayOnly }));

    assert.match(result.lines[0] ?? '', /^Yesterday: 5 meals,/);
    assert.equal(buildCatchUp(input({ days })).lines[0], buildCatchUp(input()).lines[0]);
  });
});

describe('buildCatchUp, a fasting day is not an empty day', () => {
  it('says "Yesterday was a fasting day." when a fast covered a day with no entries', () => {
    const days = [day({ dayKey: YESTERDAY, meals: 0, netCarbsG: 0, proteinG: 0, kcal: 0, fiberG: 0 }), ...GOOD_DAYS.slice(1)];
    const result = buildCatchUp(input({ days, fast: { status: 'none', coveredYesterday: true } }));

    assert.deepEqual(result.lines, ['Yesterday was a fasting day.']);
    // The control: the same day WITHOUT a fast reads as empty, so this
    // assertion cannot be passing on the day shape alone.
    assert.deepEqual(buildCatchUp(input({ days })).lines, ['Yesterday had no entries. Today starts fresh.']);
  });

  it('never reads "0 meals"', () => {
    const days = [day({ dayKey: YESTERDAY, meals: 0, netCarbsG: 0, proteinG: 0, kcal: 0, fiberG: 0 }), ...GOOD_DAYS.slice(1)];

    for (const covered of [true, false]) {
      const result = buildCatchUp(input({ days, fast: { status: 'none', coveredYesterday: covered } }));
      assert.ok(!result.body.includes('0 meals'), result.body);
    }
  });
});

describe('buildCatchUp, an empty yesterday', () => {
  it('starts fresh and carries no nudge, even after three days under every floor', () => {
    const days = [
      day({ dayKey: YESTERDAY, meals: 0, netCarbsG: 0, proteinG: 0, kcal: 0, fiberG: 0 }),
      day({ dayKey: '2026-09-10', proteinG: 10, fiberG: 2 }),
      day({ dayKey: '2026-09-09', proteinG: 12, fiberG: 3 }),
    ];
    const result = buildCatchUp(input({ days }));

    assert.deepEqual(result.lines, ['Yesterday had no entries. Today starts fresh.']);
  });

  it('treats no days at all as an empty yesterday', () => {
    assert.deepEqual(buildCatchUp(input({ days: [] })).lines, ['Yesterday had no entries. Today starts fresh.']);
  });
});

describe('buildCatchUp, what lies ahead', () => {
  it('names a fast in progress', () => {
    const result = buildCatchUp(
      input({ fast: { status: 'active', elapsedLabel: '14 h', coveredYesterday: false } }),
    );

    assert.equal(result.lines[1], 'Your fast has been running for 14 h.');
  });

  it('names a scheduled start', () => {
    const result = buildCatchUp(
      input({ fast: { status: 'scheduled', startsAtLabel: '20:00', coveredYesterday: false } }),
    );

    assert.equal(result.lines[1], 'Your fast starts at 20:00.');
  });

  it('falls back to the routine when no fast is open', () => {
    const result = buildCatchUp(
      input({ fast: { status: 'none', routineStartLabel: '20:00', coveredYesterday: false } }),
    );

    assert.equal(result.lines[1], 'Your usual fast starts at 20:00.');
  });

  it('prefers the running fast over the routine, because a routine has nothing to add once a fast exists', () => {
    const result = buildCatchUp(
      input({
        fast: { status: 'active', elapsedLabel: '14 h', routineStartLabel: '20:00', coveredYesterday: false },
      }),
    );

    assert.equal(result.lines[1], 'Your fast has been running for 14 h.');
    assert.equal(result.lines.length, 2);
  });

  it('says nothing at all when there is nothing ahead', () => {
    assert.equal(buildCatchUp(input()).lines.length, 1);
  });
});

describe('buildCatchUp, the notification body', () => {
  it('is line one and line two, joined by a space', () => {
    const result = buildCatchUp(
      input({ fast: { status: 'active', elapsedLabel: '14 h', coveredYesterday: false } }),
    );

    assert.equal(result.body, `${result.lines[0]} ${result.lines[1]}`);
  });

  it('leaves the nudge out of the body, it is the line you open the app for', () => {
    const days = [
      day({ dayKey: YESTERDAY, proteinG: 40 }),
      day({ dayKey: '2026-09-10', proteinG: 45 }),
      day({ dayKey: '2026-09-09', proteinG: 120 }),
    ];
    const result = buildCatchUp(input({ days }));

    assert.equal(result.lines.length, 2);
    assert.equal(result.body, result.lines[0]);
  });

  it('cuts a long body at a word boundary, with no ellipsis', () => {
    const longLabel = 'fourteen hours and twenty three minutes, counted from yesterday evening at eight';
    const result = buildCatchUp(
      input({ fast: { status: 'active', elapsedLabel: longLabel, coveredYesterday: false } }),
    );
    const full = `${result.lines[0]} ${result.lines[1]}`;

    assert.ok(full.length > CATCH_UP_BODY_MAX_LENGTH, 'the fixture must actually be too long');
    assert.ok(result.body.length <= CATCH_UP_BODY_MAX_LENGTH, result.body);
    assert.ok(full.startsWith(result.body));
    // The cut landed on a boundary, not inside a word.
    assert.equal(full.charAt(result.body.length), ' ');
    assert.ok(!result.body.endsWith('…'));
    assert.ok(!result.body.endsWith('...'));
  });
});

describe('truncateCatchUpBody', () => {
  it('leaves a short body alone', () => {
    assert.equal(truncateCatchUpBody('Short enough.'), 'Short enough.');
  });

  it('keeps a body of exactly the limit', () => {
    const exact = 'a'.repeat(CATCH_UP_BODY_MAX_LENGTH);
    assert.equal(truncateCatchUpBody(exact), exact);
  });

  it('cuts at the last space inside the limit', () => {
    const text = `${'word '.repeat(50)}tail`;
    const cut = truncateCatchUpBody(text);

    assert.ok(cut.length <= CATCH_UP_BODY_MAX_LENGTH);
    assert.ok(!cut.endsWith(' '));
    assert.ok(text.startsWith(cut));
    assert.equal(text.charAt(cut.length), ' ');
  });

  it('hard-cuts a single word longer than the limit rather than returning nothing', () => {
    const oneWord = 'x'.repeat(CATCH_UP_BODY_MAX_LENGTH + 40);
    assert.equal(truncateCatchUpBody(oneWord).length, CATCH_UP_BODY_MAX_LENGTH);
  });
});
