/**
 * `RUNTIME_COMPLETION_TIMEOUT_MS` parsing.
 *
 * The default assertion is the load-bearing one. This knob exists to replace an
 * ACCIDENTAL 300 s cap (Node's `fetch` `headersTimeout` default), and the whole
 * point of shipping it is that it LOOSENS that cap rather than tightening it. A
 * default that ever slipped to or below 300000 would silently reintroduce the
 * defect while every other test stayed green, so it is pinned here explicitly.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RUNTIME_COMPLETION_TIMEOUT_MS, parseConfig } from '../../src/config.js';

const BASE = { MODEL_RUNTIME_URL: 'http://127.0.0.1:8080' };

/** The implicit cap this knob exists to replace. */
const ACCIDENTAL_STATUS_QUO_MS = 300_000;

describe('RUNTIME_COMPLETION_TIMEOUT_MS', () => {
  it('defaults above the accidental 300 s cap it replaces', () => {
    const config = parseConfig({ ...BASE });

    expect(config.runtimeCompletionTimeoutMs).toBe(DEFAULT_RUNTIME_COMPLETION_TIMEOUT_MS);
    expect(config.runtimeCompletionTimeoutMs).toBeGreaterThan(ACCIDENTAL_STATUS_QUO_MS);
  });

  it('accepts 0, which disables the bound rather than expiring immediately', () => {
    const config = parseConfig({ ...BASE, RUNTIME_COMPLETION_TIMEOUT_MS: '0' });

    expect(config.runtimeCompletionTimeoutMs).toBe(0);
  });

  it('carries an operator-set value through', () => {
    const config = parseConfig({ ...BASE, RUNTIME_COMPLETION_TIMEOUT_MS: '900000' });

    expect(config.runtimeCompletionTimeoutMs).toBe(900_000);
  });

  it('treats a blank value as unset rather than as 0', () => {
    const config = parseConfig({ ...BASE, RUNTIME_COMPLETION_TIMEOUT_MS: '   ' });

    expect(config.runtimeCompletionTimeoutMs).toBe(DEFAULT_RUNTIME_COMPLETION_TIMEOUT_MS);
  });

  it('refuses a negative value at boot', () => {
    expect(() => parseConfig({ ...BASE, RUNTIME_COMPLETION_TIMEOUT_MS: '-1' })).toThrow(
      /RUNTIME_COMPLETION_TIMEOUT_MS/,
    );
  });
});
