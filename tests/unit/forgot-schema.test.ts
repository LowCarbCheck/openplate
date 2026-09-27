/**
 * `#app/lib/sync/forgot-schema`: `/forgot`'s one field, and the two decisions
 * around its request (2026-09-27 install rehearsal).
 *
 * THE REGRESSION: the form validated with the sign-in schema, which requires a
 * password the form has no field for, so no submission was ever valid and the
 * button did nothing. The first test submits exactly what the form posts, an
 * address and nothing else, and the control shows the old schema refusing it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWithZod } from '@conform-to/zod/v4';

import { decideForgotRequest, describeForgotFailure, makeForgotPasswordSchema } from '../../app/lib/sync/forgot-schema';
import { makeSyncSignInSchema } from '../../app/lib/sync/sign-in-schema';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';
import type { InstanceDescriptor } from '../../app/lib/sync/engine/protocol';

/** Echoes the key, so a test pins which message, never its wording. */
function fakeT(key: string): string {
  return key;
}

/** What `/forgot` posts: one field. */
function addressOnly(email: string): FormData {
  const formData = new FormData();
  formData.set('email', email);
  return formData;
}

describe('makeForgotPasswordSchema', () => {
  it('accepts an address with no password field, which is all the form posts', () => {
    const submission = parseWithZod(addressOnly('Person@Example.org'), { schema: makeForgotPasswordSchema(fakeT) });
    assert.equal(submission.status, 'success');
  });

  it('control: the sign-in schema the page used to use refuses the same submission', () => {
    const submission = parseWithZod(addressOnly('person@example.org'), { schema: makeSyncSignInSchema(fakeT) });
    assert.equal(submission.status, 'error');
    assert.deepEqual(submission.error?.passphrase, ['sync.signIn.passphraseRequired']);
  });

  it('still refuses what is not an address, on the email field', () => {
    const empty = parseWithZod(addressOnly(''), { schema: makeForgotPasswordSchema(fakeT) });
    assert.equal(empty.status, 'error');
    assert.deepEqual(empty.error?.email, ['sync.email.required']);
    const noAt = parseWithZod(addressOnly('person.example.org'), { schema: makeForgotPasswordSchema(fakeT) });
    assert.equal(noAt.status, 'error');
    assert.deepEqual(noAt.error?.email, ['sync.email.invalid']);
  });
});

/** A handshake whose only field that matters here is `mail`. */
function instanceWithMail(mail: boolean): InstanceDescriptor {
  return { name: 'test', language: 'en', mail, memberInvites: false, openSignup: false, plans: false, ai: null };
}

describe('decideForgotRequest', () => {
  it('sends nothing to an instance that says it has no mail', () => {
    assert.equal(decideForgotRequest(instanceWithMail(false)), 'no-mail');
  });

  it('sends to an instance with mail, and to one that has not said', () => {
    assert.equal(decideForgotRequest(instanceWithMail(true)), 'send');
    assert.equal(decideForgotRequest(null), 'send');
  });
});

describe('describeForgotFailure', () => {
  it('calls a request that never got an answer unreachable', () => {
    assert.equal(
      describeForgotFailure(new SyncRequestError({ kind: 'transport', message: 'fetch failed' })),
      'unreachable',
    );
  });

  it('calls every refusal the same thing, whatever the status', () => {
    for (const kind of ['throttled', 'server', 'invalid'] as const) {
      assert.equal(describeForgotFailure(new SyncRequestError({ kind, message: kind, status: 500 })), 'failed');
    }
    assert.equal(describeForgotFailure(new Error('anything else')), 'failed');
  });
});
