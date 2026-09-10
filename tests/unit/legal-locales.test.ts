/**
 * The `legal` namespace: parity, structure, and the German render (M167/02).
 *
 * The English copy is asserted by `legal-pages.test.ts`. This file asserts the
 * things that only become possible once the pages are translated, and every one
 * of them is a failure that renders a plausible-looking page:
 *
 *  - a key present in English and missing in German (a silent partial
 *    translation inside a legally operative document);
 *  - a `<b>`/`<imprint>`/`<email>` tag or a `{{days}}` placeholder lost in
 *    translation, which drops a link or prints a literal `{{days}}`;
 *  - the operator's identity drifting between languages.
 *
 * The last one is structural rather than textual: `OPERATOR` is a constants
 * module and is deliberately NOT in either bundle, so the two renders cannot
 * disagree. The test below pins that arrangement, because moving those values
 * into the bundles is exactly the "helpful" refactor that would break it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { z } from 'zod';

import i18n from '../../app/i18n/i18n';
import enLegal from '../../app/i18n/locales/en/legal.json';
import deLegal from '../../app/i18n/locales/de/legal.json';
import deCommon from '../../app/i18n/locales/de/common.json';
import { OPERATOR } from '../../app/routes/legal/operator';
import { LEGAL_LAST_UPDATED, formatLegalDate } from '../../app/routes/legal/last-updated';
import { PrivacyContent } from '../../app/routes/legal/privacy';
import { TermsContent } from '../../app/routes/legal/terms';
import { ImprintContent } from '../../app/routes/legal/imprint';
import { formatPlanPrice } from '../../app/lib/plans/plan-price.server';

/**
 * A translation catalog: nested groups of keys bottoming out in strings.
 *
 * Parsed with zod rather than narrowed with `typeof`, matching
 * `i18n-key-parity.test.ts` — a stray non-string leaf then fails loudly here
 * instead of being silently skipped by a shape check.
 */
type Catalog = { [key: string]: string | Catalog };

const catalogSchema: z.ZodType<Catalog> = z.lazy(() =>
  z.record(z.string(), z.union([z.string(), catalogSchema])),
);

const leafSchema = z.string();

/**
 * A catalog reduced to key paths, e.g. `privacy.s9Item1`.
 *
 * A named contract rather than a bare `Record<string, string>`: the two bundles
 * are compared against each other, so what matters is that both sides are the
 * same KIND of thing, and naming it says so.
 */
interface FlatBundle {
  [path: string]: string;
}

function flatten(catalog: Catalog, prefix = ''): FlatBundle {
  const out: FlatBundle = {};
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const leaf = leafSchema.safeParse(value);
    if (leaf.success) out[path] = leaf.data;
    else Object.assign(out, flatten(catalogSchema.parse(value), path));
  }
  return out;
}

/** Every `{{name}}` and every `<tag>` a string carries, sorted. */
function tokensOf(value: string): string[] {
  return [
    ...[...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => `{{${m[1]}}}`),
    ...[...value.matchAll(/<\/?([a-z]+)>/g)].map((m) => `<${m[1]}>`),
  ].toSorted();
}

const EN = flatten(catalogSchema.parse(enLegal));
const DE = flatten(catalogSchema.parse(deLegal));

/** Renders a legal component under one language, with no data router. */
function render(node: React.ReactElement, language: 'en' | 'de'): string {
  const instance = i18n.cloneInstance({ lng: language });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n: instance }, node));
}

/**
 * Markup, or a bundle string, reduced to plain text.
 *
 * `<b>` and `<imprint>` become a `<strong>` and an `<a>` on the way through
 * `Trans`, so both sides are stripped of markup before they are compared.
 */
