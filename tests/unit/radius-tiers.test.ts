/**
 * The shape ladder holds: nothing under `app/` draws 12 px or 16 px unless this file says so.
 *
 * WHY A SOURCE GUARD AND NOT A RENDER. One radius used to mean everything, and the way it got
 * that way was one class at a time: a new panel copied the panel above it, which had copied the
 * card. No browser check can see that, because each of those screens looked fine on its own. What
 * broke was the RELATION between screens, and the relation lives in the source. So the ladder is
 * defended where it is written: every `rounded-xl` and `rounded-2xl` in the app is either gone or
 * listed below with the tier it belongs to and what the object IS.
 *
 * THE TIER TABLE IS IN `tests/design-contract.ts`, with the five steps and what each one means.
 * This file only says which sites are still allowed to stand on the top two.
 *
 * WHAT A FAILURE MEANS. A new unlisted site is almost always a copied class list, and the fix is
 * to pick the tier for what the thing IS, not to add a line here. A line here is for a real
 * exception, and it has to say why in a sentence.
 *
 * ── HOW THE TOKENS ARE READ ──
 * `markup.includes('rounded-xl')` is not good enough in either direction: it does not fire on
 * `md:peer-data-[variant=inset]:rounded-xl`, which is the same radius behind a variant, and it
 * fires on nothing at all in a comment that merely mentions the class. So comments are stripped
 * first, and then the two utilities are matched with a word boundary on both sides, which catches
 * a variant-prefixed one (`sm:rounded-2xl`) and leaves a different utility alone
 * (`rounded-t-2xl`, the sheets' top corners, is not `rounded-2xl`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RADIUS_TIER_CLASS, type RadiusTier } from '../design-contract';

/** The app source root, as an absolute path. */
const APP_DIR = fileURLToPath(new URL('../../app', import.meta.url));

/** The two steps a site has to earn. Everything below them is unremarkable and is not scanned. */
const GUARDED_CLASSES = [RADIUS_TIER_CLASS.tile, RADIUS_TIER_CLASS.hero] as const;
type GuardedClass = (typeof GUARDED_CLASSES)[number];

/** One site that is allowed to keep its radius, and the reason it is. */
interface AllowedSite {
  /** The path under `app/`, with forward slashes. */
  file: string;
  /** The tier the object belongs to, which decides the class it may carry. */
  tier: Extract<RadiusTier, 'tile' | 'hero'>;
  /** How many times that class appears in the file. A new one in the same file fails. */
  count: number;
  /** What the object IS, in a sentence. */
  why: string;
}

/**
 * THE ALLOWLIST. Eleven sites, after the M243 spec 03 inventory moved every card, inset, panel,
 * notice, row, composer, field and focus ring onto the steps below.
 */
const ALLOWED: readonly AllowedSite[] = [
  {
    file: 'components/app-loading.tsx',
    tier: 'hero',
    count: 1,
    why: 'The product mark on the boot screen. It is the only thing on that screen, so it is that screen\'s hero, and an app icon is drawn at the platform\'s own corner rather than a card\'s.',
  },
  {
    file: 'components/ui/alert-dialog.tsx',
    tier: 'hero',
    count: 1,
    why: 'The confirm dialog. A dialog is a surface ON TOP of the page that stops everything else, and it shares the step with the bottom sheets, which draw `rounded-t-2xl`.',
  },
  {
    file: 'components/trends/weekly-recap-card.tsx',
    tier: 'hero',
    count: 1,
    why: 'The one hero on the trends overview, on `.surface-brand`. M243 spec 04 owns the hero surface.',
  },
  {
    file: 'routes/dashboard.tsx',
    tier: 'hero',
    count: 1,
    why: 'The one hero on `/dashboard`, on `.surface-brand`. M243 spec 04 owns the hero surface.',
  },
  {
    file: 'routes/diary.tsx',
    tier: 'hero',
    count: 1,
    why: 'The one hero on `/diary`, on `.surface-brand`. M243 spec 04 owns the hero surface.',
  },
  {
    file: 'routes/fasting.tsx',
    tier: 'hero',
    count: 1,
    why: 'The one hero on `/fasting`, on `.surface-brand`. M243 spec 04 owns the hero surface.',
  },
  {
    file: 'routes/nutrients.tsx',
    tier: 'hero',
    count: 1,
    why: 'The one hero on `/nutrients`, on `.surface-brand`. M243 spec 04 owns the hero surface.',
  },
  {
    file: 'routes/dev.playground.tsx',
    tier: 'hero',
    count: 1,
    why: 'The hero specimen on the dev-only playground, which exists to show the hero recipe beside the others.',
  },
  {
    file: 'routes/index.tsx',
    tier: 'hero',
    count: 1,
    why: 'The landing screenshot frame, which the ladder names by hand: the page\'s one hero, on `.surface-brand`.',
  },
  {
    file: 'routes/index.tsx',
    tier: 'tile',
    count: 1,
    why: '`SHOT_FRAME`, the frame every product shot below the hero is drawn in. Several per page, one shape, which is what a tile is.',
  },
  {
    file: 'components/trends/stat-tile.tsx',
    tier: 'tile',
    count: 1,
    why: 'The stat tiles of the weight card and the range summary. A tile in a grid, which is the tier itself.',
  },
];

