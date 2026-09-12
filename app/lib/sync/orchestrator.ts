/**
 * The sync cycle: snapshot → stamp → pull → decrypt → merge → encrypt → push,
 * with the mandatory compare-and-swap retry loop around it.
 *
 * This is the imperative shell (`functional-core`). Every decision it makes —
 * what changed, who wins a conflict, whether a push is even needed — is a call
 * into the pure `snapshot-sync.ts`; what lives here is ordering, I/O and the
 * retry policy. Both halves are injected (`SyncCycleDeps`), so the integration
 * suite drives the real algorithm against a protocol-faithful fake service
 * without a browser or a database.
 *
 * ── The 409 loop is mandatory, not an optimization ─────────────────────────
 *
 * `PROTOCOL.md` §5.1 is explicit: a client that treats `409` as fatal strands
 * the device permanently out of sync. Losing the CAS means another device
 * wrote first, which is a NORMAL outcome — pull it, merge it, re-encrypt with
 * the AAD bound to the NEW blob version, push again. Bounded by
 * `maxAttempts` so a pathologically busy account fails loudly instead of
 * spinning.
 *
 * ── Offline is a no-op, deliberately ──────────────────────────────────────
 *
 * There is no outbound queue. The local store IS the source of truth, so an
 * offline edit is already durable and the next successful cycle carries it up
 * whole. A queue would add a second representation of the same pending work,
 * and the two would eventually disagree.
 *
 * ── The AAD, and why schema versions are probed ───────────────────────────
 *
 * Decryption binds `{accountId, blobVersion, payloadSchemaVersion}`. The first
 * two travel on the wire; the third does not — so a device pulling a blob
 * written by a peer on an OLDER `SCHEMA_VERSION` has to know which value to
 * present before it can decrypt. It cannot, so it tries the current version
 * and then walks down. That is bounded (six attempts today, one cheap GCM
 * check each) and it buys real forward compatibility: an older peer's blob
 * decrypts and is migrated forward by the backup migration chain. A blob from
 * a NEWER schema still fails every attempt, which is the correct refusal —
 * this build genuinely cannot read it, and guessing would corrupt it.
 */
import { buildEnvelope, parseEnvelope } from './engine/envelope/build-envelope';
import type { SyncPayload } from './engine/envelope/types';
import { ENVELOPE_VERSION, MAX_BLOB_BYTES } from './engine/protocol';
import type { PushBlobHttpResult, SyncHttpClient } from './engine/client/http-client';
import { isSyncRequestError, SyncRequestError } from './engine/client/sync-error';
import { SCHEMA_VERSION } from '#app/lib/local-store';
import type { SyncedSnapshot } from './snapshot-partition';
import {
  baselineFromPayload,
  countRestoredEntities,
  mergeSnapshots,
  payloadsEqual,
  stampSnapshot,
  type MergedSnapshot,
  type SnapshotIntegrity,
  type StampedSnapshot,
} from './snapshot-sync';
import type { Tombstone } from './engine/merge/types';
import type { PersistedSyncState, SyncStateStore } from './sync-state';
import { withSyncOrchestratorLock } from './sync-lock';

/** How many CAS rounds a single cycle will fight for before giving up. */
export const DEFAULT_MAX_PUSH_ATTEMPTS = 5;

/** What {@link SyncCycleDeps.readSnapshot} hands back: the payload, and the evidence behind it. */
export interface ReadSnapshotResult {
  snapshot: SyncedSnapshot;
  integrity: SnapshotIntegrity;
}

