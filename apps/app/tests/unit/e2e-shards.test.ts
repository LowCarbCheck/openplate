/**
 * SEVERAL SHARDS OF ONE CHECKOUT SHARE NOTHING.
 *
 * ── WHAT THIS GUARDS ─────────────────────────────────────────────────────
 *
 * `scripts/e2e-sharded.sh` starts N Playwright processes of one checkout. Three things in the
 * browser tier were one-per-checkout, and each is separate per shard now:
 *
 *  - the three ports: shard i takes `base + 3 * (i - 1)` (`shardPortBase`), so the triples are
 *    adjacent and disjoint,
 *  - the fontconfig cache: every shard WIPES it in its global setup, so a shared directory is
 *    deleted under a sibling that is writing into it (`font-cache.ts`),
 *  - the shard's own number, which `OPENPLATE_E2E_SHARD` carries to both (`shard.ts`).
 *
 * The runner's control flow (exit codes, signals, the per-shard environment) is proved by
 * `scripts/test-e2e-sharded.sh`, which needs a shell; what a pure function can say is here.
 *
 * ── EVERY CASE CARRIES ITS CONTROL ───────────────────────────────────────
 *
 * "The triples are disjoint" is true of a plan that spaces shards ten thousand ports apart and
 * false of a plan that gives every shard the same base, and "no shard deletes a sibling's cache"
 * is true of a reset that does nothing. So each claim is paired with the same assertion run
 * against the shared-resource version it replaces, and that run must come out RED.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { E2E_PORT_BASE_VAR, canonicalRepoRoot, deriveE2ePortBase, planShardPortBases, shardPortBase } from '../e2e/env';
import {
  FONT_DIRS_VAR,
  addFontDirs,
  fontconfigCacheDirName,
  parseFontDirs,
  fontsConfPathFor,
  renameFontsConfCache,
  resetFontconfigCache,
  writeFontsConfFor,
} from '../e2e/font-cache';
import { E2E_RETRIES_VAR, E2E_SHARD_VAR, parseShardNumber, retriesFromEnv } from '../e2e/shard';

/** The three ports a base stands for. */
const PORTS_PER_SHARD = 3;

/** The highest port the kernel will not hand to somebody's outgoing socket. */
const EPHEMERAL_FLOOR = 32_768;

/** The highest base the derivation can produce: slot 6999 of 7000. */
const HIGHEST_DERIVED_BASE = 10_000 + 3 * 6_999;

/** How many shards the plan cases use: the runner's default ceiling. */
const SHARD_COUNT = 4;

/** `fonts.conf` as committed, the template every shard's copy is made from. */
const FONTS_CONF = readFileSync(new URL('../e2e/fonts.conf', import.meta.url), 'utf8');

/** The ports of one base, as a list. */
function portsOf(base: number): number[] {
  return Array.from({ length: PORTS_PER_SHARD }, (_unused, offset) => base + offset);
}

/** Whether any port appears in two of the triples. */
function triplesOverlap(bases: readonly number[]): boolean {
  const seen = new Set<number>();
  for (const base of bases) {
    for (const port of portsOf(base)) {
      if (seen.has(port)) return true;
      seen.add(port);
    }
  }
  return false;
}

/** The plan a runner that gave every shard the SAME base would make. The controls fail against it. */
function sharedBasePlan(options: { base: number; count: number }): number[] {
  return Array.from({ length: options.count }, () => options.base);
}

/** The first element of a list a case has already shown is not empty. */
function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) throw new Error('the list is empty');
  return head;
}