function plainText(value: string): string {
  return value
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/**
 * Asserts that the claim a bundle key makes is, or is not, in a render.
 *
 * WORDSMITH OWNS THE GERMAN and rephrases it whenever the copy goes through
 * it again. So the claim is read out of the SHIPPED bundle rather than typed
 * here: this cannot go stale on a rephrase, and it still fails on the defect
 * it guards, which is a level that stops making its own claim. An options
 * object because `key` and the message would otherwise be two strings in a
 * row, and swapping them compiles.
 */
function assertClaim({
  html,
  bundle,
  key,
  present,
  because,
}: {
  html: string;
  bundle: FlatBundle;
  key: string;
  present: boolean;
  because: string;
}): void {
  const claim = bundle[key];
  assert.ok(claim !== undefined, `${key} is missing from the bundle`);
  assert.equal(plainText(html).includes(plainText(claim)), present, `${key}: ${because}`);
}

describe('legal namespace — parity', () => {
  it('has the same keys in both languages, checked both ways', () => {
    // Both directions. A one-directional check passes when one bundle is a
    // strict superset, which is precisely the partial-translation case.
    assert.deepEqual(Object.keys(DE).toSorted(), Object.keys(EN).toSorted());
  });

  it('has no empty German value', () => {
    const empty = Object.entries(DE).filter(([, value]) => value.trim() === '');
    assert.deepEqual(empty, []);
  });

  it('keeps every placeholder and every markup tag', () => {
    for (const key of Object.keys(EN)) {
      assert.deepEqual(tokensOf(DE[key]), tokensOf(EN[key]), `tokens drifted in ${key}`);
    }
  });

  it('does not leave a German entry identical to its English source', () => {
    // Catches a key pasted across to make parity pass and never translated.
    // The allowlist is words that really are the same in both languages.
    const same = Object.keys(EN).filter((key) => EN[key] === DE[key]);
    assert.deepEqual(same.toSorted(), ['privacy.s9Heading']);
  });
});

describe('legal namespace — the UI bundle stays free of legal prose', () => {
  it('shares no string with common.json', () => {
    // `common` is loaded on EVERY page, including offline. ~600 lines of policy
    // text in two languages has no business in it.
    //
    // Deliberately a comparison of VALUES, not a keyword grep: `common` legitimately
    // contains the word "Impressum" (a footer link) and "Datenschutzerklärung" (a
    // newsletter consent line), and a grep for those fails against correct code.
    // What must not appear is a SENTENCE from the legal documents.
    // Only PROSE. A short overlap is a label, not a leak: `chrome.imprint` in
    // the footer is the word "Impressum", which is also the page's title, and
    // both are correct. 40 characters is comfortably longer than any nav label
    // and far shorter than any sentence in these documents.
    const PROSE = 40;
    const common = flatten(catalogSchema.parse(deCommon));
    const legalProse = new Set(Object.values(DE).filter((value) => value.length >= PROSE));
    const leaked = Object.entries(common).filter(([, value]) => legalProse.has(value));
    assert.deepEqual(leaked, []);
  });

  it('keeps the long prose out: no common.json entry is a legal-length paragraph', () => {
    // A cheap smell test for the same mistake made a different way — pasting
    // policy text into `common` under a new key rather than an identical one.
    const common = flatten(catalogSchema.parse(deCommon));
    const longest = Math.max(...Object.values(common).map((value) => value.length));
    const legalLongest = Math.max(...Object.values(DE).map((value) => value.length));
    assert.ok(
      longest < legalLongest,
      `common.json has a ${longest}-char entry; the longest legal string is ${legalLongest}`,
    );
  });
});

describe('legal namespace — the operator identity cannot drift', () => {
  it('is not in either bundle: there is only one copy of it', () => {
    const haystack = JSON.stringify(enLegal) + JSON.stringify(deLegal);
    for (const value of [OPERATOR.legalName, OPERATOR.street, OPERATOR.registerNumber, OPERATOR.vatId]) {
      assert.equal(haystack.includes(value), false, `${value} must live in operator.ts, not in a locale bundle`);
    }
  });

  it('renders byte-identically in the German and English imprints', () => {
    const en = render(createElement(ImprintContent), 'en');
    const de = render(createElement(ImprintContent), 'de');
    for (const value of [
      OPERATOR.legalName,
      OPERATOR.street,
      OPERATOR.city,
      OPERATOR.managingDirector,
      OPERATOR.registerNumber,
      OPERATOR.registerCourt,
      OPERATOR.vatId,
    ]) {
      assert.ok(en.includes(value), `English imprint lost ${value}`);
      assert.ok(de.includes(value), `German imprint lost ${value}`);
    }
    // The street number is the one a well-meaning reader "fixes".
    assert.match(de, /Straße 73 49/);
  });
});

describe('legal pages — the German render', () => {
  it('renders German prose, not an English page with a German heading', () => {
    const de = render(createElement(ImprintContent), 'de');
    assert.match(de, /Impressum/);
    assert.match(de, /Digitale-Dienste-Gesetz/);
    assert.doesNotMatch(de, /Information required under Section 5/);
  });

  it('uses the German date format for the same underlying date', () => {
    // READ FROM THE CONSTANT, NOT TYPED. The date is bumped on every material
    // change to these documents, and a literal here made that bump a failing
    // test in a file that has nothing to do with the change. What must hold is
    // that ONE date renders in TWO formats, which is what is asserted.
    const de = formatLegalDate(LEGAL_LAST_UPDATED, 'de');
    const en = formatLegalDate(LEGAL_LAST_UPDATED, 'en');
    assert.notEqual(de, en, 'the two languages stopped formatting the date differently');
    assert.ok(render(createElement(TermsContent), 'de').includes(de));
    assert.ok(render(createElement(TermsContent), 'en').includes(en));
    // The control on the formatter itself: German really is the day-first
    // form, so the two strings above are not both English.
    assert.match(de, /^\d{1,2}\. \w+ \d{4}$/);
  });

  it('keeps the links working in German', () => {
    const de = render(createElement(TermsContent), 'de');
    assert.match(de, /href="\/imprint"/);
    assert.match(de, /href="\/privacy"/);
    assert.match(de, new RegExp(`href="mailto:${OPERATOR.privacyEmail}"`));
  });

  it('substitutes the retention constant in German instead of printing the placeholder', () => {
    const de = render(createElement(PrivacyContent, {}), 'de');
    assert.doesNotMatch(de, /\{\{days\}\}/);
  });

  it('honours the analytics switch in German too', () => {
    const off = render(createElement(PrivacyContent, {}), 'de');
    const on = render(createElement(PrivacyContent, { analyticsLevel: 'product' }), 'de');
    // NOT a bare /Matomo/ check on the off branch: both branches name Matomo,
    // because both tell a self-hoster what the default is. What distinguishes
    // them is whether the full Article 13 disclosure is made — the legal basis,
    // the retention window and the right to object.
    //
    // STRUCTURAL, not textual: the two branches are different documents, and
    // each paragraph of the disclosure is present in exactly one of them. The
    // paragraphs are read out of the German bundle, so wordsmith may rewrite
    // any of them without breaking this.
    assert.notEqual(off, on, 'the German policy stopped varying with the analytics switch');
    assertClaim({ html: off, bundle: DE, key: 'privacy.s9aOffBody1', present: true, because: 'the off branch must say nothing is measured' });
    for (const key of [
      'privacy.s9aOnBody1',
      'privacy.s9aOnBody2',
      'privacy.s9aOnBody3',
      'privacy.s9aOnBody4',
      'privacy.s9aOnBody5',
    ]) {
      assertClaim({ html: on, bundle: DE, key, present: true, because: 'the disclosure lost a paragraph' });
      assertClaim({ html: off, bundle: DE, key, present: false, because: 'the off branch discloses measurement it does not do' });
    }
    // A CITATION, not prose: correct German cites this as
    // "Art. 6 Abs. 1 lit. f DSGVO", which is what a German lawyer expects, and
    // it is not wordsmith's to rephrase.
    assert.match(on, /Art\. 6 Abs\. 1 lit\. f DSGVO/);
  });

  it('says DSGVO, not GDPR: a German policy naming the English regulation reads as a translation', () => {
    const on = render(createElement(PrivacyContent, { analyticsLevel: 'product' }), 'de');
    assert.doesNotMatch(on, /GDPR/);
  });

  it('varies section 9a by level in German, not only by on and off', () => {
    // The German bundle carries its own four claims. A missing one would render
    // the English fallback inside a German policy, which reads as a page that
    // was half translated and is a false disclosure in the language the reader
    // is actually being addressed in.
    const pageviews = render(createElement(PrivacyContent, { analyticsLevel: 'pageviews' }), 'de');
    const product = render(createElement(PrivacyContent, { analyticsLevel: 'product' }), 'de');
    const research = render(createElement(PrivacyContent, { analyticsLevel: 'research' }), 'de');

    // THE GUARANTEE THE TEST IS NAMED FOR, and it is structural: three levels,
    // three DIFFERENT German documents. A level that stopped varying the page
    // fails here whatever words the page is written in.
    assert.notEqual(pageviews, product, 'pageviews and product render the same German policy');
    assert.notEqual(product, research, 'product and research render the same German policy');
    assert.notEqual(pageviews, research, 'pageviews and research render the same German policy');

    // And each level makes its OWN claim. The claims are read out of the
    // German bundle, never typed here: wordsmith owns this copy and rephrases
    // it, and a phrase pinned in this file breaks on a rewrite that means the
    // same thing.
    const byLevel = {
      pageviews: { html: pageviews, keys: ['privacy.s1Item4Pageviews', 'privacy.s9aPageviewsBody2'] },
      product: { html: product, keys: ['privacy.s1Item4Analytics', 'privacy.s9aOnBody2'] },
      research: { html: research, keys: ['privacy.s1Item4Research', 'privacy.s9aOnBody2', 'privacy.s9aResearchBody'] },
    };
    for (const [level, { html, keys }] of Object.entries(byLevel)) {
      for (const key of keys) {
        assertClaim({ html, bundle: DE, key, present: true, because: `${level} lost a claim it must make` });
      }
    }
    // The research paragraph belongs to the highest level ALONE: on the other
    // two it would disclose health-behaviour measurement that does not happen.
    for (const html of [pageviews, product]) {
      assertClaim({
        html,
        bundle: DE,
        key: 'privacy.s9aResearchBody',
        present: false,
        because: 'a level below research discloses research measurement',
      });
    }

    for (const html of [pageviews, product, research]) {
      assertClaim({ html, bundle: DE, key: 'privacy.s9aLevelBody', present: true, because: 'the level itself went undisclosed' });
      // English leaking through a missing German key is the failure this
      // guards, and the English is read out of its own bundle for the same
      // reason the German is.
      assertClaim({ html, bundle: EN, key: 'privacy.s9aLevelBody', present: false, because: 'the English fallback rendered inside a German policy' });
    }
  });
});

/**
 * Section 4a's two figures, in German (M214 spec 02).
 *
 * `price` and `trialDays` reach `TermsContent` from the route's server loader,
 * which reads them from this deployment's environment and formats the price
 * for the request's language. Two things can go wrong in the German document
 * and nowhere else, so both are asserted here rather than in
 * `legal-pages.test.ts`:
 *
 *  - the figure never arrives, and the sentence prints a literal `{{price}}`;
 *  - the price is written in the English form inside a German contract, which
 *    the Preisangabenverordnung expects to be readable as one total price.
 *
 * The claim is read out of the SHIPPED bundle and interpolated here, for the
 * reason `assertClaim` gives: wordsmith owns the German and rephrases it.
 *
 * The figure below is not a price anybody charges. The real one lives in the
 * operator's environment (`PLAN_PRICE_EUR`), and this repository may not
 * invent one.
 */
describe('legal pages: section 4a carries the figures it is given', () => {
  const SAMPLE_PRICE_EUR = 12.34;
  const SAMPLE_TRIAL_DAYS = 3;

  /**
   * A bundle string with its one placeholder filled in, reduced to plain text.
   *
   * An options object because `key`, `token` and `value` are three strings in
   * a row, and any two of them could be swapped and still compile. Same
   * reason `assertClaim` above takes one.
   */
  function interpolated({ key, token, value }: { key: string; token: string; value: string }): string {
    const claim = DE[key];
    assert.ok(claim !== undefined, `${key} is missing from the German bundle`);
    return plainText(claim.replace(`{{${token}}}`, value));
  }

  /** The part of a claim BEFORE its placeholder: present if and only if the sentence was drawn at all. */
  function leadingHalf({ key, token }: { key: string; token: string }): string {
    const claim = DE[key];
    assert.ok(claim !== undefined, `${key} is missing from the German bundle`);
    const [lead] = claim.split(`{{${token}}}`);
    assert.ok(lead !== undefined && lead.length > 0, `${key} no longer opens before its placeholder`);
    return plainText(lead);
  }

  function renderGermanTerms(price: string | null, trialDays: number | null): string {
    return plainText(render(createElement(TermsContent, { plans: true, price, trialDays }), 'de'));
  }

  it('states the price and the trial in German when the deployment supplies both', () => {
    const priceLabel = formatPlanPrice(SAMPLE_PRICE_EUR, 'de');
    const text = renderGermanTerms(priceLabel, SAMPLE_TRIAL_DAYS);

    assert.ok(text.includes(priceLabel), 'the formatted price never reached the page');
    assert.ok(
      text.includes(interpolated({ key: 'terms.s4aPaymentPrice', token: 'price', value: priceLabel })),
      'the price sentence did not render with the figure in it',
    );
    assert.ok(
      text.includes(
        interpolated({ key: 'terms.s4aPaymentTrial', token: 'trialDays', value: String(SAMPLE_TRIAL_DAYS) }),
      ),
      'the trial sentence did not render with the figure in it',
    );
    // A placeholder that survived to the page is the failure this whole block
    // exists for: it reads as a bug to every visitor, in a contract.
    assert.doesNotMatch(text, /\{\{price\}\}|\{\{trialDays\}\}/);
  });

  it('writes that price the German way, not the English way', () => {
    const german = formatPlanPrice(SAMPLE_PRICE_EUR, 'de');
    const english = formatPlanPrice(SAMPLE_PRICE_EUR, 'en');
    // THE CONTROL. Without it the assertion above passes on a formatter that
    // ignores its locale and prints the English form into a German contract.
    assert.notEqual(german, english);
    assert.ok(!renderGermanTerms(german, SAMPLE_TRIAL_DAYS).includes(english));
  });

  it('draws neither sentence when the deployment supplies neither figure', () => {
    const text = renderGermanTerms(null, null);
    assert.ok(
      !text.includes(leadingHalf({ key: 'terms.s4aPaymentPrice', token: 'price' })),
      'the price sentence was drawn empty',
    );
    assert.ok(
      !text.includes(leadingHalf({ key: 'terms.s4aPaymentTrial', token: 'trialDays' })),
      'the trial sentence was drawn empty',
    );
    // The rest of section 4a is unconditional, so this is a check that the two
    // sentences went missing and not the whole section.
    assertClaim({
      html: render(createElement(TermsContent, { plans: true }), 'de'),
      bundle: DE,
      key: 'terms.s4aPaymentRenewal',
      present: true,
      because: 'section 4a itself disappeared, which is not what a missing figure means',
    });
  });
});
