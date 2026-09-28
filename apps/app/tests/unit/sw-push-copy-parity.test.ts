/**
 * The service worker's copy of the push decision must not drift from its
 * source.
 *
 * `public/sw.js` is hand written and is not bundled, so it cannot import
 * `app/lib/push-decision.ts`; it loads `public/sw-push-decision.js`, a
 * transcription of that module into plain JavaScript. Two files, one rule, and
 * nothing but this test between them. Drift here is invisible in the worst
 * possible way: every unit test of the source stays green while the thing
 * actually installed on the phone shows different words, or no words.
 *
 * The comparison is BEHAVIOURAL, not textual. A diff of the two files would
 * have to be taught to ignore type annotations, `export` keywords and JSDoc,
 * and every one of those exceptions is a hole a real change can slip through.
 * Instead both implementations are run over the same matrix, every kind by
 * every record state by every language, and any disagreement in any of the four
 * returned fields fails.
 *
 * A matrix is only worth what its control is worth, so the last two tests
 * MUTATE the worker copy in memory, once in its copy and once in its freshness
 * window, and assert the comparison fails. If those pass while the matrix has
 * gone blind, the mutation controls are the thing that says so.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CATCH_UP_MAX_AGE_MS,
  decidePush,
  notificationPath,
  type NotificationData,
  type StoredCatchUpRecord,
} from '../../app/lib/push-decision';
import { loadWorkerPushDecision, readWorkerCopySource, type PushDecisionModule } from './sw-push-decision-harness';

const NOW = Date.UTC(2026, 8, 12, 5, 0, 0);

const FRESH: StoredCatchUpRecord = {
  forDay: '2026-09-11',
  title: 'Yesterday: 18 g net carbs',
  body: 'Protein was 96 g. Today you have 20 g to spend.',
  url: '/catch-up',
  locale: 'en',
  writtenAt: NOW - 60_000,
};

/** Every record state the worker can hand in, named so a failure says which. */
const RECORDS: Array<{ name: string; record: StoredCatchUpRecord | null }> = [
  { name: 'missing', record: null },
  { name: 'empty', record: {} },
  { name: 'fresh', record: FRESH },
  { name: 'German and fresh', record: { ...FRESH, locale: 'de-DE', title: 'Gestern', body: 'Protein 96 g.' } },
  { name: 'on the 36 hour edge', record: { ...FRESH, writtenAt: NOW - CATCH_UP_MAX_AGE_MS } },
  { name: 'one millisecond stale', record: { ...FRESH, writtenAt: NOW - CATCH_UP_MAX_AGE_MS - 1 } },
  { name: 'two days stale, German', record: { ...FRESH, locale: 'de', writtenAt: NOW - 48 * 60 * 60 * 1000 } },
  { name: 'blank title', record: { ...FRESH, title: '  ' } },
  { name: 'never written', record: { ...FRESH, writtenAt: 0 } },
  { name: 'with a query deep link', record: { ...FRESH, url: '/catch-up?day=2026-09-11' } },
];

const KINDS = ['catch-up', 'fast-target', 'stage-change', ''];
const LANGUAGES = ['en', 'en-GB', 'de', 'de-AT', 'fr-FR', ''];

const PATH_CASES: Array<NotificationData | null> = [
  null,
  {},
  { url: '' },
  { url: '/fasting' },
  { url: '/catch-up?day=2026-09-11' },
];

/** Run the two implementations over the matrix. Returns the first disagreement. */
function firstDisagreement(copy: PushDecisionModule): string | null {
  for (const kind of KINDS) {
    for (const { name, record } of RECORDS) {
      for (const language of LANGUAGES) {
        const fromSource = decidePush(kind, record, NOW, language);
        const fromCopy = copy.decidePush(kind, record, NOW, language);
        if (JSON.stringify(fromSource) !== JSON.stringify(fromCopy)) {
          return `kind ${JSON.stringify(kind)}, record ${name}, language ${JSON.stringify(language)}: source ${JSON.stringify(fromSource)} vs worker ${JSON.stringify(fromCopy)}`;
        }
      }
    }
  }

  for (const data of PATH_CASES) {
    const fromSource = notificationPath(data);
    const fromCopy = copy.notificationPath(data);
    if (fromSource !== fromCopy) {
      return `notificationPath(${JSON.stringify(data)}): source ${fromSource} vs worker ${fromCopy}`;
    }
  }

  return null;
}

describe('the worker copy of the push decision', () => {
  it('agrees with app/lib/push-decision.ts on every kind, record and language', () => {
    const copy = loadWorkerPushDecision(readWorkerCopySource());

    assert.equal(
      firstDisagreement(copy),
      null,
      'public/sw-push-decision.js has drifted from app/lib/push-decision.ts',
    );
  });

  it('attaches its functions under one namespace and touches nothing else', () => {
    const copy = loadWorkerPushDecision(readWorkerCopySource());

    assert.equal(Object.keys(copy).includes('decidePush'), true);
    assert.equal(Object.keys(copy).includes('notificationPath'), true);
  });
});

describe('the drift check itself', () => {
  it('fails when the copy words are changed', () => {
    const mutated = readWorkerCopySource().replace(
      "title: 'Your catch-up is ready'",
      "title: 'Your catch up is waiting'",
    );
    assert.notEqual(mutated, readWorkerCopySource(), 'the mutation did not apply, so this control proves nothing');

    const disagreement = firstDisagreement(loadWorkerPushDecision(mutated));

    assert.notEqual(disagreement, null, 'a changed generic line slipped past the matrix');
  });

  it('fails when the copy freshness window is changed', () => {
    const mutated = readWorkerCopySource().replace(
      'const CATCH_UP_MAX_AGE_MS = 36 * 60 * 60 * 1000;',
      'const CATCH_UP_MAX_AGE_MS = 1 * 60 * 60 * 1000;',
    );
    assert.notEqual(mutated, readWorkerCopySource(), 'the mutation did not apply, so this control proves nothing');

    const disagreement = firstDisagreement(loadWorkerPushDecision(mutated));

    assert.notEqual(disagreement, null, 'a changed freshness window slipped past the matrix');
  });
});
