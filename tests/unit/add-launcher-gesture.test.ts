/**
 * The launcher opens the camera INSIDE the tap that asked for it.
 *
 * iOS and Android only honour a programmatic `input.click()` while the user
 * gesture that caused it is still on the stack. An `await` anywhere before it
 * — a settings read, a navigation, a downscale — ends the gesture, and the
 * camera silently never opens. Nothing about that failure is visible in a
 * typecheck, in a desktop browser, or in any test that does not have a real
 * phone in it, which is why it is pinned by reading the source.
 *
 * Same idiom as `tests/unit/sync-sign-out-hint.test.ts`: the function under
 * test is a component-local handler wired to a DOM event and to IndexedDB, so
 * the invariant is asserted against its body rather than by mounting it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../app/components/add-launcher.tsx', import.meta.url), 'utf8');

/**
 * One component-local arrow handler's body.
 *
 * Anchored on `};` at the handler's own two-space indentation, not on a brace
 * alone on its own line: every one of these lives INSIDE the component
 * function, so the first column-zero `}` is the component's, not the
 * handler's.
 */
function extractHandlerBody(declaration: string): string {
  const start = source.indexOf(declaration);
  assert.ok(start !== -1, `${declaration} is no longer in add-launcher.tsx`);
  const end = /^ {2}};$/m.exec(source.slice(start));
  assert.ok(end !== null, `${declaration} has no closing line at handler indentation`);
  return source.slice(start, start + end.index);
}

describe('the launcher tap handler', () => {
  const body = extractHandlerBody('const captureWith = (mode: VisionMode) => {');

  it('opens the camera', () => {
    assert.match(body, /inputRef\.current\?\.click\(\)/);
  });

  it('awaits nothing before opening it — an await would end the user gesture', () => {
    const clickIndex = body.indexOf('.click()');
    assert.notEqual(clickIndex, -1);
    assert.doesNotMatch(body.slice(0, clickIndex), /\bawait\b/);
  });

  it('is not itself async — an async handler resumes after the gesture is gone', () => {
    assert.doesNotMatch(body, /\basync\b/);
  });

  it('goes to /scan instead of the camera when no provider is connected', () => {
    assert.match(body, /aiConnection !== 'connected'/);
    assert.match(body, /navigate\('\/scan'/);
  });
});

describe('the launcher', () => {
  it('carries its own capture input, so no navigation is needed to reach one', () => {
    assert.match(source, /capture="environment"/);
  });

  it('listens for cancel as well as change', () => {
    assert.match(source, /addEventListener\('cancel'/);
  });

  it('hands the photo over rather than re-picking it on the other side', () => {
    assert.match(source, /offerPickedFile\(picked, modeRef\.current\)/);
  });
});
