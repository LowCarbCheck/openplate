/**
 * THE INVARIANT: no unknown macro is ever filled with `0`.
 *
 * Spec 04 checks this with a grep (`! grep -rnE "(carbs|protein|fat|kcal|fiber)[^\n]*\|\|\s*0"
 * src/food-source src/pipeline`). The grep is a good tripwire and a bad
 * explanation, so this file does both jobs: it runs the same scan — widened to
 * catch `?? 0`, which the spec's regex would miss and which is the form a modern
 * TypeScript author reaches for first — and then proves the BEHAVIOUR the scan is
 * a proxy for.
 *
 * Why it matters more here than anywhere else in the service: openplate's client
 * strips null macros back to "unknown" (`stripNullMacros`), so a `null` costs a
 * user a blank field, while a `0` silently subtracts a real food from their day's
 * carbohydrate total and looks like a measurement while doing it.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { emptyMacros, toMacroValue } from '../../src/food-source/types.js';
import { z } from 'zod';

/**
 * Only `polyols` is read: USDA publishes it for almost nothing, so it is the
 * field where a generator that wrote 0 instead of null would show up first.
 */
const FdcDatasetPolyolsSchema = z.object({
  foods: z.array(z.object({ macrosPer100g: z.object({ polyols: z.number().nullable() }) })),
});

const SCANNED_DIRECTORIES = ['src/food-source', 'src/pipeline'];
const MACRO_FIELDS = ['carbs', 'fiber', 'sugars', 'polyols', 'protein', 'fat', 'kcal'] as const;

/** `carbs: x || 0`, `protein ?? 0`, `Number(fat) || 0` — every default-to-zero shape. */
const ZERO_COERCION = new RegExp(`(${MACRO_FIELDS.join('|')})[^\\n]*(\\|\\||\\?\\?)\\s*0(?![.0-9])`, 'i');

function typeScriptFilesIn(directory: string): string[] {
  const root = new URL(`../../${directory}`, import.meta.url).pathname;
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.endsWith('.ts')) files.push(path);
    }
  };
  walk(root);
  return files;
}

describe('no zero coercion on macros', () => {
  it('has no default-to-zero expression anywhere in the resolution path', () => {
    const offenders: string[] = [];
    for (const directory of SCANNED_DIRECTORIES) {
      for (const file of typeScriptFilesIn(directory)) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, index) => {
            // Comments are where the rule is EXPLAINED, so they must not trip it.
            const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
            if (ZERO_COERCION.test(code)) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('maps every unknown external value to null, not zero', () => {
    for (const unknown of [null, undefined, '', 'n/a', NaN, Infinity, -1, {}, []]) {
      expect(toMacroValue(unknown)).toBeNull();
    }
    // A genuine zero from a source still passes through: olive oil really has 0 g carbs.
    expect(toMacroValue(0)).toBe(0);
    expect(toMacroValue('12.5')).toBe(12.5);
  });

  it('builds an all-null macro row, never an all-zero one', () => {
    for (const value of Object.values(emptyMacros())) expect(value).toBeNull();
  });

  it('leaves unpublished fields null on real dataset rows', () => {
    const dataset = FdcDatasetPolyolsSchema.parse(
      JSON.parse(readFileSync(new URL('../../data/fdc-foods.json', import.meta.url).pathname, 'utf8')),
    );

    // The generator maps a missing USDA nutrient to null. If it ever started
    // writing 0 instead, polyols — which USDA publishes for almost nothing —
    // would be the first field to show it.
    const polyolValues = new Set(dataset.foods.map((food) => food.macrosPer100g.polyols));
    expect(polyolValues.has(null)).toBe(true);
  });
});
