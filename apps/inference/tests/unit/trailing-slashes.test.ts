/**
 * `stripTrailingSlashes` replaced `value.replace(/\/+$/, '')` in `src/`, the
 * same quadratic expression CodeQL flagged in core (`js/polynomial-redos`). The
 * old expression stays here as the reference: the helper must strip exactly
 * what it stripped, and must do it in one pass on the input that made it slow.
 */
import { describe, expect, it } from 'vitest';
import { stripTrailingSlashes } from '../../src/trailing-slashes.js';

/** The expression the call sites used before. Quadratic on a long slash run that does not end the string. */
const REFERENCE_PATTERN = /\/+$/;

/** The shapes the call sites see: runtime, LCC and OFF base URLs, and the edge cases. */
const DOCUMENTED_INPUTS = [
  '',
  '/',
  '///',
  'no-slash',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:8080/',
  'http://runtime:8080/v1/',
  'http://runtime:8080/v1//',
  'https://lowcarbcheck.test/api/',
  'https://world.openfoodfacts.org',
  'https://world.openfoodfacts.org///',
  'https://example.test/a//b',
  'https://example.test/?next=/',
] as const;

const ADVERSARIAL_RUN = 100_000;
const LINEAR_BUDGET_MS = 50;

describe('stripTrailingSlashes', () => {
  it('strips exactly what the old expression stripped, for every documented input', () => {
    for (const input of DOCUMENTED_INPUTS) {
      expect(stripTrailingSlashes(input), JSON.stringify(input)).toBe(input.replace(REFERENCE_PATTERN, ''));
    }
  });

  it('a long slash run that does not end the value completes within the linear budget', () => {
    const adversarial = `https://x${'/'.repeat(ADVERSARIAL_RUN)}y`;
    const started = performance.now();
    const result = stripTrailingSlashes(adversarial);
    const elapsedMs = performance.now() - started;
    expect(result).toBe(adversarial);
    expect(elapsedMs, `took ${elapsedMs.toFixed(1)} ms`).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it('a long slash run that does end the value is stripped whole within the linear budget', () => {
    const started = performance.now();
    const result = stripTrailingSlashes(`https://x${'/'.repeat(ADVERSARIAL_RUN)}`);
    const elapsedMs = performance.now() - started;
    expect(result).toBe('https://x');
    expect(elapsedMs, `took ${elapsedMs.toFixed(1)} ms`).toBeLessThan(LINEAR_BUDGET_MS);
  });
});
