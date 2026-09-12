// The service worker's copy of the push decision.
//
// `public/sw.js` is hand written and is not bundled, so it cannot import
// `app/lib/push-decision.ts`. This file is that module, transcribed to plain
// JavaScript, loaded with `importScripts('/sw-push-decision.js')` because the
// worker is registered as a CLASSIC script (`app/lib/service-worker.ts` calls
// `register('/sw.js')` with no `{ type: 'module' }`), and a classic worker
// cannot use a static `import`.
//
// SOURCE OF TRUTH: `app/lib/push-decision.ts`. Change that file first, then
// mirror the change here. `tests/unit/sw-push-copy-parity.test.ts` runs both
// implementations over the same matrix of kinds, record states and languages
// and fails on any disagreement, so drift is caught at the push, not in the
// field where nobody sees it.
//
// Everything is attached to ONE namespace on `self` so the worker's own
// globals cannot be shadowed by accident.

/** @typedef {{ forDay?: string, title?: string, body?: string, url?: string, locale?: string, writtenAt?: number }} StoredCatchUpRecord */
/** @typedef {{ title: string, body: string, url: string, tag: string }} PushDecision */
/** @typedef {{ url?: string }} NotificationData */

(function attachPushDecision(scope) {
  const CATCH_UP_KIND = 'catch-up';
  const FAST_TARGET_KIND = 'fast-target';

  // 36 hours. See app/lib/push-decision.ts for why this window and not a day.
  const CATCH_UP_MAX_AGE_MS = 36 * 60 * 60 * 1000;

  const CATCH_UP_PATH = '/catch-up';
  const FASTING_PATH = '/fasting';

  // Tags, so a second push replaces the first instead of stacking.
  const CATCH_UP_TAG = 'openplate-catchup';
  const FAST_TARGET_TAG = 'openplate-fast';

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
  };

  /**
   * @param {string} tag
   * @returns {'de' | 'en'}
   */
  function language(tag) {
    return String(tag ?? '').toLowerCase().startsWith('de') ? 'de' : 'en';
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function text(value) {
    return String(value ?? '').trim();
  }

  /**
   * @param {'catch-up' | 'fast-target'} kind
   * @param {string} languageTag
   * @returns {PushDecision}
   */
  function genericDecision(kind, languageTag) {
    const line = GENERIC_LINES[kind][language(languageTag)];
    const isFast = kind === FAST_TARGET_KIND;
    return {
      title: line.title,
      body: line.body,
      url: isFast ? FASTING_PATH : CATCH_UP_PATH,
      tag: isFast ? FAST_TARGET_TAG : CATCH_UP_TAG,
    };
  }

  /**
   * Decide what a push shows. Never returns nothing.
   *
   * @param {string} kind The `kind` from the payload; anything unknown is a catch-up.
   * @param {StoredCatchUpRecord | null} record The stored catch-up, or null.
   * @param {number} nowMs
   * @param {string} navigatorLanguage
   * @returns {PushDecision}
   */
  function decidePush(kind, record, nowMs, navigatorLanguage) {
    if (kind === FAST_TARGET_KIND) {
      return genericDecision(FAST_TARGET_KIND, navigatorLanguage);
    }

    const stored = record ?? {};
    const title = text(stored.title);
    const body = text(stored.body);
    const writtenAt = Number(stored.writtenAt ?? 0);
    const isFresh =
      title !== '' &&
      body !== '' &&
      Number.isFinite(writtenAt) &&
      writtenAt > 0 &&
      nowMs - writtenAt <= CATCH_UP_MAX_AGE_MS;

    if (isFresh) {
      return { title: title, body: body, url: text(stored.url) || CATCH_UP_PATH, tag: CATCH_UP_TAG };
    }

    const languageTag = text(stored.locale) || navigatorLanguage;
    return genericDecision(CATCH_UP_KIND, languageTag);
  }

  /**
   * @param {NotificationData | null} data
   * @returns {string}
   */
  function notificationPath(data) {
    return text((data ?? {}).url) || CATCH_UP_PATH;
  }

  scope.openplatePushDecision = {
    CATCH_UP_KIND: CATCH_UP_KIND,
    FAST_TARGET_KIND: FAST_TARGET_KIND,
    CATCH_UP_MAX_AGE_MS: CATCH_UP_MAX_AGE_MS,
    CATCH_UP_PATH: CATCH_UP_PATH,
    FASTING_PATH: FASTING_PATH,
    CATCH_UP_TAG: CATCH_UP_TAG,
    FAST_TARGET_TAG: FAST_TARGET_TAG,
    decidePush: decidePush,
    notificationPath: notificationPath,
  };
})(self);
