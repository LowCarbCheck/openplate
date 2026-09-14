/**
 * The composer strip: one control, three ways in.
 *
 * `/dashboard` renders this instead of the three-button row after the
 * playground review, and `/diary` renders it on all four of its add-entry
 * surfaces. The row itself is unchanged and still ships in `/dev/playground`,
 * so `add-food-actions-hierarchy.test.ts` keeps pinning it and this file pins
 * only what the new structure must not lose.
 *
 * THREE THINGS SURVIVE THE RESTRUCTURE, and each one is a defect this repo has
 * already paid for once: the camera opens inside the tap that asked for it,
 * typing and speaking reach the composer and never the database search, and
 * both icon-only keys carry a name a screen reader can read.
 *
 * Source-level for the same reason as `add-launcher-gesture.test.ts`: the
 * behaviour under test is a browser gesture and a hook, not a return value.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../app/components/add-food-actions-composer.tsx', import.meta.url), 'utf8');

describe('the composer strip', () => {
  it('drives the camera through the shared hook, with the caller its scan target', () => {
    assert.match(source, /import \{ useCameraCapture \} from '#app\/components\/add\/use-camera-capture'/);
    assert.match(source, /const \{ capture, triggerRef, inputRef, inputProps \} = useCameraCapture\(\{ scanTo \}\)/);
  });

  it('makes the photo key a button that captures, never a link', () => {
    const camera = /<button\s+ref=\{triggerRef\}[\s\S]*?<\/button>/.exec(source);
    assert.ok(camera !== null, 'the photo key is gone from the strip');
    assert.match(camera[0], /onClick=\{capture\}/);
    assert.doesNotMatch(camera[0], /<Link/, 'a navigation cannot open a camera');
  });

  it('sends both the wide surface and the mic key to the composer, never to the database search', () => {
    // The defect this structure inherits a fix for: "Type" used to open
    // `/add`, a search field, for a person who came to write a sentence.
    assert.match(source, /to=\{describeTo\}/);
    assert.match(source, /to=\{buildAddHref\(describeTo, \{ speak: true \}\)\}/);
    assert.doesNotMatch(source, /to="\/add"/, 'an affordance points straight at the database search');
  });

  it('names its two icon-only keys, which have no visible label to read', () => {
    // The control for these: the wide surface DOES carry visible words, so a
    // missing label there would not be caught by counting aria-labels alone.
    assert.match(source, /aria-label=\{t\('launcher\.speak'\)\}/);
    assert.match(source, /aria-label=\{t\('launcher\.photo'\)\}/);
    assert.match(source, /\{t\('launcher\.sheetTitle'\)\}/, 'the writing surface says nothing');
  });

  it('gives every key a thumb-sized target, so the strip is not a row of hairlines', () => {
    // `size-11` is 44 px, the smallest target a phone should offer, and the
    // writing surface matches it with a min height rather than a fixed one.
    assert.equal((source.match(/\bsize-11\b/g) ?? []).length, 2, 'an icon key is no longer 44 px square');
    assert.match(source, /\bmin-h-11\b/, 'the writing surface is shorter than the keys beside it');
  });

  it('keeps the capture input outside every conditional, so it cannot unmount mid-gesture', () => {
    assert.match(source, /<input ref=\{inputRef\} \{\.\.\.inputProps\} \/>/);
    assert.doesNotMatch(source, /&& <input ref=\{inputRef\}/);
  });
});
