/**
 * Typed failure classification for vision-provider HTTP errors — carried
 * alongside `VisionProviderError` (see `./types`) so callers (the scan flow)
 * can react to *why* a call failed instead of pattern-matching the display
 * message. Before this module existed, a wrong key, an exhausted provider
 * balance, a rate limit, and a transient outage all threw the exact same
 * generic `Vision provider returned an error (status N)` — indistinguishable
 * from each other, and from a genuinely bad photo.
 *
 * Kept in its own module rather than added to `./types` so this fix doesn't
 * need to touch a file outside this change's declared scope (the BYOK
 * scan-path hardening pass). `VisionProviderFailure` is a
 * `VisionProviderError` subclass, so every existing
 * `error instanceof VisionProviderError` check (e.g. `app/routes/scan.tsx`)
 * keeps working unchanged; callers that want the typed cause additionally
 * check `error instanceof VisionProviderFailure` or read `.failureCause`.
 */
import { z } from 'zod';

import type { ScanTokenUsage } from './types';
import { VisionProviderError } from './types';

/**
 * - `auth` — the key itself was rejected (401/403). Resending the same
 *   request can never succeed.
 * - `credit` — the provider account is out of balance/quota (402, or a 429
 *   whose body carries a known quota/billing error code). Can never succeed
 *   until the user adds credit with their provider.
 * - `rate-limit` — too many requests too fast (429, no quota/billing
 *   signal). Can succeed if retried later.
 * - `model-not-found` — the provider doesn't recognize the configured model
 *   id (404). Resending the identical request can never succeed — the fix is
 *   picking a different model in AI settings, not retrying.
 * - `invalid-request` — the provider rejected the request itself as
 *   malformed or unprocessable (400 bad request, 413 payload too large, 422
 *   unprocessable entity, or any other 4xx this module doesn't otherwise
 *   recognize). Resending the identical request unchanged can never succeed
 *   either — this used to be lumped into `transient` ("can succeed if
 *   retried"), which told the user to keep trying something that never
 *   could, and would burn real quota/money on a retry keyed off that cause.
 * - `transient` — network failure or a 5xx the structured-output retry (see
 *   `openai-compatible.ts`) didn't resolve. Can succeed if retried later.
 * - `genuinely-no-food` — the call itself succeeded (2xx) but returned no
 *   usable content (empty or malformed output) — the one case where "try a
 *   different photo" is actually the right advice.
 */
