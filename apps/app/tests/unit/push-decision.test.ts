/**
 * Unit tests for `#app/lib/push-decision` freshness: which of the two texts a
 * catch-up push shows, the device's own words or the generic line.
 *
 * The fresh case is the control for every other case here. A decision function
 * that had lost its record read, or that fell back unconditionally, would still
 * satisfy "always shows something" and would still pass every stale and missing
 * assertion below. Only the fresh case fails it, so it is asserted on the
 * record's exact words rather than on "not the generic line".
 *
 * The kinds and the deep links are in `push-decision-kinds.test.ts`; the
 * service worker's copy of this logic is held to the same behaviour by
 * `sw-push-copy-parity.test.ts`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CATCH_UP_MAX_AGE_MS,
  CATCH_UP_PATH,
  CATCH_UP_TAG,
  decidePush,
  type StoredCatchUpRecord,
} from '../../app/lib/push-decision';

/** A morning push, 07:00 local on the day after the day being summarised. */
const NOW = Date.UTC(2026, 8, 12, 5, 0, 0);

/** What `app/lib/notify-store.ts` writes: the device's own sentence. */
const WRITTEN: StoredCatchUpRecord = {
  forDay: '2026-09-11',
  title: 'Yesterday: 18 g net carbs',
  body: 'Protein was 96 g. Today you have 20 g to spend.',
  url: '/catch-up',
  locale: 'en',
  writtenAt: NOW - 60_000,
};

const GENERIC_EN_TITLE = 'Your catch-up is ready';
const GENERIC_DE_TITLE = 'Dein Tagesrückblick ist da';

describe('decidePush, a fresh record', () => {
  it('shows the words the device wrote, not the generic line', () => {
    const decision = decidePush('catch-up', WRITTEN, NOW, 'en-GB');

    assert.equal(decision.title, 'Yesterday: 18 g net carbs');
    assert.equal(decision.body, 'Protein was 96 g. Today you have 20 g to spend.');
    assert.equal(decision.url, CATCH_UP_PATH);
    assert.equal(decision.tag, CATCH_UP_TAG);
  });

  it('keeps a record written in German in German, whatever the navigator says', () => {
    const german: StoredCatchUpRecord = {
      ...WRITTEN,
      title: 'Gestern: 18 g Netto-Kohlenhydrate',
      body: 'Protein lag bei 96 g.',
      locale: 'de-DE',
    };

    const decision = decidePush('catch-up', german, NOW, 'en-US');

    assert.equal(decision.title, 'Gestern: 18 g Netto-Kohlenhydrate');
  });

  it('follows the record own deep link when it carries one', () => {
    const decision = decidePush('catch-up', { ...WRITTEN, url: '/catch-up?day=2026-09-11' }, NOW, 'en');

    assert.equal(decision.url, '/catch-up?day=2026-09-11');
  });
});

describe('decidePush, the 36 hour window', () => {
  it('shows a record written exactly 36 hours ago', () => {
    const decision = decidePush('catch-up', { ...WRITTEN, writtenAt: NOW - CATCH_UP_MAX_AGE_MS }, NOW, 'en');

    assert.equal(decision.title, WRITTEN.title);
  });

  it('falls back one millisecond past 36 hours', () => {
    const decision = decidePush('catch-up', { ...WRITTEN, writtenAt: NOW - CATCH_UP_MAX_AGE_MS - 1 }, NOW, 'en');

    assert.equal(decision.title, GENERIC_EN_TITLE);
  });

  it('falls back for a two day old record in the language that record was written in', () => {
    const stale: StoredCatchUpRecord = {
      ...WRITTEN,
      locale: 'de',
      writtenAt: NOW - 48 * 60 * 60 * 1000,
    };

    const decision = decidePush('catch-up', stale, NOW, 'en-US');

    assert.equal(decision.title, GENERIC_DE_TITLE);
    assert.equal(decision.body, 'Öffne openplate für gestern und das, was ansteht.');
    assert.equal(decision.url, CATCH_UP_PATH);
    assert.equal(decision.tag, CATCH_UP_TAG);
  });
});

describe('decidePush, no record to show', () => {
  // A read that found nothing, a read that timed out and a read that threw all
  // reach this function as null: the worker has one representation for "no
  // record", so there is one path to test.
  it('falls back to English for a missing record on an English device', () => {
    const decision = decidePush('catch-up', null, NOW, 'en-GB');

    assert.equal(decision.title, GENERIC_EN_TITLE);
    assert.equal(decision.body, 'Open openplate for yesterday and what lies ahead.');
  });

  it('falls back to German for a missing record on a German device', () => {
    const decision = decidePush('catch-up', null, NOW, 'de-AT');

    assert.equal(decision.title, GENERIC_DE_TITLE);
  });

  it('falls back to English on a device in a language the app does not ship', () => {
    const decision = decidePush('catch-up', null, NOW, 'fr-FR');

    assert.equal(decision.title, GENERIC_EN_TITLE);
  });

  it('treats a half written record as no record, so nothing blank is ever shown', () => {
    const cases: Array<StoredCatchUpRecord> = [
      { ...WRITTEN, title: '' },
      { ...WRITTEN, body: '   ' },
      { ...WRITTEN, writtenAt: 0 },
      { forDay: '2026-09-11' },
      {},
    ];

    for (const record of cases) {
      const decision = decidePush('catch-up', record, NOW, 'en');
      assert.equal(decision.title, GENERIC_EN_TITLE, `record ${JSON.stringify(record)} should fall back`);
      assert.notEqual(decision.body, '');
    }
  });
});
