/**
 * Browser-side reader for the root loader's `publicConfig` — the app's one
 * server → browser configuration channel (`app/config/public-config.ts`).
 *
 * Reads through `useRouteLoaderData('root')` rather than `useLoaderData` for
 * the same reason `root.tsx`'s `Layout` does: this hook is called from
 * components that also render inside error boundaries, where the root loader
 * may never have run. `undefined` there is not a bug, and every sync surface
 * treats "no config" exactly like "sync off" — the safe direction.
 */
import { useRouteLoaderData } from 'react-router';
import type { loader as rootLoader } from '#app/root';
import {
  getInstanceInferencePreset,
  isSyncConfigured,
  type InstanceInferencePreset,
  type PublicConfig,
} from '#app/config/public-config';

/** The root loader's public config, or `undefined` when the root loader hasn't run (error boundaries). */
export function usePublicConfig(): PublicConfig | undefined {
  return useRouteLoaderData<typeof rootLoader>('root')?.publicConfig;
}

/**
 * The configured sync server's base URL, or `null` when sync is off.
 *
 * THE GATE: every sync surface in the app funnels through this one hook, so
 * "does sync exist here" has exactly one answer per render. A component that
 * gets `null` must render nothing sync-related and must not construct a sync
 * client — the requirement is zero UI AND zero requests, not a disabled
 * button.
 */
export function useSyncServerUrl(): string | null {
  const config = usePublicConfig();
  return isSyncConfigured(config) ? (config?.syncServerUrl ?? null) : null;
}

/**
 * The instance's own AI endpoint preset (M138 spec 06), or `null` when the
 * operator configured none — which is the default.
 *
 * Same contract as `useSyncServerUrl`: one hook per instance-level feature, so
 * "does this instance provide AI" has exactly one answer per render. `null`
 * means render nothing — not a disabled affordance.
 */
export function useInstanceInferencePreset(): InstanceInferencePreset | null {
  return getInstanceInferencePreset(usePublicConfig());
}
