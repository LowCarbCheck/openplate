/**
 * The camera opens INSIDE the tap that asked for it.
 *
 * iOS and Android only honour a programmatic `input.click()` while the user
 * gesture that caused it is still on the stack. An `await` anywhere before it,
 * a settings read, a navigation, a downscale, ends the gesture, and the camera
 * silently never opens. Nothing about that failure is visible in a typecheck,
 * in a desktop browser, or in any test that does not have a real phone in it,
 * which is why it is pinned by reading the source.
 *
 * The gesture used to live in `add-launcher.tsx`. It now lives in the hook
 * `app/components/intake/use-camera-capture.ts`, which the launcher and the
 * in-page add-food actions share, so this file follows it there.
 *
 * Same idiom as `tests/unit/sync-sign-out-hint.test.ts`: the function under
 * test is a hook-local handler wired to a DOM event and to IndexedDB, so the
 * invariant is asserted against its body rather than by mounting it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ADD_DESCRIBE_PATH, ADD_PHOTO_PATH, buildIntakeHref } from '../../app/lib/intake-hrefs';
import { parseDateParam } from '../../app/lib/user-days';

const source = readFileSync(new URL('../../app/components/intake/use-camera-capture.ts', import.meta.url), 'utf8');

/**
 * One hook-local arrow handler's body.
 *
 * Anchored on `};` at the handler's own two-space indentation, not on a brace
 * alone on its own line: every one of these lives INSIDE the hook function, so
 * the first column-zero `}` is the hook's, not the handler's.
 */
function extractHandlerBody(declaration: string): string {
  const start = source.indexOf(declaration);
  assert.ok(start !== -1, `${declaration} is no longer in use-camera-capture.ts`);
  const end = /^ {2}};$/m.exec(source.slice(start));
  assert.ok(end !== null, `${declaration} has no closing line at handler indentation`);
  return source.slice(start, start + end.index);
}

describe('the capture gesture', () => {
  const body = extractHandlerBody('const capture = () => {');

  it('opens the camera', () => {
    assert.match(body, /inputRef\.current\?\.click\(\)/);
  });

  it('awaits nothing before opening it, since an await would end the user gesture', () => {
    const clickIndex = body.indexOf('.click()');
    assert.notEqual(clickIndex, -1);
    assert.doesNotMatch(body.slice(0, clickIndex), /\bawait\b/);
  });

  it('is not itself async, since an async handler resumes after the gesture is gone', () => {
    assert.doesNotMatch(body, /\basync\b/);
  });

  it('goes to the scan screen instead of the camera when no provider is connected', () => {
    assert.match(body, /aiConnection !== 'connected'/);
    assert.match(body, /navigate\(scanTo, \{ viewTransition: true \}\)/);
  });
});

