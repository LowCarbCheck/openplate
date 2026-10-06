/**
 * WHICH BROWSER SPECS A PUSH RUNS, AS A FUNCTION OF THE PATHS IT TOUCHED.
 *
 * ── WHAT THIS GUARDS ─────────────────────────────────────────────────────
 *
 * A push no longer runs the whole browser tier; it runs the smoke set plus the specs of the areas
 * it touched (`tests/e2e/select.ts`). The failure that matters is the quiet one: a touched path
 * that selects too little, so a regression reaches main with the gate green. Every claim below is
 * therefore a pair, the selection and a contrast that must come out different: a settings route
 * selects the settings specs AND NOT the insights ones, a docs path selects the smoke set AND NOT
 * the specs of any area, and so on. A selector that returned the smoke set for everything, or
 * everything for everything, fails one half of each pair.
 *
 * The specs here are made up (`SPECS`), so no rule is tested against a file that may be renamed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolvePath, selectSpecs, type Selection } from '../e2e/select';
import type { SpecMeta } from '../e2e/spec-meta';

const SPECS: SpecMeta[] = [
  { path: 'tests/e2e/settings-a.spec.ts', area: 'settings', smoke: false },
  { path: 'tests/e2e/settings-b.spec.ts', area: 'settings', smoke: true },
  { path: 'tests/e2e/insights-a.spec.ts', area: 'insights', smoke: false },
  { path: 'tests/e2e/insights-b.spec.ts', area: 'insights', smoke: false },
  { path: 'tests/e2e/scan-a.spec.ts', area: 'scan', smoke: false },
  { path: 'tests/e2e/shell-a.spec.ts', area: 'shell', smoke: true },
  { path: 'tests/e2e/sign-out-a.spec.ts', area: 'sign-out', smoke: false },
];

const SMOKE_ONLY = ['tests/e2e/settings-b.spec.ts', 'tests/e2e/shell-a.spec.ts'];

function someSpecs(selection: Selection): string[] {
  assert.equal(selection.kind, 'some', `expected a scoped selection, got ${JSON.stringify(selection)}`);
  return selection.kind === 'some' ? selection.specs : [];
}

describe('an area rule selects its area and the smoke set', () => {
  it('a settings route selects the settings specs', () => {
    const specs = someSpecs(selectSpecs(['app/routes/settings.goals.tsx'], SPECS));
    assert.deepEqual(specs, [
      'tests/e2e/settings-a.spec.ts',
      'tests/e2e/settings-b.spec.ts',
      'tests/e2e/shell-a.spec.ts',
    ]);
  });

  it('control: the same route does NOT select the insights specs, and an insights route selects those instead', () => {
    const settings = someSpecs(selectSpecs(['app/routes/settings.goals.tsx'], SPECS));
    assert.ok(!settings.some((spec) => spec.includes('insights')));

    const insights = someSpecs(selectSpecs(['app/routes/trends.tsx'], SPECS));
    assert.ok(insights.includes('tests/e2e/insights-a.spec.ts'));
    assert.ok(!insights.includes('tests/e2e/settings-a.spec.ts'));
  });

  it('a component folder and a file prefix reach their area', () => {
    assert.ok(
      someSpecs(selectSpecs(['app/components/trends/trend-chart.tsx'], SPECS)).includes('tests/e2e/insights-a.spec.ts'),
    );
    assert.ok(
      someSpecs(selectSpecs(['app/components/intake/photo-door.tsx'], SPECS)).includes('tests/e2e/scan-a.spec.ts'),
    );
  });

  it('the sign-out dialog is its own area', () => {
    const specs = someSpecs(selectSpecs(['app/components/sign-out-dialog.tsx'], SPECS));
    assert.ok(specs.includes('tests/e2e/sign-out-a.spec.ts'));
    assert.ok(!specs.includes('tests/e2e/scan-a.spec.ts'));
  });

  it('two areas union', () => {
    const specs = someSpecs(selectSpecs(['app/routes/trends.tsx', 'app/routes/settings.goals.tsx'], SPECS));
    assert.ok(specs.includes('tests/e2e/insights-a.spec.ts'));
    assert.ok(specs.includes('tests/e2e/insights-b.spec.ts'));
    assert.ok(specs.includes('tests/e2e/settings-a.spec.ts'));
    assert.ok(!specs.includes('tests/e2e/scan-a.spec.ts'));
  });
});

describe('a path with the rule `all` runs every spec', () => {
  it('a ui component selects all', () => {
    assert.equal(selectSpecs(['app/components/ui/button.tsx'], SPECS).kind, 'all');
  });

  it('control: a component of one area does not', () => {
    assert.equal(selectSpecs(['app/components/trends/trend-chart.tsx'], SPECS).kind, 'some');
  });

  it('the build, the toolchain, the server and the shared frame select all', () => {
    for (const path of [
      'package.json',
      'pnpm-lock.yaml',
      'playwright.config.ts',
      'vite.config.ts',
      'react-router.config.ts',
      'tsconfig.json',
      'Dockerfile.pnpm',
      'scripts/e2e-sharded.sh',
      '.githooks/pre-push',
      'server.ts',
      'app/root.tsx',
      'app/routes.ts',
      'app/entry.server.tsx',
      'app/app.css',
      'app/i18n/locales/en/common.json',
      'app/lib/sync/engine/protocol.ts',
      'app/services/vision/registry.ts',
      'public/sw.js',
    ]) {
      assert.equal(selectSpecs([path], SPECS).kind, 'all', path);
    }
  });

  it('a harness file under tests/e2e selects all, and a unit test does not', () => {
    assert.equal(selectSpecs(['tests/e2e/helpers.ts'], SPECS).kind, 'all');
    assert.equal(selectSpecs(['tests/e2e/fonts.conf'], SPECS).kind, 'all');
    assert.equal(selectSpecs(['tests/unit/macros.test.ts'], SPECS).kind, 'some');
  });

  it('all beats an area, whatever the order of the paths', () => {
    assert.equal(selectSpecs(['app/routes/trends.tsx', 'app/components/ui/button.tsx'], SPECS).kind, 'all');
    assert.equal(selectSpecs(['app/components/ui/button.tsx', 'app/routes/trends.tsx'], SPECS).kind, 'all');
  });

  it('an unmapped path under app/ is the safety valve: all', () => {
    assert.equal(selectSpecs(['app/lib/some-brand-new-helper.ts'], SPECS).kind, 'all');
    assert.equal(selectSpecs(['app/components/some-brand-new-card.tsx'], SPECS).kind, 'all');
  });

  it('an unmapped path outside app/ and tests/ is all as well', () => {
    assert.equal(selectSpecs(['tools/oxlint/anti-slop/rule.js'], SPECS).kind, 'all');
    assert.equal(selectSpecs(['some-new-root-file.json'], SPECS).kind, 'all');
  });

  it('the reason names the path that forced it', () => {
    const selection = selectSpecs(['app/components/ui/button.tsx'], SPECS);
    assert.equal(selection.kind, 'all');
    assert.match(selection.kind === 'all' ? selection.reason : '', /app\/components\/ui\/button\.tsx/);
  });
});

describe('a path with the rule `none` runs nothing of its own', () => {
  it('docs, markdown and ADRs select only the smoke set', () => {
    for (const path of [
      'README.md',
      'AGENTS.md',
      'CHANGELOG.md',
      'docs/guide.md',
      '.adr/0022-x.md',
      'tests/unit/e2e-select.test.ts',
    ]) {
      assert.deepEqual(someSpecs(selectSpecs([path], SPECS)), SMOKE_ONLY, path);
    }
  });

  it('the vision contract exporter has no browser reach, and its neighbours in scripts/ still run everything', () => {
    for (const path of ['scripts/export-vision-contract.ts', 'scripts/lib/vision-contract.ts']) {
      assert.deepEqual(someSpecs(selectSpecs([path], SPECS)), SMOKE_ONLY, path);
    }
    for (const path of ['scripts/e2e-select.ts', 'scripts/lib/translate.ts', 'scripts/export-vision-contract.sh']) {
      assert.equal(selectSpecs([path], SPECS).kind, 'all', path);
    }
  });

  it('control: a source path next to the docs does select more than the smoke set', () => {
    const specs = someSpecs(selectSpecs(['README.md', 'app/routes/trends.tsx'], SPECS));
    assert.ok(specs.length > SMOKE_ONLY.length);
  });

  it('the none rule sits below the all rules: markdown inside app/i18n stays all', () => {
    assert.equal(resolvePath('app/i18n/memory/README.md'), 'all');
    assert.equal(resolvePath('README.md'), 'none');
  });
});

describe('the smoke set and the empty change set', () => {
  it('an empty change set selects only the smoke set, and says so', () => {
    const selection = selectSpecs([], SPECS);
    assert.deepEqual(someSpecs(selection), SMOKE_ONLY);
    assert.ok(selection.kind === 'some' && selection.reasons.some((reason) => /smoke/.test(reason)));
  });

  it('blank-free input is the caller job, but a path that is only "./" prefixed still resolves', () => {
    assert.deepEqual(
      someSpecs(selectSpecs(['./app/routes/trends.tsx'], SPECS)).includes('tests/e2e/insights-a.spec.ts'),
      true,
    );
  });

  it('the smoke set is part of every scoped selection', () => {
    for (const path of ['app/routes/trends.tsx', 'README.md', 'tests/e2e/scan-a.spec.ts']) {
      const specs = someSpecs(selectSpecs([path], SPECS));
      for (const smoke of SMOKE_ONLY) assert.ok(specs.includes(smoke), `${path} lost ${smoke}`);
    }
  });
});

describe('a changed spec file runs, whatever its area', () => {
  it('runs the spec although no code of its area changed', () => {
    const specs = someSpecs(selectSpecs(['tests/e2e/scan-a.spec.ts'], SPECS));
    assert.ok(specs.includes('tests/e2e/scan-a.spec.ts'));
  });

  it('control: it runs that spec and not its unchanged neighbours of another area', () => {
    const specs = someSpecs(selectSpecs(['tests/e2e/scan-a.spec.ts'], SPECS));
    assert.ok(!specs.includes('tests/e2e/insights-a.spec.ts'));
    assert.ok(!specs.includes('tests/e2e/sign-out-a.spec.ts'));
  });

  it('a spec that was deleted is skipped, not an error and not an all', () => {
    assert.deepEqual(someSpecs(selectSpecs(['tests/e2e/gone.spec.ts'], SPECS)), SMOKE_ONLY);
  });
});

describe('the result is sorted and has no duplicate', () => {
  it('a spec reached three ways appears once, in order', () => {
    const specs = someSpecs(
      selectSpecs(
        [
          'tests/e2e/settings-b.spec.ts',
          'app/routes/settings.goals.tsx',
          'app/routes/settings.sync.tsx',
          'tests/e2e/settings-b.spec.ts',
        ],
        SPECS,
      ),
    );
    assert.deepEqual(specs, [...new Set(specs)].toSorted());
    assert.equal(specs.filter((spec) => spec === 'tests/e2e/settings-b.spec.ts').length, 1);
  });

  it('control: sorting is real, the specs list is not already in order', () => {
    const shuffled = SPECS.toReversed();
    const specs = someSpecs(selectSpecs(['app/routes/settings.goals.tsx', 'app/routes/trends.tsx'], shuffled));
    assert.deepEqual(specs, specs.toSorted());
    const inputOrder = shuffled.map((spec) => spec.path);
    assert.notDeepEqual(inputOrder, inputOrder.toSorted());
  });
});

describe('the rule table resolves the names the task fixed', () => {
  it('maps representative paths to the area they belong to', () => {
    assert.equal(resolvePath('app/routes/settings.about.tsx'), 'settings');
    assert.equal(resolvePath('app/routes/settings.plan.tsx'), 'plans-and-paywall');
    assert.equal(resolvePath('app/routes/admin.people.$id.tsx'), 'admin');
    assert.equal(resolvePath('app/routes/legal/imprint.tsx'), 'content-and-legal');
    assert.equal(resolvePath('app/components/sign-out-dialog.tsx'), 'sign-out');
    assert.equal(resolvePath('app/lib/trend-chart.ts'), 'insights');
  });

  it('control: a route two areas share is all, not the first area that fits', () => {
    assert.equal(resolvePath('app/routes/settings.account.tsx'), 'all');
    assert.equal(resolvePath('app/routes/_personal.tsx'), 'all');
  });
});
