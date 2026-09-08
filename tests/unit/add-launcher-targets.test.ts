/**
 * Where the launcher sheet's rows go.
 *
 * The sheet is the discoverable door to every way of adding food. Two of its
 * three rows pointed at `/add`, the database SEARCH: "Type" opened a one-line
 * field with a food list under it, and "Speak" opened the same screen with its
 * microphone armed. Both rows promise words about a meal, and both landed on a
 * box that wants one noun. They point at `/describe` now, which is a composer
 * and nothing else.
 *
 * Source-level, like `add-launcher-gesture.test.ts` beside it: the sheet's
 * content lives in a Radix portal, which renders to nothing under
 * `renderToStaticMarkup`, so the hrefs cannot be read out of markup.
 *
 * Each assertion is paired with the control that fails if a row goes back to
 * the search screen.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const LAUNCHER = readFileSync(new URL('../../app/components/add-launcher.tsx', import.meta.url), 'utf8');

/** The `<Link>` whose body renders the given label key. */
function linkFor(labelKey: string): string {
  const pattern = new RegExp(`<Link to="([^"]+)"[\\s\\S]{0,240}?t\\('${labelKey}'\\)`);
  const found = pattern.exec(LAUNCHER);
  assert.ok(found !== null, `no launcher row renders ${labelKey}`);
  return found[1] ?? '';
}

describe('the launcher sheet', () => {
  it('sends Type to the composer, never to the database search', () => {
    assert.equal(linkFor('launcher.type'), '/describe');
    assert.notEqual(linkFor('launcher.type'), '/add', 'the Type row is a search form again');
  });

  it('sends Speak to the composer with the microphone armed', () => {
    assert.equal(linkFor('launcher.speak'), '/describe?speak=1');
    assert.notEqual(linkFor('launcher.speak'), '/add?speak=1', 'the Speak row is a search form again');
  });

  it('leaves no row pointing at the search screen', () => {
    // The blunt control over both checks above: a fourth row added later that
    // quietly reintroduces the defect fails here even if it uses a new label.
    assert.doesNotMatch(LAUNCHER, /<Link to="\/add/, 'a launcher row points at the database search again');
  });

  it('still has exactly three rows: one photo, one spoken, one typed', () => {
    // The photo row is a BUTTON, not a link: a navigation cannot open a
    // camera. Counting it separately is what stops "three rows" from being
    // satisfied by three links and no shutter.
    assert.equal((LAUNCHER.match(/className=\{LAUNCHER_ITEM_CLASS\}/g) ?? []).length, 3);
    assert.match(LAUNCHER, /onClick=\{capturePhotoFromSheet\}/, 'the photo row stopped opening the camera itself');
    assert.equal(
      (LAUNCHER.match(/<SheetClose asChild>/g) ?? []).length,
      2,
      'the two navigation rows are no longer two',
    );
  });
});
