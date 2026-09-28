/**
 * What a person left on each of the three add screens, kept while the page
 * lives (M255/01).
 *
 * WHY A STORE AT ALL. `/add/search`, `/add/describe` and `/add/photo` are
 * sibling routes under `/add` (ADR-0019), and a switch between them unmounts
 * one screen and mounts the next. Every draft used to be plain component
 * state, so any navigation threw it away: the sentence half written in the
 * composer, the portion step of a food already found, and on `/add/photo` the
 * chosen picture AND a finished AI analysis. The last one is the expensive
 * loss, because redoing it spends a second paid (or free trial) scan.
 *
 * ONE SLOT PER METHOD, and a slot outlives the screen that wrote it. A screen
 * reads its slot once, when it mounts, and writes it whenever its draft
 * changes. Nothing is saved from an unmount cleanup alone: a cleanup that is
 * the only writer loses the draft the day React skips it, and StrictMode runs
 * it at times that have nothing to do with leaving.
 *
 * A MODULE VARIABLE, NOT STORAGE, for the same reasons `intake-handoff.ts`
 * gives: a `File` is not serialisable, a client navigation never reloads the
 * document, and a photograph is exactly the thing this app does not put
 * anywhere it was not asked to. A reload therefore starts clean, which is the
 * decided behaviour (M255 non-goals), not a gap.
 *
 * WHO CLEARS WHAT.
 * - A successful log clears the slot of the method that logged it
 *   (`clearAddDraft('search')` in the search route's log path,
 *   `clearDraftsAfterPhotoLog` in the photo route's confirm).
 * - A fresh intake beats a draft: a photo from the launcher or the share
 *   sheet, or words handed over by a screen, replace what `/add/photo` held
 *   (`readPhotoDraftOnArrival`). The hand-off keeps its EXACTLY ONCE contract;
 *   this module only peeks at it.
 * - Sign-out and a device erase need nothing from here. Both end in a hard
 *   navigation (`sign-out-flow.ts`, `leaveTheApp`), and a document load is
 *   what empties a module variable.
 */
import type { AiProviderType, MealType } from '#types/enums';
import type { AddSearchCandidate } from '#app/lib/add-search-candidate';
import { hasPendingIntakeHandoff } from '#app/lib/intake-handoff';
import type { IntakeSource } from '#app/lib/intake-source';
import type { FoodMatch } from '#app/services/food-resolution';
import type { FoodDbStatus } from '#app/services/food-db/wire';
import type { PlateIdentification } from '#app/services/vision';

/** The three ways into the diary that share the `/add` layout, in the order the switcher draws them. */
export const ADD_METHODS = ['search', 'describe', 'photo'] as const;
export type AddMethod = (typeof ADD_METHODS)[number];

/** The two inputs of the portion step, as the fields hold them. */
export interface SearchPortionDraft {
  /** The grams box, as typed: `'1'`, `'1.'` and `''` are all states a person passes through. */
  grams: string;
  /** The meal select's value, `''` or a slot, exactly as the select holds it. */
  mealType: string;
}

/** `/add/search`: the box, the food opened from it, and that food's portion. */
export interface SearchDraft {
  /** What is in the search box. The URL's `?q=` follows it after a debounce; this is the box. */
  q: string;
  /** The food whose portion step is open, or `null` on the result list. */
  selected: AddSearchCandidate | null;
  /** The portion step's inputs for `selected`. `null` until the step has drawn once. */
  portion: SearchPortionDraft | null;
  /** Whether the manual-entry form was open. */
  showManual: boolean;
}

/** `/add/describe`: the words in the composer. The `?speak=1` hint is the URL's, never a draft. */
export interface DescribeDraft {
  text: string;
}

/**
 * A finished identification, kept so coming back never pays for it twice.
 *
 * SETTLED ONLY. An analysis still in flight is not a draft: the switcher is
 * inert while one runs, and a request cut off by another way out is gone with
 * the screen that sent it. A failed one is not kept either; the picture is,
 * and the screen offers its Analyze key again.
 */
export interface SettledPhotoAnalysis {
  identification: PlateIdentification;
  /** Which way in produced it; read by the confirm's input-path event. */
  intakeSource: IntakeSource;
  provider: AiProviderType;
  modelId: string;
  matches: FoodMatch[][];
  foodDb: FoodDbStatus;
}

/** What a person changed on the review screen before leaving it. */
export interface PhotoReviewDraft {
  /**
   * The review form's own values (names, grams, macros, an applied database
   * match) as JSON.
   *
   * TEXT, AND OPAQUE HERE. Everything a form holds is text already, so the
   * round trip loses nothing, and the schema that names these fields belongs
   * to the photo route, which this module sits below. The route is the only
   * writer and the only reader.
   */
  formValues: string;
  /** The plate-wide meal select, as the select holds it. */
  mealType: string;
  /** Items the person unticked. */
  excludedIndexes: readonly number[];
  /** Items whose database suggestion the person dismissed. */
  dismissedIndexes: readonly number[];
}

