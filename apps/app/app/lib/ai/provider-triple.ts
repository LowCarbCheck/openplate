/**
 * The three values a provider call needs, out of whichever kind of AI settings
 * this instance resolved.
 *
 * ── Why it is not in a route any more (M233/05) ──────────────────────────
 *
 * It shipped as an export of `app/routes/pantry.tsx`, and `/pantry/recipes`
 * imported it from there. A route module is not an ordinary module: React
 * Router builds one chunk per route and splits a route module further per
 * export, so what a route file exports for a neighbour is decided by a bundler
 * rather than by the import. The sibling defect that made this concrete is
 * recorded in `app/lib/day-totals-from-logs.ts`, which the production build
 * dropped out of its own loader chunk.
 *
 * So the rule this file keeps: a route module is a LEAF. Anything two routes
 * both need lives under `app/lib/`, and a route never imports another route.
 */
import type { EffectiveAiSettings } from '#app/lib/ai/managed-ai-settings';
import type { AiProviderType } from '#types/enums';

/** Where a call goes and what it is signed with. `baseUrl` is null for a provider with a fixed one. */
export interface ProviderTriple {
  provider: AiProviderType;
  model: string;
  baseUrl: string | null;
}

/**
 * PURE, because it is the one place a managed instance and a BYOK device are
 * collapsed into one triple, and a mistake here is a scan sent to the wrong
 * endpoint with the wrong key. `null` means this device cannot call anything,
 * which a screen renders as the connect card rather than as an error: a managed
 * instance with an upstream key but no advertised model has nothing to send,
 * and inventing a model id would fail upstream with a message nobody on this
 * side could explain.
 *
 * @param effective - what `useEffectiveAiSettings` resolved, never `null` here.
 * @returns the provider, model and base URL to call with, or `null` when there is no usable triple.
 */
export function resolveProviderTriple(effective: EffectiveAiSettings): ProviderTriple | null {
  if (effective.source === 'managed') {
    if (effective.model === null) return null;
    return { provider: effective.provider, model: effective.model, baseUrl: effective.baseUrl };
  }
  const { settings } = effective;
  if (settings.model === '') return null;
  // A row saved before the base-URL requirement shipped can still carry
  // `baseUrl: null` for an openai-compatible provider. Caught here rather than
  // letting `createVisionProvider`'s own guard throw, so the screen can say so.
  if (settings.provider === 'openai-compatible' && (settings.baseUrl ?? '').trim() === '') return null;
  return { provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl };
}
