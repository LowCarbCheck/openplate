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

import { buildAddHref } from '../../app/lib/add-food-hrefs';

const LAUNCHER = readFileSync(new URL('../../app/components/add-launcher.tsx', import.meta.url), 'utf8');

/**
 * The destination of the `<Link>` whose body renders the given label key.
 *
 * The rows carry the viewed day now, so each `to=` is a binding rather than a
 * literal: the name is read out of the markup, the `buildAddHref` call that
 * defines it is read out of the same file, and the call is RUN, for today and
 * for a back-dated day. A row wired to the wrong binding, or a binding built
 * from the wrong path, fails here.
 */
function linkFor(labelKey: string, date: string | null = null): string {
  const link = new RegExp(`<Link to=\\{([A-Za-z][A-Za-z0-9]*)\\}[\\s\\S]{0,240}?t\\('${labelKey}'\\)`).exec(LAUNCHER);
  assert.ok(link !== null, `no launcher row renders ${labelKey}`);
  const binding = link[1] ?? '';
  const built = new RegExp(`const ${binding} = buildAddHref\\('([^']+)', \\{ date: viewedDate(, speak: (true|false))? \\}\\);`).exec(
    LAUNCHER,
  );
  assert.ok(built !== null, `${binding} is not built from the viewed day by buildAddHref`);
  return buildAddHref(built[1] ?? '', { date, speak: built[3] === 'true' });
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

  it('takes both rows to the day on screen, not to today', () => {
    // The bar renders under `/diary?date=<an earlier day>` too. Undated rows
    // there wrote the meal to today and said nothing about it.
    assert.equal(linkFor('launcher.type', '2026-09-07'), '/describe?date=2026-09-07');
    assert.equal(linkFor('launcher.speak', '2026-09-07'), '/describe?date=2026-09-07&speak=1');
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
