/**
 * THE SPEC HEADERS AND THE AREA TABLE STAY IN STEP.
 *
 * ── WHAT THIS GUARDS ─────────────────────────────────────────────────────
 *
 * The scoped push gate picks specs by the `@area` line in each spec's header. A spec with no area,
 * two areas or a misspelt one would be left out of every scoped run, and nothing red would say so.
 * This file reads the REAL `tests/e2e` folder, so a new spec that forgets its header fails here,
 * on the push that adds it, instead of at the nightly run a day later.
 *
 * The same checks run against a temp folder that is wrong on purpose (`readSpecMeta` must throw and
 * name the file), so "every spec has an area" cannot be true of a reader that never complains.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AREAS, PATH_RULES } from '../e2e/areas';
import { readSpecMeta } from '../e2e/spec-meta';

// Widened by assignment so `includes` takes any string, with no type assertion.
const AREA_NAMES: ReadonlyArray<string> = AREAS;
const E2E_DIR = fileURLToPath(new URL('../e2e', import.meta.url));

function withTempSpecs(files: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-areas-'));
  try {
    for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const header = (...lines: string[]): string =>
  `/**\n * A spec.\n *\n${lines.map((line) => ` * ${line}\n`).join('')} */\nimport '@playwright/test';\n`;

describe('the real spec folder', () => {
  const specs = readSpecMeta(E2E_DIR);

  it('reads at least one spec, so the checks below are not vacuous', () => {
    assert.ok(specs.length > 100, `only ${specs.length} specs read`);
  });

  it('gives every spec exactly one known area', () => {
    for (const spec of specs) assert.ok(AREA_NAMES.includes(spec.area), spec.path);
  });

  it('every area has at least one spec', () => {
    for (const area of AREAS)
      assert.ok(
        specs.some((spec) => spec.area === area),
        `no spec in ${area}`,
      );
  });

  it('keeps the smoke set between 8 and 12 specs', () => {
    const smoke = specs.filter((spec) => spec.smoke);
    assert.ok(
      smoke.length >= 8 && smoke.length <= 12,
      `${smoke.length} smoke specs: ${smoke.map((spec) => spec.path).join(', ')}`,
    );
  });

  it('lists the specs as paths relative to apps/app', () => {
    for (const spec of specs) assert.match(spec.path, /^tests\/e2e\/[^/]+\.spec\.ts$/);
  });
});

describe('the area table', () => {
  it('has between 10 and 16 kebab-case names, and sign-out is one of them', () => {
    assert.ok(AREAS.length >= 10 && AREAS.length <= 16, `${AREAS.length} areas`);
    for (const area of AREAS) assert.match(area, /^[a-z]+(-[a-z]+)*$/, area);
    assert.ok(AREA_NAMES.includes('sign-out'));
  });

  it('has no duplicate name', () => {
    assert.equal(new Set(AREAS).size, AREAS.length);
  });

  it('only sends paths to areas that exist', () => {
    for (const rule of PATH_RULES) {
      if (rule.area === 'all' || rule.area === 'none') continue;
      assert.ok(AREA_NAMES.includes(rule.area), `${String(rule.pattern)} names ${rule.area}`);
    }
  });

  it('control: every area is reachable from at least one path rule', () => {
    for (const area of AREAS)
      assert.ok(
        PATH_RULES.some((rule) => rule.area === area),
        `no rule sends a path to ${area}`,
      );
  });
});

describe('readSpecMeta refuses a bad header and names the file', () => {
  it('control: a good folder reads, with the smoke flag', () => {
    withTempSpecs({ 'good.spec.ts': header('@area shell', '@smoke'), 'plain.spec.ts': header('@area scan') }, (dir) => {
      assert.deepEqual(readSpecMeta(dir), [
        { path: 'tests/e2e/good.spec.ts', area: 'shell', smoke: true },
        { path: 'tests/e2e/plain.spec.ts', area: 'scan', smoke: false },
      ]);
    });
  });

  it('throws on a spec with no @area line', () => {
    withTempSpecs({ 'good.spec.ts': header('@area shell'), 'missing-area.spec.ts': header() }, (dir) => {
      assert.throws(() => readSpecMeta(dir), /missing-area\.spec\.ts/);
    });
  });

  it('throws on a spec with two @area lines', () => {
    withTempSpecs({ 'twice.spec.ts': header('@area shell', '@area scan') }, (dir) => {
      assert.throws(() => readSpecMeta(dir), /twice\.spec\.ts.*exactly one/);
    });
  });

  it('throws on an @area that is not in AREAS', () => {
    withTempSpecs({ 'typo.spec.ts': header('@area shel') }, (dir) => {
      assert.throws(() => readSpecMeta(dir), /typo\.spec\.ts.*not in AREAS/);
    });
  });

  it('throws on a file with no doc comment at all', () => {
    withTempSpecs({ 'bare.spec.ts': `import '@playwright/test';\n` }, (dir) => {
      assert.throws(() => readSpecMeta(dir), /bare\.spec\.ts/);
    });
  });

  it('ignores an @area written below the header, in code', () => {
    withTempSpecs({ 'late.spec.ts': `${header()}// @area shell\n` }, (dir) => {
      assert.throws(() => readSpecMeta(dir), /late\.spec\.ts/);
    });
  });
});
