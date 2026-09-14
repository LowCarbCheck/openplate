/**
 * The vendored translator, against the provenance the sync left behind, M229 spec 02.
 *
 * `scripts/lib/translate.ts`, `translate-ui.ts` and `translate-language.ts` are copies of
 * `openplate-website`'s, written by `pnpm sync:translate-lib` and by nothing else. The spec's
 * worry is that a copy edited in place becomes a second client in substance, one convenient fix at
 * a time, and no diff ever says so. This is the check that says so: it re-hashes every vendored
 * file against `scripts/lib/TRANSLATE_SOURCE.json` and fails when a byte differs. Fix the library
 * in the website, then sync.
 *
 * It is the same shape as `brand-assets.test.ts`, and for the same reason: the committed
 * provenance is the fact under test, and refreshing it needs a checkout this test must not depend
 * on.
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

describe('TRANSLATE_SOURCE.json', () => {
  it('names the three files the sync vendors', () => {
    assert.deepEqual(Object.keys(provenance.files).toSorted(), [
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
    const text = readFileSync(resolve(ROOT, path), 'utf8');

    it(`${path} still hashes to what the sync wrote`, () => {
      assert.equal(
        sha256Of(text),
        expected.vendored,
        `${path} is not the file TRANSLATE_SOURCE.json records. The translator is not edited here: fix it in ` +
          `openplate-website (${expected.from}), then run \`pnpm sync:translate-lib\`.`,
      );
    });

    it(`${path} differs from its upstream only where the rewrite table says`, () => {
      const rewritten = provenance.rewrites.some((rewrite) => text.includes(`'${rewrite.to}'`));
      if (expected.upstream === expected.vendored) {
        assert.equal(rewritten, false, `${path} is byte-identical to upstream yet carries a rewritten import`);
        return;
      }
      assert.equal(rewritten, true, `${path} differs from upstream and none of the recorded rewrites explains it`);
    });

    it(`${path} imports nothing the provenance cannot account for`, () => {
      const unexplained = unexplainedImports(path, text);
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
  const text = readFileSync(resolve(ROOT, path), 'utf8');

  it('would fail on a one-character hand edit', () => {
    assert.notEqual(sha256Of(`${text} `), expected.vendored);
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
