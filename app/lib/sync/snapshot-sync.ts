/**
 * The PURE core of sync: turning a local-store snapshot into a stamped sync
 * payload, and merging two payloads into one. No fetch, no crypto, no
 * IndexedDB, no clock — everything here is a function of its arguments, which
 * is what makes convergence testable without a server (`functional-core`).
 *
 * ── Where the Lamport stamps come from ────────────────────────────────────
 *
 * The app's write paths (`primary-store.ts`, every route's `clientAction`)
 * know nothing about sync and were deliberately left that way: threading a
 * "bump the sync counter" call through every one of them would put sync in the
 * blast radius of every future feature, and a single missed call site produces
 * a silently non-converging device.
 *
 * Instead each sync cycle DIFFS the current snapshot against the last-synced
 * BASELINE (per-entity content hashes kept in `sync-state.ts`):
 *   - content changed  → `lamport = previous + 1`, stamped with THIS device
 *   - content the same → the previous stamp is carried forward untouched
 *   - entity gone      → a tombstone at `previous + 1`
 *   - entity is back   → a live stamp above any tombstone for it (resurrection)
 *
 * This is a genuine Lamport clock — a stamp only advances when something
 * actually happened — and it costs the rest of the app exactly nothing. The
 * price is granularity: an edit-then-undo between two syncs is invisible,
 * which is the correct outcome anyway.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 *
 * Conflict resolution is whole-record last-writer-wins per entity, ordered by
 * `(lamport, deviceId)` — `PROTOCOL.md` §3.3's accepted v1 trade-off. Two
 * devices editing the SAME entry offline means the lower stamp is dropped
 * silently. No field-level merge, no conflict UI. Wall-clock time is never an
 * ordering authority: it drifts, and across devices it is routinely wrong.
 */
import { mergeEntityMaps } from './engine/merge/merge-entities';
import type { MergeCandidate, Tombstone } from './engine/merge/types';
import type { SyncMetaPayload } from './engine/envelope/types';
import type {
  LocalFoodLog,
  LocalPersonalFood,
  LocalProfileGoals,
  LocalStoreSnapshot,
  LocalWeightEntry,
} from '#app/lib/local-store';

/** The entity-type tags that appear in tombstones and in namespaced entity keys. */
export const SYNC_ENTITY_TYPES = {
  food: 'personalFood',
  log: 'foodLog',
  weight: 'weightEntry',
  profile: 'profile',
} as const;

/** The fixed entity id of the singleton profile row — it has no id of its own. */
export const PROFILE_ENTITY_ID = 'me';

/** One entity's ordering stamp plus the content hash that decides whether it changed. Device-local; the hash never goes on the wire. */
export interface StampedEntity {
  lamport: number;
  deviceId: string;
  /** Content hash of the entity as of the last sync. Absent from the wire payload — it is baseline bookkeeping, not protocol. */
  hash: string;
}

/** The last-synced baseline this device compares against. */
export interface SyncBaseline {
  perEntity: Record<string, StampedEntity>;
  tombstones: Tombstone[];
}

/** A stamped payload, ready to encrypt (or just merged out of two others). */
export interface StampedSnapshot {
  snapshot: LocalStoreSnapshot;
  meta: SyncMetaPayload;
}

/** Namespaced entity key: `personalFood:abc`. Namespacing prevents a food and a log that share an id from colliding. */
export function entityKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

/**
 * The hasher is generic over its input on purpose.
 *
 * It walks whatever it is handed structurally — a `LocalFoodLog`, a stamped
 * payload, a nested array, a number — and every caller passes a value whose
 * type is already known at the call site, so the type parameter carries that
 * knowledge through instead of throwing it away. A recursive JSON type would
 * not work here: the local-store entities are `interface`s, which TypeScript
 * refuses to assign to an index-signature type.
 */

/**
 * Deterministic JSON with sorted object keys.
 *
 * `JSON.stringify` preserves insertion order, so two structurally identical
 * entities written by different code paths can serialize differently — which
 * would read as "changed" on every single sync and re-push the whole store
 * forever. Sorting the keys removes that.
 */