export interface SyncCycleDeps {
  /** Binds the envelope's AAD — a blob cannot be replayed into another account. */
  accountId: number;
  /** The unwrapped data-encryption key. Held in memory for the session only, never persisted anywhere. */
  dek: Uint8Array;
  http: SyncHttpClient;
  state: SyncStateStore;
  deviceId: string;
  /**
   * The device snapshot AS SYNCED (the shareable region plus a sealed
   * compartment, `snapshot-partition.ts`), AND what this read can prove about
   * the storage it came out of.
   *
   * The evidence rides with the snapshot rather than arriving as its own
   * dependency because the two are one act: a snapshot is only as trustworthy
   * as the read that produced it, and an integrity record fetched separately
   * could describe a different moment.
   */
  readSnapshot: () => Promise<ReadSnapshotResult>;
  applySnapshot: (input: { merged: SyncedSnapshot; local: SyncedSnapshot }) => Promise<void>;
  /**
   * Drops the local delete-journal rows for the deletes this cycle has just
   * weighed and committed (`local-store/primary-store.ts`).
   *
   * A dependency rather than a direct import for the reason every other store
   * touch here is one: this file is the imperative shell and the integration
   * suite drives it against fakes. NOT OPTIONAL, so the question "who forgets
   * these rows?" is put in front of every caller, including the fixtures.
   */
  forgetPublishedDeletes: (keys: string[]) => Promise<void>;
  /**
   * The one veto point, run on the snapshot EXACTLY AS PULLED and before this
   * cycle writes anything (M164/06).
   *
   * Throwing aborts the cycle with nothing pushed. It exists because
   * `applySnapshot` — where the owner-private compartment is opened, and where
   * a wrong-kind compartment is refused — runs on the line after `pushBlob`, so
   * every refusal that lives inside it arrives one write too late. A diary
   * device signed into a STUDY account pushed the whole diary into that
   * account's blob before saying no.
   *
   * NOT OPTIONAL, deliberately. A default no-op would make "this cycle has no
   * veto" the silent state, and the defect this closes was exactly a check
   * nobody noticed was in the wrong place.
   *
   * It must be silent for every ordinary outcome — a compartment this device
   * cannot open, a blob with none, a fresh account. `assertOwnerPrivateCompartment`
   * is the production implementation and documents that boundary.
   */
  assertPulledSnapshot: (input: { pulled: SyncedSnapshot }) => Promise<void>;
  parseRemoteSnapshot: (input: { snapshot: unknown; schemaVersion: number }) => SyncedSnapshot;
  now?: () => number;
  maxAttempts?: number;
}

export interface SyncCycleResult {
  /** The blob version this device now agrees with. */
  blobVersion: number;
  /** Whether this cycle actually wrote a new blob (false when the merge contributed nothing). */
  pushed: boolean;
  /** How many CAS rounds it took. `1` is the uncontended case. */
  attempts: number;
  lastSyncedAt: number;
  /**
   * The deletes this cycle REFUSED to publish, because the device could not
   * prove they happened (`snapshot-sync.ts`).
   *
   * Empty on every ordinary cycle. Non-empty means this device's local copy is
   * missing rows its account still has, and the shell above owes the person a
   * sentence about it (`storage-heal.ts`) rather than a silent green tick.
   */
  withheldTombstones: Tombstone[];
  /**
   * The store tables whose REMOTE `fasts` or `savedMeals` list stood, because
   * this device could not account for the ids its own baseline recorded
   * (`PassThroughOutcome.refused`).
   *
   * The SECOND shape of the same loss `withheldTombstones` carries, and it is
   * reported separately because these two collections are not merged and mint
   * no tombstone at all. A cycle with an empty `withheldTombstones` and a table
   * in here still handed somebody their rows back.
   */
  refusedPassThroughTables: string[];
  /**
   * How many DIARY ROWS this cycle got back that this device could not vouch
   * for (`countRestoredEntities`).
   *
   * Not `withheldTombstones.length`, and the difference is the notice's
   * honesty. When the pull found no blob, nothing came back, and saying "your
   * entries were restored from your account" would be a sentence about a
   * restore that did not happen (`storage-heal.ts`). It counts the rows a
   * refused pass-through table adopted as well, and it never counts a held
   * compartment, which writes nothing to this device.
   */
  restoredEntityCount: number;
}

/**
 * Runs one full sync cycle under the device's single-writer lock.
 *
 * The lock wraps the WHOLE cycle rather than just the push: read-then-write
 * across two tabs is exactly the interleaving that produces a lost update, and
 * the CAS on the server only protects the blob, not this device's baseline.
 */
export async function runSyncCycle(deps: SyncCycleDeps): Promise<SyncCycleResult> {
  return withSyncOrchestratorLock(() => runSyncCycleUnlocked(deps));
}