describe('the ports of a sharded run', () => {
  it('are disjoint triples, one per shard, whatever base the run starts from', () => {
    for (const base of [10_000, 12_345, 20_000, HIGHEST_DERIVED_BASE]) {
      const plan = planShardPortBases({ base, count: SHARD_COUNT });

      assert.equal(plan.length, SHARD_COUNT, `base ${base}: one base per shard`);
      assert.equal(first(plan), base, `base ${base}: shard 1 takes the base itself, like a run that is not sharded`);
      assert.equal(triplesOverlap(plan), false, `base ${base}: two shards share a port`);
    }

    // THE CONTROL. The overlap check has to be able to say yes.
    const shared = sharedBasePlan({ base: 20_000, count: SHARD_COUNT });
    assert.equal(triplesOverlap(shared), true, 'a plan that gives every shard one base must read as an overlap');
    assert.equal(triplesOverlap([20_000, 20_002]), true, 'a stride of two overlaps on the third port of the first');
  });

  it('step by three, so a shard sits exactly on the next derivation slot', () => {
    const plan = planShardPortBases({ base: 15_000, count: SHARD_COUNT });

    assert.deepEqual(plan, [15_000, 15_003, 15_006, 15_009]);
    assert.equal(shardPortBase({ base: 15_000, shard: 3 }), 15_006, 'shard 3 is two strides up');

    // THE CONTROL. A stride that is not three leaves the slot grid the derivation lives on.
    assert.notDeepEqual(plan, [15_000, 15_001, 15_002, 15_003], 'a stride of one is not the plan');
  });

  it('stay below the kernel ephemeral range even from the highest derived base', () => {
    const plan = planShardPortBases({ base: HIGHEST_DERIVED_BASE, count: SHARD_COUNT });
    const highestPort = Math.max(...plan.flatMap(portsOf));

    assert.ok(highestPort < EPHEMERAL_FLOOR, `four shards from the top slot reach ${highestPort}`);

    // THE CONTROL. The bound is a threshold a plan can cross: a base in the ephemeral range does.
    const crossing = Math.max(...planShardPortBases({ base: 32_760, count: SHARD_COUNT }).flatMap(portsOf));
    assert.ok(crossing >= EPHEMERAL_FLOOR, 'a plan started at 32760 must read as inside the ephemeral range');
  });

  it('follow the override: an exported base is shard 1, the rest come after it', () => {
    const root = '/synthetic/openplate-checkouts/sharded-override';
    const overridden = deriveE2ePortBase({ repoRoot: root, override: '24000' });

    assert.deepEqual(planShardPortBases({ base: overridden, count: 3 }), [24_000, 24_003, 24_006]);
    assert.notEqual(overridden, deriveE2ePortBase({ repoRoot: root }), 'the override must have moved the base');
  });

  it('refuse a shard that would run past the highest base, naming the variable', () => {
    assert.equal(shardPortBase({ base: 65_530, shard: 2 }), 65_533, 'the last base that still has three ports fits');
    assert.throws(
      () => shardPortBase({ base: 65_530, shard: 3 }),
      (cause: unknown) => {
        assert.ok(cause instanceof Error);
        assert.match(cause.message, new RegExp(E2E_PORT_BASE_VAR), 'the sentence names the variable');
        return true;
      },
      'a third shard from 65530 would take ports above 65535',
    );
    for (const shard of [0, -1, 1.5, Number.NaN]) {
      assert.throws(() => shardPortBase({ base: 20_000, shard }), /not a shard number/, `shard ${shard}`);
    }
    for (const count of [0, -2, 2.5]) {
      assert.throws(() => planShardPortBases({ base: 20_000, count }), /not a shard count/, `count ${count}`);
    }
  });
});

describe('the shard number', () => {
  it('reads as null when unset or blank, so a run that is not sharded stays what it was', () => {
    assert.equal(parseShardNumber(undefined), null);
    assert.equal(parseShardNumber(''), null);
    assert.equal(parseShardNumber('   '), null);

    // THE CONTROL. A parser that returned null for everything would pass the line above.
    assert.equal(parseShardNumber('1'), 1);
    assert.equal(parseShardNumber(' 3 '), 3);
  });

  it('refuses anything else that is not a whole number of 1 or more, naming the variable', () => {
    for (const raw of ['0', '-1', '1.5', '1e1', '0x2', 'two', '1/4']) {
      assert.throws(() => parseShardNumber(raw), new RegExp(E2E_SHARD_VAR), `${raw} must be refused`);
    }
  });
});

