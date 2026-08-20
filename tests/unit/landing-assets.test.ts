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
    // A floor, not an exact count: the point is that a regex which silently
    // stopped matching would otherwise make every assertion below vacuous.
    // Four phone shots × 2 themes + 1 laptop shot × 2 themes × 2 widths = 12.
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

  it('pairs every dark capture with a light one', () => {
    // The `.dark` class theme means a screenshot without a light variant is
    // not an error, it is a black rectangle on a pale page — see `ThemedShot`
    // in the route for why the pair is a component rather than a convention.
    const assets = referencedLandingAssets();
    const unpaired = assets
      .filter((asset) => asset.includes('-dark'))
      .filter((asset) => !assets.includes(asset.replace('-dark', '-light')));
    assert.deepEqual(unpaired, [], `dark captures with no light counterpart: ${unpaired.join(', ')}`);
  });
});
