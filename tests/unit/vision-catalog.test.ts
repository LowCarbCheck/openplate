/**
 * Unit tests for `#app/services/vision/catalog` — the curated per-provider
 * model catalog backing the BYOK settings picker (`app/routes/settings.ai.tsx`)
 * and every per-scan cost estimate.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MODEL_CATALOG,
  findCatalogModel,
  formatModelPricing,
  getRecommendedModel,
  resolveCatalogModelForPricing,
} from '../../app/services/vision/catalog';
import type { ModelOption } from '../../app/services/vision/catalog';
// The route module is client-only and imports cleanly under `node --test` +
// tsx (nothing browser-specific runs at import time), same as the other route
// modules unit-tested here — so the constant is asserted at its own source
// rather than transcribed into a second literal that could drift.
import { OAUTH_DEFAULT_MODEL } from '../../app/routes/oauth.openrouter.callback';

// vendor/model — lowercase segments (letters, digits, dots, hyphens)
// separated by a single slash. Matches every real OpenRouter model id.
const NAMESPACED_MODEL_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
// A provider-direct id carries no vendor namespace — that IS the difference
// this spec exists to represent.
const BARE_MODEL_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** Invariants every catalog must hold, whichever provider it belongs to. */
function assertCatalogInvariants(name: string, catalog: readonly ModelOption[]): void {
  const ids = catalog.map((model) => model.id);
  assert.strictEqual(new Set(ids).size, ids.length, `${name} has duplicate ids`);

  for (const model of catalog) {
    assert.ok(model.label.length > 0, `${name}/${model.id} missing label`);
    assert.ok(model.vendor.length > 0, `${name}/${model.id} missing vendor`);
    assert.ok(model.blurb.length > 0, `${name}/${model.id} missing blurb`);
    assert.ok(model.inPerM > 0, `${name}/${model.id} inPerM must be positive`);
    assert.ok(model.outPerM > 0, `${name}/${model.id} outPerM must be positive`);
    assert.doesNotMatch(model.id, /-latest$/, `${name}/${model.id} pins a re-pointing alias, not a dated id`);
  }

  const recommended = catalog.filter((model) => model.recommended);
  assert.strictEqual(recommended.length, 1, `${name} must have exactly one recommended entry`);
}

describe('MODEL_CATALOG integrity', () => {
  it('every populated catalog holds the shared invariants', () => {
    for (const [provider, catalog] of Object.entries(MODEL_CATALOG)) {
      if (catalog.length === 0) continue;
      assertCatalogInvariants(provider, catalog);
    }
  });

  it('openai-compatible is deliberately empty — a self-hosted endpoint has unknowable pricing', () => {
    assert.deepStrictEqual(MODEL_CATALOG['openai-compatible'], []);
  });

  it('openrouter ids are vendor-namespaced', () => {
    for (const model of MODEL_CATALOG.openrouter) {
      assert.match(model.id, NAMESPACED_MODEL_ID_PATTERN, `"${model.id}" is not a well-formed vendor/model id`);
    }
  });

  it('anthropic ids are bare — that is what the direct API takes', () => {
    for (const model of MODEL_CATALOG.anthropic) {
      assert.match(model.id, BARE_MODEL_ID_PATTERN, `"${model.id}" should carry no vendor namespace`);
    }
  });

  it('getRecommendedModel returns the single recommended entry of a populated catalog', () => {
    const openrouter = getRecommendedModel('openrouter');
    assert.strictEqual(openrouter?.recommended, true);
    assert.ok(MODEL_CATALOG.openrouter.some((model) => model.id === openrouter?.id));

    // Haiku, not Sonnet: the catalog convention is cheap-and-capable.
    assert.strictEqual(getRecommendedModel('anthropic')?.id, 'claude-haiku-4.5');
  });

  it('getRecommendedModel returns undefined for an empty catalog rather than throwing', () => {
    assert.strictEqual(getRecommendedModel('openai-compatible'), undefined);
  });

  it('findCatalogModel resolves within one provider only', () => {
    assert.strictEqual(findCatalogModel('anthropic', 'claude-sonnet-5')?.id, 'claude-sonnet-5');
    // The OpenRouter-namespaced form is a different provider's id.
    assert.strictEqual(findCatalogModel('anthropic', 'anthropic/claude-sonnet-5'), undefined);
    assert.strictEqual(findCatalogModel('openrouter', 'not-a-real/model'), undefined);
  });

  it('formatModelPricing renders "$X in / $Y out per 1M tokens"', () => {
    assert.strictEqual(formatModelPricing({ inPerM: 0.25, outPerM: 1.5 }), '$0.25 in / $1.50 out per 1M tokens');
  });
});

