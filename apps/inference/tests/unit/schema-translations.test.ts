/**
 * `translations` on the service-side food: partial, two keys, and still a
 * valid plate for the response self-check, while the client's Base shape and
 * the derived wire JSON Schema keep demanding all six languages.
 */
import { describe, expect, it } from 'vitest';
import {
  APP_LANGUAGES,
  BaseIdentifiedFoodSchema,
  PLATE_IDENTIFICATION_JSON_SCHEMA,
  validatePlateIdentification,
  type PlateIdentification,
} from '../../src/contract/plate-identification.js';

function plateWithTranslations(translations: Record<string, string | number>): PlateIdentification {
  return {
    foods: [
      {
        name: 'white rice',
        estimatedGrams: 150,
        confidence: 'medium',
        portionHint: 'about 150 g',
        macrosPer100g: null,
        macroSource: 'estimated',
        brand: null,
        servingSize: null,
        carbBasis: null,
        // SAFETY: the control case below deliberately puts a number where a name
        // belongs, to prove the self-check rejects it; the type would forbid that.
        translations: translations as Record<string, string>,
      },
    ],
    unreadable: false,
    unreadableReason: null,
    notes: null,
  };
}

describe('IdentifiedFoodSchema translations', () => {
  it('passes the response self-check with only English and one other language', () => {
    const plate = plateWithTranslations({ en: 'white rice', de: 'Weißer Reis' });
    expect(validatePlateIdentification(plate).foods[0].translations).toEqual({ en: 'white rice', de: 'Weißer Reis' });
  });

  it('CONTROL: still rejects a translation that is not a string', () => {
    expect(() => validatePlateIdentification(plateWithTranslations({ en: 'white rice', de: 5 }))).toThrow();
  });

  it('leaves the client Base shape strict: two keys are not enough there', () => {
    const food = plateWithTranslations({ en: 'white rice', de: 'Weißer Reis' }).foods[0];
    expect(BaseIdentifiedFoodSchema.safeParse(food).success).toBe(false);
    const allSix = Object.fromEntries(APP_LANGUAGES.map((code) => [code, 'white rice']));
    expect(BaseIdentifiedFoodSchema.safeParse({ ...food, translations: allSix }).success).toBe(true);
  });

  it('leaves the derived wire JSON Schema asking for all six languages', () => {
    const translations = PLATE_IDENTIFICATION_JSON_SCHEMA.properties?.foods?.items?.properties?.translations;
    expect(translations?.required).toEqual([...APP_LANGUAGES]);
  });
});
