/**
 * The note under the sign-out button on `/settings/account`.
 *
 * The button used to read "Sign out everywhere" with a note that said the diary
 * stays on this device. Neither was true: the sign-out ends THIS device's
 * session, and on a managed instance the diary stays in the account while the
 * device hides it until the next sign-in. The note now has two sentences, and
 * the route chooses between them by the policy QUESTION
 * `signOutClosesTheDiary`, never by the mode name.
 *
 * NO SENTENCE IS PINNED HERE. Copy belongs to the wordsmith pass; this file
 * asserts that the keys exist and that the route branches on the question.
 * There is no DOM test library in this repo, so the branch is read off the
 * source, and the CONTROL below proves the reading can fail: the same check on
 * a copy of the source with the branch taken out must come back false.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../app/routes/settings.account.tsx', import.meta.url), 'utf8');
// SAFETY: the shipped English catalog; a missing key reads as `undefined`, which
// the optional fields below declare and the first test asserts against.
const english = JSON.parse(readFileSync(new URL('../../app/i18n/locales/en/common.json', import.meta.url), 'utf8')) as {
  account: { signOut: { note?: string; noteManaged?: string } };
};

/** Whether the route reads the policy question and picks the managed key with it. */
function choosesTheManagedNoteByThePolicyQuestion(route: string): boolean {
  const readsTheQuestion = /\{\s*signOutClosesTheDiary\s*\}\s*=\s*useInstancePolicy\(\)/.test(route);
  const branchesOnIt =
    /signOutClosesTheDiary\s*\?\s*t\('account\.signOut\.noteManaged'\)\s*:\s*t\('account\.signOut\.note'\)/.test(route);
  return readsTheQuestion && branchesOnIt;
}

describe('the account page sign-out note', () => {
  it('has both sentences in the English catalog', () => {
    assert.ok(english.account.signOut.note, 'account.signOut.note is missing or empty');
    assert.ok(english.account.signOut.noteManaged, 'account.signOut.noteManaged is missing or empty');
    assert.notEqual(english.account.signOut.note, english.account.signOut.noteManaged);
  });

  it('picks the managed note by the policy question, not by the mode name', () => {
    assert.equal(choosesTheManagedNoteByThePolicyQuestion(source), true);
    assert.doesNotMatch(source, /instanceMode|INSTANCE_MODE|mode\s*===/);
  });

  it('marks which diary the note names, so a browser check can tell the two apart', () => {
    assert.match(source, /data-diary=\{signOutClosesTheDiary \? 'account' : 'device'\}/);
  });

  it('control: the same reading fails when the branch is taken out', () => {
    const withoutTheBranch = source.replace(
      "{signOutClosesTheDiary ? t('account.signOut.noteManaged') : t('account.signOut.note')}",
      "{t('account.signOut.note')}",
    );
    assert.notEqual(withoutTheBranch, source, 'the replacement must have found the branch');
    assert.equal(choosesTheManagedNoteByThePolicyQuestion(withoutTheBranch), false);
  });
});
