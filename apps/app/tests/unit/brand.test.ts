/**
 * The brand constants (`app/lib/brand.ts`) — M146 spec 01.
 *
 * Two properties, each of which fails silently in production if it drifts:
 *
 * 1. **The repository URL is written down exactly once in `app/`.** A fork is
 *    supposed to be one edit; a second hand-written `github.com/...` in a
 *    component would leave the forker advertising OUR repository as theirs from
 *    a surface they never found. Nothing else in the repo can catch that.
 * 2. **The licence URL is derived from the repository URL**, so the same one
 *    edit moves it.
 *
 * A third one used to live here: `APP_VERSION` equals `package.json`'s
 * `version`. That pin is gone with the literal it pinned (M203). The version is
 * injected by the build now (`app/lib/build-info.ts`), read straight out of the
 * manifest by `vite.config.ts`, so there is no second copy left to drift.
 * `tests/unit/build-info.test.ts` covers what replaced it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  PROJECT_SITE_HOST,
  PROJECT_SITE_URL,
  RELEASE_FEED_URL,
  REPO_LICENSE_URL,
  REPO_URL,
  SELF_HOSTING_DOCS_URL,
  SELF_HOSTING_HTTPS_DOCS_PATH,
  YAZIO_IMPORT_DOCS_PATH,
  projectSiteUrl,
} from '../../app/lib/brand';
import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';

const APP_DIR = fileURLToPath(new URL('../../app', import.meta.url));

/** Every source file under `app/`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('REPO_URL', () => {
  it('is the openplate repository', () => {
    assert.equal(REPO_URL, 'https://github.com/LowCarbCheck/openplate');
  });

  it('appears as a literal in exactly one file — a fork is one edit', () => {
    const carriers = sourceFiles(APP_DIR).filter((path) => readFileSync(path, 'utf8').includes(REPO_URL));
    assert.deepEqual(
      carriers.map((path) => path.slice(APP_DIR.length + 1)),
      ['lib/brand.ts'],
    );
  });

  it('derives the licence URL, so the fork edit carries it too', () => {
    assert.ok(REPO_LICENSE_URL.startsWith(`${REPO_URL}/`));
    assert.match(REPO_LICENSE_URL, /\/LICENSE$/);
  });
});

/**
 * THE PROJECT SITE AND ITS LANGUAGES (M266 design, step 2).
 *
 * openplate.de puts German at its root and every other language under a
 * prefix (`apps/website/app/i18n/language.ts`). The app's links to it used to
 * be the English copy for everybody, and the door page and the footer now link
 * it too, so the rule is pinned here with the URLs written out: a test that
 * rebuilt them from the same table would agree with any mistake in it.
 */
describe('projectSiteUrl', () => {
  it('is the openplate project site, named by its host', () => {
    assert.equal(PROJECT_SITE_URL, 'https://openplate.de');
    assert.equal(PROJECT_SITE_HOST, 'openplate.de');
  });

  it('puts German at the root and every other language under its prefix', () => {
    const expected = {
      de: 'https://openplate.de/',
      en: 'https://openplate.de/en/',
      fr: 'https://openplate.de/fr/',
      it: 'https://openplate.de/it/',
      es: 'https://openplate.de/es/',
      tr: 'https://openplate.de/tr/',
    };
    for (const language of SUPPORTED_LANGUAGES) {
      assert.equal(projectSiteUrl(language, '/'), expected[language], language);
    }
  });

  it('keeps the path, its trailing slash and its anchor, after the prefix', () => {
    assert.equal(
      projectSiteUrl('en', YAZIO_IMPORT_DOCS_PATH),
      'https://openplate.de/en/docs/app/import-from-yazio/',
    );
    assert.equal(projectSiteUrl('de', YAZIO_IMPORT_DOCS_PATH), 'https://openplate.de/docs/app/import-from-yazio/');
    assert.equal(
      projectSiteUrl('fr', SELF_HOSTING_HTTPS_DOCS_PATH),
      'https://openplate.de/fr/docs/app/self-hosting/#https',
    );
  });

  it('derives the self-hosting guide from the site, so a fork is still one edit', () => {
    assert.equal(SELF_HOSTING_DOCS_URL, 'https://openplate.de/docs/app/self-hosting');
    assert.ok(SELF_HOSTING_DOCS_URL.startsWith(`${PROJECT_SITE_URL}/`));
  });

  it('derives the release feed from the site, so a fork is still one edit', () => {
    assert.equal(RELEASE_FEED_URL, 'https://openplate.de/latest.json');
    assert.equal(RELEASE_FEED_URL, `${PROJECT_SITE_URL}/latest.json`);
    // The banner's link still goes to the repository's release page, not to the feed.
    assert.ok(!RELEASE_FEED_URL.startsWith(REPO_URL));
  });

  it('leaves no hardcoded language prefix on a site link in brand.ts', () => {
    // The two docs links carried `/en/` and sent every reader to the English
    // copy. A prefix comes from the reader's language now, never from a literal.
    // Comments are cut first: the function's own doc names the English URL as an example.
    const code = readFileSync(join(APP_DIR, 'lib/brand.ts'), 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '');
    assert.deepEqual(code.match(/openplate\.de\/(?:en|fr|it|es|tr|de)\//g) ?? [], []);
    // THE CONTROL: the same reader finds the literal the old constant carried.
    const old = "export const YAZIO_IMPORT_DOCS_URL = 'https://openplate.de/en/docs/app/import-from-yazio/';";
    assert.equal((old.match(/openplate\.de\/(?:en|fr|it|es|tr|de)\//g) ?? []).length, 1);
  });
});
