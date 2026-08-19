/**
 * Parity between the VENDORED contract in `src/contract/plate-identification.ts`
 * and openplate's original at `app/services/vision/schema.ts`.
 *
 * This test is the whole justification for vendoring instead of publishing a
 * shared package (see that module's header: GitHub Packages needs an auth token
 * even for a public install, which is a non-starter for an MIT repo a stranger
 * clones). It reads openplate's file as TEXT and compares the field structure it
 * declares against our schema's introspected shape.
 *
 * WHY TEXT AND NOT AN IMPORT. openplate's module imports `./types` for
 * `VisionProviderError` and lives under a different tsconfig with `#app/*` path
 * aliases; importing it from here would couple this repo's test runner to
 * openplate's build config, and it would break the moment that file gains an
 * unrelated import. Reading the declarations is narrower and fails for exactly
 * the reason we care about: a field added, removed, renamed or retyped there and
 * not here.
 *
 * IT SKIPS WHEN OPENPLATE IS ABSENT — loudly. A self-hoster who clones only this
 * repo has no sibling checkout, and a hard failure there would be noise. In the
 * dev workspace the sibling IS present, so this comparison really runs; if you
 * see the skip warning locally, the path below is wrong and drift is going
 * unchecked.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BaseIdentifiedFoodSchema,
  BasePlateIdentificationSchema,
  MacrosSchema,
  PLATE_IDENTIFICATION_JSON_SCHEMA,
} from '../../src/contract/plate-identification.js';

const here = dirname(fileURLToPath(import.meta.url));
const OPENPLATE_SCHEMA_PATH = resolve(here, '../../../openplate/app/services/vision/schema.ts');

const openplateAvailable = existsSync(OPENPLATE_SCHEMA_PATH);

if (!openplateAvailable) {
  console.warn(
    [
      '',
      '*'.repeat(78),
      '* WARNING: schema-parity is SKIPPED — no openplate checkout at',
      `*   ${OPENPLATE_SCHEMA_PATH}`,
      '* The PlateIdentification contract in src/contract/ is a hand-transcribed copy.',
      '* Nothing in this run verified it still matches the client. Expected when this',
      '* repo is cloned on its own; a BUG if you see it inside the dev workspace.',
      '*'.repeat(78),
      '',
    ].join('\n'),
  );
}

/** Extracts the property names of a `const <name> = z.object({...})` declaration. */
function declaredFields(source: string, constName: string): string[] {
  const start = source.indexOf(`const ${constName} = z.object({`);
  if (start === -1) throw new Error(`could not find "const ${constName} = z.object({" in openplate's schema.ts`);
  const bodyStart = source.indexOf('{', source.indexOf('z.object(', start));
  let depth = 0;
  let end = bodyStart;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(bodyStart + 1, end);
  // Top-level `name: ...` entries only — nested object bodies sit one level
  // deeper and are matched by their own declaration.
  return [...body.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]);
}

/** Field names of one of our vendored objects, in declaration order. */
function ourFields(schema: z.ZodObject): string[] {
  return Object.keys(schema.keyof().enum);
}

describe('vendored PlateIdentification contract', () => {
  it('derives a strict JSON Schema: additionalProperties false, everything required', () => {
    const foods = PLATE_IDENTIFICATION_JSON_SCHEMA.properties?.foods;
    const item = foods?.items;
    expect(PLATE_IDENTIFICATION_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(PLATE_IDENTIFICATION_JSON_SCHEMA.required).toEqual(['foods', 'notes']);
    expect(item?.additionalProperties).toBe(false);
    expect(item?.required).toEqual([
      'name',
      'estimatedGrams',
      'confidence',
      'portionHint',
      'macrosPer100g',
    ]);
    expect(PLATE_IDENTIFICATION_JSON_SCHEMA.$schema).toBeUndefined();
  });

  it('keeps `provenance`/`attribution` OUT of the client-facing JSON Schema', () => {
    // They exist on the Zod schema for spec 04, but the schema handed to a client
    // must stay byte-compatible with openplate's until 04 actually populates them.
    const itemProperties = PLATE_IDENTIFICATION_JSON_SCHEMA.properties?.foods?.items?.properties ?? {};
    expect(Object.keys(itemProperties)).not.toContain('provenance');
    expect(Object.keys(itemProperties)).not.toContain('attribution');
  });

  it.skipIf(!openplateAvailable)('matches openplate app/services/vision/schema.ts field-for-field', () => {
    const source = readFileSync(OPENPLATE_SCHEMA_PATH, 'utf8');

    expect(declaredFields(source, 'PlateIdentificationSchema')).toEqual(
      ourFields(BasePlateIdentificationSchema),
    );
    expect(declaredFields(source, 'RawIdentifiedFoodSchema')).toEqual(ourFields(BaseIdentifiedFoodSchema));

    expect(declaredFields(source, 'RawMacrosSchema')).toEqual(ourFields(MacrosSchema));
  });

  it.skipIf(!openplateAvailable)('matches openplate on the confidence enum and the nullable fields', () => {
    const source = readFileSync(OPENPLATE_SCHEMA_PATH, 'utf8');
    // The three literals the client accepts. A fourth value here would be a
    // response openplate throws on.
    expect(source).toContain("z.enum(['high', 'medium', 'low'])");
    // `.nullable()` (never `.optional()`) is what makes the schema strict-mode
    // legal; a switch to `.optional()` upstream would be silent drift.
    expect(source).toContain('portionHint: z.string().nullable()');
    expect(source).toContain('macrosPer100g: RawMacrosSchema.nullable()');
    expect(source).toContain('notes: z.string().nullable()');
  });
});
