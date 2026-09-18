/**
 * Unit tests for `#app/lib/gamification/catalog` and `#app/lib/gamification/marks`
 * (M235/01): the frozen signal list, the award catalog derived from it, and
 * the mark id round trip.
 *
 * These are the tests that guard a permanence promise: a signal id and an award
 * key are row keys on every device, so a rename orphans data that no server can
 * repair. Every assertion here is paired with a case that goes red if the
 * opposite were shipped, because an assertion that cannot fail is worse than no
 * assertion at all.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACTIVITY_SIGNALS,
  AWARDS,
  AWARD_KEYS,
  SIGNAL_COUNTS_TOWARD_ACTIVE,
  awardDefinition,
  signalCountsTowardActive,
} from '../../app/lib/gamification/catalog';
import { markId, parseMarkId } from '../../app/lib/gamification/marks';

/** The thresholds one award family carries, in catalog order. */
function thresholdsOf(kind: string): (number | undefined)[] {
  return AWARDS.filter((award) => award.kind === kind).map((award) => award.threshold);
}

describe('ACTIVITY_SIGNALS', () => {
  it('lists the seven signals once each', () => {
    assert.deepStrictEqual(
      [...ACTIVITY_SIGNALS],
      ['log.food', 'log.scan', 'fast.run', 'weight.log', 'meal.repeat', 'pantry.edit', 'backup.export'],
    );
    assert.equal(new Set(ACTIVITY_SIGNALS).size, ACTIVITY_SIGNALS.length);
  });
});

describe('SIGNAL_COUNTS_TOWARD_ACTIVE', () => {
  it('excludes backup.export and nothing else', () => {
    const excluded = Object.entries(SIGNAL_COUNTS_TOWARD_ACTIVE)
      .filter(([, counts]) => !counts)
      .map(([signal]) => signal);

    assert.deepStrictEqual(excluded, ['backup.export']);
  });

  // The control for the assertion above: it would still pass if a second signal
  // were dropped and the list happened to be read in another order, so name the
  // six that must stay true.
  it('keeps every other signal counting toward an active day', () => {
    const counting = ACTIVITY_SIGNALS.filter((signal) => signalCountsTowardActive(signal));

    assert.deepStrictEqual(counting, ['log.food', 'log.scan', 'fast.run', 'weight.log', 'meal.repeat', 'pantry.edit']);
  });

  it('treats a signal this build does not know as not counting', () => {
    assert.equal(signalCountsTowardActive('recipe.cook'), false);
    // Control: the check above is only meaningful because a known signal is true.
    assert.equal(signalCountsTowardActive('log.food'), true);
  });
});

describe('AWARDS', () => {
  it('gives every key exactly once', () => {
    const keys = AWARDS.map((award) => award.key);

    assert.equal(new Set(keys).size, keys.length);
    assert.equal(AWARD_KEYS.size, keys.length);
  });

  it('gives every signal exactly one explorer award', () => {
    for (const signal of ACTIVITY_SIGNALS) {
      const matching = AWARDS.filter((award) => award.kind === 'explorer' && award.signal === signal);

      assert.equal(matching.length, 1, `expected one explorer award for ${signal}`);
      assert.equal(matching[0].key, `explorer.${signal}`);
    }
  });

  it('holds the streak and on-plan thresholds the milestone decided', () => {
    assert.deepStrictEqual(thresholdsOf('streak'), [3, 7, 14, 30, 100]);
    assert.deepStrictEqual(thresholdsOf('onplan'), [7, 14, 30, 100]);
  });

  it('carries a title and a note key derived from the award key', () => {
    for (const award of AWARDS) {
      assert.equal(award.titleKey, `awards.${award.key}.title`);
      assert.equal(award.noteKey, `awards.${award.key}.note`);
    }
  });

  it('sets a signal on explorer awards only, and a threshold on the other two families only', () => {
    for (const award of AWARDS) {
      if (award.kind === 'explorer') {
        assert.notEqual(award.signal, undefined, `${award.key} should name a signal`);
        assert.equal(award.threshold, undefined, `${award.key} should carry no threshold`);
        continue;
      }
      assert.equal(award.signal, undefined, `${award.key} should name no signal`);
      assert.notEqual(award.threshold, undefined, `${award.key} should carry a threshold`);
    }
  });
});

describe('awardDefinition', () => {
  it('returns the definition for a key this build knows', () => {
    const definition = awardDefinition('streak.active.7');

    assert.equal(definition?.kind, 'streak');
    assert.equal(definition?.threshold, 7);
  });

  it('returns undefined for a key a newer build minted, instead of throwing', () => {
    assert.equal(awardDefinition('explorer.recipe.cook'), undefined);
    assert.equal(awardDefinition(''), undefined);
  });
});

describe('markId and parseMarkId', () => {
  it('round-trips every signal', () => {
    for (const signal of ACTIVITY_SIGNALS) {
      const id = markId('2026-09-18', signal);

      assert.equal(id, `2026-09-18#${signal}`);
      assert.deepStrictEqual(parseMarkId(id), { dayKey: '2026-09-18', signal });
    }
  });

  it('parses a signal id this build does not know, so a newer build’s mark still reads', () => {
    assert.deepStrictEqual(parseMarkId('2026-09-18#recipe.cook'), { dayKey: '2026-09-18', signal: 'recipe.cook' });
  });

  it('returns null for an id that is not one separator with a YYYY-MM-DD left half', () => {
    assert.equal(parseMarkId('2026-09-18'), null, 'no separator');
    assert.equal(parseMarkId('2026-09-18#log.food#extra'), null, 'two separators');
    assert.equal(parseMarkId('18-09-2026#log.food'), null, 'wrong day shape');
    assert.equal(parseMarkId('2026-9-18#log.food'), null, 'day key not zero padded');
    assert.equal(parseMarkId('#log.food'), null, 'no day key');
    assert.equal(parseMarkId('2026-09-18#'), null, 'no signal');
    // Control: the six rejections above would all pass against a parser that
    // returns null for everything, so prove the same parser accepts a real id.
    assert.notEqual(parseMarkId('2026-09-18#log.food'), null);
  });
});
