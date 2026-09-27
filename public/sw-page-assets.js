// The service worker's reader for what a saved page needs in order to start.
//
// A page this worker keeps for offline use is only worth keeping together
// with the files it loads before it can do anything: its module scripts, its
// stylesheets, its preloaded font, and the pictures it draws at first paint
// (the boot screen's logo). A saved page without them is the endless boot
// screen of 2026-09-27: the HTML came back from the cache, and every script
// it asked for was a 503, so it showed the wordmark and a broken picture for
// good. `public/sw.js` therefore saves a page only once every file this
// reader lists is saved too, and serves a saved page only while they all
// still are.
//
// WHAT COUNTS. Every same-origin address under `/assets/` (the hashed build
// output: scripts, stylesheets, fonts) or `/icons/` (the synced brand
// pictures) that the HTML names in quotes. That covers the `modulepreload`
// and `stylesheet` links, the font `preload`, the inline module script's
// `import` lines, an `<img src>` and the icon links, without parsing HTML,
// which a worker has no DOM to do. The route manifest's own list of every
// route is a separate script file, not this HTML, so what this lists is what
// THIS page loads to start, not the whole app.
//
// A classic script, loaded with `importScripts` for the reason
// `sw-push-decision.js` gives, and pure, so `tests/unit/sw-page-assets.test.ts`
// runs it under node. It attaches one name to `self`.

(function attachPageAssets(scope) {
  // A quoted, root-relative address under one of the two folders. The query is
  // kept (`/icons/icon-192.png?v=2` is the address the page asks for, and the
  // cache matches addresses exactly); a fragment never reaches a request.
  const ASSET_PATTERN = /["'](\/(?:assets|icons)\/[^"'\s#<>\\]+)["']/g;

  /**
   * The start-up files a page's HTML names, each once, in first-seen order.
   *
   * @param {string} html
   * @returns {string[]}
   */
  function listPageAssets(html) {
    const found = [];
    const seen = new Set();
    for (const match of String(html).matchAll(ASSET_PATTERN)) {
      const address = match[1];
      if (seen.has(address)) continue;
      seen.add(address);
      found.push(address);
    }
    return found;
  }

  scope.openplatePageAssets = { listPageAssets };
})(self);
