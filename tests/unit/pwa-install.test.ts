/**
 * Unit tests for `#app/lib/pwa-install` — the pure detection helpers behind the
 * "Install openplate" affordance. No browser APIs: every platform value the
 * helpers need is passed in.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { chooseInstallAffordance, isIosDevice, isRunningStandalone } from '../../app/lib/pwa-install';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPADOS_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const MACOS_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

describe('isRunningStandalone', () => {
  it('is true when the display-mode media query matches', () => {
    assert.equal(isRunningStandalone({ displayModeStandalone: true, iosStandalone: false }), true);
  });

  it('is true for iOS Safari legacy navigator.standalone', () => {
    assert.equal(isRunningStandalone({ displayModeStandalone: false, iosStandalone: true }), true);
  });

  it('is false in a normal browser tab', () => {
    assert.equal(isRunningStandalone({ displayModeStandalone: false, iosStandalone: false }), false);
  });
});

describe('isIosDevice', () => {
  it('detects an iPhone user agent', () => {
    assert.equal(isIosDevice({ userAgent: IPHONE_UA, maxTouchPoints: 5 }), true);
  });

  it('detects iPadOS 13+ masquerading as macOS via touch points', () => {
    assert.equal(isIosDevice({ userAgent: IPADOS_UA, maxTouchPoints: 5 }), true);
  });

  it('does not treat a real Mac (no touch) as iOS', () => {
    assert.equal(isIosDevice({ userAgent: MACOS_UA, maxTouchPoints: 0 }), false);
  });

  it('does not treat Android as iOS', () => {
    assert.equal(isIosDevice({ userAgent: ANDROID_UA, maxTouchPoints: 5 }), false);
  });
});

describe('chooseInstallAffordance', () => {
  it('shows nothing when already installed, even with a deferred prompt', () => {
    assert.equal(chooseInstallAffordance({ isStandalone: true, hasDeferredPrompt: true, isIos: false }), 'none');
  });

  it('prefers the native prompt when one was captured', () => {
    assert.equal(chooseInstallAffordance({ isStandalone: false, hasDeferredPrompt: true, isIos: true }), 'prompt');
  });

  it('falls back to iOS instructions when there is no prompt on an iOS device', () => {
    assert.equal(
      chooseInstallAffordance({ isStandalone: false, hasDeferredPrompt: false, isIos: true }),
      'ios-instructions',
    );
  });

  it('shows nothing on a desktop browser that never fired beforeinstallprompt', () => {
    assert.equal(chooseInstallAffordance({ isStandalone: false, hasDeferredPrompt: false, isIos: false }), 'none');
  });
});
