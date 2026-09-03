/**
 * The launcher-to-`/scan` hand-off slot is one-shot.
 *
 * A photo taken from the tab bar exists before the route that analyses it
 * does, so something has to hold it across the navigation. That something must
 * empty itself as it is read: `/scan`'s pickup effect runs on every mount, and
 * a slot that kept its value would re-analyse — and re-charge the user's own
 * provider for — a photo that was already handled, on the next visit or on a
 * StrictMode double-mount.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { offerPickedFile, takePickedFile } from '../../app/lib/scan-handoff';

function photo(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

describe('scan hand-off slot', () => {
  beforeEach(() => {
    takePickedFile();
  });

  it('is empty until something is parked in it', () => {
    assert.equal(takePickedFile(), null);
  });

  it('hands over the file and the scan it was captured for', () => {
    offerPickedFile(photo('plate.jpg'), 'label');

    const handed = takePickedFile();

    assert.ok(handed !== null);
    assert.equal(handed.file.name, 'plate.jpg');
    assert.equal(handed.mode, 'label');
  });

  it('empties as it is read, so the same photo is never analysed twice', () => {
    offerPickedFile(photo('plate.jpg'), 'plate');

    assert.ok(takePickedFile() !== null);
    assert.equal(takePickedFile(), null, 'a second read must find nothing');
  });

  it('keeps the newest capture when one is offered before the last was taken', () => {
    offerPickedFile(photo('first.jpg'), 'plate');
    offerPickedFile(photo('second.jpg'), 'label');

    const handed = takePickedFile();

    assert.equal(handed?.file.name, 'second.jpg');
    assert.equal(handed?.mode, 'label');
    assert.equal(takePickedFile(), null, 'the replaced photo must not queue behind it');
  });
});