/**
 * Every `.ts` and `.tsx` file under a directory, recursively.
 *
 * @param dir - the directory to walk.
 * @returns absolute paths.
 */
function sourceFilesIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFilesIn(full));
      continue;
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(full);
  }
  return found;
}

/**
 * The source with its comments taken out, so a comment that names a class is not read as a use of
 * it. Block comments go first, then any line whose own content starts a comment or continues one
 * (` * ...`), which is every comment style this repo writes.
 *
 * @param source - the file's text.
 * @returns the text with comments blanked.
 */
export function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return withoutBlocks
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      return trimmed.startsWith('//') || trimmed.startsWith('*') ? '' : line;
    })
    .join('\n');
}

/**
 * How many times a radius utility is used as a whole class token.
 *
 * @param source - the file's text, comments and all.
 * @param className - `rounded-xl` or `rounded-2xl`.
 * @returns the number of uses.
 */
export function countRadiusUses({ source, className }: { source: string; className: GuardedClass }): number {
  const pattern = new RegExp(`(?<![A-Za-z0-9_-])${className}(?![A-Za-z0-9_-])`, 'gu');
  return [...stripComments(source).matchAll(pattern)].length;
}

/** A use the allowlist does not account for, or an allowlist line no use matches. */
interface Mismatch {
  file: string;
  className: GuardedClass;
  found: number;
  allowed: number;
}

/**
 * Compares what the tree draws against what the allowlist permits.
 *
 * @param files - the sources to read, as [path relative to `app/`, text] pairs.
 * @param allowed - the allowlist to judge them by.
 * @returns every file and class where the counts disagree.
 */
export function findMismatches({
  files,
  allowed,
}: {
  files: readonly (readonly [string, string])[];
  allowed: readonly AllowedSite[];
}): Mismatch[] {
  const mismatches: Mismatch[] = [];
  const seen = new Set<string>();
  for (const [file, source] of files) {
    for (const className of GUARDED_CLASSES) {
      const found = countRadiusUses({ source, className });
      const permitted = allowed
        .filter((site) => site.file === file && RADIUS_TIER_CLASS[site.tier] === className)
        .reduce((total, site) => total + site.count, 0);
      if (found !== permitted) mismatches.push({ file, className, found, allowed: permitted });
      if (permitted > 0) seen.add(`${file} ${className}`);
    }
  }
  // An allowlist line for a file that no longer exists, or for a class it no longer draws, is a
  // line that would quietly permit a future site. It fails here rather than rotting.
  for (const site of allowed) {
    const key = `${site.file} ${RADIUS_TIER_CLASS[site.tier]}`;
    if (!seen.has(key)) {
      mismatches.push({ file: site.file, className: RADIUS_TIER_CLASS[site.tier], found: 0, allowed: site.count });
    }
  }
  return mismatches;
}

/** The whole app tree, read once. */
const APP_SOURCES: readonly (readonly [string, string])[] = sourceFilesIn(APP_DIR).map(
  (path) => [relative(APP_DIR, path).split('\\').join('/'), readFileSync(path, 'utf8')] as const,
);

