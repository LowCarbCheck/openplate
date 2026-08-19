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
  | 'genuinely-no-food';

/** Thrown by a vision adapter with a machine-readable `failureCause` alongside the display `message`. */
export class VisionProviderFailure extends VisionProviderError {
  readonly failureCause: VisionFailureCause;

  constructor(
    failureCause: VisionFailureCause,
    message: string,
    options?: { cause?: unknown; usage?: ScanTokenUsage },
  ) {
    super(message, options);
    this.name = 'VisionProviderFailure';
    this.failureCause = failureCause;
  }
}

/**
 * The only part of a provider's error envelope this module reads. Parsed, not
 * asserted: it is a raw HTTP body from a third party, and `.catch(undefined)`
 * on the `error` member degrades an unexpected envelope to "no code" rather
 * than failing the whole classification.
 */
const KnownErrorBodySchema = z.object({
  error: z.object({ code: z.string().optional(), type: z.string().optional() }).optional().catch(undefined),
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
  const code = body?.error?.code ?? body?.error?.type;
  return code !== undefined && CREDIT_ERROR_CODES.has(code);
}

const AUTH_MESSAGE = 'Your API key was rejected by the provider — check it in AI settings and try again.';
const CREDIT_MESSAGE = 'Your provider account is out of credit — add credit with your provider and try again.';
const RATE_LIMIT_MESSAGE = 'The provider is rate-limiting requests right now — wait a moment and try again.';
const SERVER_UNAVAILABLE_MESSAGE = 'The provider is temporarily unavailable — try again in a moment.';
const MODEL_NOT_FOUND_MESSAGE =
  "The provider doesn't recognize that model — pick a different model in AI settings and try again.";

const HTTP_SERVER_ERROR_START = 500;

export interface HttpFailureClassification {
  cause: VisionFailureCause;
  message: string;
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
  if (response.status === 401 || response.status === 403) {
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
      : { cause: 'rate-limit', message: RATE_LIMIT_MESSAGE };
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
