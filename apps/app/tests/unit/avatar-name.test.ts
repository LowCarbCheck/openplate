/**
 * The name on the header's avatar button (owner report, 2026-09-30).
 *
 * `resolveAvatarName` answers a name or `null`, and `null` is drawn as "This
 * device". `resolveAvatarLabel` adds the one state a snapshot cannot answer
 * yet: a session still reopening after a reload, where the button says
 * nothing rather than "This device" to a person who is signed in.
 *
 * EVERY CASE CARRIES ITS CONTROL: an input one step away that must answer
 * differently, so a rule that answered a constant, or dropped every name, or
 * never cut an address, or blanked every signed-out button, fails here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAvatarLabel, resolveAvatarName } from '../../app/lib/avatar-name';

describe('resolveAvatarName', () => {
  it('shows a display name as it is', () => {
    assert.equal(resolveAvatarName('Altan Sarisin'), 'Altan Sarisin');
    // CONTROL: another name answers that name, so the answer is not a constant.
    assert.equal(resolveAvatarName('Maria'), 'Maria');
  });

  it('shows the part before the @ of a name that is an email address', () => {
    assert.equal(resolveAvatarName('altan@example.com'), 'altan');
    assert.equal(resolveAvatarName('  first.last@example.com  '), 'first.last');
    // CONTROL: the same letters with no @ are kept whole, so the cut is the @'s doing.
    assert.equal(resolveAvatarName('altan.example.com'), 'altan.example.com');
  });

  it('shows nothing for an address with nothing before the @', () => {
    assert.equal(resolveAvatarName('@example.com'), null);
    assert.equal(resolveAvatarName('  @example.com'), null);
    // CONTROL: one letter before the @ is a name.
    assert.equal(resolveAvatarName('a@example.com'), 'a');
  });

  it('shows nothing for an empty name', () => {
    assert.equal(resolveAvatarName(''), null);
    // CONTROL: one character is a name, so short names are not dropped.
    assert.equal(resolveAvatarName('A'), 'A');
  });

  it('shows nothing without a session', () => {
    assert.equal(resolveAvatarName(null), null);
    // CONTROL: the same call with a name answers it.
    assert.equal(resolveAvatarName('Altan'), 'Altan');
  });

  it('shows nothing for a name of only whitespace', () => {
    assert.equal(resolveAvatarName('   '), null);
    assert.equal(resolveAvatarName('\t\n'), null);
    // CONTROL: whitespace around a name is trimmed, and the name is kept.
    assert.equal(resolveAvatarName('  Altan  '), 'Altan');
  });
});

describe('resolveAvatarLabel', () => {
  const settled = { isResuming: false, hasSyncServer: true };

  it('names a signed-in account', () => {
    assert.deepEqual(resolveAvatarLabel({ ...settled, displayName: 'Altan' }), { kind: 'name', name: 'Altan' });
    assert.deepEqual(resolveAvatarLabel({ ...settled, displayName: 'altan@example.com' }), {
      kind: 'name',
      name: 'altan',
    });
    // CONTROL: the same account with no name is the device.
    assert.deepEqual(resolveAvatarLabel({ ...settled, displayName: null }), { kind: 'device' });
  });

  it('says This device for an account whose name is empty', () => {
    assert.deepEqual(resolveAvatarLabel({ ...settled, displayName: '  ' }), { kind: 'device' });
    // CONTROL: one letter is a name.
    assert.deepEqual(resolveAvatarLabel({ ...settled, displayName: 'A' }), { kind: 'name', name: 'A' });
  });

  it('says nothing while a session may still be reopening', () => {
    assert.deepEqual(resolveAvatarLabel({ displayName: null, isResuming: true, hasSyncServer: true }), {
      kind: 'pending',
    });
    // CONTROL: once the resume settles with nobody, it is the device again.
    assert.deepEqual(resolveAvatarLabel({ displayName: null, isResuming: false, hasSyncServer: true }), {
      kind: 'device',
    });
  });

  it('never waits on an instance with no sync server, where nothing reopens', () => {
    assert.deepEqual(resolveAvatarLabel({ displayName: null, isResuming: true, hasSyncServer: false }), {
      kind: 'device',
    });
    // CONTROL: the same flag with a sync server waits.
    assert.equal(resolveAvatarLabel({ displayName: null, isResuming: true, hasSyncServer: true }).kind, 'pending');
  });

  it('shows a known name even while the flag still says resuming', () => {
    assert.deepEqual(resolveAvatarLabel({ displayName: 'Altan', isResuming: true, hasSyncServer: true }), {
      kind: 'name',
      name: 'Altan',
    });
    // CONTROL: without the name the same snapshot waits.
    assert.equal(resolveAvatarLabel({ displayName: '', isResuming: true, hasSyncServer: true }).kind, 'pending');
  });
});