describe('MODEL_CATALOG.openrouter', () => {
  it('lists the curated ids cheapest-first, with no Claude entries', () => {
    assert.deepStrictEqual(
      MODEL_CATALOG.openrouter.map((model) => model.id),
      [
        'openai/gpt-5.6-luna',
        'google/gemini-3.1-flash-lite',
        'google/gemini-3.5-flash-lite',
        'openai/gpt-5.4-mini',
        'openai/gpt-5.5',
      ],
    );
    assert.ok(!MODEL_CATALOG.openrouter.some((model) => model.vendor === 'Anthropic'));
  });

  it('recommends the cheapest entry, gpt-5.6-luna, at its verified pricing', () => {
    const recommended = getRecommendedModel('openrouter');
    assert.strictEqual(recommended?.id, 'openai/gpt-5.6-luna');
    assert.deepStrictEqual(
      { inPerM: recommended?.inPerM, outPerM: recommended?.outPerM },
      { inPerM: 0.1, outPerM: 0.6 },
    );
  });

  it('prices the OAuth first-run default at its verified rates', () => {
    const model = findCatalogModel('openrouter', 'google/gemini-3.5-flash-lite');
    assert.deepStrictEqual({ inPerM: model?.inPerM, outPerM: model?.outPerM }, { inPerM: 0.3, outPerM: 2.5 });
    // Listed, but not the recommendation — the picker's own default stays luna.
    assert.strictEqual(model?.recommended, false);
  });

  it('marks only gpt-5.6-luna as needing reasoning turned off', () => {
    assert.deepStrictEqual(
      MODEL_CATALOG.openrouter.filter((model) => model.disableReasoning).map((model) => model.id),
      ['openai/gpt-5.6-luna'],
    );
    // Never on a Gemini entry: Google's supported reasoning efforts are
    // high|medium|low|minimal (live OpenRouter API, 2026-08-11) — there is no
    // `none` for the flag to express, so setting it would send a value the
    // model rejects.
    assert.ok(
      MODEL_CATALOG.openrouter.every((model) => model.vendor !== 'Google' || model.disableReasoning === undefined),
      'a Google model cannot express reasoning: { effort: "none" }',
    );
    // Nothing on any other provider asks for it — the flag is opt-in per model.
    for (const [provider, catalog] of Object.entries(MODEL_CATALOG)) {
      if (provider === 'openrouter') continue;
      assert.ok(
        catalog.every((model) => model.disableReasoning === undefined),
        `${provider} unexpectedly disables reasoning`,
      );
    }
  });
});

describe('MODEL_CATALOG.mistral', () => {
  it('ids are bare — that is what the Mistral API takes', () => {
    for (const model of MODEL_CATALOG.mistral) {
      assert.match(model.id, BARE_MODEL_ID_PATTERN, `"${model.id}" should carry no vendor namespace`);
    }
  });

  it('catalogues all six dated ids, cheapest-first', () => {
    assert.deepStrictEqual(
      MODEL_CATALOG.mistral.map((model) => model.id),
      [
        'ministral-3b-2512',
        'ministral-8b-2512',
        'mistral-small-2603',
        'ministral-14b-2512',
        'mistral-large-2512',
        'mistral-medium-2604',
      ],
    );
  });

  it('recommends mistral-medium-2604 — the real-food-photo comparison verdict, not the price order', () => {
    assert.strictEqual(getRecommendedModel('mistral')?.id, 'mistral-medium-2604');
    // Not the cheapest flagship: mistral-large-2512 is cheaper and lost on
    // identification quality (M130 worklog, 2026-08-05).
    assert.ok(
      MODEL_CATALOG.mistral.find((model) => model.id === 'mistral-large-2512')!.inPerM <
        MODEL_CATALOG.mistral.find((model) => model.id === 'mistral-medium-2604')!.inPerM,
    );
  });

  it('prices the two anchor models exactly as the verified table', () => {
    const large = MODEL_CATALOG.mistral.find((model) => model.id === 'mistral-large-2512');
    const medium = MODEL_CATALOG.mistral.find((model) => model.id === 'mistral-medium-2604');
    assert.deepStrictEqual({ inPerM: large?.inPerM, outPerM: large?.outPerM }, { inPerM: 0.5, outPerM: 1.5 });
    assert.deepStrictEqual({ inPerM: medium?.inPerM, outPerM: medium?.outPerM }, { inPerM: 1.5, outPerM: 7.5 });
  });
});

