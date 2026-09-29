/**
 * The address of the withdrawal function, found inside a served sentence
 * (M265 spec 05).
 *
 * The biller's withdrawal notice names the § 356a BGB page "Vertrag
 * widerrufen" and prints its full address, `https://<host>/widerrufen`, as
 * part of the sentence, in every language it serves. The order page turns
 * that printed address into a link to the app's own `/widerrufen` route. The
 * sentence stays the biller's, byte for byte: this module only says where the
 * address starts and ends, and the page draws the three parts in order.
 *
 * ── ANY HOST, ONE PATH ──
 * The host is whatever the biller printed, so a staging biller or another
 * instance works the same. The path must be exactly `/widerrufen`: a longer
 * path (`/widerrufen/bestaetigt`), a query, a fragment or a file suffix is a
 * different address, and the sentence is then drawn as plain text, as it was
 * before. A full stop right after the address ends the sentence and is not
 * part of the address.
 */

/** The app's own route for the withdrawal function, where the linked address goes. */
export const WIDERRUFEN_PATH = '/widerrufen';

/**
 * `https://`, a host with an optional port, then the path. The lookahead
 * refuses a path that goes on, and a `.` followed by a word character, which is
 * a suffix rather than the end of a sentence.
 */
const WIDERRUFEN_ADDRESS = /https:\/\/[a-z\d.-]+(?::\d+)?\/widerrufen(?![\w/?#-]|\.\w)/iu;

/** A served sentence, cut around the address it prints. The three parts, joined, are the sentence. */
export interface WiderrufenAddressParts {
  before: string;
  address: string;
  after: string;
}

/**
 * Finds the first printed address of the withdrawal function in a sentence.
 *
 * @param text - a sentence the biller served.
 * @returns the sentence in three parts, or `null` when it prints no such address.
 */
export function splitAtWiderrufenAddress(text: string): WiderrufenAddressParts | null {
  const match = WIDERRUFEN_ADDRESS.exec(text);
  if (match === null) return null;
  const [address] = match;
  return { before: text.slice(0, match.index), address, after: text.slice(match.index + address.length) };
}
