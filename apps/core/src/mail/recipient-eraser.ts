/**
 * Asks the mail service to erase every copy it holds of a deleted account's
 * address (M1 spec 01, 2026-10-05).
 *
 * WHY THIS EXISTS. Deleting an account removes the rows in THIS database, and
 * nothing in the mail service. Pigeon keeps the recipient and the body of every
 * letter it sent, in its `emails` and `email_events` tables, its suppression
 * list, its contacts and its queue. A password reset letter is a key to a
 * diary, so a deleted account's old letters must not sit there. Pigeon now has
 * `POST <base>/v1/recipients/erase` with the body `{"email": "<address>"}`,
 * which erases all of it and answers `204` whether or not it held anything.
 *
 * THE ADDRESS GOES IN THE BODY, never the URL, so no access log on the way
 * holds it. The credential is the same Bearer key `MAIL_API_KEY` that sends the
 * letters, and the base is the one `MAIL_API_URL` already names: the mail URL
 * ends in `/v1/emails`, and the erase route is its sibling `/v1/recipients/erase`.
 *
 * ONLY PIGEON HAS THE ROUTE, and the mailer is one adapter for Pigeon and for
 * Resend alike. {@link pigeonEraseUrl} says a URL is Pigeon's when its path
 * ends in `/v1/emails` (Resend's is `/emails`). Any other HTTP mail API, and
 * SMTP, get no eraser at all: sending an address to a provider that has no such
 * route would only tell it one more address.
 *
 * IT NEVER THROWS AND NEVER BLOCKS AN ERASURE. A person's right to erasure does
 * not depend on a remote service answering, and the account is already gone
 * when this runs. A network error, a timeout, a 5xx and a 404 (an older Pigeon
 * that does not have the route yet) all leave the delete as it was.
 *
 * THE RETRY, and why it is in memory. The biller notice
 * (`accounts/erase-notifier.ts`) has no retry here: the biller's own nightly
 * pass is its backstop. Pigeon has no such pass, and this address is the one
 * thing nothing may remember: the row is gone, and a table of deleted accounts'
 * plain addresses to retry from would be the very copy this exists to remove.
 * So the retry lives in memory and in this request's lifetime:
 *
 *  - Up to {@link MAX_ERASE_ATTEMPTS} attempts, with a short wait between them.
 *  - The HTTP answer waits for them at most {@link ANSWER_BUDGET_MS}. Attempts
 *    that remain after that go on AFTER the response was sent.
 *  - Only what can change is retried: no answer, 408, 429 and 5xx. A 404, 401
 *    or 400 will answer the same a moment later, so it fails at once.
 *  - After the last attempt one log line says how many were made and the last
 *    status or error name and code. NEVER THE ADDRESS, and not an account id
 *    either, because nothing could be done with either.
 *
 * THE LIMIT, STATED PLAINLY. A process that stops while a retry waits, and a
 * Pigeon that is down for all three attempts, lose the call, and this service
 * keeps nothing to repeat it from. The backstop is Pigeon's own retention
 * limit, which deletes every letter after a fixed number of days whether or not
 * anyone asked. The privacy text says so.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import type { Logger } from '../logger.js';
import { errorFields, type ErrorFields } from '../log-error.js';
import type { MailConfig } from './mailer.js';

/** How many times one erasure is tried, the first included. */
export const MAX_ERASE_ATTEMPTS = 3;

/** The waits between attempts, in milliseconds: one fewer than the attempts. Short, because a person is waiting on the answer. */
export const ERASE_BACKOFF_MS: readonly number[] = [250, 750];

/** The most the HTTP answer waits for erasure to finish. Attempts still owed after it continue in the background. */
export const ANSWER_BUDGET_MS = 2_000;

/** How long one attempt waits for Pigeon to answer. Longer than the budget on purpose: it may finish after the response. */
export const ERASE_ATTEMPT_TIMEOUT_MS = 5_000;

/** Pigeon's mail path, which marks a URL as Pigeon's, and the sibling path the erase route has. */
const PIGEON_MAIL_PATH_SUFFIX = '/v1/emails';
const PIGEON_ERASE_PATH_SUFFIX = '/v1/recipients/erase';

/**
 * Called once per account delete, AFTER the delete succeeded and after any
 * letter the delete itself sent. Resolves within the answer budget whatever
 * Pigeon did, and never rejects.
 */