/** The cycle itself, lock-free — exported for tests that supply their own serialization. */
export async function runSyncCycleUnlocked(deps: SyncCycleDeps): Promise<SyncCycleResult> {
  const now = deps.now ?? Date.now;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_PUSH_ATTEMPTS;

  const read = await deps.readSnapshot();
  const local = read.snapshot;
  const persisted = deps.state.load();
  const stamped = stampSnapshot({
    snapshot: local,
    baseline: persisted.baseline,
    deviceId: deps.deviceId,
    integrity: read.integrity,
  });
  const localPayload: StampedSnapshot = { snapshot: local, meta: stamped.meta };
  // THE CYCLE CONTINUES, IT DOES NOT REFUSE. Live entities still push, the
  // withheld deletes simply do not, and the pull below then hands this device
  // the server's copy back through the ordinary apply path. Refusing here
  // would strand somebody on an empty diary with a perfectly good copy one
  // request away.
  const withheldTombstones = stamped.withheld;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remote = await pullRemotePayload(deps);
    // BEFORE THE MERGE AND BEFORE THE PUSH, and re-run on every CAS round
    // because every round pulls a blob this device has not inspected yet.
    if (remote !== null) await deps.assertPulledSnapshot({ pulled: remote.payload.snapshot });
    const baseVersion = remote?.blobVersion ?? 0;
    // THE SAME EVIDENCE OBJECT the stamping above weighed, not a second read:
    // the merge decides whether this device's `fasts` and `savedMeals` can be
    // believed, and that question is about the read that produced this
    // snapshot, not about the storage a moment later.
    const merged: MergedSnapshot =
      remote === null ?
        // NO BLOB AT ALL, so there was no other list to weigh this device's
        // against and no decision to record. `published` stays empty on
        // purpose: the shrink guard compares a push against a STORED blob, and
        // there is none, so there is nothing to acknowledge.
        { ...localPayload, passThrough: { published: [], refused: [] } }
      : mergeSnapshots({
          local: localPayload,
          remote: remote.payload,
          integrity: read.integrity,
          baseline: persisted.baseline,
          deletedEntityKeys: read.integrity.deletedEntityKeys,
        });

    // The server refuses a push that shrinks a blob by more than half unless
    // the client says the shrink is intended. This cycle may only say so when
    // it published removals it can PROVE, and never when it withheld one.
    //
    // MINTED, NOT `meta.tombstones` (M225). The baseline never compacts its
    // tombstones, so `meta.tombstones` still names every delete this device
    // ever published, and a flag computed from it was true forever after the
    // device's first deleted entry, acknowledging every push it would ever
    // make and switching the service's guard off for exactly the people most
    // likely to need it. `minted` is the deletes that are NEW in this push, so
    // a cycle with nothing to delete acknowledges nothing.
    //
    // AND THE PASS-THROUGH REMOVALS BESIDE THEM. Clearing forty saved meals
    // mints no tombstone, because saved meals are not merged, so a flag built
    // from `minted` alone left that push looking like an unexplained shrink and
    // the service turned it down. It is computed INSIDE the loop because it now
    // depends on the merge, which depends on the blob this round pulled.
    const shrinkAcknowledged =
      (stamped.minted.length > 0 || merged.passThrough.published.length > 0) && withheldTombstones.length === 0;

    // Nothing local to contribute: adopt the remote blob as-is and stop. This
    // is the common case on every boot, and skipping the push is what keeps
    // "open the app" from consuming a blob version.
    //
    // AND NOTHING PUBLISHED FROM THE TWO PASS-THROUGH LISTS, which the equality
    // itself cannot see: `canonicalize` weighs neither `fasts` nor `savedMeals`,
    // so a cycle whose only change is a recorded clear looks equal to a blob
    // that still holds those rows, and adopting it would commit a baseline
    // without the cleared ids and prune the journal rows that prove the
    // removal. The next real push would then shrink the blob with nothing left
    // to acknowledge it with, which the service refuses. A published removal is
    // always a push, so the shrink is declared while the evidence still exists.
    if (remote !== null && payloadsEqual(merged, remote.payload) && merged.passThrough.published.length === 0) {
      await deps.applySnapshot({ merged: merged.snapshot, local });
      const settled = commitState({ deps, merged, blobVersion: baseVersion, at: now() });
      await forgetPublishedDeletes({ deps, deletedEntityKeys: read.integrity.deletedEntityKeys });
      return {
        blobVersion: baseVersion,
        pushed: false,
        attempts: attempt,
        lastSyncedAt: settled.lastSyncedAt ?? now(),
        withheldTombstones,
        refusedPassThroughTables: merged.passThrough.refused,
        restoredEntityCount: countRestoredEntities({
          withheld: withheldTombstones,
          merged: merged.snapshot,
          local,
          refused: merged.passThrough.refused,
        }),
      };
    }

    const targetVersion = baseVersion + 1;
    const envelope = await buildEnvelope({
      payload: toWirePayload(merged),
      dek: deps.dek,
      aadFields: { accountId: deps.accountId, blobVersion: targetVersion, payloadSchemaVersion: SCHEMA_VERSION },
    });

    // Mirror the service's cap client-side (`PROTOCOL.md` §8) so the failure
    // names the real problem instead of arriving as an opaque 413.
    if (envelope.ciphertext.byteLength > MAX_BLOB_BYTES) {
      throw new SyncRequestError({
        kind: 'too-large',
        message: `This device's encrypted diary is ${envelope.ciphertext.byteLength} bytes, over the ${MAX_BLOB_BYTES}-byte sync limit.`,
      });
    }

    const result = await pushOrHeal({ deps, merged, local, baseVersion, envelope, shrinkAcknowledged });
    if (result.status === 'conflict') continue;

    await deps.applySnapshot({ merged: merged.snapshot, local });
    const at = now();
    commitState({ deps, merged, blobVersion: result.newVersion, at });
    await forgetPublishedDeletes({ deps, deletedEntityKeys: read.integrity.deletedEntityKeys });
    return {
      blobVersion: result.newVersion,
      pushed: true,
      attempts: attempt,
      lastSyncedAt: at,
      withheldTombstones,
      refusedPassThroughTables: merged.passThrough.refused,
      restoredEntityCount: countRestoredEntities({
        withheld: withheldTombstones,
        merged: merged.snapshot,
        local,
        refused: merged.passThrough.refused,
      }),
    };
  }

  throw new SyncRequestError({
    kind: 'conflict',
    message: `Sync could not settle after ${maxAttempts} attempts — another device is writing continuously.`,
  });
}

