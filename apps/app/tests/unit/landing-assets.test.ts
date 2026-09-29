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
 * ── The folder is the reader's language now (M266 design, step 3) ────────
 *
 * The landing used to hardcode `/landing/en/` in every `src`. It asks
 * `app/lib/landing-shots.ts` for the reader's folder now, with English where a
 * language has none, so the file names and the folders are LISTS in that
 * module and this test holds both lists to the disk: every file, in every
 * folder listed, in both themes. The route may name a capture only by its file
 * name, through that module, never as a literal path.
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

import {
  LANDING_SHOT_FILES,
  LANDING_SHOT_LANGUAGES,
  landingShotLanguage,
  landingShotUrl,
} from '../../app/lib/landing-shots';
import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';

const ROUTE_URL = new URL('../../app/routes/landing-open.tsx', import.meta.url);
const PUBLIC_DIR = new URL('../../public/', import.meta.url);

/** The open landing's source. */
function routeSource(): string {
  return readFileSync(fileURLToPath(ROUTE_URL), 'utf8');
}

/**
 * Every capture file name the route mentions, `src`, `srcSet` (where two live
 * in one template string) or anything else. Deduplicated, because the diary
 * captures are referenced more than once.
 */
function referencedShotFiles(): string[] {
  const matches = routeSource().match(/[a-z0-9-]+-(?:dark|light)(?:-1080)?\.webp/g) ?? [];
  return [...new Set(matches)].toSorted();
}

describe('landing screenshots', () => {
  it('references at least the hero and the four phone shots, in both themes', () => {
    // 12 is a floor, not the count (the page names 16 today: six phone
    // captures in two themes, plus the laptop pair at two widths). It exists
    // so a pattern that silently stopped matching fails here, rather than
    // turning every assertion below into a pass over an empty list.
    assert.ok(
      referencedShotFiles().length >= 12,
      `expected at least 12 landing captures to be referenced, found ${referencedShotFiles().length}`,
    );
  });

  it('names every capture it references in the list the folders are checked against', () => {
    const listed = new Set<string>(LANDING_SHOT_FILES);
    const unlisted = referencedShotFiles().filter((file) => !listed.has(file));
    assert.deepEqual(unlisted, [], `captures the route names that landing-shots.ts does not list: ${unlisted.join(', ')}`);
  });

  it('writes no capture path by hand, so no page can fall back to one folder', () => {
    // The literal `/landing/en/...` on every `src` is exactly what drew the
    // English diary on the German page. Every address goes through
    // `landingShotUrl` now.
    assert.deepEqual(routeSource().match(/\/landing\/[A-Za-z0-9._/-]*/g) ?? [], []);
    assert.match(routeSource(), /landingShotUrl\(/);
  });

  it('has a file in public/ for every listed capture, in every listed folder', () => {
    const missing = LANDING_SHOT_LANGUAGES.flatMap((language) =>
      LANDING_SHOT_FILES.map((file) => landingShotUrl({ language, file })).filter(
        (asset) => !existsSync(fileURLToPath(new URL(`.${asset}`, PUBLIC_DIR))),
      ),
    );
    assert.deepEqual(missing, [], `landing screenshots listed but not present in public/landing/: ${missing.join(', ')}`);
  });

  it('pairs every capture with its opposite theme, in both directions', () => {
    // The `.dark` class theme means a screenshot without its counterpart is
    // not an error, it is a black rectangle on a pale page (or a white one on
    // a dark page). BOTH directions, because the fault is symmetric.
    const files: readonly string[] = LANDING_SHOT_FILES;
    const unpaired = files.filter((file) => {
      if (file.includes('-dark')) return !files.includes(file.replace('-dark', '-light'));
      if (file.includes('-light')) return !files.includes(file.replace('-light', '-dark'));
      return true;
    });
    assert.deepEqual(unpaired, [], `captures with no opposite-theme counterpart: ${unpaired.join(', ')}`);
  });
});

describe('the folder a reader\'s landing draws from', () => {
  it('is their own where it exists', () => {
    assert.equal(landingShotLanguage('de'), 'de');
    assert.equal(landingShotLanguage('en'), 'en');
  });

  it('is English for every language with no folder on disk', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const onDisk = existsSync(fileURLToPath(new URL(`./landing/${language}/`, PUBLIC_DIR)));
      const expected = onDisk ? language : 'en';
      assert.equal(landingShotLanguage(language), expected, `${language}: the folder on disk and the list disagree`);
    }
  });

  it('builds the address the static server answers', () => {
    assert.equal(landingShotUrl({ language: 'de', file: 'diary-mobile-dark.webp' }), '/landing/de/diary-mobile-dark.webp');
  });
});
