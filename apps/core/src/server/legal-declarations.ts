/**
 * `POST /v1/legal/declarations`, spec M214/09's two statutory buttons: a
 * cancellation (§312k BGB) or a withdrawal (§356a BGB), filed by a person who
 * is not signed in and may never have been.
 *
 * ALWAYS MOUNTED, UNLIKE EVERY OPTIONAL SURFACE IN `create-app.ts`. The other
 * dark subtrees there answer the ordinary unknown-path 404 until an operator
 * opts in, because this service auto-deploys on push and an unconfigured
 * feature must be indistinguishable from one never written. This route is the
 * opposite bargain: §312k Absatz 6 BGB makes the ABSENCE of a working
 * cancellation button the expensive outcome, voiding the notice-period term
 * for every customer it touches. There is no flag to turn it off.
 *
 * ROUTE-SCOPED `express.json`, NEVER A ROUTER-WIDE `.use`, exactly as
 * `server/plans-proxy.ts` argues: the first body parser registered on a
 * router with no path applies to every later route in the whole service.
 *
 * IP RATE LIMIT, NOT AN ACCOUNT ONE, because the route is unauthenticated by
 * design — both statutes require the button to work for a person who has
 * never logged in. `legal/legal-declarations-rate-limit.ts` is
 * `ai/rate-limit.ts`'s shape with the identity swapped.
 *
 * THE ORDER OF WORK IS THE POLICY, and it is the whole reason the file exists
 * rather than being inlined into `create-app.ts`:
 *
 *  1. Validate the body. A malformed field is a `400` that NAMES the field
 *     and touches no store.
 *  2. Look up the account by `normalizeEmail(email)`. A local, read-only
 *     query, not the biller: doing this before the insert means the row is
 *     written once, with `account_id` already resolved, rather than written
 *     and then patched.
 *  3. PERSIST. This is the statutory record. Once this resolves, the
 *     declaration exists whatever happens next.
 *  4. Forward to the biller, best-effort, bounded by a timeout. Its outcome
 *     is recorded on the row and NEVER changes the response: `202` either
 *     way, per PROTOCOL §2. A `502` here means the PERSIST at step 3 failed,
 *     nothing about the forward.
 *  5. Mail the receipt (once, or twice when the typed address and the matched
 *     account's differ) and the operator alert. Best-effort: a failed send is
 *     logged and swallowed, never surfaced to the caller. The receipt, and
 *     only the receipt, is skipped past any of three daily ceilings
 *     (`legal/receipt-ceilings.ts`, M270/11): its mailbox has had
 *     `LEGAL_DECLARATION_RECEIPTS_PER_ADDRESS_PER_DAY` declarations in the
 *     trailing 24 hours, so the form cannot mail one stranger without limit;
 *     the sender's network has filed `receiptsPerNetworkPerDay`, so one sender
 *     cannot mail many strangers; or the instance has had `receiptsPerDay`,
 *     so many senders together cannot flood the sending domain. The receipt
 *     repeats no text the sender wrote (`mail/declaration-message.ts`). The
 *     declaration itself, its forward and the operator alert, which keeps
 *     every word, never depend on any of it.
 *  6. Answer `202 {receiptId, receivedAt, kind}` — BYTE IDENTICAL whether the
 *     email matched an account or not, whether the forward succeeded or not,
 *     whether either letter sent or not, and whether a ceiling skipped the
 *     receipt. None of that is the caller's to learn from the response.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Express, Request, Response } from 'express';
import { asObject, asString, type JsonValue } from '../lib/json.js';
import { parseEmail } from '../accounts/auth-input.js';
import { normalizeEmail } from '../lib/verifier.js';
import { asyncHandler } from './async-handler.js';
import { createLegalDeclarationsRateLimit } from '../legal/legal-declarations-rate-limit.js';
import { rateLimitKeyForIp } from '../lib/client-address.js';
import {
  createNetworkReceiptLedger,
  decideReceipt,
  LEGAL_DECLARATION_RECEIPTS_PER_DAY,
  LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY,
  RECEIPT_WINDOW_MS,
} from '../legal/receipt-ceilings.js';
import { toDeclarationReceipt } from '../mail/declaration-message.js';
import type { LegalDeclarationsStore } from '../legal/legal-declarations-store.js';
import { forwardDeclaration, type ForwardDeclarationUpstream } from '../legal/forward-declaration.js';
import type { AccountStore } from '../accounts/account-store.js';
import type { Mailer } from '../mail/mailer.js';
import type { Logger } from '../logger.js';
import { INSTANCE_LANGUAGES, type InstanceLanguage } from '../protocol.js';

/** `/v1/legal/declarations`, the one path this family owns. */
export const LEGAL_DECLARATIONS_PATH = '/v1/legal/declarations';

