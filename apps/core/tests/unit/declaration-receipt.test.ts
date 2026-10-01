/**
 * `toDeclarationReceipt` (M270/11): what the route hands the receipt builder.
 *
 * The receipt goes to an address the sender TYPED, which need not be theirs.
 * So it carries no text the sender wrote, only whether each such field was
 * given. The operator's copy is built from the full row and is held to every
 * word in `declaration-message.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDeclarationReceipt, type DeclarationFields } from '../../src/mail/declaration-message.js';

const RECEIVED_AT = new Date('2026-09-21T10:15:00.000Z');

const FREE_TEXT = {
  name: 'Anna https://evil.example/a',
  contractReference: 'www.evil.example/b',
  reason: 'Claim your prize at evil.example/c',
};

function fields(overrides: Partial<DeclarationFields> = {}): DeclarationFields {
  return {
    kind: 'kuendigung',
    ...FREE_TEXT,
    email: 'Anna@Example.org',
    terminationType: 'ausserordentlich',
    requestedDate: '2026-10-31',
    timing: 'onDate',
    receivedAt: RECEIVED_AT,
    ...overrides,
  };
}

test('the receipt facts carry no field the sender wrote, only whether it was given', () => {
  const receipt = toDeclarationReceipt(fields());
  const carried = JSON.stringify(receipt);
  for (const value of Object.values(FREE_TEXT)) {
    assert.equal(carried.includes(value), false, `the receipt carries "${value}"`);
  }
  assert.equal(carried.includes('evil'), false);
  assert.deepEqual(receipt, {
    kind: 'kuendigung',
    email: 'Anna@Example.org',
    hasContractReference: true,
    terminationType: 'ausserordentlich',
    hasReason: true,
    requestedDate: '2026-10-31',
    timing: 'onDate',
    receivedAt: RECEIVED_AT,
  });
});

test('CONTROL: a free-text field left out reads as not given', () => {
  const receipt = toDeclarationReceipt(fields({ contractReference: null, reason: null }));
  assert.equal(receipt.hasContractReference, false);
  assert.equal(receipt.hasReason, false);
});
