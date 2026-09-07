/**
 * sync-brand, copy openplate's mark out of `openplate-brand` into `public/`.
 *
 * A DEVELOPER TOOL, run by hand, whose output is COMMITTED. The reasons are the ones
 * `openplate-brand/README.md` states as the contract: this app's image has no network at build
 * time, and a build that reaches GitHub for a picture can fail for a reason that has nothing to do
 * with the thing being built.
 *
 *   pnpm sync:brand                                        # the brand repository at its highest tag
 *   OPENPLATE_BRAND_REPO=../openplate-brand pnpm sync:brand # a checkout you already have
 *   OPENPLATE_BRAND_REF=v0.1.0 pnpm sync:brand              # any ref
 *
 * ── THE MARK BELONGS TO `openplate-brand`, SO THIS APP NO LONGER KEEPS AN ORIGINAL ──
 * Until 2026-09-07 `public/icons/` WAS the original, and that is exactly how the product ended up
 * with three teals and an icon set whose 192 was not a downscale of its own 512. A hand copy taken
 * once is a second original: it does not move when the mark is redrawn, and nothing tells anybody.
 * Pulling from a ref by script means a redraw upstream reaches this app on the next sync and shows
 * up in review as bytes that changed.
 *
 * ── THIS APP TAKES ALL SIX ICONS, THE WEBSITE TAKES FOUR ──
 * `public/site.webmanifest` declares both maskable variants, because this is the installable
 * application. `openplate-website` deliberately serves neither. That difference is an allowlist
 * decision in each consumer, not a difference in the brand repository.
 *
 * ── HAND-RUN ONLY, DELIBERATELY NOT IN CI AND NOT IN THE PRE-PUSH GATE ──
 * `openplate-brand` is PRIVATE and this script clones it over SSH. Wiring the sync into CI or into
 * `.githooks/pre-push` would mean giving both a deploy credential for a private repository, to
 * fetch files that are already committed here. The committed output plus
 * `tests/unit/brand-assets.test.ts` is what the gate checks, and that needs no credential at all.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { z } from 'zod';

/**
 * SSH and not HTTPS, because `LowCarbCheck/openplate-brand` is PRIVATE: an anonymous HTTPS clone of
 * it answers 404, which reads like a deleted repository rather than a missing credential.
 */
const REPO = 'git@github.com:LowCarbCheck/openplate-brand.git';
const ENV_REPO = 'OPENPLATE_BRAND_REPO';
const ENV_REF = 'OPENPLATE_BRAND_REF';

/** Where the brand repository publishes, and the file that says what it published. */
const ASSETS_DIR = 'assets';
const MANIFEST = 'MANIFEST.json';

/**
 * Every icon this app serves, and the whole list of it. THIS is the allowlist the pruning below
 * enforces, so a file that is not named here does not reach `public/` and does not survive there.
 * Otherwise a renamed asset leaves its predecessor behind forever.
 */
interface Asset {
  /** The file's name in the brand repository's `assets/`, which is also its key in `MANIFEST.json`. */
  name: string;
  /** Where it lands, relative to `public/`. That relative path is also its key in `BRAND.json`. */
  to: string;
}

const ASSETS: Asset[] = [
  // The tab, and the one file a browser asks for by convention whether it is declared or not.
  { name: 'favicon.ico', to: 'favicon.ico' },
  // iOS home screen. Opaque on purpose: iOS composites a transparent one onto black.
  { name: 'apple-touch-icon.png', to: 'icons/apple-touch-icon.png' },
  { name: 'icon-192.png', to: 'icons/icon-192.png' },
  { name: 'icon-512.png', to: 'icons/icon-512.png' },
  // Both maskable variants, because `public/site.webmanifest` declares both.
  { name: 'icon-maskable-192.png', to: 'icons/icon-maskable-192.png' },
  { name: 'icon-maskable-512.png', to: 'icons/icon-maskable-512.png' },
];

const PUBLIC_DIR = resolve('public');
/** The directory the pruning owns. `public/favicon.ico` sits outside it and is only ever replaced. */
const ICONS_DIR = join(PUBLIC_DIR, 'icons');
/** The provenance this run leaves behind, and the file `tests/unit/brand-assets.test.ts` reads. */
const PROVENANCE = join(ICONS_DIR, 'BRAND.json');

