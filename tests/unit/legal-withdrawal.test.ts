/**
 * `/withdrawal`: the statutory withdrawal instruction and model form (M214/07).
 *
 * == WHY THIS FILE PINS EXACT WORDING, WHERE THE OTHER LEGAL TESTS DO NOT ==
 * `legal-locales.test.ts` reads its German claims out of the shipped bundle,
 * because wordsmith owns that copy and rephrases it. This document is the
 * opposite case: the German is Anlage 1 and Anlage 2 zu Artikel 246a § 1
 * Absatz 2 EGBGB, a MODEL TEXT. A trader who follows the model is protected
 * (Artikel 246a § 1 Absatz 2 Satz 2 EGBGB); a trader who paraphrases it is not,
 * and the paraphrase is invisible in review. So the three sentences that carry
 * the whole legal effect are typed here byte-for-byte, and each one has a
 * control: a deliberately altered twin that must NOT be found, so the assertion
 * fails if `includes` were ever satisfied by something else.
 *
 * The ENGLISH is a courtesy translation and is checked for STRUCTURE only, never
 * for wording: it goes through wordsmith and may be rewritten at any time.
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
import { WithdrawalContent } from '../../app/routes/legal/withdrawal';

function render(language: 'en' | 'de'): string {
  const instance = i18n.cloneInstance({ lng: language });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n: instance }, createElement(WithdrawalContent)));
}

/** Markup reduced to plain text, so an entity or a tag boundary cannot hide a sentence. */
function plainText(markup: string): string {
  return markup
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll(/\s+/g, ' ');
}

/** Anlage 1, Widerrufsrecht, sentence 1. Unconditional in the model. */
const RIGHT_SENTENCE = 'Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.';

/** Anlage 1, sentence 2 with Gestaltungshinweis 1 variant a) applied (service contract). */
const PERIOD_SENTENCE = 'Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.';

/** Anlage 1, Gestaltungshinweis 6, with the water/gas/electricity/heat alternative struck. */
const VALUE_SENTENCE =
  'Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen sollen, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.';

/**
 * Each statutory sentence beside a plausible corruption of it.
 *
 * THE CONTROL IS THE POINT. "binnen vierzehn Tagen" shortened to seven days, a
 * period counted from delivery rather than from conclusion, and a pro-rata
 * clause turned into a refusal to refund are all sentences a well-meaning
 * editor could produce, and all three are legally wrong. The altered twin must
 * be absent, which is what makes the positive assertion above it mean anything.
 */
const STATUTORY: { name: string; sentence: string; corrupted: string }[] = [
  {
    name: 'the right itself',
    sentence: RIGHT_SENTENCE,
    corrupted: 'Sie haben das Recht, binnen sieben Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.',
  },
  {
    name: 'the period, counted from the conclusion of the contract',
    sentence: PERIOD_SENTENCE,
    corrupted: 'Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag der Lieferung.',
  },
  {
    name: 'the pro-rata payment for a service already begun',
    sentence: VALUE_SENTENCE,
    corrupted: 'Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen sollen, so ist eine Rückzahlung ausgeschlossen.',
  },
];

/** Anlage 2: seven fields, in the statute's order. */
const FORM_FIELD_KEYS = [
  'formField1',
  'formField2',
  'formField3',
  'formField4',
  'formField5',
  'formField6',
  'formField7',
] as const;

describe('/withdrawal, the German model text', () => {
  for (const { name, sentence, corrupted } of STATUTORY) {
    it(`reproduces ${name} byte for byte`, () => {
      const text = plainText(render('de'));
      assert.ok(text.includes(sentence), `the model sentence is missing or paraphrased: ${name}`);
      // THE CONTROL. Nothing about the assertion above proves the page says the
      // right thing unless a wrong version of the same sentence would fail.
      assert.equal(text.includes(corrupted), false, `a corrupted variant of ${name} is on the page`);
    });
  }

  it('does not carry the struck Wasser/Gas/Strom/Fernwärme alternative', () => {
    // Gestaltungshinweis 6 says "[Unzutreffendes streichen]". A page that keeps
    // the whole bracket tells a food-tracker subscriber about district heating.
    const text = plainText(render('de'));
    assert.equal(text.includes('Wasser/Gas/Strom/Fernwärme'), false);
    assert.equal(text.includes('Unzutreffendes streichen'), true, 'the form footnote (*) is part of Anlage 2 and must stay');
  });

  it('keeps the delivery-cost parenthesis of the Folgen des Widerrufs paragraph', () => {
    // It is part of the model text. Trimming it is the single most common
    // "tidy-up" of this paragraph, and it narrows what we promise to refund.
    const text = plainText(render('de'));
    assert.ok(text.includes('einschließlich der Lieferkosten'));
    assert.ok(text.includes('günstigste Standardlieferung gewählt haben)'));
  });

  it('inserts no online withdrawal function, which is an unanswered owner question', () => {
    // Gestaltungshinweis 3. Announcing a button that does not exist is worse
    // than not offering one, so the paragraph is absent until the owner decides.
    const text = plainText(render('de'));
    assert.equal(text.includes('Sie können Ihr Widerrufsrecht auch online'), false);
  });
});

