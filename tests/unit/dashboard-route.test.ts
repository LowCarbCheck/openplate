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
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { z } from 'zod';

import { handle, meta } from '../../app/routes/dashboard';

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
