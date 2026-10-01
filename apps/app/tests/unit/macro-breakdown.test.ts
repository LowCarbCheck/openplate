/**
 * `MacroBreakdown` (`app/components/day-summary-details.tsx`), the four cells
 * under the diary's ratio bar, rendered to static markup with the shipped
 * English catalog. The grid keeps four cells on both bases; by calories the
 * fibre cell is kept as an `invisible` box so switching moves nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { MacroBreakdown } from '../../app/components/day-summary-details';
import type { MacroShareBasis } from '../../app/lib/macro-share-basis';

const DAY = { carbs: 100, protein: 100, fat: 100, fiber: 20 };

function render(basis: MacroShareBasis, grams = DAY): string {
  return renderToStaticMarkup(withI18n(createElement(MacroBreakdown, { grams, basis })));
}

/** Each cell as `[macro, isInvisible, percent text]`. */
function cellsOf(html: string): [string, boolean, string][] {
  return [
    ...html.matchAll(
      /data-slot="macro-share-cell" data-macro="(\w+)" class="([^"]*)">.*?<dd data-slot="macro-share"[^>]*>([^<]*)<\/dd>/g,
    ),
  ].map((match) => [match[1] ?? '', /\binvisible\b/.test(match[2] ?? ''), match[3] ?? '']);
}

describe('MacroBreakdown', () => {
  it('keeps four cells by calories, with the fibre cell invisible and the other three shown', () => {
    const cells = cellsOf(render('kcal'));
    assert.deepEqual(
      cells.map(([macro, isInvisible]) => [macro, isInvisible]),
      [
        ['carbs', false],
        ['fiber', true],
        ['protein', false],
        ['fat', false],
      ],
    );
    assert.deepEqual(
      cells.filter(([, isInvisible]) => !isInvisible).map(([, , text]) => text),
      ['24%', '24%', '53%'],
    );
  });

  it('shows all four cells by grams, none invisible (control: the invisible class is not always on)', () => {
    const cells = cellsOf(render('grams'));
    assert.deepEqual(
      cells.map(([macro, isInvisible]) => [macro, isInvisible]),
      [
        ['carbs', false],
        ['fiber', false],
        ['protein', false],
        ['fat', false],
      ],
    );
    assert.deepEqual(
      cells.map(([, , text]) => text),
      ['31%', '6%', '31%', '31%'],
    );
  });

  it('holds the very text gram mode shows in the invisible fibre cell, so its height cannot differ', () => {
    const kcalFibre = cellsOf(render('kcal')).find(([macro]) => macro === 'fiber');
    const gramsFibre = cellsOf(render('grams')).find(([macro]) => macro === 'fiber');
    assert.equal(kcalFibre?.[2], gramsFibre?.[2]);
  });

  it('says unknown in all four cells, none invisible, when nothing is logged', () => {
    const none = { carbs: 0, protein: 0, fat: 0, fiber: 0 };
    for (const basis of ['kcal', 'grams'] as const) {
      const cells = cellsOf(render(basis, none));
      assert.equal(cells.length, 4);
      for (const [macro, isInvisible, text] of cells) {
        assert.equal(isInvisible, false, `${macro} on ${basis}`);
        assert.equal(text, 'unknown');
      }
    }
  });

  it('reports the basis on the grid, for the browser tier', () => {
    assert.match(render('kcal'), /data-slot="macro-breakdown" data-basis="kcal"/);
    assert.match(render('grams'), /data-slot="macro-breakdown" data-basis="grams"/);
  });
});
