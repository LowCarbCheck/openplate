/**
 * Unit tests for the three sync form schemas — signup, sign-in and recovery.
 *
 * They are asserted THROUGH `parseWithZod`, the way Conform runs them, and the
 * assertions are on `submission.error`'s KEYS: the whole point of the change
 * that introduced these schemas (owner request, 2026-09-02) is that a broken
 * rule names the field it belongs to, so a test that only checked "this was
 * refused" would pass on the shape it replaced.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWithZod } from '@conform-to/zod/v4';

import { makeSyncSignupSchema } from '../../app/lib/sync/signup-schema';
import { makeSyncSignInSchema } from '../../app/lib/sync/sign-in-schema';
import { makeSyncRecoverySchema } from '../../app/lib/sync/recovery-schema';
import type { Translate } from '../../app/lib/sync/setup-flow';
import { MAX_HANDLE_LENGTH } from '../../app/lib/sync/handle';
import { MIN_SYNC_PASSPHRASE_LENGTH } from '../../app/lib/sync/setup-flow';
import { SYNC_INVITE_PREFIX } from '../../app/lib/sync/invite-link';

/** Renders `key` plus any interpolation params, so both are assertable without i18next. */
const fakeT: Translate = (key, params) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`);

const GOOD_PASSPHRASE = 'a correct horse battery staple';

function formDataOf(values: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) formData.append(name, value);
  return formData;
}

/**
 * The errors a submission reported, keyed by field.
 *
 * Narrowing by hand because Conform's `Submission` is a union: `error` only
 * exists on the failing branch, and every assertion below is about which KEY
 * an error landed on.
 */
type ParsedSubmission =
  { status: 'success' } | { status: 'error' | undefined; error: Record<string, string[] | null> | null };

function errorsOf(submission: ParsedSubmission): Record<string, string[] | null> {
  return submission.status === 'success' ? {} : (submission.error ?? {});
}

/** The field names a submission reported an error for — the assertion this file is about. */
function erroredFields(submission: ParsedSubmission): string[] {
  return Object.keys(errorsOf(submission)).toSorted();
}

function parseSignup(values: Record<string, string>, invite: 'none' | 'optional' | 'required' = 'none') {
  return parseWithZod(formDataOf(values), { schema: makeSyncSignupSchema(fakeT, { invite }) });
}

describe('makeSyncSignupSchema', () => {
  it('accepts a filled-in form', () => {
    const submission = parseSignup({
      handle: 'quick-otter-42',
      passphrase: GOOD_PASSPHRASE,
      confirmPassphrase: GOOD_PASSPHRASE,
    });
    assert.equal(submission.status, 'success');
  });

  it('reports an empty form under the fields, not as one message', () => {
    const submission = parseSignup({ handle: '', passphrase: '', confirmPassphrase: '' });
    assert.equal(submission.status, 'error');
    assert.deepEqual(erroredFields(submission), ['handle', 'passphrase']);
  });

  it('names an empty handle as required, under the handle field', () => {
    const submission = parseSignup({ handle: '   ', passphrase: GOOD_PASSPHRASE, confirmPassphrase: GOOD_PASSPHRASE });
    assert.equal(submission.status, 'error');
    assert.deepEqual(errorsOf(submission).handle, ['sync.setup.handleRequired']);
  });

  // The mistake a person arriving from any other service is most likely to
  // make, and the one the copy has to be unmistakable about.
  it('refuses an email-shaped handle under the handle field', () => {
    const submission = parseSignup({
      handle: 'me@example.com',
      passphrase: GOOD_PASSPHRASE,
      confirmPassphrase: GOOD_PASSPHRASE,
    });
    assert.deepEqual(errorsOf(submission).handle, ['sync.setup.handleNotAnEmail']);
  });

  it('refuses a handle past the service’s own length bound', () => {
    const submission = parseSignup({
      handle: 'a'.repeat(MAX_HANDLE_LENGTH + 1),
      passphrase: GOOD_PASSPHRASE,
      confirmPassphrase: GOOD_PASSPHRASE,
    });
    assert.deepEqual(errorsOf(submission).handle, ['sync.setup.handleTooLong']);
  });

  it('refuses a short passphrase under the passphrase field, naming the minimum', () => {
    const submission = parseSignup({ handle: 'quick-otter-42', passphrase: 'short', confirmPassphrase: 'short' });
    assert.deepEqual(errorsOf(submission).passphrase, [
      `sync.setup.passphraseTooShort {"min":${MIN_SYNC_PASSPHRASE_LENGTH}}`,
    ]);
  });

  // Under CONFIRM: the field the person is asked to change is the second one.
  it('reports a mismatch under the confirmation, not under the passphrase', () => {
    const submission = parseSignup({
      handle: 'quick-otter-42',
      passphrase: GOOD_PASSPHRASE,
      confirmPassphrase: `${GOOD_PASSPHRASE} typo`,
    });
    assert.deepEqual(erroredFields(submission), ['confirmPassphrase']);
    assert.deepEqual(errorsOf(submission).confirmPassphrase, ['sync.setup.passphraseMismatch']);
  });

  it('reports every broken rule at once, each under its own field', () => {
    const submission = parseSignup(
      { invite: 'nope', handle: 'me@example.com', passphrase: 'short', confirmPassphrase: 'other' },
      'required',
    );
    assert.deepEqual(erroredFields(submission), ['confirmPassphrase', 'handle', 'invite', 'passphrase']);
  });

  it('ignores the invite entirely when the instance neither wants nor was given one', () => {
    const submission = parseSignup(
      {
        invite: 'not-a-token',
        handle: 'quick-otter-42',
        passphrase: GOOD_PASSPHRASE,
        confirmPassphrase: GOOD_PASSPHRASE,
      },
      'none',
    );
    assert.equal(submission.status, 'success');
  });

  it('demands an invite when the instance is invite-only', () => {
    const submission = parseSignup(
      { invite: '  ', handle: 'quick-otter-42', passphrase: GOOD_PASSPHRASE, confirmPassphrase: GOOD_PASSPHRASE },
      'required',
    );
    assert.deepEqual(errorsOf(submission).invite, ['sync.create.inviteMissing']);
  });

  it('lets an optional invite be left empty', () => {
    const submission = parseSignup(
      { invite: '', handle: 'quick-otter-42', passphrase: GOOD_PASSPHRASE, confirmPassphrase: GOOD_PASSPHRASE },
      'optional',
    );
    assert.equal(submission.status, 'success');
  });

  // The commonest paste mistake: the surrounding link text, or a code from
  // another product. Only the service can say whether a code is still live,
  // but "that is not an invite code at all" is knowable here.
  it('refuses a value that does not carry the invite prefix', () => {
    const submission = parseSignup(
      {
        invite: 'https://example.com/#invite=si_TOKEN',
        handle: 'quick-otter-42',
        passphrase: GOOD_PASSPHRASE,
        confirmPassphrase: GOOD_PASSPHRASE,
      },
      'optional',
    );
    assert.deepEqual(errorsOf(submission).invite, [`sync.create.inviteMalformed {"prefix":"${SYNC_INVITE_PREFIX}"}`]);
  });

  it('accepts a value that does carry the invite prefix', () => {
    const submission = parseSignup(
      {
        invite: `${SYNC_INVITE_PREFIX}TESTTOKENONLY`,
        handle: 'quick-otter-42',
        passphrase: GOOD_PASSPHRASE,
        confirmPassphrase: GOOD_PASSPHRASE,
      },
      'required',
    );
    assert.equal(submission.status, 'success');
  });
});

describe('makeSyncSignInSchema', () => {
  const parseSignIn = (values: Record<string, string>) =>
    parseWithZod(formDataOf(values), { schema: makeSyncSignInSchema(fakeT) });

  it('accepts a name and a passphrase', () => {
    assert.equal(parseSignIn({ handle: 'quick-otter-42', passphrase: 'x' }).status, 'success');
  });

  // Not the signup sentence: that one offers to suggest a name, and this form
  // has no suggest button and is asking for a name that already exists.
  it('reports both empty fields, each under its own, with sign-in copy', () => {
    const submission = parseSignIn({ handle: '', passphrase: '' });
    assert.deepEqual(erroredFields(submission), ['handle', 'passphrase']);
    assert.deepEqual(errorsOf(submission).handle, ['sync.signIn.handleRequired']);
    assert.deepEqual(errorsOf(submission).passphrase, ['sync.signIn.passphraseRequired']);
  });

  it('refuses an email-shaped name here too — no such account can exist', () => {
    const submission = parseSignIn({ handle: 'me@example.com', passphrase: 'x' });
    assert.deepEqual(errorsOf(submission).handle, ['sync.setup.handleNotAnEmail']);
  });

  // Signing in is not choosing: the account is the only authority on whether a
  // passphrase opens it, and refusing a short one here would be both useless
  // and wrong.
  it('does not hold an existing passphrase to the signup length floor', () => {
    assert.equal(parseSignIn({ handle: 'quick-otter-42', passphrase: 'short' }).status, 'success');
  });
});

describe('makeSyncRecoverySchema', () => {
  const parseRecovery = (values: Record<string, string>) =>
    parseWithZod(formDataOf(values), { schema: makeSyncRecoverySchema(fakeT) });

  it('accepts a name, a code and a new passphrase', () => {
    const submission = parseRecovery({
      handle: 'quick-otter-42',
      recoveryCode: 'ABCDE-FGHJK',
      passphrase: GOOD_PASSPHRASE,
    });
    assert.equal(submission.status, 'success');
  });

  it('reports all three empty fields separately', () => {
    const submission = parseRecovery({ handle: '', recoveryCode: '', passphrase: '' });
    assert.deepEqual(erroredFields(submission), ['handle', 'passphrase', 'recoveryCode']);
    assert.deepEqual(errorsOf(submission).handle, ['sync.signIn.handleRequired']);
    assert.deepEqual(errorsOf(submission).recoveryCode, ['sync.recover.codeRequired']);
  });

  // Unlike sign-in, this field IS a person choosing a passphrase — and the one
  // it replaces protected data nobody can recover for them.
  it('holds the new passphrase to the signup length floor', () => {
    const submission = parseRecovery({ handle: 'quick-otter-42', recoveryCode: 'ABCDE-FGHJK', passphrase: 'short' });
    assert.deepEqual(errorsOf(submission).passphrase, [
      `sync.setup.passphraseTooShort {"min":${MIN_SYNC_PASSPHRASE_LENGTH}}`,
    ]);
  });
});
