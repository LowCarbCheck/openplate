/**
 * The add drafts (M255/01): one slot per add method, kept while the page
 * lives, so switching from one way of adding food to another and back loses
 * nothing.
 *
 * WHAT IS ASSERTED HERE is the store's contract, against the REAL modules it
 * depends on: a write is read back, a partial write keeps the rest, a clear
 * empties exactly what it names, and a fresh intake parked in the one-shot
 * hand-off beats a draft without being taken. That last one is the contract
 * two modules share, so it is read through `intake-handoff.ts` itself rather
 * than a stand-in: the hand-off must still be there, once, for the screen's
 * own pickup after the draft stepped aside.
 *
 * What a screen does with its slot (reads on mount, writes on change) needs a
 * browser, and `tests/e2e/add-method-switcher.spec.ts` walks it.
 *
 * EVERY ABSENCE HAS A CONTROL: each "cleared" or "ignored" reading is paired
 * with the reading that shows the same slot holding something, so a store
 * that never wrote at all could not pass.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ADD_METHODS,
  clearAddDraft,
  clearAllAddDrafts,
  clearDraftsAfterPhotoLog,
  readAddDraft,
  readPhotoDraftOnArrival,
  updateAddDraft,
  writeAddDraft,
  type PhotoDraft,
} from '../../app/lib/add-drafts';
import {
  hasPendingIntakeHandoff,
  offerPickedFile,
  offerTypedText,
  takeIntakeHandoff,
} from '../../app/lib/intake-handoff';

/** A picture, as the photo screen holds one after the downscale. */
function photo(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

/** A photo draft with a picture and nothing else yet, the state a pick leaves. */
function pickedPhotoDraft(name: string): PhotoDraft {
  return { file: photo(name), typedText: null, intakeSource: 'photo', mealType: 'lunch', analysis: null, review: null };
}

/** A photo draft for a sentence handed over from another screen. */
function sentenceDraft(text: string): PhotoDraft {
  return { file: null, typedText: text, intakeSource: 'text', mealType: 'dinner', analysis: null, review: null };
}

beforeEach(() => {
  clearAllAddDrafts();
  takeIntakeHandoff();
});

afterEach(() => {
  clearAllAddDrafts();
  takeIntakeHandoff();
});

describe('a slot', () => {
  it('is empty until a screen writes it', () => {
    for (const method of ADD_METHODS) assert.equal(readAddDraft(method), null, `${method} started with a draft`);
  });

  it('gives back what was written', () => {
    writeAddDraft('describe', { text: '2 fried eggs and toast' });

    assert.deepEqual(readAddDraft('describe'), { text: '2 fried eggs and toast' });
  });

  it('keeps the same File, not a copy of it', () => {
    // A copy would still pass a name check and would be a second picture in
    // memory; the screen hands this one to the analysis and the photo cache.
    const draft = pickedPhotoDraft('plate.jpg');
    writeAddDraft('photo', draft);

    assert.equal(readAddDraft('photo')?.file, draft.file);
  });

  it('merges a partial write over the fields already there', () => {
    // The search screen's draft is written by three components, each owning
    // its own fields, so a write of one must not reset the others.
    updateAddDraft('search', { q: 'egg' });
    updateAddDraft('search', { portion: { grams: '120', mealType: 'breakfast' } });

    assert.deepEqual(readAddDraft('search'), {
      q: 'egg',
      selected: null,
      portion: { grams: '120', mealType: 'breakfast' },
      showManual: false,
    });
  });

  it('starts a partial write from an empty draft, never from another slot', () => {
    writeAddDraft('describe', { text: 'soup' });
    updateAddDraft('search', { showManual: true });

    assert.deepEqual(readAddDraft('search'), { q: '', selected: null, portion: null, showManual: true });
    assert.deepEqual(readAddDraft('describe'), { text: 'soup' }, 'a write to one slot touched another');
  });
});

describe('clearing', () => {
  it('empties the slot it names and leaves the others', () => {
    writeAddDraft('describe', { text: 'soup' });
    updateAddDraft('search', { q: 'egg' });

    clearAddDraft('describe');

    assert.equal(readAddDraft('describe'), null);
    // The control: without it, a clear that emptied everything would pass.
    assert.equal(readAddDraft('search')?.q, 'egg');
  });

  it('empties every slot at once', () => {
    writeAddDraft('describe', { text: 'soup' });
    updateAddDraft('search', { q: 'egg' });
    writeAddDraft('photo', pickedPhotoDraft('plate.jpg'));

    clearAllAddDrafts();

    for (const method of ADD_METHODS) assert.equal(readAddDraft(method), null, `${method} survived the clear`);
  });
});

describe('a logged plate', () => {
  it('clears the photo draft it was logged from', () => {
    writeAddDraft('photo', pickedPhotoDraft('plate.jpg'));

    clearDraftsAfterPhotoLog();

    assert.equal(readAddDraft('photo'), null);
  });

  it('clears the composer that wrote the logged sentence, and a search box holding it', () => {
    writeAddDraft('describe', { text: '  2 fried eggs and toast \n' });
    updateAddDraft('search', { q: '2 fried eggs and toast' });
    // Trimmed, as every offering surface trims before it parks the words.
    writeAddDraft('photo', sentenceDraft('2 fried eggs and toast'));

    clearDraftsAfterPhotoLog();

    assert.equal(readAddDraft('describe'), null, 'the logged sentence is still waiting in the composer');
    assert.equal(readAddDraft('search'), null, 'the logged sentence is still waiting in the search box');
  });

  it('leaves a draft that says something else, which is the control', () => {
    writeAddDraft('describe', { text: 'porridge with berries' });
    updateAddDraft('search', { q: 'egg' });
    writeAddDraft('photo', sentenceDraft('2 fried eggs and toast'));

    clearDraftsAfterPhotoLog();

    assert.equal(readAddDraft('describe')?.text, 'porridge with berries');
    assert.equal(readAddDraft('search')?.q, 'egg');
  });

  it('leaves the composer alone when the plate was a picture', () => {
    writeAddDraft('describe', { text: 'soup' });
    writeAddDraft('photo', pickedPhotoDraft('plate.jpg'));

    clearDraftsAfterPhotoLog();

    assert.equal(readAddDraft('describe')?.text, 'soup');
  });
});

describe('arriving on the photo screen', () => {
  it('opens on the draft when nothing new was handed over', () => {
    const draft = pickedPhotoDraft('left-here.jpg');
    writeAddDraft('photo', draft);

    assert.equal(readPhotoDraftOnArrival({ isSharedPhotoArriving: false }), draft);
  });

  it('opens empty when the launcher parked a new photo, and leaves that photo to be taken once', () => {
    writeAddDraft('photo', pickedPhotoDraft('left-here.jpg'));
    offerPickedFile(photo('just-taken.jpg'));

    assert.equal(readPhotoDraftOnArrival({ isSharedPhotoArriving: false }), null, 'the old plate beat the new one');

    // EXACTLY ONCE, still: asking did not take it, and the screen's own
    // pickup gets it, and only the first time.
    assert.equal(hasPendingIntakeHandoff(), true, 'peeking at the hand-off emptied it');
    const handed = takeIntakeHandoff();
    assert.ok(handed !== null && handed.kind === 'photo');
    assert.equal(handed.file.name, 'just-taken.jpg');
    assert.equal(takeIntakeHandoff(), null, 'the hand-off could be taken twice');
    assert.equal(hasPendingIntakeHandoff(), false);
  });

  it('opens empty when a screen handed over words', () => {
    writeAddDraft('photo', pickedPhotoDraft('left-here.jpg'));
    offerTypedText('2 fried eggs and toast', 'text');

    assert.equal(readPhotoDraftOnArrival({ isSharedPhotoArriving: false }), null);
    assert.equal(takeIntakeHandoff()?.kind, 'text');
  });

  it('opens empty when the share sheet brought a picture', () => {
    writeAddDraft('photo', pickedPhotoDraft('left-here.jpg'));

    assert.equal(readPhotoDraftOnArrival({ isSharedPhotoArriving: true }), null);
  });

  it('does not delete the draft by stepping aside; the screen replaces it when the new intake lands', () => {
    // The arrival only decides what the FIRST paint shows. Deleting here would
    // be a write during render, and the screen's first write replaces the
    // slot anyway.
    const draft = pickedPhotoDraft('left-here.jpg');
    writeAddDraft('photo', draft);
    offerPickedFile(photo('just-taken.jpg'));

    readPhotoDraftOnArrival({ isSharedPhotoArriving: false });

    assert.equal(readAddDraft('photo'), draft);
  });
});
