/**
 * Every screenshot the landing page asks for is actually on disk.
 *
 * ── The failure this catches ─────────────────────────────────────────────
 *
 * `public/landing/` is a directory of binary captures produced by driving the
 * running app, not by the build. Nothing generates them and nothing else
 * references them, so an untracked or mistyped one fails in exactly one way:
 * the page renders perfectly, the layout is unchanged (the `<img>` keeps its
 * intrinsic `width`/`height`), and there is simply a hole where the product
 * shot was. Typecheck cannot see it — the src is a string literal. The build
 * cannot see it — Vite does not resolve `/public` URLs. A reviewer looking at
 * a diff of `.tsx` cannot see it either.
 *
 * It very nearly shipped that way: the capture files were written but never
 * added to git, so every check on the developer's own machine passed against
 * files that would not exist in the image.
 *
 * ── Why it reads the source rather than importing the route ──────────────
 *
 * The route module pulls in React, i18next and the local IndexedDB store; a
 * render harness for this one fact would be far more machinery than the fact
 * is worth, and it would only cover the paths a given render happened to take
 * (the `dark:` half of every pair, the `srcSet` variants, and the whole mobile
 * pair are all conditional in the DOM but unconditional in the source). One
 * regex over the file catches every string, including the ones inside
 * `srcSet`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROUTE_URL = new URL('../../app/routes/index.tsx', import.meta.url);
const PUBLIC_DIR = new URL('../../public/', import.meta.url);

/**
 * Every `/landing/….webp` URL mentioned anywhere in the landing route — `src`,
 * `srcSet` (where two live in one comma-separated string), or anything else.
 * Deduplicated, because the diary captures are referenced more than once.
 */
function referencedLandingAssets(): string[] {
  const source = readFileSync(fileURLToPath(ROUTE_URL), 'utf8');
  const matches = source.match(/\/landing\/[A-Za-z0-9._-]+\.webp/g) ?? [];
  return [...new Set(matches)].toSorted();
}

describe('landing screenshots', () => {
  it('references at least the hero and the four phone shots, in both themes', () => {
    // 12 is the EXACT count the page references today: four phone captures
    // (scan, add, diary, overview) × 2 themes = 8, plus one laptop capture × 2
    // themes × 2 srcset widths = 4. It is asserted as a floor rather than as
    // an equality so that adding a screenshot does not fail a test about the
    // regex — which is what this case is really for: a pattern that silently
    // stopped matching would make every assertion below vacuous, and only a
    // count catches that.
    assert.ok(
      referencedLandingAssets().length >= 12,
      `expected at least 12 landing assets to be referenced, found ${referencedLandingAssets().length}`,
    );
  });

  it('has a file in public/ for every asset the route references', () => {
    const missing = referencedLandingAssets().filter(
      (asset) => !existsSync(fileURLToPath(new URL(`.${asset}`, PUBLIC_DIR))),
    );
    assert.deepEqual(missing, [], `landing screenshots referenced but not present in public/landing/: ${missing.join(', ')}`);
  });

  it('pairs every capture with its opposite theme, in both directions', () => {
    // The `.dark` class theme means a screenshot without its counterpart is
    // not an error, it is a black rectangle on a pale page (or a white one on
    // a dark page) — see the hero pictures in the route for why the pair is a
    // component rather than a convention.
    //
    // BOTH directions, because the fault is symmetric and the check was not:
    // dark→light only would pass a page that referenced a light capture with
    // no dark twin, which fails for exactly the visitors who use dark mode —
    // the half of them least likely to be the one running this suite.
    const assets = referencedLandingAssets();
    const unpaired = assets.filter((asset) => {
      if (asset.includes('-dark')) return !assets.includes(asset.replace('-dark', '-light'));
      if (asset.includes('-light')) return !assets.includes(asset.replace('-light', '-dark'));
      return false;
    });
    assert.deepEqual(unpaired, [], `captures with no opposite-theme counterpart: ${unpaired.join(', ')}`);
  });
});
