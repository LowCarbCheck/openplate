/**
 * WHAT THE ACTIVE AI ENDPOINT SAYS IT CAN DO, as a hook.
 *
 * A self-hosted openplate-inference service runs one task, plate photos, and
 * says so in its own `GET {baseUrl}/models` (`#app/lib/ai/provider-capabilities`).
 * Every screen that sends a task to the person's provider asks this hook first,
 * so a task the server cannot run is said BEFORE the tap rather than as a 400
 * after it.
 *
 * ── It takes the settings the caller already resolved ───────────────────
 *
 * The argument is an `EffectiveAiSettings`, the same value `useAiIntake` and
 * `useEffectiveAiSettings` answer. A route that already holds one passes it, so
 * the device's AI row is read ONCE per screen: a second hook that read the row
 * on its own would be a second IndexedDB round trip for a value the screen has
 * in hand, and could disagree with it for a frame. The provider triple comes
 * out of `resolveProviderTriple`, the one place a managed instance and a BYOK
 * row become the three values a call needs.
 *
 * ── Who is asked, and who is not ────────────────────────────────────────
 *
 * Only a provider whose registry entry says `publishesCapabilities`, with a
 * base URL, is probed. A cloud vendor, the managed account proxy and a device
 * with no provider make NO request and read as full capabilities, immediately.
 *
 * ── It fails open, and says when it has not answered yet ────────────────
 *
 * Until the probe settles the hook returns `FULL_PROVIDER_CAPABILITIES` and
 * `settled: false`. A failed probe settles as full too: the probe can narrow
 * what the app offers and can never block a task by failing. A screen that
 * spends something on arrival (the recipes) waits for `settled`, which is
 * bounded by the probe's own timeout; a screen that offers a tap does not.
 */
import { useEffect, useState } from 'react';

import type { EffectiveAiSettings } from '#app/lib/ai/managed-ai-settings';
import {
  FULL_PROVIDER_CAPABILITIES,
  fetchProviderCapabilities,
  type ProviderCapabilities,
} from '#app/lib/ai/provider-capabilities';
import { resolveProviderTriple } from '#app/lib/ai/provider-triple';
import { publishesCapabilities } from '#app/services/vision/registry';

/** What one probe is sent: the endpoint, the key it takes, and the model whose entry is read. */
export interface CapabilityProbeTarget {
  baseUrl: string;
  /** `''` for an endpoint that takes no key (`buildPresetAiSettings`). */
  apiKey: string;
  modelId: string;
}

/** What a screen reads: the capabilities, and whether the endpoint has answered. */
export interface ProviderCapabilitiesState {
  capabilities: ProviderCapabilities;
  /** `false` only while a probe is in flight. A failed probe is settled, as full. */
  settled: boolean;
}

/** A probe's answer, kept with the key it was asked for so a changed target never reads a stale one. */
export interface CapabilityAnswer {
  key: string;
  capabilities: ProviderCapabilities;
}

/**
 * The endpoint to ask, or `null` when nothing should be asked.
 *
 * PURE. `null` is every case that must make no request: no settings, a managed
 * instance, a vendor with a fixed endpoint, a provider this build does not
 * know, and a row with no model or no base URL (`resolveProviderTriple` says
 * so for the first, and a blank base URL is refused here).
 *
 * @param effective - what the settings rule resolved, or `null` for no AI.
 * @returns the probe's inputs, or `null`.
 */
export function resolveCapabilityProbeTarget(effective: EffectiveAiSettings | null): CapabilityProbeTarget | null {
  if (effective === null) return null;
  if (effective.source !== 'stored') return null;
  const triple = resolveProviderTriple(effective);
  if (triple === null) return null;
  if (!publishesCapabilities(triple.provider)) return null;
  const baseUrl = (triple.baseUrl ?? '').trim();
  if (baseUrl === '') return null;
  return { baseUrl, apiKey: effective.settings.apiKey ?? '', modelId: triple.model };
}

/**
 * The identity of one probe, so an answer is only ever read for the endpoint
 * and model it was asked about. The key is left out: it changes nothing the
 * endpoint says, and it must not sit in a state value.
 */
export function capabilityProbeKey(target: CapabilityProbeTarget): string {
  return JSON.stringify([target.baseUrl, target.modelId]);
}

/**
 * THE PURE HALF OF THE HOOK: given the probe's target and the answer held so
 * far, what a screen reads.
 *
 * No target settles at once as full, because there is nothing to ask. A target
 * with no answer for ITS key is unsettled and reads as full. An answer held for
 * another key (the person changed the endpoint) is not this target's answer.
 *
 * @param input.target - from {@link resolveCapabilityProbeTarget}.
 * @param input.answer - the last answer a probe delivered, or `null`.
 */
export function resolveProviderCapabilitiesState({
  target,
  answer,
}: {
  target: CapabilityProbeTarget | null;
  answer: CapabilityAnswer | null;
}): ProviderCapabilitiesState {
  if (target === null) return { capabilities: FULL_PROVIDER_CAPABILITIES, settled: true };
  if (answer === null || answer.key !== capabilityProbeKey(target)) {
    return { capabilities: FULL_PROVIDER_CAPABILITIES, settled: false };
  }
  return { capabilities: answer.capabilities, settled: true };
}

/**
 * What the active provider can do, asked once per session per endpoint.
 *
 * NEVER THROWS: `fetchProviderCapabilities` answers full on every failure, and
 * the cache underneath it keeps an answer for the life of the page, so a second
 * screen asking the same endpoint costs nothing.
 *
 * @param effective - the settings the caller already resolved, or `null`.
 */
export function useProviderCapabilities(effective: EffectiveAiSettings | null): ProviderCapabilitiesState {
  const target = resolveCapabilityProbeTarget(effective);
  const [answer, setAnswer] = useState<CapabilityAnswer | null>(null);
  // PRIMITIVES, not the target object: it is built again on every render, and
  // an effect keyed on it would probe on every render.
  const baseUrl = target?.baseUrl ?? null;
  const apiKey = target?.apiKey ?? '';
  const modelId = target?.modelId ?? null;

  useEffect(() => {
    if (baseUrl === null || modelId === null) return;
    const key = capabilityProbeKey({ baseUrl, apiKey, modelId });
    let isMounted = true;
    const ask = async (): Promise<void> => {
      const capabilities = await fetchProviderCapabilities({ baseUrl, apiKey, modelId });
      if (isMounted) setAnswer({ key, capabilities });
    };
    void ask();
    return () => {
      isMounted = false;
    };
  }, [baseUrl, apiKey, modelId]);

  return resolveProviderCapabilitiesState({ target, answer });
}
