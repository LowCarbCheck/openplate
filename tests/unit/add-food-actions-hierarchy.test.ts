/**
 * The add-food hierarchy: three equal ways in, side by side.
 *
 * `/diary`'s three empty states and `/dashboard`'s today hero all render
 * `AddFoodActions`, so this one component decides what "add food" means.
 *
 * WHAT CHANGED. It used to be a full-width photograph button with typing and
 * speaking shrunk underneath it. All three now reach the same AI review screen
 * and write the same entries, so the layout says so: one row, equal widths,
 * the same height, an icon over a label. A future edit that demotes typing or
 * speaking back to a footnote, or that shrinks the tap target, would be
 * invisible without this file.
 *
 * The one rank that survives is the FILL: photograph stays the filled primary
 * because it is the action that costs a camera permission and is worth naming
 * first. Typing and speaking are outlined in the primary colour, not in a
 * neutral grey, so the row reads as one family.
 *
 * SPEAKING IS ALWAYS THERE NOW. It used to render only where the browser had a
 * Web Speech recogniser, because it opened this app's own microphone. M203
 * removed that microphone: the button leads to the composer with its field
 * focused, and the keyboard's dictation key does the talking, so there is no
 * browser on which the row should be two columns.
 *
 * Source-level for the same reason as `add-launcher-gesture.test.ts`: the
 * component's behaviour is a browser gesture and a hook, not a return value.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { speakHref } from '../../app/components/add-food-actions';

const source = readFileSync(new URL('../../app/components/add-food-actions.tsx', import.meta.url), 'utf8');

/** The one class every action shares. Read from the source, so the test cannot drift from it. */
const ACTION_CLASS = /const ACTION_CLASS = '([^']+)';/.exec(source)?.[1] ?? '';

describe('the add-food actions', () => {
  it('drives the camera through the shared hook', () => {
    assert.match(source, /import \{ useCameraCapture \} from '#app\/components\/add\/use-camera-capture'/);
    assert.match(source, /const \{ capture, triggerRef, inputRef, inputProps \} = useCameraCapture\(/);
  });

  it('makes the photo action a button that captures, not a link to the search screen', () => {
    const primary = /<Button ref=\{triggerRef\}[\s\S]*?<\/Button>/.exec(source);
    assert.ok(primary !== null, 'the photo button is gone from add-food-actions.tsx');
    assert.match(primary[0], /onClick=\{capture\}/);
    assert.match(primary[0], /t\('launcher\.photo'\)/);
    assert.doesNotMatch(primary[0], /<Link/);
    assert.doesNotMatch(primary[0], /asChild/);
  });

  it('sends typing and speaking to the composer, never to the database search', () => {
    // The defect this route exists for: "Type" used to open `/add`, a search
    // field, for a person who came to write a sentence.
    assert.match(source, /describeTo: string;/);
    assert.doesNotMatch(source, /to="\/add"/, 'an action still points straight at the database search');
  });

  it('keeps typing and speaking beside it, in the same row', () => {
    assert.match(source, /t\('launcher\.type'\)/);
    assert.match(source, /t\('launcher\.speak'\)/);
    assert.match(source, /<Link to=\{describeTo\}>/);
    assert.match(source, /<Link to=\{speakHref\(describeTo\)\}>/);
    // One flex row holds all three, so they share the width rather than
    // stacking the two quiet ones under a full-width primary.
    assert.match(source, /<div className="flex gap-2">[\s\S]*onClick=\{capture\}[\s\S]*speakHref\(describeTo\)/);
  });

  it('gives all three the same generous target', () => {
    assert.match(ACTION_CLASS, /\bh-14\b/, 'the shared action class is no longer at least h-14');
    assert.match(ACTION_CLASS, /\bflex-1\b/, 'the three actions no longer share the width equally');
    // Icon above label, which is what makes a short label legible at this size.
    assert.match(ACTION_CLASS, /\bflex-col\b/);
    // Every action carries it, so none of them can quietly shrink.
    assert.strictEqual(
      source.split('className={ACTION_CLASS').length - 1 + source.split('className={cn(ACTION_CLASS').length - 1,
      3,
      'one of the three actions no longer uses the shared geometry',
    );
  });

  it('keeps typing and speaking in the primary colour, never a neutral grey', () => {
    const outlined = source.match(/cn\(ACTION_CLASS, '([^']+)'\)/g) ?? [];
    assert.strictEqual(outlined.length, 2, 'the two outlined actions are no longer a matched pair');
    for (const className of outlined) {
      assert.match(className, /border-primary/);
      assert.match(className, /text-primary/);
    }
  });

  it('offers speaking on every browser, and promises no microphone of its own', () => {
    // The gate is GONE, and so is the hook behind it: this app has no
    // recogniser to detect any more.
    assert.doesNotMatch(source, /useSpeechInputAvailable/, 'the speak action is gated on a recogniser again');
    assert.doesNotMatch(source, /speech-input-button/, 'the removed speech module is imported again');
    // The control: the row must still HAVE the speak action, or the check
    // above would pass on a component that simply dropped it.
    assert.match(source, /<Link to=\{speakHref\(describeTo\)\}>/);
    assert.doesNotMatch(source, /\{canSpeak && \(/, 'the speak action is conditional again');
  });
});

describe('speakHref', () => {
  it('adds speak=1 to a bare destination', () => {
    assert.equal(speakHref('/describe'), '/describe?speak=1');
  });

  it('keeps a query the destination already carries', () => {
    assert.equal(speakHref('/describe?date=2026-09-07'), '/describe?date=2026-09-07&speak=1');
  });

  it('does not add a second speak=1', () => {
    assert.equal(speakHref('/describe?speak=1'), '/describe?speak=1');
  });
});
