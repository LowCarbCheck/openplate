/**
 * The not-checked line on the scan review (M219/03 follow-up).
 *
 * A person who listed an allergy or a pregnancy used to get a chip when a flag
 * matched and NOTHING otherwise, so a scan nobody checked looked the same as a
 * scan checked and clear. `notCheckedNote` is the pure decision of which line
 * the screen owes that person, `profileWantsCautions` is the gate it shares
 * with `decideCautions`, and the real `ConfirmDraftForm` is rendered to prove
 * where the box and the line come out.
 *
 * Every assertion has its control: the same foods for a person with nothing
 * listed, the same person for foods that were checked in full, a one-food
 * change that moves the answer from one word to the other. The sentences are
 * read out of the English catalog and never typed here, because wording is the
 * translator's to change; the tests pin the KEY a line reads and the markup
 * around it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { z } from 'zod';

import { withI18n } from './trends-i18n-harness';
import { CAUTIONS_NOT_CHECKED_SLOT } from '../../app/components/food-caution-chip';
import { NO_CAUTION_PROFILE, notCheckedNote, profileWantsCautions } from '../../app/lib/food-cautions';
import type { CautionProfile } from '../../app/lib/food-cautions';
import { ConfirmDraftForm } from '../../app/routes/add.photo';
import type { FoodFlags } from '../../app/services/vision/schema';
import type { PlateIdentification } from '../../app/services/vision';
import type { FlagsCoverage } from '../../app/services/vision/types';

const copy = z
  .object({ cautions: z.object({ notChecked: z.object({ all: z.string(), partial: z.string() }) }) })
  .parse(
    JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
  ).cautions.notChecked;

const MILK_ALLERGIC: CautionProfile = { reproductiveStatus: 'none', allergens: ['milk'] };
const PREGNANT: CautionProfile = { reproductiveStatus: 'pregnant', allergens: [] };
const LACTATING: CautionProfile = { reproductiveStatus: 'lactating', allergens: [] };

const CHECKED_EMPTY: FoodFlags = { pregnancy: [], allergens: [], mayContain: [] };
const CONTAINS_MILK: FoodFlags = { pregnancy: [], allergens: ['milk'], mayContain: [] };

/** A food as the notes read it: absent flags is "not assessed", and a coverage is the provider's own word. */
interface FoodCase {
  flags?: FoodFlags;
  flagsCoverage?: FlagsCoverage;
}

const NOT_ASSESSED: FoodCase = {};
const CHECKED: FoodCase = { flags: CHECKED_EMPTY };
const CHECKED_WITH_CHIP: FoodCase = { flags: CONTAINS_MILK };
const PARTIAL: FoodCase = { flags: CHECKED_EMPTY, flagsCoverage: 'partial' };
const PARTIAL_WITH_CHIP: FoodCase = { flags: CONTAINS_MILK, flagsCoverage: 'partial' };

describe('profileWantsCautions', () => {
  const table: { name: string; profile: CautionProfile; expected: boolean }[] = [
    { name: 'a milk allergy', profile: MILK_ALLERGIC, expected: true },
    { name: 'pregnant', profile: PREGNANT, expected: true },
    { name: 'breastfeeding', profile: LACTATING, expected: true },
    { name: 'both', profile: { reproductiveStatus: 'pregnant', allergens: ['milk'] }, expected: true },
    // The controls: each is the same shape with the one listed fact taken out.
    { name: 'status none and no allergy', profile: { reproductiveStatus: 'none', allergens: [] }, expected: false },
    {
      name: 'status never answered and no allergy',
      profile: { reproductiveStatus: null, allergens: [] },
      expected: false,
    },
    { name: 'no profile at all', profile: NO_CAUTION_PROFILE, expected: false },
  ];
  for (const { name, profile, expected } of table) {
    it(`answers ${expected} for ${name}`, () => {
      assert.equal(profileWantsCautions(profile), expected);
    });
  }
});

