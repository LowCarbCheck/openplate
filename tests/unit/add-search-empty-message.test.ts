/**
 * The throttled-vs-genuine-no-match copy split in the add flow (M123 spec 05).
 *
 * A person whose search was rate-limited must never read "No matches for
 * 'apple'" — that sentence is reserved for a search that actually ran and came
 * back empty. The shipped design keeps the two messages in two separate
 * functions and makes them mutually exclusive at the render site
 * (`{!throttled && candidates.length === 0 && ...}` in `SearchStep`), so
 * `searchEmptyMessage` has no `throttled` parameter at all. These tests pin
 * that design: that neither function can ever produce the other's copy, that
 * the pause phrasing stays distinct per band, and that only the no-match copy
 * names the food the user typed.
 *
 * Two translators are used on purpose. `stubT` echoes keys and interpolation
 * values, so the structural claims (which key, which values) survive any
 * re-wording. `realT` resolves the SHIPPED English catalog, so the claims that
 * are about the words themselves ("the throttled copy does not name the query")
 * are checked against what a user actually reads, not against a fixture.
 *
 * If you are reading this because a test here failed: the two messages have
 * started to overlap, which is the exact bug this spec closed — a throttled
 * user being told their food does not exist.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInstance } from 'i18next';
import { z } from 'zod';

import { describeSearchPause, searchEmptyMessage, type Translate } from '../../app/routes/add';

/**
 * The copy this file makes claims about, parsed out of the shipped catalog at
 * read time. `looseObject` keeps every other key intact, so the same value can
 * be handed to i18next as the full resource bundle — while a rename of any key
 * below fails here, loudly, at import.
 */
const EnglishCatalog = z.looseObject({
  add: z.looseObject({
    search: z.looseObject({
      throttled: z.string(),
      pause: z.looseObject({ seconds: z.string(), minute: z.string(), minutes: z.string() }),
      empty: z.looseObject({ noMatches: z.string(), firstTime: z.string(), startTyping: z.string() }),
    }),
  }),
});

const englishCatalog = EnglishCatalog.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
);

/** The two catalog strings whose interpolation contract this spec turns on. */
const COPY = englishCatalog.add.search;

const addSource = readFileSync(fileURLToPath(new URL('../../app/routes/add.tsx', import.meta.url)), 'utf8');

/**
 * Key-echoing translator: catalog-independent, so structural assertions never
 * depend on wording, while a value that leaked into a message still shows up.
 */
const stubT: Translate = (key, params) => {
  if (!params) return key;
  const rendered = Object.entries(params)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(',');
  return `${key}(${rendered})`;
};

/** Translator over the real shipped English catalog. */
const realT: Translate = (() => {
  const instance = createInstance();
  void instance.init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common'],
    resources: { en: { common: englishCatalog } },
    interpolation: { escapeValue: false },
  });
  // SAFETY: every key reached here is a leaf of the catalog parsed above, and
  // i18next returns the interpolated string for a string-valued leaf.
  return (key, params) => instance.t(key, params ? { ...params } : undefined) as string;
})();

const TRANSLATORS: ReadonlyArray<{ name: string; t: Translate }> = [
  { name: 'stub', t: stubT },
  { name: 'english', t: realT },
];

/** Every retry window the pause phrasing has to cope with, one per band plus the unreported case. */
const RETRY_WINDOWS: ReadonlyArray<number | null> = [null, 0, 10_000, 15_000, 60_000, 90_000, 300_000];

/** Every query/history combination the empty state can be rendered in. */
const EMPTY_STATE_INPUTS = [
  { query: 'brocoli', hasAnyRecent: false },
  { query: 'brocoli', hasAnyRecent: true },
  { query: '', hasAnyRecent: false },
  { query: '', hasAnyRecent: true },
] as const;

/**
 * Mirrors the throttled banner's render site in `add.tsx`'s `SearchStep`:
 * `t('add.search.throttled', { when: describeSearchPause(retryAfterMs, t) })`.
 * The wiring test below keeps this mirror honest.
 */
function throttledBanner(retryAfterMs: number | null, t: Translate): string {
  return t('add.search.throttled', { when: describeSearchPause(retryAfterMs, t) });
}

describe('the throttled banner is composed the way this test assumes', () => {
  it('SearchStep builds the banner from add.search.throttled and describeSearchPause', () => {
    assert.match(
      addSource,
      /t\('add\.search\.throttled',\s*\{\s*when:\s*describeSearchPause\(retryAfterMs,\s*t\)\s*\}\)/,
    );
  });

  it('the empty-state message is rendered only when NOT throttled — the two are mutually exclusive', () => {
    assert.match(addSource, /!throttled && candidates\.length === 0/);
    const emptyStateBlock = addSource.slice(addSource.indexOf('!throttled && candidates.length === 0'));
    assert.match(emptyStateBlock.slice(0, 1_500), /searchEmptyMessage\(\{ query, hasAnyRecent, t \}\)/);
  });
});