/** A declaration carries a handful of short fields and a photograph never enters it; 16 KB is `plans-proxy.ts`'s own bound for the same reason. */
export const LEGAL_DECLARATIONS_MAX_REQUEST_BYTES = 16 * 1024;

/**
 * Receipts one mailbox may receive in any trailing 24 hours, counted from the
 * stored rows by normalised address. The form needs no login, so without this
 * anybody could make this service mail one stranger without limit, from as
 * many source addresses as they hold. Three covers a person who files twice
 * and retries once. A declaration over the cap is still stored, forwarded and
 * sent to the operator; only its receipt is skipped, and that is logged.
 */
export const LEGAL_DECLARATION_RECEIPTS_PER_ADDRESS_PER_DAY = 3;

/** Requests one IP may file in any trailing 60-second window, when nothing overrides it. Five is generous for a person retrying a flaky connection and stingy for a script. */
export const LEGAL_DECLARATIONS_RATE_LIMIT_PER_MINUTE = 5;

const MAX_NAME_CHARS = 200;
const MAX_CONTRACT_REFERENCE_CHARS = 200;
const MAX_REASON_CHARS = 4000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface LegalDeclarationsRouteOptions {
  store: LegalDeclarationsStore;
  accounts: AccountStore;
  mailer: Mailer;
  /** `null` for "no biller stands behind this instance" — every declaration is still persisted and mailed, and `forward_error` is stamped `plans-not-configured`. */
  plans: ForwardDeclarationUpstream | null;
  logger: Logger;
  now: () => Date;
  /** Requests one IP may file per minute. Defaults to `LEGAL_DECLARATIONS_RATE_LIMIT_PER_MINUTE`; a harness that is not ABOUT the limiter sets this high, exactly as `ai.perMinute` does. */
  rateLimitPerMinute?: number;
  /** Injected so a test can watch the limiter without sixty real seconds. Defaults to `Date.now`. */
  rateLimitNow?: () => number;
  /** Receipts one mailbox may receive per trailing 24 hours. Defaults to `LEGAL_DECLARATION_RECEIPTS_PER_ADDRESS_PER_DAY`. */
  receiptsPerAddressPerDay?: number;
  /** Receipts one sender network may cause per trailing 24 hours, `LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY` in the environment. Defaults to the constant of that name. */
  receiptsPerNetworkPerDay?: number;
  /** Receipts the form may send per trailing 24 hours across all recipients, `LEGAL_DECLARATION_RECEIPTS_PER_DAY` in the environment. Defaults to the constant of that name. */
  receiptsPerDay?: number;
}

/** Every field the wire contract accepts, already decoded to its domain type. */
interface DeclarationInput {
  kind: 'kuendigung' | 'widerruf';
  name: string;
  /** As typed, trimmed, never case-folded. See `db/schema.ts` on why this and the normalized form both matter. */
  email: string;
  contractReference: string | null;
  terminationType: 'ordentlich' | 'ausserordentlich' | null;
  reason: string | null;
  requestedDate: string | null;
  timing: 'earliest' | 'onDate' | null;
  /** The language of the form the person sent, one of the six the instance writes mail in. It chooses the receipt's language. */
  language: InstanceLanguage;
}

type FieldResult<T> = { ok: true; value: T } | { ok: false };

function invalid<T>(): FieldResult<T> {
  return { ok: false };
}

function valid<T>(value: T): FieldResult<T> {
  return { ok: true, value };
}

/** A required, bounded, trimmed string. Empty after trimming is treated as absent, the same rule `feedback/register-feedback-route.ts` applies. */
function requiredBoundedString(value: JsonValue | undefined, maxChars: number): FieldResult<string> {
  const raw = asString(value);
  if (raw === null) return invalid();
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > maxChars) return invalid();
  return valid(trimmed);
}

