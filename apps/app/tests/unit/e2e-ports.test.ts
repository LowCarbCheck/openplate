/**
 * ONE CHECKOUT, ONE TRIPLE OF PORTS.
 *
 * ── WHAT THIS GUARDS ─────────────────────────────────────────────────────
 *
 * The browser tier used to bind 5297, 5298 and 5299, the same three numbers in
 * every clone and every worktree of this repository on a host, so two trees
 * running it at once collided on all three and one of them hung. `env.ts` now
 * derives a base from the real path of the checkout it belongs to, and the
 * three ports are that base and the next two numbers up. ADR-0017 records the
 * decision.
 *
 * The derivation is a pure function of a path plus an optional override, and it
 * has to stay one: `playwright.config.ts` is evaluated in the runner AND in
 * every worker process, and each of them recomputes this. An answer that
 * differed between two of those processes would put the specs on one port and
 * the server on another.
 *
 * ── EVERY CASE CARRIES ITS CONTROL ───────────────────────────────────────
 *
 * Most of the claims here are satisfied by a derivation that ignores its input
 * and returns a constant. So each one is paired with a check that the same
 * assertion goes RED against such a derivation, or against the literals this
 * change removed. The distinctness case is the clearest: 200 synthetic roots
 * measured 197 distinct bases on the day this was written, comfortably over the
 * 190 floor asserted below, and the same measurement against a path-blind
 * derivation gives 1. The three that shared a base are the residual risk
 * ADR-0017 records, about 1 in 7000 per pair, and `OPENPLATE_E2E_PORT_BASE` is
 * the way out of it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  canonicalRepoRoot,
  deriveE2ePortBase,
  E2E_APP_PORT,
  E2E_APP_URL,
  E2E_FOOD_DB_PORT,
  E2E_FOOD_DB_URL,
  E2E_PORT_BASE,
  E2E_PORT_BASE_VAR,
  E2E_SYNC_PORT,
  E2E_SYNC_SERVER_URL,
} from '../e2e/env';

/** The lowest base the derivation may produce. */
const PORT_BASE_FLOOR = 10_000;

/** The highest port any of the three may be. */
const PORT_CEILING = 31_001;

/**
 * Ports this derivation must never hand out.
 *
 * 5297 to 5299 are the literals it replaced, still held by any checkout running
 * an older revision of this tier. 5433 is the shared local Postgres every
 * project on this host talks to.
 */
const RESERVED_PORTS = new Set([5297, 5298, 5299, 5433]);

/** How many synthetic roots the distinctness case measures. */
const SYNTHETIC_ROOT_COUNT = 200;

/** How many of those must land on different bases. */
const DISTINCT_BASE_FLOOR = 190;

/** The three ports a base stands for. */
function tripleFrom(base: number): readonly number[] {
  return [base, base + 1, base + 2];
}

/** Whether a base's triple would step on a port something else on this host owns. */
function collidesWithReserved(base: number): boolean {
  return tripleFrom(base).some((port) => RESERVED_PORTS.has(port));
}

/** Whether a base's triple sits inside the range this tier claims. */
function withinRange(base: number): boolean {
  return base >= PORT_BASE_FLOOR && base + 2 <= PORT_CEILING;
}

/** Absolute paths that do not exist, so nothing here touches the file system. */
function syntheticRoots(count: number): readonly string[] {
  return Array.from({ length: count }, (_unused, index) => `/synthetic/openplate-checkouts/tree-${index}`);
}

/** How many different bases a derivation gives for a set of roots. */
function countDistinctBases(roots: readonly string[], derive: (root: string) => number): number {
  return new Set(roots.map(derive)).size;
}

/** The real derivation, as a one-argument function the counter above can take. */
function baseFor(root: string): number {
  return deriveE2ePortBase({ repoRoot: root });
}

/** A derivation that ignores its input. Every control below is measured against it. */
function pathBlindBase(): number {
  return PORT_BASE_FLOOR;
}