describe('searchEmptyMessage never speaks for the throttled case', () => {
  it('produces none of the throttled copy, for any query/history combination', () => {
    for (const { name, t } of TRANSLATORS) {
      const throttledCopy = new Set(RETRY_WINDOWS.map((ms) => throttledBanner(ms, t)));
      const pauseCopy = new Set(RETRY_WINDOWS.map((ms) => describeSearchPause(ms, t)));
      for (const input of EMPTY_STATE_INPUTS) {
        const message = searchEmptyMessage({ ...input, t });
        assert.equal(
          throttledCopy.has(message),
          false,
          `[${name}] empty-state copy for ${JSON.stringify(input)} equals the throttled banner: "${message}"`,
        );
        assert.equal(
          pauseCopy.has(message),
          false,
          `[${name}] empty-state copy for ${JSON.stringify(input)} equals a pause phrase: "${message}"`,
        );
      }
    }
  });

  it('never reads as a wait-and-retry instruction in English', () => {
    for (const input of EMPTY_STATE_INPUTS) {
      const message = searchEmptyMessage({ ...input, t: realT });
      assert.doesNotMatch(message, /try again|quick break|in a few seconds|in a few minutes|in about a minute/i);
    }
  });

  it('takes no throttled input at all — the split is by function, not by flag', () => {
    assert.equal(searchEmptyMessage.length, 1, 'searchEmptyMessage should take exactly one options argument');
    const signature = addSource.slice(
      addSource.indexOf('export function searchEmptyMessage'),
      addSource.indexOf('export function searchEmptyMessage') + 220,
    );
    assert.doesNotMatch(signature, /throttl/i);
  });
});

describe('describeSearchPause keeps its bands apart', () => {
  it('gives each of the three bands its own phrasing', () => {
    for (const { name, t } of TRANSLATORS) {
      const short = describeSearchPause(10_000, t);
      const medium = describeSearchPause(60_000, t);
      const long = describeSearchPause(300_000, t);
      assert.equal(new Set([short, medium, long]).size, 3, `[${name}] bands collapsed: ${short} / ${medium} / ${long}`);
    }
  });

  it('reads an unreported retry window as the short band, not as a made-up precise wait', () => {
    for (const { name, t } of TRANSLATORS) {
      assert.equal(describeSearchPause(null, t), describeSearchPause(10_000, t), `[${name}] null band drifted`);
      assert.equal(/\d/.test(describeSearchPause(null, t)), false, `[${name}] null band leaked a number`);
    }
  });

  it('shares no phrasing with any empty-state message', () => {
    for (const { name, t } of TRANSLATORS) {
      const emptyStateCopy = new Set(EMPTY_STATE_INPUTS.map((input) => searchEmptyMessage({ ...input, t })));
      for (const ms of RETRY_WINDOWS) {
        const pause = describeSearchPause(ms, t);
        assert.equal(
          emptyStateCopy.has(pause),
          false,
          `[${name}] pause phrase "${pause}" is also an empty-state message`,
        );
        assert.equal(
          emptyStateCopy.has(throttledBanner(ms, t)),
          false,
          `[${name}] throttled banner for ${String(ms)}ms is also an empty-state message`,
        );
      }
    }
  });
});

describe('only the genuine no-match copy names the food the user typed', () => {
  it('puts the query into the no-match message', () => {
    assert.equal(
      searchEmptyMessage({ query: 'brocoli', hasAnyRecent: false, t: stubT }),
      'add.search.empty.noMatches(query=brocoli)',
    );
    assert.match(searchEmptyMessage({ query: 'brocoli', hasAnyRecent: false, t: realT }), /brocoli/);
  });

  it('keeps the query out of the throttled banner for every retry window', () => {
    for (const { name, t } of TRANSLATORS) {
      for (const ms of RETRY_WINDOWS) {
        assert.doesNotMatch(
          throttledBanner(ms, t),
          /brocoli/,
          `[${name}] query leaked into the ${String(ms)}ms banner`,
        );
      }
    }
  });

  it('is enforced by the catalog: only the no-match string interpolates a query', () => {
    assert.match(COPY.empty.noMatches, /\{\{\s*query\s*\}\}/);
    assert.match(COPY.throttled, /\{\{\s*when\s*\}\}/);
    assert.doesNotMatch(COPY.throttled, /\{\{\s*query\s*\}\}/);
  });
});
