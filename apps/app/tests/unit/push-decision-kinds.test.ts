/**
 * Unit tests for `#app/lib/push-decision` kinds: which line each kind shows,
 * where a tap on it lands, and what an unrecognised kind does.
 *
 * The server sends a kind and nothing else, so this is the whole contract
 * between the two repos. An unknown kind is not an error case to be swallowed:
 * an older worker will meet a newer server one day, and the push it cannot name
 * still has to show a notification or the permission pays for it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CATCH_UP_PATH,
  CATCH_UP_TAG,
  FASTING_PATH,
  FAST_TARGET_TAG,
  decidePush,
  notificationPath,
  type StoredCatchUpRecord,
} from '../../app/lib/push-decision';

const NOW = Date.UTC(2026, 8, 12, 5, 0, 0);

const FRESH: StoredCatchUpRecord = {
  forDay: '2026-09-11',
  title: 'Yesterday: 18 g net carbs',
  body: 'Protein was 96 g. Today you have 20 g to spend.',
  url: CATCH_UP_PATH,
  locale: 'en',
  writtenAt: NOW - 60_000,
};

describe('the fast-target kind', () => {
  it('shows the English line and deep links the fasting screen', () => {
    const decision = decidePush('fast-target', null, NOW, 'en-GB');

    assert.equal(decision.title, 'Your fast has reached its target');
    assert.equal(decision.body, 'Keep going or end it, your call.');
    assert.equal(decision.url, FASTING_PATH);
    assert.equal(decision.tag, FAST_TARGET_TAG);
  });

  it('shows the German line on a German device', () => {
    const decision = decidePush('fast-target', null, NOW, 'de-DE');

    assert.equal(decision.title, 'Dein Fasten hat das Ziel erreicht');
    assert.equal(decision.body, 'Weitermachen oder beenden, deine Entscheidung.');
    assert.equal(decision.url, FASTING_PATH);
  });

  it('never borrows the catch-up record, however fresh that record is', () => {
    // The control for the read being skipped: a fast alert that leaked
    // yesterday's carb sentence would be both wrong and confusing.
    const decision = decidePush('fast-target', FRESH, NOW, 'en');

    assert.equal(decision.title, 'Your fast has reached its target');
    assert.equal(decision.url, FASTING_PATH);
  });
});

describe('the catch-up kind', () => {
  it('deep links the catch-up screen', () => {
    const decision = decidePush('catch-up', FRESH, NOW, 'en');

    assert.equal(decision.url, CATCH_UP_PATH);
    assert.equal(decision.tag, CATCH_UP_TAG);
  });
});

describe('a kind this worker does not know', () => {
  const unknownKinds = ['stage-change', 'meal-reminder', '', 'CATCH-UP', 'null'];

  it('still shows something, and shows the catch-up', () => {
    for (const kind of unknownKinds) {
      const decision = decidePush(kind, null, NOW, 'en');

      assert.equal(decision.title, 'Your catch-up is ready', `kind ${JSON.stringify(kind)}`);
      assert.equal(decision.url, CATCH_UP_PATH);
      assert.equal(decision.tag, CATCH_UP_TAG);
    }
  });

  it('shows a fresh record for an unknown kind rather than the generic line', () => {
    const decision = decidePush('stage-change', FRESH, NOW, 'en');

    assert.equal(decision.title, FRESH.title);
  });
});

describe('every decision', () => {
  it('carries a title, a body and a path, for every kind and record state', () => {
    const records: Array<StoredCatchUpRecord | null> = [null, {}, FRESH, { ...FRESH, writtenAt: 0 }];

    for (const kind of ['catch-up', 'fast-target', 'who-knows']) {
      for (const record of records) {
        for (const language of ['en', 'de', 'fr', '']) {
          const decision = decidePush(kind, record, NOW, language);

          assert.notEqual(decision.title.trim(), '');
          assert.notEqual(decision.body.trim(), '');
          assert.match(decision.url, /^\//);
          assert.notEqual(decision.tag.trim(), '');
        }
      }
    }
  });
});

describe('notificationPath', () => {
  it('defaults to the catch-up when the notification carries no url', () => {
    assert.equal(notificationPath({}), CATCH_UP_PATH);
    assert.equal(notificationPath(null), CATCH_UP_PATH);
    assert.equal(notificationPath({ url: '' }), CATCH_UP_PATH);
  });

  it('returns the url the notification carries', () => {
    assert.equal(notificationPath({ url: FASTING_PATH }), FASTING_PATH);
    assert.equal(notificationPath({ url: '/catch-up?day=2026-09-11' }), '/catch-up?day=2026-09-11');
  });
});