describe('/withdrawal, the operator is named from operator.ts', () => {
  it('renders the legal name, the street and the e-mail exactly as the constants module holds them', () => {
    for (const language of ['de', 'en'] as const) {
      const text = plainText(render(language));
      for (const value of [OPERATOR.legalName, OPERATOR.street, OPERATOR.imprintEmail]) {
        assert.ok(text.includes(value), `the ${language} page lost ${value}`);
      }
      // The control on the pair above: the identity is NOT read off a
      // translation bundle, so a value the bundles never carried is absent.
      assert.equal(text.includes('SPARQ VENTURES GmbH'), false, 'a legal name nobody holds rendered');
    }
  });

  it('holds none of those identifiers in either locale bundle', () => {
    const haystack = JSON.stringify(enLegal.withdrawal) + JSON.stringify(deLegal.withdrawal);
    for (const value of [OPERATOR.legalName, OPERATOR.street, OPERATOR.imprintEmail]) {
      assert.equal(haystack.includes(value), false, `${value} must live in operator.ts, not in a locale bundle`);
    }
  });

  it('prints no empty gap where the missing telephone number belongs', () => {
    // `OPERATOR.phone` is absent today (Gestaltungshinweis 2 requires one, and
    // nothing here may invent it). What must not happen is a dangling ", ,".
    const text = plainText(render('de'));
    assert.equal(text.includes(', ,'), false);
    // The control: the run of details really is being assembled, so the pieces
    // around the hole are adjacent.
    assert.ok(text.includes(`${OPERATOR.country}, ${OPERATOR.imprintEmail}`));
  });
});

describe('/withdrawal, the model form', () => {
  it('renders all seven fields of Anlage 2, one list item each, in both languages', () => {
    for (const language of ['de', 'en'] as const) {
      const markup = render(language);
      const items = [...markup.matchAll(/<li>/g)].length;
      assert.equal(items, FORM_FIELD_KEYS.length, `${language} renders ${items} form fields, not seven`);
    }
  });

  it('draws each field from its own bundle key rather than repeating one', () => {
    const bundle = deLegal.withdrawal;
    const text = plainText(render('de'));
    const values = FORM_FIELD_KEYS.map((key) => bundle[key]);
    // Distinct keys, distinct sentences: a copy-paste that pointed two list
    // items at one key would render six different fields, not seven.
    assert.equal(new Set(values).size, FORM_FIELD_KEYS.length);
    for (const key of FORM_FIELD_KEYS) {
      // `formField1` carries the operator run through a placeholder, so only
      // its literal prefix can be compared.
      const claim = key === 'formField1' ? 'An ' : bundle[key];
      assert.ok(text.includes(claim), `the German form lost ${key}`);
    }
    // The control on the loop: a field the statute does not have is not there.
    assert.equal(text.includes('Bankverbindung des/der Verbraucher(s)'), false);
  });

  it('keeps the "(Wenn Sie den Vertrag widerrufen wollen ...)" line and the (*) footnote', () => {
    const text = plainText(render('de'));
    assert.ok(text.includes('Wenn Sie den Vertrag widerrufen wollen'));
    assert.ok(text.includes('(*) Unzutreffendes streichen.'));
  });
});

describe('/withdrawal, the English page is a translation, not the binding text', () => {
  it('says so, and says it in German too', () => {
    // STRUCTURE, NOT WORDING. The English is wordsmith's; what is pinned is
    // that the notice is drawn at all, read out of each shipped bundle.
    for (const [language, bundle] of [
      ['en', enLegal],
      ['de', deLegal],
    ] as const) {
      const text = plainText(render(language));
      assert.ok(text.includes(bundle.withdrawal.bindingNotice), `${language} lost the binding-version notice`);
    }
  });

  it('renders a different document in each language', () => {
    // The control that the English page is really translated: a missing German
    // key would fall back to English and make these two identical.
    assert.notEqual(render('en'), render('de'));
  });

  it('renders no German model sentence inside the English page', () => {
    const text = plainText(render('en'));
    for (const { sentence } of STATUTORY) {
      assert.equal(text.includes(sentence), false, 'German model text leaked into the English translation');
    }
  });
});

describe('/withdrawal, no dash of either kind reaches the copy', () => {
  it('has none in either locale, in the bundle or in the render', () => {
    // WRITTEN AS ESCAPES. A literal en or em dash in this file would be
    // caught by the repository-wide dash sweep over exactly these files.
    const EN_DASH = '\u2013';
    const EM_DASH = '\u2014';
    const DASHES = /[\u2013\u2014]/;
    for (const [language, bundle] of [
      ['en', enLegal],
      ['de', deLegal],
    ] as const) {
      assert.equal(DASHES.test(JSON.stringify(bundle.withdrawal)), false, `${language} bundle carries a dash`);
      assert.equal(DASHES.test(render(language)), false, `the ${language} render carries a dash`);
    }
    // The control on the matcher: it really does find the dashes it bans.
    assert.equal(DASHES.test(`an ${EN_DASH} en dash`), true);
    assert.equal(DASHES.test(`an ${EM_DASH} em dash`), true);
  });
});
