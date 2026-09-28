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
 * the icon-only key carries a name a screen reader can read. Since M260 the
 * camera is not an icon-only key any more: the strip leads with the add
 * sheet's large photo button, named in words.
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
import { ADD_DESCRIBE_PATH, ADD_PHOTO_PATH } from '#app/lib/intake-hrefs';

const source = readFileSync(new URL('../../app/components/intake/intake-composer.tsx', import.meta.url), 'utf8');
const PHOTO_DOOR = readFileSync(new URL('../../app/components/intake/photo-door.tsx', import.meta.url), 'utf8');
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
    en: {
      translation: {
        launcher: { sheetTitle: 'Add food', speak: 'Speak', type: 'Type', photo: 'Photo', platePhoto: 'Plate photo' },
      },
    },
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

/** The strip's photo button, whole, found by the slot the strip gives it. */
function photoButton(html: string): string {
  const button = /<button[^>]*data-slot="intake-composer-photo"[^>]*>[\s\S]*?<\/button>/.exec(html);
  assert.ok(button !== null, 'the photo button is gone from the rendered strip');
  return button[0];
}

/** The class attribute of the first tag in `html`. */
function classOf(html: string): string {
  const classAttribute = /class="([^"]*)"/.exec(html);
  assert.ok(classAttribute !== null, 'the tag carries no classes at all');
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
    assert.match(source, /import \{ useCameraCapture \} from '#app\/components\/intake\/use-camera-capture'/);
    assert.match(source, /const \{ capture, triggerRef, inputRef, inputProps \} = useCameraCapture\(\{ scanTo \}\)/);
  });

  it('draws the words-only strip with no camera behind it, and opens none', () => {
    // The launcher's sheet asks for it (M259): its own photo door is that
    // sheet's camera, and its capture input sits OUTSIDE the sheet, because
    // closing a sheet must not unmount the element whose `click()` is on the
    // gesture stack. The counts are in `add-launcher-targets.test.ts`; this
    // pins the seam they count through.
    assert.match(source, /variant: 'wordsOnly';\s*\n\s*scanTo\?: never;/);
    assert.match(source, /if \(props\.variant === 'wordsOnly'\) \{\s*\n\s*return <ComposerStrip \{\.\.\.base\} \/>;/);
    // The hook is called in the branch that renders the input, and nowhere
    // else, so neither can exist without the other.
    assert.equal((source.match(/useCameraCapture\(/g) ?? []).length, 1);
  });

  it('makes wordsOnly and scanTo mutually exclusive, a compile error rather than a silent drop', () => {
    // A words-only strip has no camera, so a photo target handed to it would
    // be dropped with no diagnostic anywhere. The discriminated union in
    // `IntakeComposerProps` forbids the combination at the call site; the real
    // assertion is the `@ts-expect-error` below, which `pnpm typecheck`
    // enforces.
    // @ts-expect-error a words-only strip takes no scanTo; see the module's props union
    typeCheckOnly({ describeTo: ADD_DESCRIBE_PATH, variant: 'wordsOnly', scanTo: ADD_PHOTO_PATH });
    // @ts-expect-error nor a photo label, since it draws no photo button (M260)
    typeCheckOnly({ describeTo: ADD_DESCRIBE_PATH, variant: 'wordsOnly', photoLabel: 'Photo' });
    // The control: the standalone strip takes both.
    typeCheckOnly({ describeTo: ADD_DESCRIBE_PATH, scanTo: ADD_PHOTO_PATH, photoLabel: 'Photo' });
    assert.match(source, /scanTo\?: never;/, 'the words-only branch of the union still forbids scanTo');
    assert.match(source, /scanTo\?: string;/, 'the standalone branch of the union takes a scanTo');
  });

  it("hands the hook's capture straight to the photo button, with the hook's ref on it", () => {
    // `capture` itself, not a wrapper that could await something first: the
    // camera must open inside the tap. The ref is where focus comes back after
    // a dismissed camera.
    const door = /<PhotoDoor\s[\s\S]*?\/>/.exec(source);
    assert.ok(door !== null, 'the strip no longer draws the photo button');
    assert.match(door[0], /ref=\{triggerRef\}/);
    assert.match(door[0], /onClick=\{capture\}/);
    assert.equal((source.match(/<PhotoDoor\b/g) ?? []).length, 1, 'one camera per strip');
  });

  it('draws the photo button as a button that runs the handler it is given, never a link', () => {
    const button = /<button\s[\s\S]*?<\/button>/.exec(PHOTO_DOOR);
    assert.ok(button !== null, 'the photo door is no longer a button');
    assert.match(button[0], /onClick=\{onClick\}/);
    assert.doesNotMatch(PHOTO_DOOR, /<Link|<a\b/, 'a navigation cannot open a camera');
    assert.doesNotMatch(PHOTO_DOOR, /\bawait\b|\basync\b/, 'nothing may be awaited on the way to the camera');
  });

  it('sends both the wide surface and the mic key to the composer, never to the database search', () => {
    // The defect this structure inherits a fix for: "Type" used to open
    // `/add`, a search field, for a person who came to write a sentence.
    assert.match(source, /to=\{describeTo\}/);
    assert.match(source, /to=\{buildIntakeHref\(describeTo, \{ speak: true \}\)\}/);
    assert.doesNotMatch(source, /to="\/add"/, 'an affordance points straight at the database search');
  });

  it('names its one icon-only key, and names the camera in words', () => {
    // The control for these: the wide surface and the photo button DO carry
    // visible words, so a missing label there would not be caught by counting
    // aria-labels alone.
    assert.match(source, /aria-label=\{t\('launcher\.speak'\)\}/);
    assert.match(source, /label=\{photoLabel \?\? t\('launcher\.platePhoto'\)\}/, 'the photo button says nothing');
    assert.doesNotMatch(source, /aria-label=\{t\('launcher\.photo'\)\}/, 'the icon-only camera key is back');
    assert.match(source, /\{label \?\? t\('launcher\.sheetTitle'\)\}/, 'the writing surface says nothing');
  });

  it('gives every key a thumb-sized target, so the strip is not a row of hairlines', () => {
    // `size-11` is 44 px, the smallest target a phone should offer, and the
    // writing surface matches it with a min height rather than a fixed one.
    assert.equal((source.match(/\bsize-11\b/g) ?? []).length, 1, 'the mic key is no longer 44 px square');
    assert.match(source, /\bmin-h-11\b/, 'the writing surface is shorter than the keys beside it');
  });

  it('keeps the capture input outside every conditional, so it cannot unmount mid-gesture', () => {
    assert.match(source, /<input ref=\{inputRef\} \{\.\.\.inputProps\} \/>/);
    assert.doesNotMatch(source, /&& <input ref=\{inputRef\}/);
  });
});

