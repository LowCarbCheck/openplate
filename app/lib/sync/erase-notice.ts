/**
 * What the sign-out dialog says about an erase before anybody agrees to one
 * (M201 spec 02, and the fix to what it counted).
 *
 * ── The number it used to count, and why it was always zero ──────────────
 *
 * This file used to count the rows of the LOG OUTBOX, the queue offline writes
 * waited in while the diary lived on a server. Nothing has written that queue
 * since M117/03, when diary writes started committing straight to the primary
 * store, so the count was zero on every device, and the dialog said
 * "Everything on this device has reached the server" directly above the box
 * that erases it. A person with a week of entries the sync engine had not
 * pushed yet was told the erase was safe.
 *
 * ── The signal it counts now ─────────────────────────────────────────────
 *
 * The sync engine keeps no queue (`orchestrator.ts`, "Offline is a no-op"). It
 * decides what to send by DIFFING the device against the BASELINE: the
 * per-entity content hashes of the last payload this device agreed with the
 * account (`sync-state.ts`), which `commitState` writes only after a push
 * landed or a pull was adopted. So "what has not reached the server?" has one
 * honest answer on this device, and it is the engine's own stamping.
 * {@link countUnsentChanges} runs `stampSnapshot` over the live snapshot and
 * that baseline, and counts
 *
 *  - every live entity whose stamp moved: a new row, an edited one, or one
 *    brought back over its own tombstone, and
 *  - every delete the journal wrote down for a row the baseline still names,
 *    whether or not the stamping would trust it: the account holds that row
 *    either way.
 *
 * A device that has never finished a cycle has an EMPTY baseline, so every row
 * on it counts, which is the truth: none of it is on the server.
 *
 * ── What it cannot see, said out loud ────────────────────────────────────
 *
 * The list of exclusions was three long and is TWO long now (M240/03).
 *
 * FASTS AND THE PANTRY LEFT IT. Both were pass-through collections when this
 * file was written: `payloadsEqual` ignored them, so a change to one of them
 * alone never made the device push, and nothing on the device could say
 * whether the account held their current state. Both are MERGED entities since
 * M240/01 and M240/02, so `stampSnapshot` above already counts a new fast, an
 * ended one, a photographed shelf and a removed row exactly like a food log,
 * and there is nothing left to exclude.
 *
 * What remains:
 *
 *  - SAVED MEALS, the last pass-through collection. They are compared, but by
 *    ID ONLY, against `SyncBaseline.passThrough.savedMeals`
 *    ({@link UnsentOnDevice.hasUnsentSavedMeals}): a meal the device holds and
 *    the baseline does not name has not reached the account, and a name the
 *    baseline holds and the device does not is a removal the account has not
 *    heard. An EDIT is deliberately not compared, and it does not need to be:
 *    `canonicalize` weighs the whole saved-meals list, so a rename pushes on
 *    the next cycle by itself, and a content hash here would cost a second
 *    definition of "changed" that could drift from the engine's own.
 *  - THE OWNER-PRIVATE COMPARTMENT (share keys, pinned peers, the research
 *    identity), which stays PRESENCE-ONLY
 *    ({@link UnsentOnDevice.hasOwnerPrivateRows}). It is compared as SEALED
 *    bytes and sealing needs the session's key, which a dialog has no business
 *    holding (`sync-session.ts`: the vault is off limits to React). So the only
 *    honest sentence is "these are not part of this check".
 *
 * Queued ESTIMATE REPORTS are counted beside the diary, because an erase
 * deletes the database they wait in (`device-erase.ts`).
 *
 * ── Empty is a sentence, not a zero ──────────────────────────────────────
 *
 * Unchanged from the first version of this file. "0 changes will be lost" is
 * the same class of copy as an empty state that renders a bare `0`, and it
 * reads as a warning when it is in fact the all-clear. So every sentence the
 * dialog can say is a named line here, the component renders one string per
 * line, and a count is only interpolated into a line that exists because the
 * count is not zero.
 */
import type { LocalStoreSnapshot } from '#app/lib/local-store';
import { countQueuedFeedbackReports } from '#app/lib/local-store/feedback-outbox';
import { readLocalSnapshot, type LocalSnapshotRead } from './local-store-bridge';
import { ownerPrivateRegionKeys, partitionSnapshot } from './snapshot-partition';
import { entityKey, stampSnapshot, type SyncBaseline } from './snapshot-sync';
import { withSyncOrchestratorLock } from './sync-lock';
import { createSyncStateStore, deviceStorage, type KeyValueStorage } from './sync-state';