/** An optional, bounded, trimmed string. `null` or absent is a legal "not given"; anything else follows the required rule above. */
function optionalBoundedString(value: JsonValue | undefined, maxChars: number): FieldResult<string | null> {
  if (value === undefined || value === null) return valid(null);
  const result = requiredBoundedString(value, maxChars);
  return result.ok ? valid(result.value) : invalid();
}

function requiredEnum<T extends string>(value: JsonValue | undefined, members: readonly T[]): FieldResult<T> {
  const raw = asString(value);
  if (raw === null) return invalid();
  // `find` rather than `includes`, so the matched member's type `T` comes
  // back from the array itself and no cast is needed to recover it from `raw`.
  const match = members.find((member) => member === raw);
  return match === undefined ? invalid() : valid(match);
}

function optionalEnum<T extends string>(value: JsonValue | undefined, members: readonly T[]): FieldResult<T | null> {
  if (value === undefined || value === null) return valid(null);
  const result = requiredEnum(value, members);
  return result.ok ? valid(result.value) : invalid();
}

/** `YYYY-MM-DD`, and a REAL calendar date: `2026-02-30` is the right shape and not a day that exists. */
function optionalDateString(value: JsonValue | undefined): FieldResult<string | null> {
  if (value === undefined || value === null) return valid(null);
  const raw = asString(value);
  if (raw === null || !DATE_PATTERN.test(raw)) return invalid();
  const [year, month, day] = raw.split('-').map(Number);
  // Unreachable given `DATE_PATTERN` just matched three `\d` groups
  // separated by `-`; the check keeps the destructure honest without a cast.
  if (year === undefined || month === undefined || day === undefined) return invalid();
  const asDate = new Date(Date.UTC(year, month - 1, day));
  const isReal = asDate.getUTCFullYear() === year && asDate.getUTCMonth() === month - 1 && asDate.getUTCDate() === day;
  return isReal ? valid(raw) : invalid();
}

/** The typed email, trimmed and format-checked via {@link parseEmail}, but returned in the case the person typed it in. */
function requiredEmail(value: JsonValue | undefined): FieldResult<string> {
  const raw = asString(value);
  if (raw === null) return invalid();
  const trimmed = raw.trim();
  // `parseEmail` both validates and normalizes; only the validation matters
  // here; the trimmed-but-not-folded original is what this route stores and
  // mails to. A value that fails normalization is not a well-formed address.
  return parseEmail(trimmed).ok ? valid(trimmed) : invalid();
}

const KINDS = ['kuendigung', 'widerruf'] as const;
const TERMINATION_TYPES = ['ordentlich', 'ausserordentlich'] as const;
const TIMINGS = ['earliest', 'onDate'] as const;

/** Answers `400 {"error":"declaration-invalid","field":"<name>"}` and returns `null`, so every guard clause below reads `if (!x.ok) return fail(res, 'x');`. */
function fail(res: Response, field: string): null {
  res.status(400).json({ error: 'declaration-invalid', field });
  return null;
}

/**
 * Decodes the whole body, or answers the caller with `400
 * {"error":"declaration-invalid","field":"<name>"}` and returns `null`.
 *
 * ONE FIELD PER RESPONSE, THE FIRST ONE CHECKED, in the order the wire
 * contract lists them (PROTOCOL §2). A client fixing one field at a time is
 * exactly what a form does; naming every bad field at once is not a property
 * this route promises.
 *
 * EARLY RETURNS, NOT A TABLE OF RESULTS. Each `FieldResult` is a discriminated
 * union on `ok`, so the guard clause below is also the type narrowing: after
 * `if (!kind.ok) return ...`, `kind.value` is known to exist without a cast.
 */
