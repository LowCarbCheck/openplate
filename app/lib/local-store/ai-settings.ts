/**
 * Client-side BYOK AI-provider settings (M117/02, the client-side-vision
 * pivot). The provider/model/base URL/API key live ONLY in this on-device
 * store — no request in the app ever sends them to the openplate server. This
 * is a deliberately SEPARATE store from the primary health-data tables
 * (`primary-store.ts`): a backup/export of a user's tracker data must never
 * carry their API key, so settings live in their own IndexedDB database (see
 * `store.ts`'s `AI_DB_NAME`) and are excluded from `backup.ts`'s envelope.
 *
 * A singleton row (`AI_SETTINGS_ROW_ID`), same pattern as
 * `primary-store.ts`'s `LocalProfileGoals` — one BYOK configuration per
 * device, matching `user_ai_settings`' old one-row-per-user shape.
 */
import type { Store } from 'tinybase';
import { z } from 'zod';
import type { AiProviderType } from '#types/enums';
import { AI_ENTITY_CELL, AI_SETTINGS_ROW_ID, AI_SETTINGS_TABLE } from './store';
import { getAiStore } from './persist';

/**
 * How the API key was provisioned — 'oauth' for the OpenRouter PKCE connect
 * flow (`routes/oauth.openrouter.callback.tsx`), 'manual' for a pasted key
 * (`routes/settings.ai.tsx`), 'preset' for this instance's own operator-provided
 * endpoint (`components/instance-preset-connect.tsx`, M138 spec 06), 'invite' for
 * a gateway someone else runs, joined from an emailed invite link
 * (`routes/connect-gateway.tsx`). Read-only
 * display detail (the AI settings page's connected summary) — never gates
 * behavior.
 *
 * Widening this union is cheap for the same reason adding the field was (see
 * `LocalAiSettings.connectedVia`): a settings row is one opaque JSON blob, not
 * versioned columns, so no stored row needs migrating. What it is NOT cheap for
 * is copy — every surface that words this value needs the third wording, which
 * is why the summary and the disconnect dialog both branch on it explicitly
 * rather than defaulting.
 */
export type AiConnectionMethod = 'oauth' | 'manual' | 'preset' | 'invite';

/** The device's BYOK configuration. `apiKey` never leaves this store. */
export interface LocalAiSettings {
  provider: AiProviderType;
  model: string;
  baseUrl: string | null;
  apiKey: string;
  /**
   * Defaults to 'manual' when reading a settings row saved before this field
   * existed — see `getLocalAiSettings`'s backward-compat fill-in below. This
   * is a cheap, non-breaking addition: settings are a single opaque JSON
   * blob in one TinyBase cell (not versioned columns), so an older row
   * simply parses with this field absent, not wrong.
   */
  connectedVia: AiConnectionMethod;
  /**
   * `true` when the endpoint's administrator can review what is submitted to it
   * — today only a gateway joined by invite says so (`connectedVia: 'invite'`,
   * `routes/connect-gateway.tsx`). ABSENT on every other row, which is why it is
   * optional rather than defaulted: "we were never told" and "we were told no"
   * are the same thing for display purposes, and both must render no notice.
   *
   * Persisted rather than re-fetched so the settings page can render the notice
   * offline. It is a snapshot of what the gateway declared at join time.
   */
  auditEnabled?: boolean;
  /** Epoch-ms of the last save — display-only. */
  updatedAt: number;
}

interface StoreOption {
  store?: Store;
}

/** The entity cell as it comes back off the store — a TinyBase cell, not yet JSON text. */
const entityCellSchema = z.string();

async function resolveStore(store: Store | undefined): Promise<Store> {
  return store ?? (await getAiStore());
}

/** The device's saved BYOK settings, or null when never configured. */
export async function getLocalAiSettings({ store }: StoreOption = {}): Promise<LocalAiSettings | null> {
  const resolved = await resolveStore(store);
  if (!resolved.hasRow(AI_SETTINGS_TABLE, AI_SETTINGS_ROW_ID)) return null;
  const raw = entityCellSchema.safeParse(resolved.getCell(AI_SETTINGS_TABLE, AI_SETTINGS_ROW_ID, AI_ENTITY_CELL));
  if (!raw.success) return null;
  try {
    // SAFETY: this cell is written only by `putLocalAiSettings` below, which
    // stores `JSON.stringify(LocalAiSettings)` — the parse of a value this
    // module alone produces. A malformed/foreign value throws and is caught.
    const parsed = JSON.parse(raw.data) as LocalAiSettings;
    // Backward-compat: rows saved before `connectedVia` existed simply lack
    // the field — default them to 'manual' rather than treating an old row
    // as broken.
    return { ...parsed, connectedVia: parsed.connectedVia ?? 'manual' };
  } catch {
    return null;
  }
}

/** Saves (overwrites) the device's BYOK settings. */
export async function putLocalAiSettings(
  settings: LocalAiSettings,
  { store }: StoreOption = {},
): Promise<LocalAiSettings> {
  const resolved = await resolveStore(store);
  resolved.setRow(AI_SETTINGS_TABLE, AI_SETTINGS_ROW_ID, { [AI_ENTITY_CELL]: JSON.stringify(settings) });
  return settings;
}

/** Clears the device's BYOK settings ("Disconnect"). */
export async function deleteLocalAiSettings({ store }: StoreOption = {}): Promise<void> {
  const resolved = await resolveStore(store);
  resolved.delRow(AI_SETTINGS_TABLE, AI_SETTINGS_ROW_ID);
}
