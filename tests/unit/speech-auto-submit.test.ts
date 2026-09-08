/**
 * A finished transcript runs the AI intake, and the two exceptions.
 *
 * WHAT CHANGED AND WHY. Speech used to fill the search field and stop there,
 * which meant somebody who tapped the microphone, said their whole lunch, and
 * looked away then had to look back, read a search list, and pick one row of
 * it. Speaking a meal is the one input where the person is least likely to be
 * watching the screen, so it is the one input where stopping halfway costs the
 * most. It submits now.
 *
 * The two things that stop it are the only two that can: nothing was heard, so
 * there is no intake to run and a paid call about an empty string is worse than
 * useless; or there is no AI provider on this device, so the call cannot happen
 * at all and the database search is still a real answer.
 *
 * `fill-only` never means "discard": the caller puts the transcript in the box
 * either way. That is why the empty-transcript case is safe to route here
 * rather than to a third outcome.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { INTAKE_SOURCES, resolveSpeechIntakeAction } from '../../app/lib/intake-source';

describe('resolveSpeechIntakeAction', () => {
  it('submits a heard sentence when there is an AI to send it to', () => {
    assert.equal(
      resolveSpeechIntakeAction({ transcript: '3 eggs and two slices of toast', hasAiProvider: true }),
      'submit',
    );
  });

  it('fills the field only when nothing was heard', () => {
    assert.equal(resolveSpeechIntakeAction({ transcript: '', hasAiProvider: true }), 'fill-only');
  });

  it('treats whitespace as nothing heard', () => {
    assert.equal(resolveSpeechIntakeAction({ transcript: '   \n ', hasAiProvider: true }), 'fill-only');
  });

  it('fills the field only when this device has no AI provider', () => {
    assert.equal(resolveSpeechIntakeAction({ transcript: 'a banana', hasAiProvider: false }), 'fill-only');
  });

  it('does not submit while the provider answer is still unknown', () => {
    // `useAiConnection` reports `unknown` until its IndexedDB read lands, and
    // the caller passes that through as `false`. Submitting on an optimistic
    // guess would navigate to a scan screen that then says "connect a
    // provider" for a sentence the person already spoke.
    assert.equal(resolveSpeechIntakeAction({ transcript: 'a banana', hasAiProvider: false }), 'fill-only');
  });
});

describe('intake sources', () => {
  it('names all three ways in', () => {
    assert.deepStrictEqual([...INTAKE_SOURCES], ['photo', 'text', 'speech']);
  });
});
