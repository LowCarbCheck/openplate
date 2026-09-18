/**
 * A DISMISSED AWARD NOTE STAYS DISMISSED, ON BOTH DEVICES (M235/03).
 *
 * `seenAt` is the one mutable field on either of the two write-once tables, and
 * the merge can carry a value the local store will not take: `putLocalAward` is
 * write-once by key, so `importBackup` keeps this device's row whenever it
 * already holds the award. That is right for a restore from a months-old file,
 * and it leaves the apply one job to do.
 *
 * Left undone, the two devices never agree and never stop arguing. The device
 * holding the stamp commits a baseline saying null, reads its own store on the
 * next cycle, sees a change, and pushes the stamp back; the other does the same
 * in reverse; every cycle from then on writes a blob version over one dismissed
 * note. `applyMergedSnapshot` therefore re-stamps through `markAwardSeen`,
 * which fills a null and never overwrites a stamp, so the field is MONOTONE and
 * the argument ends.
 *
 * THE CONTROL IS THE SECOND AWARD, in the same apply: the merge says it was
 * seen LATER than this device thinks, and this device must keep its own earlier
 * stamp. Without it, "the stamp was adopted" would pass just as happily against
 * an apply that blanket-overwrote every award with whatever the merge held,
 * which is the version that resets somebody's dismissed note.
 *
 * The store is the REAL one, on a real (fake-backed) IndexedDB, because the
 * write-once rule and the re-stamp are both inside it and a fake would be free
 * to agree with itself.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import {
  applyMergedSnapshot,
  readLocalOwnerPrivateRegion,
  readLocalSnapshot,
} from '../../app/lib/sync/local-store-bridge';
import { partitionSnapshot, recomposeSnapshot } from '../../app/lib/sync/snapshot-partition';
import { listLocalAwards, putLocalAward, type LocalAward } from '../../app/lib/local-store';

const EARNED_AT = 1_770_000_000_000;
/** The stamp the OTHER device wrote when the person dismissed the note there. */
const SEEN_ON_THE_PEER = EARNED_AT + 60_000;
/** The stamp THIS device already holds for the control award, which is earlier and must survive. */
const SEEN_HERE = EARNED_AT + 10_000;

const ADOPTED = 'explorer.log.food';
const CONTROL = 'streak.7';

before(() => {
  // SAFETY: `persist.ts` refuses to open a store unless it believes it is in a
  // browser; the guard is `globalThis.window !== undefined`.
  globalThis.window = globalThis as typeof globalThis & Window;
  // AND THE AUTOSAVE TIMER MUST NOT HOLD THE PROCESS OPEN, the same wiring
  // `sync-delete-during-cycle.test.ts` carries: the store schedules a repeating
  // save, and an ordinary node interval keeps the runner alive after the last
  // assertion has passed.
  const scheduleInterval = globalThis.setInterval;
  function unrefdSetInterval<TArgs extends unknown[]>(
    callback: (...args: TArgs) => void,
    delay?: number,
    ...args: TArgs
  ): NodeJS.Timeout {
    return scheduleInterval(callback, delay, ...args).unref();
  }
  // SAFETY: the DOM overload answers a `number`; in node the handle carries `unref`.
  globalThis.setInterval = unrefdSetInterval as typeof globalThis.setInterval;
});

function award(key: string, seenAt: number | null): LocalAward {
  return { key, earnedAt: EARNED_AT, earnedOnDay: '2026-09-18', seenAt };
}

test('an apply adopts a seenAt this device lacks, and keeps the one it already has', async () => {
  await putLocalAward({ award: award(ADOPTED, null) });
  await putLocalAward({ award: award(CONTROL, SEEN_HERE) });

  const { shareable } = partitionSnapshot((await readLocalSnapshot()).snapshot);
  // What the merge decided: the peer's stamps won both rows.
  const mergedShareable = {
    ...shareable,
    awards: [award(ADOPTED, SEEN_ON_THE_PEER), award(CONTROL, SEEN_ON_THE_PEER)],
  };

  await applyMergedSnapshot({
    merged: recomposeSnapshot({ shareable: mergedShareable, ownerPrivate: await readLocalOwnerPrivateRegion() }),
    local: shareable,
  });

  const stamps = new Map((await listLocalAwards()).map((entry) => [entry.key, entry.seenAt]));
  assert.equal(
    stamps.get(ADOPTED),
    SEEN_ON_THE_PEER,
    'a note dismissed on the other device must not be shown again here',
  );
  assert.equal(
    stamps.get(CONTROL),
    SEEN_HERE,
    'THE CONTROL: an award this device already stamped keeps its own stamp, the apply is not a blanket overwrite',
  );
});
