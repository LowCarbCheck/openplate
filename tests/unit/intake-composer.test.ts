/**
 * The composer strip: one control, three ways in.
 *
 * `/dashboard` and `/diary` both render `IntakeComposer` on their add-entry
 * surfaces; the old three-button row (`add-food-actions.tsx`) and its pin
 * test (`add-food-actions-hierarchy.test.ts`) are gone, and this file pins
 * the invariants that structure must not lose.
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
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { IntakeComposer, type IntakeComposerProps } from '#app/components/intake/intake-composer';
import type { CameraCapture } from '#app/components/intake/use-camera-capture';
import { ADD_DESCRIBE_PATH, ADD_PHOTO_PATH } from '#app/lib/intake-hrefs';

const source = readFileSync(new URL('../../app/components/intake/intake-composer.tsx', import.meta.url), 'utf8');
const LAUNCHER = readFileSync(new URL('../../app/components/add-launcher.tsx', import.meta.url), 'utf8');
const DASHBOARD = readFileSync(new URL('../../app/routes/dashboard.tsx', import.meta.url), 'utf8');
const DIARY = readFileSync(new URL('../../app/routes/diary.tsx', import.meta.url), 'utf8');

/**
 * A hermetic catalog, as `add-launcher-targets.test.ts` uses: this file asserts
 * which keys the strip asks for, never what the shipped bundle says today.
 * Inline resources make `init` resolve synchronously, so the first render
 * already sees them.
 */
void i18next.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: { translation: { launcher: { sheetTitle: 'Add food', speak: 'Speak', type: 'Type', photo: 'Photo' } } },
  },
  react: { useSuspense: false },
});

/**
 * One strip's static markup, inside a DATA router: the capture hook reads this
 * instance's policy through the root loader's public config, which throws
 * outside one.
 */
function render(element: ReactElement): string {
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries: ['/diary'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** The camera key's class attribute, found by the only name it carries. */
function cameraKeyClass(html: string): string {
  const key = /<button[^>]*aria-label="Photo"[^>]*>/.exec(html);
  assert.ok(key !== null, 'the camera key is gone from the rendered strip');
  const classAttribute = /class="([^"]*)"/.exec(key[0]);
  assert.ok(classAttribute !== null, 'the camera key carries no classes at all');
  return classAttribute[1] ?? '';
}

/**
 * A real function, not `declare`: `declare` erases to nothing at runtime and
 * the call below would throw. This one exists purely so `tsc` checks the
 * argument's type; it does nothing when node:test actually runs it.
 */
function typeCheckOnly(_props: IntakeComposerProps): void {}