describe('the port base a checkout derives', () => {
  it('is the same number every time for one path', () => {
    const root = '/synthetic/openplate-checkouts/steady';
    const first = baseFor(root);

    assert.equal(baseFor(root), first, 'a second call on the same path must give the same base');
    assert.equal(baseFor(`${root}/`), first, 'a trailing slash is the same directory and must not move the base');

    // THE CONTROL. Equality on its own is satisfied by a constant, so a second
    // path has to move the answer for the case above to mean anything.
    assert.notEqual(baseFor('/synthetic/openplate-checkouts/other'), first, 'a different path must give another base');
  });

  it('stays inside the range this tier claims', () => {
    for (const root of syntheticRoots(SYNTHETIC_ROOT_COUNT)) {
      const base = baseFor(root);
      assert.ok(withinRange(base), `${root} derived ${base}, which is outside ${PORT_BASE_FLOOR} to ${PORT_CEILING}`);
      assert.ok(Number.isInteger(base), `${root} derived ${base}, which is not a whole port number`);
    }
    assert.ok(withinRange(E2E_PORT_BASE), `this checkout derived ${E2E_PORT_BASE}, outside the range`);

    // THE CONTROL. `withinRange` has to be able to say no, or the loop above
    // passes against any number at all.
    assert.equal(withinRange(PORT_BASE_FLOOR - 1), false, 'a base below the floor must be refused');
    assert.equal(withinRange(PORT_CEILING - 1), false, 'a base whose third port overshoots must be refused');
  });

  it('never lands on the literals it replaced or on the shared Postgres', () => {
    for (const root of syntheticRoots(SYNTHETIC_ROOT_COUNT)) {
      assert.equal(collidesWithReserved(baseFor(root)), false, `${root} derived a triple over a reserved port`);
    }
    assert.equal(collidesWithReserved(E2E_PORT_BASE), false, 'this checkout derived a triple over a reserved port');

    // THE CONTROL. These are the two bases the assertion above exists to
    // refuse: the old literal triple, and a triple that would swallow 5433.
    assert.ok(collidesWithReserved(5297), 'the replaced literal base must read as a collision');
    assert.ok(collidesWithReserved(5431), 'a base whose triple reaches the shared Postgres must read as a collision');
  });

  it('spreads 200 different checkouts across at least 190 different bases', () => {
    const roots = syntheticRoots(SYNTHETIC_ROOT_COUNT);
    const distinct = countDistinctBases(roots, baseFor);

    assert.ok(
      distinct >= DISTINCT_BASE_FLOOR,
      `${SYNTHETIC_ROOT_COUNT} roots produced only ${distinct} distinct bases, under the ${DISTINCT_BASE_FLOOR} floor`,
    );

    // THE CONTROL. The same measurement against a derivation that ignores the
    // path gives 1, so the floor above is a threshold this case can fail.
    const blind = countDistinctBases(roots, pathBlindBase);
    assert.equal(blind, 1, 'a path-blind derivation must give one base for every root');
    assert.ok(blind < DISTINCT_BASE_FLOOR, 'the floor must be a threshold a path-blind derivation fails');
  });

  it('gives one base for a symlink and for the directory it points at', () => {
    const scratch = mkdtempSync(join(canonicalRepoRoot(tmpdir()), 'openplate-port-base-'));
    try {
      const target = join(scratch, 'checkout');
      const link = join(scratch, 'link-to-checkout');
      mkdirSync(target);
      symlinkSync(target, link);

      assert.equal(
        deriveE2ePortBase({ repoRoot: canonicalRepoRoot(link) }),
        deriveE2ePortBase({ repoRoot: canonicalRepoRoot(target) }),
        'two names for one directory must derive one base',
      );

      // THE CONTROL. Without `canonicalRepoRoot` the two names are two
      // different strings and derive two different bases, which is what makes
      // the resolution above load bearing rather than incidental.
      assert.notEqual(
        deriveE2ePortBase({ repoRoot: link }),
        deriveE2ePortBase({ repoRoot: target }),
        'the unresolved names must differ, or the case above proves nothing',
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe(`the ${E2E_PORT_BASE_VAR} override`, () => {
  it('wins over the derivation', () => {
    const root = '/synthetic/openplate-checkouts/overridden';
    const natural = baseFor(root);
    const wanted = natural === 20_000 ? 20_003 : 20_000;

    assert.equal(deriveE2ePortBase({ repoRoot: root, override: String(wanted) }), wanted, 'the override must win');
    assert.equal(deriveE2ePortBase({ repoRoot: root, override: ` ${wanted} ` }), wanted, 'a padded value is read');

    // THE CONTROL. The override only means something if the derivation would
    // otherwise have answered differently.
    assert.notEqual(natural, wanted, 'the derivation must not already give the overridden value');
  });

  it('is ignored when it is set but empty, so an exported blank does not move the ports', () => {
    const root = '/synthetic/openplate-checkouts/blank-override';

    assert.equal(deriveE2ePortBase({ repoRoot: root, override: '' }), baseFor(root), 'an empty value falls back');
    assert.equal(deriveE2ePortBase({ repoRoot: root, override: '   ' }), baseFor(root), 'whitespace falls back too');
  });

  it('refuses a value that is not three usable ports, in a sentence naming the variable', () => {
    const root = '/synthetic/openplate-checkouts/bad-override';
    const refused = ['abc', '12.5', '-1', '80', '1023', '65534', '1e4', '0x2710'];

    for (const override of refused) {
      assert.throws(
        () => deriveE2ePortBase({ repoRoot: root, override }),
        (cause: unknown) => {
          assert.ok(cause instanceof Error, `${override} must be refused with an Error`);
          assert.match(cause.message, new RegExp(E2E_PORT_BASE_VAR), 'the sentence must name the variable');
          assert.match(cause.message, /whole number/, 'the sentence must say what a usable value looks like');
          return true;
        },
        `${override} must not be accepted as a port base`,
      );
    }

    // THE CONTROL. A guard that threw on everything would pass the loop above
    // and break every run that sets the variable for a good reason.
    assert.equal(deriveE2ePortBase({ repoRoot: root, override: '1024' }), 1_024, 'the lowest usable base is taken');
    assert.equal(deriveE2ePortBase({ repoRoot: root, override: '65533' }), 65_533, 'the highest usable base is taken');
  });
});

describe("this checkout's three ports", () => {
  it('are the base and the next two numbers up, in the order the tier expects', () => {
    assert.equal(E2E_FOOD_DB_PORT, E2E_PORT_BASE, 'the food database takes the base');
    assert.equal(E2E_SYNC_PORT, E2E_PORT_BASE + 1, 'the sync service takes the next one');
    assert.equal(E2E_APP_PORT, E2E_PORT_BASE + 2, 'the app server takes the one after that');

    // THE CONTROL. Three equalities to one base are also true of three equal
    // numbers, and three services cannot share a port.
    assert.equal(new Set([E2E_FOOD_DB_PORT, E2E_SYNC_PORT, E2E_APP_PORT]).size, 3, 'the three ports must differ');
  });

  it('are the ports the three URLs name', () => {
    assert.equal(E2E_FOOD_DB_URL, `http://127.0.0.1:${E2E_FOOD_DB_PORT}`, 'the food database URL follows its port');
    assert.equal(E2E_SYNC_SERVER_URL, `http://127.0.0.1:${E2E_SYNC_PORT}`, 'the sync URL follows its port');
    assert.equal(E2E_APP_URL, `http://127.0.0.1:${E2E_APP_PORT}`, 'the app URL follows its port');

    // THE CONTROL. A URL built from the wrong constant would still be a URL, so
    // the port in each one has to be this checkout's and not a literal.
    assert.equal(E2E_APP_URL.endsWith(':5299'), false, 'no URL may carry the literal this change removed');
  });
});
