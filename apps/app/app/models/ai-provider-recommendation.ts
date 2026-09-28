/**
 * Which BYOK provider the settings page puts first, and badges as
 * "Recommended", for the UI language (M130/04).
 *
 * PRESENTATION ONLY. This module is deliberately not reachable from the vision
 * dispatch path (`app/services/vision/index.ts`), the live key check
 * (`./verify-key`), or the device's settings store
 * (`app/lib/local-store/ai-settings.ts`): the language must never influence
 * what gets stored, what validates, which provider a scan is sent to, or an
 * already-connected provider. Switching a device's language reorders two tabs
 * and moves a badge — nothing else.
 *
 * THE HEURISTIC'S LIMITS, stated plainly because the copy must not overclaim
 * them: `DEFAULT_LANGUAGE` is `'en'`, so a German or EU visitor who never
 * touched the language switcher gets the English UI and therefore the
 * OpenRouter recommendation — the rule misfires on exactly the population an
 * EU-residency argument targets, and fires for German speakers living outside
 * the EU. Language approximates jurisdiction; it does not establish it. Both
 * providers are always visible and always connectable either way, which is
 * what keeps the downside of a wrong guess to "one tab is on the left".
 */
import type { AiProviderType } from '#types/enums';
import type { ProviderDefinition, ProviderPlacement } from '#app/services/vision/registry';
import { getProvidersByPlacement } from '#app/services/vision/registry';

/**
 * The provider offered first for a UI language.
 *
 * @param language - an i18next language tag (`'de'`, `'de-AT'`, `'en-US'`, …).
 * @returns the provider to show first and badge as recommended.
 */
export function recommendedProviderFor(language: string): AiProviderType {
  // German UI → 'mistral': EU-hosted, and a free tier that needs no card.
  // Everything else → 'openrouter': one key for every model, one-click OAuth.
  const base = language.toLowerCase().split('-')[0];
  return base === 'de' ? 'mistral' : 'openrouter';
}

/**
 * Provider definitions in the order the settings page renders them, with the
 * language's recommended provider rotated to the front. Registry order
 * (`PROVIDER_IDS`) decides everything else — this only ever moves one entry.
 */
export function providersForDisplay({
  placement,
  language,
}: {
  placement: ProviderPlacement;
  language: string;
}): readonly ProviderDefinition[] {
  const recommended = recommendedProviderFor(language);
  const definitions = getProvidersByPlacement(placement);
  const first = definitions.filter((definition) => definition.id === recommended);
  return [...first, ...definitions.filter((definition) => definition.id !== recommended)];
}
