/**
 * Where the launcher sheet's doors go, and how many cameras the bar has.
 *
 * The sheet used to hand-roll three rows. It renders the composer strip now
 * (M232/03), the same one `/dashboard` and `/diary` draw, so typing and
 * speaking are one implementation instead of two. Since M259 the strip in the
 * sheet is words only, and the sheet leads with a photo door of its own, a
 * large filled button, because the operator found the strip's camera key
 * "almost hidden". The old version of this file counted
 * `LAUNCHER_ITEM_CLASS` occurrences and `SheetClose` tags, which describe rows
 * that no longer exist.
 *
 * MOSTLY RENDERED, NOT READ. The strip is an ordinary component, so its
 * destinations and its input can be counted in real markup. Only the wiring
 * between the launcher and the strip is read out of the source, because the
 * sheet's body lives in a Radix portal and `renderToStaticMarkup` draws a
 * portal as nothing.
 *
 * THE INVARIANT THIS FILE EXISTS FOR. There is exactly ONE capture input on
 * the page, the bar's own, and it sits outside the sheet: closing a sheet must
 * not unmount the element whose `click()` is still on the gesture stack
 * (`app/components/intake/use-camera-capture.ts`). A strip that opened its own
 * camera inside the sheet would put a second one there, and the pair of counts
 * below is what says so. There is also exactly ONE camera control in the
 * sheet, the photo door; the strip under it draws no key.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { IntakeComposer } from '../../app/components/intake/intake-composer';
import { BottomNav } from '../../app/components/bottom-nav';
import { MoreSheetProvider } from '../../app/components/more-sheet';
import { ADD_DESCRIBE_PATH, ADD_SEARCH_PATH, buildIntakeHref } from '../../app/lib/intake-hrefs';

/**
 * A hermetic catalog, like `bottom-nav.test.ts` beside it: this file asserts
 * which keys the strip asks for and where its doors point, never what the
 * shipped bundle says today. Inline resources make `init` resolve
 * synchronously, so the first render already sees them.
 */
void i18next.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        nav: { diary: 'Diary', add: 'Add', more: 'More' },
        launcher: {
          sheetTitle: 'Add food',
          speak: 'Speak',
          type: 'Type',
          photo: 'Photo',
          platePhoto: 'Plate photo',
        },
      },
    },
  },
  react: { useSuspense: false },
});

const LAUNCHER = readFileSync(new URL('../../app/components/add-launcher.tsx', import.meta.url), 'utf8');
const PHOTO_DOOR = readFileSync(new URL('../../app/components/intake/photo-door.tsx', import.meta.url), 'utf8');

/**
 * One component's static markup, inside a DATA router.
 *
 * A data router rather than a `MemoryRouter` for the reason `bottom-nav.test.ts`
 * records: the capture hook reads this instance's policy through the root
 * loader's public config, which throws outside one.
 */
function render(element: ReactElement): string {
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries: ['/diary'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/**
 * Every `href="..."` in the markup, in document order.
 *
 * The ampersand between two query parameters is escaped in an attribute, so it
 * is put back: this file compares addresses, not encodings.
 */
function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => (match[1] ?? '').replaceAll('&amp;', '&'));
}

/** How many `<input>` elements the markup has. The strip has no other kind. */
function inputCount(html: string): number {
  return (html.match(/<input\b/g) ?? []).length;
}

/** The strip exactly as the launcher's sheet renders it, for a given viewed day. */
function sheetStrip(date: string | null): ReactElement {
  return createElement(IntakeComposer, {
    describeTo: buildIntakeHref(ADD_DESCRIBE_PATH, { date }),
    label: 'Type',
    variant: 'wordsOnly',
  });
}

/** The bar, inside the More sheet's provider as `AppWrapper` mounts it: its More tab is a door to that sheet. */
function bar(): ReactElement {
  return createElement(MoreSheetProvider, { showsPlanEntry: false }, createElement(BottomNav));
}

