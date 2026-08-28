/**
 * SENDING A WINDOW — the three decisions the panel makes (M163/02).
 *
 * ── The picker has no default, and that is a consent rule ────────────────
 *
 * A pre-filled "last 90 days" is a pre-filled consent. The range IS the thing
 * being consented to — which days of a person's own diary leave the device —
 * so a range somebody else chose, already sitting in the boxes, turns the
 * choice into a confirmation. Asserted twice: on the constant, and on what the
 * panel actually renders, because a default could be introduced in either.
 *
 * ── Only an accepted submission names days ───────────────────────────────
 *
 * And it names them RAW. `new Date('2026-08-24').toLocaleDateString()` renders
 * the previous day west of UTC; a day key is a calendar day, not an instant.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { ResearchSubmitPanel } from '../../app/components/research-submit-panel';
import {
  EMPTY_WINDOW_DRAFT,
  isSendableWindow,
  submitOutcomeCopy,
  SUBMIT_OUTCOME_KEYS,
} from '../../app/lib/sync/research/submit-view';

function renderPanel(): string {
  return renderToStaticMarkup(
    withI18n(
      createElement(ResearchSubmitPanel, {
        studyAccountId: 903,
        onSubmit: () => undefined,
        isSubmitting: false,
        outcome: null,
      }),
    ),
  );
}

test('the window picker starts empty, with no range chosen for the person', async () => {
  assert.deepEqual(EMPTY_WINDOW_DRAFT, { fromDayKey: '', toDayKey: '' });
  // An empty draft is not sendable either, so "no default" does not quietly
  // mean "sends everything".
  assert.equal(isSendableWindow(EMPTY_WINDOW_DRAFT), false);

  const html = renderPanel();
  // Not vacuous: both date fields are on the page.
  assert.equal(html.match(/type="date"/g)?.length, 2);
  assert.doesNotMatch(html, /value="\d/, 'the picker rendered a date somebody else chose');
});

test('a window is sendable only when both ends are real days in order', async () => {
  assert.equal(isSendableWindow({ fromDayKey: '2026-08-01', toDayKey: '2026-08-24' }), true);
  assert.equal(isSendableWindow({ fromDayKey: '2026-08-24', toDayKey: '2026-08-24' }), true);
  assert.equal(isSendableWindow({ fromDayKey: '2026-08-24', toDayKey: '2026-08-01' }), false);
  assert.equal(isSendableWindow({ fromDayKey: '2026-08-01', toDayKey: '' }), false);
  assert.equal(isSendableWindow({ fromDayKey: '01/08/2026', toDayKey: '24/08/2026' }), false);
});

test('only an accepted submission names days, and it names them raw', async () => {
  const window = { fromDayKey: '2026-08-01', toDayKey: '2026-08-24' };

  const accepted = submitOutcomeCopy({
    result: { status: 'submitted', pseudonym: 'pid', contributionVersion: 3 },
    window,
  });
  assert.equal(accepted.key, SUBMIT_OUTCOME_KEYS.submitted);
  assert.deepEqual(accepted.params, { from: '2026-08-01', to: '2026-08-24', version: 3 });

  // Every refusal sent nothing, so none of them may quote a window: a screen
  // that names days which never went is the failure `research/contribute.ts`'s
  // ordering rule exists to prevent, restated one layer up.
  for (const result of [
    { status: 'conflict', currentVersion: 4 },
    { status: 'too-large' },
    { status: 'unknown-study' },
    { status: 'unavailable' },
  ] as const) {
    const copy = submitOutcomeCopy({ result, window });
    assert.equal(copy.key, SUBMIT_OUTCOME_KEYS[result.status]);
    assert.deepEqual(copy.params, {}, `${result.status} quoted a window it did not send`);
  }
});
