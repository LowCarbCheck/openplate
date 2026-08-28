/**
 * THE STUDY BLOB'S SHAPE — an EMPTY diary, plus the study's own compartment.
 *
 * ── The trap this module exists to defuse ────────────────────────────────
 *
 * The owner-private compartment rides INSIDE the synced snapshot
 * (`snapshot-partition.ts`), and openplate's local store is DEVICE-scoped:
 * one flat store per browser profile, with no per-user namespacing. So a study
 * session that reused the diary's outgoing-snapshot path — the one in
 * `sync-actions.ts` that splits what it has just read off this device — would
 * push the RESEARCHER'S
 * OWN DIARY as the study account's shareable region, the first time she
 * signed into the study account in the browser profile that holds her diary.
 * Silently. Nothing fails, nothing warns, and that blob belongs to an account
 * whose fingerprint is printed in a consent document.
 *
 * ── Why this is a separate path and not a flag ───────────────────────────
 *
 * A flag on the diary path is a thing that can be false. This module has no
 * parameter through which a diary could arrive: {@link buildStudySnapshot}
 * takes a sealed compartment and nothing else, and no module of the study
 * console reads the local store at all. `tests/unit/study-snapshot.test.ts`
 * asserts both halves — the built blob's emptiness, and the absence of every
 * verb that could put a diary in it.
 *
 * ── The empty region is written out name by name ─────────────────────────
 *
 * Same reason the partition destructures rather than spreads: adding a
 * key to the shareable region without deciding what "empty" means for a study
 * must fail the typecheck, not default to whatever the store happened to hold.
 */
import type { ShareableSnapshot, SealedPrivateStore, SyncedSnapshot } from '../snapshot-partition';

/**
 * The shareable region of a study account: nothing.
 *
 * A study account is not a person's tracker. It has no foods, no logs, no
 * weights, no profile, no fasts and no meals — and this constant is what a
 * study push emits in place of all six.
 */
export const EMPTY_STUDY_SHAREABLE_REGION: ShareableSnapshot = {
  foods: [],
  foodLogs: [],
  weightEntries: [],
  profile: null,
  fasts: [],
  savedMeals: [],
};

/**
 * The whole payload a study account ever pushes.
 *
 * @param privateStore - the study's sealed compartment, or `null` when this session has none to write.
 * @returns an empty diary plus that compartment. There is no other producer of a study-account snapshot.
 */
export function buildStudySnapshot({ privateStore }: { privateStore: SealedPrivateStore | null }): SyncedSnapshot {
  return { ...EMPTY_STUDY_SHAREABLE_REGION, privateStore };
}
