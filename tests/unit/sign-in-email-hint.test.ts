/**
 * THE SIGN-IN FORM NAMES THE EMAIL ADDRESS AS THE IDENTIFIER.
 *
 * The defect this file exists for: someone who set a password via an invite
 * link signs in on another device later and looks for a "sign-in name" or a
 * username, because that was the wording of an older era when accounts had a
 * chosen handle. There is no username. The identifier is the email address
 * `canonicalizeEmail` lowercases before it ever leaves the browser, and its
 * letter case makes no difference. The hint under the email field says so.
 *
 * Rendered with `renderToStaticMarkup` against the REAL English catalog, the
 * same pattern `credential-form-pre-hydration.test.ts` uses for this same
 * component: no DOM, no `I18nProvider`, `withI18n` supplies an i18next
 * instance loaded from `en/common.json` on disk.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { SignInPanel } from '../../app/components/sign-in-panel';
import enCommon from '../../app/i18n/locales/en/common.json';

const SYNC_SERVER_URL = 'https://sync.example.test';

const EMAIL_HINT_TEXT = enCommon.sync.signIn.emailHint;

/** The sign-in form as `/sign-in` server-renders it: no remembered address, no repair in flight. */
function renderSignInPanel(): string {
  return renderToStaticMarkup(
    withI18n(
      createElement(SignInPanel, {
        serverUrl: SYNC_SERVER_URL,
        initialEmail: '',
        onForgot: () => undefined,
      }),
    ),
  );
}

/** A literal string turned into a pattern that matches it, not a language. */
function escapeForPattern(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every `<input …>` opening tag in a blob of markup. */
function inputTags(markup: string): string[] {
  return markup.match(/<input[^>]*>/g) ?? [];
}

/** The one `<input>` of the given `type`, or throws, since there is exactly one of each on this form. */
function inputOfType(markup: string, type: string): string {
  const found = inputTags(markup).filter((tag) => tag.includes(`type="${type}"`));
  assert.equal(found.length, 1, `expected exactly one type="${type}" input, found ${found.length}`);
  const [tag] = found;
  if (tag === undefined) throw new Error(`no type="${type}" input in markup`);
  return tag;
}

/** The space-separated ids an element's `aria-describedby` names, or none. */
function describedByIds(tag: string): string[] {
  const match = tag.match(/\saria-describedby="([^"]*)"/);
  return match?.[1] === undefined ? [] : match[1].split(' ').filter(Boolean);
}

/** The `id` a `<p>…hint text…</p>` carries, read from the markup rather than assumed. */
function hintParagraphId(markup: string): string {
  const pattern = new RegExp(`<p id="([^"]+)"[^>]*>${escapeForPattern(EMAIL_HINT_TEXT)}</p>`);
  const match = markup.match(pattern);
  if (match?.[1] === undefined) throw new Error('no hint paragraph carrying the email hint text was found');
  return match[1];
}

describe('the sign-in form tells people the email address is the identifier', () => {
  it('renders the email hint text from the English catalog', () => {
    const markup = renderSignInPanel();
    assert.ok(markup.includes(EMAIL_HINT_TEXT), 'the email hint text is missing from the rendered form');
  });

  it("wires the hint into the email input's aria-describedby", () => {
    const markup = renderSignInPanel();
    const hintId = hintParagraphId(markup);
    const emailTag = inputOfType(markup, 'email');
    assert.ok(
      describedByIds(emailTag).includes(hintId),
      `the email input's aria-describedby does not name the hint: ${emailTag}`,
    );
  });

  // CONTROL. Both halves of this would pass just as readily if the hint had
  // never been rendered at all: an absent hint means zero `id="…"` matches for
  // `hintParagraphId` to find, which throws before either assertion runs, and
  // an unrelated aria-describedby trivially "does not contain" an id that
  // does not exist. Removing the `<p>` from `sign-in-panel.tsx` turns this
  // test red rather than green-by-vacuity.
  it('is a real hint, once, and only the email field claims it', () => {
    const markup = renderSignInPanel();
    const hintId = hintParagraphId(markup);

    const idAttributeOccurrences = markup.match(new RegExp(`id="${escapeForPattern(hintId)}"`, 'g')) ?? [];
    assert.equal(idAttributeOccurrences.length, 1, `the hint id should be defined exactly once: ${hintId}`);

    const passwordTag = inputOfType(markup, 'password');
    assert.ok(
      !describedByIds(passwordTag).includes(hintId),
      `the password input should not claim the email hint: ${passwordTag}`,
    );
  });
});
