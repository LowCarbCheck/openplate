/**
 * THE PAYMENT SECTIONS OF THE TWO LEGAL DOCUMENTS (M213 spec 07).
 *
 * ── The failure this file exists for ─────────────────────────────────────
 *
 * These two sections state that a subscription exists, that it renews, that a
 * card is taken, that a named processor receives an email address and an
 * amount, and that an invoice outlives an erased account by ten years. Every
 * one of those sentences is FALSE on a deployment with no biller behind it,
 * and it is false in the direction that matters in a document the operator is
 * legally answerable for: a self-hoster's privacy policy would disclose a
 * recipient of personal data that does not exist.
 *
 * So the gate is asserted in both directions, on the RENDER, and the claims
 * are read out of the shipped bundles rather than typed here, because
 * wordsmith owns the wording and rephrases it. This test must fail on a
 * section that appears where it should not, never on a better sentence.
 *
 * ── And the two figures nobody here may invent ───────────────────────────
 *
 * `{{price}}` and `{{trialDays}}` are the owner's, and neither is on the wire
 * today. The two sentences that carry them are drawn only when a value
 * exists, so the alternative failure, a terms page reading "openplate Plus
 * costs per month", is what the last two cases below rule out.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';

import i18n from '../../app/i18n/i18n';
import enLegal from '../../app/i18n/locales/en/legal.json';
import deLegal from '../../app/i18n/locales/de/legal.json';
import { OPERATOR } from '../../app/routes/legal/operator';
import { PrivacyContent, type PrivacyContentProps } from '../../app/routes/legal/privacy';
import { TermsContent, type TermsContentProps } from '../../app/routes/legal/terms';

function renderTerms(props: TermsContentProps, language: 'en' | 'de' = 'en'): string {
  const instance = i18n.cloneInstance({ lng: language });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n: instance }, createElement(TermsContent, props)));
}

function renderPrivacy(props: PrivacyContentProps, language: 'en' | 'de' = 'en'): string {
  const instance = i18n.cloneInstance({ lng: language });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n: instance }, createElement(PrivacyContent, props)));
}

/** Markup reduced to plain text, so a `<Trans>` split across tags compares against its bundle string. */
function plainText(value: string): string {
  return value
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

describe('the terms payment section', () => {
  it('appears on an instance with a biller and NOT on one without', () => {
    const withPlans = plainText(renderTerms({ plans: true }));
    const withoutPlans = plainText(renderTerms({ plans: false }));
    assert.ok(withPlans.includes(plainText(enLegal.terms.s4aPaymentHeading)));
    // THE CONTROL, and the whole point of the file: the same document with one
    // fact changed says nothing about a subscription at all.
    assert.equal(withoutPlans.includes(plainText(enLegal.terms.s4aPaymentHeading)), false);
    assert.equal(withoutPlans.includes(plainText(enLegal.terms.s4aPaymentProcessor)), false);
  });

  it('states the renewal, the failed payment and the withdrawal right, all four in German too', () => {
    const en = plainText(renderTerms({ plans: true }));
    const de = plainText(renderTerms({ plans: true }, 'de'));
    for (const key of ['s4aPaymentRenewal', 's4aPaymentFailed', 's4aPaymentWithdrawalLoss', 's4aPaymentProcessor'] as const) {
      assert.ok(en.includes(plainText(enLegal.terms[key])), `English lost ${key}`);
      assert.ok(de.includes(plainText(deLegal.terms[key])), `German lost ${key}`);
    }
  });

  it('turns the two tags into real links, to the withdrawal page and to the imprint', () => {
    const markup = renderTerms({ plans: true });
    assert.match(markup, /href="\/withdrawal"/);
    assert.match(markup, /href="\/imprint"/);
    // THE CONTROL: neither link is in the document when the section is not.
    assert.doesNotMatch(renderTerms({ plans: false }), /href="\/withdrawal"/);
  });

  it('takes the seller and the VAT number from operator.ts, in both languages', () => {
    // `legal-locales.test.ts` pins that those values are NOT in either bundle.
    // This is the other half: the section that names them really renders them.
    for (const language of ['en', 'de'] as const) {
      const markup = renderTerms({ plans: true }, language);
      assert.ok(markup.includes(OPERATOR.legalName), `${language} lost the seller`);
      assert.ok(markup.includes(OPERATOR.vatId), `${language} lost the VAT identification number`);
    }
  });

  it('prints no price and no trial length until somebody supplies one', () => {
    const markup = plainText(renderTerms({ plans: true }));
    // Neither figure is on the wire, so neither sentence is drawn. What must
    // never happen is the sentence WITH the placeholder gone: a price line
    // reading "costs  per month" is worse than no price line.
    assert.equal(markup.includes(plainText(enLegal.terms.s4aPaymentPrice.split('{{price}}')[0] ?? '')), false);
    assert.doesNotMatch(markup, /\{\{price\}\}/);
    assert.doesNotMatch(markup, /\{\{trialDays\}\}/);
  });

  it('does print them once a value exists, so the sentences are wired and not dead', () => {
    // THE CONTROL for the case above, and the check that the two paragraphs
    // are reachable at all: a gate that never opened would pass everything
    // above while shipping a section nobody can ever see.
    const markup = plainText(renderTerms({ plans: true, price: '4,99 EUR', trialDays: 3 }));
    assert.ok(markup.includes('4,99 EUR'));
    assert.match(markup, /\b3\b/);
    assert.doesNotMatch(markup, /\{\{/);
  });
});

describe('the privacy payment section', () => {
  it('appears on an instance with a biller and NOT on one without', () => {
    const withPlans = plainText(renderPrivacy({ plans: true }));
    const withoutPlans = plainText(renderPrivacy({ plans: false }));
    assert.ok(withPlans.includes(plainText(enLegal.privacy.s7aPaymentHeading)));
    assert.equal(withoutPlans.includes(plainText(enLegal.privacy.s7aPaymentHeading)), false);
    // The processor disclosure is the sentence that must not appear where
    // nothing is processed.
    assert.equal(withoutPlans.includes(plainText(enLegal.privacy.s7aPaymentBody1)), false);
  });

  it('states all four paragraphs, in both languages', () => {
    const en = plainText(renderPrivacy({ plans: true }));
    const de = plainText(renderPrivacy({ plans: true }, 'de'));
    for (const key of ['s7aPaymentBody1', 's7aPaymentBody2', 's7aPaymentBody3', 's7aPaymentBody4'] as const) {
      assert.ok(en.includes(plainText(enLegal.privacy[key])), `English lost ${key}`);
      assert.ok(de.includes(plainText(deLegal.privacy[key])), `German lost ${key}`);
    }
  });

  it('states the retention that outlives an erased account, and says which law requires it', () => {
    // Spec 07 item 8: the ten years is the reason an invoice survives a DSAR
    // erasure, and the document has to say so rather than assert a period.
    const en = plainText(renderPrivacy({ plans: true }));
    assert.match(en, /\bten years\b/i);
    assert.match(en, /147/);
    assert.match(en, /14b/);
    // THE CONTROL: none of that is in the document without a biller.
    assert.doesNotMatch(plainText(renderPrivacy({ plans: false })), /\bten years\b/i);
  });
});