describe('the launcher sheet renders the composer strip', () => {
  it('asks for the words-only strip, and hands it no camera to drive', () => {
    assert.match(LAUNCHER, /<IntakeComposer[^>]*variant="wordsOnly"/);
    assert.doesNotMatch(LAUNCHER, /<IntakeComposer[^>]*capture=/, 'the strip in the sheet drives a camera again');
    assert.doesNotMatch(LAUNCHER, /sheetCapture/, 'the sheet builds a capture for its strip again');
  });

  it('draws no camera in that strip, where the default strip draws one', () => {
    assert.doesNotMatch(render(sheetStrip(null)), /lucide-camera/, 'the strip in the sheet draws a camera');
    // THE CONTROL: the same reader finds the camera in the strip `/diary` draws,
    // its large photo button since M260.
    assert.match(render(createElement(IntakeComposer, { describeTo: ADD_DESCRIBE_PATH })), /lucide-camera/);
  });

  it('has no hand-rolled row list left', () => {
    // The control for the line above: a file that rendered the strip AND kept
    // its three rows would satisfy every destination check in this file.
    assert.doesNotMatch(LAUNCHER, /LAUNCHER_ITEM_CLASS/, 'the sheet hand-rolls its rows again');
    assert.doesNotMatch(LAUNCHER, /<SheetClose/, 'the sheet hand-rolls its rows again');
  });

  it('says "Add food" once, in the heading, and lets the strip say "Type"', () => {
    assert.equal((LAUNCHER.match(/t\('launcher\.sheetTitle'\)/g) ?? []).length, 1);
    assert.match(LAUNCHER, /label=\{t\('launcher\.type'\)\}/);
  });
});

describe('where the sheet doors go', () => {
  it('sends typing and speaking to the composer, never to the database search', () => {
    assert.deepEqual(hrefsOf(render(sheetStrip(null))), [ADD_DESCRIBE_PATH, `${ADD_DESCRIBE_PATH}?speak=1`]);
    // The blunt control: `/add/search` is the database SEARCH, which wants
    // one noun from somebody who came to write a sentence.
    assert.ok(!hrefsOf(render(sheetStrip(null))).includes(ADD_SEARCH_PATH));
  });

  it('takes both doors to the day on screen, not to today', () => {
    assert.deepEqual(hrefsOf(render(sheetStrip('2026-09-07'))), [
      `${ADD_DESCRIBE_PATH}?date=2026-09-07`,
      `${ADD_DESCRIBE_PATH}?date=2026-09-07&speak=1`,
    ]);
  });

  it('builds the day it hands over through the shared builder', () => {
    // The other end of the chain, which no render can see: the launcher reads
    // the day out of the URL and builds the destination with `buildIntakeHref`.
    assert.match(LAUNCHER, /const viewedDate = parseDateParam\(new URLSearchParams\(location\.search\)\.get\('date'\)\);/);
    assert.match(LAUNCHER, /const describeTo = buildIntakeHref\(ADD_DESCRIBE_PATH, \{ date: viewedDate \}\);/);
    assert.match(LAUNCHER, /<IntakeComposer describeTo=\{describeTo\}/);
  });
});

/**
 * THE SHEET'S FIRST DOOR IS THE PHOTO (M259), and the one camera in it. The
 * operator: "the photo option needs to be much more prominent and the first
 * thing you want to click on. it's currently almost hidden." Read out of the
 * source, because the sheet's body is a portal and a static render draws a
 * portal as nothing; `tests/e2e/three-tab-bar.spec.ts` measures it, and
 * `add-launcher-gesture.test.ts` owns what happens between its tap and the
 * camera. Since M260 the door is `PhotoDoor`, which the composer strip on
 * `/diary`, `/dashboard` and `/pantry` leads with too, so its look is read out
 * of that component's source.
 */
