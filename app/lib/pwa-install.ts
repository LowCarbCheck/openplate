/**
 * Pure environment-detection helpers behind the "Install openplate" affordance.
 *
 * Deliberately free of `window`/`navigator` access so every branch is
 * unit-testable — the caller reads the handful of platform values off the
 * browser and passes them in. The React component in
 * `app/components/install-card.tsx` is the imperative shell around these.
 */

/** Which install affordance the settings card should render. */
export type InstallAffordance = 'none' | 'prompt' | 'ios-instructions';

/**
 * True when the app is already running as an installed PWA — either the
 * standard `display-mode: standalone` match or iOS Safari's legacy
 * `navigator.standalone` flag.
 *
 * @param input.displayModeStandalone - `matchMedia('(display-mode: standalone)').matches`.
 * @param input.iosStandalone - iOS Safari's `navigator.standalone === true`.
 */
export function isRunningStandalone(input: { displayModeStandalone: boolean; iosStandalone: boolean }): boolean {
  return input.displayModeStandalone || input.iosStandalone;
}

/**
 * True for an iOS/iPadOS device, which has no `beforeinstallprompt` API and must
 * fall back to manual "Add to Home Screen" instructions.
 *
 * Catches the iPhone/iPad/iPod user agents directly, plus iPadOS 13+ Safari,
 * which masquerades as desktop macOS but is a multi-touch device.
 *
 * @param input.userAgent - `navigator.userAgent`.
 * @param input.maxTouchPoints - `navigator.maxTouchPoints`.
 */
export function isIosDevice(input: { userAgent: string; maxTouchPoints: number }): boolean {
  if (/iphone|ipad|ipod/i.test(input.userAgent)) return true;
  return input.maxTouchPoints > 1 && /macintosh/i.test(input.userAgent);
}

/**
 * Decides which install affordance to show. Pure: already-installed wins over
 * everything, then a captured native prompt, then iOS manual instructions,
 * otherwise nothing (e.g. a desktop browser that hasn't fired
 * `beforeinstallprompt`).
 */
export function chooseInstallAffordance(input: {
  isStandalone: boolean;
  hasDeferredPrompt: boolean;
  isIos: boolean;
}): InstallAffordance {
  if (input.isStandalone) return 'none';
  if (input.hasDeferredPrompt) return 'prompt';
  if (input.isIos) return 'ios-instructions';
  return 'none';
}
