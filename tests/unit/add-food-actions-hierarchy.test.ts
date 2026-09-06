/**
 * The add-food hierarchy: the primary photographs, the secondaries type and
 * speak.
 *
 * `/diary`'s three empty states and `/dashboard`'s today hero all render
 * `AddFoodActions`, so this one component decides what "add food" means. The
 * primary used to be a link into the search screen. A future edit could put
 * that back without any test noticing, which is what this file exists to stop.
 *
 * Source-level for the same reason as `add-launcher-gesture.test.ts`: the
 * component's behaviour is a browser gesture and a hook, not a return value.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { speakHref } from '../../app/components/add-food-actions';

const source = readFileSync(new URL('../../app/components/add-food-actions.tsx', import.meta.url), 'utf8');

describe('the add-food actions', () => {
  it('drives the camera through the shared hook', () => {
    assert.match(source, /import \{ useCameraCapture \} from '#app\/components\/add\/use-camera-capture'/);
    assert.match(source, /const \{ captureWith, triggerRef, inputRef, inputProps \} = useCameraCapture\(/);
  });

  it('makes the primary a button that captures, not a link to the search screen', () => {
    const primary = /<Button ref=\{triggerRef\}[\s\S]*?<\/Button>/.exec(source);
    assert.ok(primary !== null, 'the primary button is gone from add-food-actions.tsx');
    assert.match(primary[0], /onClick=\{\(\) => captureWith\('plate'\)\}/);
    assert.match(primary[0], /t\('diary\.actions\.photograph'\)/);
    assert.doesNotMatch(primary[0], /<Link/);
    assert.doesNotMatch(primary[0], /asChild/);
  });

  it('keeps typing and speaking visible beside it', () => {
    assert.match(source, /t\('launcher\.type'\)/);
    assert.match(source, /t\('launcher\.speak'\)/);
    assert.match(source, /<Link to=\{addTo\}>/);
    assert.match(source, /<Link to=\{speakHref\(addTo\)\}>/);
  });

  it('hides speaking where no recogniser exists', () => {
    assert.match(source, /useSpeechInputAvailable\(\) === true/);
  });
});

describe('speakHref', () => {
  it('adds speak=1 to a bare destination', () => {
    assert.equal(speakHref('/add'), '/add?speak=1');
  });

  it('keeps a query the destination already carries', () => {
    assert.equal(speakHref('/add?date=2026-09-07'), '/add?date=2026-09-07&speak=1');
  });

  it('does not add a second speak=1', () => {
    assert.equal(speakHref('/add?speak=1'), '/add?speak=1');
  });
});
