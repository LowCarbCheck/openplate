/**
 * Data-only assertions on `app/routes/dashboard.tsx`'s route module — the
 * handle the app chrome reads for its header title, and the `<title>` the
 * document head gets. No render: both are plain data, and a router harness
 * would buy nothing (same judgment call as `app-sidebar.test.ts`).
 *
 * What this actually pins is that Overview is called Overview. D1 of the design
 * round: the page is NOT titled "Dashboard" anywhere a user can see, because
 * operator jargon in user-facing copy is exactly what the app's voice rules
 * ban. A future edit that swaps the key or the fallback fails here.
 *
 * The last suite pins the client loader's CONTRACT after M216/01: the week
 * tile is fed a pre-built Budget Ridge, so the page carries no habit strip of
 * its own any more. It reads the source rather than calling the loader, which
 * would want the whole on-device store.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { z } from 'zod';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { handle, meta } from '../../app/routes/dashboard';

/** The route module's source, for the loader-contract assertions below. */
const dashboardSource = readFileSync(fileURLToPath(new URL('../../app/routes/dashboard.tsx', import.meta.url)), 'utf8');

/** The body of the exported `DashboardData` interface, which is the loader's contract. */
function dashboardDataSource(): string {
  const start = dashboardSource.indexOf('export interface DashboardData {');
  assert.notEqual(start, -1, 'DashboardData must still be exported');
  const end = dashboardSource.indexOf('\n}', start);
  assert.notEqual(end, -1);
  return dashboardSource.slice(start, end);
}

/** A meta descriptor carrying a document title — the one `meta()` emits here. */
const titleDescriptorSchema = z.object({ title: z.string() });

/** A `matches` array shaped like the one React Router hands `meta()`. */
function matches(language: string) {
  return [
    { id: 'root', loaderData: { language } },
    { id: 'routes/dashboard', loaderData: {} },
  ];
}

/** The `title` out of a `meta()` result, which is an array of descriptors. */
function titleOf(descriptors: ReturnType<typeof meta>): string | undefined {
  for (const entry of descriptors) {
    const titled = titleDescriptorSchema.safeParse(entry);
    if (titled.success) return titled.data.title;
  }
  return undefined;
}

describe('dashboard route handle', () => {
  it('titles the page Overview, through the catalog', () => {
    assert.equal(handle.titleKey, 'dashboard.title');
    // The untranslated fallback for any consumer reading the handle outside a
    // React tree — never "Dashboard".
    assert.equal(handle.title, 'Overview');
  });
});

describe('dashboard route meta', () => {
  it('resolves the document title per language, through metaTitle/metaLanguage', () => {
    // SAFETY: `meta()` reads nothing but `matches` (see the route module), so the
    // rest of React Router's arg object is never touched at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- meta() takes the full router arg object; only `matches` is read.
    const render = (language: string) => titleOf(meta({ matches: matches(language) } as any));

    assert.equal(render('en'), 'Overview · openplate');
    assert.equal(render('de'), 'Übersicht · openplate');
  });

  it('falls back to English for a tampered language cookie', () => {
    // SAFETY: as above — only `matches` is read out of the arg object.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above.
    assert.equal(titleOf(meta({ matches: matches('fr') } as any)), 'Overview · openplate');
  });
});

describe('dashboard loader contract', () => {
  it('hands the week tile a ridge, not a habit strip', () => {
    const contract = dashboardDataSource();

    assert.ok(contract.includes('ridge: DayRidgeModel;'), "the ridge is the tile's data");
    assert.ok(!contract.includes('habitStrip'), 'the page no longer carries the diary strip');
    // Control: the field is genuinely gone from the whole module, not just
    // renamed inside the interface.
    assert.ok(!dashboardSource.includes('computeLocalHabitStrip'));
  });

  it('builds the ridge from the same seven-day window the weight glance uses', () => {
    assert.ok(dashboardSource.includes('buildDayRidge({'));
    assert.ok(dashboardSource.includes('dailyTotals: totalsWindow,'));
    assert.ok(dashboardSource.includes('dayCount: WEEK_DAYS,'));
    // The lens is the account's single grading lens (M210), never a second rule.
    assert.ok(dashboardSource.includes('lens: goals.lens,'));
  });
});
