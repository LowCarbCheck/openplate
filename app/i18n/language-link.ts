/**
 * A LANGUAGE NAMED BY A LINK, `lang=fr` (2026-09-28).
 *
 * openplate.de links to `/sign-up?lang=<code>` and `/?lang=<code>`, and the
 * core appends `&lang=<code>` to the join link it mails, so a visitor who read
 * the pricing page in French fills in a French form and opens a French join
 * page. The app has one way to set its language, the switch on the
 * preferences screen (`selectLanguage` in `language-prefs.ts`): write the
 * cookie, write the storage mirror, reload the document so the server renders
 * it in the new language. A link takes exactly that path, with one step added.
 *
 * ── WHERE THE PARAMETER IS READ ──────────────────────────────────────────
 *
 * The query string first, then the fragment. The website's links put it in
 * the query; the mailed join link puts it after the `#`, beside the invite.
 *
 * ── THE PARAMETER LEAVES THE ADDRESS BEFORE THE RELOAD ───────────────────
 *
 * A browser that refuses the cookie would otherwise reload forever: the server
 * renders the old language, the page reads `lang=fr` again, reloads again. So
 * the parameter is taken off the address with `replaceState` first, and the
 * reload loads the address without it. The rest of the address, `plan=` in
 * particular, stays. `/join` passes an address with no fragment at all, because
 * the invite in it has already been parked and must not come back to the bar.
 *
 * ── WHAT IS IGNORED ──────────────────────────────────────────────────────
 *
 * A code that is not one of the six app languages (`lang=xx`, `lang=en-US`)
 * changes nothing and stays in the address. A link naming the language that is
 * already on screen reloads nothing: it only writes the preference, so the
 * next document load keeps it.
 *
 * Pure decisions, with the effects handed in, so the order (persist, strip,
 * reload) is pinned by a unit test rather than by watching a page blink.
 */
import { applyLanguageChange, isLanguageCode, type LanguageCode } from './language-prefs';

/** The name of the parameter. */
export const LANGUAGE_PARAM = 'lang';

/** The parameters of a query string or a fragment, with or without its leading `?` or `#`. */
function paramsOf(part: string): URLSearchParams {
  return new URLSearchParams(part.startsWith('#') ? part.slice(1) : part);
}

/** The app language an address names, from its query string first and its fragment second, or `null`. */
export function languageParamOf({ search, hash }: { search: string; hash: string }): LanguageCode | null {
  const fromQuery = paramsOf(search).get(LANGUAGE_PARAM);
  if (isLanguageCode(fromQuery)) return fromQuery;
  const fromFragment = paramsOf(hash).get(LANGUAGE_PARAM);
  return isLanguageCode(fromFragment) ? fromFragment : null;
}

/**
 * One part of an address with the language parameter taken out, everything
 * else kept in order. A part that carries no language is returned as it
 * came: a fragment such as `#how` is an anchor, not a list of parameters, and
 * re-encoding it would turn it into `#how=`.
 */
function withoutLanguage({ part, prefix }: { part: string; prefix: '?' | '#' }): string {
  const params = paramsOf(part);
  if (!params.has(LANGUAGE_PARAM)) return part;
  params.delete(LANGUAGE_PARAM);
  const rest = params.toString();
  return rest === '' ? '' : `${prefix}${rest}`;
}

/** The same address with the language parameter taken out of both its query string and its fragment. */
export function addressWithoutLanguage({
  pathname,
  search,
  hash,
}: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  return `${pathname}${withoutLanguage({ part: search, prefix: '?' })}${withoutLanguage({ part: hash, prefix: '#' })}`;
}

/** What a link's language asks of this page. */
export type LanguageLinkAction =
  /** No language parameter, or not one of the app's. */
  | { kind: 'none' }
  /** The language on screen already: keep it as the device's preference, reload nothing. */
  | { kind: 'persist'; code: LanguageCode }
  /** Another language: persist it, put `address` in the bar, reload. */
  | { kind: 'switch'; code: LanguageCode; address: string };

/**
 * Decides what the page does with a language a link named.
 *
 * @param input.code - `languageParamOf(...)` of the address as it arrived.
 * @param input.shownLanguage - the language the document is rendered in.
 * @param input.address - where the reload goes: `addressWithoutLanguage(...)`.
 */
export function decideLanguageLink({
  code,
  shownLanguage,
  address,
}: {
  code: LanguageCode | null;
  shownLanguage: string;
  address: string;
}): LanguageLinkAction {
  if (code === null) return { kind: 'none' };
  if (code === shownLanguage) return { kind: 'persist', code };
  return { kind: 'switch', code, address };
}

/** The side effects a decision needs, handed in so a test can record their order. */
export interface LanguageLinkEffects {
  writeCookie: (code: LanguageCode) => void;
  writeStorage: (code: LanguageCode) => void;
  /** `history.replaceState` to the address, with no navigation. */
  replaceAddress: (address: string) => void;
  reload: () => void;
}

/**
 * Carries a decision out. The switch is the app's own `applyLanguageChange`,
 * with the address cleaned first.
 *
 * @returns whether the document is about to reload, so a caller stops before
 *   it sends a request whose answer nobody will see.
 */
export function applyLanguageLink(action: LanguageLinkAction, effects: LanguageLinkEffects): boolean {
  if (action.kind === 'none') return false;
  if (action.kind === 'persist') {
    effects.writeCookie(action.code);
    effects.writeStorage(action.code);
    return false;
  }
  applyLanguageChange(action.code, {
    writeCookie: effects.writeCookie,
    writeStorage: effects.writeStorage,
    reload: () => {
      effects.replaceAddress(action.address);
      effects.reload();
    },
  });
  return true;
}
