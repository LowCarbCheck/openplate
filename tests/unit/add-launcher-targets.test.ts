/**
 * Where the launcher sheet's doors go, and how many cameras the bar has.
 *
 * The sheet used to hand-roll three rows. It renders the composer strip now
 * (M232/03), the same one `/dashboard` and `/diary` draw, so the three doors
 * are one implementation instead of two. This file is rewritten against that
 * shape: the old version counted `LAUNCHER_ITEM_CLASS` occurrences and
 * `SheetClose` tags, which describe rows that no longer exist.
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
 * below is what says so.
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
import type { CameraCapture } from '../../app/components/intake/use-camera-capture';
import { buildIntakeHref } from '../../app/lib/intake-hrefs';

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
        nav: { diary: 'Diary', scan: 'Scan', add: 'Add' },
        launcher: {
          moreOptions: 'More ways to add food',
          sheetTitle: 'Add food',
          speak: 'Speak',
          type: 'Type',
          photo: 'Photo',
        },
      },
    },
  },
  react: { useSuspense: false },
});

const LAUNCHER = readFileSync(new URL('../../app/components/add-launcher.tsx', import.meta.url), 'utf8');

/**
 * A capture the caller already owns, as the launcher hands one to the strip.
 *
 * It opens nothing: this file counts inputs and reads hrefs, and the gesture
 * itself is `add-launcher-gesture.test.ts`'s subject.
 */
const BORROWED_CAPTURE: CameraCapture = {
  capture: () => {},
  triggerRef: { current: null },
  inputRef: { current: null },
  inputProps: { type: 'file' },
};

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
    describeTo: buildIntakeHref('/describe', { date }),
    capture: BORROWED_CAPTURE,
    label: 'Type',
  });
}

describe('the launcher sheet renders the composer strip', () => {
  it('hands the strip its own camera rather than letting it open a second one', () => {
    assert.match(LAUNCHER, /<IntakeComposer[^>]*capture=\{sheetCapture\}/);
    assert.match(LAUNCHER, /const sheetCapture: CameraCapture = \{/);
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
    assert.deepEqual(hrefsOf(render(sheetStrip(null))), ['/describe', '/describe?speak=1']);
    // The blunt control: `/add` is the database SEARCH, which wants one noun
    // from somebody who came to write a sentence.
    assert.ok(!hrefsOf(render(sheetStrip(null))).includes('/add'));
  });

  it('takes both doors to the day on screen, not to today', () => {
    assert.deepEqual(hrefsOf(render(sheetStrip('2026-09-07'))), [
      '/describe?date=2026-09-07',
      '/describe?date=2026-09-07&speak=1',
    ]);
  });

  it('builds the day it hands over through the shared builder', () => {
    // The other end of the chain, which no render can see: the launcher reads
    // the day out of the URL and builds the destination with `buildIntakeHref`.
    assert.match(LAUNCHER, /const viewedDate = parseDateParam\(new URLSearchParams\(location\.search\)\.get\('date'\)\);/);
    assert.match(LAUNCHER, /const describeTo = buildIntakeHref\('\/describe', \{ date: viewedDate \}\);/);
    assert.match(LAUNCHER, /<IntakeComposer describeTo=\{describeTo\}/);
  });
});

describe('how many capture inputs the bar has', () => {
  it('draws exactly one, on the bar itself', () => {
    assert.equal(inputCount(render(createElement(BottomNav))), 1);
  });

  it('adds none when the sheet opens, because the strip was given a camera', () => {
    assert.equal(inputCount(render(sheetStrip(null))), 0);
  });

  it('would draw a second one if the strip opened its own camera', () => {
    // THE CONTROL for the line above, and the naive implementation this spec
    // exists to refuse: the same strip with no `capture` prop renders the
    // input itself, which inside a sheet is an element that unmounts while the
    // camera it opened is still opening.
    assert.equal(inputCount(render(createElement(IntakeComposer, { describeTo: '/describe' }))), 1);
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