/**
 * `MANIFEST.json` as the brand repository writes it. Decoded rather than assumed: the sha256 values
 * below are the whole argument that this app received what the brand repository published, so a
 * manifest whose shape moved has to fail here and not silently verify nothing.
 */
const ManifestSchema = z.object({
  producedBy: z.string(),
  markTeal: z.string(),
  assets: z.record(z.string(), z.object({ sha256: z.string() })),
});

function fail(message: string): never {
  console.error(`sync-brand: ${message}`);
  process.exit(1);
}

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `v1.2.3` as three numbers, or `null` for anything that is not a plain release tag. */
function version(tag: string): [number, number, number] | null {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * The highest semver tag the repository has, by SORTING the tags rather than asking which release
 * was published most recently. A hotfix on an old line is published after a new major and is not
 * the newest version.
 */
function highestTag(repo: string): string | null {
  const tags = git(['ls-remote', '--tags', '--refs', repo])
    .split('\n')
    .flatMap((line) => {
      const tag = /refs\/tags\/(?<tag>\S+)$/.exec(line)?.groups?.['tag'];
      return tag !== undefined && version(tag) !== null ? [tag] : [];
    })
    .toSorted((a, b) => {
      const [x, y] = [version(a) ?? [0, 0, 0], version(b) ?? [0, 0, 0]];
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    });
  return tags[0] ?? null;
}

/**
 * A shallow checkout of one ref. `git clone --branch` takes a branch or a tag and FAILS on a commit
 * id, and a commit id is exactly what somebody names when they are checking a claim: re-syncing at
 * the sha the committed `BRAND.json` already records is the only honest way to ask whether this
 * tree reproduces from the commit it says it came from.
 */
function cloneAt(repo: string, ref: string, dir: string): void {
  if (!/^[0-9a-f]{40}$/.test(ref)) {
    execFileSync('git', ['clone', '--depth', '1', '--branch', ref, repo, dir], { stdio: 'inherit' });
    return;
  }
  execFileSync('git', ['init', '--quiet', dir], { stdio: 'inherit' });
  execFileSync('git', ['remote', 'add', 'origin', repo], { cwd: dir, stdio: 'inherit' });
  execFileSync('git', ['fetch', '--depth', '1', '--quiet', 'origin', ref], { cwd: dir, stdio: 'inherit' });
  execFileSync('git', ['checkout', '--quiet', 'FETCH_HEAD'], { cwd: dir, stdio: 'inherit' });
}

interface Tree {
  dir: string;
  /** Whether this directory is ours to delete afterwards. */
  scratch: boolean;
  /** What the run copies from, for the log line and for `BRAND.json`. */
  ref: string;
  /** The commit that ref resolved to, which is the fact a person can re-sync against. */
  commit: string;
}

/**
 * The brand repository's tree, at the ref this run copies from.
 *
 * A local checkout named by `OPENPLATE_BRAND_REPO` with NO ref pinned is READ WHERE IT STANDS. The
 * override exists for the case where the mark you want is on the branch in front of you and in no
 * tag yet. Pin a ref and it always clones, even when the repository is a sibling directory.
 */
function brandTree(): Tree {
  const repo = process.env[ENV_REPO] ?? REPO;
  const pinned = process.env[ENV_REF] ?? '';
  const local = existsSync(join(repo, '.git'));

  if (local && pinned === '') {
    const dir = resolve(repo);
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
    console.log(`sync-brand: reading the checkout at ${dir} (${branch})`);
    return { dir, scratch: false, ref: branch, commit: git(['rev-parse', 'HEAD'], dir) };
  }

  const ref = pinned === '' ? (highestTag(repo) ?? fail(`${repo} has no vX.Y.Z tag to copy from.`)) : pinned;
  const dir = mkdtempSync(join(tmpdir(), 'openplate-brand-'));
  console.log(`sync-brand: cloning ${repo} at ${ref}`);
  cloneAt(repo, ref, dir);
  return { dir, scratch: true, ref, commit: git(['rev-parse', 'HEAD'], dir) };
}

/**
 * Everything under `public/icons/` that the allowlist above no longer names, gone.
 *
 * Runs LAST, after every copy has succeeded, so a sync that failed upstream leaves the icons this
 * app is currently serving exactly where they were. A half-pruned `public/` is an app with no mark,
 * which is worse than an app with a stale one. `BRAND.json` is kept because this run writes it.
 */
function prune(kept: Set<string>): string[] {
  if (!existsSync(ICONS_DIR)) return [];
  const removed: string[] = [];
  for (const entry of readdirSync(ICONS_DIR)) {
    const file = join(ICONS_DIR, entry);
    if (kept.has(file)) continue;
    rmSync(file, { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}

const tree = brandTree();
try {
  const manifestPath = join(tree.dir, ASSETS_DIR, MANIFEST);
  if (!existsSync(manifestPath)) {
    fail(`the brand repository at ${tree.ref} has no ${ASSETS_DIR}/${MANIFEST}. Is this ref before it existed?`);
  }
  const manifest = ManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));

  // Read the whole allowlist before writing any of it. A missing file is a fault in the pairing
  // between the two repositories, and the person fixing it wants the list, not the first one.
  const missing = ASSETS.filter((asset) => !existsSync(join(tree.dir, ASSETS_DIR, asset.name)));
  if (missing.length > 0) {
    fail(
      `the brand repository at ${tree.ref} does not have ${missing.map((a) => `${ASSETS_DIR}/${a.name}`).join(', ')}. ` +
        `Either the asset was renamed upstream, or this ref predates it.`,
    );
  }

  // ── VERIFY EVERY BYTE BEFORE WRITING ANY OF THEM ──
  // The brand repository publishes a sha256 per asset precisely so a consumer can prove what it
  // received rather than trust that a file with the right name is the right file. Hashing here,
  // then writing the buffers that were hashed, means the bytes proved are the bytes landed.
  const loaded = ASSETS.map((asset) => {
    const bytes = readFileSync(join(tree.dir, ASSETS_DIR, asset.name));
    return { asset, bytes, sha256: sha256(bytes) };
  });
  const wrong = loaded.flatMap((file) => {
    const expected = manifest.assets[file.asset.name]?.sha256;
    if (expected === undefined) return [`${file.asset.name} is not named in ${MANIFEST}`];
    if (expected !== file.sha256) return [`${file.asset.name} is ${file.sha256}, ${MANIFEST} says ${expected}`];
    return [];
  });
  if (wrong.length > 0) {
    fail(
      `${wrong.length} of ${ASSETS.length} assets disagree with ${MANIFEST} at ${tree.ref}:\n  ${wrong.join('\n  ')}\n` +
        `Nothing was copied. Run \`pnpm check\` in openplate-brand: its assets/ is generated and must not be hand-edited.`,
    );
  }

  const kept = new Set<string>([PROVENANCE]);
  for (const file of loaded) {
    const target = join(PUBLIC_DIR, file.asset.to);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.bytes);
    kept.add(target);
  }

  // ── THE PROVENANCE IS WHAT MAKES THE DRIFT TEST POSSIBLE ──
  // Committed beside the icons, it records where this set came from and what each file hashed to.
  // `tests/unit/brand-assets.test.ts` re-hashes `public/` against it on every push, so a hand-edited
  // or hand-replaced icon fails the local gate instead of shipping.
  mkdirSync(ICONS_DIR, { recursive: true });
  writeFileSync(
    PROVENANCE,
    `${JSON.stringify(
      {
        note: 'Written by `pnpm sync:brand`. Do not hand-edit, and do not hand-edit the icons it names.',
        repo: process.env[ENV_REPO] ?? REPO,
        ref: tree.ref,
        commit: tree.commit,
        producedBy: manifest.producedBy,
        markTeal: manifest.markTeal,
        files: Object.fromEntries(loaded.map((file) => [file.asset.to, file.sha256])),
      },
      null,
      2,
    )}\n`,
  );

  const removed = prune(kept);
  console.log(`sync-brand: ${ASSETS.length} assets at ${tree.ref} (${tree.commit.slice(0, 12)}), sha256 verified`);
  for (const file of loaded) console.log(`sync-brand:   public/${file.asset.to}  ${file.sha256}`);
  console.log(`sync-brand: wrote public/icons/${basename(PROVENANCE)}`);
  if (removed.length > 0) console.log(`sync-brand: pruned ${removed.join(', ')}`);
} finally {
  if (tree.scratch) rmSync(tree.dir, { recursive: true, force: true });
}
