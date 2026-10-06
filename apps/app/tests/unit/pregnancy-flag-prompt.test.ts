/**
 * Both prompts name the foods behind each pregnancy flag.
 *
 * A weaker model (gemini-3.5-flash-lite, no reasoning) knew that "pate" is
 * raw-meat and that tuna is high-mercury-fish, and still missed both inside a
 * composed dish: chicken liver pate on toast came back with liver-retinol only,
 * and a veal dish in a tuna sauce came back with no fish flag at all. Each
 * category now lists the common foods that belong to it, and one sentence says
 * that a sauce, a spread or a filling flags the whole dish.
 *
 * The photo prompt and the text prompt carry the same pregnancy line, word for
 * word. Every claim below is a pure function of the prompt string, so the same
 * check runs on a copy with the v2 line put back, and that control must go red.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { buildPlateIdentificationSystemPrompt, buildTextIntakeSystemPrompt } from '../../app/services/vision/prompt';

const PREGNANCY_LINE =
  '  - "pregnancy": every category from this list the food falls into: "raw-dairy" (unpasteurised milk and anything made from it, such as raw milk, cheese made from raw milk, lait cru or Rohmilch, and unpasteurised cream or yoghurt), "soft-cheese" (mould-ripened or blue soft cheese, such as brie, camembert, chevre with a white rind and other cheeses with a similar rind, gorgonzola, roquefort, danish blue and other soft blue cheeses, and soft washed-rind cheese such as Limburger or Munster), "raw-meat" (raw or undercooked meat, cured raw meat, pate, for example rare or pink steak or lamb, carpaccio, tartare, Mett, salami, chorizo, prosciutto, Parma or Serrano ham, Mettwurst, Teewurst and other cured or air-dried raw meat, meat or liver pate and liver spreads, and foie gras unless fully cooked), "raw-egg" (raw or lightly cooked egg and dishes made with it, such as runny or soft-boiled egg, homemade mayonnaise, aioli or hollandaise, tiramisu, chocolate mousse and raw cake or cookie dough), "raw-fish" (raw fish or shellfish, such as sushi or sashimi with raw fish, poke, ceviche, fish tartare, gravlax and other cured raw fish, and raw oysters), "smoked-fish" (cold-smoked fish, such as smoked salmon, lox and cold-smoked trout), "high-mercury-fish" (shark, swordfish, marlin, king mackerel, bigeye tuna, and tuna generally, meaning tuna in any form, including tuna steak, canned tuna, tuna salad, tuna sauce and tuna in sushi or on pizza), "liver-retinol" (liver, liver products, such as liver of any animal, liver sausage or Leberwurst, liver pate, liver dumplings, foie gras and cod liver oil), "alcohol" (beer, wine, cider, spirits, cocktails and liqueurs, and desserts soaked in spirits or liqueur, such as rum baba), "caffeine" (coffee, strong tea, energy drinks, such as espresso and other coffee drinks, black or green tea, matcha, cola and mate), "raw-sprouts" (raw sprouted seeds and beans, such as bean sprouts, alfalfa, radish or broccoli sprouts, also when added raw to a salad, a sandwich or a bowl). Use no other word. A dish is flagged for EVERY ingredient it contains, including sauces, spreads and fillings: a sauce made with tuna makes the dish "high-mercury-fish", and pate on toast is both "raw-meat" and "liver-retinol"; go through the categories for every item before you answer.\n';

/** The line both prompts shipped in v2, word for word, newline included. */
const V2_PREGNANCY_LINE =
  '  - "pregnancy": every category from this list the food falls into: "raw-dairy" (unpasteurised milk and anything made from it), "soft-cheese" (mould-ripened or blue soft cheese), "raw-meat" (raw or undercooked meat, cured raw meat, pate), "raw-egg" (raw or lightly cooked egg and dishes made with it), "raw-fish" (raw fish or shellfish), "smoked-fish" (cold-smoked fish), "high-mercury-fish" (shark, swordfish, marlin, king mackerel, bigeye tuna, and tuna generally), "liver-retinol" (liver, liver products), "alcohol", "caffeine" (coffee, strong tea, energy drinks), "raw-sprouts". Use no other word.\n';

/** The foods the A/B test caught a weak model missing, each with the words that now carry it. */
const NAMED_FOODS = [
  'meat or liver pate and liver spreads',
  'liver pate, liver dumplings, foie gras',
  'foie gras unless fully cooked',
  'tuna in any form, including tuna steak, canned tuna, tuna salad, tuna sauce',
  'brie, camembert, chevre with a white rind',
  'a sauce made with tuna makes the dish "high-mercury-fish"',
  'pate on toast is both "raw-meat" and "liver-retinol"',
  'go through the categories for every item before you answer.',
];