/** What this device holds that the account does not, as far as this device can tell. */
export interface UnsentOnDevice {
  /** Diary changes the account has not received: new or edited rows, and deletes written down and not published. */
  changes: number;
  /** Reports about an entry, still queued on this device. */
  reports: number;
  /**
   * Does the device hold saved meals the account has not been told about?
   *
   * TRUE when the current id set differs from the one the baseline recorded,
   * in either direction, and on a device whose baseline recorded nothing at
   * all while it holds a saved meal. FALSE, and this is the point, when the
   * two id sets match: a device whose meals are all on the account must be
   * told so rather than warned about them for ever.
   */
  hasUnsentSavedMeals: boolean;
  /**
   * Does the device hold owner-private rows, the share identity, a pinned peer
   * or a study enrolment?
   *
   * PRESENCE, never a comparison. The region is sealed and this check has no
   * key, so "does it exist" is the only question it can answer honestly.
   */
  hasOwnerPrivateRows: boolean;
}

/** The dialog's read of {@link UnsentOnDevice}, as a state. */
export type UnsentRead =
  /** The read has not come back yet. */
  | { status: 'pending' }
  /** The read threw. Nothing is known, and nothing may be claimed. */
  | { status: 'failed' }
  | { status: 'done'; unsent: UnsentOnDevice };

/** One sentence the dialog can say. The component renders exactly one string per kind. */
export type EraseNoticeLine =
  /** Still reading, or waiting for a running sync to settle. */
  | { kind: 'checking' }
  /** The device could not be checked, so no all-clear can be given. */
  | { kind: 'unchecked' }
  /** Every change the check can see is on the server. Never shown beside a count. */
  | { kind: 'all-sent' }
  /** This many diary changes have not reached the server, and an erase loses them. */
  | { kind: 'unsent-changes'; count: number }
  /** This many reports have not been sent, and an erase loses them. */
  | { kind: 'unsent-reports'; count: number }
  /** The device holds saved meals the account has not been told about, so an erase may lose them. */
  | { kind: 'saved-meals-unsent' }
  /** The sealed key material is outside this check entirely, so an erase may lose it. */
  | { kind: 'keys-not-covered' };

/**
 * The lines the dialog shows, in order.
 *
 * @param read - the device read, or its pending/failed state.
 * @param isSyncing - is a sync cycle running in this tab right now? Its commit
 *   is about to move the baseline, so a count taken now describes a moment that
 *   is ending, and the dialog waits for the next read instead.
 * @param hasSession - is an account signed in? Without one there is no
 *   baseline to compare against, so the device cannot be checked at all.
 */
export function resolveEraseNotice({
  read,
  isSyncing,
  hasSession,
}: {
  read: UnsentRead;
  isSyncing: boolean;
  hasSession: boolean;
}): EraseNoticeLine[] {
  if (!hasSession) return [{ kind: 'unchecked' }];
  if (isSyncing || read.status === 'pending') return [{ kind: 'checking' }];
  if (read.status === 'failed') return [{ kind: 'unchecked' }];

  const { changes, reports, hasUnsentSavedMeals, hasOwnerPrivateRows } = read.unsent;
  const lines: EraseNoticeLine[] = [];
  if (changes > 0) lines.push({ kind: 'unsent-changes', count: changes });
  if (reports > 0) lines.push({ kind: 'unsent-reports', count: reports });
  // THE ALL-CLEAR ONLY WHERE NOTHING WAS COUNTED, and it still speaks only for
  // what the check can see. The lines after it say what that excludes.
  if (lines.length === 0) lines.push({ kind: 'all-sent' });
  // TWO LINES, NOT ONE (M240/03). The single sentence these replace named
  // fasts, saved meals, the pantry and the keys together, and three quarters
  // of it became false when M240/01 and M240/02 merged the first three. Worse,
  // it fired on ANY of them, so a person whose saved meals were all on the
  // account was told they might lose them, on every sign-out, for ever. Each
  // line now speaks for one thing and only when that thing is true.
  if (hasUnsentSavedMeals) lines.push({ kind: 'saved-meals-unsent' });
  if (hasOwnerPrivateRows) lines.push({ kind: 'keys-not-covered' });
  return lines;
}

/**
 * The device id this check's throwaway stamps are minted under. Never
 * persisted and never pushed: only the lamport comparison below is read.
 */
const CHECK_DEVICE_ID = 'erase-notice-check';

/**
 * How many diary changes the account has not received, by the engine's own
 * reckoning. See the module header for what is counted.
 *
 * @param read - the device snapshot, its storage evidence and its delete
 *   journal, all from one read (`readLocalSnapshot`).
 * @param baseline - the baseline this device last agreed with the account.
 *   Empty for a device that has never finished a cycle.
 */
