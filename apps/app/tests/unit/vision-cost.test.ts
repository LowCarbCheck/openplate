/**
 * Unit tests for `#app/services/vision/cost` — pure per-scan cost estimation
 * derived from the curated per-provider catalog (`./catalog`), keyed on
 * `(provider, modelId)`. No network/fetch involved.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { estimateScanCostUsd, formatScanCost, formatTokenCount } from '../../app/services/vision/cost';

describe('estimateScanCostUsd', () => {
  it('computes the exact cost for a known catalog model', () => {
    // openrouter / google/gemini-3.1-flash-lite: inPerM=0.25, outPerM=1.5
    // (400 * 0.25 + 800 * 1.5) / 1e6 = 1300 / 1e6 = 0.0013
    const cost = estimateScanCostUsd('openrouter', 'google/gemini-3.1-flash-lite', {
      inputTokens: 400,
      outputTokens: 800,
    });
    assert.strictEqual(cost, 0.0013);
  });

  it('prices the OAuth first-run default instead of leaving it estimate-less', () => {
    // openrouter / google/gemini-3.5-flash-lite: inPerM=0.30, outPerM=2.50
    // (400 * 0.3 + 800 * 2.5) / 1e6 = 2120 / 1e6 = 0.00212
    // The user-visible symptom of the catalog miss this guards: an
    // OAuth-connected user's scans showed no cost anywhere.
    const cost = estimateScanCostUsd('openrouter', 'google/gemini-3.5-flash-lite', {
      inputTokens: 400,
      outputTokens: 800,
    });
    assert.strictEqual(cost, 0.00212);
  });

  it('returns undefined for a model that is not in the catalog', () => {
    const cost = estimateScanCostUsd('openrouter', 'some-custom/self-hosted-model', {
      inputTokens: 100,
      outputTokens: 100,
    });
    assert.strictEqual(cost, undefined);
  });

  it('returns 0 for zero tokens against a known model', () => {
    const cost = estimateScanCostUsd('openrouter', 'google/gemini-3.1-flash-lite', {
      inputTokens: 0,
      outputTokens: 0,
    });
    assert.strictEqual(cost, 0);
  });

  it('prices the recommended OpenRouter model at its verified rates', () => {
    // openrouter / openai/gpt-5.6-luna: inPerM=0.10, outPerM=0.60
    // (1000 * 0.1 + 200 * 0.6) / 1e6 = 220 / 1e6 = 0.00022
    const cost = estimateScanCostUsd('openrouter', 'openai/gpt-5.6-luna', { inputTokens: 1000, outputTokens: 200 });
    assert.strictEqual(cost, 0.00022);
  });

  it('no longer prices the retired OpenRouter Claude ids', () => {
    // Claude is offered on the `anthropic` provider only — an OpenRouter user
    // pointing at a namespaced Claude id is off-catalog now, so it is honestly
    // unpriced rather than priced from a stale entry.
    assert.strictEqual(
      estimateScanCostUsd('openrouter', 'anthropic/claude-haiku-4.5', { inputTokens: 200, outputTokens: 800 }),
      undefined,
    );
    assert.strictEqual(
      estimateScanCostUsd('openrouter', 'anthropic/claude-sonnet-5', { inputTokens: 200, outputTokens: 800 }),
      undefined,
    );
  });

  it('prices a bare Anthropic-direct model id from the anthropic catalog', () => {
    // anthropic / claude-sonnet-5: inPerM=2.0, outPerM=10.0
    // (100 * 2.0 + 200 * 10.0) / 1e6 = 2200 / 1e6 = 0.0022
    const cost = estimateScanCostUsd('anthropic', 'claude-sonnet-5', { inputTokens: 100, outputTokens: 200 });
    assert.strictEqual(cost, 0.0022);
  });

  it('does not price a bare id against the wrong provider', () => {
    // The deleted vendor-namespace guess used to turn this into
    // 'anthropic/claude-sonnet-5'. An OpenRouter user who typed a bare id is
    // calling a model OpenRouter does not have, so there is no price to show.
    const cost = estimateScanCostUsd('openrouter', 'claude-sonnet-5', { inputTokens: 100, outputTokens: 200 });
    assert.strictEqual(cost, undefined);
  });

  it('does not fabricate pricing for an unlisted model', () => {
    const cost = estimateScanCostUsd('anthropic', 'self-hosted-model', { inputTokens: 100, outputTokens: 100 });
    assert.strictEqual(cost, undefined);
  });

  it('prices a Mistral scan from the mistral catalog', () => {
    // mistral / mistral-medium-2604: inPerM=1.5, outPerM=7.5. The token counts
    // are the live-probed shape of a real plate scan (M130/04 ground truth).
    // (1181 * 1.5 + 36 * 7.5) / 1e6 = (1771.5 + 270) / 1e6 = 0.0020415
    const cost = estimateScanCostUsd('mistral', 'mistral-medium-2604', { inputTokens: 1181, outputTokens: 36 });
    assert.strictEqual(cost, 0.0020415);
  });

  it('does not fabricate pricing for a Mistral model that is not in the catalog', () => {
    // An alias (`-latest`) or a model the user typed into the custom-model
    // field is honestly unpriced rather than guessed.
    assert.strictEqual(
      estimateScanCostUsd('mistral', 'mistral-medium-latest', { inputTokens: 1181, outputTokens: 36 }),
      undefined,
    );
  });

  it('has no pricing for a self-hosted openai-compatible endpoint', () => {
    // Deliberately empty catalog — including for a Mistral-direct id reached
    // through a custom base URL. Mistral has its own provider and catalog now
    // (M130/04); reaching the same model through someone's own endpoint is
    // still honestly unpriced rather than guessed.
    assert.strictEqual(
      estimateScanCostUsd('openai-compatible', 'mistral-medium-2604', { inputTokens: 100, outputTokens: 100 }),
      undefined,
    );
    assert.strictEqual(
      estimateScanCostUsd('openai-compatible', 'llama3', { inputTokens: 100, outputTokens: 100 }),
      undefined,
    );
  });
});

describe('formatScanCost', () => {
  it('renders 4-decimal costs verbatim', () => {
    assert.strictEqual(formatScanCost(0.0042), '$0.0042');
  });

  it('renders "<$0.001" for costs below the minimum displayable amount', () => {
    assert.strictEqual(formatScanCost(0.0000005), '<$0.001');
  });

  it('renders "<$0.001" for a zero-token (free) scan', () => {
    assert.strictEqual(formatScanCost(0), '<$0.001');
  });

  it('renders the real amount at the $0.001 boundary (inclusive)', () => {
    assert.strictEqual(formatScanCost(0.001), '$0.001');
  });

  it('trims trailing zeros from the formatted amount', () => {
    assert.strictEqual(formatScanCost(0.005), '$0.005');
    assert.strictEqual(formatScanCost(0.05), '$0.05');
  });

  it('rounds to 4 decimal places', () => {
    assert.strictEqual(formatScanCost(0.00123456), '$0.0012');
    assert.strictEqual(formatScanCost(0.00126), '$0.0013');
  });
});

describe('formatTokenCount', () => {
  it('groups thousands with a comma in English (the default)', () => {
    assert.strictEqual(formatTokenCount(1467), '1,467');
    assert.strictEqual(formatTokenCount(1467, 'en'), '1,467');
  });

  it('groups thousands with a dot in German', () => {
    // German writes 1.467, and a comma there reads as a DECIMAL point — this
    // is a wrong number to a German reader, not just a styling difference.
    assert.strictEqual(formatTokenCount(1467, 'de'), '1.467');
  });

  it('falls back to the English grouping for an unknown language', () => {
    assert.strictEqual(formatTokenCount(1467, 'xx-ZZ'), '1,467');
  });
});
