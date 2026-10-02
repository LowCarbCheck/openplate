/**
 * The store behind the sign-out dialog (`sign-out-progress.ts`).
 *
 * The rule worth a test is the lock: a dialog whose sign-out is running cannot
 * be closed, because its error would then have nowhere to be shown. A test that
 * only closed an idle dialog could not fail, so the running row and the idle
 * row sit side by side, and the third row proves the lock lifts once the
 * erase has failed.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  closeSignOutDialog,
  getSignOutProgress,
  isSignOutRunning,
  openSignOutDialog,
  returnFocusAfterSignOutDialog,
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

/**
 * Where focus goes back to. The store records the element that had focus when a
 * door opened the dialog, and gives focus back to it when the dialog has
 * closed, or to the avatar button when that element has left the page. There is
 * no DOM in `node:test`, so a stand-in `document` and `HTMLElement` carry just
 * what the store reads: `activeElement`, `body`, `isConnected`, `focus()` and
 * `querySelector`.
 */
describe('where focus goes back to', () => {
  class FakeElement {
    isConnected = true;
    focused = false;
    focus(): void {
      this.focused = true;
    }
  }

  const body = new FakeElement();
  const avatar = new FakeElement();
  const settingsButton = new FakeElement();
  const menuRow = new FakeElement();
  let active: FakeElement | null = null;
  const realDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const realElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');

  beforeEach(() => {
    for (const element of [body, avatar, settingsButton, menuRow]) {
      element.isConnected = true;
      element.focused = false;
    }
    active = null;
    Object.defineProperty(globalThis, 'HTMLElement', { value: FakeElement, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: {
        body,
        get activeElement() {
          return active;
        },
        querySelector: (selector: string) => (selector.includes('avatar-menu-trigger') ? avatar : null),
      },
    });
  });

  afterEach(() => {
    for (const [name, descriptor] of [
      ['document', realDocument],
      ['HTMLElement', realElement],
    ] as const) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, descriptor);
    }
  });

  it('gives focus back to the element that had it when the dialog opened', () => {
    active = settingsButton;
    openSignOutDialog();
    active = null;
    returnFocusAfterSignOutDialog();
    assert.equal(settingsButton.focused, true);
    // CONTROL: and not to the avatar button, which a fixed target would have chosen.
    assert.equal(avatar.focused, false);
  });

  it('falls back to the avatar button when that element left the page with its menu', () => {
    active = menuRow;
    openSignOutDialog();
    menuRow.isConnected = false;
    returnFocusAfterSignOutDialog();
    assert.equal(avatar.focused, true);
    assert.equal(menuRow.focused, false);
  });

  it('falls back to the avatar button when nothing had focus, and the body does not count', () => {
    active = body;
    openSignOutDialog();
    returnFocusAfterSignOutDialog();
    assert.equal(avatar.focused, true);
    assert.equal(body.focused, false);
  });

  it("does not record the dialog's own button when a door calls it a second time", () => {
    active = settingsButton;
    openSignOutDialog();
    active = menuRow;
    openSignOutDialog();
    returnFocusAfterSignOutDialog();
    assert.equal(settingsButton.focused, true);
    assert.equal(menuRow.focused, false);
  });

  it('forgets the element once it has been used', () => {
    active = settingsButton;
    openSignOutDialog();
    returnFocusAfterSignOutDialog();
    settingsButton.focused = false;
    returnFocusAfterSignOutDialog();
    assert.equal(settingsButton.focused, false);
    assert.equal(avatar.focused, true);
  });

  it('is safe where there is no document, as on the server', () => {
    Reflect.deleteProperty(globalThis, 'document');
    assert.doesNotThrow(() => openSignOutDialog());
    assert.doesNotThrow(() => returnFocusAfterSignOutDialog());
  });
});