export type VisionFailureCause =
  | 'auth'
  | 'credit'
  | 'rate-limit'
  | 'model-not-found'
  | 'invalid-request'
  | 'transient'
  | 'genuinely-no-food'
  /**
   * `413` — the photo is bigger than this server will accept.
   *
   * SPLIT OUT OF `invalid-request` (M192/06). That bucket's message points at
   * the model and connection settings, which is the right advice for a 400 and
   * useless for a 413: nothing in settings makes a photo smaller, and on a
   * managed instance there are no settings to look at. The person needs to
   * know it is the SIZE.
   */
  | 'photo-too-large'
  /**
   * `403 {"error":"ai-not-allowed"}` — this account's daily allowance is zero.
   *
   * Not `auth`: the credential is perfectly good and the person has nothing to
   * fix. Only an administrator can change it, and that is the whole message.
   */
  | 'ai-not-allowed'
  /**
   * `403 {"error":"account-suspended"}` — an administrator suspended this
   * account, and this is the same refusal every other authenticated call gets.
   */
  | 'account-suspended'
  /**
   * `403 {"error":"health-consent-required"}`: the instance requires a consent
   * to health data and this account does not hold its current version
   * (openplate-core `PROTOCOL.md` §5.15.1, 2026-09-29). A plate photograph is
   * health data, so the proxy refuses before anything is counted or sent.
   *
   * NOT `auth`, WHERE AN UNKNOWN 403 USED TO LAND, which told the person to
   * check an API key a managed instance never gave them. The screen sends the
   * person to the consent screen instead, and nothing about a key or an
   * allowance is true of it.
   */
  | 'consent-required'
  /**
   * `403 {"error":"allowance-expired"}`, the account's AI allowance ended on
   * a date that has passed (`PROTOCOL.md` §5.19).
   *
   * SEPARATE FROM `ai-not-allowed`, and the protocol says why: "your operator
   * never gave you AI" and "your time ran out" are different sentences with
   * different next steps, and folding them together tells somebody whose trial
   * ended to ask for an allowance they already had. Nothing is spent: the
   * refusal happens before the reservation, so no usage row is written.
   */
  | 'allowance-expired'
  /**
   * `403 {"error":"trial-scans-spent"}`, the account's free AI scans are used
   * up (M253/03, `PROTOCOL.md` §5.19).
   *
   * A THIRD REFUSAL, NOT `allowance-expired` AND NOT `auth`. Nothing ran out
   * on a date, and nothing about a key is wrong: the next step is a plan, so
   * the screen shows the plan offer. Before this cause existed an unknown 403
   * code fell through to `auth` ("check your key"), which on a managed
   * instance names a key the person never had.
   */
  | 'trial-scans-spent'
  /**
   * `403 {"error":"trial-expired","endedBy":"days"}`, the free tier's days
   * are over with scans still left (M267, `PROTOCOL.md` §5.19).
   *
   * A FOURTH REFUSAL, NOT `trial-scans-spent`, whose sentence says the scans
   * are used, and NOT `allowance-expired`, which is a paid window running out.
   * The next step is a plan, as for spent scans. Before this cause existed the
   * code was an unknown 403, which fell through to `auth` ("check your key").
   */
  | 'trial-expired'
  /**
   * `403 {"error":"capability-required","capability":"<label>"}`, the account's
   * plan does not include the feature this request was made for (M2/03,
   * `PROTOCOL.md`). The request named it in `X-Openplate-Feature`.
   *
   * A FIFTH REFUSAL, NOT `ai-not-allowed` AND NOT `auth`. The account has AI
   * and a perfectly good credential; one FEATURE is not part of its plan, and
   * the screen shows the same closed-feature note the client's own gate shows,
   * with the way to the plan page (ADR-0024). `VisionProviderFailure.capability`
   * carries the label the proxy named.
   */
  | 'capability-required'
  /**
   * `503 {"error":"ai-instance-ceiling"}`, the whole instance has spent its
   * daily ceiling, and every account is refused until the next UTC day.
   *
   * NOT `transient`, WHICH IS WHERE IT USED TO LAND. Every status at or above
   * 500 fell through to that bucket, whose message is "try again in a moment"
   * about a thing that will refuse for the rest of the day, and it dropped the
   * `Retry-After` the service sends. It is also not about the person reading
   * it: their own allowance may be untouched, and the operator is the one out
   * of capacity.
   */
  | 'ai-instance-ceiling';

/** Thrown by a vision adapter with a machine-readable `failureCause` alongside the display `message`. */
export class VisionProviderFailure extends VisionProviderError {
  readonly failureCause: VisionFailureCause;
  /**
   * The server's own `Retry-After`, in seconds, or `null`.
   *
   * Carried so a screen can tell "wait a minute" from "wait until tomorrow"
   * without guessing: a managed instance answers `429` for both a per-minute
   * burst limit and a spent daily allowance, and only this header separates
   * them.
   */
  readonly retryAfterSeconds: number | null;
  /**
   * The feature label a `capability-required` refusal names, or `null` for
   * every other cause and for a refusal whose body named none. A label is a
   * string the SERVER chose; a screen maps it to a feature name it knows
   * (`isFeatureLabel`) and says nothing about one it does not.
   */
  readonly capability: string | null;

  constructor(
    failureCause: VisionFailureCause,
    message: string,
    options?: {
      cause?: unknown;
      usage?: ScanTokenUsage;
      retryAfterSeconds?: number | null;
      capability?: string | null;
    },
  ) {
    super(message, options);
    this.name = 'VisionProviderFailure';
    this.failureCause = failureCause;
    this.retryAfterSeconds = options?.retryAfterSeconds ?? null;
    this.capability = options?.capability ?? null;
  }
}

