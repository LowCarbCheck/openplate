/**
 * Unit tests for `#app/models/fasting-stages`, the six-stage ladder the
 * `/fasting` screen reads beside the elapsed clock.
 *
 * What this file pins, in one sentence each:
 *
 * - **The ladder is a PARTITION.** Every hour from 0 to 100 maps to exactly one
 *   stage: strictly increasing boundaries, no gap, no overlap. A gap would show
 *   the person nothing at all for an hour of a real fast.
 * - **The boundary belongs to the new stage**, and one millisecond earlier
 *   still belongs to the old one.
 * - **`fed` is never fresh**, so the "just entered" flourish cannot fire on the
 *   first hour of every fast and mean nothing.
 * - **The intended English copy makes no claim.** The comment block in the
 *   source is read back out of the file and swept for claim words, with a
 *   control string that proves the sweep can fail.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FASTING_STAGES,
  HEDGE_KEY,
  isFreshStage,
  nextStageAfter,
  stageAt,
  stageEnteredAtMs,
} from '../../app/models/fasting-stages';

const HOUR = 3_600_000;
const MINUTE = 60_000;

describe('the stage ladder', () => {
  it('carries the six ids in elapsed order with the agreed start hours', () => {
    assert.deepEqual(
      FASTING_STAGES.map((stage) => [stage.id, stage.startsAtHours]),
      [
        ['fed', 0],
        ['early', 4],
        ['low-stores', 12],
        ['rising-ketones', 16],
        ['ketosis', 24],
        ['extended', 72],
      ],
    );
  });

  it('derives both catalog keys from the id', () => {
    for (const stage of FASTING_STAGES) {
      assert.equal(stage.nameKey, `fasting.stages.${stage.id}.name`);
      assert.equal(stage.sentenceKey, `fasting.stages.${stage.id}.sentence`);
    }
    assert.equal(HEDGE_KEY, 'fasting.stages.hedge');
  });

  it('starts at zero and increases strictly', () => {
    assert.equal(FASTING_STAGES[0].startsAtHours, 0);
    for (let index = 1; index < FASTING_STAGES.length; index += 1) {
      assert.ok(
        FASTING_STAGES[index].startsAtHours > FASTING_STAGES[index - 1].startsAtHours,
        `stage ${FASTING_STAGES[index].id} does not start after ${FASTING_STAGES[index - 1].id}`,
      );
    }
  });

  it('maps every hour from 0 to 100 to exactly one stage', () => {
    for (let hour = 0; hour <= 100; hour += 1) {
      const matches = FASTING_STAGES.filter((stage) => {
        const next = nextStageAfter(stage);
        return hour >= stage.startsAtHours && (next === null || hour < next.startsAtHours);
      });
      assert.equal(matches.length, 1, `hour ${hour} matched ${matches.length} stages`);
      assert.equal(stageAt(hour * HOUR).id, matches[0].id);
    }
  });
});

describe('stageAt', () => {
  it('returns the new stage exactly at each boundary', () => {
    for (const stage of FASTING_STAGES) {
      assert.equal(stageAt(stage.startsAtHours * HOUR).id, stage.id);
    }
  });

  it('returns the previous stage one millisecond before each boundary', () => {
    for (const stage of FASTING_STAGES) {
      if (stage.startsAtHours === 0) continue;
      const previous = FASTING_STAGES[FASTING_STAGES.indexOf(stage) - 1];
      assert.equal(stageAt(stage.startsAtHours * HOUR - 1).id, previous.id);
    }
  });

  it('reads a negative elapsed as fed rather than throwing', () => {
    assert.equal(stageAt(-1).id, 'fed');
    assert.equal(stageAt(-100 * HOUR).id, 'fed');
  });

  it('stays in extended past the last boundary', () => {
    assert.equal(stageAt(72 * HOUR).id, 'extended');
    assert.equal(stageAt(1000 * HOUR).id, 'extended');
  });
});

describe('nextStageAfter', () => {
  it('steps one rung up the ladder', () => {
    assert.equal(nextStageAfter(FASTING_STAGES[0])?.id, 'early');
    assert.equal(nextStageAfter(stageAt(16 * HOUR))?.id, 'ketosis');
  });

  it('is null after extended', () => {
    assert.equal(nextStageAfter(stageAt(72 * HOUR)), null);
  });
});

describe('stageEnteredAtMs', () => {
  it('places the boundary relative to the start instant', () => {
    const startAt = Date.UTC(2026, 8, 11, 20, 0, 0);
    assert.equal(stageEnteredAtMs(startAt, stageAt(0)), startAt);
    assert.equal(stageEnteredAtMs(startAt, stageAt(16 * HOUR)), startAt + 16 * HOUR);
    assert.equal(stageEnteredAtMs(startAt, stageAt(80 * HOUR)), startAt + 72 * HOUR);
  });
});

describe('isFreshStage', () => {
  const risingKetones = stageAt(16 * HOUR);

  it('is true ten minutes into the stage', () => {
    assert.equal(isFreshStage(16 * HOUR + 10 * MINUTE, risingKetones), true);
  });

  it('is true at the exact boundary', () => {
    assert.equal(isFreshStage(16 * HOUR, risingKetones), true);
  });

  it('is false sixty-one minutes into the stage', () => {
    assert.equal(isFreshStage(16 * HOUR + 61 * MINUTE, risingKetones), false);
  });

  it('is false at the very end of the default window', () => {
    assert.equal(isFreshStage(17 * HOUR, risingKetones), false);
  });

  it('is false before the stage has been reached', () => {
    assert.equal(isFreshStage(15 * HOUR, risingKetones), false);
  });

  it('is never true for fed, at any elapsed', () => {
    const fed = FASTING_STAGES[0];
    for (const elapsedMs of [0, MINUTE, 10 * MINUTE, 3 * HOUR]) {
      assert.equal(isFreshStage(elapsedMs, fed), false);
    }
  });

  it('honours a caller-supplied window', () => {
    assert.equal(isFreshStage(16 * HOUR + 10 * MINUTE, risingKetones, 5 * MINUTE), false);
    assert.equal(isFreshStage(16 * HOUR + 10 * MINUTE, risingKetones, 30 * MINUTE), true);
  });
});

describe('the intended English copy in the source', () => {
  /**
   * Claim words openplate's fasting copy may never use: three of them promise
   * an outcome, one names a pseudo-medical process the body does not have. The
   * sweep reads the SOURCE FILE rather than a locale bundle on purpose, this is
   * where the sentences are written down first, before anyone translates them.
   */
  const CLAIM_WORDS = /\b(proven|guaranteed|detox|burns)\b/i;

  const source = readFileSync(new URL('../../app/models/fasting-stages.ts', import.meta.url), 'utf8');
  const block = source.split('INTENDED ENGLISH COPY BEGIN')[1]?.split('INTENDED ENGLISH COPY END')[0] ?? '';

  it('finds the copy block at all', () => {
    assert.ok(block.length > 400, 'the intended-copy block is missing or was emptied');
    for (const stage of FASTING_STAGES) {
      assert.ok(block.includes(`${stage.id}:`), `no intended sentence for ${stage.id}`);
    }
    assert.ok(block.includes('hedge:'), 'no intended sentence for the hedge line');
  });

  it('makes no claim', () => {
    assert.equal(CLAIM_WORDS.test(block), false, 'the intended copy uses a claim word');
  });

  it('CONTROL: the sweep fails on copy that does claim', () => {
    const claiming = 'ketosis: A proven way to detox, it burns fat, results guaranteed.';
    assert.equal(CLAIM_WORDS.test(claiming), true, 'the claim-word sweep cannot fail and proves nothing');
  });
});