/** The two prompts, each with the flag lines this change must leave exactly as they were. */
const PROMPTS = [
  {
    name: 'photo',
    build: buildPlateIdentificationSystemPrompt,
    unchangedLines: [
      '  - "allergens": every one of these 14 the food CONTAINS, as an ingredient you can see or name: "gluten", "crustaceans", "eggs", "fish", "peanuts", "soybeans", "milk", "nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs". Use no other word.\n',
      '  - "mayContain": any of the same 14 you cannot rule out but cannot see: a hidden ingredient in a sauce or dressing, likely cross-contact, a dish whose recipe varies. Never list an allergen in both "allergens" and "mayContain"; if it is an ingredient, it goes in "allergens" only.\n',
      '  - A missed flag is worse than an extra one, because the person can ignore a flag they see and cannot act on one that never appeared. A cheese that could be raw-milk, meat that could be undercooked, a curry that could hold nuts: when you cannot tell, flag it.\n',
    ],
  },
  {
    name: 'text',
    build: buildTextIntakeSystemPrompt,
    unchangedLines: [
      '  - "allergens": every one of these 14 the food CONTAINS, as an ingredient the name tells you or that the dish always has: "gluten", "crustaceans", "eggs", "fish", "peanuts", "soybeans", "milk", "nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs". Use no other word.\n',
      '  - "mayContain": any of the same 14 you cannot rule out from the words alone: a hidden ingredient in a sauce or dressing, likely cross-contact, a dish whose recipe varies. Never list an allergen in both "allergens" and "mayContain"; if it is an ingredient, it goes in "allergens" only.\n',
      '  - A missed flag is worse than an extra one, because the person can ignore a flag they see and cannot act on one that never appeared. "Cheese" that could be raw-milk, "steak" that could be rare, a curry that could hold nuts: when you cannot tell, flag it.\n',
    ],
  },
] as const;

/**
 * What a prompt must say about the pregnancy flags.
 *
 * @param prompt - a photo or text system prompt.
 * @returns one line per missing or forbidden phrase, empty when the prompt is right.
 */
function findPregnancyLineProblems(prompt: string): string[] {
  const problems: string[] = [];
  if (prompt.includes(V2_PREGNANCY_LINE)) problems.push('still has the v2 pregnancy line');
  if (!prompt.includes(PREGNANCY_LINE)) problems.push('has no v3 pregnancy line');
  for (const food of NAMED_FOODS) {
    if (!prompt.includes(food)) problems.push(`does not say: ${food}`);
  }
  return problems;
}

/**
 * The same prompt with the v2 pregnancy line put back.
 *
 * @param prompt - a current system prompt.
 * @returns the prompt as it read in v2.
 */
function restoreV2PregnancyLine(prompt: string): string {
  const restored = prompt.replace(PREGNANCY_LINE, V2_PREGNANCY_LINE);
  if (restored === prompt) throw new Error('restoreV2PregnancyLine matched nothing, the control would be vacuous');
  return restored;
}

describe('both prompts name the foods behind each pregnancy flag', () => {
  for (const { name, build, unchangedLines } of PROMPTS) {
    for (const language of SUPPORTED_LANGUAGES) {
      it(`the ${name} prompt carries the v3 pregnancy line and the ingredient rule (${language})`, () => {
        assert.deepEqual(findPregnancyLineProblems(build(language)), []);
      });

      it(`the ${name} prompt keeps the allergen and missed-flag lines as they were (${language})`, () => {
        const prompt = build(language);
        for (const line of unchangedLines) assert.ok(prompt.includes(line), `missing: ${line}`);
      });
    }

    it(`the ${name} prompt carries the pregnancy line exactly once`, () => {
      assert.equal(build('en').split(PREGNANCY_LINE).length, 2);
    });

    it(`control: the same checks go red on the ${name} prompt with the v2 line`, () => {
      const oldPrompt = restoreV2PregnancyLine(build('en'));
      assert.deepEqual(findPregnancyLineProblems(oldPrompt), [
        'still has the v2 pregnancy line',
        'has no v3 pregnancy line',
        ...NAMED_FOODS.map((food) => `does not say: ${food}`),
      ]);
    });

    it(`control: the unchanged-line check goes red when the ${name} missed-flag line is reworded`, () => {
      const prompt = build('en').replace(
        'A missed flag is worse than an extra one',
        'An extra flag is worse than a missed one',
      );
      const missing = unchangedLines.filter((line) => !prompt.includes(line));
      assert.equal(missing.length, 1);
      assert.ok(missing[0]?.includes('A missed flag is worse than an extra one'));
    });
  }

  it('the photo and text prompts share one pregnancy line, so a drift in one goes red', () => {
    const photo = buildPlateIdentificationSystemPrompt('en');
    const driftedText = buildTextIntakeSystemPrompt('en').replace('and cod liver oil)', 'and fish oil)');
    assert.deepEqual(findPregnancyLineProblems(photo), []);
    assert.deepEqual(findPregnancyLineProblems(driftedText), ['has no v3 pregnancy line']);
  });
});