export function countUnsentChanges({ read, baseline }: { read: LocalSnapshotRead; baseline: SyncBaseline }): number {
  const { shareable } = partitionSnapshot(read.snapshot);
  const stamped = stampSnapshot({
    // NO COMPARTMENT, and the integrity says why: this check has not read it.
    // `isCompartmentKnown: false` makes the stamping withhold the baseline's
    // compartment entry instead of reading its absence as a delete, and the
    // withheld entry is not counted below, because no journal row names it.
    snapshot: { ...shareable, privateStore: null },
    baseline,
    deviceId: CHECK_DEVICE_ID,
    integrity: {
      ...read.integrity,
      deletedEntityKeys: read.deletedEntityKeys,
      isCompartmentKnown: false,
      isCompartmentHeld: false,
      isCompartmentUnpublished: true,
    },
  });

  // A stamp the stamping carried forward keeps the baseline's lamport; a new
  // row, an edit and a resurrection all mint one above it.
  const moved = Object.entries(stamped.baseline.perEntity).filter(
    ([key, stamp]) => baseline.perEntity[key]?.lamport !== stamp.lamport,
  ).length;
  // MINTED AND WITHHELD ALIKE. The stamping withholds a journalled delete from
  // a table it only half read, which protects the account, and the account
  // then still holds the row: it has not received the delete either way.
  const deleted = [...stamped.minted, ...stamped.withheld].filter((tombstone) =>
    read.deletedEntityKeys.has(entityKey(tombstone.entityType, tombstone.entityId)),
  ).length;
  return moved + deleted;
}

/**
 * Does this device hold saved meals the account has not been told about?
 *
 * BY ID, IN BOTH DIRECTIONS, against the ids the baseline recorded when this
 * device last agreed with the account (`SyncBaseline.passThrough.savedMeals`).
 * An id the device holds and the baseline does not is a meal that has not been
 * sent; an id the baseline holds and the device does not is a removal the
 * account has not heard. Either way an erase now loses something.
 *
 * AN ABSENT RECORD IS NOT AN EMPTY ONE, which is the same rule
 * `decidePassThrough` follows one file over. A baseline written before the ids
 * were kept, or by a device that has never finished a cycle, recorded nothing,
 * so it can vouch for nothing: a device holding meals is warned, and a device
 * holding none has nothing to lose either way.
 *
 * NO CONTENT HASH, deliberately. A RENAME is invisible here, and that is
 * correct rather than a gap: `canonicalize` weighs the whole saved-meals list,
 * so a rename makes the very next cycle push by itself. Hashing here would be
 * a second definition of "changed" living beside the engine's own, free to
 * drift from it, to warn about a meal the next cycle was about to send anyway.
 */
export function holdsUnsentSavedMeals({
  snapshot,
  baseline,
}: {
  snapshot: LocalStoreSnapshot;
  baseline: SyncBaseline;
}): boolean {
  const { shareable } = partitionSnapshot(snapshot);
  const agreed = baseline.passThrough?.savedMeals;
  if (agreed === undefined) return shareable.savedMeals.length > 0;
  const onDevice = new Set(shareable.savedMeals.map((meal) => meal.id));
  if (onDevice.size !== agreed.length) return true;
  return agreed.some((id) => !onDevice.has(id));
}

/**
 * Does this device hold owner-private rows at all?
 *
 * PRESENCE-ONLY, and it cannot be anything else: the region travels as SEALED
 * bytes, comparing it needs the session's data key, and the dialog has no
 * business holding one (`sync-session.ts`). So the honest sentence is that
 * these rows are outside the check, and this answers only whether there are
 * any to say it about.
 */
export function holdsOwnerPrivateRows(snapshot: LocalStoreSnapshot): boolean {
  return ownerPrivateRegionKeys(partitionSnapshot(snapshot).ownerPrivate).length > 0;
}

/**
 * Reads what this device holds that the account does not, for the account
 * signed in on it.
 *
 * UNDER THE ORCHESTRATOR LOCK (`sync-lock.ts`), so a cycle in ANOTHER TAB
 * cannot commit a new baseline between the snapshot read and the baseline
 * read. The dialog's own `isSyncing` only sees this tab's cycle, and the
 * baseline is one `localStorage` key that every tab writes. Taking the lock
 * here follows the one order the locks allow: this lock, then the store reads
 * inside it.
 *
 * @param accountId - the signed-in account, whose baseline key is read.
 * @param storage - where the baseline lives; this device's storage by default.
 * @throws when the device store cannot be read. The dialog then says it could
 *   not check, and never that everything was sent.
 */
export async function readUnsentOnDevice({
  accountId,
  storage = deviceStorage(),
}: {
  accountId: number;
  storage?: KeyValueStorage;
}): Promise<UnsentOnDevice> {
  const { read, baseline } = await withSyncOrchestratorLock(async () => ({
    read: await readLocalSnapshot(),
    baseline: createSyncStateStore({ storage, accountId }).load().baseline,
  }));
  return {
    changes: countUnsentChanges({ read, baseline }),
    reports: await countQueuedFeedbackReports(),
    // THE SAME BASELINE the count above weighs, and from the same locked read.
    // A second load could describe a cycle that committed in between, which
    // would warn about meals that had just been sent, or fail to warn about
    // ones that had not.
    hasUnsentSavedMeals: holdsUnsentSavedMeals({ snapshot: read.snapshot, baseline }),
    hasOwnerPrivateRows: holdsOwnerPrivateRows(read.snapshot),
  };
}
