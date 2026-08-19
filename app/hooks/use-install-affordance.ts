import { useEffect, useState, useSyncExternalStore } from 'react';
import { chooseInstallAffordance, isIosDevice, isRunningStandalone } from '#app/lib/pwa-install';
import type { InstallAffordance } from '#app/lib/pwa-install';
import {
  consumeDeferredInstallPrompt,
  getDeferredInstallPrompt,
  getHasInstalledEventFired,
  subscribeToInstallCapture,
} from '#app/lib/pwa-install-capture';

/** Nothing captured yet during SSR/first paint — resolved once platform checks run on mount. */
function getFalseServerSnapshot(): boolean {
  return false;
}

/**
 * Runs the captured `beforeinstallprompt` deferred prompt, if one is still
 * pending. Module-scoped because it closes over nothing: the prompt lives in
 * `#app/lib/pwa-install-capture`, not in this hook's state.
 */
async function promptInstall(): Promise<void> {
  const prompt = consumeDeferredInstallPrompt();
  if (!prompt) return;
  await prompt.prompt();
  await prompt.userChoice;
  // `appinstalled` (handled globally in pwa-install-capture.ts) fires the
  // storage-persistence request on acceptance; nothing further to do here
  // either way — the prompt is already consumed.
}

/** What a piece of chrome needs to render and drive the install affordance. */
export type InstallAffordanceControls = {
  affordance: InstallAffordance;
  promptInstall: () => Promise<void>;
};

/**
 * The install affordance any piece of chrome (the settings hub's
 * `InstallCard`, the app-header nav drawer) should render, plus the action to
 * trigger it.
 * Combines the pure platform detection in `#app/lib/pwa-install` with the
 * globally-captured `beforeinstallprompt` state from
 * `#app/lib/pwa-install-capture` (captured at app startup, not on this
 * component's mount — see that module's doc comment for why that matters).
 */
export function useInstallAffordance(): InstallAffordanceControls {
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const displayModeStandalone = window.matchMedia('(display-mode: standalone)').matches;
    // SAFETY: `navigator.standalone` is an iOS-only, non-standard property missing from
    // lib.dom's `Navigator`; the widened type only adds it as optional, and the `=== true`
    // comparison treats its absence on every other platform as "not standalone".
    const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsStandalone(isRunningStandalone({ displayModeStandalone, iosStandalone }));
    setIsIos(isIosDevice({ userAgent: window.navigator.userAgent, maxTouchPoints: window.navigator.maxTouchPoints }));
  }, []);

  const hasDeferredPrompt = useSyncExternalStore(
    subscribeToInstallCapture,
    () => getDeferredInstallPrompt() !== null,
    getFalseServerSnapshot,
  );
  const hasInstalledEventFired = useSyncExternalStore(
    subscribeToInstallCapture,
    getHasInstalledEventFired,
    getFalseServerSnapshot,
  );

  const affordance = chooseInstallAffordance({
    isStandalone: isStandalone || hasInstalledEventFired,
    hasDeferredPrompt,
    isIos,
  });

  return { affordance, promptInstall };
}