describe('the retry count', () => {
  it('reads as 0 when unset or empty, so the push gate keeps failing loudly', () => {
    assert.equal(retriesFromEnv(undefined), 0);
    assert.equal(retriesFromEnv(''), 0);

    // THE CONTROL. A parser that returned 0 for everything would pass the two lines above.
    assert.equal(retriesFromEnv('1'), 1);
    assert.equal(retriesFromEnv('3'), 3);
  });

  it('accepts an explicit 0 without throwing', () => {
    // THE CONTROL for the refusals below: a parser that threw on everything would pass them.
    assert.doesNotThrow(() => retriesFromEnv('0'));
    assert.equal(retriesFromEnv('0'), 0);
  });

  it('refuses anything that is not a whole number from 0 to 3, naming the variable and the value', () => {
    for (const raw of ['4', '-1', '1.5', 'one', ' 1']) {
      const named = new RegExp(`${E2E_RETRIES_VAR}=${raw.replace('.', '\\.')} is not a retry count`);
      assert.throws(() => retriesFromEnv(raw), named, `${JSON.stringify(raw)} must be refused`);
    }
  });
});

describe('the fontconfig cache of a sharded run', () => {
  const root = canonicalRepoRoot(new URL('../../', import.meta.url).pathname);
  const nameOf = (shard: number | null): string => fontconfigCacheDirName({ shard, repoRoot: root });

  it('has a directory name per shard, and the old name when the run is not sharded', () => {
    const names = Array.from({ length: SHARD_COUNT }, (_unused, index) => nameOf(index + 1));

    assert.equal(new Set(names).size, SHARD_COUNT, `shards share a cache directory: ${names.join(', ')}`);
    assert.equal(nameOf(null), 'openplate-e2e-fontconfig', 'a run that is not sharded keeps the name it always had');
    for (const name of names) {
      assert.notEqual(name, nameOf(null), 'a shard must not share the unsharded directory');
    }

    // THE CONTROL. A name that ignores the shard gives one directory for all of them.
    const shardBlind = new Set(Array.from({ length: SHARD_COUNT }, () => nameOf(null)));
    assert.equal(shardBlind.size, 1, 'a shard-blind name must collapse to one directory');
  });

  it('differs between two checkouts running the same shard', () => {
    const other = fontconfigCacheDirName({ shard: 1, repoRoot: '/synthetic/openplate-checkouts/other-tree' });

    assert.notEqual(other, nameOf(1), 'two checkouts must not wipe each other cache');
    assert.equal(nameOf(1), nameOf(1), 'but one checkout must get one name every time');
  });

  it('is renamed in a copy of fonts.conf and nowhere else in it', () => {
    const copy = renameFontsConfCache({ template: FONTS_CONF, cacheDirName: nameOf(2) });

    assert.ok(copy.includes(`<cachedir prefix="xdg">${nameOf(2)}</cachedir>`), 'the copy names the shard directory');
    assert.equal(
      copy.replace(nameOf(2), 'openplate-e2e-fontconfig'),
      FONTS_CONF,
      'the copy differs from the committed file in that one name only',
    );

    // THE CONTROL. A rename that changed nothing would pass the line above for an unsharded file.
    assert.notEqual(copy, FONTS_CONF, 'the copy must differ from the template');
  });

  it('refuses a template whose cache element is gone or doubled, because the two files drifted', () => {
    const element = '<cachedir prefix="xdg">openplate-e2e-fontconfig</cachedir>';

    assert.throws(
      () => renameFontsConfCache({ template: FONTS_CONF.replace(element, ''), cacheDirName: 'x' }),
      /exactly one/,
      'a template without the element cannot give a shard its own cache',
    );
    assert.throws(
      () => renameFontsConfCache({ template: `${FONTS_CONF}${element}`, cacheDirName: 'x' }),
      /exactly one/,
      'a template with the element twice is ambiguous',
    );
    assert.ok(FONTS_CONF.includes(element), 'the committed fonts.conf spells the element the way font-cache.ts does');
  });

  it('is written to a file per shard, whose text names that shard cache and no other', () => {
    // The files stay in the temp folder afterwards: they are named after their own bytes, so a
    // live run of this checkout reads the very same ones, and deleting them here would pull a
    // config out from under it.
    const paths = Array.from({ length: SHARD_COUNT }, (_unused, index) => writeFontsConfFor(index + 1));

    assert.equal(new Set(paths).size, SHARD_COUNT, 'every shard reads a different file');
    for (const [index, path] of paths.entries()) {
      assert.equal(path, fontsConfPathFor(index + 1), 'the path a reader computes is the one that was written');
      const text = readFileSync(path, 'utf8');
      assert.ok(text.includes(nameOf(index + 1)), `shard ${index + 1} names its own directory`);
      for (let other = 1; other <= SHARD_COUNT; other += 1) {
        if (other === index + 1) continue;
        assert.equal(text.includes(nameOf(other)), false, `shard ${index + 1} names the directory of shard ${other}`);
      }
    }
    assert.equal(writeFontsConfFor(null), fontsConfPathFor(null), 'a run that is not sharded reads the committed file');
  });
});