describe('the capture hook', () => {
  it('carries its own capture input, so no navigation is needed to reach one', () => {
    assert.match(source, /capture: 'environment'/);
  });

  it('listens for cancel as well as change', () => {
    assert.match(source, /addEventListener\('cancel'/);
  });

  it('hands the photo over rather than re-picking it on the other side', () => {
    assert.match(source, /offerPickedFile\(picked\)/);
  });

  it('hands over the photo and nothing about what it shows', () => {
    // The capture used to carry the scan the person had chosen for it before
    // the shutter. One photo path reads a plate, an item or a printed panel
    // now (amends ADR-0005, 2026-09-08), so there is no mode to get wrong and
    // no ref holding one.
    assert.doesNotMatch(source, /modeRef/, 'the capture hook holds a scan mode again');
  });
});

/**
 * A photo taken while looking at an earlier day must LOG to that day.
 *
 * The hook navigates to the scan screen twice, once when no provider is
 * connected and once with the picked photo in hand, and both have to use the
 * caller's target. A hardcoded `/scan` in either place silently writes the
 * meal to today, which is worse than a missing button: nothing tells the user
 * it went to the wrong day.
 *
 * The chain is checked end to end, because each link passes on its own while
 * the day is still lost: the hook must honour `scanTo`, `/diary` must compute
 * a dated one, and every call site must hand it over.
 */
describe('a back-dated day survives the photo path', () => {
  const hookNavigations = source.match(/navigate\([^,)]+/g) ?? [];

  it('the hook takes the scan target from its caller, defaulting to ADD_PHOTO_PATH', () => {
    assert.match(source, /useCameraCapture\(\{ scanTo = ADD_PHOTO_PATH \}: \{ scanTo\?: string \} = \{\}\)/);
  });

  it('every navigation in the hook uses that target, none is hardcoded', () => {
    assert.equal(hookNavigations.length, 2, 'expected exactly the fallback and the post-capture navigation');
    for (const navigation of hookNavigations) assert.equal(navigation, 'navigate(scanTo');
  });

  const diary = readFileSync(new URL('../../app/routes/diary.tsx', import.meta.url), 'utf8');

  it('/diary dates the scan target on any day but today', () => {
    assert.match(diary, /const scanTo = buildIntakeHref\(ADD_PHOTO_PATH, \{ date, today \}\);/);
    assert.equal(
      buildIntakeHref(ADD_PHOTO_PATH, { date: '2026-09-07', today: '2026-09-14' }),
      `${ADD_PHOTO_PATH}?date=2026-09-07`,
    );
    assert.equal(buildIntakeHref(ADD_PHOTO_PATH, { date: '2026-09-14', today: '2026-09-14' }), ADD_PHOTO_PATH);
  });

  it('every add-entry surface on /diary is given it', () => {
    // The diary renders the composer strip now, the same one `/dashboard` got
    // after the playground review. The count and the `scanTo` check are the
    // point, not the component's name: a surface that forgets the target
    // writes a back-dated photo to today with nothing on screen saying so.
    const renders = diary.match(/<IntakeComposer [^>]*\/>/g) ?? [];
    assert.equal(renders.length, 4, 'three empty states plus the non-empty day');
    for (const render of renders) assert.match(render, /scanTo=\{scanTo\}/);
    assert.doesNotMatch(diary, /<AddFoodActions [^>]*\/>/, 'a three-button row is back on the diary');
  });

  it('each empty state takes it as a prop rather than inventing one', () => {
    for (const state of ['FirstEverEmpty', 'WelcomeBackEmpty', 'OrdinaryEmpty']) {
      assert.match(diary, new RegExp(`function ${state}\\(\\{ describeTo, scanTo \\}`));
      assert.match(diary, new RegExp(`<${state} describeTo=\\{describeTo\\} scanTo=\\{scanTo\\} />`));
    }
  });
});

describe('the surfaces that capture', () => {
  const surfaces = [
    '../../app/components/add-launcher.tsx',
    // The composer strip `/dashboard`, `/diary` and `/pantry` render. It leads
    // with its own photo button (M260), so it is a capturing surface and the
    // gesture rule applies to it too.
    '../../app/components/intake/intake-composer.tsx',
  ];

  for (const surface of surfaces) {
    const text = readFileSync(new URL(surface, import.meta.url), 'utf8');

    it(`${surface} takes the gesture from the shared hook rather than rebuilding it`, () => {
      assert.match(text, /useCameraCapture\(/);
      assert.doesNotMatch(text, /getLocalAiSettings/);
    });

    it(`${surface} renders the hidden input the hook owns`, () => {
      assert.match(text, /<input ref=\{inputRef\} \{\.\.\.inputProps\} \/>/);
    });
  }
});

/**
 * THE SHEET'S PHOTO DOOR IS THE BAR'S CAMERA (M232/03, M259).
 *
 * A door in the sheet that opened a camera of its own would put a second
 * hidden input INSIDE the sheet, where the close that follows the tap unmounts
 * the very element whose `click()` is still on the gesture stack. That is the
 * exact failure `use-camera-capture.ts`'s header names, so the wiring is
 * pinned here: one hook call in the whole file, one input, and the sheet's
 * photo door driving the hook's own `capture`. Until M259 that door was the
 * composer strip's key, handed this capture; it is the large "Plate photo"
 * button that leads the sheet now, and the strip is words only.
 *
 * `add-launcher-targets.test.ts` counts the inputs in real markup. This file
 * owns the other half, which no render can see: that nothing is awaited on the
 * way from the sheet's tap to `.click()`.
 */
describe("the sheet's photo door opens the bar's own camera, inside the tap", () => {
  const launcher = readFileSync(new URL('../../app/components/add-launcher.tsx', import.meta.url), 'utf8');

  it('calls the hook once, so there is one capture and one input on the page', () => {
    assert.equal((launcher.match(/useCameraCapture\(/g) ?? []).length, 1);
    assert.equal((launcher.match(/<input\b/g) ?? []).length, 1);
  });

  it("drives the hook's own capture from the photo door, and hands the strip none", () => {
    // THE HOOK'S `capture`, wrapped in the close, so the input, and therefore
    // the `click()` target, is the one the bar already renders. Only the close
    // is the door's own.
    assert.match(launcher, /<PhotoDoor onClick=\{capturePhotoFromSheet\} dataSlot="add-sheet-photo"/);
    assert.doesNotMatch(launcher, /<IntakeComposer[^>]*capture=/, 'the strip drives a second camera key again');
  });

  it('awaits nothing between the sheet tap and the capture, and closes only after it', () => {
    const start = launcher.indexOf('const capturePhotoFromSheet = () => {');
    assert.notEqual(start, -1, 'the sheet photo key no longer has a handler');
    const end = /^ {2}};$/m.exec(launcher.slice(start));
    assert.ok(end !== null, 'the handler has no closing line at its own indentation');
    const body = launcher.slice(start, start + end.index);

    const captureIndex = body.indexOf('capture()');
    assert.notEqual(captureIndex, -1, 'the sheet key stopped opening the camera');
    assert.doesNotMatch(body.slice(0, captureIndex), /\bawait\b/);
    assert.doesNotMatch(body, /\basync\b/);
    // The close comes AFTER, which is what makes it harmless: an unmount can
    // only reach the strip's button, never the input outside the sheet.
    assert.ok(body.indexOf('setIsSheetOpen(false)') > captureIndex);
  });

  it("keeps the hook's ref on the plus alone, so a dismissed camera still finds it", () => {
    // One ref cannot hold two elements. The hook's ref is on the plus, where
    // focus goes back after a dismissed camera; putting it on the sheet's door
    // would leave the plus with nothing to focus once the sheet had been
    // opened once, since the door is gone with the sheet. The door needs no
    // ref of its own: nothing reads one.
    assert.equal((launcher.match(/ref=\{triggerRef\}/g) ?? []).length, 1, "the hook's ref is on the plus alone");
    assert.match(launcher, /<SheetTrigger asChild>\s*<button\s+ref=\{triggerRef\}/, "the hook's ref left the plus");
  });
});

/**
 * THE LAUNCHER LOGS TO THE DAY ON SCREEN.
 *
 * This bar renders under every route, `/diary?date=<an earlier day>` included,
 * and its three doors used to be hardcoded: `/scan` through the hook with no
 * argument, `/describe` and `/describe?speak=1` as literal links. Tapping any
 * of them while looking at Saturday wrote the meal to today, and nothing on
 * screen said so.
 *
 * The chain is asserted the way the photo path above is, link by link: the
 * launcher must read the day out of the URL, and the builder must turn that
 * day into a dated href. Either half alone passes while the day is still lost.
 */
describe('the launcher carries the day the person is looking at', () => {
  const launcher = readFileSync(new URL('../../app/components/add-launcher.tsx', import.meta.url), 'utf8');

  it('reads the day from the current URL, not from a prop it is never given', () => {
    // `AddLauncher` is rendered prop-less from the global bottom nav, so the
    // URL is the only place the viewed day can come from.
    assert.match(launcher, /const viewedDate = parseDateParam\(new URLSearchParams\(location\.search\)\.get\('date'\)\);/);
  });

  it('builds both doors it owns through the shared builder', () => {
    // TWO, not three: the sheet renders the composer strip now (M232/03), and
    // the strip derives the spoken door from the typed one. Where those two
    // land is `add-launcher-targets.test.ts`, which renders them. The photo
    // door takes the scan target through the hook.
    assert.match(launcher, /const describeTo = buildIntakeHref\(ADD_DESCRIBE_PATH, \{ date: viewedDate \}\);/);
    assert.match(launcher, /const scanTo = buildIntakeHref\(ADD_PHOTO_PATH, \{ date: viewedDate \}\);/);
    assert.match(launcher, /useCameraCapture\(\{ scanTo \}\)/);
  });

  it('has no hardcoded destination left in its markup', () => {
    // The control for the two checks above: they would both pass on a file
    // that computed the hrefs and then rendered the old literals anyway.
    assert.doesNotMatch(launcher, /to="\/describe/, 'a launcher row points at an undated /describe again');
    assert.doesNotMatch(launcher, /to="\/scan/, 'a launcher row points at an undated /scan again');
    assert.match(launcher, /<IntakeComposer describeTo=\{describeTo\}/);
  });

  it('turns a dated diary URL into dated doors, and a bare one into bare doors', () => {
    // The other half of the chain, run for real: the same two calls the file
    // above makes, over the search string `/diary?date=` actually produces.
    const dayOnScreen = parseDateParam(new URLSearchParams('?date=2026-09-07').get('date'));
    assert.equal(buildIntakeHref(ADD_DESCRIBE_PATH, { date: dayOnScreen }), `${ADD_DESCRIBE_PATH}?date=2026-09-07`);
    assert.equal(
      buildIntakeHref(ADD_DESCRIBE_PATH, { date: dayOnScreen, speak: true }),
      `${ADD_DESCRIBE_PATH}?date=2026-09-07&speak=1`,
    );
    assert.equal(buildIntakeHref(ADD_PHOTO_PATH, { date: dayOnScreen }), `${ADD_PHOTO_PATH}?date=2026-09-07`);

    const today = parseDateParam(new URLSearchParams('').get('date'));
    assert.equal(buildIntakeHref(ADD_DESCRIBE_PATH, { date: today }), ADD_DESCRIBE_PATH);
    assert.equal(buildIntakeHref(ADD_DESCRIBE_PATH, { date: today, speak: true }), `${ADD_DESCRIBE_PATH}?speak=1`);
    assert.equal(buildIntakeHref(ADD_PHOTO_PATH, { date: today }), ADD_PHOTO_PATH);
  });
});
