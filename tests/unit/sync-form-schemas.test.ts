/**
 * Unit tests for the three sync form schemas — signup, sign-in and reset.
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
import { MAX_EMAIL_LENGTH } from '../../app/lib/sync/email';
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
      invite: `${SYNC_INVITE_PREFIX}TESTTOKENONLY`,
      passphrase: GOOD_PASSPHRASE,
      confirmPassphrase: GOOD_PASSPHRASE,
    });
    assert.equal(submission.status, 'success');
  });

  // THERE IS NO ADDRESS FIELD, and that is the shape rather than an omission:
  // the invite is written to an address, the service reads it off the token,
  // and a form that asked would let somebody create an account at an address
  // their admin did not invite.
  it('has no address field for a submission to carry', () => {
    const submission = parseSignup({
      invite: `${SYNC_INVITE_PREFIX}TESTTOKENONLY`,
      email: 'somebody-else@example.org',
      passphrase: GOOD_PASSPHRASE,
      confirmPassphrase: GOOD_PASSPHRASE,
    });
    assert.equal(submission.status, 'success');
    assert.equal(submission.status === 'success' && 'email' in submission.value, false);
  });

  it('reports an empty form under the fields, not as one message', () => {
    const submission = parseSignup({ invite: '', passphrase: '', confirmPassphrase: '' }, 'required');
    assert.equal(submission.status, 'error');
    assert.deepEqual(erroredFields(submission), ['invite', 'passphrase']);
  });

  it('refuses a short passphrase under the passphrase field, naming the minimum', () => {
    const submission = parseSignup({ passphrase: 'short', confirmPassphrase: 'short' });
    assert.deepEqual(errorsOf(submission).passphrase, [
      `sync.setup.passphraseTooShort {"min":${MIN_SYNC_PASSPHRASE_LENGTH}}`,
    ]);
  });

  // Under CONFIRM: the field the person is asked to change is the second one.
  it('reports a mismatch under the confirmation, not under the passphrase', () => {
    const submission = parseSignup({
      passphrase: GOOD_PASSPHRASE,
      confirmPassphrase: `${GOOD_PASSPHRASE} typo`,
    });
    assert.deepEqual(erroredFields(submission), ['confirmPassphrase']);
    assert.deepEqual(errorsOf(submission).confirmPassphrase, ['sync.setup.passphraseMismatch']);
  });

  it('reports every broken rule at once, each under its own field', () => {
    const submission = parseSignup({ invite: 'nope', passphrase: 'short', confirmPassphrase: 'other' }, 'required');
    assert.deepEqual(erroredFields(submission), ['confirmPassphrase', 'invite', 'passphrase']);
  });

  it('demands an invite when the instance is invite-only, which every instance now is', () => {
    const submission = parseSignup(
      { invite: '  ', passphrase: GOOD_PASSPHRASE, confirmPassphrase: GOOD_PASSPHRASE },
      'required',
    );
    assert.deepEqual(errorsOf(submission).invite, ['sync.create.inviteMissing']);
  });

  // The commonest paste mistake: the surrounding link text, or a code from
  // another product. Only the service can say whether a code is still live,
  // but "that is not an invite code at all" is knowable here.
  it('refuses a value that does not carry the invite prefix', () => {
    const submission = parseSignup(
      {
        invite: 'https://example.com/#invite=si_TOKEN',
        passphrase: GOOD_PASSPHRASE,
        confirmPassphrase: GOOD_PASSPHRASE,
      },
      'required',
    );
    assert.deepEqual(errorsOf(submission).invite, [`sync.create.inviteMalformed {"prefix":"${SYNC_INVITE_PREFIX}"}`]);
  });

  it('lets the display name be empty, because it is the one optional field', () => {
    const submission = parseSignup({
      invite: `${SYNC_INVITE_PREFIX}TESTTOKENONLY`,
      displayName: '',
      passphrase: GOOD_PASSPHRASE,
      confirmPassphrase: GOOD_PASSPHRASE,
    });
    assert.equal(submission.status, 'success');
  });
});

describe('makeSyncSignInSchema', () => {
  const parseSignIn = (values: Record<string, string>) =>
    parseWithZod(formDataOf(values), { schema: makeSyncSignInSchema(fakeT) });

  it('accepts an address and a password', () => {
    assert.equal(parseSignIn({ email: 'anna@example.org', passphrase: 'x' }).status, 'success');
  });

  it('reports both empty fields, each under its own', () => {
    const submission = parseSignIn({ email: '', passphrase: '' });
    assert.deepEqual(erroredFields(submission), ['email', 'passphrase']);
    assert.deepEqual(errorsOf(submission).email, ['sync.email.required']);
    assert.deepEqual(errorsOf(submission).passphrase, ['sync.signIn.passphraseRequired']);
  });

  // THE RULE IS INVERTED from the one it replaced: a handle was refused for
  // containing `@`, and an address is refused for not containing exactly one.
  it('refuses a handle-shaped value here — no such account can exist', () => {
    assert.deepEqual(errorsOf(parseSignIn({ email: 'quick-otter-42', passphrase: 'x' })).email, ['sync.email.invalid']);
  });

  it('refuses an address past the service’s own length bound', () => {
    const tooLong = `${'a'.repeat(MAX_EMAIL_LENGTH)}@example.org`;
    assert.deepEqual(errorsOf(parseSignIn({ email: tooLong, passphrase: 'x' })).email, [
      `sync.email.tooLong {"max":${MAX_EMAIL_LENGTH}}`,
    ]);
  });

  // Signing in is not choosing: the account is the only authority on whether a
  // password opens it, and refusing a short one here would be both useless and
  // wrong.
  it('does not hold an existing password to the signup length floor', () => {
    assert.equal(parseSignIn({ email: 'anna@example.org', passphrase: 'short' }).status, 'success');
  });
});

describe('makeSyncRecoverySchema', () => {
  const parseReset = (values: Record<string, string>) =>
    parseWithZod(formDataOf(values), { schema: makeSyncRecoverySchema(fakeT) });

  it('accepts a new password and its confirmation, and asks for nothing else', () => {
    const submission = parseReset({ passphrase: GOOD_PASSPHRASE, confirmPassphrase: GOOD_PASSPHRASE });
    assert.equal(submission.status, 'success');
  });

  // WHAT M192 DELETED: a sign-in name and a recovery code. The reset token in
  // the mailed link identifies the account and the service hands back the
  // escrowed code, so there is nothing left for a person to remember.
  it('reports only the password fields, because there are only password fields', () => {
    const submission = parseReset({ passphrase: '', confirmPassphrase: '' });
    assert.deepEqual(erroredFields(submission), ['passphrase']);
  });

  // Unlike sign-in, this field IS a person choosing a password.
  it('holds the new password to the signup length floor', () => {
    const submission = parseReset({ passphrase: 'short', confirmPassphrase: 'short' });
    assert.deepEqual(errorsOf(submission).passphrase, [
      `sync.setup.passphraseTooShort {"min":${MIN_SYNC_PASSPHRASE_LENGTH}}`,
    ]);
  });

  it('reports a mismatch under the confirmation', () => {
    const submission = parseReset({ passphrase: GOOD_PASSPHRASE, confirmPassphrase: `${GOOD_PASSPHRASE} typo` });
    assert.deepEqual(errorsOf(submission).confirmPassphrase, ['sync.setup.passphraseMismatch']);
  });
});
