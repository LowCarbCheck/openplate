/**
 * The vendored translator, against the provenance the sync left behind, M229 spec 02.
 *
 * `scripts/lib/translate.ts`, `translate-ui.ts`, `translate-language.ts` and `merge-memory.ts` are
 * copies of the ones in `LowCarbCheck/openplate-website`, written by `pnpm sync:translate-lib` and
 * by nothing else. The
 * spec's worry is that a copy edited in place becomes a second client in substance, one convenient
 * fix at a time, and no diff ever says so. This is the check that says so: it re-hashes every vendored
 * file against `scripts/lib/TRANSLATE_SOURCE.json` and fails when a byte differs. Fix the library
 * in the website, then sync.
 *
 * It is the same shape as `brand-assets.test.ts`, and for the same reason: the committed
 * provenance is the fact under test, and refreshing it needs a PRIVATE repository this test must
 * not depend on. It runs no git command and reads nothing outside this app. The `upstream` hashes
 * in the provenance are a record of what the sync read, checked here only for their shape: proving
 * them needs the website repository, and that is what a re-sync at the recorded `commit` is for.
 *
 * ── THE REWRITES ARE ASSERTED, NOT ONLY RECORDED ──
 * A rewrite is the one way a vendored file may differ from its upstream, so the test also proves
 * the record is complete: every import in a vendored file resolves to a node builtin, to another
 * vendored file, or to a shim named in the provenance's rewrite table. An import that resolves to
 * anything else is a hidden edit.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PROVENANCE = resolve(ROOT, 'scripts/lib/TRANSLATE_SOURCE.json');

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** `TRANSLATE_SOURCE.json` as the sync writes it, decoded so a moved shape fails here and not as an empty loop. */
const ProvenanceSchema = z.object({
  repo: z.literal('LowCarbCheck/openplate-website'),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  producedBy: z.literal('openplate, scripts/sync-translate-lib.ts'),
  rewrites: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })).min(1),
  files: z.record(z.string(), z.object({ from: z.string().min(1), upstream: Sha256, vendored: Sha256 })),
  shimmed: z.record(z.string(), Sha256),
});

const provenance = ProvenanceSchema.parse(JSON.parse(readFileSync(PROVENANCE, 'utf8')));

