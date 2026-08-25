/**
 * Fetch-stubbed end-to-end tests for `runScan` with the label task: a real
 * provider envelope in, a `LabelReading` out, through the same transport the
 * plate scan uses. These are what prove the descriptor seam actually swaps the
 * whole task — prompt, schema and parse — rather than only the prompt.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createOpenAiCompatibleProvider } from '../../app/services/vision/openai-compatible';
import { createAnthropicProvider } from '../../app/services/vision/anthropic';
import { LABEL_SCAN_TASK } from '../../app/services/vision/task';
import { LABEL_READING_JSON_SCHEMA } from '../../app/services/vision/schema';

const originalFetch = globalThis.fetch;

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): void {
  // SAFETY: `impl` has the (input, init) => Promise<Response> call signature the adapters use;
  // the only extra member on Node's `fetch` type is `preconnect`, which no adapter calls.
  globalThis.fetch = impl as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

const PANEL = {
  unreadable: false,
  unreadableReason: null,
  productName: 'Keto Bar, Chocolate',
  brand: 'Testbrand',
  servingSize: { asPrinted: '1 bar (35 g)', grams: 35 },
  servingsPerPackage: 1,
  macrosPerServing: { carbs: 14.7, fiber: 3.5, sugars: 0.7, polyols: 9.1, protein: 7, fat: 12.6, kcal: 180 },
  macrosPer100g: { carbs: 42, fiber: 10, sugars: 2, polyols: 26, protein: 20, fat: 36, kcal: 514 },
  carbBasis: 'total',
  notes: null,
};

describe('openai-compatible runScan — label task', () => {
  it('returns the panel’s polyols and reports the label schema on the wire', async () => {
    let sentBody = '';
    stubFetch(async (_url, init) => {
      sentBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(PANEL) } }],
          usage: { prompt_tokens: 900, completion_tokens: 120 },
        }),
        { status: 200 },
      );
    });

    try {
      const provider = createOpenAiCompatibleProvider({ apiKey: 'sk-test', model: 'gpt-5o' });
      const reading = await provider.runScan({
        task: LABEL_SCAN_TASK,
        image: { base64: 'AAAA', mimeType: 'image/jpeg' },
      });

      assert.strictEqual(reading.unreadable, false);
      assert.strictEqual(reading.macrosPerServing?.polyols, 9.1);
      assert.strictEqual(reading.macrosPer100g?.polyols, 26);
      assert.deepStrictEqual(reading.usage, { inputTokens: 900, outputTokens: 120 });
      assert.ok(sentBody.includes('label_reading'));
      assert.ok(sentBody.includes(JSON.stringify(LABEL_READING_JSON_SCHEMA.required ?? [])));
    } finally {
      restoreFetch();
    }
  });
});

describe('anthropic runScan — label task', () => {
  it('validates the forced tool input as a label reading', async () => {
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'tool_use', input: PANEL }],
            usage: { input_tokens: 900, output_tokens: 120 },
          }),
          { status: 200 },
        ),
    );

    try {
      const provider = createAnthropicProvider({ apiKey: 'sk-test', model: 'claude-sonnet-5' });
      const reading = await provider.runScan({
        task: LABEL_SCAN_TASK,
        image: { base64: 'AAAA', mimeType: 'image/jpeg' },
      });

      assert.strictEqual(reading.macrosPerServing?.polyols, 9.1);
      assert.strictEqual(reading.servingSize?.asPrinted, '1 bar (35 g)');
      assert.deepStrictEqual(reading.usage, { inputTokens: 900, outputTokens: 120 });
    } finally {
      restoreFetch();
    }
  });

  it('surfaces an unreadable panel as a result, not as a thrown failure', async () => {
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: 'tool_use',
                input: {
                  ...PANEL,
                  unreadable: true,
                  unreadableReason: 'Glare covers the panel.',
                  macrosPerServing: null,
                  macrosPer100g: null,
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );

    try {
      const provider = createAnthropicProvider({ apiKey: 'sk-test', model: 'claude-sonnet-5' });
      const reading = await provider.runScan({
        task: LABEL_SCAN_TASK,
        image: { base64: 'AAAA', mimeType: 'image/jpeg' },
      });

      assert.strictEqual(reading.unreadable, true);
      assert.strictEqual(reading.unreadableReason, 'Glare covers the panel.');
      assert.strictEqual(reading.macrosPerServing, undefined);
      assert.strictEqual(reading.usage, undefined);
    } finally {
      restoreFetch();
    }
  });
});
