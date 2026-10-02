/**
 * The store behind the sign-out dialog (`sign-out-progress.ts`).
 *
 * The rule worth a test is the lock: a dialog whose sign-out is running cannot
 * be closed, because its error would then have nowhere to be shown. A test that
 * only closed an idle dialog could not fail, so the running row and the idle
 * row sit side by side, and the third row proves the lock lifts once the
 * erase has failed.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  closeSignOutDialog,
  getSignOutProgress,
  isSignOutRunning,
  openSignOutDialog,
  setSignOutPhase,
} from '../../app/lib/sync/sign-out-progress';

afterEach(() => {
  // The store is a module singleton: return it to its resting state.
  setSignOutPhase('idle');
  closeSignOutDialog();
});

describe('the sign-out dialog store', () => {
  it('starts closed and idle', () => {
    assert.deepEqual(getSignOutProgress(), { isOpen: false, phase: 'idle' });
    assert.equal(isSignOutRunning(), false);
  });

  it('opens when a door asks, and says nothing is running', () => {
    openSignOutDialog();
    assert.deepEqual(getSignOutProgress(), { isOpen: true, phase: 'idle' });
  });

  it('closes while idle', () => {
    openSignOutDialog();
    closeSignOutDialog();
    assert.equal(getSignOutProgress().isOpen, false);
  });

  it('CONTROL: stays open when closed while running', () => {
    openSignOutDialog();
    setSignOutPhase('running');
    closeSignOutDialog();
    assert.equal(getSignOutProgress().isOpen, true);
    assert.equal(isSignOutRunning(), true);
  });

  it('closes again once the sign-out has failed', () => {
    openSignOutDialog();
    setSignOutPhase('running');
    setSignOutPhase('failed');
    assert.equal(isSignOutRunning(), false);
    closeSignOutDialog();
    assert.equal(getSignOutProgress().isOpen, false);
  });

  it('keeps the dialog open across a failed attempt and a retry', () => {
    openSignOutDialog();
    setSignOutPhase('running');
    setSignOutPhase('failed');
    setSignOutPhase('running');
    assert.deepEqual(getSignOutProgress(), { isOpen: true, phase: 'running' });
  });

  it('keeps one snapshot identity until something changes, as useSyncExternalStore requires', () => {
    openSignOutDialog();
    const before = getSignOutProgress();
    openSignOutDialog();
    assert.equal(getSignOutProgress(), before);
    setSignOutPhase('running');
    assert.notEqual(getSignOutProgress(), before);
  });
});

describe('where the dialog is mounted', () => {
  const root = readFileSync(new URL('../../app/root.tsx', import.meta.url), 'utf8');

  it('mounts the host once, in the root, above every route', () => {
    assert.equal(root.split('<SignOutDialogHost />').length - 1, 1);
  });

  it('CONTROL: the count sees a mount, so a second copy anywhere would be counted too', () => {
    assert.equal('<A /><A />'.split('<A />').length - 1, 2);
  });
});
