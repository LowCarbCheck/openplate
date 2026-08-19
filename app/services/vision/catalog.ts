/**
 * Curated per-provider model catalog for the BYOK settings picker
 * (`app/routes/settings.ai.tsx`). This is the single source of truth for
 * which models are offered, their display copy, and their pricing —
 * everything else (the radio-card list, the "Recommended" badge, the
 * default selection, the per-scan cost estimate) derives from it.
 *
 * KEYED BY PROVIDER, NOT A FLAT LIST (M130/02). A model id only means
 * something inside one provider's namespace: OpenRouter addresses
 * `openai/gpt-5.6-luna`, Anthropic-direct addresses `claude-sonnet-5`, and a
 * Mistral-direct id (`mistral-medium-2604`) is neither. Pricing
 * therefore resolves on `(provider, modelId)` and matches EXACTLY — the old
 * vendor-namespace prefix guessing is gone, because guessing is what made a
 * provider-direct id silently price at `undefined`.
 *
 * `inPerM`/`outPerM` are USD per million tokens (input/output respectively).
 * OpenRouter ids and pricing verified against the live OpenRouter API on
 * 2026-07-09, and `openai/gpt-5.6-luna` against the same API on 2026-08-11;
 * Mistral pricing verified against <https://mistral.ai/pricing/api> on
 * 2026-08-04. Every entry is vision-capable.
 *
 * MODEL IDS ARE DATED, NEVER `-latest`. Every Mistral model below also
 * publishes an alias (`mistral-medium-latest` → `mistral-medium-2604`), and an
 * alias re-points silently: the hardcoded price here would stay attached to a
 * model the user is no longer calling. Pinning the dated id makes that drift a
 * visible catalog miss (cost `undefined`) instead of a wrong number.
 */
import type { AiProviderType } from '#types/enums';

export interface ModelOption {
  readonly id: string;
  readonly label: string;
  readonly vendor: string;
  readonly blurb: string;
  readonly inPerM: number;
  readonly outPerM: number;
  readonly recommended: boolean;
  /**
   * Set only for a model that bills reasoning tokens by DEFAULT and accepts
   * being told not to. A plate photo needs no chain of thought, so leaving the
   * default on would charge every scan for reasoning tokens at the completion
   * rate (and make it slower) for nothing.
   *
   * Opt-in per entry rather than blanket, because the OpenAI-compatible
   * adapter also serves Mistral and arbitrary self-hosted endpoints, and some
   * of those reject a body field they don't know (the same reason
   * `response_format` has a retry-without-it path). A custom model id typed by
   * the user has no catalog entry, so nothing is sent — the correct fallback.
   *
   * NOT EXPRESSIBLE ON GEMINI. Google's models advertise
   * `high | medium | low | minimal` as their supported reasoning efforts (live
   * OpenRouter API, 2026-08-11) — `none` is not among them, and reasoning is
   * `default_enabled`. Setting this flag on a Gemini entry would send a value
   * the model does not accept, so don't "helpfully" add it there; the flag is
   * only for models that accept being told not to reason at all.
   */
  readonly disableReasoning?: true;
}

/**
 * One catalog per provider, each ordered cheapest-first (the order rendered in
 * the picker) with at most one `recommended` entry.
 *
 * `openai-compatible` is deliberately EMPTY: a self-hosted endpoint's pricing
 * is unknowable, so every model there resolves to no cost estimate. Empty is a
 * real, intended state, not a gap waiting to be filled.
 */
/** One model list per provider — every provider has exactly one, possibly empty. */
type ModelCatalog = { readonly [K in AiProviderType]: readonly ModelOption[] };

