/**
 * The request bodies `tests/fixtures/legacy-forwarded-bodies.json` was recorded
 * from, on 2026-10-05, with the body policy as it was before the tier wiring.
 * Change one byte here and the recording no longer matches, which is the point.
 */
import { readFileSync } from 'node:fs';
import type { JsonObject } from '../../src/lib/json.js';

export const photoBody: JsonObject = {
  model: 'caller-chose-this',
  messages: [
    { role: 'system', content: 'You read plates.', cache_control: { type: 'ephemeral' } },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is on this plate?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', detail: 'high' } },
        { type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } },
      ],
    },
  ],
  response_format: {
    type: 'json_schema',
    json_schema: { name: 'plate_identification', strict: true, schema: { type: 'object' } },
  },
  max_tokens: 99999,
  max_completion_tokens: 50,
  reasoning: { max_tokens: 99999, effort: 'high', exclude: true },
  n: 3,
  stream: false,
  temperature: 0.2,
  tools: [{ type: 'function', function: { name: 'x' } }],
  provider: { allow_fallbacks: true, order: ['somebody'] },
  usage: { include: false },
};
export const bareBody: JsonObject = { messages: [{ role: 'user', content: 'two eggs and toast' }] };
export const effortBody: JsonObject = {
  model: 'm',
  messages: [{ role: 'user', content: 'hi' }],
  max_tokens: 700,
  reasoning: { effort: 'low' },
};

/** One recorded case of `tests/fixtures/legacy-forwarded-bodies.json`. */
export interface LegacyCase {
  bodyName: string;
  urlName: 'openrouter' | 'local';
  policyName: 'no model, no routing' | 'model only' | 'model, zdr and only';
  ceiling: number;
  /** The exact JSON text the code forwarded before the tier wiring. */
  expected: string;
}

/** The recorded cases. A fixture that lost its cases fails the caller's count check. */
export function readLegacyCases(): LegacyCase[] {
  const text = readFileSync(new URL('../fixtures/legacy-forwarded-bodies.json', import.meta.url), 'utf8');
  // SAFETY: a fixture this repository owns, written by the recording script;
  // a wrong field fails the caller's lookups, and the caller counts the cases.
  const parsed = JSON.parse(text) as { cases: LegacyCase[] };
  return parsed.cases;
}
