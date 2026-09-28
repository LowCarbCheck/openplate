/**
 * The slot that carries the confirmed plate's photograph into the confirm
 * action is one-shot, and it is keyed by the batch id.
 *
 * It exists because the photograph used to be saved from a `useNavigation()`
 * effect that waited for a `submitting` render the confirm never produces (the
 * action is local IndexedDB work, resolved inside one React batch). Nothing was
 * ever cached, so a reported bad estimate always went out without a picture.
 *
 * Two properties carry that fix, and both are asserted here. It must empty
 * itself as it is read, so one photograph is saved once rather than again on a
 * later confirm. And it must refuse a batch id it was not offered for, so a
 * stale draft's picture can never be filed under the rows of a different one.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { dropPlatePhoto, offerPlatePhoto, takePlatePhoto } from '../../app/lib/plate-photo-handoff';

const OWNER = 0;

function photo(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

describe('plate photo hand-off slot', () => {
  beforeEach(() => {
    dropPlatePhoto('batch-a');
    dropPlatePhoto('batch-b');
  });

  it('is empty until a photograph is parked in it', () => {
    assert.equal(takePlatePhoto('batch-a'), null);
  });

  it('hands over the file and the owner its cached row is keyed to', () => {
    offerPlatePhoto({ logBatchId: 'batch-a', userId: OWNER, file: photo('plate.jpg') });

    const taken = takePlatePhoto('batch-a');

    assert.ok(taken !== null);
    assert.equal(taken.file.name, 'plate.jpg');
    assert.equal(taken.userId, OWNER);
  });

  it('empties as it is read, so one confirm caches one photograph', () => {
    offerPlatePhoto({ logBatchId: 'batch-a', userId: OWNER, file: photo('plate.jpg') });

    assert.ok(takePlatePhoto('batch-a') !== null);
    assert.equal(takePlatePhoto('batch-a'), null, 'a second read must find nothing');
  });

  it('refuses a batch it was not offered for, and keeps the photograph for its own', () => {
    offerPlatePhoto({ logBatchId: 'batch-a', userId: OWNER, file: photo('plate.jpg') });

    assert.equal(takePlatePhoto('batch-b'), null, "another batch took this draft's photograph");
    assert.ok(takePlatePhoto('batch-a') !== null, 'the refused read emptied the slot anyway');
  });

  it('keeps the newest draft when one is offered before the last was taken', () => {
    offerPlatePhoto({ logBatchId: 'batch-a', userId: OWNER, file: photo('first.jpg') });
    offerPlatePhoto({ logBatchId: 'batch-b', userId: OWNER, file: photo('second.jpg') });

    assert.equal(takePlatePhoto('batch-a'), null, 'the replaced draft must not queue behind it');
    const taken = takePlatePhoto('batch-b');
    assert.equal(taken?.file.name, 'second.jpg');
  });

  it('clears on a drop, so a screen that went away leaves nothing behind', () => {
    offerPlatePhoto({ logBatchId: 'batch-a', userId: OWNER, file: photo('plate.jpg') });

    dropPlatePhoto('batch-a');

    assert.equal(takePlatePhoto('batch-a'), null);
  });

  it('ignores a drop for another batch, so a late cleanup cannot eat a newer offer', () => {
    offerPlatePhoto({ logBatchId: 'batch-b', userId: OWNER, file: photo('second.jpg') });

    dropPlatePhoto('batch-a');

    assert.ok(takePlatePhoto('batch-b') !== null, "an unrelated drop threw away the current draft's photograph");
  });
});