describe('the composer strip', () => {
  it('drives the camera through the shared hook, with the caller its scan target', () => {
    assert.match(
      source,
      /import \{ useCameraCapture, type CameraCapture \} from '#app\/components\/intake\/use-camera-capture'/,
    );
    assert.match(source, /const camera = useCameraCapture\(\{ scanTo \}\)/);
  });

  it('takes a camera the caller already owns, and then opens none of its own', () => {
    // The launcher's sheet hands one down (M232/03), because that page's
    // capture input sits OUTSIDE the sheet: closing a sheet must not unmount
    // the element whose `click()` is on the gesture stack. The counts are in
    // `add-launcher-targets.test.ts`; this pins the seam they count through.
    assert.match(source, /capture: CameraCapture;\s*\n\s*scanTo\?: never;/);
    assert.match(source, /if \(props\.capture !== undefined\) \{/);
    assert.match(source, /camera=\{props\.capture\} \/>;/);
    // The hook is called in the branch that renders the input, and nowhere
    // else, so neither can exist without the other.
    assert.equal((source.match(/useCameraCapture\(/g) ?? []).length, 1);
  });

  it('makes capture and scanTo mutually exclusive, a compile error rather than a silent drop', () => {
    // Before M232/03's follow-up fix, `capture` and `scanTo` were two
    // independent optional fields, so a caller could pass both and `scanTo`
    // was quietly dropped mid-spread with no diagnostic anywhere. The
    // discriminated union in `IntakeComposerProps` forbids the
    // combination at the call site instead; the real assertion is the
    // `@ts-expect-error` below, which `pnpm typecheck` enforces.
    // SAFETY: an empty object stands in for a real capture here; only its type,
    // never its shape, matters to the compile-time check below.
    const capture = {} as CameraCapture;
    // @ts-expect-error capture and scanTo cannot both be set; see the module's props union
    typeCheckOnly({ describeTo: ADD_DESCRIBE_PATH, capture, scanTo: ADD_PHOTO_PATH });
    assert.match(source, /capture\?: never;/, 'the scanTo-branch of the union still forbids capture');
    assert.match(source, /scanTo\?: string;/, 'the capture-branch of the union still forbids a non-never scanTo');
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
    assert.match(source, /to=\{buildIntakeHref\(describeTo, \{ speak: true \}\)\}/);
    assert.doesNotMatch(source, /to="\/add"/, 'an affordance points straight at the database search');
  });

  it('names its two icon-only keys, which have no visible label to read', () => {
    // The control for these: the wide surface DOES carry visible words, so a
    // missing label there would not be caught by counting aria-labels alone.
    assert.match(source, /aria-label=\{t\('launcher\.speak'\)\}/);
    assert.match(source, /aria-label=\{t\('launcher\.photo'\)\}/);
    assert.match(source, /\{label \?\? t\('launcher\.sheetTitle'\)\}/, 'the writing surface says nothing');
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

/**
 * TWO INTENTIONAL STATES, NOT ONE GLOBAL CHANGE (M232/04).
 *
 * The filled camera key was a deliberate call and it survives: a photo costs a
 * permission prompt, and on `/dashboard` and `/diary` this strip is the only
 * prominent camera a desktop or tablet has, because the tab bar's raised
 * circle is phone-only. The sheet is the single exception, since the filled
 * plus circle that opened it is on screen a few pixels below it.
 *
 * So each half is asserted against the other: whatever says "filled" here must
 * be absent from the embedded render, and the reverse, and a single treatment
 * applied everywhere would fail one of the two.
 */
describe("the camera key's weight", () => {
  /** A capture the caller already owns, as the launcher's sheet hands one down. It opens nothing. */
  const BORROWED_CAPTURE: CameraCapture = {
    capture: () => {},
    triggerRef: { current: null },
    inputRef: { current: null },
    inputProps: { type: 'file' },
  };

  // The pair, not `bg-primary` alone: the outline's own hover class contains
  // that substring, so the looser literal would pass against either variant.
  const FILLED = 'bg-primary text-primary-foreground';
  const OUTLINE = 'border-primary/40';

  it('fills the key on a page that owns no camera, which is /dashboard and /diary', () => {
    const classes = cameraKeyClass(render(createElement(IntakeComposer, { describeTo: ADD_DESCRIBE_PATH })));
    assert.ok(classes.includes(FILLED), `the standalone camera key lost its fill: ${classes}`);
    assert.ok(!classes.includes(OUTLINE), 'the standalone key is drawn as an outline');
  });

  it('outlines the key inside the launcher sheet, where the filled plus is already on screen', () => {
    const embedded = createElement(IntakeComposer, {
      describeTo: ADD_DESCRIBE_PATH,
      capture: BORROWED_CAPTURE,
      label: 'Type',
      variant: 'embedded',
    });
    const classes = cameraKeyClass(render(embedded));
    assert.ok(classes.includes(OUTLINE), `the embedded camera key is not an outline: ${classes}`);
    assert.ok(!classes.includes(FILLED), 'the embedded key is still drawn filled');
  });

  it('demotes the key only where the variant says so, never by borrowing a camera', () => {
    // The control that makes the pair above mean something: a strip given a
    // caller's capture but no variant is a `/dashboard`-weight key, so the
    // demotion cannot ride in on `capture` by accident.
    const borrowedButStandalone = createElement(IntakeComposer, {
      describeTo: ADD_DESCRIBE_PATH,
      capture: BORROWED_CAPTURE,
    });
    const classes = cameraKeyClass(render(borrowedButStandalone));
    assert.ok(classes.includes(FILLED), 'borrowing a camera quietly demoted the key');
    assert.ok(!classes.includes(OUTLINE), 'borrowing a camera quietly demoted the key');
  });

  it('asks for the outline at exactly one call site, the sheet', () => {
    assert.match(LAUNCHER, /<IntakeComposer[^>]*variant="embedded"/, 'the sheet stopped asking for it');
    assert.doesNotMatch(DASHBOARD, /<IntakeComposer[^>]*variant=/, '/dashboard took the sheet treatment');
    const diaryStrips = DIARY.match(/<IntakeComposer[^>]*\/>/g) ?? [];
    assert.equal(diaryStrips.length, 4, '/diary no longer has its four add-entry surfaces');
    for (const strip of diaryStrips) {
      assert.doesNotMatch(strip, /variant=/, '/diary took the sheet treatment');
    }
  });
});
