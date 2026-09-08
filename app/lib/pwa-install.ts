/**
 * Pure environment-detection helpers behind the "Install openplate" affordance.
 *
 * Deliberately free of `window`/`navigator` access so every branch is
 * unit-testable — the caller reads the handful of platform values off the
 * browser and passes them in. The React component in
 * `app/components/install-card.tsx` is the imperative shell around these.
 */

/**
 * What a surface should say about installing, on THIS device, right now.
 *
 * Four states, not three, and the two silent-looking ones are deliberately
 * separate because they are opposite facts:
 *
 * - `'already-installed'`: the app is running standalone. There is nothing
 *   left to say, and every surface renders nothing.
 * - `'prompt'`: a `beforeinstallprompt` was captured, so installing is one
 *   button press away.
 * - `'ios-instructions'`: an iOS device, which has no install API, so the
 *   manual "Add to Home Screen" steps are the affordance.
 * - `'cannot-install'`: this browser can offer no install at all and is not
 *   iOS, meaning desktop Firefox, desktop Safari, and Chrome before or without
 *   `beforeinstallprompt`. Installing openplate is still a real, useful fact
 *   about the product, it just cannot be done from HERE.
 *
 * Why the difference matters: these two used to be one `'none'` value, and
 * every caller guarded on it with `if (affordance === 'none') return null`.
 * That is right for an installed device and wrong for a browser that cannot
 * install, where it silenced the onboarding lesson whose whole job is to teach
 * that openplate installs on a phone. Conflating them made "say nothing,
 * correctly" and "say nothing, by accident" indistinguishable at every call
 * site. A surface now answers each one on its own: a false promise is worse
 * than silence, and silence is worse than a plain fact.
 */
export type InstallAffordance = 'already-installed' | 'prompt' | 'ios-instructions' | 'cannot-install';

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
 * Decides which install affordance applies. Pure: already-installed wins over
 * everything (including a stale captured prompt), then a captured native
 * prompt, then iOS manual instructions, and otherwise this browser simply
 * cannot install, which is its own answer rather than the same one as
 * "already installed". See `InstallAffordance` for why those two are separate.
 */
export function chooseInstallAffordance(input: {
  isStandalone: boolean;
  hasDeferredPrompt: boolean;
  isIos: boolean;
}): InstallAffordance {
  if (input.isStandalone) return 'already-installed';
  if (input.hasDeferredPrompt) return 'prompt';
  if (input.isIos) return 'ios-instructions';
  return 'cannot-install';
}
