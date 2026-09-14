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
 * `app/components/add/use-camera-capture.ts`, which the launcher and the
 * in-page add-food actions share, so this file follows it there.
 *
 * Same idiom as `tests/unit/sync-sign-out-hint.test.ts`: the function under
 * test is a hook-local handler wired to a DOM event and to IndexedDB, so the
 * invariant is asserted against its body rather than by mounting it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildAddHref } from '../../app/lib/add-food-hrefs';
import { parseDateParam } from '../../app/lib/user-days';

const source = readFileSync(new URL('../../app/components/add/use-camera-capture.ts', import.meta.url), 'utf8');

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

  it('the hook takes the scan target from its caller, defaulting to /scan', () => {
    assert.match(source, /useCameraCapture\(\{ scanTo = '\/scan' \}: \{ scanTo\?: string \} = \{\}\)/);
  });

  it('every navigation in the hook uses that target, none is hardcoded', () => {
    assert.equal(hookNavigations.length, 2, 'expected exactly the fallback and the post-capture navigation');
    for (const navigation of hookNavigations) assert.equal(navigation, 'navigate(scanTo');
  });

  const diary = readFileSync(new URL('../../app/routes/diary.tsx', import.meta.url), 'utf8');

  it('/diary dates the scan target on any day but today', () => {
    assert.match(diary, /const scanTo = buildAddHref\('\/scan', \{ date, today \}\);/);
    assert.equal(buildAddHref('/scan', { date: '2026-09-07', today: '2026-09-14' }), '/scan?date=2026-09-07');
    assert.equal(buildAddHref('/scan', { date: '2026-09-14', today: '2026-09-14' }), '/scan');
  });

  it('every add-entry surface on /diary is given it', () => {
    // The diary renders the composer strip now, the same one `/dashboard` got
    // after the playground review. The count and the `scanTo` check are the
    // point, not the component's name: a surface that forgets the target
    // writes a back-dated photo to today with nothing on screen saying so.
    const renders = diary.match(/<AddFoodActionsComposer [^>]*\/>/g) ?? [];
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
    // The composer strip `/dashboard` and `/diary` render. It carries its own
    // camera key, so it is a capturing surface and the gesture rule applies to
    // it too.
    '../../app/components/add-food-actions-composer.tsx',
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

  it('builds all three doors through the shared builder', () => {
    assert.match(launcher, /const describeTo = buildAddHref\('\/describe', \{ date: viewedDate \}\);/);
    assert.match(launcher, /const speakTo = buildAddHref\('\/describe', \{ date: viewedDate, speak: true \}\);/);
    assert.match(launcher, /scanTo: buildAddHref\('\/scan', \{ date: viewedDate \}\)/);
  });

  it('has no hardcoded destination left in its markup', () => {
    // The control for the three checks above: they would all pass on a file
    // that computed the hrefs and then rendered the old literals anyway.
    assert.doesNotMatch(launcher, /to="\/describe/, 'a launcher row points at an undated /describe again');
    assert.match(launcher, /<Link to=\{speakTo\}/);
    assert.match(launcher, /<Link to=\{describeTo\}/);
  });

  it('turns a dated diary URL into dated doors, and a bare one into bare doors', () => {
    // The other half of the chain, run for real: the same two calls the file
    // above makes, over the search string `/diary?date=` actually produces.
    const dayOnScreen = parseDateParam(new URLSearchParams('?date=2026-09-07').get('date'));
    assert.equal(buildAddHref('/describe', { date: dayOnScreen }), '/describe?date=2026-09-07');
    assert.equal(buildAddHref('/describe', { date: dayOnScreen, speak: true }), '/describe?date=2026-09-07&speak=1');
    assert.equal(buildAddHref('/scan', { date: dayOnScreen }), '/scan?date=2026-09-07');

    const today = parseDateParam(new URLSearchParams('').get('date'));
    assert.equal(buildAddHref('/describe', { date: today }), '/describe');
    assert.equal(buildAddHref('/describe', { date: today, speak: true }), '/describe?speak=1');
    assert.equal(buildAddHref('/scan', { date: today }), '/scan');
  });
});
