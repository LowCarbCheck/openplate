import type { AiProviderType } from '#types/enums';
import type { VisionProvider } from './types';
import { VisionProviderError } from './types';
import { createOpenAiCompatibleProvider } from './openai-compatible';
import { createAnthropicProvider } from './anthropic';
import { getProviderDefinition } from './registry';
import type { ProviderDefinition } from './registry';
import { findCatalogModel } from './catalog';

export * from './types';
export * from './failure-cause';
// The scan tasks (`PLATE_SCAN_TASK`, `LABEL_SCAN_TASK`, `VisionMode`) — how a
// caller says which job it wants without the service guessing from the image.
export * from './task';

export interface CreateVisionProviderOptions {
  provider: AiProviderType;
  model: string;
  apiKey: string;
  /** Only consulted when the provider has no fixed endpoint of its own (`baseUrl: null` in the registry). */
  baseUrl?: string | null;
}

/**
 * The endpoint this provider talks to: the registry's when it is fixed,
 * otherwise the user's own.
 *
 * A provider with `baseUrl: null` (self-hosted / local) has no fallback —
 * `AiSettingsSchema` requires a base URL for every NEW save (M117/02 review
 * fix), but a settings row written before that requirement shipped could
 * still carry `baseUrl: null`. Fail loudly rather than silently falling back
 * to api.openai.com, which the browser can never reach anyway (the CSP's
 * connect-src doesn't allow it, and OpenAI's own API blocks cross-origin
 * browser calls regardless).
 */
function resolveBaseUrl({
  definition,
  requestedBaseUrl,
}: {
  definition: ProviderDefinition;
  requestedBaseUrl: string | null | undefined;
}): string {
  if (definition.baseUrl !== null) return definition.baseUrl;
  if (!requestedBaseUrl || requestedBaseUrl.trim() === '') {
    throw new VisionProviderError(
      'This connection is missing a base URL — open AI settings and set one (e.g. http://localhost:11434/v1), or switch to OpenRouter.',
    );
  }
  return requestedBaseUrl;
}

/**
 * Builds the right `VisionProvider` adapter for a user's BYOK settings, from
 * the single provider registry (M130/01) rather than a per-provider branch.
 * The remaining `switch` is over the two WIRE ADAPTERS, not over N providers,
 * and is exhaustively checked — adding a provider never touches this file.
 */
export function createVisionProvider(options: CreateVisionProviderOptions): VisionProvider {
  const definition = getProviderDefinition(options.provider);
  if (!definition) {
    // Reachable only from a settings row written by a newer build (see
    // `getProviderDefinition`); the UI degrades to "not connected" before it
    // ever gets here, so this is the belt to that braces.
    throw new VisionProviderError(
      'This version of openplate does not recognise the AI provider saved on this device — open AI settings and reconnect.',
    );
  }

  const baseUrl = resolveBaseUrl({ definition, requestedBaseUrl: options.baseUrl });

  switch (definition.adapter) {
    case 'anthropic':
      // Composes no URLs from `baseUrl` — its endpoint is baked into the adapter.
      return createAnthropicProvider({ apiKey: options.apiKey, model: options.model });
    case 'openai-compatible':
      return createOpenAiCompatibleProvider({
        apiKey: options.apiKey,
        model: options.model,
        baseUrl,
        extraHeaders: definition.extraHeaders?.(),
        // Per-model request tweaks stay in the catalog — the one place that
        // already knows a specific `(provider, modelId)`. A custom model id
        // has no entry, so nothing extra is sent to a self-hosted endpoint.
        disableReasoning: findCatalogModel(options.provider, options.model)?.disableReasoning === true,
      });
  }
}
