/**
 * The Overview tile's floor, rendered.
 *
 * Three contributors draws the card; two and zero draw NOTHING, and "nothing"
 * here means an empty string of markup rather than a card with zeroes or a
 * "be the first" line. The three-contributor case is the control: a component
 * that always returned null would pass both of the other assertions.
 *
 * The copy comes from the shipped English catalog through `withI18n`, so a key
 * renamed in the component and not in `en/common.json` fails here instead of
 * shipping a raw `pulse.tile.title` to a person.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { PulseTile } from '../../app/components/pulse-tile';
import { showPulseTile, type PulseToday } from '../../app/lib/pulse';

function today(contributors: number): PulseToday {
  return { day: '2026-09-12', meals: 41, photos: 7, kcal: 52_300, protein: 1_240, contributors, fastingNow: 0 };
}

function render(value: PulseToday | null): string {
  return renderToStaticMarkup(withI18n(createElement(PulseTile, { today: value })));
}

describe('showPulseTile', () => {
  it('shows at three contributors and hides at two', () => {
    assert.equal(showPulseTile(today(3)), true);
    assert.equal(showPulseTile(today(2)), false);
    assert.equal(showPulseTile(today(0)), false);
    assert.equal(showPulseTile(null), false);
  });
});

describe('the Overview pulse tile', () => {
  it('renders the four figures at three contributors', () => {
    const markup = render(today(3));
    assert.match(markup, /Today, everyone here/);
    assert.match(markup, /Meals logged/);
    assert.match(markup, /Photos parsed/);
    assert.match(markup, /Calories tracked/);
    assert.match(markup, /Protein tracked/);
    assert.match(markup, /41/);
  });

  it('renders nothing at all at two contributors, at none, and before the read lands', () => {
    assert.equal(render(today(2)), '');
    assert.equal(render(today(0)), '');
    assert.equal(render(null), '');
  });

  it('ships no under-the-floor placeholder', () => {
    for (const markup of [render(today(2)), render(today(0)), render(null)]) {
      assert.doesNotMatch(markup, /be the first/i);
      assert.doesNotMatch(markup, /no one|nobody/i);
    }
  });
});
