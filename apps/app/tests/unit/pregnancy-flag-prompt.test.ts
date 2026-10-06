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
 * word, from ONE exported constant. The constant cannot prove its own wording
 * (a prompt that includes it is true by construction), so the phrases below are
 * pinned as literals: they are what the A/B runs and the v4 review asked for.
 * Every claim is a pure function of the prompt string, so the same check runs on
 * a copy with the v2 line put back, and that control must go red.
 *
 * v4 (2026-10-06) widened the line and never narrowed it: raw egg covers every
 * mayonnaise unless a sealed jar is clear, alcohol covers dishes whose alcohol
 * is not cooked off, and raw meat no longer excuses a cooked foie gras or a
 * pink burger. M219 says when unsure, flag it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import {
  PREGNANCY_FLAG_LINE,
  buildPlateIdentificationSystemPrompt,
  buildTextIntakeSystemPrompt,
} from '../../app/services/vision/prompt';

/** The line both prompts carry, as the builders write it: the shared constant and its newline. */
const PREGNANCY_LINE = `${PREGNANCY_FLAG_LINE}\n`;

/** The line both prompts shipped in v2, word for word, newline included. */
const V2_PREGNANCY_LINE =
  '  - "pregnancy": every category from this list the food falls into: "raw-dairy" (unpasteurised milk and anything made from it), "soft-cheese" (mould-ripened or blue soft cheese), "raw-meat" (raw or undercooked meat, cured raw meat, pate), "raw-egg" (raw or lightly cooked egg and dishes made with it), "raw-fish" (raw fish or shellfish), "smoked-fish" (cold-smoked fish), "high-mercury-fish" (shark, swordfish, marlin, king mackerel, bigeye tuna, and tuna generally), "liver-retinol" (liver, liver products), "alcohol", "caffeine" (coffee, strong tea, energy drinks), "raw-sprouts". Use no other word.\n';

/** The foods the A/B test caught a weak model missing, each with the words that now carry it. */
const NAMED_FOODS = [
  'meat or liver pate and liver spreads, and foie gras)',
  'liver pate, liver dumplings, foie gras',
  'a pink burger or other pink minced meat',
  'mayonnaise, aioli or hollandaise unless it clearly comes from a sealed jar or bottle, carbonara, Caesar dressing, zabaglione, eggnog',
  'dishes with alcohol that is not cooked off, such as cheese fondue, liqueur chocolates, tiramisu or a wine sauce added at the end',
  'alcohol-free beer and wine count too',
  'tuna in any form, including tuna steak, canned tuna, tuna salad, tuna sauce',
  'brie, camembert, chevre with a white rind',
  'a sauce made with tuna makes the dish "high-mercury-fish"',
  'pate on toast is both "raw-meat" and "liver-retinol"',
  'go through the categories for every item before you answer.',
];

/** Wording that narrowed a flag in v3. A prompt must never say it again. */
const NARROWING_PHRASES = ['homemade mayonnaise', 'unless fully cooked'];

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
  if (!prompt.includes(PREGNANCY_LINE)) problems.push('has no current pregnancy line');
  for (const food of NAMED_FOODS) {
    if (!prompt.includes(food)) problems.push(`does not say: ${food}`);
  }
  for (const phrase of NARROWING_PHRASES) {
    if (prompt.includes(phrase)) problems.push(`narrows a flag with: ${phrase}`);
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
      it(`the ${name} prompt carries the pregnancy line and the ingredient rule (${language})`, () => {
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
        'has no current pregnancy line',
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

  it('both prompts include the shared constant exactly once and it carries every named food', () => {
    for (const { build } of PROMPTS) {
      assert.equal(build('en').split(PREGNANCY_FLAG_LINE).length, 2);
    }
    for (const food of NAMED_FOODS) assert.ok(PREGNANCY_FLAG_LINE.includes(food), `the constant lacks: ${food}`);
  });

  it('control: a v3 narrowing put back into either prompt is reported', () => {
    for (const { build } of PROMPTS) {
      const narrowed = build('en').replace(
        'and foie gras), "raw-egg"',
        'and foie gras unless fully cooked), "raw-egg"',
      );
      assert.notEqual(narrowed, build('en'), 'the plant must change the prompt');
      assert.ok(findPregnancyLineProblems(narrowed).includes('narrows a flag with: unless fully cooked'));
      const homemade = build('en').replace('soft-boiled egg, mayonnaise,', 'soft-boiled egg, homemade mayonnaise,');
      assert.notEqual(homemade, build('en'), 'the plant must change the prompt');
      assert.ok(findPregnancyLineProblems(homemade).includes('narrows a flag with: homemade mayonnaise'));
    }
  });

  it('the photo and text prompts share one pregnancy line, so a drift in one goes red', () => {
    const photo = buildPlateIdentificationSystemPrompt('en');
    const driftedText = buildTextIntakeSystemPrompt('en').replace('and cod liver oil)', 'and fish oil)');
    assert.deepEqual(findPregnancyLineProblems(photo), []);
    assert.deepEqual(findPregnancyLineProblems(driftedText), ['has no current pregnancy line']);
  });
});