const dirsOf = (text: string): string[] =>
  [...text.matchAll(/^ {2}<dir>([^<]*)<\/dir>$/gm)].map((match) => match[1] ?? '');

describe('extra font directories from OPENPLATE_E2E_FONT_DIRS', () => {
  const committed = dirsOf(FONTS_CONF);

  it('leaves the committed text exactly as it is when there is nothing to add', () => {
    assert.equal(addFontDirs({ template: FONTS_CONF, dirs: parseFontDirs(undefined) }), FONTS_CONF);
    assert.equal(addFontDirs({ template: FONTS_CONF, dirs: parseFontDirs('') }), FONTS_CONF);
    assert.equal(addFontDirs({ template: FONTS_CONF, dirs: parseFontDirs(':') }), FONTS_CONF);
  });

  it('adds one dir element per entry, inside fontconfig, and keeps the cache element', () => {
    const copy = addFontDirs({
      template: FONTS_CONF,
      dirs: parseFontDirs('/nix/store/a/share/fonts:/nix/store/b/fonts'),
    });

    assert.deepEqual(dirsOf(copy), [...committed, '/nix/store/a/share/fonts', '/nix/store/b/fonts']);
    assert.ok(
      copy.indexOf('<dir>/nix/store/b/fonts</dir>') < copy.lastIndexOf('</fontconfig>'),
      'added before the close',
    );
    assert.ok(copy.includes('<cachedir prefix="xdg">openplate-e2e-fontconfig</cachedir>'));
    // THE CONTROL. A copy that added nothing would equal the template, and the line above would fail.
    assert.notEqual(copy, FONTS_CONF);
  });

  it('ignores an empty entry', () => {
    assert.deepEqual(parseFontDirs('/a::/b:'), ['/a', '/b']);
    const copy = addFontDirs({ template: FONTS_CONF, dirs: parseFontDirs('/a::/b:') });
    assert.deepEqual(dirsOf(copy), [...committed, '/a', '/b']);
    assert.equal(dirsOf(copy).includes(''), false);
  });

  it('refuses a template with no closing tag', () => {
    assert.throws(() => addFontDirs({ template: '<fontconfig>', dirs: ['/a'] }), /exactly one/);
  });

  it('is what a run reads when the variable is set, and the committed file when it is not', () => {
    const saved = process.env[FONT_DIRS_VAR];
    try {
      delete process.env[FONT_DIRS_VAR];
      assert.equal(writeFontsConfFor(null), fontsConfPathFor(null));
      assert.equal(fontsConfPathFor(null).endsWith('tests/e2e/fonts.conf'), true, 'unset reads the committed file');

      process.env[FONT_DIRS_VAR] = '/nix/store/x/share/fonts';
      const path = writeFontsConfFor(null);
      assert.notEqual(path.endsWith('tests/e2e/fonts.conf'), true, 'set reads a generated copy');
      assert.ok(readFileSync(path, 'utf8').includes('<dir>/nix/store/x/share/fonts</dir>'));
      const shardPath = writeFontsConfFor(1);
      const shardText = readFileSync(shardPath, 'utf8');
      assert.ok(shardText.includes('<dir>/nix/store/x/share/fonts</dir>'), 'a shard gets the directory too');
      assert.ok(shardText.includes('-s1</cachedir>'), 'and still its own cache');
    } finally {
      restoreEnv(FONT_DIRS_VAR, saved);
    }
  });
});

