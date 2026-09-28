/**
 * `Wordmark`'s `wave` mode, the boot screen's name (the operator's "option E", 2026-09-23).
 *
 * THE CLAIMS. With `wave` the word is nine spans, one per letter, and still reads "openplate".
 * The four letters of "open" keep the brand teal and carry no animation. The five letters of
 * "plate" carry the `wordmark-wave` class, each delayed by its index across the whole word times
 * 0.1 s, so "p" starts at 0.4 s and "e" at 0.8 s. The word is hidden from screen readers, so no
 * reader spells it out. Without `wave`, every existing caller gets exactly the markup it had.
 *
 * THE CONTROLS. The letter reader must find no letters in the plain word, so a reader that
 * matched any span at all cannot pass the first claim. The class reader must see no wave class
 * in the plain word, so an assertion that "open" carries no animation is shown to be able to see
 * one. Whether the class animates in a real browser, and stops under reduced motion, is the
 * browser tier's claim, in `tests/e2e/app-loading.spec.ts`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Wordmark } from '../../app/components/wordmark';

/** One letter span, as the markup writes it. */
interface Letter {
  text: string;
  className: string;
  delay: string | null;
}

/** The single-character spans of a rendered word, in order. */
function lettersOf(markup: string): Letter[] {
  const found: Letter[] = [];
  for (const match of markup.matchAll(/<span class="([^"]*)"(?: style="animation-delay:([^"]*)")?>(.)<\/span>/g)) {
    found.push({ className: match[1], delay: match[2] ?? null, text: match[3] });
  }
  return found;
}

const waveMarkup = renderToStaticMarkup(createElement(Wordmark, { wave: true }));
const plainMarkup = renderToStaticMarkup(createElement(Wordmark));

describe('Wordmark wave mode', () => {
  it('splits the word into nine letters that still spell openplate', () => {
    const letters = lettersOf(waveMarkup);
    assert.equal(letters.length, 9);
    assert.equal(letters.map((letter) => letter.text).join(''), 'openplate');
  });

  it('control: the letter reader finds no letters in the plain word', () => {
    assert.equal(lettersOf(plainMarkup).length, 0);
  });

  it('keeps "open" teal and still', () => {
    for (const letter of lettersOf(waveMarkup).slice(0, 4)) {
      assert.equal(letter.className, 'text-primary', `"${letter.text}" is teal`);
      assert.equal(letter.delay, null, `"${letter.text}" has no delay`);
    }
  });

  it('staggers every letter of "plate" by its index across the whole word', () => {
    const plate = lettersOf(waveMarkup).slice(4);
    assert.deepEqual(
      plate.map((letter) => [letter.text, letter.className, letter.delay]),
      [
        ['p', 'wordmark-wave', '0.4s'],
        ['l', 'wordmark-wave', '0.5s'],
        ['a', 'wordmark-wave', '0.6s'],
        ['t', 'wordmark-wave', '0.7s'],
        ['e', 'wordmark-wave', '0.8s'],
      ],
    );
  });

  it('hides the animated word from screen readers', () => {
    assert.match(waveMarkup, /^<span[^>]* aria-hidden="true">/);
  });

  it('leaves the plain word exactly as every existing caller had it', () => {
    assert.equal(
      plainMarkup,
      '<span class="font-display font-thin tracking-[-0.03em]"><span class="text-primary">open</span>plate</span>',
    );
    assert.doesNotMatch(plainMarkup, /wordmark-wave|aria-hidden/);
  });

  it('control: the wave class is visible to the reader that says the plain word has none', () => {
    assert.match(waveMarkup, /wordmark-wave/);
  });
});