/**
 * The only part of a provider's error envelope this module reads. Parsed, not
 * asserted: it is a raw HTTP body from a third party, and `.catch(undefined)`
 * on the `error` member degrades an unexpected envelope to "no code" rather
 * than failing the whole classification.
 */
const KnownErrorBodySchema = z.object({
  // Two wire shapes carry the same domain value — the OpenAI-style
  // `{error: {code}}` object every provider sends, and a managed instance's
  // flat `{"error":"ai-not-allowed"}` string. Both are normalized HERE, at
  // the I/O boundary, into one `{ code }` domain value, so nothing
  // downstream has to ask which representation arrived. The free-text
  // `message` member is still never read (see above).
  // The label a `capability-required` refusal names. A sibling of `error`, not
  // inside it: the managed proxy's flat body is `{"error":"...","capability":"..."}`.
  capability: z.string().optional().catch(undefined),
  error: z
    .union([
      z.string().transform((code) => ({ code })),
      z
        .object({ code: z.string().optional(), type: z.string().optional() })
        .transform((raw) => ({ code: raw.code ?? raw.type })),
    ])
    .optional()
    .catch(undefined),
});

type KnownErrorBody = z.infer<typeof KnownErrorBodySchema>;

/**
 * Machine-readable error codes providers use for "you're out of money,"
 * surfaced at HTTP 429 — some providers (OpenAI included) reuse 429 for both
 * rate limiting AND quota exhaustion, so this is how the two are told apart.
 * Deliberately matched against the enum-like `code`/`type` fields only,
 * never the free-text `message` field — a provider's raw error body is never
 * echoed into a thrown message (the BYOK security rule: adapters must never
 * surface anything that could carry key material back out; OpenAI's own
 * auth-error `message`, for example, embeds a masked fragment of the key).
 */
const CREDIT_ERROR_CODES = new Set([
  'insufficient_quota',
  'quota_exceeded',
  'insufficient_credit',
  'insufficient_credits',
  'billing_hard_limit_reached',
]);

