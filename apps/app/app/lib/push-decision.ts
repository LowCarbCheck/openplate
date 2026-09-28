/**
 * What a web push shows, decided as pure data in, pure data out.
 *
 * The server never writes notification text: a push carries a `kind` and
 * nothing else, so every word a person reads is written on the device. This
 * module holds that choice, apart from the service worker, for two reasons.
 *
 * 1. A user visible push MUST show a notification. A browser that gets a push
 *    and sees no `showNotification` call shows its own "This site has been
 *    updated in the background" line, and repeats that often enough and the
 *    permission is gone. So there is no path here that returns nothing: a
 *    stale record, a missing record, a slow read and a garbage record all
 *    land on the generic line instead.
 * 2. `public/sw.js` is hand written plain JavaScript and is not bundled, so it
 *    cannot import this file. It carries a copy, `public/sw-push-decision.js`,
 *    and `tests/unit/sw-push-copy-parity.test.ts` holds the two together.
 *
 * The record this reads is written by the app itself (`app/lib/notify-store.ts`,
 * the notify store database). It is a device artefact of unknown age: the
 * device may have been offline for a day, or the push may arrive before the
 * morning write. Hence the freshness window rather than a blind read.
 */

/** The two kinds this app sends. Anything else is treated as a catch-up. */
export const CATCH_UP_KIND = 'catch-up';
export const FAST_TARGET_KIND = 'fast-target';

/**
 * How old a stored catch-up may be and still be shown: 36 hours.
 *
 * Longer than a day so a push that slips past midnight, or one that lands on a
 * device that woke late, still shows the real text. Short enough that a device
 * which has been offline for two days cannot show yesterday's numbers as if
 * they were this morning's.
 */
export const CATCH_UP_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/** Deep links. A tap on a catch-up lands on the catch-up, a fast on the fast. */
export const CATCH_UP_PATH = '/catch-up';
export const FASTING_PATH = '/fasting';

/**
 * Notification tags. A tag makes a second push REPLACE the first instead of
 * stacking, so a device that was offline for three pushes wakes to one line.
 */
export const CATCH_UP_TAG = 'openplate-catchup';
export const FAST_TARGET_TAG = 'openplate-fast';

/**
 * The catch-up record as it comes back out of IndexedDB, which is to say: not
 * to be trusted. Every field is optional because an old worker, a half written
 * record or a schema from a future release must degrade to the generic line
 * rather than throw.
 */
export interface StoredCatchUpRecord {
  readonly forDay?: string;
  readonly title?: string;
  readonly body?: string;
  readonly url?: string;
  readonly locale?: string;
  readonly writtenAt?: number;
}

/** Everything the worker needs to call `showNotification`. */
export interface PushDecision {
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly tag: string;
}

/** The `data` a notification carries, read back on a tap. */
export interface NotificationData {
  readonly url?: string;
}

/** One notification's words. */
interface Line {
  readonly title: string;
  readonly body: string;
}

/**
 * The generic lines, in the two languages the app ships. These say what is
 * waiting and stop. No number, no verdict, nothing that reads as a telling off
 * when the day went badly.
 */
const GENERIC_LINES = {
  'catch-up': {
    en: {
      title: 'Your catch-up is ready',
      body: 'Open openplate for yesterday and what lies ahead.',
    },
    de: {
      title: 'Dein Tagesrückblick ist da',
      body: 'Öffne openplate für gestern und das, was ansteht.',
    },
  },
  'fast-target': {
    en: {
      title: 'Your fast has reached its target',
      body: 'Keep going or end it, your call.',
    },
    de: {
      title: 'Dein Fasten hat das Ziel erreicht',
      body: 'Weitermachen oder beenden, deine Entscheidung.',
    },
  },
} as const;

/**
 * Pick a language from a BCP 47 tag. German for `de`, `de-DE`, `de-AT`; English
 * for everything else, which is the app's own fallback language, so a French
 * phone gets readable English rather than an empty notification.
 */
function language(tag: string): 'de' | 'en' {
  return String(tag ?? '').toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** Trim a field that should be a string, tolerating it being absent. */
function text(value: string | undefined): string {
  return String(value ?? '').trim();
}

/**
 * Decide what a push shows.
 *
 * @param kind The `kind` from the push payload. An unrecognised or empty kind
 *   is treated as a catch-up, because a push whose kind we cannot read still
 *   has to show something and the catch-up is the harmless one.
 * @param record The stored catch-up, or null when the read failed, timed out
 *   or found nothing.
 * @param nowMs The current time, passed in so freshness is testable.
 * @param navigatorLanguage `navigator.language`, used only when the record
 *   carries no locale of its own.
 */
export function decidePush(
  kind: string,
  record: StoredCatchUpRecord | null,
  nowMs: number,
  navigatorLanguage: string,
): PushDecision {
  if (kind === FAST_TARGET_KIND) {
    return genericDecision(FAST_TARGET_KIND, navigatorLanguage);
  }

  const title = text(record?.title);
  const body = text(record?.body);
  const writtenAt = Number(record?.writtenAt ?? 0);
  // An empty title or body is as bad as no record at all: it would show a blank
  // notification, which is the thing this module exists to prevent.
  const isFresh =
    title !== '' &&
    body !== '' &&
    Number.isFinite(writtenAt) &&
    writtenAt > 0 &&
    nowMs - writtenAt <= CATCH_UP_MAX_AGE_MS;

  if (isFresh) {
    return { title, body, url: text(record?.url) || CATCH_UP_PATH, tag: CATCH_UP_TAG };
  }

  // A stale record still knows which language the person reads, and that is
  // worth more than the navigator's, which on a shared or misconfigured device
  // can differ from the language the app is being used in.
  const languageTag = text(record?.locale) || navigatorLanguage;
  return genericDecision(CATCH_UP_KIND, languageTag);
}

/** The generic line for a kind, localised. */
function genericDecision(kind: 'catch-up' | 'fast-target', languageTag: string): PushDecision {
  const line: Line = GENERIC_LINES[kind][language(languageTag)];
  const isFast = kind === FAST_TARGET_KIND;
  return {
    title: line.title,
    body: line.body,
    url: isFast ? FASTING_PATH : CATCH_UP_PATH,
    tag: isFast ? FAST_TARGET_TAG : CATCH_UP_TAG,
  };
}

/**
 * Where a tap lands. The default is the catch-up rather than `/`, because a
 * notification whose data was lost (an old worker, a notification restored by
 * the system) is far more likely to be a catch-up than anything else.
 */
export function notificationPath(data: NotificationData | null): string {
  return text(data?.url) || CATCH_UP_PATH;
}
