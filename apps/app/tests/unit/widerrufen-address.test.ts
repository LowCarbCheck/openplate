/**
 * The printed address of the withdrawal function, found inside a served
 * sentence (`app/lib/plans/widerrufen-address.ts`, M265 spec 05).
 *
 * The sentences here are fixtures in the forms the live notices take: the
 * address before a full stop, before a word, and at the very end. No live
 * notice is transcribed, because the notice is the biller's to change.
 *
 * Every claim that a sentence is linked has a control that is not: a sentence
 * with no address, and addresses that only look like the page's.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { WIDERRUFEN_PATH, splitAtWiderrufenAddress } from '../../app/lib/plans/widerrufen-address';

/** The three parts, or a failure that names the sentence. */
function split(text: string): { before: string; address: string; after: string } {
  const parts = splitAtWiderrufenAddress(text);
  assert.ok(parts !== null, `no address found in: ${text}`);
  return parts;
}

describe('the printed address of the withdrawal function', () => {
  it('is found before a full stop, and the full stop stays with the sentence', () => {
    const text = 'Declare it online at https://app.openplate.de/widerrufen. The form is on the page:';
    assert.deepEqual(split(text), {
      before: 'Declare it online at ',
      address: 'https://app.openplate.de/widerrufen',
      after: '. The form is on the page:',
    });
  });

  it('is found before a word, and at the very end of a sentence', () => {
    assert.equal(split('Online unter https://app.openplate.de/widerrufen erklären.').address, 'https://app.openplate.de/widerrufen');
    assert.equal(split('Çevrim içi olarak https://app.openplate.de/widerrufen adresindeki sayfa').after, ' adresindeki sayfa');
    assert.equal(split('Go to https://app.openplate.de/widerrufen').after, '');
  });

  it('is found on any host, with or without a port', () => {
    assert.equal(split('at https://plans.example.org/widerrufen.').address, 'https://plans.example.org/widerrufen');
    assert.equal(split('at https://localhost:3000/widerrufen now').address, 'https://localhost:3000/widerrufen');
  });

  it('leaves the sentence byte-identical: the three parts join to what was served', () => {
    const text = 'Sur la page "Vertrag widerrufen" à l\'adresse https://app.openplate.de/widerrufen. Les informations :';
    const { before, address, after } = split(text);
    assert.equal(`${before}${address}${after}`, text);
  });

  it('links to the app route, not to the host that was printed', () => {
    assert.equal(WIDERRUFEN_PATH, '/widerrufen');
  });

  it('CONTROL: a sentence that prints no address is not split', () => {
    assert.equal(splitAtWiderrufenAddress('Fixture withdrawal notice.'), null);
    assert.equal(splitAtWiderrufenAddress('On the page "Vertrag widerrufen", which the app links.'), null);
  });

  it('CONTROL: an address that only looks like the page is not split', () => {
    for (const text of [
      'the receipt at https://app.openplate.de/widerrufen/bestaetigt.',
      'the page at http://app.openplate.de/widerrufen.',
      'the page at https://app.openplate.de/widerrufen?lang=en.',
      'the page at https://app.openplate.de/widerrufen#form.',
      'the page at https://app.openplate.de/widerrufen.html now',
      'the page at https://app.openplate.de/widerrufen-alt.',
      'the page at https://app.openplate.de/withdrawal.',
    ]) {
      assert.equal(splitAtWiderrufenAddress(text), null, `split: ${text}`);
    }
  });
});