/** Puts one environment variable back as it was: deleted when it was unset. */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('a shard wiping its fontconfig cache', () => {
  /**
   * Runs `body` with the environment a shard's global setup sees, and puts the environment back.
   *
   * `resetFontconfigCache` reads `process.env`, because the real runner is one process per
   * shard; here several shards take turns in one, which is the same thing one at a time.
   */
  async function asShard(options: {
    shard: number | null;
    cacheHome: string;
    body: () => Promise<void>;
  }): Promise<void> {
    const saved = {
      shard: process.env[E2E_SHARD_VAR],
      fonts: process.env.FONTCONFIG_FILE,
      cache: process.env.XDG_CACHE_HOME,
    };
    if (options.shard === null) delete process.env[E2E_SHARD_VAR];
    else process.env[E2E_SHARD_VAR] = String(options.shard);
    process.env.FONTCONFIG_FILE = writeFontsConfFor(options.shard);
    process.env.XDG_CACHE_HOME = options.cacheHome;
    try {
      await options.body();
    } finally {
      restoreEnv(E2E_SHARD_VAR, saved.shard);
      restoreEnv('FONTCONFIG_FILE', saved.fonts);
      restoreEnv('XDG_CACHE_HOME', saved.cache);
    }
  }

  const root = canonicalRepoRoot(new URL('../../', import.meta.url).pathname);

  /** A file a shard has written into its own cache, and where it is. */
  function plantCanary(options: { cacheHome: string; shard: number | null }): string {
    const dir = join(options.cacheHome, fontconfigCacheDirName({ shard: options.shard, repoRoot: root }));
    mkdirSync(dir, { recursive: true });
    const canary = join(dir, 'cache-entry');
    writeFileSync(canary, 'written by a sibling');
    return canary;
  }

  it('leaves a sibling shard cache alone', async () => {
    const cacheHome = mkdtempSync(join(tmpdir(), 'openplate-shard-cache-'));
    try {
      const siblings = [2, 3, 4].map((shard) => plantCanary({ cacheHome, shard }));

      await asShard({ shard: 1, cacheHome, body: resetFontconfigCache });

      for (const canary of siblings) {
        assert.ok(existsSync(canary), `${canary} was deleted by shard 1: shards share a cache`);
      }
    } finally {
      rmSync(cacheHome, { recursive: true, force: true });
    }
  });

  it('does empty its own cache, and that is what the line above has to be told apart from', async () => {
    const cacheHome = mkdtempSync(join(tmpdir(), 'openplate-shard-cache-'));
    try {
      const own = plantCanary({ cacheHome, shard: 1 });

      await asShard({ shard: 1, cacheHome, body: resetFontconfigCache });

      assert.equal(existsSync(own), false, 'a shard that does not empty its own cache has a reset that does nothing');
      assert.ok(
        existsSync(join(cacheHome, fontconfigCacheDirName({ shard: 1, repoRoot: root }))),
        'and it recreates the directory, empty',
      );
    } finally {
      rmSync(cacheHome, { recursive: true, force: true });
    }
  });

  it('CONTROL: two runs that are not sharded share one directory and the second deletes the first', async () => {
    const cacheHome = mkdtempSync(join(tmpdir(), 'openplate-shard-cache-'));
    try {
      const shared = plantCanary({ cacheHome, shard: null });

      await asShard({ shard: null, cacheHome, body: resetFontconfigCache });

      assert.equal(existsSync(shared), false, 'the shared directory is wiped, which is the hazard shards remove');
    } finally {
      rmSync(cacheHome, { recursive: true, force: true });
    }
  });
});
