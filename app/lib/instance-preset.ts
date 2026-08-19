/**
 * The instance-preset → device-settings translation (M138 spec 06), as one pure
 * function.
 *
 * A self-hoster who runs openplate next to an `openplate-inference` container
 * sets three env vars and every browser on that instance gets a one-click
 * "connect" instead of the whole bring-your-own-key errand. What that click
 * writes is an ORDINARY `openai-compatible` BYOK row — same provider, same
 * store, same `putLocalAiSettings` path a hand-typed endpoint takes. There is
 * deliberately no new provider concept, no registry entry and no second
 * settings shape: the only difference from a manual connect is who supplied the
 * base URL and key, which is exactly what `connectedVia: 'preset'` records.
 *
 * Kept out of the component so the mapping is unit-testable without a DOM, a
 * store or a clock: `now` is a parameter, not a `Date.now()` call.
 */
import type { InstanceInferencePreset } from '#app/config/public-config';
import type { LocalAiSettings } from '#app/lib/local-store';

/**
 * The settings row a preset connect saves.
 *
 * `apiKey` falls back to the empty string when the endpoint needs no key: a
 * local `openplate-inference`/Ollama container commonly accepts an unauthenticated
 * request, and `LocalAiSettings.apiKey` is a plain `string`. The adapter sends
 * `Authorization: Bearer ` in that case, which such endpoints ignore. Storing
 * `''` rather than inventing a placeholder also keeps the settings page honest:
 * there is no key here to disconnect from anything.
 */
export function buildPresetAiSettings({
  preset,
  now,
}: {
  preset: InstanceInferencePreset;
  now: number;
}): LocalAiSettings {
  return {
    provider: 'openai-compatible',
    model: preset.model,
    baseUrl: preset.baseUrl,
    apiKey: preset.apiKey ?? '',
    connectedVia: 'preset',
    updatedAt: now,
  };
}
