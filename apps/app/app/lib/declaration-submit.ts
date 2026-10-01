/**
 * The one request both statutory forms send, `/kuendigung` and `/widerrufen`
 * (M214/09), and the language it carries.
 *
 * ── THE READER'S OWN LANGUAGE (2026-09-30) ────────────────────────────────
 *
 * The form sends the language it is drawn in, one of the six, and
 * openplate-core mails the receipt in it. Until 2026-09-30 it narrowed
 * French, Italian, Spanish and Turkish to German, because the core took `de`
 * and `en` only.
 *
 * ── A LANGUAGE NOBODY KNOWS IS ENGLISH (owner decision, 2026-09-30) ───────
 *
 * A language outside the six, and a language the core it reaches does not
 * take, is sent as English, as everywhere in the checkout and the legal forms.
 * That is a DISPLAY fallback. It says nothing about which text binds, which
 * is the German one, and the core keeps its own order for the receipt FILE it
 * reads (the reader's language, then German, then English), because that
 * order is about which file an operator has written.
 *
 * ── AN OLDER CORE STILL RECEIVES THE DECLARATION ──────────────────────────
 *
 * This app and openplate-core are released and deployed apart, so a form may
 * post to a core that still takes `de` and `en` only. That core refuses any
 * other language with `400 {"error":"declaration-invalid","field":"language"}`
 * and stores nothing, because it checks the body before it writes the row.
 * The request then goes again, ONCE, in English, by the rule above. A § 312k
 * button that failed over a display language would be the expensive outcome
 * the statute describes. An English request is never sent again, so the
 * retry cannot loop.
 *
 * ── NOT THROUGH THIS APP'S SERVER ─────────────────────────────────────────
 *
 * The request goes from the browser straight to openplate-core's own origin
 * (`CORE_URL`), for the reasons both pages' headers give.
 */
import { z } from 'zod';

import { isLanguageCode, type LanguageCode } from '#app/i18n/language-prefs';
import { createComponentLogger } from '#app/lib/logger';

const log = createComponentLogger('declaration-submit');

/** Where a browser posts a declaration: `openplate-core`'s own origin, never this server. */
export const DECLARATIONS_API_PATH = '/v1/legal/declarations';

/**
 * The language a declaration goes in when the language it named is not taken:
 * outside the six, or refused by a core older than the six. A core of any
 * age takes it.
 */
const FALLBACK_LANGUAGE: LanguageCode = 'en';

export type DeclarationKind = 'kuendigung' | 'widerruf';

/** The body both forms post, as openplate-core's `server/legal-declarations.ts` reads it. */
export interface DeclarationRequest {
  kind: DeclarationKind;
  name: string;
  email: string;
  contractReference: string | null;
  terminationType: 'ordentlich' | 'ausserordentlich' | null;
  reason: string | null;
  requestedDate: string | null;
  timing: 'earliest' | 'onDate' | null;
  /** The language the form is drawn in. It chooses the language of the receipt the core mails. */
  language: LanguageCode;
}

/** What a submission came to. `unreachable` is also a `202` body this page could not read. */
export type DeclarationOutcome =
  | { status: 'accepted'; receiptId: string; receivedAt: string }
  | { status: 'invalid' }
  | { status: 'rate-limited' }
  | { status: 'unreachable' };

/** One request's answer, before the retry decides: the four outcomes, or a refusal of the language alone. */
type AnswerOfOneRequest = DeclarationOutcome | { status: 'language-refused' };

/** How the request is sent: the browser's `fetch`, or a unit test's own. */
export type DeclarationFetch = (url: string, init: RequestInit) => Promise<Response>;

/** The core's `202` body, PROTOCOL-style: parsed, never trusted. */
const acceptedResponseSchema = z.object({
  receiptId: z.string().min(1),
  receivedAt: z.string().min(1),
  kind: z.enum(['kuendigung', 'widerruf']),
});

/** The core's `400` body, which names the first field it refused. */
const refusalSchema = z.object({ error: z.literal('declaration-invalid'), field: z.string() });

/**
 * The language a declaration is sent in, from the language the app is drawn
 * in. The six app languages pass through by their bare code; anything else is
 * English. See the module header.
 */
export function declarationLanguageFor(uiLanguage: string): LanguageCode {
  const base = uiLanguage.split('-')[0] ?? '';
  return isLanguageCode(base) ? base : FALLBACK_LANGUAGE;
}

/** Reads a `400`: a refusal of the language alone, or of anything else. */
async function readRefusal(response: Response): Promise<AnswerOfOneRequest> {
  const parsed = refusalSchema.safeParse(await response.json().catch(() => null));
  return parsed.success && parsed.data.field === 'language' ? { status: 'language-refused' } : { status: 'invalid' };
}

/** Reads a `202`. A body of another shape, or of the other kind, is a receipt this page cannot show. */
async function readReceipt(input: { response: Response; kind: DeclarationKind }): Promise<DeclarationOutcome> {
  const parsed = acceptedResponseSchema.safeParse(await input.response.json().catch(() => null));
  if (!parsed.success || parsed.data.kind !== input.kind) {
    log.error('a 202 declaration response did not match its schema');
    return { status: 'unreachable' };
  }
  return { status: 'accepted', receiptId: parsed.data.receiptId, receivedAt: parsed.data.receivedAt };
}

/** One POST and its answer. Never throws: a request that did not arrive is `unreachable`. */
async function postOnce(input: {
  serverUrl: string;
  request: DeclarationRequest;
  fetchDeclaration: DeclarationFetch;
}): Promise<AnswerOfOneRequest> {
  let response: Response;
  try {
    response = await input.fetchDeclaration(`${input.serverUrl}${DECLARATIONS_API_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.request),
    });
  } catch (error) {
    log.error('the declarations endpoint could not be reached', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 'unreachable' };
  }
  if (response.status === 202) return readReceipt({ response, kind: input.request.kind });
  if (response.status === 400) return readRefusal(response);
  if (response.status === 429) return { status: 'rate-limited' };
  return { status: 'unreachable' };
}

/**
 * Sends one declaration, and once more in English when a core older than the
 * six languages refused the language. See the module header.
 *
 * @param input.fetchDeclaration - how to send it. Defaults to the browser's
 *   `fetch`; a unit test passes a fake that records each body.
 */
export async function submitDeclaration({
  serverUrl,
  request,
  fetchDeclaration = (url, init) => fetch(url, init),
}: {
  serverUrl: string;
  request: DeclarationRequest;
  fetchDeclaration?: DeclarationFetch;
}): Promise<DeclarationOutcome> {
  const first = await postOnce({ serverUrl, request, fetchDeclaration });
  if (first.status !== 'language-refused') return first;
  if (request.language === FALLBACK_LANGUAGE) return { status: 'invalid' };

  log.warn('the declarations endpoint refused the language, so the declaration goes again in English', {
    language: request.language,
  });
  const second = await postOnce({
    serverUrl,
    request: { ...request, language: FALLBACK_LANGUAGE },
    fetchDeclaration,
  });
  return second.status === 'language-refused' ? { status: 'invalid' } : second;
}
