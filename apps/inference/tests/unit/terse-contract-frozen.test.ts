/**
 * Freezes the model-facing contract of the plate pipeline: the system prompt, the
 * user instruction and the `response_format` (the JSON schema llama-server compiles
 * into a GBNF grammar).
 *
 * The service's accuracy claim, 72.8 % recall with 0 hallucinations on the 50-image
 * gold set (`eval/BASELINE.md`), belongs to THIS prompt and THIS grammar. A reworded
 * sentence, a changed `maxItems` or a renamed schema key can move that number with
 * no failing test anywhere else, because every other test only asserts shapes.
 *
 * TO CHANGE THE PROMPT OR THE GRAMMAR ON PURPOSE: re-run the baseline in `eval/`
 * first, then update the hashes below in the same commit as the change and the new
 * baseline numbers. Never update a hash to make this test pass without that run.
 *
 * Three hashes, one assertion each, so a failure names the part that moved. The
 * combined hash covers all three plus their boundaries. The control tests prove the
 * comparison can fail: an assertion that cannot fail freezes nothing.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  TERSE_RESPONSE_FORMAT,
  TERSE_SYSTEM_PROMPT,
  TERSE_USER_INSTRUCTION,
} from '../../src/pipeline/terse-contract.js';

const FROZEN_SYSTEM_PROMPT_SHA256 = '5a582e9bfecef3ed2cb521f18b88419347877ae18e16567c5eebeb90853cdb97';
const FROZEN_USER_INSTRUCTION_SHA256 = '9a93089490846262aa6d2e68a683351c0af8ad551840443259807b5460b1c324';
const FROZEN_RESPONSE_FORMAT_SHA256 = '08abf78f3d37dfcd6a7f898d207e012fbefc1678378e6271c9034323a05b0f6b';
const FROZEN_COMBINED_SHA256 = 'eef842f4895aacc226ea03f4ade202119ad6739895080c25b534b02e7e9354eb';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

type ResponseFormat = typeof TERSE_RESPONSE_FORMAT;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value instanceof Object) {
    const entries = Object.entries(value).map(([key, nested]): [string, JsonValue] => [key, sortKeys(nested)]);
    return Object.fromEntries(entries.toSorted(([a], [b]) => a.localeCompare(b, 'en')));
  }
  return value;
}

/** JSON with object keys sorted at every depth, so the hash ignores insertion order. */
function stableStringify(value: ResponseFormat): string {
  // Round-trip first: it narrows an interface-typed object to plain JSON, and drops undefined keys.
  const plain: JsonValue = JSON.parse(JSON.stringify(value));
  return JSON.stringify(sortKeys(plain));
}

function combinedHash(parts: { prompt: string; instruction: string; format: ResponseFormat }): string {
  return sha256(JSON.stringify([parts.prompt, parts.instruction, stableStringify(parts.format)]));
}

describe('terse-contract-frozen', () => {
  it('keeps the system prompt byte-identical', () => {
    expect(sha256(TERSE_SYSTEM_PROMPT)).toBe(FROZEN_SYSTEM_PROMPT_SHA256);
  });

  it('keeps the user instruction byte-identical', () => {
    expect(sha256(TERSE_USER_INSTRUCTION)).toBe(FROZEN_USER_INSTRUCTION_SHA256);
  });

  it('keeps the response_format (the grammar) identical', () => {
    expect(sha256(stableStringify(TERSE_RESPONSE_FORMAT))).toBe(FROZEN_RESPONSE_FORMAT_SHA256);
  });

  it('keeps the combined model-facing contract identical', () => {
    const hash = combinedHash({
      prompt: TERSE_SYSTEM_PROMPT,
      instruction: TERSE_USER_INSTRUCTION,
      format: TERSE_RESPONSE_FORMAT,
    });
    expect(hash).toBe(FROZEN_COMBINED_SHA256);
  });
});

describe('terse-contract-frozen control cases', () => {
  it('fails the prompt hash when one byte is appended', () => {
    expect(sha256(`${TERSE_SYSTEM_PROMPT} `)).not.toBe(FROZEN_SYSTEM_PROMPT_SHA256);
  });

  it('fails the instruction hash when one byte is appended', () => {
    expect(sha256(`${TERSE_USER_INSTRUCTION} `)).not.toBe(FROZEN_USER_INSTRUCTION_SHA256);
  });

  it('fails the grammar hash when maxItems moves by one', () => {
    const moved = {
      ...TERSE_RESPONSE_FORMAT,
      json_schema: {
        ...TERSE_RESPONSE_FORMAT.json_schema,
        schema: {
          ...TERSE_RESPONSE_FORMAT.json_schema.schema,
          properties: {
            f: {
              ...TERSE_RESPONSE_FORMAT.json_schema.schema.properties?.['f'],
              maxItems: 9,
            },
          },
        },
      },
    };
    expect(sha256(stableStringify(moved))).not.toBe(FROZEN_RESPONSE_FORMAT_SHA256);
  });

  it('fails the combined hash when the prompt has one byte appended', () => {
    const hash = combinedHash({
      prompt: `${TERSE_SYSTEM_PROMPT} `,
      instruction: TERSE_USER_INSTRUCTION,
      format: TERSE_RESPONSE_FORMAT,
    });
    expect(hash).not.toBe(FROZEN_COMBINED_SHA256);
  });

  it('hashes a response_format the same whatever its key insertion order', () => {
    const reversed = {
      json_schema: {
        schema: TERSE_RESPONSE_FORMAT.json_schema.schema,
        strict: TERSE_RESPONSE_FORMAT.json_schema.strict,
        name: TERSE_RESPONSE_FORMAT.json_schema.name,
      },
      type: TERSE_RESPONSE_FORMAT.type,
    };
    expect(Object.keys(reversed)).not.toEqual(Object.keys(TERSE_RESPONSE_FORMAT));
    expect(stableStringify(reversed)).toBe(stableStringify(TERSE_RESPONSE_FORMAT));
  });
});