export function stableStringify<T>(value: T): string {
  if (!(value instanceof Object)) return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .toSorted(([a], [b]) =>
      a < b ? -1
      : a > b ? 1
      : 0,
    );
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
}

/**
 * 64-bit FNV-1a, as two interleaved 32-bit lanes, rendered hex.
 *
 * 64 bits rather than 32 because a hash collision here is not a crash but a
 * SILENTLY unsynced edit — the change-detection would say "unchanged" and the
 * entity would never leave the device. Two 32-bit lanes are used instead of
 * BigInt purely for speed: this runs over every entity on every sync.
 */
export function contentHash<T>(value: T): string {
  const text = stableStringify(value);
  let lowHash = 0x811c9dc5;
  let highHash = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    lowHash = Math.imul(lowHash ^ code, 0x01000193) >>> 0;
    highHash = Math.imul(highHash ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return lowHash.toString(16).padStart(8, '0') + highHash.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Stamping: snapshot + baseline -> stamped payload
// ---------------------------------------------------------------------------

/** The four local-store records sync carries — everything `flattenSnapshot` can produce. */
export type SyncEntityValue = LocalPersonalFood | LocalFoodLog | LocalWeightEntry | LocalProfileGoals;

interface FlatEntity {
  key: string;
  entityType: string;
  entityId: string;
  value: SyncEntityValue;
}

/** Flattens a snapshot into one addressable list, so stamping/merging is written once rather than four times. */
function flattenSnapshot(snapshot: LocalStoreSnapshot): FlatEntity[] {
  const flattened: FlatEntity[] = [
    ...snapshot.foods.map((food) => toFlat(SYNC_ENTITY_TYPES.food, food.id, food)),
    ...snapshot.foodLogs.map((log) => toFlat(SYNC_ENTITY_TYPES.log, log.id, log)),
    ...snapshot.weightEntries.map((entry) => toFlat(SYNC_ENTITY_TYPES.weight, entry.id, entry)),
  ];
  if (snapshot.profile !== null) {
    flattened.push(toFlat(SYNC_ENTITY_TYPES.profile, PROFILE_ENTITY_ID, snapshot.profile));
  }
  return flattened;
}

function toFlat(entityType: string, entityId: string, value: SyncEntityValue): FlatEntity {
  return { key: entityKey(entityType, entityId), entityType, entityId, value };
}

/** What one stamping pass produces: the wire meta to send, and the baseline to persist alongside it. */
export interface StampSnapshotResult {
  meta: SyncMetaPayload;
  baseline: SyncBaseline;
}

/**
 * Stamps the current snapshot against the last-synced baseline.
 *
 * Returns BOTH the wire meta (no hashes — the service never sees them) and the
 * refreshed baseline, so the caller persists exactly what it just sent.
 */
export function stampSnapshot({
  snapshot,
  baseline,
  deviceId,
}: {
  snapshot: LocalStoreSnapshot;
  baseline: SyncBaseline;
  deviceId: string;
}): StampSnapshotResult {
  const live = flattenSnapshot(snapshot);
  const liveKeys = new Set(live.map((entity) => entity.key));
  const tombstonesByKey = new Map(
    baseline.tombstones.map((tombstone) => [entityKey(tombstone.entityType, tombstone.entityId), tombstone] as const),
  );

  const perEntity: Record<string, StampedEntity> = {};
  for (const entity of live) {
    const previous = baseline.perEntity[entity.key];
    const hash = contentHash(entity.value);
    const buried = tombstonesByKey.get(entity.key);
    // A resurrected entity must outrank its own tombstone, or the merge would
    // keep deleting it on every sync — the classic "the row I re-added keeps
    // vanishing" bug.
    const floor = Math.max(previous?.lamport ?? 0, buried?.lamport ?? 0);
    perEntity[entity.key] =
      previous !== undefined && previous.hash === hash && buried === undefined ?
        previous
      : { lamport: floor + 1, deviceId, hash };
  }

  const tombstones: Tombstone[] = [];
  for (const [key, tombstone] of tombstonesByKey) {
    if (!liveKeys.has(key)) tombstones.push(tombstone);
  }
  for (const [key, previous] of Object.entries(baseline.perEntity)) {
    if (liveKeys.has(key) || tombstonesByKey.has(key)) continue;
    const [entityType, ...idParts] = key.split(':');
    tombstones.push({
      entityId: idParts.join(':'),
      entityType: entityType ?? '',
      lamport: previous.lamport + 1,
      deviceId,
    });
  }

  return {
    meta: { perEntity: toWireStamps(perEntity), tombstones },
    baseline: { perEntity, tombstones },
  };
}

function toWireStamps(perEntity: Record<string, StampedEntity>): SyncMetaPayload['perEntity'] {
  return Object.fromEntries(
    Object.entries(perEntity).map(([key, stamp]) => [key, { lamport: stamp.lamport, deviceId: stamp.deviceId }]),
  );
}

// ---------------------------------------------------------------------------
// Merging: two stamped payloads -> one
// ---------------------------------------------------------------------------

function toCandidateMap(payload: StampedSnapshot) {
  const candidates: Record<string, MergeCandidate<FlatEntity>> = {};
  for (const entity of flattenSnapshot(payload.snapshot)) {
    // An entity present in the snapshot but missing from `perEntity` came from
    // a peer that predates stamping (or a hand-restored blob). Stamp 0 is the
    // right default: it loses to anything that ever carried a real stamp, and
    // still beats nothing at all.
    const stamp = payload.meta.perEntity[entity.key] ?? { lamport: 0, deviceId: '' };
    candidates[entity.key] = { entityId: entity.key, lamport: stamp.lamport, deviceId: stamp.deviceId, value: entity };
  }
  for (const tombstone of payload.meta.tombstones) {
    const key = entityKey(tombstone.entityType, tombstone.entityId);
    const existing = candidates[key];
    // A payload should never carry both, but if it does, the higher stamp is
    // the honest reading of what that device last knew.
    if (existing !== undefined && existing.lamport >= tombstone.lamport) continue;
    candidates[key] = { entityId: key, lamport: tombstone.lamport, deviceId: tombstone.deviceId, value: null };
  }
  return candidates;
}

/**
 * Merges the local payload with a just-pulled remote one.
 *
 * Deterministic and symmetric: both devices running this over the same pair of
 * inputs land on byte-identical output, which is what makes "push, lose the
 * CAS, pull, merge, re-push" terminate instead of ping-ponging.
 */
export function mergeSnapshots({
  local,
  remote,
}: {
  local: StampedSnapshot;
  remote: StampedSnapshot;
}): StampedSnapshot {
  const merged = mergeEntityMaps(toCandidateMap(local), toCandidateMap(remote));

  const foods: LocalPersonalFood[] = [];
  const foodLogs: LocalFoodLog[] = [];
  const weightEntries: LocalWeightEntry[] = [];
  let profile: LocalProfileGoals | null = null;
  const perEntity: SyncMetaPayload['perEntity'] = {};
  const tombstones: Tombstone[] = [];

  for (const key of Object.keys(merged).toSorted()) {
    const candidate = merged[key];
    if (candidate === undefined) continue;
    if (candidate.value === null) {
      const [entityType, ...idParts] = key.split(':');
      tombstones.push({
        entityId: idParts.join(':'),
        entityType: entityType ?? '',
        lamport: candidate.lamport,
        deviceId: candidate.deviceId,
      });
      continue;
    }
    perEntity[key] = { lamport: candidate.lamport, deviceId: candidate.deviceId };
    const entity = candidate.value;
    // `flattenSnapshot` is the only producer of a `FlatEntity`, and each of its
    // `toFlat` calls pairs an `entityType` tag with a value taken from the
    // matching snapshot collection. The tag therefore decides which member of
    // `SyncEntityValue` `entity.value` is, which is what each cast below reads.
    if (entity.entityType === SYNC_ENTITY_TYPES.food) {
      // SAFETY: the `personalFood` tag is only ever attached to a `LocalPersonalFood`.
      foods.push(entity.value as LocalPersonalFood);
      continue;
    }
    if (entity.entityType === SYNC_ENTITY_TYPES.log) {
      // SAFETY: the `foodLog` tag is only ever attached to a `LocalFoodLog`.
      foodLogs.push(entity.value as LocalFoodLog);
      continue;
    }
    if (entity.entityType === SYNC_ENTITY_TYPES.weight) {
      // SAFETY: the `weightEntry` tag is only ever attached to a `LocalWeightEntry`.
      weightEntries.push(entity.value as LocalWeightEntry);
      continue;
    }
    if (entity.entityType === SYNC_ENTITY_TYPES.profile) {
      // SAFETY: the `profile` tag is only ever attached to the singleton `LocalProfileGoals`.
      profile = entity.value as LocalProfileGoals;
    }
  }

  // FASTS RIDE THROUGH FROM THE LOCAL SIDE, UNTOUCHED (M132).
  //
  // They are deliberately absent from `SYNC_ENTITY_TYPES`, `flattenSnapshot`
  // and `toCandidateMap`, so they are never stamped, never diffed against the
  // remote payload, never tombstoned, and never adopted from another device.
  // A fast round-trips through the LOCAL JSON backup only; the optional E2EE
  // sync feature does not merge fasts across devices yet.
  //
  // That is a scope boundary, not an oversight: the "at most one open fast"
  // invariant is a genuinely hard cross-device question (two phones both
  // holding a running fast have two truthful answers, and picking one writes a
  // duration nobody declared into somebody's history), and it needs its own
  // design pass rather than falling out of a last-writer-wins merge. Passing
  // `local` through keeps this device's own fasts intact through every sync
  // cycle instead of silently emptying them, which a bare `fasts: []` here
  // would do on the very first merge.
  return {
    snapshot: { foods, foodLogs, weightEntries, profile, fasts: local.snapshot.fasts },
    meta: { perEntity, tombstones },
  };
}

/**
 * Rebuilds a baseline from a payload this device has just agreed with (either
 * pushed or adopted wholesale).
 *
 * Recomputing the hashes here — rather than carrying the local ones forward —
 * is what makes the NEXT cycle see "nothing changed" after adopting a remote
 * entity. Skip it and every sync re-pushes the whole store.
 */
export function baselineFromPayload(payload: StampedSnapshot): SyncBaseline {
  const perEntity: Record<string, StampedEntity> = {};
  for (const entity of flattenSnapshot(payload.snapshot)) {
    const stamp = payload.meta.perEntity[entity.key] ?? { lamport: 0, deviceId: '' };
    perEntity[entity.key] = { lamport: stamp.lamport, deviceId: stamp.deviceId, hash: contentHash(entity.value) };
  }
  return { perEntity, tombstones: payload.meta.tombstones };
}

/**
 * Whether two payloads are the same in every way that matters on the wire.
 *
 * The orchestrator uses this to SKIP a push when the merge contributed
 * nothing. Without it, every boot of every device would write a new blob
 * version — burning the 5-version retention window, and turning "open the app"
 * into a write.
 */
export function payloadsEqual(a: StampedSnapshot, b: StampedSnapshot): boolean {
  return stableStringify(canonicalize(a)) === stableStringify(canonicalize(b));
}

/** Stable order for an id-bearing collection, so two devices serialize the same set identically. */
function byId<T extends { id: string }>(items: T[]): T[] {
  return items.toSorted((x, y) => (x.id < y.id ? -1 : 1));
}

function canonicalize(payload: StampedSnapshot) {
  return {
    snapshot: {
      foods: byId(payload.snapshot.foods),
      foodLogs: byId(payload.snapshot.foodLogs),
      weightEntries: byId(payload.snapshot.weightEntries),
      profile: payload.snapshot.profile,
      // `fasts` is deliberately omitted, for the same reason `mergeSnapshots`
      // passes it straight through: it is not synced, so a fast starting or
      // ending must not be what makes this device burn a blob version.
    },
    meta: {
      perEntity: payload.meta.perEntity,
      tombstones: payload.meta.tombstones.toSorted((x, y) =>
        entityKey(x.entityType, x.entityId) < entityKey(y.entityType, y.entityId) ? -1 : 1,
      ),
    },
  };
}
