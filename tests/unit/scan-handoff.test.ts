/**
 * The hand-off slot into `/scan` is one-shot, and it carries either kind of
 * intake.
 *
 * A photo taken from the tab bar exists before the route that analyses it
 * does, so something has to hold it across the navigation. That something must
 * empty itself as it is read: `/scan`'s pickup effect runs on every mount, and
 * a slot that kept its value would re-analyse — and re-charge the user's own
 * provider for — an intake that was already handled, on the next visit or on a
 * StrictMode double-mount.
 *
 * A typed or spoken sentence rides the same slot, under the same rule, because
 * it costs the same paid call. The two kinds are also mutually exclusive: one
 * slot, one pending intake, so a photo offered after a sentence must leave no
 * trace of the sentence behind it.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { offerPickedFile, offerTypedText, takeIntakeHandoff } from '../../app/lib/scan-handoff';
import { INTAKE_SOURCES } from '../../app/lib/intake-source';

function photo(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

describe('scan hand-off slot', () => {
  beforeEach(() => {
    takeIntakeHandoff();
  });

  it('is empty until something is parked in it', () => {
    assert.equal(takeIntakeHandoff(), null);
  });

  it('hands over the file, and nothing about what it shows', () => {
    offerPickedFile(photo('plate.jpg'));

    const handed = takeIntakeHandoff();

    assert.ok(handed !== null);
    assert.equal(handed.kind, 'photo');
    assert.ok(handed.kind === 'photo');
    assert.equal(handed.file.name, 'plate.jpg');
    // No mode rides along any more. A photo used to carry the scan the person
    // had chosen for it before the shutter; one photo path reads a plate, an
    // item or a printed panel now (amends ADR-0005, 2026-09-08), so there is
    // nothing left for the launcher to have got wrong.
    assert.ok(!('mode' in handed), 'a photo hand-off carries a scan mode again');
  });

  it('empties as it is read, so the same photo is never analysed twice', () => {
    offerPickedFile(photo('plate.jpg'));

    assert.ok(takeIntakeHandoff() !== null);
    assert.equal(takeIntakeHandoff(), null, 'a second read must find nothing');
  });

  it('keeps the newest capture when one is offered before the last was taken', () => {
    offerPickedFile(photo('first.jpg'));
    offerPickedFile(photo('second.jpg'));

    const handed = takeIntakeHandoff();

    assert.ok(handed?.kind === 'photo');
    assert.equal(handed.file.name, 'second.jpg');
    assert.equal(takeIntakeHandoff(), null, 'the replaced photo must not queue behind it');
  });

  it('hands over what was typed, with the way it was produced', () => {
    offerTypedText('3 eggs, 2 slices of toast', 'text');

    const handed = takeIntakeHandoff();

    assert.ok(handed?.kind === 'text');
    assert.equal(handed.text, '3 eggs, 2 slices of toast');
    assert.equal(handed.source, 'text');
  });

  it('tells a dictated sentence from a typed one, for the entries that already say so', () => {
    offerTypedText('a banana', 'speech');

    const handed = takeIntakeHandoff();

    assert.ok(handed?.kind === 'text');
    assert.equal(handed.source, 'speech');
  });

  it('empties as it is read for a sentence too, so no words are analysed twice', () => {
    offerTypedText('a banana', 'text');

    assert.ok(takeIntakeHandoff() !== null);
    assert.equal(takeIntakeHandoff(), null, 'a second read must find nothing');
  });

  it('replaces a parked sentence with a photo, leaving nothing of it behind', () => {
    offerTypedText('a banana', 'speech');
    offerPickedFile(photo('plate.jpg'));

    const handed = takeIntakeHandoff();

    assert.ok(handed?.kind === 'photo', 'the sentence survived a later photo capture');
    assert.equal(takeIntakeHandoff(), null, 'the replaced sentence must not queue behind it');
  });
});

describe('intake sources', () => {
  it('still names the three ways in, including the historic one', () => {
    // `speech` is a RECORDED VALUE, not a live feature: M203 removed the app's
    // own microphone, and dictation arrives as ordinary typing. Diary entries
    // and analytics events written before that carry the literal, so dropping
    // it from the union would make valid old data unreadable.
    assert.deepStrictEqual([...INTAKE_SOURCES], ['photo', 'text', 'speech']);
  });
});
