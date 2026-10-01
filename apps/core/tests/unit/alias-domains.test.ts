/**
 * The alias and forwarding domain list (M270, spec 04): matched on the domain
 * and every parent of it. What the stores do with the answer is covered end
 * to end in `tests/integration/scan-trial.test.ts`, where the signup route
 * runs against a real database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALIAS_DOMAINS, isAliasAddress } from '../../src/lib/alias-domains.js';

test('a listed alias domain is an alias address', () => {
  assert.equal(isAliasAddress('anna@simplelogin.co'), true);
  assert.equal(isAliasAddress('anna@privaterelay.appleid.com'), true);
});

test('any subdomain of a listed domain is an alias address', () => {
  assert.equal(isAliasAddress('anna@a.b.simplelogin.co'), true);
  assert.equal(isAliasAddress('anna@x.mailinator.com'), true);
});

test('the match ignores case, so the answer does not depend on who lowercased the address', () => {
  assert.equal(isAliasAddress('Anna@SimpleLogin.CO'), true);
  assert.equal(isAliasAddress('anna@A.B.ANONADDY.COM'), true);
});

test('an ordinary mailbox is not an alias address', () => {
  // THE CONTROL: a matcher that answered `true` for everything passes the
  // tests above and fails here.
  assert.equal(isAliasAddress('anna@gmail.com'), false);
  assert.equal(isAliasAddress('anna@example.org'), false);
  assert.equal(isAliasAddress('anna@icloud.com'), false);
});

test('a lookalike name and a bare suffix are not matched', () => {
  assert.equal(isAliasAddress('anna@notsimplelogin.co'), false);
  assert.equal(isAliasAddress('anna@simplelogin.co.example.org'), false);
  assert.equal(isAliasAddress('anna@co'), false);
  assert.equal(isAliasAddress('not an address'), false);
});

test('the list is sorted, lowercase, has no duplicates, and never lists a bare top-level domain', () => {
  const list = [...ALIAS_DOMAINS];
  assert.deepEqual(list, [...list].toSorted(), 'keep the list sorted');
  for (const domain of list) {
    assert.equal(domain, domain.toLowerCase());
    assert.ok(domain.includes('.'), `${domain} is a bare top-level domain`);
  }
  assert.equal(ALIAS_DOMAINS.has('icloud.com'), false, 'a real mailbox provider is not an alias service');
});