/**
 * Pushes, and on a REFUSAL heals this device before the error leaves.
 *
 * ── The livelock this closes ──────────────────────────────────────────────
 *
 * A `400` from the service means the push was judged and nothing was written.
 * The one judgement the service makes about a payload it cannot read is the
 * SHRINK GUARD: a blob under half the size of the stored one, pushed by a
 * client that did not acknowledge the shrink. The device that trips it is, by
 * construction, a device that has lost its local copy, and until this
 * function existed the thrown error skipped `applySnapshot`, so the blob it
 * had just pulled, holding every entry it was missing, was decrypted, merged
 * and then discarded. Every later cycle did the same. The guard protected the
 * account and stranded the person: an empty diary on screen, a sync error
 * beside it, and the repair one already-completed request away.
 *
 * So the merge is applied FIRST and the error is rethrown after. That is the
 * same write the successful path performs, with the same arguments, and it is
 * safe for the same reason: `merged` is the local payload combined with the
 * remote one under the ordinary last-writer-wins rules, so it can only remove
 * a row the merge itself resolved as buried. The BASELINE is deliberately not
 * committed, because nothing was stored and this device must still consider
 * itself behind, and the next cycle stamps the healed snapshot, which no longer
 * shrinks, and settles.
 *
 * ONLY A `400`. A 401, a 429 or a transport failure means the service never
 * judged this payload; retrying the identical push is exactly right there, and
 * writing the merge on a cycle that failed before it was read would be doing
 * work on no evidence.
 */
async function pushOrHeal({
  deps,
  merged,
  local,
  baseVersion,
  envelope,
  shrinkAcknowledged,
}: {
  deps: SyncCycleDeps;
  merged: StampedSnapshot;
  local: SyncedSnapshot;
  baseVersion: number;
  envelope: { ciphertext: Uint8Array };
  shrinkAcknowledged: boolean;
}): Promise<PushBlobHttpResult> {
  try {
    return await deps.http.pushBlob({
      baseVersion,
      envelopeVersion: ENVELOPE_VERSION,
      ciphertext: envelope.ciphertext,
      shrinkAcknowledged,
    });
  } catch (cause) {
    // AN HTTP 400, and nothing else. `status` is checked beside `kind` because
    // `invalid` has a second producer with no status at all,
    // `decryptWithSchemaProbe` below, which cannot reach this `catch` today and
    // must never start healing on a blob it failed to decrypt if it ever does.
    if (!isSyncRequestError(cause) || cause.kind !== 'invalid' || cause.status !== 400) throw cause;
    await deps.applySnapshot({ merged: merged.snapshot, local });
    throw cause;
  }
}