export type MailRecipientEraser = (input: { email: string }) => Promise<void>;

/**
 * Pigeon's erase URL for a mail API URL, or `null` when the mail API is not
 * Pigeon. A query string and a fragment are dropped: the credential is a Bearer
 * header, and the URL of a request that carries an address must hold nothing
 * else.
 */
export function pigeonEraseUrl(mailApiUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(mailApiUrl);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  if (!path.endsWith(PIGEON_MAIL_PATH_SUFFIX)) return null;
  parsed.pathname = `${path.slice(0, -PIGEON_MAIL_PATH_SUFFIX.length)}${PIGEON_ERASE_PATH_SUFFIX}`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

/** What one attempt came to. `retryable` is false for an answer that will not change. */
type AttemptOutcome =
  { erased: true } | { erased: false; retryable: boolean; status: number | null; failure: ErrorFields | null };

/** Statuses worth another try: the request may succeed unchanged a moment later. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export interface CreatePigeonRecipientEraserOptions {
  /** The instance's mail configuration, or `null` for none. */
  mail: MailConfig | null;
  logger: Logger;
  /** Defaults to {@link ERASE_ATTEMPT_TIMEOUT_MS}. A test passes milliseconds. */
  attemptTimeoutMs?: number;
  /** Defaults to {@link ERASE_BACKOFF_MS}. A test passes milliseconds. */
  backoffMs?: readonly number[];
  /** Defaults to {@link ANSWER_BUDGET_MS}. A test passes milliseconds. */
  answerBudgetMs?: number;
}

/**
 * The eraser for an instance whose mail API is Pigeon, or `null` for every
 * other mail setup (no mail, SMTP, an HTTP API that is not Pigeon).
 */
export function createPigeonRecipientEraser(options: CreatePigeonRecipientEraserOptions): MailRecipientEraser | null {
  const { mail, logger } = options;
  if (mail === null || mail.transport === 'smtp') return null;
  const found = pigeonEraseUrl(mail.url);
  if (found === null) return null;
  const target: string = found;
  const apiKey = mail.apiKey;

  const attemptTimeoutMs = options.attemptTimeoutMs ?? ERASE_ATTEMPT_TIMEOUT_MS;
  const backoffMs = options.backoffMs ?? ERASE_BACKOFF_MS;
  const answerBudgetMs = options.answerBudgetMs ?? ANSWER_BUDGET_MS;

  async function attemptOnce(email: string): Promise<AttemptOutcome> {
    try {
      const response = await fetch(target, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        // A redirect would send the address on to a host nobody configured.
        redirect: 'error',
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });
      // Read nothing: Pigeon answers 204, and an error body may echo the request.
      await response.body?.cancel();
      if (response.ok) return { erased: true };
      return { erased: false, retryable: isRetryableStatus(response.status), status: response.status, failure: null };
    } catch (cause) {
      return { erased: false, retryable: true, status: null, failure: errorFields(cause) };
    }
  }

  async function eraseWithRetries(email: string): Promise<void> {
    let last: AttemptOutcome = { erased: false, retryable: true, status: null, failure: null };
    for (let attempt = 1; attempt <= MAX_ERASE_ATTEMPTS; attempt += 1) {
      last = await attemptOnce(email);
      if (last.erased) {
        logger.info('The mail service erased the copies of a deleted account address', { attempts: attempt });
        return;
      }
      if (!last.retryable || attempt === MAX_ERASE_ATTEMPTS) {
        logger.error(
          'Could not ask the mail service to erase a deleted account address, its retention limit is the backstop',
          {
            attempts: attempt,
            status: last.status,
            errorName: last.failure?.errorName ?? null,
            errorCode: last.failure?.errorCode ?? null,
          },
        );
        return;
      }
      await sleep(backoffMs[attempt - 1] ?? 0);
    }
  }

  return async function eraseDeletedRecipient(input: { email: string }): Promise<void> {
    // The work never rejects: it logs its own failure and ends. The catch is
    // for the one thing that could still throw here, a logger.
    const work = eraseWithRetries(input.email).catch((cause: unknown) => {
      logger.error('The recipient erasure failed unexpectedly', { ...errorFields(cause) });
    });
    const timer = new AbortController();
    const budget = sleep(answerBudgetMs, undefined, { signal: timer.signal }).catch(() => undefined);
    await Promise.race([work, budget]);
    timer.abort();
  };
}
