/**
 * The offer lines under the sign-up form and the landing's button
 * (`app/components/plans/signup-offer.tsx`), rendered in each state.
 *
 * What is pinned: the price line exists only where the instance sells plans,
 * its box is drawn before the price arrives (both sentences in the markup,
 * neither visible), the price is formatted in the reader's language, and the
 * sentence without a price is the one shown when the read failed. The browser
 * tier measures the same box for movement (`signup-plan-intent.spec.ts`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { z } from 'zod';

import { SignupOffer, type SignupOfferProps } from '../../app/components/plans/signup-offer';

/** The keys this file reads, so a renamed key fails here on load. */
const offerCatalogSchema = z.looseObject({
  signupOffer: z.object({
    scans_other: z.string(),
    prices: z.string(),
    noPrices: z.string(),
    chosenYearly: z.string(),
    chosenMonthly: z.string(),
  }),
});

/** One shipped catalog, read from disk and checked for the keys above. */
function catalog(language: 'en' | 'fr') {
  const url = new URL(`../../app/i18n/locales/${language}/common.json`, import.meta.url);
  return offerCatalogSchema.parse(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')));
}

const EN = catalog('en');
const FR = catalog('fr');

/** Renders the offer in one language. */
function render(language: 'en' | 'fr', props: SignupOfferProps): string {
  const i18n = createInstance();
  void i18n.init({
    lng: language,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common'],
    resources: { en: { common: EN }, fr: { common: FR } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(SignupOffer, props)));
}

/** Figures that are nobody's price. */
const PRICES = { currency: 'EUR', monthlyCents: 321, yearlyCents: 2345 } as const;

/** The markup of one `data-slot`, from its opening tag to the end of the element's text. */
function slot(html: string, name: string): string | null {
  const match = new RegExp(`<[a-z]+ [^>]*data-slot="${name}"[^>]*>[^<]*`).exec(html);
  return match === null ? null : match[0];
}

/** Whether the element carrying this `data-slot` is drawn invisible. */
function isInvisible(html: string, name: string): boolean {
  const element = slot(html, name);
  assert.ok(element !== null, `no ${name} in the markup`);
  return /class="[^"]*\binvisible\b/.test(element);
}

describe('the offer lines', () => {
  it('count the free scans from the prop, never from a string', () => {
    const html = render('en', { trialScans: 7, prices: { kind: 'idle' }, chosenPlan: null, size: 'sm' });
    assert.ok(html.includes(EN.signupOffer.scans_other.replace('{{count}}', '7')), html);
    const other = render('en', { trialScans: 12, prices: { kind: 'idle' }, chosenPlan: null, size: 'sm' });
    assert.ok(other.includes(EN.signupOffer.scans_other.replace('{{count}}', '12')), other);
  });

  it('draw no price line and no chosen plan where the instance sells no plans', () => {
    const html = render('en', { trialScans: 10, prices: { kind: 'idle' }, chosenPlan: 'yearly', size: 'sm' });
    assert.equal(slot(html, 'signup-offer-price-line'), null);
    assert.equal(slot(html, 'signup-offer-chosen'), null);
  });

  it('hold the price line box while the read is in flight, with neither sentence shown', () => {
    const html = render('en', { trialScans: 10, prices: { kind: 'loading' }, chosenPlan: null, size: 'sm' });
    assert.ok(slot(html, 'signup-offer-price-line') !== null);
    assert.ok(isInvisible(html, 'signup-offer-no-prices'));
    assert.equal(slot(html, 'signup-offer-prices'), null);
  });

  it('state both prices, formatted in English', () => {
    const html = render('en', {
      trialScans: 10,
      prices: { kind: 'ready', prices: PRICES },
      chosenPlan: null,
      size: 'sm',
    });
    const line = slot(html, 'signup-offer-prices');
    assert.ok(line !== null, html);
    assert.ok(line.includes('€3.21') && line.includes('€23.45'), line);
    assert.ok(isInvisible(html, 'signup-offer-no-prices'));
  });

  it('state both prices, formatted in French, in the French sentence', () => {
    const html = render('fr', {
      trialScans: 10,
      prices: { kind: 'ready', prices: PRICES },
      chosenPlan: null,
      size: 'sm',
    });
    const line = slot(html, 'signup-offer-prices');
    assert.ok(line !== null, html);
    // A decimal comma, and the euro sign after the figure: the English form
    // "€3.21" would fail both halves.
    assert.match(line, /3,21\s€/u);
    assert.match(line, /23,45\s€/u);
    assert.equal(line.includes('€3.21'), false);
  });

  it('say the sentence without a price when the read failed', () => {
    const html = render('en', { trialScans: 10, prices: { kind: 'unavailable' }, chosenPlan: null, size: 'sm' });
    assert.equal(isInvisible(html, 'signup-offer-no-prices'), false);
    assert.ok((slot(html, 'signup-offer-no-prices') ?? '').includes(EN.signupOffer.noPrices));
    assert.equal(slot(html, 'signup-offer-prices'), null);
  });

  it('name the chosen plan, and only that one', () => {
    const html = render('en', { trialScans: 10, prices: { kind: 'loading' }, chosenPlan: 'yearly', size: 'sm' });
    assert.ok((slot(html, 'signup-offer-chosen') ?? '').includes(EN.signupOffer.chosenYearly));
    assert.equal(html.includes(EN.signupOffer.chosenMonthly), false);
  });
});