describe('OAUTH_DEFAULT_MODEL', () => {
  it('resolves to a catalog entry, so an OAuth-connected user sees a cost estimate', () => {
    // The drift this pins actually happened: the OAuth flow's first-run model
    // was never added to the catalog, so `resolveCatalogModelForPricing`
    // returned `undefined` and every OAuth-connected user ran a model with no
    // price shown anywhere. Differing from `getRecommendedModel()` is the
    // deliberate part; being absent from the catalog was not.
    const model = resolveCatalogModelForPricing('openrouter', OAUTH_DEFAULT_MODEL);
    assert.notStrictEqual(model, undefined, `${OAUTH_DEFAULT_MODEL} is missing from MODEL_CATALOG.openrouter`);
    assert.strictEqual(model?.id, OAUTH_DEFAULT_MODEL);
  });

  it('is deliberately not the picker recommendation', () => {
    assert.notStrictEqual(getRecommendedModel('openrouter')?.id, OAUTH_DEFAULT_MODEL);
  });
});

describe('resolveCatalogModelForPricing', () => {
  it('resolves an exact id within the provider', () => {
    assert.strictEqual(
      resolveCatalogModelForPricing('openrouter', 'openai/gpt-5.6-luna')?.id,
      'openai/gpt-5.6-luna',
    );
  });

  it('prices a bare provider-direct id from the catalog of that same provider', () => {
    // This is the pricing an Anthropic-direct user had via the deleted
    // namespace guess — it must survive on the bare id, not the guess.
    assert.strictEqual(resolveCatalogModelForPricing('anthropic', 'claude-sonnet-5')?.id, 'claude-sonnet-5');
    assert.strictEqual(resolveCatalogModelForPricing('anthropic', 'claude-haiku-4.5')?.id, 'claude-haiku-4.5');
  });

  it('resolves a bare Mistral-direct id under the mistral provider', () => {
    // The whole point of the provider-keyed catalog: this id is meaningless
    // outside Mistral's own namespace, and before M130/02 it priced at
    // `undefined` because there was nowhere to look it up.
    assert.strictEqual(resolveCatalogModelForPricing('mistral', 'mistral-medium-2604')?.id, 'mistral-medium-2604');
    assert.strictEqual(resolveCatalogModelForPricing('mistral', 'ministral-3b-2512')?.id, 'ministral-3b-2512');
  });

  it('does not bleed ids across providers', () => {
    // No prefix guessing: a bare Anthropic id is not an OpenRouter model.
    assert.strictEqual(resolveCatalogModelForPricing('openrouter', 'claude-sonnet-5'), undefined);
    assert.strictEqual(resolveCatalogModelForPricing('anthropic', 'gpt-5.5'), undefined);
    // …and a Mistral-direct id is not an OpenRouter model either.
    assert.strictEqual(resolveCatalogModelForPricing('openrouter', 'mistral-medium-2604'), undefined);
    assert.strictEqual(resolveCatalogModelForPricing('mistral', 'mistralai/mistral-medium-3.1'), undefined);
  });

  it('returns undefined for every model on a provider with an empty catalog', () => {
    assert.strictEqual(resolveCatalogModelForPricing('openai-compatible', 'llama3'), undefined);
    assert.strictEqual(resolveCatalogModelForPricing('openai-compatible', 'mistral-medium-2604'), undefined);
  });

  it('returns undefined for an unknown id', () => {
    assert.strictEqual(resolveCatalogModelForPricing('openrouter', 'mistralai/mistral-medium-3.1'), undefined);
    assert.strictEqual(resolveCatalogModelForPricing('anthropic', 'self-hosted-model'), undefined);
  });
});
