/**
 * The mark, against the provenance the brand sync left behind, M196 spec 03.
 *
 * `openplate-brand` is the single origin of openplate's mark. Until 2026-09-07 this repository's
 * `public/icons/` WAS the original, and that is how the product ended up shipping an icon set whose
 * 192 was not a downscale of its own 512: nothing anywhere could tell you the files had drifted
 * apart. `public/icons/` is now a COPY, written by `pnpm sync:brand`, which records what it wrote in
 * `public/icons/BRAND.json`.
 *
 * A rule with no check is prose. This is the check, and it is deliberately narrow: it re-hashes
 * every file the provenance names and fails when a byte differs. So a hand-edited icon, a
 * hand-replaced favicon, a truncated copy and a stray extra picture all fail the local gate rather
 * than shipping. It cannot tell you the mark is BEAUTIFUL. It can tell you it is the one the brand
 * repository published, which is the property nobody could check before.
 *
 * ── WHY THIS DOES NOT REACH THE BRAND REPOSITORY ──
 * `openplate-brand` is private, and this test runs in the pre-push gate. Fetching the manifest here
 * would need a credential for a private repository on every push, to re-learn hashes that
 * `BRAND.json` already carries. The committed provenance is the fact under test; refreshing it is
 * `pnpm sync:brand`'s job, run by hand.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { z } from 'zod';

const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url));
const ICONS_DIR = join(PUBLIC_DIR, 'icons');

/**
 * `BRAND.json` as `scripts/sync-brand.ts` writes it. Decoded rather than assumed: a provenance file
 * whose shape moved must fail loudly here, because the alternative is a test that iterates an empty
 * `files` map, asserts nothing and stays green forever.
 */
const ProvenanceSchema = z.object({
  repo: z.string().min(1),
  ref: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  producedBy: z.string().min(1),
  /** Path relative to `public/`, mapped to the sha256 the sync verified against the brand manifest. */
  files: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
});

const provenance = ProvenanceSchema.parse(JSON.parse(readFileSync(join(ICONS_DIR, 'BRAND.json'), 'utf8')));

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('BRAND.json', () => {
  it('records a real sync, not a placeholder', () => {
    assert.match(provenance.repo, /openplate-brand/);
    assert.equal(provenance.producedBy, 'openplate-brand, scripts/ship.ts');
  });

  it('names all six assets the app installs', () => {
    assert.deepEqual(Object.keys(provenance.files).toSorted(), [
      'favicon.ico',
      'icons/apple-touch-icon.png',
      'icons/icon-192.png',
      'icons/icon-512.png',
      'icons/icon-maskable-192.png',
      'icons/icon-maskable-512.png',
    ]);
  });
});

describe('the shipped mark', () => {
  for (const [path, expected] of Object.entries(provenance.files)) {
    it(`public/${path} still hashes to what the brand repository published`, () => {
      assert.equal(
        sha256Of(join(PUBLIC_DIR, path)),
        expected,
        `public/${path} is not the file BRAND.json records. Icons are not hand-edited: fix the master ` +
          `in openplate-brand, re-ship there, then run \`pnpm sync:brand\` here.`,
      );
    });
  }

  it('has nothing in public/icons/ that BRAND.json does not name', () => {
    const named = new Set(Object.keys(provenance.files).map((path) => path.replace(/^icons\//, '')));
    const strays = readdirSync(ICONS_DIR).filter((entry) => entry !== 'BRAND.json' && !named.has(entry));
    assert.deepEqual(strays, [], 'a picture nobody can account for. `pnpm sync:brand` prunes to the allowlist.');
  });
});

describe('site.webmanifest', () => {
  /** Only the part this test weighs. The manifest also carries copy, a scope and a share target. */
  const WebManifestSchema = z.object({ icons: z.array(z.object({ src: z.string() })) });

  it('declares only icons the sync installed', () => {
    const manifest = WebManifestSchema.parse(JSON.parse(readFileSync(join(PUBLIC_DIR, 'site.webmanifest'), 'utf8')));
    const declared = manifest.icons.map((icon) => icon.src.replace(/^\//, '')).toSorted();
    const installed = new Set(Object.keys(provenance.files));
    assert.deepEqual(
      declared.filter((src) => !installed.has(src)),
      [],
      'the manifest points at a picture the brand sync does not install, so it can rot unnoticed.',
    );
  });
});
