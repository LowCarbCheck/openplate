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
 * IT NEVER SKIPS, SINCE THE MERGE (M262). The app is `apps/app` in the same
 * repository as this service, so its schema is always three directories up from
 * here. This test used to skip when a sibling `../openplate` checkout was
 * missing, which was right for a standalone clone of this repository and is now
 * the wrong default: a path that no longer resolves would skip, and a skipped
 * parity check is a green run that checked nothing. So a missing file FAILS,
 * naming the path it looked for. Nothing runs this suite with only
 * `apps/inference` on disk: the image build (`Dockerfile`, context
 * `apps/inference`) copies no tests and runs none.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  APP_LANGUAGES,
  BaseIdentifiedFoodSchema,
  BasePlateIdentificationSchema,
  MacrosSchema,
  PLATE_IDENTIFICATION_JSON_SCHEMA,
} from '../../src/contract/plate-identification.js';

const here = dirname(fileURLToPath(import.meta.url));
/** The app's folder in the merged repository: `apps/inference/tests/unit` up three, then `app`. */
const APP_ROOT = resolve(here, '../../../app');
const OPENPLATE_SCHEMA_PATH = resolve(APP_ROOT, 'app/services/vision/schema.ts');
const OPENPLATE_LANGUAGES_PATH = resolve(APP_ROOT, 'app/i18n/language-prefs.ts');

/** The app's file as text, or a failure that names the path, never a quiet skip. */
function readAppFile(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `schema-parity: cannot read the app's ${path}. The app lives at apps/app in this repository; ` +
        `if the file moved there, move this path with it.`,
      { cause: error },
    );
  }
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
    expect(PLATE_IDENTIFICATION_JSON_SCHEMA.required).toEqual(['foods', 'unreadable', 'unreadableReason', 'notes']);
    expect(item?.additionalProperties).toBe(false);
    expect(item?.required).toEqual([
      'name',
      'estimatedGrams',
      'confidence',
      'portionHint',
      'macrosPer100g',
      'macroSource',
      'brand',
      'servingSize',
      'carbBasis',
      'flags',
      'translations',
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

  it('matches openplate app/services/vision/schema.ts field-for-field', () => {
    const source = readAppFile(OPENPLATE_SCHEMA_PATH);

    expect(declaredFields(source, 'PlateIdentificationSchema')).toEqual(
      ourFields(BasePlateIdentificationSchema),
    );
    expect(declaredFields(source, 'RawIdentifiedFoodSchema')).toEqual(ourFields(BaseIdentifiedFoodSchema));

    expect(declaredFields(source, 'RawMacrosSchema')).toEqual(ourFields(MacrosSchema));
  });

  it('matches openplate on the confidence enum and the nullable fields', () => {
    const source = readAppFile(OPENPLATE_SCHEMA_PATH);
    // The three literals the client accepts. A fourth value here would be a
    // response openplate throws on.
    expect(source).toContain("z.enum(['high', 'medium', 'low'])");
    // `.nullable()` (never `.optional()`) is what makes the schema strict-mode
    // legal; a switch to `.optional()` upstream would be silent drift.
    expect(source).toContain('portionHint: z.string().nullable()');
    expect(source).toContain('macrosPer100g: RawMacrosSchema.nullable()');
    expect(source).toContain('notes: z.string().nullable()');
    // The label merge (openplate commit b770563): unreadable is plate-level
    // and required, never nullable — the model always answers it.
    expect(source).toContain('unreadable: z.boolean()');
    expect(source).toContain('unreadableReason: z.string().nullable()');
    expect(source).toContain('macroSource: z.enum(MACRO_SOURCE_VALUES)');
    expect(source).toContain('brand: z.string().nullable()');
    expect(source).toContain('servingSize: RawServingSizeSchema.nullable()');
    expect(source).toContain('carbBasis: z.enum(CARB_BASES).nullable().catch(null)');
    // The two the client added after the first transcription (M219, M251).
    expect(source).toContain('flags: RawFoodFlagsSchema');
    expect(source).toContain('translations: RawFoodTranslationsSchema');
  });

  it('matches openplate on the list of app languages the translations are keyed by', () => {
    const source = readAppFile(OPENPLATE_LANGUAGES_PATH);
    const declared = /SUPPORTED_LANGUAGES = \[([^\]]*)\] as const/u.exec(source)?.[1] ?? '';
    const codes = [...declared.matchAll(/'([a-z]{2})'/gu)].map((match) => match[1]);
    expect(codes).toEqual([...APP_LANGUAGES]);
    // Keyed by that list, in the schema the client asks every provider for.
    const translations = PLATE_IDENTIFICATION_JSON_SCHEMA.properties?.foods?.items?.properties?.translations;
    expect(translations?.required).toEqual([...APP_LANGUAGES]);
  });
});