export const MODEL_CATALOG: ModelCatalog = {
  openrouter: [
    {
      id: 'openai/gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      vendor: 'OpenAI',
      blurb: 'Cheapest option here — new, not yet compared on real plates',
      inPerM: 0.1,
      outPerM: 0.6,
      recommended: true,
      disableReasoning: true,
    },
    {
      id: 'google/gemini-3.1-flash-lite',
      label: 'Gemini 3.1 Flash Lite',
      vendor: 'Google',
      blurb: 'Cheap and capable — great default for plate photos',
      inPerM: 0.25,
      outPerM: 1.5,
      recommended: false,
    },
    {
      // The model an OAuth-connected user starts on
      // (`app/routes/oauth.openrouter.callback.tsx`), listed here so that
      // first-run default is a priced, pickable entry like any other rather
      // than an id with no cost estimate anywhere in the UI.
      id: 'google/gemini-3.5-flash-lite',
      label: 'Gemini 3.5 Flash Lite',
      vendor: 'Google',
      blurb: 'Privacy-first default — no-training, bounded-retention routes',
      inPerM: 0.3,
      outPerM: 2.5,
      recommended: false,
    },
    {
      id: 'openai/gpt-5.4-mini',
      label: 'GPT-5.4 Mini',
      vendor: 'OpenAI',
      blurb: 'Fast, inexpensive all-rounder',
      inPerM: 0.75,
      outPerM: 4.5,
      recommended: false,
    },
    {
      id: 'openai/gpt-5.5',
      label: 'GPT-5.5',
      vendor: 'OpenAI',
      blurb: 'Premium option',
      inPerM: 5.0,
      outPerM: 30.0,
      recommended: false,
    },
  ],
  /**
   * `mistral-medium-2604` is the recommended entry, and that is NOT a price
   * ordering: a three-real-food-photo comparison run through openplate's own
   * adapter (recorded in the M130 worklog, 2026-08-05) makes it the only model
   * of the six that identified all three plates correctly and at the item
   * granularity a food log needs. `mistral-large-2512` — the cheaper flagship,
   * and the obvious pick on price — confidently returned the wrong dish on two
   * plates and collapsed the third into one unusable 450 g blob, and
   * `mistral-small-2603` hallucinated two of three outright.
   */
  mistral: [
    {
      id: 'ministral-3b-2512',
      label: 'Ministral 3B',
      vendor: 'Mistral',
      blurb: 'Cheapest of the family — simple, clearly separated plates only',
      inPerM: 0.1,
      outPerM: 0.1,
      recommended: false,
    },
    {
      id: 'ministral-8b-2512',
      label: 'Ministral 8B',
      vendor: 'Mistral',
      blurb: 'Budget tier with a little more headroom',
      inPerM: 0.15,
      outPerM: 0.15,
      recommended: false,
    },
    {
      id: 'mistral-small-2603',
      label: 'Mistral Small',
      vendor: 'Mistral',
      blurb: 'Cheap input, but hallucinated two of three test plates',
      inPerM: 0.15,
      outPerM: 0.6,
      recommended: false,
    },
    {
      id: 'ministral-14b-2512',
      label: 'Ministral 14B',
      vendor: 'Mistral',
      blurb: 'Respectable budget floor — clumsy dish naming',
      inPerM: 0.2,
      outPerM: 0.2,
      recommended: false,
    },
    {
      id: 'mistral-large-2512',
      label: 'Mistral Large',
      vendor: 'Mistral',
      blurb: 'Flagship price, weakest plate breakdown of the family',
      inPerM: 0.5,
      outPerM: 1.5,
      recommended: false,
    },
    {
      id: 'mistral-medium-2604',
      label: 'Mistral Medium',
      vendor: 'Mistral',
      blurb: 'Most accurate on real plates — the one to pick',
      inPerM: 1.5,
      outPerM: 7.5,
      recommended: true,
    },
  ],
  // Empty on purpose — see the doc comment above.
  'openai-compatible': [],
  // Bare ids, because that is what Anthropic's own API takes. Claude is no
  // longer offered via OpenRouter (cheaper models won that list), but these
  // stay: a user whose BYOK key is an Anthropic key can only call Claude, so
  // emptying this catalog would leave them with no curated options and no
  // pricing at all. Before M130/02 an Anthropic-direct user got pricing only
  // because the resolver guessed an `anthropic/` prefix, so deleting the guess
  // without this catalog would have silently taken away a cost estimate they
  // already had.
  anthropic: [
    {
      id: 'claude-haiku-4.5',
      label: 'Claude Haiku 4.5',
      vendor: 'Anthropic',
      blurb: 'Quick and accurate on food detail',
      inPerM: 1.0,
      outPerM: 5.0,
      recommended: true,
    },
    {
      id: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      vendor: 'Anthropic',
      blurb: 'Higher accuracy for tricky plates',
      inPerM: 2.0,
      outPerM: 10.0,
      recommended: false,
    },
  ],
};

/** The models offered for a provider — empty for a provider with unknowable pricing. */
export function getModelCatalog(provider: AiProviderType): readonly ModelOption[] {
  return MODEL_CATALOG[provider];
}

/**
 * The provider's single recommended entry, or `undefined` when it has no
 * catalog at all (a self-hosted endpoint has nothing to recommend). Throws for
 * a POPULATED catalog with anything other than exactly one recommendation —
 * that is a data-integrity bug, not a runtime state to tolerate.
 */
export function getRecommendedModel(provider: AiProviderType): ModelOption | undefined {
  const catalog = MODEL_CATALOG[provider];
  if (catalog.length === 0) return undefined;

  const recommended = catalog.filter((model) => model.recommended);
  if (recommended.length !== 1) {
    throw new Error(`MODEL_CATALOG.${provider} must have exactly one recommended entry, found ${recommended.length}`);
  }
  return recommended[0];
}

/** Looks up a catalog entry by id — used to detect whether a saved model matches a curated option or is a custom override. */
export function findCatalogModel(provider: AiProviderType, id: string): ModelOption | undefined {
  return MODEL_CATALOG[provider].find((model) => model.id === id);
}

/**
 * Resolves a stored model id to a catalog entry for PRICING. With the provider
 * in hand the match is EXACT — there is no namespace guessing to do, since the
 * provider decides whether ids are namespaced (`openrouter`) or bare
 * (`anthropic`). Returns `undefined` for genuinely unknown models (custom base
 * URL, unlisted model): pricing is never fabricated.
 *
 * @param provider - the provider the model id belongs to.
 * @param modelId - the stored model id, in that provider's own namespace.
 * @returns the matching catalog entry, or `undefined` if none matches.
 */
export function resolveCatalogModelForPricing(provider: AiProviderType, modelId: string): ModelOption | undefined {
  return findCatalogModel(provider, modelId);
}

/** Formats a catalog entry's pricing for display, e.g. "$0.25 in / $1.50 out per 1M tokens". */
export function formatModelPricing(model: Pick<ModelOption, 'inPerM' | 'outPerM'>): string {
  return `$${model.inPerM.toFixed(2)} in / $${model.outPerM.toFixed(2)} out per 1M tokens`;
}