describe('the photo door', () => {
  const sheetAt = LAUNCHER.indexOf('<SheetContent');
  const photoAt = LAUNCHER.indexOf('dataSlot="add-sheet-photo"');
  const searchAt = LAUNCHER.indexOf('data-slot="add-sheet-search"');

  it('comes first in the sheet, before the search door', () => {
    assert.ok(sheetAt !== -1 && photoAt > sheetAt, 'the photo door is not inside the sheet');
    assert.ok(searchAt > photoAt, 'the photo door must come before the search door');
  });

  it('is the one camera in the sheet', () => {
    // One door, drawn once, and no glyph of the sheet's own beside it; the
    // strip is words only (checked above), so nothing else shows a camera.
    assert.equal((LAUNCHER.match(/<PhotoDoor\b/g) ?? []).length, 1);
    assert.doesNotMatch(LAUNCHER, /<Camera\b/, 'the sheet draws a camera glyph of its own');
    assert.equal((PHOTO_DOOR.match(/<Camera\b/g) ?? []).length, 1, 'the door draws its camera glyph once');
  });

  it('is named in words, with the key the catalog already translates', () => {
    assert.equal((LAUNCHER.match(/t\('launcher\.platePhoto'\)/g) ?? []).length, 1);
  });

  it('is filled, full width and 64 px tall, square cornered', () => {
    const doorAt = PHOTO_DOOR.indexOf('<button');
    assert.notEqual(doorAt, -1, 'the photo door is no longer a button');
    const tag = PHOTO_DOOR.slice(doorAt, PHOTO_DOOR.indexOf('>', PHOTO_DOOR.indexOf('className=', doorAt)));
    assert.match(tag, /\bbg-primary text-primary-foreground\b/, 'the photo door is not filled in the brand');
    assert.match(tag, /\bmin-h-16\b/, 'the photo door is not 64 px tall');
    assert.match(tag, /\bw-full\b/, 'the photo door is not full width');
    assert.doesNotMatch(tag, /\brounded/, 'the photo door rounds its corners');
  });
});

/**
 * THE SEARCH DOOR COMES NEXT (M258). The bar's Add tab was the way to
 * `/add/search` until M258 took it away, and the strip below cannot be that
 * way: its "Type" opens the composer. So the sheet carries a search door of
 * its own, under the photo door, and it logs to the day on screen like every
 * other door. Read out of the source for the portal's reason above;
 * `tests/e2e/three-tab-bar.spec.ts` taps it.
 */
describe('the search door', () => {
  it('builds its address through the shared builder, carrying the viewed day', () => {
    assert.match(LAUNCHER, /const searchTo = buildIntakeHref\(ADD_SEARCH_PATH, \{ date: viewedDate \}\);/);
    assert.match(LAUNCHER, /<Link\s+to=\{searchTo\}/);
    assert.equal(buildIntakeHref(ADD_SEARCH_PATH, { date: '2026-09-07' }), `${ADD_SEARCH_PATH}?date=2026-09-07`);
    assert.equal(buildIntakeHref(ADD_SEARCH_PATH, { date: null }), ADD_SEARCH_PATH);
  });

  it('sits above the strip, inside the sheet', () => {
    const sheetAt = LAUNCHER.indexOf('<SheetContent');
    const searchAt = LAUNCHER.indexOf('to={searchTo}');
    const stripAt = LAUNCHER.indexOf('<IntakeComposer describeTo=');
    assert.ok(sheetAt !== -1 && searchAt > sheetAt, 'the search door is not inside the sheet');
    assert.ok(stripAt > searchAt, 'the search door must come before the strip');
  });

  it('is labelled once, with its own key', () => {
    assert.equal((LAUNCHER.match(/t\('launcher\.searchFoods'\)/g) ?? []).length, 1);
  });

  it('has no hardcoded search address beside the built one', () => {
    // The control for the builder check above: a file that built `searchTo`
    // and then rendered a literal would pass it and lose the day.
    assert.doesNotMatch(LAUNCHER, /to="\/add\/search/);
  });
});

describe('how many capture inputs the bar has', () => {
  it('draws exactly one, on the bar itself', () => {
    assert.equal(inputCount(render(bar())), 1);
  });

  it('adds none when the sheet opens, because the words-only strip opens no camera', () => {
    assert.equal(inputCount(render(sheetStrip(null))), 0);
  });

  it('would draw a second one if the strip opened its own camera', () => {
    // THE CONTROL for the line above, and the naive implementation this spec
    // exists to refuse: the same strip with no `capture` prop renders the
    // input itself, which inside a sheet is an element that unmounts while the
    // camera it opened is still opening.
    assert.equal(inputCount(render(createElement(IntakeComposer, { describeTo: ADD_DESCRIBE_PATH }))), 1);
  });

  it('keeps that one input outside the sheet', () => {
    const sheetStart = LAUNCHER.indexOf('<SheetContent');
    assert.notEqual(sheetStart, -1);
    const inputAt = LAUNCHER.indexOf('<input ref={inputRef} {...inputProps} />');
    assert.notEqual(inputAt, -1, 'the bar no longer renders the input the hook owns');
    assert.ok(inputAt < sheetStart, 'the capture input moved inside the sheet, where a close can unmount it');
    assert.equal((LAUNCHER.match(/<input\b/g) ?? []).length, 1);
  });
});
