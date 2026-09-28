/**
 * Unit tests for `app/lib/authoritative-net-carbs` — the form encoding for
 * `LocalFoodLog.netCarbsPer100g`.
 *
 * The end-to-end wiring is covered in `authoritative-net-carbs-wiring.test.ts`;
 * what needs pinning HERE is the part that end-to-end test can't reach: the
 * three states must stay mutually distinguishable through a string round trip,
 * and a malformed value must fail OPEN (degrade to "no authoritative figure",
 * i.e. compute from parts) rather than throwing and blocking someone from
 * logging their food.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTHORITATIVE_NET_CARBS_UNKNOWN,
  decodeAuthoritativeNetCarbs,
  encodeAuthoritativeNetCarbs,
} from '../../app/lib/authoritative-net-carbs';

describe('authoritative net-carbs form encoding', () => {
  it('round-trips all three states distinctly', () => {
    for (const value of [21.7, 0, null, undefined]) {
      assert.equal(
        decodeAuthoritativeNetCarbs(encodeAuthoritativeNetCarbs(value)),
        value,
        `state ${String(value)} did not survive the round trip`,
      );
    }
  });

  it('keeps 0 distinct from "unknown" and from "never captured"', () => {
    // The whole defect class this guards is a real figure collapsing into a
    // confident 0, so a genuine 0 must not be confused with either absence.
    assert.notEqual(encodeAuthoritativeNetCarbs(0), encodeAuthoritativeNetCarbs(null));
    assert.notEqual(encodeAuthoritativeNetCarbs(0), encodeAuthoritativeNetCarbs(undefined));
    assert.equal(decodeAuthoritativeNetCarbs('0'), 0);
  });

  it('does not use String(null) as the unknown marker — a stray String() cast must not look correct', () => {
    assert.notEqual(AUTHORITATIVE_NET_CARBS_UNKNOWN, 'null');
    assert.equal(decodeAuthoritativeNetCarbs('null'), undefined);
  });

  it('fails open on malformed input rather than throwing', () => {
    for (const raw of ['abc', '-5', 'NaN', 'Infinity', '', '   ', undefined, null, 42, {}]) {
      assert.equal(
        decodeAuthoritativeNetCarbs(raw),
        undefined,
        `expected ${JSON.stringify(raw)} to degrade to undefined`,
      );
    }
  });

  it('accepts a plain decimal string, the only shape a hidden input actually produces', () => {
    assert.equal(decodeAuthoritativeNetCarbs('21.7'), 21.7);
    assert.equal(decodeAuthoritativeNetCarbs(' 21.7 '), 21.7);
  });
});
