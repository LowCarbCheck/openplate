/**
 * The two forward-looking per-item fields exist from day one and are unused
 * until spec 04.
 *
 * WHY THIS IS TESTED BEFORE ANYTHING POPULATES IT. Spec 04 (corpus-backed
 * nutrition resolution) must report per-item macro provenance — `corpus` vs
 * `model` — and carry the resolving source's attribution string, which is a
 * CC BY 4.0 obligation for BLS-derived data, not a nice-to-have. Discovering
 * mid-04 that the contract has nowhere to put either would be a coordinated
 * two-repo change under time pressure. So the fields land now, and this test
 * pins BOTH halves of the deal: they are accepted when present, and they are
 * absent from what we emit today.
 */
import { describe, expect, it } from 'vitest';
import {
  IdentifiedFoodSchema,
  PlateIdentificationSchema,
  validatePlateIdentification,
} from '../../src/contract/plate-identification.js';
import { mapTerseToPlate } from '../../src/pipeline/map-terse.js';

const baseFood = {
  name: 'grilled chicken breast',
  estimatedGrams: 140,
  confidence: 'medium' as const,
  portionHint: 'about 140 g',
  macrosPer100g: null,
};

describe('provenance and attribution fields', () => {
  it('exposes optional `provenance` on the per-item schema', () => {
    expect(Object.keys(IdentifiedFoodSchema.keyof().enum)).toContain('provenance');
    expect(IdentifiedFoodSchema.parse({ ...baseFood, provenance: 'corpus' }).provenance).toBe('corpus');
    expect(IdentifiedFoodSchema.parse({ ...baseFood, provenance: 'model' }).provenance).toBe('model');
  });

  it('exposes optional, nullable `attribution` on the per-item schema', () => {
    expect(Object.keys(IdentifiedFoodSchema.keyof().enum)).toContain('attribution');
    const attributed = IdentifiedFoodSchema.parse({
      ...baseFood,
      provenance: 'corpus',
      attribution: 'Bundeslebensmittelschlüssel (BLS) 3.02, CC BY 4.0',
    });
    expect(attributed.attribution).toContain('CC BY 4.0');
    expect(IdentifiedFoodSchema.parse({ ...baseFood, attribution: null }).attribution).toBeNull();
  });

  it('constrains `provenance` to the two known sources', () => {
    expect(() => IdentifiedFoodSchema.parse({ ...baseFood, provenance: 'guess' })).toThrow();
  });

  it('accepts a whole plate carrying both fields', () => {
    const plate = {
      foods: [{ ...baseFood, provenance: 'corpus' as const, attribution: 'USDA FDC' }],
      notes: null,
    };
    expect(() => PlateIdentificationSchema.parse(plate)).not.toThrow();
    expect(validatePlateIdentification(plate).foods[0].provenance).toBe('corpus');
  });

  it('omits both fields from what this spec actually emits', () => {
    // Spec 02 identifies food; it resolves no nutrition, so it has no provenance
    // to report. An emitted `provenance: 'model'` with `macrosPer100g: null`
    // would claim the model produced numbers it is forbidden to produce.
    const { plate } = mapTerseToPlate({ f: [{ n: 'grilled chicken breast', g: 140 }] });
    const emitted = JSON.parse(JSON.stringify(plate.foods[0]));
    expect(Object.keys(emitted)).toEqual([
      'name',
      'estimatedGrams',
      'confidence',
      'portionHint',
      'macrosPer100g',
    ]);
  });
});