/**
 * Forgets the delete-journal rows for every delete THIS CYCLE WEIGHED.
 *
 * The rule is one line: after a commit, forget every key that was in
 * `deletedEntityKeys` at THIS cycle's read. Each of those keys was put in front
 * of the cycle and answered, one of four ways, and all four are finished:
 *  - it minted a tombstone, which the committed baseline now carries;
 *  - it published a pass-through removal, which the committed baseline now
 *    records by no longer naming the id;
 *  - it lost, the remote list stood and the row is back on the device, so the
 *    key describes a row that exists;
 *  - it was never synced at all, created and deleted between two cycles, so
 *    no baseline ever named it and no peer ever saw it.
 *
 * THE OLD RULE WAS TOMBSTONES PLUS A PASS-THROUGH DIFF, and it never pruned
 * those last two classes, nor the stale keys a mid-flight delete leaves behind
 * (`local-store-bridge.ts`). The journal only grew.
 *
 * KEYS WRITTEN AFTER THE READ ARE NOT IN THE SET and therefore survive, which
 * is not an accident: that is exactly the mid-flight delete, and its journal
 * row is the only evidence the NEXT cycle has that the absence it is about to
 * see is a delete.
 *
 * AFTER `commitState`, never before: the journal row is the only thing that can
 * re-authorise a delete, and dropping it ahead of the baseline that carries the
 * tombstone would leave a window where neither says the delete happened. Both
 * call sites run it on a cycle that has already agreed with a payload. The
 * `400` path in `pushOrHeal` deliberately forgets nothing: nothing was stored,
 * so nothing was weighed.
 */
async function forgetPublishedDeletes({
  deps,
  deletedEntityKeys,
}: {
  deps: SyncCycleDeps;
  deletedEntityKeys: ReadonlySet<string>;
}): Promise<void> {
  if (deletedEntityKeys.size === 0) return;
  await deps.forgetPublishedDeletes([...deletedEntityKeys]);
}

interface RemotePayload {
  blobVersion: number;
  payload: StampedSnapshot;
}

async function pullRemotePayload(deps: SyncCycleDeps): Promise<RemotePayload | null> {
  const pulled = await deps.http.pullBlob();
  // A 404 is how a fresh account looks, not an error (`PROTOCOL.md` §5.2).
  if (pulled === null) return null;

  const decrypted = await decryptWithSchemaProbe({
    ciphertext: pulled.ciphertext,
    envelopeVersion: pulled.envelopeVersion,
    blobVersion: pulled.blobVersion,
    accountId: deps.accountId,
    dek: deps.dek,
  });

  return {
    blobVersion: pulled.blobVersion,
    payload: {
      snapshot: deps.parseRemoteSnapshot({
        snapshot: decrypted.payload.snapshot,
        schemaVersion: decrypted.schemaVersion,
      }),
      meta: decrypted.payload.syncMeta,
    },
  };
}

/**
 * Decrypts a pulled blob, walking `payloadSchemaVersion` down from this
 * build's current value until the GCM tag verifies (see the module header for
 * why the value cannot simply be read off the wire).
 *
 * Exported for `private-store-rewrap.ts`, which has to open a blob outside a
 * sync cycle. A second probe loop there would be a second place for the walk
 * to go out of step with `SCHEMA_VERSION`.
 *
 * Every attempt failing is reported as ONE clear error rather than the last
 * cipher exception: "wrong key or a newer app wrote this" is actionable;
 * "OperationError" is not.
 */
export async function decryptWithSchemaProbe({
  ciphertext,
  envelopeVersion,
  blobVersion,
  accountId,
  dek,
}: {
  ciphertext: Uint8Array;
  envelopeVersion: number;
  blobVersion: number;
  accountId: number;
  dek: Uint8Array;
}): Promise<{ payload: SyncPayload; schemaVersion: number }> {
  for (let schemaVersion = SCHEMA_VERSION; schemaVersion >= 1; schemaVersion -= 1) {
    try {
      const payload = await parseEnvelope({
        envelope: { envelopeVersion, ciphertext },
        dek,
        aadFields: { accountId, blobVersion, payloadSchemaVersion: schemaVersion },
      });
      return { payload, schemaVersion };
    } catch {
      // Wrong AAD guess, or genuinely undecryptable. Keep walking down; the
      // loop's exhaustion below is the only place this becomes an error.
    }
  }
  throw new SyncRequestError({
    kind: 'invalid',
    message:
      'This account’s synced data could not be decrypted on this device. Either the passphrase is wrong, or it was written by a newer version of the app.',
  });
}

function toWirePayload(payload: StampedSnapshot): SyncPayload {
  return { snapshot: payload.snapshot, syncMeta: payload.meta };
}

/** Persists the new baseline. Hashes are recomputed from what was just agreed, so the NEXT cycle sees "unchanged". */
function commitState({
  deps,
  merged,
  blobVersion,
  at,
}: {
  deps: SyncCycleDeps;
  merged: StampedSnapshot;
  blobVersion: number;
  at: number;
}): PersistedSyncState {
  const next: PersistedSyncState = {
    formatVersion: deps.state.load().formatVersion,
    lastBlobVersion: blobVersion,
    lastSyncedAt: at,
    baseline: baselineFromPayload(merged),
  };
  deps.state.save(next);
  return next;
}
