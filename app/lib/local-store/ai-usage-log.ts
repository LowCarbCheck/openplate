/**
 * Local-only AI-usage telemetry (M117/02). Replaces the server-side
 * `ai_usage_events` write path — removed from the scan flow along with the
 * server-mediated vision call — with a per-device event log kept entirely in
 * the local store, so the scan/settings pages can still show honest per-month
 * usage totals without a server write. Reuses the pure `getUtcMonthWindow` /
 * `MonthlyAiUsage` shape from `#app/models/ai-usage` (no DB import there —
 * safe to import from the browser) so the display formatters
 * (`formatMonthlyUsageLine` etc.) work unchanged against this local source.
 */
import type { Store } from 'tinybase';
import { z } from 'zod';
import type { AiProviderType, AiUsageOutcomeType } from '#types/enums';
import { getUtcMonthWindow } from '#app/models/ai-usage';
import { randomUuid } from '#app/lib/uuid';
import type { MonthlyAiUsage } from '#app/models/ai-usage';
import { AI_ENTITY_CELL, AI_USAGE_EVENTS_TABLE } from './store';
import { getAiStore } from './persist';

/** One recorded plate-identification attempt. Mirrors `ai_usage_events`' old row shape. */
export interface LocalAiUsageEvent {
  id: string;
  provider: AiProviderType;
  model: string;
  /** Null when the provider response omitted usage — never fabricated. */
  inputTokens: number | null;
  outputTokens: number | null;
  /** Null when pricing is unknown for the model (uncatalogued) — never defaulted to 0. */
  estimatedCostUsd: number | null;
  outcome: AiUsageOutcomeType;
  /** Epoch-ms the attempt was recorded. */
  createdAt: number;
}

interface StoreOption {
  store?: Store;
}

/** Caps the on-device log so it never grows unbounded across years of scanning. */
const MAX_LOCAL_USAGE_EVENTS = 1000;

/** The entity cell as it comes back off the store — a TinyBase cell, not yet JSON text. */
const entityCellSchema = z.string();

async function resolveStore(store: Store | undefined): Promise<Store> {
  return store ?? (await getAiStore());
}

function readEvent(store: Store, id: string): LocalAiUsageEvent | null {
  const raw = entityCellSchema.safeParse(store.getCell(AI_USAGE_EVENTS_TABLE, id, AI_ENTITY_CELL));
  if (!raw.success) return null;
  try {
    // SAFETY: this cell is written only by `recordLocalAiUsageEvent` below, which
    // stores `JSON.stringify(LocalAiUsageEvent)` — the parse of a value this
    // module alone produces. A malformed/foreign value throws and is caught.
    return JSON.parse(raw.data) as LocalAiUsageEvent;
  } catch {
    return null;
  }
}

/** Every recorded event, oldest first. */
export async function listLocalAiUsageEvents({ store }: StoreOption = {}): Promise<LocalAiUsageEvent[]> {
  const resolved = await resolveStore(store);
  return resolved
    .getRowIds(AI_USAGE_EVENTS_TABLE)
    .map((id) => readEvent(resolved, id))
    .filter((event): event is LocalAiUsageEvent => event !== null)
    .toSorted((a, b) => a.createdAt - b.createdAt);
}

/** Drops the oldest events past the retention cap — called right after a write. */
function enforceUsageCap(store: Store): void {
  const ids = store.getRowIds(AI_USAGE_EVENTS_TABLE);
  if (ids.length <= MAX_LOCAL_USAGE_EVENTS) return;
  const entries = ids
    .map((id) => ({ id, createdAt: readEvent(store, id)?.createdAt ?? 0 }))
    .toSorted((a, b) => a.createdAt - b.createdAt);
  const overflowCount = entries.length - MAX_LOCAL_USAGE_EVENTS;
  for (const entry of entries.slice(0, overflowCount)) store.delRow(AI_USAGE_EVENTS_TABLE, entry.id);
}

/**
 * Records one identify attempt. Best-effort: a bookkeeping failure is
 * swallowed so it can never affect the scan flow — mirrors the old
 * `recordAiUsageEvent`'s fail-open contract.
 */
