/**
 * The photo prompt names every separate food and rates its confidence.
 *
 * A weaker model read the old bullet "Prefer fewer, consolidated items. Aim
 * for 6 or fewer." as an order to name a whole plate by one dish ("sushi
 * platter", "full breakfast") and lost a third of the foods on a 50 plate test.
 * The photo prompt also had no confidence rubric, so a branded product with
 * no legible panel came back "high". The text prompt has had both rules for a
 * long time.
 *
 * Every claim below is a pure function of the prompt string, so the same
 * check runs on a copy with the OLD bullets put back, and that control must
 * go red. A check that also passes on the old prompt proves nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { buildPlateIdentificationSystemPrompt } from '../../app/services/vision/prompt';

const SPLIT_RULE =
  '- List every food you can tell apart as its own item. Rice, chicken and a salad on one plate are three items; a breakfast of eggs, bacon, toast and beans is four. Merge only a sauce or dressing into the dish it is on, or the parts of one product that cannot be told apart, such as a burger, a soup, a casserole or a sandwich. Never name a whole plate or meal by one dish name when its parts can be seen: "sushi platter", "full breakfast" and "dinner plate" are wrong, so list what is on them. List up to 12 items.';

const NAMING_RULE =
  '- Name each item in plain language (e.g. "grilled chicken breast", not "protein"; a green salad with tomato is one item, "mixed salad", not one item per leaf or vegetable in it; a salad and a separate bowl of soup are two items).';

const CONFIDENCE_RULE =
  '- Rate your confidence in the identification as "high", "medium", or "low". "high" means the food is unambiguous, and for a packaged or branded product only when its package or printed panel is legible in the photo. "medium" means the kind of food is clear but the specific product, recipe or ingredients are not. "low" means a guess. A packaged or branded product with no legible panel is "medium" at most.';

const BRAND_RULE =
  "- NEVER invent a brand or recall a product's figures. A packaged or branded product whose nutrition panel you cannot read is an estimate like any other food: log the generic food, keep \"brand\" null, and estimate the generic food's macros rather than reporting a brand's numbers from memory. A brand's real figures come from its printed panel, never from recall.";

/** The three bullets this change replaced, word for word as they shipped. */
const OLD_CONSOLIDATION_RULE =
  '- Prefer fewer, consolidated items. Aim for 6 or fewer. Combine components that are eaten together into one natural item when that better matches how someone would log it.';
const OLD_NAMING_RULE =
  '- Name each item in plain language (e.g. "grilled chicken breast", not "protein"; "side salad", not "mixed leaves, tomato, cucumber").';
const OLD_CONFIDENCE_RULE = '- Rate your confidence in the identification as "high", "medium", or "low".';

/** Lines the change must leave exactly as they were. */
const UNCHANGED_LINES = [
  '- Only list foods that meaningfully affect nutrition. Fold garnishes, herb sprigs, and decorations (e.g. a parsley garnish, a lemon wedge, a dusting of herbs) into the dish they sit on, or omit them, never list them as separate items.',
  '- A sauce or dressing joins the dish it is on, unless it is clearly a substantial side of its own.',
  '- Set "macroSource" to "estimated", "brand" to null, "servingSize" to null and "carbBasis" to null. These four belong to printed panels, and an estimate has no panel.',
  '- Put the manufacturer in "brand" when the package names one, and null otherwise. Never invent a brand.',
  'A missed flag is worse than an extra one',
  'when you cannot tell, flag it.',
];

/**
 * What the prompt must say about splitting a plate and rating a guess.
 *
 * @param prompt - a photo system prompt.
 * @returns one line per missing or forbidden phrase, empty when the prompt is right.
 */
function findItemRuleProblems(prompt: string): string[] {
  const problems: string[] = [];
  if (prompt.includes('Prefer fewer')) problems.push('still says "Prefer fewer"');
  if (prompt.includes('6 or fewer')) problems.push('still caps the list at 6');
  if (prompt.includes('consolidated')) problems.push('still asks for consolidated items');
  if (prompt.includes('"side salad", not "mixed leaves')) problems.push('still has the merging salad example');
  if (!prompt.includes(SPLIT_RULE)) problems.push('has no split rule');
  if (!prompt.includes(NAMING_RULE)) problems.push('has no salad naming rule');
  if (!prompt.includes(CONFIDENCE_RULE)) problems.push('has no confidence rubric');
  if (!prompt.includes(BRAND_RULE)) problems.push('has no brand rule');
  return problems;
}

/**
 * The same prompt with the three old bullets put back and the brand rule gone.
 *
 * @param prompt - the current photo system prompt.
 * @returns the prompt as it read before this change.
 */
function restoreOldBullets(prompt: string): string {
  const restored = prompt
    .replace(SPLIT_RULE, OLD_CONSOLIDATION_RULE)
    .replace(NAMING_RULE, OLD_NAMING_RULE)
    .replace(`${CONFIDENCE_RULE}\n${BRAND_RULE}`, OLD_CONFIDENCE_RULE);
  if (restored === prompt) throw new Error('restoreOldBullets matched nothing, the control would be vacuous');
  return restored;
}

describe('the photo prompt names every separate food', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    it(`carries the split rule, the salad example, the rubric and the brand rule (${language})`, () => {
      assert.deepEqual(findItemRuleProblems(buildPlateIdentificationSystemPrompt(language)), []);
    });

    it(`keeps the garnish, sauce, panel brand and flag rules as they were (${language})`, () => {
      const prompt = buildPlateIdentificationSystemPrompt(language);
      for (const line of UNCHANGED_LINES) assert.ok(prompt.includes(line), `missing: ${line}`);
    });
  }

  it('control: the same checks go red on the prompt with the old bullets', () => {
    const oldPrompt = restoreOldBullets(buildPlateIdentificationSystemPrompt('en'));
    assert.ok(oldPrompt.includes(OLD_CONSOLIDATION_RULE));
    assert.deepEqual(findItemRuleProblems(oldPrompt), [
      'still says "Prefer fewer"',
      'still caps the list at 6',
      'still asks for consolidated items',
      'still has the merging salad example',
      'has no split rule',
      'has no salad naming rule',
      'has no confidence rubric',
      'has no brand rule',
    ]);
  });

  it('control: only the old consolidation bullet put back is still caught', () => {
    const prompt = buildPlateIdentificationSystemPrompt('en');
    const oneOldBullet = `${prompt}\n${OLD_CONSOLIDATION_RULE}`;
    assert.deepEqual(findItemRuleProblems(oneOldBullet), [
      'still says "Prefer fewer"',
      'still caps the list at 6',
      'still asks for consolidated items',
    ]);
  });

  it('control: the unchanged-line check goes red when a kept line is reworded', () => {
    const prompt = buildPlateIdentificationSystemPrompt('en').replace(
      'A missed flag is worse than an extra one',
      'An extra flag is worse than a missed one',
    );
    const missing = UNCHANGED_LINES.filter((line) => !prompt.includes(line));
    assert.deepEqual(missing, ['A missed flag is worse than an extra one']);
  });
});