/**
 * `/add/photo`: the intake, its settled analysis, and the review of it.
 *
 * NEVER A PREVIEW URL. An object URL belongs to the document that minted it and
 * must be revoked by whoever minted it; the screen makes a new one from `file`
 * on every mount and revokes it on unmount, as it always has.
 */
export interface PhotoDraft {
  /** The downscaled picture the analysis was or will be run on, or `null` for words. */
  file: File | null;
  /** The sentence being analysed, or `null` for a picture. */
  typedText: string | null;
  intakeSource: IntakeSource;
  /** The meal slot the review opens on, read off the picture's timestamp at pick time. */
  mealType: MealType | null;
  analysis: SettledPhotoAnalysis | null;
  review: PhotoReviewDraft | null;
}

/** Every slot's draft, by method. */
export interface AddDrafts {
  search: SearchDraft;
  describe: DescribeDraft;
  photo: PhotoDraft;
}

/** What a slot holds before anything was written, so a partial write has something to land on. */
function emptyDrafts(): AddDrafts {
  return {
    search: { q: '', selected: null, portion: null, showManual: false },
    describe: { text: '' },
    photo: { file: null, typedText: null, intakeSource: 'photo', mealType: null, analysis: null, review: null },
  };
}

/** The one mutable holder: each method's draft, or `null` for none. */
type AddDraftSlots = { [Method in AddMethod]: AddDrafts[Method] | null };

/** Every slot, empty. */
function emptySlots(): AddDraftSlots {
  return { search: null, describe: null, photo: null };
}

const slots = emptySlots();

/**
 * The draft a method's screen left, or `null` when there is none.
 *
 * @param method - which screen's slot to read.
 * @returns the draft as it was last written.
 */
export function readAddDraft<Method extends AddMethod>(method: Method): AddDrafts[Method] | null {
  return slots[method];
}

/**
 * Replaces one slot's draft outright.
 *
 * @param method - which screen's slot to write.
 * @param draft - the whole draft.
 */
export function writeAddDraft<Method extends AddMethod>(method: Method, draft: AddDrafts[Method]): void {
  slots[method] = draft;
}

/**
 * Merges part of a draft into one slot, starting from an empty draft when the
 * slot holds none.
 *
 * WHY A MERGE. A screen's draft is held by more than one component: on
 * `/add/search` the box belongs to the search step, the open food to the route
 * and the portion to the portion step. Each writes its own fields and leaves
 * the others as they are.
 *
 * @param method - which screen's slot to write.
 * @param patch - the fields that changed.
 */
export function updateAddDraft<Method extends AddMethod>(method: Method, patch: Partial<AddDrafts[Method]>): void {
  slots[method] = { ...(slots[method] ?? emptyDrafts()[method]), ...patch };
}

/**
 * Empties one slot.
 *
 * @param method - which screen's slot to empty.
 */
export function clearAddDraft(method: AddMethod): void {
  slots[method] = null;
}

/** Empties every slot. Nothing in the app needs it today (see the header); the tests do. */
export function clearAllAddDrafts(): void {
  for (const method of ADD_METHODS) slots[method] = null;
}

/**
 * The photo draft `/add/photo` should open on, or `null` for an empty screen.
 *
 * A FRESH INTAKE WINS. When the launcher parked a photo, a screen handed over
 * words, or the share sheet brought a picture, the person just asked for THAT
 * intake, and drawing the old draft for the moment before it lands would show
 * them the wrong plate. The draft is not deleted here: the screen starts empty,
 * and its first write replaces the slot, which is when the new intake owns it.
 *
 * The hand-off is only peeked at. Taking it stays the screen's pickup effect's
 * job, once, behind its own guard.
 *
 * @param options.isSharedPhotoArriving - the share sheet's flag is on the URL.
 * @returns the draft to restore, or `null`.
 */
export function readPhotoDraftOnArrival({
  isSharedPhotoArriving,
}: {
  isSharedPhotoArriving: boolean;
}): PhotoDraft | null {
  if (isSharedPhotoArriving) return null;
  if (hasPendingIntakeHandoff()) return null;
  return slots.photo;
}

/**
 * Clears what a confirmed plate was drafted from.
 *
 * The photo slot always: that draft is now diary rows. A logged SENTENCE also
 * came from somewhere, the composer or the search box, and the screen it came
 * from still holds it in its own slot so that a failed analysis can be fixed
 * and sent again. Once it is logged, that copy is the same meal waiting to be
 * logged twice, so a slot whose text is the logged sentence is cleared with
 * it. A slot holding anything else is a different draft and stays.
 */
export function clearDraftsAfterPhotoLog(): void {
  const logged = slots.photo;
  slots.photo = null;
  const sentence = logged?.typedText ?? null;
  if (sentence === null) return;
  if (slots.describe !== null && slots.describe.text.trim() === sentence) slots.describe = null;
  if (slots.search !== null && slots.search.q.trim() === sentence) slots.search = null;
}
