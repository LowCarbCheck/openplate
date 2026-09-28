/**
 * use-ai-connection-summary.ts — "is this device connected to an AI provider,
 * and to which one?" as one implementation.
 *
 * Two surfaces answer that question in the same words: the settings hub's AI
 * row (`routes/settings._index.tsx`) and the header avatar menu's AI shortcut
 * (`components/avatar-menu.tsx`). This module is what they share, so the two
 * can't drift into two different renderings of one device fact.
 *
 * Client-side only, like everything BYOK (AGENTS.md): the settings are read
 * from the device store, and the summary names the PROVIDER and MODEL only —
 * never the key.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getLocalAiSettings } from '#app/lib/local-store';
import type { LocalAiSettings } from '#app/lib/local-store';
import { findCatalogModel } from '#app/services/vision/catalog';
import { getProviderDefinition } from '#app/services/vision/registry';

/**
 * The resolved connection state, before any wording is applied.
 *
 * `loading` is its own case rather than a "not connected" default, because the
 * device read is async and a row that flashes "Not connected" before settling
 * on a provider reads as a bug to the person who just connected one.
 */
export type AiConnectionSummary =
  | { status: 'loading' }
  | { status: 'not-connected' }
  | { status: 'connected'; providerLabelKey: string; model: string };

/**
 * Pure derivation from the stored settings — exported for its unit test, and
 * so both callers get identical degradation.
 *
 * A stored provider id this build has never heard of (a settings row written by
 * a newer image, then rolled back) degrades to "not connected" rather than
 * indexing the registry blind and throwing mid-render. Same for a model the
 * catalog doesn't list: the raw id is shown rather than fabricated.
 *
 * @param settings - the device's BYOK settings; `undefined` while the read is in flight, `null` when there are none.
 */
export function deriveAiConnectionSummary(settings: LocalAiSettings | null | undefined): AiConnectionSummary {
  if (settings === undefined) return { status: 'loading' };
  if (settings === null) return { status: 'not-connected' };

  const definition = getProviderDefinition(settings.provider);
  if (definition === undefined) return { status: 'not-connected' };

  return {
    status: 'connected',
    providerLabelKey: definition.labelKey,
    model: findCatalogModel(settings.provider, settings.model)?.label ?? settings.model,
  };
}

/** The device's saved BYOK settings, or `undefined` while the first read is in flight. */
function useLocalAiSettings(): LocalAiSettings | null | undefined {
  const [settings, setSettings] = useState<LocalAiSettings | null | undefined>(undefined);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      const loaded = await getLocalAiSettings();
      if (!isCancelled) setSettings(loaded);
    })();
    return () => {
      isCancelled = true;
    };
  }, []);

  return settings;
}

/**
 * "<provider> · <model>" when a provider is connected, "Not connected"
 * otherwise, `null` while unresolved (so a caller can render no status line at
 * all rather than a placeholder that turns out wrong).
 */
export function useAiConnectionStatusLine(): string | null {
  const { t } = useTranslation();
  const summary = deriveAiConnectionSummary(useLocalAiSettings());

  if (summary.status === 'loading') return null;
  if (summary.status === 'not-connected') return t('settings.rows.ai.notConnected');
  return t('settings.rows.ai.connected', { provider: t(summary.providerLabelKey), model: summary.model });
}
