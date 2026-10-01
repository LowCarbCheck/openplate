/**
 * Live "is this key valid" check performed before persisting BYOK settings
 * (see `app/routes/settings.ai.tsx`). Never throws — a network failure
 * resolves to `unverified` so the caller can decide to save anyway with a
 * warning, rather than blocking the user on a transient outage.
 *
 * Runs CLIENT-SIDE since M117/02 (the settings form calls it from a
 * `clientAction` — the key never touches the openplate server), so this
 * module deliberately has NO dependency on `#app/lib/logger` (pino is not
 * browser-safe — its dev pretty-transport branch reads `process.stdout` at
 * module init, which throws immediately in a browser bundle). A network
 * failure is silently downgraded to `unverified`; the caller surfaces that to
 * the user instead of a background log line.
 *
 * Security: never logs the key or forwards the request headers into any
 * thrown message.
 */
import type { AiProviderType } from '#types/enums';
import { getAnthropicAuthHeaders } from './constants';
import { getProviderDefinition } from './registry';
import type { ProviderDefinition } from './registry';

const VERIFY_TIMEOUT_MS = 5000;

export type KeyVerificationStatus = 'ok' | 'rejected' | 'unverified';

export interface KeyVerificationResult {
  status: KeyVerificationStatus;
}

export interface VerifyProviderKeyInput {
  provider: AiProviderType;
  apiKey: string;
  /** Only consulted for a provider with no fixed endpoint (`baseUrl: null` in the registry). */
  baseUrl?: string | null;
}

interface VerificationRequest {
  url: string;
  headers: HeadersInit;
}

/**
 * The URL the key check goes to, from the provider's `VerificationStrategy`.
 *
 * Why this is per-provider data and not one hardcoded path: OpenRouter's
 * `/models` is public and answers 200 to any request, key or no key
 * (confirmed directly — `curl` with a bogus key, and with no Authorization
 * header at all, both return 200), which made this whole check a silent
 * no-op; its registry entry therefore points at `/auth/key`, the
 * key-introspection endpoint that does 401 on a bad key.
 *
 * Throws when a `baseUrl: null` provider was given no base URL —
 * `verifyProviderKey` turns that into `rejected` (see its catch below).
 */
function resolveVerificationUrl({
  definition,
  requestedBaseUrl,
}: {
  definition: ProviderDefinition;
  requestedBaseUrl: string | null | undefined;
}): string {
  if (definition.verification.kind === 'absolute-url') return definition.verification.url;

  // `AiSettingsSchema` (M117/02 review fix) requires a base URL for a
  // self-hosted provider on every NEW save, but a row saved before that
  // requirement shipped could still have `baseUrl: null`. Fail loudly rather
  // than silently falling back to api.openai.com, which the browser can never
  // reach anyway (CSP/CORS).
  const configuredBaseUrl = definition.baseUrl ?? requestedBaseUrl;
  if (!configuredBaseUrl || configuredBaseUrl.trim() === '') {
    throw new Error('A base URL is required for a self-hosted / local endpoint.');
  }
  return `${configuredBaseUrl.trim().replace(/\/$/, '')}${definition.verification.path}`;
}

/**
 * Auth headers for the key check — derived from the adapter tag plus the
 * provider's call-time `extraHeaders`, so they are the same bytes the scan
 * call sends. Never logged, never echoed into a thrown message.
 */
function buildVerificationHeaders({
  definition,
  apiKey,
}: {
  definition: ProviderDefinition;
  apiKey: string;
}): HeadersInit {
  if (definition.adapter === 'anthropic') return getAnthropicAuthHeaders({ apiKey });
  return { Authorization: `Bearer ${apiKey}`, ...definition.extraHeaders?.() };
}

function buildVerificationRequest(input: VerifyProviderKeyInput): VerificationRequest {
  const definition = getProviderDefinition(input.provider);
  if (!definition) {
    // A settings row written by a newer build (see `getProviderDefinition`) —
    // a configuration problem, so the caller's catch turns it into `rejected`.
    throw new Error('Unknown AI provider.');
  }

  return {
    url: resolveVerificationUrl({ definition, requestedBaseUrl: input.baseUrl }),
    headers: buildVerificationHeaders({ definition, apiKey: input.apiKey }),
  };
}