describe('the shape ladder', () => {
  it('has a tree to read, so the guard is not a claim about nothing', () => {
    assert.ok(APP_SOURCES.length > 200, `expected the whole app tree, read ${APP_SOURCES.length} files`);
  });

  it('draws 12px and 16px only where the allowlist says, and only as often', () => {
    const mismatches = findMismatches({ files: APP_SOURCES, allowed: ALLOWED });
    assert.deepEqual(
      mismatches.map((row) => `${row.file}: ${row.found} x ${row.className}, allowlist permits ${row.allowed}`),
      [],
    );
  });

  it('every allowlist line names a real tier and says why', () => {
    for (const site of ALLOWED) {
      assert.ok(site.tier === 'tile' || site.tier === 'hero', `${site.file}: an allowlist tier must be tile or hero`);
      assert.ok(site.count >= 1, `${site.file}: a line that permits nothing is dead`);
      assert.ok(site.why.length > 40, `${site.file}: an exception has to say what the object is`);
    }
  });

  it('CONTROL: an unlisted site fails, a variant-prefixed one fails, and a comment does not', () => {
    // An ordinary new 16px panel in a file nobody listed.
    const unlisted = findMismatches({
      files: [['components/a-new-panel.tsx', '<div className="rounded-2xl border bg-card" />']],
      allowed: ALLOWED,
    });
    assert.equal(unlisted.length > 0, true, 'an unlisted rounded-2xl must be reported');
    assert.equal(unlisted[0]?.file, 'components/a-new-panel.tsx');

    // A SECOND one in a listed file, which a per-file "is it allowed at all" check would miss.
    const twoInOne = findMismatches({
      files: [['components/app-loading.tsx', '<img className="rounded-2xl" /><div className="rounded-2xl" />']],
      allowed: ALLOWED,
    });
    assert.equal(twoInOne.length > 0, true, 'a second use in an allowed file must be reported');

    // Behind a variant, which is the same radius on a wider screen.
    assert.equal(
      countRadiusUses({ source: '<div className="md:peer-data-[open]:rounded-xl" />', className: 'rounded-xl' }),
      1,
      'a variant-prefixed radius is still that radius',
    );

    // A comment that names the class is not a use of it, in all three comment styles.
    assert.equal(
      countRadiusUses({ source: '// it used to be rounded-2xl\n * or rounded-2xl\n', className: 'rounded-2xl' }),
      0,
      'a comment must not count as a use',
    );
    assert.equal(
      countRadiusUses({ source: '/* rounded-2xl was here */\nconst a = 1;\n', className: 'rounded-2xl' }),
      0,
      'a block comment must not count as a use',
    );
    // ...and the same reader still sees the class one line later, so "strip everything" would fail.
    assert.equal(
      countRadiusUses({ source: '/* rounded-2xl was here */\n<div className="rounded-2xl" />\n', className: 'rounded-2xl' }),
      1,
      'the reader must still see a real use beside a comment',
    );

    // A different utility that merely contains the letters is not a match, in either direction.
    assert.equal(
      countRadiusUses({ source: '<div className="rounded-t-2xl" />', className: 'rounded-2xl' }),
      0,
      'the sheets\' top corners are a different utility',
    );
    assert.equal(
      countRadiusUses({ source: '<div className="rounded-lg sm:rounded-lg" />', className: 'rounded-xl' }),
      0,
      'the card step is not the tile step',
    );
  });

  it('CONTROL: the allowlist itself fails when it names a site that is gone', () => {
    const stale = findMismatches({
      files: [['components/app-loading.tsx', '<img className="rounded-2xl" />']],
      allowed: [
        ...ALLOWED.filter((site) => site.file === 'components/app-loading.tsx'),
        {
          file: 'components/deleted-thing.tsx',
          tier: 'hero',
          count: 1,
          why: 'A line for a file that no longer exists, which must be reported rather than left to permit a future site.',
        },
      ],
    });
    assert.deepEqual(
      stale.map((row) => row.file),
      ['components/deleted-thing.tsx'],
    );
  });
});