async function readErrorBody(response: Response): Promise<KnownErrorBody | null> {
  try {
    const parsed = KnownErrorBodySchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function is429CreditExhaustion(response: Response): Promise<boolean> {
  const body = await readErrorBody(response);
  const code = body?.error?.code;
  return code !== undefined && CREDIT_ERROR_CODES.has(code);
}

/**
 * The two markers a managed instance puts on a `403`, transcribed from M192's
 * contract table.
 *
 * Read as CODES, not as prose: `PROTOCOL.md` §4 forbids branching on a
 * server's message text, and these are the enum-like values the same body
 * carries for every other endpoint (`sync-error.ts` reads the suspended one
 * the same way).
 */
const AI_NOT_ALLOWED_CODE = 'ai-not-allowed';
const ACCOUNT_SUSPENDED_CODE = 'account-suspended';
const HEALTH_CONSENT_REQUIRED_CODE = 'health-consent-required';
const ALLOWANCE_EXPIRED_CODE = 'allowance-expired';
const TRIAL_SCANS_SPENT_CODE = 'trial-scans-spent';
const TRIAL_EXPIRED_CODE = 'trial-expired';
const CAPABILITY_REQUIRED_CODE = 'capability-required';

/** The marker on the instance-wide `503`, see `VisionFailureCause`. */
const AI_INSTANCE_CEILING_CODE = 'ai-instance-ceiling';

/**
 * The code on a `403` body, read ONCE.
 *
 * A `Response` body is a stream and can only be consumed once, so the three
 * markers below cannot each ask for it: the first read wins and every later
 * one throws into `readErrorBody`'s catch and answers `null`. That is exactly
 * how the two managed refusals were classified as ordinary key rejections
 * while a passing test suite watched (M192/06).
 */
async function readForbiddenBody(response: Response): Promise<{ code: string | undefined; capability: string | undefined }> {
  const body = await readErrorBody(response);
  return { code: body?.error?.code, capability: body?.capability };
}

const AUTH_MESSAGE = 'Your API key was rejected by the provider — check it in AI settings and try again.';
const CREDIT_MESSAGE = 'Your provider account is out of credit — add credit with your provider and try again.';
const RATE_LIMIT_MESSAGE = 'The provider is rate-limiting requests right now — wait a moment and try again.';
const SERVER_UNAVAILABLE_MESSAGE = 'The provider is temporarily unavailable — try again in a moment.';
const MODEL_NOT_FOUND_MESSAGE =
  "The provider doesn't recognize that model — pick a different model in AI settings and try again.";
const PHOTO_TOO_LARGE_MESSAGE = 'The photo is too large for this server. Try a smaller one.';
const AI_NOT_ALLOWED_MESSAGE = 'Photo estimates are not switched on for your account. Ask your administrator.';
const ACCOUNT_SUSPENDED_MESSAGE = 'Your account is suspended. Ask your administrator.';
// The screen replaces it with the consent screen's own translated sentences;
// this is the English a caller without `t` still gets, and it names no key.
const HEALTH_CONSENT_REQUIRED_MESSAGE = 'Your consent to the processing of your health data is needed first.';
// Neither of these names a date or a person. This module has no `t` and no
// account, so the DATE is added by the screen, which has both; the sentence
// here is the true one that needs neither (`scan.tsx`, `describeFailureBody`).
const ALLOWANCE_EXPIRED_MESSAGE = 'Your allowance for photo estimates has ended. Everything else keeps working.';
// No number: this module has no account, and the screen adds the count it read.
const TRIAL_SCANS_SPENT_MESSAGE = 'You used your free AI scans. Pick a plan to keep using AI entries.';
// No number either: the screen names the days from what the session read.
const TRIAL_EXPIRED_MESSAGE = 'Your free days are over. Pick a plan to keep using AI entries.';
// No feature name: this module has no `t`, and the screen restates the refusal
// with the name of the feature in the reader's language (`featureGate.closed`).
const CAPABILITY_REQUIRED_MESSAGE = 'This feature is not included in your plan.';
const AI_INSTANCE_CEILING_MESSAGE =
  'This instance has read all the photos it can today. Try again tomorrow. Nothing is wrong with your account.';

/** `413`, as its own status rather than a member of the unmatched-4xx bucket. */
const HTTP_PAYLOAD_TOO_LARGE = 413;

const HTTP_SERVER_ERROR_START = 500;

/** `503`, read for its body BEFORE the 5xx fall-through: the ceiling wears this status. */
const HTTP_SERVICE_UNAVAILABLE = 503;

export interface HttpFailureClassification {
  cause: VisionFailureCause;
  message: string;
  /** The server's `Retry-After` in seconds, when it sent one. Set on a `rate-limit` and on the instance ceiling. */
  retryAfterSeconds?: number | null;
  /** The feature label a `capability-required` refusal names, when the body carried one. */
  capability?: string;
}

/** `Retry-After` as a number of seconds, or `null` for an absent or unparseable header. */
function readRetryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get('Retry-After');
  if (raw === null) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * Message for the `invalid-request` bucket (400/413/422/any other unmatched
 * 4xx) — deliberately points at settings, not "try again": resending this
 * exact request can never turn it into a 2xx.
 */
function buildInvalidRequestMessage(status: number): string {
  return `The provider rejected the request as invalid (status ${status}) — double-check your model and connection settings in AI settings, then try again.`;
}

/**
 * Classifies a non-2xx vision-provider response into a typed cause plus an
 * accurate, display-safe message. Never reads the response body's free-text
 * `message` field (see `CREDIT_ERROR_CODES` doc above) — only its HTTP
 * status and, for 429s, a machine-readable error code.
 */
export async function classifyVisionHttpFailure(response: Response): Promise<HttpFailureClassification> {
  // ONE 403 BRANCH, one body read. Several refusals wear this status and only
  // the code tells them apart: an account with no allowance, a suspended
  // account, one without the instance's consent to health data, an allowance
  // whose end date passed, and spent free scans. None of them is fixed by
  // touching an API key, which is what the `auth` message asks for, and on a
  // managed instance there is no key and no settings page to ask about
  // (M192/06).
  if (response.status === 403) {
    const { code, capability } = await readForbiddenBody(response);
    if (code === CAPABILITY_REQUIRED_CODE) {
      return {
        cause: 'capability-required',
        message: CAPABILITY_REQUIRED_MESSAGE,
        ...(capability === undefined ? {} : { capability }),
      };
    }
    if (code === ACCOUNT_SUSPENDED_CODE) return { cause: 'account-suspended', message: ACCOUNT_SUSPENDED_MESSAGE };
    if (code === HEALTH_CONSENT_REQUIRED_CODE) {
      return { cause: 'consent-required', message: HEALTH_CONSENT_REQUIRED_MESSAGE };
    }
    if (code === AI_NOT_ALLOWED_CODE) return { cause: 'ai-not-allowed', message: AI_NOT_ALLOWED_MESSAGE };
    if (code === ALLOWANCE_EXPIRED_CODE) return { cause: 'allowance-expired', message: ALLOWANCE_EXPIRED_MESSAGE };
    if (code === TRIAL_SCANS_SPENT_CODE) return { cause: 'trial-scans-spent', message: TRIAL_SCANS_SPENT_MESSAGE };
    if (code === TRIAL_EXPIRED_CODE) return { cause: 'trial-expired', message: TRIAL_EXPIRED_MESSAGE };
    // A provider refusing a pasted key: the open instance's ordinary case.
    return { cause: 'auth', message: AUTH_MESSAGE };
  }
  if (response.status === 401) {
    return { cause: 'auth', message: AUTH_MESSAGE };
  }
  if (response.status === 402) {
    return { cause: 'credit', message: CREDIT_MESSAGE };
  }
  if (response.status === 404) {
    return { cause: 'model-not-found', message: MODEL_NOT_FOUND_MESSAGE };
  }
  if (response.status === 429) {
    const isCreditExhaustion = await is429CreditExhaustion(response);
    return isCreditExhaustion ?
        { cause: 'credit', message: CREDIT_MESSAGE }
        // The header rides along so the screen can say "in a minute" or "try
        // tomorrow" from the server's own advice rather than from a guess.
      : { cause: 'rate-limit', message: RATE_LIMIT_MESSAGE, retryAfterSeconds: readRetryAfterSeconds(response) };
  }
  if (response.status === HTTP_PAYLOAD_TOO_LARGE) {
    return { cause: 'photo-too-large', message: PHOTO_TOO_LARGE_MESSAGE };
  }
  // BEFORE THE 5xx FALL-THROUGH, and that order is the whole fix. A managed
  // instance out of its daily capacity answers `503 ai-instance-ceiling` with a
  // `Retry-After` to the next UTC midnight; read after the fall-through it
  // became "the provider is temporarily unavailable, try again in a moment"
  // about a refusal that lasts the rest of the day, and the header was thrown
  // away. A 503 with no marker, or any other 5xx, is still transient below.
  if (response.status === HTTP_SERVICE_UNAVAILABLE) {
    const code = (await readErrorBody(response))?.error?.code;
    if (code === AI_INSTANCE_CEILING_CODE) {
      return {
        cause: 'ai-instance-ceiling',
        message: AI_INSTANCE_CEILING_MESSAGE,
        // Carried exactly as the 429 branch carries it, so a screen can say
        // "tomorrow" from the service's own advice rather than from a guess.
        retryAfterSeconds: readRetryAfterSeconds(response),
      };
    }
    return { cause: 'transient', message: SERVER_UNAVAILABLE_MESSAGE };
  }
  if (response.status >= HTTP_SERVER_ERROR_START) {
    return { cause: 'transient', message: SERVER_UNAVAILABLE_MESSAGE };
  }
  // Everything left is a non-2xx this module doesn't have a dedicated bucket
  // for (400 bad request, 413 payload too large, 422 unprocessable entity,
  // or an unmatched 4xx from a nonstandard gateway). None of these can EVER
  // succeed by resending the identical request — see the `invalid-request`
  // doc on `VisionFailureCause` above for why this used to be a `transient`
  // bug.
  return { cause: 'invalid-request', message: buildInvalidRequestMessage(response.status) };
}
