/**
 * Reading an invite out of a URL, and the rule that it travels in the FRAGMENT.
 *
 * The parsing is dull; the placement is not. A query string carries a live
 * capability into browser history, into the next request's `Referer`, and into
 * the access log of every server the link crosses. The fragment never leaves
 * the browser. These tests pin the parse; `tests/unit/no-invite-in-query.test.ts`
 * pins that no code path builds the other kind of link.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInviteFragment } from '#app/lib/sync/invite-link';

test('an invite is read from the fragment, with or without the leading hash', () => {
  assert.equal(parseInviteFragment('#invite=abc123'), 'abc123');
  assert.equal(parseInviteFragment('invite=abc123'), 'abc123');
});

test('a base64url token survives the parse intact', () => {
  // The service mints `randomBytes(32).toString('base64url')`, so `-` and `_`
  // are ordinary characters here. A parser that decoded them wrongly would
  // produce a token that looks right and is refused.
  const token = 'VZPqQ8gRzJ9i4wJMxfYlOZeyfqBPPwgN5e-BrMnh5R4';
  assert.equal(parseInviteFragment(`#invite=${token}`), token);
});

test('an absent, empty or unrelated fragment yields null', () => {
  assert.equal(parseInviteFragment(''), null);
  assert.equal(parseInviteFragment('#'), null);
  assert.equal(parseInviteFragment('#section-two'), null);
  assert.equal(parseInviteFragment('#other=abc'), null);
  // `#invite=` is a malformed link, not a request to submit an empty token.
  assert.equal(parseInviteFragment('#invite='), null);
});

test('the invite is found beside other fragment parameters', () => {
  assert.equal(parseInviteFragment('#from=email&invite=abc123'), 'abc123');
});