export async function recordLocalAiUsageEvent(
  input: Omit<LocalAiUsageEvent, 'id' | 'createdAt'> & { createdAt?: number },
  { store }: StoreOption = {},
): Promise<void> {
  try {
    const resolved = await resolveStore(store);
    const event: LocalAiUsageEvent = {
      id: randomUuid(),
      createdAt: input.createdAt ?? Date.now(),
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      estimatedCostUsd: input.estimatedCostUsd,
      outcome: input.outcome,
    };
    resolved.setRow(AI_USAGE_EVENTS_TABLE, event.id, { [AI_ENTITY_CELL]: JSON.stringify(event) });
    enforceUsageCap(resolved);
  } catch {
    // Best-effort — usage bookkeeping must never affect the scan flow.
  }
}

/**
 * True when the provider actually reported token usage for this attempt —
 * i.e. the call was billed. `inputTokens`/`outputTokens` are always set
 * together (see the adapters' `typeof x === 'number' && typeof y === 'number'`
 * usage-extraction guard) or not at all, so checking one is equivalent to
 * checking both; both are checked here for defensive clarity.
 */
function wasBilled(event: LocalAiUsageEvent): boolean {
  return event.inputTokens !== null && event.outputTokens !== null;
}

/**
 * True for a billed event that ultimately errored — the provider took the
 * tokens but the attempt still didn't produce a usable result (M123/09).
 * `event.outcome` is typed as always-present (`AiUsageOutcomeType`), but a
 * row written before outcome tracking existed, or a foreign/malformed row,
 * could parse back with the field missing at runtime despite the type —
 * `readEvent`'s `JSON.parse` cast has no schema validation on this field. A
 * missing outcome is treated as NOT failed (a success): defaulting unknown
 * history to "failed" would retroactively redraw a clean scan history as
 * broken, which is worse than under-counting a handful of pre-tracking rows.
 */
function wasFailed(event: LocalAiUsageEvent): boolean {
  return event.outcome === 'error';
}

/**
 * Pure aggregation — same shape/semantics as the old server-side
 * `getMonthlyAiUsage`. Only events the provider actually billed (`wasBilled`)
 * count toward `scanCount`/`totalCostUsd`/`unknownCostCount` — an attempt
 * that never reached the provider, or was rejected before it could run a
 * model (auth failure, network failure, rate limit), consumed zero tokens
 * and cost the user nothing, so it must not inflate "scans this month" or
 * get misreported as a `<unknownCostCount>` mystery charge. Previously this
 * summed every event in the window regardless of whether it was billed —
 * a user with a rejected key would see "1 scan · cost unknown for your
 * model" for a call that never ran and never cost them anything.
 *
 * `successCount`/`failedCount` (M123/09) split that same billed population
 * by outcome, so a run of billed-but-errored attempts — e.g. the doubled
 * response-format retries the vision adapters used to fire on every 4xx,
 * including ones a retry can't fix — reads as "N scans, M failed" instead of
 * silently inflating "N scans" into looking like N successful identifications.
 */
export function computeLocalMonthlyAiUsage(events: LocalAiUsageEvent[], now: Date): MonthlyAiUsage {
  const { start, end } = getUtcMonthWindow(now);
  const inWindow = events.filter((event) => event.createdAt >= start.getTime() && event.createdAt < end.getTime());
  const billed = inWindow.filter(wasBilled);
  const failedCount = billed.filter(wasFailed).length;
  return {
    scanCount: billed.length,
    totalCostUsd: billed.reduce((sum, event) => sum + (event.estimatedCostUsd ?? 0), 0),
    unknownCostCount: billed.filter((event) => event.estimatedCostUsd === null).length,
    inputTokens: billed.reduce((sum, event) => sum + (event.inputTokens ?? 0), 0),
    outputTokens: billed.reduce((sum, event) => sum + (event.outputTokens ?? 0), 0),
    successCount: billed.length - failedCount,
    failedCount,
  };
}

/** Store-reading shell wrapper — the scan/settings pages' primary read. */
export async function getLocalMonthlyAiUsage(
  now: Date = new Date(),
  { store }: StoreOption = {},
): Promise<MonthlyAiUsage> {
  const events = await listLocalAiUsageEvents({ store });
  return computeLocalMonthlyAiUsage(events, now);
}
