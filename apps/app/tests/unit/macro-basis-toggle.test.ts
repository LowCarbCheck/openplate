/**
 * `MacroBasisToggle` (`app/components/macro-basis-toggle.tsx`) rendered to
 * static markup: one pressed option at a time, two options of one fixed width,
 * and a group name for assistive tech.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { MacroBasisToggle } from '../../app/components/macro-basis-toggle';
import type { MacroShareBasis } from '../../app/lib/macro-share-basis';

function render(basis: MacroShareBasis): string {
  return renderToStaticMarkup(
    withI18n(createElement(MacroBasisToggle, { basis, onChange: () => undefined, idPrefix: 'probe' })),
  );
}

/** Each button as `[id, pressed, text]`. */
function buttonsOf(html: string): [string, string, string][] {
  return [...html.matchAll(/<button id="([^"]+)"[^>]*aria-pressed="(true|false)"[^>]*>([^<]*)<\/button>/g)].map(
    (match) => [match[1] ?? '', match[2] ?? '', match[3] ?? ''],
  );
}

describe('MacroBasisToggle', () => {
  it('has exactly one pressed option, the active basis', () => {
    const kcal = render('kcal');
    assert.equal([...kcal.matchAll(/aria-pressed="true"/g)].length, 1);
    assert.deepEqual(buttonsOf(kcal), [
      ['probe-kcal', 'true', 'kcal'],
      ['probe-grams', 'false', 'g'],
    ]);
  });

  it('moves the pressed state when the basis changes (control: not stuck on kcal)', () => {
    const grams = render('grams');
    assert.equal([...grams.matchAll(/aria-pressed="true"/g)].length, 1);
    assert.deepEqual(buttonsOf(grams), [
      ['probe-kcal', 'false', 'kcal'],
      ['probe-grams', 'true', 'g'],
    ]);
  });

  it('gives both options one fixed width and a 44 px floor, so switching changes nothing', () => {
    const html = render('kcal');
    const classes = [...html.matchAll(/<button [^>]*class="([^"]*)"/g)].map((match) => match[1] ?? '');
    assert.equal(classes.length, 2);
    for (const className of classes) {
      assert.ok(/\bw-12\b/.test(className), className);
      assert.ok(/\bmin-h-11\b/.test(className), className);
      assert.ok(/\bmin-w-11\b/.test(className), className);
    }
  });

  it('marks the active option with a foreground border and spends no teal on it', () => {
    for (const basis of ['kcal', 'grams'] as const) {
      const html = render(basis);
      assert.ok(!/primary/.test(html), `${basis}: the teal budget has no room for a toggle`);
      assert.equal([...html.matchAll(/\bborder-foreground\b/g)].length, 1, `${basis}: one option wears the border`);
      // Control: the other option wears a transparent border of the same width, so nothing resizes.
      assert.equal([...html.matchAll(/\bborder-transparent\b/g)].length, 1);
      assert.equal([...html.matchAll(/\bborder-2\b/g)].length, 2);
    }
  });

  it('is a named group with square corners', () => {
    const html = render('kcal');
    assert.match(html, /<fieldset[^>]*aria-label="Share basis"/);
    assert.ok(!/\brounded/.test(html), 'no rounded-* class on a square-cornered control');
  });
});
