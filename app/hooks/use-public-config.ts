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
  getGatewayUrl,
  getInstanceInferencePreset,
  isManagedInstanceConfig,
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

/**
 * Whether this instance is managed (M187 spec 03) — an instance that hands out
 * accounts and an AI connection together, through an invite link.
 *
 * Same contract as the two hooks above: one hook, so "is this a managed
 * instance" has exactly one answer per render and cannot be true on the
 * welcome screen and false on the join screen. `false` is the self-host
 * default and is today's app in full.
 */
export function useManagedInstance(): boolean {
  return isManagedInstanceConfig(usePublicConfig());
}

/**
 * The gateway this instance belongs to, or `null` when its operator configured
 * none — which is the default.
 *
 * A managed instance always has one, so this is also how a screen NAMES the
 * host a photo would go to before any invite has been redeemed.
 */
export function useGatewayUrl(): string | null {
  return getGatewayUrl(usePublicConfig());
}
