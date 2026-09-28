/**
 * `/pantry`'s list surface (`PantryList`), M233/02.
 *
 * THE ONE THING WORTH A TEST HERE is the recipes door. "Disabled" on a link is
 * a trap this repo already knows: an `<a>` carrying `aria-disabled` still
 * follows its `href`, so a door that only LOOKS refused would take somebody
 * with an empty pantry to a screen built from nothing. The assertion is
 * therefore about the HREF, not about a class or an attribute, and it is
 * paired with the populated case so it cannot pass against a component that
 * renders no door at all.
 *
 * Static markup over the PROP-DRIVEN component, which is the repo's own shape
 * for a UI fact (no DOM test library here): every state that decides what a
 * person sees is a prop on `PantryList`, never a hook read, so both states are
 * renderable without a store or a provider.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { PantryList, PANTRY_RECIPES_HREF, type PantryDraftRow } from '#app/routes/pantry';

/**
 * A hermetic catalog: this file asserts WHICH keys the screen asks for and
 * what its structure does, never what the shipped bundle says today (see the
 * workspace rule about tests pinning wordsmith-owned wording).
 */
void i18next.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        launcher: { sheetTitle: 'Add food', speak: 'Speak', photo: 'Photo' },
        pantry: {
          lead: 'What you have at home.',
          empty: 'Nothing here yet.',
          composerLabel: 'What do you have?',
          units: { g: 'g', ml: 'ml', piece: 'pieces', pack: 'packs' },
          review: {
            nameLabel: 'Item',
            amountLabel: 'Amount',
            unitLabel: 'Unit',
            unitNone: 'No amount',
            removeAria: 'Remove {{name}}',
            addLine: 'Add a line',
            saveList: 'Save the list',
            saving: 'Saving...',
          },
          recipes: { link: 'Suggest a meal' },
        },
      },
    },
  },
  react: { useSuspense: false },
});

/** One row, as the form holds it. */
const EGGS: PantryDraftRow = { key: 'p1', name: 'Eggs', amount: '6', unit: 'piece', category: 'egg' };

/**
 * The list's static markup, inside a DATA router: the composer's capture hook
 * reads this instance's policy through the root loader's public config, which
 * throws outside one.
 */
function render(element: ReactElement): string {
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries: ['/pantry'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function renderList({ hasStoredItems }: { hasStoredItems: boolean }): string {
  return render(
    createElement(PantryList, {
      rows: hasStoredItems ? [EGGS] : [],
      onChange: () => undefined,
      onSave: () => undefined,
      isSaving: false,
      hasStoredItems,
    }),
  );
}

/** The whole tag that carries the recipes label, so an attribute is read inside that one element. */
function recipesDoorTag(html: string): string {
  const index = html.indexOf('Suggest a meal');
  assert.notEqual(index, -1, 'the recipes door is not rendered at all');
  const openingTag = /<[a-z]+[^>]*>$/.exec(html.slice(0, index));
  assert.notEqual(openingTag, null, 'could not find the tag holding the recipes label');
  return openingTag?.[0] ?? '';
}

describe('the recipes door', () => {
  it('does NOT navigate while the pantry is empty: there is no href to follow', () => {
    const html = renderList({ hasStoredItems: false });

    const tag = recipesDoorTag(html);
    assert.ok(tag.includes('aria-disabled="true"'), `expected the door to be marked disabled, got ${tag}`);
    // THE LOAD-BEARING ONE. `aria-disabled` is a label; an `<a href>` follows
    // its target regardless, so the absence of the href is what actually
    // refuses the navigation.
    assert.ok(!tag.includes('href='), `a disabled door must carry no href, got ${tag}`);
    assert.ok(!html.includes(PANTRY_RECIPES_HREF), 'the recipes path must not appear anywhere on an empty pantry');
  });

  it('DOES navigate once the pantry holds something, which is the control', () => {
    // Without this the test above passes against a component that renders no
    // door at all, or against one whose label was renamed.
    const html = renderList({ hasStoredItems: true });

    const tag = recipesDoorTag(html);
    assert.ok(tag.includes(`href="${PANTRY_RECIPES_HREF}"`), `expected a live link, got ${tag}`);
    assert.ok(!tag.includes('aria-disabled'), `a live door must not claim to be disabled, got ${tag}`);
  });
});

describe('the empty pantry', () => {
  it('shows the composer and one sentence, and no row editor', () => {
    const html = renderList({ hasStoredItems: false });

    assert.ok(html.includes('Nothing here yet.'));
    // The composer is there: it leads with its photo button, named for a shelf.
    assert.ok(html.includes('data-slot="intake-composer-photo"'));
    assert.ok(html.includes('>Photo</span>'));
    // And no list editor, because there is nothing to edit.
    assert.ok(!html.includes('Add a line'), 'an empty pantry must not draw an empty row editor');
  });

  it('shows the rows and the editor once there is something, which is the control', () => {
    const html = renderList({ hasStoredItems: true });

    assert.ok(html.includes('What you have at home.'));
    assert.ok(html.includes('Add a line'));
    assert.ok(html.includes('Remove Eggs'));
  });
});