describe('notCheckedNote', () => {
  const table: { name: string; profile: CautionProfile; foods: FoodCase[]; expected: 'all' | 'partial' | null }[] = [
    // `all`: nothing on the screen was checked.
    { name: 'one food, no flags', profile: MILK_ALLERGIC, foods: [NOT_ASSESSED], expected: 'all' },
    { name: 'every food without flags', profile: MILK_ALLERGIC, foods: [NOT_ASSESSED, NOT_ASSESSED], expected: 'all' },
    {
      name: 'every food without flags, pregnant',
      profile: PREGNANT,
      foods: [NOT_ASSESSED, NOT_ASSESSED],
      expected: 'all',
    },
    // `partial`: some of it was, or all of it was only partly.
    { name: 'one food partial', profile: MILK_ALLERGIC, foods: [PARTIAL], expected: 'partial' },
    {
      name: 'a partial food that earns a chip',
      profile: MILK_ALLERGIC,
      foods: [PARTIAL_WITH_CHIP],
      expected: 'partial',
    },
    {
      name: 'a mix of unflagged and checked',
      profile: MILK_ALLERGIC,
      foods: [NOT_ASSESSED, CHECKED],
      expected: 'partial',
    },
    {
      name: 'a mix of unflagged and partial',
      profile: MILK_ALLERGIC,
      foods: [NOT_ASSESSED, PARTIAL],
      expected: 'partial',
    },
    { name: 'a mix of partial and checked', profile: MILK_ALLERGIC, foods: [CHECKED, PARTIAL], expected: 'partial' },
    {
      name: 'one unflagged among checked',
      profile: PREGNANT,
      foods: [CHECKED, CHECKED_WITH_CHIP, NOT_ASSESSED],
      expected: 'partial',
    },
    // CONTROLS: every food was checked in full, so there is nothing to say.
    {
      name: 'every food flagged with three empty lists',
      profile: MILK_ALLERGIC,
      foods: [CHECKED, CHECKED],
      expected: null,
    },
    {
      name: 'checked foods, one of them with a chip',
      profile: MILK_ALLERGIC,
      foods: [CHECKED, CHECKED_WITH_CHIP],
      expected: null,
    },
    { name: 'no foods at all', profile: MILK_ALLERGIC, foods: [], expected: null },
    // CONTROLS: the same unchecked foods for a person with nothing listed.
    {
      name: 'unflagged foods, no allergy and no pregnancy',
      profile: NO_CAUTION_PROFILE,
      foods: [NOT_ASSESSED, NOT_ASSESSED],
      expected: null,
    },
    {
      name: 'unflagged foods, status none',
      profile: { reproductiveStatus: 'none', allergens: [] },
      foods: [NOT_ASSESSED],
      expected: null,
    },
    {
      name: 'partial foods, nothing listed',
      profile: NO_CAUTION_PROFILE,
      foods: [PARTIAL, NOT_ASSESSED],
      expected: null,
    },
  ];
  for (const { name, profile, foods, expected } of table) {
    it(`answers ${String(expected)} for ${name}`, () => {
      assert.equal(notCheckedNote(profile, foods), expected);
    });
  }

  it('narrows from all, to partial, to null as more foods of one screen are checked in full', () => {
    assert.equal(notCheckedNote(MILK_ALLERGIC, [NOT_ASSESSED, NOT_ASSESSED]), 'all');
    assert.equal(notCheckedNote(MILK_ALLERGIC, [NOT_ASSESSED, CHECKED]), 'partial');
    assert.equal(notCheckedNote(MILK_ALLERGIC, [CHECKED, CHECKED]), null);
  });

  it('makes the coverage the only difference between a checked food and a partly checked one', () => {
    // A control for the partial arm: the coverage is the ONLY difference.
    assert.equal(notCheckedNote(MILK_ALLERGIC, [{ flags: CHECKED_EMPTY }]), null);
    assert.equal(notCheckedNote(MILK_ALLERGIC, [{ flags: CHECKED_EMPTY, flagsCoverage: 'partial' }]), 'partial');
  });
});

/** A one-food or two-food plate, the foods as given. */
function plateOf(foods: FoodCase[]): PlateIdentification {
  return {
    unreadable: false,
    foods: foods.map((food, index) => ({
      name: `Food ${index + 1}`,
      translations: { en: `Food ${index + 1}` },
      estimatedGrams: 100,
      confidence: 'high',
      macroSource: 'estimated',
      macrosPer100g: { carbs: 5, protein: 5, fat: 5, kcal: 100 },
      ...food,
    })),
  };
}

function renderReview(profile: CautionProfile, foods: FoodCase[]): string {
  const router = createMemoryRouter(
    [
      {
        path: '/scan',
        element: withI18n(
          createElement(ConfirmDraftForm, {
            cautionProfile: profile,
            identification: plateOf(foods),
            intakeSource: 'photo',
            foodDb: undefined,
            modelId: 'test-model',
            lastResult: undefined,
            logDate: null,
            logDateLabel: null,
            photoFile: null,
            userId: 0,
            defaultMealType: 'dinner',
            typedText: null,
          }),
        ),
      },
    ],
    { initialEntries: ['/scan'] },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** The slot's box and what it holds, or `undefined` when the screen has no such box. */
function slotOf(markup: string): { open: string; inner: string } | undefined {
  const match = new RegExp(`<div[^>]*data-slot="${CAUTIONS_NOT_CHECKED_SLOT}"[^>]*>(.*?)</div>`).exec(markup);
  if (match === null) return undefined;
  return { open: match[0].slice(0, match[0].indexOf('>') + 1), inner: match[1] ?? '' };
}

describe('the scan review renders the line', () => {
  it('shows the all-not-checked sentence in a role="note" inside a reserved box', () => {
    const slot = slotOf(renderReview(MILK_ALLERGIC, [NOT_ASSESSED, NOT_ASSESSED]));
    assert.ok(slot, 'the review has no not-checked box');
    assert.match(slot.open, /min-h-8/, 'the box does not reserve its two lines');
    assert.match(slot.inner, /role="note"/);
    assert.ok(slot.inner.includes(copy.all), 'the box does not carry the catalog sentence for all');
    assert.ok(!slot.inner.includes(copy.partial));
  });

  it('shows the partial sentence for a mix, and not the all one', () => {
    const slot = slotOf(renderReview(PREGNANT, [NOT_ASSESSED, CHECKED]));
    assert.ok(slot, 'the review has no not-checked box');
    assert.ok(slot.inner.includes(copy.partial));
    assert.ok(!slot.inner.includes(copy.all));
  });

  it('keeps the reserved box, empty, for a person with something listed whose foods were all checked', () => {
    const slot = slotOf(renderReview(MILK_ALLERGIC, [CHECKED, CHECKED_WITH_CHIP]));
    assert.ok(slot, 'the box must exist on every screen of a person with something listed');
    assert.match(slot.open, /min-h-8/);
    assert.equal(slot.inner, '', 'a checked scan must carry no line');
  });

  it('draws no box at all for a person with nothing listed, however unchecked the foods', () => {
    const markup = renderReview(NO_CAUTION_PROFILE, [NOT_ASSESSED, NOT_ASSESSED]);
    assert.equal(slotOf(markup), undefined);
    assert.ok(!markup.includes(copy.all));
    assert.ok(!markup.includes('role="note"'));
  });

  it('draws the box for the same person once something is listed, the control for the case above', () => {
    assert.ok(slotOf(renderReview({ reproductiveStatus: 'lactating', allergens: [] }, [NOT_ASSESSED])));
  });
});
