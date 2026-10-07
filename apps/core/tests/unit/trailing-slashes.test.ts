/**
 * `stripTrailingSlashes` replaced `value.replace(/\/+$/, '')` at every call
 * site in `src/` (CodeQL `js/polynomial-redos`, alerts 3 to 8). The old
 * expression stays here as the reference: the helper must strip exactly what
 * it stripped, and must do it in one pass on the input that made it quadratic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { stripTrailingSlashes } from '../../src/lib/trailing-slashes.js';

/** The expression the call sites used before. Quadratic on a long slash run that does not end the string. */
const REFERENCE_PATTERN = /\/+$/;

/** The shapes the call sites see: base URLs from config, link bases, pathnames, and the edge cases. */
const DOCUMENTED_INPUTS = [
  '',
  '/',
  '///',
  'no-slash',
  'https://openplate.example',
  'https://openplate.example/',
  'https://openplate.example///',
  'https://app.openplate.example/base/',
  'https://app.openplate.example/base//inner',
  'http://127.0.0.1:8080/api/v1/',
  'https://openrouter.ai/api/v1',
  'https://mail.example.org/api/v1/send/',
  '/api/v1/send//',
  'https://openplate.example/?next=/',
  'https://openplate.example/#/',
  'a/ /',
] as const;

/** n slashes with a character after them: every start position scans the run, and none reaches `$`. */
const ADVERSARIAL_RUN = 100_000;
const LINEAR_BUDGET_MS = 50;

test('strips exactly what the old expression stripped, for every documented input', () => {
  for (const input of DOCUMENTED_INPUTS) {
    assert.equal(stripTrailingSlashes(input), input.replace(REFERENCE_PATTERN, ''), JSON.stringify(input));
  }
});

test('leaves a value with no trailing slash untouched, and strips a whole trailing run', () => {
  assert.equal(stripTrailingSlashes('https://openplate.example/a'), 'https://openplate.example/a');
  assert.equal(stripTrailingSlashes(`https://openplate.example${'/'.repeat(5)}`), 'https://openplate.example');
});

test('a long slash run that does not end the value completes within the linear budget', () => {
  const adversarial = `https://x${'/'.repeat(ADVERSARIAL_RUN)}y`;
  const started = performance.now();
  const result = stripTrailingSlashes(adversarial);
  const elapsedMs = performance.now() - started;
  assert.equal(result, adversarial, 'nothing trails the run, so nothing is stripped');
  assert.ok(elapsedMs < LINEAR_BUDGET_MS, `took ${elapsedMs.toFixed(1)} ms for ${ADVERSARIAL_RUN} slashes`);
});

test('a long slash run that does end the value is stripped whole within the linear budget', () => {
  const trailing = `https://x${'/'.repeat(ADVERSARIAL_RUN)}`;
  const started = performance.now();
  const result = stripTrailingSlashes(trailing);
  const elapsedMs = performance.now() - started;
  assert.equal(result, 'https://x');
  assert.ok(elapsedMs < LINEAR_BUDGET_MS, `took ${elapsedMs.toFixed(1)} ms for ${ADVERSARIAL_RUN} slashes`);
});