/**
 * TWO INTENTIONAL STATES, NOT ONE GLOBAL CHANGE (M232/04, M259, M260).
 *
 * The strip on `/dashboard`, `/diary` and `/pantry` owns its camera, and since
 * M260 it leads with the add sheet's own large photo button: filled, full
 * width, 64 px tall, the glyph and the name in words. Until then it ended its
 * row in a filled 44 px key, the shape the operator called "almost hidden" in
 * the sheet, and the operator asked for the "same large button" here. The
 * launcher's sheet is the one strip with no camera at all: its own photo door
 * leads it, and a second camera under it would say the same thing twice.
 *
 * So each half is asserted against the other: the button and its input that
 * the standalone render draws must be absent from the words-only render, and
 * a single treatment applied everywhere would fail one of the two.
 */
describe('the photo button', () => {
  // The pair, not `bg-primary` alone: an outline's hover class would contain
  // that substring, so the looser literal would pass against either treatment.
  const FILLED = 'bg-primary text-primary-foreground';

  it('leads the standalone strip, filled, full width, 64 px tall and named in words', () => {
    const html = render(createElement(IntakeComposer, { describeTo: ADD_DESCRIBE_PATH }));
    const button = photoButton(html);
    const classes = classOf(button);
    assert.ok(classes.includes(FILLED), `the photo button lost its fill: ${classes}`);
    assert.match(classes, /\bmin-h-16\b/, 'the photo button is not 64 px tall');
    assert.match(classes, /\bw-full\b/, 'the photo button is not full width');
    assert.doesNotMatch(classes, /\brounded/, 'the photo button rounds its corners');
    assert.match(button, /lucide-camera/, 'the photo button lost its glyph');
    assert.match(button, />Plate photo<\/span>/, 'the photo button is not named in words');
    // ABOVE the row: the first control in the strip, before either link.
    assert.ok(html.indexOf('data-slot="intake-composer-photo"') < html.indexOf('<a '), 'the button is not first');
  });

  it('is the one camera in the standalone strip: the row has no key', () => {
    const html = render(createElement(IntakeComposer, { describeTo: ADD_DESCRIBE_PATH }));
    assert.equal((html.match(/lucide-camera/g) ?? []).length, 1, 'the strip draws more than one camera');
    assert.doesNotMatch(html, /aria-label="Photo"/, 'the icon-only camera key is back in the row');
    assert.equal((html.match(/<input\b/g) ?? []).length, 1);
  });

  it('takes the name the pantry gives it, which photographs a shelf and not a plate', () => {
    const html = render(createElement(IntakeComposer, { describeTo: ADD_DESCRIBE_PATH, photoLabel: 'Photo' }));
    assert.match(photoButton(html), />Photo<\/span>/);
    // THE CONTROL: the default name is gone, so the match above is the given one.
    assert.doesNotMatch(html, /Plate photo/);
  });

  it('draws no photo button and no capture input in the words-only strip', () => {
    const wordsOnly = render(
      createElement(IntakeComposer, { describeTo: ADD_DESCRIBE_PATH, label: 'Type', variant: 'wordsOnly' }),
    );
    assert.doesNotMatch(wordsOnly, /intake-composer-photo/, 'the words-only strip draws a photo button');
    assert.doesNotMatch(wordsOnly, /lucide-camera/, 'the words-only strip still draws a camera glyph');
    assert.doesNotMatch(wordsOnly, /<input\b/, 'the words-only strip renders a capture input');
    // It still types and speaks: two links, the writing surface and the mic.
    assert.equal((wordsOnly.match(/<a\b/g) ?? []).length, 2, 'the words-only strip lost type or speak');
  });

  it('is the same component the add sheet leads with, so the two cannot drift', () => {
    assert.match(LAUNCHER, /<PhotoDoor\b/, "the sheet's door is no longer the shared component");
    assert.match(source, /<PhotoDoor\b/, "the strip's button is no longer the shared component");
    // THE CONTROL: neither file hand-rolls a camera of its own beside it.
    assert.doesNotMatch(LAUNCHER, /<Camera\b/, 'the sheet draws a camera glyph of its own');
    assert.doesNotMatch(source, /<Camera\b/, 'the strip draws a camera glyph of its own');
  });

  it('asks for the words-only strip at exactly one call site, the sheet', () => {
    assert.match(LAUNCHER, /<IntakeComposer[^>]*variant="wordsOnly"/, 'the sheet stopped asking for it');
    assert.doesNotMatch(LAUNCHER, /variant="embedded"/, 'the outlined camera key is back in the sheet');
    assert.doesNotMatch(DASHBOARD, /<IntakeComposer[^>]*variant=/, '/dashboard took the sheet treatment');
    const diaryStrips = DIARY.match(/<IntakeComposer[^>]*\/>/g) ?? [];
    assert.equal(diaryStrips.length, 4, '/diary no longer has its four add-entry surfaces');
    for (const strip of diaryStrips) {
      assert.doesNotMatch(strip, /variant=/, '/diary took the sheet treatment');
    }
  });
});
