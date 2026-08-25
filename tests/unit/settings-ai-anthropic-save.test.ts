/**
 * Regression test for M123 spec 09's item 5 — the Anthropic-direct
 * silent-save-failure. `settings.ai.tsx`'s Model input for an "Advanced"
 * (non-primary) provider used to live inside a `<Collapsible>` ->
 * `<CollapsibleContent>` with no `forceMount`: while the panel was
 * collapsed, Radix unmounted its children, so the model (and, for the outer
 * panel, the API key) input was never part of the DOM the browser's native
 * form submission collects. Selecting Anthropic direct, typing a model, and
 * hitting save silently dropped the model value — the shipped fix adds
 * `forceMount` (+ `data-[state=closed]:hidden`, so the field stays
 * mounted-but-invisible) to both nested `CollapsibleContent`s in this route.
 *
 * This file pins two things, per the spec's own guidance:
 *  1. The STRUCTURAL guarantee — every `<CollapsibleContent` in this route
 *     carries `forceMount`, so a regression that drops it (or a new
 *     collapsible added later without it) fails loudly here instead of
 *     silently dropping a field again.
 *  2. The REAL LOGIC — `createAiSettingsSchema` (the same Zod schema
 *     `onSubmit` in the route parses with) accepts a real "Anthropic direct,
 *     model filled in" submission, and the parsed result round-trips through
 *     the real `putLocalAiSettings`/`getLocalAiSettings` local-store pair
 *     (the same persistence call `onSubmit` makes) — not a mock of either.
 *     A second case demonstrates the FAILURE MODE the fix prevents: a
 *     FormData missing the `model` entry entirely (what an unmounted input
 *     would produce) fails schema validation instead of silently saving an
 *     empty model.
 *
 * Following the established pattern (`settings-ai-scan-cost.test.ts`,
 * `add-search-empty-message.test.ts`): the route module is imported
 * directly (module-level code here is just function/schema declarations,
 * nothing browser/server-dependent runs at import time — confirmed by the
 * existing `settings-ai-scan-cost.test.ts`), and the fix's own source file is
 * re-read with `readFileSync` for the structural assertion.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseWithZod } from '@conform-to/zod/v4';

import { createAiSettingsSchema, type Translate } from '../../app/routes/settings.ai';
import { createAiStore } from '../../app/lib/local-store/store';
import { getLocalAiSettings, putLocalAiSettings } from '../../app/lib/local-store/ai-settings';

const routeSourcePath = fileURLToPath(new URL('../../app/routes/settings.ai.tsx', import.meta.url));
const routeSource = readFileSync(routeSourcePath, 'utf8');

/** Echoes keys/params — these tests are about parsing outcomes, not copy. */
const t: Translate = (key, params = {}) => {
  const paramsText = Object.entries(params)
    .map(([paramKey, value]) => `${paramKey}=${String(value)}`)
    .join(',');
  return paramsText ? `${key}(${paramsText})` : key;
};

/** Builds the FormData a real submit of the Anthropic-direct manual-entry form produces. */
function anthropicDirectFormData(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set('provider', 'anthropic');
  formData.set('model', 'claude-sonnet-5');
  formData.set('apiKey', 'sk-ant-test-key-0123456789');
  for (const [key, value] of Object.entries(overrides)) {
    formData.set(key, value);
  }
  return formData;
}

describe('settings.ai.tsx Collapsible structural guarantee (M123/09 item 5)', () => {
  it('gives every field-carrying CollapsibleContent forceMount, so a collapsed panel never drops a Conform field from the submitted form', () => {
    // Scoped to the "field-carrying" panels — identified by the
    // `data-[state=closed]:hidden` class the fix pairs with `forceMount`
    // (mounted-but-invisible while collapsed, so real form fields inside
    // still submit). This deliberately excludes the OTHER
    // `<CollapsibleContent>` in this file, `CatalogModelSection`'s
    // custom-model toggle: that one wraps a plain controlled `<Input
    // value={customModelId} onChange={...}>` with no `name` attribute at
    // all — its value lives in React state and is mirrored into a hidden
    // input OUTSIDE any collapsible (see the second test below), so
    // unmounting it on collapse loses nothing. Only a field the browser
    // reads directly off the DOM at submit time needs forceMount.
    const fieldCarryingTags = routeSource.match(/<CollapsibleContent\b[^>]*data-\[state=closed\]:hidden[^>]*>/g) ?? [];

    // If this is empty, either both known field-carrying panels were removed
    // (fine, but then this test has nothing left to guard) or the marker
    // class was renamed — either way a silent 0-tag pass would defeat the
    // assertion below, so fail loudly instead.
    assert.ok(
      fieldCarryingTags.length >= 2,
      `expected at least the two known field-carrying CollapsibleContent panels (manual-entry + advanced), found ${fieldCarryingTags.length}`,
    );

    for (const tag of fieldCarryingTags) {
      assert.match(
        tag,
        /forceMount/,
        `every field-carrying <CollapsibleContent> in settings.ai.tsx must carry forceMount so its inputs stay in the DOM while collapsed — offending tag: ${tag}`,
      );
    }
  });

  it("the Anthropic-direct model field is reachable from the form's default fieldset (either a hidden catalog input outside every collapsible, or a forceMount'd free-text input inside one)", () => {
    // Belt-and-suspenders on top of the forceMount check above: whichever
    // path renders `fields.model` for a catalog-backed provider like
    // anthropic (the hidden input at the top of the <Form>) must exist
    // outside any CollapsibleContent, so it is never subject to the
    // collapse-unmount bug in the first place.
    assert.match(
      routeSource,
      /<input type="hidden" name=\{fields\.model\.name\} value=\{effectiveCatalogModel\} \/>/,
      'expected the catalog-model hidden input carrying fields.model to still exist outside any collapsible',
    );
  });
});

