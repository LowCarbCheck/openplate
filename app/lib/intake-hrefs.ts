/**
 * Every intake destination link, built in one place.
 *
 * Three near-identical helpers used to do this: `speakHref` in
 * `add-food-actions.tsx`, `diaryHrefForDate` in `diary-href.ts`, and
 * `describeScanHref` in `describe.tsx`. Each knew the same two rules, that a
 * day equal to today is a bare path with no query, and that a query the path
 * already carries must survive. Three copies of a rule is three chances to get
 * the day wrong, and getting the day wrong is silent: the meal lands on today
 * and nothing on screen says so.
 *
 * THE OPTIONS BAG IS THE POINT. A positional date argument would make the next
 * parameter, a meal slot, a re-touch of every call site. As an options field it
 * is one line here and nothing anywhere else. `to` arrived exactly that way
 * when the pantry became a second intake consumer (M233/01).
 */
import { ADD_DESCRIBE_PATH, ADD_PHOTO_PATH, ADD_SEARCH_PATH, DEFAULT_INTAKE_CONSUMER, type IntakeConsumer } from '#app/lib/intake-consumers';

// Re-exported so a call site reaching for `buildIntakeHref` can spell the
// three intake hub addresses (ADR-0019) from the same import, rather than a
// second one to `intake-consumers.ts`. The constants themselves are defined
// there, the leaf of this module's own dependency graph; see that file's
// header for why the direction matters.
export { ADD_DESCRIBE_PATH, ADD_PHOTO_PATH, ADD_SEARCH_PATH };

/** What a destination can carry beyond its path. Every field is optional; an empty bag returns the path unchanged. */
export type IntakeHrefOptions = {
  /** The calendar day the person is looking at, `YYYY-MM-DD`. `null` means today, which carries no query. */
  date?: string | null;
  /** Today in the same time zone, `YYYY-MM-DD`. When `date` equals it, the day is dropped, so the URL stays bare. */
  today?: string | null;
  /** Focuses the composer's field and shows the dictation hint. Nothing records; this app has no microphone. */
  speak?: boolean;
  /** The meal slot, written as `meal=`. Nothing passes one yet, and it costs one line to keep ready. */
  slot?: string;
  /**
   * Who the composer hands its words to, written as `to=`. The diary's
   * `/add/photo` is the default everywhere, so it is written only when it is
   * NOT `/add/photo` and the bare `/add/describe` URL the diary has always
   * used stays bare. The type is the allowlist (`intake-consumers.ts`), never
   * a free path.
   */
  to?: IntakeConsumer;
};

/**
 * The URL for an add-food destination, carrying the viewed day.
 *
 * `path` may already hold a query (`/describe?date=2026-09-07`); its parameters
 * are kept and the options are merged over them, so adding `speak` twice is
 * still one `speak=1`.
 *
 * @param path - the destination, with or without a query string.
 * @param options - the day, the speak flag, the meal slot and the consumer to carry.
 * @returns the path with a query only when there is something to put in it.
 */
export function buildIntakeHref(path: string, options: IntakeHrefOptions = {}): string {
  const { date = null, today = null, speak = false, slot, to = DEFAULT_INTAKE_CONSUMER } = options;
  const [base = path, existingQuery = ''] = path.split('?');
  const params = new URLSearchParams(existingQuery);

  // A day equal to today is no day at all: the bare path is the canonical URL
  // for today on every one of these screens.
  if (date !== null && date !== today) params.set('date', date);
  if (speak) params.set('speak', '1');
  if (slot !== undefined) params.set('meal', slot);
  // The default consumer is silent, for the same reason today is: it is what
  // the URL already meant before the parameter existed.
  if (to !== DEFAULT_INTAKE_CONSUMER) params.set('to', to);

  const query = params.toString();
  return query === '' ? base : `${base}?${query}`;
}
