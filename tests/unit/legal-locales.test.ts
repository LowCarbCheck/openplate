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
import { PrivacyContent } from '../../app/routes/legal/privacy';
import { TermsContent } from '../../app/routes/legal/terms';
import { ImprintContent } from '../../app/routes/legal/imprint';

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
    assert.match(render(createElement(TermsContent), 'de'), /1\. September 2026/);
    assert.match(render(createElement(TermsContent), 'en'), /September 1, 2026/);
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
    const on = render(createElement(PrivacyContent, { analyticsEnabled: true }), 'de');
    // NOT a bare /Matomo/ check on the off branch: both branches name Matomo,
    // because both tell a self-hoster what the default is. What distinguishes
    // them is whether the full Article 13 disclosure is made — the legal basis,
    // the retention window and the right to object.
    assert.match(off, /erfasst keinerlei/i);
    // Markers UNIQUE to the disclosure, and in the LANGUAGE being rendered.
    // Not /90 Tage/ — the photo cache is 90 days too, so that matched the off
    // branch. Not /Matomo/ — both branches name it, in both languages. And not
    // the English citation form: correct German cites this as
    // "Art. 6 Abs. 1 lit. f DSGVO", which is what a German lawyer expects.
    assert.doesNotMatch(off, /Rechtsgrundlage/);
    assert.doesNotMatch(off, /Do Not Track/);
    assert.match(on, /Rechtsgrundlage/);
    assert.match(on, /Art\. 6 Abs\. 1 lit\. f DSGVO/);
    assert.match(on, /Do Not Track/);
  });

  it('says DSGVO, not GDPR: a German policy naming the English regulation reads as a translation', () => {
    const on = render(createElement(PrivacyContent, { analyticsEnabled: true }), 'de');
    assert.doesNotMatch(on, /GDPR/);
  });
});
