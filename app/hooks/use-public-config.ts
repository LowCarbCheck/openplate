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
import { getInstancePolicy, type InstancePolicy } from '#app/config/instance-policy';

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

/**
 * WHAT THIS INSTANCE'S MODE CHANGES, as named questions (M201 spec 07).
 *
 * Replaces `useManagedInstance()`, which handed every screen the same bare
 * boolean and left each one to work out for itself what the mode implied. The
 * questions and their answers live in `#app/config/instance-policy`, which is
 * pure, and the reasons are written there.
 *
 * Same contract as the hooks above: one hook, so the policy has exactly one
 * answer per render and cannot be one thing on the welcome screen and another
 * on the join screen. A screen that only wants to know whether any sync UI may
 * render asks `useSyncServerUrl()` instead, because a self-hoster can configure
 * sync on an OPEN instance and the two questions differ there.
 */
export function useInstancePolicy(): InstancePolicy {
  return getInstancePolicy(usePublicConfig());
}