function decodeDeclaration(req: Request, res: Response): DeclarationInput | null {
  // SAFETY: `express.json()` on the route above has already parsed this
  // body, so it is JSON-shaped by construction; `asObject` re-establishes
  // that at the type level, the same pattern `register-feedback-route.ts` uses.
  const body = asObject(req.body as JsonValue) ?? {};

  const kind = requiredEnum(body.kind, KINDS);
  if (!kind.ok) return fail(res, 'kind');
  const name = requiredBoundedString(body.name, MAX_NAME_CHARS);
  if (!name.ok) return fail(res, 'name');
  const email = requiredEmail(body.email);
  if (!email.ok) return fail(res, 'email');
  const contractReference = optionalBoundedString(body.contractReference, MAX_CONTRACT_REFERENCE_CHARS);
  if (!contractReference.ok) return fail(res, 'contractReference');
  const terminationType = optionalEnum(body.terminationType, TERMINATION_TYPES);
  if (!terminationType.ok) return fail(res, 'terminationType');
  const reason = optionalBoundedString(body.reason, MAX_REASON_CHARS);
  if (!reason.ok) return fail(res, 'reason');
  const requestedDate = optionalDateString(body.requestedDate);
  if (!requestedDate.ok) return fail(res, 'requestedDate');
  const timing = optionalEnum(body.timing, TIMINGS);
  if (!timing.ok) return fail(res, 'timing');
  // The six languages the rest of the mail is written in (2026-09-30). Until
  // then only `de` and `en`; an older app still sends one of those two.
  const language = requiredEnum(body.language, INSTANCE_LANGUAGES);
  if (!language.ok) return fail(res, 'language');

  return {
    kind: kind.value,
    name: name.value,
    email: email.value,
    contractReference: contractReference.value,
    terminationType: terminationType.value,
    reason: reason.value,
    requestedDate: requestedDate.value,
    timing: timing.value,
    language: language.value,
  };
}

/**
 * One count read from the rows, or `0` when the read fails.
 *
 * FAIL OPEN, and only here. The row is already stored, and §312k BGB asks the
 * business to confirm receipt without delay; a count that could not be read is
 * no reason to withhold that confirmation, and it must never turn the `202`
 * into a `500`. The failure is logged, naming which count it was.
 */
async function countOrZero(input: {
  logger: Logger;
  count: 'address' | 'instance';
  read: () => Promise<number>;
}): Promise<number> {
  try {
    return await input.read();
  } catch (cause) {
    input.logger.error('Could not count declaration receipts, sending the receipt', {
      count: input.count,
      error: cause instanceof Error ? cause.name : 'unknown error',
    });
    return 0;
  }
}

