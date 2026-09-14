/**
 * Every add-food destination link, built in one place.
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
 * is one line here and nothing anywhere else.
 */

/** What a destination can carry beyond its path. Every field is optional; an empty bag returns the path unchanged. */
export type AddHrefOptions = {
  /** The calendar day the person is looking at, `YYYY-MM-DD`. `null` means today, which carries no query. */
  date?: string | null;
  /** Today in the same time zone, `YYYY-MM-DD`. When `date` equals it, the day is dropped, so the URL stays bare. */
  today?: string | null;
  /** Focuses the composer's field and shows the dictation hint. Nothing records; this app has no microphone. */
  speak?: boolean;
  /** The meal slot, written as `meal=`. Nothing passes one yet, and it costs one line to keep ready. */
  slot?: string;
};

/**
 * The URL for an add-food destination, carrying the viewed day.
 *
 * `path` may already hold a query (`/describe?date=2026-09-07`); its parameters
 * are kept and the options are merged over them, so adding `speak` twice is
 * still one `speak=1`.
 *
 * @param path - the destination, with or without a query string.
 * @param options - the day, the speak flag and the meal slot to carry.
 * @returns the path with a query only when there is something to put in it.
 */
export function buildAddHref(path: string, options: AddHrefOptions = {}): string {
  const { date = null, today = null, speak = false, slot } = options;
  const [base = path, existingQuery = ''] = path.split('?');
  const params = new URLSearchParams(existingQuery);

  // A day equal to today is no day at all: the bare path is the canonical URL
  // for today on every one of these screens.
  if (date !== null && date !== today) params.set('date', date);
  if (speak) params.set('speak', '1');
  if (slot !== undefined) params.set('meal', slot);

  const query = params.toString();
  return query === '' ? base : `${base}?${query}`;
}
