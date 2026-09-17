/**
 * The recipe user prompt (M233/04).
 *
 * THE PROMPT IS THE WHOLE INPUT on this task: there is no photograph and no
 * sentence a person wrote, so anything missing from this block is a fact the
 * model never had. Two things must be in it, and both are cheap to lose in a
 * refactor: every item on the shelf, and the emphasis the day asked for.
 *
 * Every assertion has a control that goes red. The shelf is asserted against a
 * pantry with one item held back, so "the names are present" is a claim about
 * the builder and not about the string containing words. The emphasis is
 * asserted against a day that asks for something else.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRecipeProposalUserPrompt,
  type RecipePromptPantryItem,
} from '../../app/services/vision/recipe-prompt';
import { computeRemainingDay, describeRemainingDayForPrompt } from '../../app/lib/remaining-day';
import type { LocalProfileGoals } from '../../app/lib/local-store/schema';

/** A stored profile with the three goal numbers set. */
const GOALS: LocalProfileGoals = {
  timezone: 'Europe/Berlin',
  goalNetCarbsCeilingG: 50,
  goalProteinFloorG: 120,
  goalKcalTarget: 2000,
  targetWeightKg: null,
  trackingFocus: null,
  onboardingCompletedAt: 1,
  updatedAt: 1,
};

const SHELF: RecipePromptPantryItem[] = [
  { name: 'Eggs', amount: 6, unit: 'piece' },
  { name: 'Spinach', amount: 200, unit: 'g' },
  { name: 'Feta', amount: null, unit: null },
];

/**
 * A day whose energy is nearly spent while the protein floor is barely
 * touched, so the emphasis carries both `light` and `protein`.
 */
function pressedDay() {
  return computeRemainingDay({
    totals: { netCarbs: 20, protein: 10, fiber: 4, kcal: 1700, fatG: 60 },
    goals: GOALS,
    slot: 'dinner',
    slotsLeft: 1,
  });
}

function promptFor(pantry: readonly RecipePromptPantryItem[]): string {
  const day = pressedDay();
  return buildRecipeProposalUserPrompt({
    pantry,
    remainingDayBlock: describeRemainingDayForPrompt(day, 'de'),
    slot: day.slot,
    language: 'de',
  });
}

describe('buildRecipeProposalUserPrompt', () => {
  it('names every item on the shelf, with its amount and unit', () => {
    const prompt = promptFor(SHELF);

    for (const item of SHELF) {
      assert.ok(prompt.includes(item.name), `expected the prompt to name ${item.name}`);
    }
    assert.ok(prompt.includes('Eggs, 6 piece'), 'expected the amount and unit on the line');
    // An item with no amount is its bare name: a stray unit would be a
    // quantity the person never gave.
    assert.ok(!prompt.includes('Feta,'), 'expected no amount clause for an item that has none');

    // THE CONTROL. Hold one item back and the same assertion fails, so the
    // test is about the builder rather than about a string full of words.
    const withoutSpinach = promptFor(SHELF.filter((item) => item.name !== 'Spinach'));
    assert.ok(!withoutSpinach.includes('Spinach'), 'an item not passed in must not appear');
    assert.ok(withoutSpinach.includes('Eggs'), 'the remaining items must still appear');
  });

  it('carries every emphasis word the day asked for', () => {
    const day = pressedDay();
    const prompt = promptFor(SHELF);

    assert.ok(day.emphasis.length > 0);
    for (const word of day.emphasis) {
      assert.ok(prompt.includes(word), `expected the emphasis "${word}" in the prompt`);
    }

    // THE CONTROL. An untouched day asks for nothing in particular, and the
    // word this day leaned on is then absent from its block.
    const openDay = computeRemainingDay({
      totals: { netCarbs: 0, protein: 0, fiber: 0, kcal: 0, fatG: 0 },
      goals: GOALS,
      slot: 'dinner',
      slotsLeft: 1,
    });
    const openPrompt = buildRecipeProposalUserPrompt({
      pantry: SHELF,
      remainingDayBlock: describeRemainingDayForPrompt(openDay, 'de'),
      slot: openDay.slot,
      language: 'de',
    });
    assert.ok(day.emphasis.includes('light'));
    assert.ok(!openPrompt.includes('Emphasis: light'), 'an open day must not ask for a light meal');
  });

  it('names the slot and the answer language', () => {
    const prompt = promptFor(SHELF);
    assert.ok(prompt.includes('dinner'));
    assert.ok(prompt.includes('de'));
  });
});
