/**
 * `parseBearerHeader` moved from `/^Bearer\s+(.+)$/i` to a linear pattern
 * (CodeQL `js/polynomial-redos`, alert 9). The old parser stays here as the
 * reference: the new one must accept and refuse exactly what it did, and must
 * answer at once on the header that made it quadratic.
 */
import { describe, expect, it } from 'vitest';
import { parseBearerHeader } from '../../src/server/api-key-auth.js';

/** The parser as it was before alert 9. Quadratic on `Bearer`, a long tab run and a line break. */
function referenceParse(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() || null : null;
}

/** Accepted shapes, refused shapes, and the whitespace and line-break edges between them. */
const DOCUMENTED_HEADERS = [
  undefined,
  '',
  'Bearer opk_abc123',
  'bearer opk_abc123',
  'BEARER opk_abc123',
  'Bearer    opk_abc123',
  'Bearer\topk_abc123',
  '  Bearer opk_abc123  ',
  'Bearer opk abc',
  'Bearer \n opk_abc123',
  'Bearer opk_abc123',
  'Bearer opk_abc\nsecond-line',
  'Bearer',
  'Bearer ',
  'Bearer\t\t',
  'Beareropk_abc123',
  'Basic dXNlcjpwYXNz',
  'Token Bearer opk_abc123',
] as const;

const ADVERSARIAL_RUN = 50_000;
const LINEAR_BUDGET_MS = 50;

describe('parseBearerHeader', () => {
  it('accepts and refuses exactly what the old parser did, for every documented header', () => {
    for (const header of DOCUMENTED_HEADERS) {
      expect(parseBearerHeader(header), JSON.stringify(header)).toBe(referenceParse(header));
    }
  });

  it('returns the key, and null for a header that names no key', () => {
    expect(parseBearerHeader('Bearer opk_abc123')).toBe('opk_abc123');
    expect(parseBearerHeader('Bearer ')).toBeNull();
    expect(parseBearerHeader('Basic dXNlcjpwYXNz')).toBeNull();
  });

  it('refuses a long tab run followed by a line break within the linear budget', () => {
    const adversarial = `Bearer${'\t'.repeat(ADVERSARIAL_RUN)}x\ny`;
    const started = performance.now();
    const result = parseBearerHeader(adversarial);
    const elapsedMs = performance.now() - started;
    expect(result).toBeNull();
    expect(elapsedMs, `took ${elapsedMs.toFixed(1)} ms for ${ADVERSARIAL_RUN} tabs`).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it('accepts a key after a long tab run within the linear budget', () => {
    const started = performance.now();
    const result = parseBearerHeader(`Bearer${'\t'.repeat(ADVERSARIAL_RUN)}opk_abc123`);
    const elapsedMs = performance.now() - started;
    expect(result).toBe('opk_abc123');
    expect(elapsedMs, `took ${elapsedMs.toFixed(1)} ms for ${ADVERSARIAL_RUN} tabs`).toBeLessThan(LINEAR_BUDGET_MS);
  });
});