export function registerLegalDeclarationsRoute(app: Express, options: LegalDeclarationsRouteOptions): void {
  const router = express.Router();
  const rateLimit = createLegalDeclarationsRateLimit({
    perMinute: options.rateLimitPerMinute ?? LEGAL_DECLARATIONS_RATE_LIMIT_PER_MINUTE,
    now: options.rateLimitNow,
  });
  const addressCap = options.receiptsPerAddressPerDay ?? LEGAL_DECLARATION_RECEIPTS_PER_ADDRESS_PER_DAY;
  const networkCap = options.receiptsPerNetworkPerDay ?? LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY;
  const instanceCap = options.receiptsPerDay ?? LEGAL_DECLARATION_RECEIPTS_PER_DAY;
  const networkLedger = createNetworkReceiptLedger({ cap: networkCap });

  router.post(
    LEGAL_DECLARATIONS_PATH,
    express.json({ limit: LEGAL_DECLARATIONS_MAX_REQUEST_BYTES }),
    rateLimit,
    asyncHandler(async (req, res) => {
      const input = decodeDeclaration(req, res);
      if (input === null) return;

      // STEP 2: the account lookup. Local, read-only, and cheap enough to do
      // ahead of the insert so the row below is written ONCE, with
      // `account_id` already resolved rather than patched in afterwards.
      const account = await options.accounts.findAccountByEmail(normalizeEmail(input.email));

      const id = randomUUID();
      const receivedAt = options.now();
      // The burst limiter's own bucket, an IPv4 address or an IPv6 /64, and
      // the same `unknown` fallback, so the two count one sender alike.
      const senderNetwork = rateLimitKeyForIp(req.ip ?? 'unknown');

      // STEP 3: PERSIST. Everything from here on is best-effort; this is not.
      let row;
      try {
        row = await options.store.create({
          id,
          kind: input.kind,
          name: input.name,
          email: input.email,
          contractReference: input.contractReference,
          terminationType: input.terminationType,
          reason: input.reason,
          requestedDate: input.requestedDate,
          timing: input.timing,
          language: input.language,
          receivedAt,
          accountId: account?.id ?? null,
        });
      } catch (cause) {
        options.logger.error('Could not persist a legal declaration', {
          error: cause instanceof Error ? cause.name : 'unknown error',
        });
        res.status(502).json({ error: 'declaration-upstream-unreachable' });
        return;
      }

      // STEP 4: forward, best-effort, never changes the response below.
      const outcome = await forwardDeclaration({
        upstream: options.plans,
        declaration: row,
        matchedAccount: account === null ? null : { id: account.id, email: account.email },
        logger: options.logger,
      });
      await options.store.recordForwardOutcome({
        id,
        outcome: outcome.ok ? { ok: true, forwardedAt: options.now() } : { ok: false, forwardError: outcome.code },
      });

      // STEP 5: mail, best-effort, and EACH SEND INDEPENDENTLY SO: a failed
      // receipt must not take the operator alert down with it, which is the
      // one letter the design requires on every declaration. A failed send is
      // logged and swallowed, never surfaced to the caller.
      //
      // Counted once the row is stored, so a declaration that failed to persist
      // (the `502` above) never spends a network's allowance.
      const networkCount = networkLedger.record({ network: senderNetwork, atMs: receivedAt.getTime() });
      const declarationFields = {
        kind: row.kind,
        name: row.name,
        email: row.email,
        contractReference: row.contractReference,
        terminationType: row.terminationType,
        reason: row.reason,
        requestedDate: row.requestedDate,
        timing: row.timing,
        receivedAt: row.receivedAt,
      };
      const mailSends: Promise<void>[] = [
        options.mailer.sendDeclarationOperatorAlert({ ...declarationFields, receiptId: id, matched: account !== null }),
      ];
      // THE RECEIPT CEILINGS, each count including this declaration. Both
      // receipts below go to ONE mailbox (the account was found by this same
      // normalised address), so one decision covers them.
      const since = new Date(receivedAt.getTime() - RECEIPT_WINDOW_MS);
      const addressCount = await countOrZero({
        logger: options.logger,
        count: 'address',
        read: () => options.store.countReceivedFor({ normalizedEmail: normalizeEmail(row.email), since }),
      });
      const instanceCount = await countOrZero({
        logger: options.logger,
        count: 'instance',
        read: () => options.store.countReceivedSince({ since }),
      });
      const decision = decideReceipt({
        address: { count: addressCount, cap: addressCap },
        network: { count: networkCount, cap: networkCap },
        instance: { count: instanceCount, cap: instanceCap },
      });
      if (decision.kind === 'skip') {
        // The receipt id and the ceiling, nothing else: the address and the
        // network are exactly what a log line must not carry, and the
        // operator alert names the row.
        options.logger.warn('Skipped a declaration receipt over a daily ceiling', {
          receiptId: id,
          ceiling: decision.ceiling,
          cap: decision.cap,
        });
      }
      // The receipt's own view of the row: no text the sender wrote, see
      // `mail/declaration-message.ts`. The operator alert above keeps it all.
      const receipt = { ...toDeclarationReceipt(declarationFields), receiptId: id, language: input.language };
      // TWICE ONLY WHEN THE STRINGS DIFFER. See `db/schema.ts` on why a
      // matched account's own address can differ from what was typed even
      // though both name the same mailbox: this compares the two as written,
      // not as folded.
      const receiptRecipients =
        account !== null && account.email !== row.email ? [row.email, account.email] : [row.email];
      if (decision.kind === 'send') {
        for (const to of receiptRecipients) {
          mailSends.push(options.mailer.sendDeclarationReceipt({ ...receipt, to }));
        }
      }
      const outcomes = await Promise.allSettled(mailSends);
      for (const settled of outcomes) {
        if (settled.status === 'rejected') {
          options.logger.error('Could not mail a declaration message', {
            error: settled.reason instanceof Error ? settled.reason.name : 'unknown error',
          });
        }
      }

      // STEP 6: BYTE IDENTICAL whatever happened above. See the module header.
      res.status(202).json({ receiptId: id, receivedAt: receivedAt.toISOString(), kind: row.kind });
    }),
  );

  app.use(router);
}
