/**
 * Unit tests for `#app/lib/weight-units` — the pure kg <-> lb conversion
 * helpers shared by any screen that lets someone enter a body weight.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatKgForDisplay,
  fromKg,
  parseDisplayWeightToKg,
  roundWeightForDisplay,
  toKg,
  toWeightSubmitValue,
} from '../../app/lib/weight-units';

describe('toKg', () => {
  it('leaves a kg value unchanged', () => {
    assert.equal(toKg(72, 'kg'), 72);
  });

  it('converts pounds to kilograms', () => {
    assert.equal(Math.round(toKg(160, 'lb') * 100) / 100, 72.57);
  });
});

describe('fromKg', () => {
  it('leaves a kg value unchanged', () => {
    assert.equal(fromKg(72, 'kg'), 72);
  });

  it('converts kilograms to pounds', () => {
    assert.equal(Math.round(fromKg(72, 'lb') * 100) / 100, 158.73);
  });

  it('round-trips through toKg/fromKg for pounds', () => {
    const originalLb = 185;
    const kg = toKg(originalLb, 'lb');
    assert.equal(roundWeightForDisplay(fromKg(kg, 'lb')), originalLb);
  });
});

describe('roundWeightForDisplay', () => {
  it('rounds to 1 decimal place', () => {
    assert.equal(roundWeightForDisplay(72.34), 72.3);
    assert.equal(roundWeightForDisplay(72.36), 72.4);
  });
});

describe('formatKgForDisplay', () => {
  it('formats a kg value in the requested unit', () => {
    assert.equal(formatKgForDisplay(72, 'kg'), '72');
    assert.equal(formatKgForDisplay(72, 'lb'), '158.7');
  });

  it('returns an empty string for null rather than fabricating 0', () => {
    assert.equal(formatKgForDisplay(null, 'kg'), '');
    assert.equal(formatKgForDisplay(null, 'lb'), '');
  });
});

describe('parseDisplayWeightToKg', () => {
  it('parses a kg value as-is', () => {
    assert.equal(parseDisplayWeightToKg('72.345', 'kg'), 72.35);
  });

  it('converts a pound value to kilograms', () => {
    assert.equal(parseDisplayWeightToKg('160', 'lb'), 72.57);
  });

  it('resolves blank, zero, negative, or non-numeric input to null', () => {
    assert.equal(parseDisplayWeightToKg('', 'kg'), null);
    assert.equal(parseDisplayWeightToKg('   ', 'lb'), null);
    assert.equal(parseDisplayWeightToKg('0', 'kg'), null);
    assert.equal(parseDisplayWeightToKg('-10', 'lb'), null);
    assert.equal(parseDisplayWeightToKg('heavy', 'kg'), null);
  });

  it('accepts a decimal comma, the separator most of Europe types', () => {
    assert.equal(parseDisplayWeightToKg('72,5', 'kg'), 72.5);
    assert.equal(parseDisplayWeightToKg(' 72,5 ', 'kg'), 72.5);
    // Same value via the pound unit: 160 lb reads the same typed either way.
    assert.equal(parseDisplayWeightToKg('160,0', 'lb'), parseDisplayWeightToKg('160.0', 'lb'));
    assert.equal(parseDisplayWeightToKg('160,5', 'lb'), 72.8);
  });

  it('leaves decimal-point input untouched', () => {
    assert.equal(parseDisplayWeightToKg('72.5', 'kg'), 72.5);
  });

  it('rejects ambiguous comma usage rather than guessing at it', () => {
    assert.equal(parseDisplayWeightToKg('1.234,5', 'kg'), null);
    assert.equal(parseDisplayWeightToKg('7,,5', 'kg'), null);
    assert.equal(parseDisplayWeightToKg('1,234,5', 'kg'), null);
    // A thousands separator would otherwise read as 1.234 kg — a silent 1000x error.
    assert.equal(parseDisplayWeightToKg('1,234', 'kg'), 1.23);
  });
});

describe('toWeightSubmitValue', () => {
  it('submits the parsed kilograms when the text reads as a weight', () => {
    assert.equal(toWeightSubmitValue('72,5', 'kg'), '72.5');
    assert.equal(toWeightSubmitValue('72.5', 'kg'), '72.5');
    assert.equal(toWeightSubmitValue('160', 'lb'), '72.57');
  });

  it('submits blank for a blank field, which every weight field reads as "skip"', () => {
    assert.equal(toWeightSubmitValue('', 'kg'), '');
    assert.equal(toWeightSubmitValue('   ', 'lb'), '');
  });

  it('passes unreadable text through so it can be rejected, never silently blanked', () => {
    assert.equal(toWeightSubmitValue('heavy', 'kg'), 'heavy');
    assert.equal(toWeightSubmitValue('1.234,5', 'kg'), '1.234,5');
    assert.equal(toWeightSubmitValue('0', 'kg'), '0');
  });
});
