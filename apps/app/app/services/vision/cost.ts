/**
 * Pure cost estimation for a single plate-identification scan. Pricing comes
 * from the curated per-provider catalog (`./catalog`), keyed on
 * `(provider, modelId)` — a model that isn't in that provider's catalog
 * (custom base URL, unlisted model, self-hosted endpoint) has no known
 * pricing, so the estimate is `undefined` rather than a fabricated number.
 */
import type { AiProviderType } from '#types/enums';
import { DEFAULT_LANGUAGE } from '#app/i18n/language-prefs';
import { numberLocale } from '#app/i18n/date-locale';
import { resolveCatalogModelForPricing } from './catalog';
import type { ScanTokenUsage } from './types';

const MIN_DISPLAYABLE_USD = 0.001;
const TOKENS_PER_MILLION = 1_000_000;

/** Estimated USD cost for one scan's token usage, or `undefined` if the model isn't in the provider's catalog. */
export function estimateScanCostUsd(
  provider: AiProviderType,
  modelId: string,
  usage: ScanTokenUsage,
): number | undefined {
  const model = resolveCatalogModelForPricing(provider, modelId);
  if (!model) return undefined;

  return (
    (usage.inputTokens * model.inPerM) / TOKENS_PER_MILLION + (usage.outputTokens * model.outPerM) / TOKENS_PER_MILLION
  );
}

/** Formats a USD cost for display, e.g. "$0.0042", or "<$0.001" for sub-thousandth-cent scans. */
export function formatScanCost(usd: number): string {
  if (usd < MIN_DISPLAYABLE_USD) {
    return `<$${MIN_DISPLAYABLE_USD}`;
  }

  const trimmed = usd.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return `$${trimmed}`;
}

/**
 * Locale-formatted token count for usage lines — `1,467` in English, `1.467`
 * in German. The thousands separator is a display convention, so it follows
 * the active UI language; `language` defaults to English so existing callers
 * keep their current output.
 *
 * @param count - the token count.
 * @param language - the active UI language.
 * @returns the grouped number as a string.
 */
export function formatTokenCount(count: number, language: string = DEFAULT_LANGUAGE): string {
  return count.toLocaleString(numberLocale(language));
}