/**
 * What one GET against a provider's own endpoint came to, before anyone reads
 * the body: the request could not be built (a missing base URL, an unknown
 * provider), it never got an answer (network, CORS, timeout), or it got one.
 */
export type ProviderProbeOutcome =
  | { kind: 'misconfigured' }
  | { kind: 'unreachable' }
  | { kind: 'answered'; response: Response };

export interface ProbeProviderEndpointInput extends VerifyProviderKeyInput {
  /** The `fetch` to call. Defaults to the global one, read at call time so a test stub is seen. */
  fetchImpl?: typeof fetch;
  /** A caller's own abort, combined with the timeout. */
  signal?: AbortSignal;
  /** How long to wait for an answer. Defaults to five seconds. */
  timeoutMs?: number;
}

/**
 * Settles with the fetch, or rejects once `timeoutMs` passes or `signal`
 * aborts, whichever comes first. A RACE as well as an abort, so a `fetch` that
 * ignores its signal (a stub, a broken polyfill) still cannot hold the caller.
 */
async function fetchWithDeadline({
  url,
  headers,
  fetchImpl,
  signal,
  timeoutMs,
}: {
  url: string;
  headers: HeadersInit;
  fetchImpl: typeof fetch;
  signal: AbortSignal | undefined;
  timeoutMs: number;
}): Promise<Response> {
  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort(signal?.reason);
  if (signal?.aborted === true) abortFromCaller();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('The provider did not answer in time.')), timeoutMs);
  const abandoned = new Promise<never>((_resolve, reject) => {
    if (controller.signal.aborted) reject(controller.signal.reason);
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  try {
    return await Promise.race([fetchImpl(url, { headers, signal: controller.signal }), abandoned]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

/**
 * One authenticated GET against a provider's own endpoint, the SAME request
 * the key check sends: the URL from the registry's `VerificationStrategy`, the
 * auth headers the scan call sends. Never throws, and never reads the body.
 *
 * Shared by the key check below and by the capability probe
 * (`#app/lib/ai/provider-capabilities`), so the two cannot drift on where a
 * self-hosted `/models` lives or on what a failure is.
 */
export async function probeProviderEndpoint(input: ProbeProviderEndpointInput): Promise<ProviderProbeOutcome> {
  let request: VerificationRequest;
  try {
    request = buildVerificationRequest(input);
  } catch {
    return { kind: 'misconfigured' };
  }
  // A local binding, never `input.fetchImpl(...)`: a browser's `fetch` called
  // as a method of another object throws "Illegal invocation".
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchWithDeadline({
      url: request.url,
      headers: request.headers,
      fetchImpl,
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? VERIFY_TIMEOUT_MS,
    });
    return { kind: 'answered', response };
  } catch {
    // Network error/timeout, never logged (no browser-safe logger here, see
    // the module doc comment).
    return { kind: 'unreachable' };
  }
}

/**
 * Checks a BYOK key against a provider endpoint that actually authenticates
 * it, Anthropic's and a caller's own `/models` already enforce auth (a
 * missing/bad key 401s); OpenRouter's `/models` doesn't, so its registry entry
 * points the check at `/auth/key` instead (see `./registry`). Resolves to
 * `rejected` on 401/403 (the key itself is bad), `ok` on any other response
 * (the provider is reachable and didn't reject the key), and `unverified`
 * if the provider couldn't be reached at all (network error/timeout).
 */
export async function verifyProviderKey(input: VerifyProviderKeyInput): Promise<KeyVerificationResult> {
  const outcome = await probeProviderEndpoint(input);
  // Missing base URL for openai-compatible: a configuration problem, not a
  // transient network issue, so this is closer to `rejected` (don't save
  // as-is) than `unverified` (save anyway with a warning).
  if (outcome.kind === 'misconfigured') return { status: 'rejected' };
  // The caller surfaces `unverified` to the user.
  if (outcome.kind === 'unreachable') return { status: 'unverified' };
  if (outcome.response.status === 401 || outcome.response.status === 403) return { status: 'rejected' };
  return { status: 'ok' };
}