function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Every import specifier in a file, read the way the sync's rewriter reads them. */
function importsOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => /^(?:\s*(?:import\b[^']*|\}|export\s*\{[^}]*\}))\s+from\s+'([^']+)';?$/.exec(line)?.[1])
    .filter((specifier) => specifier !== undefined);
}

type Files = typeof provenance.files;

/** The working-tree bytes of a vendored file, or `null` when the file is not there. */
function readFromTree(path: string): string | null {
  const file = resolve(ROOT, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/**
 * What is wrong with the vendored files, one sentence each, empty when every file is present and
 * hashes to the `vendored` value the sync recorded. `read` is a parameter so the controls below can
 * feed this same function a damaged copy and watch it fail.
 */
function driftOf(options: { files: Files; read: (path: string) => string | null }): string[] {
  return Object.entries(options.files).flatMap(([path, expected]) => {
    const text = options.read(path);
    if (text === null) return [`${path} is listed in TRANSLATE_SOURCE.json and is missing`];
    const actual = sha256Of(text);
    if (actual === expected.vendored) return [];
    return [`${path} hashes to ${actual}, TRANSLATE_SOURCE.json records ${expected.vendored}`];
  });
}

describe('TRANSLATE_SOURCE.json', () => {
  it('names the four files the sync vendors', () => {
    assert.deepEqual(Object.keys(provenance.files).toSorted(), [
      'scripts/lib/merge-memory.ts',
      'scripts/lib/translate-language.ts',
      'scripts/lib/translate-ui.ts',
      'scripts/lib/translate.ts',
    ]);
  });

  it('names the two upstream modules the shims stand in for', () => {
    assert.deepEqual(Object.keys(provenance.shimmed).toSorted(), ['app/lib/docs-i18n.server.ts', 'app/lib/docs.ts']);
  });

  it('points every rewrite at a file that exists beside the vendored ones', () => {
    for (const rewrite of provenance.rewrites) {
      const target = resolve(ROOT, 'scripts/lib', `${rewrite.to}.ts`);
      assert.ok(existsSync(target), `${rewrite.from} is rewritten to ${rewrite.to}, and ${target} is not there`);
    }
  });
});

describe('the vendored translator', () => {
  for (const [path, expected] of Object.entries(provenance.files)) {
    it(`${path} is there and still hashes to what the sync wrote`, () => {
      assert.deepEqual(
        driftOf({ files: { [path]: expected }, read: readFromTree }),
        [],
        `The translator is not edited here: fix it in LowCarbCheck/openplate-website (${expected.from}), ` +
          'then run `pnpm sync:translate-lib`.',
      );
    });

    it(`${path} differs from its upstream only where the rewrite table says`, () => {
      const text = readFromTree(path) ?? '';
      const rewritten = provenance.rewrites.some((rewrite) => text.includes(`'${rewrite.to}'`));
      if (expected.upstream === expected.vendored) {
        assert.equal(rewritten, false, `${path} is byte-identical to upstream yet carries a rewritten import`);
        return;
      }
      assert.equal(rewritten, true, `${path} differs from upstream and none of the recorded rewrites explains it`);
    });

    it(`${path} imports nothing the provenance cannot account for`, () => {
      const unexplained = unexplainedImports(path, readFromTree(path) ?? '');
      assert.deepEqual(unexplained, [], `${path} imports from outside the vendored set: ${unexplained.join(', ')}`);
    });
  }
});

/** The imports of a vendored file that are neither a builtin, another vendored file, nor a recorded rewrite. */
function unexplainedImports(path: string, text: string): string[] {
  const vendored = new Set(Object.keys(provenance.files).map((entry) => resolve(ROOT, entry)));
  const shims = new Set(provenance.rewrites.map((rewrite) => rewrite.to));
  return importsOf(text).filter((specifier) => {
    if (specifier.startsWith('node:')) return false;
    if (shims.has(specifier)) return false;
    return !vendored.has(resolve(dirname(resolve(ROOT, path)), `${specifier}.ts`));
  });
}

describe('the checks themselves', () => {
  const [path, expected] = Object.entries(provenance.files)[0] ?? [];
  assert.ok(path !== undefined && expected !== undefined, 'the provenance names at least one file');
  const text = readFromTree(path) ?? '';

  it('passes on the committed tree, so the controls below are not failing for another reason', () => {
    assert.deepEqual(driftOf({ files: provenance.files, read: readFromTree }), []);
  });

  it('fails on a one-byte change in a vendored copy', () => {
    const flipped = `${text.slice(0, -1)}${text.endsWith('x') ? 'y' : 'x'}`;
    const drift = driftOf({ files: provenance.files, read: (file) => (file === path ? flipped : readFromTree(file)) });
    assert.equal(drift.length, 1);
    assert.ok(drift[0]?.startsWith(`${path} hashes to `), `drift names the file: ${drift[0]}`);
  });

  it('fails on a listed file that is missing', () => {
    const drift = driftOf({ files: provenance.files, read: (file) => (file === path ? null : readFromTree(file)) });
    assert.deepEqual(drift, [`${path} is listed in TRANSLATE_SOURCE.json and is missing`]);
  });

  it('would fail on an import the rewrite table does not know', () => {
    assert.deepEqual(unexplainedImports(path, `${text}\nimport { x } from '../../app/lib/docs';\n`), [
      '../../app/lib/docs',
    ]);
  });

  it('reads a multi-line import by its closing line', () => {
    assert.deepEqual(importsOf("import {\n  a,\n} from './translate';\nimport b from 'node:fs';"), [
      './translate',
      'node:fs',
    ]);
  });
});