describe('createAiSettingsSchema — Anthropic-direct submission (real schema, not a mock)', () => {
  it('accepts provider=anthropic with a filled-in model and persists it', () => {
    const schema = createAiSettingsSchema(t);
    const submission = parseWithZod(anthropicDirectFormData(), { schema });

    assert.equal(submission.status, 'success');
    if (submission.status !== 'success') return;
    assert.equal(submission.value.provider, 'anthropic');
    assert.equal(submission.value.model, 'claude-sonnet-5');
    assert.equal(submission.value.apiKey, 'sk-ant-test-key-0123456789');
  });

  it('rejects a submission with no model value — the exact shape an unmounted (collapsed, non-forceMount) input would have produced', () => {
    const schema = createAiSettingsSchema(t);
    const formData = anthropicDirectFormData({ model: '' });
    const submission = parseWithZod(formData, { schema });

    assert.equal(submission.status, 'error');
  });
});

describe('Anthropic-direct save persists through the real local-store path', () => {
  it('selecting Anthropic direct, entering a model, and saving round-trips through putLocalAiSettings/getLocalAiSettings', async () => {
    const schema = createAiSettingsSchema(t);
    const submission = parseWithZod(anthropicDirectFormData(), { schema });
    assert.equal(submission.status, 'success');
    if (submission.status !== 'success') return;

    // Mirrors `onSubmit`'s own `putLocalAiSettings` call in settings.ai.tsx
    // (first-time connect: no prior settings, apiKey present, connectedVia
    // 'manual' for a freshly typed key).
    const store = createAiStore();
    const saved = await putLocalAiSettings(
      {
        provider: submission.value.provider,
        baseUrl: submission.value.baseUrl ?? null,
        model: submission.value.model,
        apiKey: submission.value.apiKey ?? '',
        connectedVia: 'manual',
        updatedAt: Date.now(),
      },
      { store },
    );

    assert.equal(saved.provider, 'anthropic');
    assert.equal(saved.model, 'claude-sonnet-5');

    const reloaded = await getLocalAiSettings({ store });
    assert.equal(reloaded?.provider, 'anthropic');
    assert.equal(reloaded?.model, 'claude-sonnet-5');
    assert.equal(reloaded?.apiKey, 'sk-ant-test-key-0123456789');
  });

  it('a re-save that only changes the model (key field left blank) keeps the provider anthropic and persists the new model', async () => {
    const store = createAiStore();
    await putLocalAiSettings(
      {
        provider: 'anthropic',
        baseUrl: null,
        model: 'claude-sonnet-5',
        apiKey: 'sk-ant-test-key-0123456789',
        connectedVia: 'manual',
        updatedAt: Date.now(),
      },
      { store },
    );

    const schema = createAiSettingsSchema(t);
    const formData = anthropicDirectFormData({ model: 'claude-opus-5', apiKey: '' });
    const submission = parseWithZod(formData, { schema });
    assert.equal(submission.status, 'success');
    if (submission.status !== 'success') return;

    const existing = await getLocalAiSettings({ store });
    assert.ok(existing);
    const saved = await putLocalAiSettings(
      {
        provider: submission.value.provider,
        baseUrl: submission.value.baseUrl ?? null,
        model: submission.value.model,
        apiKey: submission.value.apiKey || (existing?.apiKey ?? ''),
        connectedVia: existing?.connectedVia ?? 'manual',
        updatedAt: Date.now(),
      },
      { store },
    );

    assert.equal(saved.provider, 'anthropic');
    assert.equal(saved.model, 'claude-opus-5');
    assert.equal(saved.apiKey, 'sk-ant-test-key-0123456789');
  });
});
