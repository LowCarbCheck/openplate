/**
 * THE DELETE DIALOG'S TWO NOTES (M3/01).
 *
 * The dialog said "Everything stored for you is removed". On a hosted instance that is false:
 * backups, mails already sent and records the operator must keep by law all outlive the click.
 * `DeleteAccountNotes` now says the kinds of record that can stay (never a number, because the
 * app is public and also self-hosted), links the privacy notice only where legal pages exist, and
 * says a paid subscription ends now only where the instance sells a plan.
 *
 * ── HOW IT RENDERS ───────────────────────────────────────────────────────
 *
 * The real component under a memory data router whose root route carries the loader data the
 * `useHasLegalPages` hook reads (the harness `about-legal-links.test.tsx` uses), with the shipped
 * English catalog. Nothing is mocked. The words are read from the catalog by key, so a rewording
 * by the wordsmith pass fails nowhere, and a renamed key fails here.
 *
 * ── EVERY ABSENCE HAS A PRESENCE BESIDE IT ───────────────────────────────
 *
 * "No subscription line" and "no privacy link" pass on a render that printed nothing, so each off
 * case also asserts the sentence that is always there, and the on cases are the controls for the
 * slots and the link text.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { DeleteAccountNotes } from '../../app/components/delete-account-notes';
import enCommon from '../../app/i18n/locales/en/common.json';
import { withI18n } from './trends-i18n-harness';

/** The notes, under a root route whose loader data says whether the mounted folder has legal pages. */
function renderNotes({ hasLegalPages, plansAvailable }: { hasLegalPages: boolean; plansAvailable: boolean }): string {
  const loaderData = { hasLegalPages };
  const router = createMemoryRouter(
    [
      {
        id: 'root',
        path: '/',
        loader: () => loaderData,
        children: [{ index: true, element: withI18n(createElement(DeleteAccountNotes, { plansAvailable })) }],
      },
    ],
    { initialEntries: ['/'], hydrationData: { loaderData: { root: loaderData } } },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

const DELETE = enCommon.account.delete;

/** The words inside the `<privacy>` tag of the catalog line, which is what the link must say. */
const PRIVACY_LINK_TEXT = /<privacy>(.*?)<\/privacy>/.exec(DELETE.staysWithNotice)?.[1] ?? '';

/** The plain text of a slot's paragraph, with markup removed. */
function slotText(markup: string, slot: string): string | null {
  const found = new RegExp(`<p data-slot="${slot}">([\\s\\S]*?)</p>`).exec(markup);
  if (found === null) return null;
  return (found[1] ?? '')
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/** The text of the anchor whose href is `/privacy`, or null when there is none. */
function privacyAnchorText(markup: string): string | null {
  const found = /<a\b[^>]*\bhref="\/privacy"[^>]*>([\s\S]*?)<\/a>/.exec(markup);
  if (found === null) return null;
  return (found[1] ?? '').replaceAll(/<[^>]*>/g, '').trim();
}

describe('the catalog lines', () => {
  it('control: the privacy link text is read from the catalog and is not empty', () => {
    assert.notEqual(PRIVACY_LINK_TEXT, '', 'the staysWithNotice line has no <privacy> run');
  });

  it('the old claim is gone from the confirm body', () => {
    assert.ok(!DELETE.confirmBody.includes('Everything stored for'), 'the dialog still says everything is removed');
    assert.ok(DELETE.confirmBody.includes('{{email}}'), 'the body no longer names the account');
  });

  it('the base lines hold no number, because the periods belong to the operator', () => {
    for (const line of [DELETE.confirmBody, DELETE.stays, DELETE.staysWithNotice]) {
      assert.doesNotMatch(line, /\d/, `a base line names a number: ${line}`);
    }
  });

  it('no line carries a dash', () => {
    for (const line of [DELETE.confirmBody, DELETE.stays, DELETE.staysWithNotice, DELETE.subscription]) {
      assert.doesNotMatch(line, /[\u2013\u2014]/, `a dash in: ${line}`);
    }
  });

  it('the line without a notice says the same thing as the one with it, minus the link sentence', () => {
    assert.equal(DELETE.staysWithNotice.startsWith(DELETE.stays), true);
  });
});

describe('an instance with legal pages and a plan door', () => {
  const markup = renderNotes({ hasLegalPages: true, plansAvailable: true });

  it('says that some records can stay, from the catalog', () => {
    assert.ok(slotText(markup, 'delete-account-stays')?.startsWith(DELETE.stays), 'the stays line is missing');
  });

  it('links the privacy notice, and the link says the words of the catalog', () => {
    assert.equal(privacyAnchorText(markup), PRIVACY_LINK_TEXT);
  });

  it('opens the notice in a new tab, so a typed password is not lost', () => {
    assert.match(markup, /<a\b[^>]*\bhref="\/privacy"[^>]*\btarget="_blank"/);
  });

  it('says that a paid subscription ends now', () => {
    assert.equal(slotText(markup, 'delete-account-subscription'), DELETE.subscription);
  });
});

describe('an instance with no legal pages', () => {
  const markup = renderNotes({ hasLegalPages: false, plansAvailable: true });

  it('still says that some records can stay, in the line that names no notice', () => {
    assert.equal(slotText(markup, 'delete-account-stays'), DELETE.stays);
  });

  it('draws no link and never mentions a privacy notice', () => {
    assert.equal(privacyAnchorText(markup), null);
    assert.ok(!markup.includes('<a '), 'an anchor was drawn');
    assert.ok(!markup.includes(PRIVACY_LINK_TEXT), 'the notice is named though no page holds it');
  });
});

describe('an instance that sells no plan', () => {
  const markup = renderNotes({ hasLegalPages: true, plansAvailable: false });

  it('draws no subscription line, while the stays line is still there', () => {
    assert.ok(slotText(markup, 'delete-account-stays') !== null, 'the stays line is missing');
    assert.equal(slotText(markup, 'delete-account-subscription'), null);
    assert.ok(!markup.includes(DELETE.subscription), 'the subscription sentence leaked');
  });
});
