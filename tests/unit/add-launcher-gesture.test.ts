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
    assert.match(diary, /const scanTo = isToday \? '\/scan' : `\/scan\?date=\$\{date\}`;/);
  });

  it('every AddFoodActions on /diary is given it', () => {
    const renders = diary.match(/<AddFoodActions [^>]*\/>/g) ?? [];
    assert.equal(renders.length, 4, 'three empty states plus the non-empty day');
    for (const render of renders) assert.match(render, /scanTo=\{scanTo\}/);
  });

  it('each empty state takes it as a prop rather than inventing one', () => {
    for (const state of ['FirstEverEmpty', 'WelcomeBackEmpty', 'OrdinaryEmpty']) {
      assert.match(diary, new RegExp(`function ${state}\\(\\{ addTo, scanTo \\}`));
      assert.match(diary, new RegExp(`<${state} addTo=\\{addTo\\} scanTo=\\{scanTo\\} />`));
    }
  });

  it('the actions component passes it straight into the hook', () => {
    const actions = readFileSync(new URL('../../app/components/add-food-actions.tsx', import.meta.url), 'utf8');
    assert.match(actions, /useCameraCapture\(\{ scanTo \}\)/);
  });
});

describe('the surfaces that capture', () => {
  const surfaces = ['../../app/components/add-launcher.tsx', '../../app/components/add-food-actions.tsx'];

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
