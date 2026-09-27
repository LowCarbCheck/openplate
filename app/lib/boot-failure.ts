/**
 * The boot screen's one sentence for a page whose scripts never arrived (2026-09-27).
 *
 * THE DEFECT. A device that had visited once and then lost the server got a saved page from
 * the service worker whose every script was a 503. React never started, so nothing that lives
 * in a bundle could say anything, and the boot screen (`AppLoading`) showed the wordmark
 * forever. The worker no longer serves such a page (`public/sw.js`, v6), but a page can still
 * lose its scripts on the way: the network drops between the HTML and its files, or no worker
 * is installed yet. So the boot screen carries its own sentence, and this module is the part of
 * it that runs WITHOUT a bundle.
 *
 * HOW IT WORKS.
 * - `AppLoading` renders the sentence on the server, in the reader's language like every other
 *   word of the first paint, marked with {@link BOOT_FAILED_LINE_ATTRIBUTE} and held with an
 *   inline `visibility: hidden`, so its box is there from the first frame.
 * - {@link BOOT_FAILURE_SCRIPT} is inlined at the top of `<head>`, before any script or preload
 *   tag. It listens, in the capture phase, for the `error` event a `<script>` or a
 *   `modulepreload` link fires when its file does not load, and then shows every marked line and
 *   sets {@link BOOT_FAILED_ATTRIBUTE} on `<html>` (the stylesheet, if it arrived, stops the
 *   wordmark's wave on it). A picture that fails before the app starts is hidden rather than
 *   drawn as a broken image, keeping its box.
 * - Once React has started, `root.tsx` calls {@link markAppStarted}, and a later failure (a lazy
 *   chunk, the analytics script) is no longer a boot failure: the listener ignores it.
 *
 * Plain ES5 in a string, because it must run in the first bytes of the page, before and without
 * everything the build produces. `'unsafe-inline'` is already in the production `script-src`
 * for the theme script beside it (`app/config/content-security-policy.ts`).
 */

/** Marks the boot screen's hidden "could not load" sentence. */
export const BOOT_FAILED_LINE_ATTRIBUTE = 'data-boot-failed-line';

/** Set on `<html>` when a script failed before the app started. */
export const BOOT_FAILED_ATTRIBUTE = 'data-boot-failed';

/** Set on `<html>` once React has started; from then on a failed script is not a boot failure. */
export const APP_STARTED_ATTRIBUTE = 'data-app-started';

/** The inline script, as the `<head>` carries it. */
export const BOOT_FAILURE_SCRIPT = `(function () {
  var root = document.documentElement;
  var hasFailed = false;
  function reveal() {
    root.setAttribute('${BOOT_FAILED_ATTRIBUTE}', '');
    var lines = document.querySelectorAll('[${BOOT_FAILED_LINE_ATTRIBUTE}]');
    for (var i = 0; i < lines.length; i++) lines[i].style.visibility = 'visible';
  }
  window.addEventListener('error', function (event) {
    if (root.hasAttribute('${APP_STARTED_ATTRIBUTE}')) return;
    var target = event.target;
    if (!target || !target.tagName) return;
    if (target.tagName === 'IMG') {
      target.style.visibility = 'hidden';
      return;
    }
    if (target.tagName === 'SCRIPT' || (target.tagName === 'LINK' && target.rel === 'modulepreload')) {
      hasFailed = true;
      reveal();
    }
  }, true);
  document.addEventListener('DOMContentLoaded', function () {
    if (hasFailed) reveal();
  });
})();`;

/** Records that React has started, so the boot failure listener stands down. */
export function markAppStarted(): void {
  document.documentElement.setAttribute(APP_STARTED_ATTRIBUTE, '');
}
