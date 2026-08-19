/**
 * German and English names must both resolve, against the SAME committed dataset,
 * for a shared fixture set. Spec 04: "German and English queries both resolve
 * correctly for a shared fixture set."
 *
 * WHY THIS IS AN INTEGRATION TEST. It exercises the real 8 041-row artifact, the
 * real alias table and the real bounded query plan — no fakes, no stubs, no
 * network. The only thing it does not have is a model runtime, which resolution
 * does not need.
 *
 * THE ASSERTION IS PARITY, NOT MERELY "IT RESOLVED". Every pair below must land on
 * the SAME corpus row from either language. That is a far sharper test than
 * "German returns something": a broken alias table would still return something
 * (the trigram scorer will always find SOME row), and only parity catches
 * "Hähnchenbrust" quietly resolving to a row that has nothing to do with chicken.
 *
 * THE HARD PART IS THAT THERE IS NO LOCALE ON THE WIRE. The chat-completions
 * request carries an image and nothing else, so nothing tells this service which
 * language the model just wrote in. The FDC backend therefore scores the
 * alias-translated query ALONGSIDE the original and keeps the better hit per row —
 * which is why the English half of every pair below must keep passing too. An
 * alias table that started clobbering English queries would break this file, not
 * production.
 */
import { describe, expect, it } from 'vitest';
import { createFdcFoodSource } from '../../src/food-source/fdc.js';
import { createSilentLogger } from '../../src/logger.js';
import { createNutritionResolver } from '../../src/pipeline/resolve-nutrition.js';
import { searchFoods } from '../../src/food-source/search-foods.js';
import type { PlateIdentification } from '../../src/contract/plate-identification.js';

/** [German as a model would write it, the English a US user would write]. */
const PAIRS: Array<[string, string]> = [
  ['Rührei', 'scrambled eggs'],
  ['Hähnchenbrust', 'chicken breast'],
  ['Kartoffeln', 'potatoes'],
  ['Brokkoli', 'broccoli'],
  ['Karotten', 'carrots'],
  ['Vollkornbrot', 'whole wheat bread'],
  ['Naturjoghurt', 'plain yogurt'],
  ['Apfel', 'apple'],
  ['Banane', 'banana'],
  ['Butter', 'butter'],
  ['Spiegelei', 'fried egg'],
  ['grüne Bohnen', 'green beans'],
  ['Gurke', 'cucumber'],
  ['Spinat', 'spinach'],
  ['Linsen', 'lentils'],
];

const source = createFdcFoodSource({
  datasetPath: 'data/fdc-foods.json',
  aliasPath: 'data/de-food-aliases.json',
});

function plateOf(names: string[]): PlateIdentification {
  return {
    foods: names.map((name) => ({
      name,
      estimatedGrams: 100,
      confidence: 'medium' as const,
      portionHint: 'about 100 g',
      macrosPer100g: null,
    })),
    notes: null,
  };
}

describe('multilingual-resolution', () => {
  it.each(PAIRS)('resolves "%s" and "%s" to the same corpus row', async (german, english) => {
    const [fromGerman, fromEnglish] = await Promise.all([
      searchFoods({ source, name: german }),
      searchFoods({ source, name: english }),
    ]);

    expect(fromGerman.accepted, `German "${german}" did not resolve`).not.toBeNull();
    expect(fromEnglish.accepted, `English "${english}" did not resolve`).not.toBeNull();
    expect(fromGerman.accepted?.id).toBe(fromEnglish.accepted?.id);
  });

  it('resolves a whole German plate end to end', async () => {
    const resolver = createNutritionResolver({ source, logger: createSilentLogger() });

    const outcome = await resolver.resolve(
      plateOf(['Rührei', 'Vollkornbrot', 'Butter', 'Tomaten', 'Kaffee']),
    );

    expect(outcome.stats.failed).toBe(0);
    expect(outcome.stats.resolved).toBeGreaterThanOrEqual(4);
    for (const food of outcome.plate.foods) {
      if (food.macrosPer100g === null) continue;
      expect(food.provenance).toBe('corpus');
    }
  });

  it('leaves an untranslatable German name null rather than guessing', async () => {
    // Not in the alias table and not an English word — the honest answer is nothing.
    const result = await searchFoods({ source, name: 'Zwetschgendatschi' });

    expect(result.accepted).toBeNull();
  });

  it('does not let the alias pass break plain English queries', async () => {
    // "Butter" and "Toast" exist in both languages; "paprika" means the spice in
    // English and a bell pepper in German. Both readings compete; neither is
    // silently discarded.
    for (const name of ['butter', 'toast', 'paprika']) {
      const result = await searchFoods({ source, name });
      expect(result.best, `"${name}" produced no candidate at all`).not.toBeNull();
    }
  });

  it('resolves both languages inside the per-plate budget', async () => {
    const resolver = createNutritionResolver({ source, logger: createSilentLogger() });

    const outcome = await resolver.resolve(
      plateOf([...PAIRS.map(([german]) => german), ...PAIRS.map(([, english]) => english)]),
    );

    process.stdout.write(
      `\n[multilingual-resolution] ${outcome.stats.attempted} items ` +
        `(${PAIRS.length} de + ${PAIRS.length} en) in ${outcome.stats.durationMs.toFixed(1)} ms\n`,
    );
    expect(outcome.stats.durationMs).toBeLessThan(2000);
  });
});
